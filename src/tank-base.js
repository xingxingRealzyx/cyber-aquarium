import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function surfaceGrain() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 7103;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const grain = seed >>> 24;
    pixels[i] = grain;
    pixels[i + 1] = 191 + Math.round(grain * .23);
    pixels[i + 2] = 0;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function baseLayer(width, height, depth, radius, material) {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
  const uv = geometry.attributes.uv;
  // Each face gets the same grain size, including the narrow front lip.
  const faceSizes = [[depth,height],[depth,height],[width,depth],[width,depth],[width,height],[width,height]];
  for (const group of geometry.groups) {
    const [w,h] = faceSizes[group.materialIndex];
    for (let i = group.start; i < group.start + group.count; i++) {
      uv.setXY(i, uv.getX(i) * w / .35, uv.getY(i) * h / .35);
    }
  }
  const layer = new THREE.Mesh(geometry, material);
  layer.receiveShadow = true;
  return layer;
}

export function createTankBase(width, depth, glassBottom) {
  const base = new THREE.Group();
  const grain = surfaceGrain();
  base.userData.disposeTextures = () => grain.dispose();
  const coating = new THREE.MeshStandardMaterial({
    color: '#404343', metalness: .22, roughness: .76,
    roughnessMap: grain, bumpMap: grain, bumpScale: .00045,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#262827', roughness: 1,
    roughnessMap: grain, bumpMap: grain, bumpScale: .0008,
  });
  const padHeight = .046, trayHeight = .19;
  const pad = baseLayer(width + .02, padHeight, depth + .02, .012, rubber);
  pad.position.y = glassBottom - padHeight / 2;
  const tray = baseLayer(width + .16, trayHeight, depth + .16, .048, coating);
  tray.position.y = glassBottom - padHeight - trayHeight / 2;
  base.add(tray, pad);
  return base;
}
