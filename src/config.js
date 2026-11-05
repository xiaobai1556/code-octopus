// 设置：默认值、从旧版本升级上来时怎么改、设置面板发来的改动怎么校验。
// 主进程（main.js）用它读写 userData/config.json；这里只有纯逻辑，不碰文件和 Electron，方便测试。
//
// bubbles：alerts 只提醒 / brief 简洁 / full 详细；collide：窗口是不是实心的；
// contextWindow：算"饱腹度"用的上下文窗口大小，auto 或 200000 / 1000000；sound：提示音；
// lastReportDay：哪天已经提醒过看日报；outfit：穿戴的装扮；holidays：节日自动换装；
// feed：拖文件喂它；feedDir：章鱼的肚子在哪；feedHint：下载文件夹太乱时提醒；onboarded：看过新手引导；
// approveOnPet：在桌宠身上直接批准权限请求；dance：放歌时跳舞；timeOfDay：跟着时间变化；pomodoroMin：番茄钟多少分钟；
// quietHours / quietFrom / quietTo：免打扰时段（几点到几点只提醒要你做决定的事、不响提示音）；
// breakReminder / breakMin：连续在电脑前多少分钟提醒你休息；costAlert：当天花费超过多少美元提醒一次（0 是关）
const DEFAULTS = {
  scale: 5, bubbles: 'full', collide: true, color: 0, lang: 'auto', contextWindow: 'auto', sound: true, lastReportDay: '',
  outfit: { head: '', face: '', neck: '' }, holidays: true, feed: true, feedDir: '', feedHint: true, lastHungryDay: '', onboarded: false, autoUpdate: true,
  approveOnPet: false, dance: true, timeOfDay: true, pomodoroMin: 25, notifyFullscreen: true, hotkeys: false,
  quietHours: false, quietFrom: 22, quietTo: 8, breakReminder: true, breakMin: 60, costAlert: 0,
};

const SCALES = [4, 5, 6, 8];
const POMODORO_MINUTES = [15, 25, 45];
const BUBBLE_MODES = ['alerts', 'brief', 'full'];
const CONTEXT_WINDOWS = ['auto', 200000, 1000000];
const BREAK_REMIND_MINUTES = [45, 60, 90];
const COST_ALERTS = [0, 5, 10, 20, 50];
const COLORS = 6;
const SWITCHES = ['sound', 'holidays', 'feed', 'feedHint', 'autoUpdate', 'approveOnPet', 'dance', 'timeOfDay', 'notifyFullscreen', 'hotkeys', 'quietHours', 'breakReminder'];

const defaults = () => ({ ...DEFAULTS, outfit: { ...DEFAULTS.outfit } });

// 存着的设置合进默认值；顺便处理老版本留下来的写法
function fromSaved(saved) {
  const base = defaults();
  if (!saved || typeof saved !== 'object') return base;
  const s = { ...saved };
  // 旧版的"安静模式"开关换成了气泡三档
  if (s.bubbles == null && typeof s.quiet === 'boolean') s.bubbles = s.quiet ? 'alerts' : 'full';
  delete s.quiet;
  // 从老版本升级上来的不再弹新手引导
  if (s.onboarded == null) s.onboarded = true;
  return { ...base, ...s, outfit: { ...base.outfit, ...(s.outfit || {}) } };
}

// 设置面板发来的改动：只留认识的项、合法的值（装扮另外校验，要看解锁了没有）。languages：支持的语言 { code: 名字 }
function cleanPatch(patch, languages = {}) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;
  if (SCALES.includes(patch.scale)) clean.scale = patch.scale;
  if (BUBBLE_MODES.includes(patch.bubbles)) clean.bubbles = patch.bubbles;
  if (typeof patch.collide === 'boolean') clean.collide = patch.collide;
  if (Number.isInteger(patch.color) && patch.color >= 0 && patch.color < COLORS) clean.color = patch.color;
  if (patch.lang === 'auto' || (typeof patch.lang === 'string' && Object.prototype.hasOwnProperty.call(languages, patch.lang))) clean.lang = patch.lang;
  if (CONTEXT_WINDOWS.includes(patch.contextWindow)) clean.contextWindow = patch.contextWindow;
  for (const key of SWITCHES) if (typeof patch[key] === 'boolean') clean[key] = patch[key];
  for (const key of ['quietFrom', 'quietTo']) if (Number.isInteger(patch[key]) && patch[key] >= 0 && patch[key] < 24) clean[key] = patch[key];
  if (BREAK_REMIND_MINUTES.includes(patch.breakMin)) clean.breakMin = patch.breakMin;
  if (COST_ALERTS.includes(patch.costAlert)) clean.costAlert = patch.costAlert;
  if (POMODORO_MINUTES.includes(patch.pomodoroMin)) clean.pomodoroMin = patch.pomodoroMin;
  return clean;
}

module.exports = { DEFAULTS, defaults, fromSaved, cleanPatch, POMODORO_MINUTES, BUBBLE_MODES, CONTEXT_WINDOWS, BREAK_REMIND_MINUTES, COST_ALERTS };
