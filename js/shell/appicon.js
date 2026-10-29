// Icons for home-screen items (sites, built-in apps, folders) + opening them.
import { h, faviconUrl, hostname, siteName, rgbToHsl, hslToRgb, rgbToHex } from '../core/util.js';
import { getApp, appIconEl, appName, openApp } from '../core/apps.js';
import { store, setting, trackUsage } from '../core/store.js';
import { badgeCount } from '../core/activity.js';

const colorCache = new Map(); // host -> { hue, sat, light, solid } | null

/** Tiny fingerprint of an image, used to spot Chrome's generic "no favicon" globe. */
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

// Ask for the favicon of a page that can't exist; whatever comes back is the generic icon.
const genericIcon = new Promise((resolve) => {
  const i = new Image();
  i.onload = () => resolve(fingerprint(i));
  i.onerror = () => resolve(null);
  i.src = faviconUrl('https://bloom-tab-no-favicon.invalid/', 64);
});

/** Sample a favicon: dominant hue, and whether it is a full-bleed square (no transparency). */
function sampleFavicon(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gg = 0, b = 0, n = 0, opaqueCorners = 0;
    for (const [x, y] of [[1, 1], [22, 1], [1, 22], [22, 22]]) if (d[(y * 24 + x) * 4 + 3] > 230) opaqueCorners++;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const w = s > 0.25 && l > 0.15 && l < 0.85 ? 4 : 1; // prefer colourful pixels
      r += d[i] * w;
      gg += d[i + 1] * w;
      b += d[i + 2] * w;
      n += w;
    }
    if (!n) return null;
    const [hue, sat, light] = rgbToHsl(r / n, gg / n, b / n);
    return { hue, sat, light, solid: opaqueCorners === 4 };
  } catch {
    return null;
  }
}

function letterIcon(el, item) {
  const name = item.title || siteName(item.url);
  let hash = 0;
  for (const ch of hostname(item.url)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  el.classList.add('letter');
  el.style.background = `linear-gradient(145deg, hsl(${hue} 70% 62%), hsl(${(hue + 30) % 360} 72% 48%))`;
  el.replaceChildren(h('span', { class: 'app-letter' }, (name || '?').trim().charAt(0).toUpperCase()));
}

function paintSiteBg(el, info) {
  if (!info) return;
  const style = setting('iconStyle');
  if (style === 'themed') return;
  const dark = style === 'dark';
  if (info.solid) {
    // full-bleed favicons (already have their own background): let them fill the squircle
    el.classList.add('solid');
    return;
  }
  const sat = Math.min(0.75, info.sat);
  const bg = dark ? hslToRgb(info.hue, sat * 0.35, 0.16) : hslToRgb(info.hue, sat * 0.55, 0.95);
  const bg2 = dark ? hslToRgb(info.hue, sat * 0.4, 0.1) : hslToRgb(info.hue, sat * 0.6, 0.89);
  el.style.background = `linear-gradient(160deg, ${rgbToHex(...bg)}, ${rgbToHex(...bg2)})`;
}

export function siteIconEl(item) {
  const el = h('span', { class: 'app-icon site' });
  // the user's own picture, else the site's touch icon kept by Add to Home screen (js/anytab/clip.js, `clipIcons`)
  const own = item.icon || store.get('clipIcons')?.[item.url];
  if (own) {
    el.classList.add('solid');
    el.appendChild(h('img', { src: own, alt: '', draggable: 'false' }));
    return el;
  }
  const host = hostname(item.url);
  const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
  img.onload = async () => {
    if (img.naturalWidth <= 1) return letterIcon(el, item);
    let info = colorCache.get(host);
    if (info === undefined) {
      // Chrome's generic globe = no favicon cached for this site -> use a letter tile instead
      const generic = await genericIcon;
      info = generic && fingerprint(img) === generic ? null : sampleFavicon(img);
      colorCache.set(host, info);
    }
    if (!info) return letterIcon(el, item);
    paintSiteBg(el, info);
    el.classList.add('loaded');
  };
  img.onerror = () => letterIcon(el, item);
  img.src = faviconUrl(item.url, 64);
  el.appendChild(img);
  return el;
}

export function folderIconEl(item) {
  const el = h('span', { class: 'app-icon folder', style: item.color ? { '--folder': item.color } : null });
  const grid = h('span', { class: 'folder-grid' });
  (item.items || []).slice(0, 4).forEach((it) => grid.appendChild(itemIconEl(it)));
  el.appendChild(grid);
  return el;
}

export function itemIconEl(item) {
  if (item.type === 'app') {
    const app = getApp(item.app);
    return app ? appIconEl(app) : h('span', { class: 'app-icon missing' });
  }
  if (item.type === 'folder') return folderIconEl(item);
  return siteIconEl(item);
}

// ——— app icon badges (Settings › Home screen › App icon badges: number, dot or off) ———
export const badgeMode = () => setting('badges') ?? 'number';

/** What an item's icon shows: an app's count, a folder's total (sites have none). */
export function itemBadge(item) {
  if (!item || badgeMode() === 'off') return 0;
  if (item.type === 'app') return badgeCount(item.app);
  if (item.type === 'folder') return (item.items || []).reduce((n, x) => n + (x.type === 'app' ? badgeCount(x.app) : 0), 0);
  return 0;
}

/** Puts (or updates, or removes) the badge on an icon's holder (.tile-icon). */
export function paintBadge(host, n) {
  if (!host) return;
  let b = host.querySelector(':scope > .app-badge');
  if (!n) return b?.remove();
  const dot = badgeMode() === 'dot';
  if (!b) b = host.appendChild(h('span', { class: 'app-badge', 'aria-hidden': 'true' }));
  b.classList.toggle('dot', dot);
  b.textContent = dot ? '' : n > 99 ? '99+' : String(n);
}

export function itemLabel(item) {
  if (item.type === 'app') return getApp(item.app) ? appName(item.app) : item.app;
  if (item.type === 'folder') return item.title || '';
  return item.title || siteName(item.url);
}

/** Open a site/app. Ctrl/Cmd/middle-click or the "open in new tab" setting opens a new tab. */
export function openItem(item, fromEl, e) {
  if (item.type === 'app') return openApp(item.app, { from: fromEl });
  if (item.type !== 'site') return;
  trackUsage('site:' + item.url);
  // "Open as web app" (Add to Home screen): a window of its own without tabs, unless a new tab was asked for
  if (item.webApp && !(e && (e.ctrlKey || e.metaKey || e.button === 1 || e.shiftKey))) return import('../anytab/webapp.js').then((m) => m.openWebApp(item.url));
  openUrl(item.url, e);
}

export function openUrl(url, e) {
  const newTab = e && (e.ctrlKey || e.metaKey || e.button === 1 || e.shiftKey);
  if (newTab || setting('openLinks') === 'new') {
    if (globalThis.chrome?.tabs) chrome.tabs.create({ url, active: !(e?.ctrlKey || e?.metaKey || e?.button === 1) });
    else window.open(url, '_blank', 'noopener');
  } else {
    document.body.classList.add('leaving');
    location.href = url;
  }
}

