import assert from 'node:assert/strict';
import test from 'node:test';
import { addAnimal, advanceSimulation, createInitialState, feed, getAssessment, residentWaterRange, restoreState, SPECIES } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';

for (const [species, spec] of Object.entries(SPECIES)) {
  if (spec.type !== 'fish') continue;
  test(`${species} can be stocked, fed, restored and affected by the water`, t => {
    // Release the same surface cloud for every body shape and initial heading.
    t.mock.method(Math, 'random', () => .78);
    const tank = createInitialState();
    tank.animals.length = 0;
    const { animal } = addAnimal(tank, species);
    animal.position = { x: 0, y: 2.3, z: 0 };
    animal.hunger = 80;
    feed(tank);
    advanceBehavior(tank, 8);
    assert.ok(animal.bites > 0 && animal.hunger < 80);

    const saved = restoreState(JSON.stringify(tank));
    assert.deepEqual(saved.animals[0], animal);
    saved.equipment.filter = false;
    saved.water.nitrite = 8;
    advanceSimulation(saved, 16);
    assert.equal(saved.animals[0].alive, false);
    assert.equal(saved.animals[0].causeOfDeath, '亚硝酸盐中毒');
  });
}

test('water assessment follows the living residents and the temperature shown on the gauge', () => {
  const tank = createInitialState();
  tank.animals = [];
  addAnimal(tank, 'discus');
  assert.deepEqual(residentWaterRange(tank, 'temperature'), [26, 30]);
  assert.equal(getAssessment(tank).label, '温度不适');
  tank.water.temperature = 29;
  assert.equal(getAssessment(tank).level, 'good');
  addAnimal(tank, 'galaxy');
  assert.deepEqual(residentWaterRange(tank, 'temperature'), [26, 26]);
  assert.equal(getAssessment(tank).label, '温度不适');
  tank.water.temperature = 25.99999;
  assert.equal(getAssessment(tank).level, 'good');
  tank.animals[1].alive = false;
  assert.deepEqual(residentWaterRange(tank, 'temperature'), [26, 30]);
  tank.animals = [];
  assert.deepEqual(residentWaterRange(tank, 'ph'), [6.5, 8]);
});
