const test = require('node:test');
const assert = require('node:assert/strict');
const { computePlatforms } = require('../src/terrain');

test('窗口上边缘是平台，被前面的窗口挡住的部分要扣掉', () => {
  // Z 序从上到下：front 在前面，挡住 back 上边缘的中间一段
  const front = { id: 1, l: 300, t: 100, r: 500, b: 400 };
  const back = { id: 2, l: 100, t: 200, r: 800, b: 600 };
  const plats = computePlatforms([front, back], 1000, 800);
  assert.deepEqual(
    plats.map(({ id, x1, x2, y }) => ({ id, x1, x2, y })),
    [
      { id: 1, x1: 300, x2: 500, y: 100 },
      { id: 2, x1: 100, x2: 300, y: 200 },
      { id: 2, x1: 500, x2: 800, y: 200 },
    ]
  );
});

test('太靠上、太靠下、太窄的不算平台', () => {
  assert.equal(computePlatforms([{ id: 1, l: 0, t: 20, r: 400, b: 300 }], 1000, 800).length, 0); // 头顶站不下
  assert.equal(computePlatforms([{ id: 1, l: 0, t: 790, r: 400, b: 900 }], 1000, 800).length, 0); // 贴着屏幕底
  const narrow = computePlatforms(
    [
      { id: 1, l: 120, t: 100, r: 400, b: 500 },
      { id: 2, l: 100, t: 300, r: 420, b: 600 },
    ],
    1000,
    800
  );
  assert.deepEqual(narrow.map((p) => p.id), [1]); // 2 号只剩左右各 20px，太窄
});

test('伸出屏幕的窗口：平台截在屏幕范围内', () => {
  const [p] = computePlatforms([{ id: 1, l: -200, t: 300, r: 1300, b: 700 }], 1000, 800);
  assert.equal(p.x1, 0);
  assert.equal(p.x2, 1000);
  assert.equal(p.wx, -200);
});
