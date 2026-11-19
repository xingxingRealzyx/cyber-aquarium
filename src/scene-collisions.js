import { Box3, Matrix4, Vector3 } from 'three';
import { boxRadiusOnAxis, containInTank, makeResidentBox, moveResidentBox, skinBounds } from './resident-collisions.js';
import { substrateHeight } from './simulation.js';
import { createToyContacts } from './toy-contacts.js';
import { createFeedingSegments } from './feeding-segment.js';
import { animalTurnRate } from './behavior.js';

// Supporting planes in 13 directions enclose the actual scanned surfaces.
// The first three pairs also provide a cheap AABB broad phase.
const axes = [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,-1,0],[1,0,1],[1,0,-1],
  [0,1,1],[0,1,-1],[1,1,1],[-1,1,1],[1,-1,1],[1,1,-1]].map(v => new Vector3(...v).normalize());
const point = new Vector3(), offset = new Vector3();
const pointHull = { lo: new Float64Array(axes.length), hi: new Float64Array(axes.length) };
function volume() {
  return { lo: new Float64Array(axes.length).fill(Infinity), hi: new Float64Array(axes.length).fill(-Infinity) };
}
function expand(solid, p) {
  for (let i = 0; i < axes.length; i++) {
    const projection = p.dot(axes[i]);
    solid.lo[i] = Math.min(solid.lo[i], projection);
    solid.hi[i] = Math.max(solid.hi[i], projection);
  }
}

// Plant stems and leaf bases are generated as contiguous rings of mesh
// vertices. Enclosing just a few rings preserves the gaps between shoots.
export function hullFromVertices(positions, first, count) {
  const hull = volume();
  for (let i = first; i < first + count; i++) expand(hull, point.fromArray(positions, i * 3));
  return hull;
}

// A branch may fork or arch over open water. Fit a separate hull around the
// complete triangles in each local cell; even a long triangle stays covered.
export function scanSolids(geometry, segmented = false) {
  const points = geometry.getAttribute('position'), index = geometry.index;
  const byCell = new Map(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < (index?.count ?? points.count); i += 3) {
    a.fromBufferAttribute(points, index ? index.getX(i) : i);
    b.fromBufferAttribute(points, index ? index.getX(i+1) : i+1);
    c.fromBufferAttribute(points, index ? index.getX(i+2) : i+2);
    const key = segmented ? [a.x+b.x+c.x,a.y+b.y+c.y,a.z+b.z+c.z].map(sum => Math.floor(sum / 1.35)).join(',') : 0;
    if (!byCell.has(key)) byCell.set(key, volume());
    const solid = byCell.get(key);
    expand(solid, a); expand(solid, b); expand(solid, c);
  }
  return [...byCell.values()];
}

// Vertices of the local supporting-plane hull. Intersecting each independent
// triple preserves round helmet and shoulder surfaces through joint rotations.
const triples=[];
for (let i=0;i<axes.length;i++) for (let j=0;j<i;j++) for (let k=0;k<j;k++) {
  const x=new Vector3().crossVectors(axes[j],axes[k]), determinant=x.dot(axes[i]);
  if (Math.abs(determinant)<1e-8) continue;
  triples.push({i,j,k,x:x.divideScalar(determinant),
    y:new Vector3().crossVectors(axes[k],axes[i]).divideScalar(determinant),
    z:new Vector3().crossVectors(axes[i],axes[j]).divideScalar(determinant)});
}
function movingPart(node, hull) {
  const vertices=[], {lo,hi}=hull;
  const bounds=new Box3(new Vector3(lo[0],lo[1],lo[2]),new Vector3(hi[0],hi[1],hi[2]));
  for (const {i,j,k,x,y,z} of triples) {
    for (const a of [lo[i],hi[i]]) for (const b of [lo[j],hi[j]]) for (const c of [lo[k],hi[k]]) {
      point.copy(x).multiplyScalar(a).addScaledVector(y,b).addScaledVector(z,c);
      if (axes.every((n,d)=>{const p=n.dot(point); return p>=lo[d]-1e-7 && p<=hi[d]+1e-7;}) &&
          !vertices.some(v=>v.distanceToSquared(point)<1e-12)) vertices.push(point.clone());
    }
  }
  const part={node,center:bounds.getCenter(new Vector3()),half:bounds.getSize(new Vector3()).multiplyScalar(.5),
    current:volume(),swept:volume(),initialized:false,vertices,previous:new Matrix4(),pose:new Matrix4(),
    fine:volume(),fineSweep:volume(),ready:false};
  part.current.part=part; part.swept.part=part;
  return part;
}

function fitted(solid) {
  const part=solid.part;
  if (!part || !part.vertices.length) return solid;
  if (!part.ready) {
    const {fine,fineSweep}=part;
    fine.lo.fill(Infinity); fine.hi.fill(-Infinity);
    fineSweep.lo.fill(Infinity); fineSweep.hi.fill(-Infinity);
    for (const v of part.vertices) {
      expand(fine,point.copy(v).applyMatrix4(part.pose));
      if (part.useSweep) expand(fineSweep,point.copy(v).applyMatrix4(part.previous));
    }
    for (let i=0;i<axes.length;i++) {
      fineSweep.lo[i]=Math.min(fineSweep.lo[i],fine.lo[i]);
      fineSweep.hi[i]=Math.max(fineSweep.hi[i],fine.hi[i]);
    }
    part.ready=true;
  }
  return solid===part.swept ? part.fineSweep : part.fine;
}

// Fit boxes once in each joint's local coordinates, including skin envelopes
// in the bind pose and the full morph range of the flexible fins.
function swimmerParts(swimmer) {
  const byJoint = new Map();
  function bounds(joint) {
    if (!byJoint.has(joint)) byJoint.set(joint, volume());
    return byJoint.get(joint);
  }
  swimmer.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    if (mesh.isSkinnedMesh) {
      const {position, skinWeight, skinIndex} = g.attributes;
      const matrices = mesh.skeleton.boneInverses.map(m => new Matrix4().multiplyMatrices(m, mesh.bindMatrix));
      for (let v = 0; v < position.count; v++) for (let k = 0; k < 4; k++) {
        if (!skinWeight.getComponent(v,k)) continue;
        const i = skinIndex.getComponent(v,k);
        expand(bounds(mesh.skeleton.bones[i]),point.fromBufferAttribute(position,v).applyMatrix4(matrices[i]));
      }
    } else {
      mesh.updateMatrix();
      const hull=bounds(mesh.parent), morph=g.morphAttributes.position;
      if (morph?.length) {
        g.computeBoundingBox();
        for (const x of [g.boundingBox.min.x,g.boundingBox.max.x])
          for (const y of [g.boundingBox.min.y,g.boundingBox.max.y])
            for (const z of [g.boundingBox.min.z,g.boundingBox.max.z]) expand(hull,point.set(x,y,z).applyMatrix4(mesh.matrix));
      } else {
        const positions=g.attributes.position;
        for (let i=0;i<positions.count;i++) expand(hull,point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrix));
      }
    }
  });
  return [...byJoint].map(([joint,b]) => movingPart(joint,b));
}

function toyParts(model) {
  const byCell = new Map();
  // Keep the central hole of the swim ring and the space between the toy diver's legs open.
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position, ix = mesh.geometry.index;
    const tri = [new Vector3(),new Vector3(),new Vector3()];
    for (let i=0; i<(ix?.count ?? p.count); i+=3) {
      for (let j=0;j<3;j++) tri[j].fromBufferAttribute(p,ix ? ix.getX(i+j) : i+j);
      const mid = point.copy(tri[0]).add(tri[1]).add(tri[2]).multiplyScalar(1/3);
      const cell = model.userData.toyKind === 'swimRing' ? Math.floor((Math.atan2(mid.z,mid.x)+Math.PI)*6/Math.PI)
        : Math.floor(mid.x/.19)+','+Math.floor(mid.y/.19)+','+Math.floor(mid.z/.19);
      if (!byCell.has(cell)) byCell.set(cell,volume());
      for (const corner of tri) expand(byCell.get(cell),corner);
    }
  });
  return [...byCell.values()].map(b => movingPart(model,b));
}

function updatePart(part, sweep) {
  const {node,center,half,current,swept} = part;
  part.previous.copy(part.pose); part.pose.copy(node.matrixWorld);
  part.useSweep=sweep && part.initialized; part.ready=false;
  point.copy(center).applyMatrix4(node.matrixWorld);
  const e = node.matrixWorld.elements;
  for (let i=0; i<axes.length; i++) {
    const n=axes[i], middle=n.dot(point);
    const radius = half.x*Math.abs(n.x*e[0]+n.y*e[1]+n.z*e[2]) + half.y*Math.abs(n.x*e[4]+n.y*e[5]+n.z*e[6])
      + half.z*Math.abs(n.x*e[8]+n.y*e[9]+n.z*e[10]);
    const lo=middle-radius, hi=middle+radius;
    swept.lo[i]=sweep && part.initialized ? Math.min(lo,current.lo[i]) : lo;
    swept.hi[i]=sweep && part.initialized ? Math.max(hi,current.hi[i]) : hi;
    current.lo[i]=lo; current.hi[i]=hi;
  }
  part.initialized = true;
}

function near(p,s,r) {
  return p.x >= s.lo[0]-r && p.x <= s.hi[0]+r && p.y >= s.lo[1]-r && p.y <= s.hi[1]+r &&
    p.z >= s.lo[2]-r && p.z <= s.hi[2]+r;
}

const faceNormal = new Vector3();
function surfaceDistance(x,y,z,solid,limit,normal) {
  let distance=-Infinity, axis=0, sign=1;
  for (let i=0;i<axes.length;i++) {
    const n=axes[i], d=n.x*x+n.y*y+n.z*z, low=solid.lo[i]-d, high=d-solid.hi[i];
    const gap=Math.max(low,high);
    if (gap>=limit) return gap;
    if (gap>distance) { distance=gap; axis=i; sign=high>low ? 1 : -1; }
  }
  normal?.copy(axes[axis]).multiplyScalar(sign);
  return distance;
}

function closest(p, solids, reach) {
  let nearest=reach, source, result;
  for (const broad of solids) {
    if (!near(p,broad,nearest)) continue;
    const distance=surfaceDistance(p.x,p.y,p.z,fitted(broad),nearest,faceNormal);
    if (distance<nearest) {
      nearest=distance; source=broad;
      result={x:faceNormal.x,y:faceNormal.y,z:faceNormal.z,distance};
    }
  }
  if (!source?.part || !reach) return result ?? null;

  // Beside moving limbs the closest face can change every frame. Sample the
  // distance to the whole assembly, so swimming past a seam between parts
  // gives a continuous escape direction.
  const h=.075;
  const local=solids.filter(s => near(p,s,nearest+2*h)).map(fitted);
  function sample(x,y,z) {
    let d=nearest+h;
    for (const s of local) d=Math.min(d,surfaceDistance(x,y,z,s,d));
    return d;
  }
  const dx=sample(p.x+h,p.y,p.z)-sample(p.x-h,p.y,p.z);
  const dy=sample(p.x,p.y+h,p.z)-sample(p.x,p.y-h,p.z);
  const dz=sample(p.x,p.y,p.z+h)-sample(p.x,p.y,p.z-h);
  const length=Math.max(h,Math.hypot(dx,dy,dz));
  return {x:dx/length,y:dy/length,z:dz/length,distance:nearest};
}

// The directional support of the tapered body excludes the empty corners
// of a wholesale box. In particular a tall angled dorsal fin cannot extend
// the head sideways into a rock. Values are relative to the resident origin.
const shapes = new WeakMap();
function residentShape(box, measureTank=true) {
  let shape = shapes.get(box);
  if (!shape) {
    shape={...volume(), basis:[new Vector3(),new Vector3(),new Vector3()],half:[],
      sections:box.outline.slices?.map(volume), min:new Vector3(), max:new Vector3()};
    shapes.set(box,shape);
  }
  if (box.axes.every((n,i)=>n.equals(shape.basis[i]) && box.half[i]===shape.half[i])) return shape;
  for (let j=0;j<3;j++) {shape.basis[j].copy(box.axes[j]);shape.half[j]=box.half[j];}
  if (measureTank) {
    const skin=skinBounds(box);
    shape.min.subVectors(skin.min,box.animal.position);
    shape.max.subVectors(skin.max,box.animal.position);
  }
  const {bounds,slices}=box.outline;
  const scales = box.half.map((h,i) => 2*h/(bounds[2*i+1]-bounds[2*i]));
  for (let i=0;i<axes.length;i++) {
    const n=axes[i];
    if (slices) {
      const u=n.dot(box.axes[0])*scales[0], v=n.dot(box.axes[1])*scales[1], w=n.dot(box.axes[2])*scales[2];
      let lo=Infinity, hi=-Infinity;
      for (let j=0; j<slices.length; j++) {
        const {center:c,half:h}=slices[j];
        const mid=u*c.x+v*c.y+w*c.z, r=Math.abs(u)*h.x+Math.abs(v)*h.y+Math.abs(w)*h.z;
        const section=shape.sections[j];
        section.lo[i]=mid-r; section.hi[i]=mid+r;
        lo=Math.min(lo,section.lo[i]); hi=Math.max(hi,section.hi[i]);
      }
      shape.lo[i]=lo; shape.hi[i]=hi;
    } else {
      const delta=n.dot(box.center)-n.dot(box.animal.position), r=boxRadiusOnAxis(box,n);
      shape.lo[i]=delta-r; shape.hi[i]=delta+r;
    }
  }
  return shape;
}

// Tank containment uses the scanned outline, including the taper of the tail
// and fins. The much larger empty corners of the broad-phase OBB can cross a
// pane even when there is room to move the fish a fraction of a millimetre.
function roomAt(box,shape) {
  const {min,max}=shape, p=box.animal.position;
  return {
    minX: Math.min(0, Math.max(-3.65-p.x, -3.98-p.x-min.x)), maxX: Math.max(0, Math.min(3.65-p.x, 3.98-p.x-max.x)),
    minZ: Math.min(0, Math.max(-1.65-p.z, -1.98-p.z-min.z)), maxZ: Math.max(0, Math.min(1.65-p.z, 1.98-p.z-max.z)),
    minY: box.benthic ? 0 : Math.min(0, substrateHeight(p.x,p.z)+.014-p.y-min.y),
    maxY: box.benthic ? 0 : Math.max(0,4.135-p.y-max.y),
  };
}

const projected = new Vector3();
function slideAtPane(n, sign, travel, room) {
  // Shortest vector reaching this plane with each component restricted by
  // the tank. When a plane normal points through glass its free components
  // can still slide the resident along the glass to the same side.
  let nx=n.x*sign, ny=n.y*sign, nz=n.z*sign;
  projected.set(0,0,0);
  for (let pass=0; pass<3; pass++) {
    const free=nx*nx+ny*ny+nz*nz;
    if (free<1e-8) return false;
    const d=travel/free, x=d*nx,y=d*ny,z=d*nz;
    let clipped=false;
    if (x<room.minX || x>room.maxX) {projected.x=x<0?room.minX:room.maxX;travel-=projected.x*nx;nx=0;clipped=true;}
    if (y<room.minY || y>room.maxY) {projected.y=y<0?room.minY:room.maxY;travel-=projected.y*ny;ny=0;clipped=true;}
    if (z<room.minZ || z>room.maxZ) {projected.z=z<0?room.minZ:room.maxZ;travel-=projected.z*nz;nz=0;clipped=true;}
    if (!clipped) {
      projected.x+=x; projected.y+=y; projected.z+=z;
      return true;
    }
  }
  return false;
}

function broad(box,solid) {
  const {min,max}=box.bounds, {lo,hi}=solid;
  return max.x>lo[0] && min.x<hi[0] && max.y>lo[1] && min.y<hi[1] && max.z>lo[2] && min.z<hi[2];
}

function penetrates(p,shape,solid) {
  for (let i=0;i<axes.length;i++) {
    const d=axes[i].dot(p);
    if (d+shape.hi[i]<=solid.lo[i] || d+shape.lo[i]>=solid.hi[i]) return false;
  }
  return true;
}

function touches(p,shape,solid) {
  return penetrates(p,shape,solid) && (!shape.sections || shape.sections.some(section=>penetrates(p,section,solid)));
}

// Shortest way out of one solid along the supporting-plane directions.
const way = new Vector3();
const horizontalLengths = axes.map(n => Math.hypot(n.x,n.z));
function depthIn(p,shape,solid,benthic) {
  let depth=Infinity, axis=0, sign=1;
  for (let i=0;i<axes.length;i++) {
    const d=axes[i].dot(p);
    const up=solid.hi[i]-d-shape.lo[i], down=d+shape.hi[i]-solid.lo[i];
    if (up<=0 || down<=0) return 0;
    // Grazers can only leave along the bed. A horizontal stone surface still
    // separates a shrimp below it, but cannot push an overlapping shrimp up.
    const available = benthic ? horizontalLengths[i] : 1;
    if (available === 0) continue;
    const distance = Math.min(up,down)/available;
    if (distance < depth) {depth=distance; axis=i; sign=up<=down ? 1 : -1;}
  }
  way.copy(axes[axis]).multiplyScalar(sign);
  if (benthic) { way.y=0; way.divideScalar(horizontalLengths[axis]); }
  return depth;
}

// Clip a crawl against the same supporting planes as physical contact. The
// expanded planes account for a shell's height and a shrimp's forward feelers.
function crawlHit(start, delta, shape, solid) {
  let enter = -Infinity, leave = 1, face = 0, sign = 0;
  for (let i = 0; i < axes.length; i++) {
    const n = axes[i], center = start.dot(n), travel = delta.dot(n);
    const lo = solid.lo[i] - shape.hi[i] - center;
    const hi = solid.hi[i] - shape.lo[i] - center;
    if (Math.abs(travel) < 1e-10) {
      if (lo >= 0 || hi <= 0) return null;
      continue;
    }
    const near = (travel > 0 ? lo : hi) / travel;
    if (near > enter) {
      enter = near; face = i; sign = travel > 0 ? -1 : 1;
    }
    leave = Math.min(leave, (travel > 0 ? hi : lo) / travel);
    if (leave <= Math.max(enter, 0)) return null;
  }
  if (shape === pointHull) return { fraction: Math.max(0,enter), x: 0, z: 0 };
  if (enter < 0) {
    // In an existing overlap, allow a course which slides out or alongside.
    // This also covers a new obstacle placed directly over the resident.
    depthIn(start,shape,solid,true);
    if (way.dot(delta) >= -1e-8) return null;
    return { fraction: 0, x: way.x, z: way.z };
  }
  const horizontal = horizontalLengths[face];
  if (horizontal > 0) return { fraction: enter, x: sign*axes[face].x/horizontal, z: sign*axes[face].z/horizontal };
  // The top of a shell can meet a horizontal overhang as the sand rises.
  const length = Math.hypot(delta.x, delta.z);
  return { fraction: enter, x: -delta.x/length, z: -delta.z/length };
}

function pushOut(box, shape, solid, room, maxDistance=Infinity) {
  const {lo,hi}=solid;
  let best=maxDistance*maxDistance, found=false;
  for (let i=0;i<axes.length;i++) {
    const n=axes[i], center=n.dot(box.animal.position);
    const mobility=box.benthic ? n.x*n.x+n.z*n.z : 1;
    if (mobility<.01) continue;
    for (const sign of [-1,1]) {
      const distance=(sign>0 ? hi[i]-center-shape.lo[i] : center+shape.hi[i]-lo[i])+.0001;
      if (distance*distance/mobility >= best || !slideAtPane(n,sign,distance,room)) continue;
      const cost=projected.lengthSq();
      if (cost<best) {best=cost;offset.copy(projected);found=true;}
    }
  }
  if (found) moveResidentBox(box,offset.x,offset.y,offset.z);
  return found;
}

// A new rock may be placed over a resident between several intersecting hulls.
// A nearest-face push can oscillate inside that seam. Intersect rays with the
// hulls expanded by the fish box, then leave their union at the nearest gap.
function clearSeam(box, solids, shape) {
  const middle=axes.map(n=>n.dot(box.animal.position));
  const overlaps=solids.some(s=>broad(box,s) && touches(box.animal.position,shape,fitted(s)));
  if (!overlaps) return;
  const room=roomAt(box,shape);
  let best=Infinity;
  const move=new Vector3(), direction=new Vector3();
  for (const axis of axes) for (const sign of [-1,1]) {
    if (box.benthic && axis.y) continue;
    direction.copy(axis).multiplyScalar(sign);
    const intervals=[];
    for (const coarse of solids) {
      const s=fitted(coarse);
      let enter=0, exit=best;
      for (let i=0;i<axes.length;i++) {
        const rate=direction.dot(axes[i]);
        const a=s.lo[i]-shape.hi[i]-middle[i], b=s.hi[i]-shape.lo[i]-middle[i];
        if (Math.abs(rate)<1e-8) {
          if (a>0 || b<0) {exit=-1; break;}
        } else {
          enter=Math.max(enter,(rate>0 ? a : b)/rate);
          exit=Math.min(exit,(rate>0 ? b : a)/rate);
          if (enter>exit) break;
        }
      }
      if (enter<=exit) intervals.push([enter,exit]);
    }
    intervals.sort((a,b)=>a[0]-b[0]);
    let t=0;
    for (const [enter,exit] of intervals) {
      if (enter>t+.0002) break;
      t=Math.max(t,exit);
    }
    t+=.0003;
    if (t>=best) continue;
    const x=t*direction.x, y=t*direction.y, z=t*direction.z;
    if (x<room.minX || x>room.maxX || z<room.minZ || z>room.maxZ || y<room.minY || y>room.maxY) continue;
    best=t; move.set(x,y,z);
  }
  if (Number.isFinite(best)) moveResidentBox(box,move.x,move.y,move.z);
}

// Project locally onto the contacting faces. In a tight pocket a large box
// can overstate the contact; retry against the fitted body sections there.
// Keep every trial in the same neighbourhood as the original swimming pose.
function localExit(box, shape, solids, radius, detailed=false) {
  const origin=new Vector3().copy(box.animal.position);
  const sections=detailed && shape.sections || [shape];
  const reach=radius+Math.hypot(...box.half);
  const neighbourhood=solids.filter(s => near(box.center,s,reach)).map(fitted);
  for (let pass=0;pass<6;pass++) {
    containInTank(box);
    if (origin.distanceToSquared(box.animal.position)>radius*radius) return false;
    let moved=false;
    for (const s of neighbourhood) for (const section of sections) {
      if (!broad(box,s) || !penetrates(box.animal.position,section,s)) continue;
      if (!pushOut(box,section,s,roomAt(box,shape),radius) ||
          origin.distanceToSquared(box.animal.position)>radius*radius) return false;
      moved=true;
    }
    if (!moved) return true;
  }
  return false;
}

export function createSceneCollisions(equipment = []) {
  let scenery, plants, fixed=[], solids=[], authors=[], all=[], instant=[], revision=0, blocked=new WeakMap();
  const cachedParts=new WeakMap();
  const accepted = new WeakMap();
  const neighbourhoods = new WeakMap();
  const grazerProbes = new Map();
  const crawlStart = new Vector3(), crawlDelta = new Vector3(), crawlBounds = { bounds: new Box3() };
  function partsFor(model) {
    let parts=cachedParts.get(model);
    if (!parts) {
      const swimmer=model.userData.author?.swimmer;
      parts=swimmer ? swimmerParts(swimmer) : toyParts(model);
      cachedParts.set(model,parts);
    }
    return parts;
  }
  // The exact same bind-pose, morph and joint bounds used to protect the
  // fish also enclose the moving toy. Only their matrices change per step.
  function measureToy(model,shape) {
    const body=model.userData.author?.swimmer ?? model;
    body.updateWorldMatrix(true,true);
    shape.lo.fill(Infinity); shape.hi.fill(-Infinity);
    for (const {node,center,half} of partsFor(model)) {
      point.copy(center).applyMatrix4(node.matrixWorld).sub(body.position);
      const e=node.matrixWorld.elements;
      for (let i=0;i<axes.length;i++) {
        const n=axes[i], c=n.dot(point);
        const r=half.x*Math.abs(n.x*e[0]+n.y*e[1]+n.z*e[2]) + half.y*Math.abs(n.x*e[4]+n.y*e[5]+n.z*e[6])
          + half.z*Math.abs(n.x*e[8]+n.y*e[9]+n.z*e[10]);
        shape.lo[i]=Math.min(shape.lo[i],c-r); shape.hi[i]=Math.max(shape.hi[i],c+r);
      }
    }
  }
  function measureResident(animal,seconds,hull) {
    const shape=residentShape(makeResidentBox(animal,seconds));
    for (let i=0;i<axes.length;i++) {
      const c=axes[i].dot(animal.position);
      hull.lo[i]=shape.lo[i]+c; hull.hi[i]=shape.hi[i]+c;
    }
  }
  const toyContacts=createToyContacts(axes,measureToy,measureResident);
  function arrangeToys(staticSolids,models,plantContacts,animals,seconds,waterLevel,flowSeconds) {
    toyContacts.place(models,equipment,staticSolids,plantContacts,animals,seconds,waterLevel,flowSeconds);
  }
  function update(staticSolids,models,sweep=true,plantContacts) {
    if (scenery !== staticSolids || plants !== plantContacts) {
      scenery = staticSolids;
      plants = plantContacts;
      fixed = [...equipment, ...scenery, ...(plants?.roots ?? [])];
      blocked = new WeakMap();
    }
    revision++;
    solids=[...fixed]; authors=[]; instant=[...fixed];
    for (const model of models) {
      const swimmer=model.userData.author?.swimmer;
      (swimmer ?? model).updateWorldMatrix(true,true);
      for (const part of partsFor(model)) {
        updatePart(part,sweep);
        (swimmer ? authors : solids).push(part.swept);
        instant.push(part.current);
      }
    }
    all=solids.concat(authors);
  }
  const routeProbes=new Map();
  const canPass=createFeedingSegments(axes, data=>{
    let probe=routeProbes.get(data.species);
    if (!probe) { probe={...data}; routeProbes.set(data.species,probe); }
    probe.size=data.size;
    return residentShape(makeResidentBox(probe),false);
  }, fitted);
  function canSwimSegment(animal,from,to,incoming) {
    return canPass(animal,from,to,incoming,instant,revision);
  }
  function avoid(animal) {
    return {
      obstacle:closest(animal.position,solids,.8),
      author:closest(animal.position,authors,1.35),
      foliage:plants ? closest(animal.position,plants.leaves,.2) : null,
    };
  }
  function grazerObstacle(animal, dirX, dirZ, reach) {
    if (!(reach > 0) || Math.hypot(dirX,dirZ) < 1e-8) return null;
    // Rotate a separate box to face the proposed path. Testing a turn must
    // never change the resident or its live collision box.
    let probe = grazerProbes.get(animal.species);
    if (!probe) {
      probe = { species: animal.species, alive: true, position: new Vector3(), velocity: new Vector3() };
      grazerProbes.set(animal.species, probe);
    }
    probe.size = animal.size;
    probe.velocity.set(dirX,0,dirZ);
    const body = makeResidentBox(probe), shape = residentShape(body);
    const { x, z } = animal.position;
    const {min,max} = body.bounds; // relative to the resident's foot
    let result = null;
    const note = (distance, nx, nz) => {
      if (distance <= reach && (!result || distance < result.distance)) result = { distance: Math.max(0,distance), x:nx, z:nz };
    };
    if (dirX > 0) note((Math.min(3.65,3.98-max.x)-x)/dirX,-1,0);
    if (dirX < 0) note((Math.max(-3.65,-3.98-min.x)-x)/dirX,1,0);
    if (dirZ > 0) note((Math.min(1.65,1.98-max.z)-z)/dirZ,0,-1);
    if (dirZ < 0) note((Math.max(-1.65,-1.98-min.z)-z)/dirZ,0,1);

    crawlStart.set(x,substrateHeight(x,z)+.025,z);
    // Piecewise chords follow the sand beneath a branch. Even a paper-thin
    // root between chord endpoints is tested continuously.
    const segments = Math.ceil(reach/.25), step = reach/segments;
    for (let i = 0; i < segments && step*i < (result?.distance ?? reach); i++) {
      const nextX = crawlStart.x+dirX*step, nextZ = crawlStart.z+dirZ*step;
      crawlDelta.set(dirX*step, substrateHeight(nextX,nextZ)+.025-crawlStart.y, dirZ*step);
      const bounds = crawlBounds.bounds;
      bounds.min.copy(min).add(crawlStart);
      bounds.max.copy(max).add(crawlStart);
      bounds.expandByPoint(point.copy(bounds.min).add(crawlDelta));
      bounds.expandByPoint(point.copy(max).add(crawlStart).add(crawlDelta));
      for (const coarse of instant) {
        if (!broad(crawlBounds,coarse)) continue;
        const hit = crawlHit(crawlStart,crawlDelta,shape,fitted(coarse));
        if (hit) note(step*(i+hit.fraction),hit.x,hit.z);
      }
      crawlStart.add(crawlDelta);
    }
    return result;
  }
  function clearFoodPath(from, pellet) {
    crawlStart.copy(from);
    crawlDelta.subVectors(pellet, crawlStart);
    crawlBounds.bounds.set(crawlStart, crawlStart).expandByPoint(pellet);
    return !instant.some(solid => broad(crawlBounds,solid) &&
      crawlHit(crawlStart,crawlDelta,pointHull,fitted(solid)));
  }
  function canGrazeFrom(animal, pellet) {
    // A thin root can separate a grain from a grazer within biting distance.
    return clearFoodPath(animal.position, pellet);
  }
  function canDropFood(pellet) {
    return clearFoodPath({x:pellet.x, y:4, z:pellet.z}, pellet);
  }
  function blocksFood(p) {
    // Moving pellets can be checked by several hungry residents in the same tick.
    const old=blocked.get(p);
    if (old && old.x===p.x && old.y===p.y && old.z===p.z) return old.blocked;
    const inaccessible=!!closest(p,fixed,0);
    blocked.set(p,{x:p.x,y:p.y,z:p.z,blocked:inaccessible});
    return inaccessible;
  }
  function overlaps(box) {
    let shape;
    for (const s of all) {
      if (!broad(box,s)) continue;
      shape ??= residentShape(box);
      if (touches(box.animal.position,shape,fitted(s))) return true;
    }
    return false;
  }
  function contacts(box, visit) {
    // The movement solver tries several nearby positions and turns in one
    // tick. Reuse the same nearby scenery until the body leaves that region
    // or a new pose of the swimmer and floating toys has been prepared.
    let nearby = neighbourhoods.get(box);
    if (!nearby) {
      nearby = { bounds: new Box3(), parts: [], revision: -1 };
      neighbourhoods.set(box, nearby);
    }
    if (nearby.revision !== revision || !nearby.bounds.containsBox(box.bounds)) {
      nearby.bounds.copy(box.bounds).expandByScalar(.12);
      nearby.parts.length = 0;
      for (const solid of instant) if (broad(nearby, solid)) nearby.parts.push(solid);
      nearby.revision = revision;
    }
    let shape;
    for (const coarse of nearby.parts) {
      if (!broad(box,coarse)) continue;
      shape ??= residentShape(box);
      const solid=fitted(coarse), p=box.animal.position;
      if (!penetrates(p,shape,solid)) continue;
      let deepest=0, x=0, y=0, z=0;
      for (const section of shape.sections ?? [shape]) {
        const depth=depthIn(p,section,solid,box.benthic);
        if (depth>deepest) {deepest=depth; x=way.x; y=way.y; z=way.z;}
      }
      if (deepest>0) visit(coarse,deepest,x,y,z);
    }
  }
  function resolve(box) {
    let moved=false;
    let shape;
    for (const coarse of all) {
      if (!broad(box,coarse)) continue;
      const solid=fitted(coarse);
      shape ??= residentShape(box);
      if (touches(box.animal.position,shape,solid)) {
        pushOut(box,shape,solid,roomAt(box,shape));
        moved=true;
      }
    }
    if (moved) clearSeam(box,all,shape);
    return moved;
  }
  const start=new Vector3(), desired=new Vector3(), fallback=new Vector3(), trial=new Vector3();
  const pivots=[[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];

  function recoverMotion(box, previous, radius, turn) {
    const a=box.animal, p=a.position, v=a.velocity;
    fallback.copy(p);
    function setPose(position, velocity) {
      p.x=position.x; p.y=position.y; p.z=position.z;
      v.x=velocity.x; v.y=velocity.y; v.z=velocity.z;
      makeResidentBox(a);
    }
    function fit(fraction, contacts=all, detailed=true, yaw=0, pitch=0) {
      const speed=desired.length();
      trial.copy(previous.heading).setLength(speed).lerp(desired,fraction).setLength(speed);
      if (yaw || pitch) {
        const heading=previous.anchorHeading;
        const theta=Math.atan2(heading.z,heading.x)+yaw;
        const phi=Math.max(-.85,Math.min(.85,Math.atan2(heading.y,Math.hypot(heading.x,heading.z))+pitch));
        trial.set(Math.cos(theta)*Math.cos(phi),Math.sin(phi),Math.sin(theta)*Math.cos(phi)).multiplyScalar(speed);
      }
      setPose(point.lerpVectors(previous.position,start,fraction),trial);
      return localExit(box,residentShape(box),contacts,radius,detailed);
    }
    function pivot(contacts,angle) {
      // A few degrees of fin clearance can open a pocket even if continuing
      // the intended turn or keeping the previous attitude would both jam.
      for (const [yaw,pitch] of pivots) {
        if (box.benthic && pitch) continue;
        const step=angle/Math.hypot(yaw,pitch);
        if (fit(0,contacts,true,yaw*step,pitch*step)) return true;
      }
      return false;
    }
    if (fit(1,all,false) || fit(1)) return;
    if (fit(0)) {
      // Follow the connected part of the commanded turn without snapping
      // across the rock to fit its final attitude.
      let low=0, high=1;
      for (let i=0;i<5;i++) {
        const mid=(low+high)/2;
        if (fit(mid)) low=mid; else high=mid;
      }
      // Holding the previous pose outright would repeat the same blocked
      // turn on every step and freeze the resident in place.
      if (low>0) { fit(low); return; }
    }
    if (turn>0 && pivot(all,turn)) return;
    // If a moving joint's swept path fills a pocket, keep the current limb
    // and all other solid surfaces intact while stepping toward the exit.
    trial.subVectors(fallback,previous.anchor).clampLength(0,radius).add(previous.anchor);
    setPose(trial,desired);
    if (localExit(box,residentShape(box),instant,radius,true) || fit(0,instant) || (turn>0 && pivot(instant,turn))) return;
    setPose(fallback,desired);
  }
  function constrain(box,dt=1/60) {
    const a=box.animal, pos=a.position, v=a.velocity;
    let previous=accepted.get(a);
    // Other residents may still be settling. An unchanged pose already tested
    // against this exact set of animated hulls needs no additional work.
    if (previous?.revision===revision && previous.position.equals(pos) && previous.velocity.equals(v) &&
        previous.size===a.size && previous.alive===a.alive && previous.up.equals(box.axes[1])) return false;
    start.copy(pos); desired.copy(v);
    if (previous && previous.revision!==revision) {
      previous.anchor.copy(previous.position);
      previous.anchorHeading.copy(previous.heading);
    }
    const moved=resolve(box);
    if (moved && previous && a.alive && previous.shape===scenery && previous.plants===plants) {
      const travel=previous.position.distanceTo(start);
      const sweep=trial.copy(v).normalize().distanceTo(previous.heading)*box.half[0];
      const radius=Math.max(.008,Math.min(.055,.003+travel+sweep));
      if (start.distanceTo(pos)>radius && travel<.35) recoverMotion(box,previous,radius,animalTurnRate(a.species)*dt);
    }
    if (!previous) {
      previous={position:new Vector3(),heading:new Vector3(),velocity:new Vector3(),up:new Vector3(),anchor:new Vector3().copy(pos),anchorHeading:new Vector3().copy(v).normalize()};
      accepted.set(a,previous);
    }
    previous.position.copy(pos); previous.heading.copy(v).normalize(); previous.velocity.copy(v);
    previous.up.copy(box.axes[1]); previous.size=a.size; previous.alive=a.alive;
    previous.revision=revision; previous.shape=scenery; previous.plants=plants;
    return moved && (start.distanceToSquared(pos)>1e-14 || desired.distanceToSquared(v)>1e-14);
  }
  return {update,get revision(){return revision;},canSwimSegment,arrangeToys,captureToyPose:toyContacts.capture,avoid,grazerObstacle,canGrazeFrom,canDropFood,blocksFood,overlaps,constrain,contacts};
}
