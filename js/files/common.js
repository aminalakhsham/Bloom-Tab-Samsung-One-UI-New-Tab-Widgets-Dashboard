// My Files: file tiles (Samsung-style type icons, picture previews, the computer's own icon for programs) and the
// small formatting helpers shared by the app, its widgets and Finder.
import { h, sameDay } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, locale, isRtl, fmtTime, fmtDate } from '../core/i18n.js';
import * as M from './model.js';
import { osIcon } from './data.js';

const DOC = 'M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z';
addIcons({
  mfVideo: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M10.2 9.3v5.4l4.6-2.7Z" fill="currentColor"/>',
  mfDoc: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8M8.6 12.5h6.8M8.6 16h4.6"/>`,
  mfFile: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8"/>`,
  mfSheet: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8M8.6 11.5h6.8v6H8.6ZM8.6 14.5h6.8M12 11.5v6"/>`,
  mfSlides: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8"/><rect x="8.4" y="11.5" width="7.2" height="5" rx=".9"/>`,
  mfText: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8M8.6 11.5h6.8M8.6 14.2h6.8M8.6 16.9h4"/>`,
  mfPdf: `<path d="${DOC}"/><path d="M13.5 3.7V8.5h4.8M9 17c1.6-1 3-3.6 3.2-5.6.2-1.4-1.2-1.4-1.2 0 0 2 2.2 4.5 4 4.7 1.2.1 1.1-1-.1-1.1-2-.2-4.4.8-5.9 2Z"/>`,
  mfBook: '<path d="M5 18.5V5.6A2.1 2.1 0 0 1 7.1 3.5h11.4v13.7H7.2A2.2 2.2 0 0 0 5 19.4a2.1 2.1 0 0 0 2.1 2.1h11.4v-4.3"/><path d="M9 7.5h6"/>',
  mfZip: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.6"/><path d="M12 3.6v1.8M12 7.2V9M12 10.8v1.8"/><rect x="10.4" y="13.6" width="3.2" height="3.6" rx="1"/>',
  mfBox: '<path d="M12 3.2 19.8 7.4v9.2L12 20.8l-7.8-4.2V7.4Z"/><path d="M4.4 7.5 12 11.7l7.6-4.2M12 11.7v9"/>',
  mfStorage: '<ellipse cx="12" cy="6" rx="7.3" ry="2.7"/><path d="M4.7 6v12c0 1.5 3.3 2.7 7.3 2.7s7.3-1.2 7.3-2.7V6M4.7 12c0 1.5 3.3 2.7 7.3 2.7s7.3-1.2 7.3-2.7"/>',
  mfFolderOpen: '<path d="M3.5 18V6.5A1.5 1.5 0 0 1 5 5h4l2 2h7a1.5 1.5 0 0 1 1.5 1.5V10"/><path d="M3.5 18 6 11.3a1.5 1.5 0 0 1 1.4-1h12.2a1 1 0 0 1 .9 1.3L18.3 18a1.5 1.5 0 0 1-1.4 1H5a1.5 1.5 0 0 1-1.5-1Z"/>',
  mfRestore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  mfArrUp: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
  mfArrDown: '<path d="M12 5v13.5M6.5 13 12 18.5l5.5-5.5"/>',
  mfFiles: '<path d="M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H5.5A1.5 1.5 0 0 0 4 6.5"/>',
});

export const KIND_ICON = { image: 'image', video: 'mfVideo', audio: 'music', pdf: 'mfPdf', word: 'mfDoc', sheet: 'mfSheet', slides: 'mfSlides', text: 'mfText', ebook: 'mfBook', archive: 'mfZip', installer: 'mfBox', other: 'mfFile' };
export const KIND_COLOR = { image: '#9a5cf5', video: '#f04a68', audio: '#ff8a2a', pdf: '#e5483f', word: '#2f6fe4', sheet: '#1e9e57', slides: '#f06a2a', text: '#5f7189', ebook: '#0f9fb0', archive: '#e0a100', installer: '#2fae5d', other: '#7d8392' };
export const CAT_ICON = { images: 'image', videos: 'mfVideo', audio: 'music', docs: 'mfDoc', downloads: 'download', archives: 'mfBox', other: 'mfFile' };
// kinds whose tile shows the extension under the glyph, as Samsung's document icons do
const LABELLED = new Set(['pdf', 'word', 'sheet', 'slides', 'text', 'ebook', 'archive', 'installer', 'other']);

// sizes sit inside Arabic sentences ("544 KB من 8 MB"): an LTR isolate keeps "8 MB" from turning into "MB 8"
export const ltr = (text) => (isRtl() ? `\u2066${text}\u2069` : text);
export const size = (bytes) => ltr(M.fmtSize(bytes, locale()));
export const name = (d) => M.baseName(d.filename) || M.baseName(d.finalUrl || d.url) || t('common.untitled');
export const catName = (c) => t('files.cat.' + c);

/** "2:31 PM" today, "Oct 24" this year, "Oct 24, 2025" before. */
export function when(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (sameDay(d, new Date())) return fmtTime(d);
  return fmtDate(d, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
/** Date and time for Details. */
export const fullDate = (ms) => (ms ? `${fmtDate(new Date(ms), { year: 'numeric', month: 'long', day: 'numeric' })} ${fmtTime(new Date(ms))}` : '—');

/**
 * The square tile for a file: a picture preview when one can be shown without fetching anything, the computer's own
 * icon for programs and unknown files (when Chrome has one), otherwise a tinted Samsung-style type icon.
 * `big` draws a larger glyph (grid view, Recent files).
 */
export function fileTile(d, { big = false } = {}) {
  const kind = M.kindOf(d), ext = M.extOf(d.filename || d.name);
  const el = h('span', { class: ['mf-tile', 'k-' + kind, big && 'big'], style: { '--fc': KIND_COLOR[kind] }, 'aria-hidden': 'true' },
    h('span', { class: 'mf-tile-ico', html: icon(KIND_ICON[kind], big ? 34 : 22) }),
    LABELLED.has(kind) && ext && ext.length <= 4 ? h('span', { class: 'mf-tile-ext' }, ext.toUpperCase()) : null);
  const thumb = M.dataThumb(d);
  if (thumb) {
    const img = h('img', { class: 'mf-thumb', alt: '', loading: 'lazy', decoding: 'async', src: thumb });
    img.addEventListener('load', () => el.classList.add('has-thumb'));
    img.addEventListener('error', () => img.remove());
    el.appendChild(img);
  } else if ((kind === 'installer' || kind === 'other') && d.id != null && d.state === 'complete' && d.exists !== false) {
    osIcon(d.id).then((src) => {
      if (!src) return;
      el.classList.add('has-os');
      el.querySelector('.mf-tile-ico').replaceChildren(h('img', { class: 'mf-osicon', alt: '', src }));
    });
  }
  return el;
}

/** Round coloured category icon (home screen, search chips). */
export const catIcon = (c, px = 24) => h('span', { class: 'mf-catico', style: { '--cc': M.CAT_COLOR[c] }, html: icon(CAT_ICON[c], px) });
