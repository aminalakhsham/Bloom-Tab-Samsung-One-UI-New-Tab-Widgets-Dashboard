// My Files screens (Samsung My Files on One UI): Home (Allow card, downloads in progress, Recent files, Categories,
// Storage, Recycle bin), a category's files (list/grid, sort, search, Edit/selection mode with a bottom bar), Search,
// Recycle bin, Storage (what Bloom Tab keeps, per app) and Settings. Chrome's download list is read once per change
// (onCreated/onChanged/onErased) into env.items; downloads in progress are re-read every second and patched in place.
import { h, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { has, ensure, drop } from '../core/perm.js';
import { toast, menu, dialog, confirm, iconBtn, list as ouList, row, switchRow, subheader } from '../core/ui.js';
import { openApp, getApp, appIconEl, appName } from '../core/apps.js';
import * as M from './model.js';
import * as D from './data.js';
import { fileTile, catIcon, name, size, ltr, when, fullDate, catName } from './common.js';
import { measure } from './storage.js';
import './strings.js';

const plural = (key, n) => t(n === 1 ? key + '1' : key, { n });

export async function render(ctx) {
  const env = createEnv(ctx);
  homePage(env);
  await env.refresh();
  D.purgeBin().then((n) => n && env.refresh(), () => {});
  const go = (p) => p?.section && openSection(env, p);
  go(ctx.params);
  ctx.setParams = go;
  return () => env.dispose();
}

/** Shared state of the open app: Chrome's downloads, refreshed on every change, and subscribers (the open pages). */
function createEnv(ctx) {
  const subs = new Set();
  let tm = 0, seq = 0;
  const env = {
    ctx,
    items: [],
    granted: D.isGranted(),
    loaded: false,
    on: (fn) => (subs.add(fn), () => subs.delete(fn)),
    emit: (kind) => subs.forEach((fn) => fn(kind)),
    async refresh() {
      const my = ++seq;
      const g = await D.granted();
      const items = g ? await D.list() : [];
      if (my !== seq) return;
      Object.assign(env, { granted: g, items, loaded: true });
      env.emit('all');
      tick();
    },
  };
  // downloads in progress: Chrome doesn't send an event for every byte, so ask once a second while any runs
  function tick() {
    clearTimeout(tm);
    if (!env.items.some(M.isActive)) return;
    tm = setTimeout(async () => {
      const act = await D.active(), byId = new Map(act.map((d) => [d.id, d]));
      if (env.items.some((d) => M.isActive(d) && !byId.has(d.id)) || act.some((d) => !env.items.some((x) => x.id === d.id))) return env.refresh();
      env.items = env.items.map((d) => byId.get(d.id) || d);
      env.emit('progress');
      tick();
    }, 1000);
  }
  const offs = [D.onDownloads(() => env.refresh()), store.on(M.KEY, () => env.emit('all')), store.on(M.PREFS, () => env.emit('all'))];
  env.dispose = () => {
    clearTimeout(tm);
    offs.forEach((f) => f());
    subs.clear();
  };
  return env;
}

function openSection(env, { section, id }) {
  const { ctx } = env;
  while (ctx.depth > 1) ctx.pop();
  if (section === 'bin') binPage(env);
  else if (section === 'storage') storagePage(env);
  else if (section === 'search') searchPage(env);
  else if (section === 'settings') settingsPage(env);
  else if (section === 'recent' || M.CATS.includes(section)) listPage(env, section, id);
}

// ------------------------------------------------------------------ permission
async function allowAccess(env) {
  const ok = await D.allow();
  if (!ok) return toast(t('files.perm.denied'));
  await env.refresh();
  return true;
}

function permCard(env) {
  return h('section', { class: 'ou-card mf-perm' },
    h('div', { class: 'mf-perm-top' },
      h('span', { class: 'mf-perm-ico', html: icon('download', 22) }),
      h('div', { class: 'mf-perm-text' }, h('b', null, t('files.perm.title')), h('p', null, t('files.perm.text')))),
    h('ul', { class: 'mf-perm-points' },
      ['find', 'open', 'clean'].map((k) => h('li', null, t('files.perm.' + k)))),
    h('div', { class: 'mf-perm-btns' }, h('button', { class: 'mf-textbtn mf-allow', onClick: () => allowAccess(env) }, t('files.perm.allow'))));
}

// ------------------------------------------------------------------ rows, tiles and progress
const isMissing = (d) => d.state === 'complete' && d.exists === false;
const isFailed = (d) => d.state === 'interrupted';
const isDangerous = (d) => M.isActive(d) && d.danger && !['safe', 'accepted'].includes(d.danger);
const pctOf = (d) => (d.totalBytes > 0 ? Math.min(100, Math.floor((d.bytesReceived / d.totalBytes) * 100)) : null);

function progressText(d) {
  const got = size(d.bytesReceived || 0), pct = pctOf(d);
  const amount = d.totalBytes > 0 ? t('files.prog.of', { a: got, b: size(d.totalBytes) }) : got;
  return d.paused ? `${t('files.nb.paused')} · ${amount}` : pct != null ? `${amount} · ${ltr(pct + '%')}` : amount;
}

function statusLine(d) {
  if (isDangerous(d)) return h('span', { class: 'mf-sub mf-bad' }, t('files.dangerous'));
  if (M.isActive(d)) return h('span', { class: 'mf-prog' }, h('span', { class: 'mf-bar' }, h('i', { style: { width: (pctOf(d) ?? 8) + '%' } })), h('span', { class: 'mf-ptext', dir: 'auto' }, progressText(d)));
  if (isFailed(d)) return h('span', { class: 'mf-sub mf-bad' }, d.error === 'USER_CANCELED' ? t('files.canceled') : t('files.failed'));
  if (isMissing(d)) return h('span', { class: 'mf-sub' }, t('files.missing'));
  const site = M.siteOf(d);
  return h('span', { class: 'mf-sub' }, h('span', null, when(M.timeOf(d))), site ? h('bdi', { class: 'mf-site' }, site) : null);
}

/** Updates the progress bars of the rows on screen without redrawing them. */
function patchProgress(root, items) {
  for (const d of items) {
    if (!M.isActive(d)) continue;
    for (const el of root.querySelectorAll(`[data-id="${d.id}"]`)) {
      const bar = el.querySelector('.mf-bar i'), txt = el.querySelector('.mf-ptext'), pp = el.querySelector('.mf-pp');
      if (bar) bar.style.width = (pctOf(d) ?? 8) + '%';
      if (txt) txt.textContent = progressText(d);
      if (pp && pp.dataset.paused !== String(!!d.paused)) {
        pp.dataset.paused = String(!!d.paused);
        pp.innerHTML = icon(d.paused ? 'play' : 'pause', 18);
        pp.title = pp.ariaLabel = d.paused ? t('files.resume') : t('files.pause');
      }
    }
  }
}

function endButtons(env, d) {
  const b = (ic, label, fn, cls = '') => h('button', {
    class: ['mf-rbtn', cls], title: label, 'aria-label': label, html: icon(ic, 18),
    onClick: (e) => {
      e.stopPropagation();
      fn();
    },
  });
  if (M.isActive(d)) {
    const pp = b(d.paused ? 'play' : 'pause', d.paused ? t('files.resume') : t('files.pause'), () => (d.paused ? D.resume(d.id) : D.pause(d.id)).then(() => env.refresh()), 'mf-pp');
    pp.dataset.paused = String(!!d.paused);
    return h('span', { class: 'mf-rend' }, isDangerous(d) ? null : pp, b('close', t('files.cancel'), () => D.cancel(d.id)));
  }
  if (isFailed(d)) return h('span', { class: 'mf-rend' }, b('refresh', t('files.retry'), () => retry(d)));
  return h('span', { class: 'mf-rend mf-size', dir: 'ltr' }, isMissing(d) ? '' : size(M.sizeOf(d)));
}

function retry(d) {
  if (d.canResume) D.resume(d.id);
  else D.again(d);
}

/**
 * One file in a list (view 'list') or a grid (view 'grid'). opts: { sel: Set, selecting, onSelect(d), hl }.
 * Click opens (or toggles the selection), right-click shows the file's menu, a long press starts selection mode.
 */
function fileEl(env, d, { view = 'list', selecting = false, sel = null, onSelect = null, hl = null, q = '' } = {}) {
  const chosen = sel?.has(d.id);
  const chk = selecting ? h('span', { class: 'mf-chk', html: icon('check', 14) }) : null;
  // <bdi>: a Latin name in an Arabic row keeps its own direction but still starts on the row's start side
  const title = h('span', { class: 'mf-name' }, h('bdi', null, q ? marked(name(d), q) : name(d)));
  const el = view === 'grid'
    ? h('div', { class: ['mf-gcard', chosen && 'sel', hl === d.id && 'hl', isMissing(d) && 'missing'], role: 'button', tabindex: 0, dataset: { id: d.id } },
      h('span', { class: 'mf-gthumb' }, fileTile(d, { big: true }), chk),
      title,
      M.isActive(d) ? statusLine(d) : h('span', { class: 'mf-sub', dir: 'ltr' }, isFailed(d) ? t('files.failed') : isMissing(d) ? t('files.missing') : size(M.sizeOf(d))))
    : h('div', { class: ['mf-row', chosen && 'sel', hl === d.id && 'hl', isMissing(d) && 'missing'], role: 'button', tabindex: 0, dataset: { id: d.id } },
      chk,
      fileTile(d),
      h('span', { class: 'mf-rtext' }, title, statusLine(d)),
      selecting ? h('span', { class: 'mf-rend mf-size', dir: 'ltr' }, M.isDone(d) ? size(M.sizeOf(d)) : '') : endButtons(env, d));
  el.addEventListener('click', (e) => (selecting ? onSelect?.(d) : openItem(env, d, e)));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selecting) itemMenu(env, e, d);
  });
  if (onSelect) onLongPress(el, () => onSelect(d, true));
  return el;
}

/** The file name with the searched words in bold. */
function marked(text, q) {
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const low = text.toLocaleLowerCase(), marks = new Array(text.length).fill(false);
  for (const w of words) {
    let i = low.indexOf(w);
    while (i >= 0) {
      for (let k = i; k < i + w.length; k++) marks[k] = true;
      i = low.indexOf(w, i + w.length);
    }
  }
  const out = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out.push(marks[i] ? h('mark', null, text.slice(i, j)) : text.slice(i, j));
    i = j;
  }
  return out;
}

// ------------------------------------------------------------------ actions
async function openItem(env, d, at) {
  if (M.isActive(d) || isFailed(d) || isMissing(d) || isDangerous(d)) return itemMenu(env, at, d);
  const r = await D.openFile(d.id);
  if (r === 'denied') toast(t('files.openDenied'));
  else if (r === 'error') toast(t('files.openError'));
}

function itemMenu(env, at, d) {
  const link = M.linkOf(d);
  const copy = link ? { label: t('files.copyLink'), icon: 'link', onClick: () => copyLinks([d]) } : null;
  const details = { label: t('files.details'), icon: 'info', onClick: () => detailsDialog(env, d) };
  const unlist = { label: t('files.unlist'), icon: 'close', onClick: () => unlistItems(env, [d]) };
  let items;
  if (isDangerous(d)) items = [{ label: t('files.keep'), icon: 'check', onClick: () => D.keepDangerous(d.id) }, { label: t('files.discard'), icon: 'trash', danger: true, onClick: () => D.cancel(d.id) }];
  else if (M.isActive(d)) items = [d.paused ? { label: t('files.resume'), icon: 'play', onClick: () => D.resume(d.id) } : { label: t('files.pause'), icon: 'pause', onClick: () => D.pause(d.id) }, copy, details, '-', { label: t('files.cancel'), icon: 'close', danger: true, onClick: () => D.cancel(d.id) }];
  else if (isFailed(d)) items = [{ label: t('files.retry'), icon: 'refresh', onClick: () => retry(d) }, copy, details, '-', unlist];
  else if (isMissing(d)) items = [link ? { label: t('files.again'), icon: 'download', onClick: () => D.again(d) } : null, copy, details, '-', unlist];
  else items = [
    { label: t('common.open'), icon: 'external', onClick: () => openItem(env, d) },
    { label: t('files.showFolder'), icon: 'mfFolderOpen', onClick: () => D.showInFolder(d.id) },
    copy, details, '-', unlist,
    { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteItems(env, [d]) },
  ];
  menu(at, items);
}

async function copyLinks(items) {
  const links = items.map(M.linkOf).filter(Boolean);
  if (!links.length) return toast(t('files.noLink'));
  try {
    await navigator.clipboard.writeText(links.join('\n'));
    toast(links.length === 1 ? t('files.linkCopied') : t('files.linksCopied', { n: links.length }));
  } catch {
    toast(t('files.copyFailed'));
  }
}

/** Remove from list: Chrome forgets the downloads, the files stay where they are. */
async function unlistItems(env, items) {
  if (items.length > 1 && !(await confirm(t('files.unlistN', { n: items.length }), t('files.unlistMsg'), { okLabel: t('common.remove') }))) return false;
  await D.eraseIds(items.map((d) => d.id));
  toast(plural('files.unlisted', items.length));
  return true;
}

/** Delete: to the Recycle bin (Settings › Recycle bin on) or for good. Downloads without a file are only forgotten. */
async function deleteItems(env, items) {
  const files = items.filter(M.isDone), rest = items.filter((d) => !M.isDone(d)), n = items.length;
  const toBin = D.prefs().bin && files.length > 0;
  const ok = await dialog({
    title: toBin ? plural('files.del.bin', n) : plural('files.del.q', n),
    message: toBin ? t('files.del.binMsg') : files.length ? t('files.del.msg') : null,
    actions: [{ label: t('common.cancel'), value: false }, { label: toBin ? t('files.del.toBin') : t('common.delete'), value: true, danger: true }],
  });
  if (!ok) return false;
  if (rest.length) await D.destroy(rest.map((d) => d.id));
  if (toBin) {
    D.toBin(files);
    toast(plural('files.moved', files.length), { action: t('common.undo'), onAction: () => D.restore(files.map((d) => d.id)) });
  } else if (files.length) {
    await D.destroy(files.map((d) => d.id));
    toast(plural('files.deleted', files.length));
  }
  return true;
}

function detailsDialog(env, d) {
  const link = M.linkOf(d), site = M.siteOf(d);
  const status = isDangerous(d) ? t('files.dangerous') : M.isActive(d) ? progressText(d) : isFailed(d) ? `${t('files.failed')} (${d.error || '—'})` : isMissing(d) ? t('files.missing') : t('files.complete');
  const line = (label, value, cls) => (value ? h('div', { class: 'mf-dt-row' }, h('span', { class: 'mf-dt-label' }, label), h('span', { class: ['mf-dt-val', cls], dir: 'auto' }, value)) : null);
  const sz = M.sizeOf(d);
  dialog({
    title: t('files.details'),
    className: 'mf-details',
    content: h('div', { class: 'mf-dt' },
      h('div', { class: 'mf-dt-head' }, fileTile(d, { big: true }), h('b', { dir: 'auto' }, name(d))),
      line(t('files.dt.size'), sz ? `${size(sz)} (${sz.toLocaleString('en')} B)` : '—'),
      line(t('files.dt.type'), d.mime || M.extOf(d.filename).toUpperCase() || '—'),
      line(t('files.dt.path'), M.dirName(d.filename), 'mf-dt-path'),
      line(t('files.dt.date'), fullDate(M.timeOf(d))),
      line(t('files.dt.from'), site),
      line(t('files.dt.link'), link && link.length > 300 ? link.slice(0, 300) + '…' : link, 'mf-dt-link'),
      line(t('files.dt.status'), status)),
    actions: [
      M.isDone(d) ? { label: t('files.showFolder'), value: 'show' } : null,
      { label: t('common.close'), value: null, primary: true },
    ].filter(Boolean),
  }).then((v) => v === 'show' && D.showInFolder(d.id));
}

async function sortDialog() {
  const p = D.prefs();
  let sort = p.sort, dir = p.dir;
  const radio = (group, value, label, cur, set) => h('label', { class: 'ou-radio-row' },
    h('input', { type: 'radio', name: 'mf-' + group, checked: value === cur, onChange: () => set(value) }),
    h('span', { class: 'ou-radio' }),
    h('span', { class: 'ou-radio-text' }, h('span', null, label)));
  const content = h('div', { class: 'mf-sortdlg' },
    h('div', { class: 'ou-radio-list' }, M.SORTS.map((s) => radio('sort', s, t('files.sort.' + s), sort, (v) => (sort = v)))),
    h('div', { class: 'mf-sortdlg-sep' }),
    h('div', { class: 'ou-radio-list' }, ['asc', 'desc'].map((x) => radio('dir', x, t('files.sort.' + x), dir, (v) => (dir = v)))));
  const ok = await dialog({ title: t('files.sortBy'), content, className: 'mf-sort-dialog', actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }] });
  if (ok) D.setPrefs({ sort, dir });
}

// ------------------------------------------------------------------ Home
function homePage(env) {
  const { ctx } = env;
  const more = iconBtn('more', (e) => menu(e.currentTarget, [
    { label: t('files.storage'), icon: 'mfStorage', onClick: () => storagePage(env) },
    { label: t('files.bin'), icon: 'trash', onClick: () => binPage(env) },
    env.granted ? { label: t('files.openFolder'), icon: 'mfFolderOpen', onClick: () => D.showFolder() } : null,
    '-',
    { label: t('common.settings'), icon: 'settings', onClick: () => settingsPage(env) },
  ], { align: 'end' }), t('common.more'));
  const page = ctx.page({
    title: t('app.files'),
    hero: false,
    className: 'mf-page mf-home',
    actions: [iconBtn('search', () => searchPage(env), t('common.search')), more],
    render(body) {
      body.classList.add('flush');
      const wrap = h('div', { class: 'mf-wrap' });
      body.appendChild(wrap);
      const storage = storageCard(env);
      const draw = (kind) => {
        if (kind === 'progress') return patchProgress(wrap, env.items);
        const p = D.prefs(), hidden = D.binIds();
        const keep = wrap.querySelector('.mf-recent-row')?.scrollLeft || 0;
        wrap.replaceChildren(...[
          env.loaded && !env.granted ? permCard(env) : null,
          activeCard(env, hidden),
          env.granted && p.recent ? recentCard(env, hidden) : null,
          catsCard(env, hidden),
          storage.el,
          utilCard(env),
        ].filter(Boolean));
        const r = wrap.querySelector('.mf-recent-row');
        if (r) r.scrollLeft = keep;
      };
      draw();
      return env.on(draw);
    },
  });
  // coming back from another page (e.g. an app was cleaned up) measures again
  page.onReturn = () => page.el.querySelector('.mf-storage')?._refresh?.();
}

function cardHead(title, onClick) {
  return onClick
    ? h('button', { class: 'mf-card-head clickable', onClick }, h('b', null, title), h('span', { class: 'mf-chev', html: icon('forward', 18) }))
    : h('div', { class: 'mf-card-head' }, h('b', null, title));
}

function activeCard(env, hidden) {
  const act = env.items.filter((d) => M.isActive(d) && !hidden.has(d.id));
  if (!act.length) return null;
  return h('section', { class: 'ou-card mf-active' },
    cardHead(t('files.downloading'), () => listPage(env, 'downloads')),
    h('div', { class: 'mf-rows' }, act.map((d) => fileEl(env, d))));
}

function recentCard(env, hidden) {
  const items = M.recent(env.items, 12, hidden);
  return h('section', { class: 'ou-card mf-recent' },
    cardHead(t('files.recent'), items.length ? () => listPage(env, 'recent') : null),
    items.length
      ? h('div', { class: 'mf-recent-row' }, items.map((d) => {
        const el = h('button', {
          class: 'mf-rtile', title: name(d), dataset: { id: d.id },
          onClick: (e) => openItem(env, d, e),
          onContextmenu: (e) => {
            e.preventDefault();
            itemMenu(env, e, d);
          },
        }, fileTile(d, { big: true }), h('span', { class: 'mf-rtile-name' }, h('bdi', null, name(d))), h('span', { class: 'mf-rtile-when' }, when(M.timeOf(d))));
        onLongPress(el, (e) => itemMenu(env, e, d));
        return el;
      }))
      : h('div', { class: 'mf-recent-empty' }, t('files.noRecent')));
}

function catsCard(env, hidden) {
  const st = M.catStats(env.items, hidden);
  return h('section', { class: 'ou-card mf-cats' },
    cardHead(t('files.cats')),
    h('div', { class: 'mf-catgrid' }, M.CATS.map((c) => h('button', {
      class: 'mf-cat',
      dataset: { cat: c },
      onClick: async () => {
        if (!env.granted && !(await allowAccess(env))) return;
        listPage(env, c);
      },
    }, catIcon(c), h('span', { class: 'mf-cat-name' }, catName(c)), h('span', { class: 'mf-cat-size', dir: 'ltr' }, env.granted && env.loaded ? size(st[c].size) : '—')))));
}

function storageCard(env) {
  const used = h('span', { class: 'mf-st-mini', dir: 'ltr' }, '…');
  const bar = h('div', { class: 'mf-stbar' });
  const el = h('section', { class: 'ou-card mf-storage', role: 'button', tabindex: 0, onClick: () => storagePage(env), onKeydown: (e) => e.key === 'Enter' && storagePage(env) },
    cardHead(t('files.storage')),
    h('div', { class: 'mf-st-row' },
      h('span', { class: 'mf-st-ico', html: icon('mfStorage', 22) }),
      h('span', { class: 'mf-st-text' }, h('span', { class: 'mf-st-title' }, t('files.st.bloom')), used),
      h('span', { class: 'mf-chev', html: icon('forward', 18) })),
    bar);
  el._refresh = async () => {
    const s = await measure();
    used.textContent = t('files.st.usedOf', { used: size(s.used), quota: size(s.quota) });
    bar.replaceChildren(h('i', { style: { width: Math.min(100, Math.max(1.5, (s.used / Math.max(1, s.quota)) * 100)).toFixed(2) + '%', background: 'var(--accent)' } }));
  };
  el._refresh();
  return { el };
}

/** What Bloom Tab's storage is made of: one segment per app with data, then everything else (the bar is what's used). */
function stackBar(s) {
  const segs = s.apps.filter((a) => a.total > 0).map((a) => ({ n: a.total, color: a.color }));
  segs.push({ n: s.other, color: 'var(--mf-other)' });
  return segs.filter((x) => x.n > 0).map((x) => h('i', { style: { flex: String(x.n), background: x.color } }));
}

function utilCard(env) {
  const n = D.data().bin.length;
  return ouList(
    row({ icon: 'trash', title: t('files.bin'), sub: n ? plural('files.nItems', n) : null, chevron: true, className: 'muted-sub mf-binrow', onClick: () => binPage(env) }),
    env.granted ? row({ icon: 'mfFolderOpen', title: t('files.openFolder'), className: 'mf-folderrow', onClick: () => D.showFolder() }) : null);
}

// ------------------------------------------------------------------ a category's files
function listPage(env, cat, hl = null) {
  const { ctx } = env;
  const title = cat === 'recent' ? t('files.recent') : catName(cat);
  let selecting = false, shown = [];
  const sel = new Set();
  const api = {};
  const searchBtn = iconBtn('search', () => searchPage(env, cat === 'recent' || cat === 'downloads' ? 'all' : cat), t('common.search'));
  const moreBtn = iconBtn('more', (e) => api.more(e.currentTarget), t('common.more'));
  const cancelSel = h('button', { class: 'mf-tb-text', onClick: () => api.setSelect(false) }, t('common.cancel'));
  return ctx.push({
    title,
    hero: false,
    className: 'mf-page mf-list-page',
    actions: [searchBtn, moreBtn],
    render(body, page) {
      body.classList.add('flush');
      const head = h('div', { class: 'mf-lhead' });
      const rows = h('div', { class: 'mf-rows' });
      const selBar = h('div', { class: 'mf-selbar', hidden: true });
      body.appendChild(h('div', { class: 'mf-list' }, head, rows));
      page.el.appendChild(selBar);
      // Escape leaves selection mode first. Listened on window (capture) because a redraw can take the focus off the
      // page, and the window manager would then close the page instead; menus and dialogs on top keep their Escape.
      const onKey = (e) => {
        if (e.key !== 'Escape' || !selecting || e.defaultPrevented || !ctx.focused || document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) return;
        if (ctx.win.querySelector('.app-stack > .app-page:last-child') !== page.el) return;
        e.preventDefault();
        e.stopPropagation();
        setSelect(false);
      };
      addEventListener('keydown', onKey, true);

      function draw(kind) {
        if (kind === 'progress') return patchProgress(rows, env.items);
        const p = D.prefs(), hidden = D.binIds();
        shown = cat === 'recent' ? M.recent(env.items, 60, hidden) : M.sortItems(M.inView(env.items, cat, hidden), p.sort, p.dir);
        for (const id of [...sel]) if (!shown.some((d) => d.id === id)) sel.delete(id);
        const allOn = shown.length > 0 && sel.size === shown.length;
        head.replaceChildren(
          selecting
            ? h('button', { class: ['mf-allchk', allOn && 'on'], onClick: toggleAll }, h('span', { class: 'mf-chk', html: icon('check', 14) }), h('span', null, t('files.all')))
            : h('span', { class: 'mf-count' }, env.loaded ? plural('files.nItems', shown.length) : ''),
          cat === 'recent' || !env.granted ? null : h('button', { class: 'mf-sortbtn', onClick: () => sortDialog(), title: t('files.sortBy') },
            h('span', null, t('files.sort.' + p.sort)), h('span', { class: 'mf-sortdir', html: icon(p.dir === 'asc' ? 'mfArrUp' : 'mfArrDown', 15) })));
        if (!env.granted) {
          rows.className = 'mf-rows';
          rows.replaceChildren(env.loaded ? permCard(env) : '');
        } else if (!shown.length) {
          rows.className = 'mf-rows';
          rows.replaceChildren(h('div', { class: 'ou-empty mf-empty' }, catIcon(cat === 'recent' ? 'downloads' : cat, 30), t('files.empty'), h('small', null, t(cat === 'downloads' || cat === 'recent' ? 'files.emptyDl' : 'files.emptyCat'))));
        } else {
          const view = p.view;
          // keep the keyboard focus on the same file across the redraw
          const fid = rows.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
          rows.className = view === 'grid' ? 'mf-rows mf-grid' : 'mf-rows ou-card mf-rowcard';
          rows.replaceChildren(...shown.map((d) => fileEl(env, d, { view, selecting, sel, hl, onSelect: pick })));
          if (fid) rows.querySelector(`[data-id="${fid}"]`)?.focus({ preventScroll: true });
        }
        page.setTitle(selecting ? (sel.size ? t('files.nSelected', { n: sel.size }) : t('files.selectItems')) : title);
        page.setActions(selecting ? [cancelSel] : [searchBtn, moreBtn]);
        drawSelBar();
      }
      function pick(d, long) {
        if (!selecting) {
          if (!long) return;
          selecting = true;
          sel.clear();
        }
        if (sel.has(d.id) && !long) sel.delete(d.id);
        else sel.add(d.id);
        draw();
      }
      function toggleAll() {
        if (sel.size === shown.length) sel.clear();
        else shown.forEach((d) => sel.add(d.id));
        draw();
      }
      function setSelect(on) {
        selecting = on;
        sel.clear();
        draw();
      }
      function drawSelBar() {
        selBar.hidden = !selecting;
        page.el.classList.toggle('mf-selecting', selecting);
        if (!selecting) return;
        const items = shown.filter((d) => sel.has(d.id)), n = items.length, one = n === 1 ? items[0] : null;
        const b = (ic, label, fn, on = n > 0, cls = '') => h('button', { class: ['mf-selbtn', cls], disabled: !on, onClick: fn }, h('span', { html: icon(ic, 22) }), h('span', null, label));
        selBar.replaceChildren(
          b('mfFolderOpen', t('files.showFolder'), () => D.showInFolder(one.id), !!one && M.isDone(one)),
          b('link', t('files.copyLink'), () => copyLinks(items).then(() => setSelect(false)), items.some((d) => M.linkOf(d))),
          b('close', t('files.unlistShort'), async () => (await unlistItems(env, items)) && setSelect(false)),
          b('trash', t('common.delete'), async () => (await deleteItems(env, items)) && setSelect(false), n > 0, 'danger'));
      }
      api.more = (at) => {
        const p = D.prefs();
        menu(at, [
          { label: t('files.edit'), icon: 'checkCircle', disabled: !shown.length, onClick: () => setSelect(true) },
          cat === 'recent' ? null : { label: t('files.sortBy'), icon: 'sort', onClick: () => sortDialog() },
          '-',
          { label: t('files.viewList'), icon: 'list', checked: p.view === 'list', onClick: () => D.setPrefs({ view: 'list' }) },
          { label: t('files.viewGrid'), icon: 'grid', checked: p.view === 'grid', onClick: () => D.setPrefs({ view: 'grid' }) },
          cat === 'downloads' && env.granted ? '-' : null,
          cat === 'downloads' && env.granted ? { label: t('files.cleanup'), icon: 'refresh', disabled: !shown.some((d) => isFailed(d) || isMissing(d)), onClick: () => cleanup() } : null,
          cat === 'downloads' && env.granted ? { label: t('files.openFolder'), icon: 'mfFolderOpen', onClick: () => D.showFolder() } : null,
        ], { align: 'end' });
      };
      async function cleanup() {
        const gone = shown.filter((d) => isFailed(d) || isMissing(d));
        await D.eraseIds(gone.map((d) => d.id));
        toast(plural('files.unlisted', gone.length));
      }
      api.setSelect = setSelect;
      draw();
      if (hl != null) {
        setTimeout(() => rows.querySelector(`[data-id="${hl}"]`)?.scrollIntoView({ block: 'center' }), 50);
        setTimeout(() => (hl = null), 2500);
      }
      const off = env.on(draw);
      return () => {
        off();
        removeEventListener('keydown', onKey, true);
      };
    },
  });
}

// ------------------------------------------------------------------ Search
const SEARCH_CATS = ['all', 'images', 'videos', 'audio', 'docs', 'archives', 'other'];
function searchPage(env, cat = 'all') {
  const { ctx } = env;
  let q = '';
  return ctx.push({
    title: t('common.search'),
    hero: false,
    className: 'mf-page mf-search-page',
    render(body, page) {
      body.classList.add('flush');
      const input = h('input', { type: 'search', placeholder: t('files.searchPh'), 'aria-label': t('common.search'), spellcheck: 'false', autocomplete: 'off' });
      const box = h('label', { class: 'ou-searchbox mf-sbox' }, h('span', { html: icon('search', 20) }), input);
      // the search field takes the app bar's title, as in Samsung's search screens
      page.el.querySelector('.app-toolbar-title').replaceChildren(box);
      const chips = h('div', { class: 'ou-chips mf-chips' });
      const results = h('div', { class: 'mf-sresults' });
      body.appendChild(h('div', { class: 'mf-list' }, chips, results));
      input.addEventListener('input', () => {
        q = input.value.trim();
        draw();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && q) remember(q);
        if (e.key === 'Escape' && input.value) {
          e.preventDefault();
          e.stopPropagation();
          input.value = q = '';
          draw();
        }
      });
      setTimeout(() => input.focus(), 60);

      function remember(s) {
        const list = [s, ...D.prefs().recentQ.filter((x) => x !== s)].slice(0, 8);
        D.setPrefs({ recentQ: list });
      }
      function draw(kind) {
        if (kind === 'progress') return patchProgress(results, env.items);
        chips.replaceChildren(...SEARCH_CATS.map((c) => h('button', { class: ['ou-chip', 'mf-chip', c === cat && 'active'], dataset: { cat: c }, onClick: () => { cat = c; draw(); } },
          c === 'all' ? t('files.all') : catName(c))));
        if (!env.granted) return results.replaceChildren(env.loaded ? permCard(env) : '');
        if (!q) {
          const recent = D.prefs().recentQ;
          return results.replaceChildren(recent.length
            ? h('div', { class: 'mf-recentq' },
              h('div', { class: 'mf-recentq-head' }, h('b', null, t('files.recentSearches')), h('button', { class: 'mf-textbtn', onClick: () => D.setPrefs({ recentQ: [] }) }, t('files.clearAll'))),
              h('div', { class: 'mf-recentq-list' }, recent.map((s) => h('button', { class: 'ou-chip mf-qchip', onClick: () => { input.value = q = s; draw(); } }, h('span', { html: icon('history', 15) }), s))))
            : h('div', { class: 'ou-empty mf-empty' }, h('span', { html: icon('search', 56) }), t('files.searchHint')));
        }
        const hidden = D.binIds();
        const found = M.sortItems(M.inView(env.items, cat === 'all' ? 'downloads' : cat, hidden).filter((d) => M.matches(d, q)), 'date', 'desc');
        results.replaceChildren(found.length
          ? h('div', { class: 'mf-rows ou-card mf-rowcard' }, found.slice(0, 200).map((d) => fileEl(env, d, { q })))
          : h('div', { class: 'ou-empty mf-empty' }, h('span', { html: icon('search', 56) }), t('files.noResults')));
      }
      draw();
      // a result that's opened counts as a search the user wanted to remember
      results.addEventListener('click', () => q && remember(q));
      return env.on(draw);
    },
  });
}

// ------------------------------------------------------------------ Recycle bin
function binPage(env) {
  const { ctx } = env;
  const entries = () => [...D.data().bin].sort((a, b) => b.at - a.at);
  const forever = async (ids, all = false) => {
    if (!ids.length) return;
    const ok = await dialog({
      title: all ? t('files.bin.emptyQ') : plural('files.bin.delQ', ids.length),
      message: t('files.bin.delMsg'),
      actions: [{ label: t('common.cancel'), value: false }, { label: all ? t('files.bin.empty') : t('common.delete'), value: true, danger: true }],
    });
    if (!ok) return;
    await D.destroy(ids);
    toast(plural('files.deleted', ids.length));
  };
  const restore = (ids) => {
    D.restore(ids);
    toast(plural('files.restored', ids.length));
  };
  const moreBtn = iconBtn('more', (e) => {
    const ids = entries().map((b) => b.id);
    menu(e.currentTarget, [
      { label: t('files.bin.restoreAll'), icon: 'mfRestore', disabled: !ids.length, onClick: () => restore(ids) },
      { label: t('files.bin.empty'), icon: 'trash', danger: true, disabled: !ids.length || !env.granted, onClick: () => forever(ids, true) },
    ], { align: 'end' });
  }, t('common.more'));
  return ctx.push({
    title: t('files.bin'),
    hero: false,
    className: 'mf-page mf-bin-page',
    actions: [moreBtn],
    render(body) {
      body.classList.add('flush');
      const wrap = h('div', { class: 'mf-list' });
      body.appendChild(wrap);
      const draw = (kind) => {
        if (kind === 'progress') return;
        const list = entries();
        const note = h('div', { class: 'mf-binnote' }, D.prefs().bin ? t('files.bin.note') : t('files.bin.offNote'));
        if (!list.length) return wrap.replaceChildren(note, h('div', { class: 'ou-empty mf-empty' }, h('span', { html: icon('trash', 56) }), t('files.bin.none')));
        wrap.replaceChildren(env.loaded && !env.granted ? permCard(env) : note, h('div', { class: 'mf-rows ou-card mf-rowcard' }, list.map((b) => {
          const d = env.items.find((x) => x.id === b.id) || { id: b.id, filename: b.name, mime: b.mime, url: b.url, state: 'complete', fileSize: b.size };
          const left = M.daysLeft(b.at);
          const el = h('div', { class: 'mf-row', role: 'button', tabindex: 0, dataset: { id: b.id } },
            fileTile(d),
            h('span', { class: 'mf-rtext' }, h('span', { class: 'mf-name' }, h('bdi', null, b.name)), h('span', { class: 'mf-sub mf-days' }, plural('files.bin.days', left))),
            h('span', { class: 'mf-rend mf-size', dir: 'ltr' }, size(b.size)));
          const open = (e) => menu(e, [
            { label: t('files.restore'), icon: 'mfRestore', onClick: () => restore([b.id]) },
            { label: t('files.bin.delForever'), icon: 'trash', danger: true, disabled: !env.granted, onClick: () => forever([b.id]) },
          ]);
          el.addEventListener('click', open);
          el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            open(e);
          });
          el.addEventListener('keydown', (e) => e.key === 'Enter' && el.click());
          return el;
        })));
      };
      draw();
      return env.on(draw);
    },
  });
}

// ------------------------------------------------------------------ Storage
function storagePage(env) {
  const { ctx } = env;
  return ctx.push({
    title: t('files.storage'),
    hero: false,
    className: 'mf-page mf-storage-page',
    render(body) {
      body.classList.add('flush');
      const wrap = h('div', { class: 'mf-wrap' }, h('div', { class: 'ou-empty mf-empty' }, t('files.st.measuring')));
      body.appendChild(wrap);
      let gone = false;
      const draw = async () => {
        const s = await measure();
        if (gone) return;
        const apps = s.apps.filter((a) => getApp(a.id));
        const sizeEl = (n) => h('span', { class: 'mf-st-size', dir: 'ltr' }, size(n));
        wrap.replaceChildren(
          h('section', { class: 'ou-card mf-st-hero' },
            h('div', { class: 'mf-st-big' }, h('b', { dir: 'ltr' }, size(s.used)), h('span', null, t('files.st.used'))),
            h('div', { class: 'mf-st-of' }, t('files.st.available', { n: size(s.available) })),
            h('div', { class: 'mf-stbar big' }, ...stackBar(s)),
            h('div', { class: 'mf-st-legend' },
              apps.filter((a) => a.total > 0).map((a) => h('span', null, h('i', { style: { background: a.color } }), appName(a.id))),
              h('span', null, h('i', { style: { background: 'var(--mf-other)' } }), t('files.st.other')))),
          subheader(t('files.st.apps')),
          ouList(
            ...apps.map((a) => {
              const app = getApp(a.id);
              const r = row({
                title: appName(app),
                sub: a.files ? t('files.st.split', { data: size(a.json), files: size(a.files) }) : t('files.st.dataOnly', { data: size(a.json) }),
                right: sizeEl(a.total),
                chevron: true,
                className: 'muted-sub mf-st-app',
                onClick: () => openApp(a.id),
              });
              r.dataset.app = a.id;
              r.prepend(h('span', { class: 'mf-st-appico' }, appIconEl(app, 34)));
              return r;
            }),
            row({ icon: 'settings', title: t('files.st.other'), sub: t('files.st.otherSub'), right: sizeEl(s.other), className: 'muted-sub mf-st-other' })),
          subheader(t('files.st.where')),
          ouList(
            row({ icon: 'list', title: t('files.st.json'), sub: 'chrome.storage', right: sizeEl(s.json), className: 'muted-sub mf-st-json' }),
            row({ icon: 'image', title: t('files.st.idb'), sub: 'IndexedDB', right: sizeEl(s.idb), className: 'muted-sub mf-st-idb' })),
          h('p', { class: 'mf-note' }, t('files.st.note')));
      };
      draw();
      return () => (gone = true);
    },
  });
}

// ------------------------------------------------------------------ Settings
function settingsPage(env) {
  const { ctx } = env;
  return ctx.push({
    title: t('common.settings'),
    hero: true,
    className: 'mf-page mf-settings-page',
    render(body) {
      let gone = false;
      const draw = async (kind) => {
        if (kind === 'progress') return;
        const p = D.prefs(), canOpen = await has('downloads.open');
        if (gone) return;
        body.replaceChildren(
          ouList(
            switchRow({ title: t('files.set.recent'), sub: t('files.set.recentSub'), checked: p.recent, onChange: (v) => D.setPrefs({ recent: v }) }),
            switchRow({ title: t('files.bin'), sub: t('files.set.binSub'), checked: p.bin, onChange: (v) => D.setPrefs({ bin: v }) })),
          subheader(t('files.set.access')),
          ouList(
            row({
              title: t('files.set.downloads'),
              sub: env.granted ? t('files.set.allowed') : t('files.set.notAllowed'),
              className: 'mf-set-dl',
              onClick: async () => {
                if (!env.granted) return allowAccess(env);
                if (!(await confirm(t('files.set.revokeQ'), t('files.set.revokeMsg'), { okLabel: t('files.set.revoke'), danger: true }))) return;
                await drop('downloads.open');
                await drop('downloads');
                await env.refresh();
              },
            }),
            row({
              title: t('files.set.open'),
              sub: canOpen ? t('files.set.allowed') : t('files.set.askOpen'),
              className: 'mf-set-open',
              onClick: async () => {
                if (canOpen) await drop('downloads.open');
                else if (env.granted || (await allowAccess(env))) await ensure('downloads.open');
                draw();
              },
            })),
          h('p', { class: 'mf-note' }, t('files.set.privacy')));
        body.querySelectorAll('.ou-row-sub').forEach((s) => s.classList.add('muted'));
      };
      draw();
      const off = env.on(draw);
      return () => {
        gone = true;
        off();
      };
    },
  });
}
