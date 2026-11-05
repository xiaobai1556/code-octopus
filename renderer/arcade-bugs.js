// 捉虫大作战：Bug 从屏幕上掉下来，小章鱼在桌面上左右跑着接。
// 接住得分，连着接倍数往上翻；Bug 掉到桌上扣一颗心；红色的 rm -rf 碰到扣一颗心；咖啡补一颗心。
// 每接住 15 只进入下一轮迭代：掉得更快、更密，rm -rf 更多。
(() => {
  const GROUND = 222; // 桌面
  const PET_UNIT = 2; // 小章鱼 32×20
  const MAX_LIVES = 5;
  const PER_LEVEL = 15;
  const SPEED = 220;

  const BUG = ['.k....k.', '..k..k..', '.kGGGGk.', 'kGGgGGGk', '.GgGGgG.', 'kGGGGGGk', '.k.GG.k.'];
  const BUG_C = { k: '#1F1611', G: '#7DB85C', g: '#3F7A32' };
  const GOLD_C = { k: '#1F1611', G: '#F2C14E', g: '#B9861F' };
  const BOMB = ['.RRRRRR.', 'RRwRRwRR', 'RRRwwRRR', 'RRRwwRRR', 'RRwRRwRR', '.RRRRRR.'];
  const BOMB_C = { R: '#D64545', w: '#FFFFFF' };
  const COFFEE = ['.s.s...', '..s.s..', 'WWWWW..', 'WbbbWWW', 'WbbbW.W', 'WbbbWWW', '.WWW...'];
  const COFFEE_C = { W: '#F4F1EA', b: '#6B4226', s: '#B8BCC6' };
  // 背景上淡淡的"代码"：每行几段不同颜色的短横
  const CODE_COLORS = ['#5B6B9A', '#7DB85C', '#D97757', '#A98BD9', '#5B9BD5', '#9AA0B4'];

  function codeLines() {
    const rows = [];
    for (let y = 22; y < GROUND - 6; y += 8) {
      let x = 26 + Math.floor(Math.random() * 4) * 8;
      const segs = [];
      const n = Math.floor(rand(0, 5));
      for (let i = 0; i < n && x < 330; i++) {
        const w = rand(10, 46);
        segs.push({ x, w, c: pick(CODE_COLORS) });
        x += w + 4;
      }
      rows.push({ y, segs });
    }
    return rows;
  }

  class Bugs {
    constructor(env) {
      this.env = env;
      this.x = W / 2;
      this.vx = 0;
      this.facing = 1;
      this.items = [];
      this.floats = [];
      this.parts = [];
      this.score = 0;
      this.lives = 3;
      this.combo = 0;
      this.maxCombo = 0;
      this.caught = 0;
      this.level = 1;
      this.spawnT = 0.6;
      this.t = 0;
      this.shake = 0;
      this.happy = 0;
      this.hurt = 0;
      this.banner = 0;
      this.dying = 0;
      this.over = false;
      this.code = codeLines();
    }

    get mult() {
      return Math.min(5, 1 + Math.floor(this.combo / 5));
    }

    update(dt, input) {
      this.t += dt;
      this.tickEffects(dt);
      if (this.dying) {
        this.dying -= dt;
        if (this.dying <= 0) this.over = true;
        return;
      }
      // 移动：键盘，或者跟着鼠标
      let want = input.axis();
      if (!want && input.pointerActive()) {
        const d = input.pointer.x - this.x;
        if (Math.abs(d) > 2) want = clamp(d / 20, -1, 1);
      }
      this.vx += (want * SPEED - this.vx) * Math.min(1, dt * 14);
      this.x = clamp(this.x + this.vx * dt, 18, W - 18);
      if (Math.abs(this.vx) > 10) this.facing = Math.sign(this.vx);

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawn();
        this.spawnT = Math.max(0.42, 1.45 - this.level * 0.1) * rand(0.75, 1.2);
      }
      for (const it of this.items) {
        it.y += it.vy * dt;
        it.x = clamp(it.x + Math.cos(this.t * it.wob + it.ph) * it.sway * dt, 10, W - 10);
        // 落到小章鱼举着的手里
        if (it.y >= GROUND - 26 && it.y <= GROUND - 8 && Math.abs(it.x - this.x) < 22) this.take(it);
        else if (it.y >= GROUND - 3) this.land(it);
      }
      this.items = this.items.filter((it) => !it.done);
      if (this.lives <= 0) this.dying = 1.3;
    }

    tickEffects(dt) {
      for (const f of this.floats) {
        f.y -= 22 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      for (const q of this.parts) {
        q.vy += 420 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.life -= dt;
      }
      this.parts = this.parts.filter((q) => q.life > 0);
      this.happy -= dt;
      this.hurt -= dt;
      this.banner -= dt;
      this.shake = Math.max(0, this.shake - dt);
    }

    spawn() {
      const bombP = Math.min(0.3, 0.1 + this.level * 0.025);
      const r = Math.random();
      let kind = 'bug';
      if (r < bombP) kind = 'bomb';
      else if (r < bombP + 0.05) kind = 'gold';
      else if (r < bombP + 0.1 && this.lives < MAX_LIVES) kind = 'coffee';
      const vy = (40 + this.level * 8 + rand(0, 16)) * (kind === 'gold' ? 1.35 : 1);
      const wobbly = kind === 'bug' || kind === 'gold';
      let x = rand(14, W - 14);
      // 公平：要接的东西，和上一个要接的落地时间挨得近的话，落点也不能远到跑不过去
      if (kind !== 'bomb') {
        const landAt = this.t + (GROUND - 18) / vy;
        const prev = this.lastGood;
        if (prev) {
          const reach = SPEED * Math.abs(landAt - prev.landAt) * 0.7 + 16;
          x = clamp(x, prev.x - reach, prev.x + reach);
        }
        this.lastGood = { x, landAt };
      }
      this.items.push({ kind, x: clamp(x, 14, W - 14), y: 10, vy, sway: wobbly ? rand(6, 18) : 0, wob: rand(1.5, 3.2), ph: rand(0, 6) });
    }

    // 接住了
    take(it) {
      it.done = true;
      const at = { x: it.x, y: GROUND - 26 };
      if (it.kind === 'bomb') {
        this.combo = 0;
        this.lives--;
        this.hurt = 0.8;
        this.shake = 0.35;
        this.float(tr('bugs.boom'), at, '#FF7A7A');
        this.burst(at, ['#D64545', '#FFFFFF', '#FFB0A0'], 14);
        this.env.sound('bad');
        return;
      }
      if (it.kind === 'coffee') {
        this.lives = Math.min(MAX_LIVES, this.lives + 1);
        this.float(tr('bugs.coffee'), at, '#F4D9A0');
        this.env.sound('life');
        return;
      }
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.caught++;
      const pts = (it.kind === 'gold' ? 50 : 10) * this.mult;
      this.score += pts;
      this.happy = 0.35;
      this.float(`+${pts}`, at, it.kind === 'gold' ? '#F2C14E' : '#B6E3A0');
      this.burst(at, it.kind === 'gold' ? ['#F2C14E', '#FFF2B0'] : ['#7DB85C', '#C8F0B0'], 6);
      this.env.sound(it.kind === 'gold' ? 'gold' : 'catch');
      if (this.caught % PER_LEVEL === 0) {
        this.level++;
        this.banner = 1.6;
        this.env.sound('level');
      }
    }

    // 掉到桌上了
    land(it) {
      it.done = true;
      const at = { x: it.x, y: GROUND - 4 };
      if (it.kind === 'bug' || it.kind === 'gold') {
        this.combo = 0;
        this.lives--;
        this.hurt = 0.5;
        this.shake = 0.2;
        this.float(tr('bugs.escaped'), { x: it.x, y: GROUND - 14 }, '#FF9A7A');
        this.burst(at, ['#7DB85C', '#3F7A32'], 8);
        this.env.sound('bad');
      } else this.burst(at, it.kind === 'bomb' ? ['#8A8F9E', '#C9CCD6'] : ['#6B4226', '#F4F1EA'], 6);
    }

    float(text, at, color) {
      this.floats.push({ text, x: clamp(at.x, 24, W - 24), y: at.y, color, life: 0.9 });
    }

    burst(at, colors, n) {
      for (let i = 0; i < n; i++) this.parts.push({ x: at.x, y: at.y, vx: rand(-80, 80), vy: rand(-150, -40), life: rand(0.4, 0.8), c: pick(colors) });
    }

    draw(g, t) {
      if (this.shake > 0) g.shake(rand(-2, 2) * this.shake * 4, rand(-1.5, 1.5) * this.shake * 4);
      // 显示器里的编辑器
      g.rect(-4, -4, W + 8, H + 8, '#232838');
      g.rect(0, 17, 18, GROUND - 17, '#1C2030');
      for (const row of this.code) {
        g.text(String((row.y - 22) / 8 + 1), 14, row.y + 1, { size: 4.5, color: '#4A5070', align: 'right' });
        for (const sg of row.segs) g.alpha(0.35, () => g.rect(sg.x, row.y, sg.w, 2.5, sg.c));
      }
      // 桌子
      g.rect(-4, GROUND, W + 8, H - GROUND + 4, '#6B4F3A');
      g.rect(-4, GROUND, W + 8, 2, '#8A6A50');
      g.rect(-4, GROUND + 2, W + 8, 1, '#5A402E');

      for (const it of this.items) {
        if (it.kind === 'bomb') {
          g.spriteC(BOMB, BOMB_C, it.x, it.y - 6, 2);
          g.text('rm -rf', it.x, it.y + 3, { size: 5, mono: true, color: '#FF8A8A', align: 'center' });
        } else if (it.kind === 'coffee') g.spriteC(COFFEE, COFFEE_C, it.x, it.y - 7, 2);
        else {
          const flap = Math.floor(t * 8 + it.ph) % 2;
          g.spriteC(BUG, it.kind === 'gold' ? GOLD_C : BUG_C, it.x, it.y - 7 - flap, 2, flap === 1);
        }
      }

      // 小章鱼举着手接
      const moving = Math.abs(this.vx) > 15;
      const near = this.items.some((it) => it.kind !== 'bomb' && Math.abs(it.x - this.x) < 26 && it.y > GROUND - 70);
      const pose = this.dying
        ? { eyes: 'x', sit: true, top: 2, armL: 6, armR: 6, props: ['tear'], t }
        : {
            eyes: this.hurt > 0 ? 'x' : this.happy > 0 ? 'happy' : near ? 'wide' : 'open',
            armL: 'high',
            armR: 'high',
            legs: moving ? (Math.floor(t * 10) % 2 ? 'walk0' : 'walk1') : 'stand',
            blush: this.happy > 0,
            mouth: near && this.hurt <= 0 ? 'open' : '',
            shadow: true,
            t,
          };
      g.pet(this.x, GROUND, PET_UNIT, pose, this.facing < 0);

      for (const q of this.parts) g.alpha(q.life / 0.6, () => g.rect(q.x, q.y, 2, 2, q.c));
      for (const f of this.floats) g.alpha(f.life / 0.5, () => g.text(f.text, f.x, f.y, { size: 7, weight: 800, color: f.color, align: 'center' }));
      if (this.banner > 0) {
        const k = Math.min(1, this.banner / 0.4);
        g.alpha(k, () => {
          g.round(W / 2 - 70, 92, 140, 26, 13, 'rgba(15,17,28,0.75)', null);
          g.text(tr('bugs.levelUp', { n: this.level }), W / 2, 105, { size: 11, weight: 800, color: C.gold, align: 'center' });
        });
      }
    }

    hud() {
      // 连击翻倍时，状态栏里亮出倍数
      const label = tr('bugs.level', { n: this.level });
      return { score: this.score, lives: this.lives, label: this.mult > 1 ? `${label} · ${tr('bugs.combo', { n: this.mult })}` : label, labelColor: this.mult > 1 ? C.gold : null };
    }

    summary() {
      return [{ text: tr('bugs.caught', { n: this.caught }) }, { text: tr('bugs.maxCombo', { n: this.maxCombo }) }, { text: tr('bugs.reached', { n: this.level }) }];
    }
  }

  ARCADE.register({
    id: 'bugs',
    // 菜单卡片上的小画面
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#232838');
      for (let r = 0; r < 6; r++) g.alpha(0.35, () => g.rect(x + 8, y + 8 + r * 8, 14 + ((r * 23) % 40), 2, CODE_COLORS[r % CODE_COLORS.length]));
      g.rect(x, y + h - 10, w, 10, '#6B4F3A');
      g.rect(x, y + h - 10, w, 1.5, '#8A6A50');
      const cx = x + w / 2 + Math.sin(t * 1.6) * 18;
      [0.15, 0.5, 0.82].forEach((fx, i) => {
        const fy = y + 8 + ((t * 22 + i * 19) % (h - 26));
        g.spriteC(i === 1 ? BOMB : BUG, i === 1 ? BOMB_C : BUG_C, x + fx * w, fy, 1.5);
      });
      g.pet(cx, y + h - 10, 1.5, { eyes: 'happy', armL: 'high', armR: 'high', legs: Math.floor(t * 8) % 2 ? 'walk0' : 'walk1', t });
    },
    create: (env) => new Bugs(env),
  });
})();
