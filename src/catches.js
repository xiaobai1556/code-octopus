// 钓鱼图鉴：能钓上来的东西、多常见（weight 越大越常见）、怎么画（renderer/sprite.js 里的 GLYPHS）。
// 覆盖层钓鱼时按 weight 随机挑；主进程记下每样钓到几次（stats.data.catches），设置面板显示收集进度。
(function (root) {
  const CATCHES = [
    { id: 'fish', weight: 28, glyph: 'fish', color: '#F2A65A' },
    { id: 'bug', weight: 22, glyph: 'bug', color: '#7DB85C' },
    { id: 'boot', weight: 14, glyph: 'boot', color: '#8B6A4E' },
    { id: 'sock', weight: 12, glyph: 'sock', color: '#E5687A' },
    { id: 'duck', weight: 7, glyph: 'duckg', color: '#FFD43B' },
    { id: 'floppy', weight: 6, glyph: 'floppy', color: '#4F7FA8' },
    { id: 'semicolon', weight: 5, glyph: 'semi', color: '#C9CDD4' },
    { id: 'esc', weight: 3, glyph: 'key', color: '#F4F1EA' },
    { id: 'star', weight: 2, glyph: 'star', color: '#FFD43B' },
    { id: 'goldbug', weight: 1, glyph: 'bug', color: '#F2C14E' },
  ];
  const byId = Object.fromEntries(CATCHES.map((c) => [c.id, c]));
  const total = CATCHES.reduce((n, c) => n + c.weight, 0);

  // 按 weight 随机挑一样；r 是 [0, 1) 的随机数
  function pick(r = Math.random()) {
    let x = r * total;
    for (const c of CATCHES) {
      x -= c.weight;
      if (x < 0) return c;
    }
    return CATCHES[0];
  }

  // 稀有度：common / rare / legendary（钓到稀有的会多一点庆祝）
  const rarity = (id) => (!byId[id] ? '' : byId[id].weight >= 10 ? 'common' : byId[id].weight >= 3 ? 'rare' : 'legendary');

  const api = { CATCHES, byId, pick, rarity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CATCHES = api;
})(typeof window !== 'undefined' ? window : globalThis);
