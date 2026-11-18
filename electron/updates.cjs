const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const repository = 'xingxingRealzyx/cyber-aquarium';
const latestURL = `https://api.github.com/repos/${repository}/releases/latest`;
const downloads = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
const packages = {
  'darwin-arm64': 'Cyber-Aquarium-macos-arm64.zip',
  'win32-x64': 'Cyber-Aquarium-windows-x64.zip',
};

function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('无法识别正式版本号');
  }
  return version.split('.').map(BigInt);
}

function findUpdate(release, currentVersion, platform, arch) {
  if (release?.draft !== false || release.prerelease !== false || !/^v/.test(release.tag_name)) {
    throw new Error('GitHub 未返回有效的正式版本');
  }
  const version = release.tag_name.slice(1);
  const next = versionParts(version), installed = versionParts(currentVersion);
  const different = next.findIndex((part, index) => part !== installed[index]);
  if (different < 0 || next[different] < installed[different]) return { version };

  const name = packages[`${platform}-${arch}`];
  if (!name) throw new Error('当前平台暂无可用的更新包');
  const asset = release.assets?.find(item => item?.name === name && item.state === 'uploaded');
  const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
  if (!asset || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error('此版本的安装包尚未就绪，请稍后再检查');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error('更新包缺少有效的 SHA-256 校验值');
  return { version, asset: { url, size: asset.size, sha256: asset.digest.slice(7) } };
}

// net.request uses the operating system's proxy configuration. Only the original
// release URL and GitHub's HTTPS asset hosts participate in the download.
function githubRequest(net, url, signal) {
  return new Promise((resolve, reject) => {
    const metadata = url === latestURL;
    const req = net.request({
      url, redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { 'User-Agent': 'Cyber-Aquarium-Desktop', Accept: metadata ? 'application/vnd.github+json' : 'application/octet-stream' },
    });
    let body;
    function abort(error) {
      reject(error);
      body?.destroy(error);
      req.abort();
    }
    const onAbort = () => abort(new Error('连接 GitHub 超时，请检查网络后重试'));
    signal.addEventListener('abort', onAbort, { once: true });
    req.once('close', () => signal.removeEventListener('abort', onAbort));
    req.on('error', error => {
      const reason = new Error(`无法连接 GitHub（${error.message}）`);
      reject(reason);
      body?.destroy(reason);
    });
    req.on('redirect', (_status, method, target) => {
      const dest = new URL(target);
      if (metadata || method !== 'GET' || dest.protocol !== 'https:' || dest.username || dest.password || dest.port || !downloads.has(dest.hostname)) {
        abort(new Error('更新请求被重定向到未知地址'));
        return;
      }
      req.followRedirect();
    });
    req.once('response', response => {
      if (response.statusCode !== 200) {
        abort(new Error(`GitHub 返回 HTTP ${response.statusCode}，请稍后重试`));
        return;
      }
      body = response;
      resolve(response);
    });
    if (signal.aborted) onAbort();
    else req.end();
  });
}

async function readRelease(request) {
  const body = await request(latestURL, AbortSignal.timeout(30000));
  let size = 0;
  const chunks = [];
  for await (const chunk of body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('GitHub 版本信息过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function downloadAsset(request, asset, file, onProgress) {
  const idle = new AbortController();
  const stallTimer = setTimeout(() => idle.abort(), 60000);
  const hash = createHash('sha256');
  let received = 0;
  try {
    const body = await request(asset.url, idle.signal);
    await pipeline(body, async function* verify(source) {
      for await (const chunk of source) {
        stallTimer.refresh();
        received += chunk.length;
        if (received > asset.size) throw new Error('更新包大小与发布记录不符');
        hash.update(chunk);
        onProgress(Math.floor(received * 100 / asset.size));
        yield chunk;
      }
    }, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  } finally {
    clearTimeout(stallTimer);
  }
  if (received !== asset.size || hash.digest('hex') !== asset.sha256) {
    throw new Error('更新包校验失败，请重新检查并下载');
  }
}

function createUpdater({ currentVersion, platform, arch, isPackaged, request, stagingRoot,
  executablePath, userDataPath, stageAndLaunchInstaller, onState, quit }) {
  let state = { phase: 'idle', currentVersion, latestVersion: null, progress: 0, message: '' };
  let candidate = null;
  let inFlight;
  let releaseLookup;
  function setState(phase, changes) {
    state = { ...state, phase, ...changes };
    onState(state);
    return state;
  }
  function run(operation) {
    // Clicks from two windows/controls share one check or installation.
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(operation).catch(error => {
      candidate = null;
      return setState('error', { progress: 0, message: error.message || '更新失败，请重试' });
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  function latestRelease() {
    // An explicit check during a background lookup shares the same request.
    if (!releaseLookup) {
      releaseLookup = readRelease(request)
        .then(release => findUpdate(release, currentVersion, platform, arch))
        .finally(() => { releaseLookup = null; });
    }
    return releaseLookup;
  }
  function applyRelease({ version, asset }) {
    candidate = asset ? { version, asset } : null;
    return setState(asset ? 'available' : 'current', {
      latestVersion: version, progress: 0,
      message: asset ? `发现新版本 v${version}` : '当前已是最新版本',
    });
  }
  async function checkInBackground() {
    if (inFlight || state.phase === 'installing') return state;
    const previous = state;
    let release;
    try { release = await latestRelease(); }
    catch { return state; }
    // A user action or an installer rollback takes priority over this lookup.
    if (state !== previous || inFlight || (state.phase === 'error' && !release.asset)) return state;
    return applyRelease(release);
  }
  function check() {
    if (state.phase === 'installing') return Promise.resolve(state);
    return run(async () => {
      candidate = null;
      setState('checking', { latestVersion: null, progress: 0, message: '正在检查更新…' });
      return applyRelease(await latestRelease());
    });
  }
  function install() {
    if (inFlight) return inFlight;
    if (!candidate || state.phase !== 'available') return Promise.resolve(state);
    return run(async () => {
      if (!isPackaged) throw new Error('请从已安装的桌面应用中执行更新');
      const { version, asset } = candidate;
      setState('downloading', { progress: 0, message: '正在下载更新包…' });
      // A single app instance owns this profile. Reclaim interrupted downloads
      // from a previous process before making a new private staging directory.
      await fs.mkdir(stagingRoot, { recursive: true });
      const leftovers = await fs.readdir(stagingRoot, { withFileTypes: true });
      for (const entry of leftovers) {
        if (entry.isDirectory() && /^download-[a-zA-Z0-9]{6}$/.test(entry.name)) {
          await fs.rm(path.join(stagingRoot, entry.name), { recursive: true, force: true });
        }
      }
      const workDir = await fs.mkdtemp(path.join(stagingRoot, 'download-'));
      try {
        const archivePath = path.join(workDir, 'update.zip');
        await downloadAsset(request, asset, archivePath, progress => {
          if (progress !== state.progress) setState('downloading', { progress });
        });
        setState('installing', { progress: 100, message: '正在安装，鱼缸将自动重新打开…' });
        await stageAndLaunchInstaller({ archivePath, workDir, version, executablePath, platform, pid: process.pid, userDataPath });
      } catch (error) {
        await fs.rm(workDir, { recursive: true, force: true });
        throw error;
      }
      quit();
      return state;
    });
  }
  return { getState: () => state, check, checkInBackground, install,
    reportRollback: message => { candidate = null; return setState('error', { message, progress: 0 }); },
  };
}

module.exports = { createUpdater, findUpdate, githubRequest };
