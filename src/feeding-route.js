import { SPECIES, substrateHeight } from './simulation.js';
import { createSceneCollisions } from './scene-collisions.js';

const ground=(x,z)=>substrateHeight(x,z)+.025;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const heading=(a,b)=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const horizontal=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
const freeWater=[...horizontal,[0,1,0],[0,-1,0],[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]];
const routes=new WeakMap();
let emptyScene;

function approach(a,from,food,velocity,benthic,scene) {
  const d=distance(from,food);
  if (d<=.28 && (!scene.canGrazeFrom || scene.canGrazeFrom({position:from},food))) return [];
  const flat=Math.hypot(from.x-food.x,from.z-food.z);
  const dx=flat>1e-8?(from.x-food.x)/flat:1, dz=flat>1e-8?(from.z-food.z)/flat:0;
  const sites=[];
  if (benthic) {
    for (const [ux,uz] of [[dx,dz],[-dz,dx],[dz,-dx],[-dx,-dz]]) {
      const x=food.x+.22*ux, z=food.z+.22*uz;
      sites.push({x,y:ground(x,z),z});
    }
  } else {
    sites.push({x:food.x+(from.x-food.x)*.22/d, y:food.y+(from.y-food.y)*.22/d, z:food.z+(from.z-food.z)*.22/d});
    // At the bed a wide fish can take the pellet just below its nose.
    for (const h of [.24,.16]) sites.push({x:food.x+.10*dx,y:food.y+h,z:food.z+.10*dz});
    sites.push({x:food.x,y:food.y-.24,z:food.z});
  }
  for (const to of sites) {
    if (distance(to,food)>.28 || (scene.canGrazeFrom && !scene.canGrazeFrom({position:to},food))) continue;
    if (scene.canSwimSegment(a,from,to,velocity)) return [to];
  }
  return null;
}

function floorPath(from,nodes) {
  const points=[];
  for (const to of nodes) {
    const count=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.20));
    for (let i=1;i<count;i++) {
      const t=i/count,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;
      points.push({x,y:ground(x,z),z});
    }
    points.push(to);
    from=to;
  }
  return points;
}

function plan(a,food,benthic,scene,maxNodes) {
  const start=a.position, delta=benthic ? .30 : .40;
  const startNode={point:start, ix:0,iy:0,iz:0, cost:0,score:distance(start,food), velocity:a.velocity, parent:null};
  const open=[startNode], visited=new Map([['0,0,0',0]]);
  for (let n=0;n<maxNodes && open.length;n++) {
    let best=0;
    for (let i=1;i<open.length;i++) if(open[i].score<open[best].score) best=i;
    const here=open[best]; open[best]=open.at(-1); open.pop();
    const remaining=distance(here.point,food);
    if (here.parent && (remaining<delta*2.5 || n%5===0)) {
      const end=approach(a,here.point,food,here.velocity,benthic,scene);
      if (end) {
        const path=[];
        for (let node=here;node.parent;node=node.parent) path.push(node.point);
        return path.reverse().concat(end);
      }
    }
    for (const [dx,dy,dz] of benthic?horizontal:freeWater) {
      const ix=here.ix+dx, iy=here.iy+dy, iz=here.iz+dz, key=ix+','+iy+','+iz;
      const cost=here.cost+Math.hypot(dx,dy,dz)*delta;
      if ((visited.get(key)??Infinity)<=cost+.00001) continue;
      const x=start.x+delta*ix,z=start.z+delta*iz, y=benthic?ground(x,z):start.y+delta*iy;
      if (Math.abs(x)>3.9 || Math.abs(z)>1.9 || y<.12 || y>4.12) continue;
      const p={x,y,z};
      if (!scene.canSwimSegment(a,here.point,p,here.velocity)) continue;
      visited.set(key,cost);
      open.push({point:p,ix,iy,iz,cost,score:cost+1.38*distance(p,food),velocity:heading(here.point,p),parent:here});
    }
  }
  return null;
}

// The route excludes the start. [] is a real mouth contact; null is a failed
// or exhausted search. A benthic route follows the height of the substrate
// even when the straight line between its ends would pass below a sand bank.
export function feedingRoute(scene,animal,pellet,{detour=true,maxNodes=80}={}) {
  if (!animal?.position || !SPECIES[animal.species] || !pellet) return null;
  const benthic=SPECIES[animal.species].type==='invertebrate';
  if (![pellet.x,pellet.y,pellet.z].every(Number.isFinite) || Math.abs(pellet.x)>3.98 ||
      Math.abs(pellet.z)>1.98 || pellet.y>4.14 || pellet.y<substrateHeight(pellet.x,pellet.z)-.005 ||
      (benthic && pellet.y>ground(pellet.x,pellet.z)+.155) || scene?.blocksFood?.(pellet)) return null;
  emptyScene??=createSceneCollisions();
  // A headless simulation without scenery still checks glass and substrate.
  const geometry=scene?.canSwimSegment?scene:emptyScene;
  const checks=scene && geometry!==scene ? {
    canGrazeFrom:scene.canGrazeFrom,
    canSwimSegment(a,from,to,v) {
      if (!geometry.canSwimSegment(a,from,to,v) || scene.canGrazeFrom?.({position:from},to)===false) return false;
      const dx=to.x-from.x, dz=to.z-from.z, span=Math.hypot(dx,dz);
      return !benthic || !span || !scene.grazerObstacle?.({...a,position:from},dx/span,dz/span,span);
    },
  }:geometry;
  let cache=routes.get(animal);
  if (!cache || cache.scene!==scene || cache.revision!==scene?.revision) {
    cache={scene,revision:scene?.revision,paths:new Map()};routes.set(animal,cache);
  }
  const {position:p,velocity:v}=animal;
  const key=[p.x,p.y,p.z,v?.x,v?.y,v?.z,animal.size,pellet.x,pellet.y,pellet.z,detour?maxNodes:0].join(',');
  if (cache.paths.has(key)) return cache.paths.get(key)?.map(point=>({...point}))??null;
  let nodes=approach(animal,p,pellet,v,benthic,checks);
  if (!nodes && !benthic && p.y>3.35) {
    // A fish beside the surface can lack the room to pitch its tail upward
    // for a diving turn. Fin down while level with the previous stroke,
    // then start turning only where the entire second leg is feasible.
    const below={x:p.x,y:Math.max(2.9,p.y-.55*(animal.size??1)),z:p.z};
    if (checks.canSwimSegment(animal,p,below,v,true)) {
      const reentry=approach(animal,below,pellet,v,false,checks);
      if (reentry) nodes=[{...below,descend:true},...reentry];
    }
  }
  if (!nodes && detour) nodes=plan(animal,pellet,benthic,checks,Math.max(0,Math.min(240,maxNodes)));
  if (nodes && benthic) nodes=floorPath(p,nodes);
  if (cache.paths.size>=64) cache.paths.clear();
  cache.paths.set(key,nodes);
  return nodes?.map(point=>({...point}))??null;
}
