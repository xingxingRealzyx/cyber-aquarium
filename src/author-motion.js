import {
  Group, InstancedMesh, MathUtils, Object3D, ShaderMaterial, SphereGeometry,
  Vector3,
} from 'three';
import { MAX_TOYS } from './simulation.js';

const intake = new Vector3();
const lapSeconds = 33, tau = 2 * Math.PI;
const laneWidth = 2.72, laneDepth = 1.02;
const cycleLength = 28;
const breathStarts = [.9, 9.4, 16.1, 18.7];
const puffDelays = [0, .16, .37, .49];
const maxBubbleAge = 7;

const stationCount = 12;
const terrainCache = new WeakMap();

// Build the clearance profile once for all swimmers whenever the scenery changes.
// Include the head and fins, and start climbing before reaching each obstacle.
function terrainProfile(driftFloor, revision) {
  const previous = terrainCache.get(driftFloor);
  if (previous?.revision === revision) return previous.heights;
  const samplesPerStation = 8;
  const samples = Array.from({length: stationCount * samplesPerStation}, (_, i) => {
    const angle = tau * i / (stationCount * samplesPerStation);
    const x = laneWidth * Math.cos(angle), z = laneDepth * Math.sin(angle);
    const dx = laneWidth * Math.sin(angle), dz = -laneDepth * Math.cos(angle);
    const speed = Math.hypot(dx, dz);
    return .68 + Math.max(driftFloor(x, z), driftFloor(x + .62 * dx / speed, z + .62 * dz / speed),
      driftFloor(x - .86 * dx / speed, z - .86 * dz / speed));
  });
  const heights = Array.from({length: stationCount}, (_, i) => {
    let highest = 0;
    for (let offset = -samplesPerStation; offset <= samplesPerStation; offset++) {
      highest = Math.max(highest, samples[MathUtils.euclideanModulo(i * samplesPerStation + offset, samples.length)]);
    }
    return highest;
  });
  terrainCache.set(driftFloor, {revision, heights});
  return heights;
}

function lapPhase(age, slot) {
  return .34 - age / lapSeconds - slot * 5 / MAX_TOYS;
}

function surfaceAt(age, slot) {
  // The descent continues through the lap clock's zero, with level tangents
  // at both the breathing plateau and the return to cruising depth.
  const cycle = 6 + MathUtils.euclideanModulo(age + slot * 2.31 - 6, cycleLength);
  return MathUtils.smootherstep(cycle, 12, 21) * (1 - MathUtils.smootherstep(cycle, 22, 30));
}

function courseHeight(age, slot, level, previous, next, changedAt) {
  const station = lapPhase(age, slot) * stationCount;
  const index = Math.floor(station), t = station - index;
  const blend = previous === next ? 1 : MathUtils.smootherstep(age - changedAt, 0, 6);
  function clearance(offset) {
    const knot = MathUtils.euclideanModulo(index + offset, stationCount);
    const terrain = MathUtils.lerp(previous[knot], next[knot], blend);
    const clock = age + slot * 2.31 + (t - offset) * lapSeconds / stationCount;
    return Math.min(level - .52, Math.max(terrain, 1.59 + .39 * Math.sin(clock * .26) + .20 * (slot % 3)));
  }
  // Cubic B-spline: the route's height, slope and curvature continue through
  // every station, including where two rock or branch clearance bounds meet.
  const cruise = ((1 - t) ** 3 * clearance(-1) + (4 - 6 * t * t + 3 * t ** 3) * clearance(0)
    + (1 + 3 * t + 3 * t * t - 3 * t ** 3) * clearance(1) + t ** 3 * clearance(2)) / 6;
  return MathUtils.lerp(cruise, level - .30, surfaceAt(age, slot));
}

function bubbleMaterial() {
  // A clear center, bright rim and two curved reflections read as an air
  // bubble even against a bright desktop visible through the aquarium.
  return new ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.);
        vNormalView = normalMatrix * mat3(instanceMatrix) * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vNormalView;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormalView);
        float rim = pow(1. - max(dot(n, normalize(vView)), 0.), 1.35);
        float glint = smoothstep(.88, .99, dot(n, normalize(vec3(-.44,.55,.72))));
        glint += .4 * smoothstep(.91, .99, dot(n, normalize(vec3(.54,-.56,.61))));
        gl_FragColor = vec4(mix(vec3(.29,.57,.62), vec3(.96,1.,1.), min(1., rim + glint)),
                            min(.94, .12 + .72 * rim + .77 * glint));
        #include <colorspace_fragment>
      }`,
  });
}

// Keep the animated rig and its trail as siblings: a bubble stays in tank
// space after leaving the mouth, independently of the next kick or turn.
export function createAuthorDisplay(swimmer, animate, slot, level, driftFloor) {
  const group = new Group();
  const geometry = new SphereGeometry(1, 14, 10);
  const trail = new InstancedMesh(geometry, bubbleMaterial(), breathStarts.length * puffDelays.length);
  trail.frustumCulled = false;
  trail.count = 0;
  group.add(swimmer, trail);
  const dummy = new Object3D(), sample = new Vector3();
  const origins = new Map();
  let surfacing = 0;
  let previousTerrain, terrain, changedAt = 0;
  function height(age) {
    return courseHeight(age, slot, level, previousTerrain, terrain, changedAt);
  }
  function pose(age) {
    const angle = tau * lapPhase(age, slot);
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const dx = laneWidth * sine * tau / lapSeconds, dz = -laneDepth * cosine * tau / lapSeconds;
    const surface = surfaceAt(age, slot);
    // Uniform angular progress naturally slows the swimmer at each end.
    // A centered tangent follows slopes over a body length.
    const slope = (height(age + .8) - height(age - .8)) / 1.6;
    const pitch = .85 * Math.tanh(Math.atan2(slope, Math.hypot(dx, dz)) / .85) * (1 - surface ** 8);
    swimmer.position.set(laneWidth * cosine, height(age), laneDepth * sine);
    swimmer.rotation.set(-pitch, Math.atan2(dx, dz), (.07 + .06 * Math.sin(age * .63 + slot)) * (1 - surface), 'YXZ');
    animate(swimmer, age + slot * 1.37, surface);
    if (surface > 0) {
      swimmer.userData.snorkelTip.getWorldPosition(intake);
      swimmer.worldToLocal(intake);
      // The level breathing pose sets the target depth. Pitching down to dive
      // must not lift the hips to keep the tilted snorkel above the surface.
      swimmer.position.y += surface * (.30 + .055 - intake.y);
    }
    return surface;
  }

  function update(age, revision = 0) {
    const next = terrainProfile(driftFloor, revision);
    if (next !== terrain) {
      if (terrain) {
        const blend = MathUtils.smootherstep(age - changedAt, 0, 6);
        previousTerrain = terrain.map((h, i) => MathUtils.lerp(previousTerrain[i], h, blend));
      } else {
        previousTerrain = next;
      }
      terrain = next;
      changedAt = age;
    }
    // Reconstruct any in-flight bubbles on a cold load or large frame gap by
    // sampling the mouth pose at each emission. Cache only the active origins.
    for (const birth of origins.keys()) {
      if (age < birth || age - birth > maxBubbleAge) origins.delete(birth);
    }
    trail.count = 0;
    const cycle = Math.floor((age + slot * 2.31) / cycleLength);
    for (let lap = cycle - 1; lap <= cycle; lap++) {
      for (const burst of breathStarts) {
        const start = lap * cycleLength + burst - slot * 2.31;
        for (const [i, delay] of puffDelays.entries()) {
          const birth = start + delay;
          const life = age - birth;
          if (birth < 0 || life < 0 || life > maxBubbleAge) continue;
          let origin = origins.get(birth);
          if (!origin) {
            pose(birth);
            origin = swimmer.userData.mouth.getWorldPosition(new Vector3());
            group.worldToLocal(origin);
            origins.set(birth, origin);
          }
          const radius = .025 + .008 * (i % 3) + .002 * life;
          const y = origin.y + life * (.51 + i * .027 + .031 * life);
          if (y + radius >= level) continue;
          const drift = Math.min(1, life * 1.5);
          dummy.position.set(origin.x + drift * .036 * Math.sin(birth * 4 + life * 3),
            y, origin.z + drift * .026 * Math.cos(birth * 3 + life * 2));
          dummy.scale.set(radius, radius * (.91 + .07 * Math.sin(life * 6 + i)), radius);
          dummy.updateMatrix();
          trail.setMatrixAt(trail.count++, dummy.matrix);
        }
      }
    }
    surfacing = pose(age);
    trail.visible = trail.count > 0;
    if (trail.count) trail.instanceMatrix.needsUpdate = true;
  }

  function diagnostics() {
    const vector = ({x, y, z}) => ({x, y, z});
    const bubbles = [];
    for (let i = 0; i < trail.count; i++) {
      trail.getMatrixAt(i, dummy.matrix);
      bubbles.push(vector(trail.localToWorld(sample.setFromMatrixPosition(dummy.matrix))));
    }
    return {surfacing, mouth: vector(swimmer.userData.mouth.getWorldPosition(sample)),
      snorkelTip: vector(swimmer.userData.snorkelTip.getWorldPosition(sample)), bubbles};
  }

  group.userData.author = { swimmer, update, diagnostics };
  return group;
}
