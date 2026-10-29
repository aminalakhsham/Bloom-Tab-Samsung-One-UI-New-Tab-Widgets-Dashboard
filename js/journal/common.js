// Shared pieces of the Journal UI: names and dates, pictures from IndexedDB, and the entry card used by the list, the
// calendar and the Recycle bin.
import { h, $$, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime } from '../core/i18n.js';
import { blobUrl } from '../core/blobs.js';
import * as M from './model.js';
import { pl } from './data.js';
import { moodFace, moodName } from './mood.js';
import { kindInfo } from './suggestions.js';
import { promptText } from './prompts.js';

export const journalName = (j) => j?.name || t('app.journal');
export const thisYear = (ms) => new Date(ms).getFullYear() === new Date().getFullYear();
/** "Today", "Yesterday", a weekday this week, else "Oct 24" (with the year when it isn't this year). */
export function dayLabel(ms, now = Date.now()) {
  const n = Math.round((+M.keyDate(M.dayKey(now)) - +M.keyDate(M.dayKey(ms))) / M.DAY);
  if (n === 0) return t('common.today');
  if (n === 1) return t('common.yesterday');
  if (n > 1 && n < 7) return fmtDate(new Date(ms), { weekday: 'long' });
  return fmtDate(new Date(ms), thisYear(ms) ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
export const longDate = (ms) => fmtDate(new Date(ms), { weekday: 'long', month: 'long', day: 'numeric', ...(thisYear(ms) ? {} : { year: 'numeric' }) });
export const monthLabel = (ms) => fmtDate(new Date(ms), { month: 'long', year: 'numeric' });
export const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

/** <img data-blob="journal:…"> get their object URL from IndexedDB; a missing picture marks its tile. */
export function hydrate(root) {
  for (const img of $$('img[data-blob]:not([src])', root)) {
    blobUrl(img.dataset.blob).then((u) => {
      if (u) img.src = u;
      else img.closest('.jr-ph')?.classList.add('missing');
    }).catch(() => {});
  }
}

export function momentRow(m, cls = 'jr-mo') {
  const k = kindInfo(m.kind);
  const sub = [m.sub, m.at ? dayLabel(m.at) : ''].filter(Boolean).join(' · ');
  return h('div', { class: cls, style: { '--mc': m.color || k.color } },
    h('span', { class: 'jr-mo-ico', html: icon(k.icon, 16) }),
    h('span', { class: 'jr-mo-t' }, h('b', null, m.title || ''), sub ? h('small', null, sub) : null));
}

/** The photo strip of a card: up to 3 tiles, the last one showing how many more there are. */
function strip(e) {
  const all = e.media || [];
  if (!all.length) return null;
  const list = all.slice(0, 3);
  return h('div', { class: ['jr-strip', 'n' + list.length] }, list.map((m, i) =>
    h('span', { class: ['jr-ph', m.k === 'draw' && 'draw'] },
      h('img', { dataset: { blob: m.id }, alt: '', loading: 'lazy' }),
      i === 2 && all.length > 3 ? h('b', { class: 'jr-ph-more' }, '+' + (all.length - 3)) : null)));
}

/**
 * An entry as a One UI card. opts: { d, onOpen(e), onMenu(e, at), showJournal, deleted }
 */
export function entryCard(e, { d, onOpen, onMenu, showJournal = true, deleted = false } = {}) {
  const j = M.journalById(d, M.journalOf(d, e));
  const mood = e.mood && M.moodOf(e.mood.level);
  const date = new Date(e.at);
  const title = e.title || firstLine(e.text);
  const body = e.title ? e.text : e.text.split('\n').filter((l, i, a) => i > a.findIndex((x) => x.trim())).join('\n');
  const meta = [fmtTime(date), showJournal && d.journals.length > 1 ? journalName(j) : ''].filter(Boolean).join(' · ');
  const chips = [
    e.place ? h('span', { class: 'jr-chip' }, h('span', { html: icon('location', 14) }), e.place) : null,
    ...(e.tags || []).slice(0, 4).map((x) => h('span', { class: 'jr-chip tag' }, '#' + x)),
  ].filter(Boolean);
  const card = h('article', {
    class: ['jr-card', deleted && 'deleted'],
    tabindex: 0,
    role: 'button',
    'aria-label': [longDate(e.at), title].filter(Boolean).join(', '),
    dataset: { id: e.id },
    style: { '--jc': j?.color || M.ACCENT },
    onClick: (ev) => onOpen?.(e, ev),
    onKeydown: (ev) => {
      if (ev.target !== card) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onOpen?.(e, ev);
      }
    },
    onContextmenu: (ev) => {
      if (!onMenu) return;
      ev.preventDefault();
      onMenu(e, ev);
    },
  },
    h('div', { class: 'jr-card-top' },
      h('div', { class: 'jr-dbadge', 'aria-hidden': 'true' }, h('b', null, fmtDate(date, { day: 'numeric' })), h('small', null, fmtDate(date, { weekday: 'short' }))),
      h('div', { class: 'jr-card-head' },
        h('div', { class: ['jr-card-title', !title && 'muted'] }, title || t('journal.noText')),
        h('div', { class: 'jr-card-meta' }, e.bookmark ? h('span', { class: 'jr-card-bm', html: icon('jr-bookmark-fill', 13) }) : null, h('span', null, meta))),
      mood ? h('span', { class: 'jr-card-mood', title: moodName(mood.level), html: moodFace(mood.level, 30) }) : null),
    e.moment ? momentRow(e.moment) : null,
    e.prompt && M.isPrompt(e.prompt) ? h('div', { class: 'jr-q' }, h('span', { html: icon('sparkle', 14) }), promptText(e.prompt)) : null,
    body.trim() ? h('div', { class: 'jr-card-text' }, body.trim()) : null,
    strip(e),
    chips.length ? h('div', { class: 'jr-chips' }, chips) : null,
    deleted ? h('div', { class: 'jr-card-left' }, pl('journal.daysLeft', M.daysLeft(e))) : null);
  // One UI: a long press (or right-click, or the keyboard's menu key) opens the card's menu
  if (onMenu) onLongPress(card, (ev) => onMenu(e, ev));
  return card;
}
