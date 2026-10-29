// triple — Digital Wellbeing. Full run: .dev/run.sh --raw node .dev/wellbeing.cjs (copies the extension to a temp dir with "tabs" granted, since headless Chrome can't accept the optional permission prompt)
// End to end: first run (Get started, the "allow tabs" card), the dashboard (donut by site and by category, Screen time /
// Notifications received / Unlocks, most used sites with their timer, the week bars with the goal line), Screen time
// details, a site's page (category), site timers (every day and custom days), the goal, Focus modes (start, allowed
// sites, a custom mode, Now Bar), Bedtime mode (schedule, grayscale, Quick Panel tile), the Weekly report (page and
// Monday notification), widgets, the Lock screen chip, Finder, the service worker's counters and the pause page.
// With the tabs permission (the --raw run) it also pauses real tabs: a site timer with One more minute, Work time,
// Bedtime mode, and counts time on a site. Through runall (plain harness, no tabs) those tab checks are skipped.
// Websites are answered by request interception: no network.
const path = require('path'), fs = require('fs'), os = require('os');

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-wb-'));
  for (const f of fs.readdirSync(root)) if (!['.git', '.dev', 'dist', 'store', 'node_modules', 'scripts'].includes(f)) fs.cpSync(path.join(root, f), path.join(ext, f), { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  man.permissions = [...man.permissions, 'tabs'];
  man.optional_permissions = (man.optional_permissions || []).filter((p) => p !== 'tabs');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'harness.cjs'), __filename], { stdio: 'inherit', env: { ...process.env, EXT: ext } });
  fs.rmSync(ext, { recursive: true, force: true });
  process.exit(r.status);
}

module.exports = async ({ browser, page, id, sw, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, mod, store, setStorage, getStorage, sleep, shot, P, ui }) => {
  const OUT = process.env.OUT || path.join(__dirname, 'shots');
  const tabs = await sw.evaluate(() => chrome.permissions.contains({ permissions: ['tabs'] }));
  console.log(tabs ? '  (tabs permission granted: real tabs are checked too)' : '  (no tabs permission: run with --raw for the tab checks)');
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const tt = (k, v) => page.evaluate((k, v) => import('./js/core/i18n.js').then((m) => m.t(k, v)), k, v);
  const dur = (s, style) => mod('./js/wellbeing/common.js', 'dur', s, style);
  const L = '.app-stack > .app-page:last-child ';
  const hm = (hours) => { const d = new Date(Date.now() + hours * 3600e3); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const back = async () => { await click(L + '.app-back'); await sleep(450); };
  const wb = async () => (await store('wellbeing')) || {};
  const usageNow = async () => (await store('wellbeingUsage')) || {};

  // ---------------------------------------------------------------- seed: 14 days, today with hours
  const SITES = ['youtube.com', 'github.com', 'facebook.com', 'docs.google.com', 'en.wikipedia.org', 'reddit.com', 'example.com'];
  const nowH = new Date().getHours();
  const days = {};
  for (let i = -13; i <= 0; i++) {
    const s = {}, h = {};
    SITES.forEach((site, j) => {
      const sec = ((i + 20) * 7 + j * 13) % 9 * 300 + 600 + (j === 0 ? 1800 : 0);
      if ((i + j) % 5 === 4) return;
      const key = site === 'en.wikipedia.org' ? 'wikipedia.org' : site;
      s[key] = sec;
      const hr = i === 0 ? Math.max(0, nowH - (j % 3)) : 9 + j;
      (h[hr] ||= {})[key] = sec;
    });
    days[dk(i)] = { s, h, n: 10 + (i + 14), u: 5 + ((i + 14) % 4), f: 0, fh: '' };
  }
  const total0 = Object.values(days[dk(0)].s).reduce((a, b) => a + b, 0);
  const top0 = Object.entries(days[dk(0)].s).sort((a, b) => b[1] - a[1])[0][0];

  // ---------------------------------------------------------------- first run
  await boot();
  await openApp('wellbeing');
  ok(await exists('.wb-welcome .wb-start'), 'first run: Get started');
  ok((await count('.wb-point')) === 4, 'first run explains the four features');
  await shot(P + 'wb-01-welcome');
  await page.evaluate(() => document.querySelector('.wb-start').click());
  await sleep(1200);
  ok((await wb()).setup === true, 'Get started saves wellbeing.setup');
  ok(await exists('.wb-dashcard'), 'the dashboard opens right away');
  if (!tabs) {
    ok(await exists('.wb-perm'), 'without the tabs permission: the explanation card');
    await shot(P + 'wb-02-perm');
  } else ok(!(await exists('.wb-perm')), 'with the tabs permission: no explanation card');
  await closeApp();

  // ---------------------------------------------------------------- dashboard with data
  const timers = [{ id: 'tm-yt', kind: 'site', target: 'youtube.com', min: 1, days: null, on: true }];
  await boot({
    settings: { lockWidgets: ['wellbeing'] },
    data: {
      // a bedtime schedule well away from now, so "Turn on now" always means on
      wellbeing: { setup: true, goal: 180, timers, bedtime: { on: false, from: hm(6), to: hm(8), days: [0, 1, 2, 3, 4, 5, 6], gray: true, block: false, allowed: [], until: 0, skip: 0 } },
      wellbeingUsage: { days, g: {} },
      home: [[
        { id: 'w1', type: 'widget', widget: 'wellbeing', size: 's' },
        { id: 'w2', type: 'widget', widget: 'wellbeing', size: 'm' },
        { id: 'w3', type: 'widget', widget: 'wellbeing-top', size: 'm' },
        { id: 'w4', type: 'widget', widget: 'wellbeing-top', size: 'l' },
      ]],
    },
  });
  await sleep(600);
  ok((await count('.wg-wb')) === 2 && (await count('.wg-wbtop')) === 2, 'widgets: screen time donut and most used sites');
  ok((await text('.wg-wb-s .wb-donut-val')) === (await dur(total0, 'short')), 'small widget shows today’s total');
  ok((await count('.wg-wbtop-l .wg-wbtop-row')) === Math.min(7, Object.keys(days[dk(0)].s).length) && (await count('.wg-wbtop-m .wg-wbtop-row')) === 3, 'top sites widget: 3 rows (medium), up to 7 (large)');
  await shot(P + 'wb-03-widgets');

  await openApp('wellbeing');
  await sleep(500);
  ok((await text('.wb-dash-donut .wb-donut-val')) === (await dur(total0)), `donut centre: today’s total (${await text('.wb-dash-donut .wb-donut-val')})`);
  const nSites = Object.keys(days[dk(0)].s).length;
  ok((await count('.wb-dash-donut circle')) === 1 + Math.min(5, nSites), 'donut: the top four sites and Other');
  const stats = await texts('.wb-dashcard .wb-stat-val');
  ok(stats.length === 3 && stats[1] === String(days[dk(0)].n) && stats[2] === String(days[dk(0)].u), `Screen time / Notifications received / Unlocks (${stats.join(' | ')})`);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.wb-most .wb-site')].map((r) => r.dataset.site));
  ok(rows.length === Math.min(5, nSites) && rows[0] === top0, 'most used sites, most used first (' + rows.join(', ') + ')');
  ok(await exists('.wb-site[data-site="youtube.com"] .wb-tbtn.set'), 'a site with a timer shows it on its hourglass');
  const T = rows[1];
  ok((await count('.wb-week .wb-colm')) === 7 && (await exists('.wb-week .wb-goal-line')), 'this week: 7 bars and the goal line');
  ok(await exists('.wb-goal-row .wb-goal-bar'), 'screen time goal progress');
  await shot(P + 'wb-04-dashboard');
  await page.evaluate(() => { const s = document.querySelector('.app-stack > .app-page:last-child .app-scroll'); s.scrollTop = s.scrollHeight; });
  await sleep(300);
  await shot(P + 'wb-05-dashboard-bottom');
  await page.evaluate(() => { document.querySelector('.app-stack > .app-page:last-child .app-scroll').scrollTop = 0; });
  // the donut by category
  await page.evaluate(() => document.querySelectorAll('.wb-dashcard .ou-seg-btn')[1].click());
  await sleep(300);
  const leg = await texts('.wb-dashcard .wb-leg');
  ok(leg.includes(await tt('wellbeing.cat.entertainment')) && leg.includes(await tt('wellbeing.cat.social')), 'donut by category (' + leg.join(', ') + ')');
  // wide window
  await page.evaluate(() => document.querySelector('.app-win').classList.add('max'));
  await sleep(500);
  const twoCols = await page.evaluate(() => getComputedStyle(document.querySelector('.wb-dash')).display === 'grid');
  ok(twoCols, 'maximized: two columns');
  await shot(P + 'wb-06-dashboard-wide');
  await page.evaluate(() => document.querySelector('.app-win').classList.remove('max'));
  await sleep(400);

  // ---------------------------------------------------------------- details
  await page.evaluate(() => document.querySelector('.wb-dash-donut').click());
  await sleep(600);
  ok((await count(L + '.wb-detail .wb-colm')) === 24, 'details: 24 hours');
  ok((await text(L + '.wb-detail .wb-big')) === (await dur(total0)), 'details: today’s total');
  await shot(P + 'wb-07-detail-day');
  await page.evaluate((L) => document.querySelectorAll(L + '.app-body > .ou-seg .ou-seg-btn')[1].click(), L);
  await sleep(400);
  ok((await count(L + '.wb-detail .wb-colm')) === 7, 'details: week');
  await page.evaluate((L) => document.querySelector(L + '.wb-nav .wb-nav-btn').click(), L);
  await sleep(400);
  ok((await text(L + '.wb-nav-label')) !== (await tt('wellbeing.thisWeek')), 'previous week');
  await page.evaluate((L) => document.querySelectorAll(L + '.wb-most .ou-seg-btn')[1].click(), L);
  await sleep(300);
  ok((await count(L + '.wb-catrow')) >= 3, 'details: by category');
  await shot(P + 'wb-08-detail-week');
  await back();

  // ---------------------------------------------------------------- a site's page and its category
  await page.evaluate(() => (document.querySelector('.wb-site[data-site="example.com"]') || document.querySelectorAll('.wb-most .wb-site')[1]).click());
  await sleep(600);
  const siteName = await text(L + '.wb-site-hero h2');
  ok(!!siteName, 'site page opens (' + siteName + ')');
  await page.evaluate((L) => document.querySelectorAll(L + '.ou-row')[1].click(), L);
  await sleep(400);
  ok(await exists('.ou-dialog .ou-radio-row'), 'category list');
  await shot(P + 'wb-09-category');
  await page.evaluate(() => { const r = [...document.querySelectorAll('.ou-dialog .ou-radio-row input')][5]; r.click(); });
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(600);
  ok((await wb()).cats?.[siteName] === 'education', 'category saved in wellbeing.cats');
  ok((await text(L + '.wb-cat-chip')) === (await tt('wellbeing.cat.education')), 'site page shows the new category');
  await shot(P + 'wb-10-site');
  await back();

  // ---------------------------------------------------------------- site timer (every day, then custom days)
  await page.evaluate((T) => document.querySelector(`.wb-site[data-site="${T}"] .wb-tbtn`).click(), T);
  await sleep(500);
  ok(await exists('.ou-dialog.wb-timer-dlg .wb-wheel'), 'Set timer dialog with wheels');
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-wheel')[0].focus());
  await page.keyboard.type('2');
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-wheel')[1].focus());
  await page.keyboard.type('15');
  await sleep(200);
  await shot(P + 'wb-11-timer');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(600);
  let gh = (await wb()).timers?.find((x) => x.target === T);
  ok(gh?.min === 135 && gh.kind === 'site' && !gh.days, `timer saved: ${T} 2 h 15 min every day`);
  await page.evaluate((T) => document.querySelector(`.wb-site[data-site="${T}"] .wb-tbtn`).click(), T);
  await sleep(500);
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-timer-seg .ou-seg-btn')[1].click());
  await sleep(200);
  ok((await count('.ou-dialog .wb-dayrow')) === 7, 'Custom: every day of the week');
  await page.evaluate(() => { const s = document.querySelector('.ou-dialog .wb-dayrow[data-wd="6"] select'); s.value = '4'; s.dispatchEvent(new Event('change')); });
  await shot(P + 'wb-12-timer-custom');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(600);
  gh = (await wb()).timers?.find((x) => x.target === T);
  ok(gh?.days?.length === 7 && gh.days[6] === 255 && gh.days[1] === 135, 'custom days saved (Saturday 4 h 15 min)');

  // ---------------------------------------------------------------- goal
  await click('.wb-goal-row');
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-wheel')[0].focus());
  await page.keyboard.type('5');
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-wheel')[1].focus());
  await page.keyboard.type('0');
  await shot(P + 'wb-13-goal');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(500);
  ok((await wb()).goal === 300, 'goal saved (5 hours)');

  // ---------------------------------------------------------------- site timers page
  await clickText(L + '.ou-row', await tt('wellbeing.timers'));
  await sleep(600);
  ok((await count(L + '.wb-trow')) >= nSites, 'Site timers lists the sites');
  await page.evaluate((L) => document.querySelectorAll(L + '.app-body > .ou-seg .ou-seg-btn')[1].click(), L);
  await sleep(300);
  ok((await count(L + '.wb-trow')) === 12, 'and the 12 categories');
  await page.evaluate((L) => document.querySelector(L + '.wb-trow[data-cat="social"]').click(), L);
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .wb-wheel')[0].focus());
  await page.keyboard.type('1');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(500);
  ok((await wb()).timers?.some((x) => x.kind === 'cat' && x.target === 'social' && x.min >= 60), 'a category timer (Social)');
  await shot(P + 'wb-14-timers');
  await back();

  // ---------------------------------------------------------------- Focus modes
  await clickText(L + '.ou-row', await tt('wellbeing.focusModes'));
  await sleep(600);
  ok((await count(L + '.wb-mode')) === 3, 'Work time, Me time and Add');
  await shot(P + 'wb-15-focus');
  await page.evaluate((L) => document.querySelector(L + '.wb-mode[data-mode="work"]').click(), L);
  await sleep(600);
  await shot(P + 'wb-16-mode');
  await click(L + '.wb-mode-btn');
  await sleep(600);
  ok((await wb()).focus?.id === 'work', 'Start: Work time is on');
  ok(await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().some((a) => a.id === 'wellbeing'))), 'Now Bar shows the Focus mode');
  ok(await exists(L + '.wb-mode-hero.on'), 'the mode page turns to the mode colour');
  await shot(P + 'wb-17-mode-on');
  await back();
  await back();
  ok(await exists('.wb-banner.mode'), 'dashboard: “Work time is on” banner');
  await shot(P + 'wb-18-banner');
  // a custom mode
  await clickText(L + '.ou-row', await tt('wellbeing.focusModes'));
  await sleep(500);
  await page.evaluate((L) => document.querySelector(L + '.wb-mode.add').click(), L);
  await sleep(300);
  await page.type('.ou-dialog input', 'Study');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(500);
  ok((await wb()).modes?.some((m) => m.name === 'Study'), 'custom mode added');
  await back();

  // ---------------------------------------------------------------- Bedtime mode
  await clickText(L + '.ou-row', await tt('wellbeing.bedtime'));
  await sleep(600);
  ok(await exists(L + '.wb-bed-hero'), 'Bedtime mode page');
  await page.evaluate((L) => document.querySelector(L + '.wb-bed-hero + .ou-list .ou-row').click(), L);
  await sleep(500);
  ok((await wb()).bedtime?.on === true, 'Turn on as scheduled');
  await shot(P + 'wb-19-bedtime');
  await click(L + '.wb-bed-btn');
  await sleep(700);
  ok(await page.evaluate(() => document.documentElement.classList.contains('wb-gray')), 'Turn on now: the new tab turns gray');
  await shot(P + 'wb-20-bedtime-on');
  const tile = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.getTiles().find((x) => x.id === 'bedtime')?.on()));
  ok(tile === true, 'Quick Panel tile “Bedtime mode” is on');
  await back();
  await closeApp();
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(600);
  await shot(P + 'wb-21-quickpanel');
  const bedLabel = await tt('wellbeing.bedtime');
  await page.evaluate((l) => [...document.querySelectorAll('.qp-tile')].find((x) => x.title === l)?.click(), bedLabel);
  await sleep(600);
  ok(!(await page.evaluate(() => document.documentElement.classList.contains('wb-gray'))), 'the tile turns Bedtime mode off');
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel');
  await sleep(400);

  // ---------------------------------------------------------------- Modes and Routines actions (page, then the worker)
  const bedOn = () => mod('./js/apps/wellbeing.js', 'bedtimeOn');
  const rtIds = await page.evaluate(() => import('./js/routines/actions.js').then((m) => ['wellbeing.bedtime', 'wellbeing.focus', 'wellbeing.focusOff'].filter((id) => m.ACTIONS[id]?.sw)));
  ok(rtIds.length === 3, 'Routines: Bedtime mode, Start Focus mode and End Focus mode actions');
  const modeOpts = await page.evaluate(() => import('./js/routines/actions.js').then((m) => m.ACTIONS['wellbeing.focus'].params[0].opts.map((o) => o[0])));
  ok(modeOpts.join() === (await wb()).modes.map((m) => m.id).join() && modeOpts.length === 3, 'the Focus mode action lists your modes, the custom one too');
  const focus0 = (await wb()).focus?.id;
  const rtWb = { id: 'rt-wb', name: 'Wind down', icon: 'bedtime', color: '#6f5cf1', on: true, match: 'any', undo: true, conds: [{ type: 'manual' }],
    actions: [{ id: 'w1', type: 'wellbeing.bedtime', p: { value: 'on' } }, { id: 'w2', type: 'wellbeing.focus', p: { mode: 'me' } }] };
  await setStorage({ routines: { list: [rtWb] }, routinesRun: {} });
  await sleep(400);
  await mod('./js/routines/page.js', 'toggleRoutine', 'rt-wb');
  await sleep(1200);
  ok(await bedOn() && (await wb()).focus?.id === 'me', 'a routine turns Bedtime mode on and starts Me time');
  ok(await page.evaluate(() => document.documentElement.classList.contains('wb-gray')), 'the new tab turns gray');
  await mod('./js/routines/page.js', 'toggleRoutine', 'rt-wb');
  await sleep(1200);
  ok(!(await bedOn()) && (await wb()).focus?.id === focus0, 'stopping it puts both back (undo)');
  const rtSw = { id: 'rt-wbsw', name: 'Back to work', icon: 'wbWork', color: '#3e8bff', on: true, match: 'any', undo: false, conds: [{ type: 'idle', away: 5 }],
    actions: [{ id: 'w3', type: 'wellbeing.focusOff', p: {} }, { id: 'w4', type: 'wellbeing.bedtime', p: { value: 'toggle' } }] };
  await setStorage({ routines: { list: [rtSw] }, routinesRun: {} });
  await sleep(400);
  const firedWb = await sw.evaluate(() => btRoutines.fire({ type: 'idle', away: 30 }));
  await sleep(800);
  ok(firedWb.includes('rt-wbsw') && !(await wb()).focus && await bedOn() && !((await store('routinesRun'))?.pending || []).length, 'the service worker runs them itself (no “Tap to run”)');
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs((w) => ({ bedtime: { ...w.bedtime, until: 0 } }))));
  await setStorage({ routines: { list: [] }, routinesRun: {} });
  await sleep(500);

  // ---------------------------------------------------------------- Weekly report
  await openApp('wellbeing', { section: 'report' });
  await sleep(700);
  ok(!!(await text(L + '.wb-report-sum')), 'Weekly report: ' + (await text(L + '.wb-report-sum')));
  ok((await count(L + '.wb-report .wb-colm')) === 7, 'report bars');
  await shot(P + 'wb-22-report');
  await closeApp();

  // ---------------------------------------------------------------- Finder, Lock screen
  const cmd = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('screen time', () => {}).map((r) => r.title)));
  ok(cmd.length === 1 && cmd[0].includes(await dur(total0)), 'Finder “screen time”: ' + cmd[0]);
  const found = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('wellbeing').search('git').map((r) => r.title)));
  ok(found.includes('github.com'), 'Finder finds a site’s usage');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(1200);
  const lk = await texts('.lk-widgets .lk-w');
  ok(lk.some((x) => x.includes(String(Math.floor(total0 / 3600)))), 'Lock screen chip: screen time today (' + lk.join(' | ') + ')');
  await shot(P + 'wb-23-lock');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(800);

  // ---------------------------------------------------------------- service worker: counters, report, alarms
  const before = (await usageNow()).days?.[dk(0)] || {};
  const notifs = (await store('notifications')) || [];
  await setStorage({ notifications: [{ id: 'test-n', app: 'system', title: 'x', body: '', time: Date.now(), read: false }, ...notifs] });
  await sleep(800);
  ok((await usageNow()).days[dk(0)].n === (before.n || 0) + 1, 'Notifications received counts a new notification');
  const u0 = (await usageNow()).days[dk(0)].u || 0;
  await sw.evaluate(() => chrome.storage.local.get('wellbeingUsage').then(({ wellbeingUsage: u }) => chrome.storage.local.set({ wellbeingUsage: { ...u, g: { ...u.g, unlockAt: 0 } } })));
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wb:unlock' }));
  await sleep(300);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wb:unlock' }));
  await sleep(500);
  ok((await usageNow()).days[dk(0)].u === u0 + 1, 'Unlocks: one unlock (two within a minute count once)');
  await sw.evaluate(() => chrome.notifications.getAll().then((n) => Promise.all(Object.keys(n).map((k) => chrome.notifications.clear(k)))));
  await sw.evaluate(() => globalThis.__wellbeing.weekly());
  await sleep(800);
  ok(!!(await sw.evaluate(() => chrome.notifications.getAll()))['wb:week'], 'Monday notification: wb:week');
  ok(((await store('notifications')) || []).some((n) => n.app === 'wellbeing'), 'and it is in the notification list');
  const alarms = await sw.evaluate(() => chrome.alarms.getAll().then((a) => a.map((x) => [x.name, x.scheduledTime, x.periodInMinutes])));
  const wk = alarms.find((a) => a[0] === 'wb:week');
  ok(wk && new Date(wk[1]).getDay() === 1 && new Date(wk[1]).getHours() === 9, 'wb:week set for Monday 9:00');
  ok(alarms.some((a) => a[0] === 'wb:flush' && a[2] === 1), 'wb:flush every minute');

  // ---------------------------------------------------------------- the pause page (opened directly)
  const fake = async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (r) => (/^https?:/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${new URL(r.url()).hostname}</title><body style="font:20px system-ui;margin:40px">${new URL(r.url()).hostname}</body>` }) : r.continue()));
  };
  const ext = (q) => `chrome-extension://${id}/wellbeing-blocked.html?${q}`;
  let bp = await browser.newPage();
  await fake(bp);
  await bp.goto(ext('r=timer&s=youtube.com&k=tm-yt&u=' + encodeURIComponent('https://www.youtube.com/watch')));
  await sleep(900);
  ok((await bp.$eval('.wbb-title', (n) => n.textContent)) === (await tt('wellbeing.bk.timerTitle')) && (await bp.$eval('.wbb-text', (n) => n.textContent)).includes('youtube.com'), 'pause page: Site paused');
  ok((await bp.$$eval('.wbb-btn', (b) => b.map((x) => x.dataset.x))).join() === 'ok,omm,today', 'OK, One more minute, Ignore for today');
  await bp.screenshot({ path: path.join(OUT, P + 'wb-24-paused.png') });
  await bp.click('.wbb-btn[data-x="omm"]');
  await sleep(1500);
  const g1 = (await usageNow()).g || {};
  ok(g1.allow?.['timer:tm-yt:youtube.com'] > Date.now() && g1.omm?.['youtube.com'], 'One more minute: a pass for a minute, used up for today');
  ok(/youtube\.com/.test(bp.url()), 'and back to the site');
  await bp.close();
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs({ focus: { id: 'work', startedAt: Date.now() - 600e3, endsAt: Date.now() + 1500e3 } })));
  bp = await browser.newPage();
  await fake(bp);
  await bp.goto(ext('r=focus&s=facebook.com&k=work&u=' + encodeURIComponent('https://www.facebook.com/')));
  await sleep(1300);
  ok((await bp.$eval('.wbb-title', (n) => n.textContent)) === (await tt('wellbeing.bk.focusTitle')), 'pause page: Focus mode is on');
  ok(!!(await bp.$eval('.wbb-meta', (n) => n.textContent)), 'with the time left');
  await bp.screenshot({ path: path.join(OUT, P + 'wb-25-focus.png') });
  await bp.close();
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs({ focus: null })));
  await sleep(300);
  bp = await browser.newPage();
  await fake(bp);
  await bp.goto(ext('r=bedtime&s=reddit.com&u=' + encodeURIComponent('https://www.reddit.com/')));
  await sleep(900);
  ok((await bp.$eval('.wbb-title', (n) => n.textContent)) === (await tt('wellbeing.bk.bedTitle')) && (await bp.$$('.wbb-btn')).length === 3, 'pause page: Bedtime mode is on');
  await bp.screenshot({ path: path.join(OUT, P + 'wb-26-bedtime.png') });
  await sleep(2500);
  ok(/reddit\.com/.test(bp.url()), 'it goes back to the site when bedtime isn’t on');
  await bp.close();
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs({ focus: null })));
  await sleep(300);

  if (!tabs) return;

  // ---------------------------------------------------------------- real tabs (tabs permission)
  const visit = async (u, wait = 2500) => {
    const p = await browser.newPage();
    await fake(p);
    await p.goto(u).catch(() => {});
    await sleep(wait);
    return p;
  };
  await sw.evaluate(() => chrome.storage.local.get('wellbeingUsage').then(({ wellbeingUsage: u }) => chrome.storage.local.set({ wellbeingUsage: { ...u, g: {} } })));
  await sleep(300);
  let yt = await visit('https://m.youtube.com/watch');
  ok(/wellbeing-blocked\.html\?r=timer&s=youtube\.com&k=tm-yt/.test(yt.url()), 'over its timer, youtube.com (m.youtube.com) is paused');
  await yt.waitForSelector('.wbb-btn[data-x="omm"]', { timeout: 4000 }).catch(() => {});
  await yt.click('.wbb-btn[data-x="omm"]').catch(() => {});
  await sleep(2000);
  ok(/^https:\/\/m\.youtube\.com/.test(yt.url()), 'One more minute opens it again');
  await yt.close();
  const fb = await visit('https://www.facebook.com/');
  ok(/r=timer&s=facebook\.com/.test(fb.url()), 'the Social category timer pauses facebook.com');
  await fb.close();
  // Work time: distracting sites only
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs({ timers: [], focus: { id: 'work', startedAt: Date.now(), endsAt: 0 } })));
  await sleep(800);
  const rd = await visit('https://www.reddit.com/');
  ok(/r=focus&s=reddit\.com&k=work/.test(rd.url()), 'Work time pauses reddit.com');
  const gh2 = await visit('https://github.com/');
  ok(/^https:\/\/github\.com/.test(gh2.url()), 'and leaves github.com open');
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs({ focus: null })));
  await sleep(3500);
  ok(/^https:\/\/www\.reddit\.com/.test(rd.url()), 'when Work time ends the paused tab goes back to the site');
  await rd.close();
  // Bedtime mode with paused sites, started now: open tabs are checked
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs((w) => ({ bedtime: { ...w.bedtime, block: true, allowed: ['github.com'], until: Date.now() + 3600e3, skip: 0 } }))));
  await sleep(1500);
  ok(/^https:\/\/github\.com/.test(gh2.url()), 'Bedtime: an allowed site stays open');
  const ex = await visit('https://example.com/');
  ok(/r=bedtime&s=example\.com/.test(ex.url()), 'Bedtime pauses other sites');
  await ex.close();
  await page.evaluate(() => import('./js/wellbeing/common.js').then((m) => m.savePrefs((w) => ({ bedtime: { ...w.bedtime, block: false, until: 0 } }))));
  // counting: github.com in front for a few seconds
  const ghBefore = (await usageNow()).days?.[dk(0)]?.s?.['github.com'] || 0;
  await gh2.bringToFront();
  await sleep(4500);
  await sw.evaluate(() => globalThis.__wellbeing.flush());
  await sleep(500);
  const ghAfter = (await usageNow()).days?.[dk(0)]?.s?.['github.com'] || 0;
  ok(ghAfter - ghBefore >= 3, `time on github.com is counted (+${ghAfter - ghBefore}s)`);
  await gh2.close();
  await page.bringToFront();
};
