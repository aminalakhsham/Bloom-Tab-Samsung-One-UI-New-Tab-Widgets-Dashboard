// Samsung Health: the pure logic of js/health/model.js (doses, cycle predictions, water, sleep, mood) and
// js/health/rings.js (Daily activity rings, awards, coaching) in plain node, plus the service worker's log keeping
// (js/bg/health.js) with a fake chrome.* and a fake clock. usage: node .dev/health-model.mjs
const M = await import('../js/health/model.js');
const R = await import('../js/health/rings.js');

const fails = [];
let passed = 0;
const ok = (cond, what) => { if (!cond) { fails.push(what); console.log('FAIL', what); } else { passed++; console.log('ok  ', what); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
// October 2026, local time; the 14th is a Wednesday
const at = (d, h, m = 0, s = 0) => +new Date(2026, 9, d, h, m, s);
const K = (d) => M.dayKey(at(d, 12));

// ------------------------------------------------------------------ dates
ok(M.dayKey(at(14, 9)) === '2026-10-14' && M.addDays('2026-10-31', 1) === '2026-11-01' && M.daysBetween('2026-10-01', '2026-10-31') === 30, 'date helpers');
ok(M.slotTime('2026-10-14T09:30') === at(14, 9, 30), 'slotTime');

// ------------------------------------------------------------------ normalising
const junk = M.norm({ meds: [{ id: 'x' }, { id: 'a', name: 'A', sched: { kind: 'weird', times: [{ t: 'bad' }] } }], water: [{ id: 'w', ml: -5, at: 1 }], body: [{ id: 'b', kind: 'shoe', value: 3, at: 1 }], cycle: { days: { nope: {}, '2026-10-01': { flow: 'light' } } } });
ok(junk.meds.length === 1 && junk.meds[0].sched.kind === 'daily' && junk.meds[0].sched.times[0].t === '09:00', 'norm: bad medications are dropped or repaired');
ok(!junk.water.length && !junk.body.length && Object.keys(junk.cycle.days).join() === '2026-10-01', 'norm: bad samples are dropped');
ok(M.norm(null).medPrefs.remind === true && M.norm('junk').meds.length === 0, 'norm tolerates junk');

// ------------------------------------------------------------------ schedules
const med = (id, sched, start = K(1), extra = {}) => M.normMed({ id, name: id, sched, start, ...extra });
const daily = med('daily', { kind: 'daily', times: [{ t: '21:00', n: 2 }, { t: '08:00', n: 1 }] });
ok(daily.sched.times.map((x) => x.t).join() === '08:00,21:00', 'times are sorted');
ok(M.scheduledOn(daily, K(14)) && !M.scheduledOn(med('later', { kind: 'daily' }, K(20)), K(14)), 'daily, and nothing before the start date');
ok(!M.scheduledOn(med('ended', { kind: 'daily' }, K(1), { end: K(10) }), K(14)), 'nothing after the end date');
const wed = med('wed', { kind: 'days', days: [3], times: [{ t: '09:00' }] });
ok(M.scheduledOn(wed, K(14)) && !M.scheduledOn(wed, K(15)), 'specific days of the week');
const every3 = med('every3', { kind: 'interval', every: 3 }, K(1));
ok(M.scheduledOn(every3, K(1)) && !M.scheduledOn(every3, K(2)) && M.scheduledOn(every3, K(4)), 'every 3 days');
const cyc = med('cyc', { kind: 'cycle', on: 2, off: 1 }, K(1));
ok(M.scheduledOn(cyc, K(1)) && M.scheduledOn(cyc, K(2)) && !M.scheduledOn(cyc, K(3)) && M.scheduledOn(cyc, K(4)), 'cycle: 2 days on, 1 off');
const prn = med('prn', { kind: 'asNeeded' });
ok(!M.scheduledOn(prn, K(14)) && prn.sched.times.length === 0, 'as needed has no times');

// ------------------------------------------------------------------ doses and the two logs
const d = M.norm({ meds: [daily, wed, prn, { ...med('old', { kind: 'daily' }), archived: true }] });
const slot9 = `${K(14)}T09:00`, slot8 = `${K(14)}T08:00`, slot21 = `${K(14)}T21:00`;
let logs = M.allLogs(d, null);
let doses = M.dayDoses(d, logs, K(14));
ok(doses.map((x) => x.t + x.med.id).join() === '08:00daily,09:00wed,21:00daily', 'dayDoses: archived medications are left out (' + doses.map((x) => x.t).join() + ')');
ok(M.slotsOf(doses).length === 3 && M.slotsOf(doses)[2].doses[0].n === 2, 'slotsOf groups by time');
d.medLog.push({ id: 'l1', med: 'daily', slot: slot8, status: 'taken', at: at(14, 8, 5) });
const sw = { log: [{ id: 's1', med: 'wed', slot: slot9, status: 'skipped', at: at(14, 9, 1) }, { id: 'l1', med: 'daily', slot: slot8, status: 'taken', at: at(14, 8, 5) }] };
logs = M.allLogs(d, sw);
ok(logs.length === 2, 'allLogs joins both logs once');
doses = M.dayDoses(d, logs, K(14));
ok(doses[0].entry?.status === 'taken' && doses[1].entry?.status === 'skipped' && !doses[2].entry, 'each dose finds its newest entry');
d.medLog.push({ id: 'l2', med: 'daily', slot: slot8, status: 'cleared', at: at(14, 8, 9) });
logs = M.allLogs(d, sw);
ok(!M.dayDoses(d, logs, K(14))[0].entry && !M.history(logs, 'daily').length, "'cleared' undoes a log and hides it from history");
ok(M.slotAction(d, logs, slot8, 'taken', at(14, 8, 30)).length === 1 && M.slotAction(d, logs, slot9, 'taken').length === 0, 'slotAction: only open doses');
ok(M.pickSlot(d, logs, 'daily', at(14, 10)) === slot8 && M.pickSlot(d, logs, 'daily', at(14, 20, 45)) === slot21 && M.pickSlot(d, logs, 'prn', at(14, 10)) === '', 'pickSlot: the nearest open dose, else as needed');
let nx = M.nextSlot(d, logs, at(14, 8, 30));
ok(nx && nx.slot === slot8 && nx.due && nx.doses.length === 1, 'nextSlot: a due dose first');
nx = M.nextSlot(d, logs, at(14, 11));
ok(nx && nx.slot === slot21 && !nx.due, 'nextSlot: after 2 hours a missed dose gives way to the next time');
const up = M.upcomingSlots(d, at(14, 0), at(15, 23, 59));
ok(up.map((x) => x.slot.slice(8)).join() === '14T08:00,14T09:00,14T21:00,15T08:00,15T21:00', 'upcomingSlots for reminders (' + up.map((x) => x.slot).join() + ')');
const adh = M.adherence(d, logs, 'daily', 1, at(14, 22));
ok(adh.total === 2 && adh.taken === 0 && adh.missed === 2 && adh.pct === 0, 'adherence counts doses whose time has come');
ok(M.dayState(d, logs, wed, K(14), at(14, 22)) === 'skipped' && M.dayState(d, logs, wed, K(15), at(14, 22)) === 'none', 'dayState');
ok(M.findMeds(M.norm({ meds: [med('Vitamin D', {}), med('Metformin', {}, K(1), { nick: 'Met' })] }), 'met')[0]?.name === 'Metformin', 'findMeds matches the display name');

// ------------------------------------------------------------------ water, sleep, body, mood, Home cards
const w = M.norm({ water: [{ id: 'a', at: at(14, 9), ml: 250 }, { id: 'b', at: at(14, 12), ml: 500 }, { id: 'c', at: at(13, 9), ml: 300 }] });
ok(M.waterOn(w, K(14)) === 750 && M.waterGoal(w, { water: 'ml' }) === 2000 && M.cupOf(w, { water: 'ml' }) === 250, 'water: day total, goal and glass');
ok(near(M.toUnit('water', 2000, { water: 'floz' }), 67.628, 0.01) && near(M.fromUnit('weight', 154.32, { weight: 'lb' }), 70, 0.01), 'units');
const sl = M.norm({ sleep: [{ id: 's', start: at(13, 23, 20), end: at(14, 7) }] });
ok(M.sleepByDay(sl)[K(14)] === 460 && M.lastSleep(sl).id === 's', 'sleep counts on the day you wake up');
const bd = M.norm({ body: [{ id: 'w', kind: 'weight', value: 70, at: at(14, 8) }, { id: 'h', kind: 'height', value: 175, at: at(1, 8) }] });
ok(M.bmiNow(bd) === 22.9, 'BMI from the latest weight and height');
ok(M.moodOf(2.6).id === 'great' && M.moodOf(-3).id === 'awful' && M.moodOf(0.2).id === 'okay' && M.moodOf(1).id === 'good', 'moodOf');
let cards = M.cardsOf({ cards: { order: ['water', 'nope', 'meds'], hidden: ['cycle'] } });
ok(cards[0].id === 'water' && cards[1].id === 'meds' && cards.length === M.CARDS.length && !cards.find((c) => c.id === 'cycle').on, 'cardsOf: order, unknown dropped, new ones appended, hidden');

// ------------------------------------------------------------------ cycle tracking
const days = {};
const flow = (from, n) => { for (let i = 0; i < n; i++) days[M.addDays(from, i)] = { flow: 'medium' }; };
flow('2026-08-03', 4); flow('2026-08-31', 4); flow('2026-09-28', 4);
const cycle = { days, predPeriod: true, predFertile: true };
const st = M.cycleStats(days);
ok(st.cycleLen === 28 && st.periodLen === 4 && st.periods.length === 3, `average cycle ${st.cycleLen}, period ${st.periodLen}`);
const pred = M.predict(cycle, K(14));
ok(pred.next[0].start === '2026-10-26' && pred.next[0].end === '2026-10-29', 'next period 28 days after the last (' + pred.next[0].start + ')');
ok(pred.next[0].ovulation === '2026-10-12' && pred.next[0].fertileStart === '2026-10-07' && pred.next[0].fertileEnd === '2026-10-13', 'fertile window 14 days before');
ok(M.cycleDayKind(cycle, pred, '2026-09-29', K(14)) === 'period' && M.cycleDayKind(cycle, pred, '2026-10-27', K(14)) === 'predicted', 'calendar: logged and predicted days');
ok(M.cycleDayKind(cycle, pred, '2026-10-12', K(14)) === 'ovulation' && M.cycleDayKind(cycle, pred, '2026-10-09', K(14)) === 'fertile', 'calendar: ovulation and fertile days');
ok(M.cycleDay(cycle, K(14)) === 17, 'cycle day 17');
let cs = M.cycleStatus(cycle, K(14));
ok(cs.kind === 'next' && cs.n === 12, 'status: period expected in 12 days (' + JSON.stringify(cs) + ')');
cs = M.cycleStatus(cycle, '2026-10-29');
ok(cs.kind === 'late' && cs.n === 3, 'status: 3 days late (' + JSON.stringify(cs) + ')');
cs = M.cycleStatus(cycle, '2026-09-30');
ok(cs.kind === 'period' && cs.n === 3, 'status: period day 3');
ok(M.periods({ a: 1, '2026-10-01': { flow: 'light' }, '2026-10-03': { flow: 'light' } }).length === 1, 'a one-day gap does not end a period');

// ------------------------------------------------------------------ Daily activity rings
ok(R.splitHours(at(14, 23, 40), at(15, 0, 20)).map((x) => x.day + ':' + Math.round(x.min)).join() === '2026-10-14:20,2026-10-15:20', 'splitHours at midnight');
const focusLog = [{ start: at(14, 9, 0), end: at(14, 9, 25) }, { start: at(14, 10, 50), end: at(14, 11, 15) }, { start: at(13, 23, 50), end: at(14, 0, 10) }];
const fd = R.focusDays(focusLog);
ok(near(fd[K(14)].min, 60) && fd[K(14)].sessions === 3 && near(fd[K(13)].min, 10) && near(fd[K(14)].h[10], 10), 'focusDays: minutes by hour across midnight, sessions on the day they end');
const live = { startedAt: at(14, 15, 55), endsAt: at(14, 16, 20), minutes: 25 };
const rem = [
  { id: 'a', done: true, completedAt: at(14, 9, 5) }, { id: 'b', done: true, completedAt: at(14, 15) },
  { id: 'c', done: true, completedAt: at(13, 10) }, { id: 'd', done: false }, { id: 'e', done: true },
];
ok(R.doneCount(rem, K(14)) === 2 && R.doneCount({ items: rem }, K(13)) === 1, 'Tasks counts reminders completed that day (array or { items })');
const act = { v: 1, days: { [K(14)]: { breakH: [9, 10, 11], activeH: Array(24).fill(0) }, [K(12)]: { done: 4, focus: 70, sessions: 2 } } };
const S = (now, extra = {}) => ({ act, reminders: rem, focusLog, focus: live, now, ...extra });
let r = R.ringsFor(K(14), S(at(14, 16, 5)));
ok(near(r.focus.v, 70) && r.focus.goal === 60 && r.done.v === 2 && r.breaks.v === 3 && near(r.breaks.p, 3 / 8), 'rings: 60 logged + 10 live Focus, 2 tasks, 3 break hours: ' + JSON.stringify(r));
ok(near(R.ringsFor(K(14), S(at(14, 16, 5), { focusLog: [...focusLog, { start: live.startedAt, end: at(14, 16, 5) }] })).focus.v, 70), 'a session already logged is not counted twice');
r = R.ringsFor(K(12), S(at(14, 12)));
ok(r.done.v === 4 && r.focus.v === 70, 'a past day keeps its snapshots when reminders or old sessions are gone');
const det = R.dayDetail(K(14), S(at(14, 16, 5)));
ok(near(det.focusH[15], 5) && near(det.focusH[16], 5) && det.doneH[9] === 1 && det.sessions === 3, 'dayDetail adds the live session to the hourly chart');
let prefs = R.withGoals(undefined, { focus: 90 }, K(14));
ok(R.goalsFor(prefs, K(14)).focus === 90 && R.goalsFor(prefs, K(13)).focus === 60, 'a goal change applies from today; past days keep theirs');
prefs = R.withGoals({ cards: { hidden: ['cycle'] }, ...prefs }, { focus: 1000, done: 0 }, K(14));
ok(R.goalsFor(prefs, K(14)).focus === 480 && R.goalsFor(prefs, K(14)).done === 1 && prefs.goalHist.filter((h) => h.from === K(14)).length === 1 && prefs.cards.hidden[0] === 'cycle', 'goals are clamped, one change a day is kept, other prefs survive');
ok(R.normPrefs({ notify: { coach: false, at: 99 } }).notify.at === 22 && R.normPrefs('junk').goals.breaks === 8, 'prefs tolerate junk');

// breaks
let bh = R.breakHours(at(14, 9, 49), at(14, 9, 55));
ok(bh.length === 1 && new Date(bh[0]).getHours() === 9, 'a 6-minute break earns its hour');
ok(R.breakHours(at(14, 9, 49), at(14, 9, 50, 30)).length === 0, 'a 90-second pause is not a break');
ok(R.breakHours(at(14, 11, 58), at(14, 12, 3)).map((t) => new Date(t).getHours()).join() === '11,12', 'a break across the hour earns both hours with 2+ minutes in each');
ok(R.breakHours(at(14, 23, 0), at(15, 8, 5)).map((t) => new Date(t).getHours()).join() === '23', 'a night away only earns the hour you left in');
const log = R.normLog(null);
R.addBreak(log, at(14, 12, 10), at(14, 13, 20));
R.addActive(log, at(14, 12, 30), 5);
ok(R.dayOf(log, K(14)).breakH.join() === '12,13' && R.dayOf(log, K(14)).activeH[12] === 5, 'addBreak and addActive');

// awards over a perfect week
const perfect = { v: 1, days: {} };
const pLog = [], pRem = [];
for (let i = 5; i <= 11; i++) { // Mon 5 … Sun 11 October
  perfect.days[K(i)] = { breakH: [9, 10, 11, 12, 13, 14, 15, 16], activeH: Array(24).fill(0) };
  pLog.push({ start: at(i, 9), end: at(i, 10, 5) });
  for (let j = 0; j < 5; j++) pRem.push({ id: i + '-' + j, done: true, completedAt: at(i, 14, j) });
}
const PS = { act: perfect, reminders: pRem, focusLog: pLog, now: at(12, 9) };
const aw = R.computeAwards(PS, { weekStart: 1 });
ok(aw.earned['perfect-day']?.length === 7 && aw.earned['perfect-week']?.[0] === K(11) && aw.earned['perfect-week-done'], 'Perfect day ×7 and Perfect week');
ok(aw.earned['sessions-1']?.[0] === K(5) && aw.earned['first-breaks']?.[0] === K(5) && aw.stats.sessions === 7, 'first session and first Breaks goal');
ok(R.streakOf(R.series(PS, K(5), K(12)), K(12)) === 7, 'streak of 7 perfect days (today still open)');
const merged = R.mergeEarned({ 'first-breaks': [K(1)] }, aw.earned);
ok(merged['first-breaks'].join() === K(1) && R.newAwards({ 'perfect-day': [K(5)] }, { 'perfect-day': [K(5), K(6)] }).length === 1, 'mergeEarned keeps the first day of a one-time award; newAwards');
const c = R.coach({ focus: { v: 45, goal: 60, p: 0.75 }, done: { v: 1, goal: 5, p: 0.2 }, breaks: { v: 8, goal: 8, p: 1 } }, at(14, 18));
ok(c && c.ring === 'focus' && c.need === 15 && c.close, 'coaching: Focus is closest (15 min to go)');
ok(R.coach({ focus: { v: 60, goal: 60, p: 1 }, done: { v: 5, goal: 5, p: 1 }, breaks: { v: 2, goal: 8, p: 0.25 } }, at(14, 22)) === null, 'coaching: nothing that can still close');
const tr = R.trends({ ...PS, now: at(30, 9) });
ok(tr.enough === false, 'trends need four weeks');
ok(R.weekStartOf('en-US') === 0 && R.weekStartOf('en-GB') === 1, 'week start by region');

// ------------------------------------------------------------------ the service worker, with a fake chrome
const mem = { local: {}, session: {} };
const alarms = new Map(), notes = new Map(), listeners = { alarm: [], changed: [], idle: [], button: [], msg: [] };
let NOW = at(14, 7, 0);
const realNow = Date.now;
Date.now = () => NOW;
const area = (name) => ({
  async get(keys) { const ks = keys == null ? Object.keys(mem[name]) : [].concat(keys); return Object.fromEntries(ks.filter((k) => k in mem[name]).map((k) => [k, structuredClone(mem[name][k])])); },
  async set(o) {
    const changes = {};
    for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: mem[name][k], newValue: v }; mem[name][k] = structuredClone(v); }
    if (name === 'local') for (const fn of listeners.changed) fn(changes, 'local');
  },
  async remove() {},
});
globalThis.chrome = {
  storage: { local: area('local'), session: area('session'), onChanged: { addListener: (fn) => listeners.changed.push(fn) } },
  alarms: {
    create: (name, o) => alarms.set(name, { name, scheduledTime: o.when ?? NOW + (o.periodInMinutes || 1) * 60000, periodInMinutes: o.periodInMinutes }),
    get: async (name) => alarms.get(name), getAll: async () => [...alarms.values()], clear: async (name) => alarms.delete(name),
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  idle: { setDetectionInterval() {}, queryState: async () => idleState, onStateChanged: { addListener: (fn) => listeners.idle.push(fn) } },
  notifications: {
    create: (id, o) => notes.set(id, o), clear: async (id) => notes.delete(id), getAll: async () => Object.fromEntries([...notes.keys()].map((k) => [k, true])),
    onButtonClicked: { addListener: (fn) => listeners.button.push(fn) }, onClicked: { addListener() {} },
  },
  runtime: { onMessage: { addListener: (fn) => listeners.msg.push(fn) }, getURL: (p) => p },
  i18n: { getUILanguage: () => 'en-US', getMessage: () => '' },
  tabs: { create() {} },
};
let idleState = 'active';
const hub = await import('../js/bg/hub.js');
const BG = await import('../js/bg/health.js');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); await BG.idleQueue(); };
const fire = async (rest) => { await hub.alarmHandlers.get('health')(rest, { name: 'health:' + rest }); await settle(); };
await settle();
ok(alarms.has('health:tick') && alarms.has('health:coach') && alarms.has('health:plan'), 'the worker sets its tick, coaching and planning alarms');

// medication reminders
mem.local.health = { meds: [{ ...daily, start: K(1) }] };
await BG.plan(NOW);
ok(alarms.has(`health:med:${K(14)}T08:00`) && alarms.has(`health:medf:${K(14)}T08:00`) && alarms.has(`health:med:${K(15)}T21:00`), 'reminder and follow-up alarms for the next two days');
NOW = at(14, 8, 0, 5);
await fire(`med:${K(14)}T08:00`);
const n8 = notes.get(`health:med:${K(14)}T08:00`);
ok(n8 && /daily/.test(n8.message) && n8.buttons?.length === 2, 'the reminder names the medication and has Taken / Skip');
const inPage = (mem.local.notifications || [])[0];
ok(inPage && inPage.app === 'health' && !/daily/.test(inPage.title + inPage.body), 'the in-page notification (Lock screen) carries no medication name');
await hub.buttonHandlers.get('health')(`med:${K(14)}T08:00`, 0);
await settle();
ok(mem.local.healthSW?.log?.length === 1 && mem.local.healthSW.log[0].status === 'taken' && !mem.local.health.medLog, '"Taken" writes healthSW only');
ok(!alarms.has(`health:medf:${K(14)}T08:00`), 'and cancels the follow-up');
NOW = at(14, 8, 30, 5);
notes.clear();
await fire(`medf:${K(14)}T08:00`);
ok(!notes.size, 'no follow-up for a dose already taken');
mem.local.health = { ...mem.local.health, medPrefs: { remind: false } };
await BG.plan(NOW);
ok(![...alarms.keys()].some((k) => k.startsWith('health:med')), 'turning reminders off removes the alarms');

// breaks, rings closing and notifications
mem.local.healthPrefs = { goals: { focus: 15, done: 1, breaks: 1 } };
NOW = at(14, 10, 0);
await fire('tick');
idleState = 'idle';
NOW = at(14, 10, 1);
for (const fn of listeners.idle) fn('idle');
await settle();
NOW = at(14, 10, 9);
idleState = 'active';
for (const fn of listeners.idle) fn('active');
await settle();
ok(mem.local.healthAct?.days?.[K(14)]?.breakH?.join() === '10', 'an 8-minute break from chrome.idle earns the 10:00 hour (' + JSON.stringify(mem.local.healthAct?.days?.[K(14)]) + ')');
ok(notes.has(`health:ring:breaks:${K(14)}`), 'closing the Breaks ring is announced');
await area('local').set({ reminders: [{ id: 'r', done: true, completedAt: at(14, 10, 10) }] });
await settle();
ok(mem.local.healthAct.days[K(14)].done === 1 && notes.has(`health:ring:done:${K(14)}`), 'completing a reminder snapshots Tasks and announces the ring');
NOW = at(14, 10, 40);
await area('local').set({ focusLog: [{ start: at(14, 10, 15), end: at(14, 10, 40) }] });
await settle();
const day14 = mem.local.healthAct.days[K(14)];
ok(near(day14.focus, 25) && day14.sessions === 1 && notes.has(`health:ring:all:${K(14)}`), 'a Focus session snapshots minutes and a closed day says Perfect day (' + JSON.stringify(day14) + ')');
ok(day14.told.join() === 'breaks,done,focus,all', 'each ring is announced once');
ok(mem.local.healthAct.earned?.['perfect-day']?.[0] === K(14) && mem.local.healthAct.earned?.['sessions-1'], 'awards are recorded');
const before = notes.size;
await area('local').set({ reminders: [{ id: 'r', done: true, completedAt: at(14, 10, 10) }, { id: 's', done: true, completedAt: at(14, 10, 41) }] });
await settle();
ok(notes.size === before, 'no second announcement');

// coaching
mem.local.healthPrefs = { goals: { focus: 60, done: 5, breaks: 8 } };
NOW = at(14, 18, 0, 5);
notes.clear();
await fire('coach');
const coachNote = [...notes.entries()].find(([k]) => k.startsWith('health:coach:'));
ok(coachNote && /Focus/.test(coachNote[1].message) && coachNote[1].buttons?.[0], 'evening coaching suggests a Focus session (' + coachNote?.[1].message + ')');
await hub.buttonHandlers.get('health')(`coach:${K(14)}`, 0);
await settle();
ok(mem.local.focus?.startedAt === NOW && alarms.has('focus'), '"Start Focus" starts a session with its alarm');

Date.now = realNow;
console.log(`\n${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
