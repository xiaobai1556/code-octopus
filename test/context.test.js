const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSessionUsage } = require('../src/context');

function transcript(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-ctx-')), 'session.jsonl');
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

const assistant = (usage, extra = {}) => ({ type: 'assistant', message: { model: 'claude-x', usage }, ...extra });

test('上下文占用 = 主对话最近一条回复的输入 + 缓存写入 + 缓存读取', () => {
  const file = transcript([
    assistant({ input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
    { type: 'cost-state', totalCostUSD: 0.5 },
    assistant({ input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: 500 }),
    assistant({ input_tokens: 999999 }, { isSidechain: true }), // 子代理的不算
    { type: 'user', message: { content: 'hi' } },
    'not json',
  ]);
  const u = readSessionUsage(file);
  assert.equal(u.used, 33000);
  assert.equal(u.model, 'claude-x');
  assert.equal(u.costUSD, 0.5);
});

test('文件不在、空路径：返回空值，不抛错', () => {
  assert.deepEqual(readSessionUsage(''), { used: null, model: '', costUSD: null });
  assert.deepEqual(readSessionUsage(path.join(os.tmpdir(), 'no-such-dir-octo', 'x.jsonl')), { used: null, model: '', costUSD: null });
});

test('大文件只读末尾，末尾找不到再往前多读一段', () => {
  const filler = { type: 'user', message: { content: 'x'.repeat(1000) } };
  const file = transcript([assistant({ input_tokens: 42 }), ...Array(400).fill(filler)]); // 约 400KB，超过第一次读的 256KB
  assert.equal(readSessionUsage(file).used, 42);
});
