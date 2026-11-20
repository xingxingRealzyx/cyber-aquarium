import { SPECIES, substrateHeight } from './simulation.js';

// Tank units. Near the edge of perception a neighbour's influence fades to zero.
const sight = 2.25;
const regroupSeconds = 3.5;

// Read every swimmer before any of them move. Food priority can then determine
// who eats first without determining which neighbours see a turn one step early.
export function sampleFish(animals) {
  return animals.filter(a => a.alive && SPECIES[a.species].type === 'fish').map(a => {
    const { x, y, z } = a.velocity;
    const speed = Math.max(.12, Math.hypot(x, y, z));
    return { animal: a, ...a.position, alarm:a.schoolAlarm, headingX: x / speed, headingY: y / speed, headingZ: z / speed };
  });
}

// A neighbour sees the start of a flight, rather than broadcasting an
// alarm every frame the diver happens to remain nearby.
export function signallingFish(neighbours, time) {
  return neighbours.filter(({alarm}) => alarm && alarm.hops<2 && time-alarm.started<=.55);
}

function flightEnd(alarm) {
  // Finish a short dodge even when only the tip of a fin was in view.
  return alarm.hops ? alarm.end : Math.max(alarm.end,alarm.started+.58);
}

export function restoreSchoolAlarm(raw, time) {
  if (!raw) return null;
  const {started,end,hops,strength,x,y,z} = raw;
  if (![started,end,strength,x,y,z].every(Number.isFinite) || ![0,1,2].includes(hops) ||
      started<0 || started>time || end<started || end>time+(hops ? 1.2 : 0)+1e-8 ||
      time-flightEnd(raw)>=regroupSeconds || strength<=0 || strength>1 || Math.abs(Math.hypot(x,y,z)-1)>.001) return null;
  return {started,end,hops,strength,x,y,z};
}

export function schoolResponse(fish, signals, author, time, dt, canStartle) {
  let alarm=fish.schoolAlarm;
  if (alarm && time-flightEnd(alarm)>=regroupSeconds) {
    delete fish.schoolAlarm;
    alarm=null;
  }
  const sawDiver=alarm ? alarm.hops===0 && time-alarm.end<=dt+1e-6 : fish.behavior==='evading';
  if (author && author.distance<(sawDiver ? 1.32 : 1.15)) {
    if (!alarm || alarm.hops!==0) {
      const length=Math.hypot(author.x,author.y,author.z);
      const heading=fish.seed*2*Math.PI;
      alarm=fish.schoolAlarm={started:time,end:time,hops:0,strength:1,
        x:length ? author.x/length : Math.cos(heading), y:length ? author.y/length : 0,
        z:length ? author.z/length : Math.sin(heading)};
    }
    alarm.end=time;
    return {escape:author, urgency:Math.max(0,1-author.distance/1.15), direct:true};
  }
  if (!canStartle) return null;
  if (!alarm) {
    const reach=.75+.82*SPECIES[fish.species].schoolAffinity;
    for (const peer of signals) {
      if (peer.animal===fish || peer.animal.species!==fish.species) continue;
      const dx=fish.position.x-peer.x, dy=fish.position.y-peer.y, dz=fish.position.z-peer.z;
      const gap=Math.hypot(dx,dy,dz);
      if (gap>=reach || time-peer.alarm.started<.12+.14*gap) continue;
      const strength=peer.alarm.strength*.82*(1-.35*gap/reach);
      if (alarm && alarm.strength>=strength) continue;
      // The observed heading leads the response, with some room to fan out.
      const spread=.28/Math.max(.1,gap);
      const x=peer.alarm.x+dx*spread, y=peer.alarm.y+dy*spread, z=peer.alarm.z+dz*spread;
      const norm=Math.hypot(x,y,z);
      alarm={started:time,end:time+.48+.62*strength,hops:peer.alarm.hops+1,strength,x:x/norm,y:y/norm,z:z/norm};
    }
    if (alarm) fish.schoolAlarm=alarm;
  }
  if (!alarm) return null;
  const until=flightEnd(alarm);
  if (time<until) return {escape:alarm,urgency:alarm.hops ? alarm.strength : .55,direct:alarm.hops===0};
  const age=time-until;
  return {regroup:Math.min(1,age/.5,(regroupSeconds-age)/1.2)};
}

export function applySchoolSteering(fish, neighbours, goal, speed, affinity, atFood, regroup=0) {
  const pos = fish.position, v = fish.velocity;
  // Schoolmates can feed side by side. Ease out the extra cruising margin
  // as they descend the last half unit, keeping the hard body contacts.
  const nearSand = atFood ? Math.max(0,Math.min(1,(substrateHeight(pos.x,pos.z)+.95-pos.y)/.53)) : 0;
  const velocityLength = Math.max(.12, Math.hypot(v.x, v.y, v.z));
  const reach=sight+1.35*regroup;
  let followX = 0, followY = 0, followZ = 0, weightSum = 0;
  let awayX = 0, awayY = 0, awayZ = 0;
  for (const peer of neighbours) {
    if (peer.animal === fish) continue;
    const dx = peer.x - pos.x, dy = peer.y - pos.y, dz = peer.z - pos.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= reach) continue;
    // Longitudinal spacing gives a following fish room to turn. Side by side,
    // schoolmates can still swim close together without touching.
    const alongFish = Math.abs(dx * v.x + dy * v.y + dz * v.z) / velocityLength;
    const alongPeer = Math.abs(dx * peer.headingX + dy * peer.headingY + dz * peer.headingZ);
    const alignment = Math.max(alongFish, alongPeer) / Math.max(distance, .00001);
    const spacing = (.16 + (.36 + .25 * alignment) * (fish.size + peer.animal.size)) * (1-.44*nearSand);
    if (distance < spacing) {
      // Give even two newly hatched fish at exactly the same point opposite exits.
      if (distance < .00001) {
        awayZ += fish.id < peer.animal.id ? -1 : 1;
      } else {
        const repulsion = (1 - distance / spacing) / distance;
        awayX -= dx * repulsion;
        awayY -= dy * repulsion;
        awayZ -= dz * repulsion;
      }
    }
    if (!affinity || peer.animal.species !== fish.species) continue;
    const weight = 1 - distance / reach;
    // Match headings at comfortable spacing. Outside that spacing, also
    // steer towards the neighbours' positions to close the gap.
    const pull = distance > spacing ? (1 - spacing / distance)*(1+1.5*regroup) : 0;
    followX += weight * (peer.headingX + dx * pull);
    followY += weight * (peer.headingY + dy * pull);
    followZ += weight * (peer.headingZ + dz * pull);
    weightSum += weight;
  }

  if (weightSum > 0) {
    // Let the individual route lead the turn before a school reaches the glass.
    const margin = Math.min(3.65 - Math.abs(pos.x + v.x), 1.65 - Math.abs(pos.z + v.z),
      3.96 - (pos.y + v.y), pos.y + v.y - .67);
    const blend = (affinity+(1-affinity)*regroup*.8) * Math.min(1,weightSum*(1+regroup)) * Math.max(0, Math.min(1, margin / .75));
    const scale = speed / Math.max(weightSum, Math.hypot(followX, followY, followZ));
    goal.x += blend * (followX * scale - goal.x);
    goal.y += blend * (followY * scale - goal.y);
    goal.z += blend * (followZ * scale - goal.z);
  }
  const pace = nearSand ? Math.min(speed,Math.hypot(goal.x,goal.y,goal.z)) : speed;
  const push = pace * (atFood ? .45 : 1.8) / Math.max(1, Math.hypot(awayX, awayY, awayZ));
  goal.x += awayX * push;
  goal.y += awayY * push;
  goal.z += awayZ * push;
  return weightSum > 0;
}
