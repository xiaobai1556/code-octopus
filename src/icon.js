// 托盘图标：直接用像素小章鱼的点阵生成，不需要图片文件（打包用的 .ico 也从这里生成，见 scripts/make-icon.js）

const SPRITE = [
  '..############..',
  '..############..',
  '..##o######o##..',
  '..##o######o##..',
  '################',
  '################',
  '..############..',
  '..############..',
  '...#.#....#.#...',
  '...#.#....#.#...',
];

const COLORS = { '#': [0xd9, 0x77, 0x57], o: [0x1f, 0x16, 0x11] };

// BGRA，正方形，小章鱼竖直居中
function bitmap(scale) {
  const size = 16 * scale;
  const buf = Buffer.alloc(size * size * 4);
  const offY = 3 * scale;
  SPRITE.forEach((row, gy) => {
    [...row].forEach((ch, gx) => {
      const c = COLORS[ch];
      if (!c) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((offY + gy * scale + dy) * size + gx * scale + dx) * 4;
          buf[i] = c[2]; // BGRA
          buf[i + 1] = c[1];
          buf[i + 2] = c[0];
          buf[i + 3] = 255;
        }
      }
    });
  });
  return { buf, size };
}

function trayIcon() {
  const { nativeImage } = require('electron');
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2, 3]) {
    const { buf, size } = bitmap(scale);
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: buf });
  }
  return img;
}

module.exports = { trayIcon, bitmap };
