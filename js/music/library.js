// Samsung Music library on the page side: importing files, albums/artists/genres/folders, playlists, favourites,
// play counts, cover art and lyrics. Tracks and files live in IndexedDB (js/music/db.js); small lists live in
// store key 'musicLib' ({ playlists: [{ id, name, tracks, created, at }], fav: [ids], searches: [text] }) and play
// counts in 'musicStats' ({ id: [count, lastPlayedAt] }, written by the service worker). 'musicRev' changes whenever
// the library changes so other tabs reload it.
import { store, session } from '../core/store.js';
import { uid, rgbToHex, escapeHtml } from '../core/util.js';
import { blobUrl } from '../core/blobs.js';
import { t } from '../core/i18n.js';
import { mdb, artKey } from './db.js';
import { cmp, matchScore } from './core.js';

let tracks = null, byId = new Map(), loading = null, derived = null;
const listeners = new Set();

async function load() {
  const list = await mdb.tracks().catch((e) => {
    console.warn('music db', e);
    return [];
  });
  tracks = list.sort((a, b) => b.addedAt - a.addedAt);
  byId = new Map(tracks.map((x) => [x.id, x]));
  derived = null;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

// another tab changed the library
let ownRev = 0;
store.on('musicRev', (v) => {
  if (tracks && v !== ownRev) loading = load();
});
async function save() {
  await mdb.saveTracks(tracks);
  await load();
  ownRev = Date.now();
  store.set('musicRev', ownRev);
}

const IMPORT_FLAG = 'musicImporting';
/** Clean up files left by an import that was cut short (only when no tab is importing right now). */
async function collectOnce() {
  const busy = await session.get(IMPORT_FLAG).catch(() => 0);
  if (busy && Date.now() - busy < 10 * 60e3) return;
  await mdb.collect(tracks);
}

export const unknownArtist = () => t('music.unknownArtist');
export const artistOf = (x) => x?.artist || unknownArtist();

function derive() {
  if (derived) return derived;
  const albums = new Map(), artists = new Map(), genres = new Map(), folders = new Map();
  for (const x of tracks) {
    // tracks belong together when they share the album name and the album artist (or the folder)
    const key = (x.album || '').toLowerCase() + '|' + (x.albumArtist || (x.album && x.dir ? 'dir:' + x.dir : x.artist || '')).toLowerCase();
    let al = albums.get(key);
    if (!al) albums.set(key, (al = { id: 'al' + hash(key), title: x.album || t('music.unknownAlbum'), artist: '', year: 0, art: null, color: null, tracks: [], addedAt: 0, dur: 0, names: new Set() }));
    al.tracks.push(x);
    al.names.add(x.artist || '');
    al.year ||= x.year || 0;
    if (!al.art && x.art) {
      al.art = x.art;
      al.color = x.color;
    }
    al.addedAt = Math.max(al.addedAt, x.addedAt);
    al.dur += x.dur || 0;
    if (x.albumArtist) al.artist = x.albumArtist;
    x._album = al.id;

    const an = artistOf(x);
    let ar = artists.get(an.toLowerCase());
    if (!ar) artists.set(an.toLowerCase(), (ar = { id: 'ar' + hash(an.toLowerCase()), name: an, tracks: [], albums: new Set(), art: null, color: null }));
    ar.tracks.push(x);
    if (!ar.art && x.art) {
      ar.art = x.art;
      ar.color = x.color;
    }

    if (x.genre) {
      const gk = x.genre.toLowerCase();
      let g = genres.get(gk);
      if (!g) genres.set(gk, (g = { id: 'g' + hash(gk), name: x.genre, tracks: [], arts: [] }));
      g.tracks.push(x);
      if (x.art && g.arts.length < 4 && !g.arts.includes(x.art)) g.arts.push(x.art);
    }

    const fk = x.dir || '';
    let f = folders.get(fk);
    if (!f) folders.set(fk, (f = { id: 'f' + hash(fk), path: fk, name: fk ? fk.split('/').pop() : t('music.addedFiles'), tracks: [] }));
    f.tracks.push(x);
  }
  for (const al of albums.values()) {
    al.artist ||= al.names.size > 1 ? t('music.variousArtists') : [...al.names][0] || unknownArtist();
    delete al.names;
    al.tracks.sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 999) - (b.track || 999) || cmp(a.title, b.title));
  }
  const albumById = new Map([...albums.values()].map((a) => [a.id, a]));
  for (const ar of artists.values()) {
    for (const x of ar.tracks) ar.albums.add(x._album);
    ar.albums = [...ar.albums].map((id) => albumById.get(id)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0) || cmp(a.title, b.title));
    ar.tracks.sort((a, b) => cmp(a.album, b.album) || (a.track || 999) - (b.track || 999) || cmp(a.title, b.title));
  }
  for (const g of genres.values()) g.tracks.sort((a, b) => cmp(a.title, b.title));
  for (const f of folders.values()) f.tracks.sort((a, b) => (a.track || 999) - (b.track || 999) || cmp(a.name || a.title, b.name || b.title));
  derived = {
    albums: [...albums.values()],
    artists: [...artists.values()].sort((a, b) => cmp(a.name, b.name)),
    genres: [...genres.values()].sort((a, b) => cmp(a.name, b.name)),
    folders: [...folders.values()].sort((a, b) => cmp(a.path, b.path)),
  };
  derived.byId = new Map([...derived.albums, ...derived.artists, ...derived.genres, ...derived.folders].map((x) => [x.id, x]));
  return derived;
}

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export const lib = {
  ready() {
    if (!loading) loading = load().then(() => collectOnce().catch(() => {}));
    return loading;
  },
  loaded: () => !!tracks,
  tracks: () => tracks || [],
  get: (id) => byId.get(id),
  albums: () => (tracks ? derive().albums : []),
  artists: () => (tracks ? derive().artists : []),
  genres: () => (tracks ? derive().genres : []),
  folders: () => (tracks ? derive().folders : []),
  /** An album, artist, genre or folder by id. */
  group: (id) => (tracks ? derive().byId.get(id) || null : null),
  albumOf: (x) => (tracks && x ? derive() && derive().byId.get(x._album) : null),
  artistOfTrack: (x) => (tracks && x ? derive().artists.find((a) => a.name.toLowerCase() === artistOf(x).toLowerCase()) : null),
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  size: () => (tracks || []).reduce((a, x) => a + (x.size || 0), 0),
};

// ——— playlists, favourites, stats ———
const ML = () => ({ playlists: [], fav: [], searches: [], ...(store.get('musicLib') || {}) });
const setML = (patch) => store.set('musicLib', { ...ML(), ...patch });

export const playlists = {
  all: () => ML().playlists,
  get: (id) => ML().playlists.find((p) => p.id === id),
  create(name, ids = []) {
    const p = { id: 'pl' + uid(), name: name || t('music.newPlaylist'), tracks: [...ids], created: Date.now(), at: Date.now() };
    setML({ playlists: [p, ...ML().playlists] });
    return p;
  },
  update(id, patch) {
    setML({ playlists: ML().playlists.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) });
  },
  remove(id) {
    setML({ playlists: ML().playlists.filter((p) => p.id !== id) });
  },
  /** Adds the tracks that aren't in the playlist yet; returns how many were added. */
  add(id, ids) {
    const p = this.get(id);
    if (!p) return 0;
    const fresh = ids.filter((x) => !p.tracks.includes(x));
    if (fresh.length) this.update(id, { tracks: [...p.tracks, ...fresh] });
    return fresh.length;
  },
  removeTracks(id, ids) {
    const p = this.get(id);
    if (p) this.update(id, { tracks: p.tracks.filter((x) => !ids.includes(x)) });
  },
  move(id, from, to) {
    const p = this.get(id);
    if (!p) return;
    const l = p.tracks.slice();
    const [x] = l.splice(from, 1);
    l.splice(to, 0, x);
    this.update(id, { tracks: l });
  },
  /** Tracks that still exist, in playlist order. */
  songs: (p) => (p?.tracks || []).map((id) => byId.get(id)).filter(Boolean),
};

export const fav = {
  ids: () => ML().fav,
  has: (id) => ML().fav.includes(id),
  toggle(id) {
    const l = ML().fav;
    const on = !l.includes(id);
    setML({ fav: on ? [id, ...l] : l.filter((x) => x !== id) });
    return on;
  },
  add(ids) {
    const l = ML().fav;
    setML({ fav: [...ids.filter((x) => !l.includes(x)), ...l] });
  },
  songs: () => ML().fav.map((id) => byId.get(id)).filter(Boolean),
};

export function noteSearch(q) {
  q = q.trim();
  if (!q) return;
  setML({ searches: [q, ...ML().searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8) });
}
export const recentSearches = () => ML().searches;
export const clearSearches = () => setML({ searches: [] });

const stats = () => store.get('musicStats') || {};
export const plays = (id) => stats()[id]?.[0] || 0;
export const mostPlayed = (n = 100) => {
  const s = stats();
  return lib.tracks().filter((x) => s[x.id]?.[0]).sort((a, b) => s[b.id][0] - s[a.id][0] || s[b.id][1] - s[a.id][1]).slice(0, n);
};
export const recentlyPlayed = (n = 100) => {
  const s = stats();
  return lib.tracks().filter((x) => s[x.id]?.[1]).sort((a, b) => s[b.id][1] - s[a.id][1]).slice(0, n);
};
export const recentlyAdded = (n = 100) => lib.tracks().slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, n);

/** Built-in playlists (Samsung Music's Favourite tracks, Most played, Recently played, Recently added). */
export const SMART = {
  fav: { name: 'music.favTracks', icon: 'heartFill', color: '#f2556b', songs: () => fav.songs() },
  most: { name: 'music.mostPlayed', icon: 'chart', color: '#7a5cf5', songs: () => mostPlayed() },
  played: { name: 'music.recentPlayed', icon: 'history', color: '#2b9bf0', songs: () => recentlyPlayed() },
  added: { name: 'music.recentAdded', icon: 'plusCircle', color: '#22b07d', songs: () => recentlyAdded() },
};

/** Library search: tracks, albums and artists, best matches first. */
export function searchLibrary(q, max = 30) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return { tracks: [], albums: [], artists: [] };
  const rank = (list, fn) => list.map((x) => [fn(x), x]).filter((a) => a[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, max).map((a) => a[1]);
  return {
    tracks: rank(lib.tracks(), (x) => Math.max(matchScore(x.title, q) * 1.2, matchScore(x.artist, q), matchScore(x.album, q) * 0.8)),
    albums: rank(lib.albums(), (a) => Math.max(matchScore(a.title, q), matchScore(a.artist, q) * 0.7)),
    artists: rank(lib.artists(), (a) => matchScore(a.name, q)),
  };
}

// ——— cover art ———
const urls = new Map();
export const cachedArt = (id) => urls.get(id) || null;
export function artUrl(id) {
  if (!id) return Promise.resolve(null);
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  return blobUrl(artKey(id)).then((u) => {
    urls.set(id, u);
    return u;
  }, () => null);
}

const NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="17.5" cy="16" r="2.5" fill="currentColor"/></svg>';
/** Cover image (filled in when it scrolls into view) or the grey note placeholder. */
export function artHTML(art, cls = '') {
  if (!art) return `<span class="mu-art mu-ph ${cls}">${NOTE}</span>`;
  const u = cachedArt(art);
  return `<img class="mu-art ${cls}" alt="" draggable="false" data-art="${escapeHtml(art)}"${u ? ` src="${u}"` : ''}>`;
}

let io = null;
/** Load the cover images inside `root` as they scroll into view. */
export function hydrateArt(root) {
  io ??= typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      io.unobserve(e.target);
      fill(e.target);
    }
  }, { rootMargin: '300px' }) : null;
  for (const img of root.querySelectorAll('img[data-art]:not([src])')) io ? io.observe(img) : fill(img);
}
function fill(img) {
  artUrl(img.dataset.art).then((u) => {
    if (u) img.src = u;
    else img.replaceWith(Object.assign(document.createElement('span'), { className: img.className.replace('mu-art', 'mu-art mu-ph'), innerHTML: NOTE }));
  });
}

/** The colour that stands out in a cover (tints the full player and the Quick Panel card). */
async function colorOf(bmp) {
  const c = new OffscreenCanvas(24, 24);
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, 24, 24);
  const d = cx.getImageData(0, 0, 24, 24).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(k, e);
  }
  let best = null;
  for (const e of buckets.values()) {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const score = e.n * (0.3 + sat) * (mx < 30 || mn > 230 ? 0.35 : 1);
    if (!best || score > best.score) best = { r, g, b, score };
  }
  return best ? rgbToHex(best.r, best.g, best.b) : null;
}

/** Store a downscaled copy of a cover (same bytes → same id, so an album keeps one copy). */
async function saveArt(blob, seen) {
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  let h = 2166136261 >>> 0;
  for (let i = 0; i < head.length; i += 7) {
    h ^= head[i];
    h = Math.imul(h, 16777619);
  }
  const id = (h >>> 0).toString(36) + blob.size.toString(36);
  if (seen.has(id)) return seen.get(id);
  const job = (async () => {
    try {
      const bmp = await createImageBitmap(blob);
      const color = await colorOf(bmp);
      if (!(await mdb.hasArt(id))) {
        const s = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
        const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        await mdb.putArt(id, await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 }));
      }
      bmp.close?.();
      return { id, color };
    } catch {
      return null;
    }
  })();
  seen.set(id, job);
  return job;
}

// ——— importing ———
export const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|mp4|flac|ogg|oga|opus|wav|wave|webm|weba)$/i;
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', wav: 'audio/wav', wave: 'audio/wav', webm: 'audio/webm', weba: 'audio/webm' };

function probeDuration(file) {
  return new Promise((res) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => {
      clearTimeout(to);
      a.removeAttribute('src');
      a.load();
      URL.revokeObjectURL(url);
      res(v);
    };
    const to = setTimeout(() => done(null), 15000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(null);
    a.src = url;
  });
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase();
const sig = (x) => [x.title, x.artist, x.album, Math.round(x.dur || 0)].join('|').toLowerCase();

let importing = null;
export const importState = () => importing;

/**
 * Add tracks. `items` = [{ file, path }]. Lyrics (.lrc) and cover pictures (cover.jpg, folder.png…) next to the
 * tracks are picked up too. onProgress({ done, total, added, skipped, failed }) after each file.
 */
export async function importFiles(items, onProgress) {
  await lib.ready();
  const { readTags, guessFromPath } = await import('./tags.js');
  const audio = items.filter((i) => AUDIO_EXT.test(i.file.name) || /^audio\//.test(i.file.type));
  const lrc = new Map(items.filter((i) => /\.lrc$/i.test(i.file.name)).map((i) => [dirOf(i.path) + '/' + baseOf(i.path), i.file]));
  const covers = new Map();
  for (const i of items) if (/^(cover|folder|front|album|artwork)\.(jpe?g|png|webp)$/i.test(i.file.name)) covers.set(dirOf(i.path), i.file);
  const known = new Set(lib.tracks().map(sig));
  const st = (importing = { done: 0, total: audio.length, added: 0, skipped: 0, failed: 0 });
  const seenArt = new Map(), fresh = [];
  const probe = document.createElement('audio');
  const now = Date.now();
  let next = 0, lastFlush = Date.now();
  const flag = () => session.set(IMPORT_FLAG, Date.now()).catch(() => {});
  flag();
  const flush = async () => {
    if (!fresh.length) return;
    const add = fresh.splice(0);
    tracks = [...add, ...lib.tracks().filter((x) => !add.some((y) => y.id === x.id))];
    await save();
    flag();
  };
  const work = async () => {
    while (next < audio.length) {
      const k = next++;
      const { file, path } = audio[k];
      try {
        const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
        const type = file.type || MIME[ext] || '';
        if (type && !probe.canPlayType(type) && !probe.canPlayType(MIME[ext] || '')) {
          st.failed++;
          continue;
        }
        const [tags, dur] = await Promise.all([readTags(file), probeDuration(file)]);
        if (dur === null) {
          st.failed++;
          continue;
        }
        const guess = guessFromPath(path || file.name);
        const x = {
          id: 't' + uid(),
          title: tags.title || guess.title || file.name,
          artist: tags.artist || guess.artist || '',
          album: tags.album || (tags.title ? '' : guess.album) || '',
          albumArtist: tags.albumArtist || '',
          genre: tags.genre || '',
          year: tags.year || 0,
          track: tags.track || guess.track || 0,
          disc: tags.disc || 0,
          dur,
          size: file.size,
          type,
          name: file.name,
          dir: dirOf(path || ''),
          art: null,
          color: null,
          lrc: false,
          addedAt: now - k, // keeps the chosen order inside one import
        };
        if (known.has(sig(x))) {
          st.skipped++;
          continue;
        }
        known.add(sig(x));
        const side = lrc.get(x.dir + '/' + baseOf(path || file.name));
        const words = tags.lyrics || (side ? await side.text().catch(() => null) : null);
        const pic = tags.picture ? new Blob([tags.picture.data], { type: tags.picture.mime }) : covers.get(x.dir);
        if (pic) {
          const a = await saveArt(pic, seenArt);
          if (a) {
            x.art = a.id;
            x.color = a.color;
          }
        }
        await mdb.putAudio(x.id, file);
        if (words?.trim()) {
          await mdb.putLyrics(x.id, words.trim());
          x.lrc = true;
        }
        fresh.push(x);
        st.added++;
        if (fresh.length >= 25 || Date.now() - lastFlush > 4000) {
          lastFlush = Date.now();
          await flush();
        }
      } catch (e) {
        console.warn('import', file.name, e);
        st.failed++;
      } finally {
        st.done++;
        onProgress?.(st);
      }
    }
  };
  try {
    await Promise.all([work(), work(), work()]);
    await flush();
  } finally {
    importing = null;
    session.set(IMPORT_FLAG, 0).catch(() => {});
  }
  return st;
}

/** Change track details (title, artist, album…); `art` may be a Blob for a new cover. */
export async function editTracks(ids, patch) {
  const art = patch.art instanceof Blob ? await saveArt(patch.art, new Map()) : null;
  const set = new Set(ids);
  tracks = lib.tracks().map((x) => {
    if (!set.has(x.id)) return x;
    const y = { ...x, ...patch };
    if (patch.art instanceof Blob) {
      y.art = art?.id || x.art;
      y.color = art?.color || x.color;
    }
    return y;
  });
  await save();
  await collectOnce().catch(() => {});
}

export const getLyrics = (id) => mdb.getLyrics(id);
export async function setLyrics(id, text) {
  text = String(text || '').trim();
  await mdb.putLyrics(id, text || null);
  tracks = lib.tracks().map((x) => (x.id === id ? { ...x, lrc: !!text } : x));
  await save();
}

export async function deleteTracks(ids) {
  const set = new Set(ids);
  await mdb.deleteTracks(ids);
  tracks = lib.tracks().filter((x) => !set.has(x.id));
  const m = ML();
  setML({ fav: m.fav.filter((id) => !set.has(id)), playlists: m.playlists.map((p) => ({ ...p, tracks: p.tracks.filter((id) => !set.has(id)) })) });
  store.update('musicStats', (s) => {
    s ||= {};
    for (const id of ids) delete s[id];
    return s;
  });
  await save();
  await collectOnce().catch(() => {});
}

export async function deleteAll() {
  await mdb.clear();
  tracks = [];
  setML({ fav: [], playlists: ML().playlists.map((p) => ({ ...p, tracks: [] })) });
  store.set('musicStats', {});
  await save();
}

// ——— picking files ———
/** Collect files from a drop, including whole folders. */
export async function filesFromDrop(dt) {
  const out = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  const walk = async (e, path) => {
    if (e.isFile) {
      const file = await new Promise((r) => e.file(r, () => r(null)));
      if (file) out.push({ file, path: path + file.name });
    } else if (e.isDirectory) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise((r) => reader.readEntries(r, () => r([])));
        if (!batch.length) break;
        for (const c of batch) await walk(c, path + e.name + '/');
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Samsung Music's "Add music": pick files, or a whole folder (`<input type=file webkitdirectory>`). */
export function pickMusic(folder = false) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.multiple = true;
    if (folder) i.webkitdirectory = true;
    else i.accept = 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.lrc';
    i.addEventListener('change', () => res([...i.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))));
    i.addEventListener('cancel', () => res([]));
    i.click();
  });
}
