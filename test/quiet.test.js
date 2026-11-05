const test = require('node:test');
const assert = require('node:assert/strict');
const { inQuietHours } = require('../src/quiet');

const at = (h) => new Date(2026, 10, 5, h, 30);

test('免打扰时段：跨午夜、白天、起止一样当成没设', () => {
  // 22 点到第二天 8 点
  assert.ok(inQuietHours(22, 8, at(23)));
  assert.ok(inQuietHours(22, 8, at(0)));
  assert.ok(inQuietHours(22, 8, at(7)));
  assert.ok(!inQuietHours(22, 8, at(8)));
  assert.ok(!inQuietHours(22, 8, at(21)));
  // 白天开会：9 点到 17 点
  assert.ok(inQuietHours(9, 17, at(9)));
  assert.ok(!inQuietHours(9, 17, at(17)));
  assert.ok(!inQuietHours(8, 8, at(8)));
  assert.ok(!inQuietHours(undefined, 8, at(3)));
});
