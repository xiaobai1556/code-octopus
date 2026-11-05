const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withHooks, strip } = require('../src/hooks');

const userHook = { type: 'command', command: 'echo mine' };

test('withHooks：重复接入不会叠加，用户自己的 hook 原样保留', () => {
  const s = { model: 'opus', hooks: { Stop: [{ hooks: [userHook] }] } };
  withHooks(s, 23333);
  withHooks(s, 23333);
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.Stop.length, 2);
  assert.deepEqual(s.hooks.Stop[0], { hooks: [userHook] });
  for (const groups of Object.values(s.hooks)) {
    const ours = groups.flatMap((g) => g.hooks).filter((h) => JSON.stringify(h).includes('claude-pet'));
    assert.equal(ours.length, 1);
  }
});

test('权限请求用同步的 http hook，其他事件用异步 curl', () => {
  const s = withHooks({}, 23333);
  const perm = s.hooks.PermissionRequest[0].hooks[0];
  assert.equal(perm.type, 'http');
  assert.match(perm.url, /^http:\/\/127\.0\.0\.1:23333\/permission\?src=claude-pet$/);
  const pre = s.hooks.PreToolUse[0].hooks[0];
  assert.equal(pre.command, 'curl');
  assert.equal(pre.async, true);
  assert.ok(pre.args.includes('http://127.0.0.1:23333/event?src=claude-pet'));
});

test('strip：只删桌宠的，删空了的事件和 hooks 字段一起去掉', () => {
  const s = withHooks({ hooks: { Stop: [{ hooks: [userHook] }] } }, 23333);
  assert.equal(strip(s), true);
  assert.deepEqual(s, { hooks: { Stop: [{ hooks: [userHook] }] } });
  const only = withHooks({}, 23333);
  strip(only);
  assert.deepEqual(only, {});
  assert.equal(strip({}), false);
});

test('插件里的 hooks.json 和 src/hooks.js 同步（改了 hooks.js 要跑 npm run build:plugin）', () => {
  const expected = JSON.stringify(withHooks({}, 23333, 'claude-pet-plugin'), null, 2) + '\n';
  const actual = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8');
  assert.equal(actual, expected);
});
