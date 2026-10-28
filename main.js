const { app, BrowserWindow, screen, ipcMain, Tray, Menu, dialog, nativeTheme, powerMonitor, clipboard, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { listWindows, isFullscreenForeground, onMoveSize, setHighResTimer, mouseButtons, overlayBuried, raiseTopmost } = require('./src/win32');
const { computePlatforms } = require('./src/terrain');
const { summarize, salvage, askDetail } = require('./src/events');
const audio = require('./src/audio');
const hooks = require('./src/hooks');
const plugin = require('./src/plugin');
const { tcpOwnerPid, findWindowForPid, windowRect, isWindow, foregroundWindow, focusWindow } = require('./src/procs');
const { readSessionUsage } = require('./src/context');
const { Stats, dayKey } = require('./src/stats');
const achievements = require('./src/achievements');
const OUTFITS = require('./src/outfits');
const { Feeder, looseFiles } = require('./src/feed');
const updater = require('./src/updater');
const I18N = require('./src/i18n');
const { trayIcon } = require('./src/icon');

const tr = I18N.t;
const PORT = Number(process.env.CLAUDE_PET_PORT) || 23333;
// 数据目录固定叫 claude-pet：打包后的产品名是 "Code Octopus"（改名前叫 Claude Pet），不固定的话会换一个目录，设置和统计就"丢"了；
// 单实例锁也跟着它走，开发版和安装版不会同时开两个
app.setPath('userData', path.join(app.getPath('appData'), 'claude-pet'));
// 提示音是事件触发的（不是你点了什么才响），要关掉"有用户操作才能出声"的限制
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const DEMO = process.argv.includes('--demo');
// 平时 50ms 扫一次窗口位置；用户正在拖窗口、或刚发现窗口在动时改成 4ms（同时打开 1ms 系统定时器），
// 站在被拖动窗口上的桌宠才能跟得紧、不一顿一顿的（扫一次只要零点几毫秒）
const SCAN_IDLE_MS = 50;
const SCAN_HOT_MS = 4;
const HOT_FOR_MS = 800;
let hotUntil = 0;
let userDragging = false;
let scanTimer = null;

let settingsWin = null;
let tray = null;
// bubbles：alerts 只提醒 / brief 简洁 / full 详细；collide：窗口是不是实心的；
// contextWindow：算"饱腹度"用的上下文窗口大小，auto 或 200000 / 1000000；sound：提示音；
// lastReportDay：哪天已经提醒过看日报；outfit：穿戴的装扮；holidays：节日自动换装；
// feed：拖文件喂它；feedDir：章鱼的肚子在哪；feedHint：下载文件夹太乱时提醒；onboarded：看过新手引导；
// approveOnPet：在桌宠身上直接批准权限请求；dance：放歌时跳舞；timeOfDay：跟着时间变化；pomodoroMin：番茄钟多少分钟
let config = {
  scale: 5, bubbles: 'full', collide: true, color: 0, lang: 'auto', contextWindow: 'auto', sound: true, lastReportDay: '',
  outfit: { head: '', face: '', neck: '' }, holidays: true, feed: true, feedDir: '', feedHint: true, lastHungryDay: '', onboarded: false, autoUpdate: true,
  approveOnPet: false, dance: true, timeOfDay: true, pomodoroMin: 25,
};
const POMODORO_MINUTES = [15, 25, 45];
const BUBBLE_MODES = ['alerts', 'brief', 'full'];
const CONTEXT_WINDOWS = ['auto', 200000, 1000000];
let reportWin = null;
let stats = null;
let feeder = null;
const recentEvents = []; // 最近收到的事件，/state 和设置面板里能看到，方便排查 hooks 有没有接上

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {}
  if (!saved) return;
  // 旧版的"安静模式"开关换成了气泡三档
  if (saved.bubbles == null && typeof saved.quiet === 'boolean') saved.bubbles = saved.quiet ? 'alerts' : 'full';
  delete saved.quiet;
  // 从老版本升级上来的不再弹新手引导
  if (saved.onboarded == null) saved.onboarded = true;
  config = { ...config, ...saved, outfit: { ...config.outfit, ...(saved.outfit || {}) } };
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch {}
}

// ---------- 语言 ----------

const systemLocale = () => I18N.detect(app.getPreferredSystemLanguages());
const locale = () => (config.lang !== 'auto' && I18N.NAMES[config.lang] ? config.lang : systemLocale());

function applyConfig() {
  I18N.setLang(locale());
  if (tray) tray.setToolTip(tr('app.name'));
  broadcast('config', { ...config, locale: locale() });
}

function setConfig(patch) {
  Object.assign(config, patch);
  saveConfig();
  applyConfig();
}

// ---------- 显示器：每块屏一个覆盖层（透明、置顶、默认鼠标穿透），铺满它的工作区 ----------
// 不同显示器的缩放可能不一样，所以每块屏单独一个窗口。桌宠走到屏幕边上、被扔过去或者被拖过去时，
// 从一个覆盖层"转移"到隔壁的覆盖层，坐标按物理像素换算。
// 调试：CLAUDE_PET_SPLIT=1 把主屏假装成左右两块屏幕，没有第二块显示器也能试转移
const FAKE_SPLIT = process.env.CLAUDE_PET_SPLIT === '1';
const overlays = new Map(); // 显示器 id → 覆盖层
const retired = []; // 显示器拔掉以后、正在把桌宠送走的覆盖层
let overlaySeq = 0;
let displayTimer = null;

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  const list = screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    bounds: d.bounds,
    workArea: d.workArea,
    scale: d.scaleFactor,
    phys: screen.dipToScreenRect(null, d.bounds),
    primary: d.id === primaryId,
  }));
  if (!FAKE_SPLIT) return list;
  return list.flatMap((d) => {
    if (!d.primary) return [d];
    const half = Math.floor(d.bounds.width / 2);
    return [0, 1].map((k) => {
      const bounds = { x: d.bounds.x + k * half, y: d.bounds.y, width: k ? d.bounds.width - half : half, height: d.bounds.height };
      const phys = { x: d.phys.x + Math.round((bounds.x - d.bounds.x) * d.scale), y: d.phys.y, width: Math.round(bounds.width * d.scale), height: d.phys.height };
      return { ...d, id: `${d.id}-${k}`, bounds, workArea: intersect(d.workArea, bounds), phys, primary: k === 0 };
    });
  });
}

// 覆盖层内的 DIP 坐标 ↔ 物理像素
function toPhys(o, p) {
  const d = o.display;
  return { x: (p.x + d.workArea.x - d.bounds.x) * d.scale + d.phys.x, y: (p.y + d.workArea.y - d.bounds.y) * d.scale + d.phys.y };
}

function fromPhys(o, p) {
  const d = o.display;
  return { x: (p.x - d.phys.x) / d.scale + d.bounds.x - d.workArea.x, y: (p.y - d.phys.y) / d.scale + d.bounds.y - d.workArea.y };
}

const convertPoint = (from, to, p) => fromPhys(to, toPhys(from, p));

function createOverlay(d) {
  const o = { id: d.id, display: d, area: d.workArea, seq: ++overlaySeq, hwnd: 0, ready: false, hidden: false, captured: false, captureToggles: 0, hitboxes: [], cursor: null, cursorKey: '', platforms: '', exits: { left: [], right: [] } };
  const win = new BrowserWindow({
    ...d.workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  o.win = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  // 不用 { forward: true }：它在本进程装一个全局底层鼠标钩子，高回报率鼠标每秒上千个事件都要先经过这里，
  // 会把主进程的定时器饿死（拖窗口时扫描停顿几百毫秒），还可能拖慢系统鼠标。改为 pollMouse 主动读光标位置。
  win.setIgnoreMouseEvents(true);
  // 每个覆盖层里的桌宠编号从不同的数开始，转移到别的屏幕以后编号也不会撞
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { base: String(o.seq * 100000) } });
  win.once('ready-to-show', () => {
    win.showInactive();
    win.setBounds(o.area); // 缩放不一样的副屏上，创建时给的尺寸可能被按主屏缩放算错，显示后再设一次
  });
  // 拖到别的地方去的文件不能让覆盖层"打开"它
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  o.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  return o;
}

function updateOverlay(o, d) {
  const moved = JSON.stringify([o.display.workArea, o.display.phys, o.display.scale]) !== JSON.stringify([d.workArea, d.phys, d.scale]);
  o.display = d;
  o.area = d.workArea;
  if (moved && !o.win.isDestroyed()) {
    o.win.setBounds(o.area);
    o.platforms = '';
  }
}

// 显示器拔掉了：先把上面的桌宠都送到主屏，再关掉这个覆盖层
function retireOverlay(o, toId) {
  overlays.delete(o.id);
  retired.push(o);
  sendTo(o, 'evacuate', { to: toId });
  setTimeout(() => {
    if (!o.win.isDestroyed()) o.win.destroy();
    retired.splice(retired.indexOf(o), 1);
  }, 1500);
}

// 左右相邻的两块屏之间留一个"口子"：在它们竖直方向重叠的范围内，桌宠可以走过去
function computeExits() {
  const list = [...overlays.values()];
  for (const o of list) o.exits = { left: [], right: [] };
  for (const a of list) {
    for (const b of list) {
      if (a === b) continue;
      const ab = a.display.bounds;
      if (Math.abs(b.display.bounds.x - (ab.x + ab.width)) > 2) continue; // b 紧挨在 a 右边
      const y1 = Math.max(a.area.y, b.area.y);
      const y2 = Math.min(a.area.y + a.area.height, b.area.y + b.area.height);
      if (y2 - y1 < 40) continue;
      a.exits.right.push({ to: b.id, y1: y1 - a.area.y, y2: y2 - a.area.y });
      b.exits.left.push({ to: a.id, y1: y1 - b.area.y, y2: y2 - b.area.y });
    }
  }
}

function sendLayout(o) {
  sendTo(o, 'layout', { id: o.id, home: o.display.primary, exits: o.exits });
}

function syncOverlays() {
  const list = displayList();
  const primary = list.find((d) => d.primary) || list[0];
  for (const o of [...overlays.values()]) if (!list.some((d) => d.id === o.id)) retireOverlay(o, primary.id);
  for (const d of list) {
    const o = overlays.get(d.id);
    if (o) updateOverlay(o, d);
    else overlays.set(d.id, createOverlay(d));
  }
  computeExits();
  for (const o of overlays.values()) if (o.ready) sendLayout(o);
}

function onDisplaysChanged() {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(syncOverlays, 300);
}

const allOverlays = () => [...overlays.values(), ...retired];
const ownHwnds = () => allOverlays().map((o) => o.hwnd);
const primaryOverlay = () => [...overlays.values()].find((o) => o.display.primary) || overlays.values().next().value;
const overlayBySender = (sender) => allOverlays().find((o) => !o.win.isDestroyed() && o.win.webContents === sender) || null;

function sendTo(o, channel, data) {
  if (o && o.win && !o.win.isDestroyed()) o.win.webContents.send(channel, data);
}

function broadcast(channel, data) {
  for (const o of overlays.values()) sendTo(o, channel, data);
}

function overlayAtPoint(p) {
  for (const o of overlays.values()) {
    const a = o.area;
    if (p.x >= a.x && p.y >= a.y && p.x < a.x + a.width && p.y < a.y + a.height) return o;
  }
  return null;
}

// 你现在看着的那块屏（光标在哪块屏上），给日报、成就这类"来找你"的提醒用
const cursorOverlay = () => overlayAtPoint(screen.getCursorScreenPoint()) || primaryOverlay();

function overlayForPhysRect(r) {
  const cx = (r.l + r.r) / 2;
  const cy = (r.t + r.b) / 2;
  for (const o of overlays.values()) {
    const p = o.display.phys;
    if (cx >= p.x && cy >= p.y && cx < p.x + p.width && cy < p.y + p.height) return o;
  }
  return null;
}

// ---------- 鼠标 ----------
// 主进程每 16ms（拖动时 8ms）读一次光标位置和鼠标按键状态，鼠标交互全由这里驱动：
// - 穿透：渲染进程把每只桌宠的点击范围发过来，光标一进范围就关掉穿透，下面的窗口就收不到这次点击；
// - 按下 / 拖动 / 松开：直接看系统里按键是不是按着，再告诉渲染进程。不依赖页面收到鼠标事件——
//   以前松开鼠标那一下如果恰好落在穿透状态，页面收不到，浏览器内核会一直以为左键还按着，
//   之后再按都不触发"按下"，表现就是"刚开始能拖，后来拖不动"。
// - 拖着桌宠跨过屏幕边：让原来的覆盖层把它交给光标所在的覆盖层，接着拖。
const CURSOR_POLL_MS = 16;
const DRAG_POLL_MS = 3; // 拖桌宠时一秒读 300 多次光标，240Hz 的屏每帧都有新位置
// 从别处按下鼠标拖着东西（比如文件）经过桌宠时，点击范围放大一点，方便"喂"它
const FEED_MARGIN = 16;
let buttons = { primary: false, secondary: false };
let petDragging = false; // 从桌宠身上按下去、还没松开
let dragOverlay = null; // 正在被拖的桌宠在哪个覆盖层
let dragTransfer = null; // { to, at }：正在把被拖的桌宠交给另一块屏
let externalDrag = false; // 鼠标在别处按下、拖着东西过来
let lastPressAt = '';
const captureLog = []; // 最近的穿透切换和按键记录，/state 里能看到

function logMouse(what, o, extra) {
  captureLog.push({ at: new Date().toISOString().slice(11, 23), what, screen: o ? o.id : null, cursor: o ? o.cursor : null, ...extra });
  if (captureLog.length > 40) captureLog.shift();
}

function overPet(o, c, margin = 0) {
  return !!c && o.hitboxes.some((b) => c.x >= b.l - margin && c.x <= b.r + margin && c.y >= b.t - margin && c.y <= b.b + margin);
}

function updateMouseCapture(o) {
  if (!o.win || o.win.isDestroyed() || o.hidden) return;
  const want = (petDragging && dragOverlay === o) || overPet(o, o.cursor, externalDrag ? FEED_MARGIN : 0);
  if (want === o.captured) return;
  o.captured = want;
  o.captureToggles++;
  logMouse(want ? 'capture' : 'release', o);
  o.win.setIgnoreMouseEvents(!want);
}

function pollMouse() {
  const p = screen.getCursorScreenPoint();
  const t = performance.now();
  const cur = overlayAtPoint(p);
  const local = (o) => ({ x: p.x - o.area.x, y: p.y - o.area.y, t });
  for (const o of overlays.values()) o.cursor = o === cur && !o.hidden ? { x: p.x - o.area.x, y: p.y - o.area.y } : null;

  const now = mouseButtons() || buttons;
  if (dragTransfer && Date.now() - dragTransfer.at > 600) dragTransfer = null; // 对面没回应就算了
  // 主键按下：只有当时已经接管了鼠标（点击没有穿透到下面的窗口）才算按在桌宠身上
  if (now.primary && !buttons.primary && cur && cur.captured && overPet(cur, cur.cursor)) {
    petDragging = true;
    setHighResTimer(true); // 不等下一次扫描，按下就切到 1ms 定时器
    dragOverlay = cur;
    lastPressAt = new Date().toISOString().slice(11, 23);
    logMouse('press', cur);
    sendTo(cur, 'press', local(cur));
  } else if (now.primary && petDragging) {
    if (cur && dragOverlay && cur !== dragOverlay && !dragTransfer) {
      dragTransfer = { to: cur.id, at: Date.now() };
      logMouse('drag-transfer', dragOverlay, { to: cur.id });
      sendTo(dragOverlay, 'drag-transfer', { to: cur.id });
    } else if (!dragTransfer && dragOverlay) sendTo(dragOverlay, 'press-move', local(dragOverlay));
  } else if (!now.primary && petDragging) {
    petDragging = false;
    logMouse('press-end', dragOverlay);
    if (dragOverlay) sendTo(dragOverlay, 'press-end', local(dragOverlay));
  }
  externalDrag = now.primary && !petDragging && (externalDrag || !buttons.primary);
  // 副键在桌宠身上松开：弹出菜单
  if (!now.secondary && buttons.secondary && cur && cur.captured && overPet(cur, cur.cursor)) sendTo(cur, 'menu-at', local(cur));
  buttons = now;

  for (const o of overlays.values()) {
    updateMouseCapture(o);
    const key = JSON.stringify(o.cursor);
    if (key !== o.cursorKey) {
      o.cursorKey = key;
      sendTo(o, 'cursor', o.cursor);
    }
  }
}

function mouseLoop() {
  pollMouse();
  setTimeout(mouseLoop, petDragging ? DRAG_POLL_MS : CURSOR_POLL_MS);
}

// 桌宠走到 / 飞到 / 被拖到另一块屏：坐标换算后交给那边的覆盖层
function onTransfer(from, msg) {
  const to = overlays.get(msg.to) || primaryOverlay();
  if (!from || !to || !msg.pet) return;
  const pet = msg.pet;
  if (to !== from) {
    Object.assign(pet, convertPoint(from, to, { x: pet.x, y: pet.y }));
    if (pet.ground && pet.ground.id !== 'floor') {
      const g = convertPoint(from, to, { x: pet.ground.wx, y: pet.ground.y });
      pet.ground = { ...pet.ground, wx: g.x, y: g.y };
    }
    if (pet.climb) {
      const c = convertPoint(from, to, { x: pet.climb.x, y: pet.climb.ty });
      pet.climb = { x: c.x, ty: c.y };
    }
  }
  if (pet.sessionId) sessionOverlay.set(pet.sessionId, to.id);
  if (msg.drag) {
    dragOverlay = to;
    dragTransfer = null;
  }
  sendTo(to, 'import-pet', { pet, drag: msg.drag || null, summon: !!msg.summon });
  // 交接的时候你已经松手了
  if (msg.drag && !petDragging) {
    const p = screen.getCursorScreenPoint();
    sendTo(to, 'press-end', { x: p.x - to.area.x, y: p.y - to.area.y, t: performance.now() });
  }
}

// 所有屏上一只桌宠都没有了（最后一只在副屏上下班走了）：在主屏再生一只
let emptySince = 0;
function ensurePet() {
  const ready = [...overlays.values()].filter((o) => o.ready);
  if (!ready.length || retired.length || dragTransfer) return;
  if (ready.some((o) => o.hitboxes.length)) {
    emptySince = 0;
    return;
  }
  if (!emptySince) emptySince = Date.now();
  else if (Date.now() - emptySince > 1500) {
    emptySince = 0;
    sendTo(primaryOverlay(), 'spawn');
  }
}

// 覆盖层被别的窗口压到下面去了：重新提上来（每秒查一次，查一次不到 1 毫秒）
function keepOnTop() {
  for (const o of overlays.values()) {
    if (!o.ready || o.hidden || o.win.isDestroyed() || !overlayBuried(o.hwnd)) continue;
    raiseTopmost(o.hwnd);
    o.raises = (o.raises || 0) + 1;
  }
}

// 你离开电脑超过 5 分钟（没动过键盘鼠标）：桌宠们去睡觉；回来时叫醒它们
const AWAY_AFTER_S = 300;
let userAway = false;

function checkUserIdle() {
  const idle = powerMonitor.getSystemIdleTime();
  if (!userAway && idle >= AWAY_AFTER_S) {
    userAway = true;
    broadcast('user-away');
  } else if (userAway && idle < 5) {
    userAway = false;
    broadcast('user-back');
  }
}

// ---------- 地形：窗口顶边当平台、窗口本身当实心墙 ----------

function scanPlatforms() {
  if (!overlays.size) return;
  const own = ownHwnds();
  const all = listWindows(own); // 物理像素，Z 序从上到下
  for (const o of overlays.values()) scanOverlay(o, all, own);
}

function scanOverlay(o, all, own) {
  if (!o.ready || o.win.isDestroyed()) return;
  // 前台是全屏应用（视频、游戏）时，这块屏上的先躲起来
  const full = isFullscreenForeground(o.display.phys, own);
  if (full !== o.hidden) {
    o.hidden = full;
    if (full) o.win.hide();
    else o.win.showInactive();
  }
  if (full) return;
  const { width, height } = o.area;
  const wins = all.map((w) => {
    const a = fromPhys(o, { x: w.l, y: w.t });
    const b = fromPhys(o, { x: w.r, y: w.b });
    return { id: w.id, l: a.x, t: a.y, r: b.x, b: b.y };
  });
  const plats = computePlatforms(wins, width, height);
  // 实心窗口（开了碰撞时用）：在这块屏上的、看得见的（没被上层某个窗口整个盖住）、
  // 不是几乎铺满整个屏幕的（最大化的窗口当成背景，但它仍然会挡住后面的窗口）
  const onScreen = (w) => ({ l: Math.max(w.l, 0), t: Math.max(w.t, 0), r: Math.min(w.r, width), b: Math.min(w.b, height) });
  const covers = (a, b) => a.l <= b.l && a.t <= b.t && a.r >= b.r && a.b >= b.b;
  const solids = wins
    .filter((w) => w.r > 0 && w.l < width && w.b > 0 && w.t < height)
    .filter((w) => !wins.slice(0, wins.indexOf(w)).some((above) => covers(onScreen(above), onScreen(w))))
    .filter((w) => !(w.r - w.l >= width * 0.85 && w.b - w.t >= height * 0.85))
    .map((w) => ({ id: w.id, l: Math.round(w.l), t: Math.round(w.t), r: Math.round(w.r), b: Math.round(w.b), z: wins.indexOf(w) }));
  const json = JSON.stringify({ platforms: plats, windows: solids });
  if (json === o.platforms) return;
  o.platforms = json;
  hotUntil = Date.now() + HOT_FOR_MS;
  if (userDragging && lastDrag) {
    const now = performance.now();
    if (lastDrag.lastChange) lastDrag.maxChangeGapMs = Math.max(lastDrag.maxChangeGapMs, Math.round(now - lastDrag.lastChange));
    lastDrag.lastChange = now;
    lastDrag.changes++;
  }
  sendTo(o, 'platforms', { platforms: plats, windows: solids });
}

// 最近几次用户拖窗口的统计，/state 里能看到，用来确认拖动时扫描跟不跟得上
const drags = [];
let lastDrag = null;

function scanLoop() {
  clearTimeout(scanTimer);
  if (userDragging && lastDrag) {
    const now = performance.now();
    if (lastDrag.lastScan) lastDrag.maxScanGapMs = Math.max(lastDrag.maxScanGapMs, Math.round(now - lastDrag.lastScan));
    lastDrag.lastScan = now;
    lastDrag.scans++;
  }
  scanPlatforms();
  // 拖桌宠时也保持 1ms 系统定时器，几毫秒一次的鼠标轮询才做得到
  const hot = userDragging || petDragging || Date.now() < hotUntil;
  setHighResTimer(hot);
  scanTimer = setTimeout(scanLoop, hot ? SCAN_HOT_MS : SCAN_IDLE_MS);
}

function onUserMoveStart() {
  userDragging = true;
  lastDrag = { startedAt: new Date().toISOString(), t0: performance.now(), ms: 0, scans: 0, changes: 0, maxScanGapMs: 0, maxChangeGapMs: 0 };
  drags.push(lastDrag);
  if (drags.length > 8) drags.shift();
  scanLoop();
}

function onUserMoveEnd() {
  userDragging = false;
  hotUntil = Date.now() + HOT_FOR_MS;
  if (lastDrag) {
    lastDrag.ms = Math.round(performance.now() - lastDrag.t0);
    lastDrag.scansPerSec = Math.round((lastDrag.scans * 1000) / Math.max(1, lastDrag.ms));
    lastDrag.changesPerSec = Math.round((lastDrag.changes * 1000) / Math.max(1, lastDrag.ms));
    delete lastDrag.t0;
    delete lastDrag.lastScan;
    delete lastDrag.lastChange;
  }
}

// ---------- 接收 Claude Code hooks 的本地 HTTP 服务 ----------

// 插件和 settings.json 两种接入方式同时开着时，同一个事件会收到两份（内容一模一样），只留第一份
const DEDUP_MS = 5000;
const seenEvents = new Map();
let duplicatesDropped = 0;

function isDuplicate(text) {
  const now = Date.now();
  for (const [hash, at] of seenEvents) if (now - at > DEDUP_MS) seenEvents.delete(hash);
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  if (seenEvents.has(hash)) return true;
  seenEvents.set(hash, now);
  return false;
}

// 每个会话的附加信息：所在窗口、上下文占用、这一轮从什么时候开始
const sessions = new Map(); // sessionId → { hwnd, exe, resolveAt, used, maxUsed, modelHint, costUSD, usageAt, promptAt }
const sessionOverlay = new Map(); // sessionId → 它的桌宠在哪块屏
const LONG_TASK_MS = 2 * 60 * 1000; // 一轮超过 2 分钟，做完时如果你不在那个窗口，就隆重提醒
const USAGE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'PostCompact']);

function sessionInfo(id) {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { hwnd: 0, used: null, maxUsed: 0, costUSD: null, promptAt: 0 }));
  return s;
}

// 会话在哪个窗口里：这个 hook 请求是 curl 发的，按它的端口查出 curl 的 PID，再往上找有窗口的祖先进程。
// 必须在回复 curl 之前做（回复完 curl 就退出了）
function resolveSessionWindow(info, remotePort) {
  if ((info.hwnd && isWindow(info.hwnd)) || Date.now() - (info.resolveAt || 0) < 5000) return;
  info.resolveAt = Date.now();
  const curlPid = tcpOwnerPid(remotePort, PORT);
  const found = curlPid && findWindowForPid(curlPid);
  if (found) Object.assign(info, { hwnd: found.hwnd, exe: found.exe });
}

// 新会话的桌宠出现在会话窗口所在的那块屏上；之后它走到哪块屏，事件就送到哪块屏
function overlayForSession(id, info) {
  const known = overlays.get(sessionOverlay.get(id));
  if (known) return known;
  const rect = info.hwnd ? windowRect(info.hwnd) : null;
  const o = (rect && overlayForPhysRect(rect)) || primaryOverlay();
  sessionOverlay.set(id, o.id);
  return o;
}

function contextLimit(info) {
  if (config.contextWindow === 200000 || config.contextWindow === 1000000) return config.contextWindow;
  // 自动：模型名带 [1m]，或者用量已经超过 20 万，那一定是 100 万的窗口
  return /\[1m\]/i.test(info.modelHint || '') || info.maxUsed > 200000 ? 1000000 : 200000;
}

function readUsage(info, raw, ev) {
  if (!raw || !raw.transcript_path || !USAGE_EVENTS.has(ev.event)) return;
  if (ev.event === 'PostCompact') {
    info.used = null; // 刚压缩完，等下一条回复再读
    return;
  }
  if (Date.now() - (info.usageAt || 0) < 1500 && ev.event !== 'Stop') return;
  info.usageAt = Date.now();
  const u = readSessionUsage(raw.transcript_path);
  if (u.used != null) {
    info.used = u.used;
    info.maxUsed = Math.max(info.maxUsed, u.used);
  }
  if (u.costUSD != null) info.costUSD = u.costUSD;
}

function onHookRequest(url, text, remotePort) {
  if (isDuplicate(text)) {
    duplicatesDropped++;
    return;
  }
  let raw = null;
  let ev = null;
  try {
    raw = JSON.parse(text);
    ev = summarize(raw);
  } catch {
    ev = salvage(text);
  }
  if (!ev) return;
  const now = Date.now();
  const info = sessionInfo(ev.sessionId);
  if (ev.event === 'SessionStart' && ev.model) info.modelHint = ev.model;

  resolveSessionWindow(info, remotePort);
  readUsage(info, raw, ev);
  ev.context = info.used != null ? { used: info.used, limit: contextLimit(info) } : null;
  ev.canJump = !!info.hwnd;

  if (ev.event === 'UserPromptSubmit') info.promptAt = now;
  trackProgress(info, ev);
  if (info.turn || (info.todos && info.todos.length)) ev.progress = progressOf(info);
  // 在桌宠上等你批准时，这一轮已经结束或者你又发了消息：说明已经在终端里处理掉了。
  // （其他工具事件不算：子代理可能在同一个会话里并行干活）
  if (['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'].includes(ev.event)) {
    for (const a of asks.values()) if (a.sessionId === ev.sessionId) settleAsk(a.id, null, 'elsewhere');
  }
  if (ev.event === 'Stop' || ev.event === 'StopFailure') {
    ev.turnMs = info.promptAt ? now - info.promptAt : 0;
    info.promptAt = 0;
    // 跑了很久才做完，而你正看着别的窗口：隆重提醒
    ev.longTask = ev.event === 'Stop' && ev.turnMs >= LONG_TASK_MS && !(info.hwnd && foregroundWindow() === info.hwnd);
  }
  const target = overlayForSession(ev.sessionId, info);
  if (ev.event === 'SessionEnd') {
    sessions.delete(ev.sessionId);
    sessionOverlay.delete(ev.sessionId);
  }
  if (stats) stats.record(ev, info.costUSD);

  const src = new URL(url, 'http://localhost').searchParams.get('src') || '';
  recentEvents.push({ at: new Date().toISOString(), via: src.endsWith('-plugin') ? 'plugin' : src ? 'settings' : 'other', ...ev });
  if (recentEvents.length > 30) recentEvents.shift();
  sendTo(target, 'claude-event', ev);
  if (stats) unlock(achievements.evaluate(stats), target, ev.sessionId);
}

function focusSession(sessionId) {
  const info = sessions.get(sessionId);
  return !!(info && info.hwnd && focusWindow(info.hwnd));
}

// ---------- 进度卡片：这一轮的待办、工具调用、改过的文件 ----------

function trackProgress(info, ev) {
  if (ev.event === 'UserPromptSubmit') info.turn = { tools: 0, files: [], errors: 0, lastCmd: '' };
  const turn = info.turn;
  if (ev.todos) info.todos = ev.todos;
  if (ev.task) {
    const list = (info.todos = info.todos || []);
    const t = list.find((x) => x.id === ev.task.id);
    if (ev.task.status === 'deleted') info.todos = list.filter((x) => x !== t);
    else if (t) {
      if (ev.task.status) t.status = ev.task.status;
      if (ev.task.text) t.text = ev.task.text;
    } else if (ev.task.text || ev.task.op === 'create') list.push({ id: ev.task.id, text: ev.task.text || '#' + ev.task.id, status: ev.task.status || 'pending' });
  }
  if (!turn) return;
  if (ev.event === 'PreToolUse' && !ev.decision) {
    turn.tools++;
    if (ev.toolKind === 'edit' && ev.detail) turn.files = [...turn.files.filter((x) => x !== ev.detail), ev.detail].slice(-8);
    if (ev.toolKind === 'shell' && ev.detail) turn.lastCmd = ev.detail;
  }
  if ((ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure') && ev.error) turn.errors++;
}

function progressOf(info) {
  const t = info.turn || { tools: 0, files: [], errors: 0, lastCmd: '' };
  return { todos: (info.todos || []).slice(0, 12).map(({ text, status }) => ({ text, status })), todoCount: (info.todos || []).length, tools: t.tools, files: t.files.slice(-4), fileCount: t.files.length, errors: t.errors, lastCmd: t.lastCmd };
}

// ---------- 在桌宠身上直接批准 ----------
// 权限请求用同步的 http hook 打到 /permission（见 src/hooks.js）。开着"在桌宠上批准"、而且你没在看那个会话的窗口时，
// 先不回复：桌宠举着牌子，气泡里出现「允许 / 拒绝 / 去终端」，你点了哪个就把决定回给 Claude Code。
// 你切回那个会话的窗口、Claude Code 取消了请求、或者等太久，都交还给终端照常问你（回一个空响应 = 不替你做决定）。
const ASK_TIMEOUT_MS = 180 * 1000;
const asks = new Map(); // id → { id, hash, sessionId, hwnd, responders, timer, target }
let askSeq = 0;
let askWatch = null;

function permissionReply(behavior) {
  if (behavior === 'allow') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
  if (behavior === 'deny') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'The user denied this request from the Code Octopus desktop pet.' } } };
  return null;
}

function reply(res, body) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(200, body ? { 'content-type': 'application/json' } : {});
  res.end(body ? JSON.stringify(body) : '');
}

function onPermissionRequest(req, res, text) {
  onHookRequest(req.url, text, req.socket.remotePort); // 照常举牌子（插件和 settings.json 各来一份时只举一次）
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {}
  const ev = raw && summarize(raw);
  const info = ev && sessions.get(ev.sessionId);
  // 你正看着那个会话的窗口：交给终端
  if (!ev || !info || !config.approveOnPet || (info.hwnd && foregroundWindow() === info.hwnd)) return reply(res, null);
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  let ask = [...asks.values()].find((a) => a.hash === hash);
  if (!ask) {
    ask = { id: ++askSeq, hash, sessionId: ev.sessionId, hwnd: info.hwnd, responders: [], target: overlayForSession(ev.sessionId, info) };
    asks.set(ask.id, ask);
    ask.timer = setTimeout(() => settleAsk(ask.id, null, 'timeout'), ASK_TIMEOUT_MS);
    sendTo(ask.target, 'permission-ask', { id: ask.id, sessionId: ev.sessionId, tool: ev.tool, detail: askDetail(raw.tool_name, raw.tool_input || {}) });
    watchAsks();
  }
  ask.responders.push(res);
  // Claude Code 不等了（比如你已经在终端里选了）
  res.on('close', () => {
    if (res.writableEnded) return;
    ask.responders = ask.responders.filter((r) => r !== res);
    if (!ask.responders.length) settleAsk(ask.id, null, 'cancelled');
  });
}

function settleAsk(id, behavior, by) {
  const ask = asks.get(id);
  if (!ask) return false;
  asks.delete(id);
  clearTimeout(ask.timer);
  const body = permissionReply(behavior);
  for (const r of ask.responders) reply(r, body);
  broadcast('permission-done', { id, by, behavior: behavior || '' }); // 桌宠可能已经走到别的屏上了
  return true;
}

// 等你批准的时候，你切回了那个会话的窗口：交给终端
function watchAsks() {
  if (askWatch) return;
  askWatch = setInterval(() => {
    if (!asks.size) {
      clearInterval(askWatch);
      askWatch = null;
      return;
    }
    const fg = foregroundWindow();
    for (const a of asks.values()) if (a.hwnd && fg === a.hwnd) settleAsk(a.id, null, 'focus');
  }, 300);
}

// ---------- 番茄钟和便签 ----------
// 番茄钟：专注 N 分钟（设置里选），到点让一只小章鱼举着牌子来叫你休息 5 分钟。便签：右键"记一下"写一句话，
// 可以定个时间提醒；它举着便签，到点跑到屏幕中间提醒你。便签存在 userData/notes.json
const BREAK_MINUTES = 5;
let pomodoro = null; // { phase: 'focus' | 'break', endsAt, petId, overlayId, timer }
let notes = [];
let noteWin = null;
const notesPath = () => path.join(app.getPath('userData'), 'notes.json');

function pomodoroState() {
  return pomodoro ? { phase: pomodoro.phase, endsAt: pomodoro.endsAt, petId: pomodoro.petId, overlayId: pomodoro.overlayId, minutes: config.pomodoroMin } : null;
}

function startPomodoro(o, petId, phase = 'focus') {
  stopPomodoro(true);
  const minutes = phase === 'focus' ? config.pomodoroMin : BREAK_MINUTES;
  const endsAt = Date.now() + minutes * 60 * 1000;
  pomodoro = { phase, endsAt, petId, overlayId: o ? o.id : primaryOverlay().id };
  pomodoro.timer = setTimeout(() => {
    const done = pomodoro;
    const target = overlays.get(done.overlayId) || cursorOverlay();
    if (done.phase === 'focus') {
      sendTo(target, 'pomodoro-ring', { phase: 'focus', petId: done.petId, minutes });
      startPomodoro(target, done.petId, 'break');
    } else {
      pomodoro = null;
      broadcast('pomodoro', null);
      sendTo(target, 'pomodoro-ring', { phase: 'break', petId: done.petId, minutes });
    }
  }, minutes * 60 * 1000);
  broadcast('pomodoro', pomodoroState());
}

function stopPomodoro(silent) {
  if (!pomodoro) return;
  clearTimeout(pomodoro.timer);
  pomodoro = null;
  if (!silent) broadcast('pomodoro', null);
}

function loadNotes() {
  try {
    notes = JSON.parse(fs.readFileSync(notesPath(), 'utf8')).filter((n) => n && n.text);
  } catch {
    notes = [];
  }
}

function saveNotes() {
  try {
    fs.writeFileSync(notesPath(), JSON.stringify(notes, null, 2));
  } catch {}
  broadcast('notes', notes);
}

function addNote(text, remindInMin, overlayId) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) return;
  const mins = Number(remindInMin) || 0;
  notes.push({ id: Date.now(), text, createdAt: Date.now(), remindAt: mins > 0 ? Date.now() + mins * 60 * 1000 : 0, overlayId: overlayId || '' });
  saveNotes();
}

function doneNote(id) {
  notes = notes.filter((n) => n.id !== id);
  saveNotes();
}

function checkNotes() {
  let changed = false;
  for (const n of notes) {
    if (!n.remindAt || n.remindAt > Date.now()) continue;
    n.remindAt = 0;
    n.rang = true;
    changed = true;
    sendTo(overlays.get(n.overlayId) || cursorOverlay(), 'note-ring', { id: n.id, text: n.text });
  }
  if (changed) saveNotes();
}

// 写便签的小窗口，开在光标旁边
function openNoteWindow(o) {
  if (noteWin && !noteWin.isDestroyed()) {
    noteWin.show();
    noteWin.focus();
    return;
  }
  const p = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(p).workArea;
  const w = 380;
  const h = 236;
  noteWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(Math.min(Math.max(p.x - w / 2, area.x + 8), area.x + area.width - w - 8)),
    y: Math.round(Math.min(Math.max(p.y - h - 30, area.y + 8), area.y + area.height - h - 8)),
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    show: false,
    icon: trayIcon(),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1c' : '#faf9f5',
    webPreferences: { preload: path.join(__dirname, 'note-preload.js') },
  });
  noteWin.removeMenu();
  noteWin.overlayId = o ? o.id : '';
  noteWin.loadFile(path.join(__dirname, 'renderer', 'note.html'));
  noteWin.once('ready-to-show', () => noteWin.show());
  noteWin.on('closed', () => (noteWin = null));
}

// ---------- 放歌它就跳舞 ----------
// 每 50ms 读一次系统播放音量的峰值：持续有声音就算"在放歌"，音量突然冲高就是一个节拍。只读音量，不录音
const MUSIC_POLL_MS = 50;
const music = { playing: false, loud: 0, fast: 0, slow: 0, lastBeat: 0, quietSince: 0 };

function pollMusic() {
  if (!config.dance) {
    if (music.playing) {
      music.playing = false;
      broadcast('music', { playing: false });
    }
    return;
  }
  const v = audio.peak();
  if (v == null) return;
  const now = Date.now();
  music.fast = music.fast * 0.5 + v * 0.5;
  music.slow = music.slow * 0.97 + v * 0.03;
  // 连续 3 秒以上有声音才算在放歌；安静 3 秒算停了
  if (v > 0.02) {
    music.loud = Math.min(music.loud + MUSIC_POLL_MS, 10000);
    music.quietSince = 0;
  } else if (!music.quietSince) music.quietSince = now;
  if (music.quietSince && now - music.quietSince > 3000) music.loud = 0;
  const playing = music.loud >= 3000;
  if (playing !== music.playing) {
    music.playing = playing;
    broadcast('music', { playing });
  }
  if (playing && music.fast > music.slow * 1.3 && music.fast > 0.06 && now - music.lastBeat > 280) {
    music.lastBeat = now;
    broadcast('beat', { strength: Math.min(1, music.fast) });
  }
}

// 每块屏上桌宠的状态（调试接口和设置面板都要用），合在一起
function petStates(expr) {
  const ready = [...overlays.values()].filter((o) => o.ready && !o.win.isDestroyed());
  return Promise.all(
    ready.map((o) =>
      o.win.webContents
        .executeJavaScript(`JSON.stringify(${expr})`)
        .then((json) => ({ o, value: JSON.parse(json) }))
        .catch(() => ({ o, value: null }))
    )
  );
}

function startServer() {
  const server = http.createServer((req, res) => {
    // 浏览器里的网页会带 Origin，直接拒绝，只接受本机命令行（curl）发来的事件
    if (req.headers.origin) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/permission')) {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= 4 * 1024 * 1024) chunks.push(c);
      });
      req.on('end', () => {
        try {
          onPermissionRequest(req, res, Buffer.concat(chunks).toString('utf8'));
        } catch {
          reply(res, null);
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/event')) {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= 4 * 1024 * 1024) chunks.push(c);
      });
      req.on('end', () => {
        // 先处理再回复：找会话窗口要用到 curl 的连接，回复完 curl 就退出了
        try {
          onHookRequest(req.url, Buffer.concat(chunks).toString('utf8'), req.socket.remotePort);
        } finally {
          res.writeHead(204);
          res.end();
        }
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('claude-pet');
      return;
    }
    // 调试用：鼠标穿透状态、每块屏、每只桌宠的位置、拖窗口跟随统计、最近事件
    if (req.method === 'GET' && req.url === '/state') {
      petStates(
        '{ mouse: world.mouse, stats, game: world.game && world.game.kind, tour: !!world.tour, pets: world.pets.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), mode: p.mode, activity: p.activity && p.activity.kind, session: p.sessionId, project: p.project, layer: p.layerId, minis: p.minis.length, bubble: p.bubble && p.bubble.text, outfit: p.outfit, mount: p.mount ? p.mount.id : null, visitor: !!p.visitor })) }'
      )
        .then((results) => {
          const screens = results.map(({ o, value }) => ({
            id: o.id, primary: o.display.primary, area: o.area, scale: o.display.scale, phys: o.display.phys, hwnd: o.hwnd, hidden: o.hidden,
            captured: o.captured, captureToggles: o.captureToggles, raises: o.raises || 0, hitboxes: o.hitboxes, exits: o.exits,
            terrain: o.platforms ? JSON.parse(o.platforms) : null, renderer: value && { mouse: value.mouse, stats: value.stats, game: value.game, tour: value.tour },
          }));
          const pets = results.flatMap(({ o, value }) => ((value && value.pets) || []).map((p) => ({ ...p, screen: o.id })));
          const state = {
            screens, pets, petDragging, dragOverlay: dragOverlay && dragOverlay.id, externalDrag, lastPressAt, buttons, captureLog, userDragging, drags, duplicatesDropped, userAway, locale: locale(),
            sessions: [...sessions].map(([id, s]) => ({ id, hwnd: s.hwnd, exe: s.exe, used: s.used, limit: contextLimit(s), costUSD: s.costUSD, screen: sessionOverlay.get(id) })),
            outfit: config.outfit, unlocked: stats && stats.data.unlocked, update: updater.status(), recentEvents,
          };
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(state));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', (err) => {
    dialog.showErrorBox(tr('app.name'), err.code === 'EADDRINUSE' ? tr('err.port', { port: PORT }) : err.message);
  });
  server.listen(PORT, '127.0.0.1');
}

// ---------- 两种接入方式：写 settings.json / Claude Code 插件 ----------

function errorText(err) {
  if (err.code === 'SETTINGS_INVALID_JSON') return tr('err.settingsJson', { file: hooks.SETTINGS });
  return err.message;
}

// 插件市场（.claude-plugin/ 和 plugin/）的位置：打包以后在 asar 外面单独放了一份，claude 命令才读得到
const marketplaceDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'marketplace') : app.getAppPath());

async function isConnected() {
  if (hooks.isInstalled()) return true;
  try {
    const s = await plugin.status(marketplaceDir());
    return !!(s.installed && s.enabled);
  } catch {
    return false;
  }
}

// ---------- 成就和装扮 ----------

// 新解锁的成就：那个部位还空着就直接穿上，再让桌宠庆祝一下
function unlock(fresh, target, sessionId) {
  if (!fresh.length) return;
  const outfit = { ...config.outfit };
  let changed = false;
  for (const id of fresh) {
    const item = achievements.byId[id].item;
    const slot = OUTFITS.ITEMS[item].slot;
    if (!outfit[slot]) {
      outfit[slot] = item;
      changed = true;
    }
  }
  if (changed) setConfig({ outfit });
  sendTo(target || cursorOverlay(), 'achievement', { ids: fresh, items: fresh.map((id) => achievements.byId[id].item), sessionId: sessionId || null });
}

function cleanOutfit(o) {
  if (!o || typeof o !== 'object') return null;
  const owned = achievements.unlockedItems(stats);
  const out = { ...config.outfit };
  for (const slot of OUTFITS.SLOTS) {
    if (!(slot in o)) continue;
    const item = o[slot];
    if (item === '') out[slot] = '';
    else if (OUTFITS.ITEMS[item] && OUTFITS.ITEMS[item].slot === slot && !OUTFITS.ITEMS[item].holiday && owned.has(item)) out[slot] = item;
  }
  return out;
}

// ---------- 喂文件 ----------

const HUNGRY_AT = 25; // 下载文件夹最上层堆了这么多文件就"饿了"

function eatFiles(sender, paths) {
  if (!config.feed) return { off: true };
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && path.isAbsolute(p));
  // 拖进来的不是磁盘上的文件（比如网页里的图片）：拿不到路径
  if (!list.length) return { eaten: 0, names: [], skipped: [{ name: '', reason: 'noPath' }] };
  const r = feeder.eat(list, config.feedDir);
  if (r.eaten.length) {
    stats.recordEaten(r.eaten.length);
    unlock(achievements.evaluate(stats), overlayBySender(sender));
  }
  return { eaten: r.eaten.length, names: r.eaten.map((f) => path.basename(f.to)), skipped: r.skipped, dir: r.dir };
}

function spitFiles(o, petId) {
  const r = feeder.spit();
  if (o) sendTo(o, 'pet-command', { id: petId, cmd: 'spit', restored: r.restored, kept: r.kept });
  return r;
}

function checkHunger() {
  if (!config.feed || !config.feedHint) return;
  const today = dayKey();
  if (config.lastHungryDay === today) return;
  const n = looseFiles(app.getPath('downloads'));
  if (n < HUNGRY_AT) return;
  setConfig({ lastHungryDay: today });
  sendTo(cursorOverlay(), 'hungry', { count: n });
}

function openFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

// ---------- 新手引导 ----------

let tourStarted = false;
async function startTour(force) {
  if (tourStarted && !force) return;
  tourStarted = true;
  sendTo(primaryOverlay(), 'tour', { connected: await isConnected() });
}

// ---------- 菜单（托盘右键和右键桌宠共用） ----------

const loginOpts = app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };

function buildMenu(pet, o) {
  const items = [];
  if (pet) {
    items.push({ label: pet.title, enabled: false });
    if (pet.session && sessions.get(pet.session) && sessions.get(pet.session).hwnd) {
      items.push({ label: tr('menu.jump'), click: () => focusSession(pet.session) });
    }
    items.push({ label: tr(pet.asleep ? 'menu.wake' : 'menu.sleep'), click: () => broadcast('pet-command', { id: pet.id, cmd: pet.asleep ? 'wake' : 'sleep' }) });
    items.push({ label: pet.visitors ? tr('menu.friendMore', { n: pet.visitors }) : tr('menu.friend'), enabled: !!pet.canInvite, click: () => sendTo(o, 'pet-command', { id: pet.id, cmd: 'friend' }) });
    if (pet.visitors) items.push({ label: tr('menu.friendsHome'), click: () => sendTo(o, 'pet-command', { id: pet.id, cmd: 'friends-home' }) });
    items.push({ label: tr(pet.teaser ? 'menu.teaserOff' : 'menu.teaser'), click: () => sendTo(o, 'pet-command', { id: pet.id, cmd: pet.teaser ? 'teaser-off' : 'teaser' }) });
    if (pet.inTour) items.push({ label: tr('menu.skipTour'), click: () => sendTo(o, 'pet-command', { id: pet.id, cmd: 'skip-tour' }) });
    items.push({ type: 'separator' });
    if (pomodoro) {
      const left = Math.max(0, Math.ceil((pomodoro.endsAt - Date.now()) / 60000));
      items.push({ label: tr(pomodoro.phase === 'focus' ? 'menu.pomodoroLeft' : 'menu.breakLeft', { m: left }), enabled: false });
      items.push({ label: tr('menu.pomodoroStop'), click: () => stopPomodoro() });
    } else items.push({ label: tr('menu.pomodoro', { m: config.pomodoroMin }), click: () => startPomodoro(o, pet.id) });
    items.push({ label: tr('menu.note'), click: () => openNoteWindow(o) });
    if (notes.length) {
      items.push({
        label: tr('menu.notes', { n: notes.length }),
        submenu: [...notes.map((n) => ({ label: tr('menu.noteDone', { text: n.text.length > 24 ? n.text.slice(0, 23) + '…' : n.text }), click: () => doneNote(n.id) })), { type: 'separator' }, { label: tr('menu.notesClear'), click: () => ((notes = []), saveNotes()) }],
      });
    }
    if (config.feed && feeder.lastBite()) items.push({ label: tr('menu.spit'), click: () => spitFiles(o, pet.id) });
    items.push({ type: 'separator' });
  }
  items.push({ label: tr('menu.settings'), click: () => openSettings() });
  items.push({ label: tr('menu.report'), click: () => openReport() });
  items.push({
    label: tr('menu.size'),
    submenu: [4, 5, 6, 8].map((scale) => ({
      label: tr(`size.${scale}`),
      type: 'radio',
      checked: config.scale === scale,
      click: () => setConfig({ scale }),
    })),
  });
  items.push({ label: tr('menu.quiet'), type: 'checkbox', checked: config.bubbles === 'alerts', click: (mi) => setConfig({ bubbles: mi.checked ? 'alerts' : 'full' }) });
  items.push({ label: tr('menu.summon'), click: summon });
  items.push({ label: tr('menu.demo'), click: () => sendTo(cursorOverlay(), 'demo') });
  if (config.feed) items.push({ label: tr('menu.belly'), click: () => openFolder(config.feedDir) });
  items.push({ type: 'separator' });
  if (updater.status().state === 'ready') items.push({ label: tr('menu.update', { version: updater.status().version }), click: () => updater.install() });
  items.push({
    label: tr('menu.autostart'),
    type: 'checkbox',
    checked: app.getLoginItemSettings(loginOpts).openAtLogin,
    click: (mi) => app.setLoginItemSettings({ ...loginOpts, openAtLogin: mi.checked }),
  });
  items.push({ type: 'separator' });
  items.push({ label: tr('menu.quit'), click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}

// 把所有桌宠叫到你正看着的那块屏中间
function summon() {
  const to = cursorOverlay();
  for (const o of overlays.values()) sendTo(o, 'summon', { to: to.id, here: o === to });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip(tr('app.name'));
  tray.on('click', () => openSettings());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu(null, null)));
}

// ---------- 设置面板 ----------

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('focus-section', section);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 800,
    minWidth: 440,
    minHeight: 560,
    show: false,
    icon: trayIcon(),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1c' : '#faf9f5',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { hash: section || '' });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
}

function registerSettingsIpc() {
  ipcMain.handle('settings:state', async () => {
    const results = await petStates('world.pets.filter((p) => !p.leaving && !p.visitor).map((p) => p.info())');
    const bite = feeder.lastBite();
    return {
      config,
      locale: locale(),
      systemLocale: systemLocale(),
      languages: I18N.NAMES,
      pets: results.flatMap(({ value }) => value || []),
      screens: overlays.size,
      events: recentEvents.slice(-12).reverse(),
      settingsHooks: hooks.isInstalled(),
      hooksNeedUpdate: hooks.needsUpdate(),
      autostart: app.getLoginItemSettings(loginOpts).openAtLogin,
      version: app.getVersion(),
      achievements: achievements.progress(stats),
      holiday: OUTFITS.holiday(),
      lastBite: bite ? bite.files.length : 0,
      update: updater.status(),
    };
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = {};
    if ([4, 5, 6, 8].includes(patch.scale)) clean.scale = patch.scale;
    if (BUBBLE_MODES.includes(patch.bubbles)) clean.bubbles = patch.bubbles;
    if (typeof patch.collide === 'boolean') clean.collide = patch.collide;
    if (Number.isInteger(patch.color) && patch.color >= 0 && patch.color < 6) clean.color = patch.color;
    if (patch.lang === 'auto' || I18N.NAMES[patch.lang]) clean.lang = patch.lang;
    if (CONTEXT_WINDOWS.includes(patch.contextWindow)) clean.contextWindow = patch.contextWindow;
    for (const key of ['sound', 'holidays', 'feed', 'feedHint', 'autoUpdate', 'approveOnPet', 'dance', 'timeOfDay']) if (typeof patch[key] === 'boolean') clean[key] = patch[key];
    if (POMODORO_MINUTES.includes(patch.pomodoroMin)) clean.pomodoroMin = patch.pomodoroMin;
    const outfit = cleanOutfit(patch.outfit);
    if (outfit) clean.outfit = outfit;
    setConfig(clean);
    if ('autoUpdate' in clean) updater.setEnabled(clean.autoUpdate);
    return true;
  });

  ipcMain.handle('settings:pet', (_e, { id, cmd, session }) => {
    if (cmd === 'jump') return focusSession(session);
    broadcast('pet-command', { id, cmd });
  });

  ipcMain.handle('settings:action', async (_e, name) => {
    if (name === 'demo') sendTo(cursorOverlay(), 'demo');
    else if (name === 'summon') summon();
    else if (name === 'report') openReport();
    else if (name === 'tour') startTour(true);
    else if (name === 'quit') app.quit();
    else if (name === 'open-belly') openFolder(config.feedDir);
    else if (name === 'spit') return spitFiles(null);
    else if (name === 'update-check') updater.check();
    else if (name === 'update-install') updater.install();
    else if (name === 'belly-dir') {
      const r = await dialog.showOpenDialog(settingsWin, { defaultPath: config.feedDir, properties: ['openDirectory', 'createDirectory'] });
      if (!r.canceled && r.filePaths[0]) setConfig({ feedDir: r.filePaths[0] });
    }
  });

  ipcMain.handle('settings:autostart', (_e, on) => {
    app.setLoginItemSettings({ ...loginOpts, openAtLogin: !!on });
    return app.getLoginItemSettings(loginOpts).openAtLogin;
  });

  ipcMain.handle('settings:hooks', (_e, on) => {
    try {
      if (on) hooks.install(PORT);
      else hooks.uninstall();
      return { ok: true, installed: hooks.isInstalled() };
    } catch (err) {
      return { ok: false, error: errorText(err), installed: hooks.isInstalled() };
    }
  });

  ipcMain.handle('settings:plugin-status', () => plugin.status(marketplaceDir()));

  ipcMain.handle('settings:plugin', async (_e, action) => {
    try {
      const before = await plugin.status(marketplaceDir());
      if (!before.available) return { ok: false, error: tr('err.noCli'), status: before };
      if (action === 'install') await plugin.install(marketplaceDir());
      else if (action === 'enable') await plugin.enable();
      else if (action === 'uninstall') await plugin.uninstall();
      else if (action === 'update') await plugin.update(marketplaceDir());
      return { ok: true, status: await plugin.status(marketplaceDir()) };
    } catch (err) {
      return { ok: false, error: err.message, status: await plugin.status(marketplaceDir()) };
    }
  });
}

// ---------- 每日小结 ----------

const REPORT_AT_MINUTES = 21 * 60 + 30; // 每天 21:30 以后，今天干过活就提醒看日报（一天一次）

function openReport(date) {
  if (reportWin && !reportWin.isDestroyed()) {
    if (reportWin.isMinimized()) reportWin.restore();
    reportWin.show();
    reportWin.focus();
    return;
  }
  reportWin = new BrowserWindow({
    width: 600,
    height: 900,
    minWidth: 520,
    minHeight: 600,
    show: false,
    icon: trayIcon(),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1c' : '#faf9f5',
    webPreferences: { preload: path.join(__dirname, 'report-preload.js') },
  });
  reportWin.removeMenu();
  reportWin.loadFile(path.join(__dirname, 'renderer', 'report.html'), { search: date ? `date=${date}` : '' });
  reportWin.once('ready-to-show', () => reportWin.show());
  reportWin.on('closed', () => (reportWin = null));
}

function registerReportIpc() {
  ipcMain.handle('report:get', (_e, date) => {
    const key = date || dayKey();
    return { date: key, today: dayKey(), day: stats.get(key), dates: stats.dates(), locale: locale(), color: config.color, outfit: OUTFITS.effective(config.outfit, config.holidays) };
  });
  // 截取卡片那一块：复制到剪贴板，或者存到 图片\Code Octopus 里
  const capture = (rect) => reportWin.webContents.capturePage(rect && rect.width ? rect : undefined);
  ipcMain.handle('report:copy', async (_e, rect) => {
    clipboard.writeImage(await capture(rect));
    return true;
  });
  ipcMain.handle('report:save', async (_e, rect, date) => {
    const dir = path.join(app.getPath('pictures'), 'Code Octopus');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `claude-pet-${date || dayKey()}.png`);
    fs.writeFileSync(file, (await capture(rect)).toPNG());
    shell.showItemInFolder(file);
    return file;
  });
}

function checkReportTime() {
  const now = new Date();
  const today = dayKey(now);
  if (config.lastReportDay === today || now.getHours() * 60 + now.getMinutes() < REPORT_AT_MINUTES) return;
  const d = stats && stats.get(today);
  if (!d || (!d.prompts && !d.toolCount)) return;
  setConfig({ lastReportDay: today });
  sendTo(cursorOverlay(), 'report-ready');
}

// ---------- 覆盖层发来的消息 ----------

function registerOverlayIpc() {
  ipcMain.on('hitboxes', (e, boxes) => {
    const o = overlayBySender(e.sender);
    if (!o) return;
    o.hitboxes = Array.isArray(boxes) ? boxes : [];
    updateMouseCapture(o);
  });
  ipcMain.on('pet-menu', (e, pet) => {
    const o = overlayBySender(e.sender);
    if (o) buildMenu(pet, o).popup({ window: o.win });
  });
  ipcMain.on('focus-session', (_e, sessionId) => focusSession(sessionId));
  ipcMain.on('open-report', () => openReport());
  ipcMain.on('open-settings', (_e, section) => openSettings(typeof section === 'string' ? section : ''));
  ipcMain.on('open-downloads', () => openFolder(app.getPath('downloads')));
  ipcMain.on('transfer', (e, msg) => onTransfer(overlayBySender(e.sender), msg || {}));
  ipcMain.on('tour-done', () => setConfig({ onboarded: true }));
  ipcMain.on('permission-decision', (_e, msg) => {
    const ask = msg && asks.get(msg.id);
    if (!ask) return;
    if (msg.behavior === 'allow' || msg.behavior === 'deny') settleAsk(ask.id, msg.behavior, 'pet');
    else {
      settleAsk(ask.id, null, 'terminal');
      focusSession(ask.sessionId);
    }
  });
  ipcMain.on('note-done', (_e, id) => doneNote(id));
  ipcMain.handle('note:add', (e, { text, remind }) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    addNote(text, remind, w && w.overlayId);
    if (w) w.close();
    return true;
  });
  ipcMain.handle('note:info', () => ({ locale: locale() }));
  ipcMain.handle('feed', (e, paths) => eatFiles(e.sender, paths));
  ipcMain.on('renderer-ready', (e) => {
    const o = overlayBySender(e.sender);
    if (!o) return;
    o.ready = true;
    o.platforms = '';
    o.cursorKey = '';
    sendLayout(o);
    sendTo(o, 'config', { ...config, locale: locale() });
    sendTo(o, 'notes', notes);
    sendTo(o, 'pomodoro', pomodoroState());
    sendTo(o, 'music', { playing: music.playing });
    scanPlatforms();
    if (!o.display.primary) return;
    if (DEMO) setTimeout(() => sendTo(o, 'demo'), 1500);
    if (!config.onboarded) setTimeout(() => startTour(false), 2500);
    else if (pendingUnlocks.length) setTimeout(() => unlock(pendingUnlocks.splice(0), o), 4000);
  });
}

// ---------- 启动 ----------

let pendingUnlocks = []; // 启动时按以前的记录补解锁的成就，等主屏准备好了再庆祝

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('claude-pet');
  app.whenReady().then(() => {
    loadConfig();
    I18N.setLang(locale());
    if (!config.feedDir) {
      config.feedDir = path.join(app.getPath('documents'), 'Code Octopus', tr('feed.dirName'));
      saveConfig();
    }
    stats = new Stats(path.join(app.getPath('userData'), 'stats.json'));
    feeder = new Feeder(path.join(app.getPath('userData'), 'feed-log.json'), [app.getAppPath(), app.getPath('userData'), path.dirname(process.execPath)]);
    pendingUnlocks = achievements.evaluate(stats);
    registerOverlayIpc();
    registerSettingsIpc();
    registerReportIpc();
    syncOverlays();
    createTray();
    startServer();
    updater.init(config.autoUpdate, (st) => {
      if (st.state === 'ready') sendTo(cursorOverlay(), 'update-ready', { version: st.version });
    });

    if (process.argv.includes('--settings')) openSettings();
    scanLoop();
    mouseLoop();
    setInterval(checkUserIdle, 5000);
    setInterval(checkReportTime, 60 * 1000);
    setInterval(ensurePet, 500);
    setInterval(keepOnTop, 1000);
    setTimeout(checkHunger, 10 * 60 * 1000);
    setInterval(checkHunger, 60 * 60 * 1000);
    loadNotes();
    setInterval(checkNotes, 15 * 1000);
    setInterval(pollMusic, MUSIC_POLL_MS);
    const stopWatching = onMoveSize(onUserMoveStart, onUserMoveEnd);
    app.on('will-quit', () => {
      stopWatching();
      setHighResTimer(false);
      stats.save();
    });
    screen.on('display-metrics-changed', onDisplaysChanged);
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
  });
  // 再启动一次：带 --settings 就打开设置面板，否则把桌宠叫到屏幕中间
  app.on('second-instance', (_e, argv) => (argv.includes('--settings') ? openSettings() : summon()));
  app.on('window-all-closed', () => app.quit());
}
