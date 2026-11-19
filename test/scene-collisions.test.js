import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, LoadingManager, Mesh, Texture, TextureLoader, Vector3 } from 'three';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { createHardscape } from '../src/hardscape.js';
import { createAquaticPlants } from '../src/aquatic-plants.js';
import { createAuthorSwimmer, animateAuthorSwimmer } from '../src/author-swimmer.js';
import { createAuthorDisplay } from '../src/author-motion.js';
import { createToyModel } from '../src/toy-model.js';
import { createInitialState, substrateHeight } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';
import { makeResidentBox, resolveResidentContacts } from '../src/resident-collisions.js';

function offline(t) {
  t.mock.method(TextureLoader.prototype,'load',(_url,onLoad) => {
    const texture = new Texture();
    onLoad?.(texture);
    return texture;
  });
  return new LoadingManager();
}

function resident(position) {
  return {id:'test',species:'neon',size:.85,position,alive:true,velocity:{x:.5,y:0,z:0}};
}

function meshAverage(plant, first, count) {
  const points = plant.children[0].geometry.getAttribute('position'), sum = new Vector3();
  for (let i = first; i < first + count; i++) sum.add(new Vector3().fromBufferAttribute(points, i));
  return sum.divideScalar(count);
}

test('vallisneria sheaths stop residents while long blades yield above the roots', t => {
  const plants = createAquaticPlants([{id:'grass', species:'vallisneria', slot:0}], {value:0}, offline(t));
  const world = createSceneCollisions(), scenery = [];
  world.update(scenery, [], false, plants.userData.plantContacts);
  const base = meshAverage(plants, 0, 15);
  assert.ok(world.blocksFood(base));
  const fish = resident(base.clone());
  assert.ok(world.constrain(makeResidentBox(fish)));
  resolveResidentContacts([fish], 0, world.constrain);
  assert.equal(world.constrain(makeResidentBox(fish)), false);

  const leafSites = plants.userData.leafSites.get('grass');
  const blade = leafSites[0].point;
  fish.position.copy(blade);
  assert.ok(world.avoid(fish).foliage.distance < .001);
  assert.equal(world.blocksFood(blade), false);
  assert.equal(world.constrain(makeResidentBox(fish)), false);
  const gap = blade.clone().lerp(leafSites[10].point, .5);
  assert.equal(world.blocksFood(gap), false);
  assert.equal(world.constrain(makeResidentBox(resident(gap))), false);
  world.update(scenery, [], false);
  assert.equal(world.blocksFood(base), false);
  assert.equal(world.avoid(fish).foliage, null);
});

test('anubias contacts track the direction, reach and tapered width of the rendered rhizome as it grows', t => {
  const manager = offline(t), world = createSceneCollisions(), scenery = [];
  const grow = biomass => createAquaticPlants([{id:'anubias', species:'anubias', slot:1, biomass}], {value:0}, manager);
  const large = grow(1.95), small = grow(.16);
  // Average two actual cross sections close to the end of the large rhizome.
  const tip = meshAverage(large, 0, 6).lerp(meshAverage(large, 7, 6), .4);
  world.update(scenery, [], false, small.userData.plantContacts);
  assert.equal(world.blocksFood(tip), false);
  world.update(scenery, [], false, large.userData.plantContacts);
  assert.equal(world.blocksFood(tip), true);
  const leaf = large.userData.leafSites.get('anubias')[3].point;
  assert.ok(world.avoid(resident(leaf)).foliage.distance < .001);
  assert.equal(world.blocksFood(leaf), false);
  assert.equal(world.constrain(makeResidentBox(resident(leaf.clone()))), false);
  world.update(scenery, [], false, small.userData.plantContacts);
  assert.equal(world.blocksFood(tip), false);
});

test('a resident body clears scanned stone, and can return to that space when the stone is removed', t => {
  const rocks=createHardscape(offline(t)), world=createSceneCollisions();
  const stone=[{kind:'stone',slot:42}];
  rocks.update(stone);
  const geo=rocks.group.children[0].geometry;
  geo.computeBoundingBox();
  const center=geo.boundingBox.getCenter(new Vector3());
  const fish=resident(center.clone());
  world.update(rocks.solids,[]);
  assert.ok(world.blocksFood(center));
  assert.ok(world.avoid(fish).obstacle.distance<0);
  resolveResidentContacts([fish],0,world.constrain);
  assert.ok(fish.position.distanceTo(center)>.1);
  assert.equal(world.constrain(makeResidentBox(fish)),false);
  rocks.update([]);
  world.update(rocks.solids,[]);
  fish.position.copy(center);
  assert.equal(world.blocksFood(center),false);
  assert.equal(world.constrain(makeResidentBox(fish)),false);
});

test('placing overlapping starter rocks and branches over residents leaves a reachable exit', t => {
  const rocks=createHardscape(offline(t)), world=createSceneCollisions();
  rocks.update(createInitialState().hardscape);
  world.update(rocks.solids,[]);
  const fish=resident({x:-1.1958, y:1.2282, z:.0841});
  const snail=resident({x:-2.2212, y:substrateHeight(-2.2212,1.1462)+.025, z:1.1462});
  snail.species='snail';
  resolveResidentContacts([fish,snail],0,world.constrain);
  assert.equal(world.constrain(makeResidentBox(fish)),false);
  assert.equal(world.constrain(makeResidentBox(snail)),false);
  assert.ok(Math.abs(snail.position.y-substrateHeight(snail.position.x,snail.position.z)-.025)<1e-7);
});

test('space between separate branch arms and inside a floating ring stays open', t => {
  const world=createSceneCollisions(), wood=new BoxGeometry(.10,.10,2.4);
  const left=scanSolids(wood.clone().translate(-.8,2,0),true);
  const right=scanSolids(wood.clone().translate(.8,2,0),true);
  world.update([...left,...right],[]);
  const pellet={x:0,y:2,z:0};
  assert.equal(world.blocksFood(pellet),false);
  pellet.x=.8;
  assert.ok(world.blocksFood(pellet));
  const ring=createToyModel('swimRing','#abc123',offline(t));
  ring.userData.toyKind='swimRing';
  ring.position.y=3;
  world.update([], [ring],false);
  assert.ok(world.avoid(resident({x:0,y:3.026,z:0})).obstacle.distance>.08);
  assert.ok(world.avoid(resident({x:.26,y:3.026,z:0})).obstacle.distance<0);
});

test('a grazer meeting a shallow stone gets a way out along the substrate', () => {
  const geometry = new BoxGeometry(1.6,.04,1.6).translate(.2,substrateHeight(0,0)+.079,0);
  const world = createSceneCollisions();
  world.update(scanSolids(geometry),[]);
  const shrimp = resident(new Vector3());
  shrimp.species = 'shrimp'; shrimp.size = 1;
  function contactAt(x) {
    shrimp.position.set(x,substrateHeight(x,0)+.025,0);
    const contacts = [];
    world.contacts(makeResidentBox(shrimp), (_solid,depth,nx,ny,nz) => contacts.push({depth,nx,ny,nz}));
    assert.equal(contacts.length,1);
    return contacts[0];
  }
  const nearEdge = contactAt(-.8), fartherIn = contactAt(-.72);
  assert.equal(nearEdge.ny,0, 'the shrimp can leave by crawling toward the edge');
  assert.ok(nearEdge.nx < -.99 && Math.abs(nearEdge.nz) < .01);
  assert.ok(Math.abs(fartherIn.depth - nearEdge.depth - .08) < .002);
  geometry.dispose();
});

test('grazer feelers measure free travel to a root or pane without changing the live pose', () => {
  const world = createSceneCollisions(), stem = new BoxGeometry(.01,.6,.6).translate(.72,.5,0);
  const roots = scanSolids(stem);
  const grazer = resident(new Vector3(0,substrateHeight(0,0)+.025,0));
  grazer.species='shrimp'; grazer.size=1;
  const box = makeResidentBox(grazer), origin = grazer.position.clone(), bounds = box.bounds.clone();
  world.update([],[],false,{roots:[],leaves:roots});
  assert.equal(world.grazerObstacle(grazer,1,0,.6),null, 'the flexible leaf can yield');
  world.update([],[],false,{roots,leaves:[]});
  const hit = world.grazerObstacle(grazer,1,0,.6);
  assert.ok(Math.abs(hit.distance-(.715-bounds.max.x)) < 1e-6);
  assert.ok(hit.x===-1 && hit.z===0);
  assert.equal(world.grazerObstacle(grazer,1,0,.2),null, 'food in front of the root remains reachable');
  assert.equal(world.grazerObstacle(grazer,0,1,.6),null);
  assert.ok(grazer.position.equals(origin) && box.bounds.equals(bounds));
  grazer.position.x=.65;
  assert.ok(world.grazerObstacle(grazer,1,0,.6)?.distance === 0);
  assert.equal(world.grazerObstacle(grazer,-1,0,.6),null, 'a resident in an existing overlap can back out');
  grazer.position.x=3.2;
  const glass=world.grazerObstacle(grazer,1,0,.6);
  assert.ok(Math.abs(glass.distance-(3.98-3.2-bounds.max.x))<1e-6);
  stem.dispose();
});

test('a shrimp can pass beneath a toy that would catch the shell of a larger snail', () => {
  const world = createSceneCollisions();
  const bar = new Mesh(new BoxGeometry(.10,.06,.7));
  bar.position.set(.7,substrateHeight(0,0)+.025+.29,0);
  world.update([], [bar], false);
  const animal=resident(new Vector3(0,substrateHeight(0,0)+.025,0));
  animal.species='shrimp'; animal.size=1;
  assert.equal(world.grazerObstacle(animal,1,0,.9),null);
  animal.species='snail';
  const hit=world.grazerObstacle(animal,1,0,.9);
  assert.ok(hit.distance>.38 && hit.distance<.41 && hit.x<-.99);
  animal.size=.35;
  assert.equal(world.grazerObstacle(animal,1,0,.9),null, 'the hatchling clears the same overhang');
  animal.size=1;
  bar.position.y+=1;
  world.update([], [bar]);
  assert.equal(world.grazerObstacle(animal,1,0,.9),null, 'the route reopens as the toy floats up');
  bar.geometry.dispose(); bar.material.dispose();
});

test('contact trials follow a fish into a new region and a moving toy into its path', t => {
  const world = createSceneCollisions();
  const ring = createToyModel('swimRing', '#abc123', offline(t));
  ring.userData.toyKind = 'swimRing';
  const fish = resident(new Vector3(-2, 2, 0));
  const hasContact = () => {
    let hit = false;
    world.contacts(makeResidentBox(fish), () => { hit = true; });
    return hit;
  };
  ring.position.set(1, 2, 0);
  world.update([], [ring], false);
  assert.equal(hasContact(), false);
  fish.position.x = 1.26;
  assert.equal(hasContact(), true);
  ring.position.x = -1;
  world.update([], [ring]);
  assert.equal(hasContact(), false);
  ring.position.x = 1;
  world.update([], [ring]);
  assert.equal(hasContact(), true);
});

test('steering past the toy diver uses its fitted surface and stays continuous between parts', t => {
  const diver = createToyModel('diver',undefined,offline(t));
  diver.userData.toyKind='diver';
  diver.position.set(0,2,0);
  diver.rotation.set(.19,.69,.1);
  const world=createSceneCollisions();
  world.update([], [diver],false);
  const surface = (x,y,z) => world.avoid(resident({x,y,z})).obstacle;
  // Open water beside the tank on the toy diver's back.
  assert.ok(surface(.027,1.886,-.296).distance>.09);
  // A swimmer passes between the nearest faces of the diver's leg and arm.
  const before=surface(.274,1.769,-.010), after=surface(.278,1.769,-.010);
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)<.1);
});

test('author collision follows the actual animated limbs and swept head and clears on removal', t => {
  const manager=offline(t), world=createSceneCollisions();
  const makeActor=slot => {
    const swimmer=createAuthorSwimmer(manager);
    return createAuthorDisplay(swimmer,animateAuthorSwimmer,slot,4.14,()=>.45);
  };
  const first=makeActor(0), second=makeActor(1);
  for (const actor of [first,second]) actor.userData.author.update(2);
  world.update([], [first,second],false);
  for (const actor of [first,second]) {
    const {swimmer}=actor.userData.author;
    for (const limb of swimmer.userData.rig.limbs) {
      const hand=limb.wrist.localToWorld(new Vector3(0,0,.04));
      assert.ok(world.avoid(resident(hand)).author.distance<=.0001);
      const fin=limb.blade.localToWorld(new Vector3(0,-.014,-.30));
      assert.ok(world.avoid(resident(fin)).author.distance<.04);
    }
    const mouth=swimmer.userData.mouth.getWorldPosition(new Vector3());
    assert.ok(world.avoid(resident(mouth)).author.distance<.0001);
  }
  const oldHead=first.userData.author.swimmer.userData.mouth.getWorldPosition(new Vector3());
  first.userData.author.update(2.1);
  world.update([], [first],true);
  assert.ok(world.avoid(resident(oldHead)).author.distance<.0001);
  const fish=resident(oldHead.clone());
  resolveResidentContacts([fish],2.1,world.constrain);
  assert.equal(world.constrain(makeResidentBox(fish)),false);
  world.update([], []);
  assert.equal(world.avoid(fish).author,null);
});

test('a hovering diver rising underneath a schooling fish cannot push it across its helmet', t => {
  const toy=createToyModel('diver',undefined,offline(t));
  toy.userData.toyKind='diver';
  const world=createSceneCollisions(), scenery=[];
  const fish=resident(new Vector3(2.579477,3.827942,.005165));
  fish.species='harlequin'; fish.size=1.11881;
  fish.velocity=new Vector3(-.707336,.549144,.445104);
  toy.position.set(2.897944,2.915430,-.153717);
  toy.quaternion.set(.010803,.200011,.021072,.979507).normalize();
  world.update(scenery,[toy],false);
  world.constrain(makeResidentBox(fish));

  toy.position.set(2.898311,2.917204,-.152137);
  toy.quaternion.set(.010793,.199863,.021228,.979534).normalize();
  world.update(scenery,[toy],true);
  const start=new Vector3(2.576571,3.828172,.006993);
  fish.position.copy(start);
  fish.velocity.set(-.174319,.142655,.109731);
  for (let pass=0; pass<24; pass++) world.constrain(makeResidentBox(fish));
  assert.ok(start.distanceTo(fish.position)<.03, 'contact iterations must share one frame of movement');
  assert.equal(world.overlaps(makeResidentBox(fish)),false);
});

test('an angelfish can graze a stone beside a pane without rising a body length', () => {
  const stone=new BoxGeometry(1.079192,1.449414,.892106).translate(-1.024448,.952011,.713132);
  const world=createSceneCollisions(), scenery=scanSolids(stone);
  world.update(scenery,[]);
  const fish=resident(new Vector3(-1.059205,1.547157,1.567046));
  fish.species='angelfish'; fish.size=1.170365;
  fish.velocity=new Vector3(-.025884,.006255,-.008774);
  for (let i=0;i<90;i++) {
    const previous=fish.position.clone();
    fish.position.addScaledVector(fish.velocity,1/30);
    resolveResidentContacts([fish],i/30,world.constrain);
    assert.ok(previous.distanceTo(fish.position)<.01);
    assert.equal(world.overlaps(makeResidentBox(fish)),false);
  }
  stone.dispose();
});

test('an angelfish turning toward food beside a rock keeps its fins in open water', () => {
  const stone=new BoxGeometry(1,1,1).translate(0,2,0), world=createSceneCollisions();
  world.update(scanSolids(stone),[]);
  const tank=createInitialState(), fish=tank.animals[0];
  Object.assign(fish,{species:'angelfish',size:1.15,seed:.31,metabolism:1,health:100,hunger:80,
    position:{x:.752,y:2,z:0},velocity:{x:0,y:0,z:.6}});
  tank.animals=[fish]; tank.food=.1;
  tank.foodPellets=[{id:'target',x:2,y:2.04,z:.03,seed:.5,ageSeconds:0,mass:tank.food}];
  assert.equal(world.overlaps(makeResidentBox(fish)),false);
  for (let frame=0;frame<600 && !fish.bites;frame++) {
    advanceBehavior(tank,1/60,world);
    world.contacts(makeResidentBox(fish), (_solid,depth) => {
      assert.ok(depth<.002,'the turn swept a fin into the rock at frame '+frame);
    });
  }
  assert.ok(fish.bites>0,'the fish can still turn away from the stone and eat');
  stone.dispose();
});
