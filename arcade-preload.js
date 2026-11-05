const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petArcade', {
  info: () => ipcRenderer.invoke('arcade:info'),
  saveScore: (game, score, metrics) => ipcRenderer.invoke('arcade:score', game, score, metrics),
});
