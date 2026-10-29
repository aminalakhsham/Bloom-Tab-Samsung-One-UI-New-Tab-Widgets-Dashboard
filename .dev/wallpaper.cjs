// triple
// Wallpaper and style end to end: the bloom collection (dual presets follow Dark mode), "Set as wallpaper on" Lock /
// Home / both, a separate Lock screen wallpaper, your photos in IndexedDB (older data-URL photos migrate there),
// Dynamic Lock screen (another photo each time the Lock screen shows), deleting a photo, Creative wallpapers from a
// description (English and Arabic words, same input = same wallpaper), Color palette (wallpaper colours, basic
// colours, themed icons), dimming in Dark mode and the live wallpaper pausing behind app windows (Labs keeps it).
// usage: .dev/run.sh .dev/wallpaper.cjs   (THEME=dark / UI=ar too)
const path = require('path'), fs = require('fs');
module.exports = async ({ page, boot, ok, openApp, closeApp, text, count, exists, sleep, shot, P, store, outside, mod, theme, ui, logs }) => {
  const OUT = process.env.OUT || path.join(__dirname, 'shots');
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const S = async () => (await store('settings')) || {};
  const top = '.app-win .app-stack > .app-page:last-child';
  const depth = () => count('.app-win .app-stack > .app-page');
  const state = () => mod('./js/shell/wallpaper.js', 'wallpaperState');
  const row = async (title) => {
    const found = await page.evaluate((sel, t) => {
      const r = [...document.querySelectorAll(sel + ' .ou-row')].find((x) => x.querySelector('.ou-row-title')?.textContent.trim() === t);
      r?.scrollIntoView({ block: 'center' });
      r?.click();
      return !!r;
    }, top, title);
    if (!found) ok(false, `row "${title}" exists`);
    await sleep(450);
    return found;
  };
  /** In the "Set as wallpaper on" dialog: 1 = Lock and Home, 2 = Home screen, 3 = Lock screen. */
  const where = async (n) => {
    await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 3000 }).catch(() => {});
    const opts = await count('.ou-dialog .ou-radio-row');
    ok(opts === 3 && (await text('.ou-dialog .ou-dialog-title')) === (await tr('set.wp.setOn')), `"Set as wallpaper on" asks Lock / Home / both (${opts})`);
    ok((await outside('.ou-dialog')).length === 0, 'that dialog is inside the screen');
    await page.evaluate((i) => document.querySelectorAll('.ou-dialog .ou-radio-row')[i - 1]?.click(), n);
    await page.click('.ou-dialog .ou-dialog-btn.primary');
    await sleep(700);
  };
  const back = async () => { await page.click(top + ' .app-back'); await sleep(450); };
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };
  const blank = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 97) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    return max - min < 6;
  }).length, sel);
  const png = async (name, a, b) => {
    const f = path.join(OUT, `wp-test-${name}.png`);
    const b64 = await page.evaluate(async (a, b) => {
      const c = new OffscreenCanvas(360, 640), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 360, 640);
      gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 360, 640);
      const u = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      return btoa(s);
    }, a, b);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  };

  // ——— an older version's photo (a data URL in chrome.storage) moves to the gallery ———
  const legacy = await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 60), g = c.getContext('2d');
    g.fillStyle = '#ff7a2f'; g.fillRect(0, 0, 40, 60);
    const b = await c.convertToBlob({ type: 'image/png' });
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  });
  await boot({ settings: { wallpaper: { type: 'image' } }, data: { home: [[]], dock: [], wallpaperImage: legacy } });
  await sleep(800);
  let s = await S();
  const migrated = (await store('wallPhotos')) || [];
  ok(s.wallpaper?.type === 'photo' && migrated.length === 1 && s.wallpaper.id === migrated[0] && (await store('wallpaperImage')) === undefined, 'an old data-URL photo moved to the photo gallery (IndexedDB)');
  ok((await page.evaluate(() => import('./js/core/blobs.js').then((m) => m.listBlobs('wallpaper:')))).length === 1, 'its picture is a blob "wallpaper:<id>"');

  await boot({ data: { home: [[]], dock: [] } });
  const presets = await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => m.PRESETS.map((p) => ({ id: p.id, dual: !!p.dual, l: m.presetById(p.id, false).tone, d: m.presetById(p.id, true).tone }))));
  const duals = presets.filter((p) => p.dual);
  ok(presets.length >= 20 && duals.length >= 8, `${presets.length} bloom wallpapers, ${duals.length} with a light and a dark look`);
  ok(duals.every((p) => p.l === 'light' && p.d === 'dark'), 'every dual preset is light in Light mode and dark in Dark mode');
  ok((await page.evaluate(() => import('./js/core/i18n.js').then((i) => import('./js/shell/wallpaper.js').then((m) => m.PRESETS.filter((p) => i.t('wall.' + p.id) === 'wall.' + p.id).length)))) === 0, 'every preset has a name');

  // ——— Wallpaper and style page ———
  await openApp('settings', { page: 'wallpaper' });
  await sleep(600);
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.wallpaper')), 'Wallpaper and style opens');
  ok((await count(top + ' .set-wall-previews .swp')) === 2 && (await count(top + ' .swp .set-wall-thumb canvas')) === 2, 'Lock screen and Home screen previews side by side');
  await shot(P + 'wp-01-main');

  // ——— the gallery ———
  await page.click(top + ' .set-wall-change .ou-btn'); await sleep(700);
  ok((await depth()) === 3 && (await text(top + ' .app-toolbar-title')) === (await tr('set.wallpapers')), '"Change wallpapers" opens the gallery');
  ok((await count(top + ' .set-presets .set-wall-item')) === presets.length, 'gallery lists every bloom wallpaper');
  ok((await blank(top + ' .set-presets canvas')) === 0, 'every thumbnail is painted (no blank canvas)');
  ok((await count(top + ' .set-presets .swp-badge.dual')) === duals.length, 'dual wallpapers carry the Dark mode badge');
  ok(await exists(`${top} .set-presets .set-wall-item[data-id="bloom"].active`), 'the current one (Bloom) is marked');
  await shot(P + 'wp-02-gallery');

  // a dual preset on both screens
  const dual = duals[1].id;
  await page.evaluate((sel, id) => document.querySelector(`${sel} .set-presets [data-id="${id}"]`).click(), top, dual);
  await where(1);
  s = await S();
  ok(s.wallpaper?.type === 'preset' && s.wallpaper.id === dual && !s.lockWallpaper, `"${dual}" set on Lock and Home screens`);
  ok((await text('.ou-toast span')) === (await tr('set.wallpaperSet')), '"Wallpaper set" toast');
  const tone0 = await page.evaluate(() => document.documentElement.dataset.wallTone);
  ok(tone0 === (theme === 'dark' ? 'dark' : 'light'), `dual preset follows ${theme} mode (text tone ${tone0})`);
  const key0 = (await state()).key;
  await page.evaluate((th) => import('./js/core/store.js').then((m) => m.setSetting('theme', th)), theme === 'dark' ? 'light' : 'dark');
  await sleep(500);
  ok((await state()).key !== key0 && (await page.evaluate(() => document.documentElement.dataset.wallTone)) !== tone0, 'switching Dark mode repaints it in its other look');
  await page.evaluate((th) => import('./js/core/store.js').then((m) => m.setSetting('theme', th)), theme);
  await sleep(400);
  ok(await exists(`${top} .set-presets [data-id="${dual}"].active`), 'the gallery marks it');

  // another one on the Home screen only: the Lock screen keeps the first
  const other = presets.find((p) => !p.dual && p.id !== 'bloom').id;
  await page.evaluate((sel, id) => document.querySelector(`${sel} .set-presets [data-id="${id}"]`).click(), top, other);
  await where(2);
  s = await S();
  ok(s.wallpaper?.id === other && s.lockWallpaper?.id === dual, `Home screen only: home "${other}", Lock screen keeps "${dual}"`);
  ok((await state()).key.includes(`"${other}"`), 'the Home screen shows it');
  await closeApp();
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(700);
  ok((await state()).locked && (await state()).key.includes(`"${dual}"`), 'the Lock screen shows its own wallpaper');
  await shot(P + 'wp-03-lock-own');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(700);
  ok(!(await state()).locked && (await state()).key.includes(`"${other}"`), 'unlocking brings the Home screen wallpaper back');

  // ——— your photos ———
  await openApp('settings', { page: 'wallpaper' }); await sleep(500);
  await page.click(top + ' .set-wall-change .ou-btn'); await sleep(700);
  const files = [await png('a', '#ff7a2f', '#ffd166'), await png('b', '#3e7bff', '#22d3ee'), await png('c', '#22b07d', '#c6f08a')];
  const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }).catch(() => null), row(await tr('set.fromPhotos'))]);
  ok(!!fc, 'Choose from your photos opens a file picker');
  if (fc) {
    await fc.accept(files);
    await sleep(1500);
    await where(1);
  }
  const ids = (await store('wallPhotos')) || [];
  s = await S();
  ok(ids.length === 3, 'three photos in the gallery (store wallPhotos)');
  const blobKeys = () => page.evaluate(() => import('./js/core/blobs.js').then((m) => m.listBlobs('wallpaper:')));
  ok((await blobKeys()).filter((k) => ids.some((id) => k === 'wallpaper:' + id)).length === 3, 'their pictures are in IndexedDB, not chrome.storage');
  ok(s.wallpaper?.type === 'photo' && s.wallpaper.id === ids[2] && !s.lockWallpaper, 'the last one is the wallpaper on both screens');
  ok(await until(async () => (await exists('#wall-img.show')) && (await state()).photo === ids[2]), 'photo shown behind the Home screen');
  ok((await count(top + ' .set-photos .set-wall-photo')) === 3 && await exists(top + ' .set-photos .set-wall-dyn'), 'gallery: three photos and a Dynamic Lock screen tile');
  await shot(P + 'wp-04-photos');

  // ——— Dynamic Lock screen ———
  await back();
  await row(await tr('set.wp.dynamic'));
  s = await S();
  ok(s.lockWallpaper?.type === 'shuffle' && s.wallpaper?.id === ids[2], 'Dynamic Lock screen on: the Lock screen shuffles, the Home screen keeps its photo');
  await shot(P + 'wp-05-dynamic');
  await closeApp();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await mod('./js/shell/lock.js', 'lockNow'); await sleep(900);
    seen.push((await state()).photo);
    if (i === 0) await shot(P + 'wp-06-dynamic-lock');
    await mod('./js/shell/lock.js', 'unlock'); await sleep(700);
  }
  ok(seen.every((x) => ids.includes(x)) && seen[0] !== seen[1] && seen[1] !== seen[2], `each time the Lock screen shows, another photo (${seen.map((x) => ids.indexOf(x)).join(' → ')})`);
  ok((await state()).photo === ids[2], 'unlocked: the Home screen photo again');

  // delete a photo
  await openApp('settings', { page: 'wallpaper' }); await sleep(500);
  await page.click(top + ' .set-wall-change .ou-btn'); await sleep(700);
  await page.evaluate((sel, id) => document.querySelector(`${sel} .set-wall-photo[data-id="${id}"] .set-wall-del`).click(), top, ids[0]);
  await sleep(400);
  ok(await exists('.ou-dialog .ou-dialog-btn.danger'), 'deleting a photo asks first');
  await page.click('.ou-dialog .ou-dialog-btn.danger'); await sleep(700);
  ok(((await store('wallPhotos')) || []).length === 2 && !(await blobKeys()).includes('wallpaper:' + ids[0]), 'photo and its picture deleted');
  ok((await S()).lockWallpaper?.type === 'shuffle', 'two photos left: Dynamic Lock screen stays on');

  // ——— Creative wallpaper ———
  const same = await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => JSON.stringify(m.generate('sunset over the ocean', 'waves', 'vivid', 3)) === JSON.stringify(m.generate('sunset over the ocean', 'waves', 'vivid', 3))));
  ok(same, 'same description, style and mood: the same wallpaper');
  const arabic = await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => { const a = m.generate('غابة خضراء', 'blobs', 'calm', 1), b = m.generate('بحر أزرق', 'blobs', 'calm', 1); return [a.light.bg.join(), b.light.bg.join(), !!a.dark.blobs?.length]; }));
  ok(arabic[0] !== arabic[1] && arabic[2], 'Arabic words pick their own colours (غابة vs بحر)');
  const hills = await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => { const g = m.generate('desert dunes at dusk', 'hills', 'vivid', 0); return [g.light.hills?.length, g.dark.hills?.length, g.light.tone, g.dark.tone]; }));
  ok(hills[0] === 4 && hills[1] === 4 && hills[3] === 'dark', `hills style: four hills in both looks (${hills.join(', ')})`);
  await row(await tr('set.wp.creativeMake'));
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.wp.creative')), 'Creative wallpaper page opens');
  await page.click(top + ' .set-gen-input', { clickCount: 3 });
  await page.keyboard.type(ui === 'ar' ? 'غروب فوق البحر' : 'sunset over the ocean');
  await page.click(top + ' .set-gen-go'); await sleep(900);
  ok((await count(top + ' .set-gen-item')) === 4 && (await blank(top + ' .set-gen-item canvas')) === 0, 'Generate: four painted wallpapers');
  await shot(P + 'wp-07-creative');
  await page.click(top + ' .set-gen-item'); await sleep(600);
  ok(await exists('.ou-dialog .set-gen-big canvas') && (await outside('.ou-dialog')).length === 0, 'tapping one shows a big preview inside the screen');
  await shot(P + 'wp-08-creative-preview');
  await page.click('.ou-dialog .ou-dialog-btn.primary'); await sleep(500);
  await where(2);
  s = await S();
  ok(s.wallpaper?.type === 'gen' && s.wallpaper.spec?.light?.bg && s.wallpaper.spec?.dark?.bg && s.lockWallpaper?.type === 'shuffle', 'Creative wallpaper on the Home screen (light and dark specs), Lock screen still Dynamic');
  ok(((await store('genWalls')) || []).length === 1 && (await state()).kind === 'spec', 'kept in Recent creations; painted live');
  await back();
  ok((await count(top + ' .set-wall-item[title]')) >= presets.length + 1, 'the gallery shows the creation');

  // ——— Color palette ———
  await back();
  await row(await tr('set.palette'));
  ok((await text(top + ' .app-toolbar-title')) === (await tr('set.palette')), 'Color palette opens');
  const chips = await count(top + ' .set-pal');
  ok(chips >= 1 && chips <= 4 && await exists(top + ' .set-pal[data-value="auto"].active'), `${chips} wallpaper color palettes, the first one in use`);
  await shot(P + 'wp-09-palette');
  const acc0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  if (chips > 1) {
    await page.click(top + ' .set-pal[data-value="wall:1"]'); await sleep(300);
    ok((await S()).accent === 'wall:1' && (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) !== acc0, 'second wallpaper color: accent changes');
  }
  await page.click(top + ' .set-pal-tabs .ou-seg-btn:nth-child(2)'); await sleep(300);
  ok((await count(top + ' .set-pal')) === 8, 'Basic colors: eight palettes');
  await page.click(top + ' .set-pal[data-value="#22b07d"]'); await sleep(300);
  ok((await S()).accent === '#22b07d', 'basic color #22b07d saved');
  await page.click(top + ' .set-pal-tabs .ou-seg-btn:nth-child(1)'); await sleep(300);
  await page.click(top + ' .set-pal[data-value="auto"]'); await sleep(300);
  ok((await S()).accent === 'auto', 'back to the wallpaper\'s main color');
  await row(await tr('set.pal.icons'));
  ok((await S()).iconStyle === 'themed', 'Apply palette to app icons → themed icons');
  await row(await tr('set.pal.icons'));
  ok((await S()).iconStyle === 'default', 'and off again');
  await back();

  // ——— dim in Dark mode ———
  await row(await tr('set.wp.darkDim'));
  ok((await S()).wallpaperDarkDim === true, 'Dim wallpaper when Dark mode is on: saved');
  const dimOp = await page.evaluate(() => document.getElementById('wall-dark')?.style.opacity);
  ok(dimOp === (theme === 'dark' ? '1' : '0'), `dimming layer ${theme === 'dark' ? 'on in Dark mode' : 'off in Light mode'} (${dimOp})`);
  await row(await tr('set.wp.darkDim'));

  // ——— live wallpaper pauses behind windows; Labs keeps it moving ———
  await page.evaluate(() => import('./js/shell/wallpaper.js').then((m) => m.setWallpaper({ type: 'preset', id: 'aurora' }, 'both')));
  await page.evaluate(() => import('./js/core/store.js').then((m) => { m.setSetting('reduceMotion', false); m.setSetting('wallpaperAnimated', true); }));
  await sleep(500);
  ok(!(await state()).animating, 'with Settings open, the live wallpaper is paused');
  await page.evaluate(() => import('./js/core/store.js').then((m) => m.setSetting('wallLiveBehindApps', true)));
  await sleep(300);
  ok((await state()).animating, 'Labs › keep it moving behind apps');
  await page.evaluate(() => import('./js/core/store.js').then((m) => m.setSetting('wallLiveBehindApps', false)));
  await closeApp(); await sleep(500);
  ok((await state()).animating, 'no window open: it moves again');
  await page.evaluate(() => import('./js/core/store.js').then((m) => m.setSetting('reduceMotion', true)));
  await sleep(300);
  ok(!(await state()).animating, 'Remove animations stops it');
  await shot(P + 'wp-10-home');
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');

};
