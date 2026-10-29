// Plain-node test of the Weather data model (js/weather/model.js): parsing Open-Meteo forecast and air-quality
// responses into the cache, upgrading old caches, day/hour indexing, sky phase, rain-soon detection (15-minute and
// hourly data), unit conversions, air-quality scales, pressure trend, precipitation facts and the place order.
// usage: node .dev/weather-model.mjs   (exit 1 on failure)
import * as M from '../js/weather/model.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok', m); } else { fail++; console.log('FAIL', m); } };
const H = 36e5, D = 864e5;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ——— kinds ———
ok([0, 1, 2, 3, 45, 53, 63, 81, 73, 86, 95, 99].map(M.weatherKind).join() === 'clear,clear,partly,cloudy,fog,drizzle,rain,rain,snow,snow,thunder,thunder', 'WMO codes map to kinds');
ok(M.weatherKind(null) === 'cloudy' && M.isWet(61) && !M.isWet(2), 'unknown code is cloudy; rain is wet, partly cloudy is not');

// ——— a forecast response: yesterday + 10 days, hourly from yesterday 00:00, 15-minute data around now ———
const now = Date.UTC(2026, 9, 26, 14, 20); // 14:20 UTC
const day0 = Date.UTC(2026, 9, 26) / 1000, yday = day0 - 86400, sec = (ms) => Math.floor(ms / 1000);
const nH = 11 * 24, hours = Array.from({ length: nH }, (_, i) => yday + i * 3600);
const fc = {
  timezone: 'Europe/Lisbon', utc_offset_seconds: 0,
  current: { temperature_2m: 18.64, apparent_temperature: 17.9, relative_humidity_2m: 71, weather_code: 2, is_day: 1, precipitation: 0, cloud_cover: 40, wind_speed_10m: 22.3, wind_direction_10m: 270, wind_gusts_10m: 40.1, uv_index: 2.4, pressure_msl: 1013.2, visibility: 24140, dew_point_2m: 13.1 },
  hourly: {
    time: hours, temperature_2m: hours.map((_, i) => 12 + (i % 24) / 2), apparent_temperature: hours.map(() => 11), weather_code: hours.map((_, i) => (i === 24 + 17 ? 63 : 2)),
    is_day: hours.map((_, i) => +((i % 24) >= 7 && (i % 24) < 19)), precipitation_probability: hours.map((_, i) => (i === 24 + 17 ? 80 : 10)),
    precipitation: hours.map((_, i) => (i < 24 ? 0.5 : i === 24 + 17 ? 1.2 : 0)), relative_humidity_2m: hours.map(() => 70), dew_point_2m: hours.map(() => 10),
    uv_index: hours.map(() => 1), wind_speed_10m: hours.map(() => 10), wind_direction_10m: hours.map(() => 200), wind_gusts_10m: hours.map(() => 20),
    pressure_msl: hours.map((_, i) => 1010 + i * 0.4), visibility: hours.map(() => 24140),
  },
  daily: {
    time: Array.from({ length: 11 }, (_, i) => yday + i * 86400), weather_code: [61, 2, 3, 61, 0, 0, 80, 95, 71, 45, 1],
    temperature_2m_max: [19, 21, 20, 22, 23, 25, 26, 21, 9, 14, 15], temperature_2m_min: [11, 14, 13, 14, 15, 16, 17, 14, 2, 8, 9],
    precipitation_probability_max: [90, 80, 20, 10, 0, 0, 60, 80, 50, 10, 0], precipitation_sum: [12, 1.2, 0, 3, 0, 0, 5, 9, 4, 0, 0],
    sunrise: Array.from({ length: 11 }, (_, i) => yday + i * 86400 + 7 * 3600), sunset: Array.from({ length: 11 }, (_, i) => yday + i * 86400 + 18 * 3600),
    daylight_duration: Array.from({ length: 11 }, (_, i) => 39600 - i * 60), uv_index_max: [3, 3, 5, 6, 7, 7, 4, 3, 1, 2, 2],
    wind_speed_10m_max: Array(11).fill(25), wind_gusts_10m_max: Array(11).fill(45), wind_direction_10m_dominant: Array(11).fill(250),
  },
  minutely_15: { time: Array.from({ length: 9 }, (_, i) => sec(now) - (sec(now) % 900) - 900 + i * 900), precipitation: [0, 0, 0, 0.3, 0.5, 0, 0, 0, 0] },
};
const aq = {
  current: { us_aqi: 42, european_aqi: 27, pm2_5: 8.44, pm10: 15.2, ozone: 61, nitrogen_dioxide: 12, sulphur_dioxide: 2, carbon_monoxide: 180 },
  hourly: { time: hours.slice(0, 6 * 24), us_aqi: hours.slice(0, 6 * 24).map((_, i) => 30 + (i % 24)), european_aqi: hours.slice(0, 6 * 24).map((_, i) => 20 + (i % 10)) },
};
const d = M.normalize(fc, aq, { id: 'c_x', name: 'Lisbon', lat: 38.72, lon: -9.14, auto: false }, now);
ok(d.v === M.VERSION && d.fetchedAt === now && d.location.name === 'Lisbon' && d.timezone === 'Europe/Lisbon', 'version, fetch time, location and time zone');
ok(d.daily.length === 10 && d.daily[0].date === day0 * 1000 && d.daily[0].max === 21, 'past day dropped: daily[0] is today (10 days)');
ok(d.yesterday?.date === yday * 1000 && d.yesterday.precip === 12, 'yesterday kept separately');
ok(d.current.temp === 18.6 && d.current.high === 21 && d.current.low === 14 && d.current.gust === 40.1 && d.current.pressure === 1013.2 && d.current.vis === 24100 && d.current.dew === 13.1, 'current: rounded temperature, today\'s high/low, gusts, pressure, visibility (100 m), dew point');
ok(d.daily[0].sunrise === (day0 + 7 * 3600) * 1000 && d.daily[0].daylight === 39540 && d.daily[0].windDir === 250, 'daily: sunrise in ms, daylight, dominant wind');
ok(d.series.t[0] >= now - 25 * H && d.series.t[0] < now - 23 * H, 'series starts about 25 hours back');
ok(d.series.t.length === d.series.temp.length && d.series.t.length === d.series.vis.length && d.series.t.at(-1) === hours.at(-1) * 1000, 'every series column has the same length and runs to the end');
ok(d.hourly.length === 25 && d.hourly[0].time <= now && d.hourly[0].time + H > now && typeof d.hourly[0].isDay === 'boolean', 'hourly: 25 hours from the current one, booleans for is_day');
ok(d.minutely?.t.length === 9 && d.minutely.p[3] === 0.3, 'minutely precipitation kept');
ok(d.aqi && d.aqi.us === 42 && d.aqi.eu === 27 && d.aqi.pm25 === 8.4 && d.aqi.hours.t[0] >= now - 25 * H && d.aqi.hours.us.length === d.aqi.hours.t.length, 'air quality parsed (values, hours from 25 h back)');
ok(M.normalize(fc, null, {}, now).aqi === null && M.normalize(fc, { current: {} }, {}, now).aqi === null, 'no or empty air-quality answer → aqi null');
ok(M.normalize({ ...fc, timezone: 'Africa/Cairo' }, null, {}, now).location.name === 'Cairo' && M.normalize({ ...fc, timezone: 'GMT' }, null, {}, now).location.name === '', 'a nameless place is named after its time zone (not "GMT")');
const sparse = M.normalize({ timezone: 'UTC', current: { temperature_2m: 5, weather_code: 0, is_day: 0 }, hourly: { time: hours, temperature_2m: hours.map(() => 5), weather_code: hours.map(() => 0), is_day: hours.map(() => 0), precipitation_probability: hours.map(() => 0) }, daily: { time: [day0], weather_code: [0], temperature_2m_max: [7], temperature_2m_min: [1], sunrise: [day0 + 25200], sunset: [day0 + 64800] } }, null, {}, now);
ok(sparse.series.hum.every((x) => x === null) && sparse.current.gust === null && sparse.daily[0].precip === 0 && sparse.minutely === null, 'a response with few variables still parses (missing ones are null)');

// ——— upgrade ———
const v1 = { fetchedAt: now, location: { name: 'T', lat: 1, lon: 2, auto: false }, current: { temp: 20, code: 0, isDay: true }, hourly: [{ time: now, temp: 20, code: 0, isDay: true, pop: 5 }, { time: now + H, temp: 21, code: 2, isDay: false, pop: 30 }], daily: [] };
const up = M.upgrade(v1);
ok(up.series.t.length === 2 && up.series.day[1] === 0 && up.series.pop[1] === 30 && up.series.wind.every((x) => x === null) && up.aqi === null && up.minutely === null, 'an old cache gets a series built from its hourly list');
ok(M.upgrade(d) === d && M.upgrade(null) === null && M.upgrade({ error: 'network' }).error === 'network', 'current caches and errors pass through');

// ——— indexing ———
ok(M.todayIdx(d, now) === 0 && M.todayIdx(d, now + 2 * D) === 2 && M.todayIdx(d, now - 3 * D) === 0, 'todayIdx');
ok(M.dayRange(d, 0).length === 24 && M.dayRange(d, 9).length === 24 && d.series.t[M.dayRange(d, 1)[0]] === d.daily[1].date, 'dayRange: 24 hours per day, starting at local midnight');
ok(d.series.t[M.hourIdx(d, now)] === Date.UTC(2026, 9, 26, 14) && M.nextHours(d, 25, now).length === 25, 'hourIdx and nextHours');

// ——— sky phase ———
const at = (h, m = 0) => Date.UTC(2026, 9, 26, h, m);
ok(M.skyPhase(d, at(12)) === 'day' && M.skyPhase(d, at(22)) === 'night' && M.skyPhase(d, at(3)) === 'night', 'day and night from sunrise/sunset');
ok(M.skyPhase(d, at(7, 20)) === 'dawn' && M.skyPhase(d, at(17, 30)) === 'dusk', 'dawn and dusk within 40 minutes of sunrise/sunset');
ok(M.skyPhase({ current: { isDay: false }, daily: [] }) === 'night', 'without sun times: the current is_day');

// ——— rain soon ———
const soon = M.rainSoon(d, now);
ok(soon && soon.at === fc.minutely_15.time[3] * 1000 && soon.kind === 'rain', 'rain in the 15-minute data → its time');
const wetNow = { ...d, minutely: { t: d.minutely.t, p: d.minutely.p.map((_, i) => (i === 1 ? 0.4 : 0)) } };
ok(M.rainSoon(wetNow, now) === null, 'already raining → no "rain soon"');
const dry = { ...d, minutely: { t: d.minutely.t, p: d.minutely.p.map(() => 0) } };
ok(M.rainSoon(dry, now) === null, 'dry 15-minute data covering two hours → nothing, even if an hour says rain later');
const hourlyOnly = { ...d, minutely: null };
const hs = M.rainSoon(hourlyOnly, now);
ok(M.rainSoon(hourlyOnly, now, 2 * H) === null && hs === null, 'hourly fallback: the 17:00 shower is beyond two hours');
const hs3 = M.rainSoon(hourlyOnly, now, 3 * H);
ok(hs3 && hs3.at === Date.UTC(2026, 9, 26, 17) && hs3.pop === 80, 'hourly fallback with a 3-hour window finds the 17:00 shower (80 %)');
const snowy = { ...hourlyOnly, series: { ...d.series, code: d.series.code.map((c) => (c === 63 ? 73 : c)) } };
ok(M.rainSoon(snowy, now, 3 * H)?.kind === 'snow', 'snow is reported as snow');
ok(M.rainSoon({ ...hourlyOnly, current: { ...d.current, precip: 0.6 } }, now, 3 * H) === null, 'precipitation right now (fresh) → nothing');
const pr = M.parseRain({ current: { weather_code: 3, precipitation: 0 }, hourly: { time: hours, weather_code: fc.hourly.weather_code, precipitation_probability: fc.hourly.precipitation_probability }, minutely_15: fc.minutely_15 }, now);
ok(M.rainSoon(pr, now)?.at === soon.at, 'the service worker\'s small response gives the same answer');
ok(M.rainSoon(null) === null && M.rainSoon({}, now) === null, 'no data → null');

// ——— units ———
ok(near(M.convWind(100, 'mph'), 62.1371) && near(M.convWind(36, 'ms'), 10) && near(M.convWind(100, 'kn'), 53.9957) && M.convWind(10, 'kmh') === 10, 'wind conversions');
ok(M.beaufort(0) === 0 && M.beaufort(15) === 3 && M.beaufort(65) === 8 && M.beaufort(130) === 12, 'Beaufort force');
ok(near(M.convPressure(1013.25, 'inhg'), 29.921, 0.001) && near(M.convPressure(1013.25, 'mmhg'), 760, 0.01) && near(M.convPressure(1013, 'kpa'), 101.3), 'pressure conversions');
ok(near(M.convPrecip(25.4, 'in'), 1) && near(M.convDist(1609.344, 'mi'), 1) && near(M.convDist(2500, 'km'), 2.5) && near(M.convTemp(20, 'f'), 68), 'precipitation, distance and temperature conversions');
ok(M.convWind(null, 'mph') === null && M.convPressure(null) === null, 'null stays null');

// ——— levels ———
ok([0, 2.9, 3, 5.9, 6, 8, 10.9, 11].map(M.uvLevel).join() === 'low,low,moderate,moderate,high,veryHigh,veryHigh,extreme', 'UV levels');
ok([0, 44, 46, 90, 135, 180, 225, 270, 315, 359].map(M.compassIndex).join() === '0,1,1,2,3,4,5,6,7,0', 'compass points');
const eu = M.aqiInfo(d);
ok(eu && eu.eu && eu.v === 27 && eu.level === 'fair' && near(eu.pct, 0.27), 'Europe: European AQI 27 is "fair"');
const us = M.aqiInfo({ ...d, timezone: 'America/New_York' });
ok(us && !us.eu && us.v === 42 && us.level === 'good' && near(us.pct, 0.14), 'elsewhere: US AQI 42 is "good"');
ok(M.aqiInfo({ ...d, aqi: { ...d.aqi, us: 160 }, timezone: 'Asia/Dubai' }).level === 'unhealthy' && M.aqiLevelOf(us, 120)[1] === 'sensitive', 'US scale: 160 unhealthy, 120 unhealthy for sensitive groups');
ok(M.aqiInfo({ ...d, aqi: null }) === null, 'no air quality → null');

// ——— pressure, precipitation ———
ok(M.pressureTrend(d, now) === 1, 'pressure rising 0.4 hPa an hour → rising');
ok(M.pressureTrend({ ...d, series: { ...d.series, pres: d.series.pres.map(() => 1012) } }, now) === 0, 'flat pressure → steady');
const pf = M.precipFacts(d, now);
ok(near(pf.past, 0.5 * 9, 0.01) && near(pf.next, 1.2, 0.01) && pf.nextDay === 2 && pf.known, `precipitation: last 24 h ${pf.past} mm, next 24 h ${pf.next} mm, next wet day index ${pf.nextDay}`);

// ——— colours ———
ok(/^#[0-9a-f]{6}$/.test(M.tempColor(17)) && M.tempColor(-40) === '#8f6cf4' && M.tempColor(50) === '#d7263d', 'temperature colours');

// ——— places ———
const P = M.orderPlaces;
ok(JSON.stringify(P(null, null)) === '[{"id":"here"}]', 'nothing saved, no city: current location');
const lis = { id: M.cityId(38.7223, -9.1393), name: 'Lisbon', region: '', country: 'Portugal', lat: 38.7223, lon: -9.1393 };
const par = { id: M.cityId(48.85, 2.35), name: 'Paris', region: '', country: 'France', lat: 48.85, lon: 2.35 };
ok(P(null, { name: 'Lisbon', lat: 38.7223, lon: -9.1393 })[0].id === lis.id && P(null, { name: 'Lisbon', lat: 38.7223, lon: -9.1393 }).length === 1, 'settings.location only (older versions): that city');
ok(P([{ id: 'here' }, par, lis], { name: 'Lisbon', lat: 38.72231, lon: -9.13929 }).map((p) => p.id).join() === [lis.id, 'here', par.id].join(), 'the main location moves to the front');
ok(P([par, lis], null).map((p) => p.id).join() === ['here', par.id, lis.id].join(), 'settings.location null puts the current location first');
ok(P([lis, par, lis, { id: 'bad' }], { lat: 48.85, lon: 2.35 }).map((p) => p.id).join() === [par.id, lis.id].join(), 'duplicates and broken entries are dropped');
ok(M.samePlace(lis, { lat: 38.725, lon: -9.135 }) && !M.samePlace(lis, par) && !M.samePlace(null, lis), 'samePlace');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
