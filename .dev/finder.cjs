// triple
// Finder (S10): instant answers (maths with Liquid Tab's engine, units incl. Arabic, time in a city with Arabic names,
// date questions), natural-language commands in English and Arabic (remind me, events with a calendar alarm, wallpaper,
// ambient sounds, timer with Arabic-Indic digits, open <app>), ranking (command scores and priority, "play sudoku" over
// a catch-all, sections by relevance, keyboard selection), time-of-day example chips, Settings rows in search (and the
// row flashing when opened), on-device AI answers with a stubbed `LanguageModel` (Ask chip, Tab, follow-ups, define,
// errors, AI mode) and voice input with a stubbed on-device `SpeechRecognition` (shown, hidden, dictation).
// usage: .dev/run.sh .dev/finder.cjs      (THEME=dark, UI=ar)
module.exports = async (ctx) => {
  const { page, boot, ok, sleep, shot, P, mod, sw, exists, visible, count, ui, logs, outside } = ctx;
  const AR = ui === 'ar';
  const L = (en, ar) => (AR ? ar : en);
  const S = (k, vars) => mod('./js/core/i18n.js', 't', k, vars || null);
  const pget = (k) => page.evaluate((k) => import('./js/core/store.js').then((m) => m.store.get(k)), k);
  const pset = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.store.set(k, v)), k, v);
  const setting = async (k) => (await pget('settings'))[k];
  const setSet = (k, v) => page.evaluate((k, v) => import('./js/core/store.js').then((m) => m.setSetting(k, v)), k, v);
  const alarmGet = (n) => sw.evaluate((n) => chrome.alarms.get(n), n);
  const cur = () => page.evaluate(() => import('./js/core/apps.js').then((m) => m.currentApp()));
  const closeApp = () => page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))).then(() => sleep(300));
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
  const press = async (key, wait = 300) => { await page.keyboard.press(key); await sleep(wait); };
  const openF = async (text = '') => { await mod('./js/shell/finder.js', 'openFinder', text); await sleep(300); };
  const finderOpen = () => mod('./js/shell/finder.js', 'isFinderOpen');
  const rowsNow = () => page.$$eval('#finder .fr', (l) => l.map((r) => ({ title: r.querySelector('.fr-title')?.textContent || '', sub: r.querySelector('.fr-sub')?.textContent || '', answer: r.classList.contains('answer') })));
  const heads = () => page.$$eval('#finder .fr-head', (l) => l.map((x) => x.textContent));
  /** Types q (one input event) and waits until the results are for q (the web rows at the end repeat it). */
  const fr = async (q, { ai = false } = {}) => {
    await page.evaluate((q) => { const i = document.querySelector('.finder-input'); i.value = q; i.dispatchEvent(new Event('input')); }, q);
    if (ai) await sleep(500);
    else await until(() => page.evaluate((q) => document.querySelector('#finder .fr-sec-web .fr-title')?.textContent === q, q), 5000);
    await sleep(120);
    return rowsNow();
  };
  const clickRow = (title) => page.evaluate((t) => { const r = [...document.querySelectorAll('#finder .fr')].find((x) => x.querySelector('.fr-title')?.textContent === t); r?.click(); return !!r; }, title);
  const toastText = () => page.evaluate(() => document.querySelector('.ou-toast')?.textContent || '');
  const ltr = (s) => '⁦' + s + '⁩';

  const now = Date.now();
  await boot({
    data: {
      home: [[{ id: 's1', type: 'site', title: 'Notion', url: 'https://www.notion.so/' }, { id: 's2', type: 'site', title: 'GitHub', url: 'https://github.com/' }]],
      notes: [
        { id: 'n1', title: 'Calc', body: 'Shared costs', color: '', pinned: false, created: now - 5e3, updated: now - 5e3 },
        { id: 'n2', title: L('Ideas about notion', 'أفكار عن notion'), body: '', color: '', pinned: false, created: now - 9e3, updated: now - 9e3 },
      ],
      reminders: [], events: [], timers: [],
    },
  });
  // the On-device AI stub is installed later; start from "not in this Chrome"
  await page.evaluate(() => { delete self.LanguageModel; });
  await mod('./js/shell/finder.js', 'refreshAi');

  // ════════════════ empty state: time-of-day chips, suggested apps
  let mark = logs.length;
  await openF();
  ok((await count('.finder-chip')) === 7 && (await count('.finder-app')) >= 6, 'empty Finder: 7 example chips and suggested apps');
  const hour = new Date().getHours();
  const chipTexts = await page.$$eval('.finder-chip', (l) => l.map((x) => x.textContent.trim()));
  const expected = await page.evaluate((h) => import('./js/shell/finder.js').then((m) => m.exampleChips(h)), hour);
  ok(JSON.stringify(chipTexts) === JSON.stringify(expected), `chips are this time of day's set (${chipTexts.join(' | ')})`);
  const sets = await page.evaluate(() => import('./js/shell/finder.js').then((m) => [8, 14, 19, 23].map((h) => [m.daypart(h), m.exampleChips(h)])));
  ok(sets.map((s) => s[0]).join() === 'morning,afternoon,evening,night' && new Set(sets.map((s) => s[1].join())).size === 4, 'four different chip sets: morning, afternoon, evening, night');
  const tr = await S('finder.ex.translate');
  ok(sets.every((s) => s[1].includes(tr)), `"${tr}" is a chip at every time of day`);
  ok((await outside('.finder-panel')).length === 0, 'Finder panel inside the screen');
  await shot(P + 'finder-01-empty');
  // every chip of every time of day gives an answer or a command first (never just a web search)
  const webSub = await S('finder.searchWith', { engine: await S('finder.theWeb') });
  for (const [part, list] of sets) {
    for (const q of list) {
      const r = await fr(q);
      ok(r[0] && r[0].sub !== webSub && r.length > 2, `${part} chip "${q}" → ${r[0]?.title.replace(/[⁦⁩]/g, '')}`);
    }
  }
  // the translate chip is answered inline by Interpreter
  await fr(tr);
  ok(await until(() => exists('#finder .fr .ip-fr-out')), 'translate chip: Interpreter answers inline in the first row');

  // ════════════════ instant answers
  const ans = async (q) => (await fr(q)).find((x) => x.answer);
  let a = await ans('20% of 150');
  ok(a?.title === '= 30', `maths: 20% of 150 → ${a?.title}`);
  a = await ans(L('15% off 80', '20% من 150'));
  ok(a?.title === L('= 68', '= 30'), `maths: ${L('15% off 80', '20% من 150')} → ${a?.title}`);
  a = await ans('2^10+5!');
  ok(/^= 1[,٬]?144$/.test(a?.title || ''), `maths: 2^10+5! → ${a?.title}`);
  a = await ans('١٢+٣×٢');
  ok(a?.title === '= 18', `maths with Arabic-Indic digits ١٢+٣×٢ → ${a?.title}`);
  a = await ans('sin 30 + sqrt 16');
  ok(a?.title === '= 4.5' || a?.title === '= 4٫5', `maths: functions without parentheses → ${a?.title}`);
  ok(!(await ans('2026-10-26')), 'a date (2026-10-26) is not a subtraction');
  a = await ans(L('3 cups to ml', '10 كم إلى ميل'));
  ok(a && (AR ? /6[.٫]2137 mi/.test(a.title) : /709[.٫]7647 mL/.test(a.title)) && a.sub === (await S('finder.conversion')), `units: ${L('3 cups to ml', '10 كم إلى ميل')} → ${a?.title}`);
  a = await ans('60 mph to km/h');
  ok(a && /96[.٫]5606 km\/h/.test(a.title), `units: 60 mph to km/h → ${a?.title}`);
  ok(!(await ans('5 kg to km')), 'units: no answer between different kinds');
  for (const [q, tz] of [['الوقت في دبي', 'Asia/Dubai'], ['كم الساعة في لندن', 'Europe/London'], ['dubai time', 'Asia/Dubai'], ['time in new york', 'America/New York'], ['الوقت في عمّان', 'Asia/Amman'], ['توقيت مكة', 'Asia/Riyadh']]) {
    a = await ans(q);
    ok(a?.sub === tz && /\d{1,2}:\d\d/.test(a.title), `time: ${q} → ${a?.title} · ${a?.sub}`);
  }
  ok(!(await ans('screen time')), '"screen time" is not a city');
  // dates (expected values computed in the page with the same formatters)
  const dates = await page.evaluate(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let xmas = new Date(today.getFullYear(), 11, 25);
    if (xmas < today) xmas.setFullYear(xmas.getFullYear() + 1);
    const loc = document.documentElement.lang === 'ar' ? 'ar-u-nu-latn' : navigator.language;
    const days = Math.round((xmas - today) / 864e5);
    return { until: new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(days, 'day'), weekday: new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(xmas) };
  });
  a = await ans(L('days until Dec 25', 'كم يوم حتى 25 ديسمبر'));
  ok(a?.title === dates.until, `dates: ${L('days until Dec 25', 'كم يوم حتى 25 ديسمبر')} → ${a?.title} (${a?.sub})`);
  a = await ans(L('what day is christmas', 'أي يوم 25 ديسمبر'));
  ok(a?.title === dates.weekday, `dates: the day of Dec 25 → ${a?.title}`);
  a = await ans(L('how many days until ramadan', 'كم يوم على رمضان'));
  ok(a && /\d/.test(a.title), `dates: until Ramadan (Umm al-Qura calendar) → ${a?.title} · ${a?.sub}`);
  a = await ans(L('week number', 'رقم الأسبوع'));
  ok(a && /\d/.test(a.title) && a.title.startsWith((await S('finder.week', { n: '' })).trim().split(' ')[0]), `dates: week number → ${a?.title}`);
  a = await ans(L('in 3 weeks', 'بعد 100 يوم'));
  ok(!!a, `dates: ${L('in 3 weeks', 'بعد 100 يوم')} → ${a?.title}`);
  await fr(L('days until Dec 25', 'كم يوم حتى 25 ديسمبر'));
  await shot(P + 'finder-02-answer');
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'answers: no page errors');

  // ════════════════ commands (English and Arabic)
  mark = logs.length;
  const first = async (q) => (await fr(q))[0];
  const run = async (q, wait = 600) => { await fr(q); await page.focus('.finder-input'); await press('Enter', wait); };
  // remind me … with a date and a time
  let r = await first(L('remind me to call mom tomorrow at 9am', 'ذكرني بالاتصال بأمي غدًا الساعة 9 صباحًا'));
  ok(r?.title === (await S('finder.cmdRemind')), 'remind me: the first row creates a reminder');
  await run(L('remind me to call mom tomorrow at 9am', 'ذكرني بالاتصال بأمي غدًا الساعة 9 صباحًا'), 900);
  const rem = ((await pget('reminders')) || [])[0];
  const tmr9 = new Date(); tmr9.setDate(tmr9.getDate() + 1); tmr9.setHours(9, 0, 0, 0);
  ok(rem?.title === L('call mom', 'الاتصال بأمي') && rem.due === tmr9.getTime(), `reminder saved: "${rem?.title}" due ${rem && new Date(rem.due).toString().slice(0, 21)}`);
  const ra = rem && (await alarmGet('reminder:' + rem.id));
  ok(ra && Math.abs(ra.scheduledTime - rem.due) < 50, 'reminder: chrome alarm scheduled');
  // an event: "lunch with Sara Friday 1pm"
  await openF();
  const evQ = L('lunch with Sara Friday 1pm', 'غداء مع سارة الجمعة الساعة 1 ظهرًا');
  const evTitle = L('Lunch with Sara', 'غداء مع سارة');
  r = await first(evQ);
  ok(r?.title === (await S('finder.cmdEvent', { text: evTitle })), `event: first row "${r?.title}" (${r?.sub})`);
  await shot(P + 'finder-03-event');
  await run(evQ, 700);
  const ev = ((await pget('events')) || [])[0];
  const fri = new Date(); fri.setHours(13, 0, 0, 0); fri.setDate(fri.getDate() + (((5 - fri.getDay() + 7) % 7) || 7));
  ok(ev?.title === evTitle && ev.start === fri.getTime() && ev.end === fri.getTime() + 3600e3 && !ev.allDay && ev.alert === '10', `event saved in "events": ${ev?.title} ${ev && new Date(ev.start).toString().slice(0, 21)}`);
  const ea = ev && (await alarmGet('event:' + ev.id));
  ok(ea && Math.abs(ea.scheduledTime - (ev.start - 600e3)) < 50, 'event: event:<id> alarm 10 minutes before');
  ok((await toastText()) === (await S('finder.eventAdded')), 'event: "added" toast');
  // wallpaper <preset>
  await openF();
  r = await first(L('wallpaper sunset', 'خلفية غروب'));
  ok(r?.title === (await S('finder.cmdWallpaper', { name: await S('wall.sunset') })), `wallpaper: ${r?.title}`);
  await run(L('wallpaper sunset', 'خلفية غروب'));
  ok(JSON.stringify(await setting('wallpaper')) === JSON.stringify({ type: 'preset', id: 'sunset' }), 'wallpaper: setting wallpaper = sunset preset');
  // play rain → ambient sound, then stop it
  await openF();
  r = await first(L('play rain', 'شغل صوت المطر'));
  ok(r?.title === (await S('finder.cmdSound', { name: await S('sound.rain') })), `play rain: ambient sound first (${r?.title})`);
  await run(L('play rain', 'شغل صوت المطر'));
  let snd = await mod('./js/shell/sounds.js', 'state');
  ok(snd.playing && snd.id === 'rain', 'play rain: the rain sound plays');
  await openF();
  r = await first(L('stop sounds', 'أوقف الصوت'));
  ok(r?.title === (await S('finder.cmdSoundStop')), 'stop sounds: offered while one plays');
  await run(L('stop sounds', 'أوقف الصوت'));
  snd = await mod('./js/shell/sounds.js', 'state');
  ok(!snd.playing, 'stop sounds: paused');
  // timer with Arabic-Indic digits, Focus in Arabic
  await openF();
  r = await first('مؤقت ١٠ دقائق');
  ok(r?.title === (await S('finder.cmdTimer', { d: '10m' })), `Arabic timer with Arabic-Indic digits → ${r?.title}`);
  r = await first('تركيز ٢٥');
  ok(r?.title === (await S('finder.cmdFocus', { n: 25 })), `Arabic Focus → ${r?.title}`);
  // open <app>
  r = await first(L('open calendar', 'افتح التقويم'));
  ok(r?.title === (await S('finder.cmdOpen', { app: await mod('./js/core/apps.js', 'appName', 'calendar') })), `open <app> → ${r?.title}`);
  await run(L('open calendar', 'افتح التقويم'), 900);
  ok((await cur()) === 'calendar' && !(await finderOpen()), 'open <app>: Calendar opens');
  await closeApp();
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'commands: no page errors');

  // ════════════════ ranking
  mark = logs.length;
  await page.evaluate(() => import('./js/core/hooks.js').then((m) => {
    // a catch-all like Music's "Play “…” in Music", and commands that rank themselves
    m.registerCommand('t-catchall', (q) => { const x = /^(?:play|العب)\s+(.+)$/i.exec(q); return x ? [{ icon: 'music', title: `Play “${x[1]}” in Music`, sub: 'catch-all', run() {} }] : []; });
    m.registerCommand('t-scored', (q) => (q === 'zz rank' ? [{ icon: 'star', title: 'low', sub: 's', score: 10, run() {} }, { icon: 'star', title: 'high', sub: 's', score: 99, run() {} }] : []));
    m.registerCommand('t-prio', (q) => (q === 'zz rank' ? [{ icon: 'star', title: 'boosted', sub: 's', score: 60, run() {} }] : []), { priority: 50 });
  }));
  await openF();
  const sudoku = await mod('./js/core/i18n.js', 't', 'games.cmdPlay', { game: await page.evaluate(() => import('./js/games/index.js').then((m) => m.GAMES?.find((g) => g.id === 'sudoku')).then((g) => g && import('./js/core/i18n.js').then((i) => i.t(g.name)))).catch(() => null) });
  r = await fr(L('play sudoku', 'العب سودوكو'));
  const iGame = r.findIndex((x) => /sudoku|سودوكو/i.test(x.title) && x.sub !== 'catch-all'), iCatch = r.findIndex((x) => x.sub === 'catch-all');
  ok(iGame === 0 && iCatch > iGame, `"${L('play sudoku', 'العب سودوكو')}": Gaming Hub's exact match (${r[0]?.title}) above the catch-all (row ${iCatch})`);
  ok(!sudoku || r[0].title === sudoku, 'the top row is "Play Sudoku" itself');
  r = await fr('zz rank');
  ok(r.slice(0, 3).map((x) => x.title).join() === 'boosted,high,low', `command score and priority order rows: ${r.slice(0, 3).map((x) => x.title).join(', ')}`);
  // sections by relevance: a note titled exactly "Calc" beats the Calculator app; a site named "Notion" beats a note
  r = await fr('calc');
  let hs = await heads();
  const notesName = await mod('./js/core/apps.js', 'appName', 'notes');
  ok(hs.indexOf(notesName) >= 0 && hs.indexOf(notesName) < hs.indexOf(await S('finder.apps')), `"calc": Notes (exact title) before Apps (${hs.join(' › ')})`);
  r = await fr('notion');
  hs = await heads();
  ok(hs.indexOf(await S('finder.sites')) >= 0 && hs.indexOf(await S('finder.sites')) < hs.indexOf(notesName), `"notion": Websites (exact name) before Notes (${hs.join(' › ')})`);
  // keyboard selection across sections still works
  r = await fr('calc');
  await page.focus('.finder-input');
  await press('ArrowDown', 150);
  await press('ArrowDown', 150);
  const selIdx = await page.$$eval('#finder .fr', (l) => l.findIndex((x) => x.classList.contains('sel')));
  ok(selIdx === 2, `ArrowDown moves the selection across sections (row ${selIdx})`);
  await press('ArrowUp', 150);
  await press('ArrowUp', 150);
  ok((await page.$$eval('#finder .fr', (l) => l.findIndex((x) => x.classList.contains('sel')))) === 0, 'ArrowUp moves it back');
  await shot(P + 'finder-04-ranking');
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'ranking: no page errors');

  // ════════════════ Settings rows in Finder
  mark = logs.length;
  const idx = await page.evaluate(() => import('./js/apps/settings.js').then((m) => m.indexSettings()).then((x) => ({ n: x.items.length, pages: [...new Set(x.items.map((i) => i.page))] })));
  ok(idx.n > 40 && ['wallpaper', 'display', 'home', 'lock', 'search', 'general'].every((p) => idx.pages.includes(p)), `Settings index: ${idx.n} labels from ${idx.pages.length} pages`);
  const eye = await S('qp.eyeComfort');
  r = await fr(eye);
  hs = await heads();
  const setName = await mod('./js/core/apps.js', 'appName', 'settings');
  const dispTitle = await S('set.display');
  const eyeRow = r.find((x) => x.title === eye && x.sub.includes(dispTitle));
  ok(hs.includes(setName) && eyeRow, `"${eye}" finds the Display row (${eyeRow?.sub})`);
  await shot(P + 'finder-05-settings-row');
  await clickRow(eye);
  await sleep(1000);
  ok((await cur()) === 'settings', 'clicking it opens Settings');
  const found = await page.evaluate(() => { const f = document.querySelector('.app-win .finder-found'); return f ? f.textContent : null; });
  ok(found && found.includes(eye), 'the Eye comfort row flashes on the Display page');
  const vis = await page.evaluate(() => { const f = document.querySelector('.app-win .finder-found'); const s = f?.closest('.app-scroll'); if (!f || !s) return false; const a = f.getBoundingClientRect(), b = s.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom; });
  ok(vis, 'and is scrolled into view');
  await shot(P + 'finder-06-settings-found');
  await closeApp();
  await openF();
  const cs = await S('set.clockStyle');
  r = await fr(cs);
  const lockTitle = await S('set.lock');
  ok(r.some((x) => x.title === cs && x.sub.includes(lockTitle)), `a subheader ("${cs}") is searchable too`);
  // the Search page of Settings shows the new switches
  await mod('./js/shell/finder.js', 'closeFinder');
  await page.evaluate(() => import('./js/core/apps.js').then((m) => m.openApp('settings', { params: { page: 'search' } })));
  await sleep(900);
  const titles = await page.$$eval('.app-win .ou-row-title', (l) => l.map((x) => x.textContent));
  ok(titles.includes(await S('finder.set.localAi')) && titles.includes(await S('finder.set.voice')), 'Settings › Search and Finder: on-device answers and voice input switches');
  const aiSub = await page.evaluate((t) => [...document.querySelectorAll('.app-win .ou-row')].find((r) => r.querySelector('.ou-row-title')?.textContent === t)?.querySelector('.ou-row-sub')?.textContent, await S('finder.set.localAi'));
  ok(aiSub === (await S('finder.set.localAiNo', { ai: 'Claude' })), `without the Prompt API the switch says so (${aiSub})`);
  ok((await count('.app-win .set-cmd')) >= 14, 'the quick command list shows the new commands');
  await shot(P + 'finder-07-settings-page');
  await closeApp();
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'Settings search: no page errors');

  // ════════════════ on-device AI (stubbed Prompt API)
  mark = logs.length;
  await openF();
  await fr('why is the sky blue');
  ok(!(await visible('.finder-ask')), 'no Ask chip without the Prompt API');
  await page.evaluate(() => {
    window.__lm = { creates: [], prompts: [], fail: false };
    self.LanguageModel = {
      availability: async () => 'available',
      create: async (opts) => {
        window.__lm.creates.push(opts.initialPrompts?.[0]?.content || '');
        return {
          async *promptStreaming(q) {
            window.__lm.prompts.push(q);
            if (window.__lm.fail) throw new Error('model crashed');
            for (const w of ['Sunlight ', 'scatters ', '**off** air.\n', '- blue light\n- scatters most']) { await new Promise((r) => setTimeout(r, 40)); yield w; }
          },
          destroy() {},
        };
      },
    };
  });
  ok((await mod('./js/shell/finder.js', 'refreshAi')) === 'available', 'refreshAi() sees the Prompt API');
  await fr('why is the sky blue');
  ok(await visible('.finder-ask'), 'Ask chip appears in the search bar');
  ok((await rowsNow()).at(-1)?.sub === (await S('finder.askAi', { ai: 'Claude' })), 'the hand-off row stays last (no "· Tab": Tab answers here now)');
  await page.focus('.finder-input');
  await press('Tab', 600);
  ok(await until(() => page.evaluate(() => (document.querySelector('.finder-ai-card .fai-text')?.textContent || '').includes('scatters most'))), 'Tab answers on this device, streamed into the card');
  ok((await page.$eval('.finder-ai-card .fai-q', (x) => x.textContent)) === 'why is the sky blue' && (await exists('.finder-ai-card .fai-text b')) && (await count('.finder-ai-card .fai-text li')) === 2, 'question shown; bold and bullets rendered (as elements, not HTML)');
  const acts = await page.$$eval('.finder-ai-card .fai-chip', (l) => l.map((x) => x.textContent));
  ok(acts.length === 2 && acts[0] === (await S('finder.copy')) && acts[1] === (await S('finder.continueIn', { ai: 'Claude' })), `actions: ${acts.join(' · ')}`);
  ok((await page.$eval('.finder-input', (i) => i.placeholder)) === (await S('finder.followUp')) && (await count('#finder .fr')) === 0, 'input asks for a follow-up; no result rows under the card');
  await shot(P + 'finder-08-ai-answer');
  await page.type('.finder-input', L('and at sunset?', 'وعند الغروب؟'));
  await press('Enter', 200);
  ok(await until(() => page.evaluate(() => document.querySelectorAll('.finder-ai-card .fai-turn').length === 2 && document.querySelectorAll('.finder-ai-card .fai-chip').length === 4)), 'a follow-up adds a second turn');
  let lm = await page.evaluate(() => window.__lm);
  ok(lm.creates.length === 1 && lm.prompts.length === 2 && lm.prompts[1] === L('and at sunset?', 'وعند الغروب؟'), 'one conversation (session created once, two prompts)');
  await press('Escape', 300);
  ok(!(await exists('.finder-ai-card')) && (await finderOpen()), 'Escape closes the answer, Finder stays open');
  // AI mode: the on-device row comes first
  await page.click('.finder-ai');
  await sleep(200);
  r = await fr(L('plan a picnic', 'خطط لنزهة'), { ai: true });
  ok(r.length === 2 && r[0].sub === (await S('finder.answerLocal')) && r[1].sub === (await S('finder.askAi', { ai: 'Claude' })), 'AI mode: "Answer on this device" first, then Ask Claude');
  await page.focus('.finder-input');
  await press('Enter', 600);
  ok(await until(() => page.evaluate(() => (document.querySelector('.finder-ai-card .fai-text')?.textContent || '').includes('scatters most'))), 'Enter in AI mode answers on this device');
  await page.click('.finder-ai');
  await sleep(300);
  ok(!(await exists('.finder-ai-card')) && !(await exists('#finder.ai')), 'leaving AI mode closes the answer');
  // define (on-device only)
  r = await first(L('define serendipity', 'ما معنى كلمة شغف'));
  ok(r?.title === (await S('finder.cmdDefine', { word: L('serendipity', 'شغف') })), `define: ${r?.title}`);
  await page.focus('.finder-input');
  await press('Enter', 600);
  await until(() => exists('.finder-ai-card .fai-chip'));
  lm = await page.evaluate(() => window.__lm);
  ok(lm.creates.at(-1).includes('dictionary definition') && lm.prompts.at(-1) === L('serendipity', 'شغف'), 'define: a one-off prompt with the dictionary instruction');
  await press('Escape', 300);
  // errors fall back to the assistant
  await page.evaluate(() => (window.__lm.fail = true));
  await fr('tell me a joke');
  await page.focus('.finder-input');
  await press('Tab', 500);
  ok(await until(() => page.evaluate(() => !!document.querySelector('.finder-ai-card .fai-muted'))), 'a failing model shows "isn’t available right now"');
  const errActs = await page.$$eval('.finder-ai-card .fai-chip', (l) => l.map((x) => x.textContent));
  ok(errActs.length === 1 && errActs[0] === (await S('finder.askAi', { ai: 'Claude' })), 'with one "Ask Claude" button');
  await shot(P + 'finder-09-ai-error');
  await press('Escape', 300);
  // turned off in Settings
  await setSet('finderLocalAi', false);
  await mod('./js/shell/finder.js', 'refreshAi');
  await fr('why is the sky blue');
  ok(!(await visible('.finder-ask')), 'Settings switch off: no Ask chip');
  await setSet('finderLocalAi', true);
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'AI: no page errors');

  // ════════════════ voice input (stubbed on-device speech recognition)
  mark = logs.length;
  await mod('./js/shell/finder.js', 'closeFinder');
  await page.evaluate((said) => {
    window.__sr = { mode: 'available', said, made: [] };
    class SR {
      static async available(o) { window.__sr.asked = o; return window.__sr.mode; }
      start() {
        window.__sr.made.push({ lang: this.lang, local: this.processLocally });
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: window.__sr.said }], { isFinal: true })] }), 60);
        setTimeout(() => this.onend?.(), 120);
      }
      stop() {}
      abort() {}
    }
    self.SpeechRecognition = SR;
    self.webkitSpeechRecognition = SR;
  }, L('time in tokyo', 'الوقت في طوكيو'));
  await openF();
  ok(await until(() => visible('.finder-mic')), 'mic shown where on-device recognition is available');
  await page.click('.finder-mic');
  await until(() => page.evaluate(() => document.querySelector('.finder-input').value.length > 0));
  ok((await page.$eval('.finder-input', (i) => i.value)) === L('time in tokyo', 'الوقت في طوكيو'), 'dictation fills the search box');
  const ta = await until(async () => (await rowsNow()).find((x) => x.answer && x.sub === 'Asia/Tokyo'));
  ok(!!ta, 'and the spoken question is answered');
  const made = await page.evaluate(() => window.__sr);
  ok(made.made[0]?.local === true && made.made[0]?.lang === L('en-US', 'ar-SA') && made.asked?.processLocally === true, `recognizer: on device only (processLocally), ${made.made[0]?.lang}`);
  await shot(P + 'finder-10-voice');
  await mod('./js/shell/finder.js', 'closeFinder');
  await page.evaluate(() => (window.__sr.mode = 'unavailable'));
  await openF();
  await sleep(300);
  ok(!(await visible('.finder-mic')), 'mic hidden where Chrome can’t recognize this language on the device');
  await mod('./js/shell/finder.js', 'closeFinder');
  await page.evaluate(() => (window.__sr.mode = 'available'));
  await setSet('finderVoice', false);
  await openF();
  await sleep(300);
  ok(!(await visible('.finder-mic')), 'mic hidden when voice input is off in Settings');
  await setSet('finderVoice', true);
  await mod('./js/shell/finder.js', 'closeFinder');
  ok(!logs.slice(mark).some((l) => l.includes('[pageerror]')), 'voice: no page errors');

  // ════════════════ a phone-width window
  const vp = page.viewport();
  await page.setViewport({ width: 400, height: 820 });
  await sleep(300);
  await openF();
  await fr(L('lunch with Sara Friday 1pm', 'غداء مع سارة الجمعة الساعة 1 ظهرًا'));
  ok((await outside('.finder-panel, .finder-bar, .finder-ask, .finder-mic, .finder-ai, #finder .fr-sec')).length === 0, 'narrow window: bar, Ask chip, mic and result cards stay inside the screen');
  const barFits = await page.evaluate(() => { const b = document.querySelector('.finder-bar').getBoundingClientRect(), i = document.querySelector('.finder-input').getBoundingClientRect(); return i.width > 120 && i.left >= b.left && i.right <= b.right; });
  ok(barFits, 'narrow window: the search field keeps room to type');
  await shot(P + 'finder-11-narrow');
  await mod('./js/shell/finder.js', 'closeFinder');
  await page.setViewport(vp);
  await sleep(300);
};
