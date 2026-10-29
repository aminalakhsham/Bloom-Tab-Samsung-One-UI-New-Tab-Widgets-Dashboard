// One-dimensional barcodes: Code 128 (sets B and C, switching automatically so runs of digits take half the
// space), EAN-13 and UPC-A. Each encoder returns { modules: '1011…' (1 = bar), text } or null when the text can't be
// encoded. Pure logic, shared by the app and the tests.

// bar/space widths of the 107 Code 128 symbols (values 0–102, Start A/B/C 103–105, Stop 106)
export const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104, START_C = 105, TO_C = 99, TO_B = 100, STOP = 106;

const widthsToModules = w => [...w].map((n, i) => (i % 2 ? '0' : '1').repeat(+n)).join('');

/** Code 128 symbol values for `text` (printable ASCII only), with the check value and Stop. */
export function code128Values(text) {
  text = String(text ?? '');
  if (!text || !/^[\x20-\x7e]+$/.test(text)) return null;
  const digits = i => { let n = 0; while (i + n < text.length && text.charCodeAt(i + n) >= 48 && text.charCodeAt(i + n) <= 57) n++; return n; };
  const v = [];
  const d0 = digits(0);
  // set C pays off from the start for 4+ digits, or for a text that is just two digits
  let set = d0 >= 4 || (d0 === 2 && text.length === 2) ? 'C' : 'B';
  v.push(set === 'C' ? START_C : START_B);
  for (let i = 0; i < text.length;) {
    if (set === 'C') {
      if (digits(i) >= 2) { v.push(+text.substr(i, 2)); i += 2; continue; }
      v.push(TO_B); set = 'B';
    }
    // a run of digits is worth a switch to set C when it ends the text (4+) or is long enough to switch back (6+)
    const d = digits(i);
    if (d >= 4 && (i + d === text.length || d >= 6)) {
      if (d % 2) { v.push(text.charCodeAt(i) - 32); i++; }
      v.push(TO_C); set = 'C';
      continue;
    }
    v.push(text.charCodeAt(i) - 32); i++;
  }
  let sum = v[0];
  for (let k = 1; k < v.length; k++) sum += k * v[k];
  v.push(sum % 103, STOP);
  return v;
}
export function code128(text) {
  const v = code128Values(text);
  return v && { modules: v.map(x => widthsToModules(C128[x])).join(''), text: String(text) };
}

// ---------------------------------------------------------------- EAN-13 / UPC-A
const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R_CODES = L_CODES.map(c => [...c].map(b => (b === '1' ? '0' : '1')).join(''));
const G_CODES = R_CODES.map(c => [...c].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The check digit of a GTIN (EAN-13, UPC-A…) from the digits before it: weights 3 and 1 from the right. */
export function gtinCheck(digits) {
  let s = 0;
  [...String(digits)].reverse().forEach((d, i) => { s += +d * (i % 2 ? 1 : 3); });
  return String((10 - (s % 10)) % 10);
}
/** EAN-13 from 12 digits (the check digit is added) or 13 (the check digit must be right). */
export function ean13(input) {
  const s = String(input ?? '').replace(/[\s-]/g, '');
  if (!/^\d{12,13}$/.test(s)) return null;
  const full = s.slice(0, 12) + gtinCheck(s.slice(0, 12));
  if (s.length === 13 && s !== full) return null;
  const par = PARITY[+full[0]];
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L_CODES : G_CODES)[+full[i]];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R_CODES[+full[i]];
  m += '101';
  return { modules: m, text: full };
}
/** UPC-A from 11 digits (the check digit is added) or 12: an EAN-13 that starts with 0. */
export function upca(input) {
  const s = String(input ?? '').replace(/[\s-]/g, '');
  if (!/^\d{11,12}$/.test(s)) return null;
  const e = ean13('0' + s);
  return e && { modules: e.modules, text: e.text.slice(1) };
}
