// Samsung Music: player state rules shared by the pages, the service worker and the offscreen player.
// No DOM and no storage here, so the same file runs in all three places (and in plain node for the tests).
//
// store key 'music' — what should play (written by pages, and by the service worker when a track ends):
//   { queue: [trackId], index, user: tracks added with Play next after the current one,
//     playing, shuffle, repeat: 'off'|'all'|'one', volume 0..1, eq: preset id, eqCustom: [9 dB],
//     crossfade: seconds (0 = off), speed: playback rate,
//     seek: { n, id, pos, at } — bumped to jump inside a track, order: [trackId] queue before shuffling,
//     from: { kind, id } — what the queue was started from, now: snapshot of the current track for every surface,
//     at: last time playback started, sleepAt: stop time (ms), sleepEnd: stop when this track ends }
// store key 'musicPos' — what is actually playing (reported by the player): { id, pos, dur, playing, at }

export const MDEF = {
  queue: [], index: 0, user: 0, playing: false, shuffle: false, repeat: 'off', volume: 0.8, eq: 'normal', eqCustom: null,
  crossfade: 0, speed: 1, seek: null, order: null, from: null, now: null, at: 0, sleepAt: 0, sleepEnd: null,
};

export const withDefaults = (m) => ({ ...MDEF, ...(m || {}) });

/** The small copy of a track every surface shows (mini player, Quick Panel, Now Bar, widgets). */
export function nowOf(x) {
  return x ? { id: x.id, title: x.title, artist: x.artist || '', album: x.album || '', art: x.art || null, color: x.color || null, dur: x.dur || 0 } : null;
}

export function shuffled(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Patch that moves to queue position `index` (starting at `pos`, playing or not). */
export function goTo(m, index, lookup, playing = m.playing, pos = 0) {
  const id = m.queue[index];
  return { index, playing, now: nowOf(lookup(id)) || m.now, seek: { n: (m.seek?.n || 0) + 1, id, pos, at: Date.now() } };
}

/**
 * Next track. `auto` is true when a track finished on its own.
 * Returns a patch, or { end: true } when the queue is over and repeat is off.
 */
export function nextPatch(m, lookup, auto = false) {
  if (!m.queue.length) return null;
  const user = Math.max(0, (m.user || 0) - 1);
  if (m.index + 1 < m.queue.length) return { ...goTo(m, m.index + 1, lookup), user };
  if (m.repeat === 'all' || (m.repeat === 'one' && !auto)) return { ...goTo(m, 0, lookup), user: 0 };
  return { end: true };
}

/** Previous button: restart the track after 3 s (like Samsung Music), otherwise go to the previous one. */
export function prevPatch(m, lookup, pos) {
  if (!m.queue.length) return null;
  if (pos > 3 || (m.index === 0 && m.repeat !== 'all')) return goTo(m, m.index, lookup, m.playing, 0);
  const i = m.index === 0 ? m.queue.length - 1 : m.index - 1;
  return { ...goTo(m, i, lookup), user: 0 };
}

/** What follows the current track when it ends (for crossfading into it), or null. */
export function upNext(m) {
  if (!m?.queue?.length || m.repeat === 'one' || m.sleepEnd) return null;
  if (m.index + 1 < m.queue.length) return m.queue[m.index + 1];
  return m.repeat === 'all' ? m.queue[0] : null;
}

/** Queue for "play these tracks starting at i", optionally shuffled (the chosen track plays first). */
export function queueFor(ids, start = 0, shuffle = false, rnd = Math.random) {
  if (!shuffle) return { queue: ids.slice(), index: Math.max(0, Math.min(start, ids.length - 1)), order: null, shuffle: false };
  const first = start >= 0 && start < ids.length ? ids[start] : null;
  const rest = shuffled(ids.filter((_, i) => first === null || i !== start), rnd);
  return { queue: first !== null ? [first, ...rest] : rest, index: 0, order: ids.slice(), shuffle: true };
}

/** Shuffle on/off for the tracks after the current one (and after the ones added with Play next). */
export function shufflePatch(m, on, rnd = Math.random) {
  const keep = m.index + 1 + (m.user || 0);
  if (on) return { shuffle: true, order: m.queue.slice(), queue: [...m.queue.slice(0, keep), ...shuffled(m.queue.slice(keep), rnd)] };
  const cur = m.queue[m.index];
  const order = m.order || m.queue;
  const at = order.indexOf(cur);
  if (at < 0) return { shuffle: false, order: null };
  const head = m.queue.slice(0, keep);
  const tail = order.slice(at + 1).filter((id) => !head.includes(id));
  return { shuffle: false, order: null, queue: [...head, ...tail] };
}

export const nextRepeat = (r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off');

/** Play next: right after the current track (after earlier Play next tracks). */
export function playNextPatch(m, ids) {
  const q = m.queue.slice();
  q.splice(m.index + 1 + (m.user || 0), 0, ...ids);
  return { queue: q, user: (m.user || 0) + ids.length, order: m.order ? [...m.order, ...ids] : null };
}

/** Add to the end of the queue. */
export function appendPatch(m, ids) {
  return { queue: [...m.queue, ...ids], order: m.order ? [...m.order, ...ids] : null };
}

/** Remove queue position i (never the current track). */
export function removePatch(m, i) {
  if (i < 0 || i >= m.queue.length || i === m.index) return null;
  const q = m.queue.slice();
  q.splice(i, 1);
  const inUser = i > m.index && i <= m.index + (m.user || 0);
  return { queue: q, index: i < m.index ? m.index - 1 : m.index, user: inUser ? Math.max(0, m.user - 1) : m.user || 0 };
}

/** Move queue position `from` to `to`; the current track keeps playing wherever it lands. */
export function movePatch(m, from, to) {
  const n = m.queue.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
  const q = m.queue.slice();
  const [x] = q.splice(from, 1);
  q.splice(to, 0, x);
  let index = m.index;
  if (from === m.index) index = to;
  else if (from < m.index && to >= m.index) index--;
  else if (from > m.index && to <= m.index) index++;
  // a hand-ordered queue no longer has a "Play next" block to protect
  return { queue: q, index, user: 0 };
}

/** Patch after tracks were deleted from the library (keeps playing position when the current one stays). */
export function prunePatch(m, alive, lookup) {
  const keepBefore = m.queue.slice(0, m.index).filter(alive).length;
  const q = m.queue.filter(alive);
  if (q.length === m.queue.length) return null;
  if (!q.length) return { queue: [], index: 0, user: 0, order: null, playing: false, now: null, seek: null, from: null };
  const curAlive = alive(m.queue[m.index]);
  const index = Math.min(keepBefore, q.length - 1);
  const base = { queue: q, index, user: 0, order: m.order ? m.order.filter(alive) : null };
  return curAlive ? { ...base, now: nowOf(lookup(q[index])) || m.now } : { ...base, ...goTo({ ...m, queue: q }, index, lookup, false) };
}

/** Live playback position from the last report. */
export const livePos = (p, speed = 1) => (p ? (p.playing ? p.pos + ((Date.now() - p.at) / 1000) * speed : p.pos) : 0);

// ——— equaliser (One UI "Equaliser": 9 bands, ±10 dB) ———
export const EQ_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  normal: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 0, 2, 4, 4, 2, 0, -1, -1],
  classic: [4, 3, 2, -1, -1, 0, 2, 3, 4],
  jazz: [3, 2, 1, 2, -1, -1, 0, 2, 3],
  rock: [5, 3, 1, -1, -1, 1, 3, 4, 5],
  dance: [6, 5, 2, 0, 2, 3, 4, 3, 0],
  bass: [6, 5, 4, 2, 1, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 3, 4, 6],
  vocal: [-2, -3, -2, 1, 4, 4, 3, 1, 0],
};
export const EQ_IDS = ['normal', 'pop', 'classic', 'jazz', 'rock', 'dance', 'bass', 'treble', 'vocal', 'custom'];

/** Band gains for the stored state (Custom uses the user's sliders). */
export function eqGains(m) {
  if (m?.eq === 'custom') return EQ_BANDS.map((_, i) => clampDb(m.eqCustom?.[i] ?? 0));
  return EQ_PRESETS[m?.eq] || EQ_PRESETS.normal;
}
export const clampDb = (v) => Math.max(-10, Math.min(10, Math.round(+v || 0)));

// ——— sleep timer ———
/** Minutes left on the sleep timer (rounded up), or 0. */
export const sleepLeft = (m, now = Date.now()) => (m?.sleepAt > now ? Math.ceil((m.sleepAt - now) / 60000) : 0);

// ——— lyrics ———
/** "[01:02.50]words" lines → [{ t, text }] sorted by time, or null when the text has no time stamps. */
export function parseLyrics(text) {
  if (!text) return null;
  let offset = 0;
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw);
    if (off) {
      offset = +off[1] / 1000;
      continue;
    }
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push({ t: +s[1] * 60 + parseFloat(s[2].replace(':', '.')), text: words });
  }
  if (lines.length < 2) return null;
  lines.forEach((l) => (l.t = Math.max(0, l.t - offset)));
  return lines.sort((a, b) => a.t - b.t);
}

/** Lyrics without LRC headers and time stamps. */
export const plainLyrics = (text) =>
  String(text || '').replace(/^\[(ar|ti|al|by|offset|length|re|ve):[^\]]*\]\s*$/gim, '').replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();

/** Index of the synced line at time `t`, or -1. */
export function lineAt(lines, t) {
  let lo = 0, hi = (lines?.length || 0) - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + 0.15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// ——— formatting ———
/** 3:07 / 1:02:03 */
export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

/** Sort key that ignores a leading "The" and case, like Samsung Music's A–Z. */
export const sortKey = (s) => String(s || '').replace(/^the\s+/i, '').toLowerCase();
export const cmp = (a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true, sensitivity: 'base' });

/** How well `q` matches `s`: 3 = whole, 2 = starts with, 1 = a word starts with, 0.5 = contains, 0 = no. */
export function matchScore(s, q) {
  s = String(s || '').toLowerCase();
  if (!q || !s) return 0;
  if (s === q) return 3;
  if (s.startsWith(q)) return 2;
  if (s.includes(' ' + q) || s.includes('-' + q) || s.includes('(' + q)) return 1;
  return s.includes(q) ? 0.5 : 0;
}
