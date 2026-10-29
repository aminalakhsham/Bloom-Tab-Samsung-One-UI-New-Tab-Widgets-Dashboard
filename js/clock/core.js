// Samsung Clock's rules shared by the pages and the service worker (js/bg/clock.js): alarms (sound, volume, snooze,
// a date to ring once), timers and what is ringing. Pure: plain data in, plain data out — no DOM, no storage, no
// chrome.* — so the service worker, the pages and the plain-node test (.dev/clock-core.mjs) all use it.
//
// Store keys (chrome.storage.local):
//   alarms   [{ id, time: 'HH:MM', days: [0…6 Sunday first] (empty = ring once), label, enabled,
//              date?: 'YYYY-MM-DD' (ring once on that day), sound?: tone id, soundOn?, volume? 0…1, gradual?,
//              snooze?, snoozeMin? 5|10|15|30, snoozeRepeat? 3|5|0 (0 = forever), snoozeAt? ms, snoozeCount? }]
//            (alarms from before only have { id, time, days, label, enabled }: every new field has a default)
//   timers   [{ id, label, duration, endsAt, remaining, running, base?, sound?, rangInPage? }] — the shape Finder's
//            "timer 5m", Routines' Start timer and the side panel write too (base = the time it was set to)
//   timerPresets [{ id, label, duration, sound? }]      clockPrefs { swView, timerSound, timerVolume }
// Session key (chrome.storage.session, so nothing rings again after the browser restarts):
//   clockRinging [{ key, kind: 'alarm' | 'timer', ref, label, at, until, tone, volume, gradual, snooze, snoozeMin, dur, ended }]
import { nextAlarmTime } from '../core/schedule.js';

export const RING_KEY = 'clockRinging';
export const SNOOZE_MINS = [5, 10, 15, 30];
export const SNOOZE_REPEATS = [3, 5, 0];
/** How long something rings before it snoozes by itself (alarms with snooze left) or stops. */
export const RING_MS = { alarm: 60e3, timer: 60e3 };
/** An alarm or timer this late (the computer was asleep) is only notified as missed; it doesn't start ringing. */
export const LATE_MS = 2 * 60e3;
export const RAMP_MS = 30e3; // "Gradually increase volume"
export const DEFAULT_TONE = { alarm: 'flower', timer: 'digital' };
export const DEFAULT_PRESETS = [60, 180, 300, 600, 900, 1800, 3600].map((s, i) => ({ id: 'p' + i, label: '', duration: s * 1000 }));
export const MAX_TIMER = 100 * 3600e3 - 1000;

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const pad = (n) => String(n).padStart(2, '0');

// ——— alarms ———
/** An alarm with every field filled in (older alarms only had time, days, label and enabled). */
export function normAlarm(a = {}) {
  const days = [...new Set((Array.isArray(a.days) ? a.days : []).filter((d) => d >= 0 && d <= 6))].sort();
  return {
    ...a,
    time: /^\d{1,2}:\d{1,2}$/.test(a.time || '') ? a.time : '07:00',
    days,
    label: a.label || '',
    enabled: a.enabled !== false,
    date: !days.length && /^\d{4}-\d\d-\d\d$/.test(a.date || '') ? a.date : '',
    sound: a.sound || DEFAULT_TONE.alarm,
    soundOn: a.soundOn !== false,
    volume: Number.isFinite(a.volume) ? clampN(a.volume, 0, 1) : 0.7,
    gradual: !!a.gradual,
    snooze: a.snooze !== false,
    snoozeMin: SNOOZE_MINS.includes(a.snoozeMin) ? a.snoozeMin : 5,
    snoozeRepeat: SNOOZE_REPEATS.includes(a.snoozeRepeat) ? a.snoozeRepeat : 3,
    snoozeAt: a.snoozeAt || 0,
    snoozeCount: a.snoozeCount || 0,
  };
}
export const newAlarm = (over = {}) => ({ id: rid(), time: '07:00', days: [], label: '', enabled: true, sound: DEFAULT_TONE.alarm, volume: 0.7, snooze: true, snoozeMin: 5, snoozeRepeat: 3, ...over });
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (a) => String(a.time || '07:00').split(':').map(Number);
/** Is the snooze of this alarm still to come? */
export const snoozed = (a, now = Date.now()) => !!(a.snoozeAt && a.snoozeAt > now - 1000);
/** When it rings next (ms) or null: the end of a snooze first, then its next time when it is on. */
export function nextRing(a, now = Date.now()) {
  if (snoozed(a, now)) return a.snoozeAt;
  if (a.enabled === false) return null;
  return nextAlarmTime(a, now);
}
/** The alarm that rings first: { alarm, at, snoozed } or null. */
export function nextOf(list, now = Date.now()) {
  let best = null;
  for (const a of list || []) {
    const at = nextRing(a, now);
    if (at && (!best || at < best.at)) best = { alarm: a, at, snoozed: snoozed(a, now) };
  }
  return best;
}
/** Turning an alarm on: a date that has passed is dropped (Samsung moves it to the next time it can ring). */
export function enableAlarm(a, on, now = Date.now()) {
  const out = { ...a, enabled: !!on, snoozeAt: 0, snoozeCount: 0 };
  if (on && out.date && !nextAlarmTime(out, now)) out.date = '';
  return out;
}
/** Can this ring still be snoozed (Snooze on and repeats left)? */
export const canSnooze = (a, count) => a.snooze && (!a.snoozeRepeat || count < a.snoozeRepeat);

/**
 * chrome.alarms fired `alarm:<id>`. Returns { alarms, schedule: [[name, when|null]], entry, missed, alarm } or null.
 * Repeating alarms schedule their next ring; one-time alarms switch off (a snooze of one still rings).
 */
export function fireAlarm(list, id, { now = Date.now(), scheduled = now } = {}) {
  const i = (list || []).findIndex((x) => x.id === id);
  if (i < 0) return null;
  const a = list[i], n = normAlarm(a);
  const isSnooze = !!(a.snoozeAt && a.snoozeAt <= now + 5000);
  const count = isSnooze ? n.snoozeCount : 0;
  const out = { ...a, snoozeAt: 0, snoozeCount: count };
  const schedule = [];
  if (n.days.length) schedule.push(['alarm:' + id, n.enabled ? nextAlarmTime(n, now + 1000) : null]);
  else if (a.enabled) out.enabled = false;
  const alarms = list.map((x, j) => (j === i ? out : x));
  const missed = now - scheduled > LATE_MS;
  const entry = missed ? null : {
    key: `alarm:${id}:${now}`, kind: 'alarm', ref: id, label: n.label, at: now, until: now + RING_MS.alarm,
    tone: n.soundOn ? n.sound : 'silent', volume: n.volume, gradual: n.gradual,
    snooze: canSnooze(n, count), snoozeMin: n.snoozeMin, time: n.time,
  };
  return { alarms, schedule, entry, missed, alarm: out };
}

// ——— timers ———
export const timerLeft = (x, now = Date.now()) => (x.running ? Math.max(0, x.endsAt - now) : Math.max(0, x.remaining ?? x.duration));
export function newTimer(duration, { label = '', sound = '' } = {}, now = Date.now()) {
  duration = clampN(Math.round(duration), 1000, MAX_TIMER);
  const x = { id: rid(), label, duration, endsAt: now + duration, remaining: duration, running: true, base: duration };
  if (sound) x.sound = sound;
  return x;
}
export const pauseTimer = (x, now = Date.now()) => (x.running ? { ...x, running: false, remaining: Math.max(0, x.endsAt - now), endsAt: null } : x);
export function resumeTimer(x, now = Date.now()) {
  const remaining = x.remaining > 0 ? x.remaining : x.duration;
  return { ...x, running: true, endsAt: now + remaining, remaining, rangInPage: false };
}
export const resetTimer = (x) => ({ ...x, running: false, endsAt: null, duration: x.base || x.duration, remaining: x.base || x.duration });
/** +1 min: a running timer ends a minute later and its ring grows; a paused one gets a minute more. */
export function addMinute(x, now = Date.now()) {
  if (x.running) {
    const endsAt = x.endsAt + 60e3;
    return { ...x, base: x.base || x.duration, endsAt, duration: Math.max(x.duration, endsAt - now) };
  }
  const remaining = (x.remaining ?? x.duration) + 60e3;
  return { ...x, base: x.base || x.duration, remaining, duration: Math.max(x.duration, remaining) };
}

/**
 * A timer ended (chrome.alarms fired `timer:<id>`, or an open page saw it first: inPage with its endsAt).
 * Returns { timers, entry, missed, timer } or null when there is nothing to ring.
 */
export function fireTimer(list, id, { now = Date.now(), inPage = false, endsAt = null, prefs = {} } = {}) {
  const i = (list || []).findIndex((x) => x.id === id);
  if (i < 0) return null;
  const tm = list[i];
  // paused, already rung by an open page, or re-scheduled since (+1 min)
  if (!tm.running || !tm.endsAt || tm.endsAt > now + 1000) return null;
  if (inPage && endsAt && tm.endsAt !== endsAt) return null;
  const base = tm.base || tm.duration;
  const out = { ...tm, running: false, endsAt: null, duration: base, remaining: base, rangInPage: !!inPage };
  const missed = now - tm.endsAt > LATE_MS;
  const entry = missed ? null : {
    key: `timer:${id}:${tm.endsAt}`, kind: 'timer', ref: id, label: tm.label || '', at: now, until: now + RING_MS.timer,
    tone: tm.sound || prefs.timerSound || DEFAULT_TONE.timer, volume: Number.isFinite(prefs.timerVolume) ? prefs.timerVolume : 0.8,
    gradual: false, snooze: false, snoozeMin: 0, dur: base, ended: tm.endsAt,
  };
  return { timers: list.map((x, j) => (j === i ? out : x)), entry, missed, timer: out };
}

// ——— ringing ———
/** The newest entry with a sound decides what plays. */
export const soundTop = (list) => [...(list || [])].reverse().find((r) => r.tone && r.tone !== 'silent') || null;
/** The entry the ringing screen shows full size (the newest alarm, else the newest timer). */
export const screenTop = (list) => [...(list || [])].reverse().find((r) => r.kind === 'alarm') || (list || []).at(-1) || null;
/** Buttons of a ring's system notification, in order. */
export const ringButtons = (r) => (r.kind === 'timer' ? ['dismiss', 'plus1'] : r.snooze ? ['snooze', 'dismiss'] : ['dismiss']);
/** Adds an entry (the same alarm or timer ringing again replaces its older entry). */
export const addRing = (list, entry) => [...(list || []).filter((r) => r.key !== entry.key && !(r.kind === entry.kind && r.ref === entry.ref)), entry];
export const expired = (list, now = Date.now()) => (list || []).filter((r) => r.until <= now + 500);

/**
 * Dismiss / Snooze / +1 min / Restart (or 'expire': rang too long) on a ringing entry.
 * st = { alarms, timers } as stored. Returns { alarms?, timers?, schedule: [[name, when|null]], did } where `did`
 * is what happened ('dismiss' | 'snooze' | 'plus1' | 'restart') so the page can say so.
 */
export function ringAct(st, entry, action, now = Date.now()) {
  const out = { schedule: [], did: 'dismiss' };
  if (action === 'expire') action = entry.kind === 'alarm' && entry.snooze ? 'snooze' : 'dismiss';
  if (entry.kind === 'alarm') {
    const alarms = st.alarms || [];
    const a = alarms.find((x) => x.id === entry.ref);
    if (action === 'snooze' && entry.snooze && a) {
      const n = normAlarm(a), at = now + (entry.snoozeMin || n.snoozeMin) * 60e3;
      out.alarms = alarms.map((x) => (x.id === a.id ? { ...x, snoozeAt: at, snoozeCount: n.snoozeCount + 1 } : x));
      out.schedule.push(['alarm:' + a.id, at]);
      out.did = 'snooze';
      out.at = at;
    } else if (a && (a.snoozeAt || a.snoozeCount)) {
      out.alarms = alarms.map((x) => (x.id === a.id ? { ...x, snoozeAt: 0, snoozeCount: 0 } : x));
    }
    return out;
  }
  if (action === 'plus1' || action === 'restart') {
    const ms = action === 'plus1' ? 60e3 : entry.dur || 60e3;
    const timers = st.timers || [];
    const tm = timers.find((x) => x.id === entry.ref);
    const next = tm
      ? { ...tm, running: true, endsAt: now + ms, remaining: ms, duration: ms, base: tm.base || entry.dur || tm.duration, rangInPage: false }
      : { ...newTimer(ms, { label: entry.label, sound: entry.tone !== 'silent' ? entry.tone : '' }, now), base: entry.dur || ms };
    out.timers = tm ? timers.map((x) => (x.id === tm.id ? next : x)) : [...timers, next];
    out.schedule.push(['timer:' + next.id, next.endsAt]);
    out.did = action;
  }
  return out;
}

/** Cancels the snooze of an alarm from the list ("Dismiss" on a snoozed alarm): its next regular ring is kept. */
export function cancelSnooze(a, now = Date.now()) {
  const out = { ...a, snoozeAt: 0, snoozeCount: 0 };
  return { alarm: out, schedule: [['alarm:' + a.id, out.enabled !== false ? nextAlarmTime(out, now) : null]] };
}

// ——— parsing ("alarm 7:30", "set an alarm for 6 am", "منبه 7:30 م") ———
/** "7", "7:30", "730", "7.30 pm", "19:05", "٧:٣٠ م" → 'HH:MM' or null. */
export function parseAlarmTime(s) {
  s = String(s || '').trim().toLowerCase().replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/\s+/g, ' ');
  const m = s.match(/^(\d{1,2})(?:[:.٫]?(\d{2}))?\s*(am|a\.m\.|a|pm|p\.m\.|p|ص|صباحا|صباحًا|م|مساء|مساءً|مساءا)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const per = m[3] || '';
  if (min > 59) return null;
  if (per) {
    if (h < 1 || h > 12) return null;
    const pm = /^(p|م|مساء)/.test(per);
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}
