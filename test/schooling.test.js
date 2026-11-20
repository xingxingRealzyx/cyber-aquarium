import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { advanceBehavior } from '../src/behavior.js';
import { applySchoolSteering, sampleFish } from '../src/schooling.js';
import { createInitialState, restoreState, SPECIES, substrateHeight } from '../src/simulation.js';

function pair(species = 'neon') {
  const tank = createInitialState();
  const [focal, neighbour] = tank.animals;
  tank.animals = [focal, neighbour];
  for (const [i, a] of tank.animals.entries()) {
    Object.assign(a, {
      id: 'fish-' + i, species: i === 0 ? 'neon' : species, serial: i + 1,
      hunger: 30 - i, health: 100, size: .8, seed: .15, metabolism: 1,
      position: { x: -.75 + i * .8, y: 2.4, z: 0 }, velocity: { x: .5, y: 0, z: 0 },
    });
  }
  return tank;
}

test('an open-water cruise carries speed through a broad turn', () => {
  const tank = pair(), fish = tank.animals[0];
  tank.animals = [fish];
  tank.behaviorSeconds = 40;
  fish.seed = .75;
  fish.position = {x:1.2, y:2.35, z:.15};
  fish.velocity = {x:.5, y:0, z:0};
  // The individual route is now astern, well clear of the glass and rocks.
  let previousYaw = 0;
  for (let frame = 0; frame < 60; frame++) {
    const p = {...fish.position};
    advanceBehavior(tank, 1/60);
    const yaw = Math.atan2(fish.velocity.z, fish.velocity.x);
    const speed = 60 * Math.hypot(fish.position.x-p.x, fish.position.y-p.y, fish.position.z-p.z);
    assert.ok(Math.abs(yaw-previousYaw) * 60 < .95, 'cruising should use a wider arc than pursuit');
    assert.ok(speed > .25, 'the fish keeps advancing while it comes around');
    previousYaw = yaw;
  }
  assert.ok(Math.abs(previousYaw) > .4, 'the fish still follows its new course');
});

test('a tetra steers with the heading of a nearby tetra', () => {
  const tank = pair(), opposite = structuredClone(tank);
  // The neighbour occupies exactly the same spot in both runs. Only its heading differs.
  tank.animals[1].velocity = { x: 0, y: 0, z: .5 };
  opposite.animals[1].velocity = { x: 0, y: 0, z: -.5 };
  advanceBehavior(tank, 1 / 30);
  advanceBehavior(opposite, 1 / 30);
  assert.ok(tank.animals[0].velocity.z > opposite.animals[0].velocity.z + .001,
    'the focal fish responds before the neighbours have travelled apart');
});

test('every stockable fish species schools with a peer and flees an approaching diver', () => {
  for (const [species, profile] of Object.entries(SPECIES)) {
    if (profile.type !== 'fish') continue;
    const tank = pair(species);
    tank.animals[0].species = species;
    advanceBehavior(tank, 1 / 30);
    assert.ok(tank.animals.every(a => a.behavior === 'schooling'), species);
    const scene = { avoid: () => ({ author: { x: 1, y: 0, z: 0, distance: .25 } }) };
    advanceBehavior(tank, .6, scene);
    for (const a of tank.animals) {
      assert.equal(a.behavior, 'evading', species);
      assert.ok(a.velocity.x > .8, species);
    }
  }
});

test('a cruising tetra closes the gap to its own kind and ignores a distant or unrelated fish', () => {
  function displacement(species, distance) {
    const initial = pair(species);
    function followAt(z) {
      const tank = structuredClone(initial), peer = tank.animals[1];
      // Keep the peer on a parallel course so matching its heading alone cannot close the gap.
      for (let frame = 0; frame < 30; frame++) {
        peer.position = { x: -.6 + .5 * frame / 30, y: 2.4, z };
        peer.velocity = { x: .5, y: 0, z: 0 };
        advanceBehavior(tank, 1 / 30);
      }
      return tank.animals[0].position.z;
    }
    return followAt(distance) - followAt(-distance);
  }
  assert.ok(displacement('neon', 1) > .025, 'moves towards the nearby schoolmate');
  assert.ok(Math.abs(displacement('guppy', 1)) < 1e-8, 'does not school with a guppy');
  const alone = pair(), far = structuredClone(alone);
  alone.animals.length = 1;
  far.animals[1].position = { x: 3, y: 3.5, z: -1.5 };
  advanceBehavior(alone, .5);
  advanceBehavior(far, .5);
  assert.deepEqual(far.animals[0].position, alone.animals[0].position);
});

test('tightly spaced fish open a gap even when swimming in the same direction', () => {
  for (const species of ['neon', 'guppy']) {
    const tank = pair(species);
    const [first, second] = tank.animals;
    first.position.z = -.08;
    second.position = { ...first.position, z: .08 };
    advanceBehavior(tank, .9);
    assert.ok(second.position.z - first.position.z > .2, species + ' pair should separate');
  }
});

test('a fish braking over bottom food can finish beside a neighbour', () => {
  const { animals }=pair(), [fish, neighbour]=animals;
  const floor=substrateHeight(fish.position.x,fish.position.z);
  function sideways(height, gap, feeding) {
    fish.position.y=floor+height;
    neighbour.position={...fish.position,z:fish.position.z+gap};
    const goal={x:.03,y:-.01,z:0};
    applySchoolSteering(fish,sampleFish(animals),goal,1.6,0,feeding);
    return Math.abs(goal.z);
  }
  assert.ok(sideways(1.5,.55,true)>.05, 'water-column pursuit leaves room to turn');
  assert.ok(sideways(.25,.55,false)>.05, 'ordinary bottom cruising keeps its spacing');
  assert.equal(sideways(.25,.55,true),0, 'two separate feeding lanes fit over the sand');
  const close=sideways(.25,.18,true);
  assert.ok(close>0 && close<.03, 'nearer fins still steer apart at the pace of the last stroke');
});

test('adult fish make room before a neighbour reaches their fins', () => {
  const { animals } = pair('guppy');
  const [first, second] = animals;
  first.size = second.size = 1;
  second.position = { ...first.position, x: first.position.x + 1 };
  const neighbours = sampleFish(animals);
  const firstGoal = { ...first.velocity }, secondGoal = { ...second.velocity };
  applySchoolSteering(first, neighbours, firstGoal, .5, 0, false);
  applySchoolSteering(second, neighbours, secondGoal, .5, 0, false);
  assert.ok(firstGoal.x < first.velocity.x - .05 && secondGoal.x > second.velocity.x + .05);
});

test('two approaching groups can swim through a crowded tank without bouncing between neighbours', () => {
  const tank = pair(), template = tank.animals[0];
  tank.animals = Array.from({ length: 18 }, (_, i) => {
    const lane = i % 3, column = Math.floor(i / 3);
    return { ...structuredClone(template), id: 'swimmer-' + i, serial: i + 1,
      species: lane === 0 ? 'angelfish' : 'harlequin', size: lane === 0 ? 1.1 : .8,
      hunger: 40, seed: (i + .5) / 18,
      position: { x: (column - 2.5) * 1.05, y: 2.3, z: (lane - 1) * .45 },
      velocity: { x: column < 3 ? .75 : -.75, y: 0, z: 0 } };
  });
  const starts = tank.animals.map(a => new Vector3().copy(a.position));
  const positions = starts.map(p => p.clone()), previous = starts.map(() => new Vector3());
  const farthest = starts.map(() => 0);
  const step = new Vector3();
  for (let frame = 0; frame < 600; frame++) {
    advanceBehavior(tank, 1 / 60);
    for (const [i, a] of tank.animals.entries()) {
      step.subVectors(a.position, positions[i]);
      const length = step.length(), prior = previous[i].length();
      if (Math.min(length, prior) > .004) {
        assert.ok(step.dot(previous[i]) >= -.6 * length * prior,
          a.id + ' bounced back in the next frame at cruising speed');
      }
      positions[i].copy(a.position);
      farthest[i] = Math.max(farthest[i], positions[i].distanceTo(starts[i]));
      previous[i].copy(step);
    }
  }
  assert.ok(farthest.every(distance => distance > .2), 'every fish swam out, including those that circled back');
});

test('a hungry tetra can turn away from a nearby group to reach food', () => {
  const tank = pair();
  const [hungry, neighbour] = tank.animals;
  hungry.hunger = 85;
  neighbour.hunger = 2;
  const other = structuredClone(neighbour);
  Object.assign(other, { id: 'third', serial: 3 });
  other.position.z += .6;
  tank.animals.push(other);
  tank.food = .0015;
  tank.foodPellets = [{ id: 'pellet', x: -1.8, y: 2.9, z: -.4, seed: .4, ageSeconds: 0, mass: tank.food }];
  advanceBehavior(tank, .1);
  assert.equal(hungry.targetFoodId, 'pellet');
  advanceBehavior(tank, 7);
  assert.ok(hungry.bites > 0);
  assert.equal(neighbour.bites + other.bites, 0);
});

test('a nearby author interrupts pursuit, accelerates the fish away and then releases it to feed', () => {
  const tank = pair();
  const fish = tank.animals[0];
  tank.animals = [fish];
  fish.hunger = 75;
  tank.food = .001;
  tank.foodPellets = [{id:'behind', x:-1.7, y:2.6, z:0, seed:.2, mass:.001, ageSeconds:0}];
  const origin = fish.position.x;
  const scene = {
    avoid: () => ({author:{x:1, y:0, z:0, distance:.3}}),
    blocksFood: () => false,
  };
  advanceBehavior(tank, .6, scene);
  assert.equal(fish.behavior, 'evading');
  assert.equal(fish.targetFoodId, null);
  assert.ok(fish.velocity.x > 1 && fish.position.x > origin + .5);
  // The diver's moving limbs cross the entry distance during a stroke.
  // The fish should finish escaping before turning around for the pellet.
  scene.avoid = () => ({author:{x:1,y:0,z:0,distance:1.18}});
  advanceBehavior(tank, .2, scene);
  assert.equal(fish.behavior, 'evading');
  assert.equal(fish.targetFoodId, null);
  scene.avoid = () => ({author:{x:1,y:0,z:0,distance:1.34}});
  advanceBehavior(tank, 1 / 30, scene);
  assert.equal(fish.behavior, 'seeking');
  assert.equal(fish.targetFoodId, 'behind');
});

test('a fish bends its path less for a leaf than a solid and can still reach food among leaves', () => {
  const initial = pair();
  initial.animals.length = 1;
  initial.animals[0].hunger = 80;
  initial.food = .001;
  initial.foodPellets = [{ id: 'pellet', x: .8, y: 2.4, z: 0, mass: initial.food, seed: .2, ageSeconds: 0 }];
  const surface = { x: 0, y: 0, z: 1, distance: .01 };
  function approach(nearby) {
    const tank = structuredClone(initial);
    const scene = { avoid: () => nearby, blocksFood: () => false };
    advanceBehavior(tank, .5, scene);
    const offset = tank.animals[0].position.z;
    advanceBehavior(tank, 2, scene);
    return { offset, bites: tank.animals[0].bites };
  }
  const open = approach({}), leaves = approach({ foliage: surface }), solid = approach({ obstacle: surface });
  assert.ok(leaves.offset > open.offset + .01);
  assert.ok(solid.offset > leaves.offset + .1);
  assert.ok(leaves.bites > 0);
});

test('a brief sighting travels in delayed, weakening steps through a school and dies out', () => {
  const tank=pair(), template=tank.animals[0];
  tank.animals=[-2.65,-1.55,-.45,.65,-1.55,2.9].map((x,i)=>({
    ...structuredClone(template), id:'alarm-'+i, serial:i+1, species:i===4?'guppy':'neon',
    seed:.2+.035*i, size:.5, position:{x,y:i===5?3.2:2.3,z:i===4?.82:i===5?1.3:0},
    velocity:{x:.35,y:0,z:0},
  }));
  const first=tank.animals[0], scene={
    avoid:a=>a===first && tank.behaviorSeconds<.14 ? {author:{x:0,y:0,z:1,distance:.54}} : {},
  };
  const alarms=new Map(), recovered=new Set();
  for (let frame=0;frame<180;frame++) {
    advanceBehavior(tank,1/30,scene);
    for (const a of tank.animals) {
      if (a.schoolAlarm && !alarms.has(a.id)) alarms.set(a.id,{...a.schoolAlarm});
      if (a.behavior==='regrouping') recovered.add(a.id);
    }
    if (frame===23) {
      const [lead,second,third]=tank.animals;
      assert.ok(second.velocity.z>.3 && third.velocity.z>.06,'followers turn in the escape direction');
      const frozen=JSON.stringify(tank.animals.map(a=>a.schoolAlarm));
      tank.paused=true;
      advanceBehavior(tank,2,scene);
      assert.equal(JSON.stringify(tank.animals.map(a=>a.schoolAlarm)),frozen);
      const saved=restoreState(JSON.stringify(tank));
      for (const a of [lead,second,third]) {
        const restored=saved.animals.find(other=>other.id===a.id);
        assert.deepEqual(restored.schoolAlarm,a.schoolAlarm);
        assert.equal(restored.behavior,a.behavior);
      }
      tank.paused=false;
    }
  }
  const [lead,second,third]=[...alarms.values()];
  assert.deepEqual([...alarms.keys()],['alarm-0','alarm-1','alarm-2'],
    'a third hop, a different species and a distant fish remain uninvolved');
  assert.deepEqual([lead.hops,second.hops,third.hops],[0,1,2]);
  assert.ok(second.started>lead.started+.15 && third.started>second.started+.15);
  assert.ok(lead.strength>second.strength && second.strength>third.strength);
  assert.deepEqual(recovered,new Set(alarms.keys()));
  assert.ok(tank.animals.every(a=>!a.schoolAlarm),'neighbours cannot keep one another in an alarm loop');
});

test('a separated fish can rejoin its own school from beyond ordinary following distance', () => {
  const tank=pair(), [a,b]=tank.animals;
  a.position={x:0,y:2.3,z:-1.25}; b.position={x:0,y:2.3,z:1.25};
  function steer(regroup) {
    const goal={...a.velocity};
    const follows=applySchoolSteering(a,sampleFish(tank.animals),goal,.5,.84,false,regroup);
    return {follows,z:goal.z};
  }
  assert.equal(steer(0).follows,false);
  const joined=steer(1);
  assert.ok(joined.follows && joined.z>.06,'heads back towards the straggling schoolmate');
  b.species='guppy';
  assert.equal(steer(1).follows,false);
});
