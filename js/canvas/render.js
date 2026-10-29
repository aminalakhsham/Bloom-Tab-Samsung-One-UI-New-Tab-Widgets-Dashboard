// How each item looks on the board (DOM). An item's element is only rebuilt when its content changes; moving it
// just changes its position, which keeps boards with hundreds of items smooth.
import { blobUrl } from '../core/blobs.js';
import { escapeHtml as esc, faviconUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { noteColor, lineGeom, shortUrl, hostOf, DEF } from './model.js';
import { shapePath } from './shapes.js';
import { inkPath, inkAlpha, TOOLS } from './ink.js';
import { fontCss } from './export.js';

const NS = 'http://www.w3.org/2000/svg';
const col = (c, def = 'var(--cv-ink)') => (!c || c === 'auto' ? def : c);
const textStyle = (it) => `font-family:${fontCss(it.font)};font-weight:${it.b ? 700 : it.t === 'note' ? 500 : 400};font-style:${it.i ? 'italic' : 'normal'};text-decoration:${[it.u && 'underline', it.s && 'line-through'].filter(Boolean).join(' ') || 'none'};text-align:${{ l: 'left', c: 'center', r: 'right', j: 'justify' }[it.al] || (it.t === 'text' ? 'start' : 'center')}`;
const dash = (ds, sw) => (ds === 1 ? `stroke-dasharray="${sw * 3} ${sw * 2}"` : ds === 2 ? `stroke-dasharray=".01 ${sw * 2}"` : '');
const pid = new WeakMap();
let pn = 0;
const pkey = (p) => {
  if (!p) return 0;
  if (!pid.has(p)) pid.set(p, ++pn);
  return pid.get(p);
};

/** What an item shows, apart from where it is; when this changes the element is rebuilt. */
function contentKey(it) {
  switch (it.t) {
    case 'note': return [it.c, it.tx, it.fs, it.font, it.b, it.i, it.u, it.s, it.al, it.w, it.h].join('|');
    case 'text': return [it.tx, it.fs, it.font, it.col, it.b, it.i, it.u, it.s, it.al].join('|');
    case 'shape': return [it.k, it.fill, it.st, it.sw, it.ds, it.op, it.rad, it.n, it.pp, it.w, it.h, it.tx, it.fs, it.font, it.col, it.b, it.i, it.u, it.s, it.al].join('|');
    case 'img': return [it.b, it.op, it.rad].join('|');
    case 'link': return [it.u, it.tx].join('|');
    case 'ink': return [pkey(it.p), it.tool, it.col, it.sz, it.iw, it.ih, it.op].join('|');
    default: return '';
  }
}

export function makeNode(it) {
  const el = it.t === 'line' || it.t === 'ink' ? document.createElementNS(NS, 'svg') : document.createElement('div');
  el.setAttribute('class', `cv-it cv-${it.t}`);
  el.dataset.id = it.id;
  return { el, it: null, ck: null, gk: null, tx: null, fs: 0 };
}

/** Brings an element up to date with its item. Returns true when the page had to measure it (text). */
export function paint(node, it, byId, { editing = false } = {}) {
  const el = node.el;
  if (it.t === 'line') {
    const g = lineGeom(it, byId), sw = it.sw ?? DEF.line.sw;
    const key = [g.d, g.heads.join(''), it.st, sw, it.ds, it.op].join('|');
    if (key !== node.gk) {
      const b = g.box;
      el.setAttribute('width', b.w); el.setAttribute('height', b.h);
      el.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
      el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
      el.style.opacity = it.op ?? 1;
      const c = col(it.st);
      el.innerHTML = `<path class="cv-hit" d="${g.d}"/><path d="${g.d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${dash(it.ds, sw)}/>${g.heads.map((h) => `<path d="${h}" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>`).join('')}`;
      node.gk = key;
    }
    el.classList.toggle('lk', !!it.lk);
    node.it = it;
    return false;
  }
  // placed with left/top, and given a transform only when turned: a board of hundreds of items then has far fewer
  // pieces for Chrome to sort into layers at each frame
  el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.transform = it.r ? `rotate(${it.r}deg)` : '';
  if (it.t === 'ink') {
    el.setAttribute('width', Math.max(1, it.w)); el.setAttribute('height', Math.max(1, it.h));
    // a stroke at its drawn size needs no viewBox, and so no scaling step of its own for Chrome to sort out each frame
    const scaled = Math.abs((it.iw || it.w) - it.w) > 0.05 || Math.abs((it.ih || it.h) - it.h) > 0.05;
    if (scaled) { el.setAttribute('viewBox', `0 0 ${it.iw || it.w} ${it.ih || it.h}`); el.setAttribute('preserveAspectRatio', 'none'); }
    else { el.removeAttribute('viewBox'); el.removeAttribute('preserveAspectRatio'); }
  }
  else {
    el.style.width = it.w + 'px';
    if (it.t !== 'text') el.style.height = it.h + 'px';
  }
  el.classList.toggle('lk', !!it.lk);
  const ck = contentKey(it);
  let measured = false;
  if (ck !== node.ck && !(editing && node.tx)) {
    build(node, it);
    node.ck = ck;
    measured = true;
  } else if (editing && ck !== node.ck) { applyText(node, it); node.ck = ck; measured = true; }
  if (it.t === 'note' && measured) fitNote(node, it);
  node.it = it;
  return measured;
}
function applyText(node, it) {
  if (!node.tx) return;
  node.tx.style.cssText = textStyle(it) + (it.t === 'text' ? `;font-size:${it.fs || DEF.text.fs}px;color:${col(it.col)}` : it.t === 'shape' ? `;font-size:${it.fs || 18}px;color:${col(it.col, it.fill === 'none' ? 'var(--cv-ink)' : '#fff')}` : '');
  if (it.t === 'note') node.el.style.setProperty('--nc', noteColor(it.c));
}
function build(node, it) {
  const el = node.el;
  node.tx = null;
  switch (it.t) {
    case 'note':
      el.style.setProperty('--nc', noteColor(it.c));
      el.innerHTML = `<div class="cv-tx" dir="auto">${esc(it.tx || '')}</div>`;
      break;
    case 'text':
      el.innerHTML = `<div class="cv-tx" dir="auto">${esc(it.tx || '')}</div>`;
      break;
    case 'shape': {
      const { d, eo } = shapePath(it), sw = it.sw ?? 2, stroke = it.st && it.st !== 'none' && sw > 0;
      el.innerHTML = `<svg width="${it.w}" height="${it.h}" overflow="visible"><path class="cv-sp" d="${d}" fill="${it.fill === 'none' ? 'none' : col(it.fill, DEF.shape.fill)}" ${eo ? 'fill-rule="evenodd"' : ''} ${stroke ? `stroke="${col(it.st)}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" ${dash(it.ds, sw)}` : ''} fill-opacity="${it.op ?? 1}" stroke-opacity="${it.op ?? 1}"/></svg><div class="cv-tx" dir="auto">${esc(it.tx || '')}</div>`;
      break;
    }
    case 'img':
      el.innerHTML = '<img alt="" draggable="false">';
      el.style.opacity = it.op ?? 1;
      el.style.borderRadius = (it.rad || 0) + 'px';
      blobUrl(it.b).then((u) => {
        const img = el.querySelector('img');
        if (!img) return;
        if (u) img.src = u;
        else el.classList.add('missing');
      }).catch(() => el.classList.add('missing'));
      break;
    case 'link':
      el.innerHTML = `<span class="cv-lk-ic"><img alt="" draggable="false" src="${esc(faviconUrl(it.u, 64))}"></span><span class="cv-lk-t"><b dir="auto">${esc(it.tx || hostOf(it.u) || it.u)}</b><small>${icon('link', 13)}<bdi dir="ltr">${esc(shortUrl(it.u))}</bdi></small></span>`;
      break;
    case 'ink': {
      const { d, fill } = inkPath(it), c = col(it.col), T = TOOLS[it.tool] || TOOLS.pen;
      el.style.opacity = (it.op ?? 1) * inkAlpha(it);
      el.innerHTML = fill ? `<path d="${d}" fill="${c}" ${T.grain ? 'filter="url(#cv-grain)"' : ''}/>`
        : `<path d="${d}" fill="none" stroke="${c}" stroke-width="${it.sz}" stroke-linecap="${it.tool === 'hl' ? 'butt' : 'round'}" stroke-linejoin="round"/>`;
      el.classList.toggle('hl', it.tool === 'hl');
      break;
    }
  }
  node.tx = el.querySelector('.cv-tx');
  applyText(node, it);
}
/** Sticky-note text shrinks until it fits (the size grows with the note). */
export function fitNote(node, it) {
  const tx = node.tx;
  if (!tx) return;
  const pad = Math.min(it.w, it.h) * 0.09, avail = it.h - pad * 2, max = ((it.fs || DEF.note.fs) * Math.min(it.w, it.h)) / 200;
  tx.style.setProperty('--pad', pad + 'px');
  const fits = (fs) => { tx.style.fontSize = fs + 'px'; return tx.offsetHeight <= avail + 0.5 && tx.scrollWidth <= it.w - pad * 2 + 1; };
  let lo = 6, hi = Math.max(6, max);
  if (!fits(hi)) {
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    fits(lo); node.fs = lo;
  } else node.fs = hi;
}
