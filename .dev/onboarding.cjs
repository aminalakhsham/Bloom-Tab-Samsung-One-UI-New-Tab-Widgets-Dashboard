// triple
// Welcome tour (One UI setup wizard) and What's new: hidden under automation unless a test asks (localStorage
// bt.test.tour / bt.test.whatsnew); a first run shows the tour before anything else (no Home/Lock/status bar frame,
// counted on every animation frame), language switch reloads straight back into the tour (both ways, no flash), Back,
// Enter, light/dark, wallpaper, "Add my sites" (stubbed chrome.topSites) rewriting the first Home page, search engine
// and AI assistant, permissions skipped, Lock screen style and font, Start → onboarded + seenVersion, Home visible
// and unlocked. Existing users (a Home layout, no `onboarded`) skip the tour and get What's new once, after unlock;
// new users and up-to-date users don't; Settings › About › What's new opens it any time. Narrow window layout.
// usage: .dev/run.sh .dev/onboarding.cjs      (THEME=dark, UI=ar)
module.exports = async (ctx) => {
  const { page, boot, ok, sleep, shot, P, mod, sw, exists, visible, count, text, texts, ui, theme, getStorage, setStorage, outside, logs } = ctx;
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const settings = async () => (await getStorage('settings')).settings || {};
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
  const step = () => page.evaluate(() => document.querySelector('.onb')?.dataset.step || null);
  const next = async (wait = 450) => { await page.click('.onb-next'); await sleep(wait); };
  const nextLabel = () => text('.onb-next');
  const flash = () => page.evaluate(() => ({ n: window.__flash ?? -1, what: (window.__flashWhat || []).slice(0, 4).join(',') }));
  const version = await sw.evaluate(() => chrome.runtime.getManifest().version);
  const other = ui === 'ar' ? 'en' : 'ar';
  const pageErrors = (from) => logs.slice(from).filter((l) => l.includes('[pageerror]')).length;

  // Every new document counts the frames where the Home screen, status bar or Lock screen shows while the tour is due.
  await page.evaluateOnNewDocument(() => {
    try {
      if (!localStorage.getItem('bt.test.tour') || localStorage.getItem('bt.test.noflash')) return;
    } catch {
      return;
    }
    window.__flash = 0;
    window.__flashWhat = [];
    const shown = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.visibility === 'visible' && cs.display !== 'none' && +cs.opacity > 0.01 && r.width > 0;
    };
    const look = () => {
      if (!window.__tourDone) {
        for (const id of ['home', 'statusbar', 'lock']) if (shown(document.getElementById(id))) { window.__flash++; window.__flashWhat.push(id); break; }
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });

  // ——— 1. under automation nothing pops up by itself ———
  await boot({ settings: { onboarded: true, seenVersion: '0.0.1' } });
  await sleep(900);
  ok(!(await exists('.onb')) && !(await exists('.wn-dialog')), 'automation: no tour and no What’s new without the test flags');
  ok((await settings()).seenVersion === '0.0.1', 'automation: seenVersion untouched');
  await boot();
  await sleep(500);
  ok(!(await exists('.onb')) && !(await page.evaluate(() => document.documentElement.classList.contains('onb-pending'))), 'automation: a profile without `onboarded` gets no tour either');
  ok((await settings()).onboarded == null, 'and the tour writes nothing (onboarded stays unset)');

  // ——— 2. first run: the tour shows before anything else ———
  await page.evaluate(() => localStorage.setItem('bt.test.tour', '1'));
  await sw.evaluate(() => chrome.storage.local.remove(['home', 'dock']));
  await setStorage({ settings: { theme, lang: ui, lockMode: 'always', reduceMotion: true } });
  await page.reload();
  await page.waitForSelector('.onb', { timeout: 20000 });
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(700);
  ok(await visible('.onb'), 'first run: the welcome tour is on screen');
  ok((await step()) === 'welcome', 'it starts on Welcome');
  ok(await page.evaluate(() => document.documentElement.classList.contains('onb-pending')), 'html.onb-pending hides the shell while it runs');
  let f = await flash();
  ok(f.n === 0, `no Home screen, status bar or Lock screen frame before or behind the tour (${f.n} ${f.what})`);
  ok((await settings()).onboarded === false, 'settings.onboarded = false while the tour is in progress');
  ok((await text('.onb-welcome-title')) === (await S('onb.welcome')), 'big friendly title: ' + (await S('onb.welcome')));
  ok((await nextLabel()) === (await S('onb.getStarted')), 'pill button: ' + (await S('onb.getStarted')));
  ok(!(await visible('.onb-back')) && !(await visible('.onb-dots')), 'no Back and no dots on Welcome');
  await shot(P + 'onb-01-welcome');

  // keys stay in the tour: a letter doesn't open Finder; Enter advances
  await page.keyboard.press('k');
  await sleep(300);
  ok(!(await page.evaluate(() => import('./js/shell/finder.js').then((m) => m.isFinderOpen()))), 'typing during the tour doesn’t open Finder behind it');
  await page.keyboard.press('Enter');
  await sleep(500);
  ok((await step()) === 'language', 'Enter goes to the next page: Language');
  ok(await visible('.onb-back') && (await count('.onb-dots i')) === 7 && (await page.evaluate(() => [...document.querySelectorAll('.onb-dots i')].findIndex((i) => i.classList.contains('on')))) === 0, 'Back button and 7 progress dots, the first one current');
  ok((await count('.onb-opt[data-lang]')) === 2 && (await page.evaluate((l) => document.querySelector(`.onb-opt[data-lang="${l}"]`)?.classList.contains('on'), ui)), 'English and العربية, the current language checked');
  await shot(P + 'onb-02-language');

  // ——— 3. language switch reloads straight into the tour, no flash, and back ———
  for (const [to, label] of [[other, 'switching to ' + other], [ui, 'switching back to ' + ui]]) {
    await Promise.all([page.waitForNavigation({ timeout: 30000 }), page.click(`.onb-opt[data-lang="${to}"]`)]);
    await page.waitForSelector('.onb .onb-opt[data-lang]', { timeout: 30000 });
    await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
    await sleep(700);
    f = await flash();
    const st = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, on: document.querySelector('.onb-opt.on')?.dataset.lang, title: document.querySelector('.onb-title')?.textContent, pending: document.documentElement.classList.contains('onb-pending') }));
    ok(f.n === 0, `${label}: no Home screen or Lock screen frame during the reload (${f.n} ${f.what})`);
    ok(st.lang === to && st.dir === (to === 'ar' ? 'rtl' : 'ltr') && st.on === to, `${label}: back on the Language page in ${to} (${st.dir})`);
    ok(st.title === (await S('onb.langTitle')) && st.pending, `${label}: “${st.title}”, shell still hidden`);
    ok((await settings()).lang === to, `${label}: settings.lang = ${to}`);
    if (to === other) await shot(P + 'onb-03-language-' + to);
  }

  // ——— 4. light / dark, with Back ———
  await next();
  ok((await step()) === 'theme' && (await count('.onb-theme')) === 3, 'Light or dark: three choices (Light, Dark, Automatic)');
  const flip = theme === 'dark' ? 'light' : 'dark';
  await page.click(`.onb-theme[data-theme="${flip}"]`);
  await sleep(250);
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === flip && (await settings()).theme === flip, `picking ${flip} applies it right away`);
  await page.click('.onb-theme[data-theme="auto"]');
  await sleep(200);
  ok((await settings()).theme === 'auto', 'Automatic follows the device');
  await page.click(`.onb-theme[data-theme="${theme}"]`);
  await sleep(250);
  ok((await settings()).theme === theme && (await page.evaluate((t) => document.querySelector(`.onb-theme[data-theme="${t}"]`).getAttribute('aria-checked'), theme)) === 'true', `back to ${theme}, checked`);
  await shot(P + 'onb-04-theme');
  await page.click('.onb-back');
  await sleep(400);
  ok((await step()) === 'language', 'Back returns to Language');
  await next();

  // ——— 5. wallpaper ———
  await next();
  ok((await step()) === 'wallpaper' && (await count('.onb-wall canvas')) >= 12, 'Wallpaper: every preset drawn as a thumbnail');
  await page.click('.onb-wall[data-wp="aurora"]');
  await sleep(300);
  ok((await settings()).wallpaper?.id === 'aurora' && (await exists('.onb-wall[data-wp="aurora"].on')), 'picking Aurora sets the wallpaper');
  await shot(P + 'onb-05-wallpaper');

  // ——— 6. Home screen: Add my sites (Chrome's top sites, stubbed) ———
  const starter = await getStorage(['home', 'dock']);
  const starterSites = starter.home[0].filter((x) => x.type === 'site');
  const wiki = starterSites.find((x) => x.url.includes('wikipedia'));
  const TOP = [
    { url: 'https://example.org/', title: 'Example Domain' },
    { url: 'https://news.ycombinator.com/', title: 'Hacker News' },
    { url: 'https://www.wikipedia.org/', title: 'Wikipedia' },
    { url: 'https://developer.mozilla.org/en-US/', title: 'MDN Web Docs' },
  ];
  await page.evaluate((top) => { chrome.topSites.get = async () => top; }, TOP);
  await next(700);
  ok((await step()) === 'home' && (await count('.onb-choice')) === 2, 'Home screen: Add my sites or keep the starter layout');
  ok(await exists('.onb-choice[data-home="mine"].on'), 'Add my sites is chosen when Chrome has top sites');
  ok((await count('.onb-fav img')) === 4, 'it shows their icons');
  await shot(P + 'onb-06-home');
  await next(600);
  const home = (await getStorage('home')).home;
  const first = home[0];
  const sites = first.filter((x) => x.type === 'site');
  ok(JSON.stringify(sites.map((s) => new URL(s.url).hostname)) === JSON.stringify(TOP.map((s) => new URL(s.url).hostname)), 'first Home page now holds the person’s sites in Chrome’s order: ' + sites.map((s) => s.title).join(', '));
  ok(!wiki || sites.find((s) => s.url.includes('wikipedia'))?.id === wiki.id, 'a site already there keeps its icon (same item)');
  ok(first.filter((x) => x.type !== 'site').length === starter.home[0].filter((x) => x.type !== 'site').length, 'widgets and apps stay where they were');
  ok(!home.flat().some((x) => x.type === 'site' && x.url.includes('github.com')), 'starter websites that aren’t among them made room');
  ok(sites.find((s) => s.url.includes('ycombinator'))?.title === 'Hacker News' && sites.find((s) => s.url.includes('mozilla'))?.title === 'MDN Web Docs', 'titles cleaned up');

  // ——— 7. search engine and AI assistant ———
  ok((await step()) === 'search', 'Search and AI');
  await page.click('.ou-chip[data-search-engine="duckduckgo"]');
  await page.click('.ou-chip[data-ai-assistant="perplexity"]');
  await sleep(250);
  let s = await settings();
  ok(s.searchEngine === 'duckduckgo' && s.aiAssistant === 'perplexity', 'chips set searchEngine and aiAssistant');
  ok((await count('.ou-chip.active')) === 2, 'one chip lit in each row');
  await shot(P + 'onb-07-search');

  // ——— 8. optional permissions: skipped ———
  await next();
  ok((await step()) === 'permissions' && (await count('[data-perm]')) === 2, 'Permissions page explains bookmarks and history for Finder');
  ok((await nextLabel()) === (await S('onb.skip')), 'with both off the button says Skip');
  await shot(P + 'onb-08-permissions');
  await next();
  s = await settings();
  ok(!s.finderBookmarks && !s.finderHistory, 'skipped: Finder bookmarks/history stay off');
  ok(!(await page.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))) && !(await page.evaluate(() => chrome.permissions.contains({ permissions: ['history'] }))), 'and no permission was asked for or granted');

  // ——— 9. Lock screen style ———
  ok((await step()) === 'lock' && (await count('.onb-lock')) === 4, 'Lock screen: four clock styles on the wallpaper');
  await page.click('.onb-lock[data-clock="classic"]');
  await page.click('.ou-chip[data-font="serif"]');
  await sleep(250);
  s = await settings();
  ok(s.clockStyle === 'classic' && s.clockFont === 'serif', 'picked Classic in Serif');
  ok(await exists('.onb-lock[data-clock="classic"].on') && (await page.evaluate(() => getComputedStyle(document.querySelector('.onb-lock .set-lock-clock')).fontFamily)).includes('Georgia'), 'previews redraw in the chosen font');
  ok((await outside('.onb-lock, .onb-next, .onb-back')).length === 0, 'everything fits on screen');
  await shot(P + 'onb-09-lock');

  // ——— 10. done → Start ———
  await next();
  ok((await step()) === 'done' && (await nextLabel()) === (await S('onb.start')), 'last page: ' + (await S('onb.doneTitle')) + ' → ' + (await S('onb.start')));
  ok(!(await visible('.onb-back')) && (await count('.onb-tips .ou-row')) === 3, 'three tips, no Back');
  await shot(P + 'onb-10-done');
  f = await flash();
  ok(f.n === 0, `the shell never showed during the tour (${f.n} ${f.what})`);
  await page.evaluate(() => { window.__tourDone = true; localStorage.setItem('bt.test.whatsnew', '1'); });
  await next(800);
  s = await settings();
  ok(!(await exists('.onb')) && !(await page.evaluate(() => document.documentElement.classList.contains('onb-pending'))), 'Start closes the tour');
  ok(s.onboarded === true && s.seenVersion === version, `settings.onboarded = true, seenVersion = ${s.seenVersion}`);
  ok(!(await page.evaluate(() => document.body.classList.contains('locked'))) && (await visible('#home')), 'the Home screen shows, unlocked');
  await sleep(900);
  ok(!(await exists('.wn-dialog')), 'a new user gets no What’s new after the tour');
  await shot(P + 'onb-11-home-after');
  await page.reload();
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(1200);
  ok(!(await exists('.onb')) && !(await exists('.wn-dialog')), 'next tab: no tour, no What’s new (same version)');

  // ——— 11. an existing user (Home layout, no `onboarded`) gets What's new once, after unlock ———
  await page.evaluate(() => localStorage.setItem('bt.test.noflash', '1'));
  await setStorage({ settings: { theme, lang: ui, lockMode: 'always', reduceMotion: true } });
  await page.reload();
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(1200);
  s = await settings();
  ok(!(await exists('.onb')) && s.onboarded === true, 'existing user with a Home layout: no tour, marked onboarded');
  ok(await page.evaluate(() => document.body.classList.contains('locked')) && !(await exists('.wn-dialog')), 'What’s new waits while the Lock screen shows');
  await page.keyboard.press('Enter');
  await until(() => exists('.wn-dialog'), 4000);
  await sleep(400);
  ok(await visible('.wn-dialog'), 'after unlocking, What’s new appears');
  ok((await text('.wn-dialog .ou-dialog-title')) === (await S('wn.title')) && (await text('.wn-ver')) === (await S('wn.version', { v: version })), 'One UI dialog: ' + (await S('wn.title')) + ' · ' + version);
  const feats = await page.evaluate(() => [...document.querySelectorAll('.wn-row')].map((r) => r.dataset.feature));
  const expect = await page.evaluate(() => import('./js/shell/whatsnew.js').then((m) => m.whatsNewItems().map((f) => f.app || f.id)));
  ok(feats.length >= 8 && JSON.stringify(feats) === JSON.stringify(expect) && feats.includes('dailyboard') && feats.includes('wallet'), `rows for every new app and shell feature (${feats.length}: ${feats.join(', ')})`);
  ok((await settings()).seenVersion === version, 'seenVersion recorded when it showed');
  await shot(P + 'onb-12-whatsnew');
  await page.click('.wn-dialog .ou-dialog-btn.primary');
  await sleep(400);
  ok(!(await exists('.wn-dialog')), 'OK closes it');
  await page.reload();
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1200);
  ok(!(await exists('.wn-dialog')), 'shown once: not again on the next tab');

  // a row opens its app
  await setStorage({ settings: { ...(await settings()), seenVersion: '0.0.1', lockMode: 'never' } });
  await page.reload();
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await until(() => exists('.wn-row[data-feature="wallet"]'), 4000);
  await page.click('.wn-row[data-feature="wallet"]');
  await sleep(900);
  ok(!(await exists('.wn-dialog')) && (await page.evaluate(() => import('./js/core/apps.js').then((m) => m.currentApp()))) === 'wallet', 'clicking a row opens that app');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true)));
  await sleep(300);

  // ——— 12. Settings › About › What's new ———
  await page.evaluate(() => localStorage.removeItem('bt.test.whatsnew'));
  await ctx.openApp('settings', { page: 'about' });
  await sleep(300);
  ok(await visible('.set-whatsnew'), 'Settings › About has a What’s new row');
  await page.click('.set-whatsnew');
  await until(() => exists('.wn-dialog'), 3000);
  await sleep(300);
  ok(await visible('.wn-dialog .wn-row'), 'it opens the What’s new sheet');
  await shot(P + 'onb-13-about-whatsnew');
  await page.keyboard.press('Escape');
  await sleep(400);
  ok(!(await exists('.wn-dialog')), 'Esc closes it');
  await ctx.closeApp();

  // ——— 13. narrow window ———
  const from = logs.length;
  await page.setViewport({ width: 400, height: 760 });
  await sw.evaluate(() => chrome.storage.local.remove(['home', 'dock']));
  await setStorage({ settings: { theme, lang: ui, lockMode: 'never', reduceMotion: true } });
  await page.reload();
  await page.waitForSelector('.onb', { timeout: 20000 });
  await sleep(600);
  await next(); await next(); await next();
  // 22 wallpapers don't fit a narrow window: the grid scrolls, while the buttons always stay on screen
  ok((await step()) === 'wallpaper' && (await outside('.onb-next, .onb-back, .onb-dots')).length === 0, 'narrow window: Back, Next and the dots fit');
  ok((await outside('.onb-wall:nth-child(-n+3)')).length === 0, 'narrow window: the first row of wallpapers is fully visible');
  const lastReachable = await page.evaluate(() => {
    const last = [...document.querySelectorAll('.onb-wall')].pop();
    last.scrollIntoView({ block: 'nearest' });
    const r = last.getBoundingClientRect(), nb = document.querySelector('.onb-next').getBoundingClientRect();
    return r.bottom <= innerHeight && r.top >= 0 && (r.bottom <= nb.top || r.right <= nb.left);
  });
  ok(lastReachable, 'narrow window: the grid scrolls to the last wallpaper');
  await page.evaluate(() => document.querySelector('.onb-wall').scrollIntoView({ block: 'nearest' }));
  await shot(P + 'onb-14-narrow-wallpaper');
  await next(700);
  ok((await outside('.onb-choice, .onb-next')).length === 0, 'narrow window: Home screen choices fit');
  await shot(P + 'onb-15-narrow-home');
  ok(pageErrors(from) === 0, 'no page errors');
  await page.evaluate(() => { localStorage.removeItem('bt.test.tour'); localStorage.removeItem('bt.test.noflash'); });
  await page.setViewport({ width: 1440, height: 900 });
};
