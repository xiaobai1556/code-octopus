// 通过 claude 命令行管理桌宠的 Claude Code 插件（插件和市场都在本项目里：.claude-plugin/ 和 plugin/）
// 插件原来叫 claude-pet，改名 code-octopus 以后，装着旧插件的会显示"有更新"，更新时换成新的
const { spawn } = require('child_process');

const PLUGIN = 'code-octopus';
const MARKET = 'code-octopus';
const ID = `${PLUGIN}@${MARKET}`;
const LEGACY_MARKET = 'claude-pet';
const LEGACY_ID = 'claude-pet@claude-pet';

// npm 装的 claude 是 .cmd，要经过 shell；参数里有空格等特殊字符时加引号
function run(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const quoted = args.map((a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
    let child;
    try {
      child = spawn(['claude', ...quoted].join(' '), { shell: true, windowsHide: true });
    } catch (err) {
      resolve({ code: -1, out: '', err: err.message });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fail(r) {
  return new Error((r.err || r.out || `exit ${r.code}`).trim().split('\n').slice(-3).join(' '));
}

// 本项目里插件的版本（plugin/.claude-plugin/plugin.json）
function latestVersion(sourceDir) {
  try {
    return JSON.parse(require('fs').readFileSync(require('path').join(sourceDir, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

/** @returns {Promise<{available:boolean, installed?:boolean, enabled?:boolean, version?:string, latest?:string, outdated?:boolean}>} */
async function status(sourceDir) {
  const r = await run(['plugin', 'list', '--json'], 30000);
  const list = r.code === 0 ? parseJson(r.out) : null;
  if (!Array.isArray(list)) return { available: false };
  const legacy = list.find((x) => x.id === LEGACY_ID);
  const p = list.find((x) => x.id === ID) || legacy;
  const latest = sourceDir ? latestVersion(sourceDir) : '';
  const version = (p && p.version) || '';
  return { available: true, installed: !!p, enabled: !!(p && p.enabled), version, latest, legacy: !!legacy, outdated: !!legacy || !!(p && latest && version && version !== latest) };
}

// 装的是旧版本：先让 Claude Code 重新读一遍市场（本项目目录），再更新插件
async function update(sourceDir) {
  const list = parseJson((await run(['plugin', 'list', '--json'], 30000)).out) || [];
  if (list.some((x) => x.id === LEGACY_ID)) {
    await removeLegacy();
    if (!list.some((x) => x.id === ID)) return install(sourceDir);
  }
  await run(['plugin', 'marketplace', 'update', MARKET]);
  const r = await run(['plugin', 'update', ID, '--scope', 'user']);
  if (r.code !== 0) throw fail(r);
}

async function install(sourceDir) {
  const markets = parseJson((await run(['plugin', 'marketplace', 'list', '--json'], 30000)).out) || [];
  if (!markets.some((m) => m.name === MARKET)) {
    const r = await run(['plugin', 'marketplace', 'add', sourceDir]);
    if (r.code !== 0) throw fail(r);
  }
  const r = await run(['plugin', 'install', ID, '--scope', 'user']);
  if (r.code !== 0) throw fail(r);
}

async function enable() {
  const r = await run(['plugin', 'enable', ID]);
  if (r.code !== 0) throw fail(r);
}

async function uninstall() {
  await removeLegacy();
  const r = await run(['plugin', 'uninstall', ID, '--scope', 'user']);
  if (r.code !== 0 && !/not (found|installed)/i.test(r.err + r.out)) throw fail(r);
  await run(['plugin', 'marketplace', 'remove', MARKET]); // 市场删不掉也无所谓
}

// 改名前装的旧插件和旧市场：卸掉（没装就什么也不做）
async function removeLegacy() {
  await run(['plugin', 'uninstall', LEGACY_ID, '--scope', 'user']);
  await run(['plugin', 'marketplace', 'remove', LEGACY_MARKET]);
}

module.exports = { status, install, enable, update, uninstall, ID };
