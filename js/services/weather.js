// Open-Meteo weather client: the main location's forecast in store `weather` (Lock screen, widgets, Now Brief,
// Daily Board and Routines read it), the other saved places' forecasts in `weatherMore` ({ [placeId]: cache }),
// the place list in `weatherPlaces` and unit/alert preferences in `weatherPrefs`. Each forecast is cached for
// 30 minutes. The cache shape and the pure logic live in js/weather/model.js.
//   const w = await getWeather();          // main location: cache shape, or { error: 'location' | 'network', message }
//   weatherInfo(w.current.code, w.current.isDay)  -> { label, icon: svgString, kind }
//   fmtTemp(w.current.temp)                -> "23°" in the user's unit
//   places() -> [{ id: 'here' } | { id, name, region, country, lat, lon }], the first one is the main location
import { store, setting, setSetting } from '../core/store.js';
import { addStrings, t, lang, locale, use12h } from '../core/i18n.js';
import {
  weatherKind as kindOf, normalize, upgrade, orderPlaces, cityId, samePlace, HERE, convWind, convPressure, convPrecip, convDist, UNIT_DIGITS,
} from '../weather/model.js';

export { HERE } from '../weather/model.js';
export const weatherKind = kindOf;

const TTL = 30 * 60e3;
const GEO_TTL = 6 * 3600e3;
export const MAX_PLACES = 15;
const inflight = new Map(); // place id -> promise

// ——— labels ———
const LABEL = {
  0: 'wx.c.clear', 1: 'wx.c.mainlyClear', 2: 'wx.c.partly', 3: 'wx.c.overcast',
  45: 'wx.c.fog', 48: 'wx.c.fog',
  51: 'wx.c.drizzle', 53: 'wx.c.drizzle', 55: 'wx.c.drizzle', 56: 'wx.c.freezingDrizzle', 57: 'wx.c.freezingDrizzle',
  61: 'wx.c.lightRain', 63: 'wx.c.rain', 65: 'wx.c.heavyRain', 66: 'wx.c.freezingRain', 67: 'wx.c.freezingRain',
  71: 'wx.c.lightSnow', 73: 'wx.c.snow', 75: 'wx.c.heavySnow', 77: 'wx.c.snow',
  80: 'wx.c.showers', 81: 'wx.c.showers', 82: 'wx.c.heavyShowers', 85: 'wx.c.snowShowers', 86: 'wx.c.snowShowers',
  95: 'wx.c.thunder', 96: 'wx.c.thunderHail', 99: 'wx.c.thunderHail',
};
/** Condition name; a clear sky is "Sunny" by day and "Clear" at night, as in Samsung Weather. */
export function condLabel(code, isDay = true) {
  if (isDay && code === 0) return t('wx.c.sunny');
  if (isDay && code === 1) return t('wx.c.mostlySunny');
  return t(LABEL[code] || 'wx.c.overcast');
}

// ——— skies ———
const SKY = {
  day: {
    clear: ['#1569e0', '#3f92f2', '#8fcaff'], partly: ['#2a72d6', '#5b9ae6', '#a5ccf0'], cloudy: ['#58708f', '#7f95b0', '#aebdd0'],
    fog: ['#6d7a8a', '#94a0ae', '#c3cad3'], drizzle: ['#4b6383', '#6c839f', '#97a9bf'], rain: ['#2f4560', '#4c6381', '#7489a4'],
    snow: ['#6a8bb5', '#93aed0', '#c9d8ea'], thunder: ['#232a44', '#3b4265', '#5f668b'],
  },
  night: {
    clear: ['#060d2b', '#13225a', '#2c4285'], partly: ['#0b1433', '#1b2a58', '#38497e'], cloudy: ['#151b29', '#283244', '#435069'],
    fog: ['#1d232c', '#353d49', '#545d6a'], drizzle: ['#111a28', '#233144', '#3d4c62'], rain: ['#0d1420', '#1d2838', '#344257'],
    snow: ['#1f2b44', '#36466a', '#5b6d92'], thunder: ['#0a0c16', '#1a1d30', '#30344c'],
  },
  dawn: { clear: ['#28468f', '#a07cb8', '#ffb98a'], cloudy: ['#3f4b6b', '#8a7d98', '#d4a48f'] },
  dusk: { clear: ['#1d3474', '#a35d8c', '#ff9a62'], cloudy: ['#323b5a', '#76607e', '#c08778'] },
};
/** Sky colours [top, middle, bottom] for a condition at a time of day ('day' | 'night' | 'dawn' | 'dusk'). */
export function skyColors(code, phase = 'day') {
  const k = kindOf(code);
  if (phase === 'dawn' || phase === 'dusk') return SKY[phase][k === 'clear' || k === 'partly' ? 'clear' : 'cloudy'];
  return (SKY[phase] || SKY.day)[k] || SKY.day.cloudy;
}
/** Background gradient for a condition, shared by the app, the widgets and the shell. */
export function skyGradient(code, isDay = true, phase = isDay ? 'day' : 'night') {
  const [a, b, c] = skyColors(code, phase);
  return `linear-gradient(170deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}

// ——— icons ———
let gid = 0;
const SUN = (id, cx = 32, cy = 32, r = 13) => `
  <defs><radialGradient id="s${id}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe680"/><stop offset=".6" stop-color="#ffc21a"/><stop offset="1" stop-color="#ff9a1a"/></radialGradient></defs>
  <g stroke="#ffc533" stroke-width="3.2" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, r1 = r + 5, r2 = r + 10;
    return `<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}"/>`;
  }).join('')}</g>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#s${id})"/>`;
const MOON = (id, cx = 30, cy = 30, r = 16) => `
  <defs><linearGradient id="m${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6cf"/><stop offset="1" stop-color="#ffd76a"/></linearGradient>
  <mask id="mk${id}"><rect width="64" height="64" fill="#fff"/><circle cx="${cx + r * 0.62}" cy="${cy - r * 0.42}" r="${r * 0.9}" fill="#000"/></mask></defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#m${id})" mask="url(#mk${id})"/>`;
const CLOUD = (id, dark = false, dx = 0, dy = 0) => `
  <defs><linearGradient id="c${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark ? '#c3cad6' : '#ffffff'}"/><stop offset="1" stop-color="${dark ? '#8d97a8' : '#dfe7f2'}"/></linearGradient></defs>
  <path transform="translate(${dx} ${dy})" d="M19 48h28a10 10 0 0 0 1.4-19.9A14 14 0 0 0 21.6 25 11.5 11.5 0 0 0 19 48Z" fill="url(#c${id})"/>`;
const DROPS = (n = 3, color = '#5fb4ff') =>
  `<g stroke="${color}" stroke-width="3.2" stroke-linecap="round">${Array.from({ length: n }, (_, i) => {
    const x = 24 + i * (16 / Math.max(1, n - 1)) * (n === 1 ? 0 : 1);
    return `<line x1="${x}" y1="52" x2="${x - 3}" y2="59"/>`;
  }).join('')}</g>`;

export function weatherIcon(code, isDay = true) {
  const id = ++gid;
  const k = kindOf(code);
  let body;
  switch (k) {
    case 'clear':
      body = isDay ? SUN(id) : MOON(id, 32, 32, 17);
      break;
    case 'partly':
      body = (isDay ? SUN(id, 24, 24, 11) : MOON(id, 24, 22, 12)) + CLOUD(id, false, 4, 4);
      break;
    case 'cloudy':
      body = `<g opacity=".7">${CLOUD(id + 'b', true, 8, -8)}</g>` + CLOUD(id, false, -2, 2);
      break;
    case 'fog':
      body = CLOUD(id, false, 0, -6) + `<g stroke="#e6ecf4" stroke-width="3.2" stroke-linecap="round"><line x1="14" y1="49" x2="50" y2="49"/><line x1="20" y1="56" x2="44" y2="56"/></g>`;
      break;
    case 'drizzle':
      body = CLOUD(id, false, 0, -6) + `<g fill="#5fb4ff"><circle cx="24" cy="52" r="2.2"/><circle cx="33" cy="56" r="2.2"/><circle cx="42" cy="52" r="2.2"/></g>`;
      break;
    case 'rain':
      body = CLOUD(id, true, 0, -6) + DROPS(3);
      break;
    case 'snow':
      body = CLOUD(id, false, 0, -6) + `<g fill="#ffffff" stroke="#b8d8ff" stroke-width="1"><circle cx="23" cy="53" r="3"/><circle cx="33" cy="58" r="3"/><circle cx="43" cy="53" r="3"/></g>`;
      break;
    case 'thunder':
      body = CLOUD(id, true, 0, -8) + `<path d="M34 42 26 54h7l-3 9 10-13h-7l3-8Z" fill="#ffd23f" stroke="#ffb31a" stroke-width="1" stroke-linejoin="round"/>`;
      break;
  }
  return `<svg class="wx-ico" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
}

export function weatherInfo(code, isDay = true) {
  return { label: condLabel(code, isDay), icon: weatherIcon(code, isDay), kind: kindOf(code) };
}

// ——— preferences and units ———
const PREF_DEFAULTS = { wind: 'auto', pressure: 'auto', precip: 'auto', dist: 'auto', rainAlert: false };
export const prefs = () => ({ ...PREF_DEFAULTS, ...(store.get('weatherPrefs') || {}) });
export const setPref = (k, v) => store.update('weatherPrefs', (p) => ({ ...(p || {}), [k]: v }));

export const tempUnit = () => (setting('tempUnit') === 'f' ? 'f' : 'c');
// "Auto" follows the temperature unit: Fahrenheit people get mph, inches and miles.
const auto = (v, ok, us, metric) => (ok.includes(v) ? v : tempUnit() === 'f' ? us : metric);
export const windUnit = () => auto(prefs().wind, ['kmh', 'mph', 'ms', 'kn'], 'mph', 'kmh');
export const pressureUnit = () => auto(prefs().pressure, ['hpa', 'inhg', 'mmhg', 'kpa'], 'inhg', 'hpa');
export const precipUnit = () => auto(prefs().precip, ['mm', 'in'], 'in', 'mm');
export const distUnit = () => auto(prefs().dist, ['km', 'mi'], 'mi', 'km');
export const unitLabel = (u) => t('wx.u.' + u);
export const UNIT_CHOICES = { wind: ['kmh', 'mph', 'ms', 'kn'], pressure: ['hpa', 'inhg', 'mmhg', 'kpa'], precip: ['mm', 'in'], dist: ['km', 'mi'] };
/** What "Auto" picks for a unit right now. */
export const autoUnit = (key) => ({ wind: ['mph', 'kmh'], pressure: ['inhg', 'hpa'], precip: ['in', 'mm'], dist: ['mi', 'km'] })[key][tempUnit() === 'f' ? 0 : 1];

/** "1.5", "12" (decimals by unit; whole numbers lose the ".0"). */
const numText = (v, digits) => (v == null || Number.isNaN(v) ? '--' : String(+v.toFixed(digits)));
const iso = (s) => `⁦${s}⁩`;

export function fmtTemp(celsius, { unit = tempUnit(), withUnit = false } = {}) {
  if (celsius == null || Number.isNaN(celsius)) return '--°';
  const v = unit === 'f' ? celsius * 1.8 + 32 : celsius;
  // isolate so "28°" never flips to "°28" inside Arabic text
  return iso(`${Math.round(v)}°${withUnit ? unit.toUpperCase() : ''}`);
}
/** A temperature in the user's unit as a rounded number (charts and sentences). */
export const tempValue = (c) => (c == null ? null : Math.round(tempUnit() === 'f' ? c * 1.8 + 32 : c));

/** { value, unit } for a measurement in the data's unit, converted to the chosen one. */
export function windParts(kmh, unit = windUnit()) {
  return { value: numText(convWind(kmh, unit), UNIT_DIGITS[unit]), unit: unitLabel(unit) };
}
export function pressureParts(hpa, unit = pressureUnit()) {
  return { value: numText(convPressure(hpa, unit), UNIT_DIGITS[unit]), unit: unitLabel(unit) };
}
export function precipParts(mm, unit = precipUnit()) {
  const v = convPrecip(mm, unit);
  const small = unit === 'in' ? 0.01 : 0.1;
  return { value: v > 0 && v < small ? numText(small, UNIT_DIGITS[unit]) : numText(v, UNIT_DIGITS[unit]), unit: unitLabel(unit) };
}
export function distParts(m, unit = distUnit()) {
  const v = convDist(m, unit);
  return { value: numText(v, v != null && v >= 10 ? 0 : 1), unit: unitLabel(unit) };
}
const join = (p) => iso(`${p.value} ${p.unit}`);
export const fmtWind = (kmh) => join(windParts(kmh));
export const fmtPressure = (hpa) => join(pressureParts(hpa));
export const fmtPrecip = (mm) => join(precipParts(mm));
export const fmtDist = (m) => join(distParts(m));

/** Formatters in a place's own time zone (cities around the world show their local time). */
export function tzFmt(d) {
  const tz = d?.timezone;
  const F = (o) => {
    try {
      return new Intl.DateTimeFormat(locale(), tz ? { ...o, timeZone: tz } : o);
    } catch {
      return new Intl.DateTimeFormat(locale(), o);
    }
  };
  const h12 = use12h();
  const cache = {};
  const f = (k, o) => (cache[k] ||= F(o));
  return {
    time: (ms) => f('t', { hour: 'numeric', minute: '2-digit', hour12: h12 }).format(ms),
    hour: (ms) => f('h', { hour: 'numeric', hour12: h12 }).format(ms),
    wd: (ms) => f('w', { weekday: 'short' }).format(ms),
    wdLong: (ms) => f('W', { weekday: 'long' }).format(ms),
    dayNum: (ms) => f('d', { day: 'numeric' }).format(ms),
    date: (ms) => f('D', { month: 'numeric', day: 'numeric' }).format(ms),
    dateLong: (ms) => f('L', { weekday: 'long', month: 'long', day: 'numeric' }).format(ms),
    monthYear: (ms) => f('M', { month: 'long', year: 'numeric' }).format(ms),
    hourOf: (ms) => +f('H', { hour: 'numeric', hourCycle: 'h23' }).formatToParts(ms).find((p) => p.type === 'hour').value % 24,
  };
}

// ——— places ———
/** The ordered places; the first is the main location (Lock screen, widgets, Now Brief, Routines). */
export const places = () => orderPlaces(store.get('weatherPlaces'), setting('location'));
const usable = (w) => !!(w && !w.error && w.current);

/** A place's name for lists and titles ("Current location" until the device's position has a forecast). */
export function placeName(p, data) {
  if (!p) return '';
  if (p.id === HERE) return data?.location?.name || t('wx.currentLocation');
  return p.name || data?.location?.name || '';
}

/** The forecast cached for a place right now (upgraded to the current shape), or null. */
export function peekPlace(p, list = places()) {
  if (!p) return null;
  const main = list[0]?.id === p.id;
  const w = main ? store.get('weather') : (store.get('weatherMore') || {})[p.id];
  // right after Settings › Weather picks another city, `weather` still holds the old place until it's fetched again
  if (main && usable(w) && !sameLocation(w, setting('location'))) return null;
  return usable(w) ? upgrade(w) : null;
}

const cleanPlace = (p) => (p.id === HERE ? { id: HERE } : { id: p.id || cityId(p.lat, p.lon), name: p.name || '', region: p.region || '', country: p.country || '', lat: +p.lat, lon: +p.lon });

/**
 * Saves a new order (or a shorter list). When the main location changes, the forecasts move with it:
 * the new main one's cached forecast becomes `weather`, the old main one's goes to `weatherMore`.
 */
export function setPlaces(list) {
  const next = list.map(cleanPlace).slice(0, MAX_PLACES + 1);
  if (!next.length) return;
  const before = places();
  const more = { ...(store.get('weatherMore') || {}) };
  if (before[0]?.id !== next[0].id) {
    const w = store.get('weather');
    if (usable(w) && before[0] && next.some((p) => p.id === before[0].id)) more[before[0].id] = w;
    const fresh = more[next[0].id];
    delete more[next[0].id];
    store.set('weather', usable(fresh) ? fresh : null);
  }
  const ids = new Set(next.map((p) => p.id));
  for (const id of Object.keys(more)) if (!ids.has(id) || id === next[0].id) delete more[id];
  store.set('weatherMore', more);
  store.set('weatherPlaces', next);
  const main = next[0];
  const loc = main.id === HERE ? null : { name: main.name, lat: main.lat, lon: main.lon };
  if (JSON.stringify(setting('location')) !== JSON.stringify(loc)) setSetting('location', loc);
}

/**
 * Adds a city (with the forecast already loaded for its preview, if any). It goes to the end of the list, except
 * when the main location is the device's position and that has no forecast (location off): then the city takes
 * its place, as the user clearly wants weather for somewhere. Returns the place.
 */
export function addPlace(city, data) {
  const list = places();
  const dup = list.find((p) => p.id !== HERE && samePlace(p, city));
  if (dup) return dup;
  const p = cleanPlace(city);
  const replaceHere = list[0]?.id === HERE && !usable(store.get('weather'));
  const next = replaceHere ? [p, ...list.slice(1)] : [...list, p];
  // setPlaces() moves it to `weather` when the city becomes the main location
  if (usable(data)) store.update('weatherMore', (m) => ({ ...(m || {}), [p.id]: { ...data, location: { ...data.location, id: p.id, name: p.name, lat: p.lat, lon: p.lon, auto: false } } }));
  setPlaces(next);
  return p;
}

/** Removes a place (never the last one). */
export function removePlaces(ids) {
  const next = places().filter((p) => !ids.includes(p.id));
  if (!next.length) return false;
  setPlaces(next);
  return true;
}

/** "Use current location" on puts the device's position first; off removes it (when another place is left). */
export function setUseCurrent(on) {
  const list = places(), has = list.some((p) => p.id === HERE);
  if (on && !has) setPlaces([{ id: HERE }, ...list]);
  else if (on && list[0].id !== HERE) setPlaces([{ id: HERE }, ...list.filter((p) => p.id !== HERE)]);
  else if (!on && has && list.length > 1) setPlaces(list.filter((p) => p.id !== HERE));
}

// ——— fetching ———
function sameLocation(cache, loc) {
  if (!cache?.location) return false;
  if (!loc) return !!cache.location.auto;
  return Math.abs(cache.location.lat - loc.lat) < 0.01 && Math.abs(cache.location.lon - loc.lon) < 0.01;
}

function geolocate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(e),
      { timeout: 12000, maximumAge: GEO_TTL }
    );
  });
}

async function hereLocation(cache) {
  if (cache?.location?.auto && Date.now() - (cache.location.at || 0) < GEO_TTL) return cache.location;
  const pos = await geolocate();
  return { ...pos, id: HERE, auto: true, at: Date.now(), name: '' };
}

const FORECAST = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,pressure_msl,visibility,dew_point_2m',
  hourly: 'temperature_2m,apparent_temperature,weather_code,is_day,precipitation_probability,precipitation,relative_humidity_2m,dew_point_2m,uv_index,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,visibility',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,daylight_duration,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
};

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Forecast + air quality for coordinates (no caching). Air quality is optional: null when it fails. */
export async function fetchForecast(loc) {
  const at = { latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: 'auto', timeformat: 'unixtime' };
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    ...at, ...FORECAST, forecast_days: '10', past_days: '1',
    minutely_15: 'precipitation', forecast_minutely_15: '8', past_minutely_15: '1',
  });
  const a = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  a.search = new URLSearchParams({
    ...at, forecast_days: '5', past_days: '1',
    current: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide', hourly: 'us_aqi,european_aqi',
  });
  const [fc, aq] = await Promise.all([getJSON(u), getJSON(a).catch(() => null)]);
  const d = normalize(fc, aq, loc);
  if (!d.location.name && !loc.auto) d.location.name = t('wx.currentLocation');
  return d;
}

/**
 * Cached forecast of the main location (refreshes after 30 min or when the location changes).
 * Resolves to the cache object, or { error: 'location' | 'network', message } when nothing usable exists.
 */
export function getWeather({ force = false } = {}) {
  const cache = store.get('weather');
  const loc = setting('location');
  const ok = usable(cache);
  if (!force && ok && sameLocation(cache, loc) && Date.now() - cache.fetchedAt < TTL) return Promise.resolve(cache);
  const key = 'main:' + (loc ? cityId(loc.lat, loc.lon) : HERE);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let where;
    try {
      where = loc?.lat != null ? { ...loc, id: cityId(loc.lat, loc.lon), auto: false } : await hereLocation(ok ? cache : null);
    } catch {
      if (ok && sameLocation(cache, loc)) return cache;
      return { error: 'location', message: t('wx.err.location') };
    }
    try {
      const w = await fetchForecast(where);
      // the main location may have changed while this was loading
      if (JSON.stringify(setting('location')) === JSON.stringify(loc)) store.set('weather', w);
      return w;
    } catch {
      if (ok && sameLocation(cache, loc)) return cache;
      return { error: 'network', message: t('wx.err.network') };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Forecast of any saved place (the main one goes through getWeather()); same result shape as getWeather(). */
export function getPlaceWeather(p, { force = false } = {}) {
  const list = places();
  if (!p || list[0]?.id === p.id) return getWeather({ force }).then(upgrade);
  const cache = (store.get('weatherMore') || {})[p.id];
  const ok = usable(cache);
  if (!force && ok && Date.now() - cache.fetchedAt < TTL) return Promise.resolve(upgrade(cache));
  if (inflight.has(p.id)) return inflight.get(p.id);
  const run = (async () => {
    let where;
    try {
      where = p.id === HERE ? await hereLocation(ok ? cache : null) : { id: p.id, name: p.name, lat: p.lat, lon: p.lon, auto: false };
    } catch {
      return ok ? upgrade(cache) : { error: 'location', message: t('wx.err.location') };
    }
    try {
      const w = await fetchForecast(where);
      if (places().some((x) => x.id === p.id) && places()[0].id !== p.id) store.update('weatherMore', (m) => ({ ...(m || {}), [p.id]: w }));
      return upgrade(w);
    } catch {
      return ok ? upgrade(cache) : { error: 'network', message: t('wx.err.network') };
    }
  })().finally(() => inflight.delete(p.id));
  inflight.set(p.id, run);
  return run;
}

/** Subscribe to forecast updates of the main location (fires with the new cache object). */
export const onWeather = (cb) => store.on('weather', cb);

/** City search for the location picker: [{ name, region, country, lat, lon }] */
export async function searchCities(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.search = new URLSearchParams({ name: q, count: '12', language: lang(), format: 'json' });
  const r = await fetch(u);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return (d.results || []).map((x) => ({ name: x.name, region: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude }));
}

addStrings({
  en: {
    'wx.c.sunny': 'Sunny', 'wx.c.mostlySunny': 'Mostly sunny',
    'wx.c.clear': 'Clear', 'wx.c.mainlyClear': 'Mostly clear', 'wx.c.partly': 'Partly cloudy', 'wx.c.overcast': 'Cloudy',
    'wx.c.fog': 'Fog', 'wx.c.drizzle': 'Drizzle', 'wx.c.freezingDrizzle': 'Freezing drizzle',
    'wx.c.lightRain': 'Light rain', 'wx.c.rain': 'Rain', 'wx.c.heavyRain': 'Heavy rain', 'wx.c.freezingRain': 'Freezing rain',
    'wx.c.lightSnow': 'Light snow', 'wx.c.snow': 'Snow', 'wx.c.heavySnow': 'Heavy snow',
    'wx.c.showers': 'Rain showers', 'wx.c.heavyShowers': 'Heavy showers', 'wx.c.snowShowers': 'Snow showers',
    'wx.c.thunder': 'Thunderstorm', 'wx.c.thunderHail': 'Thunderstorm with hail',
    'wx.currentLocation': 'Current location',
    'wx.err.location': 'Allow location or pick a city to see the weather.',
    'wx.err.network': 'Couldn’t load the weather. Check your connection.',
    'wx.u.kmh': 'km/h', 'wx.u.mph': 'mph', 'wx.u.ms': 'm/s', 'wx.u.kn': 'kn',
    'wx.u.hpa': 'hPa', 'wx.u.inhg': 'inHg', 'wx.u.mmhg': 'mmHg', 'wx.u.kpa': 'kPa',
    'wx.u.mm': 'mm', 'wx.u.in': 'in', 'wx.u.km': 'km', 'wx.u.mi': 'mi',
  },
  ar: {
    'wx.c.sunny': 'مشمس', 'wx.c.mostlySunny': 'مشمس غالبًا',
    'wx.c.clear': 'صافٍ', 'wx.c.mainlyClear': 'صافٍ غالبًا', 'wx.c.partly': 'غائم جزئيًا', 'wx.c.overcast': 'غائم',
    'wx.c.fog': 'ضباب', 'wx.c.drizzle': 'رذاذ', 'wx.c.freezingDrizzle': 'رذاذ متجمد',
    'wx.c.lightRain': 'مطر خفيف', 'wx.c.rain': 'مطر', 'wx.c.heavyRain': 'مطر غزير', 'wx.c.freezingRain': 'مطر متجمد',
    'wx.c.lightSnow': 'ثلج خفيف', 'wx.c.snow': 'ثلج', 'wx.c.heavySnow': 'ثلج كثيف',
    'wx.c.showers': 'زخات مطر', 'wx.c.heavyShowers': 'زخات غزيرة', 'wx.c.snowShowers': 'زخات ثلج',
    'wx.c.thunder': 'عاصفة رعدية', 'wx.c.thunderHail': 'عاصفة رعدية مع برد',
    'wx.currentLocation': 'الموقع الحالي',
    'wx.err.location': 'اسمح بالوصول إلى الموقع أو اختر مدينة لعرض الطقس.',
    'wx.err.network': 'تعذّر تحميل الطقس. تحقق من اتصالك.',
    'wx.u.kmh': 'كم/س', 'wx.u.mph': 'ميل/س', 'wx.u.ms': 'م/ث', 'wx.u.kn': 'عقدة',
    'wx.u.hpa': 'هكتوباسكال', 'wx.u.inhg': 'بوصة زئبقية', 'wx.u.mmhg': 'مم زئبقي', 'wx.u.kpa': 'كيلوباسكال',
    'wx.u.mm': 'مم', 'wx.u.in': 'بوصة', 'wx.u.km': 'كم', 'wx.u.mi': 'ميل',
  },
});
