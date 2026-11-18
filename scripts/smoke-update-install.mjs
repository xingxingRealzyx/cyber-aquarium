import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';

const run = promisify(execFile);
const mac = process.platform === 'darwin';
assert.ok(mac || process.platform === 'win32');
const name = 'Cyber Aquarium';
const platform = mac ? 'macos-arm64' : 'windows-x64';
const target = path.resolve('release', name + '-' + (mac ? 'darwin-arm64' : 'win32-x64'));
const archive = path.resolve('release', 'Cyber-Aquarium-' + platform + '.zip');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'Aquarium Install Smoke ')));
const profile = path.join(temp, 'Isolated Profile');
const directory = path.join(temp, 'My Applications');
const appRoot = mac ? path.join(directory, name + '.app') : directory;
const exe = path.join(appRoot, mac ? 'Contents/MacOS/' + name : name + '.exe');
const rescue = path.join(directory, 'Recover Cyber Aquarium.' + (mac ? 'command' : 'cmd'));
const personalFile = path.join(directory, 'my aquarium notes.txt');
const args = ['--user-data-dir=' + profile];
let selectedBackend;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const apps = new Set();
let restartedPid;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function bounded(promise, ms, operation) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + operation)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function closeAquarium(application) {
  const pid = application.process().pid;
  console.log('Quitting current packaged aquarium', pid);
  await bounded(application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }), 15000, 'requesting app.quit()');
  await waitFor(() => !alive(pid), 'packaged aquarium ' + pid + ' failed to quit', 45000);
  apps.delete(application);
}

async function stopTestProcess(pid) {
  if (!pid || !alive(pid)) return;
  if (mac) process.kill(pid, 'SIGKILL');
  else await run(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { timeout: 12000, windowsHide: true }).catch(() => {});
}

async function showStage(stage) {
  const files = await readdir(stage).catch(() => []);
  const details = {};
  for (const file of ['plan.json', 'journal.json', 'launched.json', 'error.txt', 'rollback', 'ready', 'finished']) {
    if (!files.includes(file)) continue;
    const value = await readFile(path.join(stage, file), 'utf8').catch(() => '');
    if (file === 'plan.json' || file === 'journal.json' || file === 'launched.json') {
      const record = JSON.parse(value);
      const pid = record.workerPid || record.pid;
      details[file] = { pid, running: alive(pid) };
    } else details[file] = value;
  }
  console.log('Update stage', path.basename(stage), files, details);
}

async function waitFor(check, message, timeout = 150000) {
  const until = Date.now() + timeout;
  let nextReport = Date.now() + 20000;
  do {
    const result = await check();
    if (result) return result;
    if (Date.now() > nextReport) { console.log('Waiting:', message); nextReport += 20000; }
    await delay(125);
  } while (Date.now() < until);
  throw new Error(message);
}

async function openTestWindow() {
  const defaults = { name: 'default', flags: [] };
  const alternatives = [
    ...(mac ? [{ name: 'ANGLE OpenGL', flags: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] }] : []),
    { name: 'SwiftShader', flags: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  ];
  const options = selectedBackend ? [selectedBackend] : [defaults, ...(process.env.CI ? alternatives : [])];
  for (const backend of options) {
    console.log('Opening the isolated aquarium with', backend.name);
    const application = await electron.launch({ executablePath: exe, args: [...args, ...backend.flags], env, timeout: 90000 });
    apps.add(application);
    const page = await application.firstWindow({ timeout: 60000 });
    page.on('pageerror', error => console.log('Renderer exception:', error.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('Renderer error:', msg.text()); });
    const describe = () => page.evaluate(() => ({
      visible: document.visibilityState, ready: document.readyState, app: location.href,
      error: document.querySelector('#error')?.hidden === false ? document.querySelector('#error small').textContent : null,
      adapter: document.querySelector('#render-stat')?.title, stats: window.aquariumDiagnostics?.stats,
      triangles: window.aquariumDiagnostics?.renderer?.triangles, canvas: document.querySelector('canvas')?.style.visibility,
    }));
    try {
      await page.waitForFunction(() => document.querySelector('#error')?.hidden === false ||
        (window.aquariumDiagnostics?.renderer?.triangles > 0 && document.querySelector('canvas')?.style.visibility !== 'hidden'),
        null, { timeout: 120000 });
    } catch (error) {
      console.log('Timed out waiting for a packaged frame:', await describe());
      throw error;
    }
    const result = await describe();
    const gpu = await application.evaluate(({ app }) => ({ acceleration: app.isHardwareAccelerationEnabled(), webgl: app.getGPUFeatureStatus().webgl }));
    console.log('Isolated aquarium frame:', backend.name, JSON.stringify({ ...gpu, ...result }));
    if (!result.error) {
      selectedBackend = backend;
      return { application, page };
    }
    if (!/creating WebGL context|WebGL 2.*(?:unavailable|not supported)/i.test(result.error)) throw new Error(result.error);
    await closeAquarium(application);
  }
  throw new Error('No available adapter rendered the isolated aquarium.');
}

async function openAndStage(firstRun) {
  const { application, page } = await openTestWindow();
  if (firstRun) await page.evaluate(() => localStorage.setItem('smoke-update-stock', 'keep-this-tank'));
  else assert.equal(await page.evaluate(() => localStorage.getItem('smoke-update-stock')), 'keep-this-tank');
  const workDir = await mkdtemp(path.join(temp, 'download-'));
  const archivePath = path.join(workDir, 'aquarium.zip');
  await copyFile(archive, archivePath);
  console.log('Extracting and validating the real CI archive');
  await bounded(application.evaluate(async ({ app }, options) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const installer = load('./electron/update-installer.cjs');
    await installer.stageAndLaunchInstaller({
      ...options, executablePath: process.execPath, platform: process.platform, pid: process.pid, userDataPath: app.getPath('userData'),
    });
  }, { archivePath, workDir, version }), 150000, 'preparing update and launching worker');
  const stages = (await readdir(directory)).filter(file => file.startsWith('.cyber-aquarium-update-'));
  assert.equal(stages.length, 1);
  console.log('Update prepared:', stages[0]);
  await access(rescue);
  return { application, stage: path.join(directory, stages[0]) };
}

async function verifyRelaunch(stage, expectRecovery = false) {
  const ack = await waitFor(async () => {
    const failure = await readFile(path.join(stage, 'error.txt'), 'utf8').catch(() => '');
    if (failure) throw new Error('Update worker failed: ' + failure);
    const rollback = await readFile(path.join(stage, 'rollback'), 'utf8').catch(() => '');
    if (rollback && !expectRecovery) throw new Error('Update rolled back: ' + rollback);
    const record = await readFile(path.join(stage, 'ready'), 'utf8').catch(() => '');
    return record && JSON.parse(record);
  }, 'The newly launched fish tank never acknowledged its first frame');
  const plan = JSON.parse(await readFile(path.join(stage, 'plan.json'), 'utf8'));
  assert.equal(ack.token, plan.token);
  assert.equal(path.resolve(plan.userDataPath), profile);
  assert.ok(Number.isInteger(ack.pid) && ack.pid !== plan.pid);
  restartedPid = ack.pid;
  await waitFor(async () => !(await stat(stage).catch(() => null)), 'The update left its stage or backups behind');
  await waitFor(async () => !(await stat(rescue).catch(() => null)), 'The launcher was not retired after a successful restart');
  assert.equal(await readFile(personalFile, 'utf8'), 'personal file');
  await stopTestProcess(restartedPid);
  await waitFor(() => { try { process.kill(restartedPid, 0); return false; } catch { return true; } }, 'Isolated relaunch did not exit');
  restartedPid = undefined;
}

try {
  await mkdir(directory);
  if (mac) await run('/usr/bin/ditto', [path.join(target, name + '.app'), appRoot]);
  else await cp(target, appRoot, { recursive: true });
  await writeFile(personalFile, 'personal file');
  const original = await stat(exe, { bigint: true });
  const normal = await openAndStage(true);
  await closeAquarium(normal.application);
  await verifyRelaunch(normal.stage);
  assert.notEqual((await stat(exe, { bigint: true })).ino, original.ino, 'the installed executable was replaced');
  console.log('Verified staged installation, first-frame acknowledgement, restart and cleanup.');

  // Interrupt the helper and reproduce the exact on-disk state between backup and install.
  const interrupted = await openAndStage(false);
  const journal = JSON.parse(await readFile(path.join(interrupted.stage, 'journal.json'), 'utf8'));
  process.kill(journal.workerPid, 'SIGKILL');
  await closeAquarium(interrupted.application);
  const previous = path.join(interrupted.stage, 'previous');
  if (mac) await rename(appRoot, previous);
  else {
    await mkdir(path.join(previous, 'resources'), { recursive: true });
    await rename(path.join(appRoot, 'resources/app.asar'), path.join(previous, 'resources/app.asar'));
  }
  console.log('Invoking the recovery launcher on the interrupted install');
  if (mac) await run('/bin/sh', [rescue], { timeout: 90000 });
  else await run(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/c', 'call ".\\Recover Cyber Aquarium.cmd" <nul'], { cwd: directory, windowsVerbatimArguments: true, timeout: 90000 });
  await verifyRelaunch(interrupted.stage, true);
  await access(exe);
  console.log('Verified interrupted installation recovery, saved profile and unrelated files.');
} catch (error) {
  console.error('Isolated update smoke failed:', error);
  for (const entry of await readdir(directory).catch(() => [])) {
    if (!entry.startsWith('.cyber-aquarium-update-')) continue;
    const stage = path.join(directory, entry);
    await showStage(stage).catch(() => {});
    for (const file of ['journal.json', 'launched.json']) {
      const record = JSON.parse(await readFile(path.join(stage, file), 'utf8').catch(() => 'null'));
      if (record) await stopTestProcess(record.workerPid || record.pid);
    }
  }
  throw error;
} finally {
  for (const application of apps) await stopTestProcess(application.process().pid);
  await stopTestProcess(restartedPid);
  await rm(temp, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 }).catch(error => console.error('Isolated directory cleanup:', error.message));
}
