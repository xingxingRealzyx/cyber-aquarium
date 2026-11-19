import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, LoadingManager, Texture, TextureLoader, Vector3 } from 'three';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { createHardscape } from '../src/hardscape.js';
import { createAquaticPlants } from '../src/aquatic-plants.js';
import { createAuthorSwimmer, animateAuthorSwimmer } from '../src/author-swimmer.js';
import { createAuthorDisplay } from '../src/author-motion.js';
import { createToyModel } from '../src/toy-model.js';
import { createInitialState, substrateHeight } from '../src/simulation.js';
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
