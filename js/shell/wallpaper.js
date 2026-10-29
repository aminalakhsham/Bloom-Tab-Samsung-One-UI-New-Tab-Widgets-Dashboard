// Wallpapers (Settings › Wallpaper and style): animated "bloom" gradients drawn on a tiny canvas (upscaled = free
// blur), Creative wallpapers generated on this device from a description, your own photos (IndexedDB, with Dynamic
// Lock screen: a different photo every time the Lock screen shows), Bing's photo of the day, or a solid colour.
//
// settings.wallpaper is the Home screen's wallpaper, settings.lockWallpaper the Lock screen's own (null = the same):
//   { type: 'preset', id }                       a bloom preset; "dual" presets have a light and a dark look
//   { type: 'gen', spec: { light, dark }, prompt, style, mood, day? }   Creative wallpaper (paintSpec)
//   { type: 'photo', id }  /  { type: 'shuffle' }  your photos (store key `wallPhotos`, pictures `wallpaper:<id>`)
//   { type: 'color', value }  /  { type: 'bing' }  /  { type: 'image' } (older versions: a data URL in `wallpaperImage`)
// The wallpaper's colours feed the Color palette (theme.js setPaletteColors) and the text tone (wallTone()).
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { $, h, uid, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, luminance, readImage } from '../core/util.js';
import { addStrings } from '../core/i18n.js';
import { putBlob, delBlob, blobUrl, dataUrlToBlob } from '../core/blobs.js';
import { setPaletteColors } from './theme.js';

// tone: which text colour reads best on top (dark wallpapers -> white text)
export const PRESETS = [
  { id: 'bloom', tone: 'dark', accent: '#8c6bff', base: ['#1a0f3d', '#06040f'], blobs: [['#7b5cff', 0.22, 0.3, 0.55], ['#ff6fb1', 0.78, 0.72, 0.5], ['#3fa9ff', 0.82, 0.18, 0.42], ['#b44dff', 0.3, 0.86, 0.5]] },
  { id: 'dawn', tone: 'light', accent: '#e0567f', base: ['#fde7f0', '#e6ebff'], blobs: [['#ffadc4', 0.2, 0.25, 0.55], ['#aebcff', 0.82, 0.3, 0.5], ['#ffd29a', 0.65, 0.85, 0.5], ['#bdefff', 0.15, 0.85, 0.45]] },
  { id: 'aurora', tone: 'dark', accent: '#19c99a', base: ['#02181b', '#02060c'], blobs: [['#19e3a8', 0.25, 0.25, 0.5], ['#1a7bff', 0.75, 0.45, 0.55], ['#7a3cff', 0.55, 0.9, 0.5], ['#00c2d1', 0.1, 0.75, 0.4]] },
  { id: 'sunset', tone: 'dark', accent: '#ff6a3d', base: ['#2e0b22', '#0f0615'], blobs: [['#ff7a45', 0.25, 0.7, 0.55], ['#ff3d71', 0.7, 0.35, 0.5], ['#ffc65c', 0.85, 0.85, 0.42], ['#9b4dff', 0.15, 0.15, 0.48]] },
  { id: 'ocean', tone: 'dark', accent: '#2a9dff', base: ['#05264a', '#020a18'], blobs: [['#2aa9ff', 0.2, 0.3, 0.5], ['#0047c2', 0.8, 0.6, 0.6], ['#48e5ff', 0.65, 0.12, 0.38], ['#1e3cff', 0.3, 0.9, 0.5]] },
  { id: 'mint', tone: 'light', accent: '#14a37f', base: ['#e6fbf2', '#e3f1ff'], blobs: [['#86eec4', 0.2, 0.3, 0.5], ['#98d4ff', 0.8, 0.25, 0.5], ['#d6ffad', 0.7, 0.85, 0.45], ['#a9f3ff', 0.15, 0.85, 0.45]] },
  { id: 'graphite', tone: 'dark', accent: '#7c8cff', base: ['#1a1b20', '#09090b'], blobs: [['#3c4252', 0.2, 0.25, 0.55], ['#4f5bd5', 0.8, 0.7, 0.4], ['#2b303c', 0.7, 0.2, 0.5], ['#5d6272', 0.25, 0.85, 0.45]] },
  { id: 'lavender', tone: 'light', accent: '#7b5cf0', base: ['#f0eaff', '#fdf0ff'], blobs: [['#c2b0ff', 0.25, 0.3, 0.55], ['#f0b2ff', 0.8, 0.65, 0.5], ['#b0d0ff', 0.75, 0.15, 0.45], ['#ffcfe6', 0.2, 0.85, 0.45]] },
  { id: 'ember', tone: 'dark', accent: '#ff5a36', base: ['#1d0905', '#070302'], blobs: [['#ff4d2e', 0.3, 0.65, 0.5], ['#ff9a3c', 0.75, 0.3, 0.45], ['#c2185b', 0.8, 0.85, 0.5], ['#ffd166', 0.15, 0.15, 0.35]] },
  { id: 'forest', tone: 'dark', accent: '#3fbf6f', base: ['#0a1a0f', '#030805'], blobs: [['#2f9e5b', 0.25, 0.35, 0.55], ['#9be15d', 0.8, 0.2, 0.38], ['#1b6b5a', 0.7, 0.8, 0.55], ['#d8f08c', 0.15, 0.9, 0.3]] },
  { id: 'sand', tone: 'light', accent: '#e07a3f', base: ['#fdf2e4', '#f2e8ff'], blobs: [['#ffcf9c', 0.2, 0.3, 0.55], ['#ff9fb0', 0.8, 0.75, 0.42], ['#bfe6fb', 0.8, 0.18, 0.45], ['#ffe6c7', 0.2, 0.85, 0.45]] },
  { id: 'midnight', tone: 'dark', accent: '#5b6bff', base: ['#080c22', '#000000'], blobs: [['#2b3cff', 0.3, 0.4, 0.5], ['#6b21ff', 0.75, 0.75, 0.5], ['#00a6ff', 0.85, 0.15, 0.35], ['#ff4fd8', 0.15, 0.9, 0.3]] },
  // Dual presets: a light and a dark look that follow Dark mode, like One UI's own wallpapers.
  // shape draws over the blobs (petals | waves | rings | hills) with the colours in fx; sun = [x, y, r, colour].
  {
    id: 'petal', dual: true,
    light: { tone: 'light', accent: '#d9468f', base: ['#fff0f4', '#fde8ff'], blobs: [['#ffb3cf', 0.25, 0.3, 0.55], ['#ffd1a8', 0.8, 0.25, 0.45], ['#e7b8ff', 0.7, 0.8, 0.5], ['#ffc2e0', 0.2, 0.85, 0.45]], shape: 'petals', fx: ['#ff8fbf', '#ffc49b', '#d59cff'] },
    dark: { tone: 'dark', accent: '#ff5fa8', base: ['#2a0820', '#0b0310'], blobs: [['#c2185b', 0.25, 0.3, 0.5], ['#7b2cbf', 0.8, 0.7, 0.55], ['#ff6f91', 0.75, 0.15, 0.38], ['#4a148c', 0.2, 0.9, 0.45]], shape: 'petals', fx: ['#ff4f9a', '#ff9e7a', '#b46bff'] },
  },
  {
    id: 'lagoon', dual: true,
    light: { tone: 'light', accent: '#0e9bb5', base: ['#e6fbff', '#e9f3ff'], blobs: [['#a6eef5', 0.2, 0.25, 0.5], ['#b9d6ff', 0.8, 0.3, 0.5], ['#c2f7e4', 0.7, 0.8, 0.45], ['#d6f3ff', 0.2, 0.85, 0.45]], shape: 'waves', fx: ['#5fd8e8', '#7fb8ff', '#7ee8c0'] },
    dark: { tone: 'dark', accent: '#22c3e0', base: ['#021c26', '#010a12'], blobs: [['#00a6c8', 0.2, 0.25, 0.5], ['#005f8f', 0.8, 0.35, 0.55], ['#00b894', 0.7, 0.85, 0.42], ['#1b3d8f', 0.15, 0.8, 0.45]], shape: 'waves', fx: ['#00c2d8', '#1e6bff', '#18e0a8'] },
  },
  {
    id: 'citrus', dual: true,
    light: { tone: 'light', accent: '#e8890c', base: ['#fff8e1', '#fff1e0'], blobs: [['#ffd54f', 0.25, 0.3, 0.5], ['#ffab5e', 0.8, 0.65, 0.5], ['#c5e86c', 0.75, 0.15, 0.42], ['#ffe08a', 0.2, 0.85, 0.48]] },
    dark: { tone: 'dark', accent: '#ffa726', base: ['#1f1405', '#090501'], blobs: [['#ff9800', 0.25, 0.3, 0.5], ['#f4511e', 0.8, 0.7, 0.5], ['#9ccc3c', 0.78, 0.15, 0.36], ['#ffca28', 0.2, 0.88, 0.4]] },
  },
  {
    id: 'iris', dual: true,
    light: { tone: 'light', accent: '#5b5ff0', base: ['#eef0ff', '#f6eeff'], blobs: [['#a5b4fc', 0.25, 0.3, 0.55], ['#c4b5fd', 0.8, 0.7, 0.5], ['#93c5fd', 0.8, 0.15, 0.4], ['#f0abfc', 0.2, 0.88, 0.42]], shape: 'rings', fx: ['#6d7bff', '#a78bfa'] },
    dark: { tone: 'dark', accent: '#818cf8', base: ['#0a0b2a', '#030312'], blobs: [['#4338ca', 0.25, 0.3, 0.55], ['#7c3aed', 0.8, 0.7, 0.5], ['#2563eb', 0.8, 0.15, 0.4], ['#c026d3', 0.2, 0.88, 0.38]], shape: 'rings', fx: ['#818cf8', '#c084fc'] },
  },
  {
    id: 'glacier', dual: true,
    light: { tone: 'light', accent: '#2f7fd8', base: ['#f2f8ff', '#e8f1fb'], blobs: [['#bfe3ff', 0.2, 0.25, 0.55], ['#d6e4ff', 0.8, 0.6, 0.5], ['#c9f2f5', 0.7, 0.12, 0.42], ['#e3ecff', 0.25, 0.88, 0.45]] },
    dark: { tone: 'dark', accent: '#5aa9ff', base: ['#06121f', '#02060c'], blobs: [['#1e4f7a', 0.2, 0.25, 0.55], ['#3a6ea5', 0.8, 0.6, 0.5], ['#2a8aa8', 0.7, 0.12, 0.42], ['#0f2c4f', 0.25, 0.88, 0.5]] },
  },
  {
    id: 'coral', dual: true,
    light: { tone: 'light', accent: '#e8584a', base: ['#fff2ee', '#fff7ef'], blobs: [['#ffb4a2', 0.2, 0.25, 0.52], ['#ffcf9e', 0.8, 0.3, 0.45], ['#ff9fb2', 0.7, 0.75, 0.48], ['#ffd9c7', 0.15, 0.8, 0.45]], shape: 'waves', fx: ['#ff8a75', '#ffb36b', '#ff7f9e'] },
    dark: { tone: 'dark', accent: '#ff7059', base: ['#250a08', '#0d0403'], blobs: [['#e0533f', 0.2, 0.25, 0.5], ['#ff7a45', 0.8, 0.3, 0.42], ['#b8336a', 0.7, 0.78, 0.5], ['#ff9b73', 0.15, 0.85, 0.36]], shape: 'waves', fx: ['#ff6a55', '#ff9a45', '#e0457b'] },
  },
  {
    id: 'nebula', dual: true,
    light: { tone: 'light', accent: '#7a5af5', base: ['#f3efff', '#eef6ff'], blobs: [['#c8b6ff', 0.3, 0.3, 0.55], ['#b8e1ff', 0.75, 0.65, 0.5], ['#ffc8f0', 0.8, 0.12, 0.4], ['#d7c9ff', 0.15, 0.85, 0.45]], shape: 'rings', fx: ['#9b7bff', '#6fb6ff'] },
    dark: { tone: 'dark', accent: '#a78bfa', base: ['#0b0520', '#02010a'], blobs: [['#5b21b6', 0.3, 0.32, 0.55], ['#0891b2', 0.75, 0.68, 0.45], ['#be185d', 0.8, 0.12, 0.36], ['#312e81', 0.15, 0.85, 0.5]], shape: 'rings', fx: ['#a855f7', '#22d3ee'] },
  },
  {
    id: 'meadow', dual: true,
    light: { tone: 'light', accent: '#2e9e57', base: ['#f1fbe6', '#e9f6ff'], blobs: [['#c6f08a', 0.2, 0.25, 0.5], ['#9be7c4', 0.8, 0.3, 0.5], ['#fff3a6', 0.65, 0.12, 0.38], ['#b8e8ff', 0.25, 0.1, 0.4]], shape: 'hills', fx: ['#a8df73', '#6cc79a', '#4fae7d'] },
    dark: { tone: 'dark', accent: '#4cc47a', base: ['#06150c', '#020805'], blobs: [['#2e7d32', 0.2, 0.25, 0.5], ['#00796b', 0.8, 0.3, 0.5], ['#9e9d24', 0.65, 0.12, 0.32], ['#1b5e20', 0.25, 0.1, 0.4]], shape: 'hills', fx: ['#2f8f4e', '#1f6d47', '#134a32'] },
  },
  {
    id: 'dune', dual: true,
    light: { tone: 'light', accent: '#d1662e', base: ['#fff4e6', '#ffe9d6'], blobs: [['#ffd6a5', 0.2, 0.25, 0.5], ['#f7b267', 0.8, 0.3, 0.45], ['#ffc4a3', 0.6, 0.12, 0.4], ['#fde2c2', 0.25, 0.12, 0.4]], shape: 'hills', fx: ['#f4a261', '#e07a5f', '#c8553d'] },
    dark: { tone: 'dark', accent: '#f0883e', base: ['#1c0d06', '#080402'], blobs: [['#8d4a20', 0.2, 0.25, 0.5], ['#c0622c', 0.8, 0.3, 0.42], ['#6b2f1a', 0.6, 0.12, 0.4], ['#e08a3c', 0.25, 0.12, 0.3]], shape: 'hills', fx: ['#a8552a', '#7a3a1c', '#4f2312'] },
  },
  {
    id: 'horizon', dual: true,
    light: { tone: 'light', accent: '#ef6c4a', base: ['#ffe9d2', '#ffd6e7'], blobs: [['#ffc28a', 0.2, 0.3, 0.52], ['#ff9fb8', 0.8, 0.7, 0.5], ['#ffe29a', 0.75, 0.15, 0.4], ['#cdb8ff', 0.2, 0.88, 0.45]], sun: [0.5, 0.38, 0.09, '#fff2c4'] },
    dark: { tone: 'dark', accent: '#ff7b54', base: ['#1a0b2e', '#05030c'], blobs: [['#ff6b4a', 0.2, 0.7, 0.5], ['#c2185b', 0.8, 0.35, 0.5], ['#ffa040', 0.8, 0.85, 0.36], ['#4527a0', 0.2, 0.15, 0.5]], sun: [0.5, 0.42, 0.08, '#ffb070'] },
  },
];

export const SOLIDS = ['#000000', '#1c1c22', '#2d3a4f', '#3b2c58', '#0f3d3a', '#5a2a2a', '#e9e4dc', '#f2f2f7', '#dfe8f5', '#f6e1e6'];
export const DEFAULT_WALL = { type: 'preset', id: 'bloom' };
const PHOTO_KEY = 'wallPhotos';

let canvas, raf, current = null, t0 = performance.now(), tone = 'dark', seq = 0, shownKey = '', shownKind = '', covered = false, shuffleId = null;
const toneListeners = new Set();
const colorListeners = new Set();
let colors = ['#3e7bff'];

export const wallTone = () => tone;
export const onWallTone = (cb) => (toneListeners.add(cb), () => toneListeners.delete(cb));
/** The wallpaper's main colours (best first): the Color palette's "Wallpaper colors". */
export const wallColors = () => [...colors];
export const onWallColors = (cb) => (colorListeners.add(cb), () => colorListeners.delete(cb));

function setTone(next) {
  tone = next;
  document.documentElement.dataset.wallTone = next;
  toneListeners.forEach((cb) => cb(next));
}
function setColors(list) {
  colors = distinctColors(list);
  setPaletteColors(colors);
  colorListeners.forEach((cb) => cb(colors));
}

/** Up to four colours that are far enough apart in hue to make different palettes (greys only when nothing else). */
export function distinctColors(list, max = 4) {
  const out = [];
  const hsl = (c) => rgbToHsl(...hexToRgb(c));
  for (const c of list.filter(Boolean)) {
    const [hh, s] = hsl(c);
    if (s < 0.18 && list.some((x) => hsl(x)[1] >= 0.18)) continue;
    if (out.some((o) => { const [h2] = hsl(o); return Math.min(Math.abs(h2 - hh), 360 - Math.abs(h2 - hh)) < 22; })) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out.length ? out : [list.find(Boolean) || '#3e7bff'];
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/** A preset ready to paint (dual presets resolve to their light or dark look). */
export function presetById(id, dark = isDark()) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return p.dual ? { id: p.id, dual: true, ...(dark ? p.dark : p.light) } : p;
}

const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** Paint a preset into any canvas at time t (seconds). Used by the live wallpaper and thumbnails. */
export function paintPreset(c, p, t = 0) {
  const g = c.getContext('2d');
  const { width: w, height: hgt } = c;
  const light = p.tone === 'light';
  const bg = g.createLinearGradient(0, 0, w * 0.3, hgt);
  bg.addColorStop(0, p.base[0]);
  bg.addColorStop(1, p.base[1]);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = bg;
  g.fillRect(0, 0, w, hgt);
  const m = Math.max(w, hgt);
  p.blobs.forEach(([color, x, y, r], i) => {
    const ph = i * 1.7;
    const cx = (x + Math.sin(t * 0.05 + ph) * 0.07 + Math.sin(t * 0.021 + ph * 2) * 0.04) * w;
    const cy = (y + Math.cos(t * 0.043 + ph) * 0.06) * hgt;
    const rr = r * m * (1 + Math.sin(t * 0.03 + ph) * 0.08);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    grad.addColorStop(0, rgba(color, 0.95));
    grad.addColorStop(0.45, rgba(color, 0.45));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(cx, cy, rr * 1.25, rr * 0.85, t * 0.01 + ph, 0, Math.PI * 2);
    g.fill();
  });
  if (p.sun) paintSun(g, w, hgt, m, p.sun, t);
  if (p.shape) SHAPES[p.shape]?.(g, w, hgt, m, p.fx || p.blobs.map((b) => b[0]), t, light);
  // a soft light ribbon sweeping across, One UI 9 style
  g.globalCompositeOperation = light ? 'soft-light' : 'screen';
  const rib = g.createLinearGradient(0, hgt * 0.2, w, hgt * 0.8);
  rib.addColorStop(0, 'rgba(255,255,255,0)');
  rib.addColorStop(0.5, `rgba(255,255,255,${light ? 0.35 : 0.08})`);
  rib.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = rib;
  g.lineWidth = m * 0.12;
  g.lineCap = 'round';
  g.beginPath();
  const s = Math.sin(t * 0.04) * 0.08;
  g.moveTo(-0.1 * w, (0.75 + s) * hgt);
  g.bezierCurveTo(0.3 * w, (0.2 - s) * hgt, 0.65 * w, (1.0 + s) * hgt, 1.1 * w, (0.3 - s) * hgt);
  g.stroke();
  g.globalCompositeOperation = 'source-over';
}

function paintSun(g, w, hgt, m, [sx, sy, sr, c], t) {
  const x = sx * w, y = (sy + Math.sin(t * 0.02) * 0.01) * hgt, r = sr * m;
  const glow = g.createRadialGradient(x, y, r * 0.2, x, y, r * 4.5);
  glow.addColorStop(0, rgba(c, 0.9));
  glow.addColorStop(0.25, rgba(c, 0.35));
  glow.addColorStop(1, rgba(c, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, hgt);
  g.fillStyle = rgba(c, 0.95);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// Shapes for the dual presets, all soft enough to survive the tiny canvas being stretched to the screen.
const SHAPES = {
  // a slowly turning flower of light: Bloom's own motif
  petals(g, w, hgt, m, fx, t, light) {
    const cx = w * 0.5, cy = hgt * 0.44, n = 7, len = m * 0.36, wid = m * 0.13, rot = t * 0.012;
    g.globalCompositeOperation = light ? 'multiply' : 'screen';
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const px = cx + Math.cos(a) * len * 0.52, py = cy + Math.sin(a) * len * 0.52;
      const c = fx[i % fx.length];
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, len * 1.05);
      grad.addColorStop(0, rgba(c, light ? 0.22 : 0.5));
      grad.addColorStop(0.7, rgba(c, light ? 0.12 : 0.22));
      grad.addColorStop(1, rgba(c, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(px, py, len * 0.55, wid * (1 + Math.sin(t * 0.04 + i) * 0.08), a, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
  // three bands of colour rolling in from the bottom
  waves(g, w, hgt, m, fx, t, light) {
    fx.slice(0, 3).forEach((c, i) => {
      const y0 = 0.56 + i * 0.13, amp = 0.045 + i * 0.01, fr = 0.8 + i * 0.35, ph = t * (0.06 + i * 0.02) + i * 1.9;
      const grad = g.createLinearGradient(0, (y0 - amp) * hgt, 0, hgt);
      grad.addColorStop(0, rgba(c, light ? 0.55 : 0.5));
      grad.addColorStop(1, rgba(c, light ? 0.1 : 0.05));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, hgt);
      for (let s = 0; s <= 32; s++) {
        const x = (s / 32) * w;
        g.lineTo(x, (y0 + amp * Math.sin((x / w) * Math.PI * 2 * fr + ph)) * hgt);
      }
      g.lineTo(w, hgt);
      g.closePath();
      g.fill();
    });
  },
  // glowing rings breathing around a point of light
  rings(g, w, hgt, m, fx, t, light) {
    const cx = w * 0.5, cy = hgt * 0.4;
    g.globalCompositeOperation = light ? 'source-over' : 'screen';
    for (let k = 0; k < 6; k++) {
      const r = (0.1 + k * 0.1) * m * (1 + Math.sin(t * 0.05 + k * 0.8) * 0.04);
      g.strokeStyle = rgba(fx[k % fx.length], (light ? 0.3 : 0.32) - k * 0.035);
      g.lineWidth = m * (0.03 - k * 0.003);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  },
  // layered hills at the bottom, drifting very slowly
  hills(g, w, hgt, m, fx, t, light) {
    fx.slice(0, 3).forEach((c, i) => {
      const y0 = 0.62 + i * 0.1, amp = 0.05 - i * 0.008, fr = 0.6 + i * 0.45, ph = t * 0.015 * (i + 1) + i * 2.3;
      g.fillStyle = rgba(c, light ? 0.75 + i * 0.08 : 0.8 + i * 0.06);
      g.beginPath();
      g.moveTo(0, hgt);
      for (let s = 0; s <= 40; s++) {
        const x = (s / 40) * w;
        g.lineTo(x, (y0 + amp * Math.sin((x / w) * Math.PI * 2 * fr + ph) + amp * 0.35 * Math.sin((x / w) * Math.PI * 2 * fr * 2.7 + ph * 1.3)) * hgt);
      }
      g.lineTo(w, hgt);
      g.closePath();
      g.fill();
    });
  },
};

// ——— Creative wallpaper (ported from Liquid Tab's Wallpaper Playground): words → colours → a procedural spec ———
const hashStr = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hslHex = (hh, s, l) => rgbToHex(...hslToRgb(hh, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100));
const hexHsl = (hex) => { const [hh, s, l] = rgbToHsl(...hexToRgb(hex)); return [hh, s * 100, l * 100]; };
const adjust = (hex, { dl = 0, sMul = 1 } = {}) => { const [hh, s, l] = hexHsl(hex); return hslHex(hh, s * sMul, clamp(l + dl, 3, 97)); };

const PALETTES = {
  sunset: ['#ff7e5f', '#feb47b', '#ff5e99', '#7b4397'], ocean: ['#00c6ff', '#0072ff', '#00e0c6', '#1e3c72'],
  forest: ['#56ab2f', '#a8e063', '#134e5e', '#71b280'], night: ['#0f2027', '#203a43', '#2c5364', '#6a5acd'],
  space: ['#1a1446', '#6a11cb', '#2575fc', '#ff6ad5'], desert: ['#e6b980', '#eacda3', '#d38c5a', '#8e5a3c'],
  candy: ['#ffd1dc', '#b5e2fa', '#f9f7b8', '#d6c1ff'], fire: ['#f83600', '#f9d423', '#c31432', '#240b36'],
  ice: ['#e0f7ff', '#a1c4fd', '#c2e9fb', '#5b86e5'], neon: ['#ff00cc', '#333399', '#00f5ff', '#120136'],
  gold: ['#bf953f', '#fcf6ba', '#b38728', '#2a2a2a'], love: ['#ff758c', '#ff7eb3', '#ffc3a0', '#8e2de2'],
  mint: ['#a8ff78', '#78ffd6', '#d4fc79', '#43c6ac'], autumn: ['#d1913c', '#ffd194', '#b24592', '#7f4f24'],
  coffee: ['#c79081', '#dfa579', '#6f4e37', '#f3e7e9'], sky: ['#a1c4fd', '#c2e9fb', '#e0eafc', '#89f7fe'],
  aurora: ['#00c9a7', '#845ec2', '#0a2342', '#2ff3e0'], tropical: ['#f9d423', '#ff4e50', '#00d2ff', '#3ad59f'],
  lavender: ['#c471f5', '#fa71cd', '#a18cd1', '#6a3093'], storm: ['#283c86', '#45a247', '#3a4750', '#606c88'],
  peach: ['#ffecd2', '#fcb69f', '#ff9a8b', '#ff6a88'], mono: ['#d7d2cc', '#304352', '#8e9eab', '#eef2f3'],
};
const WORDS = {
  sunset: 'sunset sunrise dusk dawn evening غروب شروق فجر مساء', ocean: 'ocean sea beach water wave lake river بحر محيط شاطئ ماء موج بحيرة نهر',
  forest: 'forest nature green leaf jungle tree garden غابة طبيعة شجر حديقة', night: 'night midnight dark moon ليل ليلة قمر منتصف',
  space: 'space galaxy star stars cosmic nebula planet فضاء نجوم مجرة كوكب', desert: 'desert sand dune صحراء رمال كثبان',
  candy: 'candy pastel sweet cotton حلوى باستيل', fire: 'fire lava volcano hot flame نار حمم بركان لهب',
  ice: 'ice snow winter frost arctic cold ثلج شتاء جليد بارد', neon: 'neon cyber synthwave retro vapor نيون سايبر',
  gold: 'gold luxury royal golden ذهب ذهبي فخم ملكي', love: 'love rose romantic pink heart حب ورد رومانسي قلب',
  mint: 'mint fresh spring lime نعناع ربيع منعش', autumn: 'autumn fall leaves harvest خريف أوراق',
  coffee: 'coffee latte cozy warm brown chocolate قهوة دافئ بني شوكولاتة', sky: 'sky cloud clouds air calm heaven سماء غيوم سحاب هواء هادئ',
  aurora: 'aurora northern borealis شفق قطبي', tropical: 'tropical summer island palm صيف استوائي جزيرة نخيل',
  lavender: 'lavender purple violet dream lilac خزامى حلم ليلكي', storm: 'storm rain moody thunder عاصفة مطر رعد',
  peach: 'peach apricot coral خوخ مشمش مرجاني', mono: 'mono minimal gray grey black white silver رمادي أسود أبيض فضي بسيط',
};
const COLOR_WORDS = {
  0: 'red أحمر', 28: 'orange برتقالي', 50: 'yellow أصفر', 130: 'green أخضر', 175: 'teal turquoise cyan فيروزي سماوي',
  215: 'blue أزرق', 270: 'purple violet بنفسجي', 325: 'pink magenta وردي',
};
export const GEN_STYLES = ['waves', 'blobs', 'aurora', 'hills', 'glass'];
export const GEN_MOODS = ['vivid', 'calm', 'pastel', 'dark'];
export const GEN_IDEAS = 8; // wall.idea.0 … wall.idea.7

/** Words (English or Arabic) → a { light, dark } pair of procedural specs. Same input, same wallpaper. */
export function generate(prompt, style = 'waves', mood = 'vivid', variant = 0) {
  const text = String(prompt || '').toLowerCase();
  const r = rng(hashStr(text + '|' + style + '|' + mood + '|' + variant));
  let cols = [];
  let starry = false;
  const has = (words) => words.split(' ').some((x) => x && text.includes(x));
  for (const [key, words] of Object.entries(WORDS)) {
    if (!has(words)) continue;
    cols.push(...PALETTES[key]);
    if (key === 'night' || key === 'space' || key === 'aurora') starry = true;
  }
  for (const [hue, words] of Object.entries(COLOR_WORDS)) if (has(words)) cols.push(hslHex(+hue, 85, 60), hslHex(+hue + 20, 80, 45), hslHex(+hue - 15, 90, 72));
  if (!cols.length) {
    const base = text ? hashStr(text) % 360 : Math.floor(r() * 360);
    cols = [hslHex(base, 80, 62), hslHex(base + 40, 75, 55), hslHex(base - 40, 85, 66), hslHex(base + 180, 60, 30)];
  }
  cols = cols.map((c) => [c, r()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]).slice(0, 5);
  while (cols.length < 4) cols.push(cols[cols.length - 1]);
  const moodAdj = { vivid: { sMul: 1.15 }, calm: { sMul: 0.7, dl: 6 }, pastel: { sMul: 0.55, dl: 18 }, dark: { sMul: 0.9, dl: -26 } }[mood] || {};
  const pal = cols.map((c) => adjust(c, moodAdj));
  const darkPal = pal.map((c) => adjust(c, { dl: -30, sMul: 1.05 }));
  const build = (P, dark) => {
    const sorted = [...P].sort((a, b) => hexHsl(b)[2] - hexHsl(a)[2]);
    const spec = { bg: [sorted[0], sorted[1], sorted[sorted.length - 1]] };
    if (starry && (dark || mood === 'dark')) spec.stars = 150;
    if (style === 'blobs' || style === 'glass') spec.blobs = P.slice(0, 4).map((c) => [r(), r(), 0.3 + r() * 0.3, c, 0.5 + r() * 0.3]);
    if (style === 'waves' || style === 'glass') spec.waves = P.slice(0, 3).map((c, i) => [0.35 + i * 0.17 + r() * 0.05, 0.05 + r() * 0.06, 0.6 + r() * 0.7, r() * 6, 0.16 + r() * 0.08, c, P[(i + 1) % P.length], 0.5 + r() * 0.2, style === 'glass' ? 14 : 28]);
    if (style === 'aurora') {
      spec.bg = dark ? ['#020b1a', '#06243a', '#0b0f2e'] : [sorted[0], sorted[1], sorted[2]];
      spec.stars = dark ? 160 : 0;
      spec.waves = P.slice(0, 3).map((c, i) => [0.25 + i * 0.13, 0.1 + r() * 0.05, 0.45 + r() * 0.3, r() * 6, 0.13, c, P[(i + 2) % P.length], 0.55, 26]);
    }
    if (style === 'hills') {
      spec.sun = [0.2 + r() * 0.6, 0.25 + r() * 0.1, 0.06, dark ? '#f5f0ff' : '#fff6d5'];
      spec.hills = [0, 1, 2, 3].map((i) => [0.55 + i * 0.1, 0.04 + r() * 0.03, 0.6 + r() * 1.1, r() * 6, adjust(sorted[Math.min(i, sorted.length - 1)], { dl: -i * 9 - (dark ? 25 : 0) })]);
      if (dark) spec.stars = 120;
    }
    const lum = luminance(...hexToRgb(spec.bg[0])) * 0.5 + luminance(...hexToRgb(spec.bg[1])) * 0.5;
    spec.tone = lum > 0.45 ? 'light' : 'dark';
    spec.colors = distinctColors([...P, ...sorted]);
    return spec;
  };
  return { light: build(pal, false), dark: build(darkPal, true) };
}

/** Paint a Creative wallpaper spec (bg stops, stars, blobs, sun, glass ribbons, hills) at time t (seconds). */
export function paintSpec(c, spec, t = 0) {
  const g = c.getContext('2d');
  const { width: w, height: hh } = c;
  const big = Math.max(w, hh);
  const scale = big / 1600; // blur values are authored for 1600px
  g.save();
  g.filter = 'none';
  g.globalCompositeOperation = 'source-over';
  const bg = g.createLinearGradient(0, 0, w * 0.25, hh);
  const stops = spec.bg || ['#333', '#111'];
  stops.forEach((col, i) => bg.addColorStop(i / Math.max(1, stops.length - 1), col));
  g.fillStyle = bg;
  g.fillRect(0, 0, w, hh);
  if (spec.stars) {
    const r = rng(7);
    for (let i = 0; i < spec.stars; i++) {
      const x = r() * w, y = r() * hh * 0.75, s = (r() * 1.4 + 0.3) * Math.max(0.6, scale * 1.4);
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + r() * 2) + i);
      g.fillStyle = `rgba(255,255,255,${(0.35 + r() * 0.6) * (0.6 + 0.4 * tw)})`;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const [i, [bx, by, br, col, a]] of (spec.blobs || []).entries()) {
    const x = (bx + Math.sin(t * 0.07 + i * 1.7) * 0.06) * w, y = (by + Math.cos(t * 0.05 + i * 2.3) * 0.05) * hh;
    const rr = br * big * (1 + Math.sin(t * 0.06 + i) * 0.06);
    const grad = g.createRadialGradient(x, y, 0, x, y, rr);
    grad.addColorStop(0, rgba(col, a));
    grad.addColorStop(1, rgba(col, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, hh);
  }
  if (spec.sun) paintSun(g, w, hh, big, spec.sun, 0);
  for (const [i, [y0, amp, freq, phase, thick, c1, c2, a, blur]] of (spec.waves || []).entries()) {
    const ph = phase + t * (0.12 + i * 0.03);
    g.filter = `blur(${Math.max(0, blur * scale)}px)`;
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, rgba(c1, a));
    grad.addColorStop(1, rgba(c2, a));
    g.fillStyle = grad;
    g.beginPath();
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const x = (s / steps) * w * 1.2 - w * 0.1;
      const y = (y0 + amp * Math.sin((x / w) * Math.PI * 2 * freq + ph)) * hh;
      if (s) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    for (let s = steps; s >= 0; s--) {
      const x = (s / steps) * w * 1.2 - w * 0.1;
      g.lineTo(x, (y0 + thick + amp * 0.8 * Math.sin((x / w) * Math.PI * 2 * freq * 0.9 + ph + 1.2)) * hh);
    }
    g.closePath();
    g.fill();
  }
  g.filter = 'none';
  for (const [i, [y0, amp, freq, phase, col]] of (spec.hills || []).entries()) {
    const ph = phase + t * 0.02 * (i + 1);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, hh);
    for (let s = 0; s <= 80; s++) {
      const x = (s / 80) * w;
      g.lineTo(x, (y0 + amp * Math.sin((x / w) * Math.PI * 2 * freq + ph) + amp * 0.35 * Math.sin((x / w) * Math.PI * 2 * freq * 2.7 + ph * 1.3)) * hh);
    }
    g.lineTo(w, hh);
    g.closePath();
    g.fill();
  }
  const sheen = g.createLinearGradient(0, 0, 0, hh * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,.06)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, hh);
  g.restore();
}

/** The light or dark spec of a Creative wallpaper. */
export const specOf = (wp, dark = isDark()) => (dark ? wp.spec?.dark : wp.spec?.light) || wp.spec?.light || wp.spec || {};

// ——— your photos (IndexedDB) ———
export const photos = () => (Array.isArray(store.get(PHOTO_KEY)) ? store.get(PHOTO_KEY) : []);
export const photoUrl = (id) => blobUrl('wallpaper:' + id);

/** Adds picture files (downscaled to 2560 px) to the gallery; resolves to the new ids. */
export async function addPhotos(files) {
  const ids = [];
  for (const f of files) {
    try {
      const data = await readImage(f, 2560, 0.9);
      const id = uid();
      await putBlob('wallpaper:' + id, await dataUrlToBlob(data));
      ids.push(id);
    } catch (e) {
      console.warn('wallpaper photo', e);
    }
  }
  if (ids.length) store.set(PHOTO_KEY, [...photos(), ...ids]);
  return ids;
}

/** Removes a photo; a wallpaper that used it goes back to the default (Dynamic Lock screen needs two photos). */
export async function removePhoto(id) {
  const left = photos().filter((x) => x !== id);
  store.set(PHOTO_KEY, left);
  await delBlob('wallpaper:' + id).catch(() => {});
  const s = store.get('settings');
  const gone = (wp) => wp && ((wp.type === 'photo' && wp.id === id) || (wp.type === 'shuffle' && left.length < 2));
  const patch = {};
  if (gone(s.lockWallpaper)) patch.lockWallpaper = null;
  if (gone(s.wallpaper)) patch.wallpaper = left.length ? { type: 'photo', id: left[0] } : DEFAULT_WALL;
  if (Object.keys(patch).length) store.update('settings', (x) => ({ ...x, ...patch }));
}

// ——— which wallpaper goes where ———
/** The Home screen's wallpaper and the Lock screen's (its own, or the same). */
export const homeWall = () => setting('wallpaper') || DEFAULT_WALL;
export const lockWall = () => setting('lockWallpaper') || homeWall();

/** Sets a wallpaper on 'home', 'lock' or 'both' (One UI's "Set as wallpaper" choice). */
export function setWallpaper(wp, where = 'both') {
  store.update('settings', (s) => {
    const home = s.wallpaper || DEFAULT_WALL;
    const next = { ...s };
    if (where === 'home') {
      next.wallpaper = wp;
      next.lockWallpaper = s.lockWallpaper || home;
    } else if (where === 'lock') next.lockWallpaper = wp;
    else {
      next.wallpaper = wp;
      next.lockWallpaper = null;
    }
    if (next.lockWallpaper && JSON.stringify(next.lockWallpaper) === JSON.stringify(next.wallpaper)) next.lockWallpaper = null;
    return next;
  });
}

const sameWall = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
/** Where a wallpaper is in use: 'both', 'home', 'lock' or ''. */
export function usedOn(wp, match = sameWall) {
  const home = match(homeWall(), wp), lock = match(lockWall(), wp);
  return home && lock ? 'both' : home ? 'home' : lock ? 'lock' : '';
}

/** Paints a small preview of any wallpaper into `box` (a canvas for drawn ones, a background picture for photos). */
export function thumbInto(box, wp = DEFAULT_WALL, w = 90, hh = 180) {
  box.style.backgroundImage = '';
  box.style.background = '';
  box.querySelector(':scope > canvas')?.remove();
  delete box.dataset.kind;
  const cv = () => { const c = h('canvas', { width: w, height: hh }); box.prepend(c); return c; };
  if (wp.type === 'preset') paintPreset(cv(), presetById(wp.id), 3);
  else if (wp.type === 'gen') paintSpec(cv(), specOf(wp), 3);
  else if (wp.type === 'color') box.style.background = wp.value;
  else if (wp.type === 'image') box.style.backgroundImage = `url("${store.get('wallpaperImage')}")`;
  else if (wp.type === 'bing' && store.get('bing')?.url) box.style.backgroundImage = `url("${store.get('bing').url}")`;
  else if (wp.type === 'photo' || wp.type === 'shuffle') {
    box.dataset.kind = wp.type;
    const id = wp.type === 'photo' ? wp.id : shuffleId || photos()[0];
    if (id) photoUrl(id).then((u) => u && (box.style.backgroundImage = `url("${u}")`));
  }
  return box;
}

// ——— the live wallpaper ———
const lockedNow = () => document.body.classList.contains('locked');
const animated = () => setting('wallpaperAnimated') && setting('reduceMotion') !== true && !document.hidden && (!covered || setting('wallLiveBehindApps') === true);

function sizeCanvas(crisp) {
  const ar = innerWidth / Math.max(1, innerHeight);
  // drawn presets look best tiny and stretched (free blur); hills need real pixels to keep their edges
  canvas.height = crisp ? Math.min(1080, innerHeight) : current?.kind === 'spec' ? 240 : 160;
  canvas.width = Math.round(canvas.height * ar);
}

function paintNow() {
  if (!current) return;
  const time = (performance.now() - t0) / 1000;
  if (current.kind === 'spec') paintSpec(canvas, current.spec, time);
  else paintPreset(canvas, current.p, time);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const fps = current?.crisp ? 12 : setting('wallSmooth') ? 48 : 24; // drifting light doesn't need more
  if (now - (loop.last || 0) < 1000 / fps) return;
  loop.last = now;
  paintNow();
}

function stop() {
  cancelAnimationFrame(raf);
  raf = null;
}
function syncLoop() {
  if (current && !canvas.hidden && animated()) {
    if (!raf) raf = requestAnimationFrame(loop);
  } else stop();
}

/** The photo Dynamic Lock screen shows next: random, never the one shown last (in any tab). */
function nextShuffle() {
  const ids = photos();
  if (!ids.length) return null;
  let last = null;
  try { last = localStorage.getItem('bt.wallLast'); } catch {}
  const pool = ids.length > 1 ? ids.filter((x) => x !== last) : ids;
  const id = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem('bt.wallLast', id); } catch {}
  return id;
}

/** What's on screen now, for tests: { key, kind, photo, locked }. */
export const wallpaperState = () => ({ key: shownKey, kind: shownKind, photo: $('#wall-img')?.dataset.photo || null, locked: lockedNow(), animating: !!raf });

async function render(force = false) {
  let wp = lockedNow() ? lockWall() : homeWall();
  if (wp.type === 'shuffle' && !shuffleId) shuffleId = nextShuffle();
  const dark = isDark();
  const key = JSON.stringify([wp, wp.type === 'shuffle' ? shuffleId : null, (wp.type === 'gen' || PRESETS.find((p) => p.id === wp.id)?.dual) && dark]);
  if (!force && key === shownKey) return syncLoop(); // already showing (or loading) it: a newer render would cancel it
  const my = ++seq;
  shownKey = key;
  const img = $('#wall-img');
  const wall = document.getElementById('wallpaper');
  stop();

  if (wp.type === 'image' || wp.type === 'bing' || wp.type === 'photo' || wp.type === 'shuffle') {
    const id = wp.type === 'photo' ? wp.id : wp.type === 'shuffle' ? shuffleId : null;
    const url = wp.type === 'image' ? store.get('wallpaperImage') : wp.type === 'bing' ? await bingUrl() : id ? await photoUrl(id).catch(() => null) : null;
    if (my !== seq) return;
    if (url) {
      const objUrl = await toLocalUrl(url);
      const pic = await new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = objUrl;
      });
      if (my !== seq) return;
      if (pic) {
        current = null;
        canvas.hidden = true;
        wall.style.background = '';
        img.style.backgroundImage = `url("${objUrl}")`;
        img.dataset.photo = id || '';
        shownKind = 'photo';
        analyseImage(pic);
        img.classList.add('show');
        return;
      }
    }
    // the picture is gone (or Bing can't be reached): the default wallpaper, saved for older types as before
    if (wp.type === 'image' || wp.type === 'bing') {
      if (!lockedNow() || !setting('lockWallpaper')) setSetting('wallpaper', DEFAULT_WALL);
      else setSetting('lockWallpaper', null);
      return;
    }
    wp = DEFAULT_WALL;
  }

  img.style.backgroundImage = '';
  img.classList.remove('show');
  delete img.dataset.photo;
  wall.style.background = '';
  if (wp.type === 'color') {
    current = null;
    shownKind = 'color';
    canvas.hidden = true;
    wall.style.background = wp.value;
    const [r, g, b] = hexToRgb(wp.value);
    setTone(luminance(r, g, b) > 0.45 ? 'light' : 'dark');
    const [hh, s, l] = rgbToHsl(r, g, b);
    setColors([wp.value, ...[30, -30, 180].map((d) => rgbToHex(...hslToRgb(hh + d, Math.max(0.35, s), Math.min(0.6, Math.max(0.4, l)))))]);
    return;
  }
  if (wp.type === 'gen') {
    const spec = specOf(wp, dark);
    current = { kind: 'spec', spec, crisp: !!spec.hills };
    setTone(spec.tone || 'dark');
    setColors(spec.colors || spec.bg || []);
  } else {
    const p = presetById(wp.id, dark);
    current = { kind: 'preset', p };
    setTone(p.tone);
    setColors([p.accent, ...p.blobs.map((b) => b[0]), ...(p.fx || [])]);
  }
  shownKind = current.kind;
  canvas.hidden = false;
  sizeCanvas(current.crisp);
  paintNow();
  syncLoop();
}

/** Bing images need fetching through the extension (host permission) to be readable by canvas. */
async function toLocalUrl(url) {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const blob = await (await fetch(url)).blob();
    return URL.createObjectURL(blob);
  } catch {
    return url;
  }
}

function analyseImage(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lumSum = 0, lumTop = 0, n = 0;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const lum = luminance(r, gg, b);
      lumSum += lum;
      if (i / 4 < c.width * 12) lumTop += lum; // top area, where the clock sits
      n++;
      const [hh, s, l] = rgbToHsl(r, gg, b);
      if (s < 0.2 || l < 0.12 || l > 0.9) continue;
      const key = Math.round(hh / 20);
      const bk = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, s: 0 };
      bk.count++;
      bk.r += r;
      bk.g += gg;
      bk.b += b;
      bk.s += s;
      buckets.set(key, bk);
    }
    const ranked = [...buckets.values()].sort((a, b) => b.count * (b.s / b.count) - a.count * (a.s / a.count));
    setColors(ranked.length ? ranked.map((bk) => rgbToHex(bk.r / bk.count, bk.g / bk.count, bk.b / bk.count)) : ['#3e7bff']);
    const topAvg = lumTop / (c.width * 12);
    setTone(topAvg > 0.55 && lumSum / n > 0.45 ? 'light' : 'dark');
  } catch {
    setTone('dark');
  }
}

/** Bing photo of the day, cached per day in store 'bing'. */
export async function bingUrl() {
  const today = new Date().toISOString().slice(0, 10);
  const cached = store.get('bing');
  if (cached?.date === today && cached.url) return cached.url;
  try {
    const mkt = navigator.language || 'en-US';
    const r = await fetch(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=${encodeURIComponent(mkt)}`);
    const j = await r.json();
    const im = j.images?.[0];
    if (!im) throw new Error('no image');
    const url = 'https://www.bing.com' + im.urlbase + '_UHD.jpg';
    store.set('bing', { date: today, url, title: im.title, copyright: im.copyright });
    return url;
  } catch (e) {
    console.warn('bing', e);
    return cached?.url || null;
  }
}

/** Labs › "New Creative wallpaper every day": a fresh variant of the same description each day. */
function dailyCreative() {
  if (!setting('genDaily')) return;
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60e3) / 86400e3);
  const fresh = (wp) => (wp?.type === 'gen' && wp.day !== day ? { ...wp, spec: generate(wp.prompt || '', wp.style, wp.mood, day), day } : null);
  const home = fresh(setting('wallpaper')), lock = fresh(setting('lockWallpaper'));
  if (home || lock) store.update('settings', (s) => ({ ...s, ...(home && { wallpaper: home }), ...(lock && { lockWallpaper: lock }) }));
}

/** Older versions kept the photo as a data URL in chrome.storage: move it to the photo gallery (IndexedDB). */
async function migrateImage() {
  const data = store.get('wallpaperImage');
  if (!data || typeof data !== 'string' || !data.startsWith('data:')) return;
  const id = uid();
  await putBlob('wallpaper:' + id, await dataUrlToBlob(data));
  store.set(PHOTO_KEY, [...photos(), id]);
  const fix = (wp) => (wp?.type === 'image' ? { type: 'photo', id } : wp);
  store.update('settings', (s) => ({ ...s, wallpaper: fix(s.wallpaper) || DEFAULT_WALL, ...(s.lockWallpaper && { lockWallpaper: fix(s.lockWallpaper) }) }));
  store.remove('wallpaperImage');
}

export function initWallpaper() {
  canvas = $('#wall-canvas');
  const wall = document.getElementById('wallpaper');
  // Dark mode wallpaper dimming lives on its own layer, so it covers the Lock screen too (#wall-dim is Home only)
  const darkDim = h('div', { id: 'wall-dark', style: { position: 'absolute', inset: '0', pointerEvents: 'none', background: 'rgba(0,0,0,0.32)', opacity: '0', transition: 'opacity 400ms' } });
  wall.append(darkDim);
  dailyCreative();
  render();
  const again = () => render();
  for (const k of ['wallpaper', 'lockWallpaper']) onSetting(k, again);
  onSetting('wallpaperAnimated', syncLoop);
  onSetting('wallLiveBehindApps', syncLoop);
  onSetting('reduceMotion', syncLoop);
  onSetting('genDaily', dailyCreative);
  store.on('wallpaperImage', () => (homeWall().type === 'image' || lockWall().type === 'image') && render(true));
  store.on(PHOTO_KEY, () => (lockWall().type === 'shuffle' || homeWall().type === 'shuffle') && !photos().includes(shuffleId) && ((shuffleId = null), render()));
  migrateImage().catch((e) => console.warn('wallpaper migrate', e));
  // Lock screen: its own wallpaper, and Dynamic Lock screen picks another photo every time it shows
  let wasLocked = lockedNow();
  new MutationObserver(() => {
    const now = lockedNow();
    if (now === wasLocked) return;
    wasLocked = now;
    if (now && lockWall().type === 'shuffle') shuffleId = null;
    render();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // dual presets and Creative wallpapers have a light and a dark look; the dimming follows Dark mode too
  const applyDark = () => (darkDim.style.opacity = isDark() && setting('wallpaperDarkDim') ? '1' : '0');
  new MutationObserver(() => (applyDark(), render())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  onSetting('wallpaperDarkDim', applyDark);
  applyDark();
  // live wallpapers pause while app windows cover the Home screen (Labs can keep them moving)
  import('../core/apps.js').then((m) => m.onWindowsChange(() => {
    covered = m.openWindows().some((x) => !x.minimized);
    syncLoop();
  })).catch(() => {});
  addEventListener('resize', () => {
    if (current && !canvas.hidden) {
      sizeCanvas(current.crisp);
      paintNow();
    }
  });
  document.addEventListener('visibilitychange', syncLoop);
  applyDim();
  onSetting('wallpaperDim', applyDim);
  onSetting('wallpaperBlurHome', applyDim);
}

function applyDim() {
  const d = $('#wall-dim');
  d.style.background = `rgba(0,0,0,${(setting('wallpaperDim') || 0) / 100})`;
  document.getElementById('wallpaper').classList.toggle('blur-home', !!setting('wallpaperBlurHome'));
}

// preset names (also used by Modes and Routines and Finder) and the Creative wallpaper's ideas
addStrings({
  en: {
    'wall.bloom': 'Bloom', 'wall.dawn': 'Dawn', 'wall.aurora': 'Aurora', 'wall.sunset': 'Sunset', 'wall.ocean': 'Ocean', 'wall.mint': 'Mint',
    'wall.graphite': 'Graphite', 'wall.lavender': 'Lavender', 'wall.ember': 'Ember', 'wall.forest': 'Forest', 'wall.sand': 'Sand', 'wall.midnight': 'Midnight',
    'wall.petal': 'Petal', 'wall.lagoon': 'Lagoon', 'wall.citrus': 'Citrus', 'wall.iris': 'Iris', 'wall.glacier': 'Glacier', 'wall.coral': 'Coral',
    'wall.nebula': 'Nebula', 'wall.meadow': 'Meadow', 'wall.dune': 'Dune', 'wall.horizon': 'Horizon',
    'wall.idea.0': 'sunset over the ocean', 'wall.idea.1': 'northern lights', 'wall.idea.2': 'desert dunes at dusk', 'wall.idea.3': 'cotton candy sky',
    'wall.idea.4': 'deep space nebula', 'wall.idea.5': 'mint and lavender', 'wall.idea.6': 'golden hour forest', 'wall.idea.7': 'neon city night',
  },
  ar: {
    'wall.bloom': 'تفتّح', 'wall.dawn': 'فجر', 'wall.aurora': 'شفق', 'wall.sunset': 'غروب', 'wall.ocean': 'محيط', 'wall.mint': 'نعناع',
    'wall.graphite': 'جرافيت', 'wall.lavender': 'لافندر', 'wall.ember': 'جمر', 'wall.forest': 'غابة', 'wall.sand': 'رمل', 'wall.midnight': 'منتصف الليل',
    'wall.petal': 'بتلة', 'wall.lagoon': 'بحيرة', 'wall.citrus': 'حمضيات', 'wall.iris': 'سوسن', 'wall.glacier': 'نهر جليدي', 'wall.coral': 'مرجان',
    'wall.nebula': 'سديم', 'wall.meadow': 'مرج', 'wall.dune': 'كثيب', 'wall.horizon': 'أفق',
    'wall.idea.0': 'غروب فوق المحيط', 'wall.idea.1': 'الشفق القطبي', 'wall.idea.2': 'كثبان الصحراء عند الغسق', 'wall.idea.3': 'سماء غزل البنات',
    'wall.idea.4': 'سديم في الفضاء البعيد', 'wall.idea.5': 'نعناع وخزامى', 'wall.idea.6': 'غابة في الساعة الذهبية', 'wall.idea.7': 'ليل مدينة نيون',
  },
});
