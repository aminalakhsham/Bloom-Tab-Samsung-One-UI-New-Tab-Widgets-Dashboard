// Samsung Clock in the service worker: rings alarms (`alarm:<id>`) and timers (`timer:<id>`) when they're due, even
// with no Bloom Tab page open.
//   • What rings is session state (`clockRinging`, see js/clock/core.js): every open tab shows the full-screen ringing
//     screen from it (js/clock/ringing.js) and sends Dismiss / Snooze / +1 min back with a 'clock-ring' message.
//   • The sound plays in the offscreen audio host of Samsung Music (`play` / `volume` / `stop` on channel 'clock'):
//     a synthesised tone (js/clock/tones.js) as a looping WAV, getting louder over 30 s for "Gradually increase".
//   • A sticky system notification with Snooze / Dismiss (+1 min for timers) works from any tab or app; closing it
//     dismisses. After a minute an alarm snoozes by itself (or stops when it has no snooze left), a timer stops.
//   • An alarm or timer found more than 2 minutes late (the computer slept) is only notified as missed.
// Open pages also report a timer that has ended ('timer-done'), because chrome.alarms can fire up to 30 s late in a
// packed extension; whichever comes first rings, once.
import { onAlarm, onButton, openTarget, onMessage, post, bgStrings, bgTime, fmt, scheduleAt } from './hub.js';
import { toOffscreen } from './music.js';
import { RING_KEY, RAMP_MS, fireAlarm, fireTimer, ringAct, addRing, soundTop, ringButtons, expired } from '../clock/core.js';
import { toneDataUrl } from '../clock/tones.js';
import '../clock/actions.js'; // Routines: Start timer, Set alarm

const S = {
  en: {
    alarm: 'Alarm', timer: 'Timer', timesUp: "Time's up", snooze: 'Snooze ({n} min)', dismiss: 'Dismiss', plus1: '+1 min',
    missed: 'Missed alarm ({t})', snoozedUntil: 'Snoozed until {t}',
  },
  ar: {
    alarm: 'المنبه', timer: 'المؤقت', timesUp: 'انتهى الوقت', snooze: 'غفوة ({n} د)', dismiss: 'تجاهل', plus1: '+1 دقيقة',
    missed: 'منبه فائت ({t})', snoozedUntil: 'مؤجل حتى {t}',
  },
};
const END = 'clockring:end';

// alarms, timers and what rings are read, changed and written back one change at a time
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.catch(() => {}).then(fn).catch((e) => console.warn('clock', e)));

const getRinging = async () => (await chrome.storage.session.get(RING_KEY))[RING_KEY] || [];
const setRinging = (list) => chrome.storage.session.set({ [RING_KEY]: list });
const arm = (list) => (list.length ? chrome.alarms.create(END, { when: Math.min(...list.map((r) => r.until)) + 300 }) : chrome.alarms.clear(END));

// ——— sound (offscreen document, channel 'clock') ———
let playing = null; // key of the ring whose tone plays (a hint: the worker may restart; then the tone restarts too)
const rampK = (r, now = Date.now()) => 0.12 + 0.88 * Math.min(1, (now - r.at) / RAMP_MS);
async function sound(list) {
  const top = soundTop(list);
  if (!top) {
    playing = null;
    await toOffscreen({ type: 'stop', channel: 'clock' }, false);
    return;
  }
  if (playing === top.key) return;
  playing = top.key;
  const vol = top.volume ?? 0.7;
  await toOffscreen({ type: 'play', channel: 'clock', src: toneDataUrl(top.tone), loop: true, volume: top.gradual ? vol * rampK(top) : vol });
  if (top.gradual) {
    const step = async () => {
      if (playing !== top.key) return;
      const k = rampK(top);
      await toOffscreen({ type: 'volume', channel: 'clock', volume: vol * k }, false);
      if (k < 1) setTimeout(step, 1500);
    };
    setTimeout(step, 1500);
  }
}

// ——— ringing ———
async function ring(entry) {
  const list = addRing(await getRinging(), entry);
  await setRinging(list);
  arm(list);
  const s = await bgStrings(S);
  const isAlarm = entry.kind === 'alarm';
  const buttons = ringButtons(entry).map((b) => ({ title: b === 'snooze' ? fmt(s.snooze, { n: entry.snoozeMin }) : b === 'plus1' ? s.plus1 : s.dismiss }));
  await post(`${entry.kind}:${entry.ref}`, {
    app: 'clock', title: entry.label || (isAlarm ? s.alarm : s.timer), body: isAlarm ? await bgTime(Date.now()) : s.timesUp,
    icon: isAlarm ? 'alarm' : 'timer', ref: entry.ref, buttons, sticky: true, silent: entry.tone !== 'silent' && !!chrome.offscreen,
  });
  // the sound last: creating the offscreen document can take a moment, the notification shouldn't wait for it
  await sound(list);
}

/** Dismiss / snooze / plus1 / restart / expire one ringing entry. */
async function act(key, action) {
  const list = await getRinging();
  const entry = list.find((r) => r.key === key);
  if (!entry) return { gone: true };
  const st = await chrome.storage.local.get(['alarms', 'timers']);
  const p = ringAct(st, entry, action);
  const patch = {};
  if (p.alarms) patch.alarms = p.alarms;
  if (p.timers) patch.timers = p.timers;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  p.schedule.forEach(([name, when]) => scheduleAt(name, when));
  const rest = list.filter((r) => r.key !== key);
  await setRinging(rest);
  await sound(rest);
  arm(rest);
  const nid = `${entry.kind}:${entry.ref}`;
  if (!rest.some((r) => r.kind === entry.kind && r.ref === entry.ref)) {
    // rang for a minute with nobody there: the notification stays, saying what became of it
    if (action === 'expire' && entry.kind === 'alarm') {
      const s = await bgStrings(S);
      const t = await bgTime(p.did === 'snooze' ? p.at : entry.at);
      chrome.notifications.update(nid, { message: fmt(p.did === 'snooze' ? s.snoozedUntil : s.missed, { t }), requireInteraction: false }).catch(() => {});
    } else if (action !== 'expire') chrome.notifications.clear(nid);
  }
  return { did: p.did, at: p.at || null };
}

async function finishTimer(id, { inPage = false, endsAt = null } = {}) {
  const { timers = [], clockPrefs } = await chrome.storage.local.get(['timers', 'clockPrefs']);
  const r = fireTimer(timers, id, { inPage, endsAt, prefs: clockPrefs || {} });
  if (!r) return null;
  await chrome.storage.local.set({ timers: r.timers });
  if (inPage) chrome.alarms.clear('timer:' + id);
  if (r.entry) await ring(r.entry);
  else {
    const s = await bgStrings(S);
    await post('timer:' + id, { app: 'clock', title: r.timer.label || s.timer, body: s.timesUp, icon: 'timer', ref: id });
  }
  return r.entry;
}

onAlarm('timer', (id) => serial(() => finishTimer(id)));

onAlarm('alarm', (id, alarm) => serial(async () => {
  const { alarms = [] } = await chrome.storage.local.get('alarms');
  const r = fireAlarm(alarms, id, { scheduled: alarm?.scheduledTime || Date.now() });
  if (!r) return;
  await chrome.storage.local.set({ alarms: r.alarms });
  r.schedule.forEach(([name, when]) => scheduleAt(name, when));
  if (r.entry) return ring(r.entry);
  const s = await bgStrings(S);
  await post('alarm:' + id, { app: 'clock', title: r.alarm.label || s.alarm, body: fmt(s.missed, { t: await bgTime(alarm?.scheduledTime || Date.now()) }), icon: 'alarm', ref: id });
}));

// a ring that went on too long
onAlarm('clockring', () => serial(async () => {
  for (const r of expired(await getRinging())) await act(r.key, 'expire');
  arm(await getRinging());
}));

const button = (kind) => (ref, index) => serial(async () => {
  const entry = (await getRinging()).find((r) => r.kind === kind && r.ref === ref);
  if (entry) return act(entry.key, ringButtons(entry)[index] || 'dismiss');
});
onButton('alarm', button('alarm'));
onButton('timer', button('timer'));
openTarget('alarm', () => ({ app: 'clock', section: 'alarm' }));
openTarget('timer', () => ({ app: 'clock', section: 'timer' }));

// closing the system notification dismisses what it rings for
chrome.notifications.onClosed.addListener((nid, byUser) => {
  const kind = nid.split(':')[0], ref = nid.slice(kind.length + 1);
  if (!byUser || (kind !== 'alarm' && kind !== 'timer')) return;
  serial(async () => {
    const entry = (await getRinging()).find((r) => r.kind === kind && r.ref === ref);
    if (entry) await act(entry.key, 'dismiss');
  });
});

// pages: { op: 'act', key, action } from the ringing screen, { op: 'timer-done', id, endsAt } when they see a timer end
onMessage('clock-ring', (msg) => serial(async () => {
  if (msg.op === 'act') return act(msg.key, msg.action);
  if (msg.op === 'timer-done') return { entry: await finishTimer(msg.id, { inPage: true, endsAt: msg.endsAt }) };
  return null;
}));
