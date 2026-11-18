import * as THREE from 'three';

// u travels from the tailstock to the nose; v wraps the body from the belly seam.
// Colours are painted in sRGB. The packed relief/roughness map stays in linear space.
const TAU = Math.PI * 2;
const variants = 4;
const textureCache = new Map();

const palettes = {
  neon:      { belly: [192, 199, 183], side: [117, 145, 139], back: [50, 70, 63] },
  guppy:     { belly: [210, 198, 160], side: [163, 160, 124], back: [61, 77, 60] },
  angelfish: { belly: [203, 210, 198], side: [169, 179, 168], back: [84, 89, 70] },
  zebra:     { belly: [209, 204, 167], side: [182, 176, 124], back: [88, 94, 65] },
  harlequin: { belly: [228, 191, 154], side: [195, 128, 89], back: [111, 78, 53] },
};
const guppyPigments = [[213, 80, 29], [220, 141, 37], [179, 72, 48], [224, 102, 32]];
const indigo = [25, 36, 44];
const scaleShadow = [54, 62, 56];
const pearl = [203, 219, 206];
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const fract = n => n - Math.floor(n);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const band = (x, center, radius, edge) => 1 - smooth(radius - edge, radius + edge, Math.abs(x - center));

function noiseCorner(x, y, seed) {
  let bits = Math.imul(x + 19, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(seed + 13, 83492791);
  bits = Math.imul(bits ^ (bits >>> 15), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

// Value noise moves pigment boundaries and breaks up the uninterrupted shine
// of individual scales. A fixed seed makes each fish's markings reproducible.
function pigmentNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = noiseCorner(ix, iy, seed), b = noiseCorner(ix + 1, iy, seed);
  const c = noiseCorner(ix, iy + 1, seed), d = noiseCorner(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy - .5;
}

function layer(rgb, paint, coverage) {
  rgb[0] += (paint[0] - rgb[0]) * coverage;
  rgb[1] += (paint[1] - rgb[1]) * coverage;
  rgb[2] += (paint[2] - rgb[2]) * coverage;
}

function paintedTexture(name, width, height, pixels, color) {
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.name = name;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function variation(seed) {
  let value = (seed + 7031) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function spots(count, rand, xRange, yRange, radius) {
  return Array.from({ length: count }, () => ({
    u: xRange[0] + rand() * xRange[1],
    h: yRange[0] + rand() * yRange[1],
    w: radius * (.65 + rand() * .8),
    d: radius * (.9 + rand()),
    angle: (rand() - .5) * .75,
  }));
}

function spotCoverage(u, h, markings) {
  let value = 0;
  for (const s of markings) {
    const dy = (h - s.h) / s.d;
    if (Math.abs(dy) > 1.2) continue;
    const dx = (u - s.u + (h - s.h) * s.angle) / s.w;
    value = Math.max(value, 1 - smooth(.66, 1.07, dx * dx + dy * dy));
  }
  return value;
}

function fishPigment(rgb, species, u, h, phase, marks) {
  // Age and individual differences alter pattern spacing, not the diagnostic marking.
  const cheek = 1 - smooth(.73, .89, u);
  if (species === 'neon') {
    const stripe = .57 + .055 * Math.sin((u - .09) * 3.5);
    const rear = (1 - smooth(.44, .62, u)) * smooth(.015, .085, u);
    layer(rgb, [179, 27, 35], band(h, .36, .18, .05) * rear);
    const extent = smooth(.035, .11, u) * (1 - smooth(.82, .93, u));
    layer(rgb, [25, 54, 67], band(h, stripe - .02, .115, .02) * extent * .88);
    layer(rgb, [10, 161, 191], band(h, stripe, .087, .02) * extent);
    layer(rgb, [78, 224, 224], band(h, stripe + .032, .029, .012) * extent * .85);
  } else if (species === 'zebra') {
    const wave = .017 * Math.sin(7.2 * u + phase * .25) + .028 * Math.sin(3 * u);
    const spacing = .178 + .012 * Math.sin(Math.PI * u);
    const stripeCoord = (h - wave - .14) / spacing;
    const stripe = band(fract(stripeCoord + .5), .5, .20, .045);
    const extent = (1 - smooth(.73, .84, u)) * smooth(.055, .17, h) * (1 - smooth(.87, 1, h));
    layer(rgb, [33, 53, 78], extent * stripe);
    const rim = band(fract(stripeCoord + .27), .5, .055, .035);
    layer(rgb, [217, 216, 165], rim * extent * .9);
  } else if (species === 'angelfish') {
    // The three main vertical bars taper at the belly; the narrow anterior bar crosses the eye.
    const bars = [[.08, .034], [.30, .054], [.56, .048], [.83, .036]];
    for (const [center, width] of bars) {
      const curve = .040 * (h - .45) + .015 * Math.sin(h * 6 + center * 11 + phase * .17);
      const strength = .65 + .31 * h;
      layer(rgb, [31, 37, 37], band(u, center + curve, width * (.55 + .57 * h), .014) * strength);
    }
    layer(rgb, [64, 64, 54], band(u, .437 + .023 * Math.sin(h * 3), .012, .01) * smooth(.53, .8, h) * .55);
  } else if (species === 'harlequin') {
    // A copper shoulder precedes a broad black wedge which narrows toward the tail.
    const wedge = clamp((u - .075) / .48);
    const top = .53 + .19 * wedge;
    const bottom = .51 - .36 * wedge;
    const leading = .54 + (h - .44) * .18 + .008 * Math.sin(h * 9);
    const mask = smooth(.075, .13, u) * (1 - smooth(leading - .009, leading + .009, u));
    const shape = smooth(bottom, bottom + .025, h) * (1 - smooth(top - .01, top + .01, h));
    layer(rgb, [32, 37, 46], mask * shape * .98);
    layer(rgb, [234, 161, 96], band(h, top + .016, .015, .009) * mask * .8);
    layer(rgb, [220, 141, 87], band(u, leading + .030, .023, .012) * band(h, .47, .19, .055) * .67);
  } else {
    const extent = cheek * band(h, .47, .32, .07);
    const motif = .5 + .5 * Math.sin(15 * u + 11 * h + Math.sin(18 * h + phase) * 1.6 + phase);
    layer(rgb, [45, 131, 126], extent * motif * (.70 - .35 * u));
    layer(rgb, guppyPigments[marks.variant], spotCoverage(u, h, marks.orange) * extent);
    layer(rgb, [29, 40, 45], spotCoverage(u, h, marks.dark) * extent * .94);
    layer(rgb, [78, 152, 159], band(h, .58 + .07 * Math.sin(8 * u), .024, .012) * extent * .6);
  }
}

function writeRGBA(pixels, index, rgb, alpha = 255) {
  pixels[index] = rgb[0]; pixels[index + 1] = rgb[1]; pixels[index + 2] = rgb[2]; pixels[index + 3] = alpha;
}

function paintBody(species, variant, marks) {
  const width = 256, height = 128;
  const color = new Uint8ClampedArray(width * height * 4);
  const relief = new Uint8ClampedArray(color.length);
  const pigment = palettes[species];
  const phase = variant * 1.37;
  const rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    const h = .5 - .5 * Math.cos(TAU * v);
    const midTone = smooth(.08, .49, h);
    const backTone = smooth(.51, .99, h);
    for (let x = 0; x < width; x++) {
      const u = (x + .5) / width;
      const dapple = pigmentNoise(u * 7, h * 4.8, variant);
      const flecks = pigmentNoise(u * 45, h * 23, variant + 17);
      const sheen = pigmentNoise(u * 15, h * 7, variant + 31);
      rgb[0] = pigment.belly[0]; rgb[1] = pigment.belly[1]; rgb[2] = pigment.belly[2];
      layer(rgb, pigment.side, midTone); layer(rgb, pigment.back, backTone);
      fishPigment(rgb, species, u + sheen * .025 + flecks * .007, h + dapple * .030 + flecks * .007, phase, marks);

      // Cool/warm flecks sit below the scales. The edge of the gill cover has
      // subtle pink perfusion; the top of the shoulder reflects cooler blues.
      const tone = 1 + dapple * .14 + flecks * .085;
      rgb[0] = rgb[0] * tone + sheen * 7;
      rgb[1] *= tone;
      rgb[2] = rgb[2] * tone - sheen * 10;
      const shoulder = band(u, .68, .11, .08) * band(h, .67, .13, .1);
      layer(rgb, [134, 169, 172], shoulder * (.04 + (sheen + .5) * .11));
      const flushed = band(u, .78, .07, .045) * band(h, .33, .12, .09);
      layer(rgb, [163, 117, 100], flushed * (.09 + .12 * (dapple + .5)));

      // Staggered arcs read as overlapping scales under grazing light. A single packed
      // linear texture carries height in red for bumpMap and roughness in green.
      const row = v * (species === 'angelfish' ? 38 : 24) + .32 * dapple + .30 * sheen + .16 * Math.sin(u * 7.5);
      const rowOffset = Math.floor(row) % 2 * .5;
      const scaleY = fract(row) * 2 - 1;
      const scaleX = u * (species === 'zebra' ? 40 : 31) + rowOffset + sheen * .59 + flecks * .18;
      const outerEdge = .26 + .34 * scaleY * scaleY;
      const edgeDistance = fract(scaleX - outerEdge + .5) - .5;
      const ridge = band(edgeDistance, .022, .055, .032);
      const groove = band(edgeDistance, -.052, .048, .024);
      const area = (1 - smooth(.66, .77, u)) * smooth(.02, .14, u) * (.36 + .64 * Math.sin(Math.PI * h));
      const cellShine = .5 + .5 * Math.sin(Math.floor(row) * 73.59 + Math.floor(scaleX) * 41.51 + phase);
      layer(rgb, scaleShadow, groove * .15 * area);
      layer(rgb, pearl, ridge * (.035 + cellShine * .14) * (.75 + .5 * sheen) * area);
      // Shoulder contour and a very fine paired opercular line, with a smooth cheek in front.
      const gill = .718 + .084 * (h - .46) ** 2 * 5 + .012 * Math.sin(h * 5);
      const cheek = smooth(.77, .87, u) * (1 - smooth(.91, 1, u)) * band(h, .40, .16, .1);
      layer(rgb, pearl, cheek * .22);
      const plate = band(h, .51, .31, .11);
      layer(rgb, [75, 73, 63], band(u, gill, .0028, .0018) * plate * .66);
      layer(rgb, pearl, band(u, gill + .009, .0035, .002) * plate * .55);
      const index = (y * width + x) * 4;
      writeRGBA(color, index, rgb);
      relief[index] = 100 + area * (ridge * 65 - groove * 34 + cellShine * 12 + flecks * 8);
      relief[index + 1] = 165 - area * (ridge * 39 + cellShine * 20);
      relief[index + 2] = 0; relief[index + 3] = 255;
    }
  }
  return {
    color: paintedTexture(species + ' flank colour', width, height, new Uint8Array(color.buffer), true),
    relief: paintedTexture(species + ' scale relief + roughness', width, height, new Uint8Array(relief.buffer), false),
  };
}

function paintFin(species, variant, isTail, spotsOnFin) {
  const width = 128, height = 96;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    const fan = Math.abs(v * 2 - 1);
    for (let x = 0; x < width; x++) {
      const u = (x + .5) / width;
      const rays = isTail ? 15 : 10;
      const blotch = pigmentNoise(u * 9, v * 7, variant + 8);
      const fray = pigmentNoise(u * 24, v * 21, variant + 61);
      const curve = .11 * Math.sin(Math.PI * u + v * 3) + .1 * (v - .5) * u + .09 * blotch;
      const rayCoord = v * rays + curve;
      const ray = band(fract(rayCoord + .5), .5, .075, .042);
      const branch = band(fract(rayCoord + .5 - smooth(.34, .99, u) * .34), .5, .045, .035);
      const finRay = Math.max(ray, branch * smooth(.35, .75, u) * .68);
      let opacity = .36 + .25 * (1 - u) + .29 * finRay;
      rgb[0] = 164; rgb[1] = 173; rgb[2] = 156;
      if (species === 'guppy') {
        layer(rgb, guppyPigments[variant], (isTail ? .94 : .62) * (.68 + .32 * u));
        const patch = spotCoverage(u + blotch * .11 + fray * .025, v - blotch * .05 + fray * .04, spotsOnFin);
        layer(rgb, [37, 57, 59], patch * (isTail ? .86 : .59) * (.93 + .14 * blotch));
        layer(rgb, [46, 83, 83], band(u, .86 + .038 * Math.sin(v * 15) + .034 * blotch, .017, .015) * (.24 + (blotch + .5) * .63));
        opacity = (isTail ? .84 : .56) + finRay * .12;
      } else if (species === 'harlequin') {
        layer(rgb, [167, 72, 43], .37 + .43 * fan);
      } else if (species === 'angelfish') {
        layer(rgb, [75, 79, 69], band(u, .37 + .23 * (v - .5), .05, .023) * .63);
        layer(rgb, [62, 65, 61], band(u, .71 + .13 * (v - .5), .028, .014) * .54);
      } else if (species === 'zebra') {
        layer(rgb, [44, 60, 77], band(fract(v * 4.55 + .14 * Math.sin(u * 2.8)), .49, .13, .03) * .8);
      } else {
        layer(rgb, [169, 126, 125], smooth(.35, .9, u) * .26);
      }
      layer(rgb, [92, 84, 67], finRay * .43);
      layer(rgb, [214, 200, 160], band(fract(rayCoord + .6), .5, .024, .018) * .44);
      const membraneTone = 1 + blotch * .11 + fray * .05;
      rgb[0] *= membraneTone; rgb[1] *= membraneTone; rgb[2] *= membraneTone;
      opacity *= .95 - smooth(.9, 1, u) * .25 + blotch * .06;
      writeRGBA(pixels, (y * width + x) * 4, rgb, 255 * clamp(opacity));
    }
  }
  return paintedTexture(species + (isTail ? ' caudal fin' : ' fin membrane'), width, height, new Uint8Array(pixels.buffer), true);
}

function createPattern(species, variant) {
  const rand = variation(variant);
  const marks = {
    variant,
    orange: spots(11, rand, [.13, .56], [.25, .5], .046),
    dark: spots(12, rand, [.08, .61], [.22, .55], .023),
  };
  const body = paintBody(species, variant, marks);
  const tailSpots = spots(25, rand, [.22, .69], [.05, .9], .032);
  return { ...body, tail: paintFin(species, variant, true, tailSpots), fin: paintFin(species, variant, false, tailSpots) };
}

// Textures are shared per species and pattern (at most 20 live sets), while each
// model has its own disposable materials. Losing the last reference frees GPU maps.
export function createFishMaterials(species, seed = 0) {
  if (!Object.hasOwn(palettes, species)) species = 'neon';
  const variant = Math.min(variants - 1, Math.floor(clamp(Number.isFinite(seed) ? seed : 0) * variants));
  const key = species + '-' + variant;
  let entry = textureCache.get(key);
  if (!entry) {
    entry = { textures: createPattern(species, variant), references: 0 };
    textureCache.set(key, entry);
  }
  const maps = entry.textures;
  const body = new THREE.MeshPhysicalMaterial({
    map: maps.color, bumpMap: maps.relief, bumpScale: .003,
    roughnessMap: maps.relief, roughness: .8, metalness: .19,
    iridescence: species === 'neon' ? .32 : .16, iridescenceIOR: 1.35,
    iridescenceThicknessMinimum: 160, iridescenceThicknessMaximum: 290,
    clearcoat: .16, clearcoatRoughness: .44,
  });
  function finMaterial(map) {
    const material = new THREE.MeshStandardMaterial({
      map, roughness: .61, metalness: .06, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, alphaTest: .04,
    });
    material.forceSinglePass = true;
    return material;
  }
  const tail = finMaterial(maps.tail), fin = finMaterial(maps.fin);
  const materials = { body, tail, fin };
  for (const material of Object.values(materials)) {
    entry.references++;
    const release = () => {
      material.removeEventListener('dispose', release);
      if (--entry.references > 0) return;
      for (const texture of Object.values(entry.textures)) texture.dispose();
      textureCache.delete(key);
    };
    material.addEventListener('dispose', release);
  }
  return materials;
}
