// 守护主分支：Bug 沿着一条 git 分支线爬向 main，路边放小章鱼（Claude 派出的小助手）当防御塔。
// 四种塔：测试（单体、快）、Lint（黏住减速）、代码评审（范围伤害）、类型检查（远、狠、慢），都能升到 3 级、也能卖掉。
// 四种 Bug：普通 Bug、跑得快的竞态条件、耐打的内存泄漏、每 5 波来一次的祖传代码。修掉 Bug 赚 Token。
// main 的稳定度 20 点，Bug 爬进去就扣；波数没有上限，守到守不住为止。
(() => {
  const CELL = 16;
  const COLS = 18;
  const ROWS = 13;
  const FY = 18; // 场地顶边（上面是状态栏）
  const FIELD_W = COLS * CELL; // 288
  const FIELD_H = ROWS * CELL; // 208
  const PANEL = { x: FIELD_W + 3, y: FY + 1, w: W - FIELD_W - 6, h: FIELD_H - 2 };
  const MAX_HP = 20;
  const START_TOKENS = 120;
  const FIRST_BUILD = 25; // 第一波之前给多点时间
  const BUILD = 12;
  const SELL_BACK = 0.7;

  // 分支线经过的格子（列, 行），第一个在场地左边外面，最后一个是 main
  const WAY = [[-1, 2], [3, 2], [3, 9], [8, 9], [8, 3], [12, 3], [12, 10], [16, 10], [16, 6]];
  const center = (c, r) => ({ x: c * CELL + CELL / 2, y: FY + r * CELL + CELL / 2 });
  const PATH = WAY.map(([c, r]) => center(c, r));
  const SEG = [];
  let PATH_LEN = 0;
  for (let i = 1; i < PATH.length; i++) {
    const a = PATH[i - 1];
    const b = PATH[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    SEG.push({ a, b, from: PATH_LEN, len });
    PATH_LEN += len;
  }
  const ROAD = new Set();
  for (let i = 1; i < WAY.length; i++) {
    const [c0, r0] = WAY[i - 1];
    const [c1, r1] = WAY[i];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) if (c >= 0) ROAD.add(`${c},${r}`);
  }
  const BASE = WAY[WAY.length - 1];
  ROAD.add(`${BASE[0]},${BASE[1] - 1}`); // main 头上的标签

  // Token 用一枚小金币表示（星星像个加号，"✚ 50" 容易看成"加 50"）
  function coin(g, x, y, r) {
    g.circle(x, y, r, '#F2B33D', '#8A5A00', Math.max(0.5, r / 4));
    g.rect(x - r * 0.15, y - r * 0.5, r * 0.3, r, '#FFE29A');
  }

  function pointAt(d) {
    const sg = SEG.find((x) => d <= x.from + x.len) || SEG[SEG.length - 1];
    const k = clamp((d - sg.from) / sg.len, 0, 1);
    return { x: sg.a.x + (sg.b.x - sg.a.x) * k, y: sg.a.y + (sg.b.y - sg.a.y) * k };
  }

  // ---------- 塔 ----------
  // range 以格为单位；rate 每秒几发
  const TOWERS = {
    test: { cost: 50, color: '#D97757', range: 2.6, rate: 1.6, dmg: 4, shot: 'pellet', speed: 260 },
    lint: { cost: 35, color: '#5B9BD5', range: 2.2, rate: 1.3, dmg: 1.5, shot: 'goo', speed: 200, slow: 0.45, slowFor: 2, stick: 12 },
    review: { cost: 90, color: '#A98BD9', range: 2.8, rate: 0.65, dmg: 7, shot: 'orb', speed: 160, splash: 24 },
    types: { cost: 110, color: '#7DB85C', range: 4, rate: 0.5, dmg: 18, shot: 'beam' },
  };
  const ORDER = ['test', 'lint', 'review', 'types'];
  const MAX_LEVEL = 3;
  const stat = (tw) => {
    const d = TOWERS[tw.type];
    const k = tw.level - 1;
    return { dmg: d.dmg * (1 + 0.6 * k), range: d.range * (1 + 0.12 * k) * CELL, rate: d.rate * (1 + 0.15 * k), slow: d.slow, slowFor: d.slowFor, stick: d.stick && d.stick * (1 + 0.2 * k), splash: d.splash && d.splash * (1 + 0.15 * k) };
  };
  const upgradeCost = (tw) => (tw.level >= MAX_LEVEL ? null : Math.round(TOWERS[tw.type].cost * (tw.level === 1 ? 0.8 : 1.3)));
  const palOf = (type) => ({ body: TOWERS[type].color });

  // ---------- Bug ----------
  const BUG = ['.k....k.', '..k..k..', '.kGGGGk.', 'kGGgGGGk', '.GgGGgG.', 'kGGGGGGk', '.k.GG.k.'];
  const LEAK = ['..PPPP..', '.PPPPPP.', 'PPwPPwPP', 'PPkPPkPP', 'PPPPPPPP', '.PpPPpP.', '..P..P..'];
  const LEGACY = ['.k......k.', '..k....k..', '.kRRRRRRk.', 'kRRwRRwRRk', 'kRRkRRkRRk', '.RRRRRRRR.', 'kRssRRssRk', '.RRRRRRRR.', '.k.k..k.k.'];
  const ENEMIES = {
    bug: { hp: 10, speed: 24, reward: 4, score: 10, dmg: 1, rows: BUG, colors: { k: '#1F1611', G: '#7DB85C', g: '#3F7A32' }, unit: 1.3 },
    race: { hp: 6, speed: 46, reward: 5, score: 12, dmg: 1, rows: BUG, colors: { k: '#1F1611', G: '#5BC0EB', g: '#2A7FA8' }, unit: 1.1 },
    leak: { hp: 34, speed: 15, reward: 10, score: 25, dmg: 2, rows: LEAK, colors: { P: '#A98BD9', p: '#6E55A0', w: '#FFFFFF', k: '#1F1611' }, unit: 1.6 },
    legacy: { hp: 170, speed: 11, reward: 50, score: 150, dmg: 5, rows: LEGACY, colors: { k: '#1F1611', R: '#B5452E', w: '#FFFFFF', s: '#C9C9C9' }, unit: 1.9 },
  };
  // 血量按指数涨：前几波轻松，二十波以后要靠升级和搭配才守得住
  const hpScale = (n) => 1.12 ** (n - 1) * (1 + 0.04 * (n - 1));

  // 一波里来哪些：越往后越多、越杂；每 5 波压轴来一个祖传代码
  function makeWave(n, rng) {
    const list = [];
    const count = 6 + Math.floor(n * 1.7);
    for (let i = 0; i < count; i++) {
      const r = rng();
      if (n >= 2 && r < Math.min(0.3, 0.1 + n * 0.02)) list.push('race');
      else if (n >= 3 && r > 1 - Math.min(0.25, 0.06 + n * 0.015)) list.push('leak');
      else list.push('bug');
    }
    if (n % 5 === 0) list.push('legacy');
    return list;
  }

  // ---------- 面板上的按钮位置 ----------
  const TOWER_BTN = ORDER.map((type, i) => ({ type, x: PANEL.x + 2, y: PANEL.y + 15 + i * 27, w: PANEL.w - 4, h: 25 }));
  const INFO_Y = PANEL.y + 15 + 4 * 27 + 2;
  const UP_BTN = { x: PANEL.x + 2, y: INFO_Y + 30, w: PANEL.w - 4, h: 13 };
  const SELL_BTN = { x: PANEL.x + 2, y: INFO_Y + 45, w: PANEL.w - 4, h: 13 };
  const WAVE_BTN = { x: PANEL.x + 2, y: PANEL.y + PANEL.h - 20, w: PANEL.w - 26, h: 18 };
  const FAST_BTN = { x: PANEL.x + PANEL.w - 22, y: PANEL.y + PANEL.h - 20, w: 20, h: 18 };
  const FIELD = { x: 0, y: FY, w: FIELD_W, h: FIELD_H };

  class Defense {
    constructor(env) {
      this.env = env;
      this.t = 0;
      this.tokens = START_TOKENS;
      this.hp = MAX_HP;
      this.wave = 0;
      this.phase = 'build';
      this.countdown = FIRST_BUILD;
      this.next = makeWave(1, env.rng); // 今日挑战时按日期播种：每一波来什么大家一样
      this.queue = [];
      this.spawnT = 0;
      this.enemies = [];
      this.towers = [];
      this.shots = [];
      this.fx = [];
      this.floats = [];
      this.sel = null; // { kind: 'new', type } 或 { kind: 'tower', tower }
      this.fast = false;
      this.score = 0;
      this.kills = 0;
      this.built = 0;
      this.banner = null;
      this.shake = 0;
      this.baseHit = 0;
      this.dying = 0;
      this.over = false;
      this.msg = null; // 底下那行提示里临时冒出来的话
    }

    // ---------- 操作 ----------
    handleEsc() {
      if (!this.sel) return false;
      this.sel = null;
      return true;
    }

    cellAt(p) {
      if (!p || p.x < 0 || p.x >= FIELD_W || p.y < FY || p.y >= FY + FIELD_H) return null;
      return { c: Math.floor(p.x / CELL), r: Math.floor((p.y - FY) / CELL) };
    }

    towerAt(c, r) {
      return this.towers.find((tw) => tw.c === c && tw.r === r) || null;
    }

    canBuild(c, r) {
      return !ROAD.has(`${c},${r}`) && !this.towerAt(c, r);
    }

    say(text, color = '#FFB0A0') {
      this.msg = { text, color, life: 1.6 };
    }

    pick(type) {
      if (this.sel && this.sel.kind === 'new' && this.sel.type === type) this.sel = null;
      else this.sel = { kind: 'new', type };
      this.env.sound('move');
    }

    place(c, r) {
      const type = this.sel.type;
      const cost = TOWERS[type].cost;
      if (!this.canBuild(c, r)) return this.say(tr('defense.blocked'));
      if (this.tokens < cost) return this.say(tr('defense.cant'));
      this.tokens -= cost;
      const tw = { type, c, r, x: c * CELL + CELL / 2, y: FY + r * CELL + CELL / 2, level: 1, spent: cost, cd: 0.2, kills: 0, aim: 1, fireT: 0 };
      this.towers.push(tw);
      this.built++;
      this.fx.push({ kind: 'ring', x: tw.x, y: tw.y, r: 4, grow: 40, life: 0.35, color: TOWERS[type].color });
      this.env.sound('select');
      // 钱还够就接着放同一种，按住 Shift 之类的不需要
      if (this.tokens < cost) this.sel = null;
    }

    upgrade(tw) {
      const cost = upgradeCost(tw);
      if (cost == null) return;
      if (this.tokens < cost) return this.say(tr('defense.cant'));
      this.tokens -= cost;
      tw.spent += cost;
      tw.level++;
      this.fx.push({ kind: 'ring', x: tw.x, y: tw.y, r: 4, grow: 50, life: 0.4, color: C.gold });
      this.env.sound('level');
    }

    sell(tw) {
      const back = Math.round(tw.spent * SELL_BACK);
      this.tokens += back;
      this.towers = this.towers.filter((x) => x !== tw);
      this.floats.push({ text: `+${back}`, x: tw.x, y: tw.y - 8, life: 0.9, color: C.gold });
      this.sel = null;
      this.env.sound('pop');
    }

    startWave() {
      if (this.phase !== 'build') return;
      // 提前开打：剩下几秒就多给几个 Token
      const early = Math.floor(this.countdown);
      if (early > 0 && this.wave > 0) {
        this.tokens += early;
        this.floats.push({ text: tr('defense.early', { n: early }), x: PANEL.x + PANEL.w / 2, y: WAVE_BTN.y - 6, life: 1, color: C.gold });
      }
      this.wave++;
      this.phase = 'wave';
      this.queue = this.next.slice();
      this.spawnT = 0.3;
      const boss = this.queue.includes('legacy');
      this.banner = { text: boss ? tr('defense.boss') : tr('defense.wave', { n: this.wave }), color: boss ? '#FF8A6A' : C.gold, life: 1.6 };
      this.env.sound(boss ? 'bad' : 'go');
    }

    update(dt, input) {
      this.t += dt;
      if (this.msg && (this.msg.life -= dt) <= 0) this.msg = null;
      if (this.dying) {
        this.dying -= dt;
        this.tickFx(dt);
        if (this.dying <= 0) this.over = true;
        return;
      }
      this.handleInput(input);
      const steps = this.fast ? 2 : 1;
      for (let i = 0; i < steps && !this.dying; i++) this.step(dt);
    }

    handleInput(input) {
      ORDER.forEach((type, i) => {
        if (input.hit(`n${i + 1}`)) this.pick(type);
      });
      if (input.hit('space')) this.startWave();
      if (input.hit('fast')) this.fast = !this.fast;
      if (input.takeAltClick()) this.sel = null;
      const tw = this.sel && this.sel.kind === 'tower' ? this.sel.tower : null;
      if (tw && input.hit('upgrade')) this.upgrade(tw);
      if (tw && input.hit('sell')) this.sell(tw);

      // 面板
      for (const b of TOWER_BTN) if (input.takeClick(b)) this.pick(b.type);
      if (tw && input.takeClick(UP_BTN)) this.upgrade(tw);
      if (tw && this.towers.includes(tw) && input.takeClick(SELL_BTN)) this.sell(tw);
      if (input.takeClick(WAVE_BTN)) this.startWave();
      if (input.takeClick(FAST_BTN)) this.fast = !this.fast;

      // 场地：放塔，或者选中一座塔
      const click = input.clicks.find((p) => p.button === 0 && inside(p, FIELD));
      if (!click) return;
      input.clicks.splice(input.clicks.indexOf(click), 1);
      const cell = this.cellAt(click);
      const there = cell && this.towerAt(cell.c, cell.r);
      if (there) {
        this.sel = { kind: 'tower', tower: there };
        this.env.sound('move');
      } else if (this.sel && this.sel.kind === 'new' && cell) this.place(cell.c, cell.r);
      else this.sel = null;
    }

    // ---------- 一小步模拟 ----------
    step(dt) {
      if (this.phase === 'build') {
        this.countdown -= dt;
        if (this.countdown <= 0) this.startWave();
      } else {
        this.spawnT -= dt;
        if (this.queue.length && this.spawnT <= 0) {
          this.spawn(this.queue.shift());
          this.spawnT = Math.max(0.38, 1.0 - this.wave * 0.03) * (this.queue[0] === 'race' ? 0.5 : 1);
        }
        if (!this.queue.length && !this.enemies.length) this.clearWave();
      }

      for (const e of this.enemies) {
        if (e.slowT > 0) e.slowT -= dt;
        e.d += e.speed * (e.slowT > 0 ? e.slowK : 1) * dt;
        e.hitT = Math.max(0, e.hitT - dt);
        if (e.d >= PATH_LEN) this.leak(e);
      }
      this.enemies = this.enemies.filter((e) => !e.gone);

      for (const tw of this.towers) {
        tw.cd -= dt;
        tw.fireT = Math.max(0, tw.fireT - dt);
        if (tw.cd > 0) continue;
        const st = stat(tw);
        const target = this.target(tw, st.range);
        if (!target) continue;
        tw.cd = 1 / st.rate;
        tw.fireT = 0.15;
        const p = pointAt(target.d);
        tw.aim = p.x >= tw.x ? 1 : -1;
        this.fire(tw, st, target);
      }

      for (const sh of this.shots) {
        if (sh.target && !sh.target.gone) {
          const p = pointAt(sh.target.d);
          sh.tx = p.x;
          sh.ty = p.y;
        }
        const dx = sh.tx - sh.x;
        const dy = sh.ty - sh.y;
        const dist = Math.hypot(dx, dy);
        const move = sh.speed * dt;
        if (dist <= move + 2) this.impact(sh);
        else {
          sh.x += (dx / dist) * move;
          sh.y += (dy / dist) * move;
        }
      }
      this.shots = this.shots.filter((sh) => !sh.done);
      this.tickFx(dt);
    }

    tickFx(dt) {
      for (const f of this.fx) {
        f.life -= dt;
        if (f.vx != null) {
          f.vy += 260 * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
        }
      }
      this.fx = this.fx.filter((f) => f.life > 0);
      for (const f of this.floats) {
        f.y -= 18 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
      this.shake = Math.max(0, this.shake - dt);
      this.baseHit = Math.max(0, this.baseHit - dt);
    }

    spawn(type) {
      const d = ENEMIES[type];
      const hp = Math.round(d.hp * hpScale(this.wave));
      this.enemies.push({ type, hp, max: hp, speed: d.speed * (0.92 + this.env.rng() * 0.16), d: 0, slowT: 0, slowK: 1, hitT: 0, ph: Math.random() * 6 });
    }

    // 射程里走得最远的那只（离 main 最近）
    target(tw, range) {
      let best = null;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const p = pointAt(e.d);
        if (Math.hypot(p.x - tw.x, p.y - tw.y) > range) continue;
        if (!best || e.d > best.d) best = e;
      }
      return best;
    }

    fire(tw, st, target) {
      const d = TOWERS[tw.type];
      if (d.shot === 'beam') {
        const p = pointAt(target.d);
        this.fx.push({ kind: 'beam', x: tw.x, y: tw.y - 5, x2: p.x, y2: p.y, life: 0.14, color: d.color });
        this.hurt(target, st.dmg, tw);
        this.env.sound('catch');
        return;
      }
      this.shots.push({ kind: d.shot, x: tw.x + tw.aim * 4, y: tw.y - 6, tx: tw.x, ty: tw.y, speed: d.speed, target, dmg: st.dmg, slow: st.slow, slowFor: st.slowFor, stick: st.stick, splash: st.splash, from: tw, color: d.color });
    }

    impact(sh) {
      sh.done = true;
      if (sh.splash) {
        this.fx.push({ kind: 'ring', x: sh.tx, y: sh.ty, r: 3, grow: sh.splash * 2.5, life: 0.3, color: sh.color });
        for (const e of this.enemies) {
          const p = pointAt(e.d);
          if (!e.dead && Math.hypot(p.x - sh.tx, p.y - sh.ty) <= sh.splash) this.hurt(e, sh.dmg, sh.from);
        }
        this.env.sound('pop');
        return;
      }
      // Lint 的黏液溅开：落点旁边的也一起变慢
      if (sh.slow) {
        for (const o of this.enemies) {
          const p = pointAt(o.d);
          if (o.dead || Math.hypot(p.x - sh.tx, p.y - sh.ty) > sh.stick) continue;
          o.slowT = sh.slowFor;
          o.slowK = sh.slow;
        }
        this.fx.push({ kind: 'ring', x: sh.tx, y: sh.ty, r: 2, grow: sh.stick * 2.5, life: 0.25, color: '#8FC8F2' });
      }
      const e = sh.target;
      if (!e || e.dead || e.gone) return;
      this.hurt(e, sh.dmg, sh.from);
    }

    hurt(e, dmg, tw) {
      if (e.dead) return;
      e.hp -= dmg;
      e.hitT = 0.1;
      if (e.hp > 0) return;
      e.dead = true;
      e.gone = true;
      const d = ENEMIES[e.type];
      this.tokens += d.reward;
      this.score += d.score;
      this.kills++;
      if (tw && this.towers.includes(tw)) tw.kills++;
      const p = pointAt(e.d);
      this.floats.push({ text: `+${d.reward}`, x: p.x, y: p.y - 8, life: 0.8, color: C.gold });
      for (let i = 0; i < (e.type === 'legacy' ? 24 : 7); i++) this.fx.push({ kind: 'bit', x: p.x, y: p.y, vx: rand(-70, 70), vy: rand(-110, -20), life: rand(0.3, 0.6), color: pick(Object.values(d.colors)) });
      this.env.sound(e.type === 'legacy' ? 'record' : 'catch');
      this.enemies = this.enemies.filter((x) => x !== e);
    }

    // 爬进 main 了
    leak(e) {
      e.gone = true;
      this.hp = Math.max(0, this.hp - ENEMIES[e.type].dmg);
      this.shake = 0.3;
      this.baseHit = 0.5;
      this.env.sound('bad');
      if (this.hp <= 0) {
        this.dying = 1.4;
        this.sel = null;
      }
    }

    clearWave() {
      const bonus = 15 + this.wave * 2;
      this.tokens += bonus;
      this.score += 50 * this.wave;
      this.phase = 'build';
      this.countdown = BUILD;
      this.next = makeWave(this.wave + 1, this.env.rng);
      this.banner = { text: tr('defense.cleared', { n: this.wave, t: bonus }), color: '#9BE38B', life: 1.8 };
      this.env.sound('level');
    }

    // ---------- 画 ----------
    draw(g, t) {
      if (this.shake > 0) g.shake(rand(-1.5, 1.5) * this.shake * 5, rand(-1, 1) * this.shake * 5);
      g.rect(-4, FY - 2, W + 8, H - FY + 6, '#1A1E2C');
      g.rect(0, FY, FIELD_W, FIELD_H, '#232838');
      for (let c = 1; c < COLS; c++) g.rect(c * CELL, FY, 0.5, FIELD_H, '#2A3043');
      for (let r = 1; r < ROWS; r++) g.rect(0, FY + r * CELL, FIELD_W, 0.5, '#2A3043');
      this.drawRoad(g, t);
      this.drawBase(g, t);

      // 正在放塔：鼠标指着的格子、射程
      const hover = this.cellAt(this.pointer);
      const selTower = this.sel && this.sel.kind === 'tower' ? this.sel.tower : null;
      if (selTower) g.circle(selTower.x, selTower.y, stat(selTower).range, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.35)', 0.7);
      if (this.sel && this.sel.kind === 'new' && hover && !this.dying) {
        const ok = this.canBuild(hover.c, hover.r) && this.tokens >= TOWERS[this.sel.type].cost;
        const x = hover.c * CELL + CELL / 2;
        const y = FY + hover.r * CELL + CELL / 2;
        g.circle(x, y, TOWERS[this.sel.type].range * CELL, ok ? 'rgba(125,184,92,0.10)' : 'rgba(214,69,69,0.10)', ok ? 'rgba(155,227,139,0.6)' : 'rgba(255,120,120,0.6)', 0.7);
        g.rect(hover.c * CELL, FY + hover.r * CELL, CELL, CELL, ok ? 'rgba(125,184,92,0.35)' : 'rgba(214,69,69,0.35)');
        g.alpha(0.6, () => g.pet(x, y + 6, 0.8, { eyes: 'happy', t }, false, palOf(this.sel.type)));
      }

      for (const tw of this.towers) this.drawTower(g, tw, t, tw === selTower);
      for (const e of this.enemies) this.drawEnemy(g, e, t);
      for (const sh of this.shots) {
        if (sh.kind === 'pellet') g.rect(sh.x - 1, sh.y - 1, 2, 2, '#FFE9C2');
        else if (sh.kind === 'goo') g.circle(sh.x, sh.y, 1.8, '#8FC8F2', null);
        else g.circle(sh.x, sh.y, 2.6, '#D9C6FF', 'rgba(169,139,217,0.7)', 1);
      }
      for (const f of this.fx) {
        if (f.kind === 'beam') g.alpha(f.life / 0.14, () => g.line(f.x, f.y, f.x2, f.y2, f.color, 1.4));
        else if (f.kind === 'ring') g.alpha(f.life / 0.35, () => g.circle(f.x, f.y, f.r + f.grow * (1 - f.life / 0.4), null, f.color, 1));
        else g.alpha(f.life / 0.5, () => g.rect(f.x, f.y, 1.6, 1.6, f.color));
      }
      for (const f of this.floats) g.alpha(f.life / 0.5, () => g.text(f.text, f.x, f.y, { size: 6.5, weight: 800, color: f.color, align: 'center' }));
      g.shake(0, 0);

      this.drawPanel(g, t);
      // 场地下面一行提示
      const hint = this.msg ? this.msg.text : this.sel && this.sel.kind === 'new' ? tr(`defense.tip.${this.sel.type}`) : tr('defense.hint');
      g.text(hint, 4, FY + FIELD_H + 7, { size: 6, color: this.msg ? this.msg.color : C.dim });
      if (this.banner) {
        const b = this.banner;
        g.alpha(Math.min(1, b.life / 0.3), () => {
          const w = g.measure(b.text, { size: 10, weight: 800 }) + 24;
          g.round(FIELD_W / 2 - w / 2, FY + FIELD_H / 2 - 12, w, 24, 12, 'rgba(15,17,28,0.8)', null);
          g.text(b.text, FIELD_W / 2, FY + FIELD_H / 2, { size: 10, weight: 800, color: b.color, align: 'center' });
        });
      }
    }

    // 分支线：一条粗线，拐弯的地方是提交点
    drawRoad(g, t) {
      for (const key of ROAD) {
        const [c, r] = key.split(',').map(Number);
        g.rect(c * CELL, FY + r * CELL, CELL, CELL, '#2B3147');
      }
      for (const sg of SEG) g.line(sg.a.x, sg.a.y, sg.b.x, sg.b.y, '#5B6B9A', 3);
      // 沿线往 main 流动的小点
      for (let d = (t * 30) % 24; d < PATH_LEN; d += 24) {
        const p = pointAt(d);
        g.rect(p.x - 0.75, p.y - 0.75, 1.5, 1.5, '#8E9AC4');
      }
      for (const p of PATH.slice(1, -1)) g.circle(p.x, p.y, 3, '#232838', '#8E9AC4', 1.2);
      g.text('bugs/*', 2, FY + 2 * CELL - 3, { size: 5, mono: true, color: '#6B7499' });
    }

    drawBase(g, t) {
      const p = PATH[PATH.length - 1];
      const hit = this.baseHit > 0 && Math.floor(t * 20) % 2 === 0;
      g.circle(p.x, p.y, 7.5, hit ? '#D64545' : '#3F9A5B', '#FFFFFF', 1.2);
      // 分支图标
      g.rect(p.x - 2.5, p.y - 3.5, 1.2, 7, '#FFFFFF');
      g.rect(p.x + 1.5, p.y - 3.5, 1.2, 3.5, '#FFFFFF');
      g.rect(p.x - 1.5, p.y - 0.6, 3.5, 1.2, '#FFFFFF');
      g.round(p.x - 8, p.y - 18, 16, 8, 4, 'rgba(15,17,28,0.75)', null);
      g.text('main', p.x, p.y - 14, { size: 4.6, mono: true, weight: 700, color: hit ? '#FF9A8A' : '#9BE38B', align: 'center' });
    }

    drawTower(g, tw, t, on) {
      const x0 = tw.c * CELL;
      const y0 = FY + tw.r * CELL;
      g.round(x0 + 1, y0 + 1, CELL - 2, CELL - 2, 3, on ? '#3A4160' : '#2E3450', on ? C.gold : null, 0.8);
      const firing = tw.fireT > 0;
      g.pet(tw.x, y0 + CELL - 3, 0.8, { eyes: firing ? 'wide' : 'down', armL: firing ? 'high' : 4, armR: firing ? 'high' : 5, top: firing ? 0 : Math.floor(t * 1.5 + tw.c) % 2, t }, tw.aim < 0, palOf(tw.type));
      for (let i = 0; i < tw.level; i++) g.rect(x0 + 3 + i * 3, y0 + CELL - 2.5, 2, 1.2, C.gold);
    }

    drawEnemy(g, e, t) {
      const d = ENEMIES[e.type];
      const p = pointAt(e.d);
      const bob = Math.floor(t * 8 + e.ph) % 2;
      const rows = d.rows;
      g.spriteC(rows, e.hitT > 0 ? Object.fromEntries(Object.keys(d.colors).map((k) => [k, '#FFFFFF'])) : d.colors, p.x, p.y - bob * 0.6, d.unit, bob === 1);
      if (e.slowT > 0) g.rect(p.x - 3, p.y + (rows.length * d.unit) / 2 - 0.5, 6, 1.2, '#8FC8F2');
      if (e.hp < e.max) {
        const w = Math.max(10, rows[0].length * d.unit);
        const y = p.y - (rows.length * d.unit) / 2 - 3;
        g.rect(p.x - w / 2, y, w, 1.6, '#1A1E2C');
        g.rect(p.x - w / 2, y, w * clamp(e.hp / e.max, 0, 1), 1.6, e.hp / e.max > 0.5 ? '#7DB85C' : e.hp / e.max > 0.25 ? C.gold : '#D64545');
      }
    }

    drawPanel(g, t) {
      g.round(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 5, '#151824', null);
      // Token
      coin(g, PANEL.x + 8, PANEL.y + 7, 3.6);
      g.text(String(this.tokens), PANEL.x + 15, PANEL.y + 7.5, { size: 8, weight: 800, color: C.gold });

      for (const [i, b] of TOWER_BTN.entries()) {
        const d = TOWERS[b.type];
        const on = this.sel && this.sel.kind === 'new' && this.sel.type === b.type;
        const afford = this.tokens >= d.cost;
        const over = g.hover(b);
        g.round(b.x, b.y, b.w, b.h, 4, on ? '#3A4160' : over ? '#262B3D' : '#1D2130', on ? C.gold : '#2E3450', on ? 1.2 : 0.6);
        g.pet(b.x + 9, b.y + 18, 0.7, { eyes: afford ? 'happy' : 'down', t }, false, palOf(b.type));
        g.text(tr(`defense.tower.${b.type}`), b.x + 18, b.y + 8, { size: 6, weight: 800, color: afford ? C.cream : C.dim });
        if (afford) coin(g, b.x + 20.5, b.y + 18, 2.4);
        else g.circle(b.x + 20.5, b.y + 18, 2.4, '#4A5070', null);
        g.text(String(d.cost), b.x + 24.5, b.y + 18, { size: 6, weight: 700, color: afford ? C.gold : '#C2452D' });
        g.text(String(i + 1), b.x + b.w - 3, b.y + 6, { size: 5, color: '#6B7499', align: 'right' });
      }

      // 选中一座塔：等级、伤害、射程、升级、卖掉
      const tw = this.sel && this.sel.kind === 'tower' ? this.sel.tower : null;
      if (tw) {
        const st = stat(tw);
        g.text(`${tr(`defense.tower.${tw.type}`)} ${tr('defense.level', { n: tw.level })}`, PANEL.x + 3, INFO_Y + 4, { size: 6, weight: 800, color: C.cream });
        g.text(tr('defense.stats', { dmg: Math.round(st.dmg * 10) / 10, range: Math.round((st.range / CELL) * 10) / 10 }), PANEL.x + 3, INFO_Y + 13, { size: 5.3, color: C.dim });
        g.text(tr('defense.towerKills', { n: tw.kills }), PANEL.x + 3, INFO_Y + 21, { size: 5.3, color: C.dim });
        const cost = upgradeCost(tw);
        const canUp = cost != null && this.tokens >= cost;
        this.miniButton(g, UP_BTN, cost == null ? tr('defense.max') : tr('defense.upgrade', { n: cost }), canUp ? C.green : '#2E3450', canUp ? '#FFFFFF' : C.dim);
        this.miniButton(g, SELL_BTN, tr('defense.sell', { n: Math.round(tw.spent * SELL_BACK) }), '#2E3450', C.cream);
      } else {
        // 下一波来什么
        g.text(tr(this.phase === 'build' ? 'defense.nextWave' : 'defense.thisWave'), PANEL.x + 3, INFO_Y + 4, { size: 5.5, weight: 800, color: C.dim });
        const list = this.phase === 'build' ? this.next : [...this.queue, ...this.enemies.map((e) => e.type)];
        const counts = {};
        for (const k of list) counts[k] = (counts[k] || 0) + 1;
        Object.entries(counts).forEach(([k, n], i) => {
          const d = ENEMIES[k];
          g.spriteC(d.rows, d.colors, PANEL.x + 8, INFO_Y + 13 + i * 10, Math.min(1, d.unit * 0.7));
          g.text(`${tr(`defense.enemy.${k}`)} ×${n}`, PANEL.x + 15, INFO_Y + 13 + i * 10, { size: 5.3, color: k === 'legacy' ? '#FF9A8A' : C.cream });
        });
      }

      // 开下一波、倍速
      const building = this.phase === 'build';
      this.miniButton(g, WAVE_BTN, building ? `${tr('defense.go')} ${Math.ceil(this.countdown)}s` : tr('defense.wave', { n: this.wave }), building ? C.accent : '#2E3450', building ? '#FFFFFF' : C.dim);
      this.miniButton(g, FAST_BTN, this.fast ? '2×' : '1×', this.fast ? C.gold : '#2E3450', this.fast ? '#3A2600' : C.cream);
    }

    miniButton(g, r, label, fill, ink) {
      const over = g.hover(r);
      g.round(r.x, r.y, r.w, r.h, r.h / 2, over ? shade(fill, 1.15) : fill, null);
      g.text(label, r.x + r.w / 2, r.y + r.h / 2 + 0.3, { size: 5.8, weight: 800, color: ink, align: 'center' });
    }

    hud() {
      const label = this.phase === 'build' ? `${tr('defense.wave', { n: this.wave + 1 })} · ${tr('defense.countdown', { n: Math.ceil(this.countdown) })}` : tr('defense.wave', { n: this.wave });
      return { score: this.score, lives: null, hp: this.hp, hpMax: MAX_HP, label };
    }

    // 守住了几波（死在第 n 波就是守住了 n - 1 波）
    metrics() {
      return { waves: Math.max(0, this.wave - 1) };
    }

    summary() {
      const mvp = this.towers.slice().sort((a, b) => b.kills - a.kills)[0];
      const lines = [{ text: tr('defense.wavesSum', { n: Math.max(0, this.wave - 1) }) }, { text: tr('defense.killsSum', { n: this.kills }) }, { text: tr('defense.builtSum', { n: this.built }) }];
      if (mvp && mvp.kills) lines.push({ text: tr('defense.mvp', { name: tr(`defense.tower.${mvp.type}`), lv: mvp.level, n: mvp.kills }) });
      return lines;
    }
  }

  // 让 draw 也能知道鼠标在哪（放塔时的格子和射程）
  const create = (env) => {
    const game = new Defense(env);
    Object.defineProperty(game, 'pointer', { get: () => input.pointer });
    return game;
  };

  ARCADE.register({
    id: 'defense',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#232838');
      const yy = y + h * 0.55;
      g.line(x, yy, x + w * 0.62, yy, '#5B6B9A', 2.5);
      g.line(x + w * 0.62, yy, x + w * 0.62, y + h * 0.25, '#5B6B9A', 2.5);
      g.line(x + w * 0.62, y + h * 0.25, x + w, y + h * 0.25, '#5B6B9A', 2.5);
      g.circle(x + w * 0.88, y + h * 0.25, 5, '#3F9A5B', '#FFFFFF', 1);
      // 两只小助手在打一串 Bug
      const k = (t * 0.25) % 1;
      [0, 0.18, 0.36].forEach((off, i) => {
        const bx = x + ((k + off) % 1) * w * 0.6;
        g.spriteC(i === 1 ? LEAK : BUG, i === 1 ? ENEMIES.leak.colors : ENEMIES.bug.colors, bx, yy, 1);
      });
      const fire = Math.floor(t * 3) % 2;
      g.pet(x + w * 0.3, y + h * 0.32, 0.8, { eyes: 'wide', armL: fire ? 'high' : 4, armR: fire ? 'high' : 5, t }, false, palOf('test'));
      g.pet(x + w * 0.45, y + h * 0.92, 0.8, { eyes: 'down', armL: 'high', armR: 'high', t }, false, palOf('types'));
      if (fire) g.line(x + w * 0.45, y + h * 0.75, x + ((k + 0.18) % 1) * w * 0.6, yy, '#7DB85C', 1);
    },
    create,
    // 给平衡测试用：路线上某个位置的坐标、路线总长、塔的参数
    debug: { pointAt, PATH_LEN, TOWERS, ENEMIES, CELL, FY, COLS, ROWS },
  });
})();
