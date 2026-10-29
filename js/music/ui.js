// Samsung Music (One UI): the app window. Tabs Tracks / Playlists / Albums / Artists / Genres / Folders, sort and
// view options in ⋮, selection mode (long-press), album/artist/playlist pages, search, Add music, the mini player
// at the bottom and the full player (js/music/full.js). Dialogs and Settings live in js/music/sheets.js.
import { h, debounce, escapeHtml, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, iconBtn, choose, confirm, prompt } from '../core/ui.js';
import { fmtDur, cmp } from './core.js';
import {
  lib, playlists, fav, SMART, plays, artHTML, hydrateArt, importFiles, importState, pickMusic, filesFromDrop, deleteTracks,
  searchLibrary, noteSearch, recentSearches, clearSearches, artistOf, cachedArt, artUrl,
} from './library.js';
import { music, playSource, tracksOf } from './player.js';
import { openFull } from './full.js';
import { addToPlaylist, showDetails, editLyrics, openSettings, sleepDialog } from './sheets.js';
import './strings.js';

const TABS = ['tracks', 'playlists', 'albums', 'artists', 'genres', 'folders'];
const SORTS = {
  tracks: ['title', 'artist', 'album', 'added', 'duration'],
  albums: ['title', 'artist', 'year', 'added'],
  artists: ['name', 'count'],
};
const VIEWABLE = ['albums', 'artists', 'genres'];

const prefs = () => ({ tab: 'tracks', sort: {}, view: {}, ...(store.get('musicPrefs') || {}) });
const setPref = (patch) => store.set('musicPrefs', { ...prefs(), ...patch });
const sortOf = (tab) => prefs().sort[tab] || SORTS[tab][0];
const viewOf = (tab) => prefs().view[tab] || (tab === 'albums' ? 'grid' : 'list');

export const songsText = (n) => (n === 1 ? t('music.oneTrack') : t('music.nTracks', { n }));
const albumsText = (n) => (n === 1 ? t('music.oneAlbum') : t('music.nAlbums', { n }));
function durText(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? t('music.hrMin', { h: Math.floor(m / 60), m: m % 60 }) : t('music.min', { n: m });
}
const esc = escapeHtml;
const ic = (n, s = 20) => icon(n, s);

/** 2×2 mosaic of covers (playlists, genres), one cover, or a coloured placeholder. */
export function mosaicHTML(arts, cls = '', ph = 'playlist') {
  const a = [...new Set(arts.filter(Boolean))].slice(0, 4);
  if (a.length >= 4) return `<span class="mu-art mu-mosaic ${cls}">${a.map((x) => artHTML(x)).join('')}</span>`;
  if (a.length) return artHTML(a[0], cls);
  return `<span class="mu-art mu-ph ${cls}">${ic(ph, 26)}</span>`;
}
export const smartArt = (id, cls = '') => `<span class="mu-art mu-smart ${cls}" style="--sc:${SMART[id].color}">${ic(SMART[id].icon, 24)}</span>`;

function sortTracks(list, by) {
  const l = list.slice();
  if (by === 'artist') return l.sort((a, b) => cmp(artistOf(a), artistOf(b)) || cmp(a.album, b.album) || (a.track || 0) - (b.track || 0));
  if (by === 'album') return l.sort((a, b) => cmp(a.album, b.album) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0));
  if (by === 'added') return l.sort((a, b) => b.addedAt - a.addedAt);
  if (by === 'duration') return l.sort((a, b) => (b.dur || 0) - (a.dur || 0));
  return l.sort((a, b) => cmp(a.title, b.title));
}

export function render(ctx) {
  const stack = ctx.win.querySelector('.app-stack');
  const pages = []; // { page, mini } for every page this module opened, to know when the mini player shows
  let tab = TABS.includes(ctx.params?.tab) ? ctx.params.tab : TABS.includes(prefs().tab) ? prefs().tab : 'tracks';
  let sel = null; // Set of selected track ids while in selection mode
  let selList = []; // the ids that "All" selects
  const offs = [];

  // ——— root page ———
  const searchBtn = iconBtn('search', () => openSearch(), t('common.search'));
  const moreBtn = iconBtn('more', (e) => mainMenu(e.currentTarget), t('common.more'));
  const tabbar = h('div', { class: 'mu-tabbar', role: 'tablist' });
  const selbar = h('div', { class: 'mu-selbar', hidden: true });
  const view = h('div', { class: 'mu-view' });
  const root = ctx.page({ title: t('app.music'), hero: false, className: 'mu-page mu-root-page', actions: [searchBtn, moreBtn] });
  root.body.classList.add('flush');
  root.el.append(tabbar, selbar);
  root.body.append(view);
  pages.push({ page: root, mini: true });
  root.onReturn = () => returned(root);

  // ——— mini player, import progress and the selection action bar (shared by every page of the window) ———
  const mini = h('div', { class: 'mu-mini', role: 'button', tabindex: 0, 'aria-label': t('music.nowPlaying') });
  const importEl = h('div', { class: 'mu-import', hidden: true }, h('span', { class: 'mu-import-t' }), h('span', { class: 'mu-import-bar' }, h('i')));
  const actbar = h('div', { class: 'mu-actbar', hidden: true });
  const dock = h('div', { class: 'mu-dock' }, importEl, mini, actbar);
  stack.append(dock);
  const full = openFull({ stack, ctx, go: (kind, id) => openGroup(kind, id), trackMenu: (at, ids, extra) => trackMenu(at, ids, extra) });

  function returned(p) {
    const i = pages.findIndex((x) => x.page === p);
    if (i >= 0) pages.length = i + 1;
    drawDock();
  }
  /** One UI sub-page (back button) that knows whether the mini player shows on it. */
  function push(opts, { mini: showMini = true } = {}) {
    if (sel) endSelect();
    const p = ctx.push({ ...opts, className: ['mu-page', opts.className].filter(Boolean).join(' ') });
    p.onReturn = () => returned(p);
    pages.push({ page: p, mini: showMini });
    drawDock();
    return p;
  }

  // ——— tabs ———
  function drawTabs() {
    tabbar.replaceChildren(...TABS.map((id) => h('button', {
      class: ['mu-tab', id === tab && 'active'],
      role: 'tab',
      'aria-selected': String(id === tab),
      dataset: { tab: id },
      onClick: () => setTab(id),
    }, t('music.tab.' + id))));
    // bring the active tab into view without scrolling anything else (scrollIntoView would move the window too)
    const a = tabbar.querySelector('.active');
    if (a) {
      const r = a.getBoundingClientRect(), b = tabbar.getBoundingClientRect();
      if (r.left < b.left) tabbar.scrollLeft -= b.left - r.left + 12;
      else if (r.right > b.right) tabbar.scrollLeft += r.right - b.right + 12;
    }
  }
  function setTab(id) {
    if (sel) endSelect();
    tab = id;
    setPref({ tab: id });
    drawTabs();
    drawView();
    root.scrollEl.scrollTop = 0;
  }

  // ——— rows and cards ———
  function rowHTML(x, i, { num = false, sub = 'artist' } = {}) {
    const cur = music.current() === x.id;
    const subText = sub === 'album' ? x.album || t('music.unknownAlbum') : sub === 'both' ? [artistOf(x), x.album].filter(Boolean).join(' · ') : artistOf(x);
    const checked = sel?.has(x.id);
    return `<div class="mu-row${cur ? ' current' : ''}${checked ? ' checked' : ''}" data-id="${esc(x.id)}" data-i="${i}" tabindex="0" role="button">
      ${sel ? `<span class="mu-check" aria-hidden="true">${ic('check', 16)}</span>` : ''}
      <span class="mu-lead">${num ? `<span class="mu-num">${x.track || i + 1}</span>` : artHTML(x.art, 'mu-thumb')}<span class="mu-bars"><i></i><i></i><i></i></span></span>
      <span class="mu-tt"><span class="mu-t1">${esc(x.title)}</span><span class="mu-t2">${fav.has(x.id) ? `<span class="mu-favdot">${ic('heartFill', 12)}</span>` : ''}${esc(subText)}</span></span>
      <span class="mu-dur">${fmtDur(x.dur)}</span></div>`;
  }
  /** A list of track rows that plays from the clicked row; `source` = [kind, id] for "Playing from". */
  function trackList(list, source, opts = {}) {
    const el = h('div', { class: 'mu-list', html: list.map((x, i) => rowHTML(x, i, opts)).join('') });
    el._list = list;
    el._source = source;
    el._opts = opts;
    hydrateArt(el);
    return el;
  }

  function cardHTML(kind, id, title, sub, art, round = false) {
    return `<div class="mu-card${round ? ' round' : ''}" data-go="${kind}:${esc(id)}" tabindex="0" role="button">
      <span class="mu-cover">${art}</span><span class="mu-ct">${esc(title)}</span>${sub ? `<span class="mu-cs">${esc(sub)}</span>` : ''}</div>`;
  }
  function itemRowHTML(kind, id, title, sub, art, extra = '') {
    return `<div class="mu-row mu-irow ${extra}" data-go="${kind}:${esc(id)}" tabindex="0" role="button">
      <span class="mu-lead">${art}</span><span class="mu-tt"><span class="mu-t1">${esc(title)}</span>${sub ? `<span class="mu-t2">${esc(sub)}</span>` : ''}</span>
      <span class="mu-chev">${ic('forward', 18)}</span></div>`;
  }

  const empty = () => h('div', { class: 'mu-empty' },
    h('span', { class: 'mu-empty-ico', html: ic('music', 44) }),
    h('div', { class: 'mu-empty-t' }, t('music.noMusic')),
    h('div', { class: 'mu-empty-s' }, t('music.noMusicSub')),
    h('div', { class: 'mu-empty-btns' },
      h('button', { class: 'ou-btn primary', dataset: { add: 'files' }, onClick: () => runImport(pickMusic(false)) }, h('span', { html: ic('musicAdd', 18) }), t('music.addFiles')),
      h('button', { class: 'ou-btn tonal', dataset: { add: 'folder' }, onClick: () => runImport(pickMusic(true)) }, h('span', { html: ic('folder', 18) }), t('music.addFolder'))));

  // ——— tab views ———
  const VIEWS = {
    tracks() {
      const list = sortTracks(lib.tracks(), sortOf('tracks'));
      selList = list.map((x) => x.id);
      return [
        h('div', { class: 'mu-listhead' },
          h('button', { class: 'mu-shufbtn', onClick: () => playSource('tracks', 'all', { shuffle: true }) }, h('span', { html: ic('shuffle', 18) }), t('music.shuffle')),
          h('span', { class: 'mu-count' }, songsText(list.length))),
        trackList(list, ['tracks', 'all'], { sub: 'both' }),
      ];
    },
    playlists() {
      const smart = Object.keys(SMART).map((id) => itemRowHTML('smart', id, t(SMART[id].name), songsText(SMART[id].songs().length), smartArt(id, 'mu-thumb'))).join('');
      const mine = playlists.all();
      return [
        h('div', { class: 'mu-list mu-pl', html: `<div class="mu-row mu-irow mu-create" data-create tabindex="0" role="button"><span class="mu-lead"><span class="mu-art mu-newpl mu-thumb">${ic('plus', 24)}</span></span><span class="mu-tt"><span class="mu-t1">${esc(t('music.createPlaylist'))}</span></span></div>${smart}` }),
        mine.length ? h('div', { class: 'mu-sub' }, t('music.myPlaylists')) : null,
        mine.length ? h('div', { class: 'mu-list mu-pl', html: mine.map((p) => itemRowHTML('playlist', p.id, p.name, songsText(playlists.songs(p).length), mosaicHTML(playlists.songs(p).map((x) => x.art), 'mu-thumb'))).join('') }) : null,
      ];
    },
    albums() {
      const by = sortOf('albums');
      const list = lib.albums().slice().sort(by === 'artist' ? (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title) : by === 'year' ? (a, b) => (b.year || 0) - (a.year || 0) || cmp(a.title, b.title) : by === 'added' ? (a, b) => b.addedAt - a.addedAt : (a, b) => cmp(a.title, b.title));
      if (viewOf('albums') === 'grid') return [h('div', { class: 'mu-grid', html: list.map((al) => cardHTML('album', al.id, al.title, al.artist, artHTML(al.art))).join('') })];
      return [h('div', { class: 'mu-list', html: list.map((al) => itemRowHTML('album', al.id, al.title, al.artist + ' · ' + songsText(al.tracks.length), artHTML(al.art, 'mu-thumb'))).join('') })];
    },
    artists() {
      const list = lib.artists().slice();
      if (sortOf('artists') === 'count') list.sort((a, b) => b.tracks.length - a.tracks.length || cmp(a.name, b.name));
      const sub = (ar) => albumsText(ar.albums.length) + ', ' + songsText(ar.tracks.length);
      if (viewOf('artists') === 'grid') return [h('div', { class: 'mu-grid', html: list.map((ar) => cardHTML('artist', ar.id, ar.name, sub(ar), artHTML(ar.art), true)).join('') })];
      return [h('div', { class: 'mu-list', html: list.map((ar) => itemRowHTML('artist', ar.id, ar.name, sub(ar), artHTML(ar.art, 'mu-thumb round'))).join('') })];
    },
    genres() {
      const list = lib.genres();
      if (!list.length) return [h('div', { class: 'mu-none' }, h('b', null, t('music.noGenres')), h('span', null, t('music.noGenresSub')))];
      if (viewOf('genres') === 'grid') return [h('div', { class: 'mu-grid', html: list.map((g) => cardHTML('genre', g.id, g.name, songsText(g.tracks.length), mosaicHTML(g.arts, '', 'genre'))).join('') })];
      return [h('div', { class: 'mu-list', html: list.map((g) => itemRowHTML('genre', g.id, g.name, songsText(g.tracks.length), mosaicHTML(g.arts, 'mu-thumb', 'genre'))).join('') })];
    },
    folders() {
      return [h('div', { class: 'mu-list', html: lib.folders().map((f) => itemRowHTML('folder', f.id, f.name, (f.path ? f.path + ' · ' : '') + songsText(f.tracks.length), `<span class="mu-art mu-folder mu-thumb">${ic('folder', 24)}</span>`)).join('') })];
    },
  };

  function drawView() {
    const keep = root.scrollEl.scrollTop;
    if (!lib.tracks().length && tab !== 'playlists') view.replaceChildren(empty());
    else view.replaceChildren(...VIEWS[tab]().filter(Boolean));
    view.dataset.tab = tab;
    hydrateArt(view);
    root.scrollEl.scrollTop = keep;
  }

  // ——— clicks (delegated: rows, cards, playlists) ———
  function onListClick(e, container) {
    const row = e.target.closest('.mu-row[data-id]');
    const list = row?.closest('.mu-list');
    if (row && list?._list) {
      if (sel) return toggleSel(row.dataset.id, row);
      const [kind, id] = list._source;
      const ids = list._list.map((x) => x.id);
      if (music.current() === row.dataset.id && music.get().playing) return full.open();
      music.playList(ids, +row.dataset.i, { from: { kind, id } });
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go && container.contains(go)) {
      const [kind, ...rest] = go.dataset.go.split(':');
      return openGroup(kind, rest.join(':'));
    }
    if (e.target.closest('[data-create]')) return createPlaylist();
  }
  function onListMenu(e) {
    const row = e.target.closest('.mu-row[data-id]');
    if (row && !sel) {
      e.preventDefault();
      const list = row.closest('.mu-list');
      trackMenu(e, [row.dataset.id], { playlist: list?._source?.[0] === 'playlist' ? list._source[1] : null });
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      const [kind, ...rest] = go.dataset.go.split(':');
      groupMenu(e, kind, rest.join(':'));
    }
  }
  function wire(el) {
    el.addEventListener('click', (e) => onListClick(e, el));
    el.addEventListener('contextmenu', onListMenu);
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.mu-row, .mu-card')) {
        e.preventDefault();
        e.target.click();
      }
    });
    // long-press a track: selection mode, like Samsung Music
    onLongPress(el, (e) => {
      const row = e.target.closest?.('.mu-row[data-id]');
      const list = row?.closest('.mu-list');
      if (!row || !list?._list || sel) return;
      startSelect(list, row.dataset.id);
    });
  }
  wire(view);

  // ——— selection mode ———
  let selCtx = null; // { list (element), playlist id or null }
  function startSelect(listEl, first) {
    if (!listEl?._list) return;
    sel = new Set(first ? [first] : []);
    selList = listEl._list.map((x) => x.id);
    selCtx = { list: listEl, playlist: listEl._source?.[0] === 'playlist' ? listEl._source[1] : null };
    redrawSelList();
    drawSel();
  }
  function endSelect() {
    sel = null;
    const l = selCtx?.list;
    selCtx = null;
    if (l?.isConnected) redrawList(l);
    drawSel();
  }
  function toggleSel(id, row) {
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    row?.classList.toggle('checked', sel.has(id));
    drawSel();
  }
  function redrawList(l) {
    l.innerHTML = l._list.map((x, i) => rowHTML(x, i, l._opts)).join('');
    hydrateArt(l);
  }
  function redrawSelList() {
    if (selCtx?.list) redrawList(selCtx.list);
  }
  function drawSel() {
    const on = !!sel;
    const top = pages[pages.length - 1].page;
    top.el.classList.toggle('mu-selecting', on);
    root.el.classList.toggle('mu-selecting', on && top === root);
    if (!on) {
      selbar.hidden = true;
      top.el.querySelector('.mu-selbar.sub')?.remove();
      drawDock();
      return;
    }
    const n = sel.size;
    const all = n && n === selList.length;
    const bar = top === root ? selbar : top.el.querySelector('.mu-selbar.sub') || top.el.appendChild(h('div', { class: 'mu-selbar sub' }));
    bar.hidden = false;
    bar.replaceChildren(
      h('button', { class: ['mu-selall', all && 'on'], onClick: () => {
        sel = all ? new Set() : new Set(selList);
        redrawSelList();
        drawSel();
      } }, h('span', { class: 'mu-check', html: ic('check', 16) }), h('small', null, t('music.all'))),
      h('span', { class: 'mu-selcount' }, n ? t('music.nSelected', { n }) : t('music.selectTracks')),
      iconBtn('close', endSelect, t('common.cancel')));
    const ids = () => [...sel];
    const act = (name, label, fn, disabled) => h('button', { class: 'mu-act', disabled: disabled || !n, onClick: () => fn(ids()) }, h('span', { html: ic(name, 22) }), h('small', null, label));
    actbar.replaceChildren(
      act('playNext', t('music.playNext'), (l) => {
        music.playNext(l);
        toast(t('music.addedNext'));
        endSelect();
      }),
      act('playlistAdd', t('music.addToPlaylist'), (l) => addToPlaylist(l, () => endSelect())),
      selCtx?.playlist
        ? act('minus', t('music.remove'), (l) => {
          playlists.removeTracks(selCtx.playlist, l);
          endSelect();
        })
        : act('trash', t('common.delete'), (l) => removeTracks(l, endSelect)),
      act('more', t('common.more'), (l) => trackMenu(actbar.lastChild, l, { select: true })));
    drawDock();
  }

  // ——— menus ———
  function trackMenu(at, ids, { playlist = null, select = false, fromFull = false } = {}) {
    const x = ids.length === 1 ? lib.get(ids[0]) : null;
    const al = x && lib.albumOf(x), ar = x && lib.artistOfTrack(x);
    const allFav = ids.every((id) => fav.has(id));
    menu(at, [
      !select && { label: t('music.play'), icon: 'play', onClick: () => music.playList(ids, 0, { from: x ? { kind: 'track', id: x.id } : null }) },
      { label: t('music.playNext'), icon: 'playNext', onClick: () => { music.playNext(ids); toast(t('music.addedNext')); select && endSelect(); } },
      { label: t('music.addToQueue'), icon: 'queue', onClick: () => { music.addToQueue(ids); toast(t('music.addedQueue')); select && endSelect(); } },
      !select && { label: t('music.addToPlaylist'), icon: 'playlistAdd', onClick: () => addToPlaylist(ids) },
      { label: allFav ? t('music.removeFav') : t('music.addFav'), icon: allFav ? 'heart' : 'heartFill', onClick: () => {
        if (allFav) ids.forEach((id) => fav.has(id) && fav.toggle(id));
        else fav.add(ids);
        toast(allFav ? t('music.removedFav') : t('music.addedFav'));
        select && endSelect();
      } },
      '-',
      al && !fromFull && { label: t('music.goAlbum'), icon: 'album', onClick: () => openGroup('album', al.id) },
      ar && !fromFull && { label: t('music.goArtist'), icon: 'artist', onClick: () => openGroup('artist', ar.id) },
      x && { label: t('music.details'), icon: 'info', onClick: () => showDetails(x.id) },
      x && { label: x.lrc ? t('music.editLyrics') : t('music.addLyrics'), icon: 'lyrics', onClick: () => editLyrics(x.id) },
      playlist && { label: t('music.removeFromPl'), icon: 'minus', onClick: () => playlists.removeTracks(playlist, ids) },
      !select && !fromFull && { label: t('music.select'), icon: 'checkSquare', onClick: () => {
        const l = (at.target || at).closest?.('.mu-list');
        startSelect(l?._list ? l : pages[pages.length - 1].page.el.querySelector('.mu-list'), ids[0]);
      } },
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeTracks(ids, select ? endSelect : null) },
    ].filter((x) => x !== false && x !== null && x !== undefined));
  }

  function groupMenu(at, kind, id) {
    const ids = tracksOf(kind, id).map((x) => x.id);
    const items = [
      { label: t('music.play'), icon: 'play', onClick: () => playSource(kind, id) },
      { label: t('music.shuffle'), icon: 'shuffle', onClick: () => playSource(kind, id, { shuffle: true }) },
      { label: t('music.playNext'), icon: 'playNext', disabled: !ids.length, onClick: () => { music.playNext(ids); toast(t('music.addedNext')); } },
      { label: t('music.addToPlaylist'), icon: 'playlistAdd', disabled: !ids.length, onClick: () => addToPlaylist(ids) },
    ];
    if (kind === 'playlist') {
      items.push('-',
        { label: t('music.addTracks'), icon: 'plus', onClick: () => pickTracks(id) },
        { label: t('common.rename'), icon: 'edit', onClick: () => renamePlaylist(id) },
        { label: t('music.deletePlaylist'), icon: 'trash', danger: true, onClick: () => deletePlaylist(id) });
    } else if (kind !== 'smart') items.push('-', { label: t('common.delete'), icon: 'trash', danger: true, disabled: !ids.length, onClick: () => removeTracks(ids) });
    menu(at, items);
  }

  function mainMenu(at) {
    const items = [
      { label: t('music.addMusic'), icon: 'musicAdd', onClick: () => addMenu(at) },
      tab !== 'playlists' && lib.tracks().length && { label: t('music.select'), icon: 'checkSquare', onClick: () => {
        if (tab !== 'tracks') setTab('tracks');
        startSelect(view.querySelector('.mu-list'));
      } },
      SORTS[tab] && lib.tracks().length && { label: t('music.sortBy'), icon: 'sort', onClick: async () => {
        const v = await choose(t('music.sortBy'), SORTS[tab].map((s) => ({ value: s, label: t('music.sort.' + s) })), sortOf(tab));
        if (v) {
          setPref({ sort: { ...prefs().sort, [tab]: v } });
          drawView();
        }
      } },
      VIEWABLE.includes(tab) && lib.tracks().length && { label: viewOf(tab) === 'grid' ? t('music.viewList') : t('music.viewGrid'), icon: viewOf(tab) === 'grid' ? 'list' : 'grid', onClick: () => {
        setPref({ view: { ...prefs().view, [tab]: viewOf(tab) === 'grid' ? 'list' : 'grid' } });
        drawView();
      } },
      tab === 'playlists' && { label: t('music.createPlaylist'), icon: 'plus', onClick: createPlaylist },
      '-',
      { label: t('music.sleepTimer'), icon: 'sleep', onClick: () => sleepDialog() },
      { label: t('music.settings'), icon: 'settings', onClick: () => openSettings(push, { runImport, addMenu }) },
    ].filter(Boolean);
    menu(at, items, { align: 'end' });
  }

  function addMenu(at) {
    menu(at, [
      { label: t('music.addFiles'), icon: 'musicAdd', onClick: () => runImport(pickMusic(false)) },
      { label: t('music.addFolder'), icon: 'folder', onClick: () => runImport(pickMusic(true)) },
    ], { align: 'end' });
  }

  // ——— playlists ———
  async function createPlaylist(ids = []) {
    const name = await prompt(t('music.createPlaylist'), { placeholder: t('music.playlistName'), okLabel: t('music.create') });
    if (!name?.trim()) return null;
    const p = playlists.create(name.trim(), Array.isArray(ids) ? ids : []);
    toast(t('music.playlistCreated'));
    return p;
  }
  async function renamePlaylist(id) {
    const p = playlists.get(id);
    const name = await prompt(t('common.rename'), { value: p?.name || '', placeholder: t('music.playlistName') });
    if (name?.trim()) playlists.update(id, { name: name.trim() });
  }
  async function deletePlaylist(id) {
    const p = playlists.get(id);
    if (!(await confirm(t('music.deletePlaylistQ'), t('music.deletePlaylistMsg', { name: p?.name || '' }), { okLabel: t('common.delete'), danger: true }))) return;
    playlists.remove(id);
    if (pages.some((x) => x.page._group === 'playlist:' + id)) while (pages.length > 1 && ctx.depth > 1) ctx.pop();
    toast(t('music.deleted'));
  }

  /** "Add tracks" to a playlist: a page of every track with check marks. */
  function pickTracks(plId) {
    const picked = new Set();
    let q = '';
    const p = push({ title: t('music.addTracks'), hero: false, className: 'mu-pick' }, { mini: false });
    const done = h('button', { class: 'ou-btn primary mu-pick-done', disabled: true, onClick: () => {
      const n = playlists.add(plId, [...picked]);
      toast(n === 1 ? t('music.addedOne') : t('music.addedN', { n }));
      ctx.pop();
    } }, t('common.done'));
    p.setActions([done]);
    const input = h('input', { type: 'search', placeholder: t('music.searchLib'), 'aria-label': t('common.search') });
    const listEl = h('div', { class: 'mu-list' });
    const already = new Set(playlists.get(plId)?.tracks || []);
    const draw = () => {
      const all = sortTracks(lib.tracks(), 'title').filter((x) => !q || [x.title, x.artist, x.album].some((s) => (s || '').toLowerCase().includes(q)));
      listEl.innerHTML = all.map((x) => `<div class="mu-row${picked.has(x.id) || already.has(x.id) ? ' checked' : ''}${already.has(x.id) ? ' muted' : ''}" data-pick="${esc(x.id)}" tabindex="0" role="button">
        <span class="mu-check">${ic('check', 16)}</span><span class="mu-lead">${artHTML(x.art, 'mu-thumb')}</span>
        <span class="mu-tt"><span class="mu-t1">${esc(x.title)}</span><span class="mu-t2">${esc(artistOf(x))}</span></span></div>`).join('') || `<div class="mu-none"><b>${esc(t('music.noResults'))}</b></div>`;
      hydrateArt(listEl);
    };
    input.addEventListener('input', debounce(() => {
      q = input.value.trim().toLowerCase();
      draw();
    }, 120));
    listEl.addEventListener('click', (e) => {
      const r = e.target.closest('[data-pick]');
      if (!r || already.has(r.dataset.pick)) return;
      const id = r.dataset.pick;
      picked.has(id) ? picked.delete(id) : picked.add(id);
      r.classList.toggle('checked', picked.has(id));
      done.disabled = !picked.size;
      done.textContent = picked.size ? t('music.addN', { n: picked.size }) : t('common.done');
    });
    p.body.append(h('label', { class: 'ou-searchbox mu-search' }, h('span', { html: ic('search', 20) }), input), listEl);
    draw();
  }

  // ——— album / artist / genre / folder / playlist pages ———
  function openGroup(kind, id) {
    full.close();
    const p = push({ title: '', hero: false, className: 'mu-detail' });
    p._group = kind + ':' + id;
    p.setActions([iconBtn('more', (e) => groupMenu(e.currentTarget, kind, id), t('common.more'))]);
    wire(p.body);
    const draw = () => {
      const g = kind === 'playlist' ? playlists.get(id) : kind === 'smart' ? SMART[id] : lib.group(id);
      if (!g) {
        p.body.replaceChildren(h('div', { class: 'mu-none' }, h('b', null, t('music.notAvailable'))));
        return;
      }
      const list = tracksOf(kind, id);
      let title, sub = '', art;
      if (kind === 'album') {
        title = g.title;
        sub = [g.artist, g.year || ''].filter(Boolean).join(' · ');
        art = artHTML(g.art, 'mu-dart');
      } else if (kind === 'artist') {
        title = g.name;
        sub = albumsText(g.albums.length);
        art = artHTML(g.art, 'mu-dart round');
      } else if (kind === 'playlist') {
        title = g.name;
        art = mosaicHTML(list.map((x) => x.art), 'mu-dart');
      } else if (kind === 'smart') {
        title = t(g.name);
        art = smartArt(id, 'mu-dart');
      } else if (kind === 'genre') {
        title = g.name;
        art = mosaicHTML(g.arts, 'mu-dart', 'genre');
      } else {
        title = g.name;
        sub = g.path;
        art = `<span class="mu-art mu-folder mu-dart">${ic('folder', 56)}</span>`;
      }
      p.setTitle(title);
      const dur = list.reduce((a, x) => a + (x.dur || 0), 0);
      const head = h('div', { class: 'mu-dhead' },
        h('div', { class: 'mu-dcover', html: art }),
        h('div', { class: 'mu-dtitle' }, title),
        sub ? h('div', { class: 'mu-dsub' }, sub) : null,
        h('div', { class: 'mu-dmeta' }, list.length ? songsText(list.length) + ' · ' + durText(dur) : songsText(0)),
        h('div', { class: 'mu-dbtns' },
          h('button', { class: 'ou-btn tonal', disabled: !list.length, onClick: () => playSource(kind, id, { shuffle: true }) }, h('span', { html: ic('shuffle', 18) }), t('music.shuffle')),
          h('button', { class: 'ou-btn primary', disabled: !list.length, onClick: () => playSource(kind, id) }, h('span', { html: ic('play', 18) }), t('music.playAll'))));
      const parts = [head];
      if (kind === 'artist' && g.albums.length > 1) {
        parts.push(h('div', { class: 'mu-sub' }, t('music.tab.albums')),
          h('div', { class: 'mu-shelf', html: g.albums.map((al) => cardHTML('album', al.id, al.title, al.year ? String(al.year) : songsText(al.tracks.length), artHTML(al.art))).join('') }),
          h('div', { class: 'mu-sub' }, t('music.tab.tracks')));
      }
      if (kind === 'playlist') parts.push(h('button', { class: 'mu-addtracks', onClick: () => pickTracks(id) }, h('span', { html: ic('plus', 20) }), t('music.addTracks')));
      if (list.length) parts.push(trackList(list, [kind, id], { num: kind === 'album', sub: kind === 'album' ? 'artist' : kind === 'artist' ? 'album' : 'artist' }));
      else if (kind === 'playlist' || kind === 'smart') parts.push(h('div', { class: 'mu-none' }, h('b', null, t('music.emptyList')), kind === 'smart' && id === 'fav' ? h('span', null, t('music.emptyFav')) : null));
      p.body.replaceChildren(...parts);
      hydrateArt(p.body);
    };
    p._draw = draw;
    draw();
  }

  // ——— search ———
  function openSearch(text = '') {
    full.close();
    const p = push({ title: t('common.search'), hero: false, className: 'mu-searchpage' });
    const input = h('input', { type: 'search', placeholder: t('music.searchPh'), 'aria-label': t('common.search'), value: text, autofocus: true });
    const out = h('div', { class: 'mu-results' });
    wire(out);
    const draw = () => {
      const q = input.value.trim();
      if (!q) {
        const rs = recentSearches();
        out.replaceChildren(...(rs.length ? [
          h('div', { class: 'mu-sub mu-subrow' }, h('span', null, t('music.recentSearches')), h('button', { class: 'mu-link', onClick: () => { clearSearches(); draw(); } }, t('music.clear'))),
          h('div', { class: 'ou-chips mu-chips' }, rs.map((s) => h('button', { class: 'ou-chip', onClick: () => { input.value = s; draw(); } }, s))),
        ] : [h('div', { class: 'mu-none' }, h('span', { html: ic('search', 40) }), h('span', null, t('music.searchHint')))]));
        return;
      }
      const r = searchLibrary(q);
      const parts = [];
      if (r.tracks.length) parts.push(h('div', { class: 'mu-sub' }, t('music.tab.tracks')), trackList(r.tracks.slice(0, 50), ['search', q], { sub: 'both' }));
      if (r.albums.length) parts.push(h('div', { class: 'mu-sub' }, t('music.tab.albums')), h('div', { class: 'mu-shelf', html: r.albums.map((al) => cardHTML('album', al.id, al.title, al.artist, artHTML(al.art))).join('') }));
      if (r.artists.length) parts.push(h('div', { class: 'mu-sub' }, t('music.tab.artists')), h('div', { class: 'mu-list', html: r.artists.map((ar) => itemRowHTML('artist', ar.id, ar.name, songsText(ar.tracks.length), artHTML(ar.art, 'mu-thumb round'))).join('') }));
      out.replaceChildren(...(parts.length ? parts : [h('div', { class: 'mu-none' }, h('b', null, t('music.noResults')))]));
      hydrateArt(out);
    };
    const remember = debounce(() => noteSearch(input.value), 1500);
    input.addEventListener('input', () => {
      draw();
      remember();
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && noteSearch(input.value));
    p.body.append(h('label', { class: 'ou-searchbox mu-search' }, h('span', { html: ic('search', 20) }), input), out);
    p._draw = draw;
    draw();
    setTimeout(() => input.focus(), 120);
  }

  // ——— deleting ———
  async function removeTracks(ids, after) {
    const x = ids.length === 1 ? lib.get(ids[0]) : null;
    const ok = await confirm(x ? t('music.deleteOneQ', { name: x.title }) : t('music.deleteNQ', { n: ids.length }), t('music.deleteMsg'), { okLabel: t('common.delete'), danger: true });
    if (!ok) return;
    await deleteTracks(ids);
    music.sync();
    after?.();
    toast(ids.length === 1 ? t('music.deleted') : t('music.deletedN', { n: ids.length }));
  }

  // ——— importing ———
  async function runImport(itemsP) {
    const items = await itemsP;
    if (!items?.length) return;
    if (importState()) {
      toast(t('music.busy'));
      return;
    }
    importEl.hidden = false;
    drawDock();
    const bar = importEl.querySelector('i'), label = importEl.querySelector('.mu-import-t');
    label.textContent = t('music.adding');
    bar.style.width = '0%';
    const st = await importFiles(items, (s) => {
      label.textContent = t('music.addingN', { done: s.done, total: s.total });
      bar.style.width = Math.round((s.done / Math.max(1, s.total)) * 100) + '%';
    }).catch((e) => {
      console.error(e);
      return null;
    });
    importEl.hidden = true;
    drawDock();
    if (!st) return toast(t('music.importFail'));
    if (!st.total) return toast(t('music.noAudio'));
    const parts = [st.added === 1 ? t('music.addedOne') : t('music.addedN', { n: st.added })];
    if (st.skipped) parts.push(t('music.skippedN', { n: st.skipped }));
    if (st.failed) parts.push(t('music.failedN', { n: st.failed }));
    toast(parts.join(' · '));
  }

  // drop files or folders on the window
  const onDragOver = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    ctx.win.classList.add('mu-dropping');
  };
  const onDragLeave = (e) => {
    if (!ctx.win.contains(e.relatedTarget)) ctx.win.classList.remove('mu-dropping');
  };
  const onDrop = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    ctx.win.classList.remove('mu-dropping');
    runImport(filesFromDrop(e.dataTransfer));
  };
  ctx.win.addEventListener('dragover', onDragOver);
  ctx.win.addEventListener('dragleave', onDragLeave);
  ctx.win.addEventListener('drop', onDrop);
  ctx.win.append(h('div', { class: 'mu-drop' }, h('span', { html: ic('musicAdd', 40) }), h('b', null, t('music.dropHere')), h('small', null, t('music.staysHere'))));

  // ——— mini player ———
  let miniKey = '';
  function drawMini() {
    const m = music.get(), n = m.now;
    const has = !!(m.queue.length && n);
    mini.hidden = !has;
    if (!has) return;
    const key = [n.id, n.title, n.artist, n.art, m.playing].join('|');
    if (key !== miniKey) {
      miniKey = key;
      mini.style.setProperty('--mc', n.color || 'var(--accent)');
      mini.classList.toggle('playing', m.playing);
      mini.innerHTML = `<span class="mu-mini-art">${artHTML(n.art)}</span>
        <span class="mu-mini-tt"><span class="mu-t1">${esc(n.title)}</span><span class="mu-t2">${esc(n.artist || t('music.unknownArtist'))}</span></span>
        <button class="ou-icon-btn" data-m="prev" aria-label="${esc(t('music.prev'))}">${ic('prev', 22)}</button>
        <button class="ou-icon-btn mu-mini-pp" data-m="toggle" aria-label="${esc(m.playing ? t('music.pause') : t('music.play'))}">${ic(m.playing ? 'pause' : 'play', 24)}</button>
        <button class="ou-icon-btn" data-m="next" aria-label="${esc(t('music.next'))}">${ic('next', 22)}</button>
        <span class="mu-mini-prog"><i></i></span>`;
      hydrateArt(mini);
    }
    tickMini();
  }
  function tickMini() {
    const d = music.dur();
    const i = mini.querySelector('.mu-mini-prog i');
    if (i) i.style.width = (d ? Math.min(100, (music.pos() / d) * 100) : 0) + '%';
  }
  mini.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (b) {
      e.stopPropagation();
      return music[b.dataset.m]();
    }
    full.open();
  });
  mini.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && e.target === mini && (e.preventDefault(), full.open()));

  function drawDock() {
    const top = pages[pages.length - 1];
    const selecting = !!sel;
    actbar.hidden = !selecting;
    drawMini();
    if (!top.mini || selecting) mini.hidden = true;
    const showing = !mini.hidden || !actbar.hidden || !importEl.hidden;
    stack.classList.toggle('mu-docked', showing);
  }

  // ——— keeping things current ———
  const markPlaying = () => {
    const cur = music.current();
    stack.querySelectorAll('.mu-row.current').forEach((r) => r.dataset.id !== cur && r.classList.remove('current'));
    if (cur) stack.querySelectorAll(`.mu-row[data-id="${CSS.escape(cur)}"]`).forEach((r) => r.classList.add('current'));
    stack.classList.toggle('mu-playing', music.get().playing);
  };
  const refreshAll = () => {
    drawView();
    for (const x of pages) if (x.page !== root) x.page._draw?.();
    markPlaying();
  };
  offs.push(lib.onChange(() => {
    music.sync();
    refreshAll();
  }));
  offs.push(store.on('musicLib', debounce(refreshAll, 50)));
  offs.push(store.on('musicStats', debounce(() => (tab === 'playlists' ? drawView() : null), 400)));
  offs.push(store.on('music', () => {
    drawDock();
    markPlaying();
  }));
  offs.push(store.on('musicPos', tickMini));
  const timer = setInterval(() => !mini.hidden && music.get().playing && tickMini(), 1000);

  const onKey = (e) => {
    // with several windows open, keys belong to the focused one
    if (e.defaultPrevented || !ctx.focused) return;
    if (e.key === 'Escape' && sel && !document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) {
      e.preventDefault();
      e.stopPropagation();
      endSelect();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === ' ' && !e.target.closest('input, textarea, button, [role=button], [contenteditable]')) {
      e.preventDefault();
      music.toggle();
    }
  };
  addEventListener('keydown', onKey, true);

  ctx.setParams = (p) => {
    if (p?.full) full.open();
    else if (p?.tab && TABS.includes(p.tab)) setTab(p.tab);
    if (p?.search) openSearch(p.search);
    if (p?.group) openGroup(...p.group.split(/:(.*)/s).slice(0, 2));
  };

  drawTabs();
  drawView();
  drawDock();
  markPlaying();
  if (ctx.params?.full || ctx.params?.search || ctx.params?.group) ctx.setParams(ctx.params);

  return () => {
    offs.forEach((f) => f());
    clearInterval(timer);
    removeEventListener('keydown', onKey, true);
    ctx.win.removeEventListener('dragover', onDragOver);
    ctx.win.removeEventListener('dragleave', onDragLeave);
    ctx.win.removeEventListener('drop', onDrop);
    full.destroy();
  };
}

// art helpers other modules of the app use
export { cachedArt, artUrl, plays };
