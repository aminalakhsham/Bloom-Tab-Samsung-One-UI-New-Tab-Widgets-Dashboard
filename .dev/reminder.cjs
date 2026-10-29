// triple
// Samsung Reminder end to end: the main page (Today / Scheduled / All / Completed tiles and My categories), the list
// pages (grouped by day / category / aisle), Write a reminder (natural time read and highlighted while typing, chrome
// alarms `reminder:<id>`, "in 2 days at 5pm", repeats, #category and !), categories (add, sort, delete with Undo),
// complete + Undo (a repeating reminder moves on and leaves a completed copy), the row menu, selection mode, dragging
// (custom order, into another category), the detail screen (title, date and time, repeat incl. custom, early alert
// `reminder:<id>~e`, category, Important, subtasks, notes, link, picture in IndexedDB, Mark as complete, delete,
// draft), search, Delete all completed, the widgets, Finder `remind me` and search, the service worker scheduling
// reminders written straight into storage (backup restore), the Routines action, the Now Bar and the Lock screen chip.
// Strings come from t() so it passes in English and Arabic.
// usage: .dev/run.sh .dev/reminder.cjs   (THEME=dark / UI=ar)
const path = require('path');
module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, visible, mod, store, setStorage, sw, sleep, shot, P, ui, outside }) => {
  const ar = ui === 'ar';
  const L = (en, a) => (ar ? a : en);
  const T = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const fmtDue = (ms) => mod('./js/apps/reminder.js', 'fmtDue', ms);
  const now = Date.now(), H = 36e5, D = 864e5, MIN = 60e3;
  const seed = [
    { id: 'r1', title: L('Pay rent', 'دفع الإيجار'), notes: '', due: now - 26 * H, done: false, priority: false, created: now - 5 * D, completedAt: null },
    { id: 'r2', title: L('Call Sam', 'الاتصال بسامي'), notes: L('About the trip', 'بخصوص الرحلة'), due: now + 5 * MIN, done: false, priority: false, created: now - 4 * D, completedAt: null },
    { id: 'r3', title: L('Dentist', 'طبيب الأسنان'), notes: '', due: now + 3 * D, done: false, priority: true, created: now - 3 * D, completedAt: null },
    { id: 'r4', title: L('Read book', 'قراءة كتاب'), notes: '', due: null, done: false, priority: false, created: now - 2 * D, completedAt: null },
    { id: 'r5', title: L('Old task', 'مهمة قديمة'), notes: '', due: now - 2 * D, done: true, priority: false, created: now - 9 * D, completedAt: now - D },
  ];
  const home = [[
    { id: 'wr-s', type: 'widget', widget: 'reminder', size: 's', config: {} },
    { id: 'wr-m', type: 'widget', widget: 'reminder', size: 'm', config: {} },
    { id: 'wr-l', type: 'widget', widget: 'reminder', size: 'l', config: {} },
  ]];
  await boot({ data: { reminders: seed, home, dock: [] } });

  const TOP = '.app-win .app-page:last-child';
  const rems = () => store('reminders');
  const byId = async (id) => (await rems()).find((r) => r.id === id);
  const alarms = () => sw.evaluate(() => chrome.alarms.getAll());
  const alarm = async (id, early) => (await alarms()).find((a) => a.name === 'reminder:' + id + (early ? '~e' : ''));
  const addDays = (t, n = 1) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const eod = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
  const at = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.getTime(); };
  const nextAt = (h, m = 0) => { const x = at(0, h, m); return x > Date.now() ? x : at(1, h, m); };
  const ord = (r) => r.order ?? -(r.created || 0);
  const bySmart = (a, b) => (!!b.priority - !!a.priority) || ((a.due || Infinity) - (b.due || Infinity)) || ((b.created || 0) - (a.created || 0));
  const byDue = (a, b) => ((a.due || Infinity) - (b.due || Infinity)) || (!!b.priority - !!a.priority) || ((b.created || 0) - (a.created || 0));
  const isToday = (r) => !r.done && r.due && r.due < eod(Date.now());
  const VIEWS = { today: isToday, scheduled: (r) => !r.done && r.due, all: (r) => !r.done, completed: (r) => r.done };
  const ORDER = ['today', 'scheduled', 'all', 'completed'];
  const listed = () => page.$$eval(TOP + ' .rem-groups .rem-item', (els) => els.map((e) => e.dataset.id));
  const groups = () => page.$$eval(TOP + ' .rem-group:not(.empty)', (els) => els.map((g) => ({ key: g.dataset.group, ids: [...g.querySelectorAll('.rem-item')].map((e) => e.dataset.id) })));
  // (chrome.storage gives objects back with their keys sorted: compare with sorted keys)
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  const same = (a, b) => stable(a) === stable(b);
  const back = async () => { await page.click(TOP + ' .app-back'); await sleep(450); };
  const openTile = async (v) => { await page.click(`${TOP} .rem-cat[data-view="${v}"]`); await sleep(650); };
  // scroll a row into the middle of its page first: the Write a reminder bar floats over the bottom of the list
  const center = (sel) => page.$eval(sel, (e) => {
    const sc = e.closest('.app-scroll'), r = e.getBoundingClientRect(), b = sc.getBoundingClientRect();
    sc.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
  });
  const row = (id) => `${TOP} .rem-item[data-id="${id}"]`;
  const tap = async (sel) => { await center(sel); await sleep(150); await page.click(sel); };
  const rc = async (sel) => {
    await center(sel);
    await sleep(150);
    const b = await (await page.$(sel)).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    await sleep(250);
  };
  const quickAdd = async (s, { button = false, check } = {}) => {
    await page.$eval(TOP + ' .rem-add-input', (e) => { e.value = ''; e.focus(); });
    await page.keyboard.type(s);
    await sleep(150);
    const chip = await page.$eval(TOP + ' .rem-add-chip', (e) => (e.hidden ? null : e.textContent));
    const marks = await page.$$eval(TOP + ' .rem-add-mirror mark', (els) => els.map((m) => m.textContent));
    const tags = await page.$$eval(TOP + ' .rem-add-tag', (els) => els.map((m) => m.textContent));
    if (check) await check({ chip, marks, tags });
    if (button) await click(TOP + ' .rem-add-btn');
    else await page.keyboard.press('Enter');
    await sleep(400);
    return { chip, marks, tags, r: (await rems())[0] };
  };
  const toastText = () => text('.ou-toast.show > span');
  const undoToast = async () => { await click('.ou-toast.show .ou-toast-action'); await sleep(350); };
  const pickRadio = async (label) => {
    await sleep(250);
    const okd = await clickText('.ou-dialog .ou-radio-row', label);
    await click('.ou-dialog .ou-dialog-btn.primary');
    await sleep(300);
    return okd;
  };
  // (center + mouse moves rather than page.hover: puppeteer's scrollIntoView would also scroll the window's ancestors)
  const drag = async (id, toYof) => {
    await center(row(id));
    await sleep(150);
    const rb = await (await page.$(row(id))).boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await sleep(100);
    const toY = await toYof();
    const g = await (await page.$(row(id) + ' .rem-grip')).boundingBox();
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y + ((toY - y) * i) / 10); await sleep(30); }
    await sleep(100);
    await page.mouse.up();
    await sleep(450);
  };

  // ———————————————————————————————— main page
  await openApp('reminder');
  ok(await exists('.app-win.size-phone .rem-cats'), 'Reminder opens on the main page with its tiles');
  ok((await count(TOP + ' .rem-cat')) === 4, 'four tiles: Today, Scheduled, All, Completed');
  ok(same(await texts(TOP + ' .rem-cat .rem-cat-label'), await Promise.all(ORDER.map((c) => T('rem.' + c)))), 'tile labels');
  const checkCounts = async (tag) => {
    const list = await rems();
    const want = ORDER.map((v) => String(list.filter(VIEWS[v]).length));
    const got = await texts('.app-win .app-page:first-child .rem-cat .rem-cat-count');
    ok(same(got, want), `${tag}: tile counts ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  await checkCounts('seeded');
  ok((await text(TOP + ' .app-hero-sub')) === (await T('rem.summary', { n: seed.filter(isToday).length })), 'subtitle: n due today');
  ok(same(await texts(TOP + ' .rem-catrow:not(.rem-addcat) .ou-row-title'), [await T('rem.cat.default')]) && (await text(TOP + ' .rem-catrow[data-cat="rem"] .rem-catrow-n')) === '4', 'My categories: the default “Reminders” category with its 4 open reminders');
  ok(await exists(TOP + ' .rem-addcat'), 'Add category row');
  ok(await page.evaluate(() => document.activeElement?.classList.contains('rem-add-input')), 'Write a reminder has the focus');
  ok(await page.$eval(TOP + ' .rem-add-btn', (b) => b.disabled), 'send button disabled while empty');
  ok(!!(await alarm('r2')) && !(await alarm('r4')) && !(await alarm('r5')), 'seeded reminders written straight into storage got their alarms from the service worker');
  await shot(P + 'rem-01-home');

  // ———————————————————————————————— list pages
  await openTile('today');
  ok((await text(TOP + ' .app-hero-title')) === (await T('rem.today')), 'Today opens its own page');
  const g1 = await groups();
  ok(same(g1, [{ key: 'overdue', ids: ['r1'] }, { key: 'today', ids: ['r2'] }]), 'Today: Overdue then Today groups ' + JSON.stringify(g1));
  ok(await exists(row('r1') + ' .rem-item-due.overdue'), 'overdue reminder shows its date in red');
  ok((await text(row('r1') + ' .rem-item-due')) === (await fmtDue(seed[0].due)), 'due text uses fmtDue');
  ok(await exists(row('r2') + ' .rem-item-cat'), 'smart views show the category of each reminder');
  await shot(P + 'rem-02-today');
  await back();
  await openTile('scheduled');
  ok(same(await listed(), seed.filter(VIEWS.scheduled).sort(byDue).map((r) => r.id)), 'Scheduled: by date');
  ok((await count(TOP + ' .rem-group:not(.empty)')) >= 3, 'Scheduled groups by day');
  await back();
  await openTile('all');
  ok(same(await groups(), [{ key: 'rem', ids: seed.filter(VIEWS.all).sort((a, b) => ord(a) - ord(b)).map((r) => r.id) }]), 'All: grouped by category, custom order (newest first)');
  ok(await exists(row('r3') + ' .rem-star') && (await exists(row('r3') + ' .rem-check.important')), 'important reminder shows a star');
  await back();
  await openTile('completed');
  ok(same(await listed(), ['r5']) && (await exists(row('r5') + '.done .rem-check.done')), 'Completed: the completed reminder with a filled check');
  ok(!(await exists(TOP + ' .rem-addbar')), 'no Write a reminder bar in Completed');
  await back();

  // ———————————————————————————————— Write a reminder
  const due1 = at(1, 19);
  const q1 = await quickAdd(L('Water plants tomorrow at 7pm', 'سقي النباتات غدا الساعة 7 مساء'), {
    check: async ({ chip, marks }) => {
      ok(chip === (await fmtDue(due1)), 'chip shows tomorrow at 7 PM: ' + chip);
      ok(marks.length >= 2 && marks.some((m) => m.includes(L('tomorrow', 'غدا'))), 'the recognised words are highlighted: ' + JSON.stringify(marks));
      ok(!(await page.$eval(TOP + ' .rem-add-btn', (b) => b.disabled)), 'send button enabled after typing');
      await shot(P + 'rem-03-typing');
    },
  });
  let r = q1.r;
  const wId = r.id;
  ok(r.title === L('Water plants', 'سقي النباتات') && r.due === due1 && r.done === false && r.priority === false && r.created > now && !r.cat, 'saved: title without the time words, due tomorrow 19:00, default category');
  let a = await alarm(wId);
  ok(a && a.scheduledTime === due1, 'chrome alarm reminder:<id> at the due time');
  ok((await toastText()) === (await T('rem.addedAt', { name: await T('rem.cat.default'), when: await fmtDue(due1) })), 'toast: added to Reminders, with the time');
  ok((await page.$eval(TOP + ' .rem-add-input', (e) => e.value)) === '' && !(await visible(TOP + ' .rem-add-chip')), 'field and chip reset');
  const t0 = Date.now();
  r = (await quickAdd(L('Stretch in 2 hours', 'تمدد بعد ساعتين'))).r;
  ok(r.title === L('Stretch', 'تمدد') && Math.abs(r.due - (t0 + 2 * H)) < 10e3, 'relative time: in 2 hours');
  r = (await quickAdd(L('Pay bills in 2 days at 5pm', 'دفع الفواتير بعد يومين الساعة 5 مساء'))).r;
  const billsId = r.id;
  ok(r.title === L('Pay bills', 'دفع الفواتير') && r.due === at(2, 17), 'in 2 days at 5pm keeps the time: ' + new Date(r.due).toString().slice(0, 21));
  const q3 = await quickAdd(L('Buy stamps', 'شراء طوابع'), { button: true });
  r = q3.r;
  const stampsId = r.id;
  ok(r.title === L('Buy stamps', 'شراء طوابع') && r.due === null && q3.chip === null, 'no time: no due date, no chip (added with the button)');
  ok(!(await alarm(r.id)), 'no alarm without a due date');
  const q4 = await quickAdd(L('Take pills every day at 8am', 'تناول الدواء كل يوم الساعة 8 صباحا'), {
    check: async ({ tags }) => { const daily = await T('rem.rep.daily'); ok(tags.some((x) => x.includes(daily)), 'repeat shown while typing: ' + JSON.stringify(tags)); },
  });
  r = q4.r;
  const pillsId = r.id;
  ok(r.title === L('Take pills', 'تناول الدواء') && same(r.repeat, { f: 'd' }) && r.due === nextAt(8), 'every day at 8am: daily repeat from the next 8:00');
  await checkCounts('after adds');

  // ———————————————————————————————— categories
  await click(TOP + ' .rem-addcat');
  await sleep(300);
  ok(await visible('.ou-dialog .rem-catname'), 'Add category asks for a name, colour and icon');
  ok((await outside('.ou-dialog')).length === 0, 'dialog inside the screen');
  await page.type('.ou-dialog .rem-catname', L('Work', 'العمل'));
  await page.click('.ou-dialog .ou-swatch:nth-child(3)');
  await page.click('.ou-dialog .rem-iconpick:nth-child(2)');
  await shot(P + 'rem-04-category');
  await click('.ou-dialog .ou-dialog-btn.primary');
  await sleep(300);
  let cats = (await store('reminderCats'))?.list || [];
  const work = cats.find((c) => c.name === L('Work', 'العمل'));
  ok(work && work.color === '#ff6a3d' && work.icon === 'rmWork', 'category saved with its colour and icon: ' + JSON.stringify(work));
  ok(await exists(`${TOP} .rem-catrow[data-cat="${work?.id}"]`), 'it is listed in My categories');
  const q5 = await quickAdd(L('Prepare slides tomorrow 9am #Work !', 'تحضير العرض غدا الساعة 9 صباحا #العمل !'), {
    check: async ({ marks, tags }) => ok(marks.length >= 3 && tags.length >= 2, 'date, #category and ! are highlighted and shown: ' + JSON.stringify([marks, tags])),
  });
  r = q5.r;
  const slidesId = r.id;
  ok(r.title === L('Prepare slides', 'تحضير العرض') && r.cat === work.id && r.priority === true && r.due === at(1, 9), '#Work files it in Work, ! marks it Important');
  await click(`${TOP} .rem-catrow[data-cat="${work.id}"]`);
  await sleep(650);
  ok((await text(TOP + ' .app-hero-title')) === L('Work', 'العمل') && same(await listed(), [slidesId]), 'the category page lists its reminders');
  r = (await quickAdd(L('Email Tim', 'مراسلة تيم'))).r;
  const emailId = r.id;
  ok(r.cat === work.id && r.due === null, 'Write a reminder inside a category files it there');
  ok(same(await listed(), [emailId, slidesId]), 'custom order: the new one on top');
  // sort by name, then back to custom order
  await click(TOP + ' .app-toolbar-actions .ou-icon-btn');
  await clickText('.ou-menu .ou-menu-item', await T('rem.sortBy'));
  await pickRadio(await T('rem.sort.title'));
  cats = (await store('reminderCats')).list;
  const byName = [[emailId, L('Email Tim', 'مراسلة تيم')], [slidesId, L('Prepare slides', 'تحضير العرض')]].sort((x, y) => x[1].localeCompare(y[1], undefined, { numeric: true, sensitivity: 'base' })).map((x) => x[0]);
  ok(cats.find((c) => c.id === work.id).sort === 'title' && same(await listed(), byName), 'Sort by › Name');
  await click(TOP + ' .app-toolbar-actions .ou-icon-btn');
  await clickText('.ou-menu .ou-menu-item', await T('rem.sortBy'));
  await pickRadio(await T('rem.sort.manual'));
  // drag Email Tim below Prepare slides
  await sleep(200);
  await drag(emailId, async () => { const sb = await (await page.$(row(slidesId))).boundingBox(); return sb.y + sb.height - 4; });
  let list = await rems();
  ok(same(await listed(), [slidesId, emailId]) && ord(list.find((x) => x.id === emailId)) > ord(list.find((x) => x.id === slidesId)), 'dragging by the grip changes the custom order (saved)');
  // complete with Undo
  await tap(row(emailId) + ' .rem-check');
  await sleep(700);
  r = await byId(emailId);
  ok(r.done === true && r.completedAt > now && !(await listed()).includes(emailId), 'tapping the circle completes it and it leaves the list');
  ok((await toastText()) === (await T('rem.completedToast')), 'Completed toast with Undo');
  await undoToast();
  ok((await byId(emailId)).done === false && (await listed()).includes(emailId), 'Undo brings it back');
  await shot(P + 'rem-05-category');
  await back();

  // ———————————————————————————————— All: drag into another category, row menu, selection
  await openTile('all');
  ok(same((await groups()).map((g) => g.key), ['rem', work.id]), 'All groups by category in category order');
  const lastRem = (await groups())[0].ids.at(-1);
  await drag(lastRem, async () => (await (await page.$(`${TOP} .rem-glist[data-group="${work.id}"]`)).boundingBox()).y + 8);
  r = await byId(lastRem);
  ok(r.cat === work.id && (await groups())[1].ids[0] === lastRem, 'dragging a reminder into another category moves it there');
  ok((await toastText()) === (await T('rem.movedTo', { name: L('Work', 'العمل') })), '“Moved to Work” with Undo');
  await undoToast();
  ok(!(await byId(lastRem)).cat, 'Undo moves it back');
  // row menu
  await rc(row(stampsId) + ' .rem-item-text');
  ok(await visible('.ou-menu') && (await count('.ou-menu .ou-menu-item')) === 5 && (await outside('.ou-menu')).length === 0, 'right-click: Mark as complete, Important, Move to, Select, Delete (on screen)');
  await clickText('.ou-menu .ou-menu-item', await T('rem.important'));
  await sleep(300);
  ok((await byId(stampsId)).priority === true && (await exists(row(stampsId) + ' .rem-star')), 'Important from the menu');
  await rc(row(stampsId) + ' .rem-item-text');
  await clickText('.ou-menu .ou-menu-item', await T('rem.moveTo'));
  ok(await pickRadio(L('Work', 'العمل')), 'Move to lists the categories');
  ok((await byId(stampsId)).cat === work.id, 'Move to › Work');
  await rc(row(wId) + ' .rem-item-text');
  await click('.ou-menu .ou-menu-item.danger');
  await sleep(300);
  ok(!(await byId(wId)) && !(await alarm(wId)), 'Delete from the menu removes it and its alarm');
  ok((await toastText()) === (await T('rem.deleted')), 'deleted toast with Undo');
  await undoToast();
  a = await alarm(wId);
  ok((await byId(wId))?.due === due1 && a && a.scheduledTime === due1, 'Undo restores the reminder and its alarm');
  // selection mode
  await rc(row('r4') + ' .rem-item-text');
  await clickText('.ou-menu .ou-menu-item', await T('rem.select'));
  await sleep(300);
  ok(await visible(TOP + ' .rem-selbar') && (await count(TOP + ' .rem-item.sel')) === 1 && !(await visible(TOP + ' .rem-addbar')), 'Select: selection mode with the bottom bar, the bar to write hides');
  await tap(row(billsId) + ' .rem-item-text');
  await sleep(250);
  ok((await text(TOP + ' .app-toolbar-title')) === (await T('rem.nSelected', { n: 2 })), '“2 selected”');
  await shot(P + 'rem-06-select');
  await page.click(TOP + ' .rem-selbar .rem-selbtn:nth-child(2)');
  await sleep(350);
  ok((await byId('r4')).priority && (await byId(billsId)).priority && !(await visible(TOP + ' .rem-selbar')), 'Important for both, selection ends');
  await rc(row('r4') + ' .rem-item-text');
  await clickText('.ou-menu .ou-menu-item', await T('rem.select'));
  await tap(row(billsId) + ' .rem-item-text');
  await sleep(200);
  await page.click(TOP + ' .rem-selbar .rem-selbtn.danger');
  await sleep(350);
  ok(!(await byId('r4')) && !(await byId(billsId)) && !(await alarm(billsId)), 'Delete the selection');
  ok((await toastText()) === (await T('rem.deletedN', { n: 2 })), '“2 deleted” with Undo');
  await undoToast();
  ok(!!(await byId('r4')) && !!(await byId(billsId)) && (await alarm(billsId))?.scheduledTime === at(2, 17), 'Undo restores both (and the alarm)');

  // ———————————————————————————————— repeating reminder: complete moves it on
  await tap(row(pillsId) + ' .rem-check');
  await sleep(700);
  list = await rems();
  r = list.find((x) => x.id === pillsId);
  const copy = list.find((x) => x.from === pillsId);
  const nextPill = addDays(nextAt(8));
  ok(!r.done && r.due === nextPill && same(r.repeat, { f: 'd' }), 'completing a daily reminder moves it to the next day');
  ok(copy && copy.done && !copy.repeat && copy.completedAt > now, 'and leaves a completed copy for Completed (and Health / Journal)');
  ok((await alarm(pillsId))?.scheduledTime === nextPill, 'its alarm moves to the next occurrence');
  ok((await toastText()) === (await T('rem.doneNext', { when: await fmtDue(nextPill) })), 'toast says when it comes next');
  await undoToast();
  list = await rems();
  ok(list.find((x) => x.id === pillsId).due === nextAt(8) && !list.some((x) => x.from === pillsId), 'Undo puts it back');
  await back();

  // ———————————————————————————————— detail screen
  await openTile('today');
  await tap(row('r2') + ' .rem-item-text');
  await sleep(600);
  ok(await visible('.rem-edit .rem-edit-title'), 'clicking a reminder opens its detail screen');
  ok((await page.$eval('.rem-edit-title', (e) => e.value)) === seed[1].title && (await page.$eval('.rem-edit-notes', (e) => e.value)) === seed[1].notes, 'title and notes');
  ok(!(await page.$eval('.rem-edit-pickers', (e) => e.hidden)) && (await visible('.rem-edit-rep')) && (await visible('.rem-edit-early')), 'date and time pickers, Repeat and Early alert shown for a dated reminder');
  await shot(P + 'rem-07-detail');
  await page.$eval('.rem-edit-title', (e) => { e.focus(); e.select(); });
  await page.keyboard.type(L('Call Sam back', 'معاودة الاتصال بسامي'));
  await sleep(450);
  ok((await byId('r2')).title === L('Call Sam back', 'معاودة الاتصال بسامي'), 'title edit saved');
  await page.click('.rem-edit-due .ou-row-text');
  await sleep(350);
  ok((await byId('r2')).due == null && !(await alarm('r2')) && !(await visible('.rem-edit-rep')), 'Date and time off: no due date, no alarm, no Repeat row');
  await page.click('.rem-edit-due .ou-row-text');
  await sleep(350);
  ok((await byId('r2')).due === Math.floor(seed[1].due / MIN) * MIN, 'on again: the pickers\' date and time come back');
  const d2 = new Date(); d2.setDate(d2.getDate() + 2); d2.setHours(8, 15, 0, 0);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.$eval('.rem-edit-pickers input[type=date]', (e, v) => { e.value = v; e.dispatchEvent(new Event('change')); }, ymd(d2));
  await page.$eval('.rem-edit-pickers input[type=time]', (e) => { e.value = '08:15'; e.dispatchEvent(new Event('change')); });
  await sleep(350);
  ok((await byId('r2')).due === d2.getTime() && (await alarm('r2'))?.scheduledTime === d2.getTime(), 'date and time pickers set the due date and move the alarm');
  await page.click('.rem-edit-quick .ou-chip:nth-child(2)');
  await sleep(350);
  const tmr815 = at(1, 8, 15);
  ok((await byId('r2')).due === tmr815, 'the Tomorrow chip keeps the time');
  // repeat: a preset, then custom (every 2 weeks on Monday and Thursday)
  await page.click('.rem-edit-rep');
  ok(await pickRadio(await T('rem.rep.daily')), 'Repeat offers the presets');
  ok(same((await byId('r2')).repeat, { f: 'd' }) && (await text('.rem-edit-rep .ou-row-sub')) === (await T('rem.rep.daily')), 'Repeat › Daily');
  await page.click('.rem-edit-rep');
  await pickRadio(await T('rem.rep.custom'));
  ok(await visible('.ou-dialog .rem-rep'), 'Custom repeat dialog');
  await page.$eval('.ou-dialog .rem-rep-n', (e) => { e.value = '2'; });
  await page.click('.ou-dialog .ou-seg-btn:nth-child(2)');
  const wd = new Date(tmr815).getDay();
  for (const d of [1, 4, wd].filter((x, i, arr) => arr.indexOf(x) === i)) {
    const want = d === 1 || d === 4;
    const on = await page.$eval(`.ou-dialog .rem-rep-day:nth-child(${d + 1})`, (e) => e.classList.contains('on'));
    if (on !== want) await page.click(`.ou-dialog .rem-rep-day:nth-child(${d + 1})`);
  }
  await shot(P + 'rem-08-custom-repeat');
  await click('.ou-dialog .ou-dialog-btn.primary');
  await sleep(350);
  ok(same((await byId('r2')).repeat, { f: 'w', n: 2, days: [1, 4] }), 'custom repeat saved: every 2 weeks on Mon and Thu ' + JSON.stringify((await byId('r2')).repeat));
  await page.click('.rem-edit-early');
  await pickRadio(await T('rem.early.min', { n: 15 }));
  ok((await byId('r2')).early === 15, 'Early alert 15 minutes before');
  const ea = await alarm('r2', true);
  ok(ea && ea.scheduledTime === tmr815 - 15 * MIN, 'early alert alarm reminder:<id>~e 15 minutes before');
  await page.click('.rem-edit-cat');
  await pickRadio(L('Work', 'العمل'));
  ok((await byId('r2')).cat === work.id && (await text('.rem-edit-cat .ou-row-sub')) === L('Work', 'العمل'), 'Category › Work');
  await page.click('.rem-edit-star');
  await sleep(300);
  ok((await byId('r2')).priority === true && (await exists('.rem-edit-star.on')), 'the star marks it Important');
  await center('.rem-sub-new .rem-sub-input');
  await page.click('.rem-sub-new .rem-sub-input');
  await page.keyboard.type(L('Bring passport', 'إحضار جواز السفر'));
  await page.keyboard.press('Enter');
  await page.keyboard.type(L('Book hotel', 'حجز الفندق'));
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.click('.rem-sub:first-child .rem-check');
  await sleep(350);
  ok(same(((await byId('r2')).subs || []).map((s) => [s.title, s.done]), [[L('Bring passport', 'إحضار جواز السفر'), true], [L('Book hotel', 'حجز الفندق'), false]]), 'subtasks added and ticked ' + JSON.stringify((await byId('r2')).subs));
  await center('.rem-edit-notes');
  await page.click('.rem-edit-notes');
  await page.keyboard.press('End');
  await page.keyboard.type(L('. Bring the map', '. أحضر الخريطة'));
  await center('.rem-link-input');
  await page.click('.rem-link-input');
  await page.keyboard.type('example.com/trip');
  await page.keyboard.press('Enter');
  await sleep(400);
  r = await byId('r2');
  ok(r.notes === seed[1].notes + L('. Bring the map', '. أحضر الخريطة') && r.url === 'https://example.com/trip' && (await visible('.rem-link-open')), 'notes and the web page link saved (https:// added)');
  await center('.rem-img-add');
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('.rem-img-add')]);
  await chooser.accept([path.resolve(__dirname, '../icons/icon128.png')]);
  await sleep(900);
  r = await byId('r2');
  const blobSize = r.imgs?.[0] ? await page.evaluate((k) => import('./js/core/blobs.js').then((m) => m.getBlob(k)).then((b) => b?.size || 0), 'reminder:' + r.imgs[0]) : 0;
  ok(r.imgs?.length === 1 && blobSize > 100 && (await count('.rem-imgs .rem-img img')) === 1, 'a picture is added (IndexedDB blob reminder:<id>)');
  await page.$eval(TOP + ' .app-scroll', (e) => (e.scrollTop = 0));
  await shot(P + 'rem-09-detail-filled');
  await page.keyboard.press('Escape');
  await sleep(500);
  ok(!(await exists('.rem-edit')) && (await exists(TOP + ' .rem-groups')), 'Esc goes back to the list');
  await back();
  await openTile('all');
  ok((await count(row('r2') + ' .rem-mi')) >= 5, 'the row shows repeat, early alert, subtasks, picture and link icons');
  await tap(row('r2') + ' .rem-item-text');
  await sleep(600);
  await center('.rem-edit-done');
  await click('.rem-edit-done');
  await sleep(600);
  list = await rems();
  r = list.find((x) => x.id === 'r2');
  ok(!r.done && r.due > tmr815 && [1, 4].includes(new Date(r.due).getDay()) && list.some((x) => x.from === 'r2' && x.done), 'Mark as complete on a repeating reminder: next Monday/Thursday, a completed copy stays');
  ok(!(await exists('.rem-edit')), 'the detail screen closes');
  // delete from the detail screen
  await tap(row('r4') + ' .rem-item-text');
  await sleep(600);
  await page.click(TOP + ' .app-toolbar-actions .ou-icon-btn');
  await sleep(500);
  ok(!(await byId('r4')) && !(await exists('.rem-edit')), 'delete in the detail screen removes it and goes back');
  await undoToast();
  ok(!!(await byId('r4')), 'Undo');
  await back();

  // ———————————————————————————————— a new reminder with details (draft)
  await page.$eval(TOP + ' .rem-add-input', (e) => e.focus());
  await page.keyboard.type(L('Plan trip next month', 'التخطيط للرحلة الشهر القادم'));
  await click(TOP + ' .rem-add-more');
  await sleep(600);
  ok(await visible('.rem-edit-save') && (await page.$eval('.rem-edit-title', (e) => e.value)) === L('Plan trip', 'التخطيط للرحلة'), 'the pencil opens a new reminder with the text read');
  const nm = new Date(); const nmDue = new Date(nm.getFullYear(), nm.getMonth() + 1, Math.min(nm.getDate(), new Date(nm.getFullYear(), nm.getMonth() + 2, 0).getDate()), 9, 0).getTime();
  const nBefore = (await rems()).length;
  await click('.rem-edit-save');
  await sleep(600);
  r = (await rems())[0];
  ok((await rems()).length === nBefore + 1 && r.title === L('Plan trip', 'التخطيط للرحلة') && r.due === nmDue, 'Save adds it: next month at 9:00');

  // ———————————————————————————————— search
  await page.click(TOP + ' .app-toolbar-actions .ou-icon-btn');
  await sleep(500);
  await page.keyboard.type(L('passport', 'جواز'));
  await sleep(300);
  ok((await listed())[0] === 'r2' && (await exists(row('r2') + ' mark')), 'search finds subtasks too, and marks the match (the open one first)');
  await page.$eval('.rem-search-input', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); e.focus(); });
  await page.keyboard.type(L('rent', 'الإيجار'));
  await sleep(300);
  ok((await listed()).includes('r1'), 'search by title');
  await shot(P + 'rem-10-search');
  await page.click(row('r1') + ' .rem-item-text');
  await sleep(600);
  ok((await page.$eval('.rem-edit-title', (e) => e.value)) === seed[0].title, 'a result opens its detail screen');
  await back();
  await back();

  // ———————————————————————————————— Completed: Delete all
  await openTile('completed');
  const doneIds = (await rems()).filter((x) => x.done).map((x) => x.id);
  ok(doneIds.length >= 2 && same((await listed()).sort(), doneIds.slice().sort()), 'Completed lists every completed reminder (with the repeating copies)');
  await click(TOP + ' .app-toolbar-actions .ou-icon-btn');
  await clickText('.ou-menu .ou-menu-item', await T('rem.deleteCompleted'));
  await sleep(300);
  ok(await visible('.ou-dialog') && (await outside('.ou-dialog')).length === 0, 'Delete all asks first');
  await click('.ou-dialog-btn.danger');
  await sleep(400);
  ok((await rems()).every((x) => !x.done) && (await exists(TOP + ' .rem-empty')), 'completed reminders deleted, empty Completed');
  await back();

  // ———————————————————————————————— delete a category (and its reminders) with Undo
  const inWork = (await rems()).filter((x) => x.cat === work.id).map((x) => x.id);
  await rc(`${TOP} .rem-catrow[data-cat="${work.id}"]`);
  await clickText('.ou-menu .ou-menu-item', await T('rem.deleteCat'));
  await sleep(300);
  ok((await text('.ou-dialog .ou-dialog-msg')) === (await T('rem.deleteCatMsg', { n: inWork.length })), 'deleting a category says its reminders go too');
  await click('.ou-dialog-btn.danger');
  await sleep(400);
  ok(!(await store('reminderCats')).list.some((c) => c.id === work.id) && !(await rems()).some((x) => x.cat === work.id) && !(await exists(`${TOP} .rem-catrow[data-cat="${work.id}"]`)), 'category and its reminders deleted');
  await undoToast();
  ok((await store('reminderCats')).list.some((c) => c.id === work.id) && same((await rems()).filter((x) => x.cat === work.id).map((x) => x.id).sort(), inWork.sort()), 'Undo restores both');
  await checkCounts('before closing');
  await closeApp();

  // ———————————————————————————————— widgets
  await sleep(300);
  let pending = (await rems()).filter((x) => !x.done);
  const todayCount = pending.filter(isToday).length;
  const wsel = (id) => `.widget-tile[data-id="${id}"]`;
  ok((await count(`${wsel('wr-s')} .wg-rem-list .rem-item`)) === Math.min(3, pending.length), 'small widget lists up to 3');
  ok((await count(`${wsel('wr-m')} .wg-rem-list .rem-item`)) === Math.min(3, pending.length), 'medium widget lists up to 3');
  ok((await count(`${wsel('wr-l')} .wg-rem-list .rem-item`)) === Math.min(8, pending.length), 'large widget lists up to 8');
  ok((await text(`${wsel('wr-s')} .wg-rem-count`)) === String(pending.length), 'small widget count = pending');
  ok((await text(`${wsel('wr-m')} .wg-rem-count`)) === String(todayCount || pending.length), 'medium widget count = due today');
  const wIds = await page.$$eval(`${wsel('wr-l')} .wg-rem-list .rem-item`, (els) => els.map((e) => e.dataset.id));
  ok(same(wIds, pending.sort(bySmart).slice(0, 8).map((x) => x.id)), 'widget order: Important first, then by date');
  await shot(P + 'rem-11-widgets');
  const first = wIds.find((id) => !pending.find((x) => x.id === id).repeat);
  await page.click(`${wsel('wr-m')} .rem-item[data-id="${first}"] .rem-check`);
  await sleep(500);
  ok((await byId(first)).done === true && !(await exists(`${wsel('wr-l')} .rem-item[data-id="${first}"]`)), 'checking a reminder in a widget completes it, the other widgets update');
  await undoToast();
  ok((await byId(first)).done === false, 'Undo from the widget toast');
  await page.click(`${wsel('wr-m')} .wg-rem-add`);
  await sleep(900);
  ok(await page.evaluate(() => !!document.querySelector('.app-win .rem-cats') && document.activeElement?.classList.contains('rem-add-input')), 'widget + opens Reminder with Write a reminder focused');
  await closeApp();

  // ———————————————————————————————— Finder: remind me + search
  const cmd = await T('finder.cmdRemind');
  await mod('./js/shell/finder.js', 'openFinder', L('remind me to call mom tomorrow at 9am', 'ذكرني بالاتصال بأمي غدًا الساعة 9 صباحًا'));
  // (Finder loads its date parser on first use: wait for the row)
  for (let i = 0; i < 30 && !(await texts('#finder .fr .fr-title')).includes(cmd); i++) await sleep(150);
  ok((await texts('#finder .fr .fr-title')).includes(cmd), 'Finder offers "Create a reminder"');
  await clickText('#finder .fr', cmd);
  await sleep(600);
  r = (await rems())[0];
  ok(r.title.toLowerCase() === L('call mom', 'الاتصال بأمي') && r.due === at(1, 9) && (await alarm(r.id))?.scheduledTime === r.due, 'remind me: title, tomorrow 9 AM and its alarm ' + JSON.stringify([r.title, new Date(r.due).toString().slice(0, 21), (await alarm(r.id))?.scheduledTime === r.due]));
  await mod('./js/shell/finder.js', 'openFinder', seed[0].title);
  await sleep(500);
  const found = (await texts('#finder .fr-head')).includes(await T('app.reminder')) && (await texts('#finder .fr .fr-title')).filter((x) => x === seed[0].title).length >= 2;
  ok(found, 'Finder search lists matching reminders');
  if (found) {
    await clickText('#finder .fr', seed[0].title);
    await sleep(900);
    ok((await page.$eval('.rem-edit-title', (e) => e.value).catch(() => null)) === seed[0].title, 'opening the result opens its detail screen');
    await closeApp();
  } else await mod('./js/shell/finder.js', 'closeFinder');

  // ———————————————————————————————— the service worker schedules what is written straight into storage
  const n2 = Date.now();
  await setStorage({
    reminders: [
      { id: 'x1', title: 'Restored', notes: '', due: n2 + 2 * H, early: 30, done: false, priority: false, created: n2 },
      { id: 'x2', title: 'Daily', notes: '', due: n2 - 2 * H, repeat: { f: 'd' }, done: false, priority: false, created: n2 },
      { id: 'x3', title: 'Done', notes: '', due: n2 + H, done: true, priority: false, created: n2, completedAt: n2 },
    ],
  });
  await sleep(1200);
  const names = (await alarms()).filter((x) => x.name.startsWith('reminder:')).map((x) => [x.name, x.scheduledTime]).sort();
  ok(same(names.map((x) => x[0]), ['reminder:x1', 'reminder:x1~e', 'reminder:x2']), 'backup restore: alarms for the restored reminders only (old ones cleared): ' + JSON.stringify(names.map((x) => x[0])));
  const nx2 = addDays(n2 - 2 * H);
  ok(names[0][1] === n2 + 2 * H && names[1][1] === n2 + 2 * H - 30 * MIN && names[2][1] === nx2, 'at the due time, 30 minutes before, and the next occurrence of an overdue daily reminder');

  // ———————————————————————————————— the service worker rings: early alert, a repeating reminder catches up, Snooze, Done
  const n3 = Date.now(), y2due = n3 - 2 * D - H;
  await setStorage({
    notifications: [],
    reminders: [
      { id: 'y1', title: 'Early bird', notes: '', due: n3 + 2 * H, early: 30, done: false, priority: false, created: n3 },
      { id: 'y2', title: 'Daily pill', notes: '', due: y2due, repeat: { f: 'd' }, done: false, priority: false, created: n3 },
    ],
  });
  await sleep(600);
  await sw.evaluate(() => Promise.all([chrome.alarms.create('reminder:y1~e', { when: Date.now() + 300 }), chrome.alarms.create('reminder:y2', { when: Date.now() + 300 })]));
  await sleep(1800);
  const notes2 = (await store('notifications')) || [];
  const ne = notes2.find((x) => x.ref === 'y1'), ny = notes2.find((x) => x.ref === 'y2');
  ok(ne && ne.title === 'Early bird' && ne.body.startsWith(L('Due at', 'موعده')), 'early alert notification: “Due at …” (' + ne?.body + ')');
  ok(ny && ny.title === 'Daily pill' && ny.app === 'reminder', 'repeating reminder rings');
  r = await byId('y2');
  ok(r.due === addDays(y2due, 2) && (await alarm('y2'))?.scheduledTime === addDays(y2due, 3), 'missed days are skipped: due moves to today’s occurrence, the alarm to tomorrow’s');
  ok((await alarm('y1'))?.scheduledTime === n3 + 2 * H, 'the early alert leaves the main alarm in place');
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('reminder:y2', 1));
  await sleep(600);
  r = await byId('y2');
  ok(r.due === addDays(y2due, 2) && Math.abs(r.snooze - (Date.now() + 10 * MIN)) < 5000 && Math.abs((await alarm('y2'))?.scheduledTime - r.snooze) < 50, 'Snooze on a repeating reminder: rings in 10 minutes, its series stays');
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('reminder:y2', 0));
  await sleep(600);
  list = await rems();
  r = list.find((x) => x.id === 'y2');
  ok(!r.done && !r.snooze && r.due === addDays(y2due, 3) && list.some((x) => x.from === 'y2' && x.done) && (await alarm('y2'))?.scheduledTime === addDays(y2due, 3), 'Mark as done from the notification: next occurrence, a completed copy, alarm moved');
  // the side panel completes by writing done: true; the service worker moves a repeating one on all the same
  await sw.evaluate(async () => {
    const { reminders } = await chrome.storage.local.get('reminders');
    await chrome.storage.local.set({ reminders: reminders.map((x) => (x.id === 'y2' ? { ...x, done: true, completedAt: Date.now() } : x)) });
  });
  await sleep(900);
  list = await rems();
  r = list.find((x) => x.id === 'y2');
  ok(!r.done && r.due === addDays(y2due, 4) && list.filter((x) => x.from === 'y2').length === 2 && (await alarm('y2'))?.scheduledTime === addDays(y2due, 4), 'a repeating reminder marked done straight in storage moves on to its next occurrence');
  await sw.evaluate(() => chrome.notifications.onButtonClicked.dispatch('reminder:y1~e', 0));
  await sleep(600);
  ok((await byId('y1')).done === true && !(await alarm('y1')), 'Mark as done on the early alert completes it and clears its alarm');

  // ———————————————————————————————— Routines › Add reminder, Now Bar, Lock screen chip
  await setStorage({ reminderCats: { list: [{ id: 'rem', name: '', color: '#3e7bff', icon: 'list' }, work] } });
  await sleep(300);
  const act = await page.evaluate(async (title, when, cat) => {
    const { ACTIONS } = await import('./js/routines/actions.js');
    const a = ACTIONS['reminder.add'];
    const { store } = await import('./js/core/store.js');
    const ctx = { env: 'page', get: (k) => store.get(k), set: (k, v) => store.set(k, v), schedule: () => {}, cancel: () => {}, page: {} };
    const out = await a.run(ctx, { title, when, cat, important: true });
    return { keys: a.params.map((p) => p.key), out };
  }, L('Water the garden', 'سقي الحديقة'), L('tomorrow 7pm', 'غدا الساعة 7 مساء'), L('Work', 'العمل'));
  await sleep(500);
  r = (await rems())[0];
  ok(same(act.keys, ['title', 'when', 'in', 'cat', 'important']) && act.out === L('Water the garden', 'سقي الحديقة'), 'Routines action “Add reminder”: title, when, in, category, Important');
  ok(r.title === L('Water the garden', 'سقي الحديقة') && r.due === at(1, 19) && r.cat === work.id && r.priority === true && (await alarm(r.id))?.scheduledTime === r.due, 'the action adds it with its time, category, star and alarm');
  await setStorage({ reminders: [{ id: 'nb', title: L('Stand up', 'الوقوف'), notes: '', due: Date.now() - MIN, done: false, priority: false, created: Date.now() - H }] });
  await sleep(500);
  // (the first poll loads lock.js to know whether the Lock screen hides content; until then the title is hidden)
  const nb = await page.evaluate(() => import('./js/core/activity.js').then(async (m) => {
    m.getActivities();
    await new Promise((res) => setTimeout(res, 200));
    const a = m.getActivities().find((x) => x.id === 'reminder');
    return a && { title: a.title, app: a.app, actions: a.actions.length };
  }));
  ok(nb && nb.title === L('Stand up', 'الوقوف') && nb.app === 'reminder' && nb.actions === 1, 'Now Bar: a reminder that just came due, with Complete');
  await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().find((a) => a.id === 'reminder').actions[0].onClick(new Event('click'))));
  await sleep(400);
  ok((await byId('nb')).done === true, 'Complete from the Now Bar');
  await setStorage({ reminders: [{ id: 'lk', title: 'x', notes: '', due: Date.now() + 5 * MIN, done: false, priority: false, created: Date.now() }] });
  await sleep(400);
  const chip = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.getLockWidget('reminder').render({ locked: true })).then((el) => el?.textContent || null));
  ok(chip === (await T('rem.lw.due', { n: 1 })), 'Lock screen chip: “1 due today”, no titles');

  // ———————————————————————————————— empty states
  await setStorage({ reminders: [] });
  await sleep(400);
  ok((await count('.wg-rem-empty')) === 3, 'widgets show the empty state');
  await openApp('reminder');
  ok((await text(TOP + ' .app-hero-sub')) === (await T('rem.summaryNone')), '“All caught up”');
  await openTile('today');
  ok(await exists(TOP + ' .rem-empty'), 'empty Today');
  await shot(P + 'rem-12-empty');
  await closeApp();
};
