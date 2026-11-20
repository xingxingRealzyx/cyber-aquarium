import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDesktopView } from '../src/desktop-view.js';

function setup() {
  const camera = new PerspectiveCamera(36,1,.1,60);
  camera.position.set(8.2,6.7,12.9);
  const controls = {target:new Vector3(0,2.05,0)};
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({left:0,top:0});
  const view = createDesktopView(camera,controls,canvas);
  view.resize(900,600);
  const wheel = (x,y,deltaY) => canvas.dispatchEvent(Object.assign(new Event('wheel',{cancelable:true}),{clientX:x,clientY:y,deltaY,deltaMode:0}));
  return {camera,controls,view,wheel};
}

test('follow eases toward the fish, keeps manual orbit and zoom, then returns to the original framing', () => {
  const {camera,controls,view,wheel} = setup();
  wheel(750,150,-130);
  const originalZoom = camera.zoom, originalProjection = camera.projectionMatrix.clone();
  const originalTarget = controls.target.clone();
  const fish = new Vector3(1.9,1.3,-.4);
  view.followAnimal('tetra',.7);
  assert.ok(controls.target.equals(originalTarget));
  view.advanceFollow(fish,1/60);
  assert.ok(controls.target.distanceTo(originalTarget) < .12*fish.distanceTo(originalTarget));
  assert.ok(camera.zoom > originalZoom && camera.zoom < 2.5/.7);
  // A user rotates and then zooms around the moving fish.
  camera.position.copy(controls.target).add(new Vector3(-10,4,9));
  wheel(10,450,-260);
  const manualZoom = camera.zoom;
  for (let i=0;i<240;i++) {
    fish.x += .004;
    view.advanceFollow(fish,1/60);
  }
  assert.equal(camera.zoom,manualZoom);
  assert.ok(controls.target.distanceTo(fish)<.06);
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(new Vector3(-10,4,9))<1e-9);

  view.followAnimal(null);
  for (let i=0;i<240;i++) view.advanceFollow(null,1/60);
  assert.equal(view.followedId,null);
  assert.ok(controls.target.equals(originalTarget));
  assert.equal(camera.zoom,originalZoom);
  assert.ok(camera.projectionMatrix.equals(originalProjection));
  view.dispose();
});

test('a held fish stays still on camera; a missing fish releases the camera and reset takes effect immediately', () => {
  const {camera,controls,view} = setup();
  const fish = {x:2,y:2,z:1};
  view.followAnimal('discus',1);
  for(let i=0;i<200;i++) view.advanceFollow(fish,1/60);
  assert.equal(view.advanceFollow(fish,1/60),false);
  view.advanceFollow(null,1/60);
  assert.equal(view.followedId,null);
  view.reset();
  assert.equal(camera.zoom,1);
  const pivot=controls.target.clone();
  assert.equal(view.advanceFollow(fish,1),false);
  assert.ok(controls.target.equals(pivot));
  view.dispose();
});
