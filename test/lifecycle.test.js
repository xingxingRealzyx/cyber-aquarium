import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBehavior } from '../src/behavior.js';
import {
  addAnimal, advanceSimulation, animalLifeStage, consumePellet, corpseDecay, createInitialState, feed,
  fishLifeStage, relativeAdultSize, removeAnimal, removeDead, restoreState, SPECIES,
} from '../src/simulation.js';

function emptyTank() {
  const tank = createInitialState();
  tank.animals = [];
  tank.infectionClock.nextAtHours = Number.MAX_SAFE_INTEGER;
  return tank;
}

function reload(tank) {
  return restoreState(JSON.stringify(tank));
}

test('stocked groups include breeding pairs and a selected sex persists in every species', () => {
  const tank = createInitialState();
  for (const species of ['neon', 'guppy', 'shrimp']) {
    const sexes = new Set(tank.animals.filter(a => a.species === species).map(a => a.sex));
    assert.deepEqual(sexes, new Set(['male', 'female']));
  }
  for (const species of Object.keys(SPECIES)) {
    for (const sex of ['male', 'female']) {
      const animal = addAnimal(tank, species, sex).animal;
      assert.equal(animal.sex, sex);
      assert.equal(animal.origin, 'stocked');
      assert.deepEqual(reload(tank).animals.at(-1), animal);
    }
  }
});

test('legacy invertebrates remain full-sized adults with stable sexes after migration', () => {
  const old = { version: 1, elapsedHours: 48, animals: ['shrimp', 'snail'].map(species => ({
    id: `old-${species}`, species, ageHours: 10, size: 1.07, mass: .24,
  })) };
  const migrated = restoreState(old);
  const sameSave = restoreState(old);
  for (const [i, a] of migrated.animals.entries()) {
    assert.equal(animalLifeStage(a), 'adult');
    assert.equal(a.sex, sameSave.animals[i].sex);
    assert.equal(a.size, 1.07);
    assert.equal(a.mass, .24);
    assert.equal(a.lifeAgeHours, SPECIES[a.species].maturityDays * 24 + 10);
    assert.deepEqual(reload(migrated).animals[i], a);
  }
});

test('all seven newborn body sizes survive reloading and grow gradually to reproductive maturity', () => {
  for (const [species, spec] of Object.entries(SPECIES)) {
    // A few minutes after birth. The state also supports children whose parents have since left.
    const originalSize = .32;
    const tank = restoreState({ version: 1, animals: [{
      id: `young-${species}`, species, origin: 'born', motherId: 'mother', fatherId: 'father',
      lifeAgeHours: 0, seed: .2, size: originalSize, mass: spec.mass * originalSize ** 3, hunger: 10,
    }] });
    tank.infectionClock.nextAtHours = Number.MAX_SAFE_INTEGER;
    const young = tank.animals[0];
    assert.equal(young.size, originalSize);
    assert.equal(young.mass, spec.mass * originalSize ** 3);
    assert.equal(animalLifeStage(young), 'juvenile');
    advanceSimulation(tank, 1 / 12);
    assert.ok(young.size > originalSize && young.size < originalSize * 1.04, `gradual first growth in ${species}`);
    const growing = reload(tank).animals[0];
    assert.deepEqual(growing, young);
    const maturity = spec.maturityDays * 24;
    advanceSimulation(tank, maturity / 2);
    const halfway = young.size;
    assert.ok(halfway > originalSize * 1.4);
    assert.equal(animalLifeStage(young), 'juvenile');
    advanceSimulation(tank, maturity / 2);
    assert.ok(young.size > halfway && young.mass > growing.mass && relativeAdultSize(young) >= .7);
    assert.equal(animalLifeStage(young), 'adult');
    assert.deepEqual([young.motherId, young.fatherId], ['mother', 'father']);
  }
});

test('stocked juveniles reach maturity within a play session, with distinct individual lifespans', () => {
  const tank = emptyTank();
  for (const [name, spec] of Object.entries(SPECIES).filter(([, spec]) => spec.type === 'fish')) {
    const { animal: fish } = addAnimal(tank, name);
    // At the default 60x speed, a simulation hour takes one minute of play.
    const minutesToMaturity = spec.maturityDays * 24 - fish.lifeAgeHours;
    assert.ok(minutesToMaturity >= 9.9 && minutesToMaturity <= 27, spec.name);
    const minutesToOldAgeDeath = fish.lifespanHours - fish.lifeAgeHours;
    assert.ok(minutesToOldAgeDeath >= 73 && minutesToOldAgeDeath <= 267, spec.name);
    if (name === 'guppy') assert.ok(minutesToOldAgeDeath <= 106);
    if (name === 'angelfish') assert.ok(minutesToOldAgeDeath >= 187);
  }
});

test('a regularly fed guppy grows visibly and completes its full life on the new clock', () => {
  const tank = emptyTank();
  const { animal: fish } = addAnimal(tank, 'guppy');
  const initialSize = fish.size;
  const initialAge = fish.lifeAgeHours;
  const stages = new Set();
  for (let hour = 0; hour < 108 && fish.alive; hour += 2) {
    if (hour % 12 === 0) {
      feed(tank, .012);
      advanceBehavior(tank, 30);
    }
    stages.add(fishLifeStage(fish));
    if (fishLifeStage(fish) === 'adult') assert.ok(fish.size > initialSize * 1.15);
    advanceSimulation(tank, 2);
  }
  assert.deepEqual([...stages], ['juvenile', 'adult', 'senior']);
  assert.ok(fish.bites > 0);
  assert.equal(fish.causeOfDeath, '自然衰老');
  assert.ok(Math.abs(fish.deathHours - (fish.lifespanHours - initialAge)) <= 1 / 12 + 1e-8);
});

test('a fed juvenile gains size and mass, and resumes growing from its saved state', () => {
  const tank = emptyTank();
  const fish = addAnimal(tank, 'guppy').animal;
  const unfed = reload(tank);
  unfed.animals[0].hunger = 98;
  const original = { size: fish.size, mass: fish.mass, age: fish.lifeAgeHours };
  assert.equal(fishLifeStage(fish), 'juvenile');
  fish.hunger = 55;
  fish.velocity = { x: 0, y: 0, z: 0 };
  feed(tank);
  const pellet = tank.foodPellets[0];
  fish.position = { x: pellet.x, y: pellet.y, z: pellet.z };
  assert.ok(consumePellet(tank, fish.id, pellet.id).ok);
  advanceSimulation(tank, 12);
  advanceSimulation(unfed, 12);
  assert.ok(fish.size > original.size && fish.mass > original.mass);
  assert.ok(fish.mass > unfed.animals[0].mass, 'a hungry juvenile gains less mass');
  assert.ok(Math.abs(fish.lifeAgeHours - original.age - 12) < 1e-7);
  const restored = reload(tank);
  advanceSimulation(restored, 3);
  advanceSimulation(tank, 3);
  const savedFish = restored.animals[0];
  for (const field of ['lifeAgeHours', 'lifespanHours', 'size', 'mass']) {
    assert.equal(savedFish[field], fish[field], field);
  }
});

test('fish mature and become seniors, then die of old age in healthy water', () => {
  const tank = emptyTank();
  const fish = addAnimal(tank, 'guppy').animal;
  const adulthood = SPECIES.guppy.maturityDays * 24;
  fish.lifeAgeHours = adulthood - .5;
  assert.equal(fishLifeStage(fish), 'juvenile');
  advanceSimulation(tank, 1);
  assert.equal(fishLifeStage(fish), 'adult');
  fish.lifeAgeHours = fish.lifespanHours * .8 - .5;
  advanceSimulation(tank, 1);
  assert.equal(fishLifeStage(fish), 'senior');
  fish.lifeAgeHours = fish.lifespanHours * .95;
  advanceSimulation(tank, 1);
  assert.ok(fish.alive && fish.health < 90, 'an older fish weakens before reaching the end of its lifespan');
  const poisoned = reload(tank);
  poisoned.water.nitrite = 12;
  advanceSimulation(poisoned, 4);
  assert.equal(poisoned.animals[0].causeOfDeath, '亚硝酸盐中毒', 'an earlier environmental death retains its cause');
  fish.lifeAgeHours = fish.lifespanHours - .5;
  assert.ok(fish.alive && tank.water.oxygen > 5 && fish.hunger < 75);
  advanceSimulation(tank, 1);
  assert.equal(tank.animals.length, 1);
  assert.equal(fish.alive, false);
  assert.equal(fish.causeOfDeath, '自然衰老');
  assert.ok(fish.corpseMass > 0 && fish.deathHours > 0);
  const ageAtDeath = fish.lifeAgeHours;
  advanceSimulation(tank, 12);
  assert.equal(fish.lifeAgeHours, ageAtDeath);
  assert.equal(tank.events.filter(e => e.type === 'death').length, 1);
  assert.equal(fishLifeStage(addAnimal(tank, 'snail').animal), null);
});

test('an established fish migrates without losing its former age, body, or remaining lifetime', () => {
  const resident = {
    id: 'legacy-guppy', species: 'guppy', seed: .35, ageHours: 100000,
    health: 89, hunger: 40, size: 1.08, mass: .78, totalEatenGrams: 1,
  };
  const tank = restoreState({ version: 1, elapsedHours: resident.ageHours, animals: [resident] });
  const fish = tank.animals[0];
  for (const key of ['id', 'ageHours', 'health', 'hunger', 'size', 'mass', 'totalEatenGrams']) {
    assert.equal(fish[key], resident[key], key);
  }
  assert.ok(fish.lifeAgeHours < fish.lifespanHours);
  advanceSimulation(tank, 24);
  assert.ok(fish.alive, 'long residence before the upgrade does not cause immediate old-age death');
  const restored = reload(tank).animals[0];
  assert.equal(restored.lifeAgeHours, fish.lifeAgeHours);
  assert.equal(restored.lifespanHours, fish.lifespanHours);
});

test('year-scale saves retain the progress in each life stage and keep existing remains', () => {
  const oldMaturity = 75 * 24;
  const oldLife = 900 * 24 * 1.08;
  const oldAges = [oldMaturity / 2, (oldMaturity + oldLife * .8) / 2, oldLife * .9, oldLife];
  const residents = oldAges.map((lifeAgeHours, i) => ({
    id: `old-${i}`, species: 'guppy', seed: .35, ageHours: 180, health: i === 3 ? 0 : 75,
    alive: i !== 3, hunger: 40, size: .96, mass: .6, lifeAgeHours, lifespanHours: oldLife,
    ...(i === 3 && { deathHours: 190, corpseMass: .31, causeOfDeath: '自然衰老' }),
  }));
  const tank = restoreState({ version: 1, elapsedHours: 200, animals: residents });
  const maturity = SPECIES.guppy.maturityDays * 24;
  const life = SPECIES.guppy.lifespanDays * 24 * 1.08;
  const expectedAges = [maturity / 2, (maturity + life * .8) / 2, life * .9, life];
  const stages = ['juvenile', 'adult', 'senior', 'senior'];
  const again = reload(tank);
  for (const [i, fish] of tank.animals.entries()) {
    assert.equal(fishLifeStage(fish), stages[i]);
    assert.ok(Math.abs(fish.lifeAgeHours - expectedAges[i]) < 1e-9);
    assert.ok(Math.abs(fish.lifespanHours - life) < 1e-9);
    for (const key of ['alive', 'health', 'size', 'mass', 'ageHours']) assert.equal(fish[key], residents[i][key]);
    assert.equal(again.animals[i].lifeAgeHours, fish.lifeAgeHours);
    assert.equal(again.animals[i].lifespanHours, fish.lifespanHours);
  }
  const remains = again.animals[3];
  for (const key of ['deathHours', 'corpseMass', 'causeOfDeath']) assert.equal(remains[key], residents[3][key]);
});

test('a dead fish rises over time, stays at the surface, and can be netted after reloading', () => {
  const tank = restoreState({
    version: 1, paused: true, elapsedHours: 32,
    animals: [
      { id: 'fish', species: 'neon', alive: false, mass: .4, corpseMass: .3, deathHours: 20,
        causeOfDeath: '缺氧', position: { x: 0, y: 1.6, z: 0 } },
      { id: 'shrimp', species: 'shrimp', alive: false, position: { x: 0, y: .45, z: 0 } },
    ],
  });
  const [fish, shrimp] = tank.animals;
  advanceBehavior(tank, 8);
  assert.equal(fish.position.y, 1.6, 'a paused tank keeps the body in place');
  tank.paused = false;
  advanceBehavior(tank, 1);
  assert.ok(fish.position.y > 1.6 && fish.position.y < 2);
  advanceBehavior(tank, 30);
  advanceBehavior(tank, 30);
  assert.ok(fish.position.y > 3.7 && fish.position.y < 4.14);
  assert.equal(fish.behavior, 'dead');
  assert.equal(fish.targetFoodId, null);
  assert.ok(shrimp.position.y < 1, 'a bottom-dwelling animal stays near the bed');

  const restored = reload(tank);
  assert.deepEqual(restored.animals[0].position, fish.position);
  advanceBehavior(restored, 30);
  assert.ok(restored.animals[0].position.y > 3.7);
  assert.equal(restored.animals[0].causeOfDeath, '缺氧');
  assert.equal(removeAnimal(restored, fish.id).ok, true);
  assert.deepEqual(reload(restored).animals.map(a => a.id), [shrimp.id]);
});

test('rotting tissue adds ammonia and consumes oxygen until the body is netted', () => {
  const tank = restoreState({
    version: 1, plants: [], detritus: 0, equipment: { filter: false, aerator: false },
    animals: [{ id: 'body', species: 'angelfish', alive: false, mass: 1, corpseMass: 1 }],
  });
  const clean = reload(tank);
  removeDead(clean);
  const body = tank.animals[0];
  assert.equal(corpseDecay(body), 0);
  advanceSimulation(tank, 12);
  advanceSimulation(clean, 12);
  assert.ok(body.corpseMass > 0 && body.corpseMass < 1);
  assert.ok(corpseDecay(body) > 0 && corpseDecay(body) < 1);
  assert.ok(tank.water.ammonia > clean.water.ammonia);
  assert.ok(tank.water.oxygen < clean.water.oxygen);

  const netted = reload(tank);
  const before = { ...netted.water };
  assert.equal(removeAnimal(netted, body.id).ok, true);
  assert.deepEqual(netted.water, before, 'netting does not remove already dissolved pollutants');
  advanceSimulation(tank, 6);
  advanceSimulation(netted, 6);
  assert.ok(tank.water.ammonia > netted.water.ammonia);
  assert.ok(tank.water.oxygen < netted.water.oxygen);

  advanceSimulation(tank, 24 * 30);
  assert.ok(corpseDecay(body) > .99);
  const remains = reload(tank).animals[0];
  assert.equal(remains.id, body.id);
  assert.equal(remains.alive, false);
  assert.equal(remains.corpseMass, body.corpseMass);
  body.corpseMass = 0;
  assert.equal(corpseDecay(reload(tank).animals[0]), 1, 'exhausted tissue must not regenerate on reload');
  assert.equal(removeDead(tank).count, 1);
  assert.equal(reload(tank).animals.length, 0);
});
