import { makeResidentBox } from './resident-collisions.js';
import { substrateHeight } from './simulation.js';
import { grazerRetreating } from './grazer-steering.js';

const meals = new WeakMap();
const budgets = new WeakMap();
const spacing = .28;
const rowWidth = 1 + Math.ceil(3.3/spacing);
const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const site = (x,z) => ({ x, z, y: substrateHeight(x,z)+.025 });

export function aboveGrazerReach(food) {
  return food.y > substrateHeight(food.x,food.z)+.18;
}
function landingPoint(food) {
  return food.fastSinking && aboveGrazerReach(food) ? site(food.x,food.z) : food;
}

function canApproach(scene, animal, food) {
  const to=landingPoint(food);
  const from = animal.position, length = distance(from,to);
  // Leave the final reach to the mouth, including the unobstructed bite check.
  const travel = Math.max(0,length-.22);
  if (!scene.canGrazeFrom(animal,to)) return false;
  return travel < .001 || !scene.grazerObstacle(animal,(to.x-from.x)/length,(to.z-from.z)/length,travel);
}

function beginSearch(animal) {
  const start = { ...animal.position, ix:0, iz:0, heading:Math.atan2(animal.velocity.z,animal.velocity.x) };
  return { queue:[start], index:0, seen:new Set([0]), probe:{species:animal.species, size:animal.size,
    alive:true, position:start, velocity:{x:0,y:0,z:0}} };
}

// Only search after ordinary steering stops getting closer. Spread this work
// across strokes and share the budget among all hungry bottom dwellers.
function frameBudget(state) {
  let budget = budgets.get(state);
  if (!budget || budget.time !== state.behaviorSeconds) {
    budget = { time:state.behaviorSeconds, nodes:5, rays:5 };
    budgets.set(state,budget);
  }
  return budget;
}

function searchStep(state, scene, foods, meal) {
  const budget=frameBudget(state);
  const search = meal.search;
  const { queue, seen, probe } = search;
  const start=queue[0];
  for (let i=0; i<3 && budget.nodes>0 && search.index<queue.length; i++,budget.nodes--) {
    const here=queue[search.index++];
    probe.position=here;
    const food=foods.find(f=>distance(here,f)<=.42 && !failedApproach(meal,f,here,state.behaviorSeconds) &&
      canApproach(scene,probe,f));
    if (food) {
      const path=[];
      for(let node=here;node.parent;node=node.parent)path.push(node);
      meal.path=path.reverse();
      return food;
    }
    for(const [dx,dz] of directions) {
      const ix=here.ix+dx, iz=here.iz+dz, id=ix*rowWidth+iz;
      if(seen.has(id))continue;
      const x=start.x+ix*spacing, z=start.z+iz*spacing;
      if(Math.abs(x)>3.65 || Math.abs(z)>1.65)continue;
      const len=Math.hypot(dx,dz);
      probe.velocity.x=dx/len; probe.velocity.z=dz/len;
      // The entire shell or antennae must fit facing this edge, including
      // at the corner. A clear path for a point can still run through a rock.
      if (scene.overlaps(makeResidentBox(probe)) || scene.grazerObstacle(probe,dx/len,dz/len,len*spacing)) continue;
      // Between two clear headings a wide turn can still swing the feelers
      // into a corner. Also check the halfway pose, keeping the live animal still.
      const incoming = here.heading;
      const turn = Math.atan2(dz,dx)-incoming;
      const arc = Math.atan2(Math.sin(turn),Math.cos(turn));
      if (Math.abs(arc) > .4) {
        probe.velocity.x=Math.cos(incoming+arc/2); probe.velocity.z=Math.sin(incoming+arc/2);
        if (scene.overlaps(makeResidentBox(probe))) continue;
      }
      seen.add(id);
      queue.push({...site(x,z),ix,iz,parent:here,heading:Math.atan2(dz,dx)});
    }
  }
  if(search.index===queue.length) {
    meal.search=null; meal.food=null; meal.retry=state.behaviorSeconds+8;
  }
  return null;
}

function trackMeal(meal, food, animal, time, direct=false) {
  meal.food=food; meal.direct=direct;
  meal.best=distance(animal.position,meal.path?.[0]??food);
  meal.progress=time; meal.search=null;
  return food;
}

// A geometrically clear ray may still require an impossible turn at its
// start. Other approach angles, other grains and later retries remain open.
function failedApproach(meal, food, from, time) {
  const failed=meal.failed;
  return failed?.food===food && time<failed.until && distance(from,failed)<.5;
}

export function chooseGrazerFood(state, animal, reserved, scene) {
  const time=state.behaviorSeconds, pos=animal.position;
  let meal=meals.get(animal);
  if (!meal) {
    meal={assess:0, retry:0};
    meals.set(animal,meal);
  }
  const usable = food => food.mass>1e-10 && !reserved.has(food.id) &&
    (!aboveGrazerReach(food) || (food.fastSinking && distance(pos,food)<=1.2)) && !scene.blocksFood(food);
  const current=meal.food && state.foodPellets.includes(meal.food) && usable(meal.food) ? meal.food : null;
  if (!current) meal.path=null;
  if (!meal.search && time<meal.assess && current===meal.food) return current;
  // Backing a single body length out of a crevice can take over 15 s.
  const patience=animal.species==='snail' ? 35 : 24;
  if (current && !meal.search) {
    const remaining=distance(pos,meal.path?.[0]??current);
    if (remaining < meal.best-.04) { meal.progress=time; meal.best=remaining; }
  }
  const waiting=current?.fastSinking && aboveGrazerReach(current) && distance(pos,current)<.24;
  const stalled=current && !waiting && time-meal.progress>=patience && !grazerRetreating(animal);
  if (stalled && !meal.search) meal.failed={food:current,x:pos.x,z:pos.z,until:time+patience+8};
  // A pending search can reuse the snapshot for this stroke. Recheck live
  // claims and presence before a resident commits to the resulting meal.
  if (!meal.search || time>=meal.assess) {
    meal.assess=time+.7+.25*animal.seed;
    // Watch a visible sinking grain down to its landing spot. Another resident
    // can intercept it in the water column before it reaches the substrate.
    const budget=frameBudget(state);
    if (current && meal.direct && !stalled && !meal.search) {
      if (!budget.rays) return current;
      budget.rays--;
      if (canApproach(scene,animal,current)) return current;
      meal.direct=false;
    }
    const prior = current?.id ?? animal.targetFoodId;
    const score = food => distance(pos,food)*(food.id===prior ? .72 : 1);
    meal.candidates = state.foodPellets.filter(usable).sort((a,b)=>score(a)-score(b));
    // A newly settled grain on this side of a barrier is immediately useful.
    if (meal.first!==meal.candidates[0]) {meal.first=meal.candidates[0];meal.cursor=0;}
    let direct=null;
    const count=Math.min(3,budget.rays,meal.candidates.length);
    for (let i=0;i<count;i++) {
      budget.rays--;
      meal.cursor=(meal.cursor??0)%meal.candidates.length;
      const candidate=meal.candidates[meal.cursor++];
      if (!failedApproach(meal,candidate,pos,time) && canApproach(scene,animal,candidate)) {
        direct=candidate;break;
      }
    }
    if (direct) {
      // Re-observing the same grain counts as progress only if we moved.
      if (direct===current && !meal.path && !meal.search) {meal.direct=true;return current;}
      meal.path=null;return trackMeal(meal,direct,animal,time,true);
    }
  }
  const foods=meal.candidates;
  if (!foods.length) {meal.search=null;meal.food=null;return null;}
  if (!meal.search) {
    if (!current) {
      if (time<meal.retry) return null;
      // Only anticipate a suspended grain once its projected approach is clear.
      const settled=foods.find(f=>!aboveGrazerReach(f));
      if (!settled) {meal.food=null;return null;}
      meal.path=null;return trackMeal(meal,settled,animal,time);
    }
    if (!stalled) return current;
    meal.path=null;meal.search=beginSearch(animal);
  }
  const found=searchStep(state,scene,foods,meal);
  if (found) {
    if (usable(found) && state.foodPellets.includes(found)) return trackMeal(meal,found,animal,time);
    meal.path=null;
  }
  return meal.search ? current : null;
}

export function grazerMealTarget(animal, food, time) {
  const meal=meals.get(animal);
  if (!meal?.path || meal.food!==food) return landingPoint(food);
  while(meal.path.length && distance(animal.position,meal.path[0])<.14) {
    meal.path.shift();meal.best=Infinity;meal.progress=time;
  }
  return meal.path[0]??landingPoint(food);
}
