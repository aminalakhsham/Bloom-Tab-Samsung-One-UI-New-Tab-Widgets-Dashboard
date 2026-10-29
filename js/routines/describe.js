// "Describe a routine": Chrome's on-device model (Gemini Nano, the Prompt API) turns a sentence like "every weekday at
// 9 turn on Work mode and open Gmail" into a draft routine that opens in the editor for review. Nothing leaves the
// computer. draftFrom() is pure so the node test checks it without the model.
import { uid, normCond, cleanHost } from './model.js';
import { ACTIONS } from './actions.js';

// what the model may use, and which parameter its "value" / "value2" fill in
const MAP = {
  'mode.on': ['mode', null, 'turn on a mode (value: sleep, theater, driving, exercise, relax or work)'],
  'mode.off': [null, null, 'turn off the mode that is on'],
  'theme.set': ['value', null, 'dark mode (value: dark, light or auto)'],
  'eye.set': ['value', null, 'eye comfort shield, a warm screen filter (value: on or off)'],
  'brightness.set': ['value', null, 'screen brightness (value: percent, 30 to 100)'],
  'wallpaper.set': ['preset', null, 'change the wallpaper (value: bloom, dawn, aurora, sunset, ocean, mint, graphite, lavender, ember, forest, sand or midnight)'],
  'focus.on': ['min', null, 'do not disturb / focus session (value: minutes)'],
  'focus.off': [null, null, 'turn off do not disturb'],
  'sound.play': ['sound', null, 'play an ambient sound (value: rain, ocean, fire, forest, white, pink or brown)'],
  'sound.stop': [null, null, 'stop the ambient sound'],
  'url.open': ['urls', null, 'open websites (value: addresses, one per line)'],
  'app.open': ['app', null, 'open an app (value: notes, reminder, calendar, clock, weather, calculator or settings)'],
  'note.new': ['text', null, 'create a note (value: the note)'],
  'reminder.add': ['title', 'in', 'add a reminder (value: what to remember, value2: in how many minutes, optional)'],
  'timer.start': ['min', 'label', 'start a timer (value: minutes, value2: label)'],
  'notify': ['text', 'title', 'show a notification (value: message, value2: title)'],
  'toast': ['text', null, 'show a short pop-up message (value: message)'],
  'lock': [null, null, 'lock the screen'],
  'tabs.mute': ['value', null, 'mute or unmute the tabs playing sound (value: mute or unmute)'],
  'tabs.close': ['sites', null, 'close the tabs of some websites (value: domains)'],
  'tabs.group': [null, null, 'group the open tabs by website'],
  'tabs.discard': [null, null, 'put background tabs to sleep to free memory'],
  'wait': ['sec', null, 'wait (value: seconds)'],
};
const TRIGGERS = ['none', 'time', 'period', 'sunrise', 'sunset', 'night', 'newtab', 'startup', 'unlock', 'website', 'idle', 'mode'];
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    trigger: {
      type: 'object',
      properties: { type: { type: 'string', enum: TRIGGERS }, time: { type: 'string' }, end: { type: 'string' }, days: { type: 'array', items: { type: 'string', enum: [...DAY_NAMES, 'weekdays', 'weekends'] } }, website: { type: 'string' }, minutes: { type: 'integer' }, mode: { type: 'string' } },
      required: ['type'],
    },
    actions: { type: 'array', items: { type: 'object', properties: { action: { type: 'string', enum: Object.keys(MAP) }, value: { type: 'string' }, value2: { type: 'string' } }, required: ['action'] } },
  },
  required: ['name', 'trigger', 'actions'],
};
const instruction = () => `You build routines for Bloom Tab, a browser start page in the style of Samsung's Modes and Routines. Turn the user's request into JSON that matches the schema.
"actions" run in order. Use only these actions:
${Object.entries(MAP).map(([k, v]) => `- ${k}: ${v[2]}`).join('\n')}
"trigger" says when it runs: "none" when the user starts it by hand; "time" at "time" (HH:MM, 24-hour); "period" from "time" to "end" (both HH:MM); "sunrise"; "sunset"; "night" from sunset to sunrise; "days" (omit for every day; "weekdays" means monday to friday); "newtab" when a new tab opens; "startup" when Chrome starts; "unlock" when they unlock the Lock screen; "website" with "website" (a domain) when it opens; "idle" with "minutes" when they come back to the computer after that long away; "mode" with "mode" while that mode is on.
"name" is a short title in the user's language. Output only the JSON.`;

const hhmm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : null);

/** The model's answer → { name, conds, actions }. Unknown actions are dropped; values are checked. */
export function draftFrom(o, { modes = [], sounds = [], presets = [], apps = [] } = {}) {
  o = o && typeof o === 'object' ? o : {};
  const actions = [];
  for (const x of Array.isArray(o.actions) ? o.actions : []) {
    const m = MAP[x?.action];
    if (!m || !ACTIONS[x.action]) continue;
    const a = { id: uid('a'), type: x.action, p: {} };
    for (const pd of ACTIONS[x.action].params) if (pd.def !== undefined && pd.def !== '') a.p[pd.key] = structuredClone(pd.def);
    const v = String(x.value ?? '').trim(), v2 = String(x.value2 ?? '').trim(), lv = v.toLowerCase();
    const set = (key, val) => { if (key && val !== '' && val != null) a.p[key] = val; };
    const num = (d) => String(Math.max(1, Math.round(parseFloat(v) || d)));
    switch (x.action) {
      case 'mode.on': set('mode', modes.find((id) => lv.includes(id)) || modes[0] || 'sleep'); break;
      case 'theme.set': set('value', ['dark', 'light', 'auto', 'toggle'].includes(lv) ? lv : 'dark'); break;
      case 'eye.set': set('value', lv === 'off' ? 'off' : 'on'); break;
      case 'brightness.set': set('value', String(Math.max(30, Math.min(100, Math.round(parseFloat(v) || 70))))); break;
      case 'wallpaper.set': set('preset', presets.includes(lv) ? lv : presets.find((p) => lv.includes(p)) || presets[0] || 'bloom'); break;
      case 'focus.on': case 'timer.start': set('min', num(25)); set(m[1], v2); break;
      case 'wait': set('sec', num(5)); break;
      case 'sound.play': set('sound', sounds.includes(lv) ? lv : sounds.find((s) => lv.includes(s)) || 'rain'); break;
      case 'app.open': set('app', apps.find((id) => lv.includes(id)) || 'notes'); break;
      case 'tabs.mute': set('value', lv === 'unmute' ? 'unmute' : 'mute'); break;
      case 'tabs.close': set('sites', v.split(/[\s,]+/).map(cleanHost).filter(Boolean).join('\n')); break;
      case 'url.open': set('urls', v.split(/[\s,]+/).filter(Boolean).join('\n')); break;
      case 'reminder.add': set('title', v); set('in', v2 && parseFloat(v2) > 0 ? String(Math.round(parseFloat(v2))) : ''); break;
      default: set(m[0], v); set(m[1], v2);
    }
    actions.push(a);
  }
  const tr = o.trigger && typeof o.trigger === 'object' ? o.trigger : {};
  const days = Array.isArray(tr.days) && tr.days.length
    ? [...new Set(tr.days.flatMap((d) => { d = String(d).toLowerCase(); return d === 'weekdays' ? [1, 2, 3, 4, 5] : d === 'weekends' ? [0, 6] : [DAY_NAMES.indexOf(d)]; }).filter((n) => n >= 0))]
    : undefined;
  const host = cleanHost(tr.website || '');
  const cond = {
    time: hhmm(tr.time) && { type: 'time', start: hhmm(tr.time), end: '', days },
    period: hhmm(tr.time) && { type: 'time', start: hhmm(tr.time), end: hhmm(tr.end) || '', days },
    sunrise: { type: 'time', start: 'sunrise', end: '', days },
    sunset: { type: 'time', start: 'sunset', end: '', days },
    night: { type: 'time', start: 'sunset', end: 'sunrise', days },
    newtab: { type: 'newtab' }, startup: { type: 'startup' }, unlock: { type: 'unlock' },
    website: host && { type: 'site', hosts: [host] },
    idle: { type: 'idle', away: tr.minutes || 15 },
    mode: { type: 'mode', mode: modes.find((id) => String(tr.mode || '').toLowerCase().includes(id)) || '' },
  }[tr.type] || { type: 'manual' };
  return { name: String(o.name || '').trim().slice(0, 60), conds: [normCond(cond)], actions };
}

/** Whether the on-device model can be used here ('available' | 'downloadable' | 'downloading' | 'unavailable'). */
export async function aiStatus() {
  const LM = globalThis.LanguageModel;
  if (!LM?.availability) return 'unavailable';
  try { return await LM.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }); } catch { return 'unavailable'; }
}

/** Asks the on-device model; resolves with a draft or throws (no model, no answer, nothing usable). */
export async function describe(text, env, { signal } = {}) {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('unavailable');
  const s = await LM.create({ initialPrompts: [{ role: 'system', content: instruction() }], signal, expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  try {
    let raw;
    try { raw = await s.prompt(text, { responseConstraint: SCHEMA, signal }); }
    catch (e) { if (signal?.aborted) throw e; raw = await s.prompt(text + '\n\nAnswer with JSON only.', { signal }); } // older Chrome without responseConstraint
    const d = draftFrom(JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')), env);
    if (!d.actions.length) throw new Error('empty');
    return d;
  } finally {
    try { s.destroy(); } catch {}
  }
}
