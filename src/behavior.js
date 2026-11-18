import {
  consumePellet, isSettledPellet, MAX_BED_PELLETS, nearestPellet,
  reconcileFood, SPECIES, substrateHeight,
} from './simulation.js';

const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const random = seed => { const n=Math.sin(seed*127.1+311.7)*43758.5453;return n-Math.floor(n); };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const FISH_MIN_Y=.67;

// Radians per real second. Benthic grazers pivot more slowly than swimming fish.
export function animalTurnRate(species) {
  if (species === 'snail') return .75;
  if (species === 'shrimp') return 1.2;
  return 1.5;
}

function steer(animal, tx, ty, tz, dt, response) {
  const v = animal.velocity;
  const horizontal = Math.hypot(v.x, v.z);
  const speed = Math.hypot(horizontal, v.y);
  const yaw = Math.atan2(v.z, v.x);
  const pitch = Math.atan2(v.y, horizontal);
  const targetHorizontal = Math.hypot(tx, tz);
  const targetSpeed = Math.hypot(targetHorizontal, ty);
  const targetYaw = targetHorizontal > targetSpeed * .01 ? Math.atan2(tz, tx) : yaw;
  const targetPitch = targetSpeed > 0 ? Math.atan2(ty, targetHorizontal) : pitch;
  const yawDelta = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
  const pitchDelta = targetPitch - pitch;
  const turn = Math.hypot(yawDelta, pitchDelta);
  const fraction = turn > 0 ? Math.min(1, animalTurnRate(animal.species) * dt / turn) : 0;
  const nextYaw = yaw + yawDelta * fraction;
  const nextPitch = pitch + pitchDelta * fraction;

  // Slow down through tight turns so we can capture a drifting pellet without orbiting it.
  const alignment = Math.cos(nextPitch) * Math.cos(targetPitch) * Math.cos(targetYaw - nextYaw)
    + Math.sin(nextPitch) * Math.sin(targetPitch);
  const cornerSpeed = targetSpeed * (.12 + .88 * Math.max(0, alignment));
  const nextSpeed = speed + (cornerSpeed - speed) * (1 - Math.exp(-dt * response));
  const nextHorizontal = nextSpeed * Math.cos(nextPitch);
  v.x = nextHorizontal * Math.cos(nextYaw);
  v.z = nextHorizontal * Math.sin(nextYaw);
  v.y = nextSpeed * Math.sin(nextPitch);
}

// Ease the entire stride as it approaches glass, keeping the actual path tangent
// to the animal's heading. Clipping one component makes it slide sideways.
function wallStride(position, velocity, min, max) {
  if (velocity === 0) return 1;
  const space = velocity > 0 ? max - position : position - min;
  return clamp(3 * space / Math.abs(velocity), 0, 1);
}

function roamTarget(animal,time,broods) {
  const seed=animal.seed;
  if(SPECIES[animal.species].type!=='fish') {
    const x=Math.sin(time*.035+seed*6.283)*2.8,z=Math.cos(time*.026+seed*7.4)*1.25;
    return {x,y:substrateHeight(x,z)+.025,z};
  }
  if (animal.species === 'angelfish') {
    const clutch = broods?.find(b => b.species === 'angelfish' && (b.motherId === animal.id || b.fatherId === animal.id));
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
  }
  // A shared slow school center with individual offsets leaves calm, continuous paths.
  const swim = SPECIES[animal.species].swim;
  const schoolTime = time * (swim?.pace ?? 1);
  const schoolX=Math.sin(schoolTime*.09)*1.65,schoolZ=Math.cos(schoolTime*.07)*.45;
  return {
    x:clamp(schoolX+Math.sin(time*.13+seed*6.283)*1.45,-3.15,3.15),
    y:(swim?.cruisingHeight ?? 1.75)+random(seed+18)*1.05+Math.sin(time*.11+seed*9)*.35,
    z:clamp(schoolZ+Math.cos(time*.12+seed*7.7)*.7,-1.3,1.3),
  };
}

function chooseFood(state,animal,reserved) {
  const fish=SPECIES[animal.species].type==='fish';
  let chosen=null,best=Infinity;
  for(const p of state.foodPellets) {
    if(p.mass<=1e-10||reserved.has(p.id))continue;
    if(!fish&&p.y>substrateHeight(p.x,p.z)+.18)continue;
    // A fish must be able to reach the particle. Settled leftovers belong to
    // bottom grazers; otherwise an old unreachable particle can trap a hungry
    // fish below the water-column floor while fresh feed falls above it.
    if(fish&&(p.y<Math.max(.72,substrateHeight(p.x,p.z)+.24)||(p.y<1.45&&Math.hypot(p.x+1.3,p.z-.2)<.95)))continue;
    const d=distance(animal.position,p);
    const score=d*(p.id===animal.targetFoodId? .72:1);
    if(score<best){best=score;chosen=p;}
  }
  return chosen;
}

function sinkFood(state, dt) {
  const bed = state.foodPellets.length > MAX_BED_PELLETS ? state.foodPellets.filter(isSettledPellet) : null;
  let merged = false;
  for(const p of state.foodPellets) {
    p.ageSeconds+=dt;
    if (isSettledPellet(p)) continue;
    p.x=clamp(p.x+Math.sin(p.ageSeconds*.7+p.seed*9)*.012*dt,-3.6,3.6);
    p.z=clamp(p.z+Math.cos(p.ageSeconds*.5+p.seed*7)*.008*dt,-1.6,1.6);
    const floor = substrateHeight(p.x,p.z) + .04;
    const y = p.y - (.095+random(p.seed+8)*.03)*dt;
    if (y > floor + .001) { p.y = y; continue; }
    p.y = floor;
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

function step(state,dt) {
  state.behaviorSeconds=(state.behaviorSeconds||0)+dt;
  const time=state.behaviorSeconds;
  sinkFood(state,dt);
  const reserved=new Set();
  // Hungry animals acquire food first; satiety releases any claim immediately.
  const order=[...state.animals].sort((a,b)=>b.hunger-a.hunger||a.serial-b.serial);
  for(const a of order) {
    a.biteFlash=Math.max(0,(a.biteFlash||0)-dt);
    a.biteCooldown=Math.max(0,(a.biteCooldown||0)-dt);
    const fish=SPECIES[a.species].type==='fish';
    const pos=a.position,vel=a.velocity;
    if(!a.alive) {
      a.behavior='dead';a.targetFoodId=null;
      // Floating fish rest on their side just beneath the waterline (4.14).
      // Approach from either side so old saves above this depth resume smoothly.
      if (fish) pos.y += clamp(4.0 - pos.y, -.10 * dt, .10 * dt);
      vel.x=vel.y=vel.z=0;
      continue;
    }
    const gasping=fish&&state.water.oxygen<3;
    const food=!gasping&&a.hunger>=8?chooseFood(state,a,reserved):null;
    if(food){reserved.add(food.id);a.targetFoodId=food.id;}else a.targetFoodId=null;
    let target=food||roamTarget(a,time,state.broods);
    if(gasping)target={x:target.x,y:3.88,z:target.z};
    a.behavior=gasping?'gasping':a.biteFlash>0?'eating':food?'seeking':fish?(a.hunger<8?'resting':'swimming'):'grazing';
    const dx=target.x-pos.x,dy=target.y-pos.y,dz=target.z-pos.z;
    const d=Math.max(.001,Math.hypot(dx,dy,dz));
    const health=.35+.65*clamp(a.health/100,0,1);
    const cruiseSpeed = SPECIES[a.species].swim?.cruiseSpeed ?? .5;
    let desiredSpeed = a.species === 'shrimp' ? .22 : .075;
    if (fish) {
      desiredSpeed = food ? .62 + a.hunger * .014 : cruiseSpeed;
      if (a.hunger < 8) desiredSpeed *= .62;
      if (a.infection) desiredSpeed *= 1 - .5 * a.infection.severity;
    }
    const speed = desiredSpeed * health * (.9 + a.metabolism * .1);
    // Arrive without orbiting the target; feeding is still guarded by contact.
    const arrive = Math.min(1, d / (food ? .42 : .6));
    let tx=dx/d*speed*arrive,ty=dy/d*speed*arrive,tz=dz/d*speed*arrive;
    if(fish) {
      // Mild individual separation, weakened at the mouth for reliable bites.
      const strength=food&&d<.6?.08:.22;
      for(const other of state.animals) {
        if(other===a||!other.alive||SPECIES[other.species].type!=='fish')continue;
        const ox=pos.x-other.position.x,oy=pos.y-other.position.y,oz=pos.z-other.position.z;
        const od=Math.hypot(ox,oy,oz);
        if(od>.001&&od<.47){const f=(.47-od)/.47*strength;tx+=ox/od*f;ty+=oy/od*f;tz+=oz/od*f;}
      }
      // Route around the principal stone rather than swimming through its base.
      const rx=pos.x+1.3,rz=pos.z-.2,rad=Math.hypot(rx,rz);
      if(pos.y<1.5&&rad<1.05) {
        tx+=(rad>.01?rx/rad:1)*(1.05-rad)*1.8;
        tz+=(rad>.01?rz/rad:0)*(1.05-rad)*1.8;
        ty+=Math.max(0,1.35-pos.y)*.7;
      }
    }
    steer(a, tx, fish ? ty : 0, tz, dt, food ? 5 : 2.2);
    let stride = Math.min(wallStride(pos.x, vel.x, -3.65, 3.65), wallStride(pos.z, vel.z, -1.65, 1.65));
    if (fish) {
      const bottom = Math.max(FISH_MIN_Y, substrateHeight(pos.x,pos.z) + .17);
      stride = Math.min(stride, wallStride(pos.y, vel.y, bottom, 3.96));
    }
    pos.x += vel.x * dt * stride;
    pos.z += vel.z * dt * stride;
    const floor=substrateHeight(pos.x,pos.z)+(fish?.17:.025);
    pos.y=fish?clamp(pos.y+vel.y*dt*stride,Math.max(FISH_MIN_Y,floor),3.96):floor;
    if(food)consumePellet(state,a.id,food.id);
  }
}

/** Real seconds drive visibly continuous motion; ecology remains in simulated hours. */
export function advanceBehavior(state,realDtSeconds) {
  if(state.paused||!Number.isFinite(realDtSeconds)||realDtSeconds<=0)return state;
  state.foodPellets ||= [];
  let remaining=Math.min(realDtSeconds,30);
  const flow = (state.equipment?.filter !== false ? .78 : 0) + (state.equipment?.aerator !== false ? .22 : 0);
  state.currentSeconds = (state.currentSeconds ?? state.behaviorSeconds ?? 0) + remaining * flow;
  while(remaining>1e-9){const dt=Math.min(1/30,remaining);step(state,dt);remaining-=dt;}
  return state;
}
