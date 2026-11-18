import { chromium } from 'playwright';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';

// Uses a fresh browser context: never reads or writes the installed aquarium save.
const url = process.env.AQUARIUM_URL || 'http://127.0.0.1:5178/';
const saveKey = 'chengjing.aquarium.v1';
const hungryId = 'smoke-hungry-neon';
const fullId = 'smoke-full-guppy';
let executablePath;
for (const candidate of [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(homedir(),'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium')].filter(Boolean)) {
  try { await access(candidate); executablePath = candidate; break; } catch { /* Try the next locally installed browser. */ }
}
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1040, height: 760 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.aquariumDiagnostics);

async function clickSwimmingFish(id) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const point = await page.evaluate(id => window.aquariumDiagnostics.screenAnimals.find(animal => animal.id === id && animal.visible), id);
    if (point) {
      await page.mouse.click(point.x, point.y, { delay: 5 });
      try {
        await page.waitForFunction(id => window.aquariumDiagnostics.selectedId === id, id, { timeout: 350 });
        return;
      } catch { /* A moving fish may have crossed the sampled ray. Retry its new position. */ }
    } else {
      await page.waitForTimeout(100);
    }
  }
  throw new Error(`Could not select swimming fish ${id} by its projected on-screen position`);
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  const fixture = await page.evaluate(async ({ hungryId, fullId }) => {
    const { createInitialState } = await import('/src/simulation.js');
    const state = createInitialState();
    const hungry = state.animals.find(animal => animal.species === 'neon');
    const full = state.animals.find(animal => animal.species === 'guppy');
    Object.assign(hungry, { id: hungryId, label: '追食测试灯鱼', seed: 0.17, hunger: 85, health: 100, position: { x: -2, y: 1.8, z: 0.4 }, velocity: { x: 0, y: 0, z: 0 }, totalEatenGrams: 0, bites: 0, lastMealHours: null });
    Object.assign(full, { id: fullId, label: '饱腹测试孔雀鱼', seed: 0.73, hunger: 5, health: 100, position: { x: 2, y: 1.8, z: 0.4 }, velocity: { x: 0, y: 0, z: 0 }, totalEatenGrams: 0, bites: 0, lastMealHours: null });
    state.animals = [hungry, full];
    state.plants = [];
    state.food = 0;
    state.foodPellets = [];
    state.speed = 1;
    state.paused = false;
    return state;
  }, { hungryId, fullId });
  await page.addInitScript(({ fixture, saveKey }) => {
    // Runs after beforeunload has saved the outgoing page and before app startup.
    if (!sessionStorage.getItem('smoke-feeding-seeded')) {
      localStorage.setItem(saveKey, JSON.stringify(fixture));
      sessionStorage.setItem('smoke-feeding-seeded', 'true');
    }
    let seed = 2036;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }, { fixture, saveKey });
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.screenAnimals?.length === 2 && window.aquariumDiagnostics.stats.fps > 0);
  const initial = await snapshot();
  assert.equal(initial.state.animals.length, 2);
  assert.equal(initial.state.foodPellets.length, 0);
  assert.equal(await page.locator('#error').isVisible(), false);

  // Select a live, moving model instead of using the residents-list shortcut.
  await clickSwimmingFish(hungryId);
  assert.equal(await page.locator('#inspector').getAttribute('data-animal-id'), hungryId);
  const detail = await page.locator('#inspector').innerText();
  assert.match(detail, /健康/);
  assert.match(detail, /饥饿/);
  assert.match(detail, /代谢/);
  assert.match(detail, /上次进食/);
  assert.match(detail, /体重|质量/);

  await page.evaluate(({ hungryId, fullId }) => {
    window.__feedingTrace = [];
    window.__traceFeeding = true;
    const xyz = point => Array.isArray(point) ? point : [point?.x || 0, point?.y || 0, point?.z || 0];
    function sample() {
      if (!window.__traceFeeding) return;
      const state = window.aquariumDiagnostics.state;
      const pellets = state.foodPellets || [];
      const animals = [hungryId, fullId].map(id => {
        const animal = state.animals.find(candidate => candidate.id === id);
        const position = xyz(animal.position);
        return {
          id, hunger: animal.hunger, bites: animal.bites || 0, eaten: animal.totalEatenGrams || 0,
          behavior: animal.behavior, position,
          nearest: pellets.length ? Math.min(...pellets.map(pellet => Math.hypot(position[0] - pellet.x, position[1] - pellet.y, position[2] - pellet.z))) : null,
        };
      });
      window.__feedingTrace.push({ time: performance.now(), pelletCount: pellets.length, food: state.food, animals });
      if (window.__feedingTrace.length < 7000) requestAnimationFrame(sample);
    }
    sample();
  }, { hungryId, fullId });
  await page.mouse.move(500, 400);
  await page.getByRole('button', { name: '投喂', exact: true }).click();
  await page.waitForFunction(() => window.aquariumDiagnostics.state.foodPellets.length > 0, null, { timeout: 2000 });
  const afterFeed = await snapshot();
  const hungryAfterFeed = afterFeed.state.animals.find(animal => animal.id === hungryId);
  assert.equal(hungryAfterFeed.bites || 0, 0, 'food must not be consumed remotely at the moment of feeding');
  assert.ok(hungryAfterFeed.hunger >= 84.99, 'feeding alone must not reduce hunger');
  assert.ok(afterFeed.state.food > 0, 'food button creates finite food mass');
  await page.waitForFunction(id => window.aquariumDiagnostics.state.animals.find(animal => animal.id === id).behavior === 'seeking', hungryId, { timeout: 4000 });
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/feeding-pursuit.png', omitBackground: true });
  await page.waitForFunction(id => (window.aquariumDiagnostics.state.animals.find(animal => animal.id === id).bites || 0) > 0, hungryId, { timeout: 25000 });
  const afterBite = await snapshot();
  const hungryAfterBite = afterBite.state.animals.find(animal => animal.id === hungryId);
  const fullAfterBite = afterBite.state.animals.find(animal => animal.id === fullId);
  assert.ok(hungryAfterBite.hunger < 85, 'an observed bite reduces individual hunger');
  assert.ok(hungryAfterBite.totalEatenGrams > 0, 'intake is attributed to the fish that reached food');
  assert.ok(hungryAfterBite.lastMealHours !== null, 'the individual last-meal clock is recorded');
  assert.equal(fullAfterBite.bites || 0, 0, 'a satiated fish should not win food by global distribution');
  assert.ok(fullAfterBite.hunger >= 4.99, 'the satiated fish does not receive food remotely');
  await page.evaluate(() => { window.__traceFeeding = false; });
  const trace = await page.evaluate(() => window.__feedingTrace);
  const seeking = trace.filter(frame => frame.animals[0].behavior === 'seeking' && frame.animals[0].bites === 0);
  assert.ok(seeking.length >= 2, 'pursuit occurs over visible frames before eating');
  assert.ok(seeking.every(frame => frame.animals[0].hunger >= 84.99), 'hunger stays unreduced throughout pursuit');
  assert.ok(seeking.at(-1).animals[0].nearest < seeking[0].animals[0].nearest, 'the hungry fish closes its distance to food');
  const firstBiteIndex = trace.findIndex(frame => frame.animals[0].bites > 0);
  assert.ok(firstBiteIndex > 0, 'the trace captures a bite after pursuit');
  assert.ok(trace[firstBiteIndex - 1].animals[0].nearest < 0.8, 'food intake follows close physical contact');

  // beforeunload performs the normal save, then startup restores that same tank.
  const saved = await snapshot();
  assert.ok(saved.state.foodPellets.length > 0, 'remaining food is available for the save regression');
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  const restored = await snapshot();
  for (const id of [hungryId, fullId]) {
    const before = saved.state.animals.find(animal => animal.id === id);
    const after = restored.state.animals.find(animal => animal.id === id);
    assert.ok(after, `individual ${id} survives reload`);
    assert.equal(after.label, before.label);
    assert.equal(after.mass, before.mass);
    assert.equal(after.size, before.size);
    assert.equal(after.metabolism, before.metabolism);
    assert.ok((after.totalEatenGrams || 0) >= (before.totalEatenGrams || 0));
    assert.ok((after.bites || 0) >= (before.bites || 0));
  }
  assert.ok(restored.state.foodPellets.length > 0, 'remaining visible food survives reload');
  assert.ok(restored.state.food > 0, 'remaining food mass survives reload');
  await clickSwimmingFish(hungryId);
  assert.equal(await page.locator('#inspector').getAttribute('data-animal-id'), hungryId);
  await page.screenshot({ path: 'artifacts/feeding-individual.png', omitBackground: true });

  const bottomFixture = await page.evaluate(async () => {
    const { createInitialState, feed } = await import('/src/simulation.js');
    const { advanceBehavior } = await import('/src/behavior.js');
    const tank = createInitialState();
    tank.animals = [];
    // Fill all 160 slots a v0.6.1 tank could have, then let those five portions settle.
    for (let i = 0; i < 5; i++) feed(tank);
    advanceBehavior(tank, 30);
    advanceBehavior(tank, 15);
    // Another 160 pellets are still in midwater when the next burst enters.
    for (let i = 0; i < 5; i++) feed(tank);
    advanceBehavior(tank, 8);
    tank.paused = true;
    return tank;
  });
  const bedGrains = bottomFixture.foodPellets.filter(p => p.y < 1);
  assert.equal(bedGrains.length, 160);
  assert.equal(bottomFixture.foodPellets.filter(p => p.y > 2 && p.y < 3.5).length, 160);
  await page.addInitScript(({ saveKey, bottomFixture }) => {
    if (!sessionStorage.getItem('smoke-bottom-seeded')) {
      localStorage.setItem(saveKey, JSON.stringify(bottomFixture));
      sessionStorage.setItem('smoke-bottom-seeded', 'true');
    }
  }, { saveKey, bottomFixture });
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  await page.mouse.move(500, 400);
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '投喂', exact: true }).click();
  const afterBurst = (await snapshot()).state;
  function verifyBottomFeed(tank) {
    const byId = new Map(tank.foodPellets.map(p => [p.id, p]));
    for (const old of bottomFixture.foodPellets) {
      assert.deepEqual(byId.get(old.id), old, 'fresh feeds leave the existing bed and midwater grains in place while paused');
    }
    assert.ok(tank.foodPellets.some(p => p.y > 3.8), 'fresh food enters at the surface');
    assert.ok(Math.abs(tank.food - bottomFixture.food - .08 * 12) < 1e-8, 'all repeated feeds are accounted for');
  }
  verifyBottomFeed(afterBurst);
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  verifyBottomFeed((await snapshot()).state);

  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.aquariumDiagnostics.state.paused);
  await page.mouse.move(500, 400);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '投喂', exact: true }).click();

  const existingIds = new Set(bottomFixture.foodPellets.map(p => p.id));
  const start = (await snapshot()).state;
  assert.ok(start.food > afterBurst.food + .31, 'the four live clicks add four portions, allowing for natural decay');
  const incoming = start.foodPellets.filter(p => !existingIds.has(p.id) && p.y > 3.5);
  assert.ok(incoming.length > 0, 'repeated live clicks leave recently released food visible');
  const heights = new Map(incoming.map(p => [p.id, p.y]));
  const descent = [];
  let previousTime = start.behaviorSeconds;
  for (let interval = 0; interval < 2; interval++) {
    await page.waitForFunction(time => window.aquariumDiagnostics.state.behaviorSeconds >= time, previousTime + 2);
    const state = (await snapshot()).state;
    const elapsed = state.behaviorSeconds - previousTime;
    const tracked = state.foodPellets.filter(p => heights.has(p.id));
    assert.ok(tracked.length > 0, 'newly fed grains remain visible in the crowded water column');
    for (const p of tracked) {
      assert.ok(heights.get(p.id) - p.y > elapsed * .08, 'each tracked grain must descend between samples even with a full midwater layer');
      heights.set(p.id, p.y);
    }
    for (const old of bedGrains) {
      const bed = state.foodPellets.find(p => p.id === old.id);
      assert.deepEqual(bed && [bed.x, bed.y, bed.z], [old.x, old.y, old.z], 'the original bed survives live repeated feeding');
    }
    descent.push({ seconds: state.behaviorSeconds - start.behaviorSeconds, tracked: tracked.length, highest: Math.max(...tracked.map(p => p.y)) });
    previousTime = state.behaviorSeconds;
  }
  assert.deepEqual(errors, [], 'no JavaScript, resource or shader errors');
  const report = {
    passed: true,
    checks: ['click a swimming fish', 'individual detailed parameters', 'visible food emitted by feed button', 'no remote hunger reduction', 'hungry fish visibly pursues food', 'contact precedes a bite', 'only eater receives nutrition', 'individuals and remaining food survive reload', 'settled pellets keep their IDs and positions after repeated feeds and reload', 'newly fed grains descend continuously past a full midwater layer'],
    descent,
    pursuitFrames: seeking.length,
    hungry: { hungerBefore: 85, hungerAfter: hungryAfterBite.hunger, bites: hungryAfterBite.bites, eatenGrams: hungryAfterBite.totalEatenGrams },
    satiated: { hunger: fullAfterBite.hunger, bites: fullAfterBite.bites || 0 },
    stats: restored.stats,
    errors,
  };
  await writeFile('artifacts/smoke-feeding.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/feeding-failure.png', omitBackground: true }).catch(() => {});
  await writeFile('artifacts/feeding-failure.json', JSON.stringify({ message: error.message, errors, diagnostics: await snapshot().catch(() => null), trace: await page.evaluate(() => window.__feedingTrace).catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
