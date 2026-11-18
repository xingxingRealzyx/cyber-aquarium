const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createUpdater, githubRequest } = require('./updates.cjs');
const { stageAndLaunchInstaller, acknowledgeUpdateLaunch } = require('./update-installer.cjs');

const windowsIcon = app.isPackaged
  ? path.join(process.resourcesPath, 'aquarium.ico')
  : path.join(__dirname, '..', 'assets', 'icons', 'aquarium.ico');

app.setName('Cyber Aquarium');
const userDataPath = app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), 'Cyber Aquarium');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let aquariumWindow;
let tray;
let activeDisplay;
let moveOrigin = null;
let quitting = false;
let pointerInside = false;
let preferences = { alwaysOnTop: true, isCompact: false, bounds: null, displayId: null };
// Deliberately never persist click-through: relaunching always restores interaction.
let manualClickThrough = false;
const preferencePath = path.join(app.getPath('userData'), 'desktop.json');

function readPreferences() {
  try {
    const saved = JSON.parse(fs.readFileSync(preferencePath, 'utf8'));
    preferences.alwaysOnTop = typeof saved.alwaysOnTop === 'boolean' ? saved.alwaysOnTop : true;
    preferences.isCompact = saved.isCompact === true;
    preferences.displayId = Number.isInteger(saved.displayId) ? saved.displayId : null;
    if (saved.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(saved.bounds[key])) && saved.bounds.width > 0 && saved.bounds.height > 0) {
      preferences.bounds = saved.bounds;
    }
  } catch { /* A first launch or corrupt preferences uses a safe visible default. */ }
}

function savePreferences() {
  try {
    fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
    fs.writeFileSync(`${preferencePath}.tmp`, JSON.stringify(preferences));
    fs.renameSync(`${preferencePath}.tmp`, preferencePath);
  } catch (error) { console.warn('Could not save aquarium position:', error.message); }
}

// Saved bounds describe the aquarium's logical footprint in global DIP. Older
// versions saved their native window here, which is exactly the initial footprint.
function homeDisplay() {
  return screen.getAllDisplays().find(display => display.id === preferences.displayId)
    || (preferences.bounds ? screen.getDisplayMatching(preferences.bounds) : screen.getPrimaryDisplay());
}

function placeAquarium(saved, display) {
  const oldArea = activeDisplay?.workArea;
  const area = display.workArea;
  const width = Math.min(area.width, saved?.width || (preferences.isCompact ? 720 : 1040));
  const height = Math.min(area.height, saved?.height || (preferences.isCompact ? 520 : 760));
  // The scenery can extend past the edge. Keep its rotation centre reachable.
  const cx = saved ? saved.x + saved.width / 2 : area.x + area.width / 2;
  const cy = saved ? saved.y + saved.height / 2 : area.y + area.height / 2;
  const x = Math.round(Math.max(area.x, Math.min(cx, area.x + area.width)) - width / 2);
  const y = Math.round(Math.max(area.y, Math.min(cy, area.y + area.height)) - height / 2);
  preferences.bounds = { x, y, width, height };
  preferences.displayId = display.id;
  activeDisplay = display;
  const hostChanged = !oldArea || ['x','y','width','height'].some(key => area[key] !== oldArea[key]);
  if (hostChanged && aquariumWindow && !aquariumWindow.isDestroyed()) {
    aquariumWindow.setBounds(area);
  }
}

function refreshDisplayLayout() {
  if (!activeDisplay || !preferences.bounds || !aquariumWindow || aquariumWindow.isDestroyed()) return;
  const display = homeDisplay();
  const saved = { ...preferences.bounds };
  if (display.id === activeDisplay.id) {
    // A different monitor becoming primary can change this monitor's global origin.
    saved.x += display.workArea.x - activeDisplay.workArea.x;
    saved.y += display.workArea.y - activeDisplay.workArea.y;
  }
  placeAquarium(saved, display);
  sendState(true);
  savePreferences();
}

function shellState(probePointer = false) {
  const origin = aquariumWindow?.getContentBounds() || activeDisplay.workArea;
  const {x,y,width,height} = preferences.bounds;
  const state = {
    alwaysOnTop: preferences.alwaysOnTop,
    manualClickThrough,
    clickThrough: manualClickThrough,
    isCompact: preferences.isCompact,
    layout: {x:x-origin.x,y:y-origin.y,width,height},
  };
  if (probePointer) {
    const cursor = screen.getCursorScreenPoint();
    state.pointer = {x:cursor.x-origin.x, y:cursor.y-origin.y};
  }
  return state;
}

function sendState(probePointer = false) {
  if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.webContents.send('aquarium:state', shellState(probePointer));
}

function updatePointerEvents() {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) return;
  const ignore = !moveOrigin && (manualClickThrough || !pointerInside);
  aquariumWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function finishMoving() {
  if (!moveOrigin) return;
  moveOrigin = null;
  updatePointerEvents();
  savePreferences();
}

function setManualClickThrough(value) {
  manualClickThrough = Boolean(value);
  updatePointerEvents();
  rebuildTrayMenu();
  sendState();
  return shellState();
}

function setAlwaysOnTop(value) {
  preferences.alwaysOnTop = Boolean(value);
  aquariumWindow?.setAlwaysOnTop(preferences.alwaysOnTop, 'floating');
  savePreferences();
  rebuildTrayMenu();
  sendState();
  return shellState();
}

function setCompact(value) {
  preferences.isCompact = Boolean(value);
  const previous = preferences.bounds;
  const width = preferences.isCompact ? 720 : 1040;
  const height = preferences.isCompact ? 520 : 760;
  placeAquarium({
    x: previous.x + (previous.width - width) / 2, y: previous.y + (previous.height - height) / 2,
    width, height,
  }, activeDisplay);
  savePreferences();
  rebuildTrayMenu();
  sendState(true);
  return shellState();
}

function revealAquarium(openSettings = false) {
  if (!aquariumWindow || aquariumWindow.isDestroyed()) createWindow();
  pointerInside = false;
  setManualClickThrough(false);
  if (aquariumWindow.isMinimized()) aquariumWindow.restore();
  aquariumWindow.show();
  aquariumWindow.focus();
  sendState(true);
  if (openSettings) aquariumWindow.webContents.send('aquarium:settings');
  rebuildTrayMenu();
}

function trayIcon() {
  if (process.platform === 'win32') return windowsIcon;
  // A small fish silhouette rendered into a real bitmap, usable as a macOS template.
  const size = 36;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const body = ((x - 20) / 12) ** 2 + ((y - 18) / 8) ** 2 <= 1;
      const tail = x >= 3 && x <= 12 && Math.abs(y - 18) <= (12 - x) * 0.92;
      const eye = (x - 26) ** 2 + (y - 16) ** 2 < 3;
      if ((body || tail) && !eye) {
        const offset = (y * size + x) * 4;
        pixels[offset + 3] = 255;
      }
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '澄境 · 桌面鱼缸', enabled: false },
    { type: 'separator' },
    { label: '显示鱼缸 / 恢复操作', click: () => revealAquarium() },
    { label: '隐藏鱼缸', click: () => aquariumWindow?.hide() },
    { label: '鱼缸设置…', click: () => revealAquarium(true) },
    { type: 'separator' },
    { label: '置于其他窗口之上', type: 'checkbox', checked: preferences.alwaysOnTop, click: item => setAlwaysOnTop(item.checked) },
    { label: '鼠标穿透（从此菜单恢复）', type: 'checkbox', checked: manualClickThrough, click: item => setManualClickThrough(item.checked) },
    { label: '小鱼缸', type: 'checkbox', checked: preferences.isCompact, click: item => setCompact(item.checked) },
    { label: '重置桌面位置', click: () => { placeAquarium(null, activeDisplay || homeDisplay()); revealAquarium(); savePreferences(); } },
    { type: 'separator' },
    { label: '退出澄境', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('澄境 · 桌面生态鱼缸');
  tray.on('double-click', () => revealAquarium());
  rebuildTrayMenu();
  // Keep a recovery entry in the menu bar before hiding the Dock icon.
  if (process.platform === 'darwin') app.dock?.hide();
}

function createWindow() {
  placeAquarium(preferences.bounds, homeDisplay());
  pointerInside = false;
  aquariumWindow = new BrowserWindow({
    ...activeDisplay.workArea,
    title: '澄境 · Cyber Aquarium',
    icon: process.platform === 'win32' ? windowsIcon : undefined,
    show: false,
    frame: false,
    acceptFirstMouse: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: true,
    skipTaskbar: true,
    alwaysOnTop: preferences.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  aquariumWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  aquariumWindow.setMenuBarVisibility(false);
  if (preferences.alwaysOnTop) aquariumWindow.setAlwaysOnTop(true, 'floating');
  aquariumWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  aquariumWindow.webContents.on('will-navigate', event => event.preventDefault());
  aquariumWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  aquariumWindow.webContents.session.setPermissionCheckHandler(() => false);
  updatePointerEvents();
  aquariumWindow.once('ready-to-show', () => {
    aquariumWindow.showInactive();
    sendState(true);
  });
  aquariumWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); aquariumWindow.hide(); }
  });
  aquariumWindow.on('blur', finishMoving);
  aquariumWindow.on('closed', () => { aquariumWindow = null; });
  aquariumWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Aquarium renderer stopped:', details.reason);
  });
  const developmentURL = process.env.ELECTRON_RENDERER_URL;
  if (developmentURL) {
    const url = new URL(developmentURL);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('ELECTRON_RENDERER_URL must use a loopback host.');
    }
    aquariumWindow.loadURL(url.toString());
  } else {
    aquariumWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function bindIPC() {
  const trusted = event => aquariumWindow && event.sender === aquariumWindow.webContents && event.senderFrame === aquariumWindow.webContents.mainFrame;
  const updater = createUpdater({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged && !process.env.ELECTRON_RENDERER_URL,
    request: (url, signal) => githubRequest(net, url, signal),
    stagingRoot: path.join(userDataPath, 'update-downloads'),
    executablePath: process.execPath,
    userDataPath,
    stageAndLaunchInstaller,
    onState: state => {
      if (aquariumWindow && !aquariumWindow.isDestroyed()) aquariumWindow.webContents.send('aquarium:update-state', state);
    },
    quit: () => app.quit(),
  });
  for (const [channel, action] of [
    ['aquarium:get-update-state', updater.getState],
    ['aquarium:check-update', updater.check],
    ['aquarium:install-update', updater.install],
  ]) {
    ipcMain.handle(channel, event => {
      if (!trusted(event)) throw new Error('Untrusted sender');
      return action();
    });
  }
  ipcMain.handle('aquarium:info', event => {
    if (!trusted(event)) throw new Error('Untrusted sender');
    return { ...shellState(true), platform: process.platform, version: app.getVersion(), gpuFeatures: app.getGPUFeatureStatus(),
      verifyUpdateFrame: Boolean(process.env.CYBER_AQUARIUM_UPDATE_DIR && process.env.CYBER_AQUARIUM_UPDATE_TOKEN) };
  });
  ipcMain.on('aquarium:update-frame-ready', event => {
    if (!trusted(event) || !process.env.CYBER_AQUARIUM_UPDATE_TOKEN) return;
    const rollbackReason = acknowledgeUpdateLaunch();
    if (rollbackReason) updater.reportRollback(rollbackReason);
  });
  for (const [channel, action] of [
    ['aquarium:always-on-top', setAlwaysOnTop],
    ['aquarium:click-through', setManualClickThrough],
    ['aquarium:compact', setCompact],
  ]) {
    ipcMain.handle(channel, (event, value) => {
      if (!trusted(event) || typeof value !== 'boolean') throw new Error('Invalid shell request');
      return action(value);
    });
  }
  ipcMain.on('aquarium:pointer-inside', (event, value) => {
    if (!trusted(event) || typeof value !== 'boolean' || value === pointerInside) return;
    pointerInside = value;
    updatePointerEvents();
  });
  const validPoint = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e6 && Math.abs(y) < 1e6;
  ipcMain.on('aquarium:move-start', (event, x, y) => {
    if (!trusted(event) || manualClickThrough || !validPoint(x,y)) return;
    moveOrigin = { pointer: {x,y}, bounds: { ...preferences.bounds } };
    pointerInside = true;
    updatePointerEvents();
  });
  ipcMain.on('aquarium:move', (event, x, y) => {
    if (!trusted(event) || !moveOrigin || !validPoint(x,y)) return;
    placeAquarium({
      ...moveOrigin.bounds,
      x: moveOrigin.bounds.x + x - moveOrigin.pointer.x,
      y: moveOrigin.bounds.y + y - moveOrigin.pointer.y,
    }, screen.getDisplayNearestPoint({x:Math.round(x),y:Math.round(y)}));
    sendState();
  });
  ipcMain.on('aquarium:move-end', event => { if (trusted(event)) finishMoving(); });
  ipcMain.on('aquarium:quit', event => { if (trusted(event)) app.quit(); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => revealAquarium());
  app.on('before-quit', () => { quitting = true; savePreferences(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => revealAquarium());
  app.whenReady().then(() => {
    // Resume cleanup if the last verified update was interrupted after relaunch.
    if (app.isPackaged && !process.env.CYBER_AQUARIUM_UPDATE_TOKEN) acknowledgeUpdateLaunch();
    readPreferences();
    Menu.setApplicationMenu(null);
    bindIPC();
    createWindow();
    createTray();
    screen.on('display-added', refreshDisplayLayout);
    screen.on('display-removed', refreshDisplayLayout);
    screen.on('display-metrics-changed', refreshDisplayLayout);
  }).catch(error => { console.error(error); app.quit(); });
}
