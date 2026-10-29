// Runs a routine's action list (ported from Liquid Tab's Shortcuts runner): each action gets its parameters with
// variables filled in and the previous action's result as its input; If / Otherwise, Repeat and Choose from menu
// jump between their markers. No DOM and no storage of its own (everything goes through `ctx`), so pages and the
// service worker share it.
import { ACTIONS, RunError, Stop, toText, toNumber, compare, toList } from './actions.js';
import { structure } from './model.js';

const MAX_STEPS = 20000, MAX_DEPTH = 8, MAX_REPEAT = 1000;
const ENTITY = new Set(['enum', 'app', 'sound', 'wallpaper', 'mode', 'routine', 'varname', 'percent', 'sites']);
const empty = (v) => v == null || v === '' || (Array.isArray(v) && (!v.length || v.every((x) => x === '')));

/**
 * Runs `actions` and resolves with the last result. A `Stop` (Stop routine, Cancel in a question or a menu) reaches
 * the caller, which treats it as a normal finish. opts: { input, routines (for Run another routine), progress(i, n) }
 */
export function runActions(actions, ctx, { input, routines = [], progress } = {}) {
  const st = { ctx, vars: new Map(), named: new Map(), loops: new Map(), input, prev: input, count: { n: 0 }, routines, progress };
  return exec(actions, st, 0);
}

async function exec(actions, st, depth) {
  const { blocks } = structure(actions);
  const frames = new Map();
  let i = 0;
  while (i < actions.length) {
    if (st.ctx.stopped) throw new Stop(st.prev);
    if (++st.count.n > MAX_STEPS) throw new RunError('routines.err.steps');
    if (!depth) st.progress?.(i, actions.length);
    const a = actions[i], def = ACTIONS[a.type];
    if (!def) throw new RunError('routines.err.unknown');
    if (a.g && a.m != null) {
      i = await marker(a, i, def, blocks.get(a.g), actions, frames, st);
      continue;
    }
    const p = await params(def, a, st);
    let out;
    if (a.type === 'routine.run') out = await nested(p, st, depth);
    else if (a.type === 'var.set') { if (p.name) st.named.set(String(p.name).trim(), p.value); }
    else out = await def.run(st.ctx, p, { input: st.prev, action: a });
    if (def.out) { st.vars.set(a.id, out); st.prev = out; }
    i++;
  }
  if (!depth) st.progress?.(actions.length, actions.length);
  return st.prev;
}

/** Block markers: returns the index to continue at. */
async function marker(a, i, def, b, actions, frames, st) {
  const endAt = b && b.end >= 0 ? b.end : actions.length;
  if (a.type === 'if') {
    if (a.m === 0) {
      const p = await params(def, a, st);
      if (compare(p.input, p.op || 'is', p.value)) return i + 1;
      return b?.mids.length ? b.mids[0] + 1 : endAt;
    }
    if (a.m === 1) return endAt; // the true branch reached Otherwise
    st.vars.set(a.id, st.prev);
    return i + 1;
  }
  if (a.type === 'menu') {
    if (a.m === 0) {
      const p = await params(def, a, st);
      if (!st.ctx.page) throw new RunError('routines.err.page');
      const k = await st.ctx.page.menu(p.prompt, p.items);
      if (k == null) throw new Stop(st.prev);
      return b?.mids[k] != null ? b.mids[k] + 1 : endAt;
    }
    if (a.m === 1) return endAt; // the chosen item's actions are done
    st.vars.set(a.id, st.prev);
    return i + 1;
  }
  if (a.type === 'repeat' || a.type === 'repeat.each') {
    const start = actions[b?.start ?? i];
    if (a.m === 0) {
      const p = await params(def, a, st);
      const items = a.type === 'repeat.each' ? toList(p.list) : null;
      const n = items ? Math.min(items.length, MAX_REPEAT) : Math.max(0, Math.min(MAX_REPEAT, Math.floor(toNumber(p.count)) || 0));
      if (!n) {
        const end = actions[endAt];
        if (end) st.vars.set(end.id, []);
        st.prev = [];
        return endAt + 1;
      }
      frames.set(a.g, { start: i, n, idx: 1, items, results: [] });
      st.loops.set(a.id, { index: 1, item: items?.[0] });
      return i + 1;
    }
    const f = frames.get(a.g);
    if (a.m !== 2 || !f) return i + 1;
    f.results.push(st.prev);
    if (f.idx < f.n) {
      f.idx++;
      st.loops.set(start.id, { index: f.idx, item: f.items?.[f.idx - 1] });
      return f.start + 1;
    }
    frames.delete(a.g);
    st.loops.delete(start.id);
    st.vars.set(a.id, f.results);
    st.prev = f.results;
    return i + 1;
  }
  return i + 1;
}

async function nested(p, st, depth) {
  const r = st.routines.find((x) => x.id === p.routine);
  if (!r) throw new RunError('routines.err.gone');
  if (depth >= MAX_DEPTH) throw new RunError('routines.err.deep');
  const sub = { ...st, vars: new Map(), named: new Map(), loops: new Map(), input: st.prev };
  try {
    return await exec(r.actions, sub, depth + 1);
  } catch (e) {
    if (e instanceof Stop) return e.result ?? sub.prev;
    throw e;
  }
}

// ——— parameters and variables ———
async function params(def, a, st) {
  const out = {};
  for (const pd of def.params || []) out[pd.key] = await param(pd, a.p?.[pd.key], st);
  return out;
}
async function param(pd, raw, st) {
  let v = raw === undefined ? pd.def : raw;
  if (pd.type === 'bool') return v === undefined ? true : !!v;
  if (pd.type === 'items') return (Array.isArray(v) ? v : []).map((x) => toText(x));
  if (ENTITY.has(pd.type)) return v ?? '';
  if (pd.input && empty(v)) v = [{ prev: true }];
  const parts = Array.isArray(v) ? v : v == null ? [] : [v];
  let val;
  // a field holding just one variable keeps that value's own type (a list, a number…)
  if (parts.length === 1 && parts[0] && typeof parts[0] === 'object') val = await part(parts[0], st, pd);
  else val = (await Promise.all(parts.map((x) => part(x, st, pd)))).map((x) => toText(x, st.ctx.locale)).join('');
  if (pd.type === 'number') return toNumber(val);
  if (pd.type === 'text' || pd.type === 'urls') return toText(val, st.ctx.locale);
  return val; // any
}
/** One piece of a parameter: text, an action's result, a Repeat item/index, a named variable or a special one. */
async function part(x, st, pd) {
  if (x == null || typeof x !== 'object') return x;
  if (x.prev) return st.prev;
  if (x.s === 'input') return st.input;
  if (x.s === 'date') return new Date();
  if (x.s === 'ask') {
    if (!st.ctx.page) throw new RunError('routines.err.page');
    const v = await st.ctx.page.ask({ prompt: pd.label, kind: pd.type === 'number' ? 'number' : 'text', labelKey: true });
    if (v == null) throw new Stop(st.prev);
    return v;
  }
  if (x.n != null) return st.named.get(x.n);
  if (x.v) return x.k ? st.loops.get(x.v)?.[x.k] : st.vars.get(x.v);
  return '';
}
