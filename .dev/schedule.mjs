// Plain-node checks of nextAlarmTime() from js/core/schedule.js (clock alarms: once / repeating / week and
// month wraps / exact-minute edges / ring once on a date), no browser needed. Exits 1 on failure.
// usage: node .dev/schedule.mjs
import { nextAlarmTime, scheduleAt, cancelSchedule, scheduleAlarm } from '../js/core/schedule.js';

let bad = 0, n = 0;
const fail = (...a) => { bad++; console.log('FAIL', ...a); };
const L = (y, mo, d, hh = 0, mm = 0, ss = 0, ms = 0) => new Date(y, mo - 1, d, hh, mm, ss, ms).getTime(); // local time, month 1-based
const show = (ms) => (ms == null ? 'null' : new Date(ms).toString().slice(0, 24));

// [label, alarm, from, expected (local time) or null]
const MON = [2026, 10, 26]; // Monday 26 Oct 2026
const cases = [
  ['once, later today', { time: '07:00', days: [] }, L(...MON, 6, 0), L(...MON, 7, 0)],
  ['once, a millisecond before', { time: '07:00', days: [] }, L(...MON, 6, 59, 59, 999), L(...MON, 7, 0)],
  ['once, exactly now rolls to tomorrow', { time: '07:00', days: [] }, L(...MON, 7, 0), L(2026, 10, 27, 7, 0)],
  ['once, already passed today', { time: '07:00', days: [] }, L(...MON, 7, 0, 0, 1), L(2026, 10, 27, 7, 0)],
  ['once, no days key at all', { time: '18:45' }, L(...MON, 12, 0), L(...MON, 18, 45)],
  ['once, just after midnight next day', { time: '00:15', days: [] }, L(...MON, 23, 30), L(2026, 10, 27, 0, 15)],
  ['once, 23:59 still today', { time: '23:59', days: [] }, L(...MON, 23, 58, 59), L(...MON, 23, 59)],
  ['once, 00:00 from 23:59:30 is tomorrow', { time: '00:00', days: [] }, L(...MON, 23, 59, 30), L(2026, 10, 27, 0, 0)],
  ['missing time defaults to 07:00', { days: [] }, L(...MON, 5, 0), L(...MON, 7, 0)],
  ['single-digit fields "7:5"', { time: '7:5', days: [] }, L(...MON, 5, 0), L(...MON, 7, 5)],
  ['every day, passed today -> tomorrow', { time: '06:30', days: [0, 1, 2, 3, 4, 5, 6] }, L(...MON, 9, 0), L(2026, 10, 27, 6, 30)],
  ['every day, later today', { time: '21:00', days: [0, 1, 2, 3, 4, 5, 6] }, L(...MON, 9, 0), L(...MON, 21, 0)],
  ['Mondays, later today', { time: '08:00', days: [1] }, L(...MON, 7, 59), L(...MON, 8, 0)],
  ['Mondays, passed today -> next week (7 days ahead)', { time: '08:00', days: [1] }, L(...MON, 8, 0, 0, 1), L(2026, 11, 2, 8, 0)],
  ['Mondays, exactly now -> next week', { time: '08:00', days: [1] }, L(...MON, 8, 0), L(2026, 11, 2, 8, 0)],
  ['weekdays from Friday evening -> Monday', { time: '07:00', days: [1, 2, 3, 4, 5] }, L(2026, 10, 30, 20, 0), L(2026, 11, 2, 7, 0)],
  ['weekends from Monday -> Saturday', { time: '10:00', days: [0, 6] }, L(...MON, 12, 0), L(2026, 10, 31, 10, 0)],
  ['Sunday 00:00 from Saturday 23:00 (week + month wrap)', { time: '00:00', days: [0] }, L(2026, 10, 31, 23, 0), L(2026, 11, 1, 0, 0)],
  ['Wednesday from Thursday -> 6 days ahead', { time: '12:00', days: [3] }, L(2026, 10, 29, 12, 0), L(2026, 11, 4, 12, 0)],
  ['days in any order', { time: '09:15', days: [5, 2] }, L(...MON, 10, 0), L(2026, 10, 27, 9, 15)],
  ['once across the year end', { time: '00:00', days: [] }, L(2026, 12, 31, 23, 59, 30), L(2027, 1, 1, 0, 0)],
  ['Friday across the year end', { time: '06:00', days: [5] }, L(2026, 12, 31, 7, 0), L(2027, 1, 1, 6, 0)],
  ['leap day', { time: '08:00', days: [] }, L(2028, 2, 28, 9, 0), L(2028, 2, 29, 8, 0)],
  ['impossible weekday never rings', { time: '08:00', days: [7] }, L(...MON, 6, 0), null],
  // Samsung's "ring once on a date" (the calendar button in the alarm editor)
  ['dated, a week ahead', { time: '07:00', days: [], date: '2026-11-03' }, L(...MON, 9, 0), L(2026, 11, 3, 7, 0)],
  ['dated, later today', { time: '21:00', days: [], date: '2026-10-26' }, L(...MON, 9, 0), L(...MON, 21, 0)],
  ['dated, already passed today', { time: '07:00', days: [], date: '2026-10-26' }, L(...MON, 9, 0), null],
  ['dated, exactly now', { time: '09:00', date: '2026-10-26' }, L(...MON, 9, 0), null],
  ['dated, a day in the past', { time: '07:00', days: [], date: '2026-10-20' }, L(...MON, 6, 0), null],
  ['dated, months ahead (beyond the 8-day search)', { time: '06:15', days: [], date: '2027-03-01' }, L(...MON, 6, 0), L(2027, 3, 1, 6, 15)],
  ['dated, leap day', { time: '00:00', date: '2028-02-29' }, L(2028, 2, 28, 23, 0), L(2028, 2, 29, 0, 0)],
  ['repeat days win over a date', { time: '08:00', days: [1], date: '2026-12-25' }, L(...MON, 7, 59), L(...MON, 8, 0)],
  ['a malformed date is ignored', { time: '07:00', days: [], date: 'tomorrow' }, L(...MON, 6, 0), L(...MON, 7, 0)],
  ['an empty date is ignored', { time: '07:00', days: [], date: '' }, L(...MON, 8, 0), L(2026, 10, 27, 7, 0)],
];
for (const [label, alarm, from, want] of cases) {
  n++;
  const got = nextAlarmTime(alarm, from);
  if (got !== want) fail(label, 'got', show(got), 'want', show(want));
}

// Properties over a sweep: the result is always in the future (strictly after `from`), on an allowed weekday, at the
// alarm's wall-clock time, and no allowed day is skipped (nothing earlier between `from` and the result qualifies).
const DAYSETS = [[], [0], [6], [1, 2, 3, 4, 5], [0, 6], [0, 1, 2, 3, 4, 5, 6], [2, 4]];
for (let step = 0; step < 14 * 24 * 4; step++) {
  const from = L(2026, 10, 20) + step * 15 * 60e3 + 7e3;
  for (const days of DAYSETS) for (const time of ['00:00', '06:45', '12:00', '23:59']) {
    n++;
    const got = nextAlarmTime({ time, days }, from);
    const d = new Date(got);
    const [hh, mm] = time.split(':').map(Number);
    if (!(got > from)) { fail('not in the future', time, days, show(from), show(got)); continue; }
    if (d.getHours() !== hh || d.getMinutes() !== mm || d.getSeconds() || d.getMilliseconds()) { fail('wrong wall time', time, show(got)); continue; }
    if (days.length && !days.includes(d.getDay())) { fail('wrong weekday', time, days, show(got)); continue; }
    if (got - from > 8 * 864e5) { fail('more than a week ahead', time, days, show(from), show(got)); continue; }
    // the day before the result (at the same time) must not have been a valid, still-future ring
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, hh, mm).getTime();
    if (prev > from && (!days.length || days.includes(new Date(prev).getDay()))) fail('skipped an earlier ring', time, days, show(from), show(got));
  }
}

// Default `from` is now.
n++;
const now = Date.now(), dflt = nextAlarmTime({ time: '03:00', days: [] });
if (!(dflt > now && dflt - now <= 864e5 + 3600e3)) fail('default from = now', show(dflt));

// The chrome.alarms helpers are no-ops outside the extension (no chrome global) instead of throwing.
n++;
try {
  scheduleAt('alarm:x', Date.now() + 1000);
  cancelSchedule('alarm:x');
  scheduleAlarm({ id: 'x', time: '07:00', days: [], enabled: true });
  scheduleAlarm({ id: 'x', time: '07:00', days: [], enabled: false });
} catch (e) {
  fail('schedule helpers throw without chrome.alarms', e.message);
}

console.log(`${n - bad}/${n} schedule checks passed`);
process.exit(bad ? 1 : 0);
