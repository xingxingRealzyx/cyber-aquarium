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

// Tint comes from each model's vertex colors. A whole tank shares the image
// maps, including between the duck's molded skin and the diver's rubber trim.
function attachMaps(material, tile, manager) {
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
    for (const [property, channel] of [['map','color'], ['normalMap','normal'], ['roughnessMap','rough']]) {
      const texture = loader.load(`./toys/${tile}-${channel}.webp`, decoded => {
        entry.loaded[property] = decoded;
        for (const user of entry.users) {
          user[property] = decoded;
          user.needsUpdate = true;
        }
      });
      texture.name = `toy ${tile} ${channel}`;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(...repeats[tile]);
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
