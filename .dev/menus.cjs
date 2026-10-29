// Every popup menu, dialog and popover stays inside the screen, at 1440×900 and 800×600, in English (LTR) and
// Arabic (RTL). It opens the Home screen menus (empty space near each corner, icons at the edges, folder, widgets,
// dock, Shift+F10), edit mode and its bar, the Add/Edit website, Rename and Folder colour dialogs, the open folder
// and the widget picker; each built-in app's toolbar buttons, row menus, popovers and dialogs (Settings: every
// choice dialog); the Apps screen, Edge panel, Quick Panel and Finder. Runs once (it loops over sizes and
// directions itself) and prints how many popups it checked.   usage: .dev/run.sh .dev/menus.cjs
const SIZES = [[1440, 900], [800, 600]];
const POPS = '.ou-menu, .ou-dialog, .note-colors, .nt-ts-pop, .folder-panel, #edge.show .edge-panel, #finder.show .finder-panel';
const APPS = ['notes', 'reminder', 'calendar', 'clock', 'weather', 'calculator', 'settings'];

module.exports = async ({ page, boot, ok, count, exists, mod, sleep, shot, outside, logs }) => {
  const now = Date.now(), DAY = 864e5;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const site = (id, title) => ({ id, type: 'site', title, url: `https://${title.toLowerCase()}.example.com/` });
  // a full first page, so icons sit at every edge of the grid
  const home = [[
    { id: 'wn', type: 'widget', widget: 'notes', size: 's', config: {} },
    site('s1', 'Alpha'), site('s2', 'Beta'), { id: 'an', type: 'app', app: 'notes' },
    { id: 'f1', type: 'folder', title: 'Work', color: '#3e7bff', items: [site('fa', 'Gamma'), site('fb', 'Delta')] },
    { id: 'ac', type: 'app', app: 'calculator' }, site('s3', 'Echo'), site('s4', 'Foxtrot'), site('s5', 'Golf'),
    { id: 'wr', type: 'widget', widget: 'reminder', size: 'm', config: {} },
    site('s6', 'Hotel'), site('s7', 'India'), site('s8', 'Juliet'), site('s9', 'Kilo'),
  ], [site('p2', 'Lima')]];
  const data = {
    home,
    dock: [{ id: 'd1', type: 'app', app: 'calendar' }, { id: 'd2', type: 'app', app: 'clock' }, { id: 'd3', type: 'app', app: 'settings' }, { id: 'd4', type: 'app', app: 'drawer' }],
    edge: [{ id: 'e1', type: 'app', app: 'notes' }, site('e2', 'Mike')],
    notes: [
      { id: 'n1', title: 'Shopping list with a rather long title that keeps going', body: 'Milk<br>Eggs', color: 'yellow', pinned: true, created: now - DAY, updated: now - 3600e3 },
      { id: 'n2', title: 'Ideas', body: 'A long note', color: 'none', pinned: false, created: now - 2 * DAY, updated: now - DAY },
    ],
    reminders: [
      { id: 'r1', title: 'Call Sam', notes: '', due: now + 3600e3, done: false, priority: false, created: now },
      { id: 'r2', title: 'Pay rent', notes: '', due: null, done: true, completedAt: now - 3600e3, priority: true, created: now - DAY },
    ],
    events: [{ id: 'ev1', title: 'Lunch', start: today.getTime() + 12 * 3600e3, end: today.getTime() + 13 * 3600e3, allDay: false, color: '#ff4d6d', notes: '' }],
    alarms: [{ id: 'al1', time: '07:30', days: [1, 2, 3, 4, 5], label: 'Work', enabled: true }],
  };

  let total = 0, fails = 0, cur = '';
  const per = {};
  const t = (k) => mod('./js/core/i18n.js', 't', k);
  // every visible popup must lie inside the viewport; returns how many were open
  const check = async (tag, need = 1) => {
    await sleep(320);
    const n = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => {
      if (el.closest('.closing')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length, POPS);
    const bad = n ? await outside(POPS) : [];
    total += n;
    per[cur] = (per[cur] || 0) + n;
    if (n < need) { ok(false, `${cur} ${tag}: expected a popup, none open`); fails++; }
    else if (bad.length) {
      fails++;
      const where = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return `${el.className.split(' ')[0]} [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`; }).join(' '), POPS);
      ok(false, `${cur} ${tag}: popup outside the ${innerW}×${innerH} screen: ${where}`);
      await shot(`menus-fail-${fails}`);
    } else if (n) ok(true, `${cur} ${tag}: ${n} popup${n > 1 ? 's' : ''} inside`);
    return n;
  };
  let innerW = 0, innerH = 0;
  // close whatever is open on top: menus and dialogs with Esc, popovers by tapping their scrim
  const dismiss = async () => {
    for (let i = 0; i < 5; i++) {
      const top = await page.evaluate(() => {
        const s = [...document.querySelectorAll('.ou-menu-scrim, .ou-dialog-scrim, .folder-scrim')].filter((x) => !x.classList.contains('closing')).at(-1);
        return s ? (s._close || s.classList.contains('ou-dialog-scrim') || s.classList.contains('folder-scrim') ? 'esc' : 'tap') : null;
      });
      if (!top) return;
      if (top === 'tap') await page.mouse.click(3, 3);
      else await page.keyboard.press('Escape');
      await sleep(330);
    }
  };
  const center = (sel) => page.evaluate((s) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  const rclick = async (sel, tag, scroll = false) => {
    if (scroll) await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
    const c = await center(sel);
    if (!c) { ok(false, `${cur} ${tag}: ${sel} not found`); fails++; return; }
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await check(tag);
    await dismiss();
  };
  const clickSel = async (sel) => { const c = await center(sel); if (c) await page.mouse.click(c.x, c.y); await sleep(350); return !!c; };
  // pick a menu item by its label
  const pick = async (label) => { const done = await page.evaluate((l) => { const b = [...document.querySelectorAll('.ou-menu .ou-menu-item')].find((x) => x.textContent.trim() === l); b?.click(); return !!b; }, label); await sleep(400); return done; };
  // empty Home screen space nearest each corner of the page area
  const emptyCorners = () => page.evaluate(() => {
    const vp = document.querySelector('#home .pages-viewport').getBoundingClientRect();
    const free = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('#home') && !el.closest('.tile, button, input, .home-search, .dock, .page-dots'); };
    const out = [];
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      let best = null;
      for (let d = 6; d < Math.min(vp.width, vp.height) / 2 && !best; d += 10) {
        for (const [x, y] of [[cx ? vp.right - d : vp.left + d, cy ? vp.bottom - 6 : vp.top + 6], [cx ? vp.right - 6 : vp.left + 6, cy ? vp.bottom - d : vp.top + d], [cx ? vp.right - d : vp.left + d, cy ? vp.bottom - d : vp.top + d]]) {
          if (free(x, y)) { best = { x, y }; break; }
        }
      }
      if (best) out.push(best);
    }
    return out;
  });
  const reopen = async (id) => { if (!(await exists('.app-win'))) { await page.evaluate((a) => import('./js/core/apps.js').then((m) => m.openApp(a)), id); await sleep(800); } };
  const depth = () => count('.app-win .app-page');
  // click every toolbar action of the app's top page; check what opens; come back
  const toolbar = async (app, tag) => {
    const n = await page.evaluate(() => [...document.querySelectorAll('.app-win .app-page')].at(-1)?.querySelectorAll('.app-toolbar-actions button').length || 0);
    for (let i = 0; i < n; i++) {
      const d0 = await depth();
      const c = await page.evaluate((i) => { const b = [...document.querySelectorAll('.app-win .app-page')].at(-1)?.querySelectorAll('.app-toolbar-actions button')[i]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: b.title }; }, i);
      if (!c) continue;
      await page.mouse.click(c.x, c.y);
      await check(`${tag} toolbar "${c.t}"`, 0);
      await dismiss();
      while (await exists('.app-win') && (await depth()) > d0) { await clickSel('.app-win .app-page:last-child .app-back'); await sleep(200); }
      await reopen(app);
    }
  };

  for (const [W, H] of SIZES) {
    for (const lang of ['en', 'ar']) {
      innerW = W; innerH = H;
      cur = `${W}×${H} ${lang}`;
      await page.setViewport({ width: W, height: H });
      await boot({ settings: { lang, location: { name: 'Cairo', lat: 30.04, lon: 31.24 } }, data });
      ok(await page.evaluate(() => innerWidth) === W, `${cur}: viewport set`);

      // ——— Home screen ———
      const corners = await emptyCorners();
      ok(corners.length >= 2, `${cur}: found empty space near the corners (${corners.length})`);
      for (const [i, p] of corners.entries()) {
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await check(`home menu @corner${i}`);
        if (i === corners.length - 1) await shot(`menus-${W}-${lang}-01-home-menu`);
        await dismiss();
      }
      // One UI opens a pointer menu towards the inside of the reading direction (left of the pointer in Arabic) and
      // flips only when it doesn't fit
      const rtl = lang === 'ar';
      const menuAt = async (x, y) => {
        await page.evaluate((x, y) => import('./js/core/ui.js').then((m) => { m.menu({ clientX: x, clientY: y }, [{ label: 'One' }, { label: 'Two' }]); }), x, y);
        await sleep(300);
        const r = await page.evaluate(() => { const b = document.querySelector('.ou-menu-scrim:not(.closing) .ou-menu').getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; });
        await dismiss();
        return r;
      };
      const mid = await menuAt(W / 2, H / 3);
      ok(rtl ? Math.abs(mid.r - W / 2) <= 1 : Math.abs(mid.l - W / 2) <= 1, `${cur} a pointer menu opens ${rtl ? 'left' : 'right'} of the pointer (${mid.l}–${mid.r})`);
      const edge = await menuAt(rtl ? 40 : W - 40, H / 3);
      ok(rtl ? Math.abs(edge.l - 40) <= 1 : Math.abs(edge.r - (W - 40)) <= 1, `${cur} near the ${rtl ? 'left' : 'right'} edge it flips to the other side (${edge.l}–${edge.r})`);
      // a long choose() list scrolls by itself: Cancel and Done stay on screen
      await page.evaluate(() => import('./js/core/ui.js').then((m) => { window.__ch = m.choose('Pick one', Array.from({ length: 40 }, (_, i) => ({ value: 'v' + i, label: 'Option ' + i, sub: i % 3 ? '' : 'More text' })), 'v30'); }));
      await sleep(450);
      const ch = await page.evaluate(() => {
        const d = document.querySelector('.ou-dialog.ou-choose'), list = d.querySelector('.ou-radio-list');
        const hit = [...d.querySelectorAll('.ou-dialog-btn')].every((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.ou-dialog-btn') === b; });
        const sel = d.querySelector('input:checked').closest('.ou-radio-row').getBoundingClientRect(), lr = list.getBoundingClientRect();
        return { hit, scrolls: list.scrollHeight > list.clientHeight + 10, dialogScroll: d.scrollHeight > d.clientHeight + 1, selShown: sel.top >= lr.top - 1 && sel.bottom <= lr.bottom + 1 };
      });
      ok(ch.hit && ch.scrolls && !ch.dialogScroll, `${cur} choose(): only the list scrolls, Cancel and Done stay visible ${JSON.stringify(ch)}`);
      ok(ch.selShown, `${cur} choose(): the current choice is scrolled into view`);
      const corners2 = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.ou-dialog.ou-choose .ou-dialog-btn + .ou-dialog-btn')); return { tl: parseFloat(cs.borderTopLeftRadius), tr: parseFloat(cs.borderTopRightRadius), bl: parseFloat(cs.borderBottomLeftRadius), br: parseFloat(cs.borderBottomRightRadius) }; });
      ok(rtl ? corners2.tr === 0 && corners2.br === 0 && corners2.tl > 0 && corners2.bl > 0 : corners2.tl === 0 && corners2.bl === 0 && corners2.tr > 0 && corners2.br > 0,
        `${cur} the second dialog button is square on its divider side and round outside ${JSON.stringify(corners2)}`);
      await check('long choose() list');
      if (H === 600) await shot(`menus-${W}-${lang}-00-choose`);
      await page.click('.ou-dialog.ou-choose .ou-dialog-btn.primary');
      ok((await page.evaluate(() => window.__ch)) === 'v30', `${cur} choose(): Done returns the choice`);
      await sleep(300);
      for (const id of ['s1', 'f1', 's5', 's9', 'wn', 'wr', 'ac']) await rclick(`#home .tile[data-id="${id}"]`, `item menu ${id}`);
      for (const id of ['d1', 'd4']) await rclick(`#home .dock .tile[data-id="${id}"]`, `dock menu ${id}`);
      for (const id of ['s9', 'd4']) {
        await page.focus(`#home .tile[data-id="${id}"]`);
        await page.keyboard.down('Shift'); await page.keyboard.press('F10'); await page.keyboard.up('Shift');
        await check(`Shift+F10 on ${id}`);
        if (id === 'd4') await shot(`menus-${W}-${lang}-02-dock-key-menu`);
        await dismiss();
      }
      // dialogs from the menus
      const L = {};
      for (const k of ['home.addSite', 'home.widgets', 'home.edit', 'common.edit', 'common.rename', 'home.folderColor']) L[k] = await t(k);
      const fromHome = async (label, tag, need = 1) => {
        const p = corners[0];
        await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(300);
        await pick(label);
        await sleep(400);
        await check(tag, need);
      };
      await fromHome(L['home.addSite'], 'Add website dialog'); await dismiss();
      await fromHome(L['home.widgets'], 'widget picker');
      await shot(`menus-${W}-${lang}-03-picker`);
      await dismiss();
      const fromItem = async (sel, label, tag) => {
        const c = await center(sel);
        await page.mouse.click(c.x, c.y, { button: 'right' }); await sleep(300);
        await pick(label);
        await check(tag);
        await dismiss();
      };
      await fromItem('#home .tile[data-id="s9"]', L['common.edit'], 'Edit website dialog');
      await fromItem('#home .tile[data-id="f1"]', L['common.rename'], 'Rename folder dialog');
      await fromItem('#home .tile[data-id="f1"]', L['home.folderColor'], 'Folder colour dialog');
      await clickSel('#home .tile[data-id="f1"]');
      await check('open folder');
      const fi = await center('.folder-panel .folder-items .tile:last-child');
      await page.mouse.click(fi.x, fi.y, { button: 'right' });
      await check('folder item menu', 2);
      await shot(`menus-${W}-${lang}-04-folder-menu`);
      await dismiss();
      // edit mode
      await fromHome(L['home.edit'], 'edit mode', 0);
      ok((await outside('#home .edit-bar')).length === 0 && await exists('body.home-edit'), `${cur} edit bar inside the screen`);
      await shot(`menus-${W}-${lang}-05-edit`);
      await page.evaluate(() => document.querySelectorAll('#home .edit-bar .edit-btn')[1].click());
      await check('edit bar: widget picker'); await dismiss();
      await page.evaluate(() => document.querySelectorAll('#home .edit-bar .edit-btn')[2].click());
      await check('edit bar: Add website'); await dismiss();
      await page.click('#home .edit-bar .edit-done'); await sleep(300);

      // ——— built-in apps ———
      for (const app of APPS) {
        await page.evaluate((a) => import('./js/core/apps.js').then((m) => m.openApp(a)), app);
        await page.waitForFunction(() => document.querySelector('.app-win .app-body')?.childElementCount, { timeout: 8000 }).catch(() => {});
        await sleep(700);
        const tag = app;
        if (app === 'notes') {
          await rclick('.app-win .note-card', 'notes: note menu', true);
          await clickSel('.note-card');
          await sleep(300);
          // editor buttons: pin, delete, more…
          const btns = await page.evaluate(() => [...document.querySelectorAll('.note-top .ou-icon-btn')].map((b) => b.title));
          ok(btns.length >= 3, `${cur} notes: editor toolbar (${btns.length})`);
          // the Text style popover (paragraph style, size, text colour, highlight) from the formatting bar
          await page.evaluate(() => { const d = document.querySelector('.note-body, [contenteditable="true"]'); d?.focus(); });
          await clickSel('.note-fmt[data-cmd="style"]');
          await check('notes: text style popover');
          await shot(`menus-${W}-${lang}-06-note-style`);
          // Esc closes the popover, not the app
          await page.keyboard.press('Escape'); await sleep(400);
          ok(!(await exists('.nt-ts-pop')) && await exists('.app-win'), `${cur} notes: Esc closes the text style popover and keeps Notes open`);
          await dismiss(); await reopen('notes');
          if (!(await exists('.note-top'))) { await clickSel('.note-card'); await sleep(300); }
          await clickSel('.note-top .ou-icon-btn:last-child');
          await check('notes: editor ⋮ menu');
          await dismiss();
        }
        if (app === 'reminder') {
          // reminders live in the list pages behind the main page's tiles (Today / Scheduled / All / Completed)
          const TOP = '.app-win .app-page:last-child';
          await clickSel(`${TOP} .rem-cat[data-view="all"]`); await sleep(650);
          await rclick(`${TOP} .rem-item`, 'reminder: item menu', true);
          await page.evaluate(() => [...document.querySelectorAll('.app-win .app-page:last-child .app-back')].pop()?.click()); await sleep(500);
          await clickSel(`${TOP} .rem-cat[data-view="completed"]`); await sleep(650);
          await clickSel(`${TOP} .app-toolbar-actions .ou-icon-btn`);
          await check('reminder: Completed ⋮ menu (Delete all completed)');
          await dismiss();
        }
        if (app === 'calendar') {
          await rclick('.app-win .cal-item', 'calendar: event menu', true);
          await clickSel('.cal-fab');
          await check('calendar: new event dialog');
          await shot(`menus-${W}-${lang}-07-event`);
          await dismiss();
          await clickSel('.cal-item');
          await check('calendar: edit event dialog');
          await dismiss();
        }
        if (app === 'clock') {
          await rclick('.app-win .clk-alarm', 'clock: alarm menu', true);
          await clickSel('.clk-alarm');
          await check('clock: edit alarm dialog');
          await shot(`menus-${W}-${lang}-08-alarm`);
          await dismiss();
          await toolbar('clock', 'clock tab 0');
          const tabs = await count('.clk-tabs .ou-tab');
          for (let i = 1; i < tabs; i++) {
            await page.evaluate((i) => document.querySelectorAll('.app-win .clk-tabs .ou-tab')[i]?.click(), i);
            await sleep(500);
            await toolbar('clock', `clock tab ${i}`);
          }
        }
        if (app === 'settings') {
          const SECTIONS = {
            home: ['set.grid', 'set.iconStyle', 'set.searchBar', 'set.edgeSide', 'home.addSite', 'set.resetHome'],
            lock: ['set.lockMode', 'set.scLeft', 'set.scRight'],
            search: ['set.engine', 'set.ai'],
            general: ['set.language', 'set.timeFormat', 'set.focusLen'],
            weather: ['set.location'],
            backup: ['set.resetAll'],
          };
          for (const [sec, keys] of Object.entries(SECTIONS)) {
            await page.evaluate((s) => import('./js/core/apps.js').then((m) => m.openApp('settings', { params: { page: s } })), sec);
            await sleep(700);
            for (const k of keys) {
              const title = await t(k);
              const c = await page.evaluate((tt) => {
                const r = [...[...document.querySelectorAll('.app-win .app-page')].at(-1).querySelectorAll('button.ou-row')].find((b) => b.querySelector('.ou-row-title')?.textContent.trim() === tt);
                if (!r) return null;
                r.scrollIntoView({ block: 'center' });
                const b = r.getBoundingClientRect();
                return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
              }, title);
              if (!c) { ok(false, `${cur} settings ${sec}: row "${title}" not found`); fails++; continue; }
              await sleep(150);
              await page.mouse.click(c.x, c.y);
              await sleep(300);
              await check(`settings ${sec}: ${k}`);
              if (k === 'set.scLeft') await shot(`menus-${W}-${lang}-09-settings-choice`);
              await dismiss();
              await reopen('settings');
            }
          }
        }
        // then every toolbar button (the app may have moved on: open it again first)
        if (app !== 'clock') {
          await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))); await sleep(200);
          await reopen(app);
          await toolbar(app, tag);
        }
        await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true)));
        await sleep(300);
      }

      // ——— Apps screen, Edge panel, Quick Panel, Finder ———
      await mod('./js/shell/drawer.js', 'openDrawer'); await sleep(600);
      await clickSel('.drawer-more');
      await check('Apps screen ⋮ menu');
      await pick(await t('home.addSite'));
      await check('Apps screen: Add website');
      await dismiss();
      await rclick('.drawer-grid .tile:last-child', 'Apps screen item menu', true);
      await rclick('.drawer-grid .tile', 'Apps screen first item menu', true);
      await mod('./js/shell/drawer.js', 'closeDrawer', true); await sleep(400);

      await mod('./js/shell/edge.js', 'openEdge'); await sleep(600);
      await check('Edge panel');
      await rclick('.edge-panel .edge-item', 'Edge item menu');
      await clickSel('.edge-panel .edge-add');
      await check('Edge: edit dialog', 2);
      await shot(`menus-${W}-${lang}-10-edge-edit`);
      await dismiss();
      await mod('./js/shell/edge.js', 'closeEdge'); await sleep(400);

      await mod('./js/shell/quickpanel.js', 'openQuickPanel'); await sleep(700);
      const mores = await count('#quickpanel .qp-tb-more');
      ok(mores === 2, `${cur} Quick Panel: two tile menus (${mores})`);
      for (let i = 0; i < mores; i++) {
        const c = await page.evaluate((i) => { const b = document.querySelectorAll('#quickpanel .qp-tb-more')[i]; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, i);
        await page.mouse.click(c.x, c.y);
        await check(`Quick Panel tile menu ${i}`);
        await dismiss();
      }
      await mod('./js/shell/quickpanel.js', 'closeQuickPanel'); await sleep(400);

      await mod('./js/shell/finder.js', 'openFinder', 'cal'); await sleep(700);
      await check('Finder');
      await mod('./js/shell/finder.js', 'closeFinder'); await sleep(400);
      console.log(`${cur}: ${per[cur]} popups checked`);
    }
  }
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
  console.log(`menus: ${total} popups checked, ${fails} problems; per run ${JSON.stringify(per)}`);
};
