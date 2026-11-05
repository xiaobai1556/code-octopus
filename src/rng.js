// 可以播种的随机数：同一个种子（比如"2026-11-05:bugs"）永远给出同一串数。今日挑战用它，
// 同一天、同一个游戏，所有人拿到同一局。游戏厅页面用 <script> 引入（window.ARCADE_RNG），测试里 require。
(function (root) {
  // 把种子文字揉成一个 32 位整数（xmur3），再用 mulberry32 一个个吐出 [0, 1) 的数
  function seeded(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    let a = (h ^= h >>> 16) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  // 本地日期（和 stats.js 的 dayKey 一样的写法）
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // 前一天的 YYYY-MM-DD（按日历算，不受夏令时影响）
  function prevDay(key) {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // 今日挑战连续打卡：streak = { last, n, best }，在 day 那天玩了一局今日挑战之后变成什么样
  function bumpStreak(streak, day) {
    const st = { last: '', n: 0, best: 0, ...(streak || {}) };
    if (st.last && day <= st.last) return st; // 同一天玩第二局，或者日期往回走了：不变
    st.n = st.last === prevDay(day) ? st.n + 1 : 1;
    st.last = day;
    st.best = Math.max(st.best, st.n);
    return st;
  }

  // 到 today 为止还连着的天数（昨天玩过、今天还没玩也算连着），以及今天玩过没有
  function streakOn(streak, today) {
    const st = streak || {};
    const alive = st.last === today || st.last === prevDay(today);
    return { n: alive ? st.n || 0 : 0, best: st.best || 0, doneToday: st.last === today };
  }

  const api = { seeded, dayKey, prevDay, bumpStreak, streakOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ARCADE_RNG = api;
})(typeof window !== 'undefined' ? window : globalThis);
