// 按天统计陪 Claude 干了多少活，给"每日小结"用。只存在本机 userData/stats.json 里。
const fs = require('fs');
const { writeJsonAtomic } = require('./jsonfile');

const KEEP_DAYS = 90;
const MAX_TURN_MS = 3 * 60 * 60 * 1000; // 一轮最多算 3 小时，防止忘了关的会话把时长撑爆
const MAX_KEYS = 300;
const MAX_COMMIT_LOG = 8; // 日报里列出当天最后几次提交

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function emptyDay() {
  return {
    prompts: 0,
    sessions: [],
    toolCount: 0,
    tools: { edit: 0, shell: 0, read: 0, web: 0, agent: 0, other: 0 },
    tests: { pass: 0, fail: 0 },
    errors: 0,
    approvals: 0,
    helpers: 0,
    done: 0,
    busyMs: 0,
    longestMs: 0,
    files: {},
    projects: {},
    hours: Array(24).fill(0),
    costUSD: 0,
    firstAt: null,
    lastAt: null,
  };
}

// 一辈子的累计数字（按天的数据只留 90 天），成就靠它判断
function emptyTotals() {
  return { sessions: 0, prompts: 0, tools: 0, edits: 0, testsPass: 0, helpers: 0, done: 0, busyMs: 0, lateNight: 0, earlyMorning: 0, eaten: 0, commits: 0, pushes: 0 };
}

const active = (d) => !!d && (d.prompts > 0 || d.toolCount > 0);

// 截至 key 这天连续干活的天数
function streakAt(days, key) {
  let n = 0;
  const d = new Date(key + 'T12:00:00');
  while (active(days[dayKey(d)])) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// 老版本只有按天的数据：从里面把累计数字补出来
function totalsFromDays(days) {
  const t = emptyTotals();
  const best = { dayTools: 0, streak: 0, turnMs: 0 };
  for (const [key, d] of Object.entries(days)) {
    t.sessions += d.sessions.length;
    t.prompts += d.prompts;
    t.tools += d.toolCount;
    t.edits += d.tools.edit || 0;
    t.testsPass += d.tests.pass;
    t.helpers += d.helpers;
    t.done += d.done;
    t.busyMs += d.busyMs;
    t.commits += d.commits || 0;
    t.pushes += d.pushes || 0;
    t.lateNight += d.hours.slice(0, 4).reduce((a, b) => a + b, 0);
    t.earlyMorning += d.hours.slice(5, 7).reduce((a, b) => a + b, 0);
    best.dayTools = Math.max(best.dayTools, d.toolCount);
    best.turnMs = Math.max(best.turnMs, d.longestMs);
    best.streak = Math.max(best.streak, streakAt(days, key));
  }
  return { totals: t, best };
}

function bump(map, key, n = 1) {
  if (!key) return;
  if (!(key in map) && Object.keys(map).length >= MAX_KEYS) return;
  map[key] = (map[key] || 0) + n;
}

class Stats {
  constructor(file) {
    this.file = file;
    this.data = { days: {}, lastCost: {}, unlocked: {} };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {}
    if (!this.data.totals) Object.assign(this.data, totalsFromDays(this.data.days));
    this.data.totals = { ...emptyTotals(), ...this.data.totals };
    this.turns = new Map(); // sessionId → 这一轮开始的时间
    this.saveTimer = null;
  }

  day(key = dayKey()) {
    return (this.data.days[key] ||= emptyDay());
  }

  get(key) {
    return this.data.days[key] || null;
  }

  dates() {
    return Object.keys(this.data.days).sort();
  }

  // 截至 endKey 这天的最近 n 天（老的在前）：每天的忙碌时长、工具调用、花费，没干活的那天是 0
  range(endKey, n = 30) {
    const [y, m, d] = endKey.split('-').map(Number);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = dayKey(new Date(y, m - 1, d - i));
      const day = this.data.days[key];
      out.push({ date: key, busyMs: day ? day.busyMs : 0, tools: day ? day.toolCount : 0, costUSD: day ? day.costUSD || 0 : 0, commits: day ? day.commits || 0 : 0, testsPass: day ? day.tests.pass : 0 });
    }
    return out;
  }

  // ev：summarize 之后的事件；costUSD：这个会话目前累计花费（读不到就是 null）
  record(ev, costUSD = null) {
    const now = new Date();
    const d = this.day(dayKey(now));
    d.lastAt = now.toISOString();
    if (!d.firstAt) d.firstAt = d.lastAt;
    const t = this.data.totals;
    const best = this.data.best;
    if (ev.sessionId && !d.sessions.includes(ev.sessionId)) {
      d.sessions.push(ev.sessionId);
      t.sessions++;
    }
    const hour = now.getHours();
    let turnMs = 0;
    // 夜猫子 / 早起鸟：这个点还在（或已经在）让 Claude 干活
    if (ev.event === 'UserPromptSubmit' || (ev.event === 'PreToolUse' && !ev.decision)) {
      if (hour < 4) t.lateNight++;
      else if (hour >= 5 && hour < 7) t.earlyMorning++;
    }

    switch (ev.event) {
      case 'UserPromptSubmit':
        d.prompts++;
        t.prompts++;
        d.hours[hour]++;
        if (d.prompts === 1) best.streak = Math.max(best.streak, streakAt(this.data.days, dayKey(now)));
        bump(d.projects, ev.project);
        this.turns.set(ev.sessionId, now.getTime());
        break;
      case 'PreToolUse':
        if (ev.decision) break;
        d.toolCount++;
        t.tools++;
        if (ev.toolKind === 'edit') t.edits++;
        best.dayTools = Math.max(best.dayTools, d.toolCount);
        d.tools[ev.toolKind in d.tools ? ev.toolKind : 'other']++;
        d.hours[hour]++;
        bump(d.projects, ev.project);
        if (ev.toolKind === 'edit') bump(d.files, ev.detail);
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        // git 提交、推送：日报里列出当天的提交说明（只留最后几条）
        if (ev.git && ev.git.op === 'commit') {
          d.commits = (d.commits || 0) + 1;
          t.commits = (t.commits || 0) + 1;
          d.commitLog = [...(d.commitLog || []), { text: String(ev.git.text || ''), project: ev.project || '' }].slice(-MAX_COMMIT_LOG);
        } else if (ev.git && ev.git.op === 'push') {
          d.pushes = (d.pushes || 0) + 1;
          t.pushes = (t.pushes || 0) + 1;
        }
        if (ev.test === 'pass') {
          d.tests.pass++;
          t.testsPass++;
        }
        else if (ev.test === 'fail') d.tests.fail++;
        else if (ev.error) d.errors++;
        break;
      case 'PermissionRequest':
        d.approvals++;
        break;
      case 'SubagentStart':
        d.helpers++;
        t.helpers++;
        break;
      case 'Stop':
      case 'StopFailure': {
        const start = this.turns.get(ev.sessionId);
        this.turns.delete(ev.sessionId);
        if (start) {
          turnMs = now.getTime() - start;
          const counted = Math.min(turnMs, MAX_TURN_MS);
          d.busyMs += counted;
          t.busyMs += counted;
          d.longestMs = Math.max(d.longestMs, counted);
          best.turnMs = Math.max(best.turnMs, counted);
        }
        if (ev.event === 'Stop') {
          d.done++;
          t.done++;
        }
        break;
      }
    }

    // 花费只记增量：同一个会话这次读到的累计花费比上次多出来的部分算到今天
    if (typeof costUSD === 'number' && ev.sessionId) {
      const last = this.data.lastCost[ev.sessionId];
      if (typeof last === 'number' && costUSD > last) d.costUSD += costUSD - last;
      this.data.lastCost[ev.sessionId] = costUSD;
    }

    this.scheduleSave();
    return { turnMs };
  }

  // 游戏厅一局结束，记到今天：玩了几局、最高分（日报里显示）
  recordGame(game, score) {
    const games = (this.day().games ||= {});
    const g = (games[game] ||= { plays: 0, best: 0 });
    g.plays++;
    g.best = Math.max(g.best, Math.max(0, Math.floor(Number(score) || 0)));
    this.scheduleSave();
  }

  // 游戏厅一局结束：每个指标记最好的那次（捉虫的轮数、窗口跳跳的米数、连对条数、塔防守住的波数）
  recordArcade(game, metrics) {
    const all = (this.data.arcade ||= {});
    const best = (all[game] ||= {});
    for (const [k, v] of Object.entries(metrics || {})) if (typeof v === 'number' && v > (best[k] || 0)) best[k] = v;
    this.scheduleSave();
  }

  // 喂它吃了几个文件
  recordEaten(n) {
    this.data.totals.eaten += n;
    this.day().eaten = (this.day().eaten || 0) + n;
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 5000);
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const keys = this.dates();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete this.data.days[k];
    const sessions = Object.keys(this.data.lastCost);
    for (const s of sessions.slice(0, Math.max(0, sessions.length - 200))) delete this.data.lastCost[s];
    try {
      writeJsonAtomic(this.file, this.data);
    } catch {}
  }
}

module.exports = { Stats, dayKey };
