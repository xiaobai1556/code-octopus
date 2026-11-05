// 小游戏的无头测试：不开窗口，在 node 里用假画笔把每个游戏玩一遍——
// 什么都不按、乱按乱点乱敲，都不能出错，画的坐标不能是 NaN，结算的数字要正常；
// 今日挑战：同一个种子，怎么玩出的东西都一样。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18N = require('../src/i18n');
const ARCADE_RNG = require('../src/rng');
const ARCADE_CARDS = require('../src/arcade-cards');
const { GAMES } = require('../src/arcade');

const DT = 1 / 60;
const RENDERER = path.join(__dirname, '..', 'renderer');
const GAME_FILES = fs.readdirSync(RENDERER).filter((f) => /^arcade-.+\.js$/.test(f));
const ACTIONS = ['left', 'right', 'up', 'down', 'space', 'enter', 'yes', 'no', 'retry', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'upgrade', 'sell', 'fast'];
const TYPABLE = 'abcdefghijklmnopqrstuvwxyz ABCXYZ0123456789-_=+()[]{};:\'",.<>/?!@#$%^&*`~|\\';

const inside = (p, r) => !!p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// 和 renderer/arcade.js 里的 input 一样的接口；每帧由 feed() 填好
function makeInput(clock) {
  return {
    held: new Set(),
    hits: new Set(),
    clicks: [],
    typed: [],
    imeAt: -1e9,
    pointer: null,
    pointerAt: -1e9,
    down(a) {
      return this.held.has(a);
    },
    hit(...names) {
      for (const n of names) {
        if (this.hits.has(n)) {
          this.hits.delete(n);
          return true;
        }
      }
      return false;
    },
    axis() {
      return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    },
    pointerActive() {
      return !!this.pointer && clock.now - this.pointerAt < 1500;
    },
    takeClick(r) {
      const i = this.clicks.findIndex((p) => p.button === 0 && inside(p, r));
      if (i < 0) return false;
      this.clicks.splice(i, 1);
      return true;
    },
    takeAltClick() {
      const i = this.clicks.findIndex((p) => p.button === 2);
      return i < 0 ? null : this.clicks.splice(i, 1)[0];
    },
    endFrame() {
      this.hits.clear();
      this.clicks.length = 0;
      this.typed.length = 0;
    },
  };
}

// 假画笔：什么都不画，只记下传进来的数字里有没有 NaN
function makePainter() {
  const bad = [];
  const check = (name, args) => {
    args.forEach((a, i) => {
      if (typeof a === 'number' && Number.isNaN(a)) bad.push(`${name} 第 ${i + 1} 个参数是 NaN`);
    });
  };
  const special = {
    measure: (str, o = {}) => String(str).length * (o.size || 7) * 0.55,
    wrap: (str) => [String(str)],
    wrapBalanced: (str) => [String(str)],
    alpha: (a, fn) => fn(),
    hover: () => false,
    button: () => false,
  };
  const g = new Proxy(
    {},
    {
      get: (_t, name) => (...args) => {
        check(name, args);
        return special[name] ? special[name](...args) : undefined;
      },
    }
  );
  return { g, bad };
}

// 加载所有游戏：外壳提供的全局名（W、H、C、tr、rand……）放进一个沙盒
function loadArcade() {
  const clock = { now: 0 };
  const input = makeInput(clock);
  const mathRand = (a, b) => a + Math.random() * (b - a);
  const sandbox = {
    console,
    performance: { now: () => clock.now },
    W: 360,
    H: 240,
    C: new Proxy({}, { get: () => '#808080' }),
    tr: (key, vars) => I18N.t(key, vars),
    rand: mathRand,
    clamp: (v, a, b) => Math.min(Math.max(v, a), b),
    pick: (list) => list[Math.floor(Math.random() * list.length)],
    shade: (hex) => hex,
    inside,
    input,
    ARCADE_RNG,
    ARCADE_CARDS,
    ARCADE: {
      games: [],
      register(game) {
        this.games.push(game);
      },
      // 和外壳的 ARCADE.env 一样：有种子就用播种的随机数
      env({ seed = '', best = 0 } = {}) {
        const rng = seed ? ARCADE_RNG.seeded(seed) : Math.random;
        return {
          sound: () => {},
          best,
          rng,
          rand: (a, b) => a + rng() * (b - a),
          pick: (list) => list[Math.floor(rng() * list.length)],
          daily: !!seed,
          imeWarning: () => clock.now - input.imeAt < 3000,
        };
      },
    },
  };
  vm.createContext(sandbox);
  for (const f of GAME_FILES) vm.runInContext(fs.readFileSync(path.join(RENDERER, f), 'utf8'), sandbox, { filename: f });
  return { sandbox, clock, input, games: sandbox.ARCADE.games };
}

// 乱按乱点：按种子来，出错了能复现
function monkey(seed) {
  const rng = ARCADE_RNG.seeded(seed);
  return (input, game) => {
    if (rng() < 0.08) input.hits.add(ACTIONS[Math.floor(rng() * ACTIONS.length)]);
    if (rng() < 0.05) {
      input.held.clear();
      const r = rng();
      if (r < 0.35) input.held.add('left');
      else if (r < 0.7) input.held.add('right');
    }
    if (rng() < 0.1) {
      input.pointer = { x: rng() * 360, y: rng() * 240 };
      input.pointerAt = Infinity; // 一直算"刚动过"
    }
    if (rng() < 0.04) input.clicks.push({ x: rng() * 360, y: rng() * 240, button: rng() < 0.85 ? 0 : 2 });
    if (game.textInput && rng() < 0.25) {
      // 打字游戏：多半敲对，偶尔敲错
      const want = game.line && game.line[game.pos];
      input.typed.push(want && rng() < 0.8 ? want : TYPABLE[Math.floor(rng() * TYPABLE.length)]);
    }
  };
}

const idle = () => {};

// 玩一局：最多 secs 秒；每 6 帧画一次
function play(arcade, id, { seed = '', strategy = idle, secs = 240, onFrame } = {}) {
  const def = arcade.games.find((g) => g.id === id);
  const { clock, input } = arcade;
  input.held.clear();
  input.endFrame();
  input.pointer = null;
  input.pointerAt = -1e9;
  const game = def.create(arcade.sandbox.ARCADE.env({ seed, best: 100 }));
  const { g, bad } = makePainter();
  let frames = 0;
  while (!game.over && frames < secs * 60) {
    strategy(input, game);
    game.update(DT, input);
    if (onFrame) onFrame(game, frames);
    input.endFrame();
    clock.now += 1000 / 60;
    if (frames % 6 === 0) {
      game.draw(g, frames * DT);
      game.hud();
    }
    frames++;
  }
  game.draw(g, frames * DT);
  def.icon(g, 0, 0, 100, 44, frames * DT);
  def.icon(g, 0, 0, 116, 76, frames * DT);
  return { game, seconds: frames * DT, bad };
}

function checkResult(id, { game, bad }) {
  assert.deepStrictEqual(bad.slice(0, 5), [], `${id}: 画的坐标里有 NaN`);
  assert.ok(Number.isFinite(game.score) && game.score >= 0, `${id}: 分数 ${game.score}`);
  const hud = game.hud();
  assert.ok(Number.isFinite(hud.score), `${id}: 状态栏的分数`);
  assert.strictEqual(typeof hud.label, 'string');
  assert.ok(!/NaN|undefined|\{/.test(hud.label), `${id}: 状态栏 "${hud.label}"`);
  const lines = game.summary();
  assert.ok(Array.isArray(lines) && lines.length > 0, `${id}: 结算没有内容`);
  for (const l of lines) assert.ok(typeof l.text === 'string' && l.text && !/NaN|undefined|\{/.test(l.text), `${id}: 结算 "${l.text}"`);
  const metrics = game.metrics();
  for (const [k, v] of Object.entries(metrics)) assert.ok(Number.isFinite(v) && v >= 0, `${id}: 成就用的 ${k} = ${v}`);
}

const arcade = loadArcade();

test('游戏都登记了，和 src/arcade.js 的列表一致', () => {
  assert.deepStrictEqual(arcade.games.map((g) => g.id).sort(), GAMES.slice().sort());
});

for (const id of GAMES) {
  test(`${id}：什么都不按，玩到结束`, () => {
    const r = play(arcade, id);
    checkResult(id, r);
    // 窗口跳跳站着不动会一直在开头那块窗口上弹，不会自己结束；其余的都会
    if (id !== 'hop') assert.ok(r.game.over, `${id}: 什么都不按 240 秒还没结束`);
  });

  test(`${id}：乱按乱点乱敲`, () => {
    for (const seed of ['a', 'b', 'c']) checkResult(id, play(arcade, id, { strategy: monkey(`${id}:${seed}`), secs: 150 }));
  });
}

// 今日挑战：每个游戏记下"出了什么"，两种玩法比一比。新出现的东西用 seen 认（被接住、打掉的会从数组里拿掉）
const fresh = (log, list) => list.filter((x) => !log.seen.has(x) && log.seen.add(x));
const PROBES = {
  bugs: (game, log) => fresh(log, game.items).forEach((it) => log.push(`${it.kind}@${Math.round(it.x)}/${Math.round(it.vy)}`)),
  hop: (game, log) => fresh(log, game.plats).forEach((p) => log.push(`${Math.round(p.x)},${Math.round(p.y)},${p.kind}`)),
  approve: (game, log) => {
    if (game.card && log[log.length - 1] !== game.card.text) log.push(game.card.text);
  },
  // 每一波来什么（第 1 波大家都一样是普通 Bug），以及每只出来时的速度
  defense: (game, log) => {
    if (log.lastNext !== game.next) log.push(game.next.join(' '));
    log.lastNext = game.next;
    fresh(log, game.enemies).forEach((e) => log.push(`${e.type}:${e.speed.toFixed(3)}`));
  },
  // 第 k 行是什么：当前行和后面排好的几行
  typing: (game, log) => [game.line, ...game.queue].forEach((l, i) => (log[game.lines + i] = l)),
  // 每一帧叫什么、从哪边滑进来
  stack: (game, log) => game.slider && fresh(log, [game.slider]).forEach((sl) => log.push(`${sl.name}<${sl.from}`)),
  // 排好的每一个：哪个格子、什么
  whack: (game, log) => fresh(log, game.planned).forEach((p) => log.push(`${p.cell}:${p.kind}`)),
  // 排好的每一个包：原定的格子、名字、种类（格子被占着往后挪不算）
  deps: (game, log) => fresh(log, game.planned).forEach((f) => log.push(`${f.planIdx}:${f.pkg[0]}:${f.kind}`)),
};

for (const id of GAMES) {
  test(`${id}：今日挑战同一天出的东西一样，换一天不一样`, () => {
    const probe = PROBES[id];
    assert.ok(probe, `${id}: 测试里还没写它的今日挑战检查（PROBES）`);
    const record = (seed, strategy) => {
      const log = [];
      log.seen = new WeakSet();
      play(arcade, id, { seed, strategy, secs: 60, onFrame: (game, frame) => probe(game, log, frame) });
      return log;
    };
    const a = record('2026-11-05:' + id, idle);
    const b = record('2026-11-05:' + id, monkey('daily:' + id));
    const c = record('2026-11-06:' + id, idle);
    const k = Math.min(a.length, b.length);
    assert.ok(k >= 3, `${id}: 能比的太少（${k}）`);
    assert.deepStrictEqual(b.slice(0, k), a.slice(0, k), `${id}: 同一天两种玩法出的东西不一样`);
    assert.notDeepStrictEqual(c.slice(0, k), a.slice(0, k), `${id}: 换了一天还是一样`);
  });
}
