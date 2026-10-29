// triple
// Samsung Wallet end to end: Home screen widgets, the Lock screen bill chip (no name or amount while locked) and the Now
// Bar pill for a flight about to leave; the app's Home (Quick access stack, Coming up, a row per category), the pass
// detail page with its barcode and the full-screen barcode (screen dimming lifted, Escape closes it), Quick access on/off,
// Menu with Samsung's categories and a category page with its expired passes; Add to Wallet for a membership card with a
// Code 128 barcode and a logo picture (IndexedDB), a boarding pass with its route, a wrong EAN-13 check digit; bills:
// totals, the editor, a new subscription, alarms read back from the service worker, pausing, and an alert fired by
// the worker into the notification list; Spending: quick entry ("coffee 3.5$"), the chart in week/month/year, the
// category filter, budgets, the expense dialog, CSV; Finder ("coffee 3.5$", "bills", a pass name); the window
// maximized. usage: .dev/run.sh .dev/wallet.cjs   (THEME=dark, UI=ar for the other runs)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

module.exports = async (h) => {
  const { page, boot, ok, openApp, click, exists, count, text, texts, sleep, shot, P, ui, sw, getStorage, outside, mod } = h;
  const AR = ui === 'ar', L = (en, ar) => (AR ? ar : en);
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return keyOf(d); };
  const now = Date.now(), day = 864e5;
  const inH = (hrs) => { const d = new Date(now + hrs * 3600e3); return `${keyOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const F = (l, v) => ({ l, v });
  const passes = [
    { id: 'p-flight', kind: 'boarding', name: 'United', bg: '#0b3d91', transit: 'air', quick: true, header: [F(L('Flight', 'الرحلة'), 'UA 837'), F(L('Gate', 'البوابة'), 'G98')], primary: [F(L('San Francisco', 'سان فرانسيسكو'), 'SFO'), F(L('Tokyo', 'طوكيو'), 'NRT')], secondary: [F(L('Passenger', 'المسافر'), 'ALAKHSHAM/AMIN')], aux: [F(L('Seat', 'المقعد'), '32A'), F(L('Group', 'المجموعة'), '3')], back: [F(L('Confirmation', 'رقم الحجز'), 'K7Q2ZP')], code: { type: 'pdf417', msg: 'M1ALAKHSHAM/AMIN      EK7Q2ZP SFONRTUA 0837 290Y032A0001 100', alt: '' }, date: inH(2), at: now - 4 * day },
    { id: 'p-gym', kind: 'member', name: L('City Gym', 'نادي المدينة'), bg: '#1c1c22', quick: true, header: [F(L('Points', 'النقاط'), '1,240')], primary: [F(L('Member', 'العضو'), L('Amin Alakhsham', 'أمين الأخشم'))], secondary: [F(L('Member number', 'رقم العضوية'), '48213'), F(L('Level', 'المستوى'), L('Gold', 'ذهبي'))], aux: [], back: [], code: { type: 'qr', msg: 'GYM-48213-AMIN', alt: '48213' }, notes: L('Locker 112', 'الخزانة 112'), at: now - 5 * day },
    { id: 'p-show', kind: 'ticket', name: L('Live Nation', 'لايف نيشن'), bg: '#7a3ff2', header: [F(L('Section', 'القسم'), 'A3')], primary: [F(L('Event', 'الحدث'), L('Coldplay', 'كولدبلاي'))], secondary: [F(L('Venue', 'المكان'), L('Wembley Stadium', 'ملعب ويمبلي'))], aux: [F(L('Row', 'الصف'), '12'), F(L('Seat', 'المقعد'), '34')], back: [], code: { type: 'qr', msg: 'https://tickets.example/7GQ2-11A', alt: '7GQ2 11A' }, date: dk(10) + 'T19:30', at: now - 3 * day },
    { id: 'p-coupon', kind: 'coupon', name: L('Blue Bottle', 'بلو بوتل'), bg: '#ff7a2f', quick: true, header: [], primary: [F(L('Offer', 'العرض'), L('20% off', 'خصم 20%'))], secondary: [], aux: [], back: [], code: { type: 'code128', msg: 'SAVE20NOW', alt: 'SAVE20NOW' }, expires: dk(20), at: now - 2 * day },
    { id: 'p-gift', kind: 'gift', name: 'IKEA', bg: '#3e8bff', header: [], primary: [F(L('Balance', 'الرصيد'), '$50.00')], secondary: [F(L('Card number', 'رقم البطاقة'), '6001 2345')], aux: [], back: [], code: { type: 'ean13', msg: '4006381333931', alt: '' }, at: now - day },
    { id: 'p-key', kind: 'key', name: 'Hilton', bg: '#147d6f', header: [], primary: [F(L('Room', 'الغرفة'), '1204')], secondary: [], aux: [], back: [], code: { type: 'qr', msg: 'HILTON-1204-KEY', alt: '' }, date: dk(-1) + 'T15:00', expires: dk(3), at: now - day },
    { id: 'p-id', kind: 'id', name: L('Seoul University', 'جامعة سيول'), bg: '#3d5a80', header: [], primary: [F(L('Name', 'الاسم'), L('Amin Alakhsham', 'أمين الأخشم'))], secondary: [F(L('ID number', 'رقم الهوية'), '2026-1187')], aux: [], back: [], code: { type: 'code128', msg: '20261187', alt: '' }, at: now - day },
    { id: 'p-old', kind: 'ticket', name: L('Cinema City', 'سينما سيتي'), bg: '#e5466e', header: [], primary: [F(L('Event', 'الحدث'), L('Dune: Part Two', 'كثيب: الجزء الثاني'))], secondary: [], aux: [], back: [], code: { type: 'qr', msg: 'CC-55120', alt: '' }, date: dk(-6) + 'T20:00', at: now - 9 * day },
  ];
  const subs = [
    { id: 's-nf', name: 'Netflix', url: 'https://www.netflix.com/', amount: 15.49, cur: 'USD', cycle: 'm', start: dk(3), cat: 'streaming', alert: 1, state: 'active', pass: 'p-gift', at: now },
    { id: 's-sp', name: 'Spotify', url: 'https://open.spotify.com/', amount: 10.99, cur: 'USD', cycle: 'm', start: dk(1), cat: 'music', alert: 1, onDay: true, state: 'active', at: now },
    { id: 's-ic', name: 'iCloud+', amount: 2.99, cur: 'USD', cycle: 'm', start: dk(12), cat: 'cloud', alert: 0, state: 'active', at: now },
    { id: 's-el', name: L('Electricity', 'الكهرباء'), amount: 85, cur: 'USD', cycle: 'm', start: dk(6), cat: 'utilities', alert: 3, state: 'active', at: now },
    { id: 's-gym', name: L('Gym classes', 'حصص النادي'), amount: 12, cur: 'EUR', cycle: 'w', start: dk(-2), cat: 'fitness', alert: -1, state: 'active', at: now },
    { id: 's-ad', name: 'Adobe Express', amount: 9.99, cur: 'USD', cycle: 'm', start: dk(5), trial: dk(5), cat: 'software', alert: 2, state: 'active', at: now },
    { id: 's-du', name: 'Duolingo', amount: 59.99, cur: 'USD', cycle: 'y', start: dk(40), cat: 'software', alert: 1, state: 'paused', at: now },
    { id: 's-hu', name: 'Hulu', amount: 7.99, cur: 'USD', cycle: 'm', start: dk(8), cat: 'streaming', alert: 1, state: 'cancelled', until: dk(8), at: now },
  ];
  const spend = [
    [0, 3.5, 'Blue Bottle', 'food'], [0, 42.1, 'Whole Foods', 'food'], [-1, 18.4, 'Uber', 'transport'], [-1, 64, 'Zara', 'shopping'], [-2, 12.5, L('Lunch', 'غداء'), 'food'],
    [-2, 15, 'AMC', 'entertainment'], [-3, 27.3, 'CVS', 'health'], [-3, 9.2, 'Lyft', 'transport'], [-4, 120, 'Delta', 'travel'], [-4, 35, L('Haircut', 'حلاق'), 'services'],
    [-5, 6.75, 'Starbucks', 'food'], [-6, 22, 'Shell', 'transport'], [-8, 48, 'IKEA', 'shopping'], [-9, 14, L('Pharmacy', 'صيدلية'), 'health'], [-1, 9, 'Café de Flore', 'food', 'EUR'],
  ].map(([o, amt, mer, cat, cur = 'USD'], i) => { const d = new Date(now + o * day); d.setHours(8 + (i % 6), 15, 0, 0); if (o === 0 && +d > now) d.setTime(now - 60e3 * (i + 1)); return { id: 'e' + i, amt, cur, mer, cat, at: +d }; });
  const wallet = { v: 1, passes, subs, spend, budgets: { food: 300, shopping: 150, transport: 120 }, prefs: { cur: 'USD', alertTime: '09:00' } };
  const W = (id, widget, size) => ({ id, type: 'widget', widget, size, config: {} });
  await boot({
    settings: { lockWidgets: ['wallet-bill'], showNowBar: true },
    data: { wallet, home: [[W('w1', 'wallet-pass', 'm'), W('w2', 'wallet-bills', 's'), W('w3', 'wallet-spend', 'm'), W('w4', 'wallet-spend', 's'), W('w5', 'wallet-pass', 's')], [W('w6', 'wallet-bills', 'm')]], dock: [] },
  });
  const data = async () => (await getStorage('wallet')).wallet;
  const top = '.app-page:last-child';
  const topBtn = (ico) => `${top} .app-toolbar-actions button:has(.ico-${ico})`;
  const menuItem = (ico) => `.ou-menu-item:has(.ico-${ico})`;
  const typeIn = async (sel, value) => {
    await page.waitForSelector(sel, { timeout: 5000 });
    await page.$eval(sel, (i) => { i.scrollIntoView({ block: 'center' }); i.focus(); i.select?.(); });
    await page.keyboard.press('Backspace');
    await page.type(sel, value, { delay: 5 });
    await sleep(120);
  };
  const chooseOption = async (label) => { await sleep(250); const done = await h.clickText('.ou-radio-row', label); await click('.ou-dialog-btn.primary'); await sleep(250); return done; };
  const back = async () => { await click(`${top} .app-back`); await sleep(450); };

  // ================================================================ Home screen widgets, Lock screen, Now Bar
  await sleep(600);
  ok(await count('.wl-wg-pass .wl-cf') === 2, 'both Quick access widgets show a card');
  ok((await text('.wl-wg-pass .wl-cf .wl-cf-name')) === 'United', 'the Quick access widget shows the flight that leaves soonest');
  ok(await exists('.wl-wg-bills .wl-subico') && (await text('.wl-wg-bills .wl-wg-name')) === 'Spotify', 'the Upcoming bills widget shows the next bill (Spotify, tomorrow)');
  ok(await count('.wl-wg-spend .wl-wg-bar i') >= 3, 'the Spending widget shows this month by category');
  ok(await count('.wl-wg-spend .wl-wg-legend > span') >= 3, 'the medium Spending widget lists the top categories');
  await shot(P + 'wallet-01-widgets');
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(900);
  const chip = await text('.lk-w.wl-lk');
  ok(chip && !chip.includes('Spotify') && !chip.includes('10.99'), `the Lock screen bill chip hides the name and amount while locked (${chip})`);
  ok((await texts('.nb-pill')).some((x) => x.includes('SFO') && x.includes('NRT')), 'the Now Bar shows the flight that leaves in two hours');
  await shot(P + 'wallet-02-lock');
  await page.evaluate(() => import('./js/shell/lock.js').then((m) => m.unlock())); await sleep(700);

  // ================================================================ the app: Home
  await openApp('wallet'); await sleep(500);
  ok(await exists('.app-win .wl-home'), 'Samsung Wallet opens on Home');
  ok(await count('.wl-tabs .ou-tab') === 4, 'four floating tabs: Home, Bills, Spending, Menu');
  ok((await outside('.wl-tabs', '.app-win')).length === 0, 'the tabs stay inside the window');
  const stackIds = await page.$$eval('.wl-stack > .wl-cf[data-id]', (n) => n.map((x) => x.dataset.id));
  ok(stackIds.join() === 'p-flight,p-gym,p-coupon', `the Quick access stack shows the three Quick access cards (${stackIds})`);
  ok(await count('.wl-home .ou-list .ou-row') >= 2, 'Coming up lists the flight and the bills due this week');
  ok(await count('.wl-hscroll') === 7, 'a row of cards for each category with live passes (7)');
  ok(!(await exists('.wl-hscroll .wl-cf[data-id="p-old"]')), 'the past ticket is not on Home');
  ok(await exists('.wl-cf.k-boarding .wl-cf-route .ico-airplane'), 'the boarding pass card shows the route with a plane');
  await shot(P + 'wallet-03-home');
  await page.$eval('.app-win .app-scroll', (s) => s.scrollTo(0, s.scrollHeight)); await sleep(300);
  await shot(P + 'wallet-04-home-bottom');

  // pass details: the boarding pass from the stack (its top edge is what shows)
  const r = await page.$eval('.wl-stack > .wl-cf[data-id="p-flight"]', (n) => { n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + 14]; });
  await page.mouse.click(r[0], r[1]); await sleep(600);
  ok(await exists(`${top}.wl-detail`), 'a click on the stacked card opens its details');
  ok(await exists(`${top} .wl-codepanel svg.wl-code.pdf417 path`), 'the boarding pass shows its PDF417 barcode');
  ok((await texts(`${top} .wl-trip-end b`)).join(' ') === 'SFO NRT', 'the trip shows both airport codes');
  ok(await count(`${top} .wl-fields .wl-fi`) >= 5, 'the fields (flight, gate, passenger, seat, group) are listed');
  ok((await text(`${top} .wl-back`)).includes('K7Q2ZP'), 'More info shows the back fields');
  await shot(P + 'wallet-05-detail');
  await click(`${top} .wl-codepanel`); await sleep(400);
  ok(await exists('.wl-bright svg.wl-code.pdf417'), 'the barcode opens full screen on white');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('screen-filters')).visibility === 'hidden'), 'the screen dimming is lifted while the barcode shows');
  await shot(P + 'wallet-06-bright');
  await page.keyboard.press('Escape'); await sleep(400);
  ok(!(await exists('.wl-bright')), 'Escape closes the full-screen barcode');
  ok(await exists(`${top}.wl-detail`), '… and leaves the details open');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('screen-filters')).visibility !== 'hidden'), 'the screen dimming is back');
  // Quick access off from the ⋮ menu, then on again with the switch
  await click(topBtn('more')); await sleep(250);
  ok((await outside('.ou-menu')).length === 0, 'the ⋮ menu stays on screen');
  await click(menuItem('wl-quick')); await sleep(400);
  ok(!(await data()).passes.find((p) => p.id === 'p-flight').quick, 'Remove from Quick access is stored');
  await click(`${top} .ou-switch input`); await sleep(400);
  ok((await data()).passes.find((p) => p.id === 'p-flight').quick === true, 'the Quick access switch puts it back');
  await back();
  ok(await exists(`${top}.wl-home`), 'Back returns to Home');

  // the membership card: QR code, notes
  await page.$eval('.wl-hscroll .wl-cf[data-id="p-gym"]', (n) => n.click()); await sleep(600);
  ok(await exists(`${top} .wl-codepanel.sq svg.wl-code.qr path`) && (await text(`${top} .wl-alt`)) === '48213', 'the membership card shows its QR code and the number under it');
  await back();

  // ================================================================ Menu and a category
  await click('.wl-tabs [data-tab="menu"]'); await sleep(400);
  ok(await count('.wl-menu .ou-list:first-child .ou-row') === 8, 'Menu lists Samsung Wallet’s eight categories');
  await shot(P + 'wallet-07-menu');
  await page.$eval('.wl-menu .ou-list:first-child .ou-row:nth-child(2)', (n) => n.click()); await sleep(600);
  ok(await count(`${top} .wl-grid:not(.dim) .wl-cf`) === 1 && await count(`${top} .wl-grid.dim .wl-cf`) === 1, 'Tickets shows the concert, and the past film under Expired');
  await shot(P + 'wallet-08-tickets');
  await page.$eval(`${top} .wl-grid.dim .wl-cf`, (n) => n.click()); await sleep(600);
  ok(await exists(`${top} .wl-expbar`), 'an expired pass says so, with Restore');
  await click(`${top} .wl-expbar .ou-btn`); await sleep(400);
  ok((await data()).passes.find((p) => p.id === 'p-old').keep === true, 'Restore keeps the pass');
  await back();
  ok(await count(`${top} .wl-grid:not(.dim) .wl-cf`) === 2, 'the restored ticket is back with the live ones');
  await back();
  // Wallet settings: the bill alert time
  await page.$eval('.wl-menu .ou-list:nth-child(3) .ou-row:last-child', (n) => n.click()); await sleep(600);
  ok(await exists(`${top}.wl-settings .wl-time`), 'Menu › Wallet settings opens');
  await page.$eval(`${top} .wl-time`, (i) => { i.value = '08:30'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
  ok((await data()).prefs.alertTime === '08:30', 'the bill alert time is stored');
  await shot(P + 'wallet-08b-settings');
  await back();

  // ================================================================ Home search
  await click('.wl-tabs [data-tab="home"]'); await sleep(400);
  await click(topBtn('search')); await sleep(300);
  await page.type(`${top} .wl-search input`, 'Hilton', { delay: 5 }); await sleep(300);
  ok((await texts(`${top} .wl-results .ou-row`)).some((x) => x.includes('Hilton')), 'Home search finds a card');
  await click(topBtn('search')); await sleep(300);
  ok(await exists(`${top} .wl-stack`), 'closing the search brings Home back');

  // ================================================================ Add to Wallet: a membership card with a logo
  await click(topBtn('plus')); await sleep(500);
  ok(await count(`${top} .ou-list:first-child .ou-row`) === 8, 'Add to Wallet lists every kind of card');
  await shot(P + 'wallet-09-add');
  await page.$eval(`${top} .ou-list:first-child .ou-row:nth-child(3)`, (n) => n.click()); await sleep(600);
  ok(await exists(`${top}.wl-editor .wl-ed-prev .wl-cf.k-member`), 'the editor opens for a membership card with a live preview');
  await typeIn(`${top} [data-k="name"]`, L('Public Library', 'المكتبة العامة'));
  await typeIn(`${top} .wl-pair[data-g="primary"] [data-p="v"]`, L('Jane Doe', 'سارة أحمد'));
  ok((await text(`${top} .wl-ed-prev .wl-cf-main b`)) === L('Jane Doe', 'سارة أحمد'), 'the preview follows what is typed');
  ok((await text(`${top} [data-act="format"] .wl-frow-v`)) === 'Code 128', 'a membership card starts with a Code 128 barcode');
  await typeIn(`${top} [data-k="codeMsg"]`, 'LIB-778812');
  // a logo picture goes to IndexedDB
  const png = path.join(__dirname, 'shots', 'wallet-test-logo.png');
  fs.writeFileSync(png, makePng(48, 48, [229, 72, 77]));
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.$eval(`${top} [data-img="logo"]`, (b) => { b.scrollIntoView({ block: 'center' }); b.click(); })]);
  await chooser.accept([png]); await sleep(900);
  ok(await exists(`${top} .wl-ed-prev .wl-cf-logo.pic img[src^="blob:"]`), 'the logo shows on the preview');
  await page.$eval(`${top} .wl-ed-prev`, (n) => n.scrollIntoView({ block: 'start' }));
  await shot(P + 'wallet-10-editor');
  await click(`${top} .wl-edbar-btn.primary`); await sleep(700);
  let d = await data();
  const lib = d.passes.find((p) => p.name === L('Public Library', 'المكتبة العامة'));
  ok(lib && lib.kind === 'member' && lib.code.type === 'code128' && lib.code.msg === 'LIB-778812' && lib.quick === true, 'the new card is stored with its barcode, in Quick access');
  ok(lib && /^wallet:/.test(lib.logo) && (await page.evaluate((k) => import('./js/core/blobs.js').then((m) => m.getBlob(k)).then((b) => b?.size || 0), lib.logo)) > 0, 'its logo is a blob in IndexedDB');
  ok(await exists(`${top}.wl-detail`) && await exists(`${top} .wl-codepanel svg.wl-code.linear`), 'after saving, the new card opens with its Code 128 barcode');
  await shot(P + 'wallet-11-new-card');
  await back();

  // a boarding pass with its route, and a wrong EAN-13 check digit
  await click(topBtn('plus')); await sleep(500);
  await page.$eval(`${top} .ou-list:first-child .ou-row:nth-child(1)`, (n) => n.click()); await sleep(600);
  await typeIn(`${top} [data-k="name"]`, 'Emirates');
  const rows = await page.$$(`${top} .wl-pair.route`);
  await (await rows[0].$('[data-p="l"]')).type('Paris'); await (await rows[0].$('[data-p="v"]')).type('CDG');
  await (await rows[1].$('[data-p="l"]')).type('Dubai'); await (await rows[1].$('[data-p="v"]')).type('DXB');
  await page.$eval(`${top} [data-k="date"]`, (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, `${dk(5)}T08:40`);
  await sleep(200);
  ok((await texts(`${top} .wl-ed-prev .wl-cf-end b`)).join(' ') === 'CDG DXB', 'the preview shows the route');
  await click(`${top} [data-act="format"]`);
  await chooseOption('EAN-13');
  await typeIn(`${top} [data-k="codeMsg"]`, '4006381333932');
  ok((await text(`${top} .wl-code-err`)).length > 5, 'a wrong EAN-13 check digit is explained under the barcode');
  await click(`${top} .wl-edbar-btn.primary`); await sleep(400);
  ok(await exists('.ou-dialog'), 'Save asks to check the barcode first');
  await click('.ou-dialog-btn.primary'); await sleep(300);
  await click(`${top} [data-act="format"]`);
  await chooseOption('QR Code');
  await typeIn(`${top} [data-k="codeMsg"]`, 'EK-0074-CDG-DXB');
  await click(`${top} .wl-edbar-btn.primary`); await sleep(700);
  d = await data();
  const ek = d.passes.find((p) => p.name === 'Emirates');
  ok(ek && ek.kind === 'boarding' && ek.primary.map((f) => f.v).join() === 'CDG,DXB' && ek.code.type === 'qr' && ek.date === `${dk(5)}T08:40`, 'the boarding pass is stored with its route, departure and QR code');
  ok(await exists(`${top} .wl-codepanel svg.wl-code.qr`), 'it opens with its QR code');
  // delete it again from the ⋮ menu
  await click(topBtn('more')); await sleep(250);
  await click(menuItem('trash')); await sleep(300);
  await click('.ou-dialog-btn.danger'); await sleep(600);
  ok(!(await data()).passes.some((p) => p.name === 'Emirates'), 'Delete removes the pass');

  // ================================================================ Bills
  await click('.wl-tabs [data-tab="bills"]'); await sleep(500);
  ok(await exists('.wl-bills .wl-sum') && (await text('.wl-bills .wl-sum .wl-stat b')).includes('1'), 'the summary shows what the subscriptions cost per month');
  ok(await count('.wl-bills .wl-srow') >= 8, 'upcoming bills and every subscription are listed');
  ok((await texts('.wl-bills .wl-trial')).length >= 1, 'the free trial is marked');
  await shot(P + 'wallet-12-bills');
  await page.$eval('.wl-bills .wl-srow[data-id="s-nf"]', (n) => n.click()); await sleep(600);
  ok(await exists(`${top}.wl-subed`) && (await page.$eval(`${top} [data-k="name"]`, (i) => i.value)) === 'Netflix', 'a subscription opens in its editor');
  await shot(P + 'wallet-13-sub-editor');
  await typeIn(`${top} [data-k="amount"]`, '17.99');
  await click(`${top} .wl-edbar-btn.primary`); await sleep(500);
  ok((await data()).subs.find((s) => s.id === 's-nf').amount === 17.99, 'a new price is stored');
  // a new subscription
  await click(topBtn('plus')); await sleep(600);
  await typeIn(`${top} [data-k="name"]`, 'YouTube Premium');
  await typeIn(`${top} [data-k="amount"]`, '13.99');
  await page.$eval(`${top} [data-k="next"]`, (i, v) => { i.value = v; }, dk(9));
  await click(`${top} .wl-edbar-btn.primary`); await sleep(600);
  d = await data();
  const yt = d.subs.find((s) => s.name === 'YouTube Premium');
  ok(yt && yt.amount === 13.99 && yt.start === dk(9) && yt.alert === 1 && yt.cur === 'USD', 'the new subscription is stored with its next bill and a day-before alert');
  const alarms = async () => { await sw.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'wallet-plan' }, res)).catch(() => null)); await sleep(300); return sw.evaluate(() => chrome.alarms.getAll().then((a) => a.filter((x) => x.name.startsWith('wallet:')).map((x) => x.name))); };
  let names = await alarms();
  ok(yt && names.includes('wallet:sub:' + yt.id) && names.includes('wallet:sub:s-nf') && !names.includes('wallet:sub:s-gym') && !names.includes('wallet:sub:s-du') && names.includes('wallet:plan'), `the service worker plans one alert per running subscription (${names.length})`);
  // pause from the row's context menu
  const sp = await page.$('.wl-bills .wl-srow[data-id="s-sp"]');
  await sp.click({ button: 'right' }); await sleep(300);
  await click(menuItem('pause')); await sleep(500);
  ok((await data()).subs.find((s) => s.id === 's-sp').state === 'paused', 'Pause is stored');
  await sleep(500);
  names = await alarms();
  ok(!names.includes('wallet:sub:s-sp'), 'a paused subscription has no alert');
  // the worker's alert: a bill tomorrow, an alert time a minute ago
  const past = new Date(Date.now() - 60e3), bill = new Date(past); bill.setDate(bill.getDate() + 1);
  await h.setStorage({ wallet: { ...(await data()), subs: [...(await data()).subs, { id: 's-test', name: 'Test Bill', amount: 4.5, cur: 'USD', cycle: 'm', start: keyOf(bill), cat: 'utilities', alert: 1, state: 'active', at: now }], prefs: { cur: 'USD', alertTime: `${pad(past.getHours())}:${pad(past.getMinutes())}` } } });
  await sleep(400);
  await sw.evaluate(() => chrome.alarms.create('wallet:sub:s-test', { when: Date.now() + 200 }));
  let note = null;
  for (let i = 0; i < 40 && !note; i++) { await sleep(500); note = ((await getStorage('notifications')).notifications || []).find((n) => n.app === 'wallet'); }
  ok(note && note.title === 'Test Bill' && /4\.50/.test(note.body), `the service worker posts the bill alert (${note?.body})`);

  // ================================================================ Spending
  await click('.wl-tabs [data-tab="spend"]'); await sleep(500);
  ok(await count('.wl-spend .wl-bar') === 7, 'the week chart has a bar per day');
  ok(await count('.wl-spend .wl-bar:not(.zero) .wl-bar-fill i') >= 3, 'bars are split by category colour');
  ok(await count('.wl-spend .wl-cat') >= 3, 'the categories with amounts are under the chart');
  ok(await count('.wl-spend .wl-brow') === 3, 'the three budgets are shown with meters');
  await page.$eval('.wl-spend .wl-chartcard', (n) => n.scrollIntoView({ block: 'center' })); await sleep(200);
  await shot(P + 'wallet-14-spending');
  const before = (await data()).spend.length;
  await page.type('.wl-quick-in', 'coffee 3.5$', { delay: 5 });
  await page.keyboard.press('Enter'); await sleep(500);
  d = await data();
  const cof = d.spend.find((e) => e.mer === 'Coffee');
  ok(d.spend.length === before + 1 && cof && cof.amt === 3.5 && cof.cur === 'USD' && cof.cat === 'food', 'quick entry "coffee 3.5$" adds a food expense');
  await click('.wl-spend .wl-chart-seg .ou-seg-btn:nth-child(2)'); await sleep(300);
  const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  ok(await count('.wl-spend .wl-bar') === dim, 'Month shows a bar per day of the month');
  await click('.wl-spend .wl-chart-seg .ou-seg-btn:nth-child(3)'); await sleep(300);
  ok(await count('.wl-spend .wl-bar') === 12, 'Year shows a bar per month');
  await click('.wl-spend .wl-chart-seg .ou-seg-btn:nth-child(1)'); await sleep(300);
  await click('.wl-spend .wl-cat[data-cat="transport"]'); await sleep(300);
  const shown = await page.$$eval('.wl-spend .wl-erow', (n) => n.map((x) => x.dataset.id));
  ok(shown.length >= 1 && shown.every((id) => d.spend.find((e) => e.id === id)?.cat === 'transport'), 'a category filters the transactions');
  await click('.wl-spend [data-act="unpick"]'); await sleep(300);
  // budgets
  await click('.wl-spend .wl-tile[data-act="budgets"]'); await sleep(400);
  await page.$$eval('.wl-buddialog .wl-bud input', (ins) => { ins[0].value = '250'; });
  await click('.wl-buddialog .ou-dialog-btn.primary'); await sleep(400);
  ok((await data()).budgets.food === 250, 'a budget is stored');
  // the expense dialog
  await page.$eval(`.wl-spend .wl-erow[data-id="${cof.id}"]`, (n) => n.click()); await sleep(400);
  ok(await exists('.wl-exdialog .wl-catpick.on[data-cat="food"]'), 'the expense opens with its category');
  await shot(P + 'wallet-15-expense');
  await page.$eval('.wl-exdialog .wl-exed-in', (i) => { i.value = '4.25'; });
  await click('.wl-exdialog .wl-catpick[data-cat="shopping"]');
  await click('.wl-exdialog .ou-dialog-btn.primary'); await sleep(400);
  const cof2 = (await data()).spend.find((e) => e.id === cof.id);
  ok(cof2.amt === 4.25 && cof2.cat === 'shopping', 'the edited amount and category are stored');
  await page.$eval(`.wl-spend .wl-erow[data-id="${cof.id}"]`, (n) => n.click()); await sleep(400);
  await click('.wl-exdialog .ou-dialog-btn.danger'); await sleep(300);
  await click('.ou-dialog-scrim:last-child .ou-dialog-btn.danger'); await sleep(400);
  ok(!(await data()).spend.some((e) => e.id === cof.id), 'Delete removes the expense');
  const csv = await mod('./js/wallet/model.js', 'toCSV', [{ id: 'x', amt: 3.5, cur: 'USD', mer: '=cmd', cat: 'food', at: now }]);
  ok(csv.includes(`"'=cmd"`) && csv.includes('3.50,USD'), 'the CSV quotes cells that look like formulas');

  // ================================================================ Finder, maximized window
  await click('.wl-tabs [data-tab="home"]'); await sleep(300);
  await click('.app-handle-btn'); await sleep(500);
  ok(await page.evaluate(() => document.querySelector('.app-win').classList.contains('max')), 'the window maximizes');
  await shot(P + 'wallet-16-max');
  await h.closeApp();
  // typed like a person; if the keystrokes went elsewhere (the Finder still settling after the last run), the text is set
  // the way typing would
  const finder = async (q) => {
    await mod('./js/shell/finder.js', 'closeFinder'); await sleep(400);
    await mod('./js/shell/finder.js', 'openFinder'); await sleep(400);
    await page.type('.finder-input', q, { delay: 5 }); await sleep(300);
    if ((await page.$eval('.finder-input', (i) => i.value)) !== q) await page.$eval('.finder-input', (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
    await sleep(700);
    return texts('.fr');
  };
  let fr = await finder('coffee 3.5$');
  ok(fr.some((x) => x.includes('Coffee') && x.includes('3.50')), 'Finder offers to add "coffee 3.5$"');
  const n0 = (await data()).spend.length;
  await page.$eval('.finder-input', (i) => i.focus());
  await page.keyboard.press('Enter'); await sleep(600);
  ok((await data()).spend.length === n0 + 1, 'Enter adds the expense');
  await mod('./js/shell/finder.js', 'closeFinder'); await sleep(200);
  fr = await finder(AR ? 'فواتير' : 'bills');
  ok(fr.some((x) => x.includes('Netflix')), 'Finder "bills" lists the next bills');
  await shot(P + 'wallet-17-finder');
  await mod('./js/shell/finder.js', 'closeFinder'); await sleep(200);
  fr = await finder('Hilton');
  ok(fr.some((x) => x.includes('Hilton') && x.includes('1204')), 'Finder finds a pass by name');
  await page.$$eval('.fr', (n) => n.find((x) => x.textContent.includes('1204'))?.click()); await sleep(900);
  ok(await exists('.app-win .wl-detail .wl-codepanel'), 'a pass result opens its details');
  await h.closeApp();

  // ================================================================ Modes and Routines: Add expense
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  const nameOk = await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => !!A.ACTIONS['wallet.expense'] && !I.t(A.ACTIONS['wallet.expense'].name).startsWith('wallet.')));
  ok(nameOk, 'Routines lists Add expense');
  let s0 = (await data()).spend.length;
  let ra = await runAction('wallet.expense', { amount: '12.5', merchant: 'Uber', cat: 'auto' });
  let lastE = (await data()).spend.find((e) => !spend.some((x) => x.id === e.id) && e.mer === 'Uber' && e.amt === 12.5);
  ok((await data()).spend.length === s0 + 1 && lastE?.cat === 'transport' && lastE.cur === 'USD' && /12[.,]50/.test(ra.v || ''), 'Add expense saves 12.50 at Uber as Transport (automatic category) and returns the amount (' + ra.v + ')');
  ra = await runAction('wallet.expense', { amount: '7', merchant: AR ? 'مكتبة' : 'Bookshop', cat: 'shopping' });
  lastE = (await data()).spend.at(-1);
  ok(lastE?.cat === 'shopping' && lastE.amt === 7, 'a chosen category wins');
  s0 = (await data()).spend.length;
  ra = await runAction('wallet.expense', { amount: '', merchant: 'x' });
  ok(ra.err === 'wallet.ra.errAmount' && (await data()).spend.length === s0, 'no amount is an error and adds nothing');

  // ================================================================ the Quick access widget's settings: pick a card
  await page.evaluate(() => import('./js/shell/home.js').then((m) => { window.__aw = m.addWidget('wallet-pass', 's'); }));
  await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
  const opts = await texts('.ou-dialog .ou-radio-row');
  const liveN = await page.evaluate(() => Promise.all([import('./js/wallet/data.js'), import('./js/wallet/model.js')]).then(([D, M]) => D.data().passes.filter((p) => !M.isExpired(p)).length));
  ok(opts.length === liveN + 1 && liveN >= 6 && /Automatic|تلقائي/.test(opts[0]), 'adding a Quick access widget offers Automatic and the cards that haven’t expired (' + liveN + ')');
  await shot(P + 'wallet-18-widget-config');
  await h.clickText('.ou-dialog .ou-radio-row', 'Hilton');
  await click('.ou-dialog .ou-dialog-btn.primary');
  await page.evaluate(() => window.__aw); await sleep(500);
  const wItem = ((await getStorage('home')).home || []).flat().find((x) => x.widget === 'wallet-pass' && x.config?.pass);
  ok(wItem?.config?.pass === 'p-key', 'the widget keeps the chosen card (' + JSON.stringify(wItem?.config) + ')');
  ok(/Hilton/.test(await text(`#home .tile[data-id="${wItem?.id}"] .wg`) || ''), 'and shows it');
  // Widget settings again → Automatic drops the choice
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__wc = m.getWidget('wallet-pass').configure({ pass: 'p-key' }); }));
  await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
  ok(await page.evaluate(() => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((x) => x.querySelector('input').checked)?.textContent.includes('Hilton')), 'Widget settings starts on the chosen card');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-radio-row').click());
  await click('.ou-dialog .ou-dialog-btn.primary');
  ok(JSON.stringify(await page.evaluate(() => window.__wc)) === '{}', 'Automatic clears it');
};

/** A small solid PNG (no image library needed). */
function makePng(w, h2, [r, g, b]) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, body) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(body.length); c.writeUInt32BE(crc(Buffer.concat([t, body]))); return Buffer.concat([len, t, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
