// 热修复：九个终端窗口里不停冒出 Bug，点掉（或按数字键 1-9）就修好了。红色的线上事故分高，
// 但让它溜走要扣一颗心；绿色的新功能别点，点了也扣心。连着修越多分越高，60 秒或者心扣完结束。
// 什么时候、哪个窗口、冒出什么都按 env 的随机数提前排好（今日挑战大家一样；格子被占着那一个就不出）。
(() => {
  const ROUND = 60;
  const LIVES = 3;
  const COLS = 3;
  const CELL = { w: 74, h: 50, gap: 8 };
  const GRID = { x: 360 - 14 - (3 * 74 + 2 * 8), y: 30 };
  const KINDS = {
    bug: { score: 10, rows: ['.k....k.', '..k..k..', '.kGGGGk.', 'kGGgGGGk', '.GgGGgG.', 'kGGGGGGk', '.k.GG.k.'], colors: { k: '#1F1611', G: '#7DB85C', g: '#3F7A32' } },
    incident: { score: 25, rows: ['.k....k.', '..k..k..', '.kRRRRk.', 'kRRwwRRk', '.RRwwRR.', 'kRRRRRRk', '.k.RR.k.'], colors: { k: '#1F1611', R: '#E5484D', w: '#FFF2B0' } },
    feature: { score: 0 },
  };
  const POP_IN = 0.12;
  const POP_OUT = 0.15;
  const HAMMER = ['HHHHHHH', 'HhhhhhH', 'HHHHHHH', '...s...', '...s...', '...s...', '...s...'];
  const HAMMER_C = { H: '#7E8496', h: '#B4BAC8', s: '#A0663A' };

  const cellRect = (i) => ({ x: GRID.x + (i % COLS) * (CELL.w + CELL.gap), y: GRID.y + Math.floor(i / COLS) * (CELL.h + CELL.gap), w: CELL.w, h: CELL.h });

  class Whack {
    constructor(env) {
      this.env = env;
      this.t = 0;
      this.left = ROUND;
      this.score = 0;
      this.lives = LIVES;
      this.combo = 0;
      this.maxCombo = 0;
      this.fixed = 0;
      this.incidents = 0;
      this.oops = 0; // 误伤新功能
      this.escaped = 0; // 让事故溜走
      this.cells = Array(9).fill(null);
      this.planned = []; // 排过的每一个（今日挑战的测试看它）
      this.nextAt = 0.6;
      this.bonks = [];
      this.floats = [];
      this.react = { kind: '', t: -9 };
      this.ending = 0;
      this.over = false;
    }

    // 越往后冒得越快、待得越短
    get pace() {
      return Math.min(1, (ROUND - this.left) / ROUND);
    }

    // 排下一个：先定格子、种类、待多久（每次固定用三个随机数，玩法不同也不会错开）
    plan() {
      const { rng } = this.env;
      const cell = Math.floor(rng() * 9);
      const r = rng();
      const kind = r < 0.14 ? 'feature' : r < 0.14 + 0.08 + this.pace * 0.1 ? 'incident' : 'bug';
      const life = (1.6 - this.pace * 0.6) * (0.85 + rng() * 0.3) * (kind === 'incident' ? 0.9 : 1);
      this.planned.push({ cell, kind });
      if (!this.cells[cell]) this.cells[cell] = { kind, age: 0, life, hit: 0 };
      this.nextAt = this.t + (0.85 - this.pace * 0.45);
    }

    update(dt, input) {
      this.t += dt;
      for (const b of this.bonks) b.age += dt;
      this.bonks = this.bonks.filter((b) => b.age < 0.35);
      for (const f of this.floats) {
        f.y -= 18 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      if (this.ending) {
        this.ending -= dt;
        if (this.ending <= 0) this.over = true;
        return;
      }
      this.left -= dt;
      if (this.left <= 0 || this.lives <= 0) {
        this.left = Math.max(0, this.left);
        this.ending = 1.1;
        this.env.sound('over');
        return;
      }
      while (this.t >= this.nextAt) this.plan();

      // 冒出来的待够了就缩回去；事故溜走扣心
      this.cells.forEach((c, i) => {
        if (!c) return;
        c.age += dt;
        if (c.hit) {
          c.hit += dt;
          if (c.hit > 0.3) this.cells[i] = null;
          return;
        }
        if (c.age > c.life + POP_OUT) {
          this.cells[i] = null;
          if (c.kind === 'incident') {
            this.escaped++;
            this.loseLife(i, tr('whack.escaped'));
          } else if (c.kind === 'bug') this.combo = 0;
        }
      });

      // 点格子，或者按数字键（1-9 从左上到右下）
      for (let i = 0; i < 9; i++) {
        const r = cellRect(i);
        if (input.takeClick(r) || input.hit(`n${i + 1}`)) this.whack(i);
      }
    }

    whack(i) {
      const c = this.cells[i];
      const r = cellRect(i);
      this.bonks.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 + 4, age: 0 });
      if (!c || c.hit || c.age > c.life + POP_OUT * 0.5) {
        // 敲空了：连击断掉
        this.combo = 0;
        this.env.sound('move');
        return;
      }
      c.hit = 0.001;
      if (c.kind === 'feature') {
        this.oops++;
        this.loseLife(i, tr('whack.oops'));
        return;
      }
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.fixed++;
      if (c.kind === 'incident') this.incidents++;
      const points = KINDS[c.kind].score + Math.min(Math.floor(this.combo / 5), 4) * 5; // 连击每 5 个多 5 分，最多多 20
      this.score += points;
      this.floats.push({ text: `+${points}`, x: r.x + r.w / 2, y: r.y + 12, life: 0.7, color: c.kind === 'incident' ? '#FF9A8A' : C.gold });
      this.react = { kind: 'hit', t: this.t };
      this.env.sound(c.kind === 'incident' ? 'gold' : 'catch');
    }

    loseLife(i, text) {
      const r = cellRect(i);
      this.lives--;
      this.combo = 0;
      this.floats.push({ text, x: r.x + r.w / 2, y: r.y + 12, life: 1, color: '#FF8A7A' });
      this.react = { kind: 'hurt', t: this.t };
      this.env.sound('bad');
    }

    draw(g, t) {
      g.rect(-4, -4, W + 8, H + 8, '#1D2130');
      const k = this.left / ROUND;
      g.rect(0, 17, W, 2, '#262B3D');
      g.rect(0, 17, W * k, 2, k > 0.3 ? C.green : k > 0.12 ? C.gold : C.red);
      for (let i = 0; i < 9; i++) this.drawCell(g, t, i);
      for (const b of this.bonks) {
        const a = 1 - b.age / 0.35;
        g.alpha(a, () => {
          for (let j = 0; j < 6; j++) {
            const ang = (j / 6) * Math.PI * 2;
            const d = 6 + b.age * 40;
            g.rect(b.x + Math.cos(ang) * d - 1, b.y + Math.sin(ang) * d - 1, 2, 2, '#FFE29A');
          }
        });
      }
      this.drawPet(g, t);
      for (const f of this.floats) g.alpha(Math.min(1, f.life / 0.4), () => g.text(f.text, f.x, f.y, { size: 8, weight: 800, color: f.color, align: 'center' }));
      // 鼠标位置画一把小锤子，刚敲过是落下去的样子
      const p = this.pointer;
      if (p && inside(p, { x: GRID.x - 4, y: GRID.y - 4, w: 3 * CELL.w + 2 * CELL.gap + 8, h: 3 * CELL.h + 2 * CELL.gap + 8 })) {
        const down = this.bonks.some((b) => b.age < 0.12);
        g.sprite(HAMMER, HAMMER_C, p.x - 7, p.y - (down ? 6 : 12), 2, false);
      }
      if (this.ending) {
        g.round(W / 2 - 50, H / 2 - 14, 100, 28, 14, 'rgba(15,17,28,0.85)', null);
        g.text(tr(this.lives <= 0 ? 'whack.down' : 'whack.timeUp'), W / 2, H / 2, { size: 12, weight: 800, color: C.gold, align: 'center' });
      }
    }

    // 一个小终端窗口：标题栏、提示符，Bug 从里面冒出来（先变大再缩回去）
    drawCell(g, t, i) {
      const r = cellRect(i);
      const c = this.cells[i];
      const hot = c && c.kind === 'incident' && !c.hit;
      g.round(r.x, r.y, r.w, r.h, 4, '#252A3B', hot && Math.floor(t * 8) % 2 ? '#E5484D' : null, 1);
      g.round(r.x, r.y, r.w, 9, 4, '#2E3450', null);
      g.rect(r.x, r.y + 5, r.w, 4, '#2E3450');
      [C.red, C.gold, C.green].forEach((col, j) => g.circle(r.x + 6 + j * 5, r.y + 4.5, 1.4, col, null));
      g.text(String(i + 1), r.x + r.w - 6, r.y + 4.8, { size: 5, mono: true, color: '#5F6788', align: 'right' });
      g.text('$', r.x + 5, r.y + r.h - 7, { size: 6, mono: true, color: '#59607E' });
      if (!c) {
        if (Math.floor(t * 2) % 2) g.rect(r.x + 11, r.y + r.h - 10, 3, 6, '#59607E');
        return;
      }
      // 冒出来、待着、缩回去的大小
      let s = 1;
      if (c.hit) s = Math.max(0, 1 - c.hit / 0.3);
      else if (c.age < POP_IN) s = c.age / POP_IN;
      else if (c.age > c.life) s = Math.max(0, 1 - (c.age - c.life) / POP_OUT);
      const cx = r.x + r.w / 2;
      const cy = r.y + 9 + (r.h - 9) / 2 + 1;
      if (s <= 0.02) return;
      if (c.kind === 'feature') {
        const w = 40 * s;
        const h = 18 * s;
        g.round(cx - w / 2, cy - h / 2, w, h, 3 * s, '#2F6B3A', '#9BE38B', 1);
        if (s > 0.6) g.text('✓ feat', cx, cy + 0.5, { size: 6.5, mono: true, weight: 700, color: '#DFF5D8', align: 'center' });
      } else {
        const def = KINDS[c.kind];
        if (c.hit) g.spriteC(def.rows, { ...def.colors, k: '#1F1611' }, cx, cy, 2.4 * s);
        else g.spriteC(def.rows, def.colors, cx, cy + Math.sin(t * 18 + i) * 0.6, 2.4 * s);
        if (c.kind === 'incident' && s > 0.6 && !c.hit) g.text('P0', cx + 13, cy - 9, { size: 6, weight: 800, mono: true, color: '#FF9A8A', align: 'center' });
      }
      if (c.hit && c.kind !== 'feature') g.alpha(1 - c.hit / 0.3, () => g.text('✓', cx + 10, cy - 6, { size: 9, weight: 800, color: '#9BE38B', align: 'center' }));
    }

    // 左边的小章鱼：修好了举手，误伤或者事故溜走了冒汗
    drawPet(g, t) {
      const since = this.t - this.react.t; // 用这一局的时间比（t 是游戏厅开着以来的时间）
      let pose = { eyes: 'open', armL: 5, armR: 5, t };
      if (this.ending && this.lives <= 0) pose = { eyes: 'x', armL: 6, armR: 6, t };
      else if (this.react.kind === 'hit' && since < 0.35) pose = { eyes: 'happy', armL: 'high', armR: 4, t };
      else if (this.react.kind === 'hurt' && since < 0.6) pose = { eyes: 'wide', armL: 4, armR: 4, props: ['sweat'], t };
      g.rect(14, 207, 76, 2, '#2E3450');
      g.pet(52, 207, 2.6, pose, false);
      if (this.combo >= 5) g.text(tr('whack.combo', { n: this.combo }), 52, 128, { size: 7, weight: 800, color: C.gold, align: 'center' });
      g.text(String(this.fixed), 52, 52, { size: 16, weight: 800, color: C.cream, align: 'center' });
      g.text(tr('whack.fixedLabel'), 52, 66, { size: 6, color: C.dim, align: 'center' });
    }

    hud() {
      return { score: this.score, lives: this.lives, label: tr('whack.left', { s: Math.ceil(this.left) }) };
    }

    // 成就看一局修了多少个
    metrics() {
      return { fixed: this.fixed };
    }

    summary() {
      return [
        { text: tr('whack.fixedSum', { n: this.fixed, m: this.incidents }) },
        { text: tr('whack.comboSum', { n: this.maxCombo }) },
        { text: this.oops ? tr('whack.oopsSum', { n: this.oops }) : tr('whack.cleanSum') },
      ];
    }
  }

  // 让 draw 知道鼠标在哪（画锤子）
  const create = (env) => {
    const game = new Whack(env);
    Object.defineProperty(game, 'pointer', { get: () => input.pointer });
    return game;
  };

  ARCADE.register({
    id: 'whack',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#1D2130');
      const cw = w * 0.2;
      const ch = h * 0.24;
      const gx = x + w * 0.34;
      const gy = y + h * 0.1;
      const hotCell = Math.floor(t * 1.5) % 9;
      for (let i = 0; i < 9; i++) {
        const cx = gx + (i % 3) * (cw + 3);
        const cy = gy + Math.floor(i / 3) * (ch + 3);
        g.round(cx, cy, cw, ch, 2, '#252A3B', null);
        g.rect(cx, cy, cw, Math.max(2, ch * 0.18), '#2E3450');
        if (i === hotCell) g.spriteC(KINDS.bug.rows, KINDS.bug.colors, cx + cw / 2, cy + ch * 0.58, Math.max(1, h / 48));
        if (i === (hotCell + 4) % 9) g.spriteC(KINDS.incident.rows, KINDS.incident.colors, cx + cw / 2, cy + ch * 0.58, Math.max(1, h / 48));
      }
      const busy = Math.floor(t * 4) % 2;
      g.pet(x + w * 0.15, y + h - 4, Math.max(1, h / 44), { eyes: busy ? 'happy' : 'open', armL: busy ? 'high' : 5, armR: 5, t }, false);
    },
    create,
  });
})();
