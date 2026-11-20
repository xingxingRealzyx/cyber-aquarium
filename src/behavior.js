import {
  consumePellet, isSettledPellet, MAX_BED_PELLETS, nearestPellet,
  reconcileFood, SPECIES, substrateHeight,
} from './simulation.js';
import { sampleFish, applySchoolSteering } from './schooling.js';
import { makeResidentBox, moveResident, residentContactStep, residentGlassStride } from './resident-collisions.js';
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

function steer(animal, tx, ty, tz, dt, response, cruising) {
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
  const cornerSpeed = targetSpeed * (minimumFraction + (1 - minimumFraction) * Math.max(0, alignment));
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

function chooseFood(state,animal,reserved,scene) {
  const fish=SPECIES[animal.species].type==='fish';
  if (!fish && scene?.grazerObstacle && scene.canGrazeFrom && scene.overlaps) return chooseGrazerFood(state,animal,reserved,scene);
  let chosen=null,best=Infinity;
  for(const p of state.foodPellets) {
    if(p.mass<=1e-10||reserved.has(p.id))continue;
    if(!fish&&p.y>substrateHeight(p.x,p.z)+.18)continue;
    // A fish must be able to reach the particle. Settled leftovers belong to
    // bottom grazers; otherwise an old unreachable particle can trap a hungry
    // fish below the water-column floor while fresh feed falls above it.
    if(fish && (p.y < Math.max(.72,substrateHeight(p.x,p.z)+.24) ||
        (!scene && p.y<1.45 && Math.hypot(p.x+1.3,p.z-.2)<.95))) continue;
    const d=distance(animal.position,p);
    const score=d*(p.id===animal.targetFoodId? .72:1);
    if(score<best && !scene?.blocksFood(p)){best=score;chosen=p;}
  }
  return chosen;
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

function escapeTarget(a, author) {
  const p = a.position;
  // Steer outwards, preserving some forward travel. Along the glass use the
  // open side of the tank so a fish caught between diver and pane can slip past.
  const x = clamp(p.x + author.x * 1.6 + a.velocity.x * .3, -3.5, 3.5);
  const y = clamp(p.y + author.y * 1.6 + a.velocity.y * .3, .85, 3.8);
  const z = clamp(p.z + author.z * 1.6 + a.velocity.z * .3, -1.5, 1.5);
  if (Math.hypot(x-p.x,y-p.y,z-p.z) > .65) return {x,y,z};
  const side = (p.x * author.z - p.z * author.x) >= 0 ? 1 : -1;
  const vertical = Math.hypot(author.x, author.z) < .2;
  return { x: clamp(x + (vertical ? (p.x > 0 ? -1 : 1) : -side * author.z), -3.5, 3.5),
    y, z: clamp(z + side * author.x, -1.5, 1.5) };
}

function step(state,dt,scene) {
  const time=state.behaviorSeconds;
  sinkFood(state,dt);
  const reserved=new Set();
  const neighbours = sampleFish(state.animals);
  // Hungry animals acquire food first; satiety releases any claim immediately.
  const order=[...state.animals].sort((a,b)=>b.hunger-a.hunger||a.serial-b.serial);
  const busy = new Set();
  const intents = order.map(a => {
    const fish = SPECIES[a.species].type === 'fish';
    const nearby = a.alive && fish ? scene?.avoid(a) : null;
    const author = nearby?.author;
    // A passing swimmer's fins move across the edge of the alert distance
    // several times in a stroke. Finish the escape in clear water.
    const fleeRadius = a.behavior === 'evading' ? 1.32 : 1.15;
    const fleeing = !!author && author.distance < fleeRadius;
    const gasping = fish && state.water.oxygen < 3;
    const clutch = REPRODUCTION[a.species].kind === 'guarded' && state.broods?.find(b =>
      b.species === a.species && (b.motherId === a.id || b.fatherId === a.id));
    const food = a.alive && !fleeing && !gasping && a.hunger >= 8 ? chooseFood(state, a, reserved,scene) : null;
    if (food && (fish || !aboveGrazerReach(food))) reserved.add(food.id);
    if (fleeing || gasping || clutch || food || a.biteFlash > 0) busy.add(a.id);
    return { a, fish, food, gasping, clutch, author, fleeing, obstacle: nearby?.obstacle, foliage: nearby?.foliage };
  });
  const games = planFishPlay(state, dt, a => busy.has(a.id));
  for (const a of state.animals) makeResidentBox(a, time);
  for(const { a, fish, food, gasping, clutch, author, fleeing, obstacle, foliage } of intents) {
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
    let target = fleeing ? escapeTarget(a, author) : play?.target || food || roamTarget(a,time,clutch);
    if(!fish && food)target=grazerMealTarget(a,food,time);
    if(gasping)target={x:target.x,y:3.88,z:target.z};
    if (fleeing) a.behavior = 'evading';
    else if (gasping) a.behavior = 'gasping';
    else if (play) a.behavior = play.behavior;
    else if (a.biteFlash > 0) a.behavior = 'eating';
    else if (food) a.behavior = 'seeking';
    else if (!fish) a.behavior = 'grazing';
    else a.behavior = a.hunger < 8 ? 'resting' : 'swimming';
    const dx=target.x-pos.x,dy=target.y-pos.y,dz=target.z-pos.z;
    const d=Math.max(.001,Math.hypot(dx,dy,dz));
    const health=.35+.65*clamp(a.health/100,0,1);
    const cruiseSpeed = SPECIES[a.species].swim?.cruiseSpeed ?? .5;
    let desiredSpeed = a.species === 'shrimp' ? .22 : .075;
    if (fish) {
      desiredSpeed = food ? .62 + a.hunger * .014 : cruiseSpeed;
      if (a.hunger < 8) desiredSpeed *= .62;
      if (play) desiredSpeed *= play.speedMultiplier;
      if (fleeing) {
        const urgency = clamp(1 - author.distance / 1.15, 0, 1);
        desiredSpeed = Math.max(1, cruiseSpeed * 2) + .8 * urgency;
      }
      if (a.infection) desiredSpeed *= 1 - .5 * a.infection.severity;
    }
    const speed = desiredSpeed * health * (.9 + a.metabolism * .1);
    // Arrive without orbiting the target; feeding is still guarded by contact.
    const arrive = food && !fish && (target.x!==food.x || target.z!==food.z) ? 1 : Math.min(1, d / (food ? .42 : .6));
    const goal = { x: dx/d*speed*arrive, y: fish ? dy/d*speed*arrive : 0, z: dz/d*speed*arrive };
    const cruising = fish && !busy.has(a.id) && !play;
    let retreat;
    if(fish) {
      const affinity = busy.has(a.id) || play ? 0 : SPECIES[a.species].schoolAffinity;
      if (applySchoolSteering(a, neighbours, goal, speed, affinity, food && d < .6) && a.behavior === 'swimming') {
        a.behavior = 'schooling';
      }
      const clearance = .34 + .50 * a.size;
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
        const push = weight * (inward + speed * .25);
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
    const bottom = Math.max(FISH_MIN_Y, substrateHeight(pos.x,pos.z) + .17);
    alongGlass(goal, 'x', pos.x, -3.65, 3.65, speed);
    alongGlass(goal, 'z', pos.z, -1.65, 1.65, speed);
    if (fish) alongGlass(goal, 'y', pos.y, bottom, 3.96, speed);
    const start = { x: pos.x, y: pos.y, z: pos.z }, heading = { x: vel.x, y: vel.y, z: vel.z };
    steer(a, goal.x, goal.y, goal.z, dt, fleeing || play || food ? 5 : 2.2, cruising && !clearingContact);
    const stroke = retreat ?? vel;
    let stride = Math.min(residentGlassStride(a, time, dt, stroke), wallStride(pos.x, stroke.x, -3.65, 3.65), wallStride(pos.z, stroke.z, -1.65, 1.65));
    if (fish) stride = Math.min(stride, wallStride(pos.y, vel.y, bottom, 3.96));
    pos.x = clamp(pos.x + stroke.x*dt*stride, Math.min(start.x,-3.65), Math.max(start.x,3.65));
    pos.z = clamp(pos.z + stroke.z*dt*stride, Math.min(start.z,-1.65), Math.max(start.z,1.65));
    const floor=substrateHeight(pos.x,pos.z)+(fish?.17:.025);
    // A previous contact or an old save can leave the origin below its cruise
    // band. Let it swim back in. Snapping it to the band can move a whole
    // body width in one frame even when the fish is swimming horizontally.
    if (fish) {
      pos.y = clamp(pos.y + vel.y*dt*stride, Math.min(start.y, Math.max(FISH_MIN_Y, floor)), Math.max(start.y, 3.96));
    } else {
      pos.y = floor;
    }
    const exit = moveResident(a, start, heading, state.animals, time, scene, (fish ? .12 : .04) * dt, retreat);
    if (exit) holdBack(a, exit, time);
  }
  for (const { a, food } of intents) if (food) consumePellet(state, a.id, food.id, scene);
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
