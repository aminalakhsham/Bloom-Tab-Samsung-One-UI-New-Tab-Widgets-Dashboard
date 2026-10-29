// Contacts on pages: Samsung's round avatars (photo, sticker or the first letter on a colour picked from the contact),
// translated field labels, birthday and date texts, and hand-off links (tel:, sms:, mailto:). Used by the app, its
// widgets, Finder results and the Lock screen chip, so it loads with js/apps/contacts.js.
import { escapeHtml, frag } from '../core/util.js';
import { addIcons, icon } from '../core/icons.js';
import { blobUrl } from '../core/blobs.js';
import { addStrings, t, fmtDate } from '../core/i18n.js';
import * as M from './model.js';

addIcons({
  ctPerson: '<circle cx="12" cy="8.6" r="4.2" fill="currentColor" stroke="none"/><path d="M3.8 21c.6-4.4 3.9-7.1 8.2-7.1s7.6 2.7 8.2 7.1z" fill="currentColor" stroke="none"/>',
  ctPhone: '<path d="M7.4 3.3c.6-.2 1.2.1 1.5.6l1.6 3.4c.3.6.1 1.2-.4 1.6l-1.5 1.2a12 12 0 0 0 5.3 5.3l1.2-1.5c.4-.5 1-.7 1.6-.4l3.4 1.6c.5.3.8.9.6 1.5l-.6 2.2c-.3.9-1.1 1.5-2 1.5C9.8 20.3 3.7 14.2 3.7 6.3c0-1 .6-1.8 1.5-2z"/>',
  ctMsg: '<path d="M12 4C7.3 4 3.5 7.1 3.5 11c0 2.2 1.2 4.1 3.1 5.4l-.6 3.1 3.4-1.8c.8.2 1.7.3 2.6.3 4.7 0 8.5-3.1 8.5-7S16.7 4 12 4Z"/>',
  ctVideo: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.6"/><path d="m15.5 10.6 4.6-2.7c.4-.2.9.1.9.5v7.2c0 .4-.5.7-.9.5l-4.6-2.7"/>',
  ctMail: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="m3.8 7.2 8.2 6 8.2-6"/>',
  ctCake: '<path d="M4.5 20.5h15M5.5 20.5v-6.8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6.8M5.5 15.6c1.6 1.2 2.9 1.2 4.4 0s2.9-1.2 4.2 0 2.8 1.2 4.4 0M12 11.7V8.6"/><path d="M12 3.4c.9 1 1.3 1.8 1.3 2.5a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.5Z"/>',
  ctGroup: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.5-3.4 2.8-5.4 6-5.4s5.5 2 6 5.4"/><path d="M15.2 5.6a3.2 3.2 0 0 1 0 6M17.6 14.3c1.9.6 3.1 2.3 3.4 5.2"/>',
  ctMerge: '<path d="M6 3.5v4c0 2.8 6 3.7 6 7.5v5.5M18 3.5v4c0 2.8-6 3.7-6 7.5"/><path d="m9 18 3 3 3-3"/>',
  ctBin: '<path d="M4.5 7h15M6 7l1 12.5a1.6 1.6 0 0 0 1.6 1.5h6.8a1.6 1.6 0 0 0 1.6-1.5L18 7M9 7V4.6c0-.4.3-.6.6-.6h4.8c.3 0 .6.2.6.6V7"/><path d="M14.6 12.4a2.7 2.7 0 1 0 .1 2.9M14.8 10.6v1.9h-1.9"/>',
  ctMenu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  ctImport: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>',
  ctExport: '<path d="M12 14.5v-11M7.5 8 12 3.5 16.5 8M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"/>',
  ctWave: '<path d="M8.5 12.5V6a1.4 1.4 0 0 1 2.8 0v5M11.3 10.5V4.6a1.4 1.4 0 0 1 2.8 0v6M14.1 10.6V6a1.4 1.4 0 0 1 2.8 0v7.5M16.9 9.5a1.4 1.4 0 0 1 2.8 0v4.8a7 7 0 0 1-7 7h-.9a7 7 0 0 1-5.6-2.8L3.6 15a1.5 1.5 0 0 1 2.3-1.9l2.6 2.4"/>',
  ctCamera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.8" r="3.4"/>',
  ctRestore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  ctCard: '<rect x="2.5" y="5" width="19" height="14" rx="2.6"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.2c.5-1.6 1.8-2.4 3.5-2.4s3 .8 3.5 2.4M14.5 10h4.5M14.5 13.5h3"/>',
});

// ------------------------------------------------------------------ labels
const LABEL_KEYS = ['mobile', 'home', 'work', 'school', 'main', 'homefax', 'workfax', 'pager', 'other', 'homepage', 'anniversary', 'birthday',
  'mother', 'father', 'parent', 'brother', 'sister', 'child', 'son', 'daughter', 'friend', 'spouse', 'wife', 'husband', 'partner', 'assistant', 'manager'];
/** A label as shown: built-in ones translated, brand names and custom labels as they are. */
export const labelText = (l) => (LABEL_KEYS.includes(l) ? t('contacts.label.' + l) : String(l || ''));
export const fieldName = (k) => t('contacts.f.' + k);
export const addrPart = (k) => t('contacts.addr.' + k);
export const contactName = (c, order) => M.displayName(c, order) || t('contacts.noName');
export const countText = (n) => (n === 1 ? t('contacts.count1') : t('contacts.count', { n }));

// ------------------------------------------------------------------ dates
/** "15 June 1990", or "15 June" without a year, in the UI language. */
export function dayText(v, { short = false } = {}) {
  const d = M.parseDay(v);
  if (!d) return '';
  const date = new Date(d.y || 2000, d.m - 1, d.d);
  return fmtDate(date, d.y ? { month: short ? 'short' : 'long', day: 'numeric', year: 'numeric' } : { month: short ? 'short' : 'long', day: 'numeric' });
}
/** "Today", "Tomorrow", "In 5 days" or a short date, for upcoming birthdays. */
export function whenText(date, now = new Date()) {
  const days = M.daysUntil(date, now);
  if (days === 0) return t('common.today');
  if (days === 1) return t('common.tomorrow');
  if (days < 7) return t('contacts.inDays', { n: days });
  return fmtDate(date, { month: 'short', day: 'numeric' });
}
export const ageText = (age) => (age > 0 ? t('contacts.turns', { n: age }) : '');
/** "Tomorrow · Turns 31" */
export const birthdaySub = (b, now) => [whenText(b.date, now), ageText(b.age)].filter(Boolean).join(' · ');

// ------------------------------------------------------------------ avatars
// One UI's contact colours: soft but saturated enough for a white letter.
export const AV_COLORS = ['#4f8df5', '#38b2a0', '#62b85a', '#f0934a', '#e9677f', '#9a7ce6', '#e0ab33', '#e5655a', '#3fa6dc', '#a98b6c'];
/** The avatar colour of a contact: the one picked in the editor, else one derived from its id so it never changes. */
export function avatarColor(c) {
  if (c?.av?.c) return c.av.c;
  let h = 0;
  for (const ch of String(c?.id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
/** The round picture of a contact as HTML: its photo (loaded by hydrate()), a sticker, the first letter, or a person. */
export function avatarHTML(c, { size = 40, order, cls = '' } = {}) {
  const emoji = c?.av?.e, ini = M.initial(c, order);
  const face = emoji ? `<span class="ct-av-e">${escapeHtml(emoji)}</span>` : ini ? `<span class="ct-av-i">${escapeHtml(ini)}</span>` : `<span class="ct-av-p">${icon('ctPerson', Math.round(size * 0.62))}</span>`;
  const photo = c?.photo ? `<img alt="" data-photo="${escapeHtml(c.photo)}">` : '';
  return `<span class="ct-av ${emoji ? 'emoji' : ''} ${cls}" style="--s:${size}px;--c:${escapeHtml(avatarColor(c))}" aria-hidden="true">${face}${photo}</span>`;
}
export const avatarEl = (c, opts) => {
  const el = frag(avatarHTML(c, opts));
  hydrate(el);
  return el;
};
/** Loads the photos of the avatars inside `root` (a photo that isn't on this computer leaves the letter). */
export async function hydrate(root) {
  for (const img of root.querySelectorAll('img[data-photo]:not([src])')) {
    const u = await blobUrl(img.dataset.photo).catch(() => null);
    if (u) {
      img.src = u;
      img.closest('.ct-av')?.classList.add('has-photo');
    } else img.remove();
  }
}

// ------------------------------------------------------------------ hand-off links
export const telOf = (v) => String(v || '').replace(/[^\d+*#,;]/g, '');
/** Opens a hand-off link (tel:, sms:, mailto:) without leaving the page; the system picks the app. */
export function handOff(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.click();
}

addStrings({
  en: {
    'contacts.noName': 'No name',
    'contacts.count': '{n} contacts',
    'contacts.count1': '1 contact',
    'contacts.inDays': 'In {n} days',
    'contacts.turns': 'Turns {n}',
    'contacts.label.mobile': 'Mobile', 'contacts.label.home': 'Home', 'contacts.label.work': 'Work', 'contacts.label.school': 'School',
    'contacts.label.main': 'Main', 'contacts.label.homefax': 'Home fax', 'contacts.label.workfax': 'Work fax', 'contacts.label.pager': 'Pager',
    'contacts.label.other': 'Other', 'contacts.label.homepage': 'Homepage', 'contacts.label.anniversary': 'Anniversary', 'contacts.label.birthday': 'Birthday',
    'contacts.label.mother': 'Mother', 'contacts.label.father': 'Father', 'contacts.label.parent': 'Parent', 'contacts.label.brother': 'Brother',
    'contacts.label.sister': 'Sister', 'contacts.label.child': 'Child', 'contacts.label.son': 'Son', 'contacts.label.daughter': 'Daughter',
    'contacts.label.friend': 'Friend', 'contacts.label.spouse': 'Spouse', 'contacts.label.wife': 'Wife', 'contacts.label.husband': 'Husband',
    'contacts.label.partner': 'Partner', 'contacts.label.assistant': 'Assistant', 'contacts.label.manager': 'Manager',
    'contacts.f.prefix': 'Name prefix', 'contacts.f.first': 'First name', 'contacts.f.pfirst': 'Phonetic first name', 'contacts.f.middle': 'Middle name',
    'contacts.f.pmiddle': 'Phonetic middle name', 'contacts.f.last': 'Last name', 'contacts.f.plast': 'Phonetic last name', 'contacts.f.maiden': 'Maiden name',
    'contacts.f.suffix': 'Name suffix', 'contacts.f.nick': 'Nickname', 'contacts.f.job': 'Job title', 'contacts.f.dept': 'Department',
    'contacts.f.company': 'Company', 'contacts.f.pcompany': 'Phonetic company name',
    'contacts.addr.street': 'Street', 'contacts.addr.city': 'City', 'contacts.addr.region': 'State or region', 'contacts.addr.zip': 'Postcode',
    'contacts.addr.country': 'Country',
  },
  ar: {
    'contacts.noName': 'بلا اسم',
    'contacts.count': '{n} جهة اتصال',
    'contacts.count1': 'جهة اتصال واحدة',
    'contacts.inDays': 'بعد {n} أيام',
    'contacts.turns': 'يبلغ {n}',
    'contacts.label.mobile': 'الجوال', 'contacts.label.home': 'المنزل', 'contacts.label.work': 'العمل', 'contacts.label.school': 'المدرسة',
    'contacts.label.main': 'رئيسي', 'contacts.label.homefax': 'فاكس المنزل', 'contacts.label.workfax': 'فاكس العمل', 'contacts.label.pager': 'جهاز النداء',
    'contacts.label.other': 'أخرى', 'contacts.label.homepage': 'الصفحة الرئيسية', 'contacts.label.anniversary': 'ذكرى سنوية', 'contacts.label.birthday': 'تاريخ الميلاد',
    'contacts.label.mother': 'الأم', 'contacts.label.father': 'الأب', 'contacts.label.parent': 'أحد الوالدين', 'contacts.label.brother': 'الأخ',
    'contacts.label.sister': 'الأخت', 'contacts.label.child': 'الطفل', 'contacts.label.son': 'الابن', 'contacts.label.daughter': 'الابنة',
    'contacts.label.friend': 'صديق', 'contacts.label.spouse': 'الزوج/الزوجة', 'contacts.label.wife': 'الزوجة', 'contacts.label.husband': 'الزوج',
    'contacts.label.partner': 'الشريك', 'contacts.label.assistant': 'المساعد', 'contacts.label.manager': 'المدير',
    'contacts.f.prefix': 'بادئة الاسم', 'contacts.f.first': 'الاسم الأول', 'contacts.f.pfirst': 'الاسم الأول (صوتيًا)', 'contacts.f.middle': 'الاسم الأوسط',
    'contacts.f.pmiddle': 'الاسم الأوسط (صوتيًا)', 'contacts.f.last': 'اسم العائلة', 'contacts.f.plast': 'اسم العائلة (صوتيًا)', 'contacts.f.maiden': 'اسم العائلة قبل الزواج',
    'contacts.f.suffix': 'لاحقة الاسم', 'contacts.f.nick': 'اسم الشهرة', 'contacts.f.job': 'المسمى الوظيفي', 'contacts.f.dept': 'القسم',
    'contacts.f.company': 'الشركة', 'contacts.f.pcompany': 'اسم الشركة (صوتيًا)',
    'contacts.addr.street': 'الشارع', 'contacts.addr.city': 'المدينة', 'contacts.addr.region': 'الولاية أو المنطقة', 'contacts.addr.zip': 'الرمز البريدي',
    'contacts.addr.country': 'البلد',
  },
});
