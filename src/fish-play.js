import { SPECIES } from './simulation.js';

const interval = 24;
const maximumDuration = 3;
const random = value => {
  const n = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function canPlay(fish, unavailable) {
  return fish?.alive && SPECIES[fish.species]?.type === 'fish' && fish.health >= 65 &&
    fish.hunger >= 8 && fish.hunger < 65 && !fish.infection && !fish.biteFlash &&
    !fish.targetFoodId && !unavailable(fish);
}

// One invitation per window. Checking the crossing (rather than rolling each
// frame) makes both the chance to play and the quiet interval frame-rate independent.
function invite(animals, round, startsAt, unavailable) {
  const candidates = animals.filter(fish => canPlay(fish, unavailable)).map(fish => ({
    fish, roll: random(round + fish.seed * 13.7 + fish.serial * .49),
  })).sort((a,b) => a.roll - b.roll || a.fish.id.localeCompare(b.fish.id));
  for (const { fish: chaser } of candidates) {
    let runner = null, closest = 2;
    for (const { fish } of candidates) {
      if (fish === chaser || fish.species !== chaser.species) continue;
      const gap = distance(chaser.position, fish.position);
      if (gap > .25 && gap < closest) {
        runner = fish;
        closest = gap;
      }
    }
    if (runner) return { chaserId: chaser.id, runnerId: runner.id,
      endsAt: startsAt + 2 + random(round + runner.seed + chaser.seed) };
  }
  return null;
}

export function restorePlayBout(raw, animals, time) {
  if (!raw || !Number.isFinite(raw.endsAt) || raw.endsAt <= time || raw.endsAt > time + maximumDuration) return null;
  const chaser = animals.find(a => a.id === raw.chaserId);
  const runner = animals.find(a => a.id === raw.runnerId);
  if (!chaser?.alive || !runner?.alive || chaser === runner || chaser.species !== runner.species ||
      SPECIES[chaser.species]?.type !== 'fish') return null;
  return { chaserId: chaser.id, runnerId: runner.id, endsAt: raw.endsAt };
}

const neverBusy = () => false;

export function planFishPlay(state, dt, unavailable = neverBusy) {
  const time = state.behaviorSeconds;
  if (state.water.oxygen < 3) {
    delete state.playBout;
    return null;
  }
  if (!state.playBout) {
    const round = Math.floor(time / interval);
    const startsAt = round * interval + 6 + 10 * random(round + .47);
    if (startsAt > time || startsAt <= time - dt) return null;
    const bout = invite(state.animals, round, startsAt, unavailable);
    if (!bout) return null;
    state.playBout = bout;
  }

  const { chaserId, runnerId, endsAt } = state.playBout;
  const chaser = state.animals.find(a => a.id === chaserId);
  const runner = state.animals.find(a => a.id === runnerId);
  if (time >= endsAt || !canPlay(chaser, unavailable) || !canPlay(runner, unavailable) ||
      distance(chaser.position, runner.position) > 3) {
    delete state.playBout;
    return null;
  }

  const from = chaser.position, to = runner.position;
  const gap = Math.max(.05, distance(from, to));
  const dx = (to.x - from.x) / gap, dy = (to.y - from.y) / gap, dz = (to.z - from.z) / gap;
  const sidestep = runner.seed < .5 ? -.65 : .65;
  const escape = {
    x: clamp(to.x + 1.4 * dx - sidestep * dz, -3.15, 3.15),
    y: clamp(to.y + .65 * dy + .14, .95, 3.65),
    z: clamp(to.z + 1.4 * dz + sidestep * dx, -1.25, 1.25),
  };
  const follow = { x: to.x + .25 * runner.velocity.x, y: to.y + .25 * runner.velocity.y,
    z: to.z + .25 * runner.velocity.z };
  return new Map([
    [chaserId, { behavior: 'chasing', target: follow, speedMultiplier: 2.1 }],
    [runnerId, { behavior: 'darting', target: escape, speedMultiplier: 2 }],
  ]);
}
