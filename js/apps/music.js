// Samsung Music (One UI): registration, icons, the Quick Panel media card, the Now Bar, widgets (Now playing,
// Recently played) and Finder (search + "play …", "pause", "next"). Kept light: the app UI (js/music/ui.js) and the
// library (js/music/library.js) load only when needed. Playback runs in the offscreen document (js/bg/music.js).
import { h, isExt, everySecond } from '../core/util.js';
import { addIcons, icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerMedia, registerCommand } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t } from '../core/i18n.js';
import { blobUrl } from '../core/blobs.js';
import * as sounds from '../shell/sounds.js';
import { withDefaults, livePos, matchScore } from '../music/core.js';
import { registerMusicActions, listChoices } from '../music/actions.js';
import { choose } from '../core/ui.js';

addIcons({
  heart: '<path d="M12 19.6s-7.6-4.5-7.6-10A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.6 2.4c0 5.5-7.6 10-7.6 10Z"/>',
  heartFill: '<path d="M12 19.6s-7.6-4.5-7.6-10A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.6 2.4c0 5.5-7.6 10-7.6 10Z" fill="currentColor"/>',
  shuffle: '<path d="M3.5 7.5h3c2 0 3.2.9 4.3 2.6l2.4 3.8c1.1 1.7 2.3 2.6 4.3 2.6h3"/><path d="M3.5 16.5h3c1.3 0 2.2-.4 3-1.1M14.2 8.6c.8-.7 1.7-1.1 3-1.1h3"/><path d="m18 5 2.5 2.5L18 10M18 14l2.5 2.5L18 19"/>',
  repeat: '<path d="M4.5 11.5V10a3 3 0 0 1 3-3h12"/><path d="m16.5 4 3 3-3 3"/><path d="M19.5 12.5V14a3 3 0 0 1-3 3h-12"/><path d="m7.5 20-3-3 3-3"/>',
  repeatOne: '<path d="M4.5 11.5V10a3 3 0 0 1 3-3h12"/><path d="m16.5 4 3 3-3 3"/><path d="M19.5 12.5V14a3 3 0 0 1-3 3h-12"/><path d="m7.5 20-3-3 3-3"/><path d="M11 11.2 12.6 10v4.4"/>',
  queue: '<path d="M4 6.5h12M4 11h12M4 15.5h7"/><path d="M18.5 18.6v-6.2l2.5-.8"/><circle cx="16.7" cy="18.6" r="1.8"/>',
  playlist: '<path d="M4 6.5h11M4 11h11M4 15.5h6.5"/><path d="M15.5 13.5v6.6l5.2-3.3Z"/>',
  playlistAdd: '<path d="M4 6.5h12M4 11h12M4 15.5h7"/><path d="M17.5 13v7M14 16.5h7"/>',
  playNext: '<path d="M5 5.5v13l8-6.5Z"/><path d="M15.5 6.5h5M15.5 12h5M15.5 17.5h5"/>',
  lyrics: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8.6a1.5 1.5 0 0 1-1.5 1.5h-8.6L6.5 20v-3.4H5a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 5 5Z"/><path d="M8 9.5h8M8 12.8h5"/>',
  album: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.4"/><path d="M12 6.5a5.5 5.5 0 0 0-5.5 5.5"/>',
  artist: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9"/><path d="M18.3 11.6v6.3"/><circle cx="16.6" cy="18" r="1.8"/><path d="m18.3 11.6 2.4.8"/>',
  genre: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4.2l9.3 9.3-6.7 6.7L4 10.7Z"/><circle cx="8.6" cy="8.6" r="1.4"/>',
  chart: '<path d="M5 19.5V13M10 19.5V8.5M15 19.5v-8M20 19.5V5"/>',
  plusCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.3v7.4M8.3 12h7.4"/>',
  eq: '<path d="M6 4v5M6 13v7M12 4v9M12 17v3M18 4v3M18 11v9"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="9" r="2"/>',
  sleep: '<path d="M19 14.6A7.4 7.4 0 0 1 9.4 5a7.5 7.5 0 1 0 9.6 9.6Z"/><path d="M14.5 4h4l-4 4.5h4"/>',
  speed: '<path d="M4.6 17a8 8 0 1 1 14.8 0"/><path d="m12 14 3.6-4.2"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
  crossfade: '<path d="M3 17.5c4 0 5-11 9-11s5 11 9 11"/><path d="M3 6.5c4 0 5 11 9 11s5-11 9-11" opacity=".55"/>',
  checkSquare: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="m8.3 12.2 2.6 2.6 4.8-5.3"/>',
  drag: '<path d="M5 9h14M5 15h14"/>',
  volLow: '<path d="M5.5 9.5v5H9l4.5 4v-13L9 9.5H5.5Z"/><path d="M16.5 10a3 3 0 0 1 0 4"/>',
  musicAdd: '<path d="M9 17.5V6.2l9-2v5.6"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M17.5 13.5v7M14 17h7"/>',
});

const M = () => withDefaults(store.get('music'));
const accent = '#fc5c65';

/** Light controls for surfaces outside the app: the service worker works out next/previous from the library. */
function control(cmd) {
  if (!isExt) return import('../music/player.js').then((p) => p.music[cmd]());
  chrome.runtime.sendMessage({ type: 'music-cmd', cmd }).catch(() => {});
}
registerMusicActions(control); // Modes and Routines: Media control, Play playlist

// ——— cover art as object URLs for the Quick Panel and widgets ———
const arts = new Map(); // art id -> url | null | Promise
const artWaiters = new Set();
function artSrc(id) {
  if (!id) return null;
  const v = arts.get(id);
  if (typeof v === 'string' || v === null) return v;
  if (!v) {
    arts.set(id, blobUrl('music:art:' + id).then((u) => {
      arts.set(id, u || null);
      artWaiters.forEach((fn) => fn());
    }, () => arts.set(id, null)));
  }
  return null;
}
const onArt = (fn) => (artWaiters.add(fn), () => artWaiters.delete(fn));

// ——— music and ambient sounds take turns, like two audio apps on a phone ———
store.on('music', (v) => {
  if (v?.playing && sounds.state().playing) sounds.pause();
});
sounds.onSoundChange((st) => {
  if (st.playing && M().playing) control('pause');
});

// ——— Quick Panel media card ———
const mediaFns = new Set();
const mediaChanged = () => mediaFns.forEach((fn) => fn());
store.on('music', mediaChanged);
onArt(mediaChanged);
registerMedia({
  id: 'music',
  state() {
    const m = M(), n = m.now;
    if (!m.queue.length || !n) return null;
    return { title: n.title, sub: n.artist || t('music.unknownArtist'), art: artSrc(n.art), icon: 'music', color: n.color || accent, playing: m.playing };
  },
  toggle: () => control('toggle'),
  next: () => control('next'),
  prev: () => control('prev'),
  open: () => openApp('music', { params: { full: true } }),
  subscribe(fn) {
    mediaFns.add(fn);
    return () => mediaFns.delete(fn);
  },
});

// ——— Now Bar (the Lock screen and the rest of the shell; the Quick Panel leaves out the activity of the media source its
// media card shows, so the song isn't listed twice there) ———
registerActivity('music', () => {
  const m = M(), n = m.now;
  if (!m.playing || !n || !m.queue.length) return null;
  return {
    icon: 'music',
    color: n.color || accent,
    title: n.title,
    sub: n.artist || t('music.unknownArtist'),
    wave: true,
    app: 'music',
    priority: 6,
    actions: [{ icon: 'pause', label: t('music.pause'), onClick: () => control('pause') }],
  };
});

// ——— app ———
registerApp({
  id: 'music',
  name: 'app.music',
  icon: {
    bg: 'linear-gradient(150deg, #ff9a5c 0%, #ff5470 55%, #f2386f 100%)',
    glyph: '<path d="M9.2 17.6V6.8l9.3-2.2v10.6"/><circle cx="6.9" cy="17.6" r="2.4" fill="#fff"/><circle cx="16.2" cy="15.3" r="2.4" fill="#fff"/><path d="M9.2 10.2l9.3-2.2"/>',
  },
  keywords: ['music', 'samsung music', 'songs', 'mp3', 'player', 'playlist', 'موسيقى', 'أغاني', 'مقاطع'],
  render: (ctx) =>
    Promise.all([import('../music/ui.js'), import('../music/library.js').then((L) => L.lib.ready())]).then(([m]) => m.render(ctx)),
  async search(q) {
    await warm();
    return best(L, q.trim().toLowerCase(), 8).map((r) => ({ title: r.title, sub: r.sub, icon: r.icon, onOpen: r.open }));
  },
});

/** Library matches for Finder: tracks, albums and artists ranked together. */
function best(L, q, n) {
  if (!q) return [];
  const out = [];
  for (const x of L.lib.tracks()) {
    const s = Math.max(matchScore(x.title, q) * 1.1, matchScore(x.artist, q) * 0.8, matchScore(x.album, q) * 0.6);
    if (s) out.push({ s: s + 0.02, title: x.title, sub: (x.artist || t('music.unknownArtist')) + ' · ' + t('music.k.track'), icon: 'music', open: () => playIt('track', x.id) });
  }
  for (const a of L.lib.albums()) {
    const s = Math.max(matchScore(a.title, q), matchScore(a.artist, q) * 0.7);
    if (s) out.push({ s: s + 0.01, title: a.title, sub: t('music.k.album', { name: a.artist }), icon: 'album', open: () => openApp('music', { params: { group: 'album:' + a.id } }), play: () => playIt('album', a.id) });
  }
  for (const a of L.lib.artists()) {
    const s = matchScore(a.name, q);
    if (s) out.push({ s, title: a.name, sub: t('music.k.artist'), icon: 'artist', open: () => openApp('music', { params: { group: 'artist:' + a.id } }), play: () => playIt('artist', a.id) });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, n);
}

/** Play a track (within its album), an album or an artist. */
async function playIt(kind, id) {
  const [L, P] = await Promise.all([import('../music/library.js'), import('../music/player.js')]);
  await L.lib.ready();
  if (kind === 'track') {
    const x = L.lib.get(id), al = x && L.lib.albumOf(x);
    return al ? P.playSource('album', al.id, { start: id }) : P.playSource('track', id);
  }
  return P.playSource(kind, id);
}

// ——— Finder commands: "play <track/artist/album>", "pause", "next", "previous", "resume" ———
let L = null, warming = null;
const warm = () => (warming ||= import('../music/library.js').then(async (m) => {
  await m.lib.ready();
  L = m;
}));
registerCommand('music', (q, lower, done) => {
  const m = M(), has = m.queue.length > 0, out = [];
  // load the library while "play …" is still being typed, so the matches are there by the time it's complete
  if (!L && /^(pl|شغ|تش)/.test(lower)) warm();
  const sub = m.now ? m.now.title : t('music.command');
  if (/^((pause|stop)( (the )?(music|song|track))?|إيقاف مؤقت|أوقف الموسيقى|إيقاف الموسيقى)$/.test(lower) && m.playing) {
    out.push({ icon: 'pause', title: t('music.cmdPause'), sub, run: () => (control('pause'), done()) });
  }
  if (/^((play|resume)( (the )?music)?|استئناف( الموسيقى)?|شغل الموسيقى|تشغيل الموسيقى)$/.test(lower) && has && !m.playing) {
    out.push({ icon: 'play', title: t('music.cmdResume'), sub, run: () => (control('play'), done()) });
  }
  if (/^((next|skip)( (track|song))?|التالي|المقطع التالي)$/.test(lower) && has) out.push({ icon: 'next', title: t('music.cmdNext'), sub, run: () => (control('next'), done()) });
  if (/^((previous|prev)( (track|song))?|السابق|المقطع السابق)$/.test(lower) && has) out.push({ icon: 'prev', title: t('music.cmdPrev'), sub, run: () => (control('prev'), done()) });
  const pm = /^(?:play|شغل|شغّل|تشغيل)\s+(.+)$/i.exec(q);
  if (pm && !/^(the )?music$|^الموسيقى$/i.test(pm[1].trim())) {
    const term = pm[1].trim().toLowerCase();
    if (!L) {
      warm();
      out.push({ icon: 'music', title: t('music.cmdPlaySearch', { q: pm[1].trim() }), sub: t('music.command'), run: async () => {
        done();
        await warm();
        const r = best(L, term, 1)[0];
        if (r) (r.play || r.open)();
      } });
    } else {
      for (const r of best(L, term, 3)) out.push({ icon: 'play', title: t('music.cmdPlay', { name: r.title }), sub: r.sub, run: () => (done(), (r.play || r.open)()) });
    }
  }
  return out;
});

// ——— widgets ———
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

registerWidget({
  id: 'music',
  name: 'music.w.now',
  sizes: ['s', 'm'],
  defaultSize: 'm',
  app: 'music',
  onClick: (item, el) => openApp('music', { from: el, params: M().queue.length ? { full: true } : {} }),
  render(el, { size }) {
    el.classList.add('wg-music', 'wg-music-' + size);
    if (size === 's') el.classList.add('wg-fill');
    const btn = (name, label, cls = '') => h('button', { class: ['wgm-btn', cls], 'aria-label': label, html: icon(name, cls ? 22 : 18), onClick: (e) => {
      e.stopPropagation();
      control(name === 'play' || name === 'pause' ? 'toggle' : name);
    } });
    const prog = () => {
      const m = M(), p = store.get('musicPos'), bar = el.querySelector('.wgm-prog i');
      if (!bar || !m.now) return;
      const d = (p?.id === m.now.id && p.dur) || m.now.dur || 0;
      const pos = p?.id === m.now.id ? (m.playing ? livePos(p, m.speed) : p.pos) : 0;
      bar.style.width = (d ? Math.min(100, (pos / d) * 100) : 0) + '%';
      const tm = el.querySelector('.wgm-time');
      if (tm) tm.textContent = fmt(pos) + ' / ' + fmt(d);
    };
    const draw = () => {
      const m = M(), n = m.queue.length ? m.now : null;
      el.classList.toggle('playing', !!m.playing);
      el.classList.toggle('empty', !n);
      el.style.setProperty('--mc', n?.color || accent);
      const src = n ? artSrc(n.art) : null;
      const cover = src ? h('img', { class: 'wgm-img', src, alt: '' }) : h('span', { class: 'wgm-ph', html: icon('music', size === 's' ? 34 : 30) });
      const play = btn(m.playing ? 'pause' : 'play', m.playing ? t('music.pause') : t('music.play'), 'main');
      if (!n) play.disabled = true;
      const titles = h('div', { class: 'wgm-tt' },
        h('div', { class: 'wgm-t1' }, n ? n.title : t('music.notPlaying')),
        h('div', { class: 'wgm-t2' }, n ? n.artist || t('music.unknownArtist') : t('music.tapToPlay')));
      if (size === 's') {
        el.replaceChildren(h('div', { class: 'wgm-cover' }, cover), h('div', { class: 'wgm-shade' }), h('div', { class: 'wgm-foot' }, titles, play));
      } else {
        el.replaceChildren(
          h('div', { class: 'wgm-cover' }, cover),
          h('div', { class: 'wgm-side' },
            h('div', { class: 'wg-head' }, h('span', { html: icon('music', 14) }), t('app.music')),
            titles,
            h('div', { class: 'wgm-prog' }, h('i')),
            h('div', { class: 'wgm-ctrls' }, btn('prev', t('music.prev')), play, btn('next', t('music.next')))));
      }
      prog();
    };
    draw();
    const offs = [store.on('music', draw), store.on('musicPos', prog), onArt(draw)];
    const stop = everySecond(prog);
    return () => {
      offs.forEach((f) => f());
      stop();
    };
  },
});

registerWidget({
  id: 'music-recent',
  name: 'music.w.recent',
  sizes: ['m', 'l'],
  defaultSize: 'm',
  app: 'music',
  // Widget settings: which playlist the widget lists (Recently played by default, as before it had settings)
  async configure(config) {
    const cur = listChoices().some(([v]) => v === config.list) ? config.list : 'smart:played';
    const v = await choose(t('music.w.pickList'), listChoices().map(([value, label]) => ({ value, label: t(label) })), cur);
    return v == null ? null : { ...config, list: v };
  },
  onClick(item, el) {
    const [kind, id] = String(item.config?.list || '').split(':');
    openApp('music', { from: el, params: kind === 'playlist' && id ? { group: 'playlist:' + id } : {} });
  },
  render(el, { size, preview, config }) {
    el.classList.add('wg-music-recent');
    let alive = true, lib = null;
    const which = () => (listChoices().some(([v]) => v === config?.list) ? config.list : 'smart:played');
    const tracks = (key, n) => {
      const [kind, id] = key.split(':');
      if (kind === 'smart') return (lib.SMART[id]?.songs() || []).slice(0, n);
      if (kind === 'playlist') return lib.playlists.songs(lib.playlists.get(id)).slice(0, n);
      return lib.lib.tracks().slice(0, n);
    };
    const draw = () => {
      if (!alive) return;
      const key = which(), [kind, id = ''] = key.split(':');
      const list = lib ? tracks(key, size === 'l' ? 7 : 3) : [];
      const label = listChoices().find(([v]) => v === key)?.[1] || 'music.w.recent';
      const head = h('div', { class: 'wg-head' }, h('span', { html: icon(key === 'smart:played' ? 'history' : kind === 'smart' ? 'heart' : 'playlist', 14) }), key === 'smart:played' ? t('music.w.recent') : t(label));
      if (!list.length) {
        el.replaceChildren(head, h('div', { class: 'wgr-empty' }, h('span', { html: icon('music', 28) }), key === 'smart:played' ? t('music.noRecent') : t('music.w.noTracks')));
        return;
      }
      const from = kind === 'all' ? { kind: 'tracks', id: '' } : { kind, id };
      el.replaceChildren(head, h('div', { class: 'wgr-list' }, list.map((x, i) => {
        const src = artSrc(x.art);
        return h('button', { class: 'wgr-row', onClick: (e) => {
          e.stopPropagation();
          if (preview) return;
          import('../music/player.js').then((P) => P.music.playList(list.map((y) => y.id), i, { from }));
        } },
        src ? h('img', { class: 'wgr-art', src, alt: '' }) : h('span', { class: 'wgr-art ph', html: icon('music', 16) }),
        h('span', { class: 'wgr-tt' }, h('b', null, x.title), h('small', null, x.artist || t('music.unknownArtist'))),
        h('span', { class: 'wgr-play', html: icon('play', 14) }));
      })));
    };
    draw();
    const offs = [store.on('musicStats', draw), store.on('musicLib', draw), onArt(draw)];
    import('../music/library.js').then(async (m) => {
      await m.lib.ready();
      lib = m;
      offs.push(m.lib.onChange(draw));
      draw();
    });
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  },
});

addStrings({
  en: {
    'app.music': 'Music',
    'music.w.now': 'Now playing',
    'music.w.recent': 'Recently played',
    'music.notPlaying': 'Not playing',
    'music.tapToPlay': 'Tap to open Music',
    'music.noRecent': 'Nothing played yet',
    'music.unknownArtist': 'Unknown artist',
    'music.unknownAlbum': 'Unknown album',
    'music.variousArtists': 'Various artists',
    'music.addedFiles': 'Added files',
    'music.play': 'Play',
    'music.pause': 'Pause',
    'music.next': 'Next',
    'music.prev': 'Previous',
    'music.command': 'Music',
    'music.cmdPause': 'Pause music',
    'music.cmdResume': 'Resume music',
    'music.cmdNext': 'Next track',
    'music.cmdPrev': 'Previous track',
    'music.cmdPlay': 'Play “{name}”',
    'music.cmdPlaySearch': 'Play “{q}” in Music',
    'music.k.track': 'Track',
    'music.k.album': 'Album · {name}',
    'music.k.artist': 'Artist',
    'music.favTracks': 'Favourite tracks',
    'music.mostPlayed': 'Most played',
    'music.recentPlayed': 'Recently played',
    'music.recentAdded': 'Recently added',
    'music.newPlaylist': 'New playlist',
    'music.tracks': 'All tracks',
    'music.w.noTracks': 'No tracks yet',
  },
  ar: {
    'app.music': 'الموسيقى',
    'music.w.now': 'قيد التشغيل الآن',
    'music.w.recent': 'تم تشغيلها مؤخرًا',
    'music.notPlaying': 'لا يتم التشغيل',
    'music.tapToPlay': 'اضغط لفتح الموسيقى',
    'music.noRecent': 'لم يتم تشغيل شيء بعد',
    'music.unknownArtist': 'فنان غير معروف',
    'music.unknownAlbum': 'ألبوم غير معروف',
    'music.variousArtists': 'فنانون متنوعون',
    'music.addedFiles': 'الملفات المضافة',
    'music.play': 'تشغيل',
    'music.pause': 'إيقاف مؤقت',
    'music.next': 'التالي',
    'music.prev': 'السابق',
    'music.command': 'الموسيقى',
    'music.cmdPause': 'إيقاف الموسيقى مؤقتًا',
    'music.cmdResume': 'استئناف الموسيقى',
    'music.cmdNext': 'المقطع التالي',
    'music.cmdPrev': 'المقطع السابق',
    'music.cmdPlay': 'تشغيل "{name}"',
    'music.cmdPlaySearch': 'تشغيل "{q}" في الموسيقى',
    'music.k.track': 'مقطع',
    'music.k.album': 'ألبوم · {name}',
    'music.k.artist': 'فنان',
    'music.favTracks': 'المقاطع المفضلة',
    'music.mostPlayed': 'الأكثر تشغيلًا',
    'music.recentPlayed': 'تم تشغيلها مؤخرًا',
    'music.recentAdded': 'المضافة مؤخرًا',
    'music.newPlaylist': 'قائمة تشغيل جديدة',
    'music.tracks': 'كل المقاطع',
    'music.w.noTracks': 'لا توجد مقاطع بعد',
  },
});

