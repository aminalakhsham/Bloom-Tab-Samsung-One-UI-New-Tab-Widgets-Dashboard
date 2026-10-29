// triple
// Home screen end to end: a seeded layout (sites, apps, a folder, widgets, dock) renders on the grid; page
// navigation by keys, wheel, swipe and dots (mirrored in Arabic); context menus; the Add website dialog (home
// menu and edit bar) and Edit website; remove + Undo; folders (open, rename in place and from the menu, colour,
// create by dropping an icon on another, move out, ungroup); edit mode (menu, long press, add page, Done, Esc);
// the widget picker (add, resize, remove + Undo); the dock (open, menu, drop an icon into it); changes made in
// another tab. The `home`/`dock` storage is checked after every change.
// One UI editing (2026-10-26): the edit bar (Wallpaper and style, Themes, Widgets, Settings), icon styles, Undo/Redo
// (Ctrl+Z, Ctrl+Shift+Z, buttons), the Main page and trash buttons on each page, the page manager (thumbnails, drag
// to move, +, click to go), the Now Brief page (keys, widgets, remove + Undo, drag to reorder, its switch, Add
// widget), a link dropped from Chrome, Lock Home screen layout, app icon badges (notifications, setBadge, dot, off),
// the Apps screen button setting, a widget's settings step (configure), pinch to edit, removeSite(), the Apps
// screen's Sort / Custom order / folders / Create folder, the first-run layout and new apps joining old layouts once.
// usage: .dev/run.sh .dev/home.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, reload, ok, count, exists, visible, text, texts, mod, store, setStorage, sleep, shot, P, ui, outside }) => {
  const rtl = ui === 'ar';
  const t = (k, v) => mod('./js/core/i18n.js', 't', k, v);

  const site = (id, title, host) => ({ id, type: 'site', title, url: `https://${host}.example.com/` });
  const seedHome = [
    [
      { id: 'w1', type: 'widget', widget: 'clock-analog', size: 's', config: {} },
      site('sa', rtl ? 'ألفا' : 'Alpha', 'alpha'),
      site('sb', rtl ? 'بيتا' : 'Beta', 'beta'),
      { id: 'an', type: 'app', app: 'notes' },
      { id: 'f1', type: 'folder', title: rtl ? 'عمل' : 'Work', color: '#22b07d', items: [site('sc', 'Gamma', 'gamma'), site('sd', 'Delta', 'delta')] },
      { id: 'ac', type: 'app', app: 'calculator' },
    ],
    [{ id: 'w2', type: 'widget', widget: 'quote', size: 'm', config: {} }, site('se', 'Echo', 'echo')],
    [site('sf', 'Foxtrot', 'foxtrot')],
  ];
  const seedDock = [{ id: 'd1', type: 'app', app: 'calendar' }, { id: 'd2', type: 'app', app: 'clock' }, { id: 'd3', type: 'app', app: 'settings' }, { id: 'd4', type: 'app', app: 'drawer' }];
  await boot({ data: { home: seedHome, dock: seedDock } });
  const L = {};
  for (const k of ['home.webApp', 'home.addSite', 'home.widgets', 'home.wallpaper', 'home.wallpaperStyle', 'home.themes', 'home.edit', 'home.settings', 'home.editSite', 'home.folder', 'home.folderColor',
    'home.ungroup', 'home.moveOut', 'home.addToEdge', 'home.size.s', 'home.size.m', 'home.size.l', 'common.openNewTab', 'common.edit', 'common.remove',
    'common.rename', 'common.open', 'common.save', 'common.add', 'common.done']) L[k] = await t(k);

  // ——— helpers ———
  const home = () => store('home');
  const dock = () => store('dock');
  const flat = (pages) => pages.flat().flatMap((x) => (x.type === 'folder' ? [x.id, ...x.items.map((y) => y.id)] : [x.id]));
  const find = (pages, id) => pages.flat().find((x) => x.id === id);
  const pageIds = () => page.evaluate(() => [...document.querySelectorAll('#home .pages-track > .page:not(.add-page)')].map((p) => [...p.querySelectorAll('.page-grid > .tile')].map((x) => x.dataset.id)));
  const center = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
  }, sel);
  const rightClick = async (sel) => {
    const c = await center(sel);
    if (!c) return false;
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await sleep(350);
    return true;
  };
  const menuLabels = () => texts('.ou-menu .ou-menu-item .ou-menu-label');
  const pick = async (label) => {
    const done = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('.ou-menu .ou-menu-item')].find((x) => x.querySelector('.ou-menu-label')?.textContent.trim() === l);
      b?.click();
      return !!b;
    }, label);
    await sleep(400);
    return done;
  };
  const leftShown = () => page.evaluate(() => {
    const vp = document.querySelector('#home .pages-viewport').getBoundingClientRect();
    const lp = document.querySelector('#home .left-page');
    const r = lp?.getBoundingClientRect();
    return !!r && !lp.hidden && Math.abs(r.left - vp.left) < 2 && !lp.inert;
  });
  const activeDot = () => page.evaluate(() => [...document.querySelectorAll('#home .page-dots .dot')].findIndex((d) => d.classList.contains('active')));
  const shown = (i) => page.evaluate((i) => {
    const vp = document.querySelector('#home .pages-viewport').getBoundingClientRect();
    const pages = [...document.querySelectorAll('#home .pages-track > .page')];
    const r = pages[i]?.getBoundingClientRect();
    return !!r && Math.abs(r.left - vp.left) < 2 && !pages[i].inert && pages.every((p, k) => k === i || p.inert);
  }, i);
  // a point on the current page's empty space (no tile), for right-clicks, long presses and swipes
  const emptyPoint = () => page.evaluate(() => {
    const vp = document.querySelector('#home .pages-viewport').getBoundingClientRect();
    for (let y = vp.bottom - 12; y > vp.top + 12; y -= 14) {
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = vp.left + vp.width * fx;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.pages-viewport') && !el.closest('.tile, button, input')) return { x, y };
      }
    }
    return null;
  });
  const dialogOpen = () => exists('.ou-dialog-scrim:not(.closing) .ou-dialog');
  const typeInto = async (sel, value) => {
    await page.evaluate((s) => { const el = document.querySelector(s); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, sel);
    await page.click(sel);
    if (value) await page.keyboard.type(value);
    await sleep(100);
  };
  const primary = async () => { await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(450); };
  const esc = async () => { await page.keyboard.press('Escape'); await sleep(400); };
  const label = (id) => text(`#home .tile[data-id="${id}"] .tile-label`);
  // show the page that holds an item (widgets that grow push items onto the next page)
  const goTo = async (id) => {
    const i = await page.evaluate((id) => [...document.querySelectorAll('#home .pages-track > .page')].findIndex((p) => p.querySelector(`.tile[data-id="${id}"]`)), id);
    if (i >= 0) { await page.evaluate((i) => document.querySelectorAll('#home .page-dots .dot')[i]?.click(), i); await sleep(450); }
    return i;
  };

  // ——— 1. the seeded layout ———
  ok(await count('#home .pages-track > .page') === 3, 'three pages rendered');
  ok(JSON.stringify(await pageIds()) === JSON.stringify(seedHome.map((p) => p.map((x) => x.id))), 'every page shows its items in order');
  ok(JSON.stringify((await home()).map((p) => p.map((x) => x.id))) === JSON.stringify(seedHome.map((p) => p.map((x) => x.id))), 'booting leaves the stored layout as it was');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="w1"]').style.gridArea.replace(/\s/g, '')) === '1/1/span2/span2', 'small widget takes 2×2 cells at the start');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="sa"]').style.gridArea.replace(/\s/g, '')) === '1/3/span1/span1', 'first site sits right after the widget');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="w2"]').style.gridArea.replace(/\s/g, '')) === '1/1/span2/span4', 'medium widget takes 4×2 cells');
  const w1 = await center('#home .tile[data-id="w1"]'), sa = await center('#home .tile[data-id="sa"]');
  ok(rtl ? w1.r > sa.r : w1.l < sa.l, `grid starts on the ${rtl ? 'right' : 'left'} (${rtl ? 'RTL' : 'LTR'})`);
  ok(await label('sa') === seedHome[0][1].title && await label('f1') === seedHome[0][4].title, 'site and folder labels');
  ok(await label('an') === await mod('./js/core/apps.js', 'appName', 'notes'), 'app label is the app name');
  ok(await exists('#home .tile[data-id="sa"] .app-icon.site') && await exists('#home .tile[data-id="an"] .app-icon.builtin'), 'site and app icons');
  ok(await count('#home .tile[data-id="f1"] .folder-grid .app-icon') === 2, 'folder icon previews its two items');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="f1"] .app-icon.folder').style.getPropertyValue('--folder')) === '#22b07d', 'folder colour applied');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="w1"] .wg').childElementCount > 0), 'clock widget rendered content');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="w2"] .wg').textContent.trim().length > 5), 'quote widget rendered text');
  ok(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#home .dock .tile')].map((x) => x.dataset.id))) === '["d1","d2","d3","d4"]', 'dock shows its four apps');
  ok(await count('#home .page-dots .dot') === 3 && await activeDot() === 0, 'three page dots, first active');
  ok(await visible('#home .home-search .hs-bar'), 'search bar shown');
  ok((await outside('#home .pages-track > .page:first-child .tile, #home .dock .tile')).length === 0, 'page 1 and dock tiles inside the screen');
  ok(await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#home .pages-track > .page:first-child .page-grid > .tile')].map((x) => x.getBoundingClientRect());
    return rs.every((a, i) => rs.every((b, j) => i === j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1));
  }), 'no tiles overlap on page 1');
  await shot(P + 'home-01-seeded');

  // ——— 2. pages: keys (mirrored in RTL), wheel, swipe, dots ———
  const next = rtl ? 'ArrowLeft' : 'ArrowRight', prev = rtl ? 'ArrowRight' : 'ArrowLeft';
  await page.evaluate(() => document.activeElement?.blur());
  // before the first page sits the Now Brief page (it has no dot of its own, only the mark before the dots)
  await page.keyboard.press(prev); await sleep(500);
  ok(await leftShown() && await activeDot() === -1 && await exists('#home .left-dot.active'), `${prev} on the first page opens the Now Brief page`);
  await page.keyboard.press(prev); await sleep(400);
  ok(await leftShown(), 'nothing before the Now Brief page');
  await page.keyboard.press(next); await sleep(500);
  ok(await activeDot() === 0 && await shown(0) && !(await leftShown()), `${next} goes back to page 1`);
  await page.keyboard.press(next); await sleep(500);
  ok(await activeDot() === 1 && await shown(1), `${next} goes to page 2`);
  await shot(P + 'home-02-page2');
  await page.keyboard.press(next); await sleep(500);
  ok(await activeDot() === 2 && await shown(2), `${next} goes to page 3`);
  await page.keyboard.press(next); await sleep(400);
  ok(await activeDot() === 2, 'no page after the last one');
  await page.keyboard.press(prev); await sleep(500);
  ok(await activeDot() === 1 && await shown(1), `${prev} goes back`);
  await page.click('#home .page-dots .dot:first-child'); await sleep(500);
  ok(await activeDot() === 0 && await shown(0), 'clicking a dot jumps to that page');
  let pt = await emptyPoint();
  ok(!!pt, 'found empty space on page 1');
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.wheel({ deltaX: rtl ? -150 : 150 }); await sleep(700);
  ok(await activeDot() === 1, 'horizontal wheel turns the page');
  await page.mouse.wheel({ deltaX: rtl ? 150 : -150 }); await sleep(700);
  ok(await activeDot() === 0, 'wheel back');
  await page.mouse.move(pt.x, pt.y); await page.mouse.down();
  await page.mouse.move(pt.x + (rtl ? 160 : -160), pt.y, { steps: 6 }); await page.mouse.move(pt.x + (rtl ? 420 : -420), pt.y, { steps: 6 });
  await page.mouse.up(); await sleep(700);
  ok(await activeDot() === 1 && await shown(1), 'swiping empty space turns the page');
  await page.click('#home .page-dots .dot:first-child'); await sleep(500);

  // ——— 3. context menus ———
  pt = await emptyPoint();
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(350);
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['home.addSite'], L['home.widgets'], L['home.wallpaper'], L['home.edit'], L['home.settings']]), 'home menu: add website, widgets, wallpaper, edit, settings');
  ok((await outside('.ou-menu')).length === 0, 'home menu inside the screen');
  await shot(P + 'home-03-menu');
  await esc();
  ok(!(await exists('.ou-menu-scrim:not(.closing)')), 'Esc closes the menu');
  await rightClick('#home .tile[data-id="sa"]');
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.openNewTab'], L['common.edit'], L['home.webApp'], L['home.addToEdge'], L['common.remove']]), 'site menu: new tab, edit, open as web app, add to Edge, remove');
  await esc();
  await rightClick('#home .tile[data-id="an"]');
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.open'], L['home.addToEdge'], L['common.remove']]), 'app menu: open, add to Edge, remove');
  await esc();
  await rightClick('#home .tile[data-id="f1"]');
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.rename'], L['home.folderColor'], L['home.ungroup'], L['common.remove']]), 'folder menu: rename, colour, ungroup, remove');
  await esc();
  await rightClick('#home .tile[data-id="w1"]');
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.open'], L['common.remove']]), 'one-size widget menu: open, remove');
  await esc();
  await page.focus('#home .tile[data-id="sb"]');
  await page.keyboard.down('Shift'); await page.keyboard.press('F10'); await page.keyboard.up('Shift'); await sleep(350);
  ok((await menuLabels()).length === 5, 'Shift+F10 opens the item menu from the keyboard');
  await esc();

  // ——— 4. Add website (home menu), Edit website ———
  pt = await emptyPoint();
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(350);
  await pick(L['home.addSite']);
  ok(await dialogOpen() && await text('.ou-dialog-title') === L['home.addSite'], 'Add website dialog opens');
  ok(await count('.ou-dialog input.ou-input') === 2 && await exists('.ou-dialog .site-webapp .ou-switch'), 'URL and name fields, Open as web app switch');
  await typeInto('.ou-dialog input.ou-input', 'not a url');
  await primary();
  ok(await dialogOpen(), 'an invalid URL keeps the dialog open');
  await typeInto('.ou-dialog input.ou-input', 'news.example.org/today');
  ok(await page.evaluate(() => document.querySelectorAll('.ou-dialog input.ou-input')[1].placeholder) === 'Example', 'name placeholder suggests the site name');
  await shot(P + 'home-04-add-site');
  await typeInto('.ou-dialog input.ou-input:nth-of-type(2)', rtl ? 'أخبار' : 'Morning News');
  await primary();
  ok(!(await dialogOpen()), 'Add closes the dialog');
  let h = await home();
  const added = h.flat().find((x) => x.type === 'site' && x.url === 'https://news.example.org/today');
  ok(!!added && added.title === (rtl ? 'أخبار' : 'Morning News'), 'Add website from the home menu saves the site (https:// added, custom name) ' + JSON.stringify(added || null));
  ok(!!added && h[0].some((x) => x.id === added.id), 'new site goes to the first page with room');
  ok(!!added && await exists(`#home .tile[data-id="${added?.id}"]`), 'new site tile shown');

  await rightClick('#home .tile[data-id="sa"]');
  await pick(L['common.edit']);
  ok(await text('.ou-dialog-title') === L['home.editSite'], 'Edit website dialog');
  ok(await page.evaluate(() => [...document.querySelectorAll('.ou-dialog input.ou-input')].map((x) => x.value).join('|')) === `https://alpha.example.com/|${seedHome[0][1].title}`, 'edit dialog is filled in');
  ok(await text('.ou-dialog .ou-dialog-btn.primary') === L['common.save'], 'edit dialog says Save');
  await typeInto('.ou-dialog input.ou-input:nth-of-type(2)', 'Alpha 2');
  await primary();
  h = await home();
  ok(find(h, 'sa')?.title === 'Alpha 2' && find(h, 'sa')?.url === 'https://alpha.example.com/', 'edited name saved');
  ok(await label('sa') === 'Alpha 2', 'tile label updated');

  // Open as web app: the menu toggle and the switch in Edit website
  const webAppChecked = () => page.evaluate((l) => !![...document.querySelectorAll('.ou-menu .ou-menu-item')].find((b) => b.querySelector('.ou-menu-label')?.textContent.trim() === l)?.querySelector('.ou-menu-check'), L['home.webApp']);
  await rightClick('#home .tile[data-id="sa"]');
  ok(!(await webAppChecked()), 'Open as web app starts off');
  await pick(L['home.webApp']);
  ok(find(await home(), 'sa')?.webApp === true, 'Open as web app on: saved on the site');
  await rightClick('#home .tile[data-id="sa"]');
  ok(await webAppChecked(), 'the menu shows it checked');
  await pick(L['common.edit']);
  ok(await page.evaluate(() => document.querySelector('.ou-dialog .site-webapp input')?.checked === true), 'Edit website shows the web app switch on');
  await shot(P + 'home-04b-edit-webapp');
  await page.click('.ou-dialog .site-webapp .ou-switch'); await sleep(150);
  await primary();
  ok(find(await home(), 'sa') && !('webApp' in find(await home(), 'sa')) && find(await home(), 'sa').title === 'Alpha 2', 'turned off from Edit website (name kept)');

  // ——— 5. remove + Undo ———
  const before = flat(await home());
  await rightClick('#home .tile[data-id="sb"]');
  await pick(L['common.remove']);
  ok(!flat(await home()).includes('sb') && !(await exists('#home .tile[data-id="sb"]')), 'Remove takes the site off the Home screen');
  ok(await visible('.ou-toast .ou-toast-action'), 'toast offers Undo');
  await page.click('.ou-toast .ou-toast-action'); await sleep(500);
  ok(JSON.stringify(flat(await home())) === JSON.stringify(before), 'Undo puts it back in the same place');

  // ——— 6. folders: open, rename in place, rename + colour from the menu ———
  await page.click('#home .tile[data-id="f1"]'); await sleep(500);
  ok(await visible('.folder-scrim .folder-panel'), 'folder opens');
  ok(await count('.folder-panel .folder-items .tile') === 2, 'folder shows its two items');
  ok(await page.evaluate(() => document.querySelector('.folder-panel .folder-title').value) === seedHome[0][4].title, 'folder title field');
  ok((await outside('.folder-panel')).length === 0, 'folder panel inside the screen');
  await shot(P + 'home-05-folder');
  await typeInto('.folder-panel .folder-title', rtl ? 'مشاريع' : 'Projects');
  await page.keyboard.press('Enter'); await sleep(300);
  ok(find(await home(), 'f1')?.title === (rtl ? 'مشاريع' : 'Projects'), 'renaming in the open folder saves');
  await esc();
  ok(!(await exists('.folder-scrim')), 'Esc closes the folder');
  ok(await label('f1') === (rtl ? 'مشاريع' : 'Projects'), 'folder label updated');
  await rightClick('#home .tile[data-id="f1"]');
  await pick(L['common.rename']);
  ok(await page.evaluate(() => document.querySelector('.ou-dialog input.ou-input')?.value) === (rtl ? 'مشاريع' : 'Projects'), 'Rename dialog shows the current name');
  await typeInto('.ou-dialog input.ou-input', 'Work 2');
  await primary();
  ok(find(await home(), 'f1')?.title === 'Work 2', 'Rename from the menu saves');
  await rightClick('#home .tile[data-id="f1"]');
  await pick(L['home.folderColor']);
  ok(await count('.ou-dialog .ou-swatch') === 8, 'colour dialog has 8 swatches');
  await page.click('.ou-dialog .ou-swatch[title="#9b5de5"]'); await sleep(150);
  await shot(P + 'home-06-folder-color');
  await primary();
  ok(find(await home(), 'f1')?.color === '#9b5de5', 'folder colour saved');
  ok(await page.evaluate(() => document.querySelector('#home .tile[data-id="f1"] .app-icon.folder').style.getPropertyValue('--folder')) === '#9b5de5', 'folder icon repainted');

  // ——— 7. create a folder by dropping one icon on another, then move an item out ———
  const dragTo = async (fromSel, to, hold = 700) => {
    const a = await center(fromSel);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x + 14, a.y + 6, { steps: 3 }); // > 7 px before the long press starts a drag
    await sleep(120);
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await sleep(hold);
    await page.mouse.move(to.x + 1, to.y + 1);
    await sleep(120);
    await page.mouse.up(); await sleep(700);
  };
  const saIdx = (await home())[0].findIndex((x) => x.id === 'sa');
  await dragTo('#home .tile[data-id="sb"] .app-icon', await center('#home .tile[data-id="sa"] .app-icon'));
  h = await home();
  const nf = h[0][saIdx];
  ok(nf?.type === 'folder' && JSON.stringify(nf.items.map((x) => x.id)) === '["sa","sb"]', 'dropping Beta on Alpha makes a folder with both, where Alpha was ' + JSON.stringify(h[0].map((x) => x.id)));
  ok(nf?.title === L['home.folder'], 'new folder gets the default name');
  ok(!h[0].some((x) => x.id === 'sa' || x.id === 'sb'), 'both icons left the page');
  await shot(P + 'home-07-new-folder');
  if (nf?.type === 'folder') {
    await page.click(`#home .tile[data-id="${nf.id}"]`); await sleep(500);
    const it = await center('.folder-panel .folder-items .tile:last-child');
    await page.mouse.click(it.x, it.y, { button: 'right' }); await sleep(350);
    ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.openNewTab'], L['home.moveOut'], L['common.remove']]), 'item menu inside a folder');
    ok((await outside('.ou-menu')).length === 0, 'folder item menu inside the screen');
    await pick(L['home.moveOut']);
    await esc();
    h = await home();
    ok(h[0][saIdx]?.id === 'sa' && h[0].some((x) => x.id === 'sb') && !flat(h).includes(nf.id), 'moving one of two items out turns the folder back into an icon');
  }
  await rightClick('#home .tile[data-id="f1"]');
  const f1Idx = (await home())[0].findIndex((x) => x.id === 'f1');
  await pick(L['home.ungroup']);
  h = await home();
  ok(!flat(h).includes('f1') && h[0][f1Idx]?.id === 'sc' && h[0][f1Idx + 1]?.id === 'sd', 'Ungroup puts the items where the folder was');

  // ——— 8. edit mode ———
  const pagesBefore = (await home()).length;
  pt = await emptyPoint();
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(350);
  await pick(L['home.edit']);
  ok(await page.evaluate(() => document.body.classList.contains('home-edit')), 'Edit Home screen from the menu');
  ok(await visible('#home .edit-bar') && (await outside('#home .edit-bar')).length === 0, 'edit bar shown inside the screen');
  ok(await count('#home .edit-bar .edit-btn') === 4 && await visible('#home .edit-bar .edit-done'), 'edit bar: wallpaper and style, themes, widgets, settings, Done');
  ok(JSON.stringify(await texts('#home .edit-bar .edit-btn')) === JSON.stringify([L['home.wallpaperStyle'], L['home.themes'], L['home.widgets'], L['home.settings']]), 'edit bar labels in One UI\'s order');
  ok(await visible('#home .edit-top .et-undo') && await visible('#home .edit-top .et-pages'), 'Undo/Redo and Pages on top while editing');
  ok(await page.evaluate(() => document.querySelector('#home .edit-top .et-undo').disabled && document.querySelector('#home .edit-top .et-redo').disabled), 'nothing to undo yet');
  ok(await count('#home .page:not(.add-page) .page-tools .pt-home') === pagesBefore && await count('#home .page-tools .pt-home.on') === 1, 'every page has a Main page button, one of them on');
  ok(await exists('#home .page.add-page .add-page-btn') && await count('#home .page-dots .dot') === pagesBefore + 1, 'an Add page page and dot appear');
  ok(!(await visible('#home .dock .dock-inner')) || await page.evaluate(() => getComputedStyle(document.querySelector('#home .dock')).opacity === '0'), 'dock hides while editing');
  await shot(P + 'home-08-edit');
  await page.click('#home .page-dots .dot.plus'); await sleep(500);
  await page.click('#home .add-page-btn'); await sleep(500);
  ok(await count('#home .pages-track > .page:not(.add-page)') === pagesBefore + 1 && await activeDot() === pagesBefore, 'Add page adds an empty page and shows it');
  // Add website from the menu while editing
  pt = await emptyPoint();
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(350);
  await pick(L['home.addSite']);
  ok(await text('.ou-dialog-title') === L['home.addSite'], 'edit mode: Add website from the menu');
  await typeInto('.ou-dialog input.ou-input', 'https://kilo.example.net');
  await primary();
  h = await home();
  ok(h.flat().some((x) => x.url === 'https://kilo.example.net' && x.title === 'Example'), 'the site is added, named after the domain');
  await page.click('#home .edit-bar .edit-done'); await sleep(500);
  ok(!(await page.evaluate(() => document.body.classList.contains('home-edit'))), 'Done leaves edit mode');
  ok((await home()).every((p, i) => p.length || i === 0) && (await count('#home .page.add-page')) === 0, 'empty pages are dropped when editing ends');
  // long press on empty space, Esc to leave
  await page.click('#home .page-dots .dot:first-child'); await sleep(400);
  pt = await emptyPoint();
  await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await sleep(800); await page.mouse.up(); await sleep(300);
  ok(await page.evaluate(() => document.body.classList.contains('home-edit')), 'long press on empty space starts edit mode');
  await page.evaluate(() => document.activeElement?.blur());
  await esc();
  ok(!(await page.evaluate(() => document.body.classList.contains('home-edit'))), 'Esc leaves edit mode');

  // ——— 9. widget picker: add, resize, remove + Undo ———
  const allBefore = flat(await home());
  pt = await emptyPoint();
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(350);
  await pick(L['home.edit']);
  await page.evaluate(() => document.querySelectorAll('#home .edit-bar .edit-btn')[2].click()); await sleep(700);
  ok(await visible('.ou-dialog.widget-picker'), 'widget picker opens from the edit bar');
  const want = await page.evaluate(() => import('./js/core/widgets.js').then((m) => m.getWidgets().reduce((n, w) => n + w.sizes.length, 0)));
  ok(await count('.widget-picker .wpick-item') === want, `picker shows every widget in every size (${want})`);
  ok((await outside('.ou-dialog.widget-picker')).length === 0, 'widget picker inside the screen');
  ok(await page.evaluate(() => document.querySelector('.widget-picker .wpick').scrollTop === 0 && !document.activeElement?.closest('.wpick-preview')), 'picker opens at the top, focus not inside a preview');
  ok(await page.evaluate(() => [...document.querySelectorAll('.widget-picker .wpick-preview .wg')].every((w) => w.childElementCount > 0)), 'every preview rendered');
  const wgroups = await texts('.widget-picker .wpick-title');
  const wsorted = await page.evaluate((g) => import('./js/core/i18n.js').then((m) => [...g].sort((a, b) => a.localeCompare(b, m.locale(), { sensitivity: 'base' }))), wgroups);
  ok(wgroups.length > 10 && JSON.stringify(wgroups) === JSON.stringify(wsorted), `widget groups in A–Z order of their app names (${wgroups.slice(0, 4).join(', ')}…)`);
  await shot(P + 'home-09-picker');
  const remName = await page.evaluate(() => Promise.all([import('./js/core/widgets.js'), import('./js/core/i18n.js')]).then(([w, i]) => i.tr(w.getWidget('reminder').name)));
  const clicked = await page.evaluate((n) => {
    const b = [...document.querySelectorAll('.widget-picker .wpick-item.ws-m')].find((x) => x.title === n);
    b?.click();
    return !!b;
  }, remName);
  await sleep(700);
  ok(clicked && !(await dialogOpen()), 'picking Reminder (medium) closes the picker');
  await page.click('#home .edit-bar .edit-done'); await sleep(500);
  h = await home();
  const rw = h.flat().find((x) => x.type === 'widget' && x.widget === 'reminder');
  ok(!!rw && rw.size === 'm' && h[0].some((x) => x.id === rw.id), 'reminder widget saved on the current page, medium');
  ok(allBefore.every((id) => flat(h).includes(id)), 'adding a widget loses no item');
  const rsel = `#home .tile[data-id="${rw?.id}"]`;
  ok(await exists(rsel + '.ws-m'), 'widget tile rendered medium');
  await goTo(rw?.id);
  await rightClick(rsel);
  const wl = await menuLabels();
  ok(JSON.stringify(wl) === JSON.stringify([L['home.size.s'], L['home.size.m'], L['home.size.l'], L['common.open'], L['common.remove']]), 'widget menu lists its sizes, open, remove');
  ok(await page.evaluate(() => [...document.querySelectorAll('.ou-menu .ou-menu-item')].findIndex((b) => b.querySelector('.ou-menu-check')) === 1), 'current size is checked');
  await pick(L['home.size.l']);
  h = await home();
  ok(find(h, rw?.id)?.size === 'l', 'resize to large saved');
  ok(await exists(rsel + '.ws-l') && (await page.evaluate((s) => document.querySelector(s).style.gridArea.replace(/\s/g, ''), rsel)).endsWith('span4/span4'), 'large widget spans 4×4');
  ok(allBefore.every((id) => flat(h).includes(id)), 'items pushed by the bigger widget move on, none lost');
  await page.click('#home .page-dots .dot:first-child'); await sleep(400);
  ok((await outside('#home .pages-track > .page:first-child .tile')).length === 0, 'page 1 still fits on screen after the resize');
  await goTo(rw?.id);
  await shot(P + 'home-10-widget-large');
  await rightClick(rsel);
  await pick(L['home.size.s']);
  ok(find(await home(), rw?.id)?.size === 's' && await exists(rsel + '.ws-s'), 'resize to small');
  await goTo(rw?.id);
  await rightClick(rsel);
  await pick(L['common.remove']);
  ok(!flat(await home()).includes(rw?.id) && !(await exists(rsel)), 'widget removed');
  await page.click('.ou-toast .ou-toast-action'); await sleep(500);
  ok(flat(await home()).includes(rw?.id), 'Undo brings the widget back');
  await goTo(rw?.id);
  await rightClick(rsel);
  await pick(L['common.remove']);
  ok(!flat(await home()).includes(rw?.id), 'removed again');

  // ——— 10. dock ——— (the Undo toast sits over the dock until it times out)
  await page.waitForFunction(() => !document.querySelector('.ou-toast'), { timeout: 6000 }).catch(() => {});
  await rightClick('#home .dock .tile[data-id="d2"]');
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['common.open'], L['home.addToEdge'], L['common.remove']]), 'dock app menu ' + JSON.stringify(await menuLabels()));
  ok((await outside('.ou-menu')).length === 0, 'dock menu inside the screen');
  await esc();
  await page.click('#home .dock .tile[data-id="d1"]'); await sleep(900);
  ok(await page.evaluate(() => document.querySelector('.app-win')?.getAttribute('aria-label')) === await mod('./js/core/apps.js', 'appName', 'calendar'), 'dock icon opens its app');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))); await sleep(300);
  await goTo('sd');
  const last = await center('#home .dock .tile:last-child');
  await dragTo('#home .tile[data-id="sd"] .app-icon', { x: rtl ? last.l - 18 : last.r + 18, y: last.y }, 600);
  const d = await dock();
  ok(d.length === 5 && d[4]?.id === 'sd', 'dragging a site into the dock adds it at the end ' + JSON.stringify(d.map((x) => x.id)));
  ok(!(await home()).flat().some((x) => x.id === 'sd'), 'and takes it off the page');
  ok(await exists('#home .dock .tile[data-id="sd"]'), 'dock shows it');
  await shot(P + 'home-11-dock');

  // ——— 11. a change made in another tab shows up ———
  h = await home();
  h[0].push(site('zz', 'Zulu', 'zulu'));
  await setStorage({ home: h });
  await sleep(700);
  ok(await exists('#home .tile[data-id="zz"]'), 'layout written by another tab is rendered');

  // ——— 12. Themes: icon styles ———
  const editing = () => page.evaluate(() => document.body.classList.contains('home-edit'));
  const editOn = async () => { await mod('./js/shell/home.js', 'setEditing', true); await sleep(450); };
  const editOff = async () => { await mod('./js/shell/home.js', 'setEditing', false); await sleep(450); };
  const setS = async (k, v) => { await mod('./js/core/store.js', 'setSetting', k, v); await sleep(250); };
  const getS = async (k) => ((await store('settings')) || {})[k];
  const ctrl = async (key, shift = false) => {
    await page.keyboard.down('Control'); if (shift) await page.keyboard.down('Shift');
    await page.keyboard.press(key);
    if (shift) await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(500);
  };
  const realPage = (i) => `#home .pages-track > .page:not(.add-page):nth-child(${i + 2})`; // the Now Brief page comes first
  await editOn();
  await page.evaluate(() => document.querySelectorAll('#home .edit-bar .edit-btn')[1].click()); await sleep(500);
  ok(await visible('.ou-dialog.home-themes') && await count('.home-themes .ic-style') === 4, 'Themes: four icon styles');
  ok(await exists('.home-themes .ic-style.on[data-style="default"]'), 'Themes: Default is selected');
  ok((await outside('.ou-dialog.home-themes')).length === 0, 'Themes sheet inside the screen');
  await page.click('.home-themes .ic-style[data-style="themed"]'); await sleep(350);
  ok(await getS('iconStyle') === 'themed' && await page.evaluate(() => document.body.dataset.iconStyle) === 'themed', 'Themed icons applied at once');
  ok(await page.evaluate(() => {
    const bg = (s) => getComputedStyle(document.querySelector(s)).backgroundImage;
    return bg('.ic-style[data-style="default"] .app-icon') !== 'none' && bg('.ic-style[data-style="themed"] .app-icon') === 'none';
  }), 'each preview keeps its own style');
  await shot(P + 'home-12-themes');
  await page.click('.home-themes .ic-style[data-style="glass"]'); await sleep(350);
  ok(await getS('iconStyle') === 'glass' && await exists('.home-themes .ic-style.on[data-style="glass"]'), 'Clear style picked');
  await primary();
  await shot(P + 'home-13-glass');
  await setS('iconStyle', 'default');

  // ——— 13. Undo / Redo while editing ———
  await mod('./js/shell/home.js', 'goPage', 0, true); await sleep(300);
  await rightClick('#home .tile[data-id="an"]');
  await pick(L['common.remove']);
  ok(!flat(await home()).includes('an'), 'edit mode: an item removed');
  ok(!(await page.evaluate(() => document.querySelector('#home .et-undo').disabled)), 'Undo is available');
  await page.evaluate(() => document.activeElement?.blur());
  await ctrl('KeyZ');
  ok(flat(await home()).includes('an') && await exists('#home .tile[data-id="an"]'), 'Ctrl+Z puts it back');
  ok(!(await page.evaluate(() => document.querySelector('#home .et-redo').disabled)), 'Redo is available');
  await ctrl('KeyZ', true);
  ok(!flat(await home()).includes('an'), 'Ctrl+Shift+Z removes it again');
  await page.click('#home .edit-top .et-undo'); await sleep(500);
  ok(flat(await home()).includes('an'), 'the Undo button works too');
  await editOff(); await editOn();
  ok(await page.evaluate(() => document.querySelector('#home .et-undo').disabled), 'leaving edit mode forgets the history');

  // ——— 14. Main page, remove a page ———
  ok((await home()).length >= 2, 'several pages to work with');
  await mod('./js/shell/home.js', 'goPage', 1, true); await sleep(300);
  await page.evaluate((s) => document.querySelector(s + ' .pt-home').click(), realPage(1)); await sleep(350);
  ok(await getS('homeMainPage') === 1 && await count('#home .page-tools .pt-home.on') === 1 && await exists(realPage(1) + ' .pt-home.on'), 'page 2 is the main page');
  await shot(P + 'home-14-edit-tools');
  await editOff();
  await reload();
  ok(await activeDot() === 1 && await shown(1), 'a new tab opens on the main page');
  await editOn();
  let hh = await home();
  const lastIdx = hh.length - 1, lastIds = hh[lastIdx].map((x) => x.id);
  await mod('./js/shell/home.js', 'goPage', lastIdx, true); await sleep(300);
  await page.evaluate((s) => document.querySelector(s + ' .pt-del').click(), realPage(lastIdx)); await sleep(450);
  ok(await dialogOpen() && await exists('.ou-dialog .ou-dialog-btn.danger'), 'removing a page with items asks first');
  await page.click('.ou-dialog .ou-dialog-btn.danger'); await sleep(500);
  hh = await home();
  ok(hh.length === lastIdx && !lastIds.some((id) => flat(hh).includes(id)), 'the page goes with its items');
  await ctrl('KeyZ');
  hh = await home();
  ok(hh.length === lastIdx + 1 && lastIds.every((id) => flat(hh).includes(id)), 'Ctrl+Z brings the page back');
  await setS('homeMainPage', 0);

  // ——— 15. the page manager ———
  await page.click('#home .edit-top .et-pages'); await sleep(500);
  const nPages = (await home()).length;
  ok(await visible('#home .pm-view') && await count('.pm-view .pm-page:not(.pm-left):not(.pm-add)') === nPages, `page manager: a thumbnail per page (${nPages})`);
  ok(await exists('.pm-view .pm-left .ou-switch') && await exists('.pm-view .pm-add-btn'), 'page manager: the Now Brief page with its switch, and +');
  ok(await exists('.pm-view .pm-page.main[data-i="0"] .pm-home.on'), 'page manager: the main page is marked');
  ok(await count('.pm-view .pm-thumb .tile[data-id]') === 0 && await count('.pm-view .pm-thumb .tile') > 0, 'thumbnails are pictures of the pages');
  ok((await outside('.pm-view .pm-bar')).length === 0 && (await outside('.pm-view .pm-page[data-i="0"]')).length === 0, 'page manager inside the screen');
  await shot(P + 'home-15-pages');
  const order0 = (await home()).map((p) => p.map((x) => x.id).join());
  const t1 = await center('.pm-view .pm-page[data-i="0"] .pm-thumb'), t2 = await center('.pm-view .pm-page[data-i="1"] .pm-thumb');
  await page.mouse.move(t1.x, t1.y); await page.mouse.down();
  await page.mouse.move(t1.x + (rtl ? -10 : 10), t1.y, { steps: 2 });
  await page.mouse.move(t2.x + (rtl ? -1 : 1) * t2.w * 0.35, t2.y, { steps: 14 }); await sleep(300);
  await page.mouse.up(); await sleep(600);
  const order1 = (await home()).map((p) => p.map((x) => x.id).join());
  ok(order1[0] === order0[1] && order1[1] === order0[0] && order1.length === order0.length, 'dragging a thumbnail after the next one swaps the pages');
  ok(await getS('homeMainPage') === 1, 'the main page moves with its page');
  await page.click('.pm-view .pm-add-btn'); await sleep(450);
  ok((await home()).length === nPages + 1 && await count('.pm-view .pm-page:not(.pm-left):not(.pm-add)') === nPages + 1, 'page manager: + adds a page');
  await page.click('.pm-view .pm-page[data-i="1"] .pm-thumb'); await sleep(600);
  ok(!(await exists('#home .pm-view')) && await activeDot() === 1, 'a click on a thumbnail goes to that page');
  await page.click('#home .edit-top .et-pages'); await sleep(450);
  await esc();
  ok(!(await exists('#home .pm-view')) && await editing(), 'Esc closes the page manager and keeps editing');
  await editOff();
  ok((await home()).every((p, i) => p.length || i === 0), 'the empty page goes when editing ends');
  await setS('homeMainPage', 0);

  // ——— 16. the Now Brief page ———
  const left0 = await store('homeLeft');
  ok(Array.isArray(left0) && left0.length >= 3 && left0.every((x) => x.type === 'widget'), `layouts from before get the starter Now Brief widgets (${left0?.length})`);
  await mod('./js/shell/home.js', 'goPage', -1); await sleep(650);
  ok(await leftShown() && await count('#home .lp-grid > .widget-tile') === left0.length, 'the Now Brief page shows its widgets');
  ok(await visible('#home .lp-title h1') && (await text('#home .lp-title h1')).length > 3, 'greeting and date on top');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#home .dock')).opacity === '0'), 'the dock steps aside');
  ok((await outside('#home .lp-grid > .widget-tile', '#home .pages-viewport')).length === 0 || await page.evaluate(() => document.querySelector('#home .lp-scroll').scrollHeight > document.querySelector('#home .lp-scroll').clientHeight), 'widgets fit or the column scrolls');
  await shot(P + 'home-16-now-brief');
  await page.evaluate(() => document.querySelector('#home .lp-scroll').dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true })));
  await sleep(500);
  ok(!(await exists('#drawer.show')), 'scrolling the Now Brief page does not open the Apps screen');
  const lw = left0[0].id;
  await page.evaluate(() => document.querySelector('#home .lp-scroll').scrollTo(0, 0));
  await rightClick(`#home .lp-grid .tile[data-id="${lw}"]`);
  ok((await menuLabels()).includes(L['common.remove']), 'widget menu on the Now Brief page');
  await pick(L['common.remove']);
  ok(!(await store('homeLeft')).some((x) => x.id === lw), 'a widget removed from the Now Brief page');
  await page.click('.ou-toast .ou-toast-action'); await sleep(500);
  ok((await store('homeLeft'))[0]?.id === lw, 'Undo puts it back on top');
  const id2 = (await store('homeLeft'))[1].id;
  const a2 = await center('#home .lp-grid > .tile:nth-child(2)'), a1 = await center('#home .lp-grid > .tile:nth-child(1)');
  const sx = rtl ? a2.r - 3 : a2.l + 3, sy = a2.t + 3;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 8, { steps: 3 }); await sleep(120);
  await page.mouse.move(rtl ? a1.r - 24 : a1.l + 24, a1.t + 16, { steps: 14 }); await sleep(500);
  await page.mouse.move(rtl ? a1.r - 25 : a1.l + 25, a1.t + 17); await sleep(450);
  await page.mouse.up(); await sleep(700);
  ok((await store('homeLeft'))[0]?.id === id2 && (await store('homeLeft')).length === left0.length, 'dragging a widget to the top of the column moves it there');
  await editOn();
  ok(await exists('#home .lp-switch .ou-switch') && await text('#home .lp-foot .lp-btn') === await t('home.addWidget'), 'edit mode: the Now Brief switch and Add widget');
  await page.click('#home .lp-foot .lp-btn'); await sleep(700);
  ok(await visible('.ou-dialog.widget-picker') && await text('.ou-dialog.widget-picker .ou-dialog-title') === await t('home.widgetsBrief'), 'Add widget opens the picker for Now Brief');
  await page.evaluate(() => [...document.querySelectorAll('.widget-picker .wpick-item.ws-s')].find((x) => x.querySelector('.wg')?.closest('.wpick-group') && x.title)?.click());
  await sleep(700);
  const left1 = await store('homeLeft');
  ok(left1.length === left0.length + 1 && left1[0].type === 'widget', 'the picked widget goes on top of the Now Brief page');
  await shot(P + 'home-17-now-brief-edit');
  await page.click('#home .lp-switch .ou-switch'); await sleep(400);
  ok(await getS('leftPage') === false && await exists('#home .left-page.off'), 'the switch turns the page off');
  await editOff();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(prev); await sleep(450);
  ok(!(await leftShown()) && await activeDot() === 0 && !(await visible('#home .left-dot')), 'turned off: nothing before page 1');
  await setS('leftPage', true);
  ok(await visible('#home .left-dot'), 'turned on again');

  // ——— 17. a link dropped from Chrome ———
  await mod('./js/shell/home.js', 'goPage', 0, true); await sleep(300);
  const hint = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', 'https://drop.example.dev/path');
    dt.setData('text/html', '<a href="https://drop.example.dev/path">Dropped Link</a>');
    const home = document.getElementById('home');
    for (const type of ['dragenter', 'dragover']) home.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    const on = home.classList.contains('link-drop');
    home.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return on && !home.classList.contains('link-drop');
  });
  await sleep(450);
  ok(hint, 'a link dragged over the Home screen shows the drop area');
  const dl = (await home()).flat().find((x) => x.url === 'https://drop.example.dev/path');
  ok(dl?.title === 'Dropped Link', 'the dropped link becomes a site named after the link text ' + JSON.stringify(dl || null));

  // ——— 18. Lock Home screen layout ———
  await setS('homeLocked', true);
  await goTo('sc');
  await rightClick('#home .tile[data-id="sc"]');
  ok(!(await menuLabels()).includes(L['common.remove']) && (await menuLabels()).length >= 2, 'locked: no Remove in the menu');
  await esc();
  const h18 = JSON.stringify(await home());
  const scTarget = await center('#home .dock .tile:first-child .app-icon');
  await dragTo('#home .tile[data-id="sc"] .app-icon', scTarget, 500);
  ok(JSON.stringify(await home()) === h18, 'locked: dragging moves nothing');
  ok((await page.evaluate(() => document.querySelector('.ou-toast')?.textContent || '')).includes(await t('home.lockedToast')), 'locked: a toast says so');
  await setS('homeLocked', false);

  // ——— 19. app icon badges ———
  await page.waitForFunction(() => !document.querySelector('.ou-toast'), { timeout: 6000 }).catch(() => {});
  await goTo('ac');
  await mod('./js/core/notify.js', 'notify', { app: 'calculator', title: 'Badge test', body: 'One unread' }); await sleep(600);
  ok(await text('#home .tile[data-id="ac"] .app-badge') === '1', 'an unread notification puts 1 on the app icon');
  await page.evaluate(() => import('./js/core/activity.js').then((m) => m.setBadge('notes', 5))); await sleep(400);
  await goTo('an');
  ok(await text('#home .tile[data-id="an"] .app-badge') === '5', 'setBadge(app, n) shows its count');
  await shot(P + 'home-18-badges');
  await setS('badges', 'dot');
  ok(await exists('#home .tile[data-id="an"] .app-badge.dot') && await text('#home .tile[data-id="an"] .app-badge') === '', 'Show without number: a dot');
  await setS('badges', 'off');
  ok(!(await exists('#home .app-badge')), 'badges off');
  await setS('badges', 'number');
  await mod('./js/shell/drawer.js', 'openDrawer'); await sleep(600);
  ok(await page.evaluate(() => [...document.querySelectorAll('#drawer .tile')].some((x) => x.dataset.key === 'app:calculator' && x.querySelector('.app-badge')?.textContent === '1')), 'the Apps screen shows badges too');
  await mod('./js/shell/drawer.js', 'closeDrawer', true); await sleep(300);
  await page.evaluate(() => import('./js/core/activity.js').then((m) => m.setBadge('notes', 0))); await sleep(200);

  // ——— 20. Show Apps screen button ———
  ok((await dock()).some((x) => x.app === 'drawer'), 'the Apps button is in the dock');
  await setS('appsButton', false); await sleep(300);
  ok(!(await dock()).some((x) => x.app === 'drawer') && !(await exists('#home .dock .tile[data-id="d4"]')), 'Show Apps screen button off: it goes');
  await setS('appsButton', true); await sleep(300);
  const d20 = await dock();
  ok(d20[d20.length - 1]?.app === 'drawer', 'on again: back at the end of the dock');

  // ——— 21. a widget's settings step (configure) ———
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => m.registerWidget({
    id: 'test-config', name: { en: 'Config test', ar: 'اختبار الإعداد' }, sizes: ['s'],
    configure: async (config, { isNew }) => (window.__cancelConf ? null : { ...config, n: (config.n || 0) + 1, isNew }),
    render(el, { config }) { el.textContent = 'n=' + (config.n || 0); },
  })));
  await mod('./js/shell/home.js', 'goPage', 0, true); await sleep(300);
  await page.evaluate(() => (window.__cancelConf = true));
  await mod('./js/shell/home.js', 'addWidget', 'test-config', 's'); await sleep(300);
  ok(!(await home()).flat().some((x) => x.widget === 'test-config'), 'a cancelled settings step adds nothing');
  await page.evaluate(() => (window.__cancelConf = false));
  await mod('./js/shell/home.js', 'openWidgetPicker'); await sleep(700);
  ok((await page.evaluate(() => [...document.querySelectorAll('.widget-picker .wpick-item')].find((x) => /Config test|اختبار الإعداد/.test(x.title))?.textContent || '')).includes(await t('home.configurable')), 'the picker says the widget can be customized');
  await page.evaluate(() => [...document.querySelectorAll('.widget-picker .wpick-item')].find((x) => /Config test|اختبار الإعداد/.test(x.title))?.click()); await sleep(700);
  const tw = (await home()).flat().find((x) => x.widget === 'test-config');
  ok(tw?.config?.n === 1 && tw.config.isNew === true, 'the picker runs the settings step before adding it ' + JSON.stringify(tw?.config || null));
  ok(await text(`#home .tile[data-id="${tw?.id}"] .wg`) === 'n=1', 'the widget draws with its config');
  await goTo(tw?.id);
  await rightClick(`#home .tile[data-id="${tw?.id}"]`);
  ok((await menuLabels()).includes(await t('home.widgetSettings')), 'its menu offers Widget settings');
  await pick(await t('home.widgetSettings'));
  ok((await home()).flat().find((x) => x.id === tw?.id)?.config?.n === 2 && await text(`#home .tile[data-id="${tw?.id}"] .wg`) === 'n=2', 'Widget settings saves the new config and redraws');
  await rightClick(`#home .tile[data-id="${tw?.id}"]`);
  await pick(L['common.remove']);

  // ——— 22. pinch (Ctrl + wheel) ———
  const pinch = (dy) => page.evaluate((dy) => document.querySelector('#home .pages-viewport').dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true })), dy);
  await pinch(60); await sleep(500);
  ok(await editing(), 'pinching in starts edit mode');
  await sleep(500);
  await pinch(-60); await sleep(500);
  ok(!(await editing()), 'spreading the fingers ends it');

  // ——— 23. removeSite (Galaxy Store's Uninstall) ———
  ok(flat(await home()).includes('sa'), 'Alpha is on the Home screen');
  await page.evaluate(() => import('./js/shell/home.js').then((m) => { window.__undoSite = m.removeSite('alpha.example.com'); }));
  await sleep(350);
  ok(!(await home()).flat().some((x) => /alpha\.example/.test(x.url || '')) && !(await exists('#home .tile[data-id="sa"]')), 'removeSite(host) takes the site off the Home screen');
  await page.evaluate(() => window.__undoSite()); await sleep(350);
  ok(flat(await home()).includes('sa'), 'and its undo puts it back');

  // ——— 24. the Apps screen: Sort, Custom order, folders ———
  await mod('./js/shell/drawer.js', 'openDrawer'); await sleep(600);
  const coll = new Intl.Collator(ui, { sensitivity: 'base' });
  const dLabels = async () => texts('#drawer .drawer-grid > .tile > .tile-label');
  const az = await dLabels();
  ok(JSON.stringify([...az].sort(coll.compare)) === JSON.stringify(az), 'Apps screen: Alphabetical order by default');
  await page.click('#drawer .drawer-more'); await sleep(350);
  ok(JSON.stringify(await menuLabels()) === JSON.stringify([L['home.addSite'], await t('drawer.createFolder'), await t('drawer.sort'), await t('common.settings')]), 'Apps screen ⋮: Add website, Create folder, Sort, Settings');
  await pick(await t('drawer.sort'));
  ok(await count('.ou-dialog .ou-radio-row') === 2, 'Sort: Alphabetical or Custom order');
  await page.evaluate(() => document.querySelectorAll('.ou-dialog .ou-radio-row')[1].click()); await sleep(150);
  await primary();
  ok(await getS('appsSort') === 'custom' && ((await store('drawerLayout'))?.order || []).length === az.length, 'Custom order starts from what was on screen');
  const keys = () => page.evaluate(() => [...document.querySelectorAll('#drawer .drawer-grid > .tile')].map((x) => x.dataset.key));
  const k0 = await keys();
  const c3 = await center('#drawer .drawer-grid > .tile:nth-child(3)'), c1 = await center('#drawer .drawer-grid > .tile:nth-child(1)');
  await page.mouse.move(c3.x, c3.b - 10); await page.mouse.down();
  await page.mouse.move(c3.x + 14, c3.b - 6, { steps: 3 });
  await page.mouse.move(rtl ? c1.r - 4 : c1.l + 4, c1.y, { steps: 14 }); await sleep(350);
  await page.mouse.up(); await sleep(600);
  const k1 = await keys();
  ok(k1[0] === k0[2] && (await store('drawerLayout')).order[0] === k0[2], 'Custom order: dragging moves the icon');
  const f1 = await center('#drawer .drawer-grid > .tile:nth-child(1) .app-icon'), f2 = await center('#drawer .drawer-grid > .tile:nth-child(2)');
  await page.mouse.move(f2.x, f2.b - 10); await page.mouse.down();
  await page.mouse.move(f2.x + 14, f2.b - 6, { steps: 3 });
  await page.mouse.move(f1.x, f1.y, { steps: 12 }); await sleep(800);
  await page.mouse.move(f1.x + 1, f1.y + 1); await sleep(150);
  await page.mouse.up(); await sleep(600);
  let dlay = await store('drawerLayout');
  ok(dlay.folders.length === 1 && dlay.folders[0].items.join() === [k1[0], k1[1]].join() && dlay.order[0] === 'folder:' + dlay.folders[0].id, 'dropping an icon on another makes a folder where it was ' + JSON.stringify(dlay.folders));
  ok(await exists('#drawer .drawer-grid > .tile.t-folder:first-child'), 'the folder shows first');
  await page.click('#drawer .drawer-grid > .tile.t-folder'); await sleep(500);
  ok(await visible('#drawer .folder-panel') && await count('#drawer .folder-panel .folder-items .tile') === 2, 'the folder opens with its two icons');
  ok((await outside('#drawer .folder-panel')).length === 0, 'folder inside the screen');
  await typeInto('#drawer .folder-panel .folder-title', rtl ? 'أدوات' : 'Tools');
  await page.keyboard.press('Enter'); await sleep(300);
  ok((await store('drawerLayout')).folders[0]?.title === (rtl ? 'أدوات' : 'Tools'), 'renaming the folder in place');
  await shot(P + 'home-19-apps-folder');
  const fi = await center('#drawer .folder-panel .folder-items .tile:last-child');
  await page.mouse.click(fi.x, fi.y, { button: 'right' }); await sleep(350);
  ok((await menuLabels()).includes(await t('drawer.removeFromFolder')), 'folder item menu: Remove from folder');
  await pick(await t('drawer.removeFromFolder'));
  dlay = await store('drawerLayout');
  ok(dlay.folders.length === 0 && !(await exists('#drawer .folder-panel')) && (await keys()).slice(0, 2).join() === [k1[0], k1[1]].join(), 'a folder left with one icon becomes that icon');
  await page.click('#drawer .drawer-more'); await sleep(350);
  await pick(await t('drawer.createFolder'));
  ok(await visible('.ou-dialog .dw-pick') && await count('.ou-dialog .dw-pick .edge-pick-item') >= 10, 'Create folder: pick apps');
  await page.evaluate(() => [...document.querySelectorAll('.ou-dialog .dw-pick .edge-pick-item')].slice(3, 6).forEach((b) => b.click()));
  await typeInto('.ou-dialog .ou-dialog-body > input.ou-input', rtl ? 'مفضلة' : 'Picks');
  await primary();
  dlay = await store('drawerLayout');
  ok(dlay.folders.length === 1 && dlay.folders[0].items.length === 3 && dlay.folders[0].title === (rtl ? 'مفضلة' : 'Picks'), 'Create folder makes a named folder of the picked icons');
  ok(!dlay.folders[0].items.some((k) => k0.includes(k) && false) && !(await keys()).some((k) => dlay.folders[0].items.includes(k)), 'its icons leave the top level');
  await mod('./js/shell/drawer.js', 'setAppsSort', 'az'); await sleep(400);
  const az2 = await dLabels();
  ok(JSON.stringify([...az2].sort(coll.compare)) === JSON.stringify(az2) && await exists('#drawer .drawer-grid > .tile.t-folder'), 'back to Alphabetical order: folders stay, sorted by name');
  await mod('./js/shell/drawer.js', 'closeDrawer', true); await sleep(300);

  // ——— 25. the first-run layout ———
  await boot({});
  const s1 = await home(), d1s = await dock(), l1 = await store('homeLeft');
  const visibleApps = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().filter((a) => !a.hidden).map((a) => a.id)));
  ok(s1.length >= 2, 'first run: two pages');
  ok(s1[0].some((x) => x.widget === 'weather') && s1[0].some((x) => x.widget === 'clock-analog'), 'page 1: weather and clock widgets');
  const gf = s1[0].find((x) => x.type === 'folder' && x.title === 'Google'), sf = s1[0].find((x) => x.type === 'folder' && x.title === 'Samsung');
  ok(gf && gf.items.length >= 4 && gf.items.every((x) => x.type === 'site'), 'page 1: a Google folder of Google sites');
  ok(sf && ['health', 'wallet', 'music', 'games', 'recorder'].every((a) => sf.items.some((x) => x.app === a)), 'page 1: a Samsung folder with the Samsung apps');
  ok(s1[0].filter((x) => x.type === 'site').length >= 6, 'page 1: sites');
  ok(s1[1].length >= 8 && s1[1].every((x) => x.type === 'app'), 'page 2: apps');
  const onHome = new Set([...s1.flat(), ...d1s].flatMap((x) => (x.type === 'folder' ? x.items : [x])).filter((x) => x.type === 'app').map((x) => x.app));
  ok(visibleApps.every((a) => onHome.has(a)), 'every app is somewhere on the Home screen ' + JSON.stringify(visibleApps.filter((a) => !onHome.has(a))));
  ok(d1s.map((x) => x.app).join() === 'notes,calendar,reminder,store,drawer', 'dock: Notes, Calendar, Reminder, Galaxy Store and the Apps button ' + d1s.map((x) => x.app).join());
  ok(Array.isArray(l1) && l1.length >= 4 && l1.some((x) => x.widget === 'now-brief'), 'the Now Brief page starts with widgets');
  const known1 = await store('homeAdded');
  ok(Array.isArray(known1) && visibleApps.every((a) => known1.includes(a)), 'homeAdded remembers every app');
  ok((await outside('#home .pages-track > .page:nth-child(2) .tile, #home .dock .tile')).length === 0, 'first page and dock inside the screen');
  await shot(P + 'home-20-seed');
  await mod('./js/shell/home.js', 'goPage', 1); await sleep(500);
  await shot(P + 'home-21-seed-page2');
  await mod('./js/shell/home.js', 'goPage', -1); await sleep(700);
  await shot(P + 'home-22-seed-now-brief');

  // ——— 26. new apps join an existing layout once ———
  await boot({ data: { home: [[site('o1', 'One', 'one'), { id: 'oa', type: 'app', app: 'notes' }]], dock: [{ id: 'od', type: 'app', app: 'calendar' }] } });
  ok(JSON.stringify((await home()).flat().map((x) => x.id)) === '["o1","oa"]', 'test runs keep a seeded layout as it is');
  await page.evaluate(() => localStorage.setItem('bt.test.homeAdded', '1'));
  await reload();
  const hm = await home();
  const got = hm.flat().filter((x) => x.type === 'app').map((x) => x.app);
  ok(['health', 'wallet', 'music', 'games', 'store', 'contacts'].every((a) => got.includes(a)), 'apps the layout never saw are added ' + JSON.stringify(got));
  ok(!['weather', 'clock', 'calculator', 'settings'].some((a) => got.includes(a)), 'apps it already knew are not');
  ok(hm[0][0]?.id === 'o1' && hm[0][1]?.id === 'oa', 'they go after what was there');
  ok((await store('homeAdded')).includes('games'), 'homeAdded records them');
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.removeWhere((x) => x.type === 'app' && x.app === 'games')));
  await sleep(300);
  await reload();
  ok(!(await home()).flat().some((x) => x.app === 'games'), 'an app removed by hand stays removed');
  await page.evaluate(() => localStorage.removeItem('bt.test.homeAdded'));

  // ——— 27. an empty dock shows no empty pill (but does while editing, as a drop target) ———
  await boot({ data: { home: [[site('o1', 'One', 'one')]], dock: [] } });
  const pillBg = () => page.evaluate(() => getComputedStyle(document.querySelector('#home .dock .dock-inner')).backgroundColor);
  ok(await exists('#home .dock.empty') && (await pillBg()) === 'rgba(0, 0, 0, 0)', 'an empty dock draws no pill');
  await editOn();
  ok((await pillBg()) !== 'rgba(0, 0, 0, 0)', 'in edit mode the empty dock shows where icons can go');
  await editOff();
  await setStorage({ dock: [{ id: 'od', type: 'app', app: 'calendar' }] });
  await sleep(600);
  ok(!(await exists('#home .dock.empty')) && (await pillBg()) !== 'rgba(0, 0, 0, 0)', 'with an icon the dock pill is back');
  await shot(P + 'home-27-dock');

  // ——— 28. home settings have their defaults in DEFAULT_SETTINGS (homePref keeps working) ———
  const hd = await page.evaluate(() => Promise.all([import('./js/core/store.js'), import('./js/shell/home.js')]).then(([s, hm]) =>
    ['homeLocked', 'appsButton', 'addNewApps', 'badges', 'leftPage', 'appsSort', 'homeMainPage'].map((k) => [k, s.DEFAULT_SETTINGS[k], s.setting(k), hm.homePref(k)])));
  ok(hd.every(([, d, v, p]) => d !== undefined && JSON.stringify(d) === JSON.stringify(v) && JSON.stringify(v) === JSON.stringify(p)), 'home settings default in DEFAULT_SETTINGS: ' + hd.map(([k, d]) => k + '=' + JSON.stringify(d)).join(' '));

  // ——— 29. the Home screen pauses while nothing of it shows ———
  await boot({ data: { home: [[{ id: 'wa', type: 'widget', widget: 'clock-analog', size: 's', config: {} }, site('o1', 'One', 'one')]], dock: [] } });
  const hidden = () => page.evaluate(() => document.body.classList.contains('home-hidden') && getComputedStyle(document.querySelector('#home')).contentVisibility === 'hidden');
  const W = (fn, ...a) => page.evaluate((fn, a) => import('./js/core/apps.js').then((m) => m[fn](...a)), fn, a);
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__hh = []; m.onHomeHidden((v) => window.__hh.push(v)); }));
  ok(!(await hidden()), 'nothing covers the Home screen: it draws');
  await W('openApp', 'calculator');
  await sleep(700);
  ok(!(await hidden()), 'a pop-up window over the Home screen leaves it running');
  await W('toggleFullScreen', 'calculator');
  await sleep(150);
  ok(!(await hidden()), 'not while the window is still growing to full screen');
  await sleep(700);
  ok(await hidden(), 'a full-screen window covers it: body.home-hidden skips its rendering');
  await W('toggleFullScreen', 'calculator');
  await sleep(60);
  ok(!(await hidden()), 'back to a pop-up: it draws again right away');
  await W('splitApp', 'calculator', 'l');
  await sleep(900);
  ok(await hidden(), 'split screen covers it too');
  await W('closeAllApps');
  await sleep(500);
  ok(!(await hidden()), 'windows closed: it draws');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(900);
  ok(await hidden(), 'the Lock screen hides it');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(100);
  ok(!(await hidden()), 'unlocking shows it at once');
  await page.evaluate(() => import('./js/shell/dailyboard.js').then((m) => m.openDailyBoard()));
  await sleep(900);
  ok(await hidden(), 'the Daily Board hides it');
  await page.evaluate(() => import('./js/shell/dailyboard.js').then((m) => m.closeDailyBoard()));
  await sleep(100);
  ok(!(await hidden()), 'closing the board shows it');
  const hhLog = await page.evaluate(() => window.__hh);
  ok(JSON.stringify(hhLog) === '[true,false,true,false,true,false,true,false]', 'onHomeHidden() reports every change ' + JSON.stringify(hhLog));
  ok(await page.evaluate(() => { const el = document.querySelector('#home .tile[data-id="wa"]'); return !!el && el.getBoundingClientRect().width > 0 && document.elementFromPoint(el.getBoundingClientRect().x + 20, el.getBoundingClientRect().y + 20)?.closest('.tile') === el; }), 'the clock widget is back on screen');
};
