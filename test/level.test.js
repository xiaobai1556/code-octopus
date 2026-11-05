const test = require('node:test');
const assert = require('node:assert/strict');
const LEVEL = require('../src/level');

test('养成等级：经验从累计数字算，等级和称号跟着走', () => {
  assert.equal(LEVEL.xpOf({}), 0);
  assert.equal(LEVEL.xpOf({ prompts: 10, tools: 100, testsPass: 2, commits: 1, done: 3, edits: 999 }), 20 + 100 + 10 + 10 + 15);
  assert.deepEqual(LEVEL.levelOf(0), { level: 1, title: 'intern', xp: 0, cur: 0, next: 280 });
  assert.equal(LEVEL.levelOf(279).level, 1);
  assert.equal(LEVEL.levelOf(280).level, 2);
  const lv10 = LEVEL.levelOf(LEVEL.need(10));
  assert.equal(lv10.level, 10);
  assert.equal(lv10.title, 'engineer');
  assert.equal(LEVEL.levelOf(LEVEL.need(30) + 1).title, 'legend');
  assert.equal(LEVEL.levelOf(LEVEL.need(99)).title, 'legend');
});
