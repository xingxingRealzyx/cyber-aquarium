import assert from 'node:assert/strict';
import test from 'node:test';
import {holdBack, steerClear} from '../src/contact-steering.js';
import {advanceBehavior} from '../src/behavior.js';
import {createInitialState} from '../src/simulation.js';

test('a fish squeezed between opposing faces can follow the open channel', () => {
  const a = createInitialState().animals[0];
  for (const [x,y,z] of [[-1,0,0],[0,-1,0],[1,0,0],[0,1,0]]) holdBack(a,{x,y,z},0);
  // The first heading reproduces the stored angelfish's almost head-on approach.
  for (const dz of [.00264,0]) {
    const goal = {x:.125,y:.157,z:dz};
    steerClear(a,goal,.25,.5,true);
    assert.ok(Math.abs(goal.z) > .15 && Math.abs(goal.x) + Math.abs(goal.y) < 1e-6);
  }
  const goal = {x:.2,y:0,z:0};
  steerClear(a,goal,.25,1.1,true);
  assert.deepEqual(goal,{x:.2,y:0,z:0});
});

test('completely enclosed fish and crawlers stop without losing their coordinates', () => {
  for (const fish of [true,false]) {
    const a = createInitialState().animals[0];
    for (const [x,y,z] of [[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,-1,0],[0,1,0]]) holdBack(a,{x,y,z},0);
    const goal = {x:.3,y:0,z:.2};
    steerClear(a,goal,.5,.1,fish);
    assert.equal(Math.hypot(goal.x,goal.y,goal.z),0);
  }
});

test('a fish below its normal swimming depth returns without a one-frame jump', () => {
  const tank = createInitialState();
  const fish = tank.animals[0];
  tank.animals = [fish];
  fish.position = {x:2.1,y:.61,z:.3};
  fish.velocity = {x:.45,y:.01,z:0};
  for (let frame=0; frame<180; frame++) {
    const p = {...fish.position};
    advanceBehavior(tank,1/60);
    const step = Math.hypot(fish.position.x-p.x,fish.position.y-p.y,fish.position.z-p.z);
    assert.ok(step < .025, 'return to the water column must respect swimming speed');
  }
  assert.ok(fish.position.y > .75);
});

test('a change of route eases the fish out of its turn before reversing it', () => {
  const tank = createInitialState(), a = tank.animals[0], dt = 1/60;
  tank.animals = [a];
  a.position = {x:0,y:2,z:0};
  a.velocity = {x:.5,y:0,z:0};
  a.hunger = 70;
  tank.food = .002;
  tank.foodPellets = [{id:'ahead',x:2,y:2,z:0,mass:tank.food,seed:.5,ageSeconds:1}];
  let side = 1, lastYaw = 0, lastRate = 0, peak = 0;
  const scene = {avoid:() => ({obstacle:{distance:.001,x:0,y:0,z:side}}), blocksFood:() => false};
  for (let frame=0; frame<48; frame++) {
    if (frame>15) side = frame%2 ? 1 : -1;
    advanceBehavior(tank,dt,scene);
    const yaw = Math.atan2(a.velocity.z,a.velocity.x);
    const rate = (yaw-lastYaw)/dt;
    assert.ok(Math.abs(rate-lastRate) < .65, 'a new contact normal reversed the turn in one frame');
    peak = Math.max(peak,Math.abs(rate)); lastRate = rate; lastYaw = yaw;
  }
  assert.ok(peak > .7, 'the fish still turns away promptly');
});

test('a fish outside its normal cruising band can swim along the pane', () => {
  const tank = createInitialState(), a = tank.animals[0];
  tank.animals = [a];
  a.position = {x:0,y:2,z:1.7};
  a.velocity = {x:.7,y:0,z:.02};
  advanceBehavior(tank,1/60);
  assert.ok(a.position.x > .008 && a.position.z <= 1.7);
});

test('a resident beside glass keeps a consistent side when both routes have equal clearance', () => {
  const a = {seed:.2, position:{x:3.66,y:2,z:0}};
  holdBack(a,{x:-1,y:0,z:0},0);
  const turns = Array.from({length:4}, (_,i) => {
    const goal = {x:1,y:0,z:0};
    steerClear(a,goal,1,i/60,true);
    return goal.z;
  });
  assert.ok(Math.abs(turns[0]) > .8 && turns.every(z => z === turns[0]));
});
