import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { animalTurnRate } from '../src/behavior.js';
import { addAnimal, addToy, createInitialState, substrateHeight } from '../src/simulation.js';

// A hungry fish and shrimp face away from their next food. The snail faces just
// to one side of due west and must cross the ±π yaw seam to reach its pellet.
const tank = createInitialState();
tank.animals = [];
tank.plants = [];
tank.paused = true;
addToy(tank, 'author');
tank.behaviorSeconds = 18;
// Start the feeding trial outside the author's flight radius and place the
// bottom pellets in the clear sand in front of and behind the driftwood.
for (const [species, x, z] of [['neon', 2.85, 1.2], ['shrimp', 1.25, 1.25], ['snail', 2, -.7]]) {
  const a = addAnimal(tank, species).animal;
  Object.assign(a, {id:species, hunger:90, seed:.38, position:{
    x, y:species === 'neon' ? 2.9 : substrateHeight(x,z) + .025, z,
  }, velocity:{x:species === 'snail' ? -.07 : .23, y:0, z:species === 'snail' ? .0007 : 0}});
  if (species !== 'neon') {
    const bedX = 0, bedZ = z - .34;
    tank.foodPellets.push({id:species+'-food', x:bedX, y:substrateHeight(bedX,bedZ)+.04,
      z:bedZ, mass:.02, seed:.31, ageSeconds:40});
  }
}

const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
try {
  const page = await browser.newPage({viewport:{width:480,height:320},deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(state => {
    localStorage.setItem('chengjing.aquarium.v1', JSON.stringify(state));
    // Observe the actual Three.js objects, including their rendered orientation.
    const scenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({detail}) => {
      if (detail.isScene) scenes.push(detail);
      if (detail.isWebGLRenderer) window.turnRenderer = detail;
    });
    let now, nextId = 0;
    const pending = new Map();
    window.requestAnimationFrame = callback => { pending.set(++nextId,callback); return nextId; };
    window.cancelAnimationFrame = id => pending.delete(id);
    let residents;
    window.turnFrame = milliseconds => {
      now = (now ?? performance.now()) + milliseconds;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
      if (!residents) {
        residents = new Map();
        for (const scene of scenes) scene.traverse(o => {
          if (o.userData.animalId) residents.set(o.userData.animalId,o);
          if (o.userData.author) residents.set('author',o.userData.author.swimmer);
        });
      }
      const {state, screenToys} = window.aquariumDiagnostics;
      const author = screenToys.find(t => t.kind === 'author');
      return {
        seconds:state.behaviorSeconds, surface:author.surfacing, snorkelY:author.snorkelTip.y,
        turns:Object.fromEntries([...residents].map(([id, o]) => [id,o.getWorldQuaternion(o.quaternion.clone()).toArray()])),
        seeking:state.animals.filter(a => a.targetFoodId).map(a => a.species),
      };
    };
  }, tank);
  await page.goto(process.env.AQUARIUM_URL || 'http://127.0.0.1:5178');
  await page.waitForFunction(() => Boolean(window.aquariumDiagnostics), null, {polling:50});
  const frame = ms => page.evaluate(value => window.turnFrame(value), ms);
  const start = await frame(0);
  assert.deepEqual(Object.keys(start.turns).sort(), ['author','neon','shrimp','snail']);
  await page.getByRole('button', {name:'投喂',exact:true}).dispatchEvent('click');
  const paused = await frame(1200);
  assert.deepEqual(paused, start, 'all four models hold still while paused');
  await page.keyboard.press('Space');
  const resumed = await frame(1000);
  assert.ok(resumed.seconds > paused.seconds && resumed.seconds - paused.seconds <= .100001,
    'the first visible frame after a stall advances at most 100 ms of locomotion');
  assert.deepEqual(resumed.seeking.sort(), ['neon','shrimp','snail']);
  const normalFrames = await page.evaluate(() => Array.from({length:12}, () => window.turnFrame(1000/60)));
  const trace = [paused,resumed,...normalFrames];
  // Walk through surfacing and submerging with actual hardscape in the tank.
  for (let i=0; i<12; i++) {
    trace.push(...await page.evaluate(() => Array.from({length:10}, () => window.turnFrame(100))));
  }
  const peak = Object.fromEntries(Object.keys(paused.turns).map(id => [id,0]));
  let crossedSeam = false;
  const yaw = ([x,y,z,w]) => Math.atan2(2*(w*y-x*z),1-2*(y*y+z*z));
  for (let i=1; i<trace.length; i++) {
    const before = trace[i-1], after = trace[i];
    const dt = after.seconds - before.seconds;
    assert.ok(dt > 0 && dt <= .100001, 'motion clock advances continuously');
    for (const [id, q] of Object.entries(before.turns)) {
      const next = after.turns[id];
      const dot = q.reduce((sum,value,j) => sum + value*next[j], 0);
      const rate = 2*Math.acos(Math.min(1,Math.abs(dot))) / dt;
      peak[id] = Math.max(peak[id],rate);
      assert.ok(rate <= (id === 'author' ? 1.5 : animalTurnRate(id)) + 1e-5,
        id+' rotated '+rate.toFixed(3)+' rad/s at '+after.seconds.toFixed(2)+' s');
      if (id === 'snail' && Math.abs(yaw(q)-yaw(next)) > Math.PI) crossedSeam = true;
    }
  }
  assert.ok(crossedSeam, 'the rendered snail crosses due west via the short arc');
  assert.ok(Object.values(peak).every(rate => rate > .01), 'each model visibly turns');
  assert.ok(trace.some(f => f.surface > .99 && f.snorkelY > 4.14));
  assert.ok(trace.at(-1).surface < .01, 'the swimmer submerges after breathing');
  const gpu = await page.evaluate(() => ({
    adapter:document.querySelector('#render-stat').title,
    triangles:window.turnRenderer.info.render.triangles,
    error:window.turnRenderer.getContext().getError(),
    visible:getComputedStyle(window.turnRenderer.domElement).visibility === 'visible',
  }));
  assert.ok(gpu.triangles > 0 && gpu.visible);
  assert.equal(gpu.error,0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({frames:trace.length, peakRadiansPerSecond:peak, crossedSeam, gpu}));
} finally {
  await browser.close();
}
