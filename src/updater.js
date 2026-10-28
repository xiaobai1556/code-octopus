// 自动更新：打包后的版本从 GitHub Releases 检查新版本、后台下载，下次退出时安装。
// 发布到哪个仓库写在 release.json 里；还是占位符时整个功能关闭（不会去一个不确定是谁的仓库下载程序）。
const { app } = require('electron');
const release = require('./release.json');

const PLACEHOLDER = 'YOUR_GITHUB_NAME';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let updater = null;
let timer = null;
let status = { state: 'idle', version: '', percent: 0, error: '' };
let listener = () => {};

const configured = () => !!(release.owner && release.owner !== PLACEHOLDER && release.repo);

function setStatus(patch) {
  status = { ...status, ...patch };
  listener(status);
}

// state：dev 没打包 / unconfigured 没配发布地址 / off 关了 / idle / checking / latest / downloading / ready / error
function init(enabled, onChange) {
  listener = onChange || listener;
  if (!app.isPackaged) return setStatus({ state: 'dev' });
  if (!configured()) return setStatus({ state: 'unconfigured' });
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    return setStatus({ state: 'error', error: err.message });
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.setFeedURL({ provider: 'github', owner: release.owner, repo: release.repo });
  updater.on('checking-for-update', () => setStatus({ state: 'checking', error: '' }));
  updater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  updater.on('update-not-available', () => setStatus({ state: 'latest' }));
  updater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
  updater.on('error', (err) => setStatus({ state: 'error', error: String((err && err.message) || err).split('\n')[0] }));
  setEnabled(enabled);
}

function setEnabled(on) {
  clearInterval(timer);
  timer = null;
  if (!updater) return;
  if (!on) {
    updater.autoDownload = false;
    if (status.state !== 'ready') setStatus({ state: 'off' });
    return;
  }
  updater.autoDownload = true;
  if (status.state === 'off') setStatus({ state: 'idle' });
  setTimeout(check, 30 * 1000);
  timer = setInterval(check, CHECK_EVERY_MS);
}

function check() {
  if (!updater || status.state === 'ready' || status.state === 'downloading') return;
  updater.checkForUpdates().catch(() => {});
}

function install() {
  if (updater && status.state === 'ready') updater.quitAndInstall();
}

module.exports = { init, setEnabled, check, install, status: () => status, configured };
