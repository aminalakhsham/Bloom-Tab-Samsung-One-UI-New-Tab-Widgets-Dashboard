// Calendar formatting shared by the registration module (widgets, search), the app UI and the editor: event time
// ranges (the "→" of a multi-day event points the reading direction, so it turns around in Arabic), weekday labels
// from the first day of the week, the alternate calendar (Hijri…) through Intl, and repeat / reminder wording.
import { t, fmtDate, fmtTime, locale, isRtl, use12h, lang } from '../core/i18n.js';
import * as M from './model.js';
import { firstDay, prefs } from './data.js';

/** "→" in English, "←" in Arabic: the arrow of an event that goes on past this day (or came from an earlier one). */
export const arrow = () => (isRtl() ? '←' : '→');
const isolate = (s) => '⁨' + s + '⁩';

/** The time line of an event on a given day: "All day", "9:00 – 10:00", "9:00 →", "→ 18:00"; without a day a
 *  multi-day event names its end date. */
export function eventTime(o, day) {
  if (o.allDay) return t('cal.allDay');
  const s = new Date(o.start), e = new Date(o.end), a = arrow();
  if (day) {
    const sd = M.sameDay(s, day), ed = M.sameDay(new Date(Math.max(o.start, o.end - 1)), day);
    if (!sd && !ed) return t('cal.allDay');
    if (!sd) return `${a} ${isolate(fmtTime(e))}`;
    if (!ed && M.daysBetween(s, e) > 0) return `${isolate(fmtTime(s))} ${a}`;
  } else if (M.daysBetween(s, Math.max(o.start, o.end - 1)) > 0) {
    return `${isolate(fmtTime(s))} – ${isolate(fmtDate(e, { month: 'short', day: 'numeric' }) + ' ' + fmtTime(e))}`;
  }
  return o.end > o.start ? `${isolate(fmtTime(s))} – ${isolate(fmtTime(e))}` : isolate(fmtTime(s));
}

/** "Mon, Oct 26 · 9:00 – 10:00" for lists without day headers (search results, widgets). */
export function eventWhen(o) {
  const d = fmtDate(new Date(o.start), { weekday: 'short', month: 'short', day: 'numeric' });
  if (o.allDay) {
    const last = M.lastDay(o);
    return M.daysBetween(o.start, last) > 0 ? `${d} – ${fmtDate(last, { weekday: 'short', month: 'short', day: 'numeric' })}` : `${d} · ${t('cal.allDay')}`;
  }
  return `${d} · ${eventTime(o)}`;
}

/** Full "from – to" text for the event detail. */
export function rangeText(o) {
  const dOpts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  const last = M.lastDay(o);
  if (o.allDay) return M.daysBetween(o.start, last) ? `${fmtDate(new Date(o.start), dOpts)} – ${fmtDate(last, dOpts)}` : fmtDate(new Date(o.start), dOpts);
  if (M.daysBetween(o.start, last)) return `${fmtDate(new Date(o.start), dOpts)} ${fmtTime(new Date(o.start))} – ${fmtDate(new Date(o.end), dOpts)} ${fmtTime(new Date(o.end))}`;
  return `${fmtDate(new Date(o.start), dOpts)}\n${fmtTime(new Date(o.start))} – ${fmtTime(new Date(o.end))}`;
}

/** Weekday labels in order from the first day of the week: [{ wd, label }]. */
export function weekdayLabels(style = 'short', first = firstDay()) {
  return Array.from({ length: 7 }, (_, i) => {
    const wd = (first + i) % 7;
    return { wd, label: fmtDate(new Date(2024, 0, 7 + wd), { weekday: style }) };
  });
}
export const weekdayName = (wd, style = 'long') => fmtDate(new Date(2024, 0, 7 + wd), { weekday: style });

/** Hour label for the timelines: "9 AM" / "09:00". */
export function hourLabel(h) {
  if (use12h()) return new Intl.DateTimeFormat(locale(), { hour: 'numeric', hour12: true }).format(new Date(2024, 0, 1, h));
  return String(h).padStart(2, '0') + ':00';
}

// ——— alternate calendar (Samsung's "Alternate calendar": Hijri, Persian, Hebrew, Chinese lunar) ———
export const ALT_CALS = ['islamic-umalqura', 'persian', 'hebrew', 'chinese'];
const altFmt = new Map();
function altFormatter(cal, opts) {
  const k = cal + JSON.stringify(opts) + locale();
  if (!altFmt.has(k)) {
    try { altFmt.set(k, new Intl.DateTimeFormat(locale(), { calendar: cal, ...opts })); } catch { altFmt.set(k, null); }
  }
  return altFmt.get(k);
}
export const altCal = () => (ALT_CALS.includes(prefs().alt) ? prefs().alt : '');
/** { day, month, year, first } of a date in the alternate calendar, or null when it's off. */
export function altParts(d, cal = altCal()) {
  if (!cal) return null;
  const f = altFormatter(cal, { day: 'numeric', month: 'short', year: 'numeric' });
  if (!f) return null;
  const p = {};
  for (const x of f.formatToParts(d)) if (!p[x.type]) p[x.type] = x.value;
  const day = (p.day || '').replace(/\D/g, '') || p.day || '';
  return { day, month: p.month || '', year: (p.year || p.relatedYear || '').replace(/[^\d]/g, ''), first: +day === 1 };
}
/** "14 Rabiʻ II 1448" */
export function altLong(d, cal = altCal()) {
  const f = cal && altFormatter(cal, { day: 'numeric', month: 'long', year: 'numeric' });
  return f ? f.format(d) : '';
}
/** "Rabiʻ II – Jumada I 1448" for a month view. */
export function altRange(a, b, cal = altCal()) {
  const f = cal && altFormatter(cal, { month: 'long', year: 'numeric' });
  if (!f) return '';
  const x = f.format(a), y = f.format(b);
  return x === y ? x : `${x} – ${y}`;
}
export const altName = (cal) => t({ '': 'cal.altNone', 'islamic-umalqura': 'cal.altHijri', persian: 'cal.altPersian', hebrew: 'cal.altHebrew', chinese: 'cal.altChinese' }[cal] || 'cal.altNone');

// ——— repeat and reminders ———
/** A counted phrase: Arabic picks its two / few (3–10) / many form ('cal.x.two', 'cal.x.few'…) when the table has one. */
const plRules = new Map();
export function pl(key, vars) {
  const n = vars?.n;
  if (lang() === 'ar' && Number.isFinite(n)) {
    if (!plRules.has('ar')) plRules.set('ar', new Intl.PluralRules('ar'));
    const k = key + '.' + plRules.get('ar').select(n);
    const s = t(k, vars);
    if (s !== k) return s;
  }
  return t(key, vars);
}
const ORD = { 1: 'cal.ord1', 2: 'cal.ord2', 3: 'cal.ord3', 4: 'cal.ord4', '-1': 'cal.ordLast' };
/** "Every week on Monday and Wednesday", "Every 2 months on the fourth Monday", "Every year on October 26 · 5 times". */
export function repeatText(r, start) {
  if (!r) return t('cal.repNone');
  const d = new Date(start), n = r.interval || 1;
  let s;
  if (r.freq === 'day') s = n === 1 ? t('cal.repDaily') : pl('cal.repDays', { n });
  else if (r.freq === 'week') {
    const days = r.days?.length ? r.days : [d.getDay()];
    const wk = days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x)) && n === 1;
    s = wk ? t('cal.repWeekdays') : (n === 1 ? t : pl)(n === 1 ? 'cal.repWeekly' : 'cal.repWeeks', { n, days: listText(days.map((x) => weekdayName(x))) });
  } else if (r.freq === 'month') {
    const on = r.pos ? t('cal.onNth', { nth: t(ORD[r.pos]), day: weekdayName(r.wd ?? d.getDay()) }) : t('cal.onDay', { n: d.getDate() });
    s = (n === 1 ? t : pl)(n === 1 ? 'cal.repMonthly' : 'cal.repMonths', { n, on });
  } else {
    const on = r.pos ? t('cal.onNthOf', { nth: t(ORD[r.pos]), day: weekdayName(r.wd ?? d.getDay()), month: fmtDate(d, { month: 'long' }) }) : fmtDate(d, { month: 'long', day: 'numeric' });
    s = (n === 1 ? t : pl)(n === 1 ? 'cal.repYearly' : 'cal.repYears', { n, on });
  }
  if (r.until) s += ' · ' + t('cal.until', { date: fmtDate(M.parseKey(r.until), { month: 'short', day: 'numeric', year: 'numeric' }) });
  else if (r.count) s += ' · ' + pl('cal.times', { n: r.count });
  return s;
}
function listText(items) {
  try { return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(items); } catch { return items.join(', '); }
}

/** "10 minutes before", "1 day before at 9:00 AM", "On the day at 9:00 AM". */
export function alertText(min, allDay) {
  if (allDay) {
    const at = fmtTime(new Date(2024, 0, 1, 9, 0));
    if (min === 0) return t('cal.alOnDay', { t: at });
    if (min % 10080 === 0) return min === 10080 ? t('cal.alWeekBeforeAt', { t: at }) : pl('cal.alWeeksBeforeAt', { n: min / 10080, t: at });
    if (min % 1440 === 0) return min === 1440 ? t('cal.alDayBeforeAt', { t: at }) : pl('cal.alDaysBeforeAt', { n: min / 1440, t: at });
    return pl('cal.alMinBefore', { n: min });
  }
  if (min === 0) return t('cal.alAtStart');
  if (min % 10080 === 0) return min === 10080 ? t('cal.alWeekBefore') : pl('cal.alWeeksBefore', { n: min / 10080 });
  if (min % 1440 === 0) return min === 1440 ? t('cal.alDayBefore') : pl('cal.alDaysBefore', { n: min / 1440 });
  if (min % 60 === 0) return min === 60 ? t('cal.alHourBefore') : pl('cal.alHoursBefore', { n: min / 60 });
  return pl('cal.alMinBefore', { n: min });
}

/** "(GMT+03:00) Riyadh" */
export function zoneLabel(tz, at = Date.now()) {
  const off = M.zoneOffset(tz, at), sign = off < 0 ? '-' : '+', a = Math.abs(off);
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return `(GMT${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}) ${city}`;
}
export const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
