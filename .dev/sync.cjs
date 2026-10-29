// triple
// Sync with Chrome (js/bg/sync.js) end to end in one profile: two new tabs share the service worker, and "another
// computer" is played by writing its items straight into chrome.storage.sync with another device id. Checks: turning
// it on uploads the synced keys (deflate + base64, cut into chunks that each fit Chrome's 8 KB item limit), the keys
// that must never leave the computer (PIN, Journal, Health, music, recordings, photos…) and the per-device settings
// never reach sync, a change in either tab goes up, another computer's change comes down into both tabs, newest wins
// per key, alarms from another computer are scheduled here, categories and the main switch, Erase synced data.
// usage: .dev/run.sh .dev/sync.cjs   (THEME=dark / UI=ar too)
module.exports = async ({ browser, page, url, sw, boot, ok, openApp, closeApp, text, count, exists, sleep, shot, P, store, mod, ui, logs }) => {
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const top = '.app-win .app-stack > .app-page:last-child';
  const syncAll = () => page.evaluate(() => chrome.storage.sync.get(null));
  const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(250); } return false; };
  const synced = (key) => page.evaluate((k) => import('./js/bg/sync.js').then((m) => m.readSynced(k)).then((r) => r && { meta: r.meta, value: r.value }), key);
  /** Writes `value` into chrome.storage.sync the way another computer would. */
  const remote = (key, value, ts, dev = 'other-computer') => page.evaluate(async (key, value, ts, dev) => {
    const m = await import('./js/bg/sync.js');
    const parts = m.chunkString(await m.encodeValue(key === 'settings' ? m.stripDevice(value) : value));
    const obj = { ['m:' + key]: { n: parts.length, ts, dev, h: m.hashOf(key, value) } };
    parts.forEach((p, i) => (obj[`c:${key}:${i}`] = p));
    await chrome.storage.sync.set(obj);
  }, key, value, ts, dev);
  const setLocal = (p, key, value) => p.evaluate((k, v) => import('./js/core/store.js').then((m) => m.store.set(k, v)), key, value);
  const getLocal = (p, key) => p.evaluate((k) => import('./js/core/store.js').then((m) => m.store.get(k)), key);
  const row = async (title) => {
    const found = await page.evaluate((sel, t) => {
      const r = [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t);
      r?.scrollIntoView({ block: 'center' });
      r?.click();
      return !!r;
    }, top, title);
    if (!found) ok(false, `row "${title}" exists`);
    await sleep(400);
  };

  // one long note of incompressible text, so notes need several chunks
  const noise = Array.from({ length: 42000 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789 ءابتثجحخدذرزسشصضطظعغفقكلمنهوي'[(i * 7919 + (i * i) % 104729) % 64]).join('');
  const now = Date.now();
  const NOTES = [
    { id: 'n1', title: 'Groceries', body: 'milk, eggs', color: '', pinned: false, created: now, updated: now },
    { id: 'n2', title: 'Long note', body: noise, color: '', pinned: false, created: now, updated: now },
  ];
  await boot({
    settings: { brightness: 70, profileName: 'Amina', focusMinutes: 45, wallpaper: { type: 'photo', id: 'local-photo' } },
    data: {
      home: [[]], dock: [], notes: NOTES,
      reminders: [{ id: 'r1', title: 'Call mom', done: false, created: now }],
      alarms: [{ id: 'a1', time: '07:30', days: [1, 2, 3, 4, 5], label: 'Work', enabled: true }],
      clocks: [{ id: 'c1', tz: 'Asia/Tokyo', city: 'Tokyo' }],
      pin: { hash: 'SECRETHASH', salt: 'SALT', iter: 1000, digits: 4, alg: 'PBKDF2-SHA256' },
      pinTries: { n: 2, until: 0 },
      journalLock: { kind: 'screen', digits: 4 },
      journal: { entries: [{ id: 'j1', text: 'SECRET JOURNAL' }] },
      health: { water: { [new Date().toISOString().slice(0, 10)]: 500 } },
      wellbeingUsage: { x: 1 },
      wallPhotos: ['local-photo'],
      musicPrefs: { eq: 'flat' },
      recorder: { items: [] },
    },
  });
  await page.evaluate(() => chrome.storage.sync.clear());
  await sleep(300);
  ok(Object.keys(await syncAll()).length === 0 && !(await store('syncPrefs'))?.on, 'sync is off by default: nothing in chrome.storage.sync');

  // ——— turn it on from Settings ———
  await openApp('settings');
  await row(await tr('set.sync'));
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.sync')), 'Settings › Sync with Chrome opens');
  ok(!(await exists(top + ' .set-sync-now')), 'off: no status or categories yet');
  await shot(P + 'sync-01-off');
  await row(await tr('set.sy.title'));
  ok((await store('syncPrefs'))?.on === true, 'Sync with Chrome on (syncPrefs.on)');
  ok(await until(async () => !!(await syncAll())['m:notes']), 'notes reach chrome.storage.sync');
  await until(async () => (await store('syncStatus'))?.ok && !Object.keys((await store('syncDirty')) || {}).length, 6000);
  const all = await syncAll();
  const metas = Object.keys(all).filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
  console.log('synced keys:', metas.join(', '));
  ok(['settings', 'notes', 'reminders', 'alarms', 'clocks', 'home', 'dock'].every((k) => metas.includes(k)), 'settings, Home screen, notes, reminders, alarms and world clocks uploaded');
  const forbidden = ['pin', 'pinTries', 'journalLock', 'journal', 'health', 'wellbeingUsage', 'wallPhotos', 'musicPrefs', 'recorder', 'notifications', 'syncPrefs', 'syncState', 'syncDevice'];
  ok(!metas.some((k) => forbidden.includes(k)) && !Object.keys(all).some((k) => forbidden.some((f) => k === 'c:' + f + ':0')), 'PIN, Journal, Health, screen time, photos, music, recordings, notifications and sync state never reach sync');
  ok(!Object.keys(all).some((k) => /^[mc]:(pin|pinTries|journalLock)(:|$)/.test(k)), 'in particular no pin, pinTries or journalLock item');
  const sizes = Object.entries(all).map(([k, v]) => new TextEncoder().encode(k).length + Buffer.byteLength(JSON.stringify(v)));
  ok(Math.max(...sizes) <= 8192, `every item fits the 8 KB item limit (largest ${Math.max(...sizes)} bytes, ${sizes.length} items)`);
  const notesUp = await synced('notes');
  const localNotes = await store('notes');
  const same = (a, b) => JSON.stringify(a, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)) === JSON.stringify(b, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  ok(notesUp?.meta.n > 1 && same(notesUp.value, localNotes) && notesUp.value.find((x) => x.id === 'n2')?.body === noise, `the long notes are cut into ${notesUp?.meta.n} chunks and come back identical (${same(notesUp?.value, localNotes)}, ${notesUp?.value?.length}/${localNotes?.length})`);
  const dump = JSON.stringify(await page.evaluate(async (keys) => { const m = await import('./js/bg/sync.js'); const out = {}; for (const k of keys) out[k] = (await m.readSynced(k))?.value; return out; }, metas));
  ok(!dump.includes('SECRETHASH') && !dump.includes('SECRET JOURNAL'), 'no PIN hash and no Journal text anywhere in sync');
  const setUp = (await synced('settings'))?.value || {};
  ok(setUp.profileName === 'Amina' && setUp.focusMinutes === 45 && !('lang' in setUp) && !('brightness' in setUp) && !('lockMode' in setUp) && !setUp.wallpaper, 'settings go up without the per-device ones (language, brightness, lock timing, a photo wallpaper)');
  ok((await count(top + ' .set-sync-now')) === 1 && (await count(top + ' .ou-switch input:checked')) >= 9, 'on: status, Sync now and the categories (all on)');
  ok(((await store('syncStatus'))?.used || 0) > 0, `status: ${(await store('syncStatus'))?.used} bytes used`);
  await shot(P + 'sync-02-on');

  // ——— a second tab: its change goes up, another computer's change comes down into both ———
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await p2.goto(url);
  await p2.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  await sleep(600);
  await page.bringToFront(); // a background tab doesn't render, and puppeteer's clicks wait for a frame
  await setLocal(p2, 'notes', [...NOTES, { id: 'n3', title: 'From tab two', body: '', color: '', pinned: false, created: Date.now(), updated: Date.now() }]);
  ok(await until(async () => (await synced('notes'))?.value?.some((n) => n.id === 'n3')), 'a note added in the second tab is uploaded');

  const later = Date.now() + 5000;
  await remote('reminders', [{ id: 'r1', title: 'Call mom', done: true, created: now }, { id: 'r9', title: 'From the other computer', done: false, created: now }], later);
  ok(await until(async () => ((await getLocal(page, 'reminders')) || []).some((r) => r.id === 'r9')), 'another computer\'s reminders come down');
  ok(((await getLocal(p2, 'reminders')) || []).find((r) => r.id === 'r1')?.done === true, '…into both tabs (r1 done there too)');
  const remoteSettings = { ...(await store('settings')), profileName: 'Other computer', focusMinutes: 25, lang: ui === 'ar' ? 'en' : 'ar', brightness: 40 };
  await remote('settings', remoteSettings, later + 1000);
  ok(await until(async () => (await store('settings'))?.profileName === 'Other computer'), 'another computer\'s settings come down');
  const sNow = await store('settings');
  ok(sNow.focusMinutes === 25 && sNow.lang === ui && sNow.brightness === 70 && sNow.wallpaper?.type === 'photo', 'but this computer keeps its language, brightness and photo wallpaper');

  // an alarm made on another computer rings here too
  await remote('alarms', [{ id: 'a1', time: '07:30', days: [1, 2, 3, 4, 5], label: 'Work', enabled: true }, { id: 'a2', time: '06:15', days: [], label: 'Flight', enabled: true }], later + 2000);
  ok(await until(async () => !!(await page.evaluate(() => chrome.alarms.get('alarm:a2')))), 'its new alarm is scheduled here (alarm:a2)');

  // ——— newest wins per key ———
  // this tab changes the world clocks, then a copy that is older arrives: ours stays and goes up
  const mine = [{ id: 'c1', tz: 'Asia/Tokyo', city: 'Tokyo' }, { id: 'c2', tz: 'Europe/Paris', city: 'Paris' }];
  const tMine = Date.now();
  await setLocal(page, 'clocks', mine);
  await remote('clocks', [{ id: 'c9', tz: 'America/Lima', city: 'Lima' }], tMine - 60000);
  ok(await until(async () => (await synced('clocks'))?.value?.some((c) => c.id === 'c2')), 'older copy from another computer: our newer change wins and is uploaded');
  ok(JSON.stringify(await getLocal(page, 'clocks')) === JSON.stringify(mine), '…and stays here');
  // this tab changes the notes, then a newer copy arrives before ours went up: theirs wins
  const theirs = [{ id: 'n7', title: 'Newer elsewhere', body: '', color: '', pinned: false, created: now, updated: Date.now() + 60000 }];
  await setLocal(page, 'notes', [...NOTES, { id: 'n4', title: 'Older here', body: '', color: '', pinned: false, created: now, updated: now }]);
  await remote('notes', theirs, Date.now() + 60000);
  ok(await until(async () => ((await getLocal(page, 'notes')) || []).some((n) => n.id === 'n7') && !((await getLocal(page, 'notes')) || []).some((n) => n.id === 'n4')), 'newer copy from another computer wins over our older change');
  await sleep(2500);
  ok((await synced('notes'))?.value?.[0]?.id === 'n7', '…and sync keeps it');

  // ——— categories and the main switch ———
  const notesName = await mod('./js/core/apps.js', 'appName', 'notes');
  await row(notesName);
  ok(((await store('syncPrefs'))?.off || []).includes('notes'), 'Samsung Notes turned off in "Sync these"');
  const before = (await synced('notes'))?.meta.ts;
  await setLocal(page, 'notes', [{ id: 'n5', title: 'Not synced', body: '', color: '', pinned: false, created: now, updated: now }]);
  await sleep(3500);
  ok((await synced('notes'))?.meta.ts === before, 'a note change no longer goes up');
  await row(notesName);
  await shot(P + 'sync-03-categories');
  await row(await tr('set.sy.title'));
  ok((await store('syncPrefs'))?.on === false && !(await store('syncState')), 'Sync off: this computer forgets what was in sync');
  const remBefore = (await synced('reminders'))?.meta.ts;
  await setLocal(page, 'reminders', [{ id: 'r5', title: 'Offline', done: false, created: now }]);
  await sleep(3500);
  ok((await synced('reminders'))?.meta.ts === remBefore, 'off: changes stay on this computer');

  // turning it on again merges lists by id instead of replacing them
  await row(await tr('set.sy.title'));
  ok(await until(async () => { const r = (await synced('reminders'))?.value || []; return r.some((x) => x.id === 'r5') && r.some((x) => x.id === 'r9'); }), 'on again: reminders from both sides merged by id');

  // ——— Sync now, Erase synced data ———
  await row(await tr('set.sy.now'));
  await sleep(1500);
  ok((await store('syncStatus'))?.ok === true && Date.now() - (await store('syncStatus')).at < 8000, 'Sync now updates the status');
  await row(await tr('set.sy.erase'));
  ok(await exists('.ou-dialog .ou-dialog-btn.danger'), 'Erase synced data asks first');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.danger').click());
  ok(await until(async () => Object.keys(await syncAll()).length === 0, 5000), 'Bloom Tab\'s data erased from chrome.storage.sync');
  ok(((await getLocal(page, 'reminders')) || []).length > 0, 'what\'s on this computer stays');
  await row(await tr('set.sy.title'));
  await closeApp();
  await p2.close();
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
};
