import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { fishMouth } from '../src/fish-feeding.js';
import { advanceBehavior } from '../src/behavior.js';
import { advancePlayback } from '../src/playback.js';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { advanceSimulation, consumePellet, createInitialState, feed, restoreState, substrateHeight } from '../src/simulation.js';

function hungryGrazer(species, x, z) {
  const tank = createInitialState();
  const animal = tank.animals.find(a => a.species === species);
  Object.assign(animal, {
    id: species, seed: .12, size: 1, hunger: 100, health: 100, metabolism: 1,
    position: {x, y: substrateHeight(x,z)+.025, z},
    velocity: {x: species === 'shrimp' ? .22 : .075, y: 0, z: 0},
  });
  tank.animals = [animal];
  return {tank, animal};
}

function settledPellet(id, x, z) {
  return { id, x, z, y: substrateHeight(x,z)+.04, mass:.001, ageSeconds:60, seed:.15 };
}

function wallScene(x, width) {
  const wall = new BoxGeometry(width,1.3,4.1).translate(x,.65,0);
  const scene = createSceneCollisions();
  scene.update(scanSolids(wall), [], false);
  wall.dispose();
  return scene;
}

for (const species of ['shrimp','snail']) {
  test(species+' finds food on its own side of a wall when the closer pellet is unreachable', () => {
    const {tank, animal} = hungryGrazer(species,-.65,0);
    const behind = settledPellet('behind-wall',.4,0);
    const reachable = settledPellet('open-bed',-2.9,-1.2);
    tank.foodPellets = [behind, reachable];
    tank.food = behind.mass + reachable.mass;
    const scene = wallScene(0,.27);
    assert.equal(scene.blocksFood(behind),false, 'the grain itself is on open sand');

    for (let i=0; i<30*180 && !animal.bites; i++) {
      advanceBehavior(tank,1/30,scene);
      assert.ok(animal.position.x < 0, 'stays on its own side of the wall');
    }
    assert.equal(animal.bites,1);
    assert.ok(animal.hunger < 100);
    assert.ok(Math.hypot(animal.position.x-reachable.x, animal.position.z-reachable.z) <= .30);
    assert.equal(behind.mass,.001);
    assert.ok(reachable.mass < .001);
  });
}

test('a shrimp releases the only unreachable pellet and eats it when the passage opens', () => {
  const {tank, animal} = hungryGrazer('shrimp',-.65,0);
  const pellet = settledPellet('grain',.4,0);
  tank.foodPellets = [pellet];
  tank.food = pellet.mass;
  const scene = wallScene(0,.27);
  let released = false;
  for (let i=0; i<90*30 && !released; i++) {
    advanceBehavior(tank,1/30,scene);
    released = animal.targetFoodId == null;
  }
  assert.ok(released, 'stops claiming the inaccessible grain');
  assert.equal(animal.bites,0);
  scene.update([],[],false);
  for (let i=0; i<90*30 && !animal.bites; i++) advanceBehavior(tank,1/30,scene);
  assert.equal(animal.bites,1);
  assert.ok(Math.hypot(animal.position.x-pellet.x,animal.position.z-pellet.z) <= .30);
});

test('a real feed reaches a hungry shrimp separated from the older pellets by scenery', t => {
  const {tank,animal} = hungryGrazer('shrimp',-2.75,0);
  const oldPellet = settledPellet('old-grain',-1.55,0);
  tank.foodPellets = [oldPellet];
  tank.food = oldPellet.mass;
  const scene = wallScene(-2,.25);
  t.mock.method(Math,'random',() => .42);
  feed(tank,.08,scene);
  const fresh = tank.foodPellets.filter(p => p !== oldPellet);
  const local = fresh.filter(p => p.x < -2);
  assert.ok(local.length > 0 && local.length < fresh.length);
  assert.ok(local.every(p => p.fastSinking));
  assert.deepEqual(restoreState(tank).foodPellets, tank.foodPellets);
  assert.ok(fresh.every(p => p.y >= 3.88), 'all new grains entered at the water surface');
  assert.ok(Math.abs(tank.food-.081)<1e-10);
  assert.equal(animal.hunger,100);
  for (let i=0; i<90*30 && !animal.bites; i++) {
    advanceBehavior(tank,1/30,scene);
    assert.ok(animal.position.x < -2);
  }
  assert.ok(animal.bites > 0 && animal.hunger < 100);
  const eaten = local.find(p => p.id === animal.targetFoodId);
  assert.ok(eaten && Math.hypot(animal.position.x-eaten.x,animal.position.z-eaten.z) <= .30);
  assert.equal(oldPellet.mass,.001);
  assert.ok(Math.abs(tank.food+animal.totalEatenGrams-.081)<1e-10);
});

test('a fish can intercept a descending grain that a shrimp is waiting for below', () => {
  const {tank,animal} = hungryGrazer('shrimp',0,0);
  const fish = createInitialState().animals[0];
  const pellet = {...settledPellet('sinking',0,0), y:1.85, fastSinking:true};
  Object.assign(fish,{hunger:75,position:{x:0,y:pellet.y,z:0},velocity:{x:.2,y:0,z:0}});
  const lips=fishMouth(fish);
  fish.position.x+=pellet.x-lips.x;fish.position.y+=pellet.y-lips.y;
  tank.animals.push(fish);
  tank.foodPellets = [pellet];
  tank.food = pellet.mass;
  const scene = createSceneCollisions();
  scene.update([],[],false);
  advanceBehavior(tank,1/30,scene);
  assert.equal(animal.bites,0);
  assert.equal(fish.bites,1);
  assert.ok(pellet.y > 1.8 && pellet.mass < .001);
});

test('a thin root prevents a nearby grain from being eaten through it', () => {
  const {tank,animal} = hungryGrazer('shrimp',-.16,0);
  animal.velocity = {x:0,y:0,z:.22};
  const pellet = settledPellet('grain',.10,0);
  tank.foodPellets = [pellet];
  tank.food = pellet.mass;
  const scene = wallScene(0,.01);
  assert.equal(scene.blocksFood(pellet),false);
  assert.equal(consumePellet(tank,animal.id,pellet.id,scene).ok,false);
  assert.equal(animal.hunger,100);
  assert.equal(pellet.mass,.001);
  scene.update([],[],false);
  assert.equal(consumePellet(tank,animal.id,pellet.id,scene).ok,true);
});

test('at maximum speed a weakened hungry shrimp can reach the bed food and eat a substantial meal', () => {
  const {tank, animal} = hungryGrazer('shrimp',-2.95,0);
  animal.health = 24;
  animal.mass = .1867;
  tank.speed = 3600;
  tank.detritus = 0;
  tank.plants = [];
  tank.foodPellets = [.20,.32,.44].map((x,i) => settledPellet('grain-'+i,x,.30));
  tank.food = .003;
  const scene = createSceneCollisions();
  scene.update([],[],false);
  for (let i=0; i<60*30 && animal.alive && animal.hunger>=80; i++) {
    advancePlayback(tank,1/30,()=>scene);
  }
  assert.ok(animal.alive && animal.bites > 0 && animal.hunger < 80);
  assert.ok(animal.totalEatenGrams > .0008 && animal.totalEatenGrams <= .003,
    'satiety comes from the amount of food actually eaten');
});

test('at every speed decayed food becomes dissolved nitrogen in proportion to physical grain loss', () => {
  for (const speed of [1,60,3600]) {
    const tank = createInitialState();
    tank.animals = []; tank.plants = []; tank.detritus = 0;
    tank.speed = speed;
    tank.foodPellets = [settledPellet('grain',.2,.3)];
    const initialMass = tank.food = tank.foodPellets[0].mass;
    const nitrogen = () => tank.water.ammonia+tank.water.nitrite+tank.water.nitrate;
    const initialNitrogen = nitrogen();
    advanceSimulation(tank,12);
    const mass = tank.foodPellets[0].mass;
    assert.ok(Math.abs(tank.elapsedHours-12)<1e-9);
    assert.equal(tank.food,mass);
    assert.ok(Math.abs(mass-initialMass*Math.exp(-.08*12))<1e-10);
    assert.ok(Math.abs(nitrogen()-initialNitrogen-(initialMass-mass)*70/tank.volumeLiters)<1e-10);
  }
});

test('a shrimp keeps approaching the same reachable grain in a scattered batch of feed', () => {
  const {tank,animal}=hungryGrazer('shrimp',0,0);
  tank.foodPellets=Array.from({length:18},(_,i)=>
    settledPellet('grain-'+i,(i%2 ? -1 : 1)*(1.25+i*.065),i%3*.05));
  tank.food=.018;
  const scene=createSceneCollisions();
  scene.update([],[],false);
  const targets=new Set();
  for (let i=0; i<30*30 && !animal.bites; i++) {
    advanceBehavior(tank,1/30,scene);
    if (animal.targetFoodId) targets.add(animal.targetFoodId);
  }
  assert.equal(animal.bites,1);
  assert.deepEqual([...targets],['grain-0']);
});
