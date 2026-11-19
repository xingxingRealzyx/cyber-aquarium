import { Box3, Matrix4, Vector3 } from 'three';
import { boxRadiusOnAxis, moveResidentBox } from './resident-collisions.js';
import { substrateHeight } from './simulation.js';

// Supporting planes in 13 directions enclose the actual scanned surfaces.
// The first three pairs also provide a cheap AABB broad phase.
const axes = [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,-1,0],[1,0,1],[1,0,-1],
  [0,1,1],[0,1,-1],[1,1,1],[-1,1,1],[1,-1,1],[1,1,-1]].map(v => new Vector3(...v).normalize());
const point = new Vector3(), offset = new Vector3();
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

function movingPart(node, bounds) {
  return { node, center: bounds.getCenter(new Vector3()), half: bounds.getSize(new Vector3()).multiplyScalar(.5),
    current: volume(), swept: volume(), initialized: false };
}

// Fit boxes once in each joint's local coordinates, including skin envelopes
// in the bind pose and the full morph range of the flexible fins.
function swimmerParts(swimmer) {
  const byJoint = new Map();
  function bounds(joint) {
    if (!byJoint.has(joint)) byJoint.set(joint, new Box3());
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
        bounds(mesh.skeleton.bones[i]).expandByPoint(point.fromBufferAttribute(position,v).applyMatrix4(matrices[i]));
      }
    } else {
      g.computeBoundingBox();
      mesh.updateMatrix();
      bounds(mesh.parent).union(g.boundingBox.clone().applyMatrix4(mesh.matrix));
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
      if (!byCell.has(cell)) byCell.set(cell,new Box3());
      for (const corner of tri) byCell.get(cell).expandByPoint(corner);
    }
  });
  return [...byCell.values()].map(b => movingPart(model,b));
}

function updatePart(part, sweep) {
  const {node,center,half,current,swept} = part;
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

function closest(p, solids, reach) {
  let nearest = reach, result;
  for (const s of solids) {
    if (!near(p,s,reach)) continue;
    let distance = -Infinity, side = 1, axis = axes[0];
    for (let i=0;i<axes.length;i++) {
      const d=axes[i].dot(p), low=s.lo[i]-d, high=d-s.hi[i];
      const gap=Math.max(low,high);
      if (gap>distance) {distance=gap; axis=axes[i]; side=high>low ? 1 : -1;}
      if (distance >= nearest) break;
    }
    if (distance < nearest) {
      nearest = distance;
      result = {x:side*axis.x, y:side*axis.y, z:side*axis.z, distance};
    }
  }
  return result ?? null;
}

function correction(box,solid) {
  const {min,max}=box.bounds, {lo,hi}=solid;
  if (max.x<=lo[0] || min.x>=hi[0] || max.y<=lo[1] || min.y>=hi[1] || max.z<=lo[2] || min.z>=hi[2]) return false;
  let best=Infinity;
  for (let i=0;i<axes.length;i++) {
    const n=axes[i], center=n.dot(box.center), radius=boxRadiusOnAxis(box,n);
    const low=center+radius-lo[i], high=hi[i]-center+radius;
    if (low<=0 || high<=0) return false;
    const mobility=box.benthic ? n.x*n.x+n.z*n.z : 1;
    if (mobility<.01) continue;
    for (const sign of [-1,1]) {
      const travel=(sign>0 ? high : low)+.0001;
      if (travel*travel/mobility >= best) continue;
      const d=sign*travel/mobility, x=d*n.x, y=box.benthic ? 0 : d*n.y, z=d*n.z;
      if (Math.abs(box.animal.position.x+x)>3.65 || Math.abs(box.animal.position.z+z)>1.65 ||
          (x<0 && min.x+x< -3.98) || (x>0 && max.x+x>3.98) || (z<0 && min.z+z< -1.98) ||
          (z>0 && max.z+z>1.98) || (y>0 && max.y+y>4.13) ||
          (y<0 && min.y+y<substrateHeight(box.center.x+x,box.center.z+z)+.025)) continue;
      best=travel*travel/mobility;
      offset.set(x,y,z);
    }
  }
  // A trapped box still needs the union solver below.
  if (Number.isFinite(best)) moveResidentBox(box,offset.x,offset.y,offset.z);
  return true;
}

// A new rock may be placed over a resident between several intersecting hulls.
// A nearest-face push can oscillate inside that seam. Intersect rays with the
// hulls expanded by the fish box, then leave their union at the nearest gap.
function clearSeam(box, solids) {
  const middle=axes.map(n=>n.dot(box.center));
  const radii=axes.map(n=>boxRadiusOnAxis(box,n));
  const overlaps=solids.some(s=>axes.every((_,i)=>middle[i]+radii[i]>s.lo[i] && middle[i]-radii[i]<s.hi[i]));
  if (!overlaps) return;
  const {min,max}=box.bounds, p=box.animal.position;
  let best=Infinity;
  const move=new Vector3(), direction=new Vector3();
  for (const axis of axes) for (const sign of [-1,1]) {
    if (box.benthic && axis.y) continue;
    direction.copy(axis).multiplyScalar(sign);
    const intervals=[];
    for (const s of solids) {
      let enter=0, exit=best;
      for (let i=0;i<axes.length;i++) {
        const rate=direction.dot(axes[i]);
        const a=s.lo[i]-radii[i]-middle[i], b=s.hi[i]+radii[i]-middle[i];
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
    if (Math.abs(p.x+x)>3.65 || Math.abs(p.z+z)>1.65 ||
        min.x+x< -3.98 || max.x+x>3.98 || min.z+z< -1.98 || max.z+z>1.98 ||
        max.y+y>4.135 || (!box.benthic && min.y+y<substrateHeight(p.x+x,p.z+z)+.015)) continue;
    best=t; move.set(x,y,z);
  }
  if (Number.isFinite(best)) moveResidentBox(box,move.x,move.y,move.z);
}

export function createSceneCollisions(equipment = []) {
  let scenery, plants, fixed=[], solids=[], authors=[], blocked=new WeakMap();
  const cachedParts=new WeakMap();
  function update(staticSolids,models,sweep=true,plantContacts) {
    if (scenery !== staticSolids || plants !== plantContacts) {
      scenery = staticSolids;
      plants = plantContacts;
      fixed = [...equipment, ...scenery, ...(plants?.roots ?? [])];
      blocked = new WeakMap();
    }
    solids=[...fixed]; authors=[];
    for (const model of models) {
      const swimmer=model.userData.author?.swimmer;
      let parts=cachedParts.get(model);
      if (!parts) {
        parts=swimmer ? swimmerParts(swimmer) : toyParts(model);
        cachedParts.set(model,parts);
      }
      (swimmer ?? model).updateWorldMatrix(true,true);
      for (const part of parts) {
        updatePart(part,sweep);
        (swimmer ? authors : solids).push(part.swept);
      }
    }
  }
  function avoid(animal) {
    return {
      obstacle:closest(animal.position,solids,.8),
      author:closest(animal.position,authors,1.35),
      foliage:plants ? closest(animal.position,plants.leaves,.2) : null,
    };
  }
  function blocksFood(p) {
    // Moving pellets can be checked by several hungry residents in the same tick.
    const old=blocked.get(p);
    if (old && old.x===p.x && old.y===p.y && old.z===p.z) return old.blocked;
    const inaccessible=!!closest(p,fixed,0);
    blocked.set(p,{x:p.x,y:p.y,z:p.z,blocked:inaccessible});
    return inaccessible;
  }
  function constrain(box) {
    let moved=false;
    for (const set of [solids,authors]) for (const solid of set) {
      if (correction(box,solid)) moved=true;
    }
    if (moved) clearSeam(box,solids.concat(authors));
    return moved;
  }
  return {update,avoid,blocksFood,constrain};
}
