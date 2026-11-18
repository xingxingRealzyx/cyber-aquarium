import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBehavior } from '../src/behavior.js';
import { createInitialState, advanceSimulation, addAnimal, addPlant, feed, changeWater, removeDead, getAssessment, restoreState, ammoniaFraction } from '../src/simulation.js';

const totalNitrogen = s => s.water.ammonia + s.water.nitrite + s.water.nitrate;

test('25% water change removes exactly 25% dissolved nitrogen and preserves the biofilter', () => {
  const s = createInitialState();
  s.water.ammonia = 2; s.water.nitrite = 1; s.water.nitrate = 20;
  const bacteria = { ...s.bacteria };
  changeWater(s, 0.25);
  assert.equal(s.water.ammonia, 1.5);
  assert.equal(s.water.nitrite, 0.75);
  assert.equal(s.water.nitrate, 15);
  assert.deepEqual(s.bacteria, bacteria);
});

test('nitrification conserves dissolved nitrogen in an isolated tank', () => {
  const s = createInitialState();
  s.animals = []; s.plants = []; s.food = 0; s.detritus = 0;
  s.water.ammonia = 2; s.water.nitrite = 0.5; s.water.nitrate = 3;
  const initial = totalNitrogen(s);
  advanceSimulation(s, 24);
  assert.ok(Math.abs(totalNitrogen(s) - initial) < 1e-10);
  assert.ok(s.water.ammonia < 2);
  assert.ok(s.water.nitrate > 3);
  assert.ok(s.alkalinity < 4);
});

test('unionized ammonia fraction rises with pH and temperature', () => {
  assert.ok(ammoniaFraction(25, 8) > ammoniaFraction(25, 7) * 8);
  assert.ok(ammoniaFraction(30, 7) > ammoniaFraction(20, 7));
  assert.ok(Math.abs(ammoniaFraction(25, 7) - 0.00564) < 0.0001);
});

test('mature starter tank stays healthy with small daily feeds and weekly water changes', () => {
  const s = createInitialState();
  for (let day = 0; day < 14; day++) {
    feed(s);
    // Feed must actually be reached before chemistry can advance through a day.
    for(let frame=0;frame<900;frame++) advanceBehavior(s,1/30);
    advanceSimulation(s, 24);
    if (day % 7 === 6) changeWater(s, 0.25);
  }
  assert.equal(s.animals.filter(a => a.alive).length, 12);
  assert.ok(s.animals.every(a => a.health > 95));
  assert.ok(s.water.ammonia < 0.1 && s.water.nitrite < 0.05);
  assert.ok(s.water.oxygen > 5);
  assert.equal(getAssessment(s).level, 'good');
  assert.equal(s.history.length, 168);
});

test('heavy overfeeding and loss of circulation cause low oxygen, mortality, and corpse decay', () => {
  const s = createInitialState();
  s.equipment.filter = false; s.equipment.aerator = false; s.equipment.light = false;
  feed(s, 5);
  advanceSimulation(s, 72);
  assert.ok(s.water.ammonia > 1);
  assert.ok(s.water.oxygen < 3);
  assert.ok(s.animals.some(a => !a.alive));
  assert.ok(s.animals.filter(a => !a.alive).every(a => a.deathHours > 0 && a.corpseMass > 0));
  assert.ok(s.events.some(e => e.type === 'death'));
  const deadCount = s.animals.filter(a => !a.alive).length;
  assert.equal(removeDead(s).count, deadCount);
  assert.ok(s.animals.every(a => a.alive));
});

test('long-term starvation kills fish instead of silently keeping them alive', () => {
  const s = createInitialState();
  advanceSimulation(s, 24 * 30);
  const fish = s.animals.filter(a => ['neon', 'guppy'].includes(a.species));
  assert.ok(fish.every(a => !a.alive));
  assert.ok(fish.some(a => a.causeOfDeath === '长期饥饿'));
});

test('nitrite toxicity damages fish even when water is clear and oxygenated', () => {
  const s = createInitialState();
  s.water.nitrite = 3;
  s.equipment.filter = false;
  advanceSimulation(s, 24);
  assert.ok(s.animals.some(a => !a.alive));
  assert.ok(s.water.oxygen > 5);
});

test('integration is stable for large and small caller steps', () => {
  const a = createInitialState();
  const b = restoreState(JSON.stringify(a));
  feed(a); feed(b);
  advanceSimulation(a, 12);
  for (let n = 0; n < 144; n++) advanceSimulation(b, 1 / 12);
  for (const name of Object.keys(a.water)) assert.ok(Math.abs(a.water[name] - b.water[name]) < 1e-9, name);
  assert.ok(Math.abs(a.elapsedHours - 12) < 1e-9);
});

test('invalid saves are sanitized without reviving dead fish or repopulating an empty tank', () => {
  assert.equal(restoreState('not-json').animals.length, 12);
  const s = restoreState({ version: 1, water: { temperature: null, ammonia: -9, oxygen: Infinity }, animals: [{ species: 'neon', health: 0, alive: false, seed: NaN }, { species: '__proto__' }, { species: 'guppy', id: 'same' }, { species: 'guppy', id: 'same' }], plants: [], food: 'wrong', equipment: { filter: false }, history: [{ time: 0, nitrate: NaN }] });
  assert.equal(s.water.temperature, 25);
  assert.equal(s.water.ammonia, 0);
  assert.equal(s.water.oxygen, 7.8);
  assert.equal(s.animals.length, 3);
  assert.equal(s.animals[0].alive, false);
  assert.notEqual(s.animals[1].id, s.animals[2].id);
  assert.equal(s.plants.length, 0);
  assert.equal(s.equipment.filter, false);
  assert.equal(s.food, 0);
  assert.ok(Number.isFinite(s.history[0].nitrate));
  assert.equal(restoreState({ version: 1, animals: [] }).animals.length, 0);
});

test('invalid actions do not mutate the tank, capacities are bounded', () => {
  const s = createInitialState();
  assert.equal(addAnimal(s, '__proto__').ok, false);
  assert.equal(addPlant(s, 'plastic').ok, false);
  assert.equal(feed(s, -1).ok, false);
  assert.equal(changeWater(s, NaN).ok, false);
  const hours = s.elapsedHours;
  advanceSimulation(s, NaN); advanceSimulation(s, -2);
  assert.equal(s.elapsedHours, hours);
  for (let n = 0; n < 100; n++) addAnimal(s, 'neon');
  assert.equal(s.animals.length, 80);
  assert.equal(addAnimal(s, 'neon').ok, false);
});

test('the 3600× UI speed survives a save and restore roundtrip', () => {
  const s = createInitialState();
  s.speed = 3600;
  s.paused = true;
  const restored = restoreState(JSON.stringify(s));
  assert.equal(restored.speed, 3600);
  assert.equal(restored.paused, true);
});
