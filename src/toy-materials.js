import {
  DefaultLoadingManager, MeshPhysicalMaterial, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2,
} from 'three';

const finishes = {
  vinyl:  { tile: 'rubber', roughness: .54, relief: .28 },
  rubber: { tile: 'rubber', roughness: .88, relief: .72 },
  pvc:    { tile: 'pvc', roughness: .48, relief: .57, clearcoat: .32 },
  canvas: { tile: 'canvas', roughness: .96, relief: .85 },
  brass:  { tile: 'copper', roughness: .68, relief: .50, metalness: .73 },
  glass:  { roughness: .12, clearcoat: .8 },
};
const repeats = { rubber: [2, 1], pvc: [3, 1], canvas: [3, 2], copper: [2, 1] };
const libraries = new WeakMap();
const surfaceMaps = [['map', '-color'], ['normalMap', '-normal'], ['roughnessMap', '-rough']];
const colorMap = [['map', '']];
const texturedSurface = [...colorMap, ['normalMap', '-normal']];

// Tint comes from each model's vertex colors. A whole tank shares the image
// maps, including between the duck's molded skin and the diver's rubber trim.
function attachMaps(material, tile, manager, channels = surfaceMaps, repeat = repeats[tile]) {
  let library = libraries.get(manager);
  if (!library) {
    library = new Map();
    libraries.set(manager, library);
  }
  let entry = library.get(tile);
  if (!entry) {
    entry = { users: new Set(), loaded: {}, textures: [] };
    library.set(tile, entry);
    const loader = new TextureLoader(manager);
    for (const [property, suffix] of channels) {
      const texture = loader.load(`./toys/${tile}${suffix}.webp`, decoded => {
        entry.loaded[property] = decoded;
        for (const user of entry.users) {
          user[property] = decoded;
          user.needsUpdate = true;
        }
      });
      texture.name = `toy ${tile}${suffix}`;
      if (repeat) {
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.set(...repeat);
      }
      texture.anisotropy = 4;
      if (property === 'map') texture.colorSpace = SRGBColorSpace;
      entry.textures.push(texture);
    }
  }
  // Show the base material while the image decodes on first placement.
  Object.assign(material, entry.loaded);
  entry.users.add(material);
  function release() {
    material.removeEventListener('dispose', release);
    entry.users.delete(material);
    if (entry.users.size === 0) {
      for (const texture of entry.textures) texture.dispose();
      library.delete(tile);
    }
  }
  material.addEventListener('dispose', release);
}

export function createAuthorFiber(fiber, manager = DefaultLoadingManager) {
  const hair = fiber === 'hair';
  const material = new MeshPhysicalMaterial({
    name: `author ${fiber}`, roughness: hair ? .52 : .81,
    sheen: hair ? .48 : .28, sheenColor: hair ? '#b9b3c4' : '#c8b797',
    normalScale: new Vector2(.40, .40),
  });
  attachMaps(material, `author-${fiber}`, manager, texturedSurface, hair ? [1, 1] : [2, 2]);
  return material;
}

// Local UVs follow hair growth on the brow, whisker pads and inner ears.
function createAnatomicalFur(part, manager, repeat) {
  const material = new MeshStandardMaterial({
    name: `author ${part}`, vertexColors: true, roughness: .81,
  });
  attachMaps(material, `author-${part}`, manager, colorMap, repeat);
  return material;
}

export const createAuthorFaceFur = (manager = DefaultLoadingManager) => createAnatomicalFur('brow', manager, [1, 1]);
export const createAuthorPad = (manager = DefaultLoadingManager) => createAnatomicalFur('muzzle', manager, [1, 1]);
export const createAuthorEar = (manager = DefaultLoadingManager) => createAnatomicalFur('ear', manager, [1, 1]);

export const createAuthorCheek = (manager = DefaultLoadingManager) => createAnatomicalFur('cheek', manager);
export const createAuthorChin = (manager = DefaultLoadingManager) => createAnatomicalFur('chin', manager);
export const createAuthorNose = (manager = DefaultLoadingManager) => createAnatomicalFur('nose', manager);

export function createAuthorIris(manager = DefaultLoadingManager) {
  const material = new MeshStandardMaterial({ name: 'author iris', roughness: .54 });
  attachMaps(material, 'author-iris', manager, colorMap);
  return material;
}

export function createToyMaterial(finish, manager = DefaultLoadingManager) {
  const { tile, relief, clearcoat, roughness, metalness = 0 } = finishes[finish];
  const options = { name: finish, vertexColors: true, roughness, metalness };
  const material = clearcoat
    ? new MeshPhysicalMaterial({ ...options, clearcoat, clearcoatRoughness: .19 })
    : new MeshStandardMaterial(options);
  if (tile) {
    material.normalScale = new Vector2(relief, relief);
    attachMaps(material, tile, manager);
  }
  return material;
}
