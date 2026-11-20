import assert from 'node:assert/strict';
import test from 'node:test';
import { animateFish, createFishModel } from '../src/fish-model.js';
import { fishMouth, suctionReach } from '../src/fish-feeding.js';
import { consumePellet, createInitialState, feed, SPECIES } from '../src/simulation.js';

test('fish strokes follow forward travel, settle against a wall and freeze on pause', () => {
  const model = createFishModel('neon',.23);
  const animal = {species:'neon', behavior:'seeking', velocity:{x:1.2,y:0,z:0}, position:{x:0,y:2,z:0}};
  const dt = 1/60;
  const {parts} = model.userData;
  function frame(dx, dz, seconds = dt) {
    animal.position.x += dx;
    animal.position.z += dz;
    const previous = model.userData.swimPhase;
    animateFish(model, animal, seconds, 1.2, 0);
    model.position.copy(animal.position);
    model.userData.positionInitialized = true;
    const angle = model.userData.swimPhase - previous;
    const [cosine,sine] = parts[0].morphTargetInfluences;
    return {angle:Math.atan2(Math.sin(angle),Math.cos(angle)), amplitude:Math.hypot(cosine,sine)};
  }

  frame(0,0,0);
  const cruise = frame(1.2*dt,0);
  assert.ok(cruise.angle/dt > 14 && cruise.amplitude > .8, 'chasing food gives a full propulsive stroke');
  let blocked;
  for (let i=0; i<60; i++) blocked = frame(0,0);
  assert.ok(blocked.angle/dt < 5 && blocked.amplitude < .2, 'an immobile fish holds station quietly');
  const nudged = frame(0,.07);
  assert.ok(nudged.angle/dt < 5 && nudged.amplitude < .2, 'a lateral contact imparts no forward stroke');
  const pose = parts.map(part => [...part.morphTargetInfluences]);
  for (let i=0; i<4; i++) assert.equal(frame(0,0,0).angle,0);
  assert.deepEqual(parts.map(part => part.morphTargetInfluences),pose);

  let resumed;
  for (let i=0; i<60; i++) resumed = frame(1.2*dt,0);
  assert.ok(Math.abs(cruise.amplitude-resumed.amplitude) < .001);
  assert.ok(Math.abs(cruise.angle-resumed.angle) < .001);
});

test('a cruising discus drives its rounded tail and ripples both long fin margins', () => {
  const model = createFishModel('discus',.4);
  const speed = SPECIES.discus.swim.cruiseSpeed;
  animateFish(model,{ species:'discus' },1/60,speed,0);
  const [body,tail,fins] = model.userData.parts;
  const intensity = Math.hypot(...tail.morphTargetInfluences);
  const coefficients = (part,i) => part.geometry.morphAttributes.position.slice(0,2).map(m => m.getZ(i)*intensity);
  function extreme(part, score) {
    const pos = part.geometry.attributes.position;
    let best = -Infinity, index = -1;
    for (let i=0; i<pos.count; i++) {
      const value = score(pos.getX(i),pos.getY(i),pos.getZ(i));
      if (value > best) { best = value; index = i; }
    }
    assert.ok(index >= 0);
    return index;
  }
  const tailTip = extreme(tail,x => -x);
  assert.ok(Math.hypot(...coefficients(tail,tailTip)) > .10, 'the tail tip sweeps over .20 units side to side');
  const head = extreme(body,x => x);
  assert.equal(Math.hypot(...coefficients(body,head)),0);

  for (const sign of [-1,1]) {
    const edge = extreme(fins,(x,y,z) => Math.abs(x+.16)<.018 && Math.abs(z)<.02 ? sign*y : -Infinity);
    const edgeX = fins.geometry.attributes.position.getX(edge);
    const bodyRing = extreme(body,x => -Math.abs(x-edgeX));
    const center = coefficients(body,bodyRing);
    const relative = coefficients(fins,edge).map((value,i) => value-center[i]);
    assert.ok(Math.hypot(...relative) > .025, 'the soft fin margin strokes independently of the body');
  }
});

const mouthOpening = model => {
  const {face,parts:[body]} = model.userData;
  const gape = face.morphTargetInfluences[face.morphTargetDictionary.gape];
  assert.equal(body.morphTargetInfluences[body.morphTargetDictionary.gape],gape);
  return gape;
};

test('breathing uses the tank clock, including in a paused or reopened tank', () => {
  for (const [species, spec] of Object.entries(SPECIES)) {
    if (spec.type !== 'fish') continue;
    const model = createFishModel(species,.23), fish = {species,alive:true,behavior:'resting'};
    const sample = (seconds,dt) => {
      animateFish(model,fish,dt,0,0,seconds);
      return mouthOpening(model);
    };
    const poses = Array.from({length:90},(_,frame)=>sample(87450+frame/60,1/60));
    assert.ok(Math.max(...poses)-Math.min(...poses)>.25,species+' breathes at rest');
    const paused = sample(87455,0);
    assert.equal(sample(87455,0),paused);
    const reopened = createFishModel(species,.23);
    animateFish(reopened,fish,0,0,0,87455);
    assert.equal(mouthOpening(reopened),paused);
    fish.alive=false;
    assert.equal(sample(87456,1/60),0);
    assert.equal(sample(87500,1/60),0);
  }
});

test('individuals breathe out of phase and gasp more deeply and frequently in low oxygen', () => {
  function record(seed, behavior) {
    const fish = {species:'discus',alive:true,behavior}, model = createFishModel(fish.species,seed);
    return Array.from({length:300},(_,frame)=>{
      animateFish(model,fish,1/60,0,0,frame/60);
      return mouthOpening(model);
    });
  }
  const normal=record(.21,'swimming'), other=record(.72,'swimming'), gasp=record(.21,'gasping');
  assert.ok(normal.some((value,i)=>Math.abs(value-other[i])>.2));
  const peaks = values => values.filter((v,i) => v>values[i-1] && v>=values[i+1]).length;
  assert.ok(peaks(gasp)>=1.7*peaks(normal));
  assert.ok(Math.max(...gasp)>Math.max(...normal)+.25);
});

test('paired gill covers lift behind the eyes after the jaw opens', () => {
  for (const [species,{type}] of Object.entries(SPECIES)) {
    if (type!=='fish') continue;
    const model=createFishModel(species,0), fish={species,alive:true,behavior:'swimming'};
    const body=model.userData.parts[0], gill=body.morphTargetDictionary.operculum;
    const shifts=body.geometry.morphAttributes.position[gill], skin=body.geometry.attributes;
    let left=0,right=0;
    for (let i=0;i<shifts.count;i++) {
      const dz=shifts.getZ(i);
      if (!dz) continue;
      assert.ok(skin.uv.getX(i)<.875 && dz*skin.position.getZ(i)>0,'each cover flares outward behind the jaws');
      left=Math.min(left,dz);right=Math.max(right,dz);
    }
    assert.ok(right>.01 && Math.abs(right+left)<1e-5,species+' has two mobile covers');
    let maxGape=-1,maxLift=-1,jawTick=0,gillTick=0;
    // The first local peak of each channel falls in the initial cycle.
    for(let tick=0;tick<=55;tick++){
      animateFish(model,fish,1/60,0,0,tick/60);
      const gape=mouthOpening(model),lift=body.morphTargetInfluences[gill];
      if(gape>maxGape){maxGape=gape;jawTick=tick;}
      if(lift>maxLift){maxLift=lift;gillTick=tick;}
    }
    assert.ok(gillTick-jawTick>=10 && gillTick-jawTick<=18,species+' vents after opening its mouth');
    const frozen=body.morphTargetInfluences[gill];
    animateFish(model,fish,0,0,0,55/60);
    assert.equal(body.morphTargetInfluences[gill],frozen);
    fish.alive=false; animateFish(model,fish,1/60,0,0,1);
    assert.equal(body.morphTargetInfluences[gill],0);
  }
});

test('a fish prepares its mouth for a nearby target and swallows on a successful bite', () => {
  const tank=createInitialState(), fish=tank.animals.find(a=>a.species==='neon');
  const model=createFishModel(fish.species,fish.seed);
  fish.position={x:0,y:2,z:0}; fish.velocity={x:.3,y:0,z:0};
  fish.hunger=90; fish.behavior='seeking';
  feed(tank);
  const pellet=tank.foodPellets[0];
  const lips=fishMouth(fish), reach=suctionReach(fish);
  Object.assign(pellet,{x:lips.x+3*reach,y:lips.y,z:lips.z});
  function pose(elapsed=0) {
    animateFish(model,fish,1/60,.3,0,elapsed,pellet);
    return mouthOpening(model);
  }
  const cruising=pose();
  pellet.x=fish.position.x;
  assert.equal(pose(),cruising,'food behind the fish does not open the jaw');
  pellet.x=lips.x+.75*reach;
  assert.ok(pose()>.5);
  assert.equal(consumePellet(tank,fish.id,pellet.id).ok,false);
  pellet.x=lips.x;
  assert.equal(consumePellet(tank,fish.id,pellet.id).ok,true);
  const atCapture=pose();
  fish.biteFlash-=.075;
  assert.ok(atCapture>=.55 && pose(.075)>.98);
  fish.biteFlash-=.30;
  assert.ok(pose(.375)<.45,'the jaw returns to breathing after the strike');
});
