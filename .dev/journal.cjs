// triple
// Journal end-to-end: seeds entries, journals, Calendar events, finished reminders, Focus sessions and a note, then
// drives the real app: the entries list (large title, counts, month groups, journal chips, the 30-day purge),
// journaling suggestions (strip, See all, Recommended/Recent, start an entry from a moment), the editor (title, text,
// auto list, bold, mood sheet, tag, location, a picture through the file chooser, a drawing, autosave, empty entries
// dropped), card menu (bookmark, delete to the Recycle bin, restore), search and #tags, the Calendar and Insights tabs,
// settings (suggestions off, journaling schedule alarm), Lock Journal (set a PIN on the One UI keypad, PBKDF2 record,
// lock, wrong PIN, unlock with the keyboard, hidden from Finder and widgets), the service worker reminder, the
// "journal:" Finder command, both widgets, the Lock screen chip and Markdown export, with screenshots.
// usage: .dev/run.sh .dev/journal.cjs   (THEME=dark / UI=ar for the other variants)
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');

// a small gradient PNG for the picture test
function makePng(w, h) {
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let x = 0xffffffff; for (const b of buf) x = crcT[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 250 - x; raw[i + 1] = 120 + y; raw[i + 2] = 90 + x; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, visible, waitFor, mod, getStorage, setStorage, sleep, shot, P, ui, sw }) => {
  const AR = ui === 'ar', L = (en, ar) => (AR ? ar : en);
  const DAY = 864e5, now = Date.now();
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const t0 = +sod;
  // a moment earlier today (a fraction of the time since midnight), so it is never in the future
  const early = (k) => t0 + Math.floor((now - t0) * k);
  const at = (o, hh = 9, mm = 0) => { const d = new Date(); d.setDate(d.getDate() + o); d.setHours(hh, mm, 0, 0); return +d; };
  const dk = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });
  const journal = {
    journals: [{ id: 'journal', name: '', color: '#7b61ff' }, { id: 'jw', name: L('Work', 'العمل'), color: '#3e7bff' }],
    entries: [
      { id: 'e1', created: early(0.5), at: early(0.5), title: L('Morning pages', 'صفحات الصباح'), text: L('Slept well and went for a run by the river.', 'نمت جيدًا وخرجت للركض بجانب النهر.'), bookmark: true, mood: { level: 5, feelings: ['happy'] }, tags: ['running'], place: L('Riverside', 'ضفة النهر') },
      { id: 'e2', created: at(-1, 21, 30), at: at(-1, 21, 30), text: L('Dinner with Sam and Lea. We talked about the trip to Lisbon.', 'عشاء مع سامي وليلى. تحدثنا عن الرحلة إلى لشبونة.'), journal: 'jw', moment: { kind: 'event', at: at(-1, 19), title: L('Dinner with Sam', 'عشاء مع سامي'), sub: '19:00 – 21:00', color: '#ff8a3d' }, tags: ['travel'] },
      { id: 'e3', created: at(-2, 20), at: at(-2, 20), title: L('Grateful', 'ممتن'), text: L('Coffee, a long call with Mom, finishing the report.', 'القهوة، مكالمة طويلة مع أمي، إنهاء التقرير.'), prompt: 'p9', mood: { level: 4 } },
      { id: 'e4', created: at(-40, 22), at: at(-40, 22), title: L('Old thoughts', 'أفكار قديمة'), text: L('A quiet weekend.', 'عطلة نهاية أسبوع هادئة.') },
      { id: 'e5', created: at(-50), at: at(-50), text: L('Deleted long ago', 'حُذف منذ زمن'), deletedAt: now - 31 * DAY },
      { id: 'e6', created: at(-5), at: at(-5), text: L('Deleted recently', 'حُذف مؤخرًا'), deletedAt: now - 2 * DAY },
    ],
    prefs: {},
  };
  const data = {
    journal,
    events: [
      { id: 'ev1', title: L('Yoga class', 'حصة يوغا'), start: early(0.2), end: early(0.3), allDay: false, color: '#14b8a6', place: L('Studio 4', 'الاستوديو 4') },
      { id: 'ev2', title: L('Team offsite', 'لقاء الفريق خارج المكتب'), start: at(-1, 10), end: at(-1, 16), allDay: false, color: '#3e7bff' },
    ],
    reminders: [
      { id: 'r1', title: L('Water the plants', 'سقي النباتات'), done: true, completedAt: early(0.6), created: at(-3) },
      { id: 'r2', title: L('Call the dentist', 'الاتصال بطبيب الأسنان'), done: true, completedAt: early(0.7), created: at(-3) },
      { id: 'r3', title: L('Pay rent', 'دفع الإيجار'), done: false, created: at(-3) },
    ],
    focusLog: [{ start: at(-2, 10), end: at(-2, 10, 50) }],
    notes: [{ id: 'n1', title: '', body: `<div>${L('Ideas for the garden', 'أفكار للحديقة')}</div><div>${L('Tomatoes, basil', 'طماطم، ريحان')}</div>`, created: at(-1, 12), updated: at(-1, 12) }],
    home: [[W('w-j', 'journal', 'm'), W('w-r', 'journal-recent', 'm'), W('w-js', 'journal', 's'), W('w-rs', 'journal-recent', 's')]],
    dock: [],
  };
  const J = async () => (await getStorage('journal')).journal;
  const byId = async (id) => (await J()).entries.find((e) => e.id === id);
  const top = '.app-page:last-child';
  const back = async () => { await page.click(`${top} .app-back`); await sleep(500); };
  const menuItem = async (label) => { const done = await clickText('.ou-menu-item', label); await sleep(250); return done; };
  const tt = (key, vars) => page.evaluate((k, v) => import('./js/core/i18n.js').then((m) => m.t(k, v)), key, vars);
  // downloads are recorded instead of saved
  const stub = () => page.evaluate(() => {
    window.__dl = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) return void window.__dl.push(this.download); return click.call(this); };
    const co = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return co(b); };
  });

  await boot({ data, settings: { lockWidgets: ['journal'] } });
  await stub();

  // ---------------------------------------------------------------- widgets on the Home screen
  await sleep(600);
  const wj = '#home .widget-tile[data-id="w-j"] .wg', wr = '#home .widget-tile[data-id="w-r"] .wg';
  ok(await exists(wj + ' .jrw-q') && (await text(wj + ' .jrw-num b')) === '3', 'Journal widget (m): reflection prompt and a 3-day streak');
  ok((await count(wj + ' .jrw-dot.on')) === 3, 'Journal widget: this week shows 3 days written');
  ok((await text(wr + ' .jrw-title')) === L('Morning pages', 'صفحات الصباح'), 'Journal entry widget shows the latest entry');
  await shot(P + 'jr-00-widgets');

  // ---------------------------------------------------------------- the entries list
  await openApp('journal');
  await waitFor('.jr-entries-page .jr-card');
  ok((await text('.jr-entries-page .app-hero-title')) === L('Journal', 'اليوميات'), 'large "Journal" title');
  const sub = await text('.jr-entries-page .app-hero-sub');
  ok(sub.includes('4') && sub.includes('3'), 'subtitle: 4 entries and a 3-day streak: ' + sub);
  ok((await count('.jr-entries-page .jr-card')) === 4, 'the 4 live entries are listed');
  ok((await count('.jr-entries-page .jr-month')) >= 2, 'grouped by month');
  ok(!(await J()).entries.some((e) => e.id === 'e5') && (await J()).entries.some((e) => e.id === 'e6'), 'entries deleted over 30 days ago are purged, newer ones stay in the bin');
  ok((await count('.jr-entries-page .jr-fchip')) === 4, 'chips: All, Bookmarked and 2 journals');
  ok(await exists('.jr-entries-page .jr-card[data-id="e1"] .jr-card-mood .jr-face') && await exists('.jr-entries-page .jr-card[data-id="e2"] .jr-mo'), 'cards show the mood face and the moment');
  ok(await exists('.jr-sugg .jr-sg-prompt') && (await texts('.jr-sugg .jr-sg-mo b')).some((x) => x.includes(L('Yoga class', 'حصة يوغا'))), 'suggestion strip: a reflection prompt and today’s event');
  await shot(P + 'jr-01-entries');

  // journal chips
  await click('.jr-entries-page .jr-fchip[data-filter="j:jw"]'); await sleep(250);
  ok((await count('.jr-entries-page .jr-card')) === 1 && !(await exists('.jr-sugg')), 'Work chip: its one entry, no suggestions');
  await click('.jr-entries-page .jr-fchip[data-filter="bookmarked"]'); await sleep(250);
  ok((await count('.jr-entries-page .jr-card')) === 1 && await exists('.jr-card[data-id="e1"]'), 'Bookmarked chip');
  await click('.jr-entries-page .jr-fchip[data-filter="all"]'); await sleep(250);

  // ---------------------------------------------------------------- suggestions: See all
  await click('.jr-seeall'); await sleep(500);
  ok(await exists(`${top} .jr-sgpage .jr-sg-prompt`), 'See all: Journaling suggestions page');
  await clickText(`${top} .ou-seg-btn`, L('Recent', 'الأخيرة')); await sleep(250);
  const recent = await texts(`${top} .jr-sgpage .jr-sg-mo b`);
  console.log('recent', recent.join(' | '));
  ok(recent.some((x) => x.includes(L('Team offsite', 'لقاء الفريق'))), 'Recent: yesterday’s event');
  ok(recent.some((x) => x === L('2 reminders completed', 'اكتمل تذكيران')), 'finished reminders become one moment');
  ok(recent.some((x) => x === L('50 min of Focus', '50 د من التركيز')), 'Focus sessions become a moment (50 min)');
  ok(recent.some((x) => x === L('Ideas for the garden', 'أفكار للحديقة')), 'a note written this week is a moment');
  ok(!recent.some((x) => x.includes(L('Pay rent', 'دفع الإيجار'))), 'unfinished reminders are not');
  await shot(P + 'jr-02-suggestions');
  await page.evaluate((t) => [...document.querySelectorAll('.app-page:last-child .jr-sg-mo')].find((b) => b.textContent.includes(t)).click(), L('Team offsite', 'لقاء الفريق')); await sleep(900);
  ok(await exists('.jr-edit-page .jr-ed-mo') && (await text('.jr-edit-page .jr-ed-mo b')).includes(L('Team offsite', 'لقاء الفريق')), 'a moment starts an entry with its card');
  await page.click('.jr-edit-page .jr-ed-text');
  await page.keyboard.type(L('We planned the next quarter.', 'خططنا للربع القادم.'));
  await sleep(600);
  await back();
  let all = (await J()).entries;
  const fromMoment = all.find((e) => e.moment?.kind === 'event' && e.text.includes(L('next quarter', 'للربع')));
  ok(fromMoment && fromMoment.moment.title.includes(L('Team offsite', 'لقاء الفريق')), 'saved with the moment (storage)');

  // ---------------------------------------------------------------- the editor
  await click('.jr-entries-page .jr-fab'); await sleep(700);
  ok(await exists('.jr-edit-page .jr-ed-bar .jr-tool[data-tool="photo"]'), 'FAB opens the editor with its toolbar');
  await page.click('.jr-edit-page .jr-ed-title');
  await page.keyboard.type(L('Lisbon trip', 'رحلة لشبونة'));
  await page.keyboard.press('Enter');
  await page.keyboard.type(L('Pastel de nata by the river. ', 'حلوى بجانب النهر. '));
  await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await page.keyboard.type(L('Best day', 'أفضل يوم'));
  await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- ');
  await page.keyboard.type(L('tram 28', 'الترام 28'));
  await sleep(200);
  ok(await exists('.jr-edit-page .jr-ed-text ul li') && await exists('.jr-edit-page .jr-ed-text b'), '"- " starts a bulleted list; Ctrl+B bold');
  ok(/\d/.test(await text('.jr-edit-page .jr-ed-foot')), 'word count under the text: ' + (await text('.jr-edit-page .jr-ed-foot')));
  // mood
  await click('.jr-edit-page .jr-tool[data-tool="mood"]'); await sleep(400);
  ok((await count('.jr-mood-btn')) === 5, 'mood sheet: five Samsung Health faces');
  await click('.jr-mood-btn[data-level="5"]'); await sleep(200);
  await page.evaluate(() => document.querySelector('.jr-mood-chips .ou-chip').click());
  await shot(P + 'jr-03-mood');
  await click('.ou-dialog .ou-dialog-btn.primary'); await sleep(400);
  ok(await exists('.jr-edit-page .jr-ed-mood') && await exists('.jr-edit-page .jr-ed-moodbtn .jr-face'), 'mood card in the entry and a face in the toolbar');
  // tag and location
  await click('.jr-edit-page .jr-tool[data-tool="tag"]'); await sleep(300);
  await page.keyboard.type('#Travel');
  await click('.ou-dialog .ou-dialog-btn.primary'); await sleep(300);
  await click('.jr-edit-page .jr-tool[data-tool="place"]'); await sleep(300);
  await page.keyboard.type(L('Lisbon', 'لشبونة'));
  await click('.ou-dialog .ou-dialog-btn.primary'); await sleep(300);
  ok((await count('.jr-edit-page .jr-ed-extra .jr-chip')) === 2, 'location and tag chips');
  // a picture through the file chooser
  const png = path.join(os.tmpdir(), 'jr-test-photo.png');
  fs.writeFileSync(png, makePng(80, 60));
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('.jr-edit-page .jr-tool[data-tool="photo"]')]);
  await chooser.accept([png]); await sleep(1200);
  ok((await count('.jr-edit-page .jr-ed-ph')) === 1, 'picture added to the strip');
  // a drawing
  await click('.jr-edit-page .jr-tool[data-tool="draw"]'); await sleep(500);
  const cv = await (await page.$('.jr-draw-canvas')).boundingBox();
  await page.mouse.move(cv.x + 40, cv.y + 40); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cv.x + 40 + i * 18, cv.y + 40 + Math.sin(i / 2) * 40);
  await page.mouse.up();
  await click('.jr-draw-color:nth-child(2)');
  await page.mouse.move(cv.x + 60, cv.y + 160); await page.mouse.down(); await page.mouse.move(cv.x + 260, cv.y + 120); await page.mouse.up();
  await shot(P + 'jr-04-drawing');
  await click('.ou-dialog .ou-dialog-btn.primary');
  await page.waitForFunction(() => document.querySelectorAll('.jr-edit-page .jr-ed-ph').length === 2, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  ok((await count('.jr-edit-page .jr-ed-ph')) === 2 && await exists('.jr-edit-page .jr-ed-ph.draw'), 'drawing added next to the picture');
  await page.evaluate(() => document.querySelector('.app-page:last-child .app-scroll').scrollTop = 0);
  await shot(P + 'jr-05-editor');
  await page.click('.jr-edit-page .jr-ed-bm'); await sleep(600);
  await back();
  all = (await J()).entries;
  const lis = all.find((e) => e.title === L('Lisbon trip', 'رحلة لشبونة'));
  ok(lis && /<ul><li>/.test(lis.html) && /<b>/.test(lis.html) && lis.text.includes('• '), 'saved title, rich text (bold, list) and its plain mirror');
  ok(lis && lis.mood?.level === 5 && lis.mood.feelings?.length === 1 && lis.tags?.[0] === 'Travel' && lis.place === L('Lisbon', 'لشبونة') && lis.bookmark === true, 'saved mood, feeling, tag, location and bookmark');
  ok(lis && lis.media?.length === 2 && lis.media[0].k === 'photo' && lis.media[1].k === 'draw' && lis.media[1].vec && lis.media.every((m) => m.id.startsWith('journal:')), 'saved picture and drawing ids (journal:…)');
  const blobs = await mod('./js/core/blobs.js', 'listBlobs', 'journal:');
  ok(lis && [lis.media[0].id, lis.media[1].id, lis.media[1].vec].every((id) => blobs.includes(id)), 'pictures, drawing and strokes are in IndexedDB');
  ok(lis && await exists(`.jr-entries-page .jr-card[data-id="${lis.id}"] .jr-strip .jr-ph`), 'the card shows the photo strip');
  // empty entries are dropped
  const n0 = (await J()).entries.length;
  await click('.jr-entries-page .jr-fab'); await sleep(600);
  await back();
  ok((await J()).entries.length === n0, 'an entry left empty is not kept');

  // ---------------------------------------------------------------- search and #tags
  await click('.jr-entries-page .app-toolbar-actions .ou-icon-btn:first-child'); await sleep(250);
  await page.keyboard.type(L('lisbon', 'لشبونة'));
  await sleep(300);
  ok((await count('.jr-entries-page .jr-card')) === 2 && await exists('.jr-results'), 'search finds the text in two entries');
  await page.$eval('.jr-search input', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.focus('.jr-search input'); await page.keyboard.type('#trav'); await sleep(300);
  ok((await count('.jr-entries-page .jr-card')) === 2, '#tag search: ' + (await page.$eval('.jr-search input', (i) => i.value)) + ' → ' + (await count('.jr-entries-page .jr-card')));
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await exists('.jr-search')) && (await count('.jr-entries-page .jr-card')) === 6, 'Escape closes search');

  // ---------------------------------------------------------------- card menu: bookmark, delete, Recycle bin
  await page.click('.jr-entries-page .jr-card[data-id="e3"]', { button: 'right' }); await sleep(300);
  await menuItem(L('Add bookmark', 'إضافة إشارة مرجعية'));
  ok((await byId('e3')).bookmark === true, 'bookmark from the card menu (storage)');
  await page.click('.jr-entries-page .jr-card[data-id="e4"]', { button: 'right' }); await sleep(300);
  await menuItem(L('Delete', 'حذف'));
  await click('.ou-dialog .ou-dialog-btn.danger'); await sleep(400);
  ok((await byId('e4')).deletedAt > 0 && !(await exists('.jr-entries-page .jr-card[data-id="e4"]')), 'delete moves the entry to the Recycle bin');
  await click('.jr-entries-page .app-toolbar-actions .ou-icon-btn:last-child'); await sleep(300);
  await menuItem(L('Recycle bin', 'سلة المحذوفات')); await sleep(500);
  ok((await count(`${top} .jr-card.deleted`)) === 2 && (await text(`${top} .jr-card[data-id="e6"] .jr-card-left`)) === L('28 days left', 'يتبقى 28 يومًا'), 'Recycle bin: 2 entries with the days left');
  await shot(P + 'jr-06-bin');
  await page.click(`${top} .jr-card[data-id="e4"]`); await sleep(300);
  await menuItem(L('Restore', 'استعادة'));
  ok(!(await byId('e4')).deletedAt, 'restore from the Recycle bin');
  await page.click(`${top} .jr-card[data-id="e6"]`); await sleep(300);
  await menuItem(L('Delete permanently', 'حذف نهائي'));
  await click('.ou-dialog .ou-dialog-btn.danger'); await sleep(400);
  ok(!(await byId('e6')), 'delete permanently');
  await back();

  // ---------------------------------------------------------------- Calendar tab
  await click('.jr-tabs [data-tab="calendar"]'); await sleep(500);
  ok(await exists('.jr-cal-page .jr-cal-grid') && (await count('.jr-cal-page .jr-cal-d.has')) >= 2, 'Calendar tab: days with entries are marked');
  ok(await exists(`.jr-cal-page .jr-cal-d[data-day="${dk(now)}"].mood`), 'today is coloured by its mood');
  await page.waitForFunction(() => document.querySelector('.jr-cal-page .jr-cal-d.photo .jr-cal-img[src]'), { timeout: 4000 }).catch(() => {});
  ok(await exists('.jr-cal-page .jr-cal-d.photo .jr-cal-img[src]'), 'a day with a picture shows it');
  const yday = dk(at(-1, 12));
  if (await exists(`.jr-cal-page .jr-cal-d[data-day="${yday}"]`)) {
    await click(`.jr-cal-page .jr-cal-d[data-day="${yday}"]`); await sleep(300);
    ok((await count('.jr-cal-page .jr-cards .jr-card')) === 1 && await exists('.jr-cal-page .jr-card[data-id="e2"]'), 'choosing a day lists its entries');
  }
  await shot(P + 'jr-07-calendar');

  // ---------------------------------------------------------------- Insights tab
  await click('.jr-tabs [data-tab="insights"]'); await sleep(500);
  ok((await text('.jr-ic-streak .jr-ic-big b')) === '3', 'Insights: 3-day streak');
  ok((await count('.jr-ic-streak .jr-wd.on')) >= 1, 'this week’s days');
  const stats = await texts('.jr-stat b');
  ok(stats.length === 3 && +stats[0] >= 3 && +stats[1] > 20, 'entries, words and days this year: ' + stats.join(', '));
  ok((await count('.jr-heat-cell')) >= 365 && (await count('.jr-heat-grid .jr-heat-cell:not(.l0)')) >= 3, 'the year heat-map with the journaled days');
  ok((await count('.jr-moodbar')) === 5 && await exists('.jr-ic-tags .jr-chip'), 'mood bars and tags');
  await shot(P + 'jr-08-insights');
  await page.evaluate(() => document.querySelector('.jr-ins-page .app-scroll').scrollTop = 600); await sleep(200);
  await shot(P + 'jr-09-insights-more');
  await click('.jr-tabs [data-tab="entries"]'); await sleep(400);

  // ---------------------------------------------------------------- settings: suggestions, schedule
  await click('.jr-entries-page .app-toolbar-actions .ou-icon-btn:last-child'); await sleep(300);
  await menuItem(L('Settings', 'الإعدادات')); await sleep(500);
  await shot(P + 'jr-10-settings');
  await clickText(`${top} .ou-row`, L('Journaling suggestions', 'اقتراحات التدوين')); await sleep(300);
  ok((await J()).prefs.suggest === false, 'suggestions off (storage)');
  await clickText(`${top} .ou-row`, L('Journaling schedule', 'جدول التدوين')); await sleep(500);
  await page.click(`${top} .jr-sched-master .ou-row`); await sleep(400);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  ok((await J()).prefs.schedule.on === true && (await count(`${top} .jr-day.on`)) === 7, 'schedule on, every day');
  const alarm = await sw.evaluate(() => chrome.alarms.get('journal:remind'));
  ok(alarm && alarm.scheduledTime > Date.now(), 'the page sets the journal:remind alarm');
  await shot(P + 'jr-11-schedule');
  await back();

  // ---------------------------------------------------------------- Lock Journal: set a PIN on the keypad
  await clickText(`${top} .ou-row`, L('Lock Journal', 'قفل اليوميات')); await sleep(600);
  ok(await exists('.jr-pin-page .jr-pad') && (await count('.jr-pin-page .jr-pin-key')) === 12, 'Set PIN page with the One UI keypad');
  const key = async (d) => { await page.click(`.jr-pin-page .jr-pin-key[aria-label="${d}"]`); await sleep(60); };
  for (const d of '2580') await key(d);
  await shot(P + 'jr-12-pin');
  await click('.jr-pin-page .jr-pin-ok'); await sleep(300);
  ok((await text('.jr-pin-page .jr-pin-title')) === L('Confirm PIN', 'تأكيد رمز PIN'), 'then Confirm PIN');
  for (const d of '2581') await key(d);
  await click('.jr-pin-page .jr-pin-ok'); await sleep(400);
  ok((await text('.jr-pin-page .jr-pin-err')).length > 0, 'a different PIN does not match');
  for (const d of '2580') await key(d);
  await click('.jr-pin-page .jr-pin-ok'); await sleep(300);
  for (const d of '2580') await key(d);
  await click('.jr-pin-page .jr-pin-ok'); await sleep(1500);
  const lock = (await getStorage('journalLock')).journalLock;
  ok(lock?.on && lock.alg === 'PBKDF2-SHA256' && lock.hash && lock.salt && lock.digits === 4 && !JSON.stringify(lock).includes('2580'), 'journalLock: PBKDF2 hash and salt, never the PIN');
  ok(await exists(`${top} .ou-row`) && !(await exists('.jr-pin-page')), 'back in settings');
  // Lock now
  await clickText(`${top} .ou-row`, L('Lock now', 'القفل الآن')); await sleep(600);
  ok(await exists('.jr-lock-page .jr-pad') && !(await exists('.jr-card')) && !(await exists('.jr-edit-page')), 'locked: the PIN screen and no entry left in the page');
  await shot(P + 'jr-13-locked');
  const hidden = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('journal').search('lisbon').length));
  ok(hidden === 0, 'Finder search shows no entries while locked');
  await sleep(300);
  ok(await exists(wr + ' .jrw-locked') && !(await page.evaluate((s, x) => document.querySelector(s).textContent.includes(x), wr, L('Morning pages', 'صفحات الصباح'))), 'the entry widget shows only a lock while Lock Journal is on');
  // wrong PIN, then the right one from the keyboard (auto-confirm at 4 digits)
  for (const d of '1111') { await page.keyboard.press(d); await sleep(50); }
  await sleep(600);
  ok((await text('.jr-lock-page .jr-pin-err')) === L('Incorrect PIN', 'رمز PIN غير صحيح') && (await getStorage('journalLock')).journalLock.fails === 1, 'wrong PIN: error and one failed try counted');
  for (const d of '2580') { await page.keyboard.press(d); await sleep(50); }
  await sleep(1500);
  ok(await exists('.jr-entries-page .jr-card') && !(await exists('.jr-lock-page')), 'the right PIN (typed) unlocks');
  ok((await getStorage('journalLock')).journalLock.fails === 0, 'failed tries reset');
  // the Finder command still writes while locked
  await mod('./js/journal/lock.js', 'forget');
  const cmd = await page.evaluate(() => import('./js/core/hooks.js').then((m) => { let ran = false; const r = m.runCommands('journal: Quick thought from Finder', () => (ran = true)); r[0]?.run(); return { n: r.length, title: r[0]?.title, ran }; }));
  await sleep(300);
  ok(cmd.n === 1 && cmd.ran && (await J()).entries.some((e) => e.text === 'Quick thought from Finder'), '"journal: …" in Finder saves an entry, even while locked');
  await closeApp();

  // reopening asks for the PIN again; a widget's prompt waits for the unlock
  await openApp('journal', { section: 'new', prompt: 'p9' }); await sleep(500);
  ok(await exists('.jr-lock-page'), 'reopening a locked journal asks for the PIN');
  for (const d of '2580') { await page.keyboard.press(d); await sleep(50); }
  await sleep(1600);
  ok(await exists('.jr-edit-page .jr-ed-q'), 'after unlocking, the widget’s reflection prompt opens in a new entry');
  await back();
  await closeApp();

  // ---------------------------------------------------------------- Lock screen chip and the streak
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(900);
  const chips = await texts('#lock .lk-widgets .jr-lkw');
  ok(chips.length === 1 && /^\d+$/.test(chips[0]), 'Lock screen chip: only the flame and the number while locked: ' + chips[0]);
  const chipOpen = await page.evaluate(() => import('./js/core/hooks.js').then(async (m) => (await m.getLockWidget('journal').render({ locked: false }))?.textContent || ''));
  ok(chipOpen.length > 2 && /\d/.test(chipOpen), 'with the screen unlocked it says the streak: ' + chipOpen);
  await shot(P + 'jr-14-lockscreen');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(600);

  // ---------------------------------------------------------------- export (Markdown) and turning the lock off
  await openApp('journal'); await sleep(400);
  for (const d of '2580') { await page.keyboard.press(d); await sleep(50); }
  await sleep(1500);
  await click('.jr-entries-page .app-toolbar-actions .ou-icon-btn:last-child'); await sleep(300);
  await menuItem(L('Export entries', 'تصدير الإدخالات')); await sleep(400);
  await click('.ou-dialog .ou-dialog-btn.primary'); await sleep(500);
  const dl = await page.evaluate(async () => ({ names: window.__dl, text: window.__blob ? await window.__blob.text() : '' }));
  ok(dl.names.some((n) => n.endsWith('.md')) && dl.text.startsWith('# ') && dl.text.includes(L('Lisbon trip', 'رحلة لشبونة')) && dl.text.includes('#Travel'), 'export entries as Markdown');
  await click('.jr-entries-page .app-toolbar-actions .ou-icon-btn:last-child'); await sleep(300);
  await menuItem(L('Settings', 'الإعدادات')); await sleep(500);
  await clickText(`${top} .ou-row`, L('Lock Journal', 'قفل اليوميات')); await sleep(600);
  ok(await exists('.jr-pin-page'), 'turning the lock off asks for the PIN');
  for (const d of '2580') { await page.keyboard.press(d); await sleep(50); }
  await sleep(1500);
  ok(!(await getStorage('journalLock')).journalLock.on && !(await getStorage('journalLock')).journalLock.hash, 'Lock Journal off: the hash is gone');

  // ---------------------------------------------------------------- Use screen lock PIN
  const SCREEN = L('Use screen lock PIN', 'استخدام رمز PIN لقفل الشاشة');
  const rowTitles = () => texts(`${top} .ou-row .ou-row-title`);
  ok(!(await rowTitles()).includes(SCREEN), 'no screen lock PIN: no “Use screen lock PIN” row');
  await mod('./js/shell/pin.js', 'setPin', '1357'); await sleep(800);
  ok((await rowTitles()).includes(SCREEN), 'with a screen lock PIN the row appears');
  await shot(P + 'jr-16-screen-pin');
  await clickText(`${top} .ou-row`, SCREEN); await sleep(600);
  let jl = (await getStorage('journalLock')).journalLock;
  ok(jl.on && jl.kind === 'screen' && !jl.hash, 'turning it on locks the Journal with the screen PIN (no PIN of its own)');
  ok(!(await rowTitles()).includes(L('Change PIN', 'تغيير رمز PIN')), 'Change PIN is left out while the screen PIN is used');
  await clickText(`${top} .ou-row`, SCREEN); await sleep(600);
  ok(await exists('.jr-pin-page'), 'turning it off asks for the screen PIN first');
  for (const d of '1357') { await page.keyboard.press(d); await sleep(50); }
  await sleep(2500);
  ok(await exists('.jr-pin-page .jr-pin-ok'), 'then a PIN of the Journal’s own');
  for (const d of '2468') await key(d);
  await click('.jr-pin-page .jr-pin-ok'); await sleep(300);
  for (const d of '2468') await key(d);
  await click('.jr-pin-page .jr-pin-ok'); await sleep(1500);
  jl = (await getStorage('journalLock')).journalLock;
  ok(jl.on && jl.kind === 'journal' && jl.hash, 'and the Journal has its own PIN again');
  await page.evaluate(() => import('./js/journal/lock.js').then((m) => m.turnOff()));
  await mod('./js/shell/pin.js', 'removePin'); await sleep(500);
  await closeApp();

  // ---------------------------------------------------------------- Modes and Routines: New journal entry
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  ok(await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => !!A.ACTIONS['journal.entry'] && !I.t(A.ACTIONS['journal.entry'].name).startsWith('journal.'))), 'Routines lists New journal entry');
  const jOpts = await page.evaluate(() => import('./js/routines/actions.js').then((A) => A.ACTIONS['journal.entry'].params[1].opts.map((o) => o[0])));
  ok(JSON.stringify(jOpts) === JSON.stringify(['', 'journal', 'jw']), 'its journal choices: the default and each journal');
  const ne = (await J()).entries.length;
  let jr = await runAction('journal.entry', { text: L('Standup notes from a routine', 'ملاحظات الاجتماع من إجراء روتيني'), journal: 'jw' });
  let added = (await J()).entries[0];
  ok((await J()).entries.length === ne + 1 && added.journal === 'jw' && added.text === jr.v, 'New journal entry adds the text to the chosen journal');
  jr = await runAction('journal.entry', { text: '  ' });
  ok(jr.err === 'routines.err.empty' && (await J()).entries.length === ne + 1, 'an empty entry is an error');

  // ---------------------------------------------------------------- the entry widget's settings: one journal
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__wc = m.getWidget('journal-recent').configure({}); }));
  await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
  ok(await count('.ou-dialog .ou-radio-row') === 3, 'the entry widget’s settings: All journals and each journal');
  await clickText('.ou-dialog .ou-radio-row', L('Work', 'العمل'));
  await click('.ou-dialog .ou-dialog-btn.primary');
  ok((await page.evaluate(() => window.__wc))?.journal === 'jw', 'and return the chosen journal');
  await runAction('journal.entry', { text: L('Newest of all, personal', 'الأحدث بين الكل، شخصي'), journal: 'journal' });
  const wTxt = await page.evaluate(() => import('./js/core/widgets.js').then((m) => {
    const one = (config) => { const b = document.createElement('div'); b.className = 'wg w-m'; document.body.appendChild(b); const off = m.getWidget('journal-recent').render(b, { size: 'm', item: {}, config }); const tx = b.textContent; off?.(); b.remove(); return tx; };
    return [one({ journal: 'jw' }), one({})];
  }));
  ok(wTxt[0].includes(L('Standup notes', 'ملاحظات الاجتماع')) && wTxt[1].includes(L('Newest of all', 'الأحدث بين الكل')), 'the widget shows the newest entry of its journal, or of all of them');

  // ---------------------------------------------------------------- the service worker reminder
  await setStorage({ notifications: [] });
  const sc = (await J());
  sc.prefs.schedule = { on: true, days: [0, 1, 2, 3, 4, 5, 6], time: hhmm(new Date()) };
  await setStorage({ journal: sc });
  await sw.evaluate(() => chrome.alarms.create('journal:remind', { when: Date.now() + 300 }));
  let note = null;
  for (let i = 0; i < 30 && !note; i++) { await sleep(200); note = ((await getStorage('notifications')).notifications || []).find((n) => n.app === 'journal'); }
  ok(note && note.title === L('Journal', 'اليوميات'), 'the schedule alarm posts a Journal notification');
  const next = await sw.evaluate(() => chrome.alarms.get('journal:remind'));
  ok(next && next.scheduledTime > Date.now() + 3600e3, 'and plans the next one');
  const sys = await sw.evaluate(() => chrome.notifications.getAll());
  ok(Object.keys(sys).some((id) => id.startsWith('journal:remind:')), 'system notification with a Write button');

  // ---------------------------------------------------------------- a narrow window and the maximized one
  await openApp('journal'); await sleep(500);
  await page.evaluate(() => document.querySelector('.app-win').classList.add('max')); await sleep(500);
  await shot(P + 'jr-15-maximized');
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('.jr-entries-page .jr-cards')).gridTemplateColumns.split(' ').length)) >= 2, 'maximized: cards in columns');
  await closeApp();

  // ---------------------------------------------------------------- a repeating Calendar event is a moment on each day it happens
  const wkD = new Date(early(0.5)); wkD.setDate(wkD.getDate() - 14); // same wall-clock time two weeks ago (DST-safe)
  const wkStart = +wkD;
  await page.evaluate((st) => import('./js/core/store.js').then((m) => m.store.set('events', [...(m.store.get('events') || []), { id: 'wk1', title: 'Weekly sync', start: st, end: st + 1800e3, allDay: false, repeat: { freq: 'week', interval: 1 } }])), wkStart);
  await sleep(300);
  const wk = await page.evaluate(() => import('./js/journal/suggestions.js').then((m) => m.moments().filter((x) => x.kind === 'event' && x.title === 'Weekly sync').map((x) => x.at)));
  // (Calendar keeps times to the minute)
  ok(wk.length === 1 && new Date(wk[0]).toDateString() === new Date().toDateString() && Math.abs(wk[0] - early(0.5)) < 60e3, `a weekly event that started two weeks ago suggests today's occurrence (${wk.map((x) => new Date(x).toISOString())})`);
};
