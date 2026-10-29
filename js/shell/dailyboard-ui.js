// The Daily Board screen and its Settings page (loaded by dailyboard.js when one of them opens).
// Pages, swiped sideways (arrows, a trackpad swipe or a drag): Photo frame (your photos or the wallpaper, with a
// clock, the date, weather and the next event), Clock (digital in a Lock screen font, or analog), Calendar (today, the
// month and upcoming events) and Widgets (two Home screen widgets, display only). A music card shows while a media
// source is registered (core/hooks.js activeMedia). Night mode dims it to red light; the screen stays awake (Screen
// Wake Lock); Esc or a click goes back to whatever was underneath (Lock screen, Home screen or an app).
import { h, $$, everySecond, startOfDay, sameDay, pickFile, readImage, uid } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, tr, fmtHM, fmtPeriod, fmtDate, fmtTime, isRtl, locale, lang } from '../core/i18n.js';
import { store, setting } from '../core/store.js';
import { activeMedia, onMediaChange } from '../core/hooks.js';
import { getWidget, getWidgets } from '../core/widgets.js';
import { putBlob, blobUrl, delBlob, dataUrlToBlob } from '../core/blobs.js';
import { row, switchRow, list, subheader, choose, seg, toast, card, btn } from '../core/ui.js';
import { getApp, appName } from '../core/apps.js';
import { paintPreset, presetById } from './wallpaper.js';
import { CLOCK_FONTS, lockPrivacy } from './lock.js';
import { weatherInfo, fmtTemp, getWeather } from '../services/weather.js';
import { upcomingEvents } from '../apps/calendar.js';
import { eventDays } from '../calendar/data.js';
import { dkey } from '../calendar/model.js';
import { prefs, savePrefs, PAGES, DB_DEFAULTS } from './dailyboard.js';

let B = null; // the open board: { el, track, dots, p, idx, pages, stops, wake, fs, dragged }

const fontOf = (p) => CLOCK_FONTS[p.font] || CLOCK_FONTS.outfit;

/** Night mode hours wrap around midnight (22 → 7). */
export function isNight(p, d = new Date()) {
  if (!p.night) return false;
  const hr = d.getHours();
  return p.nightFrom > p.nightTo ? hr >= p.nightFrom || hr < p.nightTo : hr >= p.nightFrom && hr < p.nightTo;
}

// ——— clocks ———
function digitalClock(p, cls) {
  const hm = h('span', { class: 'db-hm' });
  const ap = h('span', { class: 'db-ap' });
  const el = h('div', { class: ['db-digital', cls], style: { fontFamily: fontOf(p) } }, hm, ap);
  el.tick = (d) => {
    hm.textContent = fmtHM(d);
    ap.textContent = fmtPeriod(d);
  };
  return el;
}

function analogClock(cls) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i * 6 * Math.PI) / 180, major = i % 5 === 0, r1 = major ? 82 : 88;
    return `<line x1="${(100 + Math.sin(a) * r1).toFixed(2)}" y1="${(100 - Math.cos(a) * r1).toFixed(2)}" x2="${(100 + Math.sin(a) * 93).toFixed(2)}" y2="${(100 - Math.cos(a) * 93).toFixed(2)}"${major ? ' class="mj"' : ''}/>`;
  }).join('');
  const el = h('div', {
    class: ['db-analog', cls],
    html: `<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="face" cx="100" cy="100" r="98"/><g class="tk">${ticks}</g>`
      + '<line class="hh" x1="100" y1="112" x2="100" y2="52"/><line class="mm" x1="100" y1="116" x2="100" y2="24"/>'
      + '<g class="ss"><line x1="100" y1="124" x2="100" y2="16"/></g><circle class="cap" cx="100" cy="100" r="4.5"/></svg>',
  });
  const [hh, mm, ss] = ['.hh', '.mm', '.ss'].map((s) => el.querySelector(s));
  el.tick = (d) => {
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
    hh.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
    mm.setAttribute('transform', `rotate(${m * 6} 100 100)`);
    ss.setAttribute('transform', `rotate(${s * 6} 100 100)`);
  };
  return el;
}

const clockOf = (p, cls) => (p.clock === 'analog' ? analogClock(cls) : digitalClock(p, cls));

// ——— small facts: weather, next event ———
function weatherChip() {
  const wx = store.get('weather');
  if (!wx?.current) return null;
  const info = weatherInfo(wx.current.code, wx.current.isDay);
  return h('span', { class: 'db-chip db-wx' }, h('span', { class: 'db-wx-ico', html: info.icon }), h('b', null, fmtTemp(wx.current.temp)),
    h('span', null, wx.location?.name ? `${info.label} · ${wx.location.name}` : info.label));
}

function eventChip() {
  const ev = upcomingEvents(1)[0];
  if (!ev || ev.start - Date.now() > 36 * 3600e3) return null;
  const when = ev.allDay ? t('db.allDay') : (sameDay(ev.start, Date.now()) ? '' : fmtDate(new Date(ev.start), { weekday: 'short' }) + ' ') + fmtTime(new Date(ev.start));
  return h('span', { class: 'db-chip db-ev' }, h('i', { class: 'db-ev-dot', style: { background: ev.color || 'var(--accent)' } }), h('b', null, evTitle(ev)), h('span', null, when));
}

// ——— backgrounds: photos or the wallpaper ———
function wallpaperBg(box) {
  const wp = setting('wallpaper') || { type: 'preset', id: 'bloom' };
  if (wp.type === 'color') {
    box.style.background = wp.value;
    return null;
  }
  if (wp.type === 'image' || wp.type === 'bing') {
    const url = wp.type === 'image' ? store.get('wallpaperImage') : store.get('bing')?.url;
    if (url) {
      box.appendChild(h('div', { class: 'db-slide on still', style: { backgroundImage: `url("${url}")` } }));
      return null;
    }
  }
  // the animated bloom wallpaper on its own small canvas (scaled up = soft), 24 fps
  const c = h('canvas', { class: 'db-canvas', width: 192, height: 120 });
  box.appendChild(c);
  const p = presetById(wp.type === 'preset' ? wp.id : 'bloom');
  const t0 = performance.now();
  paintPreset(c, p, 0);
  if (setting('reduceMotion') || !setting('wallpaperAnimated')) return null;
  let raf = 0, last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / 24 || document.hidden) return;
    last = now;
    paintPreset(c, p, (now - t0) / 1000);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

async function photoBg(box, p) {
  const urls = p.source === 'photos' ? (await Promise.all(p.photos.map((id) => blobUrl('dailyboard:' + id).catch(() => null)))).filter(Boolean) : [];
  if (!B) return null;
  if (!urls.length) return wallpaperBg(box);
  box.dataset.photos = urls.length;
  let i = 0;
  const show = () => {
    const layer = h('div', { class: ['db-slide', i % 2 && 'alt'], style: { backgroundImage: `url("${urls[i % urls.length]}")` } });
    box.appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('on')));
    const old = [...box.children].slice(0, -1);
    setTimeout(() => old.forEach((o) => o.remove()), 1800);
    box.dataset.index = i % urls.length;
    i++;
  };
  show();
  if (urls.length < 2) return null;
  const timer = setInterval(show, Math.max(5, p.interval) * 1000);
  return () => clearInterval(timer);
}

// ——— pages ———
function photoPage(p) {
  const bg = h('div', { class: 'db-bg' });
  const clock = clockOf(p, 'small');
  const date = h('div', { class: 'db-date' });
  const facts = h('div', { class: 'db-facts' });
  const el = h('section', { class: 'db-page db-photo', dataset: { page: 'photo' } }, bg, h('div', { class: 'db-shade' }), h('div', { class: 'db-pinfo db-shift' }, clock, date, facts));
  photoBg(bg, p).then((stop) => stop && (B ? B.stops.push(stop) : stop()));
  return {
    el,
    tick(d) {
      clock.tick(d);
      date.textContent = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    },
    minute: () => facts.replaceChildren(...[weatherChip(), eventChip()].filter(Boolean)),
  };
}

function clockPage(p) {
  const clock = clockOf(p, 'big');
  const date = h('div', { class: 'db-date big' });
  const facts = h('div', { class: 'db-facts center' });
  return {
    el: h('section', { class: ['db-page', 'db-clockpage', p.clock === 'analog' && 'analog'], dataset: { page: 'clock' } }, h('div', { class: 'db-center db-shift' }, clock, h('div', { class: 'db-side' }, date, facts))),
    tick(d) {
      clock.tick(d);
      date.textContent = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
    },
    minute: () => facts.replaceChildren(...[weatherChip(), eventChip()].filter(Boolean)),
  };
}

function firstDayOfWeek() {
  try {
    const info = new Intl.Locale(locale()).weekInfo || new Intl.Locale(locale()).getWeekInfo?.();
    if (info?.firstDay) return info.firstDay % 7;
  } catch {}
  return lang() === 'ar' ? 6 : 0;
}

function monthGrid(d) {
  const first = firstDayOfWeek();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const lead = (start.getDay() - first + 7) % 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // Calendar's own day marks: repeating, multi-day and subscribed events mark every day they happen
  const busy = eventDays(new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const head = Array.from({ length: 7 }, (_, i) => h('span', { class: ['db-mh', (first + i) % 7 === 0 && 'sun'] }, fmtDate(new Date(2024, 0, 7 + ((first + i) % 7)), { weekday: 'narrow' })));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span'));
  for (let n = 1; n <= days; n++) {
    const day = new Date(d.getFullYear(), d.getMonth(), n);
    cells.push(h('span', { class: ['db-md', n === d.getDate() && 'today', day.getDay() === 0 && 'sun', busy.has(dkey(day)) && 'busy'] }, String(n)));
  }
  return h('div', { class: 'db-month' }, h('div', { class: 'db-month-title' }, fmtDate(d, { month: 'long', year: 'numeric' })), h('div', { class: 'db-grid' }, head, cells));
}

function calendarPage() {
  const wd = h('div', { class: 'db-cal-wd' });
  const num = h('div', { class: 'db-cal-num' });
  const evs = h('div', { class: 'db-cal-evs' });
  const gridBox = h('div', { class: 'db-cal-right' });
  let day = '';
  return {
    el: h('section', { class: 'db-page db-calpage', dataset: { page: 'calendar' } },
      h('div', { class: 'db-cal db-shift' }, h('div', { class: 'db-cal-left' }, wd, num, evs), gridBox)),
    tick(d) {
      if (day === d.toDateString()) return;
      day = d.toDateString();
      wd.textContent = fmtDate(d, { weekday: 'long' });
      num.textContent = String(d.getDate());
      gridBox.replaceChildren(monthGrid(d));
    },
    minute() {
      gridBox.replaceChildren(monthGrid(new Date()));
      const list = upcomingEvents(4).filter((e) => e.start - Date.now() < 7 * 864e5);
      evs.replaceChildren(...(list.length
        ? list.map((e) => h('div', { class: 'db-cal-ev' }, h('i', { style: { background: e.color || 'var(--accent)' } }),
          h('span', { class: 'db-cal-ev-text' }, h('b', null, evTitle(e)),
            h('span', null, (sameDay(e.start, Date.now()) ? t('common.today') : fmtDate(new Date(e.start), { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + (e.allDay ? t('db.allDay') : fmtTime(new Date(e.start)))))))
        : [h('div', { class: 'db-cal-none' }, t('db.noEvents'))]));
    },
  };
}

// While the Lock screen is up behind the board and a screen-lock PIN guards it, the board shows nothing the PIN
// protects: widgets (notes, reminders, events…) give way to a padlock and event titles to "Event", like the Lock
// screen's own chips. The board checks every second, so locking or unlocking underneath redraws it.
const guarded = () => { const lp = lockPrivacy(); return !!(lp.locked && lp.private); };
const evTitle = (e) => (guarded() ? t('db.event') : e.title);

// The widgets render at a natural Home screen size and are scaled up to fill their half of the screen.
const NATURAL = { l: [380, 380], m: [380, 180], s: [180, 180] };
function widgetsPage(p) {
  const ids = [...new Set([...p.widgets, ...DB_DEFAULTS.widgets])].filter((id) => getWidget(id)).slice(0, 2);
  const row = h('div', { class: 'db-wrow db-shift' });
  let cleanups = [], slots = [], hidden = null;
  const ro = new ResizeObserver(() => slots.forEach((s) => s.fit?.()));
  const build = () => {
    cleanups.forEach((c) => c());
    cleanups = [];
    ro.disconnect();
    hidden = guarded();
    slots = ids.map((id) => {
      const w = getWidget(id);
      if (hidden) {
        return h('div', { class: 'db-wslot db-wlocked', dataset: { widget: id } },
          h('div', { class: 'db-wlock' }, h('span', { class: 'db-wlock-ico', html: icon('lock', 30) }), h('b', null, tr(w.name)), h('span', null, t('db.unlockToSee'))));
      }
      const size = w.sizes.includes('l') ? 'l' : w.sizes.includes('s') ? 's' : w.sizes[0];
      const [W, H] = NATURAL[size];
      const box = h('div', { class: ['wg', `w-${size}`], style: { width: W + 'px', height: H + 'px' } });
      try {
        const c = w.render(box, { size, item: { id: 'db-' + id, widget: id, size, config: {} }, config: {}, setConfig() {}, preview: true });
        if (typeof c === 'function') cleanups.push(c);
      } catch (e) {
        console.warn('daily board widget', id, e);
      }
      box.setAttribute('aria-label', tr(w.name));
      const slot = h('div', { class: 'db-wslot', dataset: { widget: id } }, box);
      slot.fit = () => {
        const r = slot.getBoundingClientRect();
        if (!r.width) return;
        box.style.transform = `scale(${Math.min(r.width / W, r.height / H, 2.4).toFixed(3)})`;
      };
      ro.observe(slot);
      return slot;
    });
    row.replaceChildren(...slots);
  };
  build();
  return {
    el: h('section', { class: 'db-page db-widgets', dataset: { page: 'widgets' } }, row),
    tick: () => guarded() !== hidden && build(),
    cleanup: () => {
      ro.disconnect();
      cleanups.forEach((c) => c());
    },
  };
}

function musicCard() {
  const el = h('div', { class: 'db-music', hidden: true });
  const draw = () => {
    const m = activeMedia();
    el.hidden = !m;
    if (!m) return el.replaceChildren();
    const { src, st } = m;
    const ctl = (name, label, fn) => h('button', { class: 'db-mbtn', 'aria-label': label, html: icon(name, name === 'play' || name === 'pause' ? 26 : 22), onClick: (e) => { e.stopPropagation(); fn?.(); setTimeout(draw, 120); } });
    el.classList.toggle('playing', !!st.playing);
    el.replaceChildren(
      h('span', { class: 'db-music-art', style: st.art ? { backgroundImage: `url("${st.art}")` } : { background: st.color || 'var(--accent)' }, html: st.art ? '' : icon(st.icon || 'music', 22) }),
      h('span', { class: 'db-music-text' }, h('b', null, st.title || ''), h('span', null, st.sub || '')),
      // transport controls keep their left-to-right order in Arabic too, as in One UI
      h('span', { class: 'db-mctl' },
        ctl('prev', t('db.prev'), () => src.prev?.()),
        ctl(st.playing ? 'pause' : 'play', st.playing ? t('db.pause') : t('db.play'), () => src.toggle?.()),
        ctl('next', t('db.next'), () => src.next?.())));
  };
  draw();
  return { el, draw };
}

// ——— open / close ———
export async function openBoard({ auto = false, page } = {}) {
  if (B) return;
  const p = prefs();
  const track = h('div', { class: 'db-track' });
  const dots = h('div', { class: 'db-dots', role: 'tablist', 'aria-label': t('db.title') });
  const hint = h('div', { class: 'db-hint' }, t('db.hint'));
  const closeBtn = h('button', { class: 'db-close', 'aria-label': t('db.exit'), title: t('db.exit'), html: icon('close', 22), onClick: (e) => { e.stopPropagation(); closeBoard(); } });
  const music = musicCard();
  const el = h('div', { class: 'db', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('db.title'), tabindex: '-1' }, track, music.el, dots, hint, closeBtn);
  B = { el, track, dots, p, idx: Math.max(0, PAGES.indexOf(page || p.page)), stops: [], pages: [], wake: null, fs: false, dragged: false, auto };
  B.pages = [photoPage(p), clockPage(p), calendarPage(), widgetsPage(p)];
  track.append(...B.pages.map((x) => x.el));
  dots.append(...PAGES.map((id, i) => h('button', { class: 'db-dot', role: 'tab', 'aria-label': t('db.page.' + id), onClick: (e) => { e.stopPropagation(); go(i); } })));
  document.body.appendChild(el);
  go(B.idx, true);

  const tick = (d) => {
    if (!B) return;
    B.pages.forEach((x) => x.tick?.(d));
    el.classList.toggle('night', isNight(B.p, d));
    // event titles follow the Lock screen's privacy too (see guarded())
    const g = guarded();
    if (d.getSeconds() === 0 || !B.minuted || g !== B.guarded) (B.guarded = g, minute(d));
  };
  const minute = (d) => {
    B.minuted = true;
    B.pages.forEach((x) => x.minute?.(d));
    // move the content a few pixels every minute so nothing burns in on an OLED screen
    el.style.setProperty('--sx', `${Math.round((Math.random() - 0.5) * 16)}px`);
    el.style.setProperty('--sy', `${Math.round((Math.random() - 0.5) * 12)}px`);
  };
  B.stops.push(everySecond(tick));
  B.stops.push(onMediaChange(music.draw));
  const mediaPoll = setInterval(music.draw, 5000);
  B.stops.push(() => clearInterval(mediaPoll));
  B.stops.push(store.on('weather', () => B && minute(new Date())));
  B.stops.push(store.on('events', () => B && minute(new Date())));
  getWeather().catch(() => {});

  bindInput(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.focus({ preventScroll: true });
  setTimeout(() => hint.classList.add('gone'), 4500);
  showUi();

  // the full screen needs the click that opened the board; an automatic start just covers the window
  if (!auto && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().then(() => B && (B.fs = true)).catch(() => {});
  }
  keepAwake();
}

export function closeBoard() {
  if (!B) return;
  const b = B;
  B = null;
  b.stops.forEach((f) => f());
  b.pages.forEach((x) => x.cleanup?.());
  b.wake?.release?.().catch?.(() => {});
  removeEventListener('keydown', onKey, true);
  // Esc in full screen first leaves full screen (closing the board through fullscreenchange), then may still reach
  // the page: for a moment it mustn't close whatever was underneath too
  const swallow = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), e.preventDefault());
  addEventListener('keydown', swallow, true);
  setTimeout(() => removeEventListener('keydown', swallow, true), 600);
  if (b.fs && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  b.el.classList.add('closing');
  b.el.classList.remove('show');
  // the Home screen (paused under the board, see home.js) starts drawing again while the board fades out
  dispatchEvent(new Event('bt:homecover'));
  setTimeout(() => b.el.remove(), setting('reduceMotion') ? 0 : 320);
}

export const boardState = () => (B ? { page: PAGES[B.idx], night: B.el.classList.contains('night'), awake: !!B.wake, auto: B.auto } : null);

function go(i, instant = false) {
  if (!B) return;
  const n = PAGES.length;
  B.idx = ((i % n) + n) % n;
  B.track.classList.toggle('instant', instant);
  layout(0);
  [...B.dots.children].forEach((d, k) => {
    d.classList.toggle('on', k === B.idx);
    d.setAttribute('aria-selected', String(k === B.idx));
  });
  B.el.dataset.page = PAGES[B.idx];
  if (prefs().page !== PAGES[B.idx]) savePrefs({ page: PAGES[B.idx] });
}

function layout(dx) {
  // in RTL the pages run right to left, so the track moves the other way
  const dir = isRtl() ? 1 : -1;
  B.track.style.transform = `translateX(calc(${dir * B.idx * 100}% + ${dx}px))`;
}

function showUi() {
  if (!B) return;
  B.el.classList.add('ui');
  clearTimeout(B.uiTimer);
  B.uiTimer = setTimeout(() => B?.el.classList.remove('ui'), 3000);
}

async function keepAwake() {
  if (!B || !B.p.awake || B.wake || !navigator.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!B) return lock.release?.();
    B.wake = lock;
    lock.addEventListener?.('release', () => {
      if (B?.wake === lock) B.wake = null;
    });
  } catch {}
}
// the browser drops the wake lock whenever the tab is hidden; take it again when it comes back
document.addEventListener('visibilitychange', () => !document.hidden && keepAwake());
// Esc in full screen leaves full screen without a keydown reaching the page: leave the board with it
document.addEventListener('fullscreenchange', () => {
  if (B?.fs && !document.fullscreenElement) closeBoard();
});

function onKey(e) {
  if (!B) return;
  // the board is on top of everything: the shell's own shortcuts must not act behind it
  e.stopImmediatePropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeBoard();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    go(B.idx + (e.key === 'ArrowRight' ? 1 : -1) * (isRtl() ? -1 : 1));
    showUi();
  } else if (e.key === ' ' && activeMedia()) {
    e.preventDefault();
    activeMedia().src.toggle?.();
  }
}

function bindInput(el) {
  addEventListener('keydown', onKey, true);
  let drag = null;
  // Caught on the way down and kept from the shell: a press on the board must not count as a click on the desktop
  // behind the app windows (core/apps.js gives the desktop the focus then), so the window is still focused after.
  const down = (e) => {
    if (!el.contains(e.target)) return;
    e.stopPropagation();
    if (e.button !== 0 || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, dx: 0, moved: false, id: e.pointerId };
  };
  addEventListener('pointerdown', down, true);
  B.stops.push(() => removeEventListener('pointerdown', down, true));
  el.addEventListener('pointermove', (e) => {
    showUi();
    if (!drag || !B) return;
    drag.dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(drag.dx) > 8) {
      drag.moved = true;
      el.setPointerCapture?.(drag.id);
      B.track.classList.add('dragging');
    }
    if (drag.moved) layout(drag.dx);
  });
  const end = (e) => {
    if (!drag || !B) return;
    const d = drag;
    drag = null;
    B.track.classList.remove('dragging');
    if (!d.moved) return;
    B.dragged = true;
    const far = Math.abs(d.dx) > Math.min(90, el.clientWidth * 0.15);
    go(B.idx + (far && e.type === 'pointerup' ? (d.dx < 0 ? 1 : -1) * (isRtl() ? -1 : 1) : 0));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // a click (not the end of a swipe, not a button) goes back to where you were
  el.addEventListener('click', (e) => {
    if (!B) return;
    if (B.dragged) return void (B.dragged = false);
    if (e.target.closest('button')) return;
    closeBoard();
  });
  let wheelLock = false;
  el.addEventListener('wheel', (e) => {
    if (wheelLock || !B || Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    wheelLock = true;
    setTimeout(() => (wheelLock = false), 700);
    go(B.idx + (e.deltaX > 0 ? 1 : -1) * (isRtl() ? -1 : 1));
  }, { passive: true });
}

// ——— Settings › Daily Board ———
function prefRow(title, options, key, extra = {}) {
  const label = () => options.find((o) => o.value === prefs()[key])?.label ?? '';
  const r = row({
    title,
    sub: label(),
    ...extra,
    onClick: async () => {
      const v = await choose(title, options, prefs()[key]);
      if (v === null || v === undefined) return;
      savePrefs({ [key]: v });
      r.querySelector('.ou-row-sub').textContent = label();
      extra.onPick?.(v);
    },
  });
  r.dataset.pref = key;
  return r;
}

const hourLabel = (hr) => fmtTime(new Date(2026, 0, 1, hr, 0));
/** Hour choices, keeping the current one even when it isn't among them. */
const hours = (list, key) => [...new Set([...list, prefs()[key]])].map((v) => ({ value: v, label: hourLabel(v) }));

export function settingsPage(body) {
  const stops = [];
  const preview = h('div', { class: 'dbs-prev', 'aria-hidden': 'true' });
  const drawPreview = async () => {
    const p = prefs();
    const now = new Date();
    const bg = h('div', { class: 'dbs-prev-bg' });
    const first = p.source === 'photos' && p.photos[0] ? await blobUrl('dailyboard:' + p.photos[0]).catch(() => null) : null;
    if (first) bg.style.backgroundImage = `url("${first}")`;
    else {
      const wp = setting('wallpaper');
      if (wp?.type === 'color') bg.style.background = wp.value;
      else {
        const c = h('canvas', { width: 160, height: 100 });
        paintPreset(c, presetById(wp?.type === 'preset' ? wp.id : 'bloom'), 4);
        bg.appendChild(c);
      }
    }
    const clock = p.clock === 'analog' ? analogClock('mini') : digitalClock(p, 'mini');
    clock.tick(now);
    preview.replaceChildren(bg, h('div', { class: 'dbs-prev-info' }, clock, h('span', null, fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' }))));
  };
  drawPreview();
  stops.push(store.on('dailyBoard', drawPreview));

  // photos
  const grid = h('div', { class: 'dbs-photos' });
  const drawPhotos = async () => {
    const ids = prefs().photos;
    const tiles = await Promise.all(ids.map(async (id) => {
      const u = await blobUrl('dailyboard:' + id).catch(() => null);
      return u && h('div', { class: 'dbs-photo', dataset: { id }, style: { backgroundImage: `url("${u}")` } },
        h('button', { class: 'dbs-photo-del', 'aria-label': t('db.removePhoto'), title: t('db.removePhoto'), html: icon('close', 16), onClick: () => removePhoto(id) }));
    }));
    grid.replaceChildren(...tiles.filter(Boolean), h('button', { class: 'dbs-photo-add', onClick: addPhotos }, h('span', { html: icon('plus', 26) }), h('span', null, t('db.addPhotos'))));
  };
  const source = seg([{ value: 'photos', label: t('db.src.photos') }, { value: 'wallpaper', label: t('db.src.wallpaper') }], prefs().source, (v) => savePrefs({ source: v }));
  source.classList.add('dbs-source');
  async function addPhotos() {
    const files = (await pickFile('image/*', true)) || [];
    const ids = [];
    for (const f of files) {
      try {
        const id = uid();
        await putBlob('dailyboard:' + id, await dataUrlToBlob(await readImage(f, 2560, 0.88)));
        ids.push(id);
      } catch (e) {
        console.warn('daily board photo', e);
      }
    }
    if (!ids.length) return;
    savePrefs({ photos: [...prefs().photos, ...ids], source: 'photos' });
    source.set('photos');
    drawPhotos();
    toast(t('db.added', { n: ids.length }));
  }
  async function removePhoto(id) {
    await delBlob('dailyboard:' + id).catch(() => {});
    savePrefs({ photos: prefs().photos.filter((x) => x !== id) });
    drawPhotos();
  }
  drawPhotos();

  // clock
  const fonts = h('div', { class: 'ou-chips dbs-fonts' });
  const drawFonts = () => {
    const p = prefs();
    fonts.hidden = p.clock === 'analog';
    fonts.replaceChildren(...Object.keys(CLOCK_FONTS).map((f) =>
      h('button', { class: ['ou-chip', p.font === f && 'active'], dataset: { font: f }, style: { fontFamily: CLOCK_FONTS[f] }, onClick: () => { savePrefs({ font: f }); drawFonts(); } }, t('db.font.' + f))));
  };
  const clockSeg = seg([{ value: 'digital', label: t('db.digital') }, { value: 'analog', label: t('db.analog') }], prefs().clock, (v) => { savePrefs({ clock: v }); drawFonts(); });
  drawFonts();

  // widgets
  const widgetOpts = getWidgets().map((w) => ({ value: w.id, label: tr(w.name), sub: w.app && getApp(w.app) ? appName(w.app) : '' })).sort((a, b) => a.label.localeCompare(b.label, locale()));
  const widgetRow = (i) => {
    const label = () => widgetOpts.find((o) => o.value === prefs().widgets[i])?.label ?? t('common.none');
    const r = row({
      title: t('db.widgetN', { n: i + 1 }),
      sub: label(),
      onClick: async () => {
        const v = await choose(t('db.widgetN', { n: i + 1 }), widgetOpts, prefs().widgets[i]);
        if (!v) return;
        const ws = [...prefs().widgets];
        ws[i] = v;
        savePrefs({ widgets: ws });
        r.querySelector('.ou-row-sub').textContent = label();
      },
    });
    r.dataset.widgetSlot = i;
    return r;
  };

  const nightSub = () => t('db.nightSub', { from: hourLabel(prefs().nightFrom), to: hourLabel(prefs().nightTo) });
  const nightRow = switchRow({ title: t('db.night'), sub: nightSub(), checked: prefs().night, onChange: (v) => savePrefs({ night: v }) });
  nightRow.dataset.pref = 'night';
  const refreshNight = () => (nightRow.querySelector('.ou-row-sub').textContent = nightSub());
  const awakeRow = switchRow({ title: t('db.awake'), sub: t('db.awakeSub'), checked: prefs().awake, onChange: (v) => savePrefs({ awake: v }) });
  awakeRow.dataset.pref = 'awake';

  const minutes = (n) => (n ? t('db.afterMin', { n }) : t('db.never'));
  body.append(
    h('div', { class: 'ou-card dbs-hero' }, preview, h('p', { class: 'dbs-desc' }, t('db.desc')), btn(t('db.startNow'), () => openBoard(), 'primary dbs-start')),
    list(prefRow(t('db.auto'), [0, 1, 5, 10, 30].map((n) => ({ value: n, label: minutes(n) })), 'idleMin')),
    subheader(t('db.photoFrame')),
    h('div', { class: 'ou-card dbs-card' }, source, grid),
    list(prefRow(t('db.interval'), [[5, 'db.sec'], [15, 'db.sec'], [30, 'db.sec'], [60, 'db.min1'], [300, 'db.min']].map(([v, k]) => ({ value: v, label: t(k, { n: v >= 60 ? v / 60 : v }) })), 'interval')),
    subheader(t('db.clockStyle')),
    h('div', { class: 'ou-card dbs-card' }, clockSeg, fonts),
    subheader(t('db.widgets')),
    list(widgetRow(0), widgetRow(1)),
    subheader(t('db.display')),
    list(nightRow,
      prefRow(t('db.nightFrom'), hours([19, 20, 21, 22, 23, 0], 'nightFrom'), 'nightFrom', { onPick: refreshNight }),
      prefRow(t('db.nightTo'), hours([5, 6, 7, 8, 9], 'nightTo'), 'nightTo', { onPick: refreshNight }),
      awakeRow));
  return () => stops.forEach((f) => f());
}

addStrings({
  en: {
    'db.hint': 'Swipe or press ← → for more · Click to exit',
    'db.exit': 'Exit Daily Board',
    'db.page.photo': 'Photo frame',
    'db.page.clock': 'Clock',
    'db.page.calendar': 'Calendar',
    'db.page.widgets': 'Widgets',
    'db.allDay': 'All day',
    'db.noEvents': 'No upcoming events',
    'db.event': 'Event',
    'db.unlockToSee': 'Unlock to see this widget',
    'db.prev': 'Previous',
    'db.next': 'Next',
    'db.play': 'Play',
    'db.pause': 'Pause',
    'db.desc': 'Turn this screen into a photo frame with a clock, your calendar and widgets while you’re away.',
    'db.startNow': 'Start now',
    'db.auto': 'Start automatically',
    'db.never': 'Never',
    'db.afterMin': 'After {n} min on the Lock screen',
    'db.photoFrame': 'Photo frame',
    'db.src.photos': 'My photos',
    'db.src.wallpaper': 'Wallpaper',
    'db.addPhotos': 'Add photos',
    'db.removePhoto': 'Remove photo',
    'db.added': '{n} added',
    'db.interval': 'Change photos every',
    'db.sec': '{n} seconds',
    'db.min1': '1 minute',
    'db.min': '{n} minutes',
    'db.clockStyle': 'Clock',
    'db.digital': 'Digital',
    'db.analog': 'Analog',
    'db.font.outfit': 'Outfit',
    'db.font.inter': 'Inter',
    'db.font.serif': 'Serif',
    'db.font.mono': 'Mono',
    'db.widgets': 'Widgets',
    'db.widgetN': 'Widget {n}',
    'db.display': 'Screen',
    'db.night': 'Night mode',
    'db.nightSub': 'Dim red light from {from} to {to}',
    'db.nightFrom': 'Starts at',
    'db.nightTo': 'Ends at',
    'db.awake': 'Keep screen on',
    'db.awakeSub': 'The display won’t turn off while Daily Board is showing',
  },
  ar: {
    'db.hint': 'اسحب أو اضغط ← → للمزيد · انقر للخروج',
    'db.exit': 'الخروج من اللوحة اليومية',
    'db.page.photo': 'إطار الصور',
    'db.page.clock': 'الساعة',
    'db.page.calendar': 'التقويم',
    'db.page.widgets': 'الأدوات',
    'db.allDay': 'طوال اليوم',
    'db.noEvents': 'لا توجد أحداث قادمة',
    'db.event': 'حدث',
    'db.unlockToSee': 'افتح القفل لعرض هذه الأداة',
    'db.prev': 'السابق',
    'db.next': 'التالي',
    'db.play': 'تشغيل',
    'db.pause': 'إيقاف مؤقت',
    'db.desc': 'حوّل هذه الشاشة إلى إطار صور مع ساعة وتقويمك وأدواتك أثناء غيابك.',
    'db.startNow': 'البدء الآن',
    'db.auto': 'البدء تلقائيًا',
    'db.never': 'أبدًا',
    'db.afterMin': 'بعد {n} دقيقة على شاشة القفل',
    'db.photoFrame': 'إطار الصور',
    'db.src.photos': 'صوري',
    'db.src.wallpaper': 'الخلفية',
    'db.addPhotos': 'إضافة صور',
    'db.removePhoto': 'إزالة الصورة',
    'db.added': 'تمت إضافة {n}',
    'db.interval': 'تغيير الصور كل',
    'db.sec': '{n} ثانية',
    'db.min1': 'دقيقة واحدة',
    'db.min': '{n} دقائق',
    'db.clockStyle': 'الساعة',
    'db.digital': 'رقمية',
    'db.analog': 'بعقارب',
    'db.font.outfit': 'Outfit',
    'db.font.inter': 'Inter',
    'db.font.serif': 'Serif',
    'db.font.mono': 'Mono',
    'db.widgets': 'الأدوات',
    'db.widgetN': 'الأداة {n}',
    'db.display': 'الشاشة',
    'db.night': 'الوضع الليلي',
    'db.nightSub': 'ضوء أحمر خافت من {from} إلى {to}',
    'db.nightFrom': 'يبدأ في',
    'db.nightTo': 'ينتهي في',
    'db.awake': 'إبقاء الشاشة قيد التشغيل',
    'db.awakeSub': 'لن تنطفئ الشاشة أثناء عرض اللوحة اليومية',
  },
});
