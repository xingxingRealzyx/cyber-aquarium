import { SPECIES } from './simulation.js';

// Tank units. Near the edge of perception a neighbour's influence fades to zero.
const sight = 2.25;

// Read every swimmer before any of them move. Food priority can then determine
// who eats first without determining which neighbours see a turn one step early.
export function sampleFish(animals) {
  return animals.filter(a => a.alive && SPECIES[a.species].type === 'fish').map(a => {
    const { x, y, z } = a.velocity;
    const speed = Math.max(.12, Math.hypot(x, y, z));
    return { animal: a, ...a.position, headingX: x / speed, headingY: y / speed, headingZ: z / speed };
  });
}

export function applySchoolSteering(fish, neighbours, goal, speed, affinity, atFood) {
  const pos = fish.position, v = fish.velocity;
  const velocityLength = Math.max(.12, Math.hypot(v.x, v.y, v.z));
  let followX = 0, followY = 0, followZ = 0, weightSum = 0;
  let awayX = 0, awayY = 0, awayZ = 0;
  for (const peer of neighbours) {
    if (peer.animal === fish) continue;
    const dx = peer.x - pos.x, dy = peer.y - pos.y, dz = peer.z - pos.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= sight) continue;
    // Longitudinal spacing gives a following fish room to turn. Side by side,
    // schoolmates can still swim close together without touching.
    const alongFish = Math.abs(dx * v.x + dy * v.y + dz * v.z) / velocityLength;
    const alongPeer = Math.abs(dx * peer.headingX + dy * peer.headingY + dz * peer.headingZ);
    const alignment = Math.max(alongFish, alongPeer) / Math.max(distance, .00001);
    const spacing = .16 + (.36 + .25 * alignment) * (fish.size + peer.animal.size);
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
    const weight = 1 - distance / sight;
    // Match headings at comfortable spacing. Outside that spacing, also
    // steer towards the neighbours' positions to close the gap.
    const pull = distance > spacing ? 1 - spacing / distance : 0;
    followX += weight * (peer.headingX + dx * pull);
    followY += weight * (peer.headingY + dy * pull);
    followZ += weight * (peer.headingZ + dz * pull);
    weightSum += weight;
  }

  if (weightSum > 0) {
    // Let the individual route lead the turn before a school reaches the glass.
    const margin = Math.min(3.65 - Math.abs(pos.x + v.x), 1.65 - Math.abs(pos.z + v.z),
      3.96 - (pos.y + v.y), pos.y + v.y - .67);
    const blend = affinity * Math.min(1, weightSum) * Math.max(0, Math.min(1, margin / .75));
    const scale = speed / Math.max(weightSum, Math.hypot(followX, followY, followZ));
    goal.x += blend * (followX * scale - goal.x);
    goal.y += blend * (followY * scale - goal.y);
    goal.z += blend * (followZ * scale - goal.z);
  }
  const push = speed * (atFood ? .45 : 1.8) / Math.max(1, Math.hypot(awayX, awayY, awayZ));
  goal.x += awayX * push;
  goal.y += awayY * push;
  goal.z += awayZ * push;
  return weightSum > 0;
}
