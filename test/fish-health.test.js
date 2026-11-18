import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceBehavior } from '../src/behavior.js';
import {
  advanceSimulation, careForFish, createInitialState, getAssessment,
  INFECTIONS, removeAnimal, restoreState,
} from '../src/simulation.js';

function reload(tank) {
  return restoreState(JSON.stringify(tank));
}

function cases(tank) {
  return tank.animals.filter(a => a.alive && a.infection);
}

function oneCase(tank) {
  tank.infectionClock.nextAtHours = tank.elapsedHours;
  advanceSimulation(tank, 1 / 12);
  const infected = cases(tank);
  assert.equal(infected.length, 1);
  return infected[0];
}

test('the first event occurs on the simulation clock and both infection types can affect different living fish', () => {
  const template = createInitialState();
  assert.ok(template.infectionClock.nextAtHours >= 5 && template.infectionClock.nextAtHours <= 10);
  advanceSimulation(template, 4);
  assert.equal(cases(template).length, 0);
  const expected = template.infectionClock.nextAtHours;
  advanceSimulation(template, expected - template.elapsedHours + .1);
  assert.equal(cases(template).length, 1);
  assert.ok(template.infectionClock.nextAtHours > template.elapsedHours);
  assert.notEqual(getAssessment(template).level, 'good');
  assert.ok(template.events.some(e => e.message.includes(INFECTIONS[cases(template)[0].infection.kind].label)));

  const eligible = createInitialState();
  const firstFish = eligible.animals[0];
  firstFish.alive = false;
  firstFish.health = 0;
  firstFish.corpseMass = firstFish.mass;
  const kinds = new Set(), targets = new Set();
  for (let sample = 1; sample <= 64; sample++) {
    const tank = reload(eligible);
    tank.infectionClock.seed = Math.imul(sample, 0x9e3779b9) >>> 0;
    const fish = oneCase(tank);
    assert.ok(['neon', 'guppy'].includes(fish.species));
    assert.notEqual(fish.id, firstFish.id);
    targets.add(fish.id);
    kinds.add(fish.infection.kind);
  }
  assert.deepEqual(kinds, new Set(['viral', 'bacterial']));
  assert.ok(targets.size > 1, 'events can pick different individuals');
});

test('saved pending and active infections resume with the same target, condition and next event', () => {
  const before = createInitialState();
  before.infectionClock.nextAtHours = 3;
  advanceSimulation(before, 2);
  const resumed = reload(before);
  advanceSimulation(before, 4);
  for (let i = 0; i < 48; i++) advanceSimulation(resumed, 1 / 12);
  const [first] = cases(before), [second] = cases(resumed);
  assert.ok(first && second);
  assert.equal(first.id, second.id);
  assert.equal(first.infection.kind, second.infection.kind);
  assert.ok(Math.abs(first.infection.severity - second.infection.severity) < 1e-9);
  assert.ok(Math.abs(first.health - second.health) < 1e-8);
  assert.deepEqual(before.infectionClock, resumed.infectionClock);
  resumed.paused = true;
  const paused = reload(resumed);
  const originalCase = structuredClone(second.infection);
  advanceBehavior(paused, 5);
  assert.equal(paused.paused, true);
  assert.deepEqual(cases(paused)[0].infection, originalCase);
  assert.deepEqual(paused.infectionClock, resumed.infectionClock);
});

test('legacy and damaged saves initialize a fresh event clock without infecting their fish on load', () => {
  const oldSave = { version: 1, elapsedHours: 42, animals: [{ species: 'neon', id: 'old-fish' }] };
  const migrated = restoreState(oldSave);
  assert.equal(migrated.animals[0].infection, null);
  assert.ok(migrated.infectionClock.nextAtHours >= 47 && migrated.infectionClock.nextAtHours <= 52);
  assert.deepEqual(restoreState(oldSave).infectionClock, migrated.infectionClock);

  const damaged = structuredClone(oldSave);
  damaged.infectionClock = { seed: -1, nextAtHours: Infinity };
  damaged.animals[0].infection = { kind: 'invalid', severity: .9 };
  const repaired = restoreState(damaged);
  assert.equal(repaired.animals[0].infection, null);
  assert.deepEqual(repaired.infectionClock, migrated.infectionClock);
});

test('care is individual, survives reopening and improves an infection over time', () => {
  const tank = createInitialState();
  const fish = oneCase(tank);
  const control = reload(tank);
  const healthy = tank.animals.find(a => a.id !== fish.id && a.alive);
  assert.equal(careForFish(tank, healthy.id).ok, false);
  assert.equal(careForFish(tank, 'missing').ok, false);
  assert.equal(careForFish(tank, fish.id).ok, true);
  assert.ok(fish.infection?.cared, 'starting care does not clear illness immediately');
  const afterFirstCare = JSON.stringify(tank);
  assert.equal(careForFish(tank, fish.id).ok, false);
  assert.equal(JSON.stringify(tank), afterFirstCare, 'a duplicate click has no additional effect');
  const treated = reload(tank);
  assert.deepEqual(cases(treated)[0].infection, fish.infection);
  let treatedHours, untreatedHours;
  for (let hour = 1; hour <= 20; hour++) {
    advanceSimulation(treated, 1);
    advanceSimulation(control, 1);
    if (treatedHours === undefined && !treated.animals.find(a => a.id === fish.id).infection) treatedHours = hour;
    if (untreatedHours === undefined && !control.animals.find(a => a.id === fish.id).infection) untreatedHours = hour;
    if (treatedHours && untreatedHours) break;
  }
  assert.ok(treatedHours && untreatedHours && treatedHours < untreatedHours);
  assert.ok(treated.animals.find(a => a.id === fish.id).alive && control.animals.find(a => a.id === fish.id).alive);
});

test('empty tanks, invertebrates and retained bodies cannot host a new infection', () => {
  const tank = createInitialState();
  const dead = tank.animals[0];
  dead.alive = false;
  dead.health = 0;
  dead.corpseMass = dead.mass;
  tank.animals = [dead, ...tank.animals.filter(a => ['snail','shrimp'].includes(a.species))];
  tank.infectionClock.nextAtHours = 0;
  advanceSimulation(tank, 1);
  assert.ok(tank.animals.every(a => !a.infection));
  assert.equal(careForFish(tank, dead.id).ok, false);
  tank.animals = [];
  advanceSimulation(tank, 24);
  assert.equal(tank.animals.length, 0);
});

test('a neglected mild infection can worsen, kill a weakened fish and leave a body for removal', () => {
  const tank = createInitialState();
  const fish = oneCase(tank);
  const kind = fish.infection.kind;
  const initialSeverity = fish.infection.severity;
  fish.hunger = 98;
  fish.health = 55;
  const treatedTank = reload(tank);
  const treatedFish = treatedTank.animals.find(a => a.id === fish.id);
  assert.equal(careForFish(treatedTank, fish.id).ok, true);
  advanceSimulation(tank, 4);
  advanceSimulation(treatedTank, 4);
  assert.ok(fish.infection.severity > initialSeverity);
  assert.equal(treatedFish.infection, null);
  for (let hour = 4; hour < 20 && fish.alive; hour++) {
    advanceSimulation(tank, 1);
    advanceSimulation(treatedTank, 1);
  }
  assert.equal(fish.alive, false);
  assert.ok(treatedFish.alive);
  assert.equal(fish.causeOfDeath, INFECTIONS[kind].label);
  assert.ok(fish.corpseMass > 0);
  assert.equal(careForFish(tank, fish.id).ok, false);
  const reopened = reload(tank);
  assert.equal(reopened.animals.find(a => a.id === fish.id).causeOfDeath, fish.causeOfDeath);
  assert.equal(removeAnimal(reopened, fish.id).ok, true);
  assert.ok(!reopened.animals.some(a => a.id === fish.id));
});
