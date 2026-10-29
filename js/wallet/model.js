// Samsung Wallet data and the pure logic shared by the app, its widgets, Finder and the service worker (no DOM, no
// storage, no imports), so plain-node tests (.dev/wallet-model.mjs) and the worker can load it too. Ported from Liquid
// Tab's js/wallet/model.js; the pass kinds follow Samsung Wallet's own categories instead of Apple's pass styles.
//
// Store key "wallet" (pictures stay in IndexedDB as blobs "wallet:<id>"):
// {
//   v: 1,
//   passes: [{ id, kind: 'boarding' | 'ticket' | 'member' | 'coupon' | 'gift' | 'key' | 'id' | 'other', name,
//              bg: '#rrggbb', fg: '#rrggbb' | '' (automatic), logo?, art?, photo? (blob keys),
//              header / primary / secondary / aux / back: [{ l: label, v: value }] (a boarding pass has exactly two
//              primary fields: from and to, the city as label and its code as value),
//              code: { type: 'qr' | 'pdf417' | 'code128' | 'ean13' | 'upca' | '', msg, alt },
//              date?: 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' (departure, event, key valid from), expires?: 'YYYY-MM-DD',
//              transit?: 'air' | 'train' | 'bus' | 'boat', notes?, keep?: true (shown again after it expired),
//              quick?: true (in Quick access), at }],
//   subs: [{ id, name, url?, amount, cur, cycle: 'w' | 'm' | 'q' | 'y' | 'd', every? (days, for 'd'),
//            start: 'YYYY-MM-DD' (a billing date; the next ones follow from it), cat, trial?: 'YYYY-MM-DD' (free trial
//            ends, which is the first bill), pass?: pass id, alert: -1 (none) | 0 (on the day) | days before,
//            onDay?: true (a second alert on the day), state: 'active' | 'paused' | 'cancelled',
//            until?: 'YYYY-MM-DD' (cancelled: the last day it runs), notes?, at }],
//   spend: [{ id, amt, cur, mer, cat, at (ms), note? }],
//   budgets: { <spending category>: monthly amount in prefs.cur },
//   prefs: { cur?: 'USD', alertTime: 'HH:MM', widgetPass?: pass id }
// }

export const KEY = 'wallet';
export const DEF = { v: 1, passes: [], subs: [], spend: [], budgets: {}, prefs: { alertTime: '09:00' } };

// ---------------------------------------------------------------- kinds and categories
// Samsung Wallet's categories, in the order its Menu lists them. `name` and `one` are i18n keys (plural / singular).
export const KINDS = {
  boarding: { name: 'wallet.k.boarding', one: 'wallet.k1.boarding', icon: 'airplane', color: '#1f4fd1' },
  ticket: { name: 'wallet.k.ticket', one: 'wallet.k1.ticket', icon: 'wl-ticket', color: '#7a3ff2' },
  member: { name: 'wallet.k.member', one: 'wallet.k1.member', icon: 'wl-member', color: '#1c1c22' },
  coupon: { name: 'wallet.k.coupon', one: 'wallet.k1.coupon', icon: 'wl-coupon', color: '#ff7a2f' },
  gift: { name: 'wallet.k.gift', one: 'wallet.k1.gift', icon: 'wl-gift', color: '#e5466e' },
  key: { name: 'wallet.k.key', one: 'wallet.k1.key', icon: 'wl-key', color: '#147d6f' },
  id: { name: 'wallet.k.id', one: 'wallet.k1.id', icon: 'wl-id', color: '#3d5a80' },
  other: { name: 'wallet.k.other', one: 'wallet.k1.other', icon: 'wl-pass', color: '#5b6472' },
};
export const KIND_IDS = Object.keys(KINDS);
// Liquid Tab's pass styles, so passes copied over from it keep their meaning
const OLD_STYLE = { store: 'member', member: 'member', event: 'ticket', boarding: 'boarding', generic: 'other' };
/** Kinds with a date that matters (departure, event, key valid from). */
export const DATED = ['boarding', 'ticket', 'key', 'other'];

// spending categories (One UI colours), and what subscriptions and bills are for; `bill` ones say "Due" not "Renews"
export const SPEND_CATS = {
  food: { name: 'wallet.sc.food', icon: 'wl-food', color: '#ff8a3d' },
  shopping: { name: 'wallet.sc.shopping', icon: 'wl-bag', color: '#f2556b' },
  entertainment: { name: 'wallet.sc.entertainment', icon: 'wl-ticket', color: '#9a6cf2' },
  transport: { name: 'wallet.sc.transport', icon: 'wl-car', color: '#3e8bff' },
  travel: { name: 'wallet.sc.travel', icon: 'airplane', color: '#1fb5b0' },
  health: { name: 'wallet.sc.health', icon: 'wl-heart', color: '#2fb36b' },
  services: { name: 'wallet.sc.services', icon: 'wl-wrench', color: '#e8a800' },
  other: { name: 'wallet.sc.other', icon: 'wl-dots', color: '#8a8d96' },
};
export const SPEND_IDS = Object.keys(SPEND_CATS);
export const SUB_CATS = {
  streaming: { name: 'wallet.bc.streaming', icon: 'wl-tv', color: '#f2556b' },
  music: { name: 'wallet.bc.music', icon: 'music', color: '#ff6b9a' },
  software: { name: 'wallet.bc.software', icon: 'apps', color: '#3e8bff' },
  cloud: { name: 'wallet.bc.cloud', icon: 'cloud', color: '#2bb0ed' },
  news: { name: 'wallet.bc.news', icon: 'wl-book', color: '#ff8a3d' },
  games: { name: 'wallet.bc.games', icon: 'wl-game', color: '#7a5af8' },
  fitness: { name: 'wallet.bc.fitness', icon: 'wl-heart', color: '#2fb36b' },
  utilities: { name: 'wallet.bc.utilities', icon: 'wl-bolt', color: '#e8a800', bill: true },
  phone: { name: 'wallet.bc.phone', icon: 'wifi', color: '#1fb5b0', bill: true },
  home: { name: 'wallet.bc.home', icon: 'home', color: '#b07d52', bill: true },
  insurance: { name: 'wallet.bc.insurance', icon: 'wl-shield', color: '#6d7a8a', bill: true },
  loans: { name: 'wallet.bc.loans', icon: 'wl-card', color: '#9a6cf2', bill: true },
  other: { name: 'wallet.bc.other', icon: 'wl-dots', color: '#8a8d96' },
};
export const SUB_IDS = Object.keys(SUB_CATS);
export const CODE_TYPES = ['qr', 'pdf417', 'code128', 'ean13', 'upca'];
export const CYCLES = ['w', 'm', 'q', 'y', 'd'];
export const TRANSITS = ['air', 'train', 'bus', 'boat'];

// ---------------------------------------------------------------- normalising stored data
const str = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));
const isKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const fieldList = (a, max) => (Array.isArray(a) ? a : []).filter((f) => f && (f.l || f.v)).slice(0, max).map((f) => ({ l: str(f.l, 60), v: str(f.v, 300) }));
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const rid = (p) => p + Math.random().toString(36).slice(2, 10);
const isBlob = (v) => typeof v === 'string' && /^wallet[:-]/.test(v);

export function normPass(p) {
  p = p && typeof p === 'object' ? p : {};
  const kind = KINDS[p.kind] ? p.kind : OLD_STYLE[p.style] || 'other';
  const out = {
    id: str(p.id, 40) || rid('p'), kind, name: str(p.name, 80), bg: isColor(p.bg) ? p.bg : KINDS[kind].color, fg: isColor(p.fg) ? p.fg : '',
    // a boarding pass keeps both route places, so an empty origin doesn't move the destination into its spot
    header: fieldList(p.header, 3),
    primary: kind === 'boarding' ? [0, 1].map((i) => ({ l: str(p.primary?.[i]?.l, 60), v: str(p.primary?.[i]?.v, 300) })) : fieldList(p.primary, 1),
    secondary: fieldList(p.secondary, 4), aux: fieldList(p.aux, 5), back: fieldList(p.back, 30),
    code: { type: CODE_TYPES.includes(p.code?.type) ? p.code.type : '', msg: str(p.code?.msg, 2000), alt: str(p.code?.alt, 80) },
    at: num(p.at) || Date.now(),
  };
  if (isBlob(p.logo)) out.logo = p.logo;
  if (isBlob(p.art ?? p.strip)) out.art = p.art ?? p.strip;
  if (isBlob(p.photo ?? p.thumb)) out.photo = p.photo ?? p.thumb;
  if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(p.date)) out.date = p.date;
  if (isKey(p.expires)) out.expires = p.expires;
  if (kind === 'boarding') out.transit = TRANSITS.includes(p.transit) ? p.transit : 'air';
  if (p.notes) out.notes = str(p.notes, 4000);
  if (p.keep) out.keep = true;
  if (p.quick) out.quick = true;
  return out;
}
export function normSub(s) {
  s = s && typeof s === 'object' ? s : {};
  const out = {
    id: str(s.id, 40) || rid('s'), name: str(s.name, 80), amount: Math.max(0, num(s.amount)),
    cur: /^[A-Z]{3}$/.test(s.cur) ? s.cur : 'USD', cycle: CYCLES.includes(s.cycle) ? s.cycle : 'm',
    start: isKey(s.start) ? s.start : '', cat: SUB_IDS.includes(s.cat) ? s.cat : 'other',
    alert: Number.isInteger(s.alert) && s.alert >= -1 && s.alert <= 30 ? s.alert : 1,
    state: ['active', 'paused', 'cancelled'].includes(s.state) ? s.state : 'active', at: num(s.at) || Date.now(),
  };
  if (out.cycle === 'd') out.every = Math.min(3650, Math.max(1, Math.round(num(s.every)) || 30));
  if (typeof s.url === 'string' && s.url) out.url = str(s.url, 300);
  if (isKey(s.trial)) out.trial = s.trial;
  if (typeof s.pass === 'string' && s.pass) out.pass = s.pass;
  if (s.onDay && out.alert > 0) out.onDay = true;
  if (isKey(s.until)) out.until = s.until;
  if (s.notes) out.notes = str(s.notes, 2000);
  return out;
}
export function normExpense(e) {
  e = e && typeof e === 'object' ? e : {};
  const out = { id: str(e.id, 40) || rid('e'), amt: Math.round(num(e.amt) * 100) / 100, cur: /^[A-Z]{3}$/.test(e.cur) ? e.cur : 'USD', mer: str(e.mer, 80), cat: SPEND_IDS.includes(e.cat) ? e.cat : 'other', at: num(e.at) || Date.now() };
  if (e.note) out.note = str(e.note, 300);
  return out;
}
export function norm(d) {
  d = d && typeof d === 'object' ? d : {};
  const budgets = {};
  for (const [k, v] of Object.entries(d.budgets || {})) if (SPEND_IDS.includes(k) && num(v) > 0) budgets[k] = num(v);
  const prefs = { alertTime: /^\d{2}:\d{2}$/.test(d.prefs?.alertTime) ? d.prefs.alertTime : '09:00' };
  if (/^[A-Z]{3}$/.test(d.prefs?.cur)) prefs.cur = d.prefs.cur;
  if (typeof d.prefs?.widgetPass === 'string' && d.prefs.widgetPass) prefs.widgetPass = d.prefs.widgetPass;
  return {
    v: 1,
    passes: (Array.isArray(d.passes) ? d.passes : []).map(normPass),
    subs: (Array.isArray(d.subs) ? d.subs : []).map(normSub),
    spend: (Array.isArray(d.spend) ? d.spend : []).map(normExpense),
    budgets,
    prefs,
  };
}

// ---------------------------------------------------------------- dates (local days as 'YYYY-MM-DD')
const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dateOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
export const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
/** A pass date ('YYYY-MM-DD' or with 'THH:MM') as a local Date. */
export const passDate = (s) => (s.length > 10 ? new Date(s) : dateOf(s));
/** The month `n` months after `k`, keeping the day of the month where it exists (Jan 31 → Feb 28 → Mar 31 from the anchor). */
function addMonths(k, n) {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return keyOf(new Date(t.getFullYear(), t.getMonth(), Math.min(d, last)));
}
const cycleDays = (s) => ({ w: 7, d: s.every || 30, m: 30.44, q: 91.31, y: 365.25 }[s.cycle] || 30.44);
/** The n-th billing date counted from the anchor (n can be negative). */
export function nthBill(s, n) {
  if (s.cycle === 'w') return addDays(s.start, 7 * n);
  if (s.cycle === 'd') return addDays(s.start, (s.every || 30) * n);
  return addMonths(s.start, n * (s.cycle === 'q' ? 3 : s.cycle === 'y' ? 12 : 1));
}
/** Billing dates from `from` to `to` (inclusive), for subscriptions that are running. */
export function billDates(s, from, to, max = 400) {
  if (!s.start || s.state === 'paused') return [];
  const out = [];
  let n = Math.floor(daysBetween(s.start, from) / cycleDays(s)) - 1;
  for (let i = 0; i < max + 4; i++, n++) {
    const k = nthBill(s, n);
    if (k > to) break;
    if (k < from) continue;
    if (s.state === 'cancelled' && (!s.until || k > s.until)) break;
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}
/** The next billing date on or after `today`, or '' when there is none (paused, cancelled). */
export function nextBill(s, today = keyOf()) {
  if (s.state !== 'active' || !s.start) return '';
  return billDates(s, today, addDays(today, Math.ceil(cycleDays(s)) + 31), 1)[0] || '';
}
export const inTrial = (s, today = keyOf()) => !!s.trial && s.trial >= today && s.state === 'active';
/** How many times a subscription bills in a month, on average. */
export const perMonth = (s) => ({ w: 52 / 12, m: 1, q: 1 / 3, y: 1 / 12, d: 365.25 / 12 / (s.every || 30) }[s.cycle] || 1);

/** Monthly and yearly cost of the running subscriptions, per currency (there are no exchange rates offline). */
export function totals(subs) {
  const month = {}, year = {};
  for (const s of subs) {
    if (s.state !== 'active') continue;
    month[s.cur] = (month[s.cur] || 0) + s.amount * perMonth(s);
    year[s.cur] = (year[s.cur] || 0) + s.amount * perMonth(s) * 12;
  }
  return { month, year };
}
/** Bills due in the next `days` days (today included): every occurrence, soonest first. */
export function upcoming(subs, days = 30, today = keyOf()) {
  const to = addDays(today, days - 1), out = [];
  for (const s of subs) {
    if (s.state !== 'active') continue;
    for (const k of billDates(s, today, to, 60)) out.push({ id: s.id, name: s.name, amount: s.amount, currency: s.cur, date: k, days: daysBetween(today, k), trial: s.trial === k, url: s.url || '', cat: s.cat, bill: !!SUB_CATS[s.cat]?.bill });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}
/** The next time each alert of a subscription goes off after `now`: [{ at (ms), date (the bill), before, trial }]. */
export function alertsFor(s, alertTime = '09:00', now = Date.now(), horizon = 2) {
  if (s.state !== 'active' || s.alert < 0 || !s.start) return [];
  const [hh, mm] = alertTime.split(':').map(Number);
  const today = keyOf(new Date(now)), out = [];
  const bills = billDates(s, addDays(today, -1), addDays(today, Math.ceil(cycleDays(s)) * horizon + s.alert + 2), horizon + 1);
  for (const k of bills) {
    const offs = [s.alert, ...(s.onDay && s.alert > 0 ? [0] : [])];
    for (const o of offs) {
      const d = dateOf(addDays(k, -o));
      d.setHours(hh, mm, 0, 0);
      if (+d > now) out.push({ at: +d, date: k, before: o, trial: s.trial === k });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- passes
/** A pass is expired after its expiry date, or the day after its departure or event, unless it was restored. */
export function isExpired(p, today = keyOf()) {
  if (p.keep) return false;
  if (p.expires && p.expires < today) return true;
  if ((p.kind === 'ticket' || p.kind === 'boarding') && p.date && p.date.slice(0, 10) < today) return true;
  return false;
}
/** The words on the front of a pass: "SFO → NRT" for a boarding pass, else its main field. */
export function passTitle(p) {
  if (p.kind === 'boarding') return p.primary.map((f) => f.v || f.l).filter(Boolean).join(' → ');
  return p.primary[0]?.v || '';
}
/** Tickets and boarding passes from now on within `days` days, soonest first (only what's on the front). */
export function upcomingPasses(passes, days = 1, now = new Date()) {
  const today = keyOf(now), last = addDays(today, days), hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return passes
    .filter((p) => p.date && (p.kind === 'boarding' || p.kind === 'ticket') && !isExpired(p, today) && p.date.slice(0, 10) >= today && p.date.slice(0, 10) <= last && (p.date.length <= 10 || p.date.slice(0, 10) > today || p.date.slice(11) >= hhmm))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
/** Passes whose name or front and back fields contain `q` (not the barcode, which is only a number to scan). */
export function searchPasses(passes, q) {
  q = String(q || '').trim().toLocaleLowerCase();
  if (!q) return [];
  const has = (s) => String(s || '').toLocaleLowerCase().includes(q);
  return passes.filter((p) => has(p.name) || [...p.header, ...p.primary, ...p.secondary, ...p.aux, ...p.back].some((f) => has(f.v)) || has(p.notes));
}

// ---------------------------------------------------------------- spending
/** The first day of the week containing `d` (weekStart: 0 = Sunday … 6 = Saturday). */
export function weekOf(d, weekStart = 0) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() - weekStart + 7) % 7)); return x; }
/** Spending per category in [from, to), in one currency: { total, cats: { food: 12.5, … } } */
export function sumRange(spend, from, to, cur) {
  const cats = {};
  let total = 0;
  for (const e of spend) if (e.at >= +from && e.at < +to && (!cur || e.cur === cur)) { cats[e.cat] = (cats[e.cat] || 0) + e.amt; total += e.amt; }
  return { total, cats };
}
/** Totals per currency in [from, to): { USD: 12.5, … } */
export function byCurrency(spend, from, to) {
  const out = {};
  for (const e of spend) if (e.at >= +from && e.at < +to) out[e.cur] = (out[e.cur] || 0) + e.amt;
  return out;
}
/** Bars for the chart: a week (7 days), a month (each day) or a year (12 months) starting at `start`. */
export function bars(spend, period, start, cur) {
  const out = [];
  const s = new Date(start);
  const n = period === 'week' ? 7 : period === 'month' ? new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate() : 12;
  for (let i = 0; i < n; i++) {
    const a = period === 'year' ? new Date(s.getFullYear(), i, 1) : new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
    const b = period === 'year' ? new Date(s.getFullYear(), i + 1, 1) : new Date(s.getFullYear(), s.getMonth(), s.getDate() + i + 1);
    out.push({ from: a, to: b, ...sumRange(spend, a, b, cur) });
  }
  return out;
}
export const periodStart = (period, d = new Date(), weekStart = 0) => (period === 'week' ? weekOf(d, weekStart) : period === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), 0, 1));
export function periodShift(period, start, n) {
  const s = new Date(start);
  if (period === 'week') s.setDate(s.getDate() + 7 * n);
  else if (period === 'month') s.setMonth(s.getMonth() + n);
  else s.setFullYear(s.getFullYear() + n);
  return s;
}
export const periodEnd = (period, start) => periodShift(period, start, 1);

/** CSV of every expense (RFC 4180 quoting; amounts with a dot, dates in ISO form; cells that look like formulas quoted). */
export function toCSV(spend, catName = (c) => c, head = ['Date', 'Time', 'Merchant', 'Category', 'Amount', 'Currency', 'Note']) {
  const q = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) || /^'/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [head];
  for (const e of [...spend].sort((a, b) => a.at - b.at)) {
    const d = new Date(e.at);
    rows.push([keyOf(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`, e.mer, catName(e.cat), e.amt.toFixed(2), e.cur, e.note || '']);
  }
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- "coffee 3.5$", "12 € lunch", "٣٫٥ قهوة"
const SYMBOLS = [['R$', 'BRL'], ['US$', 'USD'], ['A$', 'AUD'], ['C$', 'CAD'], ['HK$', 'HKD'], ['NZ$', 'NZD'], ['S$', 'SGD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ['₩', 'KRW'], ['₽', 'RUB'], ['₺', 'TRY'], ['₪', 'ILS'], ['₱', 'PHP'], ['฿', 'THB'], ['₫', 'VND'], ['₦', 'NGN'], ['zł', 'PLN'], ['Rp', 'IDR'], ['$', 'USD']];
const WORDS = {
  USD: ['usd', 'dollar', 'dollars', 'bucks', 'دولار', 'دولارات'],
  EUR: ['eur', 'euro', 'euros', 'يورو'], GBP: ['gbp', 'pound', 'pounds', 'quid', 'جنيه استرليني', 'استرليني'],
  SAR: ['sar', 'riyal', 'riyals', 'ريال', 'ريالات', 'ر.س', 'رس'], AED: ['aed', 'dirham', 'dirhams', 'درهم', 'دراهم', 'د.إ'], EGP: ['egp', 'جنيه', 'جنيهات', 'ج.م'],
  KWD: ['kwd', 'دينار كويتي'], QAR: ['qar', 'ريال قطري'], MAD: ['درهم مغربي'], JOD: ['jod', 'دينار'], INR: ['inr', 'rupee', 'rupees'], JPY: ['jpy', 'yen'], CNY: ['cny', 'rmb', 'yuan'],
  KRW: ['krw'], RUB: ['rub'], TRY: ['tl', 'lira'], BRL: ['brl', 'reais'], IDR: ['idr', 'rupiah'], CHF: ['chf', 'francs'], MXN: ['mxn', 'pesos'],
};
// longer words first, so "ريال قطري" wins over "ريال"
const WORD_LIST = Object.entries(WORDS).flatMap(([code, ws]) => ws.map((w) => [w, code])).sort((a, b) => b[0].length - a[0].length);
const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CAT_WORDS = {
  food: ['coffee', 'cafe', 'café', 'latte', 'tea', 'lunch', 'dinner', 'breakfast', 'brunch', 'restaurant', 'pizza', 'burger', 'sushi', 'food', 'snack', 'bakery', 'groceries', 'grocery', 'supermarket', 'market', 'starbucks', 'mcdonald', 'kfc', 'drinks', 'beer', 'bar', 'juice',
    'قهوة', 'قهوه', 'شاي', 'غداء', 'غدا', 'عشاء', 'فطور', 'مطعم', 'بيتزا', 'برجر', 'اكل', 'أكل', 'طعام', 'بقالة', 'سوبرماركت', 'مخبز', 'عصير'],
  transport: ['uber', 'lyft', 'taxi', 'cab', 'bus', 'train', 'metro', 'subway', 'tram', 'fuel', 'gas', 'petrol', 'parking', 'toll', 'careem', 'bolt', 'تاكسي', 'أوبر', 'اوبر', 'كريم', 'بنزين', 'وقود', 'مترو', 'باص', 'موقف'],
  travel: ['flight', 'hotel', 'airbnb', 'booking', 'airline', 'airport', 'trip', 'vacation', 'holiday', 'visa', 'طيران', 'فندق', 'رحلة', 'سفر', 'تذكرة طيران'],
  entertainment: ['movie', 'movies', 'cinema', 'concert', 'theater', 'theatre', 'netflix', 'spotify', 'game', 'games', 'steam', 'playstation', 'xbox', 'tickets', 'museum', 'سينما', 'فيلم', 'حفلة', 'لعبة', 'ألعاب'],
  health: ['pharmacy', 'doctor', 'dentist', 'hospital', 'medicine', 'gym', 'clinic', 'vitamins', 'صيدلية', 'دواء', 'طبيب', 'دكتور', 'مستشفى', 'عيادة', 'نادي'],
  shopping: ['amazon', 'clothes', 'shoes', 'shirt', 'mall', 'ikea', 'shop', 'shopping', 'store', 'gift', 'book', 'books', 'electronics', 'noon', 'ملابس', 'حذاء', 'مول', 'هدية', 'تسوق', 'كتاب'],
  services: ['haircut', 'barber', 'laundry', 'cleaning', 'repair', 'phone bill', 'internet', 'electricity', 'water bill', 'subscription', 'insurance', 'rent', 'حلاق', 'مغسلة', 'تصليح', 'صيانة', 'كهرباء', 'انترنت', 'إنترنت', 'فاتورة', 'اشتراك', 'إيجار'],
};
/** Latin digits and separators from Arabic-Indic and Persian digits (and the Arabic decimal and thousands signs). */
const latin = (s) => String(s).replace(/[٠-٩۰-۹]/g, (d) => d.charCodeAt(0) % 16).replace(/٫/g, '.').replace(/٬/g, ',');

/**
 * parseExpense('coffee 3.5$') → { amount: 3.5, currency: 'USD', merchant: 'Coffee', category: 'food', at } or null.
 * `opts.currency` is used when the text names none (pass '' to see whether it names one); `opts.decimal` (',' or '.')
 * settles "1.500" / "1,500".
 */
export function parseExpense(text, { currency = 'USD', decimal = '.', now = Date.now() } = {}) {
  const s = latin(text).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // the amount: digits with optional thousands and decimal separators
  const m = s.match(/(?:^|[^\p{L}\d])(\d{1,3}(?:[,. ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)(?![\p{L}\d])/u) || s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const raw = m[1];
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let amount;
  if (lastSep < 0) amount = +raw.replace(/\s/g, '');
  else {
    const tail = raw.length - lastSep - 1, both = raw.includes('.') && raw.includes(',');
    const isDecimal = both || tail !== 3 || raw[lastSep] === decimal || (raw.match(/[.,]/g).length === 1 && raw[lastSep] === '.' && decimal === '.');
    amount = isDecimal ? +(raw.slice(0, lastSep).replace(/[\s.,]/g, '') + '.' + raw.slice(lastSep + 1)) : +raw.replace(/[\s.,]/g, '');
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let rest = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  // the currency: a symbol, an ISO code or a word
  let cur = '';
  for (const [sym, code] of SYMBOLS) if (s.includes(sym)) {
    // "$" and "¥" are also the local dollar or yuan
    cur = sym === '$' && /^(AUD|CAD|NZD|SGD|HKD|MXN|ARS|CLP|COP|TWD)$/.test(currency) ? currency : sym === '¥' && currency === 'CNY' ? 'CNY' : code;
    rest = rest.replace(sym, ' ');
    break;
  }
  if (!cur) for (const [w, code] of WORD_LIST) {
    const re = new RegExp(`(^|[^\\p{L}])${reEsc(w)}(?![\\p{L}])`, 'iu');
    if (re.test(rest)) { cur = code; rest = rest.replace(re, '$1 '); break; }
  }
  // "yesterday" moves it to the same time the day before
  let at = now;
  const yRe = /(^|\s)(yesterday|أمس|امس|البارحة)(?=\s|$)/iu;
  if (yRe.test(rest)) { at = now - 86400000; rest = rest.replace(yRe, ' '); }
  rest = rest.replace(/(^|\s)(spent|paid|pay|bought|expense|for|on|at|in|لـ|على|في|دفعت|صرفت|اشتريت|مصروف|ب)(?=\s|$)/giu, ' ').replace(/[\s,.:;\-–—+=]+/g, ' ').trim();
  const merchant = rest ? rest.charAt(0).toLocaleUpperCase() + rest.slice(1) : '';
  return { amount: Math.round(amount * 100) / 100, currency: cur || currency, merchant, category: guessCategory(merchant), at };
}
export function guessCategory(text) {
  // Arabic words are matched without "ال" ("القهوة" → "قهوة")
  const t = latin(text).toLowerCase().replace(/(^|\s)ال(?=\p{L}{2})/gu, '$1');
  if (!t) return 'other';
  for (const [cat, words] of Object.entries(CAT_WORDS)) for (const w of words) if (new RegExp(`(^|[^\\p{L}])${w}`, 'u').test(t)) return cat;
  return 'other';
}
// "spent 12 on lunch" is an expense even without a currency; "100 usd to eur" is a conversion, not something bought
const SPEND_WORDS = /(?<![\p{L}\p{N}])(?:spent|paid|bought|expense|صرفت|دفعت|اشتريت|مصروف)(?![\p{L}\p{N}])/iu;
const CONVERT = /\d.*\s(?:to|into|in|إلى|الى)\s+[a-z]{3}\s*$/i;
/** An expense typed in Finder: it needs a number and either a currency or a word like "spent"; a number alone isn't one. */
export function expenseIn(text, opts = {}) {
  if (!/[\d٠-٩۰-۹]/.test(text) || CONVERT.test(text) || /^[\d\s.,+\-*/×÷()%^=]+$/.test(latin(text))) return null;
  const probe = parseExpense(text, { ...opts, currency: '' });
  if (!probe || (!probe.currency && !SPEND_WORDS.test(text))) return null;
  return parseExpense(text, opts);
}
