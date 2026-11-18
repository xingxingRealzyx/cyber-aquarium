const starterBeds = {
  vallisneria: [[-3.06,-1.2], [-1.9,-1.32], [2,-1.32], [3.02,-.94]],
  anubias: [[-3.04,.52], [-1.93,1.05], [1.64,1.06]],
  moss: [[2.59,1.22], [-2.46,.99]],
};

export function plantRandom(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = state + 0x6d2b79f5 | 0;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

// Added plants use the first two samples of the same stream that shapes their foliage.
export function plantBed(plant, rng = plantRandom(plant.seed ?? plant.id)) {
  const slots = starterBeds[plant.species] ?? starterBeds.vallisneria;
  const starter = slots[plant.slot];
  if (starter) return { x: starter[0], z: starter[1] };
  return { x: (rng() - .5) * 6.4, z: plant.species === 'vallisneria' ? -1.39 + rng() * .63 : (rng() - .43) * 2.8 };
}
