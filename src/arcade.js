// 章鱼游戏厅的成绩：每个游戏的最高分、玩了几次。存在 userData/arcade.json
const fs = require('fs');
const { writeJsonAtomic } = require('./jsonfile');

const GAMES = ['bugs', 'hop', 'approve'];
const MAX_SCORE = 10_000_000;

class ArcadeScores {
  constructor(file) {
    this.file = file;
    this.data = { best: {}, plays: {}, bestAt: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of Object.keys(this.data)) if (saved && typeof saved[key] === 'object') this.data[key] = saved[key];
    } catch {}
  }

  // { bugs: { best, plays }, ... }
  summary() {
    return Object.fromEntries(GAMES.map((g) => [g, { best: this.data.best[g] || 0, plays: this.data.plays[g] || 0 }]));
  }

  // 一局结束：记下来，返回 { best, prev, record, plays }；不认识的游戏返回 null
  record(game, score) {
    if (!GAMES.includes(game)) return null;
    const n = Math.min(MAX_SCORE, Math.max(0, Math.floor(Number(score) || 0)));
    const prev = this.data.best[game] || 0;
    const record = n > prev;
    if (record) {
      this.data.best[game] = n;
      this.data.bestAt[game] = new Date().toISOString();
    }
    this.data.plays[game] = (this.data.plays[game] || 0) + 1;
    try {
      writeJsonAtomic(this.file, this.data);
    } catch {}
    return { best: Math.max(prev, n), prev, record, plays: this.data.plays[game] };
  }
}

module.exports = { ArcadeScores, GAMES };
