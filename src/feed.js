// 喂文件：把文件拖到小章鱼身上，它就"吃掉"——挪到"章鱼的肚子"文件夹里按月份放好。
// 只挪不删；每一批都记下原来的位置，可以"吐出来"（撤销）。文件夹、系统目录里的文件不吃。
const fs = require('fs');
const path = require('path');

const MAX_PER_BITE = 50;
const LOG_KEEP = 100;

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const norm = (p) => path.resolve(p).toLowerCase() + path.sep;
const inside = (p, dir) => norm(p).startsWith(norm(dir));

// 系统和程序目录、程序自己、磁盘根目录下的东西都不碰
function protectedPath(p, extra = []) {
  const env = process.env;
  const dirs = [env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, ...extra].filter(Boolean);
  if (dirs.some((d) => inside(p, d))) return true;
  return path.dirname(path.resolve(p)) === path.parse(path.resolve(p)).root;
}

// 重名就加 (2) (3)…
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

// 同一个盘直接改名；跨盘就先复制、核对大小，再删掉原来的
function move(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(from).size !== fs.statSync(to).size) {
      fs.unlinkSync(to);
      throw new Error('copy size mismatch');
    }
    fs.unlinkSync(from);
  }
}

class Feeder {
  constructor(logFile, protect = []) {
    this.logFile = logFile;
    this.protect = protect;
    this.log = [];
    try {
      this.log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    } catch {}
  }

  // 吃掉一批文件 → { eaten: [{ from, to }], skipped: [{ name, reason }], dir }
  eat(paths, belly) {
    const dir = path.join(belly, monthKey());
    const eaten = [];
    const skipped = [];
    for (const p of [...new Set(paths)].slice(0, MAX_PER_BITE)) {
      const name = path.basename(p);
      let reason = '';
      let st = null;
      try {
        st = fs.statSync(p);
      } catch {
        reason = 'missing';
      }
      if (!reason && st.isDirectory()) reason = 'folder';
      else if (!reason && !st.isFile()) reason = 'other';
      else if (!reason && inside(p, belly)) reason = 'already';
      else if (!reason && protectedPath(p, this.protect)) reason = 'protected';
      if (!reason) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          const to = freeName(dir, name);
          move(p, to);
          eaten.push({ from: path.resolve(p), to });
        } catch (err) {
          reason = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES' ? 'busy' : 'failed';
        }
      }
      if (reason) skipped.push({ name, reason });
    }
    if (paths.length > MAX_PER_BITE) skipped.push({ name: `+${paths.length - MAX_PER_BITE}`, reason: 'tooMany' });
    if (eaten.length) {
      this.log.push({ at: new Date().toISOString(), files: eaten });
      this.save();
    }
    return { eaten, skipped, dir };
  }

  lastBite() {
    return this.log[this.log.length - 1] || null;
  }

  // 吐出来：把上一批放回原处（原来的位置已经有同名文件了就留在肚子里）
  spit() {
    const bite = this.log.pop();
    if (!bite) return { restored: 0, kept: 0 };
    let restored = 0;
    const kept = [];
    for (const f of bite.files) {
      try {
        if (fs.existsSync(f.from) || !fs.existsSync(f.to)) throw new Error('busy');
        fs.mkdirSync(path.dirname(f.from), { recursive: true });
        move(f.to, f.from);
        restored++;
      } catch {
        if (fs.existsSync(f.to)) kept.push(f);
      }
    }
    // 放不回去的还记着，下次还能再吐
    if (kept.length) this.log.push({ ...bite, files: kept });
    this.save();
    return { restored, kept: kept.length };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.writeFileSync(this.logFile, JSON.stringify(this.log.slice(-LOG_KEEP)));
    } catch {}
  }
}

// 文件夹最上层有多少个文件（下载文件夹乱不乱）。没下完的、隐藏的系统文件不算
function looseFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !/^desktop\.ini$|\.(crdownload|part|tmp)$/i.test(e.name) && !e.name.startsWith('~$')).length;
  } catch {
    return 0;
  }
}

module.exports = { Feeder, looseFiles, monthKey };
