// Light/dark, blur, motion, Accessibility (high contrast fonts, font size) and the accent colour (One UI "Color
// palette": one of the wallpaper's colours, or a basic colour).
//   settings.accent: 'auto' (the wallpaper's main colour) | 'wall:<n>' (its n-th colour) | '#hex' (a basic colour)
//   settings.highContrast: true → html[data-contrast=high];  settings.textScale: 85…150 (%) → --text-scale (tokens.css)
import { store } from '../core/store.js';
import { hexToRgb, rgbToHsl, hslToRgb, rgbToHex, luminance } from '../core/util.js';

let paletteColors = ['#3e7bff'];
const mq = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const s = store.get('settings');
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && mq.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.blur = s.blur ? 'on' : 'off';
  root.dataset.motion = s.reduceMotion ? 'reduce' : 'full';
  if (s.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  const scale = Math.max(80, Math.min(160, +s.textScale || 100));
  if (scale !== 100) {
    root.dataset.textSize = String(scale);
    root.style.setProperty('--text-scale', String(scale / 100));
  } else {
    delete root.dataset.textSize;
    root.style.removeProperty('--text-scale');
  }
  applyAccent();
}

/** Called by the wallpaper module with the wallpaper's main colours (best first). */
export function setPaletteColors(list) {
  if (list?.length) paletteColors = list.filter(Boolean);
  applyAccent();
}
/** One colour (pages without the wallpaper module's analysis, e.g. the sheets over websites). */
export const setPaletteColor = (hex) => setPaletteColors(hex ? [hex] : null);
export const paletteSource = () => [...paletteColors];

/** The colour the accent is made from for an accent setting value. */
export function accentBase(value = store.get('settings').accent) {
  if (typeof value === 'string' && value.startsWith('wall:')) return paletteColors[+value.slice(5)] || paletteColors[0];
  return !value || value === 'auto' ? paletteColors[0] : value;
}

/** Turn any colour into a usable One UI accent: vivid, mid-lightness, readable with white text. */
export function toAccent(hex, dark = document.documentElement.dataset.theme === 'dark') {
  const [r, g, b] = hexToRgb(hex);
  let [hh, sat, l] = rgbToHsl(r, g, b);
  if (sat < 0.12) return dark ? '#8ab4ff' : '#3e7bff'; // greys -> default blue
  sat = Math.max(0.55, Math.min(0.92, sat));
  l = dark ? Math.max(0.6, Math.min(0.7, l)) : Math.max(0.46, Math.min(0.56, l));
  let rgb = hslToRgb(hh, sat, l);
  // keep white text readable in light mode
  while (!dark && luminance(...rgb) > 0.32 && l > 0.3) {
    l -= 0.03;
    rgb = hslToRgb(hh, sat, l);
  }
  return rgbToHex(...rgb);
}

function applyAccent() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const hex = toAccent(accentBase(), dark);
  const [r, g, b] = hexToRgb(hex);
  const st = document.documentElement.style;
  st.setProperty('--accent', hex);
  st.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  st.setProperty('--on-accent', dark && luminance(r, g, b) > 0.45 ? '#0b0b0f' : '#ffffff');
}

export const currentAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

mq.addEventListener('change', applyTheme);
store.on('settings', applyTheme);
