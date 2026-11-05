const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('../src/jsonfile');

test('写完能读回来，不留临时文件，目录不存在就建', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octo-json-')), 'deep', 'config.json');
  writeJsonAtomic(file, { a: 1 }, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  assert.ok(fs.readFileSync(file, 'utf8').includes('\n  "a"'));
  writeJsonAtomic(file, { a: 2 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}');
  assert.ok(!fs.existsSync(file + '.tmp'));
});
