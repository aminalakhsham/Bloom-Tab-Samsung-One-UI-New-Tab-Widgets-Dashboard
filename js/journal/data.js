// Journal on the page side: reading and writing the 'journal' key, and the helpers other surfaces use (a streak for
// a widget, a quick entry from Finder, search results). Lock state lives in lock.js.
import { store } from '../core/store.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import { delBlob } from '../core/blobs.js';
import { t, lang } from '../core/i18n.js';
import * as M from './model.js';

// Plural strings are one key with forms separated by "|" in the order other|one|two|few|many|zero (English needs only
// the first two; Arabic uses all six), e.g. '{n} entries|1 entry'. A missing form falls back to the first.
const ORDER = ['other', 'one', 'two', 'few', 'many', 'zero'];
export function pl(key, n, vars = {}) {
  let cat = 'other';
  try {
    cat = new Intl.PluralRules(lang()).select(n);
  } catch {}
  const forms = t(key).split('|');
  return (forms[ORDER.indexOf(cat)] || forms[0]).replace(/\{(\w+)\}/g, (_, k) => (k === 'n' ? n : vars[k] ?? ''));
}

export const D = () => M.norm(store.get(M.KEY));
/** Changes the journal: fn(d) edits a normalized copy in place (or returns a new one). Returns what fn returned. */
export function mut(fn) {
  let out;
  store.update(M.KEY, (v) => {
    const d = M.norm(v);
    out = fn(d);
    return out && typeof out === 'object' && Array.isArray(out.entries) ? out : d;
  });
  return out;
}

/** { current, best, today } days in a row with an entry. */
export const streak = () => M.streak(D());
/** Saves a new entry (to the Default journal unless `journal` is given) and returns it. */
export function addEntry(f = {}) {
  let entry;
  mut((d) => {
    const r = M.addEntry(d, f);
    entry = r.entry;
    return r.d;
  });
  return entry;
}

/** Live entries matching `q`, newest first. */
export const searchEntries = (q, limit = 5) => (q ? M.sorted(M.live(D()).filter((e) => M.matches(e, q))).slice(0, limit) : []);

// Pictures and drawings leave IndexedDB with the entries that held them (deleted for good, or purged after 30 days).
// Only those ids are checked, never a sweep of every journal: blob, which could take the photos of an entry another
// tab is still writing and hasn't saved yet.
export function dropBlobs(ids) {
  if (!ids?.size && !ids?.length) return;
  setTimeout(() => {
    const used = M.blobIds(D());
    for (const id of ids) if (id && !used.has(id)) delBlob(id).catch(() => {});
  }, 300);
}
/** Empties the Recycle bin of entries older than 30 days (run when the app opens). */
export function purgeOld() {
  const p = M.purge(D());
  if (!p.removed.length) return 0;
  mut(() => p.d);
  dropBlobs(M.blobIds({ entries: p.removed }));
  return p.removed.length;
}

/** The journaling schedule's alarm ('journal:remind'), set from the page; the service worker plans the next one when it rings. */
export function syncSchedule(prefs = D().prefs) {
  const when = M.nextScheduleAt(prefs.schedule);
  if (when) scheduleAt('journal:remind', when);
  else cancelSchedule('journal:remind');
}
