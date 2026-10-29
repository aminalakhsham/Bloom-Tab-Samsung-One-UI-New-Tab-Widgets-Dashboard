// Finder's natural-language parsers in plain node (exits 1 on failure): Arabic folding, dates and times in a sentence
// (English and Arabic), reminders, durations, date questions (days until/since, weekday, offsets, Ramadan and Eid with
// the Umm al-Qura calendar, week numbers), plain dates and "time in <city>" with Arabic city names.
// usage: node .dev/finder-nlp.mjs
import { foldArabic, foldCmd, parseWhen, parseReminder, parseDuration, parseDateQuestion, parseDay, hijriOf, isoWeek, cityZone, timeQuery, dateKey } from '../js/shell/nlp.js';

let n = 0, bad = 0;
const check = (cond, what, got) => { n++; if (!cond) { bad++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };
const NOW = new Date(2026, 9, 26, 10, 0); // Monday 26 Oct 2026, 10:00
const day = (y, m, d) => new Date(y, m - 1, d);
const key = (d) => (d ? dateKey(d) : null);

// ——— folding
check(foldArabic('مؤقت ١٠ دقائق') === 'مؤقت 10 دقائق', 'Arabic-Indic digits', foldArabic('مؤقت ١٠ دقائق'));
check(foldArabic('۱۲') === '12', 'Persian digits');
check(foldArabic('شغّل غدًا مساءً') === 'شغل غدا مساء', 'short vowels dropped', foldArabic('شغّل غدًا مساءً'));
check(foldCmd('  أخذت   الدواء ') === 'اخذت الدواء', 'hamza and spaces', foldCmd('  أخذت   الدواء '));
check(foldCmd('حتى قهوة') === 'حتي قهوه', 'alef maqsura and ta marbuta', foldCmd('حتى قهوة'));

// ——— dates and times in a sentence: [text, title, date, time]
for (const [q, title, date, time] of [
  ['lunch with Sara Friday 1pm', 'lunch with Sara', '2026-10-30', '13:00'],
  ['call mom tomorrow at 6pm', 'call mom', '2026-10-27', '18:00'],
  ['dentist tomorrow 3pm', 'dentist', '2026-10-27', '15:00'],
  ['meeting on dec 3 at 10:30', 'meeting', '2026-12-03', '10:30'],
  ['standup next monday 9am', 'standup', '2026-11-02', '09:00'],
  ['pay rent on 1 november', 'pay rent', '2026-11-01', ''],
  ['water plants in 2 hours', 'water plants', '2026-10-26', '12:00'],
  ['gym at 5', 'gym', '2026-10-26', '17:00'],
  ['call back at 9am', 'call back', '2026-10-27', '09:00'],
  ['dinner tonight', 'dinner', '2026-10-26', '20:00'],
  ['غداء مع سارة الجمعة الساعة 1 ظهرًا', 'غداء مع سارة', '2026-10-30', '13:00'],
  ['اتصل بأمي غدًا الساعة ٦ مساءً', 'اتصل بأمي', '2026-10-27', '18:00'],
  ['اجتماع بعد ساعتين', 'اجتماع', '2026-10-26', '12:00'],
  ['موعد الطبيب 3 مارس', 'موعد الطبيب', '2027-03-03', ''],
  ['موعد يوم الأحد الساعة 9 صباحا', 'موعد', '2026-11-01', '09:00'],
]) {
  const w = parseWhen(q, NOW);
  check(w && w.title === title && w.date === date && w.time === time, `parseWhen "${q}"`, w && { title: w.title, date: w.date, time: w.time });
}
for (const q of ['hello world', 'buy milk', '12 apples', 'water 500ml']) check(parseWhen(q, NOW) === null, `parseWhen "${q}" finds no date`, parseWhen(q, NOW));

// ——— reminders
for (const [q, title, due] of [
  ['remind me to call mom at 6pm', 'call mom', '2026-10-26 18:00'],
  ['remind me buy milk', 'buy milk', null],
  ['Remind me to stretch in 30 minutes', 'stretch', '2026-10-26 10:30'],
  ['ذكرني بالاتصال بأمي الساعة 6 مساءً', 'الاتصال بأمي', '2026-10-26 18:00'],
  ['ذكرني بكرة أتصل بأحمد', 'أتصل بأحمد', '2026-10-27'],
  ['ذكرني أن أشرب الماء بعد ساعة', 'أشرب الماء', '2026-10-26 11:00'],
  ['reminder: renew passport friday', 'renew passport', '2026-10-30'],
]) {
  const r = parseReminder(q, NOW);
  const got = r && (r.when ? r.when.date + (r.when.time ? ' ' + r.when.time : '') : null);
  check(r && r.title === title && got === due, `parseReminder "${q}"`, r && { title: r.title, due: got });
}
for (const q of ['remind', 'reminders', 'remind me', 'call mom']) check(parseReminder(q, NOW) === null, `"${q}" is not a reminder`, parseReminder(q, NOW));

// ——— durations (seconds)
for (const [q, s] of [['5m', 300], ['5', 300], ['1h 30m', 5400], ['90 sec', 90], ['2 hours', 7200], ['90 ثانية', 90], ['١٠ دقائق', 600], ['ساعتين', 7200], ['نصف ساعة', 1800], ['ربع ساعة', 900], ['ساعة', 3600]]) {
  check(parseDuration(q) === s, `parseDuration "${q}" = ${s}`, parseDuration(q));
}
check(parseDuration('kitchen') === null, 'parseDuration: no number → null');

// ——— date questions: [text, kind, date, days]
for (const [q, kind, date, days] of [
  ['days until Dec 25', 'until', '2026-12-25', 60],
  ['how many days until christmas', 'until', '2026-12-25', 60],
  ['how long until new year', 'until', '2027-01-01', 67],
  ['days until halloween', 'until', '2026-10-31', 5],
  ['كم يوم حتى 25 ديسمبر', 'until', '2026-12-25', 60],
  ['كم يوم على رأس السنة', 'until', '2027-01-01', 67],
  ['days until friday', 'until', '2026-10-30', 4],
  ['days until 12/25/2027', 'until', '2027-12-25', 425],
  ['days since jan 1', 'since', '2026-01-01', -298],
  ['what day is dec 25', 'weekday', '2026-12-25', 60],
  ['what day is march 3 2030', 'weekday', '2030-03-03', 1224],
  ['أي يوم 1 يناير 2027', 'weekday', '2027-01-01', 67],
  ['في أي يوم يكون 25 ديسمبر', 'weekday', '2026-12-25', 60],
  ['in 3 weeks', 'offset', '2026-11-16', 21],
  ['100 days from now', 'offset', '2027-02-03', 100],
  ['بعد 100 يوم', 'offset', '2027-02-03', 100],
  ["what's the date", 'today', '2026-10-26', 0],
  ['تاريخ اليوم', 'today', '2026-10-26', 0],
  ['week number', 'week', '2026-10-26', 0],
  ['رقم الأسبوع', 'week', '2026-10-26', 0],
  ['التاريخ الهجري', 'hijri', '2026-10-26', 0],
]) {
  const d = parseDateQuestion(q, NOW);
  check(d && d.kind === kind && key(d.date) === date && d.days === days, `parseDateQuestion "${q}"`, d && { kind: d.kind, date: key(d.date), days: d.days });
}
for (const q of ['3 days', 'days', 'until', 'what day', 'dates', 'date night ideas']) check(parseDateQuestion(q, NOW) === null, `"${q}" is not a date question`, parseDateQuestion(q, NOW));

// Hijri holidays: the date found must be that Umm al-Qura day (Ramadan 1, Shawwal 1, Dhu al-Hijjah 10), after today
const noon = (d) => new Date(d.getTime() + 12 * 3600e3);
if (hijriOf(NOW)) {
  for (const [q, m, d] of [['days until ramadan', 9, 1], ['كم يوم على رمضان', 9, 1], ['كم باقي على العيد', 10, 1], ['days until eid al-adha', 12, 10], ['days until islamic new year', 1, 1]]) {
    const r = parseDateQuestion(q, NOW);
    const h = r && hijriOf(noon(r.date));
    check(r && r.kind === 'until' && r.days > 0 && r.days < 360 && h.m === m && h.d === d, `"${q}" → Hijri ${m}/${d}`, r && { date: key(r.date), hijri: h });
  }
  const ram = parseDateQuestion('days until ramadan', NOW);
  check(key(ram.date) === '2027-02-08', 'Ramadan 1448 starts on 8 Feb 2027 (Umm al-Qura)', key(ram.date));
} else console.log('(no Islamic calendar in this node build: Hijri checks skipped)');

// ——— plain dates
for (const [q, want] of [['dec 25', '2026-12-25'], ['25 ديسمبر', '2026-12-25'], ['friday', '2026-10-30'], ['christmas', '2026-12-25'], ['march 3 2030', '2030-03-03'], ['tomorrow', '2026-10-27'], ['the 3rd of march', '2027-03-03'], ['dec 25 at 5pm', null], ['soon', null]]) {
  check(key(parseDay(q, NOW)) === want, `parseDay "${q}" = ${want}`, key(parseDay(q, NOW)));
}

// ——— ISO week numbers
for (const [d, w] of [[day(2026, 1, 1), 1], [day(2026, 10, 26), 44], [day(2021, 1, 3), 53], [day(2024, 12, 30), 1], [day(2026, 12, 31), 53]]) check(isoWeek(d) === w, `isoWeek ${key(d)} = ${w}`, isoWeek(d));

// ——— time in a city
const zones = Intl.supportedValuesOf('timeZone');
for (const [q, tz] of [
  ['time in tokyo', 'Asia/Tokyo'], ['what time is it in Abu Dhabi', 'Asia/Dubai'], ['dubai time', 'Asia/Dubai'], ['time in new york', 'America/New_York'],
  ['time in london?', 'Europe/London'], ['time in mecca', 'Asia/Riyadh'], ['time in uae', 'Asia/Dubai'], ['time in honolulu', 'Pacific/Honolulu'],
  ['الوقت في دبي', 'Asia/Dubai'], ['كم الساعة في لندن', 'Europe/London'], ['الساعة كم في القاهرة', 'Africa/Cairo'], ['توقيت مكة', 'Asia/Riyadh'],
  ['الوقت في الرياض', 'Asia/Riyadh'], ['الوقت في رياض', 'Asia/Riyadh'], ['الوقت في عمّان', 'Asia/Amman'], ['الوقت في عمان', 'Asia/Muscat'],
  ['الوقت في الدار البيضاء', 'Africa/Casablanca'], ['الوقت الآن في طوكيو', 'Asia/Tokyo'], ['الوقت في london', 'Europe/London'],
]) {
  const tq = timeQuery(q);
  const z = tq && cityZone(tq.city, { exact: tq.exact, zones });
  check(z === tz, `time: "${q}" → ${tz}`, { tq, z });
}
for (const q of ['screen time', 'pacific time', 'bed time', 'focus time', 'timer 5m', 'time']) {
  const tq = timeQuery(q);
  check(!tq || !cityZone(tq.city, { exact: tq.exact, zones }), `"${q}" is not a city`, tq);
}

console.log(`${n - bad}/${n} Finder parser checks passed`);
process.exit(bad ? 1 : 0);
