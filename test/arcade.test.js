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
  assert.deepEqual(a.record('bugs', 120), { best: 120, prev: 0, record: true, plays: 1 });
  assert.deepEqual(a.record('bugs', 80), { best: 120, prev: 120, record: false, plays: 2 });
  assert.deepEqual(a.record('bugs', 120), { best: 120, prev: 120, record: false, plays: 3 }); // 平了不算破
  assert.equal(a.record('bugs', 300).record, true);
  const again = new ArcadeScores(file);
  assert.deepEqual(again.summary().bugs, { best: 300, plays: 4 });
  assert.deepEqual(again.summary().hop, { best: 0, plays: 0 });
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
  assert.deepEqual(new ArcadeScores(file).summary().approve, { best: 0, plays: 0 });
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
