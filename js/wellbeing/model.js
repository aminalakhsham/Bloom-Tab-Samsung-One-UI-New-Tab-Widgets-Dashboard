// Digital Wellbeing maths shared by the service worker (js/bg/wellbeing.js), the app and its widgets
// (js/apps/wellbeing.js, js/wellbeing/ui.js) and the pause page (wellbeing-blocked.html). Pure: no DOM, no storage and
// no chrome.*, so every surface counts the same way and plain node can test it (.dev/wellbeing-model.mjs).
//
// Store key `wellbeingUsage` (written only by the service worker, so its minute-by-minute writes never race a page):
//   { days: { 'YYYY-MM-DD': { s: { site: seconds }, h: { '0'…'23': { site: seconds } }, n: notifications received,
//             u: unlocks, f: first use (ms), fh: its site } },              kept KEEP_DAYS days, hours included
//     g: { allow: { 'timer:<id>:<site>' | 'focus:<site>' | 'bed:<site>': until ms }, omm: { site: dayKey } (One more
//          minute used), warned / reached: { timerId: dayKey }, goal: dayKey, report: weekKey, unlockAt: ms } }
// Sites are recorded already grouped ("m.youtube.com" → "youtube.com", see categories.js siteOf()).
//
// Store key `wellbeing` (the person's choices, written by the pages): see prefs() below.
//   timers: [{ id, kind: 'site' | 'cat', target, min, days: [7 × minutes, Sunday first] | null, on }]
//   modes: [{ id, name (custom only), icon, color, block: 'distracting' | 'all', allowed: [site], minutes }]
//   focus: { id, startedAt, endsAt | 0 } while a Focus mode runs (ended once endsAt has passed)
//   bedtime: { on, from: 'HH:MM', to: 'HH:MM', days: [weekday], gray, block, allowed: [site], until: ms (on now until),
//              skip: ms (scheduled time skipped until) }

export const KEEP_DAYS = 35;
const DAY = 86400000;
const p2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ dates
export const dayKey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const isDayKey = (k) => /^\d{4}-\d\d-\d\d$/.test(k);
export const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const nextMidnight = (now = Date.now()) => addDays(startOfDay(now), 1).getTime();
export const weekStartOf = (d, ws = 0) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() - ws + 7) % 7)); return x; };
export const weekKey = (now = new Date(), ws = 0) => dayKey(weekStartOf(now, ws));
export const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? Math.min(1439, +m[1] * 60 + +m[2]) : 0; };
export const fromMin = (n) => `${p2(Math.floor(n / 60) % 24)}:${p2(n % 60)}`;

/** First day of the week for a locale (Intl week info), Monday when unknown. */
export function firstDayFor(loc = 'en-US') {
  try {
    const l = new Intl.Locale(loc);
    const wi = l.getWeekInfo?.() || l.weekInfo;
    if (wi?.firstDay) return wi.firstDay % 7;
  } catch {}
  return /-(US|CA|MX|BR|JP|IL|SA|PH)$/i.test(loc) ? 0 : 1;
}

/** The next time the clock reads `hhmm` after `now` (ms). */
export function nextTimeOf(hhmm, now = Date.now()) {
  const m = toMin(hhmm), d = new Date(now);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// ------------------------------------------------------------------ the person's choices
export const DISTRACTING = ['social', 'entertainment', 'games', 'shopping'];
export const MODE_COLORS = ['#3e8bff', '#2fb36b', '#9b6cf5', '#ff8a3d', '#f2556b', '#1fae96'];
export const DEFAULT_MODES = [
  { id: 'work', icon: 'wbWork', color: '#3e8bff', block: 'distracting', allowed: [], minutes: 0 },
  { id: 'me', icon: 'wbLeaf', color: '#2fb36b', block: 'distracting', allowed: [], minutes: 0 },
];
export const DEFAULT_BEDTIME = { on: false, from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4, 5, 6], gray: true, block: false, allowed: [], until: 0, skip: 0 };
const arr = (v) => (Array.isArray(v) ? v : []);
const strs = (v) => arr(v).filter((x) => typeof x === 'string' && x);

/** `wellbeing` with every default filled in and junk dropped, whatever was stored. */
export function prefs(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const bt = { ...DEFAULT_BEDTIME, ...(w.bedtime && typeof w.bedtime === 'object' ? w.bedtime : {}) };
  bt.days = arr(bt.days).filter((d) => d >= 0 && d < 7);
  bt.allowed = strs(bt.allowed);
  const modes = Array.isArray(w.modes) ? w.modes.filter((m) => m && m.id) : DEFAULT_MODES;
  return {
    setup: !!w.setup,
    goal: Math.max(0, Math.round(+w.goal || 0)), // minutes a day, 0 = no goal
    timers: arr(w.timers).filter((x) => x && x.id && x.target).map((x) => ({ kind: 'site', min: 60, days: null, on: true, ...x })),
    modes: modes.map((m) => ({ block: 'distracting', minutes: 0, ...m, allowed: strs(m.allowed) })),
    focus: w.focus && w.focus.id ? w.focus : null,
    focusSessions: w.focusSessions !== false,
    distracting: { cats: Array.isArray(w.distracting?.cats) ? w.distracting.cats : DISTRACTING, sites: strs(w.distracting?.sites) },
    bedtime: bt,
    report: w.report !== false,
    cats: w.cats && typeof w.cats === 'object' ? w.cats : {},
  };
}

// ------------------------------------------------------------------ recording (service worker)
/** One day in the current shape, whatever was saved (corrupt values are skipped). Doesn't change `raw`. */
export function readDay(raw) {
  if (!raw || typeof raw !== 'object') return { s: {}, h: {}, n: 0, u: 0, f: 0, fh: '' };
  const s = {};
  for (const [k, v] of Object.entries(raw.s && typeof raw.s === 'object' ? raw.s : {})) if (+v > 0 && isFinite(v)) s[k] = +v;
  return { s, h: raw.h && typeof raw.h === 'object' ? raw.h : {}, n: +raw.n || 0, u: +raw.u || 0, f: +raw.f || 0, fh: raw.fh || '' };
}
export const dayTotal = (day) => Object.values(readDay(day).s).reduce((a, b) => a + b, 0);

/** Adds the time spent on `site` between `from` and `to` (ms), split at hours and midnights. Returns `days`. */
export function record(days, site, from, to) {
  for (let t = from; t < to;) {
    const d = new Date(t), next = new Date(d);
    next.setMinutes(60, 0, 0);
    const end = Math.min(to, next.getTime()), sec = Math.round((end - t) / 1000), k = dayKey(d);
    if (sec > 0) {
      const day = (days[k] = readDay(days[k]));
      day.s[site] = (day.s[site] || 0) + sec;
      const hr = (day.h[d.getHours()] ||= {});
      hr[site] = (hr[site] || 0) + sec;
      if (!day.f || t < day.f) {
        day.f = t;
        day.fh = site;
      }
    }
    t = end;
  }
  return days;
}

/** Adds one to today's notifications (`n`) or unlocks (`u`). */
export function bump(days, field, now = Date.now()) {
  const k = dayKey(now);
  const day = (days[k] = readDay(days[k]));
  day[field] = (day[field] || 0) + 1;
  return days;
}

/** Drops days older than KEEP_DAYS so the key stays small. */
export function prune(days, now = new Date()) {
  const keep = dayKey(addDays(now, -(KEEP_DAYS - 1)));
  for (const k of Object.keys(days)) if (!isDayKey(k) || k < keep) delete days[k];
  return days;
}

// ------------------------------------------------------------------ reports
/**
 * A day (24 hourly bars) or a week (7 daily bars), with the change against the 7 days before (day) or the week before
 * (week, daily averages). `catOf(site)` groups by category; `only` keeps one { site } or { cat }.
 * → { mode, start, total, avg, change, bars: [{ total, sites }], sites: [[site, sec]], cats: [[cat, sec]], n, u, first, oldest }
 */
export function period(usage, { mode = 'day', offset = 0, ws = 1, now = new Date(), catOf = () => 'other', only = null } = {}) {
  const days = usage?.days && typeof usage.days === 'object' ? usage.days : {};
  const today = startOfDay(now);
  const keys = Object.keys(days).filter((k) => isDayKey(k) && (dayTotal(days[k]) > 0 || readDay(days[k]).u || readDay(days[k]).n)).sort();
  const firstKey = keys[0] || dayKey(today);
  const pick = (site) => !only || (only.site ? site === only.site : catOf(site) === only.cat);
  const sumDay = (d) => { let n = 0; for (const [site, v] of Object.entries(readDay(days[dayKey(d)]).s)) if (pick(site)) n += v; return n; };
  // averages only count days that can have data: not in the future, not before the first day anything was recorded
  const avgOf = (list) => {
    const live = list.filter((d) => d <= today && dayKey(d) >= firstKey);
    return live.length ? { avg: live.reduce((a, d) => a + sumDay(d), 0) / live.length, n: live.length } : { avg: 0, n: 0 };
  };
  const sites = {}, cats = {};
  let bars, total = 0, start, cur, prev, first = null, n = 0, u = 0;
  const add = (site, v) => {
    sites[site] = (sites[site] || 0) + v;
    const c = catOf(site);
    cats[c] = (cats[c] || 0) + v;
    total += v;
  };
  if (mode === 'day') {
    start = addDays(today, offset);
    const day = readDay(days[dayKey(start)]);
    bars = Array.from({ length: 24 }, (_, hr) => {
      const b = { total: 0, sites: {} };
      for (const [site, v] of Object.entries(day.h[hr] || {})) if (pick(site) && +v > 0) { b.sites[site] = +v; b.total += +v; }
      return b;
    });
    for (const [site, v] of Object.entries(day.s)) if (pick(site)) add(site, v);
    if (day.f && pick(day.fh)) first = { at: day.f, site: day.fh };
    n = day.n;
    u = day.u;
    cur = { avg: total, n: start <= today ? 1 : 0 };
    prev = avgOf(Array.from({ length: 7 }, (_, i) => addDays(start, -7 + i)));
  } else {
    start = addDays(weekStartOf(today, ws), offset * 7);
    const list = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    bars = list.map((d) => {
      const day = readDay(days[dayKey(d)]), b = { total: 0, sites: {} };
      for (const [site, v] of Object.entries(day.s)) if (pick(site)) { b.sites[site] = v; b.total += v; add(site, v); }
      n += day.n;
      u += day.u;
      return b;
    });
    cur = avgOf(list);
    prev = avgOf(Array.from({ length: 7 }, (_, i) => addDays(start, -7 + i)));
  }
  const avg = mode === 'day' ? total : cur.avg;
  return {
    mode, start, total, avg, prevAvg: prev.avg, first, only, n, u,
    change: cur.n && prev.n && prev.avg > 0 ? (avg - prev.avg) / prev.avg : null,
    bars,
    sites: Object.entries(sites).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    cats: Object.entries(cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    oldest: keys[0] ? parseKey(keys[0]) : today,
  };
}

/** The last full week before `now` (what the Monday notification and the Weekly report describe). */
export const weekReport = (usage, opts = {}) => period(usage, { ...opts, mode: 'week', offset: -1 });

/** The biggest `n` slices of a sorted [[key, sec]] list, the rest summed as 'other'. */
export function slices(list, n = 4) {
  const top = list.slice(0, n).map(([k, v]) => ({ key: k, sec: v }));
  const rest = list.slice(n).reduce((a, [, v]) => a + v, 0);
  if (rest > 0) top.push({ key: null, sec: rest });
  return top;
}

/** Every site seen in the data, most used first (for choosing timers and allowed sites). */
export function knownSites(usage) {
  const out = {};
  for (const [k, raw] of Object.entries(usage?.days || {})) if (isDayKey(k)) for (const [s, v] of Object.entries(readDay(raw).s)) out[s] = (out[s] || 0) + v;
  return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

/** A round top for a chart's scale (30 min, 1, 2, 4, 6, 8 hours, then multiples of 4 hours). */
export function axisMax(maxSec) {
  if (!(maxSec > 0)) return 3600;
  for (const hh of [0.5, 1, 2, 4, 6, 8]) if (maxSec <= hh * 3600) return hh * 3600;
  return Math.ceil(maxSec / 3600 / 4) * 4 * 3600;
}

export const durParts = (sec) => {
  sec = Math.max(0, Math.round(+sec || 0));
  return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), s: sec };
};

/** The weekly report sentence from three templates ({p} = percent, {t} = daily average). */
export function reportSentence(r, { down, up, avg }, dur, pct) {
  const tt = dur(r.avg);
  if (r.change == null || !isFinite(r.change) || Math.round(Math.abs(r.change) * 100) === 0) return avg.replace('{t}', tt);
  return (r.change < 0 ? down : up).replace('{p}', pct(Math.abs(r.change))).replace('{t}', tt);
}

// ------------------------------------------------------------------ site timers
export const inList = (list, site) => (list || []).some((x) => site === x || String(site).endsWith('.' + x));

/** Minutes allowed on that date (each weekday can have its own); 0 = no timer that day. */
export const timerMinutes = (tm, date = Date.now()) => Math.max(0, Math.round(+(Array.isArray(tm?.days) && tm.days.length === 7 ? tm.days[new Date(date).getDay()] : tm?.min) || 0));
export const timerCovers = (tm, site, catOf) => (tm.kind === 'cat' ? catOf(site) === tm.target : inList([tm.target], site));

/** Seconds used today against a timer; `live` = { site, sec } still being counted. */
export function timerUsed(tm, day, catOf, live = null) {
  let n = 0;
  for (const [site, v] of Object.entries(readDay(day).s)) if (timerCovers(tm, site, catOf)) n += v;
  if (live?.site && live.sec > 0 && timerCovers(tm, live.site, catOf)) n += live.sec;
  return n;
}

/** The timers that apply to this site today. */
export const timersFor = (w, site, now, catOf) => w.timers.filter((tm) => tm.on !== false && timerMinutes(tm, now) > 0 && timerCovers(tm, site, catOf));

// ------------------------------------------------------------------ Bedtime mode
/** Scheduled windows [start, end] (ms) that start from a day before `now` to `days` days after it. */
export function bedtimeWindows(bt, now = Date.now(), days = 8) {
  if (!bt?.on) return [];
  const out = [], base = startOfDay(now), a = toMin(bt.from), b = toMin(bt.to);
  if (a === b) return out;
  for (let i = -1; i <= days; i++) {
    const d = addDays(base, i);
    if (!(bt.days || []).includes(d.getDay())) continue;
    const s = new Date(d);
    s.setHours(0, a, 0, 0);
    const e = addDays(d, b > a ? 0 : 1);
    e.setHours(0, b, 0, 0);
    out.push([s.getTime(), e.getTime()]);
  }
  return out;
}

/** { active, until (when it ends), next (next scheduled start), nextEnd, manual, scheduled } for `wellbeing.bedtime`. */
export function bedtimeAt(bt, now = Date.now()) {
  bt = { ...DEFAULT_BEDTIME, ...(bt || {}) };
  const wins = bedtimeWindows(bt, now);
  const cur = wins.find(([a, b]) => a <= now && now < b && !(bt.skip > now && a < bt.skip));
  const manual = bt.until > now;
  const next = wins.map((w) => w[0]).filter((a) => a > now && !(bt.skip > a)).sort((a, b) => a - b)[0] || 0;
  const until = manual ? Math.max(bt.until, cur ? cur[1] : 0) : cur ? cur[1] : 0;
  return { active: manual || !!cur, until, next, manual, scheduled: !!cur };
}

/** "Turn on now" (until the next wake-up time) or "Turn off" (also skips the scheduled time running now). */
export function toggleBedtime(bt, now = Date.now()) {
  bt = { ...DEFAULT_BEDTIME, ...(bt || {}) };
  const st = bedtimeAt(bt, now);
  if (st.active) return { ...bt, until: 0, skip: st.scheduled ? st.until : bt.skip };
  return { ...bt, until: nextTimeOf(bt.to, now), skip: 0 };
}

// ------------------------------------------------------------------ Focus modes
/** The Focus mode running now, or null (a mode with an end time is over once it has passed). */
export function activeMode(w, now = Date.now()) {
  const f = w.focus;
  if (!f || (f.endsAt && f.endsAt <= now)) return null;
  return w.modes.find((m) => m.id === f.id) || null;
}
/** The shell's Focus session (Quick Panel, store key `focus`); endsAt null means "Until I turn it off". */
export const sessionOn = (focus, now = Date.now()) => !!(focus && (focus.endsAt == null ? focus.startedAt : focus.endsAt > now));
export const isDistracting = (w, site, catOf) => inList(w.distracting.sites, site) || w.distracting.cats.includes(catOf(site));

/**
 * Why `site` should be paused right now, or null: ['focus', modeId | 'session'] | ['bedtime'] | ['timer', timerId].
 * ctx = { w: prefs(), focus (store `focus`), usage (`wellbeingUsage`), now, catOf, live: { site, sec } }
 */
export function verdict(site, { w, focus, usage, now = Date.now(), catOf, live = null }) {
  const g = usage?.g || {};
  const pass = (k) => (g.allow?.[k] || 0) > now;
  const mode = activeMode(w, now);
  if (!pass('focus:' + site)) {
    if (mode && !inList(mode.allowed, site) && (mode.block === 'all' || isDistracting(w, site, catOf))) return ['focus', mode.id];
    if (w.focusSessions && sessionOn(focus, now) && isDistracting(w, site, catOf) && !(mode && inList(mode.allowed, site))) return ['focus', 'session'];
  }
  if (w.bedtime.block && bedtimeAt(w.bedtime, now).active && !inList(w.bedtime.allowed, site) && !pass('bed:' + site)) return ['bedtime'];
  const day = usage?.days?.[dayKey(now)];
  for (const tm of timersFor(w, site, now, catOf)) {
    if (!pass(`timer:${tm.id}:${site}`) && timerUsed(tm, day, catOf, live) >= timerMinutes(tm, now) * 60) return ['timer', tm.id];
  }
  return null;
}

export const DAY_MS = DAY;
