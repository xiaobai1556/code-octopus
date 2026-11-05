// 窗口跳跳：踩着一个个小窗口往上跳。落到窗口顶上自动弹起来，左右控制方向，从一边出去会从另一边回来（像走到隔壁屏）。
// 蓝色窗口在被人拖着左右走，红色窗口踩一次就最小化，顶上贴着黄色便签的是弹簧，星星加分。掉出屏幕就结束。
// 越往上，天色从白天变成黄昏、夜里、星空。得分 = 高度（米）+ 星星 × 5。
(() => {
  const GRAV = 620;
  const JUMP = 300; // 一跳大约 72 个单位高
  const SPRING = 470; // 弹簧大约 178
  const SPEED = 150;
  const START_Y = 228; // 起跳的任务栏
  const PET_UNIT = 1.5; // 小章鱼 24×15
  const STAR_PTS = 5;

  // 天色：[高度（米）, 上面的颜色, 下面的颜色]
  const SKY = [
    [0, '#8FC2EE', '#E3F1FB'],
    [120, '#F2A65A', '#F6D7A7'],
    [240, '#6B5B95', '#E58F65'],
    [380, '#1D2546', '#3A3F6B'],
    [560, '#070A1A', '#1A1440'],
  ];
  const NOTE = ['YYYYYYYY', 'YYYYYYYy', 'YYYYYYyy', 'yyyyyyyy'];
  const NOTE_C = { Y: '#FFE680', y: '#E8C84A' };

  // 跳起来以后，落到比起跳点高 gap 的地方之前，左右最多能走多远（留三成多余量：起步要加速，人也没那么准）
  function reachX(gap) {
    const apex = (JUMP * JUMP) / (2 * GRAV);
    const air = JUMP / GRAV + Math.sqrt((2 * Math.max(0, apex - gap)) / GRAV);
    return SPEED * air * 0.65;
  }

  const mix = (a, b, k) => {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };
  function skyAt(m) {
    for (let i = SKY.length - 1; i >= 0; i--) {
      if (m < SKY[i][0]) continue;
      const a = SKY[i];
      const b = SKY[i + 1];
      if (!b) return [a[1], a[2]];
      const k = (m - a[0]) / (b[0] - a[0]);
      return [mix(a[1], b[1], k), mix(a[2], b[2], k)];
    }
    return [SKY[0][1], SKY[0][2]];
  }

  class Hop {
    constructor(env) {
      this.env = env;
      this.x = W / 2;
      this.y = START_Y;
      this.vx = 0;
      this.vy = -JUMP;
      this.facing = 1;
      this.cam = 0; // 屏幕顶上对应的世界 y（往上是负的）
      this.plats = [{ x: -10, y: START_Y, w: W + 20, kind: 'floor' }];
      this.stars = [];
      this.parts = [];
      this.floats = [];
      this.genY = START_Y;
      this.lastKind = 'floor';
      this.maxUp = 0;
      this.starsGot = 0;
      this.squash = 0;
      this.dying = 0;
      this.over = false;
      this.t = 0;
      this.skyDots = Array.from({ length: 60 }, () => ({ x: rand(0, W), y: rand(0, 600), r: rand(0.8, 1.6) }));
      this.generate();
    }

    get meters() {
      return Math.floor(this.maxUp / 10);
    }

    get score() {
      return this.meters + this.starsGot * STAR_PTS;
    }

    // 往上补窗口，补到屏幕顶上再多一点；掉到下面看不见的扔掉。
    // 每个新窗口都保证从上一个跳得到：高度差不超过一跳的高度，左右离得不超过这一跳滞空时间里走得到的距离
    generate() {
      while (this.genY > this.cam - 80) {
        const m = (START_Y - this.genY) / 10;
        const gap = rand(26, 36 + Math.min(32, m * 0.12)); // 最远 68，一跳 72 够得着
        this.genY -= gap;
        const w = Math.max(38, 62 - Math.min(22, m * 0.05)) * rand(0.85, 1.1);
        const pMove = clamp((m - 15) * 0.004, 0, 0.32);
        const pFragile = clamp((m - 45) * 0.003, 0, 0.22);
        const r = Math.random();
        let kind = 'normal';
        if (r < pMove) kind = 'move';
        else if (r < pMove + pFragile && this.lastKind !== 'fragile') kind = 'fragile';
        this.lastKind = kind;
        // 被拖着的窗口只在出生点左右一段来回走，这一段要从可达范围里扣掉
        const range = kind === 'move' ? rand(24, 48) : 0;
        const prev = this.prevCenter == null ? W / 2 : this.prevCenter;
        const reach = Math.max(10, reachX(gap) + w / 2 - range);
        // 生成时不靠"从屏幕另一边绕过去"：直接在够得着的范围里挑，夹回屏幕里只会离得更近
        const cx = clamp(prev + rand(-reach, reach), w / 2 + 4 + range, W - w / 2 - 4 - range);
        this.prevCenter = cx;
        const x = cx - w / 2;
        this.plats.push({
          x, y: this.genY, w, kind, home: x, range,
          vx: kind === 'move' ? rand(25, 45 + Math.min(30, m * 0.06)) * (Math.random() < 0.5 ? -1 : 1) : 0,
          spring: kind === 'normal' && m > 8 && Math.random() < 0.08,
          springT: 0,
          gone: 0,
          lines: Array.from({ length: 2 }, () => rand(0.3, 0.8)),
        });
        if (Math.random() < 0.2) this.stars.push({ x: clamp(x + w / 2 + rand(-24, 24), 10, W - 10), y: this.genY - rand(22, 48), got: false, ph: rand(0, 6) });
      }
      const bottom = this.cam + H + 40;
      this.plats = this.plats.filter((p) => p.y < bottom && !(p.gone > 0.4));
      this.stars = this.stars.filter((st) => st.y < bottom && !st.got);
    }

    update(dt, input) {
      this.t += dt;
      for (const q of this.parts) {
        q.vy += 300 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.life -= dt;
      }
      this.parts = this.parts.filter((q) => q.life > 0);
      for (const f of this.floats) {
        f.y -= 20 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      this.squash = Math.max(0, this.squash - dt);
      if (this.dying) {
        this.dying -= dt;
        if (this.dying <= 0) this.over = true;
        return;
      }

      // 左右：键盘，或者朝鼠标那边
      let want = input.axis();
      if (!want && input.pointerActive()) {
        const d = input.pointer.x - this.x;
        if (Math.abs(d) > 3) want = clamp(d / 24, -1, 1);
      }
      this.vx += (want * SPEED - this.vx) * Math.min(1, dt * 10);
      this.x += this.vx * dt;
      if (Math.abs(this.vx) > 12) this.facing = Math.sign(this.vx);
      // 从一边出去，从另一边回来
      if (this.x < -10) this.x += W + 20;
      else if (this.x > W + 10) this.x -= W + 20;

      for (const p of this.plats) {
        if (p.kind === 'move') {
          p.x += p.vx * dt;
          if (Math.abs(p.x - p.home) > p.range) {
            p.vx = -p.vx;
            p.x = clamp(p.x, p.home - p.range, p.home + p.range);
          }
        }
        if (p.gone) p.gone += dt;
        if (p.springT > 0) p.springT -= dt;
      }

      const prevY = this.y;
      this.vy = Math.min(this.vy + GRAV * dt, 700);
      this.y += this.vy * dt;
      // 往下落的时候，脚穿过了窗口顶边：弹起来
      if (this.vy > 0) {
        for (const p of this.plats) {
          if (p.gone || prevY > p.y || this.y < p.y || this.x < p.x - 7 || this.x > p.x + p.w + 7) continue;
          this.bounce(p);
          break;
        }
      }

      // 镜头只往上走
      this.cam = Math.min(this.cam, this.y - H * 0.45);
      this.maxUp = Math.max(this.maxUp, START_Y - this.y);
      // 踩上第一个窗口以后，起点的任务栏就不在了：再掉下去就是真掉了
      if (this.maxUp > 90 && this.plats[0] && this.plats[0].kind === 'floor') this.plats[0].gone = 0.001;
      for (const st of this.stars) {
        if (st.got || Math.abs(st.x - this.x) > 13 || Math.abs(st.y - (this.y - 8)) > 13) continue;
        st.got = true;
        this.starsGot++;
        this.floats.push({ text: `+${STAR_PTS}`, x: st.x, y: st.y, life: 0.8 });
        this.env.sound('star');
      }
      this.generate();
      if (this.y - this.cam > H + 20) {
        this.dying = 0.9;
        this.env.sound('bad');
      }
    }

    bounce(p) {
      this.y = p.y;
      this.squash = 0.12;
      if (p.spring) {
        this.vy = -SPRING;
        p.springT = 0.25;
        this.env.sound('spring');
      } else {
        this.vy = -JUMP;
        this.env.sound('jump');
      }
      if (p.kind === 'fragile') {
        p.gone = 0.001;
        this.env.sound('pop');
      }
      for (let i = 0; i < 5; i++) this.parts.push({ x: this.x + rand(-8, 8), y: p.y, vx: rand(-40, 40), vy: rand(-60, -20), life: rand(0.25, 0.45), c: 'rgba(255,255,255,0.8)' });
    }

    draw(g, t) {
      const sy = (y) => y - this.cam; // 世界 → 屏幕
      const m = Math.max(0, (START_Y - (this.cam + H / 2)) / 10);
      const [top, bottom] = skyAt(m);
      g.gradient(0, 0, W, H, [[0, top], [1, bottom]]);
      // 越高星星越亮
      const night = clamp((m - 260) / 200, 0, 1);
      if (night > 0) {
        for (const d of this.skyDots) {
          const y = (((d.y - this.cam * 0.15) % 600) + 600) % 600;
          if (y < H) g.alpha(night * (0.5 + 0.5 * Math.sin(t * 2 + d.x)), () => g.rect(d.x, y, d.r, d.r, '#FFFFFF'));
        }
      }
      // 每 50 米一道刻度
      for (let k = Math.ceil(this.meters / 50 - 2) * 50; k < this.meters + 120; k += 50) {
        if (k <= 0) continue;
        const y = sy(START_Y - k * 10);
        if (y < 14 || y > H) continue;
        for (let x = 0; x < W; x += 10) g.alpha(0.35, () => g.rect(x, y, 5, 1, night > 0.5 ? '#FFFFFF' : '#2B2620'));
        g.text(tr('hop.height', { n: k }), W - 6, y - 5, { size: 6, weight: 700, color: night > 0.5 ? '#FFFFFF' : '#2B2620', align: 'right' });
      }

      for (const p of this.plats) this.drawPlat(g, p, sy(p.y), t);
      for (const st of this.stars) {
        const bob = Math.sin(t * 3 + st.ph) * 2;
        g.glyph('star', st.x, sy(st.y) + bob, 2, '#FFD43B', '#8A5A00');
      }
      for (const q of this.parts) g.alpha(q.life / 0.4, () => g.rect(q.x, sy(q.y), 1.5, 1.5, q.c));

      // 小章鱼：往上时缩着腿，往下时张开手
      const up = this.vy < 0;
      const pose = this.dying
        ? { eyes: 'x', armL: 'high', armR: 'high', legs: 'kick0', t }
        : this.squash > 0
        ? { top: 2, wide: true, eyes: 'happy', armL: 5, armR: 5, t }
        : up
        ? { legs: 'tuck', armL: 1, armR: 1, eyes: 'happy', t }
        : { legs: Math.floor(t * 10) % 2 ? 'kick0' : 'kick1', armL: 'high', armR: 'high', eyes: this.vy > 420 ? 'wide' : 'open', t };
      const y = sy(this.y);
      g.pet(this.x, y, PET_UNIT, pose, this.facing < 0);
      // 穿过屏幕边时，另一边也画半个
      if (this.x < 14) g.pet(this.x + W + 20, y, PET_UNIT, pose, this.facing < 0);
      else if (this.x > W - 14) g.pet(this.x - W - 20, y, PET_UNIT, pose, this.facing < 0);
      for (const f of this.floats) g.alpha(f.life / 0.4, () => g.text(f.text, f.x, sy(f.y), { size: 7, weight: 800, color: '#8A5A00', align: 'center' }));
    }

    // 小窗口：标题栏（颜色看种类）+ 窗口身子
    drawPlat(g, p, y, t) {
      if (p.kind === 'floor') {
        g.rect(-4, y, W + 8, 14, '#1F2333');
        g.rect(-4, y, W + 8, 1, '#3A4160');
        g.round(6, y + 3, 9, 8, 2, '#5B9BD5', null);
        [24, 38, 52].forEach((x, i) => g.round(x, y + 3.5, 9, 7, 1.5, ['#D97757', '#7DB85C', '#E2A23B'][i], null));
        return;
      }
      let h = 15;
      let k = 1;
      if (p.gone) {
        // 最小化：往下缩成一条
        k = clamp(1 - p.gone / 0.35, 0, 1);
        h *= k;
      }
      g.alpha(p.gone ? k : 1, () => {
        const bar = p.kind === 'move' ? '#5B9BD5' : p.kind === 'fragile' ? '#D9534F' : '#C8CCD4';
        g.rect(p.x + 1, y + 1, p.w, Math.max(2, h), 'rgba(0,0,0,0.18)'); // 影子
        g.rect(p.x, y, p.w, Math.max(2, h), '#F7F5F0');
        g.rect(p.x, y, p.w, Math.min(h, 4.5), bar);
        // 右上角的三个小按钮
        if (h > 4) for (let i = 0; i < 3; i++) g.rect(p.x + p.w - 4 - i * 3.5, y + 1.5, 2, 1.5, i === 0 && p.kind === 'fragile' ? '#FFFFFF' : 'rgba(255,255,255,0.75)');
        if (h > 10) p.lines.forEach((len, i) => g.rect(p.x + 4, y + 7.5 + i * 3.5, (p.w - 8) * len, 1.2, '#C9CDD4'));
        if (p.kind === 'move' && h > 10) {
          // 被拖着：标题栏上一只小手
          const hx = p.x + p.w / 2 + Math.sin(t * 6) * 0.5;
          g.rect(hx - 1, y - 3, 2, 4, '#FFFFFF');
          g.rect(hx - 2.5, y - 1, 5, 3, '#FFFFFF');
          g.rect(hx - 2.5, y + 2, 5, 0.6, '#2B2620');
        }
      });
      if (p.spring && !p.gone) {
        const squeeze = p.springT > 0 ? 2 : 0;
        g.sprite(squeeze ? NOTE.slice(0, 2) : NOTE, NOTE_C, p.x + p.w / 2 - 6, y - (squeeze ? 3 : 5), 1.5);
      }
    }

    hud() {
      return { score: this.score, lives: null, label: tr('hop.height', { n: this.meters }) };
    }

    metrics() {
      return { meters: this.meters };
    }

    summary() {
      return [{ text: tr('hop.heightSum', { n: this.meters }) }, { text: tr('hop.stars', { n: this.starsGot, pts: this.starsGot * STAR_PTS }) }];
    }
  }

  ARCADE.register({
    id: 'hop',
    icon(g, x, y, w, h, t) {
      g.gradient(x, y, w, h, [[0, '#F2A65A'], [1, '#E3F1FB']]);
      const wins = [
        [0.08, 0.78, 0.36, '#C8CCD4'],
        [0.52, 0.56, 0.34, '#5B9BD5'],
        [0.14, 0.32, 0.32, '#C8CCD4'],
        [0.56, 0.12, 0.3, '#D9534F'],
      ];
      for (const [fx, fy, fw, bar] of wins) {
        const wx = x + fx * w;
        const wy = y + fy * h;
        g.rect(wx, wy, fw * w, 11, '#F7F5F0');
        g.rect(wx, wy, fw * w, 3.5, bar);
      }
      // 在第二个和第三个窗口之间来回跳
      const k = (t * 1.1) % 1;
      const arc = Math.sin(k * Math.PI);
      const px0 = x + 0.69 * w;
      const px1 = x + 0.3 * w;
      const fromY = y + 0.56 * h;
      const toY = y + 0.32 * h;
      const flip = Math.floor(t * 1.1) % 2;
      const [ax, bx, ay, by] = flip ? [px1, px0, toY, fromY] : [px0, px1, fromY, toY];
      g.pet(ax + (bx - ax) * k, ay + (by - ay) * k - arc * 22, 1.2, { legs: arc > 0.2 ? 'tuck' : 'stand', armL: 'high', armR: 'high', eyes: 'happy', t }, bx < ax);
    },
    create: (env) => new Hop(env),
  });
})();
