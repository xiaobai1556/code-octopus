const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petSettings', {
  state: () => ipcRenderer.invoke('settings:state'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  pet: (id, cmd, session) => ipcRenderer.invoke('settings:pet', { id, cmd, session }),
  action: (name) => ipcRenderer.invoke('settings:action', name),
  autostart: (on) => ipcRenderer.invoke('settings:autostart', on),
  hooks: (on) => ipcRenderer.invoke('settings:hooks', on),
  pluginStatus: () => ipcRenderer.invoke('settings:plugin-status'),
  plugin: (action) => ipcRenderer.invoke('settings:plugin', action),
  onFocusSection: (fn) => ipcRenderer.on('focus-section', (_e, section) => fn(section)),
});
