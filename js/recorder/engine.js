// Voice Recorder engine: the microphone goes to a MediaRecorder (Opus in WebM) with a one-second timeslice, and each
// chunk is saved to IndexedDB as it arrives, so a tab that's closed keeps what was recorded (it's put back together the
// next time the app opens). The recorder lives at module level, so a recording goes on while the app window is closed;
// js/recorder/live.js tells the Now Bar, the Quick Panel and the widgets about it.
// Modes: Standard; Interview (two channels kept apart, one per person, when the microphone gives stereo); Speech-to-text
// (Chrome's on-device speech recognition listens to the same microphone track; nothing is sent to a server).
import { getBlob, putBlob, delBlob, listBlobs } from '../core/blobs.js';
import { t } from '../core/i18n.js';
import { uid } from '../core/util.js';
import * as M from './model.js';
import { D, mut, prefs, destroy } from './data.js';
import { setLive } from './live.js';
import { analyse, audioCtx } from './audio.js';

export const LEVEL_RATE = 20; // live waveform samples per second (the same rate as the stored peaks)
const BEAT = (id) => 'recorder.beat.' + id; // localStorage heartbeat: another tab doesn't "recover" a live recording
const PATTERN = { std: 'recorder.name.std', interview: 'recorder.name.interview', stt: 'recorder.name.stt' };
let cur = null;
const subs = new Set();

/** Engine state for the app's screens: { id, title, mode, paused, levels, levels2, marks, text, interim, stereo }. */
export const active = () => cur;
export const onChange = (fn) => (subs.add(fn), () => subs.delete(fn));
/** Seconds recorded so far (pauses left out). */
export const elapsed = () => (cur ? (cur.acc + (cur.paused ? 0 : Date.now() - cur.t0)) / 1000 : 0);
const keepPage = (e) => {
  e.preventDefault();
  e.returnValue = '';
};

function changed() {
  subs.forEach((fn) => {
    try {
      fn(cur);
    } catch (e) {
      console.error(e);
    }
  });
  setLive(cur ? { id: cur.id, title: cur.title, mode: cur.mode, paused: cur.paused, elapsed, stop: () => stop(), toggle: () => (cur?.paused ? resume() : pause()), mark } : null);
}

export const SR = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
/** On-device speech recognition for `lang`: 'available' | 'downloadable' | 'downloading' | 'unavailable'. Only
 *  on-device recognition counts: Chrome's server recognition would send the voice to Google. */
export async function sttAvailability(lang) {
  const R = SR();
  if (!R || typeof R.available !== 'function') return 'unavailable';
  try {
    return await R.available({ langs: [lang], processLocally: true });
  } catch {
    return 'unavailable';
  }
}
/** Downloads Chrome's on-device speech model for `lang` (call from a click). */
export async function sttInstall(lang) {
  const R = SR();
  try {
    return !!(await R?.install?.({ langs: [lang], processLocally: true }));
  } catch {
    return false;
  }
}

/** Starts recording into a new recording and returns its id. Throws getUserMedia's error (NotAllowedError…). */
export async function start({ mode = 'std', lang = 'en-US' } = {}) {
  if (cur) return cur.id;
  if (!M.MODES.includes(mode)) mode = 'std';
  // Interview keeps the two channels apart (echo cancellation would mix them down to mono)
  const audio = mode === 'interview'
    ? { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: false, noiseSuppression: mode === 'stt', autoGainControl: true };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  let mr;
  try {
    mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: M.QUALITY[prefs().quality] } : {});
  } catch (e) {
    stream.getTracks().forEach((x) => x.stop());
    throw e;
  }
  const id = uid();
  const title = M.nextTitle(D().items, t(PATTERN[mode]));
  // a recording made while the list shows a category goes into that category
  const cat = prefs().cat;
  mut((d) => {
    d.items.unshift({ id, title, at: Date.now(), dur: 0, rec: true, mode, mime: mr.mimeType || mime || 'audio/webm', ...(d.cats.some((c) => c.id === cat) ? { cat } : {}) });
  });
  const track = stream.getAudioTracks()[0];
  const stereo = mode === 'interview' && (track?.getSettings?.().channelCount || 1) > 1;
  const st = (cur = { id, title, mode, mr, stream, t0: Date.now(), acc: 0, paused: false, levels: [], levels2: [], marks: [], text: [], interim: '', stereo, seq: 0, writes: Promise.resolve(), timers: [] });
  mr.ondataavailable = (e) => {
    if (!e.data?.size) return;
    const n = st.seq++;
    st.writes = st.writes.then(() => putBlob(M.chunkKey(id, n), e.data)).catch((err) => console.warn('recorder chunk', err));
  };
  // the live waveform: the loudest sample of each 50 ms (in a background tab the timer slows, so gaps are filled)
  try {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    st.src = ctx.createMediaStreamSource(stream);
    const an = () => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      return a;
    };
    st.an = an();
    st.buf = new Float32Array(st.an.fftSize);
    if (stereo) {
      st.split = ctx.createChannelSplitter(2);
      st.an2 = an();
      st.src.connect(st.split);
      st.split.connect(st.an, 0);
      st.split.connect(st.an2, 1);
    } else st.src.connect(st.an);
  } catch (e) {
    console.warn('recorder levels', e);
  }
  const peak = (a) => {
    if (!a) return 0;
    a.getFloatTimeDomainData(st.buf);
    let v = 0;
    for (const x of st.buf) {
      const y = x < 0 ? -x : x;
      if (y > v) v = y;
    }
    return Math.min(255, Math.round(v * 255));
  };
  const sample = () => {
    if (cur !== st || st.paused) return;
    const want = Math.floor(elapsed() * LEVEL_RATE), u = peak(st.an), u2 = mode === 'interview' ? (st.an2 ? peak(st.an2) : u) : 0;
    while (st.levels.length < want) {
      st.levels.push(u);
      if (mode === 'interview') st.levels2.push(u2);
    }
  };
  st.timers.push(setInterval(sample, 50));
  const beat = () => {
    try {
      localStorage.setItem(BEAT(id), String(Date.now()));
    } catch {}
  };
  beat();
  st.timers.push(setInterval(beat, 2000));
  track?.addEventListener('ended', () => stop());
  addEventListener('beforeunload', keepPage);
  mr.start(1000);
  if (mode === 'stt') listen(st, lang);
  changed();
  return id;
}

// ------------------------------------------------------------------ Speech-to-text (on-device only)
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture', 'network', 'bad-grammar']);
function listen(st, lang) {
  const R = SR();
  if (!R || cur !== st || st.paused || st.sttFatal) return;
  const r = new R();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  r.processLocally = true;
  let segT = null;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], txt = res[0]?.transcript || '';
      // a sentence starts a little before its first words reach us
      if (segT == null) segT = Math.max(0, elapsed() - 1);
      if (res.isFinal) {
        const s = txt.trim();
        if (s) st.text.push({ t: +segT.toFixed(2), s });
        segT = null;
      } else interim += txt;
    }
    st.interim = interim.trim();
    changed();
  };
  r.onerror = (e) => {
    if (FATAL.has(e.error)) {
      st.sttFatal = e.error;
      changed();
    }
  };
  r.onend = () => {
    if (st.sr === r) st.sr = null;
    st.interim = '';
    st.sttDone?.();
    // Chrome ends a session after a while of silence: keep listening while the recording goes on
    if (cur === st && !st.paused && !st.stopping && !st.sttFatal) {
      const wait = Date.now() - (st.sttAt || 0) < 1500 ? 1500 : 0;
      setTimeout(() => listen(st, lang), wait);
    }
  };
  st.sttAt = Date.now();
  st.sttLang = lang;
  try {
    r.start(st.stream.getAudioTracks()[0]);
  } catch {
    try {
      r.start();
    } catch (e) {
      st.sttFatal = e.name || 'error';
      return;
    }
  }
  st.sr = r;
}
/** Stops listening and waits (briefly) for the last words. */
function unlisten(st) {
  const r = st.sr;
  if (!r) return Promise.resolve();
  return new Promise((res) => {
    const tm = setTimeout(res, 1200);
    st.sttDone = () => {
      clearTimeout(tm);
      st.sttDone = null;
      res();
    };
    try {
      r.stop();
    } catch {
      res();
    }
  });
}

export function pause() {
  if (!cur || cur.paused) return;
  try {
    cur.mr.pause();
  } catch {}
  cur.acc += Date.now() - cur.t0;
  cur.paused = true;
  cur.mr.requestData?.();
  unlisten(cur);
  changed();
}
export function resume() {
  if (!cur || !cur.paused) return;
  try {
    cur.mr.resume();
  } catch {}
  cur.t0 = Date.now();
  cur.paused = false;
  if (cur.mode === 'stt') listen(cur, cur.sttLang);
  changed();
}
/** Adds a bookmark at the current time; returns the number of bookmarks, or 0 when full (50). */
export function mark() {
  if (!cur || cur.marks.length >= M.MAX_MARKS) return 0;
  cur.marks.push({ t: +elapsed().toFixed(2) });
  changed();
  return cur.marks.length;
}

/** Stops and saves the recording; resolves to its id once the file and waveform are stored. */
export function stop() {
  const st = cur;
  if (!st) return Promise.resolve(null);
  if (st.stopping) return st.stopping;
  st.stopping = (async () => {
    const dur = elapsed(), levels = Uint8Array.from(st.levels), levels2 = Uint8Array.from(st.levels2);
    if (!st.paused) st.acc += Date.now() - st.t0;
    st.paused = true;
    await unlisten(st);
    await new Promise((res) => {
      st.mr.addEventListener('stop', res, { once: true });
      try {
        st.mr.stop();
      } catch {
        res();
      }
    });
    st.timers.forEach(clearInterval);
    st.stream.getTracks().forEach((x) => x.stop());
    try {
      st.src?.disconnect();
      st.split?.disconnect();
    } catch {}
    removeEventListener('beforeunload', keepPage);
    // the list shows the recording right away with the live waveform; the decoded one replaces it a moment later
    mut((d) => {
      const m = d.items.find((x) => x.id === st.id);
      if (!m) return;
      m.dur = dur;
      if (levels.length) {
        m.pk = M.encodePeaks(levels);
        m.pr = LEVEL_RATE;
        if (levels2.length) m.pk2 = M.encodePeaks(levels2);
      }
      if (st.marks.length) m.marks = st.marks;
      if (st.text.length) m.text = st.text;
    });
    cur = null;
    changed();
    await st.writes;
    await finish(st.id, { dur, levels, levels2 });
    return st.id;
  })();
  return st.stopping;
}

const finishing = new Set();
/** Puts a recording's chunks together into one file and stores its exact length and waveform. */
export async function finish(id, liveLv = null) {
  if (finishing.has(id)) return;
  finishing.add(id);
  try {
    const keys = (await listBlobs(`recorder:${id}:c`).catch(() => [])).sort();
    const parts = (await Promise.all(keys.map((k) => getBlob(k).catch(() => null)))).filter(Boolean);
    const memo = D().items.find((m) => m.id === id);
    const blob = parts.length ? new Blob(parts, { type: memo?.mime || parts[0].type || 'audio/webm' }) : await getBlob(M.blobKey(id)).catch(() => null);
    if (!blob || !blob.size) {
      await destroy([id]);
      return;
    }
    if (parts.length) {
      await putBlob(M.blobKey(id), blob);
      await Promise.all(keys.map((k) => delBlob(k).catch(() => {})));
    }
    let info = null;
    try {
      info = await analyse(blob, { split: memo?.mode === 'interview' });
    } catch (e) {
      console.warn('recorder waveform', e);
    }
    mut((d) => {
      const m = d.items.find((x) => x.id === id);
      if (!m) return;
      delete m.rec;
      m.size = blob.size;
      if (info?.dur) {
        m.dur = info.dur;
        m.pk = M.encodePeaks(info.pk);
        m.pr = info.pr;
        if (info.pk2) m.pk2 = M.encodePeaks(info.pk2);
        else if (m.mode === 'interview' && m.pk2) delete m.pk2; // a mono microphone: one waveform for both
      } else if (liveLv?.levels?.length) {
        m.dur = liveLv.dur;
        m.pk = M.encodePeaks(liveLv.levels);
        m.pr = LEVEL_RATE;
      } else m.dur ||= liveLv?.dur || keys.length;
      // bookmarks and sentences can't be later than the end
      if (m.marks) m.marks = m.marks.filter((b) => b.t <= m.dur + 0.5).map((b) => ({ ...b, t: Math.min(b.t, m.dur) }));
    });
  } finally {
    finishing.delete(id);
    try {
      localStorage.removeItem(BEAT(id));
    } catch {}
  }
}

/** Recordings left half-done by a tab that closed while recording are saved from their chunks. */
export async function recover() {
  for (const m of D().items.filter((x) => x.rec && x.id !== cur?.id)) {
    let beat = 0;
    try {
      beat = +localStorage.getItem(BEAT(m.id)) || 0;
    } catch {}
    if (Date.now() - beat < 8000) continue; // still being recorded in another tab
    await finish(m.id);
  }
}

/** Throws the recording away (the save dialog's Discard). */
export const discard = (id) => destroy([id]);
