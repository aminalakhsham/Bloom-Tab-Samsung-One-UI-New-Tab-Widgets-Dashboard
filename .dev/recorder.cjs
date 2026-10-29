// triple
// Voice Recorder end to end. getUserMedia is stubbed in the page with an oscillator (a tone and silence in turns)
// through a MediaStreamDestination (stereo), so real audio goes through MediaRecorder; SpeechRecognition is replaced by
// a stand-in that reports on-device availability and emits sentences. Covers: the three modes, record / bookmark /
// pause / resume / keep recording with the window closed / Stop + Save dialog, chunks in IndexedDB, Interview (two
// channels), Speech-to-text text, the Now Bar activity, the list (search, sort, categories, selection, rename),
// playback (play, scrub, speed, Skip silence, Repeat, bookmarks), Trim + Delete (replace and save as new), Save as file,
// Recycle bin (restore, delete, 30-day purge), settings, widgets, the Quick Panel tile, Finder, a denied microphone,
// a recording recovered after the tab closed, and a maximized window.
// usage: .dev/run.sh .dev/recorder.cjs   (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts, count, exists, visible, mod, store, sleep, shot, P, ui, outside, reload }) => {
  const AR = ui === 'ar', L = (en, ar) => (AR ? ar : en);
  const stubs = () => page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__deny) throw new DOMException('Permission denied', window.__deny);
      const ctx = new AudioContext();
      await ctx.resume();
      const osc = ctx.createOscillator();
      osc.frequency.value = 330;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      const d = ctx.createMediaStreamDestination();
      osc.connect(g).connect(d);
      osc.start();
      let on = true;
      setInterval(() => { on = !on; g.gain.setValueAtTime(on ? 0.6 : 0, ctx.currentTime); }, 1200);
      window.__mics = (window.__mics || 0) + 1;
      return d.stream;
    };
    // Chrome's on-device speech recognition, faked: available, takes the microphone track, says two sentences
    class FakeSR {
      start(track) {
        window.__sr = { track: !!track, local: this.processLocally === true, lang: this.lang, continuous: this.continuous };
        const r0 = [{ transcript: 'hello' }];
        r0.isFinal = false;
        const f0 = [{ transcript: 'Hello world.' }];
        f0.isFinal = true;
        const f1 = [{ transcript: 'Second sentence here.' }];
        f1.isFinal = true;
        this.tm = [
          setTimeout(() => this.onresult?.({ resultIndex: 0, results: [r0] }), 300),
          setTimeout(() => this.onresult?.({ resultIndex: 0, results: [f0] }), 700),
          setTimeout(() => this.onresult?.({ resultIndex: 1, results: [f0, f1] }), 1600),
        ];
      }
      stop() { (this.tm || []).forEach(clearTimeout); setTimeout(() => this.onend?.(), 30); }
      abort() { this.stop(); }
    }
    FakeSR.available = async () => 'available';
    FakeSR.install = async () => true;
    window.SpeechRecognition = FakeSR;
    // downloads are recorded instead of saved
    window.__downloads = [];
    const click0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); else click0.call(this); };
  });
  const data = async () => (await store('recorder')) || { items: [], cats: [] };
  const item = async (pred) => (await data()).items.find(pred);
  const blobKeys = () => page.evaluate(() => import('./js/core/blobs.js').then((b) => b.listBlobs('recorder:')));
  const acts = () => page.evaluate(() => import('./js/core/activity.js').then((m) => m.getActivities().filter((a) => a.id === 'recorder').map((a) => ({ title: a.title, sub: a.sub, actions: a.actions.map((x) => x.label) }))));
  const secs = (s) => { const p = String(s || '').split(':').map(parseFloat); return p.reduce((a, v) => a * 60 + v, 0); };
  const clock = async () => secs(await text('.rec-main .rec-timer'));
  const menuItem = async (label) => { await sleep(200); const ok2 = await clickText('.ou-menu-item', label); await sleep(300); return ok2; };
  const dlgBtn = async (label) => { const r = await clickText('.ou-dialog-btn', label); await sleep(350); return r; };
  const back = async () => { await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelector('.app-back')?.click()); await sleep(450); };
  const topIs = (cls) => page.evaluate((c) => [...document.querySelectorAll('.app-page')].pop()?.classList.contains(c), cls);
  const rowOf = (id) => `.app-page:last-child .rec-row[data-id="${id}"]`;
  const NAME = L('Voice 001', 'صوت 001');

  await boot();
  await stubs();

  // ---------------------------------------------------------------- the recording screen
  await openApp('recorder');
  await sleep(500);
  ok(await exists('.rec-main'), 'Voice Recorder opens on the recording screen');
  ok(await count('.rec-modes .ou-seg-btn') === 3, 'three modes: Standard, Interview, Speech-to-text (on-device recognition available)');
  ok((await texts('.rec-modes .ou-seg-btn')).join('|') === L('Standard|Interview|Speech-to-text', 'قياسي|مقابلة|تحويل الكلام إلى نص'), 'mode names');
  ok(await text('.rec-main .rec-timer') === '00:00.00', 'the big timer reads 00:00.00');
  ok(!(await visible('.rec-stopbtn')) && !(await visible('.rec-markbtn')), 'Bookmark and Stop appear only while recording');
  ok((await outside('.rec-main .rec-btn, .rec-modes', '.app-win')).length === 0, 'controls inside the window');
  await shot(P + 'rec-01-idle');

  // ---------------------------------------------------------------- record (Standard), bookmark, pause, resume
  await click('.rec-main .rec-btn');
  await sleep(1400);
  ok(await exists('.rec-main.recording'), 'Record starts recording');
  ok(await page.evaluate(() => window.__mics) === 1, 'the microphone was asked for once');
  let d = await data();
  ok(d.items.length === 1 && d.items[0].rec && d.items[0].title === NAME && d.items[0].mode === 'std', `listed while recording as "${NAME}" (${d.items[0]?.title})`);
  const id1 = d.items[0].id;
  ok((await clock()) > 0.8, 'the timer runs (' + (await text('.rec-main .rec-timer')) + ')');
  ok(await visible('.rec-stopbtn') && await visible('.rec-markbtn'), 'Bookmark · Pause · Stop');
  ok((await blobKeys()).some((k) => k.startsWith(`recorder:${id1}:c`)), 'chunks are saved to IndexedDB while recording');
  let a = await acts();
  ok(a.length === 1 && a[0].actions[0] === L('Stop', 'إيقاف') && /^\d\d:\d\d$/.test(a[0].title), 'Now Bar activity with Stop (' + JSON.stringify(a) + ')');
  await click('.rec-markbtn');
  ok(await text('.rec-markn') === '1', 'Bookmark adds a bookmark (badge 1)');
  await sleep(900);
  await shot(P + 'rec-02-recording');
  await click('.rec-main .rec-btn');
  ok(await exists('.rec-main.paused'), 'the red button pauses');
  const p1 = await clock();
  await sleep(700);
  ok(Math.abs((await clock()) - p1) < 0.02, 'the timer stops while paused');
  ok((await acts())[0]?.sub === L('Paused', 'متوقف مؤقتًا'), 'the activity says Paused');
  await click('.rec-main .rec-btn');
  await sleep(900);
  ok(!(await exists('.rec-main.paused')) && (await clock()) > p1 + 0.6, 'Resume continues');

  // the window closes, the recording goes on
  await closeApp();
  await sleep(1000);
  ok((await acts()).length === 1, 'keeps recording with the app closed (Now Bar activity)');
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(700);
  ok(await exists('.nb-pill .nb-wave'), 'the Now Bar shows the recording on the Lock screen');
  await shot(P + 'rec-03-nowbar');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(300);
  await openApp('recorder');
  await sleep(400);
  ok(await exists('.rec-main.recording'), 'reopening shows the recording');

  // ---------------------------------------------------------------- Stop → Save recording
  await click('.rec-stopbtn');
  await sleep(500);
  ok(await visible('.rec-save-dlg'), 'Stop asks to save the recording');
  ok(await page.$eval('.rec-save-dlg input', (n) => n.value) === NAME, 'the dialog suggests the default name');
  await page.$eval('.rec-save-dlg input', (n) => n.select());
  await page.keyboard.type(L('Team meeting', 'اجتماع الفريق'));
  await shot(P + 'rec-04-save');
  await click('.rec-save-dlg .ou-dialog-btn.primary');
  await sleep(1800);
  let m1 = await item((x) => x.id === id1);
  ok(m1 && !m1.rec && m1.title === L('Team meeting', 'اجتماع الفريق'), 'saved under the new name');
  ok(m1.dur > 2 && m1.dur < 12 && m1.pk && m1.pr, 'length and waveform stored (' + m1.dur?.toFixed(2) + ' s)');
  ok(m1.marks?.length === 1 && m1.marks[0].t > 0, 'the bookmark is stored with the recording');
  let keys = await blobKeys();
  ok(keys.includes('recorder:' + id1) && !keys.some((k) => k.includes(':c')), 'one audio file (recorder:<id>), chunks cleaned up');
  ok((await acts()).length === 0, 'the activity ends');
  ok(await topIs('rec-list-page'), 'after saving, the list opens');
  ok(await exists(rowOf(id1)), 'the new recording is in the list');
  await back();

  // ---------------------------------------------------------------- Interview
  await clickText('.rec-modes .ou-seg-btn', L('Interview', 'مقابلة'));
  ok(await exists('.rec-main.m-interview .rec-stage.split'), 'Interview splits the waveform into two people');
  ok(await visible('.rec-hint'), 'Interview explains where to put the device');
  await click('.rec-main .rec-btn');
  await sleep(2600);
  ok(await visible('.rec-person.top') && await visible('.rec-person.bottom'), 'Person 1 / Person 2 while recording');
  await shot(P + 'rec-05-interview');
  await click('.rec-stopbtn');
  await sleep(400);
  await click('.rec-save-dlg .ou-dialog-btn.primary');
  await sleep(1800);
  const m2 = await item((x) => x.mode === 'interview');
  ok(m2 && m2.title === L('Interview 001', 'مقابلة 001') && !m2.rec, 'Interview recording saved as ' + m2?.title);
  ok(m2.pk && m2.pk2, 'both people have their own waveform (stereo)');
  await back();

  // ---------------------------------------------------------------- Speech-to-text
  await clickText('.rec-modes .ou-seg-btn', L('Speech-to-text', 'تحويل الكلام إلى نص'));
  ok(await visible('.rec-sttbox'), 'Speech-to-text shows the text area');
  await click('.rec-main .rec-btn');
  await sleep(2400);
  const sr = await page.evaluate(() => window.__sr);
  ok(sr?.local === true && sr.track && sr.continuous, 'recognition runs on the device on the recording track (' + JSON.stringify(sr) + ')');
  ok((await texts('.rec-sttbox p')).join(' ').includes('Second sentence here.'), 'the text appears while recording');
  await shot(P + 'rec-06-stt');
  await click('.rec-stopbtn');
  await sleep(400);
  await click('.rec-save-dlg .ou-dialog-btn.primary');
  await sleep(1800);
  const m3 = await item((x) => x.mode === 'stt');
  ok(m3?.text?.length === 2 && m3.text[0].s === 'Hello world.', 'the text is stored with the recording');
  ok(m3.title === L('Memo 001', 'مذكرة 001'), 'named ' + m3.title);
  await back();
  await clickText('.rec-modes .ou-seg-btn', L('Standard', 'قياسي'));

  // ---------------------------------------------------------------- the list
  await click('.rec-tb-text');
  await sleep(400);
  ok(await topIs('rec-list-page') && await count('.app-page:last-child .rec-row') === 3, 'List shows the three recordings');
  ok(await exists('.app-page:last-child .rec-row .rec-row-ico.m-interview') && await exists('.app-page:last-child .rec-row .rec-row-ico.m-stt'), 'each mode has its icon');
  ok(await exists(`${rowOf(id1)} .rec-badge`), 'bookmark count on the row');
  await shot(P + 'rec-07-list');
  // search
  await click('.app-page:last-child .app-toolbar-actions .ou-icon-btn');
  await page.keyboard.type('second');
  await sleep(300);
  ok(await count('.app-page:last-child .rec-row') === 1 && await exists(rowOf(m3.id)), 'search finds Speech-to-text words');
  await page.keyboard.press('Escape');
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(300);
  ok(await topIs('rec-list-page') && await count('.app-page:last-child .rec-row') === 3, 'Escape clears and closes the search');
  // sort by name
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Sort by', 'الترتيب حسب'));
  await clickText('.ou-radio-row', L('Name (A to Z)', 'الاسم (أ إلى ي)'));
  await dlgBtn(L('Done', 'تم'));
  ok((await store('recorderPrefs'))?.sort === 'az', 'Sort by name');
  const order = await page.evaluate(() => [...[...document.querySelectorAll('.app-page')].pop().querySelectorAll('.rec-row-title')].map((n) => n.textContent));
  ok(order.join('|') === [...order].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })).join('|'), 'rows in name order (' + order.join(', ') + ')');
  // category from the row menu
  await page.click(rowOf(id1), { button: 'right' });
  await menuItem(L('Change category', 'تغيير الفئة'));
  await clickText('.ou-radio-row', L('Add category', 'إضافة فئة'));
  await dlgBtn(L('Done', 'تم'));
  await page.keyboard.type(L('Work', 'العمل'));
  await page.keyboard.press('Enter');
  await sleep(400);
  d = await data();
  ok(d.cats.length === 1 && d.cats[0].name === L('Work', 'العمل') && d.items.find((x) => x.id === id1).cat === d.cats[0].id, 'Change category › Add category');
  ok(await exists(`${rowOf(id1)} .rec-row-cat`), 'the row shows its category');
  await click('.app-page:last-child .rec-catbtn');
  await menuItem(L('Work', 'العمل'));
  ok(await count('.app-page:last-child .rec-row') === 1, 'the category picker filters the list');
  await click('.app-page:last-child .rec-catbtn');
  await menuItem(L('All recordings', 'كل التسجيلات'));
  ok(await count('.app-page:last-child .rec-row') === 3, 'back to All recordings');
  // selection mode with a long press, then rename from the bottom bar
  const rb = await (await page.$(rowOf(m2.id))).boundingBox();
  await page.mouse.move(rb.x + 60, rb.y + rb.height / 2);
  await page.mouse.down();
  await sleep(650);
  await page.mouse.up();
  await sleep(300);
  ok(await exists('.app-page:last-child .rec-selbar:not([hidden])') && await exists(`${rowOf(m2.id)}.sel`), 'long press selects (bottom bar)');
  await shot(P + 'rec-08-select');
  await clickText('.rec-selbtn', L('Rename', 'إعادة تسمية'));
  await sleep(300);
  await page.$eval('.ou-dialog input', (n) => n.select());
  await page.keyboard.type(L('Interview with Sam', 'مقابلة مع سامي'));
  await page.keyboard.press('Enter');
  await sleep(400);
  ok((await item((x) => x.id === m2.id)).title === L('Interview with Sam', 'مقابلة مع سامي'), 'Rename');
  ok(!(await exists('.app-page:last-child .rec-selbar:not([hidden])')), 'selection ends');

  // ---------------------------------------------------------------- playback
  await click(rowOf(id1));
  await sleep(900);
  ok(await topIs('rec-play-page'), 'a recording opens the playback screen');
  ok(await exists('.rec-play .rec-stage canvas') && await exists('.rec-playbtn'), 'waveform and play button');
  await click('.rec-playbtn');
  await sleep(1300);
  const t1 = secs(await text('.rec-ptime-cur'));
  ok(t1 > 0.6, 'Play plays (' + t1 + ')');
  await shot(P + 'rec-09-playback');
  await click('.rec-playbtn');
  // add a bookmark while playing back, away from the first one
  await click('.rec-transport .rec-tbtn:last-child');
  await click('.rec-opt.o-mark');
  m1 = await item((x) => x.id === id1);
  ok(m1.marks.length === 2, 'Bookmark during playback adds a second bookmark');
  // bookmarks list
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelector('.app-toolbar-actions .ou-icon-btn').click());
  await sleep(300);
  ok(await count('.rec-marks .rec-mark') === 2, 'Bookmarks list shows both');
  await page.evaluate(() => document.querySelector('.rec-marks .rec-mark .rec-mark-main').click());
  await sleep(300);
  ok(Math.abs(secs(await text('.rec-ptime-cur')) - Math.min(...m1.marks.map((b) => b.t))) < 0.15, 'tapping a bookmark jumps to it');
  // scrub by dragging the waveform
  const sb = await (await page.$('.rec-play .rec-stage')).boundingBox();
  const before = secs(await text('.rec-ptime-cur'));
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(sb.x + sb.width / 2 - i * 9, sb.y + sb.height / 2); await sleep(16); }
  await page.mouse.up();
  await sleep(200);
  const after = secs(await text('.rec-ptime-cur'));
  ok(after > before + 0.8 && after < before + 1.6, `dragging the waveform scrubs (${before} → ${after})`);
  // speed
  await click('.rec-opt.o-speed');
  await sleep(300);
  for (let i = 0; i < 5; i++) await page.evaluate(() => document.querySelectorAll('.rec-speed-step')[1].click());
  ok(await text('.rec-speed-v') === '1.5x', 'speed + steps 0.1x');
  await dlgBtn(L('Done', 'تم'));
  ok((await item((x) => x.id === id1)).speed === 1.5, 'speed saved with the recording');
  ok(await text('.rec-opt.o-speed .rec-opt-lbl') === '1.5x', 'the Speed button shows 1.5x');
  ok(await page.evaluate(() => import('./js/recorder/audio.js').then(() => true)), 'player module');
  // skip silence
  await click('.rec-opt.o-skip');
  ok((await item((x) => x.id === id1)).skip === true && await exists('.rec-opt.o-skip.on'), 'Skip silence on');
  // repeat A–B
  await click('.rec-transport .rec-tbtn:first-child');
  await click('.rec-transport .rec-tbtn:first-child');
  const repA = secs(await text('.rec-ptime-cur'));
  await click('.rec-opt.o-rep');
  ok(await text('.rec-opt.o-rep .rec-opt-lbl') === L('Repeat A–', 'تكرار A–'), 'Repeat: first tap sets A');
  await click('.rec-playbtn');
  await sleep(1500);
  const repB = secs(await text('.rec-ptime-cur')); // B is a moment after this
  await click('.rec-opt.o-rep');
  ok(await text('.rec-opt.o-rep .rec-opt-lbl') === L('Repeat A–B', 'تكرار A–B'), `Repeat: second tap sets B (${repA} → ~${repB})`);
  await sleep(2400);
  await shot(P + 'rec-10-repeat');
  // without the loop, 2.4 s at 1.5x would be far past B (or at the end, stopped)
  const loopT = secs(await text('.rec-ptime-cur'));
  ok(await page.$eval('.rec-playbtn', (n) => n.dataset.on === 'true') && loopT >= repA - 0.1 && loopT <= repB + 2, `the section loops (${loopT})`);
  await click('.rec-opt.o-rep');
  await click('.rec-playbtn');
  ok(await text('.rec-opt.o-rep .rec-opt-lbl') === L('Repeat', 'تكرار'), 'third tap turns Repeat off');

  // ---------------------------------------------------------------- Trim / Delete
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Edit', 'تعديل'));
  await sleep(500);
  ok(await topIs('rec-edit-page') && await visible('.rec-eh.l') && await visible('.rec-eh.r'), 'Edit shows the two handles');
  ok(await page.$eval('.rec-epill.trim', (n) => n.disabled), 'Trim waits for a selection');
  const eb = await (await page.$('.rec-estage')).boundingBox();
  const drag = async (sel, toX) => { const hb = await (await page.$(sel)).boundingBox(); await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(toX, hb.y + hb.height / 2, { steps: 6 }); await page.mouse.up(); await sleep(200); };
  await drag('.rec-eh.l', eb.x + eb.width * 0.25);
  await drag('.rec-eh.r', eb.x + eb.width * 0.75);
  await shot(P + 'rec-11-trim');
  await click('.rec-epill.trim');
  await click('.rec-tb-text.strong');
  await sleep(300);
  ok(await visible('.ou-dialog'), 'Save asks: new recording or replace');
  await dlgBtn(L('Replace', 'استبدال'));
  await sleep(500);
  m1 = await item((x) => x.id === id1);
  const kept = m1.segs ? m1.segs.reduce((s, [x, y]) => s + y - x, 0) : m1.dur;
  ok(m1.segs && Math.abs(kept - m1.dur / 2) < m1.dur * 0.12, `Trim keeps the middle (${kept.toFixed(2)} of ${m1.dur.toFixed(2)} s)`);
  ok(await topIs('rec-play-page'), 'back on the playback screen');
  // Delete a part, saved as a new recording
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Edit', 'تعديل'));
  await sleep(500);
  const eb2 = await (await page.$('.rec-estage')).boundingBox();
  await drag('.rec-eh.l', eb2.x + eb2.width * 0.5);
  await click('.rec-epill.cut');
  await click('.rec-tb-text.strong');
  await sleep(300);
  await dlgBtn(L('Save as new', 'حفظ كجديد'));
  await sleep(1200);
  d = await data();
  const copy = d.items.find((x) => x.title === `${L('Team meeting', 'اجتماع الفريق')}_01`);
  ok(copy && copy.segs && Math.abs(copy.segs.reduce((s, [x, y]) => s + y - x, 0) - kept / 2) < kept * 0.15, 'Delete + Save as new makes "…_01" with the part removed');
  ok((await blobKeys()).includes('recorder:' + copy?.id), 'the new recording has its own audio');
  ok(await topIs('rec-play-page'), 'the new recording opens');
  // save as file (edited → WAV)
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Save as file', 'حفظ كملف'));
  await sleep(1500);
  const dl = await page.evaluate(() => window.__downloads);
  ok(dl.some((n) => n.endsWith('_01.wav')), 'Save as file: an edited recording is saved as WAV (' + dl.join(', ') + ')');
  // details
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Details', 'التفاصيل'));
  ok(await count('.rec-det-row') >= 6, 'Details');
  await shot(P + 'rec-12-details');
  await dlgBtn(L('OK', 'موافق'));

  // ---------------------------------------------------------------- Speech-to-text playback and Interview playback
  await back();
  await click(rowOf(m3.id));
  await sleep(800);
  ok(await count('.rec-ptext .rec-seg') === 2, 'the transcript shows under the waveform');
  await page.evaluate(() => document.querySelectorAll('.rec-ptext .rec-seg')[1].click());
  await sleep(200);
  ok(await exists('.rec-ptext .rec-seg.now'), 'tapping a sentence jumps there');
  await shot(P + 'rec-13-stt-play');
  await back();
  await click(rowOf(m2.id));
  await sleep(800);
  ok(await count('.rec-persons .rec-pbtn') === 2, 'Interview playback: Person 1 / Person 2');
  await click('.rec-persons .rec-pbtn');
  ok(await exists('.rec-persons .rec-pbtn.off'), 'mute Person 1');
  await shot(P + 'rec-14-interview-play');
  // delete → Recycle bin
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Delete', 'حذف'));
  await sleep(600);
  ok((await item((x) => x.id === m2.id)).deletedAt > 0, 'Delete moves it to the Recycle bin');
  ok(await topIs('rec-list-page') && !(await exists(rowOf(m2.id))), 'and it leaves the list');

  // ---------------------------------------------------------------- Recycle bin
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelectorAll('.app-toolbar-actions .ou-icon-btn')[1].click());
  await menuItem(L('Recycle bin', 'سلة المحذوفات'));
  await sleep(400);
  ok(await topIs('rec-bin-page') && await count('.app-page:last-child .rec-row') === 1, 'Recycle bin lists it');
  ok(/30/.test(await text('.app-page:last-child .rec-days')), 'with the days left (' + (await text('.app-page:last-child .rec-days')) + ')');
  await shot(P + 'rec-15-bin');
  await click('.app-page:last-child .rec-row');
  await menuItem(L('Restore', 'استعادة'));
  ok(!(await item((x) => x.id === m2.id)).deletedAt, 'Restore');
  // delete permanently, and the 30-day purge
  await page.evaluate((id) => import('./js/recorder/data.js').then((m) => m.trash([id])), copy.id);
  await sleep(300);
  await click('.app-page:last-child .rec-row');
  await menuItem(L('Delete permanently', 'حذف نهائي'));
  await dlgBtn(L('Delete', 'حذف'));
  await sleep(500);
  ok(!(await item((x) => x.id === copy.id)) && !(await blobKeys()).includes('recorder:' + copy.id), 'Delete permanently removes the entry and the audio');
  await page.evaluate((id) => import('./js/core/store.js').then(({ store: s }) => s.update('recorder', (v) => { v.items.find((x) => x.id === id).deletedAt = Date.now() - 31 * 864e5; return v; })), m2.id);
  await back();
  await back();
  await closeApp();
  await openApp('recorder');
  await sleep(800);
  ok(!(await item((x) => x.id === m2.id)) && !(await blobKeys()).includes('recorder:' + m2.id), 'recordings older than 30 days in the Recycle bin are purged');

  // ---------------------------------------------------------------- settings
  await page.evaluate(() => [...document.querySelectorAll('.app-page')].pop().querySelector('.app-toolbar-actions .ou-icon-btn').click());
  await menuItem(L('Settings', 'الإعدادات'));
  await sleep(400);
  ok(await topIs('rec-settings-page'), 'Settings');
  await shot(P + 'rec-16-settings');
  await clickText('.app-page:last-child .ou-row', L('Name recordings when saving', 'تسمية التسجيلات عند الحفظ'));
  ok((await store('recorderPrefs')).askName === false, 'turn off the Save dialog');
  await back();

  // ---------------------------------------------------------------- widgets, Quick Panel tile, Finder
  await closeApp();
  const wg = await page.evaluate(async () => {
    const w = await import('./js/core/widgets.js');
    const out = {};
    for (const [id, size] of [['recorder', 's'], ['recorder-recent', 'm']]) {
      const box = document.createElement('div');
      box.className = `wg w-${size}`;
      box.style.cssText = 'position:fixed;left:20px;top:20px;width:340px;height:170px;z-index:999';
      document.body.appendChild(box);
      const off = w.getWidget(id).render(box, { size, item: {}, config: {} });
      out[id] = { btn: !!box.querySelector('.wg-rec-btn, .wg-recent-rec'), rows: box.querySelectorAll('.wg-recent-row').length };
      off?.();
      box.remove();
    }
    return out;
  });
  ok(wg.recorder.btn && wg['recorder-recent'].btn && wg['recorder-recent'].rows === 2, 'widgets: Record button, recent recordings (' + JSON.stringify(wg) + ')');
  // put the Record widget on the Home screen and record from it
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'test-wg';
    box.className = 'wg w-s';
    box.style.cssText = 'position:fixed;left:40px;top:120px;width:170px;height:170px;z-index:50';
    document.body.appendChild(box);
    import('./js/core/widgets.js').then((w) => (window.__wgOff = w.getWidget('recorder').render(box, { size: 's', item: {}, config: {} })));
  });
  await sleep(300);
  await click('#test-wg .wg-rec-btn');
  await sleep(1500);
  ok((await acts()).length === 1 && await exists('#test-wg.on'), 'the Record widget starts recording without opening the app');
  await shot(P + 'rec-17-widget');
  await click('#test-wg .wg-rec-btn');
  await sleep(1500);
  ok((await acts()).length === 0 && (await data()).items.some((x) => x.title === NAME && !x.rec), 'and stops it (saved as ' + NAME + ', free again after the rename)');
  await page.evaluate(() => { window.__wgOff?.(); document.getElementById('test-wg')?.remove(); });
  // Quick Panel tile
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(600);
  const tileSel = `.qp-tile[title="${L('Voice recorder', 'مسجل الصوت')}"]`;
  ok(await exists(tileSel), 'Quick Panel has the Voice recorder tile');
  await click(tileSel);
  await sleep(1600);
  ok((await acts()).length === 1 && await exists(tileSel + '.on'), 'the tile starts a recording');
  ok(await exists('.qp-activity'), 'the recording shows in the Quick Panel');
  await shot(P + 'rec-18-quickpanel');
  await page.evaluate(() => document.querySelector('.qp-activity .ou-icon-btn').click());
  await sleep(1500);
  ok((await acts()).length === 0, 'Stop from the Quick Panel saves it');
  await mod('./js/shell/quickpanel.js', 'closeQuickPanel');
  await sleep(300);
  // Finder: the record command and search
  await mod('./js/shell/finder.js', 'openFinder', AR ? 'تسجيل' : 'record');
  await sleep(700);
  ok((await texts('.finder-results .fr')).some((s) => s.includes(L('Start recording', 'بدء التسجيل'))), 'Finder: "record" offers Start recording');
  await mod('./js/shell/finder.js', 'openFinder', L('Team', 'اجتماع'));
  await sleep(800);
  ok((await texts('.finder-results .fr')).some((s) => s.includes(L('Team meeting', 'اجتماع الفريق'))), 'Finder search finds recordings');
  await mod('./js/shell/finder.js', 'openFinder', AR ? 'تسجيل' : 'record');
  await sleep(700);
  await clickText('.finder-results .fr', L('Start recording', 'بدء التسجيل'));
  await sleep(1800);
  ok(await exists('.rec-main.recording') && (await acts()).length === 1, 'the command opens Voice Recorder and records');
  await click('.rec-stopbtn');
  await sleep(1500);
  ok(await topIs('rec-list-page'), 'with the Save dialog off, Stop saves straight to the list');

  // ---------------------------------------------------------------- Modes and Routines: Start / Stop recording
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p || {}, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  ok(await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => ['recorder.start', 'recorder.stop'].every((id) => A.ACTIONS[id] && !I.t(A.ACTIONS[id].name).startsWith('recorder.')))), 'Routines lists Start recording and Stop recording');
  const nRec = (await data()).items.length;
  let ra = await runAction('recorder.start');
  await sleep(1800);
  ok(!ra.err && await exists('.rec-main.recording') && (await acts()).length === 1, 'Start recording opens Voice Recorder and records');
  ra = await runAction('recorder.stop');
  await sleep(1500);
  ok((await acts()).length === 0 && ra.v && (await data()).items.some((x) => x.title === ra.v && !x.rec) && (await data()).items.length === nRec + 1, 'Stop recording saves it and returns its name (' + ra.v + ')');
  ra = await runAction('recorder.stop');
  ok(ra.v === '' && !ra.err, 'Stop recording with nothing recording does nothing');
  ra = await page.evaluate(() => import('./js/routines/actions.js').then((A) => Promise.resolve().then(() => A.ACTIONS['recorder.start'].run({ env: 'sw', page: null }, {}, {})).then(() => 'ran', (e) => e.key)));
  ok(ra === 'routines.err.page', 'Start recording needs a page (the service worker has no microphone)');
  if (!(await topIs('rec-list-page'))) { await click('.rec-tb-text'); await sleep(500); }

  // ---------------------------------------------------------------- a tab closed while recording
  await back();
  await click('.rec-main .rec-btn');
  await sleep(2200);
  const live = (await data()).items.find((x) => x.rec).id;
  await page.evaluate((k) => localStorage.setItem(k, '0'), 'recorder.beat.' + live);
  page.on('dialog', (dg) => dg.accept().catch(() => {}));
  await reload();
  await stubs();
  await page.evaluate((k) => localStorage.setItem(k, '0'), 'recorder.beat.' + live);
  await openApp('recorder');
  await sleep(2500);
  const rec = await item((x) => x.id === live);
  ok(rec && !rec.rec && rec.dur > 0.5, 'a recording cut off by closing the tab is recovered (' + rec?.dur?.toFixed(2) + ' s)');

  // ---------------------------------------------------------------- microphone denied
  await page.evaluate(() => { window.__deny = 'NotAllowedError'; });
  await click('.rec-main .rec-btn');
  await sleep(500);
  ok(await visible('.ou-dialog') && !(await exists('.rec-main.recording')), 'a denied microphone explains how to allow it');
  await shot(P + 'rec-19-denied');
  await dlgBtn(L('Cancel', 'إلغاء'));
  await page.evaluate(() => { window.__deny = null; });

  // ---------------------------------------------------------------- maximized window
  await page.evaluate(() => document.querySelector('.app-win').classList.add('max'));
  await sleep(500);
  ok((await outside('.rec-main .rec-btn, .rec-main .rec-timer', '.app-win')).length === 0, 'maximized: still laid out');
  await shot(P + 'rec-20-max');
  await click('.rec-tb-text');
  await sleep(500);
  await shot(P + 'rec-21-max-list');
  ok(await page.evaluate(() => { const r = document.querySelector('.app-page:last-child .rec-rows').getBoundingClientRect(); return r.width <= 790; }), 'the list keeps a readable width');
};
