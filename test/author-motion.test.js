import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, MathUtils, Vector3 } from 'three';
import { createAuthorDisplay } from '../src/author-motion.js';
import { advanceBehavior } from '../src/behavior.js';
import { createInitialState, restoreState, substrateHeight } from '../src/simulation.js';

const level = 4.14;

function rig(slot = 0, floor = substrateHeight) {
  const swimmer = new Group(), mouth = new Group();
  const snorkelTip = new Group();
  snorkelTip.position.set(.19,.30,-.10);
  mouth.add(snorkelTip);
  swimmer.userData.snorkelTip = snorkelTip;
  swimmer.add(mouth);
  swimmer.userData.mouth = mouth;
  const display = createAuthorDisplay(swimmer, (_model, clock, surfacing) => {
    mouth.position.set(.015, .045 + .048 * surfacing + .009 * Math.sin(clock * 3), .65);
  }, slot, level, floor);
  return display.userData.author;
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test('the author leads with the head through turns, clears scenery and reaches air for each breath', () => {
  const floor = (x,z) => Math.max(substrateHeight(x,z), 1.7 * Math.exp(-.8 * ((x + 1) ** 2 + (z - 1) ** 2)));
  const actor = rig(0, floor), forward = new Vector3(), step = new Vector3();
  const previous = new Vector3(), previousHeading = new Vector3();
  let minY = Infinity;
  for (let i = 0; i <= 660; i++) {
    const age = i * .1;
    actor.update(age);
    const pos = actor.swimmer.position, {mouth, snorkelTip, surfacing} = actor.diagnostics();
    assert.ok(pos.y > floor(pos.x,pos.z) + .4);
    assert.ok(Math.abs(pos.x) < 3 && Math.abs(pos.z) < 1.2 && Math.abs(mouth.z) < 1.95);
    if (surfacing === 1) {
      assert.ok(Math.abs(snorkelTip.y - (level + .055)) < 1e-8);
      assert.ok(mouth.y < level - .10);
    }
    minY = Math.min(minY, pos.y);
    forward.set(0, 0, 1).applyQuaternion(actor.swimmer.quaternion).setY(0).normalize();
    if (i > 0) {
      step.subVectors(pos,previous).setY(0).normalize();
      assert.ok(step.dot(forward) > .97, 'forward motion follows the facing direction');
      assert.ok(previousHeading.dot(forward) > .96, 'turns are continuous');
    }
    previous.copy(pos);
    previousHeading.copy(forward);
  }
  assert.ok(minY < 2);
  actor.update(22);
  assert.equal(actor.diagnostics().surfacing,1);
  actor.update(28);
  assert.ok(actor.diagnostics().mouth.y < level - 1);
});

test('each exhalation starts at the animated mouth and rises in tank space until the surface', () => {
  const actor = rig();
  actor.update(0);
  assert.deepEqual(actor.diagnostics().bubbles, []);
  actor.update(.9);
  const birth = actor.diagnostics();
  assert.equal(birth.bubbles.length, 1);
  assert.ok(distance(birth.mouth, birth.bubbles[0]) < 1e-6);
  actor.update(2.1);
  const later = actor.diagnostics();
  assert.equal(later.bubbles.length, 4);
  assert.ok(later.bubbles[0].y > birth.mouth.y + .6);
  assert.ok(Math.hypot(later.bubbles[0].x - birth.mouth.x, later.bubbles[0].z - birth.mouth.z) < .06);
  assert.ok(Math.hypot(later.mouth.x - birth.mouth.x, later.mouth.z - birth.mouth.z) > .2);
  // Reconstruct even the older bubbles when the first rendered frame is mid-burst.
  const reopened = rig();
  reopened.update(2.1);
  assert.deepEqual(reopened.diagnostics(),later);
  actor.update(8.3);
  assert.deepEqual(actor.diagnostics().bubbles, []);
  for (let tick = 0; tick < 120; tick++) {
    actor.update(14 + tick * .1);
    assert.ok(actor.diagnostics().bubbles.every(p => p.y < level));
  }
});

test('swimming continues with both pumps off, holds on pause and restores the same pose', () => {
  const tank = createInitialState();
  tank.animals = [];
  tank.equipment.filter = tank.equipment.aerator = false;
  const a = rig(), b = rig(1);
  a.update(0); b.update(0);
  assert.ok(distance(a.swimmer.position,b.swimmer.position) > 2);
  const initial = a.swimmer.position.clone();
  advanceBehavior(tank, 2);
  a.update(tank.behaviorSeconds);
  assert.equal(tank.currentSeconds, 0);
  assert.ok(initial.distanceTo(a.swimmer.position) > .4);
  tank.paused = true;
  const pose = a.diagnostics();
  advanceBehavior(tank, 3);
  a.update(tank.behaviorSeconds);
  assert.deepEqual(a.diagnostics(), pose);
  const reloaded = rig();
  reloaded.update(restoreState(JSON.parse(JSON.stringify(tank))).behaviorSeconds);
  assert.deepEqual(reloaded.diagnostics(), pose);
});

test('the body and the actual travel direction turn gradually across the ends, scenery and waterline', () => {
  const floor = (x, z) => {
    let bed = substrateHeight(x, z);
    for (const [left, right, back, front, top] of [[.7, 2, -.75, .9, 2.45], [-2.4, -.45, -.2, .65, 2.78]]) {
      const edge = Math.hypot(Math.max(left - x, 0, x - right), Math.max(back - z, 0, z - front));
      bed = Math.max(bed, top * (1 - MathUtils.smoothstep(edge, .34, .90)));
    }
    return bed;
  };
  for (const [slot, fps] of [[0, 60], [3, 30], [9, 10]]) {
    for (const terrain of [floor, substrateHeight]) {
      const actor = rig(slot, terrain);
      const previous = new Vector3(), travel = new Vector3(), previousTravel = new Vector3();
      const previousRotation = actor.swimmer.quaternion.clone();
      for (let i = 0; i <= fps * 66; i++) {
        actor.update(i / fps);
        const {position, quaternion} = actor.swimmer;
        travel.subVectors(position, previous).normalize();
        if (i) assert.ok(previousRotation.angleTo(quaternion) * fps < 1.25, 'bounded body turning rate');
        if (i > 1) assert.ok(travel.angleTo(previousTravel) * fps < 1.55, 'no corner in the displacement path');
        previous.copy(position);
        previousTravel.copy(travel);
        previousRotation.copy(quaternion);
      }
    }
  }
});

test('scenery edits ease into the new clearance profile and share terrain probes across swimmers', () => {
  let bed = .4, probes = 0;
  const floor = () => { probes++; return bed; };
  const actor = rig(0, floor), neighbour = rig(1, floor);
  actor.update(2, 0);
  const initialProbes = probes;
  neighbour.update(4, 0);
  assert.equal(probes, initialProbes);
  bed = 2.5;
  const before = actor.swimmer.position.clone();
  actor.update(2, 1);
  assert.ok(actor.swimmer.position.distanceTo(before) < 1e-9);
  neighbour.update(4, 1);
  assert.equal(probes, 2 * initialProbes);
  actor.update(4, 1);
  const during = actor.swimmer.position.clone();
  bed = 2.7;
  actor.update(4, 2);
  assert.ok(actor.swimmer.position.distanceTo(during) < 1e-9);
  actor.update(11, 2);
  assert.ok(actor.swimmer.position.y >= bed + .65);
});
