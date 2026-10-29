// Digital Wellbeing's actions for Modes and Routines: Bedtime mode on/off/toggle, start a Focus mode and end it. They
// only change the `wellbeing` store key, which the service worker watches (js/bg/wellbeing.js pauses sites and sets its
// alarms from it), so they run there too (sw: true): js/bg/wellbeing.js imports this module as well as the page's
// js/apps/wellbeing.js. Pure: no DOM, no page store (the page tells it where its Focus modes are, for the editor).
import { registerAction, RunError } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import * as M from './model.js';

const P = (key, type, label, o = {}) => ({ key, type, label, ...o });
const ONOFF = [['on', 'common.on'], ['off', 'common.off'], ['toggle', 'routines.v.toggle']];

// The routine editor lists the user's Focus modes; a page sets where to read them (the worker never shows the editor).
let modesNow = () => M.DEFAULT_MODES;
export const setModeSource = (fn) => (modesNow = fn);
const modeLabel = (m) => m.name || 'wellbeing.mode.' + m.id; // an i18n key for Samsung's two, the user's name otherwise

const read = async (ctx) => { const raw = await ctx.get('wellbeing'); return { raw: raw && typeof raw === 'object' ? raw : {}, w: M.prefs(raw) }; };
const write = async (ctx, raw, patch) => ctx.set('wellbeing', { ...raw, ...patch });

/** Turns Bedtime mode on (until the wake-up time) or off (skipping the scheduled time running now), if it isn't already. */
async function setBedtime(ctx, on) {
  const { raw, w } = await read(ctx);
  if (M.bedtimeAt(w.bedtime).active === on) return;
  await write(ctx, raw, { bedtime: M.toggleBedtime(w.bedtime) });
}

registerAction({
  id: 'wellbeing.bedtime', name: 'wellbeing.bedtime', icon: 'bedtime', color: '#6f5cf1', cat: 'focus', sw: true,
  params: [P('value', 'enum', 'routines.p.state', { opts: ONOFF, def: 'on' })],
  sub: (p, F) => F.opt('wellbeing.bedtime', 'value', p.value || 'on'),
  undo: {
    key: 'wellbeing.bedtime',
    save: async (ctx) => M.bedtimeAt((await read(ctx)).w.bedtime).active,
    restore: (ctx, was) => setBedtime(ctx, !!was),
  },
  async run(ctx, p) {
    const { w } = await read(ctx);
    const active = M.bedtimeAt(w.bedtime).active;
    await setBedtime(ctx, p.value === 'toggle' ? !active : p.value !== 'off');
  },
});

registerAction({
  id: 'wellbeing.focus', name: 'wellbeing.ra.focus', icon: 'wbWork', color: '#3e8bff', cat: 'focus', sw: true,
  params: [{ key: 'mode', type: 'enum', label: 'wellbeing.focusOn', def: 'work', get opts() { return modesNow().map((m) => [m.id, modeLabel(m)]); } }],
  sub: (p, F) => F.opt('wellbeing.focus', 'mode', p.mode || 'work'),
  undo: {
    key: 'wellbeing.focus',
    save: async (ctx) => (await read(ctx)).raw.focus || null,
    restore: async (ctx, prev) => { const { raw } = await read(ctx); await write(ctx, raw, { focus: prev && (!prev.endsAt || prev.endsAt > Date.now()) ? prev : null }); },
  },
  async run(ctx, p) {
    const { raw, w } = await read(ctx);
    const m = w.modes.find((x) => x.id === (p.mode || 'work'));
    if (!m) throw new RunError('wellbeing.ra.noMode');
    const now = Date.now();
    await write(ctx, raw, { focus: { id: m.id, startedAt: now, endsAt: m.minutes ? now + m.minutes * 60e3 : 0 } });
  },
});

registerAction({
  id: 'wellbeing.focusOff', name: 'wellbeing.ra.focusOff', icon: 'wbWork', color: '#3e8bff', cat: 'focus', sw: true, params: [],
  async run(ctx) {
    const { raw } = await read(ctx);
    if (raw.focus) await write(ctx, raw, { focus: null });
  },
});

addStrings({
  en: {
    'wellbeing.ra.focus': 'Start Focus mode',
    'wellbeing.ra.focusOff': 'End Focus mode',
    'wellbeing.ra.noMode': 'That Focus mode was deleted.',
  },
  ar: {
    'wellbeing.ra.focus': 'بدء وضع التركيز',
    'wellbeing.ra.focusOff': 'إنهاء وضع التركيز',
    'wellbeing.ra.noMode': 'تم حذف وضع التركيز هذا.',
  },
});
