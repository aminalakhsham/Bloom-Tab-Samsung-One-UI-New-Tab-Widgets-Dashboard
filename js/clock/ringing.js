// The ringing screen, in every open tab (One UI): full screen over everything, even the Lock screen. An alarm shows
// its name, the time and the date over a slow sunrise, with the round Dismiss (✕) and Snooze (Zz) buttons you swipe
// out of their circle; a timer shows "Time's up", how long ago it ended, Restart and +1 min. Anything else ringing at
// the same time waits in a chip at the top. Esc dismisses; Enter or Space on a focused circle does what it says.
// It only shows the session state the service worker keeps (js/bg/clock.js) and sends the choice back; outside the
// extension (no service worker) it rings timers itself.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtHM, fmtPeriod, fmtDate } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast } from '../core/ui.js';
import * as C from './core.js';
import * as D from './data.js';
import { fmtSpan } from './zones.js';
import { playTone, stopSound } from './sound.js';

let host = null, list = [], sig = '', iv = 0, topKey = '';
const SWIPE = 96; // px out of the circle that counts as a swipe

/** Shows what rings (the `clockRinging` session list), or hides the screen when nothing does. */
export function update(next) {
  list = (next || []).filter((r) => r?.key);
  const s = list.map((r) => r.key).join('|');
  if (s === sig) return;
  sig = s;
  if (!list.length) return hide();
  render();
}
export const showing = () => !!host;

function onKey(e) {
  if (!host || e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const top = C.screenTop(list);
  if (top) act(top, 'dismiss');
}

function hide() {
  clearInterval(iv);
  removeEventListener('keydown', onKey, true);
  if (!host) return;
  const el = host;
  host = null;
  topKey = '';
  el.classList.remove('show');
  setTimeout(() => el.remove(), 320);
}

async function act(r, action) {
  host?.querySelector(`[data-key="${CSS.escape(r.key)}"]`)?.classList.add('leaving');
  update(list.filter((x) => x.key !== r.key)); // right away; the service worker's change follows
  const res = await D.ringAction(r.key, action);
  if (res?.did === 'snooze') toast(t('clock.snoozedFor', { d: fmtSpan((res.at || Date.now() + r.snoozeMin * 60e3) - Date.now()) }));
  else if (res?.did === 'plus1' || res?.did === 'restart') toast(t('clock.timerRestarted'));
}

/** A round button you swipe out of its circle (One UI); a click only nudges it and shows the hint. */
function swipeCircle(cls, ic, label, hint, onDone) {
  const ring = h('i', { class: 'clk-swipe-ring' });
  const btn = h('button', { class: ['clk-swipe', cls], 'aria-label': label, title: label }, ring, h('span', { class: 'clk-swipe-ico', html: icon(ic, 30) }));
  const wrap = h('div', { class: ['clk-swipe-wrap', cls] }, btn, h('div', { class: 'clk-swipe-hint' }, hint));
  let moved = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    let d = 0;
    moved = false;
    wrap.classList.add('drag');
    const move = (ev) => {
      d = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (d > 6) moved = true;
      wrap.style.setProperty('--d', Math.min(1.4, d / SWIPE).toFixed(3));
    };
    const up = () => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
      wrap.classList.remove('drag');
      wrap.style.setProperty('--d', 0);
      if (d >= SWIPE) onDone();
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });
  btn.addEventListener('click', (e) => {
    // keyboard (Enter / Space) and assistive technology clicks have no pointer: they act; a mouse click nudges
    if (e.detail === 0) return onDone();
    if (moved) return;
    wrap.classList.remove('nudge');
    void wrap.offsetWidth;
    wrap.classList.add('nudge');
  });
  return wrap;
}

function render() {
  const top = C.screenTop(list);
  const others = list.filter((r) => r !== top).reverse();
  const isAlarm = top.kind === 'alarm';
  if (!host) {
    // data-overlay: presses on it leave the app windows' focus alone (js/core/apps.js)
    host = h('div', { class: 'clk-ringing', role: 'alertdialog', 'aria-modal': 'true', 'data-overlay': '' });
    document.body.appendChild(host);
    requestAnimationFrame(() => host?.classList.add('show'));
    addEventListener('keydown', onKey, true);
  }
  host.className = `clk-ringing ${top.kind}${host.classList.contains('show') ? ' show' : ''}`;
  host.setAttribute('aria-label', top.label || (isAlarm ? t('clock.alarm') : t('clock.timesUp')));
  const now = h('div', { class: 'clk-ring-now', dir: 'ltr' });
  const sub = h('div', { class: 'clk-ring-date' });
  const tick = () => {
    const d = new Date();
    if (isAlarm) {
      const p = fmtPeriod(d);
      now.replaceChildren(...[h('span', null, fmtHM(d)), p && h('small', null, p)].filter(Boolean)); // no "null" in 24-hour time
      sub.textContent = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    } else {
      const s = Math.max(0, Math.floor((Date.now() - (top.ended || top.at)) / 1000));
      now.textContent = `−${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
  };
  tick();
  clearInterval(iv);
  iv = setInterval(tick, 1000);
  const dismiss = swipeCircle('dismiss', 'close', t('clock.dismiss'), t('clock.swipeDismiss'), () => act(top, 'dismiss'));
  const actions = isAlarm
    ? h('div', { class: ['clk-ring-actions', !top.snooze && 'single'] }, dismiss,
      top.snooze ? swipeCircle('snooze', 'clkSnooze', t('clock.snooze'), t('clock.swipeSnooze'), () => act(top, 'snooze')) : null)
    : h('div', { class: 'clk-ring-actions single' }, dismiss);
  host.replaceChildren(...[
    h('div', { class: 'clk-ring-sky', 'aria-hidden': 'true' }, h('i', { class: 'clk-ring-sun' })),
    others.length ? h('div', { class: 'clk-ring-others' }, others.map((r) => h('div', { class: 'clk-ring-other', dataset: { key: r.key } },
      h('span', { html: icon(r.kind === 'alarm' ? 'alarm' : 'timer', 18) }),
      h('span', { class: 'clk-ring-other-t' }, r.label || (r.kind === 'alarm' ? t('clock.alarm') : t('clock.timesUp'))),
      h('button', { class: 'clk-ring-other-x', title: t('clock.dismiss'), 'aria-label': t('clock.dismiss'), html: icon('close', 16), onClick: () => act(r, 'dismiss') })))) : null,
    h('div', { class: 'clk-ring-card', dataset: { key: top.key } },
      h('div', { class: 'clk-ring-head' }, h('span', { class: 'clk-ring-ico', html: icon(isAlarm ? 'alarm' : 'timer', 22) }), h('span', null, isAlarm ? t('clock.alarm') : t('clock.timer'))),
      h('div', { class: 'clk-ring-title' }, top.label || (isAlarm ? t('clock.alarm') : t('clock.timesUp'))),
      isAlarm ? null : h('div', { class: 'clk-ring-body' }, top.label ? t('clock.timesUp') : ''),
      now, isAlarm ? sub : null),
    isAlarm ? null : h('div', { class: 'clk-ring-pills' },
      h('button', { class: 'clk-ring-pill restart', onClick: () => act(top, 'restart') }, h('span', { html: icon('refresh', 18) }), t('clock.restart')),
      h('button', { class: 'clk-ring-pill plus1', onClick: () => act(top, 'plus1') }, h('span', { html: icon('plus', 18) }), t('clock.plus1'))),
    actions].filter(Boolean));
  if (topKey !== top.key) {
    topKey = top.key;
    setTimeout(() => host?.querySelector('.clk-swipe')?.focus({ preventScroll: true }), 80);
  }
}

// ——— outside the extension: the page rings timers itself ———
let local = [];
export function localTimerDone(id, endsAt) {
  const r = C.fireTimer(D.timers(), id, { inPage: true, endsAt, prefs: D.prefs() });
  if (!r) return;
  store.set('timers', r.timers);
  if (!r.entry) return;
  local = C.addRing(local, r.entry);
  playTone(r.entry.tone, r.entry.volume, 0);
  update(local);
  setTimeout(() => localAct(r.entry.key, 'expire'), C.RING_MS.timer);
}
export function localAct(key, action) {
  const e = local.find((x) => x.key === key);
  if (!e) return null;
  const p = C.ringAct({ alarms: D.alarms(), timers: D.timers() }, e, action);
  if (p.alarms) store.set('alarms', p.alarms);
  if (p.timers) store.set('timers', p.timers);
  local = local.filter((x) => x.key !== key);
  const top = C.soundTop(local);
  if (top) playTone(top.tone, top.volume, 0);
  else stopSound();
  update(local);
  return { did: p.did, at: p.at || null };
}
