const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CATCHES, pick, rarity } = require('../src/catches');
const { Stats } = require('../src/stats');
const achievements = require('../src/achievements');

test('钓鱼图鉴：按权重挑，常见的多、传说的少，每样都挑得到', () => {
  const n = {};
  for (let i = 0; i < 1000; i++) {
    const c = pick(i / 1000);
    n[c.id] = (n[c.id] || 0) + 1;
  }
  assert.deepEqual(Object.keys(n).sort(), CATCHES.map((c) => c.id).sort());
  assert.ok(n.fish > n.duck && n.duck > n.goldbug);
  assert.equal(rarity('fish'), 'common');
  assert.equal(rarity('esc'), 'rare');
  assert.equal(rarity('goldbug'), 'legendary');
  assert.equal(rarity('nope'), '');
});

test('钓鱼图鉴：记下来、第一次是新的、集齐解锁成就', () => {
  const s = new Stats(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-catch-')), 'stats.json'));
  assert.equal(s.recordCatch('whale'), null);
  assert.deepEqual(s.recordCatch('fish'), { isNew: true, count: 1, kinds: 1 });
  assert.deepEqual(s.recordCatch('fish'), { isNew: false, count: 2, kinds: 1 });
  assert.ok(!achievements.evaluate(s).includes('angler'));
  for (const c of CATCHES) s.recordCatch(c.id);
  assert.ok(achievements.evaluate(s).includes('angler'));
});
