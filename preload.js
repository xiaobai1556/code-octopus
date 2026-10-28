const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = [
  'platforms', 'cursor', 'press', 'press-move', 'press-end', 'menu-at', 'claude-event', 'config', 'pet-command', 'summon', 'demo',
  'user-away', 'user-back', 'report-ready', 'layout', 'import-pet', 'evacuate', 'drag-transfer', 'spawn', 'achievement', 'hungry', 'tour', 'update-ready',
  'permission-ask', 'permission-done', 'notes', 'pomodoro', 'pomodoro-ring', 'note-ring', 'music', 'beat',
];

contextBridge.exposeInMainWorld('petHost', {
  setHitboxes: (boxes) => ipcRenderer.send('hitboxes', boxes),
  focusSession: (sessionId) => ipcRenderer.send('focus-session', sessionId),
  openReport: () => ipcRenderer.send('open-report'),
  openSettings: (section) => ipcRenderer.send('open-settings', section),
  openDownloads: () => ipcRenderer.send('open-downloads'),
  openMenu: (pet) => ipcRenderer.send('pet-menu', pet),
  transfer: (msg) => ipcRenderer.send('transfer', msg),
  tourDone: () => ipcRenderer.send('tour-done'),
  permissionDecision: (msg) => ipcRenderer.send('permission-decision', msg),
  noteDone: (id) => ipcRenderer.send('note-done', id),
  // 拖到桌宠身上的文件：拿到真实路径交给主进程去"吃"
  feed: (files) => ipcRenderer.invoke('feed', Array.from(files || [], (f) => webUtils.getPathForFile(f)).filter(Boolean)),
  ready: () => ipcRenderer.send('renderer-ready'),
  on: (channel, fn) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
