import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const newSpecies = ['discus', 'cardinal', 'rummynose', 'blackneon', 'cherrybarb', 'tigerbarb', 'galaxy', 'blackskirt', 'boesemani', 'platy'];
const allSpecies = [...newSpecies, 'angelfish', 'zebra', 'harlequin', 'guppy', 'neon', 'shrimp', 'snail'].sort();
const candidates = [
  process.env.CHROMIUM_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(homedir(), 'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try { await access(candidate); executablePath = candidate; break; } catch { /* Try the next installed browser. */ }
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1040, height: 760 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error' || /shader error|validate_status false|webgl: invalid_/i.test(msg.text())) errors.push(msg.text());
  });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(process.env.AQUARIUM_URL || 'http://127.0.0.1:5178/');
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  const readAnimals = () => page.evaluate(() => window.aquariumDiagnostics.state.animals);
  const stock = await readAnimals();
  await page.mouse.move(500, 400);
  await page.getByRole('button', { name: '添加生物', exact: true }).click();

  const previews = await page.locator('.species-card').evaluateAll(cards => Promise.all(cards.map(async card => {
    const image = card.querySelector('img');
    await image.decode();
    return { species: card.dataset.addAnimal, pixels: image.naturalWidth * image.naturalHeight };
  })));
  assert.deepEqual(previews.map(item => item.species).sort(), allSpecies);
  assert.ok(previews.every(item => item.pixels > 0));

  const additions = [];
  await page.locator('[data-stock-sex="female"]').click();
  for (const species of newSpecies) {
    await page.locator(`[data-add-animal="${species}"]`).click();
    const animals = await readAnimals();
    const added = animals.find(a => a.species === species && !stock.some(original => original.id === a.id));
    assert.ok(added?.alive, `${species} added to the tank`);
    assert.equal(added.sex, 'female', `${species} respects the selected sex`);
    additions.push(added);
  }
  assert.equal((await readAnimals()).length, stock.length + additions.length);
  await page.keyboard.press('Escape');

  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  const restored = await readAnimals();
  assert.deepEqual(restored.map(a => a.id), [...stock, ...additions].map(a => a.id));
  for (const original of additions) {
    const fish = restored.find(a => a.id === original.id);
    assert.equal(fish.species, original.species);
    assert.equal(fish.seed, original.seed);
    assert.equal(fish.label, original.label);
    assert.equal(fish.sex, original.sex);
  }
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => +getComputedStyle(document.querySelector('.dock-wrap')).opacity < .01 && +getComputedStyle(document.querySelector('#hint')).opacity < .01);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/aquarium-species.png', omitBackground: true });

  // Select the new fish furthest from other projected centers to avoid ambiguous occlusion.
  const ids = additions.map(a => a.id);
  let selected;
  for (let attempt = 0; attempt < 8 && !selected; attempt++) {
    const point = await page.evaluate(ids => {
      const points = window.aquariumDiagnostics.screenAnimals.filter(a => a.visible);
      return points.filter(a => ids.includes(a.id)).map(a => ({ ...a,
        clearance: Math.min(...points.filter(b => b.id !== a.id).map(b => Math.hypot(a.x-b.x, a.y-b.y))),
      })).sort((a,b) => b.clearance - a.clearance)[0];
    }, ids);
    if (!point) continue;
    await page.mouse.click(point.x, point.y);
    const selectedId = await page.locator('#inspector').getAttribute('data-animal-id');
    selected = additions.find(a => a.id === selectedId);
    if (!selected) await page.keyboard.press('Escape');
  }
  assert.ok(selected, 'a new three-dimensional fish can be picked and inspected');
  const inspector = page.locator('#inspector');
  await inspector.getByRole('heading', { name: selected.label }).waitFor();
  assert.equal(await inspector.locator('[data-field="life-stage"]').textContent(), '幼鱼');
  assert.ok(await inspector.locator('[data-field="fish-age"]').isVisible());
  await page.setViewportSize({ width: 720, height: 520 });
  const removeButton = inspector.getByRole('button', { name: '移出鱼缸', exact: true });
  assert.equal(await inspector.getByRole('button').last().textContent(), await removeButton.textContent());
  await removeButton.scrollIntoViewIfNeeded();
  assert.ok(await inspector.evaluate(el => el.scrollTop > 0), 'the compact inspector scrolls to the remove button');
  await removeButton.click();
  await inspector.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.aquariumDiagnostics.selectedId), null);
  const remainingIds = restored.filter(a => a.id !== selected.id).map(a => a.id);
  assert.deepEqual((await readAnimals()).map(a => a.id), remainingIds);
  await page.waitForFunction(id => !window.aquariumDiagnostics.screenAnimals.some(a => a.id === id), selected.id);
  await page.mouse.move(360, 260);
  await page.getByRole('button', { name: '添加生物', exact: true }).click();
  await page.getByText(`${remainingIds.length} 存活`, { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.resident').evaluateAll(rows => rows.map(row => row.dataset.select)), remainingIds);
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  assert.deepEqual((await readAnimals()).map(a => a.id), remainingIds);
  // Use a separate local save with an old fish close to its natural lifespan.
  const fixture = await page.evaluate(async () => {
    const { createInitialState, addAnimal } = await import('/src/simulation.js');
    const tank = createInitialState();
    tank.animals = [];
    tank.plants = [];
    const old = addAnimal(tank, 'guppy').animal;
    old.lifeAgeHours = old.lifespanHours - 1.5;
    old.position = { x: -.4, y: 3, z: .8 };
    const shrimp = addAnimal(tank, 'shrimp').animal;
    Object.assign(shrimp, { alive: false, health: 0, deathHours: 0, corpseMass: 0, causeOfDeath: '缺氧' });
    const young = addAnimal(tank, 'zebra').animal;
    tank.speed = 3600;
    tank.paused = true;
    return { tank, oldId: old.id, youngId: young.id, shrimpId: shrimp.id };
  });
  await page.addInitScript(tank => {
    if (!sessionStorage.getItem('lifecycle-fixture')) {
      localStorage.setItem('chengjing.aquarium.v1', JSON.stringify(tank));
      sessionStorage.setItem('lifecycle-fixture', '1');
    }
  }, fixture.tank);
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  const clickModel = async id => {
    const point = await page.evaluate(id => window.aquariumDiagnostics.screenAnimals.find(a => a.id === id && a.visible), id);
    assert.ok(point, 'the 3D fish is on screen');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(id => window.aquariumDiagnostics.selectedId === id, id);
  };
  await clickModel(fixture.oldId);
  assert.equal(await inspector.locator('[data-field="life-stage"]').textContent(), '老年鱼');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await page.waitForFunction(id => window.aquariumDiagnostics.state.animals.find(a => a.id === id)?.alive === false, fixture.oldId);
  await page.waitForFunction(id => window.aquariumDiagnostics.state.animals.find(a => a.id === id)?.position.y > 3.77, fixture.oldId);
  // Stop the scene to compare exact saved positions and decay after reopening.
  await page.keyboard.press('Space');
  const body = (await readAnimals()).find(a => a.id === fixture.oldId);
  assert.equal(body.causeOfDeath, '自然衰老');
  assert.ok(body.corpseMass < body.mass && body.corpseMass > 0);
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  const savedBody = (await readAnimals()).find(a => a.id === fixture.oldId);
  assert.deepEqual(savedBody.position, body.position);
  assert.equal(savedBody.corpseMass, body.corpseMass);
  // The saved body and its subsequent removal are visible in a viewing mode.
  await page.mouse.click(520, 380, { button: 'right' });
  await page.locator('[data-speed="1"]').click();
  await page.keyboard.press('Escape');
  await clickModel(fixture.oldId);
  await inspector.getByText('自然衰老', { exact: true }).waitFor();
  assert.ok(parseInt(await inspector.locator('[data-field="decay"]').textContent(), 10) > 0);
  await page.screenshot({ path: 'artifacts/aquarium-lifecycle.png', omitBackground: true });
  await inspector.getByRole('button', { name: '捞起遗体', exact: true }).click();
  await page.waitForFunction(id => !window.aquariumDiagnostics.screenAnimals.some(a => a.id === id), fixture.oldId);
  assert.deepEqual((await readAnimals()).map(a => a.id), [fixture.shrimpId,fixture.youngId]);
  await page.mouse.move(500, 400);
  await page.getByRole('button', { name: '添加生物', exact: true }).click();
  await page.getByRole('button', { name: '捞起全部遗体（1）', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.renderer?.triangles > 0);
  assert.deepEqual((await readAnimals()).map(a => a.id), [fixture.youngId]);
  assert.deepEqual(errors, []);
  const report = { previews: previews.length, fishAdded: newSpecies, inspected: selected.label, restored: restored.length, removed: selected.label, remaining: remainingIds.length, corpseNetted: body.causeOfDeath, errors };
  await writeFile('artifacts/smoke-species.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
