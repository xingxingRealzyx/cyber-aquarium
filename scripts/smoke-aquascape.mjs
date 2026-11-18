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
      sim.addPlant(state,'moss');
      await renderAndWait();
      state.plants.pop();
      await renderAndWait();
    }
    state.equipment.light=false;
    await renderAndWait();
    const after={...renderer.info.memory};
    const draws=renderer.info.render.calls, triangles=renderer.info.render.triangles;
    const gpu=renderer.getContext().getError();
    aquarium.dispose();
    return {before,after,draws,triangles,gpu};
  });
  assert.equal(metrics.gpu,0);
  assert.equal(metrics.before.textures,metrics.after.textures);
  assert.equal(metrics.before.geometries,metrics.after.geometries);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(metrics));
} finally {
  await browser.close();
}
