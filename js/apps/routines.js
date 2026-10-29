// Modes and Routines (Samsung One UI): registration only — the app, its icons and strings, the Routines and Modes
// widgets, Finder commands ("run <routine>", "<mode> mode", "mode off") and search, the Quick Panel "Modes" tile,
// the Now Bar activity of a mode that is on (and of running routines) and a Lock screen chip. The UI
// (js/routines/ui.js) and the engine (js/routines/page.js) load when they are needed; the worker side is
// js/bg/routines.js. Other apps add actions with registerAction() from js/routines/actions.js.
import { h, isExt, everySecond } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerTile, registerLockWidget, onUnlock } from '../core/hooks.js';
import { registerActivity } from '../core/activity.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtTime } from '../core/i18n.js';
import { choose } from '../core/ui.js';
import { KEY, RUN_KEY, norm, normRun, isManual } from '../routines/model.js';
import * as sounds from '../shell/sounds.js';

addIcons({
  rtModes: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/><path d="M3.5 12A8.5 8.5 0 0 1 12 3.5" stroke-dasharray="2.2 2.6"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
  rtRoutine: '<path d="M19.6 12.5A7.7 7.7 0 1 1 17.4 6.5"/><path d="M20 4v4.3h-4.3"/><path d="m8.4 12 2.6 2.6 4.6-4.8"/>',
  rtDiscover: '<circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z"/>',
  rtSleep: '<path d="M19 14.6A7.4 7.4 0 0 1 9.4 5a7.4 7.4 0 1 0 9.6 9.6Z"/><path d="M15.5 3.8h3.3l-3.3 3.6h3.3"/>',
  rtTheater: '<path d="M4 9.6h16v8.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V9.6Z"/><path d="m4 9.6-.5-2.8a1.2 1.2 0 0 1 1-1.4l12.6-2.1a1.2 1.2 0 0 1 1.4 1l.4 2.3L4 9.6Z"/><path d="m8.6 4.6 2 3.8M13.3 3.8l2 3.8"/>',
  rtDriving: '<path d="M5 15.5v-3.6L6.9 7.3A2 2 0 0 1 8.8 6h6.4a2 2 0 0 1 1.9 1.3l1.9 4.6v3.6"/><path d="M4 12h16v5.2a.8.8 0 0 1-.8.8h-1.6a.8.8 0 0 1-.8-.8V16H7.2v1.2a.8.8 0 0 1-.8.8H4.8a.8.8 0 0 1-.8-.8V12Z"/><circle cx="7.8" cy="13.9" r=".9" fill="currentColor" stroke="none"/><circle cx="16.2" cy="13.9" r=".9" fill="currentColor" stroke="none"/>',
  rtExercise: '<circle cx="15" cy="4.6" r="1.9"/><path d="m5.6 11.4 3.6-3 3.3.8 2.2 3.3 3.3.9M12.5 9.2 10.6 15l3.1 2.4-.8 4.1M10.6 15l-3.5 5.4"/>',
  rtRelax: '<path d="M12 20c-4.4 0-7.5-2.9-7.5-7.3 4.4 0 7.5 2.9 7.5 7.3Z"/><path d="M12 20c4.4 0 7.5-2.9 7.5-7.3-4.4 0-7.5 2.9-7.5 7.3Z"/><path d="M12 16.4c-1.9-2.4-1.9-7.1 0-10.4 1.9 3.3 1.9 8 0 10.4Z"/>',
  rtWork: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7M3.5 12.4h17M11 12.4v1.8h2v-1.8"/>',
  rtBook: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 1 4 18V5.5ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5A1.5 1.5 0 0 0 20 18V5.5Z"/>',
  rtCoffee: '<path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Z"/><path d="M16.5 10.5h1.2a2.3 2.3 0 0 1 0 4.6h-1.6M8 3.5c-.6.8-.6 1.7 0 2.5M11.5 3.5c-.6.8-.6 1.7 0 2.5"/>',
  rtGame: '<path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.4l-.6 3a2.5 2.5 0 0 1-4.3 1.2L14.5 15.5h-5l-1.5 1.6a2.5 2.5 0 0 1-4.3-1.2l-.6-3A4.5 4.5 0 0 1 7.5 7.5Z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="17" cy="13" r=".9" fill="currentColor" stroke="none"/>',
  rtBolt: '<path d="M13 3 5.5 13.5h6L10.5 21 18.5 10h-6L13 3Z"/>',
  rtHeart: '<path d="M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6Z"/>',
  rtSunrise: '<path d="M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0M12 3.5v6M9.4 6.1 12 3.5l2.6 2.6M4.7 12.3l1.4 1M19.3 12.3l-1.4 1"/>',
  rtSunset: '<path d="M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0M12 3.5v6M9.4 6.9 12 9.5l2.6-2.6M4.7 12.3l1.4 1M19.3 12.3l-1.4 1"/>',
  rtNewTab: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M12 11.8v5M9.5 14.3h5"/>',
  rtIdle: '<rect x="4" y="4.5" width="16" height="11" rx="1.8"/><path d="M2.5 19.5h19M9.5 15.5l-.5 4M14.5 15.5l.5 4"/>',
  rtBranch: '<path d="M6 3.5v6.5a4 4 0 0 0 4 4h8.5M6 20.5V14M15.5 11l3 3-3 3"/>',
  rtRepeat: '<path d="M4 11V9.5a3 3 0 0 1 3-3h12.5M16.5 3.5l3 3-3 3M20 13v1.5a3 3 0 0 1-3 3H4.5M7.5 20.5l-3-3 3-3"/>',
  rtVar: '<path d="M8 4c-2 0-3 1-3 3v2.4c0 1-.7 2.6-2 2.6 1.3 0 2 1.6 2 2.6V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.4c0 1 .7 2.6 2 2.6-1.3 0-2 1.6-2 2.6V17c0 2-1 3-3 3M9.5 9l5 6M14.5 9l-5 6"/>',
  rtWait: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.2 8 4.4 8 8.5s-8 4.3-8 8.5M16 3.5c0 4.2-8 4.4-8 8.5s8 4.3 8 8.5"/>',
  rtMessage: '<path d="M4.5 5h15A1.5 1.5 0 0 1 21 6.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5Z"/><path d="M7.5 9.5h9M7.5 12.5h5"/>',
  rtToast: '<rect x="3" y="13" width="18" height="6" rx="3"/><path d="M7 16h10M12 4v5M9.5 6.5 12 9l2.5-2.5"/>',
  rtTabsClose: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M9.8 12l4.4 4.4M14.2 12l-4.4 4.4"/>',
  rtTabsGroup: '<rect x="2.5" y="7" width="8.5" height="11" rx="2"/><rect x="13" y="7" width="8.5" height="11" rx="2"/><path d="M2.5 4.5h19"/>',
  rtTabsSleep: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M10 12h4l-4 4.5h4"/>',
  rtPlay: '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6Z" fill="currentColor" stroke="none"/>',
});

addStrings({
  en: {
    'app.routines': 'Modes and Routines',
    'routines.tab.modes': 'Modes',
    'routines.tab.routines': 'Routines',
    'routines.mode.sleep': 'Sleep',
    'routines.mode.theater': 'Theater',
    'routines.mode.driving': 'Driving',
    'routines.mode.exercise': 'Exercise',
    'routines.mode.relax': 'Relax',
    'routines.mode.work': 'Work',
    'routines.mode.custom': 'My mode',
    'routines.untitled': 'My routine',
    'routines.modeOn': '{name} is on',
    'routines.on': 'On',
    'routines.until': 'Until {time}',
    'routines.turnOff': 'Turn off',
    'routines.turnOn': 'Turn on',
    'routines.running': 'Running',
    'routines.stop': 'Stop',
    'routines.run': 'Start',
    'routines.noMode': 'No mode on',
    'routines.noRoutines': 'No routines yet',
    'routines.widgetRoutines': 'Routines',
    'routines.widgetModes': 'Modes',
    'routines.lockWidget': 'Current mode',
    'routines.cmdRun': 'Start “{name}”',
    'routines.cmdStop': 'Stop “{name}”',
    'routines.cmdMode': 'Turn on {name}',
    'routines.cmdModeOff': 'Turn off {name}',
    'routines.cmdSub': 'Modes and Routines',
    'routines.searchRoutine': 'Routine',
    'routines.searchMode': 'Mode',
    'routines.wgPick': 'Routine to show',
    'routines.wgAll': 'All routines',
    'routines.wgAllSub': 'Manual routines first',
  },
  ar: {
    'app.routines': 'الأوضاع والإجراءات الروتينية',
    'routines.tab.modes': 'الأوضاع',
    'routines.tab.routines': 'الإجراءات الروتينية',
    'routines.mode.sleep': 'النوم',
    'routines.mode.theater': 'المسرح',
    'routines.mode.driving': 'القيادة',
    'routines.mode.exercise': 'التمرين',
    'routines.mode.relax': 'الاسترخاء',
    'routines.mode.work': 'العمل',
    'routines.mode.custom': 'وضعي',
    'routines.untitled': 'إجرائي الروتيني',
    'routines.modeOn': 'وضع {name} قيد التشغيل',
    'routines.on': 'قيد التشغيل',
    'routines.until': 'حتى {time}',
    'routines.turnOff': 'إيقاف',
    'routines.turnOn': 'تشغيل',
    'routines.running': 'قيد التنفيذ',
    'routines.stop': 'إيقاف',
    'routines.run': 'بدء',
    'routines.noMode': 'لا يوجد وضع قيد التشغيل',
    'routines.noRoutines': 'لا توجد إجراءات روتينية بعد',
    'routines.widgetRoutines': 'الإجراءات الروتينية',
    'routines.widgetModes': 'الأوضاع',
    'routines.lockWidget': 'الوضع الحالي',
    'routines.cmdRun': 'بدء ”{name}“',
    'routines.cmdStop': 'إيقاف ”{name}“',
    'routines.cmdMode': 'تشغيل {name}',
    'routines.cmdModeOff': 'إيقاف {name}',
    'routines.cmdSub': 'الأوضاع والإجراءات الروتينية',
    'routines.searchRoutine': 'إجراء روتيني',
    'routines.searchMode': 'وضع',
    'routines.wgPick': 'الإجراء الروتيني المعروض',
    'routines.wgAll': 'كل الإجراءات الروتينية',
    'routines.wgAllSub': 'الإجراءات اليدوية أولاً',
  },
});

// ——— shared helpers (the UI imports these too) ———
export const rdata = () => norm(store.get(KEY));
export const rrun = () => normRun(store.get(RUN_KEY));
export const modeName = (m) => (m ? m.name || (m.preset ? t('routines.mode.' + m.preset) : t('routines.mode.custom')) : '');
export const routineName = (r) => (r ? r.name || t('routines.untitled') : '');
/** The mode that is on: { mode, state } or null. */
export function activeMode() {
  const st = rrun().mode;
  if (!st || (st.until && st.until <= Date.now())) return null;
  const mode = rdata().modes.find((m) => m.id === st.id);
  return mode ? { mode, state: st } : null;
}
/** A round coloured icon, like One UI's mode and routine icons. */
export const roundIcon = (name, color, size = 20, cls = '') => h('span', { class: ['rt-ico', cls], style: { '--c': color }, html: icon(name, size) });
const engine = () => import('../routines/page.js');

// ——— app ———
registerApp({
  id: 'routines',
  name: 'app.routines',
  icon: {
    bg: 'linear-gradient(145deg, #34d399 0%, #10a39a 100%)',
    glyph: '<path d="M18.8 13.2A7 7 0 1 1 16.9 7"/><path d="M19.2 4.8v3.9h-3.9"/><circle cx="12" cy="12" r="2.6" fill="#fff" stroke="none"/>',
  },
  keywords: ['modes', 'routines', 'bixby routines', 'automation', 'sleep mode', 'work mode', 'الأوضاع', 'روتين', 'إجراءات روتينية', 'أتمتة'],
  render: (ctx) => import('../routines/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.toLowerCase();
    const d = rdata();
    return [
      ...d.modes.filter((m) => modeName(m).toLowerCase().includes(q)).slice(0, 3).map((m) => ({ title: modeName(m), sub: t('routines.searchMode'), icon: m.icon, onOpen: () => openApp('routines', { params: { section: 'm:' + m.id } }) })),
      ...d.list.filter((r) => routineName(r).toLowerCase().includes(q)).slice(0, 4).map((r) => ({ title: routineName(r), sub: t('routines.searchRoutine'), icon: r.icon, onOpen: () => openApp('routines', { params: { section: 'r:' + r.id } }) })),
    ];
  },
});

// ——— Finder commands ———
registerCommand('routines', (q, lower, done) => {
  const out = [];
  const runM = q.match(/^(?:run|start|stop|شغل|تشغيل|ابدأ|إيقاف)\s+(.+)$/i);
  const d = rdata();
  if (runM) {
    const want = runM[1].trim().toLowerCase();
    const running = rrun().running;
    for (const r of d.list.filter((x) => routineName(x).toLowerCase().includes(want)).slice(0, 3)) {
      const on = !!running[r.id];
      out.push({ icon: on ? 'stop' : 'rtPlay', title: t(on ? 'routines.cmdStop' : 'routines.cmdRun', { name: routineName(r) }), sub: t('routines.cmdSub'), run: () => { done?.(); engine().then((m) => m.toggleRoutine(r.id)); } });
    }
  }
  const modeM = lower.match(/^(?:mode\s+(.+)|(.+?)\s+mode|وضع\s+(.+))$/);
  if (modeM) {
    const want = (modeM[1] || modeM[2] || modeM[3]).trim();
    const cur = activeMode();
    if (/^(off|إيقاف)$/.test(want) && cur) out.push({ icon: 'stop', title: t('routines.cmdModeOff', { name: modeName(cur.mode) }), sub: t('routines.cmdSub'), run: () => { done?.(); engine().then((m) => m.turnOffMode()); } });
    for (const m of d.modes.filter((x) => modeName(x).toLowerCase().includes(want) || x.id === want).slice(0, 2)) {
      const on = cur?.mode.id === m.id;
      out.push({ icon: m.icon, title: t(on ? 'routines.cmdModeOff' : 'routines.cmdMode', { name: modeName(m) }), sub: t('routines.cmdSub'), run: () => { done?.(); engine().then((x) => (on ? x.turnOffMode() : x.turnOnMode(m.id))); } });
    }
  }
  return out;
});

// ——— Quick Panel tile: tap turns the mode off, or turns the last used one on; with none yet it opens the app ———
registerTile({
  id: 'modes',
  icon: 'rtModes',
  order: 30,
  label: () => (activeMode() ? modeName(activeMode().mode) : t('routines.tab.modes')),
  on: () => !!activeMode(),
  toggle() {
    if (activeMode()) return void engine().then((m) => m.turnOffMode());
    const last = rrun().lastMode;
    if (last && rdata().modes.some((m) => m.id === last)) return void engine().then((m) => m.turnOnMode(last));
    openApp('routines', { params: { section: 'modes' } });
    return true;
  },
});

// ——— Now Bar and Quick Panel activities ———
registerActivity('mode', () => {
  const a = activeMode();
  if (!a) return null;
  return {
    icon: a.mode.icon, color: a.mode.color, title: modeName(a.mode),
    sub: a.state.until ? t('routines.until', { time: fmtTime(new Date(a.state.until)) }) : t('routines.on'),
    app: 'routines', priority: 7,
    actions: [{ icon: 'stop', label: t('routines.turnOff'), onClick: () => engine().then((m) => m.turnOffMode()) }],
  };
});
registerActivity('routine', () => {
  const running = rrun().running;
  const ids = Object.keys(running);
  if (!ids.length) return null;
  const r = rdata().list.find((x) => x.id === ids[0]);
  if (!r) return null;
  return {
    icon: r.icon, color: r.color, title: routineName(r), sub: t('routines.running'), app: 'routines', priority: 3,
    actions: [{ icon: 'stop', label: t('routines.stop'), onClick: () => engine().then((m) => m.stopRoutine(r.id)) }],
  };
});

registerLockWidget('mode', {
  name: 'routines.lockWidget',
  render: async () => {
    const a = activeMode();
    if (!a) return null;
    return h('span', { class: 'lk-w rt-lk' }, h('span', { html: icon(a.mode.icon, 18) }), modeName(a.mode));
  },
});

// ——— widgets ———
// Widget settings pick the routine the widget shows first (config.routine); an empty or deleted one shows the list.
// Routines once handed the pick over through a localStorage key read by the next new widget: drop any leftover.
try { localStorage.removeItem('bt.routines.pin'); } catch {}
async function pickRoutine(config) {
  const list = rdata().list;
  if (!list.length) return { ...config, routine: '' };
  const v = await choose(t('routines.wgPick'), [{ value: '', label: t('routines.wgAll'), sub: t('routines.wgAllSub') },
    ...list.map((r) => ({ value: r.id, label: routineName(r) }))], list.some((r) => r.id === config.routine) ? config.routine : '');
  return v == null ? null : { ...config, routine: v };
}
registerWidget({
  id: 'routines',
  name: 'routines.widgetRoutines',
  sizes: ['s', 'm'],
  defaultSize: 'm',
  app: 'routines',
  configure: (config) => pickRoutine(config),
  render(el, { size, config, preview }) {
    el.classList.add('wg-routines');
    const draw = () => {
      const d = rdata(), running = rrun().running;
      let list = [...d.list].sort((a, b) => isManual(b) - isManual(a));
      if (config.routine) list = [...list.filter((r) => r.id === config.routine), ...list.filter((r) => r.id !== config.routine)];
      list = list.slice(0, size === 's' ? 1 : 4);
      if (!list.length) {
        el.replaceChildren(h('div', { class: 'wg-head' }, h('span', { html: icon('rtRoutine', 16) }), t('routines.widgetRoutines')), h('div', { class: 'rt-wg-empty' }, t('routines.noRoutines')));
        return;
      }
      el.classList.toggle('one', size === 's');
      el.replaceChildren(h('div', { class: 'wg-head' }, h('span', { html: icon('rtRoutine', 16) }), t('routines.widgetRoutines')), h('div', { class: 'rt-wg-row' }, list.map((r) => {
        const on = !!running[r.id];
        return h('button', {
          class: ['rt-wg-tile', on && 'on'], style: { '--c': r.color }, title: routineName(r), dataset: { routine: r.id },
          onClick: (e) => { e.stopPropagation(); if (!preview) engine().then((m) => m.toggleRoutine(r.id)); },
        },
          h('span', { class: 'rt-wg-ico', html: icon(on ? 'stop' : r.icon, size === 's' ? 28 : 22) }),
          h('span', { class: 'rt-wg-name' }, routineName(r)),
          size === 's' ? h('span', { class: 'rt-wg-sub' }, on ? t('routines.running') : t('routines.run')) : null);
      })));
    };
    draw();
    const offs = [store.on(KEY, draw), store.on(RUN_KEY, draw)];
    return () => offs.forEach((f) => f());
  },
});
registerWidget({
  id: 'modes',
  name: 'routines.widgetModes',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'routines',
  render(el, { size, preview }) {
    el.classList.add('wg-modes', 'w-' + size);
    const draw = () => {
      const a = activeMode(), d = rdata();
      if (size === 's') {
        const m = a?.mode || d.modes.find((x) => x.id === rrun().lastMode) || d.modes[0];
        el.style.setProperty('--c', m.color);
        el.classList.toggle('on', !!a);
        el.replaceChildren(
          h('div', { class: 'wg-head' }, h('span', { html: icon('rtModes', 16) }), t('routines.widgetModes')),
          h('div', { class: 'rt-wgm-big', html: icon(m.icon, 34) }),
          h('div', { class: 'rt-wgm-name' }, a ? modeName(m) : t('routines.noMode')),
          h('button', { class: 'rt-wgm-btn', onClick: (e) => { e.stopPropagation(); if (!preview) engine().then((x) => (a ? x.turnOffMode() : x.turnOnMode(m.id))); } }, a ? t('routines.turnOff') : modeName(m)));
        return;
      }
      el.replaceChildren(
        h('div', { class: 'wg-head' }, h('span', { html: icon('rtModes', 16) }), a ? t('routines.modeOn', { name: modeName(a.mode) }) : t('routines.widgetModes')),
        h('div', { class: 'rt-wgm-row' }, d.modes.slice(0, 4).map((m) => {
          const on = a?.mode.id === m.id;
          return h('button', { class: ['rt-wgm-mode', on && 'on'], style: { '--c': m.color }, title: modeName(m), onClick: (e) => { e.stopPropagation(); if (!preview) engine().then((x) => (on ? x.turnOffMode() : x.turnOnMode(m.id))); } },
            h('span', { class: 'rt-wgm-ico', html: icon(m.icon, 22) }), h('span', { class: 'rt-wgm-label' }, modeName(m)));
        })));
    };
    draw();
    const offs = [store.on(KEY, draw), store.on(RUN_KEY, draw)];
    return () => offs.forEach((f) => f());
  },
});

// ——— this page's part ———
// The service worker can't play sound: it asks every open page to stop the ambient sound when a mode or routine ends.
let lastCmd = rrun().cmd?.at || 0;
store.on(RUN_KEY, (v) => {
  const cmd = normRun(v).cmd;
  if (cmd?.sound === 'stop' && cmd.at > lastCmd) {
    lastCmd = cmd.at;
    if (Date.now() - cmd.at < 60e3 && sounds.state().playing) sounds.pause();
  }
  // a page the user is looking at runs what the worker left for a page right away
  if (normRun(v).pending.length && document.visibilityState === 'visible' && document.hasFocus()) engine().then((m) => m.runPendingHere());
});
// A new tab is the "New tab opened" event, and runs what the worker left for a page (after unlock). The engine only
// loads when there is something to do.
if (isExt) {
  const want = rdata().list.some((r) => r.on && r.conds.some((c) => c.type === 'newtab')) || rrun().pending.length;
  if (want) setTimeout(() => engine().then((m) => m.bootPage()).catch((e) => console.warn('routines', e)), 400);
}
// "Screen unlocked" routines run when this tab's Lock screen goes away (hooks.js only reports a real unlock, so a tab
// that opens unlocked doesn't count). The engine only loads when a routine listens for it.
onUnlock(() => {
  if (rdata().list.some((r) => r.on && r.conds.some((c) => c.type === 'unlock'))) engine().then((m) => m.unlockedHere()).catch((e) => console.warn('routines', e));
});
// the Now Bar polls activities; a mode that ran out while no worker was awake turns off here
everySecond(() => {
  const st = rrun().mode;
  if (st?.until && st.until < Date.now() - 5000) engine().then((m) => m.tickHere());
});
