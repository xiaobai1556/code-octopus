// 什么时候该提醒：休息提醒、花费提醒、/octopus 的今日小结。只算"该不该""说什么"，发给哪块屏由 main.js 管。

// 休息提醒：连着在电脑前 minutes 分钟（workSince 起算，离开过就会被重置）。
// 到点了返回 'remind'（该提醒）或 'skip'（到点了但现在不方便：免打扰、番茄钟、全屏），没到点返回 null
function breakDue({ now, workSince, enabled, minutes = 60, quiet = false, pomodoro = false, hidden = false }) {
  if (!enabled || now - workSince < minutes * 60000) return null;
  return quiet || pomodoro || hidden ? 'skip' : 'remind';
}

// 花费提醒：当天第一次超过 limit（0 是关）；提醒过了、免打扰时段里都不说
function costDue(day, limit, quiet = false) {
  return !!limit && !!day && !day.costAlerted && (day.costUSD || 0) >= limit && !quiet;
}

// /octopus 的今日小结（给 Claude 读的 JSON）。day 是 stats 里今天那一天（可能是 null），level 是 LEVEL.levelOf 的结果
function todaySummary({ date, day, level, title, language }) {
  const d = day || {};
  const busyMs = d.busyMs || 0;
  return {
    app: 'code-octopus',
    date,
    busy: `${Math.floor(busyMs / 3600000)}h ${Math.round((busyMs % 3600000) / 60000)}m`,
    messages: d.prompts || 0,
    toolCalls: d.toolCount || 0,
    testsPassed: (d.tests && d.tests.pass) || 0,
    testsFailed: (d.tests && d.tests.fail) || 0,
    commits: d.commits || 0,
    pushes: d.pushes || 0,
    lastCommits: (d.commitLog || []).slice(-3).map((c) => c.text).filter(Boolean),
    costUSD: Math.round((d.costUSD || 0) * 100) / 100,
    level: level.level,
    title,
    xp: `${level.xp} / ${level.next}`,
    language,
  };
}

module.exports = { breakDue, costDue, todaySummary };
