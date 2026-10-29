// Samsung Weather's main screen pieces for one place: the header (name, big temperature, high/low, feels like,
// "Updated" with refresh), the insight line, the hourly forecast with its temperature graph and chance of rain,
// the 10-day list with temperature range bars, and the detail cards (UV index, humidity, wind with compass, air
// quality, sunrise/sunset arc, moon phase, pressure, visibility, dew point, precipitation). Each card is a button
// with data-open="<metric>"; js/weather/ui.js opens the detail page for it.
import { h, escapeHtml as esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, isRtl, use12h } from '../core/i18n.js';
import {
  HERE, weatherInfo, condLabel, fmtTemp, tempValue, tempUnit, windParts, pressureParts, precipParts, distParts, fmtWind, fmtPrecip, tzFmt, placeName,
} from '../services/weather.js';
import {
  weatherKind, isWet, todayIdx, nextHours, rainSoon, uvLevel, compassIndex, aqiInfo, pressureTrend, precipFacts, tempColor, dayRange,
} from './model.js';
import { sunAltitude, moonPhase, moonTimes, nextPhase, phaseIndex } from './astro.js';
import { moonSVG } from './sky.js';

const H = 36e5;
const iso = (s) => `⁦${s}⁩`;

/** Formatters for a forecast's place (its own time zone) and the 12/24-hour setting. */
export function fmtFor(d) {
  const F = tzFmt(d);
  const tight = (s) => (/[AP]M/i.test(s) ? s.replace(/[\s ]+/g, ' ') : s);
  return { ...F, time: (ms) => tight(F.time(ms)), hour: (ms) => tight(use12h() ? F.hour(ms) : F.time(ms)) };
}

/** True when the place's clock differs from this computer's (then its local time is shown). */
export function otherZone(d, now = Date.now()) {
  if (!d?.timezone) return false;
  try {
    const here = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).format(now);
    return here !== new Intl.DateTimeFormat('en', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: d.timezone }).format(now);
  } catch {
    return false;
  }
}

// ——— header ———
/**
 * p: the place, d: its forecast. opts: { index, total, onDot(i), onRefresh(button) }
 */
export function headerEl(p, d, { index = 0, total = 1, hereFirst = false, onDot, onRefresh } = {}) {
  const c = d.current, info = weatherInfo(c.code, c.isDay), today = d.daily[todayIdx(d)] || {};
  const f = fmtFor(d);
  const dots = total > 1 ? h('div', { class: 'wx-dots', role: 'tablist' }, Array.from({ length: total }, (_, i) => h('button', {
    class: ['wx-dot', i === index && 'on', i === 0 && hereFirst && 'here'], role: 'tab', 'aria-selected': String(i === index), 'aria-label': t('wx.placeOf', { n: i + 1, total }),
    html: i === 0 && hereFirst ? icon('navigation', 10) : '', onClick: () => onDot?.(i),
  }))) : null;
  const refresh = onRefresh ? h('button', { class: 'wx-refresh', title: t('wx.refresh'), 'aria-label': t('wx.refresh'), html: icon('refresh', 16), onClick: (e) => onRefresh(e.currentTarget) }) : null;
  return h('header', { class: 'wx-head' },
    h('div', { class: 'wx-place' },
      p.id === HERE ? h('span', { class: 'wx-here', html: icon('navigation', 16) }) : null,
      h('h2', { class: 'wx-name' }, placeName(p, d))),
    dots,
    otherZone(d) ? h('div', { class: 'wx-local' }, t('wx.localTime', { time: f.time(Date.now()) })) : null,
    h('div', { class: 'wx-now' },
      h('div', { class: 'wx-now-l' },
        h('div', { class: 'wx-temp' }, fmtTemp(c.temp)),
        h('div', { class: 'wx-cond' }, info.label),
        h('div', { class: 'wx-hl' },
          h('span', { class: 'wx-hl-hi' }, h('span', { class: 'wx-arrow', html: icon('up', 14) }), fmtTemp(today.max ?? c.high)),
          h('span', { class: 'wx-hl-lo' }, h('span', { class: 'wx-arrow', html: icon('down', 14) }), fmtTemp(today.min ?? c.low))),
        h('div', { class: 'wx-feels' }, t('wx.feels', { t: fmtTemp(c.feels) }))),
      h('div', { class: 'wx-now-ico', html: info.icon })),
    h('div', { class: 'wx-updated' }, h('span', null, t('wx.updated', { time: f.time(d.fetchedAt) })), refresh));
}

// ——— insight ———
/** The one sentence worth knowing first (Samsung's weather insight), or ''. */
export function insightText(d, now = Date.now()) {
  const f = fmtFor(d), S = d.series, c = d.current;
  const soon = rainSoon(d, now, 12 * H);
  if (soon) return t(soon.kind === 'snow' ? 'wx.in.snowAt' : soon.kind === 'thunder' ? 'wx.in.stormAt' : 'wx.in.rainAt', { time: f.hour(soon.at) });
  const idx = nextHours(d, 13, now);
  if (isWet(c.code) && idx.length) {
    const dry = idx.slice(1).find((k) => !isWet(S.code[k]) && (S.pop[k] ?? 0) < 30);
    return dry != null ? t('wx.in.rainStop', { time: f.hour(S.t[dry]) }) : t('wx.in.rainOn');
  }
  const ti = todayIdx(d, now), t0 = d.daily[ti], t1 = d.daily[ti + 1];
  if (t0 && t1 && t0.max != null && t1.max != null) {
    const diff = tempValue(t1.max) - tempValue(t0.max);
    if (Math.abs(diff) >= (tempUnit() === 'f' ? 7 : 4)) return t(diff > 0 ? 'wx.in.warmer' : 'wx.in.cooler', { n: Math.abs(diff) });
  }
  const gust = Math.max(0, ...idx.slice(0, 12).map((k) => S.gust?.[k] || 0));
  if (gust >= 50) return t('wx.in.windy', { v: fmtWind(gust) });
  if ((t0?.uv || 0) >= 6 && t0.sunset && now < t0.sunset - 3 * H) return t('wx.in.uv', { n: Math.round(t0.uv) });
  const kNow = weatherKind(c.code), later = idx.slice(1, 7).map((k) => weatherKind(S.code[k]));
  const clear = (k) => k === 'clear';
  if (clear(kNow) && later.every(clear)) return c.isDay ? t('wx.in.clearDay') : t('wx.in.clearNight');
  const ch = later.findIndex((k) => k !== kNow);
  if (ch >= 0 && later.slice(ch).filter((k) => k === later[ch]).length >= 2) {
    const k = idx[1 + ch];
    return t('wx.in.change', { cond: condLabel(S.code[k], !!S.day[k]), time: f.hour(S.t[k]) });
  }
  return t('wx.in.same', { cond: condLabel(c.code, c.isDay) });
}

export function insightEl(d) {
  const text = insightText(d);
  if (!text) return null;
  const k = rainSoon(d, Date.now(), 12 * H) || isWet(d.current.code) ? 'drop' : 'sparkle';
  return h('section', { class: 'wx-card wx-insight', role: 'note' }, h('span', { class: 'wx-insight-i', html: icon(k, 18) }), h('p', null, text));
}

// ——— hourly ———
const COL = 58;
export function hourlyEl(d) {
  const S = d.series, idx = nextHours(d, 25);
  if (idx.length < 2) return null;
  const f = fmtFor(d);
  const temps = idx.map((k) => tempValue(S.temp[k])).filter((v) => v != null);
  const lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(1, hi - lo);
  const yOf = (v) => 22 + (1 - (v - lo) / span) * 28; // the graph row is 58 px tall, labels sit above the dots
  const pts = idx.map((k, i) => [i * COL + COL / 2, yOf(tempValue(S.temp[k]) ?? lo)]);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const W = idx.length * COL;
  const graph = `<svg class="wx-hgraph" width="${W}" height="58" viewBox="0 0 ${W} 58" aria-hidden="true"><path d="${path}" class="wx-hline"/>${pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === 0 ? 4 : 3}" class="${i === 0 ? 'now' : ''}"/>`).join('')}</svg>`;
  const cols = idx.map((k, i) => {
    const now = i === 0, code = now ? d.current.code : S.code[k], day = now ? d.current.isDay : !!S.day[k], pop = S.pop[k] ?? 0;
    const v = now ? d.current.temp : S.temp[k];
    return h('div', { class: ['wx-hcol', now && 'now'] },
      h('span', { class: 'wx-ht' }, now ? t('wx.now') : f.hour(S.t[k])),
      h('span', { class: 'wx-hi', html: weatherInfo(code, day).icon }),
      h('span', { class: 'wx-hg' }, h('span', { class: 'wx-hv', style: { top: (yOf(tempValue(S.temp[k]) ?? lo) - 21).toFixed(1) + 'px' } }, fmtTemp(v))),
      h('span', { class: ['wx-hp', pop < 10 && 'none'] }, h('span', { html: icon('drop', 11) }), iso(`${pop}%`)));
  });
  const strip = h('div', { class: 'wx-hstrip', tabindex: 0, 'aria-label': t('wx.hourly') },
    h('div', { class: 'wx-hcols', style: { width: W + 'px' } }, h('div', { class: 'wx-hgraph-wrap', html: graph }), cols));
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft += isRtl() ? -e.deltaY : e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  return h('section', { class: 'wx-card wx-hourly', dataset: { open: 'temp' }, role: 'button', tabindex: -1 },
    h('h3', { class: 'wx-card-h' }, h('span', { html: icon('clock', 16) }), t('wx.hourly')), strip);
}

// ——— 10 days ———
export function dailyEl(d) {
  const ti = todayIdx(d), days = d.daily.slice(ti, ti + 10);
  if (!days.length) return null;
  const f = fmtFor(d), c = d.current;
  const lo = Math.min(...days.map((x) => x.min ?? 99), c.temp ?? 99), hi = Math.max(...days.map((x) => x.max ?? -99), c.temp ?? -99), span = Math.max(1, hi - lo);
  const dir = isRtl() ? 'to left' : 'to right';
  const rows = days.map((x, k) => {
    const s = ((x.min - lo) / span) * 100, e = ((hi - x.max) / span) * 100;
    const grad = `linear-gradient(${dir}, ${tempColor(x.min)}, ${tempColor((x.min + x.max) / 2)}, ${tempColor(x.max)})`;
    const dot = k === 0 && c.temp != null ? h('b', { class: 'wx-bar-now', style: { insetInlineStart: `${Math.min(100, Math.max(0, ((c.temp - x.min) / Math.max(1, x.max - x.min)) * 100)).toFixed(1)}%` } }) : null;
    return h('button', { class: 'wx-drow', dataset: { day: String(ti + k) } },
      h('span', { class: 'wx-dn' }, k === 0 ? t('common.today') : f.wd(x.date + 12 * H)),
      h('span', { class: ['wx-dp', (x.pop || 0) < 10 && 'none'] }, h('span', { html: icon('drop', 11) }), iso(`${x.pop || 0}%`)),
      h('span', { class: 'wx-di', html: weatherInfo(x.code, true).icon }),
      h('span', { class: 'wx-dlo' }, fmtTemp(x.min)),
      h('span', { class: 'wx-bar' }, h('i', { style: { insetInlineStart: s.toFixed(1) + '%', insetInlineEnd: e.toFixed(1) + '%', background: grad } }, dot)),
      h('span', { class: 'wx-dhi' }, fmtTemp(x.max)));
  });
  return h('section', { class: 'wx-card wx-daily' }, h('h3', { class: 'wx-card-h' }, h('span', { html: icon('calendar', 16) }), t('wx.daily')), h('div', { class: 'wx-drows' }, rows));
}

// ——— detail cards ———
const tile = (id, ic, title, ...body) => h('button', { class: ['wx-tile', 'wx-t-' + id], dataset: { open: id }, 'aria-label': title },
  h('span', { class: 'wx-tile-h' }, h('span', { html: icon(ic, 15) }), h('span', null, title)), ...body);
const big = (v, unit) => h('span', { class: 'wx-tile-v' }, iso(String(v)), unit ? h('small', null, unit) : null);
const sub = (s) => h('span', { class: 'wx-tile-s' }, s);
const note = (s) => (s ? h('span', { class: 'wx-tile-n' }, s) : null);
const gauge = (pct, bg) => h('span', { class: 'wx-gauge', style: { background: bg } }, h('b', { style: { insetInlineStart: `${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%` } }));
export const UV_GRAD = (dir) => `linear-gradient(${dir}, #4cd964 0%, #c8e03a 22%, #ffcc00 38%, #ff9500 55%, #ff3b30 75%, #af52de 100%)`;

/** UV advice for the rest of the day (or for a whole other day). */
export function uvAdvice(d, i = todayIdx(d), now = Date.now()) {
  const S = d.series, f = fmtFor(d), hrs = dayRange(d, i).filter((k) => Math.round(S.uv[k] ?? 0) >= 3);
  const today = i === todayIdx(d, now);
  if (!hrs.length) return today ? t('wx.uvAdv.low') : t('wx.uvAdv.lowDay');
  const from = S.t[hrs[0]], to = S.t[hrs.at(-1)] + H;
  if (today && now >= to) return t('wx.uvAdv.low');
  if (today && now >= from) return t('wx.uvAdv.until', { time: f.hour(to) });
  return t('wx.uvAdv.range', { from: f.hour(from), to: f.hour(to) });
}

export const humLevel = (v) => (v < 30 ? 'dry' : v < 60 ? 'ok' : v < 80 ? 'humid' : 'veryHumid');
export const dewLevel = (c) => (c < 10 ? 'dry' : c < 16 ? 'comfy' : c < 20 ? 'sticky' : 'muggy');
export const windLevel = (kmh) => (kmh < 2 ? 'calm' : kmh < 12 ? 'light' : kmh < 30 ? 'breeze' : kmh < 62 ? 'strong' : 'gale');
export const visLevel = (m) => (m >= 20000 ? 5 : m >= 10000 ? 4 : m >= 4000 ? 3 : m >= 1000 ? 2 : 1);
export function visNote(m, code) {
  if (m == null) return '';
  const k = weatherKind(code);
  if (m >= 10000) return t('wx.vis.clear');
  return k === 'fog' ? t('wx.vis.fog') : isWet(code) ? t('wx.vis.wet') : t('wx.vis.haze');
}
export const compassName = (deg) => t('wx.cmp.' + compassIndex(deg));

/** Compass dial: the arrow points the way the wind blows; it never mirrors. */
export function compassSVG(dirDeg, speed, unit, size = 112) {
  const c = size / 2, R = c - 3;
  let ticks = '';
  for (let k = 0; k < 72; k++) {
    const a = (k * 5 * Math.PI) / 180, long = k % 18 === 0, r1 = R - (long ? 8 : 5);
    ticks += `<line x1="${(c + Math.sin(a) * r1).toFixed(1)}" y1="${(c - Math.cos(a) * r1).toFixed(1)}" x2="${(c + Math.sin(a) * R).toFixed(1)}" y2="${(c - Math.cos(a) * R).toFixed(1)}"${long ? ' class="l"' : ''}/>`;
  }
  const L = [[0, 'wx.cmpN'], [90, 'wx.cmpE'], [180, 'wx.cmpS'], [270, 'wx.cmpW']].map(([a, k]) => {
    const r = R - 17, x = c + Math.sin((a * Math.PI) / 180) * r, y = c - Math.cos((a * Math.PI) / 180) * r;
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${esc(t(k))}</text>`;
  }).join('');
  const rot = ((dirDeg ?? 0) + 180) % 360;
  return `<svg class="wx-compass" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" style="direction:ltr">
    <g class="tk">${ticks}</g><g class="lb">${L}</g>
    ${dirDeg == null ? '' : `<g transform="rotate(${rot} ${c} ${c})"><line x1="${c}" y1="${c + R - 7}" x2="${c}" y2="${c - R + 12}" class="ar"/><path d="M${c - 6} ${c - R + 16} L${c} ${c - R + 4} L${c + 6} ${c - R + 16}Z" class="ah"/><circle cx="${c}" cy="${c + R - 8}" r="3.2" class="at"/></g>`}
    <circle cx="${c}" cy="${c}" r="${(R * 0.42).toFixed(1)}" class="hub"/>
    <text x="${c}" y="${c + 3}" text-anchor="middle" class="sp">${esc(speed)}</text><text x="${c}" y="${c + 16}" text-anchor="middle" class="un">${esc(unit)}</text></svg>`;
}

/** Pressure dial from 960 to 1050 hPa with a needle and the trend arrow. */
export function pressureSVG(hpa, trend, size = 112) {
  const c = size / 2, R = c - 4, a0 = -130, a1 = 130, lo = 960, hi = 1050;
  const ang = (v) => a0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (a1 - a0);
  let ticks = '';
  for (let k = 0; k <= 40; k++) {
    const a = ((a0 + (k * (a1 - a0)) / 40) * Math.PI) / 180;
    ticks += `<line x1="${(c + Math.sin(a) * (R - 7)).toFixed(1)}" y1="${(c - Math.cos(a) * (R - 7)).toFixed(1)}" x2="${(c + Math.sin(a) * R).toFixed(1)}" y2="${(c - Math.cos(a) * R).toFixed(1)}"/>`;
  }
  const p = pressureParts(hpa);
  const arrow = trend > 0 ? '<path d="M0 5V-5M-4 -1 0 -5 4 -1"/>' : trend < 0 ? '<path d="M0 -5V5M-4 1 0 5 4 1"/>' : '<path d="M-5 -2.5H5M-5 2.5H5"/>';
  return `<svg class="wx-pgauge" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" style="direction:ltr">
    <g class="tk">${ticks}</g>${hpa == null ? '' : `<g transform="rotate(${ang(hpa).toFixed(1)} ${c} ${c})"><rect x="${c - 2}" y="${c - R - 2}" width="4" height="14" rx="2" class="nd"/></g>`}
    <g transform="translate(${c} ${c - 12})" class="tr">${arrow}</g>
    <text x="${c}" y="${c + 12}" text-anchor="middle" class="pv">${esc(p.value)}</text><text x="${c}" y="${c + 26}" text-anchor="middle" class="pu">${esc(p.unit)}</text>
    <text x="${(c - R * 0.6).toFixed(1)}" y="${size - 3}" text-anchor="middle" class="lh">${esc(t('wx.pres.low'))}</text><text x="${(c + R * 0.6).toFixed(1)}" y="${size - 3}" text-anchor="middle" class="lh">${esc(t('wx.pres.high'))}</text></svg>`;
}

/** Sunrise → sunset arc with the sun where it is now (sunrise on the right in Arabic). */
export function sunArcSVG(day, now = Date.now(), w = 150, hgt = 64) {
  const up = day?.sunrise && day?.sunset && now > day.sunrise && now < day.sunset;
  const f = up ? (now - day.sunrise) / (day.sunset - day.sunrise) : now <= (day?.sunrise || 0) ? 0 : 1;
  const cx = w / 2, rx = w / 2 - 10, ry = hgt - 14, base = hgt - 6;
  const xf = (q) => (isRtl() ? cx + rx * Math.cos(Math.PI * q) : cx - rx * Math.cos(Math.PI * q));
  const sx = xf(f), sy = base - ry * Math.sin(Math.PI * f);
  const done = Array.from({ length: 21 }, (_, i) => (i / 20) * f).map((q, i) => `${i ? 'L' : 'M'}${xf(q).toFixed(1)} ${(base - ry * Math.sin(Math.PI * q)).toFixed(1)}`).join('');
  return `<svg class="wx-sunarc" viewBox="0 0 ${w} ${hgt}" width="100%" height="${hgt}" aria-hidden="true">
    <path d="M${xf(0).toFixed(1)} ${base}A${rx} ${ry} 0 0 ${isRtl() ? 0 : 1} ${xf(1).toFixed(1)} ${base}" class="arc"/>
    ${up ? `<path d="${done}" class="done"/>` : ''}<line x1="2" x2="${w - 2}" y1="${base}" y2="${base}" class="hz"/>
    ${up ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6.5" class="sun"/>` : ''}</svg>`;
}

/** Moon facts for day i of the forecast: { phase, fraction, idx, rise, set, up, down, full, new, now } */
export function moonFacts(d, i = todayIdx(d), now = Date.now()) {
  const day = d.daily[i] || d.daily[0], when = i === todayIdx(d, now) ? now : day.date + 12 * H;
  const ph = moonPhase(when), mt = moonTimes(day.date, d.location.lat, d.location.lon);
  return { ...ph, idx: phaseIndex(ph.phase), rise: mt.rise, set: mt.set, up: mt.up, down: mt.down, full: nextPhase(when, 0.5), new: nextPhase(when, 0), now: when };
}

export function tilesEl(d) {
  const c = d.current, f = fmtFor(d), ti = todayIdx(d), today = d.daily[ti] || {}, now = Date.now();
  const dir = isRtl() ? 'to left' : 'to right';
  const out = [];
  // UV index
  const uv = Math.round(c.uv ?? 0);
  out.push(tile('uv', 'sun', t('wx.uv'), big(uv), sub(t('wx.uv.' + uvLevel(uv))), gauge(uv / 11, UV_GRAD(dir)), note(uvAdvice(d))));
  // humidity
  if (c.humidity != null) {
    out.push(tile('humidity', 'drop', t('wx.humidity'), big(`${Math.round(c.humidity)}%`), sub(t('wx.hum.' + humLevel(c.humidity))),
      h('span', { class: 'wx-meter' }, h('b', { style: { width: `${Math.round(c.humidity)}%` } })),
      note(c.dew != null ? t('wx.dewNow', { t: fmtTemp(c.dew) }) : '')));
  }
  // wind
  const w = windParts(c.wind);
  out.push(tile('wind', 'wind', t('wx.wind'),
    h('span', { class: 'wx-wind-b' },
      h('span', { class: 'wx-wind-t' }, big(w.value, w.unit), sub(t('wx.wind.' + windLevel(c.wind))),
        note([c.windDir != null ? t('wx.fromDir', { dir: compassName(c.windDir) }) : '', c.gust != null ? t('wx.gustsN', { v: fmtWind(c.gust) }) : ''].filter(Boolean).join(' · '))),
      h('span', { class: 'wx-compass-wrap', html: compassSVG(c.windDir, w.value, w.unit, 96) }))));
  // air quality
  const a = aqiInfo(d);
  if (a) {
    const stops = a.scale.map((s, i) => `${s[2]} ${((i * 100) / (a.scale.length - 1)).toFixed(0)}%`).join(', ');
    out.push(tile('aqi', 'leaf', t('wx.aqi'), big(a.v), sub(t('wx.aq.' + a.level)), gauge(a.pct, `linear-gradient(${dir}, ${stops})`),
      note(t(['good', 'fair'].includes(a.level) ? 'wx.aqn.ok' : ['moderate', 'sensitive', 'poor'].includes(a.level) ? 'wx.aqn.some' : 'wx.aqn.bad'))));
  }
  // sunrise / sunset
  if (today.sunrise && today.sunset && !Number.isNaN(today.sunrise)) {
    const polar = today.daylight === 0 ? 'night' : today.daylight >= 86399 ? 'day' : null;
    const next = now < today.sunrise ? ['sunrise', today.sunrise] : now < today.sunset ? ['sunset', today.sunset] : ['sunrise', d.daily[ti + 1]?.sunrise || today.sunrise];
    out.push(tile('sun', next[0] === 'sunset' ? 'sunset' : 'sunrise', t('wx.' + next[0]),
      polar ? sub(t(polar === 'night' ? 'wx.polarNight' : 'wx.polarDay')) : big(f.time(next[1])),
      h('span', { class: 'wx-arc-wrap', html: sunArcSVG(today, now) }),
      note(polar ? '' : next[0] === 'sunset' ? t('wx.sunriseAt', { time: f.time(today.sunrise) }) : t('wx.sunsetAt', { time: f.time(today.sunset) }))));
  }
  // moon phase (needs the place's days for its rise and set)
  if (d.daily.length && d.location?.lat != null) {
    const m = moonFacts(d, ti, now);
    const ev = [['moonriseAt', m.rise], ['moonsetAt', m.set]].filter(([, ms]) => ms && ms > now).sort((x, y) => x[1] - y[1])[0];
    out.push(tile('moon', 'moon', t('wx.moon'),
      h('span', { class: 'wx-moon-b' },
        h('span', null, h('span', { class: 'wx-tile-v sm' }, t('wx.ph.' + m.idx)), sub(`${t('wx.illum')} ${iso(Math.round(m.fraction * 100) + '%')}`)),
        h('span', { class: 'wx-moon-img', html: moonSVG(m.phase, m.fraction, 52, d.location.lat < 0) })),
      note(ev ? t('wx.' + ev[0], { time: f.time(ev[1]) }) : m.up ? t('wx.upAllDay') : m.down ? t('wx.downAllDay')
        : m.idx === 4 && m.new ? `${t('wx.nextNew')} · ${f.date(m.new)}` : m.full ? `${t('wx.nextFull')} · ${f.date(m.full)}` : '')));
  }
  // pressure
  if (c.pressure != null) {
    const tr = pressureTrend(d);
    out.push(tile('pressure', 'gauge', t('wx.pressure'), h('span', { class: 'wx-pres-b', html: pressureSVG(c.pressure, tr, 104) }),
      note(t(tr > 0 ? 'wx.pres.rising' : tr < 0 ? 'wx.pres.falling' : 'wx.pres.steady'))));
  }
  // visibility
  if (c.vis != null) {
    const v = distParts(c.vis);
    out.push(tile('visibility', 'eye', t('wx.visibility'), big(v.value, v.unit), sub(t('wx.vis.' + visLevel(c.vis))), note(visNote(c.vis, c.code))));
  }
  // dew point
  if (c.dew != null) out.push(tile('dew', 'dewdrop', t('wx.dew'), big(fmtTemp(c.dew)), sub(t('wx.dew.' + dewLevel(c.dew))), note(c.humidity != null ? `${t('wx.humidity')} ${iso(Math.round(c.humidity) + '%')}` : '')));
  // precipitation
  const pf = precipFacts(d);
  if (pf.known) {
    const p = precipParts(pf.past);
    const nx = pf.next >= 0.1 ? t('wx.next24', { v: fmtPrecip(pf.next) }) : pf.nextDay > 0 ? t('wx.nextOn', { v: fmtPrecip(d.daily[pf.nextDay].precip), day: f.wdLong(d.daily[pf.nextDay].date + 12 * H) }) : t('wx.noneExpected');
    out.push(tile('precip', 'umbrella', t('wx.precip'), big(p.value, p.unit), sub(t('wx.last24')), note(nx)));
  }
  return h('div', { class: 'wx-grid' }, out);
}

/** Sun altitude path over a local day (for the Sunrise & sunset page); x mirrored in Arabic. */
export function sunPathSVG(d, i, { w = 640, hgt = 190, now = Date.now() } = {}) {
  const day = d.daily[i], a = day.date, N = 48, pts = [];
  let max = 1, min = -1;
  for (let k = 0; k <= N; k++) {
    const alt = sunAltitude(a + (k / N) * 864e5, d.location.lat, d.location.lon);
    pts.push(alt);
    max = Math.max(max, alt);
    min = Math.min(min, alt);
  }
  const rtl = isRtl(), X = (q) => (rtl ? 1 - q : q) * w;
  const top = 10, bottom = hgt - 10, horizon = top + ((bottom - top) * max) / (max - min);
  const Y = (alt) => top + ((bottom - top) * (max - alt)) / (max - min);
  const path = pts.map((alt, k) => `${k ? 'L' : 'M'}${X(k / N).toFixed(1)} ${Y(alt).toFixed(1)}`).join('');
  let sun = '';
  if (now >= a && now < a + 864e5) {
    const q = (now - a) / 864e5, alt = sunAltitude(now, d.location.lat, d.location.lon);
    sun = `<circle class="sp-sun${alt < 0 ? ' below' : ''}" cx="${X(q).toFixed(1)}" cy="${Y(alt).toFixed(1)}" r="7"/>`;
  }
  const id = 'sp' + Math.random().toString(36).slice(2, 7);
  return `<svg class="wx-sunpath" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="${id}a"><rect x="0" y="0" width="${w}" height="${horizon.toFixed(1)}"/></clipPath><clipPath id="${id}b"><rect x="0" y="${horizon.toFixed(1)}" width="${w}" height="${hgt}"/></clipPath></defs>
    <path d="${path}" class="sp-day" clip-path="url(#${id}a)"/><path d="${path}" class="sp-night" clip-path="url(#${id}b)"/>
    <line x1="0" x2="${w}" y1="${horizon.toFixed(1)}" y2="${horizon.toFixed(1)}" class="sp-hz"/>${sun}</svg>`;
}
