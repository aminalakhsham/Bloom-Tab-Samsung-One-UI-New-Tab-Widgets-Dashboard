// Weather data model, pure (no DOM, no i18n): Open-Meteo responses → the cache shape every reader uses, the
// condition kinds, day/hour indexing, sky phase, rain-soon detection, unit conversions, air-quality scales and
// pressure trends. js/services/weather.js, the Weather UI, js/bg/weather.js (rain alerts) and the plain-node test
// .dev/weather-model.mjs all import it.
//
// Cache shape (store key `weather` for the main location, `weatherMore[placeId]` for the others), v: 2:
//   { v, fetchedAt, location: { id, name, lat, lon, auto }, timezone, utcOffset,
//     current: { temp, code, isDay, feels, humidity, wind, windDir, gust, uv, high, low, pressure, vis, dew, precip, cloud },
//     hourly: [{ time, temp, code, isDay, pop }] (25 from the hour of the fetch; kept for older readers),
//     daily: [{ date, min, max, code, pop, sunrise, sunset, uv, precip, windMax, gustMax, windDir, daylight }] (today first),
//     series: { t, temp, feels, code, day, pop, precip, hum, dew, uv, wind, gust, dir, pres, vis } (columns, every hour
//       from 25 h ago to the last forecast day), minutely: { t, p } | null (15-minute precipitation, next 2 h),
//     yesterday: day | null, aqi: { us, eu, pm25, pm10, o3, no2, so2, co, hours: { t, us, eu } } | null }
// Units are always °C, km/h, mm, hPa and metres; the UI converts for display.

export const VERSION = 2;
const H = 36e5, DAY = 864e5;

// ——— conditions ———
/** WMO weather interpretation code → clear | partly | cloudy | fog | drizzle | rain | snow | thunder. */
export function weatherKind(code) {
  if (code == null) return 'cloudy';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}
export const isWet = (code) => ['drizzle', 'rain', 'thunder', 'snow'].includes(weatherKind(code));

// ——— parsing ———
const num = (v, d = 1) => (v == null || Number.isNaN(+v) ? null : Math.round(+v * 10 ** d) / 10 ** d);
const col = (a, n, d = 1) => Array.from({ length: n }, (_, i) => num(a?.[i], d));

/** Air-quality response → { us, eu, pm25, …, hours } (null when the service has no index for the place). */
export function parseAir(j, from = 0) {
  const C = j?.current, A = j?.hourly;
  if (!C || (C.us_aqi == null && C.european_aqi == null)) return null;
  const T = (A?.time || []).map((x) => x * 1000), keep = [];
  T.forEach((ms, i) => ms >= from && keep.push(i));
  const pick = (arr) => keep.map((i) => num(arr?.[i], 0));
  return {
    us: num(C.us_aqi, 0), eu: num(C.european_aqi, 0), pm25: num(C.pm2_5), pm10: num(C.pm10), o3: num(C.ozone, 0),
    no2: num(C.nitrogen_dioxide, 0), so2: num(C.sulphur_dioxide, 0), co: num(C.carbon_monoxide, 0),
    hours: { t: keep.map((i) => T[i]), us: pick(A?.us_aqi), eu: pick(A?.european_aqi) },
  };
}

/**
 * Forecast (and optional air-quality) response → the cache shape above.
 * loc: { id, name, lat, lon, auto } — the name falls back to the city of the response's time zone.
 */
export function normalize(j, aq, loc = {}, now = Date.now()) {
  const Hh = j.hourly || {}, D = j.daily || {}, C = j.current || {};
  const T = (Hh.time || []).map((x) => x * 1000);
  // keep every hour from 25 hours ago (precipitation in the last 24 h) to the end of the forecast
  let s0 = T.findIndex((ms) => ms >= now - 25 * H);
  if (s0 < 0) s0 = T.length;
  const n = T.length - s0, sl = (a) => (a || []).slice(s0);
  const series = {
    t: T.slice(s0), temp: col(sl(Hh.temperature_2m), n), feels: col(sl(Hh.apparent_temperature), n), code: col(sl(Hh.weather_code), n, 0),
    day: col(sl(Hh.is_day), n, 0), pop: col(sl(Hh.precipitation_probability), n, 0), precip: col(sl(Hh.precipitation), n, 2),
    hum: col(sl(Hh.relative_humidity_2m), n, 0), dew: col(sl(Hh.dew_point_2m), n), uv: col(sl(Hh.uv_index), n),
    wind: col(sl(Hh.wind_speed_10m), n), gust: col(sl(Hh.wind_gusts_10m), n), dir: col(sl(Hh.wind_direction_10m), n, 0),
    pres: col(sl(Hh.pressure_msl), n), vis: col(sl(Hh.visibility), n, -2),
  };
  // days that ended before now (past_days=1) become `yesterday`; daily[0] is today for every reader
  const DT = (D.time || []).map((x) => x * 1000);
  const ends = (i) => DT[i + 1] ?? DT[i] + DAY;
  let first = DT.findIndex((ms, i) => ends(i) > now);
  if (first < 0) first = 0;
  const day = (i) => ({
    date: DT[i], min: num(D.temperature_2m_min?.[i]), max: num(D.temperature_2m_max?.[i]), code: D.weather_code?.[i] ?? null,
    pop: num(D.precipitation_probability_max?.[i], 0) ?? 0, sunrise: D.sunrise?.[i] != null ? D.sunrise[i] * 1000 : null,
    sunset: D.sunset?.[i] != null ? D.sunset[i] * 1000 : null, uv: num(D.uv_index_max?.[i]) ?? 0, precip: num(D.precipitation_sum?.[i], 2) ?? 0,
    windMax: num(D.wind_speed_10m_max?.[i]), gustMax: num(D.wind_gusts_10m_max?.[i]), windDir: num(D.wind_direction_10m_dominant?.[i], 0),
    daylight: num(D.daylight_duration?.[i], 0),
  });
  const daily = [];
  for (let i = first; i < DT.length; i++) daily.push(day(i));
  const i0 = Math.max(0, T.findIndex((ms) => ms + H > now));
  const hourly = [];
  for (let i = i0; i < Math.min(T.length, i0 + 25); i++) {
    hourly.push({ time: T[i], temp: num(Hh.temperature_2m?.[i]), code: Hh.weather_code?.[i] ?? null, isDay: !!Hh.is_day?.[i], pop: num(Hh.precipitation_probability?.[i], 0) ?? 0 });
  }
  const M = j.minutely_15;
  const tzCity = String(j.timezone || '').split('/').pop().replace(/_/g, ' ');
  const kept = i0 - s0; // index of the current hour inside `series`
  const at = (k) => (kept >= 0 && kept < n ? series[k][kept] : null);
  return {
    v: VERSION,
    fetchedAt: now,
    location: { ...loc, name: loc.name || (/^(UTC|GMT|Etc)/i.test(j.timezone || '') ? '' : tzCity) },
    timezone: j.timezone || null,
    utcOffset: j.utc_offset_seconds ?? null,
    current: {
      temp: num(C.temperature_2m), code: C.weather_code ?? null, isDay: !!C.is_day, feels: num(C.apparent_temperature ?? C.temperature_2m),
      humidity: num(C.relative_humidity_2m, 0), wind: num(C.wind_speed_10m) ?? 0, windDir: num(C.wind_direction_10m, 0),
      gust: num(C.wind_gusts_10m ?? at('gust')), uv: num(C.uv_index ?? at('uv')) ?? 0, high: daily[0]?.max ?? null, low: daily[0]?.min ?? null,
      pressure: num(C.pressure_msl ?? at('pres')), vis: num(C.visibility ?? at('vis'), -2), dew: num(C.dew_point_2m ?? at('dew')),
      precip: num(C.precipitation, 2) ?? 0, cloud: num(C.cloud_cover, 0),
    },
    hourly,
    daily,
    series,
    minutely: M?.time?.length ? { t: M.time.map((x) => x * 1000), p: M.time.map((_, i) => num(M.precipitation?.[i], 2) ?? 0) } : null,
    yesterday: first > 0 ? day(first - 1) : null,
    aqi: aq ? parseAir(aq, now - 25 * H) : null,
  };
}

/**
 * A cache written by an older version (or a test fixture) gets the fields the UI reads: `series` rebuilt from
 * `hourly`, empty extras. Returns a new object; null/errors pass through.
 */
export function upgrade(d) {
  if (!d || d.error || !d.current) return d;
  if (d.series?.t?.length && d.v >= VERSION) return d;
  const hr = d.hourly || [];
  const pick = (k, f = (x) => x) => hr.map((x) => (x[k] == null ? null : f(x[k])));
  const series = d.series?.t?.length ? d.series : {
    t: pick('time'), temp: pick('temp'), feels: pick('temp'), code: pick('code'), day: pick('isDay', (x) => +x), pop: pick('pop'),
    precip: hr.map(() => null), hum: hr.map(() => null), dew: hr.map(() => null), uv: hr.map(() => null), wind: hr.map(() => null),
    gust: hr.map(() => null), dir: hr.map(() => null), pres: hr.map(() => null), vis: hr.map(() => null),
  };
  return { minutely: null, yesterday: null, aqi: null, ...d, series, current: { ...d.current }, daily: d.daily || [] };
}

// ——— indexing ———
/** Index of the place's current day in d.daily (0 when none matches). */
export function todayIdx(d, now = Date.now()) {
  const i = (d.daily || []).findIndex((x, k) => now >= x.date && now < (d.daily[k + 1]?.date ?? x.date + DAY));
  return i < 0 ? 0 : i;
}
/** Index of the hour containing `ms` in d.series (or the last one). */
export function hourIdx(d, ms = Date.now()) {
  const T = d.series?.t || [];
  const i = T.findIndex((x) => x + H > ms);
  return i < 0 ? Math.max(0, T.length - 1) : i;
}
/** Series indices for day i of d.daily. */
export function dayRange(d, i) {
  const a = d.daily[i]?.date, b = d.daily[i + 1]?.date ?? a + DAY;
  const T = d.series?.t || [], out = [];
  if (a == null) return out;
  for (let k = 0; k < T.length; k++) if (T[k] >= a && T[k] < b) out.push(k);
  return out;
}
/** The next `n` hours from now as series indices (the first is the current hour). */
export function nextHours(d, n = 25, now = Date.now()) {
  const T = d.series?.t || [], i0 = T.findIndex((x) => x + H > now), out = [];
  if (i0 < 0) return out;
  for (let k = i0; k < Math.min(T.length, i0 + n); k++) out.push(k);
  return out;
}

/** 'day' | 'night' | 'dawn' | 'dusk' for a place at `now`, from its sunrise and sunset. */
export function skyPhase(d, now = Date.now()) {
  const day = d?.daily?.[todayIdx(d, now)];
  if (!day?.sunrise || !day?.sunset || Number.isNaN(day.sunrise)) return d?.current?.isDay === false ? 'night' : 'day';
  const near = (a) => Math.abs(now - a) < 40 * 6e4;
  if (near(day.sunrise)) return 'dawn';
  if (near(day.sunset)) return 'dusk';
  return now > day.sunrise && now < day.sunset ? 'day' : 'night';
}

// ——— rain soon (Weather insights and the rain alert) ———
const WET_MM = 0.1;
/**
 * When precipitation starts within `within` ms and it isn't raining yet: { at, kind: 'rain'|'snow'|'thunder', pop }
 * from the 15-minute data, else from hourly codes with a chance of at least 50 %. Null otherwise.
 * Works on a cache or on parseRain()'s smaller object.
 */
export function rainSoon(d, now = Date.now(), within = 2 * H) {
  if (!d) return null;
  const S = d.series || {}, T = S.t || [], M = d.minutely;
  const hourAt = (ms) => T.findIndex((x) => x + H > ms);
  const kindAt = (ms) => {
    const k = weatherKind(S.code?.[hourAt(ms)]);
    return k === 'snow' || k === 'thunder' ? k : 'rain';
  };
  const fresh = (d.fetchedAt ?? now) > now - 30 * 6e4;
  if (fresh && (d.current?.precip ?? 0) >= WET_MM) return null; // it's already raining
  // the 15-minute data is the precise one: when it covers the next two hours, it decides alone
  const im = M?.t?.length ? M.t.findIndex((x) => x + 15 * 6e4 > now) : -1;
  if (im >= 0) {
    if ((M.p[im] || 0) >= WET_MM) return null;
    for (let k = im + 1; k < M.t.length && M.t[k] <= now + within; k++) {
      if ((M.p[k] || 0) >= WET_MM) return { at: M.t[k], kind: kindAt(M.t[k]), pop: S.pop?.[hourAt(M.t[k])] ?? null };
    }
    if (M.t.at(-1) >= now + within - 15 * 6e4) return null;
  }
  const ih = hourAt(now);
  if (ih < 0) return null;
  const wetHour = (k) => isWet(S.code?.[k]) && (S.pop?.[k] ?? 0) >= 50;
  if ((fresh && isWet(d.current?.code)) || wetHour(ih)) return null;
  for (let k = ih + 1; k < T.length && T[k] <= now + within; k++) {
    if (wetHour(k)) return { at: T[k], kind: kindAt(T[k]), pop: S.pop[k] };
  }
  return null;
}

/** True while it's raining (or snowing) at `now`: the 15-minute data, else a fresh current reading or the hour's code. */
export function isRainingNow(d, now = Date.now()) {
  if (!d) return false;
  const M = d.minutely, S = d.series || {}, fresh = (d.fetchedAt ?? now) > now - 30 * 6e4;
  if (fresh && (d.current?.precip ?? 0) >= WET_MM) return true;
  const im = M?.t?.length ? M.t.findIndex((x) => x + 15 * 6e4 > now) : -1;
  if (im >= 0) return (M.p[im] || 0) >= WET_MM;
  const ih = (S.t || []).findIndex((x) => x + H > now);
  return (fresh && isWet(d.current?.code)) || (ih >= 0 && isWet(S.code?.[ih]) && (S.pop?.[ih] ?? 0) >= 50);
}

/** The service worker's small forecast request → { fetchedAt, current, series, minutely } for rainSoon(). */
export function parseRain(j, now = Date.now()) {
  const Hh = j?.hourly || {}, M = j?.minutely_15;
  return {
    fetchedAt: now,
    current: { code: j?.current?.weather_code ?? null, precip: j?.current?.precipitation ?? 0 },
    series: { t: (Hh.time || []).map((x) => x * 1000), code: Hh.weather_code || [], pop: Hh.precipitation_probability || [], precip: Hh.precipitation || [] },
    minutely: M?.time?.length ? { t: M.time.map((x) => x * 1000), p: M.precipitation || [] } : null,
  };
}

// ——— units (data in °C, km/h, mm, hPa, m) ———
export const convTemp = (c, unit) => (c == null ? null : unit === 'f' ? c * 1.8 + 32 : c);
/** Beaufort force 0–12 for a speed in km/h. */
export function beaufort(kmh) {
  const lim = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const i = lim.findIndex((x) => kmh < x);
  return i < 0 ? 12 : i;
}
export function convWind(kmh, unit) {
  if (kmh == null) return null;
  if (unit === 'mph') return kmh * 0.621371;
  if (unit === 'ms') return kmh / 3.6;
  if (unit === 'kn') return kmh * 0.539957;
  if (unit === 'bft') return beaufort(kmh);
  return kmh;
}
export function convPressure(hpa, unit) {
  if (hpa == null) return null;
  if (unit === 'inhg') return hpa * 0.02953;
  if (unit === 'mmhg') return hpa * 0.750062;
  if (unit === 'kpa') return hpa / 10;
  return hpa;
}
export const convPrecip = (mm, unit) => (mm == null ? null : unit === 'in' ? mm / 25.4 : mm);
export const convDist = (m, unit) => (m == null ? null : unit === 'mi' ? m / 1609.344 : m / 1000);
/** Decimals worth showing for a unit. */
export const UNIT_DIGITS = { kmh: 0, mph: 0, ms: 1, kn: 0, bft: 0, hpa: 0, inhg: 2, mmhg: 0, kpa: 1, mm: 1, in: 2, km: 1, mi: 1 };

// ——— levels and scales ———
/** UV level key: low | moderate | high | veryHigh | extreme. */
export const uvLevel = (v) => (v < 3 ? 'low' : v < 6 ? 'moderate' : v < 8 ? 'high' : v < 11 ? 'veryHigh' : 'extreme');
/** 0…7 for N, NE, E, SE, S, SW, W, NW. */
export const compassIndex = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;

const EU_SCALE = [[20, 'good', '#50d4c8'], [40, 'fair', '#4cbf8f'], [60, 'moderate', '#e8d33f'], [80, 'poor', '#ff6a50'], [100, 'veryPoor', '#b0123f'], [Infinity, 'extremelyPoor', '#7d2181']];
const US_SCALE = [[50, 'good', '#3ccb4f'], [100, 'moderate', '#f2c511'], [150, 'sensitive', '#ff8a1f'], [200, 'unhealthy', '#ff3b30'], [300, 'veryUnhealthy', '#9b44b0'], [Infinity, 'hazardous', '#7e0023']];
/**
 * The local air-quality index: European AQI for places in Europe, US AQI elsewhere.
 * → { v, eu, key ('eu'|'us'), level (key), color, pct (0…1 of the scale), scale: [[max, level, color]] } | null
 */
export function aqiInfo(d) {
  const a = d?.aqi;
  if (!a) return null;
  const eu = /^Europe\//.test(d.timezone || '') && a.eu != null;
  const v = eu ? a.eu : a.us ?? a.eu;
  if (v == null || Number.isNaN(v)) return null;
  const useEu = eu || a.us == null;
  const scale = useEu ? EU_SCALE : US_SCALE;
  const lvl = scale.find((s) => v <= s[0]);
  return { v: Math.round(v), eu: useEu, key: useEu ? 'eu' : 'us', level: lvl[1], color: lvl[2], pct: Math.min(1, v / (useEu ? 100 : 300)), scale };
}
export const aqiLevelOf = (info, v) => (info.scale.find((s) => v <= s[0]) || info.scale.at(-1));

/** Pressure trend over the next three hours: 1 rising, −1 falling, 0 steady. */
export function pressureTrend(d, now = Date.now()) {
  const S = d.series || {}, i = hourIdx(d, now), a = S.pres?.[i], b = S.pres?.[Math.min((S.pres?.length || 1) - 1, i + 3)];
  if (a == null || b == null) return 0;
  return b - a > 0.6 ? 1 : a - b > 0.6 ? -1 : 0;
}

/** Precipitation in the last 24 h and in the next 24 h (mm), and the next day (index in d.daily) with some. */
export function precipFacts(d, now = Date.now()) {
  const S = d.series || {}, T = S.t || [];
  let past = 0, next = 0, known = false;
  for (let k = 0; k < T.length; k++) {
    const v = S.precip?.[k];
    if (v == null) continue;
    known = true;
    if (T[k] >= now - DAY && T[k] + H <= now + 1) past += v;
    else if (T[k] + H > now && T[k] < now + DAY) next += v;
  }
  const ti = todayIdx(d, now);
  const nextDay = (d.daily || []).findIndex((x, i) => i > ti && (x.precip || 0) >= 0.1);
  return { past: Math.round(past * 100) / 100, next: Math.round(next * 100) / 100, nextDay, known };
}

// ——— colours ———
const TEMP_STOPS = [[-20, '#8f6cf4'], [-8, '#5a7cf6'], [0, '#3fa2f7'], [8, '#4fd0e4'], [14, '#6bd89a'], [19, '#c5e15a'], [24, '#fbd43c'], [29, '#fb9a2c'], [34, '#f4542f'], [40, '#d7263d']];
const lerpHex = (a, b, f) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - f) + parseInt(b.slice(1 + i, 3 + i), 16) * f).toString(16).padStart(2, '0')).join('');
/** Colour of a temperature in °C on a cold → hot scale (temperature range bars and charts). */
export function tempColor(c) {
  if (c <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [b, cb] = TEMP_STOPS[i], [a, ca] = TEMP_STOPS[i - 1];
    if (c <= b) return lerpHex(ca, cb, (c - a) / (b - a));
  }
  return TEMP_STOPS.at(-1)[1];
}

// ——— places ———
export const HERE = 'here';
/** A stable id for a city from its coordinates (so the same city found twice is one place). */
export const cityId = (lat, lon) => `c_${(+lat).toFixed(3)}_${(+lon).toFixed(3)}`;
/** True when two coordinates are the same place (about a kilometre). */
export const samePlace = (a, b) => a?.lat != null && b?.lat != null && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

/**
 * The ordered places from the stored list and settings.location (the main location, always first):
 * [{ id: 'here' } | { id, name, region, country, lat, lon }]. Settings › Weather and older versions only know
 * settings.location, so it wins: the matching place moves to the front, or is added there.
 */
export function orderPlaces(saved, main) {
  const list = (Array.isArray(saved) ? saved : []).filter((p) => p && (p.id === HERE || (p.lat != null && p.lon != null && p.id)));
  const seen = new Set();
  const uniq = list.filter((p) => !seen.has(p.id) && seen.add(p.id));
  if (main?.lat != null) {
    const i = uniq.findIndex((p) => p.id !== HERE && samePlace(p, main));
    const head = i >= 0 ? uniq.splice(i, 1)[0] : { id: cityId(main.lat, main.lon), name: main.name || '', region: main.region || '', country: main.country || '', lat: main.lat, lon: main.lon };
    return [head, ...uniq];
  }
  const i = uniq.findIndex((p) => p.id === HERE);
  if (i >= 0) uniq.splice(i, 1);
  return [{ id: HERE }, ...uniq];
}
