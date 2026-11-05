// 依赖膨胀：贪吃蛇。小章鱼当蛇头，吃 npm 包，吃一个身后多拖一个纸箱，node_modules 越吃越大、走得越来越快。
// 大包（webpack、electron……）一口长三节；偶尔出现 npm dedupe，吃了队伍变短。撞墙是 npm ERR!，咬到自己是循环依赖。
// 下一个包放在哪、是什么都按 env 的随机数排（每个固定三个随机数；位置被占着就顺着往后找空格），今日挑战大家一样。
(() => {
  const CELL = 10;
  const COLS = 34;
  const ROWS = 21;
  const OX = 10;
  const OY = 24;
  const START_LEN = 3;
  const DEDUPE_CUT = 3;
  const PKGS = [
    ['lodash', 1.4], ['react', 0.3], ['express', 0.2], ['left-pad', 0.01], ['is-odd', 0.01], ['chalk', 0.04], ['moment', 4.2],
    ['axios', 0.5], ['rxjs', 4.4], ['three', 25], ['@babel/core', 6.1], ['eslint', 9.3], ['jest', 32], ['uuid', 0.1], ['dayjs', 0.2],
  ];
  const BIG = [['webpack', 5.6], ['typescript', 22], ['electron', 180], ['next', 98]];
  const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  const fmtSize = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : mb >= 10 ? `${Math.round(mb)} MB` : mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1000))} KB`);
  const cellX = (c) => OX + c * CELL;
  const cellY = (r) => OY + r * CELL;

  class Deps {
    constructor(env) {
      this.env = env;
      this.t = 0;
      this.score = 0;
      this.mb = 0;
      this.eaten = 0;
      this.deduped = 0;
      const r = Math.floor(ROWS / 2);
      this.snake = Array.from({ length: START_LEN }, (_, i) => ({ c: 8 - i, r }));
      this.dir = [1, 0];
      this.turns = [];
      this.grow = 0;
      this.moveT = 0;
      this.maxLen = START_LEN;
      this.facing = 1;
      this.planned = []; // 排过的每一个包（今日挑战的测试看它）
      this.queue = [];
      this.food = null;
      this.floats = [];
      this.eatAt = -9;
      this.cause = '';
      this.ending = 0;
      this.over = false;
      this.placeFood();
    }

    get speed() {
      return Math.min(6 + (this.snake.length - START_LEN) * 0.15, 12); // 每秒走几格
    }

    occupied(c, r) {
      return this.snake.some((s) => s.c === c && s.r === r);
    }

    // 后面的包提前排好三个（位置、种类、名字各用一个随机数），玩法不同也不会错开
    plan() {
      const { rng, pick } = this.env;
      const planIdx = Math.floor(rng() * COLS * ROWS);
      const roll = rng();
      const kind = roll < 0.08 ? 'dedupe' : roll < 0.2 ? 'big' : 'pkg';
      const pkg = pick(kind === 'big' ? BIG : PKGS);
      const p = { planIdx, kind, pkg };
      this.planned.push(p);
      return p;
    }

    // 放下一个包：位置被占着就顺着往后找空格；队伍太短时 dedupe 换成普通的包
    placeFood() {
      while (this.queue.length < 3) this.queue.push(this.plan());
      const { planIdx, pkg } = this.queue[0];
      let { kind } = this.queue.shift();
      if (kind === 'dedupe' && this.snake.length <= DEDUPE_CUT + START_LEN) kind = 'pkg';
      let idx = planIdx;
      for (let k = 0; k < COLS * ROWS && this.occupied(idx % COLS, Math.floor(idx / COLS)); k++) idx = (idx + 1) % (COLS * ROWS);
      this.food = { c: idx % COLS, r: Math.floor(idx / COLS), kind, name: kind === 'dedupe' ? 'npm dedupe' : pkg[0], mb: kind === 'dedupe' ? 0 : pkg[1], born: this.t };
      while (this.queue.length < 3) this.queue.push(this.plan());
    }

    update(dt, input) {
      this.t += dt;
      for (const f of this.floats) {
        f.y -= 16 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      if (this.ending) {
        this.ending -= dt;
        if (this.ending <= 0) this.over = true;
        return;
      }
      // 转向先排队（最多两步），不能直接掉头
      for (const [name, d] of Object.entries(DIRS)) {
        if (!input.hit(name)) continue;
        const last = this.turns.length ? this.turns[this.turns.length - 1] : this.dir;
        if (d[0] === -last[0] && d[1] === -last[1]) continue;
        if (d[0] === last[0] && d[1] === last[1]) continue;
        if (this.turns.length < 2) this.turns.push(d);
      }
      this.moveT += dt * this.speed;
      while (this.moveT >= 1 && !this.ending) {
        this.moveT -= 1;
        this.step();
      }
    }

    step() {
      if (this.turns.length) this.dir = this.turns.shift();
      if (this.dir[0]) this.facing = this.dir[0];
      const head = this.snake[0];
      const next = { c: head.c + this.dir[0], r: head.r + this.dir[1] };
      if (next.c < 0 || next.r < 0 || next.c >= COLS || next.r >= ROWS) return this.die('wall');
      // 尾巴这一步会挪开，所以撞到尾巴尖不算（除非正在变长）
      const body = this.grow > 0 ? this.snake : this.snake.slice(0, -1);
      if (body.some((s) => s.c === next.c && s.r === next.r)) return this.die('circular');
      this.snake.unshift(next);
      if (this.grow > 0) this.grow--;
      else this.snake.pop();
      const f = this.food;
      if (f && f.c === next.c && f.r === next.r) this.eat(f);
    }

    eat(f) {
      const x = cellX(f.c) + CELL / 2;
      const y = cellY(f.r);
      if (f.kind === 'dedupe') {
        const cut = Math.min(DEDUPE_CUT, this.snake.length - START_LEN);
        this.snake.length -= cut;
        this.deduped++;
        this.score += 15;
        this.floats.push({ text: tr('deps.deduped', { n: cut }), x, y, life: 1.1, color: '#9BE38B' });
        this.env.sound('gold');
      } else {
        const big = f.kind === 'big';
        this.grow += big ? 3 : 1;
        this.eaten++;
        this.mb += f.mb;
        this.score += big ? 25 : 10;
        this.floats.push({ text: `+${f.name}`, x, y, life: 0.9, color: big ? '#FF9A8A' : C.gold });
        this.env.sound(big ? 'level' : 'catch');
      }
      this.maxLen = Math.max(this.maxLen, this.snake.length + this.grow);
      this.eatAt = this.t;
      this.placeFood();
    }

    die(cause) {
      this.cause = cause;
      this.ending = 1.3;
      this.env.sound('over');
    }

    draw(g, t) {
      g.rect(-4, -4, W + 8, H + 8, '#1D2130');
      g.round(OX - 2, OY - 2, COLS * CELL + 4, ROWS * CELL + 4, 4, '#20253A', '#3A4160', 1);
      for (let c = 1; c < COLS; c++) g.rect(cellX(c), OY, 0.4, ROWS * CELL, 'rgba(255,255,255,0.03)');
      for (let r = 1; r < ROWS; r++) g.rect(OX, cellY(r), COLS * CELL, 0.4, 'rgba(255,255,255,0.03)');
      this.drawFood(g, t);
      // 身子：一串纸箱，从尾巴画到脖子
      for (let i = this.snake.length - 1; i >= 1; i--) this.drawBox(g, this.snake[i], i);
      // 头：小章鱼
      const h = this.snake[0];
      const dead = !!this.ending;
      const munch = this.t - this.eatAt < 0.25;
      g.pet(cellX(h.c) + CELL / 2, cellY(h.r) + CELL + 1, 0.8, { eyes: dead ? 'x' : munch ? 'happy' : 'open', mouth: munch ? 'open' : '', dx: this.dir[0] ? 1 : 0, dy: this.dir[1] < 0 ? -1 : 0, t }, this.facing < 0);
      for (const f of this.floats) g.alpha(Math.min(1, f.life / 0.4), () => g.text(f.text, f.x, f.y, { size: 7, weight: 800, mono: true, color: f.color, align: 'center' }));
      if (this.ending && this.ending < 1.2) {
        const msg = tr(this.cause === 'wall' ? 'deps.wall' : 'deps.circular');
        const w = g.measure(msg, { size: 11, weight: 800 }) + 28;
        g.round(W / 2 - w / 2, H / 2 - 14, w, 28, 14, 'rgba(15,17,28,0.88)', null);
        g.text(msg, W / 2, H / 2, { size: 11, weight: 800, color: '#FF8A7A', align: 'center' });
      }
    }

    drawBox(g, s, i) {
      const x = cellX(s.c);
      const y = cellY(s.r);
      g.round(x + 1, y + 1, CELL - 2, CELL - 2, 1.5, i % 2 ? '#B98A55' : '#A97A48', null);
      g.rect(x + CELL / 2 - 0.75, y + 1, 1.5, CELL - 2, '#E6CFA0');
      g.rect(x + 1, y + 1, CELL - 2, 1, 'rgba(255,255,255,0.12)');
    }

    drawFood(g, t) {
      const f = this.food;
      if (!f) return;
      const x = cellX(f.c);
      const y = cellY(f.r);
      const pop = Math.min(1, (this.t - f.born) / 0.15);
      const bob = Math.sin(t * 5) * 0.6;
      if (f.kind === 'dedupe') {
        g.circle(x + CELL / 2, y + CELL / 2 + bob, 4.2 * pop, '#3F9A5B', '#9BE38B', 1);
        g.text('✓', x + CELL / 2, y + CELL / 2 + bob + 0.3, { size: 6, weight: 800, color: '#FFFFFF', align: 'center' });
      } else {
        // 还没吃的包是蓝色的（大包红色），外面一圈闪动的描边，和身后的纸箱分得开
        const big = f.kind === 'big';
        const s = (big ? 9 : 8) * pop;
        const glow = 0.5 + Math.sin(t * 6) * 0.3;
        g.alpha(glow, () => g.round(x + CELL / 2 - s / 2 - 1.5, y + CELL / 2 - s / 2 + bob - 1.5, s + 3, s + 3, 2.5, null, big ? '#FF9A8A' : '#8CC8FF', 0.8));
        g.round(x + CELL / 2 - s / 2, y + CELL / 2 - s / 2 + bob, s, s, 1.5, big ? '#D9573F' : '#4F7FA8', null);
        g.rect(x + CELL / 2 - 0.6, y + CELL / 2 - s / 2 + bob, 1.2, s, big ? '#FFD0B5' : '#BFE0FF');
      }
      // 名字和大小写在上面（靠边的话往里挪）
      const label = f.kind === 'dedupe' ? f.name : `${f.name} ${fmtSize(f.mb)}`;
      const o = { size: 5.5, mono: true };
      const lw = g.measure(label, o);
      const lx = clamp(x + CELL / 2, OX + lw / 2 + 1, OX + COLS * CELL - lw / 2 - 1);
      const ly = f.r === 0 ? y + CELL + 5 : y - 4;
      g.text(label, lx, ly, { ...o, color: f.kind === 'dedupe' ? '#9BE38B' : f.kind === 'big' ? '#FFB49A' : C.dim, align: 'center' });
    }

    hud() {
      return { score: this.score, lives: null, label: tr('deps.hud', { size: fmtSize(this.mb), n: this.snake.length }) };
    }

    // 成就看最长拖了几个
    metrics() {
      return { length: this.maxLen };
    }

    summary() {
      return [
        { text: tr('deps.sizeSum', { size: fmtSize(this.mb), n: this.eaten }) },
        { text: tr('deps.lenSum', { n: this.maxLen }) + (this.deduped ? tr('deps.dedupeSum', { n: this.deduped }) : '') },
        { text: tr(this.cause === 'wall' ? 'deps.wallSum' : 'deps.circularSum') },
      ];
    }
  }

  ARCADE.register({
    id: 'deps',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#1D2130');
      const u = Math.max(5, h / 7);
      const n = 6;
      const k = Math.floor(t * 3) % 4;
      const by = y + h * 0.55;
      for (let i = n; i >= 1; i--) {
        const bx = x + w * 0.62 - i * u;
        const yy = i > 3 ? by - (i - 3) * 0 : by;
        g.round(bx + 0.5, yy + 0.5, u - 1, u - 1, 1, i % 2 ? '#B98A55' : '#A97A48', null);
        g.rect(bx + u / 2 - 0.5, yy + 0.5, 1, u - 1, '#E6CFA0');
      }
      g.pet(x + w * 0.62 + u / 2, by + u, Math.max(0.6, h / 70), { eyes: 'happy', mouth: k === 0 ? 'open' : '', t }, false);
      g.round(x + w * 0.82, by + u * 0.15, u * 0.8, u * 0.8, 1, '#D97757', '#FFD0B5', 0.6);
      g.text('node_modules', x + w / 2, y + h * 0.25, { size: Math.max(5, h / 9), mono: true, color: '#C9A26A', align: 'center' });
    },
    create: (env) => new Deps(env),
  });
})();
