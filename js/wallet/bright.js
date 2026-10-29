// The barcode of a pass: the white panel on the detail page, and the barcode full screen with the screen's own dimming
// lifted (Brightness, Eye comfort shield) and the screen kept awake, like Samsung Wallet does for a scanner at the gate
// or the till.
import { escapeHtml as esc } from '../core/util.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { barcodeSVG, isSquare } from './barcode.js';
import { kindOne } from './format.js';

/** The barcode panel of the detail page (a white card; a click opens it full screen). */
export function codePanelHTML(p) {
  const svg = p.code.type && p.code.msg ? barcodeSVG(p.code.type, p.code.msg) : '';
  if (!svg) return '';
  return `<button class="wl-codepanel ${isSquare(p.code.type) ? 'sq' : 'wide'}" data-act="bright" aria-label="${esc(t('wallet.showCode'))}">
    <span class="wl-codebox">${svg}</span>${p.code.alt ? `<span class="wl-alt">${esc(p.code.alt)}</span>` : ''}
    <span class="wl-codehint">${icon('wl-sun', 16)}${esc(t('wallet.tapCode'))}</span></button>`;
}

/**
 * The barcode on a white screen, as large as it fits, with the screen's own dimming (Brightness, Eye comfort shield)
 * lifted while it shows and the screen kept awake, like Samsung Wallet does for a scanner. Returns close().
 */
export function brightness(p) {
  const svg = barcodeSVG(p.code.type, p.code.msg);
  if (!svg) return null;
  const node = document.createElement('div');
  node.className = 'wl-bright';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', t('wallet.showCode'));
  node.innerHTML = `<div class="wl-bright-in"><div class="wl-bright-t">${esc(p.name || kindOne(p.kind))}</div>
    <div class="wl-bright-code ${isSquare(p.code.type) ? 'sq' : 'wide'}">${svg}</div>
    ${p.code.alt ? `<div class="wl-bright-alt">${esc(p.code.alt)}</div>` : ''}
    <div class="wl-bright-note">${icon('wl-sun', 16)}${esc(t('wallet.brightNote'))}</div>
    <button class="wl-bright-close">${esc(t('common.close'))}</button></div>`;
  (document.getElementById('overlay-layer') || document.body).appendChild(node);
  const filters = document.getElementById('screen-filters');
  const prevVis = filters?.style.visibility;
  if (filters) filters.style.visibility = 'hidden';
  let lock = null;
  navigator.wakeLock?.request('screen').then((l) => { lock = l; }, () => {});
  requestAnimationFrame(() => node.classList.add('show'));
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  addEventListener('keydown', onKey, true);
  node.addEventListener('click', () => close());
  setTimeout(() => node.querySelector('.wl-bright-close')?.focus(), 40);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    if (filters) filters.style.visibility = prevVis || '';
    lock?.release().catch(() => {});
    node.classList.remove('show');
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }
  return close;
}
