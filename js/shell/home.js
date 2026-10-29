// Home screen (One UI): pages of icons + widgets, the dock, folders, drag & drop, and One UI's edit mode (pages
// scaled down with a Main page button and a trash can on each, the bottom bar, the page manager, Undo/Redo). On the
// left of the first page sits the Now Brief page, a column of widgets the person picks (One UI's Samsung Free /
// Google Discover page). Also: app icon badges, links dropped from Chrome, "Lock Home screen layout", the Apps
// screen button, and the one-time placement of new apps (store key `homeAdded`).
import { h, $, $$, uid, clamp, onLongPress, toUrl, siteName, hostname, isExt, debounce } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, tr, isRtl, fmtDate, locale } from '../core/i18n.js';
import { store, setting, setSetting, onSetting, DEFAULT_SETTINGS } from '../core/store.js';
import { getApp, getApps, openApp, registerApp, appName, appIconEl, currentApp, openWindows, onWindowsChange } from '../core/apps.js';
import { getWidget, getWidgets, SIZE_SPAN, configureWidget, homeHidden, setHomeHidden } from '../core/widgets.js';
import { onBadgesChange } from '../core/activity.js';
import { menu, dialog, prompt, toast, swatches, confirm, sw, switchRow } from '../core/ui.js';
import { itemIconEl, itemLabel, openItem, paintBadge, itemBadge } from './appicon.js';

addIcons({
  hmUndo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  hmRedo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>',
  hmPages: '<rect x="3.5" y="4.5" width="7" height="6.5" rx="1.6"/><rect x="13.5" y="4.5" width="7" height="6.5" rx="1.6"/><rect x="3.5" y="14" width="7" height="6.5" rx="1.6"/><path d="M17 14.5v5.5M14.25 17.25h5.5"/>',
  hmHomeFill: '<path d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19Z" fill="currentColor"/>',
  hmBrief: '<path d="M5 6.5h14M5 11.5h14M5 16.5h9"/>',
  hmThemes: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a4.2 4.2 0 0 0 4.2-4.2C21 6.8 17 3.5 12 3.5Z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.8" r="1.2" fill="currentColor"/>',
});

const S = {
  pages: [], // [[item]]
  dock: [],
  left: [], // widgets on the Now Brief page
  page: 0, // -1 = the Now Brief page
  editing: false,
  drag: null,
  layout: [], // per page: { cells: [[id]], pos: Map(id -> {r, c, w, h}) }
};
const els = new Map(); // item id -> tile element
let root, viewport, track, indEl, leftDot, dotsEl, dockEl, searchEl, editBar, editTop, leftEl, lpScroll, lpHead, lpGrid, lpFoot;
let M = {}; // metrics
let leftDrawn = false;
const changeListeners = new Set();
export const onHomeChange = (cb) => (changeListeners.add(cb), () => changeListeners.delete(cb));

// The Home screen's own settings. Their defaults live in DEFAULT_SETTINGS (core/store.js) like every other setting;
// homePref() stays for the modules that read them through it (a stored null still falls back to the default).
export const HOME_DEFAULTS = Object.fromEntries(['homeLocked', 'appsButton', 'addNewApps', 'badges', 'leftPage', 'appsSort', 'homeMainPage'].map((k) => [k, DEFAULT_SETTINGS[k]]));
export const homePref = (k) => setting(k) ?? HOME_DEFAULTS[k];
export const ICON_STYLES = ['default', 'themed', 'dark', 'glass'];

const FOLDER_COLORS = ['', '#3e7bff', '#22b07d', '#ff9f1c', '#ff4d6d', '#9b5de5', '#00b4d8', '#6c757d'];
const DEFAULT_SITES = [
  ['https://www.google.com', 'Google'],
  ['https://www.youtube.com', 'YouTube'],
  ['https://mail.google.com', 'Gmail'],
  ['https://www.wikipedia.org', 'Wikipedia'],
  ['https://github.com', 'GitHub'],
  ['https://www.reddit.com', 'Reddit'],
  ['https://maps.google.com', 'Maps'],
  ['https://news.google.com', 'News'],
  ['https://drive.google.com', 'Drive'],
  ['https://x.com', 'X'],
  ['https://www.linkedin.com', 'LinkedIn'],
  ['https://www.netflix.com', 'Netflix'],
];
// The first-run layout, the way a new Galaxy comes: a Google folder and a Samsung folder on the first page, the
// other apps on the second, a few core apps and the Apps button in the dock, widgets on the Now Brief page.
const GOOGLE_HOSTS = new Set(['google.com', 'youtube.com', 'mail.google.com', 'maps.google.com', 'drive.google.com', 'news.google.com']);
const DOCK_APPS = ['notes', 'calendar', 'reminder', 'store'];
const SAMSUNG_APPS = ['health', 'wallet', 'music', 'games', 'recorder'];
const PAGE2_APPS = ['settings', 'clock', 'calculator', 'weather', 'contacts', 'journal', 'canvas', 'interpreter', 'routines', 'wellbeing'];
const LEFT_STARTER = [['now-brief', 'm'], ['calendar-upcoming', 'm'], ['health-rings', 's'], ['wellbeing', 's'], ['reminder', 'm'], ['notes', 's'], ['games-today', 's']];
// The apps Bloom Tab had before `homeAdded` existed: a layout without that key has seen these and nothing newer.
const ORIGINAL_APPS = ['settings', 'weather', 'clock', 'notes', 'reminder', 'calendar', 'calculator', 'drawer'];

const locked = () => !!homePref('homeLocked');
const leftOn = () => !!homePref('leftPage') || S.editing;
const mainPage = () => clamp(+homePref('homeMainPage') || 0, 0, Math.max(0, S.pages.length - 1));
let lockToastAt = 0;
function lockedToast() {
  if (Date.now() - lockToastAt < 1500) return;
  lockToastAt = Date.now();
  toast(t('home.lockedToast'), { action: t('common.settings'), onAction: () => openApp('settings', { params: { page: 'home' } }) });
}

// ——— model helpers ———
export const spanOf = (item) => (item.type === 'widget' || (item.type === 'placeholder' && item.size) ? SIZE_SPAN[item.size] || [2, 2] : [1, 1]);

function span(item, cols) {
  const [w, hh] = spanOf(item);
  return [Math.min(w, cols), Math.min(hh, M.rows || 4)];
}

/** First-fit packing in item order. Returns positions + items that didn't fit. */
function pack(items, cols, rows) {
  const occ = Array.from({ length: rows }, () => Array(cols).fill(null));
  const pos = new Map();
  const overflow = [];
  for (const it of items) {
    const [w, hh] = span(it, cols);
    let spot = null;
    outer: for (let r = 0; r <= rows - hh; r++) {
      for (let c = 0; c <= cols - w; c++) {
        let free = true;
        for (let y = r; y < r + hh && free; y++) for (let x = c; x < c + w; x++) if (occ[y][x]) { free = false; break; }
        if (free) {
          spot = { r, c, w, h: hh };
          break outer;
        }
      }
    }
    if (!spot) {
      overflow.push(it);
      continue;
    }
    for (let y = spot.r; y < spot.r + hh; y++) for (let x = spot.c; x < spot.c + w; x++) occ[y][x] = it.id;
    pos.set(it.id, spot);
  }
  return { cells: occ, pos, overflow };
}

/** Push overflowing items onto following pages; drop trailing empty pages (keep one). The main page follows its page. */
function normalize(keepEmpty = false) {
  const { cols, rows } = M;
  for (let i = 0; i < S.pages.length; i++) {
    const { overflow } = pack(S.pages[i], cols, rows);
    if (overflow.length) {
      S.pages[i] = S.pages[i].filter((x) => !overflow.includes(x));
      if (!S.pages[i + 1]) S.pages[i + 1] = [];
      S.pages[i + 1].unshift(...overflow);
    }
  }
  if (!keepEmpty) {
    const main = mainPage();
    let next = 0, k = 0;
    S.pages = S.pages.filter((p, i) => {
      const keep = p.length || i === 0;
      if (keep && i === main) next = k;
      if (keep) k++;
      return keep;
    });
    if (next !== main && setting('homeMainPage') != null) setSetting('homeMainPage', next);
  }
  if (!S.pages.length) S.pages = [[]];
  S.page = clamp(S.page, leftOn() ? -1 : 0, S.pages.length - 1);
}

// ——— saving + Undo/Redo ———
// Each change made while editing keeps the layout it replaced (Ctrl+Z / Ctrl+Shift+Z, or the buttons on top);
// leaving edit mode or a change from another tab forgets the history.
const hist = { undo: [], redo: [], saved: null };
const snapshot = () => JSON.stringify({ p: S.pages, d: S.dock, l: S.left, m: mainPage() });
function restore(json) {
  const o = JSON.parse(json);
  S.pages = o.p;
  S.dock = o.d;
  S.left = o.l;
  if (o.m !== mainPage()) setSetting('homeMainPage', o.m);
}

// The store gets copies: this module changes its arrays in place, and the store must be able to tell its own
// write coming back from another tab's change.
// `writing` keeps this page's own listeners from reading the keys half-written (home set, dock not yet) as a change.
let writing = false;
function persist() {
  writing = true;
  try {
    store.set('home', structuredClone(S.pages));
    store.set('dock', structuredClone(S.dock));
    if (JSON.stringify(store.get('homeLeft')) !== JSON.stringify(S.left)) store.set('homeLeft', structuredClone(S.left));
  } finally {
    writing = false;
  }
  changeListeners.forEach((cb) => cb());
}

function save() {
  const snap = snapshot();
  if (S.editing && hist.saved && snap !== hist.saved) {
    hist.undo.push(hist.saved);
    if (hist.undo.length > 60) hist.undo.shift();
    hist.redo.length = 0;
  }
  hist.saved = snap;
  persist();
  syncEditTop();
}

function resetHistory() {
  hist.undo.length = hist.redo.length = 0;
  hist.saved = snapshot();
  syncEditTop();
}

export function undoHome(back = true) {
  const from = back ? hist.undo : hist.redo, to = back ? hist.redo : hist.undo;
  if (!S.editing || !from.length || S.drag) return false;
  to.push(snapshot());
  restore(from.pop());
  hist.saved = snapshot();
  normalize(true);
  render({ animate: true });
  persist();
  syncEditTop();
  if (pm) fillPM();
  return true;
}

export function allItems({ includeFolders = false } = {}) {
  const out = [];
  const walk = (it) => {
    if (it.type === 'folder') {
      if (includeFolders) out.push(it);
      it.items.forEach(walk);
    } else out.push(it);
  };
  S.pages.flat().forEach(walk);
  S.dock.forEach(walk);
  return out;
}

function findItem(id) {
  for (const [pi, p] of S.pages.entries()) {
    for (const [i, it] of p.entries()) {
      if (it.id === id) return { list: p, index: i, page: pi, item: it };
      if (it.type === 'folder') {
        const j = it.items.findIndex((x) => x.id === id);
        if (j >= 0) return { list: it.items, index: j, folder: it, item: it.items[j] };
      }
    }
  }
  for (const [i, it] of S.dock.entries()) {
    if (it.id === id) return { list: S.dock, index: i, dock: true, item: it };
    if (it.type === 'folder') {
      const j = it.items.findIndex((x) => x.id === id);
      if (j >= 0) return { list: it.items, index: j, folder: it, item: it.items[j] };
    }
  }
  for (const [i, it] of S.left.entries()) if (it.id === id) return { list: S.left, index: i, left: true, item: it };
  return null;
}

function removeItem(id) {
  const f = findItem(id);
  if (!f) return null;
  f.list.splice(f.index, 1);
  if (f.folder) collapseFolder(f.folder);
  return f;
}

/** Folders with one item become that item; empty folders disappear. */
function collapseFolder(folder) {
  if (folder.items.length > 1) return;
  const f = findItem(folder.id);
  if (!f) return;
  if (folder.items.length === 1) f.list.splice(f.index, 1, folder.items[0]);
  else f.list.splice(f.index, 1);
}

// ——— public API used by the drawer, edge panel, background, settings, Galaxy Store ———
export function addSite(url, title, { page, webApp = false } = {}) {
  const item = { id: uid(), type: 'site', url, title: title || siteName(url), ...(webApp ? { webApp: true } : {}) };
  placeOnHome(item, page);
  return item;
}

/** Places a ready item (e.g. a folder from the Apps screen) on the first page with room. */
export function addItemToHome(item) {
  const it = { ...item, id: uid() };
  placeOnHome(it);
  return it;
}

export function addAppToHome(appId) {
  const item = { id: uid(), type: 'app', app: appId };
  placeOnHome(item);
  return item;
}

/**
 * Removes every website with this host (pages, folders, the dock), as Galaxy Store's Uninstall does. A folder left
 * with one item becomes that item. Returns an undo function; { toast: true } also shows a toast with Undo.
 */
export function removeSite(host, { toast: withToast = false } = {}) {
  const key = String(host || '').toLowerCase().replace(/^www\./, '');
  return removeWhere((it) => it.type === 'site' && hostname(it.url).toLowerCase() === key, { toast: withToast });
}

/** Removes every item (outside folders or inside them) that matches pred. Returns an undo function. */
export function removeWhere(pred, { toast: withToast = false, name = '' } = {}) {
  const before = structuredClone({ pages: S.pages, dock: S.dock, left: S.left });
  let n = 0, label = name;
  const strip = (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === 'folder') {
        it.items = it.items.filter((x) => (pred(x) ? (n++, (label ||= itemLabel(x)), false) : true));
        if (it.items.length <= 1) list.splice(i, 1, ...it.items);
      } else if (pred(it)) {
        n++;
        label ||= itemLabel(it);
        list.splice(i, 1);
      }
    }
  };
  S.pages.forEach(strip);
  strip(S.dock);
  const undo = () => {
    S.pages = before.pages;
    S.dock = before.dock;
    S.left = before.left;
    normalize();
    render({ animate: true });
    save();
  };
  if (!n) return undo;
  normalize(S.editing);
  render({ animate: true });
  save();
  if (withToast) toast(t('home.removed', { name: label }), { action: t('common.undo'), onAction: undo });
  return undo;
}

/** Adds a widget to the page on screen (the Now Brief page when it is the one shown). A widget with a settings step asks first. */
export async function addWidget(widgetId, size, config = null, { left = S.page === -1 } = {}) {
  const w = getWidget(widgetId);
  if (!w) return null;
  if (!w.sizes.includes(size)) size = w.sizes.includes(w.defaultSize) ? w.defaultSize : w.sizes[0];
  if (config == null && w.configure) {
    config = await configureWidget(w, {}, { size, isNew: true });
    if (!config) return null;
  }
  const item = { id: uid(), type: 'widget', widget: widgetId, size, config: config || {} };
  if (left) {
    S.left.unshift(item);
    if (S.page !== -1) goPage(-1);
    render();
    save();
    lpScroll?.scrollTo({ top: 0 });
    toast(t('home.widgetAdded'));
    return item;
  }
  if (S.page < 0) S.page = 0;
  const page = S.pages[S.page] || (S.pages[S.page] = []);
  // insert at the first position on this page where it fits without pushing anything off
  let at = 0;
  for (let i = 0; i <= page.length; i++) {
    const trial = [...page.slice(0, i), item, ...page.slice(i)];
    if (!pack(trial, M.cols, M.rows).overflow.length) {
      at = i;
      break;
    }
  }
  page.splice(at, 0, item);
  normalize(S.editing);
  render();
  save();
  toast(t('home.widgetAdded'));
  return item;
}

function placeOnHome(item, prefer) {
  // the preferred page (where a link was dropped) if it has room, else the first page with room, else a new page
  const order = [...S.pages.keys()];
  if (prefer != null && S.pages[prefer]) order.unshift(...order.splice(prefer, 1));
  for (const i of order) {
    if (!pack([...S.pages[i], item], M.cols, M.rows).overflow.length) {
      S.pages[i].push(item);
      render();
      save();
      return goPage(i);
    }
  }
  S.pages.push([item]);
  render();
  save();
  goPage(S.pages.length - 1);
}

export const isOnHome = (pred) => allItems().some(pred);

// ——— metrics ———
function measure() {
  const s = store.get('settings');
  const cols = clamp(s.gridCols, 4, 8);
  const rows = clamp(s.gridRows, 3, 6);
  const searchH = s.searchBar === 'hidden' ? 0 : 66;
  const dockH = clamp(s.iconSize, 48, 80) + 34;
  const availH = innerHeight - 44 - searchH - 30 - dockH - 36;
  const availW = Math.min(innerWidth - 120, cols * 176);
  let cellH = clamp(Math.floor(availH / rows), 70, 170);
  let cellW = clamp(Math.floor(availW / cols), 72, 176);
  // One UI's cells are close to square. In a short window (a laptop's Chrome is ~650px tall) wide cells turned a
  // 2×2 widget into a strip and round faces (clock, rings) spilled out; a tall window did the opposite.
  cellW = Math.max(72, Math.min(cellW, Math.round(cellH * 1.2)));
  cellH = Math.max(70, Math.min(cellH, Math.round(cellW * 1.2)));
  const labels = s.showLabels ? 26 : 0;
  const iconSz = Math.min(clamp(s.iconSize, 40, 84), cellH - labels - 10, cellW - 20);
  M = { cols, rows, cellW, cellH, icon: iconSz, labels: s.showLabels };
  root.style.setProperty('--cols', cols);
  root.style.setProperty('--rows', rows);
  root.style.setProperty('--cell-w', cellW + 'px');
  root.style.setProperty('--cell-h', cellH + 'px');
  root.style.setProperty('--icon', M.icon + 'px');
  root.style.setProperty('--dock-icon', clamp(s.iconSize, 48, 72) + 'px');
  // the Now Brief page is a phone-wide column of widgets four cells across
  root.style.setProperty('--lp-cell', Math.floor(clamp(innerWidth - 40, 280, 540) / 4) + 'px');
  root.classList.toggle('no-labels', !s.showLabels);
  root.dataset.search = s.searchBar;
  document.body.dataset.iconStyle = ICON_STYLES.includes(s.iconStyle) ? s.iconStyle : 'default';
  document.body.dataset.dockBg = s.dockBackground ? 'on' : 'off';
}

// ——— rendering ———
function tileFor(item) {
  const sig = JSON.stringify(item) + '|' + setting('iconStyle');
  let el = els.get(item.id);
  if (!el || el._sig !== sig) {
    el?._cleanup?.();
    el = buildTile(item);
    el._sig = sig;
    els.set(item.id, el);
  }
  el._item = item;
  return el;
}

function buildTile(item) {
  if (item.type === 'placeholder') {
    return h('div', { class: ['tile', 'placeholder', item.size && 'is-widget', item.size && `ws-${item.size}`], dataset: { id: item.id } }, h('span', { class: 'ph-box' }));
  }
  if (item.type === 'widget') return buildWidgetTile(item);
  const el = h('div', { class: ['tile', `t-${item.type}`], dataset: { id: item.id }, tabindex: 0, role: 'button', 'aria-label': itemLabel(item) },
    h('span', { class: 'tile-icon' }, itemIconEl(item)),
    h('span', { class: 'tile-label' }, itemLabel(item)));
  el.addEventListener('click', (e) => {
    if (S.drag || el._suppressClick) return;
    if (item.type === 'folder') return openFolder(item, el);
    if (S.editing) return;
    openItem(item, el.querySelector('.app-icon'), e);
  });
  el.addEventListener('auxclick', (e) => {
    if (e.button === 1 && item.type === 'site') openItem(item, el, e);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.click();
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      itemMenu(item, el);
    }
  });
  bindPointer(el, item);
  return el;
}

function buildWidgetTile(item) {
  const w = getWidget(item.widget);
  const box = h('div', { class: ['wg', `w-${item.size}`] });
  const el = h('div', { class: ['tile', 'widget-tile', `ws-${item.size}`], dataset: { id: item.id } }, box);
  if (!w) {
    box.classList.add('wg-missing');
    box.append(h('span', null, t('home.widgetMissing')));
  } else {
    try {
      el._cleanup = w.render(box, {
        size: item.size,
        item,
        config: item.config || {},
        setConfig: (cfg) => {
          const f = findItem(item.id);
          if (!f) return;
          f.item.config = { ...(f.item.config || {}), ...cfg };
          save();
        },
      });
    } catch (e) {
      console.error('widget', item.widget, e);
      box.textContent = String(e.message || e);
    }
    box.setAttribute('aria-label', tr(w.name));
  }
  el.addEventListener('click', (e) => {
    if (S.drag || S.editing || el._suppressClick) return;
    if (e.target.closest('button, input, textarea, select, a, [data-noopen]')) return;
    if (w?.onClick) w.onClick(item, el, e);
    else if (w?.app) openApp(w.app, { from: el });
  });
  bindPointer(el, item);
  return el;
}

const pageEls = () => [...track.children].filter((c) => c.classList.contains('page') && !c.classList.contains('add-page'));

export function render({ animate = false } = {}) {
  if (!root) return;
  const before = animate ? snapshotRects() : null;
  const view = S.drag ? withPlaceholder() : { pages: S.pages, dock: S.dock, left: S.left };
  const keep = new Set();

  // pages
  // the edit-mode "Add page" page is rebuilt below; drop it first so a new page never reuses its element
  track.querySelector(':scope > .add-page')?.remove();
  const pels = pageEls();
  while (pels.length > view.pages.length) pels.pop().remove();
  S.layout = [];
  view.pages.forEach((items, pi) => {
    let page = pels[pi];
    if (!page) {
      page = h('section', { class: 'page', dataset: { i: pi } }, h('div', { class: 'page-grid' }));
      track.appendChild(page);
    }
    const grid = page.firstElementChild;
    const lay = pack(items, M.cols, M.rows);
    S.layout[pi] = lay;
    const nodes = [];
    for (const it of items) {
      const p = lay.pos.get(it.id);
      if (!p) continue;
      const el = tileFor(it);
      el.style.gridArea = `${p.r + 1} / ${p.c + 1} / span ${p.h} / span ${p.w}`;
      nodes.push(el);
      keep.add(it.id);
    }
    syncChildren(grid, nodes);
    page.classList.toggle('empty', !items.length);
    pageTools(page, pi);
  });
  if (S.editing && !S.drag) {
    const add = h('section', { class: 'page add-page' }, h('button', { class: 'add-page-btn', 'aria-label': t('home.addPage'), html: icon('plus', 40), onClick: () => {
      S.pages.push([]);
      render();
      save();
      goPage(S.pages.length - 1);
    } }));
    track.appendChild(add);
  }

  // dock
  const dockNodes = view.dock.map((it) => {
    keep.add(it.id);
    return tileFor(it);
  });
  syncChildren(dockEl.firstElementChild, dockNodes);
  dockEl.classList.toggle('empty', !view.dock.length);

  renderLeft(view.left, keep);

  for (const [id, el] of els) {
    if (!keep.has(id) && !(S.drag && id === S.drag.item.id)) {
      el._cleanup?.();
      el.remove();
      els.delete(id);
    }
  }
  renderDots();
  goPage(S.page, true);
  paintBadges();
  if (before) flip(before);
}

function syncChildren(parent, nodes) {
  nodes.forEach((n, i) => {
    if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] || null);
  });
  while (parent.children.length > nodes.length) parent.lastElementChild.remove();
}

/** One UI's edit mode puts a Main page button on top of every page and a trash can to remove it. */
function pageTools(page, pi) {
  let tools = page.querySelector(':scope > .page-tools');
  if (!S.editing || S.drag) return tools?.remove();
  if (!tools) {
    tools = h('div', { class: 'page-tools' });
    page.appendChild(tools);
  }
  const main = pi === mainPage();
  // (replaceChildren would write a null out as the text "null")
  tools.replaceChildren(...[
    h('button', { class: ['pt-btn', 'pt-home', main && 'on'], 'aria-pressed': String(main), title: t('home.mainPage'), 'aria-label': t('home.mainPage'), html: icon(main ? 'hmHomeFill' : 'home', 22), onClick: () => setMainPage(pi) }),
    !locked() && S.pages.length > 1 ? h('button', { class: 'pt-btn pt-del', title: t('home.removePage'), 'aria-label': t('home.removePage'), html: icon('trash', 20), onClick: () => removePage(pi) }) : null].filter(Boolean));
}

export function setMainPage(i) {
  if (i < 0 || i >= S.pages.length || i === mainPage()) return;
  setSetting('homeMainPage', i);
  render();
  save();
  toast(t('home.mainPageSet'));
}

export async function removePage(i) {
  if (locked()) return lockedToast();
  if (!S.pages[i] || S.pages.length < 2) return;
  if (S.pages[i].length && !(await confirm(t('home.removePageQ'), t('home.removePageMsg'), { okLabel: t('common.remove'), danger: true }))) return;
  const main = mainPage();
  S.pages.splice(i, 1);
  if (main >= i && main > 0) setSetting('homeMainPage', main === i ? 0 : main - 1);
  if (S.page > i || S.page >= S.pages.length) S.page = Math.max(0, S.page - 1);
  render({ animate: true });
  save();
  if (pm) fillPM();
}

function snapshotRects() {
  const m = new Map();
  for (const [id, el] of els) if (el.isConnected) m.set(id, el.getBoundingClientRect());
  return m;
}

function flip(before) {
  for (const [id, el] of els) {
    const a = before.get(id);
    if (!a || !el.isConnected || el.classList.contains('placeholder')) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if ((!dx && !dy) || Math.abs(dx) > innerWidth * 0.7) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,.25,0,1)' });
  }
}

function renderDots() {
  const n = S.pages.length + (S.editing && !S.drag ? 1 : 0);
  dotsEl.replaceChildren(
    ...Array.from({ length: n }, (_, i) =>
      h('button', { class: ['dot', i === S.page && 'active', i === S.pages.length && 'plus'], 'aria-label': t('home.page', { n: i + 1 }), onClick: () => (S.editing && i < S.pages.length && i === S.page ? openPageManager() : goPage(i)) }))
  );
  dotsEl.hidden = n < 2 && !leftOn();
  leftDot.hidden = !leftOn();
  indEl.hidden = dotsEl.hidden;
}

export function goPage(i, instant = false) {
  const max = S.pages.length - 1 + (S.editing && !S.drag ? 1 : 0);
  S.page = clamp(i, leftOn() ? -1 : 0, Math.max(0, max));
  if (S.page === -1) ensureLeft();
  track.style.transition = instant ? 'none' : '';
  track.style.transform = `translateX(${(isRtl() ? 1 : -1) * S.page * 100}%)`;
  $$('.dot', dotsEl).forEach((d, k) => d.classList.toggle('active', k === S.page));
  leftDot.classList.toggle('active', S.page === -1);
  $$('.page', track).forEach((p, k) => p.toggleAttribute('inert', k !== S.page));
  leftEl.toggleAttribute('inert', S.page !== -1);
  root.classList.toggle('on-left', S.page === -1);
}

export const currentPage = () => S.page;

// ——— the Now Brief page (left of the first page) ———
function ensureLeft() {
  if (leftDrawn) return;
  leftDrawn = true;
  renderLeft(S.left, null);
}

function renderLeft(items, keep) {
  const on = !!homePref('leftPage');
  leftEl.hidden = !leftOn();
  leftEl.classList.toggle('off', !on);
  if (!leftDrawn) return;
  lpHead.replaceChildren(...[
    S.editing
      ? h('label', { class: 'lp-switch' }, h('span', { class: 'lp-switch-text' }, h('b', null, t('brief.name')), h('small', null, t('home.leftSub'))), sw(on, (v) => setSetting('leftPage', v), { label: t('brief.name') }))
      : null,
    h('div', { class: 'lp-title' }, h('h1', null, t('brief.name')), h('span', null, fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })))].filter(Boolean));
  const nodes = on ? items.map((it) => {
    const el = tileFor(it);
    el.style.gridArea = '';
    keep?.add(it.id);
    return el;
  }) : [];
  syncChildren(lpGrid, nodes);
  lpFoot.replaceChildren(...[
    on && !items.length ? h('div', { class: 'lp-empty' }, t('home.leftEmpty')) : null,
    on ? h('button', { class: 'lp-btn', onClick: () => (S.editing ? openWidgetPicker({ left: true }) : setEditing(true)) },
      h('span', { html: icon(S.editing ? 'plus' : 'edit', 18) }), S.editing ? t('home.addWidget') : t('common.edit')) : h('div', { class: 'lp-empty' }, t('home.leftOff'))].filter(Boolean));
}

// ——— pointer: click / long-press / drag / page swipe ———
function bindPointer(el, item) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!S.drag) itemMenu(item, el, e);
  });
  let start = null, lp = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || S.drag) return;
    if (item.type === 'widget' && e.target.closest('button, input, textarea, select, a, [data-noopen]')) return;
    e.stopPropagation();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    el._suppressClick = false;
    clearTimeout(lp);
    lp = setTimeout(() => {
      if (!start) return;
      // long press without moving: One UI pops the item menu; moving afterwards starts a drag
      el._suppressClick = true;
      start.menuOpen = true;
      itemMenu(item, el);
    }, 520);
    const move = (ev) => {
      if (!start || ev.pointerId !== start.id) return;
      const d = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (d > 7) {
        const menuOpen = start.menuOpen;
        clearTimeout(lp);
        cleanup();
        // a locked layout keeps every item where it is
        if (locked()) return lockedToast();
        if (menuOpen) document.querySelector('.ou-menu-scrim')?._close?.();
        el._suppressClick = true;
        startDrag(findItem(item.id)?.item || item, el, ev);
      }
    };
    const up = () => {
      clearTimeout(lp);
      cleanup();
    };
    const cleanup = () => {
      start = null;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

function startDrag(item, el, e, { external = false } = {}) {
  const origin = external ? null : removeItemSnapshot(item.id);
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.gridArea = '';
  document.body.appendChild(ghost);
  const start = S.page < 0 ? 0 : S.page;
  S.drag = {
    item,
    origin,
    ghost,
    off: { x: e.clientX - r.left, y: e.clientY - r.top },
    target: origin ? (origin.left ? { zone: 'left', index: origin.index } : { zone: origin.dock ? 'dock' : 'page', page: origin.page, index: origin.index }) : { zone: 'page', page: start, index: S.pages[start]?.length || 0 },
    folderTarget: null,
    snapshot: origin?.snapshot,
  };
  if (origin?.folder) S.drag.target = { zone: 'page', page: start, index: S.pages[start].length };
  document.body.classList.add('home-dragging');
  moveGhost(e);
  render();
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', onDragEnd, { once: true });
  addEventListener('keydown', onDragKey, true);
}

/** Lets other surfaces (Apps screen, Edge panel) drop a new item onto the Home screen. */
export function startExternalDrag(item, e, fromEl) {
  const ghostSrc = fromEl || h('div', { class: 'tile' }, h('span', { class: 'tile-icon' }, itemIconEl(item)), h('span', { class: 'tile-label' }, itemLabel(item)));
  if (!fromEl) {
    ghostSrc.style.cssText = `position:fixed;left:${e.clientX - 40}px;top:${e.clientY - 40}px;width:${M.cellW}px;height:${M.cellH}px`;
    root.appendChild(ghostSrc);
  }
  if (S.page < 0) goPage(0, true);
  startDrag(item, ghostSrc, e, { external: true });
  if (!fromEl) ghostSrc.remove();
}

function removeItemSnapshot(id) {
  const snapshot = structuredClone({ pages: S.pages, dock: S.dock, left: S.left });
  const f = findItem(id);
  if (!f) return null;
  f.list.splice(f.index, 1);
  if (f.folder) collapseFolder(f.folder);
  return { page: f.page ?? Math.max(0, S.page), index: f.index, dock: !!f.dock, left: !!f.left, folder: f.folder, snapshot };
}

function withPlaceholder() {
  const d = S.drag;
  const ph = { id: '__ph', type: 'placeholder', size: d.item.type === 'widget' ? d.item.size : null };
  const pages = S.pages.map((p) => [...p]);
  const dock = [...S.dock];
  const left = [...S.left];
  if (d.folderTarget) return { pages, dock, left };
  if (d.target.zone === 'dock') dock.splice(clamp(d.target.index, 0, dock.length), 0, ph);
  else if (d.target.zone === 'left') left.splice(clamp(d.target.index, 0, left.length), 0, ph);
  else {
    while (pages.length <= d.target.page) pages.push([]);
    pages[d.target.page].splice(clamp(d.target.index, 0, pages[d.target.page].length), 0, ph);
  }
  return { pages, dock, left };
}

function moveGhost(e) {
  const g = S.drag.ghost;
  g.style.transform = `translate(${e.clientX - S.drag.off.x}px, ${e.clientY - S.drag.off.y}px) scale(1.08)`;
}

let edgeTimer = null, folderTimer = null;

function onDragMove(e) {
  const d = S.drag;
  if (!d) return;
  moveGhost(e);
  const prev = JSON.stringify([d.target, d.folderTarget?.id]);
  const isWidget = d.item.type === 'widget';

  // page flip at the screen edges (only widgets go onto the Now Brief page)
  const edge = e.clientX < 56 ? -1 : e.clientX > innerWidth - 56 ? 1 : 0;
  const dir = isRtl() ? -edge : edge;
  if (dir && !edgeTimer) {
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      const next = S.page + dir;
      if (next < -1 || (next === -1 && !(isWidget && homePref('leftPage')))) return;
      if (next >= S.pages.length) S.pages.push([]);
      goPage(next);
      d.target = next === -1 ? { zone: 'left', index: 0 } : { zone: 'page', page: next, index: S.pages[next].length };
      render();
    }, 600);
  } else if (!dir) {
    clearTimeout(edgeTimer);
    edgeTimer = null;
  }

  if (S.page === -1) {
    // the Now Brief page: a column of widgets, ordered by where the pointer is
    handleFolderHover(null);
    if (!isWidget) return;
    let index = 0;
    for (const tile of $$(':scope > .tile:not(.placeholder)', lpGrid)) {
      const r = tile.getBoundingClientRect();
      if (e.clientY > r.bottom || (e.clientY >= r.top && (isRtl() ? e.clientX < r.left + r.width / 2 : e.clientX > r.left + r.width / 2))) index++;
    }
    proposeTarget({ zone: 'left', index });
    if (JSON.stringify([d.target, d.folderTarget?.id]) !== prev) render({ animate: true });
    return;
  }

  const dockRect = dockEl.getBoundingClientRect();
  if (!isWidget && e.clientY > dockRect.top - 10 && e.clientY < dockRect.bottom + 10 && e.clientX > dockRect.left - 40 && e.clientX < dockRect.right + 40) {
    const tiles = $$('.tile:not(.drag-ghost)', dockEl);
    let index = 0;
    const realTiles = tiles.filter((x) => !x.classList.contains('placeholder'));
    realTiles.forEach((tile, i) => {
      const r = tile.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (isRtl() ? e.clientX < mid : e.clientX > mid) index = i + 1;
    });
    const over = realTiles.find((tile) => {
      const r = tile.querySelector('.app-icon')?.getBoundingClientRect();
      return r && e.clientX > r.left + r.width * 0.2 && e.clientX < r.right - r.width * 0.2 && e.clientY > r.top + r.height * 0.2 && e.clientY < r.bottom - r.height * 0.2;
    });
    handleFolderHover(over);
    if (!over && S.dock.length < 7) proposeTarget({ zone: 'dock', index });
  } else {
    const page = pageEls()[S.page];
    const grid = page?.firstElementChild;
    if (!grid) return;
    const gr = grid.getBoundingClientRect();
    const [w] = span(d.item, M.cols);
    let cx = Math.floor(((isRtl() ? gr.right - e.clientX : e.clientX - gr.left) - (w > 1 ? (w - 1) * M.cellW * 0.5 : 0)) / M.cellW);
    let cy = Math.floor((e.clientY - gr.top - (isWidget ? (spanOf(d.item)[1] - 1) * M.cellH * 0.5 : 0)) / M.cellH);
    cx = clamp(cx, 0, M.cols - 1);
    cy = clamp(cy, 0, M.rows - 1);
    const items = S.pages[S.page] || [];
    // hit-test against what is on screen (includes the placeholder)
    const lay = S.layout[S.page] || pack(items, M.cols, M.rows);
    const occupant = lay.cells[cy]?.[cx];
    if (occupant === '__ph') {
      handleFolderHover(null);
      clearTimeout(proposeTimer);
      proposed = null;
      return;
    }
    const occItem = occupant ? items.find((x) => x.id === occupant) : null;

    // hovering the middle of another icon -> make / join a folder
    let overIcon = null;
    if (occItem && !isWidget && occItem.type !== 'widget' && d.item.type !== 'folder') {
      const tile = els.get(occItem.id);
      const r = tile?.querySelector('.app-icon')?.getBoundingClientRect();
      if (r && e.clientX > r.left + r.width * 0.12 && e.clientX < r.right - r.width * 0.12 && e.clientY > r.top + r.height * 0.12 && e.clientY < r.bottom - r.height * 0.12) overIcon = tile;
    }
    handleFolderHover(overIcon);
    if (overIcon) {
      clearTimeout(proposeTimer);
      proposed = null;
    } else {
      let index;
      if (occItem) {
        index = items.indexOf(occItem);
        const p = lay.pos.get(occItem.id);
        const mid = gr.left + (p.c + p.w / 2) * M.cellW;
        if (!isRtl() ? e.clientX > mid : e.clientX < gr.right - (p.c + p.w / 2) * M.cellW) index++;
      } else {
        // empty cell: count items that sit before this cell in reading order
        index = items.filter((x) => {
          const p = lay.pos.get(x.id);
          return p && (p.r < cy || (p.r === cy && p.c < cx));
        }).length;
      }
      proposeTarget({ zone: 'page', page: S.page, index });
    }
  }
  if (JSON.stringify([d.target, d.folderTarget?.id]) !== prev) render({ animate: true });
}

/** Icons only make room once the pointer rests for a moment, so you can reach a folder target. */
let proposeTimer = null, proposed = null;
function proposeTarget(target) {
  const key = JSON.stringify(target);
  if (key === JSON.stringify(S.drag.target)) {
    clearTimeout(proposeTimer);
    proposed = null;
    return;
  }
  if (key === proposed) return;
  proposed = key;
  clearTimeout(proposeTimer);
  proposeTimer = setTimeout(() => {
    proposed = null;
    if (!S.drag || S.drag.folderTarget) return;
    S.drag.target = target;
    render({ animate: true });
  }, 260);
}

function handleFolderHover(tile) {
  const d = S.drag;
  const id = tile?.dataset.id || null;
  if (id === (d.pendingFolder || null)) return;
  clearTimeout(folderTimer);
  $$('.tile.folder-hover').forEach((x) => x.classList.remove('folder-hover'));
  d.pendingFolder = id;
  if (!id) {
    if (d.folderTarget) {
      d.folderTarget = null;
      render({ animate: true });
    }
    return;
  }
  folderTimer = setTimeout(() => {
    if (!S.drag || S.drag.pendingFolder !== id) return;
    d.folderTarget = findItem(id)?.item || null;
    tile.classList.add('folder-hover');
    render({ animate: true });
    tile.classList.add('folder-hover');
  }, 380);
}

function onDragEnd() {
  const d = S.drag;
  if (!d) return;
  clearTimeout(proposeTimer);
  if (proposed && !d.folderTarget) d.target = JSON.parse(proposed);
  proposed = null;
  removeEventListener('pointermove', onDragMove);
  removeEventListener('keydown', onDragKey, true);
  clearTimeout(edgeTimer);
  clearTimeout(folderTimer);
  edgeTimer = folderTimer = null;
  $$('.tile.folder-hover').forEach((x) => x.classList.remove('folder-hover'));

  if (d.folderTarget) {
    const ft = findItem(d.folderTarget.id);
    if (ft) {
      if (ft.item.type === 'folder') ft.item.items.push(d.item);
      else ft.list.splice(ft.index, 1, { id: uid(), type: 'folder', title: t('home.folder'), color: '', items: [ft.item, d.item] });
    }
  } else if (d.target.zone === 'dock') {
    S.dock.splice(clamp(d.target.index, 0, S.dock.length), 0, d.item);
  } else if (d.target.zone === 'left' && d.item.type === 'widget') {
    S.left.splice(clamp(d.target.index, 0, S.left.length), 0, d.item);
  } else {
    const pi = d.target.zone === 'left' ? 0 : d.target.page;
    while (S.pages.length <= pi) S.pages.push([]);
    const p = S.pages[pi];
    p.splice(clamp(d.target.index, 0, p.length), 0, d.item);
  }
  // land the ghost where the item ends up
  const ghost = d.ghost;
  S.drag = null;
  document.body.classList.remove('home-dragging');
  normalize(S.editing);
  render({ animate: true });
  const dest = els.get(d.item.id);
  if (dest && dest.isConnected) {
    const r = dest.getBoundingClientRect();
    dest.style.opacity = '0';
    ghost.style.transition = 'transform 220ms cubic-bezier(.22,.25,0,1)';
    ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
    setTimeout(() => {
      ghost.remove();
      dest.style.opacity = '';
    }, 230);
  } else ghost.remove();
  save();
}

function onDragKey(e) {
  if (e.key !== 'Escape' || !S.drag) return;
  clearTimeout(proposeTimer);
  proposed = null;
  e.preventDefault();
  e.stopPropagation();
  const d = S.drag;
  removeEventListener('pointermove', onDragMove);
  removeEventListener('pointerup', onDragEnd);
  removeEventListener('keydown', onDragKey, true);
  d.ghost.remove();
  S.drag = null;
  document.body.classList.remove('home-dragging');
  if (d.snapshot) {
    S.pages = d.snapshot.pages;
    S.dock = d.snapshot.dock;
    S.left = d.snapshot.left;
  }
  render();
}

// ——— swipes on empty space, wheel gestures, pinch ———
function bindGestures() {
  let sw = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.tile, button, input, label')) return;
    sw = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.moved && Math.hypot(dx, dy) > 8) sw.moved = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (sw.moved === 'x') {
      const toLeft = isRtl() ? dx < 0 : dx > 0;
      if (toLeft && S.page === 0) ensureLeft();
      track.style.transition = 'none';
      const base = (isRtl() ? 1 : -1) * S.page * viewport.clientWidth;
      const atEdge = (S.page === (leftOn() ? -1 : 0) && toLeft) || (S.page === S.pages.length - 1 && !toLeft && !S.editing);
      track.style.transform = `translateX(${base + dx * (atEdge ? 0.3 : 1)}px)`;
    }
  });
  const end = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    const fast = performance.now() - sw.t < 300;
    track.style.transition = '';
    if (sw.moved === 'x') {
      const dir = (dx < 0 ? 1 : -1) * (isRtl() ? -1 : 1);
      if (Math.abs(dx) > viewport.clientWidth * 0.18 || (fast && Math.abs(dx) > 40)) goPage(S.page + dir);
      else goPage(S.page);
    } else if (sw.moved === 'y') {
      // (the Now Brief page scrolls instead)
      if (S.page !== -1 && dy < -60) import('./drawer.js').then((m) => m.openDrawer());
      else if (S.page !== -1 && dy > 60) import('./quickpanel.js').then((m) => m.openQuickPanel({ expanded: false }));
    } else if (S.editing && !e.target.closest('.page-grid > *, .lp-grid > *, .page-tools, .lp-head, .lp-foot')) {
      setEditing(false);
    }
    sw = null;
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  onLongPress(viewport, (e) => {
    if (e.target.closest('.tile, button, label') || S.drag) return;
    sw = null;
    setEditing(true);
  }, 600);

  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tile') || e.target.closest('.home-search')) return;
    e.preventDefault();
    homeMenu(e);
  });

  // wheel: horizontal = pages, down = Apps screen, up = Quick panel; pinch (Ctrl+wheel) = edit mode
  let acc = 0, accY = 0, accZ = 0, lock = 0;
  root.addEventListener('wheel', (e) => {
    if (S.drag || e.target.closest('.wg [data-scroll], .wg .scroll')) return;
    if (e.ctrlKey) {
      // a trackpad pinch: pinching in opens edit mode, as on One UI; spreading the fingers leaves it
      e.preventDefault();
      accZ += e.deltaY;
      if (performance.now() >= lock && Math.abs(accZ) > 40) {
        if (accZ > 0 && !S.editing) setEditing(true);
        else if (accZ < 0 && S.editing) setEditing(false);
        accZ = 0;
        lock = performance.now() + 500;
      }
      clearTimeout(root._zt);
      root._zt = setTimeout(() => (accZ = 0), 250);
      return;
    }
    // the Now Brief page scrolls up and down by itself
    if (S.page === -1 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return;
    e.preventDefault();
    if (performance.now() < lock) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      acc += e.deltaX;
      accY = 0;
      if (Math.abs(acc) > 60) {
        goPage(S.page + Math.sign(acc) * (isRtl() ? -1 : 1));
        acc = 0;
        lock = performance.now() + 450;
      }
    } else {
      accY += e.deltaY;
      acc = 0;
      if (accY > 80) {
        import('./drawer.js').then((m) => m.openDrawer());
        accY = 0;
        lock = performance.now() + 600;
      } else if (accY < -80) {
        import('./quickpanel.js').then((m) => m.openQuickPanel({ expanded: false }));
        accY = 0;
        lock = performance.now() + 600;
      }
    }
    clearTimeout(root._wt);
    root._wt = setTimeout(() => (acc = accY = 0), 220);
  }, { passive: false });
}

// Keys the Home screen handles before the shell's (keys.js skips events that were handled): Undo/Redo while
// editing, and the arrows on the Now Brief page (it has no page dot, so keys.js can't count from it).
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
function bindKeys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || document.body.classList.contains('locked')) return;
    if (typing(e) || document.querySelector('.ou-dialog-scrim, .ou-menu-scrim, .folder-scrim, .aod, #recents') || currentApp()) return;
    if (['drawer-open', 'finder-open', 'qp-open'].some((c) => document.body.classList.contains(c))) return;
    const k = e.key.toLowerCase();
    if (S.editing && (e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      undoHome(!(e.shiftKey || k === 'y'));
      return;
    }
    if (pm) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePageManager();
      }
      return;
    }
    if (S.page !== -1 || S.drag || e.ctrlKey || e.metaKey || e.altKey) return;
    const fwd = isRtl() ? 'ArrowLeft' : 'ArrowRight', back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd || (e.key === 'Escape' && !S.editing)) {
      e.preventDefault();
      goPage(0);
    } else if (e.key === back) e.preventDefault();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      lpScroll.scrollBy({ top: e.key === 'ArrowUp' ? -90 : 90 });
    }
  }, true);
}

// A link, tab or bookmark dragged in from Chrome becomes a website on the page you're on, named after the link's text.
function bindLinkDrop() {
  const isLink = (e) => [...(e.dataTransfer?.types || [])].some((x) => x === 'text/uri-list' || x === 'text/x-moz-url');
  const blocked = () => document.body.classList.contains('locked');
  let depth = 0;
  const off = () => {
    depth = 0;
    root.classList.remove('link-drop');
  };
  root.addEventListener('dragenter', (e) => {
    if (!isLink(e) || blocked()) return;
    depth++;
    root.classList.add('link-drop');
  });
  root.addEventListener('dragover', (e) => {
    if (!isLink(e) || blocked()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('dragleave', (e) => {
    if (isLink(e) && --depth <= 0) off();
  });
  root.addEventListener('drop', (e) => {
    if (!isLink(e) || blocked()) return;
    e.preventDefault();
    off();
    const dt = e.dataTransfer;
    const raw = (dt.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || dt.getData('text/plain');
    const url = toUrl((raw || '').trim());
    if (!url || !/^https?:\/\//i.test(url)) return;
    let name = '';
    try {
      name = new DOMParser().parseFromString(dt.getData('text/html') || '', 'text/html').querySelector('a')?.textContent.trim() || '';
    } catch {}
    if (!name || /^https?:\/\//i.test(name) || name.length > 40) name = '';
    const item = addSite(url, name || siteName(url), { page: Math.max(0, S.page) });
    toast(t('home.linkAdded', { name: item.title }));
  });
  addEventListener('dragend', off);
}

// ——— menus ———
function itemMenu(item, el, e) {
  const at = e && 'clientX' in e ? e : el;
  const fixed = locked();
  const common = [];
  if (item.type === 'widget') {
    const w = getWidget(item.widget);
    const sizes = fixed ? [] : (w?.sizes || []).map((sz) => ({
      label: t('home.size.' + sz),
      icon: 'widgets',
      checked: sz === item.size,
      onClick: () => {
        const f = findItem(item.id);
        if (!f) return;
        f.item.size = sz;
        normalize(S.editing);
        render({ animate: true });
        save();
      },
    }));
    return menu(at, [
      ...(sizes.length > 1 ? sizes : []),
      sizes.length > 1 ? '-' : null,
      w?.configure ? { label: t('home.widgetSettings'), icon: 'settings', onClick: () => configureItem(item) } : null,
      w?.app ? { label: t('common.open'), icon: 'external', onClick: () => openApp(w.app, { from: el }) } : null,
      fixed ? null : { label: t('common.remove'), icon: 'trash', danger: true, onClick: () => removeWithUndo(item) },
    ]);
  }
  if (item.type === 'site') {
    common.push(
      { label: t('common.openNewTab'), icon: 'tab', onClick: () => openItem(item, el, { ctrlKey: false, shiftKey: true }) },
      { label: t('common.edit'), icon: 'edit', onClick: () => editSite(item) },
      // a window of its own without tabs (js/anytab/webapp.js), as set in the Add to Home screen sheet
      { label: t('home.webApp'), icon: 'layout', checked: !!item.webApp, onClick: () => setWebApp(item.id, !item.webApp) }
    );
  }
  if (item.type === 'app') common.push({ label: t('common.open'), icon: 'external', onClick: () => openItem(item, el) });
  if (item.type === 'folder') {
    common.push(
      { label: t('common.rename'), icon: 'edit', onClick: () => renameFolder(item) },
      { label: t('home.folderColor'), icon: 'palette', onClick: () => folderColor(item) },
      fixed ? null : { label: t('home.ungroup'), icon: 'apps', onClick: () => ungroup(item) }
    );
  }
  if (item.type !== 'folder') {
    common.push({
      label: t('home.addToEdge'),
      icon: 'edge',
      onClick: () => import('./edge.js').then((m) => m.addToEdge({ ...item, id: uid() })),
    });
  }
  menu(at, [...common, ...(fixed ? [] : ['-', { label: t('common.remove'), icon: 'trash', danger: true, onClick: () => removeWithUndo(item) }])]);
}

async function configureItem(item) {
  const f = findItem(item.id);
  const w = getWidget(item.widget);
  if (!f || !w) return;
  const next = await configureWidget(w, f.item.config, { size: f.item.size, item: f.item, isNew: false });
  const cur = findItem(item.id);
  if (!next || !cur) return;
  cur.item.config = next;
  render();
  save();
}

function removeWithUndo(item) {
  if (locked()) return lockedToast();
  const snapshot = structuredClone({ pages: S.pages, dock: S.dock, left: S.left });
  removeItem(item.id);
  normalize(S.editing);
  render({ animate: true });
  save();
  // the Apps button is a setting too (Settings › Home screen › Show Apps screen button)
  const appsBtn = item.type === 'app' && item.app === 'drawer' && !isOnHome((x) => x.type === 'app' && x.app === 'drawer');
  if (appsBtn) setSetting('appsButton', false);
  toast(t('home.removed', { name: item.type === 'widget' ? tr(getWidget(item.widget)?.name || '') : itemLabel(item) }), {
    action: t('common.undo'),
    onAction: () => {
      S.pages = snapshot.pages;
      S.dock = snapshot.dock;
      S.left = snapshot.left;
      render({ animate: true });
      save();
      if (appsBtn) setSetting('appsButton', true);
    },
  });
}

export function homeMenu(e) {
  if (S.page === -1) {
    return menu(e, [
      { label: t('home.addWidget'), icon: 'widgets', onClick: () => openWidgetPicker({ left: true }) },
      { label: t('home.edit'), icon: 'edit', onClick: () => setEditing(true) },
      '-',
      { label: t('home.settings'), icon: 'settings', onClick: () => openApp('settings', { params: { page: 'home' } }) },
    ]);
  }
  menu(e, [
    { label: t('home.addSite'), icon: 'link', onClick: () => addSiteDialog().then((r) => r && addSite(r.url, r.title, { webApp: r.webApp })) },
    { label: t('home.widgets'), icon: 'widgets', onClick: () => openWidgetPicker() },
    { label: t('home.wallpaper'), icon: 'image', onClick: () => openApp('settings', { params: { page: 'wallpaper' } }) },
    { label: t('home.edit'), icon: 'edit', onClick: () => setEditing(true) },
    '-',
    { label: t('home.settings'), icon: 'settings', onClick: () => openApp('settings', { params: { page: 'home' } }) },
  ]);
}

export async function addSiteDialog(defaults = {}) {
  const url = h('input', { class: 'ou-input', placeholder: 'https://example.com', value: defaults.url || '' });
  const name = h('input', { class: 'ou-input', placeholder: t('home.siteName'), value: defaults.title || '' });
  url.addEventListener('input', () => {
    if (!name.dataset.touched) name.placeholder = toUrl(url.value) ? siteName(toUrl(url.value)) : t('home.siteName');
  });
  name.addEventListener('input', () => (name.dataset.touched = '1'));
  let webApp = !!defaults.webApp;
  const appRow = switchRow({ title: t('home.webApp'), sub: t('home.webAppSub'), checked: webApp, onChange: (v) => (webApp = v) });
  appRow.classList.add('site-webapp');
  const ok = await dialog({
    title: defaults.id ? t('home.editSite') : t('home.addSite'),
    content: h('div', { class: 'ou-dialog-body' }, url, name, appRow),
    actions: [
      { label: t('common.cancel'), value: false },
      { label: defaults.id ? t('common.save') : t('common.add'), value: true, primary: true, validate: () => !!toUrl(url.value) || (url.focus(), false) },
    ],
  });
  if (!ok) return null;
  const u = toUrl(url.value);
  return { url: u, title: name.value.trim() || siteName(u), webApp };
}

async function editSite(item) {
  const r = await addSiteDialog(findItem(item.id)?.item || item);
  if (!r) return;
  const f = findItem(item.id);
  if (!f) return;
  const { webApp, ...rest } = r;
  Object.assign(f.item, rest);
  if (webApp) f.item.webApp = true;
  else delete f.item.webApp;
  render();
  save();
}

/** Open as web app on or off for a website on the Home screen (pages, folders or the dock). */
export function setWebApp(id, on) {
  const f = findItem(id);
  if (!f || f.item.type !== 'site') return;
  if (on) f.item.webApp = true;
  else delete f.item.webApp;
  render();
  save();
}

async function renameFolder(item) {
  const v = await prompt(t('common.rename'), { value: item.title });
  if (v == null) return;
  const f = findItem(item.id);
  f.item.title = v.trim();
  render();
  save();
}

async function folderColor(item) {
  let pick = item.color || '';
  const ok = await dialog({
    title: t('home.folderColor'),
    content: swatches(FOLDER_COLORS.map((c) => c || 'auto'), item.color || 'auto', (c) => (pick = c === 'auto' ? '' : c)),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }],
  });
  if (!ok) return;
  findItem(item.id).item.color = pick;
  render();
  save();
}

function ungroup(item) {
  const f = findItem(item.id);
  if (!f) return;
  f.list.splice(f.index, 1, ...item.items);
  normalize(S.editing);
  render({ animate: true });
  save();
}

// ——— folders ———
function openFolder(item, fromEl) {
  closeFolder();
  const title = h('input', { class: 'folder-title', value: item.title, placeholder: t('home.folderName'), 'aria-label': t('home.folderName') });
  title.addEventListener('change', () => {
    const f = findItem(item.id);
    if (!f) return;
    f.item.title = title.value.trim();
    render();
    save();
  });
  title.addEventListener('keydown', (e) => e.key === 'Enter' && title.blur());
  const grid = h('div', { class: 'folder-items' });
  const panel = h('div', { class: 'folder-panel', style: item.color ? { '--folder': item.color } : null }, title, grid);
  const scrim = h('div', { class: 'folder-scrim', onPointerdown: (e) => e.target === scrim && closeFolder() }, panel);
  const fill = () => {
    const cur = findItem(item.id)?.item;
    if (!cur) return closeFolder();
    grid.replaceChildren(
      ...cur.items.map((it) => {
        const ico = h('span', { class: 'tile-icon' }, itemIconEl(it));
        const el = h('div', { class: 'tile', tabindex: 0, role: 'button' }, ico, h('span', { class: 'tile-label' }, itemLabel(it)));
        paintBadge(ico, itemBadge(it));
        el.addEventListener('click', (e) => {
          if (el._suppressClick) return;
          closeFolder();
          openItem(it, el.querySelector('.app-icon'), e);
        });
        el.addEventListener('keydown', (e) => e.key === 'Enter' && el.click());
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const fixed = locked();
          menu(e, [
            it.type === 'site' ? { label: t('common.openNewTab'), icon: 'tab', onClick: () => openItem(it, el, { shiftKey: true }) } : null,
            fixed ? null : {
              label: t('home.moveOut'),
              icon: 'upload',
              onClick: () => {
                const f = findItem(it.id);
                if (!f) return;
                f.list.splice(f.index, 1);
                collapseFolder(f.folder);
                S.pages[Math.max(0, S.page)].push(it);
                normalize(S.editing);
                render();
                save();
                fill();
              },
            },
            fixed ? null : { label: t('common.remove'), icon: 'trash', danger: true, onClick: () => { removeWithUndo(it); fill(); } },
          ]);
        });
        // dragging out of the folder hands the item to the home drag system
        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || locked()) return;
          const sx = e.clientX, sy = e.clientY;
          const mv = (ev) => {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
            off();
            el._suppressClick = true;
            const r = panel.getBoundingClientRect();
            const leave = (ev2) => {
              const out = ev2.clientX < r.left || ev2.clientX > r.right || ev2.clientY < r.top || ev2.clientY > r.bottom;
              if (!out) return;
              removeEventListener('pointermove', leave);
              const src = el.cloneNode(true);
              src.style.cssText = `position:fixed;left:${ev2.clientX - 40}px;top:${ev2.clientY - 40}px;width:${M.cellW}px;height:${M.cellH}px`;
              document.body.appendChild(src);
              closeFolder(true);
              startDrag(it, src, ev2);
              src.remove();
            };
            addEventListener('pointermove', leave);
            addEventListener('pointerup', () => removeEventListener('pointermove', leave), { once: true });
          };
          const off = () => {
            removeEventListener('pointermove', mv);
            removeEventListener('pointerup', off);
          };
          addEventListener('pointermove', mv);
          addEventListener('pointerup', off);
        });
        return el;
      })
    );
  };
  fill();
  root.appendChild(scrim);
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    panel.style.transformOrigin = `${r.left + r.width / 2 - innerWidth / 2 + panel.offsetWidth / 2}px ${r.top + r.height / 2 - innerHeight / 2 + panel.offsetHeight / 2}px`;
  }
  requestAnimationFrame(() => scrim.classList.add('show'));
  scrim._key = (e) => e.key === 'Escape' && (e.preventDefault(), closeFolder());
  addEventListener('keydown', scrim._key);
}

function closeFolder(instant) {
  const s = $('.folder-scrim', root);
  if (!s) return;
  removeEventListener('keydown', s._key);
  if (instant) return s.remove();
  s.classList.remove('show');
  setTimeout(() => s.remove(), 240);
}

// ——— badges ———
function paintBadges() {
  for (const el of els.values()) {
    const it = el._item;
    if (it && (it.type === 'app' || it.type === 'folder')) paintBadge(el.querySelector(':scope > .tile-icon'), itemBadge(it));
  }
}

// ——— edit mode, page manager, themes, widget picker ———
export function setEditing(on) {
  if (S.editing === on) return;
  if (on && document.body.classList.contains('locked')) return;
  S.editing = on;
  document.body.classList.toggle('home-edit', on);
  if (on) ensureLeft();
  else {
    closePageManager(true);
    normalize();
  }
  render();
  if (!on) save();
  resetHistory();
}

export const isEditing = () => S.editing;

function syncEditTop() {
  if (!editTop) return;
  editTop.querySelector('.et-undo').disabled = !hist.undo.length;
  editTop.querySelector('.et-redo').disabled = !hist.redo.length;
}

let pm = null; // the open page manager: { view, grid }
/**
 * One UI's page manager: every page as a thumbnail with its Main page button and trash can, the Now Brief page
 * with its switch, a "+" to add a page. Drag a thumbnail to move the page; click one to go there. Changes apply at
 * once (and can be undone).
 */
export function openPageManager() {
  if (pm || document.body.classList.contains('locked')) return;
  if (!S.editing) setEditing(true);
  closeFolder(true);
  const grid = h('div', { class: 'pm-grid' });
  const view = h('div', { class: 'pm-view', role: 'dialog', 'aria-label': t('home.pages') },
    h('div', { class: 'pm-bar' }, h('span', { class: 'pm-title' }, t('home.pages')),
      h('button', { class: 'edit-done pm-done', onClick: () => closePageManager() }, t('common.done'))),
    h('div', { class: 'pm-scroll scroll' }, grid));
  view.addEventListener('pointerdown', (e) => {
    if (e.target === view || e.target.classList.contains('pm-scroll')) view._downOnEmpty = true;
  });
  view.addEventListener('click', (e) => {
    if ((e.target === view || e.target.classList.contains('pm-scroll')) && view._downOnEmpty) closePageManager();
    view._downOnEmpty = false;
  });
  pm = { view, grid };
  root.appendChild(view);
  fillPM();
  requestAnimationFrame(() => view.classList.add('show'));
}

export function closePageManager(instant = false) {
  if (!pm) return;
  const { view } = pm;
  pm = null;
  if (instant) return view.remove();
  view.classList.remove('show');
  setTimeout(() => view.remove(), 220);
}

const PM_PAD = 6;
function fillPM() {
  if (!pm) return;
  const { grid } = pm;
  const gw = M.cols * M.cellW, gh = M.rows * M.cellH;
  let per = clamp(Math.floor((innerWidth - 64) / 250), 2, 5);
  const tw = clamp(Math.floor((innerWidth - 64) / per) - 28, 150, 250);
  // as many columns as fit the grid's width (min(1100px, 100vw - 48px), 28px gaps): rows fill from the start, so the
  // last one lines up under the first instead of being centred
  per = Math.max(1, Math.min(per, Math.floor((Math.min(1100, innerWidth - 48) + 28) / (tw + 28))));
  // the page sits PM_PAD inside its frame, as it does inside the page frame while editing
  const k = (tw - 2 * PM_PAD) / gw, th = Math.round(gh * k) + 2 * PM_PAD;
  grid.style.setProperty('--pm-n', per);
  grid.style.setProperty('--pm-w', tw + 'px');
  grid.style.setProperty('--pm-h', th + 'px');
  const reals = pageEls();
  const fixed = locked();
  const main = mainPage();
  const thumbs = S.pages.map((items, i) => {
    const src = reals[i]?.querySelector('.page-grid');
    const copy = src ? src.cloneNode(true) : h('div', { class: 'page-grid' });
    copy.removeAttribute('style');
    // a picture of the page: nothing in it is focusable or answers to the Home screen's selectors
    $$('[tabindex], [data-id]', copy).forEach((x) => (x.removeAttribute('tabindex'), x.removeAttribute('data-id')));
    copy.setAttribute('inert', '');
    const node = h('div', { class: ['pm-page', i === main && 'main'], dataset: { i } },
      h('div', { class: 'pm-top' },
        h('button', { class: ['pm-home', i === main && 'on'], 'aria-pressed': String(i === main), title: t('home.mainPage'), 'aria-label': t('home.mainPage'), html: icon(i === main ? 'hmHomeFill' : 'home', 20), onClick: () => { setMainPage(i); fillPM(); } }),
        !fixed && S.pages.length > 1 ? h('button', { class: 'pm-del', title: t('home.removePage'), 'aria-label': t('home.removePage'), html: icon('trash', 18), onClick: () => removePage(i) }) : null),
      h('div', { class: ['pm-thumb', i === S.page && 'current'], tabindex: 0, role: 'button', 'aria-label': t('home.page', { n: i + 1 }) },
        h('div', { class: 'pm-inner', style: { width: gw + 'px', height: gh + 'px', transform: `scale(${k})` } }, copy)),
      h('div', { class: 'pm-num' }, String(i + 1)));
    node.querySelector('.pm-thumb').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        closePageManager();
        goPage(i);
      }
    });
    bindPMDrag(node, i);
    return node;
  });
  const on = !!homePref('leftPage');
  const left = h('div', { class: ['pm-page', 'pm-left', !on && 'off'] },
    h('div', { class: 'pm-top' }),
    h('label', { class: 'pm-thumb pm-left-box' },
      h('span', { class: 'pm-left-ico', html: icon('hmBrief', 28) }),
      h('b', null, t('brief.name')),
      sw(on, (v) => {
        setSetting('leftPage', v);
        fillPM();
      }, { label: t('brief.name') })),
    h('div', { class: 'pm-num' }, t('brief.name')));
  const add = h('div', { class: 'pm-page pm-add' }, h('div', { class: 'pm-top' }),
    h('button', { class: 'pm-thumb pm-add-btn', 'aria-label': t('home.addPage'), title: t('home.addPage'), html: icon('plus', 36), onClick: () => {
      S.pages.push([]);
      render();
      save();
      fillPM();
    } }), h('div', { class: 'pm-num' }, t('home.addPage')));
  grid.replaceChildren(left, ...thumbs, add);
}

/** Drag a page thumbnail among the others; a click without moving goes to that page. */
function bindPMDrag(node, i) {
  const thumb = node.querySelector('.pm-thumb');
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const grid = pm.grid, sx = e.clientX, sy = e.clientY, r0 = node.getBoundingClientRect();
    let moving = false;
    const place = (ev) => {
      const r = node.getBoundingClientRect();
      const tx = ev.clientX - sx - (r.left - (parseFloat(node.dataset.tx) || 0) - r0.left);
      const ty = ev.clientY - sy - (r.top - (parseFloat(node.dataset.ty) || 0) - r0.top);
      node.dataset.tx = tx;
      node.dataset.ty = ty;
      node.style.translate = `${tx}px ${ty}px`;
    };
    const move = (ev) => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!moving) {
        if (locked()) {
          up();
          return lockedToast();
        }
        moving = true;
        node.classList.add('moving');
      }
      place(ev);
      const over = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest?.('.pm-page')).find((n) => n && n !== node && !n.classList.contains('pm-left') && !n.classList.contains('pm-add'));
      if (!over) return;
      const r = over.getBoundingClientRect();
      const before = (ev.clientX < r.left + r.width / 2) !== isRtl();
      const ref = before ? over : over.nextSibling;
      if (ref === node || ref === node.nextSibling) return;
      const others = $$('.pm-page:not(.moving)', grid);
      const rects = new Map(others.map((n) => [n, n.getBoundingClientRect()]));
      grid.insertBefore(node, ref);
      for (const n of others) {
        const a = rects.get(n), b = n.getBoundingClientRect();
        if (a.left !== b.left || a.top !== b.top) n.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,.25,0,1)' });
      }
      place(ev);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!moving) {
        if (pm && document.body.contains(node)) {
          closePageManager();
          goPage(i);
        }
        return;
      }
      node.classList.remove('moving');
      node.style.translate = '';
      delete node.dataset.tx;
      delete node.dataset.ty;
      const order = $$('.pm-page:not(.pm-left):not(.pm-add)', grid).map((n) => +n.dataset.i);
      if (order.every((v, k) => v === k)) return;
      const main = mainPage();
      const cur = S.page;
      S.pages = order.map((k) => S.pages[k]);
      const nm = order.indexOf(main);
      if (nm !== main) setSetting('homeMainPage', nm);
      if (cur >= 0) S.page = order.indexOf(cur);
      render();
      save();
      fillPM();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

/** The edit bar's Themes: One UI icon styles, shown on real app icons, applied at once. */
export function openThemes() {
  const sample = ['notes', 'calendar', 'store', 'music', 'clock', 'settings'].filter((id) => getApp(id)).slice(0, 4);
  const cur = () => (ICON_STYLES.includes(setting('iconStyle')) ? setting('iconStyle') : 'default');
  const cards = ICON_STYLES.map((st) => h('button', { class: 'ic-style', role: 'radio', dataset: { style: st }, onClick: () => { setSetting('iconStyle', st); paint(); } },
    h('span', { class: 'ic-preview', dataset: { iconStyle: st } }, sample.map((id) => appIconEl(getApp(id), 44))),
    h('span', { class: 'ic-name' }, t('home.style.' + st))));
  const paint = () => cards.forEach((c) => {
    const on = c.dataset.style === cur();
    c.classList.toggle('on', on);
    c.setAttribute('aria-checked', String(on));
  });
  paint();
  const labels = h('label', { class: 'ic-row' }, h('span', null, t('home.showLabels')), sw(!!setting('showLabels'), (v) => setSetting('showLabels', v), { label: t('home.showLabels') }));
  return dialog({
    title: t('home.themes'),
    content: h('div', { class: 'ic-themes' }, h('div', { class: 'ic-sub' }, t('home.iconStyle')), h('div', { class: 'ic-grid', role: 'radiogroup', 'aria-label': t('home.iconStyle') }, cards), labels),
    className: 'home-themes',
    actions: [{ label: t('common.done'), value: true, primary: true }],
  });
}

export function openWidgetPicker({ left = S.page === -1 } = {}) {
  const widgets = getWidgets();
  const groups = new Map();
  for (const w of widgets) {
    const key = w.app || w.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const cleanups = [];
  // groups A–Z by app name in the current language (registration order depends on which module loaded first)
  const title = (key, ws) => (getApp(key) ? appName(key) : tr(ws[0].name));
  const sorted = [...groups.entries()].sort((a, b) => title(...a).localeCompare(title(...b), locale(), { sensitivity: 'base' }));
  const content = h('div', { class: 'wpick scroll' },
    sorted.map(([key, ws]) =>
      h('div', { class: 'wpick-group', dataset: { group: key } },
        h('div', { class: 'wpick-title' }, title(key, ws)),
        h('div', { class: 'wpick-row' },
          ws.flatMap((w) =>
            w.sizes.map((sz) => {
              // render at the real on-screen size, then scale down so previews look exactly like the result
              const [cw, ch] = SIZE_SPAN[sz];
              const W = cw * M.cellW - 14, H = ch * M.cellH - 14;
              const k = Math.min(0.6, 300 / W, 300 / H);
              const box = h('div', { class: ['wg', `w-${sz}`], style: { width: W + 'px', height: H + 'px', transform: `scale(${k})` } });
              const prev = h('button', { class: ['wpick-item', `ws-${sz}`], title: tr(w.name), onClick: () => { closeDlg(); addWidget(w.id, sz, null, { left }); } },
                h('div', { class: 'wpick-preview', style: { width: W * k + 16 + 'px', height: H * k + 16 + 'px' } }, box),
                h('div', { class: 'wpick-name' }, tr(w.name), h('small', null, t('home.size.' + sz), w.configure ? ' · ' + t('home.configurable') : '')));
              try {
                const c = w.render(box, { size: sz, item: { id: 'preview', widget: w.id, size: sz, config: {} }, config: {}, setConfig() {}, preview: true });
                if (typeof c === 'function') cleanups.push(c);
              } catch (e) {
                console.error(e);
              }
              return prev;
            }))))));
  let closeDlg;
  const p = dialog({ title: left ? t('home.widgetsBrief') : t('home.widgets'), content, className: 'widget-picker', actions: [{ label: t('common.close'), value: null }] });
  closeDlg = () => content.closest('.ou-dialog')?._close(null);
  p.then(() => cleanups.forEach((c) => c()));
}

// ——— search bar + dock + edit bars ———
function buildChrome() {
  root = $('#home');
  viewport = h('div', { class: 'pages-viewport', dataset: { dropHint: t('home.dropHint') } });
  lpHead = h('div', { class: 'lp-head' });
  lpGrid = h('div', { class: 'lp-grid' });
  lpFoot = h('div', { class: 'lp-foot' });
  lpScroll = h('div', { class: 'lp-scroll scroll' }, h('div', { class: 'lp-col' }, lpHead, lpGrid, lpFoot));
  leftEl = h('section', { class: 'left-page', 'aria-label': t('brief.name') }, lpScroll);
  track = h('div', { class: 'pages-track' }, leftEl);
  viewport.appendChild(track);
  dotsEl = h('div', { class: 'page-dots', role: 'tablist' });
  leftDot = h('button', { class: 'left-dot', 'aria-label': t('brief.name'), title: t('brief.name'), html: icon('hmBrief', 14), onClick: () => goPage(-1) });
  indEl = h('div', { class: 'page-ind' }, leftDot, dotsEl);
  searchEl = h('div', { class: 'home-search' },
    h('button', { class: 'hs-bar', onClick: () => import('./finder.js').then((m) => m.openFinder()) },
      h('span', { class: 'hs-ico', html: icon('search', 22) }),
      h('span', { class: 'hs-text' }, t('home.searchPlaceholder')),
      h('span', { class: 'hs-ai', title: t('home.askAi'), html: icon('sparkle', 22), onClick: (e) => { e.stopPropagation(); import('./finder.js').then((m) => m.openFinder('', { ai: true })); } })));
  dockEl = h('div', { class: 'dock' }, h('div', { class: 'dock-inner' }));
  editBar = h('div', { class: 'edit-bar' },
    h('button', { class: 'edit-btn', onClick: () => openApp('settings', { params: { page: 'wallpaper' } }) }, h('span', { html: icon('image', 26) }), t('home.wallpaperStyle')),
    h('button', { class: 'edit-btn', onClick: () => openThemes() }, h('span', { html: icon('hmThemes', 26) }), t('home.themes')),
    h('button', { class: 'edit-btn', onClick: () => openWidgetPicker() }, h('span', { html: icon('widgets', 26) }), t('home.widgets')),
    h('button', { class: 'edit-btn', onClick: () => openApp('settings', { params: { page: 'home' } }) }, h('span', { html: icon('settings', 26) }), t('home.settings')),
    h('button', { class: 'edit-done', onClick: () => setEditing(false) }, h('span', { class: 'edit-done-ico', html: icon('check', 22) }), t('common.done')));
  editTop = h('div', { class: 'edit-top' },
    h('button', { class: 'ou-icon-btn et-undo', title: t('common.undo') + ' (Ctrl+Z)', 'aria-label': t('common.undo'), html: icon('hmUndo', 22), disabled: true, onClick: () => undoHome(true) }),
    h('button', { class: 'ou-icon-btn et-redo', title: t('home.redo') + ' (Ctrl+Shift+Z)', 'aria-label': t('home.redo'), html: icon('hmRedo', 22), disabled: true, onClick: () => undoHome(false) }),
    h('span', { class: 'et-space' }),
    h('button', { class: 'et-pages', onClick: () => openPageManager() }, h('span', { html: icon('hmPages', 20) }), t('home.pages')));
  root.replaceChildren(h('div', { class: 'home-top' }), viewport, indEl, searchEl, dockEl, editBar, editTop);
}

// ——— seed + new apps ———
async function seed() {
  let top = [];
  if (isExt && chrome.topSites) {
    try {
      top = (await chrome.topSites.get()).map((s) => [s.url, s.title]);
    } catch {}
  }
  const site = ([url, title]) => ({ id: uid(), type: 'site', url, title: cleanTitle(title, url) });
  const app = (id) => (getApp(id) ? { id: uid(), type: 'app', app: id } : null);
  const w = (id, size) => {
    const wd = getWidget(id);
    return wd ? { id: uid(), type: 'widget', widget: id, size: wd.sizes.includes(size) ? size : wd.defaultSize, config: {} } : null;
  };
  const folder = (title, items) => (items.length > 1 ? { id: uid(), type: 'folder', title, color: '', items } : items[0] || null);
  const google = DEFAULT_SITES.filter(([u]) => GOOGLE_HOSTS.has(hostname(u))).map(site);
  const seen = new Set(GOOGLE_HOSTS);
  const sites = [];
  for (const s of [...top, ...DEFAULT_SITES]) {
    const host = hostname(s[0]);
    if (seen.has(host) || sites.length >= 10) continue;
    seen.add(host);
    sites.push(site(s));
  }
  const dockIds = [...DOCK_APPS, ...(homePref('appsButton') ? ['drawer'] : [])];
  const placed = new Set([...dockIds, ...SAMSUNG_APPS]);
  const rest = [...PAGE2_APPS, ...getApps().filter((a) => !a.hidden).map((a) => a.id)].filter((id, i, arr) => arr.indexOf(id) === i && !placed.has(id));
  S.pages = [
    [w('weather', 'm'), w('clock-analog', 's'), folder('Google', google), folder('Samsung', SAMSUNG_APPS.map(app).filter(Boolean)), ...sites].filter(Boolean),
    rest.map(app).filter(Boolean),
  ];
  S.dock = dockIds.map(app).filter(Boolean);
  S.left = LEFT_STARTER.map(([id, sz]) => w(id, sz)).filter(Boolean);
  S.page = 0;
  store.set('homeAdded', getApps().map((a) => a.id));
  if (setting('homeMainPage')) setSetting('homeMainPage', 0);
  normalize();
  save();
}

/**
 * Apps this layout has never seen (added to Bloom Tab after it was made) go onto the last page once, as One UI's
 * "Add new apps to Home screen" does; `homeAdded` remembers them, so an app the person removes stays removed.
 * Test runs (navigator.webdriver) keep their seeded layouts unless localStorage `bt.test.homeAdded` asks for it.
 */
function addNewApps() {
  if (navigator.webdriver && !localStorage.getItem('bt.test.homeAdded')) return;
  const seen = store.get('homeAdded');
  const known = new Set(Array.isArray(seen) ? seen : ORIGINAL_APPS);
  const all = getApps();
  if (Array.isArray(seen) && all.every((a) => known.has(a.id))) return;
  const onHome = new Set(allItems().filter((x) => x.type === 'app').map((x) => x.app));
  const fresh = all.filter((a) => !a.hidden && !known.has(a.id) && !onHome.has(a.id));
  if (fresh.length && homePref('addNewApps')) {
    S.pages[S.pages.length - 1].push(...fresh.map((a) => ({ id: uid(), type: 'app', app: a.id })));
    normalize();
    persist();
  }
  store.set('homeAdded', [...new Set([...known, ...all.map((a) => a.id)])]);
}

/** Settings › Home screen › Show Apps screen button: the Apps button goes to the end of the dock, or away. */
function syncAppsButton(on) {
  const has = isOnHome((x) => x.type === 'app' && x.app === 'drawer');
  if (on && !has) {
    const item = { id: uid(), type: 'app', app: 'drawer' };
    if (S.dock.length < 7) S.dock.push(item);
    else S.pages[S.pages.length - 1].push(item);
  } else if (!on && has) {
    removeWhere((x) => x.type === 'app' && x.app === 'drawer');
    return;
  } else return;
  normalize(S.editing);
  render();
  save();
}

function cleanTitle(title, url) {
  const t1 = (title || '').split(/ [-–|·•:] /)[0].trim();
  return t1 && t1.length <= 18 ? t1 : siteName(url);
}

export async function resetHome() {
  els.forEach((el) => el._cleanup?.());
  els.clear();
  [...track.children].forEach((c) => c !== leftEl && c.remove());
  lpGrid.replaceChildren();
  await seed();
  render();
  goPage(0, true);
}

// ——— init ———
export async function initHome() {
  buildChrome();
  measure();
  const pages = store.get('home');
  const dock = store.get('dock');
  const left = store.get('homeLeft');
  if (!Array.isArray(pages)) await seed();
  else {
    S.pages = pages.length ? structuredClone(pages) : [[]];
    S.dock = Array.isArray(dock) ? structuredClone(dock) : [];
    S.left = Array.isArray(left) ? structuredClone(left) : [];
    if (!Array.isArray(left)) {
      // layouts from before the Now Brief page get its starter widgets once
      S.left = LEFT_STARTER.filter(([id]) => getWidget(id)).map(([id, sz]) => ({ id: uid(), type: 'widget', widget: id, size: getWidget(id).sizes.includes(sz) ? sz : getWidget(id).defaultSize, config: {} }));
      store.set('homeLeft', structuredClone(S.left));
    }
    normalize();
    addNewApps();
  }
  S.page = mainPage();
  render();
  resetHistory();
  bindGestures();
  bindKeys();
  bindLinkDrop();

  const reload = () => {
    if (S.drag || writing) return;
    const p = store.get('home');
    const d = store.get('dock');
    const l = store.get('homeLeft');
    if (JSON.stringify(p) === JSON.stringify(S.pages) && JSON.stringify(d) === JSON.stringify(S.dock) && (!Array.isArray(l) || JSON.stringify(l) === JSON.stringify(S.left))) return;
    S.pages = Array.isArray(p) && p.length ? structuredClone(p) : [[]];
    S.dock = Array.isArray(d) ? structuredClone(d) : [];
    if (Array.isArray(l)) S.left = structuredClone(l);
    normalize(S.editing);
    render();
    // a change from another tab (or another module) isn't something to undo here
    resetHistory();
    if (pm) fillPM();
  };
  store.on('home', reload);
  store.on('dock', reload);
  store.on('homeLeft', reload);
  const relayout = () => {
    measure();
    normalize(S.editing);
    render();
  };
  ['gridCols', 'gridRows', 'iconSize', 'showLabels', 'searchBar', 'dockBackground'].forEach((k) => onSetting(k, relayout));
  onSetting('iconStyle', () => {
    measure();
    render();
  });
  onSetting('leftPage', () => render());
  onSetting('homeLocked', () => render());
  onSetting('badges', () => paintBadges());
  onSetting('appsButton', (v) => syncAppsButton(v ?? true));
  onBadgesChange(debounce(paintBadges, 50));
  addEventListener('resize', debounce(relayout, 120));
  watchCover();
}

// ——— pausing the Home screen while nothing of it shows ———
// An opaque maximized window or split screen (its black backdrop fills the screen), the Lock screen, the Daily Board
// and Always On Display hide the whole Home screen, but its widgets' clock hands and other animations would still
// make Chrome restyle and repaint it every frame. Once the covering transition is over, body.home-hidden skips its
// rendering and onHomeHidden() (core/widgets.js) tells modules with loops of their own; it shows again the moment
// anything uncovers it. Pop-up windows floating over the Home screen leave it running.
const HIDE_AFTER = 480; // ms: the window's grow-to-full-screen and the Lock screen's fade-in finish first
export function homeCovered() {
  if (document.body.classList.contains('locked') || document.querySelector('.db:not(.closing), .aod')) return true;
  return openWindows().some((w) => !w.minimized && (w.mode === 'max' || w.mode === 'split') && !(parseFloat(w.win?.style.opacity) < 1));
}
let coverT = 0;
function syncCover() {
  if (!homeCovered()) {
    clearTimeout(coverT);
    coverT = 0;
    return setHomeHidden(false);
  }
  if (!homeHidden() && !coverT) coverT = setTimeout(() => ((coverT = 0), homeCovered() && setHomeHidden(true)), HIDE_AFTER);
}
function watchCover() {
  onWindowsChange(syncCover);
  // body: the `locked` class and the Daily Board / Always On Display layers; the Daily Board also says when it closes
  new MutationObserver(syncCover).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  addEventListener('bt:homecover', syncCover);
  syncCover();
}

// The Apps button that can live in the dock
registerApp({
  id: 'drawer',
  name: 'home.apps',
  hidden: true,
  icon: { bg: 'linear-gradient(150deg, #f5f5f7, #dcdce2)', html: `<svg viewBox="0 0 24 24" width="62%" height="62%">${[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#3a3a44"/>`)).join('')}</svg>` },
  launch: () => import('./drawer.js').then((m) => m.openDrawer()),
});

addStrings({
  en: {
    'home.apps': 'Apps',
    'home.page': 'Page {n}',
    'home.addPage': 'Add page',
    'home.searchPlaceholder': 'Search or type a URL',
    'home.askAi': 'Ask AI',
    'home.addSite': 'Add website',
    'home.editSite': 'Edit website',
    'home.siteName': 'Name',
    'home.widgets': 'Widgets',
    'home.widgetsBrief': 'Widgets for Now Brief',
    'home.wallpaper': 'Wallpaper and style',
    'home.wallpaperStyle': 'Wallpaper and style',
    'home.themes': 'Themes',
    'home.iconStyle': 'Icon style',
    'home.showLabels': 'Show app names',
    'home.style.default': 'Default',
    'home.style.themed': 'Themed icons',
    'home.style.dark': 'Dark',
    'home.style.glass': 'Clear',
    'home.edit': 'Edit Home screen',
    'home.settings': 'Settings',
    'home.folder': 'Folder',
    'home.folderName': 'Folder name',
    'home.folderColor': 'Folder color',
    'home.ungroup': 'Ungroup',
    'home.moveOut': 'Move to Home screen',
    'home.addToEdge': 'Add to Edge panel',
    'home.removed': '“{name}” removed',
    'home.widgetAdded': 'Widget added',
    'home.widgetMissing': 'Widget unavailable',
    'home.widgetSettings': 'Widget settings',
    'home.configurable': 'Customizable',
    'home.size.s': 'Small',
    'home.size.m': 'Medium',
    'home.size.l': 'Large',
    'home.redo': 'Redo',
    'home.webApp': 'Open as web app',
    'home.webAppSub': 'Opens in its own window, without tabs',
    'home.pages': 'Pages',
    'home.mainPage': 'Main page',
    'home.mainPageSet': 'Set as main page',
    'home.removePage': 'Remove page',
    'home.removePageQ': 'Remove page?',
    'home.removePageMsg': 'The items on this page will be removed too.',
    'home.lockedToast': 'Home screen layout is locked',
    'home.linkAdded': '“{name}” added to Home screen',
    'home.dropHint': 'Drop to add to Home screen',
    'home.addWidget': 'Add widget',
    'home.leftSub': 'Swipe right on the Home screen to see your widgets',
    'home.leftEmpty': 'Add the widgets you want to see at a glance.',
    'home.leftOff': 'Turn on to keep a column of widgets left of your first page.',
    // Settings › Home screen
    'home.set.appsButton': 'Show Apps screen button on Home screen',
    'home.set.appsSort': 'Apps screen order',
    'home.set.sortAz': 'Alphabetical order',
    'home.set.sortCustom': 'Custom order',
    'home.set.lock': 'Lock Home screen layout',
    'home.set.lockSub': 'Prevent items on the Home screen from being removed or repositioned.',
    'home.set.newApps': 'Add new apps to Home screen',
    'home.set.badges': 'App icon badges',
    'home.set.badgeNumber': 'Show with number',
    'home.set.badgeDot': 'Show without number',
    'home.set.badgeOff': 'Off',
    'home.set.leftPage': 'Now Brief page',
    'home.set.editPages': 'Pages',
    'home.set.editPagesSub': 'Add, remove and move pages, choose the main page',
  },
  ar: {
    'home.apps': 'التطبيقات',
    'home.page': 'الصفحة {n}',
    'home.addPage': 'إضافة صفحة',
    'home.searchPlaceholder': 'ابحث أو اكتب عنوان URL',
    'home.askAi': 'اسأل الذكاء الاصطناعي',
    'home.addSite': 'إضافة موقع',
    'home.editSite': 'تعديل الموقع',
    'home.siteName': 'الاسم',
    'home.widgets': 'الأدوات',
    'home.widgetsBrief': 'أدوات الموجز الآن',
    'home.wallpaper': 'الخلفية والنمط',
    'home.wallpaperStyle': 'الخلفية والنمط',
    'home.themes': 'السمات',
    'home.iconStyle': 'نمط الأيقونات',
    'home.showLabels': 'إظهار أسماء التطبيقات',
    'home.style.default': 'افتراضي',
    'home.style.themed': 'أيقونات بالسمة',
    'home.style.dark': 'داكن',
    'home.style.glass': 'شفاف',
    'home.edit': 'تعديل الشاشة الرئيسية',
    'home.settings': 'الإعدادات',
    'home.folder': 'مجلد',
    'home.folderName': 'اسم المجلد',
    'home.folderColor': 'لون المجلد',
    'home.ungroup': 'فك التجميع',
    'home.moveOut': 'نقل إلى الشاشة الرئيسية',
    'home.addToEdge': 'إضافة إلى لوحة الحافة',
    'home.removed': 'تمت إزالة "{name}"',
    'home.widgetAdded': 'تمت إضافة الأداة',
    'home.widgetMissing': 'الأداة غير متاحة',
    'home.widgetSettings': 'إعدادات الأداة',
    'home.configurable': 'قابلة للتخصيص',
    'home.size.s': 'صغير',
    'home.size.m': 'متوسط',
    'home.size.l': 'كبير',
    'home.redo': 'إعادة',
    'home.webApp': 'فتح كتطبيق ويب',
    'home.webAppSub': 'يُفتح في نافذة خاصة به بدون تبويبات',
    'home.pages': 'الصفحات',
    'home.mainPage': 'الصفحة الرئيسية',
    'home.mainPageSet': 'تم التعيين كصفحة رئيسية',
    'home.removePage': 'إزالة الصفحة',
    'home.removePageQ': 'إزالة الصفحة؟',
    'home.removePageMsg': 'ستُزال العناصر الموجودة في هذه الصفحة أيضًا.',
    'home.lockedToast': 'تخطيط الشاشة الرئيسية مقفل',
    'home.linkAdded': 'تمت إضافة "{name}" إلى الشاشة الرئيسية',
    'home.dropHint': 'أفلت للإضافة إلى الشاشة الرئيسية',
    'home.addWidget': 'إضافة أداة',
    'home.leftSub': 'اسحب لليمين على الشاشة الرئيسية لرؤية أدواتك',
    'home.leftEmpty': 'أضف الأدوات التي تريد رؤيتها بلمحة.',
    'home.leftOff': 'شغّله لإبقاء عمود من الأدوات قبل صفحتك الأولى.',
    'home.set.appsButton': 'إظهار زر شاشة التطبيقات على الشاشة الرئيسية',
    'home.set.appsSort': 'ترتيب شاشة التطبيقات',
    'home.set.sortAz': 'ترتيب أبجدي',
    'home.set.sortCustom': 'ترتيب مخصص',
    'home.set.lock': 'قفل تخطيط الشاشة الرئيسية',
    'home.set.lockSub': 'منع إزالة العناصر الموجودة على الشاشة الرئيسية أو تغيير أماكنها.',
    'home.set.newApps': 'إضافة التطبيقات الجديدة إلى الشاشة الرئيسية',
    'home.set.badges': 'شارات أيقونات التطبيقات',
    'home.set.badgeNumber': 'إظهار مع الرقم',
    'home.set.badgeDot': 'إظهار بدون رقم',
    'home.set.badgeOff': 'إيقاف',
    'home.set.leftPage': 'صفحة الموجز الآن',
    'home.set.editPages': 'الصفحات',
    'home.set.editPagesSub': 'أضف الصفحات وأزلها وانقلها، واختر الصفحة الرئيسية',
  },
});
