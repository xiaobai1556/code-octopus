// 打包配置：npm run dist 生成 Windows 安装包（在 dist/ 里）。
// 自动更新从 GitHub Releases 拿新版本，仓库写在 src/release.json；还是占位符时不写发布配置，打出来的包也不会检查更新。
const release = require('./src/release.json');

const publishable = release.owner && release.owner !== 'YOUR_GITHUB_NAME';

module.exports = {
  appId: 'io.github.code-octopus',
  productName: 'Code Octopus',
  executableName: 'code-octopus',
  copyright: 'Copyright (c) 2026 xiaobai1556. MIT License. Unofficial fan project, not affiliated with or endorsed by Anthropic.',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['main.js', 'preload.js', 'settings-preload.js', 'report-preload.js', 'note-preload.js', 'src/**', 'renderer/**', '!renderer/_*', 'package.json'],
  // claude 命令行读不到 asar 里面的文件，插件市场单独放在外面
  extraResources: [
    { from: '.claude-plugin', to: 'marketplace/.claude-plugin' },
    { from: 'plugin', to: 'marketplace/plugin' },
  ],
  // koffi 的原生模块不能放在 asar 里
  asarUnpack: ['node_modules/koffi/**', 'node_modules/@koromix/**'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'Code-Octopus-Setup-${version}.${ext}',
    shortcutName: '代码小章鱼',
    uninstallDisplayName: 'Code Octopus 代码小章鱼 (unofficial) ${version}',
  },
  publish: publishable ? [{ provider: 'github', owner: release.owner, repo: release.repo }] : null,
};
