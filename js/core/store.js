// Persistent state. Every top-level key is stored separately in chrome.storage.local
// (falls back to localStorage when the page is opened outside the extension, e.g. for previews).
// Usage:
//   await store.init();
//   store.get('notes');  store.set('notes', [...]);  store.update('notes', (n) => [...n, x]);
//   setting('theme');    setSetting('theme', 'dark');
//   const off = store.on('notes', (value) => ...);   // also fires for changes made in other tabs

import { isExt } from './util.js';

export const DEFAULT_SETTINGS = {
  // look
  theme: 'auto', // auto | light | dark
  accent: 'auto', // auto (Color palette from wallpaper) | #hex
  blur: true,
  reduceMotion: false,
  lang: 'auto', // auto | en | ar
  hour12: 'auto', // auto | true | false

  // wallpaper
  wallpaper: { type: 'preset', id: 'bloom' }, // preset | image | bing | color
  wallpaperAnimated: true,
  wallpaperDim: 0, // 0..60 (%), extra darkening on the home screen
  wallpaperBlurHome: false,

  // lock screen
  lockMode: 'idle', // always | idle | never
  lockIdleMin: 10,
  clockStyle: 'stacked', // stacked | classic | thin | split
  clockFont: 'outfit', // outfit | inter | serif | mono | rounded
  clockWeight: 300,
  clockColor: 'auto', // auto | #hex
  lockWidgets: ['weather', 'battery', 'event'],
  lockShortcuts: ['notes', 'finder'],
  showNowBar: true,
  showSeconds: false,

  // home screen
  gridCols: 6,
  gridRows: 4,
  iconSize: 64,
  showLabels: true,
  iconStyle: 'default', // default | themed | dark
  dockBackground: true,
  pageIndicator: 'dots', // dots | line
  searchBar: 'bottom', // bottom | top | hidden
  edgePanel: true,
  edgeSide: 'right', // right | left
  edgeHandleY: 40, // % from top
  homeLocked: false, // Lock Home screen layout: nothing can be removed or moved
  appsButton: true, // the Apps button in the dock
  addNewApps: true, // apps installed later land on the last page (once, see addNewApps() in home.js)
  badges: 'number', // app icon badges: number | dot | off
  leftPage: true, // the Now Brief page left of the first page
  appsSort: 'az', // Apps screen: az | custom
  homeMainPage: 0, // the page a new tab opens on

  // finder / search
  searchEngine: 'default', // default | google | bing | duckduckgo | brave | ecosia | yahoo
  aiAssistant: 'claude', // claude | chatgpt | perplexity | copilot
  finderBookmarks: false,
  finderHistory: false,
  openLinks: 'same', // same | new

  // display
  brightness: 100, // 30..100, implemented as a dim layer
  eyeComfort: false,
  eyeComfortLevel: 40,

  // weather
  tempUnit: 'c', // c | f
  location: null, // { name, lat, lon } — null = ask the browser for the current position

  // focus
  focusMinutes: 25,

  // Settings pages and wallpaper options (the values the code assumed when they were missing)
  mutedApps: [], // apps whose notifications are off (Settings › Notifications)
  dnd: { on: false, sched: false, from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }, // Do not disturb (dndActive() in bg/hub.js)
  textScale: 100, // 85…150 (%)
  highContrast: false,
  lockWallpaper: null, // the Lock screen's own wallpaper; null = the Home screen's
  wallpaperDarkDim: false, // dim the wallpaper in Dark mode
  appSizes: {}, // per-app window size preference
  profileName: '',
  backupPictures: false, // Export includes pictures and recordings
  genDaily: false, // Labs: a new Creative wallpaper every day
  wallSmooth: false, // Labs: 48 fps live wallpaper
  wallLiveBehindApps: false, // Labs: keep the live wallpaper moving behind app windows

  // welcome tour and What's new (js/shell/onboarding.js, whatsnew.js)
  onboarded: null, // null = never decided (a Home layout means an existing user), false = tour in progress, true = done
  seenVersion: '', // manifest version whose What's new was shown (or that the tour finished on)
};

export const DEFAULTS = {
  settings: DEFAULT_SETTINGS,
  // home screen: pages of items; widgets and folders live inline.
  //   site:   { id, type: 'site', title, url }
  //   app:    { id, type: 'app', app: 'weather' }
  //   folder: { id, type: 'folder', title, color, items: [site|app] }
  //   widget: { id, type: 'widget', widget: 'weather', size: 's'|'m'|'l', config: {} }
  home: null, // seeded on first run (see shell/home.js)
  dock: null,
  edge: null, // edge panel apps
  wallpaperImage: null, // data URL for a custom photo
  bing: null, // { date, url, title, copyright }
  notifications: [], // { id, app, title, body, time, read }
  // built-in apps
  notes: [], // { id, title, body, color, pinned, created, updated }
  reminders: [], // { id, title, notes, due, done, list, priority, created }
  events: [], // { id, title, start, end, allDay, color, notes }
  alarms: [], // { id, time: 'HH:MM', days: [0..6], label, enabled }
  timers: [], // { id, label, duration, endsAt, remaining, running }
  stopwatch: { running: false, startedAt: 0, elapsed: 0, laps: [] },
  clocks: [], // world clocks: { id, tz, city }
  weather: null, // cached forecast
  focus: null, // { endsAt, minutes } while a Focus session is running
  calc: { history: [] },
  usage: {}, // { [appId]: launchCount } — powers suggestions
};

const mem = {};
const listeners = new Map();
let initDone = false;

function emit(key, value) {
  (listeners.get(key) || []).forEach((cb) => {
    try {
      cb(value);
    } catch (e) {
      console.error(e);
    }
  });
  (listeners.get('*') || []).forEach((cb) => cb(key, value));
}

const clone = (v) => (v == null || typeof v !== 'object' ? v : structuredClone(v));

// JSON with object keys sorted: chrome.storage hands values back with their keys in alphabetical order.
const stableJson = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

// This page's writes whose chrome.storage.onChanged echo hasn't arrived yet: key -> [{ json, t }] in write order.
// A write equal to the stored value fires no onChanged, so it isn't tracked.
const own = new Map();
function trackOwn(key, value) {
  const json = stableJson(value);
  if (json === stableJson(mem[key])) return null;
  const w = { json, t: Date.now() };
  own.set(key, [...(own.get(key) || []), w]);
  return w;
}
const dropOwn = (key, w) => w && own.set(key, (own.get(key) || []).filter((x) => x !== w));

export const store = {
  async init() {
    if (initDone) return;
    if (isExt) {
      const all = await chrome.storage.local.get(null);
      Object.assign(mem, all);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const [k, { newValue }] of Object.entries(changes)) {
          const json = stableJson(newValue);
          // Our own writes come back here too, possibly after newer local writes to the same key: skip those
          // echoes (applying them would roll mem back to a stale value and re-emit it). While a newer local
          // write is still on its way, another tab's older change loses to it anyway.
          const mine = (own.get(k) || []).filter((w) => Date.now() - w.t < 5000);
          const i = mine.findIndex((w) => w.json === json);
          own.set(k, i >= 0 ? mine.slice(i + 1) : mine);
          if (i >= 0 || mine.length) continue;
          if (stableJson(mem[k]) === json) continue;
          mem[k] = newValue;
          emit(k, store.get(k));
        }
      });
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith('bt:')) continue;
        try {
          mem[k.slice(3)] = JSON.parse(localStorage.getItem(k));
        } catch {}
      }
      addEventListener('storage', (e) => {
        if (!e.key?.startsWith('bt:')) return;
        const k = e.key.slice(3);
        mem[k] = e.newValue == null ? undefined : JSON.parse(e.newValue);
        emit(k, store.get(k));
      });
    }
    initDone = true;
  },

  get(key) {
    const v = mem[key];
    if (key === 'settings') return { ...DEFAULT_SETTINGS, ...(v || {}) };
    if (v === undefined) return clone(DEFAULTS[key] ?? null);
    return v;
  },

  set(key, value) {
    const w = isExt && trackOwn(key, value);
    mem[key] = value;
    if (isExt) chrome.storage.local.set({ [key]: value }).catch((e) => (dropOwn(key, w), console.error('store', key, e)));
    else {
      try {
        localStorage.setItem('bt:' + key, JSON.stringify(value));
      } catch (e) {
        console.error('store', key, e);
      }
    }
    emit(key, store.get(key));
  },

  update(key, fn) {
    const next = fn(clone(store.get(key)));
    store.set(key, next);
    return next;
  },

  remove(key) {
    const w = isExt && trackOwn(key, undefined);
    delete mem[key];
    if (isExt) chrome.storage.local.remove(key).catch(() => dropOwn(key, w));
    else localStorage.removeItem('bt:' + key);
    emit(key, store.get(key));
  },

  /** Subscribe to a key ('*' for everything). Returns an unsubscribe function. */
  on(key, cb) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(cb);
    return () => listeners.get(key).delete(cb);
  },

  async exportAll() {
    if (isExt) return chrome.storage.local.get(null);
    return { ...mem };
  },

  async importAll(data) {
    if (isExt) {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(data);
    } else {
      Object.keys(localStorage).filter((k) => k.startsWith('bt:')).forEach((k) => localStorage.removeItem(k));
      for (const [k, v] of Object.entries(data)) localStorage.setItem('bt:' + k, JSON.stringify(v));
    }
  },
};

export const setting = (name) => store.get('settings')[name];

export function setSetting(name, value) {
  store.update('settings', (s) => ({ ...s, [name]: value }));
}

/** Subscribe to one setting. Fires only when that setting changes. */
export function onSetting(name, cb) {
  let prev = JSON.stringify(setting(name));
  return store.on('settings', (s) => {
    const next = JSON.stringify(s[name]);
    if (next !== prev) {
      prev = next;
      cb(s[name]);
    }
  });
}

/** Session-only values (survive across tabs until the browser closes). */
export const session = {
  async get(key) {
    if (isExt && chrome.storage.session) return (await chrome.storage.session.get(key))[key];
    return JSON.parse(sessionStorage.getItem('bts:' + key) || 'null');
  },
  async set(key, value) {
    if (isExt && chrome.storage.session) return chrome.storage.session.set({ [key]: value });
    sessionStorage.setItem('bts:' + key, JSON.stringify(value));
  },
};

/** Count a launch so Finder / suggestions can rank by use. */
export function trackUsage(id) {
  store.update('usage', (u) => ({ ...(u || {}), [id]: ((u || {})[id] || 0) + 1 }));
}
