// Calculator maths in plain node, no browser (exits 1 on failure): the shared engine and unit tables
// (js/calc/engine.js, js/calc/units.js — Liquid Tab's checks, adapted: Bloom Tab's trigonometry defaults to degrees and
// unit symbols are international), Finder's conversions in Arabic, and the Samsung keypad rules of js/calc/model.js
// (evaluate/formatNumber, which js/apps/calculator.js re-exports, display grouping, key presses, =, previews, the
// converter's value editing and the tip calculator). usage: node .dev/calc-engine.mjs
// units.js and model.js use js/core/i18n.js; setLang('ar') writes lang/dir on document.documentElement, so a plain
// object stands in for it.
globalThis.document ??= { documentElement: {} };
const { calc, formatNumber, groupTyped, clean, looksLikeMath, latinDigits } = await import('../js/calc/engine.js');
const U = await import('../js/calc/units.js');
const M = await import('../js/calc/model.js');
const { setLang } = await import('../js/core/i18n.js');
const { convert, parseConversion, CATEGORIES, unitName, unitSymbol, findUnit, categoryName, DEFAULTS } = U;

let bad = 0, n = 0;
const fail = (...a) => { bad++; console.log('FAIL', ...a); };
const check = (cond, ...msg) => { n++; if (!cond) fail(...msg); };
const near = (got, want) => (want === null ? got === null : Number.isNaN(want) ? Number.isNaN(got) : got !== null && (got === want || Math.abs(clean(got) - want) <= 1e-9 * Math.max(1, Math.abs(want))));
const RAD = { deg: false };

// ——— engine: [text, expected, options] ———
for (const [s, want, o] of [
  ['2+3*4', 14], ['(2+3)*4', 20], ['50+10%', 55], ['50-10%', 45], ['50*10%', 5], ['10%', 0.1], ['50+10%*2', 50.2], ['2^3^2', 512], ['-2^2', -4], ['2^-1', 0.5],
  ['2pi', 2 * Math.PI], ['3(4)', 12], ['(1+2)(3)', 9], ['sqrt(16)', 4], ['sqrt 16', 4], ['√16', 4], ['∛27', 3], ['5!', 120], ['3.5!', 11.631728396567448], ['0!', 1], ['-1!', -1],
  ['0.1+0.2', 0.3], ['sin(30)', 0.5], ['cos(90)', 0], ['tan(45)', 1], ['tan(90)', NaN], ['asin(0.5)', 30],
  ['sin(pi)', 0, RAD], ['cos(pi)', -1, RAD], ['sin(30)', Math.sin(30), RAD], ['asin(1)', Math.PI / 2, RAD],
  ['27 yroot 3', 3], ['-8 yroot 3', -2], ['8 logy 2', 3], ['3 rpow 2', 8], ['pow10(3)', 1000], ['pow2(10)', 1024], ['(-8)^(1/3)', -2], ['27^(1/3)', 3], ['(-16)^(1/4)', NaN],
  ['20% of 150', 30], ['15% off 80', 68], ['10% on 50', 55], ['7%3', 1, { mod: true }], ['-7%3', 2, { mod: true }], ['7 mod 3', 1],
  ['1,234+1', 1235], ['1,5+1', 2.5, { decimal: ',' }], ['1.234,5+1', 1235.5, { decimal: ',' }], ['١٢+٣', 15], ['۱۲+۳', 15], ['12×3−4÷2', 34], ['2²', 4], ['2³', 8], ['2⁻¹', 0.5], ['2¹⁰', 1024],
  ['price*2', 24, { vars: { price: 12 } }], ['Price*2', 24, { vars: { price: 12 } }], ['السعر*2', 24, { vars: new Map([['السعر', 12]]) }], ['3 x 4', 12], ['3x4', 12], ['sin(30', 0.5],
  ['sin 30 + sqrt 16', 4.5, { mod: true }], ['2^10+5!', 1144], ['١٢+٣×٢', 18],
  ['1/0', Infinity], ['0/0', NaN], ['ln(e)', 1], ['log(1000)', 3], ['log2(8)', 3], ['2e3', 2000], ['2e', 2 * Math.E], ['sinh(0)', 0], ['10*-3', -30], ['rand<1', null],
  ['abc', null], ['2+', null], ['(2+3))', null], ['12 34', null], ['', null], ['12:30', null],
]) { const got = calc(s, o); check(near(got, want), 'calc', JSON.stringify(s), o ? JSON.stringify(o) : '', 'got', got, 'want', want); }
for (const [s, want] of [['2+2', true], ['sin 30', true], ['2π', true], ['42', false], ['hello', false], ['2026-10-26', true], ['12:30', false]]) check(looksLikeMath(s) === want, 'looksLikeMath', s);
check(latinDigits('٠١٢٣٤٥٦٧٨٩ ۴۵') === '0123456789 45', 'latinDigits');

// ——— engine formatting: [value, digits, locale, expected] ———
for (const [v, d, loc, want] of [
  [123456789, 9, 'en', '123,456,789'], [1234567890, 9, 'en', '1.234568e9'], [0.1 + 0.2, 9, 'en', '0.3'], [1 / 3, 9, 'en', '0.333333333'], [2 / 3, 9, 'en', '0.666666667'],
  [999999999.6, 9, 'en', '1e9'], [-1234.5, 9, 'de', '-1.234,5'], [1e21, 16, 'en', '1e21'], [1 / 3, 16, 'en', '0.333333333333333'], [98.6, 16, 'en', '98.6'],
  [0.000012345678, 9, 'en', '0.000012346'], [1e-8, 9, 'en', '1e-8'], [1e100, 9, 'en', '1e100'], [1234567.5, 16, 'fr', '1\u202f234\u202f567,5'], [1234567, 9, 'hi', '12,34,567'], [NaN, 9, 'en', null],
  [1234567, 9, 'ar', '1,234,567'],
]) { const got = formatNumber(v, { digits: d, loc }); check(got === want, 'format', v, d, loc, JSON.stringify(got), 'want', JSON.stringify(want)); }
for (const [raw, loc, want] of [['1234567.50', 'en', '1,234,567.50'], ['-1234.', 'de', '-1.234,'], ['0.', 'en', '0.'], ['1e+21', 'en', '1e21'], ['12345.6e-7', 'en', '12,345.6e-7']]) {
  check(groupTyped(raw, loc) === want, 'groupTyped', raw, groupTyped(raw, loc));
}

// ——— units: known values, every round trip, names ———
for (const [v, a, b, want] of [
  [1, 'kilometer', 'mile', 0.621371192237334], [100, 'celsius', 'fahrenheit', 212], [32, 'fahrenheit', 'kelvin', 273.15], [180, 'degree', 'radian', Math.PI], [1, 'gibibyte', 'megabyte', 1073.741824],
  [5, 'liter-per-100-kilometer', 'kilometer-per-liter', 20], [30, 'mile-per-gallon', 'liter-per-100-kilometer', 7.840486], [1, 'bar', 'psi', 14.503774], [1, 'tablespoon', 'teaspoon', 3], [1, 'knot', 'kilometer-per-hour', 1.852],
  [1, 'hectare', 'are', 100], [1, 'long-ton', 'pound', 2240], [1, 'short-ton', 'pound', 2000], [-40, 'celsius', 'fahrenheit', -40], [1, 'acre', 'square-foot', 43560],
]) { const got = convert(v, a, b); check(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), 'convert', v, a, b, got, 'want', want); }
check(Number.isNaN(convert(1, 'kilometer', 'kilogram')), 'convert between kinds is NaN');
const SAMSUNG = ['area', 'length', 'temperature', 'volume', 'weight', 'data', 'speed', 'time'];
check(JSON.stringify(CATEGORIES.filter((c) => !c.extra).map((c) => c.id)) === JSON.stringify(SAMSUNG), "converter categories are Samsung's eight, in Samsung's order");
for (const c of CATEGORIES) {
  check(!categoryName(c.id).startsWith('calc.'), 'category name', c.id);
  check(DEFAULTS[c.id]?.every((id) => U.unit(id)?.cat === c.id), 'defaults belong to the category', c.id);
  for (const u of c.units) {
    n++;
    const name = unitName(u.id);
    if (!name || name.startsWith('calc.') || !unitSymbol(u.id)) fail('no name', u.id, name);
    for (const w of c.units) { const r = convert(convert(7.25, u.id, w.id), w.id, u.id); if (Math.abs(r - 7.25) > 1e-9) fail('round trip', u.id, w.id, r); }
  }
}
check(unitName('kilometer') === 'Kilometers' && unitName('square-foot') === 'Square feet' && categoryName('weight') === 'Mass', 'English names', unitName('kilometer'), unitName('square-foot'));
for (const [q, to, val] of [['5 km to mi', 'mile', 3.10685596], ['100 f in c', 'celsius', 37.7777778], ['3 cups = ml', 'milliliter', 709.7647095], ['60 mph to km/h', 'kilometer-per-hour', 96.56064],
  ['1.5 h to min', 'minute', 90], ['10 كم إلى ميل', 'mile', 6.21371192], ['١٠ كم إلى ميل', 'mile', 6.21371192], ['5 كيلو بالميل', 'mile', 3.10685596], ['2 ha to ares', 'are', 200]]) {
  const r = parseConversion(q);
  check(r && r.to === to && Math.abs(r.result - val) <= 1e-6 * val, 'parse', q, JSON.stringify(r));
}
for (const q of ['5 km to kg', 'hello to there', '5 to 6', '5 km to km']) check(!parseConversion(q), 'should not parse', q);
check(findUnit('Kilometers') === 'kilometer' && findUnit('°F') === 'fahrenheit' && findUnit('درجة') === 'degree', 'findUnit');
check(unitSymbol('milliliter') === 'mL' && unitSymbol('kilometer-per-hour') === 'km/h' && unitSymbol('mile') === 'mi', 'symbols', unitSymbol('milliliter'));

// ——— keypad: evaluate() as js/apps/calculator.js exports it (degrees, 12 significant digits, null when invalid) ———
for (const [s, want, o] of [
  ['2+3*4', 14], ['(2+3)*4', 20], ['10-2-3', 5], ['100/10/2', 5], ['2^3^2', 512], ['2**3', 8], ['7 mod 3', 1], ['-7 mod 3', 2], ['1+2*3-4/2', 5], ['2*(3+(4-1))', 12],
  ['-2^2', -4], ['-(2+3)', -5], ['--3', 3], ['2--3', 5], ['3*-2', -6], ['+5', 5],
  ['10%', 0.1], ['50*10%', 5], ['200*15%', 30], ['50+10%', 55], ['50-10%', 45], ['50+-10%', 45], ['200/10%', 2000], ['(50+10)%', 0.6],
  ['5!', 120], ['0!', 1], ['50+5!', 170], ['2^3!', 64], ['10!', 3628800], ['(-1)!', null], ['3.5!', 11.6317283966], ['171!', null],
  ['sin(30)', 0.5], ['cos(60)', 0.5], ['tan(45)', 1], ['cos(90)', 0], ['asin(1)', 90], ['acos(0)', 90], ['atan(1)', 45], ['3sin(30)', 1.5], ['tan(90)', null],
  ['sin(pi/2)', 1, RAD], ['cos(pi)', -1, RAD], ['asin(1)', Math.PI / 2, RAD],
  ['sqrt(16)', 4], ['√16', 4], ['2√9', 6], ['√(9+16)', 5], ['sqrt(2)', 1.41421356237], ['cbrt(27)', 3], ['ln(e)', 1], ['log(1000)', 3], ['abs(-5)', 5], ['abs(3-10)', 7],
  ['exp(1)', 2.71828182846], ['e^(1)', 2.71828182846], ['10^(3)', 1000], ['2^(10)', 1024], ['27^(1/3)', 3], ['(-8)^(1/3)', -2], ['EXP(1)', 2.71828182846],
  ['pi', 3.14159265359], ['π', 3.14159265359], ['2π', 6.28318530718], ['2*e', 5.43656365692], ['2(3)', 6], ['(1+2)(3+4)', 21], ['(2)3', 6],
  ['2e3', 2000], ['1.5e-3', 0.0015], ['.5+.5', 1], ['0.1+0.2', 0.3], ['0.1*3', 0.3], ['1/3', 0.333333333333], ['1,234+1', 1235], ['1e+21+1', 1e21],
  ['6×7', 42], ['8÷2', 4], ['9−4', 5], ['3x4', 12], ['3 x 4', 12], ['3X4', 12], ['١٢+٣', 15], ['٢×٣', 6], ['12:4', 3],
  ['sin(30', 0.5], ['(2+3', 5], ['2*(3+4', 14], ['2+3)', null],
  ['', null], ['   ', null], ['2+', null], ['*3', null], ['abc', null], ['max', null], ['x', null], ['sin()', null], ['1/0', null], ['0/0', null],
  ['sqrt(-1)', null], ['ln(0)', null], ['asin(2)', null], ['1e300*1e10', null], ['2$3', null],
]) { const got = M.evaluate(s, o); check(near(got, want), 'evaluate', JSON.stringify(s), o ? JSON.stringify(o) : '', 'got', got, 'want', want); }
for (const [s, want] of [['0.1+0.2', '0.3'], ['1-0.9', '0.1'], ['1.1*1.1', '1.21'], ['sin(180)', '0'], ['cos(90)', '0']]) check(String(M.evaluate(s)) === want, 'clean', s, String(M.evaluate(s)));

// formatNumber() for results: grouping, up to 15 digits, then e-notation; '' for nothing
for (const [v, want] of [
  [1234567.891, '1,234,567.891'], [-1234.5, '-1,234.5'], [0, '0'], [0.1, '0.1'], [42, '42'], [0.3333333333333, '0.3333333333333'], [123456789012345, '123,456,789,012,345'],
  [1e15, '1e15'], [-2.5e20, '-2.5e20'], [1.5e-12, '1.5e-12'], [1e-9, '0.000000001'], [0.000001234, '0.000001234'], [null, ''], [undefined, ''], [NaN, ''], [Infinity, ''],
]) { const got = M.formatNumber(v); check(got === want, 'formatNumber', v, JSON.stringify(got), 'want', JSON.stringify(want)); }

// display(): machine expression → what the screen shows, numbers grouped as typed
for (const [s, want] of [
  ['12+3*4', '12+3×4'], ['1234567.5*sqrt(2)-pi', '1,234,567.5×√(2)−π'], ['1234.', '1,234.'], ['0.000', '0.000'], ['asin(1)+acos(0)+atan(1', 'sin⁻¹(1)+cos⁻¹(0)+tan⁻¹(1'],
  ['cbrt(8)', '∛(8)'], ['e^(2)', 'e^(2)'], ['2^(1/3)', '2^(1÷3)'], ['(-5', '(−5'], ['1e+21', '1e21'], ['10000/3', '10,000÷3'], ['', ''], ['exp(1', 'exp(1'],
]) check(M.display(s, 'en') === want, 'display', s, JSON.stringify(M.display(s, 'en')), 'want', JSON.stringify(want));
check(M.normalizeInput('١٬٢٣٤ × ٢ − ٣٫٥ ÷ 1,000') === '1234*2-3.5/1000', 'normalizeInput', M.normalizeInput('١٬٢٣٤ × ٢ − ٣٫٥ ÷ 1,000'));

// key presses: [keys, expected expression, expected toast]
const run = (keys, start = { expr: '', done: false }) => {
  let st = start, msg = null;
  for (const k of keys) { const r = M.press(st, k); st = { expr: r.expr, done: r.done }; msg = r.msg || msg; }
  return { ...st, msg };
};
for (const [keys, want, msg] of [
  [['1', '2', '+', '3', '*', '4'], '12+3*4'], [['.', '.', '5'], '0.5'], [['0', '0', '7'], '7'], [['5', '+', '*', '2'], '5*2'], [['5', '+/-'], '(-5'], [['5', '+/-', '+/-'], '5'],
  [['2', '()', '3', '+', '4', '()'], '2*(3+4)'], [['()', '()'], '(('], [['()', '5', '()', '()'], '(5)*('], [['1', '2', '3', 'back'], '12'], [['back', 'back'], ''],
  [['sin', 'back'], ''], [['asin', '1'], 'asin(1'], [['2', 'π'], '2*π'], [['π', '3'], 'π*3'], [['e', '3'], 'e*3'], [['5', 'sq'], '5^2'], [['5', 'cube'], '5^3'], [['sq'], ''],
  [['2', 'pow', '1', '0'], '2^(10'], [['2', '7', 'root', '3'], '27^(1/3'], [['4', 'inv'], '1/(4)'], [['inv'], '1/'], [['5', '!'], '5!'], [['!'], ''], [['%'], ''],
  [['exp', '1'], 'e^(1'], [['pow10', '3'], '10^(3'], [['2', 'pow2', '3'], '2*2^(3'], [['abs', '+/-', '7'], 'abs((-7'], [['3', 'sin', '3', '0'], '3*sin(30'],
  [['+'], '0+'], [['-'], '-'], [['-', '*'], '-'], [['(', '*'], '('], [['(', '-'], '(-'], [['2', '^', '3'], '2^3'], [['^'], ''], [[')'], ''], [['(', '2', ')'], '(2)'],
  [['5', '%', '3'], '5%*3'], [['1', '0', '.', '2', '.', '5'], '10.25'], [['5', '.', '+', '.', '1'], '5.+0.1'],
  [Array(16).fill('9'), '9'.repeat(15), 'calc.maxDigits'], [['1', '.', ...Array(11).fill('1')], '1.' + '1'.repeat(10), 'calc.maxDecimals'], [['C'], ''],
]) {
  const r = run(keys);
  check(r.expr === want && (r.msg || undefined) === msg, 'press', keys.join(' '), JSON.stringify(r.expr), r.msg || '', 'want', JSON.stringify(want), msg || '');
}
// after a result: digits start again, operators continue, ± flips the sign, ⌫ edits
const res = { expr: '42', done: true };
check(run(['5'], res).expr === '5' && !run(['5'], res).done, 'digit after a result starts a new calculation');
check(run(['+', '8'], res).expr === '42+8', 'operator after a result continues from it');
check(run(['+/-'], { expr: '-5', done: true }).expr === '5' && run(['+/-'], res).expr === '(-42', '± on a result');
check(run(['sq'], res).expr === '42^2' && run(['sin'], res).expr === 'sin(' && run(['back'], res).expr === '4', 'x², functions and ⌫ after a result');

// =: parentheses are closed for History (exp(1 → exp(1)), Samsung's messages for errors
for (const [s, want] of [['exp(1', { expr: 'exp(1)', result: 2.71828182846 }], ['2*(3+4', { expr: '2*(3+4)', result: 14 }], ['12+3*4', { expr: '12+3*4', result: 24 }],
  ['1/0', { msg: 'calc.divZero' }], ['5/(0', { msg: 'calc.divZero' }], ['2/0.0', { msg: 'calc.divZero' }], ['1/0.5', { expr: '1/0.5', result: 2 }], ['ln(0)', { msg: 'calc.invalid' }],
  ['2+', { msg: 'calc.invalid' }], ['0+', { msg: 'calc.invalid' }], ['', null], ['-', null], ['sin(90', { expr: 'sin(90)', result: 1 }], ['sin(pi/2', { expr: 'sin(pi/2)', result: 1 }, RAD]]) {
  const got = M.equals(s, s === 'sin(pi/2' ? RAD : {});
  check(JSON.stringify(got) === JSON.stringify(want), 'equals', s, JSON.stringify(got), 'want', JSON.stringify(want));
}
// live preview under the expression
for (const [s, want] of [['12+3*4', '24'], ['12', ''], ['(-5', ''], ['', ''], ['2+', ''], ['sqrt(81', '9'], ['π', '3.14159265359'], ['1000*1000', '1,000,000'], ['1/0', ''], ['5%', '0.05']]) {
  check(M.preview(s) === want, 'preview', s, JSON.stringify(M.preview(s)), 'want', JSON.stringify(want));
}

// converter value editing and the tip calculator
const edit = (keys, v = '') => keys.reduce((a, k) => M.editValue(a.value, k), { value: v });
for (const [keys, start, want, msg] of [
  [['1', '2', '.', '5'], '', '12.5'], [['.', '.'], '', '0.'], [['0', '7'], '', '7'], [['back'], '12', '1'], [['C'], '12', ''], [['+/-'], '12', '-12'], [['+/-', '+/-'], '12', '12'],
  [['5'], '-0', '-5'], [Array(16).fill('9'), '', '9'.repeat(15), 'calc.maxDigits'],
]) { const r = edit(keys, start); check(r.value === want && (r.msg || undefined) === msg, 'editValue', keys.join(' '), start, JSON.stringify(r)); }
check(JSON.stringify(M.tipSplit(80, 15, 2)) === JSON.stringify({ tip: 12, total: 92, each: 46 }), 'tip 15% of 80 split by 2', JSON.stringify(M.tipSplit(80, 15, 2)));
check(JSON.stringify(M.tipSplit(0, 15, 0)) === JSON.stringify({ tip: 0, total: 0, each: 0 }), 'tip with nothing typed');

// Arabic: Latin digits like One UI; unit names in Arabic, symbols stay international
setLang('ar');
for (const [v, want] of [[1234567.891, '1,234,567.891'], [7, '7']]) { const got = M.formatNumber(v); check(got === want && !/[٠-٩]/.test(got), 'format ar', v, JSON.stringify(got)); }
check(unitName('kilometer') === 'كيلومتر' && unitName('square-foot') === 'أقدام مربعة' && categoryName('weight') === 'الكتلة', 'Arabic names', unitName('kilometer'));
check(unitSymbol('mile') === 'mi', 'Arabic keeps the symbol mi');
check(findUnit('كيلومتر') === 'kilometer', 'findUnit by Arabic name');

console.log(`${n - bad}/${n} calculator engine checks passed`);
process.exit(bad ? 1 : 0);
