import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix3, Matrix4, Raycaster, Texture, TextureLoader, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { createFishModel } from '../src/fish-model.js';
import { createShrimpModel, animateShrimp } from '../src/shrimp-model.js';
import { createSnailModel, animateSnail } from '../src/snail-model.js';
import { makeResidentBox, moveResident, placeNewResidents, residentSkinBounds, resolveResidentContacts } from '../src/resident-collisions.js';
import { addAnimal, createInitialState, restoreState, SPECIES, substrateHeight } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';
import { createHardscape } from '../src/hardscape.js';
import { createSceneCollisions } from '../src/scene-collisions.js';

function resident(id, species, position, size = 1) {
  return { id, species, position: { ...position }, size, alive: true, seed: .35, mass: 1, corpseMass: 1,
    velocity: { x: .5, y: 0, z: 0 } };
}
function collider(animal, seconds = 0) {
  const box = makeResidentBox(animal, seconds);
  return new OBB(box.center.clone(), new Vector3(...box.half),
    new Matrix3().setFromMatrix4(new Matrix4().makeBasis(...box.axes)));
}
// Independent check against the mesh sections that include every fin stroke.
// Two swimmers may share a broadphase box corner while all sections are clear.
function skinSections(animal, seconds) {
  const box = makeResidentBox(animal, seconds);
  if (!box.outline.slices) return [collider(animal, seconds)];
  const rotation = new Matrix3().setFromMatrix4(new Matrix4().makeBasis(...box.axes));
  const b = box.outline.bounds;
  const scale = new Vector3(...box.half.map((h,i) => 2*h/(b[2*i+1]-b[2*i])));
  return box.outline.slices.map(({ center, half }) => new OBB(
    center.clone().multiply(scale).applyMatrix3(rotation).add(animal.position),
    half.clone().multiply(scale), rotation));
}
function meshesOverlap(a, b, seconds = 0) {
  const first = skinSections(a, seconds), second = skinSections(b, seconds);
  return first.some(x => second.some(y => x.intersectsOBB(y)));
}

function visitFishExtremes(model,visit) {
  const vertex=new Vector3(), shift=new Vector3();
  for (const mesh of model.children) {
    const positions=mesh.geometry.attributes.position, morphs=mesh.geometry.morphAttributes.position;
    const jaw=morphs?.[mesh.morphTargetDictionary?.gape];
    const gill=morphs?.[mesh.morphTargetDictionary?.operculum];
    for (let i=0;i<positions.count;i++) {
      const stroke=mesh===model.userData.face ? 0 : .9*Math.hypot(morphs[0].getZ(i),morphs[1].getZ(i));
      if (jaw) shift.fromBufferAttribute(jaw,i);
      if (gill && gill.getZ(i)!==0) {
        assert.equal(shift.lengthSq(),0,'the jaws and covers have separate attachments');
        shift.fromBufferAttribute(gill,i);
      }
      for (const open of jaw ? [false,true] : [false]) {
        vertex.fromBufferAttribute(positions,i);
        if (open) vertex.add(shift);
        vertex.z-=stroke;visit(vertex);
        if (stroke>0) { vertex.z+=2*stroke;visit(vertex); }
      }
    }
  }
}

test('each species box contains its closed and open jaws as well as swimming fins', () => {
  for (const [species, definition] of Object.entries(SPECIES)) {
    if (definition.type !== 'fish') continue;
    const a = resident('resident', species, { x: 0,y: 0,z: 0 });
    const model = createFishModel(species,.5);
    const { bounds } = makeResidentBox(a);
    visitFishExtremes(model,vertex=>assert.ok(bounds.containsPoint(vertex),species+' animated skin'));
    model.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('opening each fish mouth exposes a recessed cavity through the textured skin', () => {
  for (const [species,definition] of Object.entries(SPECIES)) {
    if (definition.type!=='fish') continue;
    const model=createFishModel(species,.5), {parts:[skin],face}=model.userData;
    const vertices=skin.geometry.attributes.position;
    let tip=0;
    for (let i=1;i<vertices.count;i++) if (vertices.getX(i)>vertices.getX(tip)) tip=i;
    const ray=new Raycaster(new Vector3(1,vertices.getY(tip)-.008,0),new Vector3(-1,0,0));
    const surfaces=[skin,face];
    const closed=ray.intersectObjects(surfaces)[0];
    assert.equal(closed?.object,skin,species+' has an intact lower jaw when closed');
    for (const opening of [.22,1]) {
      for (const mesh of surfaces) mesh.morphTargetInfluences[mesh.morphTargetDictionary.gape]=opening;
      const hit=ray.intersectObjects(surfaces)[0];
      assert.equal(hit?.object,face,species+' has an opening into the oral lining');
      assert.ok(closed.point.x-hit.point.x>.015,species+' has visible depth behind the lips');
    }
    model.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
});

test('walking and grazing keep the shrimp antennae, snail shell and soft parts inside their contact bounds', () => {
  for (const [species, create, animate, speed] of [
    ['shrimp', createShrimpModel, animateShrimp, .22],
    ['snail', createSnailModel, animateSnail, .075],
  ]) {
    const animal = resident(species, species, { x: 0, y: 0, z: 0 });
    const bounds = residentSkinBounds(animal);
    const model = create(animal.seed);
    const skin = new Box3();
    for (let frame = 0; frame < 180; frame++) {
      const feeding = frame >= 90;
      animate(model, 1 / 30, feeding ? 0 : speed, feeding);
      if (frame % 3 === 0) {
        skin.setFromObject(model, true);
        assert.ok(bounds.containsBox(skin), species + ' outside contact bounds at frame ' + frame);
      }
    }
  }
});

test('a pitched fish has the same clearance under the waterline as its rendered fins', () => {
  const fish = resident('near-surface','harlequin',{x:2.58, y:3.828, z:0},1.12);
  fish.velocity = {x:-.174, y:.143, z:.110};
  const box = makeResidentBox(fish);
  const skin = residentSkinBounds(fish);
  const model = createFishModel(fish.species,.5);
  let highest = -Infinity;
  visitFishExtremes(model,vertex=>{
    const up=box.axes[0].y*vertex.x+box.axes[1].y*vertex.y+box.axes[2].y*vertex.z;
    highest=Math.max(highest,fish.position.y+fish.size*up);
  });
  assert.ok(skin.max.y >= highest && skin.max.y - highest < .003);
  assert.ok(skin.max.y < 4.10, 'there is room to move up and let the drifting diver pass underneath');
  model.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
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

test('rotated adult and juvenile mesh envelopes separate while disjoint fish in overlapping broadphase boxes stay put', () => {
  const a = resident('a','zebra',{x:0,y:2,z:0});
  const b = resident('b','guppy',{x:.22,y:2.01,z:0}, .4);
  b.velocity = {x:0,y:.2,z:.5};
  resolveResidentContacts([a,b],0);
  assert.equal(meshesOverlap(a,b),false);
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

test('a swimmer inside the empty corner beside an angelfish fin travels without a collision impulse', () => {
  const angel = resident('angel','angelfish',{x:0,y:2,z:0},1.2);
  const tetra = resident('tetra','neon',{x:.40,y:2.49,z:0},.4);
  assert.ok(collider(angel).intersectsOBB(collider(tetra)));
  assert.equal(meshesOverlap(angel,tetra),false);
  const tetraStart = { ...tetra.position };
  const angelStart = { ...angel.position };
  for (let f=0; f<18; f++) resolveResidentContacts([angel,tetra],f/60);
  assert.deepEqual(tetra.position,tetraStart);
  assert.deepEqual(angel.position,angelStart);
});

// One behavior step of a resident swimming straight along its heading.
function swim(animal, animals, scene, dt = 1/60) {
  const start = { ...animal.position }, heading = { ...animal.velocity };
  for (const other of animals) makeResidentBox(other);
  for (const axis of ['x','y','z']) animal.position[axis] += animal.velocity[axis]*dt;
  return { start, exit: moveResident(animal, start, heading, animals, 0, scene) };
}

test('a resident swimming into a neighbour is held back without displacing the neighbour', () => {
  const a = resident('shrimp-a','shrimp',{x:0,y:substrateHeight(0,0)+.025,z:0});
  const b = resident('shrimp-b','shrimp',{x:.70,y:substrateHeight(.70,0)+.025,z:0});
  a.velocity.x = .25; b.velocity.x = 0;
  const still = structuredClone(b.position);
  let held = null;
  for (let frame=0; frame<120 && !held; frame++) {
    const { start, exit } = swim(a,[a,b]);
    held = exit;
    assert.ok(a.position.x >= start.x && a.position.z === start.z, 'never moved off its own path');
    assert.equal(meshesOverlap(a,b),false);
  }
  assert.ok(held?.resident && held.x < -.5, 'stopped by the neighbour ahead');
  assert.deepEqual(b.position,still);
});

test('a crowded, slowly turning angelfish only pivots as far as one stroke permits', () => {
  const a = resident('center','angelfish',{x:0,y:2,z:0},1.17036);
  const b = resident('right','angelfish',{x:.70186,y:2.32402,z:-.49187},1.07232);
  const c = resident('left','harlequin',{x:-.71990,y:2.03487,z:-.34049},1.11483);
  a.velocity = {x:-.0505336,y:-.0175652,z:-.0287080};
  b.velocity = {x:-.01495,y:-.03924,z:-.07883};
  c.velocity = {x:-.29340,y:-.04308,z:.14214};
  const group = [a,b,c], dt = 1/60, backOff = .12*dt;
  for (const other of group) makeResidentBox(other);
  const start = {...a.position}, heading = {...a.velocity};
  a.velocity = {x:-.0504803,y:-.0177550,z:-.0270967};
  for (const axis of ['x','y','z']) a.position[axis] += dt*a.velocity[axis];
  const limit = backOff + new Vector3().copy(start).distanceTo(a.position);
  assert.ok(moveResident(a,start,heading,group,0,undefined,backOff)?.resident);
  assert.ok(new Vector3().copy(start).distanceTo(a.position) <= limit + 1e-9);
});

test('a discus at a slanted rock and a pane can retreat along both faces to turn', () => {
  const a = resident('wedged','discus',{x:0,y:1.4,z:0});
  a.velocity = {x:-.02115,y:.01223,z:-.01603};
  a.position.z += 1.98 - residentSkinBounds(a).max.z;
  const start = {...a.position}, heading = {...a.velocity};
  const n = Math.SQRT1_2;
  const stone = { contacts(box,visit) {
    const p = box.animal.position, depth = (start.x-p.x + start.z-p.z)*n;
    if (depth > 0) visit(stone,depth,n,0,n);
  } };
  a.velocity = {x:-.02071,y:.01237,z:-.01650};
  for (const axis of ['x','y','z']) a.position[axis] += a.velocity[axis]/60;
  assert.ok(moveResident(a,start,heading,[a],0,stone,.12/60));
  const dx = a.position.x-start.x, dz = a.position.z-start.z;
  assert.ok(dx > .0005 && dz < -.0005 && dx+dz >= -1e-10);
  assert.ok(residentSkinBounds(a).max.z <= 1.98);
});

test('a fish between parallel faces can swim along their plane before it has room to turn', () => {
  const a = resident('wedged','harlequin',{x:0,y:1.4,z:0},1.235);
  a.velocity = {x:-.03377,y:-.04922,z:-.02751};
  a.position.z += 1.98 - residentSkinBounds(a).max.z;
  const start = {...a.position}, heading = {...a.velocity};
  const n = Math.sqrt(1/3);
  const stone = { contacts(box,visit) {
    const p = box.animal.position;
    if (p.z < start.z) visit('flat', start.z-p.z, 0,0,1);
    const depth = (start.x-p.x + start.y-p.y + start.z-p.z)*n;
    if (depth > 0) visit('slope',depth,n,n,n);
  } };
  a.velocity = {x:-.03347,y:-.04870,z:-.02856};
  for (const axis of ['x','y','z']) a.position[axis] += a.velocity[axis]/60;
  assert.ok(moveResident(a,start,heading,[a],0,stone,.12/60));
  assert.equal(a.position.z,start.z);
  assert.ok(a.position.x-start.x + a.position.y-start.y > .001);
  assert.ok(residentSkinBounds(a).max.z <= 1.98);
});

test('stocking and hatching find nearby space without shifting existing residents, even when paused', () => {
  for (const species of ['discus','shrimp']) {
    const p = {x:.16,y:species==='shrimp' ? substrateHeight(.16,0)+.025 : 2,z:0};
    const parent = resident('parent',species,p);
    const state = { animals:[parent], behaviorSeconds:27, paused:true };
    const solid = box => box.bounds.min.x < -.22;
    for (const sizes of [[.82],[.34,.34,.34]]) {
      const existing = state.animals.map(a=>({...a.position}));
      for (const size of sizes) state.animals.push(resident(String(state.animals.length),species,p,size));
      placeNewResidents(state,existing.length,solid);
      assert.deepEqual(state.animals.slice(0,existing.length).map(a=>a.position),existing);
      for (let i=existing.length; i<state.animals.length; i++) {
        const young = state.animals[i];
        assert.ok(!solid(makeResidentBox(young)));
        assert.ok(Math.hypot(young.position.x-p.x,young.position.y-p.y,young.position.z-p.z) < 1);
        for (let j=0; j<i; j++) assert.equal(meshesOverlap(state.animals[j],young),false);
      }
    }
  }
});

test('a fish swimming into a stone slides along its face on its own stroke and learns which way is out', () => {
  const fish = resident('fish','neon',{x:0,y:2,z:0});
  fish.velocity = {x:.4,y:0,z:.1};
  const face = makeResidentBox(fish).bounds.max.x + .05;
  const stone = { contacts: (box, visit) => {
    if (box.bounds.max.x > face) visit(stone, box.bounds.max.x - face, -1,0,0);
  } };
  let exit = null, slid = 0;
  for (let frame=0; frame<120; frame++) {
    const step = swim(fish,[fish],stone);
    exit ??= step.exit;
    const dx = fish.position.x-step.start.x, dz = fish.position.z-step.start.z;
    assert.ok(dx >= 0 && dz >= 0 && fish.position.y === step.start.y, 'never moved against its own stroke');
    if (exit) slid += dz;
    assert.ok(makeResidentBox(fish).bounds.max.x <= face);
  }
  assert.deepEqual([exit.x,exit.y,exit.z],[-1,0,0]);
  assert.equal(exit.resident,false);
  assert.ok(slid > .1, 'keeps the part of its stroke along the face');
});

test('a fish that a passing diver has overlapped is not moved, and swims out by itself', () => {
  const fish = resident('fish','harlequin',{x:0,y:2,z:0});
  // The diver's body covers x < .3, already well past the fish's middle.
  const diver = { contacts: (box, visit) => {
    if (box.bounds.min.x < .3) visit(diver, .3 - box.bounds.min.x, 1,0,0);
  } };
  fish.velocity = {x:-.5,y:0,z:0};
  const start = structuredClone(fish.position);
  assert.ok(swim(fish,[fish],diver).exit, 'cannot swim deeper into the diver');
  assert.deepEqual(fish.position,start);
  fish.velocity = {x:.5,y:0,z:0};
  for (let frame=0; frame<60; frame++) assert.equal(swim(fish,[fish],diver).exit,null);
  assert.ok(Math.abs(fish.position.x - .5) < 1e-9, 'its own stroke carries it out at its own pace');
});

test('additional contact passes revisit only the affected residents', () => {
  const touching = resident('touching','guppy',{x:0,y:2,z:0});
  const neighbour = resident('neighbour','neon',{x:.05,y:2,z:.01});
  const distant = resident('distant','discus',{x:2.8,y:2,z:1});
  const calls = new Map();
  resolveResidentContacts([touching,neighbour,distant],0,box => {
    calls.set(box.animal,1+(calls.get(box.animal) ?? 0));
    return false;
  });
  assert.ok(calls.get(touching)>1);
  assert.equal(calls.get(distant),1);
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
  assert.equal(meshesOverlap(live,dead,10),false);
  assert.deepEqual(live.velocity,{x:.5,y:0,z:0});
});

test('an older save with a shrimp antenna outside the glass walks back in by itself and keeps foraging', () => {
  const state = createInitialState();
  const shrimp = state.animals.find(a => a.species === 'shrimp');
  state.animals = [shrimp];
  shrimp.size = 1.2;
  shrimp.position = { x:3.65, y:substrateHeight(3.65,.2)+.025, z:.2 };
  shrimp.velocity = { x:.1,y:0,z:0 };
  const saved = restoreState(JSON.stringify(state));
  const restored = saved.animals[0];
  const outside = residentSkinBounds(restored).max.x;
  assert.ok(outside > 3.98);
  for (let frame=0; frame<90; frame++) {
    advanceBehavior(saved,1/30);
    assert.ok(residentSkinBounds(restored).max.x <= outside, 'never further through the glass');
  }
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
  assert.equal(meshesOverlap(a,b),false);
});

test('a fish sculling between parallel faces does not retrace its stroke when a neighbour briefly blocks the passage', () => {
  const fish = resident('in-passage','harlequin',{x:0,y:1.4,z:0},1.235);
  fish.velocity = {x:-.03377,y:-.04922,z:-.02751};
  fish.position.z += 1.98 - residentSkinBounds(fish).max.z;
  const pane = fish.position.z, n = Math.sqrt(1/3);
  let paused = false, total = 0;
  for (let frame=0; frame<30; frame++) {
    const start = {...fish.position}, heading = {...fish.velocity};
    const scene = {contacts(box,visit) {
      const p = box.animal.position;
      if (p.z < pane) visit('flat',pane-p.z,0,0,1);
      const depth = (start.x-p.x + start.y-p.y + pane-p.z)*n;
      if (frame%2 && depth > 0) visit('passing neighbour',depth,n,n,n);
    }};
    fish.velocity = {x:-.03347,y:-.04870,z:-.02856};
    for (const axis of ['x','y','z']) fish.position[axis] += fish.velocity[axis]/60;
    moveResident(fish,start,heading,[fish],frame/60,scene,.12/60);
    const progress = start.x-fish.position.x + start.y-fish.position.y;
    assert.ok(progress >= -1e-6,'the previous stroke was undone on frame '+frame);
    if (frame%2 && progress < .0001) paused = true;
    total += progress;
  }
  assert.ok(paused && total > .015,'the fish waits for a gap and continues along the pane');
});

test('a restored harlequin swims out between a rock and a forked branch without crossing either surface', t => {
  t.mock.method(TextureLoader.prototype, 'load', () => new Texture());
  const decor = createHardscape(), world = createSceneCollisions();
  decor.update([{kind:'stone',slot:2}, {kind:'wood',slot:5}]);
  world.update(decor.solids,[]);
  // Pose from an old tank, with the nose and tail touching different surfaces.
  const start = {x:-.06311872,y:.76556665,z:.12858739};
  const state = createInitialState();
  state.animals = [];
  const fish = addAnimal(state,'harlequin').animal;
  fish.size = 1.07203042;
  fish.position = {...start};
  fish.velocity = {x:.02795152,y:.00150915,z:-.05169565};
  fish.seed = .54566584;
  fish.hunger = 15;
  state.behaviorSeconds = 49970.11;
  function contacts() {
    const depths = new Map();
    world.contacts(makeResidentBox(fish),(part,depth) => depths.set(part,depth));
    return depths;
  }
  let prior = contacts(), furthest = 0;
  assert.ok(prior.size >= 2);
  for (let i = 0; i < 8*60; i++) {
    const position = new Vector3().copy(fish.position);
    const direction = new Vector3().copy(fish.velocity).normalize();
    advanceBehavior(state,1/60,world);
    const next = contacts();
    for (const [part,depth] of next) assert.ok(depth <= (prior.get(part) ?? 0) + 1e-10);
    prior = next;
    assert.ok(position.distanceTo(fish.position) < .025, 'no position jump');
    assert.ok(direction.angleTo(new Vector3().copy(fish.velocity)) < .06, 'no sudden pivot');
    furthest = Math.max(furthest,position.distanceTo(start));
  }
  assert.ok(furthest > .5, 'gets out and resumes swimming');
});
