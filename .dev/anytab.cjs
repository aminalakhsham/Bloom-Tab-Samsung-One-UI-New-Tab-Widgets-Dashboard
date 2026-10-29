// anytab — Add to Home screen and Quick capture from any tab. Run: .dev/run.sh --raw node .dev/anytab.cjs (OUT=… for shots)
// Run directly, it copies the extension to a temp dir with host permissions added (headless Chrome can't click a context
// menu, press a shortcut or click the toolbar button, which is what grants activeTab) and runs itself through the
// harness. A local site with a strict CSP (frames, scripts and styles from elsewhere all forbidden) and an
// apple-touch-icon stands in for a website. Covers: the manifest (commands, menus, side panel, web-accessible sheets),
// the Add to Home screen sheet over a page (name, touch icon, Home screen / Edge panel, Open as web app, the Home
// screen icon and the web-app window), Arabic + dark, forged frames, pages that can't be scripted (a pop-up window),
// and Quick capture (note, reminder with its alarm, journal also while locked, water / expense / dose / mood logs,
// the selection, Arabic + dark, the window fallback), with what each wrote to storage.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib');

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-anytab-'));
  for (const f of fs.readdirSync(root)) if (!['.git', '.dev', 'dist', 'store', 'node_modules', 'scripts'].includes(f)) fs.cpSync(path.join(root, f), path.join(ext, f), { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  man.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'harness.cjs'), __filename], { stdio: 'inherit', env: { ...process.env, EXT: ext } });
  fs.rmSync(ext, { recursive: true, force: true });
  process.exit(r.status);
}

// a solid square PNG (the "touch icon")
function png(n, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: n }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(n).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async ({ browser, page, url, id, sw, ok, boot, mod, getStorage, setStorage, sleep, logs }) => {
  const OUT = process.env.OUT || path.join(__dirname, 'shots');
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') }).then(() => console.log('shot', name));
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ICON = png(180, [255, 90, 40]);
  const pages = {
    '/wiki/Cat': '<title>Cat - Wikipedia</title><link rel="apple-touch-icon" href="/touch.png"><h1>Cat</h1><p>' + 'Lorem ipsum dolor sit amet. '.repeat(200) + '</p>',
    '/': '<title>Plain Site</title><meta property="og:site_name" content="Plain"><p>no icons here</p><p><a id="dog" href="/wiki/Dog">Dogs</a></p>',
    '/coffee': '<title>How to Brew Coffee - The Daily Grind</title><h1>How to brew coffee</h1><p id="p">Grind the beans just before brewing.</p><p>' + 'Lorem ipsum dolor sit amet. '.repeat(120) + '</p>',
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/touch.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(ICON); return; }
    if (!pages[req.url]) { res.writeHead(404); res.end(); return; }
    // as strict as it gets: nothing may be framed, styled or scripted from elsewhere
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-src 'none'" });
    res.end(`<!doctype html><html><body style="font:16px system-ui;margin:40px;background:#f4f1ea;color:#222">${pages[req.url]}</body></html>`);
  }).listen(0);
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  const swLogs = [];
  sw.on?.('console', (m) => { if (['error', 'warn'].includes(m.type())) swLogs.push(m.text()); });
  const watch = (p) => { p.on('pageerror', (e) => logs.push('[pageerror] ' + p.url() + ' ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text()); }); return p; };
  const tabOf = (u) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u || t.url.startsWith(u + '#')), u);
  const frameOf = (p, file) => p.frames().find((f) => f.url().includes('/' + file));
  const IFR = (file) => `iframe[src*="${file}"]`;
  const settings = (lang, theme) => ({ lang, theme, lockMode: 'never', reduceMotion: true });
  const popups = () => sw.evaluate(async () => (await chrome.windows.getAll()).filter((w) => w.type === 'popup').length);
  const closePopups = () => sw.evaluate(async () => { for (const w of await chrome.windows.getAll()) if (w.type === 'popup') await chrome.windows.remove(w.id); });
  const extPage = async (file) => { for (let i = 0; i < 40; i++) { const p = (await browser.pages()).find((x) => x.url().startsWith(`chrome-extension://${id}/${file}`)); if (p) return watch(p); await sleep(150); } return null; };

  await boot({
    settings: settings('en', 'light'),
    data: {
      home: [[{ id: 's1', type: 'site', url: 'https://example.com/', title: 'Example' }]], dock: [],
      edge: [{ id: 'e1', type: 'app', app: 'notes' }],
      notes: [], reminders: [],
      journal: { entries: [{ id: 'j0', created: 1, at: 1, edited: 1, text: 'An older private entry' }] },
      health: { v: 1, units: { water: 'ml' }, meds: [{ id: 'm1', name: 'Aspirin', type: 'tablet', sched: { kind: 'daily', times: [{ t: '09:00', n: 1 }] }, start: dk(-3), at: Date.now() }], medLog: [], mind: [], water: [] },
      wallet: { v: 1, prefs: { cur: 'USD', alertTime: '09:00' }, spend: [], passes: [], subs: [], budgets: {} },
    },
  });

  // ════════════════ manifest: commands, menus, side panel, toolbar button
  const man = await page.evaluate(() => chrome.runtime.getManifest());
  const cmds = await sw.evaluate(() => chrome.commands.getAll());
  const key = (n) => cmds.find((c) => c.name === n)?.shortcut;
  ok(key('add-to-home') === 'Alt+Shift+H' && key('quick-capture') === 'Alt+Shift+Q' && key('open-side-panel') === 'Alt+Shift+L', 'shortcuts bound: ' + JSON.stringify(cmds.map((c) => [c.name, c.shortcut])));
  ok(Object.values(man.commands).filter((c) => c.suggested_key).length <= 4, 'at most 4 suggested shortcuts (Chrome’s limit)');
  ok(['activeTab', 'scripting', 'sidePanel'].every((p) => man.permissions.includes(p)) && man.side_panel?.default_path === 'sidepanel.html' && !!man.action, 'manifest: activeTab, scripting, sidePanel, side_panel and the toolbar button');
  ok(JSON.stringify(man.web_accessible_resources?.[0]?.resources) === '["addsite.html","capture.html"]', 'only the two sheets are web-accessible');
  const menus = await sw.evaluate(async () => { const out = {}; for (const id of ['add-home', 'add-edge', 'add-link', 'cap-page', 'cap-sel', 'add-action', 'cap-action', 'panel-action']) out[id] = await new Promise((r) => chrome.contextMenus.update(id, {}, () => r(!chrome.runtime.lastError))); return out; });
  ok(Object.values(menus).every(Boolean), 'context menus (page, link, selection, toolbar button): ' + JSON.stringify(menus));
  const opts = await sw.evaluate(() => chrome.sidePanel.getOptions({}));
  ok(opts?.path === 'sidepanel.html' && opts.enabled !== false, 'side panel set up: ' + JSON.stringify(opts));

  // ════════════════ Add to Home screen: a page with an apple-touch-icon, under a CSP that forbids frames
  const before = (await getStorage('home')).home.flat().length;
  const site = watch(await browser.newPage());
  await site.goto(base + '/wiki/Cat');
  const openAdd = async (p, u, opt = {}) => {
    await p.bringToFront();
    await sw.evaluate((t, o) => globalThis.__btAddToHome(t, o), await tabOf(u), opt);
    await p.waitForFunction((s) => !!document.querySelector(s), { timeout: 6000 }, IFR('addsite.html'));
    let fr; for (let i = 0; i < 50 && !(fr = frameOf(p, 'addsite.html')); i++) await sleep(100);
    await fr.waitForSelector('.at-add-sheet .at-name', { timeout: 6000 });
    await sleep(500);
    return fr;
  };
  let fr = await openAdd(site, base + '/wiki/Cat');
  await fr.waitForFunction(() => document.querySelector('.at-icon img')?.src.startsWith('data:image/png'), { timeout: 6000 }).catch(() => {});
  const vis = await site.evaluate((s) => { const f = document.querySelector(s), r = f.getBoundingClientRect(); return { v: getComputedStyle(f).visibility, w: r.width, h: r.height, top: f.matches(':popover-open') }; }, IFR('addsite.html'));
  ok(vis.v === 'visible' && vis.w === 1440 && vis.h === 900 && vis.top, 'sheet frame covers the page in the top layer ' + JSON.stringify(vis));
  ok(await fr.$eval('.at-name', (i) => i.value) === 'Cat', 'name for an article is the article (“Cat”)');
  ok(await fr.$eval('.at-url', (e) => e.textContent) === `127.0.0.1:${server.address().port}/wiki/Cat`, 'address shown without the scheme');
  ok(!!(await fr.$('.at-icon .app-icon.solid img[src^="data:image/png"]')), 'apple-touch-icon fetched and shown as the icon');
  ok(await fr.evaluate(() => document.activeElement?.classList.contains('at-name')), 'the name field has focus');
  ok(await fr.$eval('.at-where .ou-seg-btn.active', (b) => b.textContent) === 'Home screen', 'Home screen chosen');
  const sheetBox = await fr.$eval('.at-sheet', (e) => { const r = e.getBoundingClientRect(); return { b: Math.round(innerHeight - r.bottom), w: r.width }; });
  ok(sheetBox.b >= 16 && sheetBox.b <= 40 && sheetBox.w <= 480, 'One UI sheet at the bottom of the screen ' + JSON.stringify(sheetBox));
  await shot(site, 'anytab-add-light');
  await fr.evaluate(() => document.querySelector('.at-name').select());
  await site.keyboard.type('Cats');
  await fr.click('.at-webapp');
  await fr.click('.ou-dialog-btn.primary');
  await sleep(500);
  ok(await site.evaluate((s) => getComputedStyle(document.querySelector(s)).pointerEvents, IFR('addsite.html')) === 'none', 'after Add only the toast is left and clicks go through');
  ok(/Added to Home screen/.test(await fr.$eval('.ou-toast', (e) => e.textContent).catch(() => '')), 'toast: Added to Home screen');
  await shot(site, 'anytab-add-toast');
  await site.waitForFunction((s) => !document.querySelector(s), { timeout: 5000 }, IFR('addsite.html')).catch(() => {});
  ok(!(await site.$(IFR('addsite.html'))), 'frame removed afterwards');
  let { home, clipIcons } = await getStorage(['home', 'clipIcons']);
  const added = home.at(-1).find((it) => it.url === base + '/wiki/Cat');
  ok(!!added && added.title === 'Cats' && added.webApp === true && added.type === 'site', 'saved after the last icon with the edited name and Open as web app: ' + JSON.stringify(added));
  ok(home.flat().length === before + 1, 'exactly one item added');
  ok(clipIcons?.[base + '/wiki/Cat']?.startsWith('data:image/png'), 'touch icon kept in clipIcons');
  let sess = await sw.evaluate(() => chrome.storage.session.get(null));
  ok(!Object.keys(sess).some((k) => k.startsWith('clip:')), 'session hand-over cleaned up');

  // the Home screen draws the touch icon, and the icon opens as a web app in one reusable window
  await page.bringToFront();
  await page.reload(); await page.waitForFunction(() => window.__bootMs); await sleep(900);
  ok(await page.evaluate((u) => [...document.querySelectorAll('.tile')].some((t) => t.querySelector('.app-icon.solid img')?.src.startsWith('data:image/png') && t.textContent.includes('Cats')), base + '/wiki/Cat'), 'Home screen icon uses the touch icon');
  await page.evaluate(() => import('./js/shell/home.js').then((m) => m.goPage?.(99, true)));
  await sleep(500);
  await shot(page, 'anytab-home-icon');
  await page.evaluate((it) => import('./js/shell/appicon.js').then((m) => m.openItem(it, null)), added);
  await sleep(1500);
  ok(await popups() === 1, 'Open as web app: the site opens in a window of its own');
  await page.bringToFront();
  await page.evaluate((it) => import('./js/shell/appicon.js').then((m) => m.openItem(it, null)), added);
  await sleep(1000);
  ok(await popups() === 1, 'opening it again brings that window back');
  await page.evaluate((it) => import('./js/shell/appicon.js').then((m) => m.openItem(it, null, { shiftKey: true })), added);
  await sleep(800);
  ok(await popups() === 1 && (await browser.pages()).some((p) => p.url() === base + '/wiki/Cat' && p !== site), 'Shift (open in new tab) opens a normal tab instead');
  for (const p of await browser.pages()) if (p.url() === base + '/wiki/Cat' && p !== site) await p.close();
  await closePopups();

  // ════════════════ Edge panel, in Arabic and dark: a home page without icons
  await setStorage({ settings: settings('ar', 'dark') });
  const site2 = watch(await browser.newPage());
  await site2.goto(base + '/');
  fr = await openAdd(site2, base + '/', { where: 'edge' });
  ok(await fr.$eval('.at-name', (i) => i.value) === 'Plain', 'home page named after the site (“Plain”)');
  ok(await fr.evaluate(() => document.documentElement.dir) === 'rtl', 'Arabic sheet is right-to-left');
  ok(await site2.evaluate((s) => getComputedStyle(document.querySelector(s)).colorScheme, IFR('addsite.html')) === 'dark', 'frame colour scheme matches the dark sheet (no opaque backdrop)');
  ok(await fr.$eval('.at-where .ou-seg-btn.active', (b) => b.textContent) === 'لوحة الحافة', 'Edge panel chosen (from its menu)');
  await shot(site2, 'anytab-add-edge-ar-dark');
  await fr.click('.ou-dialog-btn.primary');
  await sleep(700);
  let edge = (await getStorage('edge')).edge;
  ok(edge.length === 2 && edge[1].url === base + '/' && edge[1].title === 'Plain', 'added to the Edge panel: ' + JSON.stringify(edge[1]));
  await site2.waitForFunction((s) => !document.querySelector(s), { timeout: 5000 }, IFR('addsite.html')).catch(() => {});
  fr = await openAdd(site2, base + '/', { where: 'edge' });
  await fr.click('.ou-dialog-btn.primary');
  await sleep(400);
  ok(!!(await fr.$('.at-sheet')) && /موجود بالفعل/.test(await fr.$eval('.ou-toast', (e) => e.textContent).catch(() => '')), 'already in the Edge panel: says so and stays open');
  await site2.keyboard.press('Escape');
  await sleep(700);
  ok(!(await site2.$(IFR('addsite.html'))), 'Escape cancels and removes the frame');
  ok((await getStorage('edge')).edge.length === 2 && (await getStorage('home')).home.flat().length === before + 1, 'cancel adds nothing');

  // a link: the link's address, over the page
  await setStorage({ settings: settings('en', 'light') });
  fr = await openAdd(site2, base + '/', { link: base + '/wiki/Dog' });
  ok(await fr.$eval('.at-url', (e) => e.textContent).catch(() => '') === `127.0.0.1:${server.address().port}/wiki/Dog`, 'a link adds the link, not the page');
  await site2.keyboard.press('Escape');
  await sleep(600);

  // a website can't fill in a sheet of its own: without a token from the service worker nothing shows
  await site2.evaluate((src) => { const f = document.createElement('iframe'); f.src = src; f.id = 'evil'; document.body.append(f); }, `chrome-extension://${id}/addsite.html#${'x'.repeat(36)}`);
  await sleep(1800);
  const evil = site2.frames().find((f) => f.url().includes('addsite.html'));
  ok(!evil || !(await evil.$('.ou-dialog')), 'forged frame shows no sheet');

  // a page that can't be scripted: the sheet in a small window, with an address field
  const cv = watch(await browser.newPage());
  await cv.goto('chrome://version');
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return globalThis.__btAddToHome({ ...t, url: 'chrome://version/' }); });
  let win = await extPage('addsite.html');
  ok(!!win, 'chrome:// page: the sheet opens in a window of its own');
  if (win) {
    await win.waitForSelector('.at-add-sheet .at-url-in', { timeout: 6000 }).catch(() => {});
    ok(await win.evaluate(() => document.documentElement.classList.contains('at-window')), 'window mode');
    await win.type('.at-url-in', 'example.org');
    await sleep(300);
    ok(await win.$eval('.at-name', (i) => i.value) === 'Example', 'the name follows the typed address');
    await shot(win, 'anytab-add-window');
    await win.click('.ou-dialog-btn.primary');
    await sleep(2600);
    ok((await getStorage('home')).home.flat().some((i) => i.url === 'https://example.org'), 'and Add puts it on the Home screen');
    ok(!(await browser.pages()).some((p) => p.url().includes('/addsite.html')), 'the window closes itself');
  }
  await cv.close();

  // ════════════════ Quick capture
  const csite = watch(await browser.newPage());
  const PAGE = base + '/coffee';
  await csite.goto(PAGE);
  async function cap(info) {
    await csite.bringToFront();
    await sw.evaluate((t, i) => globalThis.__btCapture(t, i), await tabOf(PAGE), info || {});
    await csite.waitForFunction((s) => !!document.querySelector(s), { timeout: 6000 }, IFR('capture.html'));
    let f; for (let i = 0; i < 50 && !(f = frameOf(csite, 'capture.html')); i++) await sleep(100);
    await f.waitForSelector('.at-cap-sheet .at-text', { timeout: 6000 });
    await sleep(450);
    return f;
  }
  const MODE_I = { note: 0, reminder: 1, journal: 2, log: 3 };
  const mode = async (f, m) => { await f.click(`.at-modes .ou-seg-btn:nth-child(${MODE_I[m] + 1})`); await sleep(200); };
  const gone = async () => { await csite.waitForFunction((s) => !document.querySelector(s), { timeout: 6000 }, IFR('capture.html')).catch(() => {}); return !(await csite.$(IFR('capture.html'))); };
  const typeIn = async (f, text) => { await f.focus('.at-text'); await csite.keyboard.type(text, { delay: 6 }); await sleep(250); };
  const ctrlEnter = async () => { await csite.keyboard.down('Control'); await csite.keyboard.press('Enter'); await csite.keyboard.up('Control'); await sleep(500); };

  // a note, with the page attached
  fr = await cap();
  ok(await fr.evaluate(() => document.activeElement?.classList.contains('at-text')), 'the text field has focus');
  ok(await fr.$eval('.at-link-title', (e) => e.textContent) === 'How to Brew Coffee - The Daily Grind', 'page title on the link card');
  ok(await fr.$eval('.at-link .ou-switch input', (i) => i.checked), 'link attached by default');
  ok(await fr.$eval('.ou-dialog-btn.primary', (b) => !b.disabled), 'Save is on with a link to save');
  await mode(fr, 'note');
  await typeIn(fr, 'Coffee ideas');
  await csite.keyboard.down('Shift'); await csite.keyboard.press('Enter'); await csite.keyboard.up('Shift');
  await csite.keyboard.type('Try a finer grind', { delay: 6 });
  await shot(csite, 'anytab-cap-note-light');
  await ctrlEnter();
  ok(await csite.evaluate((s) => getComputedStyle(document.querySelector(s)).pointerEvents, IFR('capture.html')) === 'none', 'after Save only the toast is left');
  await shot(csite, 'anytab-cap-toast');
  ok(await gone(), 'frame removed afterwards');
  let notes = (await getStorage('notes')).notes;
  ok(notes.length === 1 && /Coffee ideas.*Try a finer grind.*How to Brew Coffee.*127\.0\.0\.1/s.test(notes[0].body) && notes[0].id && notes[0].created && notes[0].color === 'none', 'note saved in Notes’ shape with the text and the page: ' + JSON.stringify(notes[0]).slice(0, 260));
  sess = await sw.evaluate(() => chrome.storage.session.get(null));
  ok(!Object.keys(sess).some((k) => k.startsWith('cap:')), 'session hand-over read once and gone');

  // a reminder with a time, read while typing; Enter saves; the alarm is set
  fr = await cap();
  await mode(fr, 'reminder');
  await typeIn(fr, 'Buy coffee beans tomorrow at 6pm');
  const chips = await fr.$$eval('.at-chip', (a) => a.map((x) => x.textContent));
  ok(chips[0] === 'Buy coffee beans' && /Tomorrow/.test(chips[1] || ''), 'reminder read as title and time: ' + JSON.stringify(chips));
  await shot(csite, 'anytab-cap-reminder');
  await csite.keyboard.press('Enter'); await sleep(500);
  const tomorrow6 = new Date(); tomorrow6.setDate(tomorrow6.getDate() + 1); tomorrow6.setHours(18, 0, 0, 0);
  const rem = (await getStorage('reminders')).reminders.find((r) => r.title === 'Buy coffee beans');
  ok(rem && rem.due === tomorrow6.getTime() && rem.notes.includes(PAGE) && rem.url === PAGE && rem.done === false, 'reminder saved with its time and the page: ' + JSON.stringify(rem));
  ok(!!(await sw.evaluate((n) => chrome.alarms.get(n), 'reminder:' + rem?.id)), 'its reminder:<id> alarm is set');
  await gone();

  // the journal, then with Lock Journal on: saved, nothing shown
  fr = await cap();
  await mode(fr, 'journal');
  await typeIn(fr, 'Learned to brew pour-over today');
  await ctrlEnter();
  let j = (await getStorage('journal')).journal;
  ok(j.entries.some((e) => e.text.startsWith('Learned to brew pour-over today') && e.text.includes(PAGE)), 'journal entry saved with the page');
  await gone();
  await setStorage({ journalLock: { on: true, kind: 'journal', hash: 'x', salt: 'eA==', after: 0 } });
  await sleep(200);
  fr = await cap();
  await mode(fr, 'journal');
  ok(/locked/i.test(await fr.$eval('.at-cap-note', (e) => e.textContent)), 'locked journal: says entries are saved without unlocking');
  ok(!(await fr.evaluate(() => document.body.textContent.includes('older private entry'))), 'nothing saved before is shown');
  await typeIn(fr, 'A private thought');
  await shot(csite, 'anytab-cap-journal-locked');
  await ctrlEnter();
  j = (await getStorage('journal')).journal;
  ok(j.entries.some((e) => e.text.startsWith('A private thought')), 'a locked journal still takes the new entry');
  await gone();
  await setStorage({ journalLock: { on: false } });

  // logs: water, an expense, a dose, a mood; something it doesn't understand can't be saved
  const logOne = async (text, label) => {
    fr = await cap();
    await mode(fr, 'log');
    ok(await fr.$eval('.at-link', (e) => e.hidden), 'Log hides the link');
    await typeIn(fr, text);
    const d = await fr.$eval('.at-log b', (e) => e.textContent).catch(() => '');
    ok(!!d && (await fr.$eval('.ou-dialog-btn.primary', (b) => !b.disabled)), `${label}: “${text}” → ${d}`);
  };
  await logOne('water 500ml', 'water');
  await shot(csite, 'anytab-cap-log');
  await csite.keyboard.press('Enter'); await sleep(500); await gone();
  await logOne('coffee 3.5$', 'expense'); await csite.keyboard.press('Enter'); await sleep(500); await gone();
  await logOne('took aspirin', 'dose'); await csite.keyboard.press('Enter'); await sleep(500); await gone();
  await logOne('mood good', 'mood'); await csite.keyboard.press('Enter'); await sleep(500); await gone();
  let { health, wallet } = await getStorage(['health', 'wallet']);
  ok(health.water.some((x) => x.ml === 500), 'water logged in Samsung Health');
  ok(wallet.spend.some((x) => x.amt === 3.5 && x.cur === 'USD'), 'expense added to Samsung Wallet: ' + JSON.stringify(wallet.spend));
  ok(health.medLog.some((x) => x.med === 'm1' && x.status === 'taken'), 'dose logged as taken');
  ok(health.mind.some((x) => x.valence === 1.3), 'mood logged');
  fr = await cap();
  await mode(fr, 'log');
  await typeIn(fr, 'hello there');
  ok(await fr.$eval('.ou-dialog-btn.primary', (b) => b.disabled) && !!(await fr.$('.at-try')), 'not understood: Save is off and examples are shown');
  await fr.$eval('.at-text', (t) => { t.value = ''; });
  await typeIn(fr, 'mood');
  ok((await fr.$$('.at-mood')).length === 5, '“mood” alone offers the five moods');
  await shot(csite, 'anytab-cap-mood-pick');
  await fr.click('.at-mood[data-mood="great"]');
  await sleep(500);
  ok(await gone() && (await getStorage('health')).health.mind.some((x) => x.valence === 2.6), 'picking a mood saves it and closes');

  // the selection fills it in (from the menu, and from the page when the shortcut is pressed)
  fr = await cap({ selectionText: 'Grind the beans just before brewing.' });
  await mode(fr, 'note');
  ok((await fr.$eval('.at-text', (t) => t.value)).includes('Grind the beans just before brewing.'), 'selection from the context menu fills the text');
  await csite.keyboard.press('Escape'); await gone();
  await csite.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  fr = await cap();
  ok((await fr.$eval('.at-text', (t) => t.value)).includes('Grind the beans'), 'selection on the page fills the text (shortcut)');
  await csite.keyboard.press('Escape');
  ok(await gone() && (await getStorage('notes')).notes.length === 1, 'cancel saves nothing');
  await csite.evaluate(() => getSelection().removeAllRanges());

  // Arabic and dark
  await setStorage({ settings: settings('ar', 'dark') });
  fr = await cap();
  ok(await fr.evaluate(() => document.documentElement.dir) === 'rtl', 'Arabic sheet is right-to-left');
  ok(await csite.evaluate((s) => getComputedStyle(document.querySelector(s)).colorScheme, IFR('capture.html')) === 'dark', 'frame colour scheme matches the dark sheet');
  await mode(fr, 'log');
  await typeIn(fr, 'شربت كوبين ماء');
  ok(/500/.test(await fr.$eval('.at-log b', (e) => e.textContent).catch(() => '')), 'Arabic log understood: ' + (await fr.$eval('.at-log b', (e) => e.textContent).catch(() => '')));
  await shot(csite, 'anytab-cap-log-ar-dark');
  await mode(fr, 'reminder');
  await fr.$eval('.at-text', (t) => { t.value = ''; });
  await typeIn(fr, 'اتصل بأمي غدًا الساعة 6 مساءً');
  await shot(csite, 'anytab-cap-reminder-ar-dark');
  await csite.keyboard.press('Enter'); await sleep(500);
  ok((await getStorage('reminders')).reminders.some((r) => r.due === tomorrow6.getTime()), 'Arabic reminder saved for tomorrow at 6 pm');
  await gone();
  await setStorage({ settings: settings('en', 'light') });

  // a website can't fill in a sheet of its own
  await csite.evaluate((src) => { const f = document.createElement('iframe'); f.src = src; document.body.append(f); }, `chrome-extension://${id}/capture.html#${'x'.repeat(36)}`);
  await sleep(1800);
  const evil2 = csite.frames().find((f) => f.url().includes('capture.html'));
  ok(!evil2 || !(await evil2.$('.ou-dialog')), 'forged capture frame shows no sheet');

  // a page that can't be scripted gets the sheet in a small window of its own
  const cv2 = watch(await browser.newPage());
  await cv2.goto('chrome://version');
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return globalThis.__btCapture({ ...t, url: 'chrome://version/' }); });
  win = await extPage('capture.html');
  ok(!!win, 'chrome:// page: Quick capture opens in a window of its own');
  if (win) {
    await win.waitForSelector('.at-cap-sheet .at-text', { timeout: 6000 }).catch(() => {});
    ok(await win.evaluate(() => document.documentElement.classList.contains('at-window')) && !(await win.$('.at-link')), 'window mode, with no link to attach');
    await win.click('.at-modes .ou-seg-btn:nth-child(1)');
    await win.type('.at-text', 'From a window');
    await shot(win, 'anytab-cap-window');
    await win.click('.ou-dialog-btn.primary');
    await sleep(2600);
    ok((await getStorage('notes')).notes.some((n) => n.body === '<div>From a window</div>'), 'saved from the window');
    ok(!(await browser.pages()).some((p) => p.url().includes('/capture.html')), 'the window closes itself');
  }
  ok(await popups() === 0, 'no stray windows');

  server.close();
  console.log('sw logs:', swLogs.join(' | ') || 'none');
};
