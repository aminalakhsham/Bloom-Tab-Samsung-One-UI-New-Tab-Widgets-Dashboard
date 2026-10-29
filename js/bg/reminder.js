// Reminder in the service worker: rings 'reminder:<id>' as a system notification (Mark as done / Snooze 10 min) and the
// early alert 'reminder:<id>~e' (Mark as done), moves a repeating reminder on to its next occurrence, and keeps every
// reminder's alarms in step with storage — when Chrome starts, when the extension is installed or updated, and
// whenever `reminders` changes. That last part is what makes reminders written straight into storage ring (a backup
// restore, the side panel, Quick capture, a routine): js/reminder/model.js alarmPlan() decides, here and in the pages.
import { onAlarm, onButton, openTarget, post, bgStrings, bgTime, fmt } from './hub.js';
import * as M from '../reminder/model.js';
import { registerReminderAction } from '../reminder/action.js';

const S = {
  en: { reminder: 'Reminder', done: 'Mark as done', snooze: 'Snooze 10 min', dueAt: 'Due at {time}' },
  ar: { reminder: 'تذكير', done: 'تحديد كمكتمل', snooze: 'تأجيل 10 دقائق', dueAt: 'موعده {time}' },
};
const SNOOZE = 10 * 60e3;
const local = chrome.storage.local;

// One queue for every read-modify-write of `reminders` and every reconcile in this worker, so two alarms ringing
// together (or a button and a storage change) never overwrite each other.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn).catch((e) => console.error('reminder', e)));
const read = async () => M.items((await local.get(M.KEY))[M.KEY]);
/** fn(list) → new list (or the same list for no change). */
const write = (fn) => serial(async () => {
  const l = await read();
  const n = fn(l);
  if (n !== l) await local.set({ [M.KEY]: n });
});
const split = (rest) => (rest.endsWith('~e') ? [rest.slice(0, -2), true] : [rest, false]);

/** Every reminder gets the alarms alarmPlan() wants; alarms of deleted or completed reminders go. */
export const reconcile = () => serial(async () => {
  const now = Date.now(), list = await read();
  const byId = new Map(list.map((r) => [r.id, r]));
  const want = new Map();
  for (const r of list) for (const [name, when] of M.alarmPlan(r, now)) want.set(name, when);
  const have = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith('reminder:'));
  for (const a of have) {
    if (want.has(a.name)) continue;
    const r = byId.get(split(a.name.slice(9))[0]);
    // an alarm that is about to ring for an open reminder (e.g. Chrome waking up late) is left to ring
    if (!r || r.done || a.scheduledTime > now) await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) {
    const a = have.find((x) => x.name === name);
    if (!a || Math.abs(a.scheduledTime - when) > 1000) await chrome.alarms.create(name, { when });
  }
});

onAlarm('reminder', async (rest) => {
  const [id, early] = split(rest);
  const r = (await read()).find((x) => x.id === id);
  if (!r || r.done) return;
  const s = await bgStrings(S);
  if (early) {
    const at = M.fireAt(r) || r.due;
    return post('reminder:' + rest, { app: 'reminder', title: r.title || s.reminder, body: fmt(s.dueAt, { time: await bgTime(at) }), icon: 'checkCircle', ref: id, buttons: [{ title: s.done }] });
  }
  // a repeating reminder: missed occurrences are skipped, then the next one is scheduled (by the storage change, or here)
  const moved = M.rang(r);
  if (moved) await write((l) => l.map((x) => (x.id === id ? moved : x)));
  else if (r.repeat) reconcile();
  const body = String(r.notes || '').trim().split('\n')[0].slice(0, 200) || s.reminder;
  return post('reminder:' + id, { app: 'reminder', title: r.title || s.reminder, body, icon: 'checkCircle', ref: id, buttons: [{ title: s.done }, { title: s.snooze }] });
});

onButton('reminder', async (rest, index) => {
  const [id] = split(rest);
  if (index === 0) return write((l) => M.complete(l, id));
  // Snooze: a one-off reminder moves its due time; a repeating one keeps its series and rings once more
  const when = Date.now() + SNOOZE;
  await write((l) => l.map((r) => (r.id !== id ? r : r.repeat ? { ...r, snooze: when } : { ...r, due: when })));
  chrome.alarms.create('reminder:' + id, { when });
});

openTarget('reminder', (rest) => ({ app: 'reminder', section: split(rest)[0] }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[M.KEY]) return;
  // a repeating reminder another writer marked done moves on to its next occurrence (that write comes back here)
  write((l) => M.rollDone(l));
  reconcile();
});
chrome.runtime.onStartup.addListener(() => reconcile());
chrome.runtime.onInstalled.addListener(() => reconcile());

// Routines › Add reminder, when a routine runs here with no tab open
registerReminderAction();
