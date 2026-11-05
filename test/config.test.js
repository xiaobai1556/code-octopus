const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, fromSaved, cleanPatch, DEFAULTS } = require('../src/config');
const { breakDue, costDue, todaySummary } = require('../src/reminders');

test('设置：默认值每次是新的一份，改了不会污染默认值', () => {
  const a = defaults();
  a.outfit.head = 'crown';
  assert.equal(defaults().outfit.head, '');
  assert.equal(DEFAULTS.outfit.head, '');
});

test('设置：从存着的读出来，老版本的写法升级', () => {
  assert.deepEqual(fromSaved(null), defaults());
  const old = fromSaved({ quiet: true, scale: 6, outfit: { face: 'glasses' } });
  assert.equal(old.bubbles, 'alerts');
  assert.ok(!('quiet' in old));
  assert.equal(old.onboarded, true); // 老用户不再弹新手引导
  assert.equal(old.scale, 6);
  assert.deepEqual(old.outfit, { head: '', face: 'glasses', neck: '' });
  assert.equal(fromSaved({ onboarded: false }).onboarded, false);
  assert.equal(fromSaved({ bubbles: 'brief', quiet: true }).bubbles, 'brief');
});

test('设置面板发来的改动：只留认识的项和合法的值', () => {
  const langs = { 'zh-CN': '简体中文', en: 'English' };
  assert.deepEqual(cleanPatch({ scale: 6, bubbles: 'brief', color: 3, lang: 'en', sound: false, quietFrom: 23, breakMin: 90, costAlert: 10, pomodoroMin: 45 }, langs), {
    scale: 6, bubbles: 'brief', color: 3, lang: 'en', sound: false, quietFrom: 23, breakMin: 90, costAlert: 10, pomodoroMin: 45,
  });
  assert.deepEqual(cleanPatch({ scale: 7, bubbles: 'loud', color: 9, lang: 'xx', sound: 'yes', quietFrom: 24, quietTo: -1, breakMin: 30, costAlert: 7, evil: 1, lastReportDay: 'x' }, langs), {});
  assert.deepEqual(cleanPatch({ lang: 'toString' }, langs), {}); // 不能借原型链上的名字混进来
  assert.deepEqual(cleanPatch({ lang: 'auto', costAlert: 0, contextWindow: 1000000 }, langs), { lang: 'auto', costAlert: 0, contextWindow: 1000000 });
  assert.deepEqual(cleanPatch(null), {});
});

test('休息提醒：到点才提醒，不方便的时候跳过', () => {
  const base = { now: 61 * 60000, workSince: 0, enabled: true, minutes: 60 };
  assert.equal(breakDue(base), 'remind');
  assert.equal(breakDue({ ...base, now: 59 * 60000 }), null);
  assert.equal(breakDue({ ...base, enabled: false }), null);
  assert.equal(breakDue({ ...base, quiet: true }), 'skip');
  assert.equal(breakDue({ ...base, pomodoro: true }), 'skip');
  assert.equal(breakDue({ ...base, hidden: true }), 'skip');
  assert.equal(breakDue({ ...base, minutes: 90 }), null);
});

test('花费提醒：超过才说，一天只说一次，免打扰时先不说', () => {
  assert.equal(costDue({ costUSD: 6 }, 5), true);
  assert.equal(costDue({ costUSD: 4.99 }, 5), false);
  assert.equal(costDue({ costUSD: 6, costAlerted: true }, 5), false);
  assert.equal(costDue({ costUSD: 6 }, 0), false);
  assert.equal(costDue(null, 5), false);
  assert.equal(costDue({ costUSD: 6 }, 5, true), false);
});

test('今日小结：没干活的一天也给完整的字段', () => {
  const level = { level: 3, xp: 1300, next: 2520 };
  const empty = todaySummary({ date: '2026-11-05', day: null, level, title: 'Intern', language: 'en' });
  assert.equal(empty.busy, '0h 0m');
  assert.equal(empty.toolCalls, 0);
  assert.deepEqual(empty.lastCommits, []);
  assert.equal(empty.xp, '1300 / 2520');
  const busy = todaySummary({
    date: '2026-11-05',
    day: { busyMs: 2 * 3600000 + 5 * 60000, prompts: 9, toolCount: 120, tests: { pass: 3, fail: 1 }, commits: 4, pushes: 1, costUSD: 1.234, commitLog: [{ text: 'a' }, { text: '' }, { text: 'b' }, { text: 'c' }] },
    level,
    title: 'Intern',
    language: 'en',
  });
  assert.equal(busy.busy, '2h 5m');
  assert.equal(busy.costUSD, 1.23);
  assert.deepEqual(busy.lastCommits, ['b', 'c']);
});
