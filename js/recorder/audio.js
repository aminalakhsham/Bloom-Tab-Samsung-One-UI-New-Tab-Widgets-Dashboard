// Voice Recorder audio: decoding for the waveform, the player (speed that keeps the pitch, Skip silence, Repeat a
// section, Interview recordings with each person muted on their own, edited recordings played through their kept
// parts) and WAV export of edited recordings. Nothing here sends audio anywhere.
import * as M from './model.js';

let actx = null;
/** One AudioContext for the app (the engine's level meters and the player's Interview channels). */
export const audioCtx = () => (actx ||= new AudioContext());

/** Decodes a recording at `rate` Hz (low rates keep memory small for long recordings). Channels are kept. */
export async function decode(blob, rate = 8000) {
  const ctx = new OfflineAudioContext(1, 1, rate);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}
const mono = (ab) => {
  if (ab.numberOfChannels === 1) return ab.getChannelData(0);
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels;
  }
  return out;
};
function peaks(data, step, n) {
  const pk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), b = Math.min(data.length, Math.floor((i + 1) * step));
    for (let j = a; j < b; j++) {
      const v = data[j] < 0 ? -data[j] : data[j];
      if (v > m) m = v;
    }
    pk[i] = Math.min(255, Math.round(m * 255));
  }
  return pk;
}
/** Waveform peaks (0…255 per bucket) and the exact length, computed once when a recording is saved. Interview
 *  recordings get one waveform per channel (the person in front of each side of the microphone). */
export async function analyse(blob, { split = false } = {}) {
  const ab = await decode(blob, 8000);
  const pr = ab.duration > 3 * 3600 ? 5 : ab.duration > 3600 ? 10 : 20;
  const step = ab.sampleRate / pr, n = Math.ceil(ab.length / step);
  if (split && ab.numberOfChannels > 1) return { dur: ab.duration, pk: peaks(ab.getChannelData(0), step, n), pk2: peaks(ab.getChannelData(1), step, n), pr };
  return { dur: ab.duration, pk: peaks(mono(ab), step, n), pr };
}

/** A WAV file of the kept parts of an edited recording (Share / Save as file). */
export async function renderWav(blob, segs) {
  const ab = await decode(blob, 44100);
  const data = mono(ab), sr = ab.sampleRate;
  const parts = segs.map(([s, e]) => data.subarray(Math.floor(s * sr), Math.min(data.length, Math.ceil(e * sr))));
  const len = parts.reduce((a, p) => a + p.length, 0);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const p of parts)
    for (let i = 0; i < p.length; i++, o += 2) {
      const x = Math.max(-1, Math.min(1, p[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * One player per open app. Times given to and reported by it are in the edited recording's time; the element plays
 * the original file and jumps over removed parts and, with Skip silence, over silent stretches.
 */
export function createPlayer(onState) {
  const el = new Audio();
  el.preload = 'auto';
  el.preservesPitch = true;
  let memo = null, segs = [[0, 0]], ranges = [[0, 0]], len = 0, raf = 0, fixing = null, quiet = false, repeat = null;
  let graph = null, mute = [false, false];
  const emit = () => {
    if (!quiet) onState?.();
  };

  // Interview: each channel (person) through its own gain into both ears, so either one can be muted
  function wire() {
    if (graph) return graph;
    const ctx = audioCtx();
    const src = ctx.createMediaElementSource(el);
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    const g = [ctx.createGain(), ctx.createGain()];
    src.connect(split);
    g.forEach((gn, i) => {
      split.connect(gn, i);
      gn.connect(merge, 0, 0);
      gn.connect(merge, 0, 1);
    });
    merge.connect(ctx.destination);
    graph = { ctx, g };
    applyMute();
    return graph;
  }
  function applyMute() {
    if (!graph) return;
    const both = !mute[0] && !mute[1];
    graph.g.forEach((gn, i) => (gn.gain.value = mute[i] ? 0 : both ? 0.5 : 1));
  }
  function plan() {
    segs = M.segsOf(memo);
    len = M.lenOf(segs);
    ranges = memo.skip && memo.pk ? M.subtract(segs, M.silences(M.decodePeaks(memo.pk), memo.pr)) : segs;
    if (!ranges.length) ranges = segs;
  }
  // MediaRecorder files don't say how long they are: reading to the end once makes the element know it
  let fixP = null;
  const fixDuration = () =>
    (fixP ??= new Promise((res) => {
      if (Number.isFinite(el.duration)) return res();
      const back = Number.isFinite(el.currentTime) && el.currentTime < 1e100 ? el.currentTime : 0;
      quiet = true;
      const done = () => {
        el.removeEventListener('durationchange', check);
        clearTimeout(tm);
        el.currentTime = back;
        quiet = false;
        res();
      };
      const check = () => {
        if (Number.isFinite(el.duration)) done();
      };
      const tm = setTimeout(done, 1500);
      el.addEventListener('durationchange', check);
      el.currentTime = 1e101;
    }).finally(() => {
      fixP = null;
    }));
  function follow() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (el.paused) return;
      guard();
      emit();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  // keeps the element inside the parts that play: removed parts and silences are jumped over, Repeat loops, the end stops
  function guard() {
    const o = el.currentTime;
    if (repeat && M.toEdit(o, segs) >= repeat.b - 0.02) {
      el.currentTime = M.toOrig(repeat.a, segs);
      return;
    }
    if (ranges.some(([s, e]) => o >= s - 0.02 && o < e - 0.015)) return;
    const next = ranges.find(([s]) => s > o - 0.02);
    if (next && o < next[0]) {
      el.currentTime = next[0];
      return;
    }
    if (!next || o >= ranges.at(-1)[1] - 0.015) end();
  }
  function end() {
    if (repeat) {
      el.currentTime = M.toOrig(repeat.a, segs);
      return;
    }
    el.pause();
    el.currentTime = segs[0][0];
    cancelAnimationFrame(raf);
    emit();
  }
  el.addEventListener('timeupdate', () => {
    if (quiet) return;
    if (!el.paused) guard();
    emit();
  });
  el.addEventListener('ended', () => {
    if (repeat) {
      el.currentTime = M.toOrig(repeat.a, segs);
      el.play().catch(() => {});
    } else end();
  });
  el.addEventListener('pause', emit);
  el.addEventListener('play', emit);

  return {
    el,
    get memo() {
      return memo;
    },
    async load(m, url) {
      el.pause();
      cancelAnimationFrame(raf);
      memo = m;
      repeat = null;
      mute = [false, false];
      applyMute();
      plan();
      el.playbackRate = m.speed || 1;
      if (el.src !== url) {
        el.src = url || '';
        fixing = url ? new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true })).then(fixDuration) : null;
      }
      el.currentTime = segs[0][0] || 0;
      emit();
    },
    /** Picks up a changed recording (speed, Skip silence, edits) without losing the position. */
    refresh(m) {
      const at = this.time();
      memo = m;
      plan();
      el.playbackRate = m.speed || 1;
      if (repeat && repeat.b > len) repeat = null;
      this.seek(Math.min(at, len));
    },
    unload() {
      el.pause();
      cancelAnimationFrame(raf);
      memo = null;
      el.removeAttribute('src');
      el.load();
      emit();
    },
    playing: () => !el.paused,
    len: () => len,
    time: () => (memo ? Math.min(len, M.toEdit(el.currentTime, segs)) : 0),
    async play() {
      if (!memo) return;
      if (mute[0] || mute[1]) wire();
      if (graph?.ctx.state === 'suspended') await graph.ctx.resume().catch(() => {});
      await fixing;
      if (!repeat && this.time() >= len - 0.05) this.seek(0);
      guard();
      await el.play().catch((e) => console.warn('play', e));
      follow();
    },
    pause() {
      el.pause();
    },
    toggle() {
      return el.paused ? this.play() : this.pause();
    },
    seek(t) {
      if (!memo) return;
      el.currentTime = M.toOrig(Math.max(0, Math.min(len, t)), segs);
      emit();
    },
    skip(sec) {
      this.seek(this.time() + sec);
    },
    /** Repeat a section: { a, b } in edited time, or null. */
    setRepeat(r) {
      repeat = r && r.b - r.a > 0.2 ? r : null;
      if (repeat) {
        const t = this.time();
        if (t < repeat.a || t > repeat.b) this.seek(repeat.a);
      }
      emit();
    },
    get repeat() {
      return repeat;
    },
    /** Interview: mutes person 0 (top) or 1 (bottom). */
    setMute(i, on) {
      mute[i] = !!on;
      wire();
      applyMute();
      emit();
    },
    muted: (i) => mute[i],
    destroy() {
      this.unload();
      try {
        graph?.g.forEach((g) => g.disconnect());
      } catch {}
    },
  };
}
