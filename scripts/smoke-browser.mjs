import { chromium } from 'playwright';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
const candidates=[process.env.CHROMIUM_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',path.join(homedir(),'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium')].filter(Boolean);
let executablePath;
for(const candidate of candidates){try{await access(candidate);executablePath=candidate;break;}catch{}}
const browser=await chromium.launch({executablePath,headless:true});
const page=await browser.newPage({viewport:{width:1040,height:760},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text());});

async function verifyUpdateBadge() {
  // Exercise the renderer with the same update events as Electron, without using GitHub or the installer.
  await page.addInitScript(() => {
    window.installCalls = 0;
    window.aquariumDesktop = {
      getInfo: async () => ({}), onState() {}, setPointerInside() {},
      getUpdateState: async () => ({phase: 'idle', currentVersion: '1.0.0'}),
      onUpdateState: handler => window.addEventListener('test-update', e => handler(e.detail)),
      checkForUpdate: async () => ({phase: 'current', currentVersion: '1.0.0'}),
      installUpdate: async () => {
        window.installCalls++;
        return {phase: 'downloading', progress: 1};
      },
    };
  });
  await page.reload();
  await page.waitForFunction(() => window.aquariumDiagnostics?.stats.fps > 0);
  await page.mouse.move(520, 380);
  const settings = page.locator('#dock [data-action="settings"]');
  const dot = settings.locator('#update-dot');
  const emit = (phase, latestVersion) => page.evaluate(detail => {
    window.dispatchEvent(new CustomEvent('test-update', {detail}));
  }, {phase, currentVersion: '1.0.0', latestVersion});
  assert.equal(await dot.count(), 1);
  assert.equal(await dot.isVisible(), false);
  await emit('available', '1.1.0');
  assert.equal(await page.locator('#panel').isVisible(), false);
  assert.equal(await dot.isVisible(), true);
  assert.match(await settings.getAttribute('aria-description'), /1\.1\.0/);
  assert.ok(await dot.evaluate(el => getComputedStyle(el).backgroundColor ===
    getComputedStyle(document.querySelector('#infection-dot')).backgroundColor));
  await settings.click();
  const controls = page.locator('.update-control');
  assert.match(await controls.getByRole('status').innerText(), /发现新版本 v1\.1\.0/);
  assert.equal(await controls.locator('[data-action="install-update"]').isEnabled(), true);
  const content = page.locator('#panel-content');
  await page.setViewportSize({width: 720, height: 520});
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await content.evaluate(el => el.scrollTop > 0));
  await settings.click();
  assert.equal(await content.evaluate(el => el.scrollTop), 0);
  assert.equal(await page.evaluate(() => window.installCalls), 0);
  for (const phase of ['current', 'error']) {
    await emit(phase);
    assert.equal(await dot.isVisible(), false);
    assert.equal(await controls.locator('[data-action="install-update"]').count(), 0);
  }
}

try{
  await page.goto(process.env.AQUARIUM_URL||'http://127.0.0.1:5178/');
  await page.waitForFunction(()=>window.aquariumDiagnostics?.stats.fps>0);
  assert.equal(await page.locator('#error').isVisible(),false);
  assert.equal(await page.locator('#panel').isVisible(),false);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
  const first=await page.evaluate(()=>window.aquariumDiagnostics);
  assert.equal(first.state.animals.length,12);
  assert.equal(first.state.plants.length,9);
  await page.mouse.move(500,400);
  await page.getByRole('button',{name:'投喂',exact:true}).click();
  assert.ok((await page.evaluate(()=>window.aquariumDiagnostics.state.food))>0);
  await page.getByRole('button',{name:'添加生物',exact:true}).click();
  await page.locator('[data-add-animal="neon"]').click();
  await page.locator('[data-action="scenery"]').click();
  await page.locator('[data-add-plant="moss"]').click();
  const addedPlants=await page.evaluate(()=>window.aquariumDiagnostics.state.plants.map(p=>p.id));
  await page.locator('[data-add-plant="moss"]').click();
  await page.getByRole('button',{name:'减少一丛爪哇莫丝'}).click();
  assert.deepEqual(await page.evaluate(()=>window.aquariumDiagnostics.state.plants.map(p=>p.id)),addedPlants);
  const initialScenery=await page.evaluate(()=>window.aquariumDiagnostics.state.hardscape);
  for (const kind of ['wood','stone']) {
    await page.locator(`[data-add-hardscape="${kind}"]`).click();
    await page.locator(`[data-show-kind="${kind}"]`).click();
    const item=initialScenery.find(item=>item.kind===kind);
    await page.locator(`.placed-items [data-remove-hardscape="${item.id}"]`).click();
    const pieces=await page.evaluate(()=>window.aquariumDiagnostics.state.hardscape);
    assert.equal(pieces.filter(piece=>piece.kind===kind).length,initialScenery.filter(piece=>piece.kind===kind).length);
    assert.ok(!pieces.some(piece=>piece.id===item.id));
  }
  assert.equal((await page.evaluate(()=>window.aquariumDiagnostics.state.animals.length)),13);
  assert.equal((await page.evaluate(()=>window.aquariumDiagnostics.state.plants.length)),10);
  await page.locator('[data-tab="life"]').click();
  await page.locator('[data-select]').first().click();
  assert.equal(await page.locator('#inspector').isVisible(),true);
  await page.locator('[data-tab="water"]').click();
  const preChange=await page.evaluate(()=>window.aquariumDiagnostics.state.water.nitrate);
  await page.locator('[data-action="change-water"]').click();
  const postChange=await page.evaluate(()=>window.aquariumDiagnostics.state.water.nitrate);
  assert.ok(postChange<preChange*.8,'water change removes dissolved nitrogen');
  await page.locator('[data-equipment="aerator"]').click();
  assert.equal(await page.evaluate(()=>window.aquariumDiagnostics.state.equipment.aerator),false);
  await page.getByRole('button',{name:'鱼缸设置',exact:true}).click();
  const activeTab = page.locator('.tabs .active');
  assert.equal(await activeTab.getAttribute('data-tab'), 'settings');
  assert.equal(await page.locator('#update-dot').isVisible(), false);
  assert.equal(await page.locator('.update-control').count(), 0);
  assert.equal(await page.locator('[data-action="quit"]').count(), 0);
  await page.setViewportSize({width:720,height:520});
  const tabs = page.locator('.tabs');
  assert.ok(await tabs.evaluate(nav => nav.scrollWidth <= nav.clientWidth), 'all tabs fit in compact mode');
  for (const tab of ['water','life','scenery','settings','journal']) {
    await tabs.locator(`[data-tab="${tab}"]`).click();
    assert.equal(await activeTab.getAttribute('data-tab'), tab);
  }
  assert.ok(await page.locator('.event-list .event').count() > 0);
  assert.equal(await page.locator('#panel-content').locator('[data-speed], [data-action="pin"], [data-action="check-update"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.mouse.click(360, 230, {button:'right'});
  assert.equal(await activeTab.getAttribute('data-tab'), 'settings');
  assert.equal(await page.locator('.event-list').count(), 0);
  await page.locator('[data-speed="3600"]').click();
  await page.locator('[data-action="pause"]').click();
  const saved=await page.evaluate(()=>window.aquariumDiagnostics.state);
  assert.equal(saved.speed,3600); assert.equal(saved.paused,true);
  await page.setViewportSize({width:1040,height:760});
  await page.reload();
  await page.waitForFunction(()=>window.aquariumDiagnostics?.stats.fps>0);
  const restored=await page.evaluate(()=>window.aquariumDiagnostics.state);
  assert.equal(restored.animals.length,13); assert.equal(restored.plants.length,10);
  assert.deepEqual(restored.hardscape,saved.hardscape);
  assert.equal(restored.speed,3600); assert.equal(restored.paused,true);
  assert.equal(restored.equipment.aerator,false);
  assert.equal(restored.animals[0].id,saved.animals[0].id);
  await page.keyboard.press('Escape');
  await page.mouse.move(1,1);
  await page.waitForTimeout(8000);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/aquarium-transparent.png',omitBackground:true});
  await page.mouse.move(500,400);
  await page.getByRole('button',{name:'查看水质',exact:true}).click();
  await page.screenshot({path:'artifacts/aquarium-controls.png',omitBackground:true});
  await verifyUpdateBadge();
  assert.deepEqual(errors,[],'no JavaScript or shader errors');
  const report={passed:true,checks:['transparent background','WebGL renderer','hidden controls','feeding','add fish and plants','edit individual plants and hardscape','individual inspection','water change','equipment controls','compact tabs','journal and settings navigation','update badge and release notification','clock and pause','persistence'],stats:await page.evaluate(()=>window.aquariumDiagnostics.stats),errors};
  await writeFile('artifacts/smoke-browser.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
