const test = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../src/notify');
const I18N = require('../src/i18n');

const ev = (event, extra = {}) => ({ event, sessionId: 's1', project: 'app', ...extra });
const on = { enabled: true, hidden: true, watching: false };

test('哪些事值得弹通知', () => {
  assert.equal(notify.toastKind(ev('PermissionRequest', { tool: 'Bash' })), 'approve');
  assert.equal(notify.toastKind(ev('Notification', { notify: 'permission' })), 'approve');
  assert.equal(notify.toastKind(ev('PreToolUse', { decision: 'question' })), 'question');
  assert.equal(notify.toastKind(ev('PreToolUse', { decision: 'plan' })), 'plan');
  assert.equal(notify.toastKind(ev('Notification', { notify: 'input' })), 'question');
  assert.equal(notify.toastKind(ev('Stop', { longTask: true })), 'done');
  assert.equal(notify.toastKind(ev('Stop', { longTask: false })), null); // 很快就做完的不打扰
  assert.equal(notify.toastKind(ev('PreToolUse', { tool: 'Bash' })), null);
  assert.equal(notify.toastKind(ev('Notification', { notify: 'idle' })), null);
});

test('只在小章鱼躲起来、你没看着那个会话、开关开着时弹；同一件事 20 秒内只弹一次', () => {
  const e = ev('PermissionRequest', { tool: 'Bash' });
  assert.deepEqual(notify.shouldToast(e, on), { kind: 'approve', key: 's1:approve' });
  assert.equal(notify.shouldToast(e, { ...on, hidden: false }), null);
  assert.equal(notify.shouldToast(e, { ...on, watching: true }), null);
  assert.equal(notify.shouldToast(e, { ...on, enabled: false }), null);
  const now = 1_000_000;
  const lastAt = { 's1:approve': now - 5000 };
  assert.equal(notify.shouldToast(e, { ...on, lastAt, now }), null);
  assert.ok(notify.shouldToast(e, { ...on, lastAt, now: now + notify.COOLDOWN_MS }));
  // 别的会话、别的事不受影响
  assert.ok(notify.shouldToast({ ...e, sessionId: 's2' }, { ...on, lastAt, now }));
  assert.ok(notify.shouldToast(ev('Stop', { longTask: true }), { ...on, lastAt, now }));
});

test('通知写什么', () => {
  I18N.setLang('zh-CN');
  const approve = notify.toastText(ev('PermissionRequest', { tool: 'Bash', detail: 'npm test' }), 'approve', I18N.t);
  assert.deepEqual(approve, { title: 'app 需要你批准', body: 'Bash · npm test' });
  const done = notify.toastText(ev('Stop', { longTask: true, turnMs: 185000, text: '改好了' }), 'done', I18N.t);
  assert.equal(done.title, 'app 做完了（用了 3 分 5 秒）');
  assert.equal(done.body, '改好了');
  const noProject = notify.toastText({ event: 'PreToolUse', decision: 'question', text: 'x'.repeat(300) }, 'question', I18N.t);
  assert.equal(noProject.title, '代码小章鱼 有问题要问你');
  assert.equal(noProject.body.length, 200);
  I18N.setLang('en');
});
