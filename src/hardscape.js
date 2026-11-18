import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import stoneScans from './hardscape-assets/stone-shapes.json';
import branchScans from './hardscape-assets/branch-shapes.json';
import { substrateHeight } from './simulation.js';

// The meshes and the colour, OpenGL normal and roughness maps are adapted from
// Rock Moss Set 02 by Kless Gyzen and Dry Branches Medium 01 by Rico Cilliers (CC0).
// https://polyhaven.com/a/rock_moss_set_02 · https://polyhaven.com/a/dry_branches_medium_01
function scannedMaterial(kind, manager) {
  const loader = new THREE.TextureLoader(manager);
  const wood = kind === 'wood';
  function map(channel) {
    const texture = loader.load(`./hardscape/${kind}-${channel}.webp`);
    texture.name = `${kind} / ${channel}`;
    // Both atlases retain their original glTF image-space UVs.
    texture.flipY = false;
    texture.anisotropy = 4;
    if (channel === 'color') texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const textures = [map('color'), map('normal'), map('rough')];
  const material = new THREE.MeshStandardMaterial({
    name: wood ? 'Water-worn timber' : 'Submerged stone',
    color: wood ? 0xad9584 : 0xadb4ac,
    map: textures[0],
    normalMap: textures[1],
    // WebGL tangents reconstructed from glTF UVs have opposite handedness.
    normalScale: wood ? new THREE.Vector2(1, -1) : new THREE.Vector2(.84, -.84),
    roughnessMap: textures[2],
    roughness: wood ? .94 : .80,
    metalness: 0,
    envMapIntensity: .48,
  });
  material.addEventListener('dispose', () => textures.forEach(texture => texture.dispose()));
  return material;
}

function unpack(data, Type) {
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  return new Type(bytes.buffer);
}

// x, z, size in tank units, yaw, bank, source scan. The lower skirt of each
// stone disappears under the substrate, including along the banks' slopes.
const stones = [
  [-1.76, .23, [1.55, 1.26, 1.18], .26, -.16, 6],
  [-2.56, .40, [1.03, .79, .88], -.84, -.17, 3],
  [-1.19, .65, [.99, 1.43, .84], -.36, -.24, 5],
  [-2.07, .94, [1.08, .45, .71], .89, -.11, 1],
  [-1.31, 1.05, [.75, .31, .51], .68, -.18, 2],
  [-.81, .61, [.58, .34, .44], -.22, -.09, 0],
  [-2.91, -.78, [.71, .40, .62], .41, -.18, 4],
  [2.26, .61, [1.34, .81, 1.03], 2.64, .12, 1],
  [2.80, .60, [.85, .51, .72], -.42, .25, 4],
  [1.83, .85, [.75, .37, .52], 1.04, .04, 0],
  [2.45, 1.11, [.53, .27, .35], -1.82, -.06, 2],
  [-2.71, .99, [.39, .23, .32], -1.06, .08, 3],
];

function scanGeometry(shape) {
  const positions = unpack(shape.position, Uint16Array);
  const vertices = new Float32Array(positions.length);
  for (let i = 0; i < vertices.length; i++) {
    const axis = i % 3;
    vertices[i] = (positions[i] / 65535 - (axis === 1 ? 0 : .5)) * shape.size[axis];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(unpack(shape.normal, Int8Array), n => n / 127), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(unpack(shape.uv, Uint16Array), uv => uv / 65535), 2));
  geometry.setIndex(new THREE.BufferAttribute(unpack(shape.index, Uint16Array), 1));
  return geometry;
}

function stoneBank(manager) {
  const originals = stoneScans.map(scanGeometry);
  const pieces = stones.map(([x, z, size, yaw, tilt, index]) => {
    const geometry = originals[index].clone();
    const source = stoneScans[index].size;
    geometry.scale(size[0] / source[0], size[1] / source[1], size[2] / source[2]);
    geometry.rotateZ(tilt);
    geometry.rotateY(yaw);
    geometry.computeBoundingBox();
    geometry.translate(x, substrateHeight(x, z) - geometry.boundingBox.min.y - size[1] * .13, z);
    return geometry;
  });
  const bank = mergeGeometries(pieces);
  for (const geometry of [...originals, ...pieces]) geometry.dispose();
  return new THREE.Mesh(bank, scannedMaterial('stone', manager));
}

// A forked branch, a winding limb and a piece of split wood keep the photographed
// fractures, knots and splintered ends of the original samples. A branch is
// fastened between two points by its longitudinal axis, preserving its curvature.
const branches = [
  [2, [-2.34,.49,-.27], [.90,1.98,-.43], .78, 1.17],
  [2, [-2.03,.51,.02], [-1.02,2.56,-.31], -1.21, 1.04],
  [1, [-1.54,1.12,-.15], [-.17,1.28,.51], .98, 1.26],
  [0, [-2.17,.61,-.13], [-2.48,1.51,.28], .40, 1.18],
  [1, [-1.96,.78,.15], [-1.54,.38,1.15], 2.2, 1.16],
];

function driftwood(manager) {
  const geometries = branches.map(([scan, start, end, roll, girth]) => {
    const shape = branchScans[scan];
    const geometry = scanGeometry(shape);
    const [width, height, length] = shape.size;
    // Coordinate of the broken base in that scan's local bounding box.
    const base = [[-.06,.46,.49], [.40,.66,-.49], [-.07,.09,.49]][scan];
    geometry.translate(-base[0]*width, -base[1]*height, -base[2]*length);
    if (base[2] < 0) geometry.rotateY(Math.PI);
    const origin = new THREE.Vector3(...start);
    const direction = new THREE.Vector3(...end).sub(origin);
    const scale = direction.length() / length;
    geometry.scale(scale * girth, scale * girth, scale);
    geometry.rotateZ(roll);
    const z = direction.normalize().negate();
    const x = new THREE.Vector3(0,1,0).cross(z).normalize();
    const y = new THREE.Vector3().crossVectors(z,x);
    geometry.applyMatrix4(new THREE.Matrix4().makeBasis(x,y,z).setPosition(origin));
    return geometry;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geometries), scannedMaterial('wood', manager));
  geometries.forEach(geometry => geometry.dispose());
  return mesh;
}

export function createHardscape(manager) {
  const group = new THREE.Group();
  for (const mesh of [stoneBank(manager), driftwood(manager)]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.name = '石组与沉木';
  return group;
}
