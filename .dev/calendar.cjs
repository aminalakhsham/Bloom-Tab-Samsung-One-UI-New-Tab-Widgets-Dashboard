// triple
// Calendar (Samsung Calendar, roadmap U3) end to end: the two Home screen widgets and the Lock screen "next event" chip
// (repeating events and birthdays included); Month view (weeks, weekday header lined up, today, event bars that run
// across days, timed lines, birthdays from Contacts, reminders, the day's agenda with the multi-day arrow pointing the
// reading direction — "←" in Arabic), navigation by buttons and keys, the drawer and the Year / Week / Day / List views;
// natural-language quick add; the One UI editor (colour, two reminders, repeat, location, invitees, notes) and its
// `event:<id>` alarm; the event detail; repeating events edited and deleted "Only this event / This and future / All
// events" with Undo; Week view drag to create, move and resize; search; Settings (week numbers, first day of week,
// Hijri alternate calendar); Manage calendars (create, show/hide); .ics import into a new calendar; an .ics
// subscription by URL (served locally) refreshed by the service worker; the worker's reminder → next occurrence;
// the Routines action "Create event"; editEvent() from outside the app; params and Finder search; widgets after edits.
// usage: .dev/run.sh .dev/calendar.cjs   (THEME=dark, UI=ar)
const http = require('http');

module.exports = async ({ page, boot, ok, sleep, shot: shot0, P, ui, sw, mod, openApp, closeApp, click, count, exists, text, texts, store, logs }) => {
  const shot = (n) => shot0(P + 'cal-' + n);
  const ar = ui === 'ar';
  const tt = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const chromeAlarms = () => sw.evaluate(() => chrome.alarms.getAll());
  const alarmOf = async (name) => (await chromeAlarms()).find((a) => a.name === name) || null;
  const events = async () => (await store('events')) || [];
  const evById = async (id) => (await events()).find((e) => e.id === id);
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(100); } return v; };
  const setVal = (sel, v) => page.evaluate((s, v) => { const el = document.querySelector(s); if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, sel, v);
  const fmtLocal = (ms, o) => page.evaluate((ms, o) => import('./js/core/i18n.js').then((m) => m.fmtDate(new Date(ms), o)), ms, o);
  const topDialog = '.ou-dialog-scrim:last-child .ou-dialog';
  const dialogOpen = (cls) => page.evaluate((c) => [...document.querySelectorAll('.ou-dialog-scrim')].some((s) => !s._closing && s.querySelector('.ou-dialog' + c)), cls);
  const editorOpen = () => dialogOpen('.cal-editor');
  const detailOpen = () => dialogOpen('.cal-detail');
  // clicks a button of the top-most open dialog: 'primary', 'danger' or its label
  const dlgBtn = async (which) => {
    const done = await page.evaluate((w) => {
      const s = [...document.querySelectorAll('.ou-dialog-scrim')].filter((x) => !x._closing).at(-1);
      const b = [...(s?.querySelectorAll('.ou-dialog-btn') || [])].find((x) => (w === 'primary' || w === 'danger' ? x.classList.contains(w) : x.textContent.trim() === w));
      b?.click();
      return !!b;
    }, which);
    await sleep(350);
    return done;
  };
  // picks an option of the top-most choose() dialog by its label, then Done
  const choose = async (label) => {
    const done = await page.evaluate((l) => {
      const s = [...document.querySelectorAll('.ou-dialog-scrim')].filter((x) => !x._closing).at(-1);
      const r = [...(s?.querySelectorAll('.ou-radio-row') || [])].find((x) => x.textContent.trim().startsWith(l));
      r?.click();
      return !!r;
    }, label);
    await sleep(150);
    await dlgBtn('primary');
    return done;
  };
  const escape = async () => { await page.keyboard.press('Escape'); await sleep(350); };
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const key = async (k) => { await blur(); await page.keyboard.press(k); await sleep(350); };
  const title = () => text('.cal-title-text');
  const monthTitle = (y, m) => fmtLocal(new Date(y, m, 1).getTime(), { month: 'long', year: 'numeric' });
  const showDay = (ms) => openApp('calendar', { view: 'month', date: ms });
  const dayItems = () => page.evaluate(() => [...document.querySelectorAll('.cal-day-list .cal-item')].map((b) => ({ title: b.querySelector('.cal-item-title')?.textContent, time: b.querySelector('.cal-item-time')?.textContent, rem: b.classList.contains('rem'), ro: b.classList.contains('ro'), c: b.style.getPropertyValue('--c'), key: b.dataset.key })));
  const openItem = async (t, sel = '.cal-day-list .cal-item') => { const done = await page.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find((b) => b.querySelector('.cal-item-title').textContent === t); b?.click(); return !!b; }, t, sel); await sleep(450); return done; };
  const cellOf = (ms) => page.evaluate((k) => {
    const c = document.querySelector(`.cal-weeks .cal-cell[data-day="${k}"]`);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { cls: c.className, num: c.querySelector('.cal-num').textContent, alt: c.querySelector('.cal-alt')?.textContent || '', l: r.left, r: r.right, t: r.top, b: r.bottom };
  }, dkey(ms));
  const bars = () => page.evaluate(() => [...document.querySelectorAll('.cal-weeks .cal-ev')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, cls: e.className, l: r.left, r: r.right, top: r.top, key: e.dataset.key }; }));
  const pad = (n) => String(n).padStart(2, '0');
  function dkey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  // ---------------------------------------------------------------- seed (all relative to now)
  const now = new Date(), D = 864e5;
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (dayOffset, hh = 0, mm = 0) => new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + dayOffset, hh, mm).getTime();
  const soonStart = new Date(now); soonStart.setHours(now.getHours() + 2, 0, 0, 0);
  const N = ar
    ? { soon: 'اجتماع الفريق', allday: 'رحلة العائلة', multi: 'مؤتمر التصميم', past: 'موعد الطبيب', gym: 'النادي الرياضي', rem: 'شراء الحليب', rem2: 'دفع الفاتورة', added: 'غداء مع أحمد', edited: 'غداء العائلة', contact: 'عمر', once: 'تمرين خاص', drag: 'مراجعة المشروع', imp: 'اجتماع مستورد', sub: 'مباراة الفريق' }
    : { soon: 'Team sync', allday: 'Family trip', multi: 'Design conference', past: 'Dentist', gym: 'Gym', rem: 'Buy milk', rem2: 'Pay the bill', added: 'Lunch with Sam', edited: 'Family lunch', contact: 'Omar', once: 'Special workout', drag: 'Project review', imp: 'Imported meeting', sub: 'Team match' };
  const seedEvents = [
    { id: 'e-soon', title: N.soon, start: soonStart.getTime(), end: soonStart.getTime() + 3600e3, allDay: false, color: '#3e7bff', notes: ar ? 'غرفة 4' : 'Room 4', alert: '10' },
    { id: 'e-allday', title: N.allday, start: at(3), end: at(4) - 60e3, allDay: true, color: '#e2589c', notes: '', alert: 'none' },
    { id: 'e-multi', title: N.multi, start: at(0, 0, 30), end: at(2, 18), allDay: false, color: '#22a356', notes: '', alert: 'none' },
    { id: 'e-past', title: N.past, start: at(-1, 9), end: at(-1, 10), allDay: false, color: '#f5a524', notes: '', alert: 'none' },
    // weekly, every week on the weekday of tomorrow, at 7:00 (first one two weeks ago)
    { id: 'e-gym', title: N.gym, start: at(-13, 7), end: at(-13, 8), allDay: false, repeat: { freq: 'week', interval: 1 }, alerts: [15], place: ar ? 'نادي اللياقة' : 'Fitness First' },
  ];
  const seedRems = [
    { id: 'r1', title: N.rem, due: at(0, 23, 50), done: false, created: Date.now() },
    { id: 'r2', title: N.rem2, due: at(5, 10), done: false, created: Date.now() },
  ];
  const bd = new Date(at(4));
  const contacts = { v: 1, items: [{ id: 'c1', first: N.contact, bday: `1990-${pad(bd.getMonth() + 1)}-${pad(bd.getDate())}` }], groups: [], favs: [], me: null, trash: [] };
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });
  await boot({
    settings: { lockWidgets: ['event'] },
    data: { events: seedEvents, reminders: seedRems, contacts, home: [[W('w-month', 'calendar-month', 's'), W('w-up', 'calendar-upcoming', 'm')], [W('w-big', 'calendar-month', 'l')]], dock: [] },
  });

  // ---------------------------------------------------------------- Home screen widgets
  const monthW = '#home .widget-tile[data-id="w-month"] .wg';
  ok(await exists(monthW + '.wg-cal-month'), 'month widget (s) rendered on the Home screen');
  const mw = await page.evaluate((s) => { const el = document.querySelector(s); return { name: el.querySelector('.wg-cal-mname')?.textContent, wd: el.querySelectorAll('.wg-cal-wd').length, days: el.querySelectorAll('.wg-cal-day').length, today: el.querySelector('.wg-cal-day.today')?.textContent, has: [...el.querySelectorAll('.wg-cal-day.has:not(.out)')].map((d) => +d.textContent) }; }, monthW);
  ok(mw.name === (await fmtLocal(now.getTime(), { month: 'long' })), `month widget names this month (${mw.name})`);
  ok(mw.wd === 7 && (mw.days === 35 || mw.days === 42), `mini month: 7 weekday letters and 5 or 6 weeks (${mw.days} days)`);
  ok(mw.today === String(now.getDate()), 'mini month marks today');
  ok(mw.has.includes(now.getDate()), 'mini month marks days with events');
  const upW = '#home .widget-tile[data-id="w-up"] .wg';
  const up = await page.evaluate((s) => [...document.querySelectorAll(s + ' .wg-cal-ev .wg-cal-ev-title')].map((x) => x.textContent), upW);
  ok(JSON.stringify(up) === JSON.stringify([N.multi, N.soon, N.gym]), `upcoming widget: the next 3 events in order, a repeating one included, past ones not (${up.join(' | ')})`);
  ok((await text(upW + ' .wg-cal-big')) === String(now.getDate()), 'upcoming widget shows today’s date');
  await shot('01-widgets');
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.goPage(1, true)));
  await sleep(500);
  const big = '#home .widget-tile[data-id="w-big"] .wg';
  ok(await exists(big + ' .wg-cal-grid.big') && (await count(big + ' .wg-cal-ev')) === 3, 'month widget (l): big grid and the upcoming list');
  await page.evaluate((s) => [...document.querySelectorAll(s + ' .wg-cal-day:not(.out)')].find((d) => d.textContent === '1').click(), big);
  await sleep(1000);
  ok(await exists('.app-win .cal'), 'tapping a widget day opens Calendar');
  ok((await text('.cal-day-num')) === '1', 'Calendar opens on the tapped day (the 1st)');
  await closeApp();
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.goPage(0, true)));
  await sleep(300);

  // ---------------------------------------------------------------- Lock screen chip
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(800);
  const lk = await texts('#lock .lk-widgets .lk-w');
  ok(lk.some((x) => x.includes(N.multi)), `Lock screen shows the next event (${lk.join(' | ')})`);
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(500);
  ok((await mod('./js/apps/calendar.js', 'upcomingEvents', 6)).some((e) => e.title.includes(N.contact) && e.allDay), 'upcomingEvents() includes birthdays from Contacts');

  // ---------------------------------------------------------------- Month view
  await openApp('calendar');
  ok(await exists('.app-win.size-wide .cal[data-view="month"]'), 'Calendar opens in a wide window, in Month view');
  ok((await title()) === (await monthTitle(now.getFullYear(), now.getMonth())), `bar shows month and year (${await title()})`);
  const grid = await page.evaluate((ar) => {
    const wds = [...document.querySelectorAll('.cal-wds .cal-wd')];
    const cells = [...document.querySelectorAll('.cal-weeks .cal-cell')];
    const sunCol = wds.findIndex((w) => w.classList.contains('sun')), satCol = wds.findIndex((w) => w.classList.contains('sat'));
    const firstIn = cells.findIndex((c) => !c.classList.contains('out'));
    const xs = cells.slice(0, 7).map((c) => Math.round((c.getBoundingClientRect().left + c.getBoundingClientRect().right) / 2)), wx = wds.map((w) => Math.round((w.getBoundingClientRect().left + w.getBoundingClientRect().right) / 2));
    return {
      n: cells.length, weeks: document.querySelectorAll('.cal-weeks .cal-wk').length, wds: wds.length,
      sunOk: cells.every((c, i) => c.classList.contains('sun') === (i % 7 === sunCol)), satOk: cells.every((c, i) => c.classList.contains('sat') === (i % 7 === satCol)),
      first: cells[firstIn]?.querySelector('.cal-num').textContent, firstIn,
      sameX: xs.every((x, i) => Math.abs(x - wx[i]) <= 3), ascendingX: ar ? xs[0] > xs[6] : xs[0] < xs[6],
      todays: cells.filter((c) => c.classList.contains('today')).length,
    };
  }, ar);
  ok(grid.wds === 7 && grid.n === grid.weeks * 7 && grid.weeks >= 4 && grid.weeks <= 6, `${grid.weeks} weeks of 7 days under 7 weekday labels`);
  ok(grid.sunOk && grid.satOk, 'Sunday/Saturday cells sit under the Sunday/Saturday labels');
  ok(grid.first === '1' && grid.firstIn < 7, 'the month starts in the first week row');
  ok(grid.sameX, 'weekday labels line up with the day columns');
  ok(grid.ascendingX, ar ? 'RTL: the week runs right to left' : 'LTR: the week runs left to right');
  ok(grid.todays === 1, 'exactly one cell is today');
  const c0 = await cellOf(at(0));
  ok(c0 && /\btoday\b/.test(c0.cls) && /\bsel\b/.test(c0.cls), 'today is selected on open');
  let bs = await bars();
  const mb = bs.find((b) => b.t === N.multi && /\bbar\b/.test(b.cls));
  const c2 = await cellOf(at(2));
  if (c2 && Math.abs(c2.t - c0.t) < 5) ok(mb && Math.abs((ar ? mb.r : mb.l) - (ar ? c0.r : c0.l)) < 6 && Math.abs((ar ? mb.l : mb.r) - (ar ? c2.l : c2.r)) < 6, 'a multi-day event is one bar from its first to its last day');
  else ok(mb && /\bce\b/.test(mb.cls), 'a multi-day event crossing the week end continues on the next row');
  if (dkey(soonStart) === dkey(at(0))) ok(bs.some((b) => b.t === N.soon && /\btm\b/.test(b.cls)), 'timed event shows as a line in today’s cell');
  // each check shows its own day's month (a day a few days ahead can be in the next month)
  await showDay(at(3));
  ok((await bars()).some((b) => b.t === N.allday && /\bbar\b/.test(b.cls)), 'all-day event shows as a bar with its title');
  await showDay(at(4));
  ok((await bars()).some((b) => b.t.includes(N.contact) && /\bbday\b/.test(b.cls)), 'a birthday from Contacts is in the grid');
  await showDay(at(1));
  ok((await bars()).some((b) => b.t === N.gym && b.key === 'e-gym/' + dkey(at(1))), 'a weekly event shows on its days (key = id/day)');
  await showDay(at(0));

  // ---------------------------------------------------------------- the day's agenda
  ok((await text('.cal-day-num')) === String(now.getDate()) && (await text('.cal-day-wd')) === (await tt('cal.today')), 'agenda header: today’s date, "Today"');
  let items = await dayItems();
  const multiItem = items.find((i) => i.title === N.multi);
  ok(multiItem && multiItem.c === '#22a356', 'agenda lists the multi-day event in its colour');
  const arrow = ar ? '←' : '→';
  ok(multiItem && multiItem.time.trim().endsWith(arrow), `the multi-day event's first day ends with "${arrow}" (${multiItem?.time})`);
  ok(!multiItem?.time.includes(ar ? '→' : '←'), 'no arrow pointing against the reading direction');
  ok(items.some((i) => i.rem && i.title === N.rem && i.time.startsWith(ar ? 'تذكير' : 'Reminder')), 'agenda lists today’s reminder');
  ok(items.findIndex((i) => i.rem) === items.length - 1, 'reminders come after events');
  await shot('02-month');
  await showDay(at(2));
  items = await dayItems();
  const m2 = items.find((i) => i.title === N.multi);
  ok(m2 && m2.time.trim().startsWith(arrow), `its last day starts with "${arrow}" (${m2?.time})`);
  await showDay(at(1));
  items = await dayItems();
  ok(items.find((i) => i.title === N.multi)?.time === (await tt('cal.allDay')), 'a middle day says "All day"');
  ok(items.some((i) => i.title === N.gym && /7:00|07:00/.test(i.time)), 'the weekly event is on its day at 7:00');
  await showDay(at(6));
  ok(await exists('.cal-day-list .cal-empty'), 'an empty day says "No events"');
  await click('.cal-today-btn');

  // ---------------------------------------------------------------- navigation
  const nextM = new Date(now.getFullYear(), now.getMonth() + 1, 1), prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  await click('.cal-next');
  ok((await title()) === (await monthTitle(nextM.getFullYear(), nextM.getMonth())) && (await text('.cal-day-num')) === '1', 'next: next month, its 1st selected');
  await click('.cal-prev'); await click('.cal-prev');
  ok((await title()) === (await monthTitle(prevM.getFullYear(), prevM.getMonth())), 'previous twice: the month before');
  ok(!(await exists('.cal-weeks .cal-cell.today:not(.out)')), 'no "today" inside another month');
  await click('.cal-today-btn');
  ok((await title()) === (await monthTitle(now.getFullYear(), now.getMonth())) && (await text('.cal-day-num')) === String(now.getDate()), 'Today button returns to today');
  await key(ar ? 'ArrowLeft' : 'ArrowRight');
  ok((await text('.cal-day-num')) === String(new Date(at(1)).getDate()), `${ar ? '←' : '→'} selects the next day`);
  await key('ArrowDown');
  ok((await text('.cal-day-num')) === String(new Date(at(8)).getDate()), '↓ moves a week ahead');
  await key('t');
  ok((await text('.cal-day-num')) === String(now.getDate()), 'T jumps back to today');
  await key('PageDown');
  ok((await title()) === (await monthTitle(nextM.getFullYear(), nextM.getMonth())), 'PageDown shows next month');
  await key('PageUp');
  ok((await title()) === (await monthTitle(now.getFullYear(), now.getMonth())), 'PageUp comes back');
  // Go to date (the title)
  await click('.cal-title');
  ok(await dialogOpen(''), 'the month title opens Go to date');
  const target = new Date(now.getFullYear() + 1, 1, 14);
  await setVal('.ou-dialog .cal-goto-in', dkey(target));
  await dlgBtn('primary');
  ok((await title()) === (await monthTitle(target.getFullYear(), 1)) && (await text('.cal-day-num')) === '14', 'Go to date shows that day');
  await click('.cal-today-btn');

  // ---------------------------------------------------------------- views and the drawer
  await key('w');
  ok(await exists('.cal[data-view="week"] .cal-tl'), 'W: Week view');
  ok((await count('.cal-tl-col')) === 7 && (await count('.cal-tl-dh')) === 7 && (await count('.cal-tl-dh.today')) === 1, 'week: 7 columns, today marked');
  ok(await page.evaluate((t) => [...document.querySelectorAll('.cal-tl-bar')].some((b) => b.textContent === t), N.multi), 'week: the multi-day event is a bar in the all-day row');
  ok(await page.evaluate((t) => [...document.querySelectorAll('.cal-tl-ev')].some((b) => b.querySelector('b').textContent === t), N.gym) || new Date(at(1)).getDay() === (await mod('./js/calendar/data.js', 'firstDay')), 'week: the weekly event is a block in its column');
  ok(await exists('.cal-tl-col.today .cal-tl-now'), 'week: the current-time line in today’s column');
  await shot('03-week');
  await key('d');
  ok((await count('.cal-tl-col')) === 1 && (await title()) === (await fmtLocal(at(0), { month: 'long', day: 'numeric', year: 'numeric' })), 'D: Day view with the full date');
  await shot('04-day');
  await key('y');
  ok((await count('.cal-ym')) === 12 && (await count('.cal-ym.cur')) === 1 && (await count('.cal-yd.today')) === 1, 'Y: Year view, 12 months, this month and today marked');
  await shot('05-year');
  await page.evaluate(() => { const t = document.querySelectorAll('.cal-ym-t'); t[(new Date().getMonth() + 1) % 12].click(); });
  await sleep(400);
  const ny = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  ok(await exists('.cal[data-view="month"]') && (await title()) === (await monthTitle(now.getFullYear(), ny.getMonth())), 'tapping a month in Year view opens it');
  await click('.cal-today-btn');
  await key('l');
  const lv = await page.evaluate(() => ({ days: [...document.querySelectorAll('.cal-lv-day')].map((s) => s.dataset.day), today: document.querySelector('.cal-lv-day.today')?.dataset.day, multi: [...document.querySelectorAll('.cal-lv-day.today .cal-item')].map((i) => i.querySelector('.cal-item-time').textContent) }));
  ok(lv.today === dkey(at(0)) && lv.days[0] === dkey(at(0)) && lv.days.includes(dkey(at(1))), 'L: List view, by day from today');
  ok(lv.multi.some((x) => x.trim().endsWith(arrow)), `List: the multi-day arrow points the reading direction (${lv.multi.join(' | ')})`);
  await shot('06-list');
  // drawer
  await click('.cal-bar .ou-icon-btn');
  ok(await exists('.cal-dw-wrap.show .cal-dw'), '≡ opens the navigation drawer');
  ok((await count('.cal-dw-item')) >= 8 && (await count('.cal-dw-cal')) === 3, 'drawer: 5 views, Go to date, Import, Manage; 3 calendars (mine, Birthdays, Reminders)');
  await shot('07-drawer');
  await page.evaluate((l) => [...document.querySelectorAll('.cal-dw-item')].find((b) => b.textContent.trim() === l).click(), await tt('cal.vWeek'));
  await sleep(500);
  ok(await exists('.cal[data-view="week"]') && (await store('calPrefs'))?.view === 'week', 'drawer: Week, remembered in calPrefs');
  await click('.cal-bar .ou-icon-btn');
  await page.evaluate((l) => [...document.querySelectorAll('.cal-dw-item')].find((b) => b.textContent.trim() === l).click(), await tt('cal.vMonth'));
  await sleep(500);
  ok(await exists('.cal[data-view="month"]'), 'drawer: back to Month');

  // ---------------------------------------------------------------- natural-language quick add
  const fri = new Date(at(((5 - now.getDay() + 7) % 7) || 7));
  const phrase = ar ? 'غداء مع سارة يوم الجمعة الساعة 1 م في مقهى النيل' : 'Lunch with Sara Friday 1pm at Café Luna';
  await page.focus('.cal-qa-in');
  await page.keyboard.type(phrase);
  await page.keyboard.press('Enter');
  await sleep(500);
  const qa = await until(async () => (await events()).find((e) => e.title === (ar ? 'غداء مع سارة' : 'Lunch with Sara')));
  ok(qa && qa.start === new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 13).getTime() && qa.end - qa.start === 3600e3, `quick add: "${phrase}" → Friday 13:00–14:00 (${qa && new Date(qa.start)})`);
  ok(qa && qa.place === (ar ? 'مقهى النيل' : 'Café Luna') && (qa.people || []).join() === (ar ? 'سارة' : 'Sara') && JSON.stringify(qa.alerts) === '[10]', 'quick add: the place becomes the location, the name an invitee, the default reminder');
  ok(await until(() => alarmOf('event:' + qa?.id)), 'quick add schedules its reminder alarm');
  ok((await text('.cal-day-num')) === String(fri.getDate()), 'the agenda moves to the new event’s day');
  ok(await exists('.ou-toast .ou-toast-action'), 'a toast confirms it with Edit');
  await click('.cal-today-btn');

  // ---------------------------------------------------------------- new event: the editor
  await click('.cal-fab');
  ok(await editorOpen(), 'FAB opens the event editor');
  ok((await page.evaluate(() => document.querySelector('.cal-editor .cal-ed').dataset.mode)) === 'new', 'editor: a new event');
  const def = await page.evaluate(() => ({ st: document.querySelector('.cal-ed-stime').value, et: document.querySelector('.cal-ed-etime').value, alerts: document.querySelectorAll('.cal-ed-alert').length }));
  ok(def.st.endsWith(':00') && def.et.endsWith(':00') && def.alerts === 1, `editor defaults: on the hour, one reminder (${def.st}–${def.et})`);
  await shot('08-editor-new');
  const tm = new Date(at(1));
  await page.type('.cal-editor .cal-ed-title', N.added);
  await setVal('.cal-editor .cal-ed-sdate', dkey(tm));
  await setVal('.cal-editor .cal-ed-stime', '13:30');
  const endVals = await page.evaluate(() => [document.querySelector('.cal-ed-edate').value, document.querySelector('.cal-ed-etime').value]);
  ok(endVals[0] === dkey(tm) && endVals[1] === '14:30', `moving the start keeps the one-hour length (${endVals.join(' ')})`);
  await click('.cal-editor .cal-ed-color');
  await page.evaluate(() => [...document.querySelectorAll('.cal-colors .ou-swatch')][3].click());
  await sleep(350);
  ok((await page.evaluate(() => document.querySelector('.cal-ed-color').style.background)).length > 0, 'colour dot follows the picked colour');
  await click('.cal-editor .cal-ed-addalert');
  await choose(await mod('./js/calendar/format.js', 'alertText', 60, false));
  ok((await count('.cal-editor .cal-ed-alert')) === 2 && !(await exists('.cal-editor .cal-ed-addalert')), 'a second reminder; no third');
  await click('.cal-editor .cal-ed-repeat');
  await choose(await mod('./js/calendar/format.js', 'repeatText', { freq: 'week', interval: 1, days: [tm.getDay()] }, at(1, 13, 30)));
  await page.type('.cal-editor .cal-ed-place', ar ? 'المطعم الجديد' : 'New place');
  await page.type('.cal-editor .cal-ed-people', ar ? 'سام، ليلى' : 'Sam, Layla');
  await page.type('.cal-editor .cal-ed-notes', ar ? 'احجز طاولة' : 'Book a table');
  await shot('09-editor-filled');
  await dlgBtn('primary');
  ok(!(await editorOpen()), 'Save closes the editor');
  let added = await until(async () => (await events()).find((e) => e.title === N.added));
  ok(added && added.start === at(1, 13, 30) && added.end === at(1, 14, 30) && !added.allDay, 'new event saved with start and end');
  ok(added && added.color === '#f5a524' && JSON.stringify(added.alerts) === '[10,60]' && !('alert' in added), 'colour and two reminders saved (no legacy alert field)');
  ok(added && added.repeat?.freq === 'week' && added.repeat.days?.join() === String(tm.getDay()), `repeat: every week on that day (${JSON.stringify(added?.repeat)})`);
  ok(added && added.place === (ar ? 'المطعم الجديد' : 'New place') && added.people?.join('|') === (ar ? 'سام|ليلى' : 'Sam|Layla') && added.notes === (ar ? 'احجز طاولة' : 'Book a table'), 'location, invitees and notes saved');
  let al = await until(() => alarmOf('event:' + added.id));
  ok(al && Math.abs(al.scheduledTime - (at(1, 13, 30) - 3600e3)) < 1000, 'its alarm event:<id> rings at the earlier reminder (1 hour before)');
  ok(!(await alarmOf('event:e-soon')), 'seeded events get no alarm until saved in the app');

  // ---------------------------------------------------------------- the detail, then "All events"
  await showDay(at(1));
  ok(await openItem(N.added), 'the new event is in tomorrow’s agenda');
  ok(await detailOpen(), 'tapping an event opens its detail');
  const dt = await page.evaluate(() => ({ title: document.querySelector('.cal-dt-title').textContent, rows: document.querySelectorAll('.cal-dt-row').length }));
  ok(dt.title === N.added && dt.rows >= 6, `detail: title and rows for when, repeat, reminders, place, invitees, notes (${dt.rows})`);
  await shot('10-detail');
  await dlgBtn('primary'); // Edit
  ok(await editorOpen() && (await page.evaluate(() => document.querySelector('.cal-editor .cal-ed-title').value)) === N.added, 'Edit opens the editor filled in');
  await page.evaluate(() => { const i = document.querySelector('.cal-editor .cal-ed-title'); i.focus(); i.select(); });
  await page.keyboard.type(N.edited);
  await dlgBtn('primary');
  ok(await dialogOpen(''), 'saving a repeating event asks which events to change');
  await choose(await tt('cal.scopeAll'));
  let ed = await until(async () => { const e = await evById(added.id); return e?.title === N.edited && e; });
  ok(ed && ed.start === at(1, 13, 30) && ed.repeat?.freq === 'week', '"All events": the series is renamed, nothing else changes');
  ok((await events()).length === 7, 'no extra events');

  // "Only this event" on next week's occurrence
  await showDay(at(8));
  await openItem(N.edited);
  await dlgBtn('primary');
  await page.evaluate(() => { const i = document.querySelector('.cal-editor .cal-ed-title'); i.focus(); i.select(); });
  await page.keyboard.type(N.once);
  await setVal('.cal-editor .cal-ed-stime', '15:00');
  await dlgBtn('primary');
  await choose(await tt('cal.scopeOne'));
  const exc = await until(async () => (await events()).find((e) => e.title === N.once));
  ok(exc && exc.of === added.id && exc.orig === dkey(at(8)) && !exc.repeat && exc.start === at(8, 15), '"Only this event": a changed copy of that occurrence');
  ok((await evById(added.id)).exdates?.includes(dkey(at(8))), 'the series skips that day');
  items = await dayItems();
  ok(items.some((i) => i.title === N.once) && !items.some((i) => i.title === N.edited), 'that day shows the changed occurrence only');
  await showDay(at(15));
  ok((await dayItems()).some((i) => i.title === N.edited), 'the week after is unchanged');

  // delete "This and future events", then Undo
  await openItem(N.edited);
  await dlgBtn('danger');
  await choose(await tt('cal.scopeFuture'));
  ed = await until(async () => { const e = await evById(added.id); return e?.repeat?.until && e; });
  ok(ed && ed.repeat.until === dkey(at(14)), `"This and future events": the series ends the day before (${ed?.repeat?.until})`);
  ok(!(await dayItems()).some((i) => i.title === N.edited) && !!(await evById(exc.id)), 'that occurrence is gone; the earlier changed one stays');
  ok(await exists('.ou-toast .ou-toast-action'), 'toast offers Undo');
  await click('.ou-toast .ou-toast-action');
  ok(await until(async () => !(await evById(added.id))?.repeat?.until), 'Undo brings the series back');

  // ---------------------------------------------------------------- context menu delete + Undo (one event)
  await showDay(soonStart.getTime());
  await page.evaluate((t) => { const b = [...document.querySelectorAll('.cal-day-list .cal-item')].find((b) => b.querySelector('.cal-item-title').textContent === t); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 })); }, N.soon);
  await sleep(300);
  ok((await count('.ou-menu .ou-menu-item')) === 4, 'right-click: Edit / Duplicate / Share / Delete');
  ok(await page.evaluate(() => { const r = document.querySelector('.ou-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), 'menu inside the screen');
  await shot('11-event-menu');
  await click('.ou-menu .ou-menu-item.danger');
  ok(await until(async () => !(await evById('e-soon'))), 'Delete removes the event');
  // Undo right away: the toast lasts 2.8 s, a screenshot here could outlast it on a busy machine
  ok(await page.evaluate(() => { const b = document.querySelector('.ou-toast .ou-toast-action'); b?.click(); return !!b; }), 'toast offers Undo');
  ok(await until(async () => (await evById('e-soon'))?.title === N.soon), 'Undo brings it back');
  if (soonStart.getTime() - 10 * 60e3 > Date.now()) ok(await until(() => alarmOf('event:e-soon')), 'Undo plans its (legacy "10 minutes") reminder');

  // ---------------------------------------------------------------- Week view: drag to create, move, resize
  await openApp('calendar', { view: 'week', date: at(0) });
  await page.evaluate(() => { const s = document.querySelector('.cal-tl-scroll'); const hh = parseFloat(document.querySelector('.cal-tl').style.getPropertyValue('--hh')); s.scrollTop = 9 * hh; });
  await sleep(200);
  const free = await page.evaluate(() => {
    const hh = parseFloat(document.querySelector('.cal-tl').style.getPropertyValue('--hh'));
    const col = [...document.querySelectorAll('.cal-tl-col')].find((c) => ![...c.querySelectorAll('.cal-tl-ev')].some((e) => +e.style.getPropertyValue('--t') < 780 && +e.style.getPropertyValue('--b') > 600));
    const r = col.getBoundingClientRect(), top = document.querySelector('.cal-tl-cols').getBoundingClientRect().top;
    return { day: col.dataset.day, x: r.left + r.width / 2, top, hh };
  });
  const yAt = (m) => free.top + (m / 60) * free.hh;
  await page.mouse.move(free.x, yAt(605));
  await page.mouse.down();
  for (let m = 615; m <= 685; m += 10) { await page.mouse.move(free.x, yAt(m)); await sleep(16); }
  await page.mouse.up();
  await sleep(500);
  ok(await editorOpen(), 'dragging on empty hours opens New event');
  const dv = await page.evaluate(() => [document.querySelector('.cal-ed-sdate').value, document.querySelector('.cal-ed-stime').value, document.querySelector('.cal-ed-etime').value]);
  ok(dv[0] === free.day && dv[1] === '10:00' && dv[2] === '11:30', `…with the dragged times (${dv.join(' ')})`);
  await page.type('.cal-editor .cal-ed-title', N.drag);
  await dlgBtn('primary');
  const dg = await until(async () => (await events()).find((e) => e.title === N.drag));
  const [dy, dmo, dd] = free.day.split('-').map(Number);
  const dAt = (h, m = 0) => new Date(dy, dmo - 1, dd, h, m).getTime();
  ok(dg && dg.start === dAt(10) && dg.end === dAt(11, 30), 'drag-created event saved');
  await sleep(300);
  const evBox = async () => page.evaluate((id) => { const e = [...document.querySelectorAll('.cal-tl-ev')].find((x) => x.dataset.key.startsWith(id + '/')); const r = e?.getBoundingClientRect(); return r && { x: r.left + r.width / 2, top: r.top, bottom: r.bottom }; }, dg.id);
  let bx = await evBox();
  await page.mouse.move(bx.x, bx.top + 12);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(bx.x, bx.top + 12 + (free.hh * i) / 6); await sleep(16); }
  await page.mouse.up();
  ok(await until(async () => (await evById(dg.id))?.start === dAt(11)), 'dragging the event an hour down moves it to 11:00');
  ok((await evById(dg.id)).end === dAt(12, 30), '…keeping its length');
  await sleep(300);
  bx = await evBox();
  // aim at 13:00 on the hours grid (measured again: the view was redrawn)
  const colsTop = await page.evaluate(() => document.querySelector('.cal-tl-cols').getBoundingClientRect().top);
  const y13 = colsTop + 13 * free.hh;
  await page.mouse.move(bx.x, bx.bottom - 3);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(bx.x, bx.bottom - 3 + (y13 - (bx.bottom - 3)) * (i / 5)); await sleep(16); }
  await page.mouse.up();
  const rz = await until(async () => { const e = await evById(dg.id); return e?.end === dAt(13) && e; });
  ok(rz, `dragging its bottom edge makes it end at 13:00 (${new Date((await evById(dg.id))?.end).toTimeString().slice(0, 5)})`);
  await shot('12-week-drag');

  // ---------------------------------------------------------------- search
  await openApp('calendar', { view: 'month', date: at(0) });
  await page.evaluate((l) => [...document.querySelectorAll('.cal-bar .ou-icon-btn')].find((b) => b.getAttribute('aria-label') === l).click(), await tt('common.search'));
  await sleep(300);
  ok(await exists('.cal.searching .cal-search-in'), 'search opens');
  await page.type('.cal-search-in', N.multi.slice(0, 5));
  await sleep(400);
  const res = await texts('.cal-results .cal-item-title');
  ok(res.includes(N.multi), `search finds events (${res.join(' | ')})`);
  await shot('13-search');
  await openItem(N.multi, '.cal-results .cal-item');
  ok(await detailOpen(), 'a result opens its detail');
  await escape();
  await escape();
  ok(!(await exists('.cal.searching')), 'Esc closes search');

  // ---------------------------------------------------------------- settings
  await click('.cal-bar .ou-icon-btn');
  await click('.cal-dw-top .ou-icon-btn');
  await sleep(400);
  ok(await exists('.cal-sub-page'), 'the drawer’s gear opens Calendar settings');
  await page.evaluate((l) => [...document.querySelectorAll('.cal-sub-page .ou-row')].find((r) => r.querySelector('.ou-row-title')?.textContent === l).click(), await tt('cal.weekNumbers'));
  await sleep(200);
  ok((await store('calPrefs'))?.weekNumbers === true, 'Show week numbers is saved');
  await click('.cal-set-first');
  await choose(await mod('./js/calendar/format.js', 'weekdayName', 1));
  ok((await store('calPrefs'))?.firstDay === 1, 'First day of week: Monday');
  await click('.cal-set-alt');
  await choose(await tt('cal.altHijri'));
  ok((await store('calPrefs'))?.alt === 'islamic-umalqura', 'Alternate calendar: Hijri');
  await shot('14-settings');
  await click('.cal-sub-page .app-back');
  await sleep(500);
  const st = await page.evaluate(() => ({ wn: document.querySelectorAll('.cal-wn').length, first: document.querySelector('.cal-wd')?.textContent, alt: document.querySelectorAll('.cal-alt').length, sub: document.querySelector('.cal-sub')?.textContent }));
  ok(st.wn >= 4, 'week numbers beside the weeks');
  ok(st.first === (await mod('./js/calendar/format.js', 'weekdayName', 1, 'short')), `weeks start on Monday (${st.first})`);
  ok(st.alt >= 28 && st.sub.length > 3, `Hijri dates in the cells and the title (${st.sub})`);
  await shot('15-month-hijri');
  await mod('./js/calendar/data.js', 'setPrefs', { weekNumbers: false, firstDay: null, alt: '' });
  await sleep(300);

  // ---------------------------------------------------------------- manage calendars: create, show/hide
  await click('.cal-bar .ou-icon-btn');
  await page.evaluate((l) => [...document.querySelectorAll('.cal-dw-item')].find((b) => b.textContent.trim() === l).click(), await tt('cal.manage'));
  await sleep(500);
  ok(await exists('.cal-sub-page .cal-mg-create'), 'Manage calendars');
  await click('.cal-mg-create');
  await page.keyboard.type(ar ? 'العمل' : 'Work');
  await dlgBtn('primary');
  const cals = await until(async () => { const c = await store('calendars'); return c?.length === 2 && c; });
  ok(cals && cals[1].name === (ar ? 'العمل' : 'Work') && cals[1].color && cals[1].color !== cals[0].color, 'a new calendar with its own colour');
  await shot('16-manage');
  await click('.cal-sub-page .app-back');
  await sleep(400);
  await click('.cal-bar .ou-icon-btn');
  ok((await count('.cal-dw-cal')) === 4, 'the drawer lists it');
  await click('.cal-dw-cal[data-cal="my"]');
  ok((await store('calPrefs'))?.hidden?.includes('my'), 'unticking a calendar hides it');
  await escape();
  ok(!(await bars()).some((b) => b.t === N.multi), 'its events leave the grid');
  await click('.cal-bar .ou-icon-btn');
  await click('.cal-dw-cal[data-cal="my"]');
  await escape();
  ok((await bars()).some((b) => b.t === N.multi), 'ticking it shows them again');

  // ---------------------------------------------------------------- .ics import into a new calendar
  const ymd = (ms) => dkey(ms).replace(/-/g, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Team', 'BEGIN:VEVENT', 'UID:imp-1', `DTSTART:${ymd(at(2))}T090000`, `DTEND:${ymd(at(2))}T100000`, `SUMMARY:${N.imp}`, 'RRULE:FREQ=WEEKLY;COUNT=3', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:imp-2', `DTSTART;VALUE=DATE:${ymd(at(9))}`, `DTEND;VALUE=DATE:${ymd(at(11))}`, 'SUMMARY:Offsite', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  await page.evaluate((txt) => import('./js/calendar/manage.js').then((m) => { window.__imp = m.importText(txt, 'team'); }), ics);
  await sleep(400);
  await choose(ar ? 'تقويم جديد' : 'New calendar');
  await sleep(300);
  const imp = (await events()).filter((e) => e.uid === 'imp-1' || e.uid === 'imp-2');
  const newCal = (await store('calendars'))?.find((c) => c.name === 'Team');
  ok(newCal && imp.length === 2 && imp.every((e) => e.cal === newCal.id), 'import: 2 events into a new calendar named after the file');
  const i1 = imp.find((e) => e.uid === 'imp-1');
  ok(i1 && i1.repeat?.count === 3 && JSON.stringify(i1.alerts) === '[30]' && i1.start === at(2, 9), 'import: repeat rule, reminder and time kept');
  ok(await until(() => alarmOf('event:' + i1?.id)), 'imported reminders are planned');
  await page.evaluate((txt) => import('./js/calendar/manage.js').then((m) => { window.__imp = m.importText(txt, 'team'); }), ics);
  await sleep(400);
  await choose('Team');
  await sleep(300);
  ok((await events()).filter((e) => e.uid === 'imp-1' || e.uid === 'imp-2').length === 2, 'importing the same file again replaces, not doubles');
  await showDay(at(9));
  ok((await dayItems()).some((i) => i.title === 'Offsite'), 'imported all-day event is on its day');

  // ---------------------------------------------------------------- subscription by URL (a local server), refreshed by the worker
  let feed = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:League', 'BEGIN:VEVENT', 'UID:m1', `DTSTART:${ymd(at(4))}T180000`, `DTEND:${ymd(at(4))}T200000`, `SUMMARY:${N.sub}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar', 'Access-Control-Allow-Origin': '*' }); res.end(feed); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feedUrl = `http://127.0.0.1:${server.address().port}/league.ics`;
  try {
    await click('.cal-bar .ou-icon-btn');
    await page.evaluate((l) => [...document.querySelectorAll('.cal-dw-item')].find((b) => b.textContent.trim() === l).click(), await tt('cal.manage'));
    await sleep(500);
    // Chrome's permission prompt for the feed's site can't be answered in headless Chrome (request() never settles
    // since manifest.json declares optional host permissions): answer it as declined. The feed allows cross-origin
    // requests, so subscribing still works without the permission.
    await page.evaluate(() => { chrome.permissions.request = () => Promise.resolve(false); });
    await click('.cal-mg-subscribe');
    await page.keyboard.type(feedUrl);
    await dlgBtn('primary');
    const subs = await until(async () => { const s = await store('calSubs'); return s?.length === 1 && s; }, 6000);
    ok(subs && subs[0].url === feedUrl && subs[0].name === 'League', 'subscribe: the calendar is added with its name');
    const subEv = await until(async () => (await store('calSubEvents'))?.[subs?.[0]?.id]);
    ok(subEv?.length === 1 && subEv[0].title === N.sub && subEv[0].src === subs?.[0]?.id, 'subscribe: its events are kept apart (calSubEvents)');
    ok(await until(() => alarmOf('calsub:tick')), 'the worker keeps an hourly refresh alarm');
    await shot('17-manage-sub');
    await click('.cal-sub-page .app-back');
    await sleep(300);
    await showDay(at(4));
    const si = (await dayItems()).find((i) => i.title === N.sub);
    ok(si && si.ro, 'subscribed events show, read-only');
    await openItem(N.sub);
    ok(await detailOpen() && !(await page.evaluate(() => [...document.querySelectorAll('.cal-detail .ou-dialog-btn.danger')].length)), 'their detail has no Delete or Edit');
    await escape();
    feed = feed.replace(N.sub, N.sub + ' 2');
    const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'cal-sub-refresh' }));
    ok(r?.results?.[0]?.n === 1, 'the worker refreshes it on request');
    ok(await until(async () => (await dayItems()).some((i) => i.title === N.sub + ' 2')), 'the change shows in the agenda');
  } finally { server.close(); }

  // ---------------------------------------------------------------- the worker: reminder of a repeating event → next week
  const rs = Date.now() + 10 * 60e3;
  await sw.evaluate((ev) => chrome.storage.local.get('events').then(({ events }) => chrome.storage.local.set({ events: [...events, ev] })), { id: 'e-weekly', title: 'Weekly sync', start: rs, end: rs + 1800e3, allDay: false, repeat: { freq: 'week', interval: 1 }, alerts: [10], place: 'Room 9' });
  await sw.evaluate(() => chrome.alarms.create('event:e-weekly', { when: Date.now() + 300 }));
  const nt = await until(async () => ((await store('notifications')) || []).find((n) => n.ref === 'e-weekly'), 5000);
  ok(nt && nt.app === 'calendar' && nt.title === 'Weekly sync' && nt.body.includes('Room 9'), `the worker shows the reminder with its place (${nt?.body})`);
  const nx = await until(async () => { const a = await alarmOf('event:e-weekly'); return a && a.scheduledTime > Date.now() + 86400e3 && a; });
  ok(nx && Math.abs(nx.scheduledTime - (rs + 7 * D - 10 * 60e3)) < 3600e3 + 1000, 'then plans the next week’s reminder');

  // ---------------------------------------------------------------- Routines action, editEvent() from outside, params, Finder search
  const out = await page.evaluate((txt) => import('./js/routines/actions.js').then((m) => m.ACTIONS['calendar.event'].run({ env: 'page' }, { text: txt })), ar ? 'طبيب الأسنان غدا الساعة 9 ص' : 'Dentist checkup tomorrow 9am');
  const den = (await events()).find((e) => e.title === out);
  ok(den && den.start === at(1, 9) && out === (ar ? 'طبيب الأسنان' : 'Dentist checkup'), `Routines "Create event" parses the text (${out})`);
  await closeApp();
  await page.evaluate(() => import('./js/apps/calendar.js').then((m) => { window.__ed = m.editEvent(null, new Date()); }));
  await sleep(500);
  ok(await editorOpen(), 'editEvent() opens the editor over the Home screen');
  await page.type('.cal-editor .cal-ed-title', 'From outside');
  await dlgBtn('primary');
  ok(await until(async () => (await events()).some((e) => e.title === 'From outside')), '…and saves');
  await openApp('calendar', { id: 'e-past' });
  await sleep(300);
  ok(await detailOpen() && (await text('.cal-dt-title')) === N.past, 'params.id opens that event’s detail');
  await escape();
  await openApp('calendar', { section: 'event:e-soon' });
  await sleep(300);
  ok(await detailOpen() && (await text('.cal-dt-title')) === N.soon, 'a notification click (section event:<id>) opens its detail');
  await escape();
  const fs = await page.evaluate((q) => import('./js/core/apps.js').then((m) => m.getApp('calendar').search(q).map((r) => ({ title: r.title, sub: r.sub }))), N.multi.slice(0, 6));
  const endDay = await fmtLocal(at(2), { month: 'short', day: 'numeric' });
  ok(fs[0]?.title === N.multi && fs[0].sub.includes(endDay), `Finder search finds events; a multi-day one names its end date (${fs[0]?.sub})`);
  ok((await page.evaluate((q) => import('./js/core/apps.js').then((m) => m.getApp('calendar').search(q).length), ar ? 'غرفة' : 'room')) >= 1, 'Finder search also matches notes');
  await shot('18-final');
  await closeApp();

  // ---------------------------------------------------------------- widgets follow storage
  await sleep(400);
  const up2 = await page.evaluate((s) => [...document.querySelectorAll(s + ' .wg-cal-ev .wg-cal-ev-title')].map((x) => x.textContent), upW);
  ok(up2.length === 3 && up2[0] === N.multi, `upcoming widget updates after edits (${up2.join(' | ')})`);
  await page.evaluate(() => import('./js/core/store.js').then((m) => { m.store.set('events', []); m.store.set('contacts', null); m.store.set('calSubs', []); }));
  await sleep(500);
  ok(await exists(upW + ' .wg-cal-empty'), 'upcoming widget: "No events today" when empty');
  ok(!(await exists(monthW + ' .wg-cal-day.has')), 'mini month drops the event marks');

  const errs = logs.filter((l) => l.includes('pageerror'));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
};
