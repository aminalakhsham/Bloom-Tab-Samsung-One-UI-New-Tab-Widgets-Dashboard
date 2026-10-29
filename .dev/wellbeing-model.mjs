// Digital Wellbeing: the pure logic of js/wellbeing/model.js and categories.js in plain node (recording split at hours
// and midnight, day/week periods and their change, site timers with per-day minutes, Bedtime windows and toggling,
// Focus modes and the verdict that pauses a site). usage: node .dev/wellbeing-model.mjs   (exit 1 on failure)
const M = await import('../js/wellbeing/model.js');
const C = await import('../js/wellbeing/categories.js');

const fails = [];
let passed = 0;
const ok = (cond, what) => { if (!cond) { fails.push(what); console.log('FAIL', what); } else { passed++; console.log('ok  ', what); } };
// October 2026, local time; the 26th is a Monday
const at = (d, h, m = 0, s = 0) => +new Date(2026, 9, d, h, m, s);
const catOf = (s) => C.categoryOf(s, {});

// ------------------------------------------------------------------ sites and categories
ok(C.siteOf('m.youtube.com') === 'youtube.com' && C.siteOf('mail.google.com') === 'mail.google.com' && C.siteOf('www.bbc.co.uk') === 'bbc.co.uk', 'siteOf groups hosts like Digital Wellbeing lists them');
ok(catOf('youtube.com') === 'entertainment' && catOf('facebook.com') === 'social' && catOf('example.com') === 'other', 'bundled categories');
ok(C.categoryOf('example.com', { 'example.com': 'education' }) === 'education', 'the person’s own category wins');

// ------------------------------------------------------------------ recording
const days = {};
M.record(days, 'youtube.com', at(26, 10, 59, 30), at(26, 11, 0, 30));
M.record(days, 'late.com', at(25, 23, 59, 30), at(26, 0, 0, 30));
const mon = M.readDay(days['2026-10-26']), sun = M.readDay(days['2026-10-25']);
ok(mon.s['youtube.com'] === 60 && mon.h[10]['youtube.com'] === 30 && mon.h[11]['youtube.com'] === 30, 'time is split at the hour');
ok(sun.s['late.com'] === 30 && mon.s['late.com'] === 30 && mon.h[0]['late.com'] === 30, 'and at midnight');
ok(mon.f === at(26, 0, 0, 0) && mon.fh === 'late.com', 'first use of the day is kept');
M.bump(days, 'n', at(26, 9));
M.bump(days, 'u', at(26, 9));
M.bump(days, 'u', at(26, 10));
ok(M.readDay(days['2026-10-26']).n === 1 && M.readDay(days['2026-10-26']).u === 2, 'notifications and unlocks counters');
const old = { '2026-08-01': { s: { 'a.com': 5 } }, '2026-09-22': { s: { 'a.com': 5 } }, '2026-09-21': { s: { 'a.com': 5 } }, junk: 1 };
M.prune(old, new Date(at(26, 12)));
ok(Object.keys(old).join() === '2026-09-22', 'prune keeps 35 days (' + Object.keys(old).join() + ')');
ok(M.readDay({ s: { 'a.com': -3, 'b.com': 'x', 'c.com': 7 } }).s['c.com'] === 7 && Object.keys(M.readDay({ s: { 'a.com': -3 } }).s).length === 0 && M.readDay(null).n === 0, 'readDay drops junk');

// ------------------------------------------------------------------ periods
// last week (Mon 19 – Sun 25): 1 h a day; this week: Mon 26 = 2 h (youtube 1.5 h, docs 0.5 h)
const u = { days: {} };
for (let d = 12; d <= 25; d++) M.record(u.days, d < 19 ? 'facebook.com' : 'github.com', at(d, 9), at(d, d < 19 ? 11 : 10));
M.record(u.days, 'youtube.com', at(26, 8), at(26, 9, 30));
M.record(u.days, 'docs.google.com', at(26, 10), at(26, 10, 30));
const now = new Date(at(26, 12));
const day = M.period(u, { mode: 'day', now, catOf });
ok(day.total === 7200 && day.bars.length === 24 && day.bars[8].total === 3600 && day.bars[9].total === 1800, 'day: total and hourly bars');
ok(day.sites[0][0] === 'youtube.com' && day.cats.map((c) => c[0]).join() === 'entertainment,productivity', 'day: sites and categories, most used first');
ok(Math.abs(day.change - 1) < 1e-9, 'day: compared with the 7 days before (2 h vs 1 h = +100%)');
const wk = M.period(u, { mode: 'week', ws: 1, now, catOf });
ok(wk.avg === 7200 && wk.bars.length === 7 && wk.bars[0].total === 7200 && wk.bars[1].total === 0, 'week: only days up to today count in the average');
const last = M.weekReport(u, { ws: 1, now, catOf });
ok(last.avg === 3600 && last.total === 7 * 3600 && Math.abs(last.change + 0.5) < 1e-9, 'weekly report: last week 1 h a day, down 50% from 2 h');
ok(M.reportSentence(last, { down: 'down {p} {t}', up: 'up {p} {t}', avg: 'avg {t}' }, (s) => s / 3600 + 'h', (p) => Math.round(p * 100) + '%') === 'down 50% 1h', 'report sentence');
ok(M.period(u, { mode: 'week', ws: 1, now, only: { site: 'github.com' }, offset: -1, catOf }).total === 7 * 3600, 'a single site over a week');
ok(M.axisMax(0) === 3600 && M.axisMax(1700) === 1800 && M.axisMax(3 * 3600) === 4 * 3600 && M.axisMax(9 * 3600) === 12 * 3600, 'chart scale');
const sl = M.slices([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1], ['f', 1]], 4);
ok(sl.length === 5 && sl[4].key === null && sl[4].sec === 2, 'donut slices: top four and the rest');
ok(M.knownSites(u)[0] === 'facebook.com', 'known sites, most used first');

// ------------------------------------------------------------------ timers
const w0 = M.prefs({ timers: [
  { id: 'yt', kind: 'site', target: 'youtube.com', min: 60 },
  { id: 'soc', kind: 'cat', target: 'social', min: 30, days: [0, 30, 30, 30, 30, 30, 120] },
] });
ok(M.timerMinutes(w0.timers[1], at(26, 12)) === 30 && M.timerMinutes(w0.timers[1], at(25, 12)) === 0 && M.timerMinutes(w0.timers[1], at(31, 12)) === 120, 'per-day minutes (Sunday off, Saturday 2 h)');
ok(M.timersFor(w0, 'youtube.com', at(26, 12), catOf).map((x) => x.id).join() === 'yt' && M.timersFor(w0, 'instagram.com', at(25, 12), catOf).length === 0, 'timers that apply today');
const used = M.timerUsed(w0.timers[0], u.days['2026-10-26'], catOf, { site: 'youtube.com', sec: 60 });
ok(used === 5460, 'timer use includes the time being counted now');

// ------------------------------------------------------------------ verdicts
const base = { focus: null, usage: u, catOf, now: at(26, 12) };
ok(JSON.stringify(M.verdict('youtube.com', { ...base, w: w0 })) === '["timer","yt"]', 'over a site timer → paused');
ok(M.verdict('github.com', { ...base, w: w0 }) === null, 'a site without a timer stays open');
const passU = { ...u, g: { allow: { 'timer:yt:youtube.com': at(26, 12, 1) } } };
ok(M.verdict('youtube.com', { ...base, w: w0, usage: passU }) === null, 'One more minute lets it through for a minute');
ok(JSON.stringify(M.verdict('youtube.com', { ...base, w: w0, usage: passU, now: at(26, 12, 2) })) === '["timer","yt"]', 'and then pauses it again');
const wMode = M.prefs({ focus: { id: 'work', startedAt: at(26, 11), endsAt: 0 } });
ok(M.activeMode(wMode, at(26, 12))?.id === 'work', 'a Focus mode without an end runs until turned off');
ok(JSON.stringify(M.verdict('facebook.com', { ...base, w: wMode })) === '["focus","work"]' && M.verdict('github.com', { ...base, w: wMode }) === null, 'Work time pauses distracting sites only');
const wAll = M.prefs({ modes: [{ id: 'deep', name: 'Deep work', block: 'all', allowed: ['github.com'] }], focus: { id: 'deep', startedAt: 1, endsAt: at(26, 13) } });
ok(M.verdict('github.com', { ...base, w: wAll }) === null && JSON.stringify(M.verdict('example.com', { ...base, w: wAll })) === '["focus","deep"]', '"All sites except allowed" mode');
ok(M.verdict('example.com', { ...base, w: wAll, now: at(26, 13, 1) }) === null, 'a mode with an end time is over after it');
ok(JSON.stringify(M.verdict('reddit.com', { ...base, w: M.prefs({}), focus: { endsAt: at(26, 12, 30) } })) === '["focus","session"]', 'the Quick Panel’s Focus pauses distracting sites');
ok(M.verdict('reddit.com', { ...base, w: M.prefs({ focusSessions: false }), focus: { endsAt: at(26, 12, 30) } }) === null, 'unless turned off');
ok(M.verdict('reddit.com', { ...base, w: M.prefs({}), focus: { endsAt: at(26, 12, 30) }, usage: { days: {}, g: { allow: { 'focus:reddit.com': at(26, 12, 5) } } } }) === null, 'Use for 5 minutes');

// ------------------------------------------------------------------ Bedtime mode
const bt = { ...M.DEFAULT_BEDTIME, on: true, from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4], block: true, allowed: ['wikipedia.org'] };
ok(M.bedtimeAt(bt, at(26, 23)).active && M.bedtimeAt(bt, at(26, 23)).until === at(27, 7), 'on at 23:00 Monday, until 7:00');
ok(M.bedtimeAt(bt, at(27, 6, 59)).active && !M.bedtimeAt(bt, at(27, 7)).active, 'ends at 7:00');
ok(!M.bedtimeAt(bt, at(30, 23)).active, 'no bedtime on a day that isn’t picked');
ok(M.bedtimeAt(bt, at(26, 12)).next === at(26, 22), 'next start');
const offTonight = M.toggleBedtime(bt, at(26, 23));
ok(!M.bedtimeAt(offTonight, at(26, 23, 30)).active && M.bedtimeAt(offTonight, at(27, 23)).active, 'Turn off skips tonight only');
const onNow = M.toggleBedtime({ ...bt, on: false }, at(26, 15));
ok(M.bedtimeAt(onNow, at(26, 15, 1)).active && M.bedtimeAt(onNow, at(26, 15, 1)).until === at(27, 7), 'Turn on now lasts until the wake-up time');
const wBed = M.prefs({ bedtime: bt });
ok(JSON.stringify(M.verdict('example.com', { ...base, w: wBed, now: at(26, 23) })) === '["bedtime"]' && M.verdict('en.wikipedia.org', { ...base, w: wBed, now: at(26, 23) }) === null, 'Bedtime pauses sites except allowed ones');
ok(M.verdict('example.com', { ...base, w: M.prefs({ bedtime: { ...bt, block: false } }), now: at(26, 23) }) === null, 'unless pausing sites is off');

// ------------------------------------------------------------------ misc
ok(M.nextTimeOf('07:00', at(26, 6)) === at(26, 7) && M.nextTimeOf('07:00', at(26, 7)) === at(27, 7), 'nextTimeOf');
ok(M.prefs(null).modes.length === 2 && M.prefs({ modes: [] }).modes.length === 0 && M.prefs('junk').goal === 0, 'prefs defaults');
ok(M.weekStartOf(new Date(at(28, 12)), 1).getDate() === 26 && M.weekStartOf(new Date(at(28, 12)), 0).getDate() === 25 && M.weekStartOf(new Date(at(28, 12)), 6).getDate() === 24, 'week start for Monday, Sunday and Saturday weeks');

// ------------------------------------------------------------------ Routines actions (storage level, as the service worker runs them)
{
  const { ACTIONS, swSafe } = await import('../js/routines/actions.js');
  await import('../js/wellbeing/actions.js');
  let mem = { wellbeing: { goal: 60 } };
  const ctx = { env: 'sw', page: null, get: async (k) => structuredClone(mem[k]), set: async (k, v) => { mem[k] = structuredClone(v); } };
  const A = (type, p = {}) => ({ id: type, type, p });
  ok(swSafe([A('wellbeing.bedtime', { value: 'on' }), A('wellbeing.focus', { mode: 'work' }), A('wellbeing.focusOff')]), 'Routines: the Bedtime and Focus mode actions can run in the service worker');
  const bedOn = () => M.bedtimeAt(M.prefs(mem.wellbeing).bedtime).active;
  const was = await ACTIONS['wellbeing.bedtime'].undo.save(ctx);
  await ACTIONS['wellbeing.bedtime'].run(ctx, { value: 'on' });
  ok(bedOn() && mem.wellbeing.goal === 60, 'Bedtime mode on (other choices kept)');
  await ACTIONS['wellbeing.bedtime'].run(ctx, { value: 'on' });
  ok(bedOn(), 'on again leaves it on');
  await ACTIONS['wellbeing.bedtime'].undo.restore(ctx, was);
  ok(!bedOn(), 'undo turns it back off');
  await ACTIONS['wellbeing.bedtime'].run(ctx, { value: 'toggle' });
  ok(bedOn(), 'toggle turns it on');
  await ACTIONS['wellbeing.bedtime'].run(ctx, { value: 'off' });
  ok(!bedOn(), 'off turns it off');
  const prev = await ACTIONS['wellbeing.focus'].undo.save(ctx);
  await ACTIONS['wellbeing.focus'].run(ctx, { mode: 'me' });
  ok(mem.wellbeing.focus?.id === 'me' && mem.wellbeing.focus.endsAt === 0 && M.activeMode(M.prefs(mem.wellbeing))?.id === 'me', 'Start Focus mode: Me time until turned off');
  await ACTIONS['wellbeing.focus'].undo.restore(ctx, prev);
  ok(!mem.wellbeing.focus, 'undo ends it');
  mem.wellbeing.modes = [{ id: 'study', name: 'Study', icon: 'wbWork', color: '#3e8bff', minutes: 45 }];
  await ACTIONS['wellbeing.focus'].run(ctx, { mode: 'study' });
  ok(mem.wellbeing.focus?.id === 'study' && Math.abs(mem.wellbeing.focus.endsAt - Date.now() - 45 * 60e3) < 5000, 'a custom mode keeps its own length');
  await ACTIONS['wellbeing.focusOff'].run(ctx, {});
  ok(mem.wellbeing.focus === null, 'End Focus mode');
  let err = '';
  try { await ACTIONS['wellbeing.focus'].run(ctx, { mode: 'gone' }); } catch (e) { err = e.key; }
  ok(err === 'wellbeing.ra.noMode', 'a deleted mode is a readable error');
}

console.log(`\n${passed} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
