// Canvas — an endless board for sticky notes, shapes, text, pictures, links and handwriting (Samsung Notes' infinite
// canvas, Liquid Tab's Freeform). This file only registers the app, its Recent boards widget, Finder results and the
// "new board" command; the gallery and the board load from js/canvas/ when the app opens.
import { h, escapeHtml as esc, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand } from '../core/hooks.js';
import { choose } from '../core/ui.js';
import { registerAction, RunError, toText } from '../routines/actions.js';
import { store } from '../core/store.js';
import { blobUrl } from '../core/blobs.js';
import { addStrings, t, fmtDate, fmtTime } from '../core/i18n.js';
import '../canvas/icons.js';

addStrings({
  en: {
    'app.canvas': 'Canvas',
    'canvas.widget': 'Recent boards',
    'canvas.widgetCanvas': 'Canvas',
    'canvas.noBoards': 'No boards',
    'canvas.create': 'Create',
    'canvas.newBoard': 'New board',
    'canvas.newBoardNamed': 'New board “{name}”',
    'canvas.untitled': 'Untitled board',
    'canvas.board': 'Board',
    'canvas.wPick': 'Board to show first',
    'canvas.wRecent': 'Most recent',
    'canvas.raName': 'Board name',
  },
  ar: {
    'app.canvas': 'اللوحة',
    'canvas.widget': 'اللوحات الأخيرة',
    'canvas.widgetCanvas': 'اللوحة',
    'canvas.noBoards': 'لا توجد لوحات',
    'canvas.create': 'إنشاء',
    'canvas.newBoard': 'لوحة جديدة',
    'canvas.newBoardNamed': 'لوحة جديدة «{name}»',
    'canvas.untitled': 'لوحة بدون عنوان',
    'canvas.board': 'لوحة',
    'canvas.wPick': 'اللوحة المعروضة أولاً',
    'canvas.wRecent': 'الأحدث',
    'canvas.raName': 'اسم اللوحة',
  },
});

// a quick read of the stored boards: the full clean-up runs when the app opens (js/canvas/boards.js)
const boards = () => (Array.isArray(store.get('canvas')) ? store.get('canvas') : []).filter((b) => b && typeof b.id === 'string' && Array.isArray(b.items) && !b.deleted);
const recent = () => boards().sort((a, b) => (b.opened || b.at || 0) - (a.opened || a.at || 0));
const when = (ts) => {
  const d = new Date(ts);
  return sameDay(d, new Date()) ? fmtTime(d) : fmtDate(d, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
};
const fold = (s) => String(s || '').toLocaleLowerCase();
export const openCanvasBoard = (id, from) => openApp('canvas', { from, params: { section: 'board:' + id } });

registerApp({
  id: 'canvas',
  name: 'app.canvas',
  icon: {
    bg: 'linear-gradient(145deg, #ffcf4a 0%, #ff8f3c 100%)',
    glyph: '<rect x="3.5" y="4" width="17" height="16" rx="3.5"/><path d="M7 15.5c1.7-2.9 3.2-2.9 4.1-1.5.9 1.4 2 1.4 3.4-.2"/><rect x="12.8" y="7.3" width="4.6" height="4.6" rx="1"/>',
  },
  keywords: ['canvas', 'board', 'whiteboard', 'freeform', 'sketch', 'draw', 'sticky notes', 'لوحة', 'لوحات', 'سبورة', 'رسم'],
  size: 'wide',
  render: (ctx) => import('../canvas/ui.js').then((m) => m.render(ctx)),
  search(q) {
    const f = fold(q).trim();
    if (!f) return [];
    return recent()
      .filter((b) => fold(b.name).includes(f) || b.items.some((i) => (i.tx && fold(i.tx).includes(f)) || (i.u && fold(i.u).includes(f))))
      .slice(0, 5)
      .map((b) => {
        const hit = !fold(b.name).includes(f) && b.items.find((i) => i.tx && fold(i.tx).includes(f));
        return { title: b.name || t('canvas.untitled'), sub: hit ? hit.tx.replace(/\s+/g, ' ').slice(0, 80) : when(b.at), icon: 'cv-board', onOpen: () => openCanvasBoard(b.id) };
      });
  },
});

// Finder: "new board", "new board Trip plan", "لوحة جديدة"
registerCommand('canvas', (q, lower, done) => {
  // (no \b: it only knows Latin letters, so it would never match after an Arabic word)
  const m = /^(?:new (?:board|canvas)|create (?:a )?board|لوحة جديدة|إنشاء لوحة)(?=$|[\s:\-–])\s*[:\-–]?\s*(.*)$/i.exec(q.trim());
  if (!m) return [];
  const name = m[1].trim();
  return [{
    icon: 'cv-board',
    title: name ? t('canvas.newBoardNamed', { name }) : t('canvas.newBoard'),
    sub: t('app.canvas'),
    run: () => { done?.(); openApp('canvas', { params: { action: 'new', name } }); },
  }];
});

// ——— Routines: "New board" opens a new board in Canvas (a page action: it opens a window) ———
registerAction({
  id: 'canvas.new', name: 'canvas.newBoard', icon: 'cv-board', color: '#ff8f3c', cat: 'apps',
  params: [{ key: 'name', type: 'text', label: 'canvas.raName', ph: 'canvas.untitled' }],
  sub: (p, F) => F.text(p.name),
  run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    openApp('canvas', { params: { action: 'new', name: toText(p.name ?? '').trim() } });
  },
});

// ——— Recent boards widget ———
// Widget settings can pin one board in front (config.board); the others follow by recency, as before.
async function pickBoard(config) {
  const list = recent();
  if (!list.length) return { ...config, board: '' };
  const cur = list.some((b) => b.id === config.board) ? config.board : '';
  const v = await choose(t('canvas.wPick'), [{ value: '', label: t('canvas.wRecent') }, ...list.slice(0, 30).map((b) => ({ value: b.id, label: b.name || t('canvas.untitled'), sub: when(b.at) }))], cur);
  return v == null ? null : { ...config, board: v };
}
registerWidget({
  id: 'canvas',
  name: 'canvas.widget',
  sizes: ['s', 'm', 'l'],
  defaultSize: 'm',
  app: 'canvas',
  configure: (config) => pickBoard(config),
  onClick(item, el, e) {
    const b = e?.target.closest?.('[data-board]');
    if (b) return openCanvasBoard(b.dataset.board, el);
    openApp('canvas', { from: el, params: boards().length ? {} : { action: 'new' } });
  },
  render(el, { size, config = {} }) {
    el.classList.add('wg-canvas');
    const draw = () => {
      const n = { s: 1, m: 3, l: 4 }[size] || 3, all = recent(), pin = config.board && all.find((b) => b.id === config.board);
      const list = (pin ? [pin, ...all.filter((b) => b !== pin)] : all).slice(0, n);
      const head = h('div', { class: 'wg-head wg-cv-head' }, h('span', { class: 'wg-cv-ic', html: icon('cv-board', 15) }), h('span', null, size === 's' ? t('canvas.widgetCanvas') : t('canvas.widget')));
      if (!list.length) {
        el.replaceChildren(head, h('div', { class: 'wg-cv-empty' }, h('span', { html: icon('cv-board', 30) }), h('span', null, t('canvas.noBoards')),
          h('button', { class: 'wg-cv-new', html: icon('plus', 16) + esc(t('canvas.create')), onClick: (e) => { e.stopPropagation(); openApp('canvas', { from: el, params: { action: 'new' } }); } })));
        return;
      }
      // the light and the dark preview are both there, and CSS shows the one for the current look
      el.replaceChildren(head, h('div', { class: `wg-cv-grid n${list.length} ${size}` }, list.map((b) => h('div', { class: 'wg-cv-b', dataset: { board: b.id }, title: b.name || t('canvas.untitled') },
        h('span', { class: 'wg-cv-th', html: `${icon('cv-board', 22)}<img alt="" class="th-l" data-k="${esc(b.thumb?.l || '')}"><img alt="" class="th-d" data-k="${esc(b.thumb?.d || '')}">` }),
        h('span', { class: 'wg-cv-n' }, h('bdi', null, b.name || t('canvas.untitled'))),
        size === 'l' ? h('span', { class: 'wg-cv-d' }, when(b.at)) : null))));
      for (const img of el.querySelectorAll('img[data-k]')) if (img.dataset.k) blobUrl(img.dataset.k).then((u) => { if (u && img.isConnected) { img.src = u; img.classList.add('on'); } }).catch(() => {});
    };
    draw();
    return store.on('canvas', draw);
  },
});
