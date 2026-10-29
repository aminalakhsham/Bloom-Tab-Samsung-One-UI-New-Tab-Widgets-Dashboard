// Digital Wellbeing pieces the registration module (js/apps/wellbeing.js, loaded with every new tab) and the app's UI
// share: the stored choices and usage, Samsung's durations ("2 hrs 31 mins"), the donut chart, site icons and the glyphs.
// Kept small on purpose: the screens themselves live in ui.js and load when the app opens.
import { h, escapeHtml } from '../core/util.js';
import { addIcons } from '../core/icons.js';
import { t, addStrings, locale } from '../core/i18n.js';
import { store } from '../core/store.js';
import { siteIconEl } from '../shell/appicon.js';
import * as M from './model.js';

addIcons({
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.5 3.5c0 4.2 4.5 5.5 4.5 8.5s-4.5 4.3-4.5 8.5M16.5 3.5c0 4.2-4.5 5.5-4.5 8.5s4.5 4.3 4.5 8.5"/><path d="M9.5 18.6c.8-1.3 2.5-2 2.5-2s1.7.7 2.5 2" fill="currentColor"/>',
  bedtime: '<path d="M17.5 14.6A7 7 0 0 1 9.4 6.5a7 7 0 1 0 8.1 8.1Z"/><path d="M14.5 4h3.5l-3.5 4h3.5M18.5 9.5H21l-2.5 3H21"/>',
  wbDonut: '<path d="M12 3.5a8.5 8.5 0 1 1-8.2 6.3"/><path d="M12 7.5a4.5 4.5 0 1 1-4.4 3.6"/><path d="M5.6 6.2 8.3 8.4"/>',
  wbWork: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17M11 12.5v1.5h2v-1.5"/>',
  wbLeaf: '<path d="M5 19c0-8 4.5-13.5 14.5-14.5C19 14 13.5 19 5 19Z"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  wbBook: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 0 4 21V5.5ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5A1.5 1.5 0 0 1 20 21V5.5Z"/>',
  wbRun: '<circle cx="14" cy="4.8" r="1.8"/><path d="m6 21 3.5-5.5 3 2.5 1-5.5M9 9.5l3.5-2 3 3.5 3 .5M12.5 7.5l1 5.5"/>',
  wbCode: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  wbChat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8Z"/>',
  wbGame: '<path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.3 5.8l-1 3.4a2.3 2.3 0 0 1-4 .7L14.3 16H9.7l-1.5 1.4a2.3 2.3 0 0 1-4-.7l-1-3.4a4.5 4.5 0 0 1 4.3-5.8Z"/><path d="M8.5 10.5v3M7 12h3M15.5 11h.01M17 13h.01" stroke-width="2"/>',
  wbFilm: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m10 9.2 4.8 2.8-4.8 2.8V9.2Z" fill="currentColor"/>',
  wbBrush: '<path d="M14.5 4.5 19.5 9.5 11 18l-5-5 8.5-8.5Z"/><path d="M6 13c-2 0-3 1.5-3 3.5 0 1.5-.5 2.5-1 3 3 .5 7-.5 7-3.5"/>',
  wbSchool: '<path d="m2.5 9.5 9.5-5 9.5 5-9.5 5-9.5-5Z"/><path d="M6.5 11.6V16c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4v-4.4M21.5 9.5v5"/>',
  wbHeart: '<path d="M12 19.5s-7.5-4.4-7.5-10A4 4 0 0 1 12 7.2a4 4 0 0 1 7.5 2.3c0 5.6-7.5 10-7.5 10Z"/>',
  wbTool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5Z" transform="rotate(0)"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  wbBag: '<path d="M5.5 8h13l-1 12.5h-11L5.5 8Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
  wbDots: '<circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/>',
  wbGoal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  wbReport: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 16v-3M12 16V9M16 16v-5"/>',
  wbGray: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor"/>',
  wbBlock: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
});

// Samsung Digital Wellbeing colours for the dashboard donut: the most used sites in blue, sky, mint, amber and rose,
// everything else grey (--wb-other in wellbeing.css follows light/dark).
export const PALETTE = ['#3e7bfa', '#4cc3f5', '#38c9a0', '#ffb02e', '#f26d8d'];
export const OTHER = 'var(--wb-other)';

export const prefs = () => M.prefs(store.get('wellbeing'));
export const usage = () => {
  const u = store.get('wellbeingUsage');
  return u && typeof u === 'object' ? { days: u.days || {}, g: u.g || {} } : { days: {}, g: {} };
};
export const weekStart = () => M.firstDayFor(locale());
export const today = () => M.period(usage(), { mode: 'day' });

/** Writes `wellbeing` (a patch over the current choices, or a function of them). */
export function savePrefs(patch) {
  store.update('wellbeing', (cur) => {
    const w = M.prefs(cur);
    return { ...(cur || {}), ...(typeof patch === 'function' ? patch(w) : patch) };
  });
}

/** Samsung's durations: "2 hrs 31 mins", "45 mins" ('long'), "2h 31m" ('short', charts and widgets). */
export function dur(sec, style = 'long') {
  const { h: hh, m: mm } = M.durParts(sec);
  if (style === 'short') {
    const hs = hh ? t('wellbeing.hShort', { n: hh }) : '', ms = mm || !hh ? t('wellbeing.mShort', { n: mm }) : '';
    return [hs, ms].filter(Boolean).join(' ');
  }
  if (!hh && !mm) return sec >= 1 ? t('wellbeing.lt1') : t('wellbeing.mins', { n: 0 });
  const hs = hh ? (hh === 1 ? t('wellbeing.hr') : t('wellbeing.hrs', { n: hh })) : '';
  const ms = mm ? (mm === 1 ? t('wellbeing.min') : t('wellbeing.mins', { n: mm })) : '';
  return [hs, ms].filter(Boolean).join(' ');
}

/** A mode's name: the built-in ones are translated, custom ones are the person's own. */
export const modeName = (m) => (m ? (m.name ? m.name : t('wellbeing.mode.' + m.id)) : '');

/** The site's icon, as on the Home screen (favicon on a tinted squircle, or a letter). */
export const siteIcon = (site, cls = '') => {
  const el = siteIconEl({ url: 'https://' + site + '/', title: site });
  el.classList.add('wb-sico');
  if (cls) el.classList.add(cls);
  return el;
};

/**
 * The donut: one ring of slices [{ sec, color }] clockwise from the top with small gaps between them, like Samsung's
 * dashboard. An empty day draws the bare track.
 */
export function donutSvg(parts, { size = 200, stroke = 20, gap = 3 } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, total = parts.reduce((a, p) => a + p.sec, 0);
  const track = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--wb-track)" stroke-width="${stroke}"/>`;
  let at = 0;
  const segs = total > 0 ? parts.map((p) => {
    const len = (p.sec / total) * c;
    const g = parts.length > 1 ? Math.min(gap, len * 0.4) : 0;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${escapeHtml(p.color)}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0.01, len - g).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}"/>`;
    at += len;
    return seg;
  }).join('') : '';
  return `<svg class="wb-donut-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true"><g transform="rotate(-90 ${size / 2} ${size / 2})">${track}${segs}</g></svg>`;
}

/** Today's slices by site: the top four in the palette, the rest grey. */
export function siteSlices(p, n = 4) {
  return M.slices(p.sites, n).map((s, i) => ({ ...s, color: s.key ? PALETTE[i % PALETTE.length] : OTHER }));
}

/** Donut element with the total in the middle (widgets and the dashboard). */
export function donutEl(slices, { center, label, size, stroke, cls = '' } = {}) {
  return h('div', { class: ['wb-donut', cls] },
    h('div', { class: 'wb-donut-ring', html: donutSvg(slices, { size, stroke }) }),
    h('div', { class: 'wb-donut-mid' }, label ? h('span', { class: 'wb-donut-label' }, label) : null, h('b', { class: 'wb-donut-val' }, center)));
}


addStrings({
  en: {
    'app.wellbeing': 'Digital Wellbeing',
    'wellbeing.hrs': '{n} hrs',
    'wellbeing.hr': '1 hr',
    'wellbeing.mins': '{n} mins',
    'wellbeing.min': '1 min',
    'wellbeing.lt1': 'Less than 1 min',
    'wellbeing.hShort': '{n}h',
    'wellbeing.mShort': '{n}m',
    'wellbeing.today': 'Today',
    'wellbeing.other': 'Other',
    'wellbeing.screenTime': 'Screen time',
    'wellbeing.noData': 'No screen time yet today',
    'wellbeing.mode.work': 'Work time',
    'wellbeing.mode.me': 'Me time',
    'wellbeing.bedtime': 'Bedtime mode',
    'wellbeing.focusOn': 'Focus mode',
    'wellbeing.w.screen': 'Screen time',
    'wellbeing.w.top': 'Most used sites',
    'wellbeing.lw': 'Screen time today',
    'wellbeing.cmd.today': 'Screen time today: {t}',
    'wellbeing.cmd.sub': 'Digital Wellbeing',
    'wellbeing.search.sub': 'Today {d} · This week {w}',
  },
  ar: {
    'app.wellbeing': 'الصحة الرقمية',
    'wellbeing.hrs': '{n} س',
    'wellbeing.hr': '1 س',
    'wellbeing.mins': '{n} د',
    'wellbeing.min': '1 د',
    'wellbeing.lt1': 'أقل من دقيقة',
    'wellbeing.hShort': '{n}س',
    'wellbeing.mShort': '{n}د',
    'wellbeing.today': 'اليوم',
    'wellbeing.other': 'أخرى',
    'wellbeing.screenTime': 'وقت استخدام الشاشة',
    'wellbeing.noData': 'لا يوجد وقت استخدام اليوم بعد',
    'wellbeing.mode.work': 'وقت العمل',
    'wellbeing.mode.me': 'وقت لنفسي',
    'wellbeing.bedtime': 'وضع وقت النوم',
    'wellbeing.focusOn': 'وضع التركيز',
    'wellbeing.w.screen': 'وقت استخدام الشاشة',
    'wellbeing.w.top': 'المواقع الأكثر استخدامًا',
    'wellbeing.lw': 'وقت الشاشة اليوم',
    'wellbeing.cmd.today': 'وقت الشاشة اليوم: {t}',
    'wellbeing.cmd.sub': 'الصحة الرقمية',
    'wellbeing.search.sub': 'اليوم {d} · هذا الأسبوع {w}',
  },
});
