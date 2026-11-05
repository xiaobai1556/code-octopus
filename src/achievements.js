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
  { id: 'dailyfan', item: 'medal', goal: 7, value: (s) => arcade(s, 'daily', 'streak') }, // 今日挑战连续玩 7 天
  // 章鱼游戏厅：每个游戏一个（game 是哪个游戏，游戏厅的规则页会显示它）
  { id: 'debugger', game: 'bugs', item: 'bugclip', goal: 8, value: (s) => arcade(s, 'bugs', 'level') }, // 捉虫打到第 8 轮迭代
  { id: 'climber', game: 'hop', item: 'goggles', goal: 300, value: (s) => arcade(s, 'hop', 'meters') }, // 窗口跳跳到 300 米
  { id: 'gatekeeper', game: 'approve', item: 'shield', goal: 20, value: (s) => arcade(s, 'approve', 'streak') }, // 批准还是拒绝连对 20 条
  { id: 'guardian', game: 'defense', item: 'hardhat', goal: 15, value: (s) => arcade(s, 'defense', 'waves') }, // 塔防守住 15 波
  { id: 'typist', game: 'typing', item: 'visor', goal: 40, value: (s) => arcade(s, 'typing', 'wpm') }, // 敲代码 40 WPM
  { id: 'deepstack', game: 'stack', item: 'monocle', goal: 30, value: (s) => arcade(s, 'stack', 'depth') }, // 调用栈叠到 30 层
  { id: 'firefighter', game: 'whack', item: 'firehelmet', goal: 65, value: (s) => arcade(s, 'whack', 'fixed') }, // 热修复一局修 65 个
];

// 游戏厅里最好的一次（stats.data.arcade，见 Stats.recordArcade）
function arcade(s, game, key) {
  return (s.arcade && s.arcade[game] && s.arcade[game][key]) || 0;
}

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
  return LIST.map((a) => ({ id: a.id, game: a.game || null, item: a.item, goal: a.goal, value: Math.min(a.goal, a.value(d) || 0), unlockedAt: d.unlocked[a.id] || null }));
}

const unlockedItems = (stats) => new Set(LIST.filter((a) => stats.data.unlocked[a.id]).map((a) => a.item));

module.exports = { LIST, byId, evaluate, progress, unlockedItems };
