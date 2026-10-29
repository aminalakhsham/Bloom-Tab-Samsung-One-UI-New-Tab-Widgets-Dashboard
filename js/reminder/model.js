// Reminder data model. Pure (no DOM, no storage, no chrome.*): the app, its widgets, the Routines action, the
// service worker (js/bg/reminder.js) and the plain-node tests all use it.
//
// Store key `reminders` stays a plain array, as before wave 3: Health (Tasks ring), Journal (suggestions), the Now
// Brief, Calendar, the side panel, Quick capture, Routines and Finder read or write it directly, so every field added
// since is optional and old items keep working untouched.
//   item = { id, title, notes, due: ms | null, done, priority: bool (Important, the star), created, completedAt,
//            cat?: category id (missing or unknown = the default category 'rem'),
//            repeat?: { f: 'd' | 'w' | 'm' | 'y', n?: every n, days?: [0-6] (weekly), dom?: day of month, end?: ms },
//            early?: minutes (an early alert before `due`), snooze?: ms (a snoozed repeating reminder rings then),
//            url?, imgs?: [image id] (IndexedDB blobs 'reminder:<image id>'), subs?: [{ id, title, done }],
//            order?: number (custom order inside a category; default -created, newest first),
//            from?: id (the completed copy a repeating reminder leaves behind) }
// Store key `reminderCats` = { list: [{ id, name, color, icon, sort?, showDone? }] } — 'rem' is the default category
// ("Reminders"; its name stays translated until the user renames it).
// Alarms: 'reminder:<id>' at the due time (or the next occurrence of an overdue repeating reminder, or the snooze),
// 'reminder:<id>~e' for the early alert. alarmPlan() is the one place that decides them, for the pages and the SW.

export const KEY = 'reminders';
export const CAT_KEY = 'reminderCats';
export const DEF_CAT = 'rem';
export const VIEWS = ['today', 'scheduled', 'all', 'completed'];
export const COLORS = ['#3e7bff', '#22a356', '#ff6a3d', '#e5484d', '#a259ff', '#f5a524', '#14b8a6', '#ec4899', '#795548', '#8e8f97'];
export const CAT_ICONS = ['list', 'rmWork', 'rmHome', 'rmCart', 'rmHeart', 'rmBook', 'rmPlane', 'rmGift', 'rmFit', 'rmMoney', 'rmPaw', 'star'];
export const EARLY = [5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const SORTS = ['manual', 'due', 'created', 'title', 'aisle'];

const DAY = 864e5;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** The stored list as an array of items (tolerates a missing key or junk entries). */
export const items = (v) => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : []).filter((r) => r && r.id);

/** Categories with the default one always present. */
export function normCats(v) {
  const list = (Array.isArray(v?.list) ? v.list : []).filter((c) => c && c.id);
  if (!list.some((c) => c.id === DEF_CAT)) list.unshift({ id: DEF_CAT, name: '', color: COLORS[0], icon: 'list' });
  return { ...(v && typeof v === 'object' ? v : {}), list };
}
export const catOf = (cats, r) => cats.list.find((c) => c.id === r?.cat) || cats.list.find((c) => c.id === DEF_CAT);
export const catIdOf = (cats, r) => catOf(cats, r).id;

// ——— dates ———
export const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const endOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
export const isOverdue = (r, now = Date.now()) => !r.done && !!r.due && r.due < now;
/** Due today or overdue, still open (the Today tile). */
export const isToday = (r, now = Date.now()) => !r.done && !!r.due && r.due < endOfDay(now);

// ——— views ———
export const FILTERS = {
  today: (r, now) => isToday(r, now),
  scheduled: (r) => !r.done && !!r.due,
  all: (r) => !r.done,
  completed: (r) => !!r.done,
};
export const inView = (cats, view, r, now = Date.now()) => (FILTERS[view] ? FILTERS[view](r, now) : catIdOf(cats, r) === view);
export const count = (cats, list, view, now = Date.now()) => list.filter((r) => (FILTERS[view] ? FILTERS[view](r, now) : !r.done && catIdOf(cats, r) === view)).length;

// ——— order ———
export const ord = (r) => r.order ?? -(r.created || 0);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Important first, then the earliest due, then the newest (the widgets, Finder and the smart views). */
export const bySmart = (a, b) => (!!b.priority - !!a.priority) || ((a.due || Infinity) - (b.due || Infinity)) || ((b.created || 0) - (a.created || 0));
export const byDue = (a, b) => ((a.due || Infinity) - (b.due || Infinity)) || (!!b.priority - !!a.priority) || ((b.created || 0) - (a.created || 0));
export function sortBy(arr, mode = 'manual') {
  const cmp = {
    manual: (a, b) => ord(a) - ord(b),
    due: byDue,
    created: (a, b) => (b.created || 0) - (a.created || 0),
    title: (a, b) => collator.compare(a.title || '', b.title || ''),
  }[mode] || ((a, b) => ord(a) - ord(b));
  return arr.slice().sort(cmp);
}
/** An order value between two neighbours (either may be missing). */
export const between = (a, b) => (a == null && b == null ? 0 : a == null ? b - 1 : b == null ? a + 1 : (a + b) / 2);

// ——— repeat ———
/** A clean repeat value (or null): f in d/w/m/y, n ≥ 1, weekdays for weekly, the month day for monthly/yearly. */
export function normRepeat(rp, due) {
  if (!rp || !'dwmy'.includes(rp.f) || !rp.f) return null;
  const out = { f: rp.f };
  const n = Math.round(+rp.n || 1);
  if (n > 1) out.n = Math.min(n, 999);
  if (rp.f === 'w' && Array.isArray(rp.days) && rp.days.length) out.days = [...new Set(rp.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if ((rp.f === 'm' || rp.f === 'y') && (rp.dom || due)) out.dom = rp.dom || new Date(due).getDate();
  if (rp.end) out.end = +rp.end;
  return out;
}
const weekNo = (d) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY + 4) / 7); // Sunday-based weeks since 1970
/** The occurrence after `t` (one step of the repeat), keeping the time of day. */
export function step(t, rp) {
  const n = Math.max(1, rp.n || 1);
  const x = new Date(t);
  if (rp.f === 'd') x.setDate(x.getDate() + n);
  else if (rp.f === 'w') {
    if (rp.days?.length) {
      const w0 = weekNo(x);
      for (let i = 0; i < 7 * (n + 1); i++) {
        x.setDate(x.getDate() + 1);
        if (rp.days.includes(x.getDay()) && (weekNo(x) - w0) % n === 0) break;
      }
    } else x.setDate(x.getDate() + 7 * n);
  } else if (rp.f === 'm' || rp.f === 'y') {
    const dom = rp.dom || x.getDate();
    const y = x.getFullYear() + (rp.f === 'y' ? n : 0), mo = x.getMonth() + (rp.f === 'm' ? n : 0);
    const last = new Date(y, mo + 1, 0).getDate();
    return new Date(y, mo, Math.min(dom, last), x.getHours(), x.getMinutes(), 0, 0).getTime();
  } else return null;
  return x.getTime();
}
/** The first occurrence strictly after `t` (null when the repeat has ended). */
export function nextAfter(r, t) {
  const rp = r.repeat;
  if (!rp || !r.due) return null;
  let x = r.due;
  for (let i = 0; i < 5000 && x <= t; i++) {
    const nx = step(x, rp);
    if (nx == null || nx <= x) return null;
    x = nx;
  }
  if (x <= t) return null;
  if (rp.end && x >= endOfDay(rp.end)) return null;
  return x;
}
/** The latest occurrence at or before `t` (the one that is ringing now), starting from r.due. */
export function latestAtOrBefore(r, t) {
  if (!r.due || r.due > t) return null;
  if (!r.repeat) return r.due;
  let x = r.due;
  for (let i = 0; i < 5000; i++) {
    const nx = step(x, r.repeat);
    if (nx == null || nx > t || nx <= x || (r.repeat.end && nx >= endOfDay(r.repeat.end))) return x;
    x = nx;
  }
  return x;
}

// ——— alarms ———
/** When the reminder rings next: its due time, else (overdue and repeating) its next occurrence. */
export function fireAt(r, now = Date.now()) {
  if (!r || r.done || !r.due) return null;
  if (r.due > now) return r.due;
  return r.repeat ? nextAfter(r, now) : null;
}
/** The chrome.alarms a reminder should have: [[name, when]]. */
export function alarmPlan(r, now = Date.now()) {
  const out = [];
  if (!r || r.done || !r.due) return out;
  const at = fireAt(r, now);
  const main = r.snooze && r.snooze > now && (!at || r.snooze < at) ? r.snooze : at;
  if (main) out.push(['reminder:' + r.id, main]);
  if (r.early > 0 && at) {
    const e = at - r.early * 60e3;
    if (e > now) out.push(['reminder:' + r.id + '~e', e]);
  }
  return out;
}
export const alarmNames = (id) => ['reminder:' + id, 'reminder:' + id + '~e'];

// ——— changes (pure: they return a new array; changed items are new objects, the others are the same) ———
const without = (o, ...keys) => {
  const x = { ...o };
  for (const k of keys) delete x[k];
  return x;
};
/** A new reminder with every field filled in. */
export function make(fields = {}, now = Date.now()) {
  const r = { id: uid(), title: '', notes: '', due: null, done: false, priority: false, created: now, completedAt: null, ...fields };
  if (r.repeat) r.repeat = normRepeat(r.repeat, r.due);
  if (!r.repeat) delete r.repeat;
  if (!r.cat || r.cat === DEF_CAT) delete r.cat;
  return r;
}
/**
 * Completes a reminder. A repeating one moves on to its next occurrence (after today's, so an overdue daily reminder
 * doesn't stay overdue) and leaves a completed copy behind for the Completed list, Health and Journal. Completing a
 * reminder ticks its subtasks.
 */
export function complete(list, id, now = Date.now()) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || list[i].done) return list;
  const r = list[i], out = list.slice();
  if (r.repeat && r.due) {
    const nx = nextAfter(r, Math.max(r.due, now));
    if (nx) {
      const copy = { ...without(r, 'repeat', 'early', 'snooze', 'order'), id: uid(), done: true, completedAt: now, from: r.id };
      if (r.subs) copy.subs = r.subs.map((s) => ({ ...s, done: true }));
      out[i] = { ...without(r, 'snooze'), due: nx, ...(r.subs ? { subs: r.subs.map((s) => ({ ...s, done: false })) } : {}) };
      out.splice(i + 1, 0, copy);
      return out;
    }
  }
  out[i] = { ...without(r, 'snooze'), done: true, completedAt: now, ...(r.subs ? { subs: r.subs.map((s) => ({ ...s, done: true })) } : {}) };
  return out;
}
export function uncomplete(list, id) {
  return list.map((r) => (r.id === id && r.done ? { ...without(r, 'from'), done: false, completedAt: null } : r));
}
export function patchIn(list, id, fields) {
  return list.map((r) => {
    if (r.id !== id) return r;
    const x = { ...r, ...fields };
    if ('repeat' in fields) {
      x.repeat = normRepeat(fields.repeat, x.due);
      if (!x.repeat) delete x.repeat;
    }
    if ('due' in fields && fields.due !== r.due) delete x.snooze;
    if (x.cat === DEF_CAT || x.cat == null) delete x.cat;
    for (const k of ['early', 'url', 'imgs', 'subs']) if (x[k] == null || (Array.isArray(x[k]) && !x[k].length) || x[k] === '' || x[k] === 0) delete x[k];
    return x;
  });
}
/**
 * Repeating reminders that another writer simply marked done (the side panel, an older page) are rolled on the way
 * complete() would have done it: back to open at their next occurrence, plus the completed copy. complete() itself
 * never leaves a repeating reminder done while it has a next occurrence, so this only catches the others.
 */
export function rollDone(list) {
  let out = list;
  for (const r of list) {
    if (!r.done || !r.repeat || !r.due || r.from) continue;
    const at = r.completedAt || Date.now();
    if (!nextAfter(r, Math.max(r.due, at))) continue;
    out = complete(uncomplete(out, r.id), r.id, at);
  }
  return out;
}
/** What the service worker does when an alarm rings: a repeating reminder that rings for a later occurrence than its
 *  due (missed ones) moves its due to that occurrence; a snooze that rang is cleared. Returns the new item or null. */
export function rang(r, now = Date.now()) {
  if (!r || r.done) return null;
  let x = r;
  if (r.snooze && r.snooze <= now + 60e3) x = without(x, 'snooze');
  if (r.repeat && r.due) {
    const cur = latestAtOrBefore(r, now + 60e3);
    if (cur && cur > r.due) x = { ...x, due: cur };
  }
  return x === r ? null : x;
}
