// Background (service worker) part of Samsung Health:
// - medication reminders with "Taken" and "Skip" buttons and a follow-up 30 minutes later when a dose still isn't
//   logged. The worker never writes the `health` key the pages own: the buttons add entries to `healthSW`, which
//   pages read alongside their own log (and copy into it, so the worker can drop entries after two weeks).
// - Daily activity: the only writer of `healthAct` (see js/health/rings.js): break hours and minutes at the computer
//   from chrome.idle, daily snapshots of Focus minutes, sessions and completed reminders, ring closings, awards, and
//   the evening coaching.
// Alarms (kind "health"): health:tick (every minute), health:coach (evening), health:plan (twice a day),
// health:med:<slot> and health:medf:<slot> (<slot> = YYYY-MM-DDTHH:MM). Notifications: health:med:<slot>,
// health:coach:<day>, health:ring:<ring>:<day>, health:award:<id>:<day>.
import { onAlarm, onButton, openTarget, onMessage, bgStrings, fmt, bgLocale, uid, ICON, IDLE_SECONDS, addToList } from './hub.js';
import * as M from '../health/model.js';
import * as R from '../health/rings.js';

const local = chrome.storage.local, session = chrome.storage.session;
const MED = 'health:med:', FOLLOW = 'health:medf:';
const AHEAD = 48 * 36e5, FOLLOW_AFTER = 30 * 60000, KEEP = 14 * 864e5;
// chrome.idle has one detection interval for the whole extension: Digital Wellbeing (js/bg/wellbeing.js) sets 120
// seconds, so Health uses the same value instead of fighting over it (an idle event then means 2+ minutes away)
const IDLE_SEC = IDLE_SECONDS; // shared with Digital Wellbeing (bg/hub.js)
// minutes at the computer are counted in session storage and written to the log at most every 15 minutes (and when
// the hour changes or a break ends), so open pages aren't sent the whole log every minute
const FLUSH_MS = 15 * 60000;

const S = {
  en: {
    medTitle: 'Medications', medTime: 'Time to take your {time} medication', medTimeMany: 'Time to take your {time} medications',
    medFollow: 'Did you take your {time} medication?', medFollowMany: 'Did you take your {time} medications?',
    taken: 'Taken', skip: 'Skip', takenAll: 'All taken', skipAll: 'Skip all',
    actTitle: 'Daily activity', startFocus: 'Start Focus',
    closedFocus: 'You reached your Focus goal. Nice work staying focused!',
    closedDone: 'You reached your Tasks goal. That’s a productive day!',
    closedBreaks: 'You reached your Breaks goal. Thanks for taking care of yourself.',
    closedAll: 'Perfect day! You reached all three Daily activity goals.',
    coachFar: 'There’s still time to reach your Focus goal today. A Focus session is a great place to start.',
    coachFocus: 'You’re close to your Focus goal. Just {n} min to go.',
    coachDone: 'You’re close to your Tasks goal. Just {n} to go.',
    coachBreaks: 'You’re close to your Breaks goal. Just {n} hr to go.',
    award: 'You earned the “{name}” award.', month: '{month} challenge',
    'aw.perfect-day': 'Perfect day', 'aw.perfect-week': 'Perfect week', 'aw.perfect-week-focus': 'Perfect week (Focus)',
    'aw.perfect-week-done': 'Perfect week (Tasks)', 'aw.perfect-week-breaks': 'Perfect week (Breaks)', 'aw.perfect-month': 'Perfect month',
    'aw.focus-record': 'New Focus record', 'aw.focus-streak': 'Longest Focus streak', 'aw.focus-200': 'Double Focus',
    'aw.focus-300': 'Focus goal 300%', 'aw.focus-400': 'Focus goal 400%', 'aw.first-breaks': 'First Breaks goal',
    'aw.goals-100': '100 Focus goals', 'aw.goals-365': '365 Focus goals', 'aw.sessions-1': 'First Focus session',
    'aw.sessions-100': '100 Focus sessions', 'aw.sessions-500': '500 Focus sessions', 'aw.sessions-1000': '1,000 Focus sessions',
  },
  ar: {
    medTitle: 'الأدوية', medTime: 'حان وقت تناول دواء الساعة {time}', medTimeMany: 'حان وقت تناول أدوية الساعة {time}',
    medFollow: 'هل تناولت دواء الساعة {time}؟', medFollowMany: 'هل تناولت أدوية الساعة {time}؟',
    taken: 'تم تناوله', skip: 'تخطي', takenAll: 'تم تناولها كلها', skipAll: 'تخطي الكل',
    actTitle: 'النشاط اليومي', startFocus: 'بدء التركيز',
    closedFocus: 'وصلت إلى هدف التركيز. عمل رائع في الحفاظ على تركيزك!',
    closedDone: 'وصلت إلى هدف المهام. يا له من يوم مثمر!',
    closedBreaks: 'وصلت إلى هدف الاستراحات. شكرًا لاهتمامك بنفسك.',
    closedAll: 'يوم مثالي! وصلت إلى أهداف النشاط اليومي الثلاثة.',
    coachFar: 'لا يزال هناك وقت للوصول إلى هدف التركيز اليوم. جلسة تركيز بداية رائعة.',
    coachFocus: 'أنت قريب من هدف التركيز. بقيت {n} دقيقة فقط.',
    coachDone: 'أنت قريب من هدف المهام. بقي {n} فقط.',
    coachBreaks: 'أنت قريب من هدف الاستراحات. بقيت {n} ساعة فقط.',
    award: 'حصلت على جائزة «{name}».', month: 'تحدي {month}',
    'aw.perfect-day': 'يوم مثالي', 'aw.perfect-week': 'أسبوع مثالي', 'aw.perfect-week-focus': 'أسبوع مثالي (التركيز)',
    'aw.perfect-week-done': 'أسبوع مثالي (المهام)', 'aw.perfect-week-breaks': 'أسبوع مثالي (الاستراحات)', 'aw.perfect-month': 'شهر مثالي',
    'aw.focus-record': 'رقم قياسي جديد للتركيز', 'aw.focus-streak': 'أطول سلسلة تركيز', 'aw.focus-200': 'تركيز مضاعف',
    'aw.focus-300': 'هدف التركيز 300%', 'aw.focus-400': 'هدف التركيز 400%', 'aw.first-breaks': 'أول هدف للاستراحات',
    'aw.goals-100': '100 هدف تركيز', 'aw.goals-365': '365 هدف تركيز', 'aw.sessions-1': 'أول جلسة تركيز',
    'aw.sessions-100': '100 جلسة تركيز', 'aw.sessions-500': '500 جلسة تركيز', 'aw.sessions-1000': '1,000 جلسة تركيز',
  },
};

// Alarms, buttons and storage changes read, change and write one key at a time: two queues, one per key the worker
// owns (healthSW for doses, healthAct for Daily activity).
const queue = (() => { let q = Promise.resolve(); return (fn) => (q = q.then(fn, fn).catch((e) => console.warn('health', e))); })();
let actQ = Promise.resolve();
const actSerial = (fn) => (actQ = actQ.then(fn).catch((e) => console.warn('health activity', e)));
/** Resolves once the queued Daily activity work is done (used by the dev test). */
export const idleQueue = () => Promise.all([actQ, queue(() => {})]);

/** A system notification plus an entry in the in-page list. The in-page entry (shown on the Lock screen) gets
 *  `pageBody` instead of the body when the body holds private details such as medication names. */
async function post(id, { title, body = '', pageBody = body, buttons, sticky = false }) {
  await addToList({ app: 'health', title, body: pageBody, icon: 'heart' });
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message: body || ' ', priority: sticky ? 2 : 1, requireInteraction: sticky, buttons });
}

// ------------------------------------------------------------------ medications
let lastSig = null;
/** Only the medications, their schedules and the reminder options change which alarms are needed. */
function planIfChanged(v) {
  const d = M.norm(v), sig = JSON.stringify([d.meds.map((m) => [m.id, m.archived, m.name, m.nick, m.start, m.end, m.sched]), d.medPrefs]);
  if (sig === lastSig) return;
  lastSig = sig;
  plan();
}
/** Creates the reminder alarms for the next two days and removes the ones no longer needed. Returns their names. */
export const plan = (now = Date.now()) => queue(async () => {
  await ensureAlarms();
  const { health } = await local.get('health');
  const d = M.norm(health), want = new Map();
  if (d.medPrefs.remind) {
    for (const s of M.upcomingSlots(d, now - FOLLOW_AFTER, now + AHEAD)) {
      if (s.at > now) want.set(MED + s.slot, s.at);
      if (d.medPrefs.follow && s.at + FOLLOW_AFTER > now) want.set(FOLLOW + s.slot, s.at + FOLLOW_AFTER);
    }
  }
  const have = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith(MED) || a.name.startsWith(FOLLOW)), keep = new Set();
  for (const a of have) {
    if (want.has(a.name) && Math.abs(a.scheduledTime - want.get(a.name)) < 1000) keep.add(a.name);
    else await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) if (!keep.has(name)) chrome.alarms.create(name, { when });
  return [...want.keys()];
});

async function remind(slot, follow) {
  const { health, healthSW } = await local.get(['health', 'healthSW']);
  const d = M.norm(health), open = M.slotDoses(d, M.allLogs(d, healthSW), slot).filter((x) => !x.entry);
  // a dose logged early (or from the first reminder) gets no reminder
  if (!open.length || !d.medPrefs.remind || (follow && !d.medPrefs.follow)) return;
  const s = await bgStrings(S);
  const time = new Intl.DateTimeFormat(await bgLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(M.slotTime(slot)));
  const many = open.length > 1;
  const title = fmt(follow ? (many ? s.medFollowMany : s.medFollow) : many ? s.medTimeMany : s.medTime, { time });
  const names = open.map((x) => [x.med.nick || x.med.name, x.med.strength ? `${x.med.strength} ${x.med.unit || ''}`.trim() : ''].filter(Boolean).join(' ')).join(', ');
  await post('health:med:' + slot, { title, body: names, pageBody: s.medTitle, sticky: true, buttons: [{ title: many ? s.takenAll : s.taken }, { title: many ? s.skipAll : s.skip }] });
}

/** Takes away a reminder once every dose of its time is logged (in the app, a widget or another tab). */
const tidy = () => queue(async () => {
  const ids = Object.keys(await chrome.notifications.getAll()).filter((id) => id.startsWith(MED));
  if (!ids.length) return;
  const { health, healthSW } = await local.get(['health', 'healthSW']);
  const d = M.norm(health), logs = M.allLogs(d, healthSW);
  for (const id of ids) if (!M.slotDoses(d, logs, id.slice(MED.length)).some((x) => !x.entry)) chrome.notifications.clear(id);
});

/** "Taken" / "Skip" from a notification: logs every dose of that time that isn't logged yet. */
const logSlot = (slot, status) => queue(async () => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(slot || '')) return 0;
  const { health, healthSW } = await local.get(['health', 'healthSW']);
  const d = M.norm(health), add = M.slotAction(d, M.allLogs(d, healthSW), slot, status);
  if (add.length) {
    const cut = Date.now() - KEEP;
    await local.set({ healthSW: { log: [...(healthSW?.log || []).filter((e) => e && e.at > cut), ...add] } });
  }
  chrome.notifications.clear(MED + slot);
  await chrome.alarms.clear(FOLLOW + slot);
  return add.length;
});

// ------------------------------------------------------------------ Daily activity log
/** Reads the log, lets `fn` change it, then refreshes today's snapshots, announces closed rings and new awards, trims
 *  old days and writes the log back only when something changed. */
async function withLog(fn, now = Date.now()) {
  const st = await local.get(['healthAct', 'healthPrefs', 'reminders', 'focusLog', 'focus']);
  const before = JSON.stringify(st.healthAct ?? null);
  const log = R.normLog(st.healthAct ? structuredClone(st.healthAct) : null);
  await fn?.(log, st);
  const today = R.dayKey(now), prefs = R.normPrefs(st.healthPrefs);
  // Tasks: today's count as it is, and yesterday's kept at its highest (a reminder completed just before midnight)
  for (const k of [today, R.addDays(today, -1)]) {
    const n = R.doneCount(st.reminders, k), had = log.days[k]?.done ?? 0;
    if (k === today ? n !== had && (n || log.days[k]) : n > had) R.dayIn(log, k).done = n;
  }
  // Focus: every day the session log still covers, kept at its highest once the oldest sessions roll off
  for (const [k, f] of Object.entries(R.focusDays(st.focusLog))) {
    const d = log.days[k];
    const min = Math.round(f.min * 100) / 100;
    if ((d?.focus ?? -1) < min || (d?.sessions ?? -1) < f.sessions) {
      const x = R.dayIn(log, k);
      x.focus = Math.max(x.focus || 0, min);
      x.sessions = Math.max(x.sessions || 0, f.sessions);
    }
  }
  const s = { act: log, prefs: st.healthPrefs, reminders: st.reminders, focusLog: st.focusLog, focus: st.focus, now };
  const str = await bgStrings(S), notes = [];
  // rings closed today, each announced once
  const r = R.ringsFor(today, s), c = R.closed(r), told = R.dayOf(log, today).told;
  const newly = R.RINGS.filter((k) => c[k] && !told.includes(k));
  if (newly.length) {
    const all = R.allClosed(r) && !told.includes('all');
    R.dayIn(log, today).told = [...told, ...newly, ...(all ? ['all'] : [])];
    if (prefs.notify.goals) {
      if (all) notes.push(['health:ring:all:' + today, str.closedAll]);
      else for (const k of newly) notes.push([`health:ring:${k}:${today}`, { focus: str.closedFocus, done: str.closedDone, breaks: str.closedBreaks }[k]]);
    }
  }
  // awards: what the data earns now, added to what was earned before (which outlives trimmed days)
  const lang = (await bgLocale()) || 'en';
  const res = R.computeAwards(s, { weekStart: R.weekStartOf(lang.startsWith('ar') ? 'ar' : lang) });
  const merged = R.mergeEarned(log.earned, res.earned);
  const fresh = R.newAwards(log.earned, merged).filter((a) => a.day >= R.addDays(today, -1));
  log.earned = merged;
  if (prefs.notify.awards) {
    for (const a of fresh.slice(0, 3)) {
      if (a.id === 'perfect-day' && prefs.notify.goals) continue; // "Perfect day!" already said it
      notes.push(['health:award:' + a.id + ':' + a.day, fmt(str.award, { name: await awardName(a.id, str) })]);
    }
  }
  R.trim(log, st.healthPrefs, today);
  const after = JSON.stringify(log);
  if (after !== before && (st.healthAct || Object.keys(log.days).length || Object.keys(log.earned).length)) await local.set({ healthAct: log });
  for (const [id, text] of notes) await post(id, { title: str.actTitle, body: text });
}
async function awardName(id, str) {
  if (R.isMonthAward(id)) {
    const [y, m] = id.slice(6).split('-').map(Number);
    let month = '';
    try { month = new Intl.DateTimeFormat(await bgLocale(), { month: 'long' }).format(new Date(y, m - 1, 1)); } catch {}
    return fmt(str.month, { month });
  }
  return str['aw.' + id] || id;
}

// ------------------------------------------------------------------ breaks and time at the computer
async function onIdle(state, now) {
  const { healthIdle: act = {} } = await session.get('healthIdle');
  if (state === 'active') {
    if (act.away == null) return;
    const start = act.away;
    act.away = null;
    await session.set({ healthIdle: act });
    if (now - start >= R.BREAK_MS) await withLog((log) => { R.addBreak(log, start, now); }, now);
    return;
  }
  // idle means no input for IDLE_SEC already; a locked screen means away from now
  if (act.away == null) { act.away = state === 'locked' ? now : now - IDLE_SEC * 1000; await session.set({ healthIdle: act }); }
}
async function tick() {
  const now = Date.now();
  const state = await chrome.idle.queryState(IDLE_SEC);
  const { healthIdle: act = {} } = await session.get('healthIdle');
  let brk = null;
  // a long gap between ticks means the computer slept: you were away from the last tick on
  if (act.last && now - act.last > 4 * 60000) act.away = Math.min(act.away ?? Infinity, act.last);
  const hourKey = R.dayKey(now) + ':' + new Date(now).getHours();
  if (state === 'active') {
    if (act.away != null) { brk = [act.away, now]; act.away = null; }
    act.pend = { ...(act.pend || {}), [hourKey]: (act.pend?.[hourKey] || 0) + 1 };
  } else if (act.away == null) act.away = state === 'locked' ? now : now - IDLE_SEC * 1000;
  act.last = now;
  act.flushed ||= now;
  const dayChanged = act.day && act.day !== R.dayKey(now);
  act.day = R.dayKey(now);
  const pend = act.pend || {};
  const flush = brk || dayChanged || Object.keys(pend).some((k) => k !== hourKey) || (Object.keys(pend).length && now - (act.flushed || 0) >= FLUSH_MS);
  const { focus } = await local.get('focus');
  // a running Focus session can reach the goal between changes, so it is checked every minute too
  const running = !!(focus?.startedAt && (focus.endsAt == null || focus.endsAt > now));
  if (flush) { act.pend = {}; act.flushed = now; }
  await session.set({ healthIdle: act });
  if (!flush && !running) return;
  await withLog((log) => {
    if (flush) for (const [k, min] of Object.entries(pend)) { const [d, h] = k.split(':'); const at = R.keyDate(d); at.setHours(+h, 30); R.addActive(log, +at, min); }
    if (brk && brk[1] - brk[0] >= R.BREAK_MS) R.addBreak(log, brk[0], brk[1]);
  }, now);
}

// ------------------------------------------------------------------ coaching
async function planCoach() {
  const { healthPrefs } = await local.get('healthPrefs');
  const at = new Date(Date.now()); at.setHours(R.normPrefs(healthPrefs).notify.at, 0, 0, 0);
  if (+at <= Date.now() + 1000) at.setDate(at.getDate() + 1);
  const cur = await chrome.alarms.get('health:coach');
  if (!cur || Math.abs(cur.scheduledTime - at) > 60000) chrome.alarms.create('health:coach', { when: +at });
}
async function coachNow() {
  await planCoach();
  const now = Date.now(), st = await local.get(['healthAct', 'healthPrefs', 'reminders', 'focusLog', 'focus']);
  const p = R.normPrefs(st.healthPrefs), h = new Date(now).getHours();
  // a coaching alarm that comes hours late (the computer was asleep) isn't worth a nudge any more
  if (!p.notify.coach || h < p.notify.at || h > p.notify.at + 2) return;
  const today = R.dayKey(now), d = R.dayOf(st.healthAct, today);
  const { healthIdle } = await session.get('healthIdle');
  if (!d.activeH.some(Boolean) && !d.focus && !Object.keys(healthIdle?.pend || {}).length) return; // the computer wasn't used today
  const c = R.coach(R.ringsFor(today, { act: st.healthAct, prefs: st.healthPrefs, reminders: st.reminders, focusLog: st.focusLog, focus: st.focus, now }), now);
  if (!c) return;
  const s = await bgStrings(S);
  const text = !c.close ? (c.ring === 'focus' ? s.coachFar : null) : fmt({ focus: s.coachFocus, done: s.coachDone, breaks: s.coachBreaks }[c.ring], { n: c.need });
  if (!text) return;
  const id = 'health:coach:' + today;
  if (c.ring === 'focus') await post(id, { title: s.actTitle, body: text, buttons: [{ title: s.startFocus }] });
  else await post(id, { title: s.actTitle, body: text });
}
/** "Start Focus" from the coaching: the same session the Quick Panel starts (its 'focus' alarm ends it). */
async function startFocus() {
  const { focus, settings } = await local.get(['focus', 'settings']);
  if (focus?.startedAt && (focus.endsAt == null || focus.endsAt > Date.now())) return;
  const minutes = +settings?.focusMinutes || 25, now = Date.now(), endsAt = now + minutes * 60000;
  await local.set({ focus: { startedAt: now, endsAt, minutes } });
  chrome.alarms.create('focus', { when: endsAt });
}

// ------------------------------------------------------------------ wiring
onAlarm('health', (rest) => {
  if (rest === 'tick') return actSerial(tick);
  if (rest === 'coach') return actSerial(coachNow);
  if (rest === 'plan') return plan();
  if (rest.startsWith('medf:')) return queue(() => remind(rest.slice(5), true)).then(() => plan());
  if (rest.startsWith('med:')) return queue(() => remind(rest.slice(4), false)).then(() => plan());
});
onButton('health', (rest, i) => {
  if (rest.startsWith('med:')) return logSlot(rest.slice(4), i === 0 ? 'taken' : 'skipped');
  if (rest.startsWith('coach:') && i === 0) return startFocus();
});
openTarget('health', (rest) => ({ app: 'health', section: rest.startsWith('med') ? 'meds' : rest.startsWith('award') ? 'awards' : 'activity' }));
// the same path as the notification buttons, for pages (and the dev test)
onMessage('health-med-action', (m) => logSlot(m.slot, m.status === 'skipped' ? 'skipped' : 'taken'));
onMessage('health-plan', () => plan());
// My page › Erase health data: the page removes its keys, the worker its own (and the reminders follow the empty data)
onMessage('health-erase', () => actSerial(() => queue(async () => { await local.remove(['healthSW', 'healthAct']); await session.set({ healthIdle: {} }); })).then(() => plan()));

chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.health) planIfChanged(c.health.newValue);
  if (c.health || c.healthSW) tidy();
  const now = Date.now();
  if (c.reminders || c.focusLog || c.healthPrefs) actSerial(() => withLog(null, now));
  if (c.healthPrefs && R.normPrefs(c.healthPrefs.oldValue).notify.at !== R.normPrefs(c.healthPrefs.newValue).notify.at) planCoach();
});
if (chrome.idle) {
  chrome.idle.setDetectionInterval(IDLE_SEC);
  chrome.idle.onStateChanged.addListener((state) => { const now = Date.now(); actSerial(() => onIdle(state, now)); });
}
// the worker's own repeating alarms, checked on every start and every plan (something may have cleared them)
async function ensureAlarms() {
  if (!(await chrome.alarms.get('health:tick'))) chrome.alarms.create('health:tick', { periodInMinutes: 1 });
  if (!(await chrome.alarms.get('health:plan'))) chrome.alarms.create('health:plan', { periodInMinutes: 720 });
  if (!(await chrome.alarms.get('health:coach'))) await planCoach();
}
planCoach().catch((e) => console.warn('health coach', e));
plan();
