// Samsung Wallet's pure logic in plain Node (no browser): expenses typed in one line, billing dates and alerts,
// totals, expiry of passes, normalising stored data (including Liquid Tab's pass styles), CSV.
//   node .dev/wallet-model.mjs
import * as M from '../js/wallet/model.js';

let fails = 0, oks = 0;
const ok = (c, what) => { if (c) { oks++; console.log('ok  ', what); } else { fails++; console.log('FAIL', what); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = new Date(2026, 9, 26, 12, 0).getTime();
const P = (text, o = {}) => { const r = M.parseExpense(text, { currency: 'USD', now: NOW, ...o }); return r && [r.amount, r.currency, r.merchant, r.category]; };

// ================================================================ "coffee 3.5$"
ok(eq(P('coffee 3.5$'), [3.5, 'USD', 'Coffee', 'food']), 'coffee 3.5$');
ok(eq(P('12 € lunch'), [12, 'EUR', 'Lunch', 'food']), '12 € lunch');
ok(eq(P('spent 30 on uber'), [30, 'USD', 'Uber', 'transport']), 'spent 30 on uber (default currency)');
ok(eq(P('قهوة ٣٫٥ ريال'), [3.5, 'SAR', 'قهوة', 'food']), 'Arabic digits, decimal sign and riyal');
ok(eq(P('1.234,50 € hotel'), [1234.5, 'EUR', 'Hotel', 'travel']), 'European thousands and decimals');
ok(eq(P('1,500 dinner', { decimal: '.' }), [1500, 'USD', 'Dinner', 'food']), '"1,500" is a thousand and a half');
ok(eq(P('5$ taxi', { currency: 'CAD' }), [5, 'CAD', 'Taxi', 'transport']), '"$" is the local dollar in Canada');
ok(M.parseExpense('yesterday 9 pharmacy', { now: NOW }).at === NOW - 864e5, '"yesterday" moves it a day back');
ok(P('lunch') === null && P('') === null && P('0 $') === null, 'no amount, no expense');
const E = (s) => M.expenseIn(s, { currency: 'USD' });
ok(E('coffee 3.5$') && E('spent 20 on taxi') && E('paid 12 lunch'), 'Finder: a currency or a spending word makes an expense');
ok(!E('12') && !E('lunch 12.50') && !E('2+3*4') && !E('100 usd to eur') && !E('weather'), 'Finder: numbers, sums, conversions and words alone are not expenses');
ok(M.guessCategory('Netflix') === 'entertainment' && M.guessCategory('الصيدلية') === 'health' && M.guessCategory('xyz') === 'other', 'categories from merchant words ("ال" ignored)');

// ================================================================ billing dates and alerts
const sub = (o) => M.normSub({ id: 's', name: 'X', amount: 10, cur: 'USD', cycle: 'm', start: '2026-01-31', cat: 'streaming', alert: 1, ...o });
ok(eq(M.billDates(sub(), '2026-02-01', '2026-05-31'), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']), 'a bill on the 31st stays on the last day of short months');
ok(eq(M.billDates(sub({ cycle: 'w', start: '2026-10-01' }), '2026-10-01', '2026-10-22'), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']), 'weekly');
ok(eq(M.billDates(sub({ cycle: 'd', every: 10, start: '2026-10-01' }), '2026-10-05', '2026-10-31'), ['2026-10-11', '2026-10-21', '2026-10-31']), 'every 10 days');
ok(eq(M.billDates(sub({ cycle: 'y', start: '2024-02-29' }), '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']), 'yearly from Feb 29');
ok(M.nextBill(sub({ start: '2026-10-28' }), '2026-10-26') === '2026-10-28' && M.nextBill(sub({ state: 'paused' }), '2026-10-26') === '', 'next bill; none while paused');
ok(eq(M.billDates(sub({ state: 'cancelled', until: '2026-11-30', start: '2026-10-30' }), '2026-10-01', '2027-03-01'), ['2026-10-30', '2026-11-30']), 'a cancelled subscription bills until its last day');
const al = M.alertsFor(sub({ start: '2026-10-28', onDay: true }), '09:00', NOW);
ok(al.length >= 2 && al[0].date === '2026-10-28' && al[0].before === 1 && new Date(al[0].at).getHours() === 9 && al[1].before === 0, 'alerts a day before and on the day, at the alert time');
ok(M.alertsFor(sub({ alert: -1 }), '09:00', NOW).length === 0, 'no alerts when turned off');
const tr = M.alertsFor(sub({ start: '2026-10-30', trial: '2026-10-30', alert: 2 }), '09:00', NOW)[0];
ok(tr.trial && tr.date === '2026-10-30', 'the end of a free trial is flagged');
const t = M.totals([sub({ amount: 12, cycle: 'y' }), sub({ amount: 5, cycle: 'm', cur: 'EUR' }), sub({ amount: 99, state: 'paused' })]);
ok(Math.abs(t.month.USD - 1) < 1e-9 && t.month.EUR === 5 && Math.abs(t.year.EUR - 60) < 1e-9, 'totals per month and year, per currency, without paused ones');
const up = M.upcoming([sub({ start: '2026-10-27' }), sub({ id: 'b', name: 'Power', cat: 'utilities', start: '2026-10-26' })], 30, '2026-10-26');
ok(up.length === 2 && up[0].name === 'Power' && up[0].bill && up[0].days === 0 && up[1].days === 1, 'upcoming bills soonest first; utilities are bills');

// ================================================================ passes
const pass = (o) => M.normPass({ id: 'p', kind: 'ticket', name: 'T', ...o });
ok(M.isExpired(pass({ date: '2026-10-25T20:00' }), '2026-10-26') && !M.isExpired(pass({ date: '2026-10-26T20:00' }), '2026-10-26'), 'a ticket expires the day after its event');
ok(!M.isExpired(pass({ date: '2026-10-20', keep: true }), '2026-10-26'), 'a restored pass stays');
ok(M.isExpired(pass({ kind: 'coupon', expires: '2026-10-25' }), '2026-10-26') && !M.isExpired(pass({ kind: 'member', date: '2020-01-01' }), '2026-10-26'), 'expiry dates; membership cards ignore dates');
const legacy = M.normPass({ style: 'boarding', primary: [{ l: '', v: '' }, { l: 'Tokyo', v: 'NRT' }], strip: 'wallet-abc', bg: '#123456' });
ok(legacy.kind === 'boarding' && legacy.primary[1].v === 'NRT' && legacy.primary.length === 2 && legacy.art === 'wallet-abc' && legacy.transit === 'air', 'Liquid Tab passes keep their meaning (style → kind, strip → art)');
ok(M.normPass({ style: 'store' }).kind === 'member' && M.normPass({ style: 'generic' }).kind === 'other' && M.normPass({ kind: 'nope' }).kind === 'other', 'unknown kinds become Other passes');
ok(M.normPass({ kind: 'gift', code: { type: 'bogus', msg: 'x' } }).code.type === '' && M.normPass({ logo: 'https://evil/x.png' }).logo === undefined, 'bad barcode types and picture ids are dropped');
ok(M.passTitle(legacy) === 'NRT', 'a route with an empty origin shows the destination');
ok(M.passTitle(pass({ kind: 'boarding', primary: [{ l: 'Paris', v: 'CDG' }, { l: 'Dubai', v: 'DXB' }] })) === 'CDG → DXB', 'a boarding pass is titled by its route');
const soon = M.upcomingPasses([pass({ id: 'a', date: '2026-10-26T18:00' }), pass({ id: 'b', date: '2026-10-26T08:00' }), pass({ id: 'c', date: '2026-10-20', keep: true }), pass({ id: 'd', kind: 'member', date: '2026-10-27' })], 2, new Date(NOW));
ok(eq(soon.map((p) => p.id), ['a']), 'coming up: later today only, not past, restored or undated kinds');
ok(eq(M.searchPasses([pass({ id: 'x', name: 'Hilton', primary: [{ l: 'Room', v: '1204' }], code: { type: 'qr', msg: 'SECRET' } })], '1204').map((p) => p.id), ['x']) && M.searchPasses([pass({ code: { type: 'qr', msg: 'SECRET' } })], 'secret').length === 0, 'search reads the fields, never the barcode');

// ================================================================ spending
const d = M.norm({ spend: [{ amt: 3.456, cur: 'usd', mer: 'x', cat: 'nope', at: NOW }], budgets: { food: '50', bogus: 9, travel: -1 }, prefs: { cur: 'EUR', alertTime: '7:00' } });
ok(d.spend[0].amt === 3.46 && d.spend[0].cur === 'USD' && d.spend[0].cat === 'other' && eq(d.budgets, { food: 50 }) && d.prefs.cur === 'EUR' && d.prefs.alertTime === '09:00', 'stored data is normalised');
const week = M.weekOf(new Date(NOW), 1);
ok(week.getDay() === 1 && week <= new Date(NOW), 'a week from Monday');
const b = M.bars([{ amt: 5, cur: 'USD', cat: 'food', at: NOW }, { amt: 7, cur: 'EUR', cat: 'food', at: NOW }], 'month', M.periodStart('month', new Date(NOW)), 'USD');
ok(b.length === 31 && b[25].total === 5 && b[25].cats.food === 5, 'month bars, one currency at a time');
const csv = M.toCSV([{ amt: 2, cur: 'USD', mer: 'Café, "Le"', cat: 'food', at: NOW }, { amt: 1, cur: 'USD', mer: '=HYPERLINK()', cat: 'food', at: NOW - 1 }]);
ok(csv.startsWith('﻿Date,') && csv.includes('"Café, ""Le"""') && csv.includes(`"'=HYPERLINK()"`) && csv.indexOf('HYPERLINK') < csv.indexOf('Café'), 'CSV: quoting, formula cells neutralised, oldest first');

console.log(`\n${oks} ok, ${fails} failed`);
console.log(fails ? 'FAIL' : 'PASS');
process.exitCode = fails ? 1 : 0;
