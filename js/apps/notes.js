// Samsung Notes: registration, widgets and Finder search. The app itself (drawer with folders, tags, Favourites and
// Recently deleted; the list; the rich editor with pictures, drawings, tables, checklists, text colours, page styles,
// locked notes and Writing assist) loads from js/notes/ when the app opens. The note body format is in js/notes/html.js
// and the data keys in js/notes/model.js; this file keeps the small helpers other surfaces import (the side panel,
// Quick capture, Routines): createNote, sanitize, noteText, NOTE_COLORS.
import { h, uid, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtDate, fmtTime } from '../core/i18n.js';
import { sanitize, noteText } from '../notes/html.js';

export { sanitize, noteText };

addStrings({
  en: {
    'app.notes': 'Notes',
    'notes.search': 'Search notes',
    'notes.titlePh': 'Title',
    'notes.bodyPh': 'Start writing…',
    'notes.new': 'New note',
    'notes.count': '{n} notes',
    'notes.count1': '1 note',
    'notes.empty': 'No notes',
    'notes.emptyHint': 'Tap + to write your first note',
    'notes.noResults': 'No results',
    'notes.select': 'Select a note to view it here',
    'notes.deleted': 'Moved to Recently deleted',
    'notes.pin': 'Pin to top',
    'notes.unpin': 'Unpin',
    'notes.color': 'Note color',
    'notes.sortModified': 'Sort by date modified',
    'notes.sortCreated': 'Sort by date created',
    'notes.sortTitle': 'Sort by title',
    'notes.viewList': 'List view',
    'notes.viewGrid': 'Grid view',
    'notes.bold': 'Bold',
    'notes.italic': 'Italic',
    'notes.underline': 'Underline',
    'notes.strike': 'Strikethrough',
    'notes.bullets': 'Bulleted list',
    'notes.numbers': 'Numbered list',
    'notes.checklist': 'Checklist',
    'notes.copy': 'Copy text',
    'notes.copied': 'Copied to clipboard',
    'notes.export': 'Save as file',
    'notes.pinned': 'Pinned',
    'notes.others': 'Notes',
    'notes.edited': 'Edited {time}',
    'notes.locked': 'Locked note',
    'widget.notes': 'Notes',
  },
  ar: {
    'app.notes': 'الملاحظات',
    'notes.search': 'البحث في الملاحظات',
    'notes.titlePh': 'العنوان',
    'notes.bodyPh': 'ابدأ الكتابة…',
    'notes.new': 'ملاحظة جديدة',
    'notes.count': '{n} ملاحظات',
    'notes.count1': 'ملاحظة واحدة',
    'notes.empty': 'لا توجد ملاحظات',
    'notes.emptyHint': 'اضغط + لكتابة أول ملاحظة',
    'notes.noResults': 'لا توجد نتائج',
    'notes.select': 'اختر ملاحظة لعرضها هنا',
    'notes.deleted': 'تم النقل إلى المحذوفة مؤخرًا',
    'notes.pin': 'تثبيت في الأعلى',
    'notes.unpin': 'إلغاء التثبيت',
    'notes.color': 'لون الملاحظة',
    'notes.sortModified': 'الترتيب حسب تاريخ التعديل',
    'notes.sortCreated': 'الترتيب حسب تاريخ الإنشاء',
    'notes.sortTitle': 'الترتيب حسب العنوان',
    'notes.viewList': 'عرض القائمة',
    'notes.viewGrid': 'عرض الشبكة',
    'notes.bold': 'غامق',
    'notes.italic': 'مائل',
    'notes.underline': 'تسطير',
    'notes.strike': 'يتوسطه خط',
    'notes.bullets': 'قائمة نقطية',
    'notes.numbers': 'قائمة مرقمة',
    'notes.checklist': 'قائمة مهام',
    'notes.copy': 'نسخ النص',
    'notes.copied': 'تم النسخ إلى الحافظة',
    'notes.export': 'حفظ كملف',
    'notes.pinned': 'مثبتة',
    'notes.others': 'الملاحظات',
    'notes.edited': 'تم التعديل {time}',
    'notes.locked': 'ملاحظة مقفلة',
    'widget.notes': 'الملاحظات',
  },
});

export const NOTE_COLORS = {
  none: null,
  yellow: '#f5c400',
  orange: '#ff8a3d',
  red: '#f2556b',
  purple: '#9a6cf2',
  blue: '#3e8bff',
  green: '#2fb36b',
  gray: '#8a8d96',
};

const notes = () => (Array.isArray(store.get('notes')) ? store.get('notes') : []);
export const viewPrefs = () => ({ sort: 'modified', layout: 'list', ...(store.get('notesView') || {}) });
export const isEmptyNote = (n) => !n.title?.trim() && !n.locked && !noteText(n.body) && !/<(figure|table|hr)/.test(n.body || '');
export const colorVar = (c) => (NOTE_COLORS[c] ? `--nc:${NOTE_COLORS[c]}` : '');
/** What a note may show outside the app: a locked note shows no text. */
const shownText = (n) => (n.locked ? '' : noteText(n.body));

export function fmtWhen(ms) {
  const d = new Date(ms);
  if (sameDay(d, new Date())) return fmtTime(d);
  return fmtDate(d, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function sorted(list, sort = viewPrefs().sort) {
  const name = (n) => n.title || (n.locked ? '' : noteText(n.body));
  const by = sort === 'created' ? (a, b) => b.created - a.created : sort === 'title' ? (a, b) => name(a).localeCompare(name(b)) : (a, b) => b.updated - a.updated;
  return [...list].sort((a, b) => (!!b.pinned - !!a.pinned) || by(a, b));
}

export function createNote(fields = {}) {
  const n = { id: uid(), title: '', body: '', color: 'none', pinned: false, created: Date.now(), updated: Date.now(), ...fields };
  store.update('notes', (l) => [n, ...(Array.isArray(l) ? l : [])]);
  return n;
}

registerApp({
  id: 'notes',
  name: 'app.notes',
  icon: {
    bg: 'linear-gradient(145deg, #ffb35c 0%, #ff6a3d 100%)',
    glyph: '<path d="M7 3.8h7.5L18 7.3v6.2"/><path d="M6 3.8a1.2 1.2 0 0 0-1.2 1.2v14a1.2 1.2 0 0 0 1.2 1.2h5"/><path d="M8 9h6M8 12.5h4"/><path d="m14 20.2.5-2.6 5.2-5.2a1.4 1.4 0 0 1 2 2l-5.2 5.2-2.5.6Z" stroke-width="1.7"/>',
  },
  keywords: ['memo', 'notes', 'samsung notes', 'ملاحظات', 'مذكرة'],
  size: 'wide',
  render: (ctx) => import('../notes/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.toLowerCase();
    return sorted(notes())
      .filter((n) => (n.title || '').toLowerCase().includes(q) || shownText(n).toLowerCase().includes(q))
      .slice(0, 5)
      .map((n) => {
        const text = shownText(n).replace(/\s+/g, ' ');
        return {
          title: n.title || text.slice(0, 60) || t('common.untitled'),
          sub: n.locked ? t('notes.locked') : n.title ? text.slice(0, 80) : fmtWhen(n.updated),
          icon: n.locked ? 'lock' : 'note',
          onOpen: () => openApp('notes', { params: { id: n.id } }),
        };
      });
  },
});

// ——— widget ———
registerWidget({
  id: 'notes',
  name: 'widget.notes',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'notes',
  onClick(item, el) {
    const n = sorted(notes()).filter((x) => !isEmptyNote(x))[0];
    openApp('notes', { from: el, params: item.size === 's' && n ? { id: n.id } : undefined });
  },
  render(el, { size }) {
    el.classList.add('wg-notes');
    const setTint = (c) => {
      if (c) el.style.setProperty('--nc', c);
      else el.style.removeProperty('--nc');
      el.classList.toggle('tinted', !!c);
    };
    const draw = () => {
      setTint(null);
      const list = sorted(notes()).filter((n) => !isEmptyNote(n));
      const addBtn = h('button', {
        class: 'wg-notes-add',
        title: t('notes.new'),
        html: icon('plus', 18),
        onClick: (e) => {
          e.stopPropagation();
          openApp('notes', { from: el, params: { new: true } });
        },
      });
      if (!list.length) {
        el.replaceChildren(
          h('div', { class: 'wg-notes-head' }, h('span', { class: 'wg-notes-ico', html: icon('note', 16) }), h('span', { class: 'wg-notes-label' }, t('widget.notes')), addBtn),
          h('div', { class: 'wg-notes-empty' }, t('notes.empty')));
        return;
      }
      if (size === 's') {
        const n = list[0];
        const text = shownText(n);
        setTint(NOTE_COLORS[n.color]);
        el.replaceChildren(
          h('div', { class: 'wg-notes-head' }, h('span', { class: 'wg-notes-ico', html: icon(n.locked ? 'lock' : n.pinned ? 'pin' : 'note', 16) }), h('span', { class: 'wg-notes-label' }, fmtWhen(n.updated)), addBtn),
          h('div', { class: 'wg-notes-title' }, n.title || text.split('\n')[0] || t('common.untitled')),
          n.locked
            ? h('div', { class: 'wg-notes-text wg-notes-lock' }, h('span', { html: icon('lock', 14) }), t('notes.locked'))
            : h('div', { class: 'wg-notes-text' }, n.title ? text : text.split('\n').slice(1).join('\n')));
        return;
      }
      el.replaceChildren(
        h('div', { class: 'wg-notes-head' }, h('span', { class: 'wg-notes-ico', html: icon('note', 16) }), h('span', { class: 'wg-notes-label' }, t('widget.notes')), addBtn),
        h('div', { class: 'wg-notes-list' },
          list.slice(0, 3).map((n) => {
            const text = shownText(n).replace(/\s+/g, ' ');
            return h('div', {
              class: 'wg-notes-row',
              style: colorVar(n.color),
              onClick: (e) => {
                e.stopPropagation();
                openApp('notes', { from: el, params: { id: n.id } });
              },
            },
              h('span', { class: ['wg-notes-dot', !NOTE_COLORS[n.color] && 'none'] }),
              h('span', { class: 'wg-notes-row-text' },
                h('span', { class: 'wg-notes-row-title' }, n.title || text.slice(0, 50) || t('common.untitled')),
                n.locked ? h('span', { class: 'wg-notes-row-sub' }, t('notes.locked')) : n.title && text ? h('span', { class: 'wg-notes-row-sub' }, text) : null),
              h('span', { class: 'wg-notes-row-date' }, fmtWhen(n.updated)));
          })));
    };
    draw();
    return store.on('notes', draw);
  },
});
