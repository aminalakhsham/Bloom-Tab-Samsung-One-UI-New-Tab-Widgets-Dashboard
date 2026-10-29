// Tiny i18n layer. Each module registers its own strings so files never fight over one table:
//   addStrings({ en: { 'notes.title': 'Notes' }, ar: { 'notes.title': 'الملاحظات' } });
//   t('notes.title');  t('timer.left', { n: 5 })  ->  "{n} min left" with {n} replaced.
// Missing translations fall back to English, then to the key itself.

import { setting } from './store.js';

const tables = { en: {}, ar: {} };
export const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'ar', name: 'العربية', rtl: true },
];

let current = 'en';

export function addStrings(map) {
  for (const [lang, strings] of Object.entries(map)) {
    tables[lang] = Object.assign(tables[lang] || {}, strings);
  }
}

export function detectLang() {
  const pref = setting('lang');
  if (pref && pref !== 'auto') return pref;
  const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || 'en').toLowerCase();
  const base = ui.split('-')[0];
  return tables[base] && LANGS.some((l) => l.id === base) ? base : 'en';
}

export function setLang(lang) {
  current = lang;
  const rtl = LANGS.find((l) => l.id === lang)?.rtl;
  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
}

export const lang = () => current;
export const isRtl = () => document.documentElement.dir === 'rtl';

/** BCP-47 locale for Intl formatters (keeps Latin digits in Arabic, like One UI's default). */
export const locale = () => (current === 'ar' ? 'ar-u-nu-latn' : navigator.language || 'en');

export function t(key, vars) {
  let s = tables[current]?.[key] ?? tables.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

/** A name that may be a key, a plain string or { en, ar }. */
export function tr(name) {
  if (name && typeof name === 'object') return name[current] ?? name.en;
  return t(name);
}

export function use12h() {
  const pref = setting('hour12');
  if (pref === true || pref === false) return pref;
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
}

/** "9:41" / "21:41" (no AM/PM — One UI shows the period separately). */
export function fmtHM(d = new Date(), { seconds = false, h12 = use12h() } = {}) {
  let hh = d.getHours();
  if (h12) hh = hh % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${h12 ? hh : String(hh).padStart(2, '0')}:${mm}${seconds ? ':' + ss : ''}`;
}

export function fmtPeriod(d = new Date()) {
  if (!use12h()) return '';
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', hour12: true }).formatToParts(d).find((p) => p.type === 'dayPeriod')?.value || '';
}

/** Full time string with period, e.g. "9:41 AM". */
export const fmtTime = (d = new Date(), opts) => {
  const p = fmtPeriod(d);
  return p ? `${fmtHM(d, opts)} ${p}` : fmtHM(d, opts);
};

export function fmtDate(d = new Date(), opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(locale(), opts).format(d);
}

export function fmtRelative(ms) {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60e3) return rtf.format(Math.round(diff / 1e3), 'second');
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}

export function weekdayNames(style = 'short') {
  return Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2024, 0, 7 + i), { weekday: style }));
}

// ——— shared strings used by the shell ———
addStrings({
  en: {
    'common.cancel': 'Cancel',
    'common.done': 'Done',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.remove': 'Remove',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.ok': 'OK',
    'common.back': 'Back',
    'common.more': 'More options',
    'common.search': 'Search',
    'common.rename': 'Rename',
    'common.open': 'Open',
    'common.openNewTab': 'Open in new tab',
    'common.today': 'Today',
    'common.tomorrow': 'Tomorrow',
    'common.yesterday': 'Yesterday',
    'common.none': 'None',
    'common.on': 'On',
    'common.off': 'Off',
    'common.close': 'Close',
    'common.settings': 'Settings',
    'common.undo': 'Undo',
    'common.untitled': 'Untitled',
    'common.empty': 'Nothing here yet',
  },
  ar: {
    'common.cancel': 'إلغاء',
    'common.done': 'تم',
    'common.save': 'حفظ',
    'common.delete': 'حذف',
    'common.remove': 'إزالة',
    'common.edit': 'تعديل',
    'common.add': 'إضافة',
    'common.ok': 'موافق',
    'common.back': 'رجوع',
    'common.more': 'خيارات إضافية',
    'common.search': 'بحث',
    'common.rename': 'إعادة تسمية',
    'common.open': 'فتح',
    'common.openNewTab': 'فتح في تبويب جديد',
    'common.today': 'اليوم',
    'common.tomorrow': 'غدًا',
    'common.yesterday': 'أمس',
    'common.none': 'لا شيء',
    'common.on': 'تشغيل',
    'common.off': 'إيقاف',
    'common.close': 'إغلاق',
    'common.settings': 'الإعدادات',
    'common.undo': 'تراجع',
    'common.untitled': 'بدون عنوان',
    'common.empty': 'لا يوجد شيء هنا بعد',
  },
});
