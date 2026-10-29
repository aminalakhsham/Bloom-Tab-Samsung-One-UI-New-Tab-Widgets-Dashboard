// Plain-node checks of the Reminder model (js/reminder/model.js), shared by the pages and the service worker: repeat
// steps (daily, weekdays, every 2 weeks on days, month ends, leap years, end dates), completing a repeating reminder
// (next occurrence + completed copy, subtasks), the alarm plan (due, overdue repeating, early alert, snooze), what the
// service worker does when an alarm rings, views and order, and the Arabic/English aisle matcher.
// usage: node .dev/reminder-model.mjs   (exits 1 on failure)
import * as M from '../js/reminder/model.js';
import { aisleOf } from '../js/reminder/grocery.js';

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log('FAIL', msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const d = (y, mo, day, hh = 9, mm = 0) => new Date(y, mo - 1, day, hh, mm).getTime();
const fmt = (ms) => (ms == null ? 'null' : new Date(ms).toString().slice(0, 21));

// ——— step / nextAfter ———
ok(M.step(d(2026, 10, 26), { f: 'd' }) === d(2026, 10, 27), 'daily');
ok(M.step(d(2026, 10, 26), { f: 'd', n: 3 }) === d(2026, 10, 29), 'every 3 days');
ok(M.step(d(2026, 10, 30), { f: 'w', days: [1, 2, 3, 4, 5] }) === d(2026, 11, 2), 'weekdays: Friday → Monday');
ok(M.step(d(2026, 10, 26), { f: 'w' }) === d(2026, 11, 2), 'weekly');
ok(M.step(d(2026, 10, 26), { f: 'w', n: 2, days: [1, 4] }) === d(2026, 10, 29), 'every 2 weeks on Mon/Thu: Monday → Thursday the same week');
ok(M.step(d(2026, 10, 29), { f: 'w', n: 2, days: [1, 4] }) === d(2026, 11, 9), '… then Monday two weeks later');
ok(M.step(d(2026, 1, 31), { f: 'm', dom: 31 }) === d(2026, 2, 28), 'monthly on the 31st: February has 28 days');
ok(M.step(d(2026, 2, 28), { f: 'm', dom: 31 }) === d(2026, 3, 31), '… and March is back to the 31st');
ok(M.step(d(2028, 2, 29), { f: 'y', dom: 29 }) === d(2029, 2, 28), 'yearly on Feb 29 in a common year');
ok(M.step(d(2026, 10, 26, 18, 30), { f: 'd' }) === d(2026, 10, 27, 18, 30), 'keeps the time of day');
const daily = { due: d(2026, 10, 20, 8), repeat: { f: 'd' } };
ok(M.nextAfter(daily, d(2026, 10, 26, 10)) === d(2026, 10, 27, 8), 'nextAfter skips the missed days');
ok(M.nextAfter({ ...daily, repeat: { f: 'd', end: d(2026, 10, 26, 0) } }, d(2026, 10, 26, 10)) === null, 'an ended repeat has no next occurrence');
ok(M.nextAfter({ ...daily, repeat: { f: 'd', end: d(2026, 10, 27, 0) } }, d(2026, 10, 26, 10)) === d(2026, 10, 27, 8), 'the end date itself still counts');
ok(M.latestAtOrBefore(daily, d(2026, 10, 26, 10)) === d(2026, 10, 26, 8), 'latestAtOrBefore: today’s occurrence');
ok(same(M.normRepeat({ f: 'm', n: 1 }, d(2026, 1, 31)), { f: 'm', dom: 31 }) && M.normRepeat({ f: 'x' }) === null && same(M.normRepeat({ f: 'w', days: [4, 1, 1, 9] }), { f: 'w', days: [1, 4] }), 'normRepeat');

// ——— alarm plan ———
const NOW = d(2026, 10, 26, 10);
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 26, 18), done: false }, NOW), [['reminder:a', d(2026, 10, 26, 18)]]), 'plan: the due time');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 26, 18), early: 30, done: false }, NOW), [['reminder:a', d(2026, 10, 26, 18)], ['reminder:a~e', d(2026, 10, 26, 17, 30)]]), 'plan: early alert 30 minutes before');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 26, 10, 10), early: 30, done: false }, NOW), [['reminder:a', d(2026, 10, 26, 10, 10)]]), 'plan: an early alert already past is skipped');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 25, 18), done: false }, NOW), []), 'plan: an overdue one-off reminder has none');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 25, 8), repeat: { f: 'd' }, done: false }, NOW), [['reminder:a', d(2026, 10, 27, 8)]]), 'plan: an overdue repeating reminder rings at its next occurrence');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 26, 18), done: true }, NOW), []) && same(M.alarmPlan({ id: 'a', due: null }, NOW), []), 'plan: done or undated → none');
ok(same(M.alarmPlan({ id: 'a', due: d(2026, 10, 25, 8), repeat: { f: 'd' }, snooze: d(2026, 10, 26, 10, 10), done: false }, NOW), [['reminder:a', d(2026, 10, 26, 10, 10)]]), 'plan: a snoozed repeating reminder rings at the snooze');

// ——— complete ———
const list = [
  { id: 'p', title: 'Pills', due: d(2026, 10, 25, 8), repeat: { f: 'd' }, early: 5, done: false, created: 1, subs: [{ id: 's', title: 'x', done: true }] },
  { id: 'q', title: 'Once', due: d(2026, 10, 27, 8), done: false, created: 2, subs: [{ id: 't', title: 'y', done: false }] },
];
const c1 = M.complete(list, 'p', NOW);
const p1 = c1.find((r) => r.id === 'p'), copy = c1.find((r) => r.from === 'p');
ok(c1 !== list && list[0].due === d(2026, 10, 25, 8), 'complete returns a new list, the old one untouched');
ok(!p1.done && p1.due === d(2026, 10, 27, 8) && p1.subs[0].done === false, 'repeating: moves past today to its next occurrence, subtasks unticked');
ok(copy && copy.done && copy.completedAt === NOW && !copy.repeat && !copy.early && copy.title === 'Pills' && c1.indexOf(copy) === 1, 'repeating: a completed copy right after it');
ok(c1[2] === list[1], 'other items are the same objects');
const c2 = M.complete(list, 'q', NOW);
ok(c2[1].done && c2[1].completedAt === NOW && c2[1].subs[0].done, 'one-off: done, completedAt, subtasks ticked');
ok(M.complete(c2, 'q', NOW) === c2, 'completing a completed reminder changes nothing');
ok(!M.uncomplete(c2, 'q')[1].done && M.uncomplete(c2, 'q')[1].completedAt === null, 'uncomplete');
const ended = [{ id: 'e', due: d(2026, 10, 26, 8), repeat: { f: 'd', end: d(2026, 10, 26) }, done: false }];
ok(M.complete(ended, 'e', NOW)[0].done && M.complete(ended, 'e', NOW).length === 1, 'the last occurrence of an ended repeat completes for good');

// a repeating reminder another writer marked done (the side panel) is rolled on by the service worker
const rd = M.rollDone([{ id: 'p', due: d(2026, 10, 26, 8), repeat: { f: 'd' }, done: true, completedAt: NOW, created: 1 }]);
ok(rd.length === 2 && !rd[0].done && rd[0].completedAt === null && rd[0].due === d(2026, 10, 27, 8) && rd[1].from === 'p' && rd[1].done && rd[1].completedAt === NOW, 'rollDone: back to open at the next occurrence, plus the completed copy');
ok(M.rollDone(list) === list && M.rollDone(c1) === c1 && M.rollDone(ended) === ended, 'rollDone: nothing to do → the same list');

// ——— the service worker when an alarm rings ———
ok(M.rang({ id: 'a', due: d(2026, 10, 26, 10), done: false }, NOW) === null, 'rang: a one-off reminder is left as it is');
ok(M.rang({ id: 'a', due: d(2026, 10, 20, 8), repeat: { f: 'd' }, done: false }, d(2026, 10, 26, 8))?.due === d(2026, 10, 26, 8), 'rang: missed occurrences are skipped (due moves to the one ringing)');
ok(!('snooze' in (M.rang({ id: 'a', due: d(2026, 10, 26, 8), repeat: { f: 'd' }, snooze: NOW, done: false }, NOW) || { snooze: 1 })), 'rang: the snooze that rang is cleared');

// ——— patches, views, order ———
const pt = M.patchIn([{ id: 'a', due: 5, snooze: 9, cat: 'x', early: 15 }], 'a', { due: 6, cat: 'rem', early: 0, repeat: { f: 'd' } })[0];
ok(pt.due === 6 && !('snooze' in pt) && !('cat' in pt) && !('early' in pt) && same(pt.repeat, { f: 'd' }), 'patchIn: a new due drops the snooze; default category, no early alert are not stored');
const made = M.make({ title: 'x', cat: 'rem' });
ok(made.id && made.title === 'x' && made.due === null && made.done === false && !('cat' in made) && !('repeat' in made), 'make fills the fields');
const cats = M.normCats({ list: [{ id: 'w', name: 'Work' }] });
ok(cats.list[0].id === 'rem' && cats.list[1].id === 'w', 'normCats adds the default category first');
ok(M.catIdOf(cats, { cat: 'gone' }) === 'rem', 'a reminder of a deleted category shows in the default one');
const items = [{ id: '1', due: d(2026, 10, 25), done: false }, { id: '2', due: d(2026, 10, 26, 22), done: false }, { id: '3', due: d(2026, 10, 27), done: false }, { id: '4', due: null, done: false, cat: 'w' }, { id: '5', done: true }];
ok(same(['today', 'scheduled', 'all', 'completed', 'w', 'rem'].map((v) => M.count(cats, items, v, NOW)), [2, 3, 4, 1, 1, 3]), 'counts per view and category');
ok(same(M.sortBy([{ id: 'a', created: 1 }, { id: 'b', created: 2 }, { id: 'c', created: 3, order: -10 }], 'manual').map((r) => r.id), ['c', 'b', 'a']), 'custom order: order, else newest first');
ok(M.between(1, 2) === 1.5 && M.between(null, 2) === 1 && M.between(4, null) === 5, 'between');

// ——— aisles ———
const AISLE = [['2 avocados', 'produce'], ['Peanut butter', 'pantry'], ['milk', 'dairy'], ['Bread', 'bakery'], ['dish soap', 'household'], ['طماطم', 'produce'], ['حليب', 'dairy'], ['خبز', 'bakery'], ['دجاج', 'meat'], ['Call mom', '']];
for (const [x, want] of AISLE) ok(aisleOf(x) === want, `aisle of ${x}: ${aisleOf(x)} want ${want}`);

console.log(`${n - bad}/${n} reminder model checks passed`);
process.exit(bad ? 1 : 0);
