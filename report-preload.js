const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petReport', {
  get: (date) => ipcRenderer.invoke('report:get', date),
  copy: (rect) => ipcRenderer.invoke('report:copy', rect),
  save: (rect, date) => ipcRenderer.invoke('report:save', rect, date),
});
