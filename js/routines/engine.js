// The Modes and Routines engine: starts and ends routines (keeping what "Undo actions when routine ends" puts back),
// turns modes on and off, follows time periods, modes and events, and hands work that needs a page to one.
// It works the same in a page (js/routines/page.js) and in the service worker (js/bg/routines.js): the difference
// is only the ctx it gets:
//   { env: 'page' | 'sw', get(key), set(key, v), notify(title, body), schedule(name, when), cancel(name),
//     page: page helpers | null, loc(): { lat, lon } | null, lock(fn) (serialises routinesRun read-modify-write
//     between pages and the worker), pend(key, item) (worker: tell the user a page is needed), report(name, error) }
// State changes are short locked read-modify-writes of `routinesRun`; actions run outside the lock (they can wait
// for a question in a dialog).
import { KEY, RUN_KEY, norm, normRun, hasEnd, isState, stateActive, verdict, eventMatches, dueInstants, modeWindow, modeActions, LATE, PENDING_TTL } from './model.js';
import { ACTIONS, Stop, swSafe } from './actions.js';
import { runActions } from './run.js';

const MAX_NEST = 4;
const now = () => Date.now();

/** Locked read-modify-write of routinesRun: fn(run) changes it in place and returns anything. */
export async function withRun(ctx, fn) {
  const go = async () => {
    const run = normRun(await ctx.get(RUN_KEY));
    const out = await fn(run);
    await ctx.set(RUN_KEY, run);
    return out;
  };
  return ctx.lock ? ctx.lock(go) : go();
}
const prep = (ctx) => {
  ctx.engine ||= api;
  ctx.nest ||= 0;
  return ctx;
};
const data = async (ctx) => norm(await ctx.get(KEY));
const envOf = async (ctx, run) => ({ now: now(), loc: (await ctx.loc?.()) || null, mode: run.mode?.id || null });

// ——— undo ———
/** What the undoable actions of a list would change, saved before they run (the first save of each kind wins). */
export async function snapshot(ctx, actions) {
  const out = [], seen = new Set();
  for (const a of actions || []) {
    const u = ACTIONS[a.type]?.undo;
    if (!u || seen.has(u.key) || (a.g && a.m)) continue;
    seen.add(u.key);
    try { out.push({ type: a.type, v: await u.save(ctx) }); } catch (e) { console.warn('routines snapshot', a.type, e); }
  }
  return out;
}
/** Puts back what a snapshot saved, in reverse order. */
export async function restore(ctx, snaps) {
  for (const s of [...(snaps || [])].reverse()) {
    try { await ACTIONS[s.type]?.undo?.restore(ctx, s.v); } catch (e) { console.warn('routines undo', s.type, e); }
  }
}

async function runList(ctx, actions, name, routines) {
  // a child context: the routine's name for notifications, everything else (stopping too) from the caller's
  const sub = Object.create(ctx);
  sub.name = name;
  try {
    await runActions(actions, sub, { routines });
    return true;
  } catch (e) {
    if (e instanceof Stop) return true;
    await ctx.report?.(name, e);
    return false;
  }
}

const addPending = (run, key, by) => {
  run.pending = [...run.pending.filter((p) => p.key !== key && now() - p.at < PENDING_TTL), { key, at: now(), by }].slice(-20);
};

// ——— routines ———
/**
 * Starts a routine. by: 'manual' (play button, Finder, widget) | 'state' (its time period or mode began) | 'event'.
 * In the service worker a routine with page-only actions is left pending for the next page instead.
 * Resolves { ok } | { pending } | { already } | { off }.
 */
export async function startRoutine(ctx, id, { by = 'manual', fromPending = false } = {}) {
  prep(ctx);
  const d = await data(ctx);
  const r = d.list.find((x) => x.id === id);
  if (!r) return { ok: false };
  if (!r.on && by !== 'manual') return { off: true };
  const endable = hasEnd(r);
  if (!ctx.page && !swSafe(r.actions, d.list)) {
    await withRun(ctx, (run) => addPending(run, 'r:' + id, by));
    await ctx.pend?.('r:' + id, { name: r.name });
    return { pending: true };
  }
  const claimed = await withRun(ctx, (run) => {
    if (endable && run.running[id]) return false;
    // a page and the worker can both see one event (two new tabs at Chrome's start): the first claim wins
    if (!endable && by === 'event' && !fromPending && now() - (run.last[id] || 0) < 20e3) return false;
    run.last[id] = now();
    if (endable) run.running[id] = { since: now(), by, undo: [] };
    run.pending = run.pending.filter((p) => p.key !== 'r:' + id);
    if (by === 'manual') delete run.skip['r:' + id];
    return true;
  });
  if (!claimed) return { already: true };
  if (r.undo && endable) {
    const undo = await snapshot(ctx, r.actions);
    await withRun(ctx, (run) => { if (run.running[id]) run.running[id].undo = undo; });
  }
  const ok = await runList(ctx, r.actions, r.name, d.list);
  return { ok, running: endable };
}

/** Ends a running routine and undoes its actions. by 'manual' while its time still holds keeps it off until then. */
export async function endRoutine(ctx, id, { by = 'manual' } = {}) {
  prep(ctx);
  const d = await data(ctx);
  const r = d.list.find((x) => x.id === id);
  const cur = await withRun(ctx, async (run) => {
    const c = run.running[id];
    if (!c) return null;
    delete run.running[id];
    if (by === 'manual' && r && verdict(r, await envOf(ctx, run))?.hold) run.skip['r:' + id] = true;
    return c;
  });
  if (cur?.undo?.length) await restore(ctx, cur.undo);
  return !!cur;
}

// ——— modes ———
/** Turns a mode on (turning off the one that is on). until: ms or null (until turned off). */
export async function modeOn(ctx, id, { until = null, by = 'manual' } = {}) {
  prep(ctx);
  const d = await data(ctx);
  const m = d.modes.find((x) => x.id === id);
  if (!m) return false;
  const cur = normRun(await ctx.get(RUN_KEY)).mode;
  if (cur?.id === id) {
    await withRun(ctx, (run) => { if (run.mode?.id === id) Object.assign(run.mode, { until, by: by === 'routine' ? run.mode.by : by }); });
    return true;
  }
  if (cur) await modeOff(ctx, { by: 'switch' });
  const all = modeActions(m, { until });
  const page = !!ctx.page;
  const now1 = page ? all : all.filter((a) => swSafe([a], d.list));
  const later = page ? [] : all.filter((a) => !swSafe([a], d.list));
  const undo = await snapshot(ctx, now1);
  await withRun(ctx, (run) => {
    run.mode = { id, since: now(), until, by, undo };
    run.lastMode = id;
    delete run.skip['m:' + id];
    if (later.length) addPending(run, 'm:' + id, by);
  });
  if (later.length) await ctx.pend?.('m:' + id, { mode: id });
  await runList(ctx, now1, m.name, d.list);
  if (ctx.nest < MAX_NEST) await reconcileRoutines(ctx);
  return true;
}

/** Runs the part of the mode that is on that needed a page (its sound, its own actions) in this page. */
export async function modePagePart(ctx, id) {
  prep(ctx);
  const d = await data(ctx);
  const m = d.modes.find((x) => x.id === id);
  const run = normRun(await ctx.get(RUN_KEY));
  if (!m || run.mode?.id !== id || !ctx.page) return false;
  const later = modeActions(m, { until: run.mode.until }).filter((a) => !swSafe([a], d.list));
  const undo = await snapshot(ctx, later);
  await withRun(ctx, (r2) => { if (r2.mode?.id === id) r2.mode.undo = [...r2.mode.undo, ...undo]; });
  return runList(ctx, later, m.name, d.list);
}

/** Turns off the mode that is on and puts back what it changed. by: 'manual' | 'until' | 'auto' | 'switch' | 'routine'. */
export async function modeOff(ctx, { by = 'manual' } = {}) {
  prep(ctx);
  const d = await data(ctx);
  const cur = await withRun(ctx, async (run) => {
    const m = run.mode;
    if (!m) return null;
    run.mode = null;
    run.pending = run.pending.filter((p) => p.key !== 'm:' + m.id);
    // turned off by hand during its schedule: stay off until the schedule ends
    const mode = d.modes.find((x) => x.id === m.id);
    if ((by === 'manual' || by === 'switch') && mode && modeWindow(mode, now(), (await ctx.loc?.()) || null)) run.skip['m:' + m.id] = true;
    return m;
  });
  if (!cur) return false;
  await restore(ctx, cur.undo);
  if (by !== 'switch' && ctx.nest < MAX_NEST) await reconcileRoutines(ctx);
  return true;
}

// ——— following time, modes and events ———
/** Starts and ends routines whose time periods or mode conditions changed. */
export async function reconcileRoutines(ctx) {
  prep(ctx);
  ctx.nest++;
  try {
    const d = await data(ctx);
    for (const r of d.list) {
      const run = normRun(await ctx.get(RUN_KEY));
      const v = verdict(r, await envOf(ctx, run));
      if (!v) continue;
      const cur = run.running[r.id];
      if (!v.hold) {
        if (run.skip['r:' + r.id]) await withRun(ctx, (x) => { delete x.skip['r:' + r.id]; });
        if (cur && cur.by !== 'manual') await endRoutine(ctx, r.id, { by: 'state' });
        continue;
      }
      if (v.on && !cur && r.on && !run.skip['r:' + r.id] && !run.pending.some((p) => p.key === 'r:' + r.id)) await startRoutine(ctx, r.id, { by: 'state' });
    }
  } finally {
    ctx.nest--;
  }
}

/** Turns scheduled modes on and off, ends a mode whose time is up. */
export async function reconcileModes(ctx) {
  prep(ctx);
  const d = await data(ctx);
  const loc = (await ctx.loc?.()) || null;
  let run = normRun(await ctx.get(RUN_KEY));
  if (run.mode?.until && run.mode.until <= now() + 1000) await modeOff(ctx, { by: 'until' });
  for (const m of d.modes) {
    run = normRun(await ctx.get(RUN_KEY));
    const w = modeWindow(m, now(), loc);
    if (!w) {
      if (run.skip['m:' + m.id]) await withRun(ctx, (x) => { delete x.skip['m:' + m.id]; });
      if (run.mode?.id === m.id && run.mode.by === 'auto') await modeOff(ctx, { by: 'auto' });
      continue;
    }
    if (run.mode?.id === m.id || run.skip['m:' + m.id]) continue;
    // a schedule doesn't replace a mode the user turned on by hand
    if (!run.mode || run.mode.by === 'auto') await modeOn(ctx, m.id, { until: w.end, by: 'auto' });
  }
}

/** Everything time-based: instant times that passed since the last tick, schedules, periods. */
export async function tick(ctx) {
  prep(ctx);
  const t = now();
  const since = await withRun(ctx, (run) => { const s = run.tickAt || t - 60e3; run.tickAt = t; return s; });
  const d = await data(ctx);
  const loc = (await ctx.loc?.()) || null;
  for (const id of dueInstants(d, Math.max(since, t - LATE), t, loc)) {
    const r = d.list.find((x) => x.id === id);
    const run = normRun(await ctx.get(RUN_KEY));
    if (r.match === 'all' && !r.conds.filter(isState).every((c) => stateActive(c, { now: t, loc, mode: run.mode?.id || null }))) continue;
    await startRoutine(ctx, id, { by: 'event' });
  }
  await reconcileModes(ctx);
  await reconcileRoutines(ctx);
}

/** An event happened: { type: 'newtab' | 'startup' | 'unlock' } | { type: 'idle', away } | { type: 'site', url, prev }. */
export async function fire(ctx, ev) {
  prep(ctx);
  const d = await data(ctx);
  const started = [];
  for (const r of d.list) {
    if (!r.on || !r.conds.some((c) => eventMatches(c, ev))) continue;
    const env = await envOf(ctx, normRun(await ctx.get(RUN_KEY)));
    if (r.match === 'all' && !r.conds.filter(isState).every((c) => stateActive(c, env))) continue;
    const res = await startRoutine(ctx, r.id, { by: 'event' });
    if (res.ok || res.pending) started.push(r.id);
  }
  return started;
}

/** Takes the work left for a page (fresh entries only) out of routinesRun. */
export async function takePending(ctx) {
  return withRun(ctx, (run) => {
    const list = run.pending.filter((p) => now() - p.at < PENDING_TTL);
    run.pending = [];
    return list;
  });
}
/** Runs what the service worker left for a page. */
export async function runPending(ctx, list) {
  prep(ctx);
  for (const p of list) {
    const [kind, id] = [p.key.slice(0, 1), p.key.slice(2)];
    if (kind === 'r') await startRoutine(ctx, id, { by: p.by || 'event', fromPending: true });
    else if (kind === 'm') await modePagePart(ctx, id);
  }
}

export const api = { startRoutine, endRoutine, modeOn, modeOff, modePagePart, reconcileRoutines, reconcileModes, tick, fire, takePending, runPending, withRun, snapshot, restore };
