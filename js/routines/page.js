// Modes and Routines on a Bloom Tab page: the page's run context (dialogs, sounds, Focus, the Lock screen, apps,
// notes, reminders through their own modules) and what the UI, widgets, Finder and the Quick Panel call:
// toggleRoutine(), stopRoutine(), turnOnMode(), turnOffMode(). Also runs "New tab opened" routines and the work the
// service worker left for a page.
import { h, isExt } from '../core/util.js';
import { store } from '../core/store.js';
import { t, locale, addStrings, fmtTime } from '../core/i18n.js';
import { toast, dialog } from '../core/ui.js';
import { openApp } from '../core/apps.js';
import { notify } from '../core/notify.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import { startFocus, stopFocus } from '../shell/quickpanel.js';
import * as sounds from '../shell/sounds.js';
import { KEY, RUN_KEY, norm, normRun, hasEnd } from './model.js';
import { RunError, toText } from './actions.js';
import * as E from './engine.js';

const name = (r) => r?.name || t('routines.untitled');
const modeLabel = (m) => m.name || (m.preset ? t('routines.mode.' + m.preset) : t('routines.mode.custom'));

/** Resolves once the Lock screen is gone (nothing runs behind it). */
export function whenUnlocked() {
  if (!document.body.classList.contains('locked')) return Promise.resolve();
  return new Promise((res) => {
    const mo = new MutationObserver(() => {
      if (document.body.classList.contains('locked')) return;
      mo.disconnect();
      setTimeout(res, 400);
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
}

// ——— dialogs used by actions ———
function radioList(options, value, onPick) {
  return h('div', { class: 'ou-radio-list' }, options.map((o, i) =>
    h('label', { class: 'ou-radio-row' },
      h('input', { type: 'radio', name: 'rt-pick', checked: o.value === value, onChange: () => onPick(o.value, i) }),
      h('span', { class: 'ou-radio' }),
      h('span', { class: 'ou-radio-text' }, h('span', null, o.label), o.sub ? h('small', null, o.sub) : null))));
}
const helpers = {
  setSettings: async (patch) => {
    const s = { ...store.get('settings'), ...patch };
    store.set('settings', s);
    if (isExt) await chrome.storage.local.set({ settings: s });
  },
  isDark: () => document.documentElement.dataset.theme === 'dark',
  startFocus: (min) => startFocus(min),
  stopFocus: () => stopFocus(),
  sound: (id) => sounds.play(id),
  stopSound: () => sounds.pause(),
  soundState: () => { const s = sounds.state(); return { playing: s.playing, id: s.id }; },
  lock: () => import('../shell/lock.js').then((m) => m.lockNow()),
  openApp: (id) => openApp(id),
  note: async (fields) => (await import('../apps/notes.js')).createNote(fields),
  async reminder(title, due) {
    const m = await import('../apps/reminder.js');
    // "Call Sam tomorrow at 6" understands the time in the title when no time was given
    const q = due ? null : m.parseQuickTime(title);
    return m.addReminder({ title: q?.title || title, due: due || q?.due || null });
  },
  toast: (msg) => toast(String(msg ?? '')),
  alert: ({ title, text, cancel }) => dialog({
    title: title || null, message: text || ' ',
    actions: cancel ? [{ label: t('common.cancel'), value: false }, { label: t('common.ok'), value: true, primary: true }] : [{ label: t('common.ok'), value: true, primary: true }],
    dismissable: false,
  }).then(Boolean),
  ask({ prompt, kind = 'text', value = '', labelKey }) {
    const input = h('input', { class: 'ou-input', type: kind === 'number' ? 'text' : kind === 'url' ? 'url' : 'text', inputmode: kind === 'number' ? 'decimal' : null, value: toText(value) });
    return dialog({
      title: (labelKey ? t(prompt) : prompt) || t('routines.a.ask'),
      content: h('div', { class: 'ou-dialog-body' }, input),
      actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => input.value, primary: true }],
    });
  },
  menu(prompt, items) {
    if (!items?.length) return Promise.resolve(null);
    let picked = 0;
    return dialog({
      title: prompt || t('routines.a.menu'),
      content: radioList(items.map((x, i) => ({ value: i, label: x || t('routines.item', { n: i + 1 }) })), 0, (v) => (picked = v)),
      actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => picked, primary: true }],
    });
  },
};

/** The run context on this page (see js/routines/engine.js). */
export function pageCtx() {
  const stops = new Set();
  const ctx = {
    env: 'page', page: helpers, locale: locale(), stopped: false,
    async get(k) {
      // routinesRun is shared with the worker and other tabs: read it fresh, not from this page's copy
      if (isExt && (k === RUN_KEY || k === KEY)) return (await chrome.storage.local.get(k))[k];
      return structuredClone(store.get(k));
    },
    async set(k, v) {
      store.set(k, v);
      if (isExt) await chrome.storage.local.set({ [k]: v });
    },
    notify: (title, body) => notify({ app: 'routines', title: title || t('app.routines'), body: toText(body), icon: 'rtRoutine' }),
    schedule: scheduleAt,
    cancel: cancelSchedule,
    loc() {
      const s = store.get('settings').location, w = store.get('weather')?.location;
      return s?.lat != null ? s : w?.lat != null ? w : null;
    },
    lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request('bt-routines', fn) : fn()),
    report: (who, e) => {
      if (!(e instanceof RunError)) console.warn('routine', who, e);
      return dialog({ title: t('routines.problem', { name: who || t('app.routines') }), message: e instanceof RunError ? t(e.key, e.vars) : t('routines.err.generic'), actions: [{ label: t('common.ok'), value: true, primary: true }] });
    },
    onStop: (fn) => stops.add(fn),
    stop() { ctx.stopped = true; stops.forEach((fn) => { try { fn(); } catch {} }); },
  };
  return ctx;
}

// ——— what the UI, widgets, Finder and the Quick Panel call ———
const busy = new Set();
const busyListeners = new Set();
export const isBusy = (id) => busy.has(id);
export const onBusy = (fn) => (busyListeners.add(fn), () => busyListeners.delete(fn));
const setBusy = (id, on) => { if (on) busy.add(id); else busy.delete(id); busyListeners.forEach((fn) => fn(id)); };

/** Starts a routine by hand, or stops it when it is running. */
export async function toggleRoutine(id) {
  if (normRun(store.get(RUN_KEY)).running[id]) return stopRoutine(id);
  return runRoutine(id);
}
export async function runRoutine(id) {
  const r = norm(store.get(KEY)).list.find((x) => x.id === id);
  if (!r || busy.has(id)) return null;
  setBusy(id, true);
  try {
    const res = await E.startRoutine(pageCtx(), id, { by: 'manual' });
    if (res.ok) toast(t(res.running ? 'routines.started' : 'routines.ran', { name: name(r) }));
    return res;
  } finally {
    setBusy(id, false);
  }
}
export async function stopRoutine(id) {
  const r = norm(store.get(KEY)).list.find((x) => x.id === id);
  const done = await E.endRoutine(pageCtx(), id, { by: 'manual' });
  if (done && r) toast(t('routines.stopped', { name: name(r) }));
  return done;
}
export async function turnOnMode(id, { until = null } = {}) {
  const m = norm(store.get(KEY)).modes.find((x) => x.id === id);
  if (!m) return false;
  await E.modeOn(pageCtx(), id, { until, by: 'manual' });
  toast(until ? t('routines.modeOnUntil', { name: modeLabel(m), time: fmtTime(new Date(until)) }) : t('routines.modeOnToast', { name: modeLabel(m) }));
  return true;
}
export async function turnOffMode() {
  const st = normRun(store.get(RUN_KEY)).mode;
  const m = st && norm(store.get(KEY)).modes.find((x) => x.id === st.id);
  const done = await E.modeOff(pageCtx(), { by: 'manual' });
  if (done && m) toast(t('routines.modeOffToast', { name: modeLabel(m) }));
  return done;
}
/** Time-based work from this page (after saving a routine or a schedule, or when a mode's time ran out). */
let ticking = null, tickAt = 0;
export function tickHere() {
  if (ticking || Date.now() - tickAt < 5000) return ticking;
  tickAt = Date.now();
  ticking = whenUnlocked().then(() => E.tick(pageCtx())).catch((e) => console.warn('routines tick', e)).finally(() => (ticking = null));
  return ticking;
}
/** Runs what the worker left for a page, and clears its "Tap to run" notifications. */
let pendingRun = null;
export function runPendingHere() {
  if (pendingRun) return pendingRun;
  pendingRun = (async () => {
    await whenUnlocked();
    const ctx = pageCtx();
    const list = await E.takePending(ctx);
    if (!list.length) return;
    if (isExt) list.forEach((p) => chrome.notifications?.clear('routine:p:' + p.key));
    await E.runPending(ctx, list);
  })().catch((e) => console.warn('routines pending', e)).finally(() => (pendingRun = null));
  return pendingRun;
}
/** A new tab opened: run "New tab opened" routines and what the worker left for a page. */
export async function bootPage() {
  await whenUnlocked();
  await runPendingHere();
  await E.fire(pageCtx(), { type: 'newtab' });
}
/** The Lock screen of this tab went away: run "Screen unlocked" routines. */
export async function unlockedHere() {
  await whenUnlocked();
  return E.fire(pageCtx(), { type: 'unlock' });
}
export { hasEnd };

addStrings({
  en: {
    'routines.started': '“{name}” started',
    'routines.ran': '“{name}” done',
    'routines.stopped': '“{name}” stopped',
    'routines.modeOnToast': '{name} mode turned on',
    'routines.modeOnUntil': '{name} mode is on until {time}',
    'routines.modeOffToast': '{name} mode turned off',
    'routines.problem': 'There was a problem running “{name}”.',
    'routines.err.generic': 'Something went wrong.',
    'routines.item': 'Item {n}',
  },
  ar: {
    'routines.started': 'بدأ ”{name}“',
    'routines.ran': 'اكتمل ”{name}“',
    'routines.stopped': 'تم إيقاف ”{name}“',
    'routines.modeOnToast': 'تم تشغيل وضع {name}',
    'routines.modeOnUntil': 'وضع {name} قيد التشغيل حتى {time}',
    'routines.modeOffToast': 'تم إيقاف وضع {name}',
    'routines.problem': 'حدثت مشكلة أثناء تشغيل ”{name}“.',
    'routines.err.generic': 'حدث خطأ ما.',
    'routines.item': 'العنصر {n}',
  },
});
