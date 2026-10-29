// triple
// Canvas end to end: the gallery (empty state, new board, cards with previews, favorites, search, list view,
// selection mode, Recycle bin), every insert tool (sticky note, text box, shapes, lines, link, image), moving with
// undo/redo, resizing, connectors, the selection toolbar, the pen toolbar (pen, pen settings, Auto shape,
// highlighter, eraser, lasso), group/align/arrange/lock/duplicate/copy-paste, scenes, grid and snap, zoom, Save as
// image/PDF, rename, Finder ("new board" and search), the Recent boards widget, a narrow window, and a board with
// 500 items staying fast. usage: .dev/run.sh .dev/canvas.cjs   (THEME=dark, UI=ar pass through)
function makePng(w, h) {
  const zlib = require('zlib');
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (buf) => { let x = 0xffffffff; for (const b of buf) x = table[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 40 + x; raw[i + 1] = 120 + y; raw[i + 2] = 220; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, sleep, shot, P, exists, count, mod, store, setStorage, text, texts, ui, visible }) => {
  const AR = ui === 'ar';
  const L = (en, ar) => (AR ? ar : en);
  const S = () => mod('./js/canvas/board.js', 'state');
  const scr = (x, y) => mod('./js/canvas/board.js', 'screenPoint', x, y);
  const centre = (it) => scr(it.x + it.w / 2, it.y + it.h / 2);
  const items = async () => (await S())?.items || [];
  const find = async (fn) => (await items()).find(fn);
  const boards = async () => (await store('canvas')) || [];
  const prefs = async () => (await store('canvasPrefs')) || {};
  const key = async (k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of [...mods].reverse()) await page.keyboard.up(m); await sleep(250); };
  const drag = async ([x0, y0], [x1, y1], steps = 12, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up();
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
    await sleep(300);
  };
  const path = async (pts) => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 }); await page.mouse.up(); await sleep(300); };
  const menuPick = async (label) => { await page.waitForSelector('.ou-menu-item', { timeout: 3000 }); const done = await clickText('.ou-menu-item', label); await sleep(300); return done; };
  const actBtn = (i) => page.$$eval('.cv-board-page .app-toolbar-actions .ou-icon-btn', (b, i) => b[i].click(), i).then(() => sleep(300));
  const viewRect = () => page.$eval('.cv-view', (n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
  const hookDownloads = () => page.evaluate(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { const href = this.href; window.__dl.push({ name: this.download, p: fetch(href).then((r) => r.arrayBuffer()).then((b) => [...new Uint8Array(b.slice(0, 8))]) }); return; }
      return orig.call(this);
    };
  });
  // waits for the n-th download (a big board can take a few seconds to draw)
  const download = (n) => page.waitForFunction((n) => window.__dl.length >= n, { timeout: 15000 }, n).then(() => page.evaluate(async () => { const d = window.__dl.at(-1); return { name: d.name, head: await d.p }; }), () => null);

  // ---------------------------------------------------------------- the gallery
  await boot();
  await hookDownloads();
  await openApp('canvas'); await sleep(600);
  ok(await exists('.cv-gal'), 'Canvas opens on the boards gallery');
  ok(await exists('.cv-empty'), 'empty state: No boards');
  ok(await count('.cv-nav-row') === 3, 'side pane: All boards, Favorites, Recycle bin');
  ok(await text('.cv-hero-t') === L('All boards', 'كل اللوحات'), 'One UI large title');
  await shot(P + 'canvas-01-empty');
  await click('.cv-fab'); await sleep(900);
  ok(await exists('.cv-board'), 'the + button opens a new board');
  let bs = await boards();
  ok(bs.length === 1 && bs[0].name === L('Untitled board', 'لوحة بدون عنوان'), 'the board is saved: ' + bs[0]?.name);
  ok(await text('.cv-board-page .app-toolbar-title') === bs[0].name, 'the app bar shows the board name');

  // ---------------------------------------------------------------- insert tools
  await click('[data-a="note"]');
  ok(await exists('.cv-note .cv-tx[contenteditable="plaintext-only"]'), 'Sticky note adds a note and starts typing');
  await page.keyboard.type(L('Brainstorm launch ideas', 'أفكار لإطلاق المنتج الجديد'), { delay: 5 });
  await key('Escape');
  let note = await find((i) => i.t === 'note');
  ok(note?.tx === L('Brainstorm launch ideas', 'أفكار لإطلاق المنتج الجديد'), 'note text is saved: ' + note?.tx);
  const fs = await page.$eval('.cv-note .cv-tx', (n) => parseFloat(n.style.fontSize));
  ok(fs > 0 && fs <= 24, `sticky-note text shrinks to fit (${fs}px)`);
  await key('Escape');
  ok(!(await S()).sel.length, 'Escape clears the selection');
  await click('[data-a="text"]');
  await page.keyboard.type(L('Hello Canvas', 'مرحبا باللوحة'), { delay: 5 });
  await key('Escape'); await key('Escape');
  const txt = await find((i) => i.t === 'text');
  ok(txt?.tx === L('Hello Canvas', 'مرحبا باللوحة') && txt.h > 20, `Text box adds text (height follows the text: ${txt?.h})`);
  await click('[data-a="text"]'); await key('Escape');
  ok((await items()).filter((i) => i.t === 'text').length === 1, 'an empty text box goes away');
  await click('[data-a="shape"]');
  ok(await exists('.cv-pop-lib .cv-lib-grid button'), 'Shapes opens the shape picker');
  await shot(P + 'canvas-02-shapes');
  await click('.cv-lib-grid [data-id="rect"]');
  let rect = await find((i) => i.t === 'shape' && i.k === 'rect');
  ok(rect && rect.fill, 'the picker adds a square');
  await key('Escape');
  await click('[data-a="shape"]');
  await page.type('.cv-lib-q input', L('cloud', 'سحاب')); await sleep(200);
  const found = await page.$$eval('.cv-lib-grid [data-id]', (n) => n.map((x) => x.dataset.id));
  ok(found[0] === 'cloud', 'shape search finds the cloud (' + found.join(',') + ')');
  await click('.cv-lib-grid [data-id="cloud"]');
  ok(await find((i) => i.k === 'cloud'), 'the picker adds an object shape');
  await key('Escape');
  await click('[data-a="line"]');
  ok(await count('.cv-pop-lines [data-id]') === 5, 'Lines offers line, arrow, double arrow, curve, elbow');
  await click('.cv-pop-lines [data-id="arrow"]');
  const line = await find((i) => i.t === 'line');
  ok(line && line.hb && !line.a.id, 'Lines adds an arrow with free ends');
  await key('Escape');
  await click('[data-a="link"]');
  ok(await exists('.cv-link-dlg'), 'Link opens the Add link dialog');
  await page.type('.cv-link-dlg input[type=url]', 'samsung.com/galaxy');
  await page.type('.cv-link-dlg input[type=text]', L('Galaxy phones', 'هواتف جالاكسي'));
  await click('.cv-link-dlg .ou-dialog-btn.primary'); await sleep(400);
  const link = await find((i) => i.t === 'link');
  ok(link?.u === 'https://samsung.com/galaxy' && link.tx === L('Galaxy phones', 'هواتف جالاكسي'), 'Add link adds a link card');
  ok(await page.$eval('.cv-link img', (i) => i.src.includes('_favicon')), 'the link card shows the site icon from Chrome');
  await key('Escape');
  const png = require('path').join(require('os').tmpdir(), 'canvas-test.png');
  require('fs').writeFileSync(png, makePng(160, 100));
  const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('[data-a="photo"]')]);
  await fc.accept([png]); await sleep(1200);
  const img = await find((i) => i.t === 'img');
  ok(img && Math.abs(img.w / img.h - 1.6) < 0.05, 'Image adds the picture with its proportions');
  ok(img && img.b.startsWith('canvas:img-') && (await page.evaluate((k) => import('./js/core/blobs.js').then((m) => m.getBlob(k)).then((b) => b?.size || 0), img.b)) > 0, 'the picture is kept in IndexedDB as ' + img?.b);
  ok(await page.waitForFunction(() => document.querySelector('.cv-img img')?.naturalWidth > 0, { timeout: 4000 }).then(() => true, () => false), 'the picture shows on the board');
  await key('Escape');

  // ---------------------------------------------------------------- arranging: move, undo, resize, connect, format
  await click('[data-a="fit"]'); await sleep(700);
  await key('-'); await key('-'); await sleep(300);
  let st = await S();
  ok(st.view.z > 0.1 && st.view.z < 2, 'Zoom to fit and zoom out (' + Math.round(st.view.z * 100) + '%)');
  note = await find((i) => i.t === 'note');
  const c0 = await centre(note), z = st.view.z;
  await drag(c0, [c0[0] + 60, c0[1] + 40], 12, ['Alt']);
  let moved = await find((i) => i.id === note.id);
  ok(Math.abs(moved.x - note.x - 60 / z) < 3 && Math.abs(moved.y - note.y - 40 / z) < 3, 'dragging moves the note');
  await key('KeyZ', ['Control']);
  ok((await find((i) => i.id === note.id)).x === note.x, 'Ctrl+Z undoes the move');
  await key('KeyZ', ['Control', 'Shift']);
  ok((await find((i) => i.id === note.id)).x === moved.x, 'Ctrl+Shift+Z redoes it');
  ok(await page.$eval('.cv-undo', (b) => !b.disabled), 'the app bar Undo button is on');
  rect = await find((i) => i.id === rect.id);
  await page.mouse.click(...(await centre(rect))); await sleep(300);
  ok((await S()).sel[0] === rect.id && await visible('.cv-fbar'), 'a click selects the square and shows the selection toolbar');
  const se = await page.$eval('.cv-h[data-h="se"]', (n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await drag(se, [se[0] + 40, se[1] + 40]);
  const rect2 = await find((i) => i.id === rect.id);
  ok(rect2.w > rect.w + 20, `the corner handle resizes (${rect.w} → ${rect2.w})`);
  await click('.cv-fbar [data-f="fill"]');
  ok(await exists('.cv-pop-color .cv-sw'), 'Fill opens the colour popover');
  await shot(P + 'canvas-03-fill');
  await click('.cv-pop-color .cv-sw[data-c="#ef3e36"]');
  ok((await find((i) => i.id === rect.id)).fill === '#ef3e36', 'the square turns red');
  await key('Escape'); await key('Escape');
  moved = await find((i) => i.id === note.id);
  await page.mouse.click(...(await centre(moved))); await sleep(300);
  const cd = await page.$eval('.cv-cd[data-s="e"]', (n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await drag(cd, await centre(await find((i) => i.id === rect.id)), 14);
  const conn = await find((i) => i.t === 'line' && i.a?.id === note.id);
  ok(conn && conn.b?.id === rect.id, 'dragging a connection point joins the note and the square');
  await key('Escape');

  // ---------------------------------------------------------------- the pen toolbar
  st = await S();
  const vr = await viewRect();
  const cb = (await page.evaluate(() => import('./js/canvas/model.js').then(async (M) => M.contentBox((await import('./js/canvas/board.js')).state().items))));
  // an empty part of the board, left of everything
  const wx0 = cb.x - 260 / st.view.z, wy0 = cb.y + cb.h / 2;
  const [sx0, sy0] = await scr(wx0, wy0);
  ok(sx0 > vr.l + 30 && sx0 < vr.r, 'there is room left of the content to draw (' + Math.round(sx0 - vr.l) + 'px)');
  await click('[data-tool="pen"]');
  ok((await S()).mode === 'draw' && await exists('[data-tool="pen"].on'), 'Pen picks up the pen');
  const squiggle = Array.from({ length: 16 }, (_, i) => [sx0 + i * 8, sy0 - 60 + Math.sin(i / 2) * 18]);
  await path(squiggle);
  const pen = await find((i) => i.t === 'ink');
  ok(pen && pen.tool === 'pen' && pen.p.length % 3 === 0, 'drawing adds a pen stroke');
  await click('[data-tool="pen"]');
  ok(await exists('.cv-pop-pens .cv-ptypes'), 'tapping the pen again opens Pen settings');
  await shot(P + 'canvas-04-pen');
  await click('.cv-ptypes [data-p="pencil"]');
  await click('.cv-pop-pens .cv-sw[data-c="#1f8bff"]');
  await click('.cv-auto');
  await key('Escape');
  const pf = await prefs();
  ok(pf.ink?.pen === 'pencil' && pf.ink?.col?.pen === '#1f8bff' && pf.ink?.auto === true, 'pen type, colour and Auto shape are remembered');
  const circle = Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return [sx0 + 60 + Math.cos(a) * 45, sy0 + 70 + Math.sin(a) * 35]; });
  await path(circle);
  const oval = await find((i) => i.t === 'shape' && i.k === 'oval');
  ok(oval && oval.fill === 'none' && oval.st === '#1f8bff', 'Auto shape turns a rough circle into a clean oval');
  await click('[data-tool="pen"]'); await click('.cv-auto'); await key('Escape');
  await click('[data-tool="hl"]');
  await path(Array.from({ length: 10 }, (_, i) => [sx0 + i * 12, sy0 + 150]));
  ok(await find((i) => i.t === 'ink' && i.tool === 'hl'), 'the highlighter draws');
  await click('[data-tool="eraser"]');
  const before = (await items()).filter((i) => i.t === 'ink').length;
  await drag([sx0 + 60, sy0 - 110], [sx0 + 60, sy0 - 10], 10);
  const inks = (await items()).filter((i) => i.t === 'ink');
  ok(!inks.some((i) => i.id === pen.id) && inks.length >= before, `erasing by area cuts the stroke (${before} → ${inks.length} strokes)`);
  await click('[data-tool="eraser"]');
  ok(await exists('.cv-pop-pens .cv-seg'), 'the eraser has its settings (by area, by stroke)');
  await clickText('.cv-pop-pens .cv-seg button', L('Erase by stroke', 'المسح حسب الخط'));
  await key('Escape');
  ok((await prefs()).ink?.erase === 'stroke', 'Erase by stroke is remembered');
  await click('[data-tool="lasso"]');
  moved = await find((i) => i.id === note.id);
  const [nx, ny] = await scr(moved.x, moved.y), nw = moved.w * (await S()).view.z;
  await path([[nx - 15, ny - 15], [nx + nw + 15, ny - 15], [nx + nw + 15, ny + nw + 15], [nx - 15, ny + nw + 15], [nx - 16, ny - 10]]);
  st = await S();
  ok(st.mode === 'lasso' && st.sel.includes(note.id) && !st.sel.includes(rect.id), 'the lasso selects what it goes round');
  ok(await visible('.cv-fbar'), 'the selection toolbar shows over the lasso selection');
  await key('v');
  ok((await S()).mode === 'select', 'V goes back to Select');

  // ---------------------------------------------------------------- group, align, arrange, lock, duplicate, clipboard
  await key('KeyA', ['Control']);
  st = await S();
  ok(st.sel.length === st.items.length, 'Ctrl+A selects everything');
  await key('KeyG', ['Control']);
  const groups = new Set((await items()).map((i) => i.g));
  ok(groups.size === 1 && [...groups][0], 'Ctrl+G groups');
  await key('KeyG', ['Control', 'Shift']);
  ok((await items()).every((i) => !i.g), 'Ctrl+Shift+G ungroups');
  await key('Escape');
  await page.mouse.click(...(await centre(await find((i) => i.id === note.id)))); await sleep(200);
  await page.keyboard.down('Shift'); await page.mouse.click(...(await centre(await find((i) => i.id === rect.id)))); await page.keyboard.up('Shift'); await sleep(300);
  ok((await S()).sel.length === 2, 'Shift+click adds to the selection');
  await click('.cv-fbar [data-f="align"]');
  await menuPick(L('Align top', 'محاذاة إلى الأعلى'));
  const nT = await find((i) => i.id === note.id), rT = await find((i) => i.id === rect.id);
  ok(Math.abs(nT.y - rT.y) < 0.2, 'Align top lines them up');
  await key('Escape');
  await page.mouse.click(...(await centre(nT))); await sleep(250);
  await click('.cv-fbar [data-f="more"]');
  await menuPick(L('Send to back', 'إرسال إلى الخلفية'));
  ok((await items())[0].id === note.id, 'Send to back puts the note under everything');
  await key('KeyL', ['Control']);
  ok((await find((i) => i.id === note.id)).lk === true && await exists('.cv-fbar [data-f="unlock"]'), 'Ctrl+L locks (the toolbar offers Unlock)');
  await key('Delete');
  ok(await find((i) => i.id === note.id), 'a locked item can’t be deleted');
  await click('.cv-fbar [data-f="unlock"]');
  ok(!(await find((i) => i.id === note.id)).lk, 'Unlock');
  await key('Escape');
  await page.mouse.click(...(await centre(await find((i) => i.id === rect.id)))); await sleep(250);
  let n0 = (await items()).length;
  await key('KeyD', ['Control']);
  ok((await items()).length === n0 + 1, 'Ctrl+D duplicates');
  await key('Delete');
  ok((await items()).length === n0, 'Delete removes the copy');
  await page.mouse.click(...(await centre(await find((i) => i.id === rect.id)))); await sleep(250);
  await key('KeyC', ['Control']); await key('KeyV', ['Control']); await sleep(500);
  ok((await items()).length === n0 + 1, 'Ctrl+C, Ctrl+V pastes a copy');
  await key('KeyZ', ['Control']);
  ok((await items()).length === n0 && !(await S()).sel.length, 'and Undo takes it away');

  // ---------------------------------------------------------------- scenes, grid, zoom, save, rename
  await click('[data-a="scenes"]');
  ok(await exists('.cv-pop-scenes .cv-scn-empty'), 'Scenes: empty list at first');
  await click('.cv-pop-scenes [data-add]'); await sleep(900);
  ok((await S()).scenes.length === 1 && await exists('.cv-scn.has'), 'Add scene saves the view (the pill shows scene arrows)');
  await key('Escape');
  await actBtn(3);
  await menuPick(L('Show grid', 'إظهار الشبكة')); await sleep(300);
  ok(await exists('.cv-view.grid'), 'Show grid draws the dot grid');
  await actBtn(3);
  await menuPick(L('Snap to grid', 'المحاذاة إلى الشبكة')); await sleep(900);
  bs = await boards();
  ok(bs[0].grid && bs[0].snap, 'grid and snap are kept with the board');
  const r3 = await find((i) => i.id === rect.id), rc = await centre(r3);
  await drag(rc, [rc[0] + 37, rc[1] + 29]);
  const r4 = await find((i) => i.id === rect.id);
  ok(r4.x % 24 === 0 && r4.y % 24 === 0, `Snap to grid moves in steps of 24 (${r4.x}, ${r4.y})`);
  await key('Escape');
  await key('0');
  ok(Math.round((await S()).view.z * 100) === 100 && (await text('.cv-zpct')) === '100%', '0 zooms to 100%');
  const vr2 = await viewRect();
  await page.mouse.move(vr2.l + vr2.w / 2, vr2.t + vr2.h / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: -120 }); await page.keyboard.up('Control'); await sleep(250);
  ok((await S()).view.z > 1.05, 'Ctrl+wheel zooms in');
  await page.mouse.wheel({ deltaY: 200 }); await sleep(250);
  await click('[data-a="fit"]'); await sleep(700);
  await shot(P + 'canvas-05-board');
  await actBtn(2);
  await menuPick(L('Save as image', 'حفظ كصورة'));
  let dl = await download(1);
  ok(dl && /\.png$/.test(dl.name) && dl.head.slice(0, 4).join() === '137,80,78,71', 'Save as image downloads a PNG: ' + dl?.name);
  await actBtn(2);
  await menuPick(L('Save as PDF', 'حفظ كملف PDF'));
  dl = await download(2);
  ok(dl && /\.pdf$/.test(dl.name) && String.fromCharCode(...dl.head.slice(0, 5)) === '%PDF-', 'Save as PDF downloads a PDF (no library)');
  await click('.cv-title'); await sleep(200);
  await page.focus('.ou-dialog .ou-input');
  await key('KeyA', ['Control']);
  await page.keyboard.type(L('Launch plan', 'خطة الإطلاق'));
  await click('.ou-dialog-btn.primary'); await sleep(400);
  ok((await boards())[0].name === L('Launch plan', 'خطة الإطلاق') && (await text('.cv-board-page .app-toolbar-title')) === L('Launch plan', 'خطة الإطلاق'), 'tapping the title renames the board');

  // ---------------------------------------------------------------- back to the gallery
  await key('Escape');
  ok(!(await exists('.cv-board')), 'Escape with nothing selected goes back to the gallery');
  await sleep(1500);
  bs = await boards();
  const saved = bs[0], types = new Set(saved.items.map((i) => i.t));
  ok(['note', 'text', 'shape', 'line', 'link', 'img', 'ink'].every((t) => types.has(t)), 'every kind of item is saved: ' + [...types].join(','));
  ok(saved.view?.w > 0 && saved.scenes.length === 1, 'the view and the scene are saved');
  ok(await page.waitForFunction(() => document.querySelector('.cv-thumb img.on'), { timeout: 8000 }).then(() => true, () => false), 'the card shows a preview of the board');
  ok(saved.thumb?.l?.startsWith('canvas:th-') && saved.thumb?.d, 'light and dark previews are stored');
  ok((await text('.cv-card .cv-name')) === L('Launch plan', 'خطة الإطلاق') && (await text('.cv-hero-s')) === L('1 board', 'لوحة واحدة'), 'the card shows the name; the title shows the count');
  await shot(P + 'canvas-06-gallery');
  await click('.cv-card'); await sleep(900);
  ok((await S())?.items.length === saved.items.length, 'reopening the board brings everything back');
  await click('.cv-board-page .app-back'); await sleep(600);

  // favorites, search, list view
  await page.click('.cv-card', { button: 'right' }); await sleep(300);
  await menuPick(L('Add to favorites', 'إضافة إلى المفضلة')); await sleep(300);
  ok((await boards())[0].fav === true && await exists('.cv-card .cv-fav'), 'Add to favorites marks the card with a star');
  await click('.cv-nav-row[data-view="favs"]');
  ok(await count('.cv-card') === 1 && (await text('.cv-hero-t')) === L('Favorites', 'المفضلة'), 'Favorites lists it');
  await click('.cv-nav-row[data-view="all"]');
  await page.click(`.cv-bar [aria-label="${L('Search', 'بحث')}"]`); await sleep(200);
  await page.keyboard.type(L('brainstorm', 'أفكار')); await sleep(300);
  ok(await count('.cv-card') === 1, 'search finds the board by the text on it');
  await page.keyboard.type('zzz'); await sleep(300);
  ok(await count('.cv-card') === 0 && await exists('.cv-empty'), 'no results for something else');
  await page.click(`.cv-bar [aria-label="${L('Back', 'رجوع')}"]`); await sleep(300);
  await page.click(`.cv-bar [aria-label="${L('More options', 'خيارات إضافية')}"]`); await sleep(300);
  await menuPick(L('List', 'قائمة'));
  ok(await exists('.cv-grid.list .cv-card'), 'View: List');
  await shot(P + 'canvas-07-list');
  await page.click(`.cv-bar [aria-label="${L('More options', 'خيارات إضافية')}"]`); await sleep(300);
  await menuPick(L('Grid', 'شبكة'));

  // ---------------------------------------------------------------- Finder: new board, search
  await closeApp();
  await mod('./js/shell/finder.js', 'openFinder', ''); await sleep(300);
  await page.keyboard.type(L('new board Trip', 'لوحة جديدة رحلة')); await sleep(600);
  const fr = await texts('.fr-title');
  ok(fr.some((x) => x.includes(L('New board “Trip”', 'لوحة جديدة «رحلة»'))), 'Finder offers “New board”: ' + fr.slice(0, 3).join(' | '));
  await clickText('.fr', L('New board “Trip”', 'لوحة جديدة «رحلة»')); await sleep(1300);
  bs = await boards();
  ok(bs.length === 2 && bs.some((b) => b.name === L('Trip', 'رحلة')) && (await S())?.items.length === 0, 'the command creates and opens the named board');
  await closeApp();
  await mod('./js/shell/finder.js', 'openFinder', ''); await sleep(300);
  await page.keyboard.type(L('Brainstorm', 'أفكار لإطلاق')); await sleep(800);
  const fr2 = await texts('.fr-title');
  ok(fr2.includes(L('Launch plan', 'خطة الإطلاق')), 'Finder finds the board by its text');
  await clickText('.fr', L('Launch plan', 'خطة الإطلاق')); await sleep(1300);
  ok((await S())?.items.length === saved.items.length, 'a Finder result opens the board');
  await closeApp();
  await mod('./js/shell/finder.js', 'closeFinder'); await sleep(300);

  // ---------------------------------------------------------------- the Recent boards widget
  // adding it asks which board to show first (Widget settings): the older “Trip” goes in front
  await page.evaluate(() => { import('./js/shell/home.js').then((m) => { m.addWidget('canvas', 'm'); }); }); await sleep(800);
  ok(await count('.ou-dialog .ou-radio-row') === 3, 'adding the widget asks which board to show first (Most recent + 2 boards)');
  await page.evaluate((name) => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((r) => r.textContent.includes(name))?.click(), L('Trip', 'رحلة'));
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click()); await sleep(900);
  ok(await count('.wg-canvas .wg-cv-b') === 2, 'the Recent boards widget shows both boards');
  ok(await page.evaluate(() => document.querySelector('.wg-canvas .wg-cv-b')?.title) === L('Trip', 'رحلة') && JSON.stringify(await store('home')).includes('"board":"'), 'the picked board shows first');
  ok(await page.waitForFunction(() => document.querySelector('.wg-canvas img.on'), { timeout: 5000 }).then(() => true, () => false), 'the widget shows previews');
  await page.$eval('.wg-canvas', (n) => n.closest('.widget-tile').scrollIntoView());
  await shot(P + 'canvas-08-widget');
  await page.evaluate((name) => [...document.querySelectorAll('.wg-canvas .wg-cv-b')].find((b) => b.title === name)?.click(), L('Launch plan', 'خطة الإطلاق')); await sleep(1300);
  ok((await S())?.items.length === saved.items.length, 'a tap on a board in the widget opens it');
  await click('.cv-board-page .app-back'); await sleep(600);

  // ---------------------------------------------------------------- selection mode and the Recycle bin
  await page.click(`.cv-bar [aria-label="${L('More options', 'خيارات إضافية')}"]`); await sleep(300);
  await menuPick(L('Edit', 'تحرير'));
  ok(await count('.cv-pick') === 2 && await visible('.cv-selbar'), 'Edit shows check circles and the bottom bar');
  await page.evaluate((name) => [...document.querySelectorAll('.cv-card')].find((c) => c.getAttribute('aria-label') === name)?.click(), L('Trip', 'رحلة')); await sleep(300);
  ok((await text('.cv-bar-sel')) === L('1 selected', 'تم تحديد 1'), 'tapping a card selects it');
  await shot(P + 'canvas-09-select');
  await page.$$eval('.cv-selbar .cv-sbtn', (b) => b.at(-1).click()); await sleep(500);
  bs = await boards();
  ok(bs.find((b) => b.name === L('Trip', 'رحلة'))?.deleted > 0 && await count('.cv-card') === 1, 'Delete moves the board to the Recycle bin');
  await click('.cv-nav-row[data-view="bin"]');
  ok(await count('.cv-card') === 1 && (await text('.cv-card .cv-date')) === L('30 days left', 'يتبقى 30 يوم') && await visible('.cv-bin-note'), 'the Recycle bin shows days left');
  await shot(P + 'canvas-10-bin');
  await page.click('.cv-card', { button: 'right' }); await sleep(300);
  await menuPick(L('Restore', 'استعادة'));
  ok(!(await boards()).some((b) => b.deleted), 'Restore brings it back');
  // a copy shares the picture: erasing the copy for good keeps the picture
  await click('.cv-nav-row[data-view="all"]');
  const launch = (await boards()).find((b) => b.name === L('Launch plan', 'خطة الإطلاق'));
  await page.evaluate((id) => [...document.querySelectorAll('.cv-card')].find((c) => c.dataset.id === id)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 400 })), launch.id); await sleep(300);
  await menuPick(L('Duplicate', 'تكرار')); await sleep(1500);
  bs = await boards();
  const copy = bs.find((b) => b.name === L('Launch plan copy', 'نسخة من خطة الإطلاق'));
  ok(copy && copy.items.length === launch.items.length && copy.id !== launch.id, 'Duplicate makes a copy: ' + copy?.name);
  await page.evaluate((id) => [...document.querySelectorAll('.cv-card')].find((c) => c.dataset.id === id)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 400 })), copy.id); await sleep(300);
  await menuPick(L('Delete', 'حذف')); await sleep(300);
  await click('.cv-nav-row[data-view="bin"]');
  await page.click('.cv-card', { button: 'right' }); await sleep(300);
  await menuPick(L('Delete', 'حذف')); await sleep(300);
  await click('.ou-dialog-btn.danger'); await sleep(600);
  bs = await boards();
  const imgKey = launch.items.find((i) => i.t === 'img').b;
  ok(!bs.some((b) => b.id === copy.id), 'Delete in the Recycle bin erases the board for good');
  ok((await page.evaluate((k) => import('./js/core/blobs.js').then((m) => m.getBlob(k)).then((b) => b?.size || 0), imgKey)) > 0, 'the picture the original still uses is kept');
  await click('.cv-nav-row[data-view="all"]');

  // ---------------------------------------------------------------- a narrow window
  await page.setViewport({ width: 560, height: 820 }); await sleep(700);
  ok(await exists('.cv-gal[data-cols="1"]') && !(await visible('.cv-nav')), 'narrow: the side pane becomes a drawer');
  await page.click(`.cv-bar [aria-label="${L('Navigation menu', 'قائمة التنقل')}"]`); await sleep(450);
  ok(await visible('.cv-nav') && (await page.$eval('.cv-nav', (n) => { const r = n.getBoundingClientRect(); return r.width > 100; })), 'the menu button opens the drawer');
  await shot(P + 'canvas-11-narrow-drawer');
  await key('Escape');
  ok(!(await visible('.cv-nav')), 'Escape closes the drawer');
  await click('.cv-card'); await sleep(900);
  ok(await exists('.cv-board.narrow') && await visible('[data-a="insert"]') && !(await visible('[data-a="note"]')), 'narrow board: the insert tools fold into one Insert button');
  const off = await page.evaluate(() => { const r = document.querySelector('.cv-tools').getBoundingClientRect(), v = document.querySelector('.cv-view').getBoundingClientRect(); return r.left >= v.left && r.right <= v.right; });
  ok(off, 'the pen toolbar fits the narrow window');
  await click('[data-a="insert"]');
  ok(await count('.ou-menu-item') === 6, 'Insert lists the six insert tools');
  await shot(P + 'canvas-12-narrow');
  await key('Escape');
  await click('.cv-board-page .app-back'); await sleep(500);
  await page.setViewport({ width: 1440, height: 900 }); await sleep(500);
  await closeApp();

  // ---------------------------------------------------------------- 500 items stay fast
  const now = Date.now(), big = { id: 'bbig', name: 'Big', created: now, at: now, scenes: [], items: [] };
  for (let i = 0; i < 500; i++) {
    const x = (i % 25) * 240, y = Math.floor(i / 25) * 240, k = i % 6;
    if (k === 0) big.items.push({ id: 'b' + i, t: 'note', x, y, w: 200, h: 200, tx: 'Note ' + i });
    else if (k === 1) big.items.push({ id: 'b' + i, t: 'shape', k: ['rect', 'oval', 'star', 'cloud', 'heart'][i % 5], x, y, w: 160, h: 160, fill: '#4c8dff', tx: 'S' + i });
    else if (k === 2) big.items.push({ id: 'b' + i, t: 'text', x, y, w: 200, h: 36, fs: 22, tx: 'Text ' + i });
    else if (k === 3) { const p = []; for (let j = 0; j < 40; j++) p.push(j * 4, 40 + Math.sin(j / 4) * 30, 0.5); big.items.push({ id: 'b' + i, t: 'ink', x, y, w: 170, h: 90, iw: 170, ih: 90, tool: 'pen', col: 'auto', sz: 3, p }); }
    else if (k === 4) big.items.push({ id: 'b' + i, t: 'link', x, y, w: 220, h: 70, u: 'https://example.com/' + i, tx: 'Link ' + i });
    else big.items.push({ id: 'b' + i, t: 'line', a: { id: 'b' + (i - 5), s: 'auto' }, b: { id: 'b' + (i - 4), s: 'auto' }, k: ['s', 'c', 'e'][i % 3], hb: true });
  }
  await setStorage({ canvas: [big, ...(await boards())] }); await sleep(400);
  await openApp('canvas', { section: 'board:bbig' }); await sleep(2500);
  ok(await count('.cv-world .cv-it') === 500, 'a board with 500 items opens (' + (await count('.cv-world .cv-it')) + ' on the page)');
  // the median frame time while the board pans or zooms (no eval in an extension page, so the moves are named)
  const frames = (kind) => page.evaluate((kind) => new Promise((res) => {
    const v = document.querySelector('.cv-view'), r = v.getBoundingClientRect(), times = [];
    const act = (k) => kind !== 'idle' && v.dispatchEvent(new WheelEvent('wheel', kind === 'pan' ? { deltaX: 14, deltaY: 9, clientX: r.left + 300, clientY: r.top + 300, bubbles: true, cancelable: true } : { deltaY: k < 20 ? -8 : 8, ctrlKey: true, clientX: r.left + 300, clientY: r.top + 300, bubbles: true, cancelable: true }));
    let last = performance.now(), k = 0;
    const step = (t) => { times.push(t - last); last = t; if (k++ < 40) { act(k); requestAnimationFrame(step); } else { const s = times.slice(3).sort((a, b) => a - b); res(s[Math.floor(s.length / 2)]); } };
    requestAnimationFrame(step);
  }), kind);
  const shownCount = () => page.$$eval('.cv-world .cv-it', (n) => n.filter((e) => e.style.display !== 'none').length);
  ok(await shownCount() === 500, 'zoomed to fit, every item is on the page');
  await key('0'); await sleep(600);
  const near = await shownCount();
  ok(near > 20 && near < 300, `at 100% only the items near the window are painted (${near} of 500)`);
  const pan = await frames('pan'), zoom = await frames('zoom'), idle = await frames('idle');
  // frame times on this shared, GPU-less test machine are mostly noise: the default check only catches a board that
  // has become sluggish; PERF_STRICT=1 applies Liquid Tab's budgets (34 ms pan, 50 ms zoom)
  const [bp, bz] = process.env.PERF_STRICT ? [34, 50] : [150, 150];
  ok(pan < Math.max(bp, process.env.PERF_STRICT ? 0 : idle * 2) && zoom < Math.max(bz, process.env.PERF_STRICT ? 0 : idle * 2), `panning and zooming 500 items stay smooth (median frame: idle ${idle.toFixed(1)}, pan ${pan.toFixed(1)}, zoom ${zoom.toFixed(1)} ms)`);
  await click('[data-a="fit"]'); await sleep(600);
  ok(await shownCount() === 500, 'zooming out brings every item back');
  await shot(P + 'canvas-13-big');
  await closeApp();

  // ---------------------------------------------------------------- Modes and Routines: "New board"
  const nb = await page.evaluate(async (name) => {
    const { ACTIONS } = await import('./js/routines/actions.js');
    const { pageCtx } = await import('./js/routines/page.js');
    try { await ACTIONS['canvas.new'].run(pageCtx(), { name }); return 'ok'; } catch (e) { return e.key || e.message; }
  }, L('Daily plan', 'خطة اليوم'));
  await sleep(1500);
  ok(nb === 'ok' && (await boards()).some((b) => b.name === L('Daily plan', 'خطة اليوم') && !b.deleted) && (await S())?.items.length === 0, 'Routines: “New board” creates and opens a named board');
  await closeApp();
};
