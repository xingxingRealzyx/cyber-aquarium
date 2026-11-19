import { plantBed } from './plant-layout.js';

// Durations use aquarium hours. A brood represents the young that can survive
// in this desktop tank, not the number of eggs a real animal usually produces.
export const REPRODUCTION = Object.freeze({
  guppy:    { kind: 'livebearer', label: '怀胎', hours: 8,  young: 3, cooldown: 30 },
  neon:     { kind: 'scatter',    label: '散卵', hours: 5,  young: 2, cooldown: 24 },
  zebra:    { kind: 'scatter',    label: '散卵', hours: 4,  young: 3, cooldown: 24 },
  harlequin:{ kind: 'leaf',       label: '叶背附卵', hours: 6, young: 2, cooldown: 28 },
  angelfish:{ kind: 'guarded',    label: '守护卵床', hours: 8, young: 2, cooldown: 36 },
  discus:   { kind: 'guarded',    label: '双亲护卵', hours: 10, young: 2, cooldown: 40 },
  cardinal: { kind: 'scatter',    label: '散卵', hours: 5, young: 2, cooldown: 26 },
  rummynose:{ kind: 'scatter',    label: '散卵', hours: 6, young: 2, cooldown: 26 },
  blackneon:{ kind: 'scatter',    label: '散卵', hours: 5, young: 2, cooldown: 24 },
  cherrybarb:{ kind: 'plant',     label: '水草黏卵', hours: 5, young: 2, cooldown: 26 },
  tigerbarb:{ kind: 'scatter',    label: '散卵', hours: 5, young: 3, cooldown: 26 },
  galaxy:   { kind: 'scatter',    label: '散卵', hours: 5, young: 2, cooldown: 24 },
  blackskirt:{ kind: 'scatter',   label: '散卵', hours: 5, young: 3, cooldown: 28 },
  boesemani:{ kind: 'plant',      label: '水草黏卵', hours: 9, young: 2, cooldown: 24 },
  platy:    { kind: 'livebearer', label: '怀胎', hours: 9, young: 3, cooldown: 30 },
  shrimp:   { kind: 'carried',    label: '腹部抱卵', hours: 9, young: 3, cooldown: 28 },
  snail:    { kind: 'capsule',    label: '硬面卵囊', hours: 12, young: 1, cooldown: 36 },
});

export const MAX_ANIMALS = 80;
export const MAX_LIVING_ANIMALS = 40;
const epsilon = 1e-8;
const broodChance = .2;
const carried = kind => kind === 'carried' || kind === 'livebearer';

// A scheduled birth is already promised a place. Retained bodies count toward
// the render limit; they don't consume a living-animal slot.
export function availableAnimalSlots(state) {
  const living = state.animals.filter(a => a.alive).length;
  const room = Math.min(MAX_LIVING_ANIMALS - living, MAX_ANIMALS - state.animals.length);
  const reserved = state.broods.reduce((sum, brood) => sum + brood.count, 0);
  return Math.max(0, room - reserved);
}

export function removeAttachedBroods(state, id) {
  const remaining = state.broods.filter(b =>
    b.plantId !== id && !(b.motherId === id && carried(REPRODUCTION[b.species].kind)));
  const removed = state.broods.length - remaining.length;
  if (removed) state.broods = remaining;
  return removed;
}

function spawningSite(state, mother, kind, substrateHeight) {
  const { x, y, z } = mother.position;
  if (kind === 'leaf' || kind === 'guarded' || kind === 'plant') {
    const preference = kind === 'plant' ? ['moss', 'vallisneria', 'anubias'] : ['anubias', 'vallisneria'];
    for (const species of preference) {
      const foliage = state.plants.filter(p => p.species === species);
      if (!foliage.length) continue;
      const plant = foliage[mother.serial % foliage.length];
      const bed = plantBed(plant);
      const height = { moss: .23, anubias: .55, vallisneria: .9 }[species];
      return { plantId: plant.id, position: { ...bed, y: substrateHeight(bed.x, bed.z) + height } };
    }
    if (kind !== 'guarded') return null;
  }
  if (kind === 'capsule' || kind === 'guarded') {
    return { position: { x, y: Math.max(.6, Math.min(2.2, y)), z: z < 0 ? -1.96 : 1.96 } };
  }
  if (kind === 'scatter') return { position: { x, y: substrateHeight(x, z) + .04, z } };
  return { position: { x, y, z } };
}

function findPair(state, hour, model) {
  const w = state.water;
  if (w.oxygen < 5 || w.ammonia > .3 || w.nitrite > .12) return;
  const activeParents = new Set(state.broods.flatMap(b => [b.motherId, b.fatherId]));
  const ready = state.animals.filter(a => {
    if (!a.alive || a.infection || a.health < 70 || a.hunger >= 75 ||
        a.nextBreedHours > hour || activeParents.has(a.id) || model.stage(a) !== 'adult') return false;
    const { temperature, ph } = model.species[a.species];
    return model.waterInRange(w, 'temperature', temperature) && model.waterInRange(w, 'ph', ph);
  });
  // Rotate who gets first choice instead of giving the first resident every free place.
  const females = ready.filter(a => a.sex === 'female');
  for (let i = 0; i < females.length; i++) {
    const mother = females[(i + hour / 2) % females.length];
    const father = ready.find(a => a.sex === 'male' && a.species === mother.species);
    if (!father) continue;
    const site = spawningSite(state, mother, REPRODUCTION[mother.species].kind, model.substrateHeight);
    if (site) return { mother, father, site };
  }
}

function startBrood(state, hour, slots, model) {
  const pair = findPair(state, hour, model);
  if (!pair) return;
  const { mother, father, site } = pair;
  // One stable draw per tank opportunity, even with many eligible pairs or a save reload.
  if (model.random(mother.seed + hour) >= broodChance) return;
  const profile = REPRODUCTION[mother.species];
  const due = hour + profile.hours;
  state.broods.push({
    id: `brood-${hour}-${mother.serial}-${Math.floor(mother.seed * 2 ** 32).toString(36)}`, species: mother.species,
    motherId: mother.id, fatherId: father.id, count: Math.min(slots, profile.young),
    startedAtHours: hour, dueAtHours: due, ...site,
  });
  mother.nextBreedHours = father.nextBreedHours = due + profile.cooldown;
  model.record(state, `${mother.label}与${father.label}配对，繁殖方式为${profile.label}。`);
}

export function advanceReproduction(state, previousHours, model) {
  const hour = Math.floor(state.elapsedHours + epsilon);
  if (hour === Math.floor(previousHours + epsilon)) return;
  for (const brood of state.broods) {
    if (hour < brood.dueAtHours) continue;
    const kind = REPRODUCTION[brood.species].kind;
    const mother = state.animals.find(a => a.id === brood.motherId);
    if (carried(kind) && !mother?.alive) continue;
    const birth = carried(kind) ? { ...brood, position: mother.position } : brood;
    for (let i = 0; i < brood.count; i++) model.spawn(state, birth, i);
    const verb = kind === 'livebearer' ? '出生' : '孵化';
    model.record(state, `${brood.count} 只${model.species[brood.species].name}幼体${verb}，已加入鱼缸。`);
  }
  if (state.broods.length) state.broods = state.broods.filter(b => b.dueAtHours > hour);
  if (hour % 2 === 0) {
    const slots = availableAnimalSlots(state);
    if (slots > 0) startBrood(state, hour, slots, model);
  }
}

const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 100;
export function restoreBroods(state, saved) {
  state.broods = [];
  if (!Array.isArray(saved)) return;
  const usedIds = new Set();
  const parents = new Set();
  const animals = new Map(state.animals.map(a => [a.id, a]));
  let slots = availableAnimalSlots(state);
  for (const b of saved) {
    if (slots <= 0) break;
    if (!b || !Object.hasOwn(REPRODUCTION, b.species) || !validId(b.id) || usedIds.has(b.id) ||
        !validId(b.motherId) || !validId(b.fatherId) || b.motherId === b.fatherId ||
        parents.has(b.motherId) || parents.has(b.fatherId)) continue;
    const profile = REPRODUCTION[b.species], mother = animals.get(b.motherId), father = animals.get(b.fatherId);
    if (carried(profile.kind) && !mother?.alive) continue;
    if ((mother && (mother.species !== b.species || mother.sex !== 'female')) ||
        (father && (father.species !== b.species || father.sex !== 'male'))) continue;
    if (!Number.isSafeInteger(b.count) || b.count < 1 || !Number.isFinite(b.startedAtHours) ||
        b.startedAtHours < 0 || b.startedAtHours > state.elapsedHours + epsilon ||
        b.dueAtHours !== b.startedAtHours + profile.hours || b.dueAtHours < state.elapsedHours - epsilon) continue;
    const position = b.position;
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite) ||
        Math.abs(position.x) > 4 || position.y < 0 || position.y > 4.2 || Math.abs(position.z) > 2) continue;
    if ((profile.kind === 'leaf' || profile.kind === 'plant' || b.plantId != null) &&
        (!validId(b.plantId) || !state.plants.some(p => p.id === b.plantId && (profile.kind === 'plant' || p.species !== 'moss')))) continue;
    const count = Math.min(b.count, slots, profile.young);
    state.broods.push({
      id: b.id, species: b.species, motherId: b.motherId, fatherId: b.fatherId, count,
      startedAtHours: b.startedAtHours, dueAtHours: b.dueAtHours,
      position: { x: position.x, y: position.y, z: position.z },
      ...(b.plantId ? { plantId: b.plantId } : {}),
    });
    slots -= count;
    usedIds.add(b.id);
    parents.add(b.motherId);
    parents.add(b.fatherId);
  }
}
