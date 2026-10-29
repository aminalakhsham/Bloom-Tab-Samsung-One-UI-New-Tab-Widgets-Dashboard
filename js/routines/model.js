// Modes and Routines data model. Pure (no DOM, no storage, no translations), so the pages, the service worker
// (js/bg/routines.js) and the plain-node test (.dev/routines-run.mjs) share it.
//
// Store key `routines` (settings the user makes): { modes: [Mode], list: [Routine] }
//   Mode    { id, preset?: 'sleep' | 'theater' | 'driving' | 'exercise' | 'relax' | 'work', name, icon, color,
//             dnd (Focus / Do not disturb while it's on), dark: '' | 'on' | 'off', eye: '' | 'on' | 'off',
//             brightness: null | 30…100, wallpaper: null | preset id, sound: null | ambient sound id,
//             actions: [Action] (anything else it does), autoOn, auto: [time Cond] (turn on automatically) }
//   Routine { id, name, icon, color, on, match: 'any' | 'all', conds: [Cond], actions: [Action], undo, at }
//   Cond    { type: 'manual' } | { type: 'time', start, end, days } (start/end 'HH:MM' | 'sunrise' | 'sunset';
//             end '' = an instant, not a period) | { type: 'newtab' } | { type: 'startup' } | { type: 'unlock' }
//             | { type: 'idle', away: minutes } | { type: 'mode', mode: mode id | '' (any) } | { type: 'site', hosts }
//   Action  { id, type, p: { key: Value }, g?, m? }. If / Repeat / Choose from Menu are flat markers sharing a group
//             id `g` (m: 0 start · 1 middle · 2 end), as in Liquid Tab's Shortcuts, so reordering stays a list.
//
// Store key `routinesRun` (this computer's state, written by pages and the service worker):
//   { mode: { id, since, until, by: 'manual' | 'auto' | 'routine', undo: [Snap] } | null,
//     running: { [routine id]: { since, by: 'manual' | 'state' | 'event', undo: [Snap] } },
//     last: { [routine id]: ms }, skip: { 'r:<id>' | 'm:<id>': true } (stopped by hand while its time still holds),
//     pending: [{ key: 'r:<id>' | 'm:<id>', at, by }] (needs a page), tickAt, lastMode, cmd: { sound: 'stop', at } }
//   Snap = { type: action type, v: saved value } — what "Undo actions when routine ends" puts back.

export const KEY = 'routines', RUN_KEY = 'routinesRun';
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const LATE = 30 * 60e3; // an instant trigger missed while the computer slept isn't run hours later
export const PENDING_TTL = 3 * 3600e3;

const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export { uid };

// One UI colours for routine and mode icons
export const COLORS = ['#3e7bff', '#6f5cf1', '#a259e6', '#e2589c', '#f2556b', '#ff7a45', '#f5a524', '#22a356', '#14b8a6', '#2aa7d8', '#8a8d96', '#c47a2c'];
// glyphs offered for routines and custom modes (icon names from js/core/icons.js or added by js/apps/routines.js)
export const GLYPHS = ['rtRoutine', 'rtSleep', 'rtWork', 'rtExercise', 'rtRelax', 'rtTheater', 'rtDriving', 'rtBook', 'rtCoffee', 'rtGame',
  'rtBolt', 'rtHeart', 'sun', 'moon', 'star', 'bell', 'home', 'globe', 'music', 'note', 'calendar', 'timer', 'focus', 'sparkle'];

// Samsung's preset modes, with what each turns on by default
export const MODE_PRESETS = [
  { preset: 'sleep', icon: 'rtSleep', color: '#6f5cf1', dnd: true, dark: 'on', eye: 'on', brightness: 60, sound: 'brown', auto: [{ type: 'time', start: '22:00', end: '07:00', days: ALL_DAYS }] },
  { preset: 'theater', icon: 'rtTheater', color: '#e2589c', dnd: true, dark: 'on', brightness: 40 },
  { preset: 'driving', icon: 'rtDriving', color: '#3e7bff', dnd: true },
  { preset: 'exercise', icon: 'rtExercise', color: '#22a356', dnd: true, sound: 'forest' },
  { preset: 'relax', icon: 'rtRelax', color: '#14b8a6', eye: 'on', sound: 'ocean' },
  { preset: 'work', icon: 'rtWork', color: '#c47a2c', dnd: true, auto: [{ type: 'time', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] }] },
];
export const COND_TYPES = ['manual', 'time', 'newtab', 'startup', 'unlock', 'idle', 'mode', 'site'];

// ——— tolerant reading ———
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const str = (x, d = '') => (typeof x === 'string' ? x : d);
const arr = (x) => (Array.isArray(x) ? x : []);
const spec = (x, d) => (x === 'sunrise' || x === 'sunset' || /^\d{1,2}:\d{2}$/.test(x || '') ? (x.includes(':') ? x.padStart(5, '0') : x) : d);
const days = (x) => (Array.isArray(x) && x.length ? [...new Set(x.map(Number).filter((n) => n >= 0 && n <= 6))].sort() : ALL_DAYS.slice());

export function normCond(c) {
  c = obj(c);
  const type = COND_TYPES.includes(c.type) ? c.type : 'manual';
  if (type === 'time') return { type, start: spec(c.start, '09:00'), end: c.end === '' || c.end == null ? '' : spec(c.end, ''), days: days(c.days) };
  if (type === 'idle') return { type, away: Math.max(1, Math.min(720, Math.round(+c.away || 15))) };
  if (type === 'mode') return { type, mode: str(c.mode) };
  if (type === 'site') return { type, hosts: arr(c.hosts).map(cleanHost).filter(Boolean) };
  return { type };
}
export const normActions = (list) => arr(list).filter((a) => a && typeof a.type === 'string').map((a) => ({ ...a, id: a.id ? String(a.id) : uid('a'), p: obj(a.p) }));

export function normRoutine(r) {
  r = obj(r);
  return {
    ...r, id: String(r.id || uid('r')), name: str(r.name), icon: str(r.icon, 'rtRoutine'), color: str(r.color, COLORS[0]),
    on: r.on !== false, match: r.match === 'all' ? 'all' : 'any', conds: arr(r.conds).map(normCond),
    actions: repair(normActions(r.actions)), undo: r.undo !== false, at: +r.at || 0,
  };
}
export function normMode(m) {
  m = obj(m);
  const p = MODE_PRESETS.find((x) => x.preset === m.preset);
  const tri = (v) => (v === 'on' || v === 'off' ? v : '');
  return {
    ...m, id: String(m.id || p?.preset || uid('m')), preset: p ? p.preset : undefined, name: str(m.name), icon: str(m.icon, p?.icon || 'rtModes'),
    color: str(m.color, p?.color || COLORS[0]), dnd: !!m.dnd, dark: tri(m.dark), eye: tri(m.eye),
    brightness: m.brightness == null || m.brightness === '' ? null : Math.max(30, Math.min(100, Math.round(+m.brightness) || 100)),
    wallpaper: m.wallpaper ? String(m.wallpaper) : null, sound: m.sound ? String(m.sound) : null,
    actions: repair(normActions(m.actions)), autoOn: !!m.autoOn, auto: arr(m.auto).map(normCond).filter((c) => c.type === 'time'),
  };
}
/** A preset mode as it is before the user changes anything. */
export function presetMode(preset) {
  const p = MODE_PRESETS.find((x) => x.preset === preset);
  return normMode({ ...structuredClone(p), id: preset, autoOn: false });
}
/** A complete, safe copy of the stored `routines` value: every preset mode is there (in Samsung's order first). */
export function norm(v) {
  const d = obj(v);
  const stored = arr(d.modes).filter((m) => m && (m.id || m.preset)).map(normMode);
  const modes = [...stored];
  for (const p of MODE_PRESETS) if (!modes.some((m) => m.id === p.preset)) modes.splice(MODE_PRESETS.indexOf(p), 0, presetMode(p.preset));
  return { modes, list: arr(d.list).filter((r) => r && r.id).map(normRoutine) };
}
export function normRun(v) {
  const d = obj(v);
  const m = obj(d.mode);
  return {
    mode: m.id ? { id: String(m.id), since: +m.since || 0, until: +m.until || null, by: str(m.by, 'manual'), undo: arr(m.undo) } : null,
    running: Object.fromEntries(Object.entries(obj(d.running)).map(([k, x]) => [k, { since: +obj(x).since || 0, by: str(obj(x).by, 'manual'), undo: arr(obj(x).undo) }])),
    last: { ...obj(d.last) }, skip: { ...obj(d.skip) }, pending: arr(d.pending).filter((p) => p && p.key), tickAt: +d.tickAt || 0,
    lastMode: str(d.lastMode), cmd: d.cmd || null,
  };
}
export function newRoutine(props = {}) {
  return normRoutine({ id: uid('r'), name: '', icon: 'rtRoutine', color: COLORS[Math.floor(Math.random() * 8)], on: true, match: 'any', conds: [], actions: [], undo: true, at: Date.now(), ...props });
}
/** A copy with fresh ids for the routine and every action (variables re-pointed at the new ids). */
export function cloneRoutine(r, props = {}) {
  const ids = new Map(), groups = new Map();
  const actions = (r.actions || []).map((a) => { const id = uid('a'); ids.set(a.id, id); return { ...structuredClone(a), id }; });
  for (const a of actions) if (a.g) { if (!groups.has(a.g)) groups.set(a.g, uid('g')); a.g = groups.get(a.g); }
  for (const a of actions) a.p = remapVars(a.p, ids);
  return { ...structuredClone(r), ...props, id: uid('r'), actions, at: Date.now() };
}
function remapVars(v, ids) {
  if (Array.isArray(v)) return v.map((x) => remapVars(x, ids));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = k === 'v' && ids.has(x) ? ids.get(x) : remapVars(x, ids); return o; }
  return v;
}

// ——— blocks (If, Repeat, Choose from menu): flat markers sharing a group id ———
/** For each action: its depth, and for each block the indices of its start, middles and end. */
export function structure(actions) {
  const depth = [], blocks = new Map(), stack = [];
  actions.forEach((a, i) => {
    if (a.g && a.m === 0) { depth.push(stack.length); stack.push(a.g); blocks.set(a.g, { start: i, mids: [], end: -1 }); }
    else if (a.g && a.m === 1) { depth.push(Math.max(0, stack.length - 1)); blocks.get(a.g)?.mids.push(i); }
    else if (a.g && a.m === 2) { stack.pop(); depth.push(stack.length); const b = blocks.get(a.g); if (b) b.end = i; }
    else depth.push(stack.length);
  });
  return { depth, blocks };
}
/** Fixes broken nesting: markers without a start go, a block without an end gets one, crossing blocks close in order. */
export function repair(actions) {
  const out = [], open = [];
  const starts = new Set(actions.filter((a) => a.g && a.m === 0).map((a) => a.g));
  const close = (g) => { const s = actions.find((x) => x.g === g && x.m === 0); out.push({ id: uid('a'), type: s.type, p: {}, g, m: 2 }); };
  for (const a of actions) {
    if (!a.g || a.m == null) { out.push(a); continue; }
    if (!starts.has(a.g)) continue;
    if (a.m === 0) { if (open.includes(a.g)) continue; open.push(a.g); out.push(a); continue; }
    if (!open.includes(a.g)) continue;
    while (open.at(-1) !== a.g) close(open.pop());
    if (a.m === 2) open.pop();
    out.push(a);
  }
  while (open.length) close(open.pop());
  return out;
}
/** The index range [from, to] that moves with the action at i (a whole block for a start marker). */
export function blockRange(actions, i) {
  const a = actions[i];
  if (!a?.g || a.m !== 0) return [i, i];
  const end = actions.findIndex((x, j) => j > i && x.g === a.g && x.m === 2);
  return [i, end < 0 ? actions.length - 1 : end];
}
/** Moves actions[from..to] one step up (dir -1) or down (+1), jumping over a whole neighbouring block. */
export function moveStep(actions, i, dir) {
  const [from, to] = blockRange(actions, i);
  const list = actions.slice();
  if (dir < 0) {
    if (from === 0) return list;
    let j = from - 1;
    const prev = list[j];
    if (prev.g && prev.m === 2) j = list.findIndex((x) => x.g === prev.g && x.m === 0);
    const part = list.splice(from, to - from + 1);
    list.splice(j, 0, ...part);
  } else {
    if (to >= list.length - 1) return list;
    let j = to + 1;
    const next = list[j];
    if (next.g && next.m === 0) j = list.findIndex((x, k) => k > j && x.g === next.g && x.m === 2);
    const part = list.splice(from, to - from + 1);
    list.splice(j - part.length + 1, 0, ...part);
  }
  return repair(list);
}
/** Variables an action at index i can use: outputs of earlier actions and the Repeat item/index of blocks around it. */
export function varsBefore(actions, i, hasOutput) {
  const { blocks } = structure(actions);
  const out = [];
  for (let j = 0; j < i; j++) {
    const a = actions[j];
    if (a.g && a.m === 0 && (a.type === 'repeat' || a.type === 'repeat.each')) {
      const b = blocks.get(a.g);
      if (b && b.end > i) { if (a.type === 'repeat.each') out.push({ v: a.id, k: 'item' }); out.push({ v: a.id, k: 'index' }); }
      continue;
    }
    if (a.g && a.m !== 2) continue;
    if (hasOutput(a)) out.push({ v: a.id });
  }
  return out;
}
export const namesBefore = (actions, i) => [...new Set(actions.slice(0, i).filter((a) => a.type === 'var.set' && typeof a.p.name === 'string' && a.p.name.trim()).map((a) => a.p.name.trim()))];

// ——— conditions ———
export const isState = (c) => c.type === 'mode' || (c.type === 'time' && !!c.end);
export const isEvent = (c) => !isState(c) && c.type !== 'manual';
/** A routine that keeps running until something ends it (a time period or a mode), or one started by hand that undoes. */
export const hasEnd = (r) => r.conds.some(isState) || (r.undo && r.conds.some((c) => c.type === 'manual'));
export const isManual = (r) => !r.conds.length || r.conds.some((c) => c.type === 'manual');

/** Sunrise and sunset (ms) of the day around `ms`, for a place (Meeus' low-precision formulas, a few minutes off). */
export function sunTimes(ms, lat, lon) {
  const PI = Math.PI, rad = PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545, E = rad * 23.4397;
  const { sin, cos, asin, acos } = Math;
  const d0 = ms / DAY - 0.5 + J1970 - J2000;
  const lw = rad * -lon, phi = rad * lat;
  const n = Math.round(d0 - 0.0009 - lw / (2 * PI));
  const ds = 0.0009 + lw / (2 * PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)) + rad * 102.9372 + PI;
  const dec = asin(sin(L) * sin(E));
  const fromJulian = (j) => (j + 0.5 - J1970) * DAY;
  const Jnoon = 2451545 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const w = acos((sin(-0.833 * rad) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)));
  const Jset = J2000 + 0.0009 + (w + lw) / (2 * PI) + n + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  return { sunrise: fromJulian(Jnoon - (Jset - Jnoon)), sunset: fromJulian(Jset) };
}

/** The moment `sp` ('HH:MM' | 'sunrise' | 'sunset') happens on the local day starting at `day` (ms), or null. */
export function pointOn(day, sp, loc) {
  if (sp === 'sunrise' || sp === 'sunset') {
    if (loc?.lat == null || loc?.lon == null) return null;
    const v = sunTimes(day + 12 * 3600e3, loc.lat, loc.lon)[sp];
    return Number.isFinite(v) ? Math.round(v / 60e3) * 60e3 : null;
  }
  const [hh, mm] = String(sp).split(':').map(Number);
  const d = new Date(day);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
const midnight = (ms, add = 0) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); };

/** The time windows (or instants, when it has no end) of a time condition starting from the day before `from`
 *  for `span` days: [{ start, end }] (end null for an instant; an end at or before the start is the next day). */
export function windows(c, from, loc, span = 9) {
  const out = [];
  for (let i = -1; i < span; i++) {
    const day = midnight(from, i);
    if (!c.days.includes(new Date(day).getDay())) continue;
    const start = pointOn(day, c.start, loc);
    if (start == null) continue;
    let end = null;
    if (c.end) {
      end = pointOn(day, c.end, loc);
      if (end == null) continue;
      if (end <= start) end = pointOn(midnight(day, 1), c.end, loc);
      if (end == null || end <= start) continue;
    }
    out.push({ start, end });
  }
  return out;
}
/** The window of a time period that contains `now`, or null. */
export const activeWindow = (c, now, loc) => (c.type === 'time' && c.end ? windows(c, now, loc, 2).find((w) => w.start <= now && now < w.end) || null : null);

/** Whether a state condition holds now. env = { now, loc, mode: id of the mode that is on (or null) }. */
export function stateActive(c, env) {
  if (c.type === 'mode') return !!env.mode && (!c.mode || c.mode === env.mode);
  if (c.type === 'time' && c.end) return !!activeWindow(c, env.now, env.loc);
  return false;
}
/** What the state conditions of a routine say now: { on } starts it, { hold: false } ends a routine they started.
 *  null when it has no state conditions. With "all", an event among the conditions must start it (on stays false). */
export function verdict(r, env) {
  const states = r.conds.filter(isState);
  if (!states.length) return null;
  const act = states.map((c) => stateActive(c, env));
  if (r.match === 'all') { const all = act.every(Boolean); return { on: all && !r.conds.some(isEvent), hold: all }; }
  const any = act.some(Boolean);
  return { on: any, hold: any };
}
/** True when an event condition matches an event: { type: 'newtab' | 'startup' | 'unlock' } | { type: 'idle', away (minutes) }
 *  | { type: 'site', url, prev }. Moving around inside a site doesn't count as opening it again. */
export function eventMatches(c, ev) {
  if (c.type !== ev.type) return false;
  if (c.type === 'idle') return ev.away >= c.away;
  if (c.type === 'site') return siteMatch(c.hosts, ev.url) && !(ev.prev && siteMatch(c.hosts, ev.prev));
  return c.type === 'newtab' || c.type === 'startup' || c.type === 'unlock';
}
/** Routines whose instant time condition ("At 7:00", no end) happened in (since, now]. */
export function dueInstants(data, since, now, loc) {
  const out = [];
  for (const r of data.list) {
    if (!r.on) continue;
    if (r.conds.some((c) => c.type === 'time' && !c.end && windows(c, since, loc, 3).some((w) => w.start > since && w.start <= now && now - w.start < LATE))) out.push(r.id);
  }
  return out;
}
/** Whether an automatic mode's schedule holds now: the window, or null. */
export function modeWindow(m, now, loc) {
  if (!m.autoOn) return null;
  for (const c of m.auto) { const w = activeWindow(c, now, loc); if (w) return w; }
  return null;
}
/** The next moment anything time-based changes (a routine's time, a mode's schedule, a mode's "until"), or null. */
export function nextEdge(data, run, from, loc) {
  let best = Infinity;
  const consider = (ms) => { if (ms != null && ms > from && ms < best) best = ms; };
  const scan = (c) => { if (c.type !== 'time') return; for (const w of windows(c, from, loc)) { consider(w.start); consider(w.end); } };
  for (const r of data.list) if (r.on) r.conds.forEach(scan);
  for (const m of data.modes) if (m.autoOn) m.auto.forEach(scan);
  if (run?.mode?.until) consider(run.mode.until);
  return Number.isFinite(best) ? best : null;
}

// ——— websites ———
export function cleanHost(x) {
  return String(x || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
}
/** True when a URL is on one of the websites (subdomains included). */
export function siteMatch(hosts, url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return false; }
  return !!host && (hosts || []).some((x) => { x = cleanHost(x); return x && (host === x || host.endsWith('.' + x)); });
}

/** The action list a mode runs when it turns on (its settings first, then its own actions). */
export function modeActions(m, { until = null, now = Date.now() } = {}) {
  const A = (type, p) => ({ id: `${m.id}-${type}`, type, p });
  const list = [];
  if (m.dnd) list.push(A('focus.on', { min: String(until ? Math.max(1, Math.min(720, Math.round((until - now) / 60e3))) : 720) }));
  if (m.dark) list.push(A('theme.set', { value: m.dark === 'on' ? 'dark' : 'light' }));
  if (m.eye) list.push(A('eye.set', { value: m.eye }));
  if (m.brightness != null) list.push(A('brightness.set', { value: String(m.brightness) }));
  if (m.wallpaper) list.push(A('wallpaper.set', { preset: m.wallpaper }));
  if (m.sound) list.push(A('sound.play', { sound: m.sound }));
  return [...list, ...m.actions];
}
