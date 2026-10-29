// Reading and writing the `canvas` key (the boards), shared by the gallery and the board. Pictures and previews of
// boards erased for good (from the Recycle bin, or 30 days after deleting) are deleted from IndexedDB unless another
// board or the Canvas clipboard still uses them.
import { store } from '../core/store.js';
import { delBlob, listBlobs } from '../core/blobs.js';
import * as M from './model.js';

export const KEY = 'canvas';
export const CLIP = 'cv.clip';
/** The boards as stored (a quick check only: the full clean-up runs once when the app opens). */
export const all = () => {
  const v = store.get(KEY);
  return Array.isArray(v) ? v.filter((b) => b && typeof b.id === 'string' && Array.isArray(b.items)) : [];
};
export const byId = (id) => all().find((b) => b.id === id) || null;
export function put(board) {
  const list = all(), i = list.findIndex((b) => b.id === board.id);
  store.set(KEY, i < 0 ? [board, ...list] : list.map((b) => (b.id === board.id ? board : b)));
}
export function update(id, fn) {
  const b = byId(id);
  if (!b) return null;
  const next = { ...b, ...fn(b) };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  put(next);
  return next;
}
/** Opens the app on clean data: unreadable boards are dropped, and boards deleted over 30 days ago are erased. */
export function tidy() {
  const raw = store.get(KEY), list = M.normBoards(raw);
  const { keep, gone } = M.purge(list);
  if (gone.length || (raw != null && (!Array.isArray(raw) || raw.length !== list.length))) store.set(KEY, keep);
  if (gone.length) dropBlobs(gone, keep);
  return keep;
}
function referenced(list) {
  const s = new Set();
  for (const b of list) for (const id of M.blobsOf(b)) s.add(id);
  try {
    for (const it of JSON.parse(localStorage.getItem(CLIP) || 'null')?.items || []) if (it.b) s.add(it.b);
  } catch { /* no clipboard */ }
  return s;
}
function dropBlobs(gone, keep) {
  const used = referenced(keep);
  for (const b of gone) for (const id of M.blobsOf(b)) if (!used.has(id)) delBlob(id).catch(() => {});
}
export const trash = (id) => update(id, () => ({ deleted: Date.now() }));
export const restore = (id) => update(id, () => ({ deleted: undefined }));
/** Erases boards for good (from the Recycle bin). */
export function destroy(ids) {
  const set = new Set(ids), list = all();
  const keep = list.filter((b) => !set.has(b.id)), gone = list.filter((b) => set.has(b.id));
  store.set(KEY, keep);
  dropBlobs(gone, keep);
}
export async function duplicate(id, name) {
  const b = byId(id);
  if (!b) return null;
  const copy = M.duplicateBoard(b, name);
  put(copy);
  try {
    const { makeThumbs } = await import('./export.js');
    const thumb = await makeThumbs(copy);
    update(copy.id, () => ({ thumb }));
  } catch (e) { console.warn(e); }
  return copy.id;
}
/** Deletes `canvas:` blobs no board uses any more (at most once a day). */
export async function sweep() {
  try {
    if (Date.now() - (+localStorage.getItem('cv.sweep') || 0) < M.DAY) return;
    localStorage.setItem('cv.sweep', String(Date.now()));
  } catch { return; }
  const used = referenced(all()), now = Date.now();
  // anything made in the last day is left alone: another tab may have added it to a board it hasn't saved yet
  for (const k of await listBlobs('canvas:').catch(() => [])) if (!used.has(k) && now - M.bornAt(k) > M.DAY) delBlob(k).catch(() => {});
}
