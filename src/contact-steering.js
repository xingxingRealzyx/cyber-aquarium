// Contact never moves a resident, it only holds it back. A resident that was
// held back steers along whatever stopped it, and keeps doing so for a moment
// after the contact clears, so that its route does not swing straight back
// into the same stone, pane or neighbour on the next step.
// In a pocket between two stones, each step may be stopped by a different
// face, so remember every face touched recently, not just the latest one.
const holds = new WeakMap();
export function holdBack(animal, exit, time) {
  let hold = holds.get(animal);
  if (!hold) holds.set(animal, hold = { faces: [], side: animal.seed < .5 ? -1 : 1 });
  // A neighbour usually moves on by itself; a stone or a pane stays put.
  const until = time + (exit.resident ? .25 : 1);
  const same = hold.faces.find(f => f.x*exit.x + f.y*exit.y + f.z*exit.z > .9);
  if (same) Object.assign(same, { x: exit.x, y: exit.y, z: exit.z, until });
  else hold.faces.push({ x: exit.x, y: exit.y, z: exit.z, until });
}

export function steerClear(animal, goal, speed, time, fish) {
  const hold = holds.get(animal);
  if (!hold) return false;
  hold.faces = hold.faces.filter(f => time <= f.until);
  if (!hold.faces.length) { holds.delete(animal); return false; }
  const faces = [];
  for (const f of hold.faces) {
    const y = fish ? f.y : 0, length = Math.hypot(f.x, y, f.z);
    if (length > .2) faces.push([f.x/length, y/length, f.z/length]);
  }
  const into = ([x,y,z]) => -(goal.x*x + goal.y*y + goal.z*z);
  // Even a clear heading may still have to rotate its fins past this face.
  if (!faces.some(f => into(f) > 0)) return true;
  const pace = Math.hypot(goal.x, goal.y, goal.z);
  let tx = goal.x, ty = goal.y, tz = goal.z;
  for (let pass = 0; pass < 3; pass++) for (const [x,y,z] of faces) {
    const inward = -(tx*x + ty*y + tz*z);
    if (inward > 0) { tx += inward*x; ty += inward*y; tz += inward*z; }
  }
  let ox = 0, oy = 0, oz = 0;
  for (const [x,y,z] of faces) { ox += x; oy += y; oz += z; }
  const out = Math.hypot(ox, oy, oz);
  const normalScale = Math.max(1,out);
  ox /= normalScale; oy /= normalScale; oz /= normalScale;
  if (Math.hypot(tx, ty, tz) < .3 * pace) {
    if (faces.length > 1 && out > .5) {
      // Every way along is blocked: back out of the pocket.
      [tx, ty, tz] = [ox, oy, oz];
    } else if (out < .1) {
      // Opposite normals cancel in a narrow channel. Keep the open component
      // of the route, or try stable directions when the fish is exactly head-on.
      if (Math.hypot(tx, ty, tz) <= 1e-6 * pace) {
        const candidates = [[0,0,hold.side], [hold.side,0,0], [0,0,-hold.side], [-hold.side,0,0]];
        if (fish) candidates.push([0,1,0], [0,-1,0]);
        let best = 0;
        tx = ty = tz = 0;
        for (let [x,y,z] of candidates) {
          for (const [nx,ny,nz] of faces) {
            const inward = -(x*nx + y*ny + z*nz);
            if (inward > 0) { x += inward*nx; y += inward*ny; z += inward*nz; }
          }
          const free = Math.hypot(x,y,z);
          if (free > best && faces.every(([nx,ny,nz]) => x*nx + y*ny + z*nz >= -1e-6)) {
            best = free; tx = x; ty = y; tz = z;
          }
        }
      }
    } else {
      // Head-on, the route has no preferred side. Keep to one, away from glass.
      const across = Math.hypot(ox, oz);
      [tx, ty, tz] = across > .2 ? [-oz*hold.side/across, 0, ox*hold.side/across] : [hold.side, 0, 0];
      const p = animal.position;
      const overhang = side => Math.max(0,Math.abs(p.x + side*.3*tx)-3.65)
        + Math.max(0,Math.abs(p.z + side*.3*tz)-1.65);
      if (overhang(1) > overhang(-1) + 1e-6) {
        hold.side = -hold.side; tx = -tx; tz = -tz;
      }
    }
  }
  const tangentLength = Math.hypot(tx, ty, tz);
  const scale = tangentLength > 1e-8 ? pace / tangentLength : 0;
  goal.x = tx*scale + ox*.3*speed;
  goal.y = ty*scale + oy*.3*speed;
  goal.z = tz*scale + oz*.3*speed;
  return true;
}
