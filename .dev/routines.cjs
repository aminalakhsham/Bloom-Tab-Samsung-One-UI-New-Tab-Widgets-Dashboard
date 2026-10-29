// triple
// Modes and Routines end to end: Modes tab, turning Sleep on and off (settings change and come back), a mode's page,
// building a routine in the editor (If: Start manually; Then: Dark mode, notification, an If block), running and
// stopping it with undo, Discover → Bedtime with its time page, Finder commands, the Quick Panel tile, widgets,
// and the service worker: time periods (tick + alarm plan), coming back to the computer, a routine left pending for
// a page, "New tab opened" and "Screen unlocked".  usage: .dev/run.sh .dev/routines.cjs
module.exports = async ({ page, boot, ok, sleep, shot, P, theme, ui, sw, store, setStorage, openApp, closeApp, click, exists, count, text, texts, mod, type, reload, outside, waitFor }) => {
  const run = () => store('routinesRun');
  const data = () => store('routines');
  const top = '.app-page:last-child';
  const primary = async () => { await click('.ou-dialog-scrim:last-child .ou-dialog-btn.primary'); await sleep(400); };
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  await boot({ settings: { brightness: 100 } });
  const startTheme = theme;

  // ——— Modes ———
  await openApp('routines', { section: 'modes' });
  ok(await count('.rt-mode-row') === 6, 'Modes tab lists Samsung’s six modes');
  ok(await exists('.rt-tabs .ou-tab.active'), 'floating bottom tabs');
  ok(!(await outside('.app-win .rt-mode-row', '.app-win')).length, 'mode rows stay inside the window');
  await shot(P + 'routines-modes');
  await click('.rt-mode-row[data-mode="sleep"] .ou-switch');
  await sleep(300);
  ok(await exists('.ou-dialog .ou-radio-list'), 'turning a mode on asks for how long (Samsung’s sheet)');
  await primary();
  await sleep(800);
  let r = await run();
  let s = await store('settings');
  ok(r?.mode?.id === 'sleep' && r.mode.by === 'manual', 'Sleep is on in routinesRun');
  ok(s.theme === 'dark' && s.eyeComfort === true && s.brightness === 60, 'Sleep turned on Dark mode, Eye comfort and set brightness');
  ok((await store('focus'))?.endsAt > Date.now(), 'Sleep turned on Do not disturb (Focus)');
  ok(await exists('.rt-now'), 'the mode that is on shows at the top');
  const acts = await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().map((a) => a.id)));
  ok(acts.includes('mode'), 'Now Bar / Quick Panel activity for the mode');
  await shot(P + 'routines-modes-on');
  await click('.rt-now-btn');
  await sleep(800);
  s = await store('settings');
  ok(!(await run())?.mode && s.theme === startTheme && s.eyeComfort === false && s.brightness === 100 && !(await store('focus')), 'turning Sleep off puts every setting back');

  // a mode's page
  await click('.rt-mode-row[data-mode="work"]');
  await sleep(500);
  ok(await exists('.rt-mode-page .rt-mode-toggle') && await exists('.rt-mode-page .rt-acts'), 'mode page: Turn on, schedule, what turns on, more actions');
  await shot(P + 'routines-mode-page');
  await page.evaluate(() => [...document.querySelectorAll('.rt-mode-page .ou-row')].find((x) => x.querySelector('.ico-dnd'))?.click());
  await sleep(400);
  ok((await data())?.modes?.find((m) => m.id === 'work')?.dnd === false, 'Do not disturb switch saves on the mode');
  await page.evaluate(() => document.querySelector('.app-page:last-child .app-back')?.click());
  await sleep(500);

  // ——— Routines: the editor ———
  await click('.rt-tabs .ou-tab:nth-child(2)');
  await sleep(400);
  ok(await exists('.rt-empty') && await count('.rt-disc-card') >= 3, 'Routines tab: empty state and Discover suggestions');
  await shot(P + 'routines-empty');
  await click(`${top} .app-toolbar-actions .ou-icon-btn:nth-child(2)`);
  await sleep(500);
  ok(await exists('.rt-editor .rt-if') && await exists('.rt-editor .rt-then'), 'Add routine opens the If / Then editor');
  await click('.rt-if .rt-add-row');
  await sleep(500);
  ok(await count('[data-cond]') === 9 && await exists('[data-cond="unlock"]'), 'If picker lists nine kinds of conditions (Screen unlocked too)');
  await click('[data-cond="manual"]');
  await sleep(500);
  await click('.rt-then .rt-add-row');
  await sleep(500);
  ok(await count('[data-action]') >= 30, 'Then picker lists the actions (' + (await count('[data-action]')) + ')');
  await shot(P + 'routines-actions');
  await click('[data-action="theme.set"]');
  await sleep(500);
  ok(await exists('.rt-param-dlg .rt-chipset'), 'action settings dialog');
  await primary();
  await click('.rt-then .rt-add-row');
  await sleep(400);
  await click('[data-action="notify"]');
  await sleep(400);
  await type('.rt-f[data-key="text"] .rt-field', 'Routine ran');
  ok(await count('.rt-f[data-key="text"] .rt-var-btn') >= 2, 'text fields offer variables');
  await primary();
  await click('.rt-then .rt-add-row');
  await sleep(400);
  await click('[data-action="if"]');
  await sleep(400);
  await primary();
  ok(await count('.rt-then .rt-marker') === 2, 'If adds Otherwise and End If markers');
  ok(await exists('.rt-editor .ou-switch'), '"Undo actions when routine ends" for a manual routine');
  await shot(P + 'routines-editor');
  await click('.rt-save');
  await sleep(400);
  await type('.rt-style-dlg input.ou-input', 'Night owl');
  await primary();
  await sleep(500);
  let list = (await data())?.list || [];
  const mine = list.find((x) => x.name === 'Night owl');
  ok(mine && mine.conds[0].type === 'manual' && mine.actions.map((a) => a.type).join() === 'theme.set,notify,if,if,if' && mine.actions[1].p.text === 'Routine ran', 'the routine is saved with its If and Then');
  ok(await exists(`.rt-r-row[data-routine="${mine?.id}"] .rt-play`), 'a manual routine gets a Start button');

  // run it, then stop it (undo)
  await setStorage({ settings: { ...(await store('settings')), theme: 'light' } });
  await sleep(400);
  await click(`.rt-r-row[data-routine="${mine.id}"] .rt-play`);
  await sleep(1200);
  r = await run();
  ok((await store('settings')).theme === 'dark' && r.running?.[mine.id], 'Start runs it and it keeps running (undo is on)');
  ok((await store('notifications') || []).some((n) => n.app === 'routines' && n.body === 'Routine ran'), 'Show notification posted in the notification list');
  await shot(P + 'routines-running');
  await click(`.rt-r-row[data-routine="${mine.id}"] .rt-play`);
  await sleep(1000);
  ok((await store('settings')).theme === 'light' && !(await run()).running?.[mine.id], 'Stop ends it and puts Dark mode back');
  await setStorage({ settings: { ...(await store('settings')), theme } });

  // Discover → Bedtime, its time page
  await page.evaluate(() => document.querySelector('.app-page:last-child .app-toolbar-actions .ou-icon-btn')?.click());
  await sleep(500);
  ok(await count('.rt-disc-grid .rt-disc-card') >= 9, 'Discover page with ready-made routines');
  await shot(P + 'routines-discover');
  await click('.rt-disc-grid [data-discover="bedtime"]');
  await sleep(500);
  await click('.rt-if .rt-cond');
  await sleep(500);
  ok(await count('.rt-wheel') >= 4 && await count('.rt-day') === 7, 'time page: start and end wheels, days');
  await shot(P + 'routines-time');
  await click('.rt-time-done');
  await sleep(500);
  await click('.rt-save');
  await sleep(400);
  await primary();
  await sleep(500);
  list = (await data())?.list || [];
  const bed = list.find((x) => x.from === 'bedtime');
  ok(bed && bed.conds[0].type === 'time' && bed.conds[0].end === '07:00' && bed.actions.length === 5, 'Bedtime saved from Discover');
  await page.evaluate(() => [...document.querySelectorAll('.app-page:last-child .app-back')].pop()?.click());
  await sleep(500);
  await shot(P + 'routines-list');
  await sleep(1500);
  const tickAlarm = await sw.evaluate(() => chrome.alarms.get('routine:tick'));
  ok(tickAlarm && tickAlarm.scheduledTime > Date.now(), 'the worker planned the next routine:tick alarm');

  // Finder and the Quick Panel tile
  const cmds = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('run night', () => {}).map((x) => x.title)));
  ok(cmds.some((x) => x.includes('Night owl')), 'Finder: "run night" offers to start the routine');
  const modeCmds = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('mode relax', () => {}).map((x) => x.title)));
  ok(modeCmds.length === 1, 'Finder: "mode relax" turns on Relax');
  const search = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('routines').search('night').map((x) => x.title)));
  ok(search.includes('Night owl'), 'Finder search finds routines');
  await closeApp();
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.getTiles().find((x) => x.id === 'modes').toggle()));
  await sleep(800);
  ok((await run())?.mode?.id === 'sleep', 'Quick Panel tile turns the last used mode back on');
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(500);
  ok(await page.evaluate(() => [...document.querySelectorAll('.qp-tile.on')].length >= 1), 'the Modes tile shows on');
  await shot(P + 'routines-quickpanel');
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel');
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.getTiles().find((x) => x.id === 'modes').toggle()));
  await sleep(800);
  ok(!(await run())?.mode, 'the tile turns the mode off again');

  // widgets: a new Routines widget asks which routine to show first (Widget settings)
  await page.evaluate(() => { import('./js/shell/home.js').then((m) => { m.addWidget('routines', 'm'); }); });
  await sleep(700);
  ok(await count('.ou-dialog .ou-radio-row') === 3, 'adding a Routines widget asks which routine to show (All routines + 2)');
  await page.evaluate((name) => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((x) => x.textContent.includes(name))?.click(), 'Night owl');
  await primary();
  await mod('./js/shell/home.js', 'addWidget', 'modes', 'm');
  await sleep(600);
  ok(JSON.stringify(await store('home')).includes(`"routine":"${mine.id}"`), 'the widget keeps the picked routine in its config');
  ok(await page.evaluate(() => document.querySelector('.wg-routines .rt-wg-tile')?.dataset.routine) === mine.id, 'the picked routine shows first');
  ok(await count('.wg-routines .rt-wg-tile') >= 2 && await count('.wg-modes .rt-wgm-mode') === 4, 'Routines and Modes widgets');
  await page.evaluate(() => document.querySelector('.wg-modes .rt-wgm-mode')?.click());
  await sleep(900);
  ok((await run())?.mode?.id === 'sleep', 'the Modes widget turns a mode on');
  await shot(P + 'routines-widgets');
  await page.evaluate(() => document.querySelector('.wg-modes .rt-wgm-mode.on')?.click());
  await sleep(800);
  await page.evaluate((id) => document.querySelector(`.wg-routines .rt-wg-tile[title]`) && [...document.querySelectorAll('.wg-routines .rt-wg-tile')].find((x) => x.dataset.routine === id)?.click(), mine.id);
  await sleep(1000);
  ok((await run())?.running?.[mine.id], 'the Routines widget starts a routine');
  await page.evaluate((id) => [...document.querySelectorAll('.wg-routines .rt-wg-tile')].find((x) => x.dataset.routine === id)?.click(), mine.id);
  await sleep(1000);
  ok(!(await run())?.running?.[mine.id], 'and stops it');
  // a routine's ⋮ › Add to Home screen adds a small widget for it, with no settings step
  await openApp('routines', { section: 'r:' + bed.id });
  await sleep(500);
  const edMore = '.app-page.rt-editor .app-toolbar-actions .ou-icon-btn';
  ok(await waitFor(edMore), 'a routine’s notification section opens its editor');
  await page.evaluate((s) => [...document.querySelectorAll(s)].pop()?.click(), edMore);
  await sleep(400);
  const menuOk = await page.evaluate(() => { const b = [...document.querySelectorAll('.ou-menu-item')].find((x) => x.querySelector('.ico-widgets')); b?.click(); return !!b; });
  await sleep(1200);
  ok(!(await exists('.ou-dialog .ou-radio-list')), 'Add to Home screen doesn’t ask which routine');
  const widgetsIn = (v) => (Array.isArray(v) ? v.flatMap(widgetsIn) : v && typeof v === 'object' ? (v.type === 'widget' ? [v] : Object.values(v).flatMap(widgetsIn)) : []);
  const homeWidgets = widgetsIn([await store('home'), await store('homeLeft')]);
  ok(menuOk && homeWidgets.some((w) => w.widget === 'routines' && w.size === 's' && w.config?.routine === bed.id), 'Add to Home screen pins that routine to a small Routines widget: ' + homeWidgets.map((w) => `${w.widget}/${w.size}/${JSON.stringify(w.config)}`).join(' '));
  await closeApp();

  // ——— the service worker ———
  const now = new Date();
  const timed = { id: 'rt-timed', name: 'Now period', icon: 'clock', color: '#3e7bff', on: true, match: 'any', undo: true, conds: [{ type: 'time', start: hhmm(new Date(Date.now() - 3600e3)), end: hhmm(new Date(Date.now() + 3600e3)), days: [0, 1, 2, 3, 4, 5, 6] }], actions: [{ id: 'b1', type: 'brightness.set', p: { value: '45' } }] };
  const back = { id: 'rt-back', name: 'Back', icon: 'rtIdle', color: '#3e7bff', on: true, match: 'any', undo: false, conds: [{ type: 'idle', away: 15 }], actions: [{ id: 'n1', type: 'notify', p: { title: 'Welcome', text: 'Back again' } }] };
  const snd = { id: 'rt-snd', name: 'Rain at start', icon: 'music', color: '#ff7a45', on: true, match: 'any', undo: false, conds: [{ type: 'startup' }], actions: [{ id: 's1', type: 'sound.play', p: { sound: 'ocean' } }] };
  const tab = { id: 'rt-tab', name: 'Tab hello', icon: 'rtNewTab', color: '#3e7bff', on: true, match: 'any', undo: false, conds: [{ type: 'newtab' }], actions: [{ id: 'n2', type: 'notify', p: { title: 'Tab', text: 'Hello tab' } }] };
  await setStorage({ routines: { ...(await data()), list: [timed, back, snd, tab] }, routinesRun: {}, notifications: [] });
  await sleep(500);
  await sw.evaluate(() => btRoutines.tick());
  await sleep(500);
  ok((await run())?.running?.['rt-timed']?.by === 'state' && (await store('settings')).brightness === 45, `worker tick starts a routine whose time period holds now (${hhmm(now)})`);
  await mod('./js/routines/page.js', 'stopRoutine', 'rt-timed');
  await sleep(600);
  ok((await store('settings')).brightness === 100 && (await run())?.skip?.['r:rt-timed'], 'stopping it by hand undoes it and keeps it off for this period');
  const fired = await sw.evaluate(() => btRoutines.fire({ type: 'idle', away: 30 }));
  await sleep(500);
  ok(fired.includes('rt-back') && (await store('notifications')).some((n) => n.body === 'Back again'), 'worker: back at the computer after 30 min runs "Back"');
  await sw.evaluate(() => btRoutines.fire({ type: 'startup' }));
  await sleep(300);
  const pend = (await store('notifications')).some((n) => n.app === 'routines' && n.icon === 'rtRoutine' && n.title.includes('Rain at start'));
  ok(pend, 'a routine that needs a page posts "Tap to run"');
  await reload();
  await sleep(2500);
  r = await run();
  ok(!(r.pending || []).length && r.last?.['rt-snd'], 'the next page ran the pending routine');
  ok((await store('notifications')).some((n) => n.body === 'Hello tab'), '"New tab opened" ran on the new tab');

  // "Screen unlocked": only a real unlock of this tab's Lock screen runs it (a tab that opens unlocked doesn't count)
  const unl = { id: 'rt-unl', name: 'Hi again', icon: 'unlock', color: '#3e7bff', on: true, match: 'any', undo: false, conds: [{ type: 'unlock' }], actions: [{ id: 'n3', type: 'notify', p: { title: 'Unlocked', text: 'Welcome back' } }] };
  await setStorage({ routines: { ...(await data()), list: [...(await data()).list, unl] } });
  await page.evaluate(() => localStorage.setItem('bt.routines.pin', JSON.stringify({ id: 'x', at: Date.now() })));
  await reload();
  await sleep(1200);
  ok(await page.evaluate(() => localStorage.getItem('bt.routines.pin')) === null, 'the old widget hand-over key is cleared');
  const hi = async () => ((await store('notifications')) || []).filter((n) => n.body === 'Welcome back').length;
  ok(await hi() === 0, 'a tab that opens unlocked doesn’t run “Screen unlocked”');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(1500);
  ok(await hi() === 0, 'nothing runs while the Lock screen is up');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(1800);
  ok(await hi() === 1 && (await run())?.last?.['rt-unl'], 'unlocking runs “Screen unlocked” once');
  // the engine ignores the same event within 20 s (two tabs can report one); a later unlock runs it again
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(500);
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(1800);
  ok(await hi() === 1, 'an unlock right after doesn’t run it twice');
  const rr = await run();
  await setStorage({ routinesRun: { ...rr, last: { ...rr.last, 'rt-unl': Date.now() - 60e3 } } });
  await sleep(300);
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(500);
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(1800);
  ok(await hi() === 2, 'and a later unlock runs it again');
  const cond = await page.evaluate(() => import('./js/routines/labels.js').then((m) => m.condTitle({ type: 'unlock' }) + ' · ' + m.condSub({ type: 'unlock' })));
  ok(cond.length > 10 && !cond.includes('routines.'), 'the condition reads: ' + cond);

  // Arabic / RTL look of the main screens
  await openApp('routines', { section: 'routines' });
  await sleep(400);
  ok(await count('.rt-r-row') === 5, 'routines list shows the five routines');
  await shot(P + 'routines-list2');
  await openApp('routines', { section: 'm:sleep' });
  await sleep(500);
  ok(await exists('.rt-mode-page'), 'notification sections open a mode page');
  await closeApp();
};
