// Clock › World clock, the One UI way: a day/night world map (the night side shaded live, the sun, a dot for each
// city with its name and time, your own place), the city cards (name, "Today, 7 hours ahead", the time), selection
// mode with drag handles to reorder (⋮ › Edit), Add city (search every time zone city and popular cities by name or
// country, in English or Arabic) and the Time zone converter.
import { h, uid, everyMinute, onLongPress, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtHM, fmtPeriod, fmtTime, fmtDate, lang } from '../core/i18n.js';
import { store } from '../core/store.js';
import { iconBtn, menu, toast, slider } from '../core/ui.js';
import * as D from './data.js';
import { MAP, LAND, ZONES } from './geo.js';
import { EXTRA, AR } from './cities.js';
import { LOCAL_TZ, wallTime, offsetText, cityName, cityOf, isNight, diffMin, diffText } from './zones.js';
import { selBar } from './kit.js';

// the map leaves out the far north and south, so it and the list fit in the window
const VIEW = { y: 6, h: 128 };
const coordsOf = (c) => (c.lat != null && c.lon != null ? [c.lat, c.lon] : ZONES[c.tz] ? ZONES[c.tz].slice(0, 2) : null);
const pinPos = (c) => {
  const p = coordsOf(c);
  return p ? [((p[1] + 180) / 360) * 100, clamp((MAP.top - p[0] - VIEW.y) / VIEW.h, 0.03, 0.97) * 100] : null;
};
const setClocks = (list) => store.set('clocks', list);

/** Where the sun is overhead: [lat, lon]. */
function subsolar(now = new Date()) {
  const day = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5;
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  return [dec, -15 * (utcH - 12)];
}
/** The night side of the Earth (the sun below the horizon) in map coordinates. */
function nightPath(now = new Date()) {
  let [dec, sunLon] = subsolar(now);
  if (Math.abs(dec) < 0.2) dec = dec < 0 ? -0.2 : 0.2;
  const R = Math.PI / 180, td = Math.tan(dec * R);
  const pts = [];
  for (let lon = -180; lon <= 180; lon += 3) {
    const lat = Math.atan(-Math.cos((lon - sunLon) * R) / td) / R;
    pts.push(`${(lon + 180).toFixed(1)} ${clamp(MAP.top - lat, -2, MAP.h + 2).toFixed(1)}`);
  }
  const edge = dec > 0 ? MAP.h + 4 : -4; // the pole in darkness
  return `M-2 ${edge}L-2 ${pts[0].split(' ')[1]}L${pts.join('L')}L362 ${pts.at(-1).split(' ')[1]}L362 ${edge}Z`;
}

function timeEl(d, cls) {
  const p = fmtPeriod(d);
  return h('span', { class: cls }, h('span', { dir: 'ltr' }, fmtHM(d)), p ? h('small', null, p) : null);
}

export function worldView(ctx, tabs, { settings }) {
  let sel = null; // ids in selection mode
  let focus = null; // the city whose pin is highlighted
  const page = ctx.page({ title: t('clock.tab.world'), hero: false, className: 'clk-page clk-world-page' });
  page.el.appendChild(tabs);
  page.body.classList.add('clk-body');
  const night = h('div');
  const map = h('div', { class: 'clk-map', role: 'img', 'aria-label': t('clock.mapLabel') });
  const listEl = h('div', { class: 'clk-cities' });
  page.body.append(map, listEl);
  let bar = null;

  const leave = () => { sel = null; draw(); };
  // Esc leaves selection mode first (the window's own handler would close the app), unless a popup is open on top
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !sel || !ctx.focused || e.defaultPrevented || document.querySelector('.ou-menu-scrim:not(.closing), .ou-dialog-scrim, .clk-ringing')) return;
    e.preventDefault();
    leave();
  };
  addEventListener('keydown', onEsc, true);

  function actions() {
    if (sel) {
      const all = D.clocks(), every = all.length && all.every((c) => sel.has(c.id));
      return [
        h('button', { class: ['clk-allbtn', every && 'on'], 'aria-pressed': String(!!every), onClick: () => { sel = every ? new Set() : new Set(all.map((c) => c.id)); draw(); } },
          h('span', { class: 'clk-check', html: icon('check', 14) }), t('clock.all')),
        iconBtn('close', leave, t('common.cancel')),
      ];
    }
    return [
      iconBtn('plus', () => addCity(ctx), t('clock.addCity')),
      iconBtn('more', (e) => menu(e.currentTarget, [
        { label: t('common.edit'), icon: 'edit', disabled: !D.clocks().length, onClick: () => { sel = new Set(); draw(); } },
        { label: t('clock.converter'), icon: 'globe', onClick: () => converter(ctx) },
        { label: t('common.settings'), icon: 'settings', onClick: settings },
      ], { align: 'end' }), t('common.more')),
    ];
  }

  function drawMap() {
    const now = new Date(), list = D.clocks();
    const [slat, slon] = subsolar(now);
    const sun = [((slon + 540) % 360) / 360 * 100, clamp((MAP.top - slat - VIEW.y) / VIEW.h, 0.03, 0.97) * 100];
    const local = { tz: LOCAL_TZ, city: cityOf(LOCAL_TZ), local: true };
    night.innerHTML = `<svg viewBox="0 ${VIEW.y} ${MAP.w} ${VIEW.h}" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="clk-twilight" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter></defs><path class="clk-land" d="${LAND}"/><path class="clk-night" filter="url(#clk-twilight)" d="${nightPath(now)}"/></svg>`;
    const pins = [...list, ...(list.some((c) => c.tz === LOCAL_TZ) ? [] : [local])].map((c) => {
      const p = pinPos(c);
      if (!p) return null;
      const wall = wallTime(c.tz, now);
      return h('div', { class: ['clk-mpin', c.local && 'local', focus && c.id === focus && 'focus', isNight(wall) && 'night'], style: { '--x': p[0] + '%', '--y': p[1] + '%' }, dataset: { id: c.id || '' } },
        h('i'), h('span', null, h('b', null, c.local ? t('clock.local') : cityName(c)), h('small', { dir: 'ltr' }, fmtTime(wall))));
    }).filter(Boolean);
    map.replaceChildren(night.firstChild, h('i', { class: 'clk-sun', style: { '--x': sun[0] + '%', '--y': sun[1] + '%' } }), ...pins);
    requestAnimationFrame(placePins);
  }
  // label collisions on the map: try the other side, then above and below
  function placePins() {
    const W = map.clientWidth, H = map.clientHeight, placed = [];
    if (!W) return;
    const pins = [...map.querySelectorAll('.clk-mpin')].sort((a, b) => parseFloat(a.style.getPropertyValue('--x')) - parseFloat(b.style.getPropertyValue('--x')));
    for (const pin of pins) {
      const x = (parseFloat(pin.style.getPropertyValue('--x')) / 100) * W, y = (parseFloat(pin.style.getPropertyValue('--y')) / 100) * H;
      const lab = pin.querySelector('span'), w = lab.offsetWidth + 8, hh = lab.offsetHeight + 4;
      const opts = [[1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 2], [-1, 2]];
      let best = x > W / 2 ? opts[1] : opts[0];
      for (const o of opts) {
        const left = o[0] > 0 ? x + 6 : x - 6 - w, top = y - hh / 2 + o[1] * (hh + 2);
        if (left < 2 || left + w > W - 2 || top < 2 || top + hh > H - 2) continue;
        const r = { left, top, right: left + w, bottom: top + hh };
        if (!placed.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top)) {
          best = o;
          placed.push(r);
          break;
        }
      }
      pin.dataset.side = best[0] > 0 ? 'e' : 'w';
      pin.style.setProperty('--dy', best[1]);
    }
    map.classList.add('ready');
  }

  function card(c, i, all) {
    const now = new Date(), wall = wallTime(c.tz, now);
    const checked = sel?.has(c.id);
    const el = h('div', {
      class: ['clk-city', sel && 'selecting', checked && 'checked', focus === c.id && 'focus'], role: sel ? 'checkbox' : 'button', tabindex: 0,
      'aria-checked': sel ? String(!!checked) : null, dataset: { id: c.id },
      onClick: () => {
        if (sel) {
          if (sel.has(c.id)) sel.delete(c.id);
          else sel.add(c.id);
        } else focus = focus === c.id ? null : c.id;
        draw();
      },
    },
      sel ? h('span', { class: 'clk-check', html: icon('check', 14) }) : null,
      h('div', { class: 'clk-city-text' }, h('div', { class: 'clk-city-name' }, cityName(c)), h('div', { class: 'clk-city-sub' }, offsetText(c.tz, now))),
      timeEl(wall, 'clk-city-time'),
      sel ? h('span', { class: 'clk-grip', title: t('clock.dragToMove'), 'aria-hidden': 'true', html: icon('clkGrip', 20) }) : null);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (sel) return;
      const move = (to) => {
        const l = [...all];
        const [x] = l.splice(i, 1);
        l.splice(to, 0, x);
        setClocks(l);
      };
      menu(e, [
        { label: t('clock.moveUp'), icon: 'up', disabled: i === 0, onClick: () => move(i - 1) },
        { label: t('clock.moveDown'), icon: 'down', disabled: i === all.length - 1, onClick: () => move(i + 1) },
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => setClocks(all.filter((x) => x.id !== c.id)) },
      ]);
    });
    onLongPress(el, () => {
      if (sel) return;
      sel = new Set([c.id]);
      draw();
    });
    if (sel) dragToReorder(el, el.querySelector('.clk-grip'));
    return el;
  }

  // selection mode: drag a card by its handle to reorder the cities
  function dragToReorder(el, grip) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const cards = [...listEl.querySelectorAll('.clk-city')];
      const from = cards.indexOf(el), y0 = e.clientY;
      const mids = cards.map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
      let to = from;
      el.classList.add('dragging');
      const move = (ev) => {
        const dy = ev.clientY - y0;
        el.style.transform = `translateY(${dy}px)`;
        const y = mids[from] + dy;
        to = mids.filter((m, j) => j !== from && m < y).length;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        el.style.transform = '';
        if (to !== from) {
          const l = [...D.clocks()];
          const [x] = l.splice(from, 1);
          l.splice(to, 0, x);
          setClocks(l);
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('click', (e) => e.stopPropagation());
  }

  function draw() {
    const all = D.clocks();
    if (sel) for (const id of [...sel]) if (!all.some((c) => c.id === id)) sel.delete(id);
    if (sel && !all.length) sel = null;
    if (focus && !all.some((c) => c.id === focus)) focus = null;
    page.setTitle(sel ? (sel.size ? t('clock.nSelected', { n: sel.size }) : t('clock.selectCities')) : t('clock.tab.world'));
    page.setActions(actions());
    page.el.classList.toggle('clk-selecting', !!sel);
    bar?.remove();
    bar = null;
    if (sel) {
      bar = selBar([{ icon: 'trash', label: t('common.delete'), danger: true, disabled: !sel.size, onClick: () => { setClocks(D.clocks().filter((c) => !sel.has(c.id))); leave(); } }]);
      page.el.appendChild(bar);
    }
    drawMap();
    if (!all.length) {
      listEl.replaceChildren(h('button', { class: 'ou-card clk-city-add', onClick: () => addCity(ctx) },
        h('span', { class: 'ou-row-ico', html: icon('plus', 20) }),
        h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('clock.addCity')), h('span', { class: 'ou-row-sub' }, t('clock.addCitySub')))));
      return;
    }
    listEl.replaceChildren(...all.map((c, i) => card(c, i, all)));
  }
  draw();
  const ro = new ResizeObserver(() => placePins());
  ro.observe(map);
  const offs = [store.on('clocks', draw), everyMinute(() => !document.hidden && draw())];
  return () => {
    offs.forEach((f) => f());
    ro.disconnect();
    bar?.remove();
    removeEventListener('keydown', onEsc, true);
  };
}

// ——— Add city ———
let index = null;
/** Every time zone city and the popular cities: { name (English), tz, lat, lon, cc }. */
function cityIndex() {
  if (index) return index;
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = Object.keys(ZONES);
  }
  const out = new Map();
  for (const z of zones) {
    if (!z.includes('/') || z.startsWith('Etc/')) continue;
    const g = ZONES[z];
    out.set(cityOf(z) + '|' + z, { name: cityOf(z), tz: z, lat: g?.[0], lon: g?.[1], cc: g?.[2] || '' });
  }
  for (const [name, tz, lat, lon, cc] of EXTRA) out.set(name + '|' + tz, { name, tz, lat, lon, cc });
  return (index = [...out.values()]);
}
const fold = (s) => String(s || '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ًͯ-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

export function addCity(ctx) {
  let region = null, regionEn = null;
  try {
    region = new Intl.DisplayNames([lang()], { type: 'region' });
    regionEn = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {}
  const country = (cc, dn = region) => { try { return cc && dn ? dn.of(cc) : ''; } catch { return ''; } };
  const all = cityIndex().map((c) => {
    const shown = cityName(c.name), ctry = country(c.cc);
    return { ...c, shown, ctry, keys: [c.name, AR[c.name], ctry, country(c.cc, regionEn), c.tz.replace(/_/g, ' ')].filter(Boolean).map(fold) };
  }).sort((a, b) => a.shown.localeCompare(b.shown, lang()));
  ctx.push({
    title: t('clock.addCity'),
    hero: false,
    className: 'clk-add-city',
    render(body) {
      const input = h('input', { type: 'search', placeholder: t('clock.searchCity'), 'aria-label': t('clock.searchCity') });
      const listEl = h('div', { class: 'ou-card ou-list clk-city-results' });
      const row = (c, have, now) => h('button', { class: 'ou-row clickable', disabled: have, onClick: () => {
        // a popular city that isn't its zone's own city keeps its place on the map
        store.update('clocks', (l) => [...(l || []), { id: uid(), tz: c.tz, city: c.name, ...(c.name !== cityOf(c.tz) && c.lat != null ? { lat: c.lat, lon: c.lon } : {}) }]);
        toast(t('clock.cityAdded', { c: c.shown }));
        ctx.pop();
      } },
        h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, c.shown), h('span', { class: 'ou-row-sub' }, [c.ctry, offsetText(c.tz, now)].filter(Boolean).join(t('clock.listSep')))),
        h('span', { class: 'clk-city-time small' }, have ? h('span', { html: icon('check', 20) }) : h('span', { dir: 'ltr' }, fmtTime(wallTime(c.tz, now)))));
      const draw = () => {
        const q = fold(input.value.trim());
        const have = new Set(D.clocks().map((c) => c.tz + '|' + c.city));
        const now = new Date();
        let res;
        if (!q) res = all;
        else {
          const score = (c) => Math.max(...c.keys.map((k) => (k === q ? 100 : k.startsWith(q) ? 80 : k.split(/[\s,-]/).some((w) => w.startsWith(q)) ? 60 : k.includes(q) ? 30 : 0)));
          res = all.map((c) => [c, score(c)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
        }
        res = res.slice(0, q ? 60 : 400);
        if (!res.length) return listEl.replaceChildren(h('div', { class: 'ou-empty' }, t('clock.noCities')));
        const out = [];
        let last = '';
        for (const c of res) {
          const L = c.shown[0]?.toLocaleUpperCase(lang()) || '';
          if (!q && L !== last) {
            out.push(h('div', { class: 'clk-letter' }, L));
            last = L;
          }
          out.push(row(c, have.has(c.tz + '|' + c.name), now));
        }
        listEl.replaceChildren(...out);
      };
      input.addEventListener('input', draw);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && listEl.querySelector('.ou-row:not(:disabled)')?.click());
      draw();
      body.append(h('label', { class: 'ou-searchbox clk-search' }, h('span', { html: icon('search', 20) }), input), listEl);
      setTimeout(() => input.focus(), 350);
    },
  });
}

// ——— Time zone converter ———
function converter(ctx) {
  ctx.push({
    title: t('clock.converter'),
    hero: false,
    className: 'clk-converter',
    render(body) {
      const cities = [{ id: '_local', tz: LOCAL_TZ, city: cityOf(LOCAL_TZ) }, ...D.clocks().filter((c) => c.tz !== LOCAL_TZ)];
      let base = cities[0], shift = 0; // minutes from now, 15-minute steps
      const pick = h('button', { class: 'clk-conv-city', 'aria-haspopup': 'menu' });
      const big = h('div', { class: 'clk-conv-time' });
      const sub = h('div', { class: 'clk-conv-sub' });
      const listEl = h('div', { class: 'ou-card ou-list clk-conv-list' });
      const sl = slider({ min: -48, max: 48, step: 1, value: 0, label: t('clock.converter'), onInput: (v) => { shift = v * 15; draw(); } });
      sl.classList.add('clk-conv-slider');
      pick.addEventListener('click', () => menu(pick, cities.map((c) => ({ label: c.id === '_local' ? `${cityName(c)} (${t('clock.local')})` : cityName(c), checked: c === base, onClick: () => { base = c; draw(); } }))));
      const reset = h('button', { class: 'ou-btn tonal clk-conv-reset', onClick: () => { shift = 0; sl.set(0); draw(); } }, t('clock.now'));
      const draw = () => {
        const at = new Date(Date.now() + shift * 60e3);
        pick.replaceChildren(h('span', null, cityName(base)), h('span', { html: icon('down', 16) }));
        const bw = wallTime(base.tz, at);
        big.replaceChildren(timeEl(bw, 'clk-conv-hm'));
        sub.textContent = fmtDate(bw, { weekday: 'long', month: 'long', day: 'numeric' });
        reset.disabled = !shift;
        listEl.replaceChildren(...cities.filter((c) => c !== base).map((c) => {
          const w = wallTime(c.tz, at);
          const dd = Math.round((new Date(w.getFullYear(), w.getMonth(), w.getDate()) - new Date(bw.getFullYear(), bw.getMonth(), bw.getDate())) / 864e5);
          const day = dd > 0 ? t('common.tomorrow') : dd < 0 ? t('common.yesterday') : t('common.today');
          return h('div', { class: 'ou-row' },
            h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, c.id === '_local' ? `${cityName(c)} (${t('clock.local')})` : cityName(c)),
              h('span', { class: 'ou-row-sub' }, t('clock.dayOffset', { day, rel: diffText(diffMin(c.tz, at) - diffMin(base.tz, at)) }))),
            timeEl(w, 'clk-city-time'));
        }));
        if (cities.length < 2) listEl.replaceChildren(h('div', { class: 'ou-empty' }, t('clock.converterEmpty')));
      };
      draw();
      body.append(h('div', { class: 'ou-card clk-conv-card' }, pick, big, sub, sl, h('div', { class: 'clk-conv-hint' }, t('clock.converterHint')), reset), listEl);
    },
  });
}
