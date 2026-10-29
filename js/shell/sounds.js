// Ambient sounds synthesised with Web Audio (no files): rain, ocean, fire, forest, white/pink/brown noise.
import { registerActivity } from '../core/activity.js';
import { addStrings, t } from '../core/i18n.js';
import { setting, setSetting } from '../core/store.js';

export const SOUNDS = [
  { id: 'rain', color: '#4f8bff', icon: 'rain' },
  { id: 'ocean', color: '#00a6c8', icon: 'waves' },
  { id: 'fire', color: '#ff7a2f', icon: 'sun' },
  { id: 'forest', color: '#2fae66', icon: 'wind' },
  { id: 'white', color: '#8d93a5', icon: 'sound' },
  { id: 'pink', color: '#ff6fa8', icon: 'sound' },
  { id: 'brown', color: '#a0715a', icon: 'sound' },
];

let ctx, master, analyser, nodes = [], current = null, playing = false, volume = null;
// The level is a setting so the Quick Panel slider keeps it in every new tab; read lazily (the store loads after import).
const vol = () => (volume ??= setting('soundVolume') ?? 0.6);
const listeners = new Set();
export const onSoundChange = (cb) => (listeners.add(cb), () => listeners.delete(cb));
const emit = () => listeners.forEach((cb) => cb(state()));

export const state = () => ({ id: current, playing, volume: vol(), sound: SOUNDS.find((s) => s.id === current) || null });
export const soundName = (id) => t('sound.' + id);

function noiseBuffer(kind, seconds = 4) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

function src(kind) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(kind);
  s.loop = true;
  s.start();
  nodes.push(s);
  return s;
}

function lfo(freq, depth, target, offset) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.value = depth;
  o.connect(g).connect(target);
  if (offset != null) target.value = offset;
  o.start();
  nodes.push(o);
}

function chain(...n) {
  n.reduce((a, b) => a.connect(b));
  return n[n.length - 1];
}

function build(id) {
  const out = ctx.createGain();
  out.connect(master);
  nodes.push(out);
  if (id === 'white' || id === 'pink' || id === 'brown') {
    chain(src(id), out);
    out.gain.value = id === 'white' ? 0.35 : 0.8;
  } else if (id === 'rain') {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    chain(src('pink'), hp, lp, g, out);
    lfo(0.13, 0.12, g.gain, 0.7);
    // heavy drops: brown noise low rumble
    const lp2 = ctx.createBiquadFilter();
    lp2.frequency.value = 300;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    chain(src('brown'), lp2, g2, out);
    dropLoop(out);
  } else if (id === 'ocean') {
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 600;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    chain(src('pink'), lp, g, out);
    lfo(0.09, 0.45, g.gain, 0.5);
    lfo(0.09, 450, lp.frequency, 700);
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    chain(src('brown'), g2, out);
  } else if (id === 'fire') {
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    chain(src('brown'), lp, g, out);
    lfo(0.3, 0.15, g.gain, 0.9);
    crackleLoop(out);
  } else if (id === 'forest') {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    chain(src('pink'), bp, g, out);
    lfo(0.05, 300, bp.frequency, 600);
    lfo(0.07, 0.25, g.gain, 0.55);
    birdLoop(out);
  }
}

let timers = [];
function every(fn, min, max) {
  const tick = () => {
    if (!playing) return;
    fn();
    timers.push(setTimeout(tick, min + Math.random() * (max - min)));
  };
  timers.push(setTimeout(tick, min));
}

function burst(out, { dur = 0.03, freq = 3000, q = 1, gain = 0.3, type = 'bandpass' }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer('white', 0.2);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  chain(s, f, g, out);
  s.start(now);
  s.stop(now + dur + 0.05);
}

function dropLoop(out) {
  every(() => burst(out, { dur: 0.02 + Math.random() * 0.04, freq: 2000 + Math.random() * 4000, q: 2, gain: 0.08 + Math.random() * 0.12 }), 30, 120);
}

function crackleLoop(out) {
  every(() => burst(out, { dur: 0.01 + Math.random() * 0.03, freq: 1500 + Math.random() * 3000, q: 0.8, gain: 0.2 + Math.random() * 0.5, type: 'highpass' }), 60, 500);
}

function birdLoop(out) {
  every(() => {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.13;
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      chain(o, g, out);
      o.start(t0);
      o.stop(t0 + 0.12);
    }
  }, 1800, 6000);
}

function stopNodes() {
  timers.forEach(clearTimeout);
  timers = [];
  nodes.forEach((n) => {
    try {
      n.stop?.();
    } catch {}
    try {
      n.disconnect();
    } catch {}
  });
  nodes = [];
}

export function play(id = current || setting('lastSound') || 'rain') {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    master.connect(analyser).connect(ctx.destination);
  }
  ctx.resume();
  stopNodes();
  current = id;
  playing = true;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(vol(), ctx.currentTime + 1.2);
  build(id);
  if (setting('lastSound') !== id) setSetting('lastSound', id);
  emit();
}

export function pause() {
  if (!playing) return;
  playing = false;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.4);
  setTimeout(() => !playing && stopNodes(), 450);
  emit();
}

export const toggle = () => (playing ? pause() : play());

export function step(dir) {
  const i = SOUNDS.findIndex((s) => s.id === (current || setting('lastSound') || 'rain'));
  const next = SOUNDS[(i + dir + SOUNDS.length) % SOUNDS.length].id;
  if (playing) play(next);
  else {
    current = next;
    setSetting('lastSound', next);
    emit();
  }
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (setting('soundVolume') !== volume) setSetting('soundVolume', volume);
  if (ctx && playing) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  emit();
}

/** 0..1 levels for a waveform visual. */
export function levels(n = 16) {
  if (!analyser || !playing) return Array(n).fill(0);
  const d = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(d);
  return Array.from({ length: n }, (_, i) => d[Math.min(d.length - 1, Math.floor((i / n) * d.length * 0.8))] / 255);
}

registerActivity('sound', () => {
  if (!playing) return null;
  const s = SOUNDS.find((x) => x.id === current);
  return {
    icon: s.icon,
    color: s.color,
    title: soundName(s.id),
    sub: t('sound.playing'),
    wave: true,
    priority: 3,
    actions: [{ icon: 'pause', label: t('sound.pause'), onClick: pause }],
  };
});

addStrings({
  en: {
    'sound.title': 'Sounds',
    'sound.playing': 'Ambient sound',
    'sound.pause': 'Pause',
    'sound.play': 'Play',
    'sound.next': 'Next',
    'sound.prev': 'Previous',
    'sound.rain': 'Rain',
    'sound.ocean': 'Ocean waves',
    'sound.fire': 'Fireplace',
    'sound.forest': 'Forest',
    'sound.white': 'White noise',
    'sound.pink': 'Pink noise',
    'sound.brown': 'Brown noise',
  },
  ar: {
    'sound.title': 'الأصوات',
    'sound.playing': 'صوت محيطي',
    'sound.pause': 'إيقاف مؤقت',
    'sound.play': 'تشغيل',
    'sound.next': 'التالي',
    'sound.prev': 'السابق',
    'sound.rain': 'مطر',
    'sound.ocean': 'أمواج المحيط',
    'sound.fire': 'مدفأة',
    'sound.forest': 'غابة',
    'sound.white': 'ضوضاء بيضاء',
    'sound.pink': 'ضوضاء وردية',
    'sound.brown': 'ضوضاء بنية',
  },
});
