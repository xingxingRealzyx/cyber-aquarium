import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToyMaterial } from './toy-materials.js';

function oval(x, y, z, rx, ry, rz, tilt = 0) {
  const radius = Math.max(rx, ry, rz);
  const segments = radius < .018 ? 8 : radius < .09 ? 18 : 36;
  return new THREE.SphereGeometry(1, segments, Math.ceil(segments * .6))
    .scale(rx, ry, rz).rotateZ(tilt).translate(x, y, z);
}

function ovalBetween(start, end, width, depth) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const center = a.lerp(b, .5);
  return new THREE.SphereGeometry(1, 16, 12).scale(width, length * .5, depth)
    .applyQuaternion(rotation).translate(center.x, center.y, center.z);
}

function hose(points, radius) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return new THREE.TubeGeometry(path, 18, radius, 8, false);
}

// Lift and narrow the stern into the little pointed tail of a molded bath duck.
function duckBody() {
  const body = new THREE.SphereGeometry(1, 40, 26);
  const points = body.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const tail = Math.pow(Math.max(0, -x), 3);
    points.setXYZ(i, x * .28 - .035 - .048 * tail,
      .045 + y * .147 * (1 - .34 * tail) + .135 * tail, z * .166 * (1 - .32 * tail));
  }
  body.computeVertexNormals();
  return body;
}

function duckWing(side) {
  const wing = new THREE.SphereGeometry(1, 40, 32);
  const points = wing.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    // Two shallow grooves fan out towards the tail in the molded vinyl.
    const fan = .18 + .32 * (1 - x);
    const distance = Math.min(Math.abs(y - fan), Math.abs(y + fan));
    const groove = .011 * Math.exp(-90 * distance * distance)
      * THREE.MathUtils.smoothstep(-x, -.45, .35) * Math.max(0, side * z);
    points.setXYZ(i, -.070 + x * .151, .076 + y * (.061 + x * .018) - .021 * x,
      side * (.150 - groove) + z * .035);
  }
  wing.computeVertexNormals();
  return wing;
}

function buildDuck(paint) {
  paint(duckBody(), '#f9bd19');
  paint(oval(.145, .239, 0, .152, .161, .141, -.08), '#ffcb27');
  for (const side of [-1, 1]) {
    paint(duckWing(side), '#ffc32a');
    paint(oval(.212, .276, side * .121, .024, .028, .012), '#27211b', 'glass');
    paint(oval(.219, .285, side * .132, .006, .007, .003), '#f8f4df', 'glass');
  }
  // Separate the two bill lobes with a thin painted mouth line.
  paint(oval(.303, .205, 0, .087, .026, .087, -.035), '#c65514');
  paint(oval(.309, .217, 0, .091, .016, .089, -.025), '#974615');
  paint(oval(.311, .233, 0, .099, .030, .090, -.04), '#ff8c1e');
  for (const side of [-1, 1]) {
    paint(oval(.328, .259, side * .039, .009, .003, .005), '#b36120');
  }
}

function buildSwimRing(paint, color) {
  const radius = .26, tube = .105, centerY = .026;
  const quarter = Math.PI / 2, stripe = quarter * .29;
  // Adjacent arcs meet on the same tube cross-section, so the print follows
  // the vinyl all the way around the inside of the opening.
  function panel(start, arc, segments, ink) {
    const geometry = new THREE.TorusGeometry(radius, tube, 20, segments, arc);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (start + arc * uv.getX(i)) / (2 * Math.PI));
    geometry.rotateZ(start).rotateX(-Math.PI / 2).scale(1, .78, 1).translate(0, centerY, 0);
    paint(geometry, ink, 'pvc');
    // The two pressed PVC shells leave a shallow weld along the outer rim.
    const weld = new THREE.TorusGeometry(radius + tube - .001, .005, 8, segments, arc);
    weld.rotateZ(start).rotateX(-Math.PI / 2).scale(1, .64, 1).translate(0, centerY, 0);
    paint(weld, ink, 'pvc');
  }
  for (let i = 0; i < 4; i++) {
    const start = quarter * i;
    panel(start, stripe, 6, '#fff4d8');
    panel(start + stripe, quarter - stripe, 14, color);
  }
  // A small inflation valve sits flush on the crown of one colored panel.
  const x = radius * Math.cos(.93), z = -radius * Math.sin(.93);
  const crown = centerY + tube * .78;
  paint(oval(x, crown, z, .026, .006, .026), '#e5d8b9', 'pvc');
  paint(oval(x, crown + .006, z, .016, .005, .016), '#fff4d8', 'pvc');
}

function shoulderStrap(side) {
  const path = new THREE.CatmullRomCurve3([
    [.075, -.096, .079], [.085, .013, .081], [.097, .083, .078],
    [.100, .125, .029], [.098, .128, -.028], [.087, .068, -.085], [.073, -.060, -.099],
  ].map(([x,y,z]) => new THREE.Vector3(x * side,y,z)));
  const strap = new THREE.BoxGeometry(.033, 1, .007, 1, 24, 1);
  const points = strap.attributes.position;
  const center = new THREE.Vector3(), tangent = new THREE.Vector3();
  for (let i = 0; i < points.count; i++) {
    const t = points.getY(i) + .5, thickness = points.getZ(i);
    path.getPoint(t, center);
    path.getTangent(t, tangent);
    points.setXYZ(i, center.x + points.getX(i),
      center.y - tangent.z * thickness, center.z + tangent.y * thickness);
  }
  strap.computeVertexNormals();
  return strap;
}

function buildDiver(paint) {
  const suit = '#287c76', panels = '#388f83', rubber = '#233b40', brass = '#cca050';
  const copper = '#b46b32', lens = '#204e5a';

  // Neutrally posed, with a molded suit, gloves and flippers all fixed in place.
  paint(oval(0, -.027, 0, .135, .197, .092), suit, 'canvas');
  paint(oval(0, .055, .004, .158, .084, .092), panels, 'canvas');
  paint(new THREE.CylinderGeometry(.138, .128, .036, 28).scale(1, 1, .72).translate(0, -.095, 0), rubber, 'rubber');
  paint(oval(0, -.095, .095, .039, .021, .009), brass, 'brass');

  for (const side of [-1, 1]) {
    paint(shoulderStrap(side), '#455344', 'canvas');
    for (const y of [.023, .037]) {
      paint(new THREE.BoxGeometry(.037, .005, .007).translate(side * .088, y, .085), brass, 'brass');
    }
    paint(ovalBetween([side * .108, .099, 0], [side * .195, -.055, .015], .052, .053), suit, 'canvas');
    paint(ovalBetween([side * .190, -.027, .011], [side * .196, -.118, .083], .042, .044), panels, 'canvas');
    paint(oval(side * .195, -.114, .084, .044, .053, .043), rubber, 'rubber');

    paint(ovalBetween([side * .056, -.109, -.008], [side * .093, -.296, .020], .061, .064), suit, 'canvas');
    paint(ovalBetween([side * .091, -.253, .017], [side * .114, -.407, -.019], .046, .049), panels, 'canvas');
    paint(oval(side * .115, -.397, .005, .055, .045, .074), rubber, 'rubber');
    const flipper = new THREE.SphereGeometry(1, 18, 10);
    const blade = flipper.attributes.position;
    for (let i = 0; i < blade.count; i++) {
      const z = blade.getZ(i);
      // Widen the blade toward the toe; keep a snug heel under the boot.
      blade.setXYZ(i, blade.getX(i) * (.059 + z * .036),
        blade.getY(i) * .018 - z * .008, .11 + z * .141);
    }
    flipper.computeVertexNormals();
    paint(flipper.rotateY(side * .16).translate(side * .115, -.417, -.012), '#d3a23e', 'rubber');
  }

  paint(oval(0, -.006, -.108, .087, .166, .075), '#c89c4d', 'brass');
  for (const y of [-.069, .063]) {
    paint(new THREE.CylinderGeometry(.086, .086, .028, 24).scale(1, 1, .86).translate(0, y, -.107), rubber, 'rubber');
  }

  // A rolled neck seal and riveted copper helmet with three inset portholes.
  paint(oval(0, .123, 0, .162, .048, .128), copper, 'brass');
  paint(new THREE.TorusGeometry(.128, .014, 8, 28).rotateX(Math.PI / 2).translate(0, .143, 0), brass, 'brass');
  paint(oval(0, .272, 0, .170, .166, .150), copper, 'brass');
  for (const side of [-1, 1]) {
    paint(oval(side * .156, .266, -.002, .017, .064, .062), lens, 'glass');
    paint(new THREE.TorusGeometry(.060, .010, 8, 24).rotateY(Math.PI / 2)
      .translate(side * .165, .266, -.002), brass, 'brass');
    paint(oval(side * .056, .431, -.006, .015, .012, .015), brass, 'brass');
  }

  paint(oval(0, .275, .132, .113, .100, .027), rubber, 'rubber');
  paint(oval(0, .275, .148, .091, .080, .023), lens, 'glass');
  paint(new THREE.TorusGeometry(.096, .014, 10, 32).scale(1.05, .92, 1).translate(0, .275, .156), brass, 'brass');
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    paint(oval(Math.cos(angle) * .099, .275 + Math.sin(angle) * .087, .168, .006, .006, .004), '#ead194', 'brass');
  }
  // Slender grille bars bow over the curved glass.
  for (const x of [-.031, .031]) {
    paint(hose([[x, .198, .151], [x, .275, .174], [x, .352, .150]], .0036), brass, 'brass');
  }
  paint(hose([[.082, .159, .063], [.132, .119, .087], [.167, .054, .059],
    [.175, .049, -.064], [.065, .127, -.120]], .014), rubber, 'rubber');
}

export function createToyModel(kind, color = '#369cd9', manager) {
  const group = new THREE.Group();
  group.name = kind;
  // Merge rigid parts by finish. Each instance owns only its final GPU meshes.
  const batches = new Map();
  function paint(geometry, hex, finish = 'vinyl') {
    const color = new THREE.Color(hex);
    const rgb = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < rgb.length; i += 3) color.toArray(rgb, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    if (!batches.has(finish)) batches.set(finish, []);
    batches.get(finish).push(geometry);
  }
  if (kind === 'duck') buildDuck(paint);
  else if (kind === 'diver') buildDiver(paint);
  else if (kind === 'swimRing') buildSwimRing(paint, color);
  else throw new Error(`Unknown aquarium toy: ${kind}`);
  for (const [finish, parts] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), createToyMaterial(finish, manager));
    parts.forEach(part => part.dispose());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
