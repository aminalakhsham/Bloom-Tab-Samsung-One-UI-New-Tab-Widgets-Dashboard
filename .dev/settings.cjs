// triple
// Settings end to end: the root in One UI's order (search field, profile card, clusters), every section opens
// (built-in and registered through core/hooks.js) and fits the window, the search field and Settings search in Finder,
// the profile page, Display (light/dark/auto, brightness, Eye comfort, font size), Accessibility (high contrast,
// transparency, animations), Home screen (grid, labels, search bar, icon size), Wallpaper and style (previews,
// gallery, "Set as wallpaper on", colours, live, dim — more in wallpaper.cjs), Lock screen (clock style/font, widgets,
// lock mode, Lock now), Search, Notifications (app notifications, Do not disturb, history), Apps (a page per app:
// notifications, window size, Add to Home screen), Advanced features (Labs, Keyboard shortcuts), Weather, General
// (language switch to the other language and back, time format, Focus length, Reset), Sync with Chrome (the page;
// the syncing itself is sync.cjs), Backup (export file contents with pictures, import a file, reset everything), About.
// usage: .dev/run.sh .dev/settings.cjs   (THEME=dark / UI=ar too)
const path = require('path'), fs = require('fs');
module.exports = async ({ page, boot, ok, openApp, closeApp, text, texts, count, exists, sleep, shot, P, store, outside, mod, theme, ui, logs, id }) => {
  const OUT = process.env.OUT || path.join(__dirname, 'shots');
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const S = async () => (await store('settings')) || {};
  const depth = () => count('.app-win .app-stack > .app-page');
  const top = '.app-win .app-stack > .app-page:last-child';
  const waitBoot = () => page.waitForFunction(() => window.__bootMs, { timeout: 30000 }).then(() => sleep(700));
  /** Click the row titled `title` on the top page. */
  const row = async (title) => {
    const found = await page.evaluate((sel, t) => {
      const r = [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t);
      r?.click();
      return !!r;
    }, top, title);
    if (!found) ok(false, `row "${title}" exists`);
    await sleep(350);
    return found;
  };
  const rowSub = (title) => page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t)?.querySelector('.ou-row-sub')?.textContent, top, title);
  /** In an open choose() dialog: pick the n-th option (1-based) or the one containing `label`, then Done. */
  const pick = async (which) => {
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 3000 }).catch(() => {});
    const done = await page.evaluate((w) => {
      const rows = [...document.querySelectorAll('.ou-dialog .ou-radio-row')];
      const r = typeof w === 'number' ? rows[w - 1] : rows.find((x) => x.textContent.includes(w));
      r?.click();
      return !!r;
    }, which);
    if (!done) ok(false, `option ${which} exists`);
    ok((await outside('.ou-dialog')).length === 0, `choice dialog inside the screen (${which})`);
    await page.click('.ou-dialog .ou-dialog-btn.primary');
    await sleep(400);
  };
  const back = async () => { await page.click(top + ' .app-back'); await sleep(450); };
  /** Elements of the top page sticking out of the window sideways (ignoring horizontal scrollers). */
  const hOverflow = () => page.evaluate((sel) => {
    const w = document.querySelector('.app-win').getBoundingClientRect();
    const pg = document.querySelector(sel);
    const scroller = (e) => { for (let x = e.parentElement; x && x !== pg; x = x.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(x).overflowX)) return true; return false; };
    return [...pg.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < w.left - 1 || r.right > w.right + 1) && !scroller(e); }).map((e) => e.className || e.tagName).slice(0, 5);
  }, top);

  const NOTES = [{ id: 'n1', title: 'Backup me', body: 'hello', color: '', pinned: false, created: Date.now(), updated: Date.now() }];
  await boot({ data: { home: [[]], dock: [], notes: NOTES } });
  await openApp('settings');
  ok(await exists('.app-win .set-profile'), 'Settings opens with the profile card');

  // ——— the root: search field, profile card, sections in One UI's clusters ———
  ok(await exists('.app-win .set-search input[type=search]'), 'a search field on top');
  const ROOT = await mod('./js/apps/settings.js', 'rootIds');
  const ORDER = ['notifications', 'display', 'wallpaper', 'home', 'lock', 'search', 'weather', 'sync', 'backup', 'advanced', 'apps', 'general', 'accessibility', 'about'];
  ok(ORDER.every((x, i) => ROOT.filter((y) => ORDER.includes(y))[i] === x), 'sections in One UI\'s order: ' + ROOT.join(', '));
  const extra = await page.evaluate(() => import('./js/core/hooks.js').then((m) => (m.getSettingsSections?.() || []).map((s) => ({ id: s.id, title: s.title }))));
  if (extra.length) console.log('registered sections:', extra.map((s) => s.id).join(', '));
  ok((await count(top + ' .set-root .ou-list .ou-row')) === ORDER.length + extra.length, `root lists ${ORDER.length} built-in + ${extra.length} registered sections`);
  ok((await count(top + ' .set-root > .ou-list')) >= 6, 'in rounded clusters');
  await shot(P + 'set-01-root');

  // ——— every section opens ———
  let n = 2;
  for (const g of [...ORDER.map((id) => ({ id, title: 'set.' + id })), ...extra]) {
    const title = await tr(g.title);
    const before = logs.length;
    await row(title);
    await sleep(350);
    ok((await depth()) === 2 && (await text(top + ' .app-toolbar-title')) === title, `section "${g.id}" opens with its title`);
    ok((await page.evaluate((s) => document.querySelector(s + ' .app-body')?.childElementCount || 0, top)) > 0 && !(await exists('.app-error')), `section "${g.id}" has content`);
    let over = await hOverflow();
    if (over.length) { await sleep(600); over = await hOverflow(); } // still sliding in on a busy machine
    ok(over.length === 0, `section "${g.id}" fits the window width ${over.join(' ')}`);
    ok(!logs.slice(before).some((l) => l.includes('pageerror')), `section "${g.id}" no page errors`);
    await shot(P + `set-${String(n++).padStart(2, '0')}-${g.id}`);
    await back();
    ok((await depth()) === 1, `back from "${g.id}"`);
  }

  // ——— the profile card ———
  ok((await text(top + ' .set-profile b')) === (await tr('set.acc.noName')), 'profile card: "Your profile" before a name is set');
  await page.click('.set-profile'); await sleep(450);
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.acc.title')), 'profile card opens the profile page');
  await page.click(top + ' .set-acc-head .ou-btn'); await sleep(350);
  await page.type('.ou-dialog input', 'Amina'); await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(400);
  ok((await S()).profileName === 'Amina' && (await text(top + ' .set-acc-head h2')) === 'Amina' && (await text(top + ' .set-acc-head .set-avatar')) === 'A', 'name saved, avatar shows its first letter');
  await shot(P + 'set-17-profile');
  await row(await tr('set.about'));
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.about')) && ((await text(top + ' .set-about-v')) || '').includes(await page.evaluate(() => chrome.runtime.getManifest().version)), 'About from the profile page shows the manifest version');
  await back(); await back();
  ok((await text(top + ' .set-profile b')) === 'Amina', 'the card shows the name');

  // ——— the search field ———
  const eyeT = await tr('qp.eyeComfort');
  await page.type(top + ' .set-search input', eyeT.slice(0, 6));
  await sleep(1500);
  ok(await page.evaluate((sel) => document.querySelector(sel + ' .set-root').hidden && !document.querySelector(sel + ' .set-results').hidden, top), 'typing replaces the sections with results');
  const hits = await texts(top + ' .set-results .ou-row-title');
  ok(hits.includes(eyeT), `results include "${eyeT}" (${hits.length} results)`);
  await shot(P + 'set-18-search');
  await page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .set-results .ou-row')].find((r) => r.querySelector('.ou-row-title')?.textContent === t)?.click(), top, eyeT);
  await sleep(700);
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.display')) && await exists(top + ' .finder-found'), 'a result opens its page and flashes the row');
  await back();
  await page.focus(top + ' .set-search input'); await page.keyboard.press('Escape'); await sleep(500);
  ok((await page.$eval(top + ' .set-search input', (i) => i.value)) === '' && !(await page.evaluate((sel) => document.querySelector(sel + ' .set-root').hidden, top)), 'Esc clears the field and brings the sections back');
  ok((await depth()) === 1 && await exists('.app-win'), '…without closing Settings');

  // ——— Settings in Finder (app search) and opening a section by params ———
  const dispTitle = await tr('set.display');
  const found = await page.evaluate((q) => import('./js/core/apps.js').then((m) => {
    const r = m.getApp('settings').search(q);
    r.find((x) => x.title === q)?.onOpen();
    return r.map((x) => x.title);
  }), dispTitle);
  await sleep(500);
  ok(found.includes(dispTitle), 'Settings search finds the Display section');
  ok((await depth()) === 2 && (await text(top + ' .app-toolbar-title')) === dispTitle, 'search result opens Display');
  await openApp('settings', { page: 'lock' }); await sleep(500);
  ok((await depth()) === 2 && (await text(top + ' .app-toolbar-title')) === (await tr('set.lock')), 'opening Settings with {page} while open jumps to that section');
  await back();

  // ——— Display ———
  await row(dispTitle);
  await page.click(top + ' .set-mode.dark'); await sleep(350);
  ok((await S()).theme === 'dark' && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && await exists(top + ' .set-mode.dark.active'), 'Dark mode: settings.theme and html[data-theme=dark]');
  await shot(P + 'set-20-display-dark');
  await page.click(top + ' .set-mode.light'); await sleep(350);
  ok((await S()).theme === 'light' && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'Light mode');
  await row(await tr('set.autoDark'));
  ok((await S()).theme === 'auto', '"Follow system" switch sets theme auto');
  await row(await tr('set.autoDark'));
  ok(['light', 'dark'].includes((await S()).theme), 'switching it off keeps the current look');
  await page.click(top + ` .set-mode.${theme}`); await sleep(300);
  ok((await S()).theme === theme, 'back to this run\'s theme');
  await page.focus(top + ' .set-slider');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await sleep(200);
  ok((await S()).brightness === 90 && (await text(top + ' .set-slider-val')) === '90%', 'brightness slider (keys) saves 90%');
  ok(+(await page.evaluate(() => getComputedStyle(document.getElementById('dim-filter')).opacity)) > 0.05, 'brightness dims the screen filter');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await sleep(200);
  ok((await S()).brightness === 100, 'brightness back to 100%');
  await row(await tr('qp.eyeComfort'));
  ok((await S()).eyeComfort === true && +(await page.evaluate(() => document.getElementById('eye-filter').style.opacity)) > 0, 'Eye comfort shield on: warm filter');
  await row(await tr('qp.eyeComfort'));
  ok((await S()).eyeComfort === false && (await page.evaluate(() => document.getElementById('eye-filter').style.opacity)) === '0', 'Eye comfort shield off');
  await page.focus(top + ' .set-text-slider');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await sleep(300);
  ok((await S()).textScale === 110 && (await page.evaluate(() => [document.documentElement.dataset.textSize, document.documentElement.style.getPropertyValue('--text-scale')])).join() === '110,1.1', 'Font size 110%: html[data-text-size] and --text-scale');
  ok(+(await page.evaluate(() => getComputedStyle(document.querySelector('.app-win .ou-row-text')).zoom)) > 1.05, 'rows grow with it');
  await shot(P + 'set-19-font-110');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(300);
  ok((await S()).textScale === 100 && !(await page.evaluate(() => document.documentElement.dataset.textSize)), 'Font size back to 100%');
  await back();

  // ——— Accessibility ———
  await row(await tr('set.accessibility'));
  await row(await tr('set.ax.contrast'));
  ok((await S()).highContrast === true && (await page.evaluate(() => document.documentElement.dataset.contrast)) === 'high', 'High contrast fonts: html[data-contrast=high]');
  ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim())) === (theme === 'dark' ? '#e0e1e6' : '#2a2b30'), 'secondary text gets darker (lighter in Dark mode)');
  await shot(P + 'set-20b-contrast');
  await row(await tr('set.ax.contrast'));
  ok(!(await page.evaluate(() => document.documentElement.dataset.contrast)), 'and off');
  await row(await tr('set.ax.transparency'));
  ok((await S()).blur === false && (await page.evaluate(() => document.documentElement.dataset.blur)) === 'off', 'Reduce transparency and blur → solid backgrounds');
  await row(await tr('set.ax.transparency'));
  ok((await S()).blur === true, 'blur back on');
  await row(await tr('set.reduceMotion'));
  ok((await S()).reduceMotion === false && (await page.evaluate(() => document.documentElement.dataset.motion)) === 'full', 'Remove animations off → full motion');
  await row(await tr('set.reduceMotion'));
  ok((await S()).reduceMotion === true && (await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduce', 'Remove animations on');
  await back();

  // ——— Home screen ———
  await row(await tr('set.home'));
  await row(await tr('set.grid'));
  ok((await count('.ou-dialog .ou-radio-row')) === 9, 'nine grid sizes offered');
  await shot(P + 'set-21-grid-dialog');
  await pick(3); // 5 × 5
  let s = await S();
  ok(s.gridCols === 5 && s.gridRows === 5, 'grid 5 × 5 saved');
  ok((await rowSub(await tr('set.grid'))) === '5 × 5', 'grid row shows 5 × 5');
  ok((await page.evaluate(() => [getComputedStyle(document.getElementById('home')).getPropertyValue('--cols').trim(), getComputedStyle(document.getElementById('home')).getPropertyValue('--rows').trim()])).join() === '5,5', 'Home screen grid re-laid out as 5 × 5');
  await row(await tr('set.labels'));
  ok((await S()).showLabels === false && await exists('#home.no-labels'), 'hide app names');
  await row(await tr('set.labels'));
  ok((await S()).showLabels === true && !(await exists('#home.no-labels')), 'show app names');
  await row(await tr('set.searchBar'));
  await pick(2);
  ok((await S()).searchBar === 'top' && (await page.evaluate(() => document.getElementById('home').dataset.search)) === 'top', 'search bar at the top');
  ok((await rowSub(await tr('set.searchBar'))) === (await tr('set.searchTop')), 'search bar row shows the choice');
  await row(await tr('set.searchBar'));
  await pick(1);
  ok((await S()).searchBar === 'bottom', 'search bar back above the dock');
  await page.focus(top + ' .set-slider');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await sleep(200);
  ok((await S()).iconSize === 68 && (await text(top + ' .set-slider-val')) === '68 px', 'icon size slider: 68 px');
  await back();

  // ——— Wallpaper and style (the rest is in wallpaper.cjs) ———
  await row(await tr('set.wallpaper'));
  ok((await count(top + ' .set-wall-previews .swp')) === 2, 'Lock screen and Home screen previews side by side');
  await page.click(top + ' .set-wp-change'); await sleep(600);
  const presets = await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => m.PRESETS.map((p) => [p.id, m.presetById(p.id).tone])));
  ok((await count(top + ' .set-presets .set-wall-item')) === presets.length && presets.length >= 20, `${presets.length} wallpapers in the gallery`);
  ok(await exists(top + ' .set-presets .set-wall-item[data-id="bloom"].active'), 'current preset (bloom) highlighted');
  const accent0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const darkIdx = presets.findIndex(([pid, tone]) => tone === 'dark' && pid !== 'bloom');
  await page.click(`${top} .set-presets .set-wall-item[data-id="${presets[darkIdx][0]}"]`); await sleep(400);
  ok((await count('.ou-dialog .ou-radio-row')) === 3, 'it asks where: Lock and Home screens, Home screen, Lock screen');
  await pick(1);
  s = await S();
  ok(s.wallpaper?.type === 'preset' && s.wallpaper.id === presets[darkIdx][0] && !s.lockWallpaper, `preset "${presets[darkIdx][0]}" saved for both screens`);
  ok((await page.evaluate(() => document.documentElement.dataset.wallTone)) === 'dark', 'dark preset: light text on the Home screen');
  ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) !== accent0, 'Color palette accent follows the wallpaper');
  await page.evaluate((sel) => document.querySelector(sel + ' .set-solids .ou-swatch').click(), top); await sleep(400);
  await pick(1);
  s = await S();
  ok(s.wallpaper?.type === 'color' && /^#[0-9a-f]{6}$/i.test(s.wallpaper.value), `solid colour wallpaper ${s.wallpaper?.value}`);
  ok((await page.evaluate(() => document.getElementById('wallpaper').style.background)).length > 0 && (await page.evaluate(() => document.getElementById('wall-canvas').hidden)), 'solid colour painted, preset canvas hidden');
  await shot(P + 'set-22-wallpaper-gallery');
  await page.click(`${top} .set-presets .set-wall-item[data-id="bloom"]`); await sleep(400);
  await pick(1);
  await back();
  await row(await tr('set.live'));
  ok((await S()).wallpaperAnimated === false, 'Live wallpaper off');
  await page.focus(top + ' .set-slider');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await sleep(200);
  ok((await S()).wallpaperDim === 10 && (await page.evaluate(() => document.getElementById('wall-dim').style.background)).includes('0.1'), 'dim slider darkens the wallpaper 10%');
  await row(await tr('set.blurHome'));
  ok((await S()).wallpaperBlurHome === true && await exists('#wallpaper.blur-home'), 'Blur Home screen wallpaper');
  await row(await tr('set.blurHome'));
  await shot(P + 'set-23-wallpaper');
  await back();

  // ——— Lock screen ———
  await row(await tr('set.lock'));
  ok((await count(top + ' .set-clock-style')) === 4, 'four clock styles');
  await page.click(`${top} .set-clock-style:nth-child(3)`); await sleep(300);
  ok((await S()).clockStyle === 'thin' && await exists(`${top} .set-clock-style:nth-child(3).active`) && await exists(`${top} .set-lock-prev .set-lock-clock.c-thin`), 'clock style "thin" saved and previewed');
  await page.click(`${top} .ou-seg .ou-seg-btn:nth-child(3)`); await sleep(300);
  ok((await S()).clockFont === 'serif', 'clock font serif');
  await row(await tr('set.lw.alarm'));
  ok(((await S()).lockWidgets || []).includes('alarm'), 'Next alarm widget added to lockWidgets');
  await row(await tr('set.lw.battery'));
  ok(!((await S()).lockWidgets || []).includes('battery'), 'Battery widget removed from lockWidgets');
  await row(await tr('set.lockMode'));
  await pick(2);
  ok((await S()).lockMode === 'idle', 'lock mode "after inactivity"');
  ok(!(await page.evaluate(async (sel, title) => [...document.querySelectorAll(sel + ' .ou-row')].find((r) => r.querySelector('.ou-row-title')?.textContent === title)?.hidden, top, await tr('set.idle'))), 'idle timeout row visible for "after inactivity"');
  await row(await tr('set.idle'));
  await pick(2);
  ok((await S()).lockIdleMin === 5, 'lock after 5 minutes');
  await row(await tr('set.lockMode'));
  await pick(3);
  ok((await S()).lockMode === 'never', 'lock mode back to never');
  ok(await page.evaluate(async (sel, title) => [...document.querySelectorAll(sel + ' .ou-row')].find((r) => r.querySelector('.ou-row-title')?.textContent === title)?.hidden, top, await tr('set.idle')), 'idle timeout row hidden for "never"');
  await shot(P + 'set-24-lock');
  await page.click(top + ' .set-actions .ou-btn'); await sleep(900);
  ok(await mod('./js/shell/lock.js', 'isLocked') && !(await exists('.app-win')), 'Lock now closes Settings and locks');
  ok((await page.evaluate(() => document.getElementById('lock').dataset.clock)) === 'thin', 'Lock screen uses the thin clock');
  await shot(P + 'set-25-locked-thin');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);
  await openApp('settings');

  // ——— Search and Finder ———
  await row(await tr('set.search'));
  await row(await tr('set.engine'));
  await pick('DuckDuckGo');
  ok((await S()).searchEngine === 'duckduckgo' && (await rowSub(await tr('set.engine'))) === 'DuckDuckGo', 'search engine DuckDuckGo');
  ok((await count(top + ' .set-cmd')) === 15, 'Finder command cheat sheet (15 kinds of commands, examples in the UI language)');
  await back();

  // ——— Notifications ———
  await row(await tr('set.notifications'));
  await row(await tr('set.testNotif'));
  await sleep(300);
  let nl = (await store('notifications')) || [];
  ok(nl[0]?.app === 'settings' && nl[0].title === (await tr('set.testTitle')), 'test notification stored in notifications');
  ok(await exists('#headsup .headsup'), 'heads-up banner shows it');
  await page.evaluate(() => document.querySelectorAll('#headsup .headsup').forEach((x) => x.remove()));
  await row(await tr('set.nt.history'));
  ok((await count(top + ' .set-hist-row')) === 1 && (await text(top + ' .set-hist-row .ou-row-title')) === (await tr('set.testTitle')), 'Notification history lists it');
  await shot(P + 'set-29-history');
  await back();
  // Do not disturb: still listed, no pop-up
  await row(await tr('set.dnd'));
  await row(await tr('set.dnd'));
  ok((await S()).dnd?.on === true, 'Do not disturb on');
  await page.evaluate(() => import('./js/core/notify.js').then((m) => m.notify({ app: 'notes', title: 'Quiet one' })));
  await sleep(400);
  nl = (await store('notifications')) || [];
  ok(nl[0]?.title === 'Quiet one' && nl[0].silent === true && !(await exists('#headsup .headsup')), 'during Do not disturb a notification is listed silently, no heads-up');
  await row(await tr('set.dnd'));
  await page.click(top + ' .set-dnd-sched'); await sleep(400);
  ok((await count('.ou-dialog input[type=time]')) === 2 && (await count('.ou-dialog .set-day')) === 7, 'Sleeping schedule: start, end and the days');
  ok((await outside('.ou-dialog')).length === 0, 'schedule dialog inside the screen');
  await shot(P + 'set-30-dnd-schedule');
  await page.$eval('.ou-dialog input[type=time]', (i) => { i.value = '00:00'; });
  await page.$$eval('.ou-dialog input[type=time]', (l) => { l[1].value = '23:59'; });
  await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(400);
  s = await S();
  ok(s.dnd?.sched === true && s.dnd.from === '00:00' && s.dnd.to === '23:59' && !s.dnd.on, 'schedule 00:00–23:59 saved and on');
  ok(await page.evaluate(() => import('./js/bg/hub.js').then((m) => m.dndActive({ sched: true, from: '00:00', to: '23:59', days: [0, 1, 2, 3, 4, 5, 6] }))), 'a schedule covering now keeps notifications quiet');
  ok(await page.evaluate(() => import('./js/bg/hub.js').then((m) => [m.dndActive({ sched: true, from: '22:00', to: '07:00', days: [1] }, new Date(2026, 9, 27, 3, 0)), !m.dndActive({ sched: true, from: '22:00', to: '07:00', days: [1] }, new Date(2026, 9, 28, 3, 0)), !m.dndActive({ sched: true, from: '22:00', to: '07:00' }, new Date(2026, 9, 27, 12, 0))].every(Boolean))), 'overnight schedules belong to the day they start');
  await page.click(top + ' .set-dnd-sched .ou-switch'); await sleep(300);
  ok((await S()).dnd?.sched === false, 'schedule off');
  await back();
  // App notifications: blocking an app
  await row(await tr('set.nt.apps'));
  await row(await tr('set.title'));
  ok(((await S()).mutedApps || []).includes('settings'), 'Settings\' notifications blocked (mutedApps)');
  await back();
  ok((await rowSub(await tr('set.nt.apps'))) === (await tr('set.nt.mutedN', { n: 1 })), 'App notifications: "1 apps blocked"');
  const cnt = ((await store('notifications')) || []).length;
  await row(await tr('set.testNotif'));
  ok(((await store('notifications')) || []).length === cnt, 'a blocked app posts nothing');
  await row(await tr('set.nt.apps'));
  await row(await tr('set.title'));
  await back();
  await row(await tr('set.clearNotifs'));
  ok(((await store('notifications')) || []).length === 0 && (await text('.ou-toast span')) === (await tr('set.cleared')), 'Clear notifications empties the list');
  await back();

  // ——— Apps ———
  await row(await tr('set.apps'));
  const nApps = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().filter((a) => !a.hidden).length));
  ok((await count(top + ' .set-app-row')) === nApps && (await count(top + ' .set-app-row .app-icon')) === nApps, `every app listed with its icon (${nApps})`);
  await shot(P + 'set-31-apps');
  const notesName = await mod('./js/core/apps.js', 'appName', 'notes');
  await row(notesName);
  ok((await text(top + ' .app-toolbar-title')) === notesName && await exists(top + ' .set-app-head .app-icon'), 'a page per app');
  await row(await tr('set.notifications'));
  ok(((await S()).mutedApps || []).includes('notes'), 'its notifications off');
  await row(await tr('set.notifications'));
  ok(!((await S()).mutedApps || []).includes('notes'), 'and on again');
  await row(await tr('set.app.size'));
  await pick(2);
  ok((await S()).appSizes?.notes === 'wide' && (await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('notes').size))) === 'wide', 'window size: Large pop-up view (Notes opens tablet-size)');
  await row(await tr('set.app.size'));
  await pick(1);
  ok((await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('notes').size))) === 'phone', 'and back to pop-up view');
  await row(await tr('set.app.addHome'));
  await sleep(300);
  ok(JSON.stringify(await store('home')).includes('"app":"notes"') && (await rowSub(await tr('set.app.addHome'))) === (await tr('set.app.onHome')), 'Add to Home screen puts Notes on the Home screen');
  await shot(P + 'set-32-app-page');
  await back(); await back();

  // ——— Advanced features ———
  await row(await tr('set.advanced'));
  await row(await tr('set.labs'));
  ok((await count(top + ' .ou-switch')) === 3, 'Labs: three experimental switches');
  await row(await tr('set.labs.daily'));
  ok((await S()).genDaily === true, 'New Creative wallpaper every day on');
  await row(await tr('set.labs.daily'));
  await back();
  await row(await tr('set.shortcuts'));
  ok((await count(top + ' kbd.set-kbd')) >= 20 && (await count(top + ' .ou-subheader')) >= 4, 'Keyboard shortcuts: every shortcut, in sections');
  await shot(P + 'set-33-shortcuts');
  await back(); await back();

  // ——— Sync with Chrome (the page) ———
  await row(await tr('set.sync'));
  await row(await tr('set.sy.title'));
  ok((await store('syncPrefs'))?.on === true && await exists(top + ' .set-sync-now'), 'Sync with Chrome on: status and Sync now');
  await row(await tr('set.sy.title'));
  ok((await store('syncPrefs'))?.on === false, 'and off');
  await back();

  // ——— Weather ———
  await row(await tr('set.weather'));
  ok((await rowSub(await tr('set.location'))) === (await tr('set.currentLocation')), 'location: current location by default');
  await page.click(`${top} .ou-seg .ou-seg-btn:nth-child(2)`); await sleep(300);
  ok((await S()).tempUnit === 'f', 'temperature unit °F');
  await page.click(`${top} .ou-seg .ou-seg-btn:nth-child(1)`); await sleep(300);
  ok((await S()).tempUnit === 'c', 'temperature unit °C');
  await row(await tr('set.location'));
  ok(await exists('.ou-dialog input[type=search]') && await exists('.ou-dialog .set-city.current'), 'location dialog: city search and "use current location"');
  ok((await outside('.ou-dialog')).length === 0, 'location dialog inside the screen');
  await page.keyboard.press('Escape'); await sleep(350);
  ok(!(await exists('.ou-dialog')) && (await S()).location == null, 'Esc closes it without changes');
  await back();

  // ——— General: time format, Focus length ———
  await row(await tr('set.general'));
  await row(await tr('set.timeFormat'));
  await pick(2);
  ok((await S()).hour12 === false, '24-hour clock');
  await row(await tr('set.timeFormat'));
  await pick(1);
  ok((await S()).hour12 === 'auto', 'time format back to automatic');
  await row(await tr('set.focusLen'));
  await pick(5);
  ok((await S()).focusMinutes === 45, 'Focus length 45 minutes');
  await row(await tr('set.reset.title'));
  ok((await count(top + ' .ou-row')) === 3, 'Reset: settings, Home screen, all data');
  await back();
  await back();

  // ——— Backup: export ———
  await page.evaluate(() => {
    window.__dl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return orig.call(this);
      const d = (window.__dl = { name: this.download, text: null });
      fetch(this.href).then((r) => r.text()).then((t) => (d.text = t));
    };
  });
  await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.putBlob('notes:pic1', new Blob(['PICTUREDATA'], { type: 'text/plain' }))));
  await row(await tr('set.backup'));
  await row(await tr('set.backupPics'));
  ok((await S()).backupPictures === true, 'Include pictures and recordings on');
  await row(await tr('set.export'));
  await page.waitForFunction(() => window.__dl?.text, { timeout: 5000 }).catch(() => {});
  const dl = await page.evaluate(() => window.__dl);
  ok(/^bloom-tab-backup-\d{4}-\d\d-\d\d\.json$/.test(dl?.name || ''), `export file name ${dl?.name}`);
  let backup = null;
  try { backup = JSON.parse(dl?.text || ''); } catch {}
  ok(backup?.app === 'bloom-tab' && backup.version === 1 && backup.data, 'export is JSON {app: "bloom-tab", version: 1, data}');
  const stored = await page.evaluate(() => chrome.storage.local.get(null));
  ok(backup && Object.keys(stored).filter((k) => !/^sync/.test(k)).every((k) => k in backup.data), 'export contains every storage key (but this computer\'s sync state): ' + Object.keys(stored).join(', '));
  ok(backup?.data?.notes?.[0]?.title === 'Backup me' && backup.data.settings?.focusMinutes === 45 && backup.data.settings.searchEngine === 'duckduckgo', 'export has the notes and the settings changed above');
  ok(/^data:text\/plain;base64,/.test(backup?.blobs?.['notes:pic1'] || ''), 'and the picture (IndexedDB) as a data URL');
  ok(!('syncPrefs' in (backup?.data || {})) && !('syncDevice' in (backup?.data || {})), 'but not this computer\'s sync state');
  await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.delBlob('notes:pic1')));

  // ——— Backup: import (a bad file, then a good one) ———
  const bad = path.join(OUT, 'set-bad-backup.json');
  fs.writeFileSync(bad, JSON.stringify({ hello: 1 }));
  let [fc2] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }).catch(() => null), row(await tr('set.import'))]);
  if (fc2) {
    await fc2.accept([bad]); await sleep(600);
    ok((await text('.ou-toast span')) === (await tr('set.importFail')), 'a file that isn\'t a backup is refused');
  } else ok(false, 'Restore opens a file picker');
  const good = path.join(OUT, 'set-good-backup.json');
  backup.data.importMarker = 42;
  backup.data.notes = [{ ...NOTES[0], id: 'n2', title: 'Restored note' }];
  backup.data.settings = { ...backup.data.settings, gridCols: 7, gridRows: 5 };
  fs.writeFileSync(good, JSON.stringify(backup));
  [fc2] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }).catch(() => null), row(await tr('set.import'))]);
  if (fc2) {
    await fc2.accept([good]); await sleep(500);
    ok(await exists('.ou-dialog .ou-dialog-btn.primary'), 'restore asks for confirmation');
    await shot(P + 'set-26-restore-confirm');
    await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), page.click('.ou-dialog .ou-dialog-btn.primary')]);
    await waitBoot();
    ok((await store('importMarker')) === 42 && (await store('notes'))?.[0]?.title === 'Restored note', 'restore replaced the data and reloaded');
    ok((await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.getBlob('notes:pic1')).then((b) => b && b.text()))) === 'PICTUREDATA', 'the picture came back into IndexedDB');
    s = await S();
    ok(s.gridCols === 7 && s.gridRows === 5 && (await page.evaluate(() => getComputedStyle(document.getElementById('home')).getPropertyValue('--cols').trim())) === '7', 'restored settings applied after the reload (7 × 5 grid)');
    ok((await page.evaluate(() => document.documentElement.lang)) === ui, 'language kept');
  } else ok(false, 'Restore opens a file picker');

  // ——— General: language to the other one and back (the page reloads) ———
  const other = ui === 'ar' ? 'en' : 'ar';
  const NAME = { en: 'English', ar: 'العربية' };
  for (const lang of [other, ui]) {
    await openApp('settings');
    await row(await tr('set.general'));
    await row(await tr('set.language'));
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 3000 }).catch(() => {});
    ok((await count('.ou-dialog .ou-radio-row')) === 3, 'language choices: Automatic, English, العربية');
    await page.evaluate((nm) => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((r) => r.textContent.includes(nm))?.click(), NAME[lang]);
    if (lang === other) await shot(P + 'set-27-language');
    await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), page.click('.ou-dialog .ou-dialog-btn.primary')]);
    await waitBoot();
    ok((await S()).lang === lang, `settings.lang = ${lang}`);
    ok((await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).join() === `${lang},${lang === 'ar' ? 'rtl' : 'ltr'}`, `page reloaded in ${lang} (${lang === 'ar' ? 'rtl' : 'ltr'})`);
    ok((await text('.hs-text')) === (await tr('home.searchPlaceholder')) && (lang === 'ar') === /[؀-ۿ]/.test(await text('.hs-text')), `Home screen text in ${lang}`);
    if (lang === other) {
      await openApp('settings');
      await shot(P + `set-28-root-${lang}`);
      ok((await hOverflow()).length === 0, `Settings root fits the window in ${lang}`);
      await closeApp();
    }
  }

  // ——— Backup: reset everything ———
  await openApp('settings');
  await row(await tr('set.backup'));
  await row(await tr('set.resetAll'));
  ok(await exists('.ou-dialog .ou-dialog-btn.danger'), 'reset asks with a red button');
  await page.click('.ou-dialog .ou-dialog-btn:not(.danger)'); await sleep(400);
  ok((await store('importMarker')) === 42, 'Cancel keeps everything');
  await row(await tr('set.resetAll'));
  await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), page.click('.ou-dialog .ou-dialog-btn.danger')]);
  await waitBoot();
  ok((await store('importMarker')) === undefined && (await store('notes')) === undefined, 'reset erased all data');
  const st0 = (await store('settings')) || {};
  ok((st0.gridCols ?? 6) === 6 && (st0.gridRows ?? 4) === 4 && (st0.focusMinutes ?? 25) === 25 && !st0.profileName && !st0.backupPictures, 'settings back to defaults');
  ok(Array.isArray(await store('home')), 'Home screen seeded again after the reset');
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
};
