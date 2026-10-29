// Smoke test: boots, opens every registered app in both languages and themes, opens each shell surface,
// and checks nothing throws. usage: .dev/run.sh .dev/smoke.cjs
module.exports = async ({ page, boot, ok, sleep, shot, logs, openApp, closeApp, mod, exists }) => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
    await boot({ settings: { lang, theme } });
    ok(await exists('#home .home-page, #home [class*="page"]'), `${lang}/${theme}: home screen rendered`);
    ok(await page.evaluate(() => document.documentElement.dir) === (lang === 'ar' ? 'rtl' : 'ltr'), `${lang}: direction`);
    const apps = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().filter((a) => !a.launch).map((a) => a.id)));
    for (const id of apps) {
      const before = logs.length;
      await openApp(id);
      ok(await exists('.app-win'), `${lang}: ${id} opens`);
      ok(!(await exists('.app-error')), `${lang}: ${id} renders without error`);
      if (id === apps[0]) await shot(`smoke-${lang}-${theme}-${id}`);
      await closeApp();
      ok(!logs.slice(before).some((l) => l.includes('pageerror')), `${lang}: ${id} no page errors`);
    }
    for (const [file, fn, close] of [['./js/shell/quickpanel.js', 'openQuickPanel', 'closeQuickPanel'], ['./js/shell/drawer.js', 'openDrawer', 'closeDrawer'],
      ['./js/shell/finder.js', 'openFinder', 'closeFinder'], ['./js/shell/edge.js', 'openEdge', 'closeEdge']]) {
      await mod(file, fn); await sleep(500);
      await shot(`smoke-${lang}-${theme}-${fn}`);
      await mod(file, close); await sleep(400);
    }
    await mod('./js/shell/lock.js', 'lockNow'); await sleep(600);
    await shot(`smoke-${lang}-${theme}-lock`);
    ok(await page.evaluate(() => import('./js/shell/lock.js').then((m) => m.isLocked())), `${lang}: lockNow locks`);
  }
};
