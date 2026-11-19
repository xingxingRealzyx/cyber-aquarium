import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

// With no arguments, run the local Electron app after npm run build.
const target = process.argv[2];
const executablePath = target?.endsWith('.app')
  ? path.resolve(target, 'Contents/MacOS/Cyber Aquarium') : target;
const profile = await mkdtemp(path.join(tmpdir(), 'aquarium-health-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let application;
try {
  application = await electron.launch({
    executablePath, args: [...(target ? [] : ['.']), '--user-data-dir=' + profile], env,
  });
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  const dock = page.locator('#dock');
  const panel = page.locator('#panel');
  const inspector = page.locator('#inspector');
  const card = inspector.locator('.case-card');
  const read = () => page.evaluate(() => window.aquariumDiagnostics.state);
  async function openSettings() {
    // The tank's context menu is also available while the dock is hidden.
    const point = await page.evaluate(() => window.aquariumDiagnostics.screenAnimals.find(a => a.visible));
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await panel.locator('[data-speed="3600"]').waitFor();
  }
  await ready();
  assert.equal((await read()).speed, 1);
  await openSettings();
  await panel.locator('[data-speed="3600"]').click();
  await page.waitForFunction(() => window.aquariumDiagnostics.state.animals.some(a => a.infection), null, { timeout: 60000 });
  await panel.getByRole('button', { name: '暂停模拟', exact: true }).click();
  const frozen = await read();
  const patient = frozen.animals.find(a => a.infection);
  await dock.locator('#infection-dot').waitFor();
  await panel.locator('[data-tab="life"]').click();
  assert.equal(await panel.locator('.resident').first().getAttribute('data-select'), patient.id);
  await panel.locator('.resident').first().click();
  await card.waitFor();
  const label = patient.infection.kind === 'viral' ? '病毒感染' : '细菌感染';
  assert.equal(await card.locator('[data-field="infection"]').textContent(), label);
  await page.waitForTimeout(600);
  assert.equal((await read()).elapsedHours, frozen.elapsedHours);
  assert.deepEqual((await read()).animals.find(a => a.id === patient.id).infection, patient.infection);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/aquarium-infection.png', omitBackground: true });
  await card.getByRole('button', { name: '开始护理' }).click();
  assert.ok(await card.getByRole('button', { name: '护理中' }).isDisabled());

  await page.reload();
  await ready();
  const restored = await read();
  assert.equal(restored.paused, true);
  assert.deepEqual(restored.infectionClock, frozen.infectionClock);
  assert.deepEqual(restored.animals.find(a => a.id === patient.id).infection, { ...patient.infection, cared: true });
  await openSettings();
  await panel.getByRole('button', { name: '继续模拟', exact: true }).click();
  await page.waitForFunction(id => {
    const fish = window.aquariumDiagnostics.state.animals.find(a => a.id === id);
    return fish.alive && !fish.infection;
  }, patient.id);
  await dock.locator('#infection-dot').waitFor({ state: 'hidden' });
  await panel.locator('[data-tab="journal"]').click();
  await panel.getByText(`${patient.label}的${label}已康复。`, { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`${patient.label} · ${label} · 暂停、护理存档、恢复、日志通过`);
} finally {
  await application?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
