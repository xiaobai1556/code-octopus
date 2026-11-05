const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18N = require('../src/i18n');

const langs = Object.keys(I18N.STRINGS);
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

test('每种语言都有界面上的每一句，NAMES 和 STRINGS 对得上', () => {
  assert.deepEqual(Object.keys(I18N.NAMES).sort(), langs.slice().sort());
  const all = new Set(langs.flatMap((l) => Object.keys(I18N.STRINGS[l])));
  for (const l of langs) {
    const missing = [...all].filter((k) => !(k in I18N.STRINGS[l]));
    assert.deepEqual(missing, [], `${l} 缺这些`);
  }
});

test('占位符和简体中文一致（不然 {n} 之类的会原样显示出来）', () => {
  const ref = I18N.STRINGS['zh-CN'];
  for (const l of langs) {
    for (const [k, v] of Object.entries(I18N.STRINGS[l])) assert.equal(placeholders(v), placeholders(ref[k]), `${l} ${k}`);
  }
});

test('代码里用到的键都有定义', () => {
  const root = path.join(__dirname, '..');
  const files = ['main.js', ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`), ...fs.readdirSync(path.join(root, 'renderer')).map((f) => `renderer/${f}`)].filter(
    (f) => /\.(js|html)$/.test(f) && f !== 'src/i18n.js'
  );
  const used = new Set();
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/\b(?:tr|I18N\.t)\(\s*'([\w.-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-t="([\w.-]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 100);
  const undefinedKeys = [...used].filter((k) => !(k in I18N.STRINGS.en));
  assert.deepEqual(undefinedKeys, []);
});

test('按系统语言挑：繁体、日文、英文，都不支持就英文', () => {
  assert.equal(I18N.detect(['zh-Hans-CN']), 'zh-CN');
  assert.equal(I18N.detect(['zh-Hant-TW']), 'zh-TW');
  assert.equal(I18N.detect(['zh-HK']), 'zh-TW');
  assert.equal(I18N.detect(['ja-JP', 'en-US']), 'ja');
  assert.equal(I18N.detect(['fr-FR', 'en-GB']), 'en');
  assert.equal(I18N.detect(['ko-KR']), 'en');
  assert.equal(I18N.detect([]), 'en');
});

test('t：填占位符，缺的键回落到英文再回落到键名', () => {
  I18N.setLang('zh-CN');
  assert.equal(I18N.t('note.label', { n: 3 }), '便签 3');
  assert.equal(I18N.t('no.such.key'), 'no.such.key');
  I18N.setLang('en');
});
