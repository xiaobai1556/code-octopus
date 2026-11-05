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

test('游戏厅的指标只记最好的那次，够了就解锁游戏成就', () => {
  const s = new Stats(tmpFile());
  s.recordArcade('bugs', { level: 5 });
  s.recordArcade('bugs', { level: 3 });
  assert.equal(s.data.arcade.bugs.level, 5);
  assert.ok(!achievements.evaluate(s).includes('debugger'));
  s.recordArcade('bugs', { level: 8 });
  s.recordArcade('defense', { waves: 15 });
  const fresh = achievements.evaluate(s);
  assert.ok(fresh.includes('debugger'));
  assert.ok(fresh.includes('guardian'));
  assert.ok(!fresh.includes('climber'));
  const prog = achievements.progress(s).find((a) => a.id === 'climber');
  assert.deepEqual([prog.game, prog.value, prog.goal, prog.unlockedAt], ['hop', 0, 300, null]);
});

test('最近 N 天：老的在前，没干活的日子补 0，跨月也对', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 9, 31, 10, 0, 0) });
  const s = new Stats(tmpFile());
  s.record(ev('UserPromptSubmit'));
  s.record(ev('PreToolUse', { toolKind: 'edit', detail: 'a.js' }));
  t.mock.timers.tick(2 * 24 * 60 * 60 * 1000); // 11 月 2 日
  s.record(ev('PreToolUse', { toolKind: 'shell', detail: 'ls' }));
  const r = s.range('2026-11-02', 5);
  assert.deepEqual(r.map((d) => d.date), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(r.map((d) => d.tools), [0, 0, 1, 0, 1]);
  assert.equal(s.range('2026-11-02').length, 30);
});
