import { DefaultLoadingManager, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';

const libraries = new WeakMap();

// Each aquarium shares the same six maps across adults and hatchlings. The
// packed surface image stores fine relief in red and roughness in green.
export function grazerMaps(name, manager = DefaultLoadingManager) {
  if (typeof document === 'undefined') return {};
  let library = libraries.get(manager);
  if (!library) {
    library = new Map();
    libraries.set(manager, library);
  }
  if (!library.has(name)) {
    const loader = new TextureLoader(manager);
    const load = suffix => {
      const texture = loader.load(`./invertebrates/${name}${suffix}.webp`);
      texture.name = name + suffix;
      texture.wrapS = RepeatWrapping;
      if (name === 'snail-skin') texture.wrapT = RepeatWrapping;
      texture.anisotropy = 4;
      return texture;
    };
    const map = load('');
    map.colorSpace = SRGBColorSpace;
    const surface = load('-surface');
    library.set(name, { map, bumpMap: surface, roughnessMap: surface });
  }
  return library.get(name);
}

export function disposeGrazerMaps(manager) {
  const library = libraries.get(manager);
  if (!library) return;
  for (const { map, bumpMap } of library.values()) {
    map.dispose();
    bumpMap.dispose();
  }
  libraries.delete(manager);
}
