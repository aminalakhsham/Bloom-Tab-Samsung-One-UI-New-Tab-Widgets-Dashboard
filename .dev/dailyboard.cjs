// triple
// Daily Board (One UI's ambient mode): opens from the Quick panel tile, the Finder command and Settings › Daily Board ›
// Start now; Photo frame (wallpaper or the person's photos from IndexedDB, slideshow), Clock (digital in a Lock screen
// font, analog), Calendar (today, month, events) and Widgets (two Home screen widgets) pages; arrows, swipe and
// dots; music card for a registered media source (buttons don't close it); night mode; wake lock; keys don't reach
// the shell; Esc/click go back to where you were (Home, an app, the Lock screen); idle start on the Lock screen;
// the Settings page (photos, choices, switches) and its data in store `dailyBoard`.
// usage: .dev/run.sh .dev/dailyboard.cjs      (THEME=dark, UI=ar)
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async (ctx) => {
  const { page, boot, ok, sleep, shot, P, mod, exists, visible, count, text, texts, ui, getStorage, outside, openApp, closeApp } = ctx;
  const rtl = ui === 'ar';
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
  const state = () => page.evaluate(() => import('./js/shell/dailyboard-ui.js').then((m) => m.boardState()));
  const prefs = async () => (await getStorage('dailyBoard')).dailyBoard || {};
  const setPrefs = (p) => page.evaluate((p) => import('./js/shell/dailyboard.js').then((m) => m.savePrefs(p)), p);
  const openBoard = async (opts) => { await page.evaluate((o) => import('./js/shell/dailyboard.js').then((m) => m.openDailyBoard(o)), opts || {}); await until(() => exists('.db.show')); await sleep(400); };
  const isOpen = () => exists('.db:not(.closing)');
  const closedAfter = async (ms = 700) => { await sleep(ms); return !(await exists('.db')); };
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  const press = async (k, wait = 650) => { await page.keyboard.press(k); await sleep(wait); };
  const pageOn = () => page.evaluate(() => document.querySelector('.db')?.dataset.page);
  const H = 3600e3;
  const now = Date.now();
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });

  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const weather = {
    fetchedAt: now, location: { name: 'Testville', lat: 48.85, lon: 2.35, auto: false }, timezone: 'Europe/Paris',
    current: { temp: 21.6, code: 0, isDay: true, feels: 21, humidity: 50, wind: 10, windDir: 200, uv: 3, high: 24, low: 14 },
    hourly: Array.from({ length: 25 }, (_, i) => ({ time: now + i * H, temp: 20, code: 0, isDay: true, pop: 0 })),
    daily: Array.from({ length: 10 }, (_, i) => ({ date: day0.getTime() + i * 864e5, min: 14, max: 24, code: 0, pop: 0, sunrise: now - 3 * H, sunset: now + 3 * H, uv: 3 })),
  };
  const evStart = now + 2 * H;
  await boot({
    settings: { location: { name: 'Testville', lat: 48.85, lon: 2.35 }, clockFont: 'outfit' },
    data: { weather, events: [{ id: 'e1', title: 'Design review', start: evStart, end: evStart + H, allDay: false, color: '#e5484d' }], home: [[W('w1', 'weather', 'm')]], dock: [] },
  });

  // ——— 1. Quick panel tile ———
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(500);
  const tileLabel = await S('db.title');
  ok(await page.evaluate((l) => !![...document.querySelectorAll('.qp-tile')].find((x) => x.title === l), tileLabel), 'Quick panel has a Daily Board tile');
  await page.evaluate((l) => [...document.querySelectorAll('.qp-tile')].find((x) => x.title === l).click(), tileLabel);
  await until(() => exists('.db.show'));
  await sleep(600);
  ok(await visible('.db') && !(await page.evaluate(() => import('./js/shell/quickpanel.js').then((m) => m.isQuickPanelOpen()))), 'the tile closes the panel and opens Daily Board full screen');
  ok((await pageOn()) === 'photo', 'it opens on the Photo frame');
  ok(await exists('.db-photo .db-canvas'), 'no photos yet: the animated wallpaper fills the frame');
  const hm = await mod('./js/core/i18n.js', 'fmtHM');
  ok((await text('.db-photo .db-hm')) === hm, 'clock shows ' + hm);
  ok((await text('.db-photo .db-date')).length > 4, 'date: ' + (await text('.db-photo .db-date')));
  const facts = await texts('.db-photo .db-chip');
  ok(facts.some((x) => x.includes('22°') && x.includes('Testville')), 'weather chip: ' + facts[0]);
  ok(facts.some((x) => x.includes('Design review')), 'next event chip: ' + facts[1]);
  ok((await count('.db-dot')) === 4 && (await exists('.db-dot.on:first-child')), 'four page dots, the first one current');
  ok(await visible('.db-hint'), 'a hint explains swiping and exiting');
  await shot(P + 'db-01-photo-wallpaper');

  // keys stay in the board
  await press('k', 300);
  ok(!(await page.evaluate(() => import('./js/shell/finder.js').then((m) => m.isFinderOpen()))) && (await isOpen()), 'typing doesn’t open Finder behind the board');

  // ——— 2. pages: arrows ———
  await press(fwd);
  ok((await pageOn()) === 'clock', 'arrow → Clock page');
  ok((await text('.db-clockpage .db-hm')) === (await mod('./js/core/i18n.js', 'fmtHM')), 'big digital clock');
  const ff = await page.evaluate(() => getComputedStyle(document.querySelector('.db-clockpage .db-digital')).fontFamily);
  ok(ff.includes('Outfit'), 'in the Lock screen font (' + ff.split(',')[0] + ')');
  const tr = await page.evaluate(() => { const r = document.querySelector('.db-clockpage').getBoundingClientRect(); return { x: r.left, w: r.width }; });
  ok(Math.abs(tr.x) < 2, 'the Clock page slid into view');
  await shot(P + 'db-02-clock');
  await press(fwd);
  ok((await pageOn()) === 'calendar', 'Calendar page');
  ok((await text('.db-md.today')) === String(new Date().getDate()) && (await text('.db-cal-num')) === String(new Date().getDate()), 'today is circled in the month and shown big');
  ok((await texts('.db-cal-ev b')).includes('Design review'), 'upcoming events listed');
  ok((await count('.db-mh')) === 7, 'week day headers');
  await shot(P + 'db-03-calendar');
  await press(fwd);
  ok((await pageOn()) === 'widgets', 'Widgets page');
  const slots = await page.evaluate(() => [...document.querySelectorAll('.db-wslot')].map((s) => ({ id: s.dataset.widget, kids: s.querySelector('.wg').childElementCount, scale: s.querySelector('.wg').style.transform })));
  ok(slots.length === 2 && slots[0].id === 'weather' && slots[1].id === 'calendar-month', 'two widgets: weather and calendar');
  ok(slots.every((s) => s.kids > 0 && /scale\(/.test(s.scale)), 'rendered and scaled to fill their half: ' + slots.map((s) => s.scale).join(', '));
  ok((await outside('.db-wslot')).length === 0, 'widgets stay on screen');
  await shot(P + 'db-04-widgets');
  await press(fwd);
  ok((await pageOn()) === 'photo', 'after the last page it wraps to the first');
  await press(back);
  ok((await pageOn()) === 'widgets', 'and back');
  await page.click('.db-dot:nth-child(2)');
  await sleep(600);
  ok((await pageOn()) === 'clock' && (await isOpen()), 'a page dot jumps to its page without closing');

  // ——— 3. swipe ———
  const W0 = page.viewport().width, H0 = page.viewport().height;
  await page.mouse.move(W0 / 2, H0 / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(W0 / 2 + (rtl ? 40 : -40) * i, H0 / 2); await sleep(16); }
  await page.mouse.up();
  await sleep(700);
  ok((await pageOn()) === 'calendar' && (await isOpen()), 'a swipe goes to the next page and doesn’t close the board');
  ok((await prefs()).page === 'calendar', 'the last page is remembered');

  // ——— 4. a click goes back to where you were ———
  await page.mouse.click(W0 / 2, H0 / 2);
  ok(await closedAfter(), 'a click closes Daily Board');
  ok(!(await page.evaluate(() => document.body.classList.contains('locked'))) && (await visible('#home')), 'back on the Home screen');

  // ——— 5. Finder command, Esc ———
  await mod('./js/shell/finder.js', 'openFinder', 'daily board');
  await sleep(700);
  const cmd = await S('db.cmd');
  ok((await texts('#finder *')).some((x) => x === cmd), 'Finder offers “' + cmd + '”');
  await page.evaluate((c) => [...document.querySelectorAll('#finder button, #finder [role="option"], #finder .fd-item, #finder li')].find((x) => x.textContent.includes(c))?.click(), cmd);
  await until(() => exists('.db.show'));
  await sleep(500);
  ok(await isOpen() && !(await page.evaluate(() => import('./js/shell/finder.js').then((m) => m.isFinderOpen()))), 'running it closes Finder and opens the board on the last page (' + (await pageOn()) + ')');
  await press('Escape', 500);
  ok(await closedAfter(200), 'Esc closes it');
  ok(!(await page.evaluate(() => import('./js/shell/finder.js').then((m) => m.isFinderOpen()))), 'and Esc didn’t reach anything else');

  // ——— 6. wake lock ———
  await page.evaluate(() => {
    window.__wake = [];
    navigator.wakeLock.request = async (type) => {
      const l = new EventTarget();
      l.release = async () => window.__wake.push('release');
      window.__wake.push(type);
      return l;
    };
  });
  await openBoard({ page: 'clock' });
  ok((await page.evaluate(() => window.__wake[0])) === 'screen' && (await state()).awake, 'keeps the screen awake with a Screen Wake Lock');
  await press('Escape', 500);
  ok((await page.evaluate(() => window.__wake.includes('release'))), 'and releases it on exit');
  await setPrefs({ awake: false });
  await page.evaluate(() => (window.__wake = []));
  await openBoard();
  ok((await page.evaluate(() => window.__wake.length)) === 0, 'Keep screen on off: no wake lock');
  await press('Escape', 400);
  await setPrefs({ awake: true });

  // ——— 7. music card ———
  await page.evaluate(() => {
    window.__ms = { title: 'Midnight City', sub: 'M83', playing: true, icon: 'music', color: '#e5484d' };
    window.__ctl = [];
    return import('./js/core/hooks.js').then((m) => m.registerMedia({
      id: 'dbtest', state: () => window.__ms,
      toggle() { window.__ctl.push('toggle'); if (window.__ms) window.__ms.playing = !window.__ms.playing; window.__msFn?.(); },
      next() { window.__ctl.push('next'); }, prev() { window.__ctl.push('prev'); },
      subscribe(fn) { window.__msFn = fn; return () => {}; },
    }));
  });
  await openBoard({ page: 'photo' });
  ok(await visible('.db-music') && (await text('.db-music-text b')) === 'Midnight City', 'music card for the playing source');
  await shot(P + 'db-05-music');
  await page.click('.db-music .db-mbtn:nth-child(2)');
  await sleep(400);
  ok((await page.evaluate(() => window.__ctl.join())) === 'toggle' && (await isOpen()), 'play/pause works and doesn’t close the board');
  await page.click('.db-music .db-mbtn:nth-child(3)');
  await press(' ', 300);
  ok((await page.evaluate(() => window.__ctl.join())) === 'toggle,next,toggle', 'next button and the space bar reach the source');
  await page.evaluate(() => { window.__ms = null; window.__msFn?.(); });
  await sleep(300);
  ok(!(await visible('.db-music')), 'the card goes away when nothing is loaded');
  await press('Escape', 400);

  // ——— 8. night mode, analog clock, fonts ———
  const hr = new Date().getHours();
  await setPrefs({ night: true, nightFrom: hr, nightTo: (hr + 1) % 24, clock: 'analog' });
  await openBoard({ page: 'clock' });
  ok(await exists('.db.night') && (await state()).night, `night mode between ${hr}:00 and ${(hr + 1) % 24}:00: dim red`);
  const hand = await page.evaluate(() => document.querySelector('.db-clockpage .db-analog .mm')?.getAttribute('transform'));
  const want = new Date().getMinutes() * 6;
  ok(hand && Math.abs(parseFloat(hand.match(/rotate\(([\d.]+)/)[1]) - want) <= 6.5, 'analog clock: minute hand at ' + hand);
  await shot(P + 'db-06-night-analog');
  await press('Escape', 400);
  await setPrefs({ nightFrom: (hr + 2) % 24, nightTo: (hr + 3) % 24, clock: 'digital', font: 'serif' });
  await openBoard({ page: 'clock' });
  ok(!(await exists('.db.night')), 'outside those hours: normal colours');
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('.db-clockpage .db-digital')).fontFamily)).includes('Georgia'), 'digital clock in the Serif Lock screen font');
  const nightLogic = await page.evaluate(() => import('./js/shell/dailyboard-ui.js').then((m) => [
    m.isNight({ night: true, nightFrom: 22, nightTo: 7 }, new Date(2026, 0, 1, 23)), m.isNight({ night: true, nightFrom: 22, nightTo: 7 }, new Date(2026, 0, 1, 3)),
    m.isNight({ night: true, nightFrom: 22, nightTo: 7 }, new Date(2026, 0, 1, 12)), m.isNight({ night: false, nightFrom: 22, nightTo: 7 }, new Date(2026, 0, 1, 23)),
  ]));
  ok(JSON.stringify(nightLogic) === '[true,true,false,false]', 'night hours wrap around midnight (22→7)');
  await press('Escape', 400);

  // ——— 9. Settings › Daily Board, photos ———
  await openApp('settings', { page: 'dailyboard' });
  await sleep(500);
  ok(await visible('.dbs-hero .dbs-prev') && (await exists('.dbs-start')), 'Settings › Daily Board: preview and Start now');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbtest-'));
  const pngs = [];
  for (const [i, c] of ['#e2589c', '#3e7bff'].entries()) {
    const data = await page.evaluate((c) => { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.fillRect(40, 40, 120, 80); return cv.toDataURL('image/png').split(',')[1]; }, c);
    const f = path.join(tmp, `p${i}.png`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    pngs.push(f);
  }
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('.dbs-photo-add')]);
  await chooser.accept(pngs);
  await until(async () => (await count('.dbs-photo')) === 2, 6000);
  let p = await prefs();
  const blobs = await mod('./js/core/blobs.js', 'listBlobs', 'dailyboard:');
  ok((await count('.dbs-photo')) === 2 && p.photos?.length === 2 && p.source === 'photos', 'Add photos: two pictures, source switched to My photos');
  ok(blobs.length === 2 && p.photos.every((id) => blobs.includes('dailyboard:' + id)), 'stored in IndexedDB as dailyboard:<id>');
  await sleep(300);
  await shot(P + 'db-07-settings');

  // choices and switches
  const pick = async (sel, idx) => {
    await page.click(sel);
    await until(() => exists('.ou-dialog .ou-radio-row'));
    await sleep(250);
    await page.evaluate((i) => document.querySelectorAll('.ou-dialog .ou-radio-row')[i].click(), idx);
    await page.click('.ou-dialog-btn.primary');
    await sleep(400);
  };
  await pick('[data-pref="idleMin"]', 3);
  ok((await prefs()).idleMin === 10 && (await text('[data-pref="idleMin"] .ou-row-sub')) === (await S('db.afterMin', { n: 10 })), 'Start automatically → after 10 min on the Lock screen');
  await pick('[data-pref="interval"]', 0);
  ok((await prefs()).interval === 5, 'Change photos every 5 seconds');
  await page.click('[data-pref="night"]');
  await sleep(250);
  ok((await prefs()).night === false, 'Night mode switch');
  await page.click('[data-pref="night"]');
  await sleep(250);
  const wOpts = await page.evaluate(() => import('./js/core/widgets.js').then((m) => m.getWidgets().length));
  await page.click('[data-widget-slot="1"]');
  await until(() => exists('.ou-dialog .ou-radio-row'));
  ok((await count('.ou-dialog .ou-radio-row')) === wOpts, 'a widget slot offers every widget (' + wOpts + ')');
  await page.evaluate(() => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((r) => r.querySelector('input').checked === false && r.textContent)?.click());
  await page.click('.ou-dialog-btn.primary');
  await sleep(300);
  p = await prefs();
  ok(p.widgets[1] && p.widgets[1] !== 'calendar-month' && p.widgets[0] === 'weather', 'second widget changed to ' + p.widgets[1]);
  await page.click('.dbs-fonts .ou-chip[data-font="mono"]').catch(() => {});
  await sleep(200);
  ok((await prefs()).font === 'mono', 'clock font chip');
  await shot(P + 'db-08-settings-bottom');

  // Start now from Settings: the slideshow; Esc returns to Settings
  await page.click('.dbs-start');
  await until(() => exists('.db.show'));
  await press(back, 300);
  await press(back, 300);
  await sleep(500);
  if ((await pageOn()) !== 'photo') await page.click('.db-dot:nth-child(1)');
  await sleep(1200);
  const slide = await page.evaluate(() => ({ n: document.querySelector('.db-photo .db-bg')?.dataset.photos, i: document.querySelector('.db-photo .db-bg')?.dataset.index, bg: getComputedStyle(document.querySelector('.db-photo .db-slide.on') || document.body).backgroundImage }));
  ok(slide.n === '2' && slide.bg.startsWith('url("blob:'), 'Photo frame shows my photos (' + slide.n + ')');
  await shot(P + 'db-09-photo');
  await sleep(5600);
  const i2 = await page.evaluate(() => document.querySelector('.db-photo .db-bg')?.dataset.index);
  ok(i2 !== slide.i, `slideshow moved on after 5 s (${slide.i} → ${i2})`);
  await press('Escape', 500);
  const after = await page.evaluate(() => import('./js/core/apps.js').then((m) => ({ app: m.currentApp(), db: !!document.querySelector('.db:not(.closing)'), fs: !!document.fullscreenElement })));
  ok(!after.db && after.app === 'settings', 'Esc goes back to Settings ' + JSON.stringify(after));

  // remove a photo
  await page.click('.dbs-photo .dbs-photo-del');
  await until(async () => (await count('.dbs-photo')) === 1);
  p = await prefs();
  ok(p.photos.length === 1 && (await mod('./js/core/blobs.js', 'listBlobs', 'dailyboard:')).length === 1, 'removing a photo deletes its picture too');
  await closeApp();

  // ——— 10. starts by itself on an idle Lock screen; exits back to the Lock screen ———
  await setPrefs({ idleMin: 5 });
  ok(!(await mod('./js/shell/dailyboard.js', 'idleTick', Date.now() + 6 * 60e3)), 'not while unlocked');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(500);
  ok(!(await mod('./js/shell/dailyboard.js', 'idleTick', Date.now() + 60e3)), 'not before 5 minutes');
  ok(await mod('./js/shell/dailyboard.js', 'idleTick', Date.now() + 6 * 60e3), 'after 5 idle minutes on the Lock screen it starts');
  await until(() => exists('.db.show'));
  await sleep(500);
  ok((await state())?.auto === true, 'automatic start');
  await shot(P + 'db-10-auto');
  await press('Escape', 500);
  ok(!(await isOpen()) && (await page.evaluate(() => document.body.classList.contains('locked'))), 'Esc goes back to the Lock screen, still locked');
  await setPrefs({ idleMin: 0 });
  ok(!(await mod('./js/shell/dailyboard.js', 'idleTick', Date.now() + 99 * 60e3)), 'Never: no automatic start');
  await page.keyboard.press('Enter');
  await sleep(500);

  // ——— 10a. a repeating event marks every day it happens in the month (Calendar's eventDays()) ———
  const wkD = new Date(); wkD.setHours(9, 0, 0, 0); wkD.setDate(wkD.getDate() - 35);
  await page.evaluate((st) => import('./js/core/store.js').then((m) => m.store.set('events', [...(m.store.get('events') || []), { id: 'wk1', title: 'Weekly sync', start: st, end: st + 1800e3, allDay: false, repeat: { freq: 'week', interval: 1 } }])), +wkD);
  await sleep(300);
  await openBoard({ page: 'calendar' });
  const wkMarks = await page.evaluate((wd) => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const cells = [...document.querySelectorAll('.db-calpage .db-md')];
    const want = cells.filter((c) => new Date(y, m, +c.textContent).getDay() === wd);
    return { n: want.length, busy: want.filter((c) => c.classList.contains('busy')).length };
  }, wkD.getDay());
  ok(wkMarks.n >= 4 && wkMarks.busy === wkMarks.n, `a weekly event marks every ${wkD.getDay()}-weekday of the month (${wkMarks.busy}/${wkMarks.n})`);
  await press('Escape', 600);

  // ——— 10b. a PIN guards the Lock screen: the board shows nothing it protects ———
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(300);
  await mod('./js/shell/pin.js', 'setPin', '1234');
  await sleep(300);
  await setPrefs({ page: 'widgets' });
  await openBoard();
  ok((await count('.db-wslot .wg')) === 2 && !(await exists('.db-wlocked')), 'PIN set but unlocked: the widgets show');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(1400);
  ok(await isOpen(), 'locking underneath keeps the board up');
  ok((await count('.db-wlocked')) === 2 && (await count('.db-wslot .wg')) === 0, 'locked with a PIN: both widgets give way to a padlock');
  ok((await text('.db-wlocked span:last-child')) === (await S('db.unlockToSee')), 'with "Unlock to see this widget"');
  const privChips = (await texts('.db-photo .db-chip')).join(' ') + ' ' + (await texts('.db-cal-ev b')).join(' ');
  ok(!privChips.includes('Design review') && privChips.includes(await S('db.event')), 'event titles are hidden on the photo and calendar pages');
  await shot(P + 'db-10b-private');
  await press('Escape', 600);
  await mod('./js/shell/pin.js', 'removePin');
  await sleep(300);
  await openBoard({ page: 'widgets' });
  await sleep(1200);
  ok((await count('.db-wslot .wg')) === 2 && !(await exists('.db-wlocked')), 'no PIN: the widgets show on a locked screen (anyone can swipe up anyway)');
  await press('Escape', 600);
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(300);
  await setPrefs({ page: 'photo' });

  // ——— 11. narrow window ———
  await page.setViewport({ width: 480, height: 820 });
  await setPrefs({ source: 'wallpaper', page: 'calendar' });
  await openBoard();
  ok((await outside('.db-cal-left, .db-month')).length === 0, 'narrow window: calendar stacks and fits');
  await shot(P + 'db-11-narrow-calendar');
  await press(fwd);
  ok((await outside('.db-wslot')).length === 0, 'narrow window: widgets stack and fit');
  await press('Escape', 400);
  await page.setViewport({ width: 1440, height: 900 });
};
