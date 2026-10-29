// Journal in the service worker: the journaling schedule. One alarm, "journal:remind", is set by the page to the next
// chosen day and time; when it rings, a notification invites you to write (its Write button opens a new entry) and
// the next one is planned here. The journal itself is only read, never written.
import { onAlarm, onButton, openTarget, post, bgStrings, scheduleAt } from './hub.js';
import { KEY, nextScheduleAt, norm } from '../journal/model.js';

const S = {
  en: { title: 'Journal', body: 'It’s time to journal. Take a moment to write about your day.', write: 'Write' },
  ar: { title: 'اليوميات', body: 'حان وقت التدوين. خذ لحظة لتكتب عن يومك.', write: 'كتابة' },
};
const NAME = 'journal:remind';
const NEW_ENTRY = 'newtab.html#open=journal&s=new';

/** Sets the alarm to the next scheduled time, or clears it when the schedule is off. */
async function plan(from = Date.now()) {
  const { [KEY]: j } = await chrome.storage.local.get(KEY);
  const when = nextScheduleAt(norm(j).prefs.schedule, from);
  if (!when) return chrome.alarms.clear(NAME);
  const cur = await chrome.alarms.get(NAME);
  if (!cur || Math.abs(cur.scheduledTime - when) > 1000) scheduleAt(NAME, when);
}

onAlarm('journal', async (rest) => {
  if (rest !== 'remind') return;
  const { [KEY]: j } = await chrome.storage.local.get(KEY);
  const sc = norm(j).prefs.schedule;
  const now = new Date();
  // a computer that slept through the time doesn't get a late reminder hours afterwards
  const [hh, mm] = String(sc.time || '21:00').split(':').map(Number);
  const due = new Date(now);
  due.setHours(hh || 0, mm || 0, 0, 0);
  if (sc.on && sc.days.includes(now.getDay()) && Math.abs(now - due) < 2 * 3600e3) {
    const s = await bgStrings(S);
    await post(`${NAME}:${+now}`, { app: 'journal', title: s.title, body: s.body, icon: 'jr-book', buttons: [{ title: s.write }] });
  }
  // planned from a minute on, so an alarm that rang a moment early isn't set again for the same time
  await plan(Date.now() + 60e3);
});
onButton('journal', () => chrome.tabs.create({ url: chrome.runtime.getURL(NEW_ENTRY) }));
openTarget('journal', () => ({ app: 'journal', section: 'new' }));

// Alarms usually survive a browser restart, but not always: plan again when Chrome starts.
chrome.runtime.onStartup.addListener(() => plan().catch(() => {}));
