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
  discus:    { belly: [206, 148, 104], side: [183, 76, 48], back: [105, 76, 56] },
  cardinal:  { belly: [210, 191, 174], side: [115, 131, 126], back: [75, 81, 66] },
  rummynose: { belly: [219, 220, 207], side: [180, 193, 185], back: [112, 128, 111] },
  blackneon: { belly: [202, 210, 190], side: [142, 155, 138], back: [87, 99, 75] },
  cherrybarb:{ belly: [224, 174, 131], side: [185, 78, 60], back: [125, 77, 55] },
  tigerbarb: { belly: [234, 209, 156], side: [221, 166, 76], back: [143, 111, 53] },
  galaxy:    { belly: [173, 145, 110], side: [64, 89, 107], back: [49, 69, 71] },
  blackskirt:{ belly: [195, 204, 196], side: [164, 178, 177], back: [95, 103, 100] },
  boesemani: { belly: [214, 198, 157], side: [217, 145, 64], back: [129, 119, 72] },
  platy:     { belly: [240, 193, 133], side: [222, 116, 54], back: [166, 86, 44] },
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

// Species markings use the same local flank coordinates on both sides. Sizes and
// phases vary between residents while diagnostic stripes, bars and spots stay put.
const flankPatterns = {
  discus(rgb, u, h, phase, marks) {
    const bars = band(fract(8.7 * u + .18 * Math.sin(5 * h + phase * .25)), .5, .13, .09);
    layer(rgb, [66, 62, 54], .30 * bars);
    // Red turquoise discus have winding pale blue lines on the flanks and operculum.
    // A pair of dislocations makes individual streaks branch, then run out on the cheek.
    const forks = (Math.atan2(h-.57,1.4*(u-.29)) - Math.atan2(h-.36,1.1*(u-.69))) / TAU;
    const warp = pigmentNoise(6.1*u,4.5*h,marks.variant+65) + .47*pigmentNoise(11*u,7*h,marks.variant+30);
    const path = h * 8.7 + .72 * Math.sin(7.5*u + 3.1*h + phase*.28) + forks + 1.33*warp
      + .35 * Math.sin(15*u - 4.8*h) + .32 * Math.sin(16*h + 7*u + phase*.36) + .13*Math.cos(14*u-24*h);
    const row = Math.floor(path), across = fract(path);
    const width = .142 + .045*Math.sin(8*u+17*h+phase) + .025*Math.sin(19*u-7*h);
    let line = band(across, .50, width, .043);
    // Some streaks split into a finer side branch and meet again. Offset every
    // fork independently so the open loops do not form a regular lattice.
    const start = .09 + .61*noiseCorner(row,1,marks.variant+81);
    const span = .22 + .19*noiseCorner(row,7,marks.variant+28);
    const t = (u-start)/span;
    if (t>0 && t<1) {
      const arc = Math.sin(Math.PI*t);
      const branch = .5 + (row%2 ? -.41 : .41)*arc;
      line = Math.max(line,band(across,branch,.061+.031*arc,.03)*.92);
    }
    const breaks = .12 + .87 * smooth(-.71,.12,Math.sin(16*u + 12*h + phase) + .6*Math.cos(11*h - 13*u) + .9*warp);
    layer(rgb, [48, 123, 124], band(fract(path), .50, .24, .07) * breaks * .68);
    layer(rgb, [97, 199, 192], line * breaks * (.76 + .22*Math.sin(Math.PI*h)));
    layer(rgb, [164, 219, 201], band(fract(path), .56, .06, .035) * breaks * .65);
  },
  cardinal(rgb, u, h) {
    const stripe = .56 + .085 * Math.sin(2.8*u);
    const length = smooth(.01,.08,u) * (1-smooth(.84,.94,u));
    layer(rgb, [198, 35, 42], band(h, stripe-.24, .18, .042) * length);
    layer(rgb, [28, 73, 90], band(h, stripe, .108, .022) * length);
    layer(rgb, [14, 163, 196], band(h, stripe+.012, .075, .016) * length);
    layer(rgb, [79, 225, 216], band(h, stripe+.050, .026, .014) * length);
  },
  rummynose(rgb, u, h) {
    const edge = .74 - .045 * Math.cos((h-.58)*5);
    layer(rgb, [188, 41, 43], smooth(edge-.055,edge+.035,u) * (.68 + .31*smooth(.04,.36,h)));
    layer(rgb, [217, 59, 50], smooth(.86,.98,u) * .50);
    layer(rgb, [38, 43, 44], band(h, .50, .088, .03) * (1-smooth(.06,.23,u)));
    layer(rgb, [211, 221, 195], band(h, .62, .030, .02) * (1-smooth(.56,.72,u)) * .62);
  },
  blackneon(rgb, u, h) {
    const stripe = .61 + .041 * Math.sin(Math.PI*u);
    const length = (1-smooth(.79,.87,u));
    layer(rgb, [36, 49, 53], band(h, stripe-.13, .115, .035) * length);
    layer(rgb, [212, 223, 167], band(h, stripe+.024, .043, .012) * length);
    layer(rgb, [153, 206, 165], band(h, stripe-.004, .021, .010) * length * .87);
  },
  cherrybarb(rgb, u, h, phase) {
    const middle = .50 + .043 * Math.sin(Math.PI*u);
    const body = smooth(.035,.11,u) * (1-smooth(.79,.94,u));
    layer(rgb, [171, 55, 44], body * band(h, .46, .26, .09) * .62);
    layer(rgb, [101, 63, 53], body * band(h, middle, .043, .022) * (.52+.36*Math.cos(22*u + phase*.24)**2));
    layer(rgb, [79, 63, 52], band(u, .125, .046, .023) * band(h, middle, .066, .034));
  },
  tigerbarb(rgb, u, h) {
    // Four black bars cross the caudal peduncle, rear flank, dorsal shoulder and eye.
    const lean = h-.5;
    const bars = Math.max(band(u,.10+.025*lean,.050,.014), band(u,.37+.13*lean,.063,.016),
      band(u,.59+.15*lean,.068,.015), band(u,.845-.075*lean,.036,.012));
    layer(rgb, [34, 43, 42], bars * (.84+.15*smooth(.08,.45,h)));
    layer(rgb, [213, 101, 54], smooth(.90,.99,u) * .82);
  },
  galaxy(rgb, u, h, _phase, marks) {
    const row = h * 4.3, col = u * 12.6 + .5*(Math.floor(row)%2);
    const x = Math.floor(col), y = Math.floor(row);
    const dx = fract(col) - (.34 + .32*noiseCorner(x,y,marks.variant+39));
    const dy = fract(row) - (.31 + .38*noiseCorner(x,y,marks.variant+42));
    const radius = .17 + .11*noiseCorner(x,y,marks.variant+14);
    const dot = 1-smooth(radius-.048, radius+.025, Math.hypot(dx,dy));
    const flank = smooth(.025,.10,u) * (1-smooth(.70,.84,u)) * smooth(.09,.22,h) * (1-smooth(.88,.99,h));
    layer(rgb, [228, 211, 158], dot * flank);
    layer(rgb, [205, 127, 72], (1-smooth(.03,.22,h)) * .65);
  },
  blackskirt(rgb, u, h) {
    const rear = (1-smooth(.34,.60,u+.21*(h-.45))) * (.87-.34*h);
    layer(rgb, [57, 64, 65], rear);
    const bars = Math.max(band(u,.59-.045*(h-.5),.034,.013),band(u,.74-.024*(h-.5),.030,.013));
    layer(rgb, [43, 49, 49], bars * smooth(.13,.40,h) * .87);
  },
  boesemani(rgb, u, h) {
    const split = smooth(.44,.65,u-.045*Math.sin(h*5));
    layer(rgb, [83, 130, 159], split * (.64+.31*Math.sin(Math.PI*h)));
    layer(rgb, [115, 172, 181], split * band(h,.56,.21,.10) * .54);
    const bars = band(fract(u*14.5+.18*h), .5,.16,.08);
    layer(rgb, [84, 92, 99], bars * band(u,.54,.095,.055) * .53);
    layer(rgb, [238, 162, 68], (1-split) * band(h,.53,.26,.11) * .58);
  },
  platy(rgb, u, h, phase) {
    // A sunset platy fades from tangerine near the head to vermilion at the tail.
    const tail = 1-smooth(.13,.80,u+.06*Math.sin(5*h+phase*.24));
    layer(rgb, [201, 73, 47], tail * (.58+.25*Math.sin(Math.PI*h)));
    layer(rgb, [241, 171, 78], smooth(.4,.77,u) * band(h,.63,.21,.13) * .67);
  },
};

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
  // A discus flank spans almost as many screen pixels vertically as horizontally.
  const width = species === 'discus' ? 512 : 256, height = width / 2;
  const color = new Uint8ClampedArray(width * height * 4);
  const relief = new Uint8ClampedArray(color.length);
  const pigment = palettes[species];
  const paintFlank = flankPatterns[species] ?? ((rgb,u,h,phase,marks) => fishPigment(rgb,species,u,h,phase,marks));
  const scaleRows = species === 'discus' ? 46 : species === 'angelfish' ? 38 : 24;
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
      paintFlank(rgb, u + sheen * .025 + flecks * .007, h + dapple * .030 + flecks * .007, phase, marks);

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
      const row = v * scaleRows + .32 * dapple + .30 * sheen + .16 * Math.sin(u * 7.5);
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

// Row order matches the UVs of the merged fin mesh. The caudal fin has a
// separate map because its rays spread into a fan. Return the membrane opacity.
const finRows = ['dorsal', 'anal', 'pectoral', 'pelvic'];
const finPatterns = {
  discus(rgb, part, u, v, grain, phase) {
    if (part === 'pectoral') return .29;
    if (part === 'pelvic') {
      layer(rgb,[173,75,52],.78); layer(rgb,[126,190,174],smooth(.66,.98,u)*.76);
      return .73;
    }
    if (part === 'tail') {
      layer(rgb,[187,114,77],.63);
      layer(rgb,[111,165,151],band(u,.68+.06*Math.sin(9*v),.045,.025)*.64);
      return .54;
    }
    const path = v*9.5 + .58*Math.sin(8*u + v*9 + phase*.28) + .20*Math.sin(11*v - 9*u);
    layer(rgb,[169,77,56],.90);
    layer(rgb,[102,196,179],band(fract(path),.5,.17,.065)*(.65+.23*u));
    layer(rgb,[48,69,72],smooth(.90,.99,u)*.83);
    return .83;
  },
  cardinal(rgb, part, u) {
    layer(rgb,[156,183,180],.55);
    if (part === 'tail' || part === 'anal') layer(rgb,[188,111,100],(1-smooth(.05,.63,u))*.42);
    return .32;
  },
  rummynose(rgb, part, u, v, grain) {
    if (part !== 'tail') { layer(rgb,[195,204,197],.70); return .30; }
    const fan = Math.abs(2*v-1);
    const middle = 1-smooth(.14,.26,fan);
    const lobes = band(fan,.61+.12*u+.035*grain,.15,.045)*smooth(.24,.65,u);
    layer(rgb,[232,233,215],.98);
    layer(rgb,[26,34,36],Math.max(middle,lobes)*.99);
    return .91;
  },
  blackneon(rgb, part, u) {
    layer(rgb,[178,188,165],.65);
    if (part === 'tail') layer(rgb,[74,86,85],(1-smooth(.02,.30,u))*.36);
    return .34;
  },
  cherrybarb(rgb, part, u, v) {
    const t = part === 'pectoral' ? .34 : .82;
    layer(rgb,[190,78,55],t*(.68+.31*u));
    layer(rgb,[218,132,80],t*band(v,.5,.25,.15)*.28);
    return .35+.34*t;
  },
  tigerbarb(rgb, part, u, v) {
    if (part === 'pectoral') { layer(rgb,[206,170,107],.46); return .35; }
    if (part === 'dorsal' || part === 'anal') {
      layer(rgb,[45,49,43],.86);
      layer(rgb,[221,108,48],smooth(.51,.72,u+.11*v)*.95);
      return .76;
    }
    layer(rgb,[219,116,51],(.54+.36*Math.abs(v*2-1))*(.6+.4*u));
    return .62;
  },
  galaxy(rgb, part, u, v) {
    if (part === 'pectoral') { layer(rgb,[162,168,149],.60); return .32; }
    layer(rgb,[56,67,70],.91);
    const stripe = part === 'tail'
      ? band(Math.abs(2*v-1),.57+.15*(1-u),.21,.057)
      : band(u,.64+.06*Math.sin(v*3),.17,.055);
    layer(rgb,[212,100,63],stripe*.98);
    layer(rgb,[219,166,115],smooth(.92,.99,u)*.65);
    return .75;
  },
  blackskirt(rgb, part, u, v) {
    if (part === 'tail' || part === 'pectoral') { layer(rgb,[184,192,183],.72); return .37; }
    layer(rgb,[49,58,61],.74+.22*(1-u));
    layer(rgb,[119,128,124],smooth(.57,.99,u)*v*.53);
    return part === 'anal' ? .85 : .70;
  },
  boesemani(rgb, part, u, v) {
    if (part === 'pectoral') { layer(rgb,[179,186,156],.70); return .34; }
    layer(rgb,[219,160,84],.80);
    layer(rgb,[186,108,56],smooth(.74,.98,u)*.72);
    layer(rgb,[234,200,114],band(v,.50,.32,.16)*.34);
    return .62;
  },
  platy(rgb, part, u, v) {
    layer(rgb,[218,117,62],part === 'pectoral' ? .42 : .79);
    layer(rgb,[237,166,86],(1-smooth(.22,.9,u)) * band(v,.5,.30,.14)*.48);
    return part === 'pectoral' ? .33 : .62;
  },
};

export function hasFinAtlas(species) {
  return Object.hasOwn(finPatterns, species);
}

function paintFin(species, variant, isTail, spotsOnFin) {
  const paintMembrane = finPatterns[species];
  const width = 128, rowHeight = 96, height = rowHeight * (paintMembrane && !isTail ? finRows.length : 1);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const v = (y % rowHeight + .5) / rowHeight;
    const part = isTail ? 'tail' : finRows[Math.floor(y / rowHeight)];
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
      if (paintMembrane) {
        opacity = paintMembrane(rgb, part, u, v, blotch, variant*1.37) + .15*finRay;
      } else if (species === 'guppy') {
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

// Fish of the same species and variant share maps, while each model owns its
// materials. Losing the last reference frees the GPU textures.
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
    iridescence: ['neon','cardinal','blackneon','boesemani'].includes(species) ? .32 : .16, iridescenceIOR: 1.35,
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

// Colour the sampled skin and fins after their shared pigment maps are read.
// This uniform belongs to a single carcass; living fish keep the original shader.
export function applyDecayMaterial(material, decay) {
  material.roughness = .96;
  material.metalness = .015;
  if (material.isMeshPhysicalMaterial) {
    material.iridescence = 0;
    material.clearcoat = 0;
  }
  material.onBeforeCompile = shader => {
    shader.uniforms.corpseDecay = decay;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 skinPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nskinPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 skinPosition;\nuniform float corpseDecay;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float luminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float mottling = smoothstep(-0.7, 0.8, sin(skinPosition.x * 34.0 + sin(skinPosition.y * 47.0))
          + 0.55 * sin(skinPosition.z * 51.0 - skinPosition.x * 23.0));
        vec3 faded = mix(vec3(0.55, 0.57, 0.49), vec3(0.28, 0.24, 0.16), corpseDecay * mottling);
        diffuseColor.rgb = mix(diffuseColor.rgb, faded * (0.30 + luminance), 0.18 + 0.78 * corpseDecay);
      `);
  };
  material.needsUpdate = true;
}
