// Now Brief (One UI 8): a short summary of your day, read from every app's own data. In the morning (5:00–12:00) the
// first unlock or new tab of the day opens it over the Home screen: weather, today's events, reminders and medicine
// doses due, birthdays, bills due soon, the daily puzzles, the Daily activity goals and a journal prompt. From the
// evening brief time (settings.windDownAt, 21:30) until 5:00 it turns into the Evening brief: goals reached today,
// tomorrow's first event and alarm, a journal prompt, Bedtime mode (Digital Wellbeing's Quick Panel tile) and sleep
// sounds. The Lock screen shows a small card of the same (counts and times only while locked; it never names an
// event, a medicine or a person there), and the Home screen's Now Brief and Stack widgets read the same data.
//
// Settings (defaults here, not in store.js): nowBrief (morning card), nowBriefAuto (open on the first unlock),
// eveningBrief, windDownAt ('HH:MM'). "Shown today" is per computer: localStorage 'bt.briefDay'. Under automation
// (navigator.webdriver) nothing shows by itself unless localStorage 'bt.test.brief' is '1', so other suites see no
// brief. openBrief({ kind: 'morning' | 'evening' }) opens it from anywhere.
import { h, startOfDay } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, fmtDate, fmtTime, lang } from '../core/i18n.js';
import { store, setting, setSetting } from '../core/store.js';
import { openApp, getApp, appIconEl, currentApp } from '../core/apps.js';
import { getTiles, onUnlock } from '../core/hooks.js';
import { nextAlarmTime } from '../core/schedule.js';
import { toast } from '../core/ui.js';

addIcons({
  nbSunrise: '<path d="M3 18.5h18M7 15a5 5 0 0 1 10 0"/><path d="M12 4.5v3M5 8.6l1.8 1.6M19 8.6l-1.8 1.6M2.8 15h2M19.2 15h2"/>',
  nbCake: '<path d="M4 20.5h16M5.5 20.5V14a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v6.5"/><path d="M5.5 16c1.2 0 1.6-1 3.2-1s2 1 3.3 1 1.7-1 3.3-1 2 1 3.2 1M12 12.5V9"/><path d="M12 4.2c.9.9 1.1 1.8.5 2.5-.6.6-1.5.4-1.7-.4-.2-.7.4-1.4 1.2-2.1Z"/>',
  nbPill: '<path d="M10.2 4.9a4.2 4.2 0 0 1 5.9 5.9l-5.3 5.3a4.2 4.2 0 0 1-5.9-5.9l5.3-5.3Z"/><path d="m7.6 7.5 5.9 5.9"/>',
  nbReceipt: '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3v-17Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  nbPuzzle: '<path d="M10 4.5H4.5V10c1.3 0 2.3 1 2.3 2.3s-1 2.2-2.3 2.2v5H10c0-1.3 1-2.3 2.2-2.3s2.3 1 2.3 2.3h5v-5c-1.3 0-2.3-1-2.3-2.2s1-2.3 2.3-2.3V4.5h-5c0 1.3-1 2.2-2.3 2.2S10 5.8 10 4.5Z"/>',
  nbBed: '<path d="M3 18.5V6M3 14.5h18v4M21 14.5v-2.5a3 3 0 0 0-3-3h-7v5.5"/><circle cx="7" cy="11" r="1.9"/>',
  nbRings: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.2"/><circle cx="12" cy="12" r="2"/>',
  nbJournal: '<path d="M6.5 3.5h10.5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M8.5 3.5v17M11.5 8h4M11.5 11.5h4"/>',
  nbStack: '<rect x="4.5" y="8" width="15" height="12.5" rx="3"/><path d="M7 5h10M9 2.5h6"/>',
});

// ——————————————————————————————————————————————— the rules (pure, tested in .dev/brief.cjs)
export const MORNING_FROM = 5, MORNING_TO = 12, EVENING_FROM = 18;
export const WIND_DOWN_AT = '21:30';
/** The evening brief times Settings offers: every half hour from 18:00 to 01:00. */
export const WIND_TIMES = Array.from({ length: 15 }, (_, i) => {
  const m = (18 * 60 + i * 30) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'HH:MM' → minutes after midnight (anything else reads as 21:30). */
export function minutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? ''));
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : 21 * 60 + 30;
}
export const inMorning = (now = new Date()) => now.getHours() >= MORNING_FROM && now.getHours() < MORNING_TO;
/** The morning brief opens by itself once a day, on the first unlock or new tab between 5:00 and noon. */
export const briefDue = (now = new Date(), { on = true, lastDay = '' } = {}) => !!on && inMorning(now) && lastDay !== dayKey(now);
/** The evening brief runs from its time until 5:00 (a time after midnight, like 01:00, runs from then until 5:00). */
export function eveningOn(now = new Date(), { on = true, at = WIND_DOWN_AT } = {}) {
  if (!on) return false;
  const x = now.getHours() * 60 + now.getMinutes(), start = minutes(at), end = MORNING_FROM * 60;
  return start >= end ? x >= start || x < end : x >= start && x < end;
}
/** The day the evening brief looks ahead to: after midnight "tomorrow" is the day that has already begun. */
export function comingDay(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() >= MORNING_FROM) d.setDate(d.getDate() + 1);
  return d;
}
/** The part of the day the Stack widget turns by: morning, day, evening, or night (the evening brief). */
export function phase(now = new Date(), { evening = true, at = WIND_DOWN_AT } = {}) {
  if (eveningOn(now, { on: evening, at })) return 'night';
  const hr = now.getHours();
  return hr >= MORNING_FROM && hr < MORNING_TO ? 'morning' : hr >= MORNING_TO && hr < EVENING_FROM ? 'day' : 'evening';
}
/** How many of the three Daily activity goals are reached. */
export const closedCount = (r) => ['focus', 'done', 'breaks'].filter((k) => r?.[k] && r[k].goal > 0 && r[k].v >= r[k].goal).length;
/** Journal prompts about the day that is ending (keys of js/journal/prompts.js), one per evening. */
export const EVENING_PROMPTS = ['p1', 'p9', 'p13', 'p17', 'p32', 'p36', 'p40'];
export function eveningPrompt(now = new Date()) {
  const k = dayKey(new Date(now.getTime() - MORNING_FROM * 3600e3));
  let x = 0;
  for (const c of k) x = (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0;
  return EVENING_PROMPTS[x % EVENING_PROMPTS.length];
}

// ——————————————————————————————————————————————— settings
export function prefs() {
  const s = store.get('settings');
  const at = /^\d{2}:\d{2}$/.test(s.windDownAt || '') ? s.windDownAt : WIND_DOWN_AT;
  return { morning: s.nowBrief !== false, auto: s.nowBriefAuto !== false, evening: s.eveningBrief !== false, at };
}
export const eveningNow = (now = new Date()) => { const p = prefs(); return eveningOn(now, { on: p.evening, at: p.at }); };
export const phaseNow = (now = new Date()) => { const p = prefs(); return phase(now, { evening: p.evening, at: p.at }); };
/** Which brief a tap opens right now. */
export const kindNow = (now = new Date()) => (eveningNow(now) ? 'evening' : 'morning');
// Briefs never pop up in a browser driven by a script unless the test asks for them.
export const autoAllowed = () => {
  try {
    return !navigator.webdriver || localStorage.getItem('bt.test.brief') === '1';
  } catch {
    return true;
  }
};
const LAST = 'bt.briefDay';
const lastDay = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };
const markShown = (now = new Date()) => { try { localStorage.setItem(LAST, dayKey(now)); } catch {} };

// ——————————————————————————————————————————————— each app's part (every read is guarded: one broken app never hides the rest)
async function safe(fn, def) {
  try {
    const v = await fn();
    return v ?? def;
  } catch (e) {
    console.warn('brief', e);
    return def;
  }
}
const hm = (s) => { const [a, b] = String(s).split(':').map(Number); return fmtTime(new Date(2026, 0, 1, a || 0, b || 0)); };
const dueMs = (v) => (typeof v === 'number' ? v : /^\d{4}-\d\d-\d\d/.test(v || '') ? +new Date(v.length > 10 ? v : v + 'T00:00') : 0);

export const weather = () => safe(async () => {
  const w = store.get('weather');
  if (!w?.current) return null;
  const m = await import('../services/weather.js');
  const info = m.weatherInfo(w.current.code, w.current.isDay);
  const d0 = w.daily?.[0] || {};
  return { temp: m.fmtTemp(w.current.temp), hi: m.fmtTemp(d0.max ?? w.current.high), lo: m.fmtTemp(d0.min ?? w.current.low), label: info.label, icon: info.icon, city: w.location?.name || '', pop: d0.pop || 0 };
}, null);

/** The events of a day that haven't ended (all-day ones first). */
export const dayEvents = (day = new Date(), now = new Date()) => safe(async () => {
  const cal = await import('../apps/calendar.js');
  const from = +startOfDay(day), to = from + 864e5;
  // birthdays (Calendar shows Contacts' ones) have a card of their own
  return (cal.upcomingEvents?.(300) || [])
    .filter((e) => e.cal !== 'birthdays' && e.start < to && (e.end || e.start) >= Math.max(from, e.allDay ? from : +now))
    .sort((a, b) => (b.allDay - a.allDay) || a.start - b.start)
    .map((e) => ({ id: e.id, title: e.title || t('common.untitled'), allDay: !!e.allDay, start: e.start, color: e.color || 'var(--accent)', time: e.allDay ? t('brief.allDay') : fmtTime(new Date(e.start)) }));
}, []);

export const reminders = (now = new Date()) => safe(() => {
  const v = store.get('reminders');
  const items = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
  const s0 = +startOfDay(now), end = s0 + 864e5;
  const open = items.filter((r) => r && !r.done && dueMs(r.due) && dueMs(r.due) < end).sort((a, b) => dueMs(a.due) - dueMs(b.due));
  return { today: open.filter((r) => dueMs(r.due) >= s0).length, overdue: open.filter((r) => dueMs(r.due) < s0).length, total: open.length, titles: open.slice(0, 3).map((r) => r.title || t('common.untitled')) };
}, { today: 0, overdue: 0, total: 0, titles: [] });

/** Today's medicine doses: { total, taken, left, due (doses whose time has come, not logged), next: { time, n } } */
export const meds = (now = new Date()) => safe(async () => {
  const H = await import('../health/data.js');
  const x = H.todayHealth(+now);
  const doses = x.medsDue || [];
  if (!doses.length) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const open = doses.filter((d) => !d.status);
  const due = open.filter((d) => minutes(d.time) <= mins).length;
  const next = x.next ? { time: hm(x.next.t), n: x.next.doses?.length || 1, names: (x.next.doses || []).map((d) => d.med?.nick || d.med?.name).filter(Boolean) } : null;
  return { total: doses.length, taken: doses.filter((d) => d.status === 'taken').length, left: open.length, due, next };
}, null);

export const birthdays = (days = 0, now = new Date()) => safe(async () => (await import('../apps/contacts.js')).upcomingBirthdays(days, now), []);

export const bills = (days = 3) => safe(async () => {
  const [W, money, fmt] = await Promise.all([import('../wallet/data.js'), import('../wallet/money.js'), import('../wallet/format.js')]);
  return W.nextBills(days).map((b) => ({ ...b, amountText: money.money(b.amount, b.currency), when: fmt.whenText(b.date) }));
}, []);

export const puzzles = () => safe(async () => {
  const G = await import('../apps/games.js');
  const list = G.todayPuzzles();
  return { list, solved: list.filter((p) => p.solved).length, total: list.length, streak: G.streak(), next: list.find((p) => !p.solved)?.id || '' };
}, null);

export const rings = (now = new Date()) => safe(async () => {
  const [H, A, R, F] = await Promise.all([import('../health/data.js'), import('../health/art.js'), import('../health/rings.js'), import('../health/format.js')]);
  const r = H.todayRings(+now);
  const label = R.RINGS.map((k) => `${F.ringName(k)} ${F.ringValue(k, r[k])}`).join(', ');
  return {
    r,
    closed: closedCount(r),
    svg: (o = {}) => A.ringsSVG(r, { width: 12, gap: 3, label, ...o }),
    rows: R.RINGS.map((k) => ({ k, name: F.ringName(k), value: F.ringValue(k, r[k]), color: R.COLORS[k].c })),
  };
}, null);

/** The journal prompt: the day's reflection prompt in the morning, one about the day in the evening. */
export const prompt = (now = new Date(), evening = false) => safe(async () => {
  const [JM, P] = await Promise.all([import('../journal/model.js'), import('../journal/prompts.js')]);
  const key = evening ? eveningPrompt(now) : JM.promptKey(+now);
  let wrote = false;
  try {
    wrote = JM.onDay(JM.norm(store.get(JM.KEY)), JM.dayKey(+now)).length > 0;
  } catch {}
  return { key, text: P.promptText(key), wrote };
}, null);

/** The alarm that wakes you on the coming day (one that rings before noon). */
export function wakeAlarm(now = new Date(), day = comingDay(now)) {
  try {
    const next = (store.get('alarms') || []).filter((a) => a?.enabled).map((a) => nextAlarmTime(a, +now)).filter(Boolean).sort((a, b) => a - b)[0];
    const noon = new Date(day);
    noon.setHours(12, 0, 0, 0);
    return next && next < +noon ? next : null;
  } catch (e) {
    console.warn('brief', e);
    return null;
  }
}
/** Digital Wellbeing's Bedtime mode, through its Quick Panel tile (no import of the app needed). */
export const bedtimeTile = () => getTiles().find((x) => x.id === 'bedtime') || null;
const sounds = () => import('./sounds.js');

export async function morning(now = new Date()) {
  const [w, evs, rem, md, bd, bl, pz, rg, pr] = await Promise.all([weather(), dayEvents(now, now), reminders(now), meds(now), birthdays(0, now), bills(3), puzzles(), rings(now), prompt(now)]);
  return { kind: 'morning', now, weather: w, events: evs, reminders: rem, meds: md, birthdays: bd, bills: bl, puzzles: pz, rings: rg, prompt: pr };
}
export async function evening(now = new Date()) {
  const day = comingDay(now);
  const [w, evs, rg, pr, snd] = await Promise.all([weather(), dayEvents(day, now), rings(now), prompt(now, true), safe(async () => (await sounds()).state().playing, false)]);
  const first = evs.find((e) => !e.allDay) || evs[0] || null;
  const tile = bedtimeTile();
  return { kind: 'evening', now, day, weather: w, tomorrow: first, more: Math.max(0, evs.length - 1), alarm: wakeAlarm(now, day), rings: rg, prompt: pr, bedtime: tile ? !!safe0(() => tile.on()) : null, sounds: snd };
}
function safe0(fn) {
  try {
    return fn();
  } catch {
    return false;
  }
}
export const data = (kind = kindNow(), now = new Date()) => (kind === 'evening' ? evening(now) : morning(now));

// ——————————————————————————————————————————————— words
export function greeting(now = new Date()) {
  const hr = now.getHours();
  return t(hr < 5 ? 'brief.night' : hr < 12 ? 'brief.morning' : hr < 18 ? 'brief.afternoon' : 'brief.evening');
}
/** "1 event" / "2 events" (Arabic has its own dual). */
export function cnt(key, n) {
  const form = n === 1 ? 'one' : n === 2 && lang() === 'ar' ? 'two' : 'n';
  return t(`${key}.${form}`, { n });
}
const dayWord = (d, now = new Date()) => (dayKey(d) === dayKey(now) ? t('common.today') : t('common.tomorrow'));
export const goalsText = (n) => (n >= 3 ? t('brief.allGoals') : t('brief.goals', { n }));

// ——————————————————————————————————————————————— what a tap opens
const go = {
  weather: () => openApp('weather'),
  calendar: (d) => openApp('calendar', { params: d.date ? { date: +d.date } : {} }),
  reminder: () => openApp('reminder'),
  meds: () => openApp('health', { params: { section: 'meds' } }),
  rings: () => openApp('health', { params: { section: 'activity' } }),
  contacts: (d) => openApp('contacts', { params: d.id ? { id: d.id } : {} }),
  bills: () => openApp('wallet', { params: { section: 'bills' } }),
  games: (d) => import('../apps/games.js').then((m) => m.openGames(d.game || 'home', !!d.game)),
  journal: (d) => openApp('journal', { params: { section: 'new', ...(d.prompt ? { prompt: d.prompt } : {}) } }),
  clock: () => openApp('clock', { params: { tab: 'alarm' } }),
};
/** Bedtime mode and sleep sounds work right where they are (also on the Lock screen); the rest opens an app. */
export const acts = {
  async bedtime() {
    const tile = bedtimeTile();
    if (!tile) return false;
    await tile.toggle();
    return !!safe0(() => tile.on());
  },
  async sounds() {
    const s = await sounds();
    if (s.state().playing) {
      s.pause();
      return false;
    }
    s.play(s.state().id || 'rain');
    // sleep sounds stop by themselves after half an hour, like a sleep timer
    clearTimeout(acts._t);
    acts._t = setTimeout(() => s.state().playing && s.pause(), 30 * 60e3);
    return true;
  },
};

// ——————————————————————————————————————————————— the sheet
const appIco = (id, size = 30) => (getApp(id) ? appIconEl(getApp(id), size) : h('span', { class: 'nbr-ico-fallback', html: icon('apps', 18) }));

function card({ go: target, data: d = {}, app, ico, title, sub, body, action, cls = '' }) {
  return h('div', { class: ['nbr-card', cls], role: 'button', tabindex: 0, dataset: { go: target, ...d } },
    h('div', { class: 'nbr-card-head' }, ico || appIco(app), h('span', { class: 'nbr-card-title' }, title), action || null),
    sub ? h('div', { class: 'nbr-card-sub' }, sub) : null,
    body || null);
}
const pill = (label, act, extra = {}) => h('button', { type: 'button', class: 'nbr-pill', dataset: { act, ...extra } }, label);
const evRows = (list) => h('div', { class: 'nbr-evs' }, list.map((e) => h('div', { class: 'nbr-ev', style: { '--ev': e.color } }, h('i'), h('em', null, e.time), h('span', null, e.title))));

function morningCards(m) {
  const out = [];
  if (m.weather) {
    const w = m.weather;
    out.push(h('div', { class: 'nbr-card nbr-wx', role: 'button', tabindex: 0, dataset: { go: 'weather' } },
      h('span', { class: 'nbr-wx-ico', html: w.icon }),
      h('div', { class: 'nbr-wx-main' }, h('b', null, w.temp), h('span', null, w.label), h('small', null, [t('brief.hl', { h: w.hi, l: w.lo }), w.city].filter(Boolean).join(' · ')))));
  }
  const ev = m.events;
  out.push(card({ go: 'calendar', app: 'calendar', title: t('brief.schedule'), sub: ev.length ? cnt('brief.events', ev.length) : `${t('brief.noEventsToday')} · ${t('brief.enjoy')}`, body: ev.length ? h('div', null, evRows(ev.slice(0, 3)), ev.length > 3 ? h('div', { class: 'nbr-more' }, t('brief.more', { n: ev.length - 3 })) : null) : null }));
  const r = m.reminders;
  if (r.total) out.push(card({ go: 'reminder', app: 'reminder', title: t('brief.remTitle'), sub: [r.today && cnt('brief.dueToday', r.today), r.overdue && cnt('brief.overdue', r.overdue)].filter(Boolean).join(' · '), body: h('ul', { class: 'nbr-list' }, r.titles.map((x) => h('li', null, x))) }));
  if (m.meds) {
    const md = m.meds;
    out.push(card({ go: 'meds', app: 'health', title: t('brief.meds'), sub: [md.next ? t('brief.nextDose', { time: md.next.time }) : t('brief.allTaken'), t('brief.taken', { n: md.taken, total: md.total })].join(' · '), body: md.next?.names.length ? h('ul', { class: 'nbr-list' }, md.next.names.slice(0, 3).map((x) => h('li', null, x))) : null }));
  }
  if (m.birthdays.length) {
    const b = m.birthdays[0];
    out.push(card({ go: 'contacts', data: { id: b.id }, app: 'contacts', title: t('brief.birthdays'), sub: m.birthdays.length > 1 ? t('brief.more', { n: m.birthdays.length - 1 }) : '', body: h('div', { class: 'nbr-big' }, b.age ? t('brief.turns', { name: b.name, n: b.age }) : t('brief.bdayOf', { name: b.name })) }));
  }
  if (m.bills.length) out.push(card({ go: 'bills', app: 'wallet', title: t('brief.bills'), body: h('ul', { class: 'nbr-list' }, m.bills.slice(0, 3).map((b) => h('li', null, h('span', null, b.name), h('em', null, `${b.when} · ⁨${b.amountText}⁩`)))) }));
  const p = m.puzzles;
  if (p?.total) out.push(card({ go: 'games', data: p.next ? { game: p.next } : {}, app: 'games', title: t('brief.puzzles'), sub: [t('brief.solved', { n: p.solved, total: p.total }), p.streak ? cnt('brief.streak', p.streak) : ''].filter(Boolean).join(' · '), action: p.next ? pill(t('brief.play'), 'play', { game: p.next }) : null }));
  if (m.rings) out.push(ringsCard(m.rings));
  if (m.prompt) out.push(card({ go: 'journal', data: { prompt: m.prompt.key }, app: 'journal', title: t('brief.journal'), cls: 'nbr-prompt', body: h('div', { class: 'nbr-quote' }, m.prompt.text), action: pill(t('brief.write'), 'write', { prompt: m.prompt.key }) }));
  return out;
}
function ringsCard(rg, title = t('brief.activity'), sub = '') {
  return card({ go: 'rings', app: 'health', title, sub, cls: 'nbr-rings',
    body: h('div', { class: 'nbr-ringrow' }, h('span', { class: 'nbr-ringsvg', html: rg.svg() }),
      h('div', { class: 'nbr-ringvals' }, rg.rows.map((x) => h('div', null, h('i', { style: { background: x.color } }), h('span', null, x.name), h('b', { style: { color: x.color } }, x.value))))) });
}
function eveningCards(e) {
  const out = [];
  if (e.rings) out.push(ringsCard(e.rings, goalsText(e.rings.closed), t('brief.activityToday')));
  const when = dayWord(e.day, e.now);
  const tm = e.tomorrow;
  out.push(card({ go: 'calendar', data: { date: +e.day }, app: 'calendar', title: when,
    sub: tm ? (e.more ? t('brief.more', { n: e.more }) : '') : (when === t('common.today') ? t('brief.noEventsToday') : t('brief.noEventsTomorrow')),
    body: tm ? evRows([tm]) : null }));
  out.push(card({ go: 'clock', app: 'clock', title: e.alarm ? t('brief.alarmAt', { time: fmtTime(new Date(e.alarm)) }) : t('brief.noAlarm'), sub: e.alarm ? dayWord(new Date(e.alarm), e.now) : t('brief.setAlarm') }));
  if (e.prompt) out.push(card({ go: 'journal', data: { prompt: e.prompt.key }, app: 'journal', title: t('brief.writeToday'), cls: 'nbr-prompt', sub: e.prompt.wrote ? t('brief.wrote') : '', body: h('div', { class: 'nbr-quote' }, e.prompt.text), action: pill(t('brief.write'), 'write', { prompt: e.prompt.key }) }));
  return out;
}
function windActs(e) {
  return h('div', { class: 'nbr-acts' },
    e.bedtime == null ? null : h('button', { type: 'button', class: ['nbr-act', e.bedtime && 'on'], dataset: { act: 'bedtime' }, 'aria-pressed': String(!!e.bedtime) }, h('span', { html: icon('nbBed', 22) }), h('span', null, t('brief.bedtime'))),
    h('button', { type: 'button', class: ['nbr-act', e.sounds && 'on'], dataset: { act: 'sounds' }, 'aria-pressed': String(!!e.sounds) }, h('span', { html: icon('rain', 22) }), h('span', null, t('brief.sleepSounds'))));
}
export function summary(d) {
  if (d.kind === 'evening') {
    const parts = [d.tomorrow ? t('brief.startsAt', { when: dayWord(d.day, d.now), time: d.tomorrow.time }) : '', d.alarm ? t('brief.alarmAt', { time: fmtTime(new Date(d.alarm)) }) : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('brief.windDown');
  }
  const parts = [d.events.length ? cnt('brief.events', d.events.length) : '', d.reminders.total ? cnt('brief.remindersN', d.reminders.total) : '', d.meds?.left ? cnt('brief.doses', d.meds.left) : ''].filter(Boolean);
  return parts.length ? t('brief.youHave', { list: parts.join(t('brief.and')) }) : t('brief.clear');
}

let cur = null;
export const briefOpen = () => !!cur;
export const closeBrief = () => cur?.close();

/** Opens the Now Brief sheet over the Home screen. kind: 'morning' | 'evening' (default: by the time of day). */
export async function openBrief({ kind = kindNow(), auto = false } = {}) {
  cur?.close(true);
  const d = await data(kind);
  const scrim = h('div', { class: ['nbr-scrim', kind === 'evening' && 'night'] });
  const panel = h('section', { class: 'nbr', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nbr-hello', tabindex: -1, dataset: { kind } });
  const draw = (x) => {
    const top = panel.querySelector('.nbr-scroll')?.scrollTop || 0;
    panel.replaceChildren(
      h('div', { class: 'nbr-grab', 'aria-hidden': 'true' }),
      h('header', { class: 'nbr-head' },
        h('span', { class: 'nbr-kick' }, h('span', { html: icon(kind === 'evening' ? 'moon' : 'nbSunrise', 18) }), t('brief.name')),
        h('span', { class: 'nbr-date' }, fmtDate(x.now, { weekday: 'long', month: 'long', day: 'numeric' })),
        h('button', { type: 'button', class: 'ou-icon-btn nbr-x', 'aria-label': t('common.close'), title: t('common.close'), html: icon('close', 20), dataset: { act: 'close' } })),
      h('div', { class: 'nbr-scroll scroll' },
        h('h2', { class: 'nbr-hello', id: 'nbr-hello' }, greeting(x.now)),
        h('p', { class: 'nbr-sum' }, summary(x)),
        h('div', { class: 'nbr-cards' }, kind === 'evening' ? eveningCards(x) : morningCards(x)),
        kind === 'evening' ? windActs(x) : null),
      h('footer', { class: 'nbr-foot' },
        kind === 'morning' && prefs().auto ? h('button', { type: 'button', class: 'ou-btn nbr-never', dataset: { act: 'never' } }, t('brief.dontAuto')) : h('span'),
        h('button', { type: 'button', class: 'ou-btn primary nbr-ok', dataset: { act: 'close' } }, t('common.done'))));
    const sc = panel.querySelector('.nbr-scroll');
    if (sc) sc.scrollTop = top;
  };
  draw(d);
  scrim.appendChild(panel);
  (document.getElementById('overlay-layer') || document.body).appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('show'));
  const prevFocus = document.activeElement;
  let closed = false;
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.ou-menu-scrim, .ou-dialog-scrim')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  };
  addEventListener('keydown', onKey, true);
  const offs = ['weather', 'events', 'reminders', 'health', 'alarms', 'wellbeing'].map((k) => store.on(k, () => !closed && data(kind).then((x) => !closed && draw(x))));
  function close(instant = false) {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    offs.forEach((f) => f());
    if (cur?.el === scrim) cur = null;
    if (instant) return scrim.remove();
    scrim.classList.remove('show');
    scrim.classList.add('out');
    setTimeout(() => scrim.remove(), 320);
    if (prevFocus?.isConnected && !document.body.classList.contains('locked')) prevFocus.focus?.({ preventScroll: true });
  }
  const run = async (b) => {
    const a = b.dataset.act;
    if (a === 'close') return close();
    if (a === 'never') {
      setSetting('nowBriefAuto', false);
      close();
      toast(t('brief.neverToast'));
      return;
    }
    if (a === 'bedtime' || a === 'sounds') {
      const on = await acts[a]();
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-pressed', String(!!on));
      return;
    }
    const target = a === 'play' ? 'games' : a === 'write' ? 'journal' : b.dataset.go;
    if (!go[target]) return;
    close();
    setTimeout(() => go[target]({ ...b.dataset }), 180);
  };
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-go]');
    if (b) run(b);
  });
  panel.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nbr-card')) {
      e.preventDefault();
      run(e.target);
    }
  });
  scrim.addEventListener('pointerdown', (e) => { scrim._down = e.target === scrim; });
  scrim.addEventListener('click', (e) => { if (e.target === scrim && scrim._down) close(); });
  bindSwipe(panel, close);
  requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  cur = { el: scrim, close, kind, auto };
  return cur;
}

// Drag the sheet down by its top (mouse, pen or touch) to put it away, like a One UI bottom sheet.
function bindSwipe(panel, close) {
  let y0 = null, dy = 0;
  panel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.target.closest('.nbr-grab, .nbr-head') || e.target.closest('button')) return;
    y0 = e.clientY;
    dy = 0;
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = dy ? `translateY(${dy}px)` : '';
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transform = '';
    if (dy > 90) close();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

// ——————————————————————————————————————————————— the Lock screen card
/** Whether the Lock screen shows a brief card right now, and which. */
export function lockKind(now = new Date()) {
  if (!autoAllowed()) return '';
  const p = prefs();
  if (eveningOn(now, { on: p.evening, at: p.at })) return 'evening';
  return p.morning && inMorning(now) ? 'morning' : '';
}
const chip = (ic, text) => h('span', { class: 'lkb-chip' }, h('span', { html: icon(ic, 16) }), text);

/** The small card on the Lock screen: counts and times only, never a name or a title. onOpen() unlocks and opens the
 *  sheet. → Element | null */
export async function lockCard({ onOpen } = {}) {
  const kind = lockKind();
  if (!kind) return null;
  const d = await data(kind);
  const head = h('div', { class: 'lkb-head' },
    h('span', { class: 'lkb-kick', html: icon(kind === 'evening' ? 'moon' : 'nbSunrise', 18) }),
    h('b', null, t('brief.name')), h('span', { class: 'lkb-hello' }, greeting(d.now)),
    d.weather ? h('span', { class: 'lkb-wx' }, h('span', { html: d.weather.icon }), d.weather.temp) : null);
  let body;
  if (kind === 'morning') {
    const chips = [
      chip('calendar', d.events.length ? cnt('brief.events', d.events.length) : t('brief.noEvents')),
      d.reminders.total ? chip('checkCircle', cnt('brief.remindersN', d.reminders.total)) : null,
      d.meds?.due ? chip('nbPill', cnt('brief.dosesDue', d.meds.due)) : d.meds?.next ? chip('nbPill', t('brief.nextDose', { time: d.meds.next.time })) : null,
      d.birthdays.length ? chip('nbCake', cnt('brief.bdays', d.birthdays.length)) : null,
      d.bills.length ? chip('nbReceipt', cnt('brief.billsN', d.bills.length)) : null,
      d.puzzles?.total ? chip('nbPuzzle', t('brief.solved', { n: d.puzzles.solved, total: d.puzzles.total })) : null,
    ].filter(Boolean);
    body = h('div', { class: 'lkb-chips' }, chips);
  } else {
    body = h('div', { class: 'lkb-night' },
      d.rings ? h('span', { class: 'lkb-rings' }, h('span', { class: 'lkb-ringsvg', html: d.rings.svg({ width: 14, gap: 4, label: '' }) }), goalsText(d.rings.closed)) : null,
      chip('calendar', d.tomorrow ? t('brief.startsAt', { when: dayWord(d.day, d.now), time: d.tomorrow.time }) : dayKey(d.day) === dayKey(d.now) ? t('brief.noEventsToday') : t('brief.noEventsTomorrow')),
      chip('alarm', d.alarm ? fmtTime(new Date(d.alarm)) : t('brief.noAlarm')));
  }
  // the evening's two buttons sit in the same row as the facts, so the card stays two lines tall
  if (kind === 'evening') body.append(...windActs(d).children);
  const el = h('div', { class: ['lkb', kind === 'evening' && 'night'], role: 'button', tabindex: 0, 'aria-label': `${t('brief.name')} · ${greeting(d.now)}`, dataset: { kind } }, head, body);
  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-act]');
    if (b) {
      const on = await acts[b.dataset.act]?.();
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-pressed', String(!!on));
      return;
    }
    onOpen?.(kind);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === el) {
      e.preventDefault();
      e.stopPropagation();
      onOpen?.(kind);
    }
  });
  return el;
}

// ——————————————————————————————————————————————— when it opens by itself
let waitT = 0;
function maybeShow(tries = 0) {
  clearTimeout(waitT);
  const now = new Date(), p = prefs();
  if (!autoAllowed() || cur || !p.auto || !briefDue(now, { on: p.morning, lastDay: lastDay() })) return;
  // the first unlock shows it (onUnlock brings us back), and a tab in the background waits until it's looked at
  if (document.body.classList.contains('locked') || document.visibilityState !== 'visible') return;
  // an app opened from a notification goes first; the next unlock or new tab gets the brief
  if (currentApp()) return;
  // the welcome tour, What's new, a dialog, the Daily Board or a ringing alarm go first: try again once they're gone
  if (document.documentElement.classList.contains('onb-pending') || setting('onboarded') === false || document.querySelector('.ou-dialog-scrim, .db, .aod, .clk-ringing, .onb')) {
    if (tries < 40) waitT = setTimeout(() => maybeShow(tries + 1), 1500);
    return;
  }
  markShown(now);
  openBrief({ kind: 'morning', auto: true });
}
const soon = (ms = 700) => {
  clearTimeout(waitT);
  waitT = setTimeout(() => maybeShow(0), ms);
};

let inited = false;
export function initBrief() {
  if (inited) return;
  inited = true;
  onUnlock(() => soon(700));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon(600));
  soon(1200);
}

addStrings({
  en: {
    'brief.allDay': 'All day',
    'brief.more': '+{n} more',
    'brief.hl': 'H {h} · L {l}',
    'brief.schedule': 'Schedule',
    'brief.noEventsToday': 'No events today',
    'brief.noEventsTomorrow': 'No events tomorrow',
    'brief.enjoy': 'Enjoy your day',
    'brief.remTitle': 'Reminders',
    'brief.meds': 'Medications',
    'brief.nextDose': 'Next dose {time}',
    'brief.allTaken': 'All doses logged',
    'brief.taken': '{n} of {total} taken',
    'brief.birthdays': 'Birthdays',
    'brief.turns': '{name} turns {n} today',
    'brief.bdayOf': 'It’s {name}’s birthday',
    'brief.bills': 'Upcoming bills',
    'brief.puzzles': 'Daily puzzles',
    'brief.solved': '{n}/{total} solved',
    'brief.play': 'Play',
    'brief.activity': 'Daily activity',
    'brief.activityToday': 'Daily activity today',
    'brief.journal': 'Journal',
    'brief.write': 'Write',
    'brief.writeToday': 'Write about today',
    'brief.wrote': 'You wrote today',
    'brief.alarmAt': 'Alarm {time}',
    'brief.noAlarm': 'No alarm',
    'brief.setAlarm': 'Set an alarm for the morning',
    'brief.bedtime': 'Bedtime mode',
    'brief.sleepSounds': 'Sleep sounds',
    'brief.allGoals': 'All 3 goals reached',
    'brief.goals': '{n} of 3 goals reached',
    'brief.startsAt': '{when} starts at {time}',
    'brief.windDown': 'Time to wind down.',
    'brief.youHave': 'You have {list} today.',
    'brief.and': ', ',
    'brief.clear': 'Nothing planned. Enjoy your day.',
    'brief.dontAuto': 'Don’t show automatically',
    'brief.neverToast': 'You can turn this back on in Settings › Lock screen.',
    'brief.events.one': '1 event', 'brief.events.two': '2 events', 'brief.events.n': '{n} events',
    'brief.remindersN.one': '1 reminder', 'brief.remindersN.two': '2 reminders', 'brief.remindersN.n': '{n} reminders',
    'brief.dueToday.one': '1 due today', 'brief.dueToday.two': '2 due today', 'brief.dueToday.n': '{n} due today',
    'brief.overdue.one': '1 overdue', 'brief.overdue.two': '2 overdue', 'brief.overdue.n': '{n} overdue',
    'brief.doses.one': '1 dose', 'brief.doses.two': '2 doses', 'brief.doses.n': '{n} doses',
    'brief.dosesDue.one': '1 dose due', 'brief.dosesDue.two': '2 doses due', 'brief.dosesDue.n': '{n} doses due',
    'brief.bdays.one': '1 birthday', 'brief.bdays.two': '2 birthdays', 'brief.bdays.n': '{n} birthdays',
    'brief.billsN.one': '1 bill due', 'brief.billsN.two': '2 bills due', 'brief.billsN.n': '{n} bills due',
    'brief.streak.one': '1-day streak', 'brief.streak.two': '2-day streak', 'brief.streak.n': '{n}-day streak',
  },
  ar: {
    'brief.allDay': 'طوال اليوم',
    'brief.more': '+{n} أخرى',
    'brief.hl': 'العظمى {h} · الصغرى {l}',
    'brief.schedule': 'الجدول',
    'brief.noEventsToday': 'لا توجد أحداث اليوم',
    'brief.noEventsTomorrow': 'لا توجد أحداث غدًا',
    'brief.enjoy': 'استمتع بيومك',
    'brief.remTitle': 'التذكيرات',
    'brief.meds': 'الأدوية',
    'brief.nextDose': 'الجرعة التالية {time}',
    'brief.allTaken': 'تم تسجيل كل الجرعات',
    'brief.taken': 'تم تناول {n} من {total}',
    'brief.birthdays': 'أعياد الميلاد',
    'brief.turns': 'يبلغ {name} {n} عامًا اليوم',
    'brief.bdayOf': 'اليوم عيد ميلاد {name}',
    'brief.bills': 'الفواتير القادمة',
    'brief.puzzles': 'الأحاجي اليومية',
    'brief.solved': 'تم حل {n}/{total}',
    'brief.play': 'العب',
    'brief.activity': 'النشاط اليومي',
    'brief.activityToday': 'النشاط اليومي اليوم',
    'brief.journal': 'اليوميات',
    'brief.write': 'اكتب',
    'brief.writeToday': 'اكتب عن يومك',
    'brief.wrote': 'كتبت اليوم',
    'brief.alarmAt': 'منبه {time}',
    'brief.noAlarm': 'لا يوجد منبه',
    'brief.setAlarm': 'اضبط منبهًا للصباح',
    'brief.bedtime': 'وضع وقت النوم',
    'brief.sleepSounds': 'أصوات النوم',
    'brief.allGoals': 'تم بلوغ الأهداف الثلاثة',
    'brief.goals': 'تم بلوغ {n} من 3 أهداف',
    'brief.startsAt': '{when} يبدأ في {time}',
    'brief.windDown': 'حان وقت الاسترخاء.',
    'brief.youHave': 'لديك اليوم {list}.',
    'brief.and': '، ',
    'brief.clear': 'لا شيء مخطط له. استمتع بيومك.',
    'brief.dontAuto': 'عدم الإظهار تلقائيًا',
    'brief.neverToast': 'يمكنك تشغيله مرة أخرى من الإعدادات › شاشة القفل.',
    'brief.events.one': 'حدث واحد', 'brief.events.two': 'حدثان', 'brief.events.n': '{n} أحداث',
    'brief.remindersN.one': 'تذكير واحد', 'brief.remindersN.two': 'تذكيران', 'brief.remindersN.n': '{n} تذكيرات',
    'brief.dueToday.one': 'واحد مستحق اليوم', 'brief.dueToday.two': 'اثنان مستحقان اليوم', 'brief.dueToday.n': '{n} مستحقة اليوم',
    'brief.overdue.one': 'واحد متأخر', 'brief.overdue.two': 'اثنان متأخران', 'brief.overdue.n': '{n} متأخرة',
    'brief.doses.one': 'جرعة واحدة', 'brief.doses.two': 'جرعتان', 'brief.doses.n': '{n} جرعات',
    'brief.dosesDue.one': 'جرعة واحدة مستحقة', 'brief.dosesDue.two': 'جرعتان مستحقتان', 'brief.dosesDue.n': '{n} جرعات مستحقة',
    'brief.bdays.one': 'عيد ميلاد واحد', 'brief.bdays.two': 'عيدا ميلاد', 'brief.bdays.n': '{n} أعياد ميلاد',
    'brief.billsN.one': 'فاتورة مستحقة', 'brief.billsN.two': 'فاتورتان مستحقتان', 'brief.billsN.n': '{n} فواتير مستحقة',
    'brief.streak.one': 'سلسلة يوم واحد', 'brief.streak.two': 'سلسلة يومين', 'brief.streak.n': 'سلسلة {n} أيام',
  },
});
