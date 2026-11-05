// 调用栈：一层层往上叠栈帧。新的一帧在上面左右滑，按空格（或点一下）落下，没对齐的部分被切掉，
// 栈帧越来越窄；正好对齐不切，连着对齐还会变宽一点。一帧都没叠上就结束。叠到 50 层：Stack Overflow！
// 小章鱼在左边当调试器，眼睛跟着滑动的那一帧转。出什么函数、从哪边滑进来用 env 的随机数（今日挑战大家一样）。
(() => {
  const FH = 11; // 一帧多高
  const BASE_W = 110; // 最底下 main() 多宽
  const FIELD = { x: 98, w: 214 }; // 栈帧左右滑的范围
  const BASE_Y = 214; // 最底下那一帧的顶边（还没往上卷的时候）
  const TOP_MIN = 120; // 栈顶最高卷到屏幕这个位置
  const PERFECT = 3; // 差这么多以内算正好对齐
  const GROW = 5; // 连着对齐两次以上，每次变宽这么多
  const TIMEOUT = 6; // 一帧滑这么久还不落就自己掉下去（调用超时）
  const OVERFLOW = 50; // 叠到这么多层：Stack Overflow
  const OVERFLOW_BONUS = 50;
  const RECURSE_FROM = 40; // 快溢出的时候全是递归
  const GAUGE = { x: 334, y: 40, h: 160 };

  const NAMES = [
    'app.listen()', 'router.handle()', 'auth.check()', 'db.query()', 'JSON.parse()', 'render()', 'useEffect()', 'fetchUser()',
    'retry()', 'validate()', 'serialize()', 'logger.info()', 'cache.get()', 'compile()', 'resolve()', 'next()', 'emit()',
    'onClick()', 'map()', 'reduce()', 'parseArgs()', 'loadConfig()', 'connect()', 'sendMail()', 'hash()', 'sort()',
  ];
  const COLORS = ['#5B6B9A', '#3F7F6A', '#7E5A9A', '#9A6A3E', '#4F7FA8', '#6F7F3A', '#9A4F62', '#3F7A8A'];

  class Stack {
    constructor(env) {
      this.env = env;
      this.t = 0;
      this.score = 0;
      this.depth = 0; // 叠上去了几层（不算 main）
      this.perfects = 0;
      this.streak = 0;
      this.maxStreak = 0;
      this.frames = [{ x: FIELD.x + (FIELD.w - BASE_W) / 2, w: BASE_W, name: 'main()', color: '#B07A2A' }];
      this.debris = [];
      this.floats = [];
      this.cam = 0;
      this.overflowT = 0;
      this.overflowed = false;
      this.react = { kind: '', t: -9 };
      this.ending = 0;
      this.over = false;
      this.spawn();
    }

    get top() {
      return this.frames[this.frames.length - 1];
    }

    // 第 k 层（main 是第 0 层）的顶边在屏幕上的位置
    yOf(k) {
      return BASE_Y - k * FH + this.cam;
    }

    get speed() {
      return Math.min(60 + this.depth * 3.5, 170);
    }

    spawn() {
      const k = this.frames.length;
      const fromLeft = this.env.rng() < 0.5;
      const name = k >= RECURSE_FROM && k < OVERFLOW ? 'recurse()' : this.env.pick(NAMES);
      const w = this.top.w;
      this.slider = {
        x: fromLeft ? FIELD.x : FIELD.x + FIELD.w - w,
        w,
        dir: fromLeft ? 1 : -1,
        name,
        color: COLORS[k % COLORS.length],
        age: 0,
        from: fromLeft ? 'L' : 'R',
      };
    }

    update(dt, input) {
      this.t += dt;
      for (const d of this.debris) {
        d.vy += 420 * dt;
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        d.life -= dt;
      }
      this.debris = this.debris.filter((d) => d.life > 0 && d.y < H + 20);
      for (const f of this.floats) {
        f.y -= 18 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      // 镜头跟着栈顶往上卷：滑的那一帧不高过 TOP_MIN
      const want = Math.max(0, TOP_MIN - BASE_Y + this.frames.length * FH);
      this.cam += (want - this.cam) * Math.min(1, dt * 6);
      if (this.overflowT > 0) this.overflowT -= dt;
      if (this.ending) {
        this.ending -= dt;
        if (this.ending <= 0) this.over = true;
        return;
      }
      const s = this.slider;
      s.age += dt;
      s.x += s.dir * this.speed * dt;
      const maxX = FIELD.x + FIELD.w - s.w;
      if (s.x < FIELD.x) {
        s.x = FIELD.x + (FIELD.x - s.x);
        s.dir = 1;
      } else if (s.x > maxX) {
        s.x = maxX - (s.x - maxX);
        s.dir = -1;
      }
      s.x = clamp(s.x, FIELD.x, maxX);
      const press = input.hit('space', 'enter', 'up') || input.takeClick({ x: 0, y: 18, w: W, h: H - 18 });
      if ((press && s.age > 0.08) || s.age >= TIMEOUT) this.drop();
    }

    drop() {
      const s = this.slider;
      const top = this.top;
      const y = this.yOf(this.frames.length); // 这一帧的顶边
      const off = s.x - top.x;
      if (Math.abs(off) <= PERFECT) {
        // 正好对齐：不切；连着对齐两次以上还变宽一点
        this.streak++;
        this.perfects++;
        this.maxStreak = Math.max(this.maxStreak, this.streak);
        let { w } = top;
        let x = top.x;
        if (this.streak >= 2 && w < BASE_W) {
          const add = Math.min(GROW, BASE_W - w);
          x = clamp(x - add / 2, FIELD.x, FIELD.x + FIELD.w - (w + add));
          w += add;
        }
        this.place({ ...s, x, w }, 2 + Math.min(this.streak, 5));
        this.floats.push({ text: this.streak > 1 ? tr('stack.perfectN', { n: this.streak }) : tr('stack.perfect'), x: x + w / 2, y: y - 6, life: 0.9, color: C.gold });
        this.react = { kind: 'perfect', t: this.t };
        this.env.sound('right');
        return;
      }
      this.streak = 0;
      const left = Math.max(s.x, top.x);
      const right = Math.min(s.x + s.w, top.x + top.w);
      if (right - left <= 0.5) {
        // 一点都没叠上：整帧掉下去，结束
        this.debris.push({ x: s.x, y, w: s.w, vy: 0, vx: s.dir * 30, life: 2, color: s.color, name: s.name });
        this.slider = null;
        this.react = { kind: 'miss', t: this.t };
        this.ending = 1.3;
        this.env.sound('over');
        return;
      }
      // 切掉悬空的那一截
      const cutX = s.x < top.x ? s.x : right;
      const cutW = s.w - (right - left);
      this.debris.push({ x: cutX, y, w: cutW, vy: 0, vx: (s.x < top.x ? -1 : 1) * 25, life: 1.6, color: s.color });
      this.place({ ...s, x: left, w: right - left }, 1);
      this.react = { kind: 'cut', t: this.t };
      this.env.sound('catch');
    }

    place(frame, points) {
      this.frames.push({ x: frame.x, w: frame.w, name: frame.name, color: frame.color });
      this.depth++;
      this.score += points;
      if (this.depth === OVERFLOW && !this.overflowed) {
        this.overflowed = true;
        this.overflowT = 2.8;
        this.score += OVERFLOW_BONUS;
        this.env.sound('level');
      }
      this.spawn();
    }

    draw(g, t) {
      g.rect(-4, -4, W + 8, H + 8, this.depth >= RECURSE_FROM && !this.overflowed ? '#251C2A' : '#1D2130');
      // 背景：淡淡的横线，往上卷的时候跟着动，看得出在往上走
      const shift = this.cam % 22;
      for (let y = 18 + shift; y < H; y += 22) g.rect(FIELD.x - 6, y, FIELD.w + 12, 0.6, 'rgba(255,255,255,0.035)');
      g.rect(FIELD.x - 6, 18, 0.8, H, 'rgba(255,255,255,0.06)');
      g.rect(FIELD.x + FIELD.w + 5, 18, 0.8, H, 'rgba(255,255,255,0.06)');

      // 叠好的栈帧：只画屏幕上看得见的
      this.frames.forEach((f, k) => {
        const y = this.yOf(k);
        if (y > H + 2 || y < 4) return;
        this.drawFrame(g, f, y, k === 0);
      });
      // 正在滑的那一帧和它的超时条
      const s = this.slider;
      if (s) {
        const y = this.yOf(this.frames.length);
        this.drawFrame(g, s, y, false, true);
        const left = 1 - s.age / TIMEOUT;
        if (left < 0.5) g.rect(s.x, y + FH + 1, s.w * (left / 0.5), 1.2, left < 0.2 ? '#FF7A7A' : C.gold);
      }
      for (const d of this.debris) g.alpha(Math.min(1, d.life / 0.6), () => this.drawFrame(g, d, d.y, false));

      this.drawGauge(g, t);
      this.drawPanel(g);
      this.drawPet(g, t);
      for (const f of this.floats) g.alpha(Math.min(1, f.life / 0.4), () => g.text(f.text, f.x, f.y, { size: 8, weight: 800, color: f.color, align: 'center' }));

      if (this.overflowT > 0) {
        const k = Math.min(1, (2.8 - this.overflowT) / 0.25, this.overflowT / 0.4);
        g.alpha(k, () => {
          g.round(W / 2 - 90, 46, 180, 40, 8, 'rgba(15,17,28,0.9)', C.gold, 1.2);
          g.text(tr('stack.overflow'), W / 2, 60, { size: 13, weight: 800, mono: true, color: C.gold, align: 'center' });
          g.text(tr('stack.overflowSub', { n: OVERFLOW_BONUS }), W / 2, 75, { size: 6.5, color: C.cream, align: 'center' });
        });
      }
      if (this.ending && this.ending < 1.1) {
        g.round(W / 2 - 62, H / 2 - 30, 124, 26, 13, 'rgba(15,17,28,0.88)', null);
        g.text(tr('stack.broken'), W / 2, H / 2 - 17, { size: 10, weight: 800, color: '#FF8A7A', align: 'center' });
      }
    }

    drawFrame(g, f, y, base, live) {
      if (f.w <= 0.3) return;
      g.round(f.x, y, f.w, FH - 1, 2, f.color, null);
      g.rect(f.x, y, f.w, 1.2, 'rgba(255,255,255,0.18)');
      if (live) g.round(f.x - 0.5, y - 0.5, f.w + 1, FH, 2.5, null, 'rgba(255,255,255,0.55)', 0.8);
      const o = { size: 6, mono: true };
      if (f.name && g.measure(f.name, o) < f.w - 6) g.text(f.name, f.x + f.w / 2, y + FH / 2 - 0.3, { ...o, color: base ? '#FFF2D6' : 'rgba(255,255,255,0.88)', align: 'center' });
    }

    // 右边的刻度：离 Stack Overflow 还有多远
    drawGauge(g, t) {
      const { x, y, h } = GAUGE;
      const k = Math.min(1, this.depth / OVERFLOW);
      g.round(x, y, 6, h, 3, '#262B3D', null);
      const color = this.overflowed ? C.gold : this.depth >= RECURSE_FROM ? (Math.floor(t * 4) % 2 ? '#FF7A7A' : '#C2452D') : C.green;
      if (k > 0) g.round(x, y + h * (1 - k), 6, h * k, 3, color, null);
      g.text(String(OVERFLOW), x + 3, y - 7, { size: 6, weight: 800, color: this.overflowed ? C.gold : C.dim, align: 'center' });
      g.text(String(this.depth), x + 3, y + h + 8, { size: 7, weight: 800, color: C.cream, align: 'center' });
    }

    // 左边的小章鱼：眼睛跟着滑的那一帧，对齐了举手，切掉一截瞪眼，掉了晕过去
    drawPet(g, t) {
      const since = t - this.react.t;
      const s = this.slider;
      const look = s ? (s.x + s.w / 2 > FIELD.x + FIELD.w / 2 ? 1 : -1) : 0;
      let pose = { eyes: 'open', dx: look, armL: 5, armR: 5, t };
      if (this.ending || this.react.kind === 'miss') pose = { eyes: 'x', armL: 6, armR: 6, t };
      else if (this.react.kind === 'perfect' && since < 0.6) pose = { eyes: 'happy', armL: 'high', armR: 'high', blush: true, t };
      else if (this.react.kind === 'cut' && since < 0.35) pose = { eyes: 'wide', dx: look, armL: 4, armR: 4, t };
      const hop = this.react.kind === 'perfect' && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) * 5 : 0;
      g.rect(18, 207, 66, 2, '#2E3450');
      g.pet(51, 207 - hop, 2.4, pose, look < 0);
      if (this.streak >= 2) g.text(tr('stack.streak', { n: this.streak }), 51, 160, { size: 7, weight: 800, color: C.gold, align: 'center' });
    }

    // 左上角像调试器里的调用栈：正在滑的那一帧在最上面，往下是叠好的（只列最上面几帧）
    drawPanel(g) {
      const P = { x: 10, y: 26, w: 80, h: 120 };
      g.round(P.x, P.y, P.w, P.h, 4, '#232838', null);
      g.text(tr('stack.name'), P.x + 6, P.y + 8, { size: 6, weight: 700, color: C.dim });
      const o = { size: 5.5, mono: true };
      const fit = (str) => {
        let out = str;
        while (out.length > 1 && g.measure(out, o) > P.w - 12) out = out.slice(0, -2) + '…';
        return out;
      };
      const rows = [];
      if (this.slider) rows.push({ text: `▸ ${this.slider.name}`, color: C.gold });
      const MAX = 9;
      for (let k = this.frames.length - 1; k >= 0 && rows.length < MAX; k--) rows.push({ text: `at ${this.frames[k].name}`, color: k === 0 ? '#E8C27A' : '#A9B0C8' });
      const hidden = this.frames.length + (this.slider ? 1 : 0) - rows.length;
      if (hidden > 0) rows[rows.length - 1] = { text: tr('stack.more', { n: hidden + 1 }), color: '#5F6788', ui: true };
      rows.forEach((r, i) => g.text(r.ui ? r.text : fit(r.text), P.x + 6, P.y + 20 + i * 11, r.ui ? { size: 5.5, color: r.color } : { ...o, color: r.color }));
    }

    hud() {
      return { score: this.score, lives: null, label: tr('stack.hud', { n: this.depth }) };
    }

    // 成就看叠了多少层
    metrics() {
      return { depth: this.depth };
    }

    summary() {
      const lines = [{ text: tr('stack.depthSum', { n: this.depth }) }, { text: this.perfects ? tr('stack.perfectSum', { n: this.perfects, m: this.maxStreak }) : tr('stack.perfectNone') }];
      if (this.overflowed) lines.push({ text: tr('stack.overflowSum', { n: OVERFLOW }) });
      return lines;
    }
  }

  ARCADE.register({
    id: 'stack',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#1D2130');
      const fh = Math.max(5, h / 9);
      const cx = x + w * 0.6;
      const widths = [0.5, 0.46, 0.46, 0.4, 0.34];
      const shifts = [0, 0.02, -0.01, 0.03, 0.01];
      widths.forEach((fw, i) => {
        const ww = fw * w;
        g.round(cx - ww / 2 + shifts[i] * w, y + h - 4 - (i + 1) * fh, ww, fh - 1, 1.5, i ? COLORS[i % COLORS.length] : '#B07A2A', null);
      });
      // 最上面那一帧在滑
      const ww = 0.34 * w;
      const k = (Math.sin(t * 2.2) + 1) / 2;
      const sx = x + w * 0.3 + k * (w * 0.62 - ww);
      g.round(sx, y + h - 4 - 6 * fh - 2, ww, fh - 1, 1.5, COLORS[5], 'rgba(255,255,255,0.6)', 0.6);
      g.pet(x + w * 0.15, y + h - 4, Math.max(1, h / 44), { eyes: 'open', dx: sx > cx - ww / 2 ? 1 : -1, t }, false);
    },
    create: (env) => new Stack(env),
  });
})();
