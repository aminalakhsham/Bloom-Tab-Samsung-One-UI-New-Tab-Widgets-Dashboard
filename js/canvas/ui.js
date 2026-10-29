// Canvas, the Samsung Notes way: a gallery of boards (All boards, Favorites, Recycle bin in a side pane, or a
// drawer in narrow windows; previews in a grid or a list with sort, search and selection mode) and the board itself
// (js/canvas/board.js) as a pushed page.
import { h, $, $$, escapeHtml as esc, debounce, onLongPress, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, lang, fmtDate, fmtTime } from '../core/i18n.js';
import { store } from '../core/store.js';
import { blobUrl } from '../core/blobs.js';
import { menu, toast, prompt, confirm, choose } from '../core/ui.js';
import { currentApp } from '../core/apps.js';
import './icons.js';
import './strings.js';
import * as M from './model.js';
import * as BD from './boards.js';
import { openBoard, prefs, setPref } from './board.js';

const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'd' : 'l');
const fold = (s) => String(s || '').toLocaleLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '');
/** Samsung Notes' dates: the time today, the day this year, else the full date. */
export function boardDate(ts) {
  const d = new Date(ts);
  if (sameDay(d, new Date())) return fmtTime(d);
  return fmtDate(d, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
const countText = (n) => (n === 1 ? t('canvas.oneBoard') : t('canvas.nBoards', { n }));

export function render(ctx) {
  let view = ['all', 'favs', 'bin'].includes(prefs().view) ? prefs().view : 'all';
  let query = null, selecting = false, picked = new Set(), boardOpen = null, galPage = null;

  const navRow = (v, ic, label) => h('button', { class: 'cv-nav-row', dataset: { view: v } }, h('span', { class: 'cv-nav-ic', html: icon(ic, 22) }), h('span', { class: 'cv-nav-l' }, label), h('span', { class: 'cv-nav-n' }));
  const nav = h('nav', { class: 'cv-nav', 'aria-label': t('app.canvas') },
    h('div', { class: 'cv-nav-head' }, t('app.canvas')),
    navRow('all', 'cv-board', t('canvas.allBoards')),
    navRow('favs', 'star', t('canvas.favorites')),
    h('div', { class: 'cv-nav-sep' }),
    navRow('bin', 'trash', t('canvas.bin')));
  const scrim = h('div', { class: 'cv-gal-scrim', hidden: true, onClick: () => toggleNav(false) });
  const barTitle = h('div', { class: 'cv-bar-title' });
  const searchIn = h('input', { type: 'search', placeholder: t('canvas.search'), 'aria-label': t('canvas.search'), spellcheck: 'false', dir: 'auto' });
  const bar = h('header', { class: 'cv-bar' });
  const heroTitle = h('h1', { class: 'cv-hero-t' }), heroSub = h('div', { class: 'cv-hero-s' });
  const binNote = h('div', { class: 'cv-bin-note', hidden: true }, t('canvas.binNote'));
  const grid = h('div', { class: 'cv-grid', role: 'list' });
  const scroll = h('div', { class: 'cv-scroll scroll' }, h('div', { class: 'cv-hero' }, heroTitle, heroSub), binNote, grid);
  const fab = h('button', { class: 'ou-fab cv-fab', title: t('canvas.newBoard') + ' (N)', 'aria-label': t('canvas.newBoard'), html: icon('cv-new', 26), onClick: () => newBoard() });
  const selbar = h('div', { class: 'cv-selbar', hidden: true });
  const main = h('section', { class: 'cv-main' }, bar, scroll, fab, selbar);
  const root = h('div', { class: 'cv-gal', dataset: { cols: '2' } }, nav, scrim, main);

  galPage = ctx.page({ title: t('app.canvas'), hero: false, className: 'cv-gal-page', render: (body) => { body.classList.add('flush'); body.append(root); } });
  galPage.onReturn = () => { boardOpen = null; drawAll(); };

  // ---------------------------------------------------------------- what the gallery shows
  const viewName = (v) => ({ all: t('canvas.allBoards'), favs: t('canvas.favorites'), bin: t('canvas.bin') }[v]);
  function inView(b, v = view) {
    if (v === 'bin') return !!b.deleted;
    if (b.deleted) return false;
    return v === 'favs' ? !!b.fav : true;
  }
  function shown() {
    const q = query?.trim();
    const list = BD.all().filter((b) => (q ? !b.deleted && M.boardMatches(b, q, fold) : inView(b)));
    if (view === 'bin' && !q) return list.sort((a, b) => b.deleted - a.deleted);
    return M.sortBoards(list, prefs().sort || 'at', lang());
  }

  // ---------------------------------------------------------------- drawing
  const ib = (name, label, onClick, cls = '') => h('button', { class: ['ou-icon-btn', cls], title: label, 'aria-label': label, html: icon(name, 22), onClick });
  function drawBar() {
    if (selecting) {
      const list = shown(), all = list.length && list.every((b) => picked.has(b.id));
      const box = h('label', { class: 'cv-all' }, h('input', { type: 'checkbox', checked: !!all, onChange: (e) => { picked = e.target.checked ? new Set(list.map((b) => b.id)) : new Set(); drawMain(); } }), h('span', { class: 'cv-check' }), h('small', null, t('canvas.all')));
      bar.replaceChildren(box, h('div', { class: 'cv-bar-sel' }, picked.size ? t('canvas.nSelected', { n: picked.size }) : t('canvas.selectBoards')), h('span', { class: 'cv-sp' }), h('button', { class: 'ou-btn', onClick: () => setSelecting(false) }, t('common.cancel')));
      return;
    }
    if (query != null) {
      // the search field stays in place while you type (moving it would take the keyboard away)
      if (bar.contains(searchIn)) return;
      bar.replaceChildren(ib('back', t('common.back'), () => endSearch()), h('label', { class: 'ou-searchbox cv-search' }, h('span', { html: icon('search', 20) }), searchIn));
      return;
    }
    bar.replaceChildren(ib('cv-menu', t('canvas.menu'), () => toggleNav(), 'cv-nav-btn'), barTitle, h('span', { class: 'cv-sp' }),
      ib('search', t('common.search'), () => startSearch()), ib('more', t('common.more'), (e) => viewMenu(e.currentTarget)));
  }
  function drawNav() {
    const list = BD.all();
    for (const row of $$('.cv-nav-row', nav)) {
      const v = row.dataset.view, n = list.filter((b) => inView(b, v)).length;
      row.classList.toggle('on', v === view && query == null);
      $('.cv-nav-n', row).textContent = n ? String(n) : '';
    }
  }
  function card(b) {
    const left = b.deleted && M.daysLeft(b), date = left ? (left === 1 ? t('canvas.dayLeft') : t('canvas.daysLeft', { n: left })) : boardDate(prefs().sort === 'created' ? b.created : b.at);
    const on = picked.has(b.id), name = b.name || t('canvas.untitled');
    const el = h('div', { class: ['cv-card', on && 'picked'], role: 'listitem', tabindex: '0', 'aria-label': name, dataset: { id: b.id } },
      h('div', { class: 'cv-thumb' }, h('span', { class: 'cv-th-ph', html: icon('cv-board', 34) }), h('img', { alt: '', dataset: { th: b.id } }),
        b.fav && !b.deleted ? h('span', { class: 'cv-fav', html: icon('starFill', 16) }) : null,
        selecting ? h('span', { class: ['cv-pick', on && 'on'], html: on ? icon('check', 16) : '' }) : null),
      h('div', { class: 'cv-meta' }, h('div', { class: 'cv-name' }, h('bdi', null, name)), h('div', { class: 'cv-date' }, date)));
    onLongPress(el, () => { if (!selecting) { setSelecting(true); picked.add(b.id); drawMain(); } });
    return el;
  }
  function empty() {
    if (query?.trim()) return h('div', { class: 'ou-empty cv-empty' }, h('span', { html: icon('search', 56) }), t('canvas.noResults'));
    const E = { all: ['cv-board', t('canvas.noBoards'), t('canvas.noBoardsSub')], favs: ['star', t('canvas.noFavs'), t('canvas.noFavsSub')], bin: ['trash', t('canvas.binEmpty'), t('canvas.binEmptySub')] }[view];
    return h('div', { class: 'ou-empty cv-empty' }, h('span', { html: icon(E[0], 56) }), E[1], h('small', null, E[2]));
  }
  function drawMain() {
    const list = shown(), q = query?.trim();
    heroTitle.textContent = query != null ? t('common.search') : viewName(view);
    barTitle.textContent = heroTitle.textContent;
    heroSub.textContent = list.length ? countText(list.length) : '';
    binNote.hidden = view !== 'bin' || query != null || !list.length;
    grid.className = 'cv-grid ' + (prefs().layout === 'list' ? 'list' : 'cards');
    grid.replaceChildren(...(list.length ? list.map(card) : query != null && !q ? [] : [empty()]));
    root.classList.toggle('selecting', selecting);
    fab.hidden = view === 'bin' || selecting || query != null;
    drawBar(); drawSelbar(); drawNav();
    hydrate(list);
  }
  function drawSelbar() {
    selbar.hidden = !selecting;
    if (!selecting) return;
    const n = picked.size, act = (ic, label, fn, cls) => h('button', { class: ['cv-sbtn', cls], disabled: !n, onClick: fn }, h('span', { html: icon(ic, 22) }), h('span', null, label));
    const ids = () => [...picked];
    if (view === 'bin' && query == null) selbar.replaceChildren(act('cv-restore', t('canvas.restore'), () => { ids().forEach(BD.restore); toast(t('canvas.restored')); setSelecting(false); }), act('trash', t('canvas.deleteForever'), () => eraseForGood(ids()).then((ok) => ok && setSelecting(false)), 'danger'));
    else {
      const allFav = ids().length && ids().every((id) => BD.byId(id)?.fav);
      selbar.replaceChildren(
        act(allFav ? 'star' : 'starFill', allFav ? t('canvas.unfavorite') : t('canvas.favorite'), () => { ids().forEach((id) => BD.update(id, () => ({ fav: allFav ? undefined : true }))); setSelecting(false); }),
        act('copy', t('canvas.duplicate'), async () => { for (const id of ids()) await dup(id, true); toast(t('canvas.duplicated')); setSelecting(false); }),
        act('trash', t('common.delete'), () => { ids().forEach(BD.trash); toast(t('canvas.movedToBin')); setSelecting(false); }, 'danger'));
    }
  }
  const missing = new Set();
  function hydrate(list) {
    for (const b of list) {
      const img = grid.querySelector(`img[data-th="${CSS.escape(b.id)}"]`);
      if (!img) continue;
      const id = b.thumb?.[theme()];
      if (id) blobUrl(id).then((u) => { if (u && img.isConnected) { img.src = u; img.classList.add('on'); } }).catch(() => {});
      else if (b.items.length && !missing.has(b.id)) {
        missing.add(b.id);
        import('./export.js').then((m) => m.makeThumbs(b)).then((thumb) => BD.update(b.id, () => ({ thumb }))).catch(() => {});
      }
    }
  }
  const drawAll = () => { if (!boardOpen) drawMain(); };
  const drawSoon = debounce(drawAll, 60);

  // ---------------------------------------------------------------- boards
  function openB(id) {
    const b = BD.byId(id);
    if (!b) return;
    if (b.deleted) { toast(t('canvas.restoreToEdit'), { action: t('canvas.restore'), onAction: () => BD.restore(id) }); return; }
    if (ctx.depth > 1) ctx.pop();
    setSelecting(false, false);
    toggleNav(false);
    boardOpen = id;
    ctx.push({
      title: b.name || t('canvas.untitled'), hero: false, className: 'cv-board-page',
      render: (body, page) => {
        body.classList.add('flush');
        const ed = openBoard(body, id, { page, onBack: () => { if (ctx.depth > 1) ctx.pop(); } });
        return () => ed?.close();
      },
    });
  }
  function newBoard(name) {
    const b = M.newBoard((name || '').trim() || M.freshName(BD.all(), t('canvas.untitled')));
    BD.put(b);
    if (view !== 'all') setView('all');
    openB(b.id);
  }
  async function rename(id) {
    const b = BD.byId(id);
    if (!b) return;
    const n = (await prompt(t('canvas.rename'), { value: b.name, placeholder: t('canvas.boardName') }))?.trim();
    if (n) BD.update(id, () => ({ name: n }));
  }
  async function dup(id, quiet) {
    const b = BD.byId(id);
    if (!b) return;
    await BD.duplicate(id, M.freshName(BD.all(), t('canvas.copyName', { name: b.name || t('canvas.untitled') })));
    if (!quiet) toast(t('canvas.duplicated'));
  }
  async function eraseForGood(ids) {
    const one = ids.length === 1 ? BD.byId(ids[0]) : null;
    const ok = await confirm(one ? t('canvas.eraseOneQ', { name: one.name || t('canvas.untitled') }) : t('canvas.eraseNQ', { n: ids.length }), t('canvas.eraseMsg'), { okLabel: t('common.delete'), danger: true });
    if (ok) BD.destroy(ids);
    return ok;
  }
  function boardMenu(id, at) {
    const b = BD.byId(id);
    if (!b) return;
    menu(at, b.deleted ? [
      { label: t('canvas.restore'), icon: 'cv-restore', onClick: () => { BD.restore(id); toast(t('canvas.restored')); } },
      { label: t('canvas.deleteForever'), icon: 'trash', danger: true, onClick: () => eraseForGood([id]) },
    ] : [
      { label: t('common.open'), icon: 'cv-board', onClick: () => openB(id) },
      { label: b.fav ? t('canvas.unfavorite') : t('canvas.favorite'), icon: b.fav ? 'starFill' : 'star', onClick: () => BD.update(id, (x) => ({ fav: !x.fav || undefined })) },
      { label: t('canvas.rename'), icon: 'edit', onClick: () => rename(id) },
      { label: t('canvas.duplicate'), icon: 'copy', onClick: () => dup(id) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => { BD.trash(id); toast(t('canvas.movedToBin'), { action: t('common.undo'), onAction: () => BD.restore(id) }); } },
    ]);
  }
  function viewMenu(anchor) {
    const p = prefs(), n = shown().length;
    menu(anchor, view === 'bin' ? [
      n && { label: t('canvas.edit'), icon: 'checkCircle', onClick: () => setSelecting(true) },
      n && { label: t('canvas.emptyBin'), icon: 'trash', danger: true, onClick: () => eraseForGood(shown().map((b) => b.id)) },
      !n && { label: t('canvas.binEmpty'), disabled: true },
    ].filter(Boolean) : [
      n && { label: t('canvas.edit'), icon: 'checkCircle', onClick: () => setSelecting(true) },
      { label: t('canvas.sortBy'), icon: 'sort', onClick: async () => {
        const v = await choose(t('canvas.sortBy'), [{ value: 'at', label: t('canvas.sortModified') }, { value: 'created', label: t('canvas.sortCreated') }, { value: 'name', label: t('canvas.sortTitle') }], p.sort || 'at');
        if (v) setPref('sort', v);
      } },
      '-',
      { label: t('canvas.viewGrid'), icon: 'widgets', checked: p.layout !== 'list', onClick: () => setPref('layout', 'grid') },
      { label: t('canvas.viewList'), icon: 'list', checked: p.layout === 'list', onClick: () => setPref('layout', 'list') },
    ].filter(Boolean), { align: 'end' });
  }
  function setView(v) {
    view = v; setPref('view', v);
    query = null; searchIn.value = '';
    setSelecting(false, false);
    toggleNav(false);
    scroll.scrollTop = 0;
    drawAll();
  }
  function setSelecting(on, draw = true) {
    selecting = on; picked = new Set();
    if (draw) drawMain();
  }
  function startSearch() {
    query = ''; selecting = false;
    drawMain();
    setTimeout(() => searchIn.focus(), 30);
  }
  function endSearch() { query = null; searchIn.value = ''; drawMain(); }
  searchIn.addEventListener('input', () => { query = searchIn.value; drawMain(); });
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endSearch(); } });

  // ---------------------------------------------------------------- layout
  const cols = () => +root.dataset.cols;
  function toggleNav(show = !root.classList.contains('nav-open')) {
    root.classList.toggle('nav-open', show && cols() === 1);
    scrim.hidden = !(show && cols() === 1);
  }
  const ro = new ResizeObserver(() => {
    const c = root.clientWidth >= 760 ? 2 : 1;
    if (String(c) === root.dataset.cols) return;
    root.dataset.cols = String(c);
    toggleNav(false);
  });
  ro.observe(root);
  scroll.addEventListener('scroll', () => {
    const p = Math.min(1, scroll.scrollTop / 90);
    root.style.setProperty('--collapse', p.toFixed(3));
    bar.classList.toggle('scrolled', scroll.scrollTop > 70);
  }, { passive: true });

  // ---------------------------------------------------------------- events
  nav.addEventListener('click', (e) => { const r = e.target.closest('[data-view]'); if (r) setView(r.dataset.view); });
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (!c) return;
    if (selecting) { picked.has(c.dataset.id) ? picked.delete(c.dataset.id) : picked.add(c.dataset.id); drawMain(); return; }
    openB(c.dataset.id);
  });
  grid.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('[data-id]');
    if (!c || selecting) return;
    e.preventDefault();
    boardMenu(c.dataset.id, { clientX: e.clientX, clientY: e.clientY });
  });
  grid.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('[data-id]');
    if (!c) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const b = BD.byId(c.dataset.id);
      if (b?.deleted) eraseForGood([b.id]);
      else if (b) { BD.trash(b.id); toast(t('canvas.movedToBin'), { action: t('common.undo'), onAction: () => BD.restore(b.id) }); }
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); boardMenu(c.dataset.id, c); }
  });
  const onKey = (e) => {
    // other windows stay open beside this one: only the focused Canvas window takes keys
    if (boardOpen || !root.isConnected || ctx.depth > 1 || currentApp() !== 'canvas' || document.querySelector('.ou-dialog-scrim, .ou-menu-scrim, .cv-pop')) return;
    if (e.key === 'Escape' && (selecting || root.classList.contains('nav-open'))) { e.preventDefault(); e.stopPropagation(); if (selecting) setSelecting(false); else toggleNav(false); return; }
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod && !e.altKey && e.code === 'KeyN' && view !== 'bin') { e.preventDefault(); newBoard(); }
    else if (mod && e.code === 'KeyF') { e.preventDefault(); startSearch(); }
  };
  addEventListener('keydown', onKey, true);
  const offs = [store.on(BD.KEY, () => drawSoon()), store.on('canvasPrefs', () => drawSoon())];
  const mo = new MutationObserver(() => drawSoon());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- start
  BD.tidy();
  BD.sweep();
  function open(p = {}) {
    const m = /^board:(.+)$/.exec(p.section || '');
    if (m && BD.byId(m[1])) { if (boardOpen !== m[1]) openB(m[1]); return; }
    if (p.action === 'new') { newBoard(p.name); return; }
    if (p.id && BD.byId(p.id)) openB(p.id);
  }
  ctx.setParams = (p) => open(p || {});
  drawMain();
  open(ctx.params || {});

  return () => {
    ro.disconnect(); mo.disconnect(); offs.forEach((f) => f());
    removeEventListener('keydown', onKey, true);
  };
}
