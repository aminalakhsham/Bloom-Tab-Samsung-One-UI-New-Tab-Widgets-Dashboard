// Settings — One UI style: a search field, the profile card, then the sections in One UI's order and clusters (big
// title, rounded groups, coloured round icons, values in accent blue). The bigger pages load from js/settings/ when
// they open (wallpaper.js: Wallpaper and style; pages.js: Apps, Notifications, Accessibility, Advanced features, Sync
// with Chrome, the profile page, Reset, Keyboard shortcuts), so this file stays light for every new tab.
import { h, pickFile, download, isExt, debounce } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, tr, LANGS, fmtDate, fmtTime, fmtRelative, lang } from '../core/i18n.js';
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { registerApp, getApps, onAppsChange, appName, openApp, closeApp, appIconEl } from '../core/apps.js';
import { row, switchRow, list, subheader, choose, confirm, dialog, toast, slider, seg, card, btn } from '../core/ui.js';
import { thumbInto, DEFAULT_WALL, lockWall } from '../shell/wallpaper.js';
import { ENGINES, ASSISTANTS } from '../shell/finder.js';
import { getLockWidgets, getSettingsSections } from '../core/hooks.js';

addIcons({
  setSync: '<path d="M19.5 9.5A8 8 0 0 0 5.2 7.6M4.5 14.5a8 8 0 0 0 14.3 1.9"/><path d="M5 3.8v4h4M19 20.2v-4h-4"/>',
  setAccess: '<circle cx="12" cy="4.8" r="1.8"/><path d="M5 8.5c2.3.7 4.6 1 7 1s4.7-.3 7-1M12 9.5v4.5M12 14l-3.2 6.5M12 14l3.2 6.5"/>',
  setAdvanced: '<path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5-2-5.5-5.5-2L10 9l2-5.5Z"/><path d="M19 3.5v3M17.5 5h3"/>',
  setApps: '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',
});

// Sections in One UI's order; `c` is the cluster (one rounded card each on the root page).
const GROUPS = [
  { id: 'notifications', icon: 'bell', bg: '#ff5a5f', title: 'set.notifications', sub: 'set.notificationsSub', c: 1 },
  { id: 'display', icon: 'sun', bg: '#ffa21f', title: 'set.display', sub: 'set.displaySub', c: 1 },
  { id: 'wallpaper', icon: 'image', bg: '#e0567f', title: 'set.wallpaper', sub: 'set.wallpaperSub', c: 2 },
  { id: 'home', icon: 'home', bg: '#3e7bff', title: 'set.home', sub: 'set.homeSub', c: 2 },
  { id: 'lock', icon: 'lock', bg: '#14a88f', title: 'set.lock', sub: 'set.lockSub', c: 2 },
  { id: 'search', icon: 'search', bg: '#ff6a3d', title: 'set.search', sub: 'set.searchSub', c: 3 },
  { id: 'weather', icon: 'cloud', bg: '#28a8f0', title: 'set.weather', sub: 'set.weatherSub', c: 3 },
  { id: 'sync', icon: 'setSync', bg: '#2f8cff', title: 'set.sync', sub: 'set.syncSub', c: 4 },
  { id: 'backup', icon: 'upload', bg: '#22b07d', title: 'set.backup', sub: 'set.backupSub', c: 4 },
  { id: 'advanced', icon: 'setAdvanced', bg: '#f39c12', title: 'set.advanced', sub: 'set.advancedSub', c: 5 },
  { id: 'apps', icon: 'setApps', bg: '#4f7cf7', title: 'set.apps', sub: 'set.appsSub', c: 5 },
  { id: 'general', icon: 'globe', bg: '#6f7d95', title: 'set.general', sub: 'set.generalSub', c: 6 },
  { id: 'accessibility', icon: 'setAccess', bg: '#21a366', title: 'set.accessibility', sub: 'set.accessibilitySub', c: 6 },
  { id: 'about', icon: 'info', bg: '#4b5563', title: 'set.about', sub: 'set.aboutSub', c: 6 },
];
// Pages that live inside a section (Advanced features › Keyboard shortcuts) but open by id too ({ page: 'shortcuts' }).
const SUBPAGES = [{ id: 'shortcuts', icon: 'keyboard', bg: '#5b6472', title: 'set.shortcuts', sub: 'set.shortcutsSub', in: 'advanced' }];

const PAGES = {};

/** A row that opens a radio dialog and shows the current value in accent colour. */
function choiceRow(title, options, key, { icon: ic, iconBg, onPick } = {}) {
  const label = () => options.find((o) => JSON.stringify(o.value) === JSON.stringify(setting(key)))?.label ?? '';
  const r = row({
    icon: ic,
    iconBg,
    title,
    sub: label(),
    onClick: async () => {
      const v = await choose(title, options, setting(key));
      if (v === null || v === undefined) return;
      if (onPick) await onPick(v);
      else setSetting(key, v);
      r.querySelector('.ou-row-sub').textContent = label();
    },
  });
  return r;
}

const sw = (title, key, sub, extra = {}) =>
  switchRow({ title, sub, checked: !!setting(key), onChange: (v) => (extra.onChange ? extra.onChange(v) : setSetting(key, v)), ...extra });

function sliderRow(title, key, opts) {
  const val = h('span', { class: 'set-slider-val' }, opts.fmt ? opts.fmt(setting(key)) : setting(key));
  const s = slider({ ...opts, value: setting(key), label: title, onInput: (v) => { val.textContent = opts.fmt ? opts.fmt(v) : v; setSetting(key, v); } });
  s.classList.add('set-slider');
  return h('div', { class: 'ou-row set-slider-row' }, h('div', { class: 'set-slider-head' }, h('span', { class: 'ou-row-title' }, title), val), s);
}

const morePages = () => import('../settings/pages.js');
/** A page whose code is in js/settings/pages.js. */
const lazy = (fn) => (body, ctx, page) => morePages().then((m) => m[fn](body, ctx, { open: (id) => open(ctx, id), page }));

// ——— root ———
/** A round avatar with the first letter of the profile name (the Bloom flower without one). */
export function avatar(name, size) {
  const letter = (name || '').trim().charAt(0).toUpperCase();
  const el = h('span', { class: 'set-avatar', style: { '--sz': size + 'px' } });
  if (letter) el.textContent = letter;
  else el.innerHTML = '<svg viewBox="0 0 24 24" width="58%" height="58%"><path d="M12 3c1.4 3.8 3.4 5.8 7.2 7.2C15.4 11.6 13.4 13.6 12 17.4 10.6 13.6 8.6 11.6 4.8 10.2 8.6 8.8 10.6 6.8 12 3Z" fill="#fff"/></svg>';
  return el;
}

function rootPage(ctx) {
  ctx.page({
    title: t('set.title'),
    render(body) {
      const input = h('input', { type: 'search', placeholder: t('set.searchPh'), 'aria-label': t('set.searchPh'), autocomplete: 'off', spellcheck: 'false' });
      const searchBox = h('label', { class: 'ou-searchbox set-search' }, h('span', { class: 'set-search-ico', html: icon('search', 20) }), input);
      const profile = h('button', { class: 'ou-card set-profile', onClick: () => morePages().then((m) => m.accountPage(ctx, { open: (id) => open(ctx, id) })) });
      const drawProfile = () => {
        const name = (setting('profileName') || '').trim();
        const on = store.get('syncPrefs')?.on, st = store.get('syncStatus');
        profile.replaceChildren(
          avatar(name, 56),
          h('div', { class: 'set-profile-text' }, h('b', null, name || t('set.acc.noName')),
            h('span', null, on ? (st?.error ? t('set.sy.failedShort') : st?.at ? t('set.sy.syncedAt', { t: fmtRelative(st.at) }) : t('set.sync')) : t('set.profileHint'))),
          h('span', { class: 'ou-row-chev', html: icon('forward', 20) }));
      };
      drawProfile();
      const main = h('div', { class: 'set-root' }, profile, ...clusters().map((g) =>
        list(...g.map((x) => row({ icon: x.icon, iconBg: x.bg, title: t(x.title), sub: t(x.sub), className: 'muted-sub', onClick: () => open(ctx, x.id) })))));
      const results = h('div', { class: 'set-results', hidden: true });
      const run = async () => {
        const q = input.value.trim();
        if (!q) {
          results.hidden = true;
          main.hidden = false;
          return;
        }
        await indexSettings();
        if (q !== input.value.trim()) return;
        const hits = settingsHits(q, true);
        main.hidden = true;
        results.hidden = false;
        results.replaceChildren(hits.length
          ? list(...hits.map((x) => row({ title: x.title, sub: x.sub, className: 'muted-sub set-result', onClick: () => { const pg = open(ctx, x.page); if (pg && x.find) findRow(pg, x.find); } })))
          : h('div', { class: 'ou-empty' }, h('span', { html: icon('search', 40) }), t('set.noResults')));
      };
      input.addEventListener('input', debounce(run, 140));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
          e.stopPropagation();
          e.preventDefault();
          input.value = '';
          run();
        }
      });
      body.append(searchBox, main, results);
      const offs = [onSetting('profileName', drawProfile), store.on('syncPrefs', drawProfile), store.on('syncStatus', drawProfile)];
      return () => offs.forEach((f) => f());
    },
  });
}

/** The root page's clusters, with sections registered by other modules (core/hooks.js) placed after their `after` section. */
function clusters() {
  const out = [];
  for (const g of GROUPS) (out[g.c - 1] ||= []).push(g);
  for (const sec of getSettingsSections()) {
    const after = SUBPAGES.find((x) => x.id === sec.after)?.in || sec.after;
    const c = out.find((g) => g.some((x) => x.id === after)) || out[out.length - 2] || out[0];
    const i = c.findIndex((x) => x.id === after);
    c.splice(i < 0 ? c.length : i + 1, 0, sec);
  }
  return out.filter(Boolean);
}
const allGroups = () => [...GROUPS, ...getSettingsSections()];
const allPages = () => [...allGroups(), ...SUBPAGES];
/** The section ids on the root page, in order (for tests). */
export const rootIds = () => clusters().flat().map((g) => g.id);

function open(ctx, id) {
  const g = allPages().find((x) => x.id === id);
  const p = PAGES[id] || g?.render;
  if (!g || !p) return null;
  return ctx.push({ title: t(g.title), render: (body, page) => p(body, ctx, page) });
}

// ——— Settings search (the field on top and Finder): every section and every row label ———
// The labels come from rendering each page once off-screen (built-in and registered sections alike), so a row added
// to any page is searchable without a list to keep up to date. Rebuilt when the language or the sections change.
let index = null, indexing = null;
const indexKey = () => lang() + ':' + allPages().map((g) => g.id).join(',');
/** Builds the label index (once per language); resolves to { key, items: [{ page, label }] }. */
export function indexSettings() {
  const key = indexKey();
  if (index?.key === key) return Promise.resolve(index);
  if (indexing?.key === key) return indexing.p;
  const p = (async () => {
    const items = [];
    const noop = () => {};
    // `indexing` tells a page it's rendered off-screen only to read its labels (skip dialogs and heavy work)
    const ctx = { app: null, params: {}, page: noop, push: noop, pop: noop, close: noop, depth: 2, indexing: true };
    for (const g of allPages()) {
      const render = PAGES[g.id] || g.render;
      if (!render) continue;
      const body = h('div');
      try {
        let off = render(body, ctx, { el: body, body, setTitle: noop, setSubtitle: noop, setActions: noop });
        // a page that never finishes loading doesn't hold up the others
        if (off && typeof off.then === 'function') off = await Promise.race([off, new Promise((r) => setTimeout(r, 1500))]);
        if (typeof off === 'function') off();
      } catch (e) {
        console.warn('settings index', g.id, e);
      }
      const seen = new Set([t(g.title)]);
      for (const x of body.querySelectorAll('.ou-row-title, .ou-subheader')) {
        const label = x.textContent.trim();
        if (label && label.length < 80 && !seen.has(label)) {
          seen.add(label);
          items.push({ page: g.id, label });
        }
      }
    }
    index = { key, items };
    return index;
  })();
  indexing = { key, p };
  return p;
}

/** Sections, then every row whose label matches: [{ title, sub, page, find? }]. */
function settingsHits(q, withRows = index?.key === indexKey()) {
  const ql = q.toLowerCase().trim();
  const has = (s) => String(s).toLowerCase().includes(ql);
  const out = allPages().filter((g) => has(t(g.title)) || has(t(g.sub))).map((g) => ({ title: t(g.title), sub: t(g.sub), page: g.id }));
  if (withRows && ql.length >= 2) {
    for (const it of index.items) {
      if (!has(it.label) || out.some((x) => x.title === it.label && x.page === it.page)) continue;
      const g = allPages().find((x) => x.id === it.page);
      out.push({ title: it.label, sub: `${t('set.title')} › ${t(g.title)}`, page: it.page, find: it.label });
    }
  }
  return out;
}

/** Scrolls the row (or subheader) titled `label` into view on a page that's opening and flashes it, like One UI. */
function findRow(page, label, tries = 20) {
  const hit = [...page.body.querySelectorAll('.ou-row-title, .ou-subheader')].find((x) => x.textContent.trim() === label);
  if (!hit) return tries > 0 && setTimeout(() => findRow(page, label, tries - 1), 80);
  const target = hit.closest('.ou-row') || hit;
  target.scrollIntoView({ block: 'center' });
  target.classList.remove('finder-found');
  void target.offsetWidth;
  target.classList.add('finder-found');
  setTimeout(() => target.classList.remove('finder-found'), 2200);
}

// ——— Apps › Window size: the choice made in Settings applies to every new tab (apps keep theirs in `_size0`) ———
function applyAppSizes() {
  const map = setting('appSizes') || {};
  for (const a of getApps()) {
    if (!('_size0' in a)) a._size0 = a.size || 'phone';
    const v = map[a.id];
    a.size = v === 'phone' || v === 'wide' ? v : a._size0;
  }
}
onAppsChange(applyAppSizes);
onSetting('appSizes', applyAppSizes);
applyAppSizes();

// ——— wallpaper & style (js/settings/wallpaper.js) ———
/** A small preview of a wallpaper (the Lock screen page draws its clock on top). */
function wallThumb(wp, w = 90, hh = 180) {
  return thumbInto(h('div', { class: 'set-wall-thumb' }), wp || DEFAULT_WALL, w, hh);
}

PAGES.wallpaper = (body, ctx, page) => import('../settings/wallpaper.js').then((m) => m.wallpaperPage(body, ctx, page, { openSection: (id) => open(ctx, id) }));

// ——— display ———
PAGES.display = async (body) => {
  const { textSizeRow } = await morePages();
  const modes = h('div', { class: 'set-modes' });
  const draw = () => {
    const th = setting('theme');
    const resolved = document.documentElement.dataset.theme;
    modes.replaceChildren(
      ...['light', 'dark'].map((m) =>
        h('button', { class: ['set-mode', m, resolved === m && 'active'], onClick: () => setSetting('theme', m) },
          h('div', { class: 'set-mode-prev' }, h('i'), h('i'), h('i')),
          h('span', null, t('qp.theme.' + m)),
          h('span', { class: 'set-radio' }))),
    );
    autoSw.set(th === 'auto');
  };
  const autoSw = switchRow({ title: t('set.autoDark'), sub: t('set.autoDarkSub'), checked: setting('theme') === 'auto', onChange: (v) => setSetting('theme', v ? 'auto' : document.documentElement.dataset.theme) });
  autoSw.set = (v) => (autoSw.querySelector('input').checked = v);
  draw();
  body.append(
    card(modes),
    list(autoSw),
    list(
      sliderRow(t('qp.brightness'), 'brightness', { min: 30, max: 100, icon: 'brightness', fmt: (v) => v + '%' }),
      sw(t('qp.eyeComfort'), 'eyeComfort', t('set.eyeSub')),
      sliderRow(t('set.eyeLevel'), 'eyeComfortLevel', { min: 0, max: 100, step: 5, icon: 'eyeComfort', fmt: (v) => v + '%' })),
    list(textSizeRow()));
  return store.on('settings', draw);
};

// ——— home screen ———
PAGES.home = async (body, ctx) => {
  // the Home screen's own settings have their defaults in home.js (homePref), not in store.js
  const hm = await import('../shell/home.js');
  const pref = hm.homePref;
  const prefChoice = (title, options, key, onPick) => {
    const label = () => options.find((o) => o.value === pref(key))?.label ?? '';
    const r = row({
      title,
      sub: label(),
      onClick: async () => {
        const v = await choose(title, options, pref(key));
        if (v == null) return;
        if (onPick) await onPick(v);
        else setSetting(key, v);
        r.querySelector('.ou-row-sub').textContent = label();
      },
    });
    return r;
  };
  const prefSw = (title, key, sub) => sw(title, key, sub, { checked: !!pref(key) });
  const grids = [[4, 4], [5, 4], [5, 5], [6, 4], [6, 5], [7, 4], [7, 5], [8, 4], [8, 5]];
  const gridRow = row({
    title: t('set.grid'),
    sub: `${setting('gridCols')} × ${setting('gridRows')}`,
    onClick: async () => {
      const v = await choose(t('set.grid'), grids.map(([c, r]) => ({ value: c + 'x' + r, label: `${c} × ${r}` })), setting('gridCols') + 'x' + setting('gridRows'));
      if (!v) return;
      const [c, r] = v.split('x').map(Number);
      store.update('settings', (s) => ({ ...s, gridCols: c, gridRows: r }));
      gridRow.querySelector('.ou-row-sub').textContent = `${c} × ${r}`;
    },
  });
  body.append(
    list(
      gridRow,
      sliderRow(t('set.iconSize'), 'iconSize', { min: 44, max: 80, step: 2, icon: 'apps', fmt: (v) => v + ' px' }),
      sw(t('set.labels'), 'showLabels'),
      choiceRow(t('set.iconStyle'), [
        { value: 'default', label: t('set.iconDefault') },
        { value: 'themed', label: t('set.iconThemed'), sub: t('set.iconThemedSub') },
        { value: 'dark', label: t('set.iconDark') },
        { value: 'glass', label: t('home.style.glass') },
      ], 'iconStyle')),
    list(
      prefSw(t('home.set.appsButton'), 'appsButton'),
      prefChoice(t('home.set.appsSort'), [{ value: 'az', label: t('home.set.sortAz') }, { value: 'custom', label: t('home.set.sortCustom') }], 'appsSort',
        (v) => import('../shell/drawer.js').then((m) => m.setAppsSort(v))),
      prefSw(t('home.set.lock'), 'homeLocked', t('home.set.lockSub')),
      prefSw(t('home.set.newApps'), 'addNewApps'),
      prefChoice(t('home.set.badges'), [
        { value: 'number', label: t('home.set.badgeNumber') },
        { value: 'dot', label: t('home.set.badgeDot') },
        { value: 'off', label: t('home.set.badgeOff') },
      ], 'badges')),
    list(
      prefSw(t('home.set.leftPage'), 'leftPage', t('home.leftSub')),
      choiceRow(t('set.searchBar'), [
        { value: 'bottom', label: t('set.searchBottom') },
        { value: 'top', label: t('set.searchTop') },
        { value: 'hidden', label: t('set.searchHidden') },
      ], 'searchBar'),
      sw(t('set.dockBg'), 'dockBackground'),
      sw(t('set.newTab'), 'openLinks', t('set.newTabSub'), { checked: setting('openLinks') === 'new', onChange: (v) => setSetting('openLinks', v ? 'new' : 'same') })),
    list(
      sw(t('qp.edgePanel'), 'edgePanel', t('set.edgeSub')),
      choiceRow(t('set.edgeSide'), [{ value: 'right', label: t('set.right') }, { value: 'left', label: t('set.left') }], 'edgeSide')),
    list(
      row({ icon: 'edit', title: t('home.edit'), onClick: () => { closeApp(); hm.setEditing(true); } }),
      row({ icon: 'layout', title: t('home.set.editPages'), sub: t('home.set.editPagesSub'), className: 'muted-sub', onClick: () => { closeApp(); hm.openPageManager(); } }),
      row({ icon: 'widgets', title: t('set.addWidget'), onClick: () => { closeApp(); hm.openWidgetPicker(); } }),
      row({ icon: 'link', title: t('home.addSite'), onClick: async () => { const r = await hm.addSiteDialog(); if (r) { hm.addSite(r.url, r.title, { webApp: r.webApp }); toast(t('drawer.added')); } } }),
      row({ icon: 'refresh', title: t('set.resetHome'), sub: t('set.resetHomeSub'), className: 'muted-sub', onClick: async () => {
        if (!(await confirm(t('set.resetHome'), t('set.resetHomeConfirm'), { okLabel: t('set.reset'), danger: true }))) return;
        await hm.resetHome();
        toast(t('set.resetDone'));
      } })));
};

// ——— lock screen ———
// One UI's Lock screen settings: Screen lock type (None / Swipe / PIN, js/shell/pin.js) and its Secure lock settings,
// when the Lock screen shows, the clock, widgets (on/off and their order), notifications ("Hide content"), Now Brief,
// the Now Bar and the shortcuts.
addIcons({ lkGrip: '<path d="M5 9.5h14M5 14.5h14"/>' });
const lwName = (id) => (['weather', 'battery', 'event', 'alarm'].includes(id) ? t('set.lw.' + id) : getLockWidgets().find((w) => w.id === id) ? tr(getLockWidgets().find((w) => w.id === id).name) : '');
const onOff = (key) => setting(key) !== false;
const swOn = (title, key, sub) => switchRow({ title, sub, checked: onOff(key), onChange: (v) => setSetting(key, v) });

PAGES.lock = async (body, ctx) => {
  const [lockMod, P, B, { swatches }] = await Promise.all([import('../shell/lock.js'), import('../shell/pin.js'), import('../shell/brief.js'), import('../core/ui.js')]);
  const preview = h('div', { class: 'set-lock-prev' });
  const drawPreview = () => {
    const s = store.get('settings');
    // the Lock screen's own wallpaper (its own pick or Dynamic Lock screen; the Home one when it has none)
    const th = wallThumb(lockWall(), 160, 300);
    const clock = h('div', { class: ['set-lock-clock', 'c-' + s.clockStyle], html: lockMod.clockMarkup(new Date(), s.clockStyle) });
    clock.style.fontFamily = lockMod.CLOCK_FONTS[s.clockFont];
    clock.style.fontWeight = s.clockStyle === 'thin' ? 100 : s.clockWeight;
    clock.style.color = s.clockColor === 'auto' ? (document.documentElement.dataset.wallTone === 'light' ? '#16161a' : '#fff') : s.clockColor === 'accent' ? 'var(--accent)' : s.clockColor;
    th.append(h('div', { class: 'set-lock-date', style: { color: clock.style.color } }, fmtDate(new Date(), { weekday: 'short', month: 'short', day: 'numeric' })), clock);
    preview.replaceChildren(th);
  };
  drawPreview();

  const styles = h('div', { class: 'set-clock-styles' });
  const drawStyles = () => {
    styles.replaceChildren(
      ...lockMod.CLOCK_STYLES.map((st) =>
        h('button', { class: ['set-clock-style', setting('clockStyle') === st && 'active'], onClick: () => setSetting('clockStyle', st) },
          h('div', { class: ['set-lock-clock', 'mini', 'c-' + st], html: lockMod.clockMarkup(new Date(2026, 0, 1, 10, 8), st), style: { fontFamily: lockMod.CLOCK_FONTS[setting('clockFont')], fontWeight: st === 'thin' ? 100 : setting('clockWeight') } }),
          h('span', null, t('set.clock.' + st))))
    );
  };
  drawStyles();
  const fonts = seg(Object.keys(lockMod.CLOCK_FONTS).map((f) => ({ value: f, label: t('set.font.' + f) })), setting('clockFont'), (v) => setSetting('clockFont', v));
  fonts.querySelectorAll('.ou-seg-btn').forEach((b, i) => (b.style.fontFamily = Object.values(lockMod.CLOCK_FONTS)[i]));
  const colors = swatches(['auto', 'accent', '#ffffff', '#16161a', '#ffd166', '#ff8fab', '#8ecae6', '#b8f2a1'], setting('clockColor'), (c) => setSetting('clockColor', c));
  colors.firstChild.title = t('set.auto');
  colors.children[1].style.background = 'var(--accent)';

  const appOpts = [{ value: null, label: t('common.none') }, { value: 'finder', label: t('lock.search') }, ...getApps().filter((a) => !a.hidden).map((a) => ({ value: a.id, label: appName(a) }))];
  const scRow = (i) => {
    const r = row({
      title: t(i ? 'set.scRight' : 'set.scLeft'),
      sub: appOpts.find((o) => o.value === (setting('lockShortcuts') || [])[i])?.label || t('common.none'),
      onClick: async () => {
        const cur = [...(setting('lockShortcuts') || [null, null])];
        const v = await choose(t(i ? 'set.scRight' : 'set.scLeft'), appOpts, cur[i] ?? null);
        if (v === undefined) return;
        cur[i] = v;
        setSetting('lockShortcuts', cur);
        r.querySelector('.ou-row-sub').textContent = appOpts.find((o) => o.value === v)?.label || t('common.none');
      },
    });
    return r;
  };
  const lw = (id, title) => switchRow({ title, checked: (setting('lockWidgets') || []).includes(id), onChange: (on) => setSetting('lockWidgets', on ? [...new Set([...(setting('lockWidgets') || []), id])] : (setting('lockWidgets') || []).filter((x) => x !== id)) });

  // ——— Screen lock type, Secure lock settings, when the Lock screen shows ———
  const lockType = () => (P.pinSet() ? 'pin' : setting('lockMode') === 'never' ? 'none' : 'swipe');
  const typeLabel = (v) => ({ none: t('set.lk.none'), swipe: t('set.lk.swipe'), pin: t('pin.pin') }[v]);
  async function pickLockType() {
    const cur = lockType();
    // like One UI, changing a secure lock starts with the current PIN
    if (cur === 'pin' && !(await P.verifyFlow(ctx))) return;
    const v = await choose(t('set.lk.type'), [
      { value: 'none', label: t('set.lk.none'), sub: t('set.lk.noneSub') },
      { value: 'swipe', label: t('set.lk.swipe'), sub: t('set.lk.swipeSub') },
      { value: 'pin', label: t('pin.pin'), sub: t('set.lk.pinSub') },
    ], cur);
    if (v == null) return;
    if (v === 'pin') {
      const pin = await P.setPinFlow(ctx, { title: cur === 'pin' ? t('set.lk.changePin') : t('pin.set') });
      if (!pin) return;
      await P.setPin(pin);
      // a PIN needs a Lock screen to ask on: "Never" becomes "After inactivity" (the PIN's own timer still applies)
      if (setting('lockMode') === 'never') setSetting('lockMode', 'idle');
      toast(cur === 'pin' ? t('set.lk.pinChanged') : t('set.lk.pinOn'));
    } else {
      if (cur === 'pin') {
        if (!(await confirm(t('set.lk.removeTitle'), t('set.lk.removeMsg'), { okLabel: t('common.remove'), danger: true }))) return;
        P.removePin();
      }
      if (v === 'none') setSetting('lockMode', 'never');
      else if (setting('lockMode') === 'never') setSetting('lockMode', 'always');
    }
    drawTop();
  }
  const afterText = (m) => (!m ? t('set.lk.afterNow') : m === 60 ? t('set.lk.after1h') : m === 1 ? t('set.lk.after1m') : t('set.lk.afterMin', { n: m }));
  function securePage() {
    ctx.push({
      title: t('set.lk.secure'),
      render(pg) {
        const draw = () => {
          const rec = P.pinRec();
          const after = row({
            title: t('set.lk.after'), sub: afterText(P.lockAfter()),
            onClick: async () => {
              const v = await choose(t('set.lk.after'), P.AFTER.map((m) => ({ value: m, label: afterText(m) })), P.lockAfter());
              if (v != null) setSetting('lockAfter', v);
              draw();
            },
          });
          pg.replaceChildren(
            list(after, rec && rec.digits >= 6 ? switchRow({ title: t('set.lk.auto'), sub: t('set.lk.autoSub'), checked: P.autoConfirm(), onChange: (v) => P.setAuto(v) }) : null),
            card(h('div', { class: 'set-hint' }, t('set.lk.afterHint'))),
            card(h('div', { class: 'set-hint' }, t('set.lk.triesHint'))));
        };
        draw();
        return store.on('pin', draw);
      },
    });
  }
  const top = h('div', { class: 'set-lk-top' });
  function drawTop() {
    const pin = P.pinSet();
    const modes = [
      { value: 'always', label: t('set.lockAlways'), sub: t('set.lockAlwaysSub') },
      { value: 'idle', label: t('set.lockIdle'), sub: t('set.lockIdleSub') },
      ...(pin ? [] : [{ value: 'never', label: t('set.lockNever') }]),
    ];
    const idleRow = choiceRow(t('set.idle'), [1, 5, 10, 15, 30, 60].map((n) => ({ value: n, label: t('set.minutes', { n }) })), 'lockIdleMin');
    idleRow.hidden = setting('lockMode') !== 'idle';
    top.replaceChildren(list(
      row({ title: t('set.lk.type'), sub: typeLabel(lockType()), className: 'set-lk-type', onClick: () => pickLockType() }),
      pin ? row({ title: t('set.lk.secure'), sub: t('set.lk.secureSub'), chevron: true, className: 'muted-sub', onClick: () => securePage() }) : null,
      choiceRow(t('set.lockMode'), modes, 'lockMode', { onPick: (v) => { setSetting('lockMode', v); idleRow.hidden = v !== 'idle'; } }),
      idleRow));
  }
  drawTop();

  // ——— widgets: on/off here, the order on its own page ———
  const orderRow = h('div');
  const drawOrder = () => {
    const ids = lockMod.lockWidgetIds().filter(lwName);
    orderRow.replaceChildren(...(ids.length > 1 ? [list(row({ title: t('set.lk.order'), sub: ids.map(lwName).join(' · '), chevron: true, className: 'muted-sub set-lk-order-row', onClick: () => orderPage() }))] : []));
  };
  drawOrder();
  function orderPage() {
    ctx.push({
      title: t('set.lk.order'),
      render(pg) {
        const box = h('div', { class: 'ou-card ou-list set-lw-order' });
        const save = (ids) => {
          const all = lockMod.lockWidgetIds();
          setSetting('lockWidgets', [...ids, ...all.filter((x) => !ids.includes(x))]);
        };
        const draw = (focusId) => {
          const ids = lockMod.lockWidgetIds().filter(lwName);
          box.replaceChildren(...ids.map((id, i) => {
            const grip = h('button', { class: 'set-lw-grip', 'aria-label': t('set.lk.move', { name: lwName(id) }), title: t('set.lk.dragHint'), html: icon('lkGrip', 22) });
            const r = h('div', { class: 'ou-row set-lw-item', dataset: { id } },
              h('span', { class: 'set-lw-n' }, String(i + 1)),
              h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, lwName(id))),
              grip);
            grip.addEventListener('keydown', (e) => {
              const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
              if (!d || i + d < 0 || i + d >= ids.length) return;
              e.preventDefault();
              const next = [...ids];
              next.splice(i + d, 0, next.splice(i, 1)[0]);
              save(next);
              draw(id);
            });
            grip.addEventListener('pointerdown', (e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const rows = [...box.children], hh = r.offsetHeight, y0 = e.clientY;
              let to = i;
              r.classList.add('dragging');
              grip.setPointerCapture(e.pointerId);
              const move = (ev) => {
                const dy = ev.clientY - y0;
                to = Math.max(0, Math.min(ids.length - 1, i + Math.round(dy / hh)));
                r.style.transform = `translateY(${dy}px)`;
                rows.forEach((x, j) => { if (x !== r) x.style.transform = j > i && j <= to ? `translateY(${-hh}px)` : j < i && j >= to ? `translateY(${hh}px)` : ''; });
              };
              const up = () => {
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', up);
                grip.removeEventListener('pointercancel', up);
                rows.forEach((x) => (x.style.transform = ''));
                r.classList.remove('dragging');
                if (to !== i) {
                  const next = [...ids];
                  next.splice(to, 0, next.splice(i, 1)[0]);
                  save(next);
                }
                draw();
              };
              grip.addEventListener('pointermove', move);
              grip.addEventListener('pointerup', up);
              grip.addEventListener('pointercancel', up);
            });
            return r;
          }));
          if (focusId) box.querySelector(`[data-id="${focusId}"] .set-lw-grip`)?.focus();
        };
        pg.append(card(h('div', { class: 'set-hint' }, t('set.lk.orderHint'))), box);
        draw();
      },
    });
  }

  const briefTime = row({
    title: t('set.lk.briefAt'), sub: fmtTime(new Date(2026, 0, 1, ...B.prefs().at.split(':').map(Number))),
    onClick: async () => {
      const v = await choose(t('set.lk.briefAt'), B.WIND_TIMES.map((x) => ({ value: x, label: fmtTime(new Date(2026, 0, 1, ...x.split(':').map(Number))) })), B.prefs().at);
      if (v) setSetting('windDownAt', v);
      briefTime.querySelector('.ou-row-sub').textContent = fmtTime(new Date(2026, 0, 1, ...B.prefs().at.split(':').map(Number)));
    },
  });

  body.append(
    card(preview),
    top,
    subheader(t('set.clockStyle')),
    card(styles, h('div', { class: 'set-gap' }), fonts, h('div', { class: 'set-gap' }), colors),
    list(sliderRow(t('set.clockWeight'), 'clockWeight', { min: 100, max: 800, step: 100, icon: 'font' })),
    subheader(t('set.lockWidgets')),
    list(lw('weather', t('set.lw.weather')), lw('battery', t('set.lw.battery')), lw('event', t('set.lw.event')), lw('alarm', t('set.lw.alarm')), ...getLockWidgets().map((w) => lw(w.id, tr(w.name)))),
    orderRow,
    subheader(t('set.lk.notifs')),
    list(swOn(t('set.lk.hide'), 'lockHideContent', t('set.lk.hideSub'))),
    subheader(t('brief.name')),
    list(
      swOn(t('brief.name'), 'nowBrief', t('set.lk.briefSub')),
      swOn(t('set.lk.briefAuto'), 'nowBriefAuto', t('set.lk.briefAutoSub')),
      swOn(t('set.lk.evening'), 'eveningBrief', t('set.lk.eveningSub')),
      briefTime,
      row({ title: t('set.lk.briefOpen'), chevron: true, onClick: () => { closeApp(); setTimeout(() => B.openBrief(), 300); } })),
    list(sw(t('set.nowBar'), 'showNowBar', t('set.nowBarSub')), scRow(0), scRow(1)),
    h('div', { class: 'set-actions' }, btn(t('set.lockNow'), () => { closeApp(); setTimeout(() => lockMod.lockNow(), 300); }, 'primary')));
  const offs = [
    store.on('settings', () => { drawPreview(); drawStyles(); drawOrder(); }),
    onSetting('lockMode', drawTop),
    store.on('pin', drawTop),
  ];
  return () => offs.forEach((f) => f());
};
addStrings({
  en: {
    'set.lk.type': 'Screen lock type',
    'set.lk.none': 'None',
    'set.lk.swipe': 'Swipe',
    'set.lk.noneSub': 'New tabs open straight to the Home screen',
    'set.lk.swipeSub': 'The Lock screen without security',
    'set.lk.pinSub': 'A number of 4 to 16 digits',
    'set.lk.changePin': 'Change PIN',
    'set.lk.pinOn': 'Screen lock PIN set',
    'set.lk.pinChanged': 'PIN changed',
    'set.lk.removeTitle': 'Remove PIN?',
    'set.lk.removeMsg': 'Anyone who opens a new tab will be able to use your apps and see your notes, reminders and events. Apps that use the screen lock, like Journal, won’t be locked either.',
    'set.lk.secure': 'Secure lock settings',
    'set.lk.secureSub': 'Lock automatically · Confirm PIN',
    'set.lk.after': 'Lock automatically',
    'set.lk.afterNow': 'Immediately',
    'set.lk.afterMin': 'After {n} minutes',
    'set.lk.after1h': 'After 1 hour',
    'set.lk.after1m': 'After 1 minute',
    'set.lk.afterHint': 'A new tab, or one you come back to, asks for the PIN when Bloom Tab hasn’t been used for this long. Lock now (Alt+L) always locks right away.',
    'set.lk.auto': 'Confirm PIN without tapping OK',
    'set.lk.autoSub': 'Unlock as soon as the last digit is entered',
    'set.lk.triesHint': 'After 5 incorrect PINs the keypad waits 30 seconds, and longer after more. If you forget your PIN, the only way back in is to erase Bloom Tab on this computer. The PIN is never exported or synced.',
    'set.lk.order': 'Reorder widgets',
    'set.lk.orderHint': 'Drag the handles to change the order of the widgets on the Lock screen.',
    'set.lk.move': 'Move {name}',
    'set.lk.dragHint': 'Drag, or use the arrow keys',
    'set.lk.notifs': 'Notifications',
    'set.lk.hide': 'Hide content',
    'set.lk.hideSub': 'With a PIN, show only the app and “New notification”',
    'set.lk.briefSub': 'A summary of your day on the Lock screen in the morning',
    'set.lk.briefAuto': 'Show after first unlock',
    'set.lk.briefAutoSub': 'Open the full brief on the first unlock of the morning',
    'set.lk.evening': 'Evening brief',
    'set.lk.eveningSub': 'Goals reached, tomorrow and Bedtime mode at night',
    'set.lk.briefAt': 'Evening brief time',
    'set.lk.briefOpen': 'Show Now Brief',
  },
  ar: {
    'set.lk.type': 'نوع قفل الشاشة',
    'set.lk.none': 'لا شيء',
    'set.lk.swipe': 'سحب',
    'set.lk.noneSub': 'تُفتح التبويبات الجديدة على الشاشة الرئيسية مباشرة',
    'set.lk.swipeSub': 'شاشة القفل بدون حماية',
    'set.lk.pinSub': 'رقم من 4 إلى 16 خانة',
    'set.lk.changePin': 'تغيير رمز PIN',
    'set.lk.pinOn': 'تم تعيين رمز PIN لقفل الشاشة',
    'set.lk.pinChanged': 'تم تغيير رمز PIN',
    'set.lk.removeTitle': 'هل تريد إزالة رمز PIN؟',
    'set.lk.removeMsg': 'سيتمكن أي شخص يفتح تبويبًا جديدًا من استخدام تطبيقاتك ورؤية ملاحظاتك وتذكيراتك وأحداثك. ولن تبقى التطبيقات التي تستخدم قفل الشاشة، مثل اليوميات، مقفلة أيضًا.',
    'set.lk.secure': 'إعدادات القفل الآمن',
    'set.lk.secureSub': 'القفل تلقائيًا · تأكيد رمز PIN',
    'set.lk.after': 'القفل تلقائيًا',
    'set.lk.afterNow': 'فورًا',
    'set.lk.afterMin': 'بعد {n} دقيقة',
    'set.lk.after1h': 'بعد ساعة',
    'set.lk.after1m': 'بعد دقيقة',
    'set.lk.afterHint': 'يطلب التبويب الجديد، أو الذي تعود إليه، رمز PIN إذا لم يُستخدم Bloom Tab طوال هذه المدة. أما «القفل الآن» (Alt+L) فيقفل فورًا دائمًا.',
    'set.lk.auto': 'تأكيد رمز PIN دون النقر على موافق',
    'set.lk.autoSub': 'إلغاء القفل بمجرد إدخال آخر رقم',
    'set.lk.triesHint': 'بعد 5 محاولات خاطئة تنتظر لوحة الأرقام 30 ثانية، ثم مدة أطول بعد المزيد. إذا نسيت رمز PIN فالطريقة الوحيدة للدخول هي مسح Bloom Tab على هذا الكمبيوتر. لا يُصدَّر رمز PIN ولا يُزامَن أبدًا.',
    'set.lk.order': 'إعادة ترتيب الأدوات',
    'set.lk.orderHint': 'اسحب المقابض لتغيير ترتيب الأدوات على شاشة القفل.',
    'set.lk.move': 'نقل {name}',
    'set.lk.dragHint': 'اسحب أو استخدم مفاتيح الأسهم',
    'set.lk.notifs': 'الإشعارات',
    'set.lk.hide': 'إخفاء المحتوى',
    'set.lk.hideSub': 'مع رمز PIN، يظهر التطبيق و«إشعار جديد» فقط',
    'set.lk.briefSub': 'ملخص ليومك على شاشة القفل في الصباح',
    'set.lk.briefAuto': 'الإظهار بعد أول إلغاء للقفل',
    'set.lk.briefAutoSub': 'فتح الموجز الكامل عند أول إلغاء للقفل في الصباح',
    'set.lk.evening': 'موجز المساء',
    'set.lk.eveningSub': 'الأهداف المحققة والغد ووضع وقت النوم ليلًا',
    'set.lk.briefAt': 'وقت موجز المساء',
    'set.lk.briefOpen': 'عرض الموجز الآن',
  },
});

// ——— search (Finder) ———
PAGES.search = (body) => {
  const perm = (key, permission) => {
    const r = switchRow({
      title: t('set.' + key),
      sub: t('set.' + key + 'Sub'),
      checked: !!setting(key),
      onChange: async (on) => {
        if (on && isExt) {
          const ok = await chrome.permissions.request({ permissions: [permission] }).catch(() => false);
          if (!ok) {
            r.querySelector('input').checked = false;
            return toast(t('set.permDenied'));
          }
        }
        setSetting(key, on);
      },
    });
    return r;
  };
  // on by default (no entry in DEFAULT_SETTINGS: undefined counts as on)
  const onRow = (key, title, sub) => switchRow({ title, sub, checked: setting(key) !== false, onChange: (on) => setSetting(key, on) });
  const aiRow = onRow('finderLocalAi', t('finder.set.localAi'), t('finder.set.localAiSub'));
  const micRow = onRow('finderVoice', t('finder.set.voice'), t('finder.set.voiceSub'));
  // say under each switch when this Chrome can't do it (only for the page on screen, not the search index)
  if (body.isConnected) {
    const subOf = (r, text) => { const x = r.querySelector('.ou-row-sub'); if (x) x.textContent = text; };
    import('../shell/ai.js').then((m) => m.aiStatus(lang(), { fresh: true })).then((st) => {
      if (st === 'unavailable') subOf(aiRow, t('finder.set.localAiNo', { ai: ASSISTANTS[setting('aiAssistant')]?.name || 'AI' }));
      else if (st !== 'available') subOf(aiRow, t('finder.set.localAiDl'));
    }).catch(() => {});
    import('../interpreter/speech.js').then((m) => (m.hasOnDevice() ? m.micStatus(lang()) : 'unavailable')).then((st) => st === 'unavailable' && subOf(micRow, t('finder.set.voiceNo'))).catch(() => {});
  }
  const ex = (...keys) => keys.map((k) => t('finder.ex.' + k)).join(' · ');
  body.append(
    list(
      choiceRow(t('set.engine'), Object.entries(ENGINES).map(([id, e]) => ({ value: id, label: tr(e.name) })), 'searchEngine'),
      choiceRow(t('set.ai'), Object.entries(ASSISTANTS).map(([id, a]) => ({ value: id, label: a.name })), 'aiAssistant')),
    list(aiRow, micRow),
    list(perm('finderBookmarks', 'bookmarks'), perm('finderHistory', 'history')),
    subheader(t('set.commands')),
    card(h('div', { class: 'set-commands' },
      [[ex('timer'), 'set.cmd.timer'], [ex('focus'), 'set.cmd.focus'], [ex('note'), 'set.cmd.note'], [ex('remind'), 'finder.set.cmd.remind'], [ex('event'), 'finder.set.cmd.event'],
        [ex('math', 'percent', 'convert'), 'set.cmd.math'], [ex('time'), 'set.cmd.time'], [ex('until', 'weekday'), 'finder.set.cmd.dates'], [ex('translate'), 'finder.set.cmd.translate'],
        [ex('rain', 'wallpaper'), 'finder.set.cmd.sounds'], [ex('open'), 'finder.set.cmd.open'], [ex('define'), 'finder.set.cmd.define'], [t('finder.set.cmd.appsEx'), 'finder.set.cmd.apps'],
        [ex('dark', 'lock'), 'set.cmd.misc'], ['Tab', 'set.cmd.ai']].map(([k, d]) =>
        h('div', { class: 'set-cmd' }, h('code', { dir: 'auto' }, k), h('span', null, t(d)))))));
};

// ——— notifications, apps, accessibility, advanced features, sync (js/settings/pages.js) ———
PAGES.notifications = lazy('notificationsPage');
PAGES.apps = lazy('appsPage');
PAGES.accessibility = lazy('accessibilityPage');
PAGES.advanced = lazy('advancedPage');
PAGES.sync = lazy('syncPage');
PAGES.shortcuts = lazy('shortcutsPage');

// ——— weather ———
PAGES.weather = (body) => {
  const locRow = row({
    icon: 'location',
    title: t('set.location'),
    sub: setting('location')?.name || t('set.currentLocation'),
    onClick: () => pickLocation().then(() => (locRow.querySelector('.ou-row-sub').textContent = setting('location')?.name || t('set.currentLocation'))),
  });
  body.append(
    list(
      h('div', { class: 'ou-row' }, h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('set.unit'))), seg([{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }], setting('tempUnit'), (v) => setSetting('tempUnit', v))),
      locRow),
    list(row({ icon: 'cloud', title: t('set.openWeather'), onClick: () => openApp('weather') })));
};

async function pickLocation() {
  const m = await import('../services/weather.js');
  const input = h('input', { class: 'ou-input', placeholder: t('set.searchCity'), type: 'search' });
  const results = h('div', { class: 'set-city-results' });
  let pick;
  const fill = async () => {
    const q = input.value.trim();
    if (q.length < 2) return results.replaceChildren();
    const list2 = await m.searchCities(q).catch(() => []);
    results.replaceChildren(...list2.slice(0, 8).map((c) => h('button', { class: 'set-city', onClick: () => { pick = c; results.closest('.ou-dialog')._close(true); } }, h('b', null, c.name), h('small', null, [c.region, c.country].filter(Boolean).join(', ')))));
  };
  let tmr;
  input.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(fill, 250); });
  const ok = await dialog({
    title: t('set.location'),
    content: h('div', { class: 'ou-dialog-body' }, input, h('button', { class: 'set-city current', onClick: () => { pick = null; results.closest('.ou-dialog')._close(true); } }, h('span', { html: icon('navigation', 18) }), t('set.useCurrent')), results),
    actions: [{ label: t('common.cancel'), value: false }],
  });
  if (!ok) return;
  setSetting('location', pick ? { name: pick.name, lat: pick.lat, lon: pick.lon } : null);
  m.getWeather({ force: true }).catch(() => {});
}

// ——— general ———
PAGES.general = (body, ctx) => {
  body.append(
    list(
      choiceRow(t('set.language'), [{ value: 'auto', label: t('set.auto') }, ...LANGS.map((l) => ({ value: l.id, label: l.name }))], 'lang'),
      choiceRow(t('set.timeFormat'), [{ value: 'auto', label: t('set.auto') }, { value: false, label: t('set.h24') }, { value: true, label: t('set.h12') }], 'hour12')),
    list(choiceRow(t('set.focusLen'), [15, 20, 25, 30, 45, 60, 90].map((n) => ({ value: n, label: t('set.minutes', { n }) })), 'focusMinutes')),
    list(row({ icon: 'refresh', title: t('set.reset.title'), sub: t('set.reset.sub'), chevron: true, className: 'muted-sub', onClick: () => morePages().then((m) => m.resetPage(ctx)) })));
};

// ——— backup ———
PAGES.backup = (body) => {
  body.append(
    card(h('div', { class: 'set-hint' }, t('set.backupHint'))),
    list(
      row({ icon: 'download', title: t('set.export'), sub: t('set.exportSub'), className: 'muted-sub', onClick: async () => {
        const data = { ...(await store.exportAll()) };
        // the screen lock PIN never leaves this computer (js/shell/pin.js)
        delete data.pin;
        delete data.pinTries;
        const M = await morePages();
        for (const k of M.DEVICE_KEYS) delete data[k]; // this computer's sync state
        const blobs = setting('backupPictures') ? await M.exportBlobs() : null;
        download(`bloom-tab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'bloom-tab', version: 1, data, ...(blobs && { blobs }) }, null, 1));
      } }),
      row({ icon: 'upload', title: t('set.import'), sub: t('set.importSub'), className: 'muted-sub', onClick: async () => {
        const f = await pickFile('application/json,.json');
        if (!f) return;
        try {
          const j = JSON.parse(await f.text());
          if (j.app !== 'bloom-tab' || !j.data) throw new Error('format');
          if (!(await confirm(t('set.import'), j.blobs ? t('set.importConfirmPics') : t('set.importConfirm'), { okLabel: t('set.restore') }))) return;
          // a backup never brings a PIN with it, and restoring one keeps the PIN this computer has
          const data = { ...j.data };
          delete data.pin;
          delete data.pinTries;
          if (store.get('pin')) Object.assign(data, { pin: store.get('pin'), pinTries: store.get('pinTries') || { n: 0, until: 0 } });
          // sync keeps this computer's state; pictures and recordings come back into IndexedDB
          const M = await morePages();
          for (const k of M.DEVICE_KEYS) {
            delete data[k];
            if (store.get(k) != null) data[k] = store.get(k);
          }
          if (j.blobs) await M.importBlobs(j.blobs);
          await store.importAll(data);
          location.reload();
        } catch {
          toast(t('set.importFail'));
        }
      } })),
    list(sw(t('set.backupPics'), 'backupPictures', t('set.backupPicsSub'))),
    list(row({ icon: 'trash', title: t('set.resetAll'), sub: t('set.resetAllSub'), className: 'muted-sub danger-row', onClick: async () => {
      if (!(await confirm(t('set.resetAll'), t('set.resetAllConfirm'), { okLabel: t('set.reset'), danger: true }))) return;
      // pictures, recordings and songs (IndexedDB), alarms, the session, then chrome.storage — last, because clearing it
      // resets the language, which reloads the page before anything after it would run (js/shell/pin.js)
      await import('../shell/pin.js').then((m) => m.eraseEverything());
      location.reload();
    } })));
};

// ——— about ———
PAGES.about = (body) => {
  const v = isExt ? chrome.runtime.getManifest().version : 'dev';
  body.append(
    h('div', { class: 'set-about' },
      appIconEl({ icon: { bg: 'linear-gradient(145deg,#7c8cff,#b06cff 60%,#ff7ab6)', glyph: '<path d="M12 3c1.4 3.8 3.4 5.8 7.2 7.2C15.4 11.6 13.4 13.6 12 17.4 10.6 13.6 8.6 11.6 4.8 10.2 8.6 8.8 10.6 6.8 12 3Z" fill="#fff" stroke="none"/>' } }, 84),
      h('h2', null, 'Bloom Tab'),
      h('div', { class: 'set-about-v' }, t('set.version', { v }))),
    list(row({ icon: 'sparkle', title: t('set.whatsNew'), chevron: true, className: 'set-whatsnew', onClick: () => import('../shell/whatsnew.js').then((m) => m.showWhatsNew()) })),
    card(h('div', { class: 'set-hint strong' }, t('set.privacyTitle')), h('div', { class: 'set-hint' }, t('set.privacy'))),
    card(h('div', { class: 'set-hint' }, t('set.disclaimer'))));
};

registerApp({
  id: 'settings',
  name: 'set.title',
  keywords: ['settings', 'preferences', 'wallpaper', 'theme', 'dark', 'إعدادات', 'خلفية'],
  icon: { bg: 'linear-gradient(150deg, #8d98b0, #5b6680)', glyph: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-1c.8.7 1.6 1.2 2.6 1.5l.3 2.5h4l.3-2.5c1-.3 1.8-.8 2.6-1.5l2.3 1 2-3.4-2-1.5Z"/>' },
  render(ctx) {
    rootPage(ctx);
    const go = (p) => {
      const pg = p?.page && open(ctx, p.page);
      if (pg && p.find) findRow(pg, p.find);
    };
    go(ctx.params);
    ctx.setParams = (p) => {
      while (ctx.depth > 1) ctx.pop();
      go(p);
    };
  },
  // sections first, then every row whose label matches (from indexSettings(); Finder waits for it)
  search(q) {
    if (index?.key !== indexKey()) indexSettings();
    return settingsHits(q).map((x) => ({ title: x.title, sub: x.sub, onOpen: () => openApp('settings', { params: { page: x.page, ...(x.find && { find: x.find }) } }) }));
  },
});

addStrings({
  en: {
    'set.title': 'Settings',
    'set.searchPh': 'Search settings',
    'set.noResults': 'No results',
    'set.profileHint': 'Sync · Backup · About',
    'set.acc.noName': 'Your profile',
    'set.sync': 'Sync with Chrome',
    'set.syncSub': 'Settings, Home screen, notes and more on every computer',
    'set.sy.syncedAt': 'Synced {t}',
    'set.sy.failedShort': 'Couldn’t sync',
    'set.advanced': 'Advanced features',
    'set.advancedSub': 'Side panel · Keyboard shortcuts · Labs',
    'set.apps': 'Apps',
    'set.appsSub': 'Notifications · Window size · Home screen',
    'set.accessibility': 'Accessibility',
    'set.accessibilitySub': 'Font size · High contrast · Remove animations',
    'set.reset.title': 'Reset',
    'set.reset.sub': 'Reset all settings · Reset Home screen · Erase all data',
    'set.backupPics': 'Include pictures and recordings',
    'set.backupPicsSub': 'Photos, wallpapers, voice recordings and note pictures go into the file too (songs don’t). The file gets much bigger.',
    'set.importConfirmPics': 'All current data will be replaced with the backup, and its pictures and recordings added.',
    'set.profileSub': 'One UI 9 style new tab',
    'set.wallpaper': 'Wallpaper and style',
    'set.wallpaperSub': 'Wallpapers · Dynamic Lock screen · Color palette',
    'set.display': 'Display',
    'set.displaySub': 'Dark mode · Brightness · Eye comfort shield · Font size',
    'set.home': 'Home screen',
    'set.homeSub': 'Layout · Grid · Icons · Edge panel',
    'set.lock': 'Lock screen',
    'set.lockSub': 'Clock style · Widgets · Now Bar',
    'set.search': 'Search and Finder',
    'set.searchSub': 'Search engine · AI assistant',
    'set.notifications': 'Notifications',
    'set.notificationsSub': 'App notifications · Do not disturb',
    'set.weather': 'Weather',
    'set.weatherSub': 'Location · Units',
    'set.general': 'General management',
    'set.generalSub': 'Language · Date and time',
    'set.backup': 'Backup and restore',
    'set.backupSub': 'Export · Import · Reset',
    'set.shortcuts': 'Keyboard shortcuts',
    'set.shortcutsSub': 'Faster ways to get around',
    'set.about': 'About Bloom Tab',
    'set.aboutSub': 'Version · Privacy',
    'set.lockScreen': 'Lock screen',
    'set.homeScreen': 'Home screen',
    'set.wallpapers': 'Wallpapers',
    'set.fromPhotos': 'Choose from your photos',
    'set.fromPhotosSub': 'Use any picture on your computer',
    'set.wallpaperSet': 'Wallpaper set',
    'set.bing': 'Picture of the day',
    'set.bingSub': 'A new photo from Bing every day',
    'set.bingFail': "Couldn't load today's picture",
    'set.loading': 'Loading…',
    'set.colors': 'Colors',
    'set.live': 'Live wallpaper',
    'set.liveSub': 'Gently animate the gradient wallpapers',
    'set.dim': 'Dim wallpaper on Home screen',
    'set.blurHome': 'Blur wallpaper on Home screen',
    'set.blurHomeSub': 'Keep the Lock screen sharp',
    'set.palette': 'Color palette',
    'set.paletteSub': 'Choose an accent color, or let it come from your wallpaper.',
    'set.autoDark': 'Dark mode settings: Follow system',
    'set.autoDarkSub': 'Switch automatically with your computer',
    'set.eyeSub': 'Filter blue light to help you sleep better',
    'set.eyeLevel': 'Color temperature',
    'set.blurSub': 'Turn off to use solid backgrounds',
    'set.reduceMotion': 'Remove animations',
    'set.reduceMotionSub': 'Reduce motion across the interface',
    'set.grid': 'Home screen grid',
    'set.iconSize': 'Icon size',
    'set.labels': 'Show app names',
    'set.iconStyle': 'Icon style',
    'set.iconDefault': 'Default',
    'set.iconThemed': 'Themed icons',
    'set.iconThemedSub': 'Match icons to your color palette',
    'set.iconDark': 'Dark',
    'set.searchBar': 'Search bar',
    'set.searchBottom': 'Above the dock',
    'set.searchTop': 'Top of the screen',
    'set.searchHidden': 'Hidden',
    'set.dockBg': 'Dock background',
    'set.newTab': 'Open links in a new tab',
    'set.newTabSub': 'Keep this page open when you launch a site',
    'set.edgeSub': 'Swipe the handle to open your favorite apps',
    'set.edgeSide': 'Edge panel position',
    'set.right': 'Right',
    'set.left': 'Left',
    'set.addWidget': 'Add widget',
    'set.resetHome': 'Reset Home screen layout',
    'set.resetHomeSub': 'Back to the default apps and widgets',
    'set.resetHomeConfirm': 'Your icons, folders and widgets will be replaced with the default layout.',
    'set.reset': 'Reset',
    'set.resetDone': 'Home screen reset',
    'set.lockMode': 'Show Lock screen',
    'set.lockAlways': 'Every new tab',
    'set.lockAlwaysSub': 'Like waking up your phone',
    'set.lockIdle': 'After inactivity',
    'set.lockIdleSub': 'When you come back after a while',
    'set.lockNever': 'Never',
    'set.idle': 'Lock after',
    'set.minutes': '{n} minutes',
    'set.clockStyle': 'Clock style',
    'set.clock.stacked': 'Stacked',
    'set.clock.classic': 'Classic',
    'set.clock.thin': 'Thin',
    'set.clock.left': 'Left',
    'set.font.outfit': 'Outfit',
    'set.font.inter': 'Inter',
    'set.font.serif': 'Serif',
    'set.font.mono': 'Mono',
    'set.clockWeight': 'Clock thickness',
    'set.lockWidgets': 'Lock screen widgets',
    'set.lw.weather': 'Weather',
    'set.lw.battery': 'Battery',
    'set.lw.event': 'Next event',
    'set.lw.alarm': 'Next alarm',
    'set.nowBar': 'Now Bar',
    'set.nowBarSub': 'Timers, Focus and sounds at the bottom of the Lock screen',
    'set.scLeft': 'Left shortcut',
    'set.scRight': 'Right shortcut',
    'set.lockNow': 'Lock now',
    'set.engine': 'Search engine',
    'set.ai': 'AI assistant',
    'set.finderBookmarks': 'Search bookmarks',
    'set.finderBookmarksSub': 'Asks for permission to read your bookmarks',
    'set.finderHistory': 'Search history',
    'set.finderHistorySub': 'Asks for permission to read your browsing history',
    'set.permDenied': 'Permission not granted',
    'set.commands': 'Quick commands',
    'set.cmd.timer': 'Start a timer',
    'set.cmd.focus': 'Start a Focus session',
    'set.cmd.note': 'Save a note',
    'set.cmd.remind': 'Create a reminder',
    'set.cmd.math': 'Instant answers',
    'set.cmd.time': 'Time around the world',
    'set.cmd.misc': 'Switch theme or lock',
    'set.cmd.ai': 'Send your question to the AI assistant',
    'set.notifHint': 'Timers, alarms, reminders and events also appear as system notifications, even when no new tab is open.',
    'set.testNotif': 'Send a test notification',
    'set.testTitle': 'Hello from Bloom Tab',
    'set.testBody': 'Notifications appear here and in the Quick panel.',
    'set.clearNotifs': 'Clear all notifications',
    'set.cleared': 'Cleared',
    'set.unit': 'Temperature unit',
    'set.location': 'Location',
    'set.currentLocation': 'Current location',
    'set.searchCity': 'Search for a city',
    'set.useCurrent': 'Use current location',
    'set.openWeather': 'Open Weather',
    'set.language': 'Language',
    'set.auto': 'Automatic',
    'set.timeFormat': 'Time format',
    'set.h24': '24-hour',
    'set.h12': '12-hour',
    'set.focusLen': 'Focus session length',
    'set.backupHint': 'Save everything — layout, notes, reminders, events, alarms and settings — to a file you can restore later or on another computer.',
    'set.export': 'Back up data',
    'set.exportSub': 'Download a backup file',
    'set.import': 'Restore data',
    'set.importSub': 'Replace everything with a backup file',
    'set.importConfirm': 'All current data will be replaced with the backup.',
    'set.importFail': "That file isn't a Bloom Tab backup",
    'set.restore': 'Restore',
    'set.resetAll': 'Reset everything',
    'set.resetAllSub': 'Erase all data and settings',
    'set.resetAllConfirm': 'This erases your notes, reminders, events, layout and settings. This can’t be undone.',
    'set.key.finder': 'Open Finder',
    'set.key.type': 'Start typing anywhere to search',
    'set.key.ai': 'In Finder: ask the AI assistant',
    'set.key.apps': 'Apps screen',
    'set.key.qp': 'Quick panel',
    'set.key.edge': 'Edge panel',
    'set.key.lock': 'Lock screen',
    'set.key.settings': 'Settings',
    'set.key.pages': 'Switch Home screen pages',
    'set.key.esc': 'Close / go back',
    'set.key.addHome': 'Add the current website to Home',
    'set.version': 'Version {v}',
    'set.whatsNew': 'What’s new',
    'set.privacyTitle': 'Private by design',
    'set.privacy': 'No account, no tracking, no ads. Your notes, reminders, events, photos and settings are stored only in your browser. Weather comes from Open-Meteo using the location you choose.',
    'set.disclaimer': 'Bloom Tab is an independent project and is not affiliated with or endorsed by Samsung Electronics. Samsung, Galaxy and One UI are trademarks of Samsung Electronics Co., Ltd.',
  },
  ar: {
    'set.title': 'الإعدادات',
    'set.searchPh': 'البحث في الإعدادات',
    'set.noResults': 'لا توجد نتائج',
    'set.profileHint': 'المزامنة · النسخ الاحتياطي · حول',
    'set.acc.noName': 'ملفك الشخصي',
    'set.sync': 'المزامنة مع Chrome',
    'set.syncSub': 'الإعدادات والشاشة الرئيسية والملاحظات وغيرها على كل كمبيوتر',
    'set.sy.syncedAt': 'تمت المزامنة {t}',
    'set.sy.failedShort': 'تعذرت المزامنة',
    'set.advanced': 'الميزات المتقدمة',
    'set.advancedSub': 'اللوحة الجانبية · اختصارات لوحة المفاتيح · المختبر',
    'set.apps': 'التطبيقات',
    'set.appsSub': 'الإشعارات · حجم النافذة · الشاشة الرئيسية',
    'set.accessibility': 'إمكانية الوصول',
    'set.accessibilitySub': 'حجم الخط · التباين العالي · إزالة الرسوم المتحركة',
    'set.reset.title': 'إعادة الضبط',
    'set.reset.sub': 'إعادة ضبط كل الإعدادات · إعادة ضبط الشاشة الرئيسية · مسح كل البيانات',
    'set.backupPics': 'تضمين الصور والتسجيلات',
    'set.backupPicsSub': 'تدخل الصور والخلفيات والتسجيلات الصوتية وصور الملاحظات في الملف أيضًا (من دون الأغاني). يصبح الملف أكبر بكثير.',
    'set.importConfirmPics': 'سيتم استبدال جميع البيانات الحالية بالنسخة الاحتياطية، وستضاف صورها وتسجيلاتها.',
    'set.profileSub': 'تبويب جديد بنمط One UI 9',
    'set.wallpaper': 'الخلفية والنمط',
    'set.wallpaperSub': 'الخلفيات · شاشة القفل الديناميكية · لوحة الألوان',
    'set.display': 'الشاشة',
    'set.displaySub': 'الوضع الداكن · السطوع · درع راحة العين · حجم الخط',
    'set.home': 'الشاشة الرئيسية',
    'set.homeSub': 'التخطيط · الشبكة · الأيقونات · لوحة الحافة',
    'set.lock': 'شاشة القفل',
    'set.lockSub': 'نمط الساعة · الأدوات · شريط Now',
    'set.search': 'البحث و Finder',
    'set.searchSub': 'محرك البحث · مساعد الذكاء الاصطناعي',
    'set.notifications': 'الإشعارات',
    'set.notificationsSub': 'إشعارات التطبيقات · عدم الإزعاج',
    'set.weather': 'الطقس',
    'set.weatherSub': 'الموقع · الوحدات',
    'set.general': 'الإدارة العامة',
    'set.generalSub': 'اللغة · التاريخ والوقت',
    'set.backup': 'النسخ الاحتياطي والاستعادة',
    'set.backupSub': 'تصدير · استيراد · إعادة ضبط',
    'set.shortcuts': 'اختصارات لوحة المفاتيح',
    'set.shortcutsSub': 'طرق أسرع للتنقل',
    'set.about': 'حول Bloom Tab',
    'set.aboutSub': 'الإصدار · الخصوصية',
    'set.lockScreen': 'شاشة القفل',
    'set.homeScreen': 'الشاشة الرئيسية',
    'set.wallpapers': 'الخلفيات',
    'set.fromPhotos': 'اختيار من صورك',
    'set.fromPhotosSub': 'استخدم أي صورة على جهازك',
    'set.wallpaperSet': 'تم تعيين الخلفية',
    'set.bing': 'صورة اليوم',
    'set.bingSub': 'صورة جديدة من Bing كل يوم',
    'set.bingFail': 'تعذر تحميل صورة اليوم',
    'set.loading': 'جارٍ التحميل…',
    'set.colors': 'الألوان',
    'set.live': 'خلفية متحركة',
    'set.liveSub': 'تحريك الخلفيات المتدرجة بلطف',
    'set.dim': 'تعتيم الخلفية في الشاشة الرئيسية',
    'set.blurHome': 'تمويه الخلفية في الشاشة الرئيسية',
    'set.blurHomeSub': 'إبقاء شاشة القفل واضحة',
    'set.palette': 'لوحة الألوان',
    'set.paletteSub': 'اختر لونًا مميزًا، أو دعه يأتي من خلفيتك.',
    'set.autoDark': 'إعدادات الوضع الداكن: حسب النظام',
    'set.autoDarkSub': 'التبديل تلقائيًا مع جهازك',
    'set.eyeSub': 'تصفية الضوء الأزرق لنوم أفضل',
    'set.eyeLevel': 'درجة حرارة اللون',
    'set.blurSub': 'أوقفه لاستخدام خلفيات مصمتة',
    'set.reduceMotion': 'إزالة الرسوم المتحركة',
    'set.reduceMotionSub': 'تقليل الحركة في الواجهة',
    'set.grid': 'شبكة الشاشة الرئيسية',
    'set.iconSize': 'حجم الأيقونة',
    'set.labels': 'إظهار أسماء التطبيقات',
    'set.iconStyle': 'نمط الأيقونات',
    'set.iconDefault': 'افتراضي',
    'set.iconThemed': 'أيقونات ملوّنة بالسمة',
    'set.iconThemedSub': 'مطابقة الأيقونات مع لوحة الألوان',
    'set.iconDark': 'داكن',
    'set.searchBar': 'شريط البحث',
    'set.searchBottom': 'فوق شريط التطبيقات',
    'set.searchTop': 'أعلى الشاشة',
    'set.searchHidden': 'مخفي',
    'set.dockBg': 'خلفية شريط التطبيقات',
    'set.newTab': 'فتح الروابط في تبويب جديد',
    'set.newTabSub': 'إبقاء هذه الصفحة مفتوحة عند فتح موقع',
    'set.edgeSub': 'اسحب المقبض لفتح تطبيقاتك المفضلة',
    'set.edgeSide': 'موضع لوحة الحافة',
    'set.right': 'يمين',
    'set.left': 'يسار',
    'set.addWidget': 'إضافة أداة',
    'set.resetHome': 'إعادة ضبط تخطيط الشاشة الرئيسية',
    'set.resetHomeSub': 'العودة إلى التطبيقات والأدوات الافتراضية',
    'set.resetHomeConfirm': 'سيتم استبدال أيقوناتك ومجلداتك وأدواتك بالتخطيط الافتراضي.',
    'set.reset': 'إعادة ضبط',
    'set.resetDone': 'تمت إعادة ضبط الشاشة الرئيسية',
    'set.lockMode': 'إظهار شاشة القفل',
    'set.lockAlways': 'كل تبويب جديد',
    'set.lockAlwaysSub': 'مثل تنبيه هاتفك',
    'set.lockIdle': 'بعد عدم النشاط',
    'set.lockIdleSub': 'عندما تعود بعد فترة',
    'set.lockNever': 'أبدًا',
    'set.idle': 'القفل بعد',
    'set.minutes': '{n} دقيقة',
    'set.clockStyle': 'نمط الساعة',
    'set.clock.stacked': 'مكدّس',
    'set.clock.classic': 'كلاسيكي',
    'set.clock.thin': 'رفيع',
    'set.clock.left': 'يسار',
    'set.font.outfit': 'Outfit',
    'set.font.inter': 'Inter',
    'set.font.serif': 'Serif',
    'set.font.mono': 'Mono',
    'set.clockWeight': 'سُمك الساعة',
    'set.lockWidgets': 'أدوات شاشة القفل',
    'set.lw.weather': 'الطقس',
    'set.lw.battery': 'البطارية',
    'set.lw.event': 'الحدث التالي',
    'set.lw.alarm': 'المنبه التالي',
    'set.nowBar': 'شريط Now',
    'set.nowBarSub': 'المؤقتات والتركيز والأصوات أسفل شاشة القفل',
    'set.scLeft': 'الاختصار الأيسر',
    'set.scRight': 'الاختصار الأيمن',
    'set.lockNow': 'القفل الآن',
    'set.engine': 'محرك البحث',
    'set.ai': 'مساعد الذكاء الاصطناعي',
    'set.finderBookmarks': 'البحث في الإشارات المرجعية',
    'set.finderBookmarksSub': 'يطلب إذنًا لقراءة إشاراتك المرجعية',
    'set.finderHistory': 'البحث في السجل',
    'set.finderHistorySub': 'يطلب إذنًا لقراءة سجل التصفح',
    'set.permDenied': 'لم يتم منح الإذن',
    'set.commands': 'أوامر سريعة',
    'set.cmd.timer': 'بدء مؤقت',
    'set.cmd.focus': 'بدء جلسة تركيز',
    'set.cmd.note': 'حفظ ملاحظة',
    'set.cmd.remind': 'إنشاء تذكير',
    'set.cmd.math': 'إجابات فورية',
    'set.cmd.time': 'الوقت حول العالم',
    'set.cmd.misc': 'تبديل السمة أو القفل',
    'set.cmd.ai': 'إرسال سؤالك إلى مساعد الذكاء الاصطناعي',
    'set.notifHint': 'تظهر المؤقتات والمنبهات والتذكيرات والأحداث أيضًا كإشعارات نظام، حتى عندما لا يكون هناك تبويب جديد مفتوح.',
    'set.testNotif': 'إرسال إشعار تجريبي',
    'set.testTitle': 'مرحبًا من Bloom Tab',
    'set.testBody': 'تظهر الإشعارات هنا وفي اللوحة السريعة.',
    'set.clearNotifs': 'مسح كل الإشعارات',
    'set.cleared': 'تم المسح',
    'set.unit': 'وحدة الحرارة',
    'set.location': 'الموقع',
    'set.currentLocation': 'الموقع الحالي',
    'set.searchCity': 'ابحث عن مدينة',
    'set.useCurrent': 'استخدام الموقع الحالي',
    'set.openWeather': 'فتح الطقس',
    'set.language': 'اللغة',
    'set.auto': 'تلقائي',
    'set.timeFormat': 'تنسيق الوقت',
    'set.h24': '24 ساعة',
    'set.h12': '12 ساعة',
    'set.focusLen': 'مدة جلسة التركيز',
    'set.backupHint': 'احفظ كل شيء — التخطيط والملاحظات والتذكيرات والأحداث والمنبهات والإعدادات — في ملف يمكنك استعادته لاحقًا أو على جهاز آخر.',
    'set.export': 'نسخ البيانات احتياطيًا',
    'set.exportSub': 'تنزيل ملف نسخة احتياطية',
    'set.import': 'استعادة البيانات',
    'set.importSub': 'استبدال كل شيء بملف نسخة احتياطية',
    'set.importConfirm': 'سيتم استبدال جميع البيانات الحالية بالنسخة الاحتياطية.',
    'set.importFail': 'هذا الملف ليس نسخة احتياطية من Bloom Tab',
    'set.restore': 'استعادة',
    'set.resetAll': 'إعادة ضبط كل شيء',
    'set.resetAllSub': 'مسح جميع البيانات والإعدادات',
    'set.resetAllConfirm': 'سيؤدي هذا إلى مسح ملاحظاتك وتذكيراتك وأحداثك وتخطيطك وإعداداتك. لا يمكن التراجع عن ذلك.',
    'set.key.finder': 'فتح Finder',
    'set.key.type': 'ابدأ الكتابة في أي مكان للبحث',
    'set.key.ai': 'في Finder: اسأل مساعد الذكاء الاصطناعي',
    'set.key.apps': 'شاشة التطبيقات',
    'set.key.qp': 'اللوحة السريعة',
    'set.key.edge': 'لوحة الحافة',
    'set.key.lock': 'شاشة القفل',
    'set.key.settings': 'الإعدادات',
    'set.key.pages': 'التنقل بين صفحات الشاشة الرئيسية',
    'set.key.esc': 'إغلاق / رجوع',
    'set.key.addHome': 'إضافة الموقع الحالي إلى الرئيسية',
    'set.version': 'الإصدار {v}',
    'set.whatsNew': 'الجديد',
    'set.privacyTitle': 'خاص بطبيعته',
    'set.privacy': 'لا حساب ولا تتبع ولا إعلانات. تُخزَّن ملاحظاتك وتذكيراتك وأحداثك وصورك وإعداداتك في متصفحك فقط. يأتي الطقس من Open-Meteo باستخدام الموقع الذي تختاره.',
    'set.disclaimer': 'Bloom Tab مشروع مستقل وغير تابع لشركة Samsung Electronics أو معتمد منها. Samsung وGalaxy وOne UI علامات تجارية لشركة Samsung Electronics Co., Ltd.',
  },
});
