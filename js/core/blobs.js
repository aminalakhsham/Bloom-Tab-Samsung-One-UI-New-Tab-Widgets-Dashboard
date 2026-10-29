// Binary data (pictures, recordings, songs) in IndexedDB "bloom-blobs", keyed by "<app>:<id>".
// chrome.storage holds only JSON and small values; anything over ~100 KB belongs here.
//   await putBlob('recorder:abc', blob);  const b = await getBlob('recorder:abc');
//   img.src = await blobUrl('notes:img1');   (object URLs are cached per key until delBlob)
//   await delBlob('recorder:abc');  await listBlobs('recorder:')  -> keys
// eraseBlobs() wipes everything (Settings › Reset).

const DB = 'bloom-blobs', OS = 'blobs';
let dbp = null;
const urls = new Map();

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(OS, mode);
    const req = fn(t.objectStore(OS));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const putBlob = (key, blob) => {
  revoke(key);
  return tx('readwrite', (s) => s.put(blob, key));
};
export const getBlob = (key) => tx('readonly', (s) => s.get(key));
export const delBlob = (key) => {
  revoke(key);
  return tx('readwrite', (s) => s.delete(key));
};
export const listBlobs = async (prefix = '') => ((await tx('readonly', (s) => s.getAllKeys())) || []).filter((k) => String(k).startsWith(prefix));
export const eraseBlobs = () => {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  return tx('readwrite', (s) => s.clear());
};

/** An object URL for the blob (cached), or null when it doesn't exist. */
export async function blobUrl(key) {
  if (urls.has(key)) return urls.get(key);
  const b = await getBlob(key);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(key, u);
  return u;
}

function revoke(key) {
  const u = urls.get(key);
  if (u) URL.revokeObjectURL(u);
  urls.delete(key);
}

/** data: URL -> Blob (for pictures read with readImage()). */
export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}
