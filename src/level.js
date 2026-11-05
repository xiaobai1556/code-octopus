// 养成等级：经验从 stats 的累计数字算出来（不另外存），所以老用户一升级就有对应的等级。
// 每 5 级换一个称号；升到第 L 级需要 280 × (L - 1)² 点经验（每天干活多的话一个月十级左右，半年二十几级）。
(function (root) {
  const XP = { prompts: 2, tools: 1, testsPass: 5, commits: 10, done: 5 };
  const TITLES = ['intern', 'junior', 'engineer', 'senior', 'staff', 'architect', 'legend'];
  const need = (level) => 280 * (level - 1) ** 2;

  function xpOf(totals = {}) {
    return Object.entries(XP).reduce((n, [k, w]) => n + (Number(totals[k]) || 0) * w, 0);
  }

  // { level, title, xp, cur: 这一级起点, next: 下一级要多少 }
  function levelOf(xp) {
    let level = 1;
    while (xp >= need(level + 1)) level++;
    return { level, title: TITLES[Math.min(TITLES.length - 1, Math.floor(level / 5))], xp, cur: need(level), next: need(level + 1) };
  }

  const api = { XP, TITLES, xpOf, levelOf, need };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LEVEL = api;
})(typeof window !== 'undefined' ? window : globalThis);
