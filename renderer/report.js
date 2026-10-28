// 每日小结：把 stats.json 里某一天的数字画成一张可以截图分享的卡片
const api = window.petReport || mockApi();
const $ = (id) => document.getElementById(id);
const tr = (key, vars) => I18N.t(key, vars);

const KINDS = ['edit', 'shell', 'read', 'web', 'agent', 'other'];
const KIND_COLORS = { edit: '#D97757', shell: '#5B6B7F', read: '#5B9BD5', web: '#7DB85C', agent: '#A98BD9', other: '#C9B8A3' };

let data = null; // { date, today, day, dates, locale, color }

function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return tr('time.s', { s });
  if (s < 3600) return tr('time.ms', { m: Math.floor(s / 60), s: s % 60 });
  return tr('time.hm', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}

const fmtCost = (usd) => (usd > 0 ? `$${usd.toFixed(usd < 10 ? 2 : 1)}` : '—');

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(data.locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(y, m - 1, d));
}

function paint(canvas, cssW, cssH, unit, palette, pose) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  drawPet(g, canvas.width / 2, canvas.height - Math.round(dpr), Math.max(1, Math.round(unit * dpr)), palette, false, Object.assign({ t: 0.3 }, pose));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function stat(value, label) {
  const box = el('div', 'stat');
  box.append(el('div', 'num', String(value)), el('div', 'lbl', label));
  return box;
}

function topList(listEl, map) {
  const items = Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  listEl.replaceChildren(
    ...(items.length
      ? items.map(([name, n]) => {
          const li = el('li', '', name);
          li.append(el('span', '', `×${n}`));
          return li;
        })
      : [el('li', 'none', '—')])
  );
}

function mood(d) {
  if (d.busyMs > 4 * 3600e3) return tr('rep.moodBusy');
  if (d.tests.pass >= 3 && d.tests.fail === 0) return tr('rep.moodTests');
  if (d.toolCount < 20) return tr('rep.moodChill');
  return tr('rep.moodNormal');
}

function render() {
  document.title = tr('rep.windowTitle');
  document.documentElement.lang = data.locale;
  $('copy').textContent = tr('rep.copy');
  $('save').textContent = tr('rep.save');
  $('prev').title = tr('rep.prev');
  $('next').title = tr('rep.next');
  $('prev').disabled = !data.dates.some((k) => k < data.date);
  $('next').disabled = data.date >= data.today;
  $('day-label').textContent = data.date;
  $('title').textContent = tr('rep.title', { date: prettyDate(data.date) });
  $('subtitle').textContent = tr('rep.subtitle');
  $('footer').textContent = `${tr('app.name')} · ${tr('set.unofficial')}`;

  const palette = PALETTES[data.color || 0] || PALETTES[0];
  const outfit = data.outfit || {};
  paint($('pet'), 72, 104, 4, palette, { eyes: 'happy', armL: 'high', armR: 'high', blush: true, props: ['signDoc'], outfit, headroom: OUTFITS.headroom(outfit) });

  const d = data.day;
  const empty = !d || (!d.prompts && !d.toolCount);
  $('empty').hidden = !empty;
  $('content').hidden = empty;
  if (empty) {
    paint($('sleepy'), 96, 60, 4, palette, { eyes: 'sleep', sit: true, top: 2, armL: 5, armR: 5 });
    $('empty-text').textContent = tr('rep.empty');
    return;
  }

  $('hero').replaceChildren(
    stat(fmtDuration(d.busyMs), tr('rep.busy')),
    stat(d.toolCount, tr('rep.tools')),
    stat(d.prompts, tr('rep.prompts')),
    stat(d.sessions.length, tr('rep.sessions'))
  );
  $('minor').replaceChildren(
    stat(tr('rep.testsValue', { pass: d.tests.pass, fail: d.tests.fail }), tr('rep.tests')),
    stat(Object.keys(d.files || {}).length, tr('rep.files')),
    stat(d.approvals, tr('rep.approvals')),
    stat(d.helpers, tr('rep.helpers')),
    stat(fmtCost(d.costUSD), tr('rep.cost')),
    stat(d.longestMs ? fmtDuration(d.longestMs) : '—', tr('rep.longest'))
  );

  // 都在干啥：各类工具调用的占比
  $('kinds-title').textContent = tr('rep.kinds');
  const total = KINDS.reduce((n, k) => n + (d.tools[k] || 0), 0) || 1;
  $('kinds-bar').replaceChildren(
    ...KINDS.filter((k) => d.tools[k]).map((k) => {
      const i = el('i');
      i.style.width = `${(d.tools[k] / total) * 100}%`;
      i.style.background = KIND_COLORS[k];
      i.title = `${tr(`act.${k}`)} ${d.tools[k]}`;
      return i;
    })
  );
  $('kinds-legend').replaceChildren(
    ...KINDS.filter((k) => d.tools[k]).map((k) => {
      const li = el('li');
      const sw = el('b');
      sw.style.background = KIND_COLORS[k];
      li.append(sw, tr(`act.${k}`), el('span', '', String(d.tools[k])));
      return li;
    })
  );

  // 一天的节奏：每小时的活跃度
  $('hours-title').textContent = tr('rep.hours');
  const max = Math.max(1, ...d.hours);
  const peak = d.hours.indexOf(Math.max(...d.hours));
  $('peak').textContent = d.hours[peak] ? tr('rep.peak', { h: peak }) : '';
  $('hours').replaceChildren(
    ...d.hours.map((v, h) => {
      const i = el('i', v ? (h === peak ? 'peak' : '') : 'zero');
      i.style.height = `${v ? Math.max(6, (v / max) * 100) : 3}%`;
      i.title = `${h}:00 · ${v}`;
      return i;
    })
  );

  $('projects-title').textContent = tr('rep.projects');
  topList($('projects'), d.projects);
  $('files-title').textContent = tr('rep.topFiles');
  topList($('files'), d.files);

  paint($('mini'), 32, 22, 2, palette, { eyes: 'happy', blush: true });
  $('mood').textContent = mood(d);
}

async function load(date) {
  data = await api.get(date);
  I18N.setLang(data.locale);
  render();
}

function cardRect() {
  window.scrollTo(0, 0);
  const r = $('card').getBoundingClientRect();
  return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
}

let toastTimer = null;
function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), 2200);
}

$('prev').onclick = () => {
  const earlier = data.dates.filter((k) => k < data.date);
  if (earlier.length) load(earlier[earlier.length - 1]);
};
$('next').onclick = () => {
  const later = data.dates.filter((k) => k > data.date);
  load(later.length ? later[0] : data.today);
};
$('copy').onclick = async () => {
  await api.copy(cardRect());
  toast(tr('rep.copied'));
};
$('save').onclick = async () => {
  await api.save(cardRect(), data.date);
  toast(tr('rep.saved'));
};

load(new URLSearchParams(location.search).get('date') || undefined);

// ---------- 不在 Electron 里时的假数据，方便看界面 ----------
function mockApi() {
  const today = '2026-10-08';
  const day = {
    prompts: 46,
    sessions: ['a', 'b', 'c'],
    toolCount: 812,
    tools: { edit: 214, shell: 268, read: 231, web: 18, agent: 9, other: 72 },
    tests: { pass: 7, fail: 2 },
    errors: 11,
    approvals: 23,
    helpers: 9,
    done: 41,
    busyMs: (5 * 60 + 12) * 60e3,
    longestMs: 27 * 60e3 + 14e3,
    files: { 'world.js': 38, 'pet.js': 31, 'main.js': 24, 'settings.js': 9 },
    projects: { 'claude-pet': 720, forge: 96, 'claude-journey': 42 },
    hours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 40, 66, 21, 8, 52, 97, 120, 88, 30, 14, 61, 79, 34, 0],
    costUSD: 18.42,
  };
  return {
    get: async (date) => ({ date: date || today, today, day: (date || today) === today ? day : null, dates: ['2026-10-07', today], locale: I18N.detect(navigator.languages), color: 0 }),
    copy: async () => true,
    save: async () => '',
  };
}
