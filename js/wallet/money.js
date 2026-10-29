// Money formatting for Samsung Wallet: Intl currency formats in the UI language, the default currency from the
// browser's region, and the list of currencies for pickers. There are no exchange rates (they would need a network),
// so amounts in different currencies are always shown side by side, never added together.
import { locale, lang, isRtl } from '../core/i18n.js';

// the currency of a region (the part after "-" in "en-US"), for the default when Wallet has none set
const REGION = {
  US: 'USD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', CY: 'EUR', MT: 'EUR', HR: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RU: 'RUB', UA: 'UAH', TR: 'TRY', IL: 'ILS',
  SA: 'SAR', AE: 'AED', EG: 'EGP', KW: 'KWD', QA: 'QAR', BH: 'BHD', OM: 'OMR', JO: 'JOD', LB: 'LBP', IQ: 'IQD', SY: 'SYP', MA: 'MAD', DZ: 'DZD', TN: 'TND', LY: 'LYD', SD: 'SDG', YE: 'YER', PS: 'ILS',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', ID: 'IDR', MY: 'MYR', SG: 'SGD', TH: 'THB', VN: 'VND', PH: 'PHP', JP: 'JPY', KR: 'KRW', CN: 'CNY', TW: 'TWD', HK: 'HKD',
  AU: 'AUD', NZ: 'NZD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS',
};
export const COMMON = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP', 'KWD', 'QAR', 'JOD', 'MAD', 'TRY', 'INR', 'JPY', 'CNY', 'KRW', 'CAD', 'AUD', 'CHF'];

/** The currency to use when the user hasn't picked one: from the browser's region, else the UI language. */
export function regionCurrency() {
  for (const l of [navigator.language, ...(navigator.languages || [])]) {
    const r = String(l || '').split('-').find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p));
    if (r && REGION[r]) return REGION[r];
  }
  return lang() === 'ar' ? 'SAR' : 'USD';
}

const cache = new Map();
function nf(cur, opts = {}) {
  const k = cur + JSON.stringify(opts) + lang();
  if (!cache.has(k)) {
    try { cache.set(k, new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', ...opts })); }
    catch { cache.set(k, new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, ...opts })); }
  }
  return cache.get(k);
}
// In Arabic a Latin symbol such as "US$" would break apart ("$US"), so it is isolated as one left-to-right piece.
const fmtParts = (f, n) => (isRtl() ? f.formatToParts(n).map((p) => (p.type === 'currency' && /[A-Za-z$€£¥]/.test(p.value) ? `⁦${p.value}⁩` : p.value)).join('') : f.format(n));
/** "$15.99", "15.99 ر.س."; `compact` drops the cents of round amounts ("$12" rather than "$12.00"). */
export function money(amount, cur, { compact = false, sign = false } = {}) {
  const n = +amount || 0;
  const whole = compact && Math.abs(n - Math.round(n)) < 0.005;
  try { return fmtParts(nf(cur, { ...(whole ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}), ...(sign ? { signDisplay: 'exceptZero' } : {}) }), n); }
  catch { return `${n.toFixed(2)} ${cur}`; }
}
/** A short amount for chart axes: "$1.2K", "€300". */
export function moneyShort(amount, cur) {
  try { return fmtParts(nf(cur, { notation: 'compact', maximumFractionDigits: 1 }), +amount || 0); } catch { return String(Math.round(+amount || 0)); }
}
/** The currency's own symbol ("$", "€", "ر.س.‏") for labels next to an amount field. */
export function symbolOf(cur) {
  try { return nf(cur).formatToParts(1).find((p) => p.type === 'currency')?.value || cur; } catch { return cur; }
}
/** The decimal separator of the UI locale, so "12,50" types naturally where that's the habit. */
export function decimalChar() {
  try { return new Intl.NumberFormat(locale()).formatToParts(1.5).find((p) => p.type === 'decimal')?.value === ',' ? ',' : '.'; } catch { return '.'; }
}
let names, namesLang;
export function currencyName(cur) {
  try {
    if (namesLang !== lang()) { names = new Intl.DisplayNames([locale()], { type: 'currency' }); namesLang = lang(); }
    return names.of(cur) || cur;
  } catch { return cur; }
}
/** Every currency Intl knows, the common ones first. */
export function currencyList(extra = []) {
  let all = [];
  try { all = Intl.supportedValuesOf('currency'); } catch { all = COMMON; }
  const first = [...new Set([...extra.filter(Boolean), ...COMMON])];
  return [...first, ...all.filter((c) => !first.includes(c))];
}
/** Lines like "$42.97 · €9.99" from { USD: 42.97, EUR: 9.99 }, the given currency first. */
export function moneyLines(byCur, first) {
  return Object.entries(byCur).filter(([, v]) => Math.abs(v) >= 0.005).sort(([a, x], [b, y]) => (a === first ? -1 : b === first ? 1 : y - x)).map(([c, v]) => money(v, c));
}
/** Parses an amount typed in any locale ("12,50", "1.234,5", "١٢٫٥"). */
export function parseAmount(s) {
  s = String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => d.charCodeAt(0) % 16).replace(/٫/g, '.').replace(/[٬\s']/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last < 0) return +s;
  const tail = s.length - last - 1, both = s.includes('.') && s.includes(',');
  if (!both && tail === 3 && s[last] !== decimalChar()) return +s.replace(/[.,]/g, '');
  return +(s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1));
}
