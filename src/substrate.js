import * as THREE from 'three';
import { substrateHeight } from './simulation.js';

const WIDTH = 7.9;
const DEPTH = 3.9;
const BASE_HEIGHT = .069;
const ROWS = 48;
const COLUMNS = 96;

function bedSurface() {
  const geo = new THREE.PlaneGeometry(WIDTH, DEPTH, COLUMNS, ROWS);
  geo.rotateX(-Math.PI / 2);
  const positions = geo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, substrateHeight(positions.getX(i), positions.getZ(i)));
  }
  geo.computeVertexNormals();
  return geo;
}

function bedEdges() {
  const w = WIDTH / 2;
  const d = DEPTH / 2;
  const corners = [[-w,-d], [-w,d], [w,d], [w,-d], [-w,-d]];
  const positions = [], uvs = [], indices = [];
  let distance = 0;
  for (let edge = 0; edge < 4; edge++) {
    const [x1,z1] = corners[edge], [x2,z2] = corners[edge + 1];
    const count = edge % 2 === 0 ? ROWS : COLUMNS;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const start = positions.length / 3;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const u = (distance + length * t) / 3.4;
      positions.push(x, BASE_HEIGHT, z, x, substrateHeight(x,z), z);
      uvs.push(u, 0, u, 1);
      if (i < count) {
        const a = start + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    distance += length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function riverPebbles(mineralMap) {
  const geo = new THREE.SphereGeometry(1, 10, 6);
  const pos = geo.attributes.position;
  const colors = [], normals = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const bulge = 1 + .065 * Math.sin(3 * x + 2 * z) * Math.cos(2 * y - x);
    pos.setXYZ(i, x * bulge + .052 * y * z, y * bulge, z * bulge);
    const shade = .65 + .35 * THREE.MathUtils.smoothstep(y, -.3, .52);
    const mineral = shade * (.91 + .07 * Math.sin(4 * x - y * 3 + z) + .04 * Math.cos(z * 5 + x));
    colors.push(mineral, mineral * .99, mineral * .97);
    // The modest erosion stays smooth across the UV seam, including the poles.
    normals.setXYZ(i, x, y, z);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));

  const mat = new THREE.MeshStandardMaterial({
    map: mineralMap, bumpMap: mineralMap, bumpScale: .00065, vertexColors: true, roughness: .74,
  });
  const pebbles = new THREE.InstancedMesh(geo, mat, 215);
  pebbles.name = 'Scattered water-worn pebbles';
  const palette = ['#665d50','#8b7d66','#716958','#887865','#a99b80','#5d5e54','#aca292'];
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  let seed = 210032;
  const random = () => {
    seed = (Math.imul(1664525,seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Small gravel drifts collect around the hardscape with a few strays in the open lane.
  const drifts = [[-1.75,.65],[-2.6,.20],[-1.22,.79],[2.18,.72],[2.88,.62],[-2.8,-.81],[1.47,-.5]];
  for (let i = 0; i < pebbles.count; i++) {
    let x, z;
    if (i % 4 < 3) {
      const bank = drifts[Math.floor(random() * drifts.length)];
      x = bank[0] + (random() + random() - 1) * 1.54;
      z = bank[1] + (random() + random() - 1) * 1.05;
    } else {
      x = (random() - .5) * (WIDTH - .3);
      z = (random() - .5) * (DEPTH - .28);
    }
    x = THREE.MathUtils.clamp(x, -.5 * WIDTH + .11, .5 * WIDTH - .11);
    z = THREE.MathUtils.clamp(z, -.5 * DEPTH + .09, .5 * DEPTH - .09);
    const size = .015 + .065 * random() ** 2;
    const height = size * (.37 + random() * .36);
    dummy.position.set(x, substrateHeight(x,z) + height * .12, z);
    dummy.rotation.set((random() - .5) * .32, random() * Math.PI * 2, (random() - .5) * .27);
    dummy.scale.set(size * (1 + .36 * random()), height, size * (.62 + .34 * random()));
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
    color.set(palette[Math.floor(random() * palette.length)]);
    pebbles.setColorAt(i, color);
  }
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  return pebbles;
}

export function createSubstrate(manager) {
  const group = new THREE.Group();
  group.name = 'River substrate';
  const loader = new THREE.TextureLoader(manager);
  const maps = [];
  const load = (surface, channel) => {
    const name = channel ? surface + '-' + channel : surface;
    const path = new URL('./substrate/' + name + '.webp', document.baseURI);
    const map = loader.load(path.href);
    map.name = name;
    map.colorSpace = channel === 'color' || surface === 'mineral' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.anisotropy = 8;
    if (surface === 'side') map.wrapS = THREE.MirroredRepeatWrapping;
    maps.push(map);
    return map;
  };
  for (const surface of ['surface','side']) {
    const packed = load(surface, 'arm');
    const top = surface === 'surface';
    const mat = new THREE.MeshStandardMaterial({
      color: top ? 0xdbdbd4 : 0xf1ede7, map: load(surface,'color'), normalMap: load(surface,'normal'), normalScale: new THREE.Vector2().setScalar(top ? .55 : .32),
      roughnessMap: packed, roughness: 1, aoMap: packed, aoMapIntensity: .68,
    });
    const mesh = new THREE.Mesh(top ? bedSurface() : bedEdges(), mat);
    mesh.name = top ? 'Shallow sand and gravel bars' : 'Sediment against glass';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const mineral = load('mineral');
  mineral.wrapS = mineral.wrapT = THREE.MirroredRepeatWrapping;
  group.add(riverPebbles(mineral));
  group.userData.disposeTextures = () => maps.forEach(map => map.dispose());
  return group;
}
