// Time zone helpers for the World clock and the clock widgets: offsets, the wall time in a zone, city names in the
// app's language and Samsung's "Today, 7 hours ahead" lines.
import { sameDay } from '../core/util.js';
import { t, lang } from '../core/i18n.js';
import { cityIn } from './cities.js';

export const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();
export const DEFAULT_WORLD = ['Europe/London', 'America/New_York', 'Asia/Tokyo', 'Asia/Dubai'];

const fmtCache = new Map();
/** Minutes east of UTC in `tz` at `date`. */
export function tzOffset(tz, date = new Date()) {
  try {
    let f = fmtCache.get(tz);
    if (!f) fmtCache.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })));
    const p = f.formatToParts(date).find((x) => x.type === 'timeZoneName')?.value || 'GMT';
    const m = p.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  } catch {
    return 0;
  }
}
export const localOffset = (date = new Date()) => -date.getTimezoneOffset();
/** A Date whose local fields show the wall time in `tz`. */
export const wallTime = (tz, now = new Date()) => new Date(now.getTime() + (tzOffset(tz, now) - localOffset(now)) * 60e3);
/** Minutes `tz` is ahead of this computer (negative: behind). */
export const diffMin = (tz, now = new Date()) => tzOffset(tz, now) - localOffset(now);
export const isNight = (d) => d.getHours() < 6 || d.getHours() >= 18;
/** The English city name of a time zone ('America/New_York' → 'New York'). */
export const cityOf = (tz) => String(tz).split('/').pop().replace(/_/g, ' ');
/** A saved clock's (or any English) city name in the app's language. */
export const cityName = (c) => cityIn(typeof c === 'string' ? c : c.city || cityOf(c.tz), lang());

/** t(`${base}.${plural category}`, { n }): every such key has the six forms zero/one/two/few/many/other (Arabic needs them). */
export function pl(base, n) {
  let cat = 'other';
  try {
    cat = new Intl.PluralRules(lang() === 'ar' ? 'ar' : 'en').select(n);
  } catch {}
  return t(`${base}.${cat}`, { n });
}
const plural = (n, unit) => pl('clock.u.' + unit, n);
/** "7 hours 15 minutes" / "7 ساعات و15 دقيقة" (days when it's more than a day away; at least a minute). */
export function fmtSpan(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60e3 - 1e-9));
  const d = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), mm = mins % 60;
  const parts = [];
  if (d) parts.push(plural(d, 'day'));
  if (hh) parts.push(plural(hh, 'hour'));
  if (mm && !d) parts.push(plural(mm, 'min'));
  return parts.join(t('clock.and'));
}
/** "3 hours ahead" / "5.5 hours behind" / "Same time" for a difference in minutes. */
export function diffText(diff) {
  if (!diff) return t('clock.sameTime');
  const hrs = Math.abs(diff) / 60;
  const n = Number.isInteger(hrs) ? hrs : +hrs.toFixed(2);
  return pl(diff > 0 ? 'clock.ahead' : 'clock.behind', n);
}
/** Samsung's line under a world clock city: "Today, 7 hours ahead" / "Tomorrow, 3 hours ahead". */
export function offsetText(tz, now = new Date()) {
  const wall = wallTime(tz, now);
  const day = sameDay(wall, now) ? t('common.today') : wall > now ? t('common.tomorrow') : t('common.yesterday');
  return t('clock.dayOffset', { day, rel: diffText(diffMin(tz, now)) });
}
/** "+7" / "−3.5" / "" (same time) for the widgets. */
export function shortDiff(tz, now = new Date()) {
  const d = diffMin(tz, now);
  if (!d) return '';
  const hrs = Math.abs(d) / 60;
  return `${d > 0 ? '+' : '−'}${Number.isInteger(hrs) ? hrs : +hrs.toFixed(1)}`;
}
