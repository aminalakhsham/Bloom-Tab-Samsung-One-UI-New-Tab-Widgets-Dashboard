// Samsung Weather: registration, icons, the Weather widget (s/m/l), the Weather forecast widget (m/l), the Finder
// "weather" answer and place search. Light on purpose (it loads with every new tab); the app itself is
// js/weather/ui.js, loaded when it opens. Data and units: js/services/weather.js.
import { h } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { addStrings, t, use12h, isRtl } from '../core/i18n.js';
import { store, onSetting } from '../core/store.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand } from '../core/hooks.js';
import { choose } from '../core/ui.js';
import {
  HERE, places, peekPlace, getPlaceWeather, placeName, weatherInfo, fmtTemp, skyGradient, tempValue, tzFmt,
} from '../services/weather.js';
import { nextHours, todayIdx, skyPhase, tempColor, upgrade } from '../weather/model.js';

addIcons({
  umbrella: '<path d="M3.5 11.5a8.5 8.5 0 0 1 17 0Z"/><path d="M12 11.5v6.5a2 2 0 0 1-4 0M12 3v.5"/>',
  sunrise: '<path d="M5.5 17a6.5 6.5 0 0 1 13 0"/><path d="M2.5 20.5h19M12 3.5V9M9.5 6 12 3.5 14.5 6M4.2 11.2l1.4 1.4M19.8 11.2l-1.4 1.4"/>',
  sunset: '<path d="M5.5 17a6.5 6.5 0 0 1 13 0"/><path d="M2.5 20.5h19M12 3.5V9M9.5 6.5 12 9l2.5-2.5M4.2 11.2l1.4 1.4M19.8 11.2l-1.4 1.4"/>',
  gauge: '<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13.2" r="1.3"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14.5-14 .3 9.3-5.2 14.5-13 14.5Z"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  dewdrop: '<path d="M9 14.5V5.5a2 2 0 0 1 4 0v9a3.5 3.5 0 1 1-4 0Z"/><path d="M18 8.5s2 2.2 2 3.6a2 2 0 0 1-4 0c0-1.4 2-3.6 2-3.6Z"/>',
  'wx-grip': '<path d="M5 9.5h14M5 14.5h14"/>',
});

const H = 36e5;
const render = (ctx) => import('../weather/ui.js').then((m) => m.render(ctx));

registerApp({
  id: 'weather',
  name: 'app.weather',
  keywords: ['forecast', 'temperature', 'rain', 'air quality', 'طقس', 'حرارة', 'مطر', 'توقعات'],
  icon: {
    bg: 'linear-gradient(160deg, #47b0ff 0%, #1f7cf2 100%)',
    html: () => {
      const id = 'wxi' + Math.random().toString(36).slice(2, 7);
      return `<svg viewBox="0 0 64 64" width="78%" height="78%"><defs><radialGradient id="${id}s" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff3a6"/><stop offset="1" stop-color="#ffc21a"/></radialGradient><linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d9e8fb"/></linearGradient></defs><circle cx="38" cy="24" r="11" fill="url(#${id}s)"/><path d="M17 49h26a9 9 0 0 0 1.2-17.9A12.5 12.5 0 0 0 20 29a10 10 0 0 0-3 20Z" fill="url(#${id}c)"/></svg>`;
    },
  },
  size: 'phone',
  render,
  search(q) {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const list = places();
    return list.filter((p) => placeName(p, peekPlace(p, list)).toLowerCase().includes(s)).slice(0, 5).map((p) => {
      const d = peekPlace(p, list);
      return {
        title: placeName(p, d),
        sub: d ? `${fmtTemp(d.current.temp)} · ${weatherInfo(d.current.code, d.current.isDay).label}` : t('app.weather'),
        onOpen: () => openApp('weather', { params: { section: p.id } }),
      };
    });
  },
});

// ——— widgets ———
/** The place a widget shows: its chosen one (config.place), else the main location. */
const placeFor = (config) => {
  const list = places();
  return list.find((p) => p.id === config?.place) || list[0];
};
const hourText = (d, ms) => {
  const F = tzFmt(d);
  return use12h() ? F.hour(ms).replace(/[\s ]+/g, ' ') : F.time(ms);
};

/** Shared by both widgets: keeps a place's forecast fresh while the widget is on screen. */
function liveWidget(el, config, preview, paint) {
  const state = { p: placeFor(config), d: null, err: null };
  state.d = peekPlace(state.p);
  const run = () => paint(state);
  const refresh = async () => {
    state.p = placeFor(config);
    const r = await getPlaceWeather(state.p);
    if (r?.error) state.err = r;
    else {
      state.d = upgrade(r);
      state.err = null;
    }
    run();
  };
  run();
  if (!preview) refresh();
  const timer = preview ? null : setInterval(refresh, 15 * 60e3);
  const sync = () => {
    state.p = placeFor(config);
    const d = peekPlace(state.p);
    if (d) state.d = d;
    run();
  };
  const offs = [store.on('weather', sync), store.on('weatherMore', sync), store.on('weatherPlaces', sync), onSetting('location', sync), onSetting('tempUnit', run)];
  return () => {
    clearInterval(timer);
    offs.forEach((f) => f());
  };
}

const openFor = (item) => openApp('weather', { params: { section: placeFor(item?.config).id } });
/** Widget settings: which location (only asked when there is more than one). */
async function configure(config, { isNew } = {}) {
  const list = places();
  if (isNew && list.length < 2) return { ...config };
  const v = await choose(t('wx.w.pick'), [{ value: '', label: t('wx.w.main'), sub: placeName(list[0], peekPlace(list[0], list)) },
    ...list.slice(1).map((p) => ({ value: p.id, label: placeName(p, peekPlace(p, list)), sub: [p.region, p.country].filter(Boolean).join(', ') }))], config?.place || '');
  return v == null ? null : { ...config, place: v || undefined };
}

function emptyBox(el, st) {
  el.style.setProperty('--wx-sky', skyGradient(2, true));
  el.append(h('div', { class: 'wgw-empty' },
    h('div', { class: 'wgw-empty-i', html: weatherInfo(2, true).icon }),
    h('div', null, st.err?.error === 'location' ? t('wx.tapToSet') : st.err?.message || t('wx.loading'))));
}

registerWidget({
  id: 'weather',
  name: 'app.weather',
  sizes: ['s', 'm', 'l'],
  defaultSize: 'm',
  app: 'weather',
  onClick: (item) => openFor(item),
  configure,
  render(el, { size, config, preview }) {
    el.classList.add('wg-weather', 'wg-fill');
    return liveWidget(el, config, preview, ({ p, d, err }) => {
      el.replaceChildren();
      if (!d) return emptyBox(el, { err });
      const c = d.current, info = weatherInfo(c.code, c.isDay), today = d.daily[todayIdx(d)] || {};
      el.style.setProperty('--wx-sky', skyGradient(c.code, c.isDay, skyPhase(d)));
      el.append(h('div', { class: 'wgw-top' },
        h('div', { class: 'wgw-main' },
          h('div', { class: 'wgw-city' }, p.id === HERE ? h('span', { html: icon('navigation', 11) }) : null, placeName(p, d)),
          h('div', { class: 'wgw-temp' }, fmtTemp(c.temp))),
        h('div', { class: 'wgw-side' },
          h('div', { class: 'wgw-icon', html: info.icon }),
          h('div', { class: 'wgw-cond' }, info.label),
          h('div', { class: 'wgw-hl' }, `${fmtTemp(today.max ?? c.high)} / ${fmtTemp(today.min ?? c.low)}`))));
      if (size !== 's') {
        const S = d.series;
        el.append(h('div', { class: 'wgw-hours' }, nextHours(d, 7).slice(1).map((k) => h('div', { class: 'wgw-hour' },
          h('span', { class: 'wgw-hour-t' }, hourText(d, S.t[k])),
          h('span', { class: 'wgw-hour-i', html: weatherInfo(S.code[k], !!S.day[k]).icon }),
          h('span', { class: 'wgw-hour-v' }, fmtTemp(S.temp[k]))))));
      }
      if (size === 'l') {
        const ti = todayIdx(d), F = tzFmt(d);
        el.append(h('div', { class: 'wgw-days' }, d.daily.slice(ti + 1, ti + 6).map((x) => h('div', { class: 'wgw-day' },
          h('span', { class: 'wgw-day-n' }, F.wdLong(x.date + 12 * H)),
          h('span', { class: 'wgw-day-i', html: weatherInfo(x.code, true).icon }),
          h('span', { class: 'wgw-day-pop' }, x.pop >= 20 ? `⁦${x.pop}%⁩` : ''),
          h('span', { class: 'wgw-day-v' }, h('b', null, fmtTemp(x.max)), ' ', fmtTemp(x.min))))));
      }
    });
  },
});

// Samsung's "Forecast" widget: the next hours on a temperature line and the coming days with range bars.
registerWidget({
  id: 'weather-forecast',
  name: 'wx.w.forecast',
  sizes: ['m', 'l'],
  defaultSize: 'l',
  app: 'weather',
  onClick: (item) => openFor(item),
  configure,
  render(el, { size, config, preview }) {
    el.classList.add('wg-weather', 'wg-wfc', 'wg-fill');
    return liveWidget(el, config, preview, ({ p, d, err }) => {
      el.replaceChildren();
      if (!d) return emptyBox(el, { err });
      const c = d.current, info = weatherInfo(c.code, c.isDay), ti = todayIdx(d), today = d.daily[ti] || {}, F = tzFmt(d), S = d.series;
      el.style.setProperty('--wx-sky', skyGradient(c.code, c.isDay, skyPhase(d)));
      el.append(h('div', { class: 'wfc-top' },
        h('div', { class: 'wfc-now' },
          h('div', { class: 'wgw-city' }, p.id === HERE ? h('span', { html: icon('navigation', 11) }) : null, placeName(p, d)),
          h('div', { class: 'wfc-temp' }, fmtTemp(c.temp)),
          h('div', { class: 'wfc-cond' }, `${info.label} · ${fmtTemp(today.max ?? c.high)} / ${fmtTemp(today.min ?? c.low)}`)),
        h('div', { class: 'wfc-icon', html: info.icon })));
      if (size === 'm') {
        el.append(h('div', { class: 'wfc-cols' }, d.daily.slice(ti, ti + 5).map((x, k) => h('div', { class: 'wfc-col' },
          h('span', { class: 'wfc-col-n' }, k === 0 ? t('common.today') : F.wd(x.date + 12 * H)),
          h('span', { class: 'wfc-col-i', html: weatherInfo(x.code, true).icon }),
          h('span', { class: 'wfc-col-v' }, h('b', null, fmtTemp(x.max)), h('span', null, fmtTemp(x.min)))))));
        return;
      }
      // the next six hours on a line
      const idx = nextHours(d, 7);
      const temps = idx.map((k) => tempValue(S.temp[k]) ?? 0), lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(1, hi - lo);
      const n = idx.length, X = (i) => ((i + 0.5) / n) * 100, Y = (v) => 8 + (1 - (v - lo) / span) * 22;
      const pts = temps.map((v, i) => `${(isRtl() ? 100 - X(i) : X(i)).toFixed(2)},${Y(v).toFixed(1)}`).join(' ');
      el.append(h('div', { class: 'wfc-hours' },
        h('div', { class: 'wfc-graph', html: `<svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>` }),
        idx.map((k, i) => h('div', { class: 'wfc-hour' },
          h('span', { class: 'wfc-hour-g' }, h('span', { class: 'wfc-hour-v', style: { top: `${(Y(temps[i]) - 8).toFixed(1)}px` } }, fmtTemp(i === 0 ? c.temp : S.temp[k]))),
          h('span', { class: 'wfc-hour-i', html: weatherInfo(i === 0 ? c.code : S.code[k], i === 0 ? c.isDay : !!S.day[k]).icon }),
          h('span', { class: 'wfc-hour-t' }, i === 0 ? t('wx.w.now') : hourText(d, S.t[k]))))));
      const days = d.daily.slice(ti, ti + 5);
      const dlo = Math.min(...days.map((x) => x.min ?? 99)), dhi = Math.max(...days.map((x) => x.max ?? -99)), dspan = Math.max(1, dhi - dlo);
      const dir = isRtl() ? 'to left' : 'to right';
      el.append(h('div', { class: 'wfc-days' }, days.map((x, k) => h('div', { class: 'wfc-day' },
        h('span', { class: 'wfc-day-n' }, k === 0 ? t('common.today') : F.wd(x.date + 12 * H)),
        h('span', { class: 'wfc-day-i', html: weatherInfo(x.code, true).icon }),
        h('span', { class: 'wfc-day-lo' }, fmtTemp(x.min)),
        h('span', { class: 'wfc-bar' }, h('i', { style: {
          insetInlineStart: `${(((x.min - dlo) / dspan) * 100).toFixed(1)}%`, insetInlineEnd: `${(((dhi - x.max) / dspan) * 100).toFixed(1)}%`,
          background: `linear-gradient(${dir}, ${tempColor(x.min)}, ${tempColor(x.max)})`,
        } })),
        h('span', { class: 'wfc-day-hi' }, fmtTemp(x.max))))));
    });
  },
});

// ——— Finder: "weather", "weather Paris", "طقس" ———
registerCommand('weather', (q) => {
  const m = q.trim().match(/^(?:weather|forecast|الطقس|طقس)(?:\s+(?:in\s+|في\s+)?(.+))?$/i);
  if (!m) return [];
  const list = places(), want = m[1]?.trim().toLowerCase();
  const p = want ? list.find((x) => placeName(x, peekPlace(x, list)).toLowerCase().startsWith(want)) : list[0];
  if (!p) return [];
  const d = peekPlace(p, list);
  const open = () => openApp('weather', { params: { section: p.id } });
  if (!d) return [{ icon: 'cloud', title: t('app.weather'), sub: t('wx.cmd.open'), run: open }];
  const today = d.daily[todayIdx(d)] || {};
  return [{
    icon: 'cloud',
    title: `${fmtTemp(d.current.temp)} ${weatherInfo(d.current.code, d.current.isDay).label} · ${placeName(p, d)}`,
    sub: `${fmtTemp(today.max)} / ${fmtTemp(today.min)} · ${t('wx.cmd.open')}`,
    run: open,
  }];
});

addStrings({
  en: {
    'app.weather': 'Weather',
    'wx.loading': 'Loading weather…',
    'wx.tapToSet': 'Tap to set your location',
    'wx.w.forecast': 'Weather forecast',
    'wx.w.pick': 'Location',
    'wx.w.main': 'Main location',
    'wx.w.now': 'Now',
    'wx.cmd.open': 'Open Weather',
  },
  ar: {
    'app.weather': 'الطقس',
    'wx.loading': 'جارٍ تحميل الطقس…',
    'wx.tapToSet': 'انقر لتحديد موقعك',
    'wx.w.forecast': 'توقعات الطقس',
    'wx.w.pick': 'الموقع',
    'wx.w.main': 'الموقع الرئيسي',
    'wx.w.now': 'الآن',
    'wx.cmd.open': 'فتح الطقس',
  },
});
