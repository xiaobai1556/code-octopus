// 成就：按 stats.json 里的累计数字判断，解锁一个送一件装扮（见 src/outfits.js）。
// value(stats) 读当前进度，到 goal 就解锁；解锁时间记在 stats.data.unlocked 里。
const LIST = [
  { id: 'hello', item: 'bowtie', goal: 1, value: (s) => s.totals.sessions }, // 第一次见面
  { id: 'green', item: 'glasses', goal: 1, value: (s) => s.totals.testsPass }, // 第一次测试通过
  { id: 'regular', item: 'scarf', goal: 100, value: (s) => s.totals.prompts }, // 发出 100 条消息
  { id: 'busy', item: 'headphones', goal: 500, value: (s) => s.best.dayTools }, // 一天调用 500 次工具
  { id: 'streak', item: 'crown', goal: 7, value: (s) => s.best.streak }, // 连续 7 天
  { id: 'marathon', item: 'headband', goal: 30, value: (s) => Math.floor(s.best.turnMs / 60000) }, // 一轮跑了 30 分钟
  { id: 'owl', item: 'nightcap', goal: 1, value: (s) => s.totals.lateNight }, // 凌晨 0~4 点还在干活
  { id: 'early', item: 'sprout', goal: 1, value: (s) => s.totals.earlyMorning }, // 早上 5~7 点就开工
  { id: 'boss', item: 'cap', goal: 50, value: (s) => s.totals.helpers }, // 派出 50 个小助手
  { id: 'coder', item: 'tophat', goal: 300, value: (s) => s.totals.edits }, // 改了 300 次代码
  { id: 'veteran', item: 'sunglasses', goal: 50, value: (s) => s.totals.done }, // 做完 50 轮
  { id: 'foodie', item: 'chefhat', goal: 10, value: (s) => s.totals.eaten }, // 喂它吃 10 个文件
];

const byId = Object.fromEntries(LIST.map((a) => [a.id, a]));

// 新解锁的成就 id（顺便记下解锁时间）
function evaluate(stats) {
  const d = stats.data;
  const fresh = [];
  for (const a of LIST) {
    if (d.unlocked[a.id] || a.value(d) < a.goal) continue;
    d.unlocked[a.id] = new Date().toISOString();
    fresh.push(a.id);
  }
  if (fresh.length) stats.scheduleSave();
  return fresh;
}

// 设置面板里的成就列表
function progress(stats) {
  const d = stats.data;
  return LIST.map((a) => ({ id: a.id, item: a.item, goal: a.goal, value: Math.min(a.goal, a.value(d) || 0), unlockedAt: d.unlocked[a.id] || null }));
}

const unlockedItems = (stats) => new Set(LIST.filter((a) => stats.data.unlocked[a.id]).map((a) => a.item));

module.exports = { LIST, byId, evaluate, progress, unlockedItems };
