// 备份和恢复：设置、统计（含成就）、游戏成绩、便签存成一个 JSON 文件，换电脑或重装以后导回来。
// 喂文件的记录（feed-log.json）里是这台电脑上的路径，不备份；设置里「肚子」放在哪也保留这台电脑的。
const APP = 'code-octopus';
const VERSION = 1;
const MACHINE_KEYS = ['feedDir']; // 只对这台电脑有意义的设置

function make({ config, stats, arcade, notes }, appVersion = '') {
  return { app: APP, kind: 'backup', version: VERSION, appVersion, createdAt: new Date().toISOString(), data: { config, stats, arcade, notes } };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// 读备份：不是我们的、版本不认识、内容坏了都返回 { ok: false }
function read(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObj(b) || b.app !== APP || b.kind !== 'backup' || b.version !== VERSION || !isObj(b.data)) return { ok: false };
  const { config, stats, arcade, notes } = b.data;
  if ((config != null && !isObj(config)) || (stats != null && !isObj(stats)) || (arcade != null && !isObj(arcade)) || (notes != null && !Array.isArray(notes))) return { ok: false };
  if (stats && !isObj(stats.days)) return { ok: false };
  return { ok: true, createdAt: typeof b.createdAt === 'string' ? b.createdAt : '', data: { config, stats, arcade, notes: notes && notes.filter((n) => isObj(n) && typeof n.text === 'string') } };
}

// 备份里的设置合进现在的：只要现在也有、类型一样的项；这台电脑专属的保留现在的
function mergeConfig(current, imported) {
  const out = { ...current };
  if (!isObj(imported)) return out;
  for (const [k, v] of Object.entries(imported)) {
    if (MACHINE_KEYS.includes(k) || !(k in current)) continue;
    if (isObj(current[k])) {
      if (isObj(v)) out[k] = { ...current[k], ...v };
    } else if (typeof v === typeof current[k]) out[k] = v;
  }
  return out;
}

module.exports = { make, read, mergeConfig };
