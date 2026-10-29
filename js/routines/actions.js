// The action registry of Modes and Routines ("Then"): every action's parameters, how it runs and how it is undone when
// a routine ends. Other apps add their own with registerAction() from their js/apps/<id>.js:
//
//   import { registerAction } from '../routines/actions.js';
//   registerAction({ id: 'health.water', name: 'health.logWater', icon: 'drop', color: '#2aa7d8', cat: 'apps',
//     params: [{ key: 'ml', type: 'number', def: '250', label: 'health.amount' }],
//     run: async (ctx, p) => (await import('../health/data.js')).logWater(p.ml) });
//
// def = { id, name (i18n key), icon (icon name), color, cat ('modes' | 'display' | 'focus' | 'sound' | 'apps' | 'tabs' |
//   'advanced'), desc? (i18n key), params: [Param], out? (i18n key: the name of its result, usable as a variable),
//   sw? (true / fn(action) → bool: it can run in the service worker with storage alone), perm? (['tabs']: optional
//   permissions it needs), undo? ({ key, save(ctx) → value, restore(ctx, value) }), sub?(p, F) → summary text,
//   mid?, end? (block actions: i18n keys of the middle and end markers), run(ctx, p, x) → result }
// Param = { key, type: 'text' | 'number' | 'bool' | 'any' | 'enum' | 'percent' | 'app' | 'sound' | 'wallpaper' | 'mode' |
//   'routine' | 'urls' | 'sites' | 'items' | 'varname', label (i18n key), def?, opts? ([[value, i18n key]]), ph?, input?
//   (left empty = the previous action's result), min?, max? }
// ctx (js/routines/page.js or js/bg/routines.js): { env: 'page' | 'sw', get(key), set(key, v), notify(title, body),
//   schedule(name, when), cancel(name), page: page helpers or null, engine, locale, stopped, onStop(fn) }
// Pure module: no DOM and no page imports, because the service worker imports it too.
import { addStrings } from '../core/i18n.js';
import { KEY, RUN_KEY, normRun, siteMatch, cleanHost, uid } from './model.js';

export const ACTIONS = {};
const listeners = new Set();
/** Adds (or replaces) an action. Actions from other apps run in a page unless they say `sw: true`. */
export function registerAction(def) {
  if (!def?.id || typeof def.run !== 'function') throw new Error('registerAction: id and run() are required');
  ACTIONS[def.id] = { cat: 'apps', icon: 'sparkle', color: '#8a8d96', params: [], sw: false, ...def };
  listeners.forEach((fn) => fn(def.id));
  return ACTIONS[def.id];
}
export const onActions = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const CATS = ['modes', 'display', 'focus', 'sound', 'apps', 'tabs', 'advanced'];

// ——— values ———
/** An error the user can read: `key` is an i18n key (pages translate it, the service worker has its own copy). */
export class RunError extends Error { constructor(key, vars) { super(key); this.key = key; this.vars = vars; } }
/** Stops the run as a normal finish (Stop routine, Cancel in a question or a menu). */
export class Stop extends Error { constructor(result) { super('stop'); this.result = result; } }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776);
const clean = (n) => (Number.isFinite(n) ? +n.toPrecision(12) : n);
export function toText(v, loc) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(clean(v)) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return isNaN(v) ? '' : new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' }).format(v);
  if (Array.isArray(v)) return v.map((x) => toText(x, loc)).join('\n');
  if (isObj(v) && 'text' in v) return String(v.text);
  try { return JSON.stringify(v); } catch { return String(v); }
}
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = latin(toText(v)).trim().replace(/[\s']/g, '').replace(/٫/g, '.').replace(/(\d),(\d{1,2})$/, '$1.$2').replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
export const toList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : typeof v === 'string' ? v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [v]);
export const IF_OPS = [['is', 'routines.op.is'], ['isnot', 'routines.op.isnot'], ['contains', 'routines.op.contains'], ['notcontains', 'routines.op.notcontains'],
  ['begins', 'routines.op.begins'], ['gt', 'routines.op.gt'], ['lt', 'routines.op.lt'], ['any', 'routines.op.any'], ['none', 'routines.op.none']];
export const NO_VALUE_OPS = ['any', 'none'];
/** If's test: numbers compare as numbers, everything else as text without case. */
export function compare(a, op, b) {
  const empty = a == null || a === '' || (Array.isArray(a) && !a.length);
  if (op === 'any') return !empty;
  if (op === 'none') return empty;
  const A = toText(a).trim(), B = toText(b).trim();
  const numeric = (x) => typeof x === 'number' || x instanceof Date || /^[-+]?[\d٠-٩.,]+$/.test(toText(x).trim());
  if (op === 'gt' || op === 'lt' || ((op === 'is' || op === 'isnot') && numeric(a) && numeric(b) && A && B)) {
    const x = toNumber(a), y = toNumber(b);
    return { gt: x > y, lt: x < y, is: x === y, isnot: x !== y }[op];
  }
  const al = A.toLocaleLowerCase(), bl = B.toLocaleLowerCase();
  return { is: al === bl, isnot: al !== bl, contains: al.includes(bl), notcontains: !al.includes(bl), begins: al.startsWith(bl) }[op] ?? false;
}
const normUrl = (u) => { u = String(u || '').trim(); if (!u) return ''; if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const need = (cond, key, vars) => { if (!cond) throw new RunError(key, vars); };
const pageOnly = (ctx) => { need(ctx.page, 'routines.err.page'); return ctx.page; };
const tabsApi = () => globalThis.chrome?.tabs;
const hasPerm = async (p) => !!(await globalThis.chrome?.permissions?.contains({ permissions: [p] }).catch(() => false));

// ——— shared writers (page and service worker) ———
const SETTINGS = { theme: 'auto', eyeComfort: false, eyeComfortLevel: 40, brightness: 100, wallpaper: { type: 'preset', id: 'bloom' } };
const readSettings = async (ctx) => ({ ...SETTINGS, ...((await ctx.get('settings')) || {}) });
async function patchSettings(ctx, patch) {
  if (ctx.page) return ctx.page.setSettings(patch);
  await ctx.set('settings', { ...((await ctx.get('settings')) || {}), ...patch });
}
// endsAt null = Focus "Until I turn it off" (Quick Panel)
const focusIsOn = async (ctx) => { const f = await ctx.get('focus'); return !!(f && (f.endsAt == null ? f.startedAt : f.endsAt > Date.now())); };
async function focusOn(ctx, min) {
  min = Math.max(1, Math.min(720, Math.round(min) || 25));
  if (ctx.page) return ctx.page.startFocus(min);
  const now = Date.now(), endsAt = now + min * 60e3;
  await ctx.set('focus', { startedAt: now, endsAt, minutes: min });
  ctx.schedule('focus', endsAt);
}
async function focusOff(ctx) {
  if (ctx.page) return ctx.page.stopFocus();
  const f = await ctx.get('focus');
  // the Quick Panel logs stopped sessions for Daily activity; do the same when the service worker stops one
  if (f?.startedAt) {
    const end = Math.min(Date.now(), f.endsAt || Date.now()), log = (await ctx.get('focusLog')) || [];
    if (end - f.startedAt >= 60e3 && !log.some((x) => x.start === f.startedAt)) await ctx.set('focusLog', [{ start: f.startedAt, end }, ...log].slice(0, 400));
  }
  await ctx.set('focus', null);
  ctx.cancel('focus');
}
/** Stops the ambient sound: in a page directly, from the service worker by telling every open page. */
async function soundStop(ctx) {
  if (ctx.page) return ctx.page.stopSound();
  const run = (await ctx.get(RUN_KEY)) || {};
  await ctx.set(RUN_KEY, { ...run, cmd: { sound: 'stop', at: Date.now() } });
}

// ——— parameter shorthands ———
const P = (key, type, label, o = {}) => ({ key, type, label, ...o });
const ONOFF = [['on', 'common.on'], ['off', 'common.off'], ['toggle', 'routines.v.toggle']];
const THEMES = [['dark', 'routines.v.dark'], ['light', 'routines.v.light'], ['auto', 'routines.v.auto'], ['toggle', 'routines.v.toggle']];

// ——— Modes ———
registerAction({
  id: 'mode.on', name: 'routines.a.modeOn', icon: 'rtModes', color: '#14b8a6', cat: 'modes', sw: true,
  params: [P('mode', 'mode', 'routines.p.mode', { def: 'sleep' })], sub: (p, F) => F.mode(p.mode),
  undo: { key: 'mode', save: async (ctx) => normRun(await ctx.get(RUN_KEY)).mode?.id || '', restore: async (ctx, prev) => { if (!prev) await ctx.engine.modeOff(ctx, { by: 'routine' }); else await ctx.engine.modeOn(ctx, prev, { by: 'routine' }); } },
  run: (ctx, p) => ctx.engine.modeOn(ctx, p.mode, { by: 'routine' }),
});
registerAction({ id: 'mode.off', name: 'routines.a.modeOff', icon: 'rtModes', color: '#14b8a6', cat: 'modes', sw: true, params: [], run: (ctx) => ctx.engine.modeOff(ctx, { by: 'routine' }) });

// ——— Display ———
registerAction({
  id: 'theme.set', name: 'routines.a.theme', icon: 'moon', color: '#5b5fc7', cat: 'display', sw: true,
  params: [P('value', 'enum', 'routines.p.mode2', { opts: THEMES, def: 'dark' })], sub: (p, F) => F.opt('theme.set', 'value', p.value),
  undo: { key: 'theme', save: async (ctx) => (await readSettings(ctx)).theme, restore: (ctx, v) => patchSettings(ctx, { theme: v }) },
  async run(ctx, p) {
    let v = p.value || 'dark';
    if (v === 'toggle') v = (ctx.page ? ctx.page.isDark() : (await readSettings(ctx)).theme === 'dark') ? 'light' : 'dark';
    await patchSettings(ctx, { theme: v });
  },
});
registerAction({
  id: 'eye.set', name: 'routines.a.eye', icon: 'eyeComfort', color: '#f5a524', cat: 'display', sw: true,
  params: [P('value', 'enum', 'routines.p.state', { opts: ONOFF, def: 'on' }), P('level', 'percent', 'routines.p.level', { def: '40', min: 0, max: 100, when: (p) => p.value !== 'off' })],
  sub: (p, F) => F.opt('eye.set', 'value', p.value),
  undo: { key: 'eye', save: async (ctx) => { const s = await readSettings(ctx); return { eyeComfort: !!s.eyeComfort, eyeComfortLevel: s.eyeComfortLevel }; }, restore: (ctx, v) => patchSettings(ctx, v) },
  async run(ctx, p) {
    const s = await readSettings(ctx);
    const on = p.value === 'toggle' ? !s.eyeComfort : p.value !== 'off';
    await patchSettings(ctx, on && p.level !== '' && p.level != null ? { eyeComfort: true, eyeComfortLevel: Math.max(0, Math.min(100, Math.round(toNumber(p.level)))) } : { eyeComfort: on });
  },
});
registerAction({
  id: 'brightness.set', name: 'routines.a.brightness', icon: 'brightness', color: '#f5a524', cat: 'display', sw: true,
  params: [P('value', 'percent', 'routines.p.level', { def: '70', min: 30, max: 100 })], sub: (p) => `⁦${Math.round(toNumber(p.value ?? 70))}%⁩`,
  undo: { key: 'brightness', save: async (ctx) => (await readSettings(ctx)).brightness, restore: (ctx, v) => patchSettings(ctx, { brightness: v }) },
  run: (ctx, p) => patchSettings(ctx, { brightness: Math.max(30, Math.min(100, Math.round(toNumber(p.value)) || 100)) }),
});
registerAction({
  id: 'wallpaper.set', name: 'routines.a.wallpaper', icon: 'image', color: '#2aa7d8', cat: 'display', sw: true,
  params: [P('preset', 'wallpaper', 'routines.p.wallpaper', { def: 'aurora' })], sub: (p, F) => F.wall(p.preset),
  undo: { key: 'wallpaper', save: async (ctx) => (await readSettings(ctx)).wallpaper, restore: (ctx, v) => patchSettings(ctx, { wallpaper: v }) },
  run: (ctx, p) => patchSettings(ctx, { wallpaper: { type: 'preset', id: p.preset || 'bloom' } }),
});
registerAction({ id: 'lock', name: 'routines.a.lock', icon: 'lock', color: '#5d6070', cat: 'display', params: [], run: (ctx) => pageOnly(ctx).lock() });

// ——— Focus (Do not disturb) and notifications ———
registerAction({
  id: 'focus.on', name: 'routines.a.focusOn', icon: 'dnd', color: '#8a5cf6', cat: 'focus', sw: true,
  params: [P('min', 'number', 'routines.p.minutes', { def: '25' })], sub: (p, F) => F.t('routines.v.min', { n: Math.round(toNumber(p.min ?? 25)) }),
  undo: { key: 'focus', save: (ctx) => focusIsOn(ctx), restore: async (ctx, was) => { if (!was) await focusOff(ctx); } },
  run: (ctx, p) => focusOn(ctx, toNumber(p.min)),
});
registerAction({ id: 'focus.off', name: 'routines.a.focusOff', icon: 'dnd', color: '#8a5cf6', cat: 'focus', sw: true, params: [], run: (ctx) => focusOff(ctx) });
registerAction({
  id: 'notify', name: 'routines.a.notify', icon: 'bell', color: '#f2556b', cat: 'focus', sw: true,
  params: [P('title', 'text', 'routines.p.title', { ph: 'routines.p.title' }), P('text', 'text', 'routines.p.message', { input: true, ph: 'routines.p.message' })],
  sub: (p, F) => F.text(p.text) || F.text(p.title),
  run: (ctx, p) => ctx.notify(p.title || ctx.name || '', p.text),
});
registerAction({ id: 'toast', name: 'routines.a.toast', icon: 'rtToast', color: '#f2556b', cat: 'focus', params: [P('text', 'text', 'routines.p.message', { input: true })], sub: (p, F) => F.text(p.text), run: (ctx, p) => pageOnly(ctx).toast(p.text) });
registerAction({
  id: 'alert', name: 'routines.a.alert', icon: 'rtMessage', color: '#f2556b', cat: 'focus', out: 'routines.out.alert',
  params: [P('title', 'text', 'routines.p.title'), P('text', 'text', 'routines.p.message', { input: true }), P('cancel', 'bool', 'routines.p.cancel', { def: true })],
  sub: (p, F) => F.text(p.text) || F.text(p.title),
  async run(ctx, p, x) { if (!(await pageOnly(ctx).alert({ title: p.title, text: p.text, cancel: p.cancel !== false }))) throw new Stop(x.input); return x.input; },
});

// ——— Sound ———
registerAction({
  id: 'sound.play', name: 'routines.a.soundPlay', icon: 'music', color: '#ff7a45', cat: 'sound',
  params: [P('sound', 'sound', 'routines.p.sound', { def: 'rain' })], sub: (p, F) => F.sound(p.sound),
  undo: {
    key: 'sound', save: (ctx) => (ctx.page ? ctx.page.soundState() : null),
    async restore(ctx, prev) { if (prev?.playing && ctx.page) ctx.page.sound(prev.id); else await soundStop(ctx); },
  },
  run: (ctx, p) => pageOnly(ctx).sound(p.sound || 'rain'),
});
registerAction({ id: 'sound.stop', name: 'routines.a.soundStop', icon: 'mute', color: '#ff7a45', cat: 'sound', sw: true, params: [], run: (ctx) => soundStop(ctx) });

// ——— Apps ———
registerAction({ id: 'app.open', name: 'routines.a.app', icon: 'apps', color: '#3e7bff', cat: 'apps', params: [P('app', 'app', 'routines.p.app', { def: 'notes' })], sub: (p, F) => F.app(p.app), run: (ctx, p) => pageOnly(ctx).openApp(p.app) });
registerAction({
  id: 'url.open', name: 'routines.a.urls', icon: 'globe', color: '#3e7bff', cat: 'apps', sw: true,
  params: [P('urls', 'urls', 'routines.p.urls', { input: true, ph: 'routines.p.urlsPh' })], sub: (p, F) => toList(F.text(p.urls)).map(cleanHost).join(', '),
  async run(ctx, p) {
    const urls = toList(p.urls).map(normUrl).filter(Boolean);
    need(urls.length, 'routines.err.url', { text: toText(p.urls) });
    for (const [i, url] of urls.entries()) {
      if (tabsApi()) await tabsApi().create({ url, active: i === 0 });
      else globalThis.open?.(url, '_blank');
    }
  },
});
registerAction({
  id: 'note.new', name: 'routines.a.note', icon: 'note', color: '#ff8a3d', cat: 'apps', sw: true, out: 'routines.out.note',
  params: [P('text', 'text', 'routines.p.noteText', { input: true, ph: 'routines.p.noteText' })], sub: (p, F) => F.text(p.text),
  async run(ctx, p) {
    const text = String(p.text || '').trim();
    need(text, 'routines.err.empty');
    const [title, ...rest] = text.split('\n');
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const body = rest.map((l) => `<div>${esc(l) || '<br>'}</div>`).join('');
    if (ctx.page) {
      await ctx.page.note({ title: title.slice(0, 120), body });
      return text;
    }
    const now = Date.now();
    await ctx.set('notes', [{ id: uid(), title: title.slice(0, 120), body, color: 'none', pinned: false, created: now, updated: now }, ...((await ctx.get('notes')) || [])]);
    return text;
  },
});
registerAction({
  id: 'reminder.add', name: 'routines.a.reminder', icon: 'checkCircle', color: '#3e7bff', cat: 'apps', sw: true, out: 'routines.out.reminder',
  params: [P('title', 'text', 'routines.p.remTitle', { input: true, ph: 'routines.p.remTitle' }), P('in', 'number', 'routines.p.remIn', { def: '' })],
  sub: (p, F) => F.text(p.title),
  async run(ctx, p) {
    const title = String(p.title || '').trim();
    need(title, 'routines.err.empty');
    const mins = toNumber(p.in);
    const due = mins > 0 ? Date.now() + mins * 60e3 : null;
    if (ctx.page) return (await ctx.page.reminder(title, due))?.title || title;
    const r = { id: uid(), title, notes: '', due, done: false, priority: false, created: Date.now(), completedAt: null };
    await ctx.set('reminders', [r, ...((await ctx.get('reminders')) || [])]);
    if (due) ctx.schedule('reminder:' + r.id, due);
    return title;
  },
});
registerAction({
  id: 'timer.start', name: 'routines.a.timer', icon: 'timer', color: '#ff7a45', cat: 'apps', sw: true,
  params: [P('min', 'number', 'routines.p.minutes', { def: '5' }), P('label', 'text', 'routines.p.label', { ph: 'routines.p.label' })],
  sub: (p, F) => F.t('routines.v.min', { n: clean(toNumber(p.min ?? 5)) }) + (F.text(p.label) ? ' · ' + F.text(p.label) : ''),
  async run(ctx, p) {
    const ms = Math.round(toNumber(p.min) * 60e3);
    need(ms >= 1000, 'routines.err.duration');
    // the same timer shape and alarm as Finder's "timer 5m" and the Clock app
    const id = uid(), endsAt = Date.now() + ms;
    await ctx.set('timers', [...((await ctx.get('timers')) || []), { id, label: p.label || '', duration: ms, endsAt, remaining: ms, running: true }]);
    ctx.schedule('timer:' + id, endsAt);
  },
});

// ——— Chrome tabs (optional permissions) ———
registerAction({
  id: 'tabs.close', name: 'routines.a.tabsClose', icon: 'rtTabsClose', color: '#5d6070', cat: 'tabs', sw: true, perm: ['tabs'], out: 'routines.out.count',
  params: [P('sites', 'sites', 'routines.p.sites', { ph: 'routines.p.sitesPh' })], sub: (p, F) => toList(F.text(p.sites)).map(cleanHost).join(', '),
  async run(ctx, p) {
    need(tabsApi() && (await hasPerm('tabs')), 'routines.err.tabs');
    const hosts = toList(String(p.sites || '').replace(/[\s,]+/g, '\n'));
    const ids = (await tabsApi().query({})).filter((x) => siteMatch(hosts, x.url || '')).map((x) => x.id);
    if (ids.length) await tabsApi().remove(ids);
    return ids.length;
  },
});
registerAction({
  id: 'tabs.mute', name: 'routines.a.tabsMute', icon: 'mute', color: '#5d6070', cat: 'tabs', sw: true,
  params: [P('value', 'enum', 'routines.p.state', { opts: [['mute', 'routines.v.mute'], ['unmute', 'routines.v.unmute']], def: 'mute' })], sub: (p, F) => F.opt('tabs.mute', 'value', p.value),
  async run(ctx, p) {
    need(tabsApi(), 'routines.err.tabs');
    const mute = p.value !== 'unmute';
    const list = await tabsApi().query(mute ? { audible: true } : { muted: true });
    for (const tb of list) await tabsApi().update(tb.id, { muted: mute }).catch(() => {});
  },
});
registerAction({
  id: 'tabs.group', name: 'routines.a.tabsGroup', icon: 'rtTabsGroup', color: '#5d6070', cat: 'tabs', sw: true, perm: ['tabs', 'tabGroups'],
  params: [],
  async run() {
    need(tabsApi() && globalThis.chrome?.tabGroups && (await hasPerm('tabs')) && (await hasPerm('tabGroups')), 'routines.err.tabs');
    const by = new Map();
    for (const tb of await tabsApi().query({ currentWindow: true, pinned: false })) {
      let host = '';
      try { host = new URL(tb.url).hostname.replace(/^www\./, ''); } catch {}
      if (!host || !/^https?:/.test(tb.url)) continue;
      by.set(host, [...(by.get(host) || []), tb]);
    }
    for (const [host, list] of by) {
      if (list.length < 2) continue;
      const g = await tabsApi().group({ tabIds: list.map((x) => x.id) });
      await globalThis.chrome.tabGroups.update(g, { title: host.split('.').slice(-2, -1)[0] || host }).catch(() => {});
    }
  },
});
registerAction({
  id: 'tabs.discard', name: 'routines.a.tabsSleep', icon: 'rtTabsSleep', color: '#5d6070', cat: 'tabs', sw: true, out: 'routines.out.count', params: [],
  async run() {
    need(tabsApi(), 'routines.err.tabs');
    let n = 0;
    for (const tb of await tabsApi().query({ active: false, discarded: false, audible: false, pinned: false })) {
      try { await tabsApi().discard(tb.id); n++; } catch {}
    }
    return n;
  },
});

// ——— Advanced (Liquid Tab's scripting: variables, If, Repeat, menus, questions) ———
registerAction({ id: 'wait', name: 'routines.a.wait', icon: 'rtWait', color: '#8a8d96', cat: 'advanced', params: [P('sec', 'number', 'routines.p.seconds', { def: '5' })],
  sub: (p, F) => F.t('routines.v.sec', { n: clean(toNumber(p.sec ?? 5)) }),
  // the service worker can be stopped while it waits, so long waits run in a page
  sw: (a) => !Array.isArray(a.p.sec) && toNumber(a.p.sec ?? 5) <= 20,
  run: (ctx, p) => new Promise((res, rej) => { const tm = setTimeout(res, Math.max(0, Math.min(3600, toNumber(p.sec))) * 1000); ctx.onStop?.(() => { clearTimeout(tm); rej(new Stop()); }); }),
});
const ASK_KINDS = [['text', 'routines.v.text'], ['number', 'routines.v.number'], ['url', 'routines.v.url']];
registerAction({
  id: 'ask', name: 'routines.a.ask', icon: 'keyboard', color: '#8a8d96', cat: 'advanced', out: 'routines.out.ask',
  params: [P('prompt', 'text', 'routines.p.question', { ph: 'routines.p.question' }), P('kind', 'enum', 'routines.p.kind', { opts: ASK_KINDS, def: 'text' }), P('def', 'text', 'routines.p.default')],
  sub: (p, F) => F.text(p.prompt),
  async run(ctx, p, x) {
    const v = await pageOnly(ctx).ask({ prompt: p.prompt, kind: p.kind, value: p.def });
    if (v == null) throw new Stop(x.input);
    return p.kind === 'number' ? toNumber(v) : p.kind === 'url' ? normUrl(v) || v : v;
  },
});
registerAction({
  id: 'menu', name: 'routines.a.menu', icon: 'list', color: '#8a8d96', cat: 'advanced', out: 'routines.out.menu', end: 'routines.a.menuEnd',
  params: [P('prompt', 'text', 'routines.p.question'), P('items', 'items', 'routines.p.items', { def: ['', ''] })], sub: (p, F) => F.text(p.prompt),
  run: () => undefined,
});
registerAction({
  id: 'if', name: 'routines.a.if', icon: 'rtBranch', color: '#8a8d96', cat: 'advanced', out: 'routines.out.if', sw: true, mid: 'routines.a.otherwise', end: 'routines.a.endIf',
  params: [P('input', 'any', 'routines.p.input', { input: true }), P('op', 'enum', 'routines.p.condition', { opts: IF_OPS, def: 'is' }), P('value', 'text', 'routines.p.value', { when: (p) => !NO_VALUE_OPS.includes(p.op) })],
  sub: (p, F) => [F.text(p.input) || F.t('routines.v.prev'), F.opt('if', 'op', p.op || 'is'), NO_VALUE_OPS.includes(p.op) ? '' : F.text(p.value)].filter(Boolean).join(' '),
  run: () => undefined,
});
registerAction({ id: 'repeat', name: 'routines.a.repeat', icon: 'rtRepeat', color: '#8a8d96', cat: 'advanced', out: 'routines.out.repeat', sw: true, end: 'routines.a.endRepeat',
  params: [P('count', 'number', 'routines.p.times', { def: '3' })], sub: (p, F) => F.t('routines.v.times', { n: clean(toNumber(p.count ?? 3)) }), run: () => undefined });
registerAction({ id: 'repeat.each', name: 'routines.a.repeatEach', icon: 'rtRepeat', color: '#8a8d96', cat: 'advanced', out: 'routines.out.repeat', sw: true, end: 'routines.a.endRepeat',
  params: [P('list', 'any', 'routines.p.items', { input: true })], sub: (p, F) => F.text(p.list), run: () => undefined });
registerAction({ id: 'var.set', name: 'routines.a.varSet', icon: 'rtVar', color: '#f5a524', cat: 'advanced', sw: true,
  params: [P('name', 'varname', 'routines.p.varName', { ph: 'routines.p.varName' }), P('value', 'any', 'routines.p.value', { input: true })], sub: (p) => String(p.name || ''), run: () => undefined });
registerAction({ id: 'text', name: 'routines.a.text', icon: 'text', color: '#f5a524', cat: 'advanced', out: 'routines.out.text', sw: true, params: [P('text', 'text', 'routines.p.text', { multiline: true })], sub: (p, F) => F.text(p.text), run: (ctx, p) => p.text });
const OPS = [['+', 'routines.op.plus'], ['-', 'routines.op.minus'], ['*', 'routines.op.times'], ['/', 'routines.op.div']];
registerAction({
  id: 'calc', name: 'routines.a.calc', icon: 'calc', color: '#8a8d96', cat: 'advanced', out: 'routines.out.calc', sw: true,
  params: [P('a', 'number', 'routines.p.input', { input: true }), P('op', 'enum', 'routines.p.op', { opts: OPS, def: '+' }), P('b', 'number', 'routines.p.value', { def: '1' })],
  sub: (p, F) => `${F.text(p.a) || F.t('routines.v.prev')} ${p.op || '+'} ${F.text(p.b)}`,
  run(ctx, p) { const r = { '+': p.a + p.b, '-': p.a - p.b, '*': p.a * p.b, '/': p.a / p.b }[p.op || '+']; need(Number.isFinite(r), 'routines.err.number'); return clean(r); },
});
registerAction({ id: 'routine.run', name: 'routines.a.routine', icon: 'rtRoutine', color: '#3e7bff', cat: 'advanced', out: 'routines.out.routine', sw: true,
  params: [P('routine', 'routine', 'routines.p.routine')], sub: (p, F) => F.routine(p.routine), run: () => undefined });
registerAction({ id: 'stop', name: 'routines.a.stop', icon: 'stop', color: '#8a8d96', cat: 'advanced', sw: true, params: [], run: (ctx, p, x) => { throw new Stop(x.input); } });

// ——— helpers for the runner, the engine and the editor ———
export const hasOutput = (a) => { const d = ACTIONS[a.type]; return !!d?.out && (!a.g || a.m === 2); };
export const isBlock = (type) => !!(ACTIONS[type]?.end);
/** Whether a whole action list can run in the service worker (no questions, menus, sounds, app windows, long waits). */
export function swSafe(actions, routines = [], seen = new Set()) {
  for (const a of actions || []) {
    const d = ACTIONS[a.type];
    if (!d) return false;
    if (typeof d.sw === 'function' ? !d.sw(a) : !d.sw) return false;
    if (/"s":"ask"/.test(JSON.stringify(a.p || {}))) return false;
    if (a.type === 'routine.run') {
      const r = routines.find((x) => x.id === a.p.routine);
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      if (!swSafe(r.actions, routines, seen)) return false;
    }
  }
  return true;
}
/** Optional permissions an action list needs (asked for when the user adds the action). */
export const permsOf = (actions) => [...new Set((actions || []).flatMap((a) => ACTIONS[a.type]?.perm || []))];
/** A new action with its parameters' defaults; block actions come with their markers. */
export function newAction(type) {
  const d = ACTIONS[type];
  const p = {};
  for (const pd of d?.params || []) if (pd.def !== undefined && pd.def !== '') p[pd.key] = structuredClone(pd.def);
  const a = { id: uid('a'), type, p };
  if (!d?.end) return [a];
  const g = uid('g');
  a.g = g;
  a.m = 0;
  if (type === 'if') return [a, { id: uid('a'), type, p: {}, g, m: 1 }, { id: uid('a'), type, p: {}, g, m: 2 }];
  if (type === 'menu') return [a, ...(p.items || ['', '']).map((x, k) => ({ id: uid('a'), type, p: { item: k }, g, m: 1 })), { id: uid('a'), type, p: {}, g, m: 2 }];
  return [a, { id: uid('a'), type, p: {}, g, m: 2 }];
}
export { KEY };

addStrings({
  en: {
    'routines.cat.modes': 'Modes',
    'routines.cat.display': 'Display',
    'routines.cat.focus': 'Notifications and Do not disturb',
    'routines.cat.sound': 'Sounds',
    'routines.cat.apps': 'Apps',
    'routines.cat.tabs': 'Chrome tabs',
    'routines.cat.advanced': 'Advanced',
    'routines.a.modeOn': 'Turn on a mode',
    'routines.a.modeOff': 'Turn off mode',
    'routines.a.theme': 'Dark mode',
    'routines.a.eye': 'Eye comfort shield',
    'routines.a.brightness': 'Brightness',
    'routines.a.wallpaper': 'Wallpaper',
    'routines.a.lock': 'Lock screen',
    'routines.a.focusOn': 'Do not disturb (Focus)',
    'routines.a.focusOff': 'Turn off Do not disturb',
    'routines.a.notify': 'Show notification',
    'routines.a.toast': 'Show pop-up message',
    'routines.a.alert': 'Show dialog',
    'routines.a.soundPlay': 'Play ambient sound',
    'routines.a.soundStop': 'Stop ambient sound',
    'routines.a.app': 'Open an app',
    'routines.a.urls': 'Open websites',
    'routines.a.note': 'Create note',
    'routines.a.reminder': 'Add reminder',
    'routines.a.timer': 'Start timer',
    'routines.a.tabsClose': 'Close tabs from websites',
    'routines.a.tabsMute': 'Mute tabs',
    'routines.a.tabsGroup': 'Group tabs by website',
    'routines.a.tabsSleep': 'Put background tabs to sleep',
    'routines.a.wait': 'Wait',
    'routines.a.ask': 'Ask for input',
    'routines.a.menu': 'Choose from menu',
    'routines.a.menuEnd': 'End menu',
    'routines.a.if': 'If',
    'routines.a.otherwise': 'Otherwise',
    'routines.a.endIf': 'End If',
    'routines.a.repeat': 'Repeat',
    'routines.a.repeatEach': 'Repeat with each',
    'routines.a.endRepeat': 'End Repeat',
    'routines.a.varSet': 'Set variable',
    'routines.a.text': 'Text',
    'routines.a.calc': 'Calculate',
    'routines.a.routine': 'Run another routine',
    'routines.a.stop': 'Stop routine',
    'routines.p.mode': 'Mode',
    'routines.p.mode2': 'Appearance',
    'routines.p.state': 'Turn',
    'routines.p.level': 'Level',
    'routines.p.wallpaper': 'Wallpaper',
    'routines.p.minutes': 'Minutes',
    'routines.p.seconds': 'Seconds',
    'routines.p.title': 'Title',
    'routines.p.message': 'Message',
    'routines.p.cancel': 'Show Cancel button',
    'routines.p.sound': 'Sound',
    'routines.p.app': 'App',
    'routines.p.urls': 'Websites',
    'routines.p.urlsPh': 'One address per line',
    'routines.p.noteText': 'Note',
    'routines.p.remTitle': 'Reminder',
    'routines.p.remIn': 'Remind me in (minutes)',
    'routines.p.label': 'Label',
    'routines.p.sites': 'Websites',
    'routines.p.sitesPh': 'youtube.com',
    'routines.p.question': 'Question',
    'routines.p.kind': 'Answer type',
    'routines.p.default': 'Default answer',
    'routines.p.items': 'Items',
    'routines.p.input': 'Input',
    'routines.p.condition': 'Condition',
    'routines.p.value': 'Value',
    'routines.p.times': 'Times',
    'routines.p.varName': 'Variable name',
    'routines.p.text': 'Text',
    'routines.p.op': 'Operation',
    'routines.p.routine': 'Routine',
    'routines.v.toggle': 'Switch',
    'routines.v.dark': 'Dark',
    'routines.v.light': 'Light',
    'routines.v.auto': 'Follow system',
    'routines.v.min': '{n} min',
    'routines.v.sec': '{n} sec',
    'routines.v.times': '{n} times',
    'routines.v.mute': 'Mute all',
    'routines.v.unmute': 'Unmute all',
    'routines.v.text': 'Text',
    'routines.v.number': 'Number',
    'routines.v.url': 'Web address',
    'routines.v.prev': 'Previous result',
    'routines.op.is': 'is',
    'routines.op.isnot': 'is not',
    'routines.op.contains': 'contains',
    'routines.op.notcontains': 'does not contain',
    'routines.op.begins': 'begins with',
    'routines.op.gt': 'is greater than',
    'routines.op.lt': 'is less than',
    'routines.op.any': 'has any value',
    'routines.op.none': 'has no value',
    'routines.op.plus': 'Add',
    'routines.op.minus': 'Subtract',
    'routines.op.times': 'Multiply',
    'routines.op.div': 'Divide',
    'routines.out.alert': 'Dialog result',
    'routines.out.note': 'Note',
    'routines.out.reminder': 'Reminder',
    'routines.out.count': 'Number of tabs',
    'routines.out.ask': 'Provided input',
    'routines.out.menu': 'Menu result',
    'routines.out.if': 'If result',
    'routines.out.repeat': 'Repeat results',
    'routines.out.text': 'Text',
    'routines.out.calc': 'Calculation result',
    'routines.out.routine': 'Routine result',
    'routines.err.page': 'This action needs an open Bloom Tab page.',
    'routines.err.url': '“{text}” isn’t a web address.',
    'routines.err.empty': 'There’s nothing to save.',
    'routines.err.duration': 'The timer needs a duration.',
    'routines.err.tabs': 'Allow Bloom Tab to see your tabs to do this.',
    'routines.err.number': 'The result isn’t a number.',
    'routines.err.unknown': 'This routine uses an action that isn’t available.',
    'routines.err.steps': 'The routine ran too many actions and was stopped.',
    'routines.err.deep': 'Routines can’t run each other this many times.',
    'routines.err.gone': 'The routine it runs was deleted.',
  },
  ar: {
    'routines.cat.modes': 'الأوضاع',
    'routines.cat.display': 'الشاشة',
    'routines.cat.focus': 'الإشعارات وعدم الإزعاج',
    'routines.cat.sound': 'الأصوات',
    'routines.cat.apps': 'التطبيقات',
    'routines.cat.tabs': 'علامات تبويب Chrome',
    'routines.cat.advanced': 'خيارات متقدمة',
    'routines.a.modeOn': 'تشغيل وضع',
    'routines.a.modeOff': 'إيقاف الوضع',
    'routines.a.theme': 'الوضع الداكن',
    'routines.a.eye': 'درع راحة العين',
    'routines.a.brightness': 'السطوع',
    'routines.a.wallpaper': 'الخلفية',
    'routines.a.lock': 'قفل الشاشة',
    'routines.a.focusOn': 'عدم الإزعاج (التركيز)',
    'routines.a.focusOff': 'إيقاف عدم الإزعاج',
    'routines.a.notify': 'إظهار إشعار',
    'routines.a.toast': 'إظهار رسالة منبثقة',
    'routines.a.alert': 'إظهار مربع حوار',
    'routines.a.soundPlay': 'تشغيل صوت محيطي',
    'routines.a.soundStop': 'إيقاف الصوت المحيطي',
    'routines.a.app': 'فتح تطبيق',
    'routines.a.urls': 'فتح مواقع ويب',
    'routines.a.note': 'إنشاء ملاحظة',
    'routines.a.reminder': 'إضافة تذكير',
    'routines.a.timer': 'بدء المؤقت',
    'routines.a.tabsClose': 'إغلاق علامات تبويب مواقع',
    'routines.a.tabsMute': 'كتم علامات التبويب',
    'routines.a.tabsGroup': 'تجميع علامات التبويب حسب الموقع',
    'routines.a.tabsSleep': 'إسبات علامات التبويب في الخلفية',
    'routines.a.wait': 'انتظار',
    'routines.a.ask': 'طلب إدخال',
    'routines.a.menu': 'اختيار من القائمة',
    'routines.a.menuEnd': 'نهاية القائمة',
    'routines.a.if': 'إذا',
    'routines.a.otherwise': 'خلاف ذلك',
    'routines.a.endIf': 'نهاية إذا',
    'routines.a.repeat': 'تكرار',
    'routines.a.repeatEach': 'تكرار مع كل',
    'routines.a.endRepeat': 'نهاية التكرار',
    'routines.a.varSet': 'تعيين متغير',
    'routines.a.text': 'النص',
    'routines.a.calc': 'حساب',
    'routines.a.routine': 'تشغيل إجراء روتيني آخر',
    'routines.a.stop': 'إيقاف الإجراء الروتيني',
    'routines.p.mode': 'الوضع',
    'routines.p.mode2': 'المظهر',
    'routines.p.state': 'الحالة',
    'routines.p.level': 'المستوى',
    'routines.p.wallpaper': 'الخلفية',
    'routines.p.minutes': 'الدقائق',
    'routines.p.seconds': 'الثواني',
    'routines.p.title': 'العنوان',
    'routines.p.message': 'الرسالة',
    'routines.p.cancel': 'إظهار زر الإلغاء',
    'routines.p.sound': 'الصوت',
    'routines.p.app': 'التطبيق',
    'routines.p.urls': 'مواقع الويب',
    'routines.p.urlsPh': 'عنوان واحد في كل سطر',
    'routines.p.noteText': 'الملاحظة',
    'routines.p.remTitle': 'التذكير',
    'routines.p.remIn': 'ذكّرني بعد (دقائق)',
    'routines.p.label': 'التسمية',
    'routines.p.sites': 'مواقع الويب',
    'routines.p.sitesPh': 'youtube.com',
    'routines.p.question': 'السؤال',
    'routines.p.kind': 'نوع الإجابة',
    'routines.p.default': 'الإجابة الافتراضية',
    'routines.p.items': 'العناصر',
    'routines.p.input': 'الإدخال',
    'routines.p.condition': 'الشرط',
    'routines.p.value': 'القيمة',
    'routines.p.times': 'عدد المرات',
    'routines.p.varName': 'اسم المتغير',
    'routines.p.text': 'النص',
    'routines.p.op': 'العملية',
    'routines.p.routine': 'الإجراء الروتيني',
    'routines.v.toggle': 'تبديل',
    'routines.v.dark': 'داكن',
    'routines.v.light': 'فاتح',
    'routines.v.auto': 'حسب النظام',
    'routines.v.min': '{n} دقيقة',
    'routines.v.sec': '{n} ثانية',
    'routines.v.times': '{n} مرات',
    'routines.v.mute': 'كتم الكل',
    'routines.v.unmute': 'إلغاء كتم الكل',
    'routines.v.text': 'نص',
    'routines.v.number': 'رقم',
    'routines.v.url': 'عنوان ويب',
    'routines.v.prev': 'النتيجة السابقة',
    'routines.op.is': 'يساوي',
    'routines.op.isnot': 'لا يساوي',
    'routines.op.contains': 'يحتوي على',
    'routines.op.notcontains': 'لا يحتوي على',
    'routines.op.begins': 'يبدأ بـ',
    'routines.op.gt': 'أكبر من',
    'routines.op.lt': 'أصغر من',
    'routines.op.any': 'له أي قيمة',
    'routines.op.none': 'ليس له قيمة',
    'routines.op.plus': 'جمع',
    'routines.op.minus': 'طرح',
    'routines.op.times': 'ضرب',
    'routines.op.div': 'قسمة',
    'routines.out.alert': 'نتيجة مربع الحوار',
    'routines.out.note': 'الملاحظة',
    'routines.out.reminder': 'التذكير',
    'routines.out.count': 'عدد علامات التبويب',
    'routines.out.ask': 'الإدخال المقدَّم',
    'routines.out.menu': 'نتيجة القائمة',
    'routines.out.if': 'نتيجة إذا',
    'routines.out.repeat': 'نتائج التكرار',
    'routines.out.text': 'النص',
    'routines.out.calc': 'نتيجة الحساب',
    'routines.out.routine': 'نتيجة الإجراء الروتيني',
    'routines.err.page': 'يحتاج هذا الإجراء إلى صفحة Bloom Tab مفتوحة.',
    'routines.err.url': '”{text}“ ليس عنوان ويب.',
    'routines.err.empty': 'لا يوجد شيء لحفظه.',
    'routines.err.duration': 'يحتاج المؤقت إلى مدة.',
    'routines.err.tabs': 'اسمح لـ Bloom Tab برؤية علامات التبويب لتنفيذ ذلك.',
    'routines.err.number': 'النتيجة ليست رقمًا.',
    'routines.err.unknown': 'يستخدم هذا الإجراء الروتيني إجراءً غير متاح.',
    'routines.err.steps': 'نفّذ الإجراء الروتيني عددًا كبيرًا جدًا من الإجراءات فتم إيقافه.',
    'routines.err.deep': 'لا يمكن للإجراءات الروتينية تشغيل بعضها هذا العدد من المرات.',
    'routines.err.gone': 'تم حذف الإجراء الروتيني الذي يشغّله.',
  },
});
