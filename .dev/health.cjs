// triple
// Samsung Health end to end: Home cards and their quick actions, Manage items, Medications (Take, the log menu, add a
// medication, the service worker's reminders and its Taken button), Water, Sleep, Body composition, Mood, Cycle
// tracking, Breathe, Daily activity (rings from focusLog, reminders and break hours; the day page and the Activity
// tab), My page (goals, notifications, units), widgets, Finder commands, the Quick Panel tile, the Now Bar and the Lock
// screen (no medicine names). usage: .dev/run.sh .dev/health.cjs (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, openApp, closeApp, click, text, texts, count, exists, visible, mod, store, sleep, shot, P, ui, sw }) => {
  const pad = (n) => String(n).padStart(2, '0');
  const now = Date.now();
  const key = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const today = key(now), tomorrow = key(now + 864e5);
  const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // a dose due half an hour ago (or at midnight just after midnight) and one later today
  const dueT = key(now - 30 * 60000) === today ? hhmm(now - 30 * 60000) : '00:00';
  const laterT = key(now + 3 * 3600e3) === today ? hhmm(now + 3 * 3600e3) : '23:59';
  const at = (daysAgo, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return +d; };
  // Focus: 35 minutes today (ending before now), plus earlier days
  const fEnd = Math.min(now - 60000, at(0, 23, 0)), fStart = fEnd - 35 * 60000;
  const focusLog = [{ start: Math.max(at(0, 0, 0), fStart), end: fEnd }, { start: at(1, 10), end: at(1, 11) }, { start: at(2, 9), end: at(2, 9, 30) }];
  const reminders = [
    { id: 'r1', title: 'Pay bills', done: true, completedAt: Math.max(at(0, 0, 1), now - 3600e3) },
    { id: 'r2', title: 'Call mom', done: true, completedAt: Math.max(at(0, 0, 2), now - 1800e3) },
    { id: 'r3', title: 'Groceries', done: false },
  ];
  const cycleDays = {};
  for (const start of [50, 22]) for (let i = 0; i < 4; i++) cycleDays[key(now - (start - i) * 864e5)] = { flow: 'medium' };
  const health = {
    profile: { name: 'Sam Lee' },
    units: { weight: 'kg', height: 'cm', water: 'ml' },
    meds: [
      { id: 'med-a', name: 'Vitamin D', type: 'tablet', strength: '1000', unit: 'IU', shape: 'round', c1: '#ffd60a', bg: '#fff09a', sched: { kind: 'daily', times: [{ t: dueT, n: 1 }] }, start: key(now - 20 * 864e5) },
      { id: 'med-b', name: 'Metformin', type: 'tablet', strength: '500', unit: 'mg', shape: 'oval', c1: '#ffffff', bg: '#a9d9ff', sched: { kind: 'daily', times: [{ t: dueT, n: 1 }, { t: laterT, n: 2 }] }, start: key(now - 20 * 864e5) },
      { id: 'med-c', name: 'Ibuprofen', type: 'capsule', shape: 'capsule', c1: '#ff6b8a', c2: '#ffffff', bg: '#ffb6d9', sched: { kind: 'asNeeded' }, start: key(now - 20 * 864e5) },
    ],
    medLog: [],
    water: [{ id: 'w1', at: Math.max(at(0, 0, 5), now - 7200e3), ml: 500 }, { id: 'w2', at: at(1, 12), ml: 1500 }, { id: 'w3', at: at(2, 12), ml: 2200 }],
    sleep: [{ id: 's1', start: at(1, 23, 10), end: Math.min(at(0, 6, 50), now - 60000) }, { id: 's2', start: at(2, 23, 40), end: at(1, 7) }],
    mind: [{ id: 'm1', at: at(1, 18), valence: 1.3, labels: ['Happy'], areas: ['Work'] }],
    body: [{ id: 'b1', at: at(3, 8), kind: 'weight', value: 72 }, { id: 'b2', at: at(10, 8), kind: 'height', value: 175 }],
    cycle: { days: cycleDays },
    mindful: [{ id: 'mm1', at: at(1, 21), min: 2 }],
  };
  const healthAct = { v: 1, days: { [today]: { breakH: [9, 10, 11], activeH: Array(24).fill(0) } } };
  const homeWidgets = [[
    { id: 'hw1', type: 'widget', widget: 'health-rings', size: 'm', config: {} },
    { id: 'hw2', type: 'widget', widget: 'health-water', size: 's', config: {} },
    { id: 'hw3', type: 'widget', widget: 'health-meds', size: 'm', config: {} },
  ]];
  await boot({ data: { health, healthAct, focusLog, reminders, home: homeWidgets, dock: [] }, settings: { lockWidgets: ['health-rings', 'health-dose'] } });
  const data = async () => (await store('health')) || {};
  // cards open with an element click: a toast or the floating tabs can sit over a card near the window's bottom
  const openCard = (id) => page.evaluate((id) => document.querySelector('.hl-card-' + id).click(), id);
  // a failing step reopens the app on Home, so the next one starts where it expects
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      ok(false, name + ': ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '));
      await page.evaluate(() => document.querySelectorAll('.ou-dialog-scrim, .ou-menu-scrim').forEach((x) => x.remove()));
      await closeApp(); await openApp('health'); await sleep(400);
    }
  };

  // ——— widgets on the Home screen ———
  await step('widgets', async () => {
    ok(await exists('.wg-health-rings .hl-rings') && await count('.wg-health-rings .hw-row') === 3, 'Daily activity widget: rings and three rows');
    ok(/35/.test(await text('.wg-health-rings .hw-row[class]:first-child b') || await text('.wg-health-rings .hw-row b')), 'widget shows 35 Focus minutes (' + await text('.wg-health-rings .hw-row b') + ')');
    ok(await exists('.wg-health-meds .hw-take') && /Metformin|Vitamin/.test(await text('.wg-health-meds')), 'Medications widget: the due time with names and Take');
    await shot(P + 'health-widgets');
    const w0 = (await data()).water.length;
    await click('.wg-health-water .hw-plus');
    await sleep(300);
    ok((await data()).water.length === w0 + 1 && (await data()).water.at(-1).ml === 250, 'Water widget + adds a 250 ml glass');
  });

  // ——— Home ———
  await openApp('health');
  await sleep(500);
  await step('home', async () => {
    ok(await exists('.app-win .hl-home-page'), 'Samsung Health opens on Home');
    ok(await count('.hl-home .hl-card') === 8, 'Home shows the 8 cards (' + await count('.hl-home .hl-card') + ')');
    ok((await page.evaluate(() => document.querySelector('.hl-home .hl-card')?.dataset.card)) === 'activity', 'Daily activity is the first card');
    const vals = await texts('.hl-card-activity .hl-act-val b');
    ok(vals.join() === '35,2,3', 'rings: Focus 35 min from focusLog, 2 tasks from reminders, 3 break hours (' + vals + ')');
    ok(await count('.hl-tabs .ou-tab') === 3, 'bottom navigation: Home, Activity, My page');
    ok(await page.evaluate(() => { const w = document.querySelector('.app-win').getBoundingClientRect(); return [...document.querySelectorAll('.hl-card')].every((c) => { const r = c.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1; }); }), 'cards fit the window’s width');
    await shot(P + 'health-home');
    // water − / +
    const w0 = (await data()).water.length;
    await click('.hl-card-water .hl-round.plus');
    await sleep(250);
    ok((await data()).water.length === w0 + 1, 'Water card + adds a glass');
    await click('.hl-card-water .hl-round.minus');
    await sleep(250);
    ok((await data()).water.length === w0, 'Water card − takes it back');
    // take the due doses from the card
    await click('.hl-card-meds [data-take-slot]');
    await sleep(300);
    const log = (await data()).medLog;
    ok(log.filter((e) => e.slot === `${today}T${dueT}` && e.status === 'taken').length === 2, 'Medications card: Take all logs both due doses');
    ok(/allDone|taken|تم/i.test(await text('.hl-card-meds')) || await exists('.hl-card-meds .hl-meds-time'), 'card moves on to the next time');
  });

  // ——— Mood from the Home card ———
  await step('mood', async () => {
    await click('.hl-card-mood [data-mood="great"]');
    await sleep(400);
    ok(await exists('.hl-mood-dlg .hl-face-btn.on[data-mood="great"]'), 'tapping a face opens the mood flow with it chosen');
    ok(await count('.hl-mood-dlg .hl-feel-chips .ou-chip') === 6, 'feelings for Great');
    await page.evaluate(() => { document.querySelector('.hl-mood-dlg .hl-feel-chips .ou-chip').click(); document.querySelector('.hl-mood-dlg .hl-area-chips .ou-chip').click(); });
    await page.type('.hl-mood-dlg textarea', 'Shipped it');
    await shot(P + 'health-mood-flow');
    await page.evaluate(() => document.querySelector('.hl-mood-dlg .ou-dialog-btn.primary').click());
    await sleep(400);
    const m = (await data()).mind.at(-1);
    ok(m && m.valence === 2.6 && m.labels[0] === 'Excited' && m.areas[0] === 'Work' && m.note === 'Shipped it', 'mood saved with feeling, area and note (' + JSON.stringify(m) + ')');
    ok(await exists('.hl-card-mood .hl-face-btn.on[data-mood="great"]'), 'the card shows today’s mood');
  });

  // ——— Medications page ———
  await step('meds page', async () => {
    await openCard('meds');
    await sleep(500);
    ok(await exists('.hl-meds-page') && await count('.hl-meds-page .hl-dosegrp') === 2, 'Medications page: today grouped by time (' + await count('.hl-meds-page .hl-dosegrp') + ')');
    ok(await count('.hl-meds-page .hl-dose.prn') === 1, 'as-needed medication listed');
    const later = `[data-check="med-b|${today}T${laterT}"]`;
    await click(later);
    await sleep(300);
    let e = (await data()).medLog.filter((x) => x.slot === `${today}T${laterT}`).at(-1);
    ok(e?.status === 'taken' && e.n === 2, 'round check: taken (2 tablets)');
    await click(later);
    await sleep(300);
    e = (await data()).medLog.filter((x) => x.slot === `${today}T${laterT}`).at(-1);
    ok(e?.status === 'cleared', 'second tap undoes it');
    await click(`.hl-meds-page .hl-dose[data-slot="${today}T${laterT}"] .hl-dose-t`);
    await sleep(300);
    ok(await count('.ou-menu .ou-menu-item') === 3, 'tapping a dose offers Taken / Skipped / Clear');
    await page.evaluate(() => document.querySelectorAll('.ou-menu .ou-menu-item')[1].click());
    await sleep(300);
    e = (await data()).medLog.filter((x) => x.slot === `${today}T${laterT}`).at(-1);
    ok(e?.status === 'skipped', 'menu: Skipped');
    await click('[data-log-prn="med-c"]');
    await sleep(300);
    ok((await data()).medLog.some((x) => x.med === 'med-c' && x.slot === '' && x.status === 'taken'), 'as needed: Log');
    await shot(P + 'health-meds');
  });

  await step('add medication', async () => {
    await page.evaluate(() => document.querySelector('.hl-meds-page .app-toolbar-actions .ou-icon-btn').click());
    await sleep(500);
    ok(await exists('.hl-edit-page'), 'Add medication page');
    await click('.hl-edit-page [data-save]');
    await sleep(200);
    ok(await visible('.hl-edit-page .hl-err'), 'saving without a name asks for one');
    await page.type('.hl-edit-page [data-f="name"]', 'Amoxicillin');
    await page.evaluate(() => document.querySelector('.hl-type-chips [data-value="capsule"]').click());
    await page.type('.hl-edit-page [data-f="strength"]', '250');
    await page.evaluate(() => document.querySelector('.hl-kind-chips [data-value="days"]').click());
    await sleep(100);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.hl-wday')]; b.forEach((x) => x.classList.contains('on') && x.click()); b.find((x) => x.dataset.wday === '1').click(); b.find((x) => x.dataset.wday === '4').click(); });
    await page.evaluate(() => document.querySelector('.hl-add-time').click());
    await sleep(100);
    ok(await count('.hl-time-row') === 2, 'Add time adds a second time');
    await page.evaluate(() => document.querySelector('.hl-shape[data-shape="softgel"]').click());
    await page.evaluate(() => document.querySelector('.hl-colors .ou-swatch:nth-child(16)').click());
    await shot(P + 'health-add-med');
    await click('.hl-edit-page [data-save]');
    await sleep(600);
    const m = (await data()).meds.find((x) => x.name === 'Amoxicillin');
    ok(m && m.type === 'capsule' && m.strength === '250' && m.unit === 'mg', 'saved with type and strength');
    ok(m && m.sched.kind === 'days' && m.sched.days.sort().join() === '1,4' && m.sched.times.length === 2 && m.shape === 'softgel' && m.c1 === '#0a84ff', 'schedule (Mon, Thu; 2 times), shape and colour saved (' + JSON.stringify(m?.sched) + ' ' + m?.shape + ' ' + m?.c1 + ')');
    await sleep(800);
    const alarms = await sw.evaluate(() => chrome.alarms.getAll().then((l) => l.map((a) => a.name)));
    ok(alarms.includes(`health:med:${tomorrow}T${laterT}`) || alarms.includes(`health:med:${tomorrow}T${dueT}`), 'service worker plans tomorrow’s reminders');
    ok(alarms.some((a) => a.startsWith('health:medf:')), 'and follow-ups');
    ok(alarms.includes('health:tick') && alarms.includes('health:coach'), 'Daily activity tick and coaching alarms');
  });

  await step('service worker Taken', async () => {
    // a dose logged from a notification goes to healthSW, and the page copies it into its own log
    await page.evaluate((s) => new Promise((r) => chrome.runtime.sendMessage({ type: 'health-med-action', slot: s, status: 'taken' }, r)), `${today}T${laterT}`);
    await sleep(300);
    const swLog = (await store('healthSW'))?.log || [];
    ok(swLog.length === 0, 'nothing to log: that dose was already skipped (' + swLog.length + ')');
    // clear it on the page, then take it from the "notification"
    await mod('./js/health/data.js', 'logMed', 'med-b', 'cleared', `${today}T${laterT}`);
    await sleep(200);
    const n = await page.evaluate((s) => new Promise((r) => chrome.runtime.sendMessage({ type: 'health-med-action', slot: s, status: 'taken' }, r)), `${today}T${laterT}`);
    await sleep(900);
    const log2 = (await store('healthSW'))?.log || [];
    ok(n === 1 && log2.length === 1 && log2[0].status === 'taken', 'the worker’s Taken writes healthSW only');
    ok((await data()).medLog.some((e) => e.id === log2[0]?.id), 'the page copies it into health.medLog');
  });

  await step('med page', async () => {
    await page.evaluate(() => document.querySelector('[data-med-open="med-b"]').click());
    await sleep(500);
    ok(await exists('.hl-med-page .hl-med-hero') && await count('.hl-adh-d') === 14, 'medication page with 14 days of adherence');
    ok(/\d/.test(await text('.hl-med-page .hl-adh .hl-big')), 'adherence percentage');
    await shot(P + 'health-med');
    await page.keyboard.press('Escape'); await sleep(400);
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Water page ———
  await step('water page', async () => {
    await openCard('water');
    await sleep(500);
    ok(await count('.hl-water-page .hc-col') === 31 && await count('.hl-water-page .hc-bar') >= 3, 'water chart: 31 days with bars');
    ok(await visible('.hl-water-page .hc-goal'), 'goal line');
    const w0 = (await data()).water.length;
    await click('.hl-water-page [data-add="500"]');
    await sleep(300);
    ok((await data()).water.length === w0 + 1 && (await data()).water.at(-1).ml === 500, 'quick add: a 500 ml bottle');
    for (const r of ['week', 'month']) {
      await page.evaluate((v) => [...document.querySelectorAll('.hl-water-page .hc-tabs .ou-seg-btn')].find((b, i) => i === (v === 'week' ? 1 : 2)).click(), r);
      await sleep(250);
      ok(await count('.hl-water-page .hc-plot.r-' + r + ' .hc-col') >= 12, `chart ${r}s`);
    }
    await page.evaluate(() => document.querySelectorAll('.hl-water-page .hc-tabs .ou-seg-btn')[0].click());
    await sleep(250);
    await page.evaluate(() => { const c = document.querySelectorAll('.hl-water-page .hc-col'); c[c.length - 2].click(); });
    await sleep(150);
    ok(/1,500|1500|1٬500/.test(await text('.hl-water-page .hc-val')), 'tapping yesterday’s bar shows its total (' + await text('.hl-water-page .hc-val') + ')');
    await shot(P + 'health-water');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Sleep ———
  await step('sleep', async () => {
    await openCard('sleep');
    await sleep(500);
    ok(await count('.hl-sleep-page .hc-bar') >= 1, 'sleep chart shows nights');
    await click('[data-add-sleep]');
    await sleep(400);
    await page.evaluate((d) => {
      const set = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('change')); };
      set('.ou-dialog [data-f="day"]', d); set('.ou-dialog [data-f="bed"]', '22:30'); set('.ou-dialog [data-f="wake"]', '06:10');
    }, key(now - 5 * 864e5));
    await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
    await sleep(400);
    const s = (await data()).sleep.at(-1);
    // 22:30 → 06:10 is 7 h 40 m, give or take a daylight-saving change that night. The dialog's date is the day you
    // woke up, so the night starts the evening before it (the old check used the next morning and failed in DST weeks).
    const wake = new Date(now - 5 * 864e5); wake.setHours(6, 10, 0, 0);
    const bed = new Date(wake); bed.setDate(bed.getDate() - 1); bed.setHours(22, 30, 0, 0);
    ok(s && Math.round((s.end - s.start) / 60000) === Math.round((wake - bed) / 60000), 'night recorded: 7 h 40 m (' + (s && (s.end - s.start) / 60000) + ')');
    await shot(P + 'health-sleep');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Body composition ———
  await step('body', async () => {
    await openCard('body');
    await sleep(500);
    ok(await count('.hl-body-page .hc-dot') >= 1, 'weight chart has points');
    ok(/23\.5|23٫5/.test(await text('.hl-body-page .hl-tile[data-kind="bmi"] b')), 'BMI from weight and height (' + await text('.hl-body-page .hl-tile[data-kind="bmi"] b') + ')');
    await click('[data-add-body]');
    await sleep(400);
    await page.evaluate(() => { const i = document.querySelector('.ou-dialog [data-f="weight"]'); i.value = '70.5'; const f = document.querySelector('.ou-dialog [data-f="fat"]'); f.value = '18'; });
    await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
    await sleep(400);
    const b = (await data()).body;
    ok(b.some((e) => e.kind === 'weight' && e.value === 70.5) && b.some((e) => e.kind === 'fat' && e.value === 18) && b.filter((e) => e.kind === 'height').length === 1, 'weight and body fat saved, height not repeated');
    await shot(P + 'health-body');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Cycle tracking ———
  await step('cycle', async () => {
    ok(/\d/.test(await text('.hl-card-cycle .hl-cy-status')), 'cycle card status (' + await text('.hl-card-cycle .hl-cy-status') + ')');
    await openCard('cycle');
    await sleep(500);
    ok(await count('.hl-cy-d.predicted') + await count('.hl-cy-d.fertile') + await count('.hl-cy-d.ovulation') >= 1 || await count('.hl-cy-d.period') >= 1, 'calendar shows logged / predicted / fertile days');
    const y = key(now - 864e5);
    if (y.slice(0, 7) === today.slice(0, 7)) {
      await click(`.hl-cy-d[data-day="${y}"]`);
      await sleep(250);
      await page.evaluate(() => document.querySelector('.hl-cy-prow .ou-switch input').click());
      await sleep(300);
      ok((await data()).cycle.days[y]?.flow === 'unspecified', 'switch logs a period day');
      await page.evaluate(() => document.querySelector('.hl-flow-chips [data-value="heavy"]').click());
      await page.evaluate(() => document.querySelector('.hl-sym-chips .ou-chip').click());
      await sleep(300);
      ok((await data()).cycle.days[y]?.flow === 'heavy' && (await data()).cycle.days[y]?.sym?.[0] === 'Cramps', 'flow and symptoms');
    }
    await shot(P + 'health-cycle');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Breathe ———
  await step('breathe', async () => {
    await click('.hl-card-breathe [data-breathe]');
    await sleep(1600);
    ok(await exists('.hl-br-stage.running'), 'Breathe starts from the card');
    await sleep(800);
    ok(await exists('.hl-br-stage.in') || await exists('.hl-br-stage.out'), 'breathe in / out phases (' + await text('.hl-br-text') + ')');
    await shot(P + 'health-breathe');
    const n0 = (await data()).mindful.length;
    await click('[data-br-end]');
    await sleep(300);
    ok(!(await exists('.hl-br-stage.running')) && (await data()).mindful.length === n0, 'ending before 30 s saves nothing');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  // ——— Daily activity ———
  await step('activity day', async () => {
    await openCard('activity');
    await sleep(500);
    ok(await exists('.hl-act-page .hl-act-big svg') && await count('.hl-act-page .hl-week-d') === 7, 'day page: big rings and the week');
    ok(await count('.hl-act-page .hc-hours') === 3, 'hourly charts for Focus, Tasks and Breaks');
    ok(await count('.hl-act-page .hc-hours.dots i.on') === 3, 'three break hours marked');
    await shot(P + 'health-activity-day');
    await click('.hl-act-page .hl-prev');
    await sleep(300);
    ok(!/35/.test(await text('.hl-act-page .hl-act-stat[data-ring="focus"] b')) && /60/.test(await text('.hl-act-page .hl-act-stat[data-ring="focus"] b')), 'previous day: 60 Focus minutes (' + await text('.hl-act-page .hl-act-stat[data-ring="focus"] b') + ')');
    await page.keyboard.press('Escape'); await sleep(400);
  });

  await step('activity tab', async () => {
    await click('.hl-tabs [data-tab="activity"]');
    await sleep(500);
    ok(await exists('.hl-history-page') && await count('.hl-history-page .hl-cal-d[data-day]') >= 28, 'Activity tab: month calendar of rings');
    ok(await exists('.hl-history-page .hl-challenge') && await exists('.hl-history-page .hl-awards'), 'monthly challenge and awards');
    await shot(P + 'health-activity-tab');
    // Set goals
    await page.evaluate(() => document.querySelector('.hl-history-page .app-toolbar-actions .ou-icon-btn').click());
    await sleep(400);
    ok(await count('.hl-goals .hl-goal-row') === 3, 'Set goals: three rings');
    await page.evaluate(() => { const b = document.querySelectorAll('.hl-goal-row[data-ring="focus"] .hl-step-b'); b[0].click(); b[0].click(); });
    await page.evaluate(() => document.querySelector('.hl-goals-dlg .ou-dialog-btn.primary').click());
    await sleep(400);
    const pr = await store('healthPrefs');
    ok(pr?.goals?.focus === 50 && pr.goalHist?.some((x) => x.from === today && x.focus === 50), 'Focus goal 60 → 50 from today (' + JSON.stringify(pr?.goals) + ')');
  });

  // ——— My page ———
  await step('my page', async () => {
    await click('.hl-tabs [data-tab="me"]');
    await sleep(500);
    ok(/SL/.test(await text('.hl-me-page .hl-avatar')) && /Sam Lee/.test(await text('.hl-me-page .hl-profile')), 'profile with initials');
    ok(await count('.hl-me-page .ou-switch') >= 5, 'notification switches');
    await page.evaluate(() => { const r = [...document.querySelectorAll('.hl-me-page .ou-row')].find((x) => /coaching|تشجيع/.test(x.textContent) && x.querySelector('.ou-switch')); r.querySelector('.ou-switch input').click(); });
    await sleep(300);
    ok((await store('healthPrefs'))?.notify?.coach === false, 'coaching can be turned off');
    await shot(P + 'health-me');
    // units: pounds
    await page.evaluate(() => [...document.querySelectorAll('.hl-me-page .ou-row')].find((x) => x.querySelector('.ico-sort')).click());
    await sleep(400);
    await page.evaluate(() => document.querySelector('.hl-units .ou-chip[data-value="lb"]').click());
    await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
    await sleep(400);
    ok((await data()).units?.weight === 'lb', 'units: pounds');
    await click('.hl-tabs [data-tab="home"]');
    await sleep(500);
    ok(/155|lb|رطل/.test(await text('.hl-card-body')), 'Body card in pounds (' + await text('.hl-card-body .hl-big') + ')');
  });

  // ——— Manage items ———
  await step('manage', async () => {
    await click('.hl-manage');
    await sleep(500);
    ok(await count('.hl-manage-row') === 8, 'Manage items lists every card');
    await page.evaluate(() => document.querySelector('.hl-manage-row[data-card="cycle"] .ou-switch input').click());
    await sleep(200);
    await page.evaluate(() => { const h = document.querySelector('.hl-manage-row[data-card="breathe"] .hl-drag'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    await sleep(200);
    const pr = await store('healthPrefs');
    ok(pr?.cards?.hidden?.includes('cycle'), 'cycle hidden');
    ok(pr?.cards?.order?.indexOf('breathe') === 6, 'Breathe moved up one place (' + pr?.cards?.order + ')');
    await shot(P + 'health-manage');
    await page.keyboard.press('Escape'); await sleep(500);
    ok(await count('.hl-home .hl-card') === 7 && !(await exists('.hl-card-cycle')), 'Home shows 7 cards');
  });

  // ——— Finder commands, Quick Panel, Now Bar ———
  await step('commands', async () => {
    await closeApp();
    const run = (q) => page.evaluate((q) => import('./js/core/hooks.js').then((m) => { const r = m.runCommands(q, () => {}).filter((x) => x.icon === 'drop' || String(x.icon).startsWith('hl')); const out = r.map((x) => ({ title: x.title, sub: x.sub, icon: x.icon })); if (r[0]) r[0].run({}); return out; }), q);
    let w0 = (await data()).water.length;
    let r = await run('drink 500ml');
    await sleep(300);
    ok(r.length === 1 && (await data()).water.at(-1).ml === 500 && (await data()).water.length === w0 + 1, '“drink 500ml” logs 500 ml (' + r[0]?.title + ')');
    r = await run('water');
    await sleep(300);
    ok(r.length === 1 && (await data()).water.at(-1).ml === 250, '“water” logs a glass');
    r = await run('drink 2 glasses');
    await sleep(300);
    ok((await data()).water.at(-1).ml === 500, '“drink 2 glasses” logs 500 ml');
    r = await run('took ibup');
    await sleep(300);
    const lg = (await data()).medLog.filter((e) => e.med === 'med-c');
    ok(r.length === 1 && lg.length === 2, '“took ibup” logs Ibuprofen (' + r[0]?.title + ')');
    r = await run('mood great');
    await sleep(300);
    ok(r.length === 1 && (await data()).mind.at(-1).valence === 2.6, '“mood great” logs a mood');
    r = await run(ui === 'ar' ? 'مزاج جيد' : 'mood good');
    await sleep(300);
    ok(r.length === 1 && (await data()).mind.at(-1).valence === 1.3, 'mood in the UI language');
    r = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('rings', () => {}).map((x) => x.sub)));
    ok(r.some((s) => /35/.test(s)), '“rings” shows today’s rings (' + r + ')');
    r = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('meds', () => {}).map((x) => x.title)));
    ok(r.length >= 1, '“meds” opens Medications');
    const search = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('health').search('metf').map((x) => x.title)));
    ok(search.includes('Metformin'), 'Finder search finds a medication');
    // Quick Panel tile
    w0 = (await data()).water.length;
    const tile = await page.evaluate(() => import('./js/core/hooks.js').then((m) => { const t = m.getTiles().find((x) => x.id === 'health-water'); t?.toggle(); return t?.label(); }));
    await sleep(300);
    ok(tile && (await data()).water.length === w0 + 1, 'Quick Panel tile logs water (' + tile + ')');
  });

  await step('now bar', async () => {
    // a new medication due now, nothing logged: the Now Bar shows it without its name
    await page.evaluate((t) => import('./js/health/data.js').then((H) => H.mut((d) => { d.meds.push({ id: 'med-z', name: 'Lisinopril', type: 'tablet', sched: { kind: 'daily', times: [{ t, n: 1 }] }, start: '2020-01-01' }); })), dueT);
    await sleep(300);
    const acts = await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().filter((a) => a.id.startsWith('health')).map((a) => a.title + ' ' + a.sub)));
    ok(acts.length === 1 && !/Lisinopril/.test(acts[0]), 'Now Bar: a due medication, no name (' + acts + ')');
  });

  // ——— Modes and Routines actions (run with a page's routine context) ———
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  await step('routines actions', async () => {
    const names = await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => ['health.water', 'health.mood', 'health.meds'].map((id) => A.ACTIONS[id] && A.ACTIONS[id].cat === 'apps' ? I.t(A.ACTIONS[id].name) : null)));
    ok(names.every((n) => n && !n.startsWith('health.')), 'Routines lists Log water, Log mood, Mark medications as taken (' + names + ')');
    const w0 = (await data()).water.length;
    let r = await runAction('health.water', { ml: '300' });
    const wl = (await data()).water;
    ok(wl.length === w0 + 1 && wl.at(-1).ml === 300 && r.v >= 300, 'Log water adds 300 ml and returns today’s total (' + JSON.stringify(r) + ')');
    r = await runAction('health.water', { ml: '0' });
    ok(r.err === 'health.ra.errWater' && (await data()).water.length === w0 + 1, 'Log water with no amount is an error and logs nothing');
    r = await runAction('health.mood', { mood: 'great' });
    ok((await data()).mind.at(-1).valence === 2.6 && r.v === (ui === 'ar' ? 'رائع' : 'Great'), 'Log mood saves Great (' + r.v + ')');
    const ib0 = (await data()).medLog.filter((e) => e.med === 'med-c').length;
    r = await runAction('health.meds', { med: 'ibup' });
    ok(r.v === 1 && (await data()).medLog.filter((e) => e.med === 'med-c').length === ib0 + 1, 'Mark medications as taken by name logs Ibuprofen');
    r = await runAction('health.meds', { med: 'Aspirin' });
    ok(r.err === 'health.ra.errMed', 'an unknown medication is an error');
    // the dose the Now Bar step left due (Lisinopril): no name → the doses due now
    r = await runAction('health.meds', {});
    await sleep(300);
    const due = await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().filter((a) => a.id.startsWith('health')).length));
    ok(r.v >= 1 && due === 0, 'with no name it logs the doses due now, and the Now Bar pill goes (' + r.v + ')');
  });

  // ——— the Tracker widget: its settings pick what it shows ———
  await step('tracker widget', async () => {
    await closeApp();
    await page.evaluate(() => import('./js/shell/home.js').then((m) => { window.__aw = m.addWidget('health-tracker', 's'); }));
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
    ok(await count('.ou-dialog .ou-radio-row') === 4, 'adding the Tracker widget asks which tracker (4 choices)');
    await shot(P + 'health-tracker-config');
    await page.evaluate(() => document.querySelectorAll('.ou-dialog .ou-radio-row')[1].click());
    await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
    await page.evaluate(() => window.__aw);
    await sleep(500);
    const item = ((await store('home')) || []).flat().find((x) => x.widget === 'health-tracker');
    ok(item?.config?.metric === 'sleep', 'the widget keeps the chosen tracker (' + JSON.stringify(item?.config) + ')');
    const tx = await text(`#home .tile[data-id="${item?.id}"] .wg`);
    ok(/Sleep|النوم/.test(tx || '') && /\d/.test(tx || ''), 'it shows last night’s sleep (' + tx + ')');
    // Widget settings again: Mood (today's mood was logged by the routine action above)
    const conf = await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__wc = m.getWidget('health-tracker').configure({ metric: 'sleep' }); return true; }));
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
    ok(conf && await page.evaluate(() => document.querySelectorAll('.ou-dialog .ou-radio-row input')[1].checked), 'Widget settings starts on the current tracker');
    await page.evaluate(() => document.querySelectorAll('.ou-dialog .ou-radio-row')[2].click());
    await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
    ok((await page.evaluate(() => window.__wc))?.metric === 'mood', 'and returns the new choice (Mood)');
    await openApp('health');
    await sleep(400);
  });

  // ——— Lock screen ———
  await step('lock', async () => {
    await mod('./js/shell/lock.js', 'lockNow');
    await sleep(900);
    const lockText = await page.evaluate(() => document.getElementById('lock')?.innerText || '');
    ok(await exists('#lock .hl-lkw .hl-rings'), 'Lock screen: Daily activity chip');
    ok(/\d/.test(lockText) && !/Lisinopril|Metformin|Vitamin|Ibuprofen|Amoxicillin/.test(lockText), 'Lock screen shows no medication names');
    await shot(P + 'health-lock');
  });
};
