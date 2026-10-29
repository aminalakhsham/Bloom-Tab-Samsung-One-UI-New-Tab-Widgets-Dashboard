// triple
// Galaxy Store for websites (A11): Discover (banners, Must-have, Today's pick, Top websites, Popular in …), Categories
// (list → ranked category, A–Z), a site's page (Install → Home screen with the short name → Open, Wish list, Uninstall
// from ⋮ with Undo, a folder collapsing), Top (round robin, category chips), Search (names, categories, any address,
// recent searches), Menu (My apps, Wish list), Finder offering Install, the Today's pick widget and params.
// usage: .dev/run.sh .dev/store.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, sleep, shot, P, mod, store, openApp, closeApp, click, text, texts, count, exists, outside }) => {
  const W = '.app-win';
  const top = '.app-page:last-child';
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const sites = (home) => (home || []).flat().flatMap((it) => (it.type === 'folder' ? it.items : [it])).filter((it) => it.type === 'site');
  const homeSites = async () => [...sites(await store('home')), ...sites([await store('dock')])];
  const btnText = (sel) => text(sel);
  const clickWhere = (sel, txt) => page.evaluate((s, x) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === x);
    el?.click();
    return !!el;
  }, sel, txt);

  // A Home screen with a folder (YouTube + Netflix), GitHub, and the store in the dock
  await boot({
    data: {
      home: [[
        { id: 'f1', type: 'folder', title: 'Fun', items: [{ id: 's1', type: 'site', url: 'https://www.youtube.com', title: 'YouTube' }, { id: 's2', type: 'site', url: 'https://www.netflix.com', title: 'Netflix' }] },
        { id: 's3', type: 'site', url: 'https://github.com', title: 'GitHub' },
      ]],
      dock: [{ id: 'd1', type: 'app', app: 'store' }],
    },
  });
  const apps = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().map((a) => a.id)));
  ok(apps.includes('store'), 'Galaxy Store is registered');

  // ——— open from the dock: Discover ———
  await click('#home .tile[data-id="d1"]');
  await sleep(900);
  ok(await exists(`${W} .gs-tab-discover`) && !(await exists('.app-error')), 'the dock icon opens Galaxy Store on Discover');
  const nav = await texts(`${W} .gs-nav .ou-tab`);
  ok(nav.length === 5 && nav[0] === await tr('store.tab.discover') && nav[4] === await tr('store.tab.menu'), `bottom bar: ${nav.join(' / ')}`);
  ok(await text(`${W} .gs-nav .ou-tab.active`) === await tr('store.tab.discover'), 'Discover is selected');
  ok((await outside(`${W} .gs-nav`, W)).length === 0, 'the bottom bar fits inside the window');
  ok(await count(`${W} .gs-banner`) === 3 && await count(`${W} .gs-dots span`) === 3, 'three banners with page dots');
  ok(await count(`${W} .gs-banner .gs-ic`) === 9, 'each banner shows three of its sites');
  const secs = await texts(`${W} .gs-tab-discover .gs-sec-h h2`);
  ok(secs[0] === await tr('store.mustHave') && secs[1] === await tr('store.topSites') && secs.slice(2).length === 3, `sections: ${secs.join(' | ')}`);
  ok(await count(`${W} .gs-sec:first-of-type .gs-tile`) === 12, 'twelve Must-have websites');
  ok(await exists(`${W} .gs-pick .gs-get.big`) && (await text(`${W} .gs-pick-kick`)).includes(await tr('store.widget')), 'Today’s pick card with its Install button');
  ok(await count(`${W} .gs-cols .gs-row .gs-rank`) === 12, 'Top websites: twelve ranked rows in columns of three');
  const icons = await page.evaluate((W) => [...document.querySelectorAll(W + ' .gs-ic')].map((i) => ({ cls: i.className, letter: i.querySelector('.gs-ic-letter')?.textContent, h: i.style.getPropertyValue('--h') })), W);
  ok(icons.length > 50 && icons.every((i) => /letter|fav/.test(i.cls) && i.letter && i.h !== ''), `${icons.length} generated squircle icons (favicon or letter, coloured by site and category)`);
  const remote = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /^https?:/.test(r.name)).map((r) => r.name));
  ok(!remote.some((u) => /mzstatic|google\.com\/s2|favicon/.test(u)), 'no icon is loaded from the network');
  await shot(P + 'store-discover');

  // a banner opens its category
  const bannerCat = await page.evaluate((W) => document.querySelector(W + ' .gs-banner').dataset.cat, W);
  await click(`${W} .gs-banner`);
  await sleep(500);
  ok(await exists(`${W} ${top}.gs-catpage`) && await text(`${W} ${top} .gs-cat-head b`) === await tr('store.cat.' + bannerCat), `the first banner opens ${bannerCat}`);
  await click(`${W} ${top} .app-back`);
  await sleep(500);

  // ——— Categories ———
  await click(`${W} .gs-nav [data-tab="categories"]`);
  await sleep(400);
  const cats = await texts(`${W} .gs-cats .ou-row-title`);
  ok(cats.length === 11 && cats.includes(await tr('store.cat.entertainment')) && cats.includes(await tr('store.cat.utilities')), `11 categories (${cats.slice(0, 3).join(', ')}…)`);
  await shot(P + 'store-categories');
  await click(`${W} .gs-cats [data-cat="entertainment"]`);
  await sleep(500);
  const ent = await texts(`${W} ${top} .gs-row-name`);
  ok(ent[0] === 'YouTube' && ent.includes('Netflix') && ent.length > 40, `Entertainment: ${ent.length} sites, YouTube first`);
  ok(await text(`${W} ${top} .gs-row .gs-rank`) === '1', 'ranked');
  ok(await btnText(`${W} ${top} .gs-get[data-host="youtube.com"]`) === await tr('store.open'), 'YouTube (in a Home screen folder as www.youtube.com) shows Open');
  ok(await btnText(`${W} ${top} .gs-get[data-host="twitch.tv"]`) === await tr('store.install'), 'Twitch shows Install');
  await clickWhere(`${W} ${top} .ou-seg-btn`, await tr('store.az'));
  await sleep(300);
  const azNames = await texts(`${W} ${top} .gs-row-name`);
  ok(!(await exists(`${W} ${top} .gs-rank`)) && azNames.length === ent.length && azNames[0].localeCompare(azNames[1]) <= 0, 'A–Z: alphabetical, no ranks');
  await clickWhere(`${W} ${top} .ou-seg-btn`, await tr('store.popular'));
  await sleep(300);

  // ——— a site's page ———
  await click(`${W} ${top} .gs-row[data-site="twitch.tv"]`);
  await sleep(600);
  const D = `${W} ${top}.gs-detail`;
  ok(await text(`${D} .gs-hero-name`) === 'Twitch' && await text(`${D} .gs-hero-dev`) === 'twitch.tv', 'Twitch’s page: name and site');
  ok(await text(`${D} .gs-cat-chip`) === await tr('store.cat.entertainment') && await count(`${D} .gs-stat`) === 3, 'category chip and the three stats');
  ok(await btnText(`${D} .gs-get.big`) === await tr('store.install'), 'big Install button');
  const about = await texts(`${D} .gs-about p`);
  ok(about.length === 2 && about[0].includes('Twitch') && about[1].includes('twitch.tv'), 'a description generated from the catalog');
  ok(await count(`${D} .gs-hrow .gs-tile`) === 9 && await count(`${D} .gs-info-row`) === 4, 'You might also like (9) and Information (4 rows)');
  await shot(P + 'store-detail');

  // Install → Home screen with the short name → Open (and the list underneath follows)
  await click(`${D} .gs-get.big`);
  await sleep(500);
  let hs = await homeSites();
  const twitch = hs.find((s) => /twitch\.tv/.test(s.url));
  ok(twitch && twitch.title === 'Twitch', 'Install puts Twitch on the Home screen, named Twitch');
  ok(await btnText(`${D} .gs-get.big`) === await tr('store.open'), 'and the button turns into Open');
  ok(await page.evaluate(() => [...document.querySelectorAll('.app-page')].every((p) => [...p.querySelectorAll('.gs-get[data-host="twitch.tv"]')].every((b) => b.classList.contains('open')))), 'every Twitch button in the window says Open');
  ok(await exists(`#home .tile[data-id="${twitch?.id}"]`), 'its icon is on the Home screen');

  // Wish list
  await click(`${D} .gs-heart`);
  await sleep(200);
  ok((await store('storeWish'))?.[0] === 'twitch.tv' && await exists(`${D} .gs-heart.on`), 'the heart adds it to the Wish list (storeWish)');

  // Uninstall from ⋮, with Undo
  await click(`${D} .gs-more-btn`);
  await sleep(250);
  const items = await texts('.ou-menu .ou-menu-label');
  ok(items[0] === await tr('store.uninstall'), `⋮ menu: ${items.join(', ')}`);
  await clickWhere('.ou-menu .ou-menu-item', await tr('store.uninstall'));
  await sleep(300);
  ok(await exists('.ou-dialog'), 'Uninstall asks first');
  await click('.ou-dialog .ou-dialog-btn.danger');
  await sleep(500);
  ok(!(await homeSites()).some((s) => /twitch\.tv/.test(s.url)) && await btnText(`${D} .gs-get.big`) === await tr('store.install'), 'Uninstall removes it and the button says Install again');
  ok(await exists('.ou-toast'), 'a toast offers Undo');
  await click('.ou-toast .ou-toast-action');
  await sleep(400);
  ok((await homeSites()).some((s) => /twitch\.tv/.test(s.url)) && await btnText(`${D} .gs-get.big`) === await tr('store.open'), 'Undo puts it back');
  await page.keyboard.press('Escape');
  await sleep(300);

  // uninstalling YouTube empties the folder down to Netflix (a folder with one item becomes that item)
  await openApp('store', { site: 'youtube.com' });
  await sleep(500);
  ok(await text(`${W} ${top}.gs-detail .gs-hero-name`) === 'YouTube' && await btnText(`${W} ${top}.gs-detail .gs-get.big`) === await tr('store.open'), 'params { site } open YouTube’s page, which says Open');
  await click(`${W} ${top} .gs-more-btn`);
  await sleep(250);
  await clickWhere('.ou-menu .ou-menu-item', await tr('store.uninstall'));
  await sleep(300);
  await click('.ou-dialog .ou-dialog-btn.danger');
  await sleep(500);
  const home1 = (await store('home'))[0];
  ok(!home1.some((it) => it.type === 'folder') && home1.some((it) => it.type === 'site' && /netflix/.test(it.url)) && !sites([home1]).some((s) => /youtube/.test(s.url)), 'YouTube uninstalled; the folder became Netflix');
  ok(!(await exists('#home .tile.t-folder')), 'the Home screen shows no folder any more');

  // ——— Top ———
  await click(`${W} ${top} .app-back`).catch(() => {});
  await sleep(300);
  await click(`${W} .gs-nav [data-tab="top"]`);
  await sleep(500);
  ok(await count(`${W} .gs-chips .ou-chip`) === 12 && await text(`${W} .gs-chips .ou-chip.active`) === await tr('store.all'), 'Top: All + 11 category chips');
  const ranks = await texts(`${W} .gs-tab-top .gs-rank`);
  const topNames = await texts(`${W} .gs-tab-top .gs-row-name`);
  ok(ranks.length === 100 && ranks[0] === '1' && ranks[99] === '100', '100 ranked sites');
  ok(topNames[0] === 'Facebook' && topNames[1] === 'YouTube', `round robin across categories (${topNames.slice(0, 4).join(', ')}…)`);
  await shot(P + 'store-top');
  await click(`${W} .gs-chips [data-cat="games"]`);
  await sleep(300);
  const games = await page.evaluate(() => import('./js/store/model.js').then((m) => m.inCat('games').map((a) => a.name)));
  ok(JSON.stringify(await texts(`${W} .gs-tab-top .gs-row-name`)) === JSON.stringify(games), 'the Games chip shows the Games chart');

  // maximized: two-column charts, two banners side by side
  await click(`${W} .app-handle-btn`);
  await sleep(500);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.gs-tab-top .gs-list')).gridTemplateColumns.split(' ').length === 2), 'maximized, the chart has two columns');
  await shot(P + 'store-top-wide');
  await click(`${W} .gs-nav [data-tab="discover"]`);
  await sleep(500);
  await shot(P + 'store-discover-wide');
  await click(`${W} .app-handle-btn`);
  await sleep(400);

  // ——— Search ———
  await click(`${W} .gs-nav [data-tab="search"]`);
  await sleep(500);
  ok(await page.evaluate(() => document.activeElement?.classList.contains('gs-q')), 'Search focuses its field (in the app bar)');
  ok(await count(`${W} .gs-popular li`) === 10, 'ten popular searches');
  await page.type(`${W} .gs-q`, 'duol');
  await sleep(300);
  ok((await texts(`${W} .gs-results .gs-row-name`))[0] === 'Duolingo', 'typing “duol” finds Duolingo first');
  await page.keyboard.press('Enter');
  await sleep(200);
  ok((await store('storeRecent'))?.[0] === 'duol', 'Enter keeps it in recent searches (storeRecent)');
  await page.$eval(`${W} .gs-q`, (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type(`${W} .gs-q`, (await tr('store.cat.travel')).slice(0, 5));
  await sleep(300);
  ok((await texts(`${W} .gs-results .gs-cats .ou-row-title`)).includes(await tr('store.cat.travel')), 'a category name finds the category');
  await page.$eval(`${W} .gs-q`, (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type(`${W} .gs-q`, 'my-own-site.example');
  await sleep(300);
  ok((await text(`${W} .gs-address .gs-row-name`))?.includes('my-own-site.example'), 'any typed address can be added too');
  await shot(P + 'store-search');
  await click(`${W} .gs-address .gs-get`);
  await sleep(500);
  ok((await homeSites()).some((s) => /my-own-site\.example/.test(s.url)) && await btnText(`${W} .gs-address .gs-get`) === await tr('store.open'), 'Install adds it and says Open');
  await page.$eval(`${W} .gs-q`, (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  ok((await texts(`${W} .gs-recent-q`)).includes('duol'), 'the empty field shows recent searches');

  // ——— Menu ———
  await click(`${W} .gs-nav [data-tab="menu"]`);
  await sleep(400);
  ok((await text(`${W} .gs-me-text b`)) === await tr('app.store'), 'Menu: the Galaxy Store card');
  await shot(P + 'store-menu');
  await click(`${W} .gs-my`);
  await sleep(500);
  const mine = await texts(`${W} ${top} .gs-row-name`);
  ok(mine.includes('Netflix') && mine.includes('Twitch') && mine.includes('GitHub') && mine.some((n) => /my-own-site/i.test(n)), `My apps: ${mine.join(', ')}`);
  await click(`${W} ${top} .app-back`);
  await sleep(400);
  await click(`${W} .gs-wish`);
  await sleep(500);
  ok(JSON.stringify(await texts(`${W} ${top} .gs-row-name`)) === '["Twitch"]', 'Wish list: Twitch');
  await closeApp();

  // ——— Finder offers Install ———
  await mod('./js/shell/finder.js', 'openFinder', 'spotify');
  await sleep(900);
  const want = await tr('store.installName', { name: 'Spotify' });
  ok((await texts('#finder .fr-title')).includes(want), `Finder: “spotify” offers “${want}”`);
  await shot(P + 'store-finder');
  await page.evaluate((w) => [...document.querySelectorAll('#finder .fr')].find((b) => b.querySelector('.fr-title')?.textContent === w)?.click(), want);
  await sleep(600);
  ok((await homeSites()).some((s) => /spotify\.com/.test(s.url) && s.title === 'Spotify'), 'choosing it installs Spotify');

  // ——— Today's pick widget ———
  const pick = await page.evaluate(() => import('./js/store/model.js').then((m) => ({ site: m.pickOfDay().site, label: m.pickOfDay().label })));
  await mod('./js/shell/home.js', 'addWidget', 'store-pick', 'm');
  await mod('./js/shell/home.js', 'addWidget', 'store-pick', 's');
  await sleep(800);
  ok(await count('#home .wg-store') === 2 && await count('#home .w-s.wg-store .wg-store-btn') === 1, 'small and medium Today’s pick widgets');
  ok((await outside('#home .wg-store .wg-store-btn, #home .wg-store .gs-ic', null)).length === 0 && await page.evaluate(() => [...document.querySelectorAll('#home .wg-store')].every((w) => [...w.querySelectorAll('.wg-store-btn, .gs-ic, .wg-store-name')].every((x) => { const a = x.getBoundingClientRect(), b = w.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1; }))), 'their content fits inside the widgets');
  ok(await text('#home .wg-store .wg-store-name') === pick.label, `the widget shows today’s pick (${pick.label})`);
  await shot(P + 'store-widget');
  const wasInstalled = (await homeSites()).some((s) => new URL(s.url).hostname.replace(/^www\./, '') === pick.site);
  if (!wasInstalled) {
    await click('#home .wg-store .wg-store-btn');
    await sleep(600);
    ok((await homeSites()).some((s) => new URL(s.url).hostname === pick.site), 'its Install button installs the pick');
  }
  ok(await text('#home .wg-store .wg-store-btn') === await tr('store.open'), 'and then says Open');
  await click('#home .wg-store .wg-store-name');
  await sleep(900);
  ok(await text(`${W} ${top}.gs-detail .gs-hero-name`) === (await page.evaluate(() => import('./js/store/model.js').then((m) => m.pickOfDay().name))), 'tapping the widget opens the pick’s page');
  await closeApp();

  // ——— Modes and Routines: “Open Galaxy Store” (a named site's page, a search, or Discover) ———
  const ra = (q) => page.evaluate(async (q) => {
    const { ACTIONS } = await import('./js/routines/actions.js');
    const { pageCtx } = await import('./js/routines/page.js');
    try { await ACTIONS['store.open'].run(pageCtx(), { q }); return 'ok'; } catch (e) { return e.key || e.message; }
  }, q);
  ok(await ra('Twitch') === 'ok', 'Routines: the Open Galaxy Store action runs');
  await sleep(1000);
  ok(await text(`${W} ${top}.gs-detail .gs-hero-name`) === 'Twitch', 'a site’s name opens its page');
  await closeApp();
  await ra('www.duolingo.com');
  await sleep(1000);
  ok(await text(`${W} ${top}.gs-detail .gs-hero-name`) === 'Duolingo', 'so does its address');
  await closeApp();
  await ra('recipes');
  await sleep(1000);
  ok(await page.evaluate((W) => document.querySelector(W + ' .gs-q')?.value, W) === 'recipes' && await exists(`${W} .gs-nav [data-tab="search"].active`), 'other text searches the store');
  await closeApp();
  await ra('');
  await sleep(1000);
  ok(await text(`${W} .gs-nav .ou-tab.active`) === await tr('store.tab.discover'), 'empty: Discover');
  ok(await page.evaluate(async () => { const { ACTIONS } = await import('./js/routines/actions.js'); try { await ACTIONS['store.open'].run({ page: null }, {}); return ''; } catch (e) { return e.key; } }) === 'routines.err.page', 'it needs a page');
  await closeApp();
};
