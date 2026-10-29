// The Samsung Notes editor: a title that wraps, then a contenteditable body (format in html.js) with One UI's two
// toolbars — the top bar (back on narrow windows, Undo / Redo, Galaxy AI Writing assist, note colour, pin, delete, ⋮)
// and the text toolbar (Text style: paragraph style, font size, text colour, highlight, alignment; B I U S; bulleted,
// numbered and checklists; tables; Insert: pictures, drawings, voice recordings, divider). It keeps its own undo
// history (snapshots of the body, so pictures, tables and colour marks undo like typing), turns "- ", "1. " and "[] "
// at the start of a line into lists, colours #tags, and saves as you type through opts.save().
import { h, uid, debounce, pickFile, readImage } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, toast, dialog, iconBtn } from '../core/ui.js';
import { putBlob, getBlob, blobUrl, dataUrlToBlob } from '../core/blobs.js';
import { sanitize, markElement, TEXT_COLORS, HL_COLORS, FONT_SIZES, DEFAULT_SIZE, TAG_RE } from './html.js';
import { NOTE_COLORS, fmtWhen } from '../apps/notes.js';
import { attachWritingAssist, writingAssistItem, WA_ICON } from '../shell/writing.js';

addIcons({
  ntUndo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h10a5 5 0 0 1 0 10H11"/>',
  ntRedo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5h-10a5 5 0 0 0 0 10H13"/>',
  ntTextStyle: '<path d="M3.5 18.5 8 6.5h1L13.5 18.5M5.2 14.2h6.6"/><path d="M15 11.5h5.5M15 15h5.5M15 18.5h5.5"/>',
  ntNumbers: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4 5.2 5.3 4.5v4.3M4 8.8h2.6M3.9 14.2a1.3 1.3 0 0 1 2.5.5c0 .9-2.5 2.2-2.5 3.1h2.6" stroke-width="1.4"/>',
  ntTable: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.2 9.5v10M14.8 9.5v10"/>',
  ntInsert: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4"/><path d="M12 8v8M8 12h8"/>',
  ntPen: '<path d="m14.5 5.5 4 4L9 19H5v-4Z"/><path d="m12.5 7.5 4 4"/>',
  ntVoice: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v2.8"/>',
  ntDivider: '<path d="M3.5 12h17"/><path d="M7 7.5h10M7 16.5h10" opacity=".45"/>',
  ntAlStart: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  ntAlCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  ntAlEnd: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  ntChevron: '<path d="m7 10 5 5 5-5"/>',
});

const BLOCKS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'HR', 'FIGURE']);
const isLoose = (n) => (n.nodeType === 3 ? /\S/.test(n.nodeValue) : n.nodeType === 1 && !BLOCKS.has(n.nodeName));
const PARA = { title: 'h1', heading: 'h2', subheading: 'h3', body: 'div' };

// ——— text offsets (a selection that survives DOM changes which keep the text) ———
function textNodes(root) {
  const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
}
export function textOffsets(root) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const pos = (node, off) => {
    const pre = document.createRange();
    pre.setStart(root, 0);
    pre.setEnd(node, off);
    return pre.toString().length;
  };
  return [pos(r.startContainer, r.startOffset), pos(r.endContainer, r.endOffset)];
}
export function setOffsets(root, [s, e]) {
  const nodes = textNodes(root);
  const find = (off, end) => {
    let acc = 0;
    for (const n of nodes) {
      const l = n.nodeValue.length;
      if (end ? off <= acc + l : off < acc + l) return [n, off - acc];
      acc += l;
    }
    const last = nodes.at(-1);
    return last ? [last, last.nodeValue.length] : null;
  };
  const a = find(s, false) || find(s, true), b = find(e, true);
  const sel = getSelection();
  const r = document.createRange();
  if (!a || !b) {
    const first = root.querySelector('div, p, h1, h2, h3, li, td') || root;
    r.selectNodeContents(first);
    r.collapse(true);
  } else {
    r.setStart(...a);
    r.setEnd(...b);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * createEditor(wrap, note, opts) fills `wrap` (.notes-editor) with the editor for one note.
 * opts: { body (HTML to load), readOnly, save({ title, body }), pinned(), actions: { back, color(anchor), pin(),
 *         remove(), more(anchor), restore?, destroy? }, info() → { folder: { name, color } | null, tags: [[key, name]] },
 *         onTag(key), onFolder(anchor) }
 * → { id, title, body, flush(), focusTitle(), refresh(fields), setPaper(p), setPinned(on), setTint(color), undo(),
 *     redo(), addPictures(files), insertFigure(att, kind), drawing(), voice(), insertTable(r, c), html(), text(),
 *     destroy() }
 */
export function createEditor(wrap, note, opts = {}) {
  const ro = !!opts.readOnly;
  let dirty = false, gone = false, savedSel = null;
  const hist = { undo: [], redo: [], last: 0, kind: '' };

  // ——— the page ———
  const title = h('textarea', { class: 'note-title', rows: 1, dir: 'auto', placeholder: t('notes.titlePh'), 'aria-label': t('notes.titlePh'), maxlength: 300, spellcheck: 'true', readonly: ro || null });
  title.value = note.title || '';
  const meta = h('div', { class: 'note-meta' }, t('notes.edited', { time: fmtWhen(note.updated) }));
  const info = h('div', { class: 'note-info' });
  const body = h('div', { class: 'note-body', dir: 'auto', contenteditable: ro ? 'false' : 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('notes.bodyPh'), 'data-ph': t('notes.bodyPh'), spellcheck: 'true' });
  body.innerHTML = sanitize(opts.body ?? note.body);
  body.dataset.paper = note.paper || 'plain';
  const scroll = h('div', { class: 'note-scroll scroll' }, title, meta, info, body);

  // ——— top bar ———
  const A = opts.actions || {};
  const backBtn = iconBtn('back', () => A.back?.(), t('common.back'));
  backBtn.classList.add('note-back');
  const undoBtn = iconBtn('ntUndo', () => undo(), t('common.undo'));
  const redoBtn = iconBtn('ntRedo', () => redo(), t('notes.redo'));
  const aiBtn = iconBtn(WA_ICON, () => {}, t('wa.title'));
  aiBtn.classList.add('note-ai');
  const colorBtn = iconBtn('palette', (e) => A.color?.(e.currentTarget), t('notes.color'));
  const pinBtn = iconBtn('pin', () => A.pin?.(), t('notes.pin'));
  const delBtn = iconBtn('trash', () => A.remove?.(), t('common.delete'));
  const moreBtn = iconBtn('more', (e) => A.more?.(e.currentTarget), t('common.more'));
  [undoBtn, redoBtn, aiBtn, colorBtn, pinBtn, delBtn, moreBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  const top = ro
    ? h('div', { class: 'note-top' }, backBtn, h('span', { class: 'note-ro' }, h('span', { html: icon('trash', 16) }), opts.roText || ''), h('span', { style: { flex: 1 } }),
      A.restore ? h('button', { class: 'ou-btn note-restore', onClick: () => A.restore() }, t('notes.restore')) : null,
      A.destroy ? h('button', { class: 'ou-btn danger note-destroy', onClick: () => A.destroy() }, t('notes.deleteForever')) : null)
    : h('div', { class: 'note-top' }, backBtn, undoBtn, redoBtn, h('span', { style: { flex: 1 } }), aiBtn, colorBtn, pinBtn, delBtn, moreBtn);

  // ——— text toolbar ———
  const fmtBtn = (cmd, inner, label, fn) => h('button', {
    class: 'note-fmt', type: 'button', title: label, 'aria-label': label, dataset: { cmd }, html: inner,
    onMousedown: (e) => e.preventDefault(),
    onClick: (e) => {
      if (fn) return fn(e.currentTarget);
      command(() => (cmd === 'checklist' ? toggleChecklist() : document.execCommand(cmd)));
    },
  });
  const txt = (s, style = '') => `<span class="note-fmt-txt" style="${style}">${s}</span>`;
  const fmtBar = h('div', { class: 'note-fmtbar', role: 'toolbar', 'aria-label': t('notes.textStyle') },
    fmtBtn('style', icon('ntTextStyle', 21), t('notes.textStyle'), (b) => textStylePop(b)),
    fmtBtn('bold', txt('B', 'font-weight:800'), t('notes.bold')),
    fmtBtn('italic', txt('I', 'font-style:italic;font-family:Georgia,serif'), t('notes.italic')),
    fmtBtn('underline', txt('U', 'text-decoration:underline'), t('notes.underline')),
    fmtBtn('strikeThrough', txt('S', 'text-decoration:line-through'), t('notes.strike')),
    h('span', { class: 'note-fmt-sep' }),
    fmtBtn('insertUnorderedList', icon('list', 20), t('notes.bullets')),
    fmtBtn('insertOrderedList', icon('ntNumbers', 20), t('notes.numbers')),
    fmtBtn('checklist', icon('checkCircle', 20), t('notes.checklist')),
    h('span', { class: 'note-fmt-sep' }),
    fmtBtn('table', icon('ntTable', 20), t('notes.table'), (b) => tableButton(b)),
    fmtBtn('insert', icon('ntInsert', 20), t('notes.insert'), (b) => insertMenu(b)));
  const tools = ro ? null : h('div', { class: 'note-tools' }, fmtBar);
  wrap.replaceChildren(...[top, tools, scroll].filter(Boolean));

  // ——— saving ———
  const html = () => sanitize(body.innerHTML);
  function save() {
    if (gone || ro) return;
    dirty = false;
    opts.save?.({ title: title.value.replace(/\s*\n\s*/g, ' '), body: html() });
    meta.textContent = t('notes.edited', { time: fmtWhen(Date.now()) });
  }
  const saveSoon = debounce(save, 400);
  function changed() {
    dirty = true;
    emptyState();
    saveSoon();
    tagsSoon();
    syncUndo();
  }
  const emptyState = () => body.classList.toggle('empty', !body.textContent.trim() && !body.querySelector('li, figure, table, hr'));
  emptyState();

  // ——— selection helpers ———
  const range = () => {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return body.contains(r.commonAncestorContainer) ? r : null;
  };
  const topBlock = (n) => {
    while (n && n.parentNode !== body) n = n.parentNode;
    return n || null;
  };
  const elOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement);
  const cellOf = (n) => {
    const c = elOf(n)?.closest('td');
    return c && body.contains(c) ? c : null;
  };
  const rememberSel = () => {
    const r = range();
    if (r) savedSel = r.cloneRange();
  };
  /** Before a command: keep the live selection when there is one, else bring back the one remembered. */
  function restoreSel() {
    const live = document.activeElement === body && range();
    if (document.activeElement !== body) body.focus({ preventScroll: true });
    if (live) return;
    const s = getSelection();
    if (savedSel && body.contains(savedSel.startContainer)) {
      s.removeAllRanges();
      s.addRange(savedSel);
    } else if (!range()) caretIn(body.lastElementChild || body, true);
  }
  function caretIn(el, end = false) {
    if (el.nodeName === 'TABLE') el = end ? el.rows[el.rows.length - 1].lastElementChild : el.rows[0].cells[0];
    const r = document.createRange();
    if (el.nodeName === 'FIGURE' || el.nodeName === 'HR') {
      end ? r.setStartAfter(el) : r.setStartBefore(el);
    } else {
      r.selectNodeContents(el);
      r.collapse(!end);
      if (end && el.lastChild?.nodeName === 'BR') r.setStartBefore(el.lastChild);
    }
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  document.addEventListener('selectionchange', onSel);
  function onSel() {
    if (range()) {
      rememberSel();
      updateStates();
    }
  }

  /** Wraps text typed straight into the body (no paragraph around it) into a paragraph, keeping the caret. */
  function wrapLoose() {
    if (![...body.childNodes].some(isLoose)) return;
    const offs = document.activeElement === body ? textOffsets(body) : null;
    let run = null;
    for (const n of [...body.childNodes]) {
      if (isLoose(n) || (run && n.nodeType === 3)) {
        if (!run) body.insertBefore((run = document.createElement('div')), n);
        run.appendChild(n);
      } else run = null;
    }
    if (offs) setOffsets(body, offs);
  }
  /** Runs an editing command as one undo step. */
  function command(fn, { keep = false } = {}) {
    if (ro) return;
    restoreSel();
    record('cmd');
    wrapLoose();
    fn();
    if (!keep) convertMarks();
    changed();
    updateStates();
  }

  // ——— undo history ———
  const snap = () => ({ html: body.innerHTML, sel: document.activeElement === body ? textOffsets(body) : null });
  function record(kind = 'cmd') {
    const now = Date.now();
    if (kind === 'type' && hist.kind === 'type' && now - hist.last < 1200) {
      hist.last = now;
      return;
    }
    const s = snap();
    if (hist.undo.at(-1)?.html !== s.html) hist.undo.push(s);
    if (hist.undo.length > 120) hist.undo.shift();
    hist.redo = [];
    hist.kind = kind;
    hist.last = now;
    syncUndo();
  }
  function restoreSnap(s) {
    body.innerHTML = s.html;
    hydrate();
    body.focus({ preventScroll: true });
    if (s.sel) setOffsets(body, s.sel);
    hist.kind = '';
    changed();
  }
  function undo() {
    if (ro || !hist.undo.length) return;
    const cur = snap();
    const s = hist.undo.pop();
    hist.redo.push(cur);
    restoreSnap(s);
  }
  function redo() {
    if (ro || !hist.redo.length) return;
    hist.undo.push(snap());
    restoreSnap(hist.redo.pop());
  }
  function syncUndo() {
    undoBtn.disabled = !hist.undo.length;
    redoBtn.disabled = !hist.redo.length;
  }
  syncUndo();

  // ——— marks: text colour, highlight, font size (execCommand's fontName marks the text, then it becomes ours) ———
  function convertMarks() {
    const fonts = body.querySelectorAll('font[face^="nt-"]');
    if (!fonts.length) return;
    const offs = textOffsets(body);
    for (const f of fonts) {
      const m = markElement(document, f.getAttribute('face'));
      if (!m) {
        f.replaceWith(...f.childNodes);
        continue;
      }
      const attr = [...m.attributes][0].name;
      while (f.firstChild) m.appendChild(f.firstChild);
      // the new mark wins over the same kind of mark inside it
      for (const inner of m.querySelectorAll(`[${attr}]`)) inner.replaceWith(...inner.childNodes);
      f.replaceWith(m);
    }
    // marks that only undo themselves ("auto" colour, no highlight) outside any other mark of their kind
    for (const x of body.querySelectorAll('span[data-tc="auto"], mark[data-hl="none"]')) {
      const attr = x.hasAttribute('data-tc') ? 'data-tc' : 'data-hl';
      if (!x.parentElement.closest(`[${attr}]`)) x.replaceWith(...x.childNodes);
    }
    if (offs) setOffsets(body, offs);
  }
  const applyMark = (kind, v) => command(() => {
    const r = range();
    if (r && r.collapsed) {
      // nothing selected: the mark holds the caret and wraps what is typed next (a zero-width space keeps it in
      // place; html.js drops it when saving), so a colour, a highlight and a size can all be picked before typing
      const m = markElement(document, `nt-${kind}-${v}`);
      const z = document.createTextNode('\u200b');
      m.appendChild(z);
      r.insertNode(m);
      const nr = document.createRange();
      nr.setStart(z, 1);
      nr.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(nr);
      return;
    }
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontName', false, `nt-${kind}-${v}`);
  });

  /** The paragraph style of the caret's block: 'title' | 'heading' | 'subheading' | 'body'. */
  function paraOf() {
    const b = elOf(range()?.startContainer)?.closest('h1, h2, h3');
    return b && body.contains(b) ? { H1: 'title', H2: 'heading', H3: 'subheading' }[b.nodeName] : 'body';
  }
  function setPara(p) {
    command(() => {
      if (elOf(range()?.startContainer)?.closest('li, td')) return;
      document.execCommand('formatBlock', false, PARA[p]);
    });
  }
  /** Sets the alignment of the paragraphs the selection touches. */
  function setAlign(a) {
    command(() => {
      const r = range();
      if (!r) return;
      const blocks = new Set();
      const add = (n) => {
        const b = elOf(n)?.closest('li, td, div, p, h1, h2, h3, blockquote');
        if (b && body.contains(b) && b !== body) blocks.add(b);
      };
      add(r.startContainer);
      add(r.endContainer);
      for (const n of body.querySelectorAll('li, div, p, h1, h2, h3, blockquote')) if (r.intersectsNode(n) && !n.querySelector('li, div, p, h1, h2, h3')) blocks.add(n);
      for (const b of blocks) {
        if (a === 'start') b.removeAttribute('data-al');
        else b.setAttribute('data-al', a);
      }
    }, { keep: true });
  }
  const alignOf = () => elOf(range()?.startContainer)?.closest('[data-al]')?.getAttribute('data-al') || 'start';
  const markOf = (attr) => {
    const m = elOf(range()?.startContainer)?.closest(`[${attr}]`);
    return m && body.contains(m) ? m.getAttribute(attr) : null;
  };

  // ——— a small popover under a toolbar button (keeps the focus and selection in the note) ———
  function popover(anchor, content, cls = '') {
    rememberSel();
    const box = h('div', { class: ['nt-pop', cls], role: 'dialog' }, content);
    const scrim = h('div', { class: 'ou-menu-scrim nt-pop-scrim', onPointerdown: (e) => e.target === scrim && close() }, box);
    box.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('input')) e.preventDefault();
    });
    (document.getElementById('overlay-layer') || document.body).appendChild(scrim);
    const r = anchor.getBoundingClientRect();
    const place = () => {
      const bw = box.offsetWidth, bh = box.offsetHeight;
      let x = r.left + r.width / 2 - bw / 2, y = r.bottom + 8;
      x = Math.max(8, Math.min(innerWidth - bw - 8, x));
      if (y + bh > innerHeight - 8) y = Math.max(8, r.top - bh - 8);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    place();
    requestAnimationFrame(() => box.classList.add('show'));
    const onKey = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), e.preventDefault(), close());
    addEventListener('keydown', onKey, true);
    scrim._close = close;
    function close() {
      removeEventListener('keydown', onKey, true);
      scrim.remove();
      restoreSel();
    }
    return { close, box, place };
  }

  function textStylePop(anchor) {
    let pop;
    const sec = (label, ...kids) => h('div', { class: 'nt-ts-sec' }, h('div', { class: 'nt-ts-label' }, label), ...kids);
    const chip = (label, on, fn, extra = {}) => h('button', { type: 'button', class: ['nt-ts-chip', on && 'on'], onClick: () => { fn(); draw(); }, ...extra }, label);
    const sw = (key, color, on, fn, title, cls = '') => h('button', { type: 'button', class: ['nt-sw', cls, on && 'on'], style: color ? { '--sw': color } : null, title, 'aria-label': title, dataset: { v: key }, onClick: () => { fn(); draw(); } });
    const content = h('div', { class: 'nt-ts' });
    function draw() {
      const p = paraOf(), tc = markOf('data-tc') || 'auto', hl = markOf('data-hl') || 'none', fs = +markOf('data-fs') || DEFAULT_SIZE, al = alignOf();
      content.replaceChildren(
        sec(t('notes.paraStyle'), h('div', { class: 'nt-ts-row' }, ['title', 'heading', 'subheading', 'body'].map((k) => chip(t('notes.para.' + k), p === k, () => setPara(k), { dataset: { para: k }, class: ['nt-ts-chip', 'nt-para-' + k, p === k && 'on'] })))),
        sec(t('notes.fontSize'), h('div', { class: 'nt-ts-row nt-ts-sizes' }, FONT_SIZES.map((s) => chip(String(s), fs === s, () => applyMark('fs', s), { dataset: { fs: s } })))),
        sec(t('notes.textColor'), h('div', { class: 'nt-ts-row' },
          sw('auto', null, tc === 'auto', () => applyMark('tc', 'auto'), t('notes.c.auto'), 'auto'),
          Object.entries(TEXT_COLORS).map(([k, c]) => sw(k, c, tc === k, () => applyMark('tc', k), t('notes.c.' + k))))),
        sec(t('notes.highlight'), h('div', { class: 'nt-ts-row' },
          sw('none', null, hl === 'none', () => applyMark('hl', 'none'), t('notes.c.none'), 'none'),
          Object.entries(HL_COLORS).map(([k, c]) => sw(k, c, hl === k, () => applyMark('hl', k), t('notes.c.' + k), 'hl')))),
        sec(t('notes.align'), h('div', { class: 'nt-ts-row nt-ts-align' }, [['start', 'ntAlStart'], ['center', 'ntAlCenter'], ['end', 'ntAlEnd']].map(([k, ic]) =>
          h('button', { type: 'button', class: ['nt-ts-al', al === k && 'on'], dataset: { al: k }, title: t('notes.al.' + k), 'aria-label': t('notes.al.' + k), html: icon(ic, 20), onClick: () => { setAlign(k); draw(); } })))));
      pop?.place();
    }
    draw();
    pop = popover(anchor, content, 'nt-ts-pop');
  }

  // ——— lists ———
  function toggleChecklist() {
    const sel = getSelection();
    if (!range()) caretIn(body.lastElementChild || body, true);
    const node = elOf(sel.anchorNode);
    const ul = node?.closest('ul');
    if (ul && body.contains(ul)) {
      if (ul.classList.contains('checklist')) document.execCommand('insertUnorderedList');
      else ul.classList.add('checklist');
    } else {
      document.execCommand('insertUnorderedList');
      const ul2 = elOf(getSelection().anchorNode)?.closest('ul');
      if (ul2 && body.contains(ul2)) ul2.classList.add('checklist');
    }
  }
  /** "- ", "* ", "1. " or "[] " at the start of a paragraph starts a list, as in Samsung Notes. */
  function autoList(e) {
    if (e.inputType !== 'insertText' || e.data !== ' ') return;
    const sel = getSelection(), node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !body.contains(node) || elOf(node).closest('li, td, h1, h2, h3')) return;
    const blk = elOf(node).closest('div, p') || body;
    const pre = document.createRange();
    pre.setStart(blk, 0);
    pre.setEnd(node, sel.anchorOffset);
    const s = pre.toString().replace(/ /g, ' ');
    const kind = /^[-*•] $/.test(s) ? 'ul' : /^1[.)] $/.test(s) ? 'ol' : /^\[ ?\] $/.test(s) ? 'check' : '';
    if (!kind) return;
    const r = document.createRange();
    r.setStart(node, sel.anchorOffset - s.length);
    r.setEnd(node, sel.anchorOffset);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('delete');
    if (kind === 'check') toggleChecklist();
    else document.execCommand(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
  }

  // ——— tables ———
  const tableEl = (rows, cols) => h('table', null, h('tbody', null, Array.from({ length: rows }, () => h('tr', null, Array.from({ length: cols }, () => h('td', null, h('br')))))));
  function insertTable(rows = 3, cols = 3) {
    command(() => {
      const tb = tableEl(rows, cols);
      insertBlock(tb);
      caretIn(tb.rows[0].cells[0]);
    }, { keep: true });
  }
  async function tableButton(anchor) {
    const c = cellOf(range()?.startContainer);
    if (c) return menu(anchor, tableItems(c), { align: 'start' });
    rememberSel();
    let rows = 3, cols = 3;
    const step = (label, get, set) => {
      const val = h('b', { class: 'nt-step-val' }, String(get()));
      return h('div', { class: 'nt-step' }, h('span', null, label),
        h('button', { type: 'button', class: 'ou-icon-btn', 'aria-label': '−', html: icon('minus', 18), onClick: () => { set(Math.max(1, get() - 1)); val.textContent = get(); } }),
        val,
        h('button', { type: 'button', class: 'ou-icon-btn', 'aria-label': '+', html: icon('plus', 18), onClick: () => { set(Math.min(10, get() + 1)); val.textContent = get(); } }));
    };
    const ok = await dialog({
      title: t('notes.insertTable'),
      content: h('div', { class: 'ou-dialog-body nt-table-dlg' }, step(t('notes.rows'), () => rows, (v) => (rows = v)), step(t('notes.cols'), () => cols, (v) => (cols = v))),
      actions: [{ label: t('common.cancel'), value: false }, { label: t('notes.insert'), value: true, primary: true }],
    });
    if (ok && !gone) insertTable(rows, cols);
  }
  function tableItems(cell) {
    const tr = cell.parentElement, tb = cell.closest('table'), ci = cell.cellIndex;
    const newRow = () => h('tr', null, Array.from({ length: tr.cells.length }, () => h('td', null, h('br'))));
    const op = (fn) => () => command(fn, { keep: true });
    return [
      { label: t('notes.rowAbove'), icon: 'up', onClick: op(() => { const r = newRow(); tr.before(r); caretIn(r.cells[ci]); }) },
      { label: t('notes.rowBelow'), icon: 'down', onClick: op(() => { const r = newRow(); tr.after(r); caretIn(r.cells[ci]); }) },
      { label: t('notes.colBefore'), icon: 'back', onClick: op(() => { for (const r of tb.rows) r.cells[ci].before(h('td', null, h('br'))); caretIn(tr.cells[ci]); }) },
      { label: t('notes.colAfter'), icon: 'forward', onClick: op(() => { for (const r of tb.rows) r.cells[ci].after(h('td', null, h('br'))); caretIn(tr.cells[ci + 1]); }) },
      '-',
      { label: t('notes.delRow'), icon: 'minus', onClick: op(() => { if (tb.rows.length < 2) return dropTable(tb); const next = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); caretIn(next.cells[Math.min(ci, next.cells.length - 1)]); }) },
      { label: t('notes.delCol'), icon: 'minus', onClick: op(() => { if (tr.cells.length < 2) return dropTable(tb); for (const r of [...tb.rows]) r.cells[ci]?.remove(); caretIn(tr.cells[Math.min(ci, tr.cells.length - 1)]); }) },
      { label: t('notes.delTable'), icon: 'trash', danger: true, onClick: op(() => dropTable(tb)) },
    ];
  }
  function dropTable(tb) {
    const d = h('div', null, h('br'));
    tb.replaceWith(d);
    caretIn(d);
  }
  /** Tab moves between cells (and adds a row after the last one). */
  function tableTab(e) {
    const c = cellOf(range()?.startContainer);
    if (!c) return false;
    e.preventDefault();
    const cells = [...c.closest('table').querySelectorAll('td')];
    let i = cells.indexOf(c) + (e.shiftKey ? -1 : 1);
    if (i < 0) return true;
    if (i >= cells.length) {
      command(() => {
        const tr = c.parentElement, r = h('tr', null, Array.from({ length: tr.cells.length }, () => h('td', null, h('br'))));
        tr.after(r);
        caretIn(r.cells[0]);
      }, { keep: true });
      return true;
    }
    const r = document.createRange();
    r.selectNodeContents(cells[i]);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return true;
  }

  // ——— pictures, drawings, voice recordings, divider ———
  /** Puts a block after the caret's paragraph (or in place of an empty one), with an empty paragraph after it. */
  function insertBlock(el) {
    wrapLoose();
    const r = range();
    const blk = r ? topBlock(r.startContainer) : null;
    const empty = blk && blk.nodeName === 'DIV' && !blk.textContent.trim() && !blk.querySelector('figure, table, hr, img');
    if (empty) blk.replaceWith(el);
    else if (blk) blk.after(el);
    else body.appendChild(el);
    let next = el.nextElementSibling;
    if (!next || !/^(DIV|P)$/.test(next.nodeName)) el.after((next = h('div', null, h('br'))));
    if (el.nodeName !== 'TABLE') caretIn(next);
  }
  const figureEl = (att, kind) => {
    const f = h('figure', { 'data-att': att, 'data-k': kind });
    hydrate(h('div', null, f)); // hydrate() looks below its root; the figure leaves this holder when it is inserted
    return f;
  };
  /** Gives pictures, drawings and recordings their content (they are stored empty). */
  function hydrate(root = body) {
    for (const f of root.querySelectorAll('figure[data-att]:not([data-h])')) {
      f.setAttribute('data-h', '');
      f.contentEditable = 'false';
      const att = f.getAttribute('data-att'), k = f.getAttribute('data-k');
      if (k === 'voice') {
        f.replaceChildren(h('div', { class: 'nt-voice' },
          h('button', { type: 'button', class: 'nt-voice-play', title: t('notes.play'), 'aria-label': t('notes.play'), html: icon('play', 20) }),
          h('span', { class: 'nt-voice-ico', html: icon('ntVoice', 18) }),
          h('span', { class: 'nt-voice-bar' }, h('i')),
          h('span', { class: 'nt-voice-time', 'data-time': '' })));
        voiceDuration(f, att);
      } else {
        const img = h('img', { alt: k === 'draw' ? t('notes.drawing') : t('notes.picture'), draggable: 'false' });
        f.replaceChildren(img);
        blobUrl(att).then((u) => (u ? (img.src = u) : f.classList.add('missing')), () => f.classList.add('missing'));
      }
    }
  }
  hydrate();
  async function addPictures(files) {
    files = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!files.length || ro) return;
    const atts = [];
    for (const f of files.slice(0, 20)) {
      try {
        const id = 'notes:' + uid();
        await putBlob(id, await dataUrlToBlob(await readImage(f, 2048, 0.86)));
        atts.push(id);
      } catch (err) {
        console.warn('notes picture', err);
      }
    }
    if (gone || !atts.length) return;
    command(() => atts.forEach((id) => insertBlock(figureEl(id, 'img'))), { keep: true });
    save();
  }
  function insertFigure(att, kind) {
    command(() => insertBlock(figureEl(att, kind)), { keep: true });
    save();
  }
  async function drawing(fig) {
    rememberSel();
    const { openSketch } = await import('./sketch.js');
    const att = fig?.getAttribute('data-att');
    const vec = att ? await getBlob(att + ':v').catch(() => null) : null;
    const r = await openSketch(vec);
    if (!r || gone) return;
    const id = att || 'notes:' + uid();
    await putBlob(id, r.png);
    await putBlob(id + ':v', r.vector);
    if (fig) {
      record('cmd');
      fig.removeAttribute('data-h');
      hydrate();
      changed();
      save();
    } else insertFigure(id, 'draw');
  }
  async function voice() {
    rememberSel();
    const { recordVoice } = await import('./voice.js');
    const blob = await recordVoice();
    if (!blob || gone) return;
    const id = 'notes:' + uid();
    await putBlob(id, blob);
    insertFigure(id, 'voice');
  }
  function insertMenu(anchor) {
    rememberSel();
    menu(anchor, [
      { label: t('notes.picture'), icon: 'image', onClick: async () => addPictures(await pickFile('image/*', true)) },
      { label: t('notes.drawing'), icon: 'ntPen', onClick: () => drawing(null) },
      { label: t('notes.voice'), icon: 'ntVoice', onClick: () => voice() },
      { label: t('notes.table'), icon: 'ntTable', onClick: () => tableButton(anchor) },
      { label: t('notes.divider'), icon: 'ntDivider', onClick: () => command(() => insertBlock(h('hr')), { keep: true }) },
    ]);
  }

  // ——— voice playback (one shared player per recording, so a redraw keeps playing) ———
  const players = new Map();
  const figsOf = (att) => body.querySelectorAll(`figure[data-att="${att}"]`);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  async function playerOf(att) {
    if (players.has(att)) return players.get(att);
    const a = new Audio();
    a.preload = 'metadata';
    const u = await blobUrl(att);
    if (!u) return null;
    a.src = u;
    const sync = () => figsOf(att).forEach((f) => {
      const d = isFinite(a.duration) ? a.duration : 0;
      f.querySelector('.nt-voice-bar i')?.style.setProperty('width', d ? (a.currentTime / d) * 100 + '%' : '0');
      f.querySelector('.nt-voice-time')?.setAttribute('data-time', mmss(a.paused && !a.currentTime ? d : a.currentTime));
      const b = f.querySelector('.nt-voice-play');
      if (b) {
        b.innerHTML = icon(a.paused ? 'play' : 'pause', 20);
        b.title = t(a.paused ? 'notes.play' : 'notes.pause');
      }
      f.classList.toggle('playing', !a.paused);
    });
    ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach((ev) => a.addEventListener(ev, sync));
    a.addEventListener('ended', () => (a.currentTime = 0));
    players.set(att, a);
    return a;
  }
  async function voiceDuration(f, att) {
    const a = await playerOf(att);
    if (!a) f.classList.add('missing');
  }

  // ——— #tags in colour (CSS Custom Highlights: the text itself stays plain) ———
  function paintTags() {
    if (gone || !globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
    const ranges = [];
    for (const n of textNodes(body)) {
      if (elOf(n).closest('figure')) continue;
      for (const m of n.nodeValue.matchAll(TAG_RE)) {
        const r = document.createRange();
        const s = m.index + m[1].length;
        r.setStart(n, s);
        r.setEnd(n, s + 1 + m[2].length);
        ranges.push(r);
      }
    }
    CSS.highlights.set('nt-tag', new Highlight(...ranges));
    drawInfo();
  }
  const tagsSoon = debounce(paintTags, 300);
  function drawInfo() {
    const i = opts.info?.() || {};
    const chips = [];
    if (i.folder) chips.push(h('button', { type: 'button', class: 'note-chip note-folder', style: { '--fc': i.folder.color }, onClick: (e) => opts.onFolder?.(e.currentTarget) }, h('i'), i.folder.name));
    for (const [k, name] of i.tags || []) chips.push(h('button', { type: 'button', class: 'note-chip note-tag', dir: 'auto', onClick: () => opts.onTag?.(k) }, '#' + name));
    info.replaceChildren(...chips);
    info.hidden = !chips.length;
  }
  paintTags();

  // ——— events ———
  // the title wraps and grows like Samsung's (CSS field-sizing where Chrome has it, else measured here)
  const sizing = !!globalThis.CSS?.supports?.('field-sizing', 'content');
  const growTitle = () => {
    if (sizing) return;
    title.style.height = 'auto';
    title.style.height = title.scrollHeight + 'px';
  };
  title.addEventListener('input', () => {
    if (/\n/.test(title.value)) {
      const p = title.selectionStart;
      title.value = title.value.replace(/\s*\n\s*/g, ' ');
      title.setSelectionRange(p, p);
    }
    growTitle();
    changed();
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && title.selectionStart === title.value.length)) {
      e.preventDefault();
      if (!ro) body.focus();
    }
  });
  requestAnimationFrame(growTitle);
  const ro2 = new ResizeObserver(() => requestAnimationFrame(growTitle));
  if (!sizing) ro2.observe(wrap);

  if (!ro) {
    body.addEventListener('focus', () => {
      // a new paragraph to type into, so the first line isn't loose text
      if (!body.firstChild || (body.childNodes.length === 1 && body.firstChild.nodeName === 'BR')) {
        body.replaceChildren(h('div', null, h('br')));
        caretIn(body.firstChild);
      }
    });
    body.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        return e.inputType === 'historyUndo' ? undo() : redo();
      }
      record(/^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(e.inputType) ? 'type' : 'cmd');
    });
    body.addEventListener('input', (e) => {
      // Enter on a checked item makes a copy of it: the new item starts unchecked
      if (e.inputType === 'insertParagraph') body.querySelectorAll('ul.checklist > li[data-checked]').forEach((li) => !li.textContent.trim() && li.removeAttribute('data-checked'));
      if (!e.isComposing) {
        autoList(e);
        wrapLoose();
        convertMarks();
      }
      changed();
    });
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) return addPictures(files);
      record('cmd');
      const htmlIn = e.clipboardData.getData('text/html');
      if (htmlIn) document.execCommand('insertHTML', false, sanitize(htmlIn) || ' ');
      else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      hydrate();
    });
    body.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      addPictures(files);
    });
    body.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && !e.altKey && k === 'z') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && !e.altKey && k === 'y') {
        e.preventDefault();
        return redo();
      }
      if (mod && e.shiftKey && (e.key === '9' || e.key === '(')) {
        e.preventDefault();
        return command(() => toggleChecklist());
      }
      if (e.key === 'Tab' && !mod && !e.altKey) tableTab(e);
    });
  }
  body.addEventListener('click', (e) => {
    const play = e.target.closest('.nt-voice-play');
    if (play) {
      const att = play.closest('figure')?.getAttribute('data-att');
      playerOf(att).then((a) => {
        if (!a) return;
        players.forEach((p) => p !== a && p.pause());
        a.paused ? a.play().catch(() => {}) : a.pause();
      });
      return;
    }
    const bar = e.target.closest('.nt-voice-bar');
    if (bar) {
      const a = players.get(bar.closest('figure')?.getAttribute('data-att'));
      if (a && isFinite(a.duration)) {
        const r = bar.getBoundingClientRect();
        let p = (e.clientX - r.left) / r.width;
        if (getComputedStyle(bar).direction === 'rtl') p = 1 - p;
        a.currentTime = Math.max(0, Math.min(1, p)) * a.duration;
      }
      return;
    }
    const fig = e.target.closest('figure');
    if (fig && body.contains(fig)) {
      if (fig.getAttribute('data-k') === 'draw' && !ro) return drawing(fig);
      if (fig.getAttribute('data-k') === 'img') return viewPicture(fig);
      return;
    }
    if (ro) return;
    const li = e.target.closest('ul.checklist > li');
    if (!li || !body.contains(li)) return;
    const r = li.getBoundingClientRect();
    const rtl = getComputedStyle(li).direction === 'rtl';
    const x = rtl ? r.right - e.clientX : e.clientX - r.left;
    if (x >= 0 && x < 28) {
      e.preventDefault();
      record('cmd');
      if (li.getAttribute('data-checked') === 'true') li.removeAttribute('data-checked');
      else li.setAttribute('data-checked', 'true');
      changed();
    }
  });
  function viewPicture(fig) {
    const src = fig.querySelector('img')?.src;
    if (!src) return;
    dialog({ className: 'nt-viewer-dlg', content: h('div', { class: 'nt-viewer' }, h('img', { src, alt: '' })), actions: [{ label: t('common.close'), value: null, primary: true }] });
  }
  async function savePicture(fig) {
    const b = await getBlob(fig.getAttribute('data-att')).catch(() => null);
    if (!b) return;
    const ext = fig.getAttribute('data-k') === 'voice' ? (/ogg/.test(b.type) ? 'ogg' : /mp4|m4a/.test(b.type) ? 'm4a' : 'webm') : /png/.test(b.type) ? 'png' : 'jpg';
    const a = h('a', { href: URL.createObjectURL(b), download: `${(title.value || t('app.notes')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.${ext}` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 800);
  }

  // ——— right-click: Writing assist, the clipboard, tables and pictures ———
  body.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || ro) return; // Shift + right-click keeps Chrome's own menu (spelling suggestions)
    e.preventDefault();
    const fig = e.target.closest('figure');
    if (fig && body.contains(fig)) {
      const k = fig.getAttribute('data-k');
      return menu(e, [
        k === 'draw' ? { label: t('notes.editDrawing'), icon: 'ntPen', onClick: () => drawing(fig) } : null,
        k === 'img' ? { label: t('notes.view'), icon: 'eye', onClick: () => viewPicture(fig) } : null,
        { label: t('notes.saveFile'), icon: 'download', onClick: () => savePicture(fig) },
        '-',
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => command(() => { const next = fig.nextElementSibling; fig.remove(); if (next) caretIn(next); }, { keep: true }) },
      ]);
    }
    rememberSel();
    const sel = !!range() && !range().collapsed;
    const cell = cellOf(e.target);
    const clip = (cmd) => {
      restoreSel();
      if (cmd === 'cut') record('cmd');
      document.execCommand(cmd);
    };
    menu(e, [
      body.textContent.trim() ? writingAssistItem(body, e) : null,
      body.textContent.trim() ? '-' : null,
      sel ? { label: t('notes.cut'), icon: 'edit', onClick: () => clip('cut') } : null,
      sel ? { label: t('notes.copySel'), icon: 'copy', onClick: () => clip('copy') } : null,
      { label: t('notes.selectAll'), icon: 'text', onClick: () => { body.focus(); const r = document.createRange(); r.selectNodeContents(body); getSelection().removeAllRanges(); getSelection().addRange(r); } },
      ...(cell ? ['-', ...tableItems(cell)] : []),
    ]);
  });

  // ——— Writing assist (Galaxy AI) ———
  if (!ro) {
    attachWritingAssist(body, {
      kind: 'note',
      button: aiBtn,
      menu: false,
      onBefore: () => record('cmd'),
      undo: () => undo(),
      onResult: () => {
        hydrate();
        changed();
      },
    });
  }

  // ——— button states ———
  function updateStates() {
    const r = range();
    fmtBar.querySelectorAll('.note-fmt').forEach((b) => {
      const cmd = b.dataset.cmd;
      let on = false;
      try {
        if (!r) on = false;
        else if (cmd === 'checklist') on = !!elOf(r.startContainer)?.closest('ul.checklist');
        else if (cmd === 'insertUnorderedList') on = !!elOf(r.startContainer)?.closest('ul:not(.checklist)');
        else if (cmd === 'table') on = !!cellOf(r.startContainer);
        else if (cmd === 'style') on = paraOf() !== 'body' || !!elOf(r.startContainer)?.closest('[data-tc]:not([data-tc="auto"]), [data-fs], mark:not([data-hl="none"]), [data-al]');
        else if (cmd !== 'insert') on = document.queryCommandState(cmd);
      } catch {}
      b.classList.toggle('on', on);
    });
  }

  const api = {
    id: note.id,
    title,
    body,
    readOnly: ro,
    html,
    text: () => body.innerText,
    flush() {
      if (dirty) save();
      dirty = false;
    },
    focusTitle: () => title.focus(),
    focusBody() {
      body.focus();
      caretIn(body.lastElementChild || body, true);
    },
    /** Shows a newer version saved elsewhere (another tab), unless you are typing in this note. */
    refresh(fields) {
      if (document.activeElement === title || document.activeElement === body) return;
      if (fields.title != null) title.value = fields.title;
      if (fields.body != null) {
        body.innerHTML = sanitize(fields.body);
        hydrate();
        emptyState();
        paintTags();
      }
      growTitle();
    },
    setMeta(updated) {
      meta.textContent = t('notes.edited', { time: fmtWhen(updated) });
    },
    setPaper(p) {
      body.dataset.paper = p || 'plain';
    },
    setPinned(on) {
      pinBtn.classList.toggle('active', !!on);
      pinBtn.setAttribute('aria-pressed', String(!!on));
    },
    setTint(c) {
      wrap.style.cssText = NOTE_COLORS[c] ? `--nc:${NOTE_COLORS[c]}` : '';
      wrap.classList.toggle('tinted', !!NOTE_COLORS[c]);
    },
    drawInfo,
    undo,
    redo,
    addPictures,
    insertFigure,
    insertTable,
    drawing,
    voice,
    setPara,
    setAlign,
    applyMark,
    destroy() {
      gone = true;
      document.removeEventListener('selectionchange', onSel);
      ro2.disconnect();
      players.forEach((a) => a.pause());
      players.clear();
      if (globalThis.CSS?.highlights) CSS.highlights.delete('nt-tag');
    },
  };
  api.setPinned(opts.pinned?.());
  api.setTint(note.color);
  drawInfo();
  return api;
}
