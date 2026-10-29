// Calendar views that aren't timelines: Month (Samsung's grid with coloured event bars that run across the days, the
// alternate-calendar date and week numbers when they're on, and the selected day's agenda with the quick-add field
// beside it in a wide window or under it in a narrow one), Year (twelve small months) and List (upcoming events by
// day). Each draw*(host, api) fills the view and returns a cleanup function.
import { h, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate } from '../core/i18n.js';
import { openApp } from '../core/apps.js';
import * as M from './model.js';
import * as D from './data.js';
import { eventTime, weekdayLabels, altParts, altLong } from './format.js';

const LINE = 18; // height of one event line in a month cell

// ---------------------------------------------------------------- agenda rows (day pane, List view, search)
export function itemEl(o, day, api) {
  const rem = o.kind === 'reminder', bday = o.kind === 'birthday';
  const sub = o.place || (rem ? '' : o.notes.split('\n')[0]) || '';
  const el = h('button', {
    class: ['cal-item', rem && 'rem', rem && o.done && 'done', o.readOnly && 'ro'],
    style: `--c:${o.color}`,
    dataset: { key: o.key },
    onClick: () => {
      if (bday) openApp('contacts', { params: { id: o.cid } });
      else api.open(o);
    },
    onContextmenu: (e) => api.menu(e, o),
  },
    rem ? h('span', { class: 'cal-item-ico', html: icon(o.done ? 'checkCircle' : 'circle', 18) }) : h('span', { class: 'cal-item-bar' }),
    h('span', { class: 'cal-item-text' },
      h('span', { class: 'cal-item-title' }, o.title || t('cal.myEvent')),
      h('span', { class: 'cal-item-time' }, rem ? `${t('cal.reminder')} · ${o.allDay ? t('cal.allDay') : eventTime({ ...o, end: o.start }, day)}` : eventTime(o, day)),
      sub ? h('span', { class: 'cal-item-notes' }, sub) : null),
    bday ? h('span', { class: 'cal-item-end', html: icon('calGift', 20) }) : o.recurring && !rem ? h('span', { class: 'cal-item-end', title: t('cal.repeats'), html: icon('calRepeat', 16) }) : null);
  return el;
}

// ---------------------------------------------------------------- Month
export function drawMonth(host, api) {
  const { st } = api;
  const p = D.prefs(), first = D.firstDay();
  const m0 = new Date(st.cur.getFullYear(), st.cur.getMonth(), 1);
  const start = M.startOfWeek(m0, first);
  const weeks = Math.ceil((M.daysBetween(start, m0) + new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate()) / 7);
  const end = M.addDays(start, weeks * 7);
  const occs = D.occurrences(start, end);
  const today = new Date();
  // the day number row; the alternate calendar's date sits under the number
  const HEAD = altParts(today) ? 40 : 28;

  const wds = h('div', { class: ['cal-wds', p.weekNumbers && 'wn'] },
    p.weekNumbers ? h('span', { class: 'cal-wn-h' }) : null,
    weekdayLabels('short', first).map(({ wd, label }) => h('span', { class: ['cal-wd', wd === 0 && 'sun', wd === 6 && 'sat'] }, label)));
  const weeksEl = h('div', { class: 'cal-weeks', style: `--weeks:${weeks}` });
  const month = h('div', { class: 'cal-month' }, wds, weeksEl);
  const dayPane = h('div', { class: 'cal-day' });
  const wrap = h('div', { class: 'cal-mv' }, month, dayPane);
  host.replaceChildren(wrap);

  let lastCap = -1;
  function fill() {
    const H = weeksEl.clientHeight || 520;
    const cap = Math.max(1, Math.floor((H / weeks - HEAD - 4) / LINE));
    if (cap === lastCap) return;
    lastCap = cap;
    const rows = [];
    for (let w = 0; w < weeks; w++) {
      const days = Array.from({ length: 7 }, (_, i) => M.addDays(start, w * 7 + i));
      const { bars, lanes } = M.barLanes(occs, days);
      const timed = days.map((d) => occs.filter((o) => !M.isMulti(o) && o.start >= +d && o.start < +M.addDays(d, 1)));
      // lanes for bars leave room for at least one timed line when the day has one
      const shown = Math.min(lanes, Math.max(0, cap - (timed.some((x) => x.length) ? 1 : 0)));
      const hiddenBars = days.map(() => 0);
      for (const b of bars) if (b.lane >= shown) for (let c = b.c0; c <= b.c1; c++) hiddenBars[c]++;
      const grid = h('div', { class: 'cal-wkg', style: `grid-template-rows:${HEAD}px ${shown ? `repeat(${shown}, ${LINE}px) ` : ''}minmax(0, 1fr)` });
      days.forEach((d, i) => {
        const alt = altParts(d);
        grid.appendChild(h('button', {
          class: ['cal-cell', d.getMonth() !== m0.getMonth() && 'out', sameDay(d, today) && 'today', sameDay(d, st.cur) && 'sel', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat'],
          style: `grid-column:${i + 1}`,
          dataset: { day: M.dkey(d) },
          'aria-label': fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }),
        },
          h('span', { class: 'cal-num' }, String(d.getDate())),
          alt ? h('span', { class: ['cal-alt', alt.first && 'first'] }, alt.first ? `${alt.day} ${alt.month}` : alt.day) : null));
      });
      for (const b of bars) {
        if (b.lane >= shown) continue;
        grid.appendChild(h('div', {
          class: ['cal-ev', 'bar', b.cs && 'cs', b.ce && 'ce', b.o.kind === 'birthday' && 'bday', b.o.kind === 'reminder' && 'rem'],
          style: `grid-column:${b.c0 + 1} / ${b.c1 + 2};grid-row:${b.lane + 2};--c:${b.o.color}`,
          dataset: { key: b.o.key },
        }, b.o.title || t('cal.myEvent')));
      }
      days.forEach((d, i) => {
        const list = timed[i];
        const room = Math.max(0, cap - shown);
        const fits = list.length + hiddenBars[i] > room ? Math.max(0, room - 1) : list.length;
        const more = list.length - fits + hiddenBars[i];
        if (!list.length && !more) return;
        grid.appendChild(h('div', { class: 'cal-dayevs', style: `grid-column:${i + 1};grid-row:${shown + 2}` },
          list.slice(0, fits).map((o) => h('div', { class: ['cal-ev', 'tm', o.kind === 'reminder' && 'rem', o.done && 'done'], style: `--c:${o.color}`, dataset: { key: o.key } }, o.title || t('cal.myEvent'))),
          more > 0 ? h('div', { class: 'cal-more' }, t('cal.more', { n: more })) : null));
      });
      rows.push(h('div', { class: 'cal-wk' },
        p.weekNumbers ? h('span', { class: 'cal-wn' }, String(M.weekNumber(days[0], first))) : null,
        grid));
    }
    weeksEl.replaceChildren(...rows);
  }
  fill();
  const ro = new ResizeObserver(() => fill());
  ro.observe(weeksEl);

  weeksEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    const d = M.parseKey(cell.dataset.day);
    if (d.getMonth() !== m0.getMonth()) return api.go(d);
    api.select(d);
  });
  weeksEl.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (cell) api.newEvent({ day: M.parseKey(cell.dataset.day) });
  });

  // the selected day's agenda
  const qaIn = h('input', { class: 'cal-qa-in', type: 'text', enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' });
  const qa = h('form', { class: 'cal-qa', onSubmit: (e) => { e.preventDefault(); const v = qaIn.value.trim(); if (!v) return; qaIn.value = ''; api.quickAdd(v); } },
    h('span', { class: 'cal-qa-ico', html: icon('plus', 20) }), qaIn);
  const head = h('div', { class: 'cal-day-head' });
  const list = h('div', { class: 'cal-day-list scroll' });
  dayPane.append(head, list, qa);
  function drawDay() {
    const d = st.cur, isToday = sameDay(d, new Date());
    const alt = altLong(d);
    head.replaceChildren(
      h('div', { class: 'cal-day-num' }, String(d.getDate())),
      h('div', { class: 'cal-day-meta' },
        h('div', { class: 'cal-day-wd' }, isToday ? t('cal.today') : fmtDate(d, { weekday: 'long' })),
        h('div', { class: 'cal-day-md' }, (isToday ? fmtDate(d, { weekday: 'long' }) + ' · ' : '') + fmtDate(d, { month: 'long', year: 'numeric' })),
        alt ? h('div', { class: 'cal-day-alt' }, alt) : null));
    qaIn.placeholder = t('cal.qaPh', { date: fmtDate(d, { month: 'short', day: 'numeric' }) });
    const items = D.occurrences(d, M.addDays(d, 1));
    const evs = items.filter((o) => o.kind !== 'reminder'), rems = items.filter((o) => o.kind === 'reminder');
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'ou-empty cal-empty' }, h('span', { html: icon('calendar', 56) }), t('cal.noEvents')));
      return;
    }
    list.replaceChildren(...evs.map((o) => api.item(o, d)), ...rems.map((o) => api.item(o, d)));
  }
  drawDay();
  api.onSelect = () => {
    weeksEl.querySelectorAll('.cal-cell.sel').forEach((c) => c.classList.remove('sel'));
    weeksEl.querySelector(`.cal-cell[data-day="${M.dkey(st.cur)}"]`)?.classList.add('sel');
    drawDay();
  };
  return () => ro.disconnect();
}

// ---------------------------------------------------------------- Year
export function drawYear(host, api) {
  const { st } = api;
  const y = st.cur.getFullYear(), first = D.firstDay(), today = new Date();
  const marks = D.eventDays(new Date(y, 0, 1), new Date(y + 1, 0, 1));
  const labels = weekdayLabels('narrow', first);
  const months = Array.from({ length: 12 }, (_, m) => {
    const m0 = new Date(y, m, 1), lead = (m0.getDay() - first + 7) % 7, n = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-yd out' }));
    for (let d = 1; d <= n; d++) {
      const day = new Date(y, m, d);
      cells.push(h('button', { class: ['cal-yd', sameDay(day, today) && 'today', marks.has(M.dkey(day)) && 'has', day.getDay() === 0 && 'sun', day.getDay() === 6 && 'sat'], dataset: { day: M.dkey(day) }, tabindex: -1 }, String(d)));
    }
    const cur = today.getFullYear() === y && today.getMonth() === m;
    return h('div', { class: ['cal-ym', cur && 'cur'] },
      h('button', { class: 'cal-ym-t', dataset: { month: String(m) } }, fmtDate(m0, { month: 'long' })),
      h('div', { class: 'cal-ym-g' }, labels.map(({ wd, label }) => h('span', { class: ['cal-ym-wd', wd === 0 && 'sun'] }, label)), cells));
  });
  const el = h('div', { class: 'cal-yv scroll' }, h('div', { class: 'cal-yv-grid' }, months));
  el.addEventListener('click', (e) => {
    const t1 = e.target.closest('.cal-ym-t');
    if (t1) return api.go(new Date(y, +t1.dataset.month, +t1.dataset.month === today.getMonth() && y === today.getFullYear() ? today.getDate() : 1), 'month');
    const d = e.target.closest('.cal-yd[data-day]');
    if (d) api.go(M.parseKey(d.dataset.day), 'month');
  });
  host.replaceChildren(el);
  // the current month in view
  requestAnimationFrame(() => el.querySelector('.cal-ym.cur')?.scrollIntoView({ block: 'nearest' }));
  return null;
}

// ---------------------------------------------------------------- List
export function drawList(host, api) {
  const { st } = api;
  const from = M.dayStart(st.cur), to = M.addDays(from, st.listDays);
  const occs = D.occurrences(from, to, { reminders: false });
  const today = new Date();
  const byDay = new Map();
  for (const o of occs) {
    // an event running over several days is listed on each of them (with its → / ← arrow)
    for (let d = M.dayStart(Math.max(o.start, +from)); d <= M.lastDay(o) && d < to; d = M.addDays(d, 1)) {
      const k = M.dkey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(o);
    }
  }
  const sections = [...byDay.keys()].sort().map((k) => {
    const d = M.parseKey(k), isToday = sameDay(d, today);
    return h('section', { class: ['cal-lv-day', isToday && 'today'], dataset: { day: k } },
      h('div', { class: 'cal-lv-h' },
        h('span', { class: 'cal-lv-num' }, String(d.getDate())),
        h('span', { class: 'cal-lv-meta' },
          h('b', null, isToday ? t('cal.today') : fmtDate(d, { weekday: 'long' })),
          h('span', null, fmtDate(d, { month: 'long', year: 'numeric' })))),
      h('div', { class: 'cal-lv-items' }, byDay.get(k).sort(M.byStart).map((o) => api.item(o, d))));
  });
  const more = h('button', { class: 'ou-btn tonal cal-lv-more', onClick: () => { st.listDays += 90; api.redraw(); } }, t('cal.showMore'));
  const el = h('div', { class: 'cal-lv scroll' },
    sections.length ? sections : h('div', { class: 'ou-empty cal-empty' }, h('span', { html: icon('calendar', 56) }), t('cal.noUpcoming')),
    h('div', { class: 'cal-lv-foot' }, h('span', null, t('cal.listUntil', { date: fmtDate(M.addDays(to, -1), { month: 'long', day: 'numeric', year: 'numeric' }) })), more));
  host.replaceChildren(el);
  return null;
}
