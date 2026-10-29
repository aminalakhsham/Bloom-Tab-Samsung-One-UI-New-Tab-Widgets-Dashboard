// triple
// Now Brief end to end (js/shell/brief.js, the Lock screen card in lock.js, the Now Brief and Stack widgets in
// basic-widgets.js): the time rules, the morning sheet opening by itself once on the first new tab / unlock of the
// morning (only when the test allows it with localStorage bt.test.brief), every app's part (weather, events,
// reminders, medicine doses, birthdays, bills, daily puzzles, Daily activity, journal prompt), the Lock screen card
// with counts only, the evening brief (goals, tomorrow, alarm, Bedtime mode, sleep sounds) on the Lock screen and in
// the sheet, the Home screen widgets, and the Settings rows. The page's clock is moved with a Date stand-in installed
// before the page loads (localStorage dev.off), so morning, afternoon and night can be tried in one run.
// usage: .dev/run.sh .dev/brief.cjs   (THEME=dark, UI=ar)
module.exports = async (ctx) => {
  const { page, boot, ok, sleep, shot, P, mod, exists, visible, count, text, texts, logs, ui } = ctx;
  const AR = ui === 'ar';
  const L = (en, ar) => (AR ? ar : en);
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const setSet = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.setSetting(k, v)), k, v);
  const isLocked = () => mod('./js/shell/lock.js', 'isLocked');
  const noErrors = (from, what) => ok(!logs.slice(from).some((l) => l.includes('[pageerror]')), `${what}: no page errors`);
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const at = (o, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + o); d.setHours(h, m, 0, 0); return +d; };
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(120); } return null; };

  // no network: the forecast comes from the seed
  await page.setRequestInterception(true);
  page.on('request', (r) => (/open-meteo|bing\.com/.test(r.url()) ? r.abort() : r.continue()));
  // a movable clock for the page (keeps running, only shifted)
  await page.evaluateOnNewDocument(() => {
    const R = Date;
    let off = 0;
    try { off = +localStorage.getItem('dev.off') || 0; } catch {}
    function FakeDate(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off); }
    FakeDate.prototype = R.prototype;
    FakeDate.now = () => R.now() + off;
    FakeDate.parse = R.parse;
    FakeDate.UTC = R.UTC;
    globalThis.Date = FakeDate;
    globalThis.__setNow = (ms) => { off = ms - R.now(); try { localStorage.setItem('dev.off', String(off)); } catch {} };
  });
  const setNow = (ms) => page.evaluate((ms) => window.__setNow(ms), ms);
  const allow = (on = true) => page.evaluate((on) => (on ? localStorage.setItem('bt.test.brief', '1') : localStorage.removeItem('bt.test.brief')), on);
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__bootMs, { timeout: 30000 }); await sleep(900); };

  const now = Date.now(), D = 864e5;
  const md = (o) => dk(o).slice(5);
  const weather = {
    fetchedAt: at(0, 9, 25), location: { name: 'Testville', lat: 48.85, lon: 2.35, auto: false }, timezone: 'Europe/Paris',
    current: { temp: 23.4, code: 1, isDay: true, feels: 22, humidity: 60, wind: 10, windDir: 200, uv: 4, high: 26.1, low: 15.3 },
    hourly: [], daily: Array.from({ length: 3 }, (_, i) => ({ date: at(i, 0), min: 15.3, max: 26.1, code: 1, pop: 10, sunrise: at(i, 6, 50), sunset: at(i, 19, 10), uv: 5 })),
  };
  const data = {
    home: [[{ id: 'wb', type: 'widget', widget: 'now-brief', size: 'm', config: {} }, { id: 'ws', type: 'widget', widget: 'stack', size: 'm', config: {} }, { id: 'wbl', type: 'widget', widget: 'now-brief', size: 'l', config: {} }, { id: 'wss', type: 'widget', widget: 'stack', size: 's', config: {} }]],
    dock: [],
    weather,
    events: [
      { id: 'e1', title: L('Team standup', 'اجتماع الفريق'), start: at(0, 10, 30), end: at(0, 11), allDay: false, color: '#3e7bff' },
      { id: 'e2', title: L('Design review', 'مراجعة التصميم'), start: at(0, 16), end: at(0, 17), allDay: false, color: '#ff6a3d' },
      { id: 'e3', title: L('Dentist', 'طبيب الأسنان'), start: at(1, 9), end: at(1, 10), allDay: false, color: '#e5484d' },
    ],
    reminders: [
      { id: 'r1', title: L('Call the bank', 'الاتصال بالبنك'), done: false, due: at(-1, 15), created: now },
      { id: 'r2', title: L('Send the report', 'إرسال التقرير'), done: false, due: at(0, 18), created: now },
      { id: 'r3', title: L('Water the plants', 'سقي النباتات'), done: false, due: at(0, 11), created: now },
      { id: 'r4', title: 'Later', done: false, due: at(3, 9), created: now },
    ],
    alarms: [{ id: 'a1', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], label: L('Wake up', 'استيقظ'), enabled: true }],
    health: { profile: {}, units: { weight: 'kg', height: 'cm', water: 'ml' }, meds: [{ id: 'm1', name: L('Vitamin D', 'فيتامين د'), type: 'tablet', strength: '1000', unit: 'IU', shape: 'round', c1: '#ffd60a', bg: '#fff09a', sched: { kind: 'daily', times: [{ t: '09:00', n: 1 }, { t: '21:00', n: 1 }] }, start: dk(-20) }], medLog: [], water: [], sleep: [], mind: [], body: [], cycle: { days: {} }, mindful: [] },
    healthAct: { v: 1, days: { [dk(0)]: { breakH: [8, 9], activeH: Array(24).fill(0) } } },
    contacts: { v: 1, items: [{ id: 'c1', first: L('Omar', 'عمر'), last: L('Haddad', 'حداد'), bday: `1990-${md(0)}` }, { id: 'c2', first: 'Lina', last: 'Park', bday: `--${md(5)}` }], groups: [], favs: [], me: '', prefs: { sort: 'first', order: 'first', alert: 0, alertTime: '09:00' } },
    wallet: { v: 1, passes: [], spend: [], budgets: {}, prefs: { cur: 'USD', alertTime: '09:00' }, subs: [{ id: 's-sp', name: 'Spotify', amount: 10.99, cur: 'USD', cycle: 'm', start: dk(1), cat: 'music', alert: 1, state: 'active', at: now }] },
    games: { stats: {}, daily: { sudoku: { [dk(0)]: { won: true, ms: 300000 }, [dk(-1)]: { won: true, ms: 280000 } } }, saves: {}, ach: {} },
  };
  const names = [L('Team standup', 'اجتماع الفريق'), L('Dentist', 'طبيب الأسنان'), L('Omar', 'عمر'), 'Spotify', L('Vitamin D', 'فيتامين د'), L('Call the bank', 'الاتصال بالبنك'), '10.99'];

  // ════════════════════════════════════════ the rules
  let mark = logs.length;
  await boot({ data, settings: { location: { name: 'Testville', lat: 48.85, lon: 2.35 } } });
  const rules = await page.evaluate(() => import('./js/shell/brief.js').then((B) => {
    const d = (h, m = 0) => new Date(2026, 9, 17, h, m);
    return {
      due: [!B.briefDue(d(4, 59)), B.briefDue(d(5)), B.briefDue(d(11, 59)), !B.briefDue(d(12)), !B.briefDue(d(8), { lastDay: '2026-10-17' }), B.briefDue(d(8), { lastDay: '2026-10-16' }), !B.briefDue(d(8), { on: false })],
      eve: [!B.eveningOn(d(21, 29)), B.eveningOn(d(21, 30)), B.eveningOn(d(2)), !B.eveningOn(d(5)), !B.eveningOn(d(22), { on: false }), B.eveningOn(d(1), { at: '01:00' }), !B.eveningOn(d(23), { at: '01:00' }), B.eveningOn(d(19), { at: '19:00' })],
      phase: [B.phase(d(8)), B.phase(d(14)), B.phase(d(19)), B.phase(d(23)), B.phase(d(23), { evening: false })],
      coming: [B.dayKey(B.comingDay(d(22))), B.dayKey(B.comingDay(d(1)))],
      prompt: B.eveningPrompt(d(21)) === B.eveningPrompt(d(23, 59)) && B.eveningPrompt(d(23, 59)) === B.eveningPrompt(new Date(2026, 9, 18, 2)),
      closed: B.closedCount({ focus: { v: 60, goal: 60 }, done: { v: 1, goal: 5 }, breaks: { v: 8, goal: 8 } }),
      times: B.WIND_TIMES.length === 15 && B.WIND_TIMES[0] === '18:00' && B.WIND_TIMES.at(-1) === '01:00',
    };
  }));
  ok(rules.due.every(Boolean), 'the morning brief is due once a day from 5:00 until noon, never when off');
  ok(rules.eve.every(Boolean), 'the evening brief runs from its time (21:30 or another) until 5:00');
  ok(rules.phase.join() === 'morning,day,evening,night,evening', `the Stack turns with the time of day (${rules.phase})`);
  ok(rules.coming.join() === '2026-10-18,2026-10-17', 'after midnight "tomorrow" is the day already begun');
  ok(rules.prompt && rules.closed === 2 && rules.times, 'one evening prompt per evening; goals counted; 15 evening times');
  const order = await page.evaluate(() => import('./js/shell/basic-widgets.js').then((m) => ['morning', 'day', 'evening', 'night'].map((p) => m.stackCards(p, 'm')[0])));
  ok(order.join() === 'now-brief,health-rings,journal,now-brief', `Stack: the first card for morning, day, evening, night (${order})`);
  noErrors(mark, 'rules');

  // ════════════════════════════════════════ under automation it never opens by itself
  mark = logs.length;
  await setNow(at(0, 9, 30));
  await reload();
  ok(!(await exists('.nbr')), 'without bt.test.brief: no sheet on the first new tab of the morning');
  await setSet('lockMode', 'always');
  await reload();
  ok((await isLocked()) && !(await exists('#lock .lkb')), 'and no card on the Lock screen');
  await setSet('lockMode', 'never');

  // ════════════════════════════════════════ the morning sheet on the first new tab
  await allow();
  await reload();
  ok(await until(() => exists('.nbr[data-kind="morning"]')), 'the first new tab of the morning opens the Now Brief');
  ok((await page.evaluate(() => localStorage.getItem('bt.briefDay'))) === dk(0), 'and remembers it showed today (bt.briefDay)');
  await sleep(500);
  ok((await text('.nbr-hello')) === (await S('brief.morning')), 'greeting "Good morning"');
  ok((await text('.nbr-sum')).length > 10, `summary line (${await text('.nbr-sum')})`);
  ok(await exists('.nbr-wx') && (await text('.nbr-wx-main b')).includes('23'), 'weather card: 23°');
  const cards = await texts('.nbr-card-title');
  for (const k of ['brief.schedule', 'brief.remTitle', 'brief.meds', 'brief.birthdays', 'brief.bills', 'brief.puzzles', 'brief.activity', 'brief.journal']) ok(cards.includes(await S(k)), `card: ${await S(k)}`);
  const sheet = await text('.nbr');
  ok(sheet.includes(L('Team standup', 'اجتماع الفريق')) && sheet.includes(L('Design review', 'مراجعة التصميم')) && !sheet.includes(L('Dentist', 'طبيب الأسنان')), "today's events (not tomorrow's)");
  ok(sheet.includes(await S('brief.dueToday.two')) && sheet.includes(await S('brief.overdue.one')) && !sheet.includes('Later'), 'reminders: 2 due today · 1 overdue (not the one in 3 days)');
  ok(sheet.includes(await S('brief.taken', { n: 0, total: 2 })) && sheet.includes(L('Vitamin D', 'فيتامين د')), 'medications: 0 of 2 taken, by name once unlocked');
  ok(sheet.includes(L('Omar', 'عمر')) && /36|3\d/.test(sheet), 'birthday today with the age');
  ok(sheet.includes('Spotify') && sheet.includes('10.99'), 'the bill due tomorrow');
  ok(sheet.includes(await S('brief.solved', { n: 1, total: 4 })) || sheet.includes('1/'), 'daily puzzles: 1 solved');
  ok(await exists('.nbr-rings svg') && (await count('.nbr-ringvals > div')) === 3, 'Daily activity rings with their three values');
  ok(await exists('.nbr-prompt .nbr-quote') && (await text('.nbr-prompt .nbr-quote')).length > 10, 'a journal prompt');
  ok((await ctx.outside('.nbr')).length === 0, 'the sheet fits the screen');
  await shot(P + 'brief-01-morning');
  await page.evaluate(() => document.querySelector('.nbr-scroll').scrollTo(0, 9999));
  await sleep(200);
  await shot(P + 'brief-02-morning-end');
  await page.click('.nbr-ok');
  await sleep(500);
  ok(!(await exists('.nbr')), 'Done closes it');
  await reload();
  ok(!(await exists('.nbr')), 'a second new tab the same morning: no brief');
  // the widget opens it; a card opens its app
  await page.click('#home .widget-tile[data-id="wb"] .wg');
  ok(await until(() => exists('.nbr-scrim.show')), 'tapping the Now Brief widget opens the sheet');
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.nbr-card')].find((c) => c.dataset.go === 'calendar')?.click());
  await sleep(1200);
  ok(!(await exists('.nbr')) && (await mod('./js/core/apps.js', 'currentApp')) === 'calendar', 'the Schedule card opens Calendar');
  await ctx.closeApp();
  await page.evaluate(() => import('./js/shell/brief.js').then((m) => m.openBrief({ kind: 'morning' })));
  await sleep(600);
  await page.click('.nbr-pill[data-act="write"]');
  await sleep(1300);
  ok((await mod('./js/core/apps.js', 'currentApp')) === 'journal', 'Write opens a new journal entry with the prompt');
  await ctx.closeApp();
  await page.keyboard.press('Escape');
  noErrors(mark, 'morning sheet');

  // ════════════════════════════════════════ the Lock screen card (counts only) and the first unlock
  mark = logs.length;
  await page.evaluate(() => localStorage.removeItem('bt.briefDay'));
  await setSet('lockMode', 'always');
  await reload();
  ok(await isLocked(), 'locked');
  ok(await until(() => exists('#lock .lkb')), 'the Now Brief card on the Lock screen');
  const card = await text('#lock .lkb');
  ok(card.includes(await S('brief.events.two')) && card.includes(await S('brief.remindersN.n', { n: 3 })) && card.includes(await S('brief.dosesDue.one')), `counts: 2 events, 3 reminders, 1 dose due (${card})`);
  ok(card.includes(await S('brief.bdays.one')) && card.includes(await S('brief.billsN.one')), 'and 1 birthday, 1 bill');
  ok(names.every((n) => !card.includes(n)), 'no event, reminder, medicine, person or bill named on the Lock screen');
  ok(!(await exists('.nbr')), 'the sheet waits for the unlock');
  ok((await ctx.outside('#lock .lkb')).length === 0, 'the card fits');
  await shot(P + 'brief-03-lock-morning');
  await page.keyboard.press('Enter');
  ok(await until(() => exists('.nbr[data-kind="morning"]'), 4000), 'the first unlock of the morning opens the brief');
  await page.keyboard.press('Escape');
  await sleep(500);
  ok(!(await exists('.nbr')), 'Escape closes it');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(800);
  await page.click('#lock .lkb');
  ok(await until(() => exists('.nbr[data-kind="morning"]'), 4000) && !(await isLocked()), 'tapping the card unlocks and opens the brief');
  await page.click('.nbr-never');
  await sleep(500);
  ok((await ctx.store('settings')).nowBriefAuto === false && !(await exists('.nbr')), '"Don’t show automatically" turns the automatic brief off');
  await setSet('nowBriefAuto', true);
  noErrors(mark, 'lock card');

  // ════════════════════════════════════════ the evening brief
  mark = logs.length;
  await setNow(at(0, 22, 0));
  await reload();
  ok(await isLocked() && (await until(() => exists('#lock .lkb.night'))), 'at 22:00 the Lock screen shows the evening brief');
  const night = await text('#lock .lkb');
  ok(night.includes(await S('brief.startsAt', { when: await S('common.tomorrow'), time: await page.evaluate(() => import('./js/core/i18n.js').then((m) => m.fmtTime(new Date(new Date().setHours(33, 0, 0, 0))))) })), `tomorrow's first event time (${night})`);
  ok(!night.includes(L('Dentist', 'طبيب الأسنان')) && /7:00|07:00/.test(night), 'no title; the 7:00 alarm');
  ok(await exists('#lock .lkb .nbr-act[data-act="bedtime"]') && (await exists('#lock .lkb .nbr-act[data-act="sounds"]')), 'Bedtime mode and Sleep sounds buttons');
  await shot(P + 'brief-04-lock-evening');
  await page.click('#lock .lkb .nbr-act[data-act="bedtime"]');
  await sleep(700);
  const bed = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.getTiles().find((x) => x.id === 'bedtime')?.on()));
  ok(bed === true && (await isLocked()), 'Bedtime mode turns on from the Lock screen (Digital Wellbeing tile), still locked');
  await page.click('#lock .lkb .nbr-act[data-act="sounds"]');
  await sleep(500);
  ok((await page.evaluate(() => import('./js/shell/sounds.js').then((m) => m.state().playing))) && (await isLocked()), 'Sleep sounds play, still locked');
  await page.click('#lock .lkb .nbr-act[data-act="sounds"]');
  await page.click('#lock .lkb .nbr-act[data-act="bedtime"]');
  await sleep(500);
  await page.click('#lock .lkb .lkb-head');
  ok(await until(() => exists('.nbr[data-kind="evening"]'), 4000), 'tapping the card opens the evening sheet');
  await sleep(400);
  const eve = await text('.nbr');
  ok((await text('.nbr-hello')) === (await S('brief.evening')), 'greeting "Good evening"');
  ok(eve.includes(L('Dentist', 'طبيب الأسنان')) && eve.includes(await S('common.tomorrow')), 'tomorrow: the dentist, by name once unlocked');
  ok(eve.includes(await S('brief.alarmAt', { time: await page.evaluate(() => import('./js/core/i18n.js').then((m) => m.fmtTime(new Date(2026, 0, 1, 7)))) })), 'the 7:00 alarm');
  ok(await exists('.nbr-rings svg') && (await exists('.nbr-prompt .nbr-quote')), 'goals reached and a prompt about the day');
  ok((await count('.nbr .nbr-acts .nbr-act')) === 2, 'Bedtime mode and Sleep sounds in the sheet');
  ok((await ctx.outside('.nbr')).length === 0, 'the sheet fits');
  await shot(P + 'brief-05-evening');
  await page.click('.nbr-ok');
  await sleep(400);
  noErrors(mark, 'evening');

  // ════════════════════════════════════════ the Home screen widgets
  mark = logs.length;
  await setSet('lockMode', 'never');
  await setNow(at(0, 9, 30));
  await page.evaluate(() => localStorage.setItem('bt.briefDay', localStorage.getItem('bt.briefDay') || ''));
  await reload();
  await page.keyboard.press('Escape');
  await sleep(300);
  const wtxt = await text('#home .widget-tile[data-id="wb"]');
  ok(wtxt.includes(await S('brief.morning')) && wtxt.includes(L('Team standup', 'اجتماع الفريق')), `Now Brief widget: the greeting and the next event (${wtxt.slice(0, 60)})`);
  ok((await count('#home .widget-tile[data-id="wbl"] .brief-row')) >= 5 && (await exists('#home .widget-tile[data-id="wbl"] .brief-rings svg')), 'large: more lines and the rings');
  const allW = (await page.$$eval('#home .widget-tile', (l) => l.map((x) => x.innerText))).join('\n');
  ok(!/\b(null|undefined|NaN)\b/.test(allW), 'no stray "null", "undefined" or "NaN" in the Now Brief and Stack widgets');
  const stk = await page.$$eval('#home .widget-tile[data-id="ws"] .stk-card', (l) => l.map((c) => c.dataset.card));
  ok(stk[0] === 'now-brief' && stk.length >= 3 && (await count('#home .widget-tile[data-id="ws"] .stk-dots i')) === stk.length, `Stack (morning): Now Brief first, dots for every card (${stk})`);
  ok((await count('#home .widget-tile[data-id="wss"] .stk-card')) >= 3, 'the small Stack has its own cards');
  await shot(P + 'brief-06-widgets');
  // wheel turns one card
  const box = await page.$eval('#home .widget-tile[data-id="ws"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(700);
  const on1 = await page.$$eval('#home .widget-tile[data-id="ws"] .stk-dots i', (l) => l.findIndex((x) => x.classList.contains('on')));
  ok(on1 === 1, `the wheel turns the Stack to the 2nd card (${on1})`);
  // a mouse drag swipes back
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (AR ? -140 : 140), box.y, { steps: 6 });
  await page.mouse.up();
  await sleep(800);
  const on0 = await page.$$eval('#home .widget-tile[data-id="ws"] .stk-dots i', (l) => l.findIndex((x) => x.classList.contains('on')));
  ok(on0 === 0, `a drag swipes back to the first card (${on0})`);
  ok(!(await page.evaluate(() => document.body.classList.contains('home-edit'))) && !(await exists('.drag-ghost')), 'dragging the Stack does not move the widget');
  await shot(P + 'brief-07-stack');
  // in the afternoon it turns to Daily activity first
  await setNow(at(0, 14, 0));
  await setSet('reduceMotion', true);
  await sleep(600);
  const stk2 = await page.$$eval('#home .widget-tile[data-id="ws"] .stk-card', (l) => l.map((c) => c.dataset.card));
  ok(stk2[0] === 'health-rings', `at 14:00 the Stack starts with Daily activity (${stk2})`);
  noErrors(mark, 'widgets');

  // ════════════════════════════════════════ Settings › Lock screen › Now Brief
  mark = logs.length;
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(700);
  const top = '.app-win .app-stack > .app-page:last-child';
  const rowTitles = await texts(top + ' .ou-row-title');
  for (const k of ['brief.name', 'set.lk.briefAuto', 'set.lk.evening', 'set.lk.briefAt']) ok(rowTitles.includes(await S(k)), `Settings row: ${await S(k)}`);
  await page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t)?.click(), top, await S('set.lk.briefAt'));
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.ou-dialog .ou-radio-row')][9]?.click());
  await page.click('.ou-dialog .ou-dialog-btn.primary');
  await sleep(400);
  ok((await ctx.store('settings')).windDownAt === '22:30', 'Evening brief time: 22:30');
  await page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t)?.click(), top, await S('brief.name'));
  await sleep(300);
  ok((await ctx.store('settings')).nowBrief === false, 'Now Brief switch off');
  await shot(P + 'brief-08-settings');
  await ctx.closeApp();
  await setNow(at(0, 9, 30));
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(900);
  ok(!(await exists('#lock .lkb')), 'Now Brief off: no morning card');
  await setNow(at(0, 22, 0));
  await page.evaluate(() => import('./js/core/store.js').then((m) => m.setSetting('lockWidgets', ['weather'])));
  await sleep(300);
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(500);
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(900);
  ok(!(await exists('#lock .lkb')), 'at 22:00 with the evening brief time at 22:30: no evening card yet');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(500);
  noErrors(mark, 'settings');
  await page.setRequestInterception(false);
};
