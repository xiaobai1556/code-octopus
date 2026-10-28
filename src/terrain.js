// 把窗口列表（Z 序从上到下）变成桌宠能站的"平台"：每个窗口的上边缘，
// 减去被更靠前的窗口挡住的部分。坐标都是覆盖层窗口内的 DIP。
const MIN_HEADROOM = 70; // 上边缘离屏幕顶太近就站不下
const MIN_WIDTH = 50;

function cut(segs, l, r) {
  const out = [];
  for (const [a, b] of segs) {
    if (r <= a || l >= b) {
      out.push([a, b]);
      continue;
    }
    if (l > a) out.push([a, l]);
    if (r < b) out.push([r, b]);
  }
  return out;
}

function computePlatforms(wins, width, height) {
  const plats = [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const y = Math.round(w.t);
    if (y < MIN_HEADROOM || y > height - 30) continue;
    let segs = [[Math.max(0, w.l), Math.min(width, w.r)]];
    for (let j = 0; j < i && segs.length; j++) {
      const v = wins[j];
      if (v.t <= y && v.b > y) segs = cut(segs, v.l, v.r);
    }
    for (const [a, b] of segs) {
      // z：前后顺序，0 是最前面的窗口
      if (b - a >= MIN_WIDTH) plats.push({ id: w.id, x1: Math.round(a), x2: Math.round(b), y, wx: Math.round(w.l), z: i });
    }
  }
  return plats;
}

module.exports = { computePlatforms };
