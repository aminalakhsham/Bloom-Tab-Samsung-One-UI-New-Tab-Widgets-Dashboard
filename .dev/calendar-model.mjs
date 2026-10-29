// Fast checks of Calendar's pure logic (no browser): event normalization (legacy fields), repeat rules (daily, weekly
// on days, monthly by day and "fourth Monday", yearly, Feb 29, intervals, until, count, removed days), expansion of
// multi-day and repeating events, series split, alerts (two per event, all-day at 9:00, next alert), week numbers,
// time zones, the side-by-side layout, Reminder items, the .ics reader/writer (time zones, all-day, RRULE, EXDATE,
// RECURRENCE-ID, VALARM, folding, round trip) and natural-language quick add in English and Arabic.
// usage: node .dev/calendar-model.mjs   (exits 1 on failure)
import * as M from '../js/calendar/model.js';
import { parseICS, writeICS, fromRRule, toRRule, subUrl, subEvents } from '../js/calendar/ics.js';
import { parseEvent, eventFromText } from '../js/calendar/smart.js';

let bad = 0, n = 0;
const ok = (cond, what, extra = '') => { n++; if (!cond) { bad++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const D = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const keys = (list) => list.map((o) => o.occ);
const days = (ev, a, b) => M.occurrenceDays(M.norm(ev), new Date(a), new Date(b)).map(M.dkey);

// ---------------------------------------------------------------- normalization
{
  const legacy = M.norm({ id: 'a', title: 'Old', start: D(2026, 10, 26, 9), end: D(2026, 10, 26, 10), allDay: false, color: '#f00', notes: 'n', alert: '10' });
  ok(legacy.alerts.length === 1 && legacy.alerts[0] === 10 && legacy.cal === 'my', 'legacy alert "10" → alerts [10], default calendar');
  ok(M.norm({ id: 'b', start: D(2026, 1, 1), alert: 'none' }).alerts.length === 0, 'alert "none" → no alerts');
  const ad = M.norm({ id: 'c', title: 'Trip', start: D(2026, 10, 26, 0), end: D(2026, 10, 26, 0), allDay: true });
  ok(ad.end === D(2026, 10, 26, 23, 59), "Finder's all-day event (end = start) ends at 23:59 the same day");
  const ad2 = M.norm({ id: 'd', start: D(2026, 10, 26, 13), end: D(2026, 10, 28, 5), allDay: true });
  ok(ad2.start === D(2026, 10, 26) && ad2.end === D(2026, 10, 28, 23, 59), 'all-day snaps to whole days');
  ok(M.norm({ id: 'e', start: D(2026, 1, 1, 9), end: D(2026, 1, 1, 8) }).end === D(2026, 1, 1, 10), 'end before start → one hour');
  const p = M.pack({ ...M.norm({ id: 'f', start: 1, end: 2, alert: '10' }), alerts: [10] });
  ok(!('alert' in p) && !('readOnly' in p) && !('place' in p) && !('repeat' in p) && p.alerts[0] === 10, 'pack drops derived/empty fields and the legacy alert');
  ok(M.norm({ id: 'g', start: 1, alerts: [5, 10, 60] }).alerts.length === 2, 'two alerts at most');
  ok(M.norm({ id: 'h', start: 1, src: 'sub1' }).readOnly, 'subscribed events are read-only');
}

// ---------------------------------------------------------------- repeat rules
{
  const base = { id: 'r', title: 'R', start: D(2026, 1, 5, 9), end: D(2026, 1, 5, 10) }; // Monday 5 Jan 2026
  ok(days({ ...base, repeat: { freq: 'day', interval: 1 } }, D(2026, 1, 1), D(2026, 1, 9)).join() === '2026-01-05,2026-01-06,2026-01-07,2026-01-08', 'daily');
  ok(days({ ...base, repeat: { freq: 'day', interval: 3 } }, D(2026, 1, 10), D(2026, 1, 20)).join() === '2026-01-11,2026-01-14,2026-01-17', 'every 3 days, starting mid-window');
  ok(days({ ...base, repeat: { freq: 'week', interval: 1, days: [1, 3, 5] } }, D(2026, 1, 5), D(2026, 1, 12)).join() === '2026-01-05,2026-01-07,2026-01-09', 'weekly on Mon, Wed, Fri');
  ok(days({ ...base, repeat: { freq: 'week', interval: 2 } }, D(2026, 1, 1), D(2026, 2, 10)).join() === '2026-01-05,2026-01-19,2026-02-02', 'every other week');
  ok(days({ ...base, repeat: { freq: 'month', interval: 1 } }, D(2026, 1, 1), D(2026, 4, 30)).join() === '2026-01-05,2026-02-05,2026-03-05,2026-04-05', 'monthly on the 5th');
  ok(days({ ...base, start: D(2026, 1, 31, 9), end: D(2026, 1, 31, 10), repeat: { freq: 'month', interval: 1 } }, D(2026, 1, 1), D(2026, 6, 1)).join() === '2026-01-31,2026-03-31,2026-05-31', 'monthly on the 31st skips short months');
  ok(days({ ...base, start: D(2026, 1, 26, 9), end: D(2026, 1, 26, 10), repeat: { freq: 'month', interval: 1, pos: 4, wd: 1 } }, D(2026, 1, 1), D(2026, 4, 1)).join() === '2026-01-26,2026-02-23,2026-03-23', 'monthly on the fourth Monday');
  ok(days({ ...base, start: D(2026, 1, 30, 9), end: D(2026, 1, 30, 10), repeat: { freq: 'month', interval: 1, pos: -1, wd: 5 } }, D(2026, 1, 1), D(2026, 4, 1)).join() === '2026-01-30,2026-02-27,2026-03-27', 'monthly on the last Friday');
  ok(days({ ...base, start: D(2024, 2, 29, 9), end: D(2024, 2, 29, 10), repeat: { freq: 'year', interval: 1 } }, D(2024, 1, 1), D(2029, 1, 1)).join() === '2024-02-29,2028-02-29', 'Feb 29 yearly only in leap years');
  ok(days({ ...base, repeat: { freq: 'day', interval: 1, until: '2026-01-07' } }, D(2026, 1, 1), D(2026, 2, 1)).join() === '2026-01-05,2026-01-06,2026-01-07', 'until (inclusive)');
  ok(days({ ...base, repeat: { freq: 'week', interval: 1, days: [1, 3], count: 3 } }, D(2026, 1, 1), D(2026, 3, 1)).join() === '2026-01-05,2026-01-07,2026-01-12', 'count = 3');
  ok(days({ ...base, repeat: { freq: 'day', interval: 1, count: 5 } }, D(2026, 1, 8), D(2026, 3, 1)).join() === '2026-01-08,2026-01-09', 'count counts from the first occurrence, not the window');
  ok(days({ ...base, repeat: { freq: 'day', interval: 1, count: 4 }, exdates: ['2026-01-06'] }, D(2026, 1, 1), D(2026, 2, 1)).join() === '2026-01-05,2026-01-07,2026-01-08', 'removed days still count');
  ok(days({ ...base, repeat: { freq: 'week', interval: 1 }, exdates: ['2026-01-12'] }, D(2026, 1, 1), D(2026, 1, 27)).join() === '2026-01-05,2026-01-19,2026-01-26', 'exdates leave a week out');
  ok(days({ ...base, repeat: { freq: 'day', interval: 1 } }, D(2025, 12, 1), D(2026, 1, 5)).length === 0, 'nothing before the first occurrence');
  const far = days({ ...base, repeat: { freq: 'day', interval: 1 } }, D(2036, 1, 1), D(2036, 1, 3));
  ok(far.join() === '2036-01-01,2036-01-02', 'a window ten years later is computed directly');
}

// ---------------------------------------------------------------- expansion
{
  const list = [
    M.norm({ id: 'm', title: 'Conference', start: D(2026, 10, 26, 0, 30), end: D(2026, 10, 28, 18), allDay: false }),
    M.norm({ id: 'w', title: 'Gym', start: D(2026, 10, 5, 7), end: D(2026, 10, 5, 8), repeat: { freq: 'week', interval: 1 } }),
    M.norm({ id: 'a', title: 'Holiday', start: D(2026, 10, 27), end: D(2026, 10, 27, 23, 59), allDay: true }),
  ];
  const occ = M.expand(list, D(2026, 10, 27), D(2026, 10, 28));
  ok(occ.map((o) => o.title).join() === 'Holiday,Conference', 'a day shows the all-day event first, then a multi-day event running through it');
  const week = M.expand(list, D(2026, 10, 26), D(2026, 11, 2));
  const gym = week.find((o) => o.master === 'w');
  ok(gym && gym.occ === '2026-10-26' && gym.key === 'w/2026-10-26' && gym.recurring && new Date(gym.start).getHours() === 7, 'repeating occurrence keeps its time and gets a key');
  ok(M.isMulti(list[0]) && !M.isMulti(gym) && M.isMulti(list[2]), 'multi-day and all-day are bars');
  const lanes = M.barLanes(week, Array.from({ length: 7 }, (_, i) => M.addDays(D(2026, 10, 26), i)));
  ok(lanes.lanes === 2 && lanes.bars.find((b) => b.o.master === 'm').c1 === 2, 'bars get lanes (overlapping bars stack)');
  const ends0 = M.norm({ id: 'z', start: D(2026, 10, 26, 22), end: D(2026, 10, 27, 0) });
  ok(!M.isMulti(ends0) && M.daysBetween(M.lastDay(ends0), D(2026, 10, 26)) === 0, 'an event ending at midnight stays on its day');
  // DST: Asia/Gaza (this machine) and others change clocks in late October; wall time stays the same
  const dst = M.expand([M.norm({ id: 'd', title: 'Daily', start: D(2026, 10, 20, 9), end: D(2026, 10, 20, 10), repeat: { freq: 'day', interval: 1 } })], D(2026, 10, 20), D(2026, 11, 5));
  ok(dst.every((o) => new Date(o.start).getHours() === 9 && new Date(o.end).getHours() === 10), 'repeating events keep 9:00 across a daylight-saving change');
}

// ---------------------------------------------------------------- split, shift
{
  const ev = M.norm({ id: 's', title: 'Standup', start: D(2026, 10, 5, 9), end: D(2026, 10, 5, 9, 15), repeat: { freq: 'week', interval: 1, days: [1, 3] }, exdates: ['2026-10-07', '2026-10-21'] });
  const [before, after] = M.splitSeries(ev, '2026-10-19');
  ok(before.repeat.until === '2026-10-18' && before.exdates.join() === '2026-10-07', 'split: the series ends the day before, keeps its earlier removed days');
  ok(M.dkey(after.start) === '2026-10-19' && new Date(after.start).getHours() === 9 && after.exdates.join() === '2026-10-21', 'split: the rest starts on that day with the later removed days');
  const cnt = M.norm({ id: 'c', title: 'Course', start: D(2026, 10, 1, 18), end: D(2026, 10, 1, 19), repeat: { freq: 'week', interval: 1, count: 6 } });
  const [, rest] = M.splitSeries(cnt, '2026-10-15');
  ok(rest.repeat.count === 4, `split of a 6-times series after 2 occurrences leaves 4 (${rest.repeat.count})`);
  ok(M.shiftRepeat({ freq: 'week', interval: 1, days: [1, 3] }, 1).days.join() === '2,4', 'moving a series a day moves its weekdays');
  ok(M.shiftRepeat({ freq: 'week', interval: 1, days: [6] }, 1).days.join() === '0', 'Saturday + 1 → Sunday');
}

// ---------------------------------------------------------------- alerts
{
  const now = D(2026, 10, 26, 8);
  const t = M.norm({ id: 't', start: D(2026, 10, 26, 13, 30), end: D(2026, 10, 26, 14, 30), alerts: [60, 10] });
  ok(M.nextAlert(t, now) === D(2026, 10, 26, 12, 30), 'next alert is the earlier of two');
  ok(M.nextAlert(t, D(2026, 10, 26, 12, 31)) === D(2026, 10, 26, 13, 20), 'then the second one');
  ok(M.nextAlert(t, D(2026, 10, 26, 13, 21)) === null, 'none after the last');
  const ad = M.norm({ id: 'u', start: D(2026, 10, 28), end: D(2026, 10, 28, 23, 59), allDay: true, alerts: [1440] });
  ok(M.nextAlert(ad, now) === D(2026, 10, 27, 9), 'all-day "1 day before" rings at 9:00 the day before');
  ok(M.nextAlert({ ...ad, alerts: [0] }, now) === D(2026, 10, 28, 9), 'all-day "on the day" rings at 9:00');
  const rep = M.norm({ id: 'v', start: D(2026, 10, 5, 7), end: D(2026, 10, 5, 8), repeat: { freq: 'week', interval: 1 }, alerts: [15] });
  ok(M.nextAlert(rep, now) === D(2026, 11, 2, 6, 45), 'a weekly event alerts before its next occurrence');
  const yearly = M.norm({ id: 'y', start: D(2026, 1, 15, 10), end: D(2026, 1, 15, 11), repeat: { freq: 'year', interval: 1 }, alerts: [0] });
  ok(M.nextAlert(yearly, now) === D(2027, 1, 15, 10), 'a yearly event finds next year’s alert');
  ok(M.nextAlert(M.norm({ id: 'x', start: D(2026, 10, 26, 13), alerts: [10], src: 'sub' }), now) === null, 'subscribed events never alert');
  const moments = M.alertMoments(M.expand([t], now, now + M.DAY), now, now + M.DAY);
  ok(moments.length === 2 && moments[0].min === 60, 'alertMoments lists both');
}

// ---------------------------------------------------------------- weeks, layout, reminders, zones
{
  ok(M.isoWeek(new Date(2026, 0, 1)) === 1 && M.isoWeek(new Date(2026, 11, 31)) === 53 && M.isoWeek(new Date(2027, 0, 4)) === 1, 'ISO week numbers');
  ok(M.weekNumber(new Date(2026, 0, 1), 0) === 1 && M.weekNumber(new Date(2026, 0, 4), 0) === 2 && M.weekNumber(new Date(2026, 11, 31), 0) === 1, 'Sunday-first weeks: the week holding Jan 1 is week 1');
  ok(M.dkey(M.startOfWeek(D(2026, 10, 28), 6)) === '2026-10-24' && M.dkey(M.startOfWeek(D(2026, 10, 28), 1)) === '2026-10-26', 'start of week for Saturday/Monday');
  const day = D(2026, 10, 26);
  const L = M.layoutColumn([{ start: D(2026, 10, 26, 9), end: D(2026, 10, 26, 10) }, { start: D(2026, 10, 26, 9, 30), end: D(2026, 10, 26, 11) }, { start: D(2026, 10, 26, 12), end: D(2026, 10, 26, 13) }], day);
  ok(L[0].cols === 2 && L[1].col === 1 && L[2].cols === 1 && L[2].top === 720, 'overlapping events sit side by side');
  const rems = M.reminderItems([{ id: 1, title: 'Milk', due: D(2026, 10, 26, 18) }, { id: 2, title: 'Day', due: '2026-10-27' }, { id: 3, title: 'No due' }], D(2026, 10, 26), D(2026, 10, 28));
  ok(rems.length === 2 && !rems[0].allDay && rems[1].allDay && rems[0].readOnly && rems[0].cal === 'reminders', 'reminders with a due date become read-only items');
  ok(M.reminderItems({ items: [{ id: 1, title: 'L', due: D(2026, 10, 26, 9), list: 'w' }], lists: [{ id: 'w', color: '#123456' }] }, D(2026, 10, 26), D(2026, 10, 27))[0].color === '#123456', 'reminder lists lend their colour');
  const ny = M.zonedMs(2026, 7, 1, 9, 0, 0, 'America/New_York');
  ok(ny === Date.UTC(2026, 6, 1, 13), '9:00 in New York (summer) is 13:00 UTC');
  ok(M.zonedMs(2026, 1, 1, 9, 0, 0, 'America/New_York') === Date.UTC(2026, 0, 1, 14), '…and 14:00 UTC in winter');
  ok(M.wallInputs(ny, 'America/New_York').time === '09:00' && M.wallInputs(ny, 'Asia/Tokyo').time === '22:00', 'wall time in other zones');
  ok(M.zoneOffset('Asia/Riyadh', ny) === 180 && M.zoneOffset('UTC', ny) === 0, 'zone offsets');
  ok(M.fromInputs('2026-03-08', '02:30', 'America/New_York') > 0, 'a time inside the spring-forward gap still resolves');
}

// ---------------------------------------------------------------- .ics
{
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'X-WR-CALNAME:Team', 'X-APPLE-CALENDAR-COLOR:#FF2968',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:weekly-1@google.com', 'DTSTART;TZID=Europe/Berlin:20260105T090000', 'DTEND;TZID=Europe/Berlin:20260105T093000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260331T225959Z', 'EXDATE;TZID=Europe/Berlin:20260107T090000', 'SUMMARY:Standup\\, team', 'LOCATION:Room 4',
    'DESCRIPTION:Line one\\nLine two that is quite long so that the writer has to fold it over more than one line of seventy-five octets',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM', 'BEGIN:VALARM', 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:weekly-1@google.com', 'RECURRENCE-ID;TZID=Europe/Berlin:20260112T090000', 'DTSTART;TZID=Europe/Berlin:20260112T110000',
    'DTEND;TZID=Europe/Berlin:20260112T113000', 'SUMMARY:Standup (moved)', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:allday-2', 'DTSTART;VALUE=DATE:20260210', 'DTEND;VALUE=DATE:20260213', 'SUMMARY:Ski trip', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:utc-3', 'DTSTART:20260301T120000Z', 'DURATION:PT1H30M', 'SUMMARY:Call', 'ATTENDEE;CN="Sara Ali":mailto:sara@example.com', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:gone', 'DTSTART:20260301T120000Z', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:month-4', 'DTSTART;VALUE=DATE:20260126', 'RRULE:FREQ=MONTHLY;BYDAY=4MO;COUNT=10', 'SUMMARY:Book club', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:wkday-5', 'DTSTART:20260105T080000Z', 'DTEND:20260105T083000Z', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'SUMMARY:Commute', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const p = parseICS(ics);
  ok(p.name === 'Team' && p.color === '#FF2968', 'calendar name and colour');
  ok(p.events.length === 6, `cancelled event left out (${p.events.length} events)`);
  const st = p.events.find((e) => e.uid === 'weekly-1@google.com' && !e.orig);
  ok(st && st.title === 'Standup, team' && st.place === 'Room 4' && st.notes.startsWith('Line one\nLine two'), 'text fields unescaped');
  ok(st.start === Date.UTC(2026, 0, 5, 8) && st.end === Date.UTC(2026, 0, 5, 8, 30) && st.tz === 'Europe/Berlin', 'TZID converted (9:00 Berlin = 8:00 UTC)');
  ok(st.repeat.freq === 'week' && st.repeat.days.join() === '1,3' && st.repeat.until === M.dkey(Date.UTC(2026, 2, 31, 22, 59, 59)), 'RRULE weekly BYDAY UNTIL');
  ok(st.exdates.includes('2026-01-07') && st.exdates.includes('2026-01-12'), 'EXDATE and the moved occurrence are left out of the series');
  ok(st.alerts.join() === '15,1440', 'VALARM triggers → alerts');
  const mv = p.events.find((e) => e.orig);
  ok(mv && mv.orig === '2026-01-12' && mv.of === 'weekly-1@google.com' && !mv.repeat && mv.title === 'Standup (moved)', 'RECURRENCE-ID becomes a changed occurrence');
  const ski = p.events.find((e) => e.uid === 'allday-2');
  ok(ski.allDay && ski.start === D(2026, 2, 10) && ski.end === D(2026, 2, 12, 23, 59), 'all-day DTEND is exclusive');
  const call = p.events.find((e) => e.uid === 'utc-3');
  ok(call.start === Date.UTC(2026, 2, 1, 12) && call.end - call.start === 90 * 60e3 && call.people[0] === 'Sara Ali', 'UTC + DURATION + attendee name');
  const bc = p.events.find((e) => e.uid === 'month-4');
  ok(bc.repeat.freq === 'month' && bc.repeat.pos === 4 && bc.repeat.wd === 1 && bc.repeat.count === 10, 'monthly 4MO with COUNT');
  const cm = p.events.find((e) => e.uid === 'wkday-5');
  ok(cm.repeat.freq === 'week' && cm.repeat.days.join() === '1,2,3,4,5', 'DAILY;BYDAY=MO-FR → every weekday');
  const occ = M.expand(p.events.map((e, i) => M.norm({ ...e, id: 'i' + i })), D(2026, 1, 5), D(2026, 1, 19)).filter((o) => /Standup/.test(o.title));
  ok(occ.length === 3 && occ.some((o) => o.title === 'Standup (moved)'), `the series and the moved occurrence expand together (${occ.length})`);
  ok(fromRRule({ FREQ: 'YEARLY', INTERVAL: '2' }).interval === 2 && fromRRule({ FREQ: 'SECONDLY' }) === null, 'fromRRule edge cases');
  ok(toRRule({ freq: 'week', interval: 2, days: [1, 5], count: 4 }) === 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4', 'toRRule weekly');
  ok(toRRule({ freq: 'month', interval: 1, pos: -1, wd: 5, until: '2026-12-31' }, { allDay: true }) === 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20261231', 'toRRule monthly last Friday until');

  // round trip
  const mine = [
    M.norm({ id: 'e1', title: 'Lunch, with Sara; café', start: D(2026, 10, 30, 13), end: D(2026, 10, 30, 14), place: 'Café Luna', notes: 'Bring the book\nand the keys', alerts: [10, 60], people: ['Sara'] }),
    M.norm({ id: 'e2', title: 'عيد ميلاد سارة', start: D(2026, 11, 3), end: D(2026, 11, 3, 23, 59), allDay: true, repeat: { freq: 'year', interval: 1 }, alerts: [1440] }),
    M.norm({ id: 'e3', title: 'Gym', start: D(2026, 10, 5, 7), end: D(2026, 10, 5, 8), repeat: { freq: 'week', interval: 1, days: [1, 4] }, exdates: ['2026-10-08'] }),
    M.norm({ id: 'e4', title: 'Flight', start: Date.UTC(2026, 11, 1, 18), end: Date.UTC(2026, 11, 2, 2), tz: 'America/New_York' }),
  ];
  const out = writeICS(mine, { name: 'Bloom' });
  ok(out.startsWith('BEGIN:VCALENDAR\r\n') && out.trim().endsWith('END:VCALENDAR') && out.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'written file: CRLF lines of 75 octets at most');
  ok(out.includes('SUMMARY:Lunch\\, with Sara\\; café') && out.includes('DTSTART;VALUE=DATE:20261103') && out.includes('DTEND;VALUE=DATE:20261104'), 'escaping and all-day DATE values');
  ok(out.includes('DTSTART;TZID=America/New_York:20261201T130000'), 'timed event written in its own zone');
  const back = parseICS(out);
  ok(back.name === 'Bloom' && back.events.length === 4, 'round trip: 4 events');
  const b1 = back.events.find((e) => e.uid === 'e1@bloomtab');
  ok(b1 && b1.title === mine[0].title && b1.start === mine[0].start && b1.end === mine[0].end && b1.place === 'Café Luna' && b1.notes === 'Bring the book\nand the keys', 'round trip: text and times');
  ok(b1.alerts.join() === '10,60' && b1.people.join() === 'Sara', 'round trip: alerts and invitees');
  const b2 = back.events.find((e) => e.uid === 'e2@bloomtab');
  ok(b2.allDay && b2.start === mine[1].start && b2.end === mine[1].end && b2.repeat.freq === 'year' && b2.alerts.join() === '1440', 'round trip: all-day yearly with a 9:00 reminder the day before');
  const b3 = back.events.find((e) => e.uid === 'e3@bloomtab');
  ok(b3.repeat.days.join() === '1,4' && b3.exdates.join() === '2026-10-08', 'round trip: weekly days and removed day');
  const b4 = back.events.find((e) => e.uid === 'e4@bloomtab');
  ok(b4.start === mine[3].start && b4.end === mine[3].end && b4.tz === 'America/New_York', 'round trip: time zone');
  ok(subUrl('webcal://example.com/a.ics') === 'https://example.com/a.ics' && subUrl('calendar.google.com/x.ics') === 'https://calendar.google.com/x.ics' && subUrl('ftp://x.com/a') === '' && subUrl('hello') === '', 'subscription addresses');
  const se = subEvents(p, 'sub1', D(2026, 1, 1));
  ok(se.every((e) => e.src === 'sub1' && e.id.startsWith('sub1:')) && se.find((e) => e.orig).of === 'sub1:weekly-1@google.com', 'subscription events get stable ids and their series link');
  ok(subEvents(p, 'sub1', D(2028, 6, 1)).every((e) => e.repeat), 'events that ended over a year ago are dropped from a subscription');
}

// ---------------------------------------------------------------- natural language
{
  const now = new Date(2026, 9, 26, 10, 0); // Monday 26 Oct 2026, 10:00
  const e1 = eventFromText('Lunch with Sara Friday 1pm at Café Luna', now);
  ok(e1.title === 'Lunch with Sara' && e1.place === 'Café Luna' && e1.people.join() === 'Sara', `"Lunch with Sara Friday 1pm at Café Luna" → title/place/people (${JSON.stringify(e1)})`);
  ok(e1.start === D(2026, 10, 30, 13) && e1.end === D(2026, 10, 30, 14) && !e1.allDay, '…on Friday 13:00–14:00');
  const e2 = eventFromText('Soccer game Saturday 11am-1pm every week', now);
  ok(e2.title === 'Soccer game' && e2.start === D(2026, 10, 31, 11) && e2.end === D(2026, 10, 31, 13) && e2.repeat?.freq === 'week', '"Soccer game Saturday 11am-1pm every week" → range + weekly');
  const e3 = eventFromText('Vacation Mon-Fri', now);
  ok(e3.allDay && e3.start === D(2026, 10, 26) && e3.end === D(2026, 10, 30, 23, 59) && e3.title === 'Vacation', '"Vacation Mon-Fri" → all-day Monday to Friday');
  const e4 = eventFromText('gym every monday 7am', now);
  ok(e4.repeat?.freq === 'week' && new Date(e4.start).getDay() === 1 && new Date(e4.start).getHours() === 7 && e4.title === 'gym', '"gym every monday 7am" → weekly on Monday');
  const e5 = eventFromText('Dentist tomorrow at 9:30 for 30 minutes', now);
  ok(e5.start === D(2026, 10, 27, 9, 30) && e5.end === D(2026, 10, 27, 10) && e5.title === 'Dentist', '"Dentist tomorrow at 9:30 for 30 minutes"');
  const sel = new Date(2026, 10, 5);
  const e6 = eventFromText('Call mom 6pm', now, { day: sel });
  ok(e6.start === D(2026, 11, 5, 18) && e6.title === 'Call mom', 'quick add under a selected day: a time without a day goes on that day');
  const e7 = eventFromText('Team offsite', now, { day: sel });
  ok(e7.allDay && e7.start === D(2026, 11, 5) && e7.title === 'Team offsite' && !e7.found, 'nothing recognised → all-day on the selected day');
  const e8 = eventFromText('Standup every weekday 9am', now);
  ok(e8.repeat?.days?.join() === '1,2,3,4,5' && e8.title === 'Standup', '"every weekday"');
  const a1 = eventFromText('اجتماع مع أحمد غدا الساعة 3 م في المكتب', now);
  ok(a1.start === D(2026, 10, 27, 15) && a1.place === 'المكتب' && a1.people.join() === 'أحمد' && a1.title === 'اجتماع مع أحمد', `Arabic: meeting with Ahmed tomorrow 3 pm at the office (${JSON.stringify(a1)})`);
  const a2 = eventFromText('غداء مع سارة يوم الجمعة الساعة 1 م في مقهى النيل', now);
  ok(a2.start === D(2026, 10, 30, 13) && a2.place === 'مقهى النيل' && a2.title === 'غداء مع سارة', 'Arabic: lunch with Sara Friday 1 pm at Nile Café');
  const a3 = eventFromText('رياضة كل أسبوع يوم الاثنين من 10 إلى 11 ص', now);
  ok(a3.repeat?.freq === 'week' && new Date(a3.start).getDay() === 1 && new Date(a3.start).getHours() === 10 && new Date(a3.end).getHours() === 11, `Arabic: every week Monday 10–11 am (${JSON.stringify(a3)})`);
  const a4 = eventFromText('إجازة من الأحد إلى الخميس', now);
  ok(a4.allDay && new Date(a4.start).getDay() === 0 && new Date(a4.end).getDay() === 4, 'Arabic: Sunday to Thursday');
  const a5 = eventFromText('موعد الطبيب ٢٨ أكتوبر الساعة ١٠ ص', now);
  ok(a5.start === D(2026, 10, 28, 10) && a5.title === 'موعد الطبيب', 'Arabic-Indic digits and month name');
  const sp = parseEvent('Lunch with Sara Friday 1pm at Café Luna', now).spans.map((s) => s.kind);
  ok(sp.includes('when') && sp.includes('place') && sp.includes('person'), 'spans mark the recognised words');
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
