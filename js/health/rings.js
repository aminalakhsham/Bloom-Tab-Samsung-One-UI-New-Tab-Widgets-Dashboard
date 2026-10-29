// Daily activity, Samsung Health's three rings reimagined for life at the computer: Focus (minutes in Focus
// sessions), Tasks (reminders completed) and Breaks (hours with time away from the computer). Pure logic shared by
// the app, its widgets and the service worker: no DOM and no storage here.
//
// Sources (store keys):
//   focusLog: [{ start, end }] finished or stopped Focus sessions, newest first (Quick Panel / service worker)
//   focus: { startedAt, endsAt, minutes } while a session runs (it counts as it goes)
//   reminders: [{ done, completedAt }] (or { items: […] }) — Tasks counts the ones completed each day
//   healthAct: written only by the service worker (js/bg/health.js), so its small updates never race a page:
//     { v: 1, days: { 'YYYY-MM-DD': { breakH: [hours 0–23 with a break of 2+ minutes], activeH: [24] minutes at the
//       computer per hour, focus?, sessions?, done?: snapshots (so trimming focusLog or clearing completed reminders
//       keeps the history), told?: ['focus'|'done'|'breaks'|'all'] ring closings already announced } },
//       earned: { awardId: ['YYYY-MM-DD', …] }, base: { sessions, focusGoals, breakGoals, bestFocus, bestStreak } }
//   healthPrefs: written only by pages: { goals: { focus, done, breaks }, goalHist: [{ from, focus, done, breaks }],
//     notify: { coach, goals, awards, at }, seen: { awardId: count }, cards }

export const RINGS = ['focus', 'done', 'breaks'];
export const KEEP_DAYS = 400;
export const BREAK_MS = 2 * 60000;
export const GOALS = {
  focus: { def: 60, min: 15, max: 480, step: 5 },
  done: { def: 5, min: 1, max: 30, step: 1 },
  breaks: { def: 8, min: 1, max: 16, step: 1 },
};
// Samsung's Daily activity colours: flat rings with a light track of their own colour
export const COLORS = {
  focus: { c: '#1fbf83', track: 'rgba(31, 191, 131, .2)' },
  done: { c: '#3b8cff', track: 'rgba(59, 140, 255, .2)' },
  breaks: { c: '#ff4f7e', track: 'rgba(255, 79, 126, .2)' },
};
export const NOTIFY_DEF = { coach: true, goals: true, awards: true, at: 18 };

// ------------------------------------------------------------------ dates (local time)
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const keyDate = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d || 1); };
export const addDays = (k, n) => { const x = keyDate(k); x.setDate(x.getDate() + n); return dayKey(x); };
export const monthKey = (k) => String(k).slice(0, 7);
export const daysInMonth = (mk) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const addMonths = (mk, n) => { const [y, m] = mk.split('-').map(Number); const x = new Date(y, m - 1 + n, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
const dayDiff = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 86400000);
/** The first day of the week for a language (0 = Sunday … 6). */
export function weekStartOf(language = globalThis.navigator?.language || 'en-US') {
  try { const l = new Intl.Locale(language); const wi = l.getWeekInfo?.() || l.weekInfo; if (wi) return wi.firstDay % 7; } catch {}
  if (/^ar/i.test(language)) return 6;
  return /-(US|CA|MX|BR|JP|IL|SA|PH)$/i.test(language) ? 0 : 1;
}
export const weekOf = (k, ws = 1) => { const x = keyDate(k); return addDays(k, -((x.getDay() - ws + 7) % 7)); };

// ------------------------------------------------------------------ stored data, read safely
const arr24 = (a) => (Array.isArray(a) && a.length === 24 ? a.map((x) => +x || 0) : Array(24).fill(0));
const isKey = (k) => /^\d{4}-\d\d-\d\d$/.test(k);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
/** A safe, complete view of the `healthAct` value (old, missing or damaged data reads as empty). */
export function normLog(v) {
  const o = obj(v), b = obj(o.base);
  return { v: 1, days: obj(o.days), earned: obj(o.earned), base: { sessions: +b.sessions || 0, focusGoals: +b.focusGoals || 0, breakGoals: +b.breakGoals || 0, bestFocus: +b.bestFocus || 0, bestStreak: +b.bestStreak || 0 } };
}
/** One day of the log with every field present (a copy, safe to change). */
export function dayOf(log, k) {
  const o = obj(normLog(log).days[k]);
  return {
    breakH: Array.isArray(o.breakH) ? [...new Set(o.breakH.map(Number).filter((h) => h >= 0 && h < 24))].sort((a, b) => a - b) : [],
    activeH: arr24(o.activeH), told: Array.isArray(o.told) ? [...o.told] : [],
    ...(o.focus != null ? { focus: +o.focus || 0 } : {}), ...(o.sessions != null ? { sessions: +o.sessions || 0 } : {}), ...(o.done != null ? { done: +o.done || 0 } : {}),
  };
}
const clampGoal = (ring, v) => { const g = GOALS[ring]; v = Math.round(+v); return Number.isFinite(v) ? Math.min(g.max, Math.max(g.min, v)) : g.def; };
export function normPrefs(v) {
  const o = obj(v);
  const goals = Object.fromEntries(RINGS.map((r) => [r, clampGoal(r, o.goals?.[r] ?? GOALS[r].def)]));
  const goalHist = (Array.isArray(o.goalHist) ? o.goalHist : []).filter((h) => h && isKey(h.from)).sort((a, b) => (a.from < b.from ? -1 : 1));
  const n = obj(o.notify);
  return { ...o, goals, goalHist, notify: { ...NOTIFY_DEF, ...n, at: Math.min(22, Math.max(12, +n.at || NOTIFY_DEF.at)) }, seen: obj(o.seen) };
}
/** The goals that applied on a day: a goal change counts from the day it was made, so past days keep their old goal. */
export function goalsFor(prefs, k) {
  const p = normPrefs(prefs);
  let h = null;
  for (const x of p.goalHist) if (x.from <= k) h = x;
  if (!h && p.goalHist.length) h = p.goalHist[0];
  return h ? Object.fromEntries(RINGS.map((r) => [r, clampGoal(r, h[r] ?? p.goals[r])])) : p.goals;
}
/** healthPrefs after changing goals today (`patch` = { focus?, done?, breaks? }). */
export function withGoals(prefs, patch, today = dayKey()) {
  const p = normPrefs(prefs);
  const goals = { ...p.goals };
  for (const r of RINGS) if (patch[r] != null) goals[r] = clampGoal(r, patch[r]);
  // the goals in force until today are recorded first, so the days before keep them
  const hist = p.goalHist.filter((h) => h.from < today);
  if (!hist.length) hist.push({ from: '0000-00-00', ...p.goals });
  hist.push({ from: today, ...goals });
  return { ...obj(prefs), goals, goalHist: hist.slice(-60) };
}

// ------------------------------------------------------------------ Tasks: reminders completed
export const remItems = (r) => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
const doneCache = new WeakMap();
/** Each reminder checked off, by day and hour: { 'YYYY-MM-DD': [24] }. Subtasks completed together with their
 *  reminder count once, with it. */
export function doneHours(reminders) {
  if (reminders && typeof reminders === 'object' && doneCache.has(reminders)) return doneCache.get(reminders);
  const items = remItems(reminders);
  const byId = new Map(items.filter((x) => x?.id).map((x) => [x.id, x]));
  const at = (x) => +(x?.completedAt ?? x?.doneAt) || 0;
  const out = {};
  for (const r of items) {
    if (!r?.done || !at(r)) continue;
    const p = r.parent && byId.get(r.parent);
    if (p?.done && at(p) === at(r)) continue;
    const d = new Date(at(r));
    (out[dayKey(d)] ??= Array(24).fill(0))[d.getHours()]++;
  }
  if (reminders && typeof reminders === 'object') doneCache.set(reminders, out);
  return out;
}
export const doneCount = (reminders, k) => (doneHours(reminders)[k] || []).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ Focus: time in sessions
/** Splits [start, end) into the hours it covers: [{ day, h, min }]. */
export function splitHours(start, end) {
  const out = [];
  let t = start;
  while (t < end) {
    const d = new Date(t), next = new Date(d); next.setMinutes(60, 0, 0);
    const stop = Math.min(end, +next);
    out.push({ day: dayKey(d), h: d.getHours(), min: (stop - t) / 60000 });
    t = stop;
  }
  return out;
}
const focusCache = new WeakMap();
/** The logged sessions by day: { 'YYYY-MM-DD': { h: [24] minutes per hour, min, sessions } } (a session counts on
 *  the day it ended). */
export function focusDays(focusLog) {
  if (Array.isArray(focusLog) && focusCache.has(focusLog)) return focusCache.get(focusLog);
  const out = {};
  const day = (k) => (out[k] ??= { h: Array(24).fill(0), min: 0, sessions: 0 });
  for (const s of Array.isArray(focusLog) ? focusLog : []) {
    const a = +s?.start, b = +s?.end;
    if (!(a > 0) || !(b > a) || b - a > 24 * 3600e3) continue;
    for (const x of splitHours(a, b)) { const d = day(x.day); d.h[x.h] += x.min; d.min += x.min; }
    day(dayKey(b)).sessions++;
  }
  if (Array.isArray(focusLog)) focusCache.set(focusLog, out);
  return out;
}
/** The session running right now, by day and hour (what the log will get when it ends). */
export function liveFocus(focus, focusLog, now = Date.now()) {
  // endsAt null = "Until I turn it off": it runs until now
  const a = +focus?.startedAt, b = focus && focus.endsAt == null ? now : +focus?.endsAt;
  if (!(a > 0) || !(b > a) || now <= a) return [];
  // the tab or the service worker that ends a session logs it before clearing `focus`: never count it twice
  if (Array.isArray(focusLog) && focusLog.some((x) => +x?.start === a)) return [];
  return splitHours(a, Math.min(now, b));
}

// ------------------------------------------------------------------ the rings of a day
const ring = (v, goal) => ({ v, goal, p: goal > 0 ? v / goal : 0 });
const src = (s) => obj(s);
/** Focus minutes and sessions of a day: the log, at least the stored snapshot, plus a running session. */
function focusOn(k, s, d = dayOf(src(s).act, k)) {
  const { focusLog, focus, now = Date.now() } = src(s);
  const f = focusDays(focusLog)[k];
  let min = Math.max(f?.min || 0, d.focus || 0);
  for (const x of liveFocus(focus, focusLog, now)) if (x.day === k) min += x.min;
  return { min, sessions: Math.max(f?.sessions || 0, d.sessions || 0) };
}
/** The three rings of a day: { focus: { v, goal, p }, done: …, breaks: … }. `s` holds the store values
 *  { act, prefs, reminders, focusLog, focus, now }. */
export function ringsFor(k, s) {
  const { act, prefs, reminders, now = Date.now() } = src(s);
  const d = dayOf(act, k), g = goalsFor(prefs, k);
  const counted = reminders ? doneCount(reminders, k) : null;
  const done = counted == null ? d.done || 0 : k === dayKey(now) ? counted : Math.max(d.done || 0, counted);
  return { focus: ring(focusOn(k, s, d).min, g.focus), done: ring(done, g.done), breaks: ring(d.breakH.length, g.breaks) };
}
export const closed = (r) => ({ focus: r.focus.v >= r.focus.goal, done: r.done.v >= r.done.goal, breaks: r.breaks.v >= r.breaks.goal });
export const allClosed = (r) => RINGS.every((x) => r[x].v >= r[x].goal);
/** Everything the day page shows: the rings, their hourly charts, sessions and minutes at the computer. */
export function dayDetail(k, s) {
  const { act, reminders, focusLog, focus, now = Date.now() } = src(s);
  const d = dayOf(act, k);
  const focusH = [...(focusDays(focusLog)[k]?.h || Array(24).fill(0))];
  for (const x of liveFocus(focus, focusLog, now)) if (x.day === k) focusH[x.h] += x.min;
  const doneH = [...(doneHours(reminders)[k] || Array(24).fill(0))];
  return { day: k, rings: ringsFor(k, s), focusH, doneH, breakH: d.breakH, activeH: d.activeH, sessions: focusOn(k, s, d).sessions, active: d.activeH.reduce((a, b) => a + b, 0) };
}
/** The first day with any data (at most KEEP_DAYS back), or null. */
export function firstDay(s, today = dayKey(src(s).now ?? Date.now())) {
  const { act, reminders, focusLog } = src(s);
  const keys = [...Object.keys(normLog(act).days), ...Object.keys(doneHours(reminders)), ...Object.keys(focusDays(focusLog))].filter(isKey).sort();
  if (!keys.length) return null;
  const min = addDays(today, -KEEP_DAYS);
  return keys[0] < min ? min : keys[0] > today ? today : keys[0];
}
/** Day-by-day rings from `from` to `to` (inclusive): [{ day, r, c (closed), sessions, active }]. */
export function series(s, from, to) {
  const out = [];
  if (!from || from > to) return out;
  const log = normLog(src(s).act);
  for (let k = from, i = 0; k <= to && i < 4000; k = addDays(k, 1), i++) {
    const r = ringsFor(k, s), d = dayOf(log, k);
    out.push({ day: k, r, c: closed(r), sessions: focusOn(k, s, d).sessions, active: d.activeH.reduce((a, b) => a + b, 0) });
  }
  return out;
}
/** Days in a row (up to today) with all three rings closed; today counts once it is closed. */
export function streakOf(all, today) {
  let n = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const x = all[i];
    const full = x.c.focus && x.c.done && x.c.breaks;
    if (x.day === today && !full) continue;
    if (!full) break;
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ awards
// `once` awards are earned a single time; the others can be earned again (the app shows how many times).
export const AWARDS = [
  { id: 'perfect-day', group: 'rings' },
  { id: 'perfect-week', group: 'rings' },
  { id: 'perfect-week-focus', group: 'rings' },
  { id: 'perfect-week-done', group: 'rings' },
  { id: 'perfect-week-breaks', group: 'rings' },
  { id: 'perfect-month', group: 'rings' },
  { id: 'focus-record', group: 'rings' },
  { id: 'focus-streak', group: 'rings' },
  { id: 'focus-200', group: 'rings' },
  { id: 'focus-300', group: 'rings' },
  { id: 'focus-400', group: 'rings' },
  { id: 'first-breaks', group: 'rings', once: true },
  { id: 'goals-100', group: 'rings', once: true, n: 100 },
  { id: 'goals-365', group: 'rings', once: true, n: 365 },
  { id: 'sessions-1', group: 'sessions', once: true, n: 1 },
  { id: 'sessions-100', group: 'sessions', once: true, n: 100 },
  { id: 'sessions-500', group: 'sessions', once: true, n: 500 },
  { id: 'sessions-1000', group: 'sessions', once: true, n: 1000 },
];
export const AWARD = Object.fromEntries(AWARDS.map((a) => [a.id, a]));
export const isMonthAward = (id) => /^month-\d{4}-\d\d$/.test(id);
const ONCE = new Set(AWARDS.filter((a) => a.once).map((a) => a.id));

/** The monthly challenge (personal): odd months ask for a number of Focus ring closes, even months for Focus
 *  minutes, each a little more than the month before. Progress counts up to today. */
export function challengeFor(mk, s, all) {
  const today = dayKey(src(s).now ?? Date.now());
  all ??= series(s, firstDay(s, today), today);
  const by = new Map(all.map((x) => [x.day, x]));
  const dim = daysInMonth(mk), first = all[0]?.day;
  const sum = (m, f) => { let n = 0; for (let i = 1; i <= daysInMonth(m); i++) { const x = by.get(`${m}-${pad(i)}`); if (x) n += f(x); } return n; };
  const prev = addMonths(mk, -1);
  const prevHad = first && first < `${mk}-01`;
  const kind = +mk.slice(5) % 2 ? 'closes' : 'minutes';
  const avail = first && first.startsWith(mk) ? dim - +first.slice(8) + 1 : dim;
  let target;
  if (kind === 'closes') {
    const p = prevHad ? sum(prev, (x) => (x.c.focus ? 1 : 0)) : 0;
    target = prevHad && p ? Math.min(dim - 1, Math.max(6, Math.round(p * 1.1) + 1)) : Math.max(3, Math.min(12, Math.round(avail / 2)));
  } else {
    const p = prevHad ? sum(prev, (x) => x.r.focus.v) : 0;
    target = prevHad && p >= 300 ? Math.ceil((p * 1.1) / 50) * 50 : Math.max(150, Math.round((avail * 20) / 50) * 50);
  }
  let progress = 0, doneOn = null;
  for (let i = 1; i <= dim; i++) {
    const k = `${mk}-${pad(i)}`, x = by.get(k);
    if (!x || k > today) continue;
    progress += kind === 'closes' ? (x.c.focus ? 1 : 0) : x.r.focus.v;
    if (!doneOn && progress >= target) doneOn = k;
  }
  return { id: 'month-' + mk, month: mk, kind, target, progress: kind === 'minutes' ? Math.floor(progress) : progress, done: doneOn };
}

/** Every award the data earns: { earned: { id: [days] }, stats }. `weekStart` is 0 (Sunday) … 6. */
export function computeAwards(s, { weekStart = 1 } = {}) {
  const today = dayKey(src(s).now ?? Date.now());
  const base = normLog(src(s).act).base;
  const all = series(s, firstDay(s, today), today);
  const earned = {};
  const add = (id, k) => { const a = (earned[id] ??= []); if (!a.includes(k)) a.push(k); };
  let best = base.bestFocus, seen = 0, streak = 0, before = 0, bestStreak = base.bestStreak, inRecord = false;
  let sessions = base.sessions, goals = base.focusGoals, breakGoals = base.breakGoals;
  for (const x of all) {
    const { r, c } = x;
    if (c.focus && c.done && c.breaks) add('perfect-day', x.day);
    for (const [n, id] of [[2, 'focus-200'], [3, 'focus-300'], [4, 'focus-400']]) if (r.focus.v >= r.focus.goal * n) add(id, x.day);
    // a record needs a week of history first, so the first days don't each set one
    if (r.focus.v > best && best > 0 && seen >= 7) add('focus-record', x.day);
    if (r.focus.v > best) best = r.focus.v;
    seen++;
    if (x.day === today) before = streak;
    streak = c.focus ? streak + 1 : 0;
    if (!streak) inRecord = false;
    if (streak > bestStreak) { if (streak >= 3 && !inRecord) { add('focus-streak', x.day); inRecord = true; } bestStreak = streak; }
    const s0 = sessions;
    sessions += x.sessions;
    for (const a of AWARDS) if (a.group === 'sessions' && s0 < a.n && sessions >= a.n) add(a.id, x.day);
    if (c.focus) { goals++; if (goals === 100) add('goals-100', x.day); if (goals === 365) add('goals-365', x.day); }
    if (c.breaks && ++breakGoals === 1) add('first-breaks', x.day);
  }
  // weeks and months count once they are over (today's week is earned on its last day)
  const by = new Map(all.map((x) => [x.day, x]));
  if (all.length) {
    for (let w = weekOf(all[0].day, weekStart); w <= today; w = addDays(w, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => by.get(addDays(w, i)));
      if (days.some((d) => !d)) continue;
      const last = days[6].day;
      if (days.every((d) => d.c.focus && d.c.done && d.c.breaks)) add('perfect-week', last);
      for (const k of RINGS) if (days.every((d) => d.c[k])) add('perfect-week-' + k, last);
    }
    for (let m = monthKey(all[0].day); m <= monthKey(today); m = addMonths(m, 1)) {
      const dim = daysInMonth(m), days = Array.from({ length: dim }, (_, i) => by.get(`${m}-${pad(i + 1)}`));
      if (days.every((d) => d && d.c.focus)) add('perfect-month', days[dim - 1].day);
      const ch = challengeFor(m, s, all);
      if (ch.done) add(ch.id, ch.done);
    }
  }
  // the current streak still counts yesterday's while today's ring is open
  const cur = all.at(-1)?.day === today && !all.at(-1).c.focus ? before : streak;
  return { earned, stats: { bestFocus: best, bestStreak, streak: cur, sessions, focusGoals: goals, breakGoals, days: all.length } };
}
/** Stored and freshly computed awards together; an award earned once keeps its first day. */
export function mergeEarned(stored, fresh) {
  const out = {};
  for (const s of [stored, fresh]) for (const [id, days] of Object.entries(s || {})) {
    if (!Array.isArray(days)) continue;
    out[id] = [...new Set([...(out[id] || []), ...days.filter(isKey)])].sort();
  }
  for (const id of Object.keys(out)) if (ONCE.has(id)) out[id] = out[id].slice(0, 1);
  return out;
}
/** Award ids and days in `next` that `prev` doesn't have: [{ id, day }]. */
export function newAwards(prev, next) {
  const out = [];
  for (const [id, days] of Object.entries(next || {})) for (const k of days) if (!(prev?.[id] || []).includes(k)) out.push({ id, day: k });
  return out;
}

// ------------------------------------------------------------------ trends
export const TREND_METRICS = ['focus', 'done', 'breaks', 'sessions'];
/** { enough, days, shortN, metrics: { id: { short, long, up, weeks: [weekly averages, oldest first] } } }: the latest
 *  weeks against the whole history (90 days against a year once there is half a year of data; from 4 weeks on). */
export function trends(s) {
  const today = dayKey(src(s).now ?? Date.now());
  const first = firstDay(s, today);
  const n = first ? Math.min(365, dayDiff(first, today) + 1) : 0;
  if (n < 28) return { enough: false, days: n };
  const all = series(s, addDays(today, -(n - 1)), today);
  const val = (x, m) => (m === 'sessions' ? x.sessions : x.r[m].v);
  const shortN = n >= 180 ? 90 : Math.max(14, Math.round(n / 3));
  const avg = (list, m) => list.reduce((a, x) => a + val(x, m), 0) / Math.max(1, list.length);
  const metrics = {};
  for (const m of TREND_METRICS) {
    const short = avg(all.slice(-shortN), m), long = avg(all, m);
    const weeks = [];
    for (let i = all.length; i > 0; i -= 7) weeks.unshift(avg(all.slice(Math.max(0, i - 7), i), m));
    metrics[m] = { short, long, up: short >= long - 1e-9, weeks: weeks.slice(-12) };
  }
  return { enough: true, days: n, shortN, metrics };
}

// ------------------------------------------------------------------ writing the log (service worker)
/** The day's entry in a normalised log, complete and attached, ready to change. */
export function dayIn(log, k) { return (log.days[k] = dayOf(log, k)); }
/** The hours a break from start to end earns: the hour you stepped away in and the hour you came back in, when the
 *  break lasted 2 minutes in it. Hours in between, when the computer wasn't used at all, don't count. */
export function breakHours(start, end, min = BREAK_MS) {
  if (!(end - start >= min)) return [];
  const hs = new Date(start); hs.setMinutes(0, 0, 0);
  const he = new Date(end); he.setMinutes(0, 0, 0);
  if (+hs === +he) return [start];
  const a = +hs + 3600000 - start, b = end - +he;
  // after hours away (the night, a day off) coming back isn't a break taken while using the computer
  if (end - start > 3 * 3600000) return a >= min ? [start] : [];
  const out = [];
  if (a >= min) out.push(start);
  if (b >= min) out.push(end);
  if (!out.length) out.push(a >= b ? start : end);
  return out;
}
export function addBreak(log, start, end) {
  for (const t of breakHours(start, end)) {
    const d = dayIn(log, dayKey(t)), h = new Date(t).getHours();
    if (!d.breakH.includes(h)) { d.breakH.push(h); d.breakH.sort((x, y) => x - y); }
  }
  return log;
}
export function addActive(log, at, min = 1) {
  const d = dayIn(log, dayKey(at)), h = new Date(at).getHours();
  d.activeH[h] = Math.min(60, d.activeH[h] + min);
  return log;
}
/** Keeps the latest KEEP_DAYS days; what the older ones counted towards awards moves to `base`. */
export function trim(log, prefs, today = dayKey()) {
  const min = addDays(today, -KEEP_DAYS);
  for (const k of Object.keys(log.days).sort()) {
    if (k >= min && isKey(k)) continue;
    const d = dayOf(log, k), g = goalsFor(prefs, k);
    log.base.sessions += d.sessions || 0;
    if ((d.focus || 0) >= g.focus) log.base.focusGoals++;
    if (d.breakH.length >= g.breaks) log.base.breakGoals++;
    log.base.bestFocus = Math.max(log.base.bestFocus, d.focus || 0);
    delete log.days[k];
  }
  return log;
}

// ------------------------------------------------------------------ coaching
/** What the evening coaching says, or null: the ring closest to closing that can still close today. */
export function coach(r, now = Date.now()) {
  const d = new Date(now), minsLeft = (24 - d.getHours()) * 60 - d.getMinutes(), hoursLeft = 23 - d.getHours();
  const open = RINGS.filter((k) => r[k].v < r[k].goal).map((k) => ({ ring: k, p: r[k].p, need: Math.ceil(r[k].goal - r[k].v - 1e-9) }));
  const possible = open.filter((x) => (x.ring === 'focus' ? x.need <= minsLeft - 10 : x.ring === 'breaks' ? x.need <= hoursLeft + 1 : true));
  if (!possible.length) return null;
  const top = possible.sort((a, b) => b.p - a.p)[0];
  return { ...top, close: top.p >= 0.5 };
}
