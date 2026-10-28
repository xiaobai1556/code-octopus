// 枚举桌面上可见的顶层窗口（按 Z 序从上到下），给桌宠当"地形"用。
// 只在 Windows 上工作；其他平台返回空列表，桌宠就只在屏幕底部活动。
let api = null;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const winmm = koffi.load('winmm.dll');

    const RECT = koffi.struct('PET_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const EnumProc = koffi.proto('bool __stdcall PetEnumProc(uintptr_t hwnd, intptr_t lParam)');
    const WinEventProc = koffi.proto(
      'void __stdcall PetWinEventProc(uintptr_t hook, uint32_t event, uintptr_t hwnd, int32_t idObject, int32_t idChild, uint32_t thread, uint32_t time)'
    );

    api = {
      koffi,
      WinEventProc,
      SetWinEventHook: user32.func(
        'uintptr_t __stdcall SetWinEventHook(uint32_t eventMin, uint32_t eventMax, uintptr_t hmod, PetWinEventProc *proc, uint32_t pid, uint32_t tid, uint32_t flags)'
      ),
      UnhookWinEvent: user32.func('bool __stdcall UnhookWinEvent(uintptr_t hook)'),
      GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      timeBeginPeriod: winmm.func('uint32_t __stdcall timeBeginPeriod(uint32_t ms)'),
      timeEndPeriod: winmm.func('uint32_t __stdcall timeEndPeriod(uint32_t ms)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(PetEnumProc *cb, intptr_t lParam)'),
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(uintptr_t hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(uintptr_t hwnd)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ uint8_t *buf, int max)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ PET_RECT *rect)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(uintptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
      DwmGetRect: dwmapi.func('DwmGetWindowAttribute', 'int32_t', ['uintptr_t', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']),
      DwmGetInt: dwmapi.func('DwmGetWindowAttribute', 'int32_t', ['uintptr_t', 'uint32_t', koffi.out(koffi.pointer('int32_t')), 'uint32_t']),
    };
  } catch (err) {
    console.error('[claude-pet] 无法加载 win32 接口，窗口地形功能关闭：', err.message);
    api = false;
  }
  return api;
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_TRANSPARENT = 0x20;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

const classBuf = Buffer.alloc(512);

/** @returns {{id:number,l:number,t:number,r:number,b:number}[]} 物理像素坐标，Z 序从上到下 */
function listWindows(excludeIds = []) {
  const w = load();
  if (!w) return [];
  const hwnds = [];
  w.EnumWindows((hwnd) => { hwnds.push(hwnd); return true; }, 0);

  const out = [];
  for (const raw of hwnds) {
    const id = Number(raw);
    if (excludeIds.includes(id)) continue;
    if (!w.IsWindowVisible(raw) || w.IsIconic(raw)) continue;
    if (w.GetWindowTextLengthW(raw) === 0) continue;
    const ex = Number(w.GetWindowLongPtrW(raw, GWL_EXSTYLE));
    if (ex & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT)) continue;
    const cloaked = [0];
    if (w.DwmGetInt(raw, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) continue;
    const n = w.GetClassNameW(raw, classBuf, 256);
    if (SKIP_CLASSES.has(classBuf.toString('utf16le', 0, n * 2))) continue;

    const rect = {};
    if (w.DwmGetRect(raw, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) !== 0 && !w.GetWindowRect(raw, rect)) continue;
    if (rect.right - rect.left < 120 || rect.bottom - rect.top < 60) continue;
    out.push({ id, l: rect.left, t: rect.top, r: rect.right, b: rect.bottom });
  }
  return out;
}

// 前台窗口是否盖住了整块屏幕（看视频、玩游戏）；桌面本身不算
function isFullscreenForeground(bounds, excludeIds = []) {
  const w = load();
  if (!w) return false;
  const raw = w.GetForegroundWindow();
  if (!raw || excludeIds.includes(Number(raw))) return false;
  const n = w.GetClassNameW(raw, classBuf, 256);
  if (SKIP_CLASSES.has(classBuf.toString('utf16le', 0, n * 2))) return false;
  const rect = {};
  if (!w.GetWindowRect(raw, rect)) return false;
  return rect.left <= bounds.x && rect.top <= bounds.y && rect.right >= bounds.x + bounds.width && rect.bottom >= bounds.y + bounds.height;
}

// 订阅"用户开始 / 结束拖动（或缩放）窗口"事件。一次拖动只触发两次，很安静。
// 不用 EVENT_OBJECT_LOCATIONCHANGE：鼠标指针每动一下也会触发它，高回报率鼠标下会把主进程淹没，
// 连带鼠标钩子变慢，拖窗口反而一顿一顿的。回调在主线程的消息循环里触发。返回取消订阅的函数。
const EVENT_SYSTEM_MOVESIZESTART = 0x000a;
const EVENT_SYSTEM_MOVESIZEEND = 0x000b;
const WINEVENT_SKIPOWNPROCESS = 0x2;

function onMoveSize(onStart, onEnd) {
  const w = load();
  if (!w) return () => {};
  const cb = w.koffi.register((_hook, event) => {
    if (event === EVENT_SYSTEM_MOVESIZESTART) onStart();
    else if (event === EVENT_SYSTEM_MOVESIZEEND) onEnd();
  }, w.koffi.pointer(w.WinEventProc));
  const hook = w.SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND, 0, cb, 0, 0, WINEVENT_SKIPOWNPROCESS);
  if (!hook) {
    w.koffi.unregister(cb);
    return () => {};
  }
  return () => {
    w.UnhookWinEvent(hook);
    w.koffi.unregister(cb);
  };
}

// 系统定时器默认精度约 15.6ms；窗口在动时临时提到 1ms，让 4ms 一次的扫描真的能做到
let highRes = false;
function setHighResTimer(on) {
  const w = load();
  if (!w || on === highRes) return;
  highRes = on;
  if (on) w.timeBeginPeriod(1);
  else w.timeEndPeriod(1);
}

// 鼠标主键 / 副键现在是不是按着（直接读系统的按键状态，不依赖窗口收到鼠标消息）。
// 系统设置里交换了左右键时，主键是物理右键
const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const SM_SWAPBUTTON = 23;

function mouseButtons() {
  const w = load();
  if (!w) return null;
  const down = (vk) => (w.GetAsyncKeyState(vk) & 0x8000) !== 0;
  const swapped = w.GetSystemMetrics(SM_SWAPBUTTON) !== 0;
  return swapped ? { primary: down(VK_RBUTTON), secondary: down(VK_LBUTTON) } : { primary: down(VK_LBUTTON), secondary: down(VK_RBUTTON) };
}

// 覆盖层虽然带着"置顶"标记，Windows 有时还是会把它排到普通窗口下面（别的程序抢置顶、全屏切换之后），
// 小章鱼就被窗口盖住了。从最上面往下找：在覆盖层之前出现了看得见的普通窗口，就算被压住了
const WS_EX_TOPMOST = 0x8;
function overlayBuried(hwnd) {
  const w = load();
  if (!w || !hwnd) return false;
  let buried = false;
  w.EnumWindows((raw) => {
    const id = Number(raw);
    if (id === hwnd) return false; // 到覆盖层了，前面没有压着它的
    if (!w.IsWindowVisible(raw) || w.IsIconic(raw)) return true;
    const ex = Number(w.GetWindowLongPtrW(raw, GWL_EXSTYLE));
    if (ex & (WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT)) return true;
    const cloaked = [0];
    if (w.DwmGetInt(raw, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true;
    const rect = {};
    if (!w.GetWindowRect(raw, rect) || rect.right - rect.left < 120 || rect.bottom - rect.top < 60) return true;
    buried = true;
    return false;
  }, 0);
  return buried;
}

// 重新提到置顶层最上面，不抢焦点
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;
function raiseTopmost(hwnd) {
  const w = load();
  return !!(w && hwnd && w.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER));
}

module.exports = { overlayBuried, raiseTopmost, listWindows, isFullscreenForeground, onMoveSize, setHighResTimer, mouseButtons };
