// Calendar app window (Samsung Calendar, One UI): the top bar (≡ navigation drawer, month title that opens Go to date,
// search, the Today button), the views — Year, Month (grid with event bars + the selected day's agenda and quick
// add), Week and Day (timelines: drag to create, move and resize) and List — the navigation drawer (views,
// calendars to show or hide, Manage calendars, Settings), search, keyboard shortcuts and the FAB.
import { h, throttle } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { store } from '../core/store.js';
import { t, fmtDate, isRtl } from '../core/i18n.js';
import { iconBtn, menu, dialog, toast } from '../core/ui.js';
import { openApp } from '../core/apps.js';
import * as M from './model.js';
import * as D from './data.js';
import './strings.js';
import { altRange, altCal, eventWhen } from './format.js';
import { drawMonth, drawYear, drawList, itemEl } from './views.js';
import { drawTimeline, bindTimeline } from './timeline.js';
import { editEvent, openDetail, applyChange, deleteOcc, duplicateOcc, shareOcc, quickAdd } from './editor.js';
import { openManage, openSettings, importFile } from './manage.js';

addIcons({
  calMenu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  calYear: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  calMonth: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 3v3M16 3v3M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/>',
  calWeek: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8.5 9.5v11M12 9.5v11M15.5 9.5v11"/>',
  calDay: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M7.5 13.5h9M7.5 17h6"/>',
  calList: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.2"/><circle cx="4.8" cy="12" r="1.2"/><circle cx="4.8" cy="17.5" r="1.2"/>',
  calGift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 8.5v12M12 8.5c-1.5-3.5-5.5-4.5-5.5-1.8 0 1.8 3.5 1.8 5.5 1.8Zm0 0c1.5-3.5 5.5-4.5 5.5-1.8 0 1.8-3.5 1.8-5.5 1.8Z"/>',
  calRepeat: '<path d="M17 3.5 20 6.5 17 9.5"/><path d="M4 12v-1.5a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3"/><path d="M20 12v1.5a4 4 0 0 1-4 4H4"/>',
  calImport: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  calGoto: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M10 15h6M13.5 12.5 16 15l-2.5 2.5"/>',
});

const VIEWS = [['year', 'calYear', 'cal.vYear'], ['month', 'calMonth', 'cal.vMonth'], ['week', 'calWeek', 'cal.vWeek'], ['day', 'calDay', 'cal.vDay'], ['list', 'calList', 'cal.vList']];

export function render(ctx) {
  const page = ctx.page({ title: t('app.calendar'), hero: false, className: 'cal-page' });
  page.body.classList.add('flush');

  const p0 = D.prefs();
  const st = { view: VIEWS.some((v) => v[0] === p0.view) ? p0.view : 'month', cur: M.dayStart(new Date()), listDays: 60, searching: false, query: '' };

  // ---------------------------------------------------------------- the bars
  const titleText = h('span', { class: 'cal-title-text' });
  const titleBtn = h('button', { class: 'cal-title', title: t('cal.goTo'), onClick: () => goToDate() }, titleText, h('span', { class: 'cal-title-chev', html: icon('down', 18) }));
  const sub = h('div', { class: 'cal-sub' });
  const prevBtn = iconBtn('back', () => shift(-1), '');
  const nextBtn = iconBtn('forward', () => shift(1), '');
  prevBtn.classList.add('cal-prev');
  nextBtn.classList.add('cal-next');
  const todayNum = h('span', { class: 'cal-today-num' });
  const todayBtn = h('button', { class: 'ou-icon-btn cal-today-btn', title: t('cal.today'), 'aria-label': t('cal.today'), onClick: () => go(new Date()) }, todayNum);
  const bar = h('div', { class: 'cal-bar' },
    iconBtn('calMenu', () => openDrawer(), t('cal.menu')),
    h('div', { class: 'cal-titles' }, titleBtn, sub),
    h('div', { class: 'cal-nav' }, prevBtn, nextBtn),
    h('span', { class: 'cal-bar-gap' }),
    iconBtn('search', () => startSearch(), t('common.search')),
    todayBtn);
  const input = h('input', { type: 'search', class: 'cal-search-in', placeholder: t('cal.searchPh'), 'aria-label': t('common.search'), spellcheck: 'false', autocomplete: 'off' });
  const sbar = h('div', { class: 'cal-sbar' }, iconBtn('back', () => stopSearch(), t('common.back')), h('label', { class: 'ou-searchbox cal-searchbox' }, h('span', { html: icon('search', 20) }), input));
  const viewEl = h('div', { class: 'cal-view' });
  const results = h('div', { class: 'cal-results scroll' });
  const fab = h('button', { class: 'ou-fab cal-fab', title: t('cal.newEvent'), 'aria-label': t('cal.newEvent'), html: icon('plus', 26), onClick: () => api.newEvent({ day: st.cur }) });
  const root = h('div', { class: 'cal' }, bar, sbar, h('div', { class: 'cal-main' }, viewEl, results), fab);
  page.body.appendChild(root);

  // ---------------------------------------------------------------- the API the views and the editor use
  const api = {
    st,
    root,
    go: (d, view) => go(d, view),
    /** Month view: a tap on a day only moves the selection (the grid isn't redrawn). */
    select(d) {
      st.cur = M.dayStart(d);
      drawHead();
      api.onSelect?.();
    },
    open(o) {
      if (o.kind === 'reminder') return openApp('reminder', { params: { id: o.rid } });
      openDetail(o, api);
    },
    newEvent: (draft = {}) => editEvent(null, draft.day || st.cur, draft),
    edit: (o) => editEvent(o),
    change: (o, patch) => applyChange(o, patch).finally(() => redraw()),
    quickAdd: (text) => quickAdd(text, st.cur, api),
    menu(e, o) {
      e.preventDefault();
      if (o.kind === 'reminder') return menu(e, [{ label: t('cal.openReminder'), icon: 'checkCircle', onClick: () => openApp('reminder', { params: { id: o.rid } }) }]);
      if (o.kind === 'birthday') return menu(e, [{ label: t('cal.openContact'), icon: 'user', onClick: () => openApp('contacts', { params: { id: o.cid } }) }]);
      menu(e, [
        !o.readOnly && { label: t('common.edit'), icon: 'edit', onClick: () => editEvent(o) },
        { label: t('cal.duplicate'), icon: 'copy', onClick: () => duplicateOcc(o) },
        { label: t('cal.share'), icon: 'share', onClick: () => shareOcc(o) },
        !o.readOnly && '-',
        !o.readOnly && { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteOcc(o) },
      ]);
    },
    redraw: () => redraw(),
    item: (o, day) => itemEl(o, day, api),
  };

  // ---------------------------------------------------------------- drawing
  let raf = 0;
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); };
  let offView = null;
  function redraw() {
    cancelAnimationFrame(raf);
    raf = 0;
    root.dataset.view = st.view;
    offView?.();
    offView = null;
    api.onSelect = null;
    if (st.view === 'month') offView = drawMonth(viewEl, api);
    else if (st.view === 'year') offView = drawYear(viewEl, api);
    else if (st.view === 'list') offView = drawList(viewEl, api);
    else offView = drawTimeline(viewEl, api, st.view === 'day' ? [st.cur] : Array.from({ length: 7 }, (_, i) => M.addDays(M.startOfWeek(st.cur, D.firstDay()), i)));
    drawHead();
    if (st.searching) drawResults();
  }

  function drawHead() {
    const c = st.cur;
    let title, s = '';
    if (st.view === 'year') title = fmtDate(c, { year: 'numeric' });
    else if (st.view === 'day') title = fmtDate(c, { month: 'long', day: 'numeric', year: 'numeric' });
    else if (st.view === 'week') {
      const a = M.startOfWeek(c, D.firstDay()), b = M.addDays(a, 6);
      title = a.getMonth() === b.getMonth() ? fmtDate(a, { month: 'long', year: 'numeric' }) : `${fmtDate(a, { month: 'short' })} – ${fmtDate(b, { month: 'short', year: 'numeric' })}`;
      if (D.prefs().weekNumbers) s = t('cal.weekN', { n: M.weekNumber(c, D.firstDay()) });
    } else if (st.view === 'list') title = fmtDate(c, { month: 'long', year: 'numeric' });
    else title = fmtDate(c, { month: 'long', year: 'numeric' });
    if (altCal() && st.view === 'month') s = altRange(new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 0));
    else if (altCal() && st.view === 'day') s = altRange(c, c);
    titleText.textContent = title;
    page.setTitle(title);
    sub.textContent = s;
    sub.hidden = !s;
    todayNum.textContent = String(new Date().getDate());
    const unit = { year: ['cal.prevYear', 'cal.nextYear'], week: ['cal.prevWeek', 'cal.nextWeek'], day: ['cal.prevDay', 'cal.nextDay'] }[st.view] || ['cal.prevMonth', 'cal.nextMonth'];
    prevBtn.title = t(unit[0]);
    prevBtn.setAttribute('aria-label', t(unit[0]));
    nextBtn.title = t(unit[1]);
    nextBtn.setAttribute('aria-label', t(unit[1]));
  }

  function setView(v, d) {
    if (d) st.cur = M.dayStart(d);
    if (v !== st.view) {
      st.view = v;
      D.setPrefs({ view: v });
    }
    redraw();
  }

  function go(d, view) {
    d = M.dayStart(d);
    const before = st.cur;
    st.cur = d;
    if (view && view !== st.view) return setView(view);
    // in Month view a day of the same month only moves the selection
    if (st.view === 'month' && api.onSelect && d.getMonth() === before.getMonth() && d.getFullYear() === before.getFullYear()) return api.select(d);
    redraw();
    if (st.view === 'month' || st.view === 'year') slide(Math.sign(d - before));
  }

  function shift(n) {
    const c = st.cur;
    let d;
    if (st.view === 'year') d = new Date(c.getFullYear() + n, c.getMonth(), 1);
    else if (st.view === 'week') d = M.addDays(c, 7 * n);
    else if (st.view === 'day') d = M.addDays(c, n);
    else if (st.view === 'list') d = new Date(c.getFullYear(), c.getMonth() + n, 1);
    else d = new Date(c.getFullYear(), c.getMonth() + n, 1);
    // another month opens on its 1st, the current month on today (as Samsung Calendar does)
    if (st.view === 'month') {
      const today = new Date();
      if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) d = today;
    }
    st.cur = M.dayStart(d);
    redraw();
    slide(n);
  }

  function slide(dir) {
    if (!dir) return;
    const el = viewEl.firstElementChild;
    if (!el) return;
    el.classList.remove('slide-l', 'slide-r');
    void el.offsetWidth;
    el.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
  }

  // ---------------------------------------------------------------- Go to date
  async function goToDate() {
    const inp = h('input', { class: 'ou-input cal-goto-in', type: 'date', value: M.dkey(st.cur) });
    const res = await dialog({
      title: t('cal.goTo'),
      content: h('div', { class: 'ou-dialog-body' }, inp),
      actions: [{ label: t('common.cancel'), value: null }, { label: t('cal.today'), value: 'today' }, { label: t('cal.go'), value: () => inp.value || null, primary: true }],
    });
    if (res === 'today') go(new Date());
    else if (res && M.isKey(res)) go(M.parseKey(res), st.view === 'year' ? 'month' : st.view);
  }

  // ---------------------------------------------------------------- search
  function startSearch() {
    st.searching = true;
    root.classList.add('searching');
    drawResults();
    setTimeout(() => input.focus(), 30);
  }
  function stopSearch() {
    st.searching = false;
    st.query = '';
    input.value = '';
    root.classList.remove('searching');
  }
  const onSearch = throttle(() => { st.query = input.value; drawResults(); }, 120);
  input.addEventListener('input', onSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopSearch(); }
    else if (e.key === 'Enter') results.querySelector('.cal-item')?.click();
  });
  function drawResults() {
    const q = st.query.trim();
    if (!q) return results.replaceChildren(h('div', { class: 'ou-empty cal-empty' }, h('span', { html: icon('search', 48) }), t('cal.searchHint')));
    const list = D.search(q);
    if (!list.length) return results.replaceChildren(h('div', { class: 'ou-empty cal-empty' }, h('span', { html: icon('search', 48) }), t('cal.noResults')));
    results.replaceChildren(h('div', { class: 'cal-res-count' }, t('cal.results', { n: list.length })),
      ...list.map((o) => {
        const el = itemEl(o, null, api);
        el.querySelector('.cal-item-time').textContent = eventWhen(o);
        return el;
      }));
  }

  // ---------------------------------------------------------------- the navigation drawer
  let drawer = null;
  function openDrawer() {
    const item = (ic, label, onClick, cls = '', extra = null) => h('button', { class: ['cal-dw-item', cls], onClick: () => { closeDrawer(); onClick(); } },
      h('span', { class: 'cal-dw-ico', html: icon(ic, 22) }), h('span', { class: 'cal-dw-label' }, label), extra);
    const cals = D.allCals();
    const calRow = (c) => {
      const chk = h('span', { class: ['cal-dw-chk', !c.hidden && 'on'], html: icon('check', 16) });
      const r = h('button', { class: 'cal-dw-cal', role: 'checkbox', 'aria-checked': String(!c.hidden), style: `--c:${c.color}`, dataset: { cal: c.id },
        onClick: () => {
          const hidden = new Set(D.prefs().hidden);
          if (hidden.has(c.id)) hidden.delete(c.id);
          else hidden.add(c.id);
          D.setPrefs({ hidden: [...hidden] });
          chk.classList.toggle('on', !hidden.has(c.id));
          r.setAttribute('aria-checked', String(!hidden.has(c.id)));
        } }, chk, h('span', { class: 'cal-dw-cname' }, c.name), c.error ? h('span', { class: 'cal-dw-err', title: c.error, html: icon('info', 16) }) : null);
      return r;
    };
    const panel = h('div', { class: 'cal-dw', role: 'dialog', 'aria-label': t('cal.menu') },
      h('div', { class: 'cal-dw-top' }, iconBtn('settings', () => { closeDrawer(); openSettings(ctx, api); }, t('cal.settings'))),
      ...VIEWS.map(([v, ic, label]) => item(ic, t(label), () => setView(v), st.view === v ? 'on' : '')),
      h('div', { class: 'cal-dw-div' }),
      item('calGoto', t('cal.goTo'), () => goToDate()),
      item('calImport', t('cal.import'), () => importFile(api)),
      h('div', { class: 'cal-dw-div' }),
      h('div', { class: 'cal-dw-h' }, t('cal.calendars')),
      ...cals.map(calRow),
      item('edit', t('cal.manage'), () => openManage(ctx, api), 'accent'));
    const scrim = h('div', { class: 'cal-dw-scrim', onPointerdown: () => closeDrawer() });
    drawer = h('div', { class: 'cal-dw-wrap' }, scrim, panel);
    root.appendChild(drawer);
    requestAnimationFrame(() => drawer?.classList.add('show'));
    panel.querySelector('.cal-dw-item.on, .cal-dw-item')?.focus({ preventScroll: true });
  }
  function closeDrawer() {
    const dw = drawer;
    drawer = null;
    if (!dw) return;
    dw.classList.remove('show');
    setTimeout(() => dw.remove(), 260);
  }

  // ---------------------------------------------------------------- keyboard
  const onKey = (e) => {
    if (!ctx.focused || !root.isConnected || ctx.depth > 1) return;
    if (document.querySelector('.ou-dialog-scrim, .ou-menu-scrim')) return;
    if (e.key === 'Escape') {
      if (drawer) { e.preventDefault(); e.stopPropagation(); closeDrawer(); }
      else if (st.searching) { e.preventDefault(); e.stopPropagation(); stopSearch(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); startSearch(); return; }
    if (e.target.closest?.('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || st.searching || drawer) return;
    const rtl = isRtl();
    const side = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[e.key];
    const c = st.cur;
    if (side != null || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const vert = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (st.view === 'year') go(new Date(c.getFullYear(), c.getMonth() + (side || vert * 3), 1));
      else if (st.view === 'month' || st.view === 'list') go(M.addDays(c, side || vert * 7));
      else go(M.addDays(c, side || vert * 7));
      return;
    }
    const k = e.key.toLowerCase();
    if (e.key === 'PageUp') shift(-1);
    else if (e.key === 'PageDown') shift(1);
    else if (k === 't') go(new Date());
    else if (k === 'n') { e.preventDefault(); api.newEvent({ day: st.cur }); }
    else if (k === 'g') { e.preventDefault(); goToDate(); }
    else if (e.key === '/') { e.preventDefault(); startSearch(); }
    else if (k === 'y' || k === 'm' || k === 'w' || k === 'd' || k === 'l') setView({ y: 'year', m: 'month', w: 'week', d: 'day', l: 'list' }[k]);
    else if (e.key === 'Enter' && st.view === 'month') api.newEvent({ day: st.cur });
  };
  // capture: the window's own Escape (close the app) must not run when Escape only closes the drawer or search
  addEventListener('keydown', onKey, true);

  // wheel and swipe change the month / year (Week and Day scroll their hours; a sideways swipe changes the week)
  const wheel = throttle((d) => shift(d > 0 ? 1 : -1), 450);
  viewEl.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (st.view === 'month' || st.view === 'year') {
      if (e.target.closest('.cal-day, .cal-yv')) return;
      const d = sideways ? e.deltaX * (isRtl() ? -1 : 1) : e.deltaY;
      if (Math.abs(d) < 20) return;
      e.preventDefault();
      wheel(d);
    } else if ((st.view === 'week' || st.view === 'day') && sideways && Math.abs(e.deltaX) > 30) {
      e.preventDefault();
      wheel(e.deltaX * (isRtl() ? -1 : 1));
    }
  }, { passive: false });
  let sx = null;
  viewEl.addEventListener('pointerdown', (e) => { sx = st.view === 'month' && e.target.closest('.cal-weeks') && e.pointerType !== 'mouse' ? e.clientX : null; });
  viewEl.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 70) shift((dx < 0) !== isRtl() ? 1 : -1);
  });

  const offTl = bindTimeline(viewEl, api);
  // below ~880 px the month grid and the day's agenda stack (a phone-sized pop-up, split screen)
  const ro = new ResizeObserver(() => root.classList.toggle('narrow', root.clientWidth < 880));
  ro.observe(root);
  root.classList.toggle('narrow', root.clientWidth < 880 || (!root.clientWidth && innerWidth < 920));

  // ---------------------------------------------------------------- params (widget days, Finder results, notifications)
  ctx.setParams = (p) => {
    if (!p) return;
    if (p.view && VIEWS.some((v) => v[0] === p.view)) setView(p.view);
    if (p.date) go(new Date(p.date), st.view === 'year' ? 'month' : undefined);
    const id = p.id || (/^event:/.test(p.section || '') ? p.section.slice(6) : null);
    if (id) {
      const ev = D.byId(id);
      if (ev) {
        const from = p.occ ? M.parseKey(p.occ) : new Date();
        const o = D.occurrences(M.addDays(from, -1), M.addDays(from, ev.repeat ? 400 : 1), { all: true }).find((x) => x.master === id && (!p.occ || x.occ === p.occ))
          || M.expand([ev], ev.start, ev.end + 1)[0];
        if (o) {
          go(new Date(o.start));
          openDetail(o, api);
        }
      } else toast(t('cal.notFound'));
    }
    if (p.new) api.newEvent({ day: st.cur });
  };

  const offs = ['events', 'calPrefs', 'calendars', 'calSubs', D.SUB_KEY, 'reminders', 'contacts'].map((k) => store.on(k, later));
  const tick = setInterval(() => {
    const n = todayNum.textContent;
    if (n !== String(new Date().getDate())) redraw();
  }, 60e3);
  redraw();
  ctx.setParams(ctx.params);

  return () => {
    offs.forEach((f) => f());
    offView?.();
    offTl?.();
    ro.disconnect();
    clearInterval(tick);
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey, true);
  };
}

