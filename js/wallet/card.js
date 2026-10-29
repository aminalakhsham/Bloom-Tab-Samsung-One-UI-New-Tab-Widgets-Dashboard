// How a Samsung Wallet pass looks: the card face (Quick access stack, category grids, widgets, the top of the detail
// page). The barcode panel and the full-screen barcode are in bright.js, so the widgets don't load the encoders.
// The card face is one HTML string whose text scales with its width (container query units), so the same markup
// serves a 150 px widget and a 420 px detail card.
import { escapeHtml as esc, hexToRgb, luminance, $$ } from '../core/util.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { blobUrl } from '../core/blobs.js';
import * as M from './model.js';
import { kindInfo, kindOne, passDateText, longDate } from './format.js';
import './symbols.js';

export const TRANSIT_ICON = { air: 'airplane', train: 'wl-train', bus: 'wl-bus', boat: 'wl-boat' };

/** Text colour: the pass's own, else black or white, whichever reads better on the background (white over a picture). */
export function passColors(p) {
  const light = !p.art && luminance(...hexToRgb(p.bg)) > 0.42;
  return { bg: p.bg, fg: p.fg || (light ? '#111114' : '#ffffff'), light: p.fg ? luminance(...hexToRgb(p.fg)) < 0.3 : light };
}
const img = (id, cls) => (id ? `<img class="${cls}" data-blob="${esc(id)}" alt="">` : '');

/** The front of a pass as a card. `opts.cls` adds classes (e.g. "mini"); `opts.tag` is the element ('div' or 'button'). */
export function cardHTML(p, { cls = '', tag = 'div', attrs = '' } = {}) {
  const c = passColors(p), k = kindInfo(p.kind);
  const logo = p.logo ? `<span class="wl-cf-logo pic">${img(p.logo, '')}</span>` : `<span class="wl-cf-logo">${icon(k.icon, 20)}</span>`;
  const hdr = p.header.slice(0, 2).map((f) => `<span class="wl-cf-hdr"><small>${esc(f.l)}</small><b>${esc(f.v)}</b></span>`).join('');
  let mid;
  if (p.kind === 'boarding') {
    const [a, b] = p.primary;
    const end = (f) => `<span class="wl-cf-end"><b>${esc(f?.v) || '—'}</b><small>${esc(f?.l)}</small></span>`;
    mid = `<div class="wl-cf-route">${end(a)}<span class="wl-cf-plane">${icon(TRANSIT_ICON[p.transit] || 'airplane', 22)}</span>${end(b)}</div>`;
  } else {
    const f = p.primary[0];
    mid = `<div class="wl-cf-main">${f?.l ? `<small>${esc(f.l)}</small>` : ''}<b>${esc(f?.v || '')}</b></div>${p.photo ? `<span class="wl-cf-photo">${img(p.photo, '')}</span>` : ''}`;
  }
  const footL = p.date ? passDateText(p) : p.expires ? t('wallet.validUntil', { date: longDate(p.expires) }) : p.secondary[0]?.v || '';
  const footR = p.kind === 'boarding' ? p.aux.find((f) => f.v) : p.kind === 'ticket' ? p.aux.find((f) => f.v) : null;
  return `<${tag} class="wl-cf k-${p.kind} ${c.light ? 'light' : ''} ${p.art ? 'has-art' : ''} ${cls}" style="--pbg:${esc(c.bg)};--pfg:${esc(c.fg)}" ${attrs}>
    ${p.art ? `<span class="wl-cf-art">${img(p.art, '')}</span>` : ''}
    <span class="wl-cf-top">${logo}<span class="wl-cf-name">${esc(p.name || kindOne(p.kind))}</span>${hdr}</span>
    <span class="wl-cf-mid">${mid}</span>
    <span class="wl-cf-foot"><span>${esc(footL)}</span>${footR ? `<span class="wl-cf-fr"><small>${esc(footR.l)}</small> ${esc(footR.v)}</span>` : ''}</span>
  </${tag}>`;
}

/** Loads the pictures of the passes inside `root` from IndexedDB (a missing one hides). */
export function hydrate(root) {
  for (const im of $$('img[data-blob]', root)) {
    if (im.getAttribute('src')) continue;
    blobUrl(im.dataset.blob).then((u) => {
      if (u) im.src = u;
      else {
        im.closest('.wl-cf')?.classList.remove('has-art');
        (im.closest('.wl-cf-art, .wl-cf-photo') || im).remove();
      }
    }).catch(() => {});
  }
}

/** The fields of a pass for the detail page, in reading order, without empty ones. */
export function detailFields(p) {
  const list = [...(p.kind === 'boarding' ? [] : p.primary), ...p.header, ...p.secondary, ...p.aux];
  return list.filter((f) => f.v);
}
export const isLive = (p) => !M.isExpired(p);
