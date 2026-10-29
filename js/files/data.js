// My Files: Chrome's downloads behind the optional "downloads" permission, the Recycle bin and the app's preferences.
// Everything that touches chrome.downloads lives here so the UI, the widgets and Finder share one copy.
import { store } from '../core/store.js';
import { has, ensure } from '../core/perm.js';
import { isExt } from '../core/util.js';
import * as M from './model.js';

export const api = () => (isExt ? globalThis.chrome?.downloads : null);

// ——— permission ———
let grantedNow = null; // cached answer, refreshed when the permission changes
const permListeners = new Set();
export async function granted() {
  grantedNow = isExt && (await has('downloads')) && !!api();
  return grantedNow;
}
/** The last known answer without waiting (false until the first check finishes). */
export const isGranted = () => !!grantedNow;
export const onPermission = (fn) => (permListeners.add(fn), () => permListeners.delete(fn));
const permChanged = () => granted().then((g) => permListeners.forEach((fn) => fn(g)));
if (isExt && chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(permChanged);
  chrome.permissions.onRemoved.addListener(permChanged);
}

/** Asks for the "downloads" permission. Must run inside a click handler. */
export async function allow() {
  const ok = await ensure('downloads');
  if (ok) await granted();
  if (ok) permListeners.forEach((fn) => fn(true));
  return ok && isGranted();
}

// ——— the list ———
/** Every download Chrome remembers, newest first (search() also makes Chrome check that the files still exist). */
export async function list() {
  const D = api();
  if (!D || !(await granted())) return [];
  const all = await D.search({ orderBy: ['-startTime'], limit: 0 }).catch(() => []);
  return all.filter((d) => !M.isGhost(d));
}
export const active = async () => (api() && isGranted() ? api().search({ state: 'in_progress' }).catch(() => []) : []);
export const byId = async (id) => (api() ? (await api().search({ id }).catch(() => []))[0] || null : null);

/** Calls fn (debounced) whenever Chrome's download list changes. Returns the unsubscribe function. */
export function onDownloads(fn, ms = 120) {
  let tm = 0, D = null;
  const fire = () => {
    clearTimeout(tm);
    tm = setTimeout(fn, ms);
  };
  const bind = () => {
    if (D || !api()) return;
    D = api();
    D.onCreated.addListener(fire);
    D.onChanged.addListener(fire);
    D.onErased.addListener(fire);
  };
  bind();
  // the API appears in this page only once the permission is granted
  const offPerm = onPermission((g) => {
    if (g) bind();
    fire();
  });
  return () => {
    clearTimeout(tm);
    offPerm();
    if (D) {
      D.onCreated.removeListener(fire);
      D.onChanged.removeListener(fire);
      D.onErased.removeListener(fire);
    }
  };
}

// ——— OS file icons (Windows/macOS give real per-file icons; some Linux setups have none) ———
const icons = new Map();
export function osIcon(id) {
  if (!icons.has(id)) icons.set(id, api()?.getFileIcon ? api().getFileIcon(id, { size: 32 }).catch(() => '') : Promise.resolve(''));
  return icons.get(id);
}

// ——— actions ———
/** Opens the file with the computer's default app. Chrome only allows it from a click and with "downloads.open". */
export async function openFile(id) {
  if (!(await ensure('downloads.open'))) return 'denied';
  try {
    await api().open(id);
    return 'ok';
  } catch (e) {
    console.warn('open', e);
    return 'error';
  }
}
export const showInFolder = (id) => api()?.show(id);
export const showFolder = () => api()?.showDefaultFolder();
export const pause = (id) => api()?.pause(id).catch(() => {});
export const resume = (id) => api()?.resume(id).catch(() => {});
export const cancel = (id) => api()?.cancel(id).catch(() => {});
export const keepDangerous = (id) => api()?.acceptDanger(id).catch(() => {});
export const again = (d) => api()?.download({ url: d.finalUrl || d.url }).catch((e) => console.warn('download', e));

/** Removes downloads from Chrome's list; the files stay on disk. */
export async function eraseIds(ids) {
  for (const id of ids) await api()?.erase({ id }).catch(() => {});
  dropFromBin(ids);
}

/** Deletes the files from disk and forgets them. Files that are already gone are only forgotten. */
export async function destroy(ids) {
  const D = api();
  if (!D) return;
  for (const id of ids) {
    const [d] = await D.search({ id }).catch(() => []);
    if (d?.state === 'in_progress') await D.cancel(id).catch(() => {});
    else if (d?.state === 'complete' && d.exists !== false) await D.removeFile(id).catch((e) => console.warn('removeFile', id, e));
    await D.erase({ id }).catch(() => {});
  }
  dropFromBin(ids);
}

// ——— Recycle bin (store key `files`) ———
// Chrome can't move a file, so a file in the bin stays in the Downloads folder (hidden from My Files) until it's
// deleted for good: from the bin, by Empty, or 30 days later.
export const data = () => ({ bin: [], ...(store.get(M.KEY) || {}) });
export const binIds = () => new Set(data().bin.map((b) => b.id));
export function toBin(items) {
  const now = Date.now(), ids = new Set(items.map((d) => d.id));
  store.update(M.KEY, (v) => ({ ...(v || {}), bin: [...items.map((d) => M.binEntry(d, now)), ...((v?.bin) || []).filter((b) => !ids.has(b.id))] }));
}
export function restore(ids) {
  dropFromBin(ids);
}
function dropFromBin(ids) {
  const s = new Set(ids);
  if (!data().bin.some((b) => s.has(b.id))) return;
  store.update(M.KEY, (v) => ({ ...(v || {}), bin: ((v?.bin) || []).filter((b) => !s.has(b.id)) }));
}
/** Deletes what has been in the bin for 30 days, and forgets entries Chrome no longer knows. */
export async function purgeBin() {
  const D = api();
  if (!D || !(await granted())) return 0;
  const bin = data().bin;
  if (!bin.length) return 0;
  const old = M.expired(bin).map((b) => b.id);
  if (old.length) await destroy(old);
  const known = new Set((await D.search({ limit: 0 }).catch(() => null))?.map((d) => d.id) || bin.map((b) => b.id));
  const gone = data().bin.filter((b) => !known.has(b.id)).map((b) => b.id);
  if (gone.length) dropFromBin(gone);
  return old.length;
}

// ——— preferences (store key `filesPrefs`) ———
export const prefs = () => ({ sort: 'date', dir: 'desc', view: 'list', bin: true, recent: true, recentQ: [], ...(store.get(M.PREFS) || {}) });
export const setPrefs = (patch) => store.set(M.PREFS, { ...prefs(), ...patch });
