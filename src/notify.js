// 全屏看视频、玩游戏时小章鱼会躲起来（见 main.js 的 scanOverlay）。这时 Claude 要你批准、问你问题、
// 计划写好了、长任务做完了，你是看不到的：改用系统通知提醒，点通知回到那个会话。
// 这里只管"要不要弹、写什么"，弹通知的是主进程。
const COOLDOWN_MS = 20 * 1000; // 同一个会话、同一种事 20 秒内只弹一次（权限请求和随后的 Notification 事件是同一件事）

// 这个事件值不值得弹通知：approve 要你批准 / question 问你问题 / plan 计划等你确认 / done 长任务做完了
function toastKind(ev) {
  if (!ev) return null;
  if (ev.event === 'PermissionRequest' || (ev.event === 'Notification' && ev.notify === 'permission')) return 'approve';
  if (ev.event === 'PreToolUse' && ev.decision) return ev.decision === 'plan' ? 'plan' : 'question';
  if (ev.event === 'Notification' && ev.notify === 'input') return 'question';
  if (ev.event === 'Stop' && ev.longTask) return 'done';
  return null;
}

/**
 * 要不要弹：返回 { kind, key }，不弹返回 null
 * enabled 设置里开着；hidden 这个会话的小章鱼所在的屏被全屏应用盖住了；watching 你正看着那个会话的窗口；
 * lastAt 每个 key 上次弹的时间
 */
function shouldToast(ev, { enabled, hidden, watching, lastAt = {}, now = Date.now() }) {
  if (!enabled || !hidden || watching) return null;
  const kind = toastKind(ev);
  if (!kind) return null;
  const key = `${ev.sessionId}:${kind}`;
  if (now - (lastAt[key] || 0) < COOLDOWN_MS) return null;
  return { kind, key };
}

// 用时：12 秒 / 4 分 12 秒 / 1 小时 5 分（文案在 i18n 的 time.*）
function fmtDuration(ms, tr) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return tr('time.s', { s });
  if (s < 3600) return tr('time.ms', { m: Math.floor(s / 60), s: s % 60 });
  return tr('time.hm', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}

// 标题写谁、什么事；正文写要批准的命令 / 问的问题 / 做完后的总结
function toastText(ev, kind, tr) {
  const project = ev.project || tr('app.name');
  const title = tr(`notify.${kind}`, { project, time: fmtDuration(ev.turnMs, tr) });
  const body = kind === 'approve' ? [ev.tool, ev.detail && ev.detail !== ev.tool ? ev.detail : ''].filter(Boolean).join(' · ') : ev.text || '';
  return { title, body: body.length > 200 ? body.slice(0, 199) + '…' : body };
}

module.exports = { toastKind, shouldToast, toastText, fmtDuration, COOLDOWN_MS };
