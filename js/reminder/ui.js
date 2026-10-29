// Samsung Reminder (One UI): the main page (Today / Scheduled / All / Completed tiles and My categories), a page per
// tile or category (grouped by day, by category or by aisle; custom order by dragging, also into another category
// in All), selection mode, search, and the "Write a reminder" bar that reads dates, repeats, #category and ! while
// you type and highlights what it understood. The detail screen is js/reminder/editor.js.
import { h, escapeHtml, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { toast, menu, dialog, choose, iconBtn, swatches } from '../core/ui.js';
import { listBlobs, delBlob } from '../core/blobs.js';
import * as M from './model.js';
import * as D from './data.js';
import { parseQuickTime } from './parse.js';
import { fmtDue, dayLabel, repeatText, catName } from './format.js';
import { aisleOf, AISLES } from './grocery.js';
import { checkbox, catBadge } from './kit.js';
import { openEditor, pendingImages } from './editor.js';
import './strings.js';

const TILES = {
  today: { icon: 'calendar', color: '#3e7bff' },
  scheduled: { icon: 'clock', color: '#ff6a3d' },
  all: { icon: 'list', color: '#5c5f6a' },
  completed: { icon: 'check', color: '#22a356' },
};
const isSmart = (v) => M.VIEWS.includes(v);
const viewName = (v, cs = D.cats()) => (isSmart(v) ? t('rem.' + v) : catName(cs.list.find((c) => c.id === v)));
const viewColor = (v, cs = D.cats()) => (isSmart(v) ? TILES[v].color : cs.list.find((c) => c.id === v)?.color || TILES.all.color);
/** Re-runs draw when the data changes, and every minute (overdue colours, "Today"). */
function watch(draw) {
  const offs = [store.on(M.KEY, draw), store.on(M.CAT_KEY, draw)];
  const tick = setInterval(draw, 60e3);
  return () => {
    offs.forEach((f) => f());
    clearInterval(tick);
  };
}

export function render(ctx) {
  const app = { ctx };
  app.openEditor = (id, opts) => openEditor(app, id, opts);
  app.openList = (view) => openList(app, view);
  home(app);
  ctx.setParams = (p) => {
    const id = p?.id || p?.section;
    if (id && D.find(id)) app.openEditor(id);
    else if (p?.view) app.openList(p.view);
    else if (p?.new) app.focusAdd?.();
  };
  ctx.setParams(ctx.params);
  const gc = setTimeout(gcImages, 3000);
  return () => clearTimeout(gc);
}

/** Pictures of reminders that no longer exist (deleted ones, after their Undo) leave IndexedDB. */
async function gcImages() {
  try {
    const used = new Set(D.list().flatMap((r) => r.imgs || []).map((x) => 'reminder:' + x));
    for (const k of await listBlobs('reminder:')) if (!used.has(k) && !pendingImages.has(k)) await delBlob(k);
  } catch (e) {
    console.error('reminder images', e);
  }
}

// ———————————————————————————————————————————————————————— main page
function home(app) {
  const { ctx } = app;
  ctx.page({
    title: t('app.reminder'),
    className: 'rem-page rem-home-page',
    actions: [
      iconBtn('search', () => openSearch(app), t('common.search')),
      iconBtn('more', (e) => menu(e.currentTarget, [
        { label: t('rem.editCats'), icon: 'edit', onClick: () => openCatsEditor(app) },
        { label: t('rem.addCat'), icon: 'plus', onClick: () => newCategory() },
      ], { align: 'end' }), t('common.more')),
    ],
    render(body, page) {
      body.classList.add('rem-body');
      const tiles = h('div', { class: 'rem-cats' });
      const mine = h('div', { class: 'ou-card ou-list rem-mycats' });
      body.append(tiles, h('div', { class: 'ou-subheader rem-subhead' }, t('rem.myCats')), mine);
      const bar = quickAdd(app, page, null);
      app.focusAdd = () => bar.focus();
      const draw = () => {
        const all = D.list(), cs = D.cats(), now = Date.now();
        const n = M.count(cs, all, 'today', now);
        page.setSubtitle(n ? t('rem.summary', { n }) : t('rem.summaryNone'));
        tiles.replaceChildren(...M.VIEWS.map((v) => h('button', { class: 'rem-cat', style: { '--c': TILES[v].color }, dataset: { view: v }, onClick: () => app.openList(v) },
          h('span', { class: 'rem-cat-ico', html: icon(TILES[v].icon, 20) }),
          h('span', { class: 'rem-cat-count' }, String(M.count(cs, all, v, now))),
          h('span', { class: 'rem-cat-label' }, t('rem.' + v)))));
        mine.replaceChildren(
          ...cs.list.map((c) => {
            const el = h('button', { class: 'ou-row clickable rem-catrow', dataset: { cat: c.id }, onClick: () => app.openList(c.id) },
              catBadge(c, 18),
              h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, catName(c))),
              h('span', { class: 'rem-catrow-n' }, String(M.count(cs, all, c.id, now))));
            const more = (e) => catMenu(app, c, e);
            el.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              more(e);
            });
            onLongPress(el, (e) => more(e));
            return el;
          }),
          h('button', { class: 'ou-row clickable rem-catrow rem-addcat', onClick: () => newCategory() },
            h('span', { class: 'rem-badge add', html: icon('plus', 18) }),
            h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('rem.addCat')))));
      };
      draw();
      const off = watch(draw);
      setTimeout(() => !ctx.params?.id && !ctx.params?.section && bar.focus(), 50);
      return () => {
        off();
        app.focusAdd = null;
      };
    },
  });
}

function catMenu(app, c, at) {
  menu(at, [
    { label: t('common.open'), icon: 'list', onClick: () => app.openList(c.id) },
    { label: t('rem.editCat'), icon: 'edit', onClick: () => editCategory(c) },
    c.id !== M.DEF_CAT && '-',
    c.id !== M.DEF_CAT && { label: t('rem.deleteCat'), icon: 'trash', danger: true, onClick: () => deleteCategory(c) },
  ].filter(Boolean));
}

// ——— categories ———
/** The category dialog (name, colour, icon); resolves the fields or null. */
export async function catDialog(c = null) {
  let color = c?.color || M.COLORS[(D.cats().list.length) % M.COLORS.length], ic = c?.icon || 'list';
  const name = h('input', { class: 'ou-input rem-catname', placeholder: t('rem.catName'), value: c ? catName(c) : '', maxlength: 60 });
  const icons = h('div', { class: 'rem-icons' });
  const drawIcons = () => icons.replaceChildren(...M.CAT_ICONS.map((x) => h('button', {
    class: ['rem-iconpick', x === ic && 'active'], style: { '--c': color }, 'aria-label': x, html: icon(x, 20),
    onClick: () => { ic = x; drawIcons(); },
  })));
  drawIcons();
  const sw = swatches(M.COLORS, color, (v) => { color = v; drawIcons(); });
  const v = await dialog({
    title: c ? t('rem.editCat') : t('rem.addCat'),
    content: h('div', { class: 'ou-dialog-body rem-catdlg' }, name, sw, icons),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: () => name.value.trim(), validate: () => !!name.value.trim() || (name.focus(), false) }],
  });
  if (v == null) return null;
  // the default category keeps its translated name until it really changes
  return { name: c?.id === M.DEF_CAT && v === catName(c) ? c.name || '' : v, color, icon: ic };
}
async function newCategory() {
  const f = await catDialog();
  if (f) D.addCat(f);
}
async function editCategory(c) {
  const f = await catDialog(c);
  if (f) D.patchCat(c.id, f);
}
function deleteCategory(c, after) {
  const n = D.list().filter((r) => r.cat === c.id).length;
  dialog({
    title: t('rem.deleteCatQ', { name: catName(c) }),
    message: n ? t('rem.deleteCatMsg', { n }) : null,
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.delete'), value: true, danger: true }],
  }).then((ok) => {
    if (!ok) return;
    const undo = D.removeCat(c.id);
    after?.();
    toast(t('rem.catDeleted'), { action: t('common.undo'), onAction: undo });
  });
}

/** Edit categories: reorder by dragging, rename/recolour, delete. */
function openCatsEditor(app) {
  app.ctx.push({
    title: t('rem.editCats'),
    hero: false,
    className: 'rem-page rem-cats-page',
    render(body, page) {
      body.classList.add('rem-body');
      const card = h('div', { class: 'ou-card ou-list rem-catedit' });
      body.append(card, h('button', { class: 'ou-btn rem-addcat-btn', onClick: () => newCategory() }, h('span', { html: icon('plus', 18) }), t('rem.addCat')));
      const draw = () => card.replaceChildren(...D.cats().list.map((c) => h('div', { class: 'ou-row rem-item sortable rem-catedit-row', dataset: { id: c.id } },
        catBadge(c, 18),
        h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, catName(c))),
        iconBtn('edit', () => editCategory(c), t('rem.editCat')),
        c.id === M.DEF_CAT ? h('span', { class: 'rem-catedit-gap' }) : iconBtn('trash', () => deleteCategory(c), t('rem.deleteCat')),
        h('span', { class: 'rem-grip', title: t('rem.drag'), html: icon('rmGrip', 20) }))));
      draw();
      sortable(body, page.scrollEl, (id, _group, prevId) => {
        D.setCats((v) => {
          const list = v.list.filter((c) => c.id !== id), me = v.list.find((c) => c.id === id);
          list.splice(prevId ? list.findIndex((c) => c.id === prevId) + 1 : 0, 0, me);
          return { ...v, list };
        });
      });
      return watch(draw);
    },
  });
}

// ———————————————————————————————————————————————————————— list pages
function openList(app, view) {
  const cs = D.cats();
  if (!isSmart(view) && !cs.list.some((c) => c.id === view)) return;
  app.ctx.push({ title: viewName(view, cs), className: 'rem-page rem-list-page', render: (body, page) => listView(app, page, view) });
}

const AISLE_KEYS = Object.fromEntries(AISLES.map((a) => [a, 'rem.aisle.' + a]));

/** The groups a view shows: [{ key, title, color?, cat?, items, sortable, done? }]. */
function groupsOf(view, all, cs, now) {
  const by = (pred) => all.filter(pred);
  const start = M.startOfDay(now);
  if (view === 'today') {
    const items = M.sortBy(by((r) => M.isToday(r, now)), 'due');
    return [
      { key: 'overdue', title: t('rem.overdue'), overdue: true, items: items.filter((r) => r.due < start) },
      { key: 'today', title: t('common.today'), items: items.filter((r) => r.due >= start) },
    ];
  }
  if (view === 'scheduled') {
    const items = M.sortBy(by(M.FILTERS.scheduled), 'due');
    const groups = [{ key: 'overdue', title: t('rem.overdue'), overdue: true, items: items.filter((r) => r.due < start) }];
    for (const r of items.filter((x) => x.due >= start)) {
      const k = String(M.startOfDay(r.due));
      if (groups.at(-1).key !== k) groups.push({ key: k, title: dayLabel(r.due), items: [] });
      groups.at(-1).items.push(r);
    }
    return groups;
  }
  if (view === 'completed') {
    const items = by((r) => r.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    const groups = [];
    for (const r of items) {
      const k = String(M.startOfDay(r.completedAt || 0));
      if (groups.at(-1)?.key !== k) groups.push({ key: k, title: r.completedAt ? dayLabel(r.completedAt) : t('rem.completed'), items: [] });
      groups.at(-1).items.push(r);
    }
    return groups;
  }
  if (view === 'all') {
    return cs.list.map((c) => {
      const sort = c.sort === 'aisle' ? 'manual' : c.sort || 'manual';
      return { key: c.id, cat: c, title: catName(c), color: c.color, sortable: sort === 'manual', items: M.sortBy(by((r) => !r.done && M.catIdOf(cs, r) === c.id), sort) };
    });
  }
  const c = cs.list.find((x) => x.id === view);
  const open = by((r) => !r.done && M.catIdOf(cs, r) === view);
  const done = c.showDone ? by((r) => r.done && M.catIdOf(cs, r) === view).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)) : [];
  let groups;
  if (c.sort === 'aisle') {
    const map = new Map();
    for (const r of M.sortBy(open, 'manual')) {
      const a = aisleOf(r.title) || 'other';
      if (!map.has(a)) map.set(a, []);
      map.get(a).push(r);
    }
    groups = [...AISLES, 'other'].filter((a) => map.has(a)).map((a) => ({ key: 'aisle:' + a, title: a === 'other' ? t('rem.aisle.other') : t(AISLE_KEYS[a]), items: map.get(a) }));
  } else groups = [{ key: c.id, cat: c, items: M.sortBy(open, c.sort || 'manual'), sortable: (c.sort || 'manual') === 'manual' }];
  if (done.length) groups.push({ key: 'done', title: t('rem.completedN', { n: done.length }), done: true, items: done });
  return groups;
}

function listView(app, page, view) {
  const { ctx } = app;
  const body = page.body;
  body.classList.add('rem-body');
  const box = h('div', { class: 'rem-groups' });
  body.append(box);
  const bar = view === 'completed' ? null : quickAdd(app, page, view);
  let sel = null; // Set of selected ids in selection mode
  let shown = [];
  const selBar = h('div', { class: 'rem-selbar', hidden: true });
  page.el.append(selBar);

  const moreBtn = iconBtn('more', (e) => listMenu(e.currentTarget), t('common.more'));
  const allBtn = h('button', { class: 'rem-allchk', onClick: () => { sel = sel.size === shown.length ? new Set() : new Set(shown.map((r) => r.id)); draw(); } },
    h('span', { class: 'rem-selchk', html: icon('check', 14) }), h('span', null, t('rem.all')));
  const closeSel = iconBtn('close', () => setSelect(false), t('common.cancel'));

  function setSelect(on, id) {
    sel = on ? new Set(id ? [id] : []) : null;
    draw();
  }

  function listMenu(at) {
    const cs = D.cats(), c = cs.list.find((x) => x.id === view);
    const items = [{ label: t('rem.select'), icon: 'rmSelect', onClick: () => setSelect(true) }];
    if (c) {
      items.push({ label: t('rem.sortBy'), icon: 'sort', onClick: () => pickSort(c) });
      items.push({ label: c.showDone ? t('rem.hideDone') : t('rem.showDone'), icon: 'checkCircle', onClick: () => D.patchCat(c.id, { showDone: !c.showDone }) });
      items.push('-', { label: t('rem.editCat'), icon: 'edit', onClick: () => editCategory(c) });
      if (c.id !== M.DEF_CAT) items.push({ label: t('rem.deleteCat'), icon: 'trash', danger: true, onClick: () => deleteCategory(c, () => ctx.pop()) });
    }
    if (view === 'completed' && D.list().some((r) => r.done)) {
      items.push('-', { label: t('rem.deleteCompleted'), icon: 'trash', danger: true, onClick: deleteAllDone });
    }
    menu(at, items, { align: 'end' });
  }

  async function pickSort(c) {
    const v = await choose(t('rem.sortBy'), M.SORTS.map((s) => ({ value: s, label: t('rem.sort.' + s), sub: s === 'aisle' ? t('rem.sort.aisleSub') : null })), c.sort || 'manual');
    if (v) D.patchCat(c.id, { sort: v });
  }

  async function deleteAllDone() {
    const ids = D.list().filter((r) => r.done).map((r) => r.id);
    const ok = await dialog({
      title: t('rem.deleteCompletedQ'),
      actions: [{ label: t('common.cancel'), value: false }, { label: t('common.delete'), value: true, danger: true }],
    });
    if (!ok) return;
    const undo = D.removeMany(ids);
    toast(t('rem.deletedN', { n: ids.length }), { action: t('common.undo'), onAction: undo });
  }

  // ——— selection bar ———
  function drawSelBar() {
    const ids = [...sel];
    const items = ids.map(D.find).filter(Boolean);
    const allDone = items.length && items.every((r) => r.done);
    const allImp = items.length && items.every((r) => r.priority);
    const b = (ic, label, fn, disabled = !ids.length, danger = false) => h('button', { class: ['rem-selbtn', danger && 'danger'], disabled, onClick: fn }, h('span', { html: icon(ic, 22) }), h('span', null, label));
    selBar.replaceChildren(
      allDone
        ? b('refresh', t('rem.markUndone'), () => finish(D.setDoneMany(ids, false), t('rem.restoredN', { n: ids.length })))
        : b('checkCircle', t('rem.complete'), () => finish(D.setDoneMany(ids.filter((id) => !D.find(id)?.done), true), t('rem.completedToastN', { n: ids.length }))),
      b(allImp ? 'star' : 'starFill', allImp ? t('rem.notImportant') : t('rem.important'), () => finish(D.patchMany(ids, { priority: !allImp }))),
      b('rmFolder', t('rem.move'), async () => {
        const to = await pickCategory();
        if (to) finish(D.patchMany(ids, { cat: to }), t('rem.movedTo', { name: catName(D.cats().list.find((c) => c.id === to)) }));
      }),
      b('trash', t('common.delete'), () => finish(D.removeMany(ids), t('rem.deletedN', { n: ids.length })), !ids.length, true));
  }
  function finish(undo, msg) {
    setSelect(false);
    if (msg) toast(msg, { action: t('common.undo'), onAction: undo });
  }

  // ——— rows ———
  function rowOf(r, g, cs) {
    const el = itemRow(app, r, {
      cs,
      showCat: view === 'all' ? false : view !== r.cat && !(view === M.DEF_CAT && !r.cat) && (isSmart(view) || g.done),
      sortable: !sel && g.sortable,
      selecting: !!sel,
      selected: sel?.has(r.id),
      onSelect: () => {
        sel.has(r.id) ? sel.delete(r.id) : sel.add(r.id);
        draw();
      },
      onLong: () => !sel && setSelect(true, r.id),
    });
    return el;
  }

  function draw() {
    const cs = D.cats(), all = D.list(), now = Date.now();
    if (!isSmart(view) && !cs.list.some((c) => c.id === view)) return; // deleted (the page is popped)
    page.el.style.setProperty('--rc', viewColor(view, cs));
    const groups = groupsOf(view, all, cs, now);
    shown = groups.flatMap((g) => g.items);
    const open = view === 'completed' ? shown.length : shown.filter((r) => !r.done).length;
    if (sel) {
      for (const id of sel) if (!shown.some((r) => r.id === id)) sel.delete(id);
      page.setTitle(sel.size ? t('rem.nSelected', { n: sel.size }) : t('rem.select'));
      page.setActions([closeSel]);
      allBtn.classList.toggle('on', shown.length > 0 && sel.size === shown.length);
    } else {
      page.setTitle(viewName(view, cs));
      page.setActions([moreBtn]);
    }
    page.setSubtitle(open ? t('rem.nReminders', { n: open }) : '');
    page.el.classList.toggle('rem-selecting', !!sel);
    selBar.hidden = !sel;
    if (sel) drawSelBar();
    if (bar) bar.hidden = !!sel;
    const visible = groups.filter((g) => g.items.length || (view === 'all' && g.sortable !== undefined));
    if (!shown.length) {
      box.replaceChildren(...(sel ? [] : [h('div', { class: 'ou-empty rem-empty' }, h('span', { html: icon(view === 'completed' ? 'checkCircle' : 'bell', 56) }),
        t(view === 'today' ? 'rem.emptyToday' : view === 'completed' ? 'rem.emptyCompleted' : 'rem.empty'),
        view !== 'completed' ? h('small', null, t('rem.emptyHint')) : null)]));
      return;
    }
    box.replaceChildren(
      ...(sel ? [allBtn] : []),
      ...visible.map((g) => h('section', { class: ['rem-group', !g.items.length && 'empty', g.overdue && 'overdue', g.done && 'done'], dataset: { group: g.key } },
        g.title && (groups.length > 1 || view === 'all') ? h('div', { class: 'ou-subheader rem-ghead' },
          g.color ? h('span', { class: 'rem-gdot', style: { background: g.color } }) : null,
          h('span', null, g.title),
          h('span', { class: 'rem-gcount' }, String(g.items.length))) : null,
        h('div', { class: 'ou-card rem-card rem-glist', dataset: { group: g.key } }, g.items.map((r) => rowOf(r, g, cs))))));
  }

  sortable(box, page.scrollEl, (id, group, prevId, nextId) => {
    const r = D.find(id);
    if (!r) return;
    const prev = prevId && D.find(prevId), next = nextId && D.find(nextId);
    const fields = { order: M.between(prev ? M.ord(prev) : null, next ? M.ord(next) : null) };
    const to = view === 'all' ? group : view;
    const moved = to !== M.catIdOf(D.cats(), r);
    if (moved) fields.cat = to;
    const undo = D.change((l) => M.patchIn(l, id, fields));
    if (moved) toast(t('rem.movedTo', { name: catName(D.cats().list.find((c) => c.id === to)) }), { action: t('common.undo'), onAction: undo });
  });

  draw();
  const off = watch(draw);
  // Escape leaves selection mode before it closes the page
  const onKey = (e) => {
    if (e.key === 'Escape' && sel && ctx.focused) {
      e.preventDefault();
      e.stopPropagation();
      setSelect(false);
    }
  };
  page.el.addEventListener('keydown', onKey, true);
  return off;
}

/** The Move to… dialog: resolves a category id or null. */
export function pickCategory(current) {
  const cs = D.cats();
  return choose(t('rem.moveTo'), cs.list.map((c) => ({ value: c.id, label: catName(c) })), current ?? null);
}

// ——— one reminder row ———
const mark = (text, q) => {
  if (!q) return escapeHtml(text);
  const i = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  return i < 0 ? escapeHtml(text) : escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
};

export function itemRow(app, r, { cs = D.cats(), showCat = false, sortable: canSort = false, selecting = false, selected = false, onSelect, onLong, hl = '' } = {}) {
  const now = Date.now();
  const overdue = M.isOverdue(r, now);
  const c = M.catOf(cs, r);
  const subs = r.subs || [];
  const meta = [];
  if (r.due) meta.push(h('span', { class: ['rem-item-due', overdue && 'overdue'] }, fmtDue(r.due)));
  if (r.repeat) meta.push(h('span', { class: 'rem-mi', title: repeatText(r.repeat), html: icon('rmRepeat', 14) }));
  if (r.early && !r.done) meta.push(h('span', { class: 'rem-mi', html: icon('rmEarly', 14) }));
  if (subs.length) meta.push(h('span', { class: 'rem-mi' }, h('span', { html: icon('rmSub', 14) }), `⁦${subs.filter((s) => s.done).length}/${subs.length}⁩`));
  if (r.imgs?.length) meta.push(h('span', { class: 'rem-mi', html: icon('image', 14) }));
  if (r.url) meta.push(h('span', { class: 'rem-mi', html: icon('link', 14) }));
  if (showCat) meta.push(h('span', { class: 'rem-mi rem-item-cat' }, h('span', { class: 'rem-gdot', style: { background: c.color } }), catName(c)));
  let notes = String(r.notes || '').trim().split('\n')[0];
  // in search results, the line that matched (a subtask, a line of the notes, the link) when the title didn't
  if (hl) {
    const q = hl.toLocaleLowerCase(), has = (x) => String(x || '').toLocaleLowerCase().includes(q);
    if (!has(r.title) && !has(notes)) notes = [...String(r.notes || '').split('\n'), ...(r.subs || []).map((x) => x.title), r.url].find(has) || notes;
  }
  const el = h('div', { class: ['rem-item', 'clickable', r.done && 'done', canSort && 'sortable', selected && 'sel'], dataset: { id: r.id }, tabindex: 0 },
    selecting ? h('span', { class: 'rem-selchk', html: icon('check', 14) }) : checkbox(r, () => toggle(r, el)),
    h('div', { class: 'rem-item-text' },
      h('div', { class: 'rem-item-title', html: mark(r.title || t('common.untitled'), hl) }),
      meta.length ? h('div', { class: 'rem-item-meta' }, meta) : null,
      notes ? h('div', { class: 'rem-item-notes', html: mark(notes, hl) }) : null),
    r.priority && !selecting ? h('span', { class: 'rem-star', html: icon('starFill', 18) }) : null,
    canSort ? h('span', { class: 'rem-grip', title: t('rem.drag'), html: icon('rmGrip', 20) }) : null);
  const open = () => (selecting ? onSelect?.() : app.openEditor(r.id));
  el.addEventListener('click', (e) => !e.target.closest('.rem-grip') && open());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === el) open();
    if (e.key === ' ' && e.target === el && !selecting) {
      e.preventDefault();
      toggle(r, el);
    }
  });
  if (!selecting) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      rowMenu(app, r, e, onLong);
    });
    // a long press selects (One UI); not while the row is being dragged by its grip
    if (onLong) onLongPress(el, (e) => !el.classList.contains('dragging') && !e.target.closest?.('.rem-grip') && onLong());
  }
  return el;
}

function rowMenu(app, r, at, onSelect) {
  menu(at, [
    { label: r.done ? t('rem.markUndone') : t('rem.markDone'), icon: 'checkCircle', onClick: () => toggle(r) },
    !r.done && { label: t('rem.important'), icon: 'star', checked: r.priority, onClick: () => D.patch(r.id, { priority: !r.priority }) },
    { label: t('rem.moveTo'), icon: 'rmFolder', onClick: async () => {
      const to = await pickCategory(M.catIdOf(D.cats(), r));
      if (to && to !== M.catIdOf(D.cats(), r)) {
        const undo = D.patchMany([r.id], { cat: to });
        toast(t('rem.movedTo', { name: catName(D.cats().list.find((c) => c.id === to)) }), { action: t('common.undo'), onAction: undo });
      }
    } },
    onSelect && { label: t('rem.select'), icon: 'rmSelect', onClick: onSelect },
    '-',
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeWithUndo([r.id]) },
  ].filter(Boolean));
}

export function removeWithUndo(ids) {
  const undo = D.removeMany(ids);
  toast(ids.length === 1 ? t('rem.deleted') : t('rem.deletedN', { n: ids.length }), { action: t('common.undo'), onAction: undo });
}

/** Completes (or restores) with the check animation and an Undo toast. */
export function toggle(r, el) {
  const done = !r.done;
  const go = () => {
    const undo = D.setDone(r.id, done);
    const now = D.find(r.id);
    toast(done ? (r.repeat && now && !now.done ? t('rem.doneNext', { when: fmtDue(now.due) }) : t('rem.completedToast')) : t('rem.restored'), { action: t('common.undo'), onAction: undo });
  };
  if (!el) return go();
  el.classList.toggle('done', done);
  el.querySelector('.rem-check')?.classList.toggle('done', done);
  el.classList.add('anim');
  setTimeout(go, 380);
}

// ———————————————————————————————————————————————————————— drag to reorder
/**
 * Pointer dragging of `.rem-item.sortable` rows by their `.rem-grip` inside `root`, also from one `.rem-glist` group to
 * another (All: into another category). The row follows the pointer and the list makes room as it goes; on drop
 * onDrop(id, groupKey, prevId, nextId) gets the new neighbours in that group.
 */
function sortable(root, scrollEl, onDrop) {
  root.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.rem-grip');
    if (!grip || e.button !== 0) return;
    const row = grip.closest('.rem-item.sortable');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    const id = row.dataset.id;
    const startGroup = row.parentElement;
    const startNext = row.nextElementSibling;
    let lastY = e.clientY, raf = 0, moved = false;
    const grab = e.clientY - row.getBoundingClientRect().top;
    root.classList.add('rem-dragging');
    row.classList.add('dragging');
    row.setPointerCapture?.(e.pointerId);
    const place = () => {
      row.style.transform = '';
      const top = row.getBoundingClientRect().top;
      row.style.transform = `translateY(${lastY - grab - top}px)`;
    };
    const move = (ev) => {
      lastY = ev.clientY;
      moved = true;
      // the row (or the empty group) under the pointer, by vertical position
      const lists = [...root.querySelectorAll('.rem-glist, .rem-catedit')].filter((l) => l.offsetParent);
      let target = null;
      for (const l of lists) {
        const b = l.getBoundingClientRect();
        if (lastY >= b.top - 8 && lastY <= b.bottom + 8) target = l;
      }
      if (target) {
        const rows = [...target.querySelectorAll(':scope > .rem-item.sortable, :scope > .rem-item')].filter((x) => x !== row);
        const before = rows.find((x) => {
          const b = x.getBoundingClientRect();
          return lastY < b.top + b.height / 2;
        });
        if (before) {
          if (before.previousElementSibling !== row) target.insertBefore(row, before);
        } else if (target.lastElementChild !== row) target.appendChild(row);
      }
      place();
      // scroll near the edges
      const sb = scrollEl.getBoundingClientRect();
      cancelAnimationFrame(raf);
      const edge = lastY < sb.top + 60 ? -1 : lastY > sb.bottom - 90 ? 1 : 0;
      if (edge) {
        const tick = () => {
          scrollEl.scrollTop += edge * 8;
          place();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
    };
    const up = () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      row.style.transform = '';
      row.classList.remove('dragging');
      root.classList.remove('rem-dragging');
      const list = row.parentElement;
      if (!moved || (list === startGroup && row.nextElementSibling === startNext)) return;
      const sibs = [...list.children].filter((x) => x.classList.contains('rem-item'));
      const i = sibs.indexOf(row);
      onDrop(id, list.dataset.group, sibs[i - 1]?.dataset.id || null, sibs[i + 1]?.dataset.id || null);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// ———————————————————————————————————————————————————————— search
function openSearch(app) {
  app.ctx.push({
    title: t('common.search'),
    hero: false,
    className: 'rem-page rem-search-page',
    render(body, page) {
      body.classList.add('rem-body');
      const input = h('input', { type: 'search', class: 'rem-search-input', placeholder: t('rem.searchPh'), 'aria-label': t('common.search'), dir: 'auto' });
      const boxEl = h('div', { class: 'ou-searchbox rem-searchbox' }, h('span', { html: icon('search', 20) }), input);
      const out = h('div', { class: 'rem-groups' });
      body.append(boxEl, out);
      const draw = () => {
        const q = input.value.trim().toLocaleLowerCase();
        if (!q) {
          out.replaceChildren(h('div', { class: 'ou-empty rem-empty' }, h('span', { html: icon('search', 56) }), t('rem.searchHint')));
          return;
        }
        const cs = D.cats();
        const hit = (r) => [r.title, r.notes, r.url, ...(r.subs || []).map((s) => s.title)].some((x) => String(x || '').toLocaleLowerCase().includes(q));
        const found = D.list().filter(hit);
        const open = found.filter((r) => !r.done).sort(M.bySmart), done = found.filter((r) => r.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        if (!found.length) {
          out.replaceChildren(h('div', { class: 'ou-empty rem-empty' }, h('span', { html: icon('search', 56) }), t('rem.noResults')));
          return;
        }
        const group = (title, items) => (items.length ? h('section', { class: 'rem-group' }, h('div', { class: 'ou-subheader rem-ghead' }, h('span', null, title), h('span', { class: 'rem-gcount' }, String(items.length))),
          h('div', { class: 'ou-card rem-card' }, items.map((r) => itemRow(app, r, { cs, showCat: true, hl: input.value.trim() })))) : null);
        out.replaceChildren(...[group(t('rem.all'), open), group(t('rem.completed'), done)].filter(Boolean));
      };
      input.addEventListener('input', draw);
      draw();
      setTimeout(() => input.focus(), 60);
      return watch(draw);
    },
  });
}

// ———————————————————————————————————————————————————————— Write a reminder
/** Default due for a reminder added in Today / Scheduled without a time: the next full hour today (or tomorrow 9:00). */
function defaultDue() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  if (d.getHours() === 0) d.setHours(9);
  return d.getTime();
}

function quickAdd(app, page, view) {
  const input = h('input', { class: 'rem-add-input', placeholder: t('rem.write'), 'aria-label': t('rem.write'), autocomplete: 'off', enterkeyhint: 'done', dir: 'auto' });
  const mirror = h('div', { class: 'rem-add-mirror', 'aria-hidden': 'true', dir: 'auto' });
  const chip = h('span', { class: 'rem-add-chip', hidden: true });
  const extra = h('span', { class: 'rem-add-extra' });
  const addBtn = h('button', { class: 'rem-add-btn', type: 'submit', html: icon('arrowUp', 20), title: t('common.add'), 'aria-label': t('common.add'), disabled: true });
  const more = h('button', { class: 'rem-add-more', type: 'button', html: icon('edit', 18), title: t('rem.details'), 'aria-label': t('rem.details') });
  const bar = h('form', { class: 'rem-addbar' },
    h('span', { class: 'rem-add-plus', html: icon('plus', 22) }),
    h('div', { class: 'rem-add-field' }, h('div', { class: 'rem-add-line' }, mirror, input), h('div', { class: 'rem-add-chips' }, chip, extra)),
    more, addBtn);
  page.el.appendChild(bar);
  const catDefault = () => (view && !isSmart(view) ? view : null);
  const parse = (v) => parseQuickTime(v, new Date(), { cats: D.cats().list });
  const paint = () => {
    const v = input.value;
    addBtn.disabled = !v.trim();
    bar.classList.toggle('typing', !!v);
    const p = v.trim() ? parse(v) : { due: null, spans: [] };
    // the recognised words, highlighted behind the transparent text of the field
    let html = '', at = 0;
    for (const [a, b, k] of p.spans) {
      if (k === 'lead' || a < at) continue;
      html += escapeHtml(v.slice(at, a)) + `<mark class="k-${k}">${escapeHtml(v.slice(a, b))}</mark>`;
      at = b;
    }
    mirror.innerHTML = html + escapeHtml(v.slice(at)) + ' ';
    mirror.scrollLeft = input.scrollLeft;
    chip.hidden = !p.due;
    if (p.due) chip.innerHTML = icon('alarm', 14) + `<span>${escapeHtml(fmtDue(p.due))}</span>`;
    const cs = D.cats();
    const c = p.cat && cs.list.find((x) => x.id === p.cat);
    extra.replaceChildren(
      p.repeat ? h('span', { class: 'rem-add-tag' }, h('span', { html: icon('rmRepeat', 13) }), repeatText(p.repeat)) : '',
      c ? h('span', { class: 'rem-add-tag cat', style: { '--c': c.color } }, h('span', { class: 'rem-gdot', style: { background: c.color } }), catName(c)) : '',
      p.important ? h('span', { class: 'rem-add-tag imp', html: icon('starFill', 13) }) : '');
  };
  const fieldsOf = (v) => {
    const p = parse(v);
    const f = { title: p.title || v, due: p.due, priority: !!p.important };
    if (p.repeat) f.repeat = p.repeat;
    const cat = p.cat || catDefault();
    if (cat) f.cat = cat;
    if (!f.due && (view === 'today' || view === 'scheduled')) f.due = defaultDue();
    return f;
  };
  input.addEventListener('input', paint);
  input.addEventListener('scroll', () => (mirror.scrollLeft = input.scrollLeft));
  input.addEventListener('keyup', () => (mirror.scrollLeft = input.scrollLeft));
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    const r = D.addReminder(fieldsOf(v));
    input.value = '';
    paint();
    if (!view) {
      const c = M.catOf(D.cats(), r);
      toast(r.due ? t('rem.addedAt', { name: catName(c), when: fmtDue(r.due) }) : t('rem.addedTo', { name: catName(c) }), { action: t('rem.view'), onAction: () => app.openEditor(r.id) });
    } else {
      requestAnimationFrame(() => {
        const row = page.el.querySelector(`.rem-item[data-id="${r.id}"]`);
        row?.classList.add('flash');
        if (row) {
          const sc = page.scrollEl, b = row.getBoundingClientRect(), sb = sc.getBoundingClientRect();
          if (b.bottom > sb.bottom - 90 || b.top < sb.top + 56) sc.scrollTop += b.top - sb.top - sb.height / 3;
        }
      });
    }
  });
  more.addEventListener('click', () => {
    const v = input.value.trim();
    input.value = '';
    paint();
    app.openEditor(null, { draft: v ? fieldsOf(v) : { cat: catDefault() || undefined, ...(view === 'today' || view === 'scheduled' ? { due: defaultDue() } : {}) } });
  });
  paint();
  bar.focus = () => input.focus();
  return bar;
}
