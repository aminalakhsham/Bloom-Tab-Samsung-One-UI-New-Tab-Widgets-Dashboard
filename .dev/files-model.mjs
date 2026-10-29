// My Files pure logic (js/files/model.js): file kinds and categories, views, sorting, search, stats, progress, the
// Recycle bin's 30 days, sizes and links.  usage: node .dev/files-model.mjs  (exit 1 on failure)
import * as M from '../js/files/model.js';

let pass = 0, fail = 0;
const ok = (c, msg) => (c ? (pass++, console.log('  ok', msg)) : (fail++, console.log('FAIL', msg)));
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (${JSON.stringify(a)})`);

const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
let n = 0;
const dl = (filename, o = {}) => ({ id: ++n, filename, url: 'https://example.com/' + filename.split('/').pop(), mime: '', state: 'complete', exists: true, fileSize: 1000, totalBytes: 1000, bytesReceived: 1000, startTime: iso(o.h ?? n), ...o });

// ——— names ———
eq(M.baseName('/home/me/Downloads/report.pdf'), 'report.pdf', 'baseName (POSIX)');
eq(M.baseName('C:\\Users\\me\\Downloads\\photo.JPG'), 'photo.JPG', 'baseName (Windows)');
eq(M.dirName('/home/me/Downloads/report.pdf'), '/home/me/Downloads', 'dirName');
eq(M.extOf('/x/archive.tar.gz'), 'gz', 'extOf takes the last extension');
eq(M.extOf('/x/.bashrc'), '', 'a dot file has no extension');
eq(M.extOf('/x/README'), '', 'no extension');
eq(M.extOf('C:\\a.b\\file'), '', 'a dot in the folder name is not an extension');

// ——— kinds and categories ———
const kinds = { 'a.png': 'image', 'a.HEIC': 'image', 'a.mkv': 'video', 'a.mp3': 'audio', 'a.pdf': 'pdf', 'a.docx': 'word', 'a.xlsx': 'sheet', 'a.csv': 'sheet', 'a.pptx': 'slides', 'a.txt': 'text', 'a.epub': 'ebook', 'a.zip': 'archive', 'a.7z': 'archive', 'a.exe': 'installer', 'a.dmg': 'installer', 'a.apk': 'installer', 'a.xyz': 'other' };
for (const [f, k] of Object.entries(kinds)) eq(M.kindOf({ filename: '/d/' + f }), k, `kind of ${f}`);
eq(M.kindOf({ filename: '/d/blob', mime: 'image/webp' }), 'image', 'kind from the MIME type when there is no extension');
eq(M.kindOf({ filename: '/d/x', mime: 'application/x-msdownload' }), 'installer', 'Windows program by MIME');
eq(M.kindOf({ filename: '/d/x', mime: 'text/plain' }), 'text', 'text/* is a document');
eq(M.kindOf({ name: 'pic.gif' }), 'image', 'bin entries use name');
const cats = { 'a.jpg': 'images', 'a.mov': 'videos', 'a.flac': 'audio', 'a.pdf': 'docs', 'a.odt': 'docs', 'a.md': 'docs', 'a.rar': 'archives', 'a.msi': 'archives', 'a.bin': 'other' };
for (const [f, c] of Object.entries(cats)) eq(M.catOf({ filename: '/d/' + f }), c, `category of ${f}`);
ok(M.CATS.length === 7 && M.CATS.every((c) => M.CAT_COLOR[c]), 'seven categories, each with a colour');

// ——— views ———
const items = [
  dl('/d/photo 10.png', { h: 1, fileSize: 5_000 }),
  dl('/d/photo 9.png', { h: 2, fileSize: 2_000_000 }),
  dl('/d/movie.mp4', { h: 3, fileSize: 900_000_000 }),
  dl('/d/report.pdf', { h: 4, fileSize: 300_000 }),
  dl('/d/setup.exe', { h: 5, fileSize: 50_000_000 }),
  dl('/d/big.zip', { h: 0.5, state: 'in_progress', fileSize: 0, totalBytes: 10_000, bytesReceived: 2_500 }),
  dl('/d/failed.pdf', { h: 6, state: 'interrupted', error: 'NETWORK_FAILED', fileSize: 0 }),
  dl('/d/gone.png', { h: 7, exists: false }),
  dl('', { h: 8, state: 'interrupted', error: 'USER_CANCELED' }),
  dl('/d/notes.txt', { h: 9, fileSize: 120 }),
];
const id = (f) => items.find((d) => d.filename.endsWith(f)).id;
const names = (l) => l.map((d) => M.baseName(d.filename));
eq(names(M.inView(items, 'images')), ['photo 10.png', 'photo 9.png'], 'Images: finished pictures that still exist');
eq(names(M.inView(items, 'docs')), ['report.pdf', 'notes.txt'], 'Documents: no failed download');
eq(names(M.inView(items, 'archives')), ['setup.exe'], 'Archives & installers: not while downloading');
eq(M.inView(items, 'downloads').length, 9, 'Downloads: everything except the entry without a file name');
ok(M.isGhost(items[8]) && !M.isGhost(items[5]), 'a cancelled Save as is a ghost, a download in progress is not');
const hidden = new Set([id('photo 9.png')]);
eq(names(M.inView(items, 'images', hidden)), ['photo 10.png'], 'files in the Recycle bin are hidden');
ok(!M.inView(items, 'downloads', hidden).some((d) => d.id === id('photo 9.png')), '… in Downloads too');

// ——— sorting ———
const imgs = M.inView(items, 'downloads').filter((d) => M.isDone(d));
eq(names(M.sortItems(imgs, 'name', 'asc')).slice(0, 4), ['movie.mp4', 'notes.txt', 'photo 9.png', 'photo 10.png'], 'name: numeric order (photo 9 before photo 10)');
eq(names(M.sortItems(imgs, 'size', 'desc')).slice(0, 2), ['movie.mp4', 'setup.exe'], 'size: biggest first');
eq(names(M.sortItems(imgs, 'date', 'desc'))[0], 'photo 10.png', 'date: newest first');
eq(names(M.sortItems(imgs, 'date', 'asc'))[0], 'notes.txt', 'date ascending: oldest first');
eq(names(M.sortItems(imgs, 'type', 'asc')).slice(0, 2), ['setup.exe', 'movie.mp4'], 'type: by extension');
const tie = [dl('/d/a.png', { startTime: iso(1) }), dl('/d/b.png', { startTime: iso(1) })];
eq(names(M.sortItems(tie, 'size', 'asc')), ['b.png', 'a.png'], 'ties: newest id first');
ok(M.sortItems(imgs, 'date') !== imgs, 'sortItems returns a new array');

// ——— search ———
ok(M.matches(dl('/d/Quarterly Report.PDF'), 'report'), 'search ignores case');
ok(M.matches(dl('/d/Résumé.docx'), 'resume'), 'search ignores accents');
ok(M.matches(dl('/d/tax return 2025.pdf'), '2025 tax'), 'every word, any order');
ok(!M.matches(dl('/d/tax return.pdf'), 'tax 2025'), 'a missing word fails');
ok(!M.matches(dl('/home/report/x.pdf'), 'report'), 'only the file name, not the folder');
ok(M.matches(dl('/d/x.pdf'), '   '), 'an empty query matches');
ok(M.matches(dl('/d/تقرير المبيعات.pdf'), 'تقرير'), 'Arabic names');

// ——— stats, recent, progress ———
const st = M.catStats(items);
eq([st.images.n, st.images.size], [2, 2_005_000], 'catStats: images count and size');
eq([st.downloads.n, st.downloads.size], [6, 2_005_000 + 900_000_000 + 300_000 + 50_000_000 + 120], 'catStats: Downloads sums every finished file');
eq(st.other.n, 0, 'catStats: empty category');
eq(M.catStats(items, hidden).images.n, 1, 'catStats skips the Recycle bin');
eq(names(M.recent(items, 3)), ['photo 10.png', 'photo 9.png', 'movie.mp4'], 'recent: newest finished files');
eq(M.recent(items, 50).length, 6, 'recent leaves out failed, deleted and running downloads');
const p = M.progressOf([items[5], dl('/d/y', { state: 'in_progress', totalBytes: 30_000, bytesReceived: 7_500 })]);
eq([p.n, p.received, p.total, p.p], [2, 10_000, 40_000, 0.25], 'progressOf adds the downloads up');
eq(M.progressOf([dl('/d/z', { state: 'in_progress', totalBytes: 0, bytesReceived: 9 })]).p, null, 'unknown size: no percentage');
eq(M.progressOf([]).p, null, 'nothing running');
eq(M.sizeOf(items[5]), 10_000, 'size of a running download is the expected size');

// ——— Recycle bin ———
const DAY = M.DAY;
eq(M.daysLeft(NOW, NOW), 30, '30 days left on the day it was deleted');
eq(M.daysLeft(NOW - 29.5 * DAY, NOW), 1, 'half a day left shows 1');
eq(M.daysLeft(NOW - 31 * DAY, NOW), 0, 'never negative');
const bin = [{ id: 1, at: NOW - 31 * DAY }, { id: 2, at: NOW - 30 * DAY }, { id: 3, at: NOW - 29 * DAY }];
eq(M.expired(bin, NOW).map((b) => b.id), [1, 2], 'expired after exactly 30 days');
eq(M.expired(undefined, NOW), [], 'no bin, nothing expired');
const e = M.binEntry(dl('/d/pic.png', { url: 'data:image/png;base64,' + 'A'.repeat(5000), mime: 'image/png', fileSize: 70 }), NOW);
eq([e.name, e.size, e.cat, e.at, e.url], ['pic.png', 70, 'images', NOW, ''], 'bin entry keeps no big data: URL');
eq(M.binEntry(dl('/d/a.pdf'), NOW).url, 'https://example.com/a.pdf', 'bin entry keeps a normal link');

// ——— formatting, links, previews ———
eq(M.fmtSize(0), '0 B', '0 B');
eq(M.fmtSize(740), '740 B', 'bytes');
eq(M.fmtSize(12_345), '12.3 KB', 'KB with one decimal under 100');
eq(M.fmtSize(512_000), '512 KB', 'no decimals from 100');
eq(M.fmtSize(3_400_000), '3.4 MB', 'MB with one decimal');
eq(M.fmtSize(1_210_000_000), '1.21 GB', 'GB with two decimals');
eq(M.fmtSize(999_999), '1,000 KB', 'just under a MB');
eq(M.fmtSize(1_500, 'ar-u-nu-latn'), '1.5 KB', 'Arabic keeps Latin digits');
eq(M.fmtSize(-5), '0 B', 'never negative');
eq(M.siteOf({ referrer: 'https://www.github.com/x', url: 'https://objects.githubusercontent.com/a' }), 'github.com', 'site: the page it was downloaded from');
eq(M.siteOf({ referrer: '', finalUrl: 'https://cdn.example.org/f.zip', url: 'https://example.org/f' }), 'cdn.example.org', 'site: else the final address');
eq(M.siteOf({ url: 'data:text/plain,hi' }), '', 'no site for data: links');
eq(M.linkOf({ url: 'data:text/plain,' + 'x'.repeat(3000) }), '', 'no huge data: link to copy');
eq(M.linkOf({ url: 'https://a.com/f', finalUrl: 'https://b.com/f' }), 'https://b.com/f', 'copy the final address');
ok(M.dataThumb({ filename: '/d/p.png', url: 'data:image/png;base64,AAAA' }).startsWith('data:image/png'), 'preview from a data: picture');
eq(M.dataThumb({ filename: '/d/p.png', url: 'https://x.com/p.png' }), '', 'no preview fetched from the web');
eq(M.dataThumb({ filename: '/d/p.txt', url: 'data:image/png;base64,AAAA' }), '', 'only for pictures');
eq(M.dataThumb({ filename: '/d/p.svg', url: 'data:text/html,<script>' }), '', 'not for other data: types');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
