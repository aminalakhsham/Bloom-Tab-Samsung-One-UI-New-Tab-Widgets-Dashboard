// Service worker (background.js): every built-in alarm kind fired for real through chrome.alarms (created a second
// ahead; unpacked extensions have no 30 s minimum) with no new tab open, then the `notifications` entries, the system
// notifications, the storage side effects (timer reset, one-time alarm off, repeating alarm rescheduled, Focus logged),
// the notification buttons (Done / Snooze) and clicks (open the app), and the Arabic strings.
// Not "triple": nothing here is drawn, light/dark don't matter; Arabic is covered by switching settings.lang below.
// usage: .dev/run.sh .dev/background.cjs
module.exports = async ({ browser, page, url, boot, ok, sw, sleep, getStorage, setStorage, shot, logs }) => {
  const now = () => Date.now();
  const get = async (k) => (await getStorage(k))[k];
  const notifs = async () => (await get('notifications')) || [];
  const sys = () => sw.evaluate(() => chrome.notifications.getAll());
  const alarm = (name) => sw.evaluate((n) => chrome.alarms.get(n), name);
  const fire = (name, ms = 1000) => sw.evaluate((n, d) => chrome.alarms.create(n, { when: Date.now() + d }), name, ms);
  const clearSys = () => sw.evaluate(() => chrome.notifications.getAll().then((all) => Promise.all(Object.keys(all).map((id) => chrome.notifications.clear(id)))));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  };
  /** Waits for a new entry in `notifications` matching pred (or returns null after ms). */
  const newNotif = (pred, ms) => until(async () => (await notifs()).find(pred), ms);
  const pad = (n) => String(n).padStart(2, '0');

  await boot({ settings: { lang: 'en' } });
  // No Bloom Tab page open: the service worker alone must handle every alarm (a visible tab rings timers itself).
  await page.goto('about:blank');
  await sleep(300);

  // ———————————————————————————————— timer
  await setStorage({
    notifications: [],
    timers: [
      { id: 't1', label: 'Tea', duration: 60e3, endsAt: now() + 1000, remaining: 60e3, running: true },
      { id: 't2', label: '', duration: 300e3, endsAt: now() + 1000, remaining: 300e3, running: true },
      { id: 't3', label: 'Rang in page', duration: 60e3, endsAt: null, remaining: 60e3, running: false, rangInPage: true },
      { id: 't4', label: 'Plus one minute', duration: 120e3, endsAt: now() + 60e3, remaining: 120e3, running: true },
    ],
  });
  // One at a time: alarms firing in the same instant race on `notifications` (see the dedicated check below).
  for (const n of ['timer:t1', 'timer:t2', 'timer:t3', 'timer:t4']) { await fire(n, 300); await sleep(900); }
  const t1 = await newNotif((n) => n.ref === 't1');
  ok(t1 && t1.app === 'clock' && t1.icon === 'timer' && t1.title === 'Tea' && t1.body === "Time's up" && !t1.read, 'timer: notification entry (label as title, "Time\'s up")');
  const t2 = await newNotif((n) => n.ref === 't2');
  ok(t2?.title === 'Timer', 'timer without a label is titled "Timer"');
  await sleep(800);
  let timers = await get('timers');
  const tm = (id) => timers.find((x) => x.id === id);
  ok(tm('t1').running === false && tm('t1').endsAt === null && tm('t1').remaining === 60e3 && tm('t1').rangInPage === false, 'timer: reset to its full duration, not running');
  ok(!(await notifs()).some((n) => n.ref === 't3'), 'timer already rung by a visible tab (rangInPage) posts nothing');
  ok(!(await notifs()).some((n) => n.ref === 't4') && tm('t4').running && tm('t4').endsAt > now(), 'timer re-scheduled since (+1 min) is left running, no notification');
  let s = await sys();
  ok(s['timer:t1'] && s['timer:t2'] && !s['timer:t3'] && !s['timer:t4'], 'timer: system notifications timer:t1 and timer:t2 only');

  // ———————————————————————————————— clock alarms
  await clearSys();
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const at = new Date(now() + 3 * 3600e3);
  await setStorage({
    notifications: [],
    alarms: [
      { id: 'a1', time: '07:00', days: [], label: 'Wake up', enabled: true },
      { id: 'a2', time: hhmm(at), days: [0, 1, 2, 3, 4, 5, 6], label: '', enabled: true },
      { id: 'a3', time: '08:00', days: [1], label: 'Mondays', enabled: true },
      { id: 'a4', time: '09:00', days: [], label: 'Snoozed', enabled: false },
    ],
  });
  for (const n of ['alarm:a1', 'alarm:a2', 'alarm:a3', 'alarm:a4', 'alarm:gone']) { await fire(n, 300); await sleep(900); }
  const a1 = await newNotif((n) => n.ref === 'a1');
  ok(a1 && a1.app === 'clock' && a1.icon === 'alarm' && a1.title === 'Wake up' && /\d{1,2}:\d\d/.test(a1.body), 'alarm: notification with the label and the time');
  const a2 = await newNotif((n) => n.ref === 'a2');
  ok(a2?.title === 'Alarm', 'alarm without a label is titled "Alarm"');
  ok(!!(await newNotif((n) => n.ref === 'a3')), 'repeating alarm rings');
  ok(!!(await newNotif((n) => n.ref === 'a4')), 'a snooze of a one-time alarm that already switched off still rings');
  await sleep(600);
  const alarmsAfter = await get('alarms');
  ok(alarmsAfter.find((x) => x.id === 'a1').enabled === false, 'one-time alarm switches off after ringing');
  ok(alarmsAfter.find((x) => x.id === 'a2').enabled === true, 'repeating alarm stays on');
  ok(alarmsAfter.find((x) => x.id === 'a4').enabled === false && !(await alarm('alarm:a4')), 'snoozed one-time alarm stays off, nothing rescheduled');
  ok(!(await alarm('alarm:a1')), 'one-time alarm is not rescheduled');
  const next = await alarm('alarm:a2');
  const want = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()).getTime();
  ok(next && Math.abs(next.scheduledTime - want) < 1500, `repeating alarm rescheduled for its next ring (${next && new Date(next.scheduledTime).toString().slice(0, 21)})`);
  const a3next = await alarm('alarm:a3');
  ok(a3next && a3next.scheduledTime > now() && a3next.scheduledTime - now() <= 7 * 864e5 && new Date(a3next.scheduledTime).getDay() === 1 && hhmm(new Date(a3next.scheduledTime)) === '08:00', 'repeating alarm (Mondays 08:00) rescheduled to the next Monday 08:00');
  ok(!(await notifs()).some((n) => n.ref === 'gone'), 'alarm id with no stored alarm posts nothing');
  s = await sys();
  ok(s['alarm:a1'] && s['alarm:a2'], 'alarm: system notifications alarm:a1 and alarm:a2');
  // Snooze button (index 0) on an alarm notification: rings again in 5 minutes
  await sw.evaluate(() => chrome.alarms.clear('alarm:a1'));
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('alarm:a1', 0));
  await sleep(400);
  const snz = await alarm('alarm:a1');
  ok(snz && Math.abs(snz.scheduledTime - (now() + 5 * 60e3)) < 5000, 'alarm Snooze button reschedules alarm:a1 in 5 minutes');
  ok(!(await sys())['alarm:a1'], 'clicking a button clears the system notification');
  await sw.evaluate(() => chrome.alarms.clear('alarm:a1'));

  // ———————————————————————————————— reminders
  await clearSys();
  await setStorage({
    notifications: [],
    reminders: [
      { id: 'r1', title: 'Call mom', notes: '', due: now() + 1000, done: false, priority: false, created: now() },
      { id: 'r2', title: 'Pay rent', notes: 'Before noon', due: now() + 1000, done: false, priority: false, created: now() },
      { id: 'r3', title: 'Already done', notes: '', due: now() + 1000, done: true, priority: false, created: now() },
    ],
  });
  for (const n of ['reminder:r1', 'reminder:r2', 'reminder:r3']) { await fire(n, 300); await sleep(900); }
  const r1 = await newNotif((n) => n.ref === 'r1');
  ok(r1 && r1.app === 'reminder' && r1.title === 'Call mom' && r1.body === 'Reminder' && r1.icon === 'checkCircle', 'reminder: notification (title, "Reminder")');
  const r2 = await newNotif((n) => n.ref === 'r2');
  ok(r2?.body === 'Before noon', 'reminder with notes uses them as the body');
  await sleep(500);
  ok(!(await notifs()).some((n) => n.ref === 'r3'), 'completed reminder posts nothing');
  s = await sys();
  ok(s['reminder:r1'] && s['reminder:r2'] && !s['reminder:r3'], 'reminder: system notifications for r1 and r2 only');
  // Done (0) and Snooze 10 min (1) buttons
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('reminder:r1', 0));
  await sleep(500);
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('reminder:r2', 1));
  await sleep(500);
  const rem = await get('reminders');
  const rr1 = rem.find((x) => x.id === 'r1'), rr2 = rem.find((x) => x.id === 'r2');
  ok(rr1.done === true && rr1.completedAt > now() - 10e3, 'reminder Done button completes it (completedAt set)');
  ok(!rr2.done && Math.abs(rr2.due - (now() + 10 * 60e3)) < 5000, 'reminder Snooze button moves the due time 10 minutes ahead');
  const rsn = await alarm('reminder:r2');
  ok(rsn && Math.abs(rsn.scheduledTime - rr2.due) < 50, 'snoozed reminder alarm scheduled at the new due time');
  await sw.evaluate(() => chrome.alarms.clear('reminder:r2'));

  // ———————————————————————————————— calendar events
  await clearSys();
  await setStorage({
    notifications: [],
    events: [
      { id: 'e1', title: 'Standup', start: now() + 15 * 60e3, end: now() + 30 * 60e3, allDay: false, alert: 15 },
      { id: 'e2', title: 'Demo', start: now() + 20e3, end: now() + 3600e3, allDay: false, alert: 0 },
      { id: 'e3', title: 'Holiday', start: new Date().setHours(0, 0, 0, 0) + 864e5, end: null, allDay: true, alert: 0 },
    ],
  });
  for (const n of ['event:e1', 'event:e2', 'event:e3', 'event:missing']) { await fire(n, 300); await sleep(900); }
  const e1 = await newNotif((n) => n.ref === 'e1');
  ok(e1 && e1.app === 'calendar' && e1.icon === 'calendar' && e1.title === 'Standup' && /^Starts at \d{1,2}:\d\d/.test(e1.body), `event: "Starts at <time>" (${e1?.body})`);
  const e2 = await newNotif((n) => n.ref === 'e2');
  ok(e2?.body === 'Starting now', 'event starting within a minute says "Starting now"');
  const e3 = await newNotif((n) => n.ref === 'e3');
  ok(e3?.body === 'Upcoming event', 'all-day event says "Upcoming event"');
  await sleep(400);
  ok(!(await notifs()).some((n) => n.ref === 'missing'), 'deleted event posts nothing');
  s = await sys();
  ok(s['event:e1'] && s['event:e2'] && s['event:e3'], 'event: system notifications');

  // ———————————————————————————————— Focus
  await clearSys();
  const fStart = now() - 25 * 60e3;
  await setStorage({ notifications: [], focus: { startedAt: fStart, endsAt: now() + 1000, minutes: 25 }, focusLog: [{ start: fStart - 864e5, end: fStart - 864e5 + 15 * 60e3 }] });
  await fire('focus');
  const f1 = await newNotif((n) => n.icon === 'dnd');
  ok(f1 && f1.app === 'system' && f1.title === 'Focus session complete' && /break/i.test(f1.body), 'focus: "Focus session complete" notification');
  await sleep(400);
  ok((await get('focus')) === null, 'focus: the session is cleared');
  let log = await get('focusLog');
  ok(log.length === 2 && log[0].start === fStart && log[0].end > fStart + 24 * 60e3, 'focus: the session is logged first in focusLog');
  ok((await sys()).focus, 'focus: system notification "focus"');
  // a tab already logged this session (it clears focus when it sees it end): no duplicate
  await setStorage({ notifications: [], focus: { startedAt: fStart, endsAt: now() + 1000, minutes: 25 } });
  await fire('focus');
  await newNotif((n) => n.icon === 'dnd');
  await sleep(300);
  log = await get('focusLog');
  ok(log.length === 2, 'focus: an already-logged session is not logged twice');

  // ———————————————————————————————— Arabic strings
  await clearSys();
  const st = await get('settings');
  await setStorage({ settings: { ...st, lang: 'ar' }, notifications: [], timers: [{ id: 't9', label: '', duration: 60e3, endsAt: now() + 1000, remaining: 60e3, running: true }], alarms: [{ id: 'a9', time: '06:30', days: [], label: '', enabled: true }], events: [{ id: 'e9', title: 'اجتماع', start: now() + 3600e3, end: null, allDay: false }] });
  for (const n of ['timer:t9', 'alarm:a9', 'event:e9']) { await fire(n, 300); await sleep(900); }
  const t9 = await newNotif((n) => n.ref === 't9');
  ok(t9?.title === 'المؤقت' && t9.body === 'انتهى الوقت', 'Arabic: timer "المؤقت" / "انتهى الوقت"');
  const a9 = await newNotif((n) => n.ref === 'a9');
  ok(a9?.title === 'المنبه', 'Arabic: alarm "المنبه"');
  const e9 = await newNotif((n) => n.ref === 'e9');
  ok(e9 && /^يبدأ الساعة /.test(e9.body), `Arabic: event "يبدأ الساعة …" (${e9?.body})`);
  ok(e9 && !/AM|PM/.test(e9.body), `Arabic: event time has no English AM/PM (${e9?.body}): background.js fmtTime() formats with chrome.i18n.getUILanguage() instead of the app language (alarm bodies too)`);
  await setStorage({ settings: { ...st, lang: 'en' } });

  // ———————————————————————————————— two alarms in the same instant (e.g. a reminder and an event both at 9:00)
  await clearSys();
  await setStorage({
    notifications: [],
    reminders: [{ id: 'r5', title: 'Same time A', notes: '', due: now() + 1000, done: false }, { id: 'r6', title: 'Same time B', notes: '', due: now() + 1000, done: false }],
    events: [{ id: 'e5', title: 'Same time C', start: now() + 600e3, end: null, allDay: false }],
  });
  const when = now() + 1000;
  await sw.evaluate((w) => Promise.all(['reminder:r5', 'reminder:r6', 'event:e5'].map((n) => chrome.alarms.create(n, { when: w }))), when);
  await until(async () => Object.keys(await sys()).length === 3);
  await sleep(1200);
  const same = (await notifs()).map((n) => n.ref);
  ok(['r5', 'r6', 'e5'].every((r) => same.includes(r)),
    `alarms firing together all reach the notification list (got ${JSON.stringify(same)}): background.js post() reads and writes \`notifications\` without serialising, so simultaneous alarms overwrite each other's entries`);

  // ———————————————————————————————— notification click opens the app (newtab.html#open=<app>)
  const before = (await browser.pages()).length;
  await sw.evaluate(() => chrome.notifications.onClicked.dispatch('reminder:r1'));
  const tgt = await browser.waitForTarget((t) => t.url().includes('newtab.html#open=reminder') || (t.type() === 'page' && t.url().endsWith('newtab.html') && t.url() !== url), { timeout: 8000 }).catch(() => null);
  ok(!!tgt, 'clicking a reminder notification opens a new tab with #open=reminder');
  if (tgt) {
    const p2 = await tgt.page();
    await p2.waitForFunction(() => window.__bootMs, { timeout: 30000 }).catch(() => {});
    const opened = await p2.waitForFunction(() => document.querySelector('.app-win'), { timeout: 5000 }).then(() => true, () => false);
    ok(opened && (await p2.evaluate(() => import('./js/core/apps.js').then((m) => m.currentApp()))) === 'reminder', 'that tab opens the Reminder app');
    ok(!(await p2.evaluate(() => location.hash)), 'the #open hash is removed from the address');
    await p2.close();
  }
  ok((await browser.pages()).length === before, 'tab closed again');

  // ———————————————————————————————— the page shows what the service worker posted
  await page.goto(url);
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(600);
  const stored = (await notifs()).length;
  await page.evaluate(() => import('./js/shell/quickpanel.js').then((m) => m.openQuickPanel()));
  await sleep(700);
  ok((await page.evaluate(() => document.querySelectorAll('.qp-notif').length)) === Math.min(20, stored) && stored > 0, `Quick Panel lists the service worker's notifications (${stored})`);
  await shot('bg-01-quickpanel');
  ok(!logs.some((l) => l.includes('[pageerror]')), 'no page errors');
};
