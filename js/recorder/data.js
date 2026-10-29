// Voice Recorder storage: the `recorder` key (see model.js for its shape), `recorderPrefs`, and the audio in IndexedDB.
import { store } from '../core/store.js';
import { getBlob, putBlob, delBlob, listBlobs } from '../core/blobs.js';
import { uid } from '../core/util.js';
import * as M from './model.js';

export const D = () => M.norm(store.get(M.KEY));
/** Changes the data in place through fn(d); returns what fn returns. */
export function mut(fn) {
  let r;
  store.update(M.KEY, (v) => {
    const d = M.norm(v);
    r = fn(d);
    return d;
  });
  return r;
}
export const byId = (id) => D().items.find((m) => m.id === id) || null;
/** Sets fields of one recording; undefined, null and false remove a field. */
export const patch = (id, p) =>
  mut((d) => {
    const m = d.items.find((x) => x.id === id);
    if (m) for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === null || v === false) delete m[k];
      else m[k] = v;
    }
  });

export const prefs = () => M.normPrefs(store.get(M.PREFS));
export const setPrefs = (p) => store.set(M.PREFS, { ...prefs(), ...p });

export const audioBlob = (id) => getBlob(M.blobKey(id)).catch(() => null);

/** Deletes recordings for good: their entries, audio and any chunks left from recording. */
export async function destroy(ids) {
  const set = new Set(ids);
  mut((d) => {
    d.items = d.items.filter((m) => !set.has(m.id));
  });
  const keys = await listBlobs('recorder:').catch(() => []);
  await Promise.all(keys.filter((k) => ids.some((id) => k === M.blobKey(id) || M.isChunkOf(k, id))).map((k) => delBlob(k).catch(() => {})));
}
/** Empties recordings that have spent 30 days in the Recycle bin. */
export function purge() {
  const old = M.expired(D());
  if (old.length) destroy(old.map((m) => m.id));
  return old.length;
}
/** To the Recycle bin (or gone for good when the Recycle bin is off). Returns an undo function or null. */
export async function trash(ids) {
  if (!ids.length) return null;
  if (!prefs().bin) {
    await destroy(ids);
    return null;
  }
  const at = Date.now();
  mut((d) => {
    for (const m of d.items) if (ids.includes(m.id)) m.deletedAt = at;
  });
  return () => restore(ids);
}
export const restore = (ids) =>
  mut((d) => {
    for (const m of d.items) if (ids.includes(m.id)) delete m.deletedAt;
  });

/** A copy of a recording (its own audio), placed right after it. extra overrides fields (segs for "Save as new"). */
export async function duplicate(m, extra = {}) {
  const blob = await audioBlob(m.id);
  if (!blob) return null;
  const id = uid();
  await putBlob(M.blobKey(id), blob);
  mut((d) => {
    const i = d.items.findIndex((x) => x.id === m.id);
    const c = { ...structuredClone(m), id, at: Date.now(), ...extra };
    delete c.deletedAt;
    delete c.rec;
    for (const [k, v] of Object.entries(c)) if (v === undefined) delete c[k];
    d.items.splice(Math.max(0, i), 0, c);
  });
  return id;
}

export function addCat(name) {
  const id = uid();
  mut((d) => {
    d.cats.push({ id, name: name.slice(0, 60) });
  });
  return id;
}
export const renameCat = (id, name) =>
  mut((d) => {
    const c = d.cats.find((x) => x.id === id);
    if (c) c.name = name.slice(0, 60);
  });
/** Removes a category; its recordings become Uncategorized (Samsung keeps the files). */
export const deleteCat = (id) =>
  mut((d) => {
    d.cats = d.cats.filter((c) => c.id !== id);
    for (const m of d.items) if (m.cat === id) delete m.cat;
  });
export const catName = (id) => D().cats.find((c) => c.id === id)?.name || '';
