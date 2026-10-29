// triple
// Samsung Clock end to end: the widgets; Alarm (the "Alarm in …" title, add with the wheels and day chips, name,
// Alarm sound sub-page (tone, volume, gradually louder), Snooze sub-page (interval, repeat), ring once on a date from
// the calendar, the `alarm:<id>` chrome alarms, switch off/on, edit, the lock chip and search), ringing for real
// through the service worker into this tab (full-screen screen, a click only nudges, swipe to snooze, "Snoozed
// until" + Dismiss in the list, Esc dismisses), selection mode (All, Turn off, Delete) and the row menu; World clock
// (day/night map with pins, add cities by name or country — Arabic names in Arabic —, offsets, reorder by menu and by
// dragging, Time zone converter, delete); Stopwatch (laps with fastest/slowest, analog/digital); Timer (preset timers,
// add/delete a preset, name, sound, start, +1 min, pause/resume, a Now Bar pill per timer, Lock screen pill, Quick
// Panel, several timers, a timer ringing in the page and +1 min from the ringing screen).
// usage: .dev/run.sh .dev/clock.cjs
module.exports = async ({ page, boot, ok, sleep, shot: shot0, P, ui, sw, mod, openApp, closeApp, click, count, exists, text, texts, store, logs }) => {
  const shot = (n) => shot0(P + 'clock-' + n);
  const ar = ui === 'ar';
  const tt = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const chromeAlarms = () => sw.evaluate(() => chrome.alarms.getAll());
  const alarmOf = async (name) => (await chromeAlarms()).find((a) => a.name === name) || null;
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(100); } return v; };
  const alarms = async () => (await store('alarms')) || [];
  const timers = async () => (await store('timers')) || [];
  const stopwatch = () => store('stopwatch');
  const ringing = () => sw.evaluate(() => chrome.storage.session.get('clockRinging').then((r) => r.clockRinging || []));
  const nextAt = (a) => mod('./js/core/schedule.js', 'nextAlarmTime', a);
  const activities = () => page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().map(({ id, title, sub, app, progress, priority, icon, actions }) => ({ id, title, sub, app, progress, priority, icon, actions: (actions || []).length }))));
  const tab = async (i) => { await page.evaluate((i) => document.querySelectorAll('.clk-tabs .ou-tab')[i].click(), i); await sleep(400); };
  const activeTab = () => page.evaluate(() => [...document.querySelectorAll('.clk-tabs .ou-tab')].findIndex((b) => b.classList.contains('active')));
  const toolbarBtn = async (i) => { await page.evaluate((i) => [...document.querySelectorAll('.app-page:last-child .app-toolbar-actions .ou-icon-btn')][i].click(), i); await sleep(350); };
  const menuPick = async (i) => { await page.evaluate((i) => document.querySelectorAll('.ou-menu .ou-menu-item')[i].click(), i); await sleep(350); };
  const wheelSel = async (key) => `.clk-wheel[aria-label="${await tt(key)}"]`;
  const typeWheelIn = async (scope, key, digits) => { await page.focus(scope + ' ' + (await wheelSel(key))); for (const d of digits) await page.keyboard.press(d); await sleep(120); };
  const typeWheel = (key, digits) => typeWheelIn('.clk-edit', key, digits);
  const fmtTimeP = (ms) => page.evaluate((ms) => import('./js/core/i18n.js').then((m) => m.fmtTime(new Date(ms))), ms);
  const fmtDateP = (ms, o) => page.evaluate((ms, o) => import('./js/core/i18n.js').then((m) => m.fmtDate(new Date(ms), o)), ms, o);
  const center = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, sel);
  const drag = async (sel, dx, dy, steps = 8) => {
    const c = await center(sel);
    if (!c) return false;
    await page.mouse.move(...c); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(c[0] + (dx * i) / steps, c[1] + (dy * i) / steps); await sleep(25); }
    await page.mouse.up(); await sleep(300);
    return true;
  };
  const L = ar ? { gym: 'رياضة', nap: 'قيلولة', tea: 'شاي', eggs: 'بيض', meet: 'اجتماع' } : { gym: 'Gym', nap: 'Nap', tea: 'Tea', eggs: 'Eggs', meet: 'Meeting' };
  const CITY = ar ? { tokyo: 'طوكيو', london: 'لندن', japan: 'اليابان' } : { tokyo: 'Tokyo', london: 'London', japan: 'Japan' };
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });
  await boot({ settings: { lockWidgets: ['alarm'] }, data: { home: [[W('w-dig', 'clock-digital', 'm'), W('w-world', 'clock-world', 'm'), W('w-an', 'clock-analog', 's')]], dock: [] } });

  // ---------------------------------------------------------------- widgets with no data
  const dig = '#home .widget-tile[data-id="w-dig"] .wg', world = '#home .widget-tile[data-id="w-world"] .wg';
  ok(await exists(dig + '.wg-clock-digital .wgc-time'), 'digital clock widget rendered');
  ok((await text(dig + ' .wgc-alarm-t')) === (await tt('clock.noAlarmsShort')), 'digital widget (m): "No alarms"');
  ok((await count(world + ' .wgc-city')) === 4, 'world clock widget shows 4 default cities');
  ok((await count(world + ' .wgc-city .clk-face.mini')) === 4, '…each with an analog face');
  ok(ar ? (await texts(world + ' .wgc-city-n')).includes('لندن') : (await texts(world + ' .wgc-city-n')).includes('London'), 'world widget city names in the app’s language');
  ok(await exists('#home .widget-tile[data-id="w-an"] .clk-face.widget'), 'analog clock widget rendered');
  const hands = await page.evaluate(() => {
    const ang = (el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360; };
    const f = document.querySelector('#home .widget-tile[data-id="w-an"] .clk-face'), d = new Date();
    const want = { hh: ((d.getHours() % 12) + d.getMinutes() / 60) * 30, mm: (d.getMinutes() + d.getSeconds() / 60) * 6 };
    const got = { hh: ang(f.querySelector('.clk-hand.hh')), mm: ang(f.querySelector('.clk-hand.mm')) };
    const off = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    return { ok: off(got.hh, want.hh) < 4 && off(got.mm, want.mm) < 4, got, want };
  });
  ok(hands.ok, `analog hands point at the current time (hour ${Math.round(hands.got.hh)}° vs ${Math.round(hands.want.hh)}°, minute ${Math.round(hands.got.mm)}° vs ${Math.round(hands.want.mm)}°)`);
  await shot('01-widgets');
  await page.click('#home .widget-tile[data-id="w-world"]'); await sleep(900);
  ok(await exists('.app-win .clk-tabs') && (await activeTab()) === 1, 'world clock widget opens Clock on World clock');
  await closeApp();

  // ---------------------------------------------------------------- Alarm: empty, add with repeat days
  await openApp('clock', { tab: 'alarm' });
  ok((await count('.clk-tabs .ou-tab')) === 4 && (await activeTab()) === 0, 'four tabs, Alarm active');
  ok(await exists('.app-body .ou-empty'), 'no alarms: empty state');
  ok((await text('.app-hero-title')) === (await tt('clock.allOff')), 'big title: All alarms are off');
  await click('.app-body .ou-empty .ou-btn.primary');
  ok(await exists('.ou-dialog.clk-edit'), 'empty-state button opens the alarm editor pop-up');
  ok((await text('.clk-edit .ou-dialog-title')) === (await tt('clock.addAlarm')), 'title: Add alarm');
  ok(!(await exists('.clk-edit .ou-dialog-btn.danger')), 'a new alarm has no Delete');
  ok((await count('.clk-edit .clk-day')) === 7 && (await count('.clk-edit .clk-wheel')) >= 2, 'wheels and seven day chips');
  await typeWheel('clock.hours', ['6']);
  await typeWheel('clock.minutes', ['3', '0']);
  const wv = await page.evaluate(() => [...document.querySelectorAll('.clk-edit .clk-wheel')].map((w) => w.getAttribute('aria-valuenow')));
  ok(wv.includes('6') && wv.includes('30'), `typing on the wheels sets 6:30 (${wv.join(',')})`);
  for (const i of [1, 2, 3, 4, 5]) await page.evaluate((i) => document.querySelectorAll('.clk-edit .clk-day')[i].click(), i);
  ok((await page.evaluate(() => [...document.querySelectorAll('.clk-edit .clk-day')].map((b) => b.getAttribute('aria-pressed')).join())) === 'false,true,true,true,true,true,false', 'Mon–Fri chips on');
  ok((await text('.clk-edit-date')) === (await tt('clock.weekdays')), 'date line: Weekdays');
  const until1 = await text('.clk-edit .clk-edit-until');
  ok(until1 && until1.includes((await tt('clock.alarmIn', { d: '' })).trim()), `"Alarm in …" preview (${until1})`);
  ok((await text('.clk-opt-sound .ou-row-sub')) === (await tt('clock.tone.flower')) && (await text('.clk-opt-snooze .ou-row-sub')).includes('5'), 'Alarm sound: Morning flower; Snooze: 5 minutes…');
  await page.type('.clk-edit .clk-edit-name', L.gym);
  await shot('02-add-alarm');
  await click('.clk-edit .ou-dialog-btn.primary');
  let list = await until(async () => { const l = await alarms(); return l.length === 1 && l; });
  const a1 = list && list[0];
  ok(a1 && a1.time === '06:30' && JSON.stringify(a1.days) === '[1,2,3,4,5]' && a1.label === L.gym && a1.enabled === true, `alarm saved ${JSON.stringify(a1)}`);
  ok(a1 && a1.sound === 'flower' && a1.soundOn !== false && a1.volume === 0.7 && a1.snooze === true && a1.snoozeMin === 5 && a1.snoozeRepeat === 3, '…with Samsung’s defaults (sound, volume, snooze 5 min × 3)');
  ok(await exists('.ou-toast'), 'toast: alarm set for … from now');
  let ca = await until(() => alarmOf('alarm:' + a1.id));
  ok(ca && ca.scheduledTime === (await nextAt(a1)) && [1, 2, 3, 4, 5].includes(new Date(ca.scheduledTime).getDay()), 'chrome alarm alarm:<id> at the next weekday 06:30');
  ok((await count('.clk-alarm')) === 1 && (await text('.clk-alarm-label')) === L.gym, 'alarm card with its name');
  ok((await count('.clk-alarm .clk-alarm-days span.on')) === 5 && (await count('.clk-alarm .clk-alarm-days span')) === 7, 'week days shown (5 of 7 lit)');
  ok((await text('.app-hero-title')).includes((await tt('clock.alarmIn', { d: '' })).trim()) && (await text('.app-hero-sub')).includes(await fmtTimeP(ca.scheduledTime)), 'big title "Alarm in …" and the date and time under it');

  // a one-time alarm with its own sound and snooze
  await toolbarBtn(0);
  await typeWheel('clock.hours', ['9']);
  await typeWheel('clock.minutes', ['1', '5']);
  await page.type('.clk-edit .clk-edit-name', L.nap);
  await page.evaluate(() => document.querySelector('.clk-opt-sound').click()); await sleep(300);
  ok(await exists('.ou-dialog.clk-edit.clk-sub-on .clk-sub-head') && (await text('.clk-sub-title')) === (await tt('clock.alarmSound')), 'Alarm sound opens inside the pop-up');
  ok((await count('.clk-edit-sub .clk-tones .clk-radio')) === 12, 'twelve tones');
  await page.evaluate(() => document.querySelector('.clk-edit-sub .clk-tones .clk-radio[data-v="beep"] input').click()); await sleep(150);
  ok(await exists('.clk-edit-sub .clk-radio.on[data-v="beep"]'), 'tone picked (and previewed)');
  await page.evaluate(() => document.querySelector('.clk-edit-sub .clk-sound .ou-list .ou-switch input').click()); await sleep(100);
  await page.focus('.clk-edit-sub .clk-vol');
  for (let i = 0; i < 10; i++) await page.keyboard.press(ar ? 'ArrowRight' : 'ArrowLeft');
  await sleep(100);
  ok((await page.$eval('.clk-edit-sub .clk-vol', (e) => e.getAttribute('aria-valuenow'))) === '60', 'volume slider to 60%');
  await shot('03-alarm-sound');
  await page.evaluate(() => document.querySelector('.clk-sub-head .ou-icon-btn').click()); await sleep(250);
  ok(!(await exists('.clk-sub-on')) && (await text('.clk-opt-sound .ou-row-sub')) === (await tt('clock.tone.beep')), 'back: the row shows Beep-beep');
  await page.evaluate(() => document.querySelector('.clk-opt-snooze').click()); await sleep(300);
  ok((await count('.clk-edit-sub .clk-radios')) === 2, 'Snooze: Interval and Repeat lists');
  await page.evaluate(() => { const [iv, rp] = document.querySelectorAll('.clk-edit-sub .clk-radios'); iv.querySelector('[data-v="10"] input').click(); rp.querySelector('[data-v="5"] input').click(); }); await sleep(150);
  await page.evaluate(() => document.querySelector('.clk-sub-head .ou-icon-btn').click()); await sleep(250);
  const snzSub = await text('.clk-opt-snooze .ou-row-sub');
  ok(snzSub.includes('10') && snzSub.includes('5'), `Snooze row: ${snzSub}`);
  await click('.clk-edit .ou-dialog-btn.primary');
  list = await until(async () => { const l = await alarms(); return l.length === 2 && l; });
  const a2 = list.find((a) => a.label === L.nap);
  ok(a2 && a2.time === '09:15' && a2.days.length === 0 && a2.enabled && a2.sound === 'beep' && a2.gradual === true && a2.volume === 0.6 && a2.snoozeMin === 10 && a2.snoozeRepeat === 5, `one-time alarm with its sound and snooze ${JSON.stringify(a2)}`);
  ca = await until(() => alarmOf('alarm:' + a2.id));
  const n2 = await nextAt(a2);
  ok(ca && ca.scheduledTime === n2 && n2 - Date.now() <= 864e5, 'one-time alarm scheduled within a day');

  // ring once on a date (the calendar button)
  await toolbarBtn(0);
  await typeWheel('clock.hours', ['8']);
  await typeWheel('clock.minutes', ['0', '0']);
  await page.type('.clk-edit .clk-edit-name', L.meet);
  await page.evaluate(() => document.querySelector('.clk-edit-cal').click()); await sleep(350);
  ok(await exists('.ou-dialog.clk-cal-dlg .clk-cal-grid'), 'calendar button opens the date picker');
  const target = new Date(); target.setDate(target.getDate() + 3); target.setHours(8, 0, 0, 0);
  if (target.getMonth() !== new Date().getMonth()) { await page.evaluate(() => document.querySelector('.clk-cal-next').click()); await sleep(150); }
  ok(await page.evaluate(() => [...document.querySelectorAll('.clk-cal-day')].some((b) => b.disabled)) || new Date().getDate() === 1 || target.getMonth() !== new Date().getMonth(), 'days before today can’t be picked');
  await page.evaluate((d) => [...document.querySelectorAll('.clk-cal-day')].find((b) => b.textContent === String(d)).click(), target.getDate()); await sleep(100);
  await shot('04-date-picker');
  await click('.clk-cal-dlg .ou-dialog-btn.primary'); await sleep(200);
  ok((await text('.clk-edit-date')) === (await fmtDateP(+target, { weekday: 'short', month: 'short', day: 'numeric' })) && (await exists('.clk-edit-cal.on')), 'date line shows the picked day');
  ok((await page.evaluate(() => [...document.querySelectorAll('.clk-edit .clk-day.on')].length)) === 0, 'no repeat days with a date');
  await click('.clk-edit .ou-dialog-btn.primary');
  list = await until(async () => { const l = await alarms(); return l.length === 3 && l; });
  const a3 = list.find((a) => a.label === L.meet);
  const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  ok(a3 && a3.date === key && a3.time === '08:00', `dated alarm saved (${a3?.date})`);
  ca = await until(() => alarmOf('alarm:' + a3.id));
  ok(ca && ca.scheduledTime === +target, 'its chrome alarm is on that day at 08:00');
  await sleep(300);
  const labels = await texts('.clk-alarm .clk-alarm-label');
  ok(labels.join('|') === [L.gym, L.meet, L.nap].join('|'), 'alarms sorted by time');
  ok((await text('.clk-alarm:nth-child(2) .clk-alarm-days .once')) === (await fmtDateP(+target, { weekday: 'short', month: 'short', day: 'numeric' })), 'dated alarm card shows its day');
  const once = await text('.clk-alarm:nth-child(3) .clk-alarm-days .once');
  ok(once === (new Date(n2).getDate() === new Date().getDate() ? await tt('common.today') : await tt('common.tomorrow')), `one-time alarm says today/tomorrow (${once})`);
  await shot('05-alarm-list');

  // switch off / on
  await page.evaluate(() => document.querySelector('.clk-alarm .ou-switch input').click());
  ok(await until(async () => (await alarms()).find((a) => a.id === a1.id)?.enabled === false), 'switch turns the alarm off');
  ok(await until(async () => !(await alarmOf('alarm:' + a1.id))), '…and clears its chrome alarm');
  await sleep(200);
  ok(await exists('.clk-alarm.off'), 'switched-off alarm is dimmed');
  await page.evaluate(() => document.querySelector('.clk-alarm .ou-switch input').click());
  ok(await until(async () => (await alarms()).find((a) => a.id === a1.id)?.enabled === true), 'switch turns it back on');
  ok(await until(() => alarmOf('alarm:' + a1.id)), '…and re-schedules it');

  // edit: Mon–Fri → weekends
  await page.evaluate(() => document.querySelector('.clk-alarm .clk-alarm-main').click());
  await sleep(350);
  ok((await text('.clk-edit .ou-dialog-title')) === (await tt('clock.editAlarm')), 'tapping an alarm opens Edit alarm');
  ok((await page.evaluate(() => document.querySelector('.clk-edit .clk-edit-name').value)) === L.gym, 'editor keeps the name');
  ok(await exists('.clk-edit .ou-dialog-btn.danger'), 'Edit alarm has Delete');
  for (const i of [1, 2, 3, 4, 5, 0, 6]) await page.evaluate((i) => document.querySelectorAll('.clk-edit .clk-day')[i].click(), i);
  ok((await text('.clk-edit-date')) === (await tt('clock.weekends')), 'date line: Weekends');
  await click('.clk-edit .ou-dialog-btn.primary');
  ok(await until(async () => JSON.stringify((await alarms()).find((a) => a.id === a1.id)?.days) === '[0,6]'), 'edited to weekends');
  ca = await until(async () => { const x = await alarmOf('alarm:' + a1.id); return x && [0, 6].includes(new Date(x.scheduledTime).getDay()) && x; });
  ok(ca && ca.scheduledTime === (await nextAt({ ...a1, days: [0, 6] })), 'chrome alarm moved to the next weekend day');
  ok((await alarms()).length === 3, 'editing does not duplicate');

  // widgets + lock chip + search follow the alarms
  const next = Math.min(...(await Promise.all((await alarms()).filter((a) => a.enabled).map(nextAt))).filter(Boolean));
  await closeApp();
  await sleep(300);
  ok((await text(dig + ' .wgc-alarm-t')) === (await fmtTimeP(next)), 'digital widget shows the next alarm time');
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(800);
  const chips = await texts('#lock .lk-widgets .lk-w');
  const nextTxt = await fmtTimeP(next);
  ok(chips.some((c) => c.includes(nextTxt)), `Lock screen chip shows the next alarm (${chips.join(' | ')})`);
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);
  const found = await page.evaluate((q) => import('./js/core/apps.js').then((m) => m.getApp('clock').search(q).map((r) => r.title)), L.nap);
  ok(found.length === 1 && found[0] === L.nap, 'Clock search finds alarms by name');

  // ---------------------------------------------------------------- ringing, for real, through the service worker
  await openApp('clock', { tab: 'alarm' });
  await sw.evaluate((id) => chrome.alarms.create('alarm:' + id, { when: Date.now() + 200 }), a2.id);
  ok(await until(() => exists('.clk-ringing.alarm.show'), 5000), 'the alarm rings full screen in this tab');
  ok((await text('.clk-ringing .clk-ring-title')) === L.nap, 'ringing screen shows the alarm’s name');
  ok(await exists('.clk-swipe-wrap.dismiss') && (await exists('.clk-swipe-wrap.snooze')), 'round Dismiss and Snooze buttons');
  ok(!(await exists('#headsup .headsup')), 'no heads-up banner on top of it');
  const r1 = await ringing();
  ok(r1.length === 1 && r1[0].ref === a2.id && r1[0].tone === 'beep' && r1[0].snoozeMin === 10, 'session state: what rings, with the alarm’s tone');
  await shot('06-ringing-alarm');
  await page.click('.clk-swipe-wrap.dismiss .clk-swipe'); await sleep(400);
  ok(await exists('.clk-ringing.show') && (await exists('.clk-swipe-wrap.nudge')), 'a plain click only nudges (One UI wants a swipe)');
  ok(await drag('.clk-swipe-wrap.snooze .clk-swipe', ar ? 60 : -60, -110), 'swipe the Snooze circle out');
  ok(await until(async () => !(await exists('.clk-ringing'))), 'ringing screen closes');
  ok(await until(async () => !(await ringing()).length), '…and nothing rings any more');
  let a2s = (await alarms()).find((a) => a.id === a2.id);
  ok(a2s && Math.abs(a2s.snoozeAt - Date.now() - 10 * 60e3) < 6000 && a2s.snoozeCount === 1, 'snoozed for its 10 minutes');
  ca = await alarmOf('alarm:' + a2.id);
  ok(ca && ca.scheduledTime === a2s.snoozeAt, 'alarm:<id> re-armed at the snooze');
  await sleep(300);
  ok(await exists('.clk-alarm .clk-alarm-snz'), 'the card says "Snoozed until …"');
  ok((await text('.app-hero-title')).includes((await tt('clock.alarmIn', { d: '' })).trim()), 'title counts down to the snooze');
  await page.evaluate(() => document.querySelector('.clk-snz-x').click());
  ok(await until(async () => !(await alarms()).find((a) => a.id === a2.id).snoozeAt), 'Dismiss on the card cancels the snooze');
  ok(await until(async () => !(await alarmOf('alarm:' + a2.id))), '…and its chrome alarm (the one-time alarm is off)');
  // Esc dismisses
  await sw.evaluate((id) => chrome.alarms.create('alarm:' + id, { when: Date.now() + 200 }), a1.id);
  await until(() => exists('.clk-ringing.alarm.show'), 5000);
  await page.keyboard.press('Escape'); await sleep(450);
  ok(!(await exists('.clk-ringing')) && (await exists('.app-win .clk-tabs')), 'Esc dismisses (Clock stays open)');
  ok(await until(async () => !(await ringing()).length), '…in the service worker too');

  // ---------------------------------------------------------------- selection mode, row menu
  await page.evaluate(() => { const el = document.querySelectorAll('.clk-alarm')[2]; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 20 })); });
  await sleep(300);
  ok((await count('.ou-menu .ou-menu-item')) === 3 && (await count('.ou-menu .ou-menu-item.danger')) === 1, 'right-click: Edit / Select / Delete');
  await click('.ou-menu .ou-menu-item.danger');
  ok(await until(async () => (await alarms()).length === 2 && !(await alarms()).some((a) => a.id === a2.id)), 'Delete removes the alarm');
  await toolbarBtn(1);
  ok((await count('.ou-menu .ou-menu-item')) === 2, '⋮ menu: Edit / Settings');
  await menuPick(0);
  ok(await exists('.clk-page.clk-selecting') && (await count('.clk-alarm .clk-check')) === 2 && (await count('.clk-selbar .clk-selbtn')) === 3, 'Edit: selection mode with check boxes and Turn on / Turn off / Delete');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.clk-tabs')).display === 'none'), 'the tabs give way to the action bar');
  ok(await page.$eval('.clk-selbar .clk-selbtn', (b) => b.disabled), 'nothing selected: actions disabled');
  await page.evaluate(() => document.querySelector('.clk-allbtn').click()); await sleep(200);
  ok((await count('.clk-alarm.checked')) === 2 && (await text('.app-toolbar-title')) === (await tt('clock.nSelected', { n: 2 })), 'All selects both ("2 selected")');
  await shot('07-select');
  await page.evaluate(() => document.querySelectorAll('.clk-selbar .clk-selbtn')[1].click());
  ok(await until(async () => (await alarms()).every((a) => !a.enabled)), 'Turn off');
  ok(await until(async () => !(await chromeAlarms()).some((a) => a.name.startsWith('alarm:'))), '…clears every alarm:<id>');
  ok(!(await exists('.clk-selecting')) && (await text('.app-hero-title')) === (await tt('clock.allOff')), 'selection mode ends; title back to "All alarms are off"');
  await toolbarBtn(1); await menuPick(0);
  await page.evaluate(() => document.querySelector('.clk-alarm').click()); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(250);
  ok(!(await exists('.clk-selecting')) && (await exists('.app-win')), 'Esc leaves selection mode (not the app)');
  await toolbarBtn(1); await menuPick(0);
  await page.evaluate(() => document.querySelector('.clk-allbtn').click()); await sleep(150);
  await page.evaluate(() => document.querySelectorAll('.clk-selbar .clk-selbtn')[2].click());
  ok(await until(async () => (await alarms()).length === 0), 'Delete deletes the selected alarms');
  await sleep(200);
  ok(await exists('.app-body .ou-empty'), 'empty state again');

  // ---------------------------------------------------------------- World clock
  await tab(1);
  ok((await activeTab()) === 1 && (await exists('.clk-map svg .clk-land')) && (await exists('.clk-map .clk-night')), 'World clock: the map with land and the night side');
  ok(await exists('.clk-map .clk-mpin.local') && (await exists('.clk-map .clk-sun')), 'your place and the sun on the map');
  ok(await exists('.clk-city-add'), 'no cities: an "Add city" card');
  await toolbarBtn(0);
  ok((await count('.app-page')) === 2 && (await exists('.app-page:last-child .app-back')), 'Add city opens a sub-page with Back');
  await page.type('.app-page:last-child input[type=search]', ar ? 'طوكيو' : 'Tokyo');
  await sleep(300);
  const rowsT = await texts('.app-page:last-child .clk-city-results .ou-row .ou-row-title');
  ok(rowsT[0] === CITY.tokyo, `search finds ${CITY.tokyo} (${rowsT.slice(0, 3).join(', ')})`);
  ok((await text('.app-page:last-child .clk-city-results .ou-row .ou-row-sub')).startsWith(ar ? 'اليابان' : 'Japan'), 'with its country in the app’s language');
  await shot('08-add-city');
  await page.evaluate(() => document.querySelector('.app-page:last-child .clk-city-results .ou-row').click());
  await sleep(600);
  let clocks = await store('clocks');
  ok(clocks?.length === 1 && clocks[0].tz === 'Asia/Tokyo' && clocks[0].city === 'Tokyo' && clocks[0].id, `city saved with its English name ${JSON.stringify(clocks)}`);
  ok((await count('.app-page')) === 1 && (await count('.clk-cities .clk-city')) === 1, 'picking a city goes back; city listed');
  ok((await text('.clk-city-name')) === CITY.tokyo, `card name in the app’s language (${await text('.clk-city-name')})`);
  const tk = await page.evaluate(() => {
    const r = document.querySelector('.clk-city'); const shown = r.querySelector('.clk-city-time span').textContent;
    const want = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const [sh, sm] = shown.split(':').map(Number), [wh, wm] = want.split(':').map(Number);
    return { shown, want, ok: sm === wm && sh % 12 === wh % 12, sub: r.querySelector('.clk-city-sub').textContent };
  });
  ok(tk.ok, `Tokyo shows Tokyo's time (${tk.shown} vs ${tk.want})`);
  ok(ar ? tk.sub.includes('،') && !tk.sub.includes(',') : tk.sub.includes(', '), `offset line in the language (${tk.sub})`);
  const pinX = await page.evaluate(() => parseFloat(document.querySelector('.clk-mpin:not(.local)').style.getPropertyValue('--x')));
  const pinBox = await page.evaluate(() => { const m = document.querySelector('.clk-map').getBoundingClientRect(), p = document.querySelector('.clk-mpin:not(.local) > i').getBoundingClientRect(); return (p.left + p.width / 2 - m.left) / m.width; });
  ok(pinX > 85 && pinX < 92 && Math.abs(pinBox * 100 - pinX) < 2, `Tokyo's pin sits in Japan on the map (${pinX.toFixed(1)}%, drawn at ${(pinBox * 100).toFixed(1)}%)`);
  await toolbarBtn(0);
  await page.type('.app-page:last-child input[type=search]', 'tokyo');
  await sleep(300);
  ok(await page.$eval('.app-page:last-child .clk-city-results .ou-row', (r) => r.disabled), 'a city already added is disabled');
  const setQ = (q) => page.evaluate((q) => { const i = document.querySelector('.app-page:last-child input[type=search]'); i.value = q; i.dispatchEvent(new Event('input')); }, q);
  await setQ('zzqq'); await sleep(200);
  ok(await exists('.app-page:last-child .ou-empty'), 'no match: "No cities found"');
  await setQ(CITY.japan); await sleep(200);
  const byCountry = await texts('.app-page:last-child .clk-city-results .ou-row .ou-row-title');
  ok(byCountry.includes(CITY.tokyo) && byCountry.includes(ar ? 'أوساكا' : 'Osaka'), `search by country (${byCountry.slice(0, 4).join(', ')})`);
  await setQ(CITY.london); await sleep(200);
  await page.evaluate((n) => [...document.querySelectorAll('.app-page:last-child .clk-city-results .ou-row')].find((r) => r.querySelector('.ou-row-title').textContent === n).click(), CITY.london);
  await sleep(600);
  clocks = await store('clocks');
  ok(clocks?.length === 2 && clocks[1].tz === 'Europe/London' && clocks[1].city === 'London', 'second city added');
  await toolbarBtn(0);
  await click('.app-page:last-child .app-back');
  await sleep(450);
  ok((await count('.app-page')) === 1 && (await store('clocks')).length === 2, 'Back leaves Add city without adding');
  await page.evaluate(() => document.querySelectorAll('.clk-city')[1].click()); await sleep(200);
  ok(await exists('.clk-city.focus') && (await exists('.clk-mpin.focus')), 'tapping a city highlights its pin');
  await shot('09-world');
  // reorder: row menu, then drag in selection mode
  await page.evaluate(() => { const el = document.querySelectorAll('.clk-city')[1]; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 20 })); });
  await sleep(300);
  await menuPick(0);
  ok(await until(async () => (await store('clocks'))[0].city === 'London'), 'Move up');
  await toolbarBtn(1); await menuPick(0);
  ok((await count('.clk-city .clk-grip')) === 2, 'Edit: drag handles');
  const h0 = await page.evaluate(() => document.querySelector('.clk-city').getBoundingClientRect().height);
  await drag('.clk-city .clk-grip', 0, h0 + 20);
  ok(await until(async () => (await store('clocks'))[0].city === 'Tokyo'), 'dragging a handle reorders the cities');
  await page.evaluate(() => document.querySelector('.clk-city').click()); await sleep(150);
  await page.evaluate(() => document.querySelector('.clk-selbar .clk-selbtn').click()); await sleep(300);
  clocks = await store('clocks');
  ok(clocks.length === 1 && clocks[0].city === 'London', 'Delete the selected city');
  // Time zone converter
  await toolbarBtn(1); await menuPick(1);
  ok((await count('.app-page')) === 2 && (await exists('.clk-conv-card .clk-conv-hm')) && (await count('.clk-conv-list .ou-row')) === 1, 'Time zone converter: your time and London');
  const conv0 = await text('.clk-conv-list .clk-city-time');
  await page.focus('.clk-conv-slider');
  for (let i = 0; i < 4; i++) await page.keyboard.press(ar ? 'ArrowLeft' : 'ArrowRight');
  await sleep(150);
  ok((await text('.clk-conv-list .clk-city-time')) !== conv0, 'moving the slider changes the times');
  await shot('10-converter');
  await click('.app-page:last-child .app-back'); await sleep(400);

  // ---------------------------------------------------------------- Stopwatch
  await tab(2);
  ok((await activeTab()) === 2 && (await text('.clk-sw-digits')) === '00:00.00', 'Stopwatch at 00:00.00');
  const [lBtn, rBtn] = ['.clk-sw-actions .clk-sw-btn:first-child', '.clk-sw-actions .clk-sw-btn:last-child'];
  ok((await text(rBtn)) === (await tt('clock.start')) && (await page.$eval(lBtn, (b) => b.disabled)), 'Start, and Reset disabled');
  await click(rBtn);
  ok(await until(async () => (await stopwatch())?.running === true), 'Start runs the stopwatch');
  ok((await text(rBtn)) === (await tt('clock.stop')) && (await text(lBtn)) === (await tt('clock.lap')), 'buttons become Lap / Stop');
  await sleep(900); await click(lBtn);
  await sleep(300); await click(lBtn);
  await sleep(600); await click(lBtn);
  let st = await until(async () => { const s = await stopwatch(); return s?.laps?.length === 3 && s; });
  ok(st && st.laps[0] > 800 && st.laps[1] > st.laps[0] && st.laps[2] > st.laps[1], `three laps saved as running totals ${JSON.stringify(st?.laps)}`);
  ok((await count('.clk-laps .clk-lap:not(.head)')) === 3 && (await text('.clk-laps .clk-lap:not(.head) span')) === '03', 'laps listed newest first');
  ok((await exists('.clk-lap.slow .clk-lap-tag')) && (await exists('.clk-lap.fast .clk-lap-tag')), 'fastest and slowest laps marked');
  let acts = await activities();
  const swAct = acts.find((a) => a.id === 'stopwatch');
  ok(swAct && swAct.app === 'clock' && /^\d\d:\d\d$/.test(swAct.title) && swAct.actions === 2, `Now Bar activity for the stopwatch ${JSON.stringify(swAct)}`);
  await page.evaluate(() => document.querySelector('.clk-viewbtn').click()); await sleep(300);
  ok(await page.evaluate(() => document.querySelector('.clk-sw-body').classList.contains('analog') && getComputedStyle(document.querySelector('.clk-sw-dial')).display !== 'none'), 'analog view: the dial');
  ok((await store('clockPrefs'))?.swView === 'analog', '…remembered');
  await shot('11-stopwatch-analog');
  await page.evaluate(() => document.querySelector('.clk-sw-face').click()); await sleep(300);
  ok(!(await page.evaluate(() => document.querySelector('.clk-sw-body').classList.contains('analog'))), 'a tap on the face goes back to digital');
  await shot('12-stopwatch');
  await closeApp();
  await openApp('clock');
  ok((await activeTab()) === 2, 'reopening Clock shows the running stopwatch');
  await click(rBtn);
  st = await until(async () => { const s = await stopwatch(); return s?.running === false && s; });
  ok(st && st.elapsed > 1500 && st.startedAt === 0, 'Stop keeps the elapsed time');
  ok((await text(rBtn)) === (await tt('clock.resume')) && (await text(lBtn)) === (await tt('clock.reset')), 'buttons become Reset / Resume');
  ok(!(await activities()).some((a) => a.id === 'stopwatch'), 'no activity while stopped');
  const cs = Math.floor((st.elapsed % 1000) / 10), ss = Math.floor((st.elapsed % 60e3) / 1000);
  const wantSw = `00:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  await until(async () => (await text('.clk-sw-digits')) === wantSw, 1500);
  ok((await text('.clk-sw-digits')) === wantSw, `digits freeze at the stopped time (${await text('.clk-sw-digits')} vs ${wantSw})`);
  await click(lBtn);
  st = await until(async () => { const s = await stopwatch(); return s?.elapsed === 0 && s; });
  ok(st && !st.laps.length && !st.running, 'Reset clears time and laps');
  ok((await text('.clk-sw-digits')) === '00:00.00' && !(await exists('.clk-lap')), 'display reset');

  // ---------------------------------------------------------------- Timer
  await tab(3);
  ok((await activeTab()) === 3 && (await exists('.clk-picker')), 'Timer tab: the picker when there are no timers');
  ok((await count('.clk-presets .clk-preset:not(.add)')) === 7 && (await exists('.clk-presets .clk-preset.add')), 'seven preset timers and +');
  await page.evaluate(() => document.querySelectorAll('.clk-presets .clk-preset')[1].click()); // 3 min
  await sleep(150);
  ok((await page.$eval(await wheelSel('clock.minutes'), (w) => w.getAttribute('aria-valuenow'))) === '3' && (await exists('.clk-preset.on')), 'a preset sets the wheels (3 min) and stays highlighted');
  await page.type('.clk-timer-name', L.tea);
  await page.evaluate(() => document.querySelector('.clk-timer-sound').click()); await sleep(350);
  ok(await exists('.ou-dialog.clk-sound-dlg .clk-tones'), 'Timer sound opens the tones');
  await page.evaluate(() => document.querySelector('.clk-sound-dlg .clk-radio[data-v="chimes"] input').click()); await sleep(100);
  await click('.clk-sound-dlg .ou-dialog-btn.primary'); await sleep(200);
  ok((await text('.clk-timer-sound-v')) === (await tt('clock.tone.chimes')), 'timer sound: Chimes');
  await shot('13-timer-picker');
  await click('.clk-start');
  let tl = await until(async () => { const l = await timers(); return l.length === 1 && l; });
  const t1 = tl && tl[0];
  ok(t1 && t1.duration === 180000 && t1.base === 180000 && t1.remaining === 180000 && t1.running && t1.label === L.tea && t1.sound === 'chimes' && Math.abs(t1.endsAt - Date.now() - 180000) < 3000, `timer saved ${JSON.stringify(t1)}`);
  ca = await until(() => alarmOf('timer:' + t1.id));
  ok(ca && ca.scheduledTime === t1.endsAt, 'chrome alarm timer:<id> at endsAt');
  ok((await count('.clk-timer-card')) === 1 && (await text('.clk-ring-label')) === L.tea, 'timer card with its name');
  ok(/^0[23]:\d\d$/.test(await text('.clk-ring-time')), `countdown shown (${await text('.clk-ring-time')})`);
  acts = await activities();
  let tAct = acts.find((a) => a.id === 'timer');
  ok(tAct && tAct.app === 'clock' && tAct.sub === L.tea && /^0[23]:\d\d$/.test(tAct.title) && tAct.progress >= 0 && tAct.progress < 0.1 && tAct.priority === 20 && tAct.actions === 2, `Now Bar timer activity ${JSON.stringify(tAct)}`);
  ok(acts[0]?.id === 'timer', 'timer outranks other activities');
  await mod('./js/shell/quickpanel.js', 'openQuickPanel'); await sleep(1300);
  const qpa = await texts('.qp-activities .qp-activity');
  ok(qpa.some((x) => x.includes(L.tea)), `Quick Panel shows the timer activity (${qpa.join(' | ')})`);
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel'); await sleep(400);
  // +1 min
  await click('.clk-plus1');
  let t1b = await until(async () => { const x = (await timers())[0]; return x.endsAt - t1.endsAt >= 59000 && x; });
  ok(t1b && t1b.endsAt - t1.endsAt === 60000 && t1b.duration > 180000 && t1b.duration <= 240000 && t1b.base === 180000, `+1 min adds a minute and grows the ring (${t1b && (t1b.endsAt - t1.endsAt)}, ${t1b?.duration})`);
  ok(await until(async () => (await alarmOf('timer:' + t1.id))?.scheduledTime === t1b.endsAt), '+1 min moves the chrome alarm');
  // pause / resume
  await click('.clk-timer-actions .clk-round.primary');
  let t1c = await until(async () => { const x = (await timers())[0]; return !x.running && x; });
  ok(t1c && t1c.endsAt === null && t1c.remaining > 230000 && t1c.remaining <= 240000, `Pause keeps the remaining time (${t1c?.remaining})`);
  ok(await until(async () => !(await alarmOf('timer:' + t1.id))), 'Pause clears the chrome alarm');
  ok(await until(() => exists('.clk-timer-card.paused')), 'paused card');
  ok(!(await activities()).some((a) => a.id === 'timer'), 'no Now Bar activity while paused');
  await click('.clk-timer-actions .clk-round.primary');
  let t1d = await until(async () => { const x = (await timers())[0]; return x.running && x; });
  ok(t1d && Math.abs(t1d.endsAt - Date.now() - t1c.remaining) < 3000, 'the same button resumes from the remaining time');
  ok(t1d && await until(async () => (await alarmOf('timer:' + t1.id))?.scheduledTime === t1d.endsAt), 'Resume re-schedules the chrome alarm');
  // Now Bar pill on the Lock screen and its Pause action
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(1300);
  const pill = await text('#lock .lk-nowbar .nb-pill');
  ok(pill && pill.includes(L.tea) && /0[234]:\d\d/.test(pill), `Lock screen Now Bar pill (${pill})`);
  await shot('14-lock-nowbar');
  await sleep(1000 - (Date.now() % 1000) + 120);
  const actAt = await page.evaluate(() => { const r = document.querySelector('#lock .lk-nowbar .nb-pill .nb-act').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(...actAt); await sleep(400);
  ok(await until(async () => (await timers())[0].running === false), 'the pill’s Pause button pauses the timer');
  ok(await page.evaluate(() => import('./js/shell/lock.js').then((m) => m.isLocked())), '…without unlocking');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);
  // reset, delete
  await page.evaluate(() => document.querySelectorAll('.clk-timer-actions .clk-round')[1].click()); await sleep(300);
  const t1e = (await timers())[0];
  ok(t1e && !t1e.running && t1e.remaining === 180000 && t1e.duration === 180000, 'Reset restores the time it was set to');
  await page.evaluate(() => document.querySelectorAll('.clk-timer-actions .clk-round')[0].click()); await sleep(400);
  ok((await timers()).length === 0 && (await exists('.clk-picker')), 'Delete removes the timer; the picker again');

  // two timers: a Now Bar pill each
  await page.evaluate(() => document.querySelectorAll('.clk-presets .clk-preset')[3].click()); // 10 min
  await page.evaluate(() => { const i = document.querySelector('.clk-timer-name'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await click('.clk-start'); await sleep(300);
  await toolbarBtn(0);
  ok(await exists('.clk-picker .clk-picker-actions .ou-btn.tonal'), 'Add timer: the picker with Cancel');
  await page.evaluate(() => document.querySelectorAll('.clk-presets .clk-preset')[2].click()); // 5 min
  await click('.clk-start'); await sleep(400);
  tl = await timers();
  ok(tl.length === 2 && tl.every((x) => x.running), 'two timers running');
  ok((await count('.clk-timer-grid .clk-timer-card')) === 2, 'two cards');
  const tActs = (await activities()).filter((a) => a.id === 'timer' || a.id.startsWith('timer:'));
  ok(tActs.length === 2 && /^0[45]:\d\d$/.test(tActs[0].title) && /^(09|10):\d\d$/.test(tActs[1].title) && tActs.every((a) => a.sub === tActs[0].sub), `a Now Bar pill per timer, soonest first (${tActs.map((a) => a.title).join(', ')})`);
  await shot('15-two-timers');
  for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelectorAll('.clk-timer-actions .clk-round')[0].click()); await sleep(350); }
  ok((await timers()).length === 0, 'both deleted');

  // add and delete a preset timer
  await page.evaluate(() => document.querySelector('.clk-preset.add').click()); await sleep(350);
  ok(await exists('.ou-dialog.clk-preset-dlg .clk-wheel'), '+ opens Add preset timer');
  await typeWheelIn('.clk-preset-dlg', 'clock.minutes', ['7']);
  await page.type('.clk-preset-dlg .clk-preset-name', L.eggs);
  await click('.clk-preset-dlg .ou-dialog-btn.primary'); await sleep(300);
  let pr = await store('timerPresets');
  ok(pr?.length === 8 && pr[7].label === L.eggs && pr[7].duration === 7 * 60e3, 'preset saved');
  ok((await texts('.clk-preset .clk-preset-n')).includes(L.eggs), 'and shown with its name');
  await page.evaluate(() => { const el = [...document.querySelectorAll('.clk-preset:not(.add)')].at(-1); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })); });
  await sleep(300);
  await click('.ou-menu .ou-menu-item.danger'); await sleep(250);
  pr = await store('timerPresets');
  ok(pr.length === 7 && !pr.some((p) => p.label === L.eggs), 'preset deleted from its menu');

  // a 2-second timer rings in this tab; +1 min on the ringing screen restarts the same timer
  await typeWheelIn('.clk-picker', 'clock.minutes', ['0']);
  await typeWheelIn('.clk-picker', 'clock.seconds', ['2']);
  await click('.clk-start');
  const tShort = await until(async () => (await timers())[0]);
  ok(tShort && tShort.duration === 2000, 'a 2-second timer');
  ok(await until(() => exists('.clk-ringing.timer.show'), 8000), 'the timer rings full screen when it ends');
  ok(await exists('.clk-ring-pill.plus1') && (await exists('.clk-ring-pill.restart')), 'Restart and +1 min');
  await shot('16-timer-ringing');
  const after = await until(async () => { const x = (await timers()).find((y) => y.id === tShort.id); return x && !x.running && x; });
  ok(after && after.remaining === 2000 && after.endsAt === null, 'the ended timer resets to its duration');
  ok((await ringing()).length === 1 && (await store('notifications')).filter((n) => n.ref === tShort.id).length === 1, 'it rings once (this page’s report and the chrome alarm don’t both ring)');
  await page.click('.clk-ring-pill.plus1'); await sleep(500);
  tl = await timers();
  ok(tl.length === 1 && tl[0].id === tShort.id && tl[0].running && Math.abs(tl[0].endsAt - Date.now() - 60e3) < 3000, `+1 min restarts the same timer for a minute (${tl.length} timer(s))`);
  ok(tl[0] && await until(async () => (await alarmOf('timer:' + tShort.id))?.scheduledTime === tl[0].endsAt), '…with its chrome alarm');
  ok(!(await exists('.clk-ringing')) && !(await ringing()).length, 'ringing over');
  await page.evaluate(() => document.querySelectorAll('.clk-timer-actions .clk-round')[0].click()); await sleep(300);
  ok(!(await alarmOf('timer:' + tShort.id)), 'deleting a running timer clears its alarm');
  await closeApp();

  // widgets after everything was deleted
  ok((await text(dig + ' .wgc-alarm-t')) === (await tt('clock.noAlarmsShort')), 'digital widget back to "No alarms"');
  ok((await count(world + ' .wgc-city')) === 1 && (await text(world + ' .wgc-city-n')) === CITY.london, 'world widget follows the saved cities');

  const errs = logs.filter((l) => l.includes('pageerror'));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
};
