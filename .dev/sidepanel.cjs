// triple — the Chrome side panel (sidepanel.html), opened directly in a narrow tab. usage: .dev/run.sh .dev/sidepanel.cjs
// Covers the bottom navigation (and Alt+1…5), Notes (list with pinned first, search, the quick editor saving into `notes`
// in the Notes app's shape, delete with Undo, empty notes not kept, another tab's change showing up), Reminder (today /
// upcoming / no date, the natural-language quick add with its `reminder:<id>` alarm, completing), Clock (preset and
// custom timers with their `timer:<id>` alarms, pause / resume / +1 min / delete, the stopwatch with laps), Calculator
// (keys, keyboard, the shared history), Music (nothing playing, a playing song from Samsung Music's state, ambient
// sounds), the lock hook, light / dark / Arabic and screenshots of every tab.
module.exports = async ({ page, url, sw, boot, ok, sleep, shot, P, ui, getStorage, setStorage, store, logs }) => {
  const SP = url.replace('newtab.html', 'sidepanel.html');
  const ar = ui === 'ar';
  const now = Date.now(), H = 3600e3;
  const today9 = new Date(); today9.setHours(23, 30, 0, 0);
  const tomorrow6 = new Date(); tomorrow6.setDate(tomorrow6.getDate() + 1); tomorrow6.setHours(18, 0, 0, 0);
  const note = (id, title, body, extra = {}) => ({ id, title, body, color: 'none', pinned: false, created: now - 5 * H, updated: now - 2 * H, ...extra });
  await boot({
    data: {
      notes: [
        note('n1', 'Shopping', '<div>Milk</div><div>Bread</div>', { updated: now - H }),
        note('n2', 'Trip ideas', '<div>Lisbon in May</div>', { pinned: true, color: 'blue', updated: now - 3 * H }),
      ],
      reminders: [
        { id: 'r1', title: 'Pay rent', notes: '', due: now - 20 * H, done: false, priority: true, created: now - 30 * H, completedAt: null },
        { id: 'r2', title: 'Call Sam', notes: 'About the trip', due: today9.getTime(), done: false, priority: false, created: now - 10 * H, completedAt: null },
        { id: 'r3', title: 'Dentist', notes: '', due: now + 50 * H, done: false, priority: false, created: now - 9 * H, completedAt: null },
        { id: 'r4', title: 'Read a book', notes: '', due: null, done: false, priority: false, created: now - 8 * H, completedAt: null },
        { id: 'r5', title: 'Old task', notes: '', due: now - 50 * H, done: true, priority: false, created: now - 60 * H, completedAt: now - 40 * H },
      ],
      calc: { history: [{ expr: '2+2', result: 4, time: now - H }] },
    },
  });
  await page.setViewport({ width: 400, height: 860 });
  await page.goto(SP);
  await page.waitForFunction(() => window.__spReady, { timeout: 15000 });
  await sleep(500);
  const T = (k, v) => page.evaluate((k, v) => import('./js/core/i18n.js').then((m) => m.t(k, v)), k, v);
  const go = async (id) => { await page.evaluate((id) => window.__spGo(id), id); await sleep(450); };
  const txt = (s) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, s);
  const all = (s) => page.evaluate((s) => [...document.querySelectorAll(s)].map((x) => x.textContent.trim()), s);
  const click = async (s) => { await page.waitForSelector(s, { timeout: 4000 }); await page.click(s); await sleep(300); };
  const alarm = (n) => sw.evaluate((n) => chrome.alarms.get(n).then((a) => a || null), n);

  // ════════════════ the panel
  ok(await page.evaluate(() => document.documentElement.dir) === (ar ? 'rtl' : 'ltr'), 'direction follows the language');
  const tabs = await all('.sp-tab .sp-tab-label');
  ok(tabs.length === 5 && tabs[0] === await T('sp.tab.notes') && tabs[4] === await T('sp.tab.music'), 'five tabs: ' + tabs.join(' · '));
  const nav = await page.evaluate(() => { const r = document.querySelector('.sp-tabs').getBoundingClientRect(); return { b: innerHeight - r.bottom, l: r.left, r: innerWidth - r.right }; });
  ok(nav.b >= 8 && nav.b <= 16 && nav.l >= 8 && nav.r >= 8, 'floating bottom navigation inside the panel ' + JSON.stringify(nav));
  ok(await page.evaluate(() => import('./js/sidepanel/gate.js').then(async (m) => typeof m.onRelock === 'function' && (await m.gate(document.body)) === true)), 'lock hook (gate) in place and open without a PIN');

  // ════════════════ Notes
  await go('notes');
  ok(await page.$eval('.sp-tab.active', (b) => b.dataset.tab) === 'notes', 'Notes tab active');
  let titles = await all('.sp-note-title');
  ok(titles[0] === 'Trip ideas' && titles[1] === 'Shopping', 'pinned note first: ' + JSON.stringify(titles));
  ok(await txt('.sp-sub') === await T('sp.notes.count', { n: 2 }), 'count under the title');
  await shot(P + 'sidepanel-01-notes');
  await page.type('.sp-search input', 'milk');
  await sleep(300);
  titles = await all('.sp-note-title');
  ok(titles.length === 1 && titles[0] === 'Shopping' && await page.evaluate(() => document.activeElement?.matches('.sp-search input')), 'search finds text inside notes and keeps the focus');
  await page.evaluate(() => { const i = document.querySelector('.sp-search input'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await sleep(250);
  ok((await all('.sp-note-title')).length === 2, 'clearing the search shows every note again');
  // a new note
  await click('.sp-fab');
  ok(await page.evaluate(() => document.activeElement?.classList.contains('sp-ed-title')), 'new note: the title field has focus');
  await page.keyboard.type('Side panel note');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Written next to a website');
  await sleep(600);
  await shot(P + 'sidepanel-02-editor');
  await click('.sp-back');
  let notes = await store('notes');
  const made = notes.find((n) => n.title === 'Side panel note');
  ok(made && /Written next to a website/.test(made.body) && made.color === 'none' && made.created && made.pinned === false, 'saved into `notes` in the Notes app’s shape: ' + JSON.stringify(made));
  ok((await all('.sp-note-title')).includes('Side panel note'), 'and listed');
  // editing an existing note
  await page.evaluate(() => [...document.querySelectorAll('.sp-note')].find((x) => x.textContent.includes('Shopping')).click());
  await sleep(300);
  await page.focus('.sp-ed-body');
  await page.keyboard.press('End');
  await page.evaluate(() => { const b = document.querySelector('.sp-ed-body'); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await page.keyboard.type(' Eggs');
  await sleep(600);
  ok(/Eggs/.test((await store('notes')).find((n) => n.id === 'n1').body), 'typing in the editor saves as you go');
  // an empty new note isn't kept
  await click('.sp-back');
  const count = (await store('notes')).length;
  await click('.sp-fab');
  await click('.sp-back');
  ok((await store('notes')).length === count, 'an empty new note is discarded');
  // another tab adds a note: it shows up
  await setStorage({ notes: [note('n9', 'From another tab', '<div>hi</div>', { updated: Date.now() }), ...(await store('notes'))] });
  await sleep(500);
  ok((await all('.sp-note-title'))[1] === 'From another tab', 'a note written elsewhere shows up at once');
  // delete from the menu, with Undo
  await page.evaluate(() => { const el = [...document.querySelectorAll('.sp-note')].find((x) => x.textContent.includes('From another tab')); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 })); });
  await sleep(300);
  await page.evaluate(() => document.querySelector('.ou-menu-item.danger').click());
  await sleep(400);
  ok(!(await store('notes')).some((n) => n.id === 'n9'), 'deleted from its menu');
  await page.evaluate(() => document.querySelector('.ou-toast-action')?.click());
  await sleep(400);
  ok((await store('notes')).some((n) => n.id === 'n9'), 'Undo brings it back');

  // ════════════════ Reminder
  await page.keyboard.down('Alt'); await page.keyboard.press('Digit2'); await page.keyboard.up('Alt');
  await sleep(500);
  ok(await page.$eval('.sp-tab.active', (b) => b.dataset.tab) === 'reminder', 'Alt+2 opens Reminder');
  ok(await txt('.sp-sub') === await T('sp.rem.dueToday', { n: 2 }), 'header: 2 due today (overdue counts)');
  const heads = await all('.sp-subheader');
  ok(JSON.stringify(heads) === JSON.stringify([await T('sp.rem.today'), await T('sp.rem.upcoming'), await T('sp.rem.noDate')]), 'Today, Upcoming and No date: ' + heads.join(' · '));
  ok(JSON.stringify(await all('.sp-rem-title')) === JSON.stringify(['Pay rent', 'Call Sam', 'Dentist', 'Read a book']), 'important and overdue first; completed ones left out');
  ok(await page.$eval('.sp-rem[data-id="r1"] .sp-rem-due', (e) => e.classList.contains('overdue')), 'overdue in red');
  await page.focus('.sp-add-in');
  await page.keyboard.type(ar ? 'اشتري الحليب غدًا الساعة 6 مساءً' : 'Buy milk tomorrow 6pm');
  await sleep(300);
  ok(!!(await txt('.sp-add-hint .sp-chip')), 'the time is read while typing: ' + await txt('.sp-add-hint .sp-chip'));
  await shot(P + 'sidepanel-03-reminder');
  await page.keyboard.press('Enter');
  await sleep(500);
  const rem = (await store('reminders')).find((r) => /milk|الحليب/.test(r.title));
  ok(rem && rem.due === tomorrow6.getTime() && !rem.done, 'quick add saved with its time: ' + JSON.stringify(rem));
  ok(!!(await alarm('reminder:' + rem?.id)), 'and its reminder:<id> alarm');
  ok(await page.$eval('.sp-add-in', (i) => i.value) === '', 'the field is cleared for the next one');
  await click('.sp-rem[data-id="r2"] .sp-check');
  await sleep(500);
  ok((await store('reminders')).find((r) => r.id === 'r2').done === true && !(await page.$('.sp-rem[data-id="r2"]')), 'ticking completes it');
  // a repeating reminder moves on to its next time (the Reminder app's setDone), and Undo brings it back as it was
  const r6due = now - H;
  await setStorage({ reminders: [...(await store('reminders')), { id: 'r6', title: 'Water plants', notes: '', due: r6due, repeat: { f: 'd' }, done: false, priority: false, created: now - 40 * H, completedAt: null }] });
  await sleep(600);
  await click('.sp-rem[data-id="r6"] .sp-check');
  await sleep(600);
  let rr = await store('reminders');
  const r6 = rr.find((r) => r.id === 'r6'), r6copy = rr.find((r) => r.from === 'r6');
  ok(r6 && !r6.done && r6.due > Date.now() && r6.repeat?.f === 'd' && r6copy?.done === true, 'completing a daily reminder logs a done copy and moves it to its next time');
  ok(!!(await alarm('reminder:r6')), 'its alarm follows the new time');
  await page.evaluate(() => document.querySelector('.ou-toast .ou-toast-action')?.click());
  await sleep(600);
  rr = await store('reminders');
  ok(rr.find((r) => r.id === 'r6')?.due === r6due && !rr.some((r) => r.from === 'r6'), 'Undo puts it back as it was, without the copy');

  // ════════════════ Clock
  await go('clock');
  ok(!!(await page.$('.sp-picker')) && (await page.$$('.sp-preset')).length === 7, 'timer picker and preset timers');
  await page.evaluate(() => document.querySelectorAll('.sp-preset')[2].click()); // 5 min
  await sleep(500);
  let timers = await store('timers');
  ok(timers.length === 1 && timers[0].duration === 5 * 60e3 && timers[0].running, '5-minute preset starts a timer in `timers`');
  ok(!!(await alarm('timer:' + timers[0].id)), 'with its timer:<id> alarm');
  await sleep(1200);
  ok(/^0?4:5\d$/.test(await txt('.sp-timer-time')), 'counts down: ' + await txt('.sp-timer-time'));
  // a custom one: 0:00:30
  await page.evaluate(() => { const [h, m, s] = document.querySelectorAll('.sp-pick-in'); h.value = '0'; m.value = '0'; s.value = '30'; s.dispatchEvent(new Event('input')); });
  await click('.sp-start');
  timers = await store('timers');
  ok(timers.length === 2 && timers[1].duration === 30e3, 'custom 30-second timer');
  await shot(P + 'sidepanel-04-timers');
  const id0 = timers[0].id;
  await page.evaluate((id) => document.querySelector(`.sp-timer[data-id="${id}"] .sp-round.primary`).click(), id0);
  await sleep(400);
  let t0 = (await store('timers')).find((x) => x.id === id0);
  ok(!t0.running && t0.remaining > 4 * 60e3 && !(await alarm('timer:' + id0)), 'pause keeps what was left and drops the alarm');
  await page.evaluate((id) => document.querySelector(`.sp-timer[data-id="${id}"] .sp-plus1`).click(), id0);
  await sleep(300);
  await page.evaluate((id) => document.querySelector(`.sp-timer[data-id="${id}"] .sp-round.primary`).click(), id0);
  await sleep(400);
  t0 = (await store('timers')).find((x) => x.id === id0);
  ok(t0.running && t0.remaining > 5 * 60e3 && !!(await alarm('timer:' + id0)), '+1 min, then resume sets the alarm again');
  for (const x of await store('timers')) await page.evaluate((id) => document.querySelector(`.sp-timer[data-id="${id}"] .sp-round:not(.primary)`).click(), x.id);
  await sleep(400);
  ok((await store('timers')).length === 0 && !(await alarm('timer:' + id0)), 'delete removes timers and alarms');
  // stopwatch
  await page.evaluate(() => [...document.querySelectorAll('.sp-seg .ou-seg-btn')][1].click());
  await sleep(300);
  await click('.sp-sw-btn.primary');
  await sleep(1300);
  await click('.sp-sw-btn.tonal'); // lap
  let st = await store('stopwatch');
  ok(st.running && st.laps.length === 1 && st.laps[0] >= 1000, 'stopwatch runs and takes a lap');
  await click('.sp-sw-btn.primary'); // stop
  st = await store('stopwatch');
  ok(!st.running && st.elapsed >= 1000 && /^00:0[1-9]\.\d\d$/.test(await txt('.sp-sw-digits')), 'stop keeps the time: ' + await txt('.sp-sw-digits'));
  await shot(P + 'sidepanel-05-stopwatch');
  await click('.sp-sw-btn.tonal'); // reset
  ok((await store('stopwatch')).elapsed === 0, 'reset');
  await page.evaluate(() => [...document.querySelectorAll('.sp-seg .ou-seg-btn')][0].click());

  // ════════════════ Calculator
  await go('calc');
  for (const k of ['1', '2', '+', '7', '*', '2']) await page.click(`.sp-key[data-k="${k}"]`);
  await sleep(200);
  ok(await txt('.sp-calc-expr') === '12+7×2' && await txt('.sp-calc-preview') === '26', 'keys and the live result: ' + await txt('.sp-calc-expr') + ' → ' + await txt('.sp-calc-preview'));
  await page.click('.sp-key[data-k="="]');
  await sleep(200);
  ok(await txt('.sp-calc-expr') === '26', '= gives 26');
  ok((await store('calc')).history[0].expr === '12+7*2' && (await store('calc')).history[0].result === 26, 'kept in the Calculator app’s history');
  await shot(P + 'sidepanel-06-calculator');
  await page.keyboard.type('9-4');
  await page.keyboard.press('Enter');
  await sleep(200);
  ok(await txt('.sp-calc-expr') === '5', 'typing on the keyboard works (9−4 = 5)');
  await page.evaluate(() => document.querySelector('.sp-calc-tools .sp-act').click());
  await sleep(300);
  ok((await page.$$('.sp-calc-hrow')).length === 3, 'history shows all three');

  // ════════════════ Music
  await go('music');
  ok(await txt('.sp-np-t') === await T('sp.music.nothing'), 'nothing playing yet');
  ok((await page.$$('.sp-snd')).length === 7, 'seven ambient sounds');
  await click('.sp-snd[data-sound="rain"]');
  ok(await page.$eval('.sp-snd[data-sound="rain"]', (b) => b.classList.contains('on')), 'rain plays from the panel');
  await shot(P + 'sidepanel-07-music');
  await click('.sp-snd[data-sound="rain"]');
  ok(!(await page.$('.sp-snd.on')), 'and pauses');
  await setStorage({ music: { queue: ['t1'], index: 0, now: { id: 't1', title: 'Night Drive', artist: 'The Bloomers', art: null, color: '#fc5c65' }, playing: false } });
  await sleep(700);
  ok(await txt('.sp-np-t') === 'Night Drive' && await txt('.sp-np-s') === 'The Bloomers' && (await page.$$('.sp-np-btn')).length === 3, 'Samsung Music’s song with previous / play / next');
  await shot(P + 'sidepanel-08-now-playing');
  await sw.evaluate(() => chrome.storage.local.remove('music'));

  // every tab fits the narrow panel
  for (const id of ['notes', 'reminder', 'clock', 'calc', 'music']) {
    await go(id);
    const over = await page.evaluate(() => document.querySelector('.sp-main').scrollWidth - document.querySelector('.sp-main').clientWidth);
    ok(over <= 0, `${id}: nothing wider than the panel`);
  }
  ok(!logs.some((l) => l.includes('[pageerror]')), 'no page errors');
};
