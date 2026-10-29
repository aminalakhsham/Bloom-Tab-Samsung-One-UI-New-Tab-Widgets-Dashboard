// How Samsung Health writes its numbers on a page: amounts with Samsung's short units ("750 ml", "70.5 kg"),
// durations ("7 h 32 m"), times and dates in the UI language, medication doses and schedules, and the names of
// moods, feelings, symptoms and awards. Strings live in js/health/strings.js (the app) and js/apps/health.js
// (the surfaces outside the app).
import { t, locale, fmtTime, fmtDate } from '../core/i18n.js';
import * as M from './model.js';

const NF = new Map();
const nf = (o) => {
  const k = JSON.stringify(o) + locale();
  if (!NF.has(k)) { try { NF.set(k, new Intl.NumberFormat(locale(), o)); } catch { NF.set(k, new Intl.NumberFormat('en-US', o)); } }
  return NF.get(k);
};
export const num = (n, digits = 0) => nf({ maximumFractionDigits: digits }).format(n);
/** A count string with its singular: t(key + '.one') when n is 1 and that key exists, else t(key); {n} is filled in. */
export function tn(key, n, vars = {}) {
  const one = key + '.one', s = n === 1 ? t(one, { n: num(n), ...vars }) : one;
  return s !== one ? s : t(key, { n: num(n), ...vars });
}
/** A number typed in any language: Arabic-Indic digits and "٫" or "," as the decimal mark ("٧٠٫٥" → 70.5). */
export const numIn = (s) => parseFloat(String(s ?? '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[\s٬  ]/g, '').replace(/[٫,]/, '.'));

// ------------------------------------------------------------------ amounts
const UNIT = { kg: 'health.u.kg', lb: 'health.u.lb', cm: 'health.u.cm', in: 'health.u.in', ml: 'health.u.ml', floz: 'health.u.floz' };
export const unitName = (u) => t(UNIT[u] || u);
export const withUnit = (n, unit) => t('health.amount', { n, u: unitName(unit) });
/** Water in the display unit: "750 ml" / "25.4 fl oz". */
export const waterText = (ml, u) => withUnit(num(M.toUnit('water', ml, u), u.water === 'ml' ? 0 : 1), u.water);
export const waterNum = (ml, u) => num(M.toUnit('water', ml, u), u.water === 'ml' ? 0 : 1);
export const weightText = (kg, u) => withUnit(num(M.toUnit('weight', kg, u), 1), u.weight);
export function heightText(cm, u) {
  if (u.height !== 'in') return withUnit(num(cm), 'cm');
  const i = Math.round(M.toUnit('height', cm, u));
  return t('health.feetInches', { ft: num(Math.floor(i / 12)), in: num(i % 12) });
}
export const pctText = (v) => t('health.percent', { n: num(v, 1) });
/** A body value in its display unit. */
export function bodyText(kind, v, u) {
  if (kind === 'weight' || kind === 'muscle') return weightText(v, u);
  if (kind === 'height') return heightText(v, u);
  if (kind === 'fat') return pctText(v);
  if (kind === 'bmi') return num(v, 1);
  return num(v, 1);
}

// ------------------------------------------------------------------ durations, times, dates
/** "7 h 32 m", "45 min" (Samsung's short form). */
export function durText(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return t('health.dur.m', { m: num(m) });
  return m ? t('health.dur.hm', { h: num(h), m: num(m) }) : t('health.dur.h', { h: num(h) });
}
/** Focus minutes for the rings: "35 min" or "1 h 5 m". */
export const minText = (v) => durText(Math.floor(v + 1e-6));
export const timeOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return fmtTime(new Date(2026, 0, 1, h || 0, m || 0)); };
export const clock = (ms) => fmtTime(new Date(ms));
export const dayText = (k, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => {
  const today = M.dayKey();
  if (k === today) return t('common.today');
  if (k === M.addDays(today, -1)) return t('common.yesterday');
  return fmtDate(M.keyDate(k), opts);
};
export const dateText = (k, opts = { month: 'short', day: 'numeric' }) => fmtDate(M.keyDate(k), opts);
export const longDate = (k) => fmtDate(M.keyDate(k), { weekday: 'long', month: 'long', day: 'numeric' });
/** "9:41 AM" today, "Yesterday", or "Oct 12". */
export function whenText(ms) {
  const k = M.dayKey(ms), today = M.dayKey();
  if (k === today) return clock(ms);
  if (k === M.addDays(today, -1)) return t('common.yesterday');
  return fmtDate(new Date(ms), new Date(ms).getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
export const rangeText = (a, b, opts = { month: 'short', day: 'numeric' }) => {
  try { return new Intl.DateTimeFormat(locale(), opts).formatRange(M.keyDate(a), M.keyDate(b)); } catch { return `${dateText(a)} – ${dateText(b)}`; }
};
export const inDays = (n) => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(n, 'day');
/** Weekdays in the region's order: [[0–6, name]…]. */
export function weekdays(style = 'short', first = weekStart()) {
  return Array.from({ length: 7 }, (_, i) => { const d = (first + i) % 7; return [d, fmtDate(new Date(2024, 0, 7 + d), { weekday: style })]; });
}
export function weekStart() {
  try { const l = new Intl.Locale(locale()), f = (l.getWeekInfo?.() || l.weekInfo)?.firstDay; if (f >= 1 && f <= 7) return f % 7; } catch {}
  return locale().startsWith('ar') ? 6 : 1;
}

// ------------------------------------------------------------------ medications
export const medName = (m) => m.nick || m.name;
export const medTypeName = (x) => t('health.type.' + x);
const DOSE = (type) => (type === 'capsule' ? 'capsule' : type === 'tablet' ? 'tablet' : type === 'drops' ? 'drop' : type === 'inhaler' || type === 'spray' ? 'puff' : 'dose');
/** "1 tablet", "2 capsules", "1 puff"… */
export const doseText = (m, n = 1) => (n === 1 ? t('health.dose1.' + DOSE(m.type)) : t('health.doseN.' + DOSE(m.type), { n: num(n, 2) }));
export const strengthText = (m) => (m.strength ? `${num(+m.strength, 3)} ${m.unit || 'mg'}` : '');
/** Strength and type, as under the name in a list ("10 mg · Tablet"). */
export const medSub = (m) => [strengthText(m), medTypeName(m.type)].filter(Boolean).join(' · ');
export function schedText(m) {
  const s = m.sched;
  if (s.kind === 'asNeeded') return t('health.sched.asNeeded');
  if (s.kind === 'interval') return t('health.sched.everyN', { n: num(s.every) });
  if (s.kind === 'cycle') return t('health.sched.cycleText', { on: num(s.on), off: num(s.off) });
  if (s.kind === 'days') return s.days.length === 7 ? t('health.sched.daily') : listText(weekdays().filter(([i]) => s.days.includes(i)).map(([, n]) => n));
  return t('health.sched.daily');
}
export const listText = (a) => { try { return new Intl.ListFormat(locale(), { style: 'short', type: 'conjunction' }).format(a); } catch { return a.join(', '); } };
export const statusText = (e) => t(e.status === 'taken' ? 'health.takenAt' : 'health.skippedAt', { time: clock(e.at) });

// ------------------------------------------------------------------ names
export const moodName = (id) => t('health.mood.' + id);
export const feelingName = (x) => t('health.feel.' + x.replace(/[^A-Za-z]/g, ''));
export const areaName = (x) => t('health.area.' + x.replace(/[^A-Za-z]/g, ''));
export const symptomName = (x) => t('health.sym.' + x.replace(/[^A-Za-z]/g, ''));
export const flowName = (x) => t('health.flow.' + x);
export const ringName = (k) => t('health.ring.' + k);
export const awardName = (id) => {
  const m = /^month-(\d{4})-(\d\d)$/.exec(id);
  if (m) return t('health.aw.month', { month: fmtDate(new Date(+m[1], +m[2] - 1, 1), { month: 'long' }) });
  return t('health.aw.' + id);
};
export const awardDesc = (id) => (/^month-/.test(id) ? t('health.awd.month') : t('health.awd.' + id));
/** A ring's value as the rings show it: "35/60 min", "2/5", "3/8 hr". */
export function ringValue(k, r) {
  const v = Math.floor(r.v + 1e-6);
  if (k === 'focus') return t('health.ringv.focus', { v: num(v), g: num(r.goal) });
  if (k === 'breaks') return t('health.ringv.breaks', { v: num(v), g: num(r.goal) });
  return t('health.ringv.done', { v: num(v), g: num(r.goal) });
}
