const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Stats, dayKey } = require('../src/stats');
const achievements = require('../src/achievements');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-stats-')), 'stats.json');
const ev = (event, extra = {}) => ({ event, sessionId: 's1', project: 'app', ...extra });

test('一轮：消息、工具调用、测试、做完，都记到今天', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 5, 10, 0, 0) });
  const s = new Stats(tmpFile());
  s.record(ev('UserPromptSubmit'));
  s.record(ev('PreToolUse', { toolKind: 'edit', detail: 'main.js' }));
  s.record(ev('PreToolUse', { toolKind: 'shell', detail: 'npm test' }));
  s.record(ev('PreToolUse', { toolKind: 'other', decision: 'question' })); // 等你回答不算工具调用
  s.record(ev('PostToolUse', { test: 'pass' }));
  t.mock.timers.tick(90 * 1000);
  s.record(ev('Stop'));
  const d = s.get(dayKey());
  assert.equal(d.prompts, 1);
  assert.equal(d.toolCount, 2);
  assert.equal(d.tools.edit, 1);
  assert.equal(d.tools.shell, 1);
  assert.equal(d.tests.pass, 1);
  assert.equal(d.done, 1);
  assert.equal(d.busyMs, 90 * 1000);
  assert.deepEqual(d.files, { 'main.js': 1 });
  assert.deepEqual(d.sessions, ['s1']);
  assert.equal(s.data.totals.prompts, 1);
  assert.equal(s.data.totals.edits, 1);
});

test('花费只记增量；第一次读到的累计花费只当起点', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 5, 10, 0, 0) });
  const s = new Stats(tmpFile());
  s.record(ev('UserPromptSubmit'), 1.0); // 续上的旧会话，之前花的不算今天
  s.record(ev('Stop'), 1.25);
  s.record(ev('Stop'), 1.25);
  s.record(ev('Stop'), 1.75);
  assert.equal(s.get(dayKey()).costUSD, 0.75);
});

test('连续天数：成就按累计数字解锁', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 10, 1, 10, 0, 0) });
  const s = new Stats(tmpFile());
  for (let i = 0; i < 7; i++) {
    s.record(ev('UserPromptSubmit'));
    t.mock.timers.tick(24 * 60 * 60 * 1000);
  }
  assert.equal(s.data.best.streak, 7);
  const fresh = achievements.evaluate(s);
  assert.ok(fresh.includes('streak'));
  assert.ok(fresh.includes('hello'));
  assert.deepEqual(achievements.evaluate(s), []); // 解锁过的不会再来一次
});

test('存盘再读回来一样；坏掉的文件当成空的', () => {
  const file = tmpFile();
  const s = new Stats(file);
  s.record(ev('UserPromptSubmit'));
  s.save();
  assert.ok(!fs.existsSync(file + '.tmp'));
  const again = new Stats(file);
  assert.equal(again.data.totals.prompts, 1);
  assert.equal(again.get(dayKey()).prompts, 1);

  fs.writeFileSync(file, '{"days": {');
  const broken = new Stats(file);
  assert.equal(broken.data.totals.prompts, 0);
  broken.record(ev('UserPromptSubmit'));
  assert.equal(broken.data.totals.prompts, 1);
});
