// 在 ~/.claude/settings.json 里接入 / 移除桌宠的 hooks。
// 每个 hook 用 curl 把 Claude Code 的事件 JSON 原样 POST 给桌宠；async 表示不阻塞 Claude，
// 桌宠没开时 curl 连不上也只是静默失败。
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARK = 'claude-pet';
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BACKUP = SETTINGS + '.bak-claude-pet';

const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
];

// src 标明事件是从哪种接入方式发来的：settings.json 里的是 claude-pet，插件里的是 claude-pet-plugin
function hookEntry(port, src = MARK) {
  return {
    type: 'command',
    command: 'curl',
    args: ['-s', '-m', '2', '--data-binary', '@-', `http://127.0.0.1:${port}/event?src=${src}`],
    async: true,
  };
}

// 权限请求单独用同步的 http hook：开着"在桌宠上批准"时，桌宠可以先不回复、等你点按钮，再把决定回给 Claude Code。
// 没开这个功能时桌宠马上回一个空响应；桌宠没开时连不上，Claude Code 都会照常在终端里问你
const ASK_TIMEOUT_S = 200;
function permissionEntry(port, src = MARK) {
  return { type: 'http', url: `http://127.0.0.1:${port}/permission?src=${src}`, timeout: ASK_TIMEOUT_S };
}

const entryFor = (event, port, src) => (event === 'PermissionRequest' ? permissionEntry(port, src) : hookEntry(port, src));

const isOurs = (h) => JSON.stringify(h).includes(MARK);

function read() {
  if (!fs.existsSync(SETTINGS)) return {};
  const text = fs.readFileSync(SETTINGS, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`${SETTINGS} is not valid JSON`);
    err.code = 'SETTINGS_INVALID_JSON';
    throw err;
  }
}

function write(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, BACKUP);
  const tmp = SETTINGS + '.tmp-claude-pet';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, SETTINGS);
}

// 删掉我们自己的 hook，保留用户原有的；返回是否有改动
function strip(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return false;
  let changed = false;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      const list = Array.isArray(g && g.hooks) ? g.hooks : [];
      const rest = list.filter((h) => !isOurs(h));
      if (rest.length !== list.length) changed = true;
      if (rest.length) kept.push({ ...g, hooks: rest });
      else if (!list.length) kept.push(g);
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
  return changed;
}

function isInstalled() {
  try {
    const s = read();
    return !!s.hooks && JSON.stringify(s.hooks).includes(MARK);
  } catch {
    return false;
  }
}

// 接入过，但还是旧版的配置（权限请求还是"发完就走"的 curl），需要重新接入一次才能在桌宠上批准
function needsUpdate() {
  try {
    const s = read();
    return isInstalled() && !JSON.stringify((s.hooks && s.hooks.PermissionRequest) || []).includes('/permission?src=' + MARK);
  } catch {
    return false;
  }
}

// 在设置对象里加上桌宠的 hooks（先去掉旧的，重复安装不会叠加）
function withHooks(s, port, src) {
  strip(s);
  s.hooks = s.hooks || {};
  for (const event of EVENTS) {
    s.hooks[event] = [...(s.hooks[event] || []), { hooks: [entryFor(event, port, src)] }];
  }
  return s;
}

function install(port) {
  write(withHooks(read(), port));
}

function uninstall() {
  const s = read();
  if (strip(s)) write(s);
}

module.exports = { install, uninstall, isInstalled, needsUpdate, withHooks, strip, SETTINGS, BACKUP };
