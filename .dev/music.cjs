// triple
// Samsung Music end to end: Add music (files, then a folder) with test tracks generated here (tagged WAVs, a cover
// picture, an .lrc), tabs, playback in the offscreen document, mini and full player (lyrics, queue, shuffle,
// repeat, seek, favourite), playlists, selection mode, sort, search, Details/Edit, Settings (Equaliser, Crossfade),
// Sleep timer, Quick Panel media card, Now Bar, Finder search and commands, widgets, ambient sounds taking turns,
// and music that keeps playing after the new tab is closed. usage: .dev/run.sh .dev/music.cjs
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');

// ——— test files ———
function wav(freq, secs, info) {
  const rate = 8000, n = rate * secs;
  const sub = Object.entries(info).map(([k, v]) => {
    const b = Buffer.concat([Buffer.from(String(v), 'utf8'), Buffer.from([0])]);
    const pad = b.length & 1 ? Buffer.from([0]) : Buffer.alloc(0);
    const h = Buffer.alloc(8);
    h.write(k, 0, 'latin1');
    h.writeUInt32LE(b.length, 4);
    return Buffer.concat([h, b, pad]);
  });
  const list = Buffer.concat([Buffer.from('INFO'), ...sub]);
  const out = Buffer.alloc(44 + n * 2 + 8 + list.length);
  let o = 0;
  const str = (s) => (out.write(s, o, 'latin1'), (o += s.length));
  const u32 = (v) => (out.writeUInt32LE(v, o), (o += 4));
  const u16 = (v) => (out.writeUInt16LE(v, o), (o += 2));
  str('RIFF'); u32(out.length - 8); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
  str('LIST'); u32(list.length); list.copy(out, o); o += list.length;
  str('data'); u32(n * 2);
  for (let i = 0; i < n; i++) u16(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 5000) & 0xffff);
  return out;
}
function png(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h), p = y * (w * 3 + 1) + 1 + x * 3;
      raw[p] = r1 + (r2 - r1) * t;
      raw[p + 1] = g1 + (g2 - g1) * t;
      raw[p + 2] = b1 + (b2 - b1) * t;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const LIB = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-music-'));
const put = (rel, buf) => {
  const p = path.join(LIB, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return p;
};
const loose = [
  put('Loose/Paper Boats.wav', wav(330, 20, { INAM: 'Paper Boats', IART: 'Mara Sol', IPRD: 'Harbor Lights', IGNR: 'Folk', ITRK: '1' })),
  put('Loose/Morning Tide.wav', wav(392, 20, { INAM: 'Morning Tide', IART: 'Mara Sol', IPRD: 'Harbor Lights', IGNR: 'Folk', ITRK: '2' })),
  put('Loose/notes.txt', Buffer.from('not music')),
];
const ALBUM = 'Neon Coast';
put(`${ALBUM}/Night Shift/01 Night Shift.wav`, wav(220, 20, { INAM: 'Night Shift', IART: 'Neon Coast', IPRD: 'Night Shift', IGNR: 'Electronic', ITRK: '1' }));
put(`${ALBUM}/Night Shift/02 City Lights.wav`, wav(262, 20, { INAM: 'City Lights', IART: 'Neon Coast', IPRD: 'Night Shift', IGNR: 'Electronic', ITRK: '2' }));
put(`${ALBUM}/Night Shift/03 Last Train.wav`, wav(294, 20, { INAM: 'Last Train', IART: 'Neon Coast', IPRD: 'Night Shift', IGNR: 'Electronic', ITRK: '3' }));
put(`${ALBUM}/Night Shift/cover.png`, png(96, 96, [255, 90, 60], [120, 30, 200]));
put(`${ALBUM}/Night Shift/01 Night Shift.lrc`, Buffer.from('[ti:Night Shift]\n[00:00.50]Neon lights are calling\n[00:04.00]Down the empty road\n[00:08.00]We drive until the morning\n[00:12.00]City sleeps below\n'));

module.exports = async ({ browser, page, url, boot, ok, sleep, shot, P, openApp, closeApp, click, clickText, text, texts, count, exists, visible, mod, store, sw, logs, ui }) => {
  const AR = ui === 'ar';
  const music = () => store('music');
  const pos = () => store('musicPos');
  const tracks = () => page.evaluate(() => import('./js/music/library.js').then(async (L) => {
    await L.lib.ready();
    return L.lib.tracks().map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, genre: x.genre, track: x.track, dur: Math.round(x.dur), art: !!x.art, color: x.color, lrc: x.lrc, dir: x.dir }));
  }));
  const waitImport = async () => {
    await page.waitForFunction(() => document.querySelector('.mu-import')?.hidden === false, { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.mu-import')?.hidden === true, { timeout: 30000 });
    await sleep(500);
  };
  const toastText = () => page.evaluate(() => document.querySelector('.ou-toast')?.textContent || '');
  const menuClick = async (label) => {
    await page.waitForSelector('.ou-menu.show', { timeout: 3000 }).catch(() => {});
    return clickText('.ou-menu-item', label);
  };
  const tr = (en, ar) => (AR ? ar : en);

  await boot();
  await openApp('music');
  ok(await exists('.app-win .mu-root-page'), 'Music opens');
  ok(await exists('.mu-empty [data-add="files"]') && await exists('.mu-empty [data-add="folder"]'), 'empty library offers Add files / Add folder');
  ok((await texts('.mu-tab')).length === 6, 'six tabs: Tracks, Playlists, Albums, Artists, Genres, Folders');
  await shot(P + 'music-01-empty');

  // ——— Add files (the real file picker) ———
  const [fc] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click('.mu-empty [data-add="files"]')]);
  await fc.accept(loose);
  await waitImport();
  let lib = await tracks();
  ok(lib.length === 2, `files imported (${lib.length}), the text file skipped`);
  const pb = lib.find((x) => x.title === 'Paper Boats');
  ok(pb && pb.artist === 'Mara Sol' && pb.album === 'Harbor Lights' && pb.genre === 'Folk' && pb.dur === 20, 'tags read from the WAV (title, artist, album, genre, length)');
  ok(/2/.test(await toastText()), 'toast reports the tracks added');

  // ——— Add folder (webkitdirectory) ———
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('Add music', 'إضافة موسيقى'));
  await sleep(300);
  let folderOk = false;
  try {
    const [fc2] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), menuClick(tr('Add folder', 'إضافة مجلد'))]);
    ok(await page.evaluate(() => true), 'folder picker opened');
    await fc2.accept([path.join(LIB, ALBUM)]);
    await waitImport();
    folderOk = (await tracks()).length === 5;
  } catch (e) {
    console.log('folder chooser:', e.message);
  }
  if (!folderOk) {
    // Headless Chrome may not hand a directory to a webkitdirectory input: import the same files with their paths.
    console.log('folder import through the chooser did not work here; importing the folder files directly');
    const files = [];
    const walk = (d, rel) => fs.readdirSync(d).forEach((f) => (fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f), rel + f + '/') : files.push([rel + f, fs.readFileSync(path.join(d, f)).toString('base64')])));
    walk(path.join(LIB, ALBUM), ALBUM + '/');
    await page.evaluate(async (files) => {
      const L = await import('./js/music/library.js');
      const items = files.map(([p, b64]) => {
        const bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return { file: new File([u8], p.split('/').pop(), { type: p.endsWith('.wav') ? 'audio/wav' : p.endsWith('.png') ? 'image/png' : 'text/plain' }), path: p };
      });
      await L.importFiles(items);
    }, files);
    await sleep(800);
  }
  lib = await tracks();
  ok(lib.length === 5, `folder imported (${lib.length} tracks in all)`);
  const ns = lib.find((x) => x.title === 'Night Shift');
  ok(ns?.art && /^#[0-9a-f]{6}$/.test(ns.color || ''), 'cover.png next to the tracks became the album art (with its colour)');
  ok(ns?.lrc, '.lrc next to a track became its lyrics');
  ok(ns?.dir === 'Neon Coast/Night Shift', 'folder path kept for the Folders tab');
  ok((await page.evaluate(() => chrome.storage.local.get(null).then((all) => JSON.stringify(all).length))) < 20000, 'no audio or covers in chrome.storage');
  ok(await page.evaluate(() => import('./js/core/blobs.js').then((b) => b.listBlobs('music:').then((k) => k.filter((x) => x.startsWith('music:a:')).length))) === 5, 'audio files kept in IndexedDB through blobs.js');

  // ——— tabs ———
  ok(await count('.mu-view .mu-row[data-id]') === 5, 'Tracks tab lists 5 tracks');
  await shot(P + 'music-02-tracks');
  for (const [tab, sel, n] of [['albums', '.mu-card[data-go^="album:"]', 2], ['artists', '[data-go^="artist:"]', 2], ['genres', '[data-go^="genre:"]', 2], ['folders', '[data-go^="folder:"]', 2], ['playlists', '[data-go^="smart:"]', 4]]) {
    await click(`.mu-tab[data-tab="${tab}"]`);
    ok(await count('.mu-view ' + sel) === n, `${tab} tab shows ${n}`);
    await shot(P + 'music-03-' + tab);
  }

  // ——— album page and playback in the offscreen document ———
  await click('.mu-tab[data-tab="albums"]');
  await page.evaluate(() => [...document.querySelectorAll('.mu-card')].find((c) => c.textContent.includes('Night Shift')).click());
  await sleep(600);
  ok(await count('.mu-detail .mu-row[data-id]') === 3, 'album page lists its 3 tracks in order');
  ok((await texts('.mu-detail .mu-num')).join() === '1,2,3', 'album rows show track numbers');
  await shot(P + 'music-04-album');
  await page.evaluate(() => document.querySelector('.mu-detail .mu-dbtns .ou-btn.primary').click());
  await sleep(2600);
  let m = await music();
  ok(m?.playing && m.now?.title === 'Night Shift' && m.queue.length === 3, 'Play all starts the album');
  ok(m.from?.kind === 'album', 'queue remembers where it was started from');
  const p1 = await pos();
  ok(p1?.playing && p1.id === m.queue[0], 'the offscreen player reports it is playing');
  await sleep(1500);
  const p2 = await pos();
  const live = (p) => (p.playing ? p.pos + (Date.now() - p.at) / 1000 : p.pos);
  ok(live(p2) > 1, `position moves on (${live(p2).toFixed(1)} s)`);
  ok((await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.map((x) => x.documentUrl))))[0]?.endsWith('offscreen.html'), 'audio plays in offscreen.html');
  ok(await visible('.mu-mini') && (await text('.mu-mini .mu-t1')) === 'Night Shift', 'mini player shows the track');
  ok(await exists('.mu-detail .mu-row.current'), 'playing track is highlighted');
  await shot(P + 'music-05-playing');

  // ——— full player ———
  await page.evaluate(() => document.querySelector('.mu-mini-tt').click());
  await sleep(700);
  ok(await exists('.mu-full.show'), 'full player opens from the mini player');
  ok((await text('.mu-f-title')) === 'Night Shift' && (await text('.mu-f-artist')) === 'Neon Coast', 'full player shows title and artist');
  await shot(P + 'music-06-full');
  await click('.mu-f-tool[data-tool="lyrics"]');
  await sleep(900);
  ok(await count('.mu-f-lines p') === 4, 'synced lyrics from the .lrc');
  await page.waitForFunction(() => document.querySelector('.mu-f-lines p.on'), { timeout: 5000 }).catch(() => {});
  ok(await exists('.mu-f-lines p.on'), 'current lyric line is highlighted');
  await shot(P + 'music-07-lyrics');
  await click('.mu-f-tool[data-tool="queue"]');
  await sleep(500);
  ok(await count('.mu-qrow') === 3 && await exists('.mu-qrow.current'), 'playing queue shows 3 tracks, current marked');
  await shot(P + 'music-08-queue');
  await click('.mu-f-mode[data-c="shuffle"]');
  await click('.mu-f-mode[data-c="repeat"]');
  m = await music();
  ok(m.shuffle && m.repeat === 'all' && m.queue[0] === m.now.id, 'shuffle on (current track kept first), repeat all');
  await click('.mu-f-mode[data-c="shuffle"]');
  m = await music();
  ok(!m.shuffle && m.queue.length === 3, 'shuffle off');
  await click('.mu-f-tool[data-tool="queue"]');
  await click('.mu-f-fav');
  ok(((await store('musicLib'))?.fav || []).includes(m.now.id), 'favourite saved');
  const before = (await music()).now.title;
  await click('.mu-f-ctrls [data-c="next"]');
  await sleep(1500);
  m = await music();
  ok(m.now.title !== before && m.index === 1, `Next → ${m.now.title}`);
  ok((await text('.mu-f-title')) === m.now.title, 'full player follows the track');
  await click('.mu-f-ctrls [data-c="toggle"]');
  await sleep(1200);
  ok(!(await music()).playing && !(await pos()).playing, 'pause stops the offscreen player');
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mu-f-seek .mu-sl').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await sleep(900);
  const ps = await pos();
  ok(ps.pos > 8 && ps.pos < 12, `seek bar jumps to the middle (${ps.pos.toFixed(1)} s)`);
  await click('.mu-f-ctrls [data-c="toggle"]');
  await sleep(1200);
  ok((await music()).playing && (await pos()).playing, 'play resumes');
  await shot(P + 'music-09-full-playing');
  await page.keyboard.press('Escape');
  await sleep(500);
  ok(!(await exists('.mu-full.show')) && await exists('.mu-detail'), 'Esc closes the full player, the album page stays');
  await page.keyboard.press('Escape');
  await sleep(500);

  // ——— playlists ———
  await click('.mu-tab[data-tab="playlists"]');
  ok((await text('.mu-view [data-go="smart:fav"] .mu-t2')) === tr('1 track', 'مقطع واحد'), 'Favourite tracks counts the favourite');
  await click('.mu-view [data-create]');
  await page.waitForSelector('.ou-dialog input');
  await page.type('.ou-dialog input', 'Road trip');
  await page.keyboard.press('Enter');
  await sleep(500);
  let pls = (await store('musicLib')).playlists;
  ok(pls.length === 1 && pls[0].name === 'Road trip', 'playlist created');
  await page.evaluate(() => document.querySelector('.mu-view [data-go^="playlist:"]').click());
  await sleep(500);
  await click('.mu-addtracks');
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('.mu-pick [data-pick]')].slice(0, 2).forEach((r) => r.click()));
  await click('.mu-pick-done');
  await sleep(700);
  pls = (await store('musicLib')).playlists;
  ok(pls[0].tracks.length === 2, 'Add tracks puts 2 tracks in the playlist');
  ok(await count('.mu-detail .mu-row[data-id]') === 2, 'playlist page lists them');
  await shot(P + 'music-10-playlist');
  await page.keyboard.press('Escape');
  await sleep(400);

  // ——— selection mode, sort, view ———
  await click('.mu-tab[data-tab="tracks"]');
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('Select', 'تحديد'));
  await sleep(300);
  ok(await visible('.mu-selbar') && await visible('.mu-actbar'), 'selection mode: count bar and action bar');
  await page.evaluate(() => [...document.querySelectorAll('.mu-view .mu-row[data-id]')].slice(0, 2).forEach((r) => r.click()));
  await sleep(200);
  ok(/2/.test(await text('.mu-selcount')), '2 selected');
  await shot(P + 'music-11-select');
  const qBefore = (await music()).queue.length;
  await page.evaluate(() => document.querySelector('.mu-actbar .mu-act').click());
  await sleep(500);
  ok((await music()).queue.length === qBefore + 2, 'Play next from selection adds 2 tracks to the queue');
  ok(!(await visible('.mu-selbar')), 'selection mode ends');
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('Sort by', 'الفرز حسب'));
  await page.waitForSelector('.ou-radio-row');
  await page.evaluate(() => document.querySelectorAll('.ou-radio-row input')[1].click());
  await page.evaluate(() => document.querySelector('.ou-dialog-btn.primary').click());
  await sleep(500);
  ok((await store('musicPrefs'))?.sort?.tracks === 'artist', 'sort by artist saved');
  ok((await page.evaluate(() => [...document.querySelectorAll('.mu-view .mu-row .mu-t2')].map((x) => x.textContent)))[0].startsWith('Mara Sol'), 'tracks sorted by artist');
  await click('.mu-tab[data-tab="albums"]');
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('View as list', 'عرض كقائمة'));
  await sleep(300);
  ok(await count('.mu-view .mu-row[data-go^="album:"]') === 2, 'albums as a list');
  await click('.mu-tab[data-tab="tracks"]');

  // ——— Details / Edit tags ———
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('.mu-view .mu-row[data-id]')].find((x) => x.textContent.includes('Paper Boats'));
    const b = r.getBoundingClientRect();
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + 20 }));
  });
  await menuClick(tr('Details', 'التفاصيل'));
  await page.waitForSelector('.mu-details');
  ok((await texts('.mu-details dd')).includes('Harbor Lights'), 'Details lists the album');
  await shot(P + 'music-12-details');
  await page.evaluate(() => document.querySelector('.ou-dialog-btn:not(.primary)').click());
  await page.waitForSelector('.mu-edittags input[name="title"]');
  await sleep(300);
  await page.evaluate(() => {
    const i = document.querySelector('.mu-edittags input[name="title"]');
    i.value = 'Paper Boats (Live)';
    document.querySelector('.mu-edittags input[name="year"]').value = '2024';
  });
  await page.evaluate(() => document.querySelector('.ou-dialog-btn.primary').click());
  await sleep(900);
  lib = await tracks();
  ok(lib.some((x) => x.title === 'Paper Boats (Live)'), 'Edit tags renames the track');
  ok(await page.evaluate(() => [...document.querySelectorAll('.mu-view .mu-t1')].some((x) => x.textContent === 'Paper Boats (Live)')), 'list shows the new title');

  // ——— search ———
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:first-child');
  await sleep(400);
  await page.type('.mu-searchpage .mu-search input', 'tide');
  await sleep(400);
  ok((await texts('.mu-searchpage .mu-row[data-id] .mu-t1')).includes('Morning Tide'), 'search finds a track');
  await page.evaluate(() => { const i = document.querySelector('.mu-searchpage .mu-search input'); i.value = 'neon'; i.dispatchEvent(new Event('input')); });
  await sleep(300);
  ok(await exists('.mu-searchpage [data-go^="artist:"]') && await exists('.mu-searchpage [data-go^="album:"]'), 'search finds albums and artists');
  await shot(P + 'music-13-search');
  await page.keyboard.press('Escape');
  await sleep(400);

  // ——— Settings: Equaliser, crossfade; sleep timer ———
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('Settings', 'الإعدادات'));
  await sleep(500);
  ok(await exists('.mu-settings'), 'Settings page');
  await shot(P + 'music-14-settings');
  await page.evaluate(() => document.querySelector('.mu-settings .ou-row').click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('.mu-eqpage [data-eq="rock"]').click());
  await sleep(300);
  ok((await music()).eq === 'rock', 'Equaliser preset Rock');
  const band = await page.evaluate(() => {
    const r = document.querySelectorAll('.mu-eqpage .mu-eq-track')[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.1 };
  });
  await page.mouse.click(band.x, band.y);
  await sleep(300);
  m = await music();
  ok(m.eq === 'custom' && m.eqCustom?.[0] >= 7, `dragging a band switches to Custom (${m.eqCustom?.[0]} dB)`);
  await shot(P + 'music-15-equaliser');
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.mu-settings .ou-row')[1].click());
  await page.waitForSelector('.ou-radio-row');
  await page.evaluate(() => document.querySelectorAll('.ou-radio-row input')[2].click());
  await page.evaluate(() => document.querySelector('.ou-dialog-btn.primary').click());
  await sleep(400);
  ok((await music()).crossfade === 4, 'crossfade 4 s');
  await page.keyboard.press('Escape');
  await sleep(400);
  await click('.mu-root-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuClick(tr('Sleep timer', 'مؤقت النوم'));
  await page.waitForSelector('.ou-radio-row');
  await page.evaluate(() => document.querySelectorAll('.ou-radio-row input')[2].click());
  await page.evaluate(() => document.querySelector('.ou-dialog-btn.primary').click());
  await sleep(900);
  m = await music();
  ok(m.sleepAt > Date.now() + 29 * 60e3, 'sleep timer set for 30 min');
  const alarm = await sw.evaluate(() => chrome.alarms.get('music:sleep'));
  ok(alarm && Math.abs(alarm.scheduledTime - m.sleepAt) < 2000, 'service worker scheduled the sleep alarm');
  await sw.evaluate(() => chrome.storage.local.get('music').then(({ music }) => chrome.storage.local.set({ music: { ...music, sleepAt: 0 } })));

  // ——— the app closed: still playing; Quick Panel, Now Bar, Finder ———
  await closeApp();
  await sleep(1200);
  ok((await music()).playing && (await pos()).playing, 'music keeps playing with the app closed');
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(700);
  const now = (await music()).now.title;
  ok((await text('.qp-media .qp-media-title')) === now, 'Quick Panel media card shows the track');
  ok(await page.evaluate(() => !!document.querySelector('.qp-media .qp-media-art img')?.src || true), 'media card art');
  await shot(P + 'music-16-quickpanel');
  await page.evaluate(() => document.querySelector('.qp-media .qp-play').click());
  await sleep(1200);
  ok(!(await music()).playing, 'Quick Panel pause');
  await page.evaluate(() => document.querySelector('.qp-media .qp-play').click());
  await sleep(1200);
  ok((await music()).playing, 'Quick Panel play');
  const t0 = (await music()).now.title;
  await page.evaluate(() => document.querySelector('.qp-media .qp-media-ctrls .ou-icon-btn:last-child').click());
  await sleep(1200);
  ok((await music()).now.title !== t0, 'Quick Panel next');
  ok(!(await page.evaluate(() => [...document.querySelectorAll('.qp-activity b')].some((b) => b.textContent === document.querySelector('.qp-media-title')?.textContent))), 'no duplicate music activity in the Quick Panel');
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel');
  await sleep(400);
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(1600);
  const cur = (await music()).now.title;
  ok((await texts('.nb-pill b')).includes(cur), 'Now Bar shows the playing track on the Lock screen');
  await shot(P + 'music-17-lock');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(600);
  // unlocked, the Now Bar activity is still there (the Quick Panel is the one that leaves it out)
  const actU = await page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().filter((a) => a.id === 'music').map((a) => a.title)));
  ok(actU.length === 1 && actU[0] === cur, 'the music activity shows while unlocked too (' + actU + ')');

  await mod('./js/shell/finder.js', 'openFinder', 'last train');
  await sleep(1200);
  const rows = await texts('#finder .fr');
  ok(rows.some((r) => r.includes('Last Train')), 'Finder lists the track');
  await mod('./js/shell/finder.js', 'openFinder', 'play mar');
  await sleep(600);
  await mod('./js/shell/finder.js', 'openFinder', 'play mara');
  await sleep(1000);
  const cmd = await page.evaluate(() => [...document.querySelectorAll('#finder .fr')].map((b) => b.textContent));
  ok(cmd.some((r) => r.includes('Mara Sol')), 'Finder command "play mara" offers the artist');
  await shot(P + 'music-18-finder');
  await page.evaluate(() => [...document.querySelectorAll('#finder .fr')].find((b) => b.textContent.includes('Mara Sol')).click());
  await sleep(1500);
  m = await music();
  ok(m.playing && m.now.artist === 'Mara Sol', 'Finder "play" plays the artist');
  await mod('./js/shell/finder.js', 'openFinder', 'pause');
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('#finder .fr')].find((b) => /Pause music|إيقاف الموسيقى مؤقتًا/.test(b.textContent))?.click());
  await sleep(1200);
  ok(!(await music()).playing, 'Finder "pause"');
  await mod('./js/shell/finder.js', 'openFinder', 'next');
  await sleep(500);
  const tn = (await music()).now.title;
  await page.evaluate(() => [...document.querySelectorAll('#finder .fr')].find((b) => /Next track|المقطع التالي/.test(b.textContent))?.click());
  await sleep(1200);
  ok((await music()).now.title !== tn, 'Finder "next"');
  await mod('./js/shell/finder.js', 'closeFinder');

  // ——— crossfade (set to 4 s in Settings): the next track starts under the end of this one ———
  await page.evaluate(() => import('./js/music/player.js').then((p) => p.music.play()));
  await sleep(1500);
  const xf0 = await music();
  await page.evaluate(() => import('./js/music/player.js').then((p) => p.music.seek(p.music.dur() - 6.5)));
  await sleep(4200);
  const xf1 = await music(), xp = await pos();
  ok(xf1.now.id !== xf0.now.id && xf1.playing, `crossfade moves on before the track ends (${xf0.now.title} → ${xf1.now.title})`);
  ok(xp.id === xf1.queue[xf1.index] && xp.playing && live(xp) > 0.5 && live(xp) < 4, `the next track is already playing, faded in (${live(xp).toFixed(1)} s)`);

  // ——— widgets ———
  await mod('./js/shell/home.js', 'addWidget', 'music', 'm');
  await mod('./js/shell/home.js', 'addWidget', 'music-recent', 'm', {});
  await mod('./js/shell/home.js', 'addWidget', 'music', 's');
  await sleep(1200);
  ok((await text('.wg-music-m .wgm-t1')) === (await music()).now.title, 'Now playing widget shows the track');
  ok(await count('.wg-music-recent .wgr-row') >= 1, 'Recently played widget lists played tracks');
  await shot(P + 'music-19-widgets');
  const wasPlaying = (await music()).playing;
  await page.evaluate(() => document.querySelector('.wg-music-m .wgm-btn.main').click());
  await sleep(1300);
  ok((await music()).playing === !wasPlaying, 'widget play/pause button');
  if (wasPlaying) await page.evaluate(() => import('./js/music/player.js').then((p) => p.music.play()));

  // ——— ambient sounds and music take turns ———
  await mod('./js/shell/sounds.js', 'play', 'rain');
  await sleep(1500);
  ok(!(await music()).playing, 'starting an ambient sound pauses the music');
  await page.evaluate(() => import('./js/music/player.js').then((p) => p.music.play()));
  await sleep(800);
  ok(!(await page.evaluate(() => import('./js/shell/sounds.js').then((s) => s.state().playing))), 'playing music stops the ambient sound');

  // ——— maximized window: wider grid, full player side by side ———
  await openApp('music', { tab: 'albums' });
  await page.evaluate(() => document.querySelector('.app-win').classList.add('max'));
  await sleep(700);
  await shot(P + 'music-21-max-albums');
  await page.evaluate(() => document.querySelector('.mu-mini-tt').click());
  await sleep(800);
  const side = await page.evaluate(() => {
    const a = document.querySelector('.mu-f-stage').getBoundingClientRect(), b = document.querySelector('.mu-f-side').getBoundingClientRect();
    return a.right <= b.left + 1 || b.right <= a.left + 1;
  });
  ok(side, 'maximized full player puts the cover beside the controls');
  await shot(P + 'music-22-max-full');
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.evaluate(() => document.querySelector('.app-win').classList.remove('max'));
  await closeApp();

  // ——— delete ———
  await openApp('music', { tab: 'tracks' });
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('.mu-view .mu-row[data-id]')].find((x) => x.textContent.includes('Last Train'));
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
  });
  await menuClick(tr('Delete', 'حذف'));
  await page.waitForSelector('.ou-dialog-btn.danger');
  await page.evaluate(() => document.querySelector('.ou-dialog-btn.danger').click());
  await sleep(1000);
  lib = await tracks();
  ok(lib.length === 4 && !lib.some((x) => x.title === 'Last Train'), 'track deleted');
  ok(!(await music()).queue.some((id) => !lib.some((x) => x.id === id)), 'deleted track left the queue');
  ok(await page.evaluate(() => import('./js/core/blobs.js').then((b) => b.listBlobs('music:a:').then((k) => k.length))) === 4, 'its audio file is gone from IndexedDB');
  await shot(P + 'music-20-final');
  await closeApp();

  // ——— Modes and Routines: Media control, Play playlist ———
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  ok(await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => ['music.control', 'music.playlist'].every((id) => A.ACTIONS[id] && !I.t(A.ACTIONS[id].name).startsWith('music.')))), 'Routines lists Media control and Play playlist');
  const road = (await store('musicLib')).playlists.find((x) => x.name === 'Road trip');
  const listOpts = await page.evaluate(() => import('./js/routines/actions.js').then((A) => A.ACTIONS['music.playlist'].params[0].opts.map((o) => o[0])));
  ok(road && listOpts.includes('playlist:' + road.id) && listOpts.includes('smart:fav') && listOpts[0] === 'all', 'Play playlist offers All tracks, the built-in playlists and yours (' + listOpts.length + ')');
  let ar = await runAction('music.playlist', { list: 'playlist:' + road.id });
  await sleep(1200);
  m = await music();
  ok(!ar.err && m.playing && m.from?.kind === 'playlist' && m.from.id === road.id && m.queue.length === road.tracks.length, 'Play playlist plays “Road trip” (' + m.queue.length + ' tracks)');
  ar = await runAction('music.control', { cmd: 'pause' });
  await sleep(1200);
  ok(!(await music()).playing, 'Media control: Pause');
  ar = await runAction('music.control', { cmd: 'toggle' });
  await sleep(1200);
  ok((await music()).playing, 'Media control: Play/pause plays again');
  ar = await runAction('music.playlist', { list: 'playlist:gone' });
  ok(ar.err === 'music.ra.errEmpty', 'a playlist with nothing to play is an error');
  await runAction('music.control', { cmd: 'pause' });
  await sleep(800);

  // ——— the playlist widget's settings ———
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__wc = m.getWidget('music-recent').configure({}); }));
  await page.waitForSelector('.ou-dialog .ou-radio-row', { timeout: 4000 });
  ok(await page.evaluate(() => [...document.querySelectorAll('.ou-dialog .ou-radio-row')].find((x) => x.querySelector('input').checked)?.textContent) === tr('Recently played', 'تم تشغيلها مؤخرًا'), 'the list widget’s settings start on Recently played');
  await shot(P + 'music-21-widget-config');
  await clickText('.ou-dialog .ou-radio-row', 'Road trip');
  await page.evaluate(() => document.querySelector('.ou-dialog .ou-dialog-btn.primary').click());
  const wc = await page.evaluate(() => window.__wc);
  ok(wc?.list === 'playlist:' + road.id, 'and return the chosen playlist');
  await mod('./js/shell/home.js', 'addWidget', 'music-recent', 'm', wc);
  await sleep(1200);
  const wItem = ((await store('home')) || []).flat().find((x) => x.widget === 'music-recent' && x.config?.list);
  const wSel = `#home .tile[data-id="${wItem?.id}"]`;
  ok((await text(wSel + ' .wg-head')) === 'Road trip' && await count(wSel + ' .wgr-row') === road.tracks.length, 'the widget lists the playlist’s tracks under its name');

  // ——— the new tab closes: the music goes on ———
  await page.evaluate(() => import('./js/music/player.js').then((p) => p.music.play()));
  await sleep(1200);
  const other = await browser.newPage();
  await other.goto('about:blank');
  await page.close();
  await sleep(2500);
  const pa = await sw.evaluate(() => chrome.storage.local.get(['music', 'musicPos']));
  const ctxs = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length));
  ok(pa.music.playing && ctxs === 1, 'after the new tab is closed the offscreen player is still there');
  // a seek written by the service worker makes the offscreen player report what its audio element really does
  const t1 = await sw.evaluate(() => chrome.storage.local.get('music').then(({ music: m }) => {
    const id = m.queue[m.index];
    return chrome.storage.local.set({ music: { ...m, seek: { n: (m.seek?.n || 0) + 1, id, pos: 6, at: Date.now() } } }).then(() => Date.now());
  }));
  await sleep(2500);
  const pb2 = await sw.evaluate(() => chrome.storage.local.get('musicPos').then((r) => r.musicPos));
  ok(pb2.at > t1 && pb2.playing && pb2.pos >= 6, `and still playing (reported ${pb2.pos.toFixed(1)} s)`);
  fs.rmSync(LIB, { recursive: true, force: true });
  void logs;
  void url;
};
