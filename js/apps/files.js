// My Files (Samsung My Files on One UI): Chrome's downloads by category, Recent files, the Recycle bin and what Bloom Tab
// itself stores. This module registers the app and its surfaces (Now Bar while something downloads, widgets, Finder search
// over downloaded file names and the "downloads" command); the screens load from js/files/ui.js when the app opens.
// Everything about downloads needs the optional "downloads" permission (asked from the app's "Allow" card).
import { h, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerCommand } from '../core/hooks.js';
import { toast } from '../core/ui.js';
import { registerAction, RunError } from '../routines/actions.js';
import { isLocked } from '../shell/lock.js';
import * as M from '../files/model.js';
import * as D from '../files/data.js';
import { fileTile, name, size, when } from '../files/common.js';

const ORANGE = '#f7931e';

registerApp({
  id: 'files',
  name: 'app.files',
  icon: {
    bg: 'linear-gradient(150deg, #ffbe3d 0%, #f7891f 100%)',
    glyph: '<path d="M3.8 7.6V17.6A1.6 1.6 0 0 0 5.4 19.2h13.2a1.6 1.6 0 0 0 1.6-1.6V9.4a1.6 1.6 0 0 0-1.6-1.6h-6.7L9.9 5.4H5.4a1.6 1.6 0 0 0-1.6 1.6Z"/><path d="M3.8 10.6h16.4"/>',
  },
  keywords: ['my files', 'files', 'downloads', 'download', 'file manager', 'recycle bin', 'storage', 'ملفاتي', 'الملفات', 'التنزيلات', 'مدير الملفات', 'سلة المحذوفات', 'التخزين'],
  render: (ctx) => import('../files/ui.js').then((m) => m.render(ctx)),
  async search(q) {
    const words = q.trim().split(/\s+/).filter(Boolean);
    if (q.trim().length < 2 || !D.isGranted() || !D.api()) return [];
    const hidden = D.binIds();
    const found = await D.api().search({ query: words, orderBy: ['-startTime'], limit: 60 }).catch(() => []);
    return found.filter((d) => M.isDone(d) && !hidden.has(d.id) && M.matches(d, q)).slice(0, 4).map((d) => ({
      title: name(d),
      sub: [size(M.sizeOf(d)), when(M.timeOf(d)), M.siteOf(d)].filter(Boolean).join(' · '),
      onOpen: () => openOrShow(d),
    }));
  },
});

/** Opens a file from a click outside the app (Finder, widget); when Chrome can't, My Files shows it instead. */
export async function openOrShow(d) {
  const r = await D.openFile(d.id);
  if (r !== 'ok') openApp('files', { params: { section: 'downloads', id: d.id } });
  if (r === 'denied') toast(t('files.openDenied'));
}

// ——— downloads in progress: Now Bar / Quick Panel activity ———
// The activity is polled every second and must answer synchronously, so the list is kept here, refreshed on Chrome's
// download events and every second while something downloads (onChanged doesn't report the bytes received).
let live = [], pollTimer = 0, pollSeq = 0;
async function poll() {
  clearTimeout(pollTimer);
  const my = ++pollSeq; // an event and the timer can overlap: only the latest keeps the timer going
  const list = D.isGranted() ? (await D.active()).filter((d) => d.filename || d.totalBytes || d.bytesReceived) : [];
  if (my !== pollSeq) return;
  live = list;
  if (live.length) pollTimer = setTimeout(poll, 1000);
}
D.granted().then((g) => g && poll());
D.onDownloads(poll, 60);

registerActivity('files', () => {
  if (!live.length) return null;
  const p = M.progressOf(live), running = live.filter((d) => !d.paused), one = live.length === 1 ? live[0] : null;
  const pct = p.p != null ? Math.floor(p.p * 100) + '%' : size(p.received);
  // no file names on the Lock screen
  const sub = isLocked() || !one ? t(live.length === 1 ? 'files.nb.files1' : 'files.nb.files', { n: live.length }) : name(one);
  return {
    icon: 'download',
    color: ORANGE,
    title: running.length ? pct : t('files.nb.paused'),
    sub,
    progress: p.p ?? undefined,
    app: 'files',
    priority: 7,
    actions: [running.length
      ? { icon: 'pause', label: t('files.pause'), onClick: () => Promise.all(running.map((d) => D.pause(d.id))).then(poll) }
      : { icon: 'play', label: t('files.resume'), onClick: () => Promise.all(live.map((d) => D.resume(d.id))).then(poll) }],
  };
});

// ——— widgets ———
function allowNote(el) {
  el.replaceChildren(
    h('div', { class: 'wg-head' }, h('span', { html: icon('mfFiles', 15) }), t('app.files')),
    h('div', { class: 'wg-mf-allow' }, h('span', { html: icon('download', 26) }), h('span', null, t('files.w.allow'))));
}

function recentWidget(el, { size: sz }) {
  el.classList.add('wg-mf', 'wg-mf-' + sz);
  const n = sz === 'l' ? 8 : 4;
  const draw = async () => {
    if (!(await D.granted())) return allowNote(el);
    const items = M.recent(await D.list(), n, D.binIds());
    el.replaceChildren(
      h('div', { class: 'wg-head' }, h('span', { html: icon('mfFiles', 15) }), h('span', { class: 'wg-mf-title' }, t('files.recent')), live.length ? h('span', { class: 'wg-mf-live', html: icon('download', 14) }) : null),
      items.length
        ? h('div', { class: 'wg-mf-grid' }, items.map((d) => h('button', {
          class: 'wg-mf-file',
          title: name(d),
          onClick: (e) => {
            e.stopPropagation();
            openOrShow(d);
          },
        }, fileTile(d, { big: true }), h('span', { class: 'wg-mf-name', dir: 'auto' }, name(d)))))
        : h('div', { class: 'wg-sub wg-mf-empty' }, t('files.noRecent')));
  };
  const d = debounce(draw, 300);
  const offs = [D.onDownloads(d, 400), store.on(M.KEY, d)];
  draw();
  return () => offs.forEach((f) => f());
}

function storageWidget(el, { size: sz }) {
  el.classList.add('wg-mfs', 'wg-mfs-' + sz);
  let gone = false;
  const draw = async () => {
    const s = await (await import('../files/storage.js')).measure();
    if (gone) return;
    const apps = s.apps.filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
    const segs = [...apps.map((a) => ({ n: a.total, color: a.color, name: t('app.' + a.id) })), { n: s.other, color: 'var(--mfs-other)', name: t('files.w.other') }].filter((x) => x.n > 0);
    const main = h('div', { class: 'wg-mfs-main' },
      h('div', { class: 'wg-head' }, h('span', { html: icon('mfStorage', 15) }), t('files.storage')),
      h('div', { class: 'wg-mfs-used', dir: 'ltr' }, size(s.used)),
      h('div', { class: 'wg-sub' }, t('files.w.usedBy')),
      h('div', { class: 'wg-mfs-bar' }, segs.map((x) => h('i', { style: { flex: String(x.n), background: x.color } }))));
    if (sz !== 'm') return el.replaceChildren(main);
    el.replaceChildren(main, h('div', { class: 'wg-mfs-legend' }, segs.slice(0, 4).map((x) => h('div', { class: 'wg-mfs-li' }, h('i', { style: { background: x.color } }), h('span', null, x.name), h('b', { dir: 'ltr' }, size(x.n))))));
  };
  draw();
  const tm = setInterval(draw, 60e3);
  return () => {
    gone = true;
    clearInterval(tm);
  };
}

registerWidget({ id: 'files-recent', name: 'files.w.recent', sizes: ['m', 'l'], defaultSize: 'm', app: 'files', render: recentWidget });
registerWidget({ id: 'files-storage', name: 'files.w.storage', sizes: ['s', 'm'], defaultSize: 's', onClick: () => openApp('files', { params: { section: 'storage' } }), render: storageWidget });

// ——— Finder: "downloads" ———
const WORDS = ['downloads', 'download', 'my downloads', 'recycle bin', 'التنزيلات', 'تنزيلات', 'سلة المحذوفات'];
registerCommand('files', (q, lower, done) => {
  const s = lower.trim();
  if (s.length < 4 || !WORDS.some((w) => w === s || (w.startsWith(s) && s.length >= 6))) return [];
  const bin = /bin|سلة/.test(s);
  const n = live.length;
  return [{
    icon: bin ? 'trash' : 'download',
    title: bin ? t('files.bin') : n ? t('files.cmd.active', { n }) : t('files.cat.downloads'),
    sub: t('app.files'),
    run: () => {
      done();
      openApp('files', { params: { section: bin ? 'bin' : 'downloads' } });
    },
  }];
});

// ——— Routines: "Open My Files" on Downloads (or another place) ———
const PLACES = [['downloads', 'files.cat.downloads'], ['recent', 'files.recent'], ['images', 'files.cat.images'], ['docs', 'files.cat.docs'], ['bin', 'files.bin']];
registerAction({
  id: 'files.open', name: 'files.ra.open', icon: 'mfFiles', color: ORANGE, cat: 'apps',
  params: [{ key: 'section', type: 'enum', label: 'files.ra.where', opts: PLACES, def: 'downloads' }],
  sub: (p, F) => F.opt('files.open', 'section', p.section || 'downloads'),
  run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    openApp('files', { params: { section: PLACES.some((x) => x[0] === p.section) ? p.section : 'downloads' } });
  },
});

// ——— Recycle bin: files kept 30 days are deleted for good (quietly, a while after the page has loaded) ———
if (M.expired(D.data().bin).length) setTimeout(() => D.purgeBin().catch(() => {}), 8000);

addStrings({
  en: {
    'app.files': 'My Files',
    'files.recent': 'Recent files',
    'files.ra.open': 'Open My Files',
    'files.ra.where': 'Open',
    'files.noRecent': 'No recent files',
    'files.storage': 'Storage',
    'files.bin': 'Recycle bin',
    'files.pause': 'Pause',
    'files.resume': 'Resume',
    'files.openDenied': 'Allow My Files to open files to open them from here',
    'files.cat.images': 'Images',
    'files.cat.videos': 'Videos',
    'files.cat.audio': 'Audio files',
    'files.cat.docs': 'Documents',
    'files.cat.downloads': 'Downloads',
    'files.cat.archives': 'Archives & installers',
    'files.cat.other': 'Other files',
    'files.nb.files1': 'Downloading 1 file',
    'files.nb.files': 'Downloading {n} files',
    'files.nb.paused': 'Paused',
    'files.cmd.active': 'Downloads · {n} in progress',
    'files.w.recent': 'Recent files',
    'files.w.storage': 'Bloom Tab storage',
    'files.w.allow': 'Open My Files to allow access to your downloads',
    'files.w.usedBy': 'Used by Bloom Tab',
    'files.w.other': 'Other',
  },
  ar: {
    'app.files': 'ملفاتي',
    'files.recent': 'الملفات الأخيرة',
    'files.ra.open': 'فتح ملفاتي',
    'files.ra.where': 'فتح',
    'files.noRecent': 'لا توجد ملفات حديثة',
    'files.storage': 'التخزين',
    'files.bin': 'سلة المحذوفات',
    'files.pause': 'إيقاف مؤقت',
    'files.resume': 'استئناف',
    'files.openDenied': 'اسمح لتطبيق ملفاتي بفتح الملفات لتفتحها من هنا',
    'files.cat.images': 'الصور',
    'files.cat.videos': 'الفيديوهات',
    'files.cat.audio': 'ملفات الصوت',
    'files.cat.docs': 'المستندات',
    'files.cat.downloads': 'التنزيلات',
    'files.cat.archives': 'ملفات مضغوطة وتثبيت',
    'files.cat.other': 'ملفات أخرى',
    'files.nb.files1': 'جارٍ تنزيل ملف واحد',
    'files.nb.files': 'جارٍ تنزيل {n} ملفات',
    'files.nb.paused': 'متوقف مؤقتًا',
    'files.cmd.active': 'التنزيلات · {n} قيد التنزيل',
    'files.w.recent': 'الملفات الأخيرة',
    'files.w.storage': 'تخزين Bloom Tab',
    'files.w.allow': 'افتح ملفاتي للسماح بالوصول إلى تنزيلاتك',
    'files.w.usedBy': 'مستخدَم من Bloom Tab',
    'files.w.other': 'أخرى',
  },
});
