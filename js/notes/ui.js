// Samsung Notes window: the navigation drawer (≡: All notes, Favourites, Recently deleted, folders with colours, tags),
// the note list (search, pinned first, sort, list or grid, selection mode) and the editor pane (js/notes/editor.js).
// A wide window shows both panes; a narrow one shows the list and opens a note over it, as on a phone. Locked notes
// open with the screen lock PIN (js/shell/pin.js); notes in Recently deleted open read-only with Restore.
import { h, onLongPress } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { openApp } from '../core/apps.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { toast, menu, dialog, confirm, choose, iconBtn } from '../core/ui.js';
import { blobUrl } from '../core/blobs.js';
import { NOTE_COLORS, fmtWhen, sorted, viewPrefs, isEmptyNote, colorVar, createNote } from '../apps/notes.js';
import { noteText, firstPicture, sanitize } from './html.js';
import * as M from './model.js';
import { createEditor } from './editor.js';
import { templates } from './templates.js';
import './strings.js';

addIcons({
  ntMenu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  ntTag: '<path d="M9.5 4.5 8 19.5M16 4.5l-1.5 15M4.5 9h15M4 15h15"/>',
  ntBin: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/><path d="M10 11v5M14 11v5"/>',
  ntRestore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  ntTemplate: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  ntPrint: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7.5" rx="2"/><path d="M7.5 14h9v6h-9z"/>',
});

const ALL = { kind: 'all' };

export function render(ctx) {
  M.purge();
  setTimeout(() => M.sweep(), 2500);
  let view = ALL;
  let selectedId = null;
  let query = '';
  let editor = null; // the createEditor() api of the open note
  let lastLocalSave = 0;
  let picked = null; // Set of ids while selecting
  let unlocked = null; // the locked note opened with the PIN (it locks again when you leave it)
  let lockPad = null;
  let narrowEditing = false;

  const page = ctx.page({ title: t('notes.all'), hero: false, className: 'notes-page' });
  page.body.classList.add('flush');
  const menuBtn = iconBtn('ntMenu', () => openDrawer(), t('notes.drawer'));
  menuBtn.classList.add('notes-menu-btn');
  page.el.querySelector('.app-toolbar').prepend(menuBtn);
  const moreBtn = iconBtn('more', (e) => listMenu(e.currentTarget), t('common.more'));
  page.setActions([moreBtn]);

  const searchInput = h('input', { type: 'search', placeholder: t('notes.search'), 'aria-label': t('notes.search') });
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    drawList();
  });
  const countEl = h('div', { class: 'notes-count' });
  const binNote = h('div', { class: 'notes-binnote', hidden: true });
  const listEl = h('div', { class: 'notes-list scroll' });
  const fab = h('button', { class: 'ou-fab notes-fab', title: t('notes.new'), 'aria-label': t('notes.new'), html: icon('edit', 24), onClick: () => newNote() });
  const allBox = h('input', { type: 'checkbox', class: 'notes-allbox', 'aria-label': t('notes.selectAll'), onChange: () => { picked = allBox.checked ? new Set(listItems().map((n) => n.id)) : new Set(); drawList(); } });
  const selCount = h('span', { class: 'notes-selcount' });
  const selbar = h('div', { class: 'notes-selbar', hidden: true },
    h('label', { class: 'notes-all' }, allBox, h('span', { class: 'notes-check' }), h('span', null, t('notes.all1'))),
    selCount, h('span', { style: { flex: 1 } }),
    iconBtn('close', () => stopSelect(), t('common.cancel')));
  const selActs = h('div', { class: 'notes-selacts', hidden: true });
  const side = h('div', { class: 'notes-side' },
    h('label', { class: 'ou-searchbox notes-search' }, h('span', { html: icon('search', 20) }), searchInput),
    selbar, countEl, binNote, listEl, fab, selActs);
  const editorWrap = h('div', { class: 'notes-editor' });
  const root = h('div', { class: 'notes' }, side, editorWrap);
  page.body.appendChild(root);

  // narrow windows (split screen, a small pop-up) show one pane at a time
  const ro = new ResizeObserver(() => {
    const narrow = root.clientWidth > 0 && root.clientWidth < 700;
    root.classList.toggle('narrow', narrow);
    root.classList.toggle('editing', narrow && narrowEditing);
  });
  ro.observe(root);
  const showEditor = (on) => {
    narrowEditing = on;
    root.classList.toggle('editing', root.classList.contains('narrow') && on);
  };

  // ——— the list ———
  const viewTitle = () => ({ all: t('notes.all'), fav: t('notes.favs'), bin: t('notes.bin'), folder: M.folderById(view.id)?.name || t('notes.folder'), tag: '\u2068#' + (M.allTags().find((x) => x.key === view.id)?.name || view.id) + '\u2069' }[view.kind]);
  const isBin = () => view.kind === 'bin';
  function listItems() {
    let l = M.inView(view);
    if (query) l = l.filter((n) => M.searchText(n).toLowerCase().includes(query));
    return isBin() ? [...l].sort((a, b) => b.deletedAt - a.deletedAt) : sorted(l);
  }
  function drawList() {
    if (view.kind === 'folder' && !M.folderById(view.id)) view = ALL;
    if (view.kind === 'tag' && !M.allTags().some((x) => x.key === view.id)) view = ALL;
    page.setTitle(viewTitle());
    const total = M.inView(view).length;
    const items = listItems();
    countEl.textContent = total === 1 ? t('notes.count1') : t('notes.count', { n: total });
    binNote.hidden = !isBin();
    binNote.textContent = t('notes.binNote');
    fab.hidden = isBin() || !!picked;
    const layout = viewPrefs().layout;
    listEl.className = `notes-list scroll layout-${layout}`;
    if (picked) {
      for (const id of picked) if (!items.some((n) => n.id === id)) picked.delete(id);
      drawSelbar();
    }
    if (!items.length) {
      const ic = query ? 'search' : isBin() ? 'ntBin' : view.kind === 'fav' ? 'star' : 'note';
      listEl.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon(ic, 56) }), query ? t('notes.noResults') : isBin() ? t('notes.binEmpty') : t('notes.empty'), !query && !isBin() ? h('small', null, t('notes.emptyHint')) : null));
      return;
    }
    const pinned = isBin() ? [] : items.filter((n) => n.pinned);
    const rest = isBin() ? items : items.filter((n) => !n.pinned);
    const groups = [];
    if (pinned.length && rest.length && !query) groups.push(h('div', { class: 'notes-group' }, t('notes.pinned')), h('div', { class: 'notes-cards' }, pinned.map(card)), h('div', { class: 'notes-group' }, t('notes.others')), h('div', { class: 'notes-cards' }, rest.map(card)));
    else groups.push(h('div', { class: 'notes-cards' }, items.map(card)));
    listEl.replaceChildren(...groups);
  }
  function card(n) {
    const locked = M.isLocked(n);
    const text = locked ? '' : noteText(n.body).replace(/\n+/g, '\n');
    const pic = locked ? null : firstPicture(n.body);
    const f = M.folderById(M.folderOf(n) || '');
    const thumb = pic ? h('span', { class: 'note-card-thumb' }, h('img', { alt: '', draggable: 'false' })) : null;
    if (pic) blobUrl(pic).then((u) => u && (thumb.firstChild.src = u), () => {});
    const sel = picked?.has(n.id);
    return h('button', {
      class: ['note-card', n.id === selectedId && !picked && 'active', NOTE_COLORS[n.color] && 'tinted', sel && 'picked', pic && 'has-thumb'],
      style: colorVar(n.color),
      dataset: { id: n.id },
      'aria-pressed': picked ? String(!!sel) : null,
      onClick: () => (picked ? toggle(n.id) : select(n.id, { user: true })),
      onContextmenu: (e) => {
        e.preventDefault();
        if (picked) return toggle(n.id);
        noteMenu(e, n);
      },
    },
      picked ? h('span', { class: ['notes-check', sel && 'on'] }) : null,
      h('span', { class: 'note-card-main' },
        h('span', { class: 'note-card-title' }, n.title || text.split('\n')[0] || t('common.untitled')),
        locked
          ? h('span', { class: 'note-card-snippet note-card-locked' }, h('span', { html: icon('lock', 14) }), t('notes.locked'))
          : text && (n.title || text.includes('\n')) ? h('span', { class: 'note-card-snippet' }, n.title ? text : text.split('\n').slice(1).join('\n')) : null,
        h('span', { class: 'note-card-meta' },
          n.pinned && !isBin() ? h('span', { class: 'note-card-pin', html: icon('pin', 14) }) : null,
          n.fav && !isBin() ? h('span', { class: 'note-card-fav', html: icon('starFill', 14) }) : null,
          f && view.kind !== 'folder' ? h('span', { class: 'note-card-folder', style: { '--fc': f.color } }, h('i'), f.name) : null,
          h('span', null, isBin() ? (M.daysLeft(n) === 1 ? t('notes.day1') : t('notes.days', { n: M.daysLeft(n) })) : fmtWhen(n.updated)))),
      thumb);
  }
  // a long press starts selecting, as on the phone
  const offLong = onLongPress(listEl, (e) => {
    const c = e.target.closest?.('.note-card[data-id]');
    if (c && !picked) startSelect(c.dataset.id);
  });

  // ——— selection mode ———
  function startSelect(id) {
    picked = new Set(id ? [id] : []);
    editor?.flush(); // the open note stays open beside the list, as on Samsung's tablets
    drawList();
  }
  function stopSelect() {
    picked = null;
    selbar.hidden = true;
    selActs.hidden = true;
    side.classList.remove('selecting');
    drawList();
    if (!editor && selectedId) drawEditor();
  }
  function toggle(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    drawList();
  }
  function drawSelbar() {
    side.classList.add('selecting');
    selbar.hidden = false;
    selActs.hidden = false;
    const n = picked.size, all = listItems().length;
    selCount.textContent = n ? t('notes.selected', { n }) : t('notes.selectNotes');
    allBox.checked = n > 0 && n === all;
    const act = (ic, label, fn, danger) => h('button', { class: ['notes-selact', danger && 'danger'], disabled: !n, onClick: () => fn([...picked]) }, h('span', { html: icon(ic, 22) }), h('span', null, label));
    selActs.replaceChildren(...(isBin()
      ? [act('ntRestore', t('notes.restore'), (ids) => { M.restore(ids); toast(t('notes.restored', { n: ids.length })); stopSelect(); }),
        act('trash', t('notes.deleteForever'), (ids) => destroyNotes(ids), true)]
      : [act('star', t('notes.fav'), (ids) => { const on = !ids.every((id) => M.byId(id)?.fav); M.setFav(ids, on); stopSelect(); }),
        act('folder', t('notes.move'), (ids) => moveNotes(ids).then((ok) => ok && stopSelect())),
        act('trash', t('common.delete'), (ids) => { removeNotes(ids); stopSelect(); }, true)]));
  }

  // ——— menus ———
  function listMenu(anchor) {
    const p = viewPrefs();
    const set = (k, v) => store.set('notesView', { ...p, [k]: v });
    const any = listItems().length > 0;
    menu(anchor, [
      any ? { label: t('notes.edit'), icon: 'checkCircle', onClick: () => startSelect() } : null,
      isBin() && any ? { label: t('notes.restoreAll'), icon: 'ntRestore', onClick: () => { const n = M.restore(M.bin().map((x) => x.id)); toast(t('notes.restored', { n })); } } : null,
      isBin() && any ? { label: t('notes.emptyBin'), icon: 'trash', danger: true, onClick: () => destroyNotes(M.bin().map((x) => x.id)) } : null,
      '-',
      { label: t('notes.viewList'), icon: 'list', checked: p.layout === 'list', onClick: () => set('layout', 'list') },
      { label: t('notes.viewGrid'), icon: 'widgets', checked: p.layout === 'grid', onClick: () => set('layout', 'grid') },
      ...(isBin() ? [] : ['-',
        { label: t('notes.sortModified'), checked: p.sort === 'modified', onClick: () => set('sort', 'modified') },
        { label: t('notes.sortCreated'), checked: p.sort === 'created', onClick: () => set('sort', 'created') },
        { label: t('notes.sortTitle'), checked: p.sort === 'title', onClick: () => set('sort', 'title') },
        '-',
        { label: t('notes.fromTemplate'), icon: 'ntTemplate', onClick: () => fromTemplate() }]),
    ], { align: 'end' });
  }

  function noteMenu(at, n) {
    if (isBin()) {
      return menu(at, [
        { label: t('notes.restore'), icon: 'ntRestore', onClick: () => { M.restore([n.id]); toast(t('notes.restored', { n: 1 })); } },
        '-',
        { label: t('notes.deleteForever'), icon: 'trash', danger: true, onClick: () => destroyNotes([n.id]) },
      ]);
    }
    const locked = M.isLocked(n);
    menu(at, [
      { label: n.pinned ? t('notes.unpin') : t('notes.pin'), icon: 'pin', onClick: () => M.patch(n.id, { pinned: !n.pinned }, false) },
      { label: n.fav ? t('notes.unfav') : t('notes.fav'), icon: n.fav ? 'starFill' : 'star', onClick: () => M.setFav([n.id], !n.fav) },
      { label: t('notes.move'), icon: 'folder', onClick: () => moveNotes([n.id]) },
      { label: locked ? t('notes.unlockNote') : t('notes.lockNote'), icon: locked ? 'unlock' : 'lock', onClick: () => (locked ? removeLock(n.id) : lockNote(n.id)) },
      locked ? null : { label: t('notes.copy'), icon: 'copy', onClick: () => copyNote(n) },
      locked ? null : { label: t('notes.export'), icon: 'download', onClick: () => exportNote(n) },
      { label: t('notes.select1'), icon: 'checkCircle', onClick: () => startSelect(n.id) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeNotes([n.id]) },
    ]);
  }

  /** The open note's ⋮ menu. */
  function editorMenu(anchor) {
    const n = M.byId(selectedId);
    if (!n) return;
    menu(anchor, [
      { label: n.fav ? t('notes.unfav') : t('notes.fav'), icon: n.fav ? 'starFill' : 'star', onClick: () => M.setFav([n.id], !n.fav) },
      { label: t('notes.move'), icon: 'folder', onClick: () => moveNotes([n.id]) },
      { label: t('notes.pageTemplate'), icon: 'grid', onClick: () => pickPaper(n) },
      { label: n.locked ? t('notes.unlockNote') : t('notes.lockNote'), icon: n.locked ? 'unlock' : 'lock', onClick: () => (n.locked ? removeLock(n.id) : lockNote(n.id)) },
      '-',
      { label: t('notes.copy'), icon: 'copy', onClick: () => copyNote(n) },
      { label: t('notes.export'), icon: 'download', onClick: () => exportNote(n) },
      { label: t('notes.print'), icon: 'ntPrint', onClick: () => withBody(n, (html) => import('./export.js').then((x) => x.printNote(n, html))) },
      '-',
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeNotes([n.id]) },
    ], { align: 'end' });
  }

  // ——— actions ———
  /** The note's current HTML (the open editor's, a locked note's from the vault). */
  function bodyOf(n) {
    if (editor && editor.id === n.id) return editor.html();
    return M.isLocked(n) ? M.lockedBody(n) : n.body;
  }
  function withBody(n, fn) {
    editor?.flush();
    return fn(bodyOf(M.byId(n.id) || n));
  }
  function copyNote(n) {
    withBody(n, (html) => {
      const text = [n.title?.trim(), noteText(html)].filter(Boolean).join('\n\n');
      navigator.clipboard?.writeText(text).then(() => toast(t('notes.copied')), () => {});
    });
  }
  async function exportNote(n) {
    const kind = await choose(t('notes.export'), [
      { value: 'pdf', label: t('notes.filePdf') },
      { value: 'md', label: t('notes.fileMd') },
      { value: 'txt', label: t('notes.fileTxt') },
    ], 'pdf');
    if (!kind) return;
    const x = await import('./export.js');
    try {
      await withBody(n, async (html) => {
        if (kind === 'pdf') {
          toast(t('notes.savingPdf'));
          await x.savePdf(M.byId(n.id) || n, html);
        } else if (kind === 'md') x.saveMarkdown(n, html);
        else x.saveText(n, html);
      });
      toast(t('notes.saved'));
    } catch (e) {
      console.warn('notes export', e);
      toast(t('notes.saveFailed'));
    }
  }
  async function moveNotes(ids) {
    const cur = ids.length === 1 ? M.folderOf(M.byId(ids[0]) || {}) : undefined;
    const v = await choose(t('notes.move'), [
      { value: '', label: t('notes.noFolder') },
      ...M.folders().map((f) => ({ value: f.id, label: f.name })),
      { value: '+', label: t('notes.newFolder') },
    ], cur === undefined ? null : cur || '');
    if (v == null) return false;
    let id = v;
    if (v === '+') {
      const f = await folderDialog();
      if (!f) return false;
      id = f.id;
    }
    M.moveTo(ids, id);
    toast(id ? t('notes.movedTo', { name: M.folderById(id)?.name || '' }) : t('notes.movedOut'));
    if (editor) editor.drawInfo();
    return true;
  }
  function removeNotes(ids) {
    if (editor && ids.includes(editor.id)) editor.flush();
    const all = sorted(M.all()), wasOpen = ids.includes(selectedId);
    const gone = M.trash(ids);
    if (!gone) return;
    if (wasOpen) {
      const next = all.find((n) => !ids.includes(n.id) && M.inView(view).some((x) => x.id === n.id));
      closeEditor();
      selectedId = null;
      if (next && !root.classList.contains('narrow')) select(next.id);
      else {
        showEditor(false);
        drawEditor();
      }
    }
    drawList();
    toast(ids.length > 1 ? t('notes.deletedN', { n: ids.length }) : t('notes.deleted'), {
      duration: 5000, // Samsung's undo snackbar stays a little longer than a plain toast
      action: t('common.undo'),
      onAction: () => {
        M.untrash(gone);
        if (ids.length === 1) select(ids[0]);
      },
    });
  }
  async function destroyNotes(ids) {
    if (!ids.length) return;
    const ok = await confirm(ids.length === 1 ? t('notes.destroyQ1') : t('notes.destroyQ', { n: ids.length }), t('notes.destroyMsg'), { okLabel: t('common.delete'), danger: true });
    if (!ok) return;
    if (ids.includes(selectedId)) {
      closeEditor();
      selectedId = null;
      drawEditor();
    }
    M.destroy(ids);
    if (picked) stopSelect();
  }
  async function pickPaper(n) {
    const v = await choose(t('notes.pageTemplate'), M.PAPERS.map((p) => ({ value: p, label: t('notes.paper.' + p) })), n.paper || 'plain');
    if (!v) return;
    M.patch(n.id, { paper: v === 'plain' ? undefined : v }, false);
    editor?.setPaper(v);
  }
  async function fromTemplate() {
    const list = templates();
    const v = await choose(t('notes.fromTemplate'), list.map((x) => ({ value: x.id, label: x.name, sub: x.sub })), list[0].id);
    const tp = list.find((x) => x.id === v);
    if (!tp) return;
    leaveCurrent();
    const n = createNote({ title: tp.title, body: sanitize(tp.body), ...(tp.paper ? { paper: tp.paper } : {}), ...inViewFields() });
    if (view.kind === 'bin' || view.kind === 'tag') setView(ALL);
    selectedId = n.id;
    showEditor(true);
    drawEditor();
    drawList();
    setTimeout(() => editor?.focusBody(), 80);
  }

  // ——— locked notes (the screen lock PIN) ———
  async function needPin() {
    const P = await import('../shell/pin.js');
    if (P.pinSet()) return P;
    const go = await dialog({
      title: t('notes.needPinTitle'),
      message: t('notes.needPinMsg'),
      actions: [{ label: t('common.cancel'), value: false }, { label: t('common.settings'), value: true, primary: true }],
    });
    if (go) openApp('settings', { params: { page: 'lock' } });
    return null;
  }
  async function lockNote(id) {
    if (!(await needPin())) return;
    editor?.flush();
    if (selectedId === id) unlocked = id; // it stays open until you leave it
    M.lock(id);
    toast(t('notes.lockedToast'));
    if (selectedId === id) drawEditor();
  }
  async function removeLock(id) {
    if (unlocked !== id) {
      // a note that isn't open asks for the PIN first
      select(id, { user: true });
      return;
    }
    editor?.flush();
    M.unlock(id);
    unlocked = null;
    toast(t('notes.unlockedToast'));
    drawEditor();
  }
  async function drawLockView(n) {
    const P = await import('../shell/pin.js');
    if (selectedId !== n.id || editor) return;
    lockPad?.destroy();
    const pad = (lockPad = P.keypad({
      mode: 'page',
      title: t('notes.lockedTitle'),
      sub: t('notes.lockedSub'),
      len: P.autoConfirm() ? P.pinDigits() : 0,
      onSubmit: async (pin) => {
        const r = await P.tryPin(pin);
        if (r.ok) {
          unlocked = n.id;
          setTimeout(() => drawEditor(), 0);
          return true;
        }
        return r.wait ? { wait: r.wait } : P.wrongText(r.n);
      },
    }));
    if (P.waitLeft()) pad.wait(P.waitLeft());
    editorWrap.style.cssText = '';
    editorWrap.classList.remove('tinted');
    editorWrap.replaceChildren(h('div', { class: 'notes-lockview' },
      h('div', { class: 'note-top' }, iconBtn('back', () => showEditor(false), t('common.back'))),
      h('div', { class: 'notes-lock-head' }, h('span', { class: 'notes-lock-badge', html: icon('lock', 26) }), h('div', { class: 'notes-lock-title' }, n.title || t('notes.locked'))),
      pad.el));
    setTimeout(() => pad.el.focus({ preventScroll: true }), 60);
  }

  // ——— folders ———
  async function folderDialog(f) {
    let color = f?.color || M.FOLDER_COLORS[(M.folders().length + 5) % M.FOLDER_COLORS.length];
    const input = h('input', { class: 'ou-input', placeholder: t('notes.folderName'), value: f?.name || '', maxlength: 60, 'aria-label': t('notes.folderName') });
    const sws = h('div', { class: 'notes-fcolors' });
    const drawSw = () => sws.replaceChildren(...M.FOLDER_COLORS.map((c, i) => h('button', { type: 'button', class: ['notes-fcolor', c === color && 'on'], style: { '--fc': c }, 'aria-label': t('notes.folderColor') + ' ' + (i + 1), title: t('notes.folderColor'), onClick: () => { color = c; drawSw(); } })));
    drawSw();
    const v = await dialog({
      title: f ? t('notes.editFolder') : t('notes.newFolder'),
      content: h('div', { class: 'ou-dialog-body notes-fdlg' }, input, h('div', { class: 'notes-fdlg-label' }, t('notes.folderColor')), sws),
      actions: [{ label: t('common.cancel'), value: null }, { label: f ? t('common.save') : t('notes.create'), value: () => input.value.trim(), primary: true, validate: () => !!input.value.trim() }],
    });
    if (!v) return null;
    if (f) {
      M.editFolder(f.id, { name: v.slice(0, 60), color });
      return M.folderById(f.id);
    }
    return M.newFolder(v, color);
  }
  async function deleteFolder(f) {
    const n = M.folderCount(f.id);
    const ok = await confirm(t('notes.delFolderQ'), n ? t('notes.delFolderMsg', { n }) : t('notes.delFolderEmpty'), { okLabel: t('common.delete'), danger: true });
    if (!ok) return;
    if (view.kind === 'folder' && view.id === f.id) setView(ALL);
    M.deleteFolder(f.id);
  }

  // ——— the navigation drawer ———
  let drawer = null;
  function openDrawer() {
    const item = (ic, label, count, v, extra = {}) => h('button', {
      class: ['notes-dw-item', sameView(v) && 'on'], style: extra.color ? { '--fc': extra.color } : null, dataset: { view: v.kind + (v.id ? ':' + v.id : '') },
      onClick: () => { closeDrawer(); setView(v); },
      onContextmenu: extra.menu ? (e) => { e.preventDefault(); extra.menu(e); } : null,
    }, h('span', { class: ['notes-dw-ico', extra.color && 'dot'], html: extra.color ? '' : icon(ic, 22) }), h('span', { class: 'notes-dw-label' }, label), count != null ? h('span', { class: 'notes-dw-count' }, String(count)) : null);
    const tags = M.allTags();
    const folders = M.folders();
    const panel = h('div', { class: 'notes-dw', role: 'dialog', 'aria-label': t('notes.drawer') },
      h('div', { class: 'notes-dw-title' }, t('app.notes')),
      item('note', t('notes.all'), M.all().length, ALL),
      item('star', t('notes.favs'), M.all().filter((n) => n.fav).length, { kind: 'fav' }),
      item('ntBin', t('notes.bin'), M.bin().length || null, { kind: 'bin' }),
      h('div', { class: 'notes-dw-div' }),
      h('div', { class: 'notes-dw-h' }, h('span', null, t('notes.folders')),
        h('button', { class: 'ou-icon-btn notes-dw-add', title: t('notes.newFolder'), 'aria-label': t('notes.newFolder'), html: icon('plus', 20), onClick: async () => { closeDrawer(); const f = await folderDialog(); if (f) setView({ kind: 'folder', id: f.id }); } })),
      ...folders.map((f) => item('folder', f.name, M.folderCount(f.id), { kind: 'folder', id: f.id }, {
        color: f.color,
        menu: (e) => menu(e, [
          { label: t('notes.editFolder'), icon: 'edit', onClick: () => { closeDrawer(); folderDialog(f); } },
          { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => { closeDrawer(); deleteFolder(f); } },
        ]),
      })),
      folders.length ? null : h('div', { class: 'notes-dw-hint' }, t('notes.noFolders')),
      tags.length ? h('div', { class: 'notes-dw-div' }) : null,
      tags.length ? h('div', { class: 'notes-dw-h' }, h('span', null, t('notes.tags'))) : null,
      ...tags.map((x) => item('ntTag', x.name, x.count, { kind: 'tag', id: x.key })));
    const scrim = h('div', { class: 'notes-dw-scrim', onPointerdown: () => closeDrawer() });
    drawer = h('div', { class: 'notes-dw-wrap' }, scrim, panel);
    page.el.appendChild(drawer);
    requestAnimationFrame(() => drawer?.classList.add('show'));
    panel.querySelector('.notes-dw-item.on, .notes-dw-item')?.focus({ preventScroll: true });
  }
  function closeDrawer() {
    const dw = drawer;
    drawer = null;
    if (!dw) return;
    dw.classList.remove('show');
    setTimeout(() => dw.remove(), 260);
  }
  const sameView = (v) => v.kind === view.kind && (v.id || null) === (view.id || null);
  function setView(v) {
    if (sameView(v)) return;
    if (picked) picked = null, selbar.hidden = true, selActs.hidden = true, side.classList.remove('selecting');
    leaveCurrent();
    view = v;
    query = '';
    searchInput.value = '';
    const first = listItems()[0];
    selectedId = first && !root.classList.contains('narrow') ? first.id : null;
    showEditor(false);
    drawEditor();
    drawList();
  }
  const inViewFields = () => (view.kind === 'folder' ? { folder: view.id } : view.kind === 'fav' ? { fav: true } : {});

  // ——— the editor pane ———
  function closeEditor() {
    editor?.destroy();
    editor = null;
    lockPad?.destroy();
    lockPad = null;
  }
  function leaveCurrent() {
    if (editor) {
      editor.flush();
      const cur = M.byId(editor.id);
      if (cur && isEmptyNote(cur)) store.set(M.KEY, M.all().filter((n) => n.id !== cur.id));
    }
    closeEditor();
    unlocked = null;
  }
  function select(id, { focus = false, user = false } = {}) {
    if (user) showEditor(true);
    if (editor?.id === id || (selectedId === id && lockPad)) return;
    leaveCurrent();
    selectedId = id;
    drawEditor({ focus });
    drawList();
  }
  function newNote() {
    if (editor) {
      const cur = M.byId(editor.id);
      if (cur && isEmptyNote(cur)) return editor.focusTitle();
    }
    leaveCurrent();
    if (isBin() || view.kind === 'tag') setView(ALL);
    const n = createNote(inViewFields());
    selectedId = n.id;
    showEditor(true);
    drawEditor({ focus: true });
    drawList();
  }

  function drawEditor({ focus = false } = {}) {
    closeEditor();
    const binN = M.binById(selectedId);
    const n = M.byId(selectedId) || binN;
    if (!n) {
      editorWrap.style.cssText = '';
      editorWrap.classList.remove('tinted');
      editorWrap.replaceChildren(h('div', { class: 'ou-empty notes-placeholder' }, h('span', { html: icon('note', 64) }), t('notes.select')));
      return;
    }
    if (n.locked && unlocked !== n.id) return void drawLockView(n);
    const common = {
      body: n.locked ? M.lockedBody(n) : n.body,
      info: () => {
        const cur = M.byId(n.id) || n;
        const f = M.folderById(M.folderOf(cur) || '');
        const tags = [...new Map([...M.allTags()].filter((x) => M.hasTag(cur, x.key)).map((x) => [x.key, x.name]))];
        return { folder: f ? { name: f.name, color: f.color } : null, tags };
      },
      onTag: (k) => setView({ kind: 'tag', id: k }),
      onFolder: () => moveNotes([n.id]),
    };
    if (binN) {
      editor = createEditor(editorWrap, n, {
        ...common,
        readOnly: true,
        roText: M.daysLeft(n) === 1 ? t('notes.day1') : t('notes.days', { n: M.daysLeft(n) }),
        actions: {
          back: () => showEditor(false),
          restore: () => { M.restore([n.id]); toast(t('notes.restored', { n: 1 })); },
          destroy: () => destroyNotes([n.id]),
        },
      });
      return;
    }
    editor = createEditor(editorWrap, n, {
      ...common,
      pinned: () => !!M.byId(n.id)?.pinned,
      save: ({ title, body }) => {
        lastLocalSave = Date.now();
        if (M.byId(n.id)?.locked) M.saveLocked(n.id, title, body);
        else M.patch(n.id, { title, body });
      },
      actions: {
        back: () => {
          showEditor(false);
          leaveCurrent();
          selectedId = null;
          drawEditor();
          drawList();
        },
        color: (anchor) => colorPop(anchor, n.id),
        pin: () => {
          const cur = M.byId(n.id);
          M.patch(n.id, { pinned: !cur?.pinned }, false);
          editor?.setPinned(!cur?.pinned);
        },
        remove: () => removeNotes([n.id]),
        more: (anchor) => editorMenu(anchor),
      },
    });
    editor.locked = !!n.locked;
    editorWrap._editor = editor; // tests reach the open editor through its pane
    if (focus) setTimeout(() => editor && (n.title ? editor.focusBody() : editor.focusTitle()), 80);
  }

  function colorPop(anchor, id) {
    const cur = M.byId(id);
    if (!cur) return;
    const pop = h('div', { class: 'note-colors', role: 'dialog', 'aria-label': t('notes.color') },
      Object.entries(NOTE_COLORS).map(([k, v]) =>
        h('button', {
          class: ['note-color', k === (NOTE_COLORS[cur.color] ? cur.color : 'none') && 'active', k === 'none' && 'none'],
          style: v ? `--nc:${v}` : '',
          title: t('notes.c.' + k),
          'aria-label': t('notes.c.' + k),
          dataset: { c: k },
          onClick: () => {
            M.patch(id, { color: k }, false);
            editor?.setTint(k);
            closePop();
          },
        })));
    const r = anchor.getBoundingClientRect();
    const scrim = h('div', { class: 'ou-menu-scrim', onPointerdown: (e) => e.target === scrim && closePop() }, pop);
    (document.getElementById('overlay-layer') || document.body).appendChild(scrim);
    pop.style.top = r.bottom + 6 + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    requestAnimationFrame(() => pop.classList.add('show'));
    // Esc closes the popover (not the Notes window behind it), like ui.js menus
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), e.preventDefault(), closePop());
    addEventListener('keydown', onKey, true);
    scrim._close = closePop;
    function closePop() {
      removeEventListener('keydown', onKey, true);
      scrim.remove();
    }
  }

  // ——— keep in step with storage (other tabs, the side panel, Finder) ———
  const offs = [
    store.on(M.KEY, () => {
      drawList();
      const cur = M.byId(selectedId);
      if (editor && cur && !editor.readOnly) {
        if (Date.now() - lastLocalSave > 1500) editor.refresh({ title: cur.title, body: cur.locked ? M.lockedBody(cur) : cur.body });
        editor.setPinned(cur.pinned);
        editor.setTint(cur.color);
        editor.setPaper(cur.paper);
        editor.drawInfo();
        if (!!cur.locked !== !!editor.locked) drawEditor();
      }
      if (selectedId && !cur && !M.binById(selectedId)) {
        selectedId = null;
        closeEditor();
        drawEditor();
      } else if (selectedId && !cur && M.binById(selectedId) && editor && !editor.readOnly) {
        // deleted in another tab while open here
        closeEditor();
        selectedId = null;
        drawEditor();
      }
    }),
    store.on(M.BIN, () => {
      drawList();
      if (selectedId && editor?.readOnly && !M.binById(selectedId)) {
        // restored or deleted for good
        if (M.byId(selectedId)) drawEditor();
        else {
          selectedId = null;
          drawEditor();
        }
      }
    }),
    store.on(M.FOLDERS, () => {
      drawList();
      editor?.drawInfo();
    }),
    store.on('notesView', drawList),
  ];
  // the screen locking locks an open locked note again
  const lockWatch = new MutationObserver(() => {
    if (document.body.classList.contains('locked') && unlocked) {
      editor?.flush();
      unlocked = null;
      closeEditor();
      drawEditor();
    }
  });
  lockWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  ctx.setParams = (p) => {
    if (p?.id && M.byId(p.id)) {
      if (!M.inView(view).some((n) => n.id === p.id)) setView(ALL);
      select(p.id, { focus: true, user: true });
    } else if (p?.new) newNote();
  };

  const first = sorted(M.all())[0];
  if (ctx.params?.id || ctx.params?.new) ctx.setParams(ctx.params);
  else if (first) select(first.id);
  else {
    drawEditor();
    drawList();
  }
  if (!selectedId) drawList();

  const onKey = (e) => {
    if (!ctx.focused) return;
    if (lockPad && lockPad.el.isConnected && !document.querySelector('.ou-dialog-scrim, .ou-menu-scrim') && lockPad.key(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' && drawer) {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
      return;
    }
    if (e.key === 'Escape' && picked && !document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) {
      e.preventDefault();
      e.stopPropagation();
      stopSelect();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
      e.preventDefault();
      searchInput.focus();
    }
  };
  addEventListener('keydown', onKey, true);

  return () => {
    leaveCurrent();
    offs.forEach((f) => f());
    offLong();
    ro.disconnect();
    lockWatch.disconnect();
    closeDrawer();
    removeEventListener('keydown', onKey, true);
  };
}
