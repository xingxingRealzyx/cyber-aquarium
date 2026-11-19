import { Quaternion, Vector3 } from 'three';
import { floatOnSurface } from './toy-motion.js';
import { substrateHeight, TOYS } from './simulation.js';

const gap = .002;
const previousTilt = new Quaternion(), still = new Vector3();
const delta = new Vector3(), target = new Vector3(), direction = new Vector3();
const oldOffset = new Vector3(), candidate = new Vector3(), normal = new Vector3();
const local = new Vector3(), retreat = new Vector3(), anchor = new Vector3(), nearGoal = new Vector3();

function hull(count) {
  return { lo: new Float64Array(count), hi: new Float64Array(count) };
}

// Intersection of a swept moving hull with a stationary hull, including thin
// branches that both endpoints clear. A negative entry means they already touch.
function interval(axes, p, shape, velocity, solid) {
  let enter = -Infinity, exit = Infinity, face = 0;
  for (let i = 0; i < axes.length; i++) {
    const center = axes[i].dot(p), rate = axes[i].dot(velocity);
    const lo = solid.lo[i] - shape.hi[i] - center, hi = solid.hi[i] - shape.lo[i] - center;
    if (Math.abs(rate) < 1e-10) {
      if (lo >= 0 || hi <= 0) return null;
    } else {
      const a = (rate > 0 ? lo : hi) / rate, b = (rate > 0 ? hi : lo) / rate;
      if (a > enter) { enter = a; face = i; }
      exit = Math.min(exit,b);
      if (exit <= Math.max(enter,0)) return null;
    }
  }
  return { enter, exit, face };
}

function nearSegment(shape, a, b, solid, margin=0) {
  return Math.min(a.x,b.x) + shape.lo[0] < solid.hi[0]+margin && Math.max(a.x,b.x) + shape.hi[0] > solid.lo[0]-margin &&
    Math.min(a.y,b.y) + shape.lo[1] < solid.hi[1]+margin && Math.max(a.y,b.y) + shape.hi[1] > solid.lo[1]-margin &&
    Math.min(a.z,b.z) + shape.lo[2] < solid.hi[2]+margin && Math.max(a.z,b.z) + shape.hi[2] > solid.lo[2]-margin;
}

function contain(p, shape, kind, level, courseY) {
  p.x = Math.max(-3.98-shape.lo[0], Math.min(3.98-shape.hi[0],p.x));
  p.z = Math.max(-1.98-shape.lo[2], Math.min(1.98-shape.hi[2],p.z));
  if (TOYS[kind].surface) { p.y = courseY; return; }
  // Keep fins clear across their footprint, including the raised sand bank.
  let bed = substrateHeight(p.x,p.z);
  for (const dx of [shape.lo[0],shape.hi[0]]) for (const dz of [shape.lo[2],shape.hi[2]])
    bed = Math.max(bed,substrateHeight(p.x+dx,p.z+dz));
  const top = kind === 'author' ? Math.max(courseY,level-shape.hi[1]-.01) : level-shape.hi[1]-.01;
  p.y = Math.min(top,Math.max(p.y,bed-shape.lo[1]+.015));
}

// A new toy or a growing plant can appear already overlapping several pieces.
// Find the nearest exit from their union; pushing off one face at a time can
// oscillate forever between adjacent stones or the glass.
function separate(axes, p, shape, solids, kind, level, courseY) {
  direction.set(0,0,0);
  if (!solids.some(s => nearSegment(shape,p,p,s) && interval(axes,p,shape,direction,s))) return;
  // A rotating fin can use up the last millimetre of clearance beside the
  // glass. Try small local projections first; a ray through several adjacent
  // hulls might otherwise lead to the far side of the whole group.
  local.copy(p);
  for (let pass=0;pass<12;pass++) {
    let touching=false;
    for (const solid of solids) {
      if (!nearSegment(shape,local,local,solid) || !interval(axes,local,shape,direction,solid)) continue;
      let shortest=Infinity;
      for (let i=0;i<axes.length;i++) for (const sign of [-1,1]) {
        normal.copy(axes[i]).multiplyScalar(sign);
        if (TOYS[kind].surface) normal.y=0;
        const room=normal.lengthSq();
        if (room<1e-8) continue;
        const center=axes[i].dot(local);
        const depth=(sign>0 ? solid.hi[i]-shape.lo[i]-center : center+shape.hi[i]-solid.lo[i])+gap;
        if (depth*depth/room>=shortest) continue;
        candidate.copy(local).addScaledVector(normal,depth/room);
        contain(candidate,shape,kind,level,courseY);
        const distance=candidate.distanceToSquared(local);
        if (distance>=shortest || sign*(axes[i].dot(candidate)-center)<depth-.00001) continue;
        shortest=distance; retreat.copy(candidate);
      }
      if (Number.isFinite(shortest)) local.copy(retreat);
      touching=true;
    }
    if (!touching) { p.copy(local); return; }
  }
  let best = Infinity;
  const exitPoint = new Vector3();
  for (const axis of axes) for (const sign of [-1,1]) {
    if (TOYS[kind].surface && axis.y) continue;
    direction.copy(axis).multiplyScalar(sign);
    const spans = [];
    candidate.copy(p).addScaledVector(direction,Math.min(best,9));
    for (const s of solids) {
      if (!nearSegment(shape,p,candidate,s)) continue;
      const span = interval(axes,p,shape,direction,s);
      if (span) spans.push(span);
    }
    spans.sort((a,b) => a.enter-b.enter);
    let distance = 0;
    for (const span of spans) {
      if (span.enter > distance+gap) break;
      distance = Math.max(distance,span.exit);
    }
    distance += gap;
    if (distance >= best) continue;
    candidate.copy(p).addScaledVector(direction,distance);
    const x=candidate.x, y=candidate.y, z=candidate.z;
    contain(candidate,shape,kind,level,courseY);
    if (Math.hypot(candidate.x-x,candidate.y-y,candidate.z-z) > 1e-6) continue;
    best = distance; exitPoint.copy(candidate);
  }
  if (Number.isFinite(best)) p.copy(exitPoint);
}

function slide(axes, p, shape, goal, solids, kind, level, courseY) {
  contain(goal,shape,kind,level,courseY);
  delta.subVectors(goal,p);
  for (let pass=0; pass<4 && delta.lengthSq()>1e-12; pass++) {
    candidate.copy(p).add(delta);
    let contact = null;
    for (const s of solids) {
      if (!nearSegment(shape,p,candidate,s)) continue;
      const hit = interval(axes,p,shape,delta,s);
      if (hit && hit.enter >= -1e-8 && hit.enter <= 1 && (!contact || hit.enter<contact.enter)) contact=hit;
    }
    if (!contact) { p.copy(candidate); break; }
    const fraction = Math.max(0,contact.enter-gap/delta.length());
    p.addScaledVector(delta,fraction);
    delta.multiplyScalar(1-fraction);
    normal.copy(axes[contact.face]);
    if (TOYS[kind].surface) normal.setY(0).normalize();
    delta.addScaledVector(normal,-delta.dot(normal));
  }
  contain(p,shape,kind,level,courseY);
  separate(axes,p,shape,solids,kind,level,courseY);
}

// The renderer supplies raw course poses once for the entire tank. These
// states are transient: only the rigid body / swimmer is displaced; the
// swimmer's detached bubbles keep their own positions in tank coordinates.
export function createToyContacts(axes, measure, residentHull) {
  let tracks = new WeakMap();
  const residents = new WeakMap();
  let rocks, roots, furniture, lastTime;
  function capture(model) {
    const track=tracks.get(model);
    if (!track) return null;
    return {time:track.time,position:track.position.toArray(), rotations:track.joints.flatMap(({previous})=>previous.toArray()),
      bubbles:model.userData.author?.captureBubbles() ?? []};
  }
  function place(models, equipment, scenery, plants, animals, seconds, level, flowSeconds) {
    // A thaw after background fast-forward starts at the current course. A
    // single chord through minutes of unseen laps is not physical travel.
    if (seconds<lastTime-1e-8 || seconds-lastTime>2.1) tracks=new WeakMap();
    lastTime=seconds;
    const rearranged=rocks !== scenery || roots !== plants?.roots;
    if (rearranged) {
      rocks=scenery; roots=plants?.roots; furniture=[...equipment,...scenery,...(roots ?? [])];
      for (const leaf of plants?.leaves ?? []) {
        const canopy=hull(axes.length);
        for (let i=0;i<axes.length;i++) {
          const sway=Math.abs(axes[i].x)*(leaf.swayX ?? 0)+Math.abs(axes[i].z)*(leaf.swayZ ?? 0);
          canopy.lo[i]=leaf.lo[i]-sway; canopy.hi[i]=leaf.hi[i]+sway;
        }
        furniture.push(canopy);
      }
    }
    const entries = [...models];
    if (!entries.length) return;
    const animalBodies = [];
    for (const a of animals) {
      let body=residents.get(a);
      if (!body) { body=hull(axes.length); residents.set(a,body); }
      residentHull(a,seconds,body);
      animalBodies.push(body);
    }
    // A toy must see its neighbours even if they have yet to take their
    // turn this tick. Each swept move ends before the next toy takes its turn.
    const neighbours = entries.map(m => tracks.get(m)?.occupied);
    for (const [index,model] of entries.entries()) {
      const kind=model.userData.toyKind, swimmer=model.userData.author?.swimmer;
      const body=swimmer ?? model, course=body.position;
      let track=tracks.get(model), restored=false;
      if (!track) {
        track={shape:hull(axes.length),occupied:hull(axes.length),position:course.clone(),goal:course.clone(),time:seconds};
        // Save only the joints that move. A swimmer may need to shorten a
        // stroke or wait for a neighbouring toy to drift out of its way.
        track.joints=[];
        body.traverse(node=>{
          if (node===body || (swimmer && (node.isBone || node.isGroup)))
            track.joints.push({node,previous:node.quaternion.clone(),wanted:node.quaternion.clone()});
        });
        const saved=model.userData.savedToyPose;
        delete model.userData.savedToyPose;
        if (saved && Math.abs(saved.time-seconds)<1e-8 && saved.rotations.length===track.joints.length*4) {
          track.position.fromArray(saved.position);
          for (const [i,{node,previous}] of track.joints.entries()) {
            previous.fromArray(saved.rotations,i*4);
            node.quaternion.copy(previous);
          }
          model.userData.author?.restoreBubbles(saved.bubbles);
          restored=true;
        }
        tracks.set(model,track);
      }
      const {shape,position,occupied} = track;
      const dt=Math.max(0,seconds-track.time), continuous=!!neighbours[index] && !rearranged && dt>0 && dt<.5;
      for (const {node,previous,wanted} of track.joints) {
        wanted.copy(node.quaternion);
        if (continuous) node.quaternion.copy(previous).rotateTowards(wanted,(node===body?2:6)*dt);
        wanted.copy(node.quaternion);
      }
      measure(model,shape);
      anchor.copy(position);
      oldOffset.subVectors(position,track.goal);
      target.copy(course).addScaledVector(oldOffset,Math.exp(-1.25*dt));
      track.goal.copy(course);
      if (!restored) {
        const travel=(kind==='author' ? 1.3 : .7)*dt+.002;
        // A continuous move can finish only near its last pose. Keep all
        // solids in that neighbourhood, including room for joint rotation.
        const solids=continuous ? furniture.filter(s=>nearSegment(shape,position,target,s,travel+.3)) : [...furniture];
        solids.push(...animalBodies);
        for (const [other,obstacle] of neighbours.entries()) if (other!==index && obstacle) solids.push(obstacle);
        if (TOYS[kind].surface) position.y = course.y;
        contain(position,shape,kind,level,course.y);
        separate(axes,position,shape,solids,kind,level,course.y);
        slide(axes,position,shape,target,solids,kind,level,course.y);
        if (continuous && position.distanceToSquared(anchor)>travel*travel) {
          // The nearest unrestricted exit can be on the far side of several
          // neighbours. Limit travel and shorten the requested pose in place.
          // At fraction zero the previous joints and previously occupied
          // space remain available while the other toys finish their sweeps.
          nearGoal.subVectors(position,anchor).clampLength(0,travel-.0001).add(anchor);
          for (const fraction of [1,.5,0]) {
            if (fraction!==1) {
              for (const {node,previous,wanted} of track.joints) node.quaternion.slerpQuaternions(previous,wanted,fraction);
              measure(model,shape);
            }
            position.copy(anchor);
            contain(position,shape,kind,level,course.y);
            separate(axes,position,shape,solids,kind,level,course.y);
            target.copy(nearGoal);
            slide(axes,position,shape,target,solids,kind,level,course.y);
            if (position.distanceToSquared(anchor)<=travel*travel) break;
            if (fraction===0) position.copy(anchor);
          }
        }
        // Settle a deflected float on the wave at its new location. If a
        // neighbouring body supports it, keep that contact's draft and tilt.
        if (TOYS[kind].surface && Number.isFinite(flowSeconds) &&
            Math.hypot(position.x-course.x,position.z-course.z)>.0001) {
          previousTilt.copy(body.quaternion);
          floatOnSurface(body,position.x,position.z,level,flowSeconds,body.rotation.y);
          measure(model,shape);
          const clear=solids.every(s=>!nearSegment(shape,course,course,s) || !interval(axes,course,shape,still,s)) &&
            course.x+shape.lo[0]>=-3.98 && course.x+shape.hi[0]<=3.98 &&
            course.z+shape.lo[2]>=-1.98 && course.z+shape.hi[2]<=1.98;
          if (clear && (!continuous || course.distanceToSquared(anchor)<=travel*travel)) position.y=course.y;
          else { body.quaternion.copy(previousTilt); measure(model,shape); }
        }
      }
      for (const {node,previous} of track.joints) previous.copy(node.quaternion);

      for (let i=0;i<axes.length;i++) {
        const d=axes[i].dot(position), lo=shape.lo[i]+d, hi=shape.hi[i]+d;
        occupied.lo[i]=lo; occupied.hi[i]=hi;
      }
      neighbours[index]=occupied;
      track.time=seconds;
      body.position.copy(position);
    }
  }
  return {place,capture};
}
