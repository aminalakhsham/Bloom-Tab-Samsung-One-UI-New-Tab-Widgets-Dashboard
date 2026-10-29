// Journal Insights, Samsung Health style cards: your streak with this week, entries/words/days this year, the year as a
// calendar heat-map, your mood over the last 30 days, when you usually write, and your most used tags.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime, lang } from '../core/i18n.js';
import * as M from './model.js';
import { pl } from './data.js';
import { moodFace, moodName } from './mood.js';

/** First day of the week for the UI language (Calendar's rule). */
export function firstDay() {
  try {
    const l = new Intl.Locale(lang() === 'ar' ? 'ar-u-nu-latn' : navigator.language || 'en');
    const info = l.weekInfo || l.getWeekInfo?.();
    if (info?.firstDay) return info.firstDay % 7;
  } catch {}
  return lang() === 'ar' ? 6 : 0;
}
const nf = (n) => new Intl.NumberFormat(lang() === 'ar' ? 'ar-u-nu-latn' : undefined).format(n);
const card = (cls, ic, color, title, ...body) => h('section', { class: ['ou-card', 'jr-ic', cls] },
  h('div', { class: 'jr-ic-h' }, h('span', { class: 'jr-ic-ico', style: { '--c': color }, html: icon(ic, 16) }), h('span', null, title)), ...body);

/**
 * Fills `body` with the Insights cards. opts: { year, onYear(y), onDay(key), onTag(tag) }
 */
export function renderInsights(body, d, { year = new Date().getFullYear(), onYear, onDay, onTag } = {}) {
  const now = Date.now(), today = M.dayKey(now), days = M.daysWith(d), st = M.streak(d, now), ys = M.yearStats(d, new Date().getFullYear());
  const fd = firstDay();

  // ——— streak and this week ———
  const wk = M.keyDate(today);
  wk.setDate(wk.getDate() - ((wk.getDay() - fd + 7) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const x = new Date(wk);
    x.setDate(wk.getDate() + i);
    const k = M.dayKey(+x);
    return h('span', { class: ['jr-wd', days.has(k) && 'on', k === today && 'today', k > today && 'later'], title: fmtDate(x, { weekday: 'long' }) },
      h('i', { html: days.has(k) ? icon('check', 14) : '' }), h('small', null, fmtDate(x, { weekday: 'narrow' })));
  });
  const streakCard = card('jr-ic-streak', 'jr-flame', '#ff7a2f', t('journal.streak'),
    h('div', { class: 'jr-ic-big' }, h('b', null, nf(st.current)), h('span', null, pl('journal.daysInRow', st.current))),
    h('div', { class: 'jr-week' }, week),
    h('div', { class: 'jr-ic-foot' }, st.best ? t('journal.bestStreak', { d: pl('journal.nDays', st.best) }) : t('journal.startStreak')));

  // ——— this year ———
  const tile = (n, label, ic, color) => h('div', { class: 'jr-stat' }, h('span', { class: 'jr-stat-ico', style: { '--c': color }, html: icon(ic, 16) }), h('b', null, nf(n)), h('small', null, label));
  const stats = h('section', { class: 'jr-stats' },
    tile(ys.entries, t('journal.entriesYear'), 'jr-book', M.ACCENT),
    tile(ys.words, t('journal.wordsYear'), 'edit', '#14b8a6'),
    tile(ys.days, t('journal.daysYear'), 'calendar', '#3e7bff'));

  // ——— the year as a heat-map ———
  const weeks = M.heatWeeks(d, year, fd, now);
  const months = h('div', { class: 'jr-heat-months' });
  let lastMonth = -1;
  weeks.forEach((w, i) => {
    const first = w.find((x) => !x.out && x.key.endsWith('-01')) || (i === 0 ? w.find((x) => !x.out) : null);
    const m = first ? M.keyDate(first.key).getMonth() : -1;
    if (m >= 0 && m !== lastMonth) {
      lastMonth = m;
      months.append(h('span', { style: { gridColumn: `${i + 1} / span 4` } }, fmtDate(new Date(year, m, 1), { month: 'short' })));
    }
  });
  const grid = h('div', { class: 'jr-heat-grid', role: 'grid', 'aria-label': t('journal.heatmap') },
    weeks.map((w) => h('div', { class: 'jr-heat-col', role: 'row' }, w.map((x) => h(x.out ? 'span' : 'button', {
      class: ['jr-heat-cell', 'l' + M.heatLevel(x.n), x.out && 'out', x.future && 'future', x.key === today && 'today'],
      role: 'gridcell',
      title: x.out ? null : `${fmtDate(M.keyDate(x.key), { weekday: 'short', month: 'short', day: 'numeric' })}: ${pl('journal.nEntries', x.n)}`,
      'aria-label': x.out ? null : `${fmtDate(M.keyDate(x.key), { month: 'long', day: 'numeric' })}, ${pl('journal.nEntries', x.n)}`,
      onClick: x.out ? null : () => onDay?.(x.key),
    })))));
  const scroller = h('div', { class: 'jr-heat-scroll' }, h('div', { class: 'jr-heat', style: { '--weeks': weeks.length } }, months, grid));
  const yearEntries = M.live(d).filter((e) => new Date(e.at).getFullYear() === year).length;
  const first = M.live(d).reduce((a, e) => Math.min(a, e.at), now);
  const heatCard = h('section', { class: ['ou-card', 'jr-ic', 'jr-ic-heat'] },
    h('div', { class: 'jr-ic-h' },
      h('span', { class: 'jr-ic-ico', style: { '--c': '#22a356' }, html: icon('grid', 16) }),
      h('span', null, t('journal.heatmap')),
      h('span', { class: 'jr-grow' }),
      h('button', { class: 'ou-icon-btn jr-yr', title: t('journal.prevYear'), 'aria-label': t('journal.prevYear'), html: icon('back', 18), disabled: year <= new Date(first).getFullYear(), onClick: () => onYear?.(year - 1) }),
      h('b', { class: 'jr-yr-t' }, String(year)),
      h('button', { class: 'ou-icon-btn jr-yr', title: t('journal.nextYear'), 'aria-label': t('journal.nextYear'), html: icon('forward', 18), disabled: year >= new Date().getFullYear(), onClick: () => onYear?.(year + 1) })),
    scroller,
    h('div', { class: 'jr-heat-foot' },
      h('span', null, pl('journal.nEntries', yearEntries)),
      h('span', { class: 'jr-grow' }),
      h('span', { class: 'jr-heat-legend' }, t('journal.less'), ...[0, 1, 2, 3, 4].map((l) => h('i', { class: 'jr-heat-cell l' + l })), t('journal.more'))));
  // show the current week (the end of the year scrolls into view in RTL too)
  requestAnimationFrame(() => {
    const cell = grid.querySelector('.today') || (year < new Date().getFullYear() ? grid.lastElementChild : null);
    if (!cell) return;
    // only sideways: scrollIntoView would also move the page
    const r = cell.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    scroller.scrollLeft += r.left + r.width / 2 - (s.left + s.width / 2);
  });

  // ——— mood ———
  const ms = M.moodStats(d, 30, now);
  const maxN = Math.max(1, ...M.MOODS.map((m) => ms[m.level]));
  const top = ms.total ? M.MOODS.reduce((a, m) => (ms[m.level] > ms[a.level] ? m : a), M.MOODS[0]) : null;
  const moodCard = card('jr-ic-mood', 'jr-smile', '#ffa726', t('journal.moodTitle'),
    ms.total
      ? h('div', { class: 'jr-moodbars' }, [...M.MOODS].reverse().map((m) => h('div', { class: 'jr-moodbar', style: { '--mc': m.color } },
        h('span', { class: 'jr-moodbar-face', title: moodName(m.level), html: moodFace(m.level, 26) }),
        h('span', { class: 'jr-moodbar-track' }, h('i', { style: { width: (ms[m.level] / maxN) * 100 + '%' } })),
        h('b', null, nf(ms[m.level])))))
      : h('p', { class: 'jr-ic-empty' }, t('journal.moodNone')),
    h('div', { class: 'jr-ic-foot' }, top ? t('journal.moodMostly', { name: moodName(top.level) }) : t('journal.moodHint')));

  // ——— journaling time ———
  const hrs = M.hours(d), max = Math.max(1, ...hrs), usual = M.usualTime(hrs), total = M.live(d).length;
  const hourLabel = (hr) => fmtTime(new Date(2024, 0, 1, hr, 0)).replace(/:00/, '');
  const timeCard = card('jr-ic-time', 'clock', '#3e7bff', t('journal.timeTitle'),
    h('div', { class: 'jr-bars', role: 'img', 'aria-label': t('journal.timeTitle') }, hrs.map((v, i) => h('i', { class: v && 'on', style: { '--h': (v ? Math.max(8, (v / max) * 100) : 0) + '%' }, title: `${hourLabel(i)}: ${v}` }))),
    h('div', { class: 'jr-bars-x' }, [0, 6, 12, 18].map((x) => h('span', null, hourLabel(x)))),
    h('div', { class: 'jr-ic-foot' }, total ? t('journal.usual.' + (usual || 'evening')) : t('journal.timeHint')));

  // ——— tags ———
  const tags = M.topTags(d, 12);
  const tagCard = tags.length ? card('jr-ic-tags', 'jr-tag', '#e2589c', t('journal.topTags'),
    h('div', { class: 'jr-chips jr-tagcloud' }, tags.map(([tg, n]) => h('button', { class: 'jr-chip tag big', onClick: () => onTag?.(tg) }, '#' + tg, h('small', null, nf(n)))))) : null;

  body.replaceChildren(h('div', { class: 'jr-ins' }, streakCard, stats, heatCard, moodCard, timeCard, tagCard));
}
