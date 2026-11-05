const test = require('node:test');
const assert = require('node:assert/strict');
const OUTFITS = require('../src/outfits');

const day = (y, m, d) => new Date(y, m - 1, d, 15, 0, 0);
const holidayId = (y, m, d) => (OUTFITS.holiday(day(y, m, d)) || {}).id || null;

test('节日：固定日期和农历节日', () => {
  assert.equal(holidayId(2026, 1, 1), 'newyear');
  assert.equal(holidayId(2026, 12, 31), 'newyear');
  assert.equal(holidayId(2026, 2, 16), 'spring'); // 除夕
  assert.equal(holidayId(2026, 3, 3), 'spring'); // 元宵
  assert.equal(holidayId(2026, 3, 4), null);
  assert.equal(holidayId(2026, 10, 24), 'programmer');
  assert.equal(holidayId(2026, 10, 31), 'halloween');
  assert.equal(holidayId(2026, 9, 25), 'midautumn');
  assert.equal(holidayId(2026, 12, 25), 'christmas');
  assert.equal(holidayId(2026, 7, 7), null);
});

test('四季按北半球月份', () => {
  assert.equal(OUTFITS.season(day(2026, 4, 1)), 'spring');
  assert.equal(OUTFITS.season(day(2026, 7, 1)), 'summer');
  assert.equal(OUTFITS.season(day(2026, 11, 30)), 'autumn');
  assert.equal(OUTFITS.season(day(2026, 2, 1)), 'winter');
});

test('实际穿的：节日盖掉对应部位，头上空着戴应季的，关了节日就只穿自己选的', () => {
  const chosen = { head: '', face: 'glasses', neck: 'bowtie' };
  assert.deepEqual(OUTFITS.effective(chosen, true, day(2026, 7, 7)), { head: 'strawhat', face: 'glasses', neck: 'bowtie' });
  assert.deepEqual(OUTFITS.effective(chosen, true, day(2026, 10, 24)), { head: 'mapleleaf', face: 'glasses', neck: 'plaid' });
  assert.deepEqual(OUTFITS.effective({ ...chosen, head: 'crown' }, true, day(2026, 12, 25)), { head: 'santa', face: 'glasses', neck: 'bowtie' });
  assert.deepEqual(OUTFITS.effective(chosen, false, day(2026, 12, 25)), { head: '', face: 'glasses', neck: 'bowtie' });
  assert.deepEqual(OUTFITS.effective({ head: 'no-such-hat' }, false), { head: '', face: '', neck: '' });
});

test('每件节日、应季装扮都登记过部位', () => {
  for (const y of [2026, 2030, 2035]) {
    for (const h of OUTFITS.calendar(y)) {
      for (const [slot, item] of Object.entries(h.outfit)) {
        assert.equal(OUTFITS.ITEMS[item] && OUTFITS.ITEMS[item].slot, slot, `${y} ${h.id} ${item}`);
      }
    }
  }
  for (const item of Object.values(OUTFITS.SEASON_ITEM)) assert.equal(OUTFITS.ITEMS[item].slot, 'head');
});
