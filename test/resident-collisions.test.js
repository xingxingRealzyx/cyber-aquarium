import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix3, Matrix4, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { createFishModel } from '../src/fish-model.js';
import { makeResidentBox, residentSkinBounds, resolveResidentContacts } from '../src/resident-collisions.js';
import { createInitialState, restoreState, SPECIES, substrateHeight } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';

function resident(id, species, position, size = 1) {
  return { id, species, position: { ...position }, size, alive: true, seed: .35, mass: 1, corpseMass: 1,
    velocity: { x: .5, y: 0, z: 0 } };
}
function collider(animal, seconds = 0) {
  const box = makeResidentBox(animal, seconds);
  return new OBB(box.center.clone(), new Vector3(...box.half),
    new Matrix3().setFromMatrix4(new Matrix4().makeBasis(...box.axes)));
}

test('each species box contains the animated mesh, including tails and angelfish fins', () => {
  for (const [species, definition] of Object.entries(SPECIES)) {
    if (definition.type !== 'fish') continue;
    const a = resident('resident', species, { x: 0,y: 0,z: 0 });
    const model = createFishModel(species,.5);
    const { bounds } = makeResidentBox(a);
    const vertex = new Vector3();
    for (const part of model.children.filter(o => o.visible)) {
      const positions = part.geometry.attributes.position, morphs = part.geometry.morphAttributes.position;
      for (let i=0; i<positions.count; i++) {
        vertex.fromBufferAttribute(positions,i);
        const amplitude = morphs ? .9 * Math.hypot(morphs[0].getZ(i),morphs[1].getZ(i)) : 0;
        vertex.z -= amplitude;
        assert.ok(bounds.containsPoint(vertex), species + ' negative fin stroke');
        vertex.z += 2*amplitude;
        assert.ok(bounds.containsPoint(vertex), species + ' positive fin stroke');
      }
    }
    model.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('discus has a deep, laterally compressed body and a rounded caudal fin', () => {
  const model = createFishModel('discus', .25);
  const [body, tail] = model.userData.parts;
  const dimensions = new Box3().setFromBufferAttribute(body.geometry.attributes.position).getSize(new Vector3());
  assert.ok(dimensions.y / dimensions.x > .74, 'the disc stays round in profile');
  assert.ok(dimensions.z / dimensions.y < .40, 'the frontal view is narrow');
  const positions = tail.geometry.attributes.position;
  let middle = Infinity, tip = Infinity;
  for (let i = 0; i < positions.count; i++) {
    const y = Math.abs(positions.getY(i));
    if (y < .015) middle = Math.min(middle, positions.getX(i));
    if (y > .115) tip = Math.min(tip, positions.getX(i));
  }
  assert.ok(Number.isFinite(tip) && middle < tip - .05, 'middle caudal rays extend beyond the outer rays');
  model.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});

test('rotated adult and juvenile boxes separate while disjoint fish in overlapping broadphase boxes stay put', () => {
  const a = resident('a','zebra',{x:0,y:2,z:0});
  const b = resident('b','guppy',{x:.22,y:2.01,z:0}, .4);
  b.velocity = {x:0,y:.2,z:.5};
  resolveResidentContacts([a,b],0);
  assert.equal(collider(a).intersectsOBB(collider(b)),false);
  // Parallel diagonal fish fit side by side even though their AABBs overlap.
  a.velocity = {x:.5,y:0,z:.5};
  const c = resident('c','zebra',{x:a.position.x-.37,y:a.position.y,z:a.position.z+.37});
  c.velocity = {...a.velocity};
  assert.ok(makeResidentBox(c).bounds.intersectsBox(makeResidentBox(a).bounds));
  assert.equal(collider(a).intersectsOBB(collider(c)), false);
  const before = [structuredClone(a.position),structuredClone(c.position)];
  resolveResidentContacts([a,c],0);
  assert.deepEqual([a.position,c.position],before);
});

test('adult fins clear glass, substrate and surface at different pitches and when a corpse rolls sideways', () => {
  for (const alive of [true,false]) for (const heading of [-1,1]) {
    const a = resident('fish','angelfish',{x:3.64,y:alive ? .68 : 4,z:1.64},1.3);
    a.velocity = {x:heading,y:heading,z:heading};
    a.alive=alive; a.deathHeading=1.1; a.deathBehaviorSeconds=0;
    resolveResidentContacts([a],7);
    const bounds = residentSkinBounds(a,7);
    assert.ok(bounds.max.x <= 3.980001 && bounds.max.z <= 1.980001 && bounds.max.y <= 4.135001);
    assert.ok(bounds.min.y >= substrateHeight(a.position.x,a.position.z));
  }
});

test('even coincident grazers separate along the bed and corpse contacts do not change swimming velocity', () => {
  const a = resident('snail','snail',{x:1,y:substrateHeight(1,0)+.025,z:0});
  const b = resident('shrimp','shrimp',a.position);
  resolveResidentContacts([a,b],0);
  assert.equal(collider(a).intersectsOBB(collider(b)),false);
  for (const g of [a,b]) assert.equal(g.position.y,substrateHeight(g.position.x,g.position.z)+.025);
  const live = resident('live','neon',{x:0,y:2,z:0});
  const dead = resident('dead','guppy',{x:0,y:2,z:0});
  dead.alive=false; dead.deathHeading=.4;
  resolveResidentContacts([live,dead],10);
  assert.equal(collider(live,10).intersectsOBB(collider(dead,10)),false);
  assert.deepEqual(live.velocity,{x:.5,y:0,z:0});
});

test('an older save with a shrimp antenna outside the glass recovers on its first tick and keeps foraging', () => {
  const state = createInitialState();
  const shrimp = state.animals.find(a => a.species === 'shrimp');
  state.animals = [shrimp];
  shrimp.size = 1.2;
  shrimp.position = { x:3.65, y:substrateHeight(3.65,.2)+.025, z:.2 };
  shrimp.velocity = { x:.1,y:0,z:0 };
  const saved = restoreState(JSON.stringify(state));
  const restored = saved.animals[0];
  assert.ok(residentSkinBounds(restored).max.x > 3.98);
  advanceBehavior(saved,1/30);
  assert.ok(residentSkinBounds(restored).max.x < 3.980001);
  const first = {...restored.position};
  advanceBehavior(saved,8);
  assert.ok(Math.hypot(restored.position.x-first.x,restored.position.z-first.z) > .15);
});

test('fast small fry approaching head-on cannot skip the first contact between ticks', () => {
  const state = createInitialState();
  state.animals = state.animals.slice(0,2);
  for (const [i,a] of state.animals.entries()) {
    a.size=.2; a.hunger=30;
    a.position={x:i ? .10 : -.10, y:2.5, z:0};
    a.velocity={x:i ? -4 : 4,y:0,z:0};
  }
  advanceBehavior(state,1/30);
  const [a,b]=state.animals;
  assert.ok(a.position.x < b.position.x, 'the fry meet before passing each other');
  assert.equal(collider(a).intersectsOBB(collider(b)),false);
});
