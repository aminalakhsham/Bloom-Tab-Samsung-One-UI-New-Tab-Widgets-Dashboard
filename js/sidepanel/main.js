// The Chrome side panel (sidepanel.html, roadmap S6), like One UI's Edge panel: Notes, Reminder, Clock, Calculator and
// Music next to any website, in a narrow window with a floating bottom navigation. Opened with Alt+Shift+L, the toolbar
// button's menu or Chrome's own side panel menu (js/bg/anytab.js). It shares storage with every new tab, so a change
// made here shows up on the Home screen and in the apps at once, and the other way round.
// Each tab is its own module (js/sidepanel/<tab>.js) exporting render(main) → cleanup, loaded when first shown, so a
// broken app module only takes its own tab down.
import { store, onSetting } from '../core/store.js';
import { t, detectLang, setLang } from '../core/i18n.js';
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { applyTheme } from '../shell/theme.js';
import { accentFromWallpaper } from '../anytab/page.js';
import { gate, onRelock } from './gate.js';
import './strings.js';

export const TABS = [
  { id: 'notes', icon: 'note', load: () => import('./notes.js') },
  { id: 'reminder', icon: 'checkCircle', load: () => import('./reminder.js') },
  { id: 'clock', icon: 'clock', load: () => import('./clock.js') },
  { id: 'calc', icon: 'calc', load: () => import('./calc.js') },
  { id: 'music', icon: 'music', load: () => import('./music.js') },
];
const LS = 'bt.sp.tab';
const lsGet = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, v); } catch {} };

let main, nav, cleanup = null, current = null, seq = 0;

async function boot() {
  await store.init();
  setLang(detectLang());
  applyTheme();
  accentFromWallpaper();
  onSetting('lang', () => location.reload());
  onSetting('wallpaper', accentFromWallpaper);
  const root = document.getElementById('sp-root');
  if (await gate(root)) build(root);
  onRelock(async () => {
    cleanup?.();
    cleanup = null;
    root.replaceChildren();
    if (await gate(root)) build(root);
  });
  addEventListener('keydown', onKey);
  requestAnimationFrame(() => document.body.classList.remove('booting'));
  window.__spReady = true; // the dev tests wait for this
}

function build(root) {
  main = h('main', { class: 'sp-main' });
  nav = h('nav', { class: 'sp-tabs', role: 'tablist' },
    TABS.map((tb) => h('button', {
      class: 'sp-tab', role: 'tab', dataset: { tab: tb.id }, title: t('sp.tab.' + tb.id), onClick: () => go(tb.id),
    }, h('span', { class: 'sp-tab-ico', html: icon(tb.icon, 22) }), h('span', { class: 'sp-tab-label' }, t('sp.tab.' + tb.id)))));
  root.replaceChildren(main, nav);
  go(lsGet());
}

/** Shows a tab ('notes', 'reminder', 'clock', 'calc', 'music'). */
export async function go(id) {
  if (!TABS.some((x) => x.id === id)) id = 'notes';
  current = id;
  lsSet(id);
  for (const b of nav.children) {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  cleanup?.();
  cleanup = null;
  main.replaceChildren();
  main.scrollTop = 0;
  main.dataset.tab = id;
  const mine = ++seq;
  try {
    const m = await TABS.find((x) => x.id === id).load();
    if (mine !== seq) return;
    const off = await m.render(main);
    if (mine !== seq) return off?.();
    cleanup = typeof off === 'function' ? off : null;
  } catch (e) {
    console.error('side panel', id, e);
    if (mine === seq) main.replaceChildren(h('div', { class: 'ou-empty' }, t('sp.failed')));
  }
}
export const currentTab = () => current;

// Alt+1…5 switch tabs, like the number keys of a bottom navigation.
function onKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || !nav) return;
  const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (i < 0) return;
  e.preventDefault();
  go(TABS[i].id);
}

window.__spGo = go; // for .dev/sidepanel.cjs
boot().catch((e) => {
  console.error(e);
  document.body.classList.remove('booting');
});
