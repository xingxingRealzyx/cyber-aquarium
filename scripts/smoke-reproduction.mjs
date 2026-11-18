import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { addAnimal, createInitialState, SPECIES } from '../src/simulation.js';

// The isolated tank starts with adult guppies and one female shrimp. The user
// adds her mate through the normal stocking panel. Nothing is injected after that.
const tank = createInitialState();
tank.animals = [];
const guppies = ['female', 'male'].map(sex => addAnimal(tank, 'guppy', sex).animal);
for (const fish of guppies) fish.lifeAgeHours = SPECIES.guppy.maturityDays * 24;
const shrimp = addAnimal(tank, 'shrimp', 'female').animal;
tank.paused = true;
tank.speed = 3600;
tank.infectionClock.nextAtHours = 38;
const profile = await mkdtemp(path.join(tmpdir(), 'aquarium-breeding-'));
const target = process.argv[2];
const executablePath = target?.endsWith('.app') ? path.resolve(target, 'Contents/MacOS/Cyber Aquarium') : target;
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
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(fixture => {
    if (!sessionStorage.getItem('breeding-fixture')) {
      localStorage.setItem('chengjing.aquarium.v1', JSON.stringify(fixture));
      sessionStorage.setItem('breeding-fixture', '1');
    }
  }, tank);
  const ready = () => page.waitForFunction(() => window.aquariumDiagnostics?.stats.triangles > 0);
  const read = () => page.evaluate(() => window.aquariumDiagnostics);
  const panel = page.locator('#panel');
  const inspector = page.locator('#inspector');
  async function settings() {
    if (await panel.isVisible()) await panel.locator('[data-tab="settings"]').click();
    else {
      const { x, y } = (await read()).screenAnimals.find(p => p.visible);
      await page.mouse.click(x, y, { button: 'right' });
    }
    await panel.locator('[data-action="pause"]').waitFor();
  }
  async function toggle(label) {
    await settings();
    await panel.getByRole('button', { name: label, exact: true }).click();
  }
  await page.reload();
  await ready();
  await settings();
  await panel.locator('[data-tab="life"]').click();
  await panel.locator('[data-stock-sex="male"]').click();
  await panel.locator('[data-add-animal="shrimp"]').click();
  const mate = (await read()).state.animals.find(a => a.species === 'shrimp' && a.id !== shrimp.id);
  assert.equal(mate.sex, 'male');
  await panel.locator(`[data-select="${mate.id}"]`).click();
  assert.equal(await inspector.locator('[data-field="sex"]').textContent(), '公');
  assert.equal(await inspector.locator('[data-field="life-stage"]').textContent(), '成虾');
  await toggle('继续模拟');
  await page.waitForFunction(() => window.aquariumDiagnostics.state.broods.length === 2);
  await toggle('暂停模拟');
  const brooding = await read();
  const carried = brooding.state.broods.find(b => b.species === 'shrimp');
  assert.ok(brooding.screenBroods.some(b => b.id === carried.id), 'the carried eggs have a 3D model');
  await panel.locator('[data-tab="life"]').click();
  await panel.locator(`[data-select="${shrimp.id}"]`).click();
  assert.match(await inspector.locator('[data-field="breeding"]').textContent(), /抱卵/);
  await panel.locator('.brood-panel').getByText(/孔雀鱼.*怀胎/).waitFor();
  await panel.locator('.brood-panel').scrollIntoViewIfNeeded();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/aquarium-breeding.png', omitBackground: true });
  await page.reload();
  await ready();
  const loaded = await read();
  assert.equal(loaded.state.paused, true);
  assert.deepEqual(loaded.state.broods, brooding.state.broods);
  await toggle('继续模拟');
  await page.waitForFunction(() => {
    const offspring = window.aquariumDiagnostics.state.animals.filter(a => a.origin === 'born');
    return offspring.some(a => a.species === 'guppy') && offspring.some(a => a.species === 'shrimp');
  }, null, { timeout: 45000 });
  await toggle('暂停模拟');
  const born = await read();
  const young = ['guppy', 'shrimp'].map(species => born.state.animals.find(a => a.species === species && a.origin === 'born'));
  for (const a of young) {
    assert.ok(a.size < .68);
    const point = born.screenAnimals.find(p => p.id === a.id);
    assert.ok(Math.abs(point.scale - a.size) < 1e-6, 'the rendered model uses the newborn size');
    assert.equal(a.motherId, a.species === 'guppy' ? guppies[0].id : shrimp.id);
  }
  await panel.locator('[data-tab="life"]').click();
  await panel.locator(`[data-select="${young[1].id}"]`).click();
  assert.equal(await inspector.locator('[data-field="life-stage"]').textContent(), '幼虾');
  assert.equal(await inspector.locator('[data-field="origin"]').textContent(), '本缸出生');
  assert.match(await inspector.locator('[data-field="body-size"]').textContent(), /\d+%/);
  await page.screenshot({ path: 'artifacts/aquarium-hatchling.png', omitBackground: true });
  await toggle('继续模拟');
  await page.waitForFunction(start => window.aquariumDiagnostics.state.elapsedHours >= start + 3, born.state.elapsedHours);
  await toggle('暂停模拟');
  const grown = await read();
  for (const a of young) {
    const older = grown.state.animals.find(b => b.id === a.id);
    assert.ok(older.mass > a.mass && older.size > a.size);
    assert.ok(grown.screenAnimals.find(p => p.id === a.id).scale > a.size);
  }
  await page.reload();
  await ready();
  const restored = await read();
  assert.deepEqual(restored.state.animals.map(a => a.id), grown.state.animals.map(a => a.id));
  for (const a of young) {
    const before = grown.state.animals.find(b => b.id === a.id);
    const after = restored.state.animals.find(b => b.id === a.id);
    assert.equal(after.size, before.size);
    assert.equal(after.sex, before.sex);
    assert.equal(after.motherId, before.motherId);
  }
  assert.deepEqual(errors, []);
  console.log('Stocked a male, inspected both sexes, observed two broods, births, visible growth and a save round trip.');
} finally {
  await application?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
