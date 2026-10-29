// Plain-node tests for the Journal's pure logic: js/journal/model.js (normalizing, streaks, stats, heat-map, prompts,
// schedule, search, export) and js/journal/pin.js (PBKDF2 PIN hashing, lockout policy). usage: node .dev/journal-model.mjs
import * as M from '../js/journal/model.js';
import { hashPin, checkPin, validPin, waitAfter, ITER } from '../js/journal/pin.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else fail++;
  console.log(cond ? '  ok' : 'FAIL', msg);
};
const DAY = 864e5;
const at = (offset, h = 9) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, 0, 0, 0);
  return +d;
};

// ——— norm ———
const n0 = M.norm(null);
ok(n0.entries.length === 0 && n0.journals.length === 1 && n0.journals[0].id === 'journal', 'norm(null): empty journal with the first journal');
ok(n0.prefs.suggest === true && n0.prefs.schedule.time === '21:00', 'norm: default prefs');
const n1 = M.norm({ entries: [{ id: 'a', text: 5, mood: { level: 9 }, media: [{ id: 'journal:x' }, null] }, null, { noid: 1 }], journals: 'bad', prefs: { schedule: { days: [1, 9, -1] } } });
ok(n1.entries.length === 1 && n1.entries[0].text === '' && !n1.entries[0].mood && n1.entries[0].media.length === 1, 'norm drops broken entries, moods and media');
ok(n1.prefs.schedule.days.join() === '1' && n1.journals[0].id === 'journal', 'norm repairs schedule days and journals');

// ——— entries ———
let d = M.norm({ journals: [{ id: 'journal', name: '', color: '#7b61ff' }, { id: 'w', name: 'Work', color: '#3e7bff' }], prefs: { def: 'w' } });
const r = M.addEntry(d, { text: 'Quick thought' });
ok(r.entry.journal === 'w' && r.d.entries[0] === r.entry, 'addEntry goes to the default journal');
ok(M.journalOf(d, { journal: 'gone' }) === 'journal', 'an entry of a deleted journal shows in the first journal');
ok(M.isBlank({ text: ' ' }) && !M.isBlank({ text: '', place: 'Cairo' }) && !M.isBlank({ mood: { level: 3 } }), 'isBlank');
ok(M.normTag('  #Road trip ') === 'Road-trip' && M.addTag(['travel'], '#Travel').join() === 'Travel', 'tags: # and spaces, no duplicates');

// ——— purge, blobs ———
d = M.norm({ entries: [
  { id: 'old', text: 'x', deletedAt: Date.now() - 31 * DAY, media: [{ id: 'journal:p1', k: 'photo' }] },
  { id: 'new', text: 'y', deletedAt: Date.now() - 2 * DAY, media: [{ id: 'journal:d1', k: 'draw', vec: 'journal:v1' }] },
  { id: 'live', text: 'z' },
] });
const p = M.purge(d);
ok(p.removed.length === 1 && p.removed[0].id === 'old' && p.d.entries.length === 2, 'purge removes entries deleted over 30 days ago');
ok(M.daysLeft(M.byId(d, 'new')) === 28, 'daysLeft: 28 days for one deleted 2 days ago');
const ids = M.blobIds(p.d);
ok(ids.has('journal:d1') && ids.has('journal:v1') && !ids.has('journal:p1'), 'blobIds lists pictures and drawing strokes still used');

// ——— streak and stats ———
d = M.norm({ entries: [
  { id: '1', text: 'one two three', at: at(0), created: at(0, 21) },
  { id: '2', text: 'four five', at: at(-1), created: at(-1, 21) },
  { id: '3', text: 'six', at: at(-2), created: at(-2, 20), mood: { level: 5 }, tags: ['travel'] },
  { id: '4', text: 'seven', at: at(-5), created: at(-5, 8), mood: { level: 2 }, tags: ['Travel', 'work'] },
  { id: '5', text: 'eight', at: at(-6), created: at(-6, 8), mood: { level: 5 } },
  { id: '6', text: 'gone', at: at(-3), deletedAt: Date.now() },
] });
const st = M.streak(d);
ok(st.current === 3 && st.best === 3 && st.today, 'streak: 3 days in a row including today, best 3');
const st2 = M.streak(M.norm({ entries: d.entries.filter((e) => e.id !== '1') }));
ok(st2.current === 2 && !st2.today, 'streak runs up to yesterday when today has no entry yet');
const ys = M.yearStats(d, new Date().getFullYear());
ok(ys.entries >= 1 && ys.words >= 1, 'yearStats counts entries and words');
ok(M.words('Hello, world! مرحبا بالعالم') === 4, 'words counts English and Arabic words');
const h = M.hours(d);
ok(h[21] === 2 && M.usualTime(h) === 'evening', 'hours and usual time (evening)');
const mstat = M.moodStats(d, 30);
ok(mstat[5] === 2 && mstat[2] === 1 && mstat.total === 3, 'moodStats over 30 days');
ok(M.dayMood([{ mood: { level: 5 } }, { mood: { level: 2 } }, {}]) === 4, 'dayMood averages');
ok(M.topTags(d)[0][0] === 'travel' && M.topTags(d)[0][1] === 2, 'topTags merge case');
ok(M.onDay(d, M.dayKey(at(-3))).length === 0, 'onDay skips deleted entries');

// ——— heat-map ———
const y = new Date().getFullYear();
const weeks = M.heatWeeks(d, y, 0);
ok(weeks.length >= 53 && weeks.every((w) => w.length === 7), 'heat-map: full weeks covering the year');
const flat = weeks.flat();
ok(flat.find((x) => x.key === M.dayKey(at(0)))?.n === 1, 'heat-map counts today’s entry');
ok(flat.filter((x) => !x.out).length === (new Date(y, 1, 29).getDate() === 29 ? 366 : 365), 'heat-map: every day of the year once');
ok([0, 1, 2, 3, 5].map(M.heatLevel).join() === '0,1,2,3,4', 'heat levels');

// ——— prompts ———
ok(M.promptKey('2026-10-26') === M.promptKey('2026-10-26') && M.promptsFor('2026-10-26').join() !== M.promptsFor('2026-10-27').join(), 'prompts: stable for a day, new order tomorrow');
ok(new Set(M.promptsFor('2026-01-01')).size === M.PROMPT_COUNT && M.isPrompt('p40') && !M.isPrompt('p41'), 'prompts: a shuffle of all 40');

// ——— schedule ———
const base = new Date(2026, 9, 26, 22, 0).getTime(); // Monday 22:00
const nx = M.nextScheduleAt({ on: true, days: [1, 3], time: '21:00' }, base);
ok(new Date(nx).getDay() === 3 && new Date(nx).getHours() === 21, 'schedule: next is Wednesday 21:00 after Monday 22:00');
ok(M.nextScheduleAt({ on: false, days: [1], time: '21:00' }, base) === null && M.nextScheduleAt({ on: true, days: [], time: '21:00' }, base) === null, 'schedule off or without days: no alarm');

// ——— search and views ———
const e = { title: 'Lisbon trip', text: 'Pastel de nata', place: 'Belém', tags: ['travel'], moment: { title: 'Flight TP123' } };
ok(M.matches(e, 'lisbon nata') && M.matches(e, '#trav') && M.matches(e, 'belém') && M.matches(e, 'tp123') && !M.matches(e, 'paris'), 'matches title, text, place, tags and moment');
ok(M.inView(d, { bookmark: true }, 'bookmarked') && !M.inView(d, {}, 'bookmarked') && M.inView(d, { journal: 'journal' }, 'j:journal'), 'inView filters');
const months = M.byMonth([{ at: at(0), created: 1 }, { at: at(-40), created: 2 }]);
ok(months.length === 2 && months[0].at > months[1].at, 'byMonth: newest month first');

// ——— export ———
const doc = M.exportDoc([
  { id: 'b', at: at(0), created: 2, title: 'Second', text: '• milk\n# not a heading', tags: ['home'], mood: { level: 4 } },
  { id: 'a', at: at(-1), created: 1, text: 'First day', prompt: 'p1' },
], 'md', { title: 'My Journal', date: (ms) => M.dayKey(ms), mood: (l) => ['', 'Awful', 'Bad', 'Okay', 'Good', 'Great'][l], prompt: (k) => 'Prompt ' + k });
ok(doc.startsWith('# My Journal') && doc.indexOf('First day') < doc.indexOf('Second'), 'export Markdown: title, oldest first');
ok(doc.includes('- milk') && doc.includes('\\# not a heading') && doc.includes('*Good · #home*') && doc.includes('> Prompt p1'), 'export Markdown: lists, escapes, meta and prompt');
const txt = M.exportDoc([{ id: 'a', at: at(0), created: 1, title: 'T', text: 'Body' }], 'txt', { title: 'J', date: () => 'D' });
ok(txt.startsWith('J\n') && txt.includes('D · T\n-----') && !txt.includes('#'), 'export text');

// ——— PIN ———
ok(validPin('1234') && validPin('123456') && !validPin('123') && !validPin('1234567') && !validPin('12a4'), 'validPin: 4 to 6 digits');
const rec = await hashPin('2580', 2000);
ok(rec.alg === 'PBKDF2-SHA256' && rec.digits === 4 && rec.salt.length > 10 && rec.hash.length > 30 && !JSON.stringify(rec).includes('2580'), 'hashPin stores salt and hash, never the PIN');
ok(await checkPin('2580', rec), 'checkPin accepts the right PIN');
ok(!(await checkPin('2581', rec)) && !(await checkPin('', rec)) && !(await checkPin('2580', null)), 'checkPin rejects a wrong PIN');
const rec2 = await hashPin('2580', 2000);
ok(rec2.salt !== rec.salt && rec2.hash !== rec.hash, 'a new salt every time');
ok(ITER >= 100000, 'production iterations are at least 100k');
ok(waitAfter(4) === 0 && waitAfter(5) === 30e3 && waitAfter(10) === 60e3 && waitAfter(100) === 15 * 60e3, 'wrong-try waits');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
