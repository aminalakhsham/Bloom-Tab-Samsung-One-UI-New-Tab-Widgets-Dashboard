// Samsung Health trend charts: Days / Weeks / Months tabs, the value of the selected bar with its date above the
// chart, and a strip of bars that scrolls sideways (newest at the end, mirrored in Arabic). The selected bar is in
// the tracker's colour, the others lighter; a dashed line marks the goal. Kinds:
//   'sum'   a total per day (water, mindful minutes); weeks and months show the daily average
//   'sleep' minutes asleep per night (counted on the wake-up day); weeks and months average the nights
//   'avg'   samples (weight, body fat): dots at the average of each bar's samples, on a scale that fits them
//   'mood'  the average mood of each bar, a bar coloured by its mood
import { h } from '../core/util.js';
import { t, isRtl, fmtDate } from '../core/i18n.js';
import { seg } from '../core/ui.js';
import * as M from './model.js';
import { weekStart, dateText, rangeText, dayText } from './format.js';

const COUNT = { day: 31, week: 16, month: 12 };

/** The buckets of a range ending today (oldest first): [{ from, to (keys, inclusive), label }]. */
export function buckets(range, today = M.dayKey()) {
  const out = [];
  if (range === 'day') for (let i = COUNT.day - 1; i >= 0; i--) { const k = M.addDays(today, -i); out.push({ from: k, to: k }); }
  else if (range === 'week') {
    const ws = weekStart(), d = M.keyDate(today), start = M.addDays(today, -((d.getDay() - ws + 7) % 7));
    for (let i = COUNT.week - 1; i >= 0; i--) { const a = M.addDays(start, -7 * i); out.push({ from: a, to: M.addDays(a, 6) }); }
  } else {
    const d = M.keyDate(today);
    for (let i = COUNT.month - 1; i >= 0; i--) {
      const a = new Date(d.getFullYear(), d.getMonth() - i, 1), b = new Date(d.getFullYear(), d.getMonth() - i + 1, 0);
      out.push({ from: M.dayKey(a), to: M.dayKey(b) });
    }
  }
  return out;
}

/** Each bucket's value: { v (or null), n (days or samples with data) }. `days` maps day → [values]. */
export function values(kind, list, byDay) {
  return list.map((b) => {
    const vals = [];
    for (let k = b.from; k <= b.to; k = M.addDays(k, 1)) if (byDay.has(k)) vals.push(byDay.get(k));
    if (!vals.length) return { ...b, v: null, n: 0 };
    if (kind === 'sum' || kind === 'sleep') {
      const per = vals.map((xs) => xs.reduce((s, x) => s + x, 0));
      return { ...b, v: per.reduce((s, x) => s + x, 0) / (b.from === b.to ? 1 : per.length), n: per.length };
    }
    const all = vals.flat();
    return { ...b, v: all.reduce((s, x) => s + x, 0) / all.length, n: all.length };
  });
}

/**
 * trendChart({ kind, points: () => [{ at, v }], color, goal: () => number | null, value: (v) => text,
 *              range: 'day' | 'week' | 'month', onRange })
 * Returns the chart element with .redraw().
 */
export function trendChart(o) {
  let range = o.range || 'day', sel = null;
  const head = h('div', { class: 'hc-head' });
  const plot = h('div', { class: 'hc-plot', tabindex: 0, role: 'listbox', 'aria-label': t('health.chart') });
  const goalLine = h('div', { class: 'hc-goal', hidden: true });
  const tabs = seg([{ value: 'day', label: t('health.days') }, { value: 'week', label: t('health.weeks') }, { value: 'month', label: t('health.months') }], range, (v) => { range = v; sel = null; o.onRange?.(v); draw(true); });
  tabs.classList.add('hc-tabs');
  const el = h('div', { class: 'hc', style: { '--hc': o.color } }, tabs, head, h('div', { class: 'hc-area' }, goalLine, plot));
  let data = [];

  function label(b) {
    if (range === 'day') return dayText(b.from, { weekday: 'short', month: 'short', day: 'numeric' });
    if (range === 'week') return rangeText(b.from, b.to);
    return fmtDate(M.keyDate(b.from), { month: 'long', year: 'numeric' });
  }
  function tick(b, i) {
    if (range === 'day') return fmtDate(M.keyDate(b.from), { day: 'numeric' });
    if (range === 'week') return dateText(b.from, { month: 'numeric', day: 'numeric' });
    return fmtDate(M.keyDate(b.from), { month: 'short' });
  }
  function showHead() {
    const b = data[sel];
    const note = b && (o.kind === 'sum' || o.kind === 'sleep') && range !== 'day' && b.v != null ? t('health.dailyAvg') : '';
    head.replaceChildren(
      h('div', { class: 'hc-val' }, b?.v != null ? o.value(b.v) : '–'),
      h('div', { class: 'hc-when' }, [label(b), note].filter(Boolean).join(' · ')));
  }
  function draw(scroll) {
    const byDay = new Map();
    for (const p of o.points()) { const k = M.dayKey(p.at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p.v); }
    data = values(o.kind, buckets(range), byDay);
    if (sel == null || sel >= data.length) sel = data.length - 1;
    const goal = o.goal?.() ?? null;
    const vs = data.map((b) => b.v).filter((v) => v != null);
    let lo = 0, hi = Math.max(1, ...vs, goal || 0) * 1.12;
    if (o.kind === 'avg' && vs.length) { const a = Math.min(...vs), z = Math.max(...vs), pad = Math.max(1, (z - a) * 0.25); lo = Math.max(0, a - pad); hi = z + pad; }
    if (o.kind === 'mood') { lo = -3.6; hi = 3; }
    const y = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    plot.className = 'hc-plot r-' + range;
    plot.replaceChildren(...data.map((b, i) => {
      const has = b.v != null;
      const mark = !has ? null : o.kind === 'avg'
        ? h('i', { class: 'hc-dot', style: { bottom: `calc(${(y(b.v) * 100).toFixed(2)}% - 5px)` } })
        : h('i', { class: 'hc-bar', style: { height: `max(4px, ${(y(b.v) * 100).toFixed(2)}%)`, ...(o.kind === 'mood' ? { background: M.moodOf(b.v).color } : {}) } });
      return h('button', {
        class: ['hc-col', i === sel && 'sel', !has && 'none'], role: 'option', 'aria-selected': String(i === sel), 'aria-label': label(b),
        onClick: () => { sel = i; plot.querySelectorAll('.hc-col').forEach((c, j) => { c.classList.toggle('sel', j === sel); c.setAttribute('aria-selected', String(j === sel)); }); showHead(); },
      }, h('span', { class: 'hc-track' }, mark), h('span', { class: 'hc-tick' }, tick(b, i)));
    }));
    goalLine.hidden = !(goal > 0) || o.kind === 'avg' || o.kind === 'mood';
    if (!goalLine.hidden) goalLine.style.bottom = `calc(28px + (100% - 28px) * ${y(goal).toFixed(4)})`;
    showHead();
    if (scroll) requestAnimationFrame(() => { plot.scrollLeft = isRtl() ? -plot.scrollWidth : plot.scrollWidth; });
  }
  plot.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = Math.max(0, Math.min(data.length - 1, sel + (isRtl() ? -d : d)));
    plot.children[n]?.click();
    plot.children[n]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  draw(true);
  el.redraw = () => draw(false);
  return el;
}

/** A 24-hour bar chart (Daily activity's hourly charts): values per hour, ticks at 0, 6, 12 and 18. */
export function hourChart(vals, color, { dots = false, max } = {}) {
  const top = max ?? Math.max(1, ...vals);
  return h('div', { class: ['hc-hours', dots && 'dots'], style: { '--hc': color } },
    h('div', { class: 'hc-hours-bars' }, vals.map((v, i) => h('i', {
      class: [v > 0 && 'on'], title: String(i).padStart(2, '0') + ':00',
      style: dots ? null : { height: v > 0 ? `max(3px, ${((v / top) * 100).toFixed(1)}%)` : '0' },
    }))),
    h('div', { class: 'hc-hours-ticks' }, [0, 6, 12, 18].map((x) => h('span', null, fmtDate(new Date(2026, 0, 1, x), { hour: 'numeric' })))));
}
