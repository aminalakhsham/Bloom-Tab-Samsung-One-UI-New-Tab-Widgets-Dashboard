// Alarm and timer sounds, synthesised — no audio files. Each tone is a short pattern of notes (struck bells, marimba,
// beeps, chirps, soft chords) rendered to a 16-bit WAV that loops seamlessly (notes ringing past the end of the
// pattern wrap around to its start). Pure JS with no Web Audio, so the service worker can render a tone and hand it
// to the offscreen audio host (`play` with a data: URL, loop) and the pages can preview the very same sound.
// Some tone patterns are adapted from Liquid Tab's js/tones.js.

export const TONES = ['flower', 'beep', 'daybreak', 'bright', 'chimes', 'crystal', 'twinkle', 'birds', 'pulse', 'digital', 'calm', 'circuit'];
export const SAMPLE_RATE = 32000;

const N = { G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, D7: 2349.32, E7: 2637.02 };
const BELL = [[1, 1], [2.01, 0.45], [2.76, 0.25], [5.4, 0.1]];
const MARIMBA = [[1, 1], [4, 0.22], [10, 0.05]];
const GLASS = [[1, 1], [2.76, 0.3], [5.4, 0.12]];
const note = (t, f, dur, o = {}) => ({ t, f, dur, ...o });

/** Each pattern: { len (seconds, one loop), notes: [{ t, f, dur, type, peak, attack, env, partials, glide, vib }] }. */
const PATTERNS = {
  // Morning flower: a marimba tune (Samsung's default alarm is a marimba melody too)
  flower: () => ({
    len: 2.7,
    notes: [[0, 'G5'], [0.17, 'C6'], [0.34, 'E6'], [0.51, 'G6'], [0.85, 'E6'], [1.02, 'D6'], [1.19, 'C6'], [1.36, 'D6'], [1.7, 'E6'], [1.87, 'G6']]
      .map(([t, n]) => note(t, N[n], 0.75, { peak: 0.3, partials: MARIMBA })),
  }),
  // Beep-beep: the classic alarm clock
  beep: () => ({ len: 1.05, notes: [0, 0.15, 0.3, 0.45].map((t) => note(t, 1000, 0.09, { type: 'square', peak: 0.16, env: 'flat' })) }),
  // Daybreak: a soft chord that swells and fades
  daybreak: () => ({
    len: 2.6,
    notes: [440, 554.37, 659.25, 880].map((f) => note(0, f, 2.4, { type: 'triangle', peak: 0.12, attack: 1, env: 'swell' }))
      .concat([659.25, 880, 1108.73].map((f) => note(1.3, f, 1.3, { type: 'sine', peak: 0.06, attack: 0.5, env: 'swell' }))),
  }),
  // Bright morning: quick bell runs
  bright: () => ({
    len: 1.3,
    notes: [...[N.G5, N.B5, N.D6, N.G6].map((f, i) => note(i * 0.09, f, 0.55, { peak: 0.26, partials: [[1, 1], [4, 0.18], [10, 0.05]] })),
      ...[N.D6, N.G6].map((f, i) => note(0.55 + i * 0.09, f, 0.55, { peak: 0.22, partials: [[1, 1], [4, 0.18], [10, 0.05]] }))],
  }),
  chimes: () => ({ len: 1.6, notes: [N.C6, N.E6, N.G6, N.C7].map((f, i) => note(i * 0.12, f, 0.95, { peak: 0.24 })) }),
  crystal: () => ({ len: 1.8, notes: [N.E6, N.A6, N.G6, N.C7, N.D7, N.A6].map((f, i) => note(i * 0.15 + (i % 2) * 0.03, f, 1.4, { peak: 0.14, partials: GLASS })) }),
  twinkle: () => ({
    len: 2.4,
    notes: [N.C6, N.C6, N.G6, N.G6, N.A6, N.A6, N.G6].map((f, i) => note(i * 0.24 + (i === 6 ? 0.1 : 0), f, 0.9, { peak: 0.2, partials: [[1, 1], [3, 0.12], [6.1, 0.05]] })),
  }),
  // Morning birds: little chirps that glide up and down
  birds: () => ({
    len: 1.6,
    notes: [[0, 2800, 3700], [0.09, 2900, 3800], [0.18, 3000, 3900], [0.62, 3600, 2500], [0.72, 3500, 2400], [1.05, 2600, 3300]]
      .map(([t, f, g]) => note(t, f, 0.07, { peak: 0.16, attack: 0.006, glide: g })),
  }),
  // Pulse: a fast double run of blips
  pulse: () => {
    const notes = [];
    for (let b = 0; b < 2; b++) for (let i = 0; i < 6; i++) notes.push(note(b * 0.62 + i * 0.075, i % 2 ? N.C7 : N.B6, 0.05, { type: 'triangle', peak: 0.2, env: 'flat' }));
    return { len: 1.6, notes };
  },
  // Digital: the double beep of a digital watch (the default timer sound)
  digital: () => ({ len: 1.25, notes: [0, 0.13, 0.5, 0.63].map((t) => note(t, 2000, 0.075, { type: 'square', peak: 0.1, env: 'flat' })) }),
  // Calm night: a soft owl-like call with a little vibrato
  calm: () => ({ len: 2.4, notes: [[0, 523.25], [0.42, 493.88], [1.05, 523.25], [1.47, 440]].map(([t, f]) => note(t, f, 0.38, { peak: 0.24, attack: 0.06, glide: f * 0.97, vib: [6, 0.006] })) }),
  circuit: () => ({
    len: 1.2,
    notes: [N.A5, N.E6, N.A6, N.E6, N.C6, N.E6, N.A6, N.E6, N.A5, N.E6, N.B6, N.E6].map((f, i) => note(i * 0.07, f, 0.055, { type: 'triangle', peak: 0.14, env: 'flat' })),
  }),
};

const WAVES = {
  sine: [[1, 1]],
  square: [[1, 1], [3, 1 / 3], [5, 1 / 5], [7, 1 / 7], [9, 1 / 9]],
  triangle: [[1, 1], [3, -1 / 9], [5, 1 / 25], [7, -1 / 49]],
};

function envelope(kind, t, attack, dur) {
  if (t < attack) return t / attack;
  if (kind === 'flat') return t > dur - 0.02 ? Math.max(0, (dur - t) / 0.02) : 1;
  if (kind === 'swell') return Math.max(0, (dur - t) / (dur - attack));
  return Math.exp((Math.log(1e-4) * (t - attack)) / Math.max(1e-3, dur - attack));
}

/** One loop of a tone as samples in -1…1. Unknown ids play Morning flower. */
export function renderTone(id, sr = SAMPLE_RATE) {
  const { len, notes } = (PATTERNS[id] || PATTERNS.flower)();
  const size = Math.round(len * sr);
  const buf = new Float32Array(size);
  const TAU = Math.PI * 2;
  for (const nt of notes) {
    const { t, f, dur, type = 'sine', peak = 0.2, attack = 0.004, env = 'exp', partials = [[1, 1]], glide, vib } = nt;
    const harm = WAVES[type] || WAVES.sine;
    const s0 = Math.round(t * sr);
    for (const [k, amp] of partials) {
      // higher partials of a struck bell die away sooner
      const pdur = env === 'exp' && k > 1 ? dur / Math.sqrt(k) : dur;
      const n = Math.round(pdur * sr);
      let ph = 0;
      for (let j = 0; j < n; j++) {
        const tt = j / sr;
        let fr = (glide ? f + ((glide - f) * tt) / pdur : f) * k;
        if (vib) fr *= 1 + vib[1] * Math.sin(TAU * vib[0] * tt);
        ph += (TAU * fr) / sr;
        let v = 0;
        for (const [m, a] of harm) if (fr * m < sr * 0.45) v += a * Math.sin(m * ph);
        buf[(s0 + j) % size] += v * envelope(env, tt, attack, pdur) * peak * amp;
      }
    }
  }
  // about the same loudness for every tone (a square-wave beep sounds much louder than a bell at the same peak)
  let max = 0, sq = 0;
  for (let i = 0; i < size; i++) {
    max = Math.max(max, Math.abs(buf[i]));
    sq += buf[i] * buf[i];
  }
  const rms = Math.sqrt(sq / size);
  const gain = max > 0 ? Math.min(0.9 / max, 0.24 / rms) : 0;
  for (let i = 0; i < size; i++) buf[i] *= gain;
  return buf;
}

/** 16-bit mono PCM WAV file bytes. */
export function wavBytes(samples, sr = SAMPLE_RATE) {
  const n = samples.length, out = new Uint8Array(44 + n * 2), dv = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return out;
}

const wavCache = new Map(), urlCache = new Map();
export function toneWav(id) {
  if (!TONES.includes(id)) id = 'flower';
  if (!wavCache.has(id)) wavCache.set(id, wavBytes(renderTone(id)));
  return wavCache.get(id);
}
/** data:audio/wav;base64,… of a tone (the offscreen host plays it with loop). */
export function toneDataUrl(id) {
  if (!TONES.includes(id)) id = 'flower';
  if (!urlCache.has(id)) {
    const b = toneWav(id);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    urlCache.set(id, 'data:audio/wav;base64,' + btoa(s));
  }
  return urlCache.get(id);
}
