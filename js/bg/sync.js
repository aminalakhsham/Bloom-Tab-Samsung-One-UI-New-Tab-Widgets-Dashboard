// Sync with Chrome (Settings › Sync with Chrome, roadmap S11): when it's on, settings, the Home screen, notes,
// reminders, events, alarms, contacts, Wallet passes, routines and more are copied to chrome.storage.sync, so they
// follow you to every computer signed in to Chrome with sync turned on. No server of ours is involved.
//
// The service worker does the work (this module is imported by background.js; pages import it only for the tables
// and the pure helpers below, the listeners start in the worker only):
// - chrome.storage.sync item per key: `m:<key>` = { n: chunks, ts: when it changed, dev: device id, h: content hash }
//   and `c:<key>:<i>` = the JSON, deflate-compressed and base64-encoded, cut into chunks under the 8 KB item limit.
// - Conflicts: newest wins per key. A local change is stamped with the time it happened (`syncDirty`), a copy from
//   another computer with its own time; the newer one stays and the other is replaced. The first time a computer
//   syncs a list of items with ids (notes, reminders, events, alarms…), both sides are merged by id instead.
// - Local keys: `syncPrefs` { on, off: [category ids] } (per device), `syncState` { [key]: { h, ts } } (what is in
//   sync), `syncDirty` { [key]: changedAt } (waiting to upload), `syncStatus` { at, ok, error, used, pulled, pushed },
//   `syncDevice` (random id). None of these are synced or exported.
// - Never synced, whatever a category says: pictures, recordings, music, the screen lock PIN, Journal, Samsung Health,
//   Digital Wellbeing's usage, Canvas boards, games, locked notes, notifications, caches. Per-device settings
//   (language, lock timing, brightness, a photo wallpaper…) stay on each computer.
import { nextAlarmTime } from '../core/schedule.js';
import { onAlarm, onMessage } from './hub.js';
import { norm as eventNorm, nextAlert } from '../calendar/model.js';

export const SYNC_CATEGORIES = [
  { id: 'settings', keys: ['settings', 'qpTiles', 'genWalls'] },
  { id: 'home', keys: ['home', 'dock', 'edge', 'homeLeft', 'drawerLayout', 'homeAdded', 'storeWish'] },
  { id: 'notes', keys: ['notes', 'noteFolders'] },
  { id: 'reminders', keys: ['reminders', 'reminderCats'] },
  { id: 'calendar', keys: ['events', 'calendars', 'calPrefs', 'calSubs'] },
  { id: 'clock', keys: ['alarms', 'clocks'] },
  { id: 'contacts', keys: ['contacts'] },
  { id: 'wallet', keys: ['wallet'] },
  { id: 'routines', keys: ['routines'] },
  { id: 'wellbeing', keys: ['wellbeing'] },
];
/** Keys that never leave this computer, even if a category lists them by mistake. */
export const NEVER = /^(pin|pinTries|journal\w*|health\w*|wellbeingUsage|music\w*|recorder\w*|canvas\w*|games\w*|notesLocked|notesBin|wallpaperImage|wallPhotos|bing|notifications|weather|usage|focus|focusLog|timers|stopwatch|sync\w*|appWindows|clipIcons|webApps|contactsBg)$/;
/** Settings that belong to one computer. */
export const DEVICE_ONLY = ['lang', 'onboarded', 'seenVersion', 'lockMode', 'lockIdleMin', 'lockAfter', 'brightness', 'finderBookmarks', 'finderHistory'];
const MERGE_BY_ID = ['notes', 'noteFolders', 'reminders', 'reminderCats', 'events', 'calendars', 'alarms', 'clocks'];
export const QUOTA = 102400; // chrome.storage.sync.QUOTA_BYTES
export const CHUNK = 8000; // base64 characters per item: with its key and quotes it stays under the 8192-byte item limit
const PUSH_DELAY = 2000;

export const isSyncable = (key) => !NEVER.test(key) && SYNC_CATEGORIES.some((c) => c.keys.includes(key));
/** The keys this device syncs with these prefs. */
export const syncKeys = (prefs) => (prefs?.on ? SYNC_CATEGORIES.filter((c) => !(prefs.off || []).includes(c.id)).flatMap((c) => c.keys).filter(isSyncable) : []);

// a wallpaper that is a picture on this computer can't follow you
const localWall = (wp) => !!wp && ['photo', 'shuffle', 'image'].includes(wp.type);
/** Settings as they go to sync: without the per-device ones. */
export function stripDevice(s) {
  const out = { ...(s || {}) };
  for (const k of DEVICE_ONLY) delete out[k];
  if (localWall(out.wallpaper)) delete out.wallpaper;
  if (localWall(out.lockWallpaper)) delete out.lockWallpaper;
  return out;
}
/** Settings from another computer, keeping this computer's own ones (and settings the other one never had). */
export function mergeSettings(cur = {}, remote = {}) {
  const out = { ...cur, ...remote };
  for (const k of DEVICE_ONLY) {
    if (k in cur) out[k] = cur[k];
    else delete out[k];
  }
  for (const k of ['wallpaper', 'lockWallpaper']) if (localWall(cur[k])) out[k] = cur[k];
  return out;
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const fnv = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36) + str.length.toString(36); };
/** Content hash of a key's value as it is synced. */
export const hashOf = (key, v) => fnv(canon(key === 'settings' ? stripDevice(v) : v));

/** JSON → deflate → base64. */
export async function encodeValue(v) {
  const stream = new Blob([JSON.stringify(v)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const u = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function decodeValue(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const stream = new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}
export const chunkString = (s, size = CHUNK) => Array.from({ length: Math.max(1, Math.ceil(s.length / size)) }, (_, i) => s.slice(i * size, (i + 1) * size));
const chunkKeys = (key, from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => `c:${key}:${from + i}`);

/** Reads a key's value from chrome.storage.sync (null when missing or caught between two versions). */
export async function readSynced(key) {
  const meta = (await chrome.storage.sync.get('m:' + key))['m:' + key];
  if (!meta) return null;
  const parts = await chrome.storage.sync.get(chunkKeys(key, 0, meta.n));
  try {
    const v = await decodeValue(chunkKeys(key, 0, meta.n).map((k) => parts[k] || '').join(''));
    return fnv(canon(v)) === meta.h ? { meta, value: v } : null;
  } catch {
    return null;
  }
}

/** First sync of a list: everything from both sides, by id; the same item keeps its most recently updated copy. */
function mergeById(local, remote) {
  const stamp = (x) => +(x?.updated || x?.updatedAt || x?.modified || x?.created || 0);
  const out = new Map(remote.filter((x) => x?.id != null).map((x) => [x.id, x]));
  for (const x of local) {
    if (x?.id == null) continue;
    const r = out.get(x.id);
    if (!r || stamp(x) > stamp(r)) out.set(x.id, x);
  }
  return [...out.values()];
}

// ——— the worker side ———
const local = () => chrome.storage.local;
const sync = () => chrome.storage.sync;
let chain = Promise.resolve(), pushT = null;
const queue = (fn) => (chain = chain.then(fn).catch((e) => console.warn('sync', e)));
const getAll = (keys) => local().get(keys);

async function deviceId() {
  let { syncDevice: id } = await local().get('syncDevice');
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await local().set({ syncDevice: id });
  }
  return id;
}

async function setStatus(s) {
  const used = await sync().getBytesInUse(null).catch(() => 0);
  const { syncStatus: old = {} } = await local().get('syncStatus');
  await local().set({ syncStatus: { ...old, ...s, at: Date.now(), used } });
}

function schedulePush() {
  clearTimeout(pushT);
  pushT = setTimeout(() => queue(push), PUSH_DELAY);
  // in case the worker is stopped before the timer fires
  chrome.alarms.create('sync:push', { delayInMinutes: 1 });
}

/** Local keys changed: the ones that differ from what is in sync wait for upload, stamped with the time. */
async function markDirty(keys, changes) {
  const { syncPrefs, syncState = {}, syncDirty = {} } = await getAll(['syncPrefs', 'syncState', 'syncDirty']);
  const enabled = new Set(syncKeys(syncPrefs));
  let touched = false;
  for (const k of keys) {
    if (!enabled.has(k)) continue;
    const v = changes[k].newValue;
    if (v === undefined) continue;
    if (syncState[k]?.h === hashOf(k, v)) {
      if (syncDirty[k]) (delete syncDirty[k], (touched = true));
      continue;
    }
    syncDirty[k] = Date.now();
    touched = true;
  }
  if (!touched) return;
  await local().set({ syncDirty });
  schedulePush();
}

/** Uploads the keys waiting in syncDirty (unless another computer changed them later: then theirs is taken). */
async function push() {
  const { syncPrefs, syncState = {}, syncDirty = {} } = await getAll(['syncPrefs', 'syncState', 'syncDirty']);
  if (!syncPrefs?.on) return;
  const enabled = new Set(syncKeys(syncPrefs));
  const keys = Object.keys(syncDirty).filter((k) => enabled.has(k));
  if (!keys.length) return;
  const dev = await deviceId();
  const data = await local().get(keys);
  const metas = await sync().get(keys.map((k) => 'm:' + k));
  const pushed = [], theirs = [];
  let error = null;
  for (const k of keys) {
    const v = data[k];
    if (v === undefined) {
      delete syncDirty[k];
      continue;
    }
    const val = k === 'settings' ? stripDevice(v) : v;
    const h = fnv(canon(val));
    const meta = metas['m:' + k];
    if (meta?.h === h) {
      syncState[k] = { h, ts: meta.ts };
      delete syncDirty[k];
      continue;
    }
    if (meta && meta.dev !== dev && meta.ts > syncDirty[k] && meta.h !== syncState[k]?.h) {
      // changed on another computer after it changed here: newest wins
      delete syncDirty[k];
      theirs.push(k);
      continue;
    }
    const parts = chunkString(await encodeValue(val));
    const ts = Math.max(syncDirty[k], (meta?.ts || 0) + 1);
    const obj = { ['m:' + k]: { n: parts.length, ts, dev, h } };
    parts.forEach((p, i) => (obj[`c:${k}:${i}`] = p));
    try {
      await sync().set(obj);
      if (meta?.n > parts.length) await sync().remove(chunkKeys(k, parts.length, meta.n));
      syncState[k] = { h, ts };
      delete syncDirty[k];
      pushed.push(k);
    } catch (e) {
      error = { key: k, message: String(e?.message || e) };
    }
  }
  await local().set({ syncState, syncDirty });
  if (theirs.length) await pull(theirs);
  await setStatus({ ok: !error, error, pushed });
  return error;
}

/** Takes newer copies from other computers. */
async function pull(keys) {
  const { syncPrefs, syncState = {}, syncDirty = {} } = await getAll(['syncPrefs', 'syncState', 'syncDirty']);
  if (!syncPrefs?.on) return;
  const enabled = new Set(syncKeys(syncPrefs));
  keys = keys.filter((k) => enabled.has(k));
  if (!keys.length) return;
  const dev = await deviceId();
  const metas = await sync().get(keys.map((k) => 'm:' + k));
  const cur = await local().get(keys);
  const patch = {}, pulled = [];
  for (const k of keys) {
    const m = metas['m:' + k];
    if (!m || m.h === syncState[k]?.h) continue;
    if (m.dev === dev && syncState[k]) continue; // our own upload
    if (syncDirty[k] && syncDirty[k] > m.ts) continue; // our newer change wins (it's on its way up)
    const got = await readSynced(k);
    if (!got || got.meta.h !== m.h) continue; // the rest of its chunks haven't arrived yet
    let v = got.value;
    const first = !syncState[k];
    if (k === 'settings') v = mergeSettings(cur.settings, v);
    else if (first && MERGE_BY_ID.includes(k) && Array.isArray(cur[k]) && Array.isArray(v)) v = mergeById(cur[k], v);
    patch[k] = v;
    syncState[k] = { h: m.h, ts: m.ts };
    // something of ours to add (a merged list, settings the other computer never had): upload the result
    if (hashOf(k, v) !== m.h) syncDirty[k] = Date.now();
    else delete syncDirty[k];
    pulled.push(k);
    reschedule(k, cur[k], v);
  }
  if (!pulled.length) return;
  await local().set({ ...patch, syncState, syncDirty });
  if (pulled.some((k) => syncDirty[k])) schedulePush();
  await setStatus({ ok: true, error: null, pulled });
}

/** Turning sync on (or Sync now): newer copies come down, then everything that differs goes up. */
async function fullSync() {
  const { syncPrefs } = await local().get('syncPrefs');
  if (!syncPrefs?.on) return;
  const keys = syncKeys(syncPrefs);
  await pull(keys);
  const { syncState = {}, syncDirty = {} } = await getAll(['syncState', 'syncDirty']);
  const data = await local().get(keys);
  for (const k of keys) if (data[k] !== undefined && hashOf(k, data[k]) !== syncState[k]?.h) syncDirty[k] ||= Date.now();
  await local().set({ syncDirty });
  const error = await push();
  await setStatus({ ok: !error, error: error || null });
}

// Alarms and events that arrive from another computer ring here too (the alarm names the apps use). Reminders don't
// need this: js/bg/reminder.js re-plans their alarms whenever `reminders` changes.
function reschedule(key, before, after) {
  if (!chrome.alarms || !Array.isArray(after) || !['alarms', 'events'].includes(key)) return;
  const prev = new Map((Array.isArray(before) ? before : []).map((x) => [x?.id, JSON.stringify(x)]));
  const now = Date.now();
  const at = (name, when) => (when && when > now ? chrome.alarms.create(name, { when }) : chrome.alarms.clear(name));
  for (const x of after) {
    if (!x?.id || prev.get(x.id) === JSON.stringify(x)) continue;
    if (key === 'alarms') at('alarm:' + x.id, x.enabled ? nextAlarmTime(x) : null);
    else if (key === 'events') {
      const n = eventNorm(x, 'my'); // the same plan as js/calendar/data.js syncAlerts()
      at('event:' + x.id, n.readOnly ? null : nextAlert(n, now));
    }
  }
  const ids = new Set(after.map((x) => x?.id));
  const kind = { alarms: 'alarm', events: 'event' }[key];
  if (kind) for (const id of prev.keys()) if (id && !ids.has(id)) chrome.alarms.clear(kind + ':' + id);
}

const inWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope;
if (inWorker) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.syncPrefs) {
        const was = changes.syncPrefs.oldValue || {}, now = changes.syncPrefs.newValue || {};
        // turned off: forget what was in sync, so turning it on again merges like a first sync
        if (was.on && !now.on) queue(() => local().remove(['syncState', 'syncDirty']));
        else if (now.on && (!was.on || JSON.stringify(was.off || []) !== JSON.stringify(now.off || []))) queue(fullSync);
      }
      const keys = Object.keys(changes).filter(isSyncable);
      if (keys.length) queue(() => markDirty(keys, changes));
    } else if (area === 'sync') {
      const keys = Object.keys(changes).filter((k) => k.startsWith('m:') && changes[k].newValue).map((k) => k.slice(2));
      if (keys.length) queue(() => pull(keys));
    }
  });
  onAlarm('sync', () => queue(push));
  onMessage('sync-now', () => queue(fullSync).then(() => local().get('syncStatus')).then((x) => x.syncStatus || null));
  // Settings › Sync with Chrome › Erase synced data: this extension's items in chrome.storage.sync
  onMessage('sync-erase', () => queue(async () => {
    await sync().clear();
    await local().remove(['syncState', 'syncDirty']);
    await setStatus({ ok: true, error: null, pulled: [], pushed: [] });
  }));
  chrome.runtime.onStartup.addListener(() => queue(fullSync));
}
