// Quick Panel (One UI 9): borderless tiles, thick sliders, media card and notifications.
// Collapsed (one swipe: a row of buttons, brightness, media, notifications) or expanded (Dark mode and Focus big
// tiles, every button in pages you swipe through, both sliders). Edit buttons (the pencil) chooses and orders the
// buttons: the first six are the collapsed row. Registered tiles redraw while the panel is open.
// Also owns Focus mode (timed, or "Until I turn it off"), the screen filters (brightness / Eye comfort / flashlight)
// and heads-up banners.
import { h, $, $$, everySecond, pad2, clamp } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, fmtHM, fmtPeriod, fmtDate, fmtRelative, isRtl } from '../core/i18n.js';
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { slider, menu } from '../core/ui.js';
import { openApp, getApp, appIconEl, appName } from '../core/apps.js';
import { registerActivity, getActivities, openActivity } from '../core/activity.js';
import { notify, dismissNotification, clearNotifications } from '../core/notify.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import * as sounds from './sounds.js';
import { getTiles, activeMedia, onMediaChange } from '../core/hooks.js';

addIcons({
  qpEdit: '<path d="M4.5 19.5h3.8L19 8.8a2.2 2.2 0 0 0 0-3.1l-.7-.7a2.2 2.2 0 0 0-3.1 0L4.5 15.7Z"/><path d="m13.5 6.5 4 4"/>',
});

let el, panel, open = false, expanded = true, editing = false, stopClock = null, waveRaf = null;
const bootTime = Date.now();
const PER_PAGE = 12; // 4 × 3 buttons per page, as One UI's expanded panel
const ROW = 6; // buttons in the collapsed panel

// ——— Focus ———
// store `focus` = { startedAt, endsAt, minutes } while a session runs; endsAt null (and minutes null) means
// "Until I turn it off". Health, Wellbeing and Modes and Routines read the same key.
export function startFocus(minutes = setting('focusMinutes')) {
  const now = Date.now();
  if (minutes == null || !(minutes > 0) || minutes === Infinity) {
    store.set('focus', { startedAt: now, endsAt: null, minutes: null });
    cancelSchedule('focus');
    return;
  }
  const endsAt = now + minutes * 60e3;
  store.set('focus', { startedAt: now, endsAt, minutes });
  scheduleAt('focus', endsAt);
}

export function stopFocus() {
  const f = store.get('focus');
  if (f?.startedAt) logFocus(f.startedAt, f.endsAt == null ? Date.now() : Math.min(Date.now(), f.endsAt));
  store.set('focus', null);
  cancelSchedule('focus');
}

/** Finished or stopped Focus sessions, newest first ({ start, end }, last 400), for Health's Daily activity. */
function logFocus(start, end) {
  if (end - start < 60e3 || (store.get('focusLog') || []).some((x) => x.start === start)) return;
  store.update('focusLog', (l) => [{ start, end }, ...(l || [])].slice(0, 400));
}

/** A Focus session is on: timed and not over yet, or open-ended. */
export const focusActive = (f = store.get('focus')) => !!(f && (f.endsAt == null ? f.startedAt : f.endsAt > Date.now()));
export const focusOpenEnded = (f = store.get('focus')) => !!(f && f.startedAt && f.endsAt == null);

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  return (hh ? hh + ':' + pad2(Math.floor((s % 3600) / 60)) : Math.floor(s / 60)) + ':' + pad2(s % 60);
};

registerActivity('focus', () => {
  const f = store.get('focus');
  if (!focusActive(f)) return null;
  const actions = [{ icon: 'stop', label: t('qp.endFocus'), onClick: stopFocus }];
  // open-ended: the time spent so far counts up
  if (f.endsAt == null) return { icon: 'dnd', color: '#8a5cf6', title: mmss(Date.now() - f.startedAt), sub: t('qp.focus') + ' · ' + t('qp.untilOffShort'), priority: 8, actions };
  const left = f.endsAt - Date.now();
  return { icon: 'dnd', color: '#8a5cf6', title: mmss(left), sub: t('qp.focus'), progress: 1 - left / (f.endsAt - f.startedAt), priority: 8, actions };
});

// ——— screen filters ———
function applyFilters() {
  const s = store.get('settings');
  $('#dim-filter').style.opacity = String(((100 - clamp(s.brightness, 30, 100)) / 70) * 0.7);
  const eye = $('#eye-filter');
  eye.style.opacity = s.eyeComfort ? String(0.08 + (s.eyeComfortLevel / 100) * 0.32) : '0';
}

export function torch(on = !document.body.classList.contains('torch')) {
  document.body.classList.toggle('torch', on);
  if (on) {
    const off = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      torch(false);
      removeEventListener('pointerdown', off, true);
      removeEventListener('keydown', off, true);
    };
    setTimeout(() => {
      addEventListener('pointerdown', off, true);
      addEventListener('keydown', off, true);
    }, 50);
  }
  refreshTiles();
}

// ——— tiles ———
function bigTiles() {
  const s = store.get('settings');
  const dark = document.documentElement.dataset.theme === 'dark';
  const focus = store.get('focus');
  const fOn = focusActive(focus), fOpen = focusOpenEnded(focus);
  return [
    {
      id: 'dark', icon: dark ? 'moon' : 'sun', label: t('qp.darkMode'), on: dark,
      state: s.theme === 'auto' ? t('qp.auto') : dark ? t('common.on') : t('common.off'),
      toggle: () => setSetting('theme', dark ? 'light' : 'dark'),
      more: (e) => menu(e, ['auto', 'light', 'dark'].map((v) => ({ label: t('qp.theme.' + v), checked: s.theme === v, onClick: () => setSetting('theme', v) }))),
    },
    {
      id: 'focus', icon: 'dnd', label: t('qp.focus'), on: fOn,
      state: !fOn ? t('common.off') : fOpen ? t('qp.untilOffShort') : t('qp.minLeft', { n: Math.ceil((focus.endsAt - Date.now()) / 60e3) }),
      toggle: () => (fOn ? stopFocus() : startFocus()),
      more: (e) => menu(e, [
        ...[15, 25, 45, 60, 90].map((m) => ({ label: t('qp.minutes', { n: m }), checked: !fOpen && s.focusMinutes === m, onClick: () => { setSetting('focusMinutes', m); startFocus(m); } })),
        '-',
        { label: t('qp.untilOff'), checked: fOpen, onClick: () => startFocus(null) },
      ]),
    },
  ];
}

/** Every small tile there is: the built-in ones, then the ones apps registered (core/hooks.js). */
function allSmall() {
  const s = store.get('settings');
  return [
    { id: 'eye', icon: 'eyeComfort', label: t('qp.eyeComfort'), on: s.eyeComfort, toggle: () => setSetting('eyeComfort', !s.eyeComfort) },
    { id: 'torch', icon: 'flashlight', label: t('qp.flashlight'), on: document.body.classList.contains('torch'), toggle: () => { closeQuickPanel(); setTimeout(() => torch(true), 200); } },
    { id: 'aod', icon: 'clock', label: t('qp.aod'), on: false, toggle: () => { closeQuickPanel(); import('./lock.js').then((m) => m.showAOD()); } },
    { id: 'live', icon: 'image', label: t('qp.liveWallpaper'), on: s.wallpaperAnimated, toggle: () => setSetting('wallpaperAnimated', !s.wallpaperAnimated) },
    { id: 'edge', icon: 'edge', label: t('qp.edgePanel'), on: s.edgePanel, toggle: () => setSetting('edgePanel', !s.edgePanel) },
    { id: 'blur', icon: 'layout', label: t('qp.blur'), on: s.blur, toggle: () => setSetting('blur', !s.blur) },
    { id: 'newtab', icon: 'tab', label: t('qp.newTabLinks'), on: s.openLinks === 'new', toggle: () => setSetting('openLinks', s.openLinks === 'new' ? 'same' : 'new') },
    { id: 'lock', icon: 'lock', label: t('qp.lock'), on: false, toggle: () => { closeQuickPanel(); import('./lock.js').then((m) => m.lockNow()); } },
    // a tile may ask to close the panel by returning true from toggle()
    ...getTiles().map((x) => {
      let label = x.id, on = false;
      try {
        label = x.label();
        on = !!x.on?.();
      } catch (e) {
        console.error('tile', x.id, e);
      }
      return { id: x.id, icon: x.icon, label, on, toggle: () => { if (x.toggle() === true) closeQuickPanel(); } };
    }),
  ];
}

/**
 * The buttons the panel shows, in order. Store key `qpTiles` = { tiles: [id], known: [id] } once edited: buttons
 * that appeared later (a new app's tile) join at the end; the ones taken out stay out.
 */
function smallTiles(all = allSmall()) {
  const lay = store.get('qpTiles');
  if (!lay || !Array.isArray(lay.tiles)) return all;
  const byId = new Map(all.map((x) => [x.id, x]));
  const known = new Set(lay.known || lay.tiles);
  return [...lay.tiles.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...all.filter((x) => !known.has(x.id))];
}

export function setTileOrder(ids) {
  store.set('qpTiles', { tiles: [...ids], known: allSmall().map((x) => x.id) });
}

let tilesEl, rowEl, mediaEl, notifsEl, activityEl, timeEl, dateEl, cardEl, toggleEl, editEl, volEl;
let tileSig = '';

// Buttons are patched in place while the panel is open, so a click looks its tile up again (its closure is current).
function runSmall(id) {
  allSmall().find((x) => x.id === id)?.toggle();
  refreshTiles();
}
function runBig(id, e, more = false) {
  const tl = bigTiles().find((x) => x.id === id);
  if (!tl) return;
  if (more) return tl.more?.(e);
  tl.toggle();
  refreshTiles();
}

const smallBtn = (tl) =>
  h('button', { class: ['qp-tile', tl.on && 'on'], 'aria-pressed': String(!!tl.on), title: tl.label, dataset: { id: tl.id }, onClick: () => runSmall(tl.id) },
    h('span', { class: 'qp-t-ico', html: icon(tl.icon, 24) }),
    h('span', { class: 'qp-t-label' }, tl.label));

function renderTiles() {
  if (!tilesEl) return;
  const big = bigTiles(), small = smallTiles();
  tileSig = small.map((x) => x.id).join();
  const pages = [];
  for (let i = 0; i < small.length; i += PER_PAGE) pages.push(small.slice(i, i + PER_PAGE));
  const scroller = tilesEl.querySelector('.qp-small');
  const at = scroller?.scrollLeft || 0;
  const strip = h('div', { class: 'qp-small' }, pages.map((p) => h('div', { class: 'qp-tpage' }, p.map(smallBtn))));
  const dots = pages.length > 1 ? h('div', { class: 'qp-tdots' }, pages.map((_, i) => h('button', { class: ['qp-tdot', !i && 'on'], 'aria-label': t('home.page', { n: i + 1 }), onClick: () => strip.scrollTo({ left: (isRtl() ? -1 : 1) * i * strip.clientWidth, behavior: 'smooth' }) }))) : null;
  strip.addEventListener('scroll', () => {
    const i = Math.round(Math.abs(strip.scrollLeft) / Math.max(1, strip.clientWidth));
    dots?.querySelectorAll('.qp-tdot').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  tilesEl.replaceChildren(
    h('div', { class: 'qp-big' },
      big.map((tl) =>
        h('div', { class: ['qp-tile-big', tl.on && 'on'], dataset: { id: tl.id } },
          h('button', { class: 'qp-tb-main', 'aria-pressed': String(!!tl.on), onClick: (e) => runBig(tl.id, e) },
            h('span', { class: 'qp-tb-ico', html: icon(tl.icon, 24) }),
            h('span', { class: 'qp-tb-text' }, h('span', { class: 'qp-tb-label' }, tl.label), h('span', { class: 'qp-tb-state' }, tl.state))),
          tl.more ? h('button', { class: 'qp-tb-more', 'aria-label': t('common.more'), html: icon('down', 18), onClick: (e) => runBig(tl.id, e, true) }) : null))),
    strip,
    ...(dots ? [dots] : []));
  if (at) strip.scrollLeft = at;
  // the collapsed panel's row: the first six buttons, icons only
  rowEl.replaceChildren(...small.slice(0, ROW).map((tl) =>
    h('button', { class: ['qp-mini', tl.on && 'on'], 'aria-pressed': String(!!tl.on), title: tl.label, 'aria-label': tl.label, dataset: { id: tl.id }, html: icon(tl.icon, 24), onClick: () => runSmall(tl.id) })));
}

/**
 * Brings the buttons up to date while the panel is open (a registered tile's state can change any time): the same
 * buttons in the same order are patched in place, so a click in progress is never lost.
 */
export function refreshTiles() {
  if (!tilesEl || !open || editing) return;
  const small = smallTiles();
  if (small.map((x) => x.id).join() !== tileSig) return renderTiles();
  const patch = (node, tl, withLabel) => {
    if (!node) return;
    node.classList.toggle('on', !!tl.on);
    (node.matches('button') ? node : node.querySelector('button'))?.setAttribute('aria-pressed', String(!!tl.on));
    if (withLabel && node.title !== tl.label) {
      node.title = tl.label;
      const lb = node.querySelector('.qp-t-label');
      if (lb) lb.textContent = tl.label;
    }
    if (node._icon !== tl.icon) {
      node._icon = tl.icon;
      const ico = node.querySelector('.qp-t-ico, .qp-tb-ico') || (node.classList.contains('qp-mini') ? node : null);
      if (ico) ico.innerHTML = icon(tl.icon, 24);
    }
  };
  for (const tl of small) {
    patch(tilesEl.querySelector(`.qp-tile[data-id="${CSS.escape(tl.id)}"]`), tl, true);
    patch(rowEl.querySelector(`.qp-mini[data-id="${CSS.escape(tl.id)}"]`), tl, true);
  }
  for (const tl of bigTiles()) {
    const node = tilesEl.querySelector(`.qp-tile-big[data-id="${tl.id}"]`);
    if (!node) continue;
    patch(node, tl, false);
    const st = node.querySelector('.qp-tb-state');
    if (st && st.textContent !== tl.state) st.textContent = tl.state;
  }
}

/** Collapsed: one row of buttons; expanded: everything. */
export function setExpanded(on) {
  expanded = !!on;
  panel?.classList.toggle('collapsed', !expanded);
  if (toggleEl) {
    toggleEl.innerHTML = icon(expanded ? 'up' : 'down', 22);
    toggleEl.setAttribute('aria-label', expanded ? t('qp.collapse') : t('qp.expand'));
    toggleEl.setAttribute('aria-expanded', String(expanded));
  }
}
export const isQuickPanelExpanded = () => expanded;

// ——— Edit buttons ———
function openEdit() {
  if (editing) return;
  editing = true;
  setExpanded(true);
  panel.classList.add('editing');
  renderEdit(smallTiles().map((x) => x.id));
  editEl.querySelector('button')?.focus({ preventScroll: true });
}

function closeEdit(saveIt = true) {
  if (!editing) return;
  if (saveIt) setTileOrder(editEl._ids);
  editing = false;
  panel.classList.remove('editing');
  editEl.replaceChildren();
  renderTiles();
}

function renderEdit(ids) {
  editEl._ids = ids;
  const all = allSmall();
  const byId = new Map(all.map((x) => [x.id, x]));
  const active = ids.filter((id) => byId.has(id));
  const rest = all.filter((x) => !active.includes(x.id));
  const set = (next) => renderEdit(next);
  const pages = [];
  for (let i = 0; i < Math.max(1, active.length); i += PER_PAGE) pages.push(active.slice(i, i + PER_PAGE));
  const tileEl = (tl, act) =>
    h('div', { class: ['qpe-tile', act && 'act'], dataset: { id: tl.id } },
      h('span', { class: 'qp-t-ico', html: icon(tl.icon, 24) }),
      h('span', { class: 'qp-t-label' }, tl.label),
      h('button', { class: ['qpe-badge', act ? 'minus' : 'plus'], 'aria-label': (act ? t('common.remove') : t('common.add')) + ' ' + tl.label, html: icon(act ? 'minus' : 'plus', 14), onClick: () => set(act ? active.filter((x) => x !== tl.id) : [...active, tl.id]) }));
  const activeGrids = pages.map((p, pi) =>
    h('div', { class: 'qpe-page' },
      h('div', { class: 'qpe-page-num' }, t('home.page', { n: pi + 1 })),
      h('div', { class: 'qpe-grid act' }, p.map((id, k) => {
        const node = tileEl(byId.get(id), true);
        if (pi === 0 && k < ROW) node.classList.add('first');
        return node;
      }))));
  editEl.replaceChildren(
    h('div', { class: 'qpe-head' },
      h('b', null, t('qp.editButtons')),
      h('button', { class: 'qp-pill', onClick: () => set(allSmall().map((x) => x.id)) }, t('qp.reset')),
      h('button', { class: 'qp-pill primary qpe-done', onClick: () => closeEdit(true) }, t('common.done'))),
    h('div', { class: 'qpe-sub' }, t('qp.available')),
    h('div', { class: 'qpe-grid avail' }, rest.length ? rest.map((tl) => tileEl(tl, false)) : h('div', { class: 'qpe-none' }, t('qp.allAdded'))),
    h('div', { class: 'qpe-sub' }, t('qp.editHint', { n: ROW })),
    ...activeGrids);
  bindEditDrag();
}

/** Drag an active button among the others (across pages too); the order is kept when you let go. */
function bindEditDrag() {
  $$('.qpe-tile.act', editEl).forEach((node) => {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.qpe-badge')) return;
      const sx = e.clientX, sy = e.clientY, r0 = node.getBoundingClientRect();
      let moving = false;
      const place = (ev) => {
        const r = node.getBoundingClientRect();
        const tx = ev.clientX - sx - (r.left - (+node.dataset.tx || 0) - r0.left);
        const ty = ev.clientY - sy - (r.top - (+node.dataset.ty || 0) - r0.top);
        node.dataset.tx = tx;
        node.dataset.ty = ty;
        node.style.translate = `${tx}px ${ty}px`;
      };
      const move = (ev) => {
        if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!moving) {
          moving = true;
          node.classList.add('moving');
        }
        place(ev);
        const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest?.('.qpe-tile.act')).find((n) => n && n !== node);
        if (!over) return;
        const r = over.getBoundingClientRect();
        const before = (ev.clientX < r.left + r.width / 2) !== isRtl();
        const ref = before ? over : over.nextSibling;
        if (ref === node || ref === node.nextSibling) return;
        over.parentNode.insertBefore(node, ref);
        place(ev);
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!moving) return;
        node.classList.remove('moving');
        node.style.translate = '';
        renderEdit($$('.qpe-tile.act', editEl).map((n) => n.dataset.id));
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  });
}

// ——— media, notifications, activities ———
function renderMedia() {
  if (!mediaEl) return;
  // a registered media source (Samsung Music…) wins over the ambient sounds when it has something loaded
  const ext = activeMedia();
  if (ext && (ext.st.playing || !sounds.state().playing)) return renderExtMedia(ext);
  const st = sounds.state();
  const s = st.sound || sounds.SOUNDS.find((x) => x.id === (setting('lastSound') || 'rain'));
  mediaEl.style.setProperty('--media', s.color);
  mediaEl.classList.toggle('playing', st.playing);
  const bars = h('div', { class: 'qp-wave' }, Array.from({ length: 22 }, () => h('i')));
  mediaEl.replaceChildren(
    h('div', { class: 'qp-media-art', html: icon(s.icon, 30) }),
    h('div', { class: 'qp-media-info' },
      h('div', { class: 'qp-media-title' }, sounds.soundName(s.id)),
      h('div', { class: 'qp-media-sub' }, t('sound.title')),
      bars),
    h('div', { class: 'qp-media-ctrls' },
      h('button', { class: 'ou-icon-btn', 'aria-label': t('sound.prev'), html: icon('prev', 20), onClick: () => sounds.step(-1) }),
      h('button', { class: 'ou-icon-btn qp-play', 'aria-label': st.playing ? t('sound.pause') : t('sound.play'), html: icon(st.playing ? 'pause' : 'play', 22), onClick: () => sounds.toggle() }),
      h('button', { class: 'ou-icon-btn', 'aria-label': t('sound.next'), html: icon('next', 20), onClick: () => sounds.step(1) })));
  cancelAnimationFrame(waveRaf);
  if (st.playing && open) {
    const is = [...bars.children];
    const loop = () => {
      const lv = sounds.levels(is.length);
      is.forEach((b, i) => (b.style.transform = `scaleY(${0.15 + lv[i] * 0.85 + Math.random() * 0.08})`));
      waveRaf = requestAnimationFrame(loop);
    };
    loop();
  }
}

function renderExtMedia({ src, st }) {
  cancelAnimationFrame(waveRaf);
  mediaEl.style.setProperty('--media', st.color || 'var(--accent)');
  mediaEl.classList.toggle('playing', !!st.playing);
  const art = st.art ? h('img', { src: st.art, alt: '' }) : null;
  mediaEl.replaceChildren(
    h('button', { class: 'qp-media-art', html: art ? '' : icon(st.icon || 'music', 30), onClick: () => { closeQuickPanel(); src.open?.(); } }, art),
    h('div', { class: 'qp-media-info' },
      h('div', { class: 'qp-media-title' }, st.title || ''),
      h('div', { class: 'qp-media-sub' }, st.sub || '')),
    h('div', { class: 'qp-media-ctrls' },
      h('button', { class: 'ou-icon-btn', 'aria-label': t('sound.prev'), html: icon('prev', 20), onClick: () => src.prev?.() }),
      h('button', { class: 'ou-icon-btn qp-play', 'aria-label': st.playing ? t('sound.pause') : t('sound.play'), html: icon(st.playing ? 'pause' : 'play', 22), onClick: () => src.toggle?.() }),
      h('button', { class: 'ou-icon-btn', 'aria-label': t('sound.next'), html: icon('next', 20), onClick: () => src.next?.() })));
}

export function notifIcon(n) {
  const app = getApp(n.app);
  return app ? appIconEl(app) : h('span', { class: 'app-icon builtin', style: { background: 'var(--accent)' }, html: `<svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon(n.icon || 'bell').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>` });
}

function renderNotifs() {
  if (!notifsEl) return;
  const list = store.get('notifications') || [];
  if (!list.length) {
    notifsEl.replaceChildren(h('div', { class: 'qp-no-notifs' }, t('qp.noNotifs')));
    return;
  }
  notifsEl.replaceChildren(
    h('div', { class: 'qp-notifs-head' }, h('span', null, t('qp.notifications')), h('button', { class: 'qp-clear', onClick: () => clearNotifications() }, t('qp.clear'))),
    ...list.slice(0, 20).map((n) =>
      h('div', { class: ['qp-notif', !n.read && 'unread'], onClick: () => { if (getApp(n.app)) { closeQuickPanel(); openApp(n.app); } } },
        h('span', { class: 'qp-notif-ico' }, notifIcon(n)),
        h('div', { class: 'qp-notif-text' },
          h('div', { class: 'qp-notif-top' }, h('span', { class: 'qp-notif-app' }, getApp(n.app) ? appName(n.app) : t('qp.system')), h('span', { class: 'qp-notif-time' }, fmtRelative(n.time))),
          h('div', { class: 'qp-notif-title' }, n.title),
          n.body ? h('div', { class: 'qp-notif-body' }, n.body) : null),
        h('button', { class: 'qp-notif-x', 'aria-label': t('common.close'), html: icon('close', 16), onClick: (e) => { e.stopPropagation(); dismissNotification(n.id); } })))
  );
}

/** Now Bar activities, minus the ambient sounds and the media source the media card already shows. */
export function panelActivities() {
  const media = activeMedia()?.src.id;
  return getActivities().filter((a) => a.id !== 'sound' && !(media && (a.id === media || a.id.startsWith(media + ':'))));
}

// Refreshed every second while the panel is open: when the same activities (and buttons) are still there, their
// texts, colour and progress are patched in place, so a click that lands during a refresh still reaches its row.
// The handlers read the latest activity by id.
let actSig = '';
const actNow = new Map();
function renderActivities() {
  if (!activityEl) return;
  const acts = panelActivities();
  activityEl.hidden = !acts.length;
  actNow.clear();
  acts.forEach((a) => actNow.set(a.id, a));
  const sig = JSON.stringify(acts.map((a) => [a.id, a.icon, a.progress != null, (a.actions || []).map((x) => [x.icon, x.label])]));
  if (sig === actSig && activityEl.children.length === acts.length) {
    acts.forEach((a, i) => {
      const row = activityEl.children[i];
      row.style.setProperty('--act', a.color || 'var(--accent)');
      const b = row.querySelector('.qp-act-text b'), sm = row.querySelector('.qp-act-text small'), bar = row.querySelector('.qp-act-bar i');
      if (b.textContent !== String(a.title ?? '')) b.textContent = a.title ?? '';
      if (sm.textContent !== (a.sub || '')) sm.textContent = a.sub || '';
      if (bar) bar.style.width = Math.round(a.progress * 100) + '%';
    });
    return;
  }
  actSig = sig;
  const cur = (id) => actNow.get(id);
  activityEl.replaceChildren(
    ...acts.map((a) =>
      h('div', { class: 'qp-activity', dataset: { id: a.id }, style: { '--act': a.color || 'var(--accent)' }, onClick: () => { const x = cur(a.id) || a; if (x.app || x.open) { closeQuickPanel(); openActivity(x); } } },
        h('span', { class: 'qp-act-ico', html: icon(a.icon || 'bell', 20) }),
        h('span', { class: 'qp-act-text' }, h('b', null, a.title), h('small', null, a.sub || '')),
        a.progress != null ? h('span', { class: 'qp-act-bar' }, h('i', { style: { width: Math.round(a.progress * 100) + '%' } })) : null,
        ...(a.actions || []).map((x0, k) => h('button', { class: 'ou-icon-btn', 'aria-label': x0.label, title: x0.label, html: icon(x0.icon, 18), onClick: (e) => {
          e.stopPropagation();
          const x = cur(a.id)?.actions?.[k] || x0;
          if (x.open) closeQuickPanel();
          x.onClick?.(e);
          refreshTiles();
        } }))))
  );
}

function build() {
  timeEl = h('span', { class: 'qp-time' });
  dateEl = h('span', { class: 'qp-date' });
  tilesEl = h('div', { class: 'qp-tiles' });
  rowEl = h('div', { class: 'qp-row' });
  mediaEl = h('div', { class: 'qp-media' });
  notifsEl = h('div', { class: 'qp-notifs' });
  activityEl = h('div', { class: 'qp-activities' });
  editEl = h('div', { class: 'qp-edit' });
  const bright = slider({ min: 30, max: 100, value: setting('brightness'), icon: 'brightness', label: t('qp.brightness'), onInput: (v) => setSetting('brightness', v) });
  const vol = slider({ min: 0, max: 100, value: Math.round(sounds.state().volume * 100), icon: 'volume', label: t('qp.volume'), onInput: (v) => sounds.setVolume(v / 100) });
  volEl = vol;
  toggleEl = h('button', { class: 'qp-toggle', onClick: () => setExpanded(!expanded) });
  cardEl = h('div', { class: 'qp-card' }, rowEl, tilesEl, h('div', { class: 'qp-sliders' }, bright, vol), toggleEl);
  panel = h('div', { class: 'qp-panel', role: 'dialog', 'aria-label': t('qp.title') },
    h('div', { class: 'qp-head' },
      h('div', { class: 'qp-clock' }, timeEl, dateEl),
      h('div', { class: 'qp-head-btns' },
        h('button', { class: 'ou-icon-btn qp-edit-btn', title: t('qp.editButtons'), 'aria-label': t('qp.editButtons'), html: icon('qpEdit', 22), onClick: () => (editing ? closeEdit(true) : openEdit()) }),
        h('button', { class: 'ou-icon-btn', title: t('common.search'), html: icon('search', 22), onClick: () => { closeQuickPanel(); import('./finder.js').then((m) => m.openFinder()); } }),
        h('button', { class: 'ou-icon-btn', title: t('qp.lock'), html: icon('power', 22), onClick: () => { closeQuickPanel(); import('./lock.js').then((m) => m.lockNow()); } }),
        h('button', { class: 'ou-icon-btn', title: t('common.settings'), html: icon('settings', 22), onClick: () => { closeQuickPanel(); openApp('settings'); } }))),
    cardEl,
    editEl,
    activityEl,
    mediaEl,
    notifsEl,
    h('div', { class: 'qp-grip', onClick: () => closeQuickPanel() }, h('span')));
  el.replaceChildren(h('div', { class: 'qp-scroll scroll' }, panel));
  onSetting('brightness', (v) => bright.set(v));
  onMediaChange(() => {
    renderMedia();
    if (open) renderActivities();
  });
  sounds.onSoundChange((st) => {
    vol.set(Math.round(st.volume * 100));
    renderMedia();
  });
  setExpanded(true);
}

/** Opens the panel: expanded (status bar, Alt+Q, ↓) or collapsed (a swipe or scroll down on the Home screen). */
export function openQuickPanel(opts) {
  const big = opts?.expanded ?? true; // (callers may pass nothing, null or an event)
  if (open || document.body.classList.contains('locked')) return;
  open = true;
  import('./drawer.js').then((m) => m.closeDrawer(true));
  setExpanded(big);
  renderTiles();
  renderMedia();
  renderNotifs();
  renderActivities();
  stopClock = everySecond((d) => {
    const p = fmtPeriod(d);
    timeEl.textContent = fmtHM(d) + (p ? ' ' + p : '');
    dateEl.textContent = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    renderActivities();
    refreshTiles();
  });
  el.classList.add('show');
  document.body.classList.add('qp-open');
  setTimeout(() => panel.querySelector('button')?.focus({ preventScroll: true }), 120);
  // reading the panel marks notifications as read
  setTimeout(() => {
    if (!open) return;
    const list = store.get('notifications') || [];
    if (list.some((n) => !n.read)) store.set('notifications', list.map((n) => ({ ...n, read: true })));
  }, 1500);
}

export function closeQuickPanel() {
  if (!open) return;
  closeEdit(true);
  open = false;
  stopClock?.();
  cancelAnimationFrame(waveRaf);
  el.classList.remove('show');
  document.body.classList.remove('qp-open');
}

export const isQuickPanelOpen = () => open;

// ——— heads-up notifications ———
const shown = new Set();
function headsUp() {
  const list = store.get('notifications') || [];
  // clock alarms/timers get their own full-screen ringing card instead
  const fresh = list.filter((n) => n.time > bootTime - 2000 && !shown.has(n.id) && !n.silent && Date.now() - n.time < 15000 && !(n.app === 'clock' && (n.icon === 'alarm' || n.icon === 'timer')));
  fresh.forEach((n) => shown.add(n.id));
  if (!fresh.length || focusActive() || document.hidden) return;
  const n = fresh[0];
  const host = $('#headsup');
  const card = h('div', { class: 'headsup', role: 'alert', onClick: () => { card.remove(); if (getApp(n.app)) openApp(n.app); } },
    h('span', { class: 'qp-notif-ico' }, notifIcon(n)),
    h('div', { class: 'qp-notif-text' }, h('div', { class: 'qp-notif-title' }, n.title), n.body ? h('div', { class: 'qp-notif-body' }, n.body) : null));
  host.appendChild(card);
  requestAnimationFrame(() => card.classList.add('show'));
  setTimeout(() => {
    card.classList.remove('show');
    setTimeout(() => card.remove(), 400);
  }, 5000);
}

export function initQuickPanel() {
  el = $('#quickpanel');
  build();
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el || e.target.classList.contains('qp-scroll')) closeQuickPanel();
  });
  // scrolling up at the bottom of the panel (or swiping up) closes it; pulling down at the top expands it
  let pull = 0, pullDown = 0;
  el.addEventListener('wheel', (e) => {
    const sc = el.firstElementChild;
    if (e.deltaY < 0 && !expanded && sc.scrollTop <= 0) {
      pullDown += -e.deltaY;
      if (pullDown > 60) {
        pullDown = 0;
        setExpanded(true);
      }
      return;
    }
    pullDown = 0;
    if (e.deltaY > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) {
      pull += e.deltaY;
      if (pull > 160) {
        pull = 0;
        closeQuickPanel();
      }
    } else pull = 0;
  }, { passive: true });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickPanel();
    }
  });
  // Escape in Edit buttons goes back to the panel, wherever the focus is (a button that was clicked may be gone)
  addEventListener('keydown', (e) => {
    if (!editing || !open || e.key !== 'Escape' || document.querySelector('.ou-menu-scrim, .ou-dialog-scrim')) return;
    e.preventDefault();
    e.stopPropagation();
    closeEdit(true);
  }, true);
  // pull down from the very top edge of the screen: the collapsed panel, as the first swipe on One UI
  addEventListener('pointerdown', (e) => {
    if (e.clientY > 12 || open) return;
    const sy = e.clientY;
    const mv = (ev) => {
      if (ev.clientY - sy > 40) {
        off();
        openQuickPanel({ expanded: false });
      }
    };
    const off = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', off);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', off);
  });

  applyFilters();
  store.on('settings', () => {
    applyFilters();
    if (open) refreshTiles();
  });
  store.on('focus', () => open && refreshTiles());
  store.on('qpTiles', () => open && !editing && renderTiles());
  store.on('notifications', () => {
    if (open) renderNotifs();
    headsUp();
  });

  // Focus finished while this tab was open (an open-ended session never finishes by itself)
  setInterval(() => {
    const f = store.get('focus');
    if (f && f.endsAt != null && f.endsAt <= Date.now() && !f.done) {
      // whoever clears the session first (this tab or the SW's 'focus' alarm) logs it; both skip duplicates
      if (f.startedAt) logFocus(f.startedAt, f.endsAt);
      store.set('focus', null);
      if (!globalThis.chrome?.alarms) notify({ app: 'system', title: t('qp.focusDone'), body: t('qp.focusDoneBody', { n: f.minutes }), icon: 'dnd' });
    }
  }, 1000);
}

addStrings({
  en: {
    'qp.title': 'Quick panel',
    'qp.darkMode': 'Dark mode',
    'qp.auto': 'Auto',
    'qp.theme.auto': 'Follow system',
    'qp.theme.light': 'Light',
    'qp.theme.dark': 'Dark',
    'qp.focus': 'Focus',
    'qp.endFocus': 'End Focus',
    'qp.minLeft': '{n} min left',
    'qp.minutes': '{n} minutes',
    'qp.untilOff': 'Until I turn it off',
    'qp.untilOffShort': 'Until turned off',
    'qp.eyeComfort': 'Eye comfort shield',
    'qp.flashlight': 'Flashlight',
    'qp.aod': 'Always On Display',
    'qp.liveWallpaper': 'Live wallpaper',
    'qp.edgePanel': 'Edge panel',
    'qp.blur': 'Blur effects',
    'qp.newTabLinks': 'Open in new tab',
    'qp.lock': 'Lock',
    'qp.brightness': 'Brightness',
    'qp.volume': 'Volume',
    'qp.notifications': 'Notifications',
    'qp.clear': 'Clear',
    'qp.noNotifs': 'No notifications',
    'qp.system': 'System',
    'qp.focusDone': 'Focus session complete',
    'qp.focusDoneBody': 'You stayed focused for {n} minutes. Time for a break.',
    'qp.expand': 'Expand',
    'qp.collapse': 'Collapse',
    'qp.editButtons': 'Edit buttons',
    'qp.reset': 'Reset',
    'qp.available': 'Available buttons',
    'qp.allAdded': 'All buttons are in the panel.',
    'qp.editHint': 'Drag to move, tap − to remove. The first {n} show when the panel is collapsed.',
  },
  ar: {
    'qp.title': 'اللوحة السريعة',
    'qp.darkMode': 'الوضع الداكن',
    'qp.auto': 'تلقائي',
    'qp.theme.auto': 'حسب النظام',
    'qp.theme.light': 'فاتح',
    'qp.theme.dark': 'داكن',
    'qp.focus': 'التركيز',
    'qp.endFocus': 'إنهاء التركيز',
    'qp.minLeft': 'متبقٍ {n} دقيقة',
    'qp.minutes': '{n} دقيقة',
    'qp.untilOff': 'حتى أوقفه',
    'qp.untilOffShort': 'حتى الإيقاف',
    'qp.eyeComfort': 'درع راحة العين',
    'qp.flashlight': 'المصباح',
    'qp.aod': 'العرض الدائم',
    'qp.liveWallpaper': 'خلفية متحركة',
    'qp.edgePanel': 'لوحة الحافة',
    'qp.blur': 'تأثيرات التمويه',
    'qp.newTabLinks': 'فتح في تبويب جديد',
    'qp.lock': 'قفل',
    'qp.brightness': 'السطوع',
    'qp.volume': 'مستوى الصوت',
    'qp.notifications': 'الإشعارات',
    'qp.clear': 'مسح',
    'qp.noNotifs': 'لا توجد إشعارات',
    'qp.system': 'النظام',
    'qp.focusDone': 'اكتملت جلسة التركيز',
    'qp.focusDoneBody': 'بقيت مركزًا لمدة {n} دقيقة. حان وقت الاستراحة.',
    'qp.expand': 'توسيع',
    'qp.collapse': 'طي',
    'qp.editButtons': 'تعديل الأزرار',
    'qp.reset': 'إعادة تعيين',
    'qp.available': 'الأزرار المتاحة',
    'qp.allAdded': 'كل الأزرار موجودة في اللوحة.',
    'qp.editHint': 'اسحب للنقل، واضغط − للإزالة. تظهر أول {n} أزرار عند طي اللوحة.',
  },
});
