// Reminder data in the pages: reads and writes store key `reminders` through the pure model (js/reminder/model.js)
// and keeps each reminder's chrome.alarms in step. The service worker (js/bg/reminder.js) also reconciles every alarm
// whenever `reminders` changes, so writers that skip this module (backup restore, the side panel) still ring.
// change() returns an undo function: every Undo in the app (complete, delete, move…) goes through it.
import { store } from '../core/store.js';
import { scheduleAt, cancelSchedule } from '../core/schedule.js';
import * as M from './model.js';

export const list = () => M.items(store.get(M.KEY));
export const cats = () => M.normCats(store.get(M.CAT_KEY));
export const find = (id) => list().find((r) => r.id === id) || null;

/** Schedules (or clears) the reminder's alarms: 'reminder:<id>' and the early alert 'reminder:<id>~e'. */
export function syncAlarms(r) {
  const plan = new Map(r ? M.alarmPlan(r) : []);
  for (const name of M.alarmNames(r.id)) {
    if (plan.has(name)) scheduleAt(name, plan.get(name));
    else cancelSchedule(name);
  }
}

/**
 * Applies fn(list) → new list (changed items as new objects), syncs the alarms of what changed, and returns an
 * undo function that puts those items back as they were (removed ones at their old place, added ones gone).
 */
export function change(fn) {
  const before = list();
  const after = fn(before);
  if (after === before) return () => {};
  store.set(M.KEY, after);
  const bMap = new Map(before.map((r) => [r.id, r])), aMap = new Map(after.map((r) => [r.id, r]));
  const touched = new Set();
  for (const r of after) if (bMap.get(r.id) !== r) touched.add(r.id);
  for (const r of before) if (!aMap.has(r.id)) touched.add(r.id);
  for (const id of touched) syncAlarms(aMap.get(id) || { id });
  return () => {
    store.set(M.KEY, (() => {
      let out = list().filter((r) => !(touched.has(r.id) && !bMap.has(r.id)));
      out = out.map((r) => (touched.has(r.id) && bMap.has(r.id) ? bMap.get(r.id) : r));
      before.forEach((r, i) => {
        if (touched.has(r.id) && !out.some((x) => x.id === r.id)) out.splice(Math.min(i, out.length), 0, r);
      });
      return out;
    })());
    for (const id of touched) syncAlarms(bMap.get(id) || { id });
  };
}

/** Adds a reminder (Finder, Quick capture, the side panel, Routines and the app); returns it. */
export function addReminder(fields = {}) {
  const r = M.make(fields);
  change((l) => [r, ...l]);
  return r;
}
export function patch(id, fields) {
  change((l) => M.patchIn(l, id, fields));
  return find(id);
}
export const setDone = (id, done = true) => change((l) => (done ? M.complete(l, id) : M.uncomplete(l, id)));
export const setDoneMany = (ids, done = true) => change((l) => ids.reduce((acc, id) => (done ? M.complete(acc, id) : M.uncomplete(acc, id)), l));
export const removeMany = (ids) => change((l) => l.filter((r) => !ids.includes(r.id)));
export const patchMany = (ids, fields) => change((l) => ids.reduce((acc, id) => M.patchIn(acc, id, fields), l));

// ——— categories ———
export const setCats = (fn) => store.set(M.CAT_KEY, fn(cats()));
export function addCat(fields) {
  const c = { id: M.uid(), name: '', color: M.COLORS[1], icon: 'list', ...fields };
  setCats((v) => ({ ...v, list: [...v.list, c] }));
  return c;
}
export const patchCat = (id, fields) => setCats((v) => ({ ...v, list: v.list.map((c) => (c.id === id ? { ...c, ...fields } : c)) }));
/** Deletes a category and the reminders in it (as Samsung Reminder does); returns an undo function. */
export function removeCat(id) {
  if (id === M.DEF_CAT) return () => {};
  const before = cats();
  const undoItems = change((l) => l.filter((r) => r.cat !== id));
  setCats((v) => ({ ...v, list: v.list.filter((c) => c.id !== id) }));
  return () => {
    store.set(M.CAT_KEY, before);
    undoItems();
  };
}
