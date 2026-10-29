// Samsung Calculator's input rules as pure functions, so plain node tests (.dev/calc-engine.mjs) cover the keypad
// without a browser. The expression is kept in a machine form ("12*sqrt(2)+π") and drawn with display() ("12×√(2)+π",
// numbers grouped in the UI language). The maths is js/calc/engine.js.
import { calc, formatNumber as fmtEngine, groupTyped, latinDigits } from './engine.js';
import { locale } from '../core/i18n.js';

// Results keep 12 significant digits: enough for a phone-sized display, and binary noise (0.1 + 0.2) never shows.
const round12 = (n) => (Math.abs(n) < 1e-13 ? 0 : parseFloat(n.toPrecision(12)));

/** Evaluates an expression like the keypad does: a finite number (12 significant digits) or null. Degrees by default. */
export function evaluate(expr, { deg = true } = {}) {
  // "12:4" is how some people type a division; Finder keeps ":" for times, so only the Calculator reads it this way
  const v = calc(String(expr ?? '').replace(/:/g, '/'), { deg });
  return typeof v === 'number' && Number.isFinite(v) ? round12(v) : null;
}

/** A result for the display: grouping in the UI language, up to 15 digits, then "1.5e21". '' for nothing/errors. */
export function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return fmtEngine(n, { digits: 15, loc: locale() });
}

// ——— display ———
const NUM = /(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/y;
const WORDS = [['asin(', 'sin⁻¹('], ['acos(', 'cos⁻¹('], ['atan(', 'tan⁻¹('], ['sqrt(', '√('], ['cbrt(', '∛('], ['sqrt', '√'], ['pi', 'π']];
/** Machine expression → what the display shows: "1234.5*sqrt(2)-pi" → "1,234.5×√(2)−π". */
export function display(expr, loc = locale()) {
  const s = String(expr ?? '');
  let out = '';
  for (let i = 0; i < s.length;) {
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (m && /[\d.]/.test(s[i])) {
      out += groupTyped(m[0], loc);
      i += m[0].length;
      continue;
    }
    const w = WORDS.find(([k]) => s.startsWith(k, i));
    if (w) {
      out += w[1];
      i += w[0].length;
      continue;
    }
    const c = s[i++];
    out += c === '*' ? '×' : c === '/' ? '÷' : c === '-' ? '−' : c;
  }
  return out;
}

/** Typed or pasted text → the machine form: Latin digits, plain operators, no spaces or digit grouping. */
export function normalizeInput(text) {
  return latinDigits(String(text ?? ''))
    .replace(/٫/g, '.').replace(/[٬\s]/g, '').replace(/٪/g, '%')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[×✕·]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/\*\*/g, '^');
}

// ——— keypad ———
export const FN_KEYS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'sqrt', 'cbrt', 'abs'];
export const MAX_DIGITS = 15;
export const MAX_DECIMALS = 10;
const TOKEN_TAIL = /(asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|ln\(|log\(|sqrt\(|cbrt\(|abs\(|exp\(|pi|.)$/;
export const openParens = (expr) => (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
/** Ends with something that can be multiplied: a number, ")", "%", "!", π or e. */
export const endsOperand = (expr) => /[\d.)%!πe]$/.test(expr) && !/[a-z]\($/.test(expr);
const endsOp = (expr) => /[+\-*/^]$/.test(expr);
// Samsung writes the × it implies: 2 then ( gives "2×(", π then 3 gives "π×3"
const times = (expr) => (endsOperand(expr) ? expr + '*' : expr);
/** Closes every "(" left open: what = shows and what History keeps ("exp(1" → "exp(1)"). */
export const balance = (expr) => expr + ')'.repeat(Math.max(0, openParens(expr)));

/**
 * One key press: state { expr, done } (done: the display shows a result) → new state, plus `msg` (an i18n key for a
 * toast) when the key was refused. Keys: 0-9 . + - * / % () ( ) +/- C back sq cube pow root inv ! π e exp pow10 pow2
 * and the function names in FN_KEYS. "=" is equals().
 */
export function press(state, key) {
  let { expr = '', done = false } = state;
  if (key === 'pi') key = 'π';
  const fresh = () => { if (done) expr = ''; done = false; };
  const cont = () => { done = false; };
  const lastNum = () => /(\d*\.?\d*)$/.exec(expr)[1];
  switch (key) {
    case 'C': return { expr: '', done: false };
    case 'back':
      cont();
      expr = expr.replace(TOKEN_TAIL, '');
      break;
    case '.': {
      fresh();
      const num = lastNum();
      if (num.includes('.')) break;
      if (num.replace(/\D/g, '').length >= MAX_DIGITS) return { expr, done, msg: 'calc.maxDigits' };
      expr = num ? expr + '.' : times(expr) + '0.';
      break;
    }
    case '+': case '-': case '*': case '/': {
      cont();
      if (!expr) {
        expr = key === '-' ? '-' : '0' + key;
        break;
      }
      if (/\($/.test(expr)) {
        if (key === '-') expr += '-';
        break;
      }
      if (endsOp(expr)) {
        if (/\([+\-*/^]$/.test(expr) || expr.length === 1) break; // "(-" and a lone "-" stay as they are
        expr = expr.slice(0, -1);
      }
      expr += key;
      break;
    }
    case '%': case '!':
      cont();
      if (endsOperand(expr)) expr += key;
      break;
    case '()':
      cont();
      expr = openParens(expr) > 0 && endsOperand(expr) ? expr + ')' : times(expr) + '(';
      break;
    case '(':
      cont();
      expr = times(expr) + '(';
      break;
    case ')':
      cont();
      if (openParens(expr) > 0 && endsOperand(expr)) expr += ')';
      break;
    case '+/-': {
      cont();
      const m = /(\(-)?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|π|e)$/.exec(expr);
      if (!m) expr = times(expr) + '(-';
      else if (m[1] || (m.index === 1 && expr[0] === '-')) expr = expr.slice(0, m.index - (m[1] ? 0 : 1)) + m[2]; // "(-5" or a result "-5" → "5"
      else expr = expr.slice(0, m.index) + '(-' + m[2];
      break;
    }
    case '^':
      cont();
      if (endsOperand(expr)) expr += '^';
      break;
    case 'sq': case 'cube': case 'pow': case 'root':
      cont();
      if (endsOperand(expr)) expr += { sq: '^2', cube: '^3', pow: '^(', root: '^(1/' }[key];
      break;
    case 'inv':
      cont();
      expr = expr ? `1/(${expr})` : '1/';
      break;
    case 'π': case 'e':
      fresh();
      expr = times(expr) + key;
      break;
    case 'exp': case 'pow10': case 'pow2':
      fresh();
      expr = times(expr) + { exp: 'e^(', pow10: '10^(', pow2: '2^(' }[key];
      break;
    default:
      if (FN_KEYS.includes(key)) {
        fresh();
        expr = times(expr) + key + '(';
      } else if (/^\d$/.test(key)) {
        fresh();
        const num = lastNum();
        const digits = num.replace(/\D/g, '').length;
        if (digits >= MAX_DIGITS) return { expr, done, msg: 'calc.maxDigits' };
        if (num.includes('.') && num.split('.')[1].length >= MAX_DECIMALS) return { expr, done, msg: 'calc.maxDecimals' };
        if (num === '0') expr = expr.slice(0, -1); // no leading zeros: 0 then 7 is 7
        else if (!num && /[)%!πe]$/.test(expr)) expr += '*';
        expr += key;
      } else return { expr, done };
  }
  if (expr.length > 200) expr = expr.slice(0, 200);
  return { expr, done };
}

/**
 * "=" on an expression: { expr (parentheses closed), result } for History, or { msg } with the toast to show
 * (Samsung's "Can't divide by 0." or "Invalid format used."), or null when there's nothing to do.
 */
export function equals(expr, { deg = true } = {}) {
  if (!expr || expr === '-') return null;
  const full = balance(expr);
  const v = calc(full.replace(/:/g, '/'), { deg });
  if (typeof v !== 'number') return { msg: 'calc.invalid' };
  if (!Number.isFinite(v)) return { msg: /\/\(*0+(?:\.0*)?(?![\d.])/.test(full) ? 'calc.divZero' : 'calc.invalid' };
  return { expr: full, result: round12(v) };
}

/** The live result under the expression, or '' while it's a lone number or not valid yet. */
export function preview(expr, { deg = true } = {}) {
  if (!expr || !/[+\-*/^%!(πe]|[a-z]\(/.test(expr.replace(/^\(?-/, ''))) return '';
  const r = evaluate(balance(expr), { deg });
  return r == null ? '' : formatNumber(r);
}

/** The machine form of a number, ready to go into an expression ("(-5" for a negative). */
export const numberExpr = (n) => (n < 0 ? '(-' + String(-n) : String(n));

// ——— Unit converter and Tip calculator inputs ———
/** One key on the converter's keypad: digits, ".", back, C, +/-. Returns { value, msg }. */
export function editValue(value, key) {
  let v = String(value ?? '');
  const neg = v.startsWith('-');
  let body = neg ? v.slice(1) : v;
  if (key === 'C') return { value: '' };
  if (key === 'back') body = body.slice(0, -1);
  else if (key === '+/-') return { value: neg ? body : '-' + body };
  else if (key === '.') {
    if (!body.includes('.')) body = (body || '0') + '.';
  } else if (/^\d$/.test(key)) {
    if (body.replace(/\D/g, '').length >= MAX_DIGITS) return { value: v, msg: 'calc.maxDigits' };
    if (body.includes('.') && body.split('.')[1].length >= MAX_DECIMALS) return { value: v, msg: 'calc.maxDecimals' };
    body = body === '0' ? key : body + key;
  }
  return { value: (neg ? '-' : '') + body };
}

/** Tip calculator: bill, tip per cent and number of people → { tip, total, each }. */
export function tipSplit(bill, pct, people) {
  const b = Number(bill) || 0, p = Number(pct) || 0, n = Math.max(1, Math.floor(Number(people) || 1));
  const tip = (b * p) / 100;
  return { tip: round12(tip), total: round12(b + tip), each: round12((b + tip) / n) };
}
