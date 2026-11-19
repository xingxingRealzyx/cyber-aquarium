import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
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
const hulls = new WeakMap();

// The large box surrounding an angelfish includes empty corners next to its
// long fins. Contact against those corners can squeeze a neighbour back and
// forth between two fish even though their skins never meet.
function shapeFor(outline) {
  let shape = hulls.get(outline);
  if (shape) return shape;
  const corners = [];
  for (const {center, half} of outline.slices) {
    for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) {
      corners.push(new Vector3(x,y,z).multiply(half).add(center));
    }
  }
  const faces = new ConvexHull().setFromPoints(corners).faces;
  const points = new Set(), axes = [];
  for (const face of faces) {
    points.add(face.edge.head().point);
    points.add(face.edge.next.head().point);
    points.add(face.edge.tail().point);
    const n = face.normal;
    if (Math.max(Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)) < .9999 &&
        !axes.some(axis => Math.abs(axis.dot(n)) > .9999)) axes.push(n.clone());
  }
  const b = outline.bounds;
  const center = new Vector3((b[0]+b[1])/2,(b[2]+b[3])/2,(b[4]+b[5])/2);
  shape = { points: [...points].map(v => v.sub(center)), axes };
  hulls.set(outline,shape);
  return shape;
}

// Cache rotating offsets relative to the box center. The contact solver then
// translates the center freely without rebuilding or reprojecting a mesh.
function updateHull(box) {
  if (box.hullReady || !box.outline.slices) return;
  if (!box.shape) {
    box.shape = shapeFor(box.outline);
    box.points = box.shape.points.map(() => new Vector3());
    box.faceAxes = box.shape.axes.map(() => new Vector3());
  }
  const bounds = box.outline.bounds;
  const sx = 2*box.half[0]/(bounds[1]-bounds[0]);
  const sy = 2*box.half[1]/(bounds[3]-bounds[2]);
  const sz = 2*box.half[2]/(bounds[5]-bounds[4]);
  const [x,y,z] = box.axes;
  for (let i=0; i<box.points.length; i++) {
    const p = box.shape.points[i];
    box.points[i].copy(x).multiplyScalar(sx*p.x).addScaledVector(y,sy*p.y).addScaledVector(z,sz*p.z);
  }
  for (let i=0; i<box.faceAxes.length; i++) {
    const n = box.shape.axes[i];
    box.faceAxes[i].copy(x).multiplyScalar(n.x/sx).addScaledVector(y,n.y/sy).addScaledVector(z,n.z/sz).normalize();
  }
  box.hullReady = true;
}

function projectHull(box, axis, span) {
  if (!box.points) {
    const half = boxRadiusOnAxis(box,axis);
    span[0] = -half; span[1] = half;
    return;
  }
  let min=Infinity, max=-Infinity;
  for (const p of box.points) {
    const d = p.dot(axis);
    min = Math.min(min,d); max = Math.max(max,d);
  }
  span[0] = min; span[1] = max;
}
const spanA=[0,0], spanB=[0,0];

export function boxRadiusOnAxis(box, axis) {
  return box.half[0] * Math.abs(axis.dot(box.axes[0])) +
    box.half[1] * Math.abs(axis.dot(box.axes[1])) + box.half[2] * Math.abs(axis.dot(box.axes[2]));
}

function updateBox(box, seconds, v = box.animal.velocity) {
  box.skinDirty = true;
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
    cache.set(animal, box);
  }
  box.hullReady = false;
  return updateBox(box, behaviorSeconds);
}

export function moveResidentBox(box, dx, dy, dz) {
  const p = box.animal.position;
  p.x += dx; p.y += dy; p.z += dz;
  offset.set(dx,dy,dz);
  box.center.add(offset);
  box.bounds.translate(offset);
}

const skin = new Box3(), skinVertex = new Vector3();
export function skinBounds(box) {
  if (!box.outline.skinPoints) return box.bounds;
  const a = box.animal, size = a.size ?? 1;
  if (box.skinDirty) {
    const relative = box.skinOffsets ??= new Box3();
    relative.makeEmpty();
    const decay = a.alive ? 0 : corpseDecay(a);
    const sy = size * (1-.13*decay), sz = size * (1-.28*decay);
    const [x,y,z] = box.axes;
    for (const p of box.outline.skinPoints) {
      skinVertex.copy(x).multiplyScalar(size*p.x).addScaledVector(y,sy*p.y).addScaledVector(z,sz*p.z);
      relative.expandByPoint(skinVertex);
    }
    relative.expandByScalar(.002*size);
    box.skinDirty = false;
  }
  return skin.copy(box.skinOffsets).translate(a.position);
}

// Ease the stride as the fins near a pane, so that a fast swimmer arcs away
// from the glass instead of reaching it and being deflected along it.
// Turning beside the glass is left to moveResident.
export function residentGlassStride(animal, seconds, dt, v = animal.velocity) {
  const box = makeResidentBox(animal, seconds);
  const speed = Math.hypot(v.x,v.y,v.z);
  if (speed < 1e-8) return 1;
  const horizon = Math.max(1/3, dt);
  const {min:lo,max:hi} = box.bounds;
  if (lo.x + Math.min(0,v.x)*horizon >= -3.98 && hi.x + Math.max(0,v.x)*horizon <= 3.98 &&
      lo.z + Math.min(0,v.z)*horizon >= -1.98 && hi.z + Math.max(0,v.z)*horizon <= 1.98 &&
      hi.y + Math.max(0,v.y)*horizon <= 4.135) return 1;
  const { min, max } = skinBounds(box);
  const stride = (velocity, low, high) => velocity === 0 ? 1 :
    Math.max(0, Math.min(1, (velocity > 0 ? high : low) / (Math.abs(velocity) * horizon)));
  // At a grazing angle only the normal component is blocked. Keep enough
  // stroke for moveResident to slide the fish along the pane and turn away.
  return Math.min(1, Math.hypot(v.x * stride(v.x, min.x+3.98, 3.98-max.x),
    v.y * (v.y > 0 ? stride(v.y, 0, 4.135-max.y) : 1), v.z * stride(v.z, min.z+1.98, 1.98-max.z)) / speed);
}

export function containInTank(box) {
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

function residentContact(a,b) {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  updateHull(a); updateHull(b);
  delta.subVectors(b.center,a.center);
  let best = Infinity, depth = 0, mobility = 0;
  const weightA = a.animal.alive ? 1 : .2, weightB = b.animal.alive ? 1 : .2;

  function testAxis(axis) {
    const projected = delta.dot(axis);
    projectHull(a,axis,spanA);
    projectHull(b,axis,spanB);
    const positive = spanA[1] - spanB[0] - projected;
    const negative = spanB[1] - spanA[0] + projected;
    const overlap = Math.min(positive, negative);
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
      if (negative < positive || (negative === positive && a.animal.id > b.animal.id)) normal.negate();
    }
    return true;
  }
  // A separating plane between either pair of conservative envelopes is
  // sufficient. Face normals also test the empty water beside tapered fins.
  for (const axis of a.axes) if (!testAxis(axis)) return false;
  for (const axis of b.axes) if (!testAxis(axis)) return false;
  if (a.faceAxes) for (const axis of a.faceAxes) if (!testAxis(axis)) return false;
  if (b.faceAxes) for (const axis of b.faceAxes) if (!testAxis(axis)) return false;
  for (const axisA of a.axes) for (const axisB of b.axes) {
    cross.crossVectors(axisA, axisB);
    if (cross.lengthSq() > 1e-10 && !testAxis(cross.normalize())) return false;
  }
  return { depth, mobility, weightA, weightB };
}

function separate(a,b) {
  const contact = residentContact(a,b);
  if (!contact) return false;
  const { depth, mobility, weightA, weightB } = contact;
  const correction = (depth + 1e-6) / mobility;
  moveResidentBox(a, -normal.x*weightA*correction, a.benthic ? 0 : -normal.y*weightA*correction, -normal.z*weightA*correction);
  moveResidentBox(b, normal.x*weightB*correction, b.benthic ? 0 : normal.y*weightB*correction, normal.z*weightB*correction);
  return true;
}

export function residentSkinBounds(animal, seconds = 0) {
  return skinBounds(makeResidentBox(animal, seconds)).clone();
}

// A newborn or freshly stocked fish has no visible path yet. Find water
// around its intended position before its first frame, leaving everyone
// already in the tank in place. Siblings are placed in birth order.
export function placeNewResidents(state, first, overlapsScene) {
  const { animals, behaviorSeconds } = state;
  const occupied = animals.slice(0,first).map(a => makeResidentBox(a,behaviorSeconds));
  const goldenAngle = Math.PI*(3-Math.sqrt(5));
  for (const animal of animals.slice(first)) {
    const box = makeResidentBox(animal,behaviorSeconds);
    const p = animal.position, origin = { ...p };
    const free = () => !overlapsScene?.(box) && !occupied.some(other => residentContact(other,box));
    containInTank(box);
    if (!free()) {
      // Even directions on successive shells. Rotate each shell so that a
      // fish behind a shoal or a rock can find a gap at the edge of the tank.
      const step = Math.max(.15, animal.size * .28), count = box.benthic ? 16 : 32;
      let placed = false;
      for (let ring=1; ring*step<8.5 && !placed; ring++) {
        const r = ring*step;
        for (let i=0; i<count; i++) {
          const y = box.benthic ? 0 : (2*i+1)/count-1;
          const angle = ring*goldenAngle + i*(box.benthic ? 2*Math.PI/count : goldenAngle);
          const horizontal = r*Math.sqrt(1-y*y);
          const x = origin.x + horizontal*Math.cos(angle), z = origin.z + horizontal*Math.sin(angle);
          const height = box.benthic ? substrateHeight(x,z)+.025 : origin.y + r*y;
          if (Math.abs(x)>3.65 || Math.abs(z)>1.65 || (!box.benthic && (height<.67 || height>3.96))) continue;
          moveResidentBox(box,x-p.x,height-p.y,z-p.z);
          containInTank(box);
          if (free()) { placed=true; break; }
        }
      }
      if (!placed) {
        moveResidentBox(box,origin.x-p.x,origin.y-p.y,origin.z-p.z);
        containInTank(box);
      }
    }
    occupied.push(box);
  }
}

// Settle a static arrangement, such as a test layout, by separating bodies.
// Swimming residents never pass through here; see moveResident below.
export function resolveResidentContacts(animals, behaviorSeconds, constrainScene) {
  const boxes = animals.map(a => makeResidentBox(a, behaviorSeconds));
  // A wedged pair may need several passes, while the rest of the tank keeps
  // its already validated poses. Recheck its neighbours whenever a fish moves.
  let dirty = new Uint8Array(boxes.length).fill(1), changed = new Uint8Array(boxes.length);
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    changed.fill(0);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!(dirty[i] || dirty[j] || changed[i] || changed[j])) continue;
        if (separate(boxes[j], boxes[i])) {
          changed[i] = changed[j] = 1;
          moved = true;
        }
      }
    }
    for (let i=0; i<boxes.length; i++) {
      if (!dirty[i] && !changed[i]) continue;
      const box = boxes[i];
      const sceneMoved = constrainScene?.(box);
      if (containInTank(box) || sceneMoved) {
        changed[i] = 1;
        moved = true;
      }
    }
    if (!moved) break;
    [dirty,changed] = [changed,dirty];
  }
}

// Everything a resident touches in its current pose: panes, the bed, other
// residents and scenery. The visitor
// receives a key for each contact, its depth and the way out of it.
function eachContact(box, animals, scene, visit) {
  const a = box.animal, p = a.position;
  const b = box.bounds;
  if (b.min.x < -3.98 || b.max.x > 3.98 || b.min.z < -1.98 || b.max.z > 1.98 || b.max.y > 4.135 || b.min.y < .72) {
    const {min,max} = skinBounds(box);
    if (min.x < -3.98) visit('-x', -3.98-min.x, 1,0,0);
    if (max.x > 3.98) visit('+x', max.x-3.98, -1,0,0);
    if (min.z < -1.98) visit('-z', -1.98-min.z, 0,0,1);
    if (max.z > 1.98) visit('+z', max.z-1.98, 0,0,-1);
    if (max.y > 4.135) visit('+y', max.y-4.135, 0,-1,0);
    if (!box.benthic && min.y < .72) {
      const floor = Math.max(substrateHeight(p.x,p.z), substrateHeight(min.x,min.z), substrateHeight(max.x,min.z),
        substrateHeight(min.x,max.z), substrateHeight(max.x,max.z)) + .014;
      if (min.y < floor) visit('-y', floor-min.y, 0,1,0);
    }
  }
  for (const other of animals) {
    if (other === a) continue;
    const otherBox = cache.get(other);
    const contact = otherBox && residentContact(otherBox, box);
    if (contact) visit(other, contact.depth, normal.x, normal.y, normal.z);
  }
  scene?.contacts?.(box, visit);
}

const before = new Map(), exit = new Vector3();
const from = new Vector3(), to = new Vector3(), place = new Vector3();
const heading = new Vector3(), turned = new Vector3(), trial = new Vector3();
const creviceDirections = [[0,1,0],[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,-1,0]].map(v=>new Vector3(...v));
// A grazer can back along its body or crawl across the substrate while its
// shell or antennae turn. Its feet must follow the bed on every trial.
const bedDirections = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  .map(([x,z]) => new Vector3(x,0,z).normalize());
const bedTurns = [[0,0],[-1,0],[1,0]];
const creviceTurns = [[0,0],[-1,0],[1,0],[0,1],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]];

// Collisions only ever hold a resident back; they never move it anywhere it
// did not swim. Travel may start no new contact and deepen no existing one,
// so a fish heading into a stone keeps only the part of its stroke that runs
// along the face, while one that a diver or a newly placed stone has
// overlapped can still swim out on its own.
// Turning checks the same geometry as travel, including the sweep of the
// fins beside stones. When space is tight the resident takes the safe part
// of its turn and swims on to make room for the rest. Unable to turn or swim
// on, as nose-first in a corner, it comes round about its end nearest the
// contact, or backs off by up to `backOff`, away from the contact or straight
// back along its body, the way a fish sculls with its pectoral fins.
// Returns the way out of whatever held it back, with `resident` set when that
// was another animal.
export function moveResident(animal, start, previousVelocity, animals, seconds, scene, backOff = 0, retreat = null) {
  const p = animal.position, v = animal.velocity;
  from.set(start.x, start.y, start.z); to.set(p.x, p.y, p.z);
  heading.set(previousVelocity.x, previousVelocity.y, previousVelocity.z);
  turned.set(v.x, v.y, v.z);
  const speed = turned.length();
  const box = cache.get(animal) ?? makeResidentBox(animal, seconds);
  // A turn in a narrow passage takes more than one stroke. A newly clear
  // forward stroke must not immediately undo the sideways clearance gained
  // on the previous frame while the fins are still coming around.
  // A deliberate backward stride replaces a stale recovery stroke that
  // would carry the animal straight back into the passage it is leaving.
  if (retreat) {
    if (box.escapeDirection?.dot(retreat) < 0) box.escapeUntil = 0;
    if (box.scullDirection?.dot(retreat) < 0) box.scullUntil = 0;
  }
  const sculling = box.scullUntil > seconds;
  if (sculling) {
    const stroke = place.subVectors(to,from);
    const undo = stroke.dot(box.scullDirection);
    if (undo < 0) to.addScaledVector(box.scullDirection,-undo);
  }
  function pose(position, velocity) {
    p.x = position.x; p.z = position.z;
    p.y = box.benthic ? substrateHeight(p.x,p.z) + .025 : position.y;
    v.x = velocity.x; v.y = velocity.y; v.z = velocity.z;
    makeResidentBox(animal, seconds);
  }
  let worst = 0, blocker = null;
  function measure() {
    before.clear();
    eachContact(box, animals, scene, (key, depth) => before.set(key, depth));
  }
  function clear(position, velocity) {
    pose(position, velocity);
    worst = 0;
    eachContact(box, animals, scene, (key, depth, x, y, z) => {
      const excess = depth - (before.get(key) ?? 0);
      if (excess > 1e-12 && excess > worst) { worst = excess; exit.set(x,y,z); blocker = key; }
    });
    return worst === 0;
  }
  function stopped() {
    const way = exit.clone();
    way.resident = animals.includes(blocker);
    return way;
  }
  const still = heading.lengthSq() < 1e-12;
  const unit = (still ? turned : heading).clone().normalize(), aim = turned.clone().normalize();
  function towards(target, fraction) {
    if (still) return trial.copy(turned);
    return trial.copy(unit).lerp(target, fraction).setLength(speed);
  }
  function farthest(test) {
    let low = 0, high = 1;
    for (let i = 0; i < 6; i++) {
      const mid = (low + high) / 2;
      if (test(mid)) low = mid; else high = mid;
    }
    return low;
  }
  function turnAt(position) {
    return clear(position, turned) ? 1 : farthest(h => clear(position, towards(aim, h)));
  }
  pose(from, heading);
  measure();
  function scull(direction,yaw,pitch,distance) {
    const angle = distance * 4.5 / Math.max(1,Math.hypot(yaw,pitch));
    const az = Math.atan2(unit.z,unit.x) + yaw*angle;
    const startPitch = Math.atan2(unit.y,Math.hypot(unit.x,unit.z));
    const el = Math.max(Math.min(-.85,startPitch),Math.min(Math.max(.85,startPitch),startPitch+pitch*angle));
    trial.set(Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el)).multiplyScalar(speed);
    return clear(place.copy(from).addScaledVector(direction,distance),trial);
  }
  const minimumSpeed = box.benthic ? .001 : .01;
  const crevice = backOff > 0 && heading.lengthSq() > minimumSpeed**2 && speed > minimumSpeed;
  if (crevice && box.escapeUntil > seconds) {
    if (scull(box.escapeDirection,box.escapeYaw,box.escapePitch,backOff)) return null;
    box.escapeUntil = 0;
  }
  if (clear(to, turned)) return null;
  if (crevice) {
    // Leave a working retreat alone. Even a small side-step is meaningful
    // progress for a snail or shrimp, whose back-off pace is only .04/s.
    const progress = box.benthic ? .02 : .04;
    if (!box.blockedAt || from.distanceToSquared(box.blockedAt) > progress**2 || seconds-box.lastBlocked > .2) {
      (box.blockedAt ??= new Vector3()).copy(from);
      box.probeAt = seconds + .6;
    }
    box.lastBlocked = seconds;
    if (seconds >= box.probeAt) {
      box.probeAt = seconds + .6;
      let longest = 0;
      // A head or tail trapped between sloping faces may need to swing while
      // the fish backs out. Preview connected strokes along one course, then
      // recheck each actual small step against today's neighbours and scenery.
      const directions = box.benthic ? [unit.clone().negate(), ...bedDirections] : creviceDirections;
      const turns = box.benthic ? bedTurns : creviceTurns;
      scan: for (const direction of directions) for (const [yaw,pitch] of turns) {
        let reach = 0;
        for (const distance of [backOff,.025,.075,.16,.3]) {
          if (!scull(direction,yaw,pitch,distance)) break;
          reach = distance;
        }
        if (reach <= longest || reach < .075) continue;
        longest = reach;
        box.escapeDirection = direction;
        box.escapeYaw = yaw;
        box.escapePitch = pitch;
        if (reach === .3) break scan;
      }
      if (longest && scull(box.escapeDirection,box.escapeYaw,box.escapePitch,backOff)) {
        box.escapeUntil = seconds + longest/(box.benthic ? .04 : .12);
        return null;
      }
    }
  }
  let held = null, velocity = turned.clone();
  const origin = from.clone();
  if (!clear(from, turned)) {
    held = stopped();
    const pivot = new Vector3();
    eachContact(box, animals, scene, (key, depth, x, y, z) => {
      const excess = depth - (before.get(key) ?? 0);
      if (excess > 0) pivot.x += x*excess, pivot.y += y*excess, pivot.z += z*excess;
    });
    // Arc away from the glass, turning only as far as the fins allow. Swimming
    // on makes room for the rest of the turn.
    const turn = still ? 0 : farthest(h => clear(from, towards(aim, h)));
    velocity = towards(aim, turn).clone();
    const stroke = place.subVectors(to,from), length = stroke.length();
    const sliding = box.benthic && stroke.dot(unit) < .65 * length;
    const stuck = turn < .25 && (length < 1e-4 * Math.max(speed,.01) || sliding || !clear(to,velocity));
    // Unable to turn or swim on, come round about the end nearest the pane
    // rather than the middle. That end stays put; the body moves by just as
    // much as the turn would have carried it through the glass.
    if (stuck && pivot.lengthSq() > 1e-16 && pivot.length() <= backOff) {
      pivot.add(from);
      if (clear(pivot, heading) && clear(pivot, turned)) {
        origin.copy(pivot);
        velocity.copy(turned);
      }
    }
    if (stuck && origin.equals(from) && backOff > 0 && !still) {
      // Backing off is travel, so nothing at all may stand in its way.
      let most = turn, retreat, opposingFaces = false;
      const directions = [held, unit.clone().negate()];
      if (sculling) directions.unshift(box.scullDirection);
      for (const way of directions) {
        const shift = way.clone().multiplyScalar(backOff);
        let alongSeam = false;
        for (let pass = 0; pass < 3; pass++) {
          if (sculling && shift.dot(box.scullDirection) < -backOff*.1) break;
          const position = from.clone().add(shift);
          if (clear(position, heading)) {
            const amount = turnAt(position);
            const opensGap = shift.dot(held) > backOff*.25 || (opposingFaces && shift.length() > backOff*.25) ||
              (sculling && shift.dot(box.scullDirection) > backOff*.5);
            if (amount > most || (!retreat && amount === most && opensGap)) {
              most = amount;
              retreat = position;
            }
            break;
          }
          // At a glass/rock seam a straight retreat can run into the rock.
          // Slide the same stroke along the second face to open a turning gap.
          const face = stopped();
          if (box.benthic) { face.y = 0; face.normalize(); }
          const inward = shift.dot(face);
          if (inward >= -1e-9) break;
          shift.addScaledVector(face,-inward);
          if (shift.lengthSq() < backOff*backOff*.01 && face.dot(held) < -.95 && !alongSeam) {
            // Opposing faces allow no straight retreat. Scull forward along
            // their common tangent until the body has room to turn.
            shift.copy(unit).addScaledVector(held,-unit.dot(held));
            if (shift.lengthSq() < .01) shift.set(held.z,0,-held.x);
            if (shift.lengthSq() < .01) shift.set(1,0,0);
            shift.setLength(backOff);
            alongSeam = true;
            opposingFaces = true;
          }
        }
      }
      if (retreat) {
        if (opposingFaces || sculling) {
          box.scullDirection ??= new Vector3();
          box.scullDirection.subVectors(retreat,from).normalize();
          box.scullUntil = seconds + .35;
        }
        pose(retreat, towards(aim,most));
        return held;
      }
    }
  }
  pose(origin, velocity);
  measure();
  // Against a face, keep the part of the stroke that runs along it and drop
  // the part that runs into it. A second face, as in a pocket, drops more.
  const stroke = to.clone().sub(from);
  let face = null;
  for (let pass = 0; pass < 3; pass++) {
    if (clear(place.addVectors(origin, stroke), velocity)) return face ?? held;
    const way = stopped();
    face ??= way;
    if (box.benthic) { way.y = 0; way.normalize(); }
    const inward = stroke.dot(way);
    if (!(inward < 0)) break;
    stroke.addScaledVector(way, -inward);
  }
  const travel = farthest(f => clear(place.copy(origin).addScaledVector(stroke, f), velocity));
  pose(place.copy(origin).addScaledVector(stroke, travel), velocity);
  return face ?? held;
}
