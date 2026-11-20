import { FISH_PROFILES } from './fish-profiles.js';

// Match the rendered head attitude (local +X points through the lips).
export function fishMouth(animal, position=animal.position, velocity=animal.velocity ?? {x:1,y:0,z:0}) {
  const profile=FISH_PROFILES[animal.species], size=animal.size ?? 1;
  const yaw=Math.atan2(velocity.z,velocity.x);
  const pitch=Math.max(-.85,Math.min(.85,Math.atan2(velocity.y,Math.hypot(velocity.x,velocity.z))));
  const horizontal=Math.cos(pitch), vertical=Math.sin(pitch);
  const fx=horizontal*Math.cos(yaw), fy=vertical, fz=horizontal*Math.sin(yaw);
  const lift=((profile.noseLift ?? .012)-profile.length*.016)*size;
  return {x:position.x+profile.nose*size*fx-lift*vertical*Math.cos(yaw),
    y:position.y+profile.nose*size*fy+lift*horizontal,
    z:position.z+profile.nose*size*fz-lift*vertical*Math.sin(yaw), fx,fy,fz};
}

export const suctionReach = a => .034 + (a.size ?? 1)*FISH_PROFILES[a.species].length*.21;
const lipRadius = a => .011 + (a.size ?? 1)*FISH_PROFILES[a.species].width*.18;

export function mouthAtFood(a, food, scene, contactOnly=false, position=a.position, velocity=a.velocity) {
  const m=fishMouth(a,position,velocity), dx=food.x-m.x,dy=food.y-m.y,dz=food.z-m.z;
  const dist=Math.hypot(dx,dy,dz), lip=lipRadius(a), along=dx*m.fx+dy*m.fy+dz*m.fz;
  if (dist>(contactOnly ? lip : suctionReach(a)) || along < -lip ||
      dist*dist-along*along > (lip + Math.max(0,along)*.85)**2) return null;
  // Also reject a legacy pose with the snout already on the far side of a solid.
  if (scene?.blocksFood?.(food) || scene?.canGrazeFrom?.({position},m)===false ||
      scene?.canGrazeFrom?.({position:m},food)===false) return null;
  return m;
}

// An approaching fish draws the grain through the final few centimetres of
// water. Calories and nitrogen transfer only once the particle reaches its lips.
export function drawFood(a, food, seconds, scene) {
  if (a.biteCooldown>0) return;
  const m=mouthAtFood(a,food,scene);
  if (!m) return;
  const dx=m.x-food.x,dy=m.y-food.y,dz=m.z-food.z;
  const dist=Math.hypot(dx,dy,dz), reach=suctionReach(a);
  const speed=reach*(6+12*(1-Math.min(1,dist/reach)));
  const fraction=Math.min(1,speed*seconds/Math.max(1e-8,dist));
  food.x+=fraction*dx;food.y+=fraction*dy;food.z+=fraction*dz;
}

// Center position and heading for an actual mouth-first approach. Offset the
// body upstream and above a bottom grain so its belly has room over the sand.
export function feedingPose(a,food,yaw,pitch) {
  const forward={x:Math.cos(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:Math.sin(yaw)*Math.cos(pitch)};
  const offset=fishMouth(a,{x:0,y:0,z:0},forward);
  const gap=.82*suctionReach(a);
  return {point:{x:food.x-offset.x-gap*forward.x,y:food.y-offset.y-gap*forward.y,z:food.z-offset.z-gap*forward.z}, forward};
}
