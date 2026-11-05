const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ArcadeScores, GAMES } = require('../src/arcade');
const { CARDS, WHY, deck } = require('../src/arcade-cards');
const I18N = require('../src/i18n');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-arcade-')), 'arcade.json');

test('最高分：破纪录才更新，次数每局加一，存盘读回来一样', () => {
  const file = tmpFile();
  const a = new ArcadeScores(file);
  const plain = { dailyBest: null, dailyRecord: false, streak: null }; // 不是今日挑战
  assert.deepEqual(a.record('bugs', 120), { best: 120, prev: 0, record: true, plays: 1, ...plain, rank: 1, top: [120] });
  assert.deepEqual(a.record('bugs', 80), { best: 120, prev: 120, record: false, plays: 2, ...plain, rank: 2, top: [120, 80] });
  assert.deepEqual(a.record('bugs', 120), { best: 120, prev: 120, record: false, plays: 3, ...plain, rank: 2, top: [120, 120, 80] }); // 平了不算破，排在先来的后面
  assert.equal(a.record('bugs', 300).record, true);
  const again = new ArcadeScores(file);
  assert.deepEqual(again.summary().bugs, { best: 300, plays: 4, top: [300, 120, 120, 80] });
  assert.deepEqual(again.summary().hop, { best: 0, plays: 0, top: [] });
  assert.ok(!fs.existsSync(file + '.tmp'));
});

test('最高分：不认识的游戏、乱七八糟的分数', () => {
  const a = new ArcadeScores(tmpFile());
  assert.equal(a.record('chess', 10), null);
  assert.equal(a.record('hop', -5).best, 0);
  assert.equal(a.record('hop', 'abc').best, 0);
  assert.equal(a.record('hop', 12.9).best, 12);
  assert.equal(a.record('hop', 1e12).best, 10_000_000);
  assert.deepEqual(Object.keys(a.summary()), GAMES);
});

test('坏掉的成绩文件当成空的', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"best": ');
  assert.deepEqual(new ArcadeScores(file).summary().approve, { best: 0, plays: 0, top: [] });
});

test('题库：每条都有工具、内容和对得上的理由，该允许和该拒绝的都不少', () => {
  const texts = new Set();
  for (const c of CARDS) {
    assert.ok(c.tool && c.text, JSON.stringify(c));
    assert.equal(typeof c.ok, 'boolean');
    assert.ok(WHY.includes(c.why), c.why);
    assert.ok(!texts.has(c.text), `重复：${c.text}`);
    texts.add(c.text);
  }
  const ok = CARDS.filter((c) => c.ok).length;
  assert.ok(ok >= 15 && CARDS.length - ok >= 15);
  // 理由和对错要一致：安全的理由只给该允许的，危险的理由只给该拒绝的
  const safe = new Set(['read', 'test', 'local', 'cache', 'web']);
  for (const c of CARDS) assert.equal(safe.has(c.why), c.ok, c.text);
  // 只用保留给文档的网址和 IP，不会真的指向谁
  for (const c of CARDS) {
    for (const host of c.text.match(/https?:\/\/([^/\s"|]+)/g) || []) assert.match(host, /example\.invalid|203\.0\.113\.|developer\.mozilla\.org|docs\.python\.org/, host);
  }
});

test('发牌：一副发完之前不重复，两种大约一半一半', () => {
  let seed = 42;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const draw = deck(random);
  const okCount = CARDS.filter((c) => c.ok).length;
  const seen = new Set();
  let ok = 0;
  for (let i = 0; i < 400; i++) {
    const c = draw();
    if (c.ok) ok++;
    if (i < okCount) seen.add(c.text);
  }
  assert.ok(ok > 150 && ok < 250, `该允许的 ${ok}/400`);
  const first = [];
  const d2 = deck(random);
  for (let i = 0; i < 20; i++) first.push(d2());
  const okFirst = first.filter((c) => c.ok).map((c) => c.text);
  assert.equal(new Set(okFirst).size, okFirst.length); // 同一副里没有重复
});

test('每个游戏用到的文案四种语言都有', () => {
  const keys = ['menu.arcade', 'set.arcade'];
  for (const g of GAMES) for (const k of ['name', 'tagline', 'rule1', 'rule2', 'rule3', 'keys']) keys.push(`${g}.${k}`);
  for (const why of WHY) keys.push(`approve.why.${why}`);
  // 塔防里按名字拼出来的：四种塔的名字和说明、四种 Bug 的名字
  for (const tower of ['test', 'lint', 'review', 'types']) keys.push(`defense.tower.${tower}`, `defense.tip.${tower}`);
  for (const enemy of ['bug', 'race', 'leak', 'legacy']) keys.push(`defense.enemy.${enemy}`);
  for (const lang of Object.keys(I18N.STRINGS)) {
    const missing = keys.filter((k) => !(k in I18N.STRINGS[lang]));
    assert.deepEqual(missing, [], lang);
  }
});

test('每个成就和它送的装扮都有名字，装扮都登记过部位，头上的有头顶高度', () => {
  const achievements = require('../src/achievements');
  const OUTFITS = require('../src/outfits');
  for (const a of achievements.LIST) {
    const item = OUTFITS.ITEMS[a.item];
    assert.ok(item && !item.holiday, a.item);
    if (item.slot === 'head') assert.ok(OUTFITS.headroom({ head: a.item }) > 0 || a.item === 'headband', a.item);
    if (a.game) assert.ok(GAMES.includes(a.game), a.game);
    for (const lang of Object.keys(I18N.STRINGS)) {
      for (const key of [`ach.${a.id}`, `ach.${a.id}Desc`, `item.${a.item}`]) assert.ok(key in I18N.STRINGS[lang], `${lang} ${key}`);
    }
  }
  // 每个游戏正好一个成就
  assert.deepEqual(achievements.LIST.filter((a) => a.game).map((a) => a.game).sort(), [...GAMES].sort());
});

test('今日挑战：按天记最好成绩，也算进总的最高分，只留最近两周', () => {
  const a = new ArcadeScores(tmpFile());
  assert.deepEqual(a.record('hop', 50, '2026-11-05'), { best: 50, prev: 0, record: true, plays: 1, dailyBest: 50, dailyRecord: true, streak: 1, rank: 1, top: [50] });
  assert.deepEqual(a.record('hop', 30, '2026-11-05'), { best: 50, prev: 50, record: false, plays: 2, dailyBest: 50, dailyRecord: false, streak: 1, rank: 2, top: [50, 30] });
  assert.equal(a.record('hop', 40, '2026-11-06').dailyRecord, true); // 新的一天重新算
  assert.deepEqual(a.dailyOf('2026-11-05'), { hop: 50 });
  assert.deepEqual(a.dailyOf('2026-11-07'), {});
  assert.equal(a.record('hop', 10, 'not-a-day').dailyBest, null);
  for (let d = 10; d < 30; d++) a.record('bugs', d, `2026-11-${d}`);
  assert.equal(Object.keys(a.data.daily).length, 14);
  assert.deepEqual(a.dailyOf('2026-11-05'), {});
});

test('今日挑战连续打卡：隔天接着算，同一天不重复算，断一天从 1 开始，跨月跨年也对', () => {
  const { bumpStreak, streakOn, prevDay } = require('../src/rng');
  assert.equal(prevDay('2026-03-01'), '2026-02-28');
  assert.equal(prevDay('2024-03-01'), '2024-02-29');
  assert.equal(prevDay('2027-01-01'), '2026-12-31');
  let st = {};
  for (const day of ['2026-12-30', '2026-12-31', '2026-12-31', '2027-01-01']) st = bumpStreak(st, day);
  assert.deepEqual(st, { last: '2027-01-01', n: 3, best: 3 });
  assert.deepEqual(bumpStreak(st, '2026-12-20'), st); // 日期往回走：不变
  st = bumpStreak(st, '2027-01-03'); // 断了一天
  assert.deepEqual(st, { last: '2027-01-03', n: 1, best: 3 });
  // 还连不连着：今天玩过、昨天玩过（今天还没玩）都算连着，再早就断了
  assert.deepEqual(streakOn(st, '2027-01-03'), { n: 1, best: 3, doneToday: true });
  assert.deepEqual(streakOn(st, '2027-01-04'), { n: 1, best: 3, doneToday: false });
  assert.deepEqual(streakOn(st, '2027-01-05'), { n: 0, best: 3, doneToday: false });
  assert.deepEqual(streakOn(undefined, '2027-01-05'), { n: 0, best: 0, doneToday: false });
  // 存在成绩里，平常的一局不算打卡
  const file = tmpFile();
  const a = new ArcadeScores(file);
  a.record('bugs', 10, '2026-11-04');
  a.record('stack', 10);
  assert.equal(a.record('typing', 10, '2026-11-05').streak, 2);
  assert.deepEqual(new ArcadeScores(file).streak(), { last: '2026-11-05', n: 2, best: 2 });
});

test('播种的随机数：同一个种子同一串，不同种子不一样，都在 [0, 1)', () => {
  const { seeded, dayKey } = require('../src/rng');
  const take = (seed, n = 50) => Array.from({ length: n }, seeded(seed));
  assert.deepEqual(take('2026-11-05:bugs'), take('2026-11-05:bugs'));
  assert.notDeepEqual(take('2026-11-05:bugs'), take('2026-11-05:hop'));
  assert.notDeepEqual(take('2026-11-05:bugs'), take('2026-11-06:bugs'));
  const xs = take('x', 5000);
  assert.ok(xs.every((v) => v >= 0 && v < 1));
  const mean = xs.reduce((s2, v) => s2 + v, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean}`);
  assert.match(dayKey(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('本地前 5 名：只留五个，没进前五的 rank 是 null，0 分不算', () => {
  const a = new ArcadeScores(tmpFile());
  for (const n of [10, 50, 30, 70, 20]) a.record('stack', n);
  assert.deepEqual(a.topOf('stack'), [70, 50, 30, 20, 10]);
  assert.equal(a.record('stack', 5).rank, null);
  assert.equal(a.record('stack', 60).rank, 2);
  assert.deepEqual(a.topOf('stack'), [70, 60, 50, 30, 20]);
  assert.equal(a.record('stack', 0).rank, null);
});
