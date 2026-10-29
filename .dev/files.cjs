// triple — My Files. Full run: .dev/run.sh --raw node .dev/files.cjs (copies the extension to a temp dir with "downloads" and "downloads.open" granted, since headless Chrome can't accept the optional permission prompt, and points Chrome's Downloads folder at a temp dir)
// End to end: the "Allow access" card (no permission: denied, then allowed), real downloads made from data: URLs (Home with
// Recent files, category sizes and a picture preview; Images, Documents, Downloads; sort, grid view; open, show in folder,
// copy link, Details; Edit/selection mode with All and the bottom bar; long press), Delete to the Recycle bin with Undo,
// the Recycle bin (restore, delete permanently: the file leaves the disk), 30-day purge, Recycle bin off, Remove from
// list, live updates, Search (chips, highlights, recent searches), Storage (per app, with links), Settings, widgets,
// Finder search and command, and a slow download from a local server for the progress rows, pause/resume, the Now Bar
// (no file name while locked), the Quick Panel and cancel. chrome.downloads.open/show are stubbed (they would launch
// programs on the test machine). Run without --raw (no permission) only the card and the pages without downloads run.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-files-'));
  for (const f of fs.readdirSync(root)) if (!['.git', '.dev', 'dist', 'store', 'node_modules', 'scripts'].includes(f)) fs.cpSync(path.join(root, f), path.join(ext, f), { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  man.permissions = [...man.permissions, 'downloads', 'downloads.open'];
  man.optional_permissions = (man.optional_permissions || []).filter((p) => !p.startsWith('downloads'));
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
  // Chrome on Linux takes its Downloads folder from $XDG_CONFIG_HOME/user-dirs.dirs: keep the test's files out of ~/Downloads
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-files-xdg-')), dlDir = path.join(xdg, 'Downloads');
  fs.mkdirSync(dlDir);
  fs.writeFileSync(path.join(xdg, 'user-dirs.dirs'), `XDG_DOWNLOAD_DIR="${dlDir}"\n`);
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'harness.cjs'), __filename], { stdio: 'inherit', env: { ...process.env, EXT: ext, XDG_CONFIG_HOME: xdg, BT_DL_DIR: dlDir } });
  fs.rmSync(ext, { recursive: true, force: true });
  fs.rmSync(xdg, { recursive: true, force: true });
  process.exit(r.status);
}

module.exports = async ({ page, sw, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, mod, store, setStorage, sleep, shot, P, ui }) => {
  const granted = await sw.evaluate(() => chrome.permissions.contains({ permissions: ['downloads'] }));
  console.log(granted ? '  (downloads permission granted: real downloads are checked)' : '  (no downloads permission: run with --raw for the download checks)');
  const AR = ui === 'ar';
  const L = '.app-stack > .app-page:last-child ';
  const tt = (k, v) => page.evaluate((k, v) => import('./js/core/i18n.js').then((m) => m.t(k, v)), k, v);
  const fsize = (n) => page.evaluate((n) => import('./js/files/common.js').then((m) => m.size(n)), n);
  const back = async () => { await click(L + '.app-back'); await sleep(450); };
  const menuItem = async (key) => { const ok1 = await clickText('.ou-menu-item', await tt(key)); await sleep(300); return ok1; };
  const dlgBtn = async (label) => { const ok1 = await clickText('.ou-dialog-btn', label); await sleep(500); return ok1; };
  const rowNames = (scope = L) => texts(scope + '.mf-row .mf-name');
  const prefs = async () => (await store('filesPrefs')) || {};
  const binOf = async () => ((await store('files')) || {}).bin || [];
  const search = (q) => page.evaluate((q) => chrome.downloads.search(q), q);
  const onDisk = (f) => fs.existsSync(f);
  // chrome.downloads.open/show/showDefaultFolder would start programs on this machine: record the calls instead
  const stubOs = () => page.evaluate(() => {
    window.__calls = [];
    window.__clip = [];
    const D = chrome.downloads;
    if (D) for (const k of ['open', 'show', 'showDefaultFolder', 'acceptDanger']) D[k] = (...a) => (window.__calls.push([k, ...a]), Promise.resolve());
    navigator.clipboard.writeText = async (s) => void window.__clip.push(s);
  });
  const calls = () => page.evaluate(() => window.__calls);

  // ---------------------------------------------------------------- no permission: the Allow card
  await boot();
  await page.evaluate(() => {
    const Pm = chrome.permissions, c0 = Pm.contains.bind(Pm), r0 = Pm.request.bind(Pm);
    const mine = (s) => (s?.permissions || []).some((p) => p.startsWith('downloads'));
    window.__perm = { on: false, allow: false, asked: 0 };
    Pm.contains = async (s) => (mine(s) ? window.__perm.on : c0(s));
    Pm.request = async (s) => {
      if (!mine(s)) return r0(s);
      window.__perm.asked++;
      if (window.__perm.allow) window.__perm.on = true;
      return window.__perm.allow;
    };
  });
  await openApp('files');
  await sleep(500);
  ok(await exists(L + '.mf-perm .mf-allow'), 'without the permission: the Allow access card');
  ok((await count(L + '.mf-perm-points li')) === 3, 'the card says what My Files does with it');
  ok((await count(L + '.mf-cat')) === 7, 'seven categories');
  ok((await texts(L + '.mf-cat-size')).every((s) => s === '—'), 'category sizes are unknown');
  ok(!(await exists(L + '.mf-recent')), 'no Recent files without access');
  ok(await exists(L + '.mf-storage') && await exists(L + '.mf-binrow'), 'Storage and Recycle bin still there');
  await shot(P + 'files-01-allow');
  await click(L + '.mf-cat[data-cat="images"]');
  await sleep(600);
  ok((await page.evaluate(() => window.__perm.asked)) === 1, 'a category asks for the permission');
  ok((await text('.ou-toast')) === (await tt('files.perm.denied')), 'denied: a toast, and the card stays');
  ok((await count('.app-stack > .app-page')) === 1, '… and the category doesn’t open');
  if (granted) {
    await page.evaluate(() => (window.__perm.allow = true));
    await click(L + '.mf-allow');
    await sleep(900);
    ok(!(await exists(L + '.mf-perm')), 'Allow: the card goes away');
    ok((await texts(L + '.mf-cat-size')).every((s) => s !== '—'), '… and the categories show sizes');
  }
  await closeApp();

  // Modes and Routines: “Open My Files” opens the place it names (the Recycle bin opens with or without the permission)
  const fo = await page.evaluate(async () => {
    const { ACTIONS } = await import('./js/routines/actions.js');
    const { pageCtx } = await import('./js/routines/page.js');
    const a = ACTIONS['files.open'];
    try { await a.run(pageCtx(), { section: 'bin' }); } catch (e) { return e.key || e.message; }
    return a.params[0].def + ':' + a.params[0].opts.map((o) => o[0]).join();
  });
  await sleep(900);
  ok(fo.startsWith('downloads:downloads,') && await exists(L + '.mf-binnote'), 'Routines: “Open My Files” (Downloads by default) opens the Recycle bin when asked: ' + fo);
  await closeApp();

  if (!granted) {
    // what works without downloads: Storage, Settings, the Recycle bin, widgets
    await openApp('files', { section: 'bin' });
    ok(await exists(L + '.mf-binnote') && await exists(L + '.mf-empty'), 'an empty Recycle bin');
    await closeApp();
    await openApp('files', { section: 'storage' });
    await sleep(800);
    ok(await exists(L + '.mf-st-hero .mf-st-big b'), 'Storage measures Bloom Tab');
    await closeApp();
    return;
  }

  // ---------------------------------------------------------------- real downloads from data: URLs
  const DIR = process.env.BT_DL_DIR;
  const made = await page.evaluate(async () => {
    const cv = Object.assign(document.createElement('canvas'), { width: 96, height: 64 });
    // a little landscape: sky, sun, two hills
    const g = cv.getContext('2d');
    g.fillStyle = '#7cc4ff';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#ffd84d';
    g.beginPath();
    g.arc(70, 18, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3fae6a';
    g.beginPath();
    g.moveTo(0, 64);
    g.lineTo(0, 44);
    g.quadraticCurveTo(30, 26, 60, 46);
    g.quadraticCurveTo(80, 36, 96, 42);
    g.lineTo(96, 64);
    g.closePath();
    g.fill();
    window.__alpha = g.getImageData(10, 60, 1, 1).data[3];
    const files = [
      ['Holiday photo.png', cv.toDataURL('image/png')],
      ['Quarterly report.pdf', 'data:application/pdf;base64,' + btoa('%PDF-1.4\n' + 'x'.repeat(4000) + '\n%%EOF')],
      ['song.mp3', 'data:audio/mpeg;base64,' + btoa('ID3' + 'a'.repeat(9000))],
      ['clip.mp4', 'data:video/mp4;base64,' + btoa('....ftypisom' + 'v'.repeat(20000))],
      ['backup.zip', 'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=='],
      ['notes.txt', 'data:text/plain,' + encodeURIComponent('shopping list\n'.repeat(20))],
      ['data.bin', 'data:application/octet-stream;base64,AAECAwQFBgc='],
    ];
    const ids = {};
    for (const [name, url] of files) {
      ids[name] = await chrome.downloads.download({ url, filename: 'bt-files/' + name });
      await new Promise((r) => setTimeout(r, 120)); // distinct start times
    }
    for (let i = 0; i < 50; i++) {
      const done = await chrome.downloads.search({ state: 'complete' });
      if (done.length >= files.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ids, items: await chrome.downloads.search({}) };
  });
  const ID = made.ids, byName = (n) => made.items.find((d) => d.id === ID[n]);
  ok(made.items.filter((d) => d.state === 'complete').length === 7, 'seven files downloaded into ' + DIR);
  ok(onDisk(path.join(DIR, 'bt-files', 'notes.txt')), 'the files are on disk');
  console.log('  (test picture alpha at the bottom: ' + (await page.evaluate(() => window.__alpha)) + ')');

  await boot();
  await stubOs();
  await openApp('files');
  await sleep(800);
  ok(!(await exists(L + '.mf-perm')), 'with the permission: no card');
  ok((await count(L + '.mf-recent .mf-rtile')) === 7, 'Recent files: the seven downloads');
  ok((await page.evaluate(() => document.querySelector('.mf-rtile .mf-rtile-name')?.textContent)) === 'data.bin', 'newest first');
  ok(await exists(L + `.mf-rtile[data-id="${ID['Holiday photo.png']}"] .mf-tile.has-thumb`), 'the picture shows its preview (from its data: URL)');
  ok(await exists(L + `.mf-rtile[data-id="${ID['Quarterly report.pdf']}"] .mf-tile.k-pdf .mf-tile-ext`), 'a PDF gets a PDF icon with its extension');
  const catSize = async (c) => text(L + `.mf-cat[data-cat="${c}"] .mf-cat-size`);
  ok((await catSize('images')) === (await fsize(byName('Holiday photo.png').fileSize)), 'Images: the picture’s size (' + (await catSize('images')) + ')');
  const docBytes = byName('Quarterly report.pdf').fileSize + byName('notes.txt').fileSize;
  ok((await catSize('docs')) === (await fsize(docBytes)), 'Documents: PDF + text');
  ok((await catSize('downloads')) === (await fsize(made.items.reduce((s, d) => s + d.fileSize, 0))), 'Downloads: everything');
  await shot(P + 'files-02-home');

  // ---------------------------------------------------------------- categories
  await click(L + '.mf-cat[data-cat="images"]');
  await sleep(500);
  ok((await text(L + '.app-toolbar-title')) === (await tt('files.cat.images')), 'Images opens');
  ok(JSON.stringify(await rowNames()) === '["Holiday photo.png"]', 'Images: the picture only');
  ok((await text(L + '.mf-count')) === (await tt('files.nItems1')), 'item count');
  await shot(P + 'files-03-images');
  await back();
  await click(L + '.mf-cat[data-cat="docs"]');
  await sleep(500);
  ok(JSON.stringify(await rowNames()) === '["notes.txt","Quarterly report.pdf"]', 'Documents, newest first: ' + (await rowNames()).join(', '));
  await click(L + '.mf-sortbtn');
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('.mf-sortdlg .ou-radio-row')[1].click()); // Name
  await page.evaluate(() => document.querySelectorAll('.mf-sortdlg .ou-radio-list')[1].querySelectorAll('.ou-radio-row')[0].click()); // Ascending
  await shot(P + 'files-04-sort');
  await dlgBtn(await tt('common.done'));
  ok(JSON.stringify(await prefs()).includes('"sort":"name"') && (await prefs()).dir === 'asc', 'Sort by Name, ascending is saved');
  ok(JSON.stringify(await rowNames()) === '["notes.txt","Quarterly report.pdf"]' && (await text(L + '.mf-sortbtn')).includes(await tt('files.sort.name')), 'sorted by name');
  await page.evaluate(() => import('./js/files/data.js').then((m) => m.setPrefs({ dir: 'desc' })));
  await sleep(200);
  ok(JSON.stringify(await rowNames()) === '["Quarterly report.pdf","notes.txt"]', 'descending');
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('files.viewGrid');
  ok((await prefs()).view === 'grid' && (await count(L + '.mf-grid .mf-gcard')) === 2, 'View as grid');
  await shot(P + 'files-05-grid');
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('files.viewList');
  ok((await prefs()).view === 'list' && (await count(L + '.mf-rowcard .mf-row')) === 2, 'View as list');
  await page.evaluate(() => import('./js/files/data.js').then((m) => m.setPrefs({ sort: 'date', dir: 'desc' })));
  await back();

  await click(L + '.mf-cat[data-cat="downloads"]');
  await sleep(500);
  ok((await count(L + '.mf-row')) === 7, 'Downloads lists every file');
  const sub = await text(L + `.mf-row[data-id="${ID['notes.txt']}"] .mf-size`);
  ok(sub === (await fsize(byName('notes.txt').fileSize)), 'a row shows the size (' + sub + ')');
  await shot(P + 'files-06-downloads');
  // open, show in folder, copy link, Details
  await click(L + `.mf-row[data-id="${ID['Quarterly report.pdf']}"]`);
  await sleep(400);
  ok(JSON.stringify(await calls()) === JSON.stringify([['open', ID['Quarterly report.pdf']]]), 'a click opens the file (downloads.open)');
  await page.click(L + `.mf-row[data-id="${ID['song.mp3']}"]`, { button: 'right' });
  await sleep(300);
  ok((await texts('.ou-menu-item')).includes(await tt('files.showFolder')), 'right-click: the file’s menu');
  await shot(P + 'files-07-menu');
  await menuItem('files.showFolder');
  ok((await calls()).some((c) => c[0] === 'show' && c[1] === ID['song.mp3']), 'Show in folder');
  await page.click(L + `.mf-row[data-id="${ID['notes.txt']}"]`, { button: 'right' });
  await sleep(300);
  await menuItem('files.copyLink');
  ok((await page.evaluate(() => window.__clip[0]))?.startsWith('data:text/plain,shopping'), 'Copy link copies the address');
  ok((await text('.ou-toast')) === (await tt('files.linkCopied')), '… with a toast');
  await page.click(L + `.mf-row[data-id="${ID['Holiday photo.png']}"]`, { button: 'right' });
  await sleep(300);
  await menuItem('files.details');
  await sleep(300);
  const dt = await texts('.mf-details .mf-dt-val');
  ok(await exists('.mf-details .mf-dt-head .mf-tile.has-thumb'), 'Details: the preview');
  ok(dt.some((s) => s.includes('image/png')) && dt.some((s) => s.endsWith('bt-files')), 'Details: type and folder (' + dt.slice(0, 3).join(' | ') + ')');
  await shot(P + 'files-08-details');
  await dlgBtn(await tt('common.close'));

  // Edit (selection mode)
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('files.edit');
  ok((await count(L + '.mf-row .mf-chk')) === 7 && await exists(L + '.mf-allchk'), 'Edit: check circles and All');
  await click(L + `.mf-row[data-id="${ID['song.mp3']}"]`);
  await click(L + `.mf-row[data-id="${ID['clip.mp4']}"]`);
  ok((await text(L + '.app-toolbar-title')) === (await tt('files.nSelected', { n: 2 })), '2 selected');
  ok((await count(L + '.mf-selbar .mf-selbtn')) === 4 && await exists(L + '.mf-selbar .mf-selbtn:first-child:disabled'), 'bottom bar (Show is for one file)');
  await shot(P + 'files-09-select');
  await click(L + '.mf-allchk');
  ok((await count(L + '.mf-row.sel')) === 7, 'All selects everything');
  await click(L + '.mf-allchk');
  ok((await count(L + '.mf-row.sel')) === 0, '… and nothing');
  await click(L + '.mf-tb-text');
  ok(!(await exists(L + '.mf-chk')), 'Cancel leaves selection mode');
  // long press starts it with that file selected
  const box = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, L + `.mf-row[data-id="${ID['data.bin']}"]`);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(650);
  await page.mouse.up();
  await sleep(300);
  ok((await count(L + '.mf-row.sel')) === 1 && await exists(L + `.mf-row.sel[data-id="${ID['data.bin']}"]`), 'long press selects the file');
  await page.keyboard.press('Escape');
  await sleep(300);
  ok(!(await exists(L + '.mf-chk')) && (await count('.app-stack > .app-page')) === 2, 'Escape leaves selection mode (and stays on the page)');

  // ---------------------------------------------------------------- delete → Recycle bin
  const notesPath = byName('notes.txt').filename;
  await page.click(L + `.mf-row[data-id="${ID['notes.txt']}"]`, { button: 'right' });
  await sleep(300);
  await menuItem('common.delete');
  ok((await text('.ou-dialog-title')) === (await tt('files.del.bin1')), 'Delete asks to move it to the Recycle bin');
  await shot(P + 'files-10-delete');
  await dlgBtn(await tt('files.del.toBin'));
  ok((await binOf()).length === 1 && (await binOf())[0].name === 'notes.txt', 'files.bin has the file');
  ok(!(await exists(L + `.mf-row[data-id="${ID['notes.txt']}"]`)), 'it leaves the list');
  ok(onDisk(notesPath), '… but stays on disk for 30 days');
  await click('.ou-toast-action');
  await sleep(500);
  ok((await binOf()).length === 0 && await exists(L + `.mf-row[data-id="${ID['notes.txt']}"]`), 'Undo brings it back');
  // delete two at once from selection mode
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('files.edit');
  await click(L + `.mf-row[data-id="${ID['notes.txt']}"]`);
  await click(L + `.mf-row[data-id="${ID['data.bin']}"]`);
  await click(L + '.mf-selbar .mf-selbtn.danger');
  await sleep(300);
  ok((await text('.ou-dialog-title')) === (await tt('files.del.bin', { n: 2 })), 'two files: Move 2 items…');
  await dlgBtn(await tt('files.del.toBin'));
  ok((await binOf()).length === 2 && !(await exists(L + '.mf-chk')), 'both in the bin, selection mode ends');
  await back();
  ok((await text(L + '.mf-binrow .ou-row-sub')) === (await tt('files.nItems', { n: 2 })), 'Home: Recycle bin · 2 items');

  // ---------------------------------------------------------------- Recycle bin page
  await click(L + '.mf-binrow');
  await sleep(500);
  ok((await count(L + '.mf-row')) === 2, 'Recycle bin lists both');
  ok((await text(L + '.mf-days')) === (await tt('files.bin.days', { n: 30 })), 'N days left: ' + (await text(L + '.mf-days')));
  await shot(P + 'files-11-bin');
  await click(L + `.mf-row[data-id="${ID['notes.txt']}"]`);
  await menuItem('files.restore');
  ok((await binOf()).map((b) => b.name).join() === 'data.bin', 'Restore');
  const binPath = byName('data.bin').filename;
  await click(L + `.mf-row[data-id="${ID['data.bin']}"]`);
  await menuItem('files.bin.delForever');
  ok((await text('.ou-dialog-title')) === (await tt('files.bin.delQ1')), 'Delete permanently asks first');
  await dlgBtn(await tt('common.delete'));
  await sleep(500);
  ok(!onDisk(binPath), 'the file is deleted from disk');
  ok((await search({ id: ID['data.bin'] })).length === 0 && (await binOf()).length === 0, 'Chrome forgets it, the bin is empty');
  ok(await exists(L + '.mf-empty'), 'empty Recycle bin');
  await back();

  // 30 days later
  const songPath = byName('song.mp3').filename;
  await setStorage({ files: { bin: [{ id: ID['song.mp3'], at: Date.now() - 31 * 864e5, name: 'song.mp3', size: 10, mime: 'audio/mpeg', url: '', cat: 'audio' }] } });
  await sleep(400);
  const purged = await mod('./js/files/data.js', 'purgeBin');
  await sleep(300);
  ok(purged === 1 && !onDisk(songPath) && (await binOf()).length === 0, 'after 30 days the bin deletes the file');

  // ---------------------------------------------------------------- Settings: Recycle bin off, Remove from list
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('common.settings');
  await sleep(400);
  ok((await texts(L + '.ou-row-title')).includes(await tt('files.set.downloads')) && (await texts(L + '.ou-row-sub')).includes(await tt('files.set.allowed')), 'Settings: access to downloads is Allowed');
  await shot(P + 'files-12-settings');
  await page.evaluate(() => document.querySelectorAll('.app-stack > .app-page:last-child .ou-switch input')[1].click());
  await sleep(300);
  ok((await prefs()).bin === false, 'Recycle bin off');
  await back();
  await click(L + '.mf-cat[data-cat="archives"]');
  await sleep(400);
  const zipPath = byName('backup.zip').filename;
  await page.click(L + `.mf-row[data-id="${ID['backup.zip']}"]`, { button: 'right' });
  await sleep(300);
  await menuItem('common.delete');
  ok((await text('.ou-dialog-title')) === (await tt('files.del.q1')), 'with the bin off: Delete this item?');
  await dlgBtn(await tt('common.delete'));
  await sleep(500);
  ok(!onDisk(zipPath) && (await binOf()).length === 0, 'deleted right away');
  await back();
  await page.evaluate(() => import('./js/files/data.js').then((m) => m.setPrefs({ bin: true })));
  await click(L + '.mf-cat[data-cat="videos"]');
  await sleep(400);
  const clipPath = byName('clip.mp4').filename;
  await page.click(L + `.mf-row[data-id="${ID['clip.mp4']}"]`, { button: 'right' });
  await sleep(300);
  await menuItem('files.unlist');
  await sleep(400);
  ok((await search({ id: ID['clip.mp4'] })).length === 0 && onDisk(clipPath), 'Remove from list: Chrome forgets it, the file stays');
  ok(await exists(L + '.mf-empty'), 'Videos is empty now');
  await back();

  // ---------------------------------------------------------------- live updates
  await click(L + '.mf-cat[data-cat="downloads"]');
  await sleep(400);
  const n0 = await count(L + '.mf-row');
  await page.evaluate(() => chrome.downloads.download({ url: 'data:text/csv,a,b%0A1,2', filename: 'bt-files/table.csv' }));
  await sleep(1500);
  ok((await count(L + '.mf-row')) === n0 + 1 && (await rowNames())[0] === 'table.csv', 'a new download shows up while the list is open');
  await back();

  // ---------------------------------------------------------------- Search
  await click(L + '.app-toolbar-actions .ou-icon-btn:first-child');
  await sleep(400);
  ok(await exists(L + '.app-toolbar .mf-sbox input'), 'Search: the field is in the app bar');
  await page.keyboard.type('report');
  await sleep(300);
  ok(JSON.stringify(await rowNames()) === '["Quarterly report.pdf"]' && (await text(L + '.mf-row mark')).toLowerCase() === 'report', 'finds “report”, highlighted');
  await page.keyboard.press('Enter');
  await sleep(200);
  await click(L + '.mf-chip[data-cat="images"]');
  ok(await exists(L + '.mf-empty'), 'the Images chip: no result');
  await click(L + '.mf-chip[data-cat="all"]');
  await shot(P + 'files-13-search');
  ok(JSON.stringify((await prefs()).recentQ) === '["report"]', 'Enter remembers the search');
  await page.evaluate((l) => { const i = document.querySelector(l + '.mf-sbox input'); i.value = ''; i.dispatchEvent(new Event('input')); }, L);
  await sleep(200);
  ok((await texts(L + '.mf-qchip')).includes('report'), 'recent searches');
  await back();

  // ---------------------------------------------------------------- Storage
  await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.putBlob('recorder:test-1', new Blob([new Uint8Array(50000)]))));
  await setStorage({ notes: [{ id: 'n1', title: 'Hello', body: 'x'.repeat(3000), color: 'none', pinned: false, created: 1, updated: 1 }] });
  await sleep(300);
  await click(L + '.mf-storage');
  await sleep(1200);
  ok(await exists(L + '.mf-st-hero .mf-st-big b'), 'Storage: how much Bloom Tab uses');
  ok((await count(L + '.mf-st-app')) >= 6, 'one row per app that stores files');
  const rec = await text(L + '.mf-st-app[data-app="recorder"] .ou-row-sub');
  ok(rec.includes(await fsize(50000)), 'Voice Recorder: its 50 KB recording (' + rec + ')');
  const notesRow = await text(L + '.mf-st-app[data-app="notes"] .mf-st-size');
  ok(notesRow && notesRow !== (await fsize(0)), 'Notes: its data (' + notesRow + ')');
  await shot(P + 'files-14-storage');
  await click(L + '.mf-st-app[data-app="recorder"]');
  await sleep(900);
  ok(await exists('.app-win[data-app="recorder"]'), 'an app row opens the app');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true, 'recorder')));
  await sleep(300);
  await closeApp();

  // ---------------------------------------------------------------- Finder
  const found = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('files').search('holiday')).then((r) => r.map((x) => x.title)));
  ok(JSON.stringify(found) === '["Holiday photo.png"]', 'Finder finds a downloaded file by name');
  const cmd = await page.evaluate((w) => import('./js/core/hooks.js').then((m) => m.runCommands(w, () => {}).map((r) => r.title)), AR ? 'التنزيلات' : 'downloads');
  ok(cmd.includes(await tt('files.cat.downloads')), 'Finder command: Downloads');
  await mod('./js/shell/finder.js', 'openFinder', 'Holiday');
  await sleep(900);
  ok((await texts('.finder-results .fr-title')).includes('Holiday photo.png'), 'Finder shows it under My Files');
  await page.evaluate(() => [...document.querySelectorAll('.finder-results .fr')].find((b) => b.textContent.includes('Holiday photo.png'))?.click());
  await sleep(500);
  ok((await calls()).some((c) => c[0] === 'open' && c[1] === ID['Holiday photo.png']), 'and opens the file');

  // ---------------------------------------------------------------- widgets
  await boot({
    data: {
      home: [[
        { id: 'w1', type: 'widget', widget: 'files-recent', size: 'm' },
        { id: 'w2', type: 'widget', widget: 'files-storage', size: 's' },
        { id: 'w3', type: 'widget', widget: 'files-recent', size: 'l' },
        { id: 'w4', type: 'widget', widget: 'files-storage', size: 'm' },
      ]],
    },
  });
  await stubOs();
  await sleep(800);
  ok((await count('.wg-mf-m .wg-mf-file')) === 4, 'Recent files widget (medium): 4 files');
  const nDone = (await search({ state: 'complete', exists: true })).length;
  ok((await count('.wg-mf-l .wg-mf-file')) === Math.min(8, nDone), 'large: up to 8');
  ok((await count('.wg-mfs .wg-mfs-used')) === 2 && /\d/.test(await text('.wg-mfs .wg-mfs-used')), 'Storage widgets show the size used');
  await shot(P + 'files-15-widgets');
  await page.evaluate(() => document.querySelector('.wg-mf-m .wg-mf-file').click());
  await sleep(400);
  ok((await calls()).some((c) => c[0] === 'open'), 'a file in the widget opens it');

  // ---------------------------------------------------------------- a slow download: progress, pause, Now Bar, cancel
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(8_000_000), 'Content-Disposition': 'attachment; filename="big-file.bin"' });
    const tm = setInterval(() => res.write(Buffer.alloc(16_000, 7)), 150);
    res.on('close', () => clearInterval(tm));
  });
  const sockets = new Set();
  server.on('connection', (s) => (sockets.add(s), s.on('close', () => sockets.delete(s))));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const slowId = await page.evaluate((u) => chrome.downloads.download({ url: u }), `http://127.0.0.1:${server.address().port}/big-file.bin`);
  await sleep(2000);
  const act = async () => (await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().filter((a) => a.id === 'files').map(({ title, sub, progress }) => ({ title, sub, progress })))))[0];
  let a = await act();
  ok(a && /%$/.test(a.title) && a.sub === 'big-file.bin' && a.progress > 0 && a.progress < 1, 'Now Bar: percentage, file name and progress (' + JSON.stringify(a) + ')');
  await openApp('files');
  await sleep(600);
  const ar = L + `.mf-active .mf-row[data-id="${slowId}"]`;
  ok(await exists(ar + ' .mf-bar i'), 'Home: Downloading card with a progress bar');
  const p1 = await text(ar + ' .mf-ptext');
  await sleep(1600);
  const p2 = await text(ar + ' .mf-ptext');
  ok(p1 !== p2, `progress moves while the app is open (${p1} → ${p2})`);
  await shot(P + 'files-16-downloading');
  await click(ar + ' .mf-pp');
  await sleep(1200);
  ok((await search({ id: slowId }))[0].paused === true, 'Pause');
  a = await act();
  ok(a?.title === (await tt('files.nb.paused')), 'Now Bar: Paused');
  await click(ar + ' .mf-pp');
  await sleep(1200);
  ok((await search({ id: slowId }))[0].paused === false, 'Resume');
  await closeApp();
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(1500);
  a = await act();
  ok(a?.sub === (await tt('files.nb.files1')), 'locked: no file name (' + a?.sub + ')');
  ok((await texts('.nb-pill b')).some((s) => /%$/.test(s)), 'Lock screen Now Bar pill');
  await shot(P + 'files-17-nowbar');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(900);
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(800);
  ok(await exists('.qp-activity'), 'the download in the Quick Panel');
  await shot(P + 'files-18-quickpanel');
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel');
  await sleep(300);
  await openApp('files');
  await sleep(500);
  await click(ar + ` .mf-rbtn[aria-label="${await tt('files.cancel')}"]`);
  await sleep(1500);
  const cancelled = (await search({ id: slowId }))[0];
  ok(cancelled.state === 'interrupted' && cancelled.error === 'USER_CANCELED', 'Cancel download');
  ok(!(await exists(L + '.mf-active')) && !(await act()), 'the Downloading card and the Now Bar go away');
  for (const s of sockets) s.destroy();
  server.close();
  await click(L + '.mf-cat[data-cat="downloads"]');
  await sleep(400);
  ok((await text(L + `.mf-row[data-id="${slowId}"] .mf-sub`)) === (await tt('files.canceled')), 'Downloads shows it as Canceled');
  await click(L + '.app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem('files.cleanup');
  await sleep(500);
  ok(!(await exists(L + `.mf-row[data-id="${slowId}"]`)) && (await search({ id: slowId })).length === 0, 'Remove failed and deleted');
  await back();

  // ---------------------------------------------------------------- full screen
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.toggleFullScreen('files')));
  await sleep(700);
  const cats = await page.evaluate(() => [...document.querySelectorAll('.mf-cat')].map((c) => Math.round(c.getBoundingClientRect().top)));
  ok(new Set(cats).size === 1, 'full screen: the categories fit on one row');
  await shot(P + 'files-19-max');
  await closeApp();
};
