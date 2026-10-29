// Calendar data for pages: preferences, calendars (yours, subscriptions, Birthdays from Contacts, Reminders from
// Reminder), occurrences, upcoming events, edits with their `event:<id>` alarms, and search. Used by the Calendar
// app and by every surface that shows events (js/apps/calendar.js widgets and exports → Lock screen, Now Brief,
// Daily Board). Repeating events are expanded here (model.js); stored events are normalized when read.
import { store } from '../core/store.js';
import { t, lang } from '../core/i18n.js';
import { uid } from '../core/util.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import * as M from './model.js';
import { data as contactsData } from '../contacts/data.js';
import { birthdaysBetween } from '../contacts/model.js';

export const SUB_KEY = 'calSubEvents';

// ——— preferences ———
export const prefs = () => ({ ...M.DEFAULT_PREFS, ...(store.get('calPrefs') || {}) });
export function setPrefs(patch) {
  store.set('calPrefs', { ...(store.get('calPrefs') || {}), ...patch });
}

/** First day of the week: the Calendar setting, else the region's (Saturday in Arabic, like One UI in the Gulf). */
export function firstDay() {
  const f = store.get('calPrefs')?.firstDay;
  if (f != null && f >= 0 && f < 7) return +f;
  return regionFirstDay();
}
export function regionFirstDay() {
  if (lang() === 'ar') return 6;
  try {
    const l = new Intl.Locale(navigator.language || 'en-US');
    const wi = l.getWeekInfo?.() || l.weekInfo;
    if (wi?.firstDay) return wi.firstDay % 7;
  } catch {}
  return 0;
}

// ——— calendars ———
export const localCals = () => { const c = store.get('calendars'); return Array.isArray(c) && c.length ? c : M.DEFAULT_CALS; };
export const subs = () => { const s = store.get('calSubs'); return Array.isArray(s) ? s : []; };
export function calName(c) {
  if (c?.name) return c.name;
  return { my: t('cal.myCalendar'), birthdays: t('cal.birthdays'), reminders: t('cal.reminders') }[c?.id] || t('cal.calendar');
}
/** Every calendar of the drawer: yours, subscriptions, Birthdays and Reminders, each with { kind, hidden }. */
export function allCals() {
  const p = prefs(), hidden = new Set(p.hidden);
  const out = localCals().map((c) => ({ ...c, kind: 'local', name: calName(c) }));
  for (const s of subs()) out.push({ id: s.id, name: s.name || t('cal.calendar'), color: s.color || '#00a3d9', kind: 'sub', readOnly: true, error: s.error, last: s.last, url: s.url });
  if (p.birthdays) out.push({ id: 'birthdays', name: calName({ id: 'birthdays' }), color: p.birthdayColor || M.BIRTHDAYS_COLOR, kind: 'birthdays', readOnly: true });
  if (p.reminders) out.push({ id: 'reminders', name: calName({ id: 'reminders' }), color: M.REMINDERS_COLOR, kind: 'reminders', readOnly: true });
  return out.map((c) => ({ ...c, hidden: hidden.has(c.id) }));
}
export const calById = (id) => allCals().find((c) => c.id === id) || null;
export function defaultCalId() {
  const id = prefs().defaultCal, l = localCals();
  return l.some((c) => c.id === id) ? id : l[0].id;
}
export function setCalendars(list) {
  store.set('calendars', list);
}

// ——— events ———
export const stored = () => { const l = store.get('events'); return Array.isArray(l) ? l.filter((e) => e && typeof e === 'object' && e.id != null) : []; };
const subStored = () => { const m = store.get(SUB_KEY); return m && typeof m === 'object' ? m : {}; };
let memo = { src: null, subs: null, sig: '', list: [] };
/** Every event (yours and subscribed), normalized, with its calendar's colour unless it has its own. */
export function normalized() {
  const src = store.get('events'), sx = store.get(SUB_KEY), cals = localCals(), ss = subs();
  const sig = JSON.stringify(cals) + JSON.stringify(ss.map((s) => [s.id, s.color, s.name]));
  if (memo.src === src && memo.subs === sx && memo.sig === sig && src) return memo.list;
  const def = defaultCalId(), known = new Set(cals.map((c) => c.id));
  const color = new Map([...cals.map((c) => [c.id, c.color]), ...ss.map((s) => [s.id, s.color || '#00a3d9'])]);
  const list = stored().map((e) => {
    const n = M.norm(e, def);
    if (!known.has(n.cal)) n.cal = def; // its calendar was deleted
    n.ownColor = !!e.color;
    n.color = e.color || color.get(n.cal) || M.PALETTE[0];
    return n;
  });
  const live = new Set(ss.map((s) => s.id));
  for (const [id, evs] of Object.entries(subStored())) {
    if (!live.has(id) || !Array.isArray(evs)) continue;
    for (const e of evs) if (e && e.id != null) { const n = M.norm({ ...e, src: id }, id); n.cal = id; n.color = color.get(id); list.push(n); }
  }
  memo = { src, subs: sx, sig, list };
  return list;
}
export const byId = (id) => normalized().find((e) => e.id === id) || null;
export const rawById = (id) => stored().find((e) => e.id === id) || null;

/** Occurrences overlapping [from, to): hidden calendars left out unless `all`; Birthdays and Reminders unless turned off. */
export function occurrences(from, to, { all = false, reminders = true, birthdays = true } = {}) {
  const p = prefs(), hidden = new Set(all ? [] : p.hidden);
  const out = M.expand(normalized().filter((e) => !hidden.has(e.cal)), from, to);
  if (birthdays && p.birthdays && !hidden.has('birthdays')) {
    try { out.push(...contactBirthdays(from, to, p.birthdayColor || M.BIRTHDAYS_COLOR)); } catch (e) { console.warn('birthdays in calendar', e); }
  }
  if (reminders && p.reminders && !hidden.has('reminders')) {
    try { out.push(...M.reminderItems(store.get('reminders'), from, to)); } catch (e) { console.warn('reminders in calendar', e); }
  }
  return out.sort(M.byStart);
}

/** Birthdays from Contacts as read-only all-day occurrences of the Birthdays calendar ("Sara's birthday"). */
function contactBirthdays(from, to, color) {
  return birthdaysBetween(contactsData(), new Date(from), new Date(to)).map((b) => {
    const start = M.dayStart(b.date).getTime(), dk = M.dkey(start), id = 'bday:' + b.id;
    return {
      kind: 'birthday', id, cid: b.id, title: b.age > 0 ? t('cal.bdayAge', { name: b.name, n: b.age }) : t('cal.bday', { name: b.name }), start, end: start + M.DAY - 60e3,
      allDay: true, cal: 'birthdays', color, readOnly: true, repeat: { freq: 'year', interval: 1 }, recurring: true, alerts: [], exdates: [], people: [], place: '', notes: '',
      key: id + '/' + dk, master: id, occ: dk,
    };
  });
}

/** Next events that haven't ended (today's all-day events included), reminders left out. */
export function upcoming(limit = 3, now = Date.now()) {
  for (const days of [45, 400]) {
    const list = occurrences(M.dayStart(now), M.addDays(now, days), { reminders: false }).filter((o) => o.end > now);
    if (list.length >= limit || days === 400) return list.sort((a, b) => a.start - b.start || (b.allDay - a.allDay)).slice(0, limit);
  }
  return [];
}

/** Day keys between from and to that have at least one event (multi-day events mark every day). */
export function eventDays(from, to) {
  const out = new Set();
  for (const o of occurrences(from, to, { reminders: false })) {
    for (let d = M.dayStart(o.start); d <= M.lastDay(o) && d < to; d = M.addDays(d, 1)) out.add(M.dkey(d));
  }
  return out;
}

/** Occurrences of events matching a search (title, place, notes, invitees), the one nearest to today for each event. */
export function search(q, limit = 50) {
  const f = fold(q);
  if (!f) return [];
  const now = Date.now();
  const hits = occurrences(M.addDays(now, -366), M.addDays(now, 731), { reminders: false })
    .filter((o) => [o.title, o.place, o.notes, ...(o.people || [])].some((x) => fold(x).includes(f)));
  const best = new Map();
  for (const o of hits) {
    const cur = best.get(o.master), d = (x) => (x.end >= now ? x.start - now : (now - x.end) * 3); // upcoming first
    if (!cur || d(o) < d(cur)) best.set(o.master, o);
  }
  return [...best.values()].sort((a, b) => a.start - b.start).slice(0, limit);
}
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();

// ——— edits ———
/** Schedules (or clears) the event's `event:<id>` alarm for its next reminder; the worker plans the ones after. */
export function syncAlerts(raw) {
  if (!raw?.id) return;
  const n = M.norm(raw, defaultCalId());
  const next = n.readOnly ? null : M.nextAlert(n, Date.now());
  if (next) scheduleAt('event:' + n.id, next);
  else cancelSchedule('event:' + n.id);
}

/** Replaces stored events by id (patches merged into the stored copy), appends new ones, removes others; alarms follow. */
export function commit({ put = [], remove = [] } = {}) {
  const map = new Map(put.map((e) => [e.id, e]));
  const rm = new Set(remove);
  const now = Date.now();
  let list = stored().filter((e) => !rm.has(e.id)).map((e) => (map.has(e.id) ? M.pack({ ...e, ...map.get(e.id), updated: now }) : e));
  for (const [id, e] of map) if (!list.some((x) => x.id === id)) list.push(M.pack({ ...e, updated: now }));
  store.set('events', list);
  for (const id of rm) if (!map.has(id)) cancelSchedule('event:' + id);
  for (const id of map.keys()) syncAlerts(list.find((x) => x.id === id));
  return list;
}

/** Puts back a whole earlier `events` list (Undo) and re-plans the alarms of every event that changed. */
export function restore(before) {
  const now = stored();
  store.set('events', before);
  const ids = new Set([...before.map((e) => e.id), ...now.map((e) => e.id)]);
  for (const id of ids) {
    const e = before.find((x) => x.id === id);
    if (e) syncAlerts(e);
    else cancelSchedule('event:' + id);
  }
}

/** Adds an event with the default calendar and reminders. Returns the stored event. */
export function addEvent(partial) {
  const p = prefs();
  const ev = { id: uid(), title: '', cal: defaultCalId(), alerts: partial?.allDay ? [...p.alertAllDay] : [...p.alertTimed], ...partial };
  const n = M.norm(ev, defaultCalId());
  const out = M.pack({ ...ev, start: n.start, end: n.end, allDay: n.allDay });
  commit({ put: [out] });
  return out;
}
