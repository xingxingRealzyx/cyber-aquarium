import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { corpseDecay, SPECIES, substrateHeight } from './simulation.js';
import { fishCollisionOutline } from './fish-model.js';

// Grazers walk with their local origin at their feet. Bounds include the shell
// or antennae in [tail, nose, bottom, top, left, right] order.
const meshBounds = {
  shrimp:    [-.273, .395, -.005, .182, -.125, .125],
  snail:     [-.225, .258, -.007, .345, -.139, .139],
};
const cache = new WeakMap();
const euler = new Euler(), rotation = new Quaternion(), offset = new Vector3(), extent = new Vector3();
const cross = new Vector3(), delta = new Vector3(), normal = new Vector3();

export function boxRadiusOnAxis(box, axis) {
  return box.half[0] * Math.abs(axis.dot(box.axes[0])) +
    box.half[1] * Math.abs(axis.dot(box.axes[1])) + box.half[2] * Math.abs(axis.dot(box.axes[2]));
}

function updateBox(box, seconds, v = box.animal.velocity) {
  const a = box.animal;
  const horizontal = Math.hypot(v.x, v.z);
  if (horizontal > .001) box.yaw = Math.atan2(-v.z, v.x);
  const yaw = a.alive ? box.yaw : (a.deathHeading ?? box.yaw);
  const pitch = a.alive && !box.benthic ? Math.max(-.85, Math.min(.85, Math.atan2(v.y, horizontal))) : 0;
  const roll = a.alive ? 0 : (a.seed < .5 ? -1 : 1) * (box.benthic ? .34 : .48 * Math.PI)
    * (1 - Math.exp(-.7 * Math.max(0, seconds - (a.deathBehaviorSeconds ?? 0))));
  rotation.setFromEuler(euler.set(roll, yaw, pitch, 'YZX'));
  box.axes[0].set(1,0,0).applyQuaternion(rotation);
  box.axes[1].set(0,1,0).applyQuaternion(rotation);
  box.axes[2].set(0,0,1).applyQuaternion(rotation);

  const bounds = box.outline.bounds, size = a.size ?? 1;
  const decay = !box.benthic && !a.alive ? corpseDecay(a) : 0;
  const sy = size * (1 - .13 * decay), sz = size * (1 - .28 * decay);
  box.half[0] = (bounds[1] - bounds[0]) * size / 2;
  box.half[1] = (bounds[3] - bounds[2]) * sy / 2;
  box.half[2] = (bounds[5] - bounds[4]) * sz / 2;
  offset.set((bounds[1] + bounds[0]) * size / 2, (bounds[3] + bounds[2]) * sy / 2,
    (bounds[5] + bounds[4]) * sz / 2).applyQuaternion(rotation);
  box.center.copy(a.position).add(offset);
  extent.set(0,0,0);
  for (let i = 0; i < 3; i++) {
    const axis = box.axes[i], half = box.half[i];
    extent.x += half * Math.abs(axis.x);
    extent.y += half * Math.abs(axis.y);
    extent.z += half * Math.abs(axis.z);
  }
  box.bounds.min.copy(box.center).sub(extent);
  box.bounds.max.copy(box.center).add(extent);
  return box;
}

// Returned boxes track their animal. A new behavior substep refreshes their pose.
export function makeResidentBox(animal, behaviorSeconds = 0) {
  let box = cache.get(animal);
  if (!box) {
    box = { animal, benthic: SPECIES[animal.species].type !== 'fish', yaw: 0, center: new Vector3(),
      axes: [new Vector3(), new Vector3(), new Vector3()], half: [0,0,0], bounds: new Box3() };
    box.outline = box.benthic ? { bounds: meshBounds[animal.species] } : fishCollisionOutline(animal.species);
    box.velocity = new Vector3();
    cache.set(animal, box);
  }
  box.velocity.copy(animal.velocity);
  return updateBox(box, behaviorSeconds);
}

export function moveResidentBox(box, dx, dy, dz) {
  const p = box.animal.position;
  p.x += dx; p.y += dy; p.z += dz;
  offset.set(dx,dy,dz);
  box.center.add(offset);
  box.bounds.translate(offset);
}

const skin = new Box3(), sliceCenter = new Vector3(), sliceExtent = new Vector3();
function skinBounds(box) {
  if (!box.outline.slices) return box.bounds;
  skin.makeEmpty();
  const a = box.animal, size = a.size ?? 1;
  const decay = a.alive ? 0 : corpseDecay(a);
  const scales = [size, size*(1-.13*decay), size*(1-.28*decay)];
  for (const slice of box.outline.slices) {
    sliceCenter.copy(a.position);
    sliceExtent.set(0,0,0);
    for (let i=0; i<3; i++) {
      const axis = box.axes[i], h = slice.half.getComponent(i)*scales[i];
      sliceCenter.addScaledVector(axis,slice.center.getComponent(i)*scales[i]);
      sliceExtent.x += h*Math.abs(axis.x);
      sliceExtent.y += h*Math.abs(axis.y);
      sliceExtent.z += h*Math.abs(axis.z);
    }
    skin.expandByPoint(sliceCenter.sub(sliceExtent));
    skin.expandByPoint(sliceCenter.addScaledVector(sliceExtent,2));
  }
  return skin;
}

const trialVelocity = new Vector3(), previousHeading = new Vector3(), desiredHeading = new Vector3();
const trialBox = { center: new Vector3(), axes: [new Vector3(), new Vector3(), new Vector3()],
  half: [0,0,0], bounds: new Box3() };

// A turn sweeps the tail sideways even when the center is almost stationary.
// Spend just the available angular clearance and resume turning as the fish
// swims away from the wall. This avoids discontinuous positional corrections.
export function limitResidentTurnAtGlass(animal, dt) {
  const box = cache.get(animal);
  if (!box || box.velocity.lengthSq() < 1e-8) return 1;
  const pos = animal.position, v = animal.velocity, size = animal.size ?? 1;
  // A saved animal can start nose-first against one pane and tail-first
  // against another. A zero forward stride leaves only pivoting in place;
  // let the contact solver shift the pivot inward by the swept amount.
  if (Math.sign(v.x)*pos.x >= 3.64999 || Math.sign(v.z)*pos.z >= 1.64999) return 1;
  const reach = size + .1;
  if (Math.abs(pos.x) + reach < 3.98 && Math.abs(pos.z) + reach < 1.98 && pos.y + reach < 4.135) return 1;
  const speed = Math.hypot(v.x,v.y,v.z);
  if (speed < .001) return 1;
  previousHeading.copy(box.velocity).normalize();
  desiredHeading.copy(v).normalize();
  trialBox.animal = animal;
  trialBox.benthic = box.benthic;
  trialBox.yaw = box.yaw;
  trialBox.outline = box.outline;
  function fit(fraction) {
    trialVelocity.lerpVectors(previousHeading, desiredHeading, fraction).setLength(speed);
    updateBox(trialBox, 0, trialVelocity);
    const { min, max } = skinBounds(trialBox);
    const room = Math.min(min.x + 3.98,3.98-max.x,min.z+1.98,1.98-max.z,4.135-max.y);
    if (room < 0) return -1;
    const stride = (vel, lowGap, highGap) => vel === 0 ? 1 :
      Math.min(1, (vel > 0 ? highGap : lowGap) / (Math.abs(vel) * Math.max(1/3, dt)));
    return Math.min(stride(trialVelocity.x,min.x+3.98,3.98-max.x),
      stride(trialVelocity.z,min.z+1.98,1.98-max.z),
      trialVelocity.y > 0 ? stride(trialVelocity.y,0,4.135-max.y) : 1);
  }
  const full = fit(1);
  if (full >= 0) return full;
  if (fit(0) < .001) return 1; // Pivot off a pane when forward clearance is exhausted.
  let low = 0, high = 1;
  for (let i = 0; i < 9; i++) {
    const mid = (low + high) / 2;
    if (fit(mid) >= 0) low = mid; else high = mid;
  }
  trialVelocity.lerpVectors(previousHeading, desiredHeading, low).setLength(speed);
  v.x = trialVelocity.x; v.y = trialVelocity.y; v.z = trialVelocity.z;
  return fit(low);
}

function containInTank(box) {
  const p = box.animal.position;
  const b = box.bounds;
  const atEdge = b.min.x < -3.98 || b.max.x > 3.98 || b.min.z < -1.98 || b.max.z > 1.98 || b.max.y > 4.135 || b.min.y < .72;
  const {min,max} = atEdge ? skinBounds(box) : b;
  const dx = Math.max(-3.65-p.x, -3.98-min.x, Math.min(0,3.65-p.x,3.98-max.x));
  const dz = Math.max(-1.65-p.z, -1.98-min.z, Math.min(0,1.65-p.z,1.98-max.z));
  const x = p.x + dx, z = p.z + dz;
  let dy = Math.min(0,4.135-max.y);
  if (box.benthic) {
    dy = substrateHeight(x,z) + .025 - p.y;
  } else if (min.y < .72) {
    // Sample the footprint without forcing a descending nose through a bank.
    const floor = Math.max(substrateHeight(x,z), substrateHeight(min.x+dx,min.z+dz),
      substrateHeight(max.x+dx,min.z+dz), substrateHeight(min.x+dx,max.z+dz),
      substrateHeight(max.x+dx,max.z+dz));
    dy = Math.max(dy, floor + .014 - min.y);
  }
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-8) return false;
  moveResidentBox(box, dx,dy,dz);
  return true;
}

// A tiny fry or a fast restored animal may cover its own thickness in a
// nominal 1/30 s tick. Keep even two approaching bodies inside the contact
// solver's sampling interval. Normal cruising fish keep the usual step.
export function residentContactStep(animals, maxDt) {
  let dt = maxDt;
  for (const a of animals) {
    if (!a.alive) continue;
    const v = a.velocity, speed = Math.hypot(v.x,v.y,v.z);
    if (Number.isFinite(speed) && speed > 0) dt = Math.min(dt, .10 * (a.size ?? 1) / speed);
  }
  return Math.min(maxDt, Math.max(1/480, dt));
}

function separate(a,b) {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  delta.subVectors(b.center,a.center);
  let best = Infinity, depth = 0, mobility = 0;
  const weightA = a.animal.alive ? 1 : .2, weightB = b.animal.alive ? 1 : .2;

  function testAxis(axis) {
    const projected = delta.dot(axis);
    const overlap = boxRadiusOnAxis(a,axis) + boxRadiusOnAxis(b,axis) - Math.abs(projected);
    if (overlap <= 1e-7) return false;
    const horizontal = axis.x*axis.x + axis.z*axis.z;
    // Feet stay on the bed. Select a correction we can actually apply to
    // both bodies, rather than resolving a snail contact by pushing it down.
    const available = weightA * (a.benthic ? horizontal : 1) + weightB * (b.benthic ? horizontal : 1);
    if (available > 1e-8 && overlap*overlap < best*available) {
      best = overlap*overlap / available;
      mobility = available;
      depth = overlap;
      normal.copy(axis);
      if (projected < 0 || (projected === 0 && a.animal.id > b.animal.id)) normal.negate();
    }
    return true;
  }
  // OBB separating axes: both boxes' face normals and every nonparallel edge pair.
  for (const axis of a.axes) if (!testAxis(axis)) return false;
  for (const axis of b.axes) if (!testAxis(axis)) return false;
  for (const axisA of a.axes) for (const axisB of b.axes) {
    cross.crossVectors(axisA, axisB);
    if (cross.lengthSq() > 1e-10 && !testAxis(cross.normalize())) return false;
  }
  const correction = (depth + 1e-6) / mobility;
  moveResidentBox(a, -normal.x*weightA*correction, a.benthic ? 0 : -normal.y*weightA*correction, -normal.z*weightA*correction);
  moveResidentBox(b, normal.x*weightB*correction, b.benthic ? 0 : normal.y*weightB*correction, normal.z*weightB*correction);
  return true;
}

export function residentSkinBounds(animal, seconds = 0) {
  return skinBounds(makeResidentBox(animal, seconds)).clone();
}

export function resolveResidentContacts(animals, behaviorSeconds, constrainScene) {
  const boxes = animals.map(a => makeResidentBox(a, behaviorSeconds));
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) if (separate(boxes[j], boxes[i])) moved = true;
    }
    for (const box of boxes) {
      if (constrainScene?.(box)) moved = true;
      if (containInTank(box)) moved = true;
    }
    if (!moved) break;
  }
}
