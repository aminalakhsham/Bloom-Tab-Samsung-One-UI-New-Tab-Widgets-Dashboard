// Weather in the service worker: rain alerts (Weather › Settings › Rain alerts, `weatherPrefs.rainAlert`). While on,
// the alarm "weather:rain" runs every 30 minutes, looks at the next two hours at the main location (a forecast a page
// fetched in the last 20 minutes, else one small Open-Meteo request with 15-minute precipitation) and notifies once
// before rain starts. It stays quiet while it rains and until a dry check, so one shower is one alert. A click opens
// Weather. The worker writes only `weatherRain` ({ alerted, at, checked }).
import { onAlarm, openTarget, post, bgStrings, bgTime, fmt } from './hub.js';
import { parseRain, rainSoon, isRainingNow, samePlace } from '../weather/model.js';

const ALARM = 'weather:rain';
const KEY = 'weatherRain';
const H = 36e5;
const S = {
  en: {
    rain: 'Rain expected soon', snow: 'Snow expected soon', thunder: 'Thunderstorms expected soon',
    body: 'Starting around {time} in {place}. Don’t forget an umbrella.', bodyHere: 'Starting around {time}. Don’t forget an umbrella.',
    bodySnow: 'Starting around {time} in {place}.', bodySnowHere: 'Starting around {time}.',
  },
  ar: {
    rain: 'يُتوقع هطول المطر قريبًا', snow: 'يُتوقع تساقط الثلج قريبًا', thunder: 'يُتوقع حدوث عواصف رعدية قريبًا',
    body: 'يبدأ نحو {time} في {place}. لا تنسَ المظلة.', bodyHere: 'يبدأ نحو {time}. لا تنسَ المظلة.',
    bodySnow: 'يبدأ نحو {time} في {place}.', bodySnowHere: 'يبدأ نحو {time}.',
  },
};

/** Keeps the alarm in line with the setting. */
export async function plan() {
  const { weatherPrefs } = await chrome.storage.local.get('weatherPrefs');
  const cur = await chrome.alarms.get(ALARM);
  if (weatherPrefs?.rainAlert && !cur) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  else if (!weatherPrefs?.rainAlert && cur) await chrome.alarms.clear(ALARM);
}

/** One check; returns what it decided (for tests): 'off' | 'nowhere' | 'offline' | 'alert' | 'quiet' | 'dry' | 'raining'. */
export async function checkRain(now = Date.now()) {
  const { weatherPrefs, settings, weather, [KEY]: saved } = await chrome.storage.local.get(['weatherPrefs', 'settings', 'weather', KEY]);
  if (!weatherPrefs?.rainAlert) return 'off';
  const a = settings?.location, b = weather?.location;
  const loc = a?.lat != null ? a : b?.lat != null ? b : null; // the device's position: as last fetched by a page
  if (!loc) return 'nowhere';
  let data = null;
  if (weather?.minutely && weather.fetchedAt > now - 20 * 60e3 && samePlace(weather.location, loc)) data = weather;
  else {
    const u = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
      latitude: (+loc.lat).toFixed(4), longitude: (+loc.lon).toFixed(4), timezone: 'auto', timeformat: 'unixtime',
      current: 'precipitation,weather_code', hourly: 'precipitation_probability,precipitation,weather_code', forecast_hours: '6', past_hours: '1',
      minutely_15: 'precipitation', forecast_minutely_15: '8', past_minutely_15: '1',
    });
    try {
      const r = await fetch(u);
      if (!r.ok) return 'offline';
      data = parseRain(await r.json(), now);
    } catch {
      return 'offline';
    }
  }
  const st = { alerted: false, at: 0, ...(saved && typeof saved === 'object' ? saved : {}), checked: now };
  const soon = rainSoon(data, now, 2 * H);
  let out;
  if (soon && (!st.alerted || now - st.at > 6 * H)) {
    const s = await bgStrings(S), time = await bgTime(soon.at), place = loc.name || '';
    const snow = soon.kind === 'snow';
    const body = fmt(s[(snow ? 'bodySnow' : 'body') + (place ? '' : 'Here')], { time, place });
    await post(`weather:rain:${soon.at}`, { app: 'weather', title: s[soon.kind] || s.rain, body, icon: 'umbrella' });
    Object.assign(st, { alerted: true, at: now });
    out = 'alert';
  } else if (soon) out = 'quiet';
  else if (isRainingNow(data, now)) out = 'raining';
  else {
    st.alerted = false; // dry: the next rain gets its own alert
    out = 'dry';
  }
  await chrome.storage.local.set({ [KEY]: st });
  return out;
}

onAlarm('weather', (rest) => (rest === 'rain' ? checkRain().catch((e) => console.warn('rain alert', e)) : null));
openTarget('weather', () => ({ app: 'weather' }));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.weatherPrefs) plan().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => plan().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => plan().catch(() => {}));
// dev tests run one check on demand (with a fake fetch) instead of waiting for the alarm
globalThis.__btRainCheck = checkRain;
