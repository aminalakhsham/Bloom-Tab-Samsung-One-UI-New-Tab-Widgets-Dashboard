// Side panel › Notes: Samsung Notes in a narrow column. The list (search, pinned first, newest first) and a quick
// editor (title, text with bold/italic/underline/bullets) that saves as you type, into the same `notes` store key and
// shape as js/apps/notes.js, so the note is in the Notes app and its widgets at once.
import { h, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { menu, toast } from '../core/ui.js';
import { createNote, sanitize, noteText, NOTE_COLORS } from '../apps/notes.js';
import { header, actionBtn, openAppBtn, fmtWhen, empty } from './kit.js';

const notes = () => store.get('notes') || [];
const sorted = (l) => [...l].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
const isEmptyNote = (n) => !n.title?.trim() && !noteText(n.body);
function patch(id, fields) {
  store.update('notes', (l) => (l || []).map((n) => (n.id === id ? { ...n, ...fields, updated: Date.now() } : n)));
}
function remove(id) {
  const all = notes(), i = all.findIndex((n) => n.id === id);
  if (i < 0) return;
  const n = all[i];
  store.set('notes', all.filter((x) => x.id !== id));
  return { n, i };
}

export function render(main) {
  let query = '', editing = null, offEditor = null, view = null;
  const off = store.on('notes', () => (editing ? syncEditor() : drawList()));

  // The list keeps its header and search field while it redraws, so typing a search never loses the focus.
  function drawList() {
    editing = null;
    offEditor?.();
    offEditor = null;
    if (!view) {
      const head = header({ title: t('sp.tab.notes'), actions: [openAppBtn('notes')] });
      const input = h('input', { type: 'search', value: query, placeholder: t('sp.notes.search'), 'aria-label': t('sp.notes.search'), onInput: () => { query = input.value; drawList(); } });
      const box = h('div', { class: 'sp-notes-box' });
      view = { head, box };
      main.replaceChildren(head, h('label', { class: 'ou-searchbox sp-search' }, h('span', { html: icon('search', 20) }), input), box,
        h('button', { class: 'ou-fab sp-fab', title: t('sp.notes.new'), 'aria-label': t('sp.notes.new'), html: icon('plus', 28), onClick: () => openEditor(createNote().id) }));
    }
    const all = notes().filter((n) => !isEmptyNote(n));
    const q = query.trim().toLowerCase();
    const shown = sorted(all).filter((n) => !q || (n.title || '').toLowerCase().includes(q) || noteText(n.body).toLowerCase().includes(q));
    const items = shown.map((n) => {
      const text = noteText(n.body);
      const title = n.title?.trim() || text.split('\n')[0] || t('common.untitled');
      const rest = n.title?.trim() ? text : text.split('\n').slice(1).join(' ');
      return h('button', { class: ['sp-note', NOTE_COLORS[n.color] && 'tinted'], style: NOTE_COLORS[n.color] ? { '--nc': NOTE_COLORS[n.color] } : null, dataset: { id: n.id }, onClick: () => openEditor(n.id), onContextmenu: (e) => { e.preventDefault(); noteMenu(e, n); } },
        h('span', { class: 'sp-note-title' }, n.pinned ? h('span', { class: 'sp-pin', html: icon('pin', 14) }) : null, h('bdi', null, title)),
        rest.trim() ? h('span', { class: 'sp-note-text' }, rest.replace(/\s+/g, ' ').slice(0, 160)) : null,
        h('span', { class: 'sp-note-date' }, fmtWhen(n.updated)));
    });
    view.head.setSub(all.length === 1 ? t('sp.notes.count1') : t('sp.notes.count', { n: all.length }));
    view.box.replaceChildren(items.length ? h('div', { class: 'sp-notes' }, items) : q ? empty('search', t('sp.notes.noResults')) : empty('note', t('sp.notes.empty'), t('sp.notes.emptyHint')));
  }

  function noteMenu(at, n) {
    menu(at, [
      { label: n.pinned ? t('sp.notes.unpin') : t('sp.notes.pin'), icon: 'pin', onClick: () => store.update('notes', (l) => l.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x))) },
      '-',
      { label: t('sp.notes.delete'), icon: 'trash', danger: true, onClick: () => deleteNote(n.id) },
    ]);
  }
  function deleteNote(id) {
    const r = remove(id);
    if (!r) return;
    if (editing === id) drawList();
    toast(t('sp.notes.deleted'), { action: t('common.undo'), onAction: () => store.update('notes', (l) => { const x = [...(l || [])]; x.splice(Math.min(r.i, x.length), 0, r.n); return x; }) });
  }

  // ——— the quick editor ———
  let titleIn, body, lastSaved = 0;
  function openEditor(id) {
    const n = notes().find((x) => x.id === id);
    if (!n) return drawList();
    editing = id;
    view = null;
    titleIn = h('input', { class: 'sp-ed-title', value: n.title || '', placeholder: t('sp.notes.titlePh'), 'aria-label': t('sp.notes.titlePh') });
    body = h('div', { class: 'sp-ed-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-ph': t('sp.notes.bodyPh'), html: sanitize(n.body) });
    const save = debounce(() => {
      if (editing !== id) return;
      lastSaved = Date.now();
      patch(id, { title: titleIn.value, body: sanitize(body.innerHTML) });
    }, 350);
    titleIn.addEventListener('input', save);
    body.addEventListener('input', () => { body.classList.toggle('empty', !body.textContent.trim()); save(); });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
    const fmt = (cmd, ic, label) => h('button', { class: 'sp-fmt', title: label, 'aria-label': label, html: ic, onMousedown: (e) => e.preventDefault(), onClick: () => { document.execCommand(cmd); body.focus(); save(); } });
    const B = (txt, style) => `<span class="sp-fmt-t" style="${style}">${txt}</span>`;
    const back = () => { flush(); drawList(); };
    const flush = () => {
      if (editing !== id) return;
      const cur = notes().find((x) => x.id === id);
      const fields = { title: titleIn.value, body: sanitize(body.innerHTML) };
      if (!fields.title.trim() && !noteText(fields.body)) remove(id); // an empty note isn't kept, as in Samsung Notes
      else if (cur && (cur.title !== fields.title || cur.body !== fields.body)) patch(id, fields);
      editing = null;
    };
    const head = h('header', { class: 'sp-head sp-ed-head' },
      h('button', { class: 'ou-icon-btn sp-back', title: t('common.back'), 'aria-label': t('common.back'), html: icon('back', 24), onClick: back }),
      h('div', { class: 'sp-head-text' }, h('div', { class: 'sp-sub sp-ed-when' }, fmtWhen(n.updated))),
      h('div', { class: 'sp-actions' }, actionBtn('more', t('common.more'), (e) => noteMenu(e.currentTarget, notes().find((x) => x.id === id) || n))));
    main.replaceChildren(head, h('div', { class: 'sp-editor' }, titleIn, body),
      h('div', { class: 'sp-fmtbar' },
        fmt('bold', B('B', 'font-weight:800'), t('sp.notes.bold')), fmt('italic', B('I', 'font-style:italic;font-family:serif'), t('sp.notes.italic')),
        fmt('underline', B('U', 'text-decoration:underline'), t('sp.notes.underline')), fmt('insertUnorderedList', icon('list', 20), t('sp.notes.bullets'))));
    body.classList.toggle('empty', !body.textContent.trim());
    (n.title || noteText(n.body) ? body : titleIn).focus();
    offEditor = () => flush();
  }
  /** Another tab changed the notes: leave if this one was deleted, take its new text if this field isn't being typed in. */
  function syncEditor() {
    const n = notes().find((x) => x.id === editing);
    if (!n) return drawList();
    if (Date.now() - lastSaved < 1500 || document.activeElement === body || document.activeElement === titleIn) return;
    if (titleIn.value !== (n.title || '')) titleIn.value = n.title || '';
    if (sanitize(body.innerHTML) !== n.body) body.innerHTML = sanitize(n.body);
  }

  drawList();
  return () => {
    offEditor?.();
    off();
  };
}
