// Built-in app registry + the One UI multi window manager (pop-up view, split screen, minimized pop-ups).
//
// registerApp({
//   id: 'notes',
//   name: 'app.notes' | { en, ar },          // i18n key or literal names
//   icon: { bg: 'linear-gradient(...)', glyph: '<path .../>' }  // glyph = 24px line art, drawn white
//        | { html: () => '<svg…>' }           // fully custom (e.g. Calendar showing today's date)
//   keywords: ['memo', 'ملاحظات'],            // extra Finder terms
//   size: 'phone' | 'wide',                   // window size (default phone)
//   hidden: false,                            // hide from Apps screen (still openable)
//   launch({ from, params }),                 // optional: run this instead of opening a window
//   render(ctx) -> cleanup?                   // build UI; use ctx.page()/ctx.push()
//   search(query) -> [{ title, sub, icon, onOpen }]   // optional Finder results
// })
//
//   render may be async (return a promise of the cleanup) so a big app keeps only its registration in
//   js/apps/<id>.js and imports its UI from js/<id>/ when opened: render: (ctx) => import('../x/ui.js').then((m) => m.render(ctx))
//
// ctx = { app, params, win, page(opts), push(opts), pop(), close(), setParams, depth, focused }
//   ctx.setParams is yours to assign: it's called with new params when the open app is opened again
//   (e.g. a notification click with params.section).
//   ctx.focused is true while this window has the focus: apps that listen to keys on `window` should check it
//   (or currentApp() === id), since other windows stay open and running beside them.
// page/push opts = { title, subtitle, actions: [Element], hero: true, render(body, page) }
//   -> returns page = { el, body, setTitle, setSubtitle, setActions, scrollEl }
//
// Windows (One UI pop-up view; Samsung DeX-like once several are open):
// - openApp(id) opens the app in its own window and focuses it. Other windows stay open and keep running.
//   Opening an app that is already open focuses it (restoring it when minimized) and calls ctx.setParams(params).
// - A lone window that was never moved sits centred over the dimmed Home screen (clicking the dim closes it), as
//   before multi window. With several windows, or one the user moved, windows float over a live Home screen.
// - One UI handle bar on top: drag to move (drop on the left/right edge = split screen, top edge = full screen),
//   double-click = full screen, buttons Transparency / Split screen / Minimize / Full screen / Close. Edges and
//   corners resize. A click raises and focuses a window; clicking the Home screen takes the focus off the windows
//   (currentApp() is then null, so the Home screen gets the keys). Presses inside shell overlays don't count as
//   Home screen clicks (OVERLAYS below): a full-screen layer of your own opts out with a `data-overlay` attribute
//   (or the class .db / .onb for the Daily Board and the welcome tour).
// - Minimize turns the window into a round floating icon on the screen edge (drag it; drop it on Remove to close).
// - Split screen: two windows side by side with One UI's divider (drag = ratio, click = swap / exit / close).
//   A window alone on one side shows the app picker on the other half. When a pair breaks up, the window
//   that stays takes the full screen, as in One UI.
// - Size, position, full screen and transparency are remembered per app in store key `appWindows`
//   ({ [id]: { x, y, w, h, max, alpha } }).
// - Escape: menus/dialogs first (ui.js), then the split picker, the focused window's sub-page, then the window.
//
// For the Recents screen (js/shell/recents.js): openWindows(), onWindowsChange(), windowOf(), minimizeApp(),
// closeAllApps(), splitApp(id, side), popupApp(id), toggleFullScreen(id).

import { h, clamp } from './util.js';
import { icon, addIcons } from './icons.js';
import { tr, t, addStrings, isRtl } from './i18n.js';
import { store, trackUsage } from './store.js';
import { menu, toast, slider } from './ui.js';

addIcons({
  winMin: '<path d="M6 12.5h12"/>',
  winMax: '<path d="M4.5 9V6a1.5 1.5 0 0 1 1.5-1.5h3M15 4.5h3A1.5 1.5 0 0 1 19.5 6v3M19.5 15v3a1.5 1.5 0 0 1-1.5 1.5h-3M9 19.5H6A1.5 1.5 0 0 1 4.5 18v-3"/>',
  winRestore: '<path d="M9 4.5V8a1 1 0 0 1-1 1H4.5M15 4.5V8a1 1 0 0 0 1 1h3.5M19.5 15H16a1 1 0 0 0-1 1v3.5M4.5 15H8a1 1 0 0 1 1 1v3.5"/>',
  winSplit: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><path d="M12 4.5v15"/>',
  winPopup: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><rect x="10.5" y="10" width="7" height="6.5" rx="1.4"/>',
  winAlpha: '<path d="M12 3.8C9.2 7.2 6.2 10.6 6.2 14.1a5.8 5.8 0 0 0 11.6 0c0-3.5-3-6.9-5.8-10.3Z"/><path d="M12 19.9a5.8 5.8 0 0 0 5.8-5.8c0-3.5-3-6.9-5.8-10.3Z" fill="currentColor" stroke="none"/>',
  winSwap: '<path d="M7 8h11.5M15.5 5l3 3-3 3M17 16H5.5M8.5 13l-3 3 3 3"/>',
  recents: '<path d="M7 6.5v11M12 6.5v11M17 6.5v11"/>',
});

const registry = new Map();
const listeners = new Set();
const winListeners = new Set();
const wins = new Map(); // id -> window entry (see create())
const split = { ratio: 0.5, l: null, r: null };
let zTop = 10;
let deskFocus = false; // the Home screen was clicked: no window has the focus
let notifyQueued = false;

const MAX_WINDOWS = 8;
const MIN_W = 300, MIN_H = 320; // smallest window
const SNAP = 16; // px from the screen edge where a dragged window snaps to split screen
const DIV = 12; // split screen divider width
const SIZES = { phone: [460, 880], wide: [1080, 780] };
const reduced = () => document.documentElement.dataset.motion === 'reduce';
const layer = () => document.getElementById('app-layer');
const px = (n) => Math.round(n) + 'px';

export function registerApp(app) {
  registry.set(app.id, app);
  listeners.forEach((cb) => cb());
}

export const getApp = (id) => registry.get(id);
export const getApps = () => [...registry.values()];
export const onAppsChange = (cb) => (listeners.add(cb), () => listeners.delete(cb));
/** The focused window's app id (null when none is open on screen or the Home screen has the focus). */
export const currentApp = () => (deskFocus ? null : topEntry()?.id) || null;
export const appName = (app) => (typeof app === 'string' ? tr(registry.get(app)?.name || app) : tr(app.name));

/** Render an app's icon into a squircle element. */
export function appIconEl(app, size) {
  const ic = app.icon || {};
  const el = h('span', { class: 'app-icon builtin', style: { background: ic.bg || 'var(--accent)' } });
  if (size) el.style.setProperty('--sz', size + 'px');
  el.classList.add(ic.html ? 'custom' : 'glyph');
  if (ic.html) el.innerHTML = typeof ic.html === 'function' ? ic.html() : ic.html;
  else el.innerHTML = `<svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="${ic.color || '#fff'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ic.glyph || ''}</svg>`;
  return el;
}

// ——— window list helpers ———
const entries = () => [...wins.values()];
const visible = () => entries().filter((e) => !e.minimized);
const topEntry = () => visible().sort((a, b) => b.z - a.z)[0] || null;
/** One lone window that was never moved: it keeps the old centred look over a dimmed Home screen. */
function isModal() {
  const v = visible();
  return v.length === 1 && v[0].mode === 'normal' && !v[0].rect && !v[0].auto;
}

/** Open windows, most recently used first (for the Recents screen). */
export function openWindows() {
  const top = topEntry();
  return entries()
    .sort((a, b) => b.used - a.used)
    .map((e) => ({ id: e.id, app: e.app, win: e.win, minimized: e.minimized, mode: e.mode, side: e.side, focused: e === top && !deskFocus }));
}
export const windowOf = (id) => wins.get(id)?.win || null;
export const onWindowsChange = (cb) => (winListeners.add(cb), () => winListeners.delete(cb));
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    winListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error(err);
      }
    });
  });
}

// ——— geometry ———
function defaultRect(app) {
  const [dw, dh] = SIZES[app.size] || SIZES.phone;
  const w = Math.min(dw, innerWidth - 32), hh = Math.min(dh, innerHeight - 48);
  return { x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - hh) / 2), w, h: hh };
}
/** Keeps a floating window on screen: at least 120px of it visible and its handle bar reachable. */
function fit(r) {
  const w = Math.round(clamp(r.w, Math.min(MIN_W, innerWidth), innerWidth));
  const hh = Math.round(clamp(r.h, Math.min(MIN_H, innerHeight), innerHeight));
  return { w, h: hh, x: Math.round(clamp(r.x, 120 - w, innerWidth - 120)), y: Math.round(clamp(r.y, 0, innerHeight - 48)) };
}
const floatRect = (e) => (e.rect ? fit(e.rect) : e.auto ? fit(e.auto) : defaultRect(e.app));
function splitRect(side, ratio = split.ratio) {
  const cut = Math.round(innerWidth * ratio);
  return side === 'l' ? { x: 0, y: 0, w: cut - DIV / 2, h: innerHeight } : { x: cut + DIV / 2, y: 0, w: innerWidth - cut - DIV / 2, h: innerHeight };
}
function rectFor(e) {
  if (e.mode === 'max') return { x: 0, y: 0, w: innerWidth, h: innerHeight };
  if (e.mode === 'split') return splitRect(e.side);
  return floatRect(e);
}
/** A free spot for a new window among the open ones (One UI cascades new pop-ups). */
function cascade(app) {
  const b = defaultRect(app);
  const taken = visible().map(rectFor);
  const free = (r) => !taken.some((o) => Math.abs(o.x - r.x) < 24 && Math.abs(o.y - r.y) < 24);
  for (const s of [1, -1]) {
    for (let k = 0; k < 8; k++) {
      const r = { ...b, x: clamp(b.x + s * k * 32, 8, Math.max(8, innerWidth - b.w - 8)), y: clamp(b.y + s * k * 32, 8, Math.max(8, innerHeight - b.h - 8)) };
      if (free(r)) return r;
    }
  }
  return b;
}
function place(e) {
  const r = rectFor(e), s = e.win.style;
  s.left = px(r.x);
  s.top = px(r.y);
  s.width = px(r.w);
  s.height = px(r.h);
}
/** Animate the next geometry change (full screen, split, back to pop-up). */
function morph(e) {
  if (reduced()) return;
  e.win.classList.add('morph');
  clearTimeout(e.morphT);
  e.morphT = setTimeout(() => e.win.classList.remove('morph'), 380);
}

function saveWin(e, patch) {
  store.update('appWindows', (m) => ({ ...(m || {}), [e.id]: { ...((m || {})[e.id] || {}), ...patch } }));
}
const saveRect = (e) => e.rect && saveWin(e, { x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h, max: false });

// ——— open ———
export function openApp(id, { from, params, side } = {}) {
  const app = registry.get(id);
  if (!app) return console.warn('No app', id);
  if (app.launch) {
    trackUsage('app:' + id);
    return app.launch({ from, params });
  }
  const open = wins.get(id);
  if (open) {
    if (side) tile(open, side);
    else if (open.minimized) restore(open);
    else focusWin(open, true);
    open.ctx.setParams?.(params);
    return;
  }
  trackUsage('app:' + id);
  if (wins.size >= MAX_WINDOWS) {
    const old = entries().sort((a, b) => a.used - b.used)[0];
    closeApp(true, old.id);
    toast(t('apps.tooMany', { n: MAX_WINDOWS, name: appName(old.app) }));
  }
  // while one window waits alone in split screen, the next app fills the other half
  const free = side || pickerSide();
  const e = create(app, params || {});
  if (free) {
    tile(e, free, true);
    zoomIn(e, null);
  } else {
    sync();
    zoomIn(e, from);
  }
  render(e);
  setTimeout(() => {
    if (e.closed || e.minimized) return;
    if (!e.win.contains(document.activeElement)) e.win.querySelector('[autofocus]')?.focus() || e.win.focus();
  }, 60);
}

function create(app, params) {
  const id = app.id;
  const saved = (store.get('appWindows') || {})[id] || {};
  const e = {
    id, app, pages: [], cleanup: null, closed: false,
    mode: saved.max ? 'max' : 'normal', // normal (pop-up) | max (full screen) | split
    side: null, // 'l' | 'r' in split screen
    rect: saved.w ? fit(saved) : null, // where the user put it (remembered)
    auto: null, // a cascaded spot picked because other windows were open
    minimized: false,
    alpha: clamp(+saved.alpha || 1, 0.3, 1),
    z: (zTop += 2),
    used: Date.now(),
    bubble: null,
  };
  // the first window stops being the centred one when a second opens, so neither jumps around later
  const others = visible();
  if (others.length) {
    for (const o of others) if (o.mode === 'normal' && !o.rect && !o.auto) o.auto = defaultRect(o.app);
    if (!e.rect) e.auto = cascade(app);
  }
  const btn = (cls, ic, title, fn) => h('button', {
    class: ['app-handle-btn', cls], title, 'aria-label': title, html: icon(ic, 16),
    onClick: (ev) => {
      ev.stopPropagation();
      fn(ev);
    },
  });
  // Full screen stays the first button in the DOM, as it was before multi window (suites click '.app-handle-btn');
  // CSS `order` lays them out as Transparency, Split screen, Minimize, Full screen, Close.
  const btns = h('div', { class: 'app-handle-btns' },
    btn('hb-max', 'winMax', t('apps.maximize'), () => toggleMax(e)),
    btn('hb-alpha', 'winAlpha', t('apps.opacity'), (ev) => alphaPop(e, ev.currentTarget)),
    btn('hb-split', 'winSplit', t('apps.split'), () => (e.mode === 'split' ? popupApp(id) : splitApp(id))),
    btn('hb-min', 'winMin', t('apps.minimize'), () => minimize(e)),
    btn('hb-close', 'close', t('common.close'), () => closeApp(false, id)));
  const handle = h('div', { class: 'app-handle', title: t('apps.drag') }, h('span', { class: 'app-handle-pill' }), btns);
  e.stack = h('div', { class: 'app-stack' });
  e.win = h('div', { class: ['app-win', `size-${app.size || 'phone'}`], role: 'dialog', 'aria-label': appName(app), 'data-app': id, tabindex: -1 },
    handle, e.stack,
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => h('div', { class: ['app-rz', 'rz-' + d], dataset: { d } })));
  e.btns = btns;
  e.ctx = makeCtx(e, params);
  wins.set(id, e);
  layer().appendChild(e.win);
  e.win.style.zIndex = e.z;
  place(e);
  bindHandle(e, handle);
  e.win.querySelectorAll('.app-rz').forEach((el) => bindResize(e, el));
  e.win.addEventListener('pointerdown', () => {
    if (topEntry() !== e || deskFocus) focusWin(e);
  }, true);
  e.win.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    ev.preventDefault();
    if (pickerSide()) return closePicker();
    if (e.pages.length > 1) e.ctx.pop();
    else closeApp(false, id);
  });
  deskFocus = false;
  return e;
}

function render(e) {
  // render() may return a cleanup function, or a promise of one when the app lazy-loads its UI module
  const fail = (err) => {
    console.error(err);
    e.stack.replaceChildren(h('div', { class: 'app-error' }, String(err?.stack || err)));
  };
  try {
    const ret = e.app.render(e.ctx);
    if (ret && typeof ret.then === 'function') {
      ret.then((fn) => {
        if (typeof fn !== 'function') return;
        if (!e.closed) e.cleanup = fn;
        else fn(); // closed before it finished loading
      }, fail);
    } else e.cleanup = typeof ret === 'function' ? ret : null;
  } catch (err) {
    fail(err);
  }
}

function makeCtx(e, params) {
  const { app, pages, stack } = e;
  const ctx = {
    app,
    params,
    win: e.win,
    close: () => closeApp(false, e.id),
    page: (opts) => {
      const p = makePage(opts, false);
      pages.forEach((x) => x.dispose());
      stack.replaceChildren(p.el);
      pages.length = 0;
      pages.push(p);
      p.adopt(opts.render?.(p.body, p));
      return p;
    },
    push: (opts) => {
      const prev = pages[pages.length - 1];
      const p = makePage(opts, true);
      p.el.classList.add('enter');
      stack.appendChild(p.el);
      pages.push(p);
      p.adopt(opts.render?.(p.body, p));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        p.el.classList.remove('enter');
        prev?.el.classList.add('behind');
      }));
      return p;
    },
    pop: () => {
      if (pages.length < 2) return closeApp(false, e.id);
      const p = pages.pop();
      p.dispose();
      p.el.classList.add('enter');
      pages[pages.length - 1].el.classList.remove('behind');
      pages[pages.length - 1].onReturn?.();
      setTimeout(() => p.el.remove(), 320);
    },
    get depth() {
      return pages.length;
    },
    get focused() {
      return !e.closed && !deskFocus && topEntry() === e;
    },
  };

  function makePage({ title = appName(app), subtitle = '', actions = [], hero = true, className = '' }, back) {
    const small = h('div', { class: 'app-toolbar-title' }, title);
    const acts = h('div', { class: 'app-toolbar-actions' }, actions);
    const heroTitle = h('h1', { class: 'app-hero-title' }, title);
    const heroSub = h('div', { class: 'app-hero-sub' }, subtitle);
    const body = h('div', { class: 'app-body' });
    const scrollEl = h('div', { class: 'app-scroll scroll' }, hero ? h('div', { class: 'app-hero' }, heroTitle, heroSub) : null, body);
    const toolbar = h('div', { class: ['app-toolbar', !hero && 'solid'] },
      back ? h('button', { class: 'ou-icon-btn app-back', title: t('common.back'), html: icon('back', 22), onClick: () => ctx.pop() }) : null,
      small,
      acts);
    const el = h('section', { class: ['app-page', !hero && 'no-hero', className] }, toolbar, scrollEl);
    if (hero) {
      scrollEl.addEventListener('scroll', () => {
        const heroH = scrollEl.firstElementChild.offsetHeight;
        const p = Math.min(1, scrollEl.scrollTop / (heroH * 0.6));
        el.style.setProperty('--collapse', p.toFixed(3));
        toolbar.classList.toggle('scrolled', scrollEl.scrollTop > heroH - 56);
      }, { passive: true });
    }
    let cleanup = null, disposed = false;
    return {
      el,
      body,
      scrollEl,
      // render() may return a cleanup function (or a promise of one); it runs when the page goes away
      adopt(ret) {
        Promise.resolve(ret).then((fn) => {
          if (typeof fn !== 'function') return;
          if (disposed) fn();
          else cleanup = fn;
        });
      },
      dispose() {
        disposed = true;
        try {
          cleanup?.();
        } catch (err) {
          console.error(err);
        }
        cleanup = null;
      },
      setTitle(v) {
        small.textContent = v;
        heroTitle.textContent = v;
      },
      setSubtitle(v) {
        heroSub.textContent = v;
      },
      setActions(list) {
        acts.replaceChildren(...list);
      },
    };
  }
  return ctx;
}

// ——— focus, close, minimize ———
function focusWin(e, moveFocus = false) {
  deskFocus = false;
  e.used = Date.now();
  if (e.z !== zTop) e.z = zTop += 2;
  sync();
  if (moveFocus && !e.win.contains(document.activeElement)) e.win.focus({ preventScroll: true });
}

/** After a window goes away, the next one on top gets the keyboard (so Escape keeps working). */
function focusNext() {
  const next = deskFocus ? null : topEntry();
  if (next && !next.win.contains(document.activeElement)) next.win.focus({ preventScroll: true });
}

/** Closes the focused (top-most) window, or the app given by id. */
export function closeApp(instant = false, id) {
  const e = id ? wins.get(id) : topEntry();
  if (!e) return;
  wins.delete(e.id);
  e.closed = true;
  e.pages.forEach((p) => p.dispose());
  try {
    e.cleanup?.();
  } catch (err) {
    console.error(err);
  }
  if (e.mode === 'split') leaveSplit(e);
  e.bubble?.remove();
  e.bubble = null;
  const { win } = e;
  win.classList.add('closing');
  if (instant || e.minimized || reduced()) win.remove();
  else {
    const a = win.animate([{ transform: 'none', opacity: e.alpha }, { transform: 'translateY(24px) scale(0.92)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(0.22, 0.25, 0, 1)', fill: 'forwards' });
    a.finished.catch(() => {}).then(() => win.remove());
    setTimeout(() => win.remove(), 400);
  }
  if (!visible().length) deskFocus = false;
  sync();
  focusNext();
}

export function closeAllApps() {
  for (const e of entries()) closeApp(true, e.id);
}

/** Minimize a window (the focused one by default) to a floating icon on the screen edge. */
export function minimizeApp(id) {
  const e = id ? wins.get(id) : topEntry();
  if (e && !e.minimized) minimize(e);
}

function minimize(e) {
  if (e.mode === 'split') leaveSplit(e);
  const r = rectFor(e);
  e.minimized = true;
  if (e.win.contains(document.activeElement)) document.activeElement.blur();
  const b = addBubble(e, r);
  if (!reduced()) {
    const br = b.getBoundingClientRect();
    e.win.classList.add('minimizing');
    const a = e.win.animate([
      { transform: 'none', opacity: e.alpha },
      { transform: `translate(${br.left + br.width / 2 - (r.x + r.w / 2)}px, ${br.top + br.height / 2 - (r.y + r.h / 2)}px) scale(0.1)`, opacity: 0 },
    ], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    a.finished.catch(() => {}).then(() => {
      e.win.classList.remove('minimizing');
      a.cancel();
    });
  }
  sync();
  focusNext();
}

function restore(e) {
  const from = e.bubble?.getBoundingClientRect();
  e.bubble?.remove();
  e.bubble = null;
  e.minimized = false;
  focusWin(e, true);
  if (from && !reduced()) {
    const r = rectFor(e);
    e.win.animate([
      { transform: `translate(${from.left + from.width / 2 - (r.x + r.w / 2)}px, ${from.top + from.height / 2 - (r.y + r.h / 2)}px) scale(0.1)`, opacity: 0 },
      { transform: 'none', opacity: e.alpha },
    ], { duration: 320, easing: 'cubic-bezier(0.22, 0.25, 0, 1)' });
  }
}

/** One UI's zoom out of the icon that was tapped (or up from the middle). */
function zoomIn(e, from) {
  if (reduced()) return;
  const r = rectFor(e);
  let start = 'translate(0px, 40px) scale(0.18)';
  if (from) {
    const fr = from.getBoundingClientRect ? from.getBoundingClientRect() : from;
    if (fr && fr.width != null) start = `translate(${fr.left + fr.width / 2 - (r.x + r.w / 2)}px, ${fr.top + fr.height / 2 - (r.y + r.h / 2)}px) scale(0.18)`;
  }
  e.win.animate([
    { transform: start, opacity: 0 },
    { opacity: e.alpha, offset: 0.5 },
    { transform: 'none', opacity: e.alpha },
  ], { duration: 420, easing: 'cubic-bezier(0.22, 0.25, 0, 1)' });
}

// ——— full screen, split screen ———
function toggleMax(e) {
  if (e.mode === 'max') e.mode = 'normal';
  else {
    if (e.mode === 'split') leaveSplit(e);
    e.mode = 'max';
  }
  saveWin(e, { max: e.mode === 'max' });
  morph(e);
  focusWin(e);
}

export function toggleFullScreen(id) {
  const e = wins.get(id);
  if (!e) return;
  if (e.minimized) restore(e);
  toggleMax(e);
}

function detach(e) {
  if (split[e.side] === e) split[e.side] = null;
  e.side = null;
}
/** After a pair broke up, the window that stays takes the full screen (One UI). */
function settle(wasPair) {
  const rest = split.l || split.r;
  if (wasPair && rest) {
    split.l = split.r = null;
    rest.side = null;
    rest.mode = 'max';
    morph(rest);
  }
  if (!split.l || !split.r) split.ratio = 0.5;
}
/** Take a window out of split screen. */
function leaveSplit(e, mode = 'normal') {
  const pair = !!(split.l && split.r);
  detach(e);
  e.mode = mode;
  settle(pair);
}

function tile(e, side, fresh = false) {
  if (e.mode === 'split' && e.side === side) return focusWin(e);
  if (e.mode === 'split') split[e.side] = null;
  const prev = split[side];
  if (prev && prev !== e) {
    prev.mode = 'normal';
    prev.side = null;
    morph(prev);
  }
  if (e.minimized) {
    e.bubble?.remove();
    e.bubble = null;
    e.minimized = false;
  }
  e.mode = 'split';
  e.side = side;
  split[side] = e;
  if (!fresh) morph(e);
  focusWin(e, true);
}

/** Split screen: the app goes to one half (the inline-start one by default), opening it if needed. */
export function splitApp(id, side) {
  side ||= split.l && !split.r ? 'r' : split.r && !split.l ? 'l' : isRtl() ? 'r' : 'l';
  const e = wins.get(id);
  if (e) tile(e, side);
  else openApp(id, { side });
}

/** Back to a floating pop-up window (from split screen or full screen), restoring it if minimized. */
export function popupApp(id) {
  const e = wins.get(id);
  if (!e) return openApp(id);
  if (e.minimized) restore(e);
  if (e.mode === 'split') leaveSplit(e);
  if (e.mode === 'max') saveWin(e, { max: false });
  e.mode = 'normal';
  if (!e.rect && !e.auto) e.auto = defaultRect(e.app);
  morph(e);
  focusWin(e, true);
}

/** The free half while one window waits alone in split screen (the app picker shows there). */
function pickerSide() {
  const l = split.l && !split.l.minimized, r = split.r && !split.r.minimized;
  return l && !r ? 'r' : r && !l ? 'l' : null;
}
function closePicker() {
  const lone = split.l || split.r;
  if (!lone) return;
  leaveSplit(lone);
  morph(lone);
  sync();
}

// ——— the layer: scrim, split screen parts, bubbles ———
let scrimEl, splitBg, divider, picker, pickerKey = '', snapEl, dragging = false;

function sync() {
  const vis = visible();
  const top = topEntry();
  const modal = isModal();
  for (const e of wins.values()) {
    const c = e.win.classList;
    c.toggle('max', e.mode === 'max');
    c.toggle('split', e.mode === 'split');
    c.toggle('split-l', e.mode === 'split' && e.side === 'l');
    c.toggle('split-r', e.mode === 'split' && e.side === 'r');
    c.toggle('minimized', e.minimized);
    c.toggle('focused', e === top && !deskFocus);
    c.toggle('floating', !modal);
    e.win.style.zIndex = e.z;
    e.win.style.opacity = e.alpha < 1 ? String(e.alpha) : '';
    const key = e.mode;
    if (e.btnKey !== key) {
      e.btnKey = key;
      const sp = e.btns.querySelector('.hb-split'), mx = e.btns.querySelector('.hb-max');
      const spT = e.mode === 'split' ? t('apps.popup') : t('apps.split'), mxT = e.mode === 'max' ? t('apps.exitFull') : t('apps.maximize');
      sp.innerHTML = icon(e.mode === 'split' ? 'winPopup' : 'winSplit', 16);
      sp.title = spT;
      sp.setAttribute('aria-label', spT);
      mx.innerHTML = icon(e.mode === 'max' ? 'winRestore' : 'winMax', 16);
      mx.title = mxT;
      mx.setAttribute('aria-label', mxT);
    }
    if (!e.minimized) place(e);
  }
  const host = layer();
  if (!scrimEl) {
    scrimEl = h('div', { class: 'app-scrim', onPointerdown: (ev) => ev.target === scrimEl && isModal() && closeApp() });
    host.prepend(scrimEl);
  }
  scrimEl.classList.toggle('show', modal);
  const cover = vis.some((e) => e.mode !== 'normal');
  document.body.classList.toggle('app-open', modal || cover);
  document.body.classList.toggle('app-windows', vis.length > 0);
  document.body.classList.toggle('app-cover', cover);
  syncSplit(host);
  syncBubbles();
  notify();
}

function syncSplit(host) {
  const l = split.l && !split.l.minimized ? split.l : null, r = split.r && !split.r.minimized ? split.r : null;
  if (!splitBg) {
    splitBg = h('div', { class: 'app-split-bg' });
    host.prepend(splitBg);
  }
  splitBg.classList.toggle('show', !!(l || r));
  // the black goes right under the split windows: pop-ups opened later still float above them
  splitBg.style.zIndex = l || r ? Math.min(l?.z ?? Infinity, r?.z ?? Infinity) - 1 : '';
  // the divider between a pair
  if (l && r) {
    if (!divider) host.appendChild((divider = makeDivider()));
    divider.style.left = px(Math.round(innerWidth * split.ratio) - DIV / 2);
    divider.style.zIndex = Math.max(l.z, r.z) + 1;
  } else if (divider) {
    divider.remove();
    divider = null;
  }
  // the app picker on the free half (not while a window is being dragged out of split screen)
  const side = dragging ? null : pickerSide();
  if (!side) {
    picker?.remove();
    picker = null;
    pickerKey = '';
    return;
  }
  const key = side + '|' + entries().map((e) => e.id + (e.mode === 'split' ? '*' : '')).join(',');
  if (key !== pickerKey) {
    picker?.remove();
    host.appendChild((picker = makePicker(side)));
    pickerKey = key;
  }
  const rr = splitRect(side);
  Object.assign(picker.style, { left: px(rr.x), top: px(rr.y), width: px(rr.w), height: px(rr.h), zIndex: zTop + 1 });
}

function makePicker(side) {
  const tiled = split.l || split.r;
  const tileBtn = (app, running) => h('button', {
    class: ['app-pick', running && 'running'],
    'data-app': app.id,
    onClick: () => splitApp(app.id, side),
  }, appIconEl(app, 52), h('span', null, appName(app)));
  const running = entries().filter((e) => e !== tiled).map((e) => e.app);
  const all = getApps().filter((a) => !a.hidden && !a.launch && a !== tiled.app && !running.includes(a)).sort((a, b) => appName(a).localeCompare(appName(b)));
  return h('div', { class: 'app-split-picker', role: 'dialog', 'aria-label': t('apps.pickSide') },
    h('div', { class: 'app-pick-head' },
      h('div', { class: 'app-pick-title' }, t('apps.pickSide')),
      h('button', { class: 'ou-icon-btn app-pick-x', title: t('common.cancel'), 'aria-label': t('common.cancel'), html: icon('close', 20), onClick: closePicker })),
    h('div', { class: 'app-pick-scroll scroll' },
      running.length ? h('div', { class: 'app-pick-sub' }, t('apps.openApps')) : null,
      running.length ? h('div', { class: 'app-pick-grid' }, running.map((a) => tileBtn(a, true))) : null,
      h('div', { class: 'app-pick-sub' }, t('apps.allApps')),
      h('div', { class: 'app-pick-grid' }, all.map((a) => tileBtn(a, false)))));
}

function makeDivider() {
  const handle = h('span', { class: 'app-divider-handle' });
  const el = h('div', { class: 'app-divider', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('apps.divider'), title: t('apps.divider'), tabindex: 0 }, handle);
  const dividerMenu = () => {
    const { l, r } = split;
    if (!l || !r) return;
    menu(handle, [
      { label: t('apps.swap'), icon: 'winSwap', onClick: swapSplit },
      { label: t('apps.exitSplit'), icon: 'winPopup', onClick: exitSplit },
      '-',
      { label: t('apps.closeApp', { name: appName(l.app) }), icon: 'close', onClick: () => closeApp(false, l.id) },
      { label: t('apps.closeApp', { name: appName(r.app) }), icon: 'close', onClick: () => closeApp(false, r.id) },
    ]);
  };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const sx = ev.clientX;
    let moved = false;
    el.setPointerCapture?.(ev.pointerId);
    el.classList.add('dragging');
    const move = (m) => {
      if (!moved && Math.abs(m.clientX - sx) < 4) return;
      moved = true;
      split.ratio = clamp(m.clientX / innerWidth, 0.06, 0.94);
      sync();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (!moved) return dividerMenu();
      // dragged to an edge: that side's app closes (One UI); otherwise snap to 1/3, 1/2, 2/3
      if (split.ratio < 0.15) return closeApp(false, split.l.id);
      if (split.ratio > 0.85) return closeApp(false, split.r.id);
      const near = [1 / 3, 1 / 2, 2 / 3].find((c) => Math.abs(c - split.ratio) < 0.05);
      split.ratio = clamp(near ?? split.ratio, 0.25, 0.75);
      sync();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (ev) => {
    const d = { ArrowLeft: -0.05, ArrowRight: 0.05 }[ev.key];
    if (d) {
      ev.preventDefault();
      split.ratio = clamp(split.ratio + d, 0.25, 0.75);
      sync();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      dividerMenu();
    }
  });
  return el;
}

function swapSplit() {
  const { l, r } = split;
  if (!l || !r) return;
  split.l = r;
  split.r = l;
  r.side = 'l';
  l.side = 'r';
  split.ratio = 1 - split.ratio;
  morph(l);
  morph(r);
  sync();
}

function exitSplit() {
  for (const e of [split.l, split.r]) {
    if (!e) continue;
    e.mode = 'normal';
    e.side = null;
    if (!e.rect && !e.auto) e.auto = cascade(e.app);
    morph(e);
  }
  split.l = split.r = null;
  split.ratio = 0.5;
  sync();
}

/** The outline that shows where a dragged window will snap (half or full screen). */
function snapGhost(where, z) {
  if (!where) {
    snapEl?.remove();
    snapEl = null;
    return;
  }
  if (!snapEl) layer().appendChild((snapEl = h('div', { class: 'app-snap' })));
  const r = where === 'max' ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : splitRect(where, (where === 'l' ? split.r : split.l) ? split.ratio : 0.5);
  snapEl.dataset.where = where;
  Object.assign(snapEl.style, { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h), zIndex: z });
}

// ——— dragging and resizing ———
function bindHandle(e, handle) {
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button')) return;
    ev.preventDefault();
    focusWin(e);
    const sx = ev.clientX, sy = ev.clientY;
    const before = e.rect;
    let r0 = rectFor(e), moved = false, snap = null, from = null;
    handle.setPointerCapture?.(ev.pointerId);
    const move = (m) => {
      const dx = m.clientX - sx, dy = m.clientY - sy;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        if (e.mode !== 'normal') {
          // pulling a full-screen or split window out: it takes its pop-up size back under the pointer
          const f = floatRect(e);
          const fx = (sx - r0.x) / r0.w;
          if (e.mode === 'split') {
            from = { side: e.side, pair: !!(split.l && split.r), partner: split[e.side === 'l' ? 'r' : 'l'] };
            detach(e);
          } else saveWin(e, { max: false });
          e.mode = 'normal';
          r0 = { ...f, x: sx - fx * f.w, y: Math.max(0, sy - 11) };
        }
        dragging = true;
        e.win.classList.add('dragging');
      }
      e.rect = fit({ ...r0, x: r0.x + dx, y: r0.y + dy });
      snap = m.clientX <= SNAP ? 'l' : m.clientX >= innerWidth - SNAP ? 'r' : m.clientY <= 4 ? 'max' : null;
      snapGhost(snap, e.z - 1);
      sync();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      e.win.classList.remove('dragging');
      snapGhost(null);
      dragging = false;
      if (!moved) return e.win.classList.toggle('btns-on');
      if (from) {
        // dropped on its partner's half: the two swap; dropped anywhere but an edge: the partner takes the screen
        if ((snap === 'l' || snap === 'r') && from.partner && snap === from.partner.side) {
          split[from.side] = from.partner;
          from.partner.side = from.side;
          morph(from.partner);
        } else if (snap !== 'l' && snap !== 'r') settle(from.pair);
      }
      if (snap) {
        e.rect = before; // leaving split or full screen later brings it back where it was
        if (snap === 'max') {
          e.mode = 'max';
          saveWin(e, { max: true });
          morph(e);
          sync();
        } else tile(e, snap);
        return;
      }
      saveRect(e);
      sync();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', (ev) => {
    if (!ev.target.closest('button')) toggleMax(e);
  });
}

function bindResize(e, el) {
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || e.mode !== 'normal') return;
    ev.preventDefault();
    ev.stopPropagation();
    focusWin(e);
    const d = el.dataset.d, sx = ev.clientX, sy = ev.clientY, r0 = rectFor(e);
    el.setPointerCapture?.(ev.pointerId);
    e.win.classList.add('resizing');
    const move = (m) => {
      const dx = m.clientX - sx, dy = m.clientY - sy;
      let { x, y, w, h: hh } = r0;
      if (d.includes('e')) w = clamp(r0.w + dx, MIN_W, innerWidth - r0.x);
      if (d.includes('s')) hh = clamp(r0.h + dy, MIN_H, innerHeight - r0.y);
      if (d.includes('w')) {
        w = clamp(r0.w - dx, MIN_W, r0.x + r0.w);
        x = r0.x + r0.w - w;
      }
      if (d.includes('n')) {
        hh = clamp(r0.h - dy, MIN_H, r0.y + r0.h);
        y = r0.y + r0.h - hh;
      }
      e.rect = { x, y, w, h: hh };
      sync();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      e.win.classList.remove('resizing');
      saveRect(e);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// ——— transparency (One UI pop-up options) ———
function alphaPop(e, anchor) {
  const s = slider({
    min: 30, max: 100, step: 5, value: Math.round(e.alpha * 100), icon: 'winAlpha', label: t('apps.opacity'),
    onInput: (v) => {
      e.alpha = v / 100;
      e.win.style.opacity = e.alpha < 1 ? String(e.alpha) : '';
    },
    onChange: (v) => saveWin(e, { alpha: v / 100 }),
  });
  const box = h('div', { class: 'ou-menu app-alpha-pop', role: 'dialog', 'aria-label': t('apps.opacity') },
    h('div', { class: 'app-alpha-title' }, t('apps.opacity')), s);
  const scrim = h('div', { class: 'ou-menu-scrim', onPointerdown: (ev) => ev.target === scrim && close() }, box);
  (document.getElementById('overlay-layer') || document.body).appendChild(scrim);
  const r = anchor.getBoundingClientRect();
  box.style.left = px(clamp(r.left + r.width / 2 - box.offsetWidth / 2, 8, innerWidth - box.offsetWidth - 8));
  box.style.top = px(clamp(r.bottom + 8, 8, innerHeight - box.offsetHeight - 8));
  requestAnimationFrame(() => box.classList.add('show'));
  s.focus({ preventScroll: true });
  const onKey = (ev) => {
    if (ev.key !== 'Escape' || [...document.querySelectorAll('.ou-menu-scrim, .ou-dialog-scrim')].at(-1) !== scrim) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    close();
  };
  addEventListener('keydown', onKey, true);
  function close() {
    removeEventListener('keydown', onKey, true);
    box.classList.remove('show');
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 160);
  }
  scrim._close = close;
}

// ——— minimized pop-ups: floating icons on the screen edge ———
const BUB = 56;
function bubbleSlot(side, y0, self) {
  const taken = entries().filter((o) => o.bubble && o !== self && o.bubSide === side).map((o) => o.bubY);
  let y = clamp(y0, 64, innerHeight - BUB - 90);
  for (let i = 0; i < 20 && taken.some((ty) => Math.abs(ty - y) < BUB + 8); i++) y += BUB + 10;
  return clamp(y, 64, innerHeight - BUB - 24);
}

function addBubble(e, r) {
  const mid = r.x + r.w / 2;
  e.bubSide = Math.abs(mid - innerWidth / 2) < 40 ? (isRtl() ? 'l' : 'r') : mid < innerWidth / 2 ? 'l' : 'r';
  e.bubY = bubbleSlot(e.bubSide, r.y + 40, e);
  const b = h('button', { class: 'app-bubble', 'data-app': e.id, title: appName(e.app), 'aria-label': t('apps.restore', { name: appName(e.app) }) }, appIconEl(e.app, 40));
  e.bubble = b;
  layer().appendChild(b);
  placeBubble(e);
  bindBubble(e, b);
  return b;
}

function placeBubble(e) {
  e.bubY = clamp(e.bubY, 8, innerHeight - BUB - 8);
  e.bubble.style.left = px(e.bubSide === 'l' ? 10 : innerWidth - BUB - 10);
  e.bubble.style.top = px(e.bubY);
}
function syncBubbles() {
  for (const e of wins.values()) if (e.bubble) placeBubble(e);
}

let removeEl;
function bindBubble(e, b) {
  b.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const sx = ev.clientX, sy = ev.clientY, r0 = b.getBoundingClientRect();
    let moved = false, hot = false;
    b.setPointerCapture?.(ev.pointerId);
    const move = (m) => {
      if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 5) return;
      if (!moved) {
        moved = true;
        b.classList.add('dragging');
        if (!removeEl) layer().appendChild((removeEl = h('div', { class: 'app-bubble-remove' }, h('span', { html: icon('close', 26) }), h('b', null, t('common.remove')))));
        requestAnimationFrame(() => removeEl?.classList.add('show'));
      }
      b.style.left = px(r0.left + m.clientX - sx);
      b.style.top = px(r0.top + m.clientY - sy);
      const rr = removeEl.getBoundingClientRect();
      hot = Math.hypot(m.clientX - (rr.left + rr.width / 2), m.clientY - (rr.top + rr.height / 2)) < 70;
      removeEl.classList.toggle('hot', hot);
    };
    const up = (m) => {
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
      b.classList.remove('dragging');
      const rm = removeEl;
      removeEl = null;
      rm?.classList.remove('show');
      setTimeout(() => rm?.remove(), 200);
      if (!moved) return restore(e);
      if (hot) return closeApp(false, e.id);
      // let go: it sticks to the nearer side of the screen
      e.bubSide = m.clientX < innerWidth / 2 ? 'l' : 'r';
      e.bubY = r0.top + m.clientY - sy;
      placeBubble(e);
    };
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });
  b.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    menu(ev, [
      { label: t('common.open'), icon: 'winPopup', onClick: () => restore(e) },
      { label: t('common.close'), icon: 'close', onClick: () => closeApp(false, e.id) },
    ]);
  });
  b.addEventListener('keydown', (ev) => {
    if (ev.key === 'Delete' || ev.key === 'Backspace') closeApp(false, e.id);
  });
}

// ——— global listeners ———
// Escape: the split picker, then the focused window's sub-page, then the window (menus and dialogs close
// themselves first in ui.js; the Recents screen handles its own).
addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || ev.defaultPrevented || !wins.size) return;
  if (document.querySelector('.ou-dialog-scrim, .ou-menu-scrim, #recents:not(.closing), #edge.show') || document.body.matches('.qp-open, .finder-open, .drawer-open, .locked')) return;
  if (pickerSide()) {
    ev.preventDefault();
    return closePicker();
  }
  const e = deskFocus ? null : topEntry();
  if (!e) return;
  ev.preventDefault();
  if (e.ctx.depth > 1) e.ctx.pop();
  else closeApp(false, e.id);
});

// Clicking the Home screen behind floating windows gives it the focus, like a desktop. Presses inside the shell's
// overlays (Lock screen, Quick Panel, Finder, Apps screen, Edge panel, Recents, menus and dialogs, the Daily Board,
// the welcome tour, anything marked data-overlay) leave the windows' focus alone.
const OVERLAYS = '#app-layer, #overlay-layer, #quickpanel, #recents, #lock, #headsup, #finder, #drawer, #edge, .nav-hint, .db, .onb, .ou-dialog-scrim, .ou-menu-scrim, [data-overlay]';
document.addEventListener('pointerdown', (ev) => {
  if (deskFocus || !wins.size || ev.target.closest?.(OVERLAYS)) return;
  deskFocus = true;
  sync();
}, true);

addEventListener('resize', () => {
  if (wins.size) sync();
});

addStrings({
  en: {
    'apps.maximize': 'Full screen',
    'apps.exitFull': 'Exit full screen',
    'apps.minimize': 'Minimize',
    'apps.split': 'Split screen',
    'apps.popup': 'Pop-up view',
    'apps.opacity': 'Transparency',
    'apps.drag': 'Drag to move · double-click for full screen',
    'apps.restore': 'Open {name}',
    'apps.swap': 'Swap windows',
    'apps.exitSplit': 'Exit split screen',
    'apps.closeApp': 'Close {name}',
    'apps.pickSide': 'Choose an app for the other side',
    'apps.openApps': 'Open apps',
    'apps.allApps': 'All apps',
    'apps.divider': 'Split screen divider',
    'apps.tooMany': 'Up to {n} windows can be open. {name} was closed.',
  },
  ar: {
    'apps.maximize': 'ملء الشاشة',
    'apps.exitFull': 'الخروج من ملء الشاشة',
    'apps.minimize': 'تصغير',
    'apps.split': 'تقسيم الشاشة',
    'apps.popup': 'العرض المنبثق',
    'apps.opacity': 'الشفافية',
    'apps.drag': 'اسحب للنقل · انقر مرتين لملء الشاشة',
    'apps.restore': 'فتح {name}',
    'apps.swap': 'تبديل النوافذ',
    'apps.exitSplit': 'الخروج من تقسيم الشاشة',
    'apps.closeApp': 'إغلاق {name}',
    'apps.pickSide': 'اختر تطبيقًا للجانب الآخر',
    'apps.openApps': 'التطبيقات المفتوحة',
    'apps.allApps': 'كل التطبيقات',
    'apps.divider': 'فاصل تقسيم الشاشة',
    'apps.tooMany': 'يمكن فتح {n} نوافذ كحد أقصى. تم إغلاق {name}.',
  },
});
