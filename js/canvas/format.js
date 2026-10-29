// The selection toolbar that floats over what you picked on a board, and its One UI popovers: colours, text style,
// line and border style, connector type, arrows, image opacity, sticky-note colours. Also the shape and line
// pickers of the insert tools and the Add link dialog.
import { h, $, $$, escapeHtml as esc, clamp, toUrl } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog, slider } from '../core/ui.js';
import { NOTE_COLORS, noteColor, FONTS, DEF } from './model.js';
import { LIBRARY, LINES, previewSVG } from './shapes.js';
import { fontCss } from './export.js';

// ---------------------------------------------------------------- popovers
/** A One UI popover next to `anchor` (an element or { x, y }), kept on screen; a tap outside or Escape closes it. */
export function popover(anchor, node, { cls = '', onClose, title } = {}) {
  closePops();
  const scrim = h('div', { class: 'cv-pop-scrim' });
  const pop = h('div', { class: ['cv-pop', cls], role: 'dialog', 'aria-label': title || null }, title ? h('div', { class: 'cv-ph' }, title) : null, node);
  const layer = document.getElementById('overlay-layer') || document.body;
  layer.append(scrim, pop);
  const place = () => {
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 10;
    let x = r.left + r.width / 2 - pw / 2, y = r.bottom + gap;
    if (y + ph > innerHeight - 8 && r.top - gap - ph > 8) y = r.top - gap - ph;
    x = clamp(x, 8, Math.max(8, innerWidth - pw - 8)); y = clamp(y, 8, Math.max(8, innerHeight - ph - 8));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
  };
  place();
  requestAnimationFrame(() => pop.classList.add('show'));
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    scrim.remove(); pop.remove();
    onClose?.();
  }
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  scrim.addEventListener('wheel', () => close(), { passive: true });
  pop._close = close;
  return { el: pop, close, place };
}
export function closePops() { $$('.cv-pop').forEach((p) => p._close?.()); }
export const popOpen = () => !!document.querySelector('.cv-pop');

// ---------------------------------------------------------------- colours
export const QUICK = ['auto', '#ffffff', '#8e8e93', '#ef3e36', '#ff8a00', '#ffc400', '#38b34a', '#00b2a9', '#1f8bff', '#5b4dff', '#b24ce0', '#ff5fa2'];
export const css = (c) => (!c || c === 'auto' ? 'var(--cv-ink)' : c === 'none' ? 'transparent' : c);
const same = (a, b) => String(a || 'auto').toLowerCase() === String(b || 'auto').toLowerCase();
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
function swatchRow(colors, cur, { none, custom = true } = {}) {
  const sw = (c, label) => `<button class="cv-sw ${c === 'auto' ? 'auto' : ''} ${c === 'none' ? 'none' : ''} ${same(c, cur) ? 'on' : ''}" data-c="${c}" style="--c:${css(c)}" title="${esc(label || '')}" aria-label="${esc(label || c)}"></button>`;
  const known = colors.some((c) => same(c, cur)) || cur === 'none';
  return `<div class="cv-sws">${none ? sw('none', t('canvas.noFill')) : ''}${colors.map((c) => sw(c, c === 'auto' ? t('canvas.colorAuto') : '')).join('')}${custom ? `<label class="cv-sw custom ${!known && isHex(cur) ? 'on' : ''}" title="${esc(t('canvas.customColor'))}" style="${!known && isHex(cur) ? `--c:${cur}` : ''}"><input type="color" value="${isHex(cur) ? cur : '#1f8bff'}" aria-label="${esc(t('canvas.customColor'))}"></label>` : ''}</div>`;
}
function bindSwatches(node, onPick) {
  const mark = (c) => {
    $$('.cv-sw[data-c]', node).forEach((b) => b.classList.toggle('on', same(b.dataset.c, c)));
    const cu = $('.cv-sw.custom', node);
    if (cu) { const custom = !$$('.cv-sw[data-c]', node).some((b) => same(b.dataset.c, c)); cu.classList.toggle('on', custom); if (custom) cu.style.setProperty('--c', c); }
  };
  node.addEventListener('click', (e) => { const b = e.target.closest('.cv-sw[data-c]'); if (!b) return; mark(b.dataset.c); onPick(b.dataset.c); });
  $('input[type=color]', node)?.addEventListener('input', (e) => { mark(e.target.value); onPick(e.target.value); });
}
/** A labelled One UI slider row. */
export function sliderRow(label, { min, max, step = 1, value, fmt = (v) => String(v), onInput }) {
  const out = h('b', null, fmt(value));
  const s = slider({ min, max, step, value, label, onInput: (v) => { out.textContent = fmt(v); onInput(v); } });
  return h('div', { class: 'cv-srow' }, h('div', { class: 'cv-srow-head' }, h('span', null, label), out), s);
}
/** Samsung's colour swatches and a custom colour, for any popover. */
export function swatchPicker(colors, cur, onPick, { none = false } = {}) {
  const node = h('div', { class: 'cv-cp', html: swatchRow(colors, cur, { none }) });
  bindSwatches(node, onPick);
  return node;
}
/** The colour popover: the swatches and (optionally) an opacity slider. */
export function colorPop(anchor, cur, onPick, { none = false, colors = QUICK, opacity, onOpacity, title = t('canvas.color'), extra } = {}) {
  const node = swatchPicker(colors, cur, onPick, { none });
  if (onOpacity) node.append(sliderRow(t('canvas.opacity'), { min: 5, max: 100, value: Math.round((opacity ?? 1) * 100), fmt: (v) => `${v}%`, onInput: (v) => onOpacity(v / 100) }));
  if (extra) node.append(extra);
  return popover(anchor, node, { cls: 'cv-pop-color', title });
}

// ---------------------------------------------------------------- the selection toolbar
const dot = (c) => `<i class="cv-dot" style="--c:${c}"></i>`;
const colorOfItem = (it) => (it.t === 'note' ? noteColor(it.c) : it.t === 'shape' ? css(it.fill === 'none' ? 'none' : it.fill || DEF.shape.fill) : it.t === 'line' ? css(it.st) : css(it.col));
/** The buttons for the selected items. */
export function formatBar(ed, its) {
  const one = its.length === 1 ? its[0] : null, locked = its.every((i) => i.lk);
  const b = (f, html, label) => `<button data-f="${f}" title="${esc(label)}" aria-label="${esc(label)}">${html}</button>`;
  const ic = (n) => icon(n, 22);
  let s = '';
  if (locked) s = b('unlock', `${ic('unlock')}<span>${esc(t('canvas.unlock'))}</span>`, t('canvas.unlock'));
  else if (one?.t === 'note') s = b('notec', dot(noteColor(one.c)), t('canvas.color')) + b('text', ic('cv-textstyle'), t('canvas.textStyle'));
  else if (one?.t === 'text') s = b('text', ic('cv-textstyle'), t('canvas.textStyle')) + b('col', dot(css(one.col)), t('canvas.textColor'));
  else if (one?.t === 'shape') s = b('fill', dot(colorOfItem(one)), t('canvas.fill')) + b('stroke', ic('cv-linew'), t('canvas.border')) + (['rect', 'poly', 'star'].includes(one.k) ? b('geom', ic('cv-geom'), t('canvas.shape')) : '') + b('text', ic('cv-textstyle'), t('canvas.textStyle'));
  else if (one?.t === 'line') s = b('stroke', dot(css(one.st)), t('canvas.lineStyle')) + b('kind', ic('cv-line-' + (one.k || 's')), t('canvas.connType')) + b('heads', ic(one.ha && !one.hb ? 'cv-head-a' : 'cv-head-b'), t('canvas.arrows'));
  else if (one?.t === 'img') s = b('imgopt', ic('cv-opacity'), t('canvas.imageStyle')) + b('replace', ic('cv-swap'), t('canvas.replace'));
  else if (one?.t === 'link') s = b('editlink', ic('edit'), t('canvas.editLink')) + b('open', ic('external'), t('canvas.openLink'));
  else if (one?.t === 'ink') s = b('inkc', dot(css(one.col)), t('canvas.penStyle'));
  else if (its.length > 1) s = b('multic', dot(colorOfItem(its.find((i) => !i.lk) || its[0])), t('canvas.color')) + b('align', ic('cv-align'), t('canvas.align'));
  if (!locked) s += b('dup', ic('copy'), t('canvas.duplicate')) + b('del', ic('trash'), t('common.delete'));
  s += b('more', ic('more'), t('common.more'));
  const bar = h('div', { class: 'cv-fbar', role: 'toolbar', 'aria-label': t('canvas.format'), html: s });
  // buttons don't take the focus, so text being typed keeps its caret while you format it
  bar.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-f]');
    if (btn) act(ed, btn.dataset.f, btn, one, its);
  });
  return bar;
}

function act(ed, f, anchor, one, its) {
  const tag = f + ':' + its.map((i) => i.id).join();
  switch (f) {
    case 'more': return ed.selMenu(anchor);
    case 'dup': return ed.duplicate();
    case 'del': return ed.del();
    case 'align': return ed.alignMenu(anchor);
    case 'unlock': return ed.setLock(false);
    case 'notec': return notePop(ed, anchor, one);
    case 'text': return textPop(ed, anchor, one || its[0]);
    case 'col': return colorPop(anchor, one.col, (c) => ed.patchSel({ col: c === 'auto' ? undefined : c }, tag), { title: t('canvas.textColor') });
    case 'fill': return colorPop(anchor, one.fill || DEF.shape.fill, (c) => { ed.patchSel({ fill: c }, tag); if (c !== 'none') ed.pref('shapeFill', c); }, { none: true, opacity: one.op, onOpacity: (v) => ed.patchSel({ op: v }, tag + 'op'), title: t('canvas.fill') });
    case 'stroke': return strokePop(ed, anchor, one, tag);
    case 'geom': return geomPop(ed, anchor, one, tag);
    case 'kind': return kindPop(ed, anchor, one, tag);
    case 'heads': return headsPop(ed, anchor, one, tag);
    case 'imgopt': return imgPop(ed, anchor, one, tag);
    case 'replace': return ed.replaceImage(one.id);
    case 'editlink': return ed.editLink(one);
    case 'open': return ed.openLink(one);
    case 'inkc': return colorPop(anchor, one.col, (c) => ed.patchSel({ col: c }, tag), { title: t('canvas.penStyle'), extra: sliderRow(t('canvas.thickness'), { min: 1, max: 48, step: 0.5, value: one.sz, fmt: (v) => String(v), onInput: (v) => ed.patchSel({ sz: v }, tag + 'sz') }) });
    case 'multic': return colorPop(anchor, '', (c) => ed.patchSel((i) => (i.t === 'note' ? { c } : i.t === 'shape' ? { fill: c } : i.t === 'line' ? { st: c } : i.t === 'img' || i.t === 'link' ? {} : { col: c }), tag));
  }
}

const NOTE_NAMES = () => ({ yellow: t('canvas.c.yellow'), orange: t('canvas.c.orange'), pink: t('canvas.c.pink'), purple: t('canvas.c.purple'), blue: t('canvas.c.blue'), green: t('canvas.c.green'), gray: t('canvas.c.gray') });
function notePop(ed, anchor, it) {
  const names = NOTE_NAMES();
  const node = h('div', { class: 'cv-sws cv-nsws', html: Object.entries(NOTE_COLORS).map(([k, c]) => `<button class="cv-sw note ${it.c === k || (!it.c && k === 'yellow') ? 'on' : ''}" data-k="${k}" style="--c:${c}" title="${esc(names[k])}" aria-label="${esc(names[k])}"></button>`).join('') });
  node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    $$('.cv-sw', node).forEach((x) => x.classList.toggle('on', x === b));
    ed.patchSel({ c: b.dataset.k === 'yellow' ? undefined : b.dataset.k }, 'notec');
    ed.pref('noteC', b.dataset.k);
  });
  popover(anchor, node, { title: t('canvas.noteColor') });
}

// text boxes start where their language starts (none = natural); sticky notes and shapes are centred unless set
const ALIGN = (type) => (type === 'text'
  ? [['', 'cv-al-l', t('canvas.alignStart')], ['c', 'cv-al-c', t('canvas.alignCenter')], ['r', 'cv-al-r', t('canvas.alignEnd')], ['j', 'cv-al-j', t('canvas.justify')]]
  : [['l', 'cv-al-l', t('canvas.alignStart')], ['', 'cv-al-c', t('canvas.alignCenter')], ['r', 'cv-al-r', t('canvas.alignEnd')], ['j', 'cv-al-j', t('canvas.justify')]]);
const FONT_NAMES = () => ({ sys: t('canvas.font.sys'), disp: t('canvas.font.disp'), ser: t('canvas.font.ser'), mono: t('canvas.font.mono') });
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 120, 144];
function textPop(ed, anchor, it) {
  let cur = { ...it };
  const fsDef = it.t === 'note' ? DEF.note.fs : it.t === 'text' ? DEF.text.fs : 18;
  const node = h('div', { class: 'cv-ts' });
  const draw = () => {
    const fs = cur.fs || fsDef, al = cur.al || '';
    node.innerHTML = `<div class="cv-ts-fonts">${FONTS.map((k) => `<button data-font="${k}" class="${(cur.font || 'sys') === k ? 'on' : ''}" style="font-family:${esc(fontCss(k))}"><b>Aa</b><span>${esc(FONT_NAMES()[k])}</span></button>`).join('')}</div>
      <div class="cv-ts-row">${[['b', 'B', t('canvas.bold')], ['i', 'I', t('canvas.italic')], ['u', 'U', t('canvas.underline')], ['s', 'S', t('canvas.strike')]].map(([k, l, n]) => `<button data-st="${k}" class="${cur[k] ? 'on' : ''} st-${k}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${!!cur[k]}">${l}</button>`).join('')}</div>
      <div class="cv-ts-size"><span>${esc(t('canvas.fontSize'))}</span><button data-fs="-1" aria-label="${esc(t('canvas.smaller'))}">${icon('minus', 18)}</button><b>${Math.round(fs)}</b><button data-fs="1" aria-label="${esc(t('canvas.bigger'))}">${icon('plus', 18)}</button></div>
      <div class="cv-ts-row">${ALIGN(it.t).map(([k, ic, n]) => `<button data-al="${k}" class="${al === k ? 'on' : ''}" title="${esc(n)}" aria-label="${esc(n)}">${icon(ic, 20)}</button>`).join('')}</div>`;
  };
  const apply = (p, tag) => { cur = { ...cur, ...p }; ed.patchSel(p, tag); draw(); };
  node.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.font) apply({ font: b.dataset.font === 'sys' ? undefined : b.dataset.font });
    else if (b.dataset.st) apply({ [b.dataset.st]: !cur[b.dataset.st] || undefined });
    else if (b.dataset.fs) {
      const fs = cur.fs || fsDef;
      const next = +b.dataset.fs > 0 ? SIZES.find((s) => s > fs + 0.1) || fs : [...SIZES].reverse().find((s) => s < fs - 0.1) || fs;
      apply({ fs: next }, 'fs');
    } else if ('al' in b.dataset) apply({ al: b.dataset.al || undefined });
  });
  draw();
  popover(anchor, node, { title: t('canvas.textStyle'), cls: 'cv-pop-text' });
}

function dashRow(cur, onPick) {
  const seg = h('div', { class: 'cv-seg', html: [[0, t('canvas.solid')], [1, t('canvas.dashed')], [2, t('canvas.dotted')]].map(([k, n]) => `<button data-ds="${k}" class="${cur === k ? 'on' : ''}" title="${esc(n)}" aria-label="${esc(n)}"><svg viewBox="0 0 40 8" width="40" height="8"><path d="M3 4h34" stroke="currentColor" stroke-width="3" stroke-linecap="round" ${k === 1 ? 'stroke-dasharray="7 5"' : k === 2 ? 'stroke-dasharray=".1 6"' : ''}/></svg></button>`).join('') });
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ds]');
    if (!b) return;
    $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
    onPick(+b.dataset.ds);
  });
  return seg;
}
function strokePop(ed, anchor, it, tag) {
  const line = it.t === 'line';
  const cur = { st: it.st || (line ? 'auto' : 'none'), sw: it.sw ?? (line ? DEF.line.sw : 2), ds: it.ds || 0 };
  const node = h('div', { class: 'cv-cp', html: swatchRow(QUICK, cur.st, { none: !line }) });
  bindSwatches(node, (c) => {
    cur.st = c;
    ed.patchSel({ st: c === 'auto' && line ? undefined : c, ...(!line && c !== 'none' && !it.sw ? { sw: cur.sw || 2 } : {}) }, tag + 'st');
  });
  node.append(
    sliderRow(t('canvas.thickness'), { min: line ? 1 : 0, max: 20, step: 0.5, value: cur.sw, onInput: (v) => {
      cur.sw = v;
      const addLine = !line && cur.st === 'none' && v > 0;
      if (addLine) cur.st = 'auto';
      ed.patchSel({ sw: v, ...(addLine ? { st: 'auto' } : {}) }, tag + 'sw');
    } }),
    dashRow(cur.ds, (ds) => ed.patchSel({ ds: ds || undefined }, tag + 'ds')));
  popover(anchor, node, { title: line ? t('canvas.lineStyle') : t('canvas.border'), cls: 'cv-pop-color' });
}
function listPop(anchor, rows, cur, onPick, title) {
  const node = h('div', { class: 'cv-list', html: rows.map(([k, ic, n]) => `<button data-k="${k}" class="${cur === k ? 'on' : ''}">${ic}<span>${esc(n)}</span>${cur === k ? icon('check', 20) : ''}</button>`).join('') });
  const p = popover(anchor, node, { title });
  node.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { onPick(b.dataset.k); p.close(); } });
}
function kindPop(ed, anchor, it, tag) {
  listPop(anchor, [['s', icon('cv-line-s', 22), t('canvas.straight')], ['c', icon('cv-line-c', 22), t('canvas.curved')], ['e', icon('cv-line-e', 22), t('canvas.elbow')]], it.k || 's', (k) => {
    ed.patchSel({ k: k === 's' ? undefined : k, m: undefined }, tag);
    ed.pref('connK', k);
  }, t('canvas.connType'));
}
function headsPop(ed, anchor, it, tag) {
  const pic = (k) => `<svg viewBox="0 0 40 16" class="cv-heads" width="40" height="16"><path d="M${k.includes('a') ? 10 : 4} 8H${k.includes('b') ? 30 : 36}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>${k.includes('b') ? '<path d="M37 8l-8-5v10z" fill="currentColor"/>' : ''}${k.includes('a') ? '<path d="M3 8l8-5v10z" fill="currentColor"/>' : ''}</svg>`;
  const cur = (it.ha ? 'a' : '') + (it.hb ? 'b' : '') || '-';
  listPop(anchor, [['-', pic(''), t('common.none')], ['b', pic('b'), t('canvas.arrowEnd')], ['a', pic('a'), t('canvas.arrowStart')], ['ab', pic('ab'), t('canvas.arrowBoth')]], cur, (k) => {
    ed.patchSel({ ha: k.includes('a') || undefined, hb: k.includes('b') || undefined }, tag);
  }, t('canvas.arrows'));
}
function geomPop(ed, anchor, it, tag) {
  const rect = it.k === 'rect', star = it.k === 'star';
  const max = rect ? Math.max(1, Math.round(Math.min(it.w, it.h) / 2)) : star ? 30 : 16, min = rect ? 0 : 3;
  const val = rect ? Math.round(it.rad || 0) : it.n || 5;
  const label = rect ? t('canvas.cornerRadius') : star ? t('canvas.points') : t('canvas.sides');
  popover(anchor, h('div', { class: 'cv-cp' }, sliderRow(label, { min, max, value: val, onInput: (v) => ed.patchSel(rect ? { rad: v || undefined } : { n: v }, tag) })), { title: t('canvas.shape'), cls: 'cv-pop-color' });
}
function imgPop(ed, anchor, it, tag) {
  popover(anchor, h('div', { class: 'cv-cp' },
    sliderRow(t('canvas.opacity'), { min: 5, max: 100, value: Math.round((it.op ?? 1) * 100), fmt: (v) => `${v}%`, onInput: (v) => ed.patchSel({ op: v / 100 }, tag + 'op') }),
    sliderRow(t('canvas.cornerRadius'), { min: 0, max: Math.max(1, Math.round(Math.min(it.w, it.h) / 2)), value: Math.round(it.rad || 0), onInput: (v) => ed.patchSel({ rad: v || undefined }, tag + 'rad') })), { title: t('canvas.imageStyle'), cls: 'cv-pop-color' });
}

// ---------------------------------------------------------------- shape and line pickers
const fold = (s) => String(s || '').toLocaleLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '');
/** Shapes: tabs for the categories and a search over the shape names. */
export function shapePicker(anchor, onPick, { cat: cat0 = 'basic', onCat } = {}) {
  let cat = LIBRARY.some((c) => c.id === cat0) ? cat0 : 'basic', q = '';
  const input = h('input', { type: 'search', placeholder: t('canvas.searchShapes'), 'aria-label': t('canvas.searchShapes'), spellcheck: 'false' });
  const tabs = h('div', { class: 'cv-lib-tabs', role: 'tablist', html: LIBRARY.map((c) => `<button role="tab" data-cat="${c.id}">${esc(t(c.name))}</button>`).join('') });
  const grid = h('div', { class: 'cv-lib-grid', role: 'listbox' });
  const node = h('div', { class: 'cv-lib' }, h('label', { class: 'ou-searchbox cv-lib-q' }, h('span', { html: icon('search', 18) }), input), tabs, grid);
  const draw = () => {
    $$('[data-cat]', tabs).forEach((b) => { b.classList.toggle('on', !q && b.dataset.cat === cat); b.setAttribute('aria-selected', String(!q && b.dataset.cat === cat)); });
    const fq = fold(q);
    const list = q ? LIBRARY.flatMap((c) => c.items).filter((e) => fold(t(e.name)).includes(fq) || e.id.includes(fq)) : LIBRARY.find((c) => c.id === cat).items;
    grid.innerHTML = list.map((e) => `<button data-id="${e.id}" title="${esc(t(e.name))}" aria-label="${esc(t(e.name))}" role="option">${previewSVG(e)}</button>`).join('') || `<div class="cv-lib-none">${esc(t('canvas.noResults'))}</div>`;
  };
  draw();
  const p = popover(anchor, node, { cls: 'cv-pop-lib', title: t('canvas.shapes') });
  setTimeout(() => input.focus({ preventScroll: true }), 30);
  input.addEventListener('input', () => { q = input.value.trim(); draw(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('[data-id]', grid)?.click(); });
  node.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat]');
    if (tab) { cat = tab.dataset.cat; onCat?.(cat); q = ''; input.value = ''; draw(); return; }
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const entry = LIBRARY.flatMap((c) => c.items).find((x) => x.id === b.dataset.id);
    p.close();
    if (entry) onPick(entry);
  });
}
/** Lines and connectors: straight, arrow, double arrow, curve, elbow. */
export function linePicker(anchor, onPick) {
  const node = h('div', { class: 'cv-lib-grid lines', html: LINES.map((e) => `<button data-id="${e.id}" title="${esc(t(e.name))}" aria-label="${esc(t(e.name))}">${previewSVG(e)}<span>${esc(t(e.name))}</span></button>`).join('') });
  const p = popover(anchor, node, { cls: 'cv-pop-lines', title: t('canvas.lines') });
  node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    p.close();
    onPick(LINES.find((x) => x.id === b.dataset.id));
  });
}

// ---------------------------------------------------------------- links
/** Add link / Edit link: the address and a title you choose (nothing is downloaded from the site). */
export async function linkDialog(it) {
  const u = h('input', { class: 'ou-input', type: 'url', placeholder: t('canvas.linkUrl'), 'aria-label': t('canvas.linkUrl'), value: it?.u || '', spellcheck: 'false', autocomplete: 'off', dir: 'ltr' });
  const ti = h('input', { class: 'ou-input', type: 'text', placeholder: t('canvas.linkTitle'), 'aria-label': t('canvas.linkTitle'), value: it?.tx || '', dir: 'auto' });
  u.addEventListener('input', () => u.classList.remove('bad'));
  const res = await dialog({
    title: it ? t('canvas.editLink') : t('canvas.addLink'),
    className: 'cv-link-dlg',
    content: h('div', { class: 'ou-dialog-body' }, u, ti, h('p', { class: 'cv-hint' }, t('canvas.linkHint'))),
    actions: [
      { label: t('common.cancel'), value: null },
      { label: it ? t('common.done') : t('common.add'), primary: true, value: () => ({ u: toUrl(u.value), tx: ti.value.trim() }), validate: () => { const ok = !!toUrl(u.value); if (!ok) { u.classList.add('bad'); u.focus(); } return ok; } },
    ],
  });
  return res?.u ? res : null;
}
