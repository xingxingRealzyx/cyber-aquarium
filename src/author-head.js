import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createAuthorFiber,
  createAuthorIris,
  createAuthorFaceFur,
  createAuthorPad,
  createAuthorEar,
  createAuthorCheek,
  createAuthorChin,
  createAuthorNose,
} from './toy-materials.js';
import { createAuthorDiveGear } from './author-dive-gear.js';

const tau = 2 * Math.PI;
const smooth = THREE.MathUtils.smoothstep;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function gridQuad(ix, k, stride, reverse = false) {
  const a = k - stride - 1,
    b = k - stride,
    c = k,
    d = k - 1;
  if (reverse) ix.push(a, d, b, b, d, c);
  else ix.push(a, b, d, b, c, d);
}
function bump(x, y, cx, cy, rx, ry) {
  return Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
}

// These proportions also define the seat of every independently mapped feature.
function faceWidth(ny) {
  return 0.194 * (1 + 0.045 * (1 - ny * ny));
}
function faceRelief(x, y) {
  return (
    0.032 * bump(x, y, 0, -0.023, 0.034, 0.039) +
    0.028 * bump(x, y, 0.047, -0.048, 0.048, 0.036) +
    0.028 * bump(x, y, -0.047, -0.048, 0.048, 0.036) +
    0.017 * bump(x, y, 0, -0.101, 0.068, 0.046) +
    0.009 * bump(x, y, 0.089, 0.056, 0.046, 0.041) +
    0.009 * bump(x, y, -0.089, 0.056, 0.046, 0.041)
  );
}
function faceDepth(x, y) {
  const ny = y / 0.167,
    nx = x / faceWidth(ny),
    nz = Math.sqrt(Math.max(0.001, 1 - ny * ny - nx * nx));
  return 0.144 * nz + smooth(nz, 0.14, 0.65) * faceRelief(x, y);
}
function makeFace() {
  const geo = new THREE.SphereGeometry(1, 64, 48),
    p = geo.attributes.position,
    uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i),
      ny = p.getY(i),
      nz = p.getZ(i),
      x = faceWidth(ny) * nx,
      y = 0.167 * ny;
    p.setXYZ(i, x, y, 0.144 * nz + smooth(nz, 0.14, 0.65) * faceRelief(x, y));
    uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.5);
  }
  geo.computeVertexNormals();
  return geo;
}
// A swept shell covers the rear skull; its scalloped hem descends behind the
// cheeks and tapers back up to the hairline above the mask.
function hairCap() {
  const position = [],
    uv = [],
    indices = [];
  const rings = 24,
    sections = 72;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let i = 0; i <= sections; i++) {
      const a = (tau * i) / sections,
        front = Math.cos(a);
      const hem = 2.51 - 1.71 * smooth(front, 0.15, 0.94) + 0.06 * Math.sin(13 * a + 0.4) * t * t;
      const latitude = 0.006 + t * hem;
      const wave = 1 + 0.013 * Math.cos(18 * a + 0.8 * t) * Math.sin(latitude);
      position.push(
        0.202 * wave * Math.sin(latitude) * Math.sin(a),
        0.005 + 0.177 * Math.cos(latitude),
        0.154 * wave * Math.sin(latitude) * front,
      );
      uv.push((6 * i) / sections, 1 - t);
      if (i && j) {
        const c = j * (sections + 1) + i,
          b = c - 1,
          a0 = c - sections - 2,
          d = c - sections - 1;
        indices.push(a0, b, d, b, c, d);
      }
    }
  }
  return surface(position, uv, indices);
}

function surface(position, uv, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Elliptical cross-sections give the locks thickness and a narrow pointed tip.
// The texture's vertical fiber direction runs from the crown down to the hem.
function lock(points, width, thickness) {
  const path = new THREE.CatmullRomCurve3(points.map((p) => v3(...p)));
  const position = [],
    uv = [],
    indices = [];
  const sections = 10,
    rings = 20;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings,
      center = path.getPoint(t),
      tangent = path.getTangent(t);
    const outward = v3(center.x, 0.22 * center.y, center.z).normalize();
    const side = v3(0, 0, 0).crossVectors(outward, tangent).normalize();
    outward.crossVectors(tangent, side).normalize();
    const envelope = 0.03 + Math.sin(Math.PI * (0.09 + 0.91 * t)) ** 0.7;
    for (let i = 0; i <= sections; i++) {
      const a = (i * tau) / sections;
      const pos = center
        .clone()
        .addScaledVector(side, Math.cos(a) * width * envelope)
        .addScaledVector(outward, Math.sin(a) * thickness * envelope);
      position.push(pos.x, pos.y, pos.z);
      uv.push(i / sections, 1 - t);
      if (i && j) {
        const c = j * (sections + 1) + i,
          b = c - 1,
          d = c - sections - 1;
        indices.push(d - 1, d, b, d, c, b);
      }
    }
  }
  return surface(position, uv, indices);
}

function ear(side, inner) {
  const position = [],
    uv = [],
    indices = [];
  const levels = 16,
    segments = 24;
  for (let j = 0; j <= levels; j++) {
    const t = j / levels;
    const w = (inner ? 0.05 : 0.073) * (1 - 0.989 * t ** 1.05);
    const cx = side * (0.116 + (inner ? 0.042 : 0.053) * t);
    const y = (inner ? 0.131 : 0.115) + (inner ? 0.095 : 0.136) * t;
    const cz = 0.005 - 0.025 * t;
    for (let i = 0; i <= segments; i++) {
      const a = (tau * i) / segments;
      // The pinna cups forward in the center, with a rolled, furry outer edge.
      const front = Math.max(0, Math.cos(a));
      const z = inner
        ? cz + (0.043 + 0.009 * (1 - front)) * (1 - 0.66 * t)
        : cz + (0.055 - 0.017 * front * front) * (1 - 0.84 * t) * Math.cos(a);
      position.push(cx + w * Math.sin(a), y, z);
      uv.push(i / segments, t);
      if (i && j) {
        const c = j * (segments + 1) + i,
          b = c - 1,
          d = c - segments - 1;
        indices.push(d - 1, d, b, d, c, b);
      }
    }
  }
  return surface(position, uv, indices);
}

function filament(points, radius, taper = 0.9) {
  const path = new THREE.CatmullRomCurve3(points.map((p) => v3(...p)));
  const geometry = new THREE.TubeGeometry(path, 18, radius, 6, false);
  const p = geometry.attributes.position,
    center = v3(0, 0, 0);
  for (let i = 0; i < p.count; i++) {
    const t = Math.floor(i / 7) / 18;
    path.getPointAt(t, center);
    const scale = (1 - taper * t * t) * (0.58 + 0.42 * smooth(t, 0, 0.2));
    p.setXYZ(
      i,
      center.x + (p.getX(i) - center.x) * scale,
      center.y + (p.getY(i) - center.y) * scale,
      center.z + (p.getZ(i) - center.z) * scale,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

const noseRim = new THREE.SplineCurve(
  [
    [700, 682],
    [685, 678],
    [667, 680],
    [646, 681],
    [626, 681],
    [597, 679],
    [586, 682],
    [588, 691],
    [597, 701],
    [606, 706],
    [615, 704],
    [622, 710],
    [626, 725],
    [634, 739],
    [646, 759],
    [657, 741],
    [663, 729],
    [669, 713],
    [676, 705],
    [684, 706],
    [694, 699],
    [701, 690],
    [700, 682],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
);

function noseLeather() {
  const vertices = [],
    uv = [],
    indices = [],
    rows = 17,
    cols = 62;
  for (let j = 0; j <= rows; j++) {
    const r = Math.min(1, 0.0001 + j / (rows - 2));
    for (let i = 0; i <= cols; i++) {
      const edge = noseRim.getPointAt(i / cols),
        sx = 646 + (edge.x - 646) * r,
        sy = 707 + (edge.y - 707) * r;
      const x = (sx - 646) * 0.00041,
        y = -0.025 + (707 - sy) * 0.0004;
      let z =
        faceDepth(x, y) +
        0.001 +
        0.0095 * Math.max(0, 1 - r * r) ** 0.74 -
        0.0028 * bump(Math.abs(sx - 646), sy, 26, 710, 10, 8);
      if (j === rows - 1) z -= 0.006;
      if (j === rows) z -= 0.015;
      vertices.push(x, y, z);
      uv.push((sx - 577) / 134, 1 - (sy - 666) / 103);
      if (i && j) gridQuad(indices, j * (cols + 1) + i, cols + 1, true);
    }
  }
  const front = vertices.length / 3;
  const top = vertices.slice(0, 3);
  vertices.push(0, -0.025, top[2]);
  uv.push((646 - 577) / 134, 1 - (707 - 666) / 103);
  for (let i = 0; i < cols; i++) indices.push(front, i, i + 1);
  const back = vertices.length / 3;
  vertices.push(0, -0.032, 0.145);
  uv.push(0.5, 0.5);
  for (let i = 0; i < cols; i++) indices.push(back, rows * (cols + 1) + i + 1, rows * (cols + 1) + i);
  return surface(vertices, uv, indices);
}

function coatPatch(sample) {
  const vertices = [],
    uv = [],
    indices = [],
    colors = [],
    rows = 20,
    cols = 34;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols,
        v = j / rows;
      const [x, y, z, alpha] = sample(u, v);
      vertices.push(x, y, z);
      uv.push(u, v);
      colors.push(1, 1, 1, alpha);
      if (i && j) gridQuad(indices, j * (cols + 1) + i, cols + 1);
    }
  }
  const geo = surface(vertices, uv, indices);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return geo;
}

function fade(u, v) {
  return smooth(u, 0, 0.18) * (1 - smooth(u, 0.78, 1)) * smooth(v, 0, 0.18) * (1 - smooth(v, 0.81, 1));
}
function forehead() {
  return coatPatch((u, v) => {
    const y = -0.017 + 0.171 * v,
      x = (2 * u - 1) * (0.032 + 0.088 * smooth(v, 0.18, 0.8));
    return [x, y, faceDepth(x, y) + 0.0012, 0.76 * fade(u, v)];
  });
}
function cheek(s) {
  return coatPatch((u, v) => {
    const y = -0.117 + 0.145 * v,
      ny = y / 0.167,
      half = faceWidth(ny) * Math.sqrt(Math.max(0.001, 1 - ny * ny));
    const x = s * half * Math.sin(0.25 + 1.05 * u);
    return [x, y, faceDepth(x, y) + 0.0009, 0.77 * fade(u, v)];
  });
}
function chin() {
  return coatPatch((u, v) => {
    const y = -0.151 + 0.075 * v,
      n = y / 0.167,
      x = (2 * u - 1) * faceWidth(n) * Math.sqrt(1 - n * n) * 0.7;
    return [x, y, faceDepth(x, y) + 0.0011, 0.77 * fade(u, v)];
  });
}
function padDepth(x, y) {
  const nx = (Math.abs(x) - 0.036) / 0.049,
    ny = (y + 0.049 - 0.005 * nx) / 0.031;
  const dome = Math.max(0, 1 - nx * nx - ny * ny);
  return faceDepth(x, y) + 0.0008 + 0.004 * dome * dome;
}
function whiskerPad(s) {
  const geom = coatPatch((u, v) => {
    const x = s * (0.036 + 0.049 * (2 * u - 1)),
      y = -0.049 + 0.031 * (2 * v - 1) + 0.005 * (2 * u - 1);
    return [x, y, padDepth(x, y), fade(u, v)];
  });
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, s < 0 ? (1 - uv.getX(i)) * 0.5 : 0.5 + uv.getX(i) * 0.5);
  return geom;
}

// Both eyes have an almost round opening and a convex cornea. The atlas
// contains two independently sampled eyes, including their soft catchlights.
function eyePoint(s, u, v, r) {
  const x = s * (0.087 + 0.042 * u),
    y = 0.05 + 0.0395 * v * (1 - 0.09 * u * u) + 0.0018 * u;
  const z = faceDepth(x, y) + 0.0017 + 0.024 * (1 - r * r) ** 0.82;
  return [x, y, z];
}
function eye(s, cornea = false) {
  const positions = [],
    uv = [],
    ix = [],
    rows = 15,
    cols = 56;
  for (let j = 0; j <= rows; j++) {
    const r = 0.0001 + (0.9999 * j) / rows;
    for (let i = 0; i <= cols; i++) {
      const a = (tau * i) / cols,
        u = r * Math.cos(a),
        v = r * Math.sin(a),
        [x, y, z] = eyePoint(s, u, v, r);
      positions.push(x, y, z + (cornea ? 0.0007 + 0.0012 * (1 - r * r) : 0));
      uv.push((s < 0 ? 0.25 : 0.75) + s * u * 0.2495, 0.5 + v * 0.499);
      if (i && j) gridQuad(ix, j * (cols + 1) + i, cols + 1, s > 0);
    }
  }
  const center = positions.length / 3;
  const [x, y, z] = eyePoint(s, 0, 0, 0);
  positions.push(x, y, z + (cornea ? 0.0019 : 0));
  uv.push(s < 0 ? 0.25 : 0.75, 0.5);
  for (let i = 0; i < cols; i++) {
    if (s > 0) ix.push(center, i, i + 1);
    else ix.push(center, i + 1, i);
  }
  return surface(positions, uv, ix);
}
function lids(s) {
  const positions = [],
    uv = [],
    ix = [],
    rgba = [],
    rows = 5,
    cols = 56;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= cols; i++) {
      const a = (tau * i) / cols,
        u = Math.cos(a),
        v = Math.sin(a),
        [bx, by, bz] = eyePoint(s, u, v, 1);
      const x = bx + s * u * 0.012 * t,
        y = by + v * (v > 0 ? 0.012 : 0.007) * t;
      const z = THREE.MathUtils.lerp(bz, faceDepth(x, y) + 0.0005, t) + 0.0016 * Math.sin(Math.PI * t);
      positions.push(x, y, z);
      uv.push(0.5 + u * 0.34, 0.5 + v * 0.24);
      const shade = 0.6 + 0.4 * smooth(t, 0.015, 0.23);
      rgba.push(shade, shade * 0.97, shade * 0.92, 1 - smooth(t, 0.58, 1));
      if (i && j) gridQuad(ix, j * (cols + 1) + i, cols + 1, s > 0);
    }
  }
  const geo = surface(positions, uv, ix);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
  return geo;
}
function classicHair() {
  const parts = [hairCap()];
  for (const s of [-1, 1]) {
    // Side and rear locks trail slightly towards the nape.
    for (let i = 0; i < 7; i++) {
      const a = 0.84 + i * 0.35;
      const x = Math.sin(a) * s,
        z = Math.cos(a);
      parts.push(
        lock(
          [
            [x * 0.095, 0.15, z * 0.08],
            [x * 0.177, 0.089, z * 0.145],
            [x * 0.205, -0.051, z * 0.154],
            [x * (0.187 + 0.012 * Math.cos(3 * i)), -0.161 - 0.024 * Math.cos(i), z * 0.153 - 0.023],
          ],
          0.036 + 0.006 * Math.cos(i),
          0.012,
        ),
      );
    }
    parts.push(
      lock(
        [
          [s * 0.057, 0.169, 0.048],
          [s * 0.11, 0.138, 0.09],
          [s * 0.16, 0.077, 0.104],
          [s * 0.177, -0.02, 0.085],
          [s * 0.162, -0.154, 0.111],
        ],
        0.027,
        0.011,
      ),
    );
    parts.push(
      lock(
        [
          [s * 0.064, 0.157, 0.041],
          [s * 0.045, 0.154, 0.078],
          [s * 0.036, 0.127, 0.11],
          [s * 0.055, 0.097, 0.123],
        ],
        0.024,
        0.008,
      ),
    );
  }
  // The central strands follow the same curved forehead as the side locks.
  parts.push(
    lock(
      [
        [0.019, 0.166, 0.042],
        [0.03, 0.156, 0.086],
        [0.028, 0.119, 0.118],
        [0.014, 0.084, 0.142],
        [-0.01, 0.048, 0.151],
      ],
      0.02,
      0.005,
    ),
  );
  return parts;
}

export function createAuthorHead(manager) {
  const head = new THREE.Group();
  head.name = '银发猫头';
  const fur = createAuthorFiber('fur', manager),
    hair = createAuthorFiber('hair', manager);
  const iris = createAuthorIris(manager),
    pinna = createAuthorEar(manager),
    brow = createAuthorFaceFur(manager);
  const pads = createAuthorPad(manager),
    cheeks = createAuthorCheek(manager),
    jaw = createAuthorChin(manager);
  const nose = createAuthorNose(manager);
  fur.normalScale.setScalar(0.2);
  hair.normalScale.setScalar(0.26);
  iris.roughness = 0.66;
  const cornea = new THREE.MeshPhysicalMaterial({
    color: '#dfe9ec',
    clearcoat: 1,
    roughness: 0.08,
    clearcoatRoughness: 0.065,
    transparent: true,
    opacity: 0.037,
    depthWrite: false,
  });
  const whisker = new THREE.MeshStandardMaterial({ color: '#e5d9c5', roughness: 0.68 });
  const lip = new THREE.MeshStandardMaterial({ color: '#997c70', roughness: 0.71 });
  for (const mat of [brow, pads, cheeks, jaw]) {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
  }
  const batches = new Map();
  function add(material, geometry) {
    if (material.vertexColors && !geometry.hasAttribute('color')) {
      const rgba = new Float32Array(geometry.attributes.position.count * 3).fill(1);
      geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 3));
    }
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }
  add(fur, makeFace());
  for (const part of classicHair()) add(hair, part);
  add(brow, forehead());
  add(jaw, chin());
  add(nose, noseLeather());
  const groove = [-0.044, -0.051, -0.058, -0.063].map((y) => [0, y, padDepth(0, y) + 0.0013]);
  add(lip, filament(groove, 0.0011, 0.34));
  for (const s of [-1, 1]) {
    add(fur, ear(s, false));
    add(pinna, ear(s, true));
    add(brow, lids(s));
    add(iris, eye(s));
    add(cornea, eye(s, true));
    add(pads, whiskerPad(s));
    add(cheeks, cheek(s));
    const crease = [
      [0, -0.063],
      [0.014, -0.069],
      [0.032, -0.075],
      [0.046, -0.073],
      [0.057, -0.068],
    ];
    add(
      lip,
      filament(
        crease.map(([x, y]) => [s * x, y, padDepth(s * x, y) + 0.001]),
        0.0011,
        0.83,
      ),
    );
    const whiskers = [
      [0.052, -0.042, 0.177, 0.028],
      [0.061, -0.051, 0.155, 0.009],
      [0.046, -0.058, 0.171, -0.029],
      [0.057, -0.065, 0.144, -0.058],
    ];
    for (const [x, y, length, rise] of whiskers) {
      const z = faceDepth(s * x, y) + 0.003;
      add(
        whisker,
        filament(
          [
            [s * x, y, z],
            [s * (x + 0.3 * length), y + 0.011 + rise * 0.18, z + 0.005],
            [s * (x + 0.7 * length), y + 0.017 + rise * 0.5, z - 0.004],
            [s * (x + length), y + rise, z - 0.038],
          ],
          0.00043,
          0.97,
        ),
      );
    }
  }
  for (const [mat, parts] of batches) {
    const geo = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = mat.name;
    mesh.castShadow = !mat.transparent;
    if (mat === cornea) mesh.renderOrder = 3;
    head.add(mesh);
  }
  const gear = createAuthorDiveGear(manager);
  head.add(gear);
  head.userData.mouth = gear.userData.mouth;
  head.userData.snorkelTip = gear.userData.snorkelTip;
  return head;
}
