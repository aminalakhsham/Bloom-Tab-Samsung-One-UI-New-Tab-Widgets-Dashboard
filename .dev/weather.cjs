// triple
// Samsung Weather end to end without the network. The page's fetch() to Open-Meteo (forecast, geocoding, air quality)
// and the browser's geolocation are replaced before the page loads by switchable stand-ins: offline (fetch rejects),
// http500, or mock (canned answers), and geolocation deny/ok; the service worker's fetch is stubbed the same way for
// rain alerts. Covers: no location → search → preview → Add (the city becomes the main location), failed refreshes
// keeping the last forecast, current location + swiping between places, the main screen (header, insight, hourly
// graph, 10-day bars, detail cards), detail pages (day picker, chart scrubbing, Sun, Moon, Air quality), units and
// rain alerts in Settings, Manage locations (main location, reorder, selection mode delete), widgets (Weather s/m/l,
// Weather forecast m/l), the Lock screen chip, and the service worker's rain alert (once per shower).
// usage: .dev/run.sh .dev/weather.cjs   (THEME=dark / UI=ar too)
module.exports = async ({ page, sw, boot, ok, openApp, closeApp, text, texts, count, exists, sleep, shot, P, store, setStorage, outside, mod, ui, logs, clickText }) => {
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const H = 3600e3, D = 864e5;
  const RTL = ui === 'ar';
  const NEXT = RTL ? 'ArrowLeft' : 'ArrowRight', PREV = RTL ? 'ArrowRight' : 'ArrowLeft';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cid = (lat, lon) => `c_${lat.toFixed(3)}_${lon.toFixed(3)}`;

  await page.evaluateOnNewDocument(() => {
    window.__wx = { mode: 'offline', geo: 'deny', calls: [], forecast: null, aq: null, cities: { results: [] } };
    const real = window.fetch.bind(window);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = (input, init) => {
      const u = String(input?.url || input);
      if (!/open-meteo\.com|bing\.com/.test(u)) return real(input, init);
      window.__wx.calls.push(u);
      const m = window.__wx.mode;
      if (m === 'http500') return Promise.resolve(new Response('server error', { status: 500 }));
      if (m === 'mock') return Promise.resolve(json(/geocoding/.test(u) ? window.__wx.cities : /air-quality/.test(u) ? window.__wx.aq : window.__wx.forecast));
      return Promise.reject(new TypeError('Failed to fetch (test: offline)'));
    };
    navigator.geolocation.getCurrentPosition = (okCb, errCb) => setTimeout(() => (window.__wx.geo === 'ok'
      ? okCb({ coords: { latitude: 38.7223, longitude: -9.1393, accuracy: 30 }, timestamp: Date.now() })
      : errCb({ code: 1, PERMISSION_DENIED: 1, message: 'User denied Geolocation (test)' })), 30);
  });
  const wx = (fn, arg) => page.evaluate(fn, arg);
  const setMode = (mode, geo) => wx(([m, g]) => { window.__wx.mode = m; if (g) window.__wx.geo = g; }, [mode, geo]);
  const calls = () => wx(() => window.__wx.calls.slice());
  const temp = (c) => `⁦${Math.round(c)}°⁩`;
  const has = (s, c) => (s || '').includes(`${Math.round(c)}°`);
  const back = async () => { await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop()?.querySelector('.app-back')?.click()); await sleep(450); };
  const key = async (k) => { await page.keyboard.press(k); await sleep(450); };

  // ——— Open-Meteo answers in this machine's time zone (so days line up with the page's) ———
  function fcJson({ code = 0, temp: t0 = 23.4, tz = TZ, night = false, rainIn = null, hourCode = null } = {}) {
    const now = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const y0 = d0.getTime() / 1000 - 86400, N = 11 * 24;
    const hours = Array.from({ length: N }, (_, i) => y0 + i * 3600);
    const hod = (i) => i % 24;
    const today = (s) => Math.floor(now / 1000) + s;
    const q = Math.floor(now / 1000 / 900) * 900;
    return {
      timezone: tz, utc_offset_seconds: -new Date().getTimezoneOffset() * 60,
      current: { temperature_2m: t0, apparent_temperature: t0 - 1.2, relative_humidity_2m: 64, weather_code: code, is_day: night ? 0 : 1, precipitation: 0, cloud_cover: 20, wind_speed_10m: 14, wind_direction_10m: 225, wind_gusts_10m: 31, uv_index: 5.2, pressure_msl: 1013.2, visibility: 24100, dew_point_2m: 12.1 },
      hourly: {
        time: hours, temperature_2m: hours.map((_, i) => +(16 + 7 * Math.sin(((hod(i) - 9) / 24) * 2 * Math.PI)).toFixed(1)), apparent_temperature: hours.map((_, i) => +(15 + 7 * Math.sin(((hod(i) - 9) / 24) * 2 * Math.PI)).toFixed(1)),
        weather_code: hours.map((_, i) => hourCode ?? (i % 7 === 3 ? 2 : code)), is_day: hours.map((_, i) => +(hod(i) >= 7 && hod(i) < 18)), precipitation_probability: hours.map((_, i) => (i * 7) % 70),
        precipitation: hours.map((_, i) => (i < 24 ? 0.4 : i % 31 === 0 ? 1.2 : 0)), relative_humidity_2m: hours.map((_, i) => 50 + (i % 30)), dew_point_2m: hours.map(() => 12.1),
        uv_index: hours.map((_, i) => Math.max(0, +(6 * Math.sin(((hod(i) - 6) / 12) * Math.PI)).toFixed(1))), wind_speed_10m: hours.map((_, i) => 10 + (i % 9)), wind_direction_10m: hours.map((_, i) => (i * 20) % 360),
        wind_gusts_10m: hours.map((_, i) => 20 + (i % 12)), pressure_msl: hours.map((_, i) => +(1010 + i * 0.05).toFixed(1)), visibility: hours.map((_, i) => 10000 + (i % 24) * 600),
      },
      daily: {
        time: Array.from({ length: 11 }, (_, i) => y0 + i * 86400), weather_code: [61, code, 2, 3, 61, 80, 95, 71, 45, 1, 2],
        temperature_2m_max: [22, 26.1, 25, 24, 23, 26, 21, 19, 9, 14, 15], temperature_2m_min: [13, 15.3, 14, 13, 15, 14, 12, 2, 8, 9, 7],
        precipitation_probability_max: [80, 10, 20, 60, 80, 90, 40, 5, 0, 15, 0], precipitation_sum: [9.6, 0, 0.2, 3, 8, 12, 4, 1, 0, 0, 0],
        sunrise: [y0 + 6.8 * 3600, night ? today(-14 * 3600) : today(-3 * 3600), ...Array.from({ length: 9 }, (_, i) => y0 + (i + 2) * 86400 + 6.8 * 3600)],
        sunset: [y0 + 17.5 * 3600, night ? today(-2 * 3600) : today(3 * 3600), ...Array.from({ length: 9 }, (_, i) => y0 + (i + 2) * 86400 + 17.5 * 3600)],
        daylight_duration: Array.from({ length: 11 }, (_, i) => 39000 - i * 70), uv_index_max: [4, 5.2, 6, 3, 2, 4, 1, 2, 3, 5, 6],
        wind_speed_10m_max: Array(11).fill(24), wind_gusts_10m_max: Array(11).fill(41), wind_direction_10m_dominant: Array(11).fill(250),
      },
      minutely_15: { time: Array.from({ length: 9 }, (_, i) => q - 900 + i * 900), precipitation: Array.from({ length: 9 }, (_, i) => (rainIn != null && i >= 1 + rainIn ? 0.6 : 0)) },
    };
  }
  const aqJson = () => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const y0 = d0.getTime() / 1000 - 86400, T = Array.from({ length: 6 * 24 }, (_, i) => y0 + i * 3600);
    return { current: { us_aqi: 42, european_aqi: 27, pm2_5: 8.4, pm10: 15.2, ozone: 61, nitrogen_dioxide: 12, sulphur_dioxide: 2, carbon_monoxide: 180 }, hourly: { time: T, us_aqi: T.map((_, i) => 30 + (i % 40)), european_aqi: T.map((_, i) => 15 + (i % 30)) } };
  };
  const cache = (o, loc) => mod('./js/weather/model.js', 'normalize', fcJson(o), aqJson(), loc);
  const TESTVILLE = { name: 'Testville', lat: 48.85, lon: 2.35 };
  const W = (id, size, widget = 'weather') => ({ id, type: 'widget', widget, size, config: {} });
  const G = (id) => `.widget-tile[data-id="${id}"]`; // a widget on the Home screen by its item id

  // ——— 1. no location: geolocation denied, no cache ———
  await boot({ settings: { location: null, lockWidgets: ['weather'] }, data: { home: [[W('ws', 's')]], dock: [] } });
  await sleep(500);
  ok((await text('.ws-s .wgw-empty')) === (await tr('wx.tapToSet')), 'widget asks to set a location when geolocation is denied');
  await openApp('weather'); await sleep(500);
  ok((await text('.wx-empty p')) === (await tr('wx.err.location')), 'app explains that location is needed');
  ok((await text('.wx-empty .ou-btn.primary')) === (await tr('wx.chooseCity')), 'app offers "Choose a city"');
  ok((await calls()).length === 0 && (await store('weather')) == null, 'no forecast request and nothing cached without a location');
  ok(await exists('.wx-mainpage .wxk'), 'the empty state still has a sky');
  await shot(P + 'wx-01-no-location');

  await page.click('.wx-empty .ou-btn.primary'); await sleep(550);
  ok(await exists('.wx-spage input[type=search]'), '"Choose a city" opens the search page');
  ok(!(await exists('.wx-spage .wx-scur')), 'no "Use current location" row while it is already a location');
  await page.type('.wx-spage input[type=search]', 'Lisbon'); await sleep(750);
  const geoCall = (await calls()).find((u) => u.includes('geocoding-api'));
  ok(!!geoCall && geoCall.includes('name=Lisbon') && geoCall.includes('language=' + ui), 'city search asks Open-Meteo geocoding in the UI language');
  ok((await text('.ou-toast span')) === (await tr('wx.err.network')) && (await text('.wx-sempty')) === (await tr('wx.searchFailed')), 'offline search: toast and a message');
  await shot(P + 'wx-02-search-offline');

  const lisbonFc = fcJson({ code: 63, temp: 18.6, tz: 'Europe/Lisbon' });
  await wx((o) => Object.assign(window.__wx, o), {
    cities: { results: [{ name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal', latitude: 38.7223, longitude: -9.1393 }, { name: 'Lisbon', admin1: 'Maine', country: 'United States', latitude: 44.03, longitude: -70.1 }] },
    forecast: lisbonFc, aq: aqJson(),
  });
  await setMode('mock');
  await page.evaluate(() => { document.querySelector('.wx-spage input[type=search]').value = ''; });
  await page.type('.wx-spage input[type=search]', 'Lisbo'); await sleep(750);
  const rows = await texts('.wx-spage .wx-sres .ou-row-title');
  ok(rows.length === 2 && rows.every((r) => r === 'Lisbon'), `search lists both Lisbons (got ${rows.length})`);
  ok((await texts('.wx-spage .wx-sres .ou-row-sub'))[0] === 'Lisbon, Portugal', 'result shows region and country');
  await shot(P + 'wx-03-search-results');
  await page.click('.wx-spage .wx-sres'); await sleep(900);
  ok(await exists('.wx-prev .wx-temp') && has(await text('.wx-prev .wx-temp'), 18.6), 'a result opens its preview with the forecast');
  ok(await exists('.wx-prev .wx-addbtn') && (await text('.wx-prev .wx-addbtn')) === (await tr('wx.add')), 'preview has Add');
  const fc1 = (await calls()).filter((u) => u.includes('/v1/forecast'));
  ok(fc1.length === 1 && fc1[0].includes('latitude=38.7223') && fc1[0].includes('longitude=-9.1393') && fc1[0].includes('timeformat=unixtime') && fc1[0].includes('forecast_days=10') && fc1[0].includes('minutely_15=precipitation'), 'one forecast request for the city (10 days, 15-minute precipitation)');
  ok((await calls()).some((u) => u.startsWith('https://air-quality-api.open-meteo.com/v1/air-quality') && u.includes('latitude=38.7223')), 'and one to the air-quality service');
  ok((await store('settings')).location === null && (await store('weatherPlaces')) == null, 'a preview saves nothing');
  await shot(P + 'wx-04-preview');
  await page.click('.wx-prev .wx-addbtn'); await sleep(900);
  const sel = (await store('settings')).location;
  ok(sel?.name === 'Lisbon' && Math.abs(sel.lat - 38.7223) < 1e-6 && Math.abs(sel.lon + 9.1393) < 1e-6, 'Add (with the location off) makes the city the main location: settings.location');
  const pl1 = await store('weatherPlaces');
  ok(pl1?.length === 1 && pl1[0].id === cid(38.7223, -9.1393) && pl1[0].country === 'Portugal', 'weatherPlaces holds the city (current location replaced)');
  let c = await store('weather');
  ok(c?.v === 2 && c.location?.name === 'Lisbon' && c.location.auto === false && c.current.temp === 18.6 && c.current.code === 63, 'the preview\'s forecast became the weather cache (no new request)');
  ok((await calls()).filter((u) => u.includes('/v1/forecast')).length === 1, 'Add made no second forecast request');
  ok(c?.hourly?.length === 25 && c.daily.length === 10 && c.current.high === 26.1 && c.series.t.length >= 24 * 10 && c.aqi?.eu === 27 && c.minutely?.t.length === 9, 'cache: 25 hours, 10 days, hourly series, air quality, 15-minute data');
  ok((await mod('./js/core/apps.js', 'currentApp')) === 'weather' && !(await exists('.wx-prev')) && !(await exists('.wx-spage')), 'back on the main screen');
  ok((await text('.wx-mainpage .wx-name')) === 'Lisbon' && has(await text('.wx-mainpage .wx-temp'), 18.6), 'main screen shows Lisbon 19°');
  ok(await exists('.wx-mainpage .wxk.k-rain .wxk-rain') && (await text('.wx-mainpage .wx-cond')) === (await tr('wx.c.rain')), 'rain sky and label');
  await shot(P + 'wx-05-added');

  // a failed refresh keeps the last forecast
  await setMode('offline');
  const n0 = (await calls()).length;
  await page.click('.wx-mainpage .wx-refresh'); await sleep(700);
  ok((await calls()).length > n0, 'Refresh forces a new request');
  ok(!(await exists('.wx-mainpage .wx-empty')) && has(await text('.wx-mainpage .wx-temp'), 18.6), 'offline refresh keeps the cached forecast');
  ok((await text('.ou-toast span')) === (await tr('wx.updateFailed')), 'and says it couldn\'t update');
  await setMode('http500');
  await page.click('.wx-mainpage .wx-refresh'); await sleep(700);
  ok((await store('weather'))?.current?.temp === 18.6 && !(await exists('.wx-refresh.spin')), 'HTTP 500: cache kept, spinner stopped');
  ok(has(await text('.ws-s .wgw-temp'), 18.6) && (await text('.ws-s .wgw-city')) === 'Lisbon', 'widget picked up the new forecast');

  // add the current location back: it becomes the main one; swipe between the two
  await setMode('mock', 'ok');
  await page.click('.wx-menu'); await sleep(550);
  ok(await exists('.wx-ppage') && (await count('.wx-pcard')) === 1, 'the ≡ button opens Manage locations (one card)');
  ok((await text('.wx-pcard .wx-pc-sub')) === (await tr('wx.main')), 'the first card is the main location');
  await page.click('.wx-ppage .app-toolbar-actions .ou-icon-btn'); await sleep(550);
  ok(await exists('.wx-spage .wx-scur'), '+ opens the search with "Use current location"');
  await page.click('.wx-spage .wx-scur'); await sleep(1100);
  c = await store('weather');
  const pl2 = await store('weatherPlaces');
  ok((await store('settings')).location === null && pl2?.map((p) => p.id).join() === `here,${cid(38.7223, -9.1393)}`, 'current location is first again (settings.location null)');
  ok(c?.location?.auto === true && c.location.name === 'Lisbon' && Math.abs(c.location.lat - 38.7223) < 1e-6, 'its forecast: auto, named after the time zone (Europe/Lisbon)');
  ok((await store('weatherMore'))?.[cid(38.7223, -9.1393)]?.current?.temp === 18.6, 'the city\'s forecast moved to weatherMore');
  ok((await count('.wx-mainpage .wx-dot')) === 2 && await exists('.wx-mainpage .wx-dot.on.here svg') && await exists('.wx-mainpage .wx-here svg'), 'two page dots; the current location has the arrow');
  const reqs = (await calls()).length;
  await page.focus('.wx-mainpage .wx-head .wx-refresh'); await key(NEXT);
  ok((await text('.wx-mainpage .wx-name')) === 'Lisbon' && await exists('.wx-mainpage .wx-dot.on:nth-child(2)') && !(await exists('.wx-mainpage .wx-here')), `${NEXT} shows the next place (Lisbon)`);
  ok((await calls()).length === reqs, 'a fresh saved forecast needs no request');
  await key(NEXT);
  ok((await text('.wx-mainpage .wx-name')) === 'Lisbon', 'no place after the last');
  await page.click('.wx-mainpage .wx-dot:nth-child(1)'); await sleep(500);
  ok(await exists('.wx-mainpage .wx-here') && await exists('.wx-mainpage .wx-dot.on:nth-child(1)'), 'the first dot goes back to the current location');
  await page.focus('.wx-mainpage .wx-head .wx-refresh'); await key(PREV);
  ok(await exists('.wx-mainpage .wx-here'), 'no place before the first');
  await closeApp();

  // ——— 2. location set, offline, no cache ———
  await boot({ settings: { location: TESTVILLE, lockWidgets: ['weather'] }, data: { home: [[W('ws', 's')]], dock: [] } });
  await sleep(500);
  const netMsg = await tr('wx.err.network');
  ok((await text('.ws-s .wgw-empty')) === netMsg, 'widget shows the connection message offline');
  await openApp('weather'); await sleep(500);
  ok((await text('.wx-empty p')) === netMsg && (await text('.wx-empty .ou-btn.primary')) === (await tr('wx.retry')), 'app: connection message and Retry');
  ok((await calls()).some((u) => u.includes('/v1/forecast') && u.includes('latitude=48.8500')), 'it did try the saved location');
  await shot(P + 'wx-06-offline');
  await setMode('http500');
  await page.click('.wx-empty .ou-btn.primary'); await sleep(600);
  ok((await text('.wx-empty p')) === netMsg && (await store('weather')) == null, 'Retry with HTTP 500: same message, nothing cached');
  await closeApp();
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(700);
  ok(!(await exists('#lock .lk-w-wx')), 'Lock screen shows no weather chip without a forecast');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);

  // ——— 3. stale cache, offline: the old forecast stays ———
  const tv = await cache({}, { id: cid(48.85, 2.35), name: 'Testville', lat: 48.85, lon: 2.35, auto: false });
  await boot({ settings: { location: TESTVILLE }, data: { home: [[]], dock: [], weather: { ...tv, fetchedAt: Date.now() - 2 * H } } });
  await openApp('weather'); await sleep(700);
  ok((await calls()).some((u) => u.includes('/v1/forecast')), 'a cache older than 30 min triggers a refresh');
  ok(!(await exists('.wx-empty')) && has(await text('.wx-temp'), 23.4), 'failed refresh: the stale forecast stays on screen');
  ok(((await text('.wx-updated')) || '').length > 4, '"Updated <time>" is shown');
  await closeApp();

  // ——— 4. three places with fresh caches: app, details, settings, Manage locations, widgets, Lock screen ———
  const OSLO = { id: cid(59.91, 10.75), name: 'Oslo', region: 'Oslo', country: 'Norway', lat: 59.91, lon: 10.75 };
  const TOKYO = { id: cid(35.68, 139.69), name: 'Tokyo', region: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69 };
  const TV = { id: cid(48.85, 2.35), name: 'Testville', region: '', country: 'France', lat: 48.85, lon: 2.35 };
  const more = {
    [OSLO.id]: await cache({ code: 3, temp: 8 }, { ...OSLO, auto: false }),
    [TOKYO.id]: await cache({ code: 61, temp: 17, tz: 'Asia/Tokyo' }, { ...TOKYO, auto: false }),
  };
  await boot({
    settings: { location: TESTVILLE, lockWidgets: ['weather'] },
    data: { home: [[W('wm', 'm'), W('ws', 's'), W('fm', 'm', 'weather-forecast')], [W('wl', 'l')], [W('fl', 'l', 'weather-forecast')]], dock: [], weather: tv, weatherPlaces: [TV, OSLO, TOKYO], weatherMore: more },
  });
  await sleep(500);
  ok((await count('.wg-weather')) === 5, 'five weather widgets on the Home screen');
  ok(has(await text('.ws-s .wgw-temp'), 23.4) && (await text('.ws-s .wgw-city')) === 'Testville' && !(await exists('.ws-s .wgw-hours')), 'small widget: city and temperature');
  ok((await text(G('wm') + ' .wgw-cond')) === (await tr('wx.c.sunny')) && (await count(G('wm') + ' .wgw-hour')) === 6, 'medium widget: "Sunny" and 6 hours');
  ok(has(await text(G('wm') + ' .wgw-hl'), 26.1) && has(await text(G('wm') + ' .wgw-hl'), 15.3), 'widget shows high / low');
  ok((await count(G('fm') + ' .wfc-col')) === 5 && has(await text(G('fm') + ' .wfc-temp'), 23.4), 'forecast widget (m): now and 5 days');
  ok((await outside(G('wm') + ' .wgw-hour', G('wm'))).length === 0 && (await outside(G('fm') + ' .wfc-col', G('fm'))).length === 0, 'medium widgets fit their boxes');
  await shot(P + 'wx-07-widgets');
  await mod('./js/shell/home.js', 'goPage', 1, true); await sleep(500);
  ok((await count(G('wl') + ' .wgw-hour')) === 6 && (await count(G('wl') + ' .wgw-day')) === 5, 'large widget: 6 hours and 5 days');
  ok((await count(G('fl') + ' .wfc-hour')) === 7 && (await count(G('fl') + ' .wfc-day')) === 5 && await exists(G('fl') + ' .wfc-graph polyline'), 'forecast widget (l): 7 hours on a line and 5 days with bars');
  ok((await outside(G('wl') + ' .wgw-day', G('wl'))).length === 0 && (await outside(`${G('fl')} .wfc-day, ${G('fl')} .wfc-hour`, G('fl'))).length === 0, 'large widgets fit their boxes');
  await shot(P + 'wx-08-widgets-large');
  await mod('./js/shell/home.js', 'goPage', 2, true); await sleep(500);
  await shot(P + 'wx-08b-forecast-large');
  await mod('./js/shell/home.js', 'goPage', 0, true); await sleep(400);
  ok((await calls()).length === 0, 'fresh caches make no network request');
  const finder = (q) => page.evaluate((q) => import('./js/core/hooks.js').then((m) => m.runCommands(q, () => {}).filter((r) => r.cmd === 'weather').map((r) => r.title)), q);
  ok((await finder('weather'))[0]?.includes('Testville') && (await finder('weather'))[0].includes('23°'), 'Finder "weather": the main location now');
  ok((await finder('الطقس'))[0]?.includes('Testville') && (await finder('weatherly')).length === 0, 'Finder "الطقس" works too; other words don\'t trigger it');
  ok((await finder('weather Osl'))[0]?.includes('Oslo') && (await finder('weather Osl'))[0].includes('8°'), 'Finder "weather Osl": that saved place');

  await page.click(G('wm')); await sleep(1000);
  ok((await mod('./js/core/apps.js', 'currentApp')) === 'weather', 'tapping the widget opens Weather');
  ok((await text('.wx-name')) === 'Testville' && (await count('.wx-dot')) === 3, 'main location first, three page dots');
  ok((await text('.wx-temp')) === temp(23.4), 'big temperature 23° (isolated for RTL)');
  ok((await text('.wx-cond')) === (await tr('wx.c.sunny')), 'condition label "Sunny"');
  ok(has(await text('.wx-hl-hi'), 26.1) && has(await text('.wx-hl-lo'), 15.3) && (await text('.wx-feels')) === (await tr('wx.feels', { t: temp(22.2) })), 'high, low and feels like');
  ok(((await text('.wx-insight p')) || '').length > 10, 'an insight sentence: ' + (await text('.wx-insight p')));
  ok((await count('.wx-hcol')) === 25 && (await text('.wx-hcol .wx-ht')) === (await tr('wx.now')) && await exists('.wx-hgraph path.wx-hline'), '25 hours starting with "Now" on a temperature line');
  ok((await count('.wx-drow')) === 10 && (await text('.wx-drow .wx-dn')) === (await tr('common.today')) && await exists('.wx-drow .wx-bar-now'), '10 days starting with "Today", a dot for now');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.wx-tile')].map((x) => x.dataset.open));
  ok(['uv', 'humidity', 'wind', 'aqi', 'sun', 'moon', 'pressure', 'visibility', 'dew', 'precip'].every((x) => tiles.includes(x)), 'detail cards: ' + tiles.join(', '));
  ok((await text('.wx-t-uv .wx-tile-v')) === '⁦5⁩' && (await text('.wx-t-uv .wx-tile-s')) === (await tr('wx.uv.moderate')), 'UV 5 is "Moderate"');
  ok(await exists('.wx-t-wind .wx-compass .ar') && await exists('.wx-t-sun .wx-sunarc .sun') && await exists('.wx-t-moon .wx-moonimg') && await exists('.wx-t-pressure .wx-pgauge'), 'compass, sun on its arc, the Moon, pressure dial');
  ok((await text('.wx-t-aqi .wx-tile-v')) === (TZ.startsWith('Europe/') ? '⁦27⁩' : '⁦42⁩'), 'air quality index from the air-quality service');
  ok((await text('.wx-t-humidity .wx-tile-v')) === '⁦64%⁩' && (await text('.wx-t-wind .wx-tile-v')).includes('14'), 'humidity 64%, wind 14');
  ok(await exists('.wx-skyhost .wxk.k-clear.p-day .wxk-sun'), 'clear day sky with the sun');
  ok(await page.evaluate(() => [...document.querySelectorAll('.wx-bar')].every((b) => { const r = b.getBoundingClientRect(), f = b.querySelector('i').getBoundingClientRect(); return f.left >= r.left - 1 && f.right <= r.right + 1 && f.width > 0; })), 'every 10-day bar stays inside its track');
  const hz = await page.evaluate(() => {
    const w = document.querySelector('.app-win').getBoundingClientRect();
    return [...document.querySelectorAll('.wx-card, .wx-tile, .wx-head > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < w.left - 1 || r.right > w.right + 1); }).map((e) => e.className);
  });
  ok(hz.length === 0, 'cards and tiles stay inside the window ' + hz.join(' '));
  await shot(P + 'wx-09-app');
  await page.evaluate(() => document.querySelector('.wx-mainpage .app-scroll').scrollTo(0, 620)); await sleep(300);
  await shot(P + 'wx-10-app-cards');
  await page.evaluate(() => document.querySelector('.wx-mainpage .app-scroll').scrollTo(0, 99999)); await sleep(300);
  await shot(P + 'wx-11-app-cards-end');
  await page.evaluate(() => document.querySelector('.wx-mainpage .app-scroll').scrollTo(0, 0)); await sleep(200);

  // detail pages
  await page.click('.wx-t-uv'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=uv]') && (await text('.wx-dpage .app-toolbar-title')) === (await tr('wx.uv')), 'the UV card opens its detail page');
  ok((await count('.wx-dpage .wx-day')) === 10 && await exists('.wx-dpage .wx-day.on:first-child') && await exists('.wx-dpage .wx-chart svg.wxc .ln'), 'day picker (10 days, today) and an hourly chart');
  ok(((await text('.wx-dpage .wx-dcard p')) || '').length > 10 && (await count('.wx-dpage .wx-dcard')) === 2, 'daily summary and "About"');
  const d0 = await text('.wx-dpage .wx-ddate');
  await page.click('.wx-dpage .wx-day:nth-child(3)'); await sleep(350);
  ok(await exists('.wx-dpage .wx-day.on:nth-child(3)') && (await text('.wx-dpage .wx-ddate')) !== d0, 'picking a day changes the chart and date');
  const box = await page.evaluate(() => { const r = document.querySelector('.wx-dpage .wxc .hit').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }; });
  await page.mouse.move(box.x, box.y); await sleep(200);
  ok(await exists('.wx-dpage .wx-dhero.scrub') && await page.evaluate(() => document.querySelector('.wx-dpage .wxc .scrub').getAttribute('visibility') === 'visible'), 'pointer over the chart shows that hour');
  await page.mouse.move(5, 5); await sleep(150);
  await shot(P + 'wx-12-detail-uv');
  await back();
  await page.click('.wx-hourly .wx-card-h'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=temp] .wxc .mk') && await exists('.wx-dpage .wx-legend'), 'the hourly card opens Temperature with high/low marks and the chance of rain');
  await shot(P + 'wx-13-detail-temp');
  await back();
  await page.click('.wx-drow:nth-child(4)'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=temp] .wx-day.on:nth-child(4)'), 'a 10-day row opens that day');
  await back();
  await page.click('.wx-t-sun'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=sun] .wx-sunpath .sp-day') && (await count('.wx-dpage .wx-rowx')) === 5, 'Sunrise & sunset: the sun\'s path and five times');
  await back();
  await page.click('.wx-t-moon'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=moon] .wx-dmoon .wx-moonimg') && (await count('.wx-dpage .wx-cal-g span:not(:empty)')) >= 28, 'Moon phase: the Moon and a month of phases');
  const m1 = await text('.wx-dpage .wx-cal-h span');
  await page.click('.wx-dpage .wx-cal-h button[data-m="1"]'); await sleep(200);
  ok((await text('.wx-dpage .wx-cal-h span')) !== m1, 'next month');
  await shot(P + 'wx-14-detail-moon');
  await back();
  await page.click('.wx-t-aqi'); await sleep(600);
  ok(await exists('.wx-dpage[data-metric=aqi] .wxc .bars rect') && (await count('.wx-dpage .wx-aqscale > div')) === 6 && (await count('.wx-dpage .wx-rowx')) === 6, 'Air quality: coloured bars, the scale and six pollutants');
  await back();
  ok(!(await exists('.wx-dpage')) && (await text('.wx-name')) === 'Testville', 'back on the main screen');

  // swipe to Tokyo (other time zone) with a horizontal drag
  const swipe = async (dx) => {
    await page.evaluate(() => document.querySelector('.wx-mainpage .app-scroll').scrollTo(0, 0)); await sleep(150);
    const r = await page.evaluate(() => { const b = document.querySelector('.wx-mainpage .wx-now').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.move(r.x, r.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r.x + (dx * i) / 8, r.y + i); await sleep(16); }
    await page.mouse.up(); await sleep(600);
  };
  await swipe(RTL ? 160 : -160);
  ok((await text('.wx-name')) === 'Oslo' && !(await exists('.wx-dpage')), 'a horizontal drag shows the next place (Oslo), not a detail page');
  ok(await exists('.wx-skyhost .wxk.k-cloudy'), 'Oslo has a cloudy sky');
  await swipe(RTL ? 160 : -160);
  ok((await text('.wx-name')) === 'Tokyo' && await exists('.wx-skyhost .wxk.k-rain'), 'and Tokyo (rain)');
  ok(await exists('.wx-local') || TZ === 'Asia/Tokyo', 'a place in another time zone shows its local time');
  await shot(P + 'wx-15-tokyo');
  await swipe(RTL ? -160 : 160);
  ok((await text('.wx-name')) === 'Oslo', 'dragging the other way goes back');
  ok((await calls()).length === 0, 'still no network request');

  // Settings: °F, wind unit, rain alerts
  await page.click('.wx-mainpage .app-toolbar-actions .ou-icon-btn'); await sleep(400);
  ok((await count('.ou-menu .ou-menu-item')) === 3 && (await outside('.ou-menu')).length === 0, '⋮ menu: Add location, Manage locations, Settings (inside the screen)');
  await page.click('.ou-menu .ou-menu-item:nth-child(3)'); await sleep(600);
  ok(await exists('.wx-setpage') && (await count('.wx-setpage .wx-unit-row')) === 4, 'Settings: temperature + four unit rows');
  await shot(P + 'wx-16-settings');
  await page.click('.wx-setpage .wx-temp-row .ou-seg-btn:nth-child(2)'); await sleep(300);
  ok((await store('settings')).tempUnit === 'f', '°F saved in settings.tempUnit');
  ok(((await texts('.wx-setpage .wx-unit-row .ou-row-sub'))[0] || '').includes(await tr('wx.u.mph')), 'wind "Auto" now means mph');
  await page.click('.wx-setpage .wx-unit-row'); await sleep(400);
  ok((await count('.ou-dialog .ou-radio-row')) === 5, 'wind speed choices: Auto + 4 units');
  await page.click('.ou-dialog .ou-radio-row:nth-child(4)'); await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(400);
  ok((await store('weatherPrefs'))?.wind === 'ms', 'm/s saved in weatherPrefs.wind');
  await clickText('.wx-setpage .ou-row', await tr('wx.rainAlert')); await sleep(700);
  ok((await store('weatherPrefs'))?.rainAlert === true, 'rain alerts on');
  ok(!!(await sw.evaluate(() => chrome.alarms.get('weather:rain'))), 'the service worker set its 30-minute alarm');
  await clickText('.wx-setpage .ou-row', await tr('wx.rainAlert')); await sleep(700);
  ok((await store('weatherPrefs'))?.rainAlert === false && !(await sw.evaluate(() => chrome.alarms.get('weather:rain'))), 'off again: alarm cleared');
  await back();
  ok((await text('.wx-temp')) === temp(8 * 1.8 + 32) && (await text('.wx-t-wind .wx-tile-v')).includes(await tr('wx.u.ms')), 'Oslo in °F (46°), wind in m/s');
  ok(has(await page.evaluate(() => document.querySelector('.ws-s .wgw-temp')?.textContent), 23.4 * 1.8 + 32), 'widgets switch to Fahrenheit too');
  await page.evaluate(() => import('./js/core/store.js').then((m) => { m.setSetting('tempUnit', 'c'); m.store.set('weatherPrefs', {}); })); await sleep(400);

  // Manage locations: main location, reorder, selection mode
  await page.click('.wx-menu'); await sleep(600);
  ok((await count('.wx-pcard')) === 3 && (await texts('.wx-pcard .wx-pc-name')).join() === 'Testville,Oslo,Tokyo', 'Manage locations: three cards in order');
  ok(await exists('.wx-pcard .wx-pc-sky .wxk.mini') && (await outside('.wx-pcard', '.app-win')).length === 0, 'each card over its own still sky, inside the window');
  await shot(P + 'wx-17-manage');
  await page.click(`.wx-pcard[data-id="${OSLO.id}"] .wx-pc-main`, { button: 'right' }); await sleep(400);
  await page.click('.ou-menu .ou-menu-item:nth-child(1)'); await sleep(600);
  ok((await store('weatherPlaces')).map((p) => p.name).join() === 'Oslo,Testville,Tokyo' && (await store('settings')).location?.name === 'Oslo', '"Set as main location" moves Oslo first (settings.location)');
  c = await store('weather');
  ok(c?.location?.name === 'Oslo' && c.current.temp === 8 && (await store('weatherMore'))?.[TV.id]?.current?.temp === 23.4 && !(await store('weatherMore'))?.[OSLO.id], 'the forecasts swapped places (no request)');
  ok((await calls()).length === 0, 'no request for the reorder');
  await page.click('.wx-ppage .app-toolbar-actions .ou-icon-btn:nth-child(2)'); await sleep(350);
  await page.click('.ou-menu .ou-menu-item:nth-child(1)'); await sleep(450);
  ok((await count('.wx-pcard.editing .wx-pcheck')) === 3 && (await count('.wx-pgrip')) === 3 && await exists('.wx-pbar:not([hidden])'), 'Edit: checkboxes, drag handles and the bottom bar');
  ok(await page.evaluate(() => document.querySelector('.wx-pbar-btn').disabled), 'Delete is off until something is selected');
  await page.focus('.wx-pcard:nth-child(1) .wx-pgrip'); await key('ArrowDown');
  ok((await store('weatherPlaces')).map((p) => p.name).join() === 'Testville,Oslo,Tokyo' && (await store('settings')).location?.name === 'Testville', 'arrow keys on a handle reorder (Testville main again)');
  await page.click(`.wx-pcard[data-id="${TOKYO.id}"] .wx-pcheck`); await sleep(300);
  ok((await text('.wx-ppage .app-toolbar-title')) === (await tr('wx.nSelected', { n: 1 })) && !(await page.evaluate(() => document.querySelector('.wx-pbar-btn').disabled)), '"1 selected", Delete enabled');
  await shot(P + 'wx-18-manage-edit');
  await page.click('.wx-pbar-btn'); await sleep(500);
  ok((await store('weatherPlaces')).map((p) => p.name).join() === 'Testville,Oslo' && !(await store('weatherMore'))?.[TOKYO.id] && !(await exists('.wx-pcard.editing')), 'Tokyo deleted (and its forecast), selection mode ends');
  await page.click('.wx-ppage .app-toolbar-actions .ou-icon-btn:nth-child(2)'); await sleep(350);
  await page.click('.ou-menu .ou-menu-item:nth-child(1)'); await sleep(400);
  await page.click('.wx-pall'); await sleep(250);
  await page.click('.wx-pbar-btn'); await sleep(400);
  ok((await store('weatherPlaces')).length === 2 && (await text('.ou-toast span')) === (await tr('wx.keepOne')), 'deleting every location is refused');
  await page.click('.wx-ppage .wx-done'); await sleep(300);
  await page.click(`.wx-pcard[data-id="${OSLO.id}"] .wx-pc-main`); await sleep(600);
  ok(!(await exists('.wx-ppage')) && (await text('.wx-name')) === 'Oslo', 'tapping a card shows that place');

  // full screen (maximize): wider grid of cards, content centred
  await mod('./js/core/apps.js', 'toggleFullScreen', 'weather'); await sleep(700);
  const wide = await page.evaluate(() => {
    const w = document.querySelector('.app-win').getBoundingClientRect(), d = document.querySelector('.wx-daily').getBoundingClientRect(), g = document.querySelector('.wx-grid').getBoundingClientRect();
    const out = [...document.querySelectorAll('.wx-tile, .wx-card')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < w.left - 1 || r.right > w.right + 1; }).length;
    return { side: Math.abs(d.top - g.top) < 2 && (document.dir === 'rtl' ? d.left > g.right : d.right < g.left), out };
  });
  ok(wide.side && wide.out === 0, 'full screen: the 10-day list sits beside the cards, everything inside the window');
  await shot(P + 'wx-18b-fullscreen');
  await mod('./js/core/apps.js', 'toggleFullScreen', 'weather'); await sleep(700);

  // other skies follow the cache
  const showMain = async () => { await page.click('.wx-dot:nth-child(1)'); await sleep(500); };
  await showMain();
  await setStorage({ weather: await cache({ code: 2, night: true }, { ...TV, auto: false }) }); await sleep(700);
  ok(await exists('.wx-skyhost .wxk.k-partly.p-night .wxk-stars') && await exists('.wx-skyhost .wxk-moon .wx-moonimg'), 'partly cloudy night: stars and the Moon');
  await shot(P + 'wx-19-night');
  await setStorage({ weather: await cache({ code: 95 }, { ...TV, auto: false }) }); await sleep(600);
  ok(await exists('.wx-skyhost .wxk.k-thunder .wxk-flash') && (await text('.wx-cond')) === (await tr('wx.c.thunder')), 'thunderstorm: lightning and label');
  await setStorage({ weather: await cache({ code: 73 }, { ...TV, auto: false }) }); await sleep(600);
  ok(await exists('.wx-skyhost .wxk.k-snow .wxk-snow'), 'snow');
  await setStorage({ weather: await cache({ code: 45 }, { ...TV, auto: false }) }); await sleep(600);
  ok(await exists('.wx-skyhost .wxk.k-fog .wxk-fog'), 'fog');
  await setStorage({ weather: tv }); await sleep(500);
  await closeApp();

  // Lock screen chip
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(800);
  ok((await count('#lock .lk-w')) === 1 && await exists('#lock .lk-w .lk-w-wx svg') && has(await text('#lock .lk-w'), 23.4), 'Lock screen weather chip: icon and 23°');
  await shot(P + 'wx-20-lock');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);

  // ——— 5. rain alerts in the service worker (fake fetch there) ———
  await sw.evaluate((fc) => {
    globalThis.__wxReal ??= globalThis.fetch;
    globalThis.__wxSW = { fc, calls: 0, fail: false };
    globalThis.fetch = async (u) => {
      if (!String(u).includes('open-meteo')) return globalThis.__wxReal(u);
      globalThis.__wxSW.calls++;
      if (globalThis.__wxSW.fail) throw new TypeError('offline (test)');
      return new Response(JSON.stringify(globalThis.__wxSW.fc), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }, fcJson({ code: 2, rainIn: 2 }));
  const check = () => sw.evaluate(() => globalThis.__btRainCheck());
  const swCalls = () => sw.evaluate(() => globalThis.__wxSW.calls);
  await setStorage({ weatherPrefs: { rainAlert: false }, weather: null, notifications: [] });
  ok((await check()) === 'off', 'rain alerts off: nothing checked');
  await setStorage({ weatherPrefs: { rainAlert: true } }); await sleep(300);
  ok((await check()) === 'alert', 'rain in 30 minutes: an alert');
  await sleep(400); // post() doesn't wait for chrome.notifications.create
  const nots = await sw.evaluate(() => chrome.notifications.getAll());
  const nid = Object.keys(nots).find((k) => k.startsWith('weather:rain:'));
  ok(!!nid, 'a system notification weather:rain:<time>');
  const list = await store('notifications');
  ok(list?.[0]?.app === 'weather' && list[0].title === (ui === 'ar' ? 'يُتوقع هطول المطر قريبًا' : 'Rain expected soon') && list[0].body.includes('Testville'), 'and an entry in the notification list (in the app language, with the place)');
  ok((await swCalls()) === 1, 'one small forecast request');
  ok((await check()) === 'quiet' && (await store('notifications')).length === 1, 'the next check stays quiet (one alert per shower)');
  await sw.evaluate((fc) => (globalThis.__wxSW.fc = fc), fcJson({ code: 2 }));
  ok((await check()) === 'dry' && (await store('weatherRain'))?.alerted === false, 'a dry check re-arms the alert');
  await sw.evaluate((fc) => (globalThis.__wxSW.fc = fc), fcJson({ code: 2, rainIn: 3 }));
  ok((await check()) === 'alert' && (await store('notifications')).length === 2, 'the next shower gets its own alert');
  await sw.evaluate(() => (globalThis.__wxSW.fail = true));
  ok((await check()) === 'offline', 'offline: no alert, no error');
  const fresh = await cache({ code: 2, rainIn: 2 }, { ...TV, auto: false });
  await setStorage({ weather: fresh, weatherRain: { alerted: false, at: 0 } });
  const before = await swCalls();
  ok((await check()) === 'alert' && (await swCalls()) === before, 'a page\'s fresh forecast for the same place is used without a request');
  await sw.evaluate(() => chrome.notifications.getAll().then((all) => Promise.all(Object.keys(all).map((id) => chrome.notifications.clear(id)))));
  await sw.evaluate(() => { globalThis.fetch = globalThis.__wxReal; });

  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
};
