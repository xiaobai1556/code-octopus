// 真的读写 settings.json：把主目录换成一个临时目录再加载 hooks.js（node --test 每个文件单独一个进程，不影响别的测试）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const hooks = require('../src/hooks');

const readSettings = () => JSON.parse(fs.readFileSync(hooks.SETTINGS, 'utf8'));

test('settings.json 就在临时主目录里', () => {
  assert.equal(hooks.SETTINGS, path.join(home, '.claude', 'settings.json'));
  assert.equal(hooks.isInstalled(), false);
  assert.equal(hooks.needsUpdate(), false);
});

test('接入：保留原有设置、备份旧文件；断开：只删桌宠自己的', () => {
  fs.mkdirSync(path.dirname(hooks.SETTINGS), { recursive: true });
  const mine = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(hooks.SETTINGS, JSON.stringify(mine));
  hooks.install(23333);
  assert.equal(hooks.isInstalled(), true);
  assert.equal(hooks.needsUpdate(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(hooks.BACKUP, 'utf8')), mine);
  const s = readSettings();
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.Stop.length, 2);
  hooks.uninstall();
  assert.equal(hooks.isInstalled(), false);
  assert.deepEqual(readSettings(), mine);
});

test('旧版的接入（权限请求还是 curl）提示要更新；文件改了缓存跟着变', () => {
  const s = hooks.withHooks({}, 23333);
  s.hooks.PermissionRequest = [{ hooks: [{ type: 'command', command: 'curl', args: ['http://127.0.0.1:23333/event?src=claude-pet'], async: true }] }];
  fs.writeFileSync(hooks.SETTINGS, JSON.stringify(s));
  assert.equal(hooks.isInstalled(), true);
  assert.equal(hooks.needsUpdate(), true);
  hooks.install(23333);
  assert.equal(hooks.needsUpdate(), false);
  fs.writeFileSync(hooks.SETTINGS, '{}'); // 别的程序把它改掉了
  assert.equal(hooks.isInstalled(), false);
});

test('settings.json 不是合法 JSON：接入时报错，不去覆盖它', () => {
  fs.writeFileSync(hooks.SETTINGS, '{ "model": ');
  assert.throws(() => hooks.install(23333), (err) => err.code === 'SETTINGS_INVALID_JSON');
  assert.equal(fs.readFileSync(hooks.SETTINGS, 'utf8'), '{ "model": ');
  assert.equal(hooks.isInstalled(), false);
});
