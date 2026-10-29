// Apps screen: every built-in app + every website you use, with instant search, One UI's Sort (Alphabetical order
// or Custom order) and folders of its own. Drag an icon onto another to make a folder, between icons to move it
// (Custom order), or up onto the "Home screen" bar to place it on the Home screen.
// Layout in store key `drawerLayout`: { order: [key], folders: [{ id, title, color, items: [key] }] } where a key is
// 'app:<id>', 'site:<url>' or 'folder:<id>'.
import { h, $, $$, uid, hostname, isExt, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, lang, isRtl } from '../core/i18n.js';
import { store, setSetting } from '../core/store.js';
import { getApps, appName, onAppsChange } from '../core/apps.js';
import { onBadgesChange } from '../core/activity.js';
import { menu, toast, dialog, choose, swatches } from '../core/ui.js';
import { itemIconEl, itemLabel, openItem, paintBadge, itemBadge } from './appicon.js';
import { allItems, addSite, addAppToHome, addItemToHome, startExternalDrag, homePref } from './home.js';

let el, grid, input, dropBar, open = false, topSites = [];
const FOLDER_COLORS = ['', '#3e7bff', '#22b07d', '#ff9f1c', '#ff4d6d', '#9b5de5', '#00b4d8', '#6c757d'];

const layout = () => {
  const l = store.get('drawerLayout') || {};
  return { order: Array.isArray(l.order) ? l.order : [], folders: Array.isArray(l.folders) ? l.folders : [] };
};
const saveLayout = (l) => store.set('drawerLayout', { order: l.order, folders: l.folders.filter((f) => f.items.length) });
const custom = () => homePref('appsSort') === 'custom';
const keyOf = (it) => (it.type === 'app' ? 'app:' + it.app : 'site:' + String(it.url || '').replace(/\/$/, ''));

export function initDrawer() {
  el = $('#drawer');
  input = h('input', { class: 'drawer-input', type: 'search', placeholder: t('drawer.search'), 'aria-label': t('drawer.search'), autocomplete: 'off', spellcheck: 'false' });
  grid = h('div', { class: 'drawer-grid' });
  dropBar = h('div', { class: 'drawer-drop', 'aria-hidden': 'true' }, h('span', { html: icon('home', 20) }), t('drawer.dropHome'));
  const scroller = h('div', { class: 'drawer-scroll scroll' }, grid);
  el.replaceChildren(
    h('div', { class: 'drawer-head' },
      h('label', { class: 'drawer-search' }, h('span', { html: icon('search', 22) }), input),
      h('button', { class: 'ou-icon-btn drawer-more', title: t('common.more'), html: icon('more', 22), onClick: (e) => menu(e.currentTarget, [
        { label: t('home.addSite'), icon: 'link', onClick: () => import('./home.js').then(async (m) => { const r = await m.addSiteDialog(); if (r) { m.addSite(r.url, r.title, { webApp: r.webApp }); fill(); } }) },
        { label: t('drawer.createFolder'), icon: 'folder', onClick: () => createFolderDialog() },
        { label: t('drawer.sort'), icon: 'sort', onClick: () => sortDialog() },
        { label: t('common.settings'), icon: 'settings', onClick: () => { closeDrawer(); import('../core/apps.js').then((m) => m.openApp('settings', { params: { page: 'home' } })); } },
      ], { align: 'end' }) })),
    dropBar,
    scroller);
  input.addEventListener('input', fill);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        fill();
      } else closeDrawer();
    } else if (e.key === 'Enter') {
      const first = grid.querySelector('.tile');
      if (first) first.click();
      else if (input.value.trim()) import('./finder.js').then((m) => { closeDrawer(); m.openFinder(input.value); });
    }
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el || e.target === scroller) el._downOnEmpty = true;
  });
  el.addEventListener('click', (e) => {
    if ((e.target === el || e.target === scroller || e.target === grid) && el._downOnEmpty) closeDrawer();
    el._downOnEmpty = false;
  });
  // scrolling up past the top closes, like swiping down on One UI
  let pull = 0;
  scroller.addEventListener('wheel', (e) => {
    if (scroller.scrollTop <= 0 && e.deltaY < 0) {
      pull += -e.deltaY;
      if (pull > 140) {
        pull = 0;
        closeDrawer();
      }
    } else pull = 0;
  }, { passive: true });
  onAppsChange(() => open && fill());
  onBadgesChange(() => open && paintAll());
  store.on('drawerLayout', () => open && !el._dragging && fill());
  store.on('settings', () => open && !el._dragging && fill());
}

/** Every app and website the Apps screen shows, by key. */
function entries() {
  const seen = new Set();
  const out = [];
  for (const app of getApps()) {
    if (app.hidden) continue;
    out.push({ key: 'app:' + app.id, item: { id: 'app:' + app.id, type: 'app', app: app.id }, label: appName(app), kind: 'app' });
  }
  for (const it of allItems()) {
    if (it.type !== 'site') continue;
    const key = it.url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key: 'site:' + key, item: it, label: itemLabel(it), kind: 'site' });
  }
  for (const s of topSites) {
    const key = s.url.replace(/\/$/, '');
    if (seen.has(key) || [...seen].some((k) => hostname(k) === hostname(key))) continue;
    seen.add(key);
    const it = { id: 'top:' + key, type: 'site', url: s.url, title: (s.title || '').split(/ [-–|·•:] /)[0].slice(0, 22) || hostname(s.url) };
    out.push({ key: 'site:' + key, item: it, label: itemLabel(it), kind: 'site' });
  }
  return out;
}

const collator = () => new Intl.Collator(lang(), { sensitivity: 'base' });

/** The top level of the Apps screen: folders and the entries outside them, in the chosen order. */
function topLevel(all) {
  const L = layout();
  const byKey = new Map(all.map((e) => [e.key, e]));
  const inFolder = new Set();
  const folders = [];
  for (const f of L.folders) {
    const members = f.items.map((k) => byKey.get(k)).filter(Boolean);
    if (!members.length) continue;
    members.forEach((m) => inFolder.add(m.key));
    folders.push({ key: 'folder:' + f.id, folder: f, members, label: f.title || t('home.folder'), kind: 'folder', item: { id: 'folder:' + f.id, type: 'folder', title: f.title, color: f.color, items: members.map((m) => m.item) } });
  }
  const list = [...folders, ...all.filter((e) => !inFolder.has(e.key))];
  const coll = collator();
  const az = (a, b) => coll.compare(a.label, b.label);
  if (!custom()) return list.sort(az);
  const pos = new Map(L.order.map((k, i) => [k, i]));
  return list.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e6) - (pos.has(b.key) ? pos.get(b.key) : 1e6) || az(a, b));
}

function fill() {
  const q = input.value.trim().toLowerCase();
  const all = entries();
  // searching looks inside folders too, A–Z
  const list = q
    ? all.filter((e) => e.label.toLowerCase().includes(q) || (e.item.url || '').toLowerCase().includes(q)).sort((a, b) => collator().compare(a.label, b.label))
    : topLevel(all);
  grid.replaceChildren(...list.map((e) => tileFor(e)));
  if (!list.length) grid.appendChild(h('div', { class: 'drawer-empty' }, t('drawer.noResults')));
}

function tileFor(entry, { inFolder = null } = {}) {
  const { item, label } = entry;
  const ico = h('span', { class: 'tile-icon' }, itemIconEl(item));
  const tile = h('div', { class: ['tile', entry.kind === 'folder' && 't-folder'], tabindex: 0, role: 'button', 'aria-label': label, dataset: { key: entry.key } },
    ico, h('span', { class: 'tile-label' }, label));
  tile._entry = entry;
  paintBadge(ico, itemBadge(item));
  tile.addEventListener('click', (e) => {
    if (tile._drag) return;
    if (entry.kind === 'folder') return openFolder(entry, tile);
    closeFolder(true);
    closeDrawer();
    openItem(item, tile.querySelector('.app-icon'), e);
  });
  tile.addEventListener('keydown', (e) => e.key === 'Enter' && tile.click());
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (entry.kind === 'folder') {
      return menu(e, [
        { label: t('common.rename'), icon: 'edit', onClick: () => openFolder(entry, tile, { rename: true }) },
        { label: t('home.folderColor'), icon: 'palette', onClick: () => folderColor(entry.folder) },
        { label: t('drawer.addFolderHome'), icon: 'home', onClick: () => { folderToHome(entry); toast(t('drawer.added')); } },
        { label: t('home.ungroup'), icon: 'apps', onClick: () => ungroup(entry.folder.id) },
      ]);
    }
    menu(e, [
      item.type === 'site' ? { label: t('common.openNewTab'), icon: 'tab', onClick: () => openItem(item, tile, { shiftKey: true }) } : null,
      {
        label: t('drawer.addHome'),
        icon: 'home',
        onClick: () => {
          if (item.type === 'app') addAppToHome(item.app);
          else addSite(item.url, item.title);
          toast(t('drawer.added'));
        },
      },
      inFolder
        ? { label: t('drawer.removeFromFolder'), icon: 'upload', onClick: () => removeFromFolder(inFolder.id, entry.key) }
        : { label: t('home.addToEdge'), icon: 'edge', onClick: () => import('./edge.js').then((m) => m.addToEdge({ ...item, id: uid() })) },
    ]);
  });
  bindDrag(tile, entry, inFolder);
  return tile;
}

function paintAll() {
  $$('.tile', el).forEach((tile) => tile._entry && paintBadge(tile.querySelector(':scope > .tile-icon'), itemBadge(tile._entry.item)));
}

// ——— dragging ———
/** A fresh Home screen item for an entry (folders bring copies of their apps and sites). */
function homeItem(entry) {
  const { item } = entry;
  if (entry.kind === 'folder') return { id: uid(), type: 'folder', title: entry.folder.title || t('home.folder'), color: entry.folder.color || '', items: entry.members.map((m) => ({ ...m.item, id: uid() })) };
  return { ...item, id: uid() };
}

const folderToHome = (entry) => addItemToHome(homeItem(entry));

function bindDrag(tile, entry, inFolder) {
  tile.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tile._drag = false;
    const sx = e.clientX, sy = e.clientY;
    const mv = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 10) return;
      off();
      tile._drag = true;
      // while searching (or from inside a folder) a drag goes straight to the Home screen, as before
      if (input.value.trim() || inFolder) {
        closeFolder(true);
        closeDrawer(true);
        startExternalDrag(homeItem(entry), ev);
        return;
      }
      startDrag(tile, entry, ev);
    };
    const off = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', off);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', off);
  });
}

function startDrag(tile, entry, e) {
  const r = tile.getBoundingClientRect();
  const ghost = tile.cloneNode(true);
  ghost.classList.add('drag-ghost', 'dw-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.appendChild(ghost);
  const off = { x: e.clientX - r.left, y: e.clientY - r.top };
  tile.classList.add('dw-dragging');
  el._dragging = true;
  el.classList.add('dragging');
  let folderKey = null, folderTimer = null, homeTimer = null, pending = null;
  const place = (ev) => (ghost.style.transform = `translate(${ev.clientX - off.x}px, ${ev.clientY - off.y}px) scale(1.08)`);
  place(e);
  const clearFolder = () => {
    clearTimeout(folderTimer);
    folderTimer = null;
    pending = null;
    folderKey = null;
    $$('.tile.folder-hover', grid).forEach((x) => x.classList.remove('folder-hover'));
  };
  const finish = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    clearTimeout(homeTimer);
    clearTimeout(folderTimer);
    ghost.remove();
    tile.classList.remove('dw-dragging');
    el.classList.remove('dragging');
    dropBar.classList.remove('hot');
    el._dragging = false;
  };
  const move = (ev) => {
    place(ev);
    // the "Home screen" bar on top hands the icon over to the Home screen
    const zr = dropBar.getBoundingClientRect();
    if (ev.clientY < zr.bottom + 8) {
      dropBar.classList.add('hot');
      clearFolder();
      if (!homeTimer) homeTimer = setTimeout(() => {
        finish();
        closeDrawer(true);
        startExternalDrag(homeItem(entry), ev);
      }, 380);
      return;
    }
    dropBar.classList.remove('hot');
    clearTimeout(homeTimer);
    homeTimer = null;
    // over the middle of another icon: make a folder (or join one)
    const tiles = $$(':scope > .tile', grid).filter((x) => x !== tile);
    const over = entry.kind === 'folder' ? null : tiles.find((x) => {
      const ir = x.querySelector('.app-icon')?.getBoundingClientRect();
      return ir && ev.clientX > ir.left + ir.width * 0.15 && ev.clientX < ir.right - ir.width * 0.15 && ev.clientY > ir.top + ir.height * 0.15 && ev.clientY < ir.bottom - ir.height * 0.15;
    });
    if (over) {
      if (pending !== over.dataset.key) {
        clearFolder();
        pending = over.dataset.key;
        folderTimer = setTimeout(() => {
          folderKey = pending;
          over.classList.add('folder-hover');
        }, 380);
      }
      return;
    }
    if (pending) clearFolder();
    // Custom order: the icon makes room where the pointer is
    if (!custom()) return;
    const ref = tiles.find((x) => {
      const tr = x.getBoundingClientRect();
      if (ev.clientY < tr.top) return true;
      return ev.clientY <= tr.bottom && (isRtl() ? ev.clientX > tr.left + tr.width / 2 : ev.clientX < tr.left + tr.width / 2);
    }) || null;
    if (ref === tile.nextElementSibling || (ref === null && tile === grid.lastElementChild)) return;
    const before = new Map(tiles.map((x) => [x, x.getBoundingClientRect()]));
    grid.insertBefore(tile, ref);
    for (const x of tiles) {
      const a = before.get(x), b = x.getBoundingClientRect();
      if (a.left !== b.left || a.top !== b.top) x.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,.25,0,1)' });
    }
  };
  const up = () => {
    const target = folderKey;
    finish();
    const L = layout();
    if (target) {
      dropOnto(L, entry.key, target);
      saveLayout(L);
    } else if (custom()) {
      L.order = $$(':scope > .tile', grid).map((x) => x.dataset.key);
      saveLayout(L);
    }
    fill();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

/** Dropping `src` on `target`: joins the target's folder or makes a new one where the target was. */
function dropOnto(L, src, target) {
  L.folders.forEach((f) => (f.items = f.items.filter((k) => k !== src)));
  if (target.startsWith('folder:')) {
    const f = L.folders.find((x) => 'folder:' + x.id === target);
    if (f) f.items.push(src);
  } else {
    const id = uid();
    L.folders.push({ id, title: t('home.folder'), color: '', items: [target, src] });
    const i = L.order.indexOf(target);
    if (i >= 0) L.order.splice(i, 1, 'folder:' + id);
    else L.order.push('folder:' + id);
  }
  L.order = L.order.filter((k) => k !== src);
}

function removeFromFolder(id, key) {
  const L = layout();
  const f = L.folders.find((x) => x.id === id);
  if (!f) return;
  f.items = f.items.filter((k) => k !== key);
  const at = L.order.indexOf('folder:' + id);
  if (f.items.length <= 1) {
    // a folder with one icon left becomes that icon, where the folder was
    L.folders = L.folders.filter((x) => x !== f);
    L.order.splice(at < 0 ? L.order.length : at, at < 0 ? 0 : 1, ...f.items);
  }
  if (!L.order.includes(key)) L.order.splice(at < 0 ? L.order.length : at + 1, 0, key);
  saveLayout(L);
  fill();
  const still = L.folders.find((x) => x.id === id);
  if (still) refreshFolder();
  else closeFolder();
}

function ungroup(id) {
  const L = layout();
  const f = L.folders.find((x) => x.id === id);
  if (!f) return;
  const at = L.order.indexOf('folder:' + id);
  L.folders = L.folders.filter((x) => x !== f);
  if (at >= 0) L.order.splice(at, 1, ...f.items);
  saveLayout(L);
  closeFolder(true);
  fill();
}

async function folderColor(folder) {
  let pick = folder.color || '';
  const ok = await dialog({
    title: t('home.folderColor'),
    content: swatches(FOLDER_COLORS.map((c) => c || 'auto'), folder.color || 'auto', (c) => (pick = c === 'auto' ? '' : c)),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }],
  });
  if (!ok) return;
  const L = layout();
  const f = L.folders.find((x) => x.id === folder.id);
  if (!f) return;
  f.color = pick;
  saveLayout(L);
  fill();
  refreshFolder();
}

// ——— folders ———
let folderView = null; // { scrim, id, fill }
function openFolder(entry, fromEl, { rename = false } = {}) {
  closeFolder(true);
  const id = entry.folder.id;
  const title = h('input', { class: 'folder-title', value: entry.folder.title || '', placeholder: t('home.folderName'), 'aria-label': t('home.folderName') });
  title.addEventListener('change', () => {
    const L = layout();
    const f = L.folders.find((x) => x.id === id);
    if (!f) return;
    f.title = title.value.trim();
    saveLayout(L);
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFolder();
    }
  });
  const items = h('div', { class: 'folder-items' });
  const panel = h('div', { class: 'folder-panel' }, title, items);
  const scrim = h('div', { class: 'folder-scrim dw-folder', onPointerdown: (e) => e.target === scrim && closeFolder() }, panel);
  const fillFolder = () => {
    const L = layout();
    const f = L.folders.find((x) => x.id === id);
    if (!f) return closeFolder();
    panel.style.setProperty('--folder', f.color || '');
    if (!f.color) panel.style.removeProperty('--folder');
    const byKey = new Map(entries().map((e) => [e.key, e]));
    items.replaceChildren(...f.items.map((k) => byKey.get(k)).filter(Boolean).map((e) => tileFor(e, { inFolder: f })));
  };
  folderView = { scrim, id, fill: fillFolder };
  fillFolder();
  el.appendChild(scrim);
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    panel.style.transformOrigin = `${r.left + r.width / 2 - innerWidth / 2 + panel.offsetWidth / 2}px ${r.top + r.height / 2 - innerHeight / 2 + panel.offsetHeight / 2}px`;
  }
  requestAnimationFrame(() => scrim.classList.add('show'));
  scrim._key = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.ou-menu-scrim, .ou-dialog-scrim')) return;
    e.preventDefault();
    e.stopPropagation();
    closeFolder();
  };
  addEventListener('keydown', scrim._key, true);
  if (rename) setTimeout(() => title.select(), 120);
}

function refreshFolder() {
  folderView?.fill();
}

function closeFolder(instant) {
  if (!folderView) return;
  const { scrim } = folderView;
  folderView = null;
  removeEventListener('keydown', scrim._key, true);
  if (instant) return scrim.remove();
  scrim.classList.remove('show');
  setTimeout(() => scrim.remove(), 240);
}

// ——— ⋮ menu ———
async function sortDialog() {
  const v = await choose(t('drawer.sort'), [{ value: 'az', label: t('home.set.sortAz') }, { value: 'custom', label: t('home.set.sortCustom') }], homePref('appsSort'));
  if (!v) return;
  setAppsSort(v);
}

/** Alphabetical or Custom order; Custom starts from what is on screen, so nothing jumps. */
export function setAppsSort(v) {
  if (v === 'custom' && !custom()) {
    const L = layout();
    L.order = topLevel(entries()).map((e) => e.key);
    saveLayout(L);
  }
  setSetting('appsSort', v);
  if (open) fill();
}

async function createFolderDialog() {
  const all = topLevel(entries()).filter((e) => e.kind !== 'folder');
  const picked = new Set();
  const name = h('input', { class: 'ou-input', placeholder: t('home.folderName'), value: '' });
  const pick = h('div', { class: 'edge-pick dw-pick' },
    all.map((e) => {
      const b = h('button', { class: 'edge-pick-item', dataset: { key: e.key } }, itemIconEl(e.item), h('span', null, e.label), h('i', { html: icon('check', 14) }));
      b.addEventListener('click', () => {
        if (picked.has(e.key)) picked.delete(e.key);
        else picked.add(e.key);
        b.classList.toggle('on', picked.has(e.key));
      });
      return b;
    }));
  const ok = await dialog({
    title: t('drawer.createFolder'),
    content: h('div', { class: 'ou-dialog-body' }, name, pick),
    className: 'wide',
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true, validate: () => picked.size > 0 }],
  });
  if (!ok || !picked.size) return;
  const L = layout();
  const keys = all.map((e) => e.key).filter((k) => picked.has(k));
  const id = uid();
  L.folders.forEach((f) => (f.items = f.items.filter((k) => !picked.has(k))));
  if (custom()) {
    const at = Math.min(...keys.map((k) => L.order.indexOf(k)).filter((i) => i >= 0), L.order.length);
    L.order = L.order.filter((k) => !picked.has(k));
    L.order.splice(clamp(at, 0, L.order.length), 0, 'folder:' + id);
  }
  L.folders.push({ id, title: name.value.trim() || t('home.folder'), color: '', items: keys });
  saveLayout(L);
  fill();
}

export async function openDrawer() {
  if (open || document.body.classList.contains('locked')) return;
  open = true;
  if (isExt && chrome.topSites && !topSites.length) {
    try {
      topSites = await chrome.topSites.get();
    } catch {}
  }
  input.value = '';
  fill();
  el.classList.add('show');
  document.body.classList.add('drawer-open');
  setTimeout(() => input.focus({ preventScroll: true }), 80);
}

export function closeDrawer(instant = false) {
  if (!open) return;
  open = false;
  closeFolder(true);
  el.classList.toggle('instant', instant);
  el.classList.remove('show');
  document.body.classList.remove('drawer-open');
  input.blur();
}

export const isDrawerOpen = () => open;

addStrings({
  en: {
    'drawer.search': 'Search',
    'drawer.addHome': 'Add to Home',
    'drawer.added': 'Added to Home screen',
    'drawer.noResults': 'No results',
    'drawer.sort': 'Sort',
    'drawer.createFolder': 'Create folder',
    'drawer.removeFromFolder': 'Remove from folder',
    'drawer.addFolderHome': 'Add folder to Home',
    'drawer.dropHome': 'Home screen',
  },
  ar: {
    'drawer.search': 'بحث',
    'drawer.addHome': 'إضافة إلى الرئيسية',
    'drawer.added': 'تمت الإضافة إلى الشاشة الرئيسية',
    'drawer.noResults': 'لا توجد نتائج',
    'drawer.sort': 'فرز',
    'drawer.createFolder': 'إنشاء مجلد',
    'drawer.removeFromFolder': 'إزالة من المجلد',
    'drawer.addFolderHome': 'إضافة المجلد إلى الرئيسية',
    'drawer.dropHome': 'الشاشة الرئيسية',
  },
});
