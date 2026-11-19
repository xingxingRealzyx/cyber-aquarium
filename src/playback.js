import { advanceBehavior } from './behavior.js';
import { advanceFastFeeding } from './fast-feeding.js';
import { placeNewResidents } from './resident-collisions.js';
import { advanceSimulation } from './simulation.js';

export const playbackSpeeds = [1, 2, 4, 60, 3600];
export const isFastForward = speed => speed > 4;

// Use short, swept scenery intervals as well as the smaller contact steps
// inside advanceBehavior. A fast render frame can span several strokes.
export function advancePlayback(state, wallSeconds, prepareCollisions) {
  if (state.paused || !Number.isFinite(wallSeconds) || wallSeconds <= 0) return 0;
  const wall = Math.min(wallSeconds, 1);
  if (isFastForward(state.speed)) {
    const duration = wall * state.speed;
    // The background uses the fixed geometry shown in the held frame. Give
    // feeding the full tank interval, including time between feeding bouts.
    const scene = prepareCollisions(state, 0);
    function advanceEcology(seconds) {
      const firstNew = state.animals.length;
      advanceSimulation(state, seconds / 3600);
      if (state.animals.length > firstNew) placeNewResidents(state, firstNew, scene?.overlaps);
    }
    for (let start = 0; start < duration; start += 60) {
      advanceFastFeeding(state, Math.min(60, duration - start), scene, advanceEcology);
    }
    return duration;
  }
  const motion = Math.min(wall, .1) * state.speed;
  const count = Math.max(1, Math.ceil(motion / (1 / 15)));
  const step = motion / count;
  for (let i = 0; i < count; i++) {
    const previousCount = state.animals.length;
    advanceSimulation(state, step / 3600);
    const scene = prepareCollisions(state, step);
    if (state.animals.length > previousCount) placeNewResidents(state, previousCount, scene?.overlaps);
    advanceBehavior(state, step, scene);
  }
  return motion;
}
