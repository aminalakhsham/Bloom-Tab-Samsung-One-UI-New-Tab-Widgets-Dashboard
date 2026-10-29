// triple
// Samsung Calculator end to end: keypad (digits, operators, %, +/−, ( ), decimal point, ⌫, C) with the live result and
// thousands separators, = (result in green, History entry with parentheses closed), Samsung's toasts (divide by 0,
// invalid format, 15 digits), the keyboard (Arabic-Indic digits too), paste, copy, Scientific mode (Rad/Deg, ⇄ second
// functions, √ ∛ ʸ√x x² xʸ x! eˣ 10ˣ ln log 1/x |x| π e), History over the digit keys (reuse an expression or a
// result, clear, 60 entries), the Unit converter (Samsung's 8 categories, unit menus, swap, either field typed,
// temperature sign, keyboard) and the Tip calculator, Finder commands, params, a full-screen window and RTL.
// usage: .dev/run.sh .dev/calculator.cjs   (THEME=dark / UI=ar too)
module.exports = async ({ page, boot, ok, openApp, closeApp, text, texts, count, exists, sleep, shot, P, store, setStorage, outside, mod, ui, logs }) => {
  const tr = (k, v) => mod('./js/core/i18n.js', 't', k, v);
  const AR = ui === 'ar';
  const q = (s) => s.replace(/"/g, '\\"');
  // keys are clicked with the mouse: the main/scientific pad by data-k, ⌫ in the toolbar
  const press = async (...keys) => {
    for (const k of keys) {
      const sel = k === 'back' ? '.calc-back-key' : `.calc-pad .calc-key[data-k="${q(k)}"]`;
      const el = await page.$(sel);
      if (!el) { ok(false, `key ${k} exists (${sel})`); continue; }
      await el.click();
      await sleep(25);
    }
    await sleep(60);
  };
  const cpress = async (...keys) => {
    for (const k of keys) {
      const el = await page.$(`.calc-conv-pad .calc-key[data-k="${q(k)}"]`);
      if (!el) { ok(false, `converter key ${k} exists`); continue; }
      await el.click();
      await sleep(25);
    }
    await sleep(60);
  };
  const expr = () => text('.calc-expr');
  const preview = () => text('.calc-preview');
  const hist = async () => (await store('calc'))?.history || [];
  const prefs = async () => (await store('calcPrefs')) || {};
  const tool = (i) => page.click(`.calc-tools .calc-tool:nth-child(${i})`).then(() => sleep(250));
  const fmt = (n) => mod('./js/calc/model.js', 'formatNumber', n);
  const disp = (s) => mod('./js/calc/model.js', 'display', s);
  const toastText = () => text('.ou-toast span');
  const clearToast = () => page.evaluate(() => document.querySelectorAll('.ou-toast').forEach((t) => t.remove()));
  const vals = () => texts('.calc-conv-value');
  // puppeteer types characters missing from its US layout as text input without keydown, so an Arabic keyboard's
  // keydown events are sent by hand
  const keys = (str) => page.evaluate((s) => { for (const key of s) (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }, str).then(() => sleep(100));

  await boot({ data: { home: [[]], dock: [], calc: { history: [] } } });
  await page.evaluate(() => {
    window.__clip = [];
    navigator.clipboard.writeText = (s) => (window.__clip.push(s), Promise.resolve());
  });
  await openApp('calculator');
  ok(await exists('.app-win .calc'), 'Calculator opens');
  ok((await count('.calc-pad .calc-key')) === 20, 'keypad has 20 keys');
  ok((await expr()) === '0' && (await exists('.calc-expr.empty')), 'display starts at 0 (dimmed)');
  ok(!(await exists('.calc-pad.with-sci')), 'scientific keys hidden at first');
  ok((await count('.calc-tools .calc-tool')) === 3 && (await exists('.calc-back-key[disabled]')), 'toolbar: History, Unit converter, Scientific; ⌫ disabled while empty');
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('.calc')).direction)) === 'ltr', 'keypad is laid out LTR in every language');
  ok((await outside('.calc-key', '.app-win')).length === 0, 'every key lies inside the window');
  const keyBox = await page.evaluate(() => { const r = document.querySelector('.calc-key[data-k="5"]').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(keyBox.h >= 56 && keyBox.w >= keyBox.h, `round keys of a good size (${Math.round(keyBox.w)}×${Math.round(keyBox.h)})`);
  await shot(P + 'calc-01-keypad');

  // ——— arithmetic, live result, =, History entry ———
  await press('1', '2', '+', '3', '*', '4');
  ok((await expr()) === '12+3×4', `typed 12+3×4 (got ${await expr()})`);
  ok((await preview()) === '24', `live result 24 under the expression (got ${await preview()})`);
  await press('=');
  ok((await expr()) === '24' && (await preview()) === '' && (await exists('.calc-expr.result')), 'equals shows 24 (in green) and clears the preview');
  let h = await hist();
  ok(h.length === 1 && h[0].expr === '12+3*4' && h[0].result === 24 && h[0].time > Date.now() - 60e3, 'History entry {expr, result, time} saved in calc.history');
  await press('5');
  ok((await expr()) === '5' && !(await exists('.calc-expr.result')), 'a digit after a result starts a new calculation');
  await press('C');
  ok((await expr()) === '0' && (await exists('.calc-expr.empty')), 'C clears');
  await press('7', '*', '6', '=', '+', '8', '=');
  ok((await expr()) === '50', `an operator after a result continues from it (7×6=42, +8 = 50; got ${await expr()})`);
  h = await hist();
  ok(h.length === 3 && h[0].expr === '42+8' && h[0].result === 50, 'newest History entry first (42+8)');
  await press('C', '5', '=');
  ok((await hist()).length === 3, '"5 =" is not a calculation: History unchanged');

  // ——— thousands separators while typing and after = (bug: the result had none) ———
  await press('C', '1', '2', '3', '4', '5', '6', '7', '+', '1');
  ok((await expr()) === '1,234,567+1' && (await preview()) === '1,234,568', `numbers are grouped as you type (got ${await expr()} → ${await preview()})`);
  await press('=');
  ok((await expr()) === '1,234,568', `the result after = is grouped too (got ${await expr()})`);
  await press('*', '1', '0', '0', '0', '=');
  ok((await expr()) === '1,234,568,000', `continuing from a grouped result (got ${await expr()})`);
  await press('.');
  ok((await expr()) === '0.', '"." after a result starts 0.');

  // ——— decimal point, leading zeros, operator replacement, +/−, ( ), % ———
  await press('C', '.', '.', '5');
  ok((await expr()) === '0.5', `"." starts with 0. and only once per number (got ${await expr()})`);
  await press('+', '.', '2', '=');
  ok((await expr()) === '0.7', `0.5+0.2 = 0.7 without float noise (got ${await expr()})`);
  await press('C', '0', '0', '7');
  ok((await expr()) === '7', 'leading zeros are dropped');
  await press('C', '5', '+', '*', '2');
  ok((await expr()) === '5×2', 'a second operator replaces the first');
  await press('C', '5', '+/-');
  ok((await expr()) === '(−5', `+/− wraps the number as (−5 (got ${await expr()})`);
  await press('+/-');
  ok((await expr()) === '5', '+/− again removes the sign');
  await press('C', '2', '()', '3', '+', '4', '()');
  ok((await expr()) === '2×(3+4)' && (await preview()) === '14', `( ) opens and closes, with the × Samsung writes: 2×(3+4) → 14 (got ${await expr()} / ${await preview()})`);
  await press('=');
  ok((await expr()) === '14', '2×(3+4) = 14');
  await press('C', '5', '0', '+', '1', '0', '%', '=');
  ok((await expr()) === '55', `50+10% = 55 like Samsung Calculator (got ${await expr()})`);
  await press('C', '2', '0', '0', '*', '1', '5', '%', '=');
  ok((await expr()) === '30', `200×15% = 30 (got ${await expr()})`);
  await press('C', '5', '-', '8', '=');
  ok((await expr()) === '−3', 'negative result');
  await press('+/-');
  ok((await expr()) === '3', '+/− on a negative result flips it');

  // ——— Samsung's toasts: nothing saved ———
  const before = (await hist()).length;
  await press('C', '1', '/', '0', '=');
  ok((await toastText()) === (await tr('calc.divZero')), `division by zero: "${await tr('calc.divZero')}"`);
  ok((await expr()) === '1÷0' && (await hist()).length === before, 'the input stays on screen and is not saved');
  await clearToast();
  await press('C', '+', '=');
  ok((await toastText()) === (await tr('calc.invalid')) && (await hist()).length === before, '0+ = shows "Invalid format used." and is not saved');
  await clearToast();
  await press('C', ...'1234567890123456'.split(''));
  ok((await toastText()) === (await tr('calc.maxDigits')) && (await expr()) === '123,456,789,012,345', `16th digit refused with "${await tr('calc.maxDigits')}" (got ${await expr()})`);
  await clearToast();
  await press('C', '9', '0', '.', '5');
  ok((await expr()) === '90.5', `keys keep working after a toast (got ${await expr()})`);

  // ——— ⌫ ———
  await press('C', '1', '2', '3', 'back');
  ok((await expr()) === '12', '⌫ deletes one digit');
  await press('back', 'back');
  ok((await expr()) === '0' && (await exists('.calc-back-key[disabled]')), '⌫ empties the display and disables itself');

  // ——— keyboard, Arabic-Indic digits, paste, copy ———
  await press('C');
  await page.keyboard.type('12*3');
  await sleep(100);
  ok((await expr()) === '12×3', `typed on the keyboard: 12×3 (got ${await expr()})`);
  await page.keyboard.press('Enter'); await sleep(100);
  ok((await expr()) === '36', 'Enter evaluates (36)');
  await page.keyboard.press('Delete'); await sleep(80);
  ok((await expr()) === '0', 'Delete clears');
  await page.keyboard.type('(2+3)^2'); await sleep(80);
  ok((await expr()) === '(2+3)^2' && (await preview()) === '25', `keyboard parentheses and ^ (got ${await expr()} → ${await preview()})`);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.type('x4='); await sleep(100);
  ok((await expr()) === '20', `Backspace, x as ×, = evaluates (got ${await expr()})`);
  await page.keyboard.press('Delete');
  await keys('١٢٣٤+٥');
  ok((await expr()) === '1,234+5' && (await preview()) === '1,239', `Arabic-Indic digits from the keyboard (got ${await expr()} → ${await preview()})`);
  ok((await exists('.app-win .calc')) && !(await mod('./js/shell/finder.js', 'isFinderOpen')), 'typing in the calculator does not open Finder');
  await page.keyboard.press('Delete');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '١٬٢٣٤ × ٢');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(100);
  ok((await expr()) === '1,234×2' && (await preview()) === '2,468', `pasting "١٬٢٣٤ × ٢" (got ${await expr()} → ${await preview()})`);
  await page.click('.calc-display', { button: 'right' }); await sleep(250);
  ok((await count('.ou-menu .ou-menu-item')) === 1 && (await text('.ou-menu .ou-menu-item')) === (await tr('calc.copy')), 'right-click on the display offers Copy');
  await page.click('.ou-menu .ou-menu-item'); await sleep(250);
  ok((await page.evaluate(() => window.__clip.at(-1))) === '2468' && (await toastText()) === (await tr('calc.copied')), `Copy puts the result (2468) on the clipboard (got ${await page.evaluate(() => window.__clip.at(-1))})`);
  await press('=');
  await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control'); await sleep(150);
  ok((await page.evaluate(() => window.__clip.at(-1))) === '2468', 'Ctrl+C copies the result');
  await clearToast();

  // ——— Scientific mode ———
  await tool(3);
  ok((await count('.calc-pad.with-sci .calc-key')) === 35 && (await count('.calc-pad .calc-key.sci')) === 15, 'Scientific mode: 15 scientific keys in front of the keypad (7 columns)');
  ok(await exists('.calc-tools .calc-tool:nth-child(3).active') && (await prefs()).sci === true, 'Scientific button highlighted; calcPrefs.sci saved');
  ok((await text('.calc-key[data-k="deg"]')) === 'Rad' && !(await page.evaluate(() => !document.querySelector('.calc-mode').hidden)), 'starts in degrees: the key offers Rad, no Rad indicator');
  ok((await outside('.calc-key', '.app-win')).length === 0, 'scientific + main keys fit inside the window');
  await shot(P + 'calc-02-scientific');
  const sciCase = async (keys, want, label) => {
    await press('C', ...keys);
    const typed = await expr();
    await press('=');
    const got = await expr();
    ok(got === want, `${label} = ${want} (typed ${typed}, got ${got})`);
  };
  await sciCase(['sin', '3', '0'], '0.5', 'sin(30) in Deg');
  await sciCase(['cos', '6', '0'], '0.5', 'cos(60) in Deg');
  await press('deg');
  ok((await text('.calc-key[data-k="deg"]')) === 'Deg' && (await page.evaluate(() => !document.querySelector('.calc-mode').hidden)) && (await prefs()).deg === false, 'Rad key switches to radians: indicator shown, key offers Deg, saved');
  await sciCase(['sin', 'π'], '0', 'sin(π) in Rad');
  await sciCase(['cos', 'π'], '−1', 'cos(π) in Rad');
  await press('deg');
  await press('C', 'sqrt', '8', '1');
  ok((await expr()) === '√(81' && (await preview()) === '9', `√ inserts √( with a live preview (got ${await expr()} → ${await preview()})`);
  await press('=');
  ok((await expr()) === '9' && (await hist())[0].expr === 'sqrt(81)', '√81 = 9; History keeps sqrt(81) with the parenthesis closed');
  await sciCase(['5', 'sq'], '25', '5 x²');
  await sciCase(['2', 'pow', '1', '0'], '1,024', '2 xʸ 10');
  await sciCase(['ln', 'e'], '1', 'ln(e)');
  await sciCase(['log', '1', '0', '0', '0'], '3', 'log(1000)');
  await press('C', '4', 'inv');
  ok((await expr()) === '1÷(4)', `1/x wraps the expression (got ${await expr()})`);
  await press('=');
  ok((await expr()) === '0.25', '1/(4) = 0.25');
  await press('C', 'π');
  ok((await expr()) === 'π' && (await preview()) === (await fmt(3.14159265359)), `π shows a preview of ${await fmt(3.14159265359)} (got ${await preview()})`);
  await press('2');
  ok((await expr()) === 'π×2', 'a digit after π gets the × Samsung writes');
  await sciCase(['abs', '+/-', '7'], '7', '|−7|');
  await sciCase(['exp', '1'], '2.71828182846', 'eˣ of 1');
  h = await hist();
  ok(h[0].expr === 'e^(1)' && (await disp(h[0].expr)) === 'e^(1)', `History keeps e^(1), balanced (bug: "exp(1" was saved; got ${h[0].expr})`);
  await press('C', 'sin', 'back');
  ok((await expr()) === '0', '⌫ removes a whole "sin(" token');
  // ⇄: second functions
  await press('2nd');
  ok((await exists('.calc-key.sci.on[data-k="2nd"]')) && (await exists('.calc-key[data-k="asin"]')) && (await exists('.calc-key[data-k="root"]')) && (await exists('.calc-key[data-k="!"]')),
    '⇄ turns on and shows sin⁻¹ cos⁻¹ tan⁻¹, ʸ√x, x! …');
  ok((await page.evaluate(() => document.querySelector('.calc-key[data-k="asin"]').innerHTML)).includes('<sup>'), 'second-function labels use superscripts');
  await shot(P + 'calc-03-second');
  await sciCase(['asin', '1'], '90', 'sin⁻¹(1) in Deg');
  await sciCase(['atan', '1'], '45', 'tan⁻¹(1)');
  await sciCase(['2', '7', 'root', '3'], '3', '27 ʸ√x 3');
  await sciCase(['5', '!'], '120', '5 x!');
  await sciCase(['cbrt', '6', '4'], '4', '∛64');
  await sciCase(['pow10', '3'], '1,000', '10ˣ of 3');
  await sciCase(['2', 'cube'], '8', '2 x³');
  await press('2nd');
  ok((await exists('.calc-key[data-k="sin"]')) && !(await exists('.calc-key.sci.on')), '⇄ again restores the first functions');

  // ——— History over the digit keys ———
  h = await hist();
  await tool(1);
  ok(await exists('.calc-pad.history .calc-hist'), 'History panel opens');
  ok((await count('.calc-hist-item')) === h.length, `one row per saved calculation (${h.length})`);
  ok((await text('.calc-hist-item .calc-hist-expr')) === (await disp(h[0].expr)), 'newest calculation is listed first');
  ok((await text('.calc-hist-item .calc-hist-res')) === '=' + (await fmt(h[0].result)), 'row shows "=result"');
  const opFree = await page.evaluate(() => {
    const k = document.querySelector('.calc-key[data-k="+"]');
    const r = k.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.calc-key') === k;
  });
  ok(opFree, 'the operator column stays usable next to History, like Samsung');
  await shot(P + 'calc-04-history');
  const big = h.findIndex((x) => x.expr === '1234568*1000');
  await page.click(`.calc-hist-item:nth-child(${big + 1}) .calc-hist-res`); await sleep(200);
  ok(!(await exists('.calc-hist')) && (await expr()) === '1,234,568,000', `tapping a result puts the number back (got ${await expr()})`);
  await press('+');
  await tool(1);
  await page.click('.calc-hist-item:nth-child(1) .calc-hist-res'); await sleep(200);
  ok((await expr()) === '1,234,568,000+' + (await fmt(h[0].result)), `after an operator a result is appended (got ${await expr()})`);
  await tool(1);
  await page.click('.calc-hist-item:nth-child(2) .calc-hist-expr'); await sleep(200);
  ok(!(await exists('.calc-hist')) && (await expr()) === (await disp(h[1].expr)), 'tapping an expression puts it back to edit');
  await tool(1);
  await page.click('.calc-hist-clear'); await sleep(250);
  ok((await hist()).length === 0, 'Clear history empties calc.history');
  ok((await text('.calc-hist .ou-empty')) === (await tr('calc.noHistory')), 'empty History message');
  await shot(P + 'calc-05-history-empty');
  await tool(1);
  ok(await exists('.calc-pad .calc-key[data-k="7"]') && !(await exists('.calc-hist')), 'the keypad button returns to the keys');
  await tool(3);
  ok(!(await exists('.calc-pad.with-sci')) && (await prefs()).sci === false, 'Scientific mode off again');

  // History keeps the newest 60
  await setStorage({ calc: { history: Array.from({ length: 60 }, (_, i) => ({ expr: `${i}+1`, result: i + 1, time: Date.now() - (i + 1) * 60e3 })) } });
  await sleep(300);
  await press('C', '9', '*', '9', '=');
  h = await hist();
  ok(h.length === 60 && h[0].expr === '9*9' && h[0].result === 81 && h[59].expr === '58+1', 'History is capped at 60, newest first');

  // ——— Unit converter ———
  await press('C', '4', '2');
  await tool(2);
  await sleep(300);
  ok(await exists('.app-win .calc-conv'), 'the ruler opens the Unit converter');
  ok((await text('.calc-conv-page .app-toolbar-title')) === (await tr('calc.converter')) && (await exists('.calc-conv-page .app-back')), 'One UI sub-page: "Unit converter" with a back button');
  const cats = await texts('.calc-cat');
  ok(cats.length === 9 && cats[0] === (await tr('calc.cat.area')) && cats[4] === (await tr('calc.cat.weight')) && cats[8] === (await tr('calc.tip')), `Samsung's categories + Tip (${cats.join(', ')})`);
  ok((await text('.calc-cat.active')) === (await tr('calc.cat.length')), 'Length is selected first');
  ok((await texts('.calc-unit-sym')).join(' ') === 'km mi', 'kilometers → miles');
  let v = await vals();
  ok(v[0] === '1' && v[1] === '0.621371192237', `1 km = 0.621371192237 mi (got ${v.join(' / ')})`);
  ok((await outside('.calc-conv .calc-key, .calc-cat.active, .calc-conv-value', '.app-win')).length === 0, 'converter keys, tabs and values inside the window');
  await shot(P + 'calc-06-converter');
  await cpress('C', '5');
  v = await vals();
  ok(v[0] === '5' && v[1] === '3.10685596119', `5 km = 3.10685596119 mi (got ${v.join(' / ')})`);
  ok(await exists('.calc-conv-pad .calc-key[data-k="+/-"][disabled]'), '+/− is off for lengths');
  // pick a unit from the drop-down list
  await page.click('.calc-field:nth-child(3) .calc-unit'); await sleep(300);
  const items = await texts('.ou-menu .ou-menu-item');
  ok(items.length === 12 && (await exists('.ou-menu .ou-menu-check')), `the unit list shows the 12 length units with the current one checked (${items.length})`);
  ok((await outside('.ou-menu', 'body')).length === 0, 'the unit list stays on screen');
  await shot(P + 'calc-07-unit-menu');
  await page.evaluate((name) => [...document.querySelectorAll('.ou-menu .ou-menu-item')].find((b) => b.textContent.includes(name)).click(), ' ft');
  await sleep(250);
  v = await vals();
  ok((await texts('.calc-unit-sym')).join(' ') === 'km ft' && v[1] === '16,404.1994751', `5 km = 16,404.1994751 ft (got ${v.join(' / ')})`);
  ok(JSON.stringify((await prefs()).convPairs?.['length']) === JSON.stringify(['kilometer', 'foot']), 'unit choice saved in calcPrefs.convPairs');
  await page.click('.calc-swap'); await sleep(200);
  v = await vals();
  ok((await texts('.calc-unit-sym')).join(' ') === 'ft km' && v[0] === '5' && v[1] === '0.001524', `swap: 5 ft = 0.001524 km (got ${v.join(' / ')})`);
  // type into the second field: the first one follows
  await page.click('.calc-conv-value[data-i="1"]'); await sleep(150);
  ok(await exists('.calc-conv-value.active[data-i="1"]'), 'tapping the second value makes it the one you type');
  await cpress('C', '2');
  v = await vals();
  ok(v[1] === '2' && v[0] === '6,561.67979003', `2 km = 6,561.67979003 ft (got ${v.join(' / ')})`);
  // keyboard: Arabic-Indic digits, Backspace, ↑
  await keys('٥');
  ok((await vals())[1] === '25', 'Arabic-Indic digits typed into the converter');
  await page.keyboard.press('Backspace'); await page.keyboard.press('ArrowUp'); await sleep(100);
  ok(await exists('.calc-conv-value.active[data-i="0"]'), '↑ moves to the first field');
  // temperature: sign
  await page.click('.calc-cat[data-cat="temperature"]'); await sleep(200);
  ok((await prefs()).convCat === 'temperature' && (await texts('.calc-unit-sym')).join(' ') === '°C °F', 'Temperature: °C → °F, category saved');
  await cpress('C', '4', '0', '+/-');
  v = await vals();
  ok(v[0] === '-40' && v[1] === '-40', `−40 °C = −40 °F (+/− works for temperature; got ${v.join(' / ')})`);
  // copy a value
  await page.click('.calc-conv-value[data-i="1"]', { button: 'right' }); await sleep(250);
  await page.click('.ou-menu .ou-menu-item'); await sleep(200);
  ok((await page.evaluate(() => window.__clip.at(-1))) === '-40', 'Copy on a converted value');
  await clearToast();
  await page.click('.calc-cat[data-cat="data"]'); await sleep(200);
  await cpress('C', '1', '0', '2', '4');
  ok((await texts('.calc-unit-sym')).join(' ') === 'MB GB' && (await vals())[1] === '1.024', 'Data: 1,024 MB = 1.024 GB');
  await shot(P + 'calc-08-converter-data');

  // ——— Tip calculator ———
  await page.click('.calc-cat[data-cat="tip"]'); await sleep(250);
  ok((await count('.calc-tip-field')) === 3 && (await exists('.calc-tip-chips .ou-chip.active')), 'Tip calculator: Bill, Tip, Split between; 15% chip selected');
  await cpress('8', '0');
  await page.click('.calc-conv-value[data-i="2"]'); await sleep(150);
  ok(await exists('.calc-conv-pad .calc-key[data-k="."][disabled]'), 'no decimal point for the number of people');
  await cpress('C', '2');
  const outs = async () => page.evaluate(() => [...document.querySelectorAll('.calc-tip-out b')].map((b) => b.textContent));
  let o = await outs();
  ok(o.join(' | ') === '12.00 | 92.00 | 46.00', `80 with 15% split by 2: tip 12.00, total 92.00, 46.00 each (got ${o.join(' | ')})`);
  await page.evaluate(() => [...document.querySelectorAll('.calc-tip-chips .ou-chip')].find((c) => c.textContent === '20%').click()); await sleep(150);
  o = await outs();
  ok(o[0] === '16.00' && o[2] === '48.00' && (await prefs()).tipPct === '20' && (await prefs()).tipSplit === '2', `20% chip: tip 16.00, 48.00 each, saved (got ${o.join(' | ')})`);
  await shot(P + 'calc-09-tip');
  ok((await outside('.calc-conv .calc-key, .calc-tip-out', '.app-win')).length === 0, 'tip calculator inside the window');

  // back to the keypad with Escape; what was typed is still there
  await page.keyboard.press('Escape'); await sleep(450);
  ok(!(await exists('.calc-conv')) && (await expr()) === '42', `Escape returns to the keypad with the expression kept (got ${await expr()})`);
  await page.keyboard.type('+1'); await sleep(80);
  ok((await expr()) === '42+1', 'the keypad takes the keyboard again');

  // ——— Finder commands and params ———
  const rows = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('unit converter', () => {}).map((r) => ({ icon: r.icon, title: typeof r.title === 'string' ? r.title : r.title.textContent }))));
  ok(rows.some((r) => r.icon === 'calcRuler'), 'Finder: "unit converter" command');
  const arRows = await page.evaluate(() => import('./js/core/hooks.js').then((m) => m.runCommands('محول الوحدات', () => {}).filter((r) => r.icon === 'calcRuler').length));
  ok(arRows === 1, 'Finder: "محول الوحدات" command');
  await closeApp();
  await openApp('calculator');
  ok((await expr()) === '42+1', 'reopening keeps what you typed in this tab');
  await openApp('calculator', { section: 'tip' });
  await sleep(300);
  ok((await text('.calc-cat.active')) === (await tr('calc.tip')), 'params.section "tip" opens the Tip calculator');
  await openApp('calculator', { expr: '6*7' });
  await sleep(300);
  ok(!(await exists('.calc-conv')) && (await expr()) === '6×7' && (await preview()) === '42', 'params.expr shows the expression with its result (and leaves the converter)');
  await openApp('calculator', { expr: '٢+٢' });
  ok((await expr()) === '2+2', 'opening again replaces the expression (setParams), Arabic-Indic digits accepted');

  // ——— full screen: Samsung tablet layout ———
  await mod('./js/core/apps.js', 'toggleFullScreen', 'calculator');
  await sleep(600);
  ok((await exists('.calc.wide')) && (await count('.calc-pad .calc-key.sci')) === 15 && !(await page.evaluate(() => !document.querySelector('.calc-tools .calc-tool:nth-child(3)').hidden)),
    'full screen: scientific keys always shown, Scientific button hidden');
  ok((await outside('.calc-key', '.app-win')).length === 0, 'full-screen keys inside the window');
  await shot(P + 'calc-10-wide');
  await mod('./js/core/apps.js', 'toggleFullScreen', 'calculator');
  await sleep(600);
  ok(!(await exists('.calc.wide')) && (await count('.calc-pad .calc-key')) === 20, 'back to the phone layout');

  // ——— any window height (resize from the corner): keys and text shrink, nothing is cut off ———
  const winRect = () => page.evaluate(() => { const b = document.querySelector('.app-win[data-app="calculator"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const resizeTo = async (target) => {
    const r = await winRect();
    const from = { x: r.x + r.w - 13, y: r.y + r.h - 13 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + (target - r.h), { steps: 8 });
    await page.mouse.up();
    await sleep(400);
    return Math.round((await winRect()).h);
  };
  const fit = (sel) => page.evaluate((s) => {
    const k = document.querySelector(s).getBoundingClientRect();
    const fs = (q) => parseFloat(getComputedStyle(document.querySelector(q)).fontSize);
    return { w: Math.round(k.width), h: Math.round(k.height), expr: fs('.calc-expr'), key: fs(s) };
  }, sel);
  const h0 = Math.round((await winRect()).h);
  for (const [target, sciOn] of [[730, false], [730, true], [520, false], [420, true], [420, false]]) {
    const got = await resizeTo(target);
    if (sciOn !== (await exists('.calc-pad.with-sci'))) await tool(3);
    const f = await fit(sciOn ? '.calc-key[data-k="sin"]' : '.calc-key[data-k="5"]');
    const off = await outside('.calc-key, .calc-tools .ou-icon-btn, .calc-expr, .calc-preview', '.app-win');
    ok(got < h0 && off.length === 0 && f.h >= 18 && f.expr >= 24 && f.key >= 11,
      `${got} px tall window${sciOn ? ' (scientific)' : ''}: all keys inside (${off.length} out), key ${f.w}×${f.h} at ${f.key}px, display ${f.expr}px`);
    if (target === 420) await shot(P + (sciOn ? 'calc-12-short-sci' : 'calc-12-short'));
  }
  await tool(2);
  await sleep(400);
  const offConv = await outside('.calc-conv .calc-key, .calc-conv-value, .calc-cat.active', '.app-win');
  ok(offConv.length === 0, `the converter fits a short window too (${offConv.length} out)`);
  ok((await outside('.calc-conv-value', '.calc-conv-main')).length === 0 && (await outside('.calc-unit', '.calc-conv')).length === 0, 'both units and values stay in view in a short window (unit beside its value)');
  await shot(P + 'calc-13-short-converter');
  await page.keyboard.press('Escape'); await sleep(450);
  ok((await resizeTo(h0)) === h0 && (await outside('.calc-key', '.app-win')).length === 0, 'back to the full height');

  await tool(1);
  await shot(P + 'calc-11-history-full');
  ok((await count('.calc-hist-item')) === 60, 'all 60 History rows listed');
  ok((await outside('.calc-hist-clear', '.app-win')).length === 0, 'Clear history button inside the window');
  await closeApp();
  await page.keyboard.press('Escape');
  ok(!logs.some((l) => l.includes('pageerror')), 'no page errors');
  if (AR) ok((await page.evaluate(() => document.documentElement.dir)) === 'rtl', 'Arabic run is RTL');
};
