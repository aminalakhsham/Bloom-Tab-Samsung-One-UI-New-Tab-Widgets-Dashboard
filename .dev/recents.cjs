// triple — Recents screen. Full run: .dev/run.sh --raw node .dev/recents.cjs (copies the extension to a temp dir with "tabs", "sessions" and "tabGroups" granted, since headless Chrome can't accept the optional permission prompts)
// End to end: Alt+R with nothing open, the open windows as cards (live copies, most recent first), tap a card,
// × and swipe up to close, keyboard (arrows, Enter, Delete, Esc), the app icon's menu (split screen / pop-up view),
// minimized windows, Close all, the gesture bar (click, swipe up), the Quick Panel tile, Finder commands.
// With the permissions (the --raw run): Chrome tabs as cards (switch, close), Recently closed (restore), Workspaces
// (save this window's sites under a name, reopen them as a named tab group, rename, delete, Finder). Through the plain
// harness those tab checks are skipped and the "Show my tabs" card is checked instead.
// Websites are answered by request interception: no network.
const path = require('path'), fs = require('fs'), os = require('os');

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-rc-'));
  for (const f of fs.readdirSync(root)) if (!['.git', '.dev', 'dist', 'store', 'node_modules', 'scripts'].includes(f)) fs.cpSync(path.join(root, f), path.join(ext, f), { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  const grant = ['tabs', 'sessions', 'tabGroups'];
  man.permissions = [...man.permissions, ...grant];
  man.optional_permissions = (man.optional_permissions || []).filter((p) => !grant.includes(p));
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'harness.cjs'), __filename], { stdio: 'inherit', env: { ...process.env, EXT: ext } });
  fs.rmSync(ext, { recursive: true, force: true });
  process.exit(r.status);
}

module.exports = async ({ browser, page, sw, boot, ok, openApp, sleep, shot, P, ui, store, exists, count, texts, mod, logs }) => {
  const AR = ui === 'ar';
  const perms = await sw.evaluate(() => chrome.permissions.contains({ permissions: ['tabs', 'sessions', 'tabGroups'] }));
  console.log(perms ? '  (tabs, sessions and tabGroups granted: real tabs are checked too)' : '  (no tabs permission: run with --raw for the tab checks)');
  const A = (fn, ...args) => page.evaluate((fn, args) => import('./js/core/apps.js').then((m) => m[fn](...args)), fn, args);
  const cur = () => A('currentApp');
  const tt = (k, v) => page.evaluate((k, v) => import('./js/core/i18n.js').then((m) => m.t(k, v)), k, v);
  const altR = async () => { await page.keyboard.down('Alt'); await page.keyboard.press('KeyR'); await page.keyboard.up('Alt'); await sleep(600); };
  const press = async (k) => { await page.keyboard.press(k); await sleep(350); };
  const isOpen = () => exists('#recents');
  const cards = () => page.$$eval('#recents .rc-card', (l) => l.map((c) => c.dataset.app));
  const center = (sel) => page.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

  await boot();

  // ——— 1. nothing open ———
  ok(await exists('.nav-hint'), 'the gesture bar sits at the bottom of the screen');
  await altR();
  ok(await isOpen(), 'Alt+R opens Recents');
  ok((await texts('#recents .rc-empty'))[0] === (await tt('recents.noApps')) && (await page.$eval('.rc-closeall', (b) => b.hidden)), 'no windows: "No recent apps" and no Close all');
  await press('Escape');
  ok(!(await isOpen()), 'Escape closes it');

  // ——— 2. the open windows as cards ———
  await openApp('notes');
  await openApp('calculator');
  await openApp('music');
  await altR();
  ok(JSON.stringify(await cards()) === '["music","calculator","notes"]', `a card per window, most recent first (${await cards()})`);
  ok(await page.$$eval('#recents .rc-card', (l) => l.every((c) => c.querySelector('.rc-clone .app-page') && c.querySelector('.rc-clone').inert && !c.querySelector('.rc-clone [id]'))), 'each card shows a still copy of its window (inert, no duplicate ids)');
  ok((await count('.app-win')) === 3, 'the copies are not windows');
  ok(await page.$eval('.rc-card[data-app="notes"] .rc-card-app', (b) => b.textContent.trim()) === (await page.evaluate(() => import('./js/core/apps.js').then((m) => m.appName('notes')))), 'each card is labelled with its app');
  const order = await page.$$eval('#recents .rc-card', (l) => l.map((c) => Math.round(c.getBoundingClientRect().left)));
  ok(AR ? order[0] > order[1] && order[1] > order[2] : order[0] < order[1] && order[1] < order[2], `the newest card is at the ${AR ? 'right' : 'left'}`);
  await shot(P + 'recents-01-cards');
  // tap a card: that window comes back focused
  await page.click('.rc-card[data-app="calculator"] .rc-shot'); await sleep(450);
  ok(!(await isOpen()) && (await cur()) === 'calculator', 'tapping a card opens that window');

  // × and swipe up close windows
  await altR();
  await page.hover('.rc-card[data-app="notes"]');
  await page.click('.rc-card[data-app="notes"] .rc-x'); await sleep(450);
  ok(!(await exists('.app-win[data-app="notes"]')) && JSON.stringify(await cards()) === '["calculator","music"]', '× closes the app and its card');
  const mc = await center('.rc-card[data-app="music"] .rc-shot');
  await page.mouse.move(mc.x, mc.y);
  await page.mouse.down();
  await page.mouse.move(mc.x, mc.y - 60, { steps: 4 });
  ok((await page.$eval('.rc-card[data-app="music"]', (c) => c.style.transform)).includes('translateY(-'), 'a card follows the finger up');
  await page.mouse.move(mc.x, mc.y - 220, { steps: 6 });
  await page.mouse.up(); await sleep(450);
  ok(!(await exists('.app-win[data-app="music"]')) && JSON.stringify(await cards()) === '["calculator"]', 'swiping a card up closes the app');
  ok(await isOpen(), 'Recents stays open after closing a card');
  await press('Escape');

  // ——— 3. keyboard ———
  await openApp('notes');
  await openApp('clock');
  await altR();
  ok(await page.evaluate(() => document.activeElement?.matches('.rc-card') && document.activeElement.dataset.app === 'clock'), 'the first card has the keyboard focus');
  await press(AR ? 'ArrowLeft' : 'ArrowRight');
  ok(await page.evaluate(() => document.activeElement?.dataset.app === 'notes'), `${AR ? '←' : '→'} moves to the next card`);
  await press('Enter');
  ok(!(await isOpen()) && (await cur()) === 'notes', 'Enter opens it');
  await altR();
  await press('Delete'); await sleep(200);
  ok(!(await exists('.app-win[data-app="notes"]')) && (await count('#recents .rc-card')) === 2, 'Delete closes the chosen card');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.app-win[data-app="calculator"]')).visibility === 'visible'), 'the other windows are untouched');

  // ——— 4. the app icon's menu: split screen and pop-up view ———
  await page.click('.rc-card[data-app="clock"] .rc-card-app'); await sleep(350);
  const mi = await texts('.ou-menu .ou-menu-item');
  ok(mi.length === 3 && mi[0] === (await tt('recents.splitView')) && mi[1] === (await tt('recents.popupView')), `the icon's menu: ${mi.join(' | ')}`);
  await shot(P + 'recents-02-menu');
  await page.evaluate(() => document.querySelector('.ou-menu .ou-menu-item').click()); await sleep(450);
  ok(!(await isOpen()) && (await page.$eval('.app-win[data-app="clock"]', (w) => w.classList.contains(document.documentElement.dir === 'rtl' ? 'split-r' : 'split-l'))), 'Open in split screen view tiles the app');
  await altR();
  await page.click('.rc-card[data-app="clock"] .rc-card-app'); await sleep(350);
  await page.evaluate(() => document.querySelectorAll('.ou-menu .ou-menu-item')[1].click()); await sleep(450);
  ok(await page.$eval('.app-win[data-app="clock"]', (w) => !w.classList.contains('split') && !w.classList.contains('max') && w.classList.contains('focused')), 'Open in pop-up view brings it back as a pop-up');

  // ——— 5. minimized windows, Close all ———
  await A('minimizeApp', 'calculator');
  await altR();
  ok(await page.$eval('.rc-card[data-app="calculator"]', (c) => c.classList.contains('min')), 'minimized windows have their card too');
  await page.click('.rc-card[data-app="calculator"] .rc-shot'); await sleep(450);
  ok(!(await exists('.app-bubble')) && (await cur()) === 'calculator', 'tapping it restores the window');
  await altR();
  await shot(P + 'recents-03-two');
  await page.click('.rc-closeall'); await sleep(400);
  ok(!(await exists('.app-win')) && (await exists('#recents .rc-empty')), 'Close all closes every window');
  await press('Escape');

  // ——— 6. the gesture bar, the Quick Panel tile, Finder ———
  await page.click('.nav-hint'); await sleep(500);
  ok(await isOpen(), 'clicking the gesture bar opens Recents');
  await press('Escape');
  const nb = await center('.nav-hint');
  await page.mouse.move(nb.x, nb.y);
  await page.mouse.down();
  await page.mouse.move(nb.x, nb.y - 80, { steps: 6 });
  await page.mouse.up(); await sleep(500);
  ok(await isOpen(), 'swiping the gesture bar up opens Recents');
  await press('Escape');
  await mod('./js/shell/quickpanel.js', 'openQuickPanel'); await sleep(500);
  const tile = await tt('recents.title');
  ok(await exists(`.qp-tile[title="${tile}"]`), 'the Quick Panel has a Recents tile');
  await page.click(`.qp-tile[title="${tile}"]`); await sleep(600);
  ok((await isOpen()) && !(await page.evaluate(() => document.body.classList.contains('qp-open'))), 'the tile opens Recents and closes the Quick Panel');
  await press('Escape');
  await mod('./js/shell/finder.js', 'openFinder', AR ? 'التطبيقات الحديثة' : 'recents'); await sleep(500);
  const fr = await page.$$eval('#finder .fr .fr-title', (l) => l.map((x) => x.textContent));
  ok(fr.includes(tile), `Finder offers Recents (${fr.slice(0, 3)})`);
  await page.$$eval('#finder .fr', (l, n) => l.find((x) => x.querySelector('.fr-title')?.textContent === n)?.click(), tile); await sleep(600);
  ok((await isOpen()) && !(await page.evaluate(() => document.body.classList.contains('finder-open'))), 'and opens it');
  await press('Escape');
  await openApp('notes'); await openApp('calculator');
  await mod('./js/shell/finder.js', 'openFinder', AR ? 'إغلاق الكل' : 'close all'); await sleep(500);
  const closeAllCmd = await tt('recents.closeAllCmd');
  await page.$$eval('#finder .fr', (l, n) => l.find((x) => x.querySelector('.fr-title')?.textContent === n)?.click(), closeAllCmd); await sleep(500);
  ok(!(await exists('.app-win')), 'Finder "close all" closes the windows');

  // ——— 7. Chrome tabs, Recently closed, Workspaces ———
  if (!perms) {
    await altR();
    ok(await exists('#recents .rc-ask .ou-btn.primary'), 'without the tabs permission: a card offers to show your tabs');
    ok((await count('#recents .rc-ws.add')) === 1, 'Workspaces offers to save the tabs');
    await shot(P + 'recents-04-ask');
    await press('Escape');
  } else {
    const fake = async (p) => {
      await p.setRequestInterception(true);
      p.on('request', (r) => (/^https?:/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${new URL(r.url()).hostname} page</title><body style="font:20px system-ui;margin:40px">${new URL(r.url()).hostname}</body>` }) : r.continue()));
    };
    const sites = [];
    for (const u of ['https://example.com/a', 'https://news.example.org/']) {
      const p = await browser.newPage();
      await fake(p);
      await p.goto(u);
      sites.push(p);
    }
    await page.bringToFront(); await sleep(400);
    await altR(); await sleep(400);
    const hosts = await texts('#recents .rc-tab .rc-tab-host');
    ok(hosts.length === 2 && hosts.includes('example.com') && hosts.includes('news.example.org'), `the other tabs show as cards (${hosts})`);
    ok((await texts('#recents .rc-tab .rc-tab-title')).includes('example.com page'), 'with their titles');
    ok((await texts('#recents .rc-sec small'))[0] === '2', 'and their number');
    await shot(P + 'recents-05-tabs');
    // close a tab with its ×
    await page.hover('.rc-tab:first-child');
    const firstHost = (await texts('#recents .rc-tab .rc-tab-host'))[0];
    await page.click('.rc-tab:first-child .rc-x'); await sleep(900);
    const left = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.map((x) => x.url)));
    ok(!left.some((u) => u.includes(firstHost + '/')) && (await count('#recents .rc-tab')) === 1, `× closes the tab (${firstHost})`);
    // Recently closed shows it; tapping restores it
    await sleep(400);
    const closedRows = await texts('#recents .rc-closed-row .rc-closed-t');
    ok(closedRows.some((x) => x.includes(firstHost)), `Recently closed lists it (${closedRows})`);
    await page.$$eval('#recents .rc-closed-row', (l, h) => l.find((r) => r.textContent.includes(h))?.click(), firstHost); await sleep(1200);
    const again = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.map((x) => x.url || x.pendingUrl)));
    ok(!(await isOpen()) && again.some((u) => u.includes(firstHost)), 'tapping it reopens the tab');
    await page.bringToFront(); await sleep(400);
    // switch to a tab
    await altR(); await sleep(300);
    await page.$$eval('#recents .rc-tab', (l) => l.find((c) => c.textContent.includes('news.example.org'))?.click()); await sleep(700);
    const active = await sw.evaluate(() => chrome.tabs.query({ active: true }).then((l) => l.map((x) => x.url)));
    ok(active.some((u) => u.includes('news.example.org')) && !(await isOpen()), 'tapping a tab card switches to that tab');
    await page.bringToFront(); await sleep(400);

    // Workspaces: save this window's sites
    await altR(); await sleep(300);
    await page.click('#recents .rc-ws.add'); await sleep(500);
    ok(await exists('.ou-dialog .ou-input'), 'Save tabs as workspace asks for a name');
    await page.type('.ou-dialog .ou-input', 'Work');
    await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(700);
    let ws = (await store('workspaces')) || [];
    ok(ws.length === 1 && ws[0].name === 'Work' && ws[0].tabs.length >= 2 && ws[0].tabs.every((x) => /^https?:/.test(x.url)) && ws[0].color === 'blue', `the workspace is saved with the window's websites (${ws[0]?.tabs.length})`);
    ok((await texts('#recents .rc-ws-name')).includes('Work'), 'its chip shows in Workspaces');
    await shot(P + 'recents-06-workspace');
    // reopen it as a named tab group
    const before = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.length));
    await page.$$eval('#recents .rc-ws', (l) => l.find((c) => c.textContent.includes('Work'))?.click()); await sleep(1500);
    const grp = await sw.evaluate(() => chrome.tabGroups.query({ title: 'Work' }).then(async (g) => g[0] && { color: g[0].color, n: (await chrome.tabs.query({ groupId: g[0].id })).length }));
    const after = await sw.evaluate(() => chrome.tabs.query({}).then((l) => l.length));
    ok(after - before === ws[0].tabs.length && grp?.n === ws[0].tabs.length && grp.color === 'blue', `opening it adds its tabs as a "Work" tab group (${grp?.n} tabs, ${grp?.color})`);
    await page.bringToFront(); await sleep(400);
    // Finder knows the workspace
    await mod('./js/shell/finder.js', 'openFinder', AR ? 'مساحة العمل' : 'workspace'); await sleep(500);
    const wsTitle = await tt('recents.openWs', { name: 'Work' });
    ok((await page.$$eval('#finder .fr .fr-title', (l) => l.map((x) => x.textContent))).includes(wsTitle), 'Finder offers "Open workspace “Work”"');
    await press('Escape'); await press('Escape');
    // rename and delete from its menu
    await altR(); await sleep(300);
    const chip = await center('#recents .rc-ws[data-ws]');
    await page.mouse.click(chip.x, chip.y, { button: 'right' }); await sleep(350);
    ok((await count('.ou-menu .ou-menu-item')) === 3, 'right-click: Open, Rename, Delete');
    await page.evaluate(() => document.querySelectorAll('.ou-menu .ou-menu-item')[1].click()); await sleep(450);
    await page.$eval('.ou-dialog .ou-input', (i) => { i.value = ''; });
    await page.type('.ou-dialog .ou-input', 'Study');
    await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(500);
    ws = (await store('workspaces')) || [];
    ok(ws[0]?.name === 'Study' && (await texts('#recents .rc-ws-name')).includes('Study'), 'Rename renames it');
    await page.mouse.click(chip.x, chip.y, { button: 'right' }); await sleep(350);
    await page.evaluate(() => document.querySelectorAll('.ou-menu .ou-menu-item')[2].click()); await sleep(450);
    await page.click('.ou-dialog .ou-dialog-btn.danger'); await sleep(500);
    ok(!((await store('workspaces')) || []).length && !(await exists('#recents .rc-ws[data-ws]')), 'Delete removes it');
    await press('Escape');
    for (const p of sites) await p.close().catch(() => {});
  }
  await page.bringToFront();
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
};
