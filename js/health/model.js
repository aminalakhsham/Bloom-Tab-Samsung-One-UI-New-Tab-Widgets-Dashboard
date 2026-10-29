// Samsung Health data model, shared by the app, its widgets, Finder commands and the service worker.
// Pure: no DOM, no storage and no translations, so the service worker (and plain node tests) can import it.
//
// Store key `health` (this computer only), written by pages only:
// {
//   v: 1,
//   profile: { name, birth: 'YYYY-MM-DD', sex: '' | 'female' | 'male' | 'other' },
//   units: { weight: 'kg' | 'lb', height: 'cm' | 'in', water: 'ml' | 'floz' }   (a missing unit follows the region)
//   meds: [{ id, name, nick, type, strength, unit, shape, c1, c2, bg, notes, at, archived,
//            sched: { kind: 'daily' | 'days' | 'interval' | 'cycle' | 'asNeeded', days: [0–6], every, on, off,
//                     times: [{ t: 'HH:MM', n: doses }] }, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' | '' }],
//   medLog: [{ id, med, slot: 'YYYY-MM-DDTHH:MM' | '' (as needed), status: 'taken' | 'skipped' | 'cleared', n, at }],
//   medPrefs: { remind: true, follow: true },
//   mind: [{ id, at, valence: -3…3, labels: [feeling…], areas: [area…], note }],
//   water: [{ id, at, ml }], waterGoal: ml | undefined, cup: ml | undefined,
//   sleep: [{ id, start, end }] (ms), sleepGoal: minutes | undefined,
//   body: [{ id, at, kind: 'weight' | 'height' | 'fat' | 'muscle', value }] (kg, cm, %, kg),
//   cycle: { days: { 'YYYY-MM-DD': { flow: 'light' | 'medium' | 'heavy' | 'unspecified', sym: [symptom…] } },
//            predPeriod: bool, predFertile: bool },
//   mindful: [{ id, at, min }],
// }
// Store key `healthSW`: { log: [medLog entries] }, written only by the service worker (the notification buttons
// "Taken" and "Skip"), so a page and the worker never write the same key. Readers join both logs; for one dose the
// newest entry wins ('cleared' undoes a log). Pages copy the worker's entries into their own log.
// Store key `healthPrefs` (pages): goals of the Daily activity rings (see rings.js), notification options and the
// Home cards: { cards: { order: [card…], hidden: [card…] } }.

export const KEY = 'health', SW_KEY = 'healthSW', PREFS = 'healthPrefs', ACT = 'healthAct';

// ------------------------------------------------------------------ dates (local time)
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const keyDate = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
export const daysBetween = (a, b) => Math.round((keyDate(b) - keyDate(a)) / 864e5);
export const slotKey = (k, t) => `${k}T${t}`;
export function slotTime(s) {
  const [k, tm = '00:00'] = String(s).split('T'), d = keyDate(k), [h, m] = tm.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}
export const newId = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ------------------------------------------------------------------ normalising (tolerates missing, old or damaged data)
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const arr = (x, ok) => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object' && ok(y)) : []);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
export const isKey = (k) => /^\d{4}-\d\d-\d\d$/.test(k || '');
const isTime = (t) => /^\d\d:\d\d$/.test(t || '');

export const MED_TYPES = ['tablet', 'capsule', 'liquid', 'drops', 'inhaler', 'injection', 'cream', 'gel', 'patch', 'spray', 'powder', 'device'];
export const STRENGTH_UNITS = ['mg', 'mcg', 'g', 'mL', '%', 'IU'];
export const SCHED_KINDS = ['daily', 'days', 'interval', 'cycle', 'asNeeded'];

export function normMed(m) {
  const s = obj(m.sched);
  const kind = SCHED_KINDS.includes(s.kind) ? s.kind : 'daily';
  const times = arr(s.times, (x) => isTime(x.t)).map((x) => ({ t: x.t, n: fin(x.n) && x.n > 0 ? x.n : 1 })).sort((a, b) => a.t.localeCompare(b.t));
  return {
    ...m, name: String(m.name), nick: m.nick ? String(m.nick) : '', type: MED_TYPES.includes(m.type) ? m.type : 'tablet',
    shape: m.shape || '', c1: m.c1 || '#ffffff', c2: m.c2 || m.c1 || '#ffffff', bg: m.bg || '#a9d9ff',
    sched: {
      kind, times: kind === 'asNeeded' ? [] : times.length ? times : [{ t: '09:00', n: 1 }],
      days: Array.isArray(s.days) ? s.days.filter((x) => x >= 0 && x <= 6) : [],
      every: Math.max(2, Math.round(+s.every) || 2), on: Math.max(1, Math.round(+s.on) || 21), off: Math.max(1, Math.round(+s.off) || 7),
    },
    start: isKey(m.start) ? m.start : dayKey(m.at || Date.now()), end: isKey(m.end) ? m.end : '',
  };
}

export function norm(v) {
  const d = obj(v), cy = obj(d.cycle);
  return {
    v: 1,
    profile: { ...obj(d.profile) },
    units: { ...obj(d.units) },
    meds: arr(d.meds, (m) => m.id && m.name).map(normMed),
    medLog: arr(d.medLog, (e) => e.id && e.med && e.status),
    medPrefs: { remind: obj(d.medPrefs).remind !== false, follow: obj(d.medPrefs).follow !== false },
    mind: arr(d.mind, (e) => e.id && fin(e.valence) && fin(e.at)).map((e) => ({ ...e, labels: Array.isArray(e.labels) ? e.labels : [], areas: Array.isArray(e.areas) ? e.areas : [] })),
    water: arr(d.water, (e) => e.id && fin(e.ml) && e.ml > 0 && fin(e.at)),
    waterGoal: fin(d.waterGoal) && d.waterGoal > 0 ? d.waterGoal : undefined,
    cup: fin(d.cup) && d.cup > 0 ? d.cup : undefined,
    sleep: arr(d.sleep, (e) => e.id && fin(e.start) && fin(e.end) && e.end > e.start),
    sleepGoal: fin(d.sleepGoal) && d.sleepGoal > 0 ? d.sleepGoal : undefined,
    body: arr(d.body, (e) => e.id && fin(e.value) && e.value > 0 && fin(e.at) && BODY_KINDS.includes(e.kind)),
    cycle: {
      days: Object.fromEntries(Object.entries(obj(cy.days)).filter(([k, x]) => isKey(k) && x && typeof x === 'object')),
      predPeriod: cy.predPeriod !== false, predFertile: cy.predFertile !== false,
    },
    mindful: arr(d.mindful, (e) => e.id && fin(e.min) && e.min > 0 && fin(e.at)),
  };
}

// ------------------------------------------------------------------ Home cards (Manage items)
export const CARDS = ['activity', 'meds', 'water', 'sleep', 'mood', 'body', 'cycle', 'breathe'];
/** The Home cards in the user's order: [{ id, on }] (cards added in a later version join at the end, shown). */
export function cardsOf(prefs) {
  const c = obj(obj(prefs).cards);
  const order = (Array.isArray(c.order) ? c.order : []).filter((x) => CARDS.includes(x));
  for (const x of CARDS) if (!order.includes(x)) order.push(x);
  const hidden = new Set(Array.isArray(c.hidden) ? c.hidden : []);
  return order.map((id) => ({ id, on: !hidden.has(id) }));
}

// ------------------------------------------------------------------ units
// The United States, Liberia and Myanmar use pounds, inches and fluid ounces; everyone else the metric units.
export function defaultUnits(lang = globalThis.navigator?.language || 'en-US') {
  const region = (lang.split('-')[1] || '').toUpperCase();
  const us = ['US', 'LR', 'MM'].includes(region) || (!region && lang === 'en');
  return { weight: us ? 'lb' : 'kg', height: us ? 'in' : 'cm', water: us ? 'floz' : 'ml' };
}
export const unitsOf = (d, lang) => ({ ...defaultUnits(lang), ...d.units });
export const KG_LB = 2.2046226, CM_IN = 2.54, ML_FLOZ = 29.5735;
/** A stored value (kg, cm, mL) in the display unit, and back. */
export function toUnit(kind, v, u) {
  if (kind === 'weight' || kind === 'muscle') return u.weight === 'lb' ? v * KG_LB : v;
  if (kind === 'height') return u.height === 'in' ? v / CM_IN : v;
  if (kind === 'water') return u.water === 'floz' ? v / ML_FLOZ : v;
  return v;
}
export function fromUnit(kind, v, u) {
  if (kind === 'weight' || kind === 'muscle') return u.weight === 'lb' ? v / KG_LB : v;
  if (kind === 'height') return u.height === 'in' ? v * CM_IN : v;
  if (kind === 'water') return u.water === 'floz' ? v * ML_FLOZ : v;
  return v;
}

// ------------------------------------------------------------------ water
export const waterOn = (d, k) => d.water.reduce((s, e) => s + (dayKey(e.at) === k ? e.ml : 0), 0);
export const waterGoal = (d, u = d.units) => d.waterGoal ?? (u?.water === 'floz' ? 64 * ML_FLOZ : 2000);
/** One glass (Samsung counts water in glasses): 250 mL, or 8 fl oz. */
export const cupOf = (d, u = d.units) => d.cup ?? (u?.water === 'floz' ? 8 * ML_FLOZ : 250);

// ------------------------------------------------------------------ sleep
export const SLEEP_GOAL = 8 * 60;
export const sleepGoal = (d) => d.sleepGoal ?? SLEEP_GOAL;
export const sleepMin = (e) => (e.end - e.start) / 60000;
/** Nights end on the day you wake up: { 'YYYY-MM-DD': minutes asleep }. */
export function sleepByDay(d) {
  const out = {};
  for (const e of d.sleep) { const k = dayKey(e.end); out[k] = (out[k] || 0) + sleepMin(e); }
  return out;
}
export const lastSleep = (d) => [...d.sleep].sort((a, b) => b.end - a.end)[0] || null;

// ------------------------------------------------------------------ body
export const BODY_KINDS = ['weight', 'height', 'fat', 'muscle'];
export const bodyOf = (d, kind) => d.body.filter((e) => e.kind === kind).sort((a, b) => a.at - b.at);
export const latestBody = (d, kind) => bodyOf(d, kind).at(-1) || null;
export const bmi = (kg, cm) => Math.round((kg / (cm / 100) ** 2) * 10) / 10;
export function bmiNow(d) {
  const w = latestBody(d, 'weight'), h = latestBody(d, 'height');
  return w && h ? bmi(w.value, h.value) : null;
}

// ------------------------------------------------------------------ chart samples
/** Samples of one kind of data, oldest first: { at, v } (sleep at the wake-up time, mood by entry). */
export function points(d, kind) {
  let p;
  if (kind === 'water') p = d.water.map((e) => ({ at: e.at, v: e.ml }));
  else if (BODY_KINDS.includes(kind)) p = bodyOf(d, kind).map((e) => ({ at: e.at, v: e.value }));
  else if (kind === 'mood') p = d.mind.map((e) => ({ at: e.at, v: e.valence }));
  else if (kind === 'mindful') p = d.mindful.map((e) => ({ at: e.at, v: e.min }));
  else if (kind === 'sleep') p = d.sleep.map((e) => ({ at: e.end, v: sleepMin(e), start: e.start }));
  else p = [];
  return p.sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------------ medications
export const activeMeds = (d) => d.meds.filter((m) => !m.archived);
/** Whether a medication is scheduled on a day (its start and end dates, and its frequency). */
export function scheduledOn(m, k) {
  if (k < m.start || (m.end && k > m.end)) return false;
  const s = m.sched, n = daysBetween(m.start, k);
  if (s.kind === 'asNeeded') return false;
  if (s.kind === 'days') return s.days.includes(keyDate(k).getDay());
  if (s.kind === 'interval') return n % s.every === 0;
  if (s.kind === 'cycle') return n % (s.on + s.off) < s.on;
  return true;
}
export const dosesOn = (m, k) => (scheduledOn(m, k) ? m.sched.times : []);

/** Joins the page's log with the service worker's (an entry can be in both once copied; ids are unique). */
export function allLogs(d, sw) {
  const seen = new Set(), out = [];
  for (const e of [...d.medLog, ...arr(obj(sw).log, (e) => e.id && e.med && e.status)]) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => a.at - b.at);
}
/** med|slot → the newest log entry for that dose ('cleared' entries are kept so they can undo older ones). */
export function logIndex(logs) {
  const m = new Map();
  for (const e of logs) { if (!e.slot) continue; const k = e.med + '|' + e.slot, c = m.get(k); if (!c || e.at >= c.at) m.set(k, e); }
  return m;
}
const live = (e) => (e && e.status !== 'cleared' ? e : null);
/** Every scheduled dose of a day, by time: { med, slot, t, n, entry (the log, or null) }. */
export function dayDoses(d, logs, k, idx = logIndex(logs)) {
  const out = [];
  for (const m of activeMeds(d)) for (const x of dosesOn(m, k)) {
    const slot = slotKey(k, x.t);
    out.push({ med: m, slot, t: x.t, n: x.n, entry: live(idx.get(m.id + '|' + slot)) });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t) || a.med.name.localeCompare(b.med.name));
}
/** The doses of one time of one day ("9:00 AM" holds every medication due then). */
export const slotDoses = (d, logs, slot) => dayDoses(d, logs, slot.split('T')[0]).filter((x) => x.slot === slot);
/** Today's doses grouped by time: [{ slot, t, doses }]. */
export function slotsOf(doses) {
  const m = new Map();
  for (const x of doses) { if (!m.has(x.slot)) m.set(x.slot, { slot: x.slot, t: x.t, doses: [] }); m.get(x.slot).doses.push(x); }
  return [...m.values()];
}
/** Log entries (newest first) that still count: a 'cleared' entry and the entries it replaced are left out. */
export function history(logs, medId) {
  const idx = logIndex(logs);
  return logs.filter((e) => e.status !== 'cleared' && (!medId || e.med === medId) && (!e.slot || idx.get(e.med + '|' + e.slot) === e)).sort((a, b) => b.at - a.at);
}
/** Taken, skipped and missed doses over the last `days` days (only doses whose time has come). */
export function adherence(d, logs, medId, days = 30, now = Date.now()) {
  const idx = logIndex(logs), today = dayKey(now), r = { taken: 0, skipped: 0, missed: 0, total: 0 };
  const m = d.meds.find((x) => x.id === medId);
  if (!m) return { ...r, pct: null };
  for (let i = days - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    for (const x of dosesOn(m, k)) {
      const slot = slotKey(k, x.t);
      if (slotTime(slot) > now) continue;
      r.total++;
      const e = live(idx.get(m.id + '|' + slot));
      if (e?.status === 'taken') r.taken++; else if (e?.status === 'skipped') r.skipped++; else r.missed++;
    }
  }
  return { ...r, pct: r.total ? Math.round((r.taken / r.total) * 100) : null };
}
/** One day's state of a medication for the adherence strip: 'taken' | 'part' | 'skipped' | 'missed' | 'none' | 'later'. */
export function dayState(d, logs, m, k, now = Date.now(), idx = logIndex(logs)) {
  const ds = dosesOn(m, k);
  if (!ds.length) return 'none';
  const st = ds.map((x) => { const slot = slotKey(k, x.t); return slotTime(slot) > now ? 'later' : live(idx.get(m.id + '|' + slot))?.status || 'missed'; });
  const due = st.filter((s) => s !== 'later');
  if (!due.length) return 'later';
  if (due.every((s) => s === 'taken')) return 'taken';
  if (due.some((s) => s === 'taken')) return 'part';
  return due.every((s) => s === 'skipped') ? 'skipped' : 'missed';
}
/** New log entries for every dose of a time that isn't logged yet (the notification's "Taken" / "Skip"). */
export function slotAction(d, logs, slot, status, now = Date.now(), src = 'notification') {
  return slotDoses(d, logs, slot).filter((x) => !x.entry).map((x) => ({ id: newId('ml'), med: x.med.id, slot, status, n: x.n, at: now, src }));
}
/** Times with doses between `from` and `to` (ms), for reminders: [{ slot, at, meds: [names] }]. */
export function upcomingSlots(d, from, to) {
  const out = new Map();
  for (let k = dayKey(from); slotTime(slotKey(k, '00:00')) <= to; k = addDays(k, 1)) {
    for (const m of activeMeds(d)) for (const x of dosesOn(m, k)) {
      const slot = slotKey(k, x.t), at = slotTime(slot);
      if (at < from || at > to) continue;
      if (!out.has(slot)) out.set(slot, { slot, at, meds: [] });
      out.get(slot).meds.push(m.nick || m.name);
    }
  }
  return [...out.values()].sort((a, b) => a.at - b.at);
}
/** The dose a "took <med>" means when only a medication is given: the nearest open dose today, else "as needed" (''). */
export function pickSlot(d, logs, medId, now = Date.now()) {
  const open = dayDoses(d, logs, dayKey(now)).filter((x) => x.med.id === medId && !x.entry);
  if (!open.length) return '';
  const past = open.filter((x) => slotTime(x.slot) <= now + 30 * 60000);
  return (past.at(-1) || open[0]).slot;
}
export const DUE_WINDOW = 2 * 3600e3;
/** The time to log next: the earliest open time that is due (up to 2 hours late) or still to come today.
 *  { slot, at, due, doses } or null. */
export function nextSlot(d, logs, now = Date.now()) {
  const k = dayKey(now);
  for (const s of slotsOf(dayDoses(d, logs, k))) {
    const open = s.doses.filter((x) => !x.entry);
    const at = slotTime(s.slot);
    if (!open.length || at < now - DUE_WINDOW) continue;
    return { slot: s.slot, t: s.t, at, due: at <= now, doses: open };
  }
  return null;
}
/** Medications whose name or display name matches a typed text ("vitamin", "met"), best first. */
export function findMeds(d, q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  return activeMeds(d).map((m) => {
    const names = [m.name, m.nick].filter(Boolean).map((x) => x.toLowerCase());
    const score = names.some((n) => n === q) ? 3 : names.some((n) => n.startsWith(q)) ? 2 : names.some((n) => n.includes(q)) ? 1 : 0;
    return { m, score };
  }).filter((x) => x.score).sort((a, b) => b.score - a.score).map((x) => x.m);
}

// ------------------------------------------------------------------ mood (Mindfulness)
// Samsung's mood scale has five faces; entries keep a valence from -3 to 3 so finer values still read well.
export const MOODS = [
  { id: 'awful', v: -2.6, color: '#8f6bea' },
  { id: 'bad', v: -1.3, color: '#5f8ff2' },
  { id: 'okay', v: 0, color: '#3cbfd6' },
  { id: 'good', v: 1.3, color: '#7cc957' },
  { id: 'great', v: 2.6, color: '#ffb22e' },
];
export const MOOD = Object.fromEntries(MOODS.map((m) => [m.id, m]));
export const moodOf = (v) => MOODS[Math.max(0, Math.min(4, Math.round(((+v || 0) + 2.6) / 1.3)))];
// feelings Samsung-style chips can add, each with the mood it goes with
export const FEELINGS = {
  great: ['Excited', 'Joyful', 'Grateful', 'Proud', 'Confident', 'Amazed'],
  good: ['Happy', 'Calm', 'Content', 'Hopeful', 'Relieved', 'Satisfied'],
  okay: ['Indifferent', 'Peaceful', 'Tired', 'Bored', 'Distracted'],
  bad: ['Stressed', 'Worried', 'Annoyed', 'Sad', 'Lonely', 'Drained'],
  awful: ['Anxious', 'Overwhelmed', 'Angry', 'Hopeless', 'Scared', 'Frustrated'],
};
export const AREAS = ['Work', 'Family', 'Friends', 'Partner', 'Health', 'Fitness', 'Sleep', 'Self-Care', 'Hobbies', 'Education', 'Money', 'Weather', 'Travel', 'Current Events'];

// ------------------------------------------------------------------ cycle tracking
export const FLOWS = ['light', 'medium', 'heavy', 'unspecified'];
export const SYMPTOMS = ['Cramps', 'Headache', 'Bloating', 'Acne', 'Back pain', 'Breast tenderness', 'Fatigue', 'Mood changes', 'Nausea', 'Sleep changes', 'Appetite changes'];
const isFlow = (x) => x && FLOWS.includes(x.flow);
/** Logged periods, oldest first: runs of flow days (a one-day gap doesn't end a period). */
export function periods(days) {
  const ks = Object.keys(days).filter((k) => isFlow(days[k])).sort();
  const out = [];
  for (const k of ks) {
    const p = out.at(-1);
    if (p && daysBetween(p.end, k) <= 2) p.end = k; else out.push({ start: k, end: k });
  }
  return out.map((p) => ({ ...p, len: daysBetween(p.start, p.end) + 1 }));
}
/** Average cycle and period length from the last six cycles (28 and 5 days until there is enough data). */
export function cycleStats(days) {
  const ps = periods(days);
  const gaps = ps.slice(1).map((p, i) => daysBetween(ps[i].start, p.start)).filter((g) => g >= 15 && g <= 60).slice(-6);
  const lens = ps.filter((p) => p.len <= 12).map((p) => p.len).slice(-6);
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  return { cycleLen: gaps.length ? avg(gaps) : 28, periodLen: lens.length ? avg(lens) : 5, cycles: gaps.length, periods: ps, varies: gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) > 7 };
}
/** Estimated next periods and fertile windows (ovulation about 14 days before a period), worked out on this device. */
export function predict(cycle, today = dayKey(), count = 3) {
  const st = cycleStats(cycle.days), last = st.periods.at(-1);
  if (!last) return { ...st, next: [], late: 0 };
  let start = addDays(last.start, st.cycleLen);
  // a late period is still expected "today" until a new one is logged; long after, the cycles roll on
  const late = daysBetween(start, today);
  if (late > 0 && last.end < today) start = late > st.cycleLen / 2 ? addDays(start, Math.ceil(late / st.cycleLen) * st.cycleLen) : today;
  const next = [];
  for (let i = 0; i < count; i++) {
    const s = addDays(start, i * st.cycleLen), ov = addDays(s, -14);
    next.push({ start: s, end: addDays(s, st.periodLen - 1), ovulation: ov, fertileStart: addDays(ov, -5), fertileEnd: addDays(ov, 1) });
  }
  const ov0 = addDays(next[0].start, -14);
  return { ...st, next, late: late > 0 && last.end < today && start === today ? late : 0, fertile: { start: addDays(ov0, -5), end: addDays(ov0, 1), ovulation: ov0 } };
}
/** What the calendar shows for a day: 'period' (logged), 'predicted', 'ovulation', 'fertile' or ''. */
export function cycleDayKind(cycle, pred, k, today = dayKey()) {
  if (isFlow(cycle.days[k])) return 'period';
  if (cycle.predPeriod && k >= today && pred.next?.some((p) => k >= p.start && k <= p.end)) return 'predicted';
  if (cycle.predFertile) {
    const wins = [pred.fertile, ...(pred.next || []).map((p) => ({ start: p.fertileStart, end: p.fertileEnd, ovulation: p.ovulation }))].filter(Boolean);
    if (wins.some((f) => f.ovulation === k)) return 'ovulation';
    if (wins.some((f) => k >= f.start && k <= f.end)) return 'fertile';
  }
  return '';
}
/** Day of the current cycle (1 = the first day of the last period that began on or before k). */
export function cycleDay(cycle, k = dayKey()) {
  const last = periods(cycle.days).filter((p) => p.start <= k).at(-1);
  return last ? daysBetween(last.start, k) + 1 : 0;
}
/** One line about a day: { kind: 'period' | 'late' | 'next' | 'day', n } or null without any period logged. */
export function cycleStatus(cycle, k = dayKey()) {
  if (!Object.keys(cycle.days).length) return null;
  const pred = predict(cycle, k);
  if (isFlow(cycle.days[k])) { const p = pred.periods.filter((x) => x.start <= k).at(-1); return { kind: 'period', n: daysBetween(p.start, k) + 1 }; }
  if (pred.late) return { kind: 'late', n: pred.late };
  if (pred.next[0] && cycle.predPeriod) return { kind: 'next', n: daysBetween(k, pred.next[0].start) };
  return { kind: 'day', n: cycleDay(cycle, k) };
}
