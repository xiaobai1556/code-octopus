// 录宣传动画：离屏打开桌宠的覆盖层页面（预览模式，没有主进程），纯色背景，按剧本发事件，
// 每 1/30 秒取一帧 JPEG 喂给 ffmpeg。用法：
//   npx electron scripts/showcase <out.mp4> <宽> <高> <缩放> [still.png]（需要 ffmpeg）
//   竖屏短视频：1080 1920 4；横屏：1920 1080 2
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('showcase')) + 1);
const [out, W = '1080', H = '1920', Z = '3', still] = args;
const FPS = 30;
app.commandLine.appendSwitch('lang', 'zh-CN');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: +W, height: +H, show: false, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: +Z, backgroundThrottling: false } });
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', (e) => { if (/error|Error/.test(e.message)) console.log('[page]', e.message); });
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => (latest = image));
  await win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 600));
  const script = fs.readFileSync(path.join(__dirname, 'scene.js'), 'utf8');
  const total = await win.webContents.executeJavaScript(script); // 返回剧本总时长（毫秒）
  win.webContents.invalidate();

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  let n = 0;
  let stillDone = false;
  await new Promise((done) => {
    const tick = () => {
      const el = Date.now() - t0;
      // 按真实时间补帧：落后了就把同一帧多写几次，保证视频时长和剧本一致
      while (n * (1000 / FPS) <= el) {
        if (latest) ff.stdin.write(latest.toJPEG(94));
        n++;
      }
      if (still && !stillDone && el > 15500 && latest) {
        fs.writeFileSync(still, latest.toPNG());
        stillDone = true;
      }
      if (el >= total) return done();
      setTimeout(tick, 5);
    };
    tick();
  });
  ff.stdin.end();
  ff.on('close', (code) => {
    console.log('frames', n, 'ffmpeg', code);
    app.exit(0);
  });
});
