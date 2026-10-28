// 写便签的小窗口：一句话 + 要不要到点提醒。回车保存，Shift+回车换行，Esc 关掉
const api = window.petNote || { info: async () => ({ locale: I18N.detect(navigator.languages) }), add: async () => true };
const $ = (id) => document.getElementById(id);
const tr = (key, vars) => I18N.t(key, vars);
const REMIND = [0, 10, 30, 60, 120];

api.info().then(({ locale }) => {
  I18N.setLang(locale);
  document.documentElement.lang = locale;
  document.title = tr('note.title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = tr(el.dataset.t);
  $('text').placeholder = tr('note.placeholder');
  $('remind').replaceChildren(...REMIND.map((m) => new Option(m ? tr('note.inMin', { m }) : tr('note.noRemind'), String(m))));
  $('text').focus();
});

async function save() {
  const text = $('text').value.trim();
  if (!text) return $('text').focus();
  await api.add(text, Number($('remind').value));
}

$('form').onsubmit = (e) => {
  e.preventDefault();
  save();
};
$('text').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    save();
  }
};
$('cancel').onclick = () => window.close();
window.onkeydown = (e) => {
  if (e.key === 'Escape') window.close();
};
