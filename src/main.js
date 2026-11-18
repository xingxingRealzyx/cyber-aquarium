import './style.css';
import { createAquarium } from './aquarium.js';
import { advanceBehavior } from './behavior.js';
import { sceneryPanel } from './scenery-panel.js';
import { REPRODUCTION } from './reproduction.js';
import {
  createInitialState, restoreState, advanceSimulation, addAnimal, addPlant, feed,
  changeWater, removeAnimal, removeDead, getAssessment, SPECIES,
  addHardscape, removeHardscape, removePlant, animalLifeStage, relativeAdultSize, availableAnimalSlots,
  corpseDecay, INFECTIONS, careForFish,
} from './simulation.js';

const SAVE_KEY = 'chengjing.aquarium.v1';
const desktop = window.aquariumDesktop;
const trayLocation = desktop?.platform === 'win32' ? '系统托盘' : '菜单栏';
const $ = (s) => document.querySelector(s);
const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  fish:'<path d="M17 12c-4-7-10-7-14 0 4 7 10 7 14 0Zm0 0 4-4v8l-4-4Z"/><circle cx="7" cy="11" r=".7"/>',
  drop:'<path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  leaf:'<path d="M20 4C9 2 2 8 5 16c8 4 15-1 15-12Z"/><path d="m4 21 11-12"/>',
  feed:'<path d="m4 8 8-5 8 5-8 5-8-5Zm0 0v8l8 5 8-5V8M12 13v8"/>',
  sliders:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  rotate:'<path d="M20 8a9 9 0 1 0 1 7M20 3v5h-5"/>',
  move:'<path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="m7 4 13 8-13 8V4Z"/>',
  pin:'<path d="m8 3 8 0-1 6 4 4v2H5v-2l4-4-1-6ZM12 15v7"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.fish}</svg>`;
let state;
let saveError = false;
try {
  const raw = localStorage.getItem(SAVE_KEY);
  state = raw ? restoreState(JSON.parse(raw)) : createInitialState();
  if (!raw) state.speed = 60;
} catch {
  state = createInitialState();
  state.speed = 60;
  saveError = true;
}
let panelOpen = false, activeTab = 'water', selectedId = null, autoRotate = false;
let expandedKind = null, updateState = { phase: 'idle' }, lastPanelHTML = '';
let stockingSex = 'random';
let pinned = false, compact = false, stats = { fps: 0 }, renderer;
let desktopLayout=null, sentPointerInside=null;
let verifyUpdateFrame=false;
let pointerDown = false;
let lastPointer = { x: -1, y: -1 };
let toastTimeout, hoverTimeout, lastUI = 0, lastSave = 0, lastInspector = 0;
let knownPatients = new Set();
const app = $('#app');
app.innerHTML = `
  <div id="hint" class="intro-hint">点击鱼看档案 · 拖动旋转<span>按住底部「移动」调整桌面位置</span></div>
  <aside id="panel" class="panel interactive" aria-label="鱼缸管理" hidden>
    <header><div><span class="eyebrow">YOUR LIVING AQUARIUM</span><h1>照料这一方水</h1></div><button class="icon-btn" data-action="close" aria-label="关闭面板">${icon('close')}</button></header>
    <nav class="tabs" aria-label="管理分类">
      <button data-tab="water" class="active" aria-current="page">水环境</button>
      <button data-tab="life">生物</button>
      <button data-tab="scenery">造景</button>
      <button data-tab="journal">日志</button>
      <button data-tab="settings">设置</button>
    </nav>
    <div id="panel-content" class="panel-content"></div>
    <footer><span id="render-stat">WebGL 2</span><span>60 L · 淡水生态</span>
      ${desktop?.quit ? '<button type="button" class="quit-btn" data-action="quit" title="保存进度并退出应用">退出鱼缸</button>' : ''}
    </footer>
  </aside>
  <aside id="inspector" class="inspector interactive" aria-label="生物个体档案" hidden>
    <button class="icon-btn" data-action="deselect" aria-label="关闭生物信息">${icon('close')}</button>
    <header>
      <span class="eyebrow">INDIVIDUAL LIFE · 个体档案</span>
      <div class="individual-heading">
        <div class="individual-name"><h2></h2><span class="individual-sex">性别 <b data-field="sex"></b></span></div>
        <small></small>
      </div>
    </header>
    <section class="case-card" aria-label="感染护理" hidden>
      <div class="case-heading"><strong data-field="infection"></strong><span data-field="case-status"></span></div>
      <p data-field="case-note"></p>
      <button class="primary-btn" data-action="care">开始护理</button>
    </section>
    <section class="individual-details"></section>
    <button class="secondary-btn individual-feed" data-action="feed">${icon('feed')} 投喂全缸</button>
    <button class="danger-btn" data-action="remove-animal">移出鱼缸</button>
  </aside>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div class="dock-wrap chrome interactive"><div id="dock" class="dock">
    <button type="button" class="drag-handle" title="按住这里移动整个鱼缸" aria-label="移动鱼缸">${icon('move')}<span>移动</span></button><i></i>
    <button data-action="feed" aria-label="投喂" title="投喂少量饲料">${icon('feed')}<span>投喂</span></button>
    <button data-action="water" aria-label="查看水质" title="水质与设备">${icon('drop')}<span>水质</span><em id="health-dot"></em></button>
    <button data-action="life" aria-label="添加生物" title="管理鱼、水生物和造景">${icon('fish')}<span>生物</span><em class="warning" id="infection-dot" hidden></em></button><i></i>
    <button data-action="rotate" aria-label="自动旋转" title="自动环绕">${icon('rotate')}</button>
    <button data-action="settings" aria-label="鱼缸设置" title="鱼缸设置">${icon('sliders')}<em class="warning" id="update-dot" aria-hidden="true" hidden></em></button>
  </div><div class="dock-caption">点击鱼看档案 · 拖动旋转 · 滚轮缩放</div></div>
  <div id="error" class="error-card interactive" hidden></div>
`;

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  catch { if (!saveError) notify('本地存档不可用，本次进度暂未保存'); saveError = true; }
}
function timeLabel(hours) {
  return `第 ${Math.floor(hours / 24) + 1} 天 · ${String(Math.floor(hours % 24)).padStart(2,'0')}:${String(Math.floor(hours * 60 % 60)).padStart(2,'0')}`;
}
function bar(value, max, kind = '') {
  return `<div class="meter ${kind}"><span style="width:${Math.min(100,Math.max(0,value/max*100))}%"></span></div>`;
}
function metric(name, value, unit, note, valueRatio, severity = '') {
  return `<div class="metric ${severity}"><div class="metric-top"><span>${name}</span><small>${unit}</small></div><strong>${value}</strong>${bar(valueRatio, 1, severity)}<small>${note}</small></div>`;
}
function animalLabel(a) {
  return a.label || `${SPECIES[a.species]?.name || '水下居民'} · ${a.id.slice(-4)}`;
}
function stageLabel(a) {
  const stage = animalLifeStage(a);
  if (stage === 'senior') return '老年鱼';
  const kind = a.species === 'shrimp' ? '虾' : a.species === 'snail' ? '螺' : '鱼';
  return (stage === 'juvenile' ? '幼' : '成') + kind;
}
function sexLabel(a) {
  return a.sex === 'male' ? '公' : '母';
}
function behaviorLabel(a) {
  if(!a.alive) return '已死亡 · 待捞起';
  if(state.paused) return '已暂停';
  return ({seeking:'正在追逐饲料',eating:'正在进食',resting:'饱腹休憩',gasping:'浮头呼吸',grazing:'底部觅食',swimming:'自由游动'})[a.behavior] || '自由游动';
}
function durationLabel(hours) {
  if(hours<1/60) return '不到 1 分钟';
  if(hours<1) return `${Math.floor(hours*60)} 分钟`;
  if(hours<24) return `${hours.toFixed(1)} 小时`;
  return `${Math.floor(hours/24)} 天 ${Math.floor(hours%24)} 小时`;
}
function broodTiming(brood) {
  const action = REPRODUCTION[brood.species].kind === 'livebearer' ? '出生' : '孵化';
  return `预计 ${durationLabel(Math.max(0, brood.dueAtHours - state.elapsedHours))}后${action}（缸内时间）`;
}
function breedingSummary(a) {
  const brood = state.broods.find(b => b.motherId === a.id || b.fatherId === a.id);
  if (brood) {
    const role = brood.motherId === a.id ? '本窝母亲' : '本窝父亲';
    return `${REPRODUCTION[a.species].label}（${role}） · ${broodTiming(brood)}`;
  }
  if (animalLifeStage(a) === 'juvenile') return '成年后可与同种异性配对';
  if (animalLifeStage(a) === 'senior') return '已过繁殖期';
  const mate = state.animals.some(b => b.alive && b.species === a.species && b.sex !== a.sex && animalLifeStage(b) === 'adult');
  const kind = a.species === 'shrimp' ? '虾' : a.species === 'snail' ? '螺' : '鱼';
  return mate ? '已有同种异性成体，条件合适时会自行配对' : `缸中还缺一只同种成年${a.sex === 'female' ? '公' : '母'}${kind}`;
}
function broodPanel() {
  if (!state.broods.length) return '';
  return `<section class="brood-panel" aria-label="繁殖进度"><div class="section-label"><span>繁殖进度</span><span>${state.broods.length} 窝</span></div>
    ${state.broods.map(b => `<div class="brood-row"><b>${SPECIES[b.species].name} · ${REPRODUCTION[b.species].label}</b>
      <small>${broodTiming(b)}</small></div>`).join('')}</section>`;
}
function waterPanel() {
  const w=state.water, a=getAssessment(state), living=state.animals.filter(x=>x.alive).length;
  return `<div class="assessment ${a.level}"><span class="status-orb"></span><div><b>${escape(a.label)}</b><p>${escape(a.message)}</p></div></div>
    <div class="section-label"><span>水质快照</span><span>${living} 位居民</span></div>
    <div class="metrics">
      ${metric('水温',w.temperature.toFixed(1),'°C','混养目标 24–26 °C',(w.temperature-16)/16,w.temperature<22||w.temperature>28?'warning':'')}
      ${metric('酸碱度',w.ph.toFixed(2),'pH','弱酸至中性水', (w.ph-5)/4,w.ph<6||w.ph>8?'warning':'')}
      ${metric('溶解氧',w.oxygen.toFixed(2),'mg/L','关注缺氧 · 目标 ≥ 5',w.oxygen/10,w.oxygen<4?'danger':w.oxygen<5?'warning':'')}
      ${metric('总氨',w.ammonia.toFixed(3),'mg N/L','TAN · 含 NH₃ / NH₄⁺',w.ammonia/.6,w.ammonia>.2?'warning':'')}
      ${metric('亚硝酸盐',w.nitrite.toFixed(3),'mg N/L','NO₂-N · 越低越好',w.nitrite/.3,w.nitrite>.1?'danger':'')}
      ${metric('硝酸盐',w.nitrate.toFixed(1),'mg N/L','NO₃-N · 植物吸收',w.nitrate/20,w.nitrate>15?'warning':'')}
    </div>
    <div class="action-row"><button class="primary-btn" data-action="change-water">${icon('drop')} 换水 25%</button><button class="secondary-btn" data-action="feed">${icon('feed')} 少量投喂</button></div>
    <p class="micro-note">换入等温、已除氯的新水。残饵与排泄物会持续改变水质。</p>
    <div class="section-label"><span>生命支持</span><span>设备</span></div>
    <div class="equipment">${[['filter','生物过滤','硝化菌分解含氮废物'],['aerator','增氧泵','维持水体气体交换'],['light','水草灯','光合作用与昼夜呼吸'],['heater','恒温加热','缓慢维持目标水温']].map(([key,title,desc])=>`<button class="equipment-row" data-equipment="${key}" role="switch" aria-checked="${state.equipment[key]}"><span><b>${title}</b><small>${desc}</small></span><span class="switch ${state.equipment[key]?'on':''}"></span></button>`).join('')}</div>
    <div class="temperature-control"><label for="temperature">目标温度 <b>${state.equipment.targetTemperature} °C</b></label><input id="temperature" type="range" min="18" max="32" step="1" value="${state.equipment.targetTemperature}" /></div>`;
}
function illnessLevel(severity) {
  return severity >= .65 ? '重症' : severity >= .35 ? '中度' : '轻症';
}
function residentRow(a) {
  const infection = a.alive && a.infection;
  const summary = infection
    ? `${INFECTIONS[infection.kind].label} · ${infection.cared ? '护理中' : illnessLevel(infection.severity)}`
    : behaviorLabel(a);
  const status = a.alive
    ? `<span class="${a.health<50?'warning':''}">健康 ${Math.round(a.health)}%</span><small class="${a.hunger>70?'warning':''}">饥饿 ${Math.round(a.hunger)}%</small>`
    : `<span class="warning">已分解 ${Math.round(corpseDecay(a)*100)}%</span>`;
  return `<button class="resident ${a.id===selectedId?'selected':''}" data-select="${escape(a.id)}">
    <span class="resident-dot ${a.species} ${!a.alive?'dead':''}"></span>
    <span class="resident-name">${escape(animalLabel(a))}<small class="${infection?'case-summary':''}">${sexLabel(a)} · ${stageLabel(a)} · ${summary}</small></span>
    <span class="resident-vitals">${status}</span></button>`;
}
function lifePanel() {
  const alive=state.animals.filter(x=>x.alive), dead=state.animals.filter(x=>!x.alive);
  const freeSlots = availableAnimalSlots(state);
  const patients = alive.filter(a => a.infection);
  const ordered = patients.length ? [...patients, ...state.animals.filter(a => !a.alive || !a.infection)] : state.animals;
  const residents = `<div class="section-label"><span>个体状态</span><span>${patients.length ? `${patients.length} 条鱼感染 · 点选护理` : '点击鱼也可查看'}</span></div>
    <div class="residents">${ordered.map(residentRow).join('')}</div>`;
  const speciesCards = Object.entries(SPECIES).map(([key, species]) => `
    <button class="species-card" data-add-animal="${key}" aria-label="放入${escape(species.name)}" ${freeSlots <= 0 ? 'disabled' : ''}>
      <img class="species-portrait" src="./species/${key}.png" width="420" height="192" alt="" draggable="false" />
      <span class="species-caption"><b>${escape(species.name)}</b><span aria-hidden="true">＋</span></span>
      <small lang="la">${escape(species.latin)}</small>
    </button>`).join('');
  return `<div class="section-label"><span>水下居民</span><span>${alive.length} 存活${dead.length?` · ${dead.length} 死亡`:''}</span></div>
    ${dead.length?`<button class="danger-btn" data-action="remove-dead">捞起全部遗体（${dead.length}）</button><p class="micro-note">也可点选一只遗体单独捞起。</p>`:''}
    ${patients.length ? residents : ''}
    ${broodPanel()}
    <div class="stock-options"><span>入缸性别</span><div role="group" aria-label="新加入生物的性别">
      ${[['random','随机'],['male','公'],['female','母']].map(([value,label]) => `<button data-stock-sex="${value}" aria-pressed="${stockingSex === value}">${label}</button>`).join('')}
    </div></div>
    ${freeSlots ? '' : '<p class="micro-note">缸中已无空位，孕育中的幼体也会预留位置。</p>'}
    <div class="species-grid">${speciesCards}</div>
    <button class="wide-btn" data-action="scenery">${icon('leaf')} 管理水草与造景</button>
    ${patients.length ? '' : residents}`;
}
function updateControls() {
  if (!desktop?.checkForUpdate) return '';
  const {phase, currentVersion, latestVersion, progress = 0, message} = updateState;
  const version = currentVersion ? `v${escape(currentVersion)}` : '';
  const available = phase === 'available';
  const busy = ['checking','downloading','installing'].includes(phase);
  const labels = {checking:'正在检查…', downloading:`正在下载 · ${progress}%`, installing:'正在安装…', available:'下载并重启更新'};
  const status = {current:'当前已是最新版本', available:`发现新版本 v${latestVersion}`, installing:'正在安装，完成后鱼缸会重新打开。', error:message}[phase];
  return `<section class="update-control" aria-label="软件更新">
    <div class="section-label"><span>软件更新</span><span>${version}</span></div>
    ${status ? `<p class="update-status" role="status">${escape(status)}</p>` : ''}
    ${phase === 'downloading' ? `<progress aria-label="更新下载进度" value="${progress}" max="100"></progress>` : ''}
    <button class="${available ? 'primary-btn' : 'wide-btn'}" data-action="${available ? 'install-update' : 'check-update'}" ${busy ? 'disabled' : ''}>${labels[phase] || '检查更新'}</button>
  </section>`;
}
function applyUpdateState(value) {
  if (!value) return;
  updateState = value;
  const dot = $('#update-dot');
  dot.hidden = value.phase !== 'available';
  const settingsButton = dot.parentElement;
  if (dot.hidden) {
    settingsButton.title = '鱼缸设置';
    settingsButton.removeAttribute('aria-description');
  } else {
    const notice = `发现新版本 v${value.latestVersion}`;
    settingsButton.title = `鱼缸设置 · ${notice}`;
    settingsButton.setAttribute('aria-description', notice);
  }
  if (value.phase === 'installing') persist();
  if (panelOpen && activeTab === 'settings') updatePanel();
}
async function runUpdate(install) {
  if (install) persist();
  try {
    applyUpdateState(await (install ? desktop.installUpdate() : desktop.checkForUpdate()));
  } catch {
    applyUpdateState({...updateState, phase:'error', message:'更新服务暂时不可用，请再试一次。'});
  }
}
function journalPanel() {
  return `<div class="section-label"><span>最近事件</span><span>${timeLabel(state.elapsedHours)}</span></div>
    <div class="event-list">${state.events.slice(0,15).map(e=>`<article class="event ${escape(e.type)}"><span></span><div><small>${timeLabel(e.time)}</small><p>${escape(e.message)}</p></div></article>`).join('')||'<p class="micro-note">暂无鱼缸事件</p>'}</div>`;
}
function settingsPanel() {
  return `${updateControls()}
    <div class="section-label"><span>生态时间流速</span><button class="text-btn" data-action="pause">${state.paused?'继续模拟':'暂停模拟'}</button></div>
    <div class="speed-options">${[[1,'实时'],[60,'60×'],[3600,'3600×']].map(([v,label])=>`<button data-speed="${v}" class="${state.speed===v?'selected':''}">${label}</button>`).join('')}</div>
    <p class="micro-note">${state.speed===1?'现实 1 小时 = 缸内 1 小时。':state.speed===60?'现实 1 秒 = 缸内 1 分钟。':'现实 1 秒 = 缸内 1 小时；请留意水质和饥饿。'}${state.paused?' 当前已暂停生态演化。':''}关闭应用后生态暂停。</p>
    <div class="section-label"><span>桌面摆放</span><span>${desktop?'原生透明桌面':'浏览器预览'}</span></div>
    <div class="desktop-actions"><button class="secondary-btn ${pinned?'selected':''}" data-action="pin">${icon('pin')}${pinned?'已置顶':'置顶显示'}</button><button class="secondary-btn" data-action="compact">${icon('expand')}${compact?'标准大小':'小巧模式'}</button></div>
    <button class="wide-btn" data-action="reset-view">${icon('rotate')} 重置观察角度</button>
    ${desktop?`<button class="wide-btn" data-action="click-through">穿透鼠标 · 在${trayLocation}鱼图标中恢复</button>`:''}
    <details class="model-note"><summary>关于这只鱼缸</summary><p>鱼缸由 GPU 实时渲染。水质遵循简化的氮循环、溶氧和温度模型；毒性随 pH 和温度变化，健康会累积损伤，鱼也会因缺氧、毒性与饥饿死亡。</p><p>每只生物都有独立状态；饲料需要实际接触才能被吃到。游动节奏保持自然，生态时间可独立加速。</p><p>这是生态模拟原型，参数经过玩法标定。鱼可能随机遭遇病毒或细菌感染，可在个体档案中护理。鱼、虾、螺会与同种异性成体繁殖；为便于在淡水缸体验，斑马螺卵囊在游戏中可直接孵出小螺。进度仅保存在此设备。</p><p>所有含氮读数统一以氮计，mg N/L。开关灯为手动，默认成熟滤菌缸。</p></details>`;
}
const panelViews = {
  water: waterPanel,
  life: lifePanel,
  scenery: () => sceneryPanel(state, expandedKind, escape),
  journal: journalPanel,
  settings: settingsPanel,
};
function updatePanel() {
  const assessment=getAssessment(state);
  $('#health-dot').className=assessment.level;
  const patients = state.animals.filter(a => a.alive && a.infection);
  $('#infection-dot').hidden = patients.length === 0;
  const newPatient = patients.find(a => !knownPatients.has(a.id));
  if (newPatient) notify(`${animalLabel(newPatient)}出现${INFECTIONS[newPatient.infection.kind].label}，点「生物」查看。`);
  knownPatients = new Set(patients.map(a => a.id));
  $('#render-stat').textContent=`WebGL 2 · ${Math.round(stats.fps||0)} FPS`;
  if (panelOpen && !(document.activeElement?.type==='range' && document.activeElement.matches(':active'))) {
    const content=$('#panel-content'), scroll=content.scrollTop, focused=document.activeElement;
    const html = panelViews[activeTab]();
    if(html !== lastPanelHTML && !(pointerDown && content.contains(focused))) {
      const focusKey = content.contains(focused) && focused.getAttributeNames().find(name => name.startsWith('data-'));
      const focusSelector = focusKey ? `[${focusKey}="${CSS.escape(focused.getAttribute(focusKey))}"]`
        : focused?.id === 'temperature' ? '#temperature' : null;
      content.innerHTML=html;
      lastPanelHTML=html;
      content.scrollTop=scroll;
      if(focusSelector) content.querySelector(focusSelector)?.focus({preventScroll:true});
    }
  }
  updateInspector();
}
function openPanel(tab=activeTab) {
  const changed = activeTab !== tab;
  panelOpen=true; activeTab=tab;
  $('#panel').hidden=false;
  $('#panel h1').textContent = tab === 'settings' ? '鱼缸设置' : tab === 'journal' ? '生态日志' : '照料这一方水';
  document.body.classList.add('panel-open','hovering');
  for (const button of document.querySelectorAll('.tabs [data-tab]')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  updatePanel();
  if(changed || (tab === 'settings' && updateState.phase === 'available')) $('#panel-content').scrollTop=0;
  updatePointerPosition(lastPointer);
}
function closePanel() {
  panelOpen=false; $('#panel').hidden=true;
  document.body.classList.remove('panel-open');
  updatePointerPosition(lastPointer);
}
function selectAnimal(id) {
  selectedId=state.animals.some(a=>a.id===id)?id:null;
  if(selectedId) $('#hint').classList.add('dismissed');
  renderer?.setSelectedAnimal?.(selectedId);
  updateInspector();
}
function updateInspector() {
  const a=state.animals.find(x=>x.id===selectedId);
  const inspector=$('#inspector');
  inspector.hidden=!a;
  if (!a) {selectedId=null;inspector.removeAttribute('data-animal-id');renderer?.setSelectedAnimal?.(null);return;}
  if (inspector.dataset.animalId !== a.id) {
    inspector.scrollTop = 0;
    inspector.querySelector('.individual-heading h2').textContent = animalLabel(a);
    inspector.querySelector('.individual-heading small').textContent = SPECIES[a.species].latin;
    inspector.querySelector('[data-field="sex"]').textContent = sexLabel(a);
  }
  inspector.dataset.animalId=a.id;
  inspector.querySelector('.individual-feed').hidden=!a.alive;
  inspector.querySelector('[data-action="remove-animal"]').textContent = a.alive ? '移出鱼缸' : '捞起遗体';
  const ageLabel = a.species === 'shrimp' ? '虾龄' : a.species === 'snail' ? '螺龄' : '鱼龄';
  const adultPercent = Math.round(relativeAdultSize(a) * 100);
  const ageFacts = `
    <div><dt>${a.alive ? '' : '死亡时'}${ageLabel}</dt><dd data-field="fish-age">${durationLabel(a.lifeAgeHours)}</dd></div>
    <div><dt>生命阶段</dt><dd data-field="life-stage">${stageLabel(a)}</dd></div>
    <div><dt>相对成年体长</dt><dd data-field="body-size">${adultPercent}%</dd></div>`;
  const parentName = id => {
    const parent = state.animals.find(p => p.id === id);
    return parent ? escape(animalLabel(parent)) : '已离缸';
  };
  const originFacts = a.origin === 'born' ? `
    <div><dt>出生地</dt><dd data-field="origin">本缸出生</dd></div>
    <div><dt>母亲</dt><dd>${parentName(a.motherId)}</dd></div>
    <div><dt>父亲</dt><dd>${parentName(a.fatherId)}</dd></div>` : '';
  const patient = a.alive && a.infection;
  const card = inspector.querySelector('.case-card');
  card.hidden = !patient;
  if (patient) {
    card.querySelector('[data-field="infection"]').textContent = INFECTIONS[patient.kind].label;
    card.querySelector('[data-field="case-status"]').textContent = `${illnessLevel(patient.severity)} · 病情 ${Math.ceil(patient.severity * 100)}%`;
    card.querySelector('[data-field="case-note"]').textContent = patient.cared
      ? '正在护理，继续模拟即可观察恢复进度。'
      : '这条鱼游动变慢了。及时护理可以减轻病情。';
    const button = card.querySelector('button');
    button.disabled = patient.cared;
    button.textContent = patient.cared ? '护理中' : '开始护理';
  }
  const details = inspector.querySelector('.individual-details');
  if (!a.alive) {
    const decay = Math.round(100 * corpseDecay(a));
    details.innerHTML = `
      <p class="behavior-badge danger" data-field="behavior"><i></i>${behaviorLabel(a)}</p>
      <section class="individual-vitals" aria-label="遗体状态">
        <div class="vital-row"><span>腐败进度</span><strong data-field="decay">${decay}<small>%</small></strong></div>${bar(decay,100,'warning')}
      </section>
      <dl class="individual-facts">
        <div><dt>死因</dt><dd>${escape(a.causeOfDeath||'未知')}</dd></div>
        <div><dt>死亡已过</dt><dd>${durationLabel(Math.max(0,state.elapsedHours-a.deathHours))}</dd></div>
        ${ageFacts}
        ${originFacts}
      </dl>
      <p class="individual-note">遗体分解会消耗溶氧并释放氨。捞起后，已经进入水中的污染物仍需过滤或换水处理。</p>`;
    return;
  }
  const hunger=Math.round(a.hunger), health=Math.round(a.health), stress=Math.round((a.stress||0)*100);
  const lastMeal=a.lastMealHours==null?'尚未摄食':state.elapsedHours-a.lastMealHours<1/60?'刚刚':`${durationLabel(Math.max(0,state.elapsedHours-a.lastMealHours))}前`;
  details.innerHTML=`
    <p class="behavior-badge ${a.behavior==='seeking'||a.behavior==='eating'?'feeding':''}" data-field="behavior"><i></i>${behaviorLabel(a)}</p>
    <section class="individual-vitals" aria-label="个体状态">
      <div class="vital-row"><span>健康度</span><strong data-field="health">${health}<small>%</small></strong></div>${bar(health,100,health<45?'danger':health<75?'warning':'')}
      <div class="vital-row"><span>饥饿度</span><strong data-field="hunger">${hunger}<small>%</small></strong></div>${bar(hunger,100,hunger>80?'danger':'warning')}
      <div class="vital-row"><span>环境压力</span><strong data-field="stress">${stress}<small>%</small></strong></div>${bar(stress,100,stress>60?'danger':'')}
    </section>
    <dl class="individual-facts">
      ${ageFacts}
      <div><dt>体重</dt><dd data-field="mass">${a.mass < .1 ? (a.mass * 1000).toFixed(1) + ' mg' : a.mass.toFixed(2) + ' g'}</dd></div>
      ${originFacts}
      <div class="breeding-fact"><dt>繁殖状态</dt><dd data-field="breeding">${breedingSummary(a)}</dd></div>
      <div><dt>入缸时长</dt><dd>${durationLabel(a.ageHours)}</dd></div>
      <div><dt>上次进食</dt><dd data-field="last-meal">${lastMeal}</dd></div>
      <div><dt>累计摄食</dt><dd data-field="eaten">${((a.totalEatenGrams||0)*1000).toFixed(1)} mg · ${a.bites||0} 口</dd></div>
      <div><dt>代谢系数</dt><dd>${(a.metabolism||1).toFixed(2)}×</dd></div>
      <div><dt>当前食欲</dt><dd>${hunger>75?'十分饥饿':hunger>40?'想吃东西':hunger>12?'略有食欲':'已经吃饱'}</dd></div>
    </dl>
    <p class="individual-note">${a.behavior==='gasping'?'氧气不足，优先改善供氧。':state.paused?'生态已暂停，继续模拟后才会进食。':'饥饿度越高，越积极觅食；吃到饲料后才会下降。'}</p>`;
}
function perform(action) {
  $('#hint').classList.add('dismissed');
  if(action==='quit') {
    persist();
    desktop?.quit();
    return;
  }
  if(action==='close') closePanel();
  else if(action==='water') openPanel('water');
  else if(action==='life') openPanel('life');
  else if(action==='scenery') openPanel('scenery');
  else if(action==='settings') openPanel('settings');
  else if(action==='check-update' || action==='install-update') return void runUpdate(action==='install-update');
  else if(action==='feed') { const result=feed(state); notify(result.ok?(state.paused?'饲料已入水 · 继续模拟后鱼会进食':'饲料已入水 · 饥饿的鱼会主动靠近进食'):result.message); }
  else if(action==='care') {
    const result = careForFish(state, selectedId);
    notify(result.message);
  }
  else if(action==='change-water') { changeWater(state,.25); notify('已更换 25% 水 · 使用等温、除氯新水'); }
  else if(action==='remove-animal') {
    const result = removeAnimal(state, selectedId);
    selectAnimal(null);
    notify(result.message);
  }
  else if(action==='remove-dead') {
    const {count} = removeDead(state);
    if (count) notify(`已捞起 ${count} 只遗体`);
  }
  else if(action==='rotate') { autoRotate=!autoRotate; renderer?.setAutoRotate(autoRotate); document.querySelector('[data-action="rotate"]').classList.toggle('selected',autoRotate); }
  else if(action==='reset-view') { autoRotate=false; renderer?.setAutoRotate(false); renderer?.resetView(); document.querySelector('[data-action="rotate"]').classList.remove('selected'); }
  else if(action==='pause') state.paused=!state.paused;
  else if(action==='deselect') selectAnimal(null);
  else if(action==='pin') { if(!desktop) return notify('请在桌面应用中使用置顶功能'); pinned=!pinned; desktop.setAlwaysOnTop(pinned); }
  else if(action==='compact') { if(!desktop) return notify('请在桌面应用中调整摆件大小'); compact=!compact; desktop.setCompact(compact); }
  else if(action==='click-through') { closePanel(); desktop?.setClickThrough(true); notify(`鼠标穿透已开启 · 点${trayLocation}鱼图标恢复`); }
  updatePanel(); persist();
}
app.addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.action) perform(b.dataset.action);
  else if(b.dataset.tab) openPanel(b.dataset.tab);
  else if(b.dataset.equipment) { const key=b.dataset.equipment; state.equipment[key]=!state.equipment[key]; updatePanel(); persist(); }
  else if(b.dataset.stockSex) { stockingSex=b.dataset.stockSex; updatePanel(); }
  else if(b.dataset.addAnimal) {
    const result = addAnimal(state, b.dataset.addAnimal, stockingSex === 'random' ? undefined : stockingSex);
    notify(result.message); updatePanel(); persist();
  }
  else if(b.dataset.showKind) { expandedKind = expandedKind === b.dataset.showKind ? null : b.dataset.showKind; updatePanel(); }
  else if(b.dataset.addPlant || b.dataset.removePlant || b.dataset.addHardscape || b.dataset.removeHardscape) {
    const {addPlant: plant, removePlant: plantId, addHardscape: kind, removeHardscape: itemId} = b.dataset;
    const result = plant ? addPlant(state, plant) : plantId ? removePlant(state, plantId)
      : kind ? addHardscape(state, kind) : removeHardscape(state, itemId);
    notify(result.message);
    if(result.ok) persist();
    updatePanel();
  }
  else if(b.dataset.speed) { state.speed=Number(b.dataset.speed); updatePanel(); persist(); }
  else if(b.dataset.select) selectAnimal(b.dataset.select);
});
app.addEventListener('input',e=>{if(e.target.id==='temperature'){state.equipment.targetTemperature=Number(e.target.value); e.target.previousElementSibling.querySelector('b').textContent=`${e.target.value} °C`; persist();}});
window.addEventListener('keydown',e=>{
  if(e.code==='Escape') {closePanel();selectAnimal(null);}
  if(e.code==='Space'&&!['INPUT','BUTTON','SUMMARY'].includes(e.target.tagName)){e.preventDefault();perform('pause');notify(state.paused?'生态演化已暂停':'生态演化已继续');}
});
$('#aquarium').addEventListener('dblclick',()=>perform('reset-view'));
window.addEventListener('contextmenu',e=>{e.preventDefault();openPanel('settings');});
function updatePointerPosition({x,y}, sync=false) {
  if(!Number.isFinite(x)||!Number.isFinite(y)) return;
  lastPointer={x,y};
  const inWindow=x>=0&&y>=0&&x<innerWidth&&y<innerHeight;
  const chromeVisible=document.body.classList.contains('hovering')||panelOpen;
  const overUI=inWindow && !!document.elementFromPoint(x,y)?.closest('.interactive');
  const overTank=inWindow && !!renderer?.hitTest(x,y);
  const active=pointerDown || overUI || overTank;
  if(desktop && (sync || sentPointerInside!==active)) {
    sentPointerInside=active;
    desktop.setPointerInside(active);
  }
  if(active) {
    clearTimeout(hoverTimeout); hoverTimeout=null;
    document.body.classList.add('hovering');
  } else if(chromeVisible&&!panelOpen&&!hoverTimeout) {
    // Leave a short bridge between the tank and its toolbar. Never hide merely
    // because the pointer stopped moving, especially on the move handle.
    hoverTimeout=setTimeout(()=>{
      hoverTimeout=null;
      if(!pointerDown&&!panelOpen) document.body.classList.remove('hovering');
    },700);
  }
}
window.addEventListener('pointerdown',()=>{pointerDown=true;updatePointerPosition(lastPointer);});
window.addEventListener('pointerup',()=>{pointerDown=false;updatePointerPosition(lastPointer);});
window.addEventListener('pointercancel',()=>{pointerDown=false;updatePointerPosition(lastPointer);});
const moveHandle=$('.drag-handle');
let movingPointer=null;
function endWindowMove() {
  if(movingPointer===null) return;
  const id=movingPointer;
  movingPointer=null;
  desktop?.endMove?.();
  if(moveHandle.hasPointerCapture(id)) moveHandle.releasePointerCapture(id);
  moveHandle.classList.remove('moving');
  pointerDown=false;
  updatePointerPosition(lastPointer);
}
moveHandle.addEventListener('pointerdown',e=>{
  if(e.button!==0) return;
  if(!desktop?.beginMove) {notify('请在桌面应用中移动鱼缸');return;}
  e.preventDefault();
  e.stopPropagation();
  pointerDown=true;
  movingPointer=e.pointerId;
  moveHandle.setPointerCapture(e.pointerId);
  moveHandle.classList.add('moving');
  desktop.beginMove(e.screenX,e.screenY);
  updatePointerPosition({x:e.clientX,y:e.clientY});
});
moveHandle.addEventListener('pointermove',e=>{
  if(e.pointerId===movingPointer) desktop?.moveWindow?.(e.screenX,e.screenY);
});
moveHandle.addEventListener('pointerup',endWindowMove);
moveHandle.addEventListener('pointercancel',endWindowMove);
moveHandle.addEventListener('lostpointercapture',endWindowMove);
window.addEventListener('blur',()=>{endWindowMove();pointerDown=false;updatePointerPosition(lastPointer);});
window.addEventListener('mousemove',e=>updatePointerPosition({x:e.clientX,y:e.clientY}));
window.addEventListener('mouseout',e=>{
  if(!e.relatedTarget&&!pointerDown) updatePointerPosition({x:-1,y:-1});
});
window.addEventListener('beforeunload',persist);
// Persist on hide without treating time spent closed as unobserved simulation.
document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
desktop?.onSettings?.(()=>openPanel('settings'));
function placeDesktopAquarium() {
  if(!desktopLayout) return;
  renderer?.setDesktopLayout(desktopLayout);
  // Keep the controls reachable when the aquarium itself is dragged partly offscreen.
  const width=Math.min(innerWidth,desktopLayout.width), height=Math.min(innerHeight,desktopLayout.height);
  const left=Math.max(0,Math.min(desktopLayout.x,innerWidth-width));
  const top=Math.max(0,Math.min(desktopLayout.y,innerHeight-height));
  Object.assign(app.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px',right:'auto',bottom:'auto'});
}

function applyShellState(info) {
  const changedOptions=pinned!==info.alwaysOnTop || compact!==info.isCompact;
  pinned=info.alwaysOnTop;
  compact=info.isCompact;
  const frame=info.layout;
  if(frame && (!desktopLayout || ['x','y','width','height'].some(key=>frame[key]!==desktopLayout[key]))) {
    desktopLayout=frame;
    placeDesktopAquarium();
  }
  if(changedOptions && panelOpen) updatePanel();
  updatePointerPosition(info.pointer ?? lastPointer,true);
}
if(desktop) {
  let receivedState=false;
  if (desktop.getUpdateState) {
    let receivedUpdate = false;
    desktop.onUpdateState(value => {receivedUpdate = true; applyUpdateState(value);});
    desktop.getUpdateState().then(value => {if (!receivedUpdate) applyUpdateState(value);}).catch(()=>{});
  }
  desktop.onState(info=>{receivedState=true;applyShellState(info);});
  desktop.getInfo().then(info=>{
    verifyUpdateFrame=Boolean(info.verifyUpdateFrame);
    if(!receivedState) applyShellState(info);
  }).catch(()=>{});
}

try {
  renderer=createAquarium($('#aquarium'),{
    onSelect:a=>selectAnimal(typeof a==='string'?a:a?.id),
    onStats:s=>{stats=s;},
  });
  const gl=renderer.renderer.getContext();
  const adapter=gl.getExtension('WEBGL_debug_renderer_info');
  $('#render-stat').title=gl.getParameter(adapter?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  placeDesktopAquarium();
  window.addEventListener('resize',()=>{renderer.resize();placeDesktopAquarium();});
  let previous=performance.now(), elapsed=0, lastHitTest=0;
  function frame(now) {
    const dt=Math.min((now-previous)/1000,1); previous=now; elapsed+=dt;
    if(!state.paused) advanceSimulation(state,dt*state.speed/3600);
    advanceBehavior(state,dt);
    renderer.update(state,dt,elapsed);
    if (verifyUpdateFrame && document.visibilityState === 'visible' &&
        renderer.renderer.domElement.style.visibility !== 'hidden' && renderer.renderer.info.render.triangles > 0 && !gl.isContextLost()) {
      verifyUpdateFrame=false;
      desktop.confirmUpdateFrame();
    }
    // Camera motion can move the glass across a stationary desktop cursor.
    if(desktop && now-lastHitTest>100) {updatePointerPosition(lastPointer);lastHitTest=now;}
    if(selectedId&&now-lastInspector>200){updateInspector();lastInspector=now;}
    if(now-lastUI>1000){updatePanel();lastUI=now;}
    if(now-lastSave>5000){persist();lastSave=now;}
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch(error) {
  console.error(error);
  $('#error').hidden=false;
  $('#error').innerHTML=`<h2>鱼缸暂时无法渲染</h2><p>需要支持 WebGL 2 的 GPU。请更新显卡驱动或重新打开桌面应用。</p><small>${escape(error.message)}</small>`;
}
setTimeout(()=>$('#hint').classList.add('dismissed'),7500);
if(saveError)notify('旧存档无法读取，已建立一只新鱼缸');
// Read-only diagnostic snapshot is useful when verifying the native GPU renderer.
Object.defineProperty(window,'aquariumDiagnostics',{get:()=>({state:JSON.parse(JSON.stringify(state)),stats:{...stats},renderer:renderer?.renderer.info.render,panelOpen,selectedId,screenAnimals:renderer?.getAnimalScreenPositions?.()||[],screenBroods:renderer?.getBroodScreenPositions?.()||[]})});
