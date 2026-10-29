// Lock screen with One UI clock styles, Lock screen widgets, notifications, the Now Brief card and the Now Bar, plus
// Always On Display. Swipe up, click, scroll or start typing to unlock. With a screen lock PIN (js/shell/pin.js) the
// unlock gesture brings up Samsung's PIN keypad instead, unless the PIN was entered (or the computer used) within
// "Lock automatically" minutes; unlock() — which apps and deep links wait for — resolves only once the PIN is in.
import { h, $, everySecond, everyMinute, throttle, isExt } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, fmtHM, fmtPeriod, fmtDate, fmtTime } from '../core/i18n.js';
import { store, setting, setSetting, session, onSetting } from '../core/store.js';
import { getActivities, openActivity } from '../core/activity.js';
import { openApp, getApp, appName } from '../core/apps.js';
import { closeMenus } from '../core/ui.js';
import { nextAlarmTime } from '../core/schedule.js';
import { getBattery, batteryIcon } from './statusbar.js';
import { notifIcon } from './quickpanel.js';
import { wallTone, onWallTone } from './wallpaper.js';
import { getLockWidget, emitUnlock } from '../core/hooks.js';
import { pinSet, autoConfirm, pinDigits, keypad, tryPin, wrongText, forgotPin, lockAfter } from './pin.js';

let el, clockEl, dateEl, widgetsEl, notifsEl, briefEl, nowbarEl, padlockEl, locked = false, stopTick = null;
let brief = null; // js/shell/brief.js once loaded (the Now Brief card and the morning sheet)

export const CLOCK_FONTS = {
  outfit: 'var(--font-display)',
  inter: 'var(--font)',
  // the generic serif before the Arabic font: without Palatino or Georgia (Linux, ChromeOS) Chrome otherwise drew the
  // digits from Noto Naskh Arabic, whose deep descent pushed them up into the date above
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Noto Serif", serif, "Noto Naskh Arabic"',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
};
export const CLOCK_STYLES = ['stacked', 'classic', 'thin', 'left'];
/** The Lock screen's own chips; apps add theirs with registerLockWidget() (core/hooks.js). */
export const BUILTIN_WIDGETS = ['weather', 'battery', 'event', 'alarm'];
/** What a brand-new profile starts with (chips only show when they have something to say). */
export const NEW_USER_WIDGETS = ['weather', 'battery', 'event', 'alarm', 'health-rings', 'wellbeing'];

const isLockedNow = () => locked;
export { isLockedNow as isLocked };

/** Builds the clock markup for a style; also used by Settings for live previews. */
export function clockMarkup(d, style = setting('clockStyle')) {
  const [hh, mm] = fmtHM(d).split(':');
  const p = fmtPeriod(d);
  if (style === 'stacked' || style === 'left')
    return `<span class="lk-h">${hh.padStart(2, '0')}</span><span class="lk-m">${mm}</span>`;
  return `<span class="lk-hm">${hh}<span class="lk-colon">:</span>${mm}</span>${p ? `<span class="lk-p">${p}</span>` : ''}`;
}

function applyClockStyle() {
  const s = store.get('settings');
  el.dataset.clock = s.clockStyle;
  el.style.setProperty('--clock-font', CLOCK_FONTS[s.clockFont] || CLOCK_FONTS.outfit);
  el.style.setProperty('--clock-weight', s.clockWeight);
  el.style.setProperty('--clock-color', s.clockColor === 'auto' ? (wallTone() === 'light' ? '#16161a' : '#ffffff') : s.clockColor === 'accent' ? 'var(--accent)' : s.clockColor);
}

/** Notification text is hidden on a Lock screen guarded by a PIN (One UI's "Hide content", on by default). */
export const hideContent = () => pinSet() && setting('lockHideContent') !== false;
/** What a Lock screen surface may show: { locked, private } (private: a screen-lock PIN guards it). */
export const lockPrivacy = () => ({ locked, private: pinSet() });

function build() {
  clockEl = h('div', { class: 'lk-clock', 'aria-live': 'off' });
  dateEl = h('div', { class: 'lk-date' });
  widgetsEl = h('div', { class: 'lk-widgets' });
  notifsEl = h('div', { class: 'lk-notifs' });
  briefEl = h('div', { class: 'lk-brief' });
  nowbarEl = h('div', { class: 'lk-nowbar' });
  padlockEl = h('span', { class: 'lk-padlock', 'aria-hidden': 'true' });
  const shortcuts = setting('lockShortcuts') || ['notes', 'finder'];
  const sc = (id, side) => {
    if (!id) return h('span', { class: 'lk-sc-empty' });
    const isFinder = id === 'finder';
    const app = getApp(id);
    if (!isFinder && !app) return h('span', { class: 'lk-sc-empty' });
    return h('button', {
      class: ['lk-sc', side],
      title: isFinder ? t('lock.search') : appName(app),
      'aria-label': isFinder ? t('lock.search') : appName(app),
      html: icon(isFinder ? 'search' : { notes: 'note', calculator: 'calc', clock: 'alarm', reminder: 'checkCircle', calendar: 'calendar', weather: 'cloud', settings: 'settings' }[id] || 'apps', 24),
      onClick: (e) => {
        e.stopPropagation();
        unlock().then(() => (isFinder ? import('./finder.js').then((m) => m.openFinder()) : openApp(id)));
      },
    });
  };
  el.replaceChildren(
    h('div', { class: 'lk-top' }, padlockEl, dateEl, clockEl, widgetsEl),
    h('div', { class: 'lk-mid' }, briefEl, notifsEl),
    h('div', { class: 'lk-bottom' },
      nowbarEl,
      h('div', { class: 'lk-bottom-row' },
        sc(shortcuts[0], 'start'),
        h('div', { class: 'lk-hint' }, h('span', { class: 'lk-hint-ico', html: icon('up', 22) }), h('span', null, t('lock.hint'))),
        sc(shortcuts[1], 'end'))));
  if (pinUi) el.appendChild(pinUi.el);
  drawPadlock();
}

/** The padlock over the clock: closed while the PIN will be asked, open when the screen will unlock without it. */
async function drawPadlock() {
  if (!padlockEl) return;
  if (!pinSet()) return padlockEl.replaceChildren();
  const need = await pinNeeded();
  padlockEl.innerHTML = icon(need ? 'lock' : 'unlock', 18);
  padlockEl.classList.toggle('open', !need);
}

function tick(d) {
  clockEl.innerHTML = clockMarkup(d);
  dateEl.textContent = fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
  renderNowBar();
}

/** The chips the user picked, in their order. */
export const lockWidgetIds = () => (Array.isArray(setting('lockWidgets')) ? setting('lockWidgets') : []).filter((x) => typeof x === 'string');

let widgetsRun = 0;
async function renderWidgets() {
  const run = ++widgetsRun;
  const parts = [];
  const priv = pinSet();
  for (const w of lockWidgetIds()) {
    try {
      let chip = null;
      if (w === 'weather') {
        const m = await import('../services/weather.js');
        const wx = store.get('weather');
        if (wx?.current) {
          const info = m.weatherInfo(wx.current.code, wx.current.isDay);
          chip = h('span', { class: 'lk-w' }, h('span', { class: 'lk-w-wx', html: info.icon }), m.fmtTemp(wx.current.temp));
        }
        m.getWeather().catch(() => {});
      } else if (w === 'battery') {
        const b = await getBattery();
        if (b) chip = h('span', { class: 'lk-w', html: batteryIcon(b.level, b.charging, 20) }, `${Math.round(b.level * 100)}%`);
      } else if (w === 'event') {
        const m = await import('../apps/calendar.js');
        // (birthdays, which Calendar lists too, have a chip of their own)
        const ev = (m.upcomingEvents?.(5) || []).find((e) => e.cal !== 'birthdays');
        // an event title is private: with a PIN the chip only says when the next one starts
        if (ev && ev.start - Date.now() < 36 * 3600e3) chip = h('span', { class: 'lk-w' }, h('span', { html: icon('calendar', 18) }), priv ? (ev.allDay ? t('lock.eventToday') : t('lock.eventAt', { time: fmtTime(new Date(ev.start)) })) : `${ev.allDay ? '' : fmtTime(new Date(ev.start)) + ' · '}${ev.title}`);
      } else if (w === 'alarm') {
        const next = (store.get('alarms') || []).filter((a) => a.enabled).map((a) => nextAlarmTime(a)).filter(Boolean).sort((a, b) => a - b)[0];
        if (next) chip = h('span', { class: 'lk-w' }, h('span', { html: icon('alarm', 18) }), fmtDate(new Date(next), { weekday: 'short' }) + ' ' + fmtTime(new Date(next)));
      } else if (getLockWidget(w)) {
        chip = await getLockWidget(w).render({ locked: true, private: priv });
      }
      if (chip instanceof Element) {
        chip.classList.add('lk-w');
        chip.dataset.lw = w;
        parts.push(chip);
      }
    } catch (e) {
      console.warn('lock widget', w, e);
    }
  }
  if (run === widgetsRun) widgetsEl.replaceChildren(...parts);
  fitMid();
}

// A crowded Lock screen (a short window, many chips, the evening card, the Now Bar) never lets the middle column run
// under the bottom row: the brief card drops its buttons first, then the notification list shrinks (and scrolls),
// then the card goes.
function fitMid() {
  if (!locked || !el) return;
  const mid = briefEl.parentElement, bottom = el.querySelector('.lk-bottom');
  if (!mid || !bottom) return;
  briefEl.classList.remove('compact', 'gone');
  notifsEl.style.maxHeight = '';
  notifsEl.classList.remove('squeezed');
  const room = () => bottom.getBoundingClientRect().top - 14 - mid.getBoundingClientRect().top;
  const over = () => mid.scrollHeight > room() + 1;
  if (!over()) return;
  briefEl.classList.add('compact');
  if (!over()) return;
  const left = room() - (briefEl.offsetHeight ? briefEl.offsetHeight + 8 : 0);
  notifsEl.classList.add('squeezed');
  notifsEl.style.maxHeight = Math.max(0, left > 72 ? left : 0) + 'px';
  if (!over()) return;
  briefEl.classList.add('gone');
  notifsEl.style.maxHeight = Math.max(0, room() > 72 ? room() : 0) + 'px';
}
addEventListener('resize', () => locked && fitMid());

function renderNotifs() {
  const list = (store.get('notifications') || []).filter((n) => !n.read).slice(0, 3);
  const hide = hideContent();
  document.body.classList.toggle('lk-private', locked && hide);
  notifsEl.replaceChildren(
    ...list.map((n) =>
      h('div', { class: ['lk-notif', hide && 'hidden-content'] },
        h('span', { class: 'qp-notif-ico' }, notifIcon(n)),
        hide
          ? h('div', { class: 'qp-notif-text' }, h('div', { class: 'qp-notif-title' }, getApp(n.app) ? appName(n.app) : t('qp.system')), h('div', { class: 'qp-notif-body' }, t('lock.newNotif')))
          : h('div', { class: 'qp-notif-text' }, h('div', { class: 'qp-notif-title' }, n.title), n.body ? h('div', { class: 'qp-notif-body' }, n.body) : null)))
  );
  fitMid();
}

let briefRun = 0;
async function renderBrief() {
  const run = ++briefRun;
  if (!brief || !locked) return briefEl.replaceChildren();
  try {
    const card = await brief.lockCard({ onOpen: (kind) => unlock().then(() => brief.openBrief({ kind })) });
    if (run === briefRun) briefEl.replaceChildren(...(card ? [card] : []));
    fitMid();
  } catch (e) {
    console.warn('lock brief', e);
  }
}

// The Now Bar is refreshed every second. Its pills are patched in place, keyed by activity id, instead of being
// rebuilt: a node replaced between pointerdown and pointerup never receives the click, so rebuilding lost clicks (and
// replayed the entrance animation every second). Each pill keeps its latest activity, which its click handlers read.
let nowbarN = -1;
const pills = new Map();
const setText = (node, s) => { if (node.textContent !== s) node.textContent = s; };
const ringSvg = (p) => `<svg class="nb-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/><circle cx="18" cy="18" r="16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(p * 100.5).toFixed(1)} 200" transform="rotate(-90 18 18)"/></svg>`;

function makePill() {
  const p = { act: null, sig: {} };
  p.ico = h('span', { class: 'nb-ico' });
  p.title = h('b');
  p.sub = h('small');
  p.text = h('span', { class: 'nb-text' }, p.title);
  p.wave = h('span', { class: 'nb-wave' }, h('i'), h('i'), h('i'), h('i'));
  p.btn = h('span', {
    class: 'nb-act', role: 'button',
    onClick: (e) => {
      e.stopPropagation();
      p.act?.actions?.[0]?.onClick?.(e);
      renderNowBar();
    },
  });
  p.el = h('button', {
    class: 'nb-pill',
    onClick: (e) => {
      e.stopPropagation();
      const a = p.act;
      // the activity's own target (its app with its params, or `open`); a pill without one only unlocks
      if (a?.open || a?.app) openActivity(a, p.el);
      else unlock();
    },
  }, p.ico, p.text);
  return p;
}

function patchPill(p, a) {
  p.act = a;
  const s = p.sig;
  const color = a.color || 'var(--accent)';
  if (s.color !== color) p.el.style.setProperty('--act', (s.color = color));
  const ico = (a.progress != null ? ringSvg(Math.max(0, Math.min(1, +a.progress || 0))) : '') + icon(a.icon || 'bell', 18);
  if (s.ico !== ico) p.ico.innerHTML = s.ico = ico;
  setText(p.title, String(a.title ?? ''));
  if (a.sub) {
    setText(p.sub, String(a.sub));
    if (!p.sub.isConnected) p.text.appendChild(p.sub);
  } else p.sub.remove();
  if (a.wave && !p.wave.isConnected) p.el.insertBefore(p.wave, p.text.nextSibling);
  else if (!a.wave) p.wave.remove();
  const x = (a.actions || [])[0];
  if (x) {
    if (s.act !== x.icon) p.btn.innerHTML = icon((s.act = x.icon), 16);
    if (p.btn.getAttribute('aria-label') !== (x.label || '')) p.btn.setAttribute('aria-label', x.label || '');
    if (!p.btn.isConnected) p.el.appendChild(p.btn);
  } else p.btn.remove();
}

function renderNowBar() {
  const acts = setting('showNowBar') ? getActivities().slice(0, 2) : [];
  // a pill coming or going changes the room the middle column has
  if (acts.length !== nowbarN) {
    nowbarN = acts.length;
    requestAnimationFrame(fitMid);
  }
  const ids = new Set(acts.map((a) => a.id));
  for (const [id, p] of pills) if (!ids.has(id)) (p.el.remove(), pills.delete(id));
  acts.forEach((a, i) => {
    let p = pills.get(a.id);
    if (!p) pills.set(a.id, (p = makePill()));
    p.el.dataset.act = a.id;
    patchPill(p, a);
    if (nowbarEl.children[i] !== p.el) nowbarEl.insertBefore(p.el, nowbarEl.children[i] || null);
  });
}

// An explicit lock (Alt+L, the Quick Panel, Settings, a routine) is One UI's side key: the PIN is needed right away,
// whatever "Lock automatically" says.
let forcePin = false;

/** Locks the screen now. */
export function lockNow() {
  if (pinSet()) {
    forcePin = true;
    Promise.resolve(session.set('lastActive', 0)).catch(() => {});
  }
  showLock();
}

function showLock() {
  if (locked) return;
  locked = true;
  import('./drawer.js').then((m) => m.closeDrawer(true));
  import('./finder.js').then((m) => m.closeFinder());
  import('./quickpanel.js').then((m) => m.closeQuickPanel());
  brief?.closeBrief();
  // menus and dialogs float above every layer: nothing of an app stays over the Lock screen
  closeMenus();
  document.querySelectorAll('.ou-dialog').forEach((d) => d._close?.(null));
  document.body.classList.add('locked');
  document.body.classList.remove('unlocking');
  applyClockStyle();
  renderWidgets();
  renderNotifs();
  renderBrief();
  drawPadlock();
  stopTick?.();
  stopTick = everySecond(tick);
  el.setAttribute('aria-hidden', 'false');
  setTimeout(() => el.focus({ preventScroll: true }), 50);
}

// ——— unlocking (and the PIN) ———
let waiters = [], pinUi = null, pendingKey = null, idleT = 0;

/** True when unlocking has to ask for the PIN now. */
export async function pinNeeded() {
  if (!pinSet()) return false;
  if (forcePin) return true;
  const after = lockAfter();
  if (!after) return true;
  const last = await session.get('lastActive').catch(() => 0);
  return !last || Date.now() - last > after * 60e3;
}

/** Unlocks (asking for the PIN when one is needed). Resolves once the Lock screen is gone; never while it stays up. */
export function unlock() {
  if (!locked) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (pinUi) return;
    if (!pinSet()) return finish(false);
    pinNeeded().then((need) => {
      if (!locked || pinUi) return;
      if (need) askPin();
      else finish(false);
    });
  });
}

function finish(viaPin) {
  if (!locked) return;
  closePin();
  pendingKey = null;
  locked = false;
  forcePin = false;
  stopTick?.();
  stopTick = null;
  Promise.resolve(session.set('lastActive', Date.now())).catch(() => {});
  markActive(true);
  document.body.classList.add('unlocking');
  document.body.classList.remove('locked', 'lk-private');
  el.setAttribute('aria-hidden', 'true');
  const list = waiters;
  waiters = [];
  setTimeout(() => {
    document.body.classList.remove('unlocking');
    briefEl.replaceChildren();
    list.forEach((r) => r());
    emitUnlock({ pin: viaPin });
  }, 380);
}

/** Samsung's keypad over the dimmed wallpaper. */
function askPin() {
  if (pinUi || !locked) return;
  pinUi = keypad({
    mode: 'lock',
    title: t('pin.enter'),
    len: autoConfirm() ? pinDigits() : 0,
    onSubmit: async (code) => {
      const r = await tryPin(code);
      if (r.ok) {
        el.classList.add('pin-ok');
        setTimeout(() => {
          el.classList.remove('pin-ok');
          finish(true);
        }, 140);
        return true;
      }
      return r.wait ? { wait: r.wait } : wrongText(r.n);
    },
    onCancel: () => cancelPin(),
    onForgot: () => forgotPin(),
    onInput: bumpIdle,
  });
  el.classList.add('pin-open');
  el.appendChild(pinUi.el);
  requestAnimationFrame(() => pinUi?.el.classList.add('show'));
  pinUi.el.focus({ preventScroll: true });
  bumpIdle();
  const k = pendingKey;
  pendingKey = null;
  if (k?.digit) {
    k.used = true;
    pinUi.press(k.digit);
  }
}
// Like a phone, the keypad goes back to the Lock screen when nothing is typed for a while.
function bumpIdle() {
  clearTimeout(idleT);
  idleT = setTimeout(() => (document.querySelector('.ou-dialog-scrim') ? bumpIdle() : cancelPin()), 30e3);
}
function closePin() {
  clearTimeout(idleT);
  if (!pinUi) return;
  const p = pinUi;
  pinUi = null;
  p.destroy();
  el.classList.remove('pin-open');
  p.el.remove();
}
/** Back to the Lock screen: what was waiting for the unlock (a shortcut, a deep link) is dropped. */
function cancelPin() {
  closePin();
  waiters = [];
  pendingKey = null;
  drawPadlock();
  if (locked) el.focus({ preventScroll: true });
}
export const pinShowing = () => !!pinUi;

// ——— Always On Display ———
export function showAOD() {
  const time = h('div', { class: 'aod-time' });
  const date = h('div', { class: 'aod-date' });
  const extra = h('div', { class: 'aod-extra' });
  const box = h('div', { class: 'aod-box' }, time, date, extra);
  const aod = h('div', { class: 'aod', tabindex: 0, 'aria-label': t('qp.aod') }, box);
  document.body.appendChild(aod);
  requestAnimationFrame(() => aod.classList.add('show'));
  const stop = everySecond(async (d) => {
    time.innerHTML = clockMarkup(d, 'classic');
    date.textContent = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    if (d.getSeconds() === 0 || !extra.childNodes.length) {
      const b = await getBattery();
      extra.innerHTML = b ? `${batteryIcon(b.level, b.charging, 18)}<span>${Math.round(b.level * 100)}%</span>` : '';
      // drift a little every minute, like real AOD burn-in protection
      box.style.transform = `translate(${(Math.random() - 0.5) * 60}px, ${(Math.random() - 0.5) * 80}px)`;
    }
  });
  const close = () => {
    stop();
    aod.classList.remove('show');
    setTimeout(() => aod.remove(), 500);
    removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    aod.addEventListener('pointerdown', close);
    addEventListener('keydown', close, true);
  }, 300);
  aod.focus();
  document.documentElement.requestFullscreen?.().catch(() => {});
}

// ——— activity tracking for "lock after inactivity" and the PIN's "Lock automatically" ———
const markActive = throttle((force) => {
  if (!locked || force === true) session.set('lastActive', Date.now());
}, 15000);

async function shouldStartLocked() {
  const mode = setting('lockMode');
  // a PIN always guards a new tab opened after "Lock automatically" ran out, whatever "Show Lock screen" says
  if (pinSet() && (await pinNeeded())) return true;
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  const last = await session.get('lastActive');
  return !last || Date.now() - last > setting('lockIdleMin') * 60e3;
}

/** Coming back to this tab after a while locks it again, like a phone that slept (the PIN after "Lock automatically"). */
async function relockOnReturn() {
  if (locked) return;
  const last = await session.get('lastActive').catch(() => 0);
  const away = last ? Date.now() - last : Infinity;
  const mode = setting('lockMode');
  const pinDue = pinSet() && (!lockAfter() || away > lockAfter() * 60e3);
  if (pinDue || (mode !== 'never' && away > setting('lockIdleMin') * 60e3)) showLock();
}

/** A brand-new profile gets a useful set of Lock screen chips (an existing one keeps what it has). */
async function seedWidgets() {
  if (!isExt || store.get('home') != null) return;
  const raw = (await chrome.storage.local.get('settings')).settings;
  if (raw && 'lockWidgets' in raw) return;
  setSetting('lockWidgets', NEW_USER_WIDGETS.filter((id) => BUILTIN_WIDGETS.includes(id) || getLockWidget(id)));
}

const latin = (k) => String(k).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);

export async function initLock() {
  el = $('#lock');
  el.tabIndex = -1;
  await seedWidgets().catch(() => {});
  build();
  applyClockStyle();
  onWallTone(applyClockStyle);
  store.on('settings', () => {
    applyClockStyle();
    if (locked) tick(new Date());
  });
  onSetting('lockShortcuts', build);
  onSetting('lockWidgets', () => locked && renderWidgets());
  onSetting('lockHideContent', () => locked && renderNotifs());
  store.on('notifications', () => locked && renderNotifs());
  store.on('weather', () => locked && (renderWidgets(), renderBrief()));
  store.on('pin', () => {
    if (!pinSet()) forcePin = false;
    if (locked) (renderNotifs(), renderWidgets(), drawPadlock());
  });

  // unlock gestures
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    // buttons (shortcuts, Now Bar pills and their actions, the brief card) handle their own click: capturing the
    // pointer here would retarget that click to the Lock screen, which only unlocks
    if (pinUi || e.target.closest('button, [role="button"]')) return;
    start = { y: e.clientY, x: e.clientX, t: performance.now() };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = Math.min(0, e.clientY - start.y);
    el.style.setProperty('--drag', `${dy}px`);
    el.style.setProperty('--drag-p', String(Math.min(1, -dy / 240)));
  });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    const tapped = Math.abs(dy) < 8 && Math.abs(e.clientX - start.x) < 8;
    start = null;
    el.style.removeProperty('--drag');
    el.style.removeProperty('--drag-p');
    if (dy < -70 || tapped) unlock();
  });
  el.addEventListener('wheel', (e) => {
    if (!pinUi && Math.abs(e.deltaY) > 4) unlock();
  }, { passive: true });
  el.addEventListener('keydown', (e) => {
    if (!locked || e.ctrlKey || e.metaKey || e.altKey) return;
    if (pinUi) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPin();
      } else if (pinUi.key(e)) e.preventDefault();
      return;
    }
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault();
      const ch = e.key;
      // with a PIN, a digit is the PIN's first digit; anything else (a letter) searches once unlocked
      const k = { digit: pinSet() && /^\d$/.test(latin(ch)) ? latin(ch) : '', used: false };
      pendingKey = k;
      unlock().then(() => !k.used && import('./finder.js').then((m) => m.openFinder(ch)));
    } else if (['Enter', ' ', 'Escape', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      unlock();
    }
  });

  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, () => markActive(), { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!locked) session.set('lastActive', Date.now());
    } else relockOnReturn().catch(() => {});
  });

  if (await shouldStartLocked()) showLock();
  else markActive(true);

  // lock widgets and the brief card refresh once a minute while locked
  everyMinute(() => locked && (renderWidgets(), renderBrief(), drawPadlock()));

  // the Now Brief (Lock screen card, the morning sheet after unlock) loads once the screen is decided
  import('./brief.js').then((m) => {
    brief = m;
    m.initBrief();
    if (locked) renderBrief();
  }).catch((e) => console.warn('brief', e));
}

addStrings({
  en: {
    'lock.hint': 'Swipe up, click or start typing',
    'lock.search': 'Search',
    'lock.newNotif': 'New notification',
    'lock.eventAt': 'Event at {time}',
    'lock.eventToday': 'Event today',
  },
  ar: {
    'lock.hint': 'اسحب لأعلى أو انقر أو ابدأ الكتابة',
    'lock.search': 'بحث',
    'lock.newNotif': 'إشعار جديد',
    'lock.eventAt': 'حدث في {time}',
    'lock.eventToday': 'حدث اليوم',
  },
});
