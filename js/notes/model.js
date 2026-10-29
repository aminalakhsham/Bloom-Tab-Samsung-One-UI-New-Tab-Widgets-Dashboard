// Samsung Notes data beyond the note list itself. Every store key keeps a shape other surfaces can read without
// knowing about the rest (the side panel, Finder `note:`, Routines and Quick capture all write `notes` directly):
//   notes        [{ id, title, body (html.js), color, pinned, created, updated,
//                   folder?, fav?, paper? ('lined' | 'grid' | 'dots'), locked? }]   — the live notes only
//   notesBin     [{ …note, deletedAt }]  Recently deleted, kept 30 days (then deleted with their pictures)
//   noteFolders  [{ id, name, color, created }]
//   notesLocked  { [id]: body }  the text of locked notes: `notes` keeps only their title (Samsung shows it with a
//                lock), so widgets, Finder and the side panel never see what a locked note says
// Pictures, drawings and recordings are blobs `notes:<id>` (drawings' strokes `notes:<id>:v`) in IndexedDB.
import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { delBlob, listBlobs } from '../core/blobs.js';
import { noteText, tagsOf, attIds } from './html.js';

export const KEY = 'notes', BIN = 'notesBin', FOLDERS = 'noteFolders', VAULT = 'notesLocked', VIEW = 'notesView';
export const DAY = 864e5, KEEP_DAYS = 30;
export const FOLDER_COLORS = ['#f5c400', '#ff8a3d', '#f2556b', '#e45bb0', '#9a6cf2', '#3e8bff', '#21b0c9', '#2fb36b', '#8a8d96'];
export const PAPERS = ['plain', 'lined', 'grid', 'dots'];

const arr = (v) => (Array.isArray(v) ? v : []);
export const all = () => arr(store.get(KEY));
export const bin = () => arr(store.get(BIN));
export const folders = () => arr(store.get(FOLDERS));
export const vault = () => {
  const v = store.get(VAULT);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
export const byId = (id) => all().find((n) => n.id === id) || null;
export const binById = (id) => bin().find((n) => n.id === id) || null;
export const folderById = (id) => folders().find((f) => f.id === id) || null;
/** The note's folder id, or null when it has none (or its folder was deleted). */
export const folderOf = (n) => (n.folder && folderById(n.folder) ? n.folder : null);
export const isLocked = (n) => !!n?.locked;
/** The text a note is searched and tagged by: a locked note only gives its title. */
export const searchText = (n) => (isLocked(n) ? n.title || '' : `${n.title || ''}\n${noteText(n.body)}`);
export const daysLeft = (n, now = Date.now()) => Math.max(0, Math.ceil((n.deletedAt + KEEP_DAYS * DAY - now) / DAY));

// ——— writes ———
export function patch(id, fields, touch = true) {
  store.update(KEY, (l) => arr(l).map((n) => (n.id === id ? { ...n, ...fields, ...(touch ? { updated: Date.now() } : {}) } : n)));
}
export function create(fields = {}) {
  const now = Date.now();
  const n = { id: uid(), title: '', body: '', color: 'none', pinned: false, created: now, updated: now, ...fields };
  store.update(KEY, (l) => [n, ...arr(l)]);
  return n;
}

/** Moves notes to Recently deleted. Returns what's needed to undo it. */
export function trash(ids) {
  const now = Date.now(), list = all(), gone = [];
  list.forEach((n, i) => ids.includes(n.id) && gone.push({ n, i }));
  if (!gone.length) return null;
  store.set(KEY, list.filter((n) => !ids.includes(n.id)));
  store.set(BIN, [...gone.map(({ n }) => ({ ...n, deletedAt: now })), ...bin().filter((n) => !ids.includes(n.id))]);
  return gone;
}
/** Undoes trash(): the notes go back where they were. */
export function untrash(gone) {
  if (!gone?.length) return;
  const ids = gone.map((g) => g.n.id);
  store.set(BIN, bin().filter((n) => !ids.includes(n.id)));
  store.update(KEY, (l) => {
    const c = arr(l).filter((n) => !ids.includes(n.id));
    for (const { n, i } of [...gone].sort((a, b) => a.i - b.i)) c.splice(Math.min(i, c.length), 0, n);
    return c;
  });
}
/** Restores notes from Recently deleted (into their folder when it still exists). */
export function restore(ids) {
  const back = bin().filter((n) => ids.includes(n.id)).map(({ deletedAt, ...n }) => (n.folder && !folderById(n.folder) ? { ...n, folder: undefined } : n));
  store.set(BIN, bin().filter((n) => !ids.includes(n.id)));
  store.update(KEY, (l) => [...back, ...arr(l).filter((n) => !ids.includes(n.id))]);
  return back.length;
}
/** Deletes notes from Recently deleted for good, with their pictures and locked text. */
export function destroy(ids) {
  const gone = bin().filter((n) => ids.includes(n.id));
  store.set(BIN, bin().filter((n) => !ids.includes(n.id)));
  const v = vault();
  if (gone.some((n) => v[n.id] != null)) {
    const nv = { ...v };
    gone.forEach((n) => delete nv[n.id]);
    store.set(VAULT, nv);
  }
  for (const n of gone) for (const k of [...attIds(n.body), ...attIds(v[n.id])]) delBlob(k).catch(() => {});
}
/** Recently deleted keeps notes for 30 days. */
export function purge(now = Date.now()) {
  const old = bin().filter((n) => !n.deletedAt || now - n.deletedAt >= KEEP_DAYS * DAY);
  if (old.length) destroy(old.map((n) => n.id));
}
/** Removes pictures no note refers to any more (pictures taken out of a note, notes deleted elsewhere). */
export async function sweep() {
  try {
    const v = vault();
    const used = new Set([...all(), ...bin()].flatMap((n) => [...attIds(n.body), ...attIds(v[n.id])]));
    for (const k of await listBlobs('notes:')) if (!used.has(k)) await delBlob(k);
  } catch {}
}

// ——— favourites, folders ———
export const setFav = (ids, on) => store.update(KEY, (l) => arr(l).map((n) => (ids.includes(n.id) ? { ...n, fav: on || undefined } : n)));
export const moveTo = (ids, folder) => store.update(KEY, (l) => arr(l).map((n) => (ids.includes(n.id) ? { ...n, folder: folder || undefined } : n)));
export function newFolder(name, color = FOLDER_COLORS[5]) {
  const f = { id: uid(), name: String(name).trim().slice(0, 60), color, created: Date.now() };
  store.set(FOLDERS, [...folders(), f]);
  return f;
}
export const editFolder = (id, fields) => store.set(FOLDERS, folders().map((f) => (f.id === id ? { ...f, ...fields } : f)));
/** Deletes a folder; the notes in it go to Recently deleted (as in Samsung Notes). */
export function deleteFolder(id) {
  const ids = all().filter((n) => n.folder === id).map((n) => n.id);
  store.set(FOLDERS, folders().filter((f) => f.id !== id));
  if (ids.length) trash(ids);
  return ids.length;
}
export const folderCount = (id) => all().filter((n) => n.folder === id).length;

// ——— tags ———
/** [{ key, name, count }] over the live notes, A–Z (locked notes give only their title). */
export function allTags() {
  const m = new Map();
  for (const n of all()) {
    for (const [k, name] of tagsOf(searchText(n))) {
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { key: k, name, count: 1 });
    }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const hasTag = (n, k) => tagsOf(searchText(n)).has(k);

// ——— locked notes ———
/** The body of a locked note (with anything written into its stub elsewhere added at the end). */
export function lockedBody(n) {
  const v = vault()[n.id] || '';
  return n.body ? v + n.body : v;
}
/** Locks a note: its text moves out of `notes` into the vault. */
export function lock(id) {
  const n = byId(id);
  if (!n || n.locked) return;
  store.set(VAULT, { ...vault(), [id]: n.body || '' });
  patch(id, { locked: true, body: '' }, false);
}
/** Removes the lock for good: the text comes back into `notes`. */
export function unlock(id) {
  const n = byId(id);
  if (!n?.locked) return;
  const body = lockedBody(n);
  const v = { ...vault() };
  delete v[id];
  patch(id, { locked: undefined, body }, false);
  store.set(VAULT, v);
}
/** Saves an open locked note: the title in `notes`, the text in the vault. */
export function saveLocked(id, title, body) {
  store.set(VAULT, { ...vault(), [id]: body });
  patch(id, { title, body: '' });
}

// ——— views (the drawer) ———
/** Notes shown by a drawer view: { kind: 'all' | 'fav' | 'folder' | 'tag' | 'bin', id }. */
export function inView(view) {
  if (view.kind === 'bin') return bin();
  const l = all();
  if (view.kind === 'fav') return l.filter((n) => n.fav);
  if (view.kind === 'folder') return l.filter((n) => n.folder === view.id);
  if (view.kind === 'tag') return l.filter((n) => hasTag(n, view.id));
  return l;
}
