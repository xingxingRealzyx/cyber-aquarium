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

async function waitFor(check, message, timeout = 150000) {
  const until = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
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
    const page = await application.firstWindow();
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
    await application.close();
    apps.delete(application);
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
  await application.evaluate(async ({ app }, options) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const installer = load('./electron/update-installer.cjs');
    await installer.stageAndLaunchInstaller({
      ...options, executablePath: process.execPath, platform: process.platform, pid: process.pid, userDataPath: app.getPath('userData'),
    });
  }, { archivePath, workDir, version });
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
  process.kill(restartedPid);
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
  await normal.application.close();
  apps.delete(normal.application);
  await verifyRelaunch(normal.stage);
  assert.notEqual((await stat(exe, { bigint: true })).ino, original.ino, 'the installed executable was replaced');
  console.log('Verified staged installation, first-frame acknowledgement, restart and cleanup.');

  // Interrupt the helper and reproduce the exact on-disk state between backup and install.
  const interrupted = await openAndStage(false);
  const journal = JSON.parse(await readFile(path.join(interrupted.stage, 'journal.json'), 'utf8'));
  process.kill(journal.workerPid, 'SIGKILL');
  await interrupted.application.close();
  apps.delete(interrupted.application);
  const previous = path.join(interrupted.stage, 'previous');
  if (mac) await rename(appRoot, previous);
  else {
    await mkdir(path.join(previous, 'resources'), { recursive: true });
    await rename(path.join(appRoot, 'resources/app.asar'), path.join(previous, 'resources/app.asar'));
  }
  if (mac) await run('/bin/sh', [rescue]);
  else await run(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/c', 'call ".\\Recover Cyber Aquarium.cmd"'], { cwd: directory, windowsVerbatimArguments: true });
  await verifyRelaunch(interrupted.stage, true);
  await access(exe);
  console.log('Verified interrupted installation recovery, saved profile and unrelated files.');
} finally {
  for (const application of apps) await application.close().catch(() => {});
  if (restartedPid) { try { process.kill(restartedPid); } catch { /* already exited */ } }
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
