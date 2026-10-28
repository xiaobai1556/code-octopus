// 装扮：头上、脸上、脖子上各一件。普通装扮靠成就解锁，节日装扮到日子自动换上（设置里可以关）。
// 主进程（校验设置）、覆盖层（画）和设置面板（衣柜）都用这份；画法在 renderer/sprite.js。
(function (root) {
  const SLOTS = ['head', 'face', 'neck'];

  const ITEMS = {
    crown: { slot: 'head' },
    tophat: { slot: 'head' },
    cap: { slot: 'head' },
    nightcap: { slot: 'head' },
    headphones: { slot: 'head' },
    headband: { slot: 'head' },
    sprout: { slot: 'head' },
    chefhat: { slot: 'head' },
    glasses: { slot: 'face' },
    sunglasses: { slot: 'face' },
    bowtie: { slot: 'neck' },
    scarf: { slot: 'neck' },
    // 节日限定
    partyhat: { slot: 'head', holiday: true },
    santa: { slot: 'head', holiday: true },
    pumpkin: { slot: 'head', holiday: true },
    scarfRed: { slot: 'neck', holiday: true },
    heartglasses: { slot: 'face', holiday: true },
    nosemask: { slot: 'face', holiday: true },
    propeller: { slot: 'head', holiday: true },
    zongzi: { slot: 'head', holiday: true },
    bunnyears: { slot: 'head', holiday: true },
    plaid: { slot: 'neck', holiday: true },
    // 四季（只戴在自己没选东西的部位）
    flower: { slot: 'head', holiday: true },
    strawhat: { slot: 'head', holiday: true },
    mapleleaf: { slot: 'head', holiday: true },
    earmuffs: { slot: 'head', holiday: true },
  };

  // 季节按北半球的月份：3-5 春、6-8 夏、9-11 秋、12-2 冬
  const SEASON_ITEM = { spring: 'flower', summer: 'strawhat', autumn: 'mapleleaf', winter: 'earmuffs' };
  function season(date = new Date()) {
    const m = date.getMonth() + 1;
    return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  }

  // 农历节日每年不一样，先列到 2035 年：春节（正月初一）、端午（五月初五）、中秋（八月十五）
  const SPRING_FESTIVAL = {
    2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3],
    2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8],
  };
  const DRAGON_BOAT = {
    2026: [6, 19], 2027: [6, 9], 2028: [5, 28], 2029: [6, 16], 2030: [6, 5],
    2031: [6, 24], 2032: [6, 12], 2033: [6, 1], 2034: [6, 20], 2035: [6, 10],
  };
  const MID_AUTUMN = {
    2026: [9, 25], 2027: [9, 15], 2028: [10, 3], 2029: [9, 22], 2030: [9, 12],
    2031: [10, 1], 2032: [9, 19], 2033: [9, 8], 2034: [9, 27], 2035: [9, 16],
  };

  // 一年里的节日：{ id, outfit, from, to }（from / to 是那一天的 0 点，两头都算）
  function calendar(y) {
    const d = (m, day) => new Date(y, m - 1, day);
    const around = (table, before, after) => {
      const md = table[y];
      return md && [d(md[0], md[1] - before), d(md[0], md[1] + after)];
    };
    const list = [
      // 新年跨年：12/31 ~ 1/2，放在年初这一段
      ['newyear', { head: 'partyhat' }, [d(1, 1), d(1, 2)]],
      ['spring', { neck: 'scarfRed' }, around(SPRING_FESTIVAL, 1, 14)], // 除夕到元宵
      ['valentine', { face: 'heartglasses' }, [d(2, 14), d(2, 14)]],
      ['aprilfools', { face: 'nosemask' }, [d(4, 1), d(4, 1)]],
      ['children', { head: 'propeller' }, [d(6, 1), d(6, 1)]],
      ['dragonboat', { head: 'zongzi' }, around(DRAGON_BOAT, 1, 1)],
      ['midautumn', { head: 'bunnyears' }, around(MID_AUTUMN, 1, 1)],
      ['programmer', { neck: 'plaid' }, [d(10, 24), d(10, 24)]], // 1024 程序员节：格子衫
      ['halloween', { head: 'pumpkin' }, [d(10, 25), d(11, 1)]],
      ['christmas', { head: 'santa' }, [d(12, 20), d(12, 26)]],
      ['newyear', { head: 'partyhat' }, [d(12, 31), d(12, 31)]],
    ];
    return list.filter(([, , range]) => range).map(([id, outfit, [from, to]]) => ({ id, outfit, from, to }));
  }

  // 今天是什么节日：{ id, outfit: { head?, face?, neck? } } 或 null
  function holiday(date = new Date()) {
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const h = calendar(date.getFullYear()).find((x) => today >= x.from.getTime() && today <= x.to.getTime());
    return h ? { id: h.id, outfit: h.outfit } : null;
  }

  // 实际穿在身上的：节日装扮盖掉对应部位，其他部位还是自己选的；头上空着的话戴上应季的小东西
  function effective(chosen, holidaysOn, date) {
    const out = {};
    for (const slot of SLOTS) out[slot] = (chosen && ITEMS[chosen[slot]] && chosen[slot]) || '';
    if (!holidaysOn) return out;
    if (!out.head) out.head = SEASON_ITEM[season(date)];
    const h = holiday(date);
    if (h) Object.assign(out, h.outfit);
    return out;
  }

  // 装扮占用头顶多少格（气泡、牌子、点击范围要往上让）
  const HEADROOM = { crown: 3, tophat: 5, cap: 2, nightcap: 5, headphones: 2, headband: 0, sprout: 3, chefhat: 5, partyhat: 5, santa: 4, pumpkin: 2, propeller: 4, zongzi: 4, bunnyears: 5, flower: 2, strawhat: 3, mapleleaf: 4, earmuffs: 1 };
  const headroom = (outfit) => (outfit && HEADROOM[outfit.head]) || 0;

  const api = { SLOTS, ITEMS, SEASON_ITEM, season, calendar, holiday, effective, headroom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OUTFITS = api;
})(typeof window !== 'undefined' ? window : globalThis);
