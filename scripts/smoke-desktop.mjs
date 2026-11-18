import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
// Isolate the smoke tank from the installed application's single-instance lock and save.
const profile=await mkdtemp(path.join(tmpdir(),'aquarium-smoke-'));
const entry=process.env.AQUARIUM_PACKAGED_APP
  ? path.resolve(process.env.AQUARIUM_PACKAGED_APP,'Contents/Resources/app.asar/electron/main.cjs')
  : path.resolve('electron/main.cjs');
const harness=path.join(profile,'main.cjs');
await writeFile(harness,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(entry)});`);
let application;
try{
  application=await electron.launch({args:[harness],env});
  const page=await application.firstWindow();
  await page.waitForFunction(()=>window.aquariumDiagnostics?.stats.fps>0);
  const errors=[], textures=new Set();
  page.on('response',r=>{
    if(/\/(?:foliage|substrate|hardscape)\//.test(r.url()) && r.ok()) textures.add(r.url());
  });
  page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  // Observe an entire load, including resources requested before firstWindow() resolved.
  await page.reload();
  await page.waitForFunction(()=>window.aquariumDiagnostics?.stats.fps>0,{},{timeout:30000});
  await page.waitForLoadState('networkidle');
  const textureFiles=[...textures];
  assert.deepEqual(errors,[], 'no console or resource errors on cold start');
  for(const family of ['foliage','substrate','hardscape']){
    assert.ok(textureFiles.some(url=>url.includes('/'+family+'/')), family+' packaged textures load from '+page.url());
  }
  await page.evaluate(urls=>Promise.all(urls.map(url=>{
    const image=new Image();image.src=url;return image.decode();
  })),textureFiles);
  const info=await page.evaluate(()=>window.aquariumDesktop.getInfo());
  assert.equal(info.gpuFeatures.webgl,'enabled');
  const shell=await application.evaluate(({BrowserWindow})=>{
    const w=BrowserWindow.getAllWindows()[0];return{background:w.getBackgroundColor(),bounds:w.getBounds(),webPreferences:w.webContents.getLastWebPreferences()};
  });
  assert.ok(['#00000000','#000000'].includes(shell.background));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(shell.webPreferences.sandbox,true);
  assert.equal(shell.webPreferences.nodeIntegration,false);
  assert.equal(shell.webPreferences.contextIsolation,true);
  await page.mouse.move(500,400);
  await page.getByRole('button',{name:'查看水质',exact:true}).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#panel').isVisible(),true);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/desktop-controls.png',omitBackground:true});
  await page.keyboard.press('Escape');
  await page.mouse.move(1,1);
  await page.waitForTimeout(8000);
  await page.screenshot({path:'artifacts/desktop-transparent.png',omitBackground:true});
  const stats=await page.evaluate(()=>window.aquariumDiagnostics.stats);
  assert.deepEqual(errors,[]);
  const report={passed:true,gpuFeatures:info.gpuFeatures,stats,background:shell.background,bounds:shell.bounds,textureFiles:textureFiles.length,errors};
  await writeFile('artifacts/smoke-desktop.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await application?.close();await rm(profile,{recursive:true,force:true});}
