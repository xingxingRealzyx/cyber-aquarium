import { EllipseCurve, Vector2, Vector3 } from 'three';
import { MAX_TOYS, TOYS } from './simulation.js';
import { sampleWaterSurface } from './water-light.js';

// Arc-length sampling keeps even the tight ends of the circulation loop wide
// enough for neighbouring toys. Successive placements start far apart.
const currentLoop = new EllipseCurve(0, 0, 2.86, 1.13);
const point = new Vector2(), wave = new Vector3();
const tau = 2 * Math.PI;

export function floatOnSurface(model, x, z, waterLevel, time, yaw) {
  sampleWaterSurface(x, z, time, wave);
  model.position.set(x, waterLevel + wave.x, z);
  model.rotation.set(-Math.atan(wave.z), yaw, Math.atan(wave.y), 'ZXY');
}

export function poseToy(model, toy, time, waterLevel, driftFloor) {
  const onSurface = TOYS[toy.kind].surface;
  const slot = onSurface ? (toy.surfaceSlot ?? toy.slot) : toy.slot;
  const phase = time / (onSurface ? 139 : 151) + slot * 5 / MAX_TOYS + (onSurface ? .29 : .19);
  currentLoop.getPointAt(phase - Math.floor(phase), point);
  const x = point.x + .18 * Math.sin(time * .081 + point.y * .7);
  const z = point.y + .21 * Math.sin(time * .065 + point.x * .73);
  const swirl = tau * phase + .32 * Math.sin(time * .12 + slot);
  if (onSurface) {
    const yaw = toy.kind === 'swimRing' ? swirl : -.25 + .8 * Math.sin(swirl);
    floatOnSurface(model,x,z,waterLevel,time,yaw);
    return;
  }

  // A neutrally buoyant body follows the rising and returning portions of the
  // flow without propulsion. Keep its fins above scenery and its helmet below
  // the draft of even a fully loaded surface lane.
  const ceiling = waterLevel - .66;
  const floor = Math.min(ceiling, driftFloor(x, z) + .53);
  const lift = .5 + .5 * Math.sin(time * .113 + toy.slot * 2.4 + .26 * Math.sin(swirl));
  model.position.set(x, floor + lift * (ceiling - floor), z);
  model.rotation.set(.11 * Math.sin(swirl), .32 + .88 * Math.sin(swirl * 1.04),
    .15 * Math.sin(time * .13 + toy.slot), 'ZXY');
}
