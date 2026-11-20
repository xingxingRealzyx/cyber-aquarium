import { Vector3 } from 'three';
import { SPECIES, substrateHeight } from './simulation.js';

const cell=.75, key=(x,y,z)=>x+12+32*(y+2+16*(z+8));
const index=v=>Math.floor(v/cell);
const dot=(n,x,y,z)=>n.x*x+n.y*y+n.z*z;

function crosses(axes,x,y,z,dx,dy,dz,body,solid,pad,padY) {
  let enter=0, leave=1;
  for (let i=0;i<axes.length;i++) {
    const n=axes[i], p=dot(n,x,y,z), d=dot(n,dx,dy,dz);
    const margin=Math.min(pad,(Math.abs(n.x)+Math.abs(n.z))*pad+Math.abs(n.y)*padY);
    const lo=solid.lo[i]-body.hi[i]-margin-p, hi=solid.hi[i]-body.lo[i]+margin-p;
    if (Math.abs(d)<1e-10) {
      if (lo>=0 || hi<=0) return false;
    } else {
      enter=Math.max(enter,(d>0?lo:hi)/d);
      leave=Math.min(leave,(d>0?hi:lo)/d);
      if (leave<=enter) return false;
    }
  }
  return true;
}

// Route probes share the same posed body hulls and animated scenery as live
// contacts. Index lazily: low-speed steering never needs the route grid.
export function createFeedingSegments(axes, bodyShape, fit) {
  let stamp=-1, cells=new Map(), profiles=new Map();
  const probe={alive:true,position:new Vector3(),velocity:new Vector3()};
  const nearby=[], found=new Set();
  function select(solids, revision, from, to, radius) {
    if (stamp!==revision) {
      cells=new Map(); stamp=revision;
      for (const s of solids) {
        for (let x=index(s.lo[0]);x<=index(s.hi[0]);x++)
          for (let y=index(s.lo[1]);y<=index(s.hi[1]);y++)
            for (let z=index(s.lo[2]);z<=index(s.hi[2]);z++) {
              const k=key(x,y,z), list=cells.get(k);
              if (list) list.push(s); else cells.set(k,[s]);
            }
      }
    }
    nearby.length=0; found.clear();
    for (let x=index(Math.min(from.x,to.x)-radius);x<=index(Math.max(from.x,to.x)+radius);x++)
      for (let y=index(Math.min(from.y,to.y)-radius);y<=index(Math.max(from.y,to.y)+radius);y++)
        for (let z=index(Math.min(from.z,to.z)-radius);z<=index(Math.max(from.z,to.z)+radius);z++) {
          const list=cells.get(key(x,y,z));
          if (list) for (const s of list) if (!found.has(s)) { found.add(s); nearby.push(s); }
        }
  }
  function profile(a,yaw,pitch) {
    const size=a.size ?? 1;
    const k=a.species+':'+size+':'+Math.round(yaw*1e5)+':'+Math.round(pitch*1e5);
    let shape=profiles.get(k);
    if (shape) return shape;
    if (profiles.size>=4096) profiles.clear();
    probe.species=a.species; probe.size=size;
    probe.velocity.set(Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch),Math.sin(yaw)*Math.cos(pitch));
    // A resident's collision outline is bound to its species on creation.
    const h=bodyShape(probe);
    shape={lo:h.lo.slice(), hi:h.hi.slice(), sections:h.sections?.map(s=>({lo:s.lo.slice(),hi:s.hi.slice()})), radius:Math.hypot(...[0,1,2].map(i=>Math.max(-h.lo[i],h.hi[i])))};
    profiles.set(k,shape);
    return shape;
  }
  function clear(x,y,z,dx,dy,dz,shape,pad,benthic,padY=pad,top=4.135,bedGap=.007) {
    if (Math.min(x,x+dx)+shape.lo[0]-pad < -3.98 || Math.max(x,x+dx)+shape.hi[0]+pad > 3.98 ||
        Math.min(z,z+dz)+shape.lo[2]-pad < -1.98 || Math.max(z,z+dz)+shape.hi[2]+pad > 1.98) return false;
    if (!benthic && (Math.max(y,y+dy)+shape.hi[1]+padY>top ||
        y+shape.lo[1]-padY<substrateHeight(x,z)+bedGap-1e-9 ||
        y+dy+shape.lo[1]-padY<substrateHeight(x+dx,z+dz)+bedGap-1e-9)) return false;
    for (const broad of nearby) {
      if (Math.max(x,x+dx)+shape.hi[0]+pad<=broad.lo[0] || Math.min(x,x+dx)+shape.lo[0]-pad>=broad.hi[0] ||
          Math.max(y,y+dy)+shape.hi[1]+pad<=broad.lo[1] || Math.min(y,y+dy)+shape.lo[1]-pad>=broad.hi[1] ||
          Math.max(z,z+dz)+shape.hi[2]+pad<=broad.lo[2] || Math.min(z,z+dz)+shape.lo[2]-pad>=broad.hi[2]) continue;
      const solid=fit(broad);
      if (crosses(axes,x,y,z,dx,dy,dz,shape,solid,pad,padY) &&
          (!shape.sections || shape.sections.some(s=>crosses(axes,x,y,z,dx,dy,dz,s,solid,pad,padY)))) return false;
    }
    return true;
  }
  return function canPass(a,from,to,incoming,solids,revision,scull=false) {
    const benthic=SPECIES[a.species].type==='invertebrate';
    const dx=to.x-from.x, dy=to.y-from.y, dz=to.z-from.z, flat=Math.hypot(dx,dz);
    const velocity=incoming ?? a.velocity ?? {x:1,y:0,z:0};
    const yaw0=Math.atan2(velocity.z,velocity.x), pitch0=benthic?0:Math.max(-.85,Math.min(.85,Math.atan2(velocity.y,Math.hypot(velocity.x,velocity.z))));
    if (scull) {
      if (benthic || flat>1e-8 || !dy) return false;
      // Scull beneath the surface with the current body attitude. A grown
      // fin or a legacy pose above the waterline can only move back inside.
      const shape=profile(a,yaw0,pitch0);
      select(solids,revision,from,to,shape.radius+.015);
      const bedGap=dy>0 ? Math.min(.007,from.y+shape.lo[1]-substrateHeight(from.x,from.z)) : .007;
      return clear(from.x,from.y,from.z,0,dy,0,shape,0,false,0,Math.max(4.135,from.y+shape.hi[1]),bedGap);
    }
    const yaw=flat>1e-8?Math.atan2(dz,dx):yaw0;
    const pitch=benthic?0:Math.max(-.85,Math.min(.85,Math.atan2(dy,flat)));
    const shape=profile(a,yaw,pitch);
    select(solids,revision,from,to,shape.radius*1.1+.015);
    const arc=Math.atan2(Math.sin(yaw-yaw0),Math.cos(yaw-yaw0)), tilt=pitch-pitch0;
    const angle=Math.abs(arc)+Math.abs(tilt);
    const r=shape.radius;
    const nearTurn=Math.abs(from.x)+r>3.98 || Math.abs(from.z)+r>1.98 ||
      (!benthic && (from.y+r>4.135 || from.y-r<substrateHeight(from.x,from.z)+.007)) ||
      nearby.some(s=>from.x>s.lo[0]-r && from.x<s.hi[0]+r && from.y>s.lo[1]-r && from.y<s.hi[1]+r &&
        from.z>s.lo[2]-r && from.z<s.hi[2]+r);
    if (nearTurn && angle>.001 && Math.hypot(velocity.x,velocity.y,velocity.z)>.001) {
      const count=Math.ceil(angle/.35);
      for (let i=0;i<count;i++) {
        const t=(i+.5)/count, h=profile(a,yaw0+arc*t,pitch0+tilt*t);
        // Every surface point between these sampled attitudes stays inside
        // a sphere of this radius around its pose at the interval midpoint.
        const pad=h.radius*angle/(2*count);
        if (!clear(from.x,from.y,from.z,0,0,0,h,pad,benthic,h.radius*Math.abs(tilt)/(2*count))) return false;
      }
    }
    if (!benthic) {
      if (!clear(from.x,from.y,from.z,dx,dy,dz,shape,0,false)) return false;
      const pieces=Math.ceil(flat/.20);
      for (let i=1;i<pieces;i++) {
        const t=i/pieces;
        if (from.y+dy*t+shape.lo[1]<substrateHeight(from.x+dx*t,from.z+dz*t)+.007) return false;
      }
      return true;
    }
    let x=from.x, y=from.y, z=from.z;
    const pieces=Math.max(1,Math.ceil(flat/.20));
    for (let i=1;i<=pieces;i++) {
      const t=i/pieces, nx=from.x+dx*t, nz=from.z+dz*t;
      const ny=substrateHeight(nx,nz)+.025;
      // Allow for the shallow curvature of the sand between chord endpoints.
      if (!clear(x,y,z,nx-x,ny-y,nz-z,shape,.0015,true)) return false;
      x=nx; y=ny; z=nz;
    }
    return true;
  };
}
