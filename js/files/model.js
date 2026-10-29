// My Files: pure logic shared by the app, its widgets and the plain-node test (.dev/files-model.mjs). No DOM, no chrome.*.
// A "download" here is Chrome's DownloadItem ({ id, filename, url, finalUrl, mime, fileSize, totalBytes, bytesReceived,
// state, paused, exists, error, startTime, endTime, referrer, danger, canResume }).

export const KEY = 'files'; // { bin: [{ id, at, name, size, mime, url, cat }] }
export const PREFS = 'filesPrefs'; // { sort, dir, view, bin, recent, recentQ }
export const DAY = 864e5;
export const BIN_DAYS = 30;

/** The home screen's categories, in Samsung's order ("Installation files" becomes Archives & installers). */
export const CATS = ['images', 'videos', 'audio', 'docs', 'downloads', 'archives', 'other'];
export const CAT_COLOR = { images: '#9a5cf5', videos: '#f04a68', audio: '#ff8a2a', docs: '#2f7bf5', downloads: '#10a8a0', archives: '#2fae5d', other: '#7d8392' };

const EXT = {
  image: 'jpg jpeg jpe jfif png gif webp bmp svg svgz ico heic heif avif tif tiff dng raw cr2 nef arw psd',
  video: 'mp4 m4v mkv mov avi webm wmv flv 3gp 3g2 mpg mpeg ts mts m2ts ogv',
  audio: 'mp3 wav flac aac ogg oga opus m4a wma mid midi amr aiff aif ape',
  pdf: 'pdf',
  word: 'doc docx docm dot dotx odt rtf pages hwp',
  sheet: 'xls xlsx xlsm xlt ods csv tsv numbers',
  slides: 'ppt pptx pptm pps ppsx odp key',
  text: 'txt md markdown log json xml yaml yml ini cfg conf tex srt vtt ics vcf',
  ebook: 'epub mobi azw azw3 fb2 djvu',
  archive: 'zip rar 7z tar gz tgz bz2 tbz xz txz zst lz lzma cab iso img',
  installer: 'exe msi msix appx dmg pkg deb rpm apk xapk aab appimage flatpak snap crx xpi jar bat sh run',
};
const BY_EXT = {};
for (const [kind, list] of Object.entries(EXT)) for (const e of list.split(' ')) BY_EXT[e] = kind;

/** The file's name without its folder (Windows or POSIX path). */
export const baseName = (path) => String(path || '').split(/[\\/]/).pop();
/** The folder the file is in (without the trailing separator). */
export const dirName = (path) => String(path || '').replace(/[\\/][^\\/]*$/, '');

/** Lower-case extension without the dot ("" when none). "archive.tar.gz" → "gz". */
export function extOf(name) {
  const b = baseName(name);
  const i = b.lastIndexOf('.');
  return i > 0 && i < b.length - 1 ? b.slice(i + 1).toLowerCase() : '';
}

/** The kind of file, which picks its icon: image, video, audio, pdf, word, sheet, slides, text, ebook, archive, installer, other. */
export function kindOf(d) {
  const k = BY_EXT[extOf(d.filename || d.name)];
  if (k) return k;
  const m = String(d.mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (/zip|compressed|x-tar|x-7z|x-rar|gzip/.test(m)) return 'archive';
  if (/msword|wordprocessing|opendocument\.text|rtf/.test(m)) return 'word';
  if (/spreadsheet|excel|csv/.test(m)) return 'sheet';
  if (/presentation|powerpoint/.test(m)) return 'slides';
  if (/x-msdownload|x-msi|x-apple-diskimage|android\.package|x-debian|x-rpm|x-executable/.test(m)) return 'installer';
  if (m.startsWith('text/')) return 'text';
  return 'other';
}

const CAT_OF_KIND = { image: 'images', video: 'videos', audio: 'audio', pdf: 'docs', word: 'docs', sheet: 'docs', slides: 'docs', text: 'docs', ebook: 'docs', archive: 'archives', installer: 'archives', other: 'other' };
/** Which home-screen category a file belongs to (every file is also in Downloads). */
export const catOf = (d) => CAT_OF_KIND[kindOf(d)];

/** Downloaded and still on disk (as far as Chrome knows). */
export const isDone = (d) => d.state === 'complete' && d.exists !== false;
export const isActive = (d) => d.state === 'in_progress';
/** Chrome created an entry but never picked a file name (e.g. cancelled at the Save as dialog): nothing to show. */
export const isGhost = (d) => !d.filename && d.state !== 'in_progress';

/**
 * The files a view lists. `cat` is a category id; 'downloads' lists every download (in progress, failed and deleted
 * ones too, like Chrome's Downloads page), the others only finished files that still exist. `hidden` is the set of
 * ids in the Recycle bin.
 */
export function inView(items, cat, hidden = new Set()) {
  return items.filter((d) => !hidden.has(d.id) && !isGhost(d) && (cat === 'downloads' || (isDone(d) && (cat === 'all' || catOf(d) === cat))));
}

/** Size on disk, or what Chrome expects while it's still downloading. */
export const sizeOf = (d) => (d.fileSize > 0 ? d.fileSize : d.totalBytes > 0 ? d.totalBytes : d.bytesReceived || 0);
export const timeOf = (d) => Date.parse(d.endTime || d.startTime) || 0;

export const SORTS = ['date', 'name', 'type', 'size'];
const collator = (() => {
  try {
    return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  } catch {
    return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
  }
})();

/** Samsung's sort: Name, Date, Type or Size, ascending or descending; ties fall back to the newest first. */
export function sortItems(items, sort = 'date', dir = 'desc') {
  const s = dir === 'asc' ? 1 : -1;
  const by = {
    date: (a, b) => timeOf(a) - timeOf(b),
    name: (a, b) => collator.compare(baseName(a.filename), baseName(b.filename)),
    type: (a, b) => collator.compare(extOf(a.filename), extOf(b.filename)) || collator.compare(baseName(a.filename), baseName(b.filename)),
    size: (a, b) => sizeOf(a) - sizeOf(b),
  }[sort] || ((a, b) => timeOf(a) - timeOf(b));
  return [...items].sort((a, b) => by(a, b) * s || timeOf(b) - timeOf(a) || b.id - a.id);
}

/** Every word of the query appears in the file name (case and accents ignored). */
export function matches(d, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = fold(baseName(d.filename));
  return words.every((w) => name.includes(w));
}
const fold = (s) => String(s || '').toLocaleLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '');

/** Count and total size per category (Downloads = everything finished). */
export function catStats(items, hidden = new Set()) {
  const out = Object.fromEntries(CATS.map((c) => [c, { n: 0, size: 0 }]));
  for (const d of items) {
    if (hidden.has(d.id) || !isDone(d)) continue;
    const c = out[catOf(d)], all = out.downloads, sz = sizeOf(d);
    c.n++;
    c.size += sz;
    if (c !== all) {
      all.n++;
      all.size += sz;
    }
  }
  return out;
}

/** The newest finished files, for Recent files and the widget. */
export const recent = (items, n = 12, hidden = new Set()) => sortItems(items.filter((d) => isDone(d) && !hidden.has(d.id)), 'date', 'desc').slice(0, n);

/** Overall progress of the downloads in progress: { n, received, total, p } (p is null when a size is unknown). */
export function progressOf(active) {
  let received = 0, total = 0, unknown = false;
  for (const d of active) {
    received += d.bytesReceived || 0;
    if (d.totalBytes > 0) total += d.totalBytes;
    else unknown = true;
  }
  return { n: active.length, received, total, p: !active.length || unknown || !total ? null : Math.min(1, received / total) };
}

// ——— Recycle bin ———
/** Days left before an item that went to the bin on `at` is deleted for good (at least 0). */
export const daysLeft = (at, now = Date.now()) => Math.max(0, Math.ceil((at + BIN_DAYS * DAY - now) / DAY));
export const expired = (bin, now = Date.now()) => (bin || []).filter((b) => now - b.at >= BIN_DAYS * DAY);
/** What the bin remembers about a file (Chrome forgets nothing until it's erased, but the bin must list it even then). */
export const binEntry = (d, now = Date.now()) => ({ id: d.id, at: now, name: baseName(d.filename), size: sizeOf(d), mime: d.mime || '', url: linkOf(d), cat: catOf(d) });

// ——— formatting ———
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
/** "0 B", "740 B", "12.3 KB", "512 KB", "3.4 MB", "1.21 GB" (1000-based, like Samsung and Chrome's Downloads page). */
export function fmtSize(bytes, loc = 'en') {
  let v = Math.max(0, +bytes || 0), u = 0;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1000;
    u++;
  }
  const digits = u === 0 ? 0 : v < 10 ? (u >= 3 ? 2 : 1) : v < 100 ? 1 : 0;
  let n;
  try {
    n = new Intl.NumberFormat(loc, { maximumFractionDigits: digits }).format(v);
  } catch {
    n = String(+v.toFixed(digits));
  }
  return `${n} ${UNITS[u]}`;
}

/** Host of the site a file came from ("" for data: and blob: links). */
export function siteOf(d) {
  for (const u of [d.referrer, d.finalUrl, d.url]) {
    if (!u || !/^https?:/i.test(u)) continue;
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {}
  }
  return '';
}

/** A link worth copying: the file's address, but not a huge data: URL. */
export const linkOf = (d) => {
  const u = d.finalUrl || d.url || '';
  return u.startsWith('data:') && u.length > 2048 ? '' : u;
};

/** Preview picture for an image: data: URLs only (they hold the picture itself, so nothing is fetched). */
export const dataThumb = (d) => (kindOf(d) === 'image' && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)[;,]/i.test(d.url || '') && d.url.length < 4e6 ? d.url : '');
