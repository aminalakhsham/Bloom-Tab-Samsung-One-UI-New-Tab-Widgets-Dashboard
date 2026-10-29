// triple
// Lock screen (js/shell/lock.js) beyond what shell.cjs covers: the default chips for a brand-new profile, every app's
// Lock screen widget rendering in the chip row (health, wallet, contacts, games, journal, wellbeing, routines) with
// render({ locked, private }), reordering them in Settings › Lock screen (keyboard and drag) and the order on the
// Lock screen, notifications with their text when no PIN guards the screen, the onUnlock hook, a tab you come back to
// after a while locking again, Screen lock type None ↔ Swipe, and a crowded Lock screen (short window, the evening
// brief card, notifications and the Now Bar) that never runs under the bottom row.
// usage: .dev/run.sh .dev/lock.cjs   (THEME=dark, UI=ar)
module.exports = async (ctx) => {
  const { page, sw, boot, ok, sleep, shot, P, mod, exists, visible, count, text, texts, logs, ui } = ctx;
  const AR = ui === 'ar';
  const L = (en, ar) => (AR ? ar : en);
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const setSet = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.setSetting(k, v)), k, v);
  const pset = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.store.set(k, v)), k, v);
  const isLocked = () => mod('./js/shell/lock.js', 'isLocked');
  const lockNow = async () => { await mod('./js/shell/lock.js', 'lockNow'); await sleep(900); };
  const unlock = async () => { await mod('./js/shell/lock.js', 'unlock'); await sleep(500); };
  const noErrors = (from, what) => ok(!logs.slice(from).some((l) => l.includes('[pageerror]')), `${what}: no page errors`);
  const top = '.app-win .app-stack > .app-page:last-child';
  const row = async (title) => {
    const found = await page.evaluate((sel, t) => {
      const r = [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t);
      r?.click();
      return !!r;
    }, top, title);
    if (!found) ok(false, `row "${title}" exists`);
    await sleep(450);
    return found;
  };
  const rowSub = (title) => page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t)?.querySelector('.ou-row-sub')?.textContent, top, title);
  const pick = async (n) => {
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 3000 }).catch(() => {});
    await page.evaluate((n) => document.querySelectorAll('.ou-dialog .ou-radio-row')[n - 1]?.click(), n);
    await page.click('.ou-dialog .ou-dialog-btn.primary');
    await sleep(500);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const now = Date.now();
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const early = (k) => +t0 + Math.floor((now - t0) * k);

  // ════════════════════════════════════════ a brand-new profile gets a useful set of chips
  let mark = logs.length;
  await boot();
  const fresh = (await ctx.store('settings')).lockWidgets;
  ok(JSON.stringify(fresh) === JSON.stringify(['weather', 'battery', 'event', 'alarm', 'health-rings', 'wellbeing']), `new profile: weather, battery, next event, next alarm, Daily activity, Screen time (${fresh})`);
  await boot({ data: { home: [[]], dock: [] } });
  ok(!('lockWidgets' in ((await ctx.store('settings')) || {})), 'an existing profile (a Home screen) keeps its own');
  noErrors(mark, 'defaults');

  // ════════════════════════════════════════ every app's chip renders in the row
  mark = logs.length;
  const ALL = ['weather', 'battery', 'event', 'alarm', 'health-rings', 'health-dose', 'wallet-bill', 'contacts-birthday', 'games', 'journal', 'wellbeing', 'mode'];
  const data = {
    home: [[]], dock: [],
    events: [{ id: 'e1', title: L('Dentist appointment', 'موعد طبيب الأسنان'), start: now + 2 * 3600e3, end: now + 3 * 3600e3, allDay: false, color: '#3e91ff' }],
    alarms: [{ id: 'a1', time: '07:30', days: [0, 1, 2, 3, 4, 5, 6], label: 'Work', enabled: true }],
    health: { profile: {}, units: { weight: 'kg', height: 'cm', water: 'ml' }, meds: [{ id: 'm1', name: L('Vitamin D', 'فيتامين د'), type: 'tablet', shape: 'round', c1: '#ffd60a', bg: '#fff09a', sched: { kind: 'daily', times: [{ t: '23:59', n: 1 }] }, start: dk(-5) }], medLog: [], water: [], sleep: [], mind: [], body: [], cycle: { days: {} }, mindful: [] },
    healthAct: { v: 1, days: { [dk(0)]: { breakH: [8, 9], activeH: Array(24).fill(0) } } },
    wallet: { v: 1, passes: [], spend: [], budgets: {}, prefs: { cur: 'USD', alertTime: '09:00' }, subs: [{ id: 's-sp', name: 'Spotify', amount: 10.99, cur: 'USD', cycle: 'm', start: dk(2), cat: 'music', alert: 1, state: 'active', at: now }] },
    contacts: { v: 1, items: [{ id: 'c1', first: L('Omar', 'عمر'), last: L('Haddad', 'حداد'), bday: `1990-${dk(3).slice(5)}` }], groups: [], favs: [], me: '', prefs: { sort: 'first', order: 'first', alert: 0, alertTime: '09:00' } },
    games: { stats: {}, daily: { sudoku: { [dk(0)]: { won: true, ms: 300000 }, [dk(-1)]: { won: true, ms: 280000 } } }, saves: {}, ach: {} },
    journal: { journals: [{ id: 'journal', name: '', color: '#7b61ff' }], entries: [{ id: 'j1', created: early(0.5), at: early(0.5), text: 'Today' }, { id: 'j2', created: now - 864e5, at: now - 864e5, text: 'Yesterday' }], prefs: {} },
    notifications: [{ id: 'x1', app: 'notes', title: L('Note synced', 'تمت مزامنة الملاحظة'), body: L('Grocery list', 'قائمة التسوق'), icon: 'bell', time: now - 60e3, read: false }],
  };
  await boot({ data, settings: { lockWidgets: ALL } });
  // a mode that is on, for the Modes and Routines chip
  await page.evaluate(() => import('./js/apps/routines.js').then((m) => import('./js/core/store.js').then((s) => s.store.set('routinesRun', { ...m.rrun(), mode: { id: m.rdata().modes[0].id, since: Date.now(), until: null, by: 'manual', undo: [] } }))));
  await sleep(300);
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => {
    window.__args = {};
    for (const w of m.getLockWidgets()) {
      const r = w.render;
      w.render = (o) => ((window.__args[w.id] = o), r(o));
    }
  }));
  await lockNow();
  const ids = await page.$$eval('#lock .lk-widgets .lk-w', (l) => l.map((x) => x.dataset.lw));
  const want = ['weather', 'battery', 'event', 'alarm', 'health-rings', 'health-dose', 'wallet-bill', 'contacts-birthday', 'games', 'journal', 'wellbeing', 'mode'].filter((x) => x !== 'weather' && x !== 'battery');
  ok(want.every((x) => ids.includes(x)), `every app's chip is on the Lock screen (${ids})`);
  ok(JSON.stringify(ids) === JSON.stringify(ALL.filter((x) => ids.includes(x))), 'in the order of lockWidgets');
  const args = await page.evaluate(() => window.__args);
  ok(Object.values(args).length >= 8 && Object.values(args).every((a) => a.locked === true && a.private === false), 'every registered chip got render({ locked: true, private: false })');
  const geo = await page.$$eval('#lock .lk-widgets .lk-w', (l) => l.map((x) => { const r = x.getBoundingClientRect(); return { h: Math.round(r.height), l: r.left, r: r.right, w: x.scrollWidth - x.clientWidth }; }));
  ok(geo.every((g) => g.h === 38 && g.l >= 0 && g.r <= page.viewport().width), `every chip is one 38 px pill inside the screen (${geo.map((g) => g.h).join(',')})`);
  ok(await page.$$eval('#lock .lk-widgets .lk-w', (l) => l.every((x) => x.querySelector('svg') && x.textContent.trim().length > 0)), 'each chip has an icon and a value');
  const chipText = await text('#lock .lk-widgets');
  ok(!chipText.includes('Spotify') && !chipText.includes('10.99') && !chipText.includes(L('Omar', 'عمر')) && !chipText.includes(L('Vitamin D', 'فيتامين د')), 'no bill, person or medicine named while locked');
  const rows = await page.evaluate(() => { const w = document.querySelector('#lock .lk-widgets').getBoundingClientRect(), m = document.querySelector('#lock .lk-mid').getBoundingClientRect(); return { w: w.bottom, m: m.top }; });
  ok(rows.w <= rows.m + 1, 'the chip rows stay above the notifications');
  ok((await text('#lock .lk-notif .qp-notif-title')) === L('Note synced', 'تمت مزامنة الملاحظة') && (await text('#lock .lk-notif .qp-notif-body')) === L('Grocery list', 'قائمة التسوق'), 'no PIN: notifications show their text');
  await shot(P + 'lock-01-all-chips');
  // onUnlock without a PIN
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => { window.__unl = null; m.onUnlock((i) => (window.__unl = i)); }));
  await page.keyboard.press('Enter');
  await sleep(700);
  ok(!(await isLocked()) && (await page.evaluate(() => window.__unl))?.pin === false, 'onUnlock fires with { pin: false }');
  noErrors(mark, 'all chips');

  // ════════════════════════════════════════ Settings › Lock screen: widgets order, Screen lock type
  mark = logs.length;
  await setSet('lockWidgets', ['event', 'alarm', 'games', 'wellbeing']);
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(600);
  const order0 = await rowSub(await S('set.lk.order'));
  ok(order0 && order0.split(' · ').length === 4, `"Reorder widgets" lists the 4 chips (${order0})`);
  await shot(P + 'lock-02-settings');
  await row(await S('set.lk.order'));
  ok((await count(top + ' .set-lw-item')) === 4, 'the order page: one row per chip with a handle');
  await shot(P + 'lock-03-order');
  await page.focus(top + ' .set-lw-item:nth-child(2) .set-lw-grip');
  await page.keyboard.press('ArrowUp');
  await sleep(400);
  ok(JSON.stringify((await ctx.store('settings')).lockWidgets) === '["alarm","event","games","wellbeing"]', 'ArrowUp on a handle moves the chip up');
  ok((await page.evaluate(() => document.activeElement?.closest('.set-lw-item')?.dataset.id)) === 'alarm', 'the focus stays on the moved chip');
  const r1 = await page.$eval(top + ' .set-lw-item:nth-child(1) .set-lw-grip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: e.closest('.ou-row').offsetHeight }; });
  await page.mouse.move(r1.x, r1.y);
  await page.mouse.down();
  await page.mouse.move(r1.x, r1.y + r1.h * 2.1, { steps: 8 });
  await page.mouse.up();
  await sleep(500);
  ok(JSON.stringify((await ctx.store('settings')).lockWidgets) === '["event","games","alarm","wellbeing"]', 'dragging the first handle two rows down moves it there');
  await page.click(top + ' .app-back');
  await sleep(500);
  // Screen lock type None ↔ Swipe
  const typeT = await S('set.lk.type');
  ok((await rowSub(typeT)) === (await S('set.lk.none')), 'Screen lock type: None (never)');
  await row(typeT);
  await pick(2);
  ok((await rowSub(typeT)) === (await S('set.lk.swipe')) && (await ctx.store('settings')).lockMode === 'always', 'Swipe: the Lock screen shows on every new tab');
  await row(typeT);
  await pick(1);
  ok((await rowSub(typeT)) === (await S('set.lk.none')) && (await ctx.store('settings')).lockMode === 'never', 'None: no Lock screen');
  ok((await count(top + ' .ou-row-title')) > 15 && (await texts(top + ' .ou-subheader')).includes(await S('set.lk.notifs')), 'Notifications (Hide content) and Now Brief sections');
  await ctx.closeApp();
  await lockNow();
  const ids2 = await page.$$eval('#lock .lk-widgets .lk-w', (l) => l.map((x) => x.dataset.lw));
  ok(JSON.stringify(ids2) === '["event","games","alarm","wellbeing"]', `the Lock screen follows the new order (${ids2})`);
  await unlock();
  noErrors(mark, 'settings');

  // ════════════════════════════════════════ a tab you come back to after a while locks again
  mark = logs.length;
  await setSet('lockMode', 'idle');
  await setSet('lockIdleMin', 10);
  await sleep(300);
  const other = await ctx.browser.newPage();
  await other.goto('about:blank');
  await sleep(500);
  await sw.evaluate(() => chrome.storage.session.set({ lastActive: Date.now() - 11 * 60e3 }));
  await page.bringToFront();
  await sleep(900);
  ok(await isLocked(), 'after inactivity: back to the tab after 11 minutes away → locked');
  await page.keyboard.press('Enter');
  await sleep(600);
  await other.bringToFront();
  await sleep(400);
  await page.bringToFront();
  await sleep(700);
  ok(!(await isLocked()), 'away for a moment: still unlocked');
  await other.close();
  noErrors(mark, 'relock');

  // ════════════════════════════════════════ Settings › Lock screen previews the Lock screen's own wallpaper
  mark = logs.length;
  await setSet('lockWallpaper', { type: 'color', value: '#123456' });
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(700);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.app-win .set-lock-prev .set-wall-thumb')).backgroundColor === 'rgb(18, 52, 86)'), 'the Lock screen preview shows the Lock screen wallpaper, not the Home one');
  await ctx.closeApp();
  await setSet('lockWallpaper', null);
  noErrors(mark, 'lock preview');

  // ════════════════════════════════════════ the Now Bar: pills patched in place, clicks honour params and `open`
  mark = logs.length;
  await page.evaluate(() => Promise.all([import('./js/core/apps.js'), import('./js/core/activity.js')]).then(([A, act]) => {
    window.__nb = { title: '04:59', opened: [] };
    // a hidden test app: launch() records the params openApp() passed it
    A.registerApp({ id: 'nbtest', name: { en: 'NB test', ar: 'اختبار' }, hidden: true, icon: { bg: '#888', glyph: '' }, launch: ({ params }) => window.__nb.opened.push(params || null) });
    act.registerActivity('nbtest', () => ({
      icon: 'timer', color: '#ff8a3d', title: window.__nb.title, sub: 'NB', progress: 0.25, app: 'nbtest', params: { section: 'timer', id: 7 }, priority: 99,
      actions: [{ icon: 'note', label: 'Open note', open: { app: 'nbtest', params: { note: 'n1' } } }],
    }));
  }));
  await lockNow();
  await sleep(300);
  const pillSel = '#lock .lk-nowbar .nb-pill[data-act="nbtest"]';
  ok(await exists(pillSel), 'the Now Bar shows a registered activity');
  await page.evaluate((s) => (window.__nbEl = document.querySelector(s)), pillSel);
  await page.evaluate(() => (window.__nb.title = '04:58'));
  await sleep(1300);
  ok(await page.evaluate((s) => document.querySelector(s) === window.__nbEl, pillSel), 'after a second tick the pill is the same node (patched, not rebuilt)');
  ok((await text(pillSel + ' .nb-text b')) === '04:58' && (await count(pillSel + ' .nb-ring')) === 1 && (await count(pillSel + ' .nb-act')) === 1, 'its title, progress ring and action button are updated in place');
  // a press held across a refresh still clicks the pill (the old rebuild lost it)
  const pc = await page.$eval(pillSel + ' .nb-text', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(pc.x, pc.y);
  await page.mouse.down();
  await sleep(1150);
  await page.mouse.up();
  await sleep(900);
  let opened = await page.evaluate(() => window.__nb.opened);
  ok(!(await isLocked()) && JSON.stringify(opened) === '[{"section":"timer","id":7}]', `a pill click across a refresh unlocks and opens its app with params (${JSON.stringify(opened)})`);
  await lockNow();
  await sleep(300);
  await page.click(pillSel + ' .nb-act');
  await sleep(900);
  opened = await page.evaluate(() => window.__nb.opened);
  ok(!(await isLocked()) && JSON.stringify(opened[1]) === '{"note":"n1"}', `the pill's action with open: { app, params } unlocks and opens that (${JSON.stringify(opened[1])})`);
  await page.evaluate(() => import('./js/core/activity.js').then((m) => m.registerActivity('nbtest', () => null)));
  await lockNow();
  await sleep(1200);
  ok(!(await exists(pillSel)), 'a finished activity leaves the Now Bar');
  await unlock();
  noErrors(mark, 'Now Bar');

  // ════════════════════════════════════════ a crowded Lock screen in a short window
  mark = logs.length;
  await page.setViewport({ width: 1280, height: 700 });
  await page.evaluate(() => localStorage.setItem('bt.test.brief', '1'));
  const d = new Date(Date.now() - 60e3);
  await setSet('windDownAt', `${pad(d.getHours())}:${pad(d.getMinutes())}`);
  await setSet('lockWidgets', ['event', 'alarm', 'games', 'wellbeing', 'health-rings', 'contacts-birthday']);
  await pset('notifications', [1, 2, 3].map((i) => ({ id: 'y' + i, app: 'notes', title: 'Note ' + i, body: 'Line', icon: 'bell', time: Date.now() - i * 1000, read: false })));
  await mod('./js/shell/quickpanel.js', 'startFocus', 25);
  await lockNow();
  await sleep(1200);
  ok(await exists('#lock .lkb.night'), 'the evening brief card is on the Lock screen');
  const fit = await page.evaluate(() => {
    const mid = document.querySelector('#lock .lk-mid'), bottom = document.querySelector('#lock .lk-bottom');
    const vis = [...mid.querySelectorAll('.lkb, .lk-notif')].filter((x) => x.offsetParent && x.getBoundingClientRect().height);
    const lowest = Math.max(...vis.map((x) => Math.min(x.getBoundingClientRect().bottom, (x.closest('.lk-notifs')?.getBoundingClientRect().bottom) ?? Infinity)), mid.getBoundingClientRect().top);
    return { lowest, bottom: bottom.getBoundingClientRect().top, compact: !!document.querySelector('.lk-brief.compact') };
  });
  ok(fit.lowest <= fit.bottom + 1, `nothing runs under the Now Bar and the bottom row (${Math.round(fit.lowest)} ≤ ${Math.round(fit.bottom)})`);
  await shot(P + 'lock-04-crowded');
  await unlock();
  await mod('./js/shell/quickpanel.js', 'stopFocus');
  await page.evaluate(() => localStorage.removeItem('bt.test.brief'));
  await page.setViewport({ width: 1440, height: 900 });
  noErrors(mark, 'crowded');
};
