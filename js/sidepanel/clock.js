// Side panel › Clock: Samsung Clock's Timer (several at once, preset timers, pause / +1 min / delete) and Stopwatch (laps).
// Same `timers` / `stopwatch` store keys and `timer:<id>` alarms as js/apps/clock.js, so a timer started here counts down
// in the Clock app, the Now Bar and the Quick Panel too, and the service worker rings it when it ends.
import { h, uid, pad2, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { seg, toast } from '../core/ui.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import { header, openAppBtn, actionBtn } from './kit.js';

const LS = 'bt.sp.clock';
const PRESETS = [1, 3, 5, 10, 15, 30, 60];

// ——— timers (the shape js/apps/clock.js keeps: { id, label, duration, endsAt, remaining, running }) ———
const timers = () => store.get('timers') || [];
const updateTimer = (id, fn) => store.update('timers', (l) => (l || []).map((x) => (x.id === id ? { ...x, ...fn(x) } : x)));
function startTimer(duration, label = '') {
  const id = uid(), endsAt = Date.now() + duration;
  store.update('timers', (l) => [...(l || []), { id, label, duration, endsAt, remaining: duration, running: true }]);
  scheduleAt('timer:' + id, endsAt);
  return id;
}
function pauseTimer(id) {
  updateTimer(id, (x) => (x.running ? { running: false, remaining: Math.max(0, x.endsAt - Date.now()), endsAt: null } : {}));
  cancelSchedule('timer:' + id);
}
function resumeTimer(id) {
  const x = timers().find((y) => y.id === id);
  if (!x) return;
  const remaining = x.remaining > 0 ? x.remaining : x.duration, endsAt = Date.now() + remaining;
  updateTimer(id, () => ({ running: true, endsAt, remaining }));
  scheduleAt('timer:' + id, endsAt);
}
function deleteTimer(id) {
  store.update('timers', (l) => (l || []).filter((x) => x.id !== id));
  cancelSchedule('timer:' + id);
}
function addMinute(id) {
  const x = timers().find((y) => y.id === id);
  if (!x) return;
  if (x.running) {
    const endsAt = x.endsAt + 60e3;
    updateTimer(id, (y) => ({ endsAt, duration: Math.max(y.duration, endsAt - Date.now()) }));
    scheduleAt('timer:' + id, endsAt);
  } else updateTimer(id, (y) => ({ remaining: y.remaining + 60e3, duration: Math.max(y.duration, y.remaining + 60e3) }));
}
const left = (x) => (x.running ? Math.max(0, x.endsAt - Date.now()) : x.remaining);
function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${pad2(mm)}:${pad2(ss)}`;
}

// ——— stopwatch ({ running, startedAt, elapsed, laps }) ———
const sw$ = () => store.get('stopwatch') || { running: false, startedAt: 0, elapsed: 0, laps: [] };
const swElapsed = (s = sw$()) => s.elapsed + (s.running ? Date.now() - s.startedAt : 0);
const swStart = () => store.update('stopwatch', (s) => ({ laps: [], elapsed: 0, ...s, running: true, startedAt: Date.now() }));
const swStop = () => store.update('stopwatch', (s) => ({ ...s, running: false, elapsed: swElapsed(s), startedAt: 0 }));
const swReset = () => store.set('stopwatch', { running: false, startedAt: 0, elapsed: 0, laps: [] });
const swLap = () => store.update('stopwatch', (s) => ({ ...s, laps: [...(s.laps || []), swElapsed(s)] }));
function fmtSw(ms) {
  ms = Math.max(0, ms);
  const hh = Math.floor(ms / 3600e3), mm = Math.floor((ms % 3600e3) / 60e3), ss = Math.floor((ms % 60e3) / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${hh ? hh + ':' : ''}${pad2(mm)}:${pad2(ss)}.${pad2(cs)}`;
}

export function render(main) {
  let view = (() => { try { return localStorage.getItem(LS) === 'stopwatch' ? 'stopwatch' : 'timer'; } catch { return 'timer'; } })();
  let stop = null;
  const body = h('div', { class: 'sp-clock' });
  const tabs = seg([{ value: 'timer', label: t('sp.clock.timer') }, { value: 'stopwatch', label: t('sp.clock.stopwatch') }], view, (v) => {
    view = v;
    try { localStorage.setItem(LS, v); } catch {}
    show();
  });
  tabs.classList.add('sp-seg');
  main.replaceChildren(header({ title: t('sp.tab.clock'), actions: [openAppBtn('clock')] }), tabs, body);
  const show = () => {
    stop?.();
    stop = view === 'timer' ? timerView(body) : stopwatchView(body);
  };
  show();
  return () => stop?.();
}

function timerView(body) {
  // the picker (hours, minutes, seconds) keeps what was typed while the list redraws
  const field = (max, label, value) => {
    const i = h('input', { class: 'sp-pick-in', type: 'number', min: 0, max, value: pad2(value), inputmode: 'numeric', 'aria-label': label });
    const fix = () => (i.value = pad2(clamp(Math.floor(+i.value || 0), 0, max)));
    i.addEventListener('change', () => { fix(); drawStart(); });
    i.addEventListener('input', () => drawStart());
    i.addEventListener('focus', () => i.select());
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { fix(); startBtn.click(); } });
    return h('label', { class: 'sp-pick' }, i, h('small', null, label));
  };
  const hh = field(99, t('sp.clock.hours'), 0), mm = field(59, t('sp.clock.minutes'), 5), ss = field(59, t('sp.clock.seconds'), 0);
  const val = (f) => +f.querySelector('input').value || 0;
  const picked = () => ((val(hh) * 60 + val(mm)) * 60 + val(ss)) * 1000;
  const startBtn = h('button', { class: 'ou-btn primary sp-start', onClick: () => { const ms = picked(); if (ms > 0) { startTimer(ms); toast(t('sp.clock.started')); } } }, t('sp.clock.start'));
  const drawStart = () => (startBtn.disabled = !(picked() > 0));
  const picker = h('div', { class: 'sp-card sp-picker' },
    h('div', { class: 'sp-pick-row', dir: 'ltr' }, hh, h('span', { class: 'sp-colon' }, ':'), mm, h('span', { class: 'sp-colon' }, ':'), ss),
    startBtn);
  const presets = h('div', { class: 'sp-presets' }, PRESETS.map((m) => h('button', { class: 'sp-preset', onClick: () => { startTimer(m * 60e3); toast(t('sp.clock.started')); } }, m >= 60 ? t('sp.clock.hr', { n: m / 60 }) : t('sp.clock.min', { n: m }))));
  const listEl = h('div', { class: 'sp-timers' });
  body.replaceChildren(listEl, picker, h('div', { class: 'ou-subheader sp-subheader' }, t('sp.clock.presets')), presets);
  drawStart();

  const R = 52, C = 2 * Math.PI * R;
  const card = (x) => {
    const ring = h('div', { class: 'sp-ring', html: `<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${R}"/><circle class="bar" cx="60" cy="60" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>` });
    const time = h('div', { class: 'sp-timer-time', dir: 'ltr' });
    const label = h('div', { class: 'sp-timer-label' }, x.label || t('sp.clock.timer'));
    const el = h('div', { class: ['sp-card', 'sp-timer', x.running ? 'running' : 'paused'], dataset: { id: x.id } },
      h('div', { class: 'sp-timer-face' }, ring, h('div', { class: 'sp-timer-center' }, label, time)),
      h('div', { class: 'sp-timer-btns' },
        actionBtn('trash', t('sp.clock.delete'), () => deleteTimer(x.id), 'sp-round'),
        h('button', { class: 'ou-btn tonal sp-plus1', onClick: () => addMinute(x.id) }, t('sp.clock.plus1')),
        actionBtn(x.running ? 'pause' : 'play', x.running ? t('sp.clock.pause') : t('sp.clock.resume'), () => (x.running ? pauseTimer(x.id) : resumeTimer(x.id)), 'sp-round primary')));
    el.tick = () => {
      const cur = timers().find((y) => y.id === x.id) || x, ms = left(cur);
      const over = cur.running && ms <= 0;
      time.textContent = fmtLeft(ms);
      label.textContent = over ? t('sp.clock.timesUp') : cur.label || t('sp.clock.timer');
      el.classList.toggle('over', over);
      ring.querySelector('.bar').setAttribute('stroke-dashoffset', String(C * (1 - (cur.duration ? clamp(ms / cur.duration, 0, 1) : 0))));
    };
    el.tick();
    return el;
  };
  let cards = [];
  const drawList = () => {
    cards = timers().map(card);
    listEl.replaceChildren(...cards);
  };
  drawList();
  const off = store.on('timers', drawList);
  const iv = setInterval(() => cards.forEach((c) => c.tick()), 250);
  return () => {
    off();
    clearInterval(iv);
  };
}

function stopwatchView(body) {
  const digits = h('div', { class: 'sp-sw-digits', dir: 'ltr' });
  const leftBtn = h('button', { class: 'ou-btn tonal sp-sw-btn' });
  const rightBtn = h('button', { class: 'ou-btn primary sp-sw-btn' });
  const laps = h('div', { class: 'sp-laps' });
  leftBtn.addEventListener('click', () => (sw$().running ? swLap() : swReset()));
  rightBtn.addEventListener('click', () => (sw$().running ? swStop() : swStart()));
  body.replaceChildren(h('div', { class: 'sp-card sp-sw' }, digits, h('div', { class: 'sp-sw-btns' }, leftBtn, rightBtn)), laps);
  const draw = () => {
    const s = sw$(), L = s.laps || [];
    leftBtn.textContent = s.running ? t('sp.clock.lap') : t('sp.clock.reset');
    leftBtn.disabled = !s.running && !s.elapsed;
    rightBtn.textContent = s.running ? t('sp.clock.stop') : s.elapsed ? t('sp.clock.resume') : t('sp.clock.start');
    rightBtn.classList.toggle('stop', !!s.running);
    const splits = L.map((v, i) => v - (L[i - 1] || 0));
    laps.replaceChildren(...(L.length ? [h('div', { class: 'sp-card sp-lap-list' }, L.map((v, i) => ({ v, i, sp: splits[i] })).reverse().map(({ v, i, sp }) =>
      h('div', { class: 'sp-lap' }, h('span', null, t('sp.clock.lapN', { n: i + 1 })), h('span', { dir: 'ltr' }, '+' + fmtSw(sp)), h('span', { dir: 'ltr' }, fmtSw(v)))))] : []));
  };
  let raf;
  const tick = () => {
    digits.textContent = fmtSw(swElapsed());
    raf = requestAnimationFrame(tick);
  };
  draw();
  tick();
  const off = store.on('stopwatch', draw);
  return () => {
    cancelAnimationFrame(raf);
    off();
  };
}
