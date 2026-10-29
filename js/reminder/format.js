// How reminders read in the UI language: "Today at 6:00 PM", "Every 2 weeks on Mon, Thu", "15 minutes before".
import { sameDay } from '../core/util.js';
import { addStrings, t, fmtDate, fmtTime, weekdayNames } from '../core/i18n.js';
import { DEF_CAT } from './model.js';

/** "Today at 6:00 PM", "Tomorrow at 9:00 AM", "Fri, Oct 30 at 8:15 AM" (the year when it isn't this year). */
export function fmtDue(due) {
  const d = new Date(due);
  const now = new Date();
  const time = fmtTime(d);
  if (sameDay(d, now)) return t('rem.at', { date: t('common.today'), time });
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return t('rem.at', { date: t('common.tomorrow'), time });
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('rem.at', { date: t('common.yesterday'), time });
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return t('rem.at', { date: fmtDate(d, opts), time });
}

/** A day heading: Today / Tomorrow / Yesterday / "Wednesday, October 28". */
export function dayLabel(ms) {
  const d = new Date(ms), now = new Date();
  if (sameDay(d, now)) return t('common.today');
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return t('common.tomorrow');
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('common.yesterday');
  return fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

const UNITS = {
  d: (n) => (n === 1 ? t('rem.rep.daily') : t('rem.rep.everyNDays', { n })),
  w: (n) => (n === 1 ? t('rem.rep.weekly') : n === 2 ? t('rem.rep.biweekly') : t('rem.rep.everyNWeeks', { n })),
  m: (n) => (n === 1 ? t('rem.rep.monthly') : t('rem.rep.everyNMonths', { n })),
  y: (n) => (n === 1 ? t('rem.rep.yearly') : t('rem.rep.everyNYears', { n })),
};
/** "Daily", "Weekdays", "Every 2 weeks on Mon, Thu", "Monthly" (+ "until …"). */
export function repeatText(rp) {
  if (!rp) return t('rem.rep.none');
  const n = rp.n || 1, days = rp.days || [];
  let s;
  if (rp.f === 'w' && n === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x))) s = t('rem.rep.weekdays');
  else if (rp.f === 'w' && n === 1 && days.length === 2 && days.includes(0) && days.includes(6)) s = t('rem.rep.weekends');
  else if (rp.f === 'w' && days.length) {
    const names = weekdayNames('short');
    s = t('rem.rep.on', { every: UNITS.w(n), days: days.slice().sort().map((i) => names[i]).join(t('rem.listSep')) });
  } else s = (UNITS[rp.f] || UNITS.d)(n);
  if (rp.end) s = t('rem.rep.until', { rep: s, date: fmtDate(new Date(rp.end), { month: 'short', day: 'numeric', year: 'numeric' }) });
  return s;
}

/** "5 minutes before", "1 hour before", "1 day before", "1 week before". */
export function earlyText(min) {
  if (!min) return t('rem.early.none');
  if (min < 60) return t('rem.early.min', { n: min });
  if (min === 60) return t('rem.early.hour');
  if (min < 1440) return t('rem.early.hours', { n: min / 60 });
  if (min === 1440) return t('rem.early.day');
  if (min < 10080) return t('rem.early.days', { n: min / 1440 });
  return t('rem.early.week');
}

/** A category's name: the default one stays translated until the user renames it. */
export const catName = (c) => (c?.name || (c?.id === DEF_CAT || !c ? t('rem.cat.default') : t('common.untitled')));

addStrings({
  en: {
    'rem.at': '{date} at {time}',
    'rem.cat.default': 'Reminders',
    'rem.listSep': ', ',
    'rem.rep.none': 'Don’t repeat',
    'rem.rep.daily': 'Daily',
    'rem.rep.weekdays': 'Weekdays',
    'rem.rep.weekends': 'Weekends',
    'rem.rep.weekly': 'Weekly',
    'rem.rep.biweekly': 'Every 2 weeks',
    'rem.rep.monthly': 'Monthly',
    'rem.rep.yearly': 'Yearly',
    'rem.rep.everyNDays': 'Every {n} days',
    'rem.rep.everyNWeeks': 'Every {n} weeks',
    'rem.rep.everyNMonths': 'Every {n} months',
    'rem.rep.everyNYears': 'Every {n} years',
    'rem.rep.on': '{every} on {days}',
    'rem.rep.until': '{rep}, until {date}',
    'rem.early.none': 'None',
    'rem.early.min': '{n} minutes before',
    'rem.early.hour': '1 hour before',
    'rem.early.hours': '{n} hours before',
    'rem.early.day': '1 day before',
    'rem.early.days': '{n} days before',
    'rem.early.week': '1 week before',
  },
  ar: {
    'rem.at': '{date} في {time}',
    'rem.cat.default': 'التذكيرات',
    'rem.listSep': '، ',
    'rem.rep.none': 'بدون تكرار',
    'rem.rep.daily': 'يوميًا',
    'rem.rep.weekdays': 'أيام العمل',
    'rem.rep.weekends': 'عطلات نهاية الأسبوع',
    'rem.rep.weekly': 'أسبوعيًا',
    'rem.rep.biweekly': 'كل أسبوعين',
    'rem.rep.monthly': 'شهريًا',
    'rem.rep.yearly': 'سنويًا',
    'rem.rep.everyNDays': 'كل {n} أيام',
    'rem.rep.everyNWeeks': 'كل {n} أسابيع',
    'rem.rep.everyNMonths': 'كل {n} أشهر',
    'rem.rep.everyNYears': 'كل {n} سنوات',
    'rem.rep.on': '{every} يوم {days}',
    'rem.rep.until': '{rep}، حتى {date}',
    'rem.early.none': 'لا شيء',
    'rem.early.min': 'قبل {n} دقيقة',
    'rem.early.hour': 'قبل ساعة واحدة',
    'rem.early.hours': 'قبل {n} ساعات',
    'rem.early.day': 'قبل يوم واحد',
    'rem.early.days': 'قبل {n} أيام',
    'rem.early.week': 'قبل أسبوع واحد',
  },
});
