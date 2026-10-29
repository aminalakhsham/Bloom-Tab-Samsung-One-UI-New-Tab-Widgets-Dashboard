// Samsung Clock: Alarm, World clock, Stopwatch and Timer. This file loads with every new tab, so it only registers
// the app (its UI lazy-loads from js/clock/ui.js), the clock widgets, the Now Bar activities (one per running timer,
// the stopwatch), Finder ("alarm 7:30"), search, and the ringing screen in every tab: the service worker
// (js/bg/clock.js) rings alarms and timers into session state, and js/clock/ringing.js shows it full screen here.
import { h, clamp, pad2, sameDay, everyMinute, isExt } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, fmtHM, fmtPeriod, fmtTime, fmtDate } from '../core/i18n.js';
import { store } from '../core/store.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerCommand } from '../core/hooks.js';
import { toast } from '../core/ui.js';
import { RING_KEY, nextOf, parseAlarmTime, newAlarm } from '../clock/core.js';
import * as D from '../clock/data.js';
import { analogFace } from '../clock/face.js';
import { DEFAULT_WORLD, wallTime, cityName, cityOf, shortDiff, fmtSpan } from '../clock/zones.js';
import { nextAlarmTime } from '../core/schedule.js';
import '../clock/strings.js';

addIcons({
  clkSnooze: '<path d="M4 6h6l-6 7h6M13 11h5l-5 6h5"/>',
  clkGrip: '<path d="M5 9h14M5 15h14"/>',
  clkDigital: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M8 10v4M11 10h2v4M16 10v4"/>',
});

/** 04:59 / 1:02:03 */
export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${pad2(mm)}:${pad2(ss)}`;
}
const fmtStopwatch = (ms) => {
  const hh = Math.floor(ms / 3600e3), mm = Math.floor((ms % 3600e3) / 60e3), ss = Math.floor((ms % 60e3) / 1000);
  return `${hh ? hh + ':' : ''}${pad2(mm)}:${pad2(ss)}`;
};
const alarmDate = (a) => {
  const [hh, mm] = String(a.time).split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
};

registerApp({
  id: 'clock',
  name: 'app.clock',
  keywords: ['alarm', 'timer', 'stopwatch', 'world clock', 'time zone', 'منبه', 'مؤقت', 'ساعة إيقاف', 'ساعة', 'الساعة العالمية'],
  icon: {
    bg: 'linear-gradient(160deg, #3b4bd6 0%, #1c2370 100%)',
    html: '<svg viewBox="0 0 64 64" width="80%" height="80%"><circle cx="32" cy="32" r="21" fill="#fff"/><circle cx="32" cy="32" r="21" fill="none" stroke="rgba(28,35,112,.12)" stroke-width="2"/><g stroke="#1c2370" stroke-width="2" stroke-linecap="round"><line x1="32" y1="14.5" x2="32" y2="17"/><line x1="49.5" y1="32" x2="47" y2="32"/><line x1="32" y1="49.5" x2="32" y2="47"/><line x1="14.5" y1="32" x2="17" y2="32"/></g><path d="M32 32V20.5" stroke="#1c2370" stroke-width="3.4" stroke-linecap="round"/><path d="M32 32l8.5 5.5" stroke="#1c2370" stroke-width="3.4" stroke-linecap="round"/><path d="M32 32l-6 9" stroke="#ff7a3d" stroke-width="1.6" stroke-linecap="round"/><circle cx="32" cy="32" r="2.6" fill="#ff7a3d"/></svg>',
  },
  size: 'phone',
  render: (ctx) => import('../clock/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const a of D.alarms()) {
      if (a.label && a.label.toLowerCase().includes(q)) out.push({ title: a.label, sub: fmtTime(alarmDate(a)), icon: 'alarm', onOpen: () => openApp('clock', { params: { tab: 'alarm' } }) });
    }
    for (const x of D.timers()) {
      if (x.label && x.label.toLowerCase().includes(q)) out.push({ title: x.label, sub: t('clock.timer'), icon: 'timer', onOpen: () => openApp('clock', { params: { tab: 'timer' } }) });
    }
    for (const c of D.clocks()) {
      if (cityName(c).toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q)) out.push({ title: cityName(c), sub: fmtTime(wallTime(c.tz)), icon: 'globe', onOpen: () => openApp('clock', { params: { tab: 'world' } }) });
    }
    return out;
  },
});

// ——— Now Bar: one pill per running timer, and the stopwatch ———
registerActivity('timer', () => {
  const now = Date.now();
  return D.timers().filter((x) => x.running && x.endsAt > now).sort((a, b) => a.endsAt - b.endsAt).map((x) => ({
    icon: 'timer',
    color: '#ff8a3d',
    title: fmtCountdown(x.endsAt - now),
    sub: x.label || t('clock.timer'),
    progress: x.duration ? clamp(1 - (x.endsAt - now) / x.duration, 0, 1) : 0,
    app: 'clock',
    params: { tab: 'timer' },
    actions: [
      { icon: 'pause', label: t('clock.pause'), onClick: () => D.pauseTimer(x.id) },
      { icon: 'stop', label: t('common.cancel'), onClick: () => D.resetTimer(x.id) },
    ],
    priority: 20,
  }));
});

registerActivity('stopwatch', () => {
  const s = D.stopwatch();
  if (!s.running) return null;
  return {
    icon: 'stopwatch',
    color: '#2bb3c0',
    title: fmtStopwatch(D.swElapsed(s)),
    sub: t('clock.tab.stopwatch'),
    app: 'clock',
    params: { tab: 'stopwatch' },
    actions: [
      { icon: 'pause', label: t('clock.stop'), onClick: D.swStop },
      { icon: 'list', label: t('clock.lap'), onClick: D.swLap },
    ],
    priority: 10,
  };
});

// ——— Finder: "alarm 7:30", "set an alarm for 6 am", "wake me up at 7", "منبه 7:30" ———
registerCommand('clock', (q, lower, done) => {
  const m = lower.trim().match(/^(?:set (?:an? )?alarm(?: for| at)?|alarm(?: at| for)?|wake me(?: up)?(?: at)?|(?:اضبط )?منبه(?: الساعة| على| عند)?|(?:اضبط )?المنبه(?: الساعة| على)?|أيقظني(?: الساعة)?|ايقظني(?: الساعة)?)\s+(.+)$/);
  const time = m && parseAlarmTime(m[1]);
  if (!time) return [];
  const a = newAlarm({ time });
  const at = nextAlarmTime(a);
  const when = new Date(at);
  return [{
    icon: 'alarm',
    score: 96,
    title: t('clock.cmdAlarm', { t: fmtTime(when) }),
    sub: t('clock.alarmIn', { d: fmtSpan(at - Date.now()) }),
    run: () => {
      D.saveAlarm(a);
      toast(t('clock.alarmSetFor', { d: fmtSpan(at - Date.now()) }));
      done?.();
    },
  }];
});

// ——— ringing in every tab ———
let ringUi = null;
function showRinging(list) {
  if (!list?.length && !ringUi) return;
  import('../clock/ringing.js').then((m) => {
    ringUi = m;
    m.update(list || []);
  }).catch((e) => console.error('clock ringing', e));
}
// Every open tab reports a timer that has ended (chrome.alarms can be up to 30 s late); the service worker rings it once.
const asked = new Set();
function checkTimers() {
  const now = Date.now();
  for (const x of D.timers()) {
    if (!x.running || !x.endsAt || x.endsAt > now) continue;
    const k = x.id + ':' + x.endsAt;
    if (asked.has(k)) continue;
    asked.add(k);
    if (isExt) chrome.runtime.sendMessage({ type: 'clock-ring', op: 'timer-done', id: x.id, endsAt: x.endsAt }).catch(() => {});
    else import('../clock/ringing.js').then((m) => m.localTimerDone(x.id, x.endsAt));
  }
}
if (typeof document !== 'undefined') {
  if (isExt && chrome.storage?.session) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'session' && ch[RING_KEY]) showRinging(ch[RING_KEY].newValue || []);
    });
    chrome.storage.session.get(RING_KEY).then((r) => showRinging(r[RING_KEY] || [])).catch(() => {});
  }
  setInterval(checkTimers, 1000);
  // Routines' Start timer / Set alarm actions (the routines editor and engine load later, on demand)
  setTimeout(() => import('../clock/actions.js').catch((e) => console.warn('clock actions', e)), 0);
}

// ——— widgets ———
function digitalWidget(el, { size }) {
  el.classList.add('wg-clock-digital');
  const timeEl = h('div', { class: 'wgc-time' });
  const dateEl = h('div', { class: 'wgc-date' });
  const alarmEl = size === 'm' ? h('div', { class: 'wgc-alarm' }) : null;
  el.append(h('div', { class: 'wgc-main' }, timeEl, dateEl));
  if (alarmEl) el.append(alarmEl);
  const draw = () => {
    const d = new Date(), p = fmtPeriod(d);
    // no AM/PM in 24-hour time: leave it out (replaceChildren() would print a null argument as "null")
    timeEl.replaceChildren(...[h('span', null, fmtHM(d)), p && h('small', null, p)].filter(Boolean));
    // the small widget uses One UI's short date ("Thu, Oct 29"): the long one wrapped onto two lines
    dateEl.textContent = fmtDate(d, size === 's' ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' });
    if (alarmEl) {
      const n = nextOf(D.alarms());
      alarmEl.replaceChildren(
        h('span', { class: 'wgc-alarm-i', html: icon(n ? 'alarm' : 'bellOff', 18) }),
        h('div', null,
          h('div', { class: 'wgc-alarm-t' }, n ? fmtTime(new Date(n.at)) : t('clock.noAlarmsShort')),
          h('div', { class: 'wgc-alarm-s' }, n ? (sameDay(n.at, Date.now()) ? t('common.today') : fmtDate(new Date(n.at), { weekday: 'short' })) + (n.alarm.label ? ' · ' + n.alarm.label : '') : t('clock.tapToAdd'))));
    }
  };
  const stop = everyMinute(draw);
  const off = store.on('alarms', draw);
  return () => {
    stop();
    off();
  };
}

function analogWidget(el) {
  el.classList.add('wg-clock-analog', 'wg-fill');
  const face = analogFace({ cls: 'widget' });
  el.append(face);
  const vis = () => document.visibilityState === 'visible' && face.sync();
  document.addEventListener('visibilitychange', vis);
  const iv = setInterval(face.sync, 10 * 60e3);
  return () => {
    document.removeEventListener('visibilitychange', vis);
    clearInterval(iv);
  };
}

function worldWidget(el) {
  el.classList.add('wg-clock-world');
  let faces = [];
  const draw = () => {
    const saved = D.clocks();
    const list = (saved.length ? saved : DEFAULT_WORLD.map((tz) => ({ tz, city: cityOf(tz) }))).slice(0, 4);
    faces = [];
    el.replaceChildren(...list.map((c) => {
      const f = analogFace({ tz: c.tz, numbers: false, cls: 'mini' });
      faces.push(f);
      const diff = shortDiff(c.tz);
      return h('div', { class: 'wgc-city' }, f,
        h('div', { class: 'wgc-city-n' }, cityName(c)),
        h('div', { class: 'wgc-city-t' }, fmtTime(wallTime(c.tz))),
        h('div', { class: 'wgc-city-d' }, diff ? `${diff}${t('clock.hShort')}` : t('clock.local')));
    }));
  };
  const stop = everyMinute(draw);
  const off = store.on('clocks', draw);
  const vis = () => document.visibilityState === 'visible' && faces.forEach((f) => f.sync());
  document.addEventListener('visibilitychange', vis);
  return () => {
    stop();
    off();
    document.removeEventListener('visibilitychange', vis);
  };
}

registerWidget({ id: 'clock-digital', name: 'clock.w.digital', sizes: ['s', 'm'], defaultSize: 'm', app: 'clock', render: digitalWidget });
registerWidget({ id: 'clock-analog', name: 'clock.w.analog', sizes: ['s'], defaultSize: 's', app: 'clock', render: analogWidget });
registerWidget({
  id: 'clock-world',
  name: 'clock.w.world',
  sizes: ['m'],
  defaultSize: 'm',
  app: 'clock',
  onClick: () => openApp('clock', { params: { tab: 'world' } }),
  render: worldWidget,
});

