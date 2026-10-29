// triple — the handle bar's buttons stay clickable where they overlap the corner resize zones (the close button sits
// inside the top corner zone: it showed the resize cursor and a click started a resize instead of closing).
// usage: .dev/run.sh .dev/window-buttons.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, sleep, openApp, shot, P, ui }) => {
  await boot();
  // two windows, so they float as pop-ups (a lone unmoved window keeps the dimmed look but has the same handle)
  await openApp('calculator');
  await openApp('notes');
  await sleep(600);
  const btns = ['hb-close', 'hb-max', 'hb-min', 'hb-split'];
  for (const app of ['notes', 'calculator']) {
    await openApp(app); // focus it
    await sleep(400);
    const win = await page.$(`.app-win[data-app="${app}"]`);
    const wr = await win.boundingBox();
    await page.mouse.move(wr.x + wr.width / 2, wr.y + wr.height / 2); // hover shows the buttons
    await sleep(250);
    for (const cls of btns) {
      const info = await page.evaluate((app, cls) => {
        const b = document.querySelector(`.app-win[data-app="${app}"] .${cls}`);
        if (!b || !b.getClientRects().length) return null;
        const r = b.getBoundingClientRect();
        // every point of the button, including the part over the corner zone, must hit the button
        const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 2, r.bottom - 2], [r.left + 2, r.bottom - 2]];
        // the button group (buttons and the gaps between them) must win over the resize zones under it
        const miss = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !e?.closest('.app-handle-btns') || e.closest('.app-rz'); });
        const cur = getComputedStyle(document.elementFromPoint(r.right - 3, r.top + 3)).cursor;
        return { miss: miss.length, cur };
      }, app, cls);
      if (!info) continue;
      ok(info.miss === 0, `${app}: ${cls} takes the pointer everywhere, not the resize zone (${info.miss} points missed)`);
      ok(!/resize/.test(info.cur), `${app}: ${cls} shows no resize cursor (${info.cur})`);
    }
  }
  // the corners still resize: 14px in from the corner is inside both the 26px zone and the 34px rounded corner
  await openApp('calculator');
  await sleep(300);
  const corners = await page.evaluate(() => {
    const w = document.querySelector('.app-win[data-app="calculator"]').getBoundingClientRect();
    const at = (x, y) => document.elementFromPoint(x, y)?.className || '';
    return { nw: at(w.left + 14, w.top + 14), ne: at(w.right - 14, w.top + 14), sw: at(w.left + 14, w.bottom - 14), se: at(w.right - 14, w.bottom - 14), n: at(w.left + w.width / 2, w.top + 2) };
  });
  const btnSide = (await page.evaluate(() => document.documentElement.dir)) === 'rtl' ? 'nw' : 'ne';
  for (const [k, cls] of Object.entries(corners)) {
    // on the buttons' side the top corner is shared with the close button's edge: either is fine, never the content
    if (k === btnSide) ok(/rz-|hb-|app-handle-btn/.test(cls), `top corner on the buttons' side: resize or button (${cls})`);
    else ok(new RegExp('rz-' + k).test(cls), `corner/edge ${k} still resizes (${cls})`);
  }
  // a real click on close closes the window
  await openApp('notes');
  await sleep(300);
  const nb = await (await page.$('.app-win[data-app="notes"]')).boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await sleep(200);
  const close = await page.evaluate(() => { const r = document.querySelector('.app-win[data-app="notes"] .hb-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(close.x, close.y);
  await sleep(150);
  await shot(P + 'window-buttons-hover');
  await page.mouse.down(); await page.mouse.up();
  await sleep(600);
  ok(!(await page.$('.app-win[data-app="notes"]')), `clicking the close button closes the window (${ui})`);
};
