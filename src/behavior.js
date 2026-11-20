import {
  consumePellet, isSettledPellet, MAX_BED_PELLETS, nearestPellet,
  reconcileFood, SPECIES, substrateHeight,
} from './simulation.js';
import { FISH_PROFILES } from './fish-profiles.js';
import { drawFood, fishMouth, mouthAtFood, suctionReach } from './fish-feeding.js';
import { feedingRoute } from './feeding-route.js';
import { sampleFish, applySchoolSteering, signallingFish, schoolResponse } from './schooling.js';
import { FISH_SCULL_SPEED, makeResidentBox, moveResident, residentContactStep, residentGlassStride } from './resident-collisions.js';
import { holdBack, steerClear } from './contact-steering.js';
import { aboveGrazerReach, chooseGrazerFood, grazerMealTarget } from './grazer-feeding.js';
import { steerGrazer } from './grazer-steering.js';
import { planFishPlay } from './fish-play.js';
import { REPRODUCTION } from './reproduction.js';

const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const random = seed => { const n=Math.sin(seed*127.1+311.7)*43758.5453;return n-Math.floor(n); };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const FISH_MIN_Y=.67;
const turnRates = new WeakMap();

// Radians per motion second. Benthic grazers pivot more slowly than swimming fish.
export function animalTurnRate(species) {
  if (species === 'snail') return .75;
  if (species === 'shrimp') return 1.2;
  return 1.5;
}

function steer(animal, tx, ty, tz, dt, response, cruising, feedingLow) {
  const v = animal.velocity;
  const horizontal = Math.hypot(v.x, v.z);
  const speed = Math.hypot(horizontal, v.y);
  const yaw = Math.atan2(v.z, v.x);
  const pitch = Math.atan2(v.y, horizontal);
  const targetHorizontal = Math.hypot(tx, tz);
  const targetSpeed = Math.hypot(targetHorizontal, ty);
  const targetYaw = targetHorizontal > targetSpeed * .01 ? Math.atan2(tz, tx) : yaw;
  const targetPitch = targetSpeed > 0 ? Math.atan2(ty, targetHorizontal) : pitch;
  let yawDelta = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
  const pitchDelta = targetPitch - pitch;
  let rate = turnRates.get(animal);
  if (!rate) turnRates.set(animal, rate = {yaw:0, pitch:0});
  // For a target immediately astern, either arc works. Keep the turn already
  // underway when a moving target crosses the seam between +π and -π.
  if (Math.abs(yawDelta) > Math.PI - .12 && yawDelta * rate.yaw < -.1) yawDelta += yawDelta > 0 ? -2*Math.PI : 2*Math.PI;
  const turnLimit = cruising ? .84 : animalTurnRate(animal.species);
  const gain = Math.min(cruising ? 2.2 : 9, turnLimit / Math.max(.00001, Math.hypot(yawDelta, pitchDelta)));
  const responseFraction = 1 - Math.exp(-(cruising ? 4.2 : 14) * dt);
  rate.yaw += (yawDelta*gain-rate.yaw)*responseFraction;
  rate.pitch += (pitchDelta*gain-rate.pitch)*responseFraction;
  const nextYaw = yaw + rate.yaw*dt;
  const nextPitch = clamp(pitch + rate.pitch*dt, -Math.PI/2+.001, Math.PI/2-.001);

  // Carry forward speed around a cruising turn. A precise turn towards a
  // pellet or out of a tight gap still needs a much smaller turning radius.
  const alignment = Math.cos(nextPitch) * Math.cos(targetPitch) * Math.cos(targetYaw - nextYaw)
    + Math.sin(nextPitch) * Math.sin(targetPitch);
  const minimumFraction = cruising ? .60 : .12;
  // A checked route can have a tight corner beside the sand or a rock.
  // Pivot with small fin strokes before accelerating along the new leg.
  const cornerFraction=feedingLow ? .025+.975*clamp((alignment-.70)/.27,0,1) :
    minimumFraction + (1 - minimumFraction) * Math.max(0,alignment);
  const cornerSpeed=targetSpeed*cornerFraction;
  const nextSpeed = speed + (cornerSpeed - speed) * (1 - Math.exp(-dt * response));
  const nextHorizontal = nextSpeed * Math.cos(nextPitch);
  v.x = nextHorizontal * Math.cos(nextYaw);
  v.z = nextHorizontal * Math.sin(nextYaw);
  v.y = nextSpeed * Math.sin(nextPitch);
}

// Ease the entire stride as it approaches glass, keeping the actual path tangent
// to the animal's heading. Clipping one component makes it slide sideways.
function wallStride(position, velocity, min, max) {
  // Outside the cruising band the blocked component is clipped separately.
  // Other components can still carry the fish along the glass.
  if (position <= min || position >= max) return 1;
  if (velocity === 0) return 1;
  const space = velocity > 0 ? max - position : position - min;
  return clamp(3 * space / Math.abs(velocity), 0, 1);
}

// Turn along a pane before reaching it. Spacing from schoolmates, a toy or a
// rock can otherwise press a fish straight into the glass, where wallStride
// holds it in place for as long as any of its heading points outward.
function alongGlass(goal, axis, position, min, max, speed) {
  const lead = .35;
  const high = speed * (1.1 * (max - position) / lead - .1);
  const low = -speed * (1.1 * (position - min) / lead - .1);
  goal[axis] = clamp(goal[axis], low, high);
}

function roamTarget(animal,time,clutch) {
  const seed=animal.seed;
  if(SPECIES[animal.species].type!=='fish') {
    const x=Math.sin(time*.035+seed*6.283)*2.8,z=Math.cos(time*.026+seed*7.4)*1.25;
    return {x,y:substrateHeight(x,z)+.025,z};
  }
  if (clutch) {
    // Keep each parent near its clutch, with room to turn along the inside of the glass.
    const nest = clutch.position;
    const side = animal.id === clutch.motherId ? -1 : 1;
    return {
      x: clamp(nest.x + side * .32 + .12 * Math.sin(time * .4 + seed), -3.45, 3.45),
      y: clamp(nest.y + .32 + .10 * Math.cos(time * .3), .9, 3.82),
      z: clamp(nest.z + .12 * Math.sin(time * .5 + seed), -1.48, 1.48),
    };
  }
  // Each fish explores its own route when it has no nearby schoolmates.
  const swim = SPECIES[animal.species].swim;
  const cruiseTime = time * (swim?.pace ?? 1);
  const driftX=Math.sin(cruiseTime*.09+seed*2)*1.65,driftZ=Math.cos(cruiseTime*.07+seed*2)*.45;
  return {
    x:clamp(driftX+Math.sin(time*.13+seed*6.283)*1.45,-3.15,3.15),
    y:(swim?.cruisingHeight ?? 1.75)+random(seed+18)*1.05+Math.sin(time*.11+seed*9)*.35,
    z:clamp(driftZ+Math.cos(time*.12+seed*7.7)*.7,-1.3,1.3),
  };
}

// Cache a safe approach for each bottom-feeding fish. Use the live contact
// solver while following it; replan a stalled approach when scenery moves.
const bedApproaches = new WeakMap();
function bedRoute(animal,food,scene,time,budget) {
  let routes=bedApproaches.get(animal);
  if (!routes) bedApproaches.set(animal,routes=new WeakMap());
  let route=routes.get(food);
  if (route && (route.scene!==scene || time<route.checked || time>=route.expires ||
      Math.hypot(food.x-route.x,food.z-route.z)>.16)) route=null;
  if (!route) {
    if (!budget?.direct) return null;
    budget.direct--;
    const nodes=feedingRoute(scene,animal,food,{detour:false});
    route={nodes,index:0,best:Infinity,scene,checked:time,expires:time+(nodes ? 5 : 2.5),x:food.x,z:food.z};
    routes.set(food,route);
  }
  if (!route.nodes && !route.detoured && budget?.detours) {
    budget.detours--;
    route.detoured=true;
    route.nodes=feedingRoute(scene,animal,food,{maxNodes:24});
  }
  return route;
}
function nearBed(food) { return food.y<substrateHeight(food.x,food.z)+.27; }

// The order of claims follows hunger. Rotate the separate geometry quota so
// a school near inaccessible grains cannot monopolise all route probes.
const firstForager=new WeakMap();
function foodSearchStep(state) {
  const foodById=new Map(state.foodPellets.map(p=>[p.id,p])), quotas=new Map();
  const lowFood=new Set(state.foodPellets.filter(nearBed));
  if (lowFood.size) {
    const fish=state.animals.filter(a=>a.alive && a.hunger>=8 && SPECIES[a.species].type==='fish');
    const first=firstForager.get(state) ?? 0, count=Math.min(4,fish.length);
    for(let i=0;i<count;i++) quotas.set(fish[(first+i)%fish.length],{direct:Math.floor(10/count),detours:i===0?1:0});
    if (count) firstForager.set(state,(first+1)%fish.length);
  }
  return {foodById,quotas,lowFood};
}
function chooseFood(state,animal,reserved,scene,budget) {
  const fish=SPECIES[animal.species].type==='fish';
  if (!fish && scene?.grazerObstacle && scene.canGrazeFrom && scene.overlaps) return chooseGrazerFood(state,animal,reserved,scene);
  // Keep the last stroke committed even as a second falling grain passes
  // closer to the body centre. A hungrier neighbour can still claim it first.
  const prior=budget.foodById.get(animal.targetFoodId);
  const quota=budget.quotas.get(animal);
  const mouth=fish && fishMouth(animal);
  if (fish && prior && !reserved.has(prior.id) && !scene?.blocksFood?.(prior)) {
    if (nearBed(prior)) {
      if (bedRoute(animal,prior,scene,state.behaviorSeconds,quota)?.nodes) return prior;
    } else if (distance(mouth,prior)<1.6*suctionReach(animal) &&
        (prior.x-mouth.x)*mouth.fx+(prior.y-mouth.y)*mouth.fy+(prior.z-mouth.z)*mouth.fz>=-.025) return prior;
  }
  const candidates=[];
  for(const p of state.foodPellets) {
    if(p.mass<=1e-10 || reserved.has(p.id))continue;
    if(!fish && p.y>substrateHeight(p.x,p.z)+.18)continue;
    if(fish && !scene && p.y<1.45 && Math.hypot(p.x+1.3,p.z-.2)<.95)continue;
    let cost=distance(mouth || animal.position,p);
    if (fish && !budget.lowFood.has(p)) {
      // In a cloud of grains, a shorter path behind the cheek can require a
      // whole turn. Prefer grains on the current stroke, especially at the lips.
      if (cost<=suctionReach(animal) && mouthAtFood(animal,p,scene)) return p;
      const ahead=(p.x-mouth.x)*mouth.fx+(p.y-mouth.y)*mouth.fy+(p.z-mouth.z)*mouth.fz;
      cost+=.48*(1-ahead/Math.max(.0001,cost));
    }
    candidates.push({p,score:cost*(p.id===animal.targetFoodId ? .72 : 1)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  for (const {p} of candidates) {
    if (scene?.blocksFood?.(p)) continue;
    if (!fish || !nearBed(p) || bedRoute(animal,p,scene,state.behaviorSeconds,quota)?.nodes) return p;
  }
  return null;
}

// Intercept a falling grain from the side. With the grain directly above or
// below the body the lips cannot line up, even when the fish pitches fully.
const waterApproaches=new WeakMap();
function waterMealTarget(a,food,time) {
  const pos=a.position, dx=food.x-pos.x, dz=food.z-pos.z;
  const flat=Math.hypot(dx,dz), nose=FISH_PROFILES[a.species].nose*(a.size??1);
  let approach=waterApproaches.get(a);
  if (approach?.food!==food || time>approach.until) approach=null;
  const height=food.y-pos.y;
  const tooSteep=flat<nose+.10 && Math.abs(height)>.72*flat;
  const alongside=Math.hypot(flat,height)<.8*nose;
  if (!approach && (tooSteep || alongside)) {
    let yaw=flat>.05 ? Math.atan2(dz,dx) : Math.atan2(a.velocity.z,a.velocity.x);
    // Approach edge grains from inside the glass.
    if (Math.abs(food.z) > 1.20) yaw=Math.sign(food.z)*Math.PI/2;
    else if (Math.abs(food.x)>3.1) yaw=food.x>0 ? 0 : Math.PI;
    approach={food,x:Math.cos(yaw),z:Math.sin(yaw),staging:true,until:time+4.5};
    waterApproaches.set(a,approach);
  }
  if (!approach || !approach.staging) return food;
  const clearance=nose+suctionReach(a)+.22;
  const stage={x:food.x-approach.x*clearance,
    y:food.y-1.55*pelletFallSpeed(food),z:food.z-approach.z*clearance};
  if (distance(pos,stage)<.15) approach.staging=false;
  return approach.staging ? stage : food;
}

function fishMealTarget(a,food,time,scene) {
  if (!nearBed(food)) return waterMealTarget(a,food,time);
  const route=bedRoute(a,food,scene,time), nodes=route?.nodes;
  if (!nodes?.length) return food;
  while (route.index<nodes.length-1 && distance(a.position,nodes[route.index])<.23) {
    route.index++;
    route.best=Infinity;
  }
  const next=nodes[route.index], remaining=distance(a.position,next);
  if (remaining<route.best-.06) {
    route.best=remaining;
    route.expires=time+5;
  }
  // Track the grain itself on the final stroke so the jaw points at it,
  // including when the fish brakes just above a sloping bed.
  return route.index===nodes.length-1 ? food : next;
}

export function pelletFallSpeed(p) {
  return (p.fastSinking ? .22 : .095) + random(p.seed+8)*.03;
}

// Integrate the oscillating current over the submerged part of the stroke.
// This also works when an unobserved grain lands during a long fast-forward.
export function fallingPosition(p, seconds) {
  const age = p.ageSeconds, rate = pelletFallSpeed(p);
  const xPhase = age*.7 + p.seed*9, zPhase = age*.5 + p.seed*7;
  let dt = Math.min(seconds, Math.max(0,(p.y-substrateHeight(p.x,p.z)-.04)/rate));
  let x, z, floor;
  for (let pass = 0; pass < 3; pass++) {
    x = clamp(p.x + .012/.7*(Math.cos(xPhase)-Math.cos(xPhase+dt*.7)),-3.6,3.6);
    z = clamp(p.z + .008/.5*(Math.sin(zPhase+dt*.5)-Math.sin(zPhase)),-1.6,1.6);
    floor = substrateHeight(x,z)+.04;
    const next = Math.min(seconds,Math.max(0,(p.y-floor)/rate));
    if (Math.abs(dt-next)<1e-8) break;
    dt=next;
  }
  return { x, y:Math.max(floor,p.y-seconds*rate), z };
}

export function sinkFood(state, dt) {
  const bed = state.foodPellets.length > MAX_BED_PELLETS ? state.foodPellets.filter(isSettledPellet) : null;
  let merged = false;
  for(const p of state.foodPellets) {
    if (isSettledPellet(p)) { p.ageSeconds+=dt; continue; }
    Object.assign(p,fallingPosition(p,dt));
    p.ageSeconds+=dt;
    if (!isSettledPellet(p)) continue;
    p.y=substrateHeight(p.x,p.z)+.04;
    if (bed) {
      if (bed.length < MAX_BED_PELLETS) bed.push(p);
      else {
        nearestPellet(bed, p.x, p.y, p.z).mass += p.mass;
        p.mass = 0;
        merged = true;
      }
    }
  }
  if (merged) reconcileFood(state);
}

function escapeTarget(a, away) {
  const p = a.position;
  // Steer outwards, preserving some forward travel. Along the glass use the
  // open side of the tank so a fish caught between diver and pane can slip past.
  const x = clamp(p.x + away.x * 1.6 + a.velocity.x * .3, -3.5, 3.5);
  const y = clamp(p.y + away.y * 1.6 + a.velocity.y * .3, .85, 3.8);
  const z = clamp(p.z + away.z * 1.6 + a.velocity.z * .3, -1.5, 1.5);
  if (Math.hypot(x-p.x,y-p.y,z-p.z) > .65) return {x,y,z};
  const side = (p.x * away.z - p.z * away.x) >= 0 ? 1 : -1;
  const vertical = Math.hypot(away.x, away.z) < .2;
  return { x: clamp(x + (vertical ? (p.x > 0 ? -1 : 1) : -side * away.z), -3.5, 3.5),
    y, z: clamp(z + side * away.x, -1.5, 1.5) };
}

function step(state,dt,scene) {
  const time=state.behaviorSeconds;
  sinkFood(state,dt);
  const reserved=new Set();
  // Share expensive obstacle searches across fish when many grains are on
  // the bed. Cached alternatives continue on subsequent motion steps.
  const foodSearch=foodSearchStep(state);
  const neighbours = sampleFish(state.animals);
  const signals = signallingFish(neighbours,time);
  // Hungry animals acquire food first; satiety releases any claim immediately.
  const order=[...state.animals].sort((a,b)=>b.hunger-a.hunger||a.serial-b.serial);
  const busy = new Set();
  const intents = order.map(a => {
    const fish = SPECIES[a.species].type === 'fish';
    const nearby = a.alive && fish ? scene?.avoid(a) : null;
    const gasping = fish && state.water.oxygen < 3;
    const clutch = REPRODUCTION[a.species].kind === 'guarded' && state.broods?.find(b =>
      b.species === a.species && (b.motherId === a.id || b.fatherId === a.id));
    const canStartle = !gasping && !clutch && !(a.biteFlash>0) && !(a.targetFoodId && a.hunger>=85);
    const fright = fish && a.alive ? schoolResponse(a,signals,nearby?.author,time,dt,canStartle) : null;
    const fleeing = !!fright?.escape;
    const food = a.alive && !fleeing && !gasping && a.hunger >= 8 ? chooseFood(state, a, reserved,scene,foodSearch) : null;
    if (food && (fish || !aboveGrazerReach(food))) reserved.add(food.id);
    if (fleeing || gasping || clutch || food || a.biteFlash > 0) busy.add(a.id);
    return { a, fish, food, gasping, clutch, fright, fleeing, obstacle: nearby?.obstacle, foliage: nearby?.foliage };
  });
  const games = planFishPlay(state, dt, a => busy.has(a.id));
  for (const a of state.animals) makeResidentBox(a, time);
  for(const { a, fish, food, gasping, clutch, fright, fleeing, obstacle, foliage } of intents) {
    a.biteFlash=Math.max(0,(a.biteFlash||0)-dt);
    a.biteCooldown=Math.max(0,(a.biteCooldown||0)-dt);
    const pos=a.position,vel=a.velocity;
    if(!a.alive) {
      a.behavior='dead';a.targetFoodId=null;
      // Floating fish rest on their side just beneath the waterline (4.14).
      // Approach from either side so old saves above this depth resume smoothly.
      if (fish) pos.y += clamp(4.0 - pos.y, -.10 * dt, .10 * dt);
      vel.x=vel.y=vel.z=0;
      continue;
    }
    a.targetFoodId = food?.id ?? null;
    const play = games?.get(a.id);
    let target = fleeing ? escapeTarget(a,fright.escape) : play?.target || food || roamTarget(a,time,clutch);
    if (food) target=fish ? fishMealTarget(a,food,time,scene) : grazerMealTarget(a,food,time);
    if(gasping)target={x:target.x,y:3.88,z:target.z};
    if (fleeing) a.behavior = fright.direct ? 'evading' : 'startled';
    else if (gasping) a.behavior = 'gasping';
    else if (play) a.behavior = play.behavior;
    else if (a.biteFlash > 0) a.behavior = 'eating';
    else if (food) a.behavior = 'seeking';
    else if (!fish) a.behavior = 'grazing';
    else a.behavior = a.hunger < 8 ? 'resting' : 'swimming';
    const feedingLow=fish && foodSearch.lowFood.has(food);
    const approachingGrain=fish && target===food;
    const dx=target.x-pos.x, dz=target.z-pos.z;
    let dy=target.y-pos.y;
    if (approachingGrain && !feedingLow) {
      // Aim a little ahead of the falling pellet. The turn takes time even
      // after the grain has reached the end of the snout.
      const lead=Math.min(1,.18+.4*Math.hypot(dx,dy,dz));
      dy-=pelletFallSpeed(food)*lead;
    }
    const d=Math.max(.001,Math.hypot(dx,dy,dz));
    const health=.35+.65*clamp(a.health/100,0,1);
    const cruiseSpeed = SPECIES[a.species].swim?.cruiseSpeed ?? .5;
    let desiredSpeed = a.species === 'shrimp' ? .22 : .075;
    if (fish) {
      desiredSpeed = food ? .62 + a.hunger * .014 : cruiseSpeed;
      if (a.hunger < 8) desiredSpeed *= .62;
      if (play) desiredSpeed *= play.speedMultiplier;
      if (fleeing) {
        const escapeSpeed = Math.max(1, cruiseSpeed * 2) + .8 * Math.min(1,fright.urgency);
        desiredSpeed = fright.direct ? escapeSpeed : cruiseSpeed+(escapeSpeed-cruiseSpeed)*fright.urgency;
      }
      if (a.infection) desiredSpeed *= 1 - .5 * a.infection.severity;
    }
    const speed = desiredSpeed * health * (.9 + a.metabolism * .1);
    // Arrive without orbiting the target; feeding is still guarded by contact.
    let closing=d;
    if (approachingGrain) {
      const noseLength=(a.size??1)*FISH_PROFILES[a.species].nose;
      closing=Math.max(.002,d-noseLength-(feedingLow ? .58 : .16)*suctionReach(a));
    }
    let arrive=Math.min(1,closing/(food ? (fish ? .75 : .42) : .6));
    if (feedingLow && target!==food) arrive=clamp(d/.35,.24,1);
    if (food && !fish && (target.x!==food.x || target.z!==food.z)) arrive=1;
    const goal = { x: dx/d*speed*arrive, y: fish ? dy/d*speed*arrive : 0, z: dz/d*speed*arrive };
    const cruising = fish && !busy.has(a.id) && !play;
    let retreat;
    if(fish) {
      const affinity = busy.has(a.id) || play ? 0 : SPECIES[a.species].schoolAffinity;
      const regroup = affinity ? fright?.regroup ?? 0 : 0;
      // A fish braking into a feeding pose also brakes its soft separation
      // response. Otherwise a neighbour pushes it away from its last stroke.
      const followSpeed=feedingLow ? speed*Math.max(.12,arrive) : speed;
      if (applySchoolSteering(a, neighbours, goal, followSpeed, affinity, feedingLow || (food && d<.6), regroup)) {
        if (regroup) a.behavior = 'regrouping';
        else if (a.behavior==='swimming') a.behavior = 'schooling';
      }
      // Bottom routes already sweep the fish's posed hull. Leave room for
      // the last stroke along rock faces; the hard contact solver stays active.
      const clearance = feedingLow ? .10+.12*a.size : .34+.50*a.size;
      if (obstacle && obstacle.distance < clearance) {
        const weight = clamp(1 - obstacle.distance / clearance, 0, 1);
        const inward = Math.max(0, -(goal.x*obstacle.x + goal.y*obstacle.y + goal.z*obstacle.z));
        const push = weight * (inward + .65 * speed);
        if (cruising && inward > 0) {
          // Carry the existing stroke along the face. Repulsion alone can
          // cancel the route and leave a fish repeatedly braking at a rock.
          const normalSpeed = vel.x*obstacle.x + vel.y*obstacle.y + vel.z*obstacle.z;
          const tx = vel.x - normalSpeed*obstacle.x;
          const ty = vel.y - normalSpeed*obstacle.y;
          const tz = vel.z - normalSpeed*obstacle.z;
          const along = weight * inward / Math.max(.15, Math.hypot(tx, ty, tz));
          goal.x += tx*along;
          goal.y += ty*along;
          goal.z += tz*along;
        }
        goal.x += obstacle.x * push;
        goal.y += obstacle.y * push;
        goal.z += obstacle.z * push;
      } else if (foliage && !fleeing) {
        // Brush past flexible leaves. Dense roots use the solid obstacle path above.
        const weight = .22 * clamp(1 - foliage.distance / .20, 0, 1);
        const inward = Math.max(0, -(goal.x*foliage.x + goal.y*foliage.y + goal.z*foliage.z));
        const push = weight * (inward + Math.hypot(goal.x,goal.y,goal.z) * .25);
        goal.x += foliage.x * push;
        goal.y += foliage.y * push;
        goal.z += foliage.z * push;
      }
      // Route around the principal stone rather than swimming through its base.
      const rx=pos.x+1.3,rz=pos.z-.2,rad=Math.hypot(rx,rz);
      if(!scene && pos.y<1.5&&rad<1.05) {
        goal.x+=(rad>.01?rx/rad:1)*(1.05-rad)*1.8;
        goal.z+=(rad>.01?rz/rad:0)*(1.05-rad)*1.8;
        goal.y+=Math.max(0,1.35-pos.y)*.7;
      }
    } else {
      retreat = steerGrazer(a,scene,target,goal,speed,time);
    }
    const clearingContact = steerClear(a, goal, speed, time, fish);
    const bottom=feedingLow ? substrateHeight(pos.x,pos.z) : Math.max(FISH_MIN_Y,substrateHeight(pos.x,pos.z)+.17);
    alongGlass(goal, 'x', pos.x, -3.65, 3.65, speed);
    alongGlass(goal, 'z', pos.z, -1.65, 1.65, speed);
    if (fish && (!feedingLow || goal.y>0)) alongGlass(goal, 'y', pos.y, bottom, 3.96, speed);
    const start = { x: pos.x, y: pos.y, z: pos.z }, heading = { x: vel.x, y: vel.y, z: vel.z };
    steer(a, goal.x, goal.y, goal.z, dt, fish && food ? 8 : fleeing || play || food ? 5 : 2.2, cruising && !clearingContact,feedingLow);
    const stroke = retreat ?? vel;
    let stride = Math.min(residentGlassStride(a, time, dt, stroke), wallStride(pos.x, stroke.x, -3.65, 3.65), wallStride(pos.z, stroke.z, -1.65, 1.65));
    if (fish && (!feedingLow || vel.y>0)) stride = Math.min(stride, wallStride(pos.y, vel.y, bottom, 3.96));
    pos.x = clamp(pos.x + stroke.x*dt*stride, Math.min(start.x,-3.65), Math.max(start.x,3.65));
    pos.z = clamp(pos.z + stroke.z*dt*stride, Math.min(start.z,-1.65), Math.max(start.z,1.65));
    const floor=substrateHeight(pos.x,pos.z)+(fish?.17:.025);
    // A previous contact or an old save can leave the origin below its cruise
    // band. Let it swim back in. Snapping it to the band can move a whole
    // body width in one frame even when the fish is swimming horizontally.
    if (fish) {
      pos.y = clamp(pos.y + vel.y*dt*stride, Math.min(start.y, feedingLow ? substrateHeight(pos.x,pos.z) : Math.max(FISH_MIN_Y, floor)), Math.max(start.y, 3.96));
    } else {
      pos.y = floor;
    }
    const exit = moveResident(a, start, heading, state.animals, time, scene, (fish ? FISH_SCULL_SPEED : .04) * dt, retreat);
    if (exit) holdBack(a, exit, time);
  }
  const drawing=new Set();
  for (const {a,fish,food,fleeing,gasping} of intents) {
    if (!fish) {
      if (food) consumePellet(state,a.id,food.id,scene);
      continue;
    }
    if (!a.alive || fleeing || gasping || a.hunger<8 || a.biteCooldown>0) continue;
    let grain=food && !drawing.has(food) && mouthAtFood(a,food,scene) ? food : null;
    if (!grain && foodSearch.lowFood.size) {
      // As it swims past a patch, a fish can take the exposed grain in
      // front of its lips, even if a distant fish is heading towards it.
      // Resolve simultaneous suction in the same hunger order as navigation.
      const m=fishMouth(a), reach=suctionReach(a);
      if (m.y<substrateHeight(m.x,m.z)+.32+reach) {
        let best=reach*reach;
        for (const p of foodSearch.lowFood) {
          const ds=(p.x-m.x)**2+(p.y-m.y)**2+(p.z-m.z)**2;
          if (ds<=best && p.mass>1e-10 && !drawing.has(p) && mouthAtFood(a,p,scene)) {
            grain=p;best=ds;
          }
        }
      }
    }
    if (grain) {
      drawing.add(grain);
      a.targetFoodId=grain.id;
      drawFood(a,grain,dt,scene);consumePellet(state,a.id,grain.id,scene);
    }
  }
}

/** Advance locomotion, feeding and water flow by tank motion seconds. */
export function advanceBehavior(state,motionSeconds,scene) {
  if(state.paused||!Number.isFinite(motionSeconds)||motionSeconds<=0)return state;
  state.foodPellets ||= [];
  const start = state.behaviorSeconds ?? 0;
  const duration = Math.min(motionSeconds,30);
  const flow = (state.equipment?.filter !== false ? .78 : 0) + (state.equipment?.aerator !== false ? .22 : 0);
  state.currentSeconds = (state.currentSeconds ?? start) + duration * flow;
  let remaining = duration;
  while (remaining > 0) {
    let dt = residentContactStep(state.animals, Math.min(1 / 30, remaining));
    if (remaining - dt < 1e-9) dt = remaining;
    remaining -= dt;
    // Match the endpoint used to pose the toys, also after long fast-forwards.
    state.behaviorSeconds = start + (duration - remaining);
    step(state, dt, scene);
  }
  return state;
}
