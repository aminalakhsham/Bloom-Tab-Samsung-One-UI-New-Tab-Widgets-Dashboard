// Barcodes for passes: encodes with the encoders next to this file and draws crisp SVG on white with a quiet zone.
// Pure string output (no DOM), so the widgets and tests can use it too. Ported from Liquid Tab.
import { qrEncode } from './qr.js';
import { code128, ean13, upca } from './linear.js';
import { pdf417Encode } from './pdf417.js';

export const FORMAT_NAMES = { qr: 'QR Code', pdf417: 'PDF417', code128: 'Code 128', ean13: 'EAN-13', upca: 'UPC-A' };
// BarcodeDetector's names for the formats that can be drawn again
export const DETECTED = { qr_code: 'qr', pdf417: 'pdf417', code_128: 'code128', ean_13: 'ean13', upc_a: 'upca' };
export const isSquare = type => type === 'qr';

/** Why the message can't be drawn in this format (an i18n key), or '' when it can. */
export function codeProblem(type, msg) {
  msg = String(msg ?? '');
  if (!type || !msg) return '';
  if (type === 'qr') return qrEncode(msg, { ecl: 'M', boost: false }) ? '' : 'wallet.err.qrLong';
  if (type === 'pdf417') return pdf417Encode(msg) ? '' : 'wallet.err.pdfLong';
  if (type === 'code128') return code128(msg) ? '' : 'wallet.err.c128';
  if (type === 'ean13') return ean13(msg) ? '' : /^\d{13}$/.test(msg.replace(/[\s-]/g, '')) ? 'wallet.err.eanCheck' : 'wallet.err.eanLen';
  if (type === 'upca') return upca(msg) ? '' : /^\d{12}$/.test(msg.replace(/[\s-]/g, '')) ? 'wallet.err.upcCheck' : 'wallet.err.upcLen';
  return '';
}

const runs = (row, y, h, x0 = 0) => {
  let d = '';
  for (let x = 0; x < row.length;) {
    if (!row[x]) { x++; continue; }
    let n = 1;
    while (x + n < row.length && row[x + n]) n++;
    d += `M${x + x0} ${y}h${n}v${h}h-${n}z`;
    x += n;
  }
  return d;
};
const svg = (w, h, inner, cls) => `<svg class="wl-code ${cls}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" role="img" aria-hidden="true"><rect width="${w}" height="${h}" fill="#fff"/>${inner}</svg>`;

/** SVG markup for a barcode, or '' when it can't be encoded. */
export function barcodeSVG(type, msg) {
  msg = String(msg ?? '');
  if (!type || !msg) return '';
  if (type === 'qr') {
    const q = qrEncode(msg, { ecl: 'M' });
    if (!q) return '';
    const Z = 4, n = q.size;
    let d = '';
    for (let y = 0; y < n; y++) d += runs(Array.from(q.modules.subarray(y * n, y * n + n)), y + Z, 1, Z);
    return svg(n + Z * 2, n + Z * 2, `<path d="${d}" fill="#000"/>`, 'qr');
  }
  if (type === 'pdf417') {
    const p = pdf417Encode(msg, { ratio: 3.4 });
    if (!p) return '';
    const Z = 2, RH = 3;
    let d = '';
    for (let y = 0; y < p.rows; y++) d += runs(Array.from(p.bits.subarray(y * p.width, (y + 1) * p.width)), Z + y * RH, RH, Z);
    return svg(p.width + Z * 2, p.rows * RH + Z * 2, `<path d="${d}" fill="#000"/>`, 'pdf417');
  }
  if (type === 'code128') {
    const c = code128(msg);
    if (!c) return '';
    const Z = 10, H = Math.max(40, Math.round(c.modules.length * .3));
    return svg(c.modules.length + Z * 2, H, `<path d="${runs([...c.modules].map(Number), 0, H, Z)}" fill="#000"/>`, 'linear');
  }
  // EAN-13 / UPC-A: guard bars run down between the digit groups, the digits sit under the bars
  const e = type === 'ean13' ? ean13(msg) : upca(msg);
  if (!e) return '';
  const L = 11, R = 9, H = 62, G = 6, W = 95 + L + R;
  const m = [...e.modules].map(Number);
  const tall = i => i < 3 || (i >= 45 && i < 50) || i >= 92 || (type === 'upca' && (i < 10 || i >= 85));
  let d = '';
  for (let i = 0; i < 95; i++) if (m[i]) d += `M${i + L} 0h1v${tall(i) ? H + G : H}h-1z`;
  const font = 'font-family="ui-monospace,Menlo,Consolas,monospace" font-size="10" fill="#000" text-anchor="middle"';
  const digit = (ch, x, small) => `<text x="${x}" y="${H + 9}" ${font}${small ? ' font-size="7"' : ''}>${ch}</text>`;
  let tx = '';
  if (type === 'ean13') {
    const t = e.text;
    tx += digit(t[0], L - 5);
    for (let i = 0; i < 6; i++) tx += digit(t[1 + i], L + 3 + i * 7 + 3.5);
    for (let i = 0; i < 6; i++) tx += digit(t[7 + i], L + 50 + i * 7 + 3.5);
  } else {
    const t = e.text;
    tx += digit(t[0], L - 5, true);
    for (let i = 0; i < 5; i++) tx += digit(t[1 + i], L + 10 + i * 7 + 3.5);
    for (let i = 0; i < 5; i++) tx += digit(t[6 + i], L + 50 + i * 7 + 3.5);
    tx += digit(t[11], L + 95 + 5, true);
  }
  return svg(W, H + G + 6, `<path d="${d}" fill="#000"/>${tx}`, 'linear ean');
}
