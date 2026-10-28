// 找到某个 Claude Code 会话所在的窗口，以及把它切到最前面。只在 Windows 上工作。
//
// 思路：hook 是 Claude Code 起的 curl 进程发来的。收到请求时按对方的端口在本机 TCP 连接表里查出 curl 的 PID，
// 再顺着父进程往上找（curl → Claude Code → shell → 终端 / 编辑器 / Claude 应用），
// 第一个拥有可见窗口的祖先就是这个会话所在的窗口。
let api = null;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const iphlpapi = koffi.load('iphlpapi.dll');

    const PROCESSENTRY32W = koffi.struct('PET_PROCESSENTRY32W', {
      dwSize: 'uint32_t',
      cntUsage: 'uint32_t',
      th32ProcessID: 'uint32_t',
      th32DefaultHeapID: 'uintptr_t',
      th32ModuleID: 'uint32_t',
      cntThreads: 'uint32_t',
      th32ParentProcessID: 'uint32_t',
      pcPriClassBase: 'int32_t',
      dwFlags: 'uint32_t',
      szExeFile: koffi.array('char16_t', 260, 'String'),
    });
    koffi.struct('PET_PROC_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    koffi.proto('bool __stdcall PetProcEnumProc(uintptr_t hwnd, intptr_t lParam)');

    api = {
      koffi,
      PROCESSENTRY32W,
      GetExtendedTcpTable: iphlpapi.func('uint32_t __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32_t *size, bool order, uint32_t af, int tableClass, uint32_t reserved)'),
      CreateToolhelp32Snapshot: kernel32.func('uintptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
      Process32FirstW: kernel32.func('bool __stdcall Process32FirstW(uintptr_t snap, _Inout_ PET_PROCESSENTRY32W *entry)'),
      Process32NextW: kernel32.func('bool __stdcall Process32NextW(uintptr_t snap, _Inout_ PET_PROCESSENTRY32W *entry)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(uintptr_t h)'),
      GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(PetProcEnumProc *cb, intptr_t lParam)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)'),
      IsWindow: user32.func('bool __stdcall IsWindow(uintptr_t hwnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(uintptr_t hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(uintptr_t hwnd)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ PET_PROC_RECT *rect)'),
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(uintptr_t hwnd)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(uintptr_t hwnd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(uintptr_t hwnd, int cmd)'),
      AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32_t from, uint32_t to, bool attach)'),
    };
  } catch (err) {
    console.error('[claude-pet] 无法加载进程 / 窗口接口：', err.message);
    api = false;
  }
  return api;
}

const AF_INET = 2;
const TCP_TABLE_OWNER_PID_ALL = 5;
const ERROR_INSUFFICIENT_BUFFER = 122;
const TH32CS_SNAPPROCESS = 0x2;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const SW_RESTORE = 9;
// 顺着父进程找窗口时到这些进程就停：它们的窗口（桌面、任务栏）不是会话窗口
const STOP_AT = new Set(['explorer.exe', 'sihost.exe', 'svchost.exe', 'services.exe', 'wininit.exe', 'winlogon.exe', 'system']);

const ntohs = (v) => ((v & 0xff) << 8) | ((v >> 8) & 0xff);

/** 本机 TCP 连接里，本地端口是 localPort、远端端口是 remotePort 的那个连接属于哪个进程 */
function tcpOwnerPid(localPort, remotePort) {
  const w = load();
  if (!w) return 0;
  const size = [64 * 1024];
  let buf = Buffer.alloc(size[0]);
  let r = w.GetExtendedTcpTable(buf, size, false, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
  for (let i = 0; i < 3 && r === ERROR_INSUFFICIENT_BUFFER; i++) {
    buf = Buffer.alloc(size[0] + 4096);
    size[0] = buf.length;
    r = w.GetExtendedTcpTable(buf, size, false, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
  }
  if (r !== 0) return 0;
  // MIB_TCPTABLE_OWNER_PID：条数 + 每行 6 个 DWORD（状态、本地地址、本地端口、远端地址、远端端口、PID）
  const n = buf.readUInt32LE(0);
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 24;
    if (o + 24 > buf.length) break;
    if (ntohs(buf.readUInt32LE(o + 8)) === localPort && ntohs(buf.readUInt32LE(o + 16)) === remotePort) return buf.readUInt32LE(o + 20);
  }
  return 0;
}

/** pid → { ppid, exe } */
function processMap() {
  const w = load();
  const map = new Map();
  if (!w) return map;
  const snap = w.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || Number(snap) === -1 || snap === 0xffffffffffffffffn) return map;
  try {
    const entry = { dwSize: w.koffi.sizeof(w.PROCESSENTRY32W) };
    let ok = w.Process32FirstW(snap, entry);
    while (ok) {
      map.set(entry.th32ProcessID, { ppid: entry.th32ParentProcessID, exe: String(entry.szExeFile || '').toLowerCase() });
      entry.dwSize = w.koffi.sizeof(w.PROCESSENTRY32W);
      ok = w.Process32NextW(snap, entry);
    }
  } finally {
    w.CloseHandle(snap);
  }
  return map;
}

/** 某个进程拥有的可见顶层窗口里最大的那个 */
function mainWindowOf(pid) {
  const w = load();
  if (!w) return 0;
  let best = 0;
  let bestArea = 0;
  const owner = [0];
  w.EnumWindows((hwnd) => {
    w.GetWindowThreadProcessId(hwnd, owner);
    if (owner[0] !== pid || !w.IsWindowVisible(hwnd) || w.GetWindowTextLengthW(hwnd) === 0) return true;
    if (Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return true;
    const r = {};
    if (!w.GetWindowRect(hwnd, r)) return true;
    const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top));
    if (area > bestArea) {
      best = Number(hwnd);
      bestArea = area;
    }
    return true;
  }, 0);
  return best;
}

/** 从发 hook 的 curl 进程出发，顺着父进程往上，找第一个有窗口的祖先 */
function findWindowForPid(startPid, excludePid = process.pid) {
  const procs = processMap();
  let pid = startPid;
  for (let depth = 0; depth < 14 && pid; depth++) {
    const p = procs.get(pid);
    if (!p) break;
    if (STOP_AT.has(p.exe)) break;
    if (pid !== startPid && pid !== excludePid) {
      const hwnd = mainWindowOf(pid);
      if (hwnd) return { hwnd, pid, exe: p.exe };
    }
    if (p.ppid === pid) break;
    pid = p.ppid;
  }
  return null;
}

/** 窗口的屏幕矩形（物理像素） */
function windowRect(hwnd) {
  const w = load();
  const r = {};
  if (!w || !hwnd || !w.GetWindowRect(hwnd, r)) return null;
  return { l: r.left, t: r.top, r: r.right, b: r.bottom };
}

function isWindow(hwnd) {
  const w = load();
  return !!(w && hwnd && w.IsWindow(hwnd));
}

function foregroundWindow() {
  const w = load();
  return w ? Number(w.GetForegroundWindow()) : 0;
}

/** 把窗口切到最前面（最小化的先还原）。普通方式不让切时，临时挂到当前前台窗口的输入队列上再切 */
function focusWindow(hwnd) {
  const w = load();
  if (!w || !hwnd || !w.IsWindow(hwnd)) return false;
  if (w.IsIconic(hwnd)) w.ShowWindow(hwnd, SW_RESTORE);
  if (w.SetForegroundWindow(hwnd)) return true;
  const fg = w.GetForegroundWindow();
  const fgThread = fg ? w.GetWindowThreadProcessId(fg, [0]) : 0;
  const me = w.GetCurrentThreadId();
  if (!fgThread || fgThread === me) return false;
  w.AttachThreadInput(me, fgThread, true);
  try {
    w.BringWindowToTop(hwnd);
    return w.SetForegroundWindow(hwnd);
  } finally {
    w.AttachThreadInput(me, fgThread, false);
  }
}

module.exports = { tcpOwnerPid, processMap, findWindowForPid, windowRect, isWindow, foregroundWindow, focusWindow };
