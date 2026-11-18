import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, restoreState, feed, consumePellet, changeWater, advanceSimulation, MAX_FOOD_PELLETS, substrateHeight } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';

const sumFood = state => state.foodPellets.reduce((sum,p)=>sum+p.mass,0);
const nearly = (a,b,tolerance=1e-10) => assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function run(state,seconds){for(let frame=0;frame<seconds*30;frame++)advanceBehavior(state,1/30);}
function fixture(){
  const state=createInitialState();
  state.animals=state.animals.slice(0,2);
  for(const [i,a] of state.animals.entries()){
    a.position={x:i?-2:2,y:1.8,z:.4};a.velocity={x:0,y:0,z:0};
    a.hunger=i?5:85;a.mass=.35;a.size=1;a.metabolism=1;a.seed=.1+i*.3;
  }
  return state;
}

test('each animal has stable individual traits, labels and spatial state',()=>{
  const state=createInitialState();
  assert.equal(new Set(state.animals.map(a=>a.label)).size,state.animals.length);
  assert.ok(new Set(state.animals.map(a=>a.hunger)).size>1);
  assert.ok(new Set(state.animals.map(a=>a.mass)).size>1);
  const restored=restoreState(JSON.stringify(state));
  for(let i=0;i<state.animals.length;i++){
    const original=state.animals[i],saved=restored.animals[i];
    for(const key of ['id','label','mass','size','metabolism','hunger','health'])assert.equal(saved[key],original[key]);
    assert.deepEqual(saved.position,original.position);assert.deepEqual(saved.velocity,original.velocity);
  }
});

test('feeding creates visible physical food but cannot lower hunger before contact',()=>{
  const state=fixture(),a=state.animals[0],hunger=a.hunger;
  feed(state);
  assert.equal(state.foodPellets.length,32);
  nearly(state.food,.08);nearly(sumFood(state),.08);
  assert.equal(a.hunger,hunger);
  const result=consumePellet(state,a.id,state.foodPellets[0].id);
  assert.equal(result.ok,false);assert.equal(a.hunger,hunger);
  advanceSimulation(state,1/60);
  assert.ok(a.hunger>hunger,'chemistry cannot distribute feed to distant fish');
  assert.equal(a.bites,0);
});

test('hungry fish actively seek, reach and eat pellets while a satiated fish leaves them',()=>{
  const state=fixture(),hungry=state.animals[0],full=state.animals[1];
  feed(state);
  const start={...hungry.position};
  advanceBehavior(state,.2);
  assert.equal(hungry.behavior,'seeking');assert.ok(hungry.targetFoodId);
  assert.notEqual(full.behavior,'seeking');assert.equal(full.targetFoodId,null);
  assert.ok(Math.hypot(hungry.velocity.x,hungry.velocity.y,hungry.velocity.z) > Math.hypot(full.velocity.x,full.velocity.y,full.velocity.z));
  assert.notDeepEqual(hungry.position,start);
  run(state,12);
  assert.ok(hungry.bites>0);assert.ok(hungry.hunger<40);
  assert.equal(full.bites,0);assert.equal(full.hunger,5);
  assert.ok(hungry.totalEatenGrams>0);assert.equal(hungry.lastMealHours,state.elapsedHours);
  nearly(state.food+hungry.totalEatenGrams,.08);
});

test('a contact bite affects only its eater, conserves mass and cannot overeat',()=>{
  const state=fixture(),a=state.animals[0],other=state.animals[1];
  feed(state);const pellet=state.foodPellets[0];a.position={x:pellet.x,y:pellet.y,z:pellet.z};
  const oldFood=state.food,oldWaste=state.detritus,oldAmmonia=state.water.ammonia,otherHunger=other.hunger;
  const bite=consumePellet(state,a.id,pellet.id);
  assert.equal(bite.ok,true);assert.equal(a.bites,1);assert.ok(a.biteFlash>0);
  nearly(oldFood-state.food,bite.grams);nearly(state.detritus-oldWaste,bite.grams*.35);
  nearly(state.water.ammonia-oldAmmonia,bite.grams*70/state.volumeLiters*.55);
  assert.equal(other.hunger,otherHunger);assert.equal(other.bites,0);
  assert.equal(consumePellet(state,a.id,pellet.id).ok,false,'bite cooldown prevents every-frame swallowing');
  a.biteCooldown=0;a.hunger=3;
  assert.equal(consumePellet(state,a.id,pellet.id).ok,false,'satiated fish stop eating');
  a.hunger=90;a.alive=false;
  assert.equal(consumePellet(state,a.id,pellet.id).ok,false,'dead fish cannot eat');
});

test('hungry fish get first access to a contested pellet and satiety releases targets',()=>{
  const state=fixture(),hungry=state.animals[0],lessHungry=state.animals[1];
  hungry.hunger=90;lessHungry.hunger=20;
  hungry.position={x:-1,y:2,z:0};lessHungry.position={x:1,y:2,z:0};
  state.foodPellets=[{id:'one',x:0,y:3,z:0,mass:.0025,ageSeconds:0,seed:.5}];state.food=.0025;
  advanceBehavior(state,.05);
  assert.equal(hungry.targetFoodId,'one');assert.equal(lessHungry.targetFoodId,null);
  hungry.hunger=2;advanceBehavior(state,.05);
  assert.equal(hungry.targetFoodId,null);assert.equal(lessHungry.targetFoodId,'one');
});

test('pellets settle for bottom dwellers, survive pause, and decay into water pollution',()=>{
  const state=createInitialState();state.animals=[];
  feed(state);
  run(state,45);
  assert.ok(state.foodPellets.every(p=>Math.abs(p.y-substrateHeight(p.x,p.z)-.04)<.002));
  const before=structuredClone(state);state.paused=true;
  advanceBehavior(state,20);
  assert.deepEqual(state.foodPellets,before.foodPellets);assert.equal(state.behaviorSeconds,before.behaviorSeconds);
  state.paused=false;const initialFood=state.food;
  advanceSimulation(state,12);
  assert.ok(state.food<initialFood);nearly(state.food,sumFood(state));assert.ok(state.water.ammonia>0);
});

test('shrimp approach settled food and only eat after physical contact',()=>{
  const state=createInitialState();state.animals=state.animals.filter(a=>a.species==='shrimp').slice(0,1);
  const shrimp=state.animals[0];shrimp.position={x:1,y:substrateHeight(1,0)+.025,z:0};shrimp.hunger=70;
  state.foodPellets=[{id:'bottom',x:0,y:substrateHeight(0,0)+.04,z:0,mass:.006,ageSeconds:50,seed:.2}];state.food=.006;
  advanceBehavior(state,.1);assert.equal(shrimp.bites,0);assert.equal(shrimp.behavior,'seeking');
  run(state,10);assert.ok(shrimp.bites>0);assert.ok(shrimp.hunger<70);
});

test('water changes and particle caps conserve food mass without deleting old leftovers',()=>{
  const state=createInitialState();
  for(let i=0;i<20;i++)feed(state);
  assert.ok(state.foodPellets.length<=MAX_FOOD_PELLETS);nearly(state.food,1.6);nearly(sumFood(state),1.6);
  changeWater(state,.25);nearly(state.food,1.2);nearly(sumFood(state),1.2);
  changeWater(state,1);assert.equal(state.food,0);assert.equal(state.foodPellets.length,0);
});

test('feeding a full legacy bed preserves every settled grain and adds fresh surface food', () => {
  const original = createInitialState();
  original.animals = [];
  for (let i = 0; i < 5; i++) feed(original);
  run(original, 45);
  // v0.6.1 could have all 160 slots occupied by settled pellets.
  const bed = original.foodPellets.map(({id,x,y,z,mass,seed,ageSeconds}) => ({id,x,y,z,mass,seed,ageSeconds}));
  assert.equal(bed.length, 160);
  assert.ok(bed.every(p => Math.abs(p.y - substrateHeight(p.x,p.z) - .04) < .002));
  const state = restoreState({ version:1, animals:[], foodPellets:bed });
  const oldIds = new Set(bed.map(p => p.id));
  feed(state);
  const byId = new Map(state.foodPellets.map(p => [p.id,p]));
  for (const p of bed) {
    const grain = byId.get(p.id);
    assert.ok(grain, `feeding removed settled pellet ${p.id}`);
    assert.deepEqual([grain.x,grain.y,grain.z,grain.mass], [p.x,p.y,p.z,p.mass]);
  }
  const fresh = state.foodPellets.filter(p => !oldIds.has(p.id));
  assert.ok(fresh.length > 0 && fresh.every(p => p.y > 3.8));
  nearly(fresh.reduce((sum,p) => sum + p.mass, 0), .08);
  run(state, 5);
  assert.ok(fresh.every(p => p.y > 3 && p.y < 3.6), 'fresh pellets actually sink through the water column');
  nearly(state.food, .48);
});

test('rapid feeding preserves underwater grains through congestion, save and eventual settling', () => {
  const state = createInitialState();
  state.animals = [];
  for (let i = 0; i < 5; i++) feed(state);
  run(state, 45);
  const bed = structuredClone(state.foodPellets);
  for (let i = 0; i < 5; i++) feed(state);
  run(state, 8);
  const submerged = structuredClone(state.foodPellets);
  assert.ok(submerged.some(p => p.y > 1 && p.y < 3.5), 'there is food partway down the water column');

  for (let i = 0; i < 24; i++) feed(state, 5);
  const byId = new Map(state.foodPellets.map(p => [p.id,p]));
  for (const p of submerged) assert.deepEqual(byId.get(p.id), p, 'a new feed must only affect surface food');
  assert.ok(state.foodPellets.some(p => p.y > 3.8));
  assert.ok(state.foodPellets.length <= MAX_FOOD_PELLETS);
  nearly(state.food, 120.8);
  const restored = restoreState(JSON.stringify(state));
  assert.deepEqual(restored.foodPellets, state.foodPellets);
  nearly(restored.food, state.food);

  run(restored, 3);
  const lowerIds = new Set(submerged.map(p => p.id));
  const waiting = restored.foodPellets.filter(p => !lowerIds.has(p.id));
  assert.ok(waiting.length > 0 && waiting.every(p => p.y > 3.8), 'fresh food waits at the surface while the water column is full');
  run(restored, 97);
  assert.ok(restored.foodPellets.every(p => Math.abs(p.y - substrateHeight(p.x,p.z) - .04) < .002));
  const settled = new Map(restored.foodPellets.map(p => [p.id,p]));
  for (const p of bed) {
    const grain = settled.get(p.id);
    assert.ok(grain, 'arriving food preserves the established bed');
    assert.deepEqual([grain.x,grain.y,grain.z], [p.x,p.y,p.z]);
    assert.ok(grain.mass >= p.mass);
  }
  nearly(sumFood(restored), 120.8);
  nearly(restored.food, 120.8);
});

test('old saves preserve IDs and health/hunger while migrating bulk leftovers',()=>{
  const state=createInitialState();const a=state.animals[0];a.health=63;a.hunger=89;
  const old={version:1,elapsedHours:55,food:.043,animals:[{id:a.id,species:a.species,seed:a.seed,health:a.health,hunger:a.hunger,alive:true}],plants:[]};
  const migrated=restoreState(old),again=restoreState(old);
  assert.equal(migrated.animals[0].id,a.id);assert.equal(migrated.animals[0].health,63);assert.equal(migrated.animals[0].hunger,89);
  assert.equal(migrated.animals[0].label,again.animals[0].label);assert.equal(migrated.animals[0].mass,again.animals[0].mass);
  nearly(migrated.food,.043);nearly(sumFood(migrated),.043);
  assert.ok(migrated.foodPellets.every(p=>p.ageSeconds>=40));
  const saved=restoreState(JSON.stringify(migrated));
  assert.deepEqual(saved.foodPellets,migrated.foodPellets);
});


test('fish abandon unreachable bottom remnants and respond to fresh surface food',()=>{
  const state=fixture(),a=state.animals[0];state.animals=[a];
  a.position={x:0,y:.67,z:.4};a.hunger=80;a.targetFoodId='settled';
  const floor=substrateHeight(0,.4)+.04;
  state.foodPellets=[{id:'settled',x:0,y:floor,z:.4,mass:.003,ageSeconds:100,seed:.3}];state.food=.003;
  feed(state);advanceBehavior(state,.1);
  assert.ok(a.targetFoodId&&a.targetFoodId!=='settled');
  run(state,12);assert.ok(a.bites>0);assert.ok(a.hunger<40);
  assert.ok(state.foodPellets.some(p=>p.id==='settled'),'bottom remnants remain for grazers');
});

test('malformed animal containers and pellet data cannot crash save migration',()=>{
  for(const animals of [{},null,12,'wrong']) {
    const restored=restoreState({version:1,animals,foodPellets:[null,{mass:NaN},{mass:-1}]});
    assert.equal(restored.animals.length,12);assert.equal(restored.food,0);
  }
});
