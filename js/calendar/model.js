// Calendar data model, shared by the Calendar app, its widgets, the Lock screen, Now Brief, Finder search and the
// service worker (event alerts, .ics subscriptions). Pure functions only: no DOM, no storage, no translations, so
// .dev/calendar-model.mjs runs it in plain node and js/bg/calendar.js imports it. Ported from Liquid Tab's
// js/calendar/model.js, reworked for Bloom Tab's millisecond-based events.
//
// Stored events (`events` in storage) keep Bloom Tab's original shape, so the older readers (Lock screen, Now Brief,
// Daily Board, Journal suggestions, Finder's "add event") keep working:
//   { id, title, start: ms, end: ms, allDay, color?, notes? }
//   all-day events start at local midnight of their first day and end at 23:59 of their last day.
// and may carry the newer, optional fields (nothing is rewritten up front; events are normalized when read):
//   cal        calendar id (default calendar when missing)
//   alerts     [minutes before the start] (two at most); all-day events count from 9:00 on their first day, so
//              0 = 9:00 that day and 1440 = 9:00 the day before. The legacy `alert` ('none' | '10' …) is still read.
//   repeat     { freq: 'day'|'week'|'month'|'year', interval, days?: [0-6] (weekly), pos?: 1-4|-1 + wd?: 0-6 (monthly
//              "on the fourth Monday"), until?: 'YYYY-MM-DD', count? }
//   exdates    ['YYYY-MM-DD'] occurrences removed from a repeating event
//   of, orig   a changed single occurrence ("Only this event"): the series id and the day it replaces
//   place, people: [text], tz (IANA zone the times were entered in; empty = this device's), uid (from .ics), updated
// Subscribed calendars keep their events apart, in `calSubEvents` ({ [sub id]: [event] }, written by the worker).
// Repeating events are expanded when they are read; each occurrence is the event plus
//   { key: id + '/' + 'YYYY-MM-DD', master: id, occ: 'YYYY-MM-DD', recurring }.

export const DAY = 864e5;
export const pad = (n) => String(n).padStart(2, '0');
const asDate = (d) => (d instanceof Date ? d : new Date(d ?? Date.now()));
export const dayStart = (d = new Date()) => { const x = asDate(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
export const addDays = (d, n) => { const x = asDate(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate() + n); };
export const dkey = (d = new Date()) => { const x = asDate(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
export const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
export const sameDay = (a, b) => dkey(a) === dkey(b);
/** Local wall-clock time on another day: keeps 9:00 at 9:00 across daylight-saving changes. */
export const atDay = (day, ms) => { const d = asDate(day), t = asDate(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()).getTime(); };

// Samsung Calendar's event colours (the first eight are Bloom Tab's original EVENT_COLORS).
export const PALETTE = ['#3e7bff', '#14b8a6', '#22a356', '#f5a524', '#ff6a3d', '#e5484d', '#e2589c', '#8a5cf6', '#00a3d9', '#7cb342', '#a1887f', '#78808c'];
export const DEFAULT_CALS = [{ id: 'my', name: null, color: '#3e7bff' }];
export const BIRTHDAYS_COLOR = '#22a356';
export const REMINDERS_COLOR = '#78808c';
export const DEFAULT_PREFS = {
  view: 'month',          // year | month | week | day | list
  hidden: [],             // calendar ids turned off in the drawer
  birthdays: true,        // Birthdays calendar (from Contacts)
  reminders: true,        // Reminders with a due date (from Reminder)
  birthdayColor: BIRTHDAYS_COLOR,
  firstDay: null,         // null = the region's, else 0 (Sunday) … 6 (Saturday)
  weekNumbers: false,
  alt: '',                // alternate calendar shown next to the dates: '' | 'islamic-umalqura' | 'persian' | 'hebrew' | 'chinese'
  defaultCal: 'my',
  alertTimed: [10],       // default reminders of new events (minutes before)
  alertAllDay: [0],       // 0 = 9:00 on the day
  hourH: 52,              // height of one hour in Week and Day views
};
export const ALERTS_TIMED = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const ALERTS_ALLDAY = [0, 1440, 2880, 10080];
export const ALLDAY_ALERT_AT = 540; // all-day reminders ring at 9:00
export const MAX_ALERTS = 2;

/** The alerts of a stored event: `alerts`, or the legacy single `alert` string. */
export function alertsOf(e) {
  if (Array.isArray(e?.alerts)) return [...new Set(e.alerts.map(Number).filter((n) => Number.isFinite(n)))].slice(0, MAX_ALERTS);
  const a = e?.alert;
  return a == null || a === '' || a === 'none' || !Number.isFinite(+a) ? [] : [+a];
}

export function validRepeat(r) {
  if (!r || !['day', 'week', 'month', 'year'].includes(r.freq)) return null;
  const out = { freq: r.freq, interval: Math.max(1, Math.min(999, r.interval | 0 || 1)) };
  if (r.freq === 'week' && Array.isArray(r.days) && r.days.length) out.days = [...new Set(r.days.map(Number).filter((x) => x >= 0 && x < 7))].sort((a, b) => a - b);
  if ((r.freq === 'month' || r.freq === 'year') && r.pos && [1, 2, 3, 4, -1].includes(+r.pos)) {
    out.pos = +r.pos;
    if (r.wd != null && r.wd >= 0 && r.wd < 7) out.wd = +r.wd;
  }
  if (isKey(r.until)) out.until = r.until;
  else if (r.count > 0) out.count = Math.min(9999, r.count | 0);
  return out;
}

/** A copy of a stored event with every field filled in (unknown fields are kept). */
export function norm(e, defaultCal = 'my') {
  let start = Number(e?.start);
  if (!Number.isFinite(start)) start = Date.now();
  let end = Number(e?.end);
  const allDay = !!e?.allDay;
  if (allDay) {
    start = dayStart(start).getTime();
    end = Number.isFinite(end) && end > start + 60e3 ? dayStart(end).getTime() + DAY - 60e3 : start + DAY - 60e3;
  } else if (!Number.isFinite(end) || end < start) end = start + 3600e3;
  return {
    ...e, id: e?.id != null ? String(e.id) : '', title: String(e?.title ?? ''), start, end, allDay,
    cal: e?.cal || defaultCal, place: String(e?.place || e?.location || ''), notes: String(e?.notes || ''),
    people: Array.isArray(e?.people) ? e.people.map((p) => String(p?.name ?? p)).filter(Boolean) : [],
    alerts: alertsOf(e), repeat: validRepeat(e?.repeat), exdates: Array.isArray(e?.exdates) ? e.exdates.filter(isKey) : [],
    tz: typeof e?.tz === 'string' ? e.tz : '', readOnly: !!e?.src,
  };
}

/** What gets stored: derived fields dropped, empty optional fields left out, anything else kept. */
const DERIVED = ['readOnly', 'key', 'master', 'occ', 'recurring', 'kind', 'calName', 'ownColor'];
export function pack(e) {
  const out = { ...e };
  for (const k of DERIVED) delete out[k];
  for (const k of ['place', 'notes', 'tz', 'color', 'of', 'orig', 'uid']) if (!out[k]) delete out[k];
  for (const k of ['exdates', 'people']) if (!Array.isArray(out[k]) || !out[k].length) delete out[k];
  if (!out.repeat) delete out.repeat;
  if (Array.isArray(out.alerts)) delete out.alert; // the legacy field once the new one is written
  return out;
}

// ——— repeating events ———
/** The pos-th (1-4, or -1 for the last) weekday wd of a month. */
export function nthWeekday(y, m, wd, pos) {
  if (pos === -1) { const last = new Date(y, m + 1, 0); return addDays(last, -((last.getDay() - wd + 7) % 7)); }
  const first = new Date(y, m, 1);
  return addDays(first, ((wd - first.getDay() + 7) % 7) + (pos - 1) * 7);
}
/** Which week of the month a date falls in (1-4, or -1 for the last one), for "every month on the fourth Monday". */
export const weekOfMonth = (d) => (addDays(d, 7).getMonth() !== asDate(d).getMonth() ? -1 : Math.ceil(asDate(d).getDate() / 7));

/** Start days (local midnight) of an event's occurrences with lo <= day < hi. A COUNT counts from the first one;
 *  removed days (exdates) still count, as in iCalendar. */
export function occurrenceDays(ev, lo, hi) {
  const s0 = dayStart(ev.start), r = ev.repeat;
  lo = dayStart(lo); hi = asDate(hi);
  if (!r) return s0 >= lo && s0 < hi ? [s0] : [];
  const until = isKey(r.until) ? addDays(parseKey(r.until), 1) : null;
  const end = until && until < hi ? until : hi;
  const counting = r.count > 0;
  const genLo = counting ? s0 : lo;
  const n = r.interval || 1, ex = new Set(ev.exdates || []);
  const out = [];
  let seen = 0, done = false;
  const push = (d) => {
    if (d < s0) return;
    if (d >= end) { done = true; return; }
    if (counting && ++seen > r.count) { done = true; return; }
    if (d >= lo && !ex.has(dkey(d))) out.push(d);
  };
  if (end <= s0) return out;
  if (r.freq === 'day') {
    let i = Math.max(0, Math.floor(daysBetween(s0, genLo) / n));
    for (let d = addDays(s0, i * n); !done && out.length < 3000; d = addDays(s0, ++i * n)) push(d);
  } else if (r.freq === 'week') {
    const days = r.days?.length ? r.days : [s0.getDay()];
    const anchor = addDays(s0, -s0.getDay());
    let w = Math.max(0, Math.floor(daysBetween(anchor, genLo) / 7 / n) - 1);
    for (let base = addDays(anchor, w * 7 * n); !done && out.length < 3000; base = addDays(anchor, ++w * 7 * n)) {
      for (const wd of days) { push(addDays(base, wd)); if (done) break; }
    }
  } else {
    const step = r.freq === 'year' ? 12 * n : n;
    const months = (genLo.getFullYear() - s0.getFullYear()) * 12 + genLo.getMonth() - s0.getMonth();
    let k = Math.max(0, Math.floor(months / step) - 1);
    for (let guard = 0; guard < 3000 && !done; guard++, k++) {
      const first = new Date(s0.getFullYear(), s0.getMonth() + k * step, 1);
      if (first >= end) break;
      const d = r.pos ? nthWeekday(first.getFullYear(), first.getMonth(), r.wd ?? s0.getDay(), r.pos) : new Date(first.getFullYear(), first.getMonth(), s0.getDate());
      if (d.getMonth() === first.getMonth()) push(d); // the 31st only in long months, Feb 29 only in leap years
    }
  }
  return out;
}

/** All occurrences of normalized events that overlap [from, to), sorted (all-day first, then by start). */
export function expand(list, from, to) {
  const f = +asDate(from), tt = +asDate(to), out = [];
  for (const ev of list) {
    const span = daysBetween(ev.start, ev.end);
    for (const d of occurrenceDays(ev, addDays(f, -span - 1), new Date(tt))) {
      const dk = dkey(d), shift = daysBetween(ev.start, d);
      const start = shift ? atDay(d, ev.start) : ev.start;
      const end = shift ? atDay(addDays(ev.end, shift), ev.end) : ev.end;
      if ((end > f || (start >= f && start < tt)) && start < tt) out.push({ ...ev, start, end, key: ev.id + '/' + dk, master: ev.id, occ: dk, recurring: !!ev.repeat });
    }
  }
  return out.sort(byStart);
}
export const byStart = (a, b) => (b.allDay - a.allDay) || (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)) || String(a.title).localeCompare(String(b.title));
/** True when an occurrence spans more than one day (shown as a bar across the days in Month and Week views). */
export const isMulti = (o) => o.allDay || daysBetween(o.start, Math.max(o.start, o.end - 1)) > 0;
/** Week and Day views draw an event as a bar in the all-day row when it is all-day or lasts a day or more; a
 *  shorter one that crosses midnight is a block in each day's column. */
export const isLong = (o) => o.allDay || o.end - o.start >= DAY;
/** The last day an occurrence touches (an event ending at 00:00 ends the day before). */
export const lastDay = (o) => dayStart(Math.max(o.start, o.end - 1));

/** Reminders with a due date, as read-only occurrences of the Reminders calendar. Reads Reminder's data
 *  defensively (an array, or { items, lists }; due as ms or 'YYYY-MM-DD[THH:MM]'). */
export function reminderItems(rem, from, to, color = REMINDERS_COLOR) {
  const items = Array.isArray(rem?.items) ? rem.items : Array.isArray(rem) ? rem : [];
  const lists = new Map((Array.isArray(rem?.lists) ? rem.lists : []).map((l) => [l?.id, l]));
  const f = +asDate(from), tt = +asDate(to), out = [];
  for (const r of items) {
    if (!r || typeof r !== 'object' || !r.title) continue;
    let due = r.due ?? r.dueDate ?? r.date, timed = true;
    if (typeof due === 'string') {
      const m = due.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
      if (!m) continue;
      const d = parseKey(m[1]);
      if (m[2]) d.setHours(+m[2], +m[3]);
      else timed = !!(r.time && /^\d{1,2}:\d{2}$/.test(r.time)) && (d.setHours(...r.time.split(':').map(Number)), true);
      due = d.getTime();
    }
    if (!Number.isFinite(due)) continue;
    if (r.allDay) timed = false;
    const start = timed ? due : dayStart(due).getTime();
    // a reminder is a moment: half an hour long in the timelines, never running into the next day
    const end = timed ? Math.min(due + 30 * 60e3, addDays(due, 1).getTime()) : start + DAY - 60e3;
    if (!(end > f && start < tt)) continue;
    const dk = dkey(start), id = 'rem:' + r.id;
    out.push({ kind: 'reminder', id, rid: r.id, title: String(r.title), start, end, allDay: !timed, done: !!(r.done || r.completed), cal: 'reminders',
      color: lists.get(r.list)?.color || color, readOnly: true, notes: typeof r.notes === 'string' ? r.notes : '', place: '', people: [], alerts: [], exdates: [], repeat: null,
      key: id + '/' + dk, master: id, occ: dk, recurring: false });
  }
  return out;
}

/**
 * Lays out the timed occurrences of one day column: overlapping events sit side by side.
 * Returns [{ o, top, bottom (minutes from midnight), col, cols, span }].
 */
export function layoutColumn(list, day) {
  const d0 = dayStart(day).getTime(), d1 = addDays(day, 1).getTime();
  const items = list.map((o) => {
    const top = Math.max(0, (Math.max(o.start, d0) - d0) / 60000);
    const bottom = Math.min(1440, (Math.min(o.end, d1) - d0) / 60000);
    return { o, top, bottom: Math.max(bottom, top + 15), col: 0, cols: 1, span: 1 };
  }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster = [], colsEnd = [], clusterEnd = -1;
  const close = () => {
    const n = colsEnd.length;
    for (const it of cluster) it.cols = n;
    for (const it of cluster) {
      let s = 1;
      while (it.col + s < n && !cluster.some((x) => x !== it && x.col === it.col + s && x.top < it.bottom && x.bottom > it.top)) s++;
      it.span = s;
    }
    cluster = []; colsEnd = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd) { close(); clusterEnd = -1; }
    let c = colsEnd.findIndex((e) => e <= it.top);
    if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
    colsEnd[c] = it.bottom; it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  close();
  return items;
}

/** Bars (all-day and multi-day occurrences) of a run of days, in lanes: [{ o, c0, c1, cs, ce, lane }] + lane count. */
export function barLanes(occs, days, isBar = isMulti) {
  const from = dayStart(days[0]), to = addDays(days.at(-1), 1), bars = [];
  for (const o of occs) {
    if (!isBar(o) || o.start >= +to || o.end <= +from) continue;
    const last = lastDay(o);
    const c0 = Math.max(0, daysBetween(from, o.start)), c1 = Math.min(days.length - 1, daysBetween(from, last));
    if (c1 >= c0) bars.push({ o, c0, c1, cs: o.start < +from, ce: last >= to });
  }
  const lanes = [];
  for (const b of bars.sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0) || byStart(a.o, b.o))) {
    let l = lanes.findIndex((end) => end < b.c0);
    if (l < 0) { l = lanes.length; lanes.push(-1); }
    lanes[l] = b.c1; b.lane = l;
  }
  return { bars, lanes: lanes.length };
}

// ——— alerts ———
/** When an alert of an occurrence rings (ms). */
export const alertAt = (o, min) => (o.allDay ? dayStart(o.start).getTime() + ALLDAY_ALERT_AT * 60e3 : o.start) - min * 60e3;
/** Alert moments of the occurrences between from and to: [{ at, o, min }] by time. */
export function alertMoments(occs, from, to) {
  const out = [];
  for (const o of occs) for (const min of o.alerts || []) {
    const at = alertAt(o, min);
    if (at >= from && at < to) out.push({ at, o, min });
  }
  return out.sort((a, b) => a.at - b.at);
}
/** The next alert of a normalized event after `after` (ms), or null. Looks a little over a year ahead. */
export function nextAlert(ev, after = Date.now()) {
  if (!ev?.alerts?.length || ev.readOnly) return null;
  const lead = Math.max(...ev.alerts, 0) * 60e3;
  for (const days of [40, 800]) {
    const m = alertMoments(expand([ev], after - DAY, after + lead + days * DAY), after + 1, Infinity)[0];
    if (m) return m.at;
  }
  return null;
}

// ——— weeks ———
/** First day of the week (0 = Sunday) on or before a date. */
export const startOfWeek = (d, first = 0) => { const x = dayStart(d); return addDays(x, -((x.getDay() - first + 7) % 7)); };
/** ISO-8601 week number. */
export function isoWeek(d) {
  const x = asDate(d), t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}
/** Week number as Samsung Calendar shows it: ISO weeks when weeks start on Monday, otherwise the week holding
 *  January 1 is week 1. */
export function weekNumber(d, first = 1) {
  if (first === 1) return isoWeek(d);
  const ws = startOfWeek(d, first), we = addDays(ws, 6);
  if (we.getFullYear() > ws.getFullYear()) return 1;
  return Math.floor(daysBetween(startOfWeek(new Date(ws.getFullYear(), 0, 1), first), ws) / 7) + 1;
}

// ——— editing a series ———
/** Moves a repeat rule's weekdays along when the series moves by `days`. */
export function shiftRepeat(r, days) {
  if (!r || !days) return r;
  const s = ((days % 7) + 7) % 7;
  const out = { ...r };
  if (r.days?.length) out.days = r.days.map((d) => (d + s) % 7).sort((a, b) => a - b);
  if (r.wd != null) out.wd = (r.wd + s) % 7;
  return out;
}
/** Splits a repeating event at an occurrence ("This and future events"): [series ending the day before, rest from that day]. */
export function splitSeries(ev, occ) {
  const occDay = parseKey(occ), shift = daysBetween(ev.start, occDay);
  const r = { ...ev.repeat };
  let restCount = null;
  if (r.count) restCount = Math.max(1, r.count - occurrenceDays({ ...ev, exdates: [] }, ev.start, occDay).length);
  const before = { ...ev, repeat: { ...r, until: dkey(addDays(occDay, -1)) }, exdates: (ev.exdates || []).filter((x) => x < occ) };
  delete before.repeat.count;
  const after = { ...ev, start: atDay(occDay, ev.start), end: atDay(addDays(ev.end, shift), ev.end), exdates: (ev.exdates || []).filter((x) => x >= occ), repeat: { ...r } };
  if (restCount) after.repeat.count = restCount;
  return [before, after];
}

// ——— time zones ———
/** Wall-clock parts of an instant in a zone ('' = this device's). */
export function wallParts(ms, tz = '') {
  const d = new Date(ms);
  if (!tz) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  } catch { return wallParts(ms); }
}
/** The instant of a wall-clock time in a zone ('' = this device's). */
export function zonedMs(y, mo, d, h = 0, mi = 0, s = 0, tz = '') {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess;
  // two passes settle the zone offset, also next to a daylight-saving change
  for (let i = 0; i < 2; i++) {
    const p = wallParts(t, tz);
    t += guess - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  }
  return t;
}
/** 'YYYY-MM-DD' and 'HH:MM' of an instant in a zone. */
export function wallInputs(ms, tz = '') {
  const p = wallParts(ms, tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
/** The instant of 'YYYY-MM-DD' + 'HH:MM' in a zone. */
export function fromInputs(date, time = '00:00', tz = '') {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time || '00:00').split(':').map(Number);
  return zonedMs(y, m, d, hh || 0, mm || 0, 0, tz);
}
/** Minutes a zone is ahead of UTC at an instant. */
export function zoneOffset(tz, at = Date.now()) {
  const p = wallParts(at, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at / 1000) * 1000) / 60000);
}
