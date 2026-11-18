// Copied out of app.asar and run in the staged Electron runtime in Node mode.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const stage = __dirname;
const backup = path.join(stage, 'previous');
const mac = process.platform === 'darwin';

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function waitFor(test, timeout) {
  const until = Date.now() + timeout;
  do {
    if (await test()) return true;
    await delay(200);
  } while (Date.now() < until);
  return false;
}

async function move(from, to) {
  // Chromium subprocesses and Windows virus scanners may briefly hold a file handle.
  const stop = Date.now() + 12000;
  for (;;) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || Date.now() >= stop) throw error;
      await delay(200);
    }
  }
}

async function stat(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function checkPortablePaths(plan) {
  const old = new Set(plan.previous.map(file => file.toLowerCase()));
  const dirs = new Set();
  for (const file of new Set([...plan.previous, ...plan.next])) {
    const target = path.join(plan.destination, file);
    const profile = path.resolve(plan.userDataPath).toLowerCase();
    if (target.toLowerCase() === profile || target.toLowerCase().startsWith(profile + path.sep)) {
      throw new Error('安装文件与鱼缸存档目录重叠。');
    }
    for (let dir = path.dirname(target); dir !== plan.destination && !dirs.has(dir); dir = path.dirname(dir)) {
      const info = await stat(dir);
      if (info && !info.isDirectory()) throw new Error('安装路径包含链接或同名文件：' + dir);
      dirs.add(dir);
    }
    const info = await stat(target);
    if (info && (!info.isFile() || !old.has(file.toLowerCase()))) throw new Error('已有文件与更新包重名：' + file);
  }
  for (const entry of plan.next) {
    if (!(await fs.lstat(path.join(plan.candidate, entry))).isFile()) throw new Error('更新包缺少文件：' + entry);
  }
}

async function prepareJournal(plan) {
  const existing = [];
  if (!mac) {
    await checkPortablePaths(plan);
    for (const file of plan.previous) {
      if (await stat(path.join(plan.destination, file))) existing.push(file);
    }
  }
  const journal = { existing, workerPid: process.pid };
  await fs.writeFile(path.join(stage, 'journal.tmp'), JSON.stringify(journal), { flush: true });
  await fs.rename(path.join(stage, 'journal.tmp'), path.join(stage, 'journal.json'));
  return journal;
}

async function install(plan, journal) {
  if (mac) {
    await move(plan.destination, backup);
    await move(plan.candidate, plan.destination);
    return;
  }
  const existing = new Set(journal.existing);
  const next = new Set(plan.next);
  const pending = path.join(stage, 'next-file');
  for (const file of new Set([...plan.next, ...plan.previous])) {
    const target = path.join(plan.destination, file);
    // Prepare a complete file before taking the previous file out of service.
    if (next.has(file)) await fs.copyFile(path.join(plan.candidate, file), pending);
    if (existing.has(file)) {
      const saved = path.join(backup, file);
      await fs.mkdir(path.dirname(saved), { recursive: true });
      await move(target, saved);
    }
    if (next.has(file)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await move(pending, target);
    }
  }
}

async function restore(plan, journal) {
  if (mac) {
    if (!await stat(backup)) return;
    if (await stat(plan.destination)) await move(plan.destination, plan.candidate);
    await move(backup, plan.destination);
    return;
  }
  const existing = new Set(journal.existing);
  const errors = [];
  // Backups and the journal survive an interrupted install or interrupted rollback.
  for (const file of new Set([...plan.next, ...plan.previous])) {
    try {
      const target = path.join(plan.destination, file);
      const saved = path.join(backup, file);
      if (await stat(saved)) {
        if (await stat(target)) await fs.unlink(target);
        await move(saved, target);
      } else if (!existing.has(file) && plan.next.includes(file) && await stat(target)) {
        await fs.unlink(target);
      }
    } catch (error) { errors.push(error.message); }
  }
  if (errors.length) throw new Error('请关闭鱼缸并再次运行恢复程序。' + errors.join('\n'));
}

async function startAquarium(plan) {
  const env = { ...process.env, CYBER_AQUARIUM_UPDATE_DIR: stage, CYBER_AQUARIUM_UPDATE_TOKEN: plan.token };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  const app = spawn(plan.executablePath, ['--user-data-dir=' + plan.userDataPath, ...plan.graphicsArgs], {
    env, cwd: path.dirname(plan.executablePath), stdio: 'ignore', detached: true,
  });
  await new Promise((resolve, reject) => { app.once('spawn', resolve); app.once('error', reject); });
  app.unref();
  await fs.writeFile(path.join(stage, 'launched.json'), JSON.stringify({ pid: app.pid }), { flush: true }).catch(() => {});
  return app;
}

async function stopAquarium(child) {
  if (!child || !alive(child.pid)) return;
  child.kill();
  if (await waitFor(() => !alive(child.pid), 5000)) return;
  child.kill('SIGKILL');
  if (!await waitFor(() => !alive(child.pid), 8000)) throw new Error('更新程序未能退出。');
}

async function main() {
  const plan = JSON.parse(await fs.readFile(path.join(stage, 'plan.json'), 'utf8'));
  if (process.argv.includes('--recover')) {
    if (await stat(path.join(stage, 'finished'))) {
      // An interrupted cleanup is completed by the next normal launch.
      await startAquarium({ ...plan, token: '' });
      return;
    }
    const saved = await fs.readFile(path.join(stage, 'journal.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const journal = saved && JSON.parse(saved);
    const launched = JSON.parse(await fs.readFile(path.join(stage, 'launched.json'), 'utf8').catch(() => 'null'));
    if (alive(plan.pid) || (journal && alive(journal.workerPid)) || (launched && alive(launched.pid))) throw new Error('请先关闭鱼缸并等待当前更新助手退出。');
    if (journal) await restore(plan, journal);
    await fs.unlink(path.join(stage, 'ready')).catch(() => {});
    await fs.writeFile(path.join(stage, 'rollback'), '已从更新备份恢复。');
    await startAquarium(plan);
    await fs.writeFile(path.join(stage, 'finished'), String(process.pid));
    return;
  }
  const journal = await prepareJournal(plan);
  process.send({ platform: process.platform, arch: process.arch });
  if (!await waitFor(() => !alive(plan.pid), 120000)) return;
  let child;
  try {
    await install(plan, journal);
    child = await startAquarium(plan);
    const ready = await waitFor(async () => {
      if (!alive(child.pid)) throw new Error('新版鱼缸未能启动。');
      const signal = await fs.readFile(path.join(stage, 'ready'), 'utf8').catch(() => '');
      if (!signal) return false;
      const ack = JSON.parse(signal);
      return ack.pid === child.pid && ack.token === plan.token;
    }, 90000);
    if (!ready) throw new Error('新版鱼缸未能打开窗口。');
  } catch (error) {
    await stopAquarium(child);
    await restore(plan, journal);
    await fs.unlink(path.join(stage, 'ready')).catch(() => {});
    await fs.writeFile(path.join(stage, 'rollback'), error.message);
    await startAquarium(plan);
  }
  await fs.writeFile(path.join(stage, 'finished'), String(process.pid));
}

main().catch(async error => {
  // Retain backups if rollback itself fails. The detached process has no visible console.
  await fs.writeFile(path.join(stage, 'error.txt'), error.message).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
});
