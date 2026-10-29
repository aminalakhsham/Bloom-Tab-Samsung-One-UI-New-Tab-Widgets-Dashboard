// triple — every registered widget in every size on the Home screen, one page per batch, screenshotted for review.
// Checks each widget renders without throwing, doesn't spill out of its box, and has no text cut off by overflow.
// usage: .dev/run.sh .dev/widgets-gallery.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, sleep, shot, P, logs }) => {
  // 24-hour time, like most of the world (no AM/PM: the case that printed "null")
  await boot({ settings: { hour12: process.env.H12 === '1' } });
  const list = await page.evaluate(() => import('./js/core/widgets.js').then((m) => m.getWidgets().map((w) => ({ id: w.id, sizes: w.sizes }))));
  ok(list.length > 20, `${list.length} widgets registered`);
  // one Home page per batch of widgets: pages are 6×4 cells by default, so lay them out in their own pages
  const items = [];
  for (const w of list) for (const size of w.sizes) items.push({ id: `g-${w.id}-${size}`, type: 'widget', widget: w.id, size, config: {} });
  const pages = [];
  let cur = [], cells = 0;
  const area = { s: 4, m: 8, l: 16, xl: 32 };
  for (const it of items) {
    const a = area[it.size] || 4;
    if (cells + a > 24) { pages.push(cur); cur = []; cells = 0; }
    cur.push(it); cells += a;
  }
  if (cur.length) pages.push(cur);
  await page.evaluate((pages) => chrome.storage.local.set({ home: pages }), pages);
  await sleep(1500);
  const before = logs.length;
  for (let i = 0; i < pages.length; i++) {
    await page.evaluate((i) => import('./js/shell/home.js').then((m) => m.goPage(i, true)), i);
    await sleep(1100);
    const bad = await page.evaluate((ids) => ids.map((id) => {
      const el = document.querySelector(`[data-id="${id}"]`) || document.querySelector(`#${CSS.escape(id)}`);
      if (!el) return id + ': missing';
      const box = el.querySelector('.wg') || el;
      const r = box.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return id + ': no size';
      if (box.querySelector('.wg-missing')) return id + ': unavailable';
      // children that stick out of the widget box by more than 2px
      // allowed to overflow on purpose: the Smart stack's neighbouring cards, the quote's decorative mark, Music's
      // full-bleed cover (all clipped by the widget's rounded box)
      const OK = '.stk-card, .stk-card *, .quote-mark, .wgm-cover, .wgm-cover *';
      const out = [...box.querySelectorAll('*')].filter((c) => {
        if (c.matches(OK)) return false;
        const q = c.getBoundingClientRect();
        if (!q.width || !q.height || getComputedStyle(c).position === 'fixed') return false;
        return q.left < r.left - 2 || q.right > r.right + 2 || q.top < r.top - 2 || q.bottom > r.bottom + 2;
      });
      if (out.length) return id + ': spills (' + [...new Set(out.slice(0, 3).map((c) => c.className || c.tagName))].join(', ') + ')';
      if (!box.textContent.trim() && !box.querySelector('svg, canvas, img')) return id + ': empty';
      // a null/undefined that reached the DOM as text (e.g. replaceChildren(…, null) in 24-hour time)
      if (/\b(null|undefined|NaN)\b/.test(box.innerText)) return id + ': shows "' + box.innerText.match(/\b(null|undefined|NaN)\b/)[0] + '"';
      return null;
    }).filter(Boolean), pages[i].map((x) => x.id));
    for (const b of bad) ok(false, b);
    ok(true, `page ${i + 1}: ${pages[i].length} widgets checked`);
    await shot(`${P}widgets-${String(i + 1).padStart(2, '0')}`);
  }
  ok(!logs.slice(before).some((l) => l.includes('pageerror')), 'no page errors while rendering widgets');
};
