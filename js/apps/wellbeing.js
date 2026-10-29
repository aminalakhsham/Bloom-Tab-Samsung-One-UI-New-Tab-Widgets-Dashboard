// Digital Wellbeing (Samsung One UI): screen time per site and category, site timers, Focus modes, Bedtime mode and
// the weekly report. This module only registers the app and its surfaces (widgets, Lock screen chip, Quick Panel tile,
// Finder command and search, Now Bar); the screens load from js/wellbeing/ui.js when the app opens, and the counting
// and pausing of sites happens in the service worker (js/bg/wellbeing.js). It also turns the new tab grey while
// Bedtime mode runs (class `wb-gray`, css/apps/wellbeing.css) and reports Lock screen unlocks to the counter.
import { h, debounce, everyMinute } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerCommand, registerTile, registerLockWidget } from '../core/hooks.js';
import * as M from '../wellbeing/model.js';
import { prefs, usage, today, savePrefs, dur, modeName, siteIcon, donutEl, siteSlices, weekStart } from '../wellbeing/common.js';
import { setModeSource } from '../wellbeing/actions.js';

registerApp({
  id: 'wellbeing',
  name: 'app.wellbeing',
  icon: {
    bg: 'linear-gradient(145deg, #4fd08b 0%, #13a067 100%)',
    glyph: '<path d="M12 3.6a8.4 8.4 0 1 1-8.1 6.2"/><path d="M12 8a4 4 0 1 1-3.9 3.1"/><path d="M5.2 5.9 8 8.6"/>',
  },
  keywords: ['digital wellbeing', 'screen time', 'wellbeing', 'focus mode', 'bedtime', 'app timer', 'الصحة الرقمية', 'وقت الشاشة', 'وضع التركيز', 'وقت النوم'],
  render: (ctx) => import('../wellbeing/ui.js').then((m) => m.render(ctx)),
  search(q) {
    const ql = q.trim().toLowerCase();
    if (ql.length < 2) return [];
    const u = usage(), d = today(), wk = M.period(u, { mode: 'week', ws: weekStart() });
    const of = (p, s) => p.sites.find((x) => x[0] === s)?.[1] || 0;
    return M.knownSites(u).filter((s) => s.includes(ql)).slice(0, 4).map((s) => ({
      title: s,
      sub: t('wellbeing.search.sub', { d: dur(of(d, s), 'short'), w: dur(of(wk, s), 'short') }),
      icon: 'hourglass',
      onOpen: () => openApp('wellbeing', { params: { section: 'site:' + s } }),
    }));
  },
});

// ——— widgets ———
/** Redraws on new usage (the service worker saves every minute) and when the day changes. */
function live(draw) {
  const d = debounce(draw, 300);
  const offs = [store.on('wellbeingUsage', d), store.on('wellbeing', d), everyMinute(() => d())];
  draw();
  return () => offs.forEach((f) => f());
}

registerWidget({
  id: 'wellbeing',
  name: 'wellbeing.w.screen',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'wellbeing',
  render(el, { size }) {
    el.classList.add('wg-wb', 'wg-wb-' + size);
    return live(() => {
      const p = today(), slices = siteSlices(p);
      const ring = donutEl(slices, { center: dur(p.total, 'short'), label: t('wellbeing.today'), size: 120, stroke: 13, cls: 'wg-wb-donut' });
      if (size === 's') return el.replaceChildren(ring);
      el.replaceChildren(ring,
        h('div', { class: 'wg-wb-legend' },
          h('div', { class: 'wg-head' }, h('span', { html: icon('hourglass', 15) }), t('wellbeing.screenTime')),
          slices.length
            ? slices.slice(0, 4).map((s) => h('div', { class: 'wg-wb-li' }, h('i', { style: { background: s.color } }), h('span', { class: 'wg-wb-name' }, s.key || t('wellbeing.other')), h('b', null, dur(s.sec, 'short'))))
            : h('div', { class: 'wg-sub' }, t('wellbeing.noData'))));
    });
  },
});

registerWidget({
  id: 'wellbeing-top',
  name: 'wellbeing.w.top',
  sizes: ['m', 'l'],
  defaultSize: 'm',
  app: 'wellbeing',
  render(el, { size }) {
    el.classList.add('wg-wbtop', 'wg-wbtop-' + size);
    return live(() => {
      const p = today(), top = p.sites.slice(0, size === 'l' ? 7 : 3), max = top[0]?.[1] || 1;
      el.replaceChildren(
        h('div', { class: 'wg-head wg-wbtop-head' }, h('span', { html: icon('hourglass', 15) }), h('span', { class: 'wg-wbtop-title' }, t('wellbeing.w.top')), h('b', null, dur(p.total, 'short'))),
        top.length
          ? h('div', { class: 'wg-wbtop-list' }, top.map(([site, sec]) => h('div', {
            class: 'wg-wbtop-row',
            onClick: (e) => {
              e.stopPropagation();
              openApp('wellbeing', { from: el, params: { section: 'site:' + site } });
            },
          },
            siteIcon(site),
            h('span', { class: 'wg-wbtop-text' },
              h('span', { class: 'wg-wbtop-name' }, h('bdi', null, site)),
              h('span', { class: 'wg-wbtop-bar' }, h('i', { style: { width: Math.max(4, (sec / max) * 100).toFixed(1) + '%' } }))),
            h('b', { class: 'wg-wbtop-time' }, dur(sec, 'short')))))
          : h('div', { class: 'wg-sub wg-wbtop-empty' }, t('wellbeing.noData')));
    });
  },
});

// ——— Lock screen chip ———
registerLockWidget('wellbeing', {
  name: 'wellbeing.lw',
  render: async () => h('span', { class: 'lk-w' }, h('span', { html: icon('hourglass', 18) }), dur(today().total, 'short')),
});

// ——— Quick Panel tile ———
export const bedtimeOn = () => M.bedtimeAt(prefs().bedtime).active;
registerTile({
  id: 'bedtime',
  icon: 'bedtime',
  label: () => t('wellbeing.bedtime'),
  on: bedtimeOn,
  toggle: () => savePrefs((w) => ({ bedtime: M.toggleBedtime(w.bedtime) })),
  order: 60,
});

// ——— Finder: "screen time" ———
const WORDS = ['screen time', 'screentime', 'digital wellbeing', 'وقت الشاشة', 'وقت استخدام الشاشة', 'الصحة الرقمية'];
registerCommand('wellbeing', (q, lower, done) => {
  const s = lower.trim();
  if (s.length < 4 || !WORDS.some((w) => w === s || (w.startsWith(s) && s.length >= 6))) return [];
  return [{ icon: 'hourglass', title: t('wellbeing.cmd.today', { t: dur(today().total) }), sub: t('wellbeing.cmd.sub'), run: () => { done(); openApp('wellbeing'); } }];
});

// ——— Now Bar: a Focus mode that's on ———
registerActivity('wellbeing', () => {
  const w = prefs(), m = M.activeMode(w);
  if (!m) return null;
  const left = w.focus.endsAt ? w.focus.endsAt - Date.now() : 0;
  return {
    icon: m.icon || 'wbWork',
    color: m.color,
    title: modeName(m),
    sub: left > 0 ? t('wellbeing.minLeft', { n: Math.ceil(left / 60e3) }) : t('wellbeing.focusOn'),
    progress: left > 0 ? 1 - left / (w.focus.endsAt - w.focus.startedAt) : undefined,
    app: 'wellbeing',
    priority: 6,
  };
});

// ——— Routines: Bedtime mode on/off, start or end a Focus mode (js/wellbeing/actions.js; the editor lists your modes) ———
setModeSource(() => prefs().modes);

// ——— Bedtime mode's grayscale on this new tab ———
function applyGray() {
  const w = prefs();
  document.documentElement.classList.toggle('wb-gray', !!(w.bedtime.gray && M.bedtimeAt(w.bedtime).active));
}
applyGray();
store.on('wellbeing', applyGray);
everyMinute(applyGray);

// ——— Unlocks: Bloom Tab's Lock screen opening counts as one (the service worker merges it with the computer's) ———
if (globalThis.chrome?.runtime?.id && document.body) {
  let wasLocked = document.body.classList.contains('locked');
  new MutationObserver(() => {
    const now = document.body.classList.contains('locked');
    if (wasLocked && !now) chrome.runtime.sendMessage({ type: 'wb:unlock' }).catch(() => {});
    wasLocked = now;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

addStrings({
  en: { 'wellbeing.minLeft': '{n} min left' },
  ar: { 'wellbeing.minLeft': 'متبقٍ {n} د' },
});
