// 从 Claude Code 的对话记录（hook 里的 transcript_path，一行一个 JSON）末尾读出：
// - 当前上下文占用：主对话里最近一条 Claude 回复的 输入 + 缓存写入 + 缓存读取 token
// - 这个会话累计花了多少钱：最近一条 cost-state 记录
// 文件可能有几十 MB，只读末尾一段，不够再往前多读一些。
const fs = require('fs');

const CHUNKS = [256 * 1024, 2 * 1024 * 1024];

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    // 从中间截断的第一行不完整，丢掉
    return { lines: (start > 0 ? text.slice(text.indexOf('\n') + 1) : text).split('\n'), whole: start === 0 };
  } finally {
    fs.closeSync(fd);
  }
}

function parse(line) {
  if (!line || line[0] !== '{') return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** @returns {{ used: number|null, model: string, costUSD: number|null }} */
function readSessionUsage(file) {
  const out = { used: null, model: '', costUSD: null };
  if (!file) return out;
  for (const bytes of CHUNKS) {
    let tail;
    try {
      tail = readTail(file, bytes);
    } catch {
      return out;
    }
    for (let i = tail.lines.length - 1; i >= 0 && (out.used == null || out.costUSD == null); i--) {
      const line = tail.lines[i];
      // 先用字符串粗筛，大多数行（工具结果之类）不用解析
      if (out.used == null && line.includes('"type":"assistant"') && line.includes('"usage"')) {
        const o = parse(line);
        const u = o && !o.isSidechain && o.message && o.message.usage;
        if (u) {
          out.used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          out.model = (o.message && o.message.model) || '';
        }
      } else if (out.costUSD == null && line.includes('"type":"cost-state"')) {
        const o = parse(line);
        if (o && typeof o.totalCostUSD === 'number') out.costUSD = o.totalCostUSD;
      }
    }
    if ((out.used != null && out.costUSD != null) || tail.whole) break;
  }
  return out;
}

module.exports = { readSessionUsage };
