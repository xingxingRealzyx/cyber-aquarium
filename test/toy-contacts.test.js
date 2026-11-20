import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, LoadingManager, Mesh, Texture, TextureLoader, Vector3 } from 'three';
import { createAuthorDisplay } from '../src/author-motion.js';
import { animateAuthorSwimmer, createAuthorSwimmer } from '../src/author-swimmer.js';
import { createSceneCollisions, scanSolids } from '../src/scene-collisions.js';
import { createToyModel } from '../src/toy-model.js';
import { poseToy } from '../src/toy-motion.js';
import { createHardscape } from '../src/hardscape.js';
import { addToy, createInitialState, substrateHeight } from '../src/simulation.js';
import { makeResidentBox, skinBounds } from '../src/resident-collisions.js';

const level = 4.14;
function block(kind, width=.4) {
  const group = new Group();
  group.userData.toyKind=kind;
  group.add(new Mesh(new BoxGeometry(width,width,width)));
  return group;
}
function bounds(model) { return new Box3().setFromObject(model,true); }

test('a drifting body cannot skip a thin root between two clear endpoints; it can slide past its end', () => {
  const world=createSceneCollisions(), diver=block('diver');
  const root=scanSolids(new BoxGeometry(.008,1.6,.8).translate(0,2,0));
  const plant={roots:root,leaves:[]};
  function place(x,z,time) {
    diver.position.set(x,2,z);
    world.arrangeToys([], [diver],plant,[],time,level);
  }
  place(-1,0,0);
  place(1,.14,1);
  assert.ok(bounds(diver).max.x < -.004, 'the diver remains on the approach side of the root');
  assert.ok(diver.position.z>.13, 'the tangential part of its drift continues');
  place(1,1,2);
  place(1,1,3);
  assert.ok(diver.position.x>.5);
});

test('glass, waterline and a stationary dead fish constrain the actual toy mesh', () => {
  const world=createSceneCollisions(), ring=block('swimRing');
  ring.position.set(6,level,3); ring.rotation.y=Math.PI/4;
  world.arrangeToys([], [ring],null,[],0,level);
  const box=bounds(ring);
  assert.ok(box.max.x<3.981 && box.max.z<1.981);
  assert.equal(ring.position.y,level);

  const diver=block('diver'), fish=createInitialState().animals[0];
  Object.assign(fish,{alive:false,deathBehaviorSeconds:0,position:{x:0,y:2,z:0},velocity:{x:.1,y:0,z:0}});
  diver.position.set(-1.4,2,0);
  world.arrangeToys([], [diver],null,[fish],0,level);
  diver.position.x=1.4;
  world.arrangeToys([], [diver],null,[fish],2,level);
  assert.ok(bounds(diver).max.x < skinBounds(makeResidentBox(fish,2)).min.x);
});

test('two coincident surface placements separate horizontally, and a new obstacle displaces both above the surface lane', () => {
  const duck=block('duck'), ring=block('swimRing'), world=createSceneCollisions();
  const obstacle=new BoxGeometry(.7,1.5,.7).translate(0,level,0), obstacleBox=new Box3().setFromBufferAttribute(obstacle.attributes.position);
  for (const geometry of [[],scanSolids(obstacle)]) {
    for (const item of [duck,ring]) item.position.set(0,level,0);
    world.arrangeToys(geometry,[duck,ring],null,[],0,level);
    assert.equal(duck.position.y,level); assert.equal(ring.position.y,level);
    assert.equal(bounds(duck).intersectsBox(bounds(ring)),false);
    if (geometry.length) for (const item of [duck,ring]) assert.equal(bounds(item).intersectsBox(obstacleBox),false);
  }
});

test('real divers and swimmers on intersecting courses stay apart throughout their kicks and turns', t => {
  t.mock.method(TextureLoader.prototype,'load',() => new Texture());
  const manager=new LoadingManager(), world=createSceneCollisions(), tank=createInitialState();
  const rocks=createHardscape(manager);
  rocks.update(tank.hardscape);
  for (const kind of ['duck','swimRing','duck','swimRing','diver','diver','author','author']) addToy(tank,kind);
  const models=tank.toys.map(toy => {
    const model=toy.kind === 'author' ? createAuthorDisplay(createAuthorSwimmer(manager),animateAuthorSwimmer,toy.slot,level,rocks.driftFloor,toy.slot ? 13.75 : 0)
      : createToyModel(toy.kind,toy.color,manager);
    model.userData.toyKind=toy.kind;
    return model;
  });
  const previous=[], centers=models.map(()=>new Vector3());
  let maxNudge=0, maxJump=0;
  for (let i=0;i<=480;i++) {
    const time=20+i/30;
    for (const [j,model] of models.entries()) {
      const age=time-(j===7?13.75:0);
      if (model.userData.author) model.userData.author.prepare(age,rocks.revision);
      else poseToy(model,tank.toys[j],time,level,rocks.driftFloor);
    }
    const intended=models[7].userData.author.swimmer.position.clone();
    world.arrangeToys(rocks.solids,models,null,[],time,level);
    for (const [j,model] of models.entries()) {
      const actor=model.userData.author;
      if (actor) actor.finish(time-(j===7?13.75:0));
      const body=actor?.swimmer ?? model;
      if (i) maxJump=Math.max(maxJump,body.position.distanceTo(previous[j]));
      previous[j]=body.position.clone();
      if (actor) actor.swimmer.userData.rig.neck.localToWorld(centers[j].set(0,.058,.109));
      else model.localToWorld(centers[j].set(0,.272,0));
    }
    for (const author of [6,7]) for (const diver of [4,5])
      assert.ok(centers[author].distanceTo(centers[diver])>.25,'cat head clears the copper helmet');
    maxNudge=Math.max(maxNudge,models[7].userData.author.swimmer.position.distanceTo(intended));
  }
  assert.ok(maxNudge>.01,'the moving toys actually have to yield');
  assert.ok(maxJump<.09,'no body-length correction within one tick: '+maxJump);
});

test('the swimmer and copper diver keep moving smoothly through repeated close passes', t => {
  t.mock.method(TextureLoader.prototype,'load',() => new Texture());
  const manager=new LoadingManager(), rocks=createHardscape(manager), world=createSceneCollisions();
  rocks.update(createInitialState().hardscape);
  const author=createAuthorDisplay(createAuthorSwimmer(manager),animateAuthorSwimmer,0,level,rocks.driftFloor);
  const diver=createToyModel('diver',undefined,manager), toy={kind:'diver',slot:0};
  author.userData.toyKind='author'; diver.userData.toyKind='diver';
  const actor=author.userData.author, bodies=[actor.swimmer,diver];
  const tracks=bodies.map(()=>({previous:new Vector3(),velocity:new Vector3(),worstKick:0,distance:0}));
  const fps=30;
  let atSurface=false, releasedBubble=false;
  for (let frame=0;frame<=fps*65;frame++) {
    const time=frame/fps;
    actor.prepare(time,rocks.revision);
    poseToy(diver,toy,time,level,rocks.driftFloor);
    world.arrangeToys(rocks.solids,[author,diver],null,[],time,level,time);
    actor.finish(time);
    const stats=actor.diagnostics();
    atSurface ||= stats.surfacing>.99 && stats.snorkelTip.y>level;
    releasedBubble ||= stats.bubbles.some(b=>b.y>stats.mouth.y+.25);
    for (const [i,body] of bodies.entries()) {
      const track=tracks[i], velocity=body.position.clone().sub(track.previous).multiplyScalar(fps);
      if (frame>1) {
        track.worstKick=Math.max(track.worstKick,track.velocity.distanceTo(velocity)*fps);
        track.distance+=velocity.length()/fps;
      }
      track.previous.copy(body.position); track.velocity.copy(velocity);
    }
  }
  assert.ok(atSurface && releasedBubble,'the corrected swimming pose still reaches air and leaves a detached bubble trail');
  for (const [i,{distance,worstKick}] of tracks.entries()) {
    assert.ok(distance>(i===0?18:5),'each body continues through its turns');
    assert.ok(worstKick<(i===0?6:3),'abrupt acceleration on '+(i===0?'author':'diver')+': '+worstKick);
  }
});

test('the contact-corrected copper diver stops with the current and restarts smoothly', t => {
  t.mock.method(TextureLoader.prototype,'load',() => new Texture());
  const world=createSceneCollisions(), diver=createToyModel('diver',undefined,new LoadingManager());
  diver.userData.toyKind='diver';
  const scenery=[], toy={kind:'diver',slot:0}, dt=1/60;
  function step(time, flow) {
    poseToy(diver,toy,flow,level,substrateHeight);
    world.arrangeToys(scenery,[diver],null,[],time,level,flow);
  }
  for (let i=0;i<=60;i++) step(i*dt,i*dt);
  const stopped=diver.position.clone();
  for (let i=61;i<=120;i++) {
    step(i*dt,1);
    assert.ok(diver.position.distanceTo(stopped)<1e-9);
  }
  step(121*dt,1+dt);
  const firstStep=diver.position.distanceTo(stopped);
  assert.ok(firstStep>0 && firstStep<dt*dt);
});

test('a solid toy clears the sway of tall leaves; both plant removal and a long background gap reopen its route', () => {
  const world=createSceneCollisions(), diver=block('diver'), rocks=[];
  const leaves=scanSolids(new BoxGeometry(.02,2,.5).translate(0,2,0));
  leaves[0].swayX=.10;
  const plants={roots:[],leaves};
  diver.position.set(-1,2,0);
  world.arrangeToys(rocks,[diver],plants,[],0,level);
  diver.position.x=1;
  world.arrangeToys(rocks,[diver],plants,[],1,level);
  assert.ok(bounds(diver).max.x<-.11);
  diver.position.x=1;
  world.arrangeToys(rocks,[diver],plants,[],500,level);
  assert.equal(diver.position.x,1,'a restored clock does not sweep through hundreds of seconds of stale scenery');
  diver.position.x=-1;
  world.arrangeToys(rocks,[diver],null,[],501,level);
  assert.equal(diver.position.x,-1);
});

test('a contact-corrected swimmer reloads with its actual mouth, snorkel and detached bubbles', t => {
  t.mock.method(TextureLoader.prototype,'load',() => new Texture());
  const manager=new LoadingManager(), world=createSceneCollisions();
  const create=()=>{
    const model=createAuthorDisplay(createAuthorSwimmer(manager),animateAuthorSwimmer,0,level,substrateHeight);
    model.userData.toyKind='author';
    return model;
  };
  const model=create(), actor=model.userData.author;
  actor.prepare(.9);
  const center=actor.swimmer.position.clone();
  const rock=scanSolids(new BoxGeometry(.4,.7,.4).translate(center.x,center.y,center.z));
  world.arrangeToys(rock,[model],null,[],.9,level); actor.finish(.9);
  assert.ok(actor.swimmer.position.distanceTo(center)>.2);
  assert.equal(actor.diagnostics().bubbles.length,1);
  actor.prepare(1.2); world.arrangeToys(rock,[model],null,[],1.2,level); actor.finish(1.2);
  const saved=JSON.parse(JSON.stringify(world.captureToyPose(model)));
  const reopened=create(), loaded=reopened.userData.author;
  reopened.userData.savedToyPose=saved;
  loaded.prepare(1.2);
  createSceneCollisions().arrangeToys(rock,[reopened],null,[],1.2,level);
  loaded.finish(1.2);
  assert.deepEqual(loaded.diagnostics(),actor.diagnostics());
});

test('a zebra danio alongside a tilted fin does not pin the drifting toy', () => {
  const world = createSceneCollisions(), scenery = [], diver = new Group();
  diver.userData.toyKind = 'diver';
  diver.add(new Mesh(new BoxGeometry(.70,.016,.065).rotateZ(Math.PI/4)));
  const fish = {species:'zebra', alive:true, size:.35, position:{x:0,y:2.2,z:0}, velocity:{x:.18,y:0,z:0}};
  let previousX;
  for (let frame=0; frame<=100; frame++) {
    const time = frame/60;
    const x = .18*(time-1);
    diver.position.set(x,2,0);
    fish.position.x = x;
    // For the last 40 frames the fish travels through the empty corner
    // above the blade, inside its axis-aligned bounding box.
    world.arrangeToys(scenery,[diver],null,frame>60 ? [fish] : [],time,level,time);
    if (frame>60) {
      assert.ok(diver.position.x-previousX > .08/60, 'the fin continues to drift past the fish');
      world.update(scenery,[diver],false);
      assert.equal(world.overlaps(makeResidentBox(fish,time)),false);
    }
    previousX = diver.position.x;
  }
});
