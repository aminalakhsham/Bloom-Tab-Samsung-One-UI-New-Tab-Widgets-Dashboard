// Calendar Week and Day views: Samsung's timeline — day headers, the all-day row with bars, the hours with events
// side by side when they overlap and the red line at the current time. Pointer interactions (bound once on the view,
// delegated): drag on empty space to create an event, drag an event to move it (across days in Week view), drag its
// bottom edge to resize it, drag an all-day bar to another day; double-click to add, right-click for the menu,
// Ctrl/⌘ + wheel (or a pinch) to zoom the hours. Ported from Liquid Tab's cal-grid.js.
import { h, clamp, sameDay } from '../core/util.js';
import { t, fmtDate, fmtTime } from '../core/i18n.js';
import * as M from './model.js';
import * as D from './data.js';
import { hourLabel, altParts } from './format.js';

const SNAP = 15;
const snap = (m) => Math.round(m / SNAP) * SNAP;
const at = (day, min) => { const d = M.dayStart(day); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min).getTime(); };
let lastRange = '', lastScroll = null;

export function drawTimeline(host, api, days) {
  const p = D.prefs();
  const hh = clamp(+(host._hh || p.hourH) || 52, 28, 140);
  const from = M.dayStart(days[0]), to = M.addDays(days.at(-1), 1);
  const occs = D.occurrences(from, to);
  host._occ = new Map(occs.map((o) => [o.key, o]));
  const today = new Date(), nowMin = today.getHours() * 60 + today.getMinutes();
  const ti = days.findIndex((d) => sameDay(d, today));
  const { bars, lanes } = M.barLanes(occs, days, M.isLong);
  const one = days.length === 1;

  const head = h('div', { class: 'cal-tl-head' }, h('div', { class: 'cal-tl-gut' }),
    days.map((d) => {
      const alt = altParts(d);
      return h('button', { class: ['cal-tl-dh', sameDay(d, today) && 'today', sameDay(d, api.st.cur) && !one && 'sel', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat'], dataset: { day: M.dkey(d) }, 'aria-label': fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) },
        h('span', { class: 'cal-tl-wd' }, fmtDate(d, { weekday: one ? 'long' : 'short' })),
        h('span', { class: 'cal-tl-n' }, String(d.getDate())),
        alt ? h('span', { class: 'cal-tl-alt' }, alt.day) : null);
    }));
  const adg = h('div', { class: 'cal-tl-adg', style: `grid-template-rows:repeat(${Math.max(1, lanes)}, 22px)` },
    days.map((d, i) => h('div', { class: 'cal-tl-adc', dataset: { day: M.dkey(d) }, style: `grid-column:${i + 1};grid-row:1 / -1` })),
    bars.map((b) => h('div', {
      class: ['cal-tl-bar', b.cs && 'cs', b.ce && 'ce', b.o.readOnly && 'ro', b.o.kind === 'reminder' && 'rem'],
      style: `grid-column:${b.c0 + 1} / ${b.c1 + 2};grid-row:${b.lane + 1};--c:${b.o.color}`, dataset: { key: b.o.key }, tabindex: 0,
    }, b.o.title || t('cal.myEvent'))));
  const allday = h('div', { class: ['cal-tl-ad', !lanes && 'empty'] }, h('div', { class: 'cal-tl-gut' }, h('span', null, t('cal.allDay'))), adg);

  const hours = h('div', { class: 'cal-tl-hours' },
    Array.from({ length: 24 }, (_, i) => h('div', { class: ['cal-tl-hl', ti >= 0 && Math.abs(i * 60 - nowMin) < 16 && 'near'], style: `--h:${i}` }, i ? h('span', null, hourLabel(i)) : null)),
    ti >= 0 ? h('div', { class: 'cal-tl-now-t', style: `--m:${nowMin}` }, fmtTime(today)) : null);
  const cols = h('div', { class: 'cal-tl-cols' },
    days.map((d, i) => {
      const list = occs.filter((o) => !M.isLong(o) && ((o.end > +d && o.start < +M.addDays(d, 1)) || (o.start === o.end && sameDay(o.start, d))));
      const items = M.layoutColumn(list, d);
      return h('div', { class: ['cal-tl-col', i === ti && 'today', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat'], dataset: { day: M.dkey(d) } },
        items.map((it) => {
          const o = it.o, mins = it.bottom - it.top;
          return h('div', {
            class: ['cal-tl-ev', mins < 45 && 'short', mins < 25 && 'tiny', o.readOnly && 'ro', o.kind === 'reminder' && 'rem', o.done && 'done'],
            style: `--t:${it.top};--b:${it.bottom};--col:${it.col};--cols:${it.cols};--span:${it.span};--c:${o.color}`, dataset: { key: o.key }, tabindex: 0,
          },
            h('div', { class: 'cal-tl-ev-in' },
              h('b', null, o.title || t('cal.myEvent')),
              h('span', { class: 'cal-tl-ev-time' }, fmtTime(new Date(o.start))),
              o.place && mins >= 60 ? h('span', { class: 'cal-tl-ev-place' }, o.place) : null),
            o.readOnly ? null : h('i', { class: 'cal-tl-rz' }));
        }),
        i === ti ? h('div', { class: 'cal-tl-now', style: `--m:${nowMin}` }) : null);
    }));
  const scroller = h('div', { class: 'cal-tl-scroll scroll' }, h('div', { class: 'cal-tl-body' }, hours, cols));
  const el = h('div', { class: ['cal-tl', one && 'one'], style: `--n:${days.length};--hh:${hh}px` }, head, allday, scroller);
  host.replaceChildren(el);

  // keep the scroll position while the same days are redrawn; otherwise show the morning (or now)
  const range = M.dkey(days[0]) + days.length;
  if (range === lastRange && lastScroll != null) scroller.scrollTop = lastScroll;
  else scroller.scrollTop = Math.round((ti >= 0 ? Math.max(0, nowMin / 60 - 2) : 7) * hh);
  lastRange = range;
  scroller.addEventListener('scroll', () => { lastScroll = scroller.scrollTop; }, { passive: true });
  lastScroll = scroller.scrollTop;

  // the red line moves every minute
  const tick = setInterval(() => {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    el.querySelectorAll('.cal-tl-now, .cal-tl-now-t').forEach((x) => x.style.setProperty('--m', m));
    const lbl = el.querySelector('.cal-tl-now-t');
    if (lbl) lbl.textContent = fmtTime(n);
  }, 30e3);
  return () => clearInterval(tick);
}

/** Pointer, click and wheel handling for the timelines inside `view` (delegated, bound once). */
export function bindTimeline(view, api) {
  let drag = null, swallow = false;
  const occ = (el) => view._occ?.get(el?.dataset.key);
  const hh = () => parseFloat(view.querySelector('.cal-tl')?.style.getPropertyValue('--hh')) || 52;
  const colAt = (tl, x) => {
    const list = [...tl.querySelectorAll('.cal-tl-col')];
    return list.find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; })
      || list.reduce((a, c) => { const r = c.getBoundingClientRect(), d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right)); return !a || d < a.d ? { c, d } : a; }, null)?.c;
  };
  const adColAt = (tl, x) => [...tl.querySelectorAll('.cal-tl-adc')].find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
  const minuteAt = (tl, y) => { const r = tl.querySelector('.cal-tl-cols').getBoundingClientRect(); return clamp(((y - r.top) / hh()) * 60, 0, 1440); };
  const busy = () => !!document.querySelector('.ou-dialog-scrim, .ou-menu-scrim');

  const down = (e) => {
    if (e.button !== 0 || busy()) return;
    const tl = e.target.closest('.cal-tl');
    if (!tl) return;
    const evn = e.target.closest('.cal-tl-ev, .cal-tl-bar'), col = e.target.closest('.cal-tl-col');
    const o = occ(evn);
    let mode = null;
    if (evn?.classList.contains('cal-tl-ev') && o && !o.readOnly) mode = e.target.closest('.cal-tl-rz') ? 'resize' : 'move';
    else if (evn?.classList.contains('cal-tl-bar') && o && !o.readOnly) mode = 'admove';
    else if (!evn && col) mode = 'create';
    if (!mode) return;
    drag = { mode, tl, evn, col, o, x: e.clientX, y: e.clientY, m0: minuteAt(tl, e.clientY), id: e.pointerId, started: false,
      top: evn ? +evn.style.getPropertyValue('--t') : 0, bot: evn ? +evn.style.getPropertyValue('--b') : 0, startCol: mode === 'admove' ? adColAt(tl, e.clientX) : col };
  };
  const move = (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.started = true;
      document.documentElement.classList.add('cal-dragging');
      if (d.mode === 'create') {
        d.ghost = h('div', { class: 'cal-tl-ev ghost', style: `--c:${D.calById(D.defaultCalId())?.color || M.PALETTE[0]}` }, h('div', { class: 'cal-tl-ev-in' }, h('b', null, t('cal.newEvent')), h('span', { class: 'cal-tl-ev-time' })));
        d.col.appendChild(d.ghost);
      } else d.evn.classList.add('dragging');
    }
    // keep the pointer's hour in view
    const sc = d.tl.querySelector('.cal-tl-scroll');
    if (sc && d.mode !== 'admove') { const r = sc.getBoundingClientRect(); if (e.clientY < r.top + 28) sc.scrollTop -= 12; else if (e.clientY > r.bottom - 28) sc.scrollTop += 12; }
    const m = minuteAt(d.tl, e.clientY);
    if (d.mode === 'create') {
      d.a = Math.floor(Math.min(d.m0, m) / SNAP) * SNAP;
      d.b = Math.max(d.a + SNAP, Math.ceil(Math.max(d.m0, m) / SNAP) * SNAP);
      for (const [k, v] of [['--t', d.a], ['--b', d.b], ['--col', 0], ['--cols', 1], ['--span', 1]]) d.ghost.style.setProperty(k, v);
      d.ghost.querySelector('.cal-tl-ev-time').textContent = `${fmtTime(new Date(at(d.col.dataset.day, d.a)))} – ${fmtTime(new Date(at(d.col.dataset.day, d.b)))}`;
    } else if (d.mode === 'move') {
      const len = d.bot - d.top;
      const top = clamp(d.top + snap(m - d.m0), 0, 1440 - Math.min(len, 1440));
      const tc = colAt(d.tl, e.clientX) || d.col;
      if (tc !== d.evn.parentElement) tc.appendChild(d.evn);
      d.days = M.daysBetween(M.parseKey(d.col.dataset.day), M.parseKey(tc.dataset.day));
      d.dm = top - d.top;
      for (const [k, v] of [['--t', top], ['--b', top + len], ['--col', 0], ['--cols', 1], ['--span', 1]]) d.evn.style.setProperty(k, v);
      d.evn.querySelector('.cal-tl-ev-time').textContent = fmtTime(new Date(M.atDay(M.addDays(d.o.start, d.days), d.o.start) + d.dm * 60e3));
    } else if (d.mode === 'resize') {
      d.nb = clamp(snap(m), d.top + SNAP, 1440);
      d.evn.style.setProperty('--b', d.nb);
      d.evn.classList.toggle('short', d.nb - d.top < 45);
    } else if (d.mode === 'admove') {
      const tc = adColAt(d.tl, e.clientX);
      if (tc && d.startCol) {
        const all = [...d.tl.querySelectorAll('.cal-tl-adc')], n = all.length;
        d.days = all.indexOf(tc) - all.indexOf(d.startCol);
        d.base ??= d.evn.style.gridColumn.split('/').map((x) => parseInt(x, 10));
        d.evn.style.gridColumn = `${clamp(d.base[0] + d.days, 1, n)} / ${clamp(d.base[1] + d.days, 2, n + 1)}`;
      }
    }
  };
  const end = (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    document.documentElement.classList.remove('cal-dragging');
    if (!d.started) return;
    swallow = true;
    setTimeout(() => { swallow = false; }, 0);
    if (e.type === 'pointercancel') return api.redraw();
    const o = d.o;
    if (d.mode === 'create') {
      const day = d.col.dataset.day;
      d.ghost.remove();
      return api.newEvent({ day: M.parseKey(day), start: at(day, d.a), end: at(day, d.b) });
    }
    let patch = null;
    if (d.mode === 'move' && (d.days || d.dm)) {
      const s = M.atDay(M.addDays(o.start, d.days), o.start) + d.dm * 60e3;
      patch = { start: s, end: s + (o.end - o.start) };
    } else if (d.mode === 'resize' && d.nb != null && d.nb !== d.bot) {
      const ne = at(d.evn.parentElement.dataset.day, d.nb);
      if (ne > o.start) patch = { end: ne };
    } else if (d.mode === 'admove' && d.days) {
      patch = { start: M.atDay(M.addDays(o.start, d.days), o.start), end: M.atDay(M.addDays(o.end, d.days), o.end) };
    }
    if (patch) api.change(o, patch);
    else api.redraw();
  };
  view.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);

  view.addEventListener('click', (e) => {
    if (swallow) return e.stopPropagation();
    if (!e.target.closest('.cal-tl')) return;
    const dh = e.target.closest('.cal-tl-dh');
    if (dh) return api.go(M.parseKey(dh.dataset.day), 'day');
    const o = occ(e.target.closest('.cal-tl-ev, .cal-tl-bar'));
    if (o) api.open(o);
  });
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const o = occ(e.target.closest?.('.cal-tl-ev, .cal-tl-bar'));
    if (o) { e.preventDefault(); e.stopPropagation(); api.open(o); }
  });
  view.addEventListener('dblclick', (e) => {
    const tl = e.target.closest('.cal-tl');
    if (!tl || e.target.closest('.cal-tl-ev, .cal-tl-bar, .cal-tl-dh')) return;
    const col = e.target.closest('.cal-tl-col');
    if (col) {
      const m = Math.min(Math.floor(minuteAt(tl, e.clientY) / 30) * 30, 1380);
      return api.newEvent({ day: M.parseKey(col.dataset.day), start: at(col.dataset.day, m), end: at(col.dataset.day, m + 60) });
    }
    const adc = e.target.closest('.cal-tl-ad') && adColAt(tl, e.clientX);
    if (adc) api.newEvent({ day: M.parseKey(adc.dataset.day), allDay: true });
  });
  view.addEventListener('contextmenu', (e) => {
    const o = occ(e.target.closest('.cal-tl-ev, .cal-tl-bar'));
    if (o) api.menu(e, o);
  });
  // Ctrl/⌘ + wheel or a trackpad pinch zooms the hours, keeping the time under the pointer in place
  let save = 0;
  view.addEventListener('wheel', (e) => {
    const sc = e.target.closest('.cal-tl-scroll');
    if (!sc || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const tl = sc.closest('.cal-tl'), r = sc.getBoundingClientRect(), y = e.clientY - r.top;
    const old = hh(), atMin = ((sc.scrollTop + y) / old) * 60;
    const next = clamp(old * Math.exp(-e.deltaY * 0.01), 28, 140);
    view._hh = next;
    tl.style.setProperty('--hh', next + 'px');
    sc.scrollTop = (atMin / 60) * next - y;
    clearTimeout(save);
    save = setTimeout(() => D.setPrefs({ hourH: Math.round(next) }), 600);
  }, { passive: false });
  return () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    clearTimeout(save);
  };
}
