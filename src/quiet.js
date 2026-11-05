// 免打扰时段：from 点到 to 点（可以跨午夜，比如 22 点到第二天 8 点）。from 和 to 一样当成没设
function inQuietHours(from, to, date = new Date()) {
  const h = date.getHours();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

module.exports = { inQuietHours };
