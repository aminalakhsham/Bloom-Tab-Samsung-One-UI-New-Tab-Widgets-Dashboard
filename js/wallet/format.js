// Samsung Wallet text and icons shared by the app and its widgets: kind and category names, billing cycles,
// "Renews Fri, Oct 24", "Tomorrow", counts with Arabic plural forms, and the round icon of a subscription (its
// website's icon from Chrome's favicon cache, or its category).
import { escapeHtml, faviconUrl, hostname } from '../core/util.js';
import { t, lang, locale, fmtDate, fmtTime } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as M from './model.js';
import './symbols.js';

export const kindInfo = (k) => M.KINDS[k] || M.KINDS.other;
export const kindName = (k) => t(kindInfo(k).name);
export const kindOne = (k) => t(kindInfo(k).one);
export const spendCat = (c) => M.SPEND_CATS[c] || M.SPEND_CATS.other;
export const spendName = (c) => t(spendCat(c).name);
export const subCat = (s) => M.SUB_CATS[s.cat] || M.SUB_CATS.other;
export const subCatName = (c) => t((M.SUB_CATS[c] || M.SUB_CATS.other).name);
export const passName = (p) => p.name || kindOne(p.kind);
/** "27%" in the UI language (Arabic puts the sign where it reads right). */
export const pct = (x) => { try { return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(x); } catch { return Math.round(x * 100) + '%'; } };
/** A kind's name inside a sentence ("Add membership card", "No tickets"): English lowers the first letter, not "ID". */
const lowerFirst = (s) => (lang() === 'en' && !/^\p{Lu}{2}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const kindOneIn = (k) => lowerFirst(kindOne(k));
export const kindNameIn = (k) => lowerFirst(kindName(k));

/** A count with the right plural form: keys "<key>.one/.two/.few/.many" (English uses one and many). */
export function cnt(key, n) {
  const ar = lang() === 'ar', m = n % 100;
  const form = n === 1 ? 'one' : ar && n === 2 ? 'two' : ar && m >= 3 && m <= 10 ? 'few' : 'many';
  return t(`${key}.${form}`, { n });
}
export const CYCLES = { w: 'wallet.cy.w', m: 'wallet.cy.m', q: 'wallet.cy.q', y: 'wallet.cy.y', d: 'wallet.cy.d' };
export const ALERTS = [[-1, 'wallet.al.none'], [0, 'wallet.al.day'], [1, 'wallet.al.1'], [2, 'wallet.al.2'], [3, 'wallet.al.3'], [7, 'wallet.al.7']];
export const cycleText = (s) => (s.cycle === 'd' ? (s.every === 1 ? t('wallet.everyDay') : cnt('wallet.everyN', s.every)) : t(CYCLES[s.cycle]));
/** "/mo"-style suffix for a price: "a month", "a year"… */
export const perText = (s) => ({ w: t('wallet.per.w'), m: t('wallet.per.m'), q: t('wallet.per.q'), y: t('wallet.per.y') }[s.cycle] || cycleText(s));

const thisYear = (k) => k.slice(0, 4) === String(new Date().getFullYear());
export const longDate = (k) => fmtDate(M.dateOf(k), { weekday: 'short', month: 'short', day: 'numeric', ...(thisYear(k) ? {} : { year: 'numeric' }) });
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1) : s);
/** "Today", "Tomorrow", "In 3 days" for the coming week, then the date. */
export function whenText(k, today = M.keyOf()) {
  const n = M.daysBetween(today, k);
  if (n >= -1 && n < 7) { try { return cap(new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(n, 'day')); } catch {} }
  return longDate(k);
}
/** A day heading in a list of expenses: "Today", "Yesterday", "Wednesday" for this week, then the date. */
export function dayText(k, today = M.keyOf()) {
  const n = M.daysBetween(k, today);
  if (n <= 1 && n >= 0) return whenText(k, today);
  if (n > 1 && n < 7) return fmtDate(M.dateOf(k), { weekday: 'long' });
  return fmtDate(M.dateOf(k), { weekday: 'long', month: 'long', day: 'numeric', ...(thisYear(k) ? {} : { year: 'numeric' }) });
}
export function statusText(s, today = M.keyOf()) {
  if (s.state === 'paused') return t('wallet.paused');
  if (s.state === 'cancelled') return s.until && s.until >= today ? t('wallet.endsOn', { date: longDate(s.until) }) : t('wallet.cancelled');
  const n = M.nextBill(s, today);
  if (!n) return '';
  if (M.inTrial(s, today) && s.trial === n) return t('wallet.trialEndsOn', { date: longDate(n) });
  return subCat(s).bill ? t('wallet.dueOn', { date: longDate(n) }) : t('wallet.renewsOn', { date: longDate(n) });
}
/** A pass's date: "Oct 29 · 11:05" (with the time when it has one). */
export function passDateText(p, withTime = true) {
  if (!p.date) return '';
  const d = M.passDate(p.date);
  const day = fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return withTime && p.date.length > 10 ? `${day} · ${fmtTime(d)}` : day;
}
export const passTimeText = (p) => (p.date?.length > 10 ? fmtTime(M.passDate(p.date)) : '');
/** "Departs in 2 hours", "Tomorrow", "In 5 days" for a trip or an event. */
export function passWhen(p, now = Date.now()) {
  if (!p.date) return '';
  const at = +M.passDate(p.date), diff = at - now;
  if (p.date.length > 10 && diff > 0 && diff < 12 * 3600e3) {
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    return cap(diff < 3600e3 ? rtf.format(Math.max(1, Math.round(diff / 60e3)), 'minute') : rtf.format(Math.round(diff / 3600e3), 'hour'));
  }
  return whenText(p.date.slice(0, 10));
}

/** The round icon of a subscription: the website's icon from Chrome's favicon cache, else its category. */
export function subIconHTML(s, cls = '') {
  const c = subCat(s), host = s.url ? hostname(s.url) : '';
  const cat = `<span class="wl-subico ${cls}" style="--c:${c.color}">${icon(c.icon, 20)}</span>`;
  if (!host || !globalThis.chrome?.runtime?.id || globe.get(host)) return cat;
  return `<span class="wl-subico site ${cls}" data-host="${escapeHtml(host)}" data-cat="${escapeHtml(cat)}"><img src="${escapeHtml(faviconUrl(s.url, 64))}" alt="" loading="lazy"></span>`;
}
// Chrome answers with a grey globe for a site it has never seen; such a subscription shows its category icon instead.
// Hosts are checked once per page (the globe is recognised by a coarse fingerprint of its pixels).
const globe = new Map();
let globeSig = null;
async function fingerprint(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = new OffscreenCanvas(16, 16), cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, 16, 16);
  const d = cx.getImageData(0, 0, 16, 16).data;
  let out = '';
  for (let i = 0; i < d.length; i += 16) out += (d[i] >> 5).toString(8) + (d[i + 3] >> 6);
  return out;
}
/** Swaps the site icons inside `root` whose favicon is only Chrome's globe for the category icon. */
export function hydrateSubIcons(root) {
  if (!globalThis.chrome?.runtime?.id || !globalThis.OffscreenCanvas) return;
  for (const box of root.querySelectorAll('.wl-subico.site[data-host]:not([data-ck])')) {
    box.dataset.ck = '1';
    const host = box.dataset.host, img = box.querySelector('img');
    const swap = () => { if (box.parentNode) box.outerHTML = box.dataset.cat; };
    if (globe.has(host)) { if (globe.get(host)) swap(); continue; }
    (async () => {
      globeSig ??= await fingerprint(faviconUrl('https://unknown-site.invalid/', 64));
      const g = (await fingerprint(img.src)) === globeSig;
      globe.set(host, g);
      if (g) swap();
    })().catch(() => swap());
  }
}
