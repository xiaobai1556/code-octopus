// 舞台：画布、主循环、平台和实心窗口、鼠标交互、会话 ↔ 桌宠的对应关系、粒子和气泡。

const host = window.petHost || null; // 不在 Electron 里（比如直接用浏览器打开）就是预览模式
const MAX_PETS = 6;
const SESSION_STALE = 45 * 60 * 1000;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const stats = { renders: 0, ticks: 0, platformUpdates: 0, rideMoves: 0, mouseMoves: 0, pushes: 0, rides: [], input: [] };

// [频率, 开始时间, 时长]
const SOUNDS = {
  alert: [[880, 0, 0.09], [660, 0.12, 0.09], [880, 0.24, 0.14]],
  done: [[523, 0, 0.08], [659, 0.09, 0.08], [784, 0.18, 0.08], [1047, 0.27, 0.18]],
  report: [[784, 0, 0.08], [1047, 0.1, 0.16]],
  unlock: [[659, 0, 0.07], [784, 0.08, 0.07], [988, 0.16, 0.07], [1319, 0.24, 0.2]],
};
let audioCtx = null;

// 最近的鼠标输入（/state 里能看到），排查"拖不动"用：按下时收到没有、认出是哪只没有
function logInput(type, e, extra = {}) {
  stats.input.push({ at: new Date().toISOString().slice(11, 23), type, x: Math.round(e.clientX), y: Math.round(e.clientY), ...extra });
  if (stats.input.length > 40) stats.input.shift();
}

const world = {
  width: 0,
  height: 0,
  dpr: 1,
  scale: 5,
  bubbles: 'full', // alerts 只提醒 / brief 简洁 / full 详细
  collide: true, // 窗口是不是实心的
  userAway: false,
  platforms: [], // 窗口上边缘（扣掉被挡住的部分），可以站
  solids: [], // 窗口矩形，开了碰撞时是实心的
  solidMap: new Map(),
  ridingUntil: 0, // 有桌宠正被窗口带着走时，位置一变就立刻重画
  pets: [],
  particles: [],
  mouse: null,
  greeted: {},
  // 多显示器：这块屏是不是主屏（第一只小章鱼在这里出生），左右边上通往别的屏的口子 { to, y1, y2 }
  home: !host,
  displayId: '',
  exits: { left: [], right: [] },
  outfitChosen: {},
  holidays: true,
  outfit: {}, // 实际穿的（节日装扮盖掉对应部位）
  feedOn: true,
  games: null,
  tour: null,
  teaser: null,
  music: false, // 系统在放歌
  pomodoro: null, // { phase, endsAt, petId, overlayId }
  notes: [],
  timeOfDay: true,

  // ---------- 平台和实心窗口 ----------
  setPlatforms(list, windows = []) {
    stats.platformUpdates++;
    const now = performance.now();
    const prevSolids = this.solidMap;
    const solidMap = new Map(windows.map((s) => [s.id, s]));

    // 窗口被拖动时，站在上面的桌宠跟着走
    for (const pet of this.pets) {
      const g = pet.ground;
      if (!g || g.id === 'floor') continue;
      const p = list.find((q) => q.id === g.id);
      if (!p) {
        pet.fall(0);
        continue;
      }
      const dx = p.wx - g.wx;
      const dy = p.y - g.y;
      if (!dx && !dy) continue;
      pet.x += dx;
      pet.y += dy;
      g.wx = p.wx;
      g.y = p.y;
      noteRideUpdate();
      this.ridingUntil = now + 300;
      stats.rideMoves++;
    }
    this.platforms = list;
    this.solids = windows;
    this.solidMap = solidMap;

    // 窗口撞到桌宠身上：顺着窗口移动的方向把它推开；新出现的窗口直接盖在它身上就不管
    if (!this.collide) return;
    for (const pet of this.pets) {
      if (pet.leaving || pet.mode === 'drag') continue;
      const layer = this.layerZ(pet);
      for (const s of windows) {
        if (s.z > layer || pet.inside.has(s.id) || (pet.ground && pet.ground.id === s.id)) continue;
        if (!this.overlaps(pet.bodyBox(), s)) continue;
        const prev = prevSolids.get(s.id);
        if (!prev || this.overlaps(pet.bodyBox(), prev)) pet.inside.add(s.id);
        else this.pushOut(pet, s, prev);
      }
    }
  },

  overlaps(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  },

  solidById(id) {
    return this.solidMap.get(id) || null;
  },

  // 小章鱼所在层的前后位置：站过的那个窗口的 z（0 最前），在桌面地面上就是最后面
  layerZ(pet) {
    if (!pet || pet.layerId == null) return Infinity;
    const s = this.solidMap.get(pet.layerId);
    return s ? s.z : Infinity;
  },

  // 只有在它所在层前面（或同一层）的窗口才挡它；叠在后面的窗口当背景
  hitSolid(box, pet) {
    if (!this.collide) return null;
    const layer = this.layerZ(pet);
    for (const s of this.solids) {
      if (s.z > layer) continue;
      if (pet && pet.inside.has(s.id)) continue;
      if (this.overlaps(box, s)) return s;
    }
    return null;
  },

  pushOut(pet, s, prev) {
    const bw = pet.halfW * BODY;
    const bh = pet.height * 0.92;
    const dx = s.l - prev.l;
    const dy = s.t - prev.t;
    let x = pet.x;
    let y = pet.y;
    let onTop = false;
    if (dx && Math.abs(dx) >= Math.abs(dy)) x = dx > 0 ? s.r + bw + 0.5 : s.l - bw - 0.5;
    else if (dy < 0) {
      y = s.t; // 窗口从下面顶上来：站到它上面
      onTop = true;
    } else if (dy > 0 && !pet.ground) y = s.b + bh + 0.5;
    else x = pet.x - s.l < s.r - pet.x ? s.l - bw - 0.5 : s.r + bw + 0.5; // 从上面压下来：往近的一边挤出去
    x = clamp(x, pet.halfW, this.width - pet.halfW);
    if (this.overlaps(pet.bodyBox(x, y), s)) {
      pet.inside.add(s.id); // 挤不出去（比如被推到屏幕边上）就算了
      return;
    }
    pet.x = x;
    pet.y = y;
    pet.shoved = 0.35;
    pet.touch();
    stats.pushes++;
    this.ridingUntil = performance.now() + 300;
    if (onTop) {
      const seg = this.segmentAt(s.id, x, pet.halfW * 0.7);
      if (seg) {
        pet.ground = { id: seg.id, wx: seg.wx, y: seg.y };
        pet.layerId = seg.id;
      } else pet.fall(0);
    }
  },

  segmentAt(id, x, tol = 1) {
    return this.platforms.find((p) => p.id === id && x >= p.x1 - tol && x <= p.x2 + tol) || null;
  },

  landingPlatform(x, y0, y1, tol = 0) {
    let best = null;
    for (const p of this.platforms) {
      if (x >= p.x1 - tol && x <= p.x2 + tol && p.y >= y0 - 0.5 && p.y <= y1 && (!best || p.y < best.y)) best = p;
    }
    if (!best && y1 >= this.height) best = { id: 'floor', y: this.height, wx: 0 };
    return best;
  },

  findJumpTarget(pet) {
    const hw = pet.halfW;
    const near = [];
    const far = [];
    for (const p of this.platforms) {
      if (pet.ground && p.id === pet.ground.id) continue;
      const dy = pet.y - p.y;
      if (dy < 24) continue;
      const lo = p.x1 + hw;
      const hi = p.x2 - hw;
      if (hi - lo < 10) continue;
      const lx = clamp(pet.x + rand(-80, 80), lo, hi);
      if (Math.abs(lx - pet.x) > 320) continue;
      // 开了碰撞：头顶到最高点之间不能有窗口挡着
      if (this.collide) {
        const box = pet.bodyBox();
        if (this.hitSolid({ l: box.l, r: box.r, t: p.y - 40 - pet.height, b: box.t }, pet)) continue;
      }
      (dy < 340 ? near : far).push({ x: lx, y: p.y });
    }
    // 偶尔来一次超级大跳
    const pool = near.length && Math.random() < 0.75 ? near : far.length ? far : near;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  },

  // ---------- 多显示器 ----------
  // 走 / 飞到这一侧的屏幕边时能不能过去：在地面上总能过去，在窗口上要在两块屏竖直方向重叠的范围内
  exitAt(side, pet) {
    const onFloor = pet.ground && pet.ground.id === 'floor';
    return (this.exits[side] || []).find((e) => onFloor || (pet.y >= e.y1 - 2 && pet.y <= e.y2 + 2)) || null;
  },

  // 下班离开时往哪边走：优先走没有别的屏幕的那一边，免得"走"到隔壁屏上又出现
  exitSide(pet) {
    const near = pet.x < this.width / 2 ? -1 : 1;
    const has = (dir) => (this.exits[dir < 0 ? 'left' : 'right'] || []).length > 0;
    return has(near) && !has(-near) ? -near : near;
  },

  // 屏幕边：没有隔壁屏的那一侧不能出去
  clampX(pet, x) {
    if (x < pet.halfW && !this.exitAt('left', pet)) return pet.halfW;
    if (x > this.width - pet.halfW && !this.exitAt('right', pet)) return this.width - pet.halfW;
    return x;
  },

  // 从 a 走到 b 的路上有没有窗口挡着
  clearPath(a, b) {
    if (!this.collide) return true;
    const dir = Math.sign(b.x - a.x);
    for (let x = a.x; dir * (b.x - x) > 0; x += dir * 8) if (this.hitSolid(a.bodyBox(x), a)) return false;
    return true;
  },

  // 交给隔壁屏的覆盖层（主进程换算坐标）
  transfer(pet, to, extra = {}) {
    if (!host) return;
    if (pet.game) this.games.abort(pet.game);
    if (this.tour && this.tour.pet === pet) this.tour.end(true);
    this.pets = this.pets.filter((p) => p !== pet);
    if (hoverPet === pet) hoverPet = null;
    host.transfer({ to, pet: pet.serialize(), ...extra });
  },

  importPet(data, d, summon) {
    const pet = Pet.fromData(this, data);
    this.pets.push(pet);
    if (d) {
      // 拖着过来的：接着拖
      drag = { pet, sx: pet.x - d.ox, sy: pet.y - d.oy, ox: d.ox, oy: d.oy, moved: true, hist: [], t0: d.t0, at: performance.now() };
      pet.mode = 'drag';
      pet.ground = null;
    } else if (pet.ground && !pet.activity && (pet.x < pet.halfW || pet.x > this.width - pet.halfW)) {
      // 走过来的：先整个走进这块屏，别停在边上只露半个身子
      pet.facing = pet.x < this.width / 2 ? 1 : -1;
      pet.setMode('walk', 2.5);
      pet.edgePolicy = 'turn';
    }
    if (summon) this.summon();
    return pet;
  },

  refreshOutfit() {
    this.outfit = OUTFITS.effective(this.outfitChosen, this.holidays);
  },

  // ---------- 跟着时间变化 ----------
  // late 后半夜（1~5 点）/ night 夜里 / morning 早上 / day 白天
  dayPart(d = new Date()) {
    if (!this.timeOfDay) return 'day';
    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 1 && h < 5) return 'late';
    if (h >= 22 || h < 1 || h < 6) return 'night';
    if (h < 9.5) return 'morning';
    return 'day';
  },

  // 一天里的几句招呼（只在主屏说，每种每天一次；后半夜每小时提醒一次早点睡）
  timeTick() {
    if (!this.timeOfDay || !this.home || this.userAway || this.tour) return;
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const hm = now.getHours() * 60 + now.getMinutes();
    let said = {};
    try {
      said = JSON.parse(localStorage.getItem('claude-pet-greet') || '{}');
    } catch {}
    const once = (key, cond, fn) => {
      if (!cond || said[key] === day) return;
      said[key] = day;
      fn();
    };
    const pet = this.pets.find((p) => !p.leaving && !p.visitor && !p.holding() && !p.game && p.ground);
    if (!pet) return;
    once('morning', hm >= 6 * 60 && hm < 9 * 60 + 30, () => {
      pet.touch();
      pet.setMode('stretch', 1.4);
      pet.say(tr('time.morning'), 2.6);
    });
    once('lunch', hm >= 12 * 60 && hm < 12 * 60 + 30, () => pet.say(tr('time.lunch'), 2.6));
    once('evening', hm >= 18 * 60 && hm < 18 * 60 + 30 && now.getDay() % 6 !== 0, () => pet.say(tr('time.evening'), 2.6));
    // 后半夜还在用电脑：每小时劝一次
    once(`late-${now.getHours()}`, this.dayPart(now) === 'late', () => {
      pet.touch();
      pet.doEmote('oops', 1.4);
      pet.say(tr('time.late', { time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}` }), 3, false, { sub: tr('time.lateSub') });
    });
    try {
      localStorage.setItem('claude-pet-greet', JSON.stringify(said));
    } catch {}
  },

  // 四季：隔一阵子在某只桌宠头顶飘下几片应季的东西（春天花瓣、夏天夜里萤火虫、秋天落叶、冬天雪花）。
  // 粒子在的那几秒按 60 帧画，所以只偶尔飘一小阵
  seasonTick() {
    if (!this.timeOfDay || this.userAway || this.tour || !this.pets.length) return;
    const season = OUTFITS.season();
    const night = this.dayPart() !== 'day' && this.dayPart() !== 'morning';
    if (season === 'summer' && !night) return;
    const pet = pick(this.pets.filter((p) => p.ground && !p.leaving));
    if (!pet) return;
    const n = Math.floor(rand(3, 6));
    for (let i = 0; i < n; i++) {
      const life = rand(3.2, 4.5);
      const base = { x: pet.x + rand(-60, 60), y: pet.y - pet.height - rand(30, 90), life: life + i * 0.4, max: life, phase: rand(0, 6), g: 0 };
      if (season === 'summer') {
        // 萤火虫：慢慢往上飘，一闪一闪
        this.particles.push({ ...base, kind: 'firefly', y: pet.y - rand(0, pet.height), vx: rand(-10, 10), vy: rand(-18, -8), sway: 30, size: pet.Pd * 0.5, color: '#F4F78A', outline: 'rgba(200,230,80,0.5)' });
      } else {
        const look = {
          spring: { kind: 'petal', color: pick(['#F7A8C4', '#FBC9DA']), outline: '#FFFFFF' },
          autumn: { kind: 'leaf', color: pick(['#E0602F', '#E8A33D', '#C2452D']), outline: '#FFF6E0' },
          winter: { kind: 'flake', color: '#FFFFFF', outline: '#9DB7D5' },
        }[season];
        this.particles.push({ ...base, ...look, vx: rand(-8, 8), vy: rand(22, 34), sway: 45, size: pet.Pd * 0.4 });
      }
    }
  },

  // ---------- 番茄钟、便签：谁举着 ----------
  pomodoroHolder() {
    const pomo = this.pomodoro;
    if (!pomo) return null;
    return this.pets.find((p) => p.id === pomo.petId) || (pomo.overlayId === this.displayId ? this.pets.find((p) => !p.leaving && !p.visitor) : null) || null;
  },

  myNotes() {
    return this.notes.filter((n) => n.overlayId === this.displayId || (!n.overlayId && this.home));
  },

  noteHolder() {
    return this.myNotes().length ? this.pets.find((p) => !p.leaving && !p.visitor) || null : null;
  },

  // 番茄钟专注时，举着番茄的那只陪你一起敲键盘，不乱跑
  holdStill(pet) {
    return !!(this.pomodoro && this.pomodoro.phase === 'focus' && this.pomodoroHolder() === pet && !this.teaser.on);
  },

  // 姿势上加点东西：番茄钟、便签、夜里的小灯笼
  decorate(pet, p) {
    const special = p.props.some((k) => k === 'terminal' || k === 'magnifier' || k === 'laptop' || k.startsWith('sign'));
    const free = !pet.activity && pet.ground && !pet.game && !pet.emote && pet.mode !== 'sleep' && pet.mode !== 'drag';
    const pomo = this.pomodoroHolder() === pet ? this.pomodoro : null;
    if (pomo && pomo.phase === 'focus' && free && !special) {
      const typing = Math.floor(pet.t * 8) % 2;
      Object.assign(p, { eyes: p.eyes === 'blink' ? 'blink' : 'down', armL: typing ? 4 : 5, armR: typing ? 5 : 4, dx: 0 });
      p.props.push('laptop', 'tomato');
      return;
    }
    if (special) return;
    if (pomo) p.props.push('tomato');
    else if (this.noteHolder() === pet) p.props.push('note');
    else if (free && (this.dayPart() === 'night' || this.dayPart() === 'late') && ['idle', 'walk', 'look', 'chase'].includes(pet.mode)) p.props.push('lantern');
  },

  // 鼠标悬停时名字下面那一行：番茄钟还剩多久 / 最新的便签
  hoverLine(pet) {
    const pomo = this.pomodoroHolder() === pet ? this.pomodoro : null;
    if (pomo) {
      const left = Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000));
      return tr(pomo.phase === 'focus' ? 'pomo.focusLeft' : 'pomo.breakLeft', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
    }
    const notes = this.noteHolder() === pet ? this.myNotes() : [];
    if (notes.length) return `${tr('note.label', { n: notes.length })}：${notes[notes.length - 1].text}`;
    return '';
  },

  permissionDecision(id, behavior) {
    if (host) host.permissionDecision({ id, behavior });
  },

  noteDone(id) {
    if (host) host.noteDone(id);
  },

  // ---------- 和主进程打交道 ----------
  soundOn: true,

  // 8-bit 小提示音（方波）：需要你批准 / 长任务做完 / 日报写好
  sound(kind) {
    const notes = SOUNDS[kind];
    if (!this.soundOn || !notes) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.03;
      for (const [freq, at, dur] of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.05, t0 + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.02);
      }
    } catch {}
  },

  focusSession(sessionId) {
    if (host && sessionId) host.focusSession(sessionId);
  },

  openReport() {
    if (host) host.openReport();
  },

  openSettings(section) {
    if (host) host.openSettings(section);
  },

  openDownloads() {
    if (host) host.openDownloads();
  },

  tourDone() {
    if (host) host.tourDone();
  },

  // 一只闲着的（没在举牌子的）来传话：日报、成就、下载文件夹太乱、有新版本
  messenger(sessionId) {
    const live = this.pets.filter((p) => !p.leaving && !p.leaveAt && !p.visitor);
    return (sessionId && live.find((p) => p.sessionId === sessionId)) || live.find((p) => !p.holding()) || live[0] || this.spawnPet();
  },

  // 日报写好了：让第一只闲着的（没在举别的牌子的）去举牌子
  onReportReady() {
    for (const p of this.pets) if (!p.leaving && !p.visitor && p.reportReady()) return;
    if (!this.pets.some((p) => !p.leaving && !p.visitor)) this.spawnPet().reportReady();
  },

  alertTargetX(pet) {
    const alerting = this.pets.filter((p) => p.activity && ((p.activity.kind === 'alert' && p.activity.urgent) || p.activity.kind === 'done'));
    const k = Math.max(0, alerting.indexOf(pet));
    return clamp(this.width / 2 + (k - (alerting.length - 1) / 2) * 140, pet.halfW, this.width - pet.halfW);
  },

  // ---------- 桌宠 ----------
  // 第一只用设置里选的主色，后来的挑没人用的颜色
  homeColor: 0,

  setHomeColor(idx) {
    const palette = PALETTES[idx] || PALETTES[0];
    this.homeColor = PALETTES.indexOf(palette);
    const home = this.pets[0];
    if (!home || home.palette === palette) return;
    const other = this.pets.find((p) => p.palette === palette);
    if (other) other.palette = home.palette;
    home.palette = palette;
  },

  spawnPet(x) {
    const used = new Set(this.pets.map((p) => p.palette));
    const home = PALETTES[this.homeColor];
    const palette = !used.has(home) ? home : PALETTES.find((p) => !used.has(p)) || PALETTES[this.pets.length % PALETTES.length];
    const pet = new Pet(this, x ?? rand(this.width * 0.2, this.width * 0.8), -40, palette);
    this.pets.push(pet);
    return pet;
  },

  removePet(pet) {
    if (pet.game) this.games.abort(pet.game);
    this.pets = this.pets.filter((p) => p !== pet);
    // 在 Electron 里，所有屏上都没有桌宠了由主进程决定在主屏再生一只（这块屏空着可能只是它走到隔壁屏去了）
    if (!this.pets.length && !host) this.spawnPet();
  },

  petForSession(ev) {
    let pet = this.pets.find((p) => p.sessionId === ev.sessionId && !p.leaving);
    if (pet) return pet;
    // 叫来玩的小伙伴、正在做新手引导的那只不接活
    const spare = (p) => !p.leaving && !p.visitor && !(this.tour && this.tour.pet === p);
    pet = this.pets.find((p) => !p.sessionId && !p.leaveAt && spare(p));
    if (!pet) {
      if (this.pets.length < MAX_PETS) pet = this.spawnPet();
      else pet = this.pets.filter(spare).sort((a, b) => a.lastEvent - b.lastEvent)[0] || this.pets[0];
    }
    if (pet.game) this.games.abort(pet.game);
    pet.leaveAt = 0;
    pet.sessionId = ev.sessionId;
    pet.project = ev.project || '';
    pet.minis = [];
    return pet;
  },

  endSession(sessionId, reason) {
    const pet = this.pets.find((p) => p.sessionId === sessionId && !p.leaving);
    if (!pet) return;
    pet.sessionId = null;
    pet.project = '';
    pet.todo = '';
    pet.turnStart = 0;
    pet.clearActivity();
    pet.minis = [];
    const others = this.pets.filter((p) => p !== pet && !p.leaving && !p.leaveAt);
    // /clear 会紧接着开新会话，就别走了
    if (others.length && reason !== 'clear' && reason !== 'resume') {
      pet.say(tr('say.bye'), 1.4);
      pet.doEmote('bye', 1.4);
      pet.leaveAt = performance.now() + 1400;
      pet.exitDir = this.exitSide(pet);
    } else {
      pet.say(tr('say.seeYou'), 1.6);
      pet.doEmote('wave', 1.4);
    }
  },

  onClaudeEvent(ev) {
    if (ev.event === 'SessionEnd') return this.endSession(ev.sessionId, ev.reason);
    if (ev.event === 'Notification' && ev.notify === 'info') return;
    this.petForSession(ev).onClaude(ev);
  },

  tidy() {
    const now = performance.now();
    for (const p of this.pets) {
      if (p.sessionId && now - p.lastEvent > SESSION_STALE) this.endSession(p.sessionId, 'stale');
    }
  },

  summon() {
    if (this.games.current) this.games.abort(this.games.current);
    this.pets.forEach((p, i) => {
      p.touch();
      p.mount = null;
      p.leaving = false;
      p.leaveAt = 0;
      p.inside.clear();
      p.layerId = null;
      if (p.activity && p.activity.kind === 'alert') p.activity.goto = false;
      p.ground = null;
      p.climb = null;
      p.x = this.width / 2 + (i - (this.pets.length - 1) / 2) * 110;
      p.y = -60 - i * 40;
      p.vx = 0;
      p.vy = 0;
    });
  },

  // 两只闲着的小章鱼在同一个平台上碰面：互相打个招呼（同一对 90 秒内只打一次）
  greet() {
    const now = performance.now();
    const free = this.pets.filter((p) => p.ground && !p.activity && !p.emote && !p.leaving && !p.leaveAt && ['idle', 'walk', 'sit', 'look'].includes(p.mode));
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i];
        const b = free[j];
        if (a.ground.id !== b.ground.id || Math.abs(a.x - b.x) > (a.halfW + b.halfW) * 1.6) continue;
        const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
        if (now - (this.greeted[key] || -1e9) < 90000) continue;
        this.greeted[key] = now;
        a.facing = b.x > a.x ? 1 : -1;
        b.facing = -a.facing;
        for (const p of [a, b]) {
          p.setMode('idle', 1.6);
          p.doEmote('wave', 1.4);
        }
        a.say(tr('say.hi'), 1.4);
        setTimeout(() => b.say(tr('say.hi'), 1.4), 500);
        this.particles.push({ kind: 'heart', x: (a.x + b.x) / 2, y: a.y - a.height - 4, vx: 0, vy: -45, g: 0, life: 1.3, max: 1.3, size: a.Pd * 0.8, color: '#F25F7A' });
        return;
      }
    }
  },

  // 你离开电脑一会儿：没事干的都去睡；回来时叫醒，挥手欢迎
  onUserAway() {
    this.userAway = true;
    for (const p of this.pets) if (!p.activity && p.ground && p.mode !== 'sleep') p.setMode('yawn', 1.6);
  },

  onUserBack() {
    this.userAway = false;
    let greeted = false;
    for (const p of this.pets) {
      if (p.mode !== 'sleep' && p.mode !== 'yawn') continue;
      p.touch();
      p.doEmote('wave', 1.6);
      if (!greeted) p.say(tr('say.welcome'), 2);
      greeted = true;
    }
  },

  // ---------- 粒子 ----------
  confetti(pet) {
    const colors = ['#F25F5C', '#FFE066', '#70C1B3', '#4D9DE0', '#B388EB', '#FFFFFF'];
    for (let i = 0; i < 26; i++) {
      this.particles.push({
        kind: 'square', x: pet.x, y: pet.y - pet.height, vx: rand(-240, 240), vy: rand(-560, -260),
        g: 1100, life: rand(1, 1.6), max: 1.6, size: rand(0.6, 1) * pet.Pd, color: colors[i % colors.length],
      });
    }
  },
  heart(pet) {
    this.particles.push({ kind: 'heart', x: pet.x + rand(-6, 6), y: pet.y - pet.height - 6, vx: rand(-15, 15), vy: -50, g: 0, life: 1.1, max: 1.1, size: pet.Pd * 0.8, color: '#F25F7A' });
  },
  sparkles(pet) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.particles.push({ kind: 'star', x: pet.x, y: pet.y - pet.height / 2, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130 - 40, g: 200, life: 0.7, max: 0.7, size: pet.Pd * 0.6, color: '#FFD43B' });
    }
  },
  note(pet) {
    const x = pet.x + rand(-pet.halfW, pet.halfW);
    this.particles.push({ kind: 'note', x, y: pet.y - pet.height, vx: rand(-12, 12), vy: -40, g: 0, life: 1.4, max: 1.4, size: pet.Pd * 0.55, color: pick(['#D97757', '#5B9BD5', '#A98BD9']) });
  },
  snore(pet) {
    const x = pet.x + pet.facing * pet.halfW * 0.7;
    this.particles.push({ kind: 'z', x, y: pet.y - pet.height * 0.9, vx: pet.facing * 8, vy: -22, g: 0, life: 2.2, max: 2.2, size: pet.Pd * 0.6, color: '#3A3F58' });
  },
  // 嚼东西掉渣
  crumbs(pet) {
    for (let i = 0; i < 8; i++) {
      this.particles.push({ kind: 'square', x: pet.x + rand(-6, 6), y: pet.y - pet.height * 0.45, vx: rand(-90, 90), vy: rand(-200, -60), g: 900, life: rand(0.5, 0.9), max: 0.9, size: pet.Pd * 0.5, color: pick(['#F4F1EA', '#C9B8A3', '#FFE066']) });
    }
  },
  poof(x, y) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.particles.push({ kind: 'square', x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, g: 0, life: 0.45, max: 0.45, size: 4, color: '#D8D8D8' });
    }
  },
};

// ---------- 画布尺寸 ----------
function resize() {
  world.width = window.innerWidth;
  world.height = window.innerHeight;
  world.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(world.width * world.dpr);
  canvas.height = Math.round(world.height * world.dpr);
  canvas.style.width = world.width + 'px';
  canvas.style.height = world.height + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------- 气泡（Claude 风格：米白圆角、转圈的星星、字幕会折行和逐字出现） ----------
const BUBBLE = { bg: '#FBF8F3', alertBg: '#FFF4EC', greenBg: '#F1FAF3', border: '#E4D9C9', ink: '#2B2620', muted: '#857869', accent: '#D97757', green: '#3F9A5B' };
const UI_FONT = '"Segoe UI","Microsoft YaHei UI","Yu Gothic UI","PingFang SC",sans-serif';
const CJK = '\\u2e80-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f';
const TOKEN = new RegExp(`[${CJK}]|\\s+|[^\\s${CJK}]+`, 'g');
const wrapCache = new Map();

// 按当前字体折行：中日文按字断，英文按词断，超长的词（比如命令）按字符断；超出行数在末尾加省略号
function wrapLines(text, maxW, maxLines) {
  const key = `${ctx.font}|${maxW}|${maxLines}|${text}`;
  if (wrapCache.has(key)) return wrapCache.get(key);
  const lines = [];
  let line = '';
  for (const tok of text.match(TOKEN) || []) {
    if (/^\s+$/.test(tok)) {
      if (line) line += ' ';
      continue;
    }
    if (ctx.measureText(line + tok).width <= maxW) {
      line += tok;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = '';
    for (const ch of tok) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  let out = lines;
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines);
    let tail = out[maxLines - 1];
    while (tail && ctx.measureText(tail + '…').width > maxW) tail = tail.slice(0, -1);
    out[maxLines - 1] = tail + '…';
  }
  if (wrapCache.size > 200) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

// th < 0：尾巴画在上边、朝上指（气泡放在桌宠下面时）
function bubblePath(x, y, w, h, r, tx, tw, th) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (th < 0) {
    ctx.lineTo(tx - tw, y);
    ctx.lineTo(tx, y + th);
    ctx.lineTo(tx + tw, y);
  }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (th > 0) {
    ctx.lineTo(tx + tw, y + h);
    ctx.lineTo(tx, y + h + th);
    ctx.lineTo(tx - tw, y + h);
  }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawBubble(pet, v) {
  const dpr = world.dpr;
  const S = (n) => Math.round(n * dpr);
  const titleFont = `${v.important ? 700 : 600} ${S(13)}px ${UI_FONT}`;
  const subFont = v.code ? `${S(12)}px "Cascadia Mono",Consolas,"Microsoft YaHei UI",monospace` : `${S(12)}px ${UI_FONT}`;
  const metaFont = `${S(12)}px ${UI_FONT}`;
  const glyphFont = `${S(14)}px "Segoe UI Symbol","Segoe UI",sans-serif`;
  const padX = S(10);
  const padY = S(6);
  const lineH = S(19);
  const subH = S(17);
  const glow = v.alert || v.celebrate; // 举牌子时的气泡：橙色（等你决定）或绿色（做完了 / 日报）发光
  const accent = v.celebrate ? BUBBLE.green : BUBBLE.accent;
  const hintFont = `600 ${S(11)}px ${UI_FONT}`;
  const hintH = v.hint ? S(17) : 0;
  const maxW = S(glow ? 290 : 250);

  ctx.font = glyphFont;
  const spinW = v.spinner ? ctx.measureText(v.spinner).width + S(6) : 0;
  ctx.font = metaFont;
  const elapsedW = v.elapsed ? ctx.measureText(v.elapsed).width + S(8) : 0;
  ctx.font = titleFont;
  const titleLines = wrapLines(v.title, maxW - spinW - elapsedW, 2);
  let w = Math.max(...titleLines.map((l) => ctx.measureText(l).width)) + spinW + elapsedW;

  let sub = v.sub || '';
  if (sub && v.quote) sub = /^(zh|ja)/.test(I18N.lang()) ? `「${sub}」` : `“${sub}”`;
  ctx.font = subFont;
  const subLines = sub ? wrapLines(sub, maxW, v.subLines || 3) : [];
  for (const l of subLines) w = Math.max(w, ctx.measureText(l).width);
  if (v.hint) {
    ctx.font = hintFont;
    w = Math.max(w, ctx.measureText(`↩ ${v.hint}`).width);
  }
  // 一排按钮（在桌宠上批准：允许 / 拒绝 / 去终端）
  const btnFont = `600 ${S(12)}px ${UI_FONT}`;
  const btnH = S(24);
  const btnGap = S(6);
  let btnW = [];
  if (v.buttons) {
    ctx.font = btnFont;
    btnW = v.buttons.map(([, label]) => Math.ceil(ctx.measureText(label).width) + S(22));
    w = Math.max(w, btnW.reduce((a, b) => a + b, 0) + btnGap * (btnW.length - 1));
  }

  w = Math.ceil(w) + padX * 2;
  const btnRowH = v.buttons ? S(8) + btnH : 0;
  const h = padY * 2 + titleLines.length * lineH + (subLines.length ? S(2) + subLines.length * subH : 0) + hintH + btnRowH;
  const tailW = S(6);
  const tailH = S(7);
  // 气泡固定在头顶（举牌子时在牌子上方），不跟着蹦；举牌子原地跳时再往上让出跳的高度
  const a = pet.activity;
  const jumping = a && ((a.kind === 'alert' && a.urgent) || a.kind === 'done') ? 38 : 0;
  const head = pet.y - pet.height - pet.overhead() - jumping;
  // 带按钮的气泡不跟着左右晃，按钮才点得准
  const cx = Math.round((pet.x + (v.buttons ? 0 : pet.lastSway || 0)) * dpr);
  const x = clamp(Math.round(cx - w / 2), S(4), canvas.width - w - S(4));
  // 头顶放不下（站在贴着屏幕顶的窗口上）：放到脚下面，免得盖住举着的牌子
  const above = Math.round((head - 8) * dpr) - h - tailH;
  const below = above < S(4);
  const y = below ? Math.min(canvas.height - h - S(4), Math.round((pet.y + 6) * dpr) + tailH) : above;
  const tx = clamp(cx, x + S(9) + tailW, x + w - S(9) - tailW);
  // 气泡占的地方（DIP）：鼠标靠近带按钮的气泡时，桌宠停下来等你点
  pet.bubbleBox = v.buttons ? { l: x / dpr, t: y / dpr, r: (x + w) / dpr, b: (y + h) / dpr } : null;

  ctx.save();
  ctx.globalAlpha = v.alpha;
  // 底色和阴影；等你做决定时外圈一明一暗地发光
  const pulse = 0.45 + 0.35 * Math.sin(performance.now() / 150);
  ctx.shadowColor = v.alert ? `rgba(217,119,87,${pulse})` : v.celebrate ? `rgba(63,154,91,${pulse})` : 'rgba(60,40,20,0.22)';
  ctx.shadowBlur = S(glow ? 18 : 10);
  ctx.shadowOffsetY = glow ? 0 : S(2);
  ctx.fillStyle = v.alert ? BUBBLE.alertBg : v.celebrate ? BUBBLE.greenBg : BUBBLE.bg;
  bubblePath(x, y, w, h, S(9), tx, tailW, below ? -tailH : tailH);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = glow ? S(2) : Math.max(1, S(1));
  ctx.strokeStyle = glow ? accent : BUBBLE.border;
  ctx.stroke();

  // 第一行：转圈的星星 + 标题 + 用时
  ctx.textBaseline = 'middle';
  let ty = y + padY + lineH / 2;
  if (v.spinner) {
    ctx.font = glyphFont;
    ctx.fillStyle = BUBBLE.accent;
    ctx.fillText(v.spinner, x + padX, ty);
  }
  ctx.font = titleFont;
  ctx.fillStyle = v.alert ? '#B4532A' : v.celebrate ? '#2F7A47' : BUBBLE.ink;
  titleLines.forEach((l, i) => ctx.fillText(l, x + padX + spinW, ty + i * lineH));
  if (v.elapsed) {
    ctx.font = metaFont;
    ctx.fillStyle = BUBBLE.muted;
    ctx.fillText(v.elapsed, x + padX + spinW + ctx.measureText(' ').width + titleLines.reduce((m, l) => Math.max(m, measureWith(titleFont, l)), 0), ty);
  }

  // 字幕：打字机效果逐字出现
  ty = y + padY + titleLines.length * lineH + S(2) + subH / 2;
  ctx.font = subFont;
  ctx.fillStyle = v.code ? '#6B5B4E' : BUBBLE.muted;
  let left = v.shown == null ? Infinity : v.shown;
  for (const l of subLines) {
    if (left <= 0) break;
    const chars = Array.from(l);
    ctx.fillText(chars.slice(0, left).join(''), x + padX, ty);
    left -= chars.length;
    ty += subH;
  }

  // 最后一行小字提示：点我回到会话
  if (v.hint) {
    ctx.font = hintFont;
    ctx.fillStyle = accent;
    ctx.fillText(`↩ ${v.hint}`, x + padX, y + h - padY - btnRowH - hintH / 2);
  }

  // 按钮：记下位置（DIP），点击范围和主进程的穿透判断都要用
  pet.buttonRects = null;
  if (v.buttons) {
    pet.buttonRects = [];
    let bx = x + padX;
    const by = y + h - padY - btnH;
    ctx.font = btnFont;
    v.buttons.forEach(([key, label], i) => {
      const bw = btnW[i];
      const hot = world.hoverButton && world.hoverButton.pet === pet && world.hoverButton.key === key;
      const style = key === 'allow' ? { fill: hot ? '#4CAF6A' : BUBBLE.green, ink: '#FFFFFF', line: BUBBLE.green } : key === 'deny' ? { fill: hot ? '#FBE3DF' : '#FFFFFF', ink: '#B4372A', line: '#E3A69C' } : { fill: hot ? '#F1ECE4' : '#FFFFFF', ink: BUBBLE.ink, line: BUBBLE.border };
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, btnH, btnH / 2);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.lineWidth = Math.max(1, S(1));
      ctx.strokeStyle = style.line;
      ctx.stroke();
      ctx.fillStyle = style.ink;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + bw / 2, by + btnH / 2);
      ctx.textAlign = 'left';
      pet.buttonRects.push({ key, l: bx / dpr, t: by / dpr, r: (bx + bw) / dpr, b: (by + btnH) / dpr });
      bx += bw + btnGap;
    });
  }
  ctx.restore();
}

// 进度卡片：标题（项目 · 在干活 / 上一轮）+ 用时，待办清单，工具调用、改过的文件、最近一条命令
function drawCard(pet, v) {
  const dpr = world.dpr;
  const S = (n) => Math.round(n * dpr);
  const titleFont = `700 ${S(13)}px ${UI_FONT}`;
  const rowFont = `${S(12)}px ${UI_FONT}`;
  const metaFont = `${S(11.5)}px ${UI_FONT}`;
  const codeFont = `${S(11.5)}px "Cascadia Mono",Consolas,"Microsoft YaHei UI",monospace`;
  const iconFont = `700 ${S(12)}px "Segoe UI Symbol","Segoe UI",sans-serif`;
  const padX = S(12);
  const padY = S(9);
  const rowH = S(19);
  const w = S(300);
  const inner = w - padX * 2;
  const rows = v.todos.length ? v.todos : [{ text: tr('card.noTodos'), status: 'none' }];
  const extra = [v.stats, v.files, v.cmd ? `$ ${v.cmd}` : ''].filter(Boolean);
  const h = padY * 2 + S(20) + S(4) + rows.length * rowH + (v.more ? rowH : 0) + S(6) + extra.length * S(17);
  const tailW = S(6);
  const tailH = S(7);
  const head = pet.y - pet.height - pet.overhead();
  const cx = Math.round((pet.x + (pet.lastSway || 0)) * dpr);
  const x = clamp(Math.round(cx - w / 2), S(4), canvas.width - w - S(4));
  const above = Math.round((head - 8) * dpr) - h - tailH;
  const below = above < S(4);
  const y = below ? Math.min(canvas.height - h - S(4), Math.round((pet.y + 6) * dpr) + tailH) : above;
  const tx = clamp(cx, x + S(9) + tailW, x + w - S(9) - tailW);
  const fit = (text, font, maxW) => {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  };

  ctx.save();
  ctx.globalAlpha = v.alpha;
  ctx.shadowColor = 'rgba(60,40,20,0.25)';
  ctx.shadowBlur = S(12);
  ctx.shadowOffsetY = S(2);
  ctx.fillStyle = BUBBLE.bg;
  bubblePath(x, y, w, h, S(10), tx, tailW, below ? -tailH : tailH);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(1, S(1));
  ctx.strokeStyle = BUBBLE.border;
  ctx.stroke();
  ctx.textBaseline = 'middle';

  let ty = y + padY + S(10);
  ctx.font = metaFont;
  const elW = v.elapsed ? ctx.measureText(v.elapsed).width + S(8) : 0;
  ctx.fillStyle = BUBBLE.ink;
  ctx.fillText(fit(v.title, titleFont, inner - elW), x + padX, ty);
  if (v.elapsed) {
    ctx.font = metaFont;
    ctx.fillStyle = BUBBLE.muted;
    ctx.textAlign = 'right';
    ctx.fillText(v.elapsed, x + w - padX, ty);
    ctx.textAlign = 'left';
  }
  ty += S(10) + S(4) + rowH / 2;
  for (const t of rows) {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : t.status === 'none' ? '' : '○';
    ctx.font = iconFont;
    ctx.fillStyle = t.status === 'completed' ? BUBBLE.green : t.status === 'in_progress' ? BUBBLE.accent : BUBBLE.muted;
    if (icon) ctx.fillText(icon, x + padX, ty);
    const font = t.status === 'in_progress' ? `600 ${S(12)}px ${UI_FONT}` : rowFont;
    ctx.fillStyle = t.status === 'completed' || t.status === 'none' ? BUBBLE.muted : BUBBLE.ink;
    const label = fit(t.text, font, inner - S(18));
    ctx.fillText(label, x + padX + S(18), ty);
    if (t.status === 'completed') {
      // 做完的划一道线
      const lw = ctx.measureText(label).width;
      ctx.fillRect(x + padX + S(18), Math.round(ty), lw, Math.max(1, S(1)));
    }
    ty += rowH;
  }
  if (v.more) {
    ctx.font = metaFont;
    ctx.fillStyle = BUBBLE.muted;
    ctx.fillText(tr('card.more', { n: v.more }), x + padX + S(18), ty);
    ty += rowH;
  }
  ty += S(6) - rowH / 2 + S(17) / 2;
  extra.forEach((line, i) => {
    const font = i === 0 ? metaFont : codeFont;
    ctx.fillStyle = i === 0 ? BUBBLE.muted : '#6B5B4E';
    ctx.fillText(fit(line, font, inner), x + padX, ty);
    ty += S(17);
  });
  ctx.restore();
  pet.buttonRects = null;
}

function measureWith(font, text) {
  const prev = ctx.font;
  ctx.font = font;
  const wpx = ctx.measureText(text).width;
  ctx.font = prev;
  return wpx;
}

// ---------- 绘制 ----------
let hoverPet = null;

// 每段"被窗口带着走"的统计：收到位置更新和重画的次数、最长间隔，用来判断卡在哪一环
let ride = null;
function noteRideUpdate() {
  const now = performance.now();
  if (!ride || now > world.ridingUntil) {
    ride = { ms: 0, updates: 0, renders: 0, maxUpdateGapMs: 0, maxRenderGapMs: 0, t0: now };
    stats.rides.push(ride);
    if (stats.rides.length > 8) stats.rides.shift();
  } else {
    ride.maxUpdateGapMs = Math.max(ride.maxUpdateGapMs, Math.round(now - ride.lastUpdate));
  }
  ride.lastUpdate = now;
  ride.updates++;
  ride.ms = Math.round(now - ride.t0);
}

function render(poses, views) {
  stats.renders++;
  if (ride && performance.now() < world.ridingUntil) {
    const now = performance.now();
    if (ride.lastRender) ride.maxRenderGapMs = Math.max(ride.maxRenderGapMs, Math.round(now - ride.lastRender));
    ride.lastRender = now;
    ride.renders++;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!host) drawPreviewWindows();
  const dpr = world.dpr;

  for (const pet of drawOrder()) pet.draw(ctx, poses.get(pet));
  world.games.draw(ctx);
  world.teaser.draw(ctx);

  for (const q of world.particles) {
    ctx.globalAlpha = clamp((q.life / q.max) * 2, 0, 1);
    const s = Math.max(1, Math.round(q.size * dpr));
    if (q.kind === 'square') {
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x * dpr), Math.round(q.y * dpr), s, s);
    } else {
      drawGlyph(ctx, q.kind, q.x * dpr, q.y * dpr, s, q.color, q.outline || '#FFFFFF');
    }
  }
  ctx.globalAlpha = 1;

  for (const pet of world.pets) {
    const v = views.get(pet);
    if (!v) pet.buttonRects = pet.bubbleBox = null;
    else if (v.card) drawCard(pet, v);
    else drawBubble(pet, v);
  }
}

// 叠罗汉时上面的画在下面的后面
function drawOrder() {
  const depth = (p) => {
    let n = 0;
    for (let m = p.mount; m && n < 6; m = m.mount) n++;
    return n;
  };
  return world.pets.slice().sort((a, b) => depth(a) - depth(b));
}

// ---------- 主循环 ----------
// Windows 上透明窗口每画一帧都要整屏回读再提交，代价不小，所以只在画面真的变了才重画：
// 待着不动时只有眨眼、呼吸才画；走路限 20 帧；被拖着、在空中、有粒子、举牌子跳时 60 帧
//（高刷屏上 requestAnimationFrame 可能是 144/240Hz，不能每次都画）。
let last = performance.now();
let lastDraw = 0;
let lastSig = '';
let lastMouse = null;
let greetTimer = 0;
let timeTimer = 5;
let seasonTimer = 20;

function signature(poses, views) {
  const dpr = world.dpr;
  let s = world.hoverButton ? `${world.hoverButton.pet.id}:${world.hoverButton.key};` : '';
  for (const p of world.pets) {
    const { t, ...q } = poses.get(p);
    q.hop = Math.round(q.hop * dpr);
    q.sway = Math.round(q.sway * dpr);
    const anim = q.props.length || p.minis.length ? Math.floor(p.t * 12) : 0;
    const v = views.get(p);
    s += `${Math.round(p.x * dpr)},${Math.round(p.y * dpr)},${p.P},${anim},${JSON.stringify(q)},${v ? JSON.stringify({ ...v, alpha: Math.round(v.alpha * 10) }) : ''};`;
  }
  return s;
}

function frame(now) {
  stats.ticks++;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const pet of world.pets.slice()) pet.update(dt);
  for (const q of world.particles) {
    q.vy += q.g * dt;
    q.x += q.vx * dt + (q.sway ? Math.sin(q.life * 2.6 + q.phase) * q.sway * dt : 0); // 飘落的叶子、雪花左右晃
    q.y += q.vy * dt;
    q.life -= dt;
  }
  world.particles = world.particles.filter((q) => q.life > 0);

  const poses = new Map(world.pets.map((p) => [p, p.pose()]));
  for (const [p, q] of poses) p.notePose(q);
  syncHitboxes();

  // 鼠标指着哪只（悬停气泡、被蹭）；要不要穿透由主进程按点击范围决定
  if (!drag) hoverPet = world.mouse ? petAt(world.mouse.x, world.mouse.y) : null;
  // 用鼠标在它身上来回蹭：害羞冒爱心
  if (hoverPet && !drag && world.mouse && lastMouse) {
    const d = Math.hypot(world.mouse.x - lastMouse.x, world.mouse.y - lastMouse.y);
    hoverPet.rub = (hoverPet.rub || 0) * Math.pow(0.4, dt) + d;
    if (hoverPet.rub > 600 && now - (hoverPet.pettedAt || 0) > 2500) {
      hoverPet.pettedAt = now;
      hoverPet.rub = 0;
      hoverPet.onPetted();
    }
  }
  lastMouse = world.mouse;
  // 按住不放：被按扁
  if (drag && !drag.button && !drag.moved && now - drag.at > 180) drag.pet.pressed = true;
  world.hoverButton = world.mouse ? buttonAt(world.mouse.x, world.mouse.y) : null;
  world.teaser.update(dt);
  if ((timeTimer -= dt) <= 0) {
    timeTimer = 30;
    world.timeTick();
  }
  if ((seasonTimer -= dt) <= 0) {
    seasonTimer = rand(45, 90);
    world.seasonTick();
  }

  if ((greetTimer -= dt) <= 0) {
    greetTimer = 1;
    world.greet();
  }
  world.games.tick(dt);
  if (world.tour) world.tour.update(dt);

  const views = new Map(world.pets.map((p) => [p, drag && drag.pet === p ? null : p.bubbleView(p === hoverPet)]));
  // 举着牌子的气泡在发光、或者正举着牌子蹦：按 60 帧画
  const glowing = [...views.values()].some((v) => v && (v.alert || v.celebrate));
  const dancing = world.music && world.pets.some((p) => p.mode === 'dance' || p.activity);
  const fast = glowing || dancing || world.teaser.on || !!world.games.current || world.particles.length > 0 || world.pets.some((p) => !p.ground || p.mode === 'drag' || (p.activity && p.activity.kind === 'alert' && p.activity.urgent));
  const walking = world.pets.some((p) => p.mode === 'walk' || p.mode === 'run');
  const riding = now < world.ridingUntil;
  // 被拖着、被扔在半空：跟着屏幕刷新率每帧都画（高刷屏上限 60 帧会一跳一跳的），画一帧不到 1ms
  const flying = world.pets.some((p) => p.mode === 'drag' || !p.ground);
  if (now - lastDraw >= (riding || flying ? 0 : fast ? 15 : walking ? 50 : 33)) {
    const sig = fast ? '' : signature(poses, views);
    if (fast || sig !== lastSig) {
      lastSig = sig;
      lastDraw = now;
      render(poses, views);
    }
  }
  requestAnimationFrame(frame);
}

// ---------- 鼠标：平时穿透，指到桌宠身上才接管 ----------
// 主进程拿着这里发过去的点击范围，在读到光标的同一刻决定要不要穿透（见 main.js 的 updateMouseCapture）。
// 范围四周多留一点余量，鼠标稍微点偏一点也能抓住它
const HIT_MARGIN = 6;
let drag = null;
let lastHitboxes = '';

function syncHitboxes() {
  if (!host) return;
  const boxes = world.pets.map((p) => {
    const b = p.hitBox(HIT_MARGIN);
    return { l: Math.floor(b.l), t: Math.floor(b.t), r: Math.ceil(b.r), b: Math.ceil(b.b) };
  });
  for (const p of world.pets) for (const r of p.buttonRects || []) boxes.push({ l: Math.floor(r.l) - 2, t: Math.floor(r.t) - 2, r: Math.ceil(r.r) + 2, b: Math.ceil(r.b) + 2 });
  const key = JSON.stringify(boxes);
  if (key === lastHitboxes) return;
  lastHitboxes = key;
  host.setHitboxes(boxes);
}

function petAt(x, y, margin = HIT_MARGIN) {
  const order = drawOrder();
  for (let i = order.length - 1; i >= 0; i--) if (order[i].hitTest(x, y, margin)) return order[i];
  return null;
}

// 鼠标位置有两个来源：主进程轮询光标发过来（'cursor'），以及不穿透时页面自己收到的 mousemove。
// 这里只记位置，指着哪只由主循环每帧判断一次
window.addEventListener('mousemove', (e) => {
  stats.mouseMoves++;
  world.mouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseleave', () => {
  world.mouse = null;
  if (!drag) hoverPet = null;
});

// ---------- 按下 / 拖动 / 松开 ----------
// 在 Electron 里由主进程读系统按键状态来驱动（'press' / 'press-move' / 'press-end'），
// 不依赖页面收到鼠标事件；浏览器预览里没有主进程，用页面自己的 pointer 事件。两条路走同一套逻辑。
let lastClick = { pet: null, at: 0 };

// 气泡里的按钮
function buttonAt(x, y) {
  for (const pet of world.pets) {
    for (const r of pet.buttonRects || []) if (x >= r.l && x <= r.r && y >= r.t && y <= r.b) return { pet, key: r.key };
  }
  return null;
}

function pressStart(x, y, t) {
  const btn = buttonAt(x, y);
  if (btn) {
    logInput('press-button', { clientX: x, clientY: y }, { pet: btn.pet.id, key: btn.key });
    drag = { button: btn, pet: btn.pet, sx: x, sy: y, ox: 0, oy: 0, moved: false, hist: [], t0: t, at: performance.now() };
    return true;
  }
  const pet = petAt(x, y);
  logInput('press', { clientX: x, clientY: y }, { pet: pet ? pet.id : null });
  if (!pet) return false;
  // t0 用事件自带的时间（主进程的时钟）算按了多久；at 用页面自己的时钟，给每帧的"按扁"判断用
  drag = { pet, sx: x, sy: y, ox: pet.x - x, oy: pet.y - y, moved: false, hist: [], t0: t, at: performance.now() };
  return true;
}

function pressMove(x, y, t) {
  if (!drag || drag.button) return;
  const { pet } = drag;
  if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 4) {
    logInput('drag-start', { clientX: x, clientY: y });
    if (pet.game) world.games.abort(pet.game);
    pet.mount = null;
    drag.moved = true;
    pet.pressed = false;
    pet.touch();
    pet.ground = null;
    pet.climb = null;
    pet.mode = 'drag';
    pet.leaving = false; // 被抓住了就不走了
    pet.leaveAt = 0;
    pet.layerId = null; // 被拎起来以后算在最前面，扔出去会撞到所有看得见的窗口
  }
  if (!drag.moved) return;
  // 有隔壁屏的那一边可以拖出去（光标过了屏幕边，主进程会把它交给那块屏）
  const lo = world.exits.left.length ? -pet.halfW : pet.halfW;
  const hi = world.exits.right.length ? world.width + pet.halfW : world.width - pet.halfW;
  pet.x = clamp(x + drag.ox, lo, hi);
  pet.y = clamp(y + drag.oy, pet.height, world.height);
  drag.hist.push({ x: pet.x, y: pet.y, t });
  if (drag.hist.length > 6) drag.hist.shift();
}

function pressEnd(x, y, t) {
  if (!drag) return;
  if (drag.button) {
    // 在同一个按钮上按下又松开才算点了
    const b = buttonAt(x, y);
    if (b && b.pet === drag.button.pet && b.key === drag.button.key) b.pet.decide(b.key);
    drag = null;
    return;
  }
  logInput('press-end', { clientX: x, clientY: y }, { moved: drag.moved });
  const { pet } = drag;
  const held = t - drag.t0;
  pet.pressed = false;
  if (drag.moved) {
    // 扔出去：用最后几个位置算速度
    const h = drag.hist;
    const a = h[0];
    const b = h[h.length - 1];
    const dt = a && b && b.t > a.t ? (b.t - a.t) / 1000 : 0;
    const vx = dt ? (b.x - a.x) / dt : 0;
    const vy = dt ? (b.y - a.y) / dt : 0;
    const k = Math.min(1, 2400 / (Math.hypot(vx, vy) || 1));
    pet.mode = 'air';
    pet.vx = vx * k;
    pet.vy = vy * k;
    // 被放到窗口里面了：先不和这些窗口碰撞，免得被弹飞
    pet.inside.clear();
    for (const s of world.solids) if (world.overlaps(pet.bodyBox(), s)) pet.inside.add(s.id);
  } else if (held > 450) {
    pet.onBoing();
  } else if (lastClick.pet === pet && t - lastClick.at < 380) {
    pet.onDoubleClick();
    lastClick = { pet: null, at: 0 };
  } else {
    pet.onClick(x, y);
    lastClick = { pet, at: t };
  }
  drag = null;
  hoverPet = petAt(x, y);
}

function openMenuAt(x, y) {
  const pet = petAt(x, y);
  if (host) host.openMenu(pet ? pet.info() : null);
}

if (host) {
  host.on('press', (p) => {
    world.mouse = { x: p.x, y: p.y };
    pressStart(p.x, p.y, p.t);
  });
  host.on('press-move', (p) => pressMove(p.x, p.y, p.t));
  host.on('press-end', (p) => pressEnd(p.x, p.y, p.t));
  host.on('menu-at', (p) => openMenuAt(p.x, p.y));
} else {
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !pressStart(e.clientX, e.clientY, performance.now())) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });
  canvas.addEventListener('pointermove', (e) => pressMove(e.clientX, e.clientY, performance.now()));
  canvas.addEventListener('pointerup', (e) => pressEnd(e.clientX, e.clientY, performance.now()));
  canvas.addEventListener('pointercancel', (e) => pressEnd(e.clientX, e.clientY, performance.now()));
}

window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 喂文件：从资源管理器把文件拖到它身上 ----------
// 主进程在你拖着东西经过桌宠时关掉穿透，这里才收得到拖放事件。别的地方松手也要拦住，不然覆盖层会去"打开"那个文件。
const FEED_MARGIN = 16;
let feedTarget = null;

function setFeedTarget(pet, e) {
  if (pet === feedTarget) return;
  // 拖着东西进出桌宠都记下来（/state 里能看到），排查"拖上去没反应"是卡在哪一步
  if (e) logInput(pet ? 'drag-over-pet' : 'drag-off-pet', e, { pet: pet ? pet.id : feedTarget && feedTarget.id });
  if (feedTarget) feedTarget.noteFeedHover(false);
  feedTarget = pet;
  if (pet) pet.noteFeedHover(true);
}

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  const pet = world.feedOn && e.dataTransfer.types.includes('Files') ? petAt(e.clientX, e.clientY, HIT_MARGIN + FEED_MARGIN) : null;
  // "复制"而不是"移动"：告诉资源管理器别动原文件，挪文件由主进程自己来
  e.dataTransfer.dropEffect = pet ? 'copy' : 'none';
  setFeedTarget(pet, e);
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) setFeedTarget(null, e);
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const pet = feedTarget || petAt(e.clientX, e.clientY, HIT_MARGIN + FEED_MARGIN);
  setFeedTarget(null);
  // FileList 过不了 contextBridge，要先变成普通数组
  const files = [...e.dataTransfer.files];
  logInput('drop', e, { pet: pet ? pet.id : null, files: files.length });
  if (!pet || !host || !world.feedOn || !files.length) return;
  pet.startEating();
  try {
    const r = await host.feed(files);
    logInput('fed', e, { eaten: r && r.eaten, skipped: r && r.skipped && r.skipped.map((x) => x.reason).join(',') });
    pet.onFed(r);
  } catch (err) {
    logInput('feed-error', e, { error: String(err && err.message) });
    pet.onFed({ eaten: 0, names: [], skipped: [{ reason: 'failed' }] });
  }
});

// ---------- 演示：把每种反应都走一遍 ----------
let demoTimers = [];
function runDemo() {
  demoTimers.forEach(clearTimeout);
  const sid = 'demo-' + Date.now();
  const e = (event, extra = {}) => ({ event, sessionId: sid, project: 'claude-pet', ...extra });
  const steps = [
    [0, e('SessionStart', { model: 'claude-opus-5-5' })],
    [1800, e('UserPromptSubmit', { text: tr('demo.prompt') })],
    [5200, e('PreToolUse', { tool: 'Read', toolKind: 'read', detail: 'main.js' })],
    [7400, e('PreToolUse', { tool: 'TodoWrite', toolKind: 'other', detail: 'TodoWrite', todo: tr('demo.todo') })],
    [8400, e('PreToolUse', { tool: 'Edit', toolKind: 'edit', detail: 'settings.js' })],
    [11000, e('PreToolUse', { tool: 'WebSearch', toolKind: 'web', detail: tr('demo.search') })],
    [13400, e('PreToolUse', { tool: 'Agent', toolKind: 'agent', detail: tr('demo.agent') })],
    [13600, e('SubagentStart', { agentId: 'a1', agentType: 'Explore' })],
    [14400, e('SubagentStart', { agentId: 'a2', agentType: 'Plan' })],
    [17400, e('SubagentStop', { agentId: 'a1' })],
    [18200, e('SubagentStop', { agentId: 'a2' })],
    [19200, e('PreToolUse', { tool: 'Bash', toolKind: 'shell', detail: 'npm test' })],
    [22000, e('PostToolUse', { tool: 'Bash', toolKind: 'shell', test: 'fail' })],
    [24600, e('PermissionRequest', { tool: 'Bash', toolKind: 'shell', detail: 'npm test -- --update-snapshots' })],
    [32000, e('PreToolUse', { tool: 'Bash', toolKind: 'shell', detail: 'npm test -- --update-snapshots' })],
    [34400, e('PostToolUse', { tool: 'Bash', toolKind: 'shell', test: 'pass' })],
    [37000, e('PreToolUse', { tool: 'AskUserQuestion', toolKind: 'other', decision: 'question', text: tr('demo.question') })],
    [44000, e('PostToolUse', { tool: 'AskUserQuestion', toolKind: 'other' })],
    [45000, e('Stop', { text: tr('demo.summary') })],
    [53000, e('SessionEnd', { reason: 'other' })],
  ];
  demoTimers = steps.map(([ms, ev]) => setTimeout(() => world.onClaudeEvent(ev), ms));
}

// ---------- 浏览器预览：画两个假窗口当地形 ----------
const previewWindows = [
  { id: 1, l: 120, t: 260, r: 560, b: 520, title: 'Terminal' },
  { id: 2, l: 420, t: 400, r: 900, b: 640, title: 'Editor' },
];
function drawPreviewWindows() {
  const dpr = world.dpr;
  for (const w of [...previewWindows].reverse()) {
    ctx.fillStyle = '#ECEEF2';
    ctx.fillRect(w.l * dpr, w.t * dpr, (w.r - w.l) * dpr, (w.b - w.t) * dpr);
    ctx.fillStyle = '#C8CCD4';
    ctx.fillRect(w.l * dpr, w.t * dpr, (w.r - w.l) * dpr, 28 * dpr);
    ctx.fillStyle = '#444';
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(w.title, (w.l + 10) * dpr, (w.t + 14) * dpr);
  }
}
function previewPlatforms() {
  const plats = [];
  previewWindows.forEach((w, i) => {
    let segs = [[w.l, w.r]];
    for (let j = 0; j < i; j++) {
      const v = previewWindows[j];
      if (v.t <= w.t && v.b > w.t) segs = segs.flatMap(([a, b]) => (v.r <= a || v.l >= b ? [[a, b]] : [[a, v.l], [v.r, b]].filter(([c, d]) => d - c > 0)));
    }
    segs.forEach(([a, b]) => plats.push({ id: w.id, x1: a, x2: b, y: w.t, wx: w.l }));
  });
  return plats;
}

// ---------- 启动 ----------
if (host) {
  host.on('platforms', ({ platforms, windows }) => world.setPlatforms(platforms, windows));
  host.on('cursor', (c) => {
    if (!drag) world.mouse = c;
  });
  host.on('claude-event', (ev) => world.onClaudeEvent(ev));
  host.on('config', (c) => {
    world.timeOfDay = c.timeOfDay !== false;
    world.outfitChosen = c.outfit || {};
    world.holidays = c.holidays !== false;
    world.feedOn = c.feed !== false;
    world.refreshOutfit();
    world.scale = c.scale || 5;
    world.bubbles = c.bubbles || 'full';
    world.collide = c.collide !== false;
    world.soundOn = c.sound !== false;
    if (!world.collide) for (const p of world.pets) p.inside.clear();
    if (c.locale) I18N.setLang(c.locale);
    world.setHomeColor(c.color || 0);
  });
  host.on('pet-command', (data) => {
    const { id, cmd } = data;
    const pet = world.pets.find((p) => p.id === id) || (cmd === 'spit' ? world.messenger() : null);
    if (!pet) return;
    if (cmd === 'sleep') {
      pet.clearActivity();
      pet.setMode('yawn', 1.6);
    } else if (cmd === 'friend') {
      if (!world.games.inviteFriend(pet)) pet.say(tr('game.full'), 1.6);
    } else if (cmd === 'friends-home') {
      world.games.sendAllHome();
    } else if (cmd === 'teaser') {
      world.teaser.start(pet);
    } else if (cmd === 'teaser-off') {
      world.teaser.stop();
    } else if (cmd === 'spit') {
      pet.onSpit(data.restored, data.kept);
    } else if (cmd === 'skip-tour') {
      if (world.tour) world.tour.end();
    } else {
      pet.touch();
      pet.doEmote('wave', 1.2);
    }
  });
  // 叫到你正看着的那块屏中间：别的屏上的都转移过去
  host.on('summon', ({ to, here }) => {
    if (here) world.summon();
    else for (const p of world.pets.slice()) world.transfer(p, to, { summon: true });
  });
  host.on('layout', ({ id, home, exits }) => {
    world.displayId = id;
    world.home = home;
    world.exits = exits || { left: [], right: [] };
    if (home && !world.spawned) {
      world.spawned = true;
      if (!world.pets.length) world.spawnPet(world.width * 0.62);
    }
  });
  host.on('spawn', () => {
    if (!world.pets.length) world.spawnPet();
  });
  host.on('import-pet', ({ pet, drag: d, summon }) => world.importPet(pet, d, summon));
  // 显示器拔掉了：全部转移到主屏
  host.on('evacuate', ({ to }) => {
    for (const p of world.pets.slice()) world.transfer(p, to, { summon: true });
  });
  // 拖着桌宠过了屏幕边：交给光标所在的那块屏
  host.on('drag-transfer', ({ to }) => {
    if (!drag) return;
    const d = { ox: drag.ox, oy: drag.oy, t0: drag.t0 };
    const { pet } = drag;
    drag = null;
    pet.pressed = false;
    world.transfer(pet, to, { drag: d });
  });
  host.on('achievement', ({ ids, items, sessionId }) => world.messenger(sessionId).celebrateUnlock(ids, items));
  host.on('hungry', ({ count }) => {
    const pet = world.pets.find((p) => !p.activity && !p.leaving && !p.leaveAt && !p.visitor && !p.game);
    if (pet) pet.hungry(count);
  });
  host.on('update-ready', ({ version }) => world.messenger().say(tr('say.updateReady', { version }), 6, false, { sub: tr('say.updateSub') }));
  host.on('tour', ({ connected }) => {
    if (world.tour) return;
    world.tour = new Tour(world, connected);
    world.tour.start();
  });
  host.on('demo', runDemo);
  host.on('user-away', () => world.onUserAway());
  host.on('user-back', () => world.onUserBack());
  host.on('report-ready', () => world.onReportReady());
  // 在桌宠身上批准
  host.on('permission-ask', (msg) => {
    const pet = world.pets.find((p) => p.sessionId === msg.sessionId && !p.leaving) || world.petForSession({ sessionId: msg.sessionId, project: '' });
    pet.askPermission(msg);
  });
  host.on('permission-done', (msg) => {
    for (const p of world.pets) p.permissionDone(msg);
  });
  // 番茄钟、便签
  host.on('pomodoro', (state) => (world.pomodoro = state));
  host.on('notes', (list) => (world.notes = Array.isArray(list) ? list : []));
  host.on('pomodoro-ring', ({ phase, petId, minutes }) => {
    const pet = world.pets.find((p) => p.id === petId && !p.leaving) || world.messenger();
    if (phase === 'focus') pet.ring(tr('pomo.breakTitle', { m: minutes }), tr('pomo.breakSub'), 'tomato');
    else pet.ring(tr('pomo.backTitle'), tr('pomo.backSub'), 'tomato');
  });
  host.on('note-ring', ({ id, text }) => world.messenger().ring(tr('note.ringTitle'), text, 'note', { noteId: id }));
  // 放歌就跳舞：开始放的时候闲着的都跳起来，停了就不跳了
  host.on('music', ({ playing }) => {
    world.music = !!playing;
    for (const p of world.pets) {
      if (playing && world.games.isFree(p) && p.mode !== 'busy') p.setMode('dance', rand(4, 8));
      else if (!playing && p.mode === 'dance') p.setMode('idle', rand(0.5, 1.5));
    }
  });
  host.on('beat', () => {
    const now = performance.now();
    for (const p of world.pets) p.beatAt = now;
    const dancer = world.pets.filter((p) => p.mode === 'dance');
    if (dancer.length && Math.random() < 0.35) world.note(pick(dancer));
  });
  world.refreshOutfit();
  host.ready();
} else {
  document.body.classList.add('preview');
  I18N.setLang(I18N.detect(navigator.languages));
  world.setPlatforms(previewPlatforms(), previewWindows);
  if (location.search.includes('demo')) setTimeout(runDemo, 800);
}

games.world = world;
world.games = games;
teaser.world = world;
world.teaser = teaser;
if (!host) world.spawnPet(world.width * 0.62);
setInterval(() => {
  world.tidy();
  world.refreshOutfit(); // 过了零点可能换了节日
}, 10000);
requestAnimationFrame(frame);
