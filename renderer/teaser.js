// 逗猫棒：右键「陪我玩」后，光标下面吊着一根羽毛，晃起来像钟摆。在它附近晃，闲着的小章鱼会追着跑、扑上去跳，
// 扑到了把羽毛拍飞；跳累了坐下喘口气。光标 8 秒不动、离开这块屏 8 秒、或者玩了 1 分钟就收起来。

const TEASER_MAX_S = 60;
const TEASER_IDLE_S = 8;
const STRING_LEN = 46;
const TOY_G = 1400;

const teaser = {
  world: null,
  on: false,
  toy: null, // 羽毛的位置和速度
  anchor: null, // 光标（绳子的另一头）
  startedAt: 0,
  movedAt: 0,
  lastMouse: null,
  speed: 0, // 光标晃得多快（像素/秒，平滑过）

  start(pet) {
    const m = this.world.mouse;
    this.on = true;
    this.startedAt = this.movedAt = performance.now();
    this.anchor = m ? { ...m } : null;
    this.toy = m ? { x: m.x, y: m.y + STRING_LEN, vx: 0, vy: 0 } : null;
    if (pet) pet.say(tr('teaser.start'), 1.6);
  },

  stop(quiet) {
    if (!this.on) return;
    this.on = false;
    this.toy = null;
    for (const p of this.world.pets) if (p.mode === 'chase') p.setMode('idle', rand(0.5, 1.5));
    const fan = this.world.pets.find((p) => !p.leaving && p.ground && !p.activity);
    if (fan && !quiet) fan.say(tr('teaser.end'), 1.4);
  },

  update(dt) {
    if (!this.on) return;
    const now = performance.now();
    const m = this.world.mouse;
    if (m && this.lastMouse) {
      const d = Math.hypot(m.x - this.lastMouse.x, m.y - this.lastMouse.y);
      if (d > 0.5) this.movedAt = now;
      this.speed = this.speed * Math.pow(0.05, dt) + (dt > 0 ? d / dt : 0) * (1 - Math.pow(0.05, dt));
    }
    this.lastMouse = m;
    if ((now - this.startedAt) / 1000 > TEASER_MAX_S || (now - this.movedAt) / 1000 > TEASER_IDLE_S) return this.stop();
    if (!m) {
      this.toy = null;
      return;
    }
    this.anchor = { x: m.x, y: m.y + 10 };
    if (!this.toy) this.toy = { x: m.x, y: m.y + STRING_LEN, vx: 0, vy: 0 };
    // 钟摆：重力 + 绳子不能拉长
    const t = this.toy;
    t.vy += TOY_G * dt;
    t.vx *= Math.pow(0.4, dt);
    t.vy *= Math.pow(0.4, dt);
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const dx = t.x - this.anchor.x;
    const dy = t.y - this.anchor.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > STRING_LEN) {
      const nx = dx / dist;
      const ny = dy / dist;
      t.x = this.anchor.x + nx * STRING_LEN;
      t.y = this.anchor.y + ny * STRING_LEN;
      const out = t.vx * nx + t.vy * ny;
      if (out > 0) {
        t.vx -= out * nx;
        t.vy -= out * ny;
      }
    }
    // 在空中扑到羽毛：拍飞它
    for (const p of this.world.pets) {
      if (p.ground) p.chasing = false; // 落地了，这一扑没扑着
      if (p.ground || p.mode === 'drag' || !p.chasing) continue;
      if (Math.hypot(t.x - p.x, t.y - (p.y - p.height * 0.7)) > p.halfW + 6) continue;
      p.chasing = false;
      t.vx += (t.x > p.x ? 1 : -1) * 420;
      t.vy -= 380;
      this.world.sparkles(p);
      if (Math.random() < 0.4) p.say(pick(tr('teaser.caught').split('|')), 1);
    }
  },

  // 闲着的小章鱼追羽毛；返回 true 表示这一帧由逗猫棒接管
  behave(pet, dt) {
    if (!this.on || !this.toy || !pet.ground || pet.game || pet.mount || pet.mode === 'sleep' || pet.mode === 'yawn') return false;
    const now = performance.now();
    if (pet.tiredUntil > now) return true; // 正坐着喘气
    pet.jumpCd = (pet.jumpCd || 0) - dt;
    const t = this.toy;
    const dx = t.x - pet.x;
    const head = pet.y - pet.height;
    const above = head - t.y; // 羽毛比头顶高多少
    if (Math.abs(dx) > 18) {
      pet.mode = 'chase';
      const speed = clamp(Math.abs(dx) * 3, 50, RUN_SPEED * (0.5 + Math.min(0.5, this.speed / 3000)));
      pet.step(Math.sign(dx), speed, dt, 'turn', t.x);
    } else {
      pet.mode = 'chase';
      pet.facing = dx >= 0 ? 1 : -1;
    }
    // 羽毛就在头顶上方够得着的地方：扑上去
    if (Math.abs(dx) < 60 && above > 6 && above < 320 && pet.jumpCd <= 0) {
      const h = clamp(above + pet.height * 0.4, 70, 330);
      pet.ground = null;
      pet.climb = null;
      pet.vy = -Math.sqrt(2 * GRAVITY * h);
      pet.vx = clamp(dx * 2.2, -260, 260);
      pet.mode = 'air';
      pet.chasing = true;
      pet.jumpCd = rand(0.45, 0.9);
      // 跳够了就累了
      if (++pet.tired >= 6 + Math.floor(Math.random() * 4)) {
        pet.tired = 0;
        pet.tiredUntil = now + 4500;
        setTimeout(() => {
          if (!this.world.pets.includes(pet)) return;
          pet.doEmote('pant', 4);
          pet.say(tr('teaser.tired'), 1.6);
        }, 700);
      }
    }
    return true;
  },

  draw(ctx) {
    if (!this.on || !this.toy || !this.anchor) return;
    const dpr = this.world.dpr;
    const pet = this.world.pets[0];
    const c = Math.max(2, Math.round((pet ? pet.P : 5 * dpr) * 0.6)); // 每格
    const t = this.toy;
    // 绳子
    ctx.strokeStyle = 'rgba(90,70,54,0.85)';
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.beginPath();
    ctx.moveTo(Math.round(this.anchor.x * dpr), Math.round(this.anchor.y * dpr));
    ctx.lineTo(Math.round(t.x * dpr), Math.round(t.y * dpr));
    ctx.stroke();
    // 羽毛：一颗小珠子下面三片彩色羽毛，随着摆动左右晃
    const x0 = Math.round(t.x * dpr);
    const y0 = Math.round(t.y * dpr);
    const lean = clamp(Math.round(t.vx / 260), -1, 1);
    const cells = [
      [0, 0, '#F2C14E'],
      [-1, 1, '#F25F8A'], [0, 1, '#F25F8A'], [1, 1, '#5BC0EB'],
      [-1 + lean, 2, '#F25F8A'], [0 + lean, 2, '#B388EB'], [1 + lean, 2, '#5BC0EB'],
      [-1 + lean, 3, '#B388EB'], [1 + lean * 2, 3, '#5BC0EB'],
      [-1 + lean * 2, 4, '#B388EB'],
    ];
    ctx.fillStyle = '#FFFFFF';
    for (const [gx, gy] of cells) ctx.fillRect(x0 + gx * c - 1, y0 + gy * c - 1, c + 2, c + 2);
    for (const [gx, gy, col] of cells) {
      ctx.fillStyle = col;
      ctx.fillRect(x0 + gx * c, y0 + gy * c, c, c);
    }
  },
};
