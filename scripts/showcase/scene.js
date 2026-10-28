// 在覆盖层页面里执行：纯色背景 + 一条看不见的"桌面" + 上方字幕，然后按剧本发 Claude Code 事件。最后一个表达式是总时长
(() => {
  const BG = '#22252D';
  const FLOOR = world.width > world.height ? 0.8 : 0.66; // 桌面在画面高度的哪里（横屏放低，给头顶的牌子和气泡留地方）
  document.body.style.background = BG;
  previewWindows.length = 0;
  const fy = Math.round(world.height * FLOOR);
  world.setPlatforms([{ id: 'desk', x1: -50, x2: world.width + 50, y: fy, wx: 0 }], []);
  world.userAway = false;
  world.timeOfDay = true;
  world.dayPart = () => 'day'; // 不管录的时候几点，都当白天（不说"早点睡"、不打瞌睡）
  world.holidays = false; // 先不穿节日装扮，后面专门展示
  world.outfitChosen = {};
  world.refreshOutfit();
  world.scale = 7;
  setInterval(() => { world.userAway = false; for (const p of world.pets) if (p.mode === 'sleep') p.mode = 'idle'; }, 500);

  const css = document.createElement('style');
  css.textContent = `
    #sc-floor { position: fixed; left: 0; right: 0; top: ${fy}px; bottom: 0; background: linear-gradient(#2C3039, ${BG}); border-top: 1px solid #3A3F4B; }
    #sc-top { transition: opacity .4s; position: fixed; left: 0; right: 0; top: 5%; text-align: center; color: #F4EFE6; font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
    #sc-top h1 { margin: 0; font-size: 24px; letter-spacing: 2px; }
    #sc-top p { margin: 6px 0 0; font-size: 10px; color: #A9AFBC; }
    #sc-cap { position: fixed; left: 0; right: 0; top: ${fy + 30}px; text-align: center; color: #F4EFE6; font: 600 14px "Microsoft YaHei UI", sans-serif; transition: opacity .25s; }
    #sc-cap small { display: block; margin-top: 4px; font-weight: 400; font-size: 9px; color: #8F96A3; }
    canvas { position: fixed; z-index: 2; }
  `;
  document.head.append(css);
  const floor = Object.assign(document.createElement('div'), { id: 'sc-floor' });
  const top = Object.assign(document.createElement('div'), { id: 'sc-top', innerHTML: '<h1>代码小章鱼</h1><p>Claude Code 的像素桌宠 · 开源 · MIT</p>' });
  const cap = Object.assign(document.createElement('div'), { id: 'sc-cap' });
  document.body.prepend(floor);
  document.body.append(top, cap);
  const say = (main, sub = '') => {
    cap.style.opacity = 0;
    setTimeout(() => {
      cap.innerHTML = main + (sub ? `<small>${sub}</small>` : '');
      cap.style.opacity = 1;
    }, 250);
  };

  // 把预览里自己生成的那只放到中间
  const p0 = world.pets[0];
  if (p0) {
    p0.x = world.width / 2;
    p0.y = -40;
    p0.mode = 'air';
    p0.vx = 0;
    p0.vy = 0;
  }

  const sid = 'show';
  const mine = () => world.pets.find((p) => p.sessionId === sid) || world.pets[0];
  const e = (event, extra = {}) => world.onClaudeEvent({ event, sessionId: sid, project: 'my-app', ...extra });
  const wear = (outfit) => {
    world.holidays = false;
    world.outfitChosen = outfit;
    world.refreshOutfit();
  };
  const season = (s) => {
    OUTFITS.season = () => s;
    world.seasonTick();
    setTimeout(() => world.seasonTick(), 700);
    setTimeout(() => world.seasonTick(), 1400);
  };
  const steps = [
    [300, () => say('Claude Code 干活，它也干活')],
    [600, () => e('SessionStart', { model: 'claude-opus-5-5' })],
    [1500, () => e('UserPromptSubmit', { text: '帮我加一个深色模式' })],
    [1600, () => say('想事情的时候', '托腮、望天、挠头')],
    [5200, () => { say('改代码：从身后掏出笔记本'); e('PreToolUse', { tool: 'Edit', toolKind: 'edit', detail: 'theme.css' }); }],
    [9200, () => { say('读代码：换上放大镜'); e('PreToolUse', { tool: 'Read', toolKind: 'read', detail: 'App.tsx' }); }],
    [12000, () => { say('上网查资料：竖起天线'); e('PreToolUse', { tool: 'WebSearch', toolKind: 'web', detail: 'prefers-color-scheme' }); }],
    [14800, () => { say('派出子代理：叫来小帮手'); e('PreToolUse', { tool: 'Agent', toolKind: 'agent', detail: '检查所有组件' }); e('SubagentStart', { agentId: 'a1', agentType: 'Explore' }); }],
    [15400, () => e('SubagentStart', { agentId: 'a2', agentType: 'Plan' })],
    [18600, () => { e('SubagentStop', { agentId: 'a1' }); e('SubagentStop', { agentId: 'a2' }); }],
    [19200, () => { say('跑测试'); e('PreToolUse', { tool: 'Bash', toolKind: 'shell', detail: 'npm test' }); }],
    [21800, () => e('PostToolUse', { tool: 'Bash', toolKind: 'shell', test: 'pass' })],
    [23200, () => { say('需要你批准时，举着牌子来找你', '气泡里直接点「允许」'); e('PermissionRequest', { tool: 'Bash', toolKind: 'shell', detail: 'git push' }); }],
    [23300, () => (top.style.opacity = 0)],
    [24400, () => { const p = mine(); if (p) p.askPermission({ id: 'demo', tool: 'Bash', detail: 'git push' }); }],
    // 鼠标移到「允许」上（按钮亮起来），然后点下去
    [27600, () => { const b = (mine() && mine().buttonRects || [])[0]; if (b) world.mouse = { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 }; }],
    [28800, () => { const p = mine(); if (p) p.decide('allow'); world.mouse = null; }],
    [30000, () => (top.style.opacity = 1)],
    [35800, () => world.summon()],
    [46600, () => world.summon()],
    [29500, () => e('PreToolUse', { tool: 'Bash', toolKind: 'shell', detail: 'git push' })],
    [31000, () => { say('做完了，告诉你结果'); e('Stop', { text: '深色模式加好了，测试全部通过。' }); }],
    [36500, () => say('12 个成就，解锁装扮', '皇冠 · 礼帽 · 耳机 · 墨镜……')],
    [37000, () => wear({ head: 'crown' })],
    [38000, () => wear({ head: 'tophat', neck: 'bowtie' })],
    [39000, () => wear({ head: 'headphones', face: 'sunglasses' })],
    [40000, () => wear({ head: 'chefhat' })],
    [41200, () => say('按电脑日期自动过节', '春节 · 端午 · 中秋 · 1024 · 万圣节 · 圣诞')],
    [41500, () => wear({ neck: 'scarfRed' })],
    [42400, () => wear({ head: 'zongzi' })],
    [43300, () => wear({ head: 'bunnyears' })],
    [44200, () => wear({ neck: 'plaid', face: 'glasses' })],
    [45100, () => wear({ head: 'pumpkin' })],
    [46000, () => wear({ head: 'santa' })],
    [47200, () => { say('四季也会变', '春花 · 秋叶 · 冬雪'); wear({ head: 'flower' }); season('spring'); }],
    [49600, () => { wear({ head: 'mapleleaf' }); season('autumn'); }],
    [52000, () => { wear({ head: 'earmuffs', neck: 'scarf' }); season('winter'); }],
    [55000, () => say('github.com/xiaobai1556/code-octopus', '免费开源 · Windows')],
  ];
  steps.forEach(([ms, fn]) => setTimeout(fn, ms));
  return 59000;
})();
