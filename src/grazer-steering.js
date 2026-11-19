import { makeResidentBox } from './resident-collisions.js';

// Check the bottom at progressively larger turns from the food or grazing
// site. Precompute the rotations; the same fan also serves the opposite side.
const turns = [.26, .53, .80, 1.07, 1.40, 1.70, 2.06, 2.41, 2.78, Math.PI]
  .map(angle => ({ angle, cos: Math.cos(angle), sin: Math.sin(angle) }));
const routes = new WeakMap();

function random(seed) {
  const n = Math.sin(seed*127.1 + 311.7)*43758.5453;
  return n-Math.floor(n);
}

function probeSide(animal, scene, gx, gz, side, reach) {
  let best;
  for (const { angle, cos, sin } of turns) {
    const x = cos*gx - side*sin*gz, z = cos*gz + side*sin*gx;
    const hit = scene.grazerObstacle(animal, x, z, reach);
    const room = hit?.distance ?? reach;
    const heading = { x, z, side, room, angle };
    if (room >= reach*.96) return heading;
    if (!best || room > best.room+.01) best = heading;
  }
  return best;
}

function chooseBypass(animal, scene, gx, gz, side, reach) {
  const preferred = probeSide(animal, scene, gx, gz, side, reach);
  if (preferred.room >= reach*.65 && preferred.angle <= 2.06) return preferred;
  // The preferred end of the rock may be a blind gap against the pane.
  const other = probeSide(animal, scene, gx, gz, -side, reach);
  if (other.room > preferred.room+reach*.2 ||
      (other.room > reach*.85 && other.angle+.8 < preferred.angle)) return other;
  return preferred;
}

// A dead end has a pair of opposing side faces and a cap on the forward
// axis of the passage. Use that axis to back out even when food is off-centre.
function findDeadEnd(animal, scene, gx, gz, reach, time) {
  const velocity = animal.velocity, speed = Math.hypot(velocity.x, velocity.z);
  if (speed < .001) return null;
  const hx = velocity.x/speed, hz = velocity.z/speed;
  const width = .18*animal.size;
  const left = scene.grazerObstacle(animal, -hz, hx, width);
  if (!left) return null;
  const right = scene.grazerObstacle(animal, hz, -hx, width);
  if (!right || left.x*right.x + left.z*right.z > -.75) return null;
  let ax = left.z-right.z, az = right.x-left.x;
  const scale = (ax*hx + az*hz < 0 ? -1 : 1)/Math.hypot(ax, az);
  ax *= scale; az *= scale;
  if (ax*gx + az*gz < .25) return null;
  const cap = scene.grazerObstacle(animal, ax, az, reach);
  if (!cap || cap.x*ax + cap.z*az > -.6) return null;
  // A second rock or a pane just behind the tail can close this end too.
  // Commit to backing up only when there is room for a body length.
  const bodyLength = 2*makeResidentBox(animal).half[0];
  if (scene.grazerObstacle(animal, -ax, -az, bodyLength)) return null;
  const { x, z } = animal.position;
  return { ax, az, x, z, checkX: x, checkZ: z, checkTime: time };
}

function leaveDeadEnd(animal, scene, route, reach, time) {
  const e = route.retreat, { x, z } = animal.position;
  const dx = x-e.x, dz = z-e.z;
  const backed = -dx*e.ax - dz*e.az;
  const across = dz*e.ax - dx*e.az;
  if (Math.abs(across) >= reach*.95) return null;
  if (Math.hypot(x-e.checkX, z-e.checkZ) > .025) {
    e.checkX = x; e.checkZ = z; e.checkTime = time;
  } else if (time-e.checkTime > 3.5) {
    // A new neighbour or a moved decoration can also close the exit.
    route.retryAfter = time+4;
    route.side = -route.side;
    return null;
  }
  for (const side of [route.side, -route.side]) {
    const sx = -side*e.az, sz = side*e.ax;
    const hit = scene.grazerObstacle(animal, sx, sz, reach);
    if (hit && hit.distance <= reach*.85) continue;
    // There is space across the mouth. Clear the full body before pivoting:
    // the sideways feeler can emerge while the shell or antennae are inside.
    e.openAt ??= backed;
    if (backed < e.openAt + .45*animal.size) break;
    route.side = side;
    const length = Math.hypot(1,.65);
    return { x: (sx-.65*e.ax)/length, z: (sz-.65*e.az)/length };
  }
  return { x: -e.ax, z: -e.az, backing: true };
}

export function grazerRetreating(animal) {
  return Boolean(routes.get(animal)?.retreat);
}

export function steerGrazer(animal, scene, target, goal, speed, time) {
  if (!scene?.grazerObstacle) return;
  let route = routes.get(animal);
  if (!route) {
    route = { nextSense: 0, encounter: 0, side: 0, heading: null, lastHit: -Infinity };
    routes.set(animal, route);
  }
  const pos = animal.position;
  const dx = target.x-pos.x, dz = target.z-pos.z, distance = Math.hypot(dx, dz);
  // A stone beyond a morsel already in reach should not turn a grazer away.
  const remaining = distance - (animal.targetFoodId ? .23 : .035);
  if (route.food !== animal.targetFoodId || remaining < .01) {
    route.food = animal.targetFoodId;
    route.retreat = null;
    route.side = 0;
    route.heading = null;
    route.nextSense = time;
  }
  if (remaining < .01) return;
  if (time >= route.nextSense) {
    route.nextSense = time+.22;
    const reach = .32*animal.size + speed*1.4;
    // While rounding a wide rock the next stride may already be clear even
    // though cutting directly back towards the target would lead into it.
    const lookAhead = Math.min(remaining, route.heading ? reach+.7 : reach);
    const gx = dx/distance, gz = dz/distance;
    const hit = scene.grazerObstacle(animal, gx, gz, lookAhead);
    if (route.retreat) {
      route.heading = leaveDeadEnd(animal, scene, route, reach, time);
      if (!route.heading) route.retreat = null;
    }
    if (route.retreat) {
      route.lastHit = time;
    } else if (hit) {
      if (!route.side) {
        // Draw once for this encounter. A cautious animal turns early, while a
        // late responder still turns before touch. Keep its side through the turn.
        const seed = animal.seed*17 + ++route.encounter;
        route.side = random(seed) < .5 ? -1 : 1;
        route.notice = .47 + .53*random(seed+2.83);
        route.checkX = pos.x; route.checkZ = pos.z; route.checkTime = time;
      }
      route.lastHit = time;
      if (route.heading || hit.distance <= reach*route.notice) {
        if (Math.hypot(pos.x-route.checkX, pos.z-route.checkZ) > .07) {
          route.checkX = pos.x; route.checkZ = pos.z; route.checkTime = time;
        } else if (time-route.checkTime > 2+.24/speed) {
          route.side = -route.side;
          route.checkTime = time;
        }
        route.heading = chooseBypass(animal, scene, gx, gz, route.side, reach);
        route.side = route.heading.side;
        if (time >= (route.retryAfter ?? 0) && (route.heading.angle > .8 || route.heading.room < reach*.25)) {
          route.retreat = findDeadEnd(animal, scene, gx, gz, reach, time);
          if (route.retreat) route.heading = leaveDeadEnd(animal, scene, route, reach, time);
        }
      }
    } else if (time-route.lastHit > .5) {
      route.heading = null;
      if (time-route.lastHit > 2+.25/speed) route.side = 0;
    }
  }
  if (route.heading) {
    goal.x = speed*route.heading.x;
    goal.z = speed*route.heading.z;
    if (route.retreat) {
      const { ax, az } = route.retreat;
      const v = animal.velocity, length = Math.hypot(v.x,v.z);
      if (route.heading.backing && length > 1e-6) {
        goal.x = speed*v.x/length;
        goal.z = speed*v.z/length;
      }
      // Keep facing forward while taking small backward steps. Hand the
      // actual stroke to the same glass, substrate and body solver as a crawl.
      if (ax*v.x + az*v.z > .35*length) return { x: -.04*ax, y: 0, z: -.04*az };
    }
  }
}
