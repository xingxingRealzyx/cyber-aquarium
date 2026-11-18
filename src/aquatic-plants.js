import * as THREE from 'three';
import { substrateHeight } from './simulation.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const atlasSize = [1280, 1024];
const initialBeds = {
  vallisneria: [[-3.06,-1.2], [-1.9,-1.32], [2,-1.32], [3.02,-.94]],
  anubias: [[-3.04,.52], [-1.93,1.05], [1.64,1.06]],
  moss: [[2.59,1.22], [-2.46,.99]],
};
let atlas;

function randomStream(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = state + 0x6d2b79f5 | 0;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function loadAtlas(manager) {
  if (!atlas) {
    const loader = new THREE.TextureLoader(manager);
    const color = loader.load('./foliage/leaf-color.webp');
    const surface = loader.load('./foliage/leaf-surface.png');
    color.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [color, surface]) texture.anisotropy = 4;
    atlas = { color, surface, users: 0 };
  }
  atlas.users++;
  return atlas;
}

function addCurrent(shader, time) {
  shader.uniforms.plantTime = time;
  shader.vertexShader = 'attribute float flex; uniform float plantTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    float phase = position.x * .82 + position.z * .78;
    transformed.x += flex * (.057 * sin(.75 * plantTime + phase) + .016 * sin(1.2 * plantTime + phase * 2.0));
    transformed.z += flex * .029 * sin(.59 * plantTime + phase * 1.4);
  `);
}

function leafMaterials(time, manager) {
  const maps = loadAtlas(manager);
  const material = new THREE.MeshStandardMaterial({
    map: maps.color, bumpMap: maps.surface, bumpScale: .012, roughnessMap: maps.surface,
    roughness: 1, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    addCurrent(shader, time);
    // A little backlighting through green tissue; follows the actual aquarium lamp.
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        float backlight = max(0.0, -dot(normal, directionalLights[0].direction));
        reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * backlight * vec3(.053,.091,.029);
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'aquatic-leaf-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => addCurrent(shader, time);
  depth.customProgramCacheKey = () => 'aquatic-leaf-shadow-v1';
  material.addEventListener('dispose', function release() {
    material.removeEventListener('dispose', release);
    depth.dispose();
    maps.users--;
    // The next planting can acquire these same textures during a synchronous rebuild.
    queueMicrotask(() => {
      if (maps.users || atlas !== maps) return;
      maps.color.dispose();
      maps.surface.dispose();
      atlas = undefined;
    });
  });
  return { material, depth };
}

// All leaves, petioles, rhizomes and moss branches share one indexed surface and texture atlas.
class PlantMesh {
  positions = [];
  colors = [];
  uv = [];
  flex = [];
  indices = [];

  vertex(point, tile, u, t, tint, shade, flex) {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
    const padU = 3 / atlasSize[0], padV = 3 / atlasSize[1];
    this.uv.push((tile % 4) / 4 + padU + u * (.25 - padU * 2),
      (1 - Math.floor(tile / 4)) / 2 + padV + t * (.5 - padV * 2));
    this.flex.push(flex);
    return index;
  }

  grid(rows, columns, tile, tint, sample) {
    const first = this.positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const t = row / rows, u = column / columns;
        const { point, shade, flex } = sample(t, u * 2 - 1);
        this.vertex(point, tile, u, t, tint, shade, flex);
        if (row < rows && column < columns) {
          const i = first + row * (columns + 1) + column;
          this.indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
        }
      }
    }
  }

  stem(points, radius, tint, flex = 0, sides = 6) {
    const first = this.positions.length / 3;
    let normal = v3(1, 0, 0);
    for (let i = 0; i < points.length; i++) {
      const t = i / (points.length - 1);
      const tangent = points[Math.min(points.length - 1, i + 1)].clone()
        .sub(points[Math.max(0, i - 1)]).normalize();
      if (Math.abs(tangent.dot(normal)) > .95) normal = v3(0, 0, 1);
      normal.addScaledVector(tangent, -tangent.dot(normal)).normalize();
      const side = tangent.clone().cross(normal);
      const width = radius * (1 - .65 * t);
      for (let j = 0; j <= sides; j++) {
        const a = TAU * j / sides;
        const p = points[i].clone().addScaledVector(normal, width * Math.cos(a)).addScaledVector(side, width * Math.sin(a));
        const k = this.vertex(p, 7, j / sides, t, tint, .72 + .28 * t, flex * t);
        if (i < points.length - 1 && j < sides) {
          this.indices.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1);
        }
      }
    }
  }

  finish() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('flex', new THREE.Float32BufferAttribute(this.flex, 1));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += .2;
    return geometry;
  }
}

function grassBlade(batch, root, height, halfWidth, heading, leanX, leanZ, rng, short = false) {
  const twist = (rng() - .43) * (short ? 1.1 : 3.6);
  const phase = rng() * TAU;
  const young = rng() < .32, tipDrop = rng() * .16;
  const brightness = .76 + rng() * .25;
  const tint = [brightness * (.91 + rng() * .12), brightness, brightness * (.86 + rng() * .16)];
  batch.grid(short ? 8 : 27, short ? 2 : 4, short ? 6 : Number(young), tint, (t, q) => {
    const wave = Math.sin(t * 6.1 + phase) * t;
    // Long supple blades first bow into the current, then undulate along it.
    const sweep = short ? 0 : Math.sin(t * 7.8 + phase) * Math.sin(Math.PI * t) * height * .073;
    const midX = root.x + leanX * t ** 1.65 + wave * height * .039 + sweep;
    const midZ = root.z + leanZ * t ** 1.8 + Math.sin(t * 5.2 + phase) * t * height * .030;
    const midY = root.y + height * (t - tipDrop * (short ? 1 : 2.0) * t ** 5);
    const width = halfWidth * (.19 + .81 * (1 - Math.exp(-19 * t))) * Math.max(.012, 1 - t ** 7) ** .72;
    const angle = heading + twist * t ** 1.1 + wave * .28;
    const curled = width * (.18 * q * q + .065 * Math.cos(7 * t + phase) * q);
    return {
      point: v3(midX + Math.cos(angle) * q * width - Math.sin(angle) * curled,
        midY - width * q * Math.sin(t * 3.7 + phase) * .36,
        midZ + Math.sin(angle) * q * width + Math.cos(angle) * curled),
      shade: .67 + .32 * Math.min(1, t * 3.3),
      flex: t ** 1.6 * height * (short ? .28 : .77),
    };
  });
}

function vallisneria(batch, x, z, growth, rng) {
  const clumpAngle = rng() * TAU;
  // Outer blades spring from older offsets along a runner, inner shoots stay upright.
  for (let i = 0; i < 20; i++) {
    const head = clumpAngle + i * 2.399 + rng() * .4;
    const runner = (i % 3 - 1) * .17;
    const root = v3(x + runner * Math.cos(clumpAngle) + Math.cos(head) * .09, 0,
      z + runner * Math.sin(clumpAngle) + Math.sin(head) * .09);
    root.y = substrateHeight(root.x, root.z) - .035;
    const height = Math.min((1.46 + rng() * 1.75) * growth, 3.98 - root.y);
    const spread = .28 + rng() * .58;
    const current = (.18 + rng() * .41) * (x > 0 ? -1 : 1);
    const leanX = clamp(Math.cos(head) * spread + current, -3.71 - root.x, 3.71 - root.x);
    const leanZ = clamp(Math.sin(head) * spread + .13, -1.69 - root.z, 1.69 - root.z);
    grassBlade(batch, root, height, (.041 + rng() * .033) * growth, head, leanX, leanZ, rng);
  }
}

function anubias(batch, x, z, growth, rng) {
  const angle = rng() * TAU;
  const rhizome = [];
  for (let i = 0; i < 7; i++) {
    const along = (i / 6 - .5) * .68 * growth;
    const rx = x + Math.cos(angle) * along, rz = z + Math.sin(angle) * along;
    rhizome.push(v3(rx, substrateHeight(rx, rz) + .045, rz));
  }
  batch.stem(rhizome, .04 * growth, [.7,.78,.5]);
  for (let k = 0; k < 14; k++) {
    const base = rhizome[k % rhizome.length];
    const a = angle + k * 2.399 + rng() * .6;
    const forward = v3(Math.sin(a), 0, Math.cos(a));
    const lateral = v3(Math.cos(a), 0, -Math.sin(a));
    const reach = (.10 + rng() * .19) * growth;
    const rise = (.14 + rng() * .36) * growth;
    const petiole = [0,.33,.66,1].map(t => {
      const p = base.clone().addScaledVector(forward, reach * t ** 1.35);
      p.y += rise * t;
      return p;
    });
    batch.stem(petiole, .011 * growth, [.85,1,.72], .055);
    const origin = petiole[3];
    const length = (.33 + rng() * .37) * growth;
    const width = length * (.25 + rng() * .10), tilt = .13 + rng() * .65;
    const curl = .1 + rng() * .20, skew = (rng() - .5) * .20;
    const roll = (rng() - .5) * .88, phase = rng() * TAU;
    const young = rng() < .28, shade = .83 + .19 * rng();
    const tint = [shade * (.95 + rng() * .11), shade, shade * (.91 + rng() * .13)];
    batch.grid(18, 8, young ? 3 : 2, tint, (t, q) => {
      const s = Math.sin(Math.PI * t);
      const span = width * (.009 + Math.max(0, s) ** .72 * (1.22 - .43 * t));
      const edge = Math.abs(q);
      const p = origin.clone().addScaledVector(forward, length * t)
        .addScaledVector(lateral, q * span + skew * s * width);
      p.y += length * (tilt * t + s * .16 - curl * t ** 3);
      p.y += span * (q * (roll + .2 * Math.sin(t * 4 + phase)) - edge ** 1.6 * .22);
      p.y += span * edge ** 2 * Math.sin(t * 20 + phase) * .038;
      return { point: p, shade: .83 + .16 * Math.min(1, t * 3), flex: .055 + t * .19 };
    });
  }
}

function mossLeaf(batch, origin, tip, width, tile, tint) {
  const d = tip.clone().sub(origin);
  const side = v3(-d.z, .04 * d.length(), d.x).normalize().multiplyScalar(width);
  const root = batch.vertex(origin, tile, .5, 0, tint, .80, .022);
  for (const t of [.32,.68]) {
    const center = origin.clone().lerp(tip, t);
    center.y += width * Math.sin(t * Math.PI) * .6;
    for (const q of [-1,0,1]) {
      const p = center.clone().addScaledVector(side, q * (t < .5 ? 1 : .74));
      p.y += (1 - Math.abs(q)) * width * .24;
      batch.vertex(p, tile, (q+1)/2, t, tint, .91 + t * .1, .022 + t * .015);
    }
  }
  batch.vertex(tip, tile, .5, 1, tint, 1, .037);
  for (const offset of [0,1,2, 0,2,3, 1,4,2, 2,4,5, 2,5,3, 3,5,6, 4,7,5, 5,7,6]) {
    batch.indices.push(root + offset);
  }
}

function moss(batch, x, z, growth, rng) {
  // Creeping axes carry short alternate side shoots, each with overlapping pointed leaflets.
  for (let i = 0; i < 23; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng());
    const px = x + Math.cos(a) * r * .37, pz = z + Math.sin(a) * r * .29;
    const h = (.15 + .19 * (1 - r) + rng() * .12) * growth;
    const axis = v3(Math.cos(a + .6), 0, Math.sin(a + .6));
    const across = v3(-axis.z, 0, axis.x);
    const base = v3(px, substrateHeight(px, pz) - .014, pz);
    const point = t => {
      const p = base.clone().addScaledVector(axis, h * t * (.34 + t * .34));
      p.y += h * (t - .13 * t * t);
      return p;
    };
    batch.stem([0,.25,.5,.75,1].map(point), .007 * growth, [.73,.78,.49], .03, 4);
    const tint = [.80 + rng() * .16, .83 + rng() * .16, .76 + rng() * .13];
    for (let j = 1; j <= 8; j++) {
      const t = j / 9.5;
      const side = j % 2 ? -1 : 1;
      const node = point(t);
      const length = (.085 + .105 * Math.sin(t * Math.PI)) * growth;
      const b = across.clone().multiplyScalar(side);
      b.addScaledVector(axis, .25 + rng() * .40);
      b.y = .25 + rng() * .5;
      b.normalize();
      const branchPoint = f => {
        const p = node.clone().addScaledVector(b, length * f);
        p.y += length * (.14 * Math.sin(f * Math.PI) + .18 * f * f);
        return p;
      };
      batch.stem([node,branchPoint(.45),branchPoint(.75),branchPoint(1)], .0035 * growth, tint, .027, 3);
      for (let k = 0; k < 8; k++) {
        const f = (k + .35 + rng() * .25) / 8, polarity = k % 2 ? 1 : -1;
        const anchor = branchPoint(f);
        const size = (.034 + .032 * (1 - f)) * growth;
        const tip = anchor.clone().addScaledVector(b, size * .64)
          .addScaledVector(axis, polarity * size * .68);
        tip.y += size * (.23 + .32 * rng());
        mossLeaf(batch, anchor, tip, size * .18, f > .64 ? 5 : 4, tint);
      }
    }
  }
}

function foreground(batch) {
  const rng = randomStream('rooted marginal grasses');
  for (const [x,z] of [[-3.35,.92],[-2.9,1.13],[-2.2,1.33],[-.92,.77],[1.29,.88],[2.51,1.38],[3.14,.96],[3.16,-.23],[-3.24,-.23]]) {
    for (let i = 0; i < 7; i++) {
      const rx = x + (rng() - .5) * .52, rz = z + (rng() - .5) * .43;
      const root = v3(rx, substrateHeight(rx,rz) - .015, rz);
      const height = .085 + rng() * .13;
      for (let j = 0; j < 5; j++) {
        const a = rng() * TAU, h = height * (.6 + rng() * .7);
        grassBlade(batch, root, h, .008 + rng() * .012, a, Math.sin(a)*h*.65, Math.cos(a)*h*.65, rng, true);
      }
    }
  }
}

export function createAquaticPlants(plants, time, manager) {
  const group = new THREE.Group();
  group.name = 'Aquatic vegetation';
  const batch = new PlantMesh();
  const counts = { vallisneria: 0, anubias: 0, moss: 0 };
  const grow = { vallisneria, anubias, moss };
  for (const plant of plants) {
    const kind = Object.hasOwn(grow, plant.species) ? plant.species : 'vallisneria';
    const rng = randomStream(plant.seed ?? plant.id ?? counts[kind]);
    const position = initialBeds[kind][counts[kind]++];
    const x = position?.[0] ?? (rng() - .5) * 6.4;
    const z = position?.[1] ?? (kind === 'vallisneria' ? -1.39 + rng() * .63 : (rng() - .43) * 2.8);
    const size = clamp(Math.cbrt(plant.biomass ?? 1), .54, 1.25);
    grow[kind](batch, x, z, size, rng);
  }
  foreground(batch);
  const { material, depth } = leafMaterials(time, manager);
  const leaves = new THREE.Mesh(batch.finish(), material);
  leaves.name = 'Textured leaves, stems and moss';
  leaves.customDepthMaterial = depth;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  group.add(leaves);
  return group;
}
