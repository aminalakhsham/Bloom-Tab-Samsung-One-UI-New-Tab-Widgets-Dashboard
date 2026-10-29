// A detail page per Weather card: a day picker (10 days), the value now (or for the day) that follows the pointer
// over an hourly chart, extra charts or scales, a daily summary and what the measurement means. Sunrise & sunset
// draws the sun's path over the day with first/last light; Moon phase shows the Moon, rise/set, the next full and
// new moons and a month of phases. All computed from the cached forecast (no extra request).
import { h, escapeHtml as esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import {
  weatherInfo, condLabel, fmtTemp, tempValue, windUnit, pressureUnit, precipUnit, distUnit, windParts, pressureParts, precipParts, distParts,
  fmtPrecip, unitLabel, placeName,
} from '../services/weather.js';
import { todayIdx, dayRange, uvLevel, aqiInfo, aqiLevelOf, pressureTrend, tempColor, convWind, convPressure, convPrecip, convDist, UNIT_DIGITS } from './model.js';
import { sunTimes, moonPhase } from './astro.js';
import { chartSVG, bindScrub } from './chart.js';
import { fmtFor, uvAdvice, compassName, humLevel, dewLevel, visLevel, sunPathSVG, moonFacts, UV_GRAD } from './cards.js';
import { skyEl, moonSVG } from './sky.js';

const H = 36e5;
const iso = (s) => `⁦${s}⁩`;
export const METRIC_TITLE = {
  temp: 'wx.temp', uv: 'wx.uv', wind: 'wx.wind', precip: 'wx.precip', humidity: 'wx.humidity', dew: 'wx.dew', visibility: 'wx.visibility',
  pressure: 'wx.pressure', aqi: 'wx.aqi', sun: 'wx.sun', moon: 'wx.moon',
};
const ABOUT = { temp: 'wx.ab.temp', uv: 'wx.ab.uv', wind: 'wx.ab.wind', precip: 'wx.ab.precip', humidity: 'wx.ab.humidity', dew: 'wx.ab.dew', visibility: 'wx.ab.visibility', pressure: 'wx.ab.pressure', aqi: 'wx.ab.aqi' };
const at = (arr, idx) => idx.map((i) => arr?.[i] ?? null);
const range = (v) => {
  const x = v.filter((n) => n != null);
  return x.length ? [Math.min(...x), Math.max(...x)] : [0, 1];
};
const round = (v, n = 0) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
const bigHTML = (num, lvl = '', extra = '') => `<div class="wx-dbig"><span class="num">${esc(num)}</span>${lvl ? `<span class="lvl">${esc(lvl)}</span>` : ''}${extra}</div>`;
const subHTML = (s) => `<div class="wx-dsub">${esc(s)}</div>`;

/** What a metric shows on day `di`: { o (chart), hero, scrub(i), sum, extra } or { empty } */
function metricView(metric, d, di) {
  const S = d.series, idx = dayRange(d, di), day = d.daily[di], isToday = di === todayIdx(d);
  if (!idx.length || !day) return { empty: t('wx.d.noData') };
  const f = fmtFor(d), c = d.current;
  const times = at(S.t, idx), start = day.date, end = d.daily[di + 1]?.date ?? start + 864e5;
  const base = { start, end, times, now: isToday ? Date.now() : null, hourLabel: f.hour };
  const hourOf = (i) => f.hour(times[i]);
  const has = (arr) => at(arr, idx).some((x) => x != null);
  let o, hero, scrub, sum, extra = '';
  const chanceChart = () => {
    const pc = chartSVG({ ...base, h: 120, bars: [{ v: at(S.pop, idx), color: '#62c3ff' }], min: 0, max: 100, ticks: [0, 50, 100], fmtY: (v) => v + '%' });
    return `<h4 class="wx-dh">${esc(t('wx.d.chance'))}</h4><div class="wx-chart sm">${pc.svg}</div>`;
  };
  switch (metric) {
    case 'temp': {
      const v = at(S.temp, idx).map(tempValue), fl = at(S.feels, idx).map(tempValue);
      const [loC, hiC] = range(at(S.temp, idx).concat(at(S.feels, idx)));
      const [lo, hi] = range(v.concat(fl));
      const grad = Array.from({ length: 7 }, (_, k) => loC + ((hiC - loC) * k) / 6).map((cv) => [tempValue(cv), tempColor(cv)]);
      let a = 0, b = 0;
      v.forEach((x, k) => {
        if (x != null && x > v[a]) a = k;
        if (x != null && x < v[b]) b = k;
      });
      o = {
        ...base, lines: [{ v, grad, fill: tempColor((loC + hiC) / 2) }, ...(has(S.feels) ? [{ v: fl, stroke: 'rgba(255,255,255,.6)', dash: true, dim: true }] : [])],
        min: lo - 2, max: hi + 2, fmtY: (x) => `${x}°`, marks: [{ i: a, label: `${v[a]}°` }, { i: b, label: `${v[b]}°`, below: true }],
        icons: idx.filter((_, k) => k % 2 === 0).map((i) => ({ t: S.t[i] + H, html: weatherInfo(S.code[i], !!S.day[i]).icon.replace('<svg', '<svg width="18" height="18"') })),
      };
      const hl = t('wx.d.hl', { h: fmtTemp(day.max), l: fmtTemp(day.min) });
      hero = isToday ? bigHTML(fmtTemp(c.temp), '', `<span class="ico">${weatherInfo(c.code, c.isDay).icon}</span>`) + subHTML(`${condLabel(c.code, c.isDay)} · ${hl}`)
        : bigHTML(fmtTemp(day.max), '', `<span class="lo">${esc(fmtTemp(day.min))}</span><span class="ico">${weatherInfo(day.code, true).icon}</span>`) + subHTML(condLabel(day.code, true));
      scrub = (i) => bigHTML(fmtTemp(S.temp[idx[i]]), '', `<span class="ico">${weatherInfo(S.code[idx[i]], !!S.day[idx[i]]).icon}</span>`) + subHTML(`${hourOf(i)} · ${condLabel(S.code[idx[i]], !!S.day[idx[i]])}${S.feels[idx[i]] != null ? ' · ' + t('wx.feels', { t: fmtTemp(S.feels[idx[i]]) }) : ''}`);
      sum = isToday ? t('wx.s.tempToday', { cond: condLabel(c.code, c.isDay), t: fmtTemp(c.temp), hi: fmtTemp(day.max), lo: fmtTemp(day.min) })
        : t('wx.s.tempDay', { cond: condLabel(day.code, true), hi: fmtTemp(day.max), lo: fmtTemp(day.min) });
      if (has(S.pop)) extra = chanceChart() + `<div class="wx-legend"><span><i class="sw grad"></i>${esc(t('wx.temp'))}</span>${has(S.feels) ? `<span><i class="sw dash"></i>${esc(t('wx.feelsLike'))}</span>` : ''}</div>`;
      break;
    }
    case 'uv': {
      if (!has(S.uv)) return { empty: t('wx.d.noData') };
      const v = at(S.uv, idx).map((x) => round(x, 1)), mx = Math.max(11, ...v.filter((x) => x != null));
      o = { ...base, lines: [{ v, grad: [[0, '#4cd964'], [3, '#c8e03a'], [5, '#ffcc00'], [7, '#ff9500'], [9, '#ff3b30'], [11, '#af52de']], fill: '#ffcc00' }], min: 0, max: mx, ticks: [0, 3, 6, 9, 12].filter((x) => x <= Math.ceil(mx / 3) * 3), fmtY: String };
      const u = Math.round(isToday ? c.uv ?? 0 : day.uv);
      hero = bigHTML(String(u), t('wx.uv.' + uvLevel(u))) + subHTML(isToday ? uvAdvice(d, di) : t('wx.d.highest', { v: Math.round(day.uv) }));
      scrub = (i) => {
        const x = Math.round(S.uv[idx[i]] ?? 0);
        return bigHTML(String(x), t('wx.uv.' + uvLevel(x))) + subHTML(hourOf(i));
      };
      sum = t('wx.s.uv', { n: Math.round(day.uv), level: t('wx.uv.' + uvLevel(Math.round(day.uv))) }) + ' ' + uvAdvice(d, di);
      extra = `<div class="wx-scale"><i style="background:${UV_GRAD('to right')}"></i><span>0</span><span>3</span><span>6</span><span>8</span><span>11+</span></div>`;
      break;
    }
    case 'wind': {
      if (!has(S.wind)) return { empty: t('wx.d.noData') };
      const u = windUnit(), cv = (x) => round(convWind(x, u), UNIT_DIGITS[u]);
      const v = at(S.wind, idx).map(cv), gs = at(S.gust, idx).map(cv), [, gmax] = range(v.concat(gs));
      o = {
        ...base, lines: [{ v, stroke: '#7fd6ff', fill: '#7fd6ff' }, ...(has(S.gust) ? [{ v: gs, stroke: 'rgba(127,214,255,.75)', dash: true }] : [])], min: 0, max: Math.max(gmax, 5), fmtY: String,
        icons: idx.filter((_, k) => k % 2 === 0).map((i) => ({ t: S.t[i] + H, html: `<g transform="rotate(${((S.dir[i] ?? 0) + 180) % 360} 9 9)"><path d="M9 2v14M4.5 6.5 9 2l4.5 4.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>` })),
      };
      const sp = windParts(isToday ? c.wind : day.windMax), gu = isToday ? c.gust : day.gustMax, dr = isToday ? c.windDir : day.windDir;
      hero = bigHTML(sp.value, sp.unit) + subHTML([gu != null ? t('wx.gustsN', { v: `${windParts(gu).value} ${sp.unit}` }) : '', dr != null ? t('wx.fromDir', { dir: compassName(dr) }) : ''].filter(Boolean).join(' · '));
      scrub = (i) => {
        const p = windParts(S.wind[idx[i]]);
        return bigHTML(p.value, p.unit) + subHTML([hourOf(i), S.gust[idx[i]] != null ? t('wx.gustsN', { v: `${windParts(S.gust[idx[i]]).value} ${p.unit}` }) : '', S.dir[idx[i]] != null ? t('wx.fromDir', { dir: compassName(S.dir[idx[i]]) }) : ''].filter(Boolean).join(' · '));
      };
      const mx = day.windMax ?? Math.max(...at(S.wind, idx).filter((x) => x != null)), gmx = day.gustMax ?? Math.max(0, ...at(S.gust, idx).filter((x) => x != null));
      sum = t('wx.s.wind', { v: `${windParts(mx).value} ${sp.unit}`, g: `${windParts(gmx).value} ${sp.unit}` });
      extra = `<div class="wx-legend"><span><i class="sw"></i>${esc(t('wx.wind'))}</span><span><i class="sw dash"></i>${esc(t('wx.gusts'))}</span></div>`;
      break;
    }
    case 'precip': {
      const u = precipUnit(), v = at(S.precip, idx).map((x) => round(convPrecip(x, u), u === 'in' ? 2 : 1));
      const [, mx] = range(v);
      o = { ...base, bars: [{ v, color: '#4aa8ff' }], min: 0, max: Math.max(u === 'in' ? 0.1 : 2, mx), fmtY: String };
      const tot = precipParts(day.precip);
      hero = bigHTML(tot.value, tot.unit) + subHTML(`${t('wx.d.total')} · ${t('wx.d.chanceN', { n: day.pop || 0 })}`);
      scrub = (i) => {
        const p = precipParts(S.precip[idx[i]] || 0);
        return bigHTML(p.value, p.unit) + subHTML(`${hourOf(i)} · ${t('wx.d.chanceN', { n: S.pop[idx[i]] ?? 0 })}`);
      };
      sum = day.precip > 0 ? t('wx.s.precip', { v: fmtPrecip(day.precip), n: day.pop || 0 }) : t('wx.s.noPrecip');
      if (has(S.pop)) extra = chanceChart();
      break;
    }
    case 'humidity': {
      if (!has(S.hum)) return { empty: t('wx.d.noData') };
      const v = at(S.hum, idx), [, mx] = range(v), [dlo, dhi] = range(at(S.dew, idx));
      o = { ...base, lines: [{ v, stroke: '#62c3ff', fill: '#62c3ff' }], min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmtY: (x) => x + '%' };
      const hv = isToday ? Math.round(c.humidity ?? 0) : Math.round(v.reduce((s, x) => s + (x || 0), 0) / v.length);
      hero = bigHTML(`${hv}%`, t('wx.hum.' + humLevel(hv))) + subHTML(isToday && c.dew != null ? t('wx.dewNow', { t: fmtTemp(c.dew) }) : t('wx.d.average'));
      scrub = (i) => bigHTML(`${v[i] ?? '--'}%`, v[i] != null ? t('wx.hum.' + humLevel(v[i])) : '') + subHTML(`${hourOf(i)}${S.dew[idx[i]] != null ? ' · ' + t('wx.dew') + ' ' + fmtTemp(S.dew[idx[i]]) : ''}`);
      sum = t('wx.s.hum', { n: mx, lo: fmtTemp(dlo), hi: fmtTemp(dhi) });
      break;
    }
    case 'dew': {
      if (!has(S.dew)) return { empty: t('wx.d.noData') };
      const v = at(S.dew, idx).map(tempValue), [lo, hi] = range(v), [loC, hiC] = range(at(S.dew, idx));
      o = { ...base, lines: [{ v, stroke: '#7be0c8', fill: '#7be0c8' }], min: lo - 2, max: hi + 2, fmtY: (x) => `${x}°` };
      const dv = isToday ? c.dew : hiC;
      hero = bigHTML(fmtTemp(dv), t('wx.dew.' + dewLevel(dv))) + subHTML(isToday ? t('wx.humidity') + ' ' + iso(Math.round(c.humidity ?? 0) + '%') : t('wx.d.highest', { v: fmtTemp(hiC) }));
      scrub = (i) => bigHTML(fmtTemp(S.dew[idx[i]]), t('wx.dew.' + dewLevel(S.dew[idx[i]] ?? 0))) + subHTML(`${hourOf(i)}${S.hum[idx[i]] != null ? ' · ' + t('wx.humidity') + ' ' + iso(S.hum[idx[i]] + '%') : ''}`);
      sum = t('wx.s.dew', { lo: fmtTemp(loC), hi: fmtTemp(hiC) });
      break;
    }
    case 'visibility': {
      if (!has(S.vis)) return { empty: t('wx.d.noData') };
      const u = distUnit(), v = at(S.vis, idx).map((x) => round(convDist(x, u), 1)), [, vhi] = range(v);
      o = { ...base, lines: [{ v, stroke: '#b3dcff', fill: '#b3dcff' }], min: 0, max: Math.max(1, vhi * 1.1), fmtY: String };
      const cur = distParts(isToday ? c.vis : Math.min(...at(S.vis, idx).filter((x) => x != null)));
      const lvl = visLevel(isToday ? c.vis : Math.min(...at(S.vis, idx).filter((x) => x != null)));
      hero = bigHTML(cur.value, cur.unit) + subHTML(isToday ? t('wx.vis.' + lvl) : t('wx.d.lowest', { v: `${cur.value} ${cur.unit}` }));
      scrub = (i) => {
        const p = distParts(S.vis[idx[i]]);
        return bigHTML(p.value, p.unit) + subHTML(hourOf(i));
      };
      sum = t('wx.s.vis', { lo: `${distParts(Math.min(...at(S.vis, idx).filter((x) => x != null))).value} ${unitLabel(u)}`, hi: `${distParts(Math.max(...at(S.vis, idx).filter((x) => x != null))).value} ${unitLabel(u)}` });
      break;
    }
    case 'pressure': {
      if (!has(S.pres)) return { empty: t('wx.d.noData') };
      const u = pressureUnit(), dg = UNIT_DIGITS[u], v = at(S.pres, idx).map((x) => round(convPressure(x, u), dg)), [lo, hi] = range(v);
      const pad = u === 'inhg' ? 0.1 : u === 'kpa' ? 0.3 : 3;
      o = { ...base, lines: [{ v, stroke: '#c8a8ff', fill: '#c8a8ff' }], min: lo - pad, max: hi + pad, fmtY: (x) => (u === 'inhg' ? x.toFixed(2) : u === 'kpa' ? x.toFixed(1) : String(Math.round(x))) };
      const tr = pressureTrend(d);
      const p = pressureParts(isToday ? c.pressure : S.pres[idx[12] ?? idx[0]]);
      hero = bigHTML(p.value, p.unit) + subHTML(isToday ? t(tr > 0 ? 'wx.pres.rising' : tr < 0 ? 'wx.pres.falling' : 'wx.pres.steady') : t('wx.d.atNoon'));
      scrub = (i) => {
        const q = pressureParts(S.pres[idx[i]]);
        return bigHTML(q.value, q.unit) + subHTML(hourOf(i));
      };
      sum = t('wx.s.pres', { lo: `${o.fmtY(lo)} ${p.unit}`, hi: `${o.fmtY(hi)} ${p.unit}` }) + (isToday ? ' ' + t(tr > 0 ? 'wx.s.presUp' : tr < 0 ? 'wx.s.presDown' : 'wx.s.presSteady') : '');
      break;
    }
    case 'aqi': {
      const a = aqiInfo(d);
      if (!a) return { empty: t('wx.d.noAq') };
      const T = d.aqi.hours.t, arr = d.aqi.hours[a.key];
      const vals = times.map((ms) => {
        const k = T.indexOf(ms);
        return k >= 0 ? arr[k] : null;
      });
      if (!vals.some((x) => x != null)) return { empty: t('wx.d.noAq') };
      const colorOf = (x) => aqiLevelOf(a, x)[2];
      o = { ...base, bars: [{ v: vals, colorOf }], min: 0, max: Math.max(a.eu ? 60 : 100, ...vals.filter((x) => x != null)), fmtY: String };
      const cur = isToday ? a.v : Math.max(...vals.filter((x) => x != null));
      hero = bigHTML(String(cur), t('wx.aq.' + aqiLevelOf(a, cur)[1])) + subHTML(t(a.eu ? 'wx.aqEu' : 'wx.aqUs'));
      scrub = (i) => (vals[i] == null ? hero : bigHTML(String(vals[i]), t('wx.aq.' + aqiLevelOf(a, vals[i])[1])) + subHTML(hourOf(i)));
      sum = t('wx.s.aq', { n: Math.max(...vals.filter((x) => x != null)), level: t('wx.aq.' + aqiLevelOf(a, Math.max(...vals.filter((x) => x != null)))[1]) });
      const P = d.aqi;
      const pol = isToday ? `<div class="wx-rows">${[['pm25', P.pm25], ['pm10', P.pm10], ['o3', P.o3], ['no2', P.no2], ['so2', P.so2], ['co', P.co]].filter(([, x]) => x != null)
        .map(([k, x]) => `<div class="wx-rowx"><span>${esc(t('wx.' + k))}</span><b>${iso(`${Math.round(x)} ${esc(t('wx.ugm3'))}`)}</b></div>`).join('')}</div>` : '';
      extra = `<div class="wx-aqscale">${a.scale.map((s, k) => `<div><i style="background:${s[2]}"></i><span>${esc(t('wx.aq.' + s[1]))}</span><em>${iso(`${k ? a.scale[k - 1][0] + 1 : 0}${Number.isFinite(s[0]) ? '–' + s[0] : '+'}`)}</em></div>`).join('')}</div>${pol}`;
      break;
    }
  }
  return { o, hero, scrub, sum, extra };
}

/** Pushes the detail page of a metric for forecast `d` (place p), on day `day` (default today). */
export function openDetail(ctx, p, d, { metric = 'temp', day } = {}) {
  const ti = todayIdx(d);
  let di = day ?? ti, month = null;
  const f = fmtFor(d);
  const last = Math.min(d.daily.length - 1, ti + 9);
  ctx.push({
    title: t(METRIC_TITLE[metric] || 'wx.temp'),
    hero: false,
    className: 'wx-dpage',
    render(body, page) {
      page.el.dataset.metric = metric;
      const sky = skyEl(d);
      sky.classList.add('wx-dsky');
      page.el.prepend(sky);
      const chips = h('div', { class: 'wx-days', role: 'tablist', 'aria-label': t('wx.d.pickDay') });
      const date = h('div', { class: 'wx-ddate' });
      const main = h('div', { class: 'wx-dmain' });
      body.append(h('div', { class: 'wx-dplace' }, placeName(p, d)), chips, date, main);
      chips.addEventListener('click', (e) => {
        const b = e.target.closest('[data-day]');
        if (!b) return;
        di = +b.dataset.day;
        month = null;
        draw();
      });
      chips.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const fwd = (e.key === 'ArrowRight') !== (document.dir === 'rtl');
        di = Math.max(ti, Math.min(last, di + (fwd ? 1 : -1)));
        month = null;
        draw();
        chips.querySelector(`[data-day="${di}"]`)?.focus();
      });
      main.addEventListener('click', (e) => {
        const m = e.target.closest('[data-m]');
        if (!m || !month) return;
        const r = new Date(month.base);
        r.setUTCMonth(r.getUTCMonth() + +m.dataset.m, 15);
        month.base = r.getTime();
        drawCal();
      });

      function draw() {
        chips.replaceChildren(...d.daily.slice(ti, last + 1).map((x, k) => h('button', {
          class: ['wx-day', ti + k === di && 'on'], role: 'tab', 'aria-selected': String(ti + k === di), dataset: { day: String(ti + k) }, tabindex: ti + k === di ? 0 : -1,
          'aria-label': f.dateLong(x.date + 12 * H),
        }, h('span', null, k === 0 ? t('common.today') : f.wd(x.date + 12 * H)), h('b', null, f.dayNum(x.date + 12 * H)))));
        chips.querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        date.textContent = f.dateLong(d.daily[di].date + 12 * H);
        if (metric === 'sun') return drawSun();
        if (metric === 'moon') return drawMoon();
        const v = metricView(metric, d, di);
        if (v.empty) {
          main.innerHTML = `<div class="wx-dempty">${esc(v.empty)}</div>`;
          return;
        }
        const ch = chartSVG(v.o);
        main.innerHTML = `<div class="wx-dhero">${v.hero}</div><div class="wx-chart">${ch.svg}</div>${v.extra}
          <section class="wx-dcard"><h4>${esc(t('wx.d.summary'))}</h4><p>${esc(v.sum)}</p></section>
          ${ABOUT[metric] ? `<section class="wx-dcard"><h4>${esc(t('wx.d.aboutX', { name: t(METRIC_TITLE[metric]) }))}</h4><p>${esc(t(ABOUT[metric]))}</p></section>` : ''}`;
        const heroEl = main.querySelector('.wx-dhero');
        bindScrub(main.querySelector('.wx-chart'), v.o, ch, (i) => {
          heroEl.innerHTML = i == null ? v.hero : v.scrub(i);
          heroEl.classList.toggle('scrub', i != null);
        });
      }

      function drawSun() {
        const day = d.daily[di], st = sunTimes(day.date + 12 * H, d.location.lat, d.location.lon);
        const ok = (ms) => ms && !Number.isNaN(ms);
        const dl = day.daylight ?? (day.sunset - day.sunrise) / 1000;
        const polar = day.daylight === 0 ? 'night' : day.daylight >= 86399 ? 'day' : null;
        const now = Date.now(), up = di === ti && now > day.sunrise && now < day.sunset;
        const prev = d.daily[di - 1] || d.yesterday, delta = prev?.daylight != null && day.daylight != null ? Math.round((day.daylight - prev.daylight) / 60) : null;
        const row = (k, v) => `<div class="wx-rowx"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
        main.innerHTML = `<div class="wx-dhero">${polar ? bigHTML(t(polar === 'night' ? 'wx.polarNight' : 'wx.polarDay')) : bigHTML(f.time(up ? day.sunset : day.sunrise)) + subHTML(t(up ? 'wx.sunset' : 'wx.sunrise'))}</div>
          <div class="wx-chart sun">${sunPathSVG(d, di, { now })}<div class="wx-sunx">${[0, 6, 12, 18].map((hh) => `<span>${esc(f.hour(day.date + hh * H))}</span>`).join('')}</div></div>
          <div class="wx-rows">${row(t('wx.d.firstLight'), ok(st.dawn) ? f.time(st.dawn) : '—')}${row(t('wx.sunrise'), !polar && ok(day.sunrise) ? f.time(day.sunrise) : '—')}${row(t('wx.sunset'), !polar && ok(day.sunset) ? f.time(day.sunset) : '—')}${row(t('wx.d.lastLight'), ok(st.dusk) ? f.time(st.dusk) : '—')}${row(t('wx.d.daylight'), t('wx.d.hm', { h: Math.floor(dl / 3600), m: Math.round((dl % 3600) / 60) }))}</div>
          ${delta ? `<p class="wx-dnote">${esc(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}`)} ${esc(t('wx.d.daylight'))}</p>` : ''}
          <section class="wx-dcard"><h4>${esc(t('wx.d.aboutX', { name: t('wx.sun') }))}</h4><p>${esc(t('wx.ab.sun'))}</p></section>`;
      }

      function drawMoon() {
        const m = moonFacts(d, di), south = d.location.lat < 0;
        const row = (k, v) => `<div class="wx-rowx"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
        const dist = distParts(m.distance * 1000);
        month ??= { base: d.daily[di].date + 12 * H };
        main.innerHTML = `<div class="wx-dmoon">${moonSVG(m.phase, m.fraction, 150, south)}<div>${bigHTML(t('wx.ph.' + m.idx))}${subHTML(`${t('wx.illum')} ${iso(Math.round(m.fraction * 100) + '%')}`)}</div></div>
          <div class="wx-rows">${row(t('wx.moonrise'), m.rise ? f.time(m.rise) : m.up ? t('wx.upAllDay') : '—')}${row(t('wx.moonset'), m.set ? f.time(m.set) : m.down ? t('wx.downAllDay') : '—')}
          ${row(t('wx.nextFull'), m.full ? f.dateLong(m.full) : '—')}${row(t('wx.nextNew'), m.new ? f.dateLong(m.new) : '—')}${row(t('wx.distance'), `${Math.round(+dist.value.replace(/[^\d.]/g, '')).toLocaleString('en')} ${dist.unit}`)}</div>
          <div class="wx-cal"></div>
          <section class="wx-dcard"><h4>${esc(t('wx.d.aboutX', { name: t('wx.moon') }))}</h4><p>${esc(t('wx.ab.moon'))}</p></section>`;
        drawCal();
      }

      function drawCal() {
        const cal = main.querySelector('.wx-cal');
        if (!cal) return;
        const off = (d.utcOffset || 0) * 1000, south = d.location.lat < 0;
        const ref = new Date(month.base + off); // the place's wall-clock date, read with UTC getters
        const y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
        const first = Date.UTC(y, mo, 1) - off, days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const lead = new Date(Date.UTC(y, mo, 1)).getUTCDay();
        const sel = new Date(d.daily[di].date + 12 * H + off);
        let cells = '';
        for (let k = 0; k < lead; k++) cells += '<span></span>';
        for (let k = 1; k <= days; k++) {
          const noon = first + (k - 1) * 864e5 + 12 * H, p = moonPhase(noon);
          const on = sel.getUTCFullYear() === y && sel.getUTCMonth() === mo && sel.getUTCDate() === k;
          cells += `<span class="${on ? 'on' : ''}">${moonSVG(p.phase, p.fraction, 26, south)}<em>${esc(f.dayNum(noon))}</em></span>`;
        }
        const wd = [...Array(7)].map((_, k) => `<b>${esc(f.wd(Date.UTC(2024, 0, 7 + k, 12) - off))}</b>`).join('');
        cal.innerHTML = `<div class="wx-cal-h"><button data-m="-1" aria-label="${esc(t('wx.prevMonth'))}">${icon('back', 20)}</button><span>${esc(f.monthYear(first + 12 * H))}</span><button data-m="1" aria-label="${esc(t('wx.nextMonth'))}">${icon('forward', 20)}</button></div><div class="wx-cal-g">${wd}${cells}</div>`;
      }

      draw();
    },
  });
}

