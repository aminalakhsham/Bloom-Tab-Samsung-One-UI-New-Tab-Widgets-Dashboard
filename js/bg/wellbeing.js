// Digital Wellbeing in the service worker. It counts the time spent on the site in front (only while Chrome's window
// is focused and the computer is in use), keeps today's Notifications received and Unlocks counters, pauses sites by
// sending their tab to wellbeing-blocked.html (site timers, Focus modes and the Quick Panel's Focus, Bedtime mode),
// warns 5 minutes before a site timer runs out, says when the screen time goal is reached and posts the weekly report
// on Monday morning. Counting and pausing need the optional "tabs" permission (asked by the app's "Get started");
// nothing leaves the computer. Data shapes: js/wellbeing/model.js.
// Alarms (kind "wb"): wb:flush every minute, wb:check when a timer or a pass is due, wb:bed when Bedtime starts or
// ends, wb:mode when a Focus mode ends, wb:week on Monday at 9:00. The SW sleeps any time: state lives in storage
// (`wellbeingUsage`, only ever written here, and the session key `wbSeg` for the site being counted right now).
import { onAlarm, openTarget, onMessage, post, bgStrings, fmt, bgLocale, IDLE_SECONDS } from './hub.js';
import * as M from '../wellbeing/model.js';
import { siteOf, categoryOf } from '../wellbeing/categories.js';
import '../wellbeing/actions.js'; // Routines: Bedtime mode, Focus modes (they only write `wellbeing`)

const local = chrome.storage.local, session = chrome.storage.session;
const PAGE = 'wellbeing-blocked.html';

const S = {
  en: {
    paused: 'Site paused', pausedBody: 'Your site timer for {site} ran out. It starts again tomorrow.',
    timer: 'Site timer', warn: '5 minutes left on {site} today.',
    goalTitle: 'Screen time goal reached', goalBody: 'You’ve used {t} today. Maybe time for a break?',
    weekTitle: 'Your weekly report is ready',
    weekDown: 'Your screen time was down {p} last week, for an average of {t} a day.',
    weekUp: 'Your screen time was up {p} last week, for an average of {t} a day.',
    weekAvg: 'You averaged {t} of screen time a day last week.',
    modeEnded: '{name} ended', modeEndedBody: 'Sites aren’t paused anymore.',
    mode_work: 'Work time', mode_me: 'Me time',
    hrs: '{n} hrs', hr: '1 hr', mins: '{n} mins', min: '1 min',
    cat_social: 'Social', cat_games: 'Games', cat_entertainment: 'Entertainment', cat_creativity: 'Creativity',
    cat_productivity: 'Productivity & finance', cat_education: 'Education', cat_reading: 'News & reading',
    cat_health: 'Health & fitness', cat_utilities: 'Utilities', cat_shopping: 'Shopping & food', cat_travel: 'Travel', cat_other: 'Other',
  },
  ar: {
    paused: 'تم إيقاف الموقع مؤقتًا', pausedBody: 'انتهى مؤقت موقع {site}. سيعمل مجددًا غدًا.',
    timer: 'مؤقت الموقع', warn: 'تبقّت 5 دقائق على {site} اليوم.',
    goalTitle: 'تم بلوغ هدف وقت الشاشة', goalBody: 'استخدمت {t} اليوم. ربما حان وقت الاستراحة؟',
    weekTitle: 'تقريرك الأسبوعي جاهز',
    weekDown: 'انخفض وقت استخدام الشاشة الأسبوع الماضي بنسبة {p}، بمتوسط {t} يوميًا.',
    weekUp: 'ارتفع وقت استخدام الشاشة الأسبوع الماضي بنسبة {p}، بمتوسط {t} يوميًا.',
    weekAvg: 'كان متوسط وقت استخدام الشاشة الأسبوع الماضي {t} يوميًا.',
    modeEnded: 'انتهى {name}', modeEndedBody: 'لم تعد المواقع متوقفة مؤقتًا.',
    mode_work: 'وقت العمل', mode_me: 'وقت لنفسي',
    hrs: '{n} س', hr: '1 س', mins: '{n} د', min: '1 د',
    cat_social: 'التواصل الاجتماعي', cat_games: 'الألعاب', cat_entertainment: 'الترفيه', cat_creativity: 'الإبداع',
    cat_productivity: 'الإنتاجية والمالية', cat_education: 'التعليم', cat_reading: 'الأخبار والقراءة',
    cat_health: 'الصحة واللياقة البدنية', cat_utilities: 'الأدوات المساعدة', cat_shopping: 'التسوق والطعام', cat_travel: 'السفر', cat_other: 'أخرى',
  },
};

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const siteOfUrl = (u) => (/^https?:/.test(u || '') ? siteOf(hostOf(u)) : '');
const canTabs = () => chrome.permissions.contains({ permissions: ['tabs'] }).catch(() => false);

/** Everything a decision needs, read fresh (the SW keeps nothing in memory). */
async function state() {
  const { wellbeing, wellbeingUsage: raw, focus } = await local.get(['wellbeing', 'wellbeingUsage', 'focus']);
  const w = M.prefs(wellbeing);
  const u = raw && typeof raw === 'object' ? { days: raw.days || {}, g: raw.g || {} } : { days: {}, g: {} };
  return { w, u, focus, catOf: (s) => categoryOf(s, w.cats) };
}
const saveUsage = (u) => local.set({ wellbeingUsage: u });

function durText(sec, s) {
  const { h, m } = M.durParts(sec);
  return [h ? (h === 1 ? s.hr : fmt(s.hrs, { n: h })) : '', m || !h ? (m === 1 ? s.min : fmt(s.mins, { n: m })) : ''].filter(Boolean).join(' ');
}

// One job at a time: events arrive in bursts (a tab update, a focus change and an alarm together).
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn).catch((e) => console.warn('wellbeing', e)));

// ------------------------------------------------------------------ events
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.url || info.status === 'complete') serial(() => onTab(tab, !!info.url));
});
chrome.tabs.onActivated.addListener(({ tabId }) => serial(async () => {
  if (await canTabs()) await onTab(await chrome.tabs.get(tabId).catch(() => null), true);
}));
chrome.windows.onFocusChanged.addListener((wid) => serial(async () => {
  if (wid === chrome.windows.WINDOW_ID_NONE) return pause();
  if (!(await canTabs())) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: wid });
  if (tab) await track(tab);
}));
chrome.idle.setDetectionInterval(IDLE_SECONDS); // shared with Health (bg/hub.js)
chrome.idle.onStateChanged.addListener((st) => serial(() => onIdle(st)));
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.notifications) serial(() => countNotifications(c.notifications));
  if (c.wellbeing || c.focus) {
    serial(sweep);
    serial(plan);
  }
});
chrome.permissions.onAdded.addListener((p) => {
  if (!p.permissions?.includes('tabs')) return;
  serial(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await track(tab);
  });
});

onAlarm('wb', (rest) => serial(async () => {
  if (rest === 'flush') return flush();
  if (rest === 'check') {
    await flush();
    return sweep();
  }
  if (rest === 'bed') {
    await sweep();
    return plan();
  }
  if (rest === 'mode') return modeEnded();
  if (rest === 'week') return weekly();
}));

// a click on one of these notifications opens the app on the right screen
openTarget('wb', (rest) => ({ app: 'wellbeing', section: rest === 'week' ? 'report' : /^(limit|warn):/.test(rest) ? 'timers' : rest === 'goal' ? 'goal' : rest === 'mode' ? 'focus' : '' }));

onMessage('wb:allow', (m) => serial(() => allow(m)).then(() => true));
onMessage('wb:unlock', () => serial(unlock).then(() => true));
onMessage('wb:clear', () => serial(async () => {
  const { u } = await state();
  await saveUsage({ days: {}, g: { ...u.g, reached: {}, warned: {}, goal: '' } });
}).then(() => true));

// ------------------------------------------------------------------ pausing sites
/** "Ignore" choices from the pause page. */
async function allow({ reason, site, key, minutes, today, omm }) {
  const { w, u } = await state(), g = u.g, now = Date.now();
  g.allow = Object.fromEntries(Object.entries(g.allow || {}).filter(([, v]) => v > now));
  let k, until;
  if (reason === 'focus') {
    k = 'focus:' + site;
    until = now + (minutes || 5) * 60e3;
  } else if (reason === 'bedtime') {
    // "for tonight" lasts until Bedtime mode ends
    const bt = M.bedtimeAt(w.bedtime, now);
    k = 'bed:' + site;
    until = today ? (bt.until > now ? bt.until : M.nextMidnight(now)) : now + (minutes || 15) * 60e3;
  } else {
    k = `timer:${key}:${site}`;
    until = today ? M.nextMidnight(now) : now + (minutes || 15) * 60e3;
    // One more minute can be used once a day for each site
    if (omm) g.omm = { ...Object.fromEntries(Object.entries(g.omm || {}).filter(([, d]) => d === M.dayKey(now))), [site]: M.dayKey(now) };
  }
  g.allow[k] = until;
  await saveUsage(u);
  // look again the moment the extra time runs out
  if (!today) chrome.alarms.create('wb:check', { when: until + 1000 });
}

async function liveSeg() {
  const { wbSeg: seg } = await session.get('wbSeg');
  return seg ? { site: seg.s, sec: Math.max(0, (Date.now() - seg.since) / 1000) } : null;
}

const blockedUrl = (v, site, url) => chrome.runtime.getURL(`${PAGE}?r=${v[0]}&s=${encodeURIComponent(site)}${v[1] ? '&k=' + encodeURIComponent(v[1]) : ''}&u=${encodeURIComponent(url)}`);

/** Sends the tab to the pause page when its site shouldn't be used right now. */
async function enforce(tab, ctx) {
  const site = siteOfUrl(tab?.url);
  if (!site) return false;
  ctx ||= await state();
  const v = M.verdict(site, { w: ctx.w, focus: ctx.focus, usage: ctx.u, catOf: ctx.catOf, now: Date.now(), live: await liveSeg() });
  if (!v) return false;
  await chrome.tabs.update(tab.id, { url: blockedUrl(v, site, tab.url) }).catch(() => {});
  return true;
}

async function onTab(tab, check) {
  if (!tab?.url) return;
  if (check && (await enforce(tab))) return;
  if (tab.active) await track(tab);
}

/** Checks every open tab (a Focus mode or Bedtime just started, or a timer changed). */
async function sweep() {
  if (!(await canTabs())) return;
  const ctx = await state();
  for (const tab of await chrome.tabs.query({})) await enforce(tab, ctx);
}

// ------------------------------------------------------------------ counting
async function track(tab) {
  await flush();
  const win = tab.windowId != null ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  const site = win?.focused !== false ? siteOfUrl(tab.url) : '';
  await session.set({ wbSeg: site ? { s: site, since: Date.now(), tab: tab.id } : null });
  if (site) await watch(site, 0);
}

async function pause() {
  await flush();
  await session.set({ wbSeg: null });
}

async function flush() {
  const { wbSeg: seg } = await session.get('wbSeg');
  if (!seg) return;
  const now = Date.now(), sec = Math.round((now - seg.since) / 1000);
  await session.set({ wbSeg: { ...seg, since: now } });
  if (sec <= 0 || sec > 3 * 3600) return;
  const ctx = await state();
  M.prune(M.record(ctx.u.days, seg.s, now - sec * 1000, now), new Date(now));
  await saveUsage(ctx.u);
  await watch(seg.s, sec, ctx);
  // the tab in use may have just run out of time
  const tab = await chrome.tabs.get(seg.tab).catch(() => null);
  if (tab?.url) await enforce(tab, ctx);
}

/**
 * For the site in use: the "5 minutes left" warning and the "site paused" notification (once a day per timer), the
 * screen time goal, and a precise check when the next one is due so a timer doesn't wait for the minute tick.
 */
async function watch(site, justAdded, ctx) {
  ctx ||= await state();
  const { w, u, catOf } = ctx, now = Date.now(), today = M.dayKey(now), day = u.days[today], g = u.g;
  let soonest = Infinity, changed = false, s = null;
  const str = async () => (s ||= await bgStrings(S));
  for (const tm of M.timersFor(w, site, now, catOf)) {
    const lim = M.timerMinutes(tm, now) * 60, used = M.timerUsed(tm, day, catOf);
    const name = tm.kind === 'cat' ? (await str())['cat_' + tm.target] || tm.target : tm.target;
    if (used >= lim) {
      if (g.reached?.[tm.id] !== today && used - justAdded < lim + 60) {
        await post('wb:limit:' + tm.id, { app: 'wellbeing', title: (await str()).paused, body: fmt((await str()).pausedBody, { site: name }), icon: 'hourglass' });
        g.reached = { ...(g.reached || {}), [tm.id]: today };
        changed = true;
      }
    } else if (lim - used <= 300) {
      if (g.warned?.[tm.id] !== today && lim > 300) {
        await post('wb:warn:' + tm.id, { app: 'wellbeing', title: (await str()).timer, body: fmt((await str()).warn, { site: name }), icon: 'hourglass' });
        g.warned = { ...(g.warned || {}), [tm.id]: today };
        changed = true;
      }
      soonest = Math.min(soonest, lim - used);
    } else soonest = Math.min(soonest, lim - used - 300);
  }
  if (w.goal > 0 && g.goal !== today && M.dayTotal(day) >= w.goal * 60) {
    const st = await str();
    await post('wb:goal', { app: 'wellbeing', title: st.goalTitle, body: fmt(st.goalBody, { t: durText(M.dayTotal(day), st) }), icon: 'wbGoal' });
    g.goal = today;
    changed = true;
  }
  if (changed) await saveUsage(u);
  if (soonest < 60) chrome.alarms.create('wb:check', { when: Date.now() + Math.max(1, soonest) * 1000 + 500 });
}

async function countNotifications({ oldValue, newValue }) {
  const old = new Set((Array.isArray(oldValue) ? oldValue : []).map((n) => n?.id));
  const from = M.startOfDay(Date.now()).getTime();
  const fresh = (Array.isArray(newValue) ? newValue : []).filter((n) => n && !old.has(n.id) && n.time >= from).length;
  if (!fresh) return;
  const { u } = await state();
  for (let i = 0; i < fresh; i++) M.bump(u.days, 'n');
  await saveUsage(u);
}

/** Coming back to a locked computer, or after a few minutes away, is an unlock (as is Bloom Tab's Lock screen). */
async function onIdle(st) {
  const { wbIdle } = await session.get('wbIdle');
  await session.set({ wbIdle: { st, at: Date.now() } });
  if (st !== 'active') return pause();
  if (wbIdle && (wbIdle.st === 'locked' || (wbIdle.st === 'idle' && Date.now() - wbIdle.at >= 3 * 60e3))) await unlock();
  if (!(await canTabs())) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) await track(tab);
}

async function unlock() {
  const { u } = await state(), now = Date.now();
  // the computer's unlock and the Lock screen's right after it are one unlock
  if (now - (u.g.unlockAt || 0) < 60e3) return;
  M.bump(u.days, 'u', now);
  u.g.unlockAt = now;
  await saveUsage(u);
}

// ------------------------------------------------------------------ schedules and the weekly report
async function setAlarm(name, when) {
  const cur = await chrome.alarms.get(name);
  if (!when) return cur && chrome.alarms.clear(name);
  if (!cur || Math.abs(cur.scheduledTime - when) > 1000) chrome.alarms.create(name, { when });
}

/** Keeps wb:flush, wb:bed, wb:mode and wb:week right after any change. */
async function plan() {
  const { w } = await state(), now = Date.now();
  if (!(await chrome.alarms.get('wb:flush'))) chrome.alarms.create('wb:flush', { periodInMinutes: 1 });
  const bt = M.bedtimeAt(w.bedtime, now);
  const edges = [bt.active ? bt.until : 0, bt.next].filter((x) => x > now).sort((a, b) => a - b);
  await setAlarm('wb:bed', edges[0] || 0);
  const mode = M.activeMode(w, now);
  await setAlarm('wb:mode', mode && w.focus.endsAt ? w.focus.endsAt : 0);
  const mon = new Date(now);
  mon.setHours(9, 0, 0, 0);
  mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7 || (mon.getTime() <= now ? 7 : 0)));
  await setAlarm('wb:week', w.setup && w.report ? mon.getTime() : 0);
}

async function modeEnded() {
  const { w } = await state(), f = w.focus;
  await plan();
  if (!f?.endsAt || Math.abs(f.endsAt - Date.now()) > 90e3) return; // changed since the alarm was set
  const s = await bgStrings(S), m = w.modes.find((x) => x.id === f.id);
  await post('wb:mode', { app: 'wellbeing', title: fmt(s.modeEnded, { name: m?.name || s['mode_' + f.id] || '' }), body: s.modeEndedBody, icon: m?.icon || 'wbWork' });
  await sweep();
}

/** Monday morning: "Your screen time was down 12% last week, for an average of 2 hrs 31 mins a day." */
async function weekly(force = false) {
  await plan();
  const { w, u, catOf } = await state();
  if (!force && (!w.setup || !w.report)) return;
  const loc = await bgLocale(), ws = M.firstDayFor(loc), wk = M.weekKey(new Date(), ws);
  if (!force && u.g.report === wk) return;
  const r = M.weekReport(u, { ws, catOf });
  if (!r.total) return;
  const s = await bgStrings(S);
  let pct;
  try {
    pct = new Intl.NumberFormat(loc, { style: 'percent' });
  } catch {
    pct = new Intl.NumberFormat('en', { style: 'percent' });
  }
  const body = M.reportSentence(r, { down: s.weekDown, up: s.weekUp, avg: s.weekAvg }, (sec) => durText(sec, s), (x) => pct.format(x));
  await post('wb:week', { app: 'wellbeing', title: s.weekTitle, body, icon: 'wbReport' });
  u.g.report = wk;
  await saveUsage(u);
}

// the dev test drives these directly (.dev/wellbeing.cjs)
globalThis.__wellbeing = {
  flush: () => serial(flush), sweep: () => serial(sweep), plan: () => serial(plan), unlock: () => serial(unlock),
  weekly: () => serial(() => weekly(true)), modeEnded: () => serial(modeEnded), idle: (st) => serial(() => onIdle(st)),
};
serial(plan);
