// 系统现在放出来的声音有多响（0~1），给"放歌它就跳舞"用。只在 Windows 上工作。
// 走的是 Core Audio：默认播放设备的 IAudioMeterInformation::GetPeakValue。只读音量电平，不录音、不拿到声音内容。
// 用 koffi 直接调 COM 接口的虚函数表；默认设备换了（插拔耳机）或者调用失败时重新获取。
let api = null;

const CLSCTX_ALL = 0x17;
const eRender = 0;
const eMultimedia = 1;

function guid(koffi, text) {
  const h = text.replace(/[{}-]/g, '');
  const b = Buffer.from(h.slice(16), 'hex');
  return { Data1: parseInt(h.slice(0, 8), 16), Data2: parseInt(h.slice(8, 12), 16), Data3: parseInt(h.slice(12, 16), 16), Data4: [...b] };
}

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const ole32 = koffi.load('ole32.dll');
    const GUID = koffi.struct('PET_GUID', { Data1: 'uint32_t', Data2: 'uint16_t', Data3: 'uint16_t', Data4: koffi.array('uint8_t', 8) });
    api = {
      koffi,
      CoInitializeEx: ole32.func('int32_t __stdcall CoInitializeEx(void *reserved, uint32_t coinit)'),
      CoCreateInstance: ole32.func('int32_t __stdcall CoCreateInstance(PET_GUID *clsid, void *outer, uint32_t ctx, PET_GUID *iid, _Out_ void **ppv)'),
      // 虚函数表里用到的几个方法（第一个参数都是 this）
      Release: koffi.proto('uint32_t __stdcall PetComRelease(void *self)'),
      GetDefaultAudioEndpoint: koffi.proto('int32_t __stdcall PetGetDefaultAudioEndpoint(void *self, int flow, int role, _Out_ void **device)'),
      Activate: koffi.proto('int32_t __stdcall PetMMDeviceActivate(void *self, PET_GUID *iid, uint32_t ctx, void *params, _Out_ void **iface)'),
      GetPeakValue: koffi.proto('int32_t __stdcall PetGetPeakValue(void *self, _Out_ float *peak)'),
      CLSID_MMDeviceEnumerator: guid(koffi, 'BCDE0395-E52F-467C-8E3D-C4579291692E'),
      IID_IMMDeviceEnumerator: guid(koffi, 'A95664D2-9614-4F35-A746-DE8DB63617E6'),
      IID_IAudioMeterInformation: guid(koffi, 'C02216F6-8C67-4B5B-9D00-D008E73E0064'),
    };
    void GUID;
    api.CoInitializeEx(null, 0); // 主进程里 COM 一般已经初始化过了，返回"模式不同"也没关系
  } catch (err) {
    console.error('[claude-pet] 无法加载音频接口，放歌跳舞功能关闭：', err.message);
    api = false;
  }
  return api;
}

// 第 index 个虚函数
function method(a, obj, index) {
  const vtbl = a.koffi.decode(obj, 'void *');
  return a.koffi.decode(vtbl, index * 8, 'void *');
}

const call = (a, obj, index, proto, ...args) => a.koffi.call(method(a, obj, index), proto, obj, ...args);

let meter = null;
let acquiredAt = 0;

function release(a, obj) {
  if (obj) call(a, obj, 2, a.Release);
}

function acquire(a) {
  const enumerator = [null];
  if (a.CoCreateInstance(a.CLSID_MMDeviceEnumerator, null, CLSCTX_ALL, a.IID_IMMDeviceEnumerator, enumerator) < 0 || !enumerator[0]) return null;
  const device = [null];
  // IMMDeviceEnumerator：3 EnumAudioEndpoints，4 GetDefaultAudioEndpoint
  const hr = call(a, enumerator[0], 4, a.GetDefaultAudioEndpoint, eRender, eMultimedia, device);
  release(a, enumerator[0]);
  if (hr < 0 || !device[0]) return null; // 没有播放设备
  const m = [null];
  // IMMDevice：3 Activate
  const hr2 = call(a, device[0], 3, a.Activate, a.IID_IAudioMeterInformation, CLSCTX_ALL, null, m);
  release(a, device[0]);
  return hr2 < 0 ? null : m[0];
}

/** 当前播放音量的峰值 0~1；拿不到就是 null */
function peak() {
  const a = load();
  if (!a) return null;
  try {
    // 每 10 秒重新拿一次默认设备，插拔耳机后才跟得上
    if (!meter || Date.now() - acquiredAt > 10000) {
      release(a, meter);
      meter = acquire(a);
      acquiredAt = Date.now();
    }
    if (!meter) return null;
    const v = [0];
    // IAudioMeterInformation：3 GetPeakValue
    if (call(a, meter, 3, a.GetPeakValue, v) < 0) {
      release(a, meter);
      meter = null;
      return null;
    }
    return v[0];
  } catch {
    meter = null;
    return null;
  }
}

module.exports = { peak };
