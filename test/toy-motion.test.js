import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, Vector3 } from 'three';
import { advanceBehavior } from '../src/behavior.js';
import { createInitialState, MAX_TOYS, restoreState, substrateHeight } from '../src/simulation.js';
import { poseToy } from '../src/toy-motion.js';
import { sampleWaterSurface } from '../src/water-light.js';

const level = 4.14;

test('floating ducks follow the surface and have room to turn at every slot', () => {
  const ducks = Array.from({length: MAX_TOYS}, () => new Object3D());
  const field = new Vector3();
  for (let time = 0; time < 150; time += .5) {
    for (const [slot, model] of ducks.entries()) {
      poseToy(model, {kind: 'duck', slot}, time, level, substrateHeight);
      const {x, y, z} = model.position;
      assert.equal(y, level + sampleWaterSurface(x, z, time, field).x);
      assert.ok(Math.abs(x) + .41 < 4 && Math.abs(z) + .41 < 2);
      for (let i = 0; i < slot; i++) assert.ok(model.position.distanceTo(ducks[i].position) > .82);
    }
  }
});

test('a neutrally buoyant diver rises and falls through open water and clears scenery', () => {
  const diver = new Object3D();
  const low = new Vector3(Infinity, Infinity, Infinity);
  const high = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let time = 0; time < 160; time += .5) {
    poseToy(diver, {kind: 'diver', slot: 0}, time, level, substrateHeight);
    const {x, y, z} = diver.position;
    assert.ok(y > substrateHeight(x, z) + .44 && y < level - .44);
    assert.ok(Math.abs(x) + .3 < 4 && Math.abs(z) + .3 < 2);
    low.min(diver.position); high.max(diver.position);
    poseToy(diver, {kind: 'diver', slot: 0}, time, level, () => 2.4);
    assert.ok(diver.position.y > 2.4 + .44);
  }
  assert.ok(low.y < 1 && high.y > 3.4);
  assert.ok(high.x - low.x > 5 && high.z - low.z > 2);
});

test('flow speed responds to the pumps without moving a paused or restored toy', () => {
  const tank = createInitialState();
  tank.animals = [];
  advanceBehavior(tank, 10);
  assert.ok(Math.abs(tank.currentSeconds - 10) < 1e-8);
  tank.equipment.filter = false;
  advanceBehavior(tank, 10);
  assert.ok(Math.abs(tank.currentSeconds - 12.2) < 1e-8);
  tank.paused = true;
  const stopped = tank.currentSeconds;
  advanceBehavior(tank, 1);
  assert.equal(tank.currentSeconds, stopped);
  const restored = restoreState(JSON.parse(JSON.stringify(tank)));
  assert.equal(restored.currentSeconds, stopped);
  restored.paused = false;
  restored.equipment.aerator = false;
  advanceBehavior(restored, 3);
  assert.equal(restored.currentSeconds, stopped);
  restored.equipment.filter = true;
  advanceBehavior(restored, 1);
  assert.ok(Math.abs(restored.currentSeconds - stopped - .78) < 1e-8);
});
