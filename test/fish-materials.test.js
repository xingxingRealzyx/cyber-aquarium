import assert from 'node:assert/strict';
import test from 'node:test';
import { createFishMaterials } from '../src/fish-materials.js';

function pixel(texture, u, v) {
  const { data, width, height } = texture.image;
  const index = (Math.floor(v * height) * width + Math.floor(u * width)) * 4;
  return data.subarray(index, index + 4);
}

test('rummy-nose has a red head and dark bands on the tail, with clear paired fins', () => {
  const fish = createFishMaterials('rummynose', .37);
  const head = pixel(fish.body.map, .9, .24);
  assert.ok(head[0] > head[1] + 70);
  // The central stripe and the two lobe markings alternate with light membranes.
  const values = [.14, .35, .5, .65, .86].map(v => pixel(fish.tail.map, .82, v)[0]);
  assert.ok(values[0] < 75 && values[1] > 165 && values[2] < 75 && values[3] > 165 && values[4] < 75);
  const pectoral = pixel(fish.fin.map, .69, .625);
  assert.ok(pectoral[3] + 60 < pixel(fish.tail.map, .69, .5)[3]);
  for (const material of Object.values(fish)) material.dispose();
});

test('discus fin atlas keeps the patterned dorsal and anal membranes separate from clear pectorals', () => {
  const fish = createFishMaterials('discus', .37);
  const dorsal = pixel(fish.fin.map, .69, .125);
  const anal = pixel(fish.fin.map, .69, .375);
  const pectoral = pixel(fish.fin.map, .69, .625);
  assert.ok(dorsal[3] > pectoral[3] + 65 && anal[3] > pectoral[3] + 65);
  assert.ok(fish.body.bumpMap === fish.body.roughnessMap);
  for (const material of Object.values(fish)) material.dispose();
});
