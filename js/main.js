// Entry point: load state, apply theme, register apps/widgets, build the shell.
import { store, setting, onSetting } from './core/store.js';
import { detectLang, setLang } from './core/i18n.js';
import { applyTheme } from './shell/theme.js';
import { openApp } from './core/apps.js';

// Apps and widgets register themselves when imported (one line per app). Each loads on its own, so a broken
// app logs an error and stays out of the Home screen instead of stopping the page. Keep these files light:
// big apps register here and import their UI from js/<app>/ when opened (see core/apps.js).
const MODULES = [
  './apps/contacts.js',
  './apps/settings.js',
  './apps/weather.js',
  './apps/clock.js',
  './apps/notes.js',
  './apps/reminder.js',
  './apps/calendar.js',
  './apps/calculator.js',
  './shell/basic-widgets.js',
  './apps/music.js',
  './apps/store.js',
  './apps/interpreter.js',
  './apps/recorder.js',
  './apps/wallet.js',
  './apps/journal.js',
  './apps/games.js',
  './apps/canvas.js',
  './apps/health.js',
  './apps/wellbeing.js',
  './apps/routines.js',
  './apps/files.js',
  './shell/dailyboard.js',
];

import { initWallpaper } from './shell/wallpaper.js';
import { initStatusbar } from './shell/statusbar.js';
import { initHome } from './shell/home.js';
import { initDrawer } from './shell/drawer.js';
import { initFinder } from './shell/finder.js';
import { initQuickPanel } from './shell/quickpanel.js';
import { initEdge } from './shell/edge.js';
import { initLock, unlock } from './shell/lock.js';
import { initKeys } from './shell/keys.js';

async function boot() {
  await store.init();
  setLang(detectLang());
  applyTheme();
  // Welcome tour (first run): it goes up before the Lock and Home screens are built, so neither flashes behind it
  if (setting('onboarded') !== true) await import('./shell/onboarding.js').then((m) => m.startTour()).catch((e) => console.error('tour', e));
  await Promise.all(MODULES.map((m) => import(m).catch((e) => console.error('module', m, e))));

  initWallpaper();
  await initLock(); // decides whether this tab starts locked before anything is shown
  initStatusbar();
  initHome();
  initDrawer();
  initFinder();
  initQuickPanel();
  initEdge();
  initKeys();

  onSetting('lang', () => location.reload());
  requestAnimationFrame(() => document.body.classList.remove('booting'));
  window.__bootMs = Math.round(performance.now()); // the dev tests wait for this

  // What's new after an update (shown once, after unlock; new users finish the tour on this version instead)
  const ver = globalThis.chrome?.runtime?.getManifest?.().version;
  if (ver && setting('onboarded') === true && setting('seenVersion') !== ver) import('./shell/whatsnew.js').then((m) => m.autoWhatsNew());

  // newtab.html#open=<app>&s=<section> (notification clicks): the app gets params.section
  const m = location.hash.match(/^#open=([\w-]+)(?:&s=([^&]*))?/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    unlock().then(() => openApp(m[1], { params: m[2] ? { section: decodeURIComponent(m[2]) } : {} }));
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.classList.remove('booting');
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;color:#fff;background:#c00a;padding:12px;border-radius:12px;white-space:pre-wrap;z-index:999">${String(e?.stack || e)}</pre>`);
});

