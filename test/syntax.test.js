// 所有源码都能解析：主进程、预加载、渲染进程的脚本单元测试不一定会加载到（比如 main.js），
// 重复声明、少个括号这种错这里先拦下来，不用等启动才发现
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')),
  ...['src', 'renderer', 'scripts'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`)),
];

test('所有源码文件都能解析', () => {
  assert.ok(files.includes('main.js'));
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(`(function () {\n${code}\n})`, { filename: f }), `${f} 解析不了`);
  }
});

test('浏览器里一起加载的脚本之间没有重名的顶层 const / let / class', () => {
  // 同一个页面里的几个 <script> 共用全局作用域，顶层重名会让后加载的那个直接报错
  for (const page of ['index.html', 'arcade.html', 'settings.html', 'report.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', page), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.join(ROOT, 'renderer', m[1]));
    const seen = new Map();
    for (const file of scripts) {
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = m[1];
        assert.ok(!seen.has(name), `${page}：${path.basename(file)} 和 ${seen.get(name)} 都在顶层声明了 ${name}`);
        seen.set(name, path.basename(file));
      }
    }
  }
});
