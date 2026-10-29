// triple
// Quick Panel (One UI): expanded (big tiles, pages of buttons with dots, two sliders) and collapsed (a row of six
// buttons and brightness; a wheel pull or the chevron expands it; the Home screen's swipe opens it collapsed); Edit
// buttons (remove, add, drag to reorder, Reset, the order saved in `qpTiles`, tiles that come later join at the end);
// registered tiles redrawn in place while the panel is open; Focus "Until I turn it off" (store `focus` with endsAt
// null: no alarm, an elapsed-time activity, never ended by the timer, read by Wellbeing and Health, logged when
// stopped); Now Bar activities hidden when the media card shows the same source; activity params and action targets.
// usage: .dev/run.sh .dev/quickpanel.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, count, exists, visible, text, texts, mod, store, sleep, shot, P, ui, outside }) => {
  const rtl = ui === 'ar';
  const t = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  await boot({ data: { home: [[]], dock: [] } });
  const QP = './js/shell/quickpanel.js';
  const open = async (o) => { await mod(QP, 'openQuickPanel', o); await sleep(500); };
  const close = async () => { await mod(QP, 'closeQuickPanel'); await sleep(350); };
  const isOpen = () => page.evaluate(() => import('./js/shell/quickpanel.js').then((m) => m.isQuickPanelOpen()));
  const collapsed = () => exists('#quickpanel .qp-panel.collapsed');
  const getS = async (k) => ((await store('settings')) || {})[k];
  const setS = async (k, v) => { await mod('./js/core/store.js', 'setSetting', k, v); await sleep(250); };
  const ids = () => page.evaluate(() => [...document.querySelectorAll('#quickpanel .qp-small .qp-tile')].map((x) => x.dataset.id));
  const allIds = () => page.evaluate(() => import('./js/core/hooks.js').then((m) => ['eye', 'torch', 'aod', 'live', 'edge', 'blur', 'newtab', 'lock', ...m.getTiles().map((x) => x.id)]));

  // ——— 1. expanded: big tiles, pages of buttons ———
  await open();
  ok(await isOpen() && !(await collapsed()), 'opens expanded by default (status bar, Alt+Q)');
  ok(await count('#quickpanel .qp-tile-big') === 2, 'Dark mode and Focus big tiles');
  const all = await allIds();
  ok(JSON.stringify(await ids()) === JSON.stringify(all), `every button in the default order (${all.length})`);
  const nPages = Math.ceil(all.length / 12);
  ok(await count('#quickpanel .qp-tpage') === nPages && await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qp-tpage')].every((p) => p.querySelectorAll('.qp-tile').length <= 12)), `${nPages} pages of up to 12 buttons`);
  ok(nPages < 2 || await count('#quickpanel .qp-tdot') === nPages, 'a dot per page');
  ok((await outside('#quickpanel .qp-tpage:first-child .qp-tile, #quickpanel .qp-tile-big')).length === 0, 'first page of buttons inside the screen');
  await shot(P + 'qp-01-expanded');
  if (nPages > 1) {
    await page.click('#quickpanel .qp-tdot:nth-child(2)'); await sleep(700);
    ok(await page.evaluate(() => {
      const s = document.querySelector('#quickpanel .qp-small'), p2 = document.querySelectorAll('#quickpanel .qp-tpage')[1].getBoundingClientRect(), r = s.getBoundingClientRect();
      return Math.abs(p2.left - r.left) < 3;
    }) && await exists('#quickpanel .qp-tdot:nth-child(2).on'), 'the second dot shows the second page');
    await shot(P + 'qp-02-page2');
    await page.click('#quickpanel .qp-tdot:nth-child(1)'); await sleep(600);
  }

  // ——— 2. collapsed ———
  await page.click('#quickpanel .qp-toggle'); await sleep(400);
  ok(await collapsed(), 'the chevron collapses the panel');
  ok(await count('#quickpanel .qp-row .qp-mini') === 6 && JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qp-row .qp-mini')].map((x) => x.dataset.id))) === JSON.stringify(all.slice(0, 6)), 'collapsed: a row of the first six buttons');
  ok(!(await visible('#quickpanel .qp-tiles')) && !(await visible('#quickpanel .qp-sliders .ou-slider:nth-child(2)')) && await visible('#quickpanel .qp-sliders .ou-slider:nth-child(1)'), 'collapsed: no big tiles, brightness only');
  await shot(P + 'qp-03-collapsed');
  const eye0 = !!(await getS('eyeComfort'));
  await page.click('#quickpanel .qp-mini[data-id="eye"]'); await sleep(400);
  ok(!!(await getS('eyeComfort')) === !eye0 && await exists('#quickpanel .qp-mini[data-id="eye"]' + (eye0 ? ':not(.on)' : '.on')), 'a button in the row works and shows its state');
  await page.click('#quickpanel .qp-mini[data-id="eye"]'); await sleep(300);
  await page.click('#quickpanel .qp-toggle'); await sleep(400);
  ok(!(await collapsed()), 'the chevron expands it again');
  await close();
  await open({ expanded: false });
  ok(await collapsed(), 'openQuickPanel({ expanded: false }) opens it collapsed');
  await page.evaluate(() => document.querySelector('#quickpanel').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true })));
  await sleep(400);
  ok(!(await collapsed()), 'pulling down (wheel) at the top expands it');
  await close();
  await page.evaluate(() => document.querySelector('#home .pages-viewport').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })));
  await sleep(700);
  ok(await isOpen() && await collapsed(), 'scrolling up on the Home screen opens it collapsed, as One UI\'s first swipe');
  await close();

  // ——— 3. registered tiles redraw while the panel is open ———
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.registerTile({ id: 'test-live', icon: 'star', order: 99, label: () => window.__lbl || 'Live test', on: () => !!window.__on, toggle() { window.__on = !window.__on; } })));
  await open();
  ok(await exists('#quickpanel .qp-tile[data-id="test-live"]:not(.on)'), 'a registered tile shows');
  await page.evaluate(() => { document.querySelector('#quickpanel .qp-tile[data-id="test-live"]').__mark = 1; window.__on = true; window.__lbl = 'Live changed'; });
  await sleep(1300);
  ok(await exists('#quickpanel .qp-tile[data-id="test-live"].on'), 'its state changes on screen while the panel is open');
  ok(await text('#quickpanel .qp-tile[data-id="test-live"] .qp-t-label') === 'Live changed', 'its label too');
  ok(await page.evaluate(() => document.querySelector('#quickpanel .qp-tile[data-id="test-live"]').__mark === 1), 'patched in place (the button is not rebuilt)');
  await page.evaluate(() => document.querySelector('#quickpanel .qp-tile[data-id="test-live"]').click()); await sleep(300);
  ok(await page.evaluate(() => window.__on === false) && await exists('#quickpanel .qp-tile[data-id="test-live"]:not(.on)'), 'clicking it toggles and redraws at once');
  await close();

  // ——— 4. Edit buttons ———
  await open();
  await page.click('#quickpanel .qp-edit-btn'); await sleep(450);
  ok(await exists('#quickpanel .qp-panel.editing') && await visible('#quickpanel .qp-edit') && !(await visible('#quickpanel .qp-card')), 'Edit buttons replaces the panel');
  ok(await text('#quickpanel .qpe-head b') === await t('qp.editButtons'), 'title: Edit buttons');
  const all2 = await allIds();
  ok(await count('#quickpanel .qpe-tile.act') === all2.length && await exists('#quickpanel .qpe-none'), 'every button is in the panel, none available');
  ok(await count('#quickpanel .qpe-tile.act.first') === 6, 'the first six (the collapsed row) are marked');
  await page.click('#quickpanel .qpe-tile.act[data-id="aod"] .qpe-badge'); await sleep(350);
  ok(await exists('#quickpanel .qpe-grid.avail .qpe-tile[data-id="aod"]') && !(await exists('#quickpanel .qpe-tile.act[data-id="aod"]')), '− moves a button to Available buttons');
  // drag "lock" before the first button
  const src = await page.evaluate(() => { const r = document.querySelector('#quickpanel .qpe-tile.act[data-id="lock"] .qp-t-ico').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const dst = await page.evaluate((rtl) => { const r = document.querySelector('#quickpanel .qpe-tile.act').getBoundingClientRect(); return { x: rtl ? r.right - 8 : r.left + 8, y: r.top + r.height / 2 }; }, rtl);
  await page.mouse.move(src.x, src.y); await page.mouse.down();
  await page.mouse.move(src.x + 8, src.y + 4, { steps: 2 });
  await page.mouse.move(dst.x, dst.y, { steps: 14 }); await sleep(200);
  await page.mouse.up(); await sleep(400);
  ok(await page.evaluate(() => document.querySelector('#quickpanel .qpe-tile.act')?.dataset.id) === 'lock', 'dragging moves a button to the front');
  await shot(P + 'qp-04-edit');
  ok((await outside('#quickpanel .qpe-head')).length === 0, 'edit header inside the screen');
  await page.click('#quickpanel .qpe-done'); await sleep(450);
  const lay = await store('qpTiles');
  ok(lay && lay.tiles[0] === 'lock' && !lay.tiles.includes('aod') && lay.known.includes('aod'), 'Done saves the order (qpTiles) ' + JSON.stringify(lay?.tiles?.slice(0, 4)));
  ok(!(await exists('#quickpanel .qp-panel.editing')) && (await ids())[0] === 'lock' && !(await ids()).includes('aod'), 'the panel shows the new order without the removed button');
  ok(await page.evaluate(() => document.querySelector('#quickpanel .qp-row .qp-mini')?.dataset.id) === 'lock', 'the collapsed row follows it');
  // a tile registered later joins at the end
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.registerTile({ id: 'test-new', icon: 'bell', order: 1, label: () => 'New tile', on: () => false, toggle() {} })));
  await close(); await open();
  ok((await ids()).at(-1) === 'test-new', 'a button that appears later joins at the end');
  // add back, then Reset
  await page.click('#quickpanel .qp-edit-btn'); await sleep(400);
  await page.click('#quickpanel .qpe-grid.avail .qpe-tile[data-id="aod"] .qpe-badge'); await sleep(300);
  ok(await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qpe-tile.act')].at(-1)?.dataset.id) === 'aod', '+ adds a button at the end');
  await page.click('#quickpanel .qpe-head .qp-pill:not(.primary)'); await sleep(300);
  ok(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qpe-tile.act')].map((x) => x.dataset.id))) === JSON.stringify(await allIds()), 'Reset puts every button back in the default order');
  await page.keyboard.press('Escape'); await sleep(400);
  ok(!(await exists('#quickpanel .qp-panel.editing')) && await isOpen() && JSON.stringify(await ids()) === JSON.stringify(await allIds()), 'Escape leaves Edit buttons (saved) and keeps the panel open');
  await close();

  // ——— 5. Focus "Until I turn it off" ———
  await open();
  await page.click('#quickpanel .qp-tile-big[data-id="focus"] .qp-tb-more'); await sleep(350);
  const fm = await texts('.ou-menu .ou-menu-item .ou-menu-label');
  ok(fm.length === 6 && fm[5] === await t('qp.untilOff'), 'Focus menu: 15–90 minutes, then Until I turn it off');
  await page.evaluate(() => [...document.querySelectorAll('.ou-menu .ou-menu-item')].at(-1).click()); await sleep(500);
  let f = await store('focus');
  ok(f && f.endsAt === null && f.minutes === null && Math.abs(f.startedAt - Date.now()) < 5000, 'open-ended session: { startedAt, endsAt: null, minutes: null }');
  ok(!(await page.evaluate(() => new Promise((r) => chrome.alarms.get('focus', r)))), 'no end alarm');
  ok(await text('#quickpanel .qp-tile-big[data-id="focus"] .qp-tb-state') === await t('qp.untilOffShort') && await exists('#quickpanel .qp-tile-big[data-id="focus"].on'), 'the Focus tile says Until turned off');
  await sleep(1300);
  ok(/^0:0\d$/.test(await text('#quickpanel .qp-activity[data-id="focus"] .qp-act-text b')) && !(await exists('#quickpanel .qp-activity[data-id="focus"] .qp-act-bar')), 'its activity counts up, no progress bar');
  ok(!!(await store('focus')), 'still on after the per-second check');
  ok(await exists(`#statusbar .sb-ico[title="${await t('sb.focus')}"]`), 'status bar Focus icon');
  ok(await page.evaluate(() => Promise.all([import('./js/wellbeing/model.js'), import('./js/core/store.js')]).then(([w, s]) => w.sessionOn(s.store.get('focus')))), 'Digital Wellbeing sees the session (sessionOn)');
  ok(await page.evaluate(() => import('./js/health/rings.js').then((m) => { const now = Date.now(); return m.liveFocus({ startedAt: now - 30 * 60e3, endsAt: null }, [], now).reduce((n, x) => n + x.min, 0) >= 29; })), 'Health counts it as it goes (liveFocus)');
  await shot(P + 'qp-05-focus-open');
  await page.click('#quickpanel .qp-tile-big[data-id="focus"] .qp-tb-more'); await sleep(350);
  ok(await page.evaluate(() => !![...document.querySelectorAll('.ou-menu .ou-menu-item')].at(-1).querySelector('.ou-menu-check') && ![...document.querySelectorAll('.ou-menu .ou-menu-item')].slice(0, 5).some((b) => b.querySelector('.ou-menu-check'))), 'the menu checks Until I turn it off');
  await page.keyboard.press('Escape'); await sleep(300);
  const st = Date.now() - 5 * 60e3;
  await page.evaluate((st) => import('./js/core/store.js').then((m) => m.store.set('focus', { startedAt: st, endsAt: null, minutes: null })), st);
  await sleep(200);
  await page.click('#quickpanel .qp-tile-big[data-id="focus"] .qp-tb-main'); await sleep(400);
  const log = (await store('focusLog')) || [];
  ok((await store('focus')) === null && log[0]?.start === st && Math.abs(log[0].end - Date.now()) < 5000, 'stopping it logs the session until now');
  await close();

  // ——— 6. activities: media dedup, params, action targets ———
  await page.evaluate(() => Promise.all([import('./js/core/hooks.js'), import('./js/core/activity.js'), import('./js/core/apps.js')]).then(([hk, act, apps]) => {
    hk.registerMedia({ id: 'tmedia', state: () => (window.__media ? { title: 'Test song', sub: 'Test artist', icon: 'music', playing: true } : null), toggle() {}, next() {}, prev() {} });
    act.registerActivity('tmedia', () => (window.__media ? { icon: 'music', title: 'Test song', sub: 'pill', priority: 1 } : null));
    act.registerActivity('tparams', () => ({
      icon: 'star', title: 'Open the pass', sub: 'params', app: 'tapp', params: { pass: 'p1' }, priority: 1,
      actions: [{ icon: 'edit', label: 'Show', open: { app: 'tapp', params: { pass: 'p2' } } }, { icon: 'check', label: 'Tick', params: { n: 7 }, onClick: (e, a, p) => (window.__tick = [a.id, p.n]) }],
    }));
    apps.registerApp({ id: 'tapp', name: { en: 'Test app', ar: 'تطبيق اختبار' }, hidden: true, render(ctx) { window.__params = ctx.params; ctx.setParams = (p) => (window.__params = p); ctx.page({ title: 'Test', render(b) { b.textContent = 'ok'; } }); } });
    window.__media = true;
  }));
  await open();
  ok(await text('#quickpanel .qp-media .qp-media-title') === 'Test song', 'the media card shows the media source');
  ok(!(await exists('#quickpanel .qp-activity[data-id="tmedia"]')) && await exists('#quickpanel .qp-activity[data-id="tparams"]'), 'its own Now Bar activity is not shown twice; others are');
  ok(await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().find((a) => a.id === 'tparams').actions.every((x) => typeof x.onClick === 'function'))), 'every action gets an onClick (actions that only name a target too)');
  // the rows are patched in place every second (a click during a refresh isn't lost)
  await page.evaluate(() => (window.__actRow = document.querySelector('#quickpanel .qp-activity[data-id="tparams"]')));
  await sleep(1300);
  ok(await page.evaluate(() => document.querySelector('#quickpanel .qp-activity[data-id="tparams"]') === window.__actRow), 'an activity row survives the per-second refresh (same node)');
  await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qp-activity[data-id="tparams"] .ou-icon-btn')][1].click()); await sleep(300);
  ok(await page.evaluate(() => JSON.stringify(window.__tick)) === '["tparams",7]', 'onClick gets the activity and the action\'s params');
  await page.evaluate(() => [...document.querySelectorAll('#quickpanel .qp-activity[data-id="tparams"] .ou-icon-btn')][0].click()); await sleep(1200);
  ok(!(await isOpen()) && await page.evaluate(() => window.__params?.pass) === 'p2', 'an action with a target opens that app with its params');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))); await sleep(400);
  await open();
  await page.click('#quickpanel .qp-activity[data-id="tparams"] .qp-act-text'); await sleep(1200);
  ok(await page.evaluate(() => window.__params?.pass) === 'p1', 'clicking the activity opens its app with its params');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))); await sleep(300);
  await page.evaluate(() => (window.__media = false));
  await open();
  await shot(P + 'qp-06-activities');
  await close();
};
