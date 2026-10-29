// Shared start-up for the sheets Bloom Tab shows over any website (addsite.html, capture.html; see js/bg/anytab.js):
// storage, language and theme (with the wallpaper's accent, as on the Home screen), the token hand-over from the
// service worker, and the messages to the page that framed the sheet.
import { store, setting } from '../core/store.js';
import { detectLang, setLang } from '../core/i18n.js';
import { applyTheme, setPaletteColor } from '../shell/theme.js';
import { presetById } from '../shell/wallpaper.js';
import './strings.js';

/** True when the sheet is framed over a website; false in a pop-up window of its own. */
export const framed = window.top !== window;

/** Tells the page that framed the sheet: 'ready' (show the frame), 'pass' (only a toast is left: let clicks through), 'close'. */
export const say = (bt, more) => {
  if (framed) parent.postMessage({ bt, ...more }, '*');
};

export async function bootSheet() {
  await store.init();
  setLang(detectLang());
  applyTheme();
  accentFromWallpaper();
  document.documentElement.classList.add(framed ? 'at-frame' : 'at-window');
}

/** One UI's Color palette follows the wallpaper; preset and solid wallpapers know their colour without drawing them. */
export function accentFromWallpaper() {
  const wp = setting('wallpaper') || {};
  if (wp.type === 'preset') setPaletteColor(presetById(wp.id).accent);
  else if (wp.type === 'color' && wp.value) setPaletteColor(wp.value);
}

/** What the service worker left for this sheet under its token (`prefix:<uuid>`); with `once` it is forgotten at once. */
export async function takeToken(prefix, token, { once = false } = {}) {
  if (!/^[\w-]{16,}$/.test(token || '') || !globalThis.chrome?.storage?.session) return null;
  const key = prefix + ':' + token;
  const v = (await chrome.storage.session.get(key))[key] || null;
  if (once) chrome.storage.session.remove(key).catch(() => {});
  return v;
}
export const dropToken = (prefix, token) => globalThis.chrome?.storage?.session?.remove(prefix + ':' + token).catch(() => {});

/** A window of its own closes itself (through the tabs API, since a page may only close windows it opened). */
export function closeSelf() {
  try {
    chrome.tabs.getCurrent((tb) => (tb ? chrome.tabs.remove(tb.id) : window.close()));
  } catch {
    window.close();
  }
}
/** Ends the sheet after `ms`: the frame is removed by the page, a window closes itself. */
export const finish = (ms) => setTimeout(() => (framed ? say('close') : closeSelf()), ms);

/** "example.com/path" for display. */
export const prettyUrl = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
