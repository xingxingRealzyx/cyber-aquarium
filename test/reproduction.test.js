import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Texture, TextureLoader } from 'three';
import {
  addAnimal, advanceSimulation, animalLifeStage, availableAnimalSlots, createInitialState, feed,
  removeAnimal, removePlant, restoreState, SPECIES,
} from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';
import { REPRODUCTION } from '../src/reproduction.js';
import { createAquaticPlants } from '../src/aquatic-plants.js';
import { createBroodDisplay } from '../src/brood-model.js';

function pairTank(species) {
  const s = createInitialState();
  s.animals = [];
  s.infectionClock.nextAtHours = 39;
  const [min, max] = SPECIES[species].temperature;
  s.water.temperature = s.equipment.targetTemperature = Math.min(max, Math.max(min, s.water.temperature));
  const mother = addAnimal(s, species, 'female').animal;
  const father = addAnimal(s, species, 'male').animal;
  for (const a of s.animals) {
    a.lifeAgeHours = SPECIES[species].maturityDays * 24 + 1;
    a.hunger = 12;
  }
  return { s, mother, father };
}

for (const [species, profile] of Object.entries(REPRODUCTION)) {
  test(`${species} produces its own kind of young and resumes its brood exactly once`, () => {
    const { s, mother, father } = pairTank(species);
    advanceSimulation(s, 2.01);
    const [brood] = s.broods;
    assert.ok(brood);
    assert.equal(brood.motherId, mother.id);
    assert.equal(brood.fatherId, father.id);
    assert.equal(brood.species, species);
    assert.equal(brood.count, profile.young);
    assert.equal(brood.dueAtHours - brood.startedAtHours, profile.hours);
    if (['leaf', 'guarded'].includes(profile.kind)) assert.ok(s.plants.some(p => p.id === brood.plantId));
    if (profile.kind === 'plant') assert.ok(s.plants.some(p => p.id === brood.plantId && p.species === 'moss'));
    if (profile.kind === 'capsule') assert.equal(Math.abs(brood.position.z), 1.96);
    assert.ok(s.events.some(e => e.message.includes(profile.label)));
    advanceSimulation(s, profile.hours - .02);
    assert.equal(s.animals.length, 2);
    const resumed = restoreState(JSON.stringify(s));
    assert.deepEqual(resumed.broods, s.broods);
    for (const tank of [s, resumed]) {
      advanceSimulation(tank, .03);
      assert.deepEqual(tank.broods, []);
      const young = tank.animals.filter(a => a.origin === 'born');
      assert.equal(young.length, brood.count);
      for (const a of young) {
        assert.equal(a.motherId, mother.id);
        assert.equal(a.fatherId, father.id);
        assert.equal(a.species, species);
        assert.ok(['female', 'male'].includes(a.sex));
        assert.equal(animalLifeStage(a), 'juvenile');
        assert.ok(a.size < mother.size * .65);
      }
      assert.equal(new Set(tank.animals.map(a => a.id)).size, tank.animals.length);
    }
    assert.deepEqual(s.animals.map(a => a.id), resumed.animals.map(a => a.id));
    const bornSave = restoreState(JSON.stringify(resumed));
    advanceSimulation(bornSave, 1);
    assert.equal(bornSave.animals.length, resumed.animals.length);
    assert.equal(bornSave.broods.length, 0);
    assert.equal(bornSave.animals[0].nextBreedHours, mother.nextBreedHours);
  });
}

test('pairing requires healthy adults of opposite sexes and the same species in suitable water', () => {
  const changes = [
    ({ father }) => { father.sex = 'female'; },
    ({ father }) => { father.species = 'zebra'; },
    ({ father }) => { father.alive = false; father.health = 0; },
    ({ father }) => { father.health = 40; },
    ({ father }) => { father.hunger = 95; },
    ({ father }) => { father.lifeAgeHours = 0; },
    ({ father }) => { father.lifeAgeHours = father.lifespanHours * .85; },
    ({ father }) => { father.infection = { kind: 'viral', cared: false, severity: .6, elapsedHours: 0 }; },
    ({ s }) => { s.water.nitrite = 3; },
  ];
  for (const change of changes) {
    const fixture = pairTank('guppy');
    change(fixture);
    advanceSimulation(fixture.s, 2);
    assert.deepEqual(fixture.s.broods, []);
  }
});

test('matching stocking orders in different tanks still produce distinct offspring', () => {
  const offspring = [.1, .9].map(seed => {
    const { s, mother } = pairTank('guppy');
    mother.seed = seed;
    advanceSimulation(s, 2 + REPRODUCTION.guppy.hours);
    return s.animals.filter(a => a.origin === 'born').map(a => [a.id, a.seed, a.size]);
  });
  assert.equal(offspring[0].length, 3);
  assert.notDeepEqual(offspring[0], offspring[1]);
});

test('attachment and parental loss have different consequences for eggs and carried young', () => {
  for (const species of ['guppy', 'platy', 'shrimp', 'neon', 'snail']) {
    const { s, mother, father } = pairTank(species);
    advanceSimulation(s, 2);
    const [brood] = s.broods;
    removeAnimal(s, father.id);
    assert.equal(s.broods.length, 1);
    removeAnimal(s, mother.id);
    const isCarried = ['guppy', 'platy', 'shrimp'].includes(species);
    assert.equal(s.broods.length, isCarried ? 0 : 1);
    const resumed = restoreState(s);
    advanceSimulation(resumed, REPRODUCTION[species].hours);
    assert.equal(resumed.animals.length, isCarried ? 0 : brood.count);
  }
  const { s, mother } = pairTank('shrimp');
  advanceSimulation(s, 2);
  mother.health = .001;
  s.water.nitrite = 8;
  advanceSimulation(s, 1);
  assert.equal(mother.alive, false);
  assert.equal(s.broods.length, 0);
});

test('plant spawning needs foliage and removing it also removes the eggs', () => {
  for (const species of ['harlequin', 'cherrybarb', 'boesemani']) {
    const { s } = pairTank(species);
    advanceSimulation(s, 2);
    const [brood] = s.broods;
    assert.equal(removePlant(s, brood.plantId).ok, true);
    assert.equal(s.broods.length, 0);
    s.plants = [];
    for (const parent of s.animals) parent.nextBreedHours = 0;
    advanceSimulation(s, 2);
    assert.equal(s.broods.length, 0);
  }
});

test('a restored rainbowfish brood is visible on an actual moss shoot until the plant is removed', t => {
  t.mock.method(TextureLoader.prototype, 'load', () => new Texture());
  const { s } = pairTank('boesemani');
  s.plants = [s.plants.find(p => p.species === 'moss')];
  advanceSimulation(s, 2);
  const saved = restoreState(s);
  const [brood] = saved.broods;
  const plants = createAquaticPlants(saved.plants, { value: 0 });
  const sites = plants.userData.leafSites;
  const display = createBroodDisplay(new Group(), new Group());
  display.update(saved.broods, new Map(), sites, 0);
  const eggs = display.clutches.get(brood.id);
  assert.equal(eggs.visible, true);
  assert.ok(sites.get(brood.plantId).some(site => site.point.distanceTo(eggs.position) < .025));
  removePlant(saved, brood.plantId);
  display.update(saved.broods, new Map(), new Map(), 0);
  assert.equal(display.clutches.size, 0);
  display.dispose();
  plants.children[0].geometry.dispose();
  plants.children[0].material.dispose();
});

test('angelfish and discus parents guard a glass clutch in an unplanted tank', () => {
  for (const species of ['angelfish', 'discus']) {
    const { s, mother, father } = pairTank(species);
    s.plants = [];
    advanceSimulation(s, 2);
    const clutch = s.broods[0];
    assert.equal(Math.abs(clutch.position.z), 1.96);
    advanceBehavior(s, 30);
    for (const a of [mother, father]) {
      assert.ok(Math.hypot(a.position.x - clutch.position.x, a.position.z - clutch.position.z) < 1);
    }
  }
});

test('stocking and new clutches share reservations for the last available places', () => {
  const { s } = pairTank('guppy');
  while (s.animals.length < 39) addAnimal(s, 'neon', 'male');
  advanceSimulation(s, 2);
  assert.equal(s.broods[0].count, 1);
  assert.equal(availableAnimalSlots(s), 0);
  assert.equal(addAnimal(s, 'shrimp').ok, false);
  advanceSimulation(s, REPRODUCTION.guppy.hours);
  assert.equal(s.animals.length, 40);
  assert.equal(availableAnimalSlots(s), 0);
  const preserved = restoreState(s);
  advanceSimulation(preserved, 8);
  assert.deepEqual(preserved.broods, []);
});

test('old saves start with no pending broods; duplicate and invalid broods do not create animals', () => {
  const { s } = pairTank('guppy');
  const old = structuredClone(s);
  delete old.broods;
  assert.deepEqual(restoreState(old).broods, []);
  advanceSimulation(s, 2);
  const brood = s.broods[0];
  s.broods = [null, { ...brood, species: '__proto__' }, { ...brood, count: -1 },
    { ...brood, fatherId: brood.motherId }, brood, { ...brood, id: 'copied' }];
  assert.deepEqual(restoreState(s).broods, [brood]);
});

for (const species of ['guppy', 'shrimp']) {
  test(`a tank-born ${species} grows up and becomes a parent in the same simulation`, () => {
    const { s } = pairTank(species);
    s.infectionClock.nextAtHours = 299;
    advanceSimulation(s, 2 + REPRODUCTION[species].hours);
    const first = s.animals.find(a => a.origin === 'born');
    assert.ok(first);
    const birthSize = first.size;
    // Keep one youngster with an unrelated mate, so its own lineage is unambiguous.
    for (const a of [...s.animals]) if (a !== first) removeAnimal(s, a.id);
    const mate = addAnimal(s, species, first.sex === 'female' ? 'male' : 'female').animal;
    let grandchild;
    for (let i = 0; i < 40 && !grandchild; i++) {
      if (i % 4 === 0) { feed(s, .015); advanceBehavior(s, 30); }
      advanceSimulation(s, 2);
      grandchild = s.animals.find(a => a.motherId === first.id || a.fatherId === first.id);
    }
    assert.ok(grandchild);
    assert.equal(animalLifeStage(first), 'adult');
    assert.ok(first.size > birthSize * 1.6);
    assert.deepEqual(new Set([grandchild.motherId, grandchild.fatherId]), new Set([first.id, mate.id]));
    assert.equal(animalLifeStage(grandchild), 'juvenile');
  });
}
