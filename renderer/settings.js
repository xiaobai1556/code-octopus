// 设置面板：每秒向主进程要一次状态（小章鱼们、最近事件），插件状态只在打开和操作后查（要跑 claude 命令，比较慢）
const api = window.petSettings || mockApi();
const $ = (id) => document.getElementById(id);
const tr = (key, vars) => I18N.t(key, vars);

let state = null;
let pluginState = null; // null 表示还在检查
const busy = { plugin: false, hooks: false };
let intError = '';

// ---------- 像素小章鱼 ----------

function spriteCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  return dpr;
}

function paintPet(canvas, cssW, cssH, unit, palette, pose) {
  const dpr = spriteCanvas(canvas, cssW, cssH);
  const P = Math.max(1, Math.round(unit * dpr));
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  drawPet(g, canvas.width / 2, canvas.height - Math.round(dpr), P, palette, false, Object.assign({ t: 0 }, pose));
}

const paletteOf = (color) => PALETTES.find((p) => p.body === color) || { body: color };

// token 数：中文、日文用"万"，英文用 k / M
function fmtTokens(n) {
  if (n == null) return '?';
  if (/^(zh|ja)/.test(I18N.lang())) return n >= 1e4 ? `${+(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万` : String(n);
  return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

// 顶部的小章鱼：眨眼、呼吸、偶尔看看两边
let heroT = 0;
function animateHero() {
  heroT += 0.12;
  const blink = heroT % 3.6 < 0.15;
  const glance = Math.floor(heroT / 2.4) % 4;
  const palette = PALETTES[(state && state.config.color) || 0];
  const outfit = wornOutfit();
  const pose = {
    eyes: blink ? 'blink' : 'open',
    top: Math.floor(heroT / 0.8) % 2,
    dx: glance === 1 ? 1 : glance === 3 ? -1 : 0,
    outfit,
    headroom: OUTFITS.headroom(outfit),
    t: heroT,
  };
  paintPet($('hero-pet'), 72, 64, 4, palette, pose);
  if (state) paintPet($('dressed'), 100, 90, 5, palette, { ...pose, shadow: true });
}

// 身上实际穿的：节日装扮盖掉对应部位
const wornOutfit = () => (state ? OUTFITS.effective(state.config.outfit, state.config.holidays !== false) : {});
const itemPose = (outfit, extra) => ({ outfit, headroom: OUTFITS.headroom(outfit), ...extra });

// ---------- 渲染 ----------

function applyTexts() {
  document.documentElement.lang = I18N.lang();
  document.title = `${tr('app.name')} · ${tr('set.title')}`;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = tr(el.dataset.t);
}

function renderAppearance() {
  const { config } = state;

  const size = $('size');
  size.replaceChildren(
    ...[4, 5, 6, 8].map((s) => {
      const b = document.createElement('button');
      b.textContent = tr(`size.${s}`);
      b.className = config.scale === s ? 'on' : '';
      b.onclick = () => update({ scale: s });
      return b;
    })
  );

  const colors = $('colors');
  colors.replaceChildren(
    ...PALETTES.map((palette, i) => {
      const b = document.createElement('button');
      b.className = config.color === i ? 'on' : '';
      b.title = palette.body;
      const c = document.createElement('canvas');
      b.append(c);
      paintPet(c, 32, 22, 2, palette, { eyes: config.color === i ? 'happy' : 'open' });
      b.onclick = () => update({ color: i });
      return b;
    })
  );

  const bubbles = $('bubbles');
  bubbles.replaceChildren(
    ...['alerts', 'brief', 'full'].map((m) => {
      const b = document.createElement('button');
      b.textContent = tr(`bubbles.${m}`);
      b.className = (config.bubbles || 'full') === m ? 'on' : '';
      b.onclick = () => update({ bubbles: m });
      return b;
    })
  );

  $('collide').setAttribute('aria-checked', String(config.collide !== false));

  const ctxwin = $('ctxwin');
  ctxwin.replaceChildren(
    ...[['auto', 'ctxwin.auto'], [200000, 'ctxwin.200k'], [1000000, 'ctxwin.1m']].map(([value, key]) => {
      const b = document.createElement('button');
      b.textContent = tr(key);
      b.className = (config.contextWindow || 'auto') === value ? 'on' : '';
      b.onclick = () => update({ contextWindow: value });
      return b;
    })
  );

  $('sound').setAttribute('aria-checked', String(config.sound !== false));

  const lang = $('lang');
  if (document.activeElement !== lang) {
    lang.replaceChildren(
      new Option(tr('set.langAuto', { name: state.languages[state.systemLocale] }), 'auto'),
      ...Object.entries(state.languages).map(([code, name]) => new Option(name, code))
    );
    lang.value = config.lang || 'auto';
  }
}

function renderPets() {
  const list = $('pets');
  list.replaceChildren(
    ...state.pets.map((p) => {
      const li = document.createElement('li');
      const c = document.createElement('canvas');
      paintPet(c, 36, 30, 2, paletteOf(p.color), itemPose(p.outfit || {}, { eyes: p.asleep ? 'sleep' : 'open', sit: p.asleep, top: p.asleep ? 2 : 0 }));
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.project || tr('pet.free');
      const what = document.createElement('div');
      const alerting = p.status === tr('status.waitApprove') || p.status === tr('status.waitReply');
      what.className = alerting ? 'what alert' : 'what';
      what.textContent = p.status;
      text.append(name, what);
      // 上下文占用：一根小进度条，用到一半变黄、八成变红
      if (p.context != null) {
        const meter = document.createElement('div');
        meter.className = 'ctx';
        meter.title = tr('ctx.line', { pct: p.context, used: fmtTokens(p.contextUsed), limit: fmtTokens(p.contextLimit) });
        const bar = document.createElement('span');
        bar.className = 'bar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.min(100, p.context)}%`;
        fill.className = p.context >= 80 ? 'full' : p.context >= 50 ? 'half' : '';
        bar.append(fill);
        const label = document.createElement('span');
        label.textContent = tr('ctx.short', { pct: p.context });
        meter.append(bar, label);
        text.append(meter);
      }
      const buttons = document.createElement('div');
      buttons.className = 'pet-buttons';
      if (p.canJump) {
        const go = document.createElement('button');
        go.className = 'btn';
        go.textContent = tr('set.jump');
        go.onclick = () => api.pet(p.id, 'jump', p.session);
        buttons.append(go);
      }
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = tr(p.asleep ? 'set.wake' : 'set.sleep');
      btn.onclick = async () => {
        await api.pet(p.id, p.asleep ? 'wake' : 'sleep');
        setTimeout(refresh, 150);
      };
      buttons.append(btn);
      li.append(c, text, buttons);
      return li;
    })
  );
}

// ---------- 衣柜和成就 ----------

// 节日那一排：应季的小装扮 + 今年每个节日穿什么（只看不能选，到日子自动换上；今天的那个亮着）
function holidayRow(palette, today) {
  const row = document.createElement('div');
  row.className = 'slot';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = tr('set.slot.holiday');
  const items = document.createElement('div');
  items.className = 'items';
  const add = (outfit, title, on) => {
    const b = document.createElement('button');
    const c = document.createElement('canvas');
    b.append(c);
    paintPet(c, 36, 30, 2, palette, itemPose(outfit));
    b.title = title;
    b.className = on ? 'on peek' : 'peek';
    items.append(b);
  };
  const season = OUTFITS.season();
  const name = tr(`season.${season}`);
  add({ head: OUTFITS.SEASON_ITEM[season] }, `${tr(`item.${OUTFITS.SEASON_ITEM[season]}`)} · ${tr('set.seasonLook', { name })}`, false);
  const seen = new Set();
  for (const h of OUTFITS.calendar(new Date().getFullYear())) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const date = h.id === 'newyear' ? '12/31' : h.from.getTime() === h.to.getTime() ? md(h.from) : `${md(h.from)}-${md(h.to)}`;
    const item = Object.values(h.outfit)[0];
    add(h.outfit, `${tr('set.holidayWhen', { date, name: tr(`holiday.${h.id}`) })} · ${tr(`item.${item}`)}`, !!today && today.id === h.id);
  }
  row.append(label, items);
  return row;
}

function renderWardrobe() {
  const { config, achievements } = state;
  const owned = new Map(achievements.filter((a) => a.unlockedAt).map((a) => [a.item, a]));
  const how = new Map(achievements.map((a) => [a.item, a]));
  const palette = PALETTES[config.color || 0];
  const holiday = config.holidays !== false && state.holiday ? state.holiday : null;
  $('slots').replaceChildren(
    ...OUTFITS.SLOTS.map((slot) => {
      const row = document.createElement('div');
      row.className = 'slot';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = tr(`set.slot.${slot}`);
      const items = document.createElement('div');
      items.className = 'items';
      const current = config.outfit[slot] || '';
      const none = document.createElement('button');
      none.textContent = tr('set.none');
      none.className = current === '' ? 'on' : '';
      none.onclick = () => update({ outfit: { [slot]: '' } });
      items.append(none);
      for (const [item, def] of Object.entries(OUTFITS.ITEMS)) {
        if (def.slot !== slot || def.holiday) continue;
        const b = document.createElement('button');
        const c = document.createElement('canvas');
        b.append(c);
        paintPet(c, 36, 30, 2, palette, itemPose({ [slot]: item }));
        const a = how.get(item);
        if (owned.has(item)) {
          b.title = tr(`item.${item}`);
          b.className = current === item ? 'on' : '';
          b.onclick = () => update({ outfit: { [slot]: item } });
        } else {
          b.className = 'locked';
          b.title = `${tr(`item.${item}`)} · ${tr('set.locked', { how: a ? tr(`ach.${a.id}Desc`) : '?' })}`;
        }
        items.append(b);
      }
      row.append(label, items);
      return row;
    }),
    holidayRow(palette, holiday)
  );
  $('holidays').setAttribute('aria-checked', String(config.holidays !== false));
  $('holiday-hint').textContent = holiday ? tr('set.holidayNow', { name: tr(`holiday.${holiday.id}`) }) : tr('set.holidaysHint');
}

function renderAchievements() {
  const list = state.achievements;
  const palette = PALETTES[state.config.color || 0];
  $('ach-count').textContent = tr('set.achCount', { n: list.filter((a) => a.unlockedAt).length, total: list.length });
  $('ach-list').replaceChildren(
    ...list.map((a) => {
      const li = document.createElement('li');
      li.className = a.unlockedAt ? '' : 'locked';
      const c = document.createElement('canvas');
      paintPet(c, 36, 30, 2, palette, itemPose({ [OUTFITS.ITEMS[a.item].slot]: a.item }, { eyes: a.unlockedAt ? 'happy' : 'open' }));
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = tr(`ach.${a.id}`);
      const desc = document.createElement('div');
      desc.className = 'desc';
      const reward = tr(`item.${a.item}`);
      desc.textContent = a.unlockedAt
        ? `${new Date(a.unlockedAt).toLocaleDateString(I18N.lang())} · ${reward}`
        : `${tr(`ach.${a.id}Desc`)} · ${reward}`;
      desc.title = desc.textContent;
      text.append(name, desc);
      if (!a.unlockedAt && a.goal > 1) {
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.title = `${a.value} / ${a.goal}`;
        const fill = document.createElement('i');
        fill.style.width = `${Math.round((a.value / a.goal) * 100)}%`;
        bar.append(fill);
        text.append(bar);
      }
      li.append(c, text);
      return li;
    })
  );
}

function renderPlay() {
  const { config } = state;
  $('dance').setAttribute('aria-checked', String(config.dance !== false));
  $('time-of-day').setAttribute('aria-checked', String(config.timeOfDay !== false));
  $('pomodoro').replaceChildren(
    ...[15, 25, 45].map((m) => {
      const b = document.createElement('button');
      b.textContent = tr('set.minutes', { m });
      b.className = (config.pomodoroMin || 25) === m ? 'on' : '';
      b.onclick = () => update({ pomodoroMin: m });
      return b;
    })
  );
}

function renderFeed() {
  const { config } = state;
  $('feed').setAttribute('aria-checked', String(config.feed !== false));
  $('feed-hint').setAttribute('aria-checked', String(config.feedHint !== false));
  $('feed-dir').textContent = config.feedDir;
  $('feed-dir').title = config.feedDir;
  $('spit-row').hidden = !state.lastBite;
  $('spit').textContent = tr('set.spit', { n: state.lastBite });
}

function renderUpdates() {
  const u = state.update || { state: 'dev' };
  const vars = { version: u.version || '', percent: u.percent || 0, error: u.error || '' };
  $('update-status').textContent = tr(`upd.${u.state}`, vars);
  const usable = !['dev', 'unconfigured'].includes(u.state);
  const sw = $('auto-update');
  sw.hidden = !usable;
  sw.setAttribute('aria-checked', String(state.config.autoUpdate !== false));
  const btn = $('update-btn');
  btn.hidden = !usable || u.state === 'off' || u.state === 'checking' || u.state === 'downloading';
  btn.textContent = tr(u.state === 'ready' ? 'set.installUpdate' : 'set.checkUpdate');
  btn.className = u.state === 'ready' ? 'btn primary' : 'btn';
  btn.onclick = () => api.action(u.state === 'ready' ? 'update-install' : 'update-check').then(refresh);
}

function setStatus(el, ok, text) {
  el.className = ok ? 'status ok' : 'status';
  el.textContent = text;
}

function renderIntegration() {
  // 插件
  const pBtn = $('plugin-btn');
  const pStatus = $('plugin-status');
  pBtn.disabled = busy.plugin || !pluginState || !pluginState.available;
  pBtn.className = 'btn';
  if (!pluginState) {
    setStatus(pStatus, false, tr('set.checking'));
    pBtn.textContent = tr('set.install');
  } else if (!pluginState.available) {
    setStatus(pStatus, false, tr('set.noCli'));
    pBtn.textContent = tr('set.install');
  } else if (pluginState.installed && pluginState.outdated) {
    setStatus(pStatus, false, tr('set.pluginOutdated', { version: pluginState.version, latest: pluginState.latest }));
    pBtn.textContent = tr('set.update');
    pBtn.dataset.action = 'update';
    pBtn.className = 'btn primary';
  } else if (pluginState.installed && pluginState.enabled) {
    setStatus(pStatus, true, tr('set.installed'));
    pBtn.textContent = tr('set.uninstall');
    pBtn.dataset.action = 'uninstall';
  } else if (pluginState.installed) {
    setStatus(pStatus, false, tr('set.disabledPlugin'));
    pBtn.textContent = tr('set.enable');
    pBtn.dataset.action = 'enable';
    pBtn.className = 'btn primary';
  } else {
    setStatus(pStatus, false, tr('set.notInstalled'));
    pBtn.textContent = tr('set.install');
    pBtn.dataset.action = 'install';
    pBtn.className = 'btn primary';
  }
  if (busy.plugin) pBtn.textContent = tr('set.working');

  // settings.json
  const hBtn = $('hooks-btn');
  const stale = state.settingsHooks && state.hooksNeedUpdate;
  setStatus($('hooks-status'), state.settingsHooks && !stale, tr(stale ? 'set.hooksOutdated' : state.settingsHooks ? 'set.connected' : 'set.notConnected'));
  hBtn.textContent = busy.hooks ? tr('set.working') : tr(stale ? 'set.update' : state.settingsHooks ? 'set.disconnect' : 'set.connect');
  hBtn.className = stale ? 'btn primary' : 'btn';
  hBtn.disabled = busy.hooks;

  // 在桌宠上批准：接入方式是旧版的就提醒先更新
  $('approve').setAttribute('aria-checked', String(!!state.config.approveOnPet));
  const ready = (pluginState && pluginState.installed && pluginState.enabled && !pluginState.outdated) || (state.settingsHooks && !state.hooksNeedUpdate);
  const as = $('approve-status');
  as.hidden = !state.config.approveOnPet || !pluginState;
  setStatus(as, !!ready, tr(ready ? 'set.approveReady' : 'set.approveNeedsUpdate'));

  const err = $('int-error');
  err.hidden = !intError;
  err.textContent = intError ? tr('set.failed', { msg: intError }) : '';
}

function eventDetail(e) {
  if (e.detail) return e.detail;
  if (e.message) return e.message;
  if (e.test) return `${e.tool} · test ${e.test}`;
  if (e.notify) return e.notify;
  return e.tool || e.source || e.reason || '';
}

function renderEvents() {
  const list = $('events');
  if (!state.events.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = tr('set.noEvents');
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...state.events.map((e) => {
      const li = document.createElement('li');
      const cells = [
        ['time', new Date(e.at).toLocaleTimeString(I18N.lang(), { hour12: false })],
        ['ev', e.event],
        ['detail', [e.project, eventDetail(e)].filter(Boolean).join(' · ')],
        ['via', e.via === 'plugin' ? 'plugin' : e.via === 'settings' ? 'settings.json' : ''],
      ];
      for (const [cls, text] of cells) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        span.title = text;
        li.append(span);
      }
      return li;
    })
  );
}

// 每秒都会刷新，但只重建数据真的变了的区块，免得正在点的按钮被换掉
const lastRendered = {};
function changed(part, data) {
  const key = JSON.stringify([state.locale, data]);
  if (lastRendered[part] === key) return false;
  lastRendered[part] = key;
  return true;
}

function render() {
  if (!state) return;
  I18N.setLang(state.locale);
  if (changed('texts', state.version)) {
    applyTexts();
    $('version').textContent = `v${state.version}`;
  }
  if (changed('appearance', [state.config, state.systemLocale])) renderAppearance();
  if (changed('wardrobe', [state.config.outfit, state.config.holidays, state.config.color, state.holiday, state.achievements])) renderWardrobe();
  if (changed('achievements', [state.achievements, state.config.color])) renderAchievements();
  if (changed('feed', [state.config.feed, state.config.feedHint, state.config.feedDir, state.lastBite])) renderFeed();
  if (changed('play', [state.config.dance, state.config.timeOfDay, state.config.pomodoroMin])) renderPlay();
  if (changed('updates', [state.update, state.config.autoUpdate])) renderUpdates();
  if (changed('pets', state.pets)) renderPets();
  if (changed('events', state.events)) renderEvents();
  renderIntegration();
  $('autostart').setAttribute('aria-checked', String(!!state.autostart));
}

// ---------- 数据和操作 ----------

async function refresh() {
  state = await api.state();
  render();
}

async function refreshPlugin() {
  pluginState = await api.pluginStatus();
  renderIntegration();
}

async function update(patch) {
  await api.set(patch);
  await refresh();
}

$('collide').onclick = () => update({ collide: state.config.collide === false });
$('holidays').onclick = () => update({ holidays: state.config.holidays === false });
$('approve').onclick = () => update({ approveOnPet: !state.config.approveOnPet });
$('dance').onclick = () => update({ dance: state.config.dance === false });
$('time-of-day').onclick = () => update({ timeOfDay: state.config.timeOfDay === false });
$('feed').onclick = () => update({ feed: state.config.feed === false });
$('feed-hint').onclick = () => update({ feedHint: state.config.feedHint === false });
$('auto-update').onclick = () => update({ autoUpdate: state.config.autoUpdate === false });
$('feed-change').onclick = () => api.action('belly-dir').then(refresh);
$('feed-open').onclick = () => api.action('open-belly');
$('spit').onclick = () => api.action('spit').then(refresh);
$('tour').onclick = () => api.action('tour');
$('sound').onclick = () => update({ sound: state.config.sound === false });
$('report').onclick = () => api.action('report');
$('lang').onchange = (e) => {
  e.target.blur();
  update({ lang: e.target.value });
};
$('autostart').onclick = async () => {
  await api.autostart(!state.autostart);
  refresh();
};
$('demo').onclick = () => api.action('demo');
$('summon').onclick = () => api.action('summon');
$('quit').onclick = () => api.action('quit');

$('plugin-btn').onclick = async () => {
  const action = $('plugin-btn').dataset.action;
  if (!action || busy.plugin) return;
  busy.plugin = true;
  intError = '';
  renderIntegration();
  const r = await api.plugin(action);
  busy.plugin = false;
  pluginState = r.status;
  if (!r.ok) intError = r.error;
  renderIntegration();
};

$('hooks-btn').onclick = async () => {
  if (busy.hooks) return;
  busy.hooks = true;
  intError = '';
  renderIntegration();
  const r = await api.hooks(!state.settingsHooks || !!state.hooksNeedUpdate);
  busy.hooks = false;
  state.settingsHooks = r.installed;
  if (!r.ok) intError = r.error;
  renderIntegration();
};

// 打开时带着 #integration 之类：滚到那一块并闪一下
function focusSection(id) {
  const el = id && document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}
if (api.onFocusSection) api.onFocusSection(focusSection);

refresh()
  .then(() => focusSection(location.hash.slice(1)))
  .then(refreshPlugin);
setInterval(refresh, 1000);
setInterval(animateHero, 120);

// ---------- 不在 Electron 里（直接用浏览器打开）时的假数据，方便看界面 ----------

function mockApi() {
  const s = {
    config: { scale: 5, bubbles: 'full', collide: true, color: 0, lang: 'auto', contextWindow: 'auto', sound: true },
    locale: I18N.detect(navigator.languages),
    systemLocale: I18N.detect(navigator.languages),
    languages: I18N.NAMES,
    pets: [
      { id: 1, project: 'claude-pet', status: '', color: '#D97757', asleep: false, context: 83, contextUsed: 832151, contextLimit: 1000000, canJump: true, session: 's1' },
      { id: 2, project: 'forge', status: '', color: '#5B9BD5', asleep: false, context: 34, contextUsed: 68000, contextLimit: 200000, canJump: true, session: 's2' },
      { id: 3, project: '', status: '', color: '#7DB85C', asleep: true, context: null },
    ],
    events: [
      { at: new Date().toISOString(), event: 'PreToolUse', project: 'claude-pet', tool: 'Edit', detail: 'settings.js', via: 'plugin' },
      { at: new Date(Date.now() - 4000).toISOString(), event: 'PermissionRequest', project: 'forge', tool: 'Bash', detail: 'npm test', via: 'settings' },
      { at: new Date(Date.now() - 9000).toISOString(), event: 'Stop', project: 'claude-pet', via: 'plugin' },
    ],
    settingsHooks: true,
    autostart: false,
    version: '0.1.0',
    achievements: [
      { id: 'hello', item: 'bowtie', goal: 1, value: 1, unlockedAt: new Date().toISOString() },
      { id: 'green', item: 'glasses', goal: 1, value: 1, unlockedAt: new Date().toISOString() },
      { id: 'regular', item: 'scarf', goal: 100, value: 37, unlockedAt: null },
      { id: 'busy', item: 'headphones', goal: 500, value: 212, unlockedAt: null },
      { id: 'streak', item: 'crown', goal: 7, value: 7, unlockedAt: new Date().toISOString() },
      { id: 'marathon', item: 'headband', goal: 30, value: 12, unlockedAt: null },
      { id: 'owl', item: 'nightcap', goal: 1, value: 0, unlockedAt: null },
      { id: 'early', item: 'sprout', goal: 1, value: 0, unlockedAt: null },
      { id: 'boss', item: 'cap', goal: 50, value: 8, unlockedAt: null },
      { id: 'coder', item: 'tophat', goal: 300, value: 120, unlockedAt: null },
      { id: 'veteran', item: 'sunglasses', goal: 50, value: 50, unlockedAt: new Date().toISOString() },
      { id: 'foodie', item: 'chefhat', goal: 10, value: 3, unlockedAt: null },
    ],
    holiday: OUTFITS.holiday(),
    lastBite: 3,
    update: { state: 'latest' },
    hooksNeedUpdate: true,
  };
  s.config = { ...s.config, outfit: { head: 'crown', face: 'glasses', neck: '' }, holidays: true, feed: true, feedHint: true, feedDir: 'C:\\Users\\you\\Documents\\Code Octopus\\章鱼的肚子', autoUpdate: true, approveOnPet: true, dance: true, timeOfDay: true, pomodoroMin: 25 };
  s.pets.forEach((p) => (p.outfit = s.config.outfit));
  const statuses = ['status.edit', 'status.waitApprove', 'status.sleeping'];
  let plug = { available: true, installed: true, enabled: true, version: '0.1.0', latest: '0.2.0', outdated: true };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    state: async () => {
      I18N.setLang(s.locale);
      s.pets.forEach((p, i) => (p.status = I18N.t(statuses[i])));
      return JSON.parse(JSON.stringify(s));
    },
    set: async (patch) => {
      if (patch.outfit) patch = { ...patch, outfit: { ...s.config.outfit, ...patch.outfit } };
      Object.assign(s.config, patch);
      if (patch.lang) s.locale = patch.lang === 'auto' ? s.systemLocale : patch.lang;
    },
    pet: async (id) => {
      const p = s.pets.find((x) => x.id === id);
      p.asleep = !p.asleep;
    },
    action: async () => {},
    autostart: async (on) => (s.autostart = on),
    hooks: async (on) => {
      await wait(400);
      s.settingsHooks = on;
      return { ok: true, installed: on };
    },
    pluginStatus: async () => {
      await wait(600);
      return plug;
    },
    plugin: async (action) => {
      await wait(1200);
      plug = { available: true, installed: action !== 'uninstall', enabled: action !== 'uninstall' };
      return { ok: true, status: plug };
    },
  };
}
