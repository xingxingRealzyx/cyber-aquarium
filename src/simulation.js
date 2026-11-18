import { INFECTIONS, createInfectionClock, restoreInfectionClock, restoreInfection, startScheduledInfection, advanceInfection } from './fish-health.js';

export { INFECTIONS };

/** Freshwater ecosystem model. Nitrogen concentrations are mg N/L, time is hours. */
export const SPECIES = Object.freeze({
  neon: { maturityDays: 1.25, lifespanDays: 7, name: '霓虹灯鱼', latin: 'Paracheirodon innesi', mass: 0.35, temperature: [21, 27], ph: [6, 7.8], sensitivity: 1.1, type: 'fish' },
  guppy: { maturityDays: .75, lifespanDays: 4, name: '孔雀鱼', latin: 'Poecilia reticulata', mass: 0.65, temperature: [22, 28], ph: [6.8, 8.2], sensitivity: 0.9, type: 'fish' },
  angelfish: {
    maturityDays: 1.5, lifespanDays: 10, name: '神仙鱼', latin: 'Pterophyllum scalare', type: 'fish',
    mass: 1.25, temperature: [24, 29], ph: [6, 7.6], sensitivity: 1.05,
    swim: { cruiseSpeed: 0.36, cruisingHeight: 1.65, pace: 0.68 },
  },
  zebra: {
    maturityDays: 1, lifespanDays: 6, name: '斑马鱼', latin: 'Danio rerio', type: 'fish',
    mass: 0.42, temperature: [22, 28], ph: [6.5, 8], sensitivity: 0.95,
    swim: { cruiseSpeed: 0.78, cruisingHeight: 2.30, pace: 1.50 },
  },
  harlequin: {
    maturityDays: 1.25, lifespanDays: 7, name: '三角灯鱼', latin: 'Trigonostigma heteromorpha', type: 'fish',
    mass: 0.58, temperature: [23, 28], ph: [6, 7.5], sensitivity: 1.05,
    swim: { cruiseSpeed: 0.58, cruisingHeight: 1.90, pace: 1.08 },
  },
  shrimp: { name: '樱花虾', latin: 'Neocaridina davidi', mass: 0.15, temperature: [20, 27], ph: [6.5, 8], sensitivity: 1.25, type: 'invertebrate' },
  snail: { name: '斑马螺', latin: 'Vittina natalensis', mass: 0.4, temperature: [22, 28], ph: [6.8, 8.2], sensitivity: 0.75, type: 'invertebrate' },
});

export const PLANTS = Object.freeze({
  vallisneria: { name: '苦草', latin: 'Vallisneria spiralis', uptake: 1.25 },
  anubias: { name: '小水榕', latin: 'Anubias barteri var. nana', uptake: 0.5 },
  moss: { name: '爪哇莫丝', latin: 'Taxiphyllum barbieri', uptake: 0.7 },
});

export const HARDSCAPE = Object.freeze({
  stone: { name: '溪石', starterCount: 12 },
  wood: { name: '沉木', starterCount: 5 },
});

const MAX_ANIMALS = 80;
export const MAX_PLANTS = 40;
export const MAX_HARDSCAPE = 40;
export const MAX_BED_PELLETS = 160;
const MAX_SURFACE_PELLETS = 160;
const MAX_FALLING_PELLETS = 320;
const CROWDED_FEED_PARTICLES = 8;
export const MAX_FOOD_PELLETS = MAX_BED_PELLETS + MAX_FALLING_PELLETS;
const FOOD_SURFACE_Y = 3.85;
const STEP = 1 / 12;
let sequence = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numeric = (value, fallback, min = 0, max = 1e6) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
const key = prefix => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
const decayFraction = (rate, dt) => 1 - Math.exp(-rate * dt);

function record(state, message, type = 'info') {
  state.events.unshift({ id: key('event'), time: state.elapsedHours, type, message });
  state.events.length = Math.min(state.events.length, 50);
}

const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const seedFromId = value => { let hash = 2166136261; for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0) / 4294967296; };
export const substrateHeight = (x,z) => 0.24 + 0.17 * (z + 2) / 4 + 0.18 * Math.exp(-((x + 2.3) ** 2 + (z - 0.3) ** 2) / 2.5) + 0.045 * Math.sin(x * 1.7 + z);

function animal(species, serial = 1, seed = Math.random()) {
  const x = (random(seed + 31) - .5) * 5.5, z = (random(seed + 32) - .5) * 2.2;
  const spec = SPECIES[species];
  const fish = spec.type === 'fish';
  const ageAtStocking = fish ? spec.maturityDays * 24 * (.25 + .2 * random(seed + 24)) : 0;
  const size = fish
    ? adultSize(seed) * (.58 + .34 * ageAtStocking / (spec.maturityDays * 24))
    : .85 + random(seed + 21) * .35;
  const mass = spec.mass * size ** (fish ? 3 : 2);
  return {
    id: key('animal'), species, serial, label: `${SPECIES[species].name} #${String(serial).padStart(2,'0')}`,
    health: 100, hunger: 12 + random(seed + 9) * 30, alive: true,
    ageHours: 0, deathHours: null, seed, corpseMass: 0, stress: 0, causeOfDeath: null,
    size, mass, metabolism: .85 + random(seed + 22) * .3,
    ...(fish && {
      infection: null,
      lifeAgeHours: ageAtStocking,
      lifespanHours: spec.lifespanDays * 24 * (.85 + .3 * random(seed + 23)),
    }),
    position: { x, y: fish ? 1.5 + random(seed + 33) * 1.4 : substrateHeight(x,z) + .025, z },
    velocity: { x: fish ? .45 : .03, y: 0, z: 0 },
    behavior: fish ? 'swimming' : 'grazing', targetFoodId: null,
    lastMealHours: null, totalEatenGrams: 0, bites: 0, biteFlash: 0, biteCooldown: 0,
  };
}

function adultSize(seed) {
  return 1.05 + random(seed + 21) * .2;
}

export function fishLifeStage(a) {
  const spec = SPECIES[a.species];
  if (spec.type !== 'fish') return null;
  if (a.lifeAgeHours < spec.maturityDays * 24) return 'juvenile';
  return a.lifeAgeHours < a.lifespanHours * .8 ? 'adult' : 'senior';
}

export function corpseDecay(a) {
  return a.alive ? 0 : clamp(1 - a.corpseMass / a.mass, 0, 1);
}

function growFish(a, spec, dt) {
  a.lifeAgeHours += dt;
  if (a.lifeAgeHours >= .8 * a.lifespanHours) return;
  const targetSize = adultSize(a.seed);
  if (a.size >= targetSize) return;
  const condition = clamp((80 - a.hunger) / 50, 0, 1) * clamp((a.health - 35) / 55, 0, 1);
  const remainingMass = Math.max(0, spec.mass * targetSize ** 3 - a.mass);
  // Stored satiety, replenished by actual bites, supports growth on the game clock.
  const growth = Math.min(remainingMass * decayFraction(3 * condition / (spec.maturityDays * 24), dt),
    a.mass * ((targetSize / a.size) ** 3 - 1));
  // Scale visible length consistently with the individual fish's change in wet mass.
  a.size *= Math.cbrt(1 + growth / a.mass);
  a.mass += growth;
}

export function reconcileFood(state) {
  state.foodPellets = (state.foodPellets || []).filter(p => Number.isFinite(p.mass) && p.mass > 1e-10);
  state.food = state.foodPellets.reduce((sum,p) => sum + p.mass, 0);
}

export function isSettledPellet(p) {
  return p.y <= substrateHeight(p.x, p.z) + .041;
}

export function nearestPellet(pellets, x, y, z) {
  let nearest, distance = Infinity;
  for (const p of pellets) {
    const squared = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (squared < distance) { nearest = p; distance = squared; }
  }
  return nearest;
}

// At full capacity, combine the closest suspended grains so the next dose can
// enter at the surface. Keep the heavier grain's trajectory and the entire bed.
function combineClosestFallingPair(falling) {
  let shortestDistance = Infinity;
  let first = 0, second = 1;
  for (let i = 0; i < falling.length; i++) {
    const a = falling[i];
    for (let j = i + 1; j < falling.length; j++) {
      const b = falling[j];
      const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (distance < shortestDistance) {
        shortestDistance = distance;
        first = i;
        second = j;
      }
    }
  }
  if (falling[first].mass < falling[second].mass) [first, second] = [second, first];
  falling[first].mass += falling[second].mass;
  falling[second].mass = 0;
  falling.splice(second, 1);
}

function addPellets(state, amount, seed = Math.random(), settled = false) {
  if (!(amount > 0)) return;
  state.foodPellets ||= [];
  const count = Math.min(40, Math.max(12, Math.ceil(amount / .0025)));
  const existing = state.foodPellets.filter(p => isSettledPellet(p) === settled);
  const recipients = settled ? existing : existing.filter(p => p.y >= FOOD_SURFACE_Y);
  if (!settled && recipients.length === 0 && existing.length >= MAX_FALLING_PELLETS) {
    const target = MAX_FALLING_PELLETS - CROWDED_FEED_PARTICLES;
    while (existing.length > target) combineClosestFallingPair(existing);
  }
  const slots = settled
    ? MAX_BED_PELLETS - existing.length
    : Math.min(MAX_FALLING_PELLETS - existing.length, MAX_SURFACE_PELLETS - recipients.length);
  for (let i = 0; i < count; i++) {
    const pelletSeed = random(seed + i * 1.37);
    const x = (random(pelletSeed + 41) - .5) * 2.4, z = .4 + (random(pelletSeed + 42) - .5) * 1.1;
    const y = settled ? substrateHeight(x,z) + .04 : 3.88 + random(pelletSeed + 43) * .1;
    if (i >= slots) {
      const nearby = nearestPellet(recipients, x, y, z);
      nearby.mass += amount / count;
    } else {
      const pellet = { id: key('pellet'), x, y, z, mass: amount / count, ageSeconds: settled ? 40 : 0, seed: pelletSeed };
      recipients.push(pellet);
      state.foodPellets.push(pellet);
    }
  }
  reconcileFood(state);
}

/** A real mouth contact is the only way a fish can eat water-column feed. */
export function consumePellet(state, animalId, pelletId) {
  const a = state.animals.find(item => item.id === animalId);
  const p = state.foodPellets?.find(item => item.id === pelletId);
  if (state.paused || !a?.alive || !p || a.hunger < 8 || a.biteCooldown > 0 || !a.position) return { ok: false, grams: 0 };
  const dx = p.x - a.position.x, dy = p.y - a.position.y, dz = p.z - a.position.z;
  if (Math.hypot(dx,dy,dz) > .30) return { ok: false, grams: 0 };
  const v = a.velocity || {x:0,y:0,z:0};
  if (Math.hypot(v.x,v.y,v.z) > .03 && dx*v.x + dy*v.y + dz*v.z < -.01) return { ok: false, grams: 0 };
  const mass = a.mass || SPECIES[a.species].mass;
  const amount = Math.min(p.mass, mass * .0045, mass * .02 * (a.hunger - 2) / 85);
  if (!(amount > 0)) return { ok: false, grams: 0 };
  p.mass -= amount;
  a.hunger = Math.max(2, a.hunger - amount / (mass * .02) * 85);
  a.lastMealHours = state.elapsedHours; a.totalEatenGrams += amount; a.bites += 1;
  a.biteFlash = .45; a.biteCooldown = .8; a.behavior = 'eating';
  // Approximate feed nitrogen: 55% excreted, 35% solid waste, 10% retained.
  state.water.ammonia += amount * 70 / state.volumeLiters * .55;
  state.detritus += amount * .35;
  reconcileFood(state);
  return { ok: true, grams: amount };
}

function availableSlot(used, preferred, limit) {
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < limit && !used.has(preferred)) return preferred;
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

function plant(species, slot) {
  return { id: key('plant'), species, slot, biomass: 1, seed: Math.random() };
}

/** Equilibrium fraction, freshwater Emerson formulation (temperature in °C). */
export function ammoniaFraction(temperature, ph) {
  const pKa = 0.09018 + 2729.92 / (273.15 + clamp(temperature, 0, 50));
  return 1 / (1 + 10 ** (pKa - clamp(ph, 0, 14)));
}

export function createInitialState() {
  const state = {
    version: 1, elapsedHours: 0, speed: 1, paused: false, volumeLiters: 60,
    infectionClock: createInfectionClock(0),
    water: { temperature: 25, ph: 7.2, ammonia: 0.015, nitrite: 0.008, nitrate: 5, oxygen: 7.8, clarity: 0.98, unionizedAmmonia: 0 },
    equipment: { filter: true, aerator: true, light: true, heater: true, targetTemperature: 25 },
    animals: ['neon', 'neon', 'neon', 'neon', 'neon', 'neon', 'guppy', 'guppy', 'guppy', 'shrimp', 'shrimp', 'snail'].map((species,index) => animal(species,index + 1)),
    plants: Object.entries({ vallisneria: 4, anubias: 3, moss: 2 })
      .flatMap(([species, count]) => Array.from({ length: count }, (_, slot) => plant(species, slot))),
    hardscape: Object.entries(HARDSCAPE).flatMap(([kind, { starterCount }]) =>
      Array.from({ length: starterCount }, (_, slot) => ({ id: key('scenery'), kind, slot }))),
    bacteria: { ammonia: 1, nitrite: 1 }, food: 0, foodPellets: [], detritus: 0.01,
    nextAnimalNumber: 13, behaviorSeconds: 0,
    alkalinity: 4, events: [], history: [], lastFedHours: null, lastWaterChangeHours: 0,
    lastAssessmentLevel: 'good', lastHistoryHour: -1,
  };
  state.water.unionizedAmmonia = state.water.ammonia * ammoniaFraction(state.water.temperature, state.water.ph);
  record(state, '60 L 淡水缸已建立，生物过滤已成熟。少量投喂，定期换水。');
  return state;
}

export function addAnimal(state, species) {
  if (!Object.hasOwn(SPECIES, species)) return { ok: false, message: '未知生物种类' };
  if (state.animals.length >= MAX_ANIMALS) return { ok: false, message: `鱼缸最多容纳 ${MAX_ANIMALS} 只生物，请先清理死亡个体。` };
  const added = animal(species, state.nextAnimalNumber++);
  state.animals.push(added);
  record(state, `加入 1 只${SPECIES[species].name}；生物负载增加。`);
  return { ok: true, animal: added, message: `已加入${SPECIES[species].name}` };
}

export function careForFish(state, id) {
  const fish = state.animals.find(a => a.id === id);
  if (!fish?.alive || !fish.infection) return { ok: false, message: '这条鱼当前无需感染护理' };
  if (fish.infection.cared) return { ok: false, message: '这条鱼已在护理中' };
  fish.infection.cared = true;
  const message = `已开始护理${fish.label}，请留意恢复情况。`;
  record(state, message);
  return { ok: true, message };
}

export function removeAnimal(state, id) {
  const index = state.animals.findIndex(animal => animal.id === id);
  if (index < 0) return { ok: false, message: '这只生物已不在缸中' };
  const [animal] = state.animals.splice(index, 1);
  const message = animal.alive ? `已移出${animal.label}` : `已捞起${animal.label}的遗骸`;
  record(state, message);
  return { ok: true, message };
}

export function addPlant(state, species) {
  if (!Object.hasOwn(PLANTS, species)) return { ok: false, message: '未知水草种类' };
  if (state.plants.length >= MAX_PLANTS) return { ok: false, message: `最多种植 ${MAX_PLANTS} 丛水草。` };
  const used = new Set(state.plants.filter(item => item.species === species).map(item => item.slot));
  const added = plant(species, availableSlot(used, null, MAX_PLANTS));
  state.plants.push(added);
  record(state, `种下 1 丛${PLANTS[species].name}。`);
  return { ok: true, plant: added, message: `已种下${PLANTS[species].name}` };
}

export function addHardscape(state, kind) {
  if (!Object.hasOwn(HARDSCAPE, kind)) return { ok: false, message: '未知造景种类' };
  if (state.hardscape.length >= MAX_HARDSCAPE) return { ok: false, message: `最多放置 ${MAX_HARDSCAPE} 件造景。` };
  const used = new Set(state.hardscape.filter(item => item.kind === kind).map(item => item.slot));
  const added = { id: key('scenery'), kind, slot: availableSlot(used, null, MAX_HARDSCAPE) };
  state.hardscape.push(added);
  const message = `已放入${HARDSCAPE[kind].name} #${added.slot + 1}`;
  record(state, message);
  return { ok: true, item: added, message };
}

function removeSceneryItem(state, items, id, label) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return { ok: false, message: '该物件已不在缸中' };
  const [item] = items.splice(index, 1);
  const message = `已移出${label(item)} #${item.slot + 1}`;
  record(state, message);
  return { ok: true, message };
}

export function removePlant(state, id) {
  return removeSceneryItem(state, state.plants, id, plant => PLANTS[plant.species].name);
}

export function removeHardscape(state, id) {
  return removeSceneryItem(state, state.hardscape, id, item => HARDSCAPE[item.kind].name);
}

/** Adds dry food in grams. Excess remains in the tank, consuming oxygen as it decays. */
export function feed(state, grams = 0.08) {
  if (!Number.isFinite(grams) || grams <= 0) return { ok: false, message: '投喂量必须大于 0' };
  const amount = clamp(grams, 0.001, 5);
  addPellets(state, amount);
  state.lastFedHours = state.elapsedHours;
  record(state, `投喂 ${amount.toFixed(2)} g 饲料${state.food > 0.4 ? '，残饵偏多，会耗氧并产生氨。' : '。'}`, state.food > 0.4 ? 'warning' : 'info');
  return { ok: true, grams: amount, message: `投喂 ${amount.toFixed(2)} g` };
}

/** Assumes dechlorinated, temperature-matched source water, with zero nitrogen. */
export function changeWater(state, fraction = 0.25) {
  if (!Number.isFinite(fraction) || fraction <= 0) return { ok: false, message: '换水比例必须大于 0' };
  const portion = clamp(fraction, 0, 1);
  for (const field of ['ammonia', 'nitrite', 'nitrate']) state.water[field] *= 1 - portion;
  state.water.oxygen += (7.8 - state.water.oxygen) * portion;
  state.water.clarity += (1 - state.water.clarity) * portion;
  // Mix hydrogen ion concentrations instead of linearly interpolating pH.
  state.water.ph = -Math.log10(10 ** -state.water.ph * (1 - portion) + 10 ** -7.2 * portion);
  state.alkalinity += (4 - state.alkalinity) * portion;
  for (const p of state.foodPellets || []) p.mass *= 1 - portion;
  reconcileFood(state);
  state.detritus *= 1 - portion * 0.5;
  state.water.unionizedAmmonia = state.water.ammonia * ammoniaFraction(state.water.temperature, state.water.ph);
  state.lastWaterChangeHours = state.elapsedHours;
  record(state, `换水 ${Math.round(portion * 100)}%：使用已除氯、同温新水，保留滤材中的硝化菌。`);
  return { ok: true, fraction: portion, message: `已换水 ${Math.round(portion * 100)}%` };
}

export function removeDead(state) {
  const count = state.animals.filter(a => !a.alive).length;
  state.animals = state.animals.filter(a => a.alive);
  if (count) record(state, `捞起 ${count} 只死亡生物，减少后续腐败污染。`);
  return { ok: true, count, message: count ? `已捞起 ${count} 只死亡生物` : '没有需要清理的死亡生物' };
}

export function getAssessment(state) {
  const w = state.water;
  const nh3 = w.ammonia * ammoniaFraction(w.temperature, w.ph);
  if (w.oxygen < 3) return { level: 'danger', label: '严重缺氧', message: '开启增氧与过滤，停止投喂并换水。' };
  if (nh3 > 0.05 || w.ammonia > 3 || w.nitrite > 0.5) return { level: 'danger', label: '水质危险', message: '氨或亚硝酸盐正在伤害生物。停止投喂，换水并检查过滤。' };
  if (state.animals.some(a => !a.alive)) return { level: 'warning', label: '需要清理', message: '死亡生物会持续腐败、耗氧并释放氨，请及时清理。' };
  if (w.oxygen < 5) return { level: 'warning', label: '溶氧偏低', message: '开启增氧，减少投喂和生物密度。' };
  if (w.ammonia > 0.15 || w.nitrite > 0.08 || nh3 > 0.01) return { level: 'warning', label: '氮循环承压', message: '减少投喂，确认过滤开启，必要时少量换水。' };
  if (w.nitrate > 15) return { level: 'warning', label: '需要换水', message: '硝酸盐正在积累；水草吸收有限，请定期换水。' };
  if (w.temperature < 21 || w.temperature > 28) return { level: 'warning', label: '温度不适', message: '将水温维持在混养生物能共同适应的范围。' };
  if (w.ph < 6.5 || w.ph > 8) return { level: 'warning', label: '酸碱度偏离', message: '检查水质与过滤，适量换水，避免剧烈调整。' };
  const sick = state.animals.filter(a => a.alive && a.infection);
  if (sick.length) return { level: 'warning', label: '鱼儿感染', message: `${sick.length} 条鱼有感染症状，到生物面板查看个体并护理。` };
  if (state.animals.some(a => a.alive && a.health < 60)) return { level: 'warning', label: '生物虚弱', message: '水质恢复后健康会逐步恢复，检查饥饿与生物负载。' };
  if (state.animals.some(a => a.alive && a.hunger > 80)) return { level: 'warning', label: '需要投喂', message: '生物已经饥饿，适量投喂，避免一次投入过多。' };
  return { level: 'good', label: '生态稳定', message: '过滤、溶氧和氮循环正常。少量投喂，保持观察。' };
}

function integrate(state, dt) {
  const w = state.water;
  const e = state.equipment;
  const liters = state.volumeLiters;
  const ambient = 21;
  w.temperature += ((e.heater ? e.targetTemperature : ambient) - w.temperature) * decayFraction(e.heater ? 0.6 : 0.08, dt);
  const saturation = clamp(14.62 - 0.3898 * w.temperature + 0.006969 * w.temperature ** 2 - 0.00005896 * w.temperature ** 3, 3, 15);
  const thermal = clamp(2 ** ((w.temperature - 25) / 10), 0.25, 2.5);
  const living = state.animals.filter(a => a.alive);
  const biomass = living.reduce((sum, a) => sum + a.mass, 0);
  const plantMass = state.plants.reduce((sum, p) => sum + p.biomass, 0);
  living.forEach(a => {
    a.ageHours += dt;
    const spec = SPECIES[a.species];
    if (spec.type === 'fish') growFish(a, spec, dt);
    a.hunger = clamp(a.hunger + (spec.type === 'fish' ? 0.9 : 0.45) * a.metabolism * thermal * dt, 0, 100);
    // Bottom dwellers graze established biofilm and detritus, not nitrogen itself.
    if (spec.type === 'invertebrate') {
      const grazed = Math.min(state.detritus, 0.0005 * dt);
      state.detritus -= grazed;
      a.hunger = Math.max(0, a.hunger - (grazed * 900 + 0.32 * dt));
      w.ammonia += grazed * 70 / liters * 0.55;
    }
  });
  w.ammonia += biomass * 0.008 / liters * thermal * dt;
  const rottenFood = state.food * decayFraction(0.08 * thermal, dt);
  for (const p of state.foodPellets || []) p.mass *= 1 - decayFraction(0.08 * thermal, dt);
  reconcileFood(state);
  const rottenWaste = state.detritus * decayFraction(0.035 * thermal, dt);
  state.detritus -= rottenWaste;
  let decayMass = rottenFood + rottenWaste;
  for (const a of state.animals) {
    if (a.alive) continue;
    const decayed = a.corpseMass * decayFraction(0.025 * thermal, dt);
    a.corpseMass -= decayed;
    // Wet tissue is converted into a dry-organic-matter equivalent.
    decayMass += decayed * 0.22;
  }
  w.ammonia += decayMass * 70 / liters;
  const oxygenDemand = (biomass * 0.32 / liters * thermal + plantMass * 0.004) * dt + decayMass * 1000 / liters;
  const oxygenFactor = clamp(w.oxygen / 4, 0, 1);
  const phFactor = clamp((w.ph - 5.5) / 1.5, 0, 1) * clamp((9.5 - w.ph) / 1.5, 0, 1);
  const filterFactor = e.filter ? 1 : 0.06;
  const nitrificationFactor = thermal * oxygenFactor * phFactor * filterFactor;
  // Use common nitrogen units so both conversion steps conserve dissolved N.
  const ammoniaConverted = Math.min(w.ammonia, 0.055 * state.bacteria.ammonia * nitrificationFactor * w.ammonia / (0.025 + w.ammonia) * dt);
  const nitriteConverted = Math.min(w.nitrite, 0.065 * state.bacteria.nitrite * nitrificationFactor * w.nitrite / (0.02 + w.nitrite) * dt);
  w.ammonia -= ammoniaConverted;
  w.nitrite += ammoniaConverted - nitriteConverted;
  w.nitrate += nitriteConverted;
  const nitrificationOxygen = ammoniaConverted * 3.43 + nitriteConverted * 1.14;
  state.alkalinity = Math.max(0.1, state.alkalinity - ammoniaConverted * 7.14 / 17.848);
  for (const [name, substrate] of [['ammonia', w.ammonia], ['nitrite', w.nitrite]]) {
    const growth = 0.012 * substrate / (0.06 + substrate) * oxygenFactor * (e.filter ? 1 : 0.15);
    const loss = e.filter && w.oxygen > 2 ? 0.001 : 0.025;
    state.bacteria[name] = clamp(state.bacteria[name] * Math.exp((growth - loss) * dt), 0.01, 4);
  }
  let photosynthesis = 0;
  for (const p of state.plants) {
    const uptake = Math.min(w.nitrate, (e.light ? 1 : 0.08) * p.biomass * PLANTS[p.species].uptake * 0.00075 * dt);
    w.nitrate -= uptake;
    if (e.light) {
      photosynthesis += p.biomass * 0.014 * dt;
      p.biomass = clamp(p.biomass + uptake * 0.06, 0.15, 2.2);
    } else {
      const lost = p.biomass * decayFraction(0.0007, dt);
      p.biomass -= lost;
      state.detritus += lost * 0.025;
    }
  }
  const exchangeRate = 0.035 + (e.aerator ? 0.55 : 0) + (e.filter ? 0.16 : 0);
  w.oxygen += (saturation - w.oxygen) * decayFraction(exchangeRate, dt) + photosynthesis - oxygenDemand - nitrificationOxygen;
  w.oxygen = clamp(w.oxygen, 0, saturation * 1.15);
  // Simplified buffered pH relaxation: nitrification acidifies; light removes CO2.
  const phTarget = 7.12 + (e.light ? 0.12 : -0.12) - (4 - state.alkalinity) * 0.14;
  w.ph = clamp(w.ph + (phTarget - w.ph) * decayFraction(0.018, dt), 4.5, 9.5);
  w.unionizedAmmonia = w.ammonia * ammoniaFraction(w.temperature, w.ph);
  const clarityTarget = clamp(1 - state.food * 0.6 - state.detritus * 0.35 - w.ammonia * 0.08, 0.12, 1);
  w.clarity += (clarityTarget - w.clarity) * decayFraction(e.filter ? 0.35 : 0.06, dt);
  for (const a of living) {
    const spec = SPECIES[a.species];
    const stressors = {
      '缺氧': Math.max(0, 4.6 - w.oxygen) ** 1.7 * 0.65,
      '氨中毒': Math.max(0, w.unionizedAmmonia - 0.008) * 95 + Math.max(0, w.ammonia - 1.5) * 0.12,
      '亚硝酸盐中毒': Math.max(0, w.nitrite - 0.08) * 2.8,
      '硝酸盐长期积累': Math.max(0, w.nitrate - 25) * 0.008,
      '温度不适': Math.max(0, spec.temperature[0] - w.temperature, w.temperature - spec.temperature[1]) ** 1.6 * 0.18,
      '酸碱度不适': Math.max(0, spec.ph[0] - w.ph, w.ph - spec.ph[1]) ** 1.7 * 0.65,
      '长期饥饿': Math.max(0, a.hunger - 92) * (spec.type === 'fish' ? .30 : .055),
    };
    if (a.infection) {
      const label = INFECTIONS[a.infection.kind].label;
      stressors[label] = advanceInfection(a, w, dt);
      if (!a.infection) record(state, `${a.label}的${label}已康复。`);
    }
    const damage = Object.values(stressors).reduce((sum, v) => sum + v, 0) * spec.sensitivity;
    a.stress = clamp(damage / 8, 0, 1);
    const healing = damage < 0.08 && a.hunger < 75 ? 0.6 : 0;
    // Health reserve declines through the final fifth of the individual lifespan.
    const senescence = spec.type === 'fish' ? clamp(1 - 5 * (1 - a.lifeAgeHours / a.lifespanHours), 0, 1) : 0;
    const healthCeiling = 100 * (1 - senescence ** 2);
    a.health = clamp(a.health + (healing - damage) * dt, 0, healthCeiling);
    if (a.health <= 0) {
      a.alive = false;
      if (a.infection) a.infection = null;
      a.deathHours = state.elapsedHours + dt;
      a.corpseMass = a.mass;
      a.behavior = 'dead'; a.targetFoodId = null;
      a.deathBehaviorSeconds = state.behaviorSeconds;
      a.deathHeading = Math.hypot(a.velocity.x, a.velocity.z) > .001
        ? Math.atan2(-a.velocity.z, a.velocity.x) || 0 : (a.seed * 2 - 1) * Math.PI;
      a.causeOfDeath = healthCeiling === 0 ? '自然衰老' : Object.entries(stressors).sort((x, y) => y[1] - x[1])[0][0];
      record(state, `${a.label}因${a.causeOfDeath}死亡。请捞起遗骸，避免继续污染水质。`, 'death');
    }
  }
  state.elapsedHours += dt;
  const sick = startScheduledInfection(state, SPECIES);
  if (sick) record(state, `${sick.label}出现${INFECTIONS[sick.infection.kind].label}，可打开个体档案护理。`, 'warning');
}

/** Advance by simulated hours, with five-minute integration substeps. */
export function advanceSimulation(state, hours) {
  if (!Number.isFinite(hours) || hours <= 0) return state;
  let remaining = Math.min(hours, 24 * 30);
  while (remaining > 1e-9) {
    const dt = Math.min(STEP, remaining);
    integrate(state, dt);
    remaining -= dt;
    const currentHour = Math.floor(state.elapsedHours);
    if (currentHour > state.lastHistoryHour) {
      state.lastHistoryHour = currentHour;
      state.history.push({ time: state.elapsedHours, ...state.water, alive: state.animals.filter(a => a.alive).length });
      if (state.history.length > 168) state.history.shift();
    }
  }
  const assessment = getAssessment(state);
  if (assessment.level !== state.lastAssessmentLevel) {
    record(state, `${assessment.label}：${assessment.message}`, assessment.level === 'good' ? 'info' : 'warning');
    state.lastAssessmentLevel = assessment.level;
  }
  return state;
}

// The first lifecycle model stored maturity and lifespan in real-world fish years.
// Its valid lifespans are disjoint from the new game ranges, even with individual variation.
const legacyLifeDays = {
  neon: [180, 1825], guppy: [75, 900], angelfish: [300, 2920],
  zebra: [90, 1460], harlequin: [150, 1825],
};

function restoreFishAge(fish, saved, spec) {
  const legacy = legacyLifeDays[fish.species];
  const maturity = spec.maturityDays * 24, life = spec.lifespanDays * 24;
  const oldLife = saved.lifespanHours;
  const legacyLife = legacy ? legacy[1] * 24 : 0;
  if (legacy && Number.isFinite(saved.lifeAgeHours) && Number.isFinite(oldLife) &&
      oldLife >= legacyLife * .85 && oldLife <= legacyLife * 1.15) {
    const age = clamp(saved.lifeAgeHours, 0, 1e7);
    const oldMaturity = legacy[0] * 24;
    fish.lifespanHours = life * (oldLife / legacyLife);
    // Preserve progress within each stage, including the senior's current health ceiling.
    if (age < oldMaturity) {
      fish.lifeAgeHours = maturity * (age / oldMaturity);
    } else if (age < .8 * oldLife) {
      const adultProgress = (age - oldMaturity) / (.8 * oldLife - oldMaturity);
      fish.lifeAgeHours = maturity + adultProgress * (.8 * fish.lifespanHours - maturity);
    } else {
      const seniorHours = (age - .8 * oldLife) / oldLife * fish.lifespanHours;
      fish.lifeAgeHours = .8 * fish.lifespanHours + seniorHours;
    }
    return;
  }
  fish.lifespanHours = numeric(oldLife, fish.lifespanHours, life * .85, life * 1.15);
  // Before v0.7.0 only residence time was saved. Give established adults time to live.
  const estimatedAge = Math.min(maturity + fish.ageHours, fish.lifespanHours * .6);
  fish.lifeAgeHours = numeric(saved.lifeAgeHours, estimatedAge, 0, 1e7);
}

/** Invalid/corrupt saves become safe defaults; valid deaths and empty tanks persist. */
export function restoreState(raw) {
  const base = createInitialState();
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return base; }
  }
  if (!data || typeof data !== 'object' || data.version !== 1) return base;
  base.elapsedHours = numeric(data.elapsedHours, 0, 0, 1e7);
  const legacySeed = Math.floor(seedFromId(data.animals?.[0]?.id || base.elapsedHours) * 2 ** 32);
  base.infectionClock = restoreInfectionClock(data.infectionClock, base.elapsedHours, legacySeed);
  base.speed = numeric(data.speed, 1, 0.1, 3600);
  base.paused = data.paused === true;
  base.volumeLiters = numeric(data.volumeLiters, 60, 10, 500);
  for (const [name, min, max] of [['temperature', 0, 45], ['ph', 4.5, 9.5], ['ammonia', 0, 500], ['nitrite', 0, 500], ['nitrate', 0, 2000], ['oxygen', 0, 20], ['clarity', 0, 1]]) {
    base.water[name] = numeric(data.water?.[name], base.water[name], min, max);
  }
  for (const name of ['filter', 'aerator', 'light', 'heater']) {
    if (typeof data.equipment?.[name] === 'boolean') base.equipment[name] = data.equipment[name];
  }
  base.equipment.targetTemperature = numeric(data.equipment?.targetTemperature, 25, 16, 34);
  base.behaviorSeconds = numeric(data.behaviorSeconds,0,0,1e10);
  if (Array.isArray(data.animals)) {
    const usedIds = new Set();
    base.animals = data.animals.filter(a => a && Object.hasOwn(SPECIES, a.species)).slice(0, MAX_ANIMALS).map((a,index) => {
      const restored = animal(a.species, Math.round(numeric(a.serial,index+1,1,1e7)), numeric(a.seed,seedFromId(a.id || `${a.species}-${index}`),0,1));
      if (typeof a.id === 'string' && a.id.length <= 100 && !usedIds.has(a.id)) restored.id = a.id;
      usedIds.add(restored.id);
      restored.health = numeric(a.health, 100, 0, 100);
      restored.hunger = numeric(a.hunger, 22, 0, 100);
      restored.alive = a.alive !== false && restored.health > 0;
      if (!restored.alive) restored.health = 0;
      restored.ageHours = numeric(a.ageHours, 0, 0, 1e7);
      restored.seed = numeric(a.seed, restored.seed, 0, 1);
      restored.label = typeof a.label === 'string' && a.label.trim() ? a.label.slice(0,80) : restored.label;
      const spec = SPECIES[a.species];
      const fish = spec.type === 'fish';
      // Old angelfish labels named a life stage in the species name.
      const number = String(restored.serial).padStart(2, '0');
      if (a.species === 'angelfish' && restored.label === `神仙鱼（幼鱼） #${number}`) {
        restored.label = `神仙鱼 #${number}`;
      }
      const legacyBody = !Number.isFinite(a.lifeAgeHours);
      const defaultSize = legacyBody ? .85 + random(restored.seed + 21) * .35 : restored.size;
      restored.size = numeric(a.size, defaultSize, .6, 1.5);
      const defaultMass = spec.mass * restored.size ** (legacyBody ? 2 : 3);
      restored.mass = numeric(a.mass, defaultMass, .03, 3);
      if (fish) restoreFishAge(restored, a, spec);
      if (fish && restored.alive) restored.infection = restoreInfection(a.infection);
      restored.metabolism = numeric(a.metabolism,restored.metabolism,.65,1.5);
      for (const [axis,min,max] of [['x',-3.65,3.65],['y',.15,4.05],['z',-1.65,1.65]]) restored.position[axis] = numeric(a.position?.[axis],restored.position[axis],min,max);
      for (const axis of ['x','y','z']) restored.velocity[axis] = numeric(a.velocity?.[axis],restored.velocity[axis],-4,4);
      restored.behavior = restored.alive && ['swimming','seeking','eating','resting','gasping','grazing'].includes(a.behavior) ? a.behavior : restored.alive ? restored.behavior : 'dead';
      restored.lastMealHours = a.lastMealHours == null ? null : numeric(a.lastMealHours,null,0,base.elapsedHours);
      restored.totalEatenGrams = numeric(a.totalEatenGrams,0,0,1e4);
      restored.bites = Math.round(numeric(a.bites,0,0,1e9));
      restored.biteFlash = numeric(a.biteFlash,0,0,.45);
      restored.biteCooldown = numeric(a.biteCooldown,0,0,.8);

      restored.deathHours = restored.alive ? null : numeric(a.deathHours, base.elapsedHours, 0, base.elapsedHours);
      if (!restored.alive) {
        const sinceDeath = base.elapsedHours - restored.deathHours;
        restored.corpseMass = numeric(a.corpseMass, restored.mass * Math.exp(-.025 * sinceDeath), 0, 5);
        restored.deathBehaviorSeconds = numeric(a.deathBehaviorSeconds, Math.max(0, base.behaviorSeconds - 10), 0, base.behaviorSeconds);
        restored.deathHeading = numeric(a.deathHeading, (restored.seed * 2 - 1) * Math.PI, -Math.PI, Math.PI);
      }
      restored.stress = numeric(a.stress, 0, 0, 1);
      restored.causeOfDeath = typeof a.causeOfDeath === 'string' ? a.causeOfDeath.slice(0, 80) : null;
      return restored;
    });
  }
  if (Array.isArray(data.plants)) {
    const usedIds = new Set();
    const slots = new Map(Object.keys(PLANTS).map(kind => [kind, new Set()]));
    base.plants = data.plants.filter(p => p && Object.hasOwn(PLANTS, p.species)).slice(0, MAX_PLANTS).map(p => {
      const used = slots.get(p.species);
      // Older versions placed plants by species and array order. Freeze those beds on migration.
      const restored = plant(p.species, availableSlot(used, p.slot, MAX_PLANTS));
      used.add(restored.slot);
      if (typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 100 && !usedIds.has(p.id)) restored.id = p.id;
      usedIds.add(restored.id);
      restored.biomass = numeric(p.biomass, 1, 0.15, 2.2);
      restored.seed = numeric(p.seed, restored.seed, 0, 1);
      return restored;
    });
  }
  if (Array.isArray(data.hardscape)) {
    const usedIds = new Set();
    const slots = new Map(Object.keys(HARDSCAPE).map(kind => [kind, new Set()]));
    base.hardscape = data.hardscape.filter(item => item && Object.hasOwn(HARDSCAPE, item.kind)).slice(0, MAX_HARDSCAPE).map(item => {
      const used = slots.get(item.kind);
      const slot = availableSlot(used, item.slot, MAX_HARDSCAPE);
      used.add(slot);
      const validId = typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100 && !usedIds.has(item.id);
      const id = validId ? item.id : key('scenery');
      usedIds.add(id);
      return { id, kind: item.kind, slot };
    });
  }
  base.nextAnimalNumber = Math.max(Math.round(numeric(data.nextAnimalNumber,1,1,1e8)),...base.animals.map(a=>a.serial+1),1);
  const usedLabels = new Set();
  for (const a of base.animals) {
    if (usedLabels.has(a.label)) { a.serial=base.nextAnimalNumber++; a.label=`${SPECIES[a.species].name} #${String(a.serial).padStart(2,'0')}`; }
    usedLabels.add(a.label);
  }
  const pelletIds = new Set();
  base.foodPellets = [];
  if (Array.isArray(data.foodPellets)) {
    const bed = [], falling = [];
    for (const p of data.foodPellets) {
      if (!p || !Number.isFinite(p.mass) || p.mass <= 0) continue;
      const id = typeof p.id === 'string' && p.id.length < 100 && !pelletIds.has(p.id) ? p.id : key('pellet');
      const pellet={id,x:numeric(p.x,0,-3.65,3.65),y:numeric(p.y,3.9,.15,4.05),z:numeric(p.z,.4,-1.65,1.65),mass:numeric(p.mass,0,0,Number.MAX_SAFE_INTEGER),ageSeconds:numeric(p.ageSeconds,0,0,1e8),seed:numeric(p.seed,seedFromId(id),0,1)};
      const settled = isSettledPellet(pellet);
      const layer = settled ? bed : falling;
      if (layer.length < (settled ? MAX_BED_PELLETS : MAX_FALLING_PELLETS)) {
        layer.push(pellet);
        base.foodPellets.push(pellet);
        pelletIds.add(id);
      } else {
        nearestPellet(layer, pellet.x, pellet.y, pellet.z).mass += pellet.mass;
      }
    }
    reconcileFood(base);
  } else {
    // Legacy saves had a bulk feed amount; recover it as settled remnants.
    addPellets(base,numeric(data.food,0,0,100),.529,true);
  }
  const savedById = new Map((Array.isArray(data.animals) ? data.animals : []).filter(a=>a&&typeof a.id==='string').map(a=>[a.id,a]));
  for(const a of base.animals) {
    const targetId=savedById.get(a.id)?.targetFoodId;
    a.targetFoodId=typeof targetId==='string'&&pelletIds.has(targetId)?targetId:null;
  }
  base.detritus = numeric(data.detritus, 0.01, 0, 100);
  base.alkalinity = numeric(data.alkalinity, 4, 0.1, 20);
  for (const name of ['ammonia', 'nitrite']) base.bacteria[name] = numeric(data.bacteria?.[name], 1, 0.01, 4);
  base.lastFedHours = data.lastFedHours === null ? null : numeric(data.lastFedHours, 0, 0, base.elapsedHours);
  base.lastWaterChangeHours = numeric(data.lastWaterChangeHours, 0, 0, base.elapsedHours);
  if (Array.isArray(data.events)) base.events = data.events.filter(e => e && typeof e.message === 'string').slice(0, 50).map(e => ({ id: typeof e.id === 'string' ? e.id.slice(0, 100) : key('event'), time: numeric(e.time, 0, 0, base.elapsedHours), type: ['info', 'warning', 'death'].includes(e.type) ? e.type : 'info', message: e.message.slice(0, 300) }));
  // History is observational only; accept finite, known fields and discard malformed samples.
  if (Array.isArray(data.history)) base.history = data.history.filter(h => h && Number.isFinite(h.time)).slice(-168).map(h => ({ time: numeric(h.time, 0, 0, base.elapsedHours), ...Object.fromEntries(Object.keys(base.water).map(name => [name, numeric(h[name], base.water[name], 0, 2000)])), alive: numeric(h.alive, 0, 0, MAX_ANIMALS) }));
  base.lastHistoryHour = Math.floor(base.elapsedHours);
  base.water.unionizedAmmonia = base.water.ammonia * ammoniaFraction(base.water.temperature, base.water.ph);
  base.lastAssessmentLevel = getAssessment(base).level;
  return base;
}
