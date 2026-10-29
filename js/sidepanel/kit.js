// Small pieces shared by the side panel's tabs: the One UI header, opening a Bloom Tab app in a tab, and dates.
import { h, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime } from '../core/i18n.js';

/** One UI app header for a narrow window: the title (and a subtitle) at the start, action buttons at the end. */
export function header({ title, sub = '', actions = [] }) {
  const subEl = h('div', { class: 'sp-sub' }, sub);
  const el = h('header', { class: 'sp-head' },
    h('div', { class: 'sp-head-text' }, h('h1', { class: 'sp-title' }, title), subEl),
    h('div', { class: 'sp-actions' }, ...actions));
  el.setSub = (s) => (subEl.textContent = s || '');
  return el;
}

/** A round icon button for headers and cards. */
export const actionBtn = (name, label, onClick, cls = '') => h('button', { class: ['ou-icon-btn', 'sp-act', cls], title: label, 'aria-label': label, html: icon(name, 22), onClick });

/** Opens a Bloom Tab app in a new tab (newtab.html#open=<app>; main.js opens it after the Lock screen). */
export function openInBloom(app) {
  const url = (globalThis.chrome?.runtime?.id ? chrome.runtime.getURL('newtab.html') : 'newtab.html') + '#open=' + app;
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank');
}
export const openAppBtn = (app) => actionBtn('external', t('sp.openApp'), () => openInBloom(app), 'sp-open-app');

/** "9:41 AM" today, else "Oct 26" (with the year when it isn't this year). */
export function fmtWhen(ms) {
  const d = new Date(ms);
  if (sameDay(d, new Date())) return fmtTime(d);
  return fmtDate(d, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** One UI empty state: a big faint icon and a line or two of text. */
export const empty = (ic, title, hint) => h('div', { class: 'ou-empty sp-empty' }, h('span', { html: icon(ic, 52) }), h('b', null, title), hint ? h('small', null, hint) : null);
