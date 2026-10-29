// Plain-node checks of Modes and Routines: the runner (variables, If, Repeat, menus, questions), the built-in actions
// at storage level (what the service worker runs), undo when a routine ends, modes, time periods with sunrise/sunset,
// events, pending work for a page, Discover and Describe drafts. No browser. Exits 1 on failure.
// usage: node .dev/routines-run.mjs
import { runActions } from '../js/routines/run.js';
import { ACTIONS, Stop, swSafe, registerAction, compare, toText, newAction, permsOf } from '../js/routines/actions.js';
import * as M from '../js/routines/model.js';
import * as E from '../js/routines/engine.js';
import { DISCOVER } from '../js/routines/discover.js';
import { draftFrom } from '../js/routines/describe.js';

let bad = 0, n = 0;
const ok = (cond, what) => { n++; if (!cond) { bad++; console.log('FAIL', what); } else console.log('ok  ', what); };
let mem = {};
const notes = [], alarms = new Map();
const ctx = (extra = {}) => ({
  env: 'sw', page: null, locale: 'en-US',
  get: async (k) => structuredClone(mem[k]), set: async (k, v) => { mem[k] = structuredClone(v); },
  notify: (title, body) => notes.push([title, body]),
  schedule: (name, when) => alarms.set(name, when), cancel: (name) => alarms.delete(name),
  loc: async () => ({ lat: 51.5, lon: -0.12 }),
  pend: async (key) => notes.push(['pending', key]),
  report: async (name, e) => notes.push(['error', name, e.key || e.message]),
  ...extra,
});
let k = 0;
const A = (type, p = {}, more = {}) => ({ id: 'a' + (++k), type, p, ...more });
const run = (actions, c = ctx(), o = {}) => runActions(M.repair(actions), c, o);

// ——— runner ———
{
  const t1 = A('text', { text: 'Hello' }), t2 = A('text', { text: [{ v: t1.id }, ', world'] });
  ok(await run([t1, t2]) === 'Hello, world', 'Text with a variable from an earlier action');
  const c = A('calc', { a: '6', op: '*', b: '7' });
  ok(await run([c]) === 42, 'Calculate');
  ok(await run([A('text', { text: '20' }), A('calc', { op: '+', b: '1' })]) === 21, 'Calculate takes the previous result as its input');
  const sv = A('var.set', { name: 'who', value: 'Sam' }), gv = A('text', { text: ['Hi ', { n: 'who' }] });
  ok(await run([A('text', { text: 'x' }), sv, gv]) === 'Hi Sam', 'Set variable and a named variable');
  ok(await run([A('text', { text: [{ s: 'input' }, '!'] })], ctx(), { input: 'in' }) === 'in!', 'Routine input');
  const mk = (v) => { const g = 'g' + (++k); return [A('text', { text: String(v) }), A('if', { op: 'gt', value: '10' }, { g, m: 0 }), A('text', { text: 'big' }), A('if', {}, { g, m: 1 }), A('text', { text: 'small' }), A('if', {}, { g, m: 2 })]; };
  ok(await run(mk(20)) === 'big' && await run(mk(5)) === 'small', 'If / Otherwise');
  ok(compare('', 'none') && !compare('x', 'none') && compare('Bloom Tab', 'contains', 'tab'), 'If conditions (any value, contains ignores case)');
  const g = 'g' + (++k), start = A('repeat', { count: '4' }, { g, m: 0 }), end = A('repeat', {}, { g, m: 2 });
  const out = await run([start, A('calc', { a: [{ v: start.id, k: 'index' }], op: '*', b: '10' }), end]);
  ok(JSON.stringify(out) === '[10,20,30,40]', 'Repeat with its index → results ' + JSON.stringify(out));
  const g2 = 'g' + (++k), s2 = A('repeat.each', { list: 'a\nb' }, { g: g2, m: 0 }), e2 = A('repeat.each', {}, { g: g2, m: 2 });
  ok(await run([s2, A('text', { text: [{ v: s2.id, k: 'item' }, '!'] }), e2, A('text', { text: [{ v: e2.id }] })]) === 'a!\nb!', 'Repeat with each over lines');
  let threw = null;
  try { await run([A('text', { text: 'a' }), A('stop'), A('text', { text: 'b' })]); } catch (e) { threw = e; }
  ok(threw instanceof Stop && threw.result === 'a', 'Stop routine ends the run with its input');
  const inner = { id: 'r-in', actions: [A('text', { text: [{ s: 'input' }, ' + inner'] }), A('stop'), A('text', { text: 'x' })] };
  ok(await run([A('text', { text: 'outer' }), A('routine.run', { routine: 'r-in' })], ctx(), { routines: [inner] }) === 'outer + inner', 'Run another routine passes input and result back');
  const loop = { id: 'r-loop', actions: [A('routine.run', { routine: 'r-loop' })] };
  threw = null;
  try { await run(loop.actions, ctx(), { routines: [loop] }); } catch (e) { threw = e; }
  ok(threw && !(threw instanceof Stop), 'a routine that runs itself forever is stopped');
  const t0 = Date.now();
  await run([A('wait', { sec: '0.2' })]);
  ok(Date.now() - t0 >= 180, 'Wait waits');
  // page-only actions and questions
  let e = null;
  try { await run([A('toast', { text: 'x' })]); } catch (x) { e = x; }
  ok(e?.key === 'routines.err.page', 'page-only actions refuse to run without a page');
  const page = { menu: async () => 1, alert: async () => true, ask: async () => 'typed', toast: () => {} };
  const gm = 'g' + (++k);
  const menu = [A('menu', { prompt: 'Pick', items: ['One', 'Two'] }, { g: gm, m: 0 }), A('menu', { item: 0 }, { g: gm, m: 1 }), A('text', { text: 'first' }), A('menu', { item: 1 }, { g: gm, m: 1 }), A('text', { text: 'second' }), A('menu', {}, { g: gm, m: 2 })];
  ok(await run(menu, ctx({ page })) === 'second', 'Choose from menu runs the chosen item');
  ok(await run([A('text', { text: ['<', { s: 'ask' }, '>'] })], ctx({ page })) === '<typed>', 'Ask each time');
  const ask = A('ask', { prompt: 'Name?' });
  ok(await run([ask, A('text', { text: ['Hi ', { v: ask.id }] })], ctx({ page })) === 'Hi typed', 'Ask for input → Provided input');
  registerAction({ id: 'test.double', name: 'x', out: 'x', sw: true, params: [{ key: 'n', type: 'number', input: true }], run: (c2, p) => p.n * 2 });
  ok(await run([A('text', { text: '21' }), A('test.double')]) === 42, 'registerAction adds an action other apps can use');
  ok(swSafe([A('focus.on'), A('url.open', { url: 'x' }), A('theme.set')]) && !swSafe([A('sound.play')]) && !swSafe([A('wait', { sec: '60' })]) && !swSafe([A('text', { text: [{ s: 'ask' }] })]), 'swSafe: storage actions yes; sounds, long waits and questions need a page');
  ok(newAction('if').length === 3 && newAction('repeat').length === 2 && newAction('menu').length === 4 && newAction('timer.start')[0].p.min === '5', 'newAction adds block markers and defaults');
  ok(permsOf([A('tabs.close'), A('tabs.group')]).join() === 'tabs,tabGroups', 'permissions a list needs');
}

// ——— built-in actions at storage level (the service worker's way) ———
{
  mem = { settings: { theme: 'light', blur: true }, focus: null, timers: [], notes: [], reminders: [] };
  const c = ctx();
  await run([A('theme.set', { value: 'dark' }), A('eye.set', { value: 'on', level: '60' }), A('brightness.set', { value: '55' }), A('wallpaper.set', { preset: 'ocean' })], c);
  const s = mem.settings;
  ok(s.theme === 'dark' && s.eyeComfort && s.eyeComfortLevel === 60 && s.brightness === 55 && s.wallpaper.id === 'ocean' && s.blur === true, 'Display actions change settings and keep the others');
  await run([A('focus.on', { min: '30' })], c);
  ok(mem.focus && Math.abs(mem.focus.endsAt - Date.now() - 30 * 60e3) < 2000 && alarms.has('focus'), 'Do not disturb starts Focus with its alarm');
  await run([A('focus.off')], c);
  ok(mem.focus === null && !alarms.has('focus'), 'Turn off Do not disturb');
  await run([A('timer.start', { min: '1.5', label: 'Tea' })], c);
  const tm = mem.timers[0];
  ok(tm && tm.duration === 90e3 && tm.label === 'Tea' && tm.running && alarms.get('timer:' + tm.id) === tm.endsAt, 'Start timer stores a timer and schedules timer:<id> like Finder');
  await run([A('text', { text: 'Groceries\nEggs <b>' }), A('note.new')], c);
  ok(mem.notes[0]?.title === 'Groceries' && mem.notes[0].body === '<div>Eggs &lt;b&gt;</div>', 'Create note from the previous result (escaped)');
  await run([A('reminder.add', { title: 'Call Sam', in: '10' })], c);
  const r = mem.reminders[0];
  ok(r?.title === 'Call Sam' && r.due > Date.now() + 9 * 60e3 && alarms.has('reminder:' + r.id), 'Add reminder with a time');
  await run([A('notify', { title: 'Hi', text: 'There' })], c);
  ok(notes.at(-1)?.[1] === 'There', 'Show notification');
  await run([A('sound.stop')], c);
  ok(mem.routinesRun?.cmd?.sound === 'stop', 'the worker stops sounds by telling the pages');
}

// ——— routines: undo, time periods, events, pending ———
const ROUT = (props) => M.normRoutine({ id: 'r' + (++k), name: 'R', on: true, conds: [], actions: [], undo: true, ...props });
{
  mem = { settings: { theme: 'light', brightness: 100 }, routines: { list: [] } };
  const bed = ROUT({ name: 'Bedtime', conds: [{ type: 'manual' }], actions: [A('theme.set', { value: 'dark' }), A('brightness.set', { value: '40' }), A('focus.on', { min: '60' })] });
  mem.routines.list = [bed];
  const c = ctx();
  const res = await E.startRoutine(c, bed.id);
  ok(res.ok && res.running && mem.settings.theme === 'dark' && mem.settings.brightness === 40 && mem.focus, 'a manual routine with undo runs and keeps running');
  ok(M.normRun(mem.routinesRun).running[bed.id]?.undo.length === 3, 'it saved what to put back');
  ok((await E.startRoutine(c, bed.id)).already, 'starting it again while it runs does nothing');
  await E.endRoutine(c, bed.id);
  ok(mem.settings.theme === 'light' && mem.settings.brightness === 100 && !mem.focus && !M.normRun(mem.routinesRun).running[bed.id], 'ending it undoes its actions');
  // a routine with a page-only action goes pending in the worker
  const snd = ROUT({ name: 'Rain', conds: [{ type: 'newtab' }], actions: [A('sound.play', { sound: 'rain' })] });
  mem.routines.list.push(snd);
  const p1 = await E.startRoutine(c, snd.id, { by: 'event' });
  ok(p1.pending && M.normRun(mem.routinesRun).pending.some((p) => p.key === 'r:' + snd.id) && notes.some((x) => x[0] === 'pending'), 'page-only routine is left pending with a notification');
  let played = null;
  const page = { sound: (id) => (played = id), soundState: () => ({ playing: false }), stopSound: () => (played = 'stopped'), setSettings: async (p) => { mem.settings = { ...mem.settings, ...p }; }, startFocus() {}, stopFocus() {}, isDark: () => false };
  const pc = ctx({ env: 'page', page });
  const list = await E.takePending(pc);
  await E.runPending(pc, list);
  ok(played === 'rain' && !M.normRun(mem.routinesRun).pending.length, 'a page takes the pending routine and runs it');
}
{
  // time periods: 22:00–07:00 every day; sunset → sunrise
  const tp = M.normCond({ type: 'time', start: '22:00', end: '07:00', days: [1] });
  const mon = new Date(2026, 9, 26, 23, 30).getTime(), tue6 = new Date(2026, 9, 27, 6, 30).getTime(), tue8 = new Date(2026, 9, 27, 8).getTime();
  ok(!!M.activeWindow(tp, mon) && !!M.activeWindow(tp, tue6) && !M.activeWindow(tp, tue8), 'an overnight period started on Monday holds until Tuesday 7:00');
  ok(!M.activeWindow(tp, new Date(2026, 9, 27, 23, 30).getTime()), 'it does not start on a day that is not picked');
  const loc = { lat: 51.5, lon: -0.12 };
  const sun = M.normCond({ type: 'time', start: 'sunset', end: 'sunrise' });
  const st = M.sunTimes(new Date(2026, 9, 26, 12).getTime(), loc.lat, loc.lon);
  ok(Math.abs(st.sunset - new Date(Date.UTC(2026, 9, 26, 16, 45)).getTime()) < 20 * 60e3, 'London sunset on 26 Oct is about 16:45 UTC: ' + new Date(st.sunset).toISOString());
  ok(!!M.activeWindow(sun, new Date(2026, 9, 26, 23).getTime(), loc) && !M.activeWindow(sun, new Date(2026, 9, 26, 13).getTime(), loc) && !M.activeWindow(sun, new Date(2026, 9, 26, 23).getTime(), null), 'sunset to sunrise needs a location and holds at night');
  const data = M.norm({ list: [M.normRoutine({ id: 'x', conds: [{ type: 'time', start: '22:00', end: '07:00' }] })] });
  const from = new Date(2026, 9, 26, 12).getTime();
  ok(M.nextEdge(data, null, from, loc) === new Date(2026, 9, 26, 22).getTime(), 'the next edge is tonight at 22:00');
  ok(M.nextEdge(data, null, new Date(2026, 9, 26, 22, 30).getTime(), loc) === new Date(2026, 9, 27, 7).getTime(), 'then 7:00 the next morning');
  const inst = M.norm({ list: [M.normRoutine({ id: 'i', conds: [{ type: 'time', start: '09:00', end: '' }] })] });
  ok(M.dueInstants(inst, new Date(2026, 9, 26, 8, 59).getTime(), new Date(2026, 9, 26, 9, 0, 30).getTime(), null).join() === 'i', 'an instant time is due once the tick passes it');
  ok(!M.dueInstants(inst, new Date(2026, 9, 26, 8, 0).getTime(), new Date(2026, 9, 26, 10, 0).getTime(), null).length, 'but not when it was missed by more than 30 minutes');
}
{
  // reconcile: a period routine that holds now starts, then ends when its period is over
  const nowD = new Date(), hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const r = ROUT({ name: 'Now', conds: [{ type: 'time', start: hhmm(new Date(Date.now() - 3600e3)), end: hhmm(new Date(Date.now() + 3600e3)) }], actions: [A('theme.set', { value: 'dark' })] });
  mem = { settings: { theme: 'light' }, routines: { list: [r] } };
  const c = ctx();
  await E.tick(c);
  ok(M.normRun(mem.routinesRun).running[r.id]?.by === 'state' && mem.settings.theme === 'dark', 'tick starts a routine whose time period holds now (' + hhmm(nowD) + ')');
  await E.endRoutine(c, r.id);
  ok(mem.settings.theme === 'light' && M.normRun(mem.routinesRun).skip['r:' + r.id], 'stopped by hand during its period: undone and skipped');
  await E.tick(c);
  ok(!M.normRun(mem.routinesRun).running[r.id], 'tick doesn’t start it again until the period is over');
  mem.routines.list[0].conds = [{ type: 'time', start: hhmm(new Date(Date.now() + 3600e3)), end: hhmm(new Date(Date.now() + 7200e3)), days: M.ALL_DAYS }];
  await E.tick(c);
  ok(!M.normRun(mem.routinesRun).skip['r:' + r.id], 'the skip goes once the period is over');
}
{
  // events: site opened (not when moving inside it), back after being away, all-conditions
  const site = ROUT({ name: 'Site', conds: [{ type: 'site', hosts: ['youtube.com'] }], actions: [A('notify', { text: 'Stay focused' })] });
  const idle = ROUT({ name: 'Back', conds: [{ type: 'idle', away: 15 }], actions: [A('notify', { text: 'Welcome back' })] });
  const both = ROUT({ name: 'Both', match: 'all', conds: [{ type: 'newtab' }, { type: 'mode', mode: 'work' }], actions: [A('notify', { text: 'Work tab' })] });
  mem = { routines: { list: [site, idle, both] } };
  const c = ctx();
  notes.length = 0;
  ok((await E.fire(c, { type: 'site', url: 'https://m.youtube.com/watch', prev: 'https://example.com' })).join() === site.id, 'Website opened fires for a subdomain');
  ok(!(await E.fire(c, { type: 'site', url: 'https://youtube.com/b', prev: 'https://youtube.com/a' })).length, 'moving inside the site does not fire again');
  ok(!(await E.fire(c, { type: 'idle', away: 5 })).length && (await E.fire(c, { type: 'idle', away: 20 })).join() === idle.id, 'Back at the computer after being away long enough');
  ok(!(await E.fire(c, { type: 'newtab' })).length, '"all": a new tab without Work mode does nothing');
  await E.modeOn(c, 'work');
  ok((await E.fire(c, { type: 'newtab' })).join() === both.id, '"all": a new tab while Work mode is on runs it');
  // Screen unlocked: its own event, nothing else fires it
  const unl = ROUT({ name: 'Unlocked', conds: [{ type: 'unlock' }], actions: [A('notify', { text: 'Hi again' })] });
  ok(M.normCond({ type: 'unlock' }).type === 'unlock' && M.eventMatches({ type: 'unlock' }, { type: 'unlock' }) && !M.eventMatches({ type: 'unlock' }, { type: 'newtab' }), 'Screen unlocked is a condition of its own');
  mem = { routines: { list: [unl, idle] } };
  ok((await E.fire(c, { type: 'unlock' })).join() === unl.id && !(await E.fire(c, { type: 'newtab' })).length, 'an unlock runs only “Screen unlocked” routines');
  ok(M.isEvent(M.normCond({ type: 'unlock' })) && !M.isState(M.normCond({ type: 'unlock' })), 'it is an event, not a state');
}
{
  // modes: on with undo, until, switching, auto schedule, mode condition starts routines
  mem = { settings: { theme: 'light', brightness: 100, eyeComfort: false }, routines: {} };
  const c = ctx();
  await E.modeOn(c, 'sleep');
  let rr = M.normRun(mem.routinesRun);
  ok(rr.mode?.id === 'sleep' && mem.settings.theme === 'dark' && mem.settings.eyeComfort && mem.settings.brightness === 60 && mem.focus, 'Sleep mode: Do not disturb, Dark mode, Eye comfort, brightness');
  ok(rr.pending.some((p) => p.key === 'm:sleep'), 'its sound waits for a page');
  await E.modeOff(c);
  rr = M.normRun(mem.routinesRun);
  ok(!rr.mode && mem.settings.theme === 'light' && !mem.settings.eyeComfort && mem.settings.brightness === 100 && !mem.focus, 'turning it off puts everything back');
  const withMode = ROUT({ name: 'Theater lights', conds: [{ type: 'mode', mode: 'theater' }], actions: [A('wallpaper.set', { preset: 'midnight' })] });
  mem.routines = { list: [withMode] };
  await E.modeOn(c, 'theater', { until: Date.now() - 10 });
  ok(M.normRun(mem.routinesRun).running[withMode.id] && mem.settings.wallpaper?.id === 'midnight', 'a routine with "Theater mode is on" starts with the mode');
  await E.reconcileModes(c);
  rr = M.normRun(mem.routinesRun);
  ok(!rr.mode && !rr.running[withMode.id] && mem.settings.wallpaper?.id !== 'midnight', 'the mode ends at its time and the routine ends and undoes with it');
  await E.modeOn(c, 'work');
  await E.modeOn(c, 'relax');
  ok(M.normRun(mem.routinesRun).mode?.id === 'relax' && !mem.focus, 'turning on another mode turns the first one off');
  await E.modeOff(c);
  const nowH = new Date();
  const s = `${String(nowH.getHours()).padStart(2, '0')}:00`, e = `${String((nowH.getHours() + 2) % 24).padStart(2, '0')}:00`;
  mem.routines = { modes: [{ ...M.presetMode('work'), autoOn: true, auto: [{ type: 'time', start: s, end: e, days: M.ALL_DAYS }] }], list: [] };
  await E.reconcileModes(c);
  rr = M.normRun(mem.routinesRun);
  ok(rr.mode?.id === 'work' && rr.mode.by === 'auto' && rr.mode.until > Date.now(), 'a scheduled mode turns on during its schedule, until its end');
  await E.modeOff(c);
  await E.reconcileModes(c);
  ok(!M.normRun(mem.routinesRun).mode, 'turned off by hand, it stays off until its schedule ends');
  ok(M.norm({}).modes.map((m) => m.id).join() === 'sleep,theater,driving,exercise,relax,work', 'the six Samsung modes are always there');
}

// ——— model helpers ———
{
  const acts = [A('text'), A('if', {}, { g: 'q', m: 0 }), A('text'), A('if', {}, { g: 'q', m: 2 }), A('text')];
  ok(M.blockRange(acts, 1).join() === '1,3', 'a block moves as a whole');
  ok(M.moveStep(acts, 4, -1).map((a) => a.type).join() === 'text,text,if,text,if', 'moving up jumps over a whole block');
  ok(M.moveStep(acts, 0, 1).map((a) => a.type).join() === 'if,text,if,text,text', 'moving down jumps over a whole block');
  ok(M.repair([{ id: '1', type: 'if', g: 'x', m: 0, p: {} }, { id: '2', type: 'text', p: {} }, { id: '3', type: 'repeat', g: 'zz', m: 2, p: {} }]).at(-1).m === 2, 'repair closes open blocks and drops stray markers');
  ok(M.varsBefore(acts, 4, (a) => !!ACTIONS[a.type]?.out && (!a.g || a.m === 2)).length === 3, 'variables before an action');
  const c2 = M.cloneRoutine({ id: 'x', actions: [{ id: 'p1', type: 'text', p: {} }, { id: 'p2', type: 'text', p: { text: [{ v: 'p1' }] } }] });
  ok(c2.actions[1].p.text[0].v === c2.actions[0].id && c2.id !== 'x', 'duplicating re-points variables');
  ok(M.siteMatch(['youtube.com'], 'https://www.youtube.com/') && !M.siteMatch(['youtube.com'], 'https://notyoutube.com/'), 'site matching');
  ok(toText([1, 2]) === '1\n2', 'lists as text');
  ok(M.hasEnd(M.normRoutine({ conds: [{ type: 'time', start: '9:00', end: '10:00' }] })) && !M.hasEnd(M.normRoutine({ conds: [{ type: 'newtab' }] })), 'routines with a period have an end, event ones don’t');
}

// ——— Discover and Describe ———
{
  const broken = DISCOVER.flatMap((c) => c.items).filter((it) => { const r = it.make(); return !r.actions.length || r.actions.some((a) => !ACTIONS[a.type]) || JSON.stringify(M.repair(r.actions)) !== JSON.stringify(r.actions) || !r.conds.length; });
  ok(!broken.length, 'every Discover routine is valid ' + broken.map((x) => x.id).join());
  const d = draftFrom({ name: 'Workday', trigger: { type: 'time', time: '9:00', days: ['weekdays'] }, actions: [{ action: 'mode.on', value: 'work' }, { action: 'url.open', value: 'mail.google.com' }, { action: 'hack' }, { action: 'sound.play', value: 'Rain please' }] }, { modes: ['sleep', 'work'], sounds: ['rain', 'ocean'] });
  ok(d.conds[0]?.type === 'time' && d.conds[0].start === '09:00' && d.conds[0].days.join() === '1,2,3,4,5', 'describe: every weekday at 9 → time');
  ok(d.actions.map((a) => a.type).join() === 'mode.on,url.open,sound.play' && d.actions[0].p.mode === 'work' && d.actions[2].p.sound === 'rain', 'describe: actions mapped, unknown dropped');
  const d2 = draftFrom({ name: 'X', trigger: { type: 'website', website: 'https://www.YouTube.com/feed' }, actions: [{ action: 'notify', value: 'Focus!' }] }, {});
  ok(d2.conds[0]?.type === 'site' && d2.conds[0].hosts[0] === 'youtube.com', 'describe: website trigger');
  ok(draftFrom({ name: 'Y', trigger: { type: 'none' }, actions: [{ action: 'theme.set', value: 'dark' }] }, {}).conds[0].type === 'manual', 'describe: no trigger → start manually');
}
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
