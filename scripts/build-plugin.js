// 由 src/hooks.js 生成插件的 hooks/hooks.json，保证两种接入方式发出的 hook 完全一样
const fs = require('fs');
const path = require('path');
const { withHooks } = require('../src/hooks');

const out = path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(withHooks({}, 23333, 'claude-pet-plugin'), null, 2) + '\n');
console.log('wrote', path.relative(process.cwd(), out));
