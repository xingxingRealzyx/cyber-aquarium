import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, LoadingManager, Texture, TextureLoader } from 'three';
import { advanceBehavior } from '../src/behavior.js';
import { drawFood, fishMouth, mouthAtFood, suctionReach } from '../src/fish-feeding.js';
import { createHardscape } from '../src/hardscape.js';
import { advancePlayback, playbackSpeeds } from '../src/playback.js';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { addAnimal, consumePellet, createInitialState, SPECIES, substrateHeight } from '../src/simulation.js';

test('suction moves a grain to the lips over multiple frames before its mass transfers', () => {
  const tank=createInitialState(), fish=tank.animals[0];
  Object.assign(fish,{size:.75,hunger:85,position:{x:1,y:2,z:0},velocity:{x:0,y:0,z:1}});
  const mouth=fishMouth(fish), reach=suctionReach(fish);
  const grain={id:'suction',mass:.0005,ageSeconds:12,seed:.3,x:mouth.x,y:mouth.y,z:mouth.z+reach*.95};
  tank.food=grain.mass;tank.foodPellets=[grain];
  const before=grain.z;
  drawFood(fish,grain,1/60);
  assert.ok(grain.z<before && grain.z>mouth.z);
  assert.equal(consumePellet(tank,fish.id,grain.id).ok,false);
  assert.equal(fish.hunger,85);
  for(let i=0;i<20 && !fish.bites;i++) {
    drawFood(fish,grain,1/60);
    consumePellet(tank,fish.id,grain.id);
  }
  assert.equal(fish.bites,1);
  assert.equal(fish.totalEatenGrams,.0005);
  assert.equal(tank.food,0);
  assert.ok(fish.hunger<85);
});

test('a fish makes room to intercept a falling pellet vertically above or below its nose', () => {
  const scene=createSceneCollisions();
  scene.update([],[],false);
  for (const dy of [-.6,1.25]) {
    const tank=createInitialState(), fish=tank.animals[0];
    tank.animals=[fish];
    Object.assign(fish,{size:.85,seed:.4,hunger:85,health:100,metabolism:1,
      position:{x:.2,y:2.4,z:.1},velocity:{x:.4,y:0,z:0}});
    const grain={id:'falling',x:.2,y:2.4+dy,z:.1,mass:.0008,ageSeconds:0,seed:.2};
    tank.food=grain.mass;tank.foodPellets=[grain];
    for (let frame=0;frame<240 && !fish.bites;frame++) advancePlayback(tank,1/30,()=>scene);
    assert.equal(fish.bites,1);
    assert.ok(grain.y>substrateHeight(grain.x,grain.z)+.35,'intercepted in the water column');
  }
});

test('a fish strikes the grain in front of its lips when another falls against its flank', () => {
  const tank=createInitialState(), fish=tank.animals[0], scene=createSceneCollisions();
  scene.update([],[],false);
  tank.animals=[fish];
  Object.assign(fish,{size:1,hunger:85,position:{x:0,y:2,z:0},velocity:{x:.3,y:0,z:0}});
  const mouth=fishMouth(fish);
  const flank={id:'flank',x:0,y:2,z:.06,mass:.0005,ageSeconds:12,seed:.3};
  const ahead={...flank,id:'ahead',x:mouth.x+.045,y:mouth.y,z:mouth.z};
  tank.foodPellets=[flank,ahead];tank.food=flank.mass+ahead.mass;
  for (let frame=0;frame<6 && !fish.bites;frame++) advancePlayback(tank,1/60,()=>scene);
  assert.equal(fish.bites,1);
  assert.equal(tank.foodPellets.length,1);
  assert.equal(tank.foodPellets[0].id,'flank');
});

test('snout length grows with the fish and suction cannot take a grain through a wall or at its flank', () => {
  const tank=createInitialState(), fish=tank.animals[0];
  Object.assign(fish,{size:1,position:{x:0,y:1.8,z:0},velocity:{x:1,y:0,z:0}});
  const mouth=fishMouth(fish), grain={x:mouth.x+.06,y:mouth.y,z:0};
  assert.ok(mouthAtFood(fish,grain));
  assert.equal(mouthAtFood(fish,{...grain,x:mouth.x,z:.085}),null);
  assert.equal(mouthAtFood(fish,{...grain,x:-grain.x}),null);
  const scene=createSceneCollisions();
  for(const wallX of [mouth.x+.03, mouth.x-.04]) {
    scene.update(scanSolids(new BoxGeometry(.004,3,3).translate(wallX,1.8,0)),[]);
    assert.equal(mouthAtFood(fish,grain,scene),null);
  }
  fish.size=.35;
  assert.ok(Math.abs(fishMouth(fish).x-.35*mouth.x)<1e-10);
  assert.equal(mouthAtFood(fish,grain),null);
});

test('a fish at the substrate intercepts a grain another hungry fish is still swimming towards', () => {
  const tank=createInitialState();tank.animals=[];
  const distant=addAnimal(tank,'neon').animal, close=addAnimal(tank,'neon').animal;
  Object.assign(distant,{hunger:98,position:{x:-1.7,y:2,z:.2},velocity:{x:.3,y:0,z:0}});
  const x=.8, z=.2, grain={id:'shared',x,y:substrateHeight(x,z)+.04,z,mass:.0003,ageSeconds:90,seed:.3};
  tank.food=grain.mass;tank.foodPellets=[grain];
  Object.assign(close,{size:.65,hunger:80,velocity:{x:.72,y:-.69,z:0}});
  const offset=fishMouth(close,{x:0,y:0,z:0});
  close.position={x:x-offset.x-.009,y:grain.y-offset.y+.009,z:z-offset.z};
  const scene=createSceneCollisions();scene.update([],[],false);
  advanceBehavior(tank,1/60,scene);
  assert.equal(distant.bites,0);
  assert.equal(close.bites,1);
  assert.equal(close.totalEatenGrams,.0003);
  assert.equal(tank.food,0);
});

test('hungry juveniles and adults can eat settled food among the starter rocks at each playback speed', t => {
  t.mock.method(TextureLoader.prototype,'load',()=>new Texture());
  const scene=createSceneCollisions(), terrain=createHardscape(new LoadingManager());
  terrain.update(createInitialState().hardscape);
  scene.update(terrain.solids,[],false);
  const fishSpecies=Object.keys(SPECIES).filter(kind=>SPECIES[kind].type==='fish');
  for(const kind of fishSpecies) for(const size of [.55,1.05]) for(const speed of playbackSpeeds) {
    const tank=createInitialState();tank.animals=[];tank.speed=speed;
    const a=addAnimal(tank,kind).animal;
    Object.assign(a,{size,hunger:92,health:100,metabolism:1,seed:.4,
      position:{x:-1.7,y:2.5,z:1.1},velocity:{x:.28,y:0,z:-.1}});
    const x=.84,z=.88,grain={id:'old',x,y:substrateHeight(x,z)+.04,z,mass:.00065,seed:.3,ageSeconds:180};
    assert.equal(scene.blocksFood(grain),false);
    tank.food=grain.mass;tank.foodPellets=[grain];
    const frame=speed>=60 ? 4/speed : 1/30;
    for(let elapsed=0;elapsed<60 && a.bites===0;elapsed+=speed*frame) advancePlayback(tank,frame,()=>scene);
    assert.ok(a.bites>0 && a.totalEatenGrams>0 && a.hunger<92,kind+' size '+size+' at '+speed+'×');
  }
});
