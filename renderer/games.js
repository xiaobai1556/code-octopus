// 小章鱼们一起玩：抛球、叠罗汉、排队走。只有闲着的才玩（没在干活、没举牌子、没睡觉、没被拖着）。
// 有两只以上闲着、站在同一段平台上时，隔一会儿随机开一局；右键菜单"叫小伙伴来玩"会叫小伙伴来（最多同时 4 个），
// 它们待两分钟左右，一局接一局地玩，主人在忙的时候它们先自己玩。
// 一局里成员的走动在 behave() 里（由 Pet.behave 转过来），球、阶段切换在 update() 里（每帧一次）。

const GAME_GAP = [40, 100]; // 两局之间隔几秒
const VISITOR_GAP = [3, 7]; // 有小伙伴在的时候，两局之间只歇一会儿
const MAX_VISITORS = 4;
const VISITOR_STAY = [100, 160]; // 小伙伴待多少秒
const BALL_G = 1500;
const FREE_MODES = new Set(['idle', 'walk', 'sit', 'look', 'stretch', 'dance', 'read', 'coffee', 'game']);
const lerp = (a, b, k) => a + (b - a) * k;

const games = {
  world: null,
  current: null,
  cooldown: 15,

  isFree(p) {
    const w = this.world;
    if (!p.ground || p.activity || p.leaving || p.leaveAt || p.mount || p.game || p.feedHover || p.mode === 'drag') return false;
    if (p.emote && p.emote.kind !== 'love') return false;
    if (w.tour && w.tour.pet === p) return false;
    return FREE_MODES.has(p.mode) || p.mode === 'busy';
  },

  // 一局里的成员还能接着玩吗
  stillIn(p) {
    return this.world.pets.includes(p) && !p.activity && !p.leaving && p.mode !== 'drag';
  },

  sameSegment(a, b) {
    if (!a.ground || !b.ground || a.ground.id !== b.ground.id) return false;
    if (a.ground.id === 'floor') return true;
    const w = this.world;
    const s = w.segmentAt(a.ground.id, a.x, a.edgeTolerance());
    return !!s && s === w.segmentAt(b.ground.id, b.x, b.edgeTolerance());
  },

  // 站着的这一段平台从哪到哪
  span(p) {
    const w = this.world;
    if (!p.ground || p.ground.id === 'floor') return [0, w.width];
    const s = w.segmentAt(p.ground.id, p.x, p.edgeTolerance());
    return s ? [s.x1, s.x2] : [p.x, p.x];
  },

  tick(dt) {
    const w = this.world;
    this.tickVisitors();
    if (this.current) return this.current.update(dt);
    if ((this.cooldown -= dt) > 0 || w.userAway || w.tour) return;
    const visiting = this.visitors().length > 0;
    this.cooldown = visiting ? 1 : 3;
    if (!visiting && Math.random() > 0.3) return;
    // 小伙伴还在路上（还在掉、在往主人那边跳）的不算，等人齐
    const free = w.pets.filter((p) => this.isFree(p) && (p.mode !== 'busy' || p.visitor) && !(p.visitor && !p.arrived));
    const groups = [];
    for (const p of free) {
      const g = groups.find((x) => this.sameSegment(x[0], p));
      if (g) g.push(p);
      else groups.push([p]);
    }
    // 有小伙伴的那一群优先
    const ok = groups.filter((x) => x.length >= 2).sort((a, b) => b.filter((p) => p.visitor).length - a.filter((p) => p.visitor).length);
    if (ok.length) this.startRandom(visiting ? ok[0] : pick(ok));
  },

  startRandom(group) {
    const w = this.world;
    const kinds = [];
    const pair = this.ballPair(group);
    if (pair) kinds.push('ball', 'ball');
    // 要走到一起的游戏：路上不能有窗口挡着
    const walkable = group.filter((p) => p === group[0] || w.clearPath(group[0], p));
    if (walkable.length >= 2) {
      group = walkable;
      kinds.push('stack');
      const [x1, x2] = this.span(group[0]);
      if (x2 - x1 > 340) kinds.push('conga');
    }
    if (!kinds.length) return false;
    const kind = pick(kinds);
    if (kind === 'ball') this.start(new BallGame(this, pair));
    else if (kind === 'conga') this.start(new CongaGame(this, group.slice(0, 5)));
    else this.start(new StackGame(this, group.slice(0, 4)));
    return true;
  },

  // 抛球要隔开一点距离，太近太远都不行
  ballPair(group) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const d = Math.abs(group[i].x - group[j].x);
        if (d >= 110 && d <= 520) return [group[i], group[j]];
      }
    }
    return null;
  },

  start(game) {
    this.current = game;
    for (const p of game.members) {
      p.game = game;
      p.touch();
      p.emote = null;
      p.setMode('play', 0);
    }
    game.begin();
  },

  finish(game) {
    if (this.current !== game) return;
    this.current = null;
    this.cooldown = rand(...(this.visitors().length ? VISITOR_GAP : GAME_GAP));
    for (const p of game.members) {
      p.game = null;
      if (p.mount) this.dismount(p, rand(-90, 90));
      if (p.mode === 'play') p.setMode('idle', rand(1, 2.5));
    }
  },

  // 叫来玩的小伙伴：挥挥手就走
  sendHome(p) {
    if (p.leaveAt || p.leaving || !this.world.pets.includes(p)) return;
    p.leaveAt = performance.now() + 2200;
    p.exitDir = this.world.exitSide(p);
    setTimeout(() => p.say(tr('say.bye'), 1.6), 600);
  },

  abort(game) {
    if (game && game.abort) game.abort();
    this.finish(game);
  },

  behave(pet, dt) {
    return this.current === pet.game ? pet.game.behave(pet, dt) : false;
  },

  pose(pet, p) {
    return this.current === pet.game && pet.game.pose(pet, p);
  },

  draw(ctx) {
    if (this.current && this.current.draw) this.current.draw(ctx);
  },

  // ---------- 叠罗汉：站在下面那只的头顶上 ----------
  ride(pet, dt) {
    const m = pet.mount;
    if (!this.world.pets.includes(m) || m.mode === 'drag' || m.leaving || (!m.ground && !m.mount)) return this.dismount(pet, rand(-120, 120));
    pet.mountT = (pet.mountT || 0) + dt;
    const hx = m.x + (m.lastSway || 0);
    const hy = m.headTop();
    const k = Math.min(1, pet.mountT / 0.45);
    if (k < 1 && pet.mountFrom) {
      // 跳上去的那一下：画一道弧线
      pet.x = lerp(pet.mountFrom.x, hx, k);
      pet.y = lerp(pet.mountFrom.y, hy, k) - Math.sin(k * Math.PI) * 46;
    } else {
      pet.x = hx;
      pet.y = hy;
    }
  },

  dismount(pet, vx) {
    pet.mount = null;
    pet.mountFrom = null;
    pet.ground = null;
    pet.climb = null;
    pet.vx = vx;
    pet.vy = -340;
    pet.mode = 'air';
    pet.layerId = null;
  },

  // ---------- 叫小伙伴来玩 ----------
  visitors() {
    return this.world.pets.filter((p) => p.visitor && !p.leaving && !p.leaveAt);
  },

  canInvite() {
    return this.visitors().length < MAX_VISITORS;
  },

  inviteFriend(host) {
    const w = this.world;
    if (!this.canInvite() || host.leaving) return false;
    // 从主人旁边、离别的小伙伴远一点的地方掉下来
    const taken = this.visitors().map((p) => p.x);
    let x = host.x;
    for (let i = 0; i < 6; i++) {
      const side = (host.x < w.width / 2 ? 1 : -1) * (i % 2 ? -1 : 1);
      x = clamp(host.x + side * rand(140, 320), 60, w.width - 60);
      if (taken.every((t) => Math.abs(t - x) > 90)) break;
    }
    const guest = w.spawnPet(x);
    guest.visitor = true;
    guest.host = host;
    guest.stayUntil = performance.now() + rand(...VISITOR_STAY) * 1000;
    guest.ownOutfit = randomOutfit();
    if (this.isFree(host) || host.game) {
      host.say(tr('game.call'), 1.6);
      if (!host.game) host.doEmote('wave', 1.2);
    }
    setTimeout(() => guest.say(tr('game.coming'), 1.6), 700);
    this.cooldown = Math.min(this.cooldown, 2);
    return true;
  },

  sendAllHome() {
    for (const p of this.visitors()) {
      if (p.game) this.abort(p.game);
      this.sendHome(p);
    }
  },

  // 小伙伴们：到点就回家；主人走了就换一个主人；落在别的窗口上就跳到主人那段平台上去
  tickVisitors() {
    const w = this.world;
    const now = performance.now();
    for (const v of this.visitors()) {
      if (v.game) continue;
      if (now > v.stayUntil) {
        this.sendHome(v);
        continue;
      }
      if (!w.pets.includes(v.host) || v.host.leaving || v.host.leaveAt) {
        v.host = w.pets.find((p) => !p.visitor && !p.leaving && !p.leaveAt) || null;
        if (!v.host) {
          this.sendHome(v);
          continue;
        }
      }
      const host = v.host;
      if (!v.ground || !host.ground || !this.isFree(v) || v.mode === 'crouch') continue;
      if (this.sameSegment(host, v)) {
        if (!v.arrived) {
          v.arrived = true;
          v.facing = host.x > v.x ? 1 : -1;
          // 主人在忙：先自己玩，等它忙完
          v.say(tr(this.isFree(host) || host.game ? 'say.hi' : 'game.waitBusy'), 1.6);
        }
        continue;
      }
      // 跳了几次还是够不着（被窗口挡着）：就在这儿玩吧
      if ((v.hops = (v.hops || 0) + 1) > 3) {
        v.arrived = true;
        continue;
      }
      const [x1, x2] = this.span(host);
      const off = (v.x < host.x ? -1 : 1) * rand(110, 260);
      const x = clamp(host.x + off, x1 + v.halfW, x2 - v.halfW);
      v.jumpTarget = { x, y: host.ground.id === 'floor' ? w.height : host.ground.y };
      v.setMode('crouch', 0.22);
    }
  },
};

function randomOutfit() {
  const out = {};
  for (const slot of OUTFITS.SLOTS) {
    const items = Object.keys(OUTFITS.ITEMS).filter((k) => OUTFITS.ITEMS[k].slot === slot && !OUTFITS.ITEMS[k].holiday);
    out[slot] = Math.random() < (slot === 'head' ? 0.7 : 0.35) ? pick(items) : '';
  }
  return out;
}

function walkLegs(pet, p) {
  p.legs = Math.floor(pet.walkDist / (pet.Pd * 2)) % 2 ? 'walk0' : 'walk1';
}

// ---------- 抛球 ----------
class BallGame {
  constructor(g, [a, b]) {
    this.kind = 'ball';
    this.g = g;
    this.members = [a, b];
    this.holder = a;
    this.other = b;
    this.thrower = null;
    this.ball = null;
    this.throws = 0;
    this.max = 4 + Math.floor(Math.random() * 5);
    this.phase = 'hold';
    this.wait = 0.9;
    this.t = 0;
  }

  begin() {
    this.holder.say(tr('game.ball'), 1.6);
  }

  partner(p) {
    return p === this.members[0] ? this.members[1] : this.members[0];
  }

  hand(p) {
    return { x: p.x + p.facing * p.halfW * 0.95, y: p.y - p.height - p.Pd * 1.5 };
  }

  update(dt) {
    if (!this.members.every((p) => this.g.stillIn(p) && (p.ground || p === this.chaser))) return this.g.finish(this);
    this.t += dt;
    for (const p of this.members) {
      p.touch();
      if (p !== this.chaser) p.facing = this.partner(p).x > p.x ? 1 : -1;
    }
    const b = this.ball;
    if (this.phase === 'hold') {
      if ((this.wait -= dt) <= 0) this.throwBall();
    } else if (b) {
      b.age += dt;
      b.vy += BALL_G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (this.phase === 'flight' && !b.miss && b.age >= b.T) return this.catchBall();
      const [x1, x2] = this.g.span(this.other);
      const floorY = this.other.y - b.r;
      if (b.x < x1 - 4 || b.x > x2 + 4) {
        // 滚出平台掉下去了
        if (this.phase !== 'lost') {
          this.phase = 'lost';
          this.lostAt = this.t;
          this.other.doEmote('oops', 1.2);
          this.other.say(tr('game.ballLost'), 1.6);
        }
        if (this.t - this.lostAt > 1.4) {
          this.g.world.poof(b.x, Math.min(b.y, this.g.world.height - 6));
          this.g.finish(this);
        }
        return;
      }
      if (b.miss && b.y >= floorY && b.vy > 0) {
        b.y = floorY;
        b.vy = -b.vy * 0.5;
        b.vx *= 0.7;
        if (++b.bounces >= 3 || Math.abs(b.vy) < 80) {
          b.vy = 0;
          b.g = false;
          this.phase = 'roll';
          this.chaser = this.other;
        }
      }
      if (this.phase === 'roll') {
        b.y = floorY;
        b.vy = 0;
        b.vx *= Math.pow(0.25, dt);
      }
    }
  }

  throwBall() {
    const from = this.hand(this.holder);
    const to = this.hand(this.other);
    this.throws++;
    const miss = this.throws >= this.max && Math.random() < 0.7;
    const T = clamp(Math.abs(to.x - from.x) / 340, 0.6, 1.2);
    const dir = Math.sign(to.x - from.x) || 1;
    const tx = miss ? to.x + dir * rand(70, 130) : to.x;
    const ty = miss ? to.y - 6 : to.y;
    this.ball = { x: from.x, y: from.y, vx: (tx - from.x) / T, vy: (ty - from.y - 0.5 * BALL_G * T * T) / T, T, age: 0, miss, bounces: 0, r: this.holder.Pd * 1.5 };
    this.thrower = this.holder;
    this.holder = null;
    this.phase = 'flight';
  }

  catchBall() {
    this.holder = this.other;
    this.other = this.thrower;
    this.ball = null;
    this.phase = 'hold';
    this.wait = rand(0.35, 0.75);
    if (Math.random() < 0.3) this.holder.say(pick(tr('game.catch').split('|')), 0.9);
    // 一直没失手：玩够了就收工
    if (this.throws >= this.max + 3) {
      for (const p of this.members) p.doEmote('cheer', 1.4);
      this.g.finish(this);
    }
  }

  behave(pet, dt) {
    if (this.phase === 'roll' && pet === this.chaser && this.ball) {
      const d = this.ball.x - pet.x;
      if (Math.abs(d) > pet.halfW * 0.6) {
        const r = pet.step(Math.sign(d), RUN_SPEED * 0.55, dt, 'turn', this.ball.x);
        if (r === 'blocked' || r === 'wall' || r === 'fell') this.g.finish(this);
      } else {
        // 捡起来了
        pet.say(tr('game.ballMiss'), 1.6);
        pet.doEmote('oops', 1);
        this.g.finish(this);
      }
    }
    return true;
  }

  pose(pet, p) {
    const b = this.ball;
    if (this.phase === 'hold' && this.holder === pet) Object.assign(p, { eyes: 'happy', armR: 'high', armL: 4 });
    else if (this.phase === 'flight' && this.other === pet) Object.assign(p, b && b.miss && b.age > b.T * 0.6 ? { eyes: 'wide', armL: 1, armR: 1, props: ['sweat'] } : { eyes: 'wide', armL: 'high', armR: 'high' });
    else if (this.phase === 'flight' && this.thrower === pet) Object.assign(p, { eyes: 'happy', armR: 1 });
    else if (this.phase === 'roll' && pet === this.chaser) {
      walkLegs(pet, p);
      p.eyes = 'wide';
    } else if (b) p.dx = Math.sign(b.x - pet.x) * pet.facing;
    return true;
  }

  draw(ctx) {
    const pos = this.ball || (this.holder && this.hand(this.holder));
    if (!pos) return;
    const dpr = this.g.world.dpr;
    const P = this.members[0].P;
    const c = Math.max(1, Math.round(P * 0.75)); // 每格
    const x = Math.round(pos.x * dpr - 2 * c);
    const y = Math.round(pos.y * dpr - 2 * c);
    const spin = this.ball ? Math.floor(this.ball.age * 10) % 2 : 0;
    // 4×4 的沙滩球：白底红块，转着飞
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 1, y + c - 1, 4 * c + 2, 2 * c + 2);
    ctx.fillRect(x + c - 1, y - 1, 2 * c + 2, 4 * c + 2);
    ctx.fillStyle = '#F4F1EA';
    ctx.fillRect(x, y + c, 4 * c, 2 * c);
    ctx.fillRect(x + c, y, 2 * c, 4 * c);
    ctx.fillStyle = '#E5484D';
    if (spin) {
      ctx.fillRect(x + c, y, c, c);
      ctx.fillRect(x + 2 * c, y + 3 * c, c, c);
      ctx.fillRect(x, y + 2 * c, c, c);
      ctx.fillRect(x + 3 * c, y + c, c, c);
    } else {
      ctx.fillRect(x + 2 * c, y, c, c);
      ctx.fillRect(x + c, y + 3 * c, c, c);
      ctx.fillRect(x, y + c, c, c);
      ctx.fillRect(x + 3 * c, y + 2 * c, c, c);
    }
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(x + c, y + c, 2 * c, 2 * c);
  }
}

// ---------- 叠罗汉 ----------
class StackGame {
  constructor(g, group) {
    this.kind = 'stack';
    this.g = g;
    // 最胖的那只当底座
    const sorted = group.slice().sort((a, b) => b.fat - a.fat);
    this.base = sorted[0];
    this.members = sorted;
    this.queue = sorted.slice(1);
    this.top = this.base;
    this.phase = 'gather';
    this.t = 0;
  }

  begin() {
    this.base.say(tr('game.stack'), 1.6);
    this.base.facing = this.queue[0].x > this.base.x ? 1 : -1;
  }

  update(dt) {
    const climbers = this.members.filter((p) => p !== this.base);
    if (!this.g.stillIn(this.base) || !this.base.ground || !climbers.every((p) => this.g.stillIn(p) && (p.ground || p.mount))) return this.g.finish(this);
    this.t += dt;
    for (const p of this.members) p.touch();
    if (this.phase === 'gather' && !this.queue.length && this.top.mountT > 0.5) {
      this.phase = 'pose';
      this.t = 0;
      this.top.say(tr('game.stackDone'), 2.4);
      this.g.world.sparkles(this.top);
    } else if (this.phase === 'pose' && this.t > 3.4) {
      // 晃着晃着塌了
      const order = climbers.slice().reverse();
      for (const p of order) this.g.dismount(p, rand(-160, 160));
      this.base.doEmote(this.base.fat ? 'dizzy' : 'cheer', 1.2);
      if (this.base.fat) this.base.say(tr('game.heavy'), 1.4);
      this.g.finish(this);
    }
  }

  behave(pet, dt) {
    if (this.phase !== 'gather' || pet !== this.queue[0]) return true;
    const tx = this.base.x;
    const d = tx - pet.x;
    if (Math.abs(d) > pet.halfW + this.base.halfW + 6) {
      const r = pet.step(Math.sign(d), WALK_SPEED * 2, dt, 'turn');
      if (r !== 'ok') this.g.finish(this);
      return true;
    }
    // 走到旁边了：跳到最上面那只的头顶
    this.queue.shift();
    pet.mount = this.top;
    pet.mountT = 0;
    pet.mountFrom = { x: pet.x, y: pet.y };
    pet.ground = null;
    this.top = pet;
    return true;
  }

  pose(pet, p) {
    if (pet === this.base) {
      Object.assign(p, { eyes: this.phase === 'pose' ? 'down' : 'open', armL: 'high', armR: 'high', top: this.phase === 'pose' ? 1 : 0 });
      // 越叠越晃
      if (this.phase === 'pose') p.sway = Math.sin(this.t * 9) * Math.min(5, 1 + this.t * 1.6);
    } else if (pet.mount) {
      Object.assign(p, { eyes: 'happy', armL: 'high', armR: 'high', blush: true, shadow: false });
      if (pet.mountT < 0.45) p.legs = 'tuck';
    } else {
      walkLegs(pet, p);
      p.eyes = 'happy';
    }
    return true;
  }
}

// ---------- 排队走 ----------
class CongaGame {
  constructor(g, group) {
    this.kind = 'conga';
    this.g = g;
    this.members = group;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    // 队头在前进方向的最前面
    this.line = group.slice().sort((a, b) => (b.x - a.x) * this.dir);
    this.t = 0;
    this.dur = rand(8, 12);
    this.noteT = 0;
  }

  begin() {
    this.line[0].say(tr('game.conga'), 1.8);
  }

  update(dt) {
    if (!this.members.every((p) => this.g.stillIn(p) && p.ground)) return this.g.finish(this);
    this.t += dt;
    for (const p of this.members) p.touch();
    if ((this.noteT -= dt) <= 0) {
      this.noteT = 0.55;
      this.g.world.note(pick(this.members));
    }
    if (this.t > this.dur) {
      for (const p of this.members) p.doEmote('cheer', 1.2);
      this.g.finish(this);
    }
  }

  behave(pet, dt) {
    const i = this.line.indexOf(pet);
    if (i === 0) {
      const r = pet.step(this.dir, WALK_SPEED * 1.3, dt, 'turn');
      if (r === 'blocked' || r === 'wall') {
        // 走到头了：整队掉头，队尾变队头
        this.dir = -this.dir;
        this.line.reverse();
      } else if (r === 'fell' || r === 'gone') this.g.finish(this);
      return true;
    }
    const ahead = this.line[i - 1];
    const tx = ahead.x - this.dir * (ahead.halfW + pet.halfW + 4);
    const d = tx - pet.x;
    if (Math.abs(d) > 1.5) pet.step(Math.sign(d), clamp(Math.abs(d) * 4, WALK_SPEED, RUN_SPEED * 0.7), dt, 'turn', tx);
    pet.facing = this.dir;
    return true;
  }

  pose(pet, p) {
    walkLegs(pet, p);
    const beat = Math.floor(this.t * 3) % 2;
    Object.assign(p, { eyes: 'happy', armL: beat ? 'high' : 4, armR: beat ? 4 : 'high', blush: true, dx: 1 });
    p.hop = Math.abs(Math.sin(this.t * Math.PI * 3)) * 3;
    return true;
  }
}
