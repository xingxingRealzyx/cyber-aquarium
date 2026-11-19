import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback } from '../src/playback.js';
import {
  createInitialState, advanceSimulation, feed, changeWater, getAssessment, restoreState, ammoniaFraction,
  addAnimal, removeAnimal, removeDead, addPlant, removePlant, addHardscape, removeHardscape, MAX_HARDSCAPE,
  addToy, removeToy, MAX_TOYS, TOYS,
} from '../src/simulation.js';

const totalNitrogen = s => s.water.ammonia + s.water.nitrite + s.water.nitrate;

test('reloading preserves a fish sculling beside the glass outside its usual cruising band', () => {
  const state = createInitialState();
  const fish = state.animals[0];
  fish.position = { x: 3.67, y: 2.3, z: -1.70 };
  fish.velocity = { x: -.21, y: .03, z: .09 };
  const restored = restoreState(JSON.stringify(state)).animals[0];
  assert.deepEqual(restored.position, fish.position);
  assert.deepEqual(restored.velocity, fish.velocity);
  fish.position = { x: 40, y: -5, z: -20 };
  assert.deepEqual(restoreState(state).animals[0].position, { x: 3.65, y: .15, z: -1.65 });
});

test('legacy aquascapes retain their planted beds and original stone and driftwood layout', () => {
  const legacy = createInitialState();
  delete legacy.hardscape;
  for (const p of legacy.plants) delete p.slot;
  const state = restoreState(legacy);
  assert.deepEqual(state.plants.map(p => p.slot), [0,1,2,3,0,1,2,0,1]);
  assert.equal(state.hardscape.filter(item => item.kind === 'stone').length, 12);
  assert.equal(state.hardscape.filter(item => item.kind === 'wood').length, 5);
  const plantId = state.plants[1].id;
  const stoneId = state.hardscape[2].id;
  const remainingPlants = state.plants.filter(p => p.id !== plantId);
  const remainingScenery = state.hardscape.filter(item => item.id !== stoneId);
  assert.equal(removePlant(state, plantId).ok, true);
  assert.equal(removeHardscape(state, stoneId).ok, true);
  const restored = restoreState(JSON.stringify(state));
  assert.deepEqual(restored.plants, remainingPlants);
  assert.deepEqual(restored.hardscape, remainingScenery);
  assert.equal(addPlant(restored, 'vallisneria').plant.slot, 1);
  assert.equal(addHardscape(restored, 'stone').item.slot, 2);
  for (const item of [...restored.hardscape]) removeHardscape(restored, item.id);
  for (const p of [...restored.plants]) removePlant(restored, p.id);
  const empty = restoreState(JSON.stringify(restored));
  assert.deepEqual(empty.hardscape, []);
  assert.deepEqual(empty.plants, []);
  assert.equal(addHardscape(empty, 'wood').item.slot, 0);
});

test('unknown, duplicate and out-of-range scenery entries are sanitized on load', () => {
  const state = restoreState({ version: 1, hardscape: [
    {kind:'wood',id:'piece',slot:2}, {kind:'wood',id:'piece',slot:2},
    {kind:'stone',id:'',slot:1e8}, {kind:'__proto__'}, null,
  ]});
  assert.deepEqual(state.hardscape.map(item => item.slot), [2,0,0]);
  assert.equal(new Set(state.hardscape.map(item => item.id)).size, 3);
  assert.equal(addHardscape(state, '__proto__').ok, false);
  assert.equal(removeHardscape(state, 'missing').ok, false);
  while (state.hardscape.length < MAX_HARDSCAPE) assert.equal(addHardscape(state, 'stone').ok, true);
  assert.equal(addHardscape(state, 'wood').ok, false);
});

test('floating toys keep their individual slots and current phase across saves', () => {
  const state = restoreState({ version: 1, behaviorSeconds: 72.5 });
  assert.deepEqual(state.toys, []);
  assert.equal(state.currentSeconds, 72.5);
  const first = addToy(state, 'duck').item;
  const second = addToy(state, 'duck').item;
  const diver = addToy(state, 'diver').item;
  assert.deepEqual([first.slot, second.slot, diver.slot], [0, 1, 0]);
  assert.equal(removeToy(state, first.id).ok, true);
  const replacement = addToy(state, 'duck').item;
  assert.equal(replacement.slot, 0);
  assert.notEqual(replacement.id, first.id);
  state.currentSeconds = 36.75;
  const restored = restoreState(JSON.stringify(state));
  assert.deepEqual(restored.toys, [second, diver, replacement]);
  assert.equal(restored.currentSeconds, 36.75);
  for (const item of [...restored.toys]) assert.equal(removeToy(restored, item.id).ok, true);
  assert.deepEqual(restoreState(JSON.stringify(restored)).toys, []);
});

test('invalid or excess toys cannot exceed capacity or reuse an occupied slot', () => {
  const toys = [
    { kind: ['duck'] }, { kind: '__proto__' }, null,
    { kind: 'diver', id: 'suit', slot: 1 }, { kind: 'diver', id: 'suit', slot: 1 },
    ...Array.from({ length: MAX_TOYS }, () => ({ kind: 'duck', slot: -1 })),
  ];
  const state = restoreState({ version: 1, toys });
  assert.equal(state.toys.length, MAX_TOYS);
  assert.equal(new Set(state.toys.map(toy => toy.id)).size, MAX_TOYS);
  assert.equal(new Set(state.toys.map(toy => `${toy.kind}/${toy.slot}`)).size, MAX_TOYS);
  assert.equal(addToy(state, 'duck').ok, false);
  assert.equal(removeToy(state, 'missing').ok, false);
  assert.equal(removeToy(state, 'suit').ok, true);
  assert.equal(addToy(state, 'stone').ok, false);
  assert.equal(addToy(state, 'diver').item.slot, 1);
});

test('swim rings get individual colors on placement and keep them after a reload', t => {
  const state = createInitialState();
  const colors = Object.keys(TOYS.swimRing.colors);
  const random = t.mock.method(Math, 'random', () => 0);
  const first = addToy(state, 'swimRing').item;
  random.mock.mockImplementation(() => .9999);
  const second = addToy(state, 'swimRing').item;
  random.mock.restore();
  assert.equal(first.color, colors[0]);
  assert.equal(second.color, colors.at(-1));
  assert.notEqual(first.color, second.color);
  assert.deepEqual(restoreState(JSON.stringify(state)).toys, [first, second]);
});

test('author swimmers keep individual placement times across save, reopen and removal', () => {
  const state = createInitialState();
  state.behaviorSeconds = 14.25;
  const first = addToy(state, 'author').item;
  state.behaviorSeconds += 50;
  const second = addToy(state, 'author').item;
  assert.equal(first.placedAtSeconds, 14.25);
  assert.equal(second.placedAtSeconds, 64.25);
  const reopened = restoreState(JSON.stringify(state));
  assert.deepEqual(reopened.toys, [first, second]);
  assert.equal(removeToy(reopened, first.id).ok, true);
  assert.deepEqual(reopened.toys, [second]);
});

test('mixed ducks and rings keep distinct water-surface slots when others are removed', () => {
  const state = createInitialState();
  const surfaceSlot = item => item.surfaceSlot ?? item.slot;
  for (let i = 0; i < MAX_TOYS; i++) addToy(state, i % 2 ? 'swimRing' : 'duck');
  assert.equal(new Set(state.toys.map(surfaceSlot)).size, MAX_TOYS);
  assert.deepEqual(state.toys.slice(0, 2).map(item => item.slot), [0, 0]);
  assert.equal(addToy(state, 'swimRing').ok, false);
  const vacated = state.toys[2];
  removeToy(state, vacated.id);
  const restored = restoreState(JSON.stringify(state));
  assert.deepEqual(restored.toys, state.toys);
  assert.equal(surfaceSlot(addToy(restored, 'swimRing').item), surfaceSlot(vacated));
});

test('loading repairs invalid ring colors and surface slots deterministically', () => {
  const toys = [
    {kind:'duck', id:'old-duck', slot:0},
    {kind:'diver', id:'diver', slot:0, color:'#ff0000', surfaceSlot:9},
    {kind:'swimRing', id:'a', slot:0, color:['#ef684e'], surfaceSlot:0},
    {kind:'swimRing', id:'b', slot:1, surfaceSlot:99},
    {kind:'swimRing', id:'c', slot:2, color:'#369CD9'},
  ];
  const load = () => restoreState({version:1, toys}).toys;
  const repaired = load();
  assert.deepEqual(repaired, load());
  assert.deepEqual(repaired[0], toys[0]);
  assert.deepEqual(repaired[1], {kind:'diver', id:'diver', slot:0});
  assert.equal(repaired[4].color, '#369cd9');
  for (const ring of repaired.slice(2)) assert.ok(Object.hasOwn(TOYS.swimRing.colors, ring.color));
  const surface = repaired.filter(item => item.kind !== 'diver');
  assert.equal(new Set(surface.map(item => item.surfaceSlot ?? item.slot)).size, surface.length);
});

test('removing an individual preserves its tankmates and survives a reload', () => {
  const state = createInitialState();
  const fish = addAnimal(state, 'neon').animal;
  const otherFish = addAnimal(state, 'neon').animal;
  const remaining = state.animals.filter(animal => animal.id !== fish.id);
  assert.equal(removeAnimal(state, fish.id).ok, true);
  assert.deepEqual(state.animals, remaining);
  assert.ok(state.events[0].message.includes(fish.label));
  const saved = JSON.stringify(state);
  assert.equal(removeAnimal(state, fish.id).ok, false);
  assert.equal(JSON.stringify(state), saved);
  const restored = restoreState(saved);
  assert.deepEqual(restored.animals.map(a => a.id), remaining.map(a => a.id));
  assert.equal(addAnimal(restored, 'neon').animal.serial, otherFish.serial + 1);
  for (const animal of [...restored.animals]) removeAnimal(restored, animal.id);
  assert.deepEqual(restoreState(JSON.stringify(restored)).animals, []);
});

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

test('a mature biofilter sustains the starter bioload with daily feeds and weekly water changes', t => {
  let seed = 42;
  t.mock.method(Math, 'random', () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2**32;
  });
  const s = createInitialState();
  s.speed = 3600;
  // Keep the same bioload for the two-week water-quality comparison.
  for (const animal of s.animals) {
    animal.sex = 'female';
    if (animal.lifespanHours) animal.lifespanHours = 24 * 30;
  }
  s.infectionClock.nextAtHours = Number.MAX_SAFE_INTEGER;
  for (let day = 0; day < 14; day++) {
    feed(s);
    // Give the daily ration and the biofilter the same 24 tank hours.
    for (let hour = 0; hour < 24; hour++) advancePlayback(s, 1, () => null);
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
  // The longest-lived species has enough time to starve before it reaches old age.
  s.infectionClock.nextAtHours = Number.MAX_SAFE_INTEGER;
  const { animal: angel } = addAnimal(s, 'angelfish');
  advanceSimulation(s, 24 * 30);
  assert.equal(angel.causeOfDeath, '长期饥饿');
  const fish = s.animals.filter(a => ['neon', 'guppy'].includes(a.species));
  assert.ok(fish.every(a => !a.alive));
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
  assert.equal(s.animals.length, 40);
  assert.equal(addAnimal(s, 'neon').ok, false);
  for (const a of s.animals) { a.alive = false; a.health = 0; }
  for (let n = 0; n < 100; n++) addAnimal(s, 'neon');
  assert.equal(s.animals.length, 80, 'retained bodies still need a physical slot');
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
