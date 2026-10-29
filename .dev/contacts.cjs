// triple
// Contacts end-to-end: seeds contacts, opens the app (two panes) and checks the large title and count, My profile,
// Favourites, the A–Z sections and the letter index in the UI language's alphabet; the detail page (round actions
// hand off tel:/sms:/mailto:, Favourite), Edit and Create contact (labels, rows, birthday without a year), search in
// any field, selection and delete to the Recycle bin, restore, groups (drawer, add members, create), Manage contacts
// (merge duplicates, export, import a .vcf), settings, the service worker's alarm and Keep in touch notification,
// the widgets, Finder commands and search, the Lock screen chip, and the narrow (phone) layout.
// usage: .dev/run.sh .dev/contacts.cjs   (THEME=dark / UI=ar for the other variants)
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, visible, type, waitFor, mod, getStorage, sleep, shot, P, ui, sw, outside }) => {
  const AR = ui === 'ar', L = (en, ar) => (AR ? ar : en);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const md = (o = 0) => { const d = new Date(now); d.setDate(d.getDate() + o); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const items = [
    { id: 'c1', first: L('Sara', 'سارة'), last: L('Ahmed', 'أحمد'), company: L('Globex', 'شركة النور'), job: L('Designer', 'مصممة'), phones: [{ l: 'mobile', v: '+1 (415) 555-0134' }, { l: 'work', v: '+1 415 555 0199' }], emails: [{ l: 'home', v: 'sara@example.com' }], urls: [{ l: 'homepage', v: 'sara.example.com' }], addrs: [{ l: 'home', street: '1 Market St', city: L('San Francisco', 'الرياض'), zip: '94105', country: L('United States', 'السعودية') }], bday: `1995-${md(3)}`, note: L('Loves chess and coffee.', 'تحب الشطرنج والقهوة.') },
    { id: 'c2', first: L('Omar', 'عمر'), last: L('Haddad', 'حداد'), phones: [{ l: 'mobile', v: '+966 50 123 4567' }], bday: `--${md(0)}` },
    { id: 'c3', first: 'Lina', last: 'Park', emails: [{ l: 'work', v: 'lina@corp.example' }], dates: [{ l: 'anniversary', v: '2015-06-20' }], av: { e: '🦊', c: '#f0934a' } },
    { id: 'c4', first: L('Ahmad', 'أحمد'), last: L('Saleh', 'صالح'), phones: [{ l: 'mobile', v: '+971 55 222 3344' }], related: [{ l: 'brother', v: L('Omar Haddad', 'عمر حداد') }] },
    { id: 'c5', first: 'Zoë', last: 'Müller', emails: [{ l: 'home', v: 'zoe@example.de' }] },
    { id: 'c6', company: 'Acme Corp', isCo: true, phones: [{ l: 'main', v: '800 555 0000' }] },
    { id: 'c7', first: 'Ben', last: 'Clark', phones: [{ l: 'mobile', v: '555 0101' }] },
    { id: 'c8', first: 'ben', last: 'clark', emails: [{ l: 'home', v: 'ben@example.com' }], bday: '1988-01-15' },
    { id: 'c9', first: L('Yusuf', 'يوسف'), last: L('Karim', 'كريم'), phones: [{ l: 'home', v: '020 7946 0000' }] },
    { id: 'c10', first: 'Mia', last: 'Wong', phones: [{ l: 'mobile', v: '+852 5555 1234' }], keep: { n: 2, u: 'w', since: Date.now() - 20 * 864e5 } },
    { id: 'me', first: L('Alex', 'أمين'), last: L('Morgan', 'العلي'), phones: [{ l: 'mobile', v: '+1 555 010 0000' }], emails: [{ l: 'home', v: 'me@example.com' }] },
  ];
  const seed = { v: 1, items, groups: [{ id: 'g1', name: L('Family', 'العائلة'), ids: ['c2', 'c4'] }], favs: ['c1', 'c2', 'c10'], me: 'me', prefs: { sort: 'first', order: 'first', alert: 0, alertTime: '09:00' } };
  const contacts = async () => (await getStorage('contacts')).contacts;
  const byId = async (id) => (await contacts()).items.find((c) => c.id === id);
  // hand-off links, downloads and new tabs are recorded instead of leaving the page
  const stub = () => page.evaluate(() => {
    window.__hand = [];
    window.__opened = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (/^(tel|sms|mailto):/.test(this.href) || this.download) return void window.__hand.push({ href: this.href, download: this.download });
      return click.call(this);
    };
    const co = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return co(b); };
    window.open = (u) => void window.__opened.push(u);
  });
  const hand = () => page.evaluate(() => window.__hand.map((x) => x.href));
  const menuItem = (label) => clickText('.ou-menu-item', label);
  const toastText = () => text('.ou-toast');
  /** Replaces the text of an input, as a user selecting it all and typing would. */
  const fill = async (sel, value) => {
    await page.$eval(sel, (i) => { i.focus(); i.select(); });
    await page.keyboard.type(value);
    await sleep(150);
  };

  await boot({ data: { contacts: seed }, settings: { lockWidgets: ['contacts-birthday'] } });
  await stub();

  // ---------------------------------------------------------------- the list (wide window: two panes)
  await openApp('contacts');
  ok(await exists('.ct.wide .ct-listpane') && await visible('.ct-detailpane'), 'opens with two panes in a wide window');
  ok((await text('.ct-hero-title')) === L('Contacts', 'جهات الاتصال'), 'large "Contacts" title');
  ok(/10/.test(await text('.ct-hero-sub')), 'count under the title (profile not counted): ' + (await text('.ct-hero-sub')));
  ok((await text('.ct-profile .ct-row-name')) === L('Alex Morgan', 'أمين العلي'), 'My profile card at the top');
  ok((await count('.ct-favs .ct-row')) === 3, 'Favourites section with 3 people');
  const secs = await page.evaluate(() => [...document.querySelectorAll('.ct-sec[data-sec]')].map((s) => s.dataset.sec).join(' '));
  ok(secs === L('A B L M O S Y Z', 'ا س ع ي A B L M Z'), 'A–Z sections by first name, the UI alphabet first: ' + secs);
  const idx = await texts('.ct-index button');
  ok(idx[0] === L('A', 'ا') && idx.at(-1) === '#', 'letter index in the UI alphabet: ' + idx.slice(0, 5).join(' ') + ' … ' + idx.at(-1));
  ok(await exists('.ct-row .ct-av-e') && await exists('.ct-row .ct-av-i'), 'avatars: sticker and coloured letter');
  ok((await text('.ct-detailpane .ct-dname')) === L('Ahmad Saleh', 'أحمد صالح') || (await text('.ct-detailpane .ct-dname')) === 'Acme Corp', 'the first contact is shown in the detail pane: ' + (await text('.ct-detailpane .ct-dname')));
  await shot(P + 'contacts-list');

  // the letter index jumps to a section
  const before = await page.evaluate(() => document.querySelector('.ct-scroll').scrollTop);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.ct-index button.has')].pop();
    const r = b.getBoundingClientRect();
    const opt = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
    b.parentElement.dispatchEvent(new PointerEvent('pointerdown', opt));
    b.parentElement.dispatchEvent(new PointerEvent('pointerup', opt));
  });
  await sleep(150);
  ok(await page.evaluate(() => document.querySelector('.ct-scroll').scrollTop) > before, 'the fast-scroll index jumps down the list');
  await page.evaluate(() => (document.querySelector('.ct-scroll').scrollTop = 0));

  // ---------------------------------------------------------------- detail
  await click('.ct-list .ct-sec[data-sec] .ct-row[data-id="c1"]');
  ok((await text('.ct-detailpane .ct-dname')) === L('Sara Ahmed', 'سارة أحمد'), 'clicking a contact shows its detail');
  ok((await count('.ct-detailpane .ct-act')) === 4 && !(await page.evaluate(() => document.querySelector('.ct-detailpane .ct-act').disabled)), 'round Call / Message / Video call / Email buttons');
  await click('.ct-detailpane .ct-act:nth-child(1)');
  ok(await exists('.ou-menu'), 'two numbers: Call asks which one');
  await page.click('.ou-menu-item');
  await sleep(250);
  await click('.ct-detailpane .ct-act:nth-child(4)');
  await click('.ct-detailpane .ct-act:nth-child(3)');
  const h1 = await hand();
  ok(h1.includes('tel:+14155550134') && h1.includes('mailto:sara@example.com'), 'Call and Email hand off tel: and mailto: links: ' + h1.join(' '));
  ok((await page.evaluate(() => window.__opened))[0]?.includes('meet.google.com'), 'Video call opens Google Meet');
  ok((await texts('.ct-detailpane .ct-fval')).some((x) => x.includes('+1 415 555 0199')), 'phone numbers listed in a card');
  ok((await texts('.ct-detailpane .ct-flbl')).some((x) => x.startsWith(L('Birthday', 'تاريخ الميلاد'))), 'birthday row with "in 3 days"');
  await shot(P + 'contacts-detail');
  await clickText('.ct-dbar-btn', L('Favourite', 'المفضلة'));
  ok(!(await contacts()).favs.includes('c1'), 'Favourite toggles off (storage)');
  await clickText('.ct-dbar-btn', L('Favourite', 'المفضلة'));
  ok((await contacts()).favs.includes('c1'), 'and back on');

  // ---------------------------------------------------------------- edit
  await clickText('.ct-dbar-btn', L('Edit', 'تعديل'));
  ok(await exists('.ct-detailpane .ct-edit'), 'Edit opens the form in the detail pane');
  ok((await count('.ct-edit .ct-erow.kind-phones')) === 2 && await exists('.ct-edit .ct-erow.kind-addrs'), 'the form shows phones and, for a full card, the "View more" fields');
  await fill('.ct-edit .ct-ecard input', L('Sarah', 'سارا'));
  await clickText('.ct-eadd', L('Add phone number', 'إضافة رقم هاتف'));
  await page.keyboard.type('555 0000');
  await page.click('.ct-edit .ct-erow.kind-phones:last-of-type .ct-chip');
  await sleep(200);
  await menuItem(L('Work fax', 'فاكس العمل'));
  await shot(P + 'contacts-edit');
  await click('.ct-ebtn.primary');
  let c1 = await byId('c1');
  ok(c1.first === L('Sarah', 'سارا') && c1.phones.length === 3 && c1.phones[2].l === 'workfax' && c1.phones[2].v === '555 0000', 'Save writes the name and the new labelled phone: ' + JSON.stringify(c1.phones));
  ok(await exists('.ct-detailpane .ct-detail') && (await text('.ct-detailpane .ct-dname')).startsWith(L('Sarah', 'سارا')), 'back to the detail after saving');

  // ---------------------------------------------------------------- create
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(2)');
  await sleep(300);
  ok(await exists('.ct-detailpane .ct-edit'), '+ opens Create contact');
  ok(await page.evaluate(() => document.querySelector('.ct-ebtn.primary').disabled), 'Save is off while the form is empty');
  await page.keyboard.type('Nora');
  await clickText('.ct-viewmore', L('View more', 'عرض المزيد'));
  await clickText('.ct-eadd', L('Add event', 'إضافة مناسبة'));
  await clickText('.ct-eadd', L('Add email', 'إضافة بريد إلكتروني'));
  await page.keyboard.type('nora@example.com');
  await click('.ct-ebtn.primary');
  const nora = (await contacts()).items.find((c) => c.first === 'Nora');
  ok(nora && nora.bday === `--${md(0)}` && nora.emails?.[0]?.v === 'nora@example.com', 'new contact saved with a birthday without a year: ' + JSON.stringify(nora));
  ok((await text('.ct-detailpane .ct-dname')) === 'Nora', 'and shown');
  const bd = await page.evaluate(() => import('./js/apps/contacts.js').then((m) => m.upcomingBirthdays(0).map((b) => b.name)));
  ok(bd.includes('Nora') && bd.includes(L('Omar Haddad', 'عمر حداد')), 'upcomingBirthdays(0) is exported for other apps: ' + bd.join(', '));

  // ---------------------------------------------------------------- search in any field
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(3)');
  await sleep(200);
  ok(await visible('.ct-search-in'), 'search opens');
  await page.keyboard.type(L('chess', 'الشطرنج'));
  await sleep(200);
  ok((await texts('.ct-list .ct-row-name')).some((x) => x.startsWith(L('Sarah', 'سارا'))) && (await texts('.ct-list .ct-row-sub')).some((x) => x.includes(L('chess', 'الشطرنج'))), 'search finds a word in the notes and shows the field');
  await fill('.ct-search-in', '1234567');
  ok((await texts('.ct-list .ct-row-name')).some((x) => x.includes(L('Omar', 'عمر'))), 'search by phone digits');
  await fill('.ct-search-in', L('lin', 'لين'));
  await shot(P + 'contacts-search');
  await page.keyboard.press('Escape');
  await sleep(250);
  ok(await exists('.app-win') && !(await exists('.ct-listpane.searching')), 'Esc closes the search, not the app');

  // ---------------------------------------------------------------- select and delete → Recycle bin
  await page.click('.ct-list .ct-sec[data-sec] .ct-row[data-id="c5"]', { button: 'right' });
  await sleep(250);
  await menuItem(L('Select', 'تحديد'));
  ok(await exists('.ct-listpane.selecting'), 'right-click › Select starts selecting');
  await click('.ct-list .ct-sec[data-sec] .ct-row[data-id="c9"]');
  ok(/2/.test(await text('.ct-selcount')), 'two selected: ' + (await text('.ct-selcount')));
  await shot(P + 'contacts-select');
  await clickText('.ct-selact', L('Delete', 'حذف'));
  await sleep(200);
  await click('.ou-dialog-btn.danger');
  await sleep(300);
  let d = await contacts();
  ok(d.trash.length === 2 && !d.items.some((c) => c.id === 'c5' || c.id === 'c9'), 'Delete moves them to the Recycle bin (storage)');
  ok(!(await exists('.ct-listpane.selecting')), 'selection ends');

  // ---------------------------------------------------------------- drawer › Recycle bin › Restore
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(1)');
  await sleep(350);
  ok(await visible('.ct-dw'), '≡ opens the navigation drawer');
  await shot(P + 'contacts-drawer');
  await clickText('.ct-dw-item', L('Recycle bin', 'سلة المحذوفات'));
  await sleep(500);
  ok((await count('.ct-subpage .ct-row')) === 2 && /30/.test(await text('.ct-subpage .ct-row-sub')), 'Recycle bin lists them with days left: ' + (await text('.ct-subpage .ct-row-sub')));
  await shot(P + 'contacts-bin');
  await click('.ct-subpage .ct-row');
  await menuItem(L('Restore', 'استعادة'));
  d = await contacts();
  ok(d.trash.length === 1 && d.items.length === 11, 'Restore puts one back');
  await page.keyboard.press('Escape');
  await sleep(450);

  // ---------------------------------------------------------------- groups
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(1)');
  await sleep(350);
  await clickText('.ct-dw-item', L('Family', 'العائلة'));
  await sleep(500);
  ok((await count('.ct-subpage .ct-row')) === 2, 'a group page lists its members');
  await page.click('.ct-subpage .app-toolbar-actions .ou-icon-btn');
  await sleep(300);
  ok(await exists('.ct-chk-row'), 'Add members shows a checklist');
  await page.click('.ct-chk-row');
  await click('.ou-dialog-btn.primary');
  ok((await contacts()).groups[0].ids.length === 3, 'a member is added (storage)');
  await shot(P + 'contacts-group');
  await page.keyboard.press('Escape');
  await sleep(450);
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(1)');
  await sleep(350);
  await clickText('.ct-dw-item', L('Create group', 'إنشاء مجموعة'));
  await sleep(250);
  await page.keyboard.type(L('Work', 'العمل'));
  await click('.ou-dialog-btn.primary');
  await sleep(700);
  ok(await exists('.ct-chk-row'), 'a new group asks for members');
  await page.click('.ct-chk-row');
  await click('.ou-dialog-btn.primary');
  d = await contacts();
  ok(d.groups.length === 2 && d.groups[1].name === L('Work', 'العمل') && d.groups[1].ids.length === 1, 'Create group with a member (storage)');
  await page.keyboard.press('Escape');
  await sleep(450);

  // ---------------------------------------------------------------- Manage contacts: merge, export, import
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(1)');
  await sleep(350);
  await clickText('.ct-dw-item', L('Manage contacts', 'إدارة جهات الاتصال'));
  await sleep(500);
  ok((await texts('.ct-subpage .ou-row-sub')).includes(L('1 set of duplicates found', 'تم العثور على مجموعة مكررة واحدة')), 'Manage contacts shows the duplicates found');
  await shot(P + 'contacts-manage');
  await clickText('.ct-subpage .ou-row', L('Export contacts', 'تصدير جهات الاتصال'));
  await sleep(600);
  const vcf = await page.evaluate(() => window.__blob?.text());
  ok(vcf && (vcf.match(/BEGIN:VCARD/g) || []).length === 11 && vcf.includes('PRODID:-//Bloom Tab//Contacts//EN'), 'Export saves every contact as one .vcf');
  ok((await page.evaluate(() => window.__hand.at(-1)?.download)) === L('Contacts', 'جهات الاتصال') + '.vcf', 'named Contacts.vcf');
  await clickText('.ct-subpage .ou-row', L('Merge contacts', 'دمج جهات الاتصال'));
  await sleep(500);
  ok((await count('.ct-merge')) === 1, 'Merge contacts lists Ben Clark twice as one set');
  await shot(P + 'contacts-merge');
  await click('.ct-merge .ou-btn.primary');
  d = await contacts();
  const ben = d.items.filter((c) => /ben/i.test(c.first || ''));
  ok(ben.length === 1 && ben[0].phones?.length === 1 && ben[0].emails?.length === 1 && ben[0].bday === '1988-01-15', 'Merge combines their details (storage)');
  ok(await exists('.ct-subpage .ou-empty'), 'nothing left to merge');
  await page.keyboard.press('Escape');
  await sleep(450);
  await page.keyboard.press('Escape');
  await sleep(450);
  ok(await exists('.app-win') && await visible('.ct-bar'), 'Esc goes back page by page to the list');
  const tmp = path.join(os.tmpdir(), `bloom-ct-${process.pid}.vcf`);
  fs.writeFileSync(tmp, ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;Jane;;;', 'FN:Jane Doe', 'TEL;type=CELL:+44 20 7946 0958', 'BDAY:1990-07-04', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8:الحربي;نورة;;;', 'EMAIL;HOME:noura@example.sa', 'END:VCARD'].join('\r\n'));
  await (await page.$('input.ct-file')).uploadFile(tmp);
  await sleep(1200);
  fs.unlinkSync(tmp);
  d = await contacts();
  ok(d.items.some((c) => c.first === 'Jane' && c.bday === '1990-07-04') && d.items.some((c) => c.first === 'نورة' && c.last === 'الحربي'), 'Import reads a .vcf (3.0 and Arabic 2.1)');
  ok(/2/.test(await toastText() || ''), 'import toast: ' + (await toastText()));

  // ---------------------------------------------------------------- settings
  await page.click('.ct-bar .ou-icon-btn:nth-of-type(1)');
  await sleep(350);
  await page.click('.ct-dw-top .ou-icon-btn');
  await sleep(500);
  ok(await exists('.ct-subpage'), 'the drawer gear opens Contacts settings');
  await shot(P + 'contacts-settings');
  await clickText('.ct-subpage .ou-row', L('Sort by', 'الفرز حسب'));
  await sleep(250);
  await page.evaluate(() => [...document.querySelectorAll('.ou-radio-row')][1].click());
  await click('.ou-dialog-btn.primary');
  await clickText('.ct-subpage .ou-row', L('Birthday notifications', 'إشعارات أعياد الميلاد'));
  await sleep(250);
  await page.evaluate(() => [...document.querySelectorAll('.ou-radio-row')][2].click());
  await click('.ou-dialog-btn.primary');
  d = await contacts();
  ok(d.prefs.sort === 'last' && d.prefs.alert === 1, 'Sort by last name and birthday notifications a day before (storage): ' + JSON.stringify(d.prefs));
  await page.keyboard.press('Escape');
  await sleep(450);
  const secs2 = await page.evaluate(() => [...document.querySelectorAll('.ct-sec[data-sec]')].map((s) => s.dataset.sec).join(' '));
  ok(secs2 !== secs && secs2.includes(L('W', 'ح')), 'the list re-sorts by last name: ' + secs2);

  // ---------------------------------------------------------------- notifications: the service worker
  const alarm = await sw.evaluate(() => chrome.alarms.get('contacts:next'));
  ok(alarm && alarm.scheduledTime > Date.now(), 'the service worker plans the next birthday / Keep in touch alarm');
  const bg = (await getStorage('contactsBg')).contactsBg;
  ok(bg?.fired?.c10 > 0, 'Mia’s overdue Keep in touch reminder was shown');
  const notes = (await getStorage('notifications')).notifications || [];
  ok(notes.some((n) => n.app === 'contacts'), 'and listed in the notifications');
  // a notification click opens the contact (#open=contacts&s=<id> → params.section)
  await openApp('contacts', { section: 'c3' });
  ok((await text('.ct-detailpane .ct-dname')) === 'Lina Park', 'params.section opens that contact');
  await closeApp();

  // ---------------------------------------------------------------- Finder, lock chip, widgets
  const cmd = (q) => page.evaluate((q) => import('./js/core/hooks.js').then((m) => m.runCommands(q, () => {}).map((r) => `${r.title} | ${r.sub}`)), q);
  const call = await cmd(L('call omar', 'اتصل بعمر'));
  ok(call.some((x) => x.includes('+966 50 123 4567')), 'Finder: call <name>: ' + call.join(' / '));
  const mail = await cmd(L('email lina', 'راسل Lina'));
  ok(mail.some((x) => x.includes('lina@corp.example')), 'Finder: email <name>: ' + mail.join(' / '));
  const bdays = await cmd(L('birthdays', 'أعياد الميلاد'));
  ok(bdays.length >= 2 && bdays[0].includes(L('Today', 'اليوم')), 'Finder: birthdays: ' + bdays.join(' / '));
  const found = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApp('contacts').search('globex').map((r) => r.title + ' | ' + r.sub)));
  ok(found.length === 1 && /globex/i.test(found[0]) || (AR && found.length === 0), 'Finder search matches any field: ' + found.join(' / '));
  const chip = (locked) => page.evaluate((l) => import('./js/core/hooks.js').then(async (m) => (await m.getLockWidget('contacts-birthday').render({ locked: l }))?.textContent || ''), locked);
  const lockedTxt = await chip(true), openTxt = await chip(false);
  ok(lockedTxt && !lockedTxt.includes(L('Omar', 'عمر')) && !lockedTxt.includes('Nora') && openTxt.includes(L('Omar', 'عمر')) || openTxt.includes('Nora'), `lock chip hides the name while locked: "${lockedTxt}" / "${openTxt}"`);
  await mod('./js/shell/home.js', 'addWidget', 'contacts-favorites', 'm', {});
  await mod('./js/shell/home.js', 'addWidget', 'contacts-birthdays', 'm');
  await mod('./js/shell/home.js', 'addWidget', 'contacts-birthdays', 's');
  await sleep(800);
  ok((await count('.wg-ct-fav .wg-ct-open')) === 3, 'Favourite contacts widget shows the favourites');
  ok((await count('.wg-ct-bday .wg-ct-row')) === 3 && await exists('.wg-ct-bday .wg-ct-one'), 'Upcoming birthdays widget, both sizes');
  await page.evaluate(() => document.querySelector('.wg-ct-fav').closest('.page, [class*="page"]')?.scrollIntoView());
  await shot(P + 'contacts-widgets');
  await page.click('.wg-ct-fav .wg-ct-open');
  await sleep(800);
  ok(await exists('.ct-detailpane .ct-dname'), 'a widget person opens their contact');
  await closeApp();
  // Widget settings: adding the widget from the picker asks who to show (none picked = the favourites)
  await page.evaluate(() => { import('./js/shell/home.js').then((m) => { m.addWidget('contacts-favorites', 's'); }); });
  await sleep(800);
  ok(await count('.ou-dialog .ct-chk-row') >= 8 && await exists('.ou-dialog .ct-wpick-hint'), 'adding the widget asks which contacts to show');
  await shot(P + 'contacts-widget-pick');
  await page.evaluate((names) => names.forEach((n) => [...document.querySelectorAll('.ou-dialog .ct-chk-row')].find((r) => r.textContent.includes(n))?.click()), [L('Ahmad Saleh', 'أحمد صالح'), 'Mia Wong']);
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  await sleep(900);
  ok(JSON.stringify((await getStorage('home')).home).includes('"people":["c4","c10"]'), 'the picked people are saved in the widget');
  const picked = await page.evaluate(() => [...document.querySelectorAll('.wg-ct-fav')].map((w) => [...w.querySelectorAll('.wg-ct-open')].map((b) => b.dataset.id).join()));
  ok(picked.includes('c4,c10') && picked.some((x) => x.split(',').sort().join() === 'c1,c10,c2'), 'the new widget shows them; the first one still shows the favourites: ' + picked.join(' / '));
  // Modes and Routines: Call contact / Send message hand off like the detail page
  const ra = (id, p) => page.evaluate(async (id, p) => {
    const { ACTIONS } = await import('./js/routines/actions.js');
    const { pageCtx } = await import('./js/routines/page.js');
    try { return { ok: await ACTIONS[id].run(pageCtx(), p) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  const lastHand = () => page.evaluate(() => window.__hand.at(-1)?.href);
  const r1 = await ra('contacts.call', { name: L('omar', 'عمر') });
  ok(r1.ok === L('Omar Haddad', 'عمر حداد') && await lastHand() === 'tel:+966501234567', 'Routines: Call contact dials the best match: ' + (await lastHand()));
  const r2 = await ra('contacts.message', { name: 'Mia', text: 'On my way' });
  ok(r2.ok && await lastHand() === 'sms:+85255551234?body=On%20my%20way', 'Routines: Send message opens Messages with the text: ' + (await lastHand()));
  ok((await ra('contacts.call', { name: 'Lina' })).err === 'contacts.ra.noPhone', 'a contact without a number is a readable error');
  ok((await ra('contacts.message', { name: 'Nobody Here' })).err === 'contacts.ra.noMatch', 'and so is a name nobody has');
  ok((await page.evaluate(async () => { const { ACTIONS } = await import('./js/routines/actions.js'); try { await ACTIONS['contacts.call'].run({ page: null }, { name: 'x' }); return ''; } catch (e) { return e.key; } })) === 'routines.err.page', 'they need a page (the worker leaves them for one)');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(700);
  ok(await exists('#lock .lk-w-ct'), 'the next-birthday chip is on the Lock screen');
  await shot(P + 'contacts-lock');

  // ---------------------------------------------------------------- narrow window: phone layout with pushed pages
  await page.setViewport({ width: 720, height: 900 });
  await boot({ data: { contacts: seed } });
  await stub();
  await openApp('contacts');
  ok(!(await exists('.ct.wide')) && !(await visible('.ct-detailpane')), 'a narrow window shows the list only');
  await shot(P + 'contacts-narrow');
  await click('.ct-list .ct-sec[data-sec] .ct-row[data-id="c1"]');
  await sleep(500);
  ok(await exists('.ct-dpage .ct-dname'), 'the detail is pushed as a page');
  ok(!(await outside('.ct-dpage .ct-act, .ct-dpage .ct-dbar-btn', '.app-win')).length, 'actions and the bottom bar fit the window');
  await shot(P + 'contacts-narrow-detail');
  await clickText('.ct-dpage .ct-dbar-btn', L('Edit', 'تعديل'));
  await sleep(500);
  ok(await exists('.ct-epage .ct-edit'), 'Edit is pushed too');
  await fill('.ct-epage .ct-edit .ct-ecard input', 'X');
  await page.click('.ct-epage .app-back');
  await sleep(250);
  ok(await exists('.ou-dialog'), 'back with changes asks to discard');
  await click('.ou-dialog-btn.danger');
  await sleep(450);
  ok(!(await exists('.ct-epage')) && (await byId('c1')).first === L('Sara', 'سارة'), 'Discard leaves the contact unchanged');
  await page.click('.ct-dpage .app-back');
  await sleep(450);
  ok(!(await exists('.ct-dpage')), 'back returns to the list');
  await page.setViewport({ width: 1440, height: 900 });
};
