const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../src/backup');

const sample = () => ({
  config: { scale: 6, bubbles: 'brief', feedDir: 'D:/old-pc/belly', outfit: { head: 'crown', face: '', neck: '' }, sound: false },
  stats: { days: { '2026-11-05': { prompts: 3 } }, totals: { prompts: 3 }, unlocked: { hello: '2026-11-01T00:00:00Z' } },
  arcade: { best: { bugs: 840 }, plays: { bugs: 3 } },
  notes: [{ id: 'n1', text: '买牛奶' }, { bogus: true }],
});

test('备份：导出再读回来一样，便签里坏的去掉', () => {
  const text = JSON.stringify(backup.make(sample(), '0.3.0'));
  const r = backup.read(text);
  assert.ok(r.ok);
  assert.match(r.createdAt, /^\d{4}-/);
  assert.deepEqual(r.data.stats, sample().stats);
  assert.deepEqual(r.data.arcade, sample().arcade);
  assert.deepEqual(r.data.notes, [{ id: 'n1', text: '买牛奶' }]);
});

test('备份：不是我们的、坏掉的、版本不认识的都不认', () => {
  assert.equal(backup.read('not json').ok, false);
  assert.equal(backup.read('{}').ok, false);
  assert.equal(backup.read(JSON.stringify({ app: 'other', kind: 'backup', version: 1, data: {} })).ok, false);
  assert.equal(backup.read(JSON.stringify({ ...backup.make(sample()), version: 99 })).ok, false);
  assert.equal(backup.read(JSON.stringify(backup.make({ ...sample(), stats: { days: 'oops' } }))).ok, false);
  assert.equal(backup.read(JSON.stringify(backup.make({ ...sample(), notes: 'oops' }))).ok, false);
  assert.ok(backup.read(JSON.stringify(backup.make({ config: { scale: 4 } }))).ok); // 只有一部分也行
});

test('备份：设置合进来时，这台电脑专属的、不认识的、类型不对的都不要', () => {
  const current = { scale: 5, bubbles: 'full', feedDir: 'C:/new-pc/belly', outfit: { head: '', face: 'glasses', neck: '' }, sound: true };
  const merged = backup.mergeConfig(current, { ...sample().config, evil: 1, scale: 'huge' });
  assert.equal(merged.feedDir, 'C:/new-pc/belly');
  assert.equal(merged.bubbles, 'brief');
  assert.equal(merged.sound, false);
  assert.equal(merged.scale, 5);
  assert.ok(!('evil' in merged));
  assert.deepEqual(merged.outfit, { head: 'crown', face: '', neck: '' });
});
