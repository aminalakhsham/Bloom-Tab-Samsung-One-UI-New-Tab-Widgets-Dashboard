// Galaxy Store site icons, drawn here instead of fetched: a One UI squircle coloured from the site's category (shifted a
// little by its name, so neighbours differ) with Chrome's own favicon on a light tint, or the first letter on a vivid
// gradient when Chrome has no icon for the site. Nothing is loaded from the network: `faviconUrl()` reads Chrome's
// favicon cache through the `favicon` permission.
import { h, faviconUrl, hexToRgb, rgbToHsl } from '../core/util.js';
import { CATS } from './model.js';

const known = new Map(); // host -> true (Chrome has a real icon) | false (only the generic globe)
const generic = new Map(); // requested size -> Promise<fingerprint of Chrome's "no favicon" globe>

/** Tiny fingerprint of an image, to spot Chrome's generic globe (it is what an unknown page gets). */
function fingerprint(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 12, 12);
    const d = g.getImageData(0, 0, 12, 12).data;
    let out = '';
    for (let i = 0; i < d.length; i += 4) out += ((d[i] >> 5) << 6 | (d[i + 3] >> 5) << 3 | (d[i + 2] >> 5)).toString(36);
    return out;
  } catch {
    return null;
  }
}
function genericPrint(size) {
  if (!generic.has(size)) {
    generic.set(size, new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(fingerprint(i));
      i.onerror = () => resolve(null);
      i.src = faviconUrl('https://bloom-tab-no-favicon.invalid/', size);
    }));
  }
  return generic.get(size);
}

function hashOf(s) {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x;
}
/** Hue of the site's icon: its category's hue, moved up to ±18° by its name. */
export function hueOf(app) {
  const [hue] = rgbToHsl(...hexToRgb((CATS[app.cat] || CATS.other).color));
  return Math.round((hue + (hashOf(app.site || app.host || '') % 37) - 18 + 360) % 360);
}
const initial = (app) => (Array.from(String(app.label || app.name || app.host || '?').trim())[0] || '?').toUpperCase();

/**
 * The icon element for a catalog site (or any { site, host, name, label, cat, url }): starts as the letter tile and
 * turns into the favicon tile once Chrome's icon has loaded and isn't the generic globe.
 */
export function siteIcon(app, size = 56) {
  const el = h('span', { class: 'gs-ic letter', style: { '--sz': size + 'px', '--h': hueOf(app) }, 'aria-hidden': 'true' },
    h('span', { class: 'gs-ic-letter' }, initial(app)));
  const host = app.host;
  if (known.get(host) === false) return el;
  const px = size > 64 ? 128 : 64;
  const img = h('img', { alt: '', draggable: 'false', decoding: 'async', loading: 'lazy' });
  const show = () => {
    el.classList.remove('letter');
    el.classList.add('fav');
  };
  if (known.get(host)) show();
  img.onload = async () => {
    if (known.has(host)) return known.get(host) ? show() : img.remove();
    const gen = await genericPrint(px);
    const real = img.naturalWidth > 1 && !(gen && fingerprint(img) === gen);
    known.set(host, real);
    if (real) show();
    else img.remove();
  };
  img.onerror = () => {
    known.set(host, false);
    img.remove();
  };
  img.src = faviconUrl(app.url, px);
  el.appendChild(img);
  return el;
}
