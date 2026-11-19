import assert from 'node:assert/strict';
import test from 'node:test';
import { animateFish, createFishModel } from '../src/fish-model.js';
import { SPECIES } from '../src/simulation.js';

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
    return {angle:Math.atan2(Math.sin(angle),Math.cos(angle)), amplitude:Math.hypot(...parts[0].morphTargetInfluences)};
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
  const coefficients = (part,i) => part.geometry.morphAttributes.position.map(m => m.getZ(i)*intensity);
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
