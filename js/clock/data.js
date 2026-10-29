// Clock's stored data and the changes the pages make to it (alarms, timers, stopwatch, world clocks, preset timers,
// settings), each keeping its chrome alarm (`alarm:<id>`, `timer:<id>`) in step. Small: the Now Bar, the widgets and
// the app's registration (js/apps/clock.js, loaded with every new tab) use it too. Rules live in core.js.
import { store } from '../core/store.js';
import { isExt } from '../core/util.js';
import { scheduleAt, cancelSchedule, nextAlarmTime } from '../core/schedule.js';
import * as C from './core.js';

// ——— settings (⋮ › Settings) ———
export const prefs = () => ({ swView: 'digital', timerSound: C.DEFAULT_TONE.timer, timerVolume: 0.8, ...(store.get('clockPrefs') || {}) });
export const setPref = (k, v) => store.update('clockPrefs', (p) => ({ ...(p || {}), [k]: v }));

// ——— alarms ———
export const alarms = () => store.get('alarms') || [];
/** Puts the alarm's chrome alarm where it should be: its snooze, else its next time when it's on. */
export function scheduleOne(a) {
  const name = 'alarm:' + a.id;
  if (C.snoozed(a)) return scheduleAt(name, a.snoozeAt);
  if (a.enabled === false) return cancelSchedule(name);
  scheduleAt(name, nextAlarmTime(a));
}
export function saveAlarm(a) {
  store.update('alarms', (list) => {
    list = [...(list || [])];
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) list[i] = a;
    else list.push(a);
    return list;
  });
  scheduleOne(a);
  return a;
}
export function setEnabled(ids, on) {
  const set = new Set(ids);
  const next = alarms().map((a) => (set.has(a.id) ? C.enableAlarm(a, on) : a));
  store.set('alarms', next);
  next.filter((a) => set.has(a.id)).forEach(scheduleOne);
}
export function deleteAlarms(ids) {
  const set = new Set(ids);
  store.update('alarms', (list) => (list || []).filter((a) => !set.has(a.id)));
  ids.forEach((id) => cancelSchedule('alarm:' + id));
}
/** "Dismiss" on a snoozed alarm in the list. */
export function cancelSnooze(id) {
  const a = alarms().find((x) => x.id === id);
  if (!a) return;
  const r = C.cancelSnooze(a);
  saveAlarm(r.alarm);
}

// ——— timers ———
export const timers = () => store.get('timers') || [];
export const updateTimer = (id, fn) => store.update('timers', (list) => (list || []).map((x) => (x.id === id ? fn(x) : x)));
const timerOf = (id) => timers().find((x) => x.id === id);
export function startTimer(duration, opts = {}) {
  const x = C.newTimer(duration, opts);
  store.update('timers', (list) => [...(list || []), x]);
  scheduleAt('timer:' + x.id, x.endsAt);
  return x.id;
}
export function pauseTimer(id) {
  updateTimer(id, (x) => C.pauseTimer(x));
  cancelSchedule('timer:' + id);
}
export function resumeTimer(id) {
  const x = timerOf(id);
  if (!x) return;
  const y = C.resumeTimer(x);
  updateTimer(id, () => y);
  scheduleAt('timer:' + id, y.endsAt);
}
export function resetTimer(id) {
  updateTimer(id, (x) => C.resetTimer(x));
  cancelSchedule('timer:' + id);
}
export function deleteTimer(id) {
  store.update('timers', (list) => (list || []).filter((x) => x.id !== id));
  cancelSchedule('timer:' + id);
}
export function addMinute(id) {
  const x = timerOf(id);
  if (!x) return;
  const y = C.addMinute(x);
  updateTimer(id, () => y);
  if (y.running) scheduleAt('timer:' + id, y.endsAt);
}
export const presets = () => store.get('timerPresets') || C.DEFAULT_PRESETS;
export const setPresets = (list) => store.set('timerPresets', list);

// ——— stopwatch { running, startedAt, elapsed, laps: [running totals] } ———
export const stopwatch = () => store.get('stopwatch') || { running: false, startedAt: 0, elapsed: 0, laps: [] };
export const swElapsed = (s = stopwatch()) => (s.elapsed || 0) + (s.running ? Date.now() - s.startedAt : 0);
export const swStart = () => store.update('stopwatch', (s) => ({ laps: [], elapsed: 0, ...(s || {}), running: true, startedAt: Date.now() }));
export const swStop = () => store.update('stopwatch', (s) => ({ ...s, running: false, elapsed: swElapsed(s), startedAt: 0 }));
export const swReset = () => store.set('stopwatch', { running: false, startedAt: 0, elapsed: 0, laps: [] });
export const swLap = () => store.update('stopwatch', (s) => ({ ...s, laps: [...(s.laps || []), swElapsed(s)] }));

// ——— world clocks [{ id, tz, city (English), lat?, lon? }] ———
export const clocks = () => store.get('clocks') || [];

// ——— ringing ———
/** Dismiss / snooze / plus1 / restart a ringing entry: the service worker does it (it plays the sound). */
export async function ringAction(key, action) {
  if (isExt) return chrome.runtime.sendMessage({ type: 'clock-ring', op: 'act', key, action }).catch(() => null);
  return (await import('./ringing.js')).localAct(key, action);
}
