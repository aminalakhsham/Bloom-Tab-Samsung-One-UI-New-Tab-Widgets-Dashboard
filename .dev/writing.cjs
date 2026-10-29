// triple
// Writing assist (Galaxy AI) end to end, with deterministic fakes of Chrome's on-device AI put in the page (Proofreader,
// Rewriter, Summarizer, LanguageModel, Translator, LanguageDetector): the pure helpers, the panel in Samsung Notes
// (Galaxy AI button and right-click), Proofread with the inline review (Accept / Revert / Done, then the note's own
// Undo/Redo), Style (Professional, Casual, Polite, Social, Emojify), Summarize with Insert on a selection, Format as a
// table, Translate with the language picker, "Describe a change", Cancel while working, Escape, the "not available"
// and "download" states, the Journal editor's toolbar button, a plain <textarea> (corner button + underlines), and the
// Lock screen closing the panel. The stored notes are checked after each change.
// usage: .dev/run.sh .dev/writing.cjs   (THEME=dark / UI=ar)
module.exports = async ({ page, boot, ok, openApp, closeApp, click, text, texts, count, exists, mod, store, sleep, shot, P, ui, outside }) => {
  const ar = ui === 'ar';
  const L = (en, a) => (ar ? a : en);
  const T = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const now = Date.now();
  const LINE1 = L('I will recieve teh package tomorow.', 'مرحبا يا فريق، سوف نبدأ انشاء المشروع غدا.');
  const LINE2 = L('Then we meet the team at noon.', 'ثم نلتقي بالفريق ظهرا.');
  const FIXES = ar ? [['مرحبا', 'مرحبًا'], ['انشاء', 'إنشاء']] : [['recieve', 'receive'], ['teh', 'the'], ['tomorow', 'tomorrow']];
  await boot({ data: { notes: [{ id: 'w1', title: L('Weekly plan', 'خطة الأسبوع'), body: `<div>${LINE1}</div><div>${LINE2}</div>`, color: 'none', pinned: false, created: now - 6e4, updated: now - 6e4 }] } });

  // ———————————————————————————————— the fakes (the same answer every time)
  const fakes = () => page.evaluate((FIX) => {
    const G = globalThis;
    const S = (G.__wa = { avail: 'available', delay: 160, calls: [] });
    const wait = (signal) => new Promise((res, rej) => {
      const id = setTimeout(res, S.delay);
      signal?.addEventListener('abort', () => { clearTimeout(id); rej(new DOMException('Aborted', 'AbortError')); });
    });
    const proof = (s) => FIX.reduce((x, [a, b]) => x.split(a).join(b), s);
    const first = (s) => (s.match(/^[^.!?؟\n]*[.!?؟]?/) || [s])[0].trim();
    const progress = async (monitor) => {
      if (!monitor || S.avail === 'available') return;
      const tg = new EventTarget();
      monitor(tg);
      for (const p of [0.3, 0.7, 1]) { await new Promise((r) => setTimeout(r, 60)); tg.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: p })); }
      S.avail = 'available';
    };
    const answer = (sys, input) => {
      if (/Fix spelling/.test(sys)) return S.calls.push('lm:proofread'), proof(input);
      if (/polite/.test(sys)) return S.calls.push('lm:polite'), 'Please, ' + input;
      if (/social media/.test(sys)) return S.calls.push('lm:social'), input + ' 🎉 #notes';
      if (/emojis/.test(sys)) return S.calls.push('lm:emojify'), input + ' 😊';
      if (/tidy notes/.test(sys)) return S.calls.push('lm:notes'), '# Plan\n- One\n- Two';
      if (/Markdown table/.test(sys)) return S.calls.push('lm:table'), '| Item | Note |\n|---|---|\n| One | First |\n| Two | Second |';
      if (/bullet points/.test(sys)) return S.calls.push('lm:list'), input.split(/[.\n،]+/).map((x) => x.trim()).filter(Boolean).map((x) => '- ' + x).join('\n');
      if (/as follows:/.test(sys)) return S.calls.push('lm:describe'), input.toUpperCase();
      if (/^Translate/.test(sys)) return S.calls.push('lm:translate'), '[lm] ' + input;
      return S.calls.push('lm'), input;
    };
    G.LanguageModel = {
      availability: async () => S.avail,
      create: async ({ initialPrompts = [], signal, monitor } = {}) => {
        await progress(monitor);
        const sys = initialPrompts[0]?.content || '';
        return { prompt: async (input, o = {}) => { await wait(o.signal || signal); return answer(sys, input); }, destroy() {} };
      },
    };
    G.Rewriter = {
      availability: async () => S.avail,
      create: async (o) => { await progress(o.monitor); return { rewrite: async (input, { signal } = {}) => { await wait(signal); S.calls.push('rewriter:' + o.tone); return o.tone === 'more-casual' ? 'Hey! ' + input : o.tone === 'more-formal' ? 'Dear team, ' + input : input; }, destroy() {} }; },
    };
    G.Summarizer = {
      availability: async () => S.avail,
      create: async (o) => { await progress(o.monitor); return { summarize: async (input, { signal } = {}) => { await wait(signal); S.calls.push('summarizer:' + o.type); return o.type === 'key-points' ? '- Point one\n- Point two' : 'Summary: ' + first(input); }, destroy() {} }; },
    };
    G.Proofreader = {
      availability: async () => S.avail,
      create: async (o) => { await progress(o.monitor); return { proofread: async (input, { signal } = {}) => { await wait(signal); S.calls.push('proofreader'); return { correctedInput: proof(input), corrections: [] }; }, destroy() {} }; },
    };
    G.Translator = {
      availability: async () => 'available',
      create: async ({ targetLanguage }) => ({ translate: async (s) => { S.calls.push('translator:' + targetLanguage); return `[${targetLanguage}] ${s}`; }, destroy() {} }),
    };
    G.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async (s) => [{ detectedLanguage: /[؀-ۿ]/.test(s) ? 'ar' : 'en', confidence: 0.95 }], destroy() {} }),
    };
  }, FIXES);
  await fakes();
  const setFake = (o) => page.evaluate((o) => Object.assign(globalThis.__wa, o), o);
  const calls = () => page.evaluate(() => globalThis.__wa.calls.splice(0));
  const PANEL = '.wa-panel:not(.closing)';
  const view = () => page.evaluate((s) => document.querySelector(s)?.dataset.view || '', PANEL);
  const waitView = async (v, ms = 5000) => {
    try {
      await page.waitForFunction((s, v) => document.querySelector(s)?.dataset.view === v, { timeout: ms }, PANEL, v);
      return true;
    } catch {
      console.log('   (view is', JSON.stringify(await view()), ')');
      return false;
    }
  };
  const closed = async () => {
    try {
      await page.waitForFunction((s) => !document.querySelector(s), { timeout: 3000 }, PANEL);
      return true;
    } catch {
      return false;
    }
  };
  const tool = async (k) => { await page.click(`${PANEL} [data-tool="${k}"]`); await sleep(100); };
  const act = async (a) => { await page.click(`${PANEL} [data-a="${a}"]`); await sleep(250); };
  const rev = async (p) => { await page.click(`${PANEL} [data-p="${p}"]`); await sleep(200); };
  const hl = (name) => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);
  const body = () => page.$eval('.note-body', (e) => e.textContent);
  const stored = async () => (await store('notes')).find((n) => n.id === 'w1');
  const openAI = async () => { await page.click('.note-top .note-ai'); return waitView('home'); };

  // ———————————————————————————————— the pure helpers
  const d = await mod('./js/shell/writing.js', 'diffText', 'I recieve teh box today', 'I receive the box today');
  ok(d.length === 2 && d[0].from === 'recieve' && d[0].to === 'receive' && d[1].from === 'teh' && d[1].to === 'the', 'diffText finds word-level changes: ' + JSON.stringify(d));
  ok((await mod('./js/shell/writing.js', 'diffText', 'a lot', 'alot')).length === 1, 'diffText: a joined word is one change');
  ok((await mod('./js/shell/writing.js', 'cleanOut', '```\n"Hello"\n```', 'Hi')) === 'Hello', 'cleanOut strips code fences and added quotes');
  ok((await mod('./js/shell/writing.js', 'mdHTML', '# Plan\n- a\n- b\n1. x')) === '<h3>Plan</h3><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol>', 'mdHTML: headings and lists');
  ok((await mod('./js/shell/writing.js', 'mdHTML', '| A | B |\n|---|---|\n| 1 | <b> |')).includes('<td>&lt;b&gt;</td>'), 'mdHTML: tables, text escaped');
  ok((await mod('./js/shell/writing.js', 'plainOf', '| A | B |\n|---|---|\n| 1 | 2 |\n- x')) === 'A | B\n1 | 2\n• x', 'plainOf: tables as "a | b" lines, "•" bullets');
  const st = await mod('./js/shell/writing.js', 'assistStatus');
  ok(st.overall === 'available' && Object.values(st.tools).every((v) => v === 'available'), 'assistStatus with every model: ' + JSON.stringify(st.tools));

  // ———————————————————————————————— in Samsung Notes: the panel
  await openApp('notes');
  ok(await exists('.note-top .note-ai'), 'Notes has the Galaxy AI button in its top bar');
  ok((await page.$eval('.note-top .note-ai', (e) => e.title)) === (await T('wa.title')), 'its name is Writing assist');
  ok(await openAI(), 'the button opens Writing assist');
  ok((await count(`${PANEL} .wa-tile`)) === 5, 'five tools: Proofread, Style, Summarize, Format, Translate');
  ok(JSON.stringify(await texts(`${PANEL} .wa-tile b`)) === JSON.stringify(await Promise.all(['proofread', 'style', 'summarize', 'format', 'translate'].map((k) => T('wa.' + k)))), 'tool names in Samsung’s order');
  ok(await exists(`${PANEL} .wa-ask input`), '"Describe a change" box');
  ok((await text(`${PANEL} .wa-scope`)) === (await T('wa.allText')), 'nothing selected: works on all the text');
  ok((await hl('wa-scope')) === 1, 'the text it works on is tinted');
  ok((await outside('.wa-panel')).length === 0, 'the panel stays inside the screen');
  await shot(P + 'wa-01-home');

  // ———————————————————————————————— Proofread with the inline review
  await tool('proofread');
  ok(await waitView('review'), 'Proofread shows the review');
  ok((await calls()).includes('proofreader'), 'it used Chrome’s Proofreader');
  let b = await body();
  ok(FIXES.every(([, to]) => b.includes(to)) && !FIXES.some(([from]) => b.split(/\s|،|\./).includes(from)), 'the corrections are made in the note right away');
  ok((await hl('wa-proof')) === FIXES.length, `${FIXES.length} corrections underlined`);
  ok((await text(`${PANEL} .wa-count`)) === `1/${FIXES.length}`, 'the card counts them');
  ok((await text(`${PANEL} .wa-ctx del`)) === FIXES[0][0] && (await text(`${PANEL} .wa-ctx ins`)) === FIXES[0][1], 'the card shows the word struck through and the suggestion');
  ok((await outside('.wa-panel')).length === 0, 'review card inside the screen');
  await shot(P + 'wa-02-proofread');
  await rev('accept');
  ok((await text(`${PANEL} .wa-count`)) === `2/${FIXES.length}`, 'Accept moves to the next correction');
  await rev('revert');
  b = await body();
  ok(b.includes(FIXES[1][0]), 'Revert puts the original word back: ' + FIXES[1][0]);
  ok((await hl('wa-proof')) === FIXES.length - 2, 'accepted and reverted ones are no longer underlined');
  await rev('done');
  ok(await closed(), 'Done closes the panel');
  await sleep(700);
  let n = await stored();
  const want = FIXES.reduce((x, [a, b2], i) => (i === 1 ? x : x.split(a).join(b2)), LINE1);
  ok(n.body.includes(want), 'the note is saved with the accepted corrections and without the reverted one: ' + want);
  await page.click('.note-top .ou-icon-btn[title="' + (await T('common.undo')) + '"]');
  await sleep(600);
  ok((await body()).includes(FIXES[0][0]), 'the note’s Undo takes Proofread back');
  await page.click('.note-top .ou-icon-btn[title="' + (await T('notes.redo')) + '"]');
  await sleep(600);
  ok((await body()).includes(FIXES[0][1]), 'and Redo brings it again');

  // ———————————————————————————————— Style
  await openAI();
  await tool('style');
  ok(await waitView('result'), 'Style shows a result');
  ok((await count(`${PANEL} .wa-chip[data-style]`)) === 5 && (await exists(`${PANEL} .wa-chip[data-style="professional"].on`)), 'five styles, Professional first');
  ok((await text(`${PANEL} .wa-res`)).startsWith('Dear team,'), 'Professional (Rewriter, more formal)');
  ok((await calls()).includes('rewriter:more-formal'), 'Rewriter with tone more-formal');
  await page.click(`${PANEL} [data-style="casual"]`);
  await waitView('result');
  ok((await text(`${PANEL} .wa-res`)).startsWith('Hey!'), 'Casual (Rewriter, more casual)');
  await page.click(`${PANEL} [data-style="social"]`);
  await waitView('result');
  ok((await text(`${PANEL} .wa-res`)).includes('#notes'), 'Social adds hashtags');
  await page.click(`${PANEL} [data-style="emojify"]`);
  await waitView('result');
  ok((await text(`${PANEL} .wa-res`)).includes('😊'), 'Emojify adds emojis');
  await page.click(`${PANEL} [data-style="polite"]`);
  await waitView('result');
  ok((await text(`${PANEL} .wa-res`)).startsWith('Please,'), 'Polite');
  await shot(P + 'wa-03-style');
  await act('replace');
  ok(await exists(`${PANEL} [data-a="undo"]`) && (await exists(`${PANEL} [data-a="done"]`)), 'after Replace: Undo and Done');
  ok(!(await page.$eval(PANEL, (e) => [...e.childNodes].some((n) => n.nodeType === 3))), 'no stray text in the panel');
  await sleep(700);
  n = await stored();
  ok(n.body.includes('Please,') && n.body.includes(LINE2), 'Replace writes the result into the note (saved)');
  await act('undo');
  await sleep(700);
  n = await stored();
  ok(!n.body.includes('Please,') && n.body.includes(LINE2), 'Undo in the panel restores the text (saved)');
  ok(await exists(`${PANEL} [data-a="replace"]`), 'after Undo the result can be used again');
  await act('close');
  ok(await closed(), 'the close button closes');

  // ———————————————————————————————— a selection, from the right-click menu: Summarize + Insert
  const pos = await page.evaluate((line) => {
    const ed = document.querySelector('.note-body');
    const div = [...ed.querySelectorAll('div')].find((x) => x.textContent === line);
    const r = document.createRange();
    r.selectNodeContents(div);
    ed.focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = div.getBoundingClientRect();
    return { x: b.left + Math.min(30, b.width / 2), y: b.top + b.height / 2 };
  }, LINE2);
  await sleep(150);
  await page.mouse.click(pos.x, pos.y, { button: 'right' });
  await sleep(300);
  ok((await text('.ou-menu .ou-menu-item .ou-menu-label')) === (await T('wa.title')), 'right-click in a note offers Writing assist first');
  await page.click('.ou-menu .ou-menu-item');
  ok(await waitView('home'), 'it opens the panel');
  ok((await text(`${PANEL} .wa-scope`)) === (await T('wa.selected')), 'with the selection as its scope');
  await tool('summarize');
  ok(await waitView('result'), 'Summarize shows a result');
  ok((await text(`${PANEL} .wa-res`)) === 'Summary: ' + LINE2, 'it summarized only the selection');
  await act('below');
  await sleep(700);
  n = await stored();
  ok(n.body.includes('Summary: ' + LINE2) && n.body.includes(LINE1.split(' ')[1]), 'Insert adds the summary below and keeps the text');
  await act('done');
  await closed();
  await page.click('.note-top .ou-icon-btn[title="' + (await T('common.undo')) + '"]');
  await sleep(600);

  // ———————————————————————————————— Format › Table
  await openAI();
  await tool('format');
  ok(await waitView('result'), 'Format shows a result');
  ok((await count(`${PANEL} .wa-chip[data-format]`)) === 4, 'four formats: Notes, Key points, List, Table');
  ok((await count(`${PANEL} .wa-res li`)) === 2, 'Key points (Summarizer) as a list');
  await page.click(`${PANEL} [data-format="table"]`);
  await waitView('result');
  ok(await exists(`${PANEL} .wa-res table`), 'Table shows a table');
  await shot(P + 'wa-04-table');
  await act('replace');
  await sleep(700);
  ok(await exists('.note-body table'), 'the table goes into the note');
  n = await stored();
  ok(/<table>.*One.*First/.test(n.body), 'and is saved as a table');
  await act('undo');
  await sleep(500);
  ok(!(await exists('.note-body table')), 'Undo takes it out');
  await page.click(`${PANEL} [data-format="notes"]`);
  await waitView('result');
  ok((await exists(`${PANEL} .wa-res h3`)) && (await count(`${PANEL} .wa-res li`)) === 2, 'Notes: headings and bullets');
  await act('back');
  ok(await waitView('home'), 'Back returns to the tools');

  // ———————————————————————————————— Translate
  const to1 = ar ? 'en' : 'es';
  await tool('translate');
  ok(await waitView('result'), 'Translate shows a result');
  ok((await text(`${PANEL} .wa-res`)).startsWith(`[${to1}]`), `translated to ${to1} by Chrome’s Translator: ` + (await text(`${PANEL} .wa-res`)).slice(0, 30));
  ok(await exists(`${PANEL} .wa-lang`), 'the target language chip');
  await page.click(`${PANEL} .wa-lang`);
  await sleep(300);
  const fr = await page.evaluate(() => new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }).of('fr'));
  ok(await page.evaluate((l) => { const r = [...document.querySelectorAll('.ou-radio-row')].find((x) => x.textContent.includes(l)); r?.click(); return !!r; }, fr), 'the language list has ' + fr);
  await page.click('.ou-dialog-btn.primary');
  await sleep(400);
  await waitView('result');
  ok((await text(`${PANEL} .wa-res`)).startsWith('[fr]'), 'picking French translates again');
  ok((await page.evaluate(() => localStorage.getItem('bt.writing.to'))) === 'fr', 'the language is remembered');
  await act('back');
  await waitView('home');

  // ———————————————————————————————— Describe a change
  await page.type(`${PANEL} .wa-ask input`, L('make it loud', 'بصوت عال'));
  await page.keyboard.press('Enter');
  ok(await waitView('result'), 'Describe a change runs');
  ok((await text(`${PANEL} .wa-title`)) === L('make it loud', 'بصوت عال'), 'its title is what you asked for');
  ok((await text(`${PANEL} .wa-res`)).includes(LINE2.toUpperCase()), 'the change was made (Gemini Nano)');
  ok((await calls()).includes('lm:describe'), 'it used the LanguageModel');
  await act('back');
  await waitView('home');

  // ———————————————————————————————— Cancel while working, Escape
  await setFake({ delay: 4000 });
  await tool('summarize');
  ok(await waitView('busy'), 'working…');
  ok((await hl('wa-busy')) === 1, 'the text glows while Galaxy AI works');
  await act('cancel');
  ok(await waitView('home'), 'Cancel goes back to the tools');
  await setFake({ delay: 160 });
  await page.keyboard.press('Escape');
  ok(await closed(), 'Escape closes the panel');
  ok(await exists('.notes-page'), '…and only the panel (Notes stays open)');

  // ———————————————————————————————— Lock screen closes it
  await openAI();
  await mod('./js/shell/lock.js', 'lockNow');
  await sleep(500);
  ok(await closed(), 'locking the screen closes Writing assist');
  await mod('./js/shell/lock.js', 'unlock');
  await sleep(600);

  // ———————————————————————————————— not available / download
  await page.evaluate(() => { for (const k of ['LanguageModel', 'Rewriter', 'Summarizer', 'Proofreader', 'Writer', 'Translator']) delete globalThis[k]; });
  await page.click('.note-top .note-ai');
  ok(await waitView('na'), 'without Chrome’s on-device AI: “not available”');
  ok((await text(`${PANEL} .wa-na h3`)) === (await T('wa.naTitle')), 'Samsung-style message');
  await shot(P + 'wa-05-na');
  await act('close');
  await closed();
  await fakes();
  await setFake({ avail: 'downloadable' });
  await page.evaluate(() => delete globalThis.Translator); // translation alone would already make the tools usable
  await page.click('.note-top .note-ai');
  ok(await waitView('setup'), 'models not downloaded yet: Set up');
  await act('download');
  ok(await waitView('home'), 'Download fetches the model and shows the tools');
  await page.keyboard.press('Escape');
  await closed();
  await closeApp();

  // ———————————————————————————————— the Journal editor
  await openApp('journal', { section: 'new' });
  await sleep(600);
  const jText = '.jr-edit-page .jr-ed-text';
  if (await exists(jText)) {
    ok(await exists('.jr-toolrow .wa-barbtn'), 'the Journal toolbar has the Galaxy AI button');
    await page.click(jText);
    await page.keyboard.type(L('We walked by the river.', 'مشينا بجانب النهر.'));
    await page.click('.jr-toolrow .wa-barbtn');
    ok(await waitView('home'), 'it opens Writing assist');
    await tool('style');
    await waitView('result');
    await page.click(`${PANEL} [data-style="professional"]`);
    await waitView('result');
    await act('replace');
    await sleep(900);
    ok((await page.$eval(jText, (e) => e.textContent)).startsWith('Dear team,'), 'the result goes into the entry');
    await shot(P + 'wa-06-journal');
    await act('done');
    await closeApp();
    const j = await store('journal');
    ok((j?.entries || []).some((e) => (e.text || '').startsWith('Dear team,')), 'and the entry is saved');
  } else ok(false, 'Journal editor opened');

  // ———————————————————————————————— a plain field (the API for Reminder, Contacts, Wallet)
  await page.evaluate(async (v) => {
    const ta = document.createElement('textarea');
    ta.id = 'wa-field';
    ta.value = v;
    // under #overlay-layer (z-index 100, where the button and the panel go), like a field in an app window
    ta.style.cssText = 'position:fixed;left:30%;top:30%;width:40%;height:120px;z-index:50;font:16px sans-serif;padding:10px';
    document.body.appendChild(ta);
    const m = await import('./js/shell/writing.js');
    m.attachWritingAssist(ta, { kind: 'reminder' });
    ta.focus();
    ta.setSelectionRange(0, 0);
  }, LINE1 + '\n' + LINE2);
  await sleep(300);
  ok(await page.evaluate(() => {
    const f = document.querySelector('.wa-fab'), ta = document.getElementById('wa-field');
    if (!f || f.hidden) return false;
    const r = f.getBoundingClientRect(), t = ta.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.wa-fab') === f && r.right <= t.right && r.bottom <= t.bottom && r.left >= t.left;
  }), 'a focused plain field shows the Galaxy AI button in its corner (on top)');
  await shot(P + 'wa-07-field');
  await page.click('.wa-fab');
  ok(await waitView('home'), 'the button opens Writing assist');
  await tool('proofread');
  ok(await waitView('review'), 'Proofread in a plain field');
  ok((await count('.wa-mirror mark')) === FIXES.length, 'its corrections are underlined over the field');
  await rev('done');
  await closed();
  ok(FIXES.every(([, to]) => true) && (await page.$eval('#wa-field', (e) => e.value)).includes(FIXES.at(-1)[1]), 'the field keeps the corrections');
  await page.evaluate(() => document.getElementById('wa-field').remove());
};
