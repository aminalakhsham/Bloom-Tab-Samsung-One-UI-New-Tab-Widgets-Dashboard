// Samsung Music playback controls for the app's pages. They only write store key 'music'; the service worker
// (js/bg/music.js) makes the offscreen player follow. Outside the extension (a plain web page) the engine runs here.
import { store } from '../core/store.js';
import { isExt } from '../core/util.js';
import { t } from '../core/i18n.js';
import {
  MDEF, withDefaults, nowOf, goTo, nextPatch, prevPatch, queueFor, shufflePatch, nextRepeat, playNextPatch, appendPatch,
  removePatch, movePatch, prunePatch, livePos, clampDb,
} from './core.js';
import { lib, playlists, fav, SMART } from './library.js';

let engine = null;
async function local(m) {
  if (!engine) {
    const { MusicEngine } = await import('./engine.js');
    engine = new MusicEngine((r) => {
      if (r.type === 'pos') store.set('musicPos', { id: r.id, pos: r.pos, dur: r.dur, playing: r.playing, at: Date.now() });
      else if (r.type === 'played') store.update('musicStats', (s) => ({ ...(s || {}), [r.id]: [((s || {})[r.id]?.[0] || 0) + 1, Date.now()] }));
      else if (r.type === 'ended' || r.type === 'error') {
        const cur = music.get();
        if (cur.queue[cur.index] !== r.id) return;
        let p = nextPatch(cur, lookup, true);
        if (p?.end) p = { ...goTo(cur, 0, lookup, false), user: 0 };
        if (cur.sleepEnd === r.id) p = { ...p, playing: false, sleepEnd: null };
        music.set(p);
      }
    });
  }
  engine.apply(m, store.get('musicPos'));
}

/** Tell the service worker to bring the offscreen player in line (it also watches storage; this wakes it sooner). */
function ping() {
  if (!isExt) return local(music.get());
  setTimeout(() => chrome.runtime.sendMessage({ type: 'music-sync' }).catch(() => {}), 60);
}

const lookup = (id) => lib.get(id);

export const music = {
  get: () => withDefaults(store.get('music')),
  current() {
    const m = this.get();
    return m.queue[m.index] || null;
  },
  /** Playback position in seconds, moving on between reports. */
  pos() {
    const m = this.get(), p = store.get('musicPos');
    const id = m.queue[m.index];
    if (!id || !p || p.id !== id) return 0;
    const live = m.playing ? livePos(p, m.speed) : p.pos;
    return Math.max(0, Math.min(live, this.dur() || live));
  },
  dur() {
    const m = this.get(), p = store.get('musicPos');
    return (p?.id === m.queue[m.index] && p.dur) || m.now?.dur || 0;
  },
  set(patch) {
    const cur = this.get();
    const next = { ...cur, ...patch };
    delete next.end;
    if (patch.playing && !cur.playing) next.at = Date.now();
    // keep the shown position in step until the player reports back
    const id = next.queue[next.index];
    if (patch.seek || 'playing' in patch) {
      const p = store.get('musicPos');
      const pos = patch.seek ? patch.seek.pos : p?.id === id ? this.pos() : 0;
      store.set('musicPos', { id, pos, at: Date.now(), dur: (p?.id === id && p.dur) || next.now?.dur || 0, playing: !!next.playing });
    }
    store.set('music', next);
    ping();
  },
  /** Play `ids` from `start`; `from` = { kind: 'album'|'artist'|'playlist'|'smart'|'genre'|'folder'|'tracks'|…, id }. */
  playList(ids, start = 0, { shuffle = false, from = null } = {}) {
    if (!ids.length) return false;
    const q = queueFor(ids, start, shuffle);
    const m = this.get();
    this.set({ ...q, user: 0, from, sleepEnd: null, ...goTo({ ...m, ...q }, q.index, lookup, true, 0) });
    return true;
  },
  play() {
    const m = this.get();
    if (!m.queue.length) return false;
    this.set({ playing: true });
    return true;
  },
  pause() {
    if (this.get().playing) this.set({ playing: false });
  },
  toggle() {
    this.get().playing ? this.pause() : this.play();
  },
  next() {
    const m = this.get();
    let p = nextPatch(m, lookup);
    if (p?.end) p = { ...goTo(m, 0, lookup, false), user: 0 };
    if (p) this.set(p);
  },
  prev() {
    const p = prevPatch(this.get(), lookup, this.pos());
    if (p) this.set(p);
  },
  seek(sec) {
    const m = this.get(), id = m.queue[m.index];
    if (id) this.set({ seek: { n: (m.seek?.n || 0) + 1, id, pos: Math.max(0, sec), at: Date.now() } });
  },
  /** Jump to queue position `index` and play it. */
  jump(index) {
    const m = this.get();
    if (index < 0 || index >= m.queue.length) return;
    const user = index > m.index ? Math.max(0, m.user - (index - m.index)) : 0;
    this.set({ ...goTo(m, index, lookup, true), user });
  },
  playNext(ids) {
    const m = this.get();
    if (!m.queue.length) return this.playList(ids);
    this.set(playNextPatch(m, ids));
  },
  addToQueue(ids) {
    const m = this.get();
    if (!m.queue.length) return this.playList(ids);
    this.set(appendPatch(m, ids));
  },
  remove(index) {
    const p = removePatch(this.get(), index);
    if (p) this.set(p);
  },
  move(from, to) {
    const p = movePatch(this.get(), from, to);
    if (p) this.set(p);
  },
  setShuffle(on) {
    const m = this.get();
    if (m.shuffle !== on) this.set(shufflePatch(m, on));
  },
  cycleRepeat() {
    this.set({ repeat: nextRepeat(this.get().repeat) });
  },
  volume(v) {
    this.set({ volume: Math.max(0, Math.min(1, v)) });
  },
  setEq(id, custom) {
    this.set(custom ? { eq: 'custom', eqCustom: custom.map(clampDb) } : { eq: id });
  },
  setCrossfade(sec) {
    this.set({ crossfade: Math.max(0, Math.min(12, sec | 0)) });
  },
  setSpeed(rate) {
    this.set({ speed: Math.max(0.5, Math.min(2, +rate || 1)) });
  },
  /** Sleep timer: minutes, 'end' (stop after the current track) or 0 (off). */
  sleep(min) {
    this.set(min === 'end' ? { sleepEnd: this.current(), sleepAt: 0 } : { sleepAt: min ? Date.now() + min * 60000 : 0, sleepEnd: null });
  },
  /** After tracks were edited or deleted: drop missing ones from the queue and refresh the Now playing copy. */
  sync() {
    const m = this.get();
    if (!m.queue.length) return;
    const p = prunePatch(m, (id) => !!lib.get(id), lookup);
    if (p) return p.queue.length ? this.set(p) : store.set('music', { ...MDEF, volume: m.volume, eq: m.eq, eqCustom: m.eqCustom, repeat: m.repeat, crossfade: m.crossfade, speed: m.speed });
    const now = nowOf(lib.get(m.queue[m.index]));
    if (now && JSON.stringify(now) !== JSON.stringify(m.now)) store.set('music', { ...m, now });
  },
};

// a plain web page plays right here, following changes made in other tabs too
if (!isExt) store.on('music', (v) => local(withDefaults(v)));

/** Tracks of an album, artist, genre, folder, playlist or built-in playlist ('smart:fav'…), or every track. */
export function tracksOf(kind, id) {
  if (kind === 'playlist') return playlists.songs(playlists.get(id));
  if (kind === 'smart') return SMART[id]?.songs() || [];
  if (kind === 'fav') return fav.songs();
  if (kind === 'track') return [lib.get(id)].filter(Boolean);
  if (kind === 'album' || kind === 'artist' || kind === 'genre' || kind === 'folder') return lib.group(id)?.tracks || [];
  return lib.tracks();
}

/** Play an album, artist, genre, folder, playlist or everything; `start` = a track id to begin with. */
export async function playSource(kind, id, { shuffle = false, start = null } = {}) {
  await lib.ready();
  const list = tracksOf(kind, id);
  if (!list.length) return false;
  const i = start ? Math.max(0, list.findIndex((x) => x.id === start)) : shuffle ? -1 : 0;
  return music.playList(list.map((x) => x.id), i, { shuffle, from: { kind, id } });
}

/** "Playing from …" label for the full player. */
export function fromLabel(from) {
  if (!from) return '';
  if (from.kind === 'playlist') return playlists.get(from.id)?.name || '';
  if (from.kind === 'smart') return SMART[from.id] ? t(SMART[from.id].name) : '';
  const g = lib.group(from.id);
  return g?.title || g?.name || (from.kind === 'tracks' ? t('music.tracks') : '');
}
