// Samsung Health data on the page: reads and writes the `health` and `healthPrefs` store keys, joins in the service
// worker's `healthSW` dose log, and the helpers other surfaces use (widgets, Finder commands, Quick Panel, Lock
// screen, Now Bar): todayHealth(), todayRings(), logWater(), logMed(), logSlot(), logMood().
import { store } from '../core/store.js';
import * as M from './model.js';
import * as R from './rings.js';

export const D = () => M.norm(store.get(M.KEY));
export const logs = (d = D()) => M.allLogs(d, store.get(M.SW_KEY));
/** Changes the Health data through `fn(d)` (it gets a normalised copy) and returns what `fn` returns. */
export function mut(fn) {
  let out;
  store.update(M.KEY, (v) => { const d = M.norm(v); out = fn(d); return d; });
  return out;
}
export const prefs = () => R.normPrefs(store.get(M.PREFS));
/** Changes healthPrefs (the raw object, so keys this module doesn't know survive). */
export const setPrefs = (fn) => store.update(M.PREFS, (v) => fn(v && typeof v === 'object' ? v : {}));
export const units = (d = D()) => M.unitsOf(d);

/** Store keys the Health data is made of: subscribe to these to redraw. */
export const DATA_KEYS = [M.KEY, M.SW_KEY];
export const RING_KEYS = [M.ACT, M.PREFS, 'reminders', 'focusLog', 'focus'];
export function watch(keys, fn) {
  const offs = keys.map((k) => store.on(k, fn));
  return () => offs.forEach((f) => f());
}

/** Copies doses logged from notifications (`healthSW`, kept two weeks by the worker) into the page's own log. Entries
 *  keep their ids, so a copy is never counted twice. Only a tab you're looking at does it. */
export function mergeSW() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const sw = store.get(M.SW_KEY)?.log;
  if (!Array.isArray(sw) || !sw.length) return;
  const have = new Set(D().medLog.map((e) => e.id)), add = sw.filter((e) => e && e.id && e.med && !have.has(e.id));
  if (add.length) mut((d) => { d.medLog.push(...add); });
}
store.on(M.SW_KEY, () => setTimeout(mergeSW, 400));

// ------------------------------------------------------------------ Daily activity
export const sources = (now = Date.now()) => ({
  act: store.get(M.ACT), prefs: store.get(M.PREFS), reminders: store.get('reminders'), focusLog: store.get('focusLog'), focus: store.get('focus'), now,
});
export const todayRings = (now = Date.now()) => R.ringsFor(R.dayKey(now), sources(now));

// ------------------------------------------------------------------ logging
/** Adds water (mL) now or at `at`. */
export function logWater(ml, at = Date.now()) {
  if (!(ml > 0)) return null;
  const e = { id: M.newId('w'), at, ml: Math.round(ml * 10) / 10 };
  mut((d) => { d.water.push(e); });
  return e;
}
/** Takes away today's latest glass (the card's − button). */
export function undoWater(now = Date.now()) {
  return mut((d) => {
    const k = M.dayKey(now), last = d.water.filter((e) => M.dayKey(e.at) === k).sort((a, b) => b.at - a.at)[0];
    if (last) d.water = d.water.filter((e) => e !== last);
    return last || null;
  });
}
/** Logs a medication as taken or skipped: its nearest open dose today, or an "as needed" dose. `slot` picks a dose. */
export function logMed(id, status = 'taken', slot) {
  const d = D(), m = d.meds.find((x) => x.id === id);
  if (!m || !['taken', 'skipped', 'cleared'].includes(status)) return null;
  slot ??= M.pickSlot(d, logs(d), id);
  const [k, tm] = (slot || '').split('T');
  const n = slot ? M.dosesOn(m, k).find((x) => x.t === tm)?.n || 1 : 1;
  const e = { id: M.newId('ml'), med: id, slot: slot || '', status, n, at: Date.now() };
  mut((x) => { x.medLog.push(e); });
  return e;
}
/** Logs every open dose of a time ("Take all"). Returns the number logged. */
export function logSlot(slot, status = 'taken') {
  const d = D(), add = M.slotAction(d, logs(d), slot, status, Date.now(), 'app');
  if (add.length) mut((x) => { x.medLog.push(...add); });
  return add.length;
}
/** The round Take button: Taken, and a second tap undoes it. */
export function toggleDose(medId, slot) {
  const e = M.logIndex(logs()).get(medId + '|' + slot), live = e && e.status !== 'cleared' ? e : null;
  return logMed(medId, live?.status === 'taken' ? 'cleared' : 'taken', slot);
}
/** Saves a mood: a valence (-3…3) or a mood id ('great'…'awful'), with optional feelings, areas and a note. */
export function logMood(v, { labels = [], areas = [], note = '', at = Date.now() } = {}) {
  const valence = typeof v === 'string' ? M.MOOD[v]?.v ?? 0 : Math.max(-3, Math.min(3, Math.round(+v * 10) / 10 || 0));
  const e = { id: M.newId('sm'), at, valence, labels, areas, ...(note ? { note } : {}) };
  mut((d) => { d.mind.push(e); });
  return e;
}

/** Today at a glance: { medsDue: [{ id, name, slot, time, n, status }], medsTaken, next, water: { ml, goalMl },
 *  mood, sleep (last night's minutes) }. */
export function todayHealth(now = Date.now()) {
  const d = D(), k = M.dayKey(now), lg = logs(d), doses = M.dayDoses(d, lg, k), u = units(d);
  const mood = d.mind.filter((e) => M.dayKey(e.at) === k).sort((a, b) => b.at - a.at)[0] || null;
  return {
    medsDue: doses.map((x) => ({ id: x.med.id, name: x.med.nick || x.med.name, slot: x.slot, time: x.t, n: x.n, status: x.entry?.status || null })),
    medsTaken: doses.filter((x) => x.entry?.status === 'taken').length,
    next: M.nextSlot(d, lg, now),
    water: { ml: Math.round(M.waterOn(d, k)), goalMl: Math.round(M.waterGoal(d, u)), cup: M.cupOf(d, u) },
    mood,
    sleep: M.sleepByDay(d)[k] || 0,
  };
}
