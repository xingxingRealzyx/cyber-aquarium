import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { feedingRoute } from '../src/feeding-route.js';
import { substrateHeight } from '../src/simulation.js';

const floor=(x,z)=>({x,y:substrateHeight(x,z)+.025,z});
const grazer=(species='shrimp')=>({species,alive:true,size:1,position:floor(-1.4,0),velocity:{x:1,y:0,z:0}});
const fish=()=>({species:'neon',alive:true,size:.7,position:{x:-1.4,y:1.5,z:0},velocity:{x:1,y:0,z:0}});
function wall(x,y,z,width,height,depth) { return scanSolids(new BoxGeometry(width,height,depth).translate(x,y,z)); }

test('shrimp and snails follow the substrate around a stone between their start and an old bottom grain', () => {
  const scene=createSceneCollisions();
  scene.update(wall(0,.65,0,.16,1.3,.95),[]);
  const pellet=floor(1.4,0);
  for (const kind of ['shrimp','snail']) {
    const a=grazer(kind), old=structuredClone(a);
    assert.equal(feedingRoute(scene,a,pellet,{detour:false}),null);
    const route=feedingRoute(scene,a,pellet);
    assert.ok(route?.length>2);
    assert.ok(route.some(p=>Math.abs(p.z)>.5));
    for (const p of route) assert.equal(p.y,floor(p.x,p.z).y);
    const end=route.at(-1);
    assert.ok(Math.hypot(end.x-pellet.x,end.y-pellet.y,end.z-pellet.z)<.29);
    assert.deepEqual(a,old);
  }
});

test('a fish can reach a pellet by swimming over a barrier a bottom dweller cannot cross', () => {
  const scene=createSceneCollisions();
  scene.update(wall(0,1.1,0,.03,2.2,4.2),[]);
  const f=fish(), pellet={x:1.1,y:1.45,z:0};
  assert.equal(feedingRoute(scene,f,pellet,{detour:false}),null);
  const path=feedingRoute(scene,f,pellet);
  assert.ok(path?.some(p=>p.y>2.2));
  assert.equal(feedingRoute(scene,grazer(),floor(1.1,0)),null);
});

test('no bite through a thin wall even within mouth reach; replacing scenery invalidates the cached failure', () => {
  const scene=createSceneCollisions(), f=fish();
  f.size=.35; f.position.x=-.13;
  const food={x:.12,y:1.5,z:0};
  scene.update(wall(0,2,0,.008,4.4,4.2),[]);
  assert.equal(feedingRoute(scene,f,food),null);
  scene.update([],[]);
  assert.deepEqual(feedingRoute(scene,f,food),[]);
});

test('empty tanks still enforce glass and grazer diet, and cached return paths belong to the caller', () => {
  const a=grazer(), p=floor(.8,0);
  assert.equal(feedingRoute(null,a,{...p,y:2}),null);
  assert.equal(feedingRoute(null,a,{x:5,y:floor(5,0).y,z:0}),null);
  const route=feedingRoute(null,a,p);
  const first=structuredClone(route[0]);
  route[0].x=45;route.shift();
  assert.deepEqual(feedingRoute(null,a,p)[0],first);
});

test('a shrimp needs clearance for its antennae beside a submerged twig', () => {
  const scene=createSceneCollisions(), a=grazer();
  scene.update(wall(0,.55,.104,.025,.60,.015),[]);
  const finish=floor(1,0);
  assert.ok(scene.canGrazeFrom(a,finish),'the thin twig never crosses the centerline');
  assert.equal(scene.canSwimSegment(a,a.position,finish),false,'the shrimp antennae would intersect it');
  assert.ok(feedingRoute(scene,a,finish)?.some(p=>Math.abs(p.z)>.10));
});
