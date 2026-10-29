// The widgets users look at most (digital clock s/m, Weather s/m/l, Weather forecast m) with real data, at the window
// sizes laptops really have, for close visual review. usage: W=1366 H=657 .dev/run.sh .dev/widgets-focus.cjs
module.exports = async ({ page, boot, ok, sleep, shot, P, mod }) => {
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const y0 = d0.getTime() / 1000 - 86400, N = 11 * 24, hours = Array.from({ length: N }, (_, i) => y0 + i * 3600), hod = (i) => i % 24;
  const now = Math.floor(Date.now() / 1000);
  const fc = {
    timezone: TZ, utc_offset_seconds: -new Date().getTimezoneOffset() * 60,
    current: { temperature_2m: 23.4, apparent_temperature: 22.2, relative_humidity_2m: 64, weather_code: 2, is_day: 1, precipitation: 0, cloud_cover: 20, wind_speed_10m: 14, wind_direction_10m: 225, wind_gusts_10m: 31, uv_index: 5.2, pressure_msl: 1013.2, visibility: 24100, dew_point_2m: 12.1 },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => +(16 + 7 * Math.sin(((hod(i) - 9) / 24) * 2 * Math.PI)).toFixed(1)), apparent_temperature: hours.map(() => 20), weather_code: hours.map((_, i) => (i % 7 === 3 ? 61 : 2)), is_day: hours.map((_, i) => +(hod(i) >= 7 && hod(i) < 18)), precipitation_probability: hours.map((_, i) => (i * 7) % 70), precipitation: hours.map(() => 0), relative_humidity_2m: hours.map(() => 60), dew_point_2m: hours.map(() => 12), uv_index: hours.map(() => 3), wind_speed_10m: hours.map(() => 12), wind_direction_10m: hours.map(() => 200), wind_gusts_10m: hours.map(() => 25), pressure_msl: hours.map(() => 1012), visibility: hours.map(() => 20000) },
    daily: { time: Array.from({ length: 11 }, (_, i) => y0 + i * 86400), weather_code: [61, 2, 2, 3, 61, 80, 95, 71, 45, 1, 2], temperature_2m_max: [22, 26.1, 25, 24, 23, 26, 21, 19, 9, 14, 15], temperature_2m_min: [13, 15.3, 14, 13, 15, 14, 12, 2, 8, 9, 7], precipitation_probability_max: [80, 10, 20, 60, 80, 90, 40, 5, 0, 15, 0], precipitation_sum: Array(11).fill(0), sunrise: Array.from({ length: 11 }, (_, i) => y0 + i * 86400 + 6.8 * 3600), sunset: Array.from({ length: 11 }, (_, i) => y0 + i * 86400 + 17.5 * 3600), daylight_duration: Array(11).fill(39000), uv_index_max: Array(11).fill(5), wind_speed_10m_max: Array(11).fill(24), wind_gusts_10m_max: Array(11).fill(41), wind_direction_10m_dominant: Array(11).fill(250) },
    minutely_15: { time: Array.from({ length: 9 }, (_, i) => now - 900 + i * 900), precipitation: Array(9).fill(0) },
  };
  const aq = { current: { us_aqi: 42, european_aqi: 27, pm2_5: 8, pm10: 15, ozone: 61, nitrogen_dioxide: 12, sulphur_dioxide: 2, carbon_monoxide: 180 }, hourly: { time: hours.slice(0, 120), us_aqi: hours.slice(0, 120).map(() => 40), european_aqi: hours.slice(0, 120).map(() => 25) } };
  const loc = { name: 'Amman', lat: 31.95, lon: 35.93 };
  await boot({ settings: { location: loc, hour12: process.env.H12 === '1' } }); // 24-hour time unless H12=1
  const cache = await mod('./js/weather/model.js', 'normalize', fc, aq, loc);
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });
  // the alarm next to the medium clock: one enabled alarm
  const home = [[W('c1', 'clock-digital', 's'), W('c2', 'clock-digital', 'm'), W('w1', 'weather', 's'), W('w2', 'weather', 'm')], [W('f1', 'focus', 's'), W('w4', 'weather-forecast', 'm'), W('w3', 'weather', 'l')]];
  await page.evaluate(([c, home]) => chrome.storage.local.set({ weather: { ...c, fetchedAt: Date.now() }, home,
    alarms: [{ id: 'a1', time: '07:30', days: [1, 2, 3, 4, 5], label: 'Work', enabled: true }] }), [cache, home]);
  await sleep(1500);
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.goPage(0, true)));
  await sleep(900);
  await shot(P + 'focus-1');
  // nothing cut off at the bottom and no "null"/"undefined" text in these widgets
  const probs = await page.evaluate(() => [...document.querySelectorAll('.widget-tile .wg')].flatMap((box) => {
    const r = box.getBoundingClientRect(), out = [];
    if (/\b(null|undefined|NaN)\b/.test(box.innerText)) out.push(box.className + ': shows null/undefined');
    for (const el of box.querySelectorAll('.wgw-hour-v, .wgw-hour-i, .wgc-date, .wgc-alarm-s, .wfc-col-v, .focus-btn')) {
      const q = el.getBoundingClientRect();
      if (q.height && q.bottom > r.bottom - 2) out.push(box.className + ': ' + el.className + ' cut off at the bottom');
    }
    return out;
  }));
  for (const p of probs) ok(false, p);
  const m = await page.evaluate(() => ['c1', 'c2', 'w1', 'w2'].map((id) => { const b = document.querySelector(`[data-id="${id}"] .wg`).getBoundingClientRect(); return id + ' ' + Math.round(b.width) + '×' + Math.round(b.height); }));
  console.log('sizes', m.join(', '));
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.goPage(1, true)));
  await sleep(900);
  await shot(P + 'focus-2');
  ok(true, 'shots taken');
};
