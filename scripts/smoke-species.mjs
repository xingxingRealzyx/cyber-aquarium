import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const newSpecies = ['angelfish', 'zebra', 'harlequin'];
const allSpecies = [...newSpecies, 'guppy', 'neon', 'shrimp', 'snail'].sort();
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
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
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
  for (const species of newSpecies) {
    await page.locator(`[data-add-animal="${species}"]`).click();
    const animals = await readAnimals();
    const added = animals.find(a => a.species === species && !stock.some(original => original.id === a.id));
    assert.ok(added?.alive, `${species} added to the tank`);
    additions.push(added);
  }
  assert.equal((await readAnimals()).length, stock.length + additions.length);
  await page.keyboard.press('Escape');

  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  const restored = await readAnimals();
  assert.deepEqual(restored.map(a => a.id), [...stock, ...additions].map(a => a.id));
  for (const original of additions) {
    const fish = restored.find(a => a.id === original.id);
    assert.equal(fish.species, original.species);
    assert.equal(fish.seed, original.seed);
    assert.equal(fish.label, original.label);
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
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  assert.deepEqual((await readAnimals()).map(a => a.id), remainingIds);
  assert.deepEqual(errors, []);
  const report = { previews: previews.length, fishAdded: newSpecies, inspected: selected.label, restored: restored.length, removed: selected.label, remaining: remainingIds.length, errors };
  await writeFile('artifacts/smoke-species.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
