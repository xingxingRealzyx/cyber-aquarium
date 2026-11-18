import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadingManager, Raycaster, Texture, TextureLoader, Vector3 } from 'three';
import { createAuthorHead } from '../src/author-head.js';
import { createAuthorDiveGear } from '../src/author-dive-gear.js';
import { createAuthorDisplay } from '../src/author-motion.js';
import { animateAuthorSwimmer, createAuthorSwimmer } from '../src/author-swimmer.js';

function offlineTextures(t) {
  t.mock.method(TextureLoader.prototype, 'load', (_url, onLoad) => {
    const texture = new Texture();
    onLoad(texture);
    return texture;
  });
  return new LoadingManager();
}

test('the snorkel intake has an open bore surrounded by a solid lip', (t) => {
  const gear = createAuthorDiveGear(offlineTextures(t));
  gear.updateMatrixWorld(true);
  const tip = gear.userData.snorkelTip.getWorldPosition(new Vector3());
  const snorkel = gear.getObjectByName('中空 J 形呼吸管');
  const axis = new Vector3(0, 1, -0.13).normalize();
  function firstHit(offset) {
    const origin = tip.clone().addScaledVector(axis, 0.022);
    origin.x += offset;
    return new Raycaster(origin, axis.clone().negate()).intersectObject(snorkel, false)[0]?.distance;
  }
  assert.ok(firstHit(0) > 0.18, 'the center ray travels inside the tube to the bend');
  assert.ok(firstHit(0.006) > 0.12, 'the intake is open across its diameter');
  assert.ok(firstHit(0.011) < 0.035, 'the rim has a physical wall around the bore');
  assert.equal(firstHit(0.016), undefined);
});

test('both eyes and the nose remain visible through their own mask windows', (t) => {
  const head = createAuthorHead(offlineTextures(t));
  const gear = head.userData.snorkelTip.parent;
  head.updateMatrixWorld(true);
  for (const [x, y, part, window] of [
    [-0.087, 0.05, 'author iris', '双镜面罩镜片'],
    [0.087, 0.05, 'author iris', '双镜面罩镜片'],
    [0, -0.025, 'author nose', '透明鼻袋'],
  ]) {
    const ray = new Raycaster(new Vector3(x, y, 0.45), new Vector3(0, 0, -1));
    const feature = ray.intersectObject(head.getObjectByName(part), false)[0];
    assert.ok(feature, `ray meets the actual ${part} surface`);
    ray.far = feature.distance - 0.0001;
    const windows = ray.intersectObjects(gear.children, false);
    assert.ok(windows.length > 0, `the ${window} covers the feature`);
    assert.ok(windows.every((hit) => hit.object.name === window && hit.object.material.opacity < 0.35));
  }
});

test('the actual swimmer exhales from the bite piece and brings the intake into the air', (t) => {
  const swimmer = createAuthorSwimmer(offlineTextures(t));
  const water = 4.14;
  const display = createAuthorDisplay(swimmer, animateAuthorSwimmer, 0, water, () => 0.45);
  const actor = display.userData.author;
  const actualMouth = swimmer.userData.mouth;
  assert.equal(actualMouth.parent.userData.mouth, actualMouth);
  actor.update(0.9);
  const atOutlet = actor.diagnostics();
  assert.ok(atOutlet.snorkelTip.y < water);
  assert.equal(atOutlet.bubbles.length, 1);
  assert.ok(actualMouth.getWorldPosition(new Vector3()).distanceTo(atOutlet.bubbles[0]) < 1e-6);
  actor.update(22);
  const breathing = actor.diagnostics();
  assert.ok(breathing.snorkelTip.y > water && breathing.mouth.y < water);
  actor.update(28);
  assert.ok(actor.diagnostics().snorkelTip.y < water - 1);
});
