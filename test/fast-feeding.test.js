import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFastFeeding } from '../src/fast-feeding.js';
import { createInitialState, restoreState, substrateHeight } from '../src/simulation.js';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { BoxGeometry } from 'three';

function fixture(species,groundGrain=true) {
  const tank=createInitialState(), a=tank.animals.find(a=>a.species===species);
  tank.animals=[a];
  const y=groundGrain ? substrateHeight(0,0)+.025 : 2.5;
  Object.assign(a,{position:{x:-.9,y:groundGrain?substrateHeight(-.9,0)+.025:y,z:0},
    velocity:{x:.2,y:0,z:0},hunger:96,health:100});
  const p={id:'meal',x:0,y:groundGrain?y+.015:y,z:0,ageSeconds:0,seed:.3,mass:.12};
  tank.foodPellets=[p]; tank.food=p.mass;
  return {tank,a,p};
}
function advance(tank,seconds,scene) {
  advanceFastFeeding(tank,seconds,scene,dt=>{tank.elapsedHours+=dt/3600});
}

test('fish intercept moving grains and finish concurrent meals with actual bite-sized mass transfers',()=>{
  const {tank,a,p}=fixture('neon',false);
  const duplicate=structuredClone(a);
  Object.assign(duplicate,{id:'second',serial:111,position:{x:.9,y:2.55,z:.7},velocity:{x:-.2,y:0,z:0}});
  tank.animals.push(duplicate);
  const second={...p,id:'other',x:.58,z:.7};
  tank.foodPellets.push(second); tank.food+=second.mass;
  const initial=tank.food;
  advance(tank,.1);
  assert.equal(a.bites,0);
  advance(tank,6);
  assert.ok(a.bites>=2 && duplicate.bites>=2);
  assert.ok(Math.abs(initial-tank.food-a.totalEatenGrams-duplicate.totalEatenGrams)<1e-9);
  assert.ok(tank.detritus>.01 && tank.water.ammonia>.015);
});

test('a slow grazer must cover the route; pausing or loading mid-approach cannot award a bite',()=>{
  const {tank,a}=fixture('snail');
  advance(tank,1);
  assert.equal(a.bites,0); assert.ok(a.position.x>-.9 && a.position.x<-.78);
  const copy=restoreState(JSON.stringify(tank));
  copy.paused=true;
  advance(copy,3600);
  assert.equal(copy.animals[0].bites,0);
  copy.paused=false;
  advance(copy,20);
  assert.ok(copy.animals[0].bites>=2);
  advance(tank,20);
  assert.equal(copy.animals[0].bites,a.bites);
  assert.ok(Math.abs(copy.animals[0].totalEatenGrams-a.totalEatenGrams)<1e-8);
});

test('ordinary sinking food becomes available to a shrimp on reaching the bottom',()=>{
  const {tank,a,p}=fixture('shrimp');
  p.y=3.85;
  advance(tank,5);
  assert.equal(a.bites,0); assert.ok(p.y>3);
  advance(tank,45);
  assert.ok(a.bites>0);
  assert.ok(Math.hypot(a.position.x-p.x,a.position.z-p.z)<.30);
});

test('a grain next to a fish mouth beyond a solid pane cannot be consumed',()=>{
  const {tank,a,p}=fixture('neon',false);
  a.position.x=-.145; p.x=.145;
  const scene=createSceneCollisions();
  scene.update(scanSolids(new BoxGeometry(.013,6,5).translate(0,2,0)),[],false);
  advance(tank,60,scene);
  assert.equal(a.bites,0); assert.equal(a.totalEatenGrams,0);
  assert.ok(a.position.x<0);
});

test('a large elapsed interval honors the cooldown, real timestamps and mid-interval death',()=>{
  const {tank,a}=fixture('shrimp');
  a.position.x=-.1; a.biteCooldown=.51;
  advance(tank,.5); assert.equal(a.bites,0);
  advance(tank,.02); assert.equal(a.bites,1);
  assert.ok(a.lastMealHours>=.51/3600);
  advance(tank,.78); assert.equal(a.bites,1);
  advanceFastFeeding(tank,.08,null,dt=>{tank.elapsedHours+=dt/3600; a.alive=false;});
  assert.equal(a.bites,1);
});

test('an empty tank can advance a full hour in one interval with both pumps off',()=>{
  const {tank,a}=fixture('neon',false);
  tank.foodPellets=[]; tank.food=0; tank.equipment.filter=tank.equipment.aerator=false;
  a.alive=false; a.biteCooldown=.8; a.biteFlash=.45;
  const intervals=[];
  advanceFastFeeding(tank,3600,null,dt=>intervals.push(dt));
  assert.deepEqual(intervals,[3600]);
  assert.equal(a.biteCooldown,0); assert.equal(a.biteFlash,0);
  assert.equal(a.position.y,4); assert.equal(tank.behaviorSeconds,3600); assert.equal(tank.currentSeconds,0);
});

test('a hungry shrimp checks the next grains when the ten nearest are inaccessible',()=>{
  const {tank,a,p}=fixture('shrimp');
  const blocked=Array.from({length:10},(_,i)=>({...p,id:'blocked-'+i,x:a.position.x+.02*i}));
  const reachable={...p,id:'reachable',x:.15,y:substrateHeight(.15,0)+.04};
  tank.foodPellets=[...blocked,reachable];
  tank.food=tank.foodPellets.reduce((g,grain)=>g+grain.mass,0);
  const scene=createSceneCollisions();
  scene.update([],[],false);
  const block=scene.blocksFood;
  scene.blocksFood=p=>p.id?.startsWith('blocked') || block(p);
  advance(tank,40,scene);
  assert.ok(a.bites>0);
  assert.ok(reachable.mass<.12);
  assert.ok(blocked.every(p=>p.mass===.12));
});
