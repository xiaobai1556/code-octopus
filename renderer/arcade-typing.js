// 敲代码：60 秒，跟着小章鱼一行一行地敲代码。敲对一个字往前一格（变绿），敲错了原地不动，要敲对才走；
// 整行一个都没错有奖励。越往后行越长。结算看 WPM（每分钟几个"词"，5 个字符算一个）和准确率。
// 出哪几行用 env 的随机数：今日挑战时大家拿到同样的一串，敲得快的看到的多一些。
(() => {
  const ROUND = 60; // 一局几秒
  const PERFECT = 10; // 整行没错的奖励
  const ED = { x: 108, y: 30, w: 242, h: 150 }; // 编辑器
  const LINE_H = 14;
  const SHOW_NEXT = 4; // 当前行下面看得见几行

  // 只用美式键盘上能直接敲出来的字符
  const SHORT = ['ls -la', 'git status', 'npm test', 'cd src', 'x += 1', 'import os', 'git pull', 'make build', 'docker ps', 'return null;', 'echo $PATH', 'cargo run', 'git add .', 'npm i', 'pwd'];
  const MEDIUM = [
    'const sum = a + b;', 'git commit -m "fix"', 'print("hello")', 'if (!user) return;', 'SELECT * FROM users;', 'git checkout -b dev', 'def add(a, b):',
    'mkdir -p src/utils', 'export default App;', 'npm run build', 'await fetch(url);', 'fn main() {}', 'cat package.json', 'grep -rn TODO .', 'let total = 0;',
  ];
  const LONG = [
    'const double = (n) => n * 2;', 'for i in range(10): print(i)', 'git push origin feature/login', 'if (err) throw new Error(err);', 'items.filter((x) => x.done).length',
    'docker run -p 8080:80 nginx', 'SELECT name FROM users WHERE id = 1;', 'console.log(`hi ${name}`);', 'pip install -r requirements.txt', 'return { ok: true, data };',
  ];

  class Typing {
    constructor(env) {
      this.env = env;
      this.textInput = true; // 外壳：字母键都当打字用，只有 Esc 暂停
      this.t = 0;
      this.left = ROUND;
      this.score = 0;
      this.correct = 0;
      this.errors = 0;
      this.lines = 0;
      this.perfect = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.done = []; // 敲完的行（编辑器上面那几行）
      this.queue = [];
      this.picked = 0; // 一共挑了几行（决定下一行从哪一堆里挑）
      this.typedAt = -1;
      this.errAt = -1;
      this.floats = [];
      this.ending = 0;
      this.over = false;
      this.fill();
      this.nextLine();
    }

    // 下一行从哪一堆里挑：开头短的，慢慢变长
    pickLine(k) {
      const { pick, rng } = this.env;
      if (k < 3) return pick(SHORT);
      if (k < 8) return rng() < 0.75 ? pick(MEDIUM) : pick(SHORT);
      return rng() < 0.55 ? pick(LONG) : pick(MEDIUM);
    }

    // 预先排好后面几行（编辑器里看得见，可以往前瞄）
    fill() {
      while (this.queue.length < SHOW_NEXT + 1) this.queue.push(this.pickLine(this.picked++));
    }

    nextLine() {
      this.line = this.queue.shift();
      this.pos = 0;
      this.lineErrors = 0;
      this.fill();
    }

    // 开头几秒样本太少，按至少 5 秒算，免得一上来就显示几百
    get wpm() {
      const minutes = Math.max(5, ROUND - this.left) / 60;
      return Math.round(this.correct / 5 / minutes);
    }

    get accuracy() {
      const all = this.correct + this.errors;
      return all ? Math.round((this.correct / all) * 100) : 100;
    }

    update(dt, input) {
      this.t += dt;
      for (const f of this.floats) {
        f.y -= 20 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      if (this.ending) {
        this.ending -= dt;
        if (this.ending <= 0) this.over = true;
        return;
      }
      this.left -= dt;
      if (this.left <= 0) {
        this.left = 0;
        this.ending = 1.1; // 先亮一下"时间到"
        this.env.sound('over');
        return;
      }
      for (const ch of input.typed) this.type(ch);
    }

    type(ch) {
      this.typedAt = this.t;
      if (ch !== this.line[this.pos]) {
        this.errors++;
        this.lineErrors++;
        this.combo = 0;
        this.errAt = this.t;
        this.env.sound('move');
        return;
      }
      this.pos++;
      this.correct++;
      this.score++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (this.pos < this.line.length) return;
      // 一行敲完：整行没错有奖励
      this.lines++;
      const bonus = this.lineErrors ? 0 : PERFECT;
      if (bonus) this.perfect++;
      this.score += bonus;
      this.floats.push({ text: bonus ? `✓ +${bonus}` : '✓', x: ED.x + ED.w - 20, y: ED.y + 70, life: 0.9, color: bonus ? C.gold : '#9BE38B' });
      this.env.sound(bonus ? 'right' : 'catch');
      this.done.push({ text: this.line, perfect: !this.lineErrors });
      if (this.done.length > 3) this.done.shift();
      this.nextLine();
    }

    draw(g, t) {
      g.rect(-4, -4, W + 8, H + 8, '#1D2130');
      // 剩下的时间：状态栏下面一根细条
      const k = this.left / ROUND;
      g.rect(0, 17, W, 2, '#262B3D');
      g.rect(0, 17, W * k, 2, k > 0.3 ? C.green : k > 0.12 ? C.gold : C.red);

      // 编辑器：标题栏、行号、敲完的几行、当前这一行（大一点）、后面两行
      g.round(ED.x, ED.y, ED.w, ED.h, 6, '#252A3B', null);
      g.round(ED.x, ED.y, ED.w, 12, 6, '#2E3450', null);
      g.rect(ED.x, ED.y + 6, ED.w, 6, '#2E3450');
      [C.red, C.gold, C.green].forEach((c, i) => g.circle(ED.x + 7 + i * 6, ED.y + 6, 1.8, c, null));
      g.text('main.ts', ED.x + ED.w / 2, ED.y + 6.5, { size: 5.5, mono: true, color: C.dim, align: 'center' });
      const base = 10 + this.lines - this.done.length; // 行号接着往下数
      let y = ED.y + 24 + (3 - this.done.length) * (LINE_H - 3); // 敲完的行贴着当前行往上排
      this.done.forEach((d, i) => {
        g.text(String(base + i), ED.x + 14, y, { size: 5.5, mono: true, color: '#4A5070', align: 'right' });
        g.text(d.text, ED.x + 20, y, { size: 6.5, mono: true, color: d.perfect ? '#7FA47A' : '#6B7499' });
        y += LINE_H - 3;
      });
      y = ED.y + 24 + 3 * (LINE_H - 3) + 8;
      g.text(String(base + this.done.length), ED.x + 14, y, { size: 5.5, mono: true, color: C.gold, align: 'right' });
      g.rect(ED.x + 17, y - 9, ED.w - 21, 18, 'rgba(242,179,61,0.06)');
      this.drawLine(g, t, ED.x + 20, y);
      y += LINE_H + 6;
      this.queue.slice(0, SHOW_NEXT).forEach((q, i) => {
        g.text(String(base + this.done.length + 1 + i), ED.x + 14, y, { size: 5.5, mono: true, color: '#4A5070', align: 'right' });
        g.text(q, ED.x + 20, y, { size: 6.5, mono: true, color: '#59607E' });
        y += LINE_H - 3;
      });
      if (this.env.imeWarning && this.env.imeWarning()) g.text(tr('typing.ime'), ED.x + ED.w / 2, ED.y + ED.h - 7, { size: 6, weight: 700, color: '#FF9A8A', align: 'center' });

      // 小章鱼抱着笔记本敲：刚敲过键手在动，敲错了冒汗
      const busy = this.t - this.typedAt < 0.18; // 用这一局的时间比（t 是游戏厅开着以来的时间）
      const oops = this.t - this.errAt < 0.3;
      const typing = Math.floor(t * 14) % 2;
      g.pet(52, 182, 2.6, { eyes: oops ? 'wide' : 'down', armL: busy ? (typing ? 4 : 5) : 5, armR: busy ? (typing ? 5 : 4) : 5, props: oops ? ['laptop', 'sweat'] : ['laptop'], t }, false);
      g.rect(14, 183, 76, 2, '#2E3450');
      if (this.combo >= 10) g.text(tr('typing.combo', { n: this.combo }), 52, 120, { size: 7, weight: 800, color: C.gold, align: 'center' });
      // 下面一排：速度、准确率、敲完几行
      const stats = [
        [`${this.wpm}`, 'WPM'],
        [`${this.accuracy}%`, tr('typing.acc')],
        [`${this.lines}`, tr('typing.lines')],
      ];
      stats.forEach(([v, label], i) => {
        const x = ED.x + 6 + i * 82;
        g.text(v, x, 202, { size: 11, weight: 800, color: C.cream });
        g.text(label, x, 214, { size: 6, color: C.dim });
      });
      for (const f of this.floats) g.alpha(f.life / 0.5, () => g.text(f.text, f.x, f.y, { size: 8, weight: 800, color: f.color, align: 'center' }));
      if (this.ending) {
        g.round(W / 2 - 50, H / 2 - 14, 100, 28, 14, 'rgba(15,17,28,0.85)', null);
        g.text(tr('typing.timeUp'), W / 2, H / 2, { size: 12, weight: 800, color: C.gold, align: 'center' });
      }
    }

    // 当前这一行：敲过的绿色，光标那格带下划线（敲错时变红），后面的灰白
    drawLine(g, t, x, y) {
      const o = { size: 9, mono: true };
      const done = this.line.slice(0, this.pos);
      const rest = this.line.slice(this.pos);
      g.text(done, x, y, { ...o, color: '#9BE38B' });
      const dx = g.measure(done, o);
      const cw = g.measure(rest[0] === ' ' ? '_' : rest[0] || '_', o);
      const err = this.t - this.errAt < 0.25;
      if (err) g.rect(x + dx - 0.5, y - 6, cw + 1, 12, 'rgba(214,69,69,0.45)');
      g.text(rest, x + dx, y, { ...o, color: C.cream });
      if (Math.floor(t * 2.5) % 2 === 0 || err) g.rect(x + dx, y + 6, cw, 1.4, err ? '#FF7A7A' : C.gold);
    }

    hud() {
      return { score: this.score, lives: null, label: tr('typing.left', { s: Math.ceil(this.left), wpm: this.wpm }) };
    }

    // 成就看 WPM
    metrics() {
      return { wpm: this.wpm };
    }

    summary() {
      return [
        { text: tr('typing.speed', { wpm: this.wpm, acc: this.accuracy }) },
        { text: tr('typing.linesSum', { n: this.lines, perfect: this.perfect }) },
        { text: tr('typing.comboSum', { n: this.maxCombo }) },
      ];
    }
  }

  ARCADE.register({
    id: 'typing',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#1D2130');
      const k = Math.max(1, h / 60); // 规则页的画面大一些，字和章鱼跟着放大
      g.round(x + w * 0.36, y + 6, w * 0.6, h - 12, 3, '#252A3B', null);
      const line = 'const sum = a + b;';
      const n = Math.floor((t * 8) % (line.length + 6));
      const o = { size: 4.6 * k, mono: true };
      g.text(line.slice(0, Math.min(n, line.length)), x + w * 0.36 + 4, y + h / 2, { ...o, color: '#9BE38B' });
      g.text('npm test', x + w * 0.36 + 4, y + h / 2 + 8 * k, { ...o, color: '#59607E' });
      const busy = Math.floor(t * 10) % 2;
      g.pet(x + w * 0.18, y + h - 6, 1.2 * k, { eyes: 'down', armL: busy ? 4 : 5, armR: busy ? 5 : 4, props: ['laptop'], t });
    },
    create: (env) => new Typing(env),
  });
})();
