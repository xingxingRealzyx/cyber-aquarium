import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToyMaterial } from './toy-materials.js';
const tau = 2 * Math.PI,
  smooth = THREE.MathUtils.smoothstep;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z),
  vec = v3;
const graphite = '#263133',
  slate = '#364b52';
const curveOf = (points) => new THREE.CatmullRomCurve3(points.map((p) => v3(...p)));
function oval(x, y, z, w, h, d) {
  return new THREE.SphereGeometry(1, 24, 16).scale(w, h, d).translate(x, y, z);
}

function tube(points, radius, closed = false) {
  const path = new THREE.CatmullRomCurve3(
    points.map((p) => v3(...p)),
    closed,
  );
  return new THREE.TubeGeometry(path, closed ? 48 : 20, radius, 7, closed);
}

function surface(position, uv, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function maskZ(x, y) {
  return 0.177 - 1.62 * x * x - 0.29 * (y - 0.044) ** 2;
}

function maskLens(side) {
  const shape = new THREE.Shape();
  shape.moveTo(0.015, 0.079);
  shape.bezierCurveTo(0.034, 0.106, 0.114, 0.112, 0.145, 0.09);
  shape.bezierCurveTo(0.164, 0.08, 0.167, 0.044, 0.151, 0.018);
  shape.bezierCurveTo(0.139, -0.002, 0.075, -0.006, 0.046, 0.007);
  shape.bezierCurveTo(0.03, 0.014, 0.029, 0.038, 0.012, 0.048);
  shape.bezierCurveTo(0.008, 0.058, 0.011, 0.073, 0.015, 0.079);
  const outline = shape
    .getPoints(10)
    .slice(0, -1)
    .map((p) => [side * p.x, p.y, maskZ(p.x, p.y)]);
  const pane = new THREE.ShapeGeometry(shape, 12),
    points = pane.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i),
      y = points.getY(i);
    points.setXYZ(i, side * x, y, maskZ(x, y));
  }
  // Keep both sides front-facing for normal-based reflections.
  if (side < 0) {
    const ix = pane.index.array;
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  }
  pane.computeVertexNormals();
  const pos = [],
    uv = [],
    idx = [];
  for (let i = 0; i <= outline.length; i++) {
    const [x, y, z] = outline[i % outline.length];
    const back = z - 0.011 - 0.013 * smooth(Math.abs(x), 0.082, 0.16);
    pos.push(x, y, z, x * 0.99, y + 0.002, back);
    uv.push(i / outline.length, 1, i / outline.length, 0);
    if (i) {
      const k = 2 * i;
      idx.push(k - 2, k - 1, k, k, k - 1, k + 1);
    }
  }
  return { pane, outline, skirt: surface(pos, uv, idx) };
}

const bite = [0.031, -0.078, 0.168];
const tip = [0.232, 0.315, 0.002];
function snorkelShell() {
  const curve = curveOf([
    bite,
    [0.055, -0.089, 0.18],
    [0.095, -0.097, 0.17],
    [0.15, -0.082, 0.145],
    [0.194, -0.044, 0.104],
    [0.218, 0.011, 0.07],
    [0.229, 0.071, 0.041],
    [0.232, 0.16, 0.023],
    [0.233, 0.25, 0.011],
    tip,
  ]);
  const steps = 160,
    sides = 24;
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [],
    uv = [],
    ix = [],
    colors = [];
  const color = new THREE.Color(),
    radial = new THREE.Vector3();
  // Walk along the outer wall, fold over the slanted annular lip, then
  // return through the bore to the bite piece. Both ends are true openings.
  function ring(j, inside) {
    const t = j / steps,
      center = curve.getPointAt(t),
      tangent = frames.tangents[j];
    const smooth = THREE.MathUtils.smoothstep;
    const bellows = smooth(t, 0.11, 0.16) * (1 - smooth(t, 0.43, 0.49));
    const ridge = 0.5 + 0.5 * Math.cos((t - 0.1) * tau * 34);
    const cuff = (t > 0.45 && t < 0.49) || (t > 0.575 && t < 0.602);
    const barrel = inside ? 0.0084 : 0.0129 + bellows * (ridge * 0.0018 - 0.001) + (cuff ? 0.0017 : 0);
    const radius = barrel * (0.64 + 0.36 * smooth(t, 0.0, 0.15));
    color.set(
      inside ? '#10171a' : t > 0.952 ? graphite : t > 0.827 ? '#f1762a' : cuff || t < 0.11 ? graphite : slate,
    );
    if (!inside && bellows) color.multiplyScalar(1 - 0.18 * bellows * (1 - ridge));
    for (let i = 0; i <= sides; i++) {
      const a = (i * tau) / sides;
      radial.copy(frames.normals[j]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[j], Math.sin(a));
      const bevel = -0.47 * radius * radial.z * smooth(t, 0.94, 1);
      pos.push(
        center.x + radial.x * radius + tangent.x * bevel,
        center.y + radial.y * radius + tangent.y * bevel,
        center.z + radial.z * radius + tangent.z * bevel,
      );
      uv.push(i / sides, t * 3);
      colors.push(color.r, color.g, color.b);
      const k = pos.length / 3 - 1;
      if (k > sides && i) ix.push(k - sides - 2, k - sides - 1, k, k - sides - 2, k, k - 1);
    }
  }
  for (let j = 0; j <= steps; j++) ring(j, false);
  for (let j = steps; j >= 0; j -= 2) ring(j, true);
  const geo = surface(pos, uv, ix);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

export function createAuthorDiveGear(manager) {
  const gear = new THREE.Group();
  gear.name = '低容积潜水面罩与侧呼吸管';
  const rubber = new THREE.MeshStandardMaterial({
    name: '贴面胶裙',
    color: '#253638',
    roughness: 0.62,
    side: THREE.DoubleSide,
  });
  const buckle = new THREE.MeshStandardMaterial({
    name: '面镜金属边',
    color: '#475c5e',
    roughness: 0.36,
    metalness: 0.18,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    name: '双镜面罩镜片',
    color: '#d9eef0',
    roughness: 0.07,
    clearcoat: 0.75,
    transparent: true,
    opacity: 0.084,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  const pocket = lens.clone();
  pocket.name = '透明鼻袋';
  pocket.opacity = 0.11;
  const silicone = new THREE.MeshPhysicalMaterial({
    name: '柔性鼻袋裙边',
    color: '#748986',
    roughness: 0.29,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const batches = new Map();
  function add(mat, geo) {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geo);
  }
  for (const s of [-1, 1]) {
    const { pane, outline, skirt } = maskLens(s);
    add(lens, pane);
    add(rubber, skirt);
    add(rubber, tube(outline, 0.0055, true));
    add(
      buckle,
      tube(
        outline.map(([x, y, z]) => [x, y, z + 0.0029]),
        0.0024,
        true,
      ),
    );
    add(
      rubber,
      tube(
        [
          [s * 0.155, 0.062, 0.139],
          [s * 0.19, 0.057, 0.102],
          [s * 0.204, 0.055, 0.045],
          [s * 0.206, 0.056, -0.033],
          [s * 0.159, 0.066, -0.113],
          [s * 0.082, 0.07, -0.148],
          [0, 0.07, -0.154],
        ],
        0.008,
      ),
    );
    add(buckle, oval(s * 0.193, 0.058, 0.09, 0.009, 0.012, 0.02));
  }
  add(
    rubber,
    tube(
      [
        [-0.02, 0.067, 0.174],
        [0, 0.078, 0.177],
        [0.02, 0.067, 0.174],
      ],
      0.0058,
    ),
  );
  add(pocket, oval(0, 0.007, 0.171, 0.037, 0.062, 0.04));
  add(
    silicone,
    tube(
      [
        [-0.023, 0.041, 0.171],
        [-0.031, 0.003, 0.18],
        [-0.024, -0.033, 0.183],
        [0, -0.046, 0.191],
        [0.024, -0.033, 0.183],
        [0.031, 0.003, 0.18],
        [0.023, 0.041, 0.171],
      ],
      0.0018,
    ),
  );
  add(
    buckle,
    new THREE.CylinderGeometry(0.015, 0.0153, 0.0095, 24, 1, true).rotateX(-0.43).translate(0.225, 0.043, 0.054),
  );
  add(rubber, new THREE.BoxGeometry(0.027, 0.01, 0.009).translate(0.213, 0.049, 0.052));
  add(rubber, oval(0.031, -0.075, 0.166, 0.014, 0.006, 0.008));
  for (const [mat, parts] of batches) {
    const g = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = mat.name;
    mesh.castShadow = !mat.transparent;
    if (mat.transparent) mesh.renderOrder = mat === lens ? 6 : 5;
    gear.add(mesh);
  }
  const barrel = new THREE.Mesh(snorkelShell(), createToyMaterial('pvc', manager));
  barrel.name = '中空 J 形呼吸管';
  gear.add(barrel);
  const mouth = new THREE.Object3D(),
    snorkelTip = new THREE.Object3D();
  mouth.name = '嘴部呼气点';
  mouth.position.set(...bite);
  snorkelTip.name = '呼吸管口';
  snorkelTip.position.set(...tip);
  gear.add(mouth, snorkelTip);
  gear.userData.mouth = mouth;
  gear.userData.snorkelTip = snorkelTip;
  return gear;
}
