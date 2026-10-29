// Samsung Weather (One UI): one place at a time over its animated sky, swipe (or ←/→, a trackpad swipe, the page
// dots) to go through the main location and the saved cities; the header, insight, hourly and 10-day forecasts and
// the detail cards come from js/weather/cards.js, each card opening its detail page (js/weather/detail.js).
// ≡ opens Manage locations (js/weather/places.js), ⋮ has Add location and Settings (js/weather/settings.js).
// Loaded by js/apps/weather.js when the app opens.
import './strings.js';
import { h, everyMinute } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, isRtl } from '../core/i18n.js';
import { store, onSetting } from '../core/store.js';
import { iconBtn, menu, toast } from '../core/ui.js';
import { HERE, places, peekPlace, getPlaceWeather, placeName, skyColors, weatherInfo } from '../services/weather.js';
import { skyPhase, weatherKind, VERSION } from './model.js';
import { skyEl, skyKey } from './sky.js';
import { headerEl, insightEl, hourlyEl, dailyEl, tilesEl } from './cards.js';
import { openDetail } from './detail.js';
import { openPlaces, openSearch } from './places.js';
import { openSettings } from './settings.js';

const TTL = 30 * 60e3;
const reduced = () => document.documentElement.dataset.motion === 'reduce';

export function render(ctx) {
  let list = places();
  let cur = list[0].id, shownId = null, alive = true, skyTop = '', suppressClick = 0;
  const errs = new Map(), busy = new Set();
  const curPlace = () => list.find((p) => p.id === cur) || list[0];
  const dataOf = (p) => peekPlace(p, list);

  async function load(p, force = false) {
    if (!p) return null;
    busy.add(p.id);
    const r = await getPlaceWeather(p, { force });
    busy.delete(p.id);
    if (r?.error) errs.set(p.id, r);
    else errs.delete(p.id);
    if (alive && p.id === cur) draw();
    return r;
  }

  // ——— one place on a page (the main screen, or a city's preview before it is added) ———
  function setSky(pg, p, d) {
    const key = `${p?.id}|${skyKey(d)}`;
    if (pg.skyKey === key) return;
    pg.skyKey = key;
    let host = pg.el.querySelector(':scope > .wx-skyhost');
    if (!host) pg.el.prepend((host = h('div', { class: 'wx-skyhost' })));
    const el = skyEl(d, { seed: p?.id || 'wx' });
    const old = [...host.children];
    host.appendChild(el);
    if (old.length && !reduced()) {
      el.classList.add('fade');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('fade')));
      setTimeout(() => old.forEach((x) => x.remove()), 650);
    } else old.forEach((x) => x.remove());
    const top = skyColors(d?.current?.code ?? 2, d ? skyPhase(d) : 'day')[0];
    pg.el.style.setProperty('--wx-top', top);
    pg.el.dataset.phase = d ? skyPhase(d) : 'day';
    pg.el.dataset.kind = d ? weatherKind(d.current.code) : 'partly';
    if (pg === page) skyTop = top;
    ctx.win.style.background = top;
  }

  function emptyEl(p, err, retry) {
    const box = h('div', { class: 'wx-empty' },
      h('div', { class: 'wx-empty-name' }, p.id === HERE ? h('span', { html: icon('navigation', 16) }) : null, placeName(p, null)),
      h('div', { class: 'wx-empty-ico', html: weatherInfo(2, true).icon }),
      h('p', null, err?.message || t('wx.loading')));
    if (err?.error === 'location') box.append(h('button', { class: 'ou-btn primary', onClick: () => openSearch(ctx, app) }, t('wx.chooseCity')));
    else if (err) box.append(h('button', { class: 'ou-btn primary', onClick: retry }, t('wx.retry')));
    return box;
  }

  function placeView(pg, p, d, { error, index = 0, total = 1, main = false } = {}) {
    pg.wx = { p, d };
    setSky(pg, p, d);
    pg.setTitle(placeName(p, d));
    if (!pg.bound) {
      pg.bound = true;
      pg.body.addEventListener('click', (e) => {
        if (Date.now() < suppressClick) return;
        const { p: pp, d: dd } = pg.wx;
        if (!dd || e.target.closest('.wx-refresh, .wx-dots')) return;
        const day = e.target.closest('[data-day]');
        if (day) return openDetail(ctx, pp, dd, { metric: 'temp', day: +day.dataset.day });
        const m = e.target.closest('[data-open]');
        if (m) openDetail(ctx, pp, dd, { metric: m.dataset.open });
      });
    }
    if (!d) {
      pg.body.replaceChildren(emptyEl(p, error, () => {
        errs.delete(p.id);
        draw();
        load(p, true);
      }));
      return;
    }
    pg.body.replaceChildren(
      headerEl(p, d, { index, total, hereFirst: main && list[0].id === HERE, onDot: main ? (i) => show(list[i].id, Math.sign(i - index)) : null, onRefresh: main ? refresh : null }),
      insightEl(d), hourlyEl(d), dailyEl(d), tilesEl(d),
      h('div', { class: 'wx-credit' }, t('wx.credit')));
  }

  // ——— the main screen ———
  const menuBtn = h('button', { class: 'ou-icon-btn wx-menu', title: t('wx.manage'), 'aria-label': t('wx.manage'), html: icon('list', 22), onClick: () => openPlaces(ctx, app) });
  const page = ctx.page({
    title: '',
    hero: false,
    className: 'wx-page wx-mainpage',
    actions: [iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('wx.addLocation'), icon: 'plus', onClick: () => openSearch(ctx, app) },
      { label: t('wx.manage'), icon: 'list', onClick: () => openPlaces(ctx, app) },
      { label: t('common.settings'), icon: 'settings', onClick: () => openSettings(ctx) },
    ], { align: 'end' }), t('common.more'))],
  });
  page.el.querySelector('.app-toolbar').prepend(menuBtn);
  page.onReturn = () => {
    if (skyTop) ctx.win.style.background = skyTop;
    draw();
  };
  const app = { dataOf, load, show: (id) => show(id), placeView };

  function draw() {
    if (!alive) return;
    list = places();
    if (!list.some((p) => p.id === cur)) cur = list[0].id;
    const i = list.findIndex((p) => p.id === cur), p = list[i], d = dataOf(p);
    const same = shownId === p.id, sc = page.scrollEl.scrollTop, hs = page.body.querySelector('.wx-hstrip')?.scrollLeft;
    placeView(page, p, d, { error: busy.has(p.id) ? null : errs.get(p.id), index: i, total: list.length, main: true });
    shownId = p.id;
    if (same) {
      page.scrollEl.scrollTop = sc;
      const strip = page.body.querySelector('.wx-hstrip');
      if (strip && hs) strip.scrollLeft = hs;
    }
  }

  async function refresh() {
    const p = curPlace(), before = dataOf(p)?.fetchedAt;
    page.body.querySelector('.wx-refresh')?.classList.add('spin');
    const r = await load(p, true);
    page.body.querySelector('.wx-refresh')?.classList.remove('spin');
    if (alive && (r?.error || (before && dataOf(p)?.fetchedAt === before))) toast(t('wx.updateFailed'));
  }

  /** Shows a place; dir (±1) slides the new one in from that side. */
  function show(id, dir = 0) {
    list = places();
    if (!list.some((p) => p.id === id)) id = list[0].id;
    const changed = id !== cur;
    cur = id;
    if (changed) page.scrollEl.scrollTop = 0;
    page.body.style.transform = '';
    page.body.style.opacity = '';
    draw();
    if (changed && dir && !reduced()) {
      const x = (isRtl() ? -dir : dir) * 70;
      page.body.animate([{ transform: `translateX(${x}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.22,.25,0,1)' });
    }
    const p = curPlace(), d = dataOf(p);
    if (!d || Date.now() - d.fetchedAt > TTL || !(d.v >= VERSION)) load(p, !!d && !(d.v >= VERSION));
  }
  /** Next (+1) or previous (−1) place; false at either end. */
  function go(step) {
    const i = list.findIndex((p) => p.id === cur), j = i + step;
    if (j < 0 || j >= list.length) return false;
    show(list[j].id, step);
    return true;
  }

  // swipe between places: a horizontal drag anywhere but the hourly strip
  const sc = page.scrollEl;
  let drag = null;
  sc.addEventListener('pointerdown', (e) => {
    if (e.button || list.length < 2 || e.target.closest('.wx-hstrip, input')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
  });
  sc.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        drag.on = true;
        sc.setPointerCapture(drag.id);
        page.body.classList.add('swiping');
      } else if (Math.abs(dy) > 12) {
        drag = null;
        return;
      }
    }
    if (drag.on) {
      const i = list.findIndex((p) => p.id === cur), step = dx < 0 !== isRtl() ? 1 : -1, edge = i + step >= 0 && i + step < list.length ? 1 : 0.25;
      page.body.style.transform = `translateX(${(dx * edge).toFixed(0)}px)`;
      page.body.style.opacity = String(1 - Math.min(0.5, Math.abs(dx * edge) / 500));
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d0 = drag;
    drag = null;
    if (!d0.on) return;
    suppressClick = Date.now() + 350;
    page.body.classList.remove('swiping');
    const dx = e.clientX - d0.x;
    if (Math.abs(dx) > 70 && go(dx < 0 !== isRtl() ? 1 : -1)) return;
    page.body.style.transform = '';
    page.body.style.opacity = '';
  };
  sc.addEventListener('pointerup', endDrag);
  sc.addEventListener('pointercancel', endDrag);
  sc.addEventListener('click', (e) => {
    if (Date.now() < suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  let wheelX = 0, wheelAt = 0;
  sc.addEventListener('wheel', (e) => {
    if (list.length < 2 || e.target.closest('.wx-hstrip') || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 650) return;
    wheelX += e.deltaX;
    if (Math.abs(wheelX) > 60) {
      go(wheelX > 0 !== isRtl() ? 1 : -1);
      wheelX = 0;
      wheelAt = Date.now();
    }
  }, { passive: false });
  page.el.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.target.closest('input, .wx-hstrip, .wx-days') || ctx.depth > 1) return;
    if (go(e.key === 'ArrowRight' !== isRtl() ? 1 : -1)) e.preventDefault();
  });
  sc.addEventListener('scroll', () => {
    page.el.querySelector('.app-toolbar').classList.toggle('wx-scrolled', sc.scrollTop > 150);
    page.el.style.setProperty('--wx-s', Math.min(1, sc.scrollTop / 320).toFixed(2));
  }, { passive: true });

  // ——— live updates ———
  let queued = false;
  const redraw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!drag?.on) draw();
    });
  };
  let hour = new Date().getHours();
  const offs = [
    store.on('weather', redraw), store.on('weatherMore', redraw), store.on('weatherPlaces', redraw), store.on('weatherPrefs', redraw),
    onSetting('location', redraw), onSetting('tempUnit', redraw),
    everyMinute((now) => {
      const d = dataOf(curPlace());
      if (now.getHours() !== hour || (d && page.skyKey !== `${cur}|${skyKey(d)}`)) {
        hour = now.getHours();
        redraw();
      }
      if (d && Date.now() - d.fetchedAt > TTL && !busy.has(cur)) load(curPlace());
    }),
  ];
  const onVis = () => {
    if (document.visibilityState !== 'visible') return;
    const d = dataOf(curPlace());
    if (!d || Date.now() - d.fetchedAt > TTL) load(curPlace());
  };
  document.addEventListener('visibilitychange', onVis);

  // Notifications and Finder open a place (section = its id) or Manage locations
  const open = (params) => {
    const s = params?.section;
    if (s === 'manage') openPlaces(ctx, app);
    else if (s === 'add') openSearch(ctx, app);
    else if (s && list.some((p) => p.id === s)) {
      while (ctx.depth > 1) ctx.pop();
      show(s);
    }
  };
  ctx.setParams = open;

  show(cur);
  open(ctx.params);
  return () => {
    alive = false;
    offs.forEach((f) => f());
    document.removeEventListener('visibilitychange', onVis);
  };
}
