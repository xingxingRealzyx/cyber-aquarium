import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { advanceBehavior, animalTurnRate } from '../src/behavior.js';
import { steerGrazer } from '../src/grazer-steering.js';
import { makeResidentBox } from '../src/resident-collisions.js';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { createInitialState, substrateHeight } from '../src/simulation.js';

function block(x, z, width, depth, bottom = 0) {
  const geometry = new BoxGeometry(width, 1, depth).translate(x, bottom+.5, z);
  const solids = scanSolids(geometry);
  geometry.dispose();
  return solids;
}

function narrowSlot(length) {
  const front = .6, gap = .30;
  return [
    ...block(front+.085, 0, .17, gap+.4),
    ...block(front-length/2, gap/2+.09, length, .18),
    ...block(front-length/2, -gap/2-.09, length, .18),
  ];
}

// Exercise the same food choice, steering, terrain and collision solver as the
// tank. Read the route up to the first real bite; a grazer cannot pass this
// test by giving up on the pellet or moving it through the obstacle.
function seek(species, seed, solids, start, meal, fps, temporaryGate) {
  const state = createInitialState();
  const a = state.animals.find(resident => resident.species === species);
  state.animals = [a];
  const pace = species === 'shrimp' ? .22 : .075;
  Object.assign(a, {
    id: species, seed, size: 1, health: 100, hunger: 90, metabolism: 1,
    position: {x:start.x, z:start.z, y:substrateHeight(start.x,start.z)+.025},
    velocity: {x:pace, y:0, z:0},
  });
  state.food = .001;
  state.foodPellets = [{id:'meal', ...meal, y:substrateHeight(meal.x,meal.z)+.04,
    mass:state.food, ageSeconds:50, seed:.2}];
  const world = createSceneCollisions();
  world.update(temporaryGate ? solids.concat(temporaryGate) : solids, [], false);
  const initialContact = new Map();
  if (temporaryGate) world.contacts(makeResidentBox(a), (part, depth) => {
    if (temporaryGate.includes(part)) initialContact.set(part,depth);
  });
  const noseAtStart = makeResidentBox(a).bounds.max.x - start.x;
  const front = Math.min(...solids.map(s => s.lo[0]));
  const turnLimit = animalTurnRate(species);
  let maxDepth = 0, maxStep = 0, maxTurn = 0, maxSide = 0, previousYaw = 0;
  let earlyTurn = false, crossing, backedToX = start.x, openedGate = false;

  for (let frame = 0; frame < fps*130 && !a.bites; frame++) {
    if (temporaryGate && frame === fps*22) {
      assert.ok(Math.abs(a.position.x-start.x)<.1, 'the closed gate holds the shrimp inside');
      world.update(solids, [], false);
      openedGate = true;
    }
    const previousX = a.position.x, previousZ = a.position.z;
    advanceBehavior(state, 1/fps, world);
    const {x,y,z} = a.position;
    assert.ok(Math.abs(y-substrateHeight(x,z)-.025)<1e-8, 'stays on the substrate');
    world.contacts(makeResidentBox(a), (part, depth) => {
      maxDepth = Math.max(maxDepth, depth - (initialContact.get(part) ?? 0));
    });
    maxStep = Math.max(maxStep, Math.hypot(x-previousX,z-previousZ)*fps);
    const yaw = Math.atan2(a.velocity.z,a.velocity.x);
    if (x < previousX && Math.cos(yaw) > .9) backedToX = Math.min(backedToX, x);
    const turn = Math.atan2(Math.sin(yaw-previousYaw), Math.cos(yaw-previousYaw));
    maxTurn = Math.max(maxTurn, Math.abs(turn)*fps);
    previousYaw = yaw;
    if (x+noseAtStart+.02 < front && Math.abs(yaw) > .08) earlyTurn = true;
    if (crossing === undefined && x >= 0) crossing = z;
    maxSide = Math.max(maxSide, Math.abs(z-start.z));
  }
  const context = species+' seed '+seed+' at '+fps+' Hz';
  if (temporaryGate) assert.ok(openedGate, 'only eats after the exit opens');
  assert.equal(a.bites, 1, context+' must reach the settled pellet');
  assert.ok(Math.hypot(a.position.x-meal.x,a.position.z-meal.z)<.31, context+' eats at the pellet');
  assert.ok(maxDepth < 1e-7, context+' penetrated scenery by '+maxDepth);
  assert.ok(maxStep < pace+.055, context+' took an unpowered jump at '+maxStep);
  assert.ok(maxTurn <= turnLimit+1e-5, context+' pivoted at '+maxTurn);
  return { crossing, earlyTurn, maxSide, backedToX };
}

for (const species of ['shrimp','snail']) {
  test(species+' can choose either route around a rock and return to the food', () => {
    const rock = block(0,0,.45,1.25);
    const sides = new Set();
    let anticipated = 0;
    for (let i=0; i<8; i++) {
      const route = seek(species, (i+.5)/8, rock, {x:-1.2,z:0}, {x:1.15,z:0}, 30);
      assert.ok(Math.abs(route.crossing)>.625, 'crosses beyond a side of the rock');
      sides.add(Math.sign(route.crossing));
      if (route.earlyTurn) anticipated++;
    }
    assert.equal(sides.size, 2, 'different individuals can pass at either end');
    assert.ok(anticipated > 0, 'some individuals turn before their antennae or shell reach the rock');
  });

  test(species+' leaves a blind gap against the glass to reach food on the other side', () => {
    // The short route above the rock is narrower than the clearance to the
    // pane. The animal has room to turn and pass below the far end instead.
    const rock = block(-.25,.75,.45,1.70);
    for (const [seed,fps] of [[.12,20],[.65,60]]) {
      const route = seek(species, seed, rock, {x:-1.35,z:1.2}, {x:.9,z:1.23}, fps);
      assert.ok(route.crossing < .15 && route.maxSide > 1.1, 'passes the open end of the rock');
    }
  });

  for (const length of [.55,.85]) {
    test(species+' backs out of a narrow slot of depth '+length+' before turning toward food', () => {
      // The grazer starts inside, nose first. Its body fits between these two
      // roots, but there is no room for the antennae or shell to swing around.
      const front = .6;
      const mouth = front-length;
      const nose = species === 'shrimp' ? .398 : .261;
      const route = seek(species, .12, narrowSlot(length), {x:front-nose,z:0}, {x:front+.85,z:0}, 30);
      assert.ok(route.backedToX < mouth, 'walks backward through the entrance while facing the blocked end');
    });
  }

  test(species+' follows an unobstructed feeding route beneath an elevated branch', () => {
    const beam = block(0,0,.4,1.25,.98);
    const route = seek(species, .42, beam, {x:-1.2,z:0}, {x:1.15,z:0}, 30);
    assert.ok(route.maxSide < .02, 'the overhead branch leaves the direct path open');
  });
}

test('a shrimp resumes backing out after a temporary obstacle blocking the exit is removed', () => {
  const start = {x:.6-.398,z:0};
  const gate = block(start.x-.36, 0, .16, .70);
  const route = seek('shrimp', .12, narrowSlot(.85), start, {x:1.45,z:0}, 30, gate);
  assert.ok(route.backedToX < -.25, 'walks backward past the open mouth of the slot');
});

test('a shrimp checks for a body length of clearance behind the slot before backing out', () => {
  const x = .6-.398, slot = narrowSlot(.85), world = createSceneCollisions();
  const shrimp = { species:'shrimp', size:1, seed:.12, targetFoodId:'meal',
    position:{x,y:substrateHeight(x,0)+.025,z:0}, velocity:{x:.22,y:0,z:0} };
  const goal = () => ({ x:.22, y:0, z:0 });
  const meal = { x:1.45, z:0 };
  world.update([...slot, ...block(x-.89,0,.10,.70)], [], false);
  assert.equal(steerGrazer(shrimp,world,meal,goal(),.22,10), undefined);
  world.update(slot, [], false);
  assert.ok(steerGrazer(shrimp,world,meal,goal(),.22,11)?.x < 0);
});
