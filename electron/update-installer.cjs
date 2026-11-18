const fs = require('node:fs');
const path = require('node:path');
const disk = process.versions.electron ? require('original-fs') : fs;
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');

const run = promisify(execFile);
const name = 'Cyber Aquarium';
const stagePrefix = '.cyber-aquarium-update-';
const manifestName = 'resources/update-files.json';

function layout(executablePath, platform) {
  const mac = platform === 'darwin';
  if (!['darwin', 'win32'].includes(platform) || path.basename(executablePath) !== (mac ? name : name + '.exe')) {
    throw new Error('此安装位置不支持直接更新。');
  }
  const destination = mac ? path.dirname(path.dirname(path.dirname(executablePath))) : path.dirname(executablePath);
  if (mac && (!destination.endsWith('.app') || path.relative(destination, executablePath) !== 'Contents/MacOS/' + name)) {
    throw new Error('请先将鱼缸移入「应用程序」，再检查更新。');
  }
  return { mac, destination, stageParent: mac ? path.dirname(destination) : destination };
}

function recoveryLauncher(stage, mac) {
  const dir = path.basename(stage);
  if (mac) return [
    '#!/bin/sh', 'set -eu', 'cd "$(dirname "$0")"',
    'stage="$PWD/' + dir + '"',
    'export ELECTRON_RUN_AS_NODE=1 ELECTRON_NO_ASAR=1',
    'for exe in "$stage/incoming/Cyber Aquarium.app/Contents/MacOS/Cyber Aquarium" "$stage/previous/Contents/MacOS/Cyber Aquarium"; do',
    '  if [ -x "$exe" ]; then exec "$exe" "$stage/worker.cjs" --recover; fi',
    'done', 'exit 1', '',
  ].join('\n');
  return [
    '@echo off', 'setlocal DisableDelayedExpansion', 'set "ELECTRON_RUN_AS_NODE=1"', 'set "ELECTRON_NO_ASAR=1"',
    '"%~dp0' + dir + '\\incoming\\Cyber Aquarium.exe" "%~dp0' + dir + '\\worker.cjs" --recover',
    'if errorlevel 1 pause', '',
  ].join('\r\n');
}

function safeEntry(entry) {
  return typeof entry === 'string' && entry.length > 0 && entry.split('/').every(part =>
    part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part) && !/[. ]$/.test(part));
}

function validateZipEntries(list) {
  for (let entry of list.trimEnd().split(/\r?\n/)) {
    if (entry === './' || entry === '.') continue;
    entry = entry.replace(/^\.\//, '').replace(/\/$/, '');
    if (!safeEntry(entry)) throw new Error('更新包包含无效路径。');
  }
}

async function checkPackage(root, mac, version) {
  const resources = path.join(root, mac ? 'Contents/Resources' : 'resources');
  // Electron's fs reads the package metadata inside the archive without running it.
  const pkg = JSON.parse(await fs.promises.readFile(path.join(resources, 'app.asar', 'package.json'), 'utf8'));
  if (pkg.name !== 'cyber-aquarium' || pkg.productName !== name || (version && pkg.version !== version)) {
    throw new Error('更新包的应用名称或版本与发布信息不符。');
  }
}

async function managedFiles(root) {
  const entries = JSON.parse(await fs.promises.readFile(path.join(root, manifestName), 'utf8'));
  if (!Array.isArray(entries) || !entries.every(safeEntry) || ![manifestName, name + '.exe', 'resources/app.asar'].every(file => entries.includes(file)) ||
      new Set(entries.map(file => file.toLowerCase())).size !== entries.length) throw new Error('便携版的安装文件清单无效。');
  return entries;
}

async function launchWorker(exe, stage, arch) {
  const worker = spawn(exe, [path.join(stage, 'worker.cjs')], {
    cwd: stage, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1' },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('更新助手启动超时。')), 20000);
      const fail = () => { clearTimeout(timer); reject(new Error('无法启动更新助手。')); };
      worker.once('error', fail);
      worker.once('exit', fail);
      worker.once('message', msg => {
        clearTimeout(timer);
        if (msg.arch === arch && msg.platform === process.platform) resolve();
        else reject(new Error('更新包与本机架构不匹配。'));
      });
    });
  } catch (error) {
    worker.kill();
    throw error;
  } finally {
    if (worker.connected) worker.disconnect();
    worker.unref();
  }
}

async function stageAndLaunchInstaller({ archivePath, workDir, version, executablePath, platform, pid, userDataPath }) {
  const { mac, destination, stageParent } = layout(executablePath, platform);
  await checkPackage(destination, mac);
  const stage = await fs.promises.mkdtemp(path.join(stageParent, stagePrefix)).catch(() => {
    throw new Error(mac ? '当前安装位置不可写。请将应用移入可写的「应用程序」文件夹后重试。' : '当前便携版目录不可写。请将鱼缸移到可写文件夹后重试。');
  });
  // The worker outlives the currently running app. Stage and backup share the install volume.
  try {
    const payload = path.join(stage, 'incoming');
    await fs.promises.mkdir(payload);
    const tar = mac ? '/usr/bin/tar' : path.join(process.env.SystemRoot, 'System32', 'tar.exe');
    const listing = await run(tar, ['-tf', archivePath], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    validateZipEntries(listing.stdout);
    if (mac) {
      await run('/usr/bin/ditto', ['-x', '-k', archivePath, payload]);
    } else {
      await run(tar, ['-xf', archivePath, '-C', payload], { windowsHide: true });
    }
    const candidate = mac ? path.join(payload, name + '.app') : payload;
    await checkPackage(candidate, mac, version);
    if (mac) {
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate]);
      const bundle = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(candidate, 'Contents/Info.plist')]);
      if (bundle.stdout.trim() !== 'com.cyberaquarium.desktop') throw new Error('更新包的应用标识不正确。');
    }
    const recoveryPath = path.join(stageParent, 'Recover Cyber Aquarium.' + (mac ? 'command' : 'cmd'));
    const graphicsArgs = process.argv.filter(arg => ['--use-gl=angle', '--use-angle=gl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'].includes(arg));
    const plan = { destination, candidate, executablePath, userDataPath, graphicsArgs, recoveryPath, pid, token: randomUUID() };
    if (!mac) {
      plan.previous = await managedFiles(destination);
      plan.next = await managedFiles(candidate);
    }
    await fs.promises.writeFile(path.join(stage, 'plan.json'), JSON.stringify(plan), { mode: 0o600 });
    await fs.promises.writeFile(path.join(stage, 'worker.cjs'), await fs.promises.readFile(path.join(__dirname, 'update-worker.cjs')));
    const exe = path.join(candidate, mac ? 'Contents/MacOS/' + name : name + '.exe');
    await fs.promises.writeFile(recoveryPath, recoveryLauncher(stage, mac), { flag: 'wx', mode: 0o700, flush: true }).catch(error => {
      if (error.code === 'EEXIST') throw new Error('上次更新尚待恢复。请双击安装位置的 Recover Cyber Aquarium，然后重试。');
      throw error;
    });
    try { await launchWorker(exe, stage, process.arch); }
    catch (error) { await fs.promises.unlink(recoveryPath); throw error; }
    // Only the archive and its now-empty download directory belong to this operation.
    await fs.promises.unlink(archivePath).catch(() => {});
    await fs.promises.rmdir(workDir).catch(() => {});
  } catch (error) {
    await disk.promises.rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function cleanupFinished(stage, recoveryPath) {
  let attempts = 0;
  const retired = stage + '.finished';
  let finished = fs.existsSync(retired);
  let removing = false;
  const timer = setInterval(async () => {
    if (++attempts > 150) return clearInterval(timer);
    if (removing) return;
    if (!finished) {
      try {
        const workerPid = Number(fs.readFileSync(path.join(stage, 'finished'), 'utf8'));
        if (!Number.isInteger(workerPid) || workerPid <= 0) return;
        try { process.kill(workerPid, 0); return; }
        catch (error) { if (error.code !== 'ESRCH') return; }
        finished = true;
      } catch { return; }
    }
    removing = true;
    try {
      // original-fs treats old app.asar as a file, including inside a backup .app.
      if (fs.existsSync(stage)) await disk.promises.rename(stage, retired);
      await disk.promises.rm(retired, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (await fs.promises.readFile(recoveryPath, 'utf8').catch(() => '') === recoveryLauncher(stage, process.platform === 'darwin')) {
        await fs.promises.unlink(recoveryPath);
      }
      clearInterval(timer);
    } catch { removing = false; }
  }, 1000);
  timer.unref();
}

function acknowledgeUpdateLaunch() {
  const pending = process.env.CYBER_AQUARIUM_UPDATE_DIR;
  const token = process.env.CYBER_AQUARIUM_UPDATE_TOKEN;
  delete process.env.CYBER_AQUARIUM_UPDATE_DIR;
  delete process.env.CYBER_AQUARIUM_UPDATE_TOKEN;
  try {
    if (path.basename(process.execPath).replace(/\.exe$/, '') !== name) return;
    const { mac, stageParent } = layout(process.execPath, process.platform);
    const recoveryPath = path.join(stageParent, 'Recover Cyber Aquarium.' + (mac ? 'command' : 'cmd'));
    if (!pending || !token) {
      // A shutdown after first frame can interrupt cleanup. The exact companion script
      // identifies our private scratch directory even if its plan was already removed.
      if (!fs.existsSync(recoveryPath)) return;
      const script = fs.readFileSync(recoveryPath, 'utf8');
      const suffix = script.match(/\.cyber-aquarium-update-[a-zA-Z0-9]{6}/)?.[0];
      if (!suffix) return;
      const stage = path.join(stageParent, suffix);
      if (script !== recoveryLauncher(stage, mac)) return;
      if (fs.existsSync(stage + '.finished') || fs.existsSync(path.join(stage, 'finished'))) cleanupFinished(stage, recoveryPath);
      else if (!fs.existsSync(stage)) fs.unlinkSync(recoveryPath);
      return;
    }
    if (path.dirname(pending) !== stageParent || !path.basename(pending).startsWith(stagePrefix)) return;
    const plan = JSON.parse(fs.readFileSync(path.join(pending, 'plan.json'), 'utf8'));
    if (plan.recoveryPath !== recoveryPath || token !== plan.token || plan.executablePath !== process.execPath) return;
    fs.writeFileSync(path.join(pending, 'ready'), JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    const rollback = fs.existsSync(path.join(pending, 'rollback')) ? fs.readFileSync(path.join(pending, 'rollback'), 'utf8') : null;
    cleanupFinished(pending, recoveryPath);
    if (rollback) return '已恢复更新前的版本。' + rollback;
  } catch (error) { console.warn('Could not acknowledge aquarium update:', error.message); }
}

module.exports = { stageAndLaunchInstaller, acknowledgeUpdateLaunch };
