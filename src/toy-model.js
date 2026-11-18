import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const finishes = {
  vinyl: { roughness: .4 },
  rubber: { roughness: .66 },
  brass: { roughness: .32, metalness: .58 },
  glass: { roughness: .14, metalness: .25 },
};

function oval(x, y, z, rx, ry, rz, tilt = 0) {
  const radius = Math.max(rx, ry, rz);
  const segments = radius < .018 ? 8 : radius < .09 ? 14 : 22;
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
  const body = new THREE.SphereGeometry(1, 32, 20);
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

function buildDuck(paint) {
  paint(duckBody(), '#f9bd19');
  paint(oval(.145, .239, 0, .152, .161, .141, -.08), '#ffcb27');
  for (const side of [-1, 1]) {
    paint(oval(-.072, .065, side * .143, .146, .074, .035, -.19), '#f3ab15');
    paint(oval(-.065, .078, side * .154, .128, .061, .030, -.19), '#ffca28');
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

function buildDiver(paint) {
  const suit = '#287c76', panels = '#388f83', rubber = '#233b40', brass = '#cca050';
  const copper = '#b46b32', lens = '#204e5a';

  // Neutrally posed, with a molded suit, gloves and flippers all fixed in place.
  paint(oval(0, -.027, 0, .135, .197, .092), suit, 'rubber');
  paint(oval(0, .055, .004, .158, .084, .092), panels, 'rubber');
  paint(new THREE.CylinderGeometry(.138, .128, .036, 28).scale(1, 1, .72).translate(0, -.095, 0), rubber, 'rubber');
  paint(oval(0, -.095, .095, .039, .021, .009), brass, 'brass');

  for (const side of [-1, 1]) {
    paint(ovalBetween([side * .108, .099, 0], [side * .195, -.055, .015], .052, .053), suit, 'rubber');
    paint(ovalBetween([side * .190, -.027, .011], [side * .196, -.118, .083], .042, .044), panels, 'rubber');
    paint(oval(side * .195, -.114, .084, .044, .053, .043), rubber, 'rubber');

    paint(ovalBetween([side * .056, -.109, -.008], [side * .093, -.296, .020], .061, .064), suit, 'rubber');
    paint(ovalBetween([side * .091, -.253, .017], [side * .114, -.407, -.019], .046, .049), panels, 'rubber');
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

export function createToyModel(kind) {
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
  else throw new Error(`Unknown aquarium toy: ${kind}`);
  for (const [finish, parts] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({
      vertexColors: true, ...finishes[finish],
    }));
    parts.forEach(part => part.dispose());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
