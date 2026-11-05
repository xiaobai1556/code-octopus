// 存 JSON：先写到旁边的临时文件，再改名盖过去。写到一半断电、崩溃时，原来的文件还是完整的，
// 不会变成半截 JSON（读不出来就只能回到默认值：设置重置、便签和"吐出来"的记录丢失）。
const fs = require('fs');
const path = require('path');

function writeJsonAtomic(file, data, pretty = false) {
  const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // 目标文件正被别的程序（杀毒软件、同步盘）占着时改名会失败：退回直接写
    fs.writeFileSync(file, text);
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

module.exports = { writeJsonAtomic };
