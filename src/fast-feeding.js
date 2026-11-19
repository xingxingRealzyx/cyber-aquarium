import { animalTurnRate, fallingPosition, pelletFallSpeed, sinkFood } from './behavior.js';
import { feedingRoute } from './feeding-route.js';
import { consumePellet, isSettledPellet, SPECIES, substrateHeight } from './simulation.js';

const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const plans = new WeakMap();
const missed = new WeakMap();
const routeBudgets = new WeakMap();
const epsilon = 1e-7;

function feedingSpeed(a, fish) {
  const rate = fish ? (.62 + a.hunger*.014)*(1-.5*(a.infection?.severity ?? 0)) : a.species==='shrimp' ? .22 : .075;
  return rate*(.35+.65*a.health/100)*(.9+.1*a.metabolism);
}

function approachPoint(a, p, fish, speed) {
  const floor=substrateHeight(p.x,p.z);
  if (fish) {
    const lower=Math.max(.72,floor+.24);
    if (p.y<lower) return null;
    // Lead a falling grain without chasing it below swimming depth.
    const time=Math.max(0,distance(a.position,p)-.20)/speed;
    const aim=fallingPosition(p,time);
    if (aim.y+.24<lower) return null;
    return {...aim,y:Math.max(lower,aim.y)};
  }
  if (p.y<=floor+.18) return p;
  if (!p.fastSinking || Math.hypot(p.x-a.position.x,p.z-a.position.z)>1.2) return null;
  return {x:p.x,y:floor+.04,z:p.z};
}

function inReach(a,p,fish,scene) {
  return distance(a.position,p)<=.29999 && (fish ? p.y>=Math.max(.72,substrateHeight(p.x,p.z)+.24) : p.y<=substrateHeight(p.x,p.z)+.18) &&
    scene?.canGrazeFrom?.(a,p)!==false && !scene?.blocksFood?.(p);
}

function findPlan(state,a,fish,speed,scene,available,reserved,search,grazeable) {
  const now=state.behaviorSeconds, old=plans.get(a);
  const revision=scene?.revision;
  if (old && old.scene===scene && old.revision===revision && Math.abs(old.size-a.size)<.035 &&
      distance(a.position,old.position)<.01) {
    if (old.food && available.has(old.food) && !reserved.has(old.food) && now<old.expires &&
        (!fish || old.food.y>=Math.max(.72,substrateHeight(old.food.x,old.food.z)+.24))) return old;
    if (!old.food && old.grazeable===grazeable && old.count===available.size && old.first===state.foodPellets[0] &&
        old.last===state.foodPellets.at(-1) && now<old.expires) return null;
  }
  const candidates=[];
  for (const p of available) {
    if (reserved.has(p) || p.mass<=1e-10) continue;
    const aim=approachPoint(a,p,fish,speed);
    if (aim) candidates.push({p,aim,d:distance(a.position,aim)});
  }
  candidates.sort((a,b)=>a.d-b.d);
  const base={scene,revision,size:a.size,position:{...a.position}};
  let failures=missed.get(a);
  if (!failures || failures.scene!==scene || failures.revision!==revision ||
      distance(a.position,failures.position)>.1 || Math.abs(failures.size-a.size)>.025) {
    failures={...base,grains:new WeakMap()};
    missed.set(a,failures);
  }
  const cursor=old?.cursor ?? 0;
  const detourStart=old?.detourCursor ?? cursor;
  let checked=0, checkedDetours=0;
  for (const detour of [false,true]) {
    // A search around a solid is substantially more expensive than a
    // clear straight approach. Share the searches between all residents.
    const count=Math.min(candidates.length,detour ? 2 : 10);
    for (let i=0;i<count;i++) {
      if (detour && search.left<=0) break;
      const {p,aim}=candidates[((detour ? detourStart : cursor)+i)%candidates.length];
      if (detour) checkedDetours++;
      else checked++;
      if (scene?.blocksFood?.(p)) continue;
      const failed=failures.grains.get(p);
      if (failed && distance(failed,aim)<.35 && (!detour || failed.detour)) continue;
      if (!detour && scene?.canGrazeFrom?.(a,aim)===false) {
        failures.grains.set(p,{...aim,detour:false});
        continue;
      }
      if (detour) search.left--;
      const path=inReach(a,p,fish,scene) ? [] : feedingRoute(scene,a,aim,{detour,maxNodes:fish ? 28 : 54});
      if (!path) {
        failures.grains.set(p,{...aim,detour});
        continue;
      }
      const plan={...base,food:p,path,index:0,expires:Infinity};
      plans.set(a,plan);
      return plan;
    }
  }
  // Reconsider a changing water column soon. A verified dead end on the
  // bed can be skipped until another dose, scenery change or later search.
  const falling=candidates.some(({p})=>!isSettledPellet(p));
  const next=cursor+Math.max(checked,1);
  const retry=next<candidates.length ? .8 : falling ? 2.5 : reserved.size ? 1.6 : 180;
  plans.set(a,{...base,grazeable,count:available.size,first:state.foodPellets[0],last:state.foodPellets.at(-1),
    more:next<candidates.length,cursor:candidates.length ? next%candidates.length : 0,
    detourCursor:candidates.length ? (detourStart+checkedDetours)%candidates.length : 0,expires:now+retry});
  return null;
}

function heading(a,point,fish) {
  const p=a.position;
  const dx=point.x-p.x, dy=fish ? point.y-p.y : 0, dz=point.z-p.z;
  const length=Math.hypot(dx,dy,dz);
  if (length<epsilon) return null;
  const yaw=Math.atan2(dz,dx), pitch=Math.atan2(dy,Math.hypot(dx,dz));
  const v=a.velocity;
  const previousYaw=Math.atan2(v.z,v.x), previousPitch=Math.atan2(v.y,Math.hypot(v.x,v.z));
  const yawDelta=Math.atan2(Math.sin(yaw-previousYaw),Math.cos(yaw-previousYaw));
  const pitchDelta=pitch-previousPitch;
  const turn=Math.hypot(v.x,v.y,v.z)>.001 ? Math.hypot(yawDelta,pitchDelta)/animalTurnRate(a.species) : 0;
  return {length,yaw,pitch,turn,previousYaw,previousPitch,yawDelta,pitchDelta};
}

function walk(intent,dt) {
  const {a,fish,speed,plan,point,direction}=intent;
  if (!direction) return;
  const d=direction;
  const fraction=d.turn>dt ? dt/d.turn : 1;
  const yaw=fraction===1 ? d.yaw : d.previousYaw+d.yawDelta*fraction;
  const pitch=fraction===1 ? d.pitch : d.previousPitch+d.pitchDelta*fraction;
  Object.assign(a.velocity,{x:speed*Math.cos(pitch)*Math.cos(yaw),y:speed*Math.sin(pitch),z:speed*Math.cos(pitch)*Math.sin(yaw)});
  if (intent.atMouth || dt<=d.turn) return;
  const travel=Math.min(1,(dt-d.turn)*speed/d.length);
  const p=a.position;
  p.x+=(point.x-p.x)*travel;
  p.z+=(point.z-p.z)*travel;
  p.y=fish ? p.y+(point.y-p.y)*travel : substrateHeight(p.x,p.z)+.025;
  if (travel>=1-epsilon) plan.index++;
  Object.assign(plan.position,p);
}

function elapse(state,dt,callback) {
  state.behaviorSeconds+=dt;
  state.currentSeconds+=dt*((state.equipment.filter ? .78 : 0)+(state.equipment.aerator ? .22 : 0));
  for (const a of state.animals) {
    a.biteCooldown=Math.max(0,(a.biteCooldown??0)-dt);
    a.biteFlash=Math.max(0,(a.biteFlash??0)-dt);
    const fish=SPECIES[a.species].type==='fish';
    if (!a.alive) {
      a.behavior='dead'; a.targetFoodId=null;
      if (fish) a.position.y+=Math.max(-.1*dt,Math.min(.1*dt,4-a.position.y));
      Object.assign(a.velocity,{x:0,y:0,z:0});
    } else if (!a.biteFlash && (a.hunger<8 || !a.targetFoodId || !state.foodPellets.length)) {
      a.targetFoodId=null;
      a.behavior=fish ? (state.water.oxygen<3 ? 'gasping' : a.hunger<8 ? 'resting' : 'swimming') : 'grazing';
    }
  }
  if (state.foodPellets.length) sinkFood(state,dt);
  callback?.(dt);
}

// Fast-forward holds the picture still. Only active foragers need movement
// events; a full tank with no reachable food can advance in one interval.
export function advanceFastFeeding(state,seconds,scene,onElapsed) {
  if (state.paused || !Number.isFinite(seconds) || seconds<=0) return;
  let remaining=seconds;
  let search=routeBudgets.get(state);
  if (!search || search.scene!==scene || search.revision!==scene?.revision) {
    search={left:2,refill:state.behaviorSeconds+10,scene,revision:scene?.revision};
    routeBudgets.set(state,search);
  }
  while (remaining>epsilon) {
    if (state.behaviorSeconds>=search.refill) {
      search.left=2;
      search.refill=state.behaviorSeconds+10;
    }
    let dt=remaining;
    const reserved=new Set(), available=new Set(state.foodPellets), intents=[];
    let grazeable=0;
    for (const p of available) if (p.y<=substrateHeight(p.x,p.z)+.18) grazeable++;
    const ordered=available.size ? state.animals.filter(a=>a.alive && a.hunger>=8).sort((a,b)=>b.hunger-a.hunger || a.serial-b.serial) : [];
    for (const a of ordered) {
      const fish=SPECIES[a.species].type==='fish';
      if (fish && state.water.oxygen<3) { a.behavior='gasping'; a.targetFoodId=null; continue; }
      const speed=feedingSpeed(a,fish);
      const plan=findPlan(state,a,fish,speed,scene,available,reserved,search,grazeable);
      a.targetFoodId=plan?.food.id ?? null;
      if (!plan) {
        const searchState=plans.get(a);
        if (searchState?.more) dt=Math.min(dt,Math.max(.001,searchState.expires-state.behaviorSeconds));
        continue;
      }
      const food=plan.food;
      if (fish || food.y<=substrateHeight(food.x,food.z)+.18) reserved.add(food);
      a.behavior='seeking';
      const atMouth=inReach(a,food,fish,scene);
      const point=atMouth ? food : plan.path[plan.index];
      if (!atMouth && !point) {
        if (!fish && !isSettledPellet(food)) {
          const fall=(food.y-substrateHeight(food.x,food.z)-.17)/pelletFallSpeed(food);
          if (fall>epsilon) dt=Math.min(dt,fall);
          else plan.expires=state.behaviorSeconds;
        } else plan.expires=state.behaviorSeconds;
      }
      // A feeding animal already facing the grain can bite without another
      // body turn. This matters inside a narrow gap between two rocks.
      const v=a.velocity, p=a.position;
      const aligned=atMouth && (Math.hypot(v.x,v.y,v.z)<=.03 ||
        (food.x-p.x)*v.x+(food.y-p.y)*v.y+(food.z-p.z)*v.z>=-.01);
      const direction=point && !aligned ? heading(a,point,fish) : null;
      const turn=direction?.turn ?? 0;
      if (atMouth) {
        dt=Math.min(dt,Math.max(.001,a.biteCooldown,turn));
      } else if (direction) {
        dt=Math.min(dt,Math.max(.001,turn+direction.length/speed));
      }
      // A fish with a computed interception swims to that point in one
      // leg. Re-evaluate a missed interception when it arrives rather than
      // canceling every route while all the grains are still descending.
      if (fish && !point) dt=Math.min(dt,.35);
      intents.push({a,fish,speed,plan,point,direction,atMouth});
    }
    if (ordered.length && available.size) {
      // A shrimp may start a route as soon as food reaches the bed. Do not
      // step over that event even when nobody can currently claim the grain.
      for (const p of available) {
        const until=(p.y-substrateHeight(p.x,p.z)-.16)/pelletFallSpeed(p);
        if (until>epsilon) dt=Math.min(dt,until);
      }
    }
    for (const intent of intents) walk(intent,dt);
    elapse(state,dt,onElapsed);
    for (const {a,fish,plan} of intents) {
      if (a.alive && a.hunger>=8 && !a.biteCooldown && plan.food.mass>1e-10 && inReach(a,plan.food,fish,scene)) consumePellet(state,a.id,plan.food.id,scene);
    }
    remaining-=dt;
  }
  if (remaining>0) elapse(state,remaining,onElapsed);
}
