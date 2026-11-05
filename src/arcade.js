// 章鱼游戏厅的成绩：每个游戏的最高分、玩了几次。存在 userData/arcade.json
const fs = require('fs');
const { writeJsonAtomic } = require('./jsonfile');

const GAMES = ['bugs', 'hop', 'approve', 'defense'];
const MAX_SCORE = 10_000_000;
const KEEP_DAYS = 14; // 今日挑战的成绩只留最近两周

class ArcadeScores {
  constructor(file) {
    this.file = file;
    this.data = { best: {}, plays: {}, bestAt: {}, daily: {} }; // daily：{ 'YYYY-MM-DD': { bugs: 那天今日挑战的最好成绩 } }
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of Object.keys(this.data)) if (saved && typeof saved[key] === 'object') this.data[key] = saved[key];
    } catch {}
  }

  // { bugs: { best, plays }, ... }
  summary() {
    return Object.fromEntries(GAMES.map((g) => [g, { best: this.data.best[g] || 0, plays: this.data.plays[g] || 0 }]));
  }

  // 某天各个游戏今日挑战的最好成绩
  dailyOf(day) {
    return { ...(this.data.daily[day] || {}) };
  }

  // 一局结束：记下来，返回 { best, prev, record, plays, dailyBest, dailyRecord }；不认识的游戏返回 null。
  // day：这一局是哪天的今日挑战（平常的一局不传）；今日挑战的成绩也算进总的最高分
  record(game, score, day) {
    if (!GAMES.includes(game)) return null;
    const n = Math.min(MAX_SCORE, Math.max(0, Math.floor(Number(score) || 0)));
    const prev = this.data.best[game] || 0;
    const record = n > prev;
    if (record) {
      this.data.best[game] = n;
      this.data.bestAt[game] = new Date().toISOString();
    }
    this.data.plays[game] = (this.data.plays[game] || 0) + 1;
    let dailyBest = null;
    let dailyRecord = false;
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const d = (this.data.daily[day] ||= {});
      dailyRecord = n > (d[game] || 0);
      if (dailyRecord) d[game] = n;
      dailyBest = d[game] || 0;
      for (const old of Object.keys(this.data.daily).sort().slice(0, -KEEP_DAYS)) delete this.data.daily[old];
    }
    try {
      writeJsonAtomic(this.file, this.data);
    } catch {}
    return { best: Math.max(prev, n), prev, record, plays: this.data.plays[game], dailyBest, dailyRecord };
  }
}

module.exports = { ArcadeScores, GAMES };
