import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
const stage = process.env.SCENE_CAPTURE || 'aquascape';
try {
  const page = await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:1.5});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if(message.type()==='error' || /GL_INVALID|shader error/i.test(message.text())) errors.push(message.text());
  });
  page.on('requestfailed', r => errors.push(r.url()+' '+r.failure()?.errorText));
  await page.route('**/scenery-inspection', route => route.fulfill({
    contentType:'text/html',body:'<!doctype html><meta charset=utf-8><style>*{margin:0}body{background:#172727}main{height:100vh}</style><main></main>'
  }));
  await page.goto(new URL('/scenery-inspection',process.env.AQUARIUM_URL||'http://127.0.0.1:5178').href);
  await page.evaluate(async () => {
    const [{createAquarium},sim,{advanceBehavior}] = await Promise.all([
      import('/src/aquarium.js'),import('/src/simulation.js'),import('/src/behavior.js')
    ]);
    const originalRandom = Math.random;
    let seed=218;
    Math.random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
    const state = sim.createInitialState();
    Math.random=originalRandom;
    advanceBehavior(state,5);
    const aquarium=createAquarium(document.querySelector('main'));
    window.renderScene = (view='default',quality='high') => {
      aquarium.setQuality(quality);
      if(view==='default') aquarium.resetView();
      else {
        aquarium.camera.position.set(2.0,2.9,7.1);
        aquarium.controls.target.set(-.4,1.14,0);
        aquarium.controls.update();
      }
      aquarium.update(state,1/60,8);
    };
    window.inspectScene = {aquarium,state,sim};
    window.renderScene();
  });
  await page.waitForFunction(()=>{
    window.renderScene();
    return getComputedStyle(window.inspectScene.aquarium.renderer.domElement).visibility==='visible';
  });
  await mkdir('artifacts',{recursive:true});
  for(const view of ['default','detail']){
    await page.evaluate(view => window.renderScene(view),view);
    await page.screenshot({path:'artifacts/'+stage+'-'+view+'.png'});
  }
  const beforeToys = await page.evaluate(() => {
    const {aquarium, state, sim} = window.inspectScene;
    window.renderScene('default', 'low');
    const memory = {...aquarium.renderer.info.memory};
    for (const kind of ['duck', 'diver', 'swimRing', 'author']) sim.addToy(state, kind);
    window.renderScene('default', 'low');
    return memory;
  });
  const toyMaps = ['pvc', 'rubber', 'canvas', 'copper'].flatMap(finish =>
    ['color', 'normal', 'rough'].map(channel => `/toys/${finish}-${channel}.webp`));
  for (const part of ['iris', 'brow', 'ear', 'cheek', 'chin', 'muzzle', 'nose', 'fur', 'hair', 'fur-normal', 'hair-normal']) {
    toyMaps.push(`/toys/author-${part}.webp`);
  }
  await page.waitForFunction(({beforeToys, toyMaps}) => {
    const loaded = new Set(performance.getEntriesByType('resource')
      .filter(entry => entry.initiatorType === 'img').map(entry => new URL(entry.name).pathname));
    if (!toyMaps.every(file => loaded.has(file))) return false;
    window.renderScene('default', 'low');
    return window.inspectScene.aquarium.getToyScreenPositions().some(t => t.kind === 'author' && t.snorkelTip.y > t.mouth.y) &&
      window.inspectScene.aquarium.renderer.info.memory.textures >= beforeToys.textures + toyMaps.length;
  }, {beforeToys, toyMaps});
  const afterToys = await page.evaluate(() => {
    const {aquarium, state, sim} = window.inspectScene;
    for (const toy of [...state.toys]) sim.removeToy(state, toy.id);
    window.renderScene('default', 'low');
    return {...aquarium.renderer.info.memory};
  });
  assert.deepEqual(afterToys, beforeToys, 'removing the toys and swimmer releases their textures and meshes');
  const metrics=await page.evaluate(async () => {
    const {aquarium,state,sim}=window.inspectScene;
    const renderAndWait=async () => {
      window.renderScene('detail','low');
      await new Promise(resolve=>requestAnimationFrame(resolve));
    };
    const renderer=aquarium.renderer;
    await renderAndWait();
    const before={...renderer.info.memory};
    for(let i=0;i<3;i++){
      const {plant}=sim.addPlant(state,'moss');
      const {item:stone}=sim.addHardscape(state,'stone');
      const {item:wood}=sim.addHardscape(state,'wood');
      const {item:duck}=sim.addToy(state,'duck');
      const {item:diver}=sim.addToy(state,'diver');
      const {item:ring}=sim.addToy(state,'swimRing');
      await renderAndWait();
      sim.removePlant(state,plant.id);
      sim.removeHardscape(state,stone.id);
      sim.removeHardscape(state,wood.id);
      sim.removeToy(state,duck.id);
      sim.removeToy(state,diver.id);
      sim.removeToy(state,ring.id);
      await renderAndWait();
    }
    state.equipment.light=false;
    await renderAndWait();
    const after={...renderer.info.memory};
    const draws=renderer.info.render.calls, triangles=renderer.info.render.triangles;
    for (const item of [...state.hardscape]) sim.removeHardscape(state,item.id);
    for (const plant of [...state.plants]) sim.removePlant(state,plant.id);
    await renderAndWait();
    const bareTriangles=renderer.info.render.triangles;
    const gpu=renderer.getContext().getError();
    aquarium.dispose();
    return {before,after,draws,triangles,bareTriangles,gpu};
  });
  assert.equal(metrics.gpu,0);
  assert.equal(metrics.before.textures,metrics.after.textures);
  assert.equal(metrics.before.geometries,metrics.after.geometries);
  assert.ok(metrics.bareTriangles < metrics.triangles);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(metrics));
} finally {
  await browser.close();
}
