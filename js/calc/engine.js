// Math engine shared by the Calculator app, Finder's instant answers and the side panel (ported from Liquid Tab's
// js/calc/engine.js). tokenize() turns typed text into tokens; evaluate() runs them with Samsung Calculator's rules:
// operator precedence, a + b% = a + a×b/100, implicit multiplication (2π, 3(4)), right-associative powers, postfix
// x! x² x³ x⁻¹, functions with or without parentheses, Deg/Rad, auto-closed "(".
// Pure functions: no DOM, no storage, no i18n, so plain node tests (.dev/calc-engine.mjs) import it directly.
// Unlike Liquid Tab, trigonometry defaults to degrees: Samsung Calculator and Finder both start in Deg.

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → Latin. */
export const latinDigits = (s) => String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => d.charCodeAt(0) % 16);

// ——— functions ———
const snap = (v) => (Math.abs(v) < 1e-15 ? 0 : v);
const mod360 = (x, m) => ((x % m) + m) % m;
// exact values at the angles people type in degrees (sin 30 = 0.5, cos 90 = 0, tan 90 = Error)
function sinD(x, deg) {
  if (deg) {
    const ex = { 0: 0, 30: 0.5, 90: 1, 150: 0.5, 180: 0, 210: -0.5, 270: -1, 330: -0.5 }[mod360(x, 360)];
    if (ex !== undefined) return ex;
  }
  return snap(Math.sin(deg ? (x * Math.PI) / 180 : x));
}
function cosD(x, deg) {
  if (deg) {
    const ex = { 0: 1, 60: 0.5, 90: 0, 120: -0.5, 180: -1, 240: -0.5, 270: 0, 300: 0.5 }[mod360(x, 360)];
    if (ex !== undefined) return ex;
  }
  return snap(Math.cos(deg ? (x * Math.PI) / 180 : x));
}
function tanD(x, deg) {
  if (deg) {
    const ex = { 0: 0, 45: 1, 90: NaN, 135: -1 }[mod360(x, 180)];
    if (ex !== undefined) return ex;
  }
  return snap(Math.tan(deg ? (x * Math.PI) / 180 : x));
}
const inv = (f) => (x, deg) => (deg ? snap((f(x) * 180) / Math.PI) : f(x));

// Γ(x+1) for x!, exact for whole numbers (3.5! = 11.6317…)
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
  const tt = z + 7.5;
  return Math.sqrt(2 * Math.PI) * tt ** (z + 0.5) * Math.exp(-tt) * x;
}
export function factorial(n) {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  return gamma(n + 1);
}

export const FUNCS = {
  sin: sinD, cos: cosD, tan: tanD, asin: inv(Math.asin), acos: inv(Math.acos), atan: inv(Math.atan),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  exp: Math.exp, pow10: (x) => 10 ** x, pow2: (x) => 2 ** x, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const ALIAS = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', lg: 'log' };
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
// infix words: "27 yroot 3" (ʸ√x), "8 logy 2" (logᵧ), "3 rpow 2" (yˣ = 2³), "20% of 150", "15% off 80", "10% on 50", "7 mod 3"
const WORD_OPS = new Set(['yroot', 'logy', 'rpow', 'mod', 'of', 'off', 'on']);
const FN_NAMES = Object.keys(FUNCS).sort((a, b) => b.length - a.length);

// ——— tokenizer ———
const SUPS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const OPS = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', '·': '*', '⋅': '*', '/': '/', '÷': '/', '∕': '/', '^': '^' };

/**
 * Text → tokens. Tokens: { t: 'n', v } number · { t: 'op', v: + - * / ^ yroot logy rpow mod of off on } ·
 * { t: 'post', v: % ! ² ³ ⁻¹ } · { t: 'fn', v } · { t: 'c', v } constant · { t: 'id', v } variable · '(' · ')'.
 * opts.decimal: ',' when the comma is the decimal separator (German "1,5"); otherwise commas group digits.
 * opts.mod: "7 % 3" is the remainder (Finder); otherwise % is always per cent.
 * opts.vars: a Map or object of variables. Returns null when the text isn't math.
 */
export function tokenize(src, { decimal = '.', mod = false, vars = null } = {}) {
  let s = latinDigits(src).replace(/[ً-ْـ]/g, '').replace(/٫/g, '.').replace(/٬/g, ',').replace(/٪/g, '%').replace(/\*\*/g, '^').replace(/[  ]/g, ' ');
  if (decimal === ',') s = s.replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1').replace(/,/g, '.');
  else s = s.replace(/(\d),(?=\d)/g, '$1');
  const out = [];
  const prevIsOperand = () => {
    const p = out[out.length - 1];
    return p && (p.t === 'n' || p.t === 'c' || p.t === 'id' || p.t === ')' || p.t === 'post');
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (m) { out.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (ch in OPS) { out.push({ t: 'op', v: OPS[ch] }); i++; continue; }
    if (ch === '(' || ch === '[') { out.push({ t: '(' }); i++; continue; }
    if (ch === ')' || ch === ']') { out.push({ t: ')' }); i++; continue; }
    if (ch === '%') {
      i++;
      // "7 % 3" in Finder is the remainder; "10%" and "50 + 10% =" are per cent
      if (mod && /^\s*[\d(.]/.test(s.slice(i))) out.push({ t: 'op', v: 'mod' });
      else out.push({ t: 'post', v: '%' });
      continue;
    }
    if (ch === '!') { out.push({ t: 'post', v: '!' }); i++; continue; }
    if (ch === '√') { out.push({ t: 'fn', v: 'sqrt' }); i++; continue; }
    if (ch === '∛') { out.push({ t: 'fn', v: 'cbrt' }); i++; continue; }
    if (ch === 'π') { out.push({ t: 'c', v: 'pi' }); i++; continue; }
    if (ch in SUPS) {
      m = s.slice(i).match(/^[⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/);
      if (!m) return null;
      const txt = [...m[0]].map((c) => SUPS[c]).join('');
      if (txt === '2' || txt === '3') out.push({ t: 'post', v: txt === '2' ? '²' : '³' });
      else if (txt === '-1') out.push({ t: 'post', v: '⁻¹' });
      else out.push({ t: 'op', v: '^' }, { t: 'n', v: parseFloat(txt) });
      i += m[0].length;
      continue;
    }
    m = s.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
    if (m) {
      i += m[0].length;
      for (const tk of word(m[0].toLowerCase(), m[0], vars, prevIsOperand())) {
        if (!tk) return null;
        out.push(tk);
      }
      continue;
    }
    return null;
  }
  return out;
}

function word(w, raw, vars, afterOperand) {
  if (vars && hasVar(vars, raw)) return [{ t: 'id', v: raw }];
  w = ALIAS[w] || w;
  if (w in FUNCS) return [{ t: 'fn', v: w }];
  if (w in CONSTS) return [{ t: 'c', v: w }];
  if (WORD_OPS.has(w)) return [{ t: 'op', v: w }];
  if (w === 'x' && afterOperand) return [{ t: 'op', v: '*' }]; // "3 x 4"
  // "3x4": the x is glued to the digits that follow it
  if (w[0] === 'x' && afterOperand && /^\d+$/.test(raw.slice(1))) return [{ t: 'op', v: '*' }, { t: 'n', v: parseFloat(raw.slice(1)) }];
  // "sqrt16", "2pi", "sinx": a known name glued to more letters or digits
  for (const f of [...FN_NAMES, 'pi']) {
    if (w.startsWith(f) && w.length > f.length) {
      const rest = raw.slice(f.length);
      const tail = /^\d/.test(rest) ? [{ t: 'n', v: parseFloat(rest) }] : word(rest.toLowerCase(), rest, vars, true);
      return [f === 'pi' ? { t: 'c', v: 'pi' } : { t: 'fn', v: f }, ...tail];
    }
  }
  return [vars ? { t: 'id', v: raw } : null];
}
const hasVar = (vars, k) => (vars.has ? vars.has(k) || vars.has(k.toLowerCase()) : k in vars || k.toLowerCase() in vars);
const getVar = (vars, k) => (vars.get ? (vars.has(k) ? vars.get(k) : vars.get(k.toLowerCase())) : k in vars ? vars[k] : vars[k.toLowerCase()]);

// ——— evaluator ———
/**
 * Runs tokens. opts.deg: trigonometry in degrees (default true). opts.vars: Map or object of variables.
 * Returns a number (NaN or ±Infinity for maths errors such as 0 ÷ 0) or null when the tokens don't form an expression.
 */
export function evaluate(toks, { deg = true, vars = null } = {}) {
  if (!toks || !toks.length) return null;
  let i = 0;
  const peek = () => toks[i];
  const isOp = (tk, ...v) => tk?.t === 'op' && v.includes(tk.v);
  const startsOperand = (tk) => tk && (tk.t === 'n' || tk.t === 'c' || tk.t === 'id' || tk.t === 'fn' || tk.t === '(');
  const fail = () => { throw new SyntaxError('math'); };

  function add() {
    let { v } = mul();
    while (isOp(peek(), '+', '-')) {
      const op = toks[i++].v;
      const r = mul();
      const rv = r.pct ? v * r.v : r.v; // 50 + 10% = 55
      v = op === '+' ? v + rv : v - rv;
    }
    return v;
  }
  function mul() {
    const first = unary();
    let v = first.v, n = 1;
    for (;;) {
      const tk = peek();
      if (isOp(tk, '*', '/', 'mod', 'of', 'off', 'on')) {
        i++;
        const b = unary().v;
        v = tk.v === '*' || tk.v === 'of' ? v * b : tk.v === '/' ? v / b : tk.v === 'mod' ? v - b * Math.floor(v / b) : tk.v === 'off' ? b * (1 - v) : b * (1 + v);
      } else if (startsOperand(tk) && !(tk.t === 'n' && toks[i - 1]?.t === 'n')) v *= pow().v; // 2π, 3(4), 2 sin 30 — not "12 34"
      else break;
      n++;
    }
    return { v, pct: first.pct && n === 1 };
  }
  function unary() {
    const tk = peek();
    if (isOp(tk, '-', '+')) {
      i++;
      const r = unary();
      return { v: tk.v === '-' ? -r.v : r.v, pct: r.pct };
    }
    return pow();
  }
  function pow() {
    const b = postfix();
    const tk = peek();
    if (isOp(tk, '^', 'yroot', 'logy', 'rpow')) {
      i++;
      const e = unary().v;
      if (tk.v === '^') {
        // the keypad's ʸ√x types x^(1÷y): odd roots of negative numbers are real, (-8)^(1÷3) = -2
        const n = 1 / e, odd = b.v < 0 && !Number.isInteger(e) && Math.abs(n - Math.round(n)) < 1e-9 && Math.round(n) % 2;
        return { v: odd ? -((-b.v) ** e) : b.v ** e, pct: false };
      }
      if (tk.v === 'rpow') return { v: e ** b.v, pct: false }; // x yˣ y = yˣ
      if (tk.v === 'logy') return { v: Math.log(b.v) / Math.log(e), pct: false };
      // odd roots of negative numbers are real: -8 yroot 3 = -2
      return { v: b.v < 0 && Number.isInteger(e) && e % 2 ? -((-b.v) ** (1 / e)) : b.v ** (1 / e), pct: false };
    }
    return b;
  }
  function postfix() {
    let v = primary(), pct = false;
    while (peek()?.t === 'post') {
      const p = toks[i++].v;
      pct = p === '%';
      v = p === '%' ? v / 100 : p === '!' ? factorial(v) : p === '²' ? v * v : p === '³' ? v * v * v : 1 / v;
    }
    return { v, pct };
  }
  function primary() {
    const tk = toks[i++];
    if (!tk) fail();
    if (tk.t === 'n') return tk.v;
    if (tk.t === 'c') return CONSTS[tk.v];
    if (tk.t === 'id') {
      if (!vars || !hasVar(vars, tk.v)) fail();
      return +getVar(vars, tk.v);
    }
    if (tk.t === '(') {
      const v = add();
      if (peek()?.t === ')') i++;
      else if (peek()) fail(); // a "(" left open at the end is closed for you
      return v;
    }
    if (tk.t === 'fn') {
      const a = peek()?.t === '(' ? primary() : unary().v;
      return FUNCS[tk.v](a, deg);
    }
    fail();
  }
  try {
    const v = add();
    return i === toks.length ? v : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

/** Evaluates text: a number (NaN for 0 ÷ 0, Infinity for 1 ÷ 0), or null when it isn't an expression. */
export function calc(src, opts = {}) {
  const toks = tokenize(src, opts);
  return toks ? evaluate(toks, opts) : null;
}

/** Whether text is worth answering as maths: an operator, function, postfix or constant (2π), not a lone number. */
export function looksLikeMath(src) {
  const toks = tokenize(String(src).replace(/=\s*$/, ''), { mod: true });
  if (!toks || toks.length < 2) return false;
  return toks.some((x) => x.t === 'op' || x.t === 'fn' || x.t === 'post' || x.t === 'c');
}

/** Removes binary floating-point noise: 0.1 + 0.2 → 0.3. */
export const clean = (v) => (Number.isFinite(v) ? +v.toPrecision(15) : v);

// ——— formatting ———
const sepCache = new Map();
/** Group and decimal separators of a locale, always with Latin digits. */
export function separators(loc) {
  if (!sepCache.has(loc)) {
    let group = ',', decimal = '.';
    try {
      for (const p of new Intl.NumberFormat(loc).formatToParts(1234567.5)) {
        if (p.type === 'group') group = p.value;
        if (p.type === 'decimal') decimal = p.value;
      }
    } catch { /* unknown locale: English separators */ }
    let fmt;
    try { fmt = new Intl.NumberFormat(loc, { numberingSystem: 'latn' }); } catch { fmt = new Intl.NumberFormat('en'); }
    sepCache.set(loc, { group, decimal, fmt });
  }
  return sepCache.get(loc);
}

/** "1234567.50" (as typed) → "1,234,567.50" in the locale's separators; keeps trailing zeros and a trailing point. */
export function groupTyped(raw, loc = 'en') {
  const { decimal, fmt } = separators(loc);
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const [mant, ex] = body.split(/[eE]/);
  const [int, frac] = mant.split('.');
  let out = int ? fmt.format(BigInt(int)) : '0';
  if (frac !== undefined) out += decimal + frac;
  if (ex !== undefined) out += 'e' + ex.replace(/^\+/, '');
  return (neg ? '-' : '') + out;
}

/**
 * Number → display text: at most `digits` significant digits, grouping, then scientific notation ("1.234568e15")
 * when it doesn't fit. Returns null for errors (NaN, ±Infinity).
 */
export function formatNumber(v, { digits = 9, loc = 'en', group = true } = {}) {
  if (!Number.isFinite(v)) return null;
  v = clean(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  const exp = Math.floor(Math.log10(a));
  // values that would need more digits than the display has, or that would lose almost all of their significant
  // digits behind leading zeros, switch to scientific notation
  if (exp >= digits || exp < -Math.max(4, digits - 4)) {
    const [m, e] = v.toExponential(Math.max(1, digits - 3)).split('e');
    const mant = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
    const ee = +e;
    if (ee < digits && ee >= -Math.max(4, digits - 4)) return formatNumber(+`${mant}e${ee}`, { digits, loc, group });
    return groupTyped(mant, loc) + 'e' + ee;
  }
  // doubles hold 15 reliable digits: showing 16 would turn 98.6 into 98.59999999999999
  const decimals = Math.max(0, Math.min(digits, 15) - Math.max(0, exp + 1)); // the leading 0 of 0.25 doesn't count
  let s = v.toFixed(Math.min(100, decimals));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  // rounding can carry into a new digit (999999999.6 → 1000000000)
  if (s.replace(/[-.]/g, '').length > digits && !s.includes('.')) return formatNumber(+s, { digits, loc, group });
  if (s === '-0') s = '0';
  return group ? groupTyped(s, loc) : s.replace('.', separators(loc).decimal);
}

/** Plain machine-readable text for the clipboard: "1234.5", "1.2e+21". */
export const plain = (v) => String(clean(v));
