// Modes and Routines in the service worker: one alarm, "routine:tick", wakes it at the next time anything changes
// (a routine's time or time period, sunrise/sunset from the Weather location, a mode's schedule or "until");
// Chrome starting, coming back to the computer (chrome.idle) and opening a website (tabs.onUpdated, with the optional
// "tabs" permission) fire routines here. Routines whose actions can all run here run here; the rest wait for a page:
// a "Tap to run" notification, and the next new tab runs them (js/routines/page.js).
import { onAlarm, onButton, openTarget, onMessage, post, bgStrings, fmt, uid } from './hub.js';
import { KEY, RUN_KEY, norm, normRun, nextEdge, MODE_PRESETS } from '../routines/model.js';
import { RunError, toText } from '../routines/actions.js';
import * as E from '../routines/engine.js';

const local = chrome.storage.local, session = chrome.storage.session;
const S = {
  en: {
    app: 'Modes and Routines', tap: 'Tap to run it in a new tab', run: 'Run', ready: '“{name}” is ready', modeReady: '{name} mode is on',
    modeTap: 'Tap to play its sounds and finish turning it on', problem: 'There was a problem running “{name}”.', untitled: 'My routine',
    sleep: 'Sleep', theater: 'Theater', driving: 'Driving', exercise: 'Exercise', relax: 'Relax', work: 'Work', custom: 'My mode',
    'routines.err.url': 'That isn’t a web address.', 'routines.err.tabs': 'Allow Bloom Tab to see your tabs to do this.', 'routines.err.empty': 'There’s nothing to save.',
    'routines.err.duration': 'The timer needs a duration.', 'routines.err.number': 'The result isn’t a number.', 'routines.err.unknown': 'This routine uses an action that isn’t available.',
    'routines.err.steps': 'The routine ran too many actions and was stopped.', 'routines.err.deep': 'Routines can’t run each other this many times.', 'routines.err.gone': 'The routine it runs was deleted.',
  },
  ar: {
    app: 'الأوضاع والإجراءات الروتينية', tap: 'اضغط لتشغيله في علامة تبويب جديدة', run: 'تشغيل', ready: '”{name}“ جاهز', modeReady: 'وضع {name} قيد التشغيل',
    modeTap: 'اضغط لتشغيل أصواته وإكمال تشغيله', problem: 'حدثت مشكلة أثناء تشغيل ”{name}“.', untitled: 'إجرائي الروتيني',
    sleep: 'النوم', theater: 'المسرح', driving: 'القيادة', exercise: 'التمرين', relax: 'الاسترخاء', work: 'العمل', custom: 'وضعي',
    'routines.err.url': 'هذا ليس عنوان ويب.', 'routines.err.tabs': 'اسمح لـ Bloom Tab برؤية علامات التبويب لتنفيذ ذلك.', 'routines.err.empty': 'لا يوجد شيء لحفظه.',
    'routines.err.duration': 'يحتاج المؤقت إلى مدة.', 'routines.err.number': 'النتيجة ليست رقمًا.', 'routines.err.unknown': 'يستخدم هذا الإجراء الروتيني إجراءً غير متاح.',
    'routines.err.steps': 'نفّذ الإجراء الروتيني عددًا كبيرًا جدًا من الإجراءات فتم إيقافه.', 'routines.err.deep': 'لا يمكن للإجراءات الروتينية تشغيل بعضها هذا العدد من المرات.', 'routines.err.gone': 'تم حذف الإجراء الروتيني الذي يشغّله.',
  },
};
const modeName = (m, s) => m?.name || (m?.preset ? s[m.preset] : s.custom);

async function loc() {
  const { settings, weather } = await local.get(['settings', 'weather']);
  const a = settings?.location, b = weather?.location;
  return a?.lat != null ? a : b?.lat != null ? b : null;
}

/** The worker's run context: storage straight from chrome.storage.local, notifications from Chrome. */
function swCtx() {
  return {
    env: 'sw', page: null, stopped: false,
    get: async (k) => (await local.get(k))[k],
    set: (k, v) => local.set({ [k]: v }),
    async notify(title, body) {
      const s = await bgStrings(S);
      await post('routine:n:' + uid(), { app: 'routines', title: title || s.app, body: toText(body), icon: 'rtRoutine' });
    },
    schedule: (name, when) => { if (when > Date.now()) chrome.alarms.create(name, { when }); },
    cancel: (name) => chrome.alarms.clear(name),
    loc,
    lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request('bt-routines', fn) : fn()),
    async pend(key, info) {
      const s = await bgStrings(S);
      const d = norm((await local.get(KEY))[KEY]);
      if (key.startsWith('m:')) {
        const m = d.modes.find((x) => x.id === info.mode);
        return post('routine:p:' + key, { app: 'routines', title: fmt(s.modeReady, { name: modeName(m, s) }), body: s.modeTap, icon: 'rtModes', buttons: [{ title: s.run }] });
      }
      return post('routine:p:' + key, { app: 'routines', title: fmt(s.ready, { name: info.name || s.untitled }), body: s.tap, icon: 'rtRoutine', buttons: [{ title: s.run }] });
    },
    async report(name, e) {
      if (!(e instanceof RunError)) console.warn('routine', name, e);
      const s = await bgStrings(S);
      await post('routine:e:' + uid(), { app: 'routines', title: fmt(s.problem, { name: name || s.untitled }), body: e instanceof RunError ? s[e.key] || '' : '', icon: 'rtRoutine' });
    },
    onStop() {},
  };
}

/** (Re)plans the one "routine:tick" alarm at the next time-based change. */
export async function plan() {
  const got = await local.get([KEY, RUN_KEY]);
  const when = nextEdge(norm(got[KEY]), normRun(got[RUN_KEY]), Date.now(), await loc());
  const cur = await chrome.alarms.get('routine:tick');
  if (!when) return cur && chrome.alarms.clear('routine:tick');
  if (!cur || Math.abs(cur.scheduledTime - when) > 1000) chrome.alarms.create('routine:tick', { when: Math.max(when, Date.now() + 500) });
}
export async function tick() {
  await E.tick(swCtx());
  await plan();
}
export const fire = async (ev) => {
  const out = await E.fire(swCtx(), ev);
  await plan();
  return out;
};

onAlarm('routine', async (rest) => {
  if (rest === 'tick') await tick();
});
// "Run" on a "Tap to run" notification: a new tab runs what is waiting (the click itself opens the app)
onButton('routine', (rest) => {
  if (rest.startsWith('p:')) chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
});
openTarget('routine', () => ({ app: 'routines' }));
onMessage('routines', async (msg) => {
  if (msg.op === 'plan') await plan();
  else if (msg.op === 'tick') await tick();
  return true;
});

// ——— triggers ———
chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await fire({ type: 'startup' });
    await tick();
  })().catch((e) => console.warn('routines startup', e));
});
chrome.runtime.onInstalled.addListener(() => plan().catch(() => {}));

let planTimer = 0;
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  const loc1 = c.settings && JSON.stringify(c.settings.oldValue?.location) !== JSON.stringify(c.settings.newValue?.location);
  const loc2 = c.weather && JSON.stringify(c.weather.oldValue?.location) !== JSON.stringify(c.weather.newValue?.location);
  if (!c[KEY] && !c[RUN_KEY] && !loc1 && !loc2) return;
  clearTimeout(planTimer);
  planTimer = setTimeout(() => plan().catch((e) => console.warn('routines plan', e)), 800);
});

// Coming back to the computer: "idle"/"locked" starts the time away ("idle" is reported a minute after the last input).
chrome.idle.onStateChanged.addListener((state) => {
  (async () => {
    const { rtAway } = await session.get('rtAway');
    if (state !== 'active') {
      if (!rtAway) await session.set({ rtAway: Date.now() - (state === 'idle' ? 60e3 : 0) });
      return;
    }
    if (!rtAway) return;
    await session.remove('rtAway');
    await fire({ type: 'idle', away: (Date.now() - rtAway) / 60e3 });
  })().catch((e) => console.warn('routines idle', e));
});

// Opening a website: tabs.onUpdated carries the address only with the optional "tabs" permission (asked for when
// the user adds the "Website opened" condition).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  (async () => {
    const d = norm((await local.get(KEY))[KEY]);
    if (!d.list.some((r) => r.on && r.conds.some((c) => c.type === 'site'))) return;
    const { rtTabs = {} } = await session.get('rtTabs');
    const prev = rtTabs[tabId] || '';
    rtTabs[tabId] = /^https?:/.test(info.url) ? info.url : '';
    await session.set({ rtTabs });
    if (/^https?:/.test(info.url)) await fire({ type: 'site', url: info.url, prev });
  })().catch((e) => console.warn('routines site', e));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  session.get('rtTabs').then(({ rtTabs = {} }) => {
    if (!(tabId in rtTabs)) return;
    delete rtTabs[tabId];
    session.set({ rtTabs });
  });
});

// for the dev tests (and debugging from the worker's console)
globalThis.btRoutines = { tick, fire, plan, presets: MODE_PRESETS.map((p) => p.preset) };
plan().catch(() => {});
