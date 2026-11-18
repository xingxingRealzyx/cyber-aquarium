import assert from 'node:assert/strict';
import test from 'node:test';
import { addAnimal, advanceSimulation, createInitialState, feed, restoreState } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';

for (const species of ['angelfish', 'zebra', 'harlequin']) {
  test(`${species} can be stocked, fed, restored and affected by the water`, () => {
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
