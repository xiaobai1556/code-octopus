const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Feeder, looseFiles, monthKey } = require('../src/feed');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-feed-'));
  const downloads = path.join(root, 'downloads');
  const belly = path.join(root, 'belly');
  fs.mkdirSync(downloads);
  const file = (name, text = name) => {
    const p = path.join(downloads, name);
    fs.writeFileSync(p, text);
    return p;
  };
  return { root, downloads, belly, file, feeder: new Feeder(path.join(root, 'feed-log.json')) };
}

test('吃掉：挪进肚子里按月份放好；重名加 (2)', () => {
  const { belly, file, feeder } = setup();
  fs.mkdirSync(path.join(belly, monthKey()), { recursive: true });
  fs.writeFileSync(path.join(belly, monthKey(), 'a.txt'), 'old');
  const a = file('a.txt');
  const r = feeder.eat([a], belly);
  assert.equal(r.eaten.length, 1);
  assert.ok(!fs.existsSync(a));
  assert.equal(path.basename(r.eaten[0].to), 'a (2).txt');
  assert.equal(fs.readFileSync(r.eaten[0].to, 'utf8'), 'a.txt');
});

test('不吃：文件夹、不存在的、已经在肚子里的', () => {
  const { downloads, belly, feeder } = setup();
  const inBelly = path.join(belly, 'x.txt');
  fs.mkdirSync(belly, { recursive: true });
  fs.writeFileSync(inBelly, 'x');
  const r = feeder.eat([downloads, path.join(downloads, 'gone.txt'), inBelly], belly);
  assert.equal(r.eaten.length, 0);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['folder', 'missing', 'already']);
  assert.equal(feeder.lastBite(), null);
});

test('吐出来：放回原处；原处已经有同名文件的留在肚子里，下次还能再吐', () => {
  const { file, belly, feeder, root } = setup();
  const a = file('a.txt');
  const b = file('b.txt');
  feeder.eat([a, b], belly);
  fs.writeFileSync(b, 'someone made a new b'); // 原处又有了 b.txt
  const r = feeder.spit();
  assert.deepEqual(r, { restored: 1, kept: 1 });
  assert.equal(fs.readFileSync(a, 'utf8'), 'a.txt');
  assert.equal(feeder.lastBite().files.length, 1);
  // 记录存盘了，重新打开还在
  const again = new Feeder(path.join(root, 'feed-log.json'));
  assert.equal(again.lastBite().files.length, 1);
  assert.ok(!fs.existsSync(path.join(root, 'feed-log.json.tmp')));
});

test('下载文件夹乱不乱：没下完的、desktop.ini、Office 临时文件不算', () => {
  const { downloads, file } = setup();
  file('a.zip');
  file('b.pdf');
  file('c.crdownload');
  file('desktop.ini');
  file('~$report.docx');
  fs.mkdirSync(path.join(downloads, 'folder'));
  assert.equal(looseFiles(downloads), 2);
  assert.equal(looseFiles(path.join(downloads, 'nope')), 0);
});
