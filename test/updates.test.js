import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import updates from '../electron/updates.cjs';

const { createUpdater, findUpdate } = updates;
const bytes = Buffer.from('test archive');
function release(platformName = 'macos-arm64') {
  const name = `Cyber-Aquarium-${platformName}.zip`;
  return {
    tag_name: 'v1.10.0', draft: false, prerelease: false,
    assets: [{ name, state:'uploaded', size: bytes.length,
      browser_download_url: `https://github.com/xingxingRealzyx/cyber-aquarium/releases/download/v1.10.0/${name}`,
      digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }],
  };
}

test('only a newer stable release with the expected platform, URL and digest is eligible', () => {
  const item = release();
  for (const version of ['1.10.0', '1.12.0', '2.0.0']) {
    assert.equal(findUpdate(item, version, 'darwin', 'arm64').asset, undefined);
  }
  assert.equal(findUpdate(item, '1.9.12', 'darwin', 'arm64').asset.sha256, item.assets[0].digest.slice(7));
  assert.ok(findUpdate(release('windows-x64'), '0.5.3', 'win32', 'x64').asset);
  assert.throws(() => findUpdate(item, '0.5.3', 'win32', 'x64'));
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.0.0-rc1' }, { tag_name: 'v01.2.3' }]) {
    assert.throws(() => findUpdate({ ...item, ...patch }, '0.5.3', 'darwin', 'arm64'));
  }
  for (const patch of [{ digest: null }, { size: 0 }, { state: 'open' }, { browser_download_url: 'https://example.org/package.zip' }]) {
    assert.throws(() => findUpdate({ ...item, assets: [{ ...item.assets[0], ...patch }] }, '0.5.3', 'darwin', 'arm64'));
  }
});

test('failed transfers clean up and retry; concurrent clicks download and launch once', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aquarium-update-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const item = release();
  let payload = Buffer.alloc(bytes.length, 1), downloads = 0, launches = 0, quits = 0;
  const history = [];
  const updater = createUpdater({
    currentVersion: '0.5.3', platform: 'darwin', arch: 'arm64', isPackaged: true,
    stagingRoot: dir, executablePath: '/app', userDataPath: '/profile',
    request: async url => {
      if (url.startsWith('https://api.github.com/')) return Readable.from([Buffer.from(JSON.stringify(item))]);
      downloads++;
      return Readable.from([payload.subarray(0, 4), payload.subarray(4)]);
    },
    stageAndLaunchInstaller: async ({ archivePath, workDir, version, userDataPath }) => {
      launches++;
      assert.equal(version, '1.10.0');
      assert.equal(userDataPath, '/profile');
      assert.deepEqual(await readFile(archivePath), bytes);
      await rm(workDir, { recursive: true });
    },
    onState: s => history.push(s), quit: () => quits++,
  });

  assert.equal((await updater.install()).phase, 'idle');
  for (const [bad, message] of [[payload, /校验失败/], [Buffer.alloc(bytes.length + 1), /大小/], [Buffer.alloc(0), /校验失败/]]) {
    payload = bad;
    assert.equal((await updater.check()).phase, 'available');
    const failure = await updater.install();
    assert.equal(failure.phase, 'error');
    assert.match(failure.message, message);
    assert.deepEqual(await readdir(dir), []);
    assert.equal(launches, 0);
    assert.equal(quits, 0);
  }
  payload = bytes;
  await updater.check();
  const [a,b] = await Promise.all([updater.install(), updater.install()]);
  assert.equal(a.phase, 'installing');
  assert.deepEqual(a, b);
  assert.equal(downloads, 4);
  assert.equal(launches, 1);
  assert.equal(quits, 1);
  assert.ok(history.some(s => s.phase === 'downloading' && s.progress > 0 && s.progress < 100));
});

test('automatic checks stay quiet offline and keep an available update actionable during a refresh', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aquarium-background-check-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reported = [];
  const offline = () => { throw new Error('offline'); };
  let metadata = offline, downloads = 0, launches = 0;
  const updater = createUpdater({
    currentVersion: '0.8.0', platform: 'darwin', arch: 'arm64', isPackaged: true,
    stagingRoot: dir, executablePath: '/app', userDataPath: '/profile',
    request: async url => {
      if (url.startsWith('https://api.github.com/')) return metadata();
      downloads++;
      return Readable.from([bytes]);
    },
    onState: s => reported.push(s.phase), stageAndLaunchInstaller: async () => { launches++; }, quit: () => {},
  });
  assert.equal((await updater.checkInBackground()).phase, 'idle');
  assert.deepEqual(reported, []);
  metadata = () => Readable.from([Buffer.from(JSON.stringify(release()))]);
  const available = await updater.checkInBackground();
  assert.equal(available.latestVersion, '1.10.0');
  assert.deepEqual(reported, ['available']);
  metadata = offline;
  assert.deepEqual(await updater.checkInBackground(), available);
  assert.deepEqual(reported, ['available']);
  assert.equal(downloads, 0);
  const pending = Promise.withResolvers();
  metadata = () => pending.promise;
  const refreshing = updater.checkInBackground();
  assert.equal((await updater.install()).phase, 'installing');
  pending.resolve(Readable.from([Buffer.from(JSON.stringify(release()))]));
  assert.equal((await refreshing).phase, 'installing');
  assert.equal(downloads, 1);
  assert.equal(launches, 1);
});

test('manual checks share an active background lookup and surface its network errors', async () => {
  const pending = Promise.withResolvers();
  let requests = 0;
  const reported = [];
  const updater = createUpdater({
    currentVersion: '0.8.0', platform: 'win32', arch: 'x64', isPackaged: true,
    request: () => { requests++; return pending.promise; }, onState: s => reported.push(s.phase),
  });
  const background = updater.checkInBackground();
  const manual = updater.check();
  pending.reject(new Error('offline'));
  await background;
  const result = await manual;
  assert.equal(result.phase, 'error');
  assert.equal(result.message, 'offline');
  assert.equal(requests, 1);
  assert.deepEqual(reported, ['checking', 'error']);
});

test('background checks recover from a previous manual error without overwriting a newer rollback', async () => {
  let metadata = () => { throw new Error('offline'); };
  const updater = createUpdater({
    currentVersion: '0.8.0', platform: 'darwin', arch: 'arm64', isPackaged: true,
    request: () => metadata(), onState: () => {},
  });
  const error = await updater.check();
  metadata = () => Readable.from([Buffer.from(JSON.stringify({ ...release(), tag_name: 'v0.8.0' }))]);
  assert.deepEqual(await updater.checkInBackground(), error);
  const pending = Promise.withResolvers();
  metadata = () => pending.promise;
  const background = updater.checkInBackground();
  const rollback = updater.reportRollback('安装已回退');
  pending.resolve(Readable.from([Buffer.from(JSON.stringify(release()))]));
  assert.deepEqual(await background, rollback);
  metadata = () => Readable.from([Buffer.from(JSON.stringify(release()))]);
  assert.equal((await updater.checkInBackground()).phase, 'available');
});
