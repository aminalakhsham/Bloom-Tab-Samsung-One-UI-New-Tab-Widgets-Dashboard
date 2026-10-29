// Service-worker side registry, so each app can keep its background jobs in its own js/bg/<app>.js module.
// Alarm and notification ids are "<kind>:<rest>"; a module claims a kind:
//
//   import { onAlarm, onButton, post, bgStrings } from './hub.js';
//   const S = { en: { due: 'Time for {name}' }, ar: { due: 'حان وقت {name}' } };
//   onAlarm('med', async (rest, alarm) => { const s = await bgStrings(S); post('med:' + rest, { app: 'health', … }); });
//   onButton('med', async (rest, index, nid) => { … });     // notification button clicked
//   openTarget('med', (rest) => ({ app: 'health', section: 'meds' }));  // what a click on the notification opens
//
// The SW can be stopped at any time: keep state in chrome.storage, never in module variables.
// Then add `import './js/bg/<app>.js';` to background.js.

export const alarmHandlers = new Map();
export const buttonHandlers = new Map();
export const clickTargets = new Map();
export const messageHandlers = new Map();

export const onAlarm = (kind, fn) => alarmHandlers.set(kind, fn);
export const onButton = (kind, fn) => buttonHandlers.set(kind, fn);
export const openTarget = (kind, fn) => clickTargets.set(kind, fn);
/** chrome.runtime messages { type, ... } from pages; the handler's return value is sent back. */
export const onMessage = (type, fn) => messageHandlers.set(type, fn);

/**
 * chrome.idle has one detection interval for the whole extension: every module that calls
 * chrome.idle.setDetectionInterval() must pass this, or they'd keep overriding each other.
 */
export const IDLE_SECONDS = 120;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const ICON = 'icons/icon128.png';

/** The app's language (setting `lang`, else Chrome's UI language). */
export async function bgLang() {
  const { settings } = await chrome.storage.local.get('settings');
  const pref = settings?.lang && settings.lang !== 'auto' ? settings.lang : chrome.i18n.getUILanguage().split('-')[0];
  return pref === 'ar' ? 'ar' : 'en';
}

/** Pick a module's { en, ar } string table for the app's language; fill "{x}" with fmt(s, vars). */
export async function bgStrings(table) {
  return { ...table.en, ...(table[await bgLang()] || {}) };
}
export const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export async function bgLocale() {
  return (await bgLang()) === 'ar' ? 'ar-u-nu-latn' : chrome.i18n.getUILanguage();
}

/**
 * System notification + an entry in the in-page notification list (store key `notifications`).
 * id is the chrome notification id ("<kind>:<rest>"), which routes button clicks and clicks back to the module.
 */
export async function post(id, { app, title, body = '', icon = 'bell', ref, buttons, sticky = false, silent = false }) {
  // Settings › Notifications: an app turned off posts nothing; Do not disturb keeps it in the list without a pop-up
  // (alarms and timers still ring)
  const { settings: s = {} } = await chrome.storage.local.get('settings');
  if ((s.mutedApps || []).includes(app)) return;
  const quiet = app !== 'clock' && dndActive(s.dnd);
  await addToList({ app, title, body, icon, ref, ...(quiet && { silent: true }) });
  if (quiet) return;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: ICON,
    title,
    message: body || ' ',
    priority: 2,
    requireInteraction: sticky,
    silent,
    buttons,
  });
}

/**
 * Do not disturb (Settings › Notifications), shared by the pages (core/notify.js) and the service worker:
 * dnd = { on, sched, from: 'HH:MM', to: 'HH:MM', days: [0..6] }. A schedule past midnight belongs to the day it starts.
 */
export function dndActive(dnd, now = new Date()) {
  if (!dnd) return false;
  if (dnd.on) return true;
  if (!dnd.sched) return false;
  const mins = (x) => { const [hh, mm] = String(x || '0:0').split(':').map(Number); return (hh || 0) * 60 + (mm || 0); };
  const from = mins(dnd.from || '22:00'), to = mins(dnd.to || '07:00'), cur = now.getHours() * 60 + now.getMinutes();
  const days = Array.isArray(dnd.days) && dnd.days.length ? dnd.days : [0, 1, 2, 3, 4, 5, 6];
  const day = now.getDay(), prev = (day + 6) % 7;
  if (from === to) return days.includes(day);
  if (from < to) return cur >= from && cur < to && days.includes(day);
  return (cur >= from && days.includes(day)) || (cur < to && days.includes(prev));
}

// Alarms often fire together (e.g. after the computer wakes): a read-modify-write of `notifications` per alarm
// would let the last one win, so every addition goes through one queue in this SW.
let listQueue = Promise.resolve();
/** Adds an entry to the in-page notification list (store key `notifications`, newest first, 60 kept). */
export function addToList(fields) {
  const n = { id: uid(), time: Date.now(), read: false, icon: 'bell', body: '', ...fields };
  listQueue = listQueue.then(async () => {
    const { notifications = [] } = await chrome.storage.local.get('notifications');
    await chrome.storage.local.set({ notifications: [n, ...notifications].slice(0, 60) });
  }).catch((e) => console.error('notifications', e));
  return listQueue;
}

/** "6:44 PM" / "٦:٤٤ م" in the app's language, not Chrome's. */
export async function bgTime(ms) {
  return new Date(ms).toLocaleTimeString(await bgLocale(), { hour: 'numeric', minute: '2-digit' });
}

export function scheduleAt(name, when) {
  if (!when || when <= Date.now()) return chrome.alarms.clear(name);
  chrome.alarms.create(name, { when });
}
