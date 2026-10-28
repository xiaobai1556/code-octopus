const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petNote', {
  info: () => ipcRenderer.invoke('note:info'),
  add: (text, remind) => ipcRenderer.invoke('note:add', { text, remind }),
});
