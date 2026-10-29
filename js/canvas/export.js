// Draws a board (or some of its items) onto a canvas by hand, so nothing can taint it: Save as image (PNG), Copy as
// image, the PDF (one page holding the picture, written byte by byte below, no library), Print, and the small light
// and dark previews the gallery and the widget show. Text is wrapped and laid out with the same rules as on the board.
import { getBlob, putBlob, delBlob } from '../core/blobs.js';
import { faviconUrl } from '../core/util.js';
import { noteColor, aabb, lineGeom, contentBox, dirOf, shortUrl, hostOf, DEF, rad, thumbId } from './model.js';
import { shapePath } from './shapes.js';
import { inkPath, inkAlpha } from './ink.js';

export const THEME = {
  l: { bg: '#ffffff', ink: '#000000', ink2: 'rgba(0,0,0,.55)', card: '#ffffff', tile: '#f2f2f4', edge: 'rgba(0,0,0,.1)' },
  d: { bg: '#17171a', ink: '#ffffff', ink2: 'rgba(255,255,255,.6)', card: '#232327', tile: '#2e2e33', edge: 'rgba(255,255,255,.12)' },
};
// the board's text fonts: the system font, the One UI display font, a serif and a monospaced one
const FONT_CSS = {
  sys: 'var(--font)',
  disp: 'var(--font-display)',
  ser: 'Georgia, "Times New Roman", "Noto Naskh Arabic", serif',
  mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
};
export const fontCss = (k) => FONT_CSS[k] || FONT_CSS.sys;
let families = null;
function family(k) {
  if (!families) {
    const cs = getComputedStyle(document.documentElement), v = (name, d) => cs.getPropertyValue(name).trim() || d;
    families = { ...FONT_CSS, sys: v('--font', 'system-ui, sans-serif'), disp: v('--font-display', 'system-ui, sans-serif') };
  }
  return families[k] || families.sys;
}
export const colorOf = (c, th, def = 'auto') => (!c || c === 'auto' ? (def === 'auto' ? th.ink : def) : c);

// ---------------------------------------------------------------- pictures
const bitmaps = new Map();
async function bitmap(id) {
  if (!bitmaps.has(id)) bitmaps.set(id, getBlob(id).then((b) => (b ? createImageBitmap(b) : null)).catch(() => null));
  return bitmaps.get(id);
}
const icons = new Map();
function favicon(u) {
  // Chrome's own favicon service is same-origin for the extension, so the picture can't taint the canvas
  if (!icons.has(u)) icons.set(u, new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = faviconUrl(u, 64); }));
  return icons.get(u);
}
async function assets(items) {
  const imgs = new Map(), favs = new Map();
  await Promise.all(items.map(async (it) => {
    if (it.t === 'img' && it.b) imgs.set(it.b, await bitmap(it.b));
    if (it.t === 'link' && it.u) favs.set(it.u, await favicon(it.u));
  }));
  const fams = new Set(items.filter((it) => it.tx).map((it) => it.font || 'sys'));
  await Promise.all([...fams].map((k) => document.fonts?.load?.(`16px ${family(k)}`).catch(() => null)));
  return { imgs, favs };
}

// ---------------------------------------------------------------- text
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const dir = dirOf(para);
    if (!para) { out.push({ s: '', dir }); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const test = line + word;
      if (ctx.measureText(test).width <= maxW || !line.trim()) {
        line = test;
        // a word wider than the box is broken between letters (and text without spaces, like Chinese, too)
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let i = line.length - 1;
          while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
          out.push({ s: line.slice(0, i), dir }); line = line.slice(i);
        }
      } else { out.push({ s: line.trimEnd(), dir }); line = word.trimStart(); }
    }
    out.push({ s: line, dir });
  }
  return out;
}
const fontStr = (o, fs) => `${o.i ? 'italic ' : ''}${o.b ? 700 : o.t === 'note' ? 500 : 400} ${fs}px ${family(o.font)}`;
export const LINE_H = 1.25;
/** The size sticky-note text shrinks to so it fits the note (the board measures the same thing in the page). */
export function fitSize(ctx, it, w, h, max) {
  let lo = 6, hi = Math.max(6, max);
  const fits = (fs) => { ctx.font = fontStr(it, fs); return wrap(ctx, it.tx || '', w).length * fs * LINE_H <= h; };
  if (fits(hi)) return hi;
  for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return lo;
}
function drawText(ctx, o, x, y, w, h, fs, color, vAlign) {
  ctx.font = fontStr(o, fs);
  const lines = wrap(ctx, o.tx || '', w), lh = fs * LINE_H;
  let ty = vAlign === 'middle' ? y + (h - lines.length * lh) / 2 : y;
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.textBaseline = 'middle';
  for (const ln of lines) {
    const al = o.al || (o.t === 'note' || o.t === 'shape' ? 'c' : '');
    const right = al === 'r' || ((!al || al === 'j') && ln.dir === 'rtl');
    ctx.direction = ln.dir;
    ctx.textAlign = al === 'c' ? 'center' : right ? 'right' : 'left';
    const tx = al === 'c' ? x + w / 2 : right ? x + w : x;
    ctx.fillText(ln.s, tx, ty + lh / 2);
    if ((o.u || o.s) && ln.s) {
      const lw = ctx.measureText(ln.s).width, x0 = al === 'c' ? tx - lw / 2 : right ? tx - lw : tx;
      ctx.lineWidth = Math.max(1, fs / 14);
      if (o.u) { ctx.beginPath(); ctx.moveTo(x0, ty + lh / 2 + fs * 0.55); ctx.lineTo(x0 + lw, ty + lh / 2 + fs * 0.55); ctx.stroke(); }
      if (o.s) { ctx.beginPath(); ctx.moveTo(x0, ty + lh / 2 + fs * 0.05); ctx.lineTo(x0 + lw, ty + lh / 2 + fs * 0.05); ctx.stroke(); }
    }
    ty += lh;
  }
  ctx.direction = 'ltr';
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function dash(ctx, ds, sw) { ctx.setLineDash(ds === 1 ? [sw * 3, sw * 2] : ds === 2 ? [0.01, sw * 2] : []); ctx.lineCap = 'round'; }

// ---------------------------------------------------------------- items
function drawItem(ctx, it, th, A, byId, k, fsOf, dark) {
  if (it.t === 'line') {
    const g = lineGeom(it, byId), col = colorOf(it.st, th), sw = it.sw ?? DEF.line.sw;
    ctx.save(); ctx.globalAlpha = it.op ?? 1; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sw; ctx.lineJoin = 'round';
    dash(ctx, it.ds, sw); ctx.stroke(new Path2D(g.d)); ctx.setLineDash([]);
    for (const hd of g.heads) { const p = new Path2D(hd); ctx.fill(p); ctx.lineWidth = 1; ctx.stroke(p); }
    ctx.restore();
    return;
  }
  const { x, y, w, h } = it;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (it.r) ctx.rotate(rad(it.r));
  ctx.translate(-w / 2, -h / 2);
  ctx.globalAlpha = it.op ?? 1;
  if (it.t === 'note') {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 10 * k; ctx.shadowOffsetY = 2 * k;
    rr(ctx, 0, 0, w, h, 6); ctx.fillStyle = noteColor(it.c); ctx.fill(); ctx.restore();
    const pad = Math.min(w, h) * 0.09, max = ((it.fs || DEF.note.fs) * Math.min(w, h)) / 200;
    const fs = fsOf?.(it.id) || fitSize(ctx, it, w - pad * 2, h - pad * 2, max);
    drawText(ctx, it, pad, pad, w - pad * 2, h - pad * 2, fs, '#1a1a1a', 'middle');
  } else if (it.t === 'text') {
    drawText(ctx, it, 4, 4, w - 8, h - 8, it.fs || DEF.text.fs, colorOf(it.col, th), 'top');
  } else if (it.t === 'shape') {
    const { d, eo } = shapePath(it), p = new Path2D(d);
    if (it.fill !== 'none') { ctx.fillStyle = colorOf(it.fill, th, DEF.shape.fill); ctx.fill(p, eo ? 'evenodd' : 'nonzero'); }
    if (it.st && it.st !== 'none' && (it.sw ?? 2) > 0) { ctx.strokeStyle = colorOf(it.st, th); ctx.lineWidth = it.sw ?? 2; ctx.lineJoin = 'round'; dash(ctx, it.ds, it.sw ?? 2); ctx.stroke(p); ctx.setLineDash([]); }
    if (it.tx) { ctx.globalAlpha = 1; const pad = 10; drawText(ctx, it, pad, pad, w - pad * 2, h - pad * 2, it.fs || 18, colorOf(it.col, th, it.fill === 'none' ? 'auto' : '#fff'), 'middle'); }
  } else if (it.t === 'img') {
    const bmp = A.imgs.get(it.b);
    ctx.save(); rr(ctx, 0, 0, w, h, it.rad || 0); ctx.clip();
    if (bmp) ctx.drawImage(bmp, 0, 0, w, h);
    else { ctx.fillStyle = th.tile; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  } else if (it.t === 'link') {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 8 * k; ctx.shadowOffsetY = 1 * k;
    rr(ctx, 0, 0, w, h, 20); ctx.fillStyle = th.card; ctx.fill(); ctx.restore();
    rr(ctx, 0.5, 0.5, w - 1, h - 1, 20); ctx.strokeStyle = th.edge; ctx.lineWidth = 1; ctx.stroke();
    const s = Math.min(h - 24, 56), ix = 12, iy = (h - s) / 2;
    rr(ctx, ix, iy, s, s, s * 0.32); ctx.fillStyle = th.tile; ctx.fill();
    const fav = A.favs.get(it.u);
    if (fav) ctx.drawImage(fav, ix + s * 0.22, iy + s * 0.22, s * 0.56, s * 0.56);
    const tx = ix + s + 12, tw = w - tx - 14;
    ctx.save(); ctx.beginPath(); ctx.rect(tx, 0, tw, h); ctx.clip();
    const title = it.tx || hostOf(it.u) || it.u, rtl = dirOf(title) === 'rtl';
    ctx.textBaseline = 'middle'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
    ctx.font = `600 16px ${family('sys')}`; ctx.fillStyle = th.ink; ctx.fillText(title, rtl ? tx + tw : tx, h / 2 - 10);
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
    ctx.font = `400 13.5px ${family('sys')}`; ctx.fillStyle = th.ink2; ctx.fillText(shortUrl(it.u), tx, h / 2 + 11);
    ctx.restore();
  } else if (it.t === 'ink') {
    const { d, fill } = inkPath(it), col = colorOf(it.col, th);
    ctx.scale(w / (it.iw || w), h / (it.ih || h));
    ctx.globalAlpha = (it.op ?? 1) * inkAlpha(it);
    // a highlighter tints what's under it, as on paper
    if (it.tool === 'hl') ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
    if (fill) { ctx.fillStyle = col; ctx.fill(new Path2D(d)); }
    else { ctx.strokeStyle = col; ctx.lineWidth = it.sz; ctx.lineCap = it.tool === 'hl' ? 'butt' : 'round'; ctx.lineJoin = 'round'; ctx.stroke(new Path2D(d)); }
  }
  ctx.restore();
}

/** Draws items onto a new canvas. rect = the part of the board to show (default: everything, with a margin). */
export async function renderItems(items, { theme = 'l', scale = 2, pad = 40, rect, bg = true, fsOf, fit, all = items } = {}) {
  const th = THEME[theme] || THEME.l, byId = new Map(all.map((i) => [i.id, i]));
  const A = await assets(items);
  let R = rect || contentBox(items, byId) || { x: 0, y: 0, w: 400, h: 300 };
  if (!rect) R = { x: R.x - pad, y: R.y - pad, w: R.w + pad * 2, h: R.h + pad * 2 };
  let k = scale, W, H, ox = 0, oy = 0;
  if (fit) { // a fixed-size preview: the content is centred and scaled to fit
    W = fit.w; H = fit.h; k = Math.min(W / R.w, H / R.h, fit.max || 1.5);
    ox = (W - R.w * k) / 2; oy = (H - R.h * k) / 2;
  } else {
    // very large boards are scaled down to stay within what a canvas can hold
    k = Math.min(scale, 12000 / R.w, 12000 / R.h, Math.sqrt(60e6 / (R.w * R.h)));
    W = Math.max(1, Math.ceil(R.w * k)); H = Math.max(1, Math.ceil(R.h * k));
  }
  const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  cv.k = k;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H); }
  ctx.translate(ox, oy); ctx.scale(k, k); ctx.translate(-R.x, -R.y);
  for (const it of items) {
    const b = aabb(it, byId);
    if (b.x > R.x + R.w || b.y > R.y + R.h || b.x + b.w < R.x || b.y + b.h < R.y) continue;
    try { drawItem(ctx, it, th, A, byId, k, fsOf, theme === 'd'); } catch (e) { console.warn('canvas draw', e); }
  }
  return cv;
}
export const toBlob = (cv, type = 'image/png', quality) => (cv.convertToBlob ? cv.convertToBlob({ type, quality }) : new Promise((r) => cv.toBlob(r, type, quality)));

// ---------------------------------------------------------------- PDF
const enc = (s) => new TextEncoder().encode(s);
const pdfText = (s) => '<FEFF' + [...String(s)].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 0x10000) return c.toString(16).padStart(4, '0');
  const v = c - 0x10000;
  return (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16);
}).join('').toUpperCase() + '>';
/** A one-page PDF holding the picture of the board at its real size (1 board unit = 1 CSS pixel = 0.75 pt). */
export async function pdfBlob(cv, k, title) {
  const jpeg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.92)).arrayBuffer());
  const pw = Math.min(14400, (cv.width / k) * 0.75), ph = Math.min(14400, (cv.height / k) * 0.75);
  const fx = (v) => Math.round(v * 100) / 100;
  const content = `q ${fx(pw)} 0 0 ${fx(ph)} 0 0 cm /Im0 Do Q`;
  const parts = [], offs = [];
  let len = 0;
  const push = (p) => { const b = typeof p === 'string' ? enc(p) : p; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%~~~~\n');
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fx(pw)} ${fx(ph)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offs[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg); push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title ${pdfText(title)} /Producer (Bloom Tab Canvas) >>`);
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((n) => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------------------------------------------------------------- previews
export const THUMB = { w: 480, h: 300 };
/** Renders the light and dark previews of a board and stores them; returns { l, d } blob keys (old ones are deleted). */
export async function makeThumbs(board, fsOf) {
  const out = {}, now = Date.now();
  for (const th of ['l', 'd']) {
    const cv = await renderItems(board.items, { theme: th, fit: { ...THUMB, max: 1.2 }, pad: 30, fsOf });
    const id = thumbId(board.id, th, now);
    await putBlob(id, await toBlob(cv, 'image/webp', 0.85));
    out[th] = id;
  }
  for (const old of [board.thumb?.l, board.thumb?.d]) if (old && old !== out.l && old !== out.d) delBlob(old).catch(() => {});
  return out;
}

/** Prints a picture of the board through a hidden frame, with the board's name as the page title. */
export async function printCanvas(cv, title) {
  const url = URL.createObjectURL(await toBlob(cv));
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;inset-inline-start:-9999px;width:800px;height:600px;border:0';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:12mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${url}" alt=""></body></html>`;
  document.body.appendChild(f);
  f.onload = () => {
    setTimeout(() => {
      try { f.contentWindow.print(); } catch { /* printing was blocked */ }
      setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 1500);
    }, 100);
  };
}
