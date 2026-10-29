// Plain-node checks of Clock's shared rules (js/clock/core.js: alarms with snooze / dates, timers, what rings and
// Dismiss / Snooze / +1 min / Restart / expiry) and of the synthesised tones (js/clock/tones.js: every tone renders,
// loops, is a valid WAV / data: URL). Exits 1 on failure.   usage: node .dev/clock-core.mjs
import * as C from '../js/clock/core.js';
import { TONES, renderTone, wavBytes, toneWav, toneDataUrl, SAMPLE_RATE } from '../js/clock/tones.js';

let bad = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log('FAIL', msg); } };
const L = (y, mo, d, hh = 0, mm = 0, ss = 0) => new Date(y, mo - 1, d, hh, mm, ss).getTime();
const MON = L(2026, 10, 26, 6, 0); // Monday 06:00

// ——— normAlarm: old alarms get every new field ———
const old = { id: 'a', time: '07:00', days: [5, 1, 1, 9], label: 'Gym', enabled: true };
const na = C.normAlarm(old);
ok(JSON.stringify(na.days) === '[1,5]', 'normAlarm: days deduped, sorted, valid only');
ok(na.sound === 'flower' && na.soundOn && na.volume === 0.7 && !na.gradual, 'normAlarm: default sound, volume, not gradual');
ok(na.snooze && na.snoozeMin === 5 && na.snoozeRepeat === 3, 'normAlarm: snooze on, 5 minutes, 3 times');
ok(C.normAlarm({ time: 'bad' }).time === '07:00' && C.normAlarm({ snoozeMin: 7, snoozeRepeat: 4 }).snoozeMin === 5, 'normAlarm: bad values fall back');
ok(C.normAlarm({ days: [1], date: '2026-11-03' }).date === '' && C.normAlarm({ days: [], date: '2026-11-03' }).date === '2026-11-03', 'normAlarm: a date only for one-time alarms');
ok(C.normAlarm({ snoozeRepeat: 0 }).snoozeRepeat === 0, 'normAlarm: snooze forever (0) is kept');

// ——— nextRing / nextOf ———
ok(C.nextRing({ time: '07:00', days: [], enabled: true }, MON) === L(2026, 10, 26, 7, 0), 'nextRing: enabled one-time alarm');
ok(C.nextRing({ time: '07:00', days: [], enabled: false }, MON) === null, 'nextRing: off alarm is null');
ok(C.nextRing({ time: '07:00', days: [], enabled: false, snoozeAt: MON + 300e3 }, MON) === MON + 300e3, 'nextRing: a snoozed (switched-off) one-time alarm rings at its snooze');
ok(C.nextRing({ time: '07:00', days: [], enabled: true, snoozeAt: MON - 3600e3 }, MON) === L(2026, 10, 26, 7, 0), 'nextRing: a past snooze is ignored');
const nx = C.nextOf([{ id: 'x', time: '09:00', days: [], enabled: true }, { id: 'y', time: '06:30', days: [], enabled: true }, { id: 'z', time: '06:10', days: [], enabled: false }], MON);
ok(nx?.alarm.id === 'y' && nx.at === L(2026, 10, 26, 6, 30) && !nx.snoozed, 'nextOf: the soonest enabled alarm');
ok(C.nextOf([], MON) === null, 'nextOf: none');
ok(C.nextRing({ time: '07:00', days: [], date: '2026-11-03', enabled: true }, MON) === L(2026, 11, 3, 7, 0), 'nextRing: ring once on a date');

// ——— enableAlarm ———
ok(C.enableAlarm({ id: 'a', time: '07:00', days: [], date: '2026-10-20', enabled: false }, true, MON).date === '', 'enableAlarm: a passed date is dropped');
ok(C.enableAlarm({ id: 'a', time: '07:00', days: [], date: '2026-11-20', enabled: false }, true, MON).date === '2026-11-20', 'enableAlarm: a future date is kept');
const en = C.enableAlarm({ id: 'a', snoozeAt: MON + 1000, snoozeCount: 2 }, false, MON);
ok(!en.enabled && !en.snoozeAt && !en.snoozeCount, 'enableAlarm(off): clears the snooze');

// ——— fireAlarm ———
const list = [
  { id: 'once', time: '06:00', days: [], label: 'Wake', enabled: true },
  { id: 'rep', time: '06:00', days: [1, 3], label: '', enabled: true, sound: 'beep', volume: 0.4, gradual: true },
  { id: 'off', time: '06:00', days: [], label: '', enabled: false },
  { id: 'nosnz', time: '06:00', days: [], label: '', enabled: true, snooze: false, soundOn: false },
];
let r = C.fireAlarm(list, 'once', { now: MON });
ok(r && r.alarms.find((a) => a.id === 'once').enabled === false && !r.schedule.length, 'fireAlarm: one-time alarm switches off, nothing scheduled');
ok(r.entry && r.entry.kind === 'alarm' && r.entry.ref === 'once' && r.entry.label === 'Wake' && r.entry.tone === 'flower' && r.entry.snooze && r.entry.snoozeMin === 5 && r.entry.until === MON + C.RING_MS.alarm, 'fireAlarm: ring entry (label, default tone, snooze, until)');
ok(r.alarms.length === 4 && r.alarms.find((a) => a.id === 'rep') === list[1], 'fireAlarm: other alarms untouched');
r = C.fireAlarm(list, 'rep', { now: MON });
ok(r.alarms.find((a) => a.id === 'rep').enabled === true && r.schedule[0][0] === 'alarm:rep' && r.schedule[0][1] === L(2026, 10, 28, 6, 0), 'fireAlarm: repeating alarm stays on and schedules Wednesday 06:00');
ok(r.entry.tone === 'beep' && r.entry.volume === 0.4 && r.entry.gradual === true, 'fireAlarm: the alarm’s sound, volume and gradual');
r = C.fireAlarm(list, 'off', { now: MON });
ok(r && r.entry && r.alarms.find((a) => a.id === 'off').enabled === false, 'fireAlarm: a switched-off alarm (its snooze) still rings');
r = C.fireAlarm(list, 'nosnz', { now: MON });
ok(r.entry.snooze === false && r.entry.tone === 'silent', 'fireAlarm: snooze off, sound off → silent and no snooze');
ok(C.fireAlarm(list, 'gone', { now: MON }) === null, 'fireAlarm: unknown id');
r = C.fireAlarm(list, 'once', { now: MON + 10 * 60e3, scheduled: MON });
ok(r.missed && r.entry === null && r.alarms.find((a) => a.id === 'once').enabled === false, 'fireAlarm: 10 minutes late (asleep) → missed, no ringing, still switches off');
// snooze counting: a snooze ring keeps counting, a regular ring starts again
const snz = [{ id: 's', time: '06:00', days: [1], enabled: true, snoozeRepeat: 3, snoozeAt: MON, snoozeCount: 3 }];
r = C.fireAlarm(snz, 's', { now: MON });
ok(r.entry.snooze === false && r.alarms[0].snoozeCount === 3 && r.alarms[0].snoozeAt === 0, 'fireAlarm: last allowed snooze rang → no more Snooze');
r = C.fireAlarm([{ ...snz[0], snoozeAt: 0 }], 's', { now: MON });
ok(r.entry.snooze === true && r.alarms[0].snoozeCount === 0, 'fireAlarm: a regular ring resets the snooze count');
r = C.fireAlarm([{ ...snz[0], snoozeRepeat: 0, snoozeCount: 40 }], 's', { now: MON });
ok(r.entry.snooze === true, 'fireAlarm: snooze forever always allows another');

// ——— timers ———
const T0 = 1_000_000;
const tm = C.newTimer(90e3, { label: 'Tea', sound: 'chimes' }, T0);
ok(tm.duration === 90e3 && tm.base === 90e3 && tm.endsAt === T0 + 90e3 && tm.remaining === 90e3 && tm.running && tm.label === 'Tea' && tm.sound === 'chimes' && tm.id, 'newTimer: shape (Finder/Routines compatible + base, sound)');
ok(C.newTimer(10, {}, T0).duration === 1000 && C.newTimer(1e12, {}, T0).duration === C.MAX_TIMER && !('sound' in C.newTimer(5e3, {}, T0)), 'newTimer: clamped, no sound key by default');
const p = C.pauseTimer(tm, T0 + 30e3);
ok(!p.running && p.remaining === 60e3 && p.endsAt === null, 'pauseTimer keeps what is left');
const rs = C.resumeTimer(p, T0 + 100e3);
ok(rs.running && rs.endsAt === T0 + 160e3 && rs.remaining === 60e3, 'resumeTimer from the remaining time');
const am = C.addMinute(tm, T0 + 10e3);
ok(am.endsAt === tm.endsAt + 60e3 && am.duration === 140e3 && am.base === 90e3, '+1 min (running): ends later, the ring grows, base kept');
const amp = C.addMinute(p, T0 + 40e3);
ok(amp.remaining === 120e3 && amp.duration === 120e3, '+1 min (paused): more remaining');
const rt = C.resetTimer(am);
ok(!rt.running && rt.duration === 90e3 && rt.remaining === 90e3 && rt.endsAt === null, 'resetTimer back to the time it was set to');
ok(C.timerLeft(tm, T0 + 30e3) === 60e3 && C.timerLeft(p) === 60e3 && C.timerLeft({ running: true, endsAt: T0 }, T0 + 5) === 0, 'timerLeft');

// fireTimer
const tl = [
  { id: 't1', label: 'Tea', duration: 140e3, base: 90e3, endsAt: T0, remaining: 140e3, running: true, sound: 'twinkle' },
  { id: 't2', label: '', duration: 60e3, endsAt: T0 + 60e3, remaining: 60e3, running: true },
  { id: 't3', label: '', duration: 60e3, endsAt: null, remaining: 60e3, running: false, rangInPage: true },
];
let f = C.fireTimer(tl, 't1', { now: T0 + 200, prefs: { timerSound: 'beep', timerVolume: 0.5 } });
ok(f && !f.timers[0].running && f.timers[0].endsAt === null && f.timers[0].duration === 90e3 && f.timers[0].remaining === 90e3 && f.timers[0].rangInPage === false, 'fireTimer: ended timer resets to the time it was set to');
ok(f.entry.key === 'timer:t1:' + T0 && f.entry.tone === 'twinkle' && f.entry.volume === 0.5 && f.entry.dur === 90e3 && f.entry.ended === T0 && !f.entry.snooze, 'fireTimer: ring entry (own sound, timer volume, dur, ended)');
f = C.fireTimer(tl, 't2', { now: T0 + 200 });
ok(f === null, 'fireTimer: not ended yet (re-scheduled by +1 min) → nothing');
ok(C.fireTimer(tl, 't3', { now: T0 }) === null, 'fireTimer: already rung / paused → nothing');
ok(C.fireTimer(tl, 'nope', { now: T0 }) === null, 'fireTimer: unknown id');
f = C.fireTimer([{ ...tl[1], endsAt: T0 }], 't2', { now: T0 + 500, prefs: {} });
ok(f.entry.tone === C.DEFAULT_TONE.timer && f.entry.volume === 0.8, 'fireTimer: default timer sound and volume');
f = C.fireTimer(tl, 't1', { now: T0 + 200, inPage: true, endsAt: T0 + 5 });
ok(f === null, 'fireTimer from a page: a different endsAt (changed since) → nothing');
f = C.fireTimer(tl, 't1', { now: T0 + 200, inPage: true, endsAt: T0 });
ok(f && f.timers[0].rangInPage === true, 'fireTimer from a page marks rangInPage');
f = C.fireTimer(tl, 't1', { now: T0 + 5 * 60e3 });
ok(f && f.missed && !f.entry && !f.timers[0].running, 'fireTimer: 5 minutes late → missed, reset, no ringing');

// ——— ringing list ———
const e1 = { key: 'alarm:a:1', kind: 'alarm', ref: 'a', tone: 'flower', until: 10000 };
const e2 = { key: 'timer:t:2', kind: 'timer', ref: 't', tone: 'silent', until: 50 };
const e3 = { key: 'alarm:a:3', kind: 'alarm', ref: 'a', tone: 'beep', until: 30000 };
let rl = C.addRing([], e1);
rl = C.addRing(rl, e2);
ok(rl.length === 2 && C.soundTop(rl) === e1 && C.screenTop(rl) === e1, 'soundTop skips a silent ring; screenTop prefers the alarm');
rl = C.addRing(rl, e3);
ok(rl.length === 2 && rl.at(-1) === e3 && !rl.includes(e1), 'addRing: the same alarm ringing again replaces its entry');
ok(C.addRing(rl, e3).length === 2, 'addRing: same key twice is one entry');
ok(JSON.stringify(C.expired(rl, 60).map((x) => x.key)) === '["timer:t:2"]', 'expired: past `until`');
ok(C.screenTop([e2]) === e2 && C.screenTop([]) === null && C.soundTop([e2]) === null, 'screenTop/soundTop edges');
ok(JSON.stringify(C.ringButtons({ kind: 'alarm', snooze: true })) === '["snooze","dismiss"]' && JSON.stringify(C.ringButtons({ kind: 'alarm', snooze: false })) === '["dismiss"]' && JSON.stringify(C.ringButtons({ kind: 'timer' })) === '["dismiss","plus1"]', 'ringButtons');

// ——— ringAct ———
const st = { alarms: [{ id: 'a', time: '06:00', days: [], enabled: false, snoozeMin: 10, snoozeCount: 1 }], timers: [{ id: 't', label: 'Eggs', duration: 90e3, base: 90e3, endsAt: null, remaining: 90e3, running: false }] };
const ea = { key: 'alarm:a:1', kind: 'alarm', ref: 'a', snooze: true, snoozeMin: 10 };
let ra = C.ringAct(st, ea, 'snooze', MON);
ok(ra.did === 'snooze' && ra.alarms[0].snoozeAt === MON + 600e3 && ra.alarms[0].snoozeCount === 2 && ra.schedule[0][0] === 'alarm:a' && ra.schedule[0][1] === MON + 600e3 && ra.at === MON + 600e3, 'ringAct snooze: snoozeAt, count, alarm:<id> rescheduled');
ra = C.ringAct(st, { ...ea, snooze: false }, 'snooze', MON);
ok(ra.did === 'dismiss' && !ra.schedule.length, 'ringAct snooze when not allowed → dismiss');
ra = C.ringAct(st, ea, 'dismiss', MON);
ok(ra.did === 'dismiss' && ra.alarms[0].snoozeCount === 0 && !ra.schedule.length, 'ringAct dismiss: snooze count cleared');
ra = C.ringAct(st, ea, 'expire', MON);
ok(ra.did === 'snooze', 'ringAct expire: an alarm with snooze left snoozes by itself');
ra = C.ringAct(st, { ...ea, snooze: false }, 'expire', MON);
ok(ra.did === 'dismiss', 'ringAct expire: no snooze left → stops');
const et = { key: 'timer:t:1', kind: 'timer', ref: 't', label: 'Eggs', dur: 90e3, tone: 'chimes' };
ra = C.ringAct(st, et, 'plus1', MON);
ok(ra.did === 'plus1' && ra.timers[0].running && ra.timers[0].endsAt === MON + 60e3 && ra.timers[0].remaining === 60e3 && ra.timers[0].base === 90e3 && ra.schedule[0][0] === 'timer:t', 'ringAct +1 min restarts the same timer for a minute');
ra = C.ringAct(st, et, 'restart', MON);
ok(ra.did === 'restart' && ra.timers[0].endsAt === MON + 90e3 && ra.timers[0].duration === 90e3, 'ringAct Restart: the full duration again');
ra = C.ringAct({ alarms: [], timers: [] }, et, 'restart', MON);
ok(ra.timers.length === 1 && ra.timers[0].label === 'Eggs' && ra.timers[0].sound === 'chimes' && ra.timers[0].duration === 90e3, 'ringAct Restart of a deleted timer makes a new one');
ra = C.ringAct(st, et, 'dismiss', MON);
ok(!ra.timers && !ra.alarms && ra.did === 'dismiss', 'ringAct timer dismiss changes nothing');

// cancelSnooze
const cs = C.cancelSnooze({ id: 'r', time: '06:00', days: [1], enabled: true, snoozeAt: MON + 5e3, snoozeCount: 1 }, MON);
ok(!cs.alarm.snoozeAt && cs.schedule[0][1] === L(2026, 11, 2, 6, 0), 'cancelSnooze: back to the next regular ring');
ok(C.cancelSnooze({ id: 'o', time: '06:00', days: [], enabled: false, snoozeAt: MON + 5e3 }, MON).schedule[0][1] === null, 'cancelSnooze: a switched-off alarm is cleared');

// ——— parseAlarmTime ———
for (const [s, want] of [['7', '07:00'], ['7:30', '07:30'], ['730', '07:30'], ['07.05', '07:05'], ['19:05', '19:05'], ['7 pm', '19:00'], ['7:30pm', '19:30'], ['12 am', '00:00'], ['12 pm', '12:00'], ['6 a.m.', '06:00'], ['٧:٣٠ م', '19:30'], ['7 ص', '07:00'], ['9 مساء', '21:00'], ['24', null], ['13 pm', null], ['7:75', null], ['soon', null], ['', null]]) {
  ok(C.parseAlarmTime(s) === want, `parseAlarmTime("${s}") → ${want} (got ${C.parseAlarmTime(s)})`);
}

// ——— tones ———
for (const id of TONES) {
  const s = renderTone(id);
  let max = 0, sq = 0, finite = true;
  for (const v of s) { if (!Number.isFinite(v)) finite = false; max = Math.max(max, Math.abs(v)); sq += v * v; }
  const rms = Math.sqrt(sq / s.length);
  ok(finite && max > 0.05 && max <= 0.9001 && rms > 0.03 && rms < 0.3, `tone ${id}: audible, no clipping (peak ${max.toFixed(2)}, rms ${rms.toFixed(3)})`);
  ok(s.length > SAMPLE_RATE * 0.9 && s.length < SAMPLE_RATE * 3, `tone ${id}: one loop of 1–3 s (${(s.length / SAMPLE_RATE).toFixed(2)} s)`);
  // the loop is seamless: the jump from the last sample to the first is no bigger than a normal step
  let step = 0;
  for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
  ok(Math.abs(s[0] - s.at(-1)) <= step + 1e-6, `tone ${id}: loops without a click`);
}
const wav = toneWav('beep');
const dv = new DataView(wav.buffer);
const tag = (o) => String.fromCharCode(...wav.slice(o, o + 4));
ok(tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data' && dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === SAMPLE_RATE && dv.getUint16(34, true) === 16, 'WAV header: PCM, mono, 16-bit');
ok(dv.getUint32(40, true) === wav.length - 44 && dv.getUint32(4, true) === wav.length - 8, 'WAV sizes');
ok(toneWav('beep') === wav, 'toneWav is cached');
const url = toneDataUrl('digital');
ok(url.startsWith('data:audio/wav;base64,UklGR') && Buffer.from(url.split(',')[1], 'base64').length === toneWav('digital').length, 'toneDataUrl: the WAV as base64');
ok(toneDataUrl('nope') === toneDataUrl('flower'), 'unknown tone plays Morning flower');
ok(wavBytes(new Float32Array([2, -2, 0])).length === 50 && new DataView(wavBytes(new Float32Array([2])).buffer).getInt16(44, true) === 0x7fff, 'wavBytes clamps');

console.log(`${n - bad}/${n} clock core checks passed`);
process.exit(bad ? 1 : 0);
