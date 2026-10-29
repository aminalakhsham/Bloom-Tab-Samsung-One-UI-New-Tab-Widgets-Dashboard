// triple
// Screen lock PIN end to end (js/shell/pin.js, js/shell/lock.js, Settings › Lock screen): the wrong-try table, setting a
// PIN in Settings (with a mismatch first), only a PBKDF2 hash stored, the Lock screen keypad (wrong PIN, right PIN,
// typing a digit on the Lock screen, Escape), "Lock automatically" (a new tab within the time doesn't ask, after it
// does), unlock() waiting for the PIN, a deep link (#open=notes) waiting for the PIN, 5 wrong tries → 30 s lockout and
// its end, hidden notification text and private lock widgets, the onUnlock hook, changing the PIN (4 digits, OK key),
// Backup export without the hash and import keeping the PIN, the Journal 'screen' provider, removing the PIN, and
// "Forgot PIN?" erasing everything (store, pictures, alarms).   usage: .dev/run.sh .dev/pin.cjs  (THEME=dark, UI=ar)
const fs = require('fs');
const path = require('path');
module.exports = async (ctx) => {
  const { page, url, sw, boot, ok, sleep, shot, P, mod, exists, visible, count, text, texts, logs, ui } = ctx;
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const pget = (k) => page.evaluate((k) => import('./js/core/store.js').then((m) => m.store.get(k)), k);
  const pset = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.store.set(k, v)), k, v);
  const setSet = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.setSetting(k, v)), k, v);
  const isLocked = () => mod('./js/shell/lock.js', 'isLocked');
  const lockNow = async () => { await mod('./js/shell/lock.js', 'lockNow'); await sleep(500); };
  const keypadUp = () => exists('#lock .pin-lock');
  const press = async (key, wait = 120) => { await page.keyboard.press(key); await sleep(wait); };
  const typeDigits = async (s, wait = 90) => { for (const d of s) await press(d, wait); };
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
  const top = '.app-win .app-stack > .app-page:last-child';
  const row = async (title) => {
    const found = await page.evaluate((sel, t) => {
      const r = [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t);
      r?.click();
      return !!r;
    }, top, title);
    if (!found) ok(false, `row "${title}" exists`);
    await sleep(400);
    return found;
  };
  const rowSub = (title) => page.evaluate((sel, t) => [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t)?.querySelector('.ou-row-sub')?.textContent, top, title);
  const pick = async (n) => {
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 3000 }).catch(() => {});
    await page.evaluate((n) => document.querySelectorAll('.ou-dialog .ou-radio-row')[n - 1]?.click(), n);
    await page.click('.ou-dialog .ou-dialog-btn.primary');
    await sleep(500);
  };
  const noErrors = (from, what) => ok(!logs.slice(from).some((l) => l.includes('[pageerror]')), `${what}: no page errors`);
  const relaunch = async (hash = '', last) => {
    await page.goto('about:blank');
    await sleep(250);
    if (last !== undefined) await sw.evaluate((v) => chrome.storage.session.set({ lastActive: v }), last);
    await page.goto(url + hash);
    await page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
    await sleep(700);
  };
  const PIN = '135790', PIN2 = '2580';

  // ════════════════════════════════════════ the rules
  let mark = logs.length;
  await boot({ data: { home: [[]], dock: [], notes: [{ id: 'n1', title: 'Grocery list', body: 'milk', color: '', pinned: false, created: Date.now(), updated: Date.now() }] } });
  const waits = await page.evaluate(() => import('./js/shell/pin.js').then((m) => [1, 2, 3, 4, 5, 6, 9, 10, 11, 29, 30, 40, 50, 200].map((n) => m.waitAfter(n))));
  ok(JSON.stringify(waits) === JSON.stringify([0, 0, 0, 0, 30e3, 0, 0, 30e3, 30e3, 30e3, 30e3, 60e3, 120e3, 864e5]), `wait table: 30 s after the 5th and 10th, every try from the 11th, doubling from the 30th (${waits})`);
  const valid = await page.evaluate(() => import('./js/shell/pin.js').then((m) => ['123', '1234', '1234567890123456', '12345678901234567', '12a4', ''].map(m.validPin)));
  ok(JSON.stringify(valid) === '[false,true,true,false,false,false]', 'PINs are 4 to 16 digits');

  // ════════════════════════════════════════ Settings › Lock screen › Screen lock type › PIN
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(500);
  const L = { type: await S('set.lk.type'), none: await S('set.lk.none'), swipe: await S('set.lk.swipe'), pin: await S('pin.pin'), secure: await S('set.lk.secure'), after: await S('set.lk.after') };
  ok((await rowSub(L.type)) === L.none, 'Screen lock type: None (lock mode never)');
  await shot(P + 'pin-01-settings-none');
  await row(L.type);
  ok((await count('.ou-dialog .ou-radio-row')) === 3, 'three screen lock types: None, Swipe, PIN');
  await pick(3);
  ok(await exists(top + ' .pin-page'), 'Set PIN page with the keypad');
  ok((await text(top + ' .pin-title')) === (await S('pin.setTitle')) && (await text(top + ' .pin-ok')) === (await S('pin.continue')), 'title "Set a PIN" and a Continue key');
  ok((await count(top + ' .pin-key[data-k]')) === 12 && (await text(top + ' .pin-key[data-k="2"] small')) === 'ABC', 'Samsung keypad: 12 keys, letters under the digits');
  await typeDigits('12');
  ok((await count(top + ' .pin-dots i')) === 2 && (await page.$eval(top + ' .pin-ok', (b) => b.disabled)), 'dots fill as you type; Continue waits for 4 digits');
  await press('Backspace');
  ok((await count(top + ' .pin-dots i')) === 1, 'Backspace removes a digit');
  await press('Backspace');
  await typeDigits(PIN);
  await shot(P + 'pin-02-set');
  await press('Enter', 400);
  ok((await text(top + ' .pin-title')) === (await S('pin.confirm')), 'then "Confirm PIN"');
  await typeDigits('999999');
  await press('Enter', 500);
  ok((await text(top + ' .pin-sub')) === (await S('pin.mismatch')) && (await text(top + ' .pin-title')) === (await S('pin.setTitle')), 'a different PIN: "PINs don’t match", back to the first step');
  await shot(P + 'pin-03-mismatch');
  await typeDigits(PIN);
  await press('Enter', 300);
  await typeDigits(PIN);
  // the OK key (clicked this time)
  await page.click(top + ' .pin-ok');
  await sleep(900);
  const rec = await ctx.store('pin');
  ok(rec && rec.alg === 'PBKDF2-SHA256' && rec.iter >= 100000 && rec.hash && rec.salt && rec.digits === 6 && rec.auto === true, 'store key pin: PBKDF2 hash, salt, 6 digits, auto-confirm on');
  const all = JSON.stringify(await ctx.getStorage(null));
  ok(!all.includes(PIN), 'the PIN itself is nowhere in storage');
  ok((await rowSub(L.type)) === L.pin && (await ctx.store('settings')).lockMode === 'idle', 'Screen lock type: PIN; "Never" became "After inactivity"');
  await shot(P + 'pin-04-settings-pin');
  await row(L.secure);
  ok((await rowSub(L.after)) === (await S('set.lk.afterMin', { n: 5 })), 'Secure lock settings: Lock automatically after 5 minutes by default');
  ok(await exists(top + ' .ou-switch'), 'Confirm PIN without tapping OK offered for 6 digits');
  await shot(P + 'pin-05-secure');
  await ctx.closeApp();
  noErrors(mark, 'set PIN');

  // ════════════════════════════════════════ the Lock screen keypad
  mark = logs.length;
  await lockNow();
  ok(await isLocked(), 'Lock now locks');
  ok(await exists('#lock .lk-padlock svg.ico-lock'), 'a closed padlock over the clock');
  await press('Enter', 500);
  ok(await keypadUp() && (await isLocked()), 'Enter shows the PIN keypad (an explicit lock always asks)');
  ok((await text('#lock .pin-title')) === (await S('pin.enter')), 'title "Enter PIN"');
  ok((await count('#lock .pin-dots.fixed i')) === 6 && !(await visible('#lock .pin-ok')), 'six dots to fill, no OK key (confirm without OK)');
  ok(await visible('#lock .pin-forgot') && await visible('#lock .pin-cancel'), 'Forgot PIN? and Cancel');
  ok((await page.$eval('#lock .lk-top', (e) => getComputedStyle(e).opacity)) === '0', 'the clock and widgets fade behind the keypad');
  await shot(P + 'pin-06-keypad');
  await typeDigits('111111');
  await sleep(500);
  ok((await text('#lock .pin-sub')) === (await S('pin.wrong')) && (await isLocked()), 'a wrong PIN: "Incorrect PIN", still locked');
  ok((await pget('pinTries')).n === 1, 'pinTries counts it');
  await shot(P + 'pin-07-wrong');
  await press('Escape', 400);
  ok(!(await keypadUp()) && (await isLocked()), 'Escape goes back to the Lock screen');
  // a digit typed on the Lock screen is the PIN's first digit
  await press(PIN[0], 500);
  ok(await keypadUp() && (await count('#lock .pin-dots i.on')) === 1, 'typing a digit on the Lock screen opens the keypad with it');
  for (const d of PIN.slice(1)) await page.click(`#lock .pin-key[data-k="${d}"]`);
  await sleep(900);
  ok(!(await isLocked()) && !(await keypadUp()), 'the right PIN (keys clicked) unlocks');
  ok((await pget('pinTries')).n === 0, 'pinTries reset after the right PIN');
  ok(!(await exists('.finder-open, body.finder-open')), 'a digit used for the PIN does not open Finder');
  noErrors(mark, 'keypad');

  // ════════════════════════════════════════ "Lock automatically": a new tab within the time doesn't ask
  mark = logs.length;
  await setSet('lockMode', 'always');
  await sleep(300);
  await relaunch();
  ok(await isLocked(), 'lock mode always: a new tab opens locked');
  ok(await exists('#lock .lk-padlock svg.ico-unlock'), 'open padlock: no PIN needed this time');
  await press('Enter', 600);
  ok(!(await isLocked()) && !(await keypadUp()), 'within 5 minutes of using it: a swipe unlocks without the PIN');
  await relaunch('', Date.now() - 6 * 60e3);
  await press('Enter', 600);
  ok(await keypadUp(), 'after 6 minutes: the PIN is asked');
  // unlock() waits for the PIN
  await page.evaluate(() => { window.__u = 0; import('./js/shell/lock.js').then((m) => m.unlock().then(() => (window.__u = 1))); });
  await sleep(800);
  ok((await page.evaluate(() => window.__u)) === 0 && (await isLocked()), 'unlock() has not resolved while the keypad waits');
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => { window.__unl = null; m.onUnlock((i) => (window.__unl = i)); }));
  await typeDigits(PIN);
  await sleep(900);
  ok((await page.evaluate(() => window.__u)) === 1 && !(await isLocked()), 'unlock() resolves once the PIN is in');
  ok((await page.evaluate(() => window.__unl))?.pin === true, 'onUnlock hook fired with { pin: true }');
  noErrors(mark, 'lock automatically');

  // ════════════════════════════════════════ a deep link waits for the PIN
  mark = logs.length;
  await relaunch('#open=notes', 0);
  ok(await isLocked() && (await keypadUp()), 'newtab.html#open=notes: locked, the keypad is up right away');
  ok((await mod('./js/core/apps.js', 'currentApp')) === null && !(await visible('.app-win')), 'Notes is not open behind the keypad');
  await shot(P + 'pin-08-deeplink');
  await typeDigits(PIN);
  await sleep(1300);
  ok(!(await isLocked()) && (await mod('./js/core/apps.js', 'currentApp')) === 'notes', 'after the PIN, Notes opens');
  await ctx.closeApp();
  noErrors(mark, 'deep link');

  // ════════════════════════════════════════ 5 wrong tries: a 30-second wait
  mark = logs.length;
  await lockNow();
  await press('Enter', 500);
  for (let i = 1; i <= 4; i++) { await typeDigits('000000', 60); await sleep(450); }
  ok((await text('#lock .pin-sub')).includes(await S('pin.left1')), `after 4 wrong PINs: one more try before a wait (${await text('#lock .pin-sub')})`);
  const t5 = Date.now();
  await typeDigits('000000', 60);
  await sleep(700);
  const tr5 = await pget('pinTries');
  ok(tr5.n === 5 && tr5.until > t5 + 28e3 && tr5.until < t5 + 32e3, `5th wrong PIN: pinTries { n: 5, until ≈ +30 s } (${tr5.n}, ${Math.round((tr5.until - t5) / 1000)} s)`);
  ok(await exists('#lock .pin.out') && /30|29|28/.test(await text('#lock .pin-sub')), `keypad greyed out, "Try again in 30 seconds" (${await text('#lock .pin-sub')})`);
  await shot(P + 'pin-09-lockout');
  await typeDigits(PIN, 60);
  await sleep(500);
  ok((await count('#lock .pin-dots i.on')) === 0 && (await isLocked()), 'the keys do nothing while it waits (even the right PIN)');
  const r6 = await mod('./js/shell/pin.js', 'tryPin', PIN);
  ok(r6.ok === false && r6.wait > 25e3, 'tryPin refuses while the wait runs');
  // the wait ends (time moved on: the stored lockout is over)
  await pset('pinTries', { n: 5, until: Date.now() - 1 });
  await sleep(1400);
  ok(!(await exists('#lock .pin.out')), 'when the wait is over the keypad works again');
  await typeDigits('000000', 60);
  await sleep(600);
  ok((await pget('pinTries')).n === 6 && !(await exists('#lock .pin.out')), 'the 6th wrong PIN has no wait (Android counts on)');
  await typeDigits(PIN);
  await sleep(900);
  ok(!(await isLocked()) && (await pget('pinTries')).n === 0, 'then the right PIN unlocks and clears the count');
  noErrors(mark, 'lockout');

  // ════════════════════════════════════════ notifications and widgets on a Lock screen with a PIN
  mark = logs.length;
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.registerLockWidget('test-priv', { name: { en: 'Test', ar: 'اختبار' }, private: true, render: async (o) => { window.__lw = o; const el = document.createElement('span'); el.className = 'lk-w'; el.textContent = o.locked && o.private ? 'hidden' : 'Secret amount'; return el; } })));
  await setSet('lockWidgets', ['event', 'test-priv']);
  await pset('events', [{ id: 'e1', title: 'Dentist appointment', start: Date.now() + 2 * 3600e3, end: Date.now() + 3 * 3600e3, allDay: false, color: '#3e91ff' }]);
  await pset('notifications', [{ id: 'x1', app: 'notes', title: 'Secret plan', body: 'Meet at 5', icon: 'bell', time: Date.now() - 1000, read: false }]);
  await lockNow();
  await sleep(500);
  const nTitle = await text('#lock .lk-notif .qp-notif-title'), nBody = await text('#lock .lk-notif .qp-notif-body');
  const notesName = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.appName('notes')));
  ok(nTitle === notesName && nBody === (await S('lock.newNotif')), `Hide content: the app and "New notification" (${nTitle} · ${nBody})`);
  ok(!(await text('#lock')).includes('Secret plan') && !(await text('#lock')).includes('Meet at 5'), 'no notification text anywhere on the Lock screen');
  ok(await page.evaluate(() => document.body.classList.contains('lk-private')), 'heads-up banners are hidden too (body.lk-private)');
  const lw = await page.evaluate(() => window.__lw);
  ok(lw && lw.locked === true && lw.private === true, 'lock widgets get render({ locked: true, private: true })');
  const chips = await texts('#lock .lk-widgets .lk-w');
  ok(chips.length === 2 && !chips.join().includes('Dentist') && chips.includes('hidden'), `chips: event without its title, private chip hidden (${chips})`);
  await shot(P + 'pin-10-private-lock');
  await setSet('lockHideContent', false);
  await sleep(300);
  ok((await text('#lock .lk-notif .qp-notif-title')) === 'Secret plan', 'Hide content off: the text shows');
  await setSet('lockHideContent', true);
  await sleep(200);
  ok(!(await text('#lock')).includes('Secret plan'), 'and hides again');
  await press('Enter', 400);
  await typeDigits(PIN);
  await sleep(900);
  ok(!(await isLocked()) && !(await page.evaluate(() => document.body.classList.contains('lk-private'))), 'unlocked');
  noErrors(mark, 'private');

  // ════════════════════════════════════════ change the PIN (4 digits: an OK key)
  mark = logs.length;
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(500);
  await row(L.type);
  ok(await exists(top + ' .pin-page') && (await text(top + ' .pin-title')) === (await S('pin.enter')), 'Screen lock type asks for the current PIN first');
  await typeDigits('000000');
  await sleep(500);
  ok(await exists(top + ' .pin-page') && (await text(top + ' .pin-sub')) === (await S('pin.wrong')), 'a wrong current PIN is refused');
  await typeDigits(PIN);
  await sleep(700);
  ok(await exists('.ou-dialog .ou-radio-row'), 'then the screen lock types');
  await pick(3);
  ok((await page.$eval(top + ' .app-toolbar-title', (e) => e.textContent)) === (await S('set.lk.changePin')), 'PIN again: the "Change PIN" page');
  await typeDigits(PIN2);
  await press('Enter', 300);
  await typeDigits(PIN2);
  await press('Enter', 900);
  const rec2 = await ctx.store('pin');
  ok(rec2.digits === 4 && rec2.hash !== rec.hash, 'new 4-digit PIN stored (new hash)');
  ok(!(await mod('./js/shell/pin.js', 'checkPin', PIN)) && (await mod('./js/shell/pin.js', 'checkPin', PIN2)), 'the old PIN no longer works, the new one does');
  await row(L.secure);
  ok(!(await exists(top + ' .ou-switch')), 'no "Confirm PIN without tapping OK" for a 4-digit PIN');
  await row(L.after);
  await pick(1);
  ok((await ctx.store('settings')).lockAfter === 0, 'Lock automatically: Immediately');
  await ctx.closeApp();
  await lockNow();
  await press('Enter', 500);
  ok((await count('#lock .pin-dots.fixed')) === 0 && (await visible('#lock .pin-ok')), '4 digits: dots as you type and an OK key');
  await typeDigits(PIN2);
  await press('Enter', 900);
  ok(!(await isLocked()), 'Enter (OK) unlocks with the new PIN');
  await relaunch('', Date.now() - 5000);
  await press('Enter', 500);
  ok(await keypadUp(), 'Immediately: even a tab opened 5 s after use asks for the PIN');
  await typeDigits(PIN2);
  await press('Enter', 900);
  await setSet('lockAfter', 5);
  noErrors(mark, 'change PIN');

  // ════════════════════════════════════════ Backup: export without the hash, import keeps the PIN
  mark = logs.length;
  // catch the backup file instead of downloading it
  await page.evaluate(() => {
    window.__blob = null;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => ((window.__blob = b), real(b));
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (!this.download) click.call(this); };
  });
  await ctx.openApp('settings', { page: 'backup' });
  await sleep(500);
  await row(await S('set.export'));
  await sleep(500);
  const exported = JSON.parse(await page.evaluate(() => window.__blob?.text() || '{}'));
  ok(exported.app === 'bloom-tab' && exported.data?.notes?.length === 1 && exported.data?.settings, 'export: a Bloom Tab backup with the notes and settings');
  ok(!('pin' in exported.data) && !('pinTries' in exported.data) && !JSON.stringify(exported).includes(rec2.hash), 'export drops pin and pinTries (no hash in the file)');
  const scratch = path.join(process.env.OUT || path.join(__dirname, 'shots'), 'pin-backup-' + ui + '.json');
  const foreign = { hash: 'AAAA', salt: 'BBBB', iter: 1000, digits: 4, alg: 'PBKDF2-SHA256' };
  fs.writeFileSync(scratch, JSON.stringify({ app: 'bloom-tab', version: 1, data: { ...exported.data, notes: [...exported.data.notes, { id: 'n2', title: 'From backup', body: '', color: '', pinned: false, created: 1, updated: 1 }], pin: foreign } }));
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 4000 }), row(await S('set.import'))]);
  await chooser.accept([scratch]);
  await sleep(600);
  await page.click('.ou-dialog .ou-dialog-btn.primary');
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  const after = await ctx.getStorage(['pin', 'notes']);
  ok(after.notes?.length === 2, 'import restored the backup (2 notes)');
  ok(after.pin?.hash === rec2.hash, 'import kept this computer’s PIN (the file’s pin was ignored)');
  fs.unlinkSync(scratch);
  if (await isLocked()) {
    await press('Enter', 600);
    if (await keypadUp()) { await typeDigits(PIN2); await press('Enter', 900); }
  }
  ok(!(await isLocked()), 'unlocked after the restore');
  noErrors(mark, 'backup');

  // ════════════════════════════════════════ Journal can lock with the screen PIN
  mark = logs.length;
  ok(await mod('./js/journal/lock.js', 'screenPinAvailable'), 'Journal: the screen PIN is available');
  ok(await mod('./js/journal/lock.js', 'useScreenPin') && (await mod('./js/journal/lock.js', 'lockOn')), 'Journal locked with the screen PIN (kind screen)');
  const jr = await mod('./js/journal/lock.js', 'rec');
  ok(jr.kind === 'screen' && jr.digits === 4 && !jr.hash, 'its record keeps no hash, digits from the screen PIN');
  const v1 = await mod('./js/journal/lock.js', 'verify', '9999');
  ok(v1.ok === false && (await pget('pinTries')).n === 1, 'a wrong PIN in the Journal counts as a screen-lock try');
  ok((await mod('./js/journal/lock.js', 'verify', PIN2)).ok === true && (await pget('pinTries')).n === 0, 'the screen PIN opens the Journal');
  noErrors(mark, 'journal provider');

  // ════════════════════════════════════════ the Chrome side panel asks for the PIN too
  mark = logs.length;
  const sp = await ctx.browser.newPage();
  const spErrors = [];
  sp.on('pageerror', (e) => spErrors.push(e.message));
  await sp.setViewport({ width: 380, height: 820 });
  await sw.evaluate(() => chrome.storage.session.set({ lastActive: 0 }));
  await sp.goto(`chrome-extension://${ctx.id}/sidepanel.html`);
  const spPad = await sp.waitForSelector('.sp-gate .pin', { timeout: 10000 }).catch(() => null);
  ok(spPad && !(await sp.$('.sp-main')), 'side panel: the keypad instead of notes and reminders');
  ok(await sp.evaluate(() => getComputedStyle(document.querySelector('.sp-gate .pin-key')).visibility === 'visible'), 'side panel: the keypad is visible');
  ok((await sp.$eval('.sp-gate .pin-title', (e) => e.textContent)) === (await S('pin.enter')) && !!(await sp.$('.sp-gate .pin-badge')), 'side panel: "Enter PIN" with the padlock');
  await sleep(300);
  await sp.screenshot({ path: path.join(process.env.OUT || path.join(__dirname, 'shots'), P + 'pin-13-sidepanel.png') });
  await sp.keyboard.type('1111');
  await sp.keyboard.press('Enter');
  await sleep(600);
  ok((await sp.$eval('.sp-gate .pin-sub', (e) => e.textContent)).startsWith(await S('pin.wrong')) && !(await sp.$('.sp-main')), 'side panel: a wrong PIN is refused');
  await sp.keyboard.type(PIN2);
  await sp.keyboard.press('Enter');
  ok(!!(await sp.waitForSelector('.sp-main', { timeout: 4000 }).catch(() => null)) && !(await sp.$('.sp-gate')), 'side panel: the right PIN opens it');
  ok((await sw.evaluate(() => chrome.storage.session.get('lastActive'))).lastActive > Date.now() - 10e3, 'the panel unlock counts as using Bloom Tab (lastActive)');
  await sp.goto(`chrome-extension://${ctx.id}/sidepanel.html`);
  await sp.waitForFunction(() => window.__spReady, { timeout: 10000 }).catch(() => {});
  ok(!!(await sp.$('.sp-main')) && !(await sp.$('.sp-gate')), 'side panel opened again within "Lock automatically": no PIN');
  await mod('./js/shell/lock.js', 'lockNow');
  ok(!!(await sp.waitForSelector('.sp-gate .pin', { timeout: 4000 }).catch(() => null)) && !(await sp.$('.sp-main')), 'Lock now in a tab locks the open side panel too');
  ok(spErrors.length === 0, `side panel: no page errors (${spErrors.join(' | ')})`);
  await sp.close();
  await page.bringToFront();
  await sleep(400);
  await press('Enter', 500);
  if (await keypadUp()) { await typeDigits(PIN2); await press('Enter', 900); }
  ok(!(await isLocked()), 'back in the tab: unlocked again');
  noErrors(mark, 'side panel');

  // ════════════════════════════════════════ remove the PIN (Screen lock type › Swipe)
  mark = logs.length;
  await ctx.openApp('settings', { page: 'lock' });
  await sleep(500);
  await row(L.type);
  await typeDigits(PIN2);
  await press('Enter', 700);
  await pick(2);
  ok(await exists('.ou-dialog') && (await text('.ou-dialog .ou-dialog-title')) === (await S('set.lk.removeTitle')), '"Remove PIN?" warning');
  await shot(P + 'pin-11-remove');
  await page.click('.ou-dialog .ou-dialog-btn.danger');
  await sleep(600);
  ok(!(await ctx.store('pin')) && !(await ctx.store('pinTries')), 'pin and pinTries removed');
  ok((await rowSub(L.type)) === L.swipe && (await ctx.store('settings')).lockMode === 'always', 'Screen lock type: Swipe (the Lock screen stays)');
  ok(!(await mod('./js/journal/lock.js', 'lockOn')), 'the Journal that followed the screen lock is unlocked too');
  await ctx.closeApp();
  await lockNow();
  ok(!(await exists('#lock .lk-padlock svg')), 'no padlock without a PIN');
  await press('Enter', 600);
  ok(!(await isLocked()) && !(await keypadUp()), 'Swipe: Enter unlocks without a keypad');
  noErrors(mark, 'remove');

  // ════════════════════════════════════════ Forgot PIN? erases everything
  mark = logs.length;
  await mod('./js/shell/pin.js', 'setPin', PIN);
  await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.putBlob('test:one', new Blob(['x']))));
  await sw.evaluate(() => chrome.alarms.create('alarm:test', { delayInMinutes: 600 }));
  ok((await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.listBlobs('test:')))).length === 1 && !!(await sw.evaluate(() => chrome.alarms.get('alarm:test'))), 'set up: a PIN, a picture and an alarm');
  await lockNow();
  await press('Enter', 500);
  await page.click('#lock .pin-forgot');
  await sleep(500);
  ok(await visible('.ou-dialog.pin-erase') && (await text('.pin-erase .ou-dialog-title')) === (await S('pin.eraseTitle')), 'Forgot PIN?: "Erase Bloom Tab?"');
  await shot(P + 'pin-12-forgot');
  await page.evaluate(() => [...document.querySelectorAll('.pin-erase .ou-dialog-btn')].find((b) => !b.classList.contains('danger'))?.click());
  await sleep(400);
  ok((await keypadUp()) && !!(await ctx.store('pin')), 'Cancel keeps everything (back on the keypad)');
  await page.click('#lock .pin-forgot');
  await sleep(400);
  await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), page.click('.pin-erase .ou-dialog-btn.danger')]);
  await page.waitForFunction(() => window.__bootMs, { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  const left = await ctx.getStorage(['pin', 'pinTries', 'notes', 'journalLock']);
  ok(!left.pin && !left.pinTries && !left.notes, 'erased: no PIN, no notes');
  ok((await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.listBlobs('')))).length === 0, 'erased: pictures (IndexedDB)');
  ok(!(await sw.evaluate(() => chrome.alarms.get('alarm:test'))), 'erased: alarms');
  ok(!(await isLocked()) || !(await keypadUp()), 'and no PIN is asked any more');
  noErrors(mark, 'forgot');
};
