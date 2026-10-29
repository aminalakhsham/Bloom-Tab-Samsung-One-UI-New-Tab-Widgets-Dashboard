// Voice Recorder data and pure logic, shared by the app, its engine and the plain-node test (no DOM, no storage).
// Store key `recorder` (this computer only; the audio is in IndexedDB through core/blobs.js):
// {
//   v: 1,
//   items: [{
//     id, title, at,               // created (ms)
//     mode: 'std' | 'interview' | 'stt',   // Standard, Interview, Speech-to-text
//     dur,                         // length of the original audio (s)
//     mime, size,                  // the recorded file ('audio/webm;codecs=opus'), bytes
//     cat?,                        // category id
//     deletedAt?,                  // in the Recycle bin since (ms); emptied after 30 days
//     rec?,                        // being recorded (or cut off by a closed tab: rebuilt from its chunks next time)
//     pk?, pk2?, pr?,              // waveform peaks (base64 bytes 0…255), the second person's channel (Interview),
//                                  // peaks per second
//     segs?,                       // after Trim/Delete: the parts of the original that are kept, [[from, to]…] (s)
//     marks?: [{ t, name? }],      // bookmarks, in original time (s)
//     text?: [{ t, s }],           // Speech-to-text: sentences and where they start (original time, s)
//     speed?, skip?,               // playback speed, Skip silence (kept per recording)
//   }],
//   cats: [{ id, name }],          // categories
// }
// Store key `recorderPrefs`: { sort, cat, quality, askName, bin, mode, sttLang }.
// Blob keys: `recorder:<id>` for the audio, `recorder:<id>:c000001`… for the chunks saved while recording.
export const KEY = 'recorder';
export const PREFS = 'recorderPrefs';
export const BIN_DAYS = 30;
export const MAX_MARKS = 50;
export const MODES = ['std', 'interview', 'stt'];
export const SORTS = ['new', 'old', 'az', 'za', 'long', 'short'];
export const QUALITY = { high: 192000, medium: 128000, low: 64000 };
const DAY = 86400000;

export const blobKey = (id) => `recorder:${id}`;
export const chunkKey = (id, n) => `recorder:${id}:c${String(n).padStart(6, '0')}`;
export const isChunkOf = (key, id) => String(key).startsWith(`recorder:${id}:c`);

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);

function item(m) {
  if (!m || typeof m !== 'object' || !str(m.id, 60)) return null;
  const x = { id: str(m.id, 60), title: str(m.title) || 'Voice', at: num(m.at) || Date.now(), mode: MODES.includes(m.mode) ? m.mode : 'std', dur: Math.max(0, num(m.dur)) };
  if (m.mime) x.mime = str(m.mime, 80);
  if (m.size) x.size = num(m.size);
  if (m.cat) x.cat = str(m.cat, 60);
  if (m.deletedAt) x.deletedAt = num(m.deletedAt);
  if (m.rec) x.rec = true;
  if (typeof m.pk === 'string' && m.pk) {
    x.pk = m.pk;
    x.pr = num(m.pr) || 20;
    if (typeof m.pk2 === 'string' && m.pk2) x.pk2 = m.pk2;
  }
  if (Array.isArray(m.segs)) {
    const s = m.segs.filter((r) => Array.isArray(r) && r.length === 2 && num(r[1]) > num(r[0])).map((r) => [num(r[0]), num(r[1])]);
    if (s.length) x.segs = s;
  }
  if (Array.isArray(m.marks)) {
    const k = m.marks.filter((b) => b && Number.isFinite(+b.t)).map((b) => (b.name ? { t: Math.max(0, +b.t), name: str(b.name, 80) } : { t: Math.max(0, +b.t) }));
    if (k.length) x.marks = k.sort((a, b) => a.t - b.t).slice(0, MAX_MARKS);
  }
  if (Array.isArray(m.text)) {
    const k = m.text.filter((p) => p && typeof p.s === 'string' && p.s.trim()).map((p) => ({ t: Math.max(0, num(p.t)), s: p.s.slice(0, 5000) }));
    if (k.length) x.text = k.slice(0, 5000);
  }
  if (num(m.speed) && +m.speed !== 1) x.speed = Math.min(2, Math.max(0.5, Math.round(+m.speed * 10) / 10));
  if (m.skip) x.skip = true;
  return x;
}

/** Tolerates missing, old or corrupt data: always the full shape, newest recording first. */
export function norm(v) {
  const d = { v: 1, items: [], cats: [] };
  if (!v || typeof v !== 'object') return d;
  const seen = new Set();
  d.items = (Array.isArray(v.items) ? v.items : []).map(item).filter((x) => x && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.at - a.at);
  d.cats = (Array.isArray(v.cats) ? v.cats : []).filter((c) => c && str(c.id, 60) && str(c.name)).map((c) => ({ id: str(c.id, 60), name: str(c.name, 60) }));
  const ids = new Set(d.cats.map((c) => c.id));
  for (const m of d.items) if (m.cat && !ids.has(m.cat)) delete m.cat;
  return d;
}

export function normPrefs(v) {
  const p = v && typeof v === 'object' ? v : {};
  return {
    sort: SORTS.includes(p.sort) ? p.sort : 'new',
    cat: typeof p.cat === 'string' ? p.cat : 'all', // 'all' | 'none' (Uncategorized) | a category id
    quality: p.quality in QUALITY ? p.quality : 'high',
    askName: p.askName !== false,
    bin: p.bin !== false,
    mode: MODES.includes(p.mode) ? p.mode : 'std',
    sttLang: typeof p.sttLang === 'string' ? p.sttLang : '',
  };
}

// ------------------------------------------------------------------ names
export const pad3 = (n) => String(n).padStart(3, '0');
/** Samsung's default names: "Voice 001", "Voice 002"… (`pattern` is the translated "Voice {n}"). Numbers aren't
 *  reused while a recording with that name is still around, Recycle bin included. */
export function nextTitle(items, pattern) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc(pattern).replace('\\{n\\}', '(\\d+)') + '$');
  let max = 0;
  for (const m of items) {
    const k = m.title.match(re);
    if (k) max = Math.max(max, +k[1]);
  }
  return pattern.replace('{n}', pad3(max + 1));
}

// ------------------------------------------------------------------ lists
/** cat: 'all' | 'none' | id. Recycle bin items never show in the list. */
export function inCat(m, cat) {
  if (m.deletedAt) return false;
  if (cat === 'all') return true;
  if (cat === 'none') return !m.cat;
  return m.cat === cat;
}
export function matches(m, q) {
  if (!q) return true;
  q = q.toLocaleLowerCase();
  const hay = [m.title, ...(m.text || []).map((p) => p.s), ...(m.marks || []).map((b) => b.name || '')];
  return hay.some((s) => s && s.toLocaleLowerCase().includes(q));
}
export function sortItems(items, sort) {
  const by = {
    new: (a, b) => b.at - a.at,
    old: (a, b) => a.at - b.at,
    az: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || b.at - a.at,
    za: (a, b) => b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: 'base' }) || b.at - a.at,
    long: (a, b) => editLen(b) - editLen(a) || b.at - a.at,
    short: (a, b) => editLen(a) - editLen(b) || b.at - a.at,
  }[sort] || ((a, b) => b.at - a.at);
  // a recording in progress stays on top, like Samsung's list
  return [...items].sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0) || by(a, b));
}

export const daysLeft = (m, now = Date.now()) => Math.max(0, Math.ceil((m.deletedAt + BIN_DAYS * DAY - now) / DAY));
/** Recordings that have been in the Recycle bin for 30 days. */
export const expired = (d, now = Date.now()) => d.items.filter((m) => m.deletedAt && now - m.deletedAt >= BIN_DAYS * DAY);

// ------------------------------------------------------------------ edits (Trim / Delete keep the original audio)
export const segsOf = (m) => (m.segs?.length ? m.segs : [[0, m.dur || 0]]);
export const lenOf = (segs) => segs.reduce((a, [s, e]) => a + (e - s), 0);
export const editLen = (m) => lenOf(segsOf(m));
/** Edited time → time in the original audio. */
export function toOrig(t, segs) {
  let acc = 0;
  for (const [s, e] of segs) {
    if (t <= acc + (e - s) + 1e-9) return s + Math.max(0, t - acc);
    acc += e - s;
  }
  return segs.length ? segs.at(-1)[1] : 0;
}
/** Time in the original audio → edited time (a time inside a removed part maps to where the next part starts). */
export function toEdit(o, segs) {
  let acc = 0;
  for (const [s, e] of segs) {
    if (o < s) return acc;
    if (o <= e) return acc + (o - s);
    acc += e - s;
  }
  return acc;
}
/** True when original time o is in a kept part. */
export const kept = (o, segs) => segs.some(([s, e]) => o >= s - 1e-6 && o <= e + 1e-6);
/** Keeps only edited time a…b (Trim). */
export function keepSegs(segs, a, b) {
  const out = [];
  let acc = 0;
  for (const [s, e] of segs) {
    const len = e - s, from = Math.max(a, acc), to = Math.min(b, acc + len);
    if (to - from > 1e-3) out.push([s + from - acc, s + to - acc]);
    acc += len;
  }
  return out;
}
/** Removes edited time a…b (Delete). */
export function cutSegs(segs, a, b) {
  const total = lenOf(segs);
  return [...keepSegs(segs, 0, a), ...keepSegs(segs, b, total)].reduce((o, r) => {
    const l = o.at(-1);
    if (l && Math.abs(l[1] - r[0]) < 1e-6) l[1] = r[1];
    else o.push([...r]);
    return o;
  }, []);
}
/** Stored form: no segs when the whole recording is kept. */
export const tidySegs = (segs, dur) =>
  segs.length === 1 && segs[0][0] <= 1e-3 && segs[0][1] >= dur - 1e-3 ? undefined : segs.map(([s, e]) => [+s.toFixed(3), +e.toFixed(3)]);

/** Bookmarks of the edited recording: [{ i (index in m.marks), t (edited time), name }], in time order. */
export function visibleMarks(m, segs = segsOf(m)) {
  return (m.marks || []).map((b, i) => ({ i, t: toEdit(b.t, segs), name: b.name || '', o: b.t })).filter((b) => kept(b.o, segs));
}
/** Speech-to-text sentences of the edited recording, with edited times. */
export function visibleText(m, segs = segsOf(m)) {
  return (m.text || []).filter((p) => kept(p.t, segs)).map((p) => ({ t: toEdit(p.t, segs), s: p.s }));
}

// ------------------------------------------------------------------ peaks
const B64 = globalThis.btoa, A64 = globalThis.atob;
export function encodePeaks(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return B64(s);
}
export function decodePeaks(b64) {
  try {
    const s = A64(b64 || '');
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  } catch {
    return new Uint8Array(0);
  }
}
/** The peaks of the edited recording, in edited order. */
export function editedPeaks(pk, pr, segs) {
  if (!segs) return pk;
  const parts = segs.map(([s, e]) => pk.subarray(Math.floor(s * pr), Math.ceil(e * pr)));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
/** Silent stretches (original time) long enough for Skip silence to jump over, with a little sound kept each side. */
export function silences(pk, pr, { minLen = 0.8, pad = 0.15 } = {}) {
  if (!pk?.length) return [];
  const sorted = [...pk].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], top = sorted[Math.floor(sorted.length * 0.95)];
  const thr = Math.min(Math.max(floor * 1.8 + 3, 10), top * 0.3 + 1);
  const out = [];
  let start = -1;
  for (let i = 0; i <= pk.length; i++) {
    const quiet = i < pk.length && pk[i] <= thr;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      const a = start / pr + pad, b = i / pr - pad;
      if ((i - start) / pr >= minLen && b > a) out.push([a, b]);
      start = -1;
    }
  }
  return out;
}
/** ranges minus holes (both sorted lists of [from, to]). */
export function subtract(ranges, holes) {
  const out = [];
  for (const [s, e] of ranges) {
    let a = s;
    for (const [hs, he] of holes) {
      if (he <= a || hs >= e) continue;
      if (hs > a) out.push([a, hs]);
      a = Math.max(a, he);
    }
    if (e - a > 1e-3) out.push([a, e]);
  }
  return out;
}

// ------------------------------------------------------------------ time text (numbers stay left to right)
const p2 = (n) => String(n).padStart(2, '0');
/** The big timer: 00:12.34, 1:02:03.45 (hundredths, like Samsung's recording screen). */
export function fmtClock(sec) {
  sec = Math.max(0, sec || 0);
  const cs = Math.floor(sec * 100) % 100, s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return `${h ? h + ':' : ''}${p2(m)}:${p2(s)}.${p2(cs)}`;
}
/** A length: 00:42, 12:05, 1:02:03. */
export function fmtLen(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}
export function fmtSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
export const fileName = (s) => (s || 'Recording').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'Recording';
export const extOf = (mime) => (/mp4|m4a|aac/.test(mime || '') ? 'm4a' : /ogg/.test(mime || '') ? 'ogg' : 'webm');
