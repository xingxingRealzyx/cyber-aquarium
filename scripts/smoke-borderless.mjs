import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(path.join(tmpdir(), 'aquarium-borderless-'));
const harness = path.join(profile, 'main.cjs');
const entry = process.env.AQUARIUM_PACKAGED_APP
  ? path.resolve(process.env.AQUARIUM_PACKAGED_APP, 'Contents/Resources/app.asar/electron/main.cjs')
  : path.resolve('electron/main.cjs');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.env.AQUARIUM_PACKAGED_APP) delete env.ELECTRON_RENDERER_URL;

await writeFile(harness, `
  const { app, screen } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  app.setPath('appData', ${JSON.stringify(profile)});
  app.on('browser-window-created', (_, win) => {
    // Keep this independent test overlay off the user's desktop. CDP still drives
    // the normal renderer and the window's real input-routing API.
    win.show = win.showInactive = () => {};
    const ignore = win.setIgnoreMouseEvents.bind(win);
    win.setIgnoreMouseEvents = (flag, options) => {
      globalThis.ignored = flag;
      return ignore(flag, options);
    };
  });
  app.whenReady().then(() => {
    const dir = path.join(app.getPath('appData'), 'Cyber Aquarium');
    fs.mkdirSync(dir, { recursive:true });
    const prefs = path.join(dir, 'desktop.json');
    if (fs.existsSync(prefs)) return;
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(720, area.width), height = Math.min(520, area.height);
    const bounds = { x:area.x+Math.round((area.width-width)*.4), y:area.y+Math.round((area.height-height)*.54), width,height };
    fs.writeFileSync(prefs, JSON.stringify({alwaysOnTop:false,isCompact:true,bounds}));
  });
  require(${JSON.stringify(entry)});
`);

let instance;
const errors = [];
async function open() {
  instance = await electron.launch({args:[harness],env});
  const page = await instance.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type()==='error') errors.push(message.text()); });
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps>0);
  return page;
}
const getInfo = page => page.evaluate(() => window.aquariumDesktop.getInfo());
const animals = page => page.evaluate(() => window.aquariumDiagnostics.screenAnimals);
const spread = points => Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
const center = rect => ({x:rect.x + rect.width/2, y:rect.y + rect.height/2});
const outside = (point,rect) => point.x < rect.x || point.x > rect.x+rect.width || point.y < rect.y || point.y > rect.y+rect.height;
async function nativeInput(flag) {
  for(let i=0; i<35; i++) {
    if (await instance.evaluate(() => globalThis.ignored) === flag) return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('Expected native setIgnoreMouseEvents('+flag+')');
}
async function geometry(page) {
  const native = await instance.evaluate(({BrowserWindow,screen})=>{
    const win=BrowserWindow.getAllWindows()[0], bounds=win.getBounds();
    return {bounds,area:screen.getDisplayMatching(bounds).workArea};
  });
  assert.deepEqual(native.bounds,native.area,'native overlay fills display work area');
  const rect = await page.locator('#aquarium canvas').boundingBox();
  assert.deepEqual(rect,{x:0,y:0,width:native.area.width,height:native.area.height},'GPU canvas fills overlay');
  return native.area;
}
async function waitForNewFrame(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

try {
  let page=await open();
  const area = await geometry(page);
  const {layout,isCompact} = await getInfo(page);
  assert.ok(isCompact && layout,'legacy compact preference is restored');
  assert.equal(layout.width,Math.min(720,area.width));
  assert.equal(layout.height,Math.min(520,area.height));
  assert.equal(layout.x,Math.round((area.width-layout.width)*.4));
  assert.equal(layout.y,Math.round((area.height-layout.height)*.54));

  const fixture=await page.evaluate(()=>{
    const state=window.aquariumDiagnostics.state;
    state.animals=state.animals.slice(0,2);
    state.animals.forEach((a,i)=>{
      a.position={x:i?2:-2,y:2.05,z:0};
      a.velocity={x:0,y:0,z:0};
    });
    state.paused=true;
    return state;
  });
  await page.addInitScript(saved=>localStorage.setItem('chengjing.aquarium.v1',JSON.stringify(saved)),fixture);
  await page.reload();
  await page.waitForFunction(()=>window.aquariumDiagnostics?.state.paused && window.aquariumDiagnostics.stats.fps>0);
  const origin=center(layout), initial=await animals(page);
  assert.equal(initial.length,2);
  const base=spread(initial);
  await page.mouse.move(origin.x,origin.y);
  await nativeInput(false);
  await page.mouse.move(2,2);
  await nativeInput(true);
  await page.mouse.move(origin.x,origin.y);
  await nativeInput(false);

  let sample, escapedFish;
  for(let step=0;step<75;step++) {
    await page.mouse.wheel(0,-110);
    await waitForNewFrame(page);
    const points=await animals(page);
    const factor=spread(points)/base;
    if (!escapedFish) {
      const point=points.find(p=>p.visible && outside(p,layout) &&
        p.x>20 && p.x<area.width-20 && p.y>20 && p.y<area.height-20);
      if (point) {
        await page.mouse.move(point.x,point.y);
        await nativeInput(false);
        await page.mouse.click(point.x,point.y);
        await page.waitForFunction(id=>window.aquariumDiagnostics.selectedId===id,point.id,{timeout:2000});
        escapedFish=point;
        await page.keyboard.press('Escape');
        await page.mouse.move(origin.x,origin.y);
      }
    }
    if(factor>8) { sample=factor;break; }
  }
  assert.ok(escapedFish,'a rendered fish crosses the former window edge while visible');
  assert.ok(sample,'real wheel events can magnify beyond eight times the original view');
  for(let i=0;i<4;i++){ await page.mouse.wheel(0,-190); await waitForNewFrame(page); }
  const farther=spread(await animals(page))/base;
  assert.ok(farther>sample*1.1,'zoom keeps progressing in close-up');
  await page.mouse.dblclick(origin.x,origin.y);
  await waitForNewFrame(page);
  assert.ok(Math.abs(spread(await animals(page))/base-1)<.015,'double-click resets continuous zoom');

  await page.mouse.move(origin.x,origin.y);
  const handle=page.getByRole('button',{name:'移动鱼缸',exact:true});
  const h=center(await handle.boundingBox());
  const dx=layout.x>60?-45:45, dy=layout.y>50?-30:30;
  await page.mouse.move(h.x,h.y);
  await page.mouse.down();
  await page.mouse.move(h.x+dx,h.y+dy,{steps:5});
  await page.mouse.up();
  await page.waitForFunction(({layout,dx,dy})=>window.aquariumDesktop.getInfo().then(({layout:p})=>
    Math.abs(p.x-layout.x-dx)<3 && Math.abs(p.y-layout.y-dy)<3),{layout,dx,dy},{timeout:5000});
  await geometry(page);
  await waitForNewFrame(page);
  const moved=await animals(page);
  assert.ok(Math.abs(moved[0].x-initial[0].x-dx)<3 && Math.abs(moved[0].y-initial[0].y-dy)<3,'pixels follow logical drag');

  await page.evaluate(()=>window.aquariumDesktop.setCompact(false));
  const standard=await getInfo(page);
  assert.equal(standard.isCompact,false);
  assert.equal(standard.layout.width,Math.min(1040,area.width));
  await geometry(page);
  await instance.close();
  instance=null;

  page=await open();
  const reopened=await getInfo(page);
  assert.deepEqual(reopened.layout,standard.layout,'relaunch restores the moved logical widget');
  assert.deepEqual((await animals(page)).map(a=>a.id), initial.map(a=>a.id),'relaunch preserves tank residents');
  await geometry(page);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,area,legacy:layout,restored:reopened.layout,magnification:[sample,farther]},null,2));
} finally {
  await instance?.close();
  await rm(profile,{recursive:true,force:true});
}
