// Fictional aquarium events. All intervals and rates are in simulation hours.
export const INFECTIONS = Object.freeze({
  viral: { label: '病毒感染', onsetHours: 4, recoveryRate: .035 },
  bacterial: { label: '细菌感染', onsetHours: 2, recoveryRate: .05 },
});

const UINT32_RANGE = 2 ** 32;
const maxInterval = 40;

function nextRandom(clock) {
  clock.seed = (Math.imul(1664525, clock.seed) + 1013904223) >>> 0;
  return clock.seed / UINT32_RANGE;
}

export function createInfectionClock(now, seed = Math.floor(Math.random() * UINT32_RANGE)) {
  const clock = { seed, nextAtHours: now };
  clock.nextAtHours += 5 + 5 * nextRandom(clock);
  return clock;
}

export function restoreInfectionClock(raw, now, fallbackSeed) {
  if (!raw || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed >= UINT32_RANGE ||
      !Number.isFinite(raw.nextAtHours)) return createInfectionClock(now, fallbackSeed);
  return { seed: raw.seed, nextAtHours: Math.max(now, Math.min(now + maxInterval, raw.nextAtHours)) };
}

export function restoreInfection(raw) {
  if (!raw || !Object.hasOwn(INFECTIONS, raw.kind) || !Number.isFinite(raw.severity) || raw.severity <= 0) return null;
  return {
    kind: raw.kind,
    severity: Math.min(1, raw.severity),
    elapsedHours: Number.isFinite(raw.elapsedHours) ? Math.max(0, raw.elapsedHours) : 0,
    cared: raw.cared === true,
  };
}

export function startScheduledInfection(state, species) {
  const clock = state.infectionClock;
  if (state.elapsedHours + 1e-9 < clock.nextAtHours) return null;
  // Anchor the next roll to the previous deadline, independent of frame cadence.
  clock.nextAtHours += 20 + (maxInterval - 20) * nextRandom(clock);
  const candidates = state.animals.filter(a => a.alive && !a.infection && species[a.species].type === 'fish');
  if (candidates.length === 0) return null;
  const fish = candidates[Math.floor(nextRandom(clock) * candidates.length)];
  const kind = nextRandom(clock) < .5 ? 'viral' : 'bacterial';
  fish.infection = { kind, severity: .22 + .08 * nextRandom(clock), elapsedHours: 0, cared: false };
  return fish;
}

// Return the health damage rate while the case is active. Sanitary water and
// adequate food let an otherwise healthy fish recover from a mild episode.
export function advanceInfection(fish, water, hours) {
  const infection = fish.infection;
  const profile = INFECTIONS[infection.kind];
  const initialSeverity = infection.severity;
  infection.elapsedHours += hours;
  if (infection.cared) {
    infection.severity -= .14 * hours;
  } else if (fish.hunger >= 85 || water.oxygen < 4.6 || water.ammonia > .3 || water.nitrite > .12) {
    infection.severity += .065 * hours;
  } else {
    const onset = Math.min(hours, Math.max(0, profile.onsetHours - (infection.elapsedHours - hours)));
    infection.severity += .03 * onset - profile.recoveryRate * (hours - onset);
  }
  infection.severity = Math.max(0, Math.min(1, infection.severity));
  const severity = (initialSeverity + infection.severity) / 2;
  if (infection.severity === 0) fish.infection = null;
  return (.30 * severity + 3 * severity ** 3) * (infection.cared ? .35 : 1);
}
