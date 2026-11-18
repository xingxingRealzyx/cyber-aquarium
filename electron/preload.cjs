const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('aquariumDesktop', Object.freeze({
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('aquarium:info'),
  getUpdateState: () => ipcRenderer.invoke('aquarium:get-update-state'),
  checkForUpdate: () => ipcRenderer.invoke('aquarium:check-update'),
  installUpdate: () => ipcRenderer.invoke('aquarium:install-update'),
  onUpdateState: callback => subscribe('aquarium:update-state', callback),
  confirmUpdateFrame: () => ipcRenderer.send('aquarium:update-frame-ready'),
  setAlwaysOnTop: value => ipcRenderer.invoke('aquarium:always-on-top', Boolean(value)),
  setClickThrough: value => ipcRenderer.invoke('aquarium:click-through', Boolean(value)),
  setCompact: value => ipcRenderer.invoke('aquarium:compact', Boolean(value)),
  setPointerInside: value => ipcRenderer.send('aquarium:pointer-inside', Boolean(value)),
  beginMove: (x,y) => ipcRenderer.send('aquarium:move-start', x, y),
  moveWindow: (x,y) => ipcRenderer.send('aquarium:move', x, y),
  endMove: () => ipcRenderer.send('aquarium:move-end'),
  onSettings: callback => subscribe('aquarium:settings', callback),
  onState: callback => subscribe('aquarium:state', callback),
  quit: () => ipcRenderer.send('aquarium:quit'),
}));
