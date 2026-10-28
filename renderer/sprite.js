// 像素小章鱼：16×10 的网格，按"姿势"参数程序化绘制，不需要任何图片素材。
// 网格坐标以未翻转（面朝右）为准；flip 时整体镜像，所以道具画在 x≥16 就是"手边"。
//
//   ..############..      身体 12×8，眼睛在第 2~3 行
//   ..##.######.##..
//   ################      两侧小手
//   ...#.#....#.#...      四条小腿

const PET_W = 16;
const PET_H = 10;
const INK = '#1F1611';
const PALETTES = [
  { body: '#D97757' }, // 经典 Claude 橙
  { body: '#5B9BD5' },
  { body: '#7DB85C' },
  { body: '#A98BD9' },
  { body: '#E2A23B' },
  { body: '#D9719A' },
];

const GLYPHS = {
  heart: ['.#.#.', '#####', '.###.', '..#..'],
  z: ['####', '..#.', '.#..', '####'],
  star: ['.#.', '###', '.#.'],
  note: ['..##', '..#.', '..#.', '###.', '##..'],
  // 四季飘落的小东西（见 world.js 的 seasonTick）
  petal: ['.#', '##'],
  leaf: ['.##', '###', '##.'],
  flake: ['#.#', '.#.', '#.#'],
  firefly: ['#'],
};

// 画一组像素块，先描边再填色，让漂浮的小东西在任何壁纸上都看得清
function drawBlob(ctx, rects, color, outline, o) {
  if (outline) {
    ctx.fillStyle = outline;
    for (const [x, y, w, h] of rects) ctx.fillRect(x - o, y - o, w + 2 * o, h + 2 * o);
  }
  ctx.fillStyle = color;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
}

// 以 (cx, cy) 为中心画一个点阵字形，g 是每格的设备像素
function drawGlyph(ctx, name, cx, cy, g, color, outline) {
  const rows = GLYPHS[name];
  const ox = Math.round(cx - (rows[0].length * g) / 2);
  const oy = Math.round(cy - (rows.length * g) / 2);
  const rects = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') rects.push([ox + x * g, oy + y * g, g, g]);
    });
  });
  drawBlob(ctx, rects, color, outline, Math.max(1, Math.round(g / 3)));
}

// ---------- 装扮 ----------
// 网格坐标同上（面朝右）；top 是身体最上面一行，帽子画在它上面几行（headroom 见 src/outfits.js）

function drawHead(px, blob, item, top, grow, t) {
  const r = (n) => top - n; // 头顶往上第 n 行
  switch (item) {
    case 'crown': {
      const G = '#F2C14E';
      for (const c of [4, 7, 8, 11]) px(c, r(3), 1, 1, G);
      px(4, r(2), 8, 1, G);
      px(7, r(2), 2, 1, '#E5484D');
      px(4, r(1), 8, 1, '#C9962B');
      break;
    }
    case 'tophat':
      px(5, r(5), 6, 4, '#2B2B2E');
      px(6, r(5), 1, 3, '#45454A');
      px(5, r(2), 6, 1, '#C0392B');
      px(3, r(1), 10, 1, '#2B2B2E');
      break;
    case 'cap':
      px(5, r(2), 6, 1, '#3D7DD8');
      px(4, r(1), 8, 1, '#3D7DD8');
      px(12, r(1), 4, 1, '#2C5FA8'); // 帽檐朝前
      px(7, r(3), 2, 1, '#2C5FA8');
      break;
    case 'nightcap':
      px(3, r(1), 10, 1, '#FFFFFF');
      px(4, r(2), 7, 1, '#5B7BD5');
      px(4, r(3), 5, 1, '#5B7BD5');
      px(3, r(4), 3, 1, '#5B7BD5');
      blob([[2, r(5), 2, 2]], '#FFFFFF', '#C9D2E3');
      break;
    case 'headphones': {
      const D = '#3A3A3F';
      px(3, r(2), 10, 1, D);
      px(2 - grow, r(1), 1, 2, D);
      px(13 + grow, r(1), 1, 2, D);
      px(1 - grow, top + 1, 2, 3, '#E5484D');
      px(13 + grow, top + 1, 2, 3, '#E5484D');
      break;
    }
    case 'headband':
      px(2 - grow, top, 12 + 2 * grow, 1, '#E5484D');
      px(0 - grow, top + 1, 2, 1, '#E5484D'); // 后面飘着的带子
      px(0 - grow, top + 2, 1, 1, '#E5484D');
      break;
    case 'sprout':
      px(8, r(1), 1, 1, '#3E8E45');
      px(7, r(2), 3, 1, '#5DBB63');
      px(6, r(3), 2, 1, '#5DBB63');
      px(9, r(3), 2, 1, '#5DBB63');
      break;
    case 'chefhat':
      blob([[5, r(5), 6, 1], [4, r(4), 8, 1], [3, r(3), 10, 2], [4, r(1), 8, 1]], '#FFFFFF', '#B9BEC6');
      px(4, r(1), 8, 1, '#E3E6EA');
      break;
    case 'partyhat':
      px(5, r(1), 6, 1, '#F25F8A');
      px(6, r(2), 4, 1, '#FFD43B');
      px(7, r(3), 2, 1, '#F25F8A');
      px(7, r(4), 2, 1, '#FFD43B');
      blob([[7, r(5), 2, 1]], '#5BC0EB');
      break;
    case 'santa':
      px(5, r(3), 6, 1, '#D63A3A');
      px(4, r(2), 8, 1, '#D63A3A');
      px(8, r(4), 4, 1, '#D63A3A'); // 帽尖往前耷拉
      px(3, r(1), 10, 1, '#FFFFFF');
      blob([[12, r(4), 2, 2]], '#FFFFFF', '#E3D5D5');
      break;
    case 'pumpkin':
      px(7, r(2), 2, 2, '#6B4A2B');
      px(9, r(2), 2, 1, '#5DBB63');
      break;
    case 'propeller': {
      // 儿童节：竹蜻蜓帽，螺旋桨一直在转（宽 / 窄两帧交替）
      for (let c = 0; c < 4; c++) px(4 + c * 2, r(1), 2, 1, ['#E5484D', '#FFD43B', '#3D7DD8', '#5DBB63'][c]);
      px(5, r(2), 3, 1, '#3D7DD8');
      px(8, r(2), 3, 1, '#E5484D');
      px(8, r(3), 1, 1, '#3A3A3F');
      if (Math.floor((t || 0) * 8) % 2 === 0) px(4, r(4), 9, 1, '#F2C14E');
      else px(7, r(4), 3, 1, '#C9962B');
      break;
    }
    case 'zongzi':
      // 端午：头顶一个粽子，缠着棉绳
      blob([[7, r(4), 2, 1], [6, r(3), 4, 1], [5, r(2), 6, 1], [4, r(1), 8, 1]], '#4E9A3E', '#2F6B27');
      px(5, r(2), 6, 1, '#C9A66B');
      px(8, r(4), 1, 1, '#6CC25A');
      break;
    case 'bunnyears':
      // 中秋：玉兔耳朵，右边那只尖儿往前歪
      blob([[4, r(5), 2, 5], [10, r(4), 2, 4], [11, r(5), 2, 1]], '#FFFFFF', '#C9C2D8');
      px(5, r(4), 1, 3, '#F5A3B7');
      px(11, r(3), 1, 2, '#F5A3B7');
      break;
    // 四季：头上没戴东西时
    case 'flower':
      // 春：头顶插一朵小花
      px(10, r(1), 1, 1, '#3E8E45');
      blob([[9, r(2), 3, 1], [10, r(3), 1, 1]], '#F7A8C4', '#FFFFFF');
      px(10, r(2), 1, 1, '#FFD43B');
      break;
    case 'strawhat':
      // 夏：草帽
      px(5, r(3), 6, 1, '#E8C872');
      px(5, r(2), 6, 1, '#D9534F'); // 帽带
      px(2, r(1), 12, 1, '#E8C872');
      px(3, r(1), 1, 1, '#C9A44E');
      px(12, r(1), 1, 1, '#C9A44E');
      break;
    case 'mapleleaf':
      // 秋：一片枫叶落在头上
      blob([[7, r(4), 1, 1], [5, r(3), 1, 1], [7, r(3), 1, 1], [9, r(3), 1, 1], [5, r(2), 5, 1]], '#E0602F', '#FFFFFF');
      px(7, r(1), 1, 1, '#8B4A2B');
      px(7, r(2), 1, 2, '#F2A03D'); // 叶脉
      break;
    case 'earmuffs':
      // 冬：毛茸茸的耳罩
      px(3, r(1), 10, 1, '#8B6B4A');
      blob([[1 - grow, top, 2, 3], [13 + grow, top, 2, 3]], '#F4F1EA', '#D9534F');
      break;
  }
}

// under：先画镜片（在眼睛下面），再画眼睛，最后画镜框
function drawFace(px, item, er, dx, under) {
  if (item === 'glasses') {
    const F = '#3B2F2A';
    for (const ex of [4 + dx, 11 + dx]) {
      if (under) {
        px(ex - 1, er, 3, 2, 'rgba(225,242,255,0.6)');
        continue;
      }
      px(ex - 2, er - 1, 5, 1, F);
      px(ex - 2, er + 2, 5, 1, F);
      px(ex - 2, er, 1, 2, F);
      px(ex + 2, er, 1, 2, F);
    }
    if (!under) px(7 + dx, er, 2, 1, F);
  } else if (item === 'sunglasses' && !under) {
    for (const lx of [2 + dx, 9 + dx]) {
      px(lx, er, 5, 2, '#16161A');
      px(lx + 1, er, 1, 1, '#6A6A78');
    }
    px(7 + dx, er, 2, 1, '#16161A');
  } else if (item === 'heartglasses' && !under) {
    // 情人节：爱心眼镜
    for (const ex of [4 + dx, 11 + dx]) {
      const H = '#F25F8A';
      px(ex - 2, er - 1, 2, 1, H);
      px(ex + 1, er - 1, 2, 1, H);
      px(ex - 2, er, 5, 1, H);
      px(ex - 1, er + 1, 3, 1, H);
      px(ex, er + 2, 1, 1, H);
      px(ex - 2, er - 1, 1, 1, '#FFC2D4');
    }
    px(7 + dx, er, 2, 1, '#C7365F');
  } else if (item === 'nosemask' && !under) {
    // 愚人节：粗框眼镜 + 大鼻子 + 小胡子
    const F = '#1E1E22';
    for (const ex of [4 + dx, 11 + dx]) {
      px(ex - 2, er - 2, 5, 1, F); // 浓眉
      px(ex - 2, er + 2, 5, 1, F);
      px(ex - 2, er, 1, 2, F);
      px(ex + 2, er, 1, 2, F);
    }
    px(7 + dx, er, 2, 1, F);
    px(7 + dx, er + 1, 2, 2, '#F2A07B');
    px(7 + dx, er + 1, 1, 1, '#FFD0B5');
    px(5 + dx, er + 3, 6, 1, F);
    px(4 + dx, er + 4, 1, 1, F);
    px(11 + dx, er + 4, 1, 1, F);
  }
}

function drawNeck(px, item, top, grow, bottom) {
  if (item === 'bowtie') {
    const R = '#E5484D';
    px(5, top + 4, 2, 1, R);
    px(9, top + 4, 2, 1, R);
    px(5, top + 5, 6, 1, R);
    px(7, top + 5, 2, 1, '#B8323A');
    px(5, top + 6, 2, 1, R);
    px(9, top + 6, 2, 1, R);
  } else if (item === 'scarf' || item === 'scarfRed') {
    const [S, L] = item === 'scarf' ? ['#4C9BE8', '#A8D1F7'] : ['#D63A3A', '#F2C14E'];
    const x0 = 2 - grow;
    const w = 12 + 2 * grow;
    px(x0, top + 5, w, 2, S);
    for (let c = x0 + 1; c < x0 + w; c += 3) px(c, top + 5, 1, 2, L);
    px(3 - grow, top + 7, 2, 2, S); // 垂下来的一截
    px(3 - grow, top + 9, 2, 1, L);
  } else if (item === 'plaid') {
    // 程序员节：格子衫（盖住下半身）
    const x0 = 2 - grow;
    const w = 12 + 2 * grow;
    const y0 = top + 4;
    const h = bottom - y0;
    if (h <= 0) return;
    px(x0, y0, w, h, '#3D6FB6');
    for (let c = x0 + 1; c < x0 + w; c += 3) px(c, y0, 1, h, '#D9534F');
    for (let r = y0 + 1; r < bottom; r += 2) px(x0, r, w, 1, '#2A4F86');
    px(7, y0, 2, 1, '#E8E4DA'); // 领口
    px(7, y0 + 1, 1, h - 1, '#F2C14E'); // 一排扣子那条缝
  }
}

/**
 * x, y：脚底中心（设备像素）；P：每格设备像素；pose 字段：
 *   top 身体下沉格数(0 站 / 1 呼吸 / 2 蹲)，wide 压扁变宽，sit 坐下没腿，
 *   eyes open|blink|sleep|happy|wide|x|down，dx/dy 视线偏移，
 *   armL/armR 手的高度(行偏移数字或 'high')，legs stand|walk0|walk1|tuck|kick0|kick1，
 *   blush 脸红，props 道具列表，t 动画时间(秒)，shadow 脚下阴影，
 *   fat 饱腹度 0/1/2（上下文越满身体越宽，每级两边各宽一格），
 *   outfit { head, face, neck } 穿戴的装扮（见 src/outfits.js），mouth open|chew 张嘴 / 嚼东西，
 *   laptopAnim { dir: in|out, k } 正在拿出 / 收起笔记本（k 0~1），toolK 放大镜、天线拿出来了多少（0~1）
 */
function drawPet(ctx, x, y, P, pal, flip, pose) {
  const ox = Math.round(x - (PET_W * P) / 2);
  const oy = Math.round(y) - PET_H * P;
  const t = pose.t || 0;
  const props = pose.props || [];
  const has = (k) => props.includes(k);
  const o = Math.max(1, Math.round(P / 4));

  const gx = (cx, w) => ox + (flip ? PET_W - cx - w : cx) * P;
  const px = (cx, cy, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(gx(cx, w), oy + cy * P, w * P, h * P);
  };
  const blob = (cells, color, outline = '#FFFFFF') =>
    drawBlob(ctx, cells.map(([cx, cy, w, h]) => [gx(cx, w), oy + cy * P, w * P, h * P]), color, outline, o);

  const outfit = pose.outfit || {};
  const pumpkin = outfit.head === 'pumpkin';
  const B = pumpkin ? '#E8862A' : pal.body; // 万圣节：变成南瓜灯
  const top = pose.top || 0;
  const lift = pose.headroom || 0; // 戴着帽子时牌子举高一点
  const bodyH = pose.wide ? 7 : 8;
  const bottom = top + bodyH;
  const fat = pose.fat || 0;
  const grow = fat + (pose.wide ? 1 : 0); // 身体两边各往外长几格

  if (pose.shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ox + (2 - fat) * P, Math.round(y), (12 + 2 * fat) * P, Math.max(1, Math.round(P / 3)));
  }

  // 笔记本拿出来 / 收起来的几个阶段：在身后 → 举过头顶 → 放到身前再打开屏幕（收起时倒过来）
  const la = pose.laptopAnim;
  const c01 = (v) => Math.min(1, Math.max(0, v));
  const lstage = !la ? 'front' : la.dir === 'in' ? (la.k < 0.33 ? 'behind' : la.k < 0.6 ? 'over' : 'front') : la.k < 0.4 ? 'front' : la.k < 0.7 ? 'over' : 'behind';
  const lopen = !la ? 1 : la.dir === 'in' ? c01((la.k - 0.6) / 0.4) : c01(1 - la.k / 0.4);
  const lrise = !la ? 1 : la.dir === 'in' ? c01(la.k / 0.33) : c01(1 - (la.k - 0.7) / 0.3);
  if (has('laptop') && lstage === 'behind') {
    // 从身后冒出来（被身体挡住一部分）
    const ly = top + 5 - Math.round(4 * lrise);
    px(-2, ly, 6, 3, '#9AA0A8');
    px(-2, ly, 6, 1, '#C9CDD4');
  }

  // 举着的牌子在身后
  const sign = props.find((k) => k.startsWith('sign'));
  if (sign) {
    const sy = top - 11 - lift;
    px(1, top - 3 - lift, 1, 3 + lift, '#8B6B4A');
    px(14, top - 3 - lift, 1, 3 + lift, '#8B6B4A');
    px(0, sy, 16, 9, INK);
    // flash：急事时牌子在米白和橙色之间闪
    px(1, sy + 1, 14, 7, pose.flash ? '#D97757' : sign === 'signNote' ? '#FFE680' : '#FFF6E0');
    if (sign === 'signNote') {
      // 一张便签：几行字
      const L = '#8B6B4A';
      for (const [cx, cy, w] of [[3, 2, 9], [3, 4, 10], [3, 6, 6]]) px(cx, sy + cy, w, 1, L);
    } else if (sign === 'signTomato') {
      // 番茄钟到点：牌子上画个番茄
      px(6, sy + 3, 4, 4, '#E5484D');
      px(5, sy + 4, 6, 2, '#E5484D');
      px(7, sy + 2, 2, 1, '#3E8E45');
      px(6, sy + 4, 1, 1, '#FF8A8A');
    } else if (sign === 'sign!') {
      const R = pose.flash ? '#FFFFFF' : '#E5484D';
      px(7, sy + 2, 2, 3, R);
      px(7, sy + 6, 2, 1, R);
    } else if (sign === 'sign✓') {
      // 绿色的对勾：长任务做完了
      const G = '#3F9A5B';
      for (const [cx, cy] of [[4, 4], [5, 5], [6, 6], [7, 5], [8, 4], [9, 3], [10, 2]]) px(cx, sy + cy, 2, 1, G);
    } else if (sign === 'signDoc') {
      // 一张写满字的纸：日报写好了
      const L = '#8B6B4A';
      for (const [cx, cy, w] of [[3, 2, 10], [3, 4, 8], [3, 6, 9]]) px(cx, sy + cy, w, 1, L);
    } else {
      const R = pose.flash ? '#FFFFFF' : '#3B82F6';
      px(7, sy + 2, 2, 1, R);
      px(6, sy + 3, 1, 1, R);
      px(9, sy + 3, 1, 1, R);
      px(8, sy + 4, 1, 1, R);
      px(8, sy + 6, 1, 1, R);
    }
  }

  // 腿（胖了以后外侧两条腿往外撇）
  if (!pose.sit) {
    const n = 10 - bottom;
    [3 - fat, 5, 10, 12 + fat].forEach((lx, i) => {
      let len = n;
      if ((pose.legs === 'walk0' && i % 2 === 1) || (pose.legs === 'walk1' && i % 2 === 0) || pose.legs === 'tuck') len = Math.min(n, 1);
      if (len <= 0) return;
      if (pose.legs === 'kick0' && len === 2) {
        px(lx, bottom, 1, 1, B);
        px(lx + (i < 2 ? -1 : 1), bottom + 1, 1, 1, B);
      } else {
        px(lx, bottom, 1, len, B);
      }
    });
  }

  // 身体和手（胖了身体变宽，手跟着往外挪）
  px(2 - grow, top, 12 + 2 * grow, bodyH, B);
  if (fat) px(3 - grow, top + bodyH, 10 + 2 * grow, 1, B); // 撑圆的肚子往下鼓一点
  const arm = (ax, a) => {
    if (a === 'hide') return;
    if (a === 'high') px(ax, top - 1, 2, 3, B);
    else px(ax, top + a, 2, 2, B);
  };
  arm(0 - fat, pose.armL ?? 4);
  arm(14 + fat, pose.armR ?? 4);
  if (pumpkin) {
    // 南瓜的竖纹
    px(5, top + 1, 1, bodyH - 2, '#C96A1B');
    px(10, top + 1, 1, bodyH - 2, '#C96A1B');
  }
  drawNeck(px, outfit.neck, top, grow, bottom);

  // 眼睛
  const er = top + 2 + (pose.dy || 0);
  const dx = pose.dx || 0;
  drawFace(px, outfit.face, er, dx, true);
  [4, 11].forEach((ex0, i) => {
    const ex = ex0 + dx;
    if (pumpkin && (pose.eyes === 'open' || pose.eyes === 'wide' || !pose.eyes)) {
      px(ex, er, 1, 1, INK); // 三角眼
      px(ex - 1, er + 1, 3, 1, INK);
      return;
    }
    switch (pose.eyes) {
      case 'blink':
      case 'sleep':
        px(ex - 1, er + 1, 3, 1, INK);
        break;
      case 'happy':
        px(ex - 1, er + 1, 1, 1, INK);
        px(ex, er, 1, 1, INK);
        px(ex + 1, er + 1, 1, 1, INK);
        break;
      case 'wide':
        px(i === 0 ? ex - 1 : ex, er, 2, 2, INK);
        break;
      case 'x':
        for (const [a, b] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]) px(ex + a, er + b, 1, 1, INK);
        break;
      case 'down':
        px(ex, er + 1, 1, 2, INK);
        break;
      default:
        px(ex, er, 1, 2, INK);
    }
  });
  if (pose.blush) {
    px(3, top + 4, 1, 1, 'rgba(255,170,170,0.9)');
    px(12, top + 4, 1, 1, 'rgba(255,170,170,0.9)');
  }

  // 嘴：平时没有嘴；张嘴等着吃 / 嚼东西 / 南瓜灯的笑脸
  const chewing = pose.mouth === 'chew' && Math.floor(t * 7) % 2 === 0;
  if (pumpkin && !pose.mouth) {
    px(5 + dx, top + 5, 6, 1, INK);
    px(6 + dx, top + 6, 1, 1, INK);
    px(9 + dx, top + 6, 1, 1, INK);
  } else if (pose.mouth === 'open' || (pose.mouth === 'chew' && !chewing)) {
    px(6 + dx, top + 4, 4, 3, INK);
    px(7 + dx, top + 5, 2, 2, '#E5687A');
  } else if (chewing) {
    px(6 + dx, top + 5, 4, 1, INK);
  }

  drawFace(px, outfit.face, er, dx, false);
  drawHead(px, blob, outfit.head, top, grow, t);

  // 前景道具
  if (has('laptop') && lstage === 'over') {
    // 合着的笔记本举过头顶
    px(4, top - 3, 8, 2, '#9AA0A8');
    px(4, top - 3, 8, 1, '#C9CDD4');
  }
  if (has('laptop') && lstage === 'front') {
    // 放在身前，屏幕从合着慢慢打开
    const h = 9 - (top + 5);
    const lid = Math.max(1, Math.round(h * lopen));
    px(3, 9 - lid, 10, lid, '#C9CDD4');
    px(3, 9 - lid, 10, 1, '#9AA0A8');
    if (lopen > 0.8) px(7, top + 6, 2, 1, '#FFFFFF');
    px(1, 9, 14, 1, '#6E747C');
  }
  if (has('terminal')) {
    const ty = top - 4;
    const G = '#5BE37D';
    px(16, ty, 8, 7, '#3B3B3B');
    px(17, ty + 1, 6, 5, '#121212');
    px(18, ty + 2, 1, 1, G);
    px(19, ty + 3, 1, 1, G);
    px(18, ty + 4, 1, 1, G);
    if (Math.floor(t * 2.5) % 2 === 0) px(20, ty + 4, 2, 1, G);
  }
  const tk = pose.toolK == null ? 1 : pose.toolK;
  if (has('magnifier') && tk > 0.15) {
    // 从身体旁边滑出来
    const mx = 16 - Math.round((1 - tk) * 4) + (tk >= 1 && Math.sin(t * 3) <= 0 ? 1 : 0);
    const my = top;
    const RIM = '#5A4636';
    px(mx + 1, my + 1, 3, 3, 'rgba(190,230,255,0.85)');
    px(mx + 1, my, 3, 1, RIM);
    px(mx + 1, my + 4, 3, 1, RIM);
    px(mx, my + 1, 1, 3, RIM);
    px(mx + 4, my + 1, 1, 3, RIM);
    px(mx - 1, my + 4, 1, 1, RIM);
  }
  if (has('antenna') && tk > 0.1) {
    // 从头顶一节一节长出来
    const S = '#7A7F87';
    const on = tk >= 1 && Math.floor(t * 3) % 2 === 0;
    px(9, top - 1, 1, 1, S);
    if (tk > 0.35) px(9, top - 2, 1, 1, S);
    if (tk > 0.6) px(10, top - 3, 1, 1, S);
    if (tk > 0.85) px(10, top - 5, 2, 2, on ? '#5BE37D' : '#2E8B57');
    if (on) blob([[13, top - 6, 1, 1], [14, top - 5, 1, 2]], '#5BE37D');
  }
  // 闲着时的小东西：书、咖啡、掌机
  if (has('book') || has('bookFlip')) {
    px(4, top + 5, 8, 2, '#8B5A3C');
    px(5, top + 5, 2, 1, '#FFF6E0');
    px(9, top + 5, 2, 1, '#FFF6E0');
    if (has('bookFlip')) px(8, top + 4, 2, 1, '#FFF6E0'); // 翻页
  }
  const steam = (sx, sy) => {
    const s = Math.floor(t * 3) % 2;
    px(sx + s, sy, 1, 1, 'rgba(255,255,255,0.75)');
    px(sx + 1 - s, sy - 1, 1, 1, 'rgba(255,255,255,0.55)');
  };
  if (has('mug')) {
    px(16, top + 4, 2, 3, '#F4F1EA');
    px(18, top + 5, 1, 1, '#F4F1EA');
    px(16, top + 4, 2, 1, '#6B4A2B');
    steam(16, top + 2);
  }
  if (has('mugUp')) {
    // 端到嘴边喝一口
    px(12, top + 3, 2, 3, '#F4F1EA');
    px(14, top + 4, 1, 1, '#F4F1EA');
    px(12, top + 3, 2, 1, '#6B4A2B');
    steam(12, top + 1);
  }
  if (has('handheld')) {
    px(5, top + 5, 6, 3, '#3A3A3F');
    px(6, top + 5, 4, 2, Math.floor(t * 4) % 2 ? '#5BE37D' : '#3FB862');
    px(5, top + 7, 1, 1, '#E5484D');
    px(10, top + 7, 1, 1, '#5B9BD5');
  }
  if (has('dots')) {
    const n = Math.floor(t * 3) % 4;
    const cells = [];
    for (let k = 0; k < n; k++) cells.push([10 + k * 2, top - 3, 1, 1]);
    if (cells.length) blob(cells, INK);
  }
  if (has('tear')) blob([[4 + dx, top + 4 + (Math.floor(t * 4) % 3), 1, 1]], '#7CC4FA');
  if (has('sweat')) blob([[14, top - 2, 1, 2]], '#7CC4FA');
  if (has('stars')) {
    const cells = [];
    for (let k = 0; k < 3; k++) {
      const a = t * 5 + (k * Math.PI * 2) / 3;
      cells.push([Math.round(7 + Math.cos(a) * 7), Math.round(top - 2 + Math.sin(a) * 1.5), 1, 1]);
    }
    blob(cells, '#FFD43B', INK);
  }
  const hy = top + 3; // 手边道具的上沿
  if (has('tomato')) {
    blob([[16, hy + 1, 3, 2], [17, hy, 1, 1]], '#E5484D', '#FFFFFF');
    px(17, hy, 1, 1, '#3E8E45');
    px(16, hy + 1, 1, 1, '#FF8A8A');
  }
  if (has('note')) {
    blob([[16, hy - 1, 3, 3]], '#FFE680', '#FFFFFF');
    px(16, hy, 2, 1, '#B8A04A');
  }
  if (has('lantern')) {
    // 提着的小灯笼，一闪一闪地亮
    const on = 0.55 + 0.25 * Math.sin(t * 3);
    px(15, hy - 1, 3, 1, '#8B6B4A');
    px(17, hy, 1, 1, '#8B6B4A');
    px(15, hy + 1, 5, 5, `rgba(255,190,60,${(on * 0.5).toFixed(2)})`);
    blob([[16, hy + 2, 3, 3]], '#FFD166', '#7A4E1F');
    px(17, hy + 3, 1, 1, '#FFF4C2');
  }
}
