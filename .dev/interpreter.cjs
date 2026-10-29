// triple
// Interpreter end to end: the Samsung-style "not available" states without Chrome's APIs, then the whole app with
// Translator, LanguageDetector, speechSynthesis and SpeechRecognition stubbed in the page (the fake translator tags
// what it doesn't know: "[es] text"): Text (pickers, translate as you type, History, Favourites, copy, read aloud,
// swap, a language pack download with progress, Auto detect, right-to-left text), Conversation (split screen with
// the top half turned around, typing and mic on each side), Listening mode, Language packs, Settings, the Finder
// command in English and Arabic, the widgets and the Quick Panel tile. usage: .dev/run.sh .dev/interpreter.cjs
module.exports = async ({ browser, id, page, boot, ok, openApp, closeApp, click, sleep, shot, P, ui, mod, store, exists, visible, text, count }) => {
  const AR = ui === 'ar';
  await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${id}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
  const W = (n, size) => ({ id: 'w-ip-' + size, type: 'widget', widget: 'interpreter', size, config: {} });
  await boot({ data: { home: [[W(0, 's'), W(1, 'm')]] } });
  // what the app sees (defaults filled in); raw() is what's in chrome.storage.local
  const data = () => page.evaluate(() => Promise.all([import('./js/interpreter/model.js'), import('./js/core/store.js'), import('./js/core/i18n.js')]).then(([M, S, I]) => M.norm(S.store.get('interpreter'), I.lang())));
  const raw = () => store('interpreter');
  const prefs = () => store('interpreterPrefs');
  const setData = (patch) => page.evaluate((x) => import('./js/core/store.js').then(({ store: s }) => s.update('interpreter', (d) => ({ ...d, ...x }))), patch);
  const waitText = (sel, want, ms = 4000) => page.waitForFunction((s, w) => [...document.querySelectorAll(s)].some((n) => n.textContent.includes(w)), { timeout: ms }, sel, want).then(() => true, () => false);
  const value = (sel) => page.$eval(sel, (n) => n.value);
  const typeIn = async (sel, s) => {
    await page.click(sel, { clickCount: 3 });
    await page.evaluate((x) => { const n = document.querySelector(x); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); }, sel);
    await page.type(sel, s, { delay: 8 });
  };
  const pick = async (pill, code) => {
    await click(`.ip-page:not(.ip-pick-page) .ip-pill[data-pick="${pill}"]`);
    await page.waitForSelector(`.ip-pick-page .ip-lang-row[data-code="${code}"]`, { timeout: 3000 });
    await sleep(380);
    await page.evaluate((c) => document.querySelector(`.ip-pick-page .ip-lang-row[data-code="${c}"]`).click(), code);
    await sleep(450);
  };
  const tab = async (name) => {
    await click(`.ip-tabs [data-tab="${name}"]`);
    await sleep(250);
  };
  const menuItem = async (label) => {
    await page.evaluate((l) => [...document.querySelectorAll('.ou-menu-item')].find((b) => b.textContent.includes(l))?.click(), label);
    await sleep(450);
  };
  const tr = (en, ar) => (AR ? ar : en);

  // ——— registration ———
  const reg = await page.evaluate(async () => {
    const apps = await import('./js/core/apps.js'), hooks = await import('./js/core/hooks.js'), w = await import('./js/core/widgets.js');
    return { app: !!apps.getApp('interpreter'), tile: hooks.getTiles().some((x) => x.id === 'interpreter'), widget: !!w.getWidget('interpreter') };
  });
  ok(reg.app && reg.tile && reg.widget, 'registers the app, a Quick Panel tile and a widget');

  // ——— 1. no Chrome APIs: Samsung-style "not available" states ———
  await page.evaluate(() => {
    for (const k of ['Translator', 'LanguageDetector', 'SpeechRecognition', 'webkitSpeechRecognition']) {
      try { delete window[k]; } catch {}
      window[k] = undefined;
    }
  });
  await openApp('interpreter', { tab: 'text' });
  ok(await visible('.ip-na[data-na="text"]') && !(await exists('.ip-cards')), 'Text: translation not available state instead of the cards');
  ok(await visible('.ip-pill[data-pick="from"]'), 'Text: the language pills are still there');
  await shot(P + 'interpreter-00-unavailable');
  await tab('convo');
  ok(await visible('.ip-convo-page .ip-na'), 'Conversation: not available state');
  await tab('listen');
  ok(await visible('.ip-listen-page .ip-na'), 'Listening: not available state');
  await tab('favs');
  ok(await visible('.ip-favs-page .ip-empty'), 'Favourites still opens (empty state)');
  await closeApp();
  // Modes and Routines: Translate text needs the on-device Translator
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  ok((await runAction('interpreter.translate', { text: 'Good morning', to: 'es', from: 'auto' })).err === 'interpreter.cmdNA', 'Routines: Translate text without the Translator API says translation isn’t available');

  // ——— 2. stubs: Chrome's translator and detector, local voices; no speech recognition yet ———
  await page.evaluate(() => {
    const DICT = {
      'en>es': { 'Good morning': 'Buenos días', 'Where is the train station?': '¿Dónde está la estación de tren?', 'Thank you very much': 'Muchas gracias', 'How much does this cost?': '¿Cuánto cuesta esto?' },
      'es>en': { 'Buenos días': 'Good morning', 'Muy bien, ¿y tú?': 'Very well, and you?', 'Está a la derecha': 'It is on the right' },
      'ar>en': { 'مرحبا بك': 'Welcome', 'صباح الخير': 'Good morning' },
      'en>ar': { 'Where is the train station?': 'أين محطة القطار؟', 'Good morning': 'صباح الخير' },
      'en>ja': { 'Hello': 'こんにちは' },
    };
    window.__dl = new Set(['ja', 'ko']); // language packs that still need a download
    const avail = (a, b) => (a === 'kn' || b === 'kn' ? 'unavailable' : window.__dl.has(a) || window.__dl.has(b) ? 'downloadable' : 'available');
    window.Translator = {
      availability: async ({ sourceLanguage: a, targetLanguage: b }) => avail(a, b),
      create: async ({ sourceLanguage: a, targetLanguage: b, monitor }) => {
        const s = avail(a, b);
        if (s === 'unavailable') throw new DOMException('Unsupported pair', 'NotSupportedError');
        if (s === 'downloadable') {
          if (!navigator.userActivation.isActive) throw new DOMException('Requires a user gesture', 'NotAllowedError');
          const tgt = new EventTarget();
          monitor?.(tgt);
          for (const f of [0, 0.35, 0.7, 1]) {
            tgt.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: f }));
            await new Promise((r) => setTimeout(r, 220));
          }
          window.__dl.delete(a);
          window.__dl.delete(b);
        }
        return { translate: async (text) => { await new Promise((r) => setTimeout(r, 40)); return DICT[`${a}>${b}`]?.[text] ?? `[${b}] ${text}`; }, destroy() {} };
      },
    };
    window.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async (s) => [{ detectedLanguage: /[؀-ۿ]/.test(s) ? 'ar' : /[¿¡ñáéíóú]|^Hola|^Buenos|^Muy/.test(s) ? 'es' : /[぀-ヿ]/.test(s) ? 'ja' : 'en', confidence: 0.95 }, { detectedLanguage: 'und', confidence: 0.05 }], destroy() {} }),
    };
    const V = (lang, name, local = true) => ({ lang, name, localService: local, default: false, voiceURI: name });
    window.__spoken = [];
    speechSynthesis.getVoices = () => [V('en-US', 'Samantha'), V('es-ES', 'Mónica'), V('ar-SA', 'Maged'), V('ja-JP', 'Kyoko'), V('de-DE', 'Google Deutsch', false)];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    speechSynthesis.speak = (u) => { window.__spoken.push([u.text, u.lang, u.rate]); u._t = setTimeout(() => u.onend?.(), 700); window.__u = u; };
    speechSynthesis.cancel = () => { const u = window.__u; window.__u = null; if (u) { clearTimeout(u._t); setTimeout(() => u.onend?.(), 0); } };
  });
  await openApp('interpreter', { tab: 'listen' });
  ok(await visible('.ip-na[data-na="listen"]'), 'Listening without on-device speech recognition: Samsung-style explanation');
  await shot(P + 'interpreter-01-listen-unavailable');
  await click('.ip-na[data-na="listen"] .ou-btn');
  ok(await exists('.ip-convo-page .ip-split'), 'its button goes to Conversation mode');
  ok(await page.$$eval('.ip-mic-big', (b) => b.every((x) => x.hidden)), 'no mic without speech recognition: typing only');
  await closeApp();

  // on-device speech recognition (Chrome 139+ shape): says the phrases in window.__say
  await page.evaluate(() => {
    class FakeSR {
      static async available({ langs, processLocally }) { return processLocally && !langs[0].startsWith('kn') ? 'available' : 'unavailable'; }
      static async install() { return true; }
      start() {
        window.__rec = { lang: this.lang, local: this.processLocally, continuous: this.continuous };
        const say = [...(window.__say || [])];
        let ended = false;
        this._end = () => { if (!ended) { ended = true; this.onend?.(); } };
        const next = () => {
          if (this._stopped) return this._end();
          const s = say.shift();
          if (s == null) return this.continuous ? null : this._end();
          this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: s.slice(0, 5) }], { isFinal: false })] });
          setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: s }], { isFinal: true })] }); setTimeout(next, 160); }, 160);
        };
        setTimeout(next, 120);
      }
      stop() { this._stopped = true; setTimeout(() => this._end?.(), 30); }
      abort() { this.stop(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });

  // ——— 3. Text ———
  await openApp('interpreter', { tab: 'text' });
  ok(await visible('.ip-cards') && !(await exists('.ip-na')), 'with the API the Text tab shows the input and result cards');
  await click('.ip-pill[data-pick="from"]');
  await sleep(600);
  ok(await count('.ip-pick-page .ip-lang-row') >= 40, 'language list has every Chrome language plus Auto detect (' + await count('.ip-pick-page .ip-lang-row') + ')');
  ok(await exists('.ip-pick-page .ip-lang-row[data-code="auto"]'), 'Auto detect is offered for the source');
  await page.waitForFunction(() => document.querySelector('.ip-pick-page [data-code="kn"]')?.disabled, { timeout: 3000 }).catch(() => {});
  ok(await page.$eval('.ip-pick-page [data-code="kn"]', (n) => n.disabled && n.classList.contains('off')), 'an unavailable language is greyed out');
  ok(await exists('.ip-pick-page [data-code="ja"] .ip-cloud'), 'a language that needs a download shows the cloud');
  ok((await text('.ip-pick-page [data-code="es"] .ou-row-sub')) === 'Español', 'each language shows its own name under it');
  await page.type('.ip-pick-page input[type=search]', AR ? 'الياب' : 'japan');
  await sleep(200);
  ok(await count('.ip-pick-page .ip-lang-row') === 1, 'search filters the languages');
  await page.evaluate(() => { const i = document.querySelector('.ip-pick-page input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await sleep(150);
  await shot(P + 'interpreter-02-picker');
  await page.evaluate(() => document.querySelector('.ip-pick-page .ip-lang-row[data-code="en"]').click());
  await sleep(450);
  await pick('to', 'es');
  let d = await data();
  ok(d.from === 'en' && d.to === 'es', `picked English → Spanish (${d.from}→${d.to})`);
  await page.type('.ip-input', 'Good morning', { delay: 15 });
  ok(await waitText('.ip-output', 'Buenos días'), 'translates as you type');
  ok(await page.$eval('.ip-output', (n) => n.lang === 'es' && n.getAttribute('dir') === 'auto'), 'result has its language and dir=auto');
  ok(await visible('.ip-acts [data-act="speak"]'), 'read aloud shows when there is an on-device voice');
  await sleep(1900);
  d = await data();
  ok(d.history[0]?.src === 'Good morning' && d.history[0]?.out === 'Buenos días', 'kept in History after a pause');
  ok((await raw())?.history?.[0]?.out === 'Buenos días', 'History is written to chrome.storage.local');
  await page.keyboard.type(' to you', { delay: 15 });
  ok(await waitText('.ip-output', '[es] Good morning to you'), 'retranslates the longer text');
  await page.keyboard.press('Enter');
  await sleep(500);
  d = await data();
  ok(d.history.length === 1 && d.history[0].src === 'Good morning to you', 'one typing session makes one History entry (' + d.history.length + ')');
  await click('.ip-x');
  ok((await value('.ip-input')) === '' && (await text('.ip-output')) === '', 'clear empties both cards');
  await page.type('.ip-input', 'Where is the train station?', { delay: 6 });
  ok(await waitText('.ip-output', '¿Dónde está la estación de tren?'), 'second phrase');
  await click('.ip-acts [data-act="fav"]');
  d = await data();
  ok(d.favs[0]?.out === '¿Dónde está la estación de tren?', 'star saves a favourite');
  ok(await page.$eval('.ip-acts [data-act="fav"]', (n) => n.classList.contains('on')), 'the star is filled');
  await click('.ip-acts [data-act="copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '?'));
  ok(clip === '¿Dónde está la estación de tren?' || clip === '?', 'Copy puts the translation on the clipboard (' + clip + ')');
  await click('.ip-acts [data-act="speak"]');
  ok(await page.$eval('.ip-acts [data-act="speak"]', (n) => n.classList.contains('on')), 'read aloud turns into Stop while speaking');
  const spoken = await page.evaluate(() => window.__spoken.at(-1));
  ok(spoken?.[0] === '¿Dónde está la estación de tren?' && spoken?.[1] === 'es-ES', 'speaks with the local Spanish voice');
  await sleep(1000);
  ok(!(await page.$eval('.ip-acts [data-act="speak"]', (n) => n.classList.contains('on'))), 'and comes back when speech ends');
  await shot(P + 'interpreter-03-text');
  // swap
  await click('.ip-text .ip-swap');
  d = await data();
  ok(d.from === 'es' && d.to === 'en', 'Swap swaps the languages');
  ok((await value('.ip-input')) === '¿Dónde está la estación de tren?', 'Swap moves the translation into the input');
  ok(await waitText('.ip-output', '[en] ¿Dónde está'), 'and translates it back');
  // a language pack that needs downloading
  await typeIn('.ip-input', 'Hello');
  await pick('from', 'en');
  await pick('to', 'ja');
  await sleep(700);
  ok(await visible('.ip-note [data-act="download"]'), 'a missing language pack asks to download first');
  await shot(P + 'interpreter-04-download');
  await click('.ip-note [data-act="download"]');
  ok(await page.waitForSelector('.ip-note .ip-prog', { timeout: 1500 }).then(() => true, () => false), 'shows download progress');
  ok(await waitText('.ip-output', 'こんにちは', 5000), 'Download fetches the pack, then translates');
  ok(await page.$eval('.ip-output', (n) => n.lang === 'ja'), 'the Japanese result is marked lang=ja for its glyphs');
  // Auto detect with Arabic (right to left even in the English UI)
  await pick('from', 'auto');
  await pick('to', 'en');
  await typeIn('.ip-input', 'مرحبا بك');
  ok(await waitText('.ip-output', 'Welcome'), 'Auto detect finds Arabic and translates');
  ok(await visible('.ip-det'), '“Detected” shows next to the detected language');
  ok(await page.$eval('.ip-input', (n) => getComputedStyle(n).direction === 'rtl' && n.lang === 'ar'), 'Arabic input runs right to left');
  ok(await page.$eval('.ip-output', (n) => getComputedStyle(n).direction === 'ltr'), 'the English result runs left to right');
  await page.keyboard.press('Enter');
  await sleep(300);
  await typeIn('.ip-input', 'Where is the train station?');
  await pick('from', 'en');
  await pick('to', 'ar');
  ok(await waitText('.ip-output', 'أين محطة القطار؟'), 'English → Arabic');
  ok(await page.$eval('.ip-output', (n) => getComputedStyle(n).direction === 'rtl'), 'the Arabic result runs right to left');
  ok(await page.$eval('.ip-input', (n) => getComputedStyle(n).direction === 'ltr'), 'the English input runs left to right in any UI language');
  await page.click('.ip-input');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot(P + 'interpreter-05-rtl');
  // picking the source language as the target swaps them
  await pick('to', 'en');
  d = await data();
  ok(d.from === 'ar' && d.to === 'en', `picking the source as the target swaps them (${d.from}→${d.to})`);
  // a pair Chrome can't translate
  await setData({ from: 'en', to: 'kn' });
  await sleep(200);
  await typeIn('.ip-input', 'Good morning');
  ok(await waitText('.ip-note', tr('isn’t available', 'غير متوفرة')), 'an unsupported pair says it isn’t available');

  // ——— 4. History ———
  await setData({ from: 'en', to: 'es' });
  await typeIn('.ip-input', 'Thank you very much');
  ok(await waitText('.ip-output', 'Muchas gracias'), 'third phrase');
  await page.keyboard.press('Enter');
  await sleep(400);
  ok(await count('.ip-hist .ip-row') >= 3, 'History under the cards (' + await count('.ip-hist .ip-row') + ')');
  const firstHist = await page.$eval('.ip-hist .ip-row', (n) => n.dataset.id);
  const box = await (await page.$('.ip-hist .ip-row')).boundingBox();
  await page.mouse.click(box.x + 60, box.y + box.height / 2, { button: 'right' });
  await sleep(300);
  ok(await count('.ou-menu-item') >= 4, 'a History row has a menu (Copy, Read aloud, Favourite, Delete)');
  await page.evaluate(() => [...document.querySelectorAll('.ou-menu-item')].at(-1).click());
  await sleep(450);
  d = await data();
  ok(!d.history.some((x) => x.id === firstHist), 'Delete removes the History entry');
  const favN = d.favs.length;
  await page.evaluate(() => [...document.querySelectorAll('.ip-hist .ip-row .ip-star')].find((b) => !b.classList.contains('on'))?.click());
  await sleep(350);
  ok((await data()).favs.length === favN + 1, 'the star in a History row adds a favourite');
  const histSrc = await page.$eval('.ip-hist .ip-row .ip-row-src', (n) => n.textContent);
  await click('.ip-hist .ip-row .ip-row-src');
  ok((await value('.ip-input')) === histSrc, 'tapping a History entry opens it');
  await shot(P + 'interpreter-06-history');

  // ——— 5. Favourites ———
  await tab('favs');
  d = await data();
  ok(await count('.ip-fav') === d.favs.length && d.favs.length >= 2, 'Favourites lists every favourite (' + d.favs.length + ')');
  ok((await text('.ip-favs-page .app-hero-sub')).includes(String(d.favs.length)), 'the subtitle counts them');
  await click('.ip-fav [data-act="speak"]');
  ok((await page.evaluate(() => window.__spoken.at(-1)))?.[0] === d.favs[0].out, 'read a favourite aloud');
  await shot(P + 'interpreter-07-favourites');
  await click('.ip-fav .ip-fav-out');
  ok(await exists('.ip-text-page') && (await value('.ip-input')) === d.favs[0].src, 'tapping a favourite opens it in Text');
  await tab('favs');
  await click('.ip-fav .ip-star');
  ok((await data()).favs.length === d.favs.length - 1, 'the filled star removes the favourite');

  // ——— 6. Conversation ———
  await tab('convo');
  await pick('cv-a', 'en');
  await pick('cv-b', 'es');
  d = await data();
  ok(d.convo.a === 'en' && d.convo.b === 'es', 'each half picks its language');
  ok(await exists('.ip-split.f2f'), 'split screen, face to face by default');
  ok(await page.$eval('.ip-half.top', (n) => getComputedStyle(n).transform.startsWith('matrix(-1')), 'the top half is turned around for the person opposite');
  ok(await waitText('.ip-half.top .ip-cv-hint', '[es]'), 'the other person is greeted in their own language');
  ok(await page.$$eval('.ip-mic-big', (b) => b.length === 2 && b.every((x) => !x.hidden)), 'a mic on each side with on-device speech recognition');
  await page.type('.ip-half.bottom .ip-comp-in', 'How much does this cost?');
  await page.keyboard.press('Enter');
  ok(await waitText('.ip-half.top .ip-msg:not(.own)', '¿Cuánto cuesta esto?'), 'your words appear translated in the other half');
  ok(await waitText('.ip-half.bottom .ip-msg.own', 'How much does this cost?'), 'and as your own bubble in yours');
  await page.type('.ip-half.top .ip-comp-in', 'Muy bien, ¿y tú?');
  await page.keyboard.press('Enter');
  ok(await waitText('.ip-half.bottom .ip-msg:not(.own)', 'Very well, and you?'), 'the other side is translated for you');
  ok(await waitText('.ip-half.bottom .ip-msg-orig', 'Muy bien'), 'with the original text under it');
  await page.evaluate(() => { window.__say = ['Thank you very much']; });
  await click('.ip-half.bottom .ip-mic-big');
  ok(await waitText('.ip-half.top .ip-msg:not(.own)', 'Muchas gracias', 5000), 'the mic sends what you said, translated');
  const rec = await page.evaluate(() => window.__rec);
  ok(rec?.local === true && rec?.lang === 'en-US', 'speech recognition runs on the device (' + JSON.stringify(rec) + ')');
  d = await data();
  ok(d.convo.msgs.length === 3 && d.convo.msgs[1].side === 'b' && d.convo.msgs[2].out === 'Muchas gracias', 'messages are kept');
  await shot(P + 'interpreter-08-conversation');
  await click('.ip-half.bottom .ip-half-speak');
  ok((await page.evaluate(() => window.__spoken.at(-1)))?.[1] === 'en-US', 'each half reads its latest message aloud in its language');
  await click('.ip-convo-page [data-act="f2f"]');
  ok(!(await exists('.ip-split.f2f')) && (await data()).convo.f2f === false, 'face-to-face view can be turned off');
  await sleep(500);
  const upright = await page.$eval('.ip-half.top', (n) => getComputedStyle(n).transform);
  ok(upright === 'none' || upright === 'matrix(1, 0, 0, 1, 0, 0)', 'then the top half is upright (' + upright + ')');
  await click('.ip-convo-page [data-act="f2f"]');
  await click('.ip-mid .ip-swap');
  d = await data();
  ok(d.convo.a === 'es' && d.convo.b === 'en', 'the middle button swaps the two languages');
  await click('.ip-mid .ip-swap');
  await click('.ip-convo-page .app-toolbar-actions .ou-icon-btn:last-child');
  await menuItem(tr('Clear conversation', 'مسح المحادثة'));
  await click('.ou-dialog-btn.danger');
  await sleep(300);
  ok((await data()).convo.msgs.length === 0, 'Clear conversation empties it');

  // ——— 7. Listening mode ———
  await setData({ listen: { from: 'es', to: 'en', lines: [] } });
  await tab('listen');
  ok(await visible('.ip-listen-btn') && !(await exists('.ip-na')), 'Listening mode with on-device speech recognition');
  await page.evaluate(() => { window.__say = ['Buenos días', 'Está a la derecha']; });
  await click('.ip-listen-btn');
  ok(await page.$eval('.ip-listen-btn', (n) => n.classList.contains('on')), 'Start listening turns into Stop');
  ok(await waitText('.ip-line-out', 'It is on the right', 5000), 'what the speaker says is captioned in your language');
  ok(await waitText('.ip-line-src', 'Buenos días'), 'with the original under it');
  ok((await page.evaluate(() => window.__rec))?.continuous === true, 'it keeps listening');
  await shot(P + 'interpreter-09-listening');
  await click('.ip-listen-btn');
  await sleep(300);
  ok(!(await page.$eval('.ip-listen-btn', (n) => n.classList.contains('on'))), 'Stop stops');
  d = await data();
  ok(d.listen.lines.length === 2 && d.listen.lines[0].out === 'Good morning', 'the transcript is kept');

  // ——— 8. Language packs ———
  await tab('text');
  await click('.ip-text-page .app-toolbar-actions .ou-icon-btn');
  await menuItem(tr('Language packs', 'حزم اللغات'));
  await page.waitForSelector('.ip-packs-page [data-group]', { timeout: 4000 }).catch(() => {});
  ok(await exists('.ip-packs-page [data-group="downloaded"] [data-code="en"]'), 'English is built in');
  ok(await exists('.ip-packs-page [data-group="downloaded"] [data-code="ja"]'), 'the Japanese pack downloaded earlier is listed as downloaded');
  ok(await exists('.ip-packs-page [data-group="availableDl"] [data-dl="ko"]'), 'Korean can be downloaded');
  ok(await exists('.ip-packs-page [data-group="notAvailable"] [data-code="kn"]'), 'Kannada is not available');
  await shot(P + 'interpreter-10-packs');
  await click('.ip-packs-page [data-dl="ko"]');
  ok(await page.waitForSelector('.ip-packs-page .ip-ring', { timeout: 1500 }).then(() => true, () => false), 'a progress ring while it downloads');
  ok(await page.waitForSelector('.ip-packs-page [data-group="downloaded"] [data-code="ko"]', { timeout: 4000 }).then(() => true, () => false), 'then Korean moves to Downloaded');
  await click('.ip-packs-page .app-back');
  await sleep(400);

  // ——— 9. Settings ———
  await click('.ip-text-page .app-toolbar-actions .ou-icon-btn');
  await menuItem(tr('Settings', 'الإعدادات'));
  await page.waitForSelector('.ip-settings-page input[data-pref="typing"]', { timeout: 3000 });
  await shot(P + 'interpreter-11-settings');
  await page.evaluate(() => document.querySelector('.ip-settings-page input[data-pref="typing"]').closest('.ou-row').click());
  await sleep(200);
  ok((await prefs()).typing === false, 'Translate as you type can be turned off');
  await page.evaluate(() => [...document.querySelectorAll('.ip-settings-page .ou-seg-btn')].at(-1).click());
  ok((await prefs()).rate === 1.25, 'speech rate');
  await click('.ip-settings-page .app-back');
  await sleep(400);
  await setData({ from: 'en', to: 'es' });
  await typeIn('.ip-input', 'Good morning');
  await sleep(700);
  ok(!(await text('.ip-output')) && await visible('.ip-go'), 'then a Translate button does it');
  await click('.ip-go');
  ok(await waitText('.ip-output', 'Buenos días'), 'Translate translates');
  await page.evaluate(() => import('./js/core/store.js').then(({ store: s }) => s.update('interpreterPrefs', (p) => ({ ...p, typing: true }))));
  await closeApp();

  // ——— 10. Finder command ———
  await mod('./js/shell/finder.js', 'openFinder');
  await page.waitForSelector('#finder.show .finder-input', { timeout: 3000 }).catch(() => {});
  await sleep(300);
  // the query goes in as one input event, as typing it would end
  const ask = async (q) => {
    await page.focus('.finder-input');
    await page.evaluate((x) => { const i = document.querySelector('.finder-input'); i.value = x; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  };
  await ask('translate Good morning to Spanish');
  ok(await waitText('.ip-fr-out', 'Buenos días'), 'Finder: “translate Good morning to Spanish” answers inline');
  ok(await waitText('.ip-fr-sub', tr('English → Spanish', 'الإنجليزية ← الإسبانية')), 'with the detected pair');
  await shot(P + 'interpreter-12-finder');
  await ask('ترجم صباح الخير إلى الإنجليزية');
  ok(await waitText('.ip-fr-out', 'Good morning'), 'Finder: Arabic phrasing works too');
  await page.evaluate(() => window.__dl.add('de'));
  await ask('translate thanks to german');
  ok(await waitText('.ip-fr-out.ip-fr-msg', tr('Download German', 'الألمانية')), 'a missing pack is offered in the app, not downloaded from Finder');
  await ask('ترجم صباح الخير إلى الإنجليزية');
  await waitText('.ip-fr-out', 'Good morning');
  await page.keyboard.press('Enter');
  await sleep(900);
  ok(await exists('.ip-text-page') && (await value('.ip-input')) === 'صباح الخير', 'Enter opens Interpreter with the text');
  ok(await waitText('.ip-output', 'Good morning') && (await data()).to === 'en', 'and the same translation');
  await closeApp();

  // ——— 11. widgets and the Quick Panel tile ———
  await sleep(300);
  ok(await count('.wg-interp') === 2, 'small and medium widgets on the Home screen');
  ok(await exists('.wg-interp.w-m.fav .wg-interp-out'), 'the medium one shows the newest favourite phrase');
  ok(await exists('.wg-interp.w-s .wg-interp-field'), 'the small one is a quick translate field');
  await shot(P + 'interpreter-13-widgets');
  await click('.wg-interp.w-s .wg-interp-btn');
  await sleep(500);
  ok(await exists('.ip-convo-page'), 'the widget’s conversation button opens Conversation mode');
  await closeApp();
  await mod('./js/shell/quickpanel.js', 'openQuickPanel');
  await sleep(500);
  const tile = AR ? 'المترجم الفوري' : 'Interpreter';
  ok(await exists(`.qp-tile[title="${tile}"]`), 'Quick Panel has an Interpreter tile');
  await shot(P + 'interpreter-14-quickpanel');
  await page.evaluate((x) => document.querySelector(`.qp-tile[title="${x}"]`).click(), tile);
  await sleep(1000);
  ok(await exists('.ip-convo-page .ip-split'), 'the tile opens Conversation mode');

  // ——— 12. full screen (maximize) ———
  await page.evaluate(() => document.querySelector('.app-win').classList.add('max'));
  await sleep(500);
  await shot(P + 'interpreter-15-convo-max');
  await tab('text');
  await typeIn('.ip-input', 'Where is the train station?');
  await waitText('.ip-output', '¿Dónde');
  await sleep(300);
  ok(await page.$eval('.ip-cards', (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length === 2), 'full screen puts the cards side by side');
  ok(await page.$eval('.ip-text-page .app-scroll', (n) => n.scrollWidth <= n.clientWidth + 1), 'nothing overflows sideways');
  await shot(P + 'interpreter-16-text-max');
  await closeApp();

  // ——— Modes and Routines: Translate text (its result is the routine's next input) ———
  const ia = await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => { const a = A.ACTIONS['interpreter.translate']; return a && { name: I.t(a.name), out: I.t(a.out), to: a.params[1].opts.length, from: a.params[2].opts[0][0] }; }));
  ok(ia && !ia.name.startsWith('interpreter.') && !ia.out.startsWith('interpreter.') && ia.to >= 39 && ia.from === 'auto', 'Routines lists Translate text with a result and every language (' + JSON.stringify(ia) + ')');
  let ra = await runAction('interpreter.translate', { text: 'Good morning', to: 'es', from: 'auto' });
  ok(ra.v === 'Buenos días', 'Translate text returns the translation (' + JSON.stringify(ra) + ')');
  ra = await runAction('interpreter.translate', { text: 'مرحبا بك', to: 'en' });
  ok(ra.v === 'Welcome', 'with Auto detect it finds the source language');
  ra = await runAction('interpreter.translate', { text: 'Hello', to: 'kn', from: 'en' });
  ok(ra.err === 'interpreter.pairNA', 'a pair the device can’t translate is an error');
  ra = await runAction('interpreter.translate', { text: ' ', to: 'es' });
  ok(ra.err === 'interpreter.ra.errEmpty', 'no text is an error');

  // ——— the quick-translate widget's settings: its own language pair ———
  await page.evaluate(() => import('./js/core/widgets.js').then((m) => { window.__wc = m.getWidget('interpreter').configure({}); }));
  await page.waitForSelector('.ou-dialog .ip-wcfg select', { timeout: 4000 });
  ok(await count('.ou-dialog .ip-wcfg select') === 2 && await page.$eval('.ou-dialog .ip-wcfg select', (x) => x.options[0].value === 'auto'), 'the widget’s settings: Translate from (with Auto detect) and Translate to');
  await shot(P + 'interpreter-17-widget-config');
  await page.evaluate(() => { const [a, b] = document.querySelectorAll('.ou-dialog .ip-wcfg select'); a.value = 'en'; b.value = 'ja'; });
  await click('.ou-dialog .ou-dialog-btn.primary');
  const wc = await page.evaluate(() => window.__wc);
  ok(wc?.from === 'en' && wc.to === 'ja', 'and return the pair (' + JSON.stringify(wc) + ')');
  const langs = await page.evaluate((config) => import('./js/core/widgets.js').then((m) => {
    const b = document.createElement('div'); b.className = 'wg w-s'; document.body.appendChild(b);
    const off = m.getWidget('interpreter').render(b, { size: 's', item: {}, config }); const tx = b.querySelector('.wg-interp-langs')?.textContent; off?.(); b.remove(); return tx;
  }), wc);
  ok(/Japanese|اليابانية/.test(langs || ''), 'the widget shows its pair (' + langs + ')');
  await page.evaluate((config) => import('./js/core/widgets.js').then((m) => m.getWidget('interpreter').onClick({ size: 's', config }, document.body)), wc);
  await sleep(900);
  const dd = await data();
  ok(dd.to === 'ja' && dd.from === 'en', 'tapping it opens Interpreter on that pair');
  await closeApp();
};
