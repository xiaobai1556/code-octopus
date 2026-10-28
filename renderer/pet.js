// 一只桌宠：物理（重力、站在窗口上、被扔出去、和窗口碰撞）、自由活动、对 Claude Code 事件的反应、姿势。
// 坐标单位是覆盖层窗口内的 DIP，y 是脚底。

const GRAVITY = 2200;
const MAX_FALL = 1800;
const WALK_SPEED = 42;
const RUN_SPEED = 260;
const SLEEP_AFTER = 4 * 60 * 1000;
const BUSY_TIMEOUT = 3 * 60 * 1000;
const MAX_MINIS = 6;
const ALERT_JUMP = 0.62; // 等你做决定时，跑到中间后每跳一下的时长（秒）
const DONE_TTL = 3 * 60 * 1000; // 长任务做完举着 ✓ 等你最多 3 分钟
const REPORT_TTL = 30 * 60 * 1000;
const FAT_AT = [0.5, 0.8]; // 上下文用到一半开始发福，用到八成撑得圆滚滚
const BODY = 0.75; // 碰撞用的身体宽度（占精灵宽度的比例，两边的小手不算）

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const tr = (key, vars) => I18N.t(key, vars);

// 手上的家伙：拿出来、收起来各要多久（秒）
const TOOLS = ['laptop', 'magnifier', 'antenna'];
const TOOL_IN = { laptop: 0.6, magnifier: 0.3, antenna: 0.35 };
const TOOL_OUT = { laptop: 0.45, magnifier: 0.2, antenna: 0.25 };

// Claude Code 风格的转圈小星星
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

// 用时：12 秒 / 4 分 12 秒 / 1 小时 5 分
function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return tr('time.s', { s });
  if (s < 3600) return tr('time.ms', { m: Math.floor(s / 60), s: s % 60 });
  return tr('time.hm', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}

// 简洁模式下的一句话气泡
function toolLine(ev) {
  const d = ev.detail || ev.tool || '';
  if (ev.tool === 'Grep' || ev.tool === 'Glob') return tr('tool.find', { d });
  if (['shell', 'edit', 'read', 'web', 'agent'].includes(ev.toolKind)) return tr(`tool.${ev.toolKind}`, { d });
  return d;
}

// 每块屏的覆盖层各自从不同的数开始编号（主进程在地址里给），桌宠转移到别的屏以后编号不会撞
const PET_ID_BASE = Number(new URLSearchParams(location.search).get('base')) || 0;
let petSeq = 0;
const ago = (t, now) => (t ? now - t : null);

class Pet {
  constructor(world, x, y, palette) {
    this.world = world;
    this.id = PET_ID_BASE + ++petSeq;
    this.palette = palette;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.ground = null; // { id, wx, y }：站着的平台；null 表示在空中
    this.mode = 'air'; // idle walk crouch sleep yawn sit stretch look dance busy run air drag
    this.modeT = 0;
    this.edgePolicy = 'turn';
    this.walkDist = 0;
    this.jumpTarget = null;
    this.climb = null; // 先竖直往上跳，到最高点再横着落到目标上
    this.t = Math.random() * 10;
    this.blink = 0;
    this.nextBlink = rand(1.5, 4);
    this.squash = 0;
    this.shoved = 0; // 被窗口推开的慌张时间
    this.pressed = false; // 被鼠标按住
    this.zTimer = 0;
    this.fxTimer = 0;
    this.inside = new Set(); // 已经和它重叠的窗口（比如窗口直接盖在它身上），不参与碰撞
    // 它所在的"层"：最近站过的窗口。只和这个窗口以及在它前面的窗口碰撞，后面的窗口当背景；
    // null 表示在桌面地面上（或者刚被扔出去），所有看得见的窗口都算
    this.layerId = null;

    this.sessionId = null;
    this.project = '';
    this.lastEvent = 0;
    this.lastActive = performance.now();
    this.activity = null; // { kind, since, title, sub, code } 或提醒 { kind:'alert', sign, urgent, text, sub, tool, goto }
    this.emote = null; // { kind, t, dur }
    this.bubble = null; // { text, sub, code, quote, typed, t, dur, important }
    this.context = null; // { used, limit }：会话的上下文占用
    this.fat = 0; // 饱腹度 0/1/2
    this.canJump = false; // 知不知道这个会话在哪个窗口（点它能不能跳回去）
    this.verb = ''; // 这一轮思考用的动词（思考中 / 琢磨中 / …）
    this.todo = ''; // 当前进行中的待办
    this.turnStart = 0;
    this.minis = []; // 子代理小助手 { id, born, dying }
    this.leaving = false;
    this.leaveAt = 0; // 到这个时间（performance.now）就开始离开
    this.exitDir = 1;
    this.visitor = false; // 叫来一起玩的小伙伴：玩完就走
    this.ownOutfit = null; // 小伙伴有自己的打扮；其他的穿设置里选的
    this.game = null; // 正在和别的小章鱼玩（见 games.js）
    this.mount = null; // 叠罗汉时站在哪只头上
    this.feedHover = 0; // 有文件拖到它身上：张大嘴等着
    this.progress = null; // 这一轮的进度（待办、工具调用、改过的文件），点它弹出进度卡片
    this.cardUntil = 0;
    this.ask = null; // 等你在它身上批准的权限请求 { id, tool, detail }
    this.pokes = []; // 最近几次被戳的时间，一直戳会烦
    this.beatAt = 0; // 放歌时最近一个节拍
    this.tired = 0; // 追逗猫棒跳了几次
  }

  // ---------- 转移到别的屏幕 ----------
  // 时间都换成"多久以前"，因为每个覆盖层的 performance.now() 起点不一样
  serialize() {
    const now = performance.now();
    const a = this.activity;
    const b = this.bubble;
    return {
      id: this.id, palette: PALETTES.indexOf(this.palette), x: this.x, y: this.y, vx: this.vx, vy: this.vy, facing: this.facing,
      mode: this.mode === 'drag' ? 'air' : this.mode, modeT: this.modeT, edgePolicy: this.edgePolicy, ground: this.ground && { ...this.ground }, layerId: this.layerId,
      climb: this.climb && { ...this.climb }, t: this.t, sessionId: this.sessionId, project: this.project,
      lastEventAgo: ago(this.lastEvent, now), lastActiveAgo: ago(this.lastActive, now),
      activity: a && { ...a, since: undefined, sinceAgo: now - a.since },
      emote: this.emote, bubble: b && { ...b, dur: b.dur === Infinity ? -1 : b.dur },
      context: this.context, fat: this.fat, canJump: this.canJump, verb: this.verb, todo: this.todo, turnStartAgo: ago(this.turnStart, now),
      minis: this.minis, leaveIn: this.leaveAt ? this.leaveAt - now : null, exitDir: this.exitDir, visitor: this.visitor, ownOutfit: this.ownOutfit,
      stayIn: this.stayUntil ? this.stayUntil - now : null,
      progress: this.progress, ask: this.ask,
    };
  }

  static fromData(world, d) {
    const now = performance.now();
    const pet = new Pet(world, d.x, d.y, PALETTES[d.palette] || PALETTES[0]);
    pet.id = d.id;
    const keep = ['vx', 'vy', 'facing', 'mode', 'modeT', 'edgePolicy', 'ground', 'layerId', 'climb', 't', 'sessionId', 'project', 'emote', 'context', 'fat', 'canJump', 'verb', 'todo', 'minis', 'exitDir', 'visitor', 'ownOutfit', 'progress', 'ask'];
    for (const k of keep) if (d[k] !== undefined) pet[k] = d[k];
    if (d.bubble) pet.bubble = { ...d.bubble, dur: d.bubble.dur === -1 ? Infinity : d.bubble.dur };
    pet.lastEvent = d.lastEventAgo == null ? 0 : now - d.lastEventAgo;
    pet.lastActive = d.lastActiveAgo == null ? now : now - d.lastActiveAgo;
    pet.turnStart = d.turnStartAgo == null ? 0 : now - d.turnStartAgo;
    if (d.activity) {
      const { sinceAgo, ...rest } = d.activity;
      pet.activity = { ...rest, since: now - sinceAgo };
    }
    if (d.leaveIn != null) pet.leaveAt = now + Math.max(0, d.leaveIn);
    if (d.visitor) pet.stayUntil = now + (d.stayIn != null ? d.stayIn : 60000);
    if (pet.ground && pet.ground.id === 'floor') pet.y = world.height;
    return pet;
  }

  // ---------- 装扮 ----------
  get outfit() {
    return this.ownOutfit || this.world.outfit;
  }
  // 帽子占了头顶几格
  get headroom() {
    return OUTFITS.headroom(this.outfit);
  }
  // 头顶（站在帽子上）的 y：叠罗汉时上面那只站在这里
  headTop() {
    return this.y - (this.lastHop || 0) - this.height + (this.lastTop || 0) * this.Pd - this.headroom * this.Pd;
  }

  // ---------- 尺寸 ----------
  get P() {
    return Math.max(1, Math.round(this.world.scale * this.world.dpr));
  }
  get Pd() {
    return this.P / this.world.dpr;
  }
  get halfW() {
    return (8 + this.fat) * this.Pd;
  }
  get height() {
    return 10 * this.Pd;
  }

  bodyBox(x = this.x, y = this.y) {
    const hw = this.halfW * BODY;
    return { l: x - hw, r: x + hw, t: y - this.height * 0.92, b: y - 0.5 };
  }

  // ---------- 状态小工具 ----------
  setMode(mode, dur = 0) {
    this.mode = mode;
    this.modeT = dur;
  }

  // opts.sub：第二行字幕；code：等宽字体；quote：加引号；typed：打字机效果
  say(text, dur = 2.2, important = false, opts = {}) {
    if (!text) return;
    const mode = this.world.bubbles;
    if (mode === 'alerts' && !important) return;
    if (this.bubble && this.bubble.important && !important && this.activity && this.activity.kind === 'alert') return;
    const sub = important || mode === 'full' ? opts.sub || '' : '';
    const typed = !!(opts.typed && sub);
    // 逐字出现的字幕：打完以后还要留够读的时间（按每秒十来个字算）
    this.bubble = { text, sub, hint: opts.hint || '', code: !!opts.code, quote: !!opts.quote, typed, t: 0, dur: typed ? Math.max(dur, 2.2 + sub.length / 12) : dur, important };
  }

  doEmote(kind, dur) {
    this.emote = { kind, t: 0, dur };
  }

  setActivity(kind, extra = {}) {
    this.clearActivity();
    this.activity = { kind, since: performance.now(), ...extra };
  }

  clearActivity() {
    if (this.holding() && this.bubble && this.bubble.important) this.bubble = null;
    this.activity = null;
  }

  // 正举着牌子：等你做决定、长任务做完、日报写好
  holding() {
    const a = this.activity;
    return !!a && (a.kind === 'alert' || a.kind === 'done' || a.kind === 'report');
  }

  // 需要你做决定：urgent 时举牌子蹦着跑到屏幕中间，到了以后一直跳。
  // tool：需要批准的工具名。同一次请求可能先后收到 PermissionRequest（带工具名）和 Notification（不带），保留带工具名的那句
  alert(sign, text, urgent, tool, sub = '', silent = false) {
    const prev = this.activity;
    if (prev && prev.kind === 'alert') {
      if (prev.urgent && !urgent) return;
      if (prev.urgent && prev.tool && !tool) {
        text = prev.text;
        tool = prev.tool;
        sub = prev.sub;
      }
    }
    this.clearActivity();
    this.emote = null;
    if (this.mode === 'sleep') this.setMode('idle', 1);
    const wasUrgent = prev && prev.kind === 'alert' && prev.urgent;
    this.activity = { kind: 'alert', sign, urgent, text, sub, tool, since: performance.now(), goto: urgent };
    this.say(text, urgent ? Infinity : 8, true, { sub, code: !!tool, hint: urgent && this.canJump ? tr('say.jumpHint') : '' });
    if (urgent && !wasUrgent && !silent) this.world.sound('alert');
  }

  // 跑了很久的任务做完了，而你不在那个窗口：举着 ✓ 跑到屏幕中间，蹦一会儿，然后举着牌子等你
  celebrateDone(ev) {
    this.clearActivity();
    this.emote = null;
    this.activity = { kind: 'done', sign: '✓', since: performance.now(), goto: true };
    this.say(tr('say.longDone', { time: fmtDuration(ev.turnMs) }), Infinity, true, { sub: ev.text, typed: true, hint: this.canJump ? tr('say.jumpHint') : '' });
    this.world.confetti(this);
    this.world.sound('done');
  }

  // 举着「!」等你批准某个工具（或者气泡里有按钮等你点）
  waitingApproval() {
    const a = this.activity;
    return !!this.ask || !!(a && a.kind === 'alert' && a.approval);
  }

  // 这个事件说明批准那件事已经过去了：这一轮结束 / 你发了新消息 / 要批准的那个工具跑完了。
  // 气泡里有按钮时只认这些（主进程那边处理完会另外发 permission-done）；
  // 没开"在桌宠上批准"的，你在终端里批准后不一定有对应的事件，过了几秒以后来的工具事件也算
  approvalOverBy(ev) {
    if (['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionStart', 'SessionEnd'].includes(ev.event)) return true;
    const a = this.activity;
    if (!a || a.kind !== 'alert') return !this.ask;
    const post = ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure';
    if (post && ev.tool === a.tool && (!a.detail || !ev.detail || ev.detail === a.detail)) return true;
    if (this.ask) return false;
    return (post || ev.event === 'PreToolUse') && performance.now() - a.since > 3000;
  }

  // 在桌宠身上批准：牌子照举，气泡里给出完整命令和「允许 / 拒绝 / 去终端」
  askPermission({ id, tool, detail }) {
    this.ask = { id, tool, detail };
    this.cardUntil = 0;
    const a = this.activity;
    if (!a || a.kind !== 'alert') this.alert('!', tr('say.approve'), true, tool);
    if (this.activity) Object.assign(this.activity, { approval: true, tool: this.activity.tool || tool });
    this.say(tr('ask.title'), Infinity, true, { sub: [tool, detail].filter(Boolean).join(' · '), code: true });
  }

  decide(kind) {
    const ask = this.ask;
    if (!ask) return;
    this.ask = null;
    this.world.permissionDecision(ask.id, kind);
    this.clearActivity();
    this.bubble = null;
    if (kind === 'allow') {
      this.doEmote('cheer', 1);
      this.say(tr('ask.allowed'), 1.6);
    } else if (kind === 'deny') {
      this.doEmote('sad', 1.4);
      this.say(tr('ask.denied'), 1.6);
    } else this.say(tr('say.ok'), 1.2);
  }

  // 主进程那边结束了这次请求（你在终端里选了、切回了窗口、等太久）：收起按钮
  permissionDone({ id, by }) {
    if (!this.ask || this.ask.id !== id || by === 'pet') return;
    this.ask = null;
    if (by === 'cancelled' || by === 'elsewhere') {
      this.clearActivity();
      this.bubble = null;
      this.say(tr('ask.handled'), 1.4);
    } else if (this.activity && this.activity.kind === 'alert') {
      // 交给终端了：牌子还举着，点它回到那个窗口
      this.say(tr('say.approve'), Infinity, true, { sub: this.activity.sub, code: true, hint: this.canJump ? tr('say.jumpHint') : '' });
    }
  }

  // 到点提醒（番茄钟、便签）：举着牌子跑到屏幕中间，点它表示知道了
  ring(text, sub, sign, extra = {}) {
    if (this.ask) return false;
    this.clearActivity();
    this.emote = null;
    if (this.mode === 'sleep') this.setMode('idle', 1);
    this.activity = { kind: 'done', sign, since: performance.now(), goto: true, ...extra };
    this.say(text, Infinity, true, { sub, hint: tr('ring.hint') });
    this.world.sound(sign === 'tomato' ? 'done' : 'report');
    return true;
  }

  // 晚上日报写好了：举着一张纸，点它打开
  reportReady() {
    const a = this.activity;
    if (a && (a.kind === 'alert' || a.kind === 'done')) return false;
    this.clearActivity();
    this.activity = { kind: 'report', since: performance.now() };
    this.say(tr('say.reportReady'), Infinity, true, { sub: tr('say.reportHint') });
    this.world.sound('report');
    return true;
  }

  // 解锁成就：庆祝一下，告诉你得到了什么装扮
  celebrateUnlock(ids, items) {
    this.touch();
    this.doEmote('cheer', 1.8);
    this.world.sparkles(this);
    this.world.confetti(this);
    this.world.sound('unlock');
    const names = ids.map((id) => tr(`ach.${id}`));
    if (ids.length === 1) this.say(tr('say.unlocked', { name: names[0] }), 4.5, false, { sub: tr('say.unlockedSub', { item: tr(`item.${items[0]}`) }) });
    else this.say(tr('say.unlockedMany', { n: ids.length }), 4.5, false, { sub: names.join(' · ') });
  }

  // 下载文件夹太乱：饿了，点它打开下载文件夹
  hungry(count) {
    if (this.activity) return false;
    this.activity = { kind: 'hungry', since: performance.now() };
    this.say(tr('say.hungry', { n: count }), 20, true, { sub: tr('say.hungrySub'), hint: tr('say.hungryHint') });
    return true;
  }

  // 拖着文件经过它：张大嘴
  noteFeedHover(on) {
    if (on && !this.feedHover) {
      this.touch();
      this.say(tr('say.feedOpen'), 1.2);
    }
    this.feedHover = on ? performance.now() : 0;
  }

  // 文件放到它嘴里了：先嚼起来，等主进程挪完文件再说吃了什么
  startEating() {
    this.feedHover = 0;
    this.touch();
    this.doEmote('eat', 1.6);
    this.world.crumbs(this);
  }

  onFed(r) {
    if (!r || r.off) return;
    const reasons = [...new Set((r.skipped || []).map((x) => x.reason))];
    if (r.eaten) {
      const names = r.names.slice(0, 3).join('、') + (r.names.length > 3 ? ' …' : '');
      this.doEmote('eat', 1.4);
      this.say(tr('say.ate', { n: r.eaten }), 3, false, { sub: names });
      setTimeout(() => {
        if (!this.world.pets.includes(this)) return;
        this.say(tr('say.burp'), 1.2);
        this.world.note(this);
      }, 3200);
    } else {
      this.doEmote('oops', 1.4);
      this.say(tr('say.cantEat'), 2.6, false, { sub: reasons.map((k) => tr(`feed.${k}`)).join(' · ') });
    }
  }

  // "吐出来"：撤销上一次喂食
  onSpit(restored, kept) {
    this.touch();
    this.doEmote('oops', 1.2);
    this.say(tr(restored ? 'say.spit' : 'say.spitNone', { n: restored }), 2.4, false, { sub: kept ? tr('say.spitKept', { n: kept }) : '' });
  }

  // 上下文用得越多越胖；变胖的那一下说一句
  setContext(ctx) {
    this.context = ctx;
    const pct = ctx && ctx.limit ? ctx.used / ctx.limit : 0;
    const fat = pct >= FAT_AT[1] ? 2 : pct >= FAT_AT[0] ? 1 : 0;
    if (fat > this.fat) {
      const short = tr('ctx.short', { pct: Math.round(pct * 100) });
      this.say(tr(fat === 2 ? 'say.full2' : 'say.full1'), 3, false, { sub: fat === 2 ? `${short} · ${tr('ctx.compactHint')}` : short });
      if (fat === 2) this.doEmote('oops', 1.2);
    }
    this.fat = fat;
  }

  contextPct() {
    return this.context && this.context.limit ? Math.round((this.context.used / this.context.limit) * 100) : null;
  }

  statusText() {
    const a = this.activity;
    if (this.mode === 'sleep') return tr('status.sleeping');
    if (a && a.kind === 'alert') return tr(a.urgent ? 'status.waitApprove' : 'status.waitReply');
    if (this.game) return tr('status.playing');
    if (a) return tr(`status.${a.kind}`);
    return tr('status.idle');
  }

  info() {
    const pct = this.contextPct();
    const parts = [this.project || tr('pet.free'), this.statusText()];
    if (pct != null) parts.push(tr('ctx.short', { pct }));
    return {
      id: this.id,
      title: parts.join(' · '),
      project: this.project,
      status: this.statusText(),
      session: this.sessionId,
      color: this.palette.body,
      asleep: this.mode === 'sleep',
      context: pct,
      contextUsed: this.context ? this.context.used : null,
      contextLimit: this.context ? this.context.limit : null,
      fat: this.fat,
      canJump: !!(this.canJump && this.sessionId),
      outfit: this.outfit,
      canInvite: this.world.games.canInvite(), // 还能不能再叫小伙伴
      visitors: this.world.games.visitors().length,
      inTour: !!(this.world.tour && this.world.tour.pet === this),
      teaser: !!this.world.teaser.on,
    };
  }

  touch() {
    this.lastActive = performance.now();
    if (this.mode === 'sleep' || this.mode === 'yawn') this.setMode('idle', rand(0.5, 1.5));
  }

  // ---------- Claude Code 事件 ----------
  onClaude(ev) {
    const now = performance.now();
    this.lastEvent = now;
    if (this.game) this.world.games.abort(this.game); // 来活了，不玩了
    this.touch();
    if (ev.project) this.project = ev.project;
    if (ev.canJump) this.canJump = true;
    if (ev.context !== undefined) this.setContext(ev.context);
    if (ev.progress) this.progress = ev.progress;
    // 正等你批准：同一轮里并行的其他工具、子代理发来的事件不能把牌子和按钮冲掉
    if (this.waitingApproval() && !this.approvalOverBy(ev)) {
      if (ev.event === 'SubagentStart') this.addMini(ev.agentId);
      else if (ev.event === 'SubagentStop') this.removeMini(ev.agentId);
      if (ev.event !== 'Notification' && ev.event !== 'PermissionRequest') return;
    }
    if (this.holding() && ev.event !== 'Notification' && ev.event !== 'PermissionRequest') this.clearActivity();
    const brief = this.world.bubbles === 'brief';

    switch (ev.event) {
      case 'SessionStart':
        this.clearActivity();
        this.doEmote('wave', 1.6);
        this.say(tr(ev.source === 'resume' ? 'say.resume' : 'say.start', { project: this.project }), 2.6, false, { sub: ev.model });
        break;
      case 'UserPromptSubmit':
        this.verb = pick(tr('verbs.think').split('|'));
        this.turnStart = now;
        this.todo = '';
        this.setActivity('think');
        this.say(tr('say.gotIt'), 1.6, false, { sub: ev.text, quote: true, typed: true });
        break;
      case 'PreToolUse': {
        if (ev.decision) {
          // Claude 在问你问题，或者计划写好了等你确认
          this.alert('?', tr(ev.decision === 'plan' ? 'say.planReady' : 'say.question'), true, null, ev.text);
          break;
        }
        if (ev.todo) this.todo = ev.todo;
        const kind = ev.toolKind || 'other';
        const find = ev.tool === 'Grep' || ev.tool === 'Glob';
        this.setActivity(kind, { title: tr(find ? 'act.find' : `act.${kind}`), sub: ev.todo ? '' : ev.detail, code: kind === 'shell' });
        if (brief) this.say(toolLine(ev), 2.4);
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure':
        if (this.activity) this.setActivity('think');
        if (ev.test === 'pass') {
          this.doEmote('cheer', 1.4);
          this.say(tr('say.testPass'), 2.2);
          this.world.confetti(this);
        } else if (ev.test === 'fail') {
          this.doEmote(Math.random() < 0.4 ? 'headshake' : 'sad', 2.4);
          this.say(tr('say.testFail'), 2.4);
        } else if (ev.error) {
          this.doEmote('oops', 1.2);
          this.say(tr('say.error'), 1.8);
        }
        break;
      case 'PermissionRequest':
        if (ev.tool) this.alert('!', tr('say.approve'), true, ev.tool, [ev.tool, ev.detail !== ev.tool ? ev.detail : ''].filter(Boolean).join(' · '));
        else this.alert('!', tr('say.approve'), true);
        if (this.activity) Object.assign(this.activity, { approval: true, detail: ev.detail || '' });
        break;
      case 'Notification':
        if (ev.notify === 'permission') this.alert('!', tr('say.approve'), true);
        else if (ev.notify === 'input') this.alert('?', tr('say.question'), true);
        else if (ev.notify === 'idle') this.alert('?', tr('say.waiting'), false);
        break;
      case 'Stop':
        this.clearActivity();
        this.turnStart = 0;
        this.todo = '';
        if (ev.longTask) {
          this.celebrateDone(ev);
          break;
        }
        this.doEmote(Math.random() < 0.35 ? 'pump' : 'cheer', 1.6);
        this.say(tr('say.done'), 2.6, false, { sub: ev.text, typed: true });
        this.world.confetti(this);
        break;
      case 'StopFailure':
        this.clearActivity();
        this.turnStart = 0;
        this.doEmote('sad', 2.4);
        this.say(tr('say.stopFail'), 3, false, { sub: ev.text });
        break;
      case 'SubagentStart':
        this.addMini(ev.agentId);
        this.say(tr('say.helper'), 2, false, { sub: ev.agentType });
        break;
      case 'SubagentStop':
        this.removeMini(ev.agentId);
        break;
      case 'PreCompact':
        this.setActivity('compact', { title: tr('act.compact') });
        if (brief) this.say(tr('say.compacting'), 3);
        break;
      case 'PostCompact':
        this.clearActivity();
        this.say(tr('say.compacted'), 1.6);
        break;
    }
  }

  addMini(id) {
    if (this.minis.filter((m) => m.dying == null).length >= MAX_MINIS) return;
    this.minis.push({ id: id || `m${Math.random()}`, born: this.t, dying: null });
  }

  removeMini(id) {
    const live = this.minis.filter((m) => m.dying == null);
    const m = live.find((x) => x.id === id) || live[0];
    if (m) m.dying = this.t;
  }

  // ---------- 和你的互动 ----------
  onClick(x, y) {
    this.touch();
    if (this.world.tour && this.world.tour.pet === this) return this.world.tour.click();
    // 等你批准时点它身上（不是按钮）：回到终端去看
    if (this.ask) return this.decide('terminal');
    const a = this.activity;
    if (a && a.noteId) this.world.noteDone(a.noteId);
    if (a && a.kind === 'hungry') {
      this.clearActivity();
      this.bubble = null;
      this.say(tr('say.ok'), 1.2);
      this.world.openDownloads();
    }
    if (a && (a.kind === 'alert' || a.kind === 'done')) {
      // 点一下表示"知道了"，并且跳回那个会话的窗口
      const jump = this.canJump && this.sessionId;
      this.clearActivity();
      this.bubble = null;
      this.say(tr('say.ok'), 1.2);
      if (jump) this.world.focusSession(this.sessionId);
    } else if (a && a.kind === 'report') {
      this.clearActivity();
      this.bubble = null;
      this.world.openReport();
    } else if (!(a && a.kind === 'hungry') && this.sessionId && (a || this.progress)) {
      // 在干活（或者刚干完）的：弹出 / 收起进度卡片，顺便被摸一下
      const now = performance.now();
      this.cardUntil = this.cardUntil > now ? 0 : now + 12000;
      if (x != null) this.touchReaction(this.regionAt(x, y), true);
      return;
    }
    if (x != null && !a) return this.touchReaction(this.regionAt(x, y));
    this.doEmote('love', 1.1);
    this.world.heart(this);
    this.hop(-420);
  }

  // 点在身上哪儿：头、肚子、手、脚（按 16×10 的网格算，帽子和牌子算头）
  regionAt(x, y) {
    const P = this.Pd;
    let gx = (x - (this.x + (this.lastSway || 0))) / P + 8;
    const gy = (y - (this.y - (this.lastHop || 0) - this.height)) / P;
    if (this.facing < 0) gx = 16 - gx;
    this.touchSide = gx < 8 ? 'L' : 'R'; // 网格里左边是 armL（翻转时已经镜像回来了）
    const top = this.lastTop || 0;
    if (gy < top + 4) return gx < 2 - this.fat || gx >= 14 + this.fat ? 'arm' : 'head';
    if (gy >= top + 8) return 'feet';
    if (gx < 2 - this.fat || gx >= 14 + this.fat) return 'arm';
    return 'belly';
  }

  touchReaction(region, quiet) {
    const now = performance.now();
    // 一直戳：烦了，走开
    this.pokes = this.pokes.filter((t) => now - t < 3000);
    this.pokes.push(now);
    if (this.pokes.length >= 6) {
      this.pokes = [];
      if (!quiet) this.say(pick(tr('touch.annoyed').split('|')), 1.6);
      if (!this.activity && this.ground && !this.game) {
        // 气鼓鼓地走开（边走边冒汗），不用表情，免得表情把"走"占住
        const m = this.world.mouse;
        this.emote = null;
        this.grumpyUntil = now + 2200;
        this.facing = m && m.x > this.x ? -1 : 1;
        this.setMode('walk', 2.2);
        this.edgePolicy = 'turn';
      } else this.doEmote('grumpy', 1.6);
      return;
    }
    const emote = { head: 'pat', belly: 'giggle', arm: 'shake', feet: 'kick' }[region] || 'pat';
    this.doEmote(emote, region === 'arm' ? 1.4 : 1.2);
    if (!quiet) this.say(pick(tr(`touch.${region}`).split('|')), 1.3);
    if (region === 'head') this.world.heart(this);
    if (region === 'feet' && !this.activity) this.hop(-300);
  }

  // 按住一会儿再松手：弹得老高
  onBoing() {
    this.touch();
    this.doEmote('cheer', 1);
    this.say(tr('say.boing'), 1.2);
    this.world.sparkles(this);
    this.hop(-1050);
  }

  // 用鼠标来回蹭它
  onPetted() {
    this.touch();
    this.doEmote('love', 1.8);
    this.say(tr('say.pet'), 1.6);
    for (let i = 0; i < 3; i++) setTimeout(() => this.world.heart(this), i * 220);
  }

  onDoubleClick() {
    this.touch();
    this.doEmote('spin', 0.8);
    this.world.sparkles(this);
    this.hop(-520);
  }

  hop(vy) {
    if (!this.ground) return;
    this.ground = null;
    this.climb = null;
    this.vy = vy;
    this.vx = 0;
  }

  // ---------- 每帧更新 ----------
  update(dt) {
    const now = performance.now();
    const w = this.world;
    this.t += dt;
    if (this.bubble && (this.bubble.t += dt) > this.bubble.dur) this.bubble = null;
    if (this.emote && (this.emote.t += dt) > this.emote.dur) this.emote = null;
    // 会话结束后挥完手就走。单独计时，不跟着挥手动作走：落地摔晕之类的动作会把挥手顶掉
    if (this.leaveAt && now >= this.leaveAt) {
      this.leaveAt = 0;
      this.leaving = true;
    }
    if (this.squash > 0) this.squash -= dt;
    if (this.shoved > 0) this.shoved -= dt;
    if ((this.nextBlink -= dt) <= 0) {
      this.blink = 0.12;
      this.nextBlink = rand(2, 5);
    }
    if (this.blink > 0) this.blink -= dt;

    const a = this.activity;
    if (a) {
      const age = now - a.since;
      const ttl = a.kind === 'alert' ? (a.urgent ? 15 * 60e3 : 20e3) : a.kind === 'done' ? DONE_TTL : a.kind === 'report' ? REPORT_TTL : a.kind === 'hungry' ? 20e3 : a.tour ? 60e3 : null;
      const stale = ttl != null ? age > ttl : now - this.lastEvent > BUSY_TIMEOUT;
      if (stale) this.clearActivity();
    }

    for (const m of this.minis) {
      if (m.dying != null && this.t - m.dying > 0.5) {
        const pos = this.miniPos(this.minis.indexOf(m));
        w.poof(pos.x, pos.y - pos.h / 2);
        m.dead = true;
      }
    }
    this.minis = this.minis.filter((m) => !m.dead);

    // 和它已经重叠的窗口，不再重叠就恢复碰撞
    for (const id of this.inside) {
      const s = w.solidById(id);
      if (!s || !w.overlaps(this.bodyBox(), s)) this.inside.delete(id);
    }

    // 睡觉冒 z，跳舞冒音符
    this.fxTimer -= dt;
    if (this.fxTimer <= 0) {
      if (this.mode === 'sleep') {
        w.snore(this);
        this.fxTimer = 1.4;
      } else if (this.mode === 'dance') {
        w.note(this);
        this.fxTimer = 0.45;
      }
    }

    if (this.feedHover && now - this.feedHover > 400) this.feedHover = 0; // 文件拖走了
    if (this.cardUntil && now > this.cardUntil) this.cardUntil = 0;
    if (this.mode === 'drag') return;
    if (this.mount) return w.games.ride(this, dt);
    if (!this.ground) return this.physics(dt);
    this.checkSupport();
    if (this.ground) this.behave(dt);
  }

  physics(dt) {
    const w = this.world;
    this.mode = 'air';
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
    // 竖直跳到最高点后，再横着落到目标上
    if (this.climb && this.vy >= 0) {
      const c = this.climb;
      this.climb = null;
      const fall = Math.max(4, c.ty - this.y);
      this.vx = (c.x - this.x) / Math.max(0.12, Math.sqrt((2 * fall) / GRAVITY));
    }
    let nx = this.x + this.vx * dt;
    let ny = this.y + this.vy * dt;
    const hw = this.halfW;
    // 屏幕边：隔壁有显示器就飞过去，没有就弹回来
    let exit = null;
    if (!this.leaving && (nx < hw || nx > w.width - hw)) {
      exit = w.exitAt(nx < hw ? 'left' : 'right', this);
      if (!exit && nx < hw) {
        nx = hw;
        this.vx = Math.abs(this.vx) * 0.45;
      } else if (!exit) {
        nx = w.width - hw;
        this.vx = -Math.abs(this.vx) * 0.45;
      }
    }
    const solid = w.collide && !this.leaving;

    // 横着撞到窗口侧面：弹回来
    if (solid) {
      const hit = w.hitSolid(this.bodyBox(nx, this.y), this);
      if (hit) {
        const fromLeft = this.x < (hit.l + hit.r) / 2;
        nx = fromLeft ? hit.l - hw * BODY - 0.5 : hit.r + hw * BODY + 0.5;
        if (Math.abs(this.vx) > 900) this.doEmote('dizzy', 1);
        this.vx = -this.vx * 0.35;
        this.climb = null;
      }
    }

    if (this.vy > 0) {
      const p = w.landingPlatform(nx, this.y, ny, solid ? hw * 0.7 : 0);
      if (p) {
        this.x = nx;
        this.land(p);
        this.crossEdge();
        return;
      }
    }

    if (solid) {
      const hit = w.hitSolid(this.bodyBox(nx, ny), this);
      if (hit) {
        if (this.vy < 0) {
          // 从下面跳上去磕到头
          ny = hit.b + this.height * 0.92 + 0.5;
          this.vy = 90;
          this.climb = null;
          this.doEmote('dizzy', 0.9);
          if (Math.random() < 0.5) this.say(tr('say.bonk'), 1);
        } else {
          // 落在窗口上，但那段顶边被别的窗口挡住了：往外推开接着掉
          nx = nx < (hit.l + hit.r) / 2 ? hit.l - hw * BODY - 0.5 : hit.r + hw * BODY + 0.5;
        }
      }
    }
    // 窗口伸出了屏幕边时，"被窗口挡回去"可能把它推到屏幕外面：那边没有别的屏就拉回来，和那个窗口先不碰撞
    const cx = this.leaving ? nx : w.clampX(this, nx);
    if (cx !== nx) {
      nx = cx;
      const s = w.hitSolid(this.bodyBox(nx, ny), this);
      if (s) this.inside.add(s.id);
    }
    this.x = nx;
    this.y = Math.max(ny, -600);
    this.crossEdge();
  }

  // 身体中心过了屏幕边、那边有别的屏：交过去（碰撞把它推出去的也算）
  crossEdge() {
    const w = this.world;
    if (this.leaving || (this.x >= 0 && this.x <= w.width)) return;
    const exit = w.exitAt(this.x < 0 ? 'left' : 'right', this);
    if (exit) w.transfer(this, exit.to);
  }

  land(p) {
    const speed = this.vy;
    this.y = p.y;
    this.vy = 0;
    this.vx = 0;
    this.climb = null;
    this.ground = { id: p.id, wx: p.wx, y: p.y };
    this.layerId = p.id === 'floor' ? null : p.id;
    if (speed > 1300) {
      this.squash = 0.25;
      this.doEmote('dizzy', 1.3); // 摔了个屁股墩
    } else if (speed > 450) {
      this.squash = 0.14;
    }
    this.setMode('idle', rand(0.4, 1.2));
  }

  fall(vx) {
    this.ground = null;
    this.vy = 0;
    this.vx = vx;
    this.climb = null;
    this.mode = 'air';
  }

  // 开了碰撞时，身体还有一部分搭在平台上就不会掉
  edgeTolerance() {
    return this.world.collide ? this.halfW * 0.7 : 1;
  }

  checkSupport() {
    if (this.ground.id === 'floor') {
      this.y = this.world.height;
      return;
    }
    if (!this.world.segmentAt(this.ground.id, this.x, this.edgeTolerance())) this.fall(0);
  }

  // 沿着当前平台走一步；edge='fall' 时走到边缘会掉下去，否则停在边缘。
  // 返回 ok / blocked（边缘或屏幕边）/ wall（撞到窗口，this.lastWall 是那个窗口）/ fell / gone（走到别的屏幕去了）
  step(dir, speed, dt, edge, stopAt) {
    const w = this.world;
    const hw = this.halfW;
    this.facing = dir;
    let nx = this.x + dir * speed * dt;
    if (stopAt !== undefined && (dir > 0 ? nx > stopAt : nx < stopAt)) nx = stopAt;

    // 屏幕边：隔壁有显示器就走过去（一起玩的时候不走），否则停下
    const side = nx < hw ? 'left' : nx > w.width - hw ? 'right' : null;
    const exit = side && !this.leaving && !this.game ? w.exitAt(side, this) : null;
    if (side && !this.leaving && !exit) {
      this.x = clamp(nx, hw, w.width - hw);
      return 'blocked';
    }
    if (w.collide && !this.leaving) {
      const hit = w.hitSolid(this.bodyBox(nx), this);
      if (hit) {
        this.lastWall = hit;
        return 'wall';
      }
    }
    if (this.ground.id !== 'floor') {
      const tol = this.edgeTolerance();
      const seg = w.segmentAt(this.ground.id, this.x, tol);
      if (!seg) {
        this.fall(0);
        return 'fell';
      }
      // 窗口横跨两块屏：这一段一直通到屏幕边，可以接着走过去
      const continues = exit && (side === 'left' ? seg.x1 <= 1 : seg.x2 >= w.width - 1);
      if (!continues && (nx < seg.x1 - tol || nx > seg.x2 + tol)) {
        if (edge === 'fall') {
          this.x = nx;
          this.fall(dir * speed * 0.8);
          return 'fell';
        }
        this.x = clamp(nx, seg.x1 - tol, seg.x2 + tol);
        return 'blocked';
      }
    }
    this.walkDist += Math.abs(nx - this.x);
    this.x = nx;
    if (exit && (nx < 0 || nx > w.width)) {
      w.transfer(this, exit.to);
      return 'gone';
    }
    return 'ok';
  }

  // 撞到窗口时翻上去：找那个窗口顶上离自己最近的一段，跳到靠边一点的地方
  climbOnto(win) {
    const segs = this.world.platforms.filter((p) => p.id === win.id && p.x2 - p.x1 > this.halfW * 2);
    if (!segs.length) return false;
    const dist = (s) => Math.abs((s.x1 + s.x2) / 2 - this.x);
    const seg = segs.reduce((best, s) => (dist(s) < dist(best) ? s : best));
    const fromLeft = this.x < (win.l + win.r) / 2;
    const x = fromLeft ? Math.min(seg.x1 + this.halfW * 1.2, seg.x2 - this.halfW) : Math.max(seg.x2 - this.halfW * 1.2, seg.x1 + this.halfW);
    this.jumpTarget = { x, y: seg.y };
    this.launch();
    return true;
  }

  behave(dt) {
    const w = this.world;
    if (this.leaving) {
      this.mode = 'run';
      this.step(this.exitDir, RUN_SPEED * 0.6, dt, 'fall');
      if (this.x < -this.halfW * 2 || this.x > w.width + this.halfW * 2) w.removePet(this);
      return;
    }
    if (this.game && w.games.behave(this, dt)) return;
    const a = this.activity;
    // 鼠标伸向带按钮的气泡了：别跑了，站着等你点
    const bb = this.bubbleBox;
    const m = w.mouse;
    if (this.ask && bb && m && m.x > bb.l - 60 && m.x < bb.r + 60 && m.y > bb.t - 60 && m.y < bb.b + 60) {
      this.mode = 'busy';
      return;
    }
    if (a && (a.kind === 'alert' || a.kind === 'done') && a.goto) {
      const tx = w.alertTargetX(this);
      if (Math.abs(tx - this.x) > 3) {
        this.mode = 'run';
        const r = this.step(tx > this.x ? 1 : -1, RUN_SPEED, dt, 'fall', tx);
        // 路上有窗口挡着就翻过去，翻不过去就原地蹦
        if (r === 'wall' && !this.climbOnto(this.lastWall)) a.goto = false;
        else if (r === 'blocked') a.goto = false;
        if (!a.goto) a.arrivedAt = this.t;
        return;
      }
      a.goto = false;
      a.arrivedAt = this.t;
    }
    if (a && a.tour) return; // 新手引导里演示的动作由 tour.js 控制
    if (a || (this.emote && this.emote.kind !== 'love')) {
      if (this.mode !== 'sleep') this.setMode('busy', 0);
      return;
    }
    if (w.holdStill(this)) {
      if (this.mode !== 'sleep') this.setMode('idle', 1);
      return;
    }
    if (w.teaser.behave(this, dt)) return;

    this.modeT -= dt;
    switch (this.mode) {
      case 'walk': {
        // 吃撑了走得慢
        const r = this.step(this.facing, WALK_SPEED * (1 - 0.2 * this.fat), dt, this.edgePolicy);
        if (r === 'wall') {
          // 撞墙：有时候翻上去，有时候揉揉头掉头走
          if (Math.random() < 0.3 && this.climbOnto(this.lastWall)) break;
          this.facing = -this.facing;
          if (Math.random() < 0.3) {
            this.doEmote('oops', 0.8);
            this.say(tr('say.bonk'), 1);
          }
        } else if (r === 'blocked') {
          this.facing = -this.facing;
          if (Math.random() < 0.4) this.setMode('idle', rand(1, 2.5));
        }
        if (this.mode === 'walk' && this.modeT <= 0) this.pickNext();
        break;
      }
      case 'crouch':
        if (this.modeT <= 0) this.launch();
        break;
      case 'yawn':
        if (this.modeT <= 0) this.setMode('sleep');
        break;
      case 'sleep':
        break;
      default:
        if (this.modeT <= 0) this.pickNext();
    }
  }

  pickNext() {
    const w = this.world;
    if (performance.now() - this.lastActive > SLEEP_AFTER || w.userAway) {
      this.setMode('yawn', 1.6);
      return;
    }
    // 在放歌：多半在跳舞
    if (w.music && Math.random() < 0.75) {
      this.setMode('dance', rand(4, 8));
      return;
    }
    // 后半夜：偶尔困得睡着
    if (w.dayPart() === 'late' && Math.random() < 0.08) {
      this.setMode('yawn', 1.6);
      return;
    }
    const r = Math.random();
    if (r < 0.3) {
      this.setMode('idle', rand(1.5, 4.5));
    } else if (r < 0.62) {
      this.setMode('walk', rand(2, 6));
      if (this.x < w.width * 0.12) this.facing = 1;
      else if (this.x > w.width * 0.88) this.facing = -1;
      else this.facing = Math.random() < 0.5 ? -1 : 1;
      this.edgePolicy = Math.random() < 0.35 ? 'fall' : 'turn';
    } else if (r < 0.74) {
      this.jumpTarget = w.findJumpTarget(this);
      if (this.jumpTarget) this.setMode('crouch', 0.22);
      else this.setMode('idle', rand(1, 3));
    } else if (r < 0.8) {
      this.setMode('sit', rand(4, 9));
    } else if (r < 0.84) {
      this.setMode('stretch', 1.4);
    } else if (r < 0.88) {
      this.setMode('look', 2.2);
    } else if (r < 0.92) {
      this.setMode('read', rand(6, 12));
    } else if (r < 0.95) {
      this.setMode('coffee', rand(4, 7));
    } else if (r < 0.98) {
      this.setMode('game', rand(5, 9));
    } else {
      this.setMode('dance', rand(2.5, 4));
    }
  }

  // 先竖直跳到比目标高一点的地方，再横着落上去（这样不会穿过窗口侧面）
  launch() {
    const { x: tx, y: ty } = this.jumpTarget;
    this.jumpTarget = null;
    const apex = Math.min(this.y, ty) - 40;
    this.vy = -Math.sqrt(2 * GRAVITY * (this.y - apex));
    this.vx = 0;
    this.climb = { x: tx, ty };
    this.facing = tx >= this.x ? 1 : -1;
    this.ground = null;
    this.mode = 'air';
  }

  // ---------- 外观 ----------
  pose() {
    const t = this.t;
    const p = { t, top: 0, eyes: 'open', dx: 0, dy: 0, armL: 4, armR: 4, legs: 'stand', props: [], shadow: !!this.ground, hop: 0, sway: 0, flip: this.facing < 0, fat: this.fat, outfit: this.outfit, headroom: this.headroom };
    p.mouth = this.feedHover ? 'open' : this.emote && this.emote.kind === 'eat' ? 'chew' : '';
    const breathe = Math.floor(t / 0.8) % 2 === 1;
    const kick = Math.floor(t * 11) % 2 ? 'kick0' : 'kick1';
    const a = this.activity;
    const e = this.emote;
    const alerting = a && a.kind === 'alert';
    const celebrating = a && (a.kind === 'done' || a.kind === 'report');
    const signOf = (act) =>
      act.kind === 'done' ? (act.sign === 'note' ? 'signNote' : act.sign === 'tomato' ? 'signTomato' : 'sign✓') : act.kind === 'report' ? 'signDoc' : act.sign === '!' ? 'sign!' : 'sign?';

    if (this.mode === 'drag') {
      Object.assign(p, { eyes: 'wide', armL: 'high', armR: 'high', legs: kick });
    } else if (this.feedHover) {
      Object.assign(p, { eyes: 'wide', armL: 'high', armR: 'high' }); // 张大嘴等着
    } else if (this.game && this.world.games.pose(this, p)) {
      // 一起玩时的姿势在 games.js 里
    } else if (this.pressed) {
      Object.assign(p, { top: 2, wide: true, eyes: 'blink', armL: 6, armR: 6 }); // 被按扁了
    } else if (!this.ground) {
      if (this.vy < 0) Object.assign(p, { legs: 'tuck', armL: 1, armR: 1 });
      else Object.assign(p, { eyes: this.vy > 700 ? 'wide' : 'open', armL: 'high', armR: 'high', legs: kick });
      if (alerting || celebrating) p.props.push(signOf(a));
    } else if (celebrating) {
      // 长任务做完 / 日报写好：举着牌子，跑到中间先开心地蹦几下，然后轻轻晃着等你
      Object.assign(p, { eyes: 'happy', armL: 'high', armR: 'high', blush: true, props: [signOf(a)] });
      const sinceArrive = a.arrivedAt != null ? t - a.arrivedAt : null;
      if (this.mode === 'run') {
        p.hop = Math.abs(Math.sin((this.walkDist / (this.Pd * 9)) * Math.PI)) * 16;
        p.legs = p.hop > 3 ? 'tuck' : Math.floor(this.walkDist / (this.Pd * 1.5)) % 2 ? 'walk0' : 'walk1';
      } else if (a.kind === 'done' && sinceArrive != null && sinceArrive < 4) {
        const k = (t % 0.5) / 0.5;
        p.hop = Math.sin(k * Math.PI) * 26;
        if (k < 0.08 || k > 0.94) Object.assign(p, { top: 2, wide: true });
        else p.legs = 'tuck';
      } else {
        p.hop = Math.max(0, Math.sin((t * Math.PI * 2) / 1.2)) * 4;
      }
    } else if (this.squash > 0 || this.mode === 'crouch') {
      Object.assign(p, { top: 2, wide: true });
    } else if (this.shoved > 0) {
      Object.assign(p, { eyes: 'wide', armL: 'high', armR: 'high', legs: kick, props: ['sweat'] });
    } else if (alerting) {
      Object.assign(p, { eyes: a.urgent ? 'wide' : 'open', armL: 'high', armR: 'high', props: [a.sign === '!' ? 'sign!' : 'sign?'] });
      p.flash = a.urgent && Math.floor(t * 3) % 2 === 0;
      if (this.mode === 'run') {
        // 举着牌子一路蹦着跑
        p.hop = Math.abs(Math.sin((this.walkDist / (this.Pd * 9)) * Math.PI)) * 16;
        p.legs = p.hop > 3 ? 'tuck' : Math.floor(this.walkDist / (this.Pd * 1.5)) % 2 ? 'walk0' : 'walk1';
      } else if (a.urgent) {
        // 到了以后一直在那跳，每跳一下换个方向
        const k = (t % ALERT_JUMP) / ALERT_JUMP;
        const n = Math.floor(t / ALERT_JUMP);
        p.hop = Math.sin(k * Math.PI) * 34;
        p.flip = n % 2 === 1;
        p.sway = (n % 2 ? 1 : -1) * Math.sin(k * Math.PI) * 6;
        if (k < 0.08 || k > 0.94) Object.assign(p, { top: 2, wide: true });
        else p.legs = 'tuck';
      } else {
        p.hop = Math.max(0, Math.sin((t * Math.PI * 2) / 1.2)) * 4;
      }
    } else if (this.mode === 'sleep') {
      Object.assign(p, { top: 2, sit: true, eyes: 'sleep', armL: 5, armR: 5 });
    } else if (this.mode === 'yawn') {
      // 打哈欠：伸长、举手、闭眼，然后坐下睡
      Object.assign(p, this.modeT > 0.8 ? { top: -1, eyes: 'blink', armL: 'high', armR: 'high' } : { top: 2, sit: true, eyes: 'blink', armL: 5, armR: 5 });
    } else if (e && e.kind !== 'love') {
      switch (e.kind) {
        case 'cheer':
          p.hop = Math.abs(Math.sin(e.t * Math.PI * 2.6)) * 10;
          Object.assign(p, { eyes: 'happy', armL: 'high', armR: 'high', blush: true, legs: p.hop > 2 ? 'tuck' : 'stand' });
          break;
        case 'wave':
        case 'bye':
          Object.assign(p, { eyes: 'happy', armR: Math.floor(e.t * 6) % 2 ? 'high' : 1 });
          break;
        case 'spin':
          Object.assign(p, { eyes: 'happy', armL: 'high', armR: 'high', flip: Math.floor(e.t * 12) % 2 === 0 });
          break;
        case 'sad':
          Object.assign(p, { eyes: 'down', top: 1, armL: 6, armR: 6, props: ['tear'] });
          break;
        case 'oops':
          Object.assign(p, { eyes: 'wide', armL: 1, props: ['sweat'] });
          break;
        case 'dizzy':
          Object.assign(p, { eyes: 'x', top: 1, props: ['stars'] });
          break;
        case 'eat':
          Object.assign(p, { eyes: 'happy', blush: true, armL: 5, armR: 5, top: Math.floor(e.t * 7) % 2 });
          break;
        case 'pat': // 摸头：眯眼、脸红、往下缩一点
          Object.assign(p, { eyes: 'happy', blush: true, top: 1, armL: 5, armR: 5 });
          break;
        case 'giggle': // 戳肚子：咯咯笑着扭
          p.sway = Math.floor(e.t * 16) % 2 ? 2 : -2;
          p.hop = Math.abs(Math.sin(e.t * 18)) * 3;
          Object.assign(p, { eyes: 'happy', blush: true, mouth: Math.floor(e.t * 8) % 2 ? 'open' : '', armL: 1, armR: 1 });
          break;
        case 'shake': { // 拉手：握手，上下晃
          const up = Math.floor(e.t * 8) % 2 ? 'high' : 2;
          Object.assign(p, { eyes: 'happy' }, this.touchSide === 'L' ? { armL: up } : { armR: up });
          break;
        }
        case 'kick': // 挠脚心：乱蹬
          Object.assign(p, { eyes: e.t < 0.3 ? 'wide' : 'happy', legs: Math.floor(e.t * 14) % 2 ? 'kick0' : 'kick1', armL: 'high', armR: 'high' });
          break;
        case 'pump': { // 挥拳：耶！
          const up = Math.floor(e.t * 5) % 2;
          p.hop = up ? 6 : 0;
          Object.assign(p, { eyes: 'happy', blush: true, armR: up ? 'high' : 2, armL: 4, legs: up ? 'tuck' : 'stand' });
          break;
        }
        case 'headshake': // 测试挂了：摇头叹气
          Object.assign(p, { eyes: 'down', top: 1, armL: 6, armR: 6, flip: Math.floor(e.t * 6) % 2 === 0, props: ['sweat'] });
          break;
        case 'grumpy': // 烦了
          Object.assign(p, { eyes: 'down', top: 1, armL: 6, armR: 6, props: ['sweat'] });
          break;
        case 'pant': // 追累了：坐下喘气
          Object.assign(p, { sit: true, top: 2, eyes: 'happy', mouth: Math.floor(e.t * 5) % 2 ? 'open' : '', armL: 5, armR: 5 });
          break;
      }
    } else if (a) {
      const typing = Math.floor(t * 8) % 2;
      switch (a.kind) {
        case 'think': {
          // 想事情：冒点点 → 托腮点下巴 → 抬头望天 → 挠头，轮着来
          const phase = Math.floor((performance.now() - (this.turnStart || a.since)) / 2600) % 4;
          if (phase === 1) Object.assign(p, { dx: 1, dy: -1, armR: Math.floor(t * 4) % 2 ? 2 : 3, props: ['dots'] });
          else if (phase === 2) Object.assign(p, { dy: -1, dx: Math.floor(t * 1.2) % 2 ? 1 : -1, top: breathe ? 1 : 0 });
          else if (phase === 3) Object.assign(p, { eyes: 'down', armR: Math.floor(t * 6) % 2 ? 'high' : 0, props: ['dots'] });
          else Object.assign(p, { dx: 1, dy: -1, armR: 1, top: breathe ? 1 : 0, props: ['dots'] });
          break;
        }
        case 'shell':
          p.props.push('terminal');
        // fallthrough
        case 'edit':
        case 'agent':
        case 'other': {
          p.props.push('laptop');
          // 一轮干了半分钟以上：每 24 秒歇一下——喝口咖啡 / 伸个懒腰 / 活动活动手指，再接着敲
          const work = this.turnStart ? (performance.now() - this.turnStart) / 1000 : 0;
          const rest = work > 30 && work % 24 < 1.6 ? Math.floor(work / 24) % 3 : -1;
          if (rest === 0) {
            Object.assign(p, { eyes: 'happy', armR: 2, blush: true });
            p.props.push('mugUp');
          } else if (rest === 1) Object.assign(p, { top: -1, eyes: 'blink', armL: 'high', armR: 'high' });
          else if (rest === 2) Object.assign(p, { eyes: 'happy', armL: Math.floor(t * 10) % 2 ? 5 : 6, armR: Math.floor(t * 10) % 2 ? 6 : 5 });
          else Object.assign(p, { eyes: 'down', armL: typing ? 4 : 5, armR: typing ? 5 : 4 });
          break;
        }
        case 'read':
          Object.assign(p, { dx: 1, top: breathe ? 1 : 0, props: ['magnifier'] });
          break;
        case 'web':
          Object.assign(p, { dy: -1, dx: Math.floor(t * 1.5) % 2 ? 1 : -1, props: ['antenna'] });
          break;
        case 'compact':
          Object.assign(p, { eyes: 'x', props: ['stars'] });
          break;
        case 'hungry': {
          // 饿了：时不时张嘴、摸摸肚子
          const open = Math.floor(t / 1.1) % 3 === 0;
          Object.assign(p, { eyes: open ? 'wide' : 'happy', mouth: open ? 'open' : '', armL: 5, armR: Math.floor(t * 3) % 2 ? 5 : 6 });
          break;
        }
      }
    } else if (this.mode === 'walk' || this.mode === 'run') {
      p.legs = Math.floor(this.walkDist / (this.Pd * 2)) % 2 ? 'walk0' : 'walk1';
      p.dx = 1;
    } else if (this.mode === 'sit') {
      const g = Math.floor(t / 1.7) % 3;
      Object.assign(p, { top: 2, sit: true, armL: 6, armR: 6, dx: g === 1 ? 1 : g === 2 ? -1 : 0 });
    } else if (this.mode === 'read') {
      // 坐着看书，隔一会儿翻一页
      const flip = t % 2.6 < 0.25;
      Object.assign(p, { top: 2, sit: true, eyes: 'down', armL: 5, armR: flip ? 3 : 5, props: [flip ? 'bookFlip' : 'book'] });
    } else if (this.mode === 'coffee') {
      // 端着咖啡，时不时喝一口
      const sip = t % 2.2 < 0.6;
      Object.assign(p, { eyes: sip ? 'happy' : 'open', armR: sip ? 2 : 4, blush: sip, top: breathe ? 1 : 0, props: [sip ? 'mugUp' : 'mug'] });
    } else if (this.mode === 'game') {
      // 打掌机，按键按得飞快
      const tap = Math.floor(t * 6) % 2;
      Object.assign(p, { top: 1, eyes: 'down', armL: tap ? 4 : 5, armR: tap ? 5 : 4, props: ['handheld'] });
    } else if (this.mode === 'stretch') {
      Object.assign(p, this.modeT > 0.4 ? { top: -1, eyes: 'blink', armL: 'high', armR: 'high' } : { top: 1, eyes: 'happy' });
    } else if (this.mode === 'look') {
      // 东张西望：转来转去
      const n = Math.floor(t / 0.55);
      Object.assign(p, { flip: n % 2 === 0, dx: 1, dy: n % 3 === 0 ? -1 : 0 });
    } else if (this.mode === 'chase') {
      // 追逗猫棒：盯着它跑
      p.legs = Math.floor(this.walkDist / (this.Pd * 1.5)) % 2 ? 'walk0' : 'walk1';
      Object.assign(p, { eyes: 'wide', dy: -1, dx: 1, armL: 'high', armR: 'high' });
    } else if (this.mode === 'dance') {
      const beat = Math.floor(t * 4) % 2;
      p.hop = Math.abs(Math.sin(t * Math.PI * 2)) * 6;
      // 放歌时踩着节拍蹦
      if (this.world.music && this.beatAt) p.hop = Math.max(0, 1 - (performance.now() - this.beatAt) / 220) * 12;
      Object.assign(p, { eyes: 'happy', armL: beat ? 'high' : 5, armR: beat ? 5 : 'high', legs: beat ? 'walk0' : 'walk1', blush: true, flip: Math.floor(t * 2) % 2 === 0 });
    } else {
      p.top = breathe ? 1 : 0;
      const g = Math.floor(t / 2.3) % 4;
      p.dx = g === 1 ? 1 : g === 3 ? -1 : 0;
      // 鼠标靠近时盯着看
      const m = this.world.mouse;
      if (m && Math.abs(m.x - this.x) < 260 && Math.abs(m.y - this.y) < 200) {
        const sx = Math.abs(m.x - this.x) < this.halfW * 0.6 ? 0 : Math.sign(m.x - this.x);
        p.dx = sx * this.facing;
        p.dy = m.y < this.y - this.height - 20 ? -1 : 0;
      }
    }
    if (e && e.kind === 'love' && !alerting) Object.assign(p, { eyes: 'happy', blush: true });
    if (this.blink > 0 && p.eyes === 'open') p.eyes = 'blink';
    if (this.grumpyUntil > performance.now()) Object.assign(p, { eyes: 'down', props: [...p.props, 'sweat'] });
    // 放歌时，在干活的也跟着节拍点头
    if (this.world.music && this.beatAt && performance.now() - this.beatAt < 110 && (p.top || 0) < 2 && this.mode !== 'dance') p.top = (p.top || 0) + 1;
    this.world.decorate(this, p); // 番茄钟、便签、夜里的小灯笼
    this.animateTool(p);
    // 坐下、站起、蹲下：高度一格一格变，不一下子跳过去（落地被压扁那一下除外）
    if (this.ground && this.mode !== 'crouch' && this.squash <= 0 && !this.pressed) p.top = this.easeTop(p.top || 0);
    else this.dispTop = p.top || 0;
    return p;
  }

  easeTop(target) {
    if (this.dispTop == null) this.dispTop = target;
    if (target !== this.dispTop && this.t - (this.topAt || 0) > 0.06) {
      this.dispTop += Math.sign(target - this.dispTop);
      this.topAt = this.t;
    }
    return this.dispTop;
  }

  // 手上的家伙（笔记本、放大镜、天线）换的时候放一段动画：先把旧的收起来，再把新的拿出来。
  // 笔记本：手伸到身后 → 从背后拿出来举过头顶 → 放到身前、打开屏幕；收起来倒过来
  animateTool(p) {
    const want = TOOLS.find((k) => p.props.includes(k)) || '';
    const st = (this.toolAnim ||= { held: want, shown: want, from: '', to: want, at: -9 });
    if (!this.ground || this.mode === 'drag') {
      Object.assign(st, { held: want, shown: want, from: '', to: want });
      return;
    }
    if (want !== st.to) Object.assign(st, { from: st.shown, to: want, at: this.t, held: null });
    if (st.held === st.to) return;
    const out = st.from ? TOOL_OUT[st.from] : 0;
    const inn = st.to ? TOOL_IN[st.to] : 0;
    const e = this.t - st.at;
    if (e >= out + inn) {
      Object.assign(st, { held: st.to, shown: st.to, from: '' });
      return;
    }
    p.props = p.props.filter((k) => !TOOLS.includes(k) && k !== 'terminal'); // 终端等笔记本放好了再弹出来
    if (e < out) this.toolFrame(p, st.from, 'out', e / out);
    else this.toolFrame(p, st.to, 'in', (e - out) / inn);
  }

  toolFrame(p, tool, dir, k) {
    this.toolAnim.shown = tool;
    p.props.push(tool);
    if (tool !== 'laptop') {
      p.toolK = dir === 'in' ? k : 1 - k;
      p.armR = 'high';
      return;
    }
    p.laptopAnim = { dir, k: Math.round(k * 20) / 20 };
    const stage = dir === 'in' ? (k < 0.33 ? 'behind' : k < 0.6 ? 'over' : 'front') : k < 0.4 ? 'front' : k < 0.7 ? 'over' : 'behind';
    if (stage === 'behind') Object.assign(p, { armL: 'high', armR: 4, eyes: 'open', dx: -1, dy: 0 });
    else if (stage === 'over') Object.assign(p, { armL: 'high', armR: 'high', eyes: 'open', dy: -1, dx: 0 });
    else Object.assign(p, { armL: 5, armR: 5, eyes: 'down' });
  }

  // 气泡内容：临时的一句话 > 干活时的状态条（详细模式）> 鼠标悬停时的名字
  bubbleView(hovered) {
    const b = this.bubble;
    if (this.cardUntil && !(b && b.important)) return this.cardView();
    if (b) {
      const fadeIn = clamp(b.t / 0.12, 0, 1);
      const fadeOut = b.dur === Infinity ? 1 : clamp((b.dur - b.t) / 0.3, 0, 1);
      const kind = b.important && this.activity && !this.activity.tour ? this.activity.kind : '';
      return {
        title: b.text,
        sub: b.sub,
        hint: b.hint,
        code: b.code,
        quote: b.quote,
        shown: b.typed ? Math.max(0, Math.floor((b.t - 0.25) * 32)) : Infinity,
        important: b.important,
        alert: kind === 'alert', // 橙色发光
        celebrate: kind === 'done' || kind === 'report', // 绿色发光
        alpha: Math.min(fadeIn, fadeOut),
        subLines: this.ask ? 5 : 3,
        buttons: this.ask && b.important ? [['allow', tr('ask.allow')], ['deny', tr('ask.deny')], ['terminal', tr('ask.terminal')]] : null,
      };
    }
    const a = this.activity;
    if (a && !this.holding() && this.world.bubbles === 'full' && this.mode !== 'sleep') {
      // 像 Claude Code 的状态行：转圈的星星 + 正在干什么 + 用了多久
      const since = this.turnStart || a.since;
      const secs = Math.floor((performance.now() - since) / 1000);
      const title = this.todo || a.title || this.verb || tr(`status.${a.kind}`);
      return {
        spinner: SPINNER[Math.floor(this.t * 8) % SPINNER.length],
        title: `${hovered && this.project ? this.project + ' · ' : ''}${title}…`,
        elapsed: secs > 0 ? `${secs}s` : '',
        sub: a.sub || '',
        code: !!a.code,
        alpha: 1,
      };
    }
    if (hovered) return { title: this.info().title, sub: this.world.hoverLine(this), alpha: 0.95 };
    return null;
  }

  // 进度卡片：这一轮的待办（✓ 做完 / ▸ 在做 / ○ 没做）、工具调用次数、改过的文件、最近一条命令
  cardView() {
    const g = this.progress || { todos: [], tools: 0, files: [], errors: 0 };
    const a = this.activity;
    const since = this.turnStart || (a && a.since);
    const working = !!(a && !this.holding());
    const stats = [tr('card.tools', { n: g.tools })];
    if (g.fileCount) stats.push(tr('card.files', { n: g.fileCount }));
    if (g.errors) stats.push(tr('card.errors', { n: g.errors }));
    return {
      card: true,
      title: `${this.project || tr('pet.free')} · ${working ? tr('card.working') : tr('card.lastTurn')}`,
      elapsed: working && since ? fmtDuration(performance.now() - since) : '',
      todos: (g.todos || []).slice(0, 7),
      more: Math.max(0, (g.todoCount || 0) - 7),
      stats: stats.join(' · '),
      files: (g.files || []).join('  '),
      cmd: g.lastCmd || '',
      alpha: 1,
    };
  }

  miniPos(i) {
    const w = this.world;
    const Pm = Math.max(2, Math.round(this.P * 0.55));
    const mw = (16 * Pm) / w.dpr;
    const gap = mw + 3;
    let side = -this.facing;
    let x = this.x + side * (this.halfW + mw / 2 + 2 + i * gap);
    if (x < mw / 2 || x > w.width - mw / 2) {
      side = -side;
      x = this.x + side * (this.halfW + mw / 2 + 2 + i * gap);
    }
    return { x, y: this.y, Pm, h: (10 * Pm) / w.dpr };
  }

  // 每帧都根据姿势更新（不只在重画时），点击范围才跟得上跳动的身体
  notePose(pose) {
    this.lastHop = pose.hop;
    this.lastSway = pose.sway;
    this.lastTop = pose.top || 0;
    this.lastSign = pose.props.some((k) => k.startsWith('sign'));
  }

  // 头顶上方被占掉的高度：举着的牌子、戴着的帽子
  overhead() {
    return ((this.lastSign ? 11 : 0) + this.headroom) * this.Pd;
  }

  draw(ctx, pose) {
    const dpr = this.world.dpr;
    drawPet(ctx, (this.x + pose.sway) * dpr, (this.y - pose.hop) * dpr, this.P, this.palette, pose.flip, pose);

    if (!this.ground || this.leaving) return;
    this.minis.forEach((m, i) => {
      const pos = this.miniPos(i);
      const age = this.t - m.born;
      let x = pos.x;
      let y = pos.y;
      if (age < 0.4) {
        // 从头顶蹦出来
        const k = age / 0.4;
        x = this.x + (pos.x - this.x) * k;
        y = pos.y - Math.sin(k * Math.PI) * 40 - (1 - k) * this.height;
      }
      const done = m.dying != null;
      const typing = Math.floor((this.t + i * 0.3) * 9) % 2;
      const mp = done
        ? { t: this.t, eyes: 'happy', armL: 'high', armR: 'high', shadow: true }
        : { t: this.t, eyes: 'down', armL: typing ? 4 : 5, armR: typing ? 5 : 4, props: ['laptop'], shadow: age >= 0.4 };
      const hop = done ? Math.abs(Math.sin((this.t - m.dying) * Math.PI * 4)) * 6 : 0;
      drawPet(ctx, x * dpr, (y - hop) * dpr, pos.Pm, this.palette, this.facing < 0, mp);
    });
  }

  // 点击范围（含四周余量 m）：身体、举着的牌子、跳起来的高度都算
  hitBox(m = 3) {
    const hw = this.halfW;
    const cx = this.x + (this.lastSway || 0);
    const top = this.y - this.height - this.overhead() - (this.lastHop || 0);
    return { l: cx - hw - m, r: cx + hw + m, t: top - m, b: this.y + m };
  }

  hitTest(x, y, m = 3) {
    const b = this.hitBox(m);
    return x >= b.l && x <= b.r && y >= b.t && y <= b.b;
  }
}
