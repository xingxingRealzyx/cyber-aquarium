import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback, isFastForward, playbackSpeeds } from '../src/playback.js';
import { createSceneCollisions } from '../src/scene-collisions.js';
import { createInitialState, feed, restoreState, substrateHeight } from '../src/simulation.js';

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `expected ${expected}, received ${actual}`);
}

const openWater = () => null;

test('a new tank uses real time and all five playback settings survive a save', () => {
  const tank = createInitialState();
  assert.equal(tank.speed, 1);
  assert.deepEqual(playbackSpeeds, [1, 2, 4, 60, 3600]);
  for (const speed of playbackSpeeds) {
    tank.speed = speed;
    tank.paused = true;
    closeTo(restoreState(tank).speed, speed);
    assert.equal(restoreState(tank).paused, true);
    assert.equal(isFastForward(speed), speed >= 60);
  }
});

test('all three viewing speeds advance ecology, current and falling food on the same clock', () => {
  const source = createInitialState();
  source.animals = [];
  feed(source);
  for (const speed of [1, 2, 4]) {
    const tank = restoreState(source);
    const reference = restoreState(source);
    tank.speed = speed;
    for (let frame = 0; frame < 12; frame++) {
      advancePlayback(tank, 1/60, openWater);
      for (let subframe = 0; subframe < speed; subframe++) advancePlayback(reference, 1/60, openWater);
    }
    closeTo(tank.elapsedHours, speed * .2/3600);
    closeTo(tank.behaviorSeconds, speed * .2);
    closeTo(tank.currentSeconds, tank.behaviorSeconds);
    closeTo(tank.foodPellets[0].y, reference.foodPellets[0].y);
    assert.ok(tank.foodPellets[0].y < source.foodPellets[0].y);
  }
});

test('a long accelerated frame samples consecutive short collision intervals', () => {
  const tank = createInitialState();
  tank.animals = [];
  tank.speed = 4;
  tank.equipment.filter = false;
  let collisionClock = tank.behaviorSeconds;
  let samples = 0;
  const motion = advancePlayback(tank, .1, (state, seconds) => {
    closeTo(state.behaviorSeconds, collisionClock);
    closeTo(state.currentSeconds, collisionClock * .22);
    assert.ok(seconds > 0 && seconds <= 1/15 + 1e-10);
    collisionClock += seconds;
    samples++;
  });
  assert.ok(samples > 1);
  closeTo(motion, .4);
  closeTo(tank.behaviorSeconds, collisionClock);
});

test('a stalled frame resumes a short stroke without a deferred burst on the next frame', () => {
  const tank = createInitialState();
  tank.animals = [];
  tank.speed = 4;
  const stalled = advancePlayback(tank, 15, openWater);
  assert.ok(stalled > 0 && stalled <= .4);
  closeTo(tank.elapsedHours, stalled / 3600);
  closeTo(advancePlayback(tank, 1/60, openWater), 4/60);
  closeTo(tank.behaviorSeconds, stalled + 4/60);
});

test('pausing arrests both clocks and switching back from fast-forward adds no catch-up movement', () => {
  const original = createInitialState();
  original.speed = 3600;
  advancePlayback(original, .05, openWater);
  original.paused = true;
  const frozen = structuredClone(original);
  const rejectMotion = () => assert.fail('paused playback sampled collisions');
  assert.equal(advancePlayback(original, 5, rejectMotion), 0);
  assert.deepEqual(original, frozen);
  const tank = restoreState(JSON.stringify(original));
  assert.equal(advancePlayback(tank, .5, rejectMotion), 0);
  tank.speed = 2;
  tank.paused = false;
  closeTo(advancePlayback(tank, 1/60, openWater), 2/60);
  closeTo(tank.elapsedHours - frozen.elapsedHours, 2/60/3600);
  closeTo(tank.behaviorSeconds - frozen.behaviorSeconds, 2/60);
});

test('background fast-forward advances ecology and only awards a bite when a hungry shrimp reaches food', () => {
  const scene = createSceneCollisions();
  scene.update([], [], false);
  for (const speed of [60, 3600]) {
    const tank = createInitialState();
    const shrimp = tank.animals.find(a => a.species === 'shrimp');
    tank.animals = [shrimp];
    tank.speed = speed;
    tank.detritus = 0;
    const floor = x => substrateHeight(x, 0) + .04;
    Object.assign(shrimp, { hunger: 95, position: { x: 0, y: floor(0), z: 0 }, velocity: {x: .18, y: 0, z: 0} });
    tank.food = .003;
    tank.foodPellets = [{id: 'bottom-food', x: .75, y: floor(.75), z: 0, mass: tank.food, seed: .5, ageSeconds: 50}];
    const prepare = () => scene;
    advancePlayback(tank, .05/speed, prepare);
    assert.equal(shrimp.bites, 0);
    for (let frame = 1; frame < 600 && !shrimp.bites; frame++) advancePlayback(tank, .05/speed, prepare);
    assert.equal(shrimp.bites, 1);
    assert.ok(shrimp.totalEatenGrams > 0 && tank.food < .003);
    assert.ok(Math.hypot(shrimp.position.x - .75, shrimp.position.z) <= .30);
    closeTo(tank.elapsedHours, tank.behaviorSeconds / 3600);
  }
});

test('one wall second at 3600× gives food and residents a whole tank hour', () => {
  const tank = createInitialState();
  tank.speed = 3600;
  tank.animals = [];
  feed(tank);
  const mass = tank.food;
  advancePlayback(tank, 1, openWater);
  closeTo(tank.elapsedHours, 1);
  closeTo(tank.behaviorSeconds, 3600);
  closeTo(tank.currentSeconds, 3600);
  closeTo(tank.food, mass*Math.exp(-.08));
  assert.ok(tank.foodPellets.every(p => p.ageSeconds>=3599.999 && p.y<.8));
});
