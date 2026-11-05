// 章鱼游戏厅：游戏窗口的外壳——画布缩放、键盘鼠标、菜单、规则、倒数、暂停、结算、最高分、音效。
// 每个游戏在自己的文件里（arcade-*.js）用 ARCADE.register() 登记，外壳按同一套流程跑它们：
//   create(env) 返回一局：update(dt, input)、draw(g, t)、hud()、summary()，结束时把 over 设成 true，score 是得分。
// 坐标都是 360×240 的逻辑单位，画的时候按窗口大小等比放大，每个点都对齐到设备像素，像素画不会糊。

const api = window.petArcade || mockApi();
const tr = (key, vars) => I18N.t(key, vars);
const W = 360;
const H = 240;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const C = {
  bg: '#1D2130',
  bg2: '#262B3D',
  edge: '#151824',
  card: '#FBF8F3',
  ink: '#2B2620',
  muted: '#857869',
  line: '#E4D9C9',
  accent: '#D97757',
  green: '#3F9A5B',
  red: '#C2452D',
  gold: '#F2B33D',
  cream: '#F4EFE6',
  dim: '#9AA0B4',
};

// 汉字按语言挑字体（同 world.js）
const CJK_FONTS = {
  'zh-CN': '"Microsoft YaHei UI","PingFang SC"',
  'zh-TW': '"Microsoft JhengHei UI","PingFang TC"',
  ja: '"Yu Gothic UI","Meiryo UI","Hiragino Sans"',
  en: '"Microsoft YaHei UI","Yu Gothic UI","PingFang SC"',
};
let UI_FONT = '';
let MONO_FONT = '';
function setLocale(lang) {
  I18N.setLang(lang);
  const cjk = CJK_FONTS[I18N.lang()] || CJK_FONTS.en;
  UI_FONT = `"Segoe UI",${cjk},sans-serif`;
  MONO_FONT = `"Cascadia Mono",Consolas,${cjk},monospace`;
  document.documentElement.lang = I18N.lang();
  document.title = tr('arc.title');
}

const ARCADE = {
  games: [],
  register(game) {
    this.games.push(game);
  },
};

// ---------- 画布和画笔 ----------
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
let s = 2; // 每个逻辑单位多少设备像素
let ox = 0; // 画面左上角（设备像素）
let oy = 0;
let shiftX = 0; // 游戏画面抖动
let shiftY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  s = Math.min(canvas.width / W, canvas.height / H);
  ox = Math.round((canvas.width - W * s) / 2);
  oy = Math.round((canvas.height - H * s) / 2);
}
window.addEventListener('resize', resize);

const px = (x) => Math.round(ox + (x + shiftX) * s);
const py = (y) => Math.round(oy + (y + shiftY) * s);
const inside = (p, r) => !!p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

let palette = PALETTES[0];
let outfit = {};
let hovering = false; // 这一帧鼠标指着按钮

const g = {
  W,
  H,
  C,
  rect(x, y, w, h, color) {
    const x0 = px(x);
    const y0 = py(y);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, px(x + w) - x0, py(y + h) - y0);
  },
  // 圆角矩形，可以只描边
  round(x, y, w, h, r, fill, stroke, lw = 1) {
    const x0 = px(x);
    const y0 = py(y);
    ctx.beginPath();
    ctx.roundRect(x0, y0, px(x + w) - x0, py(y + h) - y0, r * s);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = Math.max(1, Math.round(lw * s));
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  },
  font(o = {}) {
    return `${o.weight || 400} ${Math.max(6, Math.round((o.size || 8) * s))}px ${o.mono ? MONO_FONT : UI_FONT}`;
  },
  text(str, x, y, o = {}) {
    ctx.font = g.font(o);
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'middle';
    ctx.fillText(String(str), px(x), py(y));
  },
  measure(str, o = {}) {
    ctx.font = g.font(o);
    return ctx.measureText(String(str)).width / s;
  },
  // 按宽度折行，几行的长度尽量差不多（不会最后一行只剩一个字）
  wrapBalanced(str, maxW, o = {}, maxLines = 99) {
    const lines = g.wrap(str, maxW, o, maxLines);
    if (lines.length < 2 || lines[lines.length - 1].endsWith('…')) return lines;
    let best = lines;
    for (let w = maxW - 2; w > maxW / 2; w -= 2) {
      const next = g.wrap(str, w, o, 99);
      if (next.length !== lines.length) break;
      best = next;
    }
    return best;
  },
  // 按宽度折行：中日文按字断，英文按词断，太长的词（命令）按字符断；超出行数在末尾加省略号
  wrap(str, maxW, o = {}, maxLines = 99) {
    ctx.font = g.font(o);
    const fits = (t) => ctx.measureText(t).width / s <= maxW;
    const lines = [];
    let line = '';
    // 片假名连在一起的当成一个词（ウィンドウ 不会被拆成 ウィン / ドウ），其他中日韩文字一个字一个字地断
    for (const tok of String(str).match(/[\u30a0-\u30ff]+|[⺀-鿿가-힯豈-﫿＀-￯　-〿]|\s+|[^\s⺀-鿿가-힯豈-﫿＀-￯　-〿]+/g) || []) {
      if (/^\s+$/.test(tok)) {
        if (line) line += ' ';
        continue;
      }
      // 放得下，或者是不能放在行首的标点、长音、小写假名（挂在这一行末尾）
      if (fits(line + tok) || (line && NO_LINE_START.test(tok))) {
        line += tok;
        continue;
      }
      if (line.trim() && fits(tok)) {
        lines.push(line.trimEnd());
        line = tok;
        continue;
      }
      for (const ch of tok) {
        if (line && !fits(line + ch)) {
          lines.push(line.trimEnd());
          line = ch;
        } else line += ch;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (lines.length <= maxLines) return lines;
    const out = lines.slice(0, maxLines);
    let tail = out[maxLines - 1];
    while (tail && !fits(tail + '…')) tail = tail.slice(0, -1);
    out[maxLines - 1] = tail + '…';
    return out;
  },
  // 小章鱼：x 是脚底中心，y 是脚底；unit 是每格多少逻辑单位。默认用你设置的颜色和装扮
  pet(x, y, unit, pose = {}, flip = false, pal = palette) {
    const P = Math.max(1, Math.round(unit * s));
    drawPet(ctx, px(x), py(y), P, pal, flip, { outfit, headroom: OUTFITS.headroom(outfit), ...pose });
  },
  // 点阵小图：rows 每行一个字符串，colors 把字符映射成颜色（没有的字符是透明的）。x, y 是左上角
  sprite(rows, colors, x, y, unit, flip = false) {
    const cell = Math.max(1, Math.round(unit * s));
    const x0 = px(x);
    const y0 = py(y);
    const w = rows[0].length;
    rows.forEach((row, r) => {
      for (let c = 0; c < w; c++) {
        const col = colors[row[c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x0 + (flip ? w - 1 - c : c) * cell, y0 + r * cell, cell, cell);
      }
    });
  },
  // 以 (cx, cy) 为中心
  spriteC(rows, colors, cx, cy, unit, flip) {
    g.sprite(rows, colors, cx - (rows[0].length * unit) / 2, cy - (rows.length * unit) / 2, unit, flip);
  },
  glyph(name, cx, cy, unit, color, outline) {
    drawGlyph(ctx, name, px(cx), py(cy), Math.max(1, Math.round(unit * s)), color, outline);
  },
  alpha(a, fn) {
    ctx.save();
    ctx.globalAlpha *= clamp(a, 0, 1);
    fn();
    ctx.restore();
  },
  gradient(x, y, w, h, stops) {
    const grad = ctx.createLinearGradient(0, py(y), 0, py(y + h));
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    const x0 = px(x);
    const y0 = py(y);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, px(x + w) - x0, py(y + h) - y0);
  },
  line(x1, y1, x2, y2, color, w = 1) {
    ctx.beginPath();
    ctx.moveTo(px(x1), py(y1));
    ctx.lineTo(px(x2), py(y2));
    ctx.lineWidth = Math.max(1, w * s);
    ctx.strokeStyle = color;
    ctx.stroke();
  },
  circle(x, y, r, fill, stroke, w = 1) {
    ctx.beginPath();
    ctx.arc(px(x), py(y), r * s, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = Math.max(1, w * s);
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  },
  shake(dx, dy) {
    shiftX = dx;
    shiftY = dy;
  },
  // 鼠标指着这块（可以点的东西：光标变成手）
  hover(r) {
    const over = inside(input.pointer, r);
    if (over) hovering = true;
    return over;
  },
  // 按钮：画出来，这一帧点到了就返回 true（点击被它吃掉）
  button(r, label, o = {}) {
    const over = inside(input.pointer, r);
    if (over) hovering = true;
    const fill = o.fill || (o.primary ? C.accent : C.card);
    const ink = o.ink || (o.primary ? '#FFFFFF' : C.ink);
    g.round(r.x, r.y, r.w, r.h, r.h / 2, over ? shade(fill, o.primary || o.fill ? 1.1 : 0.94) : fill, o.stroke || (o.primary || o.fill ? null : C.line), 1);
    g.text(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, { size: o.size || 8, weight: 700, color: ink, align: 'center' });
    const hit = input.takeClick(r);
    if (hit) sound('select');
    return hit;
  },
};

// 不能放在行首的字符：句读点、右括号、长音、小写假名（日文的避头规则，中文也适用）
const NO_LINE_START = /^[、。，．,.!！?？:：;；）)」』】〕〉》ー～…・ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]$/;

// 颜色调亮 / 调暗
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => clamp(Math.round(v * k), 0, 255);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ---------- 输入 ----------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc', KeyP: 'pause', KeyQ: 'quit', KeyY: 'yes', KeyN: 'no', KeyR: 'retry',
  Digit1: 'n1', Digit2: 'n2', Digit3: 'n3', Digit4: 'n4', Numpad1: 'n1', Numpad2: 'n2', Numpad3: 'n3', Numpad4: 'n4',
  Digit5: 'n5', Digit6: 'n6', Digit7: 'n7', Digit8: 'n8', Digit9: 'n9', Numpad5: 'n5', Numpad6: 'n6', Numpad7: 'n7', Numpad8: 'n8', Numpad9: 'n9',
  KeyU: 'upgrade', KeyX: 'sell', Delete: 'sell', Backspace: 'sell', KeyF: 'fast', KeyT: 'daily',
};

const input = {
  held: new Set(), // 按着的
  hits: new Set(), // 这一帧刚按下的
  clicks: [], // 这一帧的点击（逻辑坐标）
  typed: [], // 这一帧打出来的字（打字游戏用）
  imeAt: -1e9, // 上次看到输入法在拦按键的时间
  pointer: null,
  pointerAt: 0, // 鼠标最后一次动的时间
  down(a) {
    return this.held.has(a);
  },
  // 刚按下了其中一个键（按下的那一下被吃掉，不会被别人再用一次）
  hit(...names) {
    for (const n of names) {
      if (this.hits.has(n)) {
        this.hits.delete(n);
        return true;
      }
    }
    return false;
  },
  axis() {
    return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
  },
  // 鼠标最近动过：游戏可以让小章鱼跟着鼠标走
  pointerActive() {
    return !!this.pointer && performance.now() - this.pointerAt < 1500;
  },
  // 左键点在这块里：吃掉这次点击
  takeClick(r) {
    const i = this.clicks.findIndex((p) => p.button === 0 && inside(p, r));
    if (i < 0) return false;
    this.clicks.splice(i, 1);
    return true;
  },
  // 右键点了一下（在哪儿都算）
  takeAltClick() {
    const i = this.clicks.findIndex((p) => p.button === 2);
    if (i < 0) return null;
    return this.clicks.splice(i, 1)[0];
  },
};

window.addEventListener('keydown', (e) => {
  // 打字游戏进行中：能打出字的键都当打字（字母、数字、符号、空格），P / Q 这些快捷键不管用，只有 Esc 暂停
  if (state === 'play' && run && run.textInput) {
    if (e.key === 'Process' || e.isComposing) {
      input.imeAt = performance.now(); // 中文 / 日文输入法在拦按键：游戏里提示切到英文
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      input.typed.push(e.key);
      return;
    }
  }
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  input.held.add(a);
  if (!e.repeat) input.hits.add(a);
});
window.addEventListener('keyup', (e) => {
  const a = KEYMAP[e.code];
  if (a) input.held.delete(a);
});
// 切到别的窗口：松开所有键，正在玩就暂停
window.addEventListener('blur', () => {
  input.held.clear();
  if (state === 'play') state = 'pause';
});

function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { x: ((e.clientX - r.left) * dpr - ox) / s, y: ((e.clientY - r.top) * dpr - oy) / s };
}
canvas.addEventListener('pointermove', (e) => {
  input.pointer = toLogical(e);
  input.pointerAt = performance.now();
});
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  input.pointer = toLogical(e);
  input.pointerAt = performance.now();
  input.clicks.push({ ...input.pointer, button: e.button });
});
canvas.addEventListener('pointerleave', () => (input.pointer = null));
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 音效：8-bit 方波 ----------
const SFX = {
  move: [[660, 0, 0.03]],
  select: [[880, 0, 0.04], [1175, 0.045, 0.06]],
  count: [[523, 0, 0.08]],
  go: [[784, 0, 0.08], [1047, 0.08, 0.16]],
  catch: [[988, 0, 0.035], [1319, 0.035, 0.05]],
  gold: [[1047, 0, 0.04], [1319, 0.045, 0.04], [1568, 0.09, 0.08]],
  bad: [[196, 0, 0.1], [147, 0.1, 0.18]],
  life: [[659, 0, 0.05], [880, 0.06, 0.1]],
  level: [[523, 0, 0.06], [659, 0.07, 0.06], [784, 0.14, 0.06], [1047, 0.21, 0.14]],
  jump: [[392, 0, 0.03], [587, 0.025, 0.04]],
  spring: [[523, 0, 0.035], [784, 0.035, 0.035], [1175, 0.07, 0.08]],
  star: [[1319, 0, 0.035], [1760, 0.04, 0.06]],
  pop: [[330, 0, 0.05], [220, 0.05, 0.06]],
  right: [[784, 0, 0.05], [1175, 0.055, 0.08]],
  wrong: [[262, 0, 0.09], [185, 0.1, 0.18]],
  over: [[392, 0, 0.11], [330, 0.12, 0.11], [262, 0.24, 0.26]],
  record: [[659, 0, 0.06], [784, 0.07, 0.06], [988, 0.14, 0.06], [1319, 0.21, 0.24]],
};
let soundOn = true;
let audioCtx = null;
function sound(name) {
  const notes = SFX[name];
  if (!soundOn || !notes) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + 0.01;
    for (const [freq, at, dur] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.035, t0 + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {}
}

// ---------- 流程：菜单 → 规则 → 倒数 → 玩 ⇄ 暂停 → 结算 ----------
let state = 'loading';
let sel = 0; // 菜单里选中的游戏
let def = null; // 正在玩的游戏
let run = null; // 这一局
let countT = 0;
let overT = 0;
let result = null; // { score, best, record, summary }
let scores = {};
let achievements = []; // 游戏厅的成就：{ id, game, item, goal, value, unlockedAt }
let t = 0;

try {
  sel = Number(localStorage.getItem('arcade-selected')) || 0;
} catch {}

const bestOf = (id) => (scores[id] && scores[id].best) || 0;
// 今日挑战：同一天、同一个游戏，种子一样，大家玩的是同一局。
// daily = { day, scores: { bugs: 今天最好, ... }, streak: 连续打卡 { last, n, best } }
let daily = { day: '', scores: {}, streak: {} };
let runDay = null; // 这一局是哪天的今日挑战（平常的一局是 null）
const dailyBestOf = (id) => (daily.day === ARCADE_RNG.dayKey() && daily.scores[id]) || 0;
const shortDay = (key) => key.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');

// 给一局游戏的环境：音效、最高分、随机数。有种子（今日挑战）就用按种子播种的随机数，否则就是 Math.random。
// 游戏里决定玩法的随机（掉什么、窗口怎么摆、出什么题、每波来什么）都用它，特效用 Math.random
ARCADE.env = ({ seed = '', sound: snd = () => {}, best = 0 } = {}) => {
  const rng = seed ? ARCADE_RNG.seeded(seed) : Math.random;
  return {
    sound: snd,
    best,
    rng,
    rand: (a, b) => a + rng() * (b - a),
    pick: (list) => list[Math.floor(rng() * list.length)],
    daily: !!seed,
    imeWarning: () => performance.now() - input.imeAt < 3000, // 最近 3 秒输入法拦过按键
  };
};
const achOf = (id) => achievements.find((a) => a.game === id) || null;

function openIntro(i) {
  sel = clamp(i, 0, ARCADE.games.length - 1);
  try {
    localStorage.setItem('arcade-selected', String(sel));
  } catch {}
  def = ARCADE.games[sel];
  state = 'intro';
}

function startRun(isDaily = false) {
  runDay = isDaily ? ARCADE_RNG.dayKey() : null;
  run = def.create(ARCADE.env({ seed: runDay ? `${runDay}:${def.id}` : '', sound, best: bestOf(def.id) }));
  countT = 0;
  state = 'count';
  sound('count');
}

async function finishRun() {
  state = 'over';
  overT = 0;
  const prev = bestOf(def.id);
  const dailyPrev = runDay ? dailyBestOf(def.id) : 0;
  const score = Math.max(0, Math.floor(run.score || 0));
  result = {
    score,
    best: Math.max(prev, score),
    record: score > prev && score > 0,
    day: runDay,
    dailyBest: runDay ? Math.max(dailyPrev, score) : 0,
    dailyRecord: !!runDay && score > dailyPrev && score > 0,
    summary: run.summary ? run.summary() : [],
    unlocked: [],
  };
  sound(result.record || result.dailyRecord ? 'record' : 'over');
  try {
    const r = await api.saveScore(def.id, score, run.metrics ? run.metrics() : {}, runDay);
    if (r) {
      scores[def.id] = { ...(scores[def.id] || {}), best: r.best, plays: r.plays };
      result.best = r.best;
      if (runDay && r.dailyBest != null) {
        if (daily.day !== runDay) daily = { ...daily, day: runDay, scores: {} };
        daily.scores[def.id] = r.dailyBest;
        result.dailyBest = r.dailyBest;
        daily.streak = ARCADE_RNG.bumpStreak(daily.streak, runDay);
        result.streak = r.streak || daily.streak.n;
      }
      if (r.achievements) achievements = r.achievements;
      // 刚解锁的成就：结算里亮出来
      result.unlocked = r.unlocked || [];
      if (result.unlocked.length) sound('record');
    }
  } catch {}
}

function toMenu() {
  run = null;
  state = 'menu';
}

// ---------- 背景：深色桌面，慢慢飘的像素点 ----------
const dots = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), v: rand(3, 9), c: pick(['#3A4160', '#4A5278', '#5B6B9A']) }));
function backdrop(dt) {
  g.rect(0, 0, W, H, C.bg);
  for (const d of dots) {
    d.y -= d.v * dt;
    if (d.y < -2) {
      d.y = H + 2;
      d.x = rand(0, W);
    }
    g.rect(Math.round(d.x), Math.round(d.y), 1.5, 1.5, d.c);
  }
}

// ---------- 菜单 ----------
const CARD_W = 106;
const CARD_H = 140;
const CARD_GAP = 10;
const CARD_Y = 62;
const grid = () => ARCADE.games.length > 3;
const compact = () => ARCADE.games.length > 4;
const GRID_W = 166;
const GRID_H = 76;
const GRID_GAP = 8;
const MINI_H = 80;
// 五、六个游戏三列；再多就四列（两行最多八个）
const cols = () => (ARCADE.games.length > 6 ? 4 : compact() ? 3 : grid() ? 2 : ARCADE.games.length);
const miniW = () => (cols() === 4 ? 80 : 110);
const cardRect = (i) => {
  if (compact()) {
    // 最后一行不满就居中
    const n = ARCADE.games.length;
    const c = cols();
    const w = miniW();
    const row = Math.floor(i / c);
    const inRow = Math.min(c, n - row * c);
    const x0 = (W - (w * inRow + GRID_GAP * (inRow - 1))) / 2;
    return { x: x0 + (i % c) * (w + GRID_GAP), y: 54 + row * (MINI_H + GRID_GAP), w, h: MINI_H };
  }
  if (grid()) {
    const x0 = (W - (GRID_W * 2 + GRID_GAP)) / 2;
    return { x: x0 + (i % 2) * (GRID_W + GRID_GAP), y: 56 + Math.floor(i / 2) * (GRID_H + GRID_GAP), w: GRID_W, h: GRID_H };
  }
  const x0 = (W - (CARD_W * 3 + CARD_GAP * 2)) / 2;
  return { x: x0 + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H };
};

function drawMenu(dt) {
  backdrop(dt);
  const n = ARCADE.games.length;
  const c = cols();
  const move = (k) => {
    sel = (sel + k + n) % n;
    sound('move');
  };
  // 上下：换一行（最后一行不满时停在最后一个）
  const moveRow = (k) => {
    const next = clamp(sel + k, 0, n - 1);
    if (next === sel) return;
    sel = next;
    sound('move');
  };
  if (input.hit('left')) move(-1);
  if (input.hit('right')) move(1);
  if (c < n && input.hit('up')) moveRow(-c);
  if (c < n && input.hit('down')) moveRow(c);
  if (input.hit('enter', 'space')) {
    sound('select');
    return openIntro(sel);
  }
  if (input.hit('esc')) return window.close();

  // 标题：小章鱼挥手
  const wave = Math.floor(t * 4) % 2;
  const top = grid() ? -4 : 0;
  g.pet(W / 2 - g.measure(tr('arc.title'), { size: 17, weight: 800 }) / 2 - 22, 36 + top, 1.6, { eyes: 'happy', armR: wave ? 'high' : 1, blush: true, t });
  g.text(tr('arc.title'), W / 2, 24 + top, { size: 17, weight: 800, color: C.cream, align: 'center' });
  g.text(tr('arc.subtitle'), W / 2, 44 + top, { size: 7.5, color: C.dim, align: 'center' });
  drawStreak();

  ARCADE.games.forEach((game, i) => {
    const r = cardRect(i);
    if (g.hover(r) && sel !== i) sel = i;
    const on = sel === i;
    const y = r.y + (on ? -2 : 0);
    if (on) g.round(r.x - 2, y - 2, r.w + 4, r.h + 4, 9, null, C.accent, 2);
    g.round(r.x, y, r.w, r.h, 7, C.card, null);
    const best = bestOf(game.id);
    const bestText = best ? tr('arc.best', { n: best }) : tr('arc.noBest');
    const bestStyle = { size: 7, weight: 700, color: best ? C.accent : C.muted };
    if (compact()) {
      const ir = { x: r.x + 5, y: y + 5, w: r.w - 10, h: 44 };
      clipIcon(game, ir, 4);
      const name = tr(`${game.id}.name`);
      const nameSize = Math.min(8, (8 * (r.w - 8)) / Math.max(1, g.measure(name, { size: 8, weight: 800 }))); // 卡片窄、名字长就缩小一点
      g.text(name, r.x + r.w / 2, y + 59, { size: nameSize, weight: 800, align: 'center' });
      g.text(bestText, r.x + r.w / 2, y + r.h - 9, { ...bestStyle, size: 6.5, align: 'center' });
    } else if (grid()) {
      // 横着：左边小画面，右边名字、简介、最高分
      const ir = { x: r.x + 5, y: y + 5, w: 80, h: r.h - 10 };
      clipIcon(game, ir, 4);
      const tx = ir.x + ir.w + 7;
      const tw = r.x + r.w - 6 - tx;
      g.text(tr(`${game.id}.name`), tx, y + 14, { size: 8.5, weight: 800 });
      g.wrapBalanced(tr(`${game.id}.tagline`), tw, { size: 6.2 }, 3).forEach((line, k) => g.text(line, tx, y + 27 + k * 8.5, { size: 6.2, color: C.muted }));
      g.text(bestText, tx, y + r.h - 10, bestStyle);
    } else {
      const ir = { x: r.x + 6, y: y + 6, w: r.w - 12, h: 66 };
      clipIcon(game, ir, 4);
      g.text(tr(`${game.id}.name`), r.x + r.w / 2, y + 84, { size: 9, weight: 800, align: 'center' });
      g.wrapBalanced(tr(`${game.id}.tagline`), r.w - 12, { size: 6.5 }, 3).forEach((line, k) => g.text(line, r.x + r.w / 2, y + 97 + k * 9, { size: 6.5, color: C.muted, align: 'center' }));
      g.text(bestText, r.x + r.w / 2, y + r.h - 9, { ...bestStyle, align: 'center' });
    }
    if (input.takeClick({ ...r, y })) {
      sound('select');
      openIntro(i);
    }
  });
  g.text(tr(grid() ? 'arc.menuHintGrid' : 'arc.menuHint'), W / 2, H - 12, { size: 6.5, color: C.dim, align: 'center' });
}

// 菜单右上角：今日挑战连续打卡几天；今天还没玩就提醒一句
function drawStreak() {
  const st = ARCADE_RNG.streakOn(daily.streak, ARCADE_RNG.dayKey());
  if (!st.n) return;
  const label = tr('arc.streak', { n: st.n });
  const o = { size: 6.5, weight: 800 };
  const w = g.measure(label, o) + 12;
  const x = W - 8 - w;
  g.round(x, 6, w, 13, 6.5, st.doneToday ? C.gold : '#3A4160', null);
  g.text(label, x + w / 2, 12.8, { ...o, color: st.doneToday ? '#3A2600' : C.cream, align: 'center' });
  if (!st.doneToday) g.text(tr('arc.streakTodo'), W - 8, 26, { size: 5.8, color: C.dim, align: 'right' });
}

// 游戏的小画面画在圆角框里，超出的部分裁掉
function clipIcon(game, r, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px(r.x), py(r.y), r.w * s, r.h * s, radius * s);
  ctx.clip();
  game.icon(g, r.x, r.y, r.w, r.h, t);
  ctx.restore();
}

// ---------- 规则 ----------
function drawIntro(dt) {
  backdrop(dt);
  if (input.hit('esc')) return toMenu();
  if (input.hit('enter', 'space')) return startRun();
  const p = { x: 22, y: 14, w: W - 44, h: H - 28 };
  g.round(p.x, p.y, p.w, p.h, 9, C.card, null);
  const ir = { x: p.x + 12, y: p.y + 12, w: 116, h: 76 };
  clipIcon(def, ir, 5);
  const tx = ir.x + ir.w + 12;
  const tw = p.x + p.w - 12 - tx;
  g.text(tr(`${def.id}.name`), tx, p.y + 22, { size: 14, weight: 800 });
  const tag = g.wrapBalanced(tr(`${def.id}.tagline`), tw, { size: 7.5 }, 3);
  tag.forEach((line, k) => g.text(line, tx, p.y + 40 + k * 10, { size: 7.5, color: C.muted }));
  const best = bestOf(def.id);
  g.text(best ? tr('arc.best', { n: best }) : tr('arc.noBest'), tx, p.y + 70, { size: 8, weight: 700, color: best ? C.accent : C.muted });
  // 这个游戏的成就：送什么装扮、目标和现在的进度、拿到没有
  const ach = achOf(def.id);
  if (ach) {
    const vars = { name: tr(`ach.${ach.id}`), desc: tr(`ach.${ach.id}Desc`), item: tr(`item.${ach.item}`), value: ach.value, goal: ach.goal };
    g.rect(tx, p.y + 81.5, 3, 3, ach.unlockedAt ? C.green : C.gold);
    g.text(g.wrap(tr(ach.unlockedAt ? 'arc.achDone' : 'arc.achLine', vars), tw - 6, { size: 6.5, weight: 700 }, 1)[0], tx + 6, p.y + 83, { size: 6.5, weight: 700, color: ach.unlockedAt ? C.green : '#B9861F' });
    if (!ach.unlockedAt) g.text(g.wrap(tr('arc.achGoal', vars), tw - 6, { size: 6 }, 1)[0], tx + 6, p.y + 92, { size: 6, color: C.muted });
  }

  // 规则和操作说明：按内容挑字号，长的（比如日文、塔防）缩小一档，不能压到下面的按钮
  const by = p.y + p.h - 38;
  const top = ir.y + ir.h + 14;
  const keysText = `${tr('arc.controls')}${tr('punct.colon')}${tr(`${def.id}.keys`)}`;
  let layout = null;
  for (const size of [7.5, 7, 6.5, 6, 5.5]) {
    const lh = size * 1.33;
    const rules = ['rule1', 'rule2', 'rule3'].map((key) => g.wrap(tr(`${def.id}.${key}`), p.w - 34, { size }, 3));
    const keys = g.wrap(keysText, p.w - 28, { size: size - 0.5 }, 3);
    const height = rules.reduce((h, lines) => h + lines.length * lh + 4, 0) + keys.length * (lh - 1) + 2;
    layout = { size, lh, rules, keys };
    if (top + height <= by - 14) break;
  }
  let y = top;
  for (const lines of layout.rules) {
    g.rect(p.x + 14, y - 1.5, 3, 3, C.accent);
    lines.forEach((line, k) => g.text(line, p.x + 22, y + k * layout.lh, { size: layout.size }));
    y += lines.length * layout.lh + 4;
  }
  layout.keys.forEach((line, k) => g.text(line, p.x + 14, y + 2 + k * (layout.lh - 1), { size: layout.size - 0.5, color: C.muted }));

  const dBest = dailyBestOf(def.id);
  g.text(tr(dBest ? 'arc.dailyInfoBest' : 'arc.dailyInfo', { date: shortDay(ARCADE_RNG.dayKey()), n: dBest }), W / 2, by - 7, { size: 6, color: '#B9861F', align: 'center' });
  if (input.hit('daily')) return startRun(true);
  if (g.button({ x: W / 2 + 50, y: by, w: 84, h: 20 }, tr('arc.start'), { primary: true })) return startRun(false);
  if (g.button({ x: W / 2 - 42, y: by, w: 84, h: 20 }, tr('arc.daily'), { fill: C.gold, ink: '#3A2600' })) return startRun(true);
  if (g.button({ x: W / 2 - 134, y: by, w: 84, h: 20 }, tr('arc.back'))) return toMenu();
  g.text(tr('arc.introHint'), W / 2, p.y + p.h - 9, { size: 6, color: C.muted, align: 'center' });
}

// ---------- HUD：得分、最高分、生命、游戏自己的一行字、暂停按钮 ----------
function drawHud() {
  const h = run.hud();
  g.rect(0, 0, W, 17, 'rgba(15,17,28,0.72)');
  g.text(String(h.score), 8, 9, { size: 10, weight: 800, color: C.cream });
  const sw = g.measure(String(h.score), { size: 10, weight: 800 });
  g.text(tr('arc.best', { n: Math.max(bestOf(def.id), h.score) }), 14 + sw, 9.5, { size: 6.5, color: C.dim });
  if (h.label) g.text(h.label, W / 2, 9, { size: 7.5, weight: 700, color: h.labelColor || C.cream, align: 'center' });
  if (runDay) {
    const tag = tr('arc.dailyTag');
    const tw = g.measure(tag, { size: 6, weight: 800 }) + 8;
    const lx = W / 2 - (h.label ? g.measure(h.label, { size: 7.5, weight: 700 }) / 2 : 0) - tw - 5;
    g.round(lx, 4, tw, 10, 5, C.gold, null);
    g.text(tag, lx + tw / 2, 9.3, { size: 6, weight: 800, color: '#3A2600', align: 'center' });
  }
  // 血量多（比如塔防的 20 点）：一颗心加数字
  if (h.hp != null) {
    const low = h.hp <= Math.max(3, (h.hpMax || 20) * 0.25);
    g.glyph('heart', W - 52, 9, 1.4, low ? '#FF5C5C' : '#F25F7A', '#FFFFFF');
    g.text(`${h.hp}`, W - 45, 9, { size: 8.5, weight: 800, color: low ? '#FF8A8A' : C.cream });
  }
  // 生命：至少画三个格子，丢了的是空心的
  const slots = h.lives == null ? 0 : Math.max(3, h.lives);
  for (let i = 0; i < slots; i++) {
    const x = W - 26 - (slots - 1 - i) * 11;
    g.glyph('heart', x, 9, 1.4, i < h.lives ? '#F25F7A' : '#4A5070', i < h.lives ? '#FFFFFF' : null);
  }
  // 暂停按钮
  const pr = { x: W - 14, y: 3, w: 11, h: 11 };
  const over = g.hover(pr);
  if (over) hovering = true;
  g.round(pr.x, pr.y, pr.w, pr.h, 2, over ? '#3A4160' : null, null);
  g.rect(pr.x + 3.5, pr.y + 3, 1.5, 5, C.cream);
  g.rect(pr.x + 6.5, pr.y + 3, 1.5, 5, C.cream);
  if (input.takeClick(pr)) state = 'pause';
}

// ---------- 暂停 ----------
function drawPause() {
  g.rect(0, 0, W, H, 'rgba(15,17,28,0.62)');
  const p = { x: W / 2 - 90, y: H / 2 - 52, w: 180, h: 104 };
  g.round(p.x, p.y, p.w, p.h, 9, C.card, null);
  g.text(tr('arc.paused'), W / 2, p.y + 22, { size: 14, weight: 800, align: 'center' });
  g.text(tr('arc.pauseHint'), W / 2, p.y + 40, { size: 6.5, color: C.muted, align: 'center' });
  if (input.hit('esc', 'pause', 'enter', 'space')) state = 'play';
  else if (input.hit('quit')) toMenu();
  else if (g.button({ x: p.x + p.w / 2 + 4, y: p.y + 62, w: 74, h: 20 }, tr('arc.resume'), { primary: true })) state = 'play';
  else if (g.button({ x: p.x + p.w / 2 - 78, y: p.y + 62, w: 74, h: 20 }, tr('arc.menu'))) toMenu();
}

// ---------- 结算 ----------
function drawOver(dt) {
  overT += dt;
  g.rect(0, 0, W, H, `rgba(15,17,28,${Math.min(0.66, overT * 2)})`);
  // 刚解锁的成就放在最后，金色
  const streakLine = result.day && result.streak ? [{ text: tr(result.streak > 1 ? 'arc.streakLine' : 'arc.streakFirst', { n: result.streak }), color: '#B9861F' }] : [];
  const lines = [...(result.summary || []), ...streakLine, ...result.unlocked.map((u) => ({ text: tr('arc.unlocked', { name: tr(`ach.${u.id}`), item: tr(`item.${u.item}`) }), color: '#B9861F', bold: true }))];
  const ph = 140 + lines.length * 10.5;
  const p = { x: W / 2 - 120, y: Math.max(8, H / 2 - ph / 2), w: 240, h: ph };
  const rise = Math.max(0, 1 - overT * 4) * 20;
  const badge = result.record ? tr('arc.record') : result.dailyRecord ? tr('arc.dailyRecord') : '';
  g.round(p.x, p.y + rise, p.w, p.h, 9, C.card, badge ? C.gold : null, 2);
  const y0 = p.y + rise;
  g.text(result.day ? tr('arc.dailyOver', { date: shortDay(result.day) }) : tr('arc.over'), W / 2, y0 + 16, { size: 9, weight: 700, color: result.day ? '#B9861F' : C.muted, align: 'center' });
  // 分数从 0 数上去
  const shown = Math.round(result.score * Math.min(1, overT / 0.7));
  g.text(String(shown), W / 2, y0 + 42, { size: 26, weight: 800, color: badge ? C.accent : C.ink, align: 'center' });
  if (badge) {
    const bounce = Math.abs(Math.sin(t * 5)) * 2;
    const bw = Math.max(68, g.measure(badge, { size: 7.5, weight: 800 }) + 16);
    g.round(W / 2 - bw / 2, y0 + 60 - bounce, bw, 13, 6.5, C.gold, null);
    g.text(badge, W / 2, y0 + 66.5 - bounce, { size: 7.5, weight: 800, color: '#5A3B00', align: 'center' });
    if (Math.random() < dt * 30) sparkle.push({ x: rand(p.x, p.x + p.w), y: y0 + rand(0, 20), vy: rand(-30, -10), life: 0.8, c: pick([C.gold, C.accent, '#70C1B3', '#B388EB']) });
  } else g.text(result.day ? tr('arc.dailyBestLine', { d: result.dailyBest, b: result.best }) : tr('arc.best', { n: result.best }), W / 2, y0 + 66, { size: 7.5, color: C.muted, align: 'center' });
  let y = y0 + 84;
  for (const l of lines) {
    g.text(l.text, p.x + 16 + (l.indent || 0), y, { size: l.size || 7.2, color: l.color || C.ink, mono: !!l.mono, weight: l.bold ? 700 : 400 });
    y += 10.5;
  }
  // 刚结束的 0.4 秒里不接受操作，免得还在狂按方向键、空格的手直接点了"再来一局"
  const by = y0 + p.h - 38;
  const ready = overT > 0.4;
  const again = g.button({ x: W / 2 + 4, y: by, w: 92, h: 20 }, tr('arc.again'), { primary: true });
  const menu = g.button({ x: W / 2 - 96, y: by, w: 92, h: 20 }, tr('arc.menu'));
  if (ready && (again || input.hit('enter', 'space', 'retry'))) return startRun(!!result.day); // 今日挑战就再来一局今日挑战
  if (ready && (menu || input.hit('esc', 'quit'))) return toMenu();
  g.text(tr('arc.overHint'), W / 2, y0 + p.h - 9, { size: 6, color: C.muted, align: 'center' });
}
const sparkle = [];
function drawSparkle(dt) {
  for (const q of sparkle) {
    q.y += q.vy * dt;
    q.life -= dt;
    g.alpha(q.life / 0.8, () => g.rect(q.x, q.y, 2, 2, q.c));
  }
  for (let i = sparkle.length - 1; i >= 0; i--) if (sparkle[i].life <= 0) sparkle.splice(i, 1);
}

// ---------- 主循环 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  t += dt;
  hovering = false;
  try {
    ctx.fillStyle = C.edge;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, W * s, H * s);
    ctx.clip();
    if (state === 'menu') drawMenu(dt);
    else if (state === 'intro') drawIntro(dt);
    else if (state === 'count' || state === 'play' || state === 'pause' || state === 'over') drawGame(dt);
    drawSparkle(dt);
    ctx.restore();
  } catch (err) {
    console.error('[arcade]', err);
  }
  canvas.style.cursor = hovering ? 'pointer' : 'default';
  input.hits.clear();
  input.typed.length = 0;
  input.clicks.length = 0;
  requestAnimationFrame(frame);
}

function drawGame(dt) {
  if (state === 'play') {
    if (input.hits.has('esc') && run.handleEsc && run.handleEsc()) input.hits.delete('esc');
    if (input.hit('esc', 'pause')) state = 'pause';
    else {
      run.update(dt, input);
      if (run.over) finishRun();
    }
  }
  if (state === 'count') {
    countT += dt;
    const n = 3 - Math.floor(countT / 0.6);
    if (n !== 3 - Math.floor((countT - dt) / 0.6) && countT < 2.4) sound(n > 0 ? 'count' : 'go');
    if (countT >= 2.4) state = 'play';
  }
  run.draw(g, t);
  g.shake(0, 0);
  drawHud();
  if (state === 'count') {
    const n = 3 - Math.floor(countT / 0.6);
    const k = (countT % 0.6) / 0.6;
    const label = n > 0 ? String(n) : tr('arc.go');
    g.alpha(1 - k * 0.6, () => g.text(label, W / 2, H / 2 - 4, { size: 30 + k * 10, weight: 800, color: C.cream, align: 'center' }));
  } else if (state === 'pause') drawPause();
  else if (state === 'over') drawOver(dt);
}

// ---------- 启动 ----------
document.addEventListener('DOMContentLoaded', async () => {
  resize();
  let info = {};
  try {
    info = (await api.info()) || {};
  } catch {}
  setLocale(info.locale || I18N.detect(navigator.languages));
  palette = PALETTES[info.color || 0] || PALETTES[0];
  outfit = info.outfit || OUTFITS.effective({}, true);
  soundOn = info.sound !== false;
  scores = info.scores || {};
  achievements = info.achievements || [];
  daily = info.daily || daily;
  sel = clamp(sel, 0, ARCADE.games.length - 1);
  state = 'menu';
  canvas.focus();
  requestAnimationFrame(frame);
});

// ---------- 不在 Electron 里（直接用浏览器打开）时：成绩存在 localStorage ----------
function mockApi() {
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem('arcade-scores') || '{}');
    } catch {
      return {};
    }
  };
  return {
    info: async () => {
      const all = load();
      const day = ARCADE_RNG.dayKey();
      return { locale: I18N.detect(navigator.languages), color: 0, outfit: OUTFITS.effective({}, true), sound: true, scores: all, daily: { day, scores: (all.daily && all.daily[day]) || {}, streak: all.streak || {} } };
    },
    saveScore: async (game, score, _metrics, day) => {
      const all = load();
      const cur = all[game] || { best: 0, plays: 0 };
      const prev = cur.best;
      all[game] = { best: Math.max(prev, score), plays: cur.plays + 1 };
      let dailyBest = null;
      if (day) {
        all.daily = all.daily || {};
        const d = (all.daily[day] = all.daily[day] || {});
        d[game] = Math.max(d[game] || 0, score);
        dailyBest = d[game];
        all.streak = ARCADE_RNG.bumpStreak(all.streak, day);
      }
      try {
        localStorage.setItem('arcade-scores', JSON.stringify(all));
      } catch {}
      return { best: all[game].best, prev, record: score > prev, plays: all[game].plays, dailyBest, streak: day ? all.streak.n : null };
    },
  };
}
