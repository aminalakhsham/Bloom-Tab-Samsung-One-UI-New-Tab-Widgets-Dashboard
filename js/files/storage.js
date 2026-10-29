// My Files › Storage: what Bloom Tab itself keeps on this computer (Samsung's "Internal storage", for the extension).
// Two places: chrome.storage.local (JSON: settings, lists; getBytesInUse) and IndexedDB (pictures, recordings, songs
// through core/blobs.js; navigator.storage.estimate()). Each app that stores files gets its share and a link.
import { isExt } from '../core/util.js';
import { listBlobs, getBlob } from '../core/blobs.js';

/** Apps that keep files, in the order the Storage page lists them. `keys` matches their chrome.storage keys. */
export const STORAGE_APPS = [
  { id: 'music', color: '#ff5a5f' },
  { id: 'recorder', color: '#f4483f' },
  { id: 'canvas', color: '#ffb020' },
  { id: 'journal', color: '#8f6cf4' },
  { id: 'wallet', color: '#2f6fe4' },
  { id: 'contacts', color: '#2fb36b' },
  { id: 'notes', color: '#f5a400' },
];
// "music", "musicLib", "musicPrefs"… belong to Music: the app id followed by nothing or a capital letter
const ownsKey = (id, key) => key === id || (key.startsWith(id) && /[A-Z]/.test(key[id.length]));
// blob keys are "<app>:<id>"
const blobApp = (key) => String(key).split(':')[0];
const sizeOfValue = (v) => (v == null ? 0 : v instanceof Blob ? v.size : v.byteLength ?? (typeof v === 'string' ? v.length * 2 : 0));

async function storageKeys() {
  if (chrome.storage.local.getKeys) return chrome.storage.local.getKeys();
  return Object.keys(await chrome.storage.local.get(null));
}

/**
 * { used, json, idb, quota, available, apps: [{ id, color, json, files, total }], other }
 * json = chrome.storage bytes, idb = IndexedDB and the rest of the site's storage, quota = what the browser allows.
 */
export async function measure() {
  const out = { used: 0, json: 0, idb: 0, quota: 0, available: 0, apps: STORAGE_APPS.map((a) => ({ ...a, json: 0, files: 0, total: 0 })), other: 0 };
  const est = await navigator.storage?.estimate?.().catch(() => null);
  out.idb = est?.usage || 0;
  out.quota = est?.quota || 0;
  const files = {};
  try {
    const keys = await listBlobs('');
    const sizes = await Promise.all(keys.map((k) => getBlob(k).then(sizeOfValue, () => 0)));
    keys.forEach((k, i) => (files[blobApp(k)] = (files[blobApp(k)] || 0) + sizes[i]));
  } catch {}
  if (isExt) {
    out.json = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
    const keys = await storageKeys().catch(() => []);
    await Promise.all(out.apps.map(async (a) => {
      const mine = keys.filter((k) => ownsKey(a.id, k));
      a.json = mine.length ? await chrome.storage.local.getBytesInUse(mine).catch(() => 0) : 0;
    }));
  }
  let counted = 0;
  for (const a of out.apps) {
    a.files = files[a.id] || 0;
    a.total = a.json + a.files;
    counted += a.total;
  }
  // the browser's estimate is rounded and padded, so the blobs we counted can exceed it on a fresh profile
  out.idb = Math.max(out.idb, Object.values(files).reduce((s, n) => s + n, 0));
  out.used = out.json + out.idb;
  out.other = Math.max(0, out.used - counted);
  out.available = Math.max(0, out.quota - out.idb);
  return out;
}
