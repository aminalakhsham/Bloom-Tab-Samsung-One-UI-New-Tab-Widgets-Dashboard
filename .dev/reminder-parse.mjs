// Plain-node checks of Reminder's natural-language parser (parseQuickTime in js/reminder/parse.js, re-exported by
// js/apps/reminder.js), English and Arabic: times, days, dates, relative times, repeats, #category, ! and the
// recognised spans the Write a reminder field highlights.
// usage: node .dev/reminder-parse.mjs   (exits 1 on failure)
const { parseQuickTime } = await import('../js/reminder/parse.js');

let n = 0, bad = 0;
const fail = (...a) => { bad++; console.log('FAIL', ...a); };
const fmt = (ms) => (ms == null ? 'null' : new Date(ms).toString().slice(0, 21));

// A fixed "now": Monday 26 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 26, 10, 0, 0);
const at = (d, hh, mm = 0) => new Date(2026, 9, 26 + d, hh, mm).getTime(); // day offset from today
const rel = (ms) => NOW.getTime() + ms;
const MIN = 60e3, HR = 3600e3, DAY = 864e5;

// [input, expected title, expected due (ms | null)]
const CASES = [
  // English: days + explicit times
  ['Call mom tomorrow 6pm', 'Call mom', at(1, 18)],
  ['call mom tomorrow at 6pm', 'Call mom', at(1, 18)],
  ['remind me to buy milk at 5', 'Buy milk', at(0, 17)], // "at 5" with no am/pm means 5 pm
  ['Standup at 9', 'Standup', at(0, 21)], // 9 am has passed, so 9 pm today
  ['Standup at 9am', 'Standup', at(1, 9)], // 9 am has passed and was explicit: tomorrow
  ['Email at 3:15 pm', 'Email', at(0, 15, 15)],
  ['Pick up kids at 3:30pm', 'Pick up kids', at(0, 15, 30)],
  ['Meeting at 14:30', 'Meeting', at(0, 14, 30)],
  ['14:30 meeting', 'Meeting', at(0, 14, 30)],
  ['Meet Tim at 4', 'Meet Tim', at(0, 16)],
  ['12pm lunch', 'Lunch', at(0, 12)],
  ['Wake up 12am tomorrow', 'Wake up', at(1, 0)],
  ['Lunch at noon', 'Lunch', at(0, 12)],
  ['Backup at midnight', 'Backup', at(1, 0)], // midnight today has passed
  ['tomorrow at noon pay rent', 'Pay rent', at(1, 12)],
  ['Walk dog tomorrow morning', 'Walk dog', at(1, 9)],
  ['Walk dog in the morning', 'Walk dog', at(1, 9)], // this morning (9) has passed
  ['Call grandma tomorrow evening', 'Call grandma', at(1, 18)],
  ['reminder: water plants in the evening', 'Water plants', at(0, 18)],
  ['Read at night', 'Read', at(0, 21)],
  ['Dinner tonight', 'Dinner', at(0, 20)],
  ['Report today', 'Report', at(0, 11)], // 9 am default has passed: next full hour after now + 30 min
  ['Trip next week', 'Trip', at(7, 9)],
  ['Party day after tomorrow at 8pm', 'Party', at(2, 20)],
  ['Pay bills on friday', 'Pay bills', at(4, 9)],
  ['Pay bills next friday', 'Pay bills', at(4, 9)],
  ['Call bank tue 4pm', 'Call bank', at(1, 16)],
  ['Gym monday 7am', 'Gym', at(7, 7)], // today is Monday: next week's
  ['Buy gift Sunday', 'Buy gift', at(6, 9)],
  ['Water plants tmrw', 'Water plants', at(1, 9)],
  // English: relative
  ['Stretch in 2 hours', 'Stretch', rel(2 * HR)],
  ['tea in 30 min', 'Tea', rel(30 * MIN)],
  ['Feed cat in 5m', 'Feed cat', rel(5 * MIN)],
  ['Check oven in half an hour', 'Check oven', rel(30 * MIN)],
  ['Call back in an hour', 'Call back', rel(HR)],
  ['Review doc in 1.5 hours', 'Review doc', rel(1.5 * HR)],
  ['Renew passport in 3 days', 'Renew passport', rel(3 * DAY)],
  ['Follow up in 2 weeks', 'Follow up', rel(14 * DAY)],
  // English: no time
  ['Buy stamps', 'Buy stamps', null],
  ['buy 5 apples', 'Buy 5 apples', null],
  ['Book 2 tickets', 'Book 2 tickets', null],
  ['', '', null],
  // Arabic
  ['ذكرني بالاتصال بأمي غدا الساعة 5 مساء', 'الاتصال بأمي', at(1, 17)],
  ['ذكرني أن أشتري الخبز', 'أشتري الخبز', null],
  ['اجتماع بعد ساعتين', 'اجتماع', rel(2 * HR)],
  ['تمرين بعد 3 ساعات', 'تمرين', rel(3 * HR)],
  ['قهوة بعد نصف ساعة', 'قهوة', rel(30 * MIN)],
  ['شاي بعد ربع ساعة', 'شاي', rel(15 * MIN)],
  ['الفرن بعد 10 دقائق', 'الفرن', rel(10 * MIN)],
  ['الفرن بعد دقيقتين', 'الفرن', rel(2 * MIN)],
  ['تجديد الجواز بعد يومين', 'تجديد الجواز', rel(2 * DAY)],
  ['متابعة بعد أسبوع', 'متابعة', rel(7 * DAY)],
  ['موعد الطبيب بعد غد الساعة ١٠ صباحا', 'موعد الطبيب', at(2, 10)],
  ['رياضة يوم الجمعة', 'رياضة', at(4, 9)],
  ['رياضة الخميس الساعة 6 مساءً', 'رياضة', at(3, 18)],
  ['اجتماع الاثنين', 'اجتماع', at(7, 9)],
  ['عشاء الليلة', 'عشاء', at(0, 20)],
  ['تقرير اليوم', 'تقرير', at(0, 11)],
  ['شراء الخبز بكرة', 'شراء الخبز', at(1, 9)],
  ['قراءة كتاب الأسبوع القادم', 'قراءة كتاب', at(7, 9)],
  ['غداء الظهر', 'غداء', at(0, 12)],
  ['اتصل بأحمد الساعة 9:30', 'اتصل بأحمد', at(0, 21, 30)], // 9:30 am has passed, so 9:30 pm
  ['اتصل بأحمد الساعة ٨ صباحا غدا', 'اتصل بأحمد', at(1, 8)],
  ['سقي النباتات غدا الساعة 7 مساء', 'سقي النباتات', at(1, 19)],
  ['شراء طوابع', 'شراء طوابع', null],
  // relative days keep an explicit time ("in 2 days at 5pm" used to ignore the time)
  ['Pay bills in 2 days at 5pm', 'Pay bills', at(2, 17)],
  ['Call back in a day at 9:30am', 'Call back', at(1, 9, 30)],
  ['Review in 1 week at noon', 'Review', at(7, 12)],
  ['دفع الفواتير بعد يومين الساعة 5 مساء', 'دفع الفواتير', at(2, 17)],
  ['اجتماع بعد 3 أيام الساعة 10 صباحا', 'اجتماع', at(3, 10)],
  // months and years ahead, calendar dates
  ['Renew licence in 2 months', 'Renew licence', new Date(2026, 11, 26, 9).getTime()],
  ['Plan trip next month', 'Plan trip', new Date(2026, 10, 26, 9).getTime()],
  ['تجديد الاشتراك بعد شهر', 'تجديد الاشتراك', new Date(2026, 10, 26, 9).getTime()],
  ['Dentist Oct 30 10am', 'Dentist', at(4, 10)],
  ['Dentist on October 30th at 3pm', 'Dentist', at(4, 15)],
  ['Party 3 Nov', 'Party', new Date(2026, 10, 3, 9).getTime()],
  ['Exam 2027-01-15 at 8am', 'Exam', new Date(2027, 0, 15, 8).getTime()],
  ['Anniversary Jan 5', 'Anniversary', new Date(2027, 0, 5, 9).getTime()], // passed this year: next year
  ['موعد 30 أكتوبر الساعة 10 صباحا', 'موعد', at(4, 10)],
  ['حفلة 3 نوفمبر', 'حفلة', new Date(2026, 10, 3, 9).getTime()],
  ['غداء غدا 1 ظهرا', 'غداء', at(1, 13)], // a period word without "الساعة"
];

for (const [input, title, due] of CASES) {
  n++;
  const r = parseQuickTime(input, NOW);
  if (r.title !== title || r.due !== due) fail(JSON.stringify(input), '→', JSON.stringify(r.title), fmt(r.due), '| want', JSON.stringify(title), fmt(due));
}

// Repeats, #category and !: [input, title, due, repeat, extra checks]
const cats = [{ id: 'w', name: 'Work' }, { id: 'h', name: 'البيت' }, { id: 'g', name: 'Grocery list' }];
const REP = [
  ['Take pills every day at 8pm', 'Take pills', at(0, 20), { f: 'd' }],
  ['Take pills daily', 'Take pills', at(1, 9), { f: 'd' }], // 9:00 today has passed
  ['Standup every weekday at 9:30am', 'Standup', at(1, 9, 30), { f: 'w', days: [1, 2, 3, 4, 5] }],
  ['Gym every Monday and Thursday at 7pm', 'Gym', at(0, 19), { f: 'w', days: [1, 4] }],
  ['Gym on Fridays', 'Gym', at(4, 9), { f: 'w', days: [5] }],
  ['Water plants every 3 days', 'Water plants', at(3, 9), { f: 'd', n: 3 }],
  ['Clean every other week', 'Clean', at(14, 9), { f: 'w', n: 2 }],
  ['Pay rent every month', 'Pay rent', new Date(2026, 10, 26, 9).getTime(), { f: 'm' }],
  ['Pay rent monthly on Oct 30', 'Pay rent', at(4, 9), { f: 'm' }],
  ['Birthday yearly Nov 3', 'Birthday', new Date(2026, 10, 3, 9).getTime(), { f: 'y' }],
  ['Backup weekly tomorrow 6pm', 'Backup', at(1, 18), { f: 'w' }],
  ['تناول الدواء كل يوم الساعة 8 مساء', 'تناول الدواء', at(0, 20), { f: 'd' }],
  ['الرياضة يوميًا', 'الرياضة', at(1, 9), { f: 'd' }],
  ['صلاة الجمعة كل يوم الجمعة الساعة 12 ظهرا', 'صلاة الجمعة', at(4, 12), { f: 'w', days: [5] }],
  ['النادي كل اثنين وخميس الساعة 7 مساء', 'النادي', at(0, 19), { f: 'w', days: [1, 4] }],
  ['اجتماع الفريق كل أسبوع', 'اجتماع الفريق', at(7, 9), { f: 'w' }],
  ['دفع الإيجار كل شهر', 'دفع الإيجار', new Date(2026, 10, 26, 9).getTime(), { f: 'm' }],
  ['تنظيف كل يومين', 'تنظيف', at(2, 9), { f: 'd', n: 2 }],
  ['العمل كل يوم عمل الساعة 8 صباحا', 'العمل', at(1, 8), { f: 'w', days: [1, 2, 3, 4, 5] }],
];
for (const [input, title, due, repeat] of REP) {
  n++;
  const r = parseQuickTime(input, NOW);
  if (r.title !== title || r.due !== due || JSON.stringify(r.repeat) !== JSON.stringify(repeat)) fail(JSON.stringify(input), '→', JSON.stringify(r.title), fmt(r.due), JSON.stringify(r.repeat), '| want', JSON.stringify(title), fmt(due), JSON.stringify(repeat));
}
const EXTRA = [
  ['Prepare slides tomorrow 9am #Work !', { title: 'Prepare slides', cat: 'w', important: true, due: at(1, 9) }],
  ['Buy milk #Grocery_list', { title: 'Buy milk', cat: 'g', important: false, due: null }],
  ['تنظيف المطبخ #البيت !!', { title: 'تنظيف المطبخ', cat: 'h', important: true, due: null }],
  ['Fix #bug today', { title: 'Fix #bug', cat: null, due: at(0, 11) }], // an unknown #word stays in the title
  ['Wow! great', { title: 'Wow! great', important: false }], // "!" inside a word is text
];
for (const [input, want] of EXTRA) {
  n++;
  const r = parseQuickTime(input, NOW, { cats });
  if (Object.entries(want).some(([k, v]) => r[k] !== v)) fail('extra', JSON.stringify(input), '→', JSON.stringify({ ...r, spans: undefined, due: fmt(r.due) }));
}
// spans: the recognised words in the original text (what the field highlights)
const SPANS = [
  ['Call mom tomorrow at 6pm', [['tomorrow', 'date'], ['at 6pm', 'time']]],
  ['Gym every Monday at 7pm #Work !', [['every Monday', 'repeat'], ['at 7pm', 'time'], ['#Work', 'cat'], ['!', 'imp']]],
  ['remind me to stretch in 2 hours', [['remind me to', 'lead'], ['in 2 hours', 'date']]],
  ['اتصل بأحمد غدا الساعة ٨ صباحا', [['غدا', 'date'], ['الساعة ٨ صباحا', 'time']]],
];
for (const [input, want] of SPANS) {
  n++;
  const r = parseQuickTime(input, NOW, { cats });
  const got = r.spans.map(([a, b, k]) => [input.slice(a, b), k]);
  if (JSON.stringify(got) !== JSON.stringify(want)) fail('spans', JSON.stringify(input), '→', JSON.stringify(got), '| want', JSON.stringify(want));
}

// Shape: always { title: string, due: number | null }; never a due in the past.
for (const s of ['x', 'at 7', 'tonight', 'today', 'in 1 min', 'الليلة', 'الساعة 1']) {
  n++;
  const r = parseQuickTime(s, NOW);
  if (typeof r.title !== 'string' || !(r.due === null || (Number.isFinite(r.due) && r.due > NOW.getTime()))) fail('shape/past', JSON.stringify(s), JSON.stringify(r));
}
// Late in the evening "tonight" (default 8 pm) has passed: it rolls to the next full hour instead of the past.
n++;
{
  const late = new Date(2026, 9, 26, 22, 10);
  const r = parseQuickTime('Dinner tonight', late);
  if (!(r.due > late.getTime() && r.due - late.getTime() <= 2 * HR)) fail('tonight after 8pm', fmt(r.due));
}
// Default "now" is the real clock.
n++;
{
  const r = parseQuickTime('ping in 10 min');
  if (Math.abs(r.due - (Date.now() + 10 * MIN)) > 5000) fail('default now', fmt(r.due));
}

console.log(`${n - bad}/${n} parseQuickTime checks passed`);
process.exit(bad ? 1 : 0);
