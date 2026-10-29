// Samsung Notes' "Save as file": PDF file, Markdown file and Text file, plus Print. The PDF is written here byte by byte
// (no library): each A4 page is a picture of the note laid out with the export styles (drawn through an SVG
// <foreignObject>, which Chrome lets a page read back from a data: URL), cut between paragraphs where it can.
// Pictures and drawings come along; a voice recording becomes a line naming it.
import { h, download } from '../core/util.js';
import { t, lang } from '../core/i18n.js';
import { getBlob } from '../core/blobs.js';
import { noteText, toMarkdown, parse, TEXT_COLORS, HL_COLORS } from './html.js';

const fileName = (s) => (String(s || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || t('app.notes'));
const titleOf = (n, html) => n.title?.trim() || noteText(html).split('\n')[0] || t('common.untitled');

const CSS = () => `.nt-doc{font:16px/1.6 "Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic",Tahoma,sans-serif;color:#1b1b1f;unicode-bidi:plaintext;word-wrap:break-word}
.nt-doc h1.nt-t{font-size:26px;margin:0 0 4px}.nt-doc .nt-d{font-size:12px;color:#777;margin-bottom:18px}
.nt-doc h1{font-size:24px;margin:.5em 0 .2em}.nt-doc h2{font-size:20px;margin:.5em 0 .2em}.nt-doc h3{font-size:17px;margin:.5em 0 .2em}
.nt-doc div,.nt-doc p{margin:0;min-height:1.6em}.nt-doc blockquote{margin:4px 0;padding-inline-start:12px;border-inline-start:3px solid #ccc;color:#555}
.nt-doc ul,.nt-doc ol{margin:2px 0;padding-inline-start:1.6em}.nt-doc ul.checklist{list-style:none;padding-inline-start:0}
.nt-doc ul.checklist>li{position:relative;padding-inline-start:28px}.nt-doc ul.checklist>li::before{content:"";position:absolute;inset-inline-start:2px;top:.3em;width:15px;height:15px;border-radius:50%;border:2px solid #999}
.nt-doc ul.checklist>li[data-checked="true"]{color:#888;text-decoration:line-through}.nt-doc ul.checklist>li[data-checked="true"]::before{background:#6b4eff;border-color:#6b4eff}
.nt-doc table{border-collapse:collapse;margin:8px 0;width:100%}.nt-doc td{border:1px solid #ccc;padding:6px 10px;vertical-align:top}
.nt-doc hr{border:0;border-top:1px solid #ccc;margin:14px 0}.nt-doc img{display:block;max-width:100%;border-radius:10px;margin:6px 0}
.nt-doc .nt-v{color:#777;font-size:14px;margin:6px 0}.nt-doc [data-al="center"]{text-align:center}.nt-doc [data-al="end"]{text-align:end}
${Object.entries(TEXT_COLORS).map(([k, c]) => `.nt-doc [data-tc="${k}"]{color:${c}}`).join('')}
${Object.entries(HL_COLORS).map(([k, c]) => `.nt-doc mark[data-hl="${k}"]{background:${c}88;color:inherit}`).join('')}.nt-doc mark[data-hl="none"]{background:none;color:inherit}
${[12, 14, 20, 24, 32].map((s) => `.nt-doc [data-fs="${s}"]{font-size:${s}px}`).join('')}`;

const toDataUrl = (blob) => new Promise((res) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => res(null);
  fr.readAsDataURL(blob);
});

/** The note as one HTML fragment for printing and the PDF: title, date, body with pictures inlined. */
async function docHtml(n, html) {
  const body = parse(html);
  for (const f of [...body.querySelectorAll('figure[data-att]')]) {
    if (f.getAttribute('data-k') === 'voice') {
      f.replaceWith(Object.assign(document.createElement('div'), { className: 'nt-v', textContent: '🎤 ' + t('notes.voice') }));
      continue;
    }
    const b = await getBlob(f.getAttribute('data-att')).catch(() => null);
    const src = b && (await toDataUrl(b));
    if (!src) {
      f.remove();
      continue;
    }
    const img = document.createElement('img');
    img.setAttribute('src', src);
    img.setAttribute('alt', '');
    f.replaceWith(img);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = new Date(n.updated || Date.now()).toLocaleString(lang() === 'ar' ? 'ar-u-nu-latn' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `<h1 class="nt-t" dir="auto">${esc(titleOf(n, html))}</h1><div class="nt-d">${esc(when)}</div><div class="nt-b" dir="auto">${body.innerHTML}</div>`;
}

export function saveText(n, html) {
  const text = [n.title?.trim(), noteText(html)].filter(Boolean).join('\n\n');
  download(fileName(titleOf(n, html)) + '.txt', text, 'text/plain;charset=utf-8');
}
export function saveMarkdown(n, html) {
  download(fileName(titleOf(n, html)) + '.md', toMarkdown(n.title, html), 'text/markdown;charset=utf-8');
}

/** Opens Chrome's print dialog for the note alone ("Save as PDF" is there too). */
export async function printNote(n, html) {
  const inner = await docHtml(n, html);
  const dir = document.documentElement.dir || 'ltr';
  const frame = h('iframe', { class: 'nt-print-frame', 'aria-hidden': 'true', tabindex: '-1' });
  frame.srcdoc = `<!doctype html><html lang="${lang()}" dir="${dir}"><head><meta charset="utf-8"><title>${titleOf(n, html).replace(/</g, '&lt;')}</title><style>body{margin:32px}${CSS()}</style></head><body><div class="nt-doc">${inner}</div></body></html>`;
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  try {
    frame.contentWindow.print();
  } catch (e) {
    console.warn('notes print', e);
  }
  setTimeout(() => frame.remove(), 2000);
}

// ——— PDF ———
const PW = 794, PH = 1123, M = 64, CW = PW - M * 2, CH = PH - M * 2, K = 2; // A4 at 96 dpi, margins, pixel ratio

/** The note laid out at the page's width: returns { holder, doc, breaks: [y of each page start] }. */
async function layout(n, html) {
  const holder = h('div', { style: `position:fixed;left:-20000px;top:0;width:${CW}px;visibility:hidden;pointer-events:none` });
  const root = holder.attachShadow({ mode: 'open' });
  const dir = document.documentElement.dir || 'ltr';
  root.innerHTML = `<style>${CSS()}</style><div class="nt-doc" dir="${dir}">${await docHtml(n, html)}</div>`;
  document.body.appendChild(holder);
  const doc = root.querySelector('.nt-doc');
  await Promise.all([...doc.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  // page breaks fall between blocks (list items and table rows count as blocks) unless one is taller than a page
  const blocks = [doc.querySelector('.nt-t'), doc.querySelector('.nt-d'), ...[...doc.querySelector('.nt-b').children].flatMap((b) => (/^(UL|OL)$/.test(b.tagName) ? [...b.children] : b.tagName === 'TABLE' ? [...b.rows] : [b]))];
  const top0 = doc.getBoundingClientRect().top;
  const total = doc.scrollHeight;
  const breaks = [0];
  for (const b of blocks) {
    const r = b.getBoundingClientRect(), y = r.top - top0, end = r.bottom - top0;
    if (end - breaks.at(-1) <= CH) continue;
    if (y > breaks.at(-1) && end - y <= CH) breaks.push(y);
    else while (end - breaks.at(-1) > CH) breaks.push(breaks.at(-1) + CH);
  }
  while (total - breaks.at(-1) > CH) breaks.push(breaks.at(-1) + CH);
  return { holder, doc, breaks, total };
}

async function pagePicture(doc, y, hgt) {
  const xml = new XMLSerializer().serializeToString(doc.getRootNode().querySelector('style')) + new XMLSerializer().serializeToString(doc);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${hgt}"><foreignObject width="${CW}" height="${hgt}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${CW}px;height:${hgt}px;overflow:hidden"><div style="margin-top:${-y}px">${xml}</div></div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const c = document.createElement('canvas');
  c.width = PW * K;
  c.height = PH * K;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.scale(K, K);
  g.drawImage(img, M, M, CW, hgt);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

const enc = (s) => new TextEncoder().encode(s);
const pdfText = (s) => '<FEFF' + [...String(s)].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 0x10000) return c.toString(16).padStart(4, '0');
  const v = c - 0x10000;
  return (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16);
}).join('').toUpperCase() + '>';

/** A PDF of JPEG pages (each PW×PH CSS pixels = 0.75 pt each). */
export function pdfOf(jpegs, title) {
  const pw = PW * 0.75, ph = PH * 0.75;
  const parts = [], offs = [];
  let len = 0;
  const push = (p) => {
    const b = typeof p === 'string' ? enc(p) : p;
    parts.push(b);
    len += b.length;
  };
  const obj = (n, body) => {
    offs[n] = len;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n%âãÏÓ\n');
  const N = jpegs.length, kids = jpegs.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${N} >>`);
  obj(3, `<< /Title ${pdfText(title)} /Producer (Bloom Tab Notes) >>`);
  jpegs.forEach((jpg, i) => {
    const p = 4 + i * 3;
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`);
    offs[p + 1] = len;
    push(`${p + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PW * K} /Height ${PH * K} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg);
    push('\nendstream\nendobj\n');
    obj(p + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 4 + N * 3, xref = len;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(`${x}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** Builds the note's PDF (a Blob). */
export async function notePdf(n, html) {
  const { holder, doc, breaks, total } = await layout(n, html);
  try {
    const pages = [];
    for (let i = 0; i < breaks.length && i < 60; i++) {
      const y = breaks[i], end = breaks[i + 1] ?? total;
      pages.push(await pagePicture(doc, y, Math.max(1, Math.min(CH, end - y))));
    }
    return pdfOf(pages, titleOf(n, html));
  } finally {
    holder.remove();
  }
}
export async function savePdf(n, html) {
  const blob = await notePdf(n, html);
  const a = h('a', { href: URL.createObjectURL(blob), download: fileName(titleOf(n, html)) + '.pdf' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  return blob;
}
