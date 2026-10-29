// triple — One UI multi window (js/core/apps.js): pop-up windows (open several, focus and z-order, move by the handle,
// resize from a corner, full screen, transparency), minimized pop-ups (round icons on the screen edge: stack, drag,
// restore, Remove), split screen (drag to an edge, the app picker on the other half, the divider: ratio, swap, close),
// Escape order (menu over dialog, sub-page, window), the Home screen taking the focus, sizes remembered per app
// (`appWindows`) across a reload, the app API (ctx.win/page/push/pop/close/setParams/depth/focused, async render and
// cleanup, currentApp/closeApp) and RTL (handle buttons and bubbles mirror in Arabic).
module.exports = async ({ page, boot, ok, openApp, closeApp, sleep, shot, P, ui, store, exists, count, logs, reload }) => {
  const AR = ui === 'ar';
  const A = (fn, ...args) => page.evaluate((fn, args) => import('./js/core/apps.js').then((m) => m[fn](...args)), fn, args);
  const cur = () => A('currentApp');
  const W = await page.evaluate(() => innerWidth), H = await page.evaluate(() => innerHeight);
  const rect = (id) => page.evaluate((id) => {
    const w = document.querySelector(`.app-win[data-app="${id}"]:not(.closing)`);
    if (!w) return null;
    const r = w.getBoundingClientRect(), cs = getComputedStyle(w);
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), z: +w.style.zIndex, cls: w.className, vis: cs.visibility, op: +cs.opacity };
  }, id);
  // a point of the window (or its handle bar) that no other window covers
  const spot = (id, part = 'body') => page.evaluate((id, part) => {
    const w = document.querySelector(`.app-win[data-app="${id}"]:not(.closing)`);
    if (!w) return null;
    const r = w.getBoundingClientRect();
    const ys = part === 'handle' ? [r.top + 11] : Array.from({ length: 12 }, (_, i) => r.top + 40 + (i * (r.height - 80)) / 11);
    for (const y of ys) {
      for (let i = 0; i <= 40; i++) {
        const x = r.left + 30 + (i * (r.width - 60)) / 40;
        const el = document.elementFromPoint(x, y);
        if (el?.closest('.app-win') !== w) continue;
        if (part === 'handle' ? el.closest('.app-handle') && !el.closest('button') : !el.closest('button, input, textarea, a, [role=button], .app-handle, .app-rz')) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  }, id, part);
  const drag = async (from, to, steps = 10) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
    await sleep(350);
  };
  const press = async (key) => { await page.keyboard.press(key); await sleep(350); };
  const saved = async (id) => ((await store('appWindows')) || {})[id];
  const errors = () => logs.filter((l) => l.includes('pageerror')).length;

  await boot();
  // a probe app to check the app API: async render, ctx, sub-pages, setParams, cleanup
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.registerApp({
    id: 'probe', name: { en: 'Probe', ar: 'مسبار' }, hidden: true, icon: { bg: '#3e7bff', glyph: '<circle cx="12" cy="12" r="6"/>' },
    render: (ctx) => Promise.resolve().then(() => {
      window.__probe = ctx;
      window.__probeParams = [ctx.params];
      ctx.setParams = (p) => window.__probeParams.push(p);
      ctx.page({ title: 'Probe', render: (b) => b.append(Object.assign(document.createElement('input'), { className: 'probe-in ou-input' })) });
      return () => (window.__probeClosed = (window.__probeClosed || 0) + 1);
    }),
  })));

  // ——— 1. one window: centred over the dimmed Home screen, as before multi window ———
  await openApp('notes');
  const n0 = await rect('notes');
  ok(n0 && (await exists('.app-scrim.show')) && (await page.evaluate(() => document.body.classList.contains('app-open'))), 'a lone window dims the Home screen (scrim, body.app-open)');
  ok(Math.abs(n0.x + n0.w / 2 - W / 2) <= 1 && Math.abs(n0.y + n0.h / 2 - H / 2) <= 1, `it sits in the middle (${n0.x},${n0.y} ${n0.w}×${n0.h})`);
  ok((await cur()) === 'notes', 'currentApp() is the open app');
  await shot(P + 'windows-01-single');

  // ——— 2. several windows at once (notes + calculator + music) ———
  await openApp('calculator');
  await openApp('music');
  ok((await count('.app-win')) === 3 && !(await exists('.app-error')), 'Notes, Calculator and Music are open together, without errors');
  ok(!(await exists('.app-scrim.show')) && !(await page.evaluate(() => document.body.classList.contains('app-open'))), 'several windows: no dim, the Home screen stays live (DeX-like)');
  const [rn, rc, rm] = [await rect('notes'), await rect('calculator'), await rect('music')];
  ok(rn.x === n0.x && rn.y === n0.y, 'the first window stays where it was');
  ok(!(rc.x === rm.x && rc.y === rm.y) && !(rn.x === rm.x && rn.y === rm.y), `new windows cascade instead of covering each other (${rc.x},${rc.y} / ${rm.x},${rm.y})`);
  ok(rm.z > rc.z && rc.z > rn.z && (await cur()) === 'music', 'the newest window is on top and focused');
  ok(rm.cls.includes('focused') && !rn.cls.includes('focused'), 'only the focused window is marked focused');
  await shot(P + 'windows-02-three');

  // focus by clicking: the window comes to the front; the others keep running
  const nSpot = await spot('notes');
  ok(!!nSpot, 'a visible part of the Notes window');
  await page.mouse.click(nSpot.x, nSpot.y); await sleep(300);
  ok((await cur()) === 'notes' && (await rect('notes')).z > (await rect('music')).z, 'clicking a window brings it to the front and focuses it');

  // ——— 3. the app API ———
  await openApp('probe', { a: 1 });
  ok(await page.evaluate(() => window.__probe?.win === document.querySelector('.app-win[data-app="probe"]')), 'ctx.win is the window (async render)');
  ok(await page.evaluate(() => window.__probe.focused === true && window.__probe.depth === 1 && window.__probeParams[0].a === 1), 'ctx.focused, ctx.depth and ctx.params');
  await page.click('.app-win[data-app="probe"] .probe-in');
  await page.keyboard.type('still here');
  await openApp('notes');
  ok(await page.evaluate(() => window.__probe.focused === false), 'ctx.focused turns false when another window has the focus');
  await openApp('probe', { b: 2 });
  ok(await page.evaluate(() => window.__probeParams.at(-1)?.b === 2 && document.querySelectorAll('.app-win[data-app="probe"]').length === 1), 'opening an open app focuses it and calls ctx.setParams');
  ok(await page.evaluate(() => document.querySelector('.app-win[data-app="probe"] .probe-in').value === 'still here' && !window.__probeClosed), 'the app kept running in the background (its state is still there)');
  await page.evaluate(() => window.__probe.push({ title: 'Sub', render: (b) => b.append('sub') }));
  await sleep(400);
  ok(await page.evaluate(() => window.__probe.depth === 2), 'ctx.push adds a sub-page');
  // Escape order: a menu opened over a dialog closes alone, then the dialog, then the sub-page, then the window
  await page.evaluate(() => import('./js/core/ui.js').then((m) => {
    m.dialog({ title: 'Dialog', message: 'Under the menu' });
    setTimeout(() => m.menu({ x: 300, y: 300 }, [{ label: 'One' }, { label: 'Two' }]), 60);
  }));
  await sleep(400);
  await press('Escape');
  ok(!(await exists('.ou-menu-scrim')) && (await exists('.ou-dialog-scrim')), 'Escape closes the menu on top of a dialog, not the dialog');
  await press('Escape');
  ok(!(await exists('.ou-dialog-scrim')) && (await page.evaluate(() => window.__probe.depth === 2)), 'the next Escape closes the dialog; the window keeps its sub-page');
  await press('Escape');
  ok(await page.evaluate(() => window.__probe.depth === 1), 'then Escape goes back from the sub-page');
  await press('Escape');
  ok(!(await exists('.app-win[data-app="probe"]')) && (await page.evaluate(() => window.__probeClosed === 1)), 'then Escape closes the window and runs its cleanup');
  ok((await cur()) === 'notes' && (await count('.app-win')) === 3, 'the window under it gets the focus; the others stay open');

  // ——— 4. move by the handle, resize from a corner (remembered per app) ———
  const hs = await spot('notes', 'handle');
  const before = await rect('notes');
  await drag(hs, { x: hs.x + 120, y: hs.y + 50 });
  const moved = await rect('notes');
  ok(moved.x === before.x + 120 && moved.y === before.y + 50 && moved.w === before.w, `the handle bar moves the window (${before.x},${before.y} → ${moved.x},${moved.y})`);
  let sv = await saved('notes');
  ok(sv && sv.x === moved.x && sv.y === moved.y && sv.w === moved.w, 'the position is saved in appWindows');
  await openApp('calculator'); // raise it
  const c0 = await rect('calculator');
  const corner = { x: c0.x + c0.w - 13, y: c0.y + c0.h - 13 };
  ok(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.app-win[data-app="calculator"] .rz-se'), corner), 'the bottom corner is a resize handle');
  await drag(corner, { x: corner.x + 60, y: corner.y - 120 });
  const c1 = await rect('calculator');
  ok(c1.w === c0.w + 60 && c1.h === c0.h - 120 && c1.x === c0.x && c1.y === c0.y, `dragging the corner resizes (${c0.w}×${c0.h} → ${c1.w}×${c1.h})`);
  sv = await saved('calculator');
  ok(sv && sv.w === c1.w && sv.h === c1.h, 'the size is saved in appWindows');
  await shot(P + 'windows-03-moved-resized');

  // ——— 5. full screen: double-click the handle bar, the button ———
  await page.evaluate(() => document.querySelector('.app-win[data-app="calculator"] .app-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await sleep(400);
  let cm = await rect('calculator');
  ok(cm.cls.includes(' max') && cm.x === 0 && cm.y === 0 && cm.w === W && cm.h === H, 'double-clicking the handle bar makes the window full screen');
  ok(await page.evaluate(() => document.body.classList.contains('app-open') && document.body.classList.contains('app-cover')), 'a full-screen window covers the Home screen (body classes)');
  ok((await saved('calculator'))?.max === true, 'full screen is remembered');
  await shot(P + 'windows-04-full-screen');
  await page.click('.app-win[data-app="calculator"] .hb-max'); await sleep(400);
  cm = await rect('calculator');
  ok(!cm.cls.includes(' max') && cm.w === c1.w && cm.h === c1.h && cm.x === c1.x, 'the Full screen button brings it back to its pop-up size and place');

  // ——— 6. transparency ———
  await page.click('.app-win[data-app="calculator"] .hb-alpha'); await sleep(350);
  ok(await exists('.app-alpha-pop .ou-slider'), 'Transparency shows a slider (One UI pop-up options)');
  await shot(P + 'windows-05-transparency');
  const sl = await page.evaluate(() => { const r = document.querySelector('.app-alpha-pop .ou-slider').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  await page.mouse.click(AR ? sl.x + sl.w * 0.65 : sl.x + sl.w * 0.35, sl.y); await sleep(300);
  const alpha = (await rect('calculator')).op;
  ok(alpha > 0.4 && alpha < 0.75, `the window turns see-through (${alpha})`);
  await press('Escape');
  ok(!(await exists('.app-alpha-pop')) && (await exists('.app-win[data-app="calculator"]')), 'Escape closes the slider, not the window');
  ok(Math.abs(((await saved('calculator'))?.alpha || 1) - alpha) < 0.01, 'transparency is saved');

  // ——— 7. minimize to a floating icon; icons stack; restore; drag; Remove ———
  await openApp('music'); // raise it: its buttons are under Calculator
  await page.click('.app-win[data-app="music"] .hb-min'); await sleep(400);
  const mm = await rect('music');
  ok(mm.cls.includes('minimized') && mm.vis === 'hidden', 'Minimize hides the window (it keeps running)');
  const bub = (id) => page.evaluate((id) => { const b = document.querySelector(`.app-bubble[data-app="${id}"]`); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; }, id);
  const b1 = await bub('music');
  ok(b1 && b1.w === 56 && (b1.x < 20 || b1.x > W - 80), `a round icon waits on the screen edge (${b1?.x},${b1?.y})`);
  ok((await cur()) !== 'music' && (await cur()) !== null, 'the focus moves to the next window');
  await openApp('probe');
  await page.click('.app-win[data-app="probe"] .hb-min'); await sleep(400);
  const b2 = await bub('probe');
  ok(b2 && Math.abs(b2.y - b1.y) >= 56 && (b2.x < W / 2) === (b1.x < W / 2) && (b2.x < W / 2) === AR, `minimized windows stack on the ${AR ? 'left' : 'right'} edge (${b1.y} / ${b2.y})`);
  await shot(P + 'windows-06-bubbles');
  await page.mouse.click(b1.x + 28, b1.y + 28); await sleep(400);
  ok(!(await exists('.app-bubble[data-app="music"]')) && (await rect('music')).vis === 'visible' && (await cur()) === 'music', 'clicking the icon brings the window back, focused');
  // drag the probe's icon across: it sticks to the other edge
  const pb = await bub('probe');
  await drag({ x: pb.x + 28, y: pb.y + 28 }, { x: AR ? W - 200 : 200, y: 300 });
  const pb2 = await bub('probe');
  ok(pb2 && (AR ? pb2.x > W - 80 : pb2.x < 20) && Math.abs(pb2.y - 272) < 3, `a dragged icon sticks to the nearer edge (${pb2?.x},${pb2?.y})`);
  // drop it on Remove: the app closes
  await page.mouse.move(pb2.x + 28, pb2.y + 28);
  await page.mouse.down();
  await page.mouse.move(W / 2, H / 2, { steps: 6 });
  ok(await exists('.app-bubble-remove.show'), 'dragging an icon shows Remove at the bottom');
  await shot(P + 'windows-07-remove');
  await page.mouse.move(W / 2, H - 90, { steps: 6 });
  ok(await exists('.app-bubble-remove.hot'), 'Remove lights up under the icon');
  await page.mouse.up(); await sleep(400);
  ok(!(await exists('.app-bubble')) && !(await exists('.app-win[data-app="probe"]')) && (await page.evaluate(() => window.__probeClosed === 2)), 'dropping the icon on Remove closes the app');

  // ——— 8. split screen: drag to an edge, pick the other app, the divider ———
  const hs2 = await spot('notes', 'handle');
  await page.mouse.move(hs2.x, hs2.y);
  await page.mouse.down();
  await page.mouse.move(W / 2, H / 2, { steps: 5 });
  await page.mouse.move(2, H / 2, { steps: 8 });
  ok(await exists('.app-snap[data-where="l"]'), 'dragging a window to the left edge shows the half it will take');
  await page.mouse.up(); await sleep(450);
  let sn = await rect('notes');
  ok(sn.cls.includes('split-l') && sn.x === 0 && sn.y === 0 && Math.abs(sn.w - (W / 2 - 6)) <= 1 && sn.h === H, `dropped there, it takes the left half (${sn.x},${sn.y} ${sn.w}×${sn.h})`);
  const pk = await page.evaluate(() => { const p = document.querySelector('.app-split-picker'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: Math.round(r.left), n: p.querySelectorAll('.app-pick').length, running: [...p.querySelectorAll('.app-pick.running')].map((b) => b.dataset.app) }; });
  ok(pk && pk.x >= W / 2 && pk.n > 5 && pk.running.includes('music') && pk.running.includes('calculator'), `the other half offers the apps, open ones first (${pk?.running})`);
  await shot(P + 'windows-08-split-picker');
  await page.click('.app-split-picker .app-pick[data-app="music"]'); await sleep(450);
  const sm = await rect('music');
  sn = await rect('notes');
  ok(sm.cls.includes('split-r') && sm.x === W / 2 + 6 && sm.w === W / 2 - 6 && !(await exists('.app-split-picker')), 'picking Music puts it on the right half');
  ok(await exists('.app-divider') && (await exists('.app-split-bg.show')), 'the One UI divider sits between the two apps');
  await shot(P + 'windows-09-split');
  // drag the divider: the ratio snaps to two thirds
  await drag({ x: W / 2, y: H / 2 }, { x: Math.round(W * 0.66), y: H / 2 });
  sn = await rect('notes');
  ok(Math.abs(sn.w - (Math.round(W * 2 / 3) - 6)) <= 1 && (await rect('music')).x === Math.round(W * 2 / 3) + 6, `dragging the divider changes the ratio, snapping to 2/3 (${sn.w})`);
  // click the divider: Swap windows
  await page.click('.app-divider-handle'); await sleep(350);
  const items = await page.evaluate(() => [...document.querySelectorAll('.ou-menu-item')].map((b) => b.textContent.trim()));
  ok(items.length === 4, `the divider's menu: ${items.join(' | ')}`);
  await page.evaluate(() => document.querySelector('.ou-menu-item').click()); await sleep(450);
  sn = await rect('notes');
  ok(sn.cls.includes('split-r') && (await rect('music')).cls.includes('split-l') && sn.x === Math.round(W / 3) + 6, 'Swap windows swaps the sides (and the ratio follows)');
  // Split screen from the handle button: Calculator replaces the app on its side
  await openApp('calculator');
  await page.click('.app-win[data-app="calculator"] .hb-split'); await sleep(450);
  const cs = await rect('calculator');
  ok(cs.cls.includes(AR ? 'split-r' : 'split-l') && (await rect(AR ? 'notes' : 'music')).cls.includes('split') === false, `the Split screen button tiles the window to the ${AR ? 'right' : 'left'} (the app there floats again)`);
  // the divider dragged to the edge closes that side's app; the other one takes the full screen
  await drag({ x: (await page.evaluate(() => document.querySelector('.app-divider').getBoundingClientRect().left + 6)), y: H / 2 }, { x: 3, y: H / 2 });
  // English: Calculator took the left from Music (pair Calculator | Notes); Arabic: the right from Notes (Music | Calculator)
  const leftApp = AR ? 'music' : 'calculator', rightApp = AR ? 'calculator' : 'notes';
  ok(!(await exists(`.app-win[data-app="${leftApp}"]`)) && (await rect(rightApp)).cls.includes(' max') && !(await exists('.app-divider')), 'dragging the divider to the edge closes that app; the other takes the full screen');
  await shot(P + 'windows-10-after-split');

  // ——— 9. the Home screen takes the focus; the Apps screen opens above windows ———
  await page.click(`.app-win[data-app="${rightApp}"] .hb-max`); await sleep(400);
  await openApp(leftApp);
  const home = { x: AR ? W - 30 : 60, y: Math.round(H / 2) };
  ok(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('#app-layer'), home), 'a bit of the Home screen shows between the windows');
  await page.mouse.click(home.x, home.y); await sleep(300);
  ok((await cur()) === null && !(await exists('.app-win.focused')), 'clicking the Home screen takes the focus off the windows (currentApp() is null)');
  await page.keyboard.press('KeyW'); await sleep(500);
  ok(await page.evaluate(() => document.body.classList.contains('finder-open')), 'typing on the Home screen goes to Finder again');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('app-layer')).zIndex === '25'), 'Finder opens above the floating windows');
  await press('Escape'); await press('Escape');
  ok(!(await page.evaluate(() => document.body.classList.contains('finder-open'))) && (await count('.app-win')) === 3, 'Escape closes Finder and leaves the windows alone');
  const open3 = await page.evaluate(() => [...document.querySelectorAll('.app-win')].map((w) => w.dataset.app));
  let back = null, bs = null;
  for (const id of open3) if (!bs && (bs = await spot(id))) back = id;
  await page.mouse.click(bs.x, bs.y); await sleep(300);
  ok((await cur()) === back, `clicking a window gives it the focus back (${back})`);
  // presses inside full-screen overlays (Daily Board, welcome tour, anything marked data-overlay, the Apps screen)
  // are not Home screen clicks: the window keeps the focus
  for (const [attr, label] of [['data-overlay', 'a [data-overlay] layer'], ['class="db"', 'the Daily Board (.db)'], ['class="onb"', 'the welcome tour (.onb)']]) {
    await page.evaluate((a) => document.body.insertAdjacentHTML('beforeend', `<div id="ov-test" ${a} style="position:fixed;inset:0;z-index:500"></div>`), attr);
    await page.mouse.click(home.x, home.y); await sleep(200);
    const kept = (await cur()) === back;
    await page.evaluate(() => document.getElementById('ov-test').remove());
    ok(kept, `a press inside ${label} leaves the window focused`);
  }
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyA'); await page.keyboard.up('Alt'); await sleep(500);
  const dr = await page.evaluate(() => { const r = document.querySelector('#drawer input').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(dr.x, dr.y); await sleep(200);
  ok((await cur()) === back && (await page.evaluate(() => document.body.classList.contains('drawer-open'))), 'a press inside the Apps screen leaves the window focused too');
  await press('Escape');
  ok(!(await page.evaluate(() => document.body.classList.contains('drawer-open'))) && (await count('.app-win')) === 3 && (await cur()) === back, 'Escape closes the Apps screen first, the windows stay');

  // ——— 10. closeApp() closes the focused window; Escape walks down the stack ———
  await closeApp();
  ok(!(await exists(`.app-win[data-app="${back}"]`)) && (await count('.app-win')) === 2, 'closeApp() closes the focused window only');
  const top = await cur();
  await press('Escape');
  ok(!(await exists(`.app-win[data-app="${top}"]`)) && (await count('.app-win')) === 1, 'Escape closes the focused window, then the next');
  await closeApp();
  ok(!(await exists('.app-win')) && !(await page.evaluate(() => document.body.classList.contains('app-open'))), 'all closed: the Home screen is back');

  // ——— 11. remembered across a reload ———
  await reload();
  await openApp('notes');
  const rn2 = await rect('notes');
  ok(rn2.x === moved.x && rn2.y === moved.y && rn2.w === moved.w, `Notes opens where it was left (${rn2.x},${rn2.y})`);
  ok(!(await exists('.app-scrim.show')), 'a window the user placed floats without the dim');
  await openApp('calculator');
  const rc2 = await rect('calculator');
  ok(rc2.w === c1.w && rc2.h === c1.h && Math.abs(rc2.op - alpha) < 0.01, 'Calculator keeps its size and transparency');
  await A('closeAllApps');
  ok(!(await exists('.app-win')), 'closeAllApps closes every window');

  // ——— 12. at most 8 windows ———
  const ids = await page.evaluate(() => import('./js/core/apps.js').then((m) => m.getApps().filter((a) => !a.launch && !a.hidden).map((a) => a.id).slice(0, 9)));
  for (const id of ids) await openApp(id);
  ok((await count('.app-win:not(.closing)')) === 8 && !(await exists(`.app-win[data-app="${ids[0]}"]`)), 'opening a 9th app closes the least recently used window');
  ok((await page.evaluate(() => document.querySelector('.ou-toast')?.textContent || '')).length > 0, 'with a message saying so');
  ok(!(await exists('.app-error')), 'all eight render without errors');
  await shot(P + 'windows-11-eight');
  await A('closeAllApps');

  // ——— 13. RTL: the handle buttons sit at the inline end ———
  await openApp('clock');
  const hb = await page.evaluate(() => {
    const w = document.querySelector('.app-win[data-app="clock"]');
    const pill = w.querySelector('.app-handle-pill').getBoundingClientRect(), close = w.querySelector('.hb-close').getBoundingClientRect(), min = w.querySelector('.hb-min').getBoundingClientRect();
    return { pill: pill.left, close: close.left, min: min.left };
  });
  ok(AR ? hb.close < hb.min && hb.min < hb.pill : hb.close > hb.min && hb.min > hb.pill, `the handle buttons are at the ${AR ? 'left (mirrored)' : 'right'}, Close outermost`);
  await page.hover('.app-win[data-app="clock"] .app-handle'); await sleep(250);
  await shot(P + 'windows-12-handle');
  await closeApp();
  ok(errors() === 0, 'no page errors');
};
