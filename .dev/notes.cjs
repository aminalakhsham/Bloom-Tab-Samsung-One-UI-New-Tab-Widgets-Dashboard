// triple
// Samsung Notes end to end: seeded list (pinned group, modified order), checklist tap, a new note with every format
// (bold/italic/underline/strike, bullets, numbers, checklist), colour, pin/unpin, sort by title/created, grid view,
// search, delete + Undo, empty-note discard, edits saved on close, external changes, the widgets, Finder `note:` and
// Finder search; then the Samsung Notes parity work: the drawer (folders with colours, Favourites, Recently deleted
// 30 days, #tags), move to folder, selection mode, the text style popover (paragraph style, size, colour, highlight,
// alignment), tables, pictures, drawings, divider, Undo/Redo, auto lists, page templates, templates, locked notes with
// the screen PIN, PDF/Markdown/Text export, narrow windows, and the fixed bugs (colour names translated, numbered
// items in plain text, a long English title in the Arabic editor). Strings come from t() so it passes in English and Arabic.
// usage: .dev/run.sh .dev/notes.cjs   (THEME=dark / UI=ar)
module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, visible, mod, store, setStorage, getStorage, sleep, shot, P, ui, outside }) => {
  const ar = ui === 'ar';
  const L = (en, a) => (ar ? a : en);
  const T = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const now = Date.now(), H = 36e5, D = 864e5;
  const NAMES = {
    n1: L('Shopping list', 'قائمة التسوق'), n2: L('Trip ideas', 'أفكار الرحلة'), n3: L('Meeting notes', 'ملاحظات الاجتماع'), n4: L('Alpha', 'أبجد'),
  };
  const seed = [
    { id: 'n1', title: NAMES.n1, body: `<ul class="checklist"><li>${L('Milk', 'حليب')}</li><li data-checked="true">${L('Eggs', 'بيض')}</li></ul>`, color: 'yellow', pinned: true, created: now - 3 * D, updated: now - H },
    { id: 'n2', title: NAMES.n2, body: `<div>${L('Visit Lisbon', 'زيارة لشبونة')}</div>`, color: 'none', pinned: false, created: now - 2 * D, updated: now - 2 * H },
    { id: 'n3', title: '', body: `<div>${NAMES.n3}</div><div>${L('Discuss the roadmap', 'مناقشة خطة العمل')}</div>`, color: 'blue', pinned: false, created: now - 10 * D, updated: now - 30 * 60e3 },
    { id: 'n4', title: NAMES.n4, body: '<div>zebra</div>', color: 'none', pinned: false, created: now - D, updated: now - 5 * D },
  ];
  const home = [[
    { id: 'wn-s', type: 'widget', widget: 'notes', size: 's', config: {} },
    { id: 'wn-m', type: 'widget', widget: 'notes', size: 'm', config: {} },
  ]];
  await boot({ data: { notes: seed, home, dock: [] } });

  const notes = () => store('notes');
  const byId = async (id) => (await notes()).find((n) => n.id === id);
  const cardTitles = () => texts('.notes-list .note-card .note-card-title');
  const activeTitle = () => text('.note-card.active .note-card-title');
  const cardByTitle = (title) => page.evaluateHandle((t) => [...document.querySelectorAll('.note-card')].find((c) => c.querySelector('.note-card-title')?.textContent === t), title);
  const clickCard = async (title) => { const c = await cardByTitle(title); ok(!!(await c.evaluate((x) => !!x)), 'card ' + title + ' found'); await c.evaluate((x) => x.click()); await sleep(300); };
  const rightClickCard = async (title) => {
    const c = await cardByTitle(title);
    await c.evaluate((x) => x.scrollIntoView({ block: 'center' }));
    await sleep(100);
    const box = await c.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  };
  const topBtn = async (key) => `.note-top .ou-icon-btn[title="${await T(key)}"]`;
  const fmt = (cmd) => click(`.note-fmt[data-cmd="${cmd}"]`);
  const kb = page.keyboard;
  const parse = (html) => page.evaluate((s) => {
    const d = document.createElement('div');
    d.innerHTML = s;
    return {
      b: [...d.querySelectorAll('b')].map((x) => x.textContent), i: [...d.querySelectorAll('i')].map((x) => x.textContent),
      u: [...d.querySelectorAll('u')].map((x) => x.textContent), s: [...d.querySelectorAll('s')].map((x) => x.textContent),
      bullets: [...d.querySelectorAll('ul:not(.checklist) > li')].map((x) => x.textContent), numbers: [...d.querySelectorAll('ol > li')].map((x) => x.textContent),
      checks: [...d.querySelectorAll('ul.checklist > li')].map((x) => [x.textContent, x.getAttribute('data-checked') === 'true']),
      bad: d.querySelectorAll('script, img, style, span, font, [style]').length,
    };
  }, html);

  // ———————————————————————————————— store: our own quick writes must not come back as stale values
  // (chrome.storage.onChanged echoes each write later; applying an older echo rolled the notes list back and made
  // the editor drop the note being written).
  const race = await page.evaluate(() => import('./js/core/store.js').then(async ({ store }) => {
    const seen = [];
    const off = store.on('raceTest', (v) => seen.push(v?.n));
    store.set('raceTest', { n: 1, b: 'x', a: [1] });
    store.set('raceTest', { n: 2, b: 'y', a: [2] });
    store.set('raceTest', { n: 3, b: 'z', a: [3] });
    await new Promise((r) => setTimeout(r, 500));
    off();
    return { seen, last: store.get('raceTest').n };
  }));
  ok(JSON.stringify(race.seen) === '[1,2,3]' && race.last === 3, 'store: three quick writes emit once each and never roll back: ' + JSON.stringify(race));
  await setStorage({ raceTest: { n: 9, b: 'other tab' } });
  await sleep(300);
  ok((await page.evaluate(() => import('./js/core/store.js').then(({ store }) => store.get('raceTest').n))) === 9, 'store: a later change from another context still applies');
  await page.evaluate(() => import('./js/core/store.js').then(({ store }) => store.remove('raceTest')));

  // ———————————————————————————————— list
  await openApp('notes');
  ok(await exists('.app-win.size-wide .notes-page'), 'Notes opens in a wide (two-pane) window');
  ok(JSON.stringify(await cardTitles()) === JSON.stringify([NAMES.n1, NAMES.n3, NAMES.n2, NAMES.n4]), 'pinned first, then by date modified: ' + JSON.stringify(await cardTitles()));
  ok(JSON.stringify(await texts('.notes-group')) === JSON.stringify([await T('notes.pinned'), await T('notes.others')]), 'Pinned and Notes group headers');
  ok((await text('.notes-count')) === (await T('notes.count', { n: 4 })), 'count shows 4 notes');
  ok((await activeTitle()) === NAMES.n1 && (await page.$eval('.note-title', (e) => e.value)) === NAMES.n1, 'first note opens in the editor');
  ok(await page.$eval('.notes-editor', (e) => e.classList.contains('tinted') && getComputedStyle(e).getPropertyValue('--nc').trim() === '#f5c400'), 'yellow note tints the editor');
  ok(await page.$eval('.notes-list .note-card', (e) => e.classList.contains('tinted') && !!e.querySelector('.note-card-pin')), 'pinned card is tinted and shows the pin');
  ok(await exists((await topBtn('notes.pin')) + '.active'), 'pin button is on for a pinned note');
  ok((await count('.note-body ul.checklist > li')) === 2 && (await count('.note-body ul.checklist > li[data-checked="true"]')) === 1, 'checklist renders with one checked item');
  ok((await text('.notes-list .note-card:nth-child(1) .note-card-snippet')) !== null, 'card shows a snippet');
  await shot(P + 'notes-01-list');

  // tap the circle of the first checklist item
  const circle = await page.$eval('.note-body ul.checklist > li', (li) => {
    const r = li.getBoundingClientRect(), rtl = getComputedStyle(li).direction === 'rtl';
    return { x: rtl ? r.right - 11 : r.left + 11, y: r.top + 12 };
  });
  await page.mouse.click(circle.x, circle.y);
  await sleep(700);
  let p = await parse((await byId('n1')).body);
  ok(p.checks.length === 2 && p.checks.every(([, c]) => c), 'tapping the circle checks the item and saves it: ' + JSON.stringify(p.checks));
  await page.mouse.click(circle.x, circle.y);
  await sleep(700);
  p = await parse((await byId('n1')).body);
  ok(!p.checks[0][1] && p.checks[1][1], 'tapping again unchecks it');

  // ———————————————————————————————— new note with formatting
  const before = (await notes()).length;
  await click('.notes-fab');
  await sleep(300);
  let list = await notes();
  const nid = list[0].id;
  ok(list.length === before + 1 && list[0].title === '' && list[0].body === '' && list[0].color === 'none' && list[0].pinned === false, 'FAB creates an empty note at the top of storage');
  ok(await page.evaluate(() => document.activeElement?.classList.contains('note-title')), 'title field has focus');
  await click('.notes-fab');
  ok((await notes()).length === before + 1, 'FAB again while the new note is empty does not add another');
  const TITLE = L('Weekend plan', 'خطة العطلة');
  await page.focus('.note-title');
  await kb.type(TITLE);
  await kb.press('Enter');
  ok(await page.evaluate(() => document.activeElement?.classList.contains('note-body')), 'Enter in the title moves to the body');
  await kb.type(L('Buy paint', 'شراء طلاء'));
  await kb.press('Enter');
  await fmt('bold'); await kb.type(L('Strong', 'قوي'));
  ok(await exists('.note-fmt[data-cmd="bold"].on'), 'bold button shows its on state while typing bold');
  await fmt('bold'); await kb.type(' ');
  await fmt('italic'); await kb.type(L('slanted', 'مائل')); await fmt('italic');
  await kb.press('Enter');
  await fmt('underline'); await kb.type(L('under', 'تحت')); await fmt('underline');
  await kb.press('Enter');
  await fmt('strikeThrough'); await kb.type(L('gone', 'محذوف')); await fmt('strikeThrough');
  await kb.press('Enter');
  await fmt('insertUnorderedList'); await kb.type(L('bullet A', 'نقطة أ')); await kb.press('Enter'); await kb.type(L('bullet B', 'نقطة ب'));
  await kb.press('Enter'); await kb.press('Enter');
  await fmt('insertOrderedList'); await kb.type(L('first', 'أولا')); await kb.press('Enter'); await kb.type(L('second', 'ثانيا'));
  await kb.press('Enter'); await kb.press('Enter');
  await fmt('checklist'); await kb.type(L('task one', 'مهمة أولى'));
  ok(await exists('.note-fmt[data-cmd="checklist"].on'), 'checklist button shows its on state inside a checklist');
  const c1 = await page.$eval('.note-body ul.checklist > li:last-child', (li) => {
    const r = li.getBoundingClientRect(), rtl = getComputedStyle(li).direction === 'rtl';
    return { x: rtl ? r.right - 11 : r.left + 11, y: r.top + 12 };
  });
  await page.mouse.click(c1.x, c1.y);
  await kb.press('End');
  await kb.press('Enter');
  await sleep(50);
  await kb.type(L('task two', 'مهمة ثانية'));
  await sleep(800);
  const n = await byId(nid);
  p = await parse(n.body);
  ok(n.title === TITLE, 'title saved');
  ok(p.b.some((x) => x.includes(L('Strong', 'قوي'))), 'bold saved as <b>');
  ok(p.i.some((x) => x.includes(L('slanted', 'مائل'))), 'italic saved as <i>');
  ok(p.u.some((x) => x.includes(L('under', 'تحت'))), 'underline saved as <u>');
  ok(p.s.some((x) => x.includes(L('gone', 'محذوف'))), 'strikethrough saved as <s>');
  ok(JSON.stringify(p.bullets) === JSON.stringify([L('bullet A', 'نقطة أ'), L('bullet B', 'نقطة ب')]), 'bulleted list with two items: ' + JSON.stringify(p.bullets));
  ok(JSON.stringify(p.numbers) === JSON.stringify([L('first', 'أولا'), L('second', 'ثانيا')]), 'numbered list with two items: ' + JSON.stringify(p.numbers));
  ok(JSON.stringify(p.checks) === JSON.stringify([[L('task one', 'مهمة أولى'), true], [L('task two', 'مهمة ثانية'), false]]), 'checklist: first checked, the new item after it starts unchecked: ' + JSON.stringify(p.checks));
  ok(p.bad === 0, 'saved HTML has no spans/styles/scripts');
  ok(n.updated > now && n.created > now, 'created/updated timestamps set');
  ok((await text('.note-card.active .note-card-snippet') || '').startsWith(L('Buy paint', 'شراء طلاء') + '\n'), 'card snippet keeps the first line on its own line');
  ok((await activeTitle()) === TITLE && (await cardTitles())[1] === TITLE, 'new note is selected and listed first under Pinned');
  ok((await text('.notes-count')) === (await T('notes.count', { n: 5 })), 'count shows 5 notes');
  await page.evaluate(() => document.querySelector('.note-scroll').scrollTo(0, 0));
  await shot(P + 'notes-02-formatted');

  // ———————————————————————————————— colour
  await click(await topBtn('notes.color'));
  await sleep(250);
  ok(await visible('.note-colors.show'), 'colour picker opens');
  ok((await count('.note-colors .note-color')) === 8, 'eight colour choices (incl. none)');
  ok((await outside('.note-colors')).length === 0, 'colour picker stays inside the screen');
  ok(await exists('.note-colors .note-color.none.active'), 'current colour (none) is marked');
  await shot(P + 'notes-03-colors');
  ok((await page.$eval('.note-colors .note-color[data-c="green"]', (e) => e.title)) === (await T('notes.c.green')), 'colour names are translated (title: ' + (await T('notes.c.green')) + ')');
  await click('.note-colors .note-color[data-c="green"]');
  await sleep(300);
  ok((await byId(nid)).color === 'green', 'colour saved (green)');
  ok(!(await exists('.note-colors')), 'picker closes after picking');
  ok(await page.$eval('.notes-editor', (e) => e.classList.contains('tinted') && getComputedStyle(e).getPropertyValue('--nc').trim() === '#2fb36b'), 'editor tinted green');
  ok(await page.$eval('.note-card.active', (e) => e.classList.contains('tinted')), 'card tinted');

  // ———————————————————————————————— pin / unpin
  await click(await topBtn('notes.pin'));
  await sleep(250);
  ok((await byId(nid)).pinned === true, 'pin button pins the note');
  ok(await exists((await topBtn('notes.pin')) + '.active'), 'pin button turns on');
  ok(JSON.stringify((await cardTitles()).slice(0, 2)) === JSON.stringify([TITLE, NAMES.n1]), 'both pinned notes on top, newest first');
  await rightClickCard(NAMES.n1);
  await sleep(250);
  ok(await visible('.ou-menu'), 'right-click on a card opens its menu');
  ok((await outside('.ou-menu')).length === 0, 'card menu inside the screen');
  ok((await text('.ou-menu .ou-menu-item .ou-menu-label')) === (await T('notes.unpin')), 'menu offers Unpin for a pinned note');
  await click('.ou-menu .ou-menu-item');
  await sleep(300);
  ok((await byId('n1')).pinned === false, 'Unpin from the menu');
  ok((await count('.notes-group')) === 2 && (await cardTitles())[0] === TITLE, 'only the new note stays pinned');

  // ———————————————————————————————— sort + grid
  const more = '.notes-page .app-toolbar-actions .ou-icon-btn';
  const pick = async (key) => { await click(more); await sleep(200); ok(await clickText('.ou-menu-item', await T(key)), 'menu item ' + key); await sleep(300); };
  await pick('notes.sortTitle');
  ok((await store('notesView'))?.sort === 'title', 'sort by title saved in notesView');
  let titles = await cardTitles();
  const rest = titles.slice(1);
  ok(titles[0] === TITLE && JSON.stringify(rest) === JSON.stringify([...rest].sort((a, b) => a.localeCompare(b))) && rest.length === 4, 'pinned first, the rest A–Z: ' + JSON.stringify(titles));
  await pick('notes.sortCreated');
  titles = await cardTitles();
  ok(JSON.stringify(titles) === JSON.stringify([TITLE, NAMES.n4, NAMES.n2, NAMES.n1, NAMES.n3]), 'sort by date created: ' + JSON.stringify(titles));
  await click(more); await sleep(200);
  ok((await count('.ou-menu-item .ou-menu-check')) === 2, 'menu checks the current view and sort');
  await page.keyboard.press('Escape'); await sleep(250);
  await pick('notes.sortModified');
  await pick('notes.viewGrid');
  ok((await store('notesView'))?.layout === 'grid' && (await exists('.notes-list.layout-grid')), 'grid view saved and applied');
  const cols = await page.$eval('.notes-list.layout-grid .notes-cards:last-child', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  ok(cols >= 2, 'grid shows cards in ' + cols + ' columns');
  await shot(P + 'notes-04-grid');
  await pick('notes.viewList');
  ok(await exists('.notes-list.layout-list'), 'back to list view');

  // ———————————————————————————————— search
  const search = async (q) => {
    await page.$eval('.notes-search input', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, q);
    await sleep(200);
  };
  await search(L('lisbon', 'لشبونة'));
  ok(JSON.stringify(await cardTitles()) === JSON.stringify([NAMES.n2]), 'search finds body text (case-insensitive)');
  ok(!(await exists('.notes-group')), 'no group headers while searching');
  await search(L('weekend', 'العطلة'));
  ok(JSON.stringify(await cardTitles()) === JSON.stringify([TITLE]), 'search finds titles');
  await search('qqqzzz');
  ok((await count('.note-card')) === 0 && (await exists('.notes-list .ou-empty')) && (await text('.notes-list .ou-empty')).includes(await T('notes.noResults')), 'no results state');
  await shot(P + 'notes-05-search-empty');
  await search('');
  ok((await count('.note-card')) === 5, 'clearing the search lists every note');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
  await sleep(150);
  ok(await page.evaluate(() => document.activeElement?.matches('.notes-search input')), 'Ctrl+F focuses the search box');

  // ———————————————————————————————— edit an existing title, external changes
  await clickCard(NAMES.n2);
  ok((await page.$eval('.note-title', (e) => e.value)) === NAMES.n2, 'clicking a card opens it');
  await page.$eval('.note-title', (e) => { e.focus(); e.select(); });
  const N2B = NAMES.n2 + ' 2026';
  await kb.type(N2B);
  await sleep(700);
  ok((await byId('n2')).title === N2B, 'title edit saved after typing: ' + JSON.stringify((await byId('n2')).title));
  ok((await byId('n2')).updated > now, 'editing touches updated');
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(1600);
  const ext = (await notes()).map((x) => (x.id === 'n2' ? { ...x, title: NAMES.n2 } : x));
  await setStorage({ notes: ext });
  await sleep(500);
  ok((await page.$eval('.note-title', (e) => e.value)) === NAMES.n2 && (await activeTitle()) === NAMES.n2, 'a change from another tab refreshes the open note and the list');

  // ———————————————————————————————— delete + undo, delete from menu
  const idx = (await notes()).findIndex((x) => x.id === 'n2');
  await click(await topBtn('common.delete'));
  await sleep(300);
  ok(!(await byId('n2')), 'delete button removes the note');
  ok(await visible('.ou-toast.show'), 'deleted toast shown');
  ok((await text('.ou-toast-action')) === (await T('common.undo')), 'toast offers Undo');
  ok((await activeTitle()) !== NAMES.n2 && (await activeTitle()) !== null, 'another note is selected after deleting');
  await shot(P + 'notes-06-deleted');
  await click('.ou-toast-action');
  await sleep(300);
  list = await notes();
  ok(list.findIndex((x) => x.id === 'n2') === idx && list.find((x) => x.id === 'n2').title === NAMES.n2, 'Undo puts the note back at the same place');
  ok((await activeTitle()) === NAMES.n2, 'Undo reopens the note');
  await rightClickCard(NAMES.n4);
  await sleep(250);
  await click('.ou-menu .ou-menu-item.danger');
  await sleep(300);
  ok(!(await byId('n4')) && !(await cardTitles()).includes(NAMES.n4), 'Delete from the card menu');

  // ———————————————————————————————— empty notes are discarded, typing right before closing is saved
  const cnt = (await notes()).length;
  await click('.notes-fab');
  await sleep(200);
  ok((await notes()).length === cnt + 1, 'new empty note while writing');
  await clickCard(NAMES.n2);
  ok((await notes()).length === cnt, 'leaving an empty note deletes it');
  await page.click('.note-body');
  await kb.press('End');
  await kb.type(' ' + L('last words', 'كلمات أخيرة'));
  await closeApp();
  ok((await byId('n2')).body.includes(L('last words', 'كلمات أخيرة')), 'edits typed right before closing are saved');

  // ———————————————————————————————— sanitizer + plain text
  const clean = await mod('./js/apps/notes.js', 'sanitize', '<b>x</b><script>alert(1)</script><img src="x.png"><span style="font-weight:700">y</span><a href="javascript:alert(1)">z</a><strong>w</strong>');
  ok(clean === '<b>x</b><b>y</b>z<b>w</b>', 'sanitize drops scripts/images/links and keeps bold: ' + clean);
  const plain = await mod('./js/apps/notes.js', 'noteText', '<div>Title</div><ul class="checklist"><li>Milk</li><li data-checked="true">Eggs</li></ul>');
  ok(plain === 'Title\n☐ Milk\n☑ Eggs', 'noteText turns checklists into ☐ / ☑ lines: ' + JSON.stringify(plain));
  const lines = await mod('./js/apps/notes.js', 'noteText', 'Buy paint<div><b>Strong</b> x</div><div>under</div>');
  ok(lines === 'Buy paint\nStrong x\nunder', 'noteText breaks the line before a <div> that follows bare text: ' + JSON.stringify(lines));

  // ———————————————————————————————— widgets
  await sleep(300);
  const sorted = (await notes()).filter((x) => x.title || x.body).sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  ok((await text('.widget-tile[data-id="wn-s"] .wg-notes-title')) === sorted[0].title, 'small widget shows the top note: ' + (await text('.widget-tile[data-id="wn-s"] .wg-notes-title')));
  ok(await page.$eval('.widget-tile[data-id="wn-s"] .wg-notes', (e) => e.classList.contains('tinted') && getComputedStyle(e).getPropertyValue('--nc').trim() === '#2fb36b'), 'small widget takes the note colour');
  ok((await count('.widget-tile[data-id="wn-m"] .wg-notes-row')) === 3, 'medium widget lists three notes');
  ok(JSON.stringify(await texts('.widget-tile[data-id="wn-m"] .wg-notes-row-title')) === JSON.stringify(sorted.slice(0, 3).map((x) => x.title || '')), 'medium widget rows in list order');
  await shot(P + 'notes-07-widgets');
  // open a row
  const rowIdx = sorted.slice(0, 3).findIndex((x) => x.id === 'n2');
  ok(rowIdx >= 0, 'n2 is in the medium widget');
  await page.click(`.widget-tile[data-id="wn-m"] .wg-notes-row:nth-child(${rowIdx + 1})`);
  await sleep(800);
  ok((await activeTitle()) === NAMES.n2, 'clicking a widget row opens that note');
  await closeApp();
  // + opens a new note
  const cnt2 = (await notes()).length;
  await page.click('.widget-tile[data-id="wn-s"] .wg-notes-add');
  await sleep(900);
  ok((await notes()).length === cnt2 + 1 && (await page.evaluate(() => document.activeElement?.classList.contains('note-title'))), 'widget + opens Notes on a new note');
  await closeApp();
  ok((await notes()).length === cnt2, 'closing without writing drops that empty note');
  // tapping the small widget opens its note
  const wb = await (await page.$('.widget-tile[data-id="wn-s"]')).boundingBox();
  await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height * 0.7);
  await sleep(900);
  ok((await activeTitle()) === sorted[0].title, 'tapping the small widget opens the top note');
  await closeApp();

  // ———————————————————————————————— Finder: note: command and search
  const cmdNote = await T('finder.cmdNote');
  await mod('./js/shell/finder.js', 'openFinder', L('note: Buy milk. Also eggs', 'ملاحظة: شراء الحليب. وأيضا البيض'));
  await page.waitForFunction((c) => [...document.querySelectorAll('#finder .fr .fr-title')].some((x) => x.textContent.trim() === c), { timeout: 5000 }, cmdNote).catch(() => {});
  ok((await texts('#finder .fr .fr-title')).includes(cmdNote), 'Finder offers "Save as a note" for note:');
  await shot(P + 'notes-08-finder-note');
  await clickText('#finder .fr', cmdNote);
  await sleep(400);
  const fn = (await notes())[0];
  ok(fn.title === L('Buy milk.', 'شراء الحليب.') && fn.body === L('Also eggs', 'وأيضا البيض'), 'note: saves the first sentence as title, the rest as body: ' + JSON.stringify([fn.title, fn.body]));
  ok(!(await exists('#finder.show')), 'Finder closes after saving');
  await mod('./js/shell/finder.js', 'openFinder', '<b>' + L('note: x', 'ملاحظة: س'));
  await sleep(300);
  ok(!(await texts('#finder .fr .fr-title')).includes(cmdNote), 'note: only matches at the start');
  await mod('./js/shell/finder.js', 'openFinder', L('Lisbon', 'لشبونة'));
  await page.waitForFunction((n) => [...document.querySelectorAll('#finder .fr .fr-title')].some((x) => x.textContent.trim() === n), { timeout: 5000 }, NAMES.n2).catch(() => {});
  ok((await texts('#finder .fr-head')).includes(await T('app.notes')) && (await texts('#finder .fr .fr-title')).includes(NAMES.n2), 'Finder search lists matching notes under Notes');
  await clickText('#finder .fr', NAMES.n2);
  await sleep(900);
  ok((await activeTitle()) === NAMES.n2, 'opening the Finder result opens that note');
  await closeApp();

  // ———————————————————————————————— empty states
  await setStorage({ notes: [] });
  await sleep(400);
  ok((await count('.wg-notes-empty')) === 2, 'both widgets show the empty state');
  await openApp('notes');
  ok((await exists('.notes-list .ou-empty')) && (await exists('.notes-placeholder')), 'empty list and editor placeholder');
  ok((await text('.notes-count')) === (await T('notes.count', { n: 0 })), 'count shows 0');
  await shot(P + 'notes-09-empty');
  await closeApp();

  // ═════════════════════════════════════════════════ part 2: Samsung Notes parity (U1)
  const LONG = 'A very long English title about the quarterly planning meeting with the whole design team';
  const D1 = 864e5, t0 = Date.now();
  await boot({
    data: {
      notes: [
        { id: 'p1', title: L('Groceries', 'البقالة'), body: `<div>${L('Buy bread #home', 'شراء خبز #home')}</div><ol><li>${L('first', 'أولا')}</li><li>${L('second', 'ثانيا')}</li></ol>`, color: 'none', pinned: false, created: t0 - 3 * D1, updated: t0 - 60e3 },
        { id: 'p2', title: LONG, body: `<div>${L('Plans #work', 'خطط #work')}</div>`, color: 'blue', pinned: false, created: t0 - 2 * D1, updated: t0 - 120e3 },
        { id: 'p3', title: L('Ideas', 'أفكار'), body: `<div>${L('Notes on #work and #home', 'ملاحظات عن #work و #home')}</div>`, color: 'none', pinned: false, created: t0 - D1, updated: t0 - 180e3 },
      ],
      notesBin: [
        { id: 'old', title: 'Old', body: '<div>gone</div>', color: 'none', created: t0 - 60 * D1, updated: t0 - 40 * D1, deletedAt: t0 - 31 * D1 },
        { id: 'b1', title: L('Deleted draft', 'مسودة محذوفة'), body: '<div>draft</div>', color: 'none', created: t0 - 9 * D1, updated: t0 - 5 * D1, deletedAt: t0 - 2 * D1 },
      ],
    },
  });
  await page.evaluate(() => {
    // downloads are caught here (name + content), so the export tests leave no files behind
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) return void window.__dl.push({ name: this.download, buf: fetch(this.href).then((r) => r.arrayBuffer()) });
      return orig.call(this);
    };
  });
  const dl = () => page.evaluate(async () => Promise.all(window.__dl.splice(0).map(async (d) => ({ name: d.name, text: new TextDecoder().decode(await d.buf) }))));
  const ed = (fn, ...args) => page.evaluate((fn, args) => document.querySelector('.notes-editor')._editor[fn](...args), fn, args);
  const bodyHtml = async (id) => (await notes()).find((n) => n.id === id)?.body || '';
  const menuPick = async (label) => { ok(await clickText('.ou-menu-item', label), 'menu item ' + label); await sleep(300); };
  const chooseOpt = async (label) => {
    const done = await page.evaluate((l) => { const r = [...document.querySelectorAll('.ou-radio-row')].find((x) => x.textContent.includes(l)); r?.click(); return !!r; }, label);
    ok(done, 'option ' + label);
    await page.click('.ou-dialog-btn.primary');
    await sleep(350);
  };
  const edMore = async () => { await click((await topBtn('common.more'))); await sleep(200); };

  // ———————————————————————————————— bugs: plain text, the long title
  ok((await mod('./js/apps/notes.js', 'noteText', '<ol><li>a</li><li>b</li></ol><ul><li>c</li></ul><ol start="3"><li>d</li></ol>')) === '1. a\n2. b\n• c\n3. d', 'plain text keeps numbered items numbered');
  ok((await mod('./js/apps/notes.js', 'noteText', '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table><hr><figure data-att="notes:x" data-k="img"></figure><div>z</div>')) === 'a | b\n---\nz', 'plain text: table rows, divider; pictures leave no text');
  await openApp('notes', { id: 'p2' });
  await sleep(300);
  const tl = await page.$eval('.note-title', (e) => ({ v: e.value, sw: e.scrollWidth, cw: e.clientWidth, sl: e.scrollLeft, h: e.offsetHeight, lh: parseFloat(getComputedStyle(e).lineHeight) }));
  ok(tl.v === LONG && tl.sw <= tl.cw + 1 && tl.sl === 0, 'a long English title shows from its start, nothing scrolled out: ' + JSON.stringify(tl));
  ok(tl.h > tl.lh * 1.5, 'the long title wraps onto more lines, like Samsung Notes');
  await shot(P + 'notes-10-long-title');
  ok(!(await bodyHtml('old')) && !(await store('notesBin')).some((n) => n.id === 'old') && (await store('notesBin')).some((n) => n.id === 'b1'), 'notes deleted over 30 days ago are purged when Notes opens; newer ones stay');

  // ———————————————————————————————— the drawer, folders
  await click('.notes-menu-btn');
  await sleep(350);
  ok(await visible('.notes-dw'), '≡ opens the navigation drawer');
  const dwLabels = await texts('.notes-dw-item .notes-dw-label');
  ok(dwLabels[0] === (await T('notes.all')) && dwLabels[1] === (await T('notes.favs')) && dwLabels[2] === (await T('notes.bin')), 'All notes, Favourites, Recently deleted');
  ok((await text('.notes-dw-item[data-view="all"] .notes-dw-count')) === '3' && (await text('.notes-dw-item[data-view="bin"] .notes-dw-count')) === '1', 'with their counts');
  ok(JSON.stringify(await texts('.notes-dw-item[data-view^="tag:"] .notes-dw-label')) === '["home","work"]' && (await text('.notes-dw-item[data-view="tag:work"] .notes-dw-count')) === '2', 'Tags lists #home and #work with counts');
  ok((await outside('.notes-dw')).length === 0, 'drawer inside the window');
  await shot(P + 'notes-11-drawer');
  await click('.notes-dw-add');
  await sleep(300);
  const FOLDER = L('Work', 'العمل');
  await page.type('.notes-fdlg .ou-input', FOLDER);
  await page.click('.notes-fcolor:nth-child(3)');
  await shot(P + 'notes-12-new-folder');
  await page.click('.ou-dialog-btn.primary');
  await sleep(500);
  let folders = await store('noteFolders');
  ok(folders?.length === 1 && folders[0].name === FOLDER && /^#/.test(folders[0].color), 'Create folder saves a name and colour in noteFolders');
  ok((await text('.notes-page .app-toolbar-title')) === FOLDER && (await count('.note-card')) === 0, 'the new folder opens (empty)');
  await click('.notes-fab');
  await sleep(300);
  await page.keyboard.type(L('In the folder', 'داخل المجلد'));
  await sleep(700);
  ok((await notes())[0].folder === folders[0].id, 'a note written in a folder belongs to it');
  // move another note there from its card menu
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="all"]'); await sleep(400);
  ok((await count('.note-card')) === 4, 'All notes lists every note');
  await rightClickCard(L('Ideas', 'أفكار'));
  await sleep(250);
  await menuPick(await T('notes.move'));
  await chooseOpt(FOLDER);
  ok((await byId('p3')).folder === folders[0].id, 'Move to folder from the card menu');
  ok(await page.evaluate((t) => [...document.querySelectorAll('.note-card')].find((c) => c.querySelector('.note-card-title').textContent === t)?.querySelector('.note-card-folder')?.textContent, L('Ideas', 'أفكار')) === FOLDER, 'its card shows the folder');
  // favourites
  await rightClickCard(L('Groceries', 'البقالة'));
  await sleep(250);
  await menuPick(await T('notes.fav'));
  ok((await byId('p1')).fav === true, 'Add to Favourites');
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="fav"]'); await sleep(400);
  ok(JSON.stringify(await cardTitles()) === JSON.stringify([L('Groceries', 'البقالة')]), 'Favourites lists only it');
  // tags
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="tag:work"]'); await sleep(400);
  ok((await text('.notes-page .app-toolbar-title')) === '\u2068#work\u2069' && (await count('.note-card')) === 2, 'a tag lists the notes written with it');
  ok((await texts('.note-info .note-tag')).includes('#work'), 'the open note shows its tags');
  ok((await page.evaluate(() => CSS.highlights.get('nt-tag')?.size || 0)) >= 1, '#tags are coloured in the text');
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="all"]'); await sleep(400);

  // ———————————————————————————————— selection mode, Recently deleted
  await click(more); await sleep(200);
  await menuPick(await T('notes.edit'));
  ok(await exists('.notes-side.selecting .notes-selbar') && (await count('.note-card .notes-check')) === 4, 'Edit starts selecting (check circles)');
  await page.evaluate(() => [...document.querySelectorAll('.note-card')].slice(0, 2).forEach((c) => c.click()));
  await sleep(200);
  ok((await text('.notes-selcount')) === (await T('notes.selected', { n: 2 })), '2 selected');
  await shot(P + 'notes-13-select');
  const two = await page.evaluate(() => [...document.querySelectorAll('.note-card.picked')].map((c) => c.dataset.id));
  await page.click('.notes-selact.danger');
  await sleep(400);
  let binList = await store('notesBin');
  ok(two.length === 2 && two.every((id) => binList.some((n) => n.id === id && n.deletedAt > t0)) && !(await notes()).some((n) => two.includes(n.id)), 'Delete moves both to Recently deleted (notesBin, with the time)');
  ok((await text('.ou-toast span')) === (await T('notes.deletedN', { n: 2 })), 'toast: 2 notes moved');
  await click('.ou-toast-action');
  await sleep(400);
  ok((await notes()).filter((n) => two.includes(n.id)).length === 2 && !(await store('notesBin')).some((n) => two.includes(n.id)), 'Undo brings both back');
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="bin"]'); await sleep(400);
  ok((await count('.note-card')) === 1 && (await exists('.notes-binnote')) && !(await visible('.notes-fab')), 'Recently deleted: the note, a 30-day hint, no new-note button');
  ok((await text('.note-card .note-card-meta')).includes(await T('notes.days', { n: 28 })), 'cards say how many days are left');
  await clickCard(L('Deleted draft', 'مسودة محذوفة'));
  ok((await page.$eval('.note-body', (e) => e.getAttribute('contenteditable'))) === 'false' && (await exists('.note-restore')), 'a deleted note opens read-only with Restore');
  ok(!(await page.$eval('.notes-editor', (e) => [...e.childNodes].some((n) => n.nodeType === 3))) && !(await exists('.notes-editor .note-tools')), 'no text toolbar (and no stray text) in a read-only note');
  await shot(P + 'notes-14-bin');
  await click('.note-restore');
  await sleep(400);
  ok((await byId('b1')) && !(await store('notesBin')).some((n) => n.id === 'b1'), 'Restore puts it back in the notes');
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="all"]'); await sleep(400);
  await rightClickCard(L('Deleted draft', 'مسودة محذوفة'));
  await sleep(250);
  await click('.ou-menu .ou-menu-item.danger');
  await sleep(300);
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="bin"]'); await sleep(400);
  await rightClickCard(L('Deleted draft', 'مسودة محذوفة'));
  await sleep(250);
  await click('.ou-menu .ou-menu-item.danger');
  await sleep(300);
  await page.click('.ou-dialog-btn.danger');
  await sleep(400);
  ok(!(await store('notesBin')).some((n) => n.id === 'b1') && !(await byId('b1')), 'Delete forever (after asking)');
  await click('.notes-menu-btn'); await sleep(300);
  await click('.notes-dw-item[data-view="all"]'); await sleep(400);

  // ———————————————————————————————— the editor's tools on a new note
  await click('.notes-fab');
  await sleep(300);
  const nid2 = (await notes())[0].id;
  await page.keyboard.type(L('Tools', 'أدوات'));
  await page.keyboard.press('Enter');
  await page.keyboard.type(L('Heading line', 'سطر العنوان'));
  await click('.note-fmt[data-cmd="style"]');
  await sleep(300);
  ok(await visible('.nt-ts-pop'), 'Text style opens its panel');
  ok((await outside('.nt-ts-pop')).length === 0, 'inside the screen');
  ok((await count('.nt-ts-pop .nt-sw')) === 8 + 6 && (await count('.nt-ts-pop [data-fs]')) === 6, 'text colours, highlights and six sizes');
  await shot(P + 'notes-15-textstyle');
  await page.click('.nt-ts-pop [data-para="title"]');
  await sleep(150);
  ok(await exists('.nt-ts-pop [data-para="title"].on'), 'Title is marked as the paragraph style');
  await page.click('.nt-ts-pop [data-al="center"]');
  await page.keyboard.press('Escape');
  await sleep(200);
  ok(!(await exists('.nt-ts-pop')), 'Escape closes the panel (not the window)');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  // colour, highlight and size apply to what's typed next
  await click('.note-fmt[data-cmd="style"]'); await sleep(250);
  await page.click('.nt-ts-pop .nt-sw[data-v="red"]'); await sleep(100);
  await page.click('.nt-ts-pop .nt-sw.hl[data-v="yellow"]'); await sleep(100);
  await page.click('.nt-ts-pop [data-fs="24"]'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(150);
  await page.keyboard.type(L('Red big', 'أحمر كبير'));
  await sleep(800);
  let hb = await bodyHtml(nid2);
  ok(/<h1[^>]*data-al="center"[^>]*>/.test(hb) && hb.includes(L('Heading line', 'سطر العنوان')), 'Title paragraph, centred: ' + hb.slice(0, 80));
  ok(/data-tc="red"/.test(hb) && /<mark data-hl="yellow">/.test(hb) && /data-fs="24"/.test(hb) && hb.includes(L('Red big', 'أحمر كبير')), 'text colour, highlight and size are saved as marks');
  ok(!/<font|style=/.test(hb), 'no <font> or inline styles left');
  // auto lists
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] ');
  await page.keyboard.type(L('auto task', 'مهمة تلقائية'));
  await sleep(150);
  ok(await exists('.note-body ul.checklist li'), '"[] " at the start of a line starts a checklist');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('1. ');
  await page.keyboard.type('x');
  ok(await exists('.note-body ol li'), '"1. " starts a numbered list');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  // table
  await click('.note-fmt[data-cmd="table"]');
  await sleep(300);
  ok(await exists('.nt-table-dlg'), 'the table button asks for rows and columns');
  await page.click('.nt-step:nth-child(2) .ou-icon-btn:last-of-type');
  await page.click('.ou-dialog-btn.primary');
  await sleep(400);
  ok((await count('.note-body table tr')) === 3 && (await count('.note-body table tr:first-child td')) === 4, 'a 3 × 4 table');
  await page.keyboard.type('A1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('B1');
  await sleep(700);
  hb = await bodyHtml(nid2);
  ok(/<table><tbody><tr><td>A1<\/td><td>B1<\/td>/.test(hb), 'Tab moves to the next cell; the table is saved');
  ok(await exists('.note-fmt[data-cmd="table"].on'), 'the table button is on inside a table');
  const cellPos = await page.$eval('.note-body table tr:first-child td', (td) => { const r = td.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(cellPos.x, cellPos.y, { button: 'right' });
  await sleep(300);
  await menuPick(await T('notes.rowBelow'));
  ok((await count('.note-body table tr')) === 4, 'right-click › Add row below');
  await click((await topBtn('common.undo')));
  await sleep(300);
  ok((await count('.note-body table tr')) === 3, 'Undo removes the row');
  await click((await topBtn('notes.redo')));
  await sleep(300);
  ok((await count('.note-body table tr')) === 4, 'Redo adds it again');
  // divider, picture, drawing
  await page.evaluate(() => { const ed = document.querySelector('.note-body'); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); ed.focus(); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await click('.note-fmt[data-cmd="insert"]');
  await sleep(250);
  ok((await count('.ou-menu .ou-menu-item')) === 5, 'Insert: image, drawing, voice recording, table, divider');
  await menuPick(await T('notes.divider'));
  ok(await exists('.note-body hr'), 'a divider line');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#3e8bff'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(160, 100, 60, 0, 7); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await document.querySelector('.notes-editor')._editor.addPictures([new File([blob], 'sun.png', { type: 'image/png' })]);
  });
  await sleep(700);
  ok(await page.$eval('.note-body figure[data-k="img"] img', (i) => i.complete && i.naturalWidth > 0), 'a picture shows in the note');
  hb = await bodyHtml(nid2);
  const att = /data-att="(notes:[\w-]+)"/.exec(hb)?.[1];
  ok(att && /<figure data-att="notes:[\w-]+" data-k="img"><\/figure>/.test(hb), 'stored as an empty figure pointing at IndexedDB');
  ok((await mod('./js/core/blobs.js', 'listBlobs', 'notes:')).includes(att), 'the picture is in IndexedDB (' + att + ')');
  ok(await exists('.note-card.active .note-card-thumb img'), 'the card shows the picture');
  await click('.note-fmt[data-cmd="insert"]');
  await sleep(250);
  await menuPick(await T('notes.drawing'));
  await sleep(500);
  ok(await visible('.nt-sk-canvas'), 'Drawing opens the drawing sheet');
  ok((await count('.nt-sk-bar .nt-sk-tool')) >= 6 && (await count('.nt-sk-cols .nt-sk-col')) === 7, 'Samsung’s pen toolbar: pen, highlighter, eraser, colours, undo, redo, erase all');
  await page.click('.nt-sk-tool[data-tool="pen"]');
  await sleep(150);
  ok(await visible('.nt-sk-settings') && (await count('.nt-sk-type')) === 4, 'tapping the pen again shows pen types and thickness');
  ok((await outside('.nt-sk-dlg .ou-dialog-btn')).length === 0 && (await outside('.nt-sk-dlg')).length === 0, 'the drawing sheet and its Cancel/Done fit on the screen');
  await page.click('.nt-sk-type[data-pen="cal"]');
  await page.click('.nt-sk-tool[data-tool="pen"]');
  await sleep(100);
  ok(!(await visible('.nt-sk-settings')), 'tapping the pen once more closes its settings');
  const cb = await (await page.$('.nt-sk-canvas')).boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cb.x + cb.width * (0.2 + i * 0.04), cb.y + cb.height * (0.3 + Math.sin(i / 2) * 0.15));
  await page.mouse.up();
  await sleep(150);
  ok(!(await page.$eval('.nt-sk-tool[data-tool="undo"]', (b) => b.disabled)), 'a stroke can be undone');
  await shot(P + 'notes-16-drawing');
  await page.click('.ou-dialog-btn.primary');
  await page.waitForSelector('.note-body figure[data-k="draw"] img[src]', { timeout: 8000 }).catch(() => {});
  await sleep(700);
  hb = await bodyHtml(nid2);
  const datt = /data-att="(notes:[\w-]+)" data-k="draw"/.exec(hb)?.[1];
  ok(datt, 'the drawing is in the note');
  const keys = await mod('./js/core/blobs.js', 'listBlobs', 'notes:');
  ok(keys.includes(datt) && keys.includes(datt + ':v'), 'its picture and its strokes are stored');
  await page.click(`.note-body figure[data-att="${datt}"]`);
  await sleep(600);
  ok(await visible('.nt-sk-canvas') && !(await page.$eval('.nt-sk-tool[data-tool="clear"]', (b) => b.disabled)), 'tapping a drawing opens it again with its strokes');
  await page.click('.ou-dialog-btn:not(.primary)');
  await sleep(400);
  // a voice recording (one second of a generated WAV: headless Chrome has no microphone)
  await page.evaluate(async () => {
    const sr = 8000, n = sr, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const { putBlob } = await import('./js/core/blobs.js');
    await putBlob('notes:voicetest', new Blob([b], { type: 'audio/wav' }));
    const ed = document.querySelector('.note-body');
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); ed.focus(); getSelection().removeAllRanges(); getSelection().addRange(r);
    document.querySelector('.notes-editor')._editor.insertFigure('notes:voicetest', 'voice');
  });
  await sleep(900);
  ok(await exists('.note-body figure[data-k="voice"] .nt-voice-play'), 'a voice recording shows as a player in the note');
  ok((await page.$eval('.note-body .nt-voice-time', (e) => e.getAttribute('data-time'))) === '0:01', 'with its length (0:01)');
  ok(/<figure data-att="notes:voicetest" data-k="voice"><\/figure>/.test(await bodyHtml(nid2)), 'saved as a voice figure');
  await page.evaluate(() => document.querySelector('.note-scroll').scrollTo(0, 0));
  await shot(P + 'notes-17-tools');

  // ———————————————————————————————— page template, export
  await edMore();
  await menuPick(await T('notes.pageTemplate'));
  await chooseOpt(await T('notes.paper.lined'));
  ok((await byId(nid2)).paper === 'lined' && (await exists('.note-body[data-paper="lined"]')), 'Page template › Lined');
  await edMore();
  await menuPick(await T('notes.export'));
  ok((await count('.ou-radio-row')) === 3, 'Save as file: PDF, Markdown, Text');
  await chooseOpt(await T('notes.fileMd'));
  await sleep(500);
  let files = await dl();
  ok(files.length === 1 && files[0].name === L('Tools', 'أدوات') + '.md' && files[0].text.startsWith('# ' + L('Tools', 'أدوات')) && files[0].text.includes('| A1 | B1 |') && files[0].text.includes('- [ ] ' + L('auto task', 'مهمة تلقائية')), 'Markdown file: title, table, checklist');
  await edMore();
  await menuPick(await T('notes.export'));
  await chooseOpt(await T('notes.fileTxt'));
  await sleep(400);
  files = await dl();
  ok(files[0]?.name.endsWith('.txt') && files[0].text.includes('☐ ' + L('auto task', 'مهمة تلقائية')) && files[0].text.includes('1. x'), 'Text file with ☐ and numbered lines');
  await edMore();
  await menuPick(await T('notes.export'));
  await chooseOpt(await T('notes.filePdf'));
  await page.waitForFunction(() => window.__dl.length > 0, { timeout: 15000 }).catch(() => {});
  const pdf = await page.evaluate(async () => {
    const d = window.__dl.splice(0)[0];
    if (!d) return null;
    const b = await d.buf;
    const s = new TextDecoder('latin1').decode(b);
    return { name: d.name, head: s.slice(0, 8), pages: (s.match(/\/Type \/Page /g) || []).length, size: b.byteLength, eof: s.trimEnd().endsWith('%%EOF') };
  });
  ok(pdf && pdf.head === '%PDF-1.4' && pdf.pages >= 1 && pdf.eof && pdf.size > 5000 && pdf.name.endsWith('.pdf'), 'PDF file: ' + JSON.stringify(pdf));
  const long = await page.evaluate(() => import('./js/notes/export.js').then((m) => m.notePdf({ title: 'Long', updated: Date.now() }, Array.from({ length: 140 }, (_, i) => `<div>Line ${i + 1} of a long note</div>`).join(''))).then(async (b) => (new TextDecoder('latin1').decode(await b.arrayBuffer()).match(/\/Type \/Page /g) || []).length));
  ok(long >= 3, 'a long note becomes several A4 pages: ' + long);

  // ———————————————————————————————— templates
  await click(more); await sleep(200);
  await menuPick(await T('notes.fromTemplate'));
  await chooseOpt(await T('notes.tpl.todo'));
  const tpl = (await notes())[0];
  ok(tpl.title === (await T('notes.tpl.todo')) && tpl.paper === 'lined' && tpl.body.includes('class="checklist"'), 'New note from template: a to-do list on lined paper');

  // ———————————————————————————————— locked notes (the screen lock PIN)
  await clickCard(L('Groceries', 'البقالة'));
  await edMore();
  await menuPick(await T('notes.lockNote'));
  ok(await visible('.ou-dialog') && (await text('.ou-dialog-title')) === (await T('notes.needPinTitle')), 'without a screen PIN, Lock asks to set one first');
  await page.click('.ou-dialog-btn:not(.primary)');
  await sleep(300);
  await mod('./js/shell/pin.js', 'setPin', '246810');
  await edMore();
  await menuPick(await T('notes.lockNote'));
  await sleep(400);
  let p1 = await byId('p1');
  const vault = (await store('notesLocked')) || {};
  ok(p1.locked === true && p1.body === '' && vault.p1?.includes(L('Buy bread', 'شراء خبز')), 'Lock: the text moves out of `notes` into notesLocked');
  ok(await exists('.notes-editor .note-body') && (await page.$eval('.note-body', (e) => e.textContent)).includes(L('Buy bread', 'شراء خبز')), 'the note you locked stays open');
  ok((await text('.note-card.active .note-card-snippet')) === (await T('notes.locked')), 'its card says Locked note, no text');
  const found = await page.evaluate((q) => import('./js/core/apps.js').then((m) => m.getApp('notes').search(q).map((r) => r.title)), L('bread', 'خبز'));
  ok(found.length === 0, 'Finder can’t find a locked note by its text');
  await clickCard(L('Ideas', 'أفكار'));
  await clickCard(L('Groceries', 'البقالة'));
  ok(await exists('.notes-lockview .pin'), 'opened again, it asks for the PIN');
  await shot(P + 'notes-18-locked');
  for (const k of '111111') await page.keyboard.press(k);
  await sleep(600);
  ok(await exists('.notes-lockview .pin-sub.err'), 'a wrong PIN is refused');
  for (const k of '246810') await page.keyboard.press(k);
  await sleep(800);
  ok(await exists('.notes-editor .note-body') && (await page.$eval('.note-body', (e) => e.textContent)).includes(L('Buy bread', 'شراء خبز')), 'the right PIN opens it');
  await page.click('.note-body');
  await page.keyboard.press('End');
  await page.keyboard.type(' secret');
  await sleep(800);
  ok((await byId('p1')).body === '' && ((await store('notesLocked')) || {}).p1.includes('secret'), 'edits to a locked note are saved in the vault only');
  await edMore();
  await menuPick(await T('notes.unlockNote'));
  await sleep(400);
  p1 = await byId('p1');
  ok(!p1.locked && p1.body.includes('secret') && !((await store('notesLocked')) || {}).p1, 'Unlock brings the text back');
  await mod('./js/shell/pin.js', 'removePin');
  await closeApp();

  // ———————————————————————————————— a narrow window (split screen, a small pop-up)
  await page.setViewport({ width: 600, height: 860 });
  await sleep(300);
  await openApp('notes');
  await sleep(300);
  ok(await exists('.notes.narrow') && (await visible('.notes-side')) && !(await visible('.notes-editor')), 'narrow window: the list alone');
  await shot(P + 'notes-19-narrow-list');
  await clickCard(LONG);
  ok((await visible('.notes-editor')) && !(await visible('.notes-side')) && (await visible('.note-back')), 'a note opens over the list with a back button');
  await shot(P + 'notes-20-narrow-note');
  await click('.note-back');
  ok(await visible('.notes-side'), 'back shows the list');
  await closeApp();
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(300);
};
