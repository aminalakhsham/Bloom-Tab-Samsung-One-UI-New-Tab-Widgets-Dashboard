// A Canvas board: the endless canvas (pan, pinch and zoom), the items on it, selecting and editing them (move with
// alignment guides or the grid, resize, rotate, connectors that stay attached, text typed in place), Samsung
// Notes' pen toolbar (pen, highlighter, eraser, lasso) and insert tools, undo and redo, the clipboard, scenes and
// export. The whole board is one transformed layer; each frame only touches the items whose object changed (items
// are never edited in place, so a changed item is a new object).
import { store } from '../core/store.js';
import { putBlob } from '../core/blobs.js';
import { h, $, $$, escapeHtml as esc, clamp, debounce, pickFile, toUrl, download } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, closeMenus, toast, prompt, confirm, iconBtn } from '../core/ui.js';
import { currentApp } from '../core/apps.js';
import { isLocked } from '../shell/lock.js';
import * as M from './model.js';
import * as BD from './boards.js';
import { makeNode, paint, fitNote } from './render.js';
import { makeInk, eraseSplit, hitInk, inkPath, worldPoints, recognize, TOOLS, PENS, INK_COLORS, HL_COLORS } from './ink.js';
import { renderItems, toBlob, pdfBlob, printCanvas, makeThumbs } from './export.js';
import { formatBar, shapePicker, linePicker, linkDialog, swatchPicker, closePops, popover, popOpen, sliderRow } from './format.js';
import { scenesPop } from './scenes.js';

const ZMIN = 0.1, ZMAX = 4;
const HANDLES = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
const KEEP_ASPECT = new Set(['img', 'note', 'link', 'ink']);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const reduceMotion = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Drops the menu entries that don't apply and the dividers they leave doubled or at either end. */
const tidy = (items) => items.filter(Boolean).filter((x, i, a) => x !== '-' || (i > 0 && i < a.length - 1 && a[i + 1] !== '-'));
const fileName = (s) => (s || 'Canvas').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'Canvas';
const pt = (e) => ({ clientX: e.clientX, clientY: e.clientY });

export const prefs = () => ({ sort: 'at', layout: 'grid', ink: {}, ...(store.get('canvasPrefs') || {}) });
export const setPref = (k, v) => store.set('canvasPrefs', { ...prefs(), [k]: v });
const inkDefaults = () => ({ pen: 'pen', col: { pen: 'auto', hl: HL_COLORS[0] }, sz: {}, erase: 'area', er: 14, auto: false });

/** A picture for the board: photos are shrunk, GIFs keep their animation, and what createImageBitmap can't open
 *  (SVG) is drawn through an <img> into a PNG, so exports and previews can always draw it. Returns { blob, w, h }. */
async function loadImage(f) {
  if (/gif/.test(f.type)) { const b = await createImageBitmap(f); return { blob: f, w: b.width, h: b.height }; }
  try {
    const b = await createImageBitmap(f), s = Math.min(1, 2400 / Math.max(b.width, b.height));
    if (s === 1 && f.size < 2.5e6) return { blob: f, w: b.width, h: b.height };
    const c = new OffscreenCanvas(Math.max(1, Math.round(b.width * s)), Math.max(1, Math.round(b.height * s)));
    c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
    return { blob: await c.convertToBlob({ type: /png|webp/.test(f.type) ? f.type : 'image/jpeg', quality: 0.9 }), w: b.width, h: b.height };
  } catch {
    const u = URL.createObjectURL(f);
    try {
      const img = new Image(); img.src = u; await img.decode();
      const w = img.naturalWidth || 300, h0 = img.naturalHeight || 300, s = Math.min(4, 2400 / Math.max(w, h0)); // small drawings stay sharp
      const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h0 * s)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return { blob: await c.convertToBlob({ type: 'image/png' }), w, h: h0 };
    } finally { URL.revokeObjectURL(u); }
  }
}

let current = null;
/** For tests and other surfaces: the open board's live state (JSON). */
export const state = () => (current ? JSON.parse(JSON.stringify(current.state)) : null);
/** For tests: the screen point of a board point in the open board. */
export const screenPoint = (wx, wy) => current?.screen(wx, wy) || null;

/** Opens board `boardId` inside `host` (the pushed page's body). Returns { close(), flush(), id, state }. */
export function openBoard(host, boardId, { page, onBack } = {}) {
  let rec = BD.byId(boardId);
  if (!rec) return null;
  let items = M.normBoards([rec])[0].items, scenes = rec.scenes || [];
  let byId = new Map(), sel = new Set(), nodes = new Map();
  let view = { x: 0, y: 0, z: 1 }, mode = 'select', editing = null, drag = null, space = false, guides = [], marquee = null, lasso = null, eraser = null, hover = null;
  let undo = [], redo = [], lastTag = '', lastAt = 0, dirty = false, savedAt = rec.at, closed = false, leaving = false, curScene = -1;
  const ink = { ...inkDefaults(), ...prefs().ink };
  ink.col = { ...inkDefaults().col, ...(prefs().ink?.col || {}) };
  ink.sz = { ...(prefs().ink?.sz || {}) };
  let tool = 'pen'; // the pen in hand while drawing: a pen type, 'hl' or 'eraser'
  const ptrs = new Map();

  host.innerHTML = `<div class="cv-board" data-mode="select">
    <div class="cv-view" tabindex="0" aria-label="${esc(rec.name || t('canvas.untitled'))}">
      <div class="cv-world"><svg class="cv-defs" width="0" height="0" aria-hidden="true"><filter id="cv-grain" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.7" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter></svg></div>
      <div class="cv-ov"><div class="cv-sel"></div><div class="cv-fmt" hidden></div></div>
    </div>
    <div class="cv-tools" role="toolbar" aria-label="${esc(t('canvas.tools'))}">
      <button data-tool="select" title="${esc(t('canvas.select'))} (V)" aria-label="${esc(t('canvas.select'))}">${icon('cv-select', 22)}</button>
      <button data-tool="pen" title="${esc(t('canvas.pen'))} (P)" aria-label="${esc(t('canvas.pen'))}">${icon('cv-pen', 22)}<i class="cv-tdot"></i></button>
      <button data-tool="hl" title="${esc(t('canvas.highlighter'))} (H)" aria-label="${esc(t('canvas.highlighter'))}">${icon('cv-hl', 22)}<i class="cv-tdot"></i></button>
      <button data-tool="eraser" title="${esc(t('canvas.eraser'))} (E)" aria-label="${esc(t('canvas.eraser'))}">${icon('cv-eraser', 22)}</button>
      <button data-tool="lasso" title="${esc(t('canvas.lasso'))} (L)" aria-label="${esc(t('canvas.lasso'))}">${icon('cv-lasso', 22)}</button>
      <span class="cv-tsep"></span>
      <span class="cv-ins">
        <button data-a="text" title="${esc(t('canvas.textBox'))} (T)" aria-label="${esc(t('canvas.textBox'))}">${icon('cv-text', 22)}</button>
        <button data-a="note" title="${esc(t('canvas.stickyNote'))} (N)" aria-label="${esc(t('canvas.stickyNote'))}">${icon('cv-sticky', 22)}</button>
        <button data-a="shape" title="${esc(t('canvas.shapes'))} (S)" aria-label="${esc(t('canvas.shapes'))}">${icon('cv-shapes', 22)}</button>
        <button data-a="line" title="${esc(t('canvas.lines'))} (C)" aria-label="${esc(t('canvas.lines'))}">${icon('cv-line', 22)}</button>
        <button data-a="photo" title="${esc(t('canvas.image'))} (I)" aria-label="${esc(t('canvas.image'))}">${icon('image', 22)}</button>
        <button data-a="link" title="${esc(t('canvas.link'))} (K)" aria-label="${esc(t('canvas.link'))}">${icon('link', 22)}</button>
      </span>
      <button class="cv-ins-btn" data-a="insert" title="${esc(t('canvas.insert'))}" aria-label="${esc(t('canvas.insert'))}">${icon('cv-insert', 22)}</button>
    </div>
    <div class="cv-pill cv-zoom">
      <button data-a="zout" title="${esc(t('canvas.zoomOut'))}" aria-label="${esc(t('canvas.zoomOut'))}">${icon('minus', 18)}</button>
      <button class="cv-zpct" data-a="zoom" title="${esc(t('canvas.zoom'))}" aria-haspopup="menu"></button>
      <button data-a="zin" title="${esc(t('canvas.zoomIn'))}" aria-label="${esc(t('canvas.zoomIn'))}">${icon('plus', 18)}</button>
      <button data-a="fit" title="${esc(t('canvas.zoomFit'))} (1)" aria-label="${esc(t('canvas.zoomFit'))}">${icon('cv-fit', 18)}</button>
    </div>
    <div class="cv-pill cv-scn">
      <button data-a="scenes" title="${esc(t('canvas.scenes'))}" aria-label="${esc(t('canvas.scenes'))}">${icon('cv-scenes', 18)}<span class="cv-scn-label">${esc(t('canvas.scenes'))}</span></button>
      <span class="cv-scn-nav"><button data-a="prev" aria-label="${esc(t('canvas.prevScene'))}">${icon('back', 18)}</button><span class="cv-scn-name"></span><button data-a="next" aria-label="${esc(t('canvas.nextScene'))}">${icon('forward', 18)}</button></span>
    </div>
  </div>`;
  const root = $('.cv-board', host), viewEl = $('.cv-view', root), world = $('.cv-world', root), defs = $('.cv-defs', root);
  const selEl = $('.cv-sel', root), fmtEl = $('.cv-fmt', root), toolsEl = $('.cv-tools', root);

  // the app bar: undo, redo, save/share and more, and the board's name (tap to rename)
  const undoBtn = iconBtn('cv-undo', () => doUndo(), t('canvas.undo'));
  const redoBtn = iconBtn('cv-redo', () => doRedo(), t('canvas.redo'));
  const saveBtn = iconBtn('download', (e) => saveMenu(e.currentTarget), t('canvas.saveAs'));
  const moreBtn = iconBtn('more', (e) => moreMenu(e.currentTarget), t('common.more'));
  undoBtn.classList.add('cv-undo'); redoBtn.classList.add('cv-redo');
  [undoBtn, redoBtn, saveBtn, moreBtn].forEach((b) => b.addEventListener('pointerdown', (e) => { if (editing) e.preventDefault(); }));
  page?.setActions([undoBtn, redoBtn, saveBtn, moreBtn]);
  const titleEl = page?.el.querySelector('.app-toolbar-title');
  if (titleEl) {
    titleEl.classList.add('cv-title');
    titleEl.setAttribute('role', 'button');
    titleEl.tabIndex = 0;
    titleEl.title = t('canvas.rename');
    titleEl.addEventListener('click', rename);
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(); });
  }

  // ---------------------------------------------------------------- state changes
  const index = () => {
    byId = new Map(items.map((i) => [i.id, i]));
    for (const id of [...sel]) if (!byId.has(id)) sel.delete(id);
  };
  index();
  function setItems(next, mark = true) { items = next; index(); schedule(); if (mark) markDirty(); }
  /** Replaces items by id with new objects (map: id → patch object). */
  function patch(map, mark = true) {
    if (!map.size) return;
    setItems(items.map((it) => (map.has(it.id) ? M.clean({ ...it, ...map.get(it.id) }) : it)), mark);
  }
  function checkpoint(tag = '') {
    const now = Date.now();
    if (tag && tag === lastTag && now - lastAt < 1500) { lastAt = now; return; }
    lastTag = tag; lastAt = now;
    undo.push({ items, scenes });
    if (undo.length > 300) undo.shift();
    redo = [];
    syncBars();
  }
  function restore(s) {
    items = s.items; scenes = s.scenes; lastTag = '';
    index();
    for (const n of nodes.values()) if (n.it && !byId.has(n.it.id)) n.it = null;
    schedule(); markDirty(); syncBars();
  }
  function doUndo() { if (editing) stopEdit(); if (!undo.length) return; redo.push({ items, scenes }); restore(undo.pop()); }
  function doRedo() { if (editing) stopEdit(); if (!redo.length) return; undo.push({ items, scenes }); restore(redo.pop()); }

  // ---------------------------------------------------------------- saving
  const visibleRect = () => ({ x: -view.x / view.z, y: -view.y / view.z, w: viewEl.clientWidth / view.z, h: viewEl.clientHeight / view.z });
  function flush(withView = true) {
    const b = BD.byId(boardId);
    if (!b) return;
    const next = { ...b, scenes };
    if (dirty) { next.items = items; next.at = Date.now(); savedAt = next.at; dirty = false; }
    if (withView) {
      const v = visibleRect();
      if (v.w > 0) next.view = { x: M.r1(v.x), y: M.r1(v.y), w: M.r1(v.w), h: M.r1(v.h) };
    }
    BD.put(next);
  }
  const saveSoon = debounce(() => { if (!closed) flush(); }, 700);
  const saveViewSoon = debounce(() => { if (!closed && !dirty) flush(); }, 1500);
  let thumbBusy = false, thumbAgain = false;
  async function thumbs() {
    if (thumbBusy) { thumbAgain = true; return; }
    thumbBusy = true;
    try {
      // drawn when the page is idle, so a big board's previews never interrupt drawing or dragging
      if (!closed) await new Promise((r) => (globalThis.requestIdleCallback ? requestIdleCallback(r, { timeout: 3000 }) : setTimeout(r, 50)));
      const b = BD.byId(boardId);
      if (!b) return;
      const thumb = await makeThumbs({ ...b, items }, (id) => nodes.get(id)?.fs || 0);
      BD.update(boardId, () => ({ thumb }));
    } catch (e) { console.warn('canvas thumbs', e); } finally { thumbBusy = false; }
    if (thumbAgain) { thumbAgain = false; thumbs(); }
  }
  const thumbSoon = debounce(() => { if (!closed) thumbs(); }, 2500);
  function markDirty() { dirty = true; saveSoon(); thumbSoon(); }

  // ---------------------------------------------------------------- the view
  // The size comes from layout, not getBoundingClientRect: while the window zooms open it is scaled down, and a
  // board fitted at that moment would end up tiny in a corner.
  const vrect = () => { const b = viewEl.getBoundingClientRect(); return { left: b.left, top: b.top, width: viewEl.clientWidth, height: viewEl.clientHeight }; };
  const toW = (cx, cy, r = vrect()) => [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z];
  const toS = (wx, wy) => [wx * view.z + view.x, wy * view.z + view.y];
  function setView(v) { view = { x: v.x, y: v.y, z: clamp(v.z, ZMIN, ZMAX) }; schedule(); saveViewSoon(); }
  function zoomAt(sx, sy, z) {
    z = clamp(z, ZMIN, ZMAX);
    const wx = (sx - view.x) / view.z, wy = (sy - view.y) / view.z;
    setView({ x: sx - wx * z, y: sy - wy * z, z });
    curScene = -1;
  }
  const zoomCenter = (z) => { const r = vrect(); zoomAt(r.width / 2, r.height / 2, z); };
  /** The view that shows `R` inside the free part of the window (the toolbars float over the board). */
  function viewFor(R, maxZ = 1) {
    const r = vrect(), top = 76, bottom = 64, side = 40;
    const z = clamp(Math.min((r.width - side * 2) / Math.max(1, R.w), (r.height - top - bottom) / Math.max(1, R.h)), ZMIN, maxZ);
    return { z, x: r.width / 2 - (R.x + R.w / 2) * z, y: top + (r.height - top - bottom) / 2 - (R.y + R.h / 2) * z };
  }
  let anim = 0;
  function animateTo(target) {
    cancelAnimationFrame(anim);
    if (reduceMotion()) return setView(target);
    const r = vrect(), from = { ...view }, t0 = performance.now(), dur = 420;
    const c0 = [(r.width / 2 - from.x) / from.z, (r.height / 2 - from.y) / from.z], c1 = [(r.width / 2 - target.x) / target.z, (r.height / 2 - target.y) / target.z];
    const step = (now) => {
      const u = Math.min(1, (now - t0) / dur), e = 1 - (1 - u) ** 3;
      const z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * e), cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
      setView({ z, x: r.width / 2 - cx * z, y: r.height / 2 - cy * z });
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function zoomToFit(animate = true, maxZ = 2) {
    const R = M.contentBox(items, byId);
    const r = vrect();
    const target = R ? viewFor({ x: R.x - 20, y: R.y - 20, w: R.w + 40, h: R.h + 40 }, maxZ) : { x: r.width / 2, y: r.height / 2, z: 1 };
    curScene = -1;
    if (animate) animateTo(target); else setView(target);
  }
  function initialView() {
    const r = vrect();
    if (rec.view?.w > 0) {
      const z = clamp(Math.min(r.width / rec.view.w, r.height / rec.view.h), ZMIN, ZMAX);
      setView({ z, x: r.width / 2 - (rec.view.x + rec.view.w / 2) * z, y: r.height / 2 - (rec.view.y + rec.view.h / 2) * z });
    } else if (items.length) zoomToFit(false, 1);
    else setView({ x: r.width / 2, y: r.height / 2, z: 1 });
  }
  let lastSize = null;
  const ro = new ResizeObserver(() => {
    const r = vrect();
    if (!r.width) return;
    root.classList.toggle('narrow', r.width < 720);
    root.classList.toggle('tiny', r.width < 470);
    if (!lastSize) { lastSize = r; initialView(); return; }
    // keep what was in the middle in the middle when the window changes size
    view.x += (r.width - lastSize.width) / 2; view.y += (r.height - lastSize.height) / 2;
    lastSize = r; schedule();
  });
  ro.observe(viewEl);

  // ---------------------------------------------------------------- drawing frames
  let raf = 0;
  function schedule() { if (!raf && !closed) raf = requestAnimationFrame(frame); }
  // The board is a layer of its own, so panning and zooming only move a picture the compositor already has. A zoom
  // leaves that picture at the old scale, so when the zoom has settled the layer is dropped for two frames and made
  // again, which draws it sharp at the new scale.
  let shownT = '', shownPct = -1, rasterZ = 0;
  const sharpen = debounce(() => {
    if (closed || view.z === rasterZ) return;
    rasterZ = view.z; world.classList.add('flat');
    requestAnimationFrame(() => requestAnimationFrame(() => world.classList.remove('flat')));
  }, 320);
  function frame() {
    raf = 0;
    if (closed) return;
    const tf = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
    if (tf !== shownT) {
      shownT = tf; world.style.transform = tf;
      if (!rasterZ) rasterZ = view.z;
      else if (view.z !== rasterZ) sharpen();
    }
    const g = rec.grid ? M.GRID * view.z * 2 ** Math.max(0, Math.ceil(Math.log2(10 / (M.GRID * view.z)))) : 0;
    viewEl.classList.toggle('grid', !!rec.grid);
    if (g) { viewEl.style.backgroundSize = `${g}px ${g}px`; viewEl.style.backgroundPosition = `${view.x - g / 2}px ${view.y - g / 2}px`; }
    const pct = Math.round(view.z * 100);
    if (pct !== shownPct) { shownPct = pct; $('.cv-zpct', root).textContent = `${pct}%`; }
    drawItems();
    cull();
    drawOverlay();
  }
  // Items well outside the window are taken out of the page's painting, so a big board zoomed in costs little more
  // than the part on screen. A margin of one window on each side keeps fast pans from showing gaps.
  const boxes = new WeakMap();
  const boxOf = (it) => {
    let b = boxes.get(it);
    if (!b || (it.t === 'line' && (b.ea !== byId.get(it.a?.id) || b.eb !== byId.get(it.b?.id)))) {
      b = { ...M.aabb(it, byId), ea: byId.get(it.a?.id), eb: byId.get(it.b?.id) };
      boxes.set(it, b);
    }
    return b;
  };
  function cull() {
    const v = visibleRect(), R = { x: v.x - v.w, y: v.y - v.h, w: v.w * 3, h: v.h * 3 };
    let shown = false;
    for (const it of items) {
      const n = nodes.get(it.id);
      if (!n) continue;
      const off = !M.hitBox(boxOf(it), R) && editing?.id !== it.id;
      if (off === !!n.off) continue;
      n.off = off;
      n.el.style.display = off ? 'none' : '';
      // text measured while hidden is measured again once it shows
      if (!off && (it.t === 'note' || it.t === 'text')) { n.it = null; n.ck = null; shown = true; }
    }
    if (shown) schedule();
  }
  function drawItems() {
    const seen = new Set(), measure = [];
    for (const it of items) {
      let n = nodes.get(it.id);
      if (!n) { n = makeNode(it); nodes.set(it.id, n); }
      seen.add(it.id);
      // a connector is redrawn only when it or one of the items it's attached to changed, so panning a big board
      // doesn't recompute every line
      const ea = it.t === 'line' && it.a?.id ? byId.get(it.a.id) || null : null, eb = it.t === 'line' && it.b?.id ? byId.get(it.b.id) || null : null;
      if (n.it !== it || n.ea !== ea || n.eb !== eb) {
        n.ea = ea; n.eb = eb;
        const rebuilt = paint(n, it, byId, { editing: editing?.id === it.id });
        if (it.t === 'text' && (rebuilt || n.mw !== it.w)) measure.push(n);
      }
    }
    for (const [id, n] of nodes) if (!seen.has(id)) { n.el.remove(); nodes.delete(id); }
    let ref = defs.nextSibling;
    for (const it of items) {
      const e = nodes.get(it.id).el;
      if (e !== ref) world.insertBefore(e, ref);
      else ref = ref.nextSibling;
    }
    // text boxes grow with their text: the height is measured, not set by hand
    const fix = new Map();
    for (const n of measure) {
      n.mw = n.it.w;
      const hh = Math.ceil(n.el.offsetHeight);
      if (hh && Math.abs(hh - n.it.h) > 0.5) fix.set(n.it.id, { h: hh });
    }
    if (fix.size) {
      items = items.map((it) => (fix.has(it.id) ? M.clean({ ...it, ...fix.get(it.id) }) : it));
      index(); dirty = true; saveSoon();
      for (const id of fix.keys()) nodes.get(id).it = byId.get(id);
      schedule(); // (connectors to them follow next frame)
    }
  }

  // ---------------------------------------------------------------- selection
  const groupIds = (id) => { const it = byId.get(id); return it?.g ? items.filter((i) => i.g === it.g).map((i) => i.id) : [id]; };
  const selItems = () => items.filter((i) => sel.has(i.id));
  function select(ids, add = false) { if (!add) sel.clear(); for (const id of ids) if (byId.has(id)) sel.add(id); schedule(); }
  function clearSel() { if (editing) stopEdit(); sel.clear(); schedule(); }
  const boxS = (b) => { const [x, y] = toS(b.x, b.y); return { x, y, w: b.w * view.z, h: b.h * view.z }; };
  let fmtKey = '', shownSel = '';
  function drawOverlay() {
    const sIts = mode === 'draw' ? [] : selItems();
    let s = '';
    // guides run a little past both items, so they show even where they lie along an edge
    const X = 18;
    for (const g of guides) {
      if (g.v) { const [x, y0] = toS(g.x, g.a), [, y1] = toS(g.x, g.b); s += `<i class="cv-guide v" style="left:${x}px;top:${y0 - X}px;height:${y1 - y0 + X * 2}px"></i>`; }
      else { const [x0, y] = toS(g.a, g.y), [x1] = toS(g.b, g.y); s += `<i class="cv-guide h" style="left:${x0 - X}px;top:${y}px;width:${x1 - x0 + X * 2}px"></i>`; }
    }
    if (marquee) { const b = boxS(marquee); s += `<i class="cv-mq" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></i>`; }
    if (lasso?.length > 1) s += `<svg class="cv-lasso-live"><path d="M${lasso.map((p) => toS(p[0], p[1]).map(M.r1).join(' ')).join('L')}Z"/></svg>`;
    if (hover) {
      const it = byId.get(hover);
      if (it && it.t !== 'line') { const b = boxS(M.aabb(it, byId)); s += `<i class="cv-target" style="left:${b.x - 4}px;top:${b.y - 4}px;width:${b.w + 8}px;height:${b.h + 8}px"></i>`; }
    }
    if (drag?.kind === 'conn' && drag.moved) {
      const [x0, y0] = toS(drag.from.x, drag.from.y), [x1, y1] = toS(drag.wx, drag.wy);
      s += `<svg class="cv-conn-live"><path d="M${x0} ${y0}L${x1} ${y1}"/></svg>`;
    }
    if (eraser && mode === 'draw') { const [x, y] = toS(eraser.x, eraser.y); s += `<i class="cv-eraser-ring" style="left:${x}px;top:${y}px;width:${eraser.r * 2 * view.z}px;height:${eraser.r * 2 * view.z}px"></i>`; }
    const busy = drag && drag.moved && drag.kind !== 'marquee' && drag.kind !== 'lasso';
    if (sIts.length) {
      const one = sIts.length === 1 ? sIts[0] : null, locked = sIts.every((i) => i.lk);
      if (one?.t === 'line') {
        const g = M.lineGeom(one, byId);
        s += `<svg class="cv-line-sel"><path d="${linePathS(g)}"/></svg>`;
        if (!one.lk && !busy) {
          for (const [k, P] of [['a', g.A], ['b', g.B]]) { const [x, y] = toS(P.x, P.y); s += `<i class="cv-h cv-end ${(k === 'a' ? one.a : one.b)?.id ? 'on' : ''}" data-end="${k}" style="left:${x}px;top:${y}px"></i>`; }
          if (!one.a?.id && !one.b?.id && one.k !== 'e') { const [mx, my] = M.lineMid(g), [x, y] = toS(mx, my); s += `<i class="cv-h cv-mid" data-end="m" style="left:${x}px;top:${y}px"></i>`; }
        }
      } else if (one) {
        const [cx, cy] = toS(one.x + one.w / 2, one.y + one.h / 2), w = one.w * view.z, hh = one.h * view.z;
        const hs = one.t === 'text' ? ['e', 'w'] : Object.keys(HANDLES);
        s += `<div class="cv-box ${one.lk ? 'lk' : ''} ${editing ? 'editing' : ''}" style="left:${cx - w / 2}px;top:${cy - hh / 2}px;width:${w}px;height:${hh}px;transform:rotate(${one.r || 0}deg)">`;
        if (!one.lk && !editing && !busy) {
          // small items keep only the corner handles, so the handles never cover what they belong to
          for (const k of hs) if (k.length === 2 || (w > 46 && hh > 46) || one.t === 'text') s += `<i class="cv-h" data-h="${k}" style="left:${(HANDLES[k][0] + 1) * 50}%;top:${(HANDLES[k][1] + 1) * 50}%"></i>`;
          s += `<i class="cv-h cv-rot" data-rot="1" title="${esc(t('canvas.rotate'))}"></i>`;
          if (prefs().conn !== false && one.t !== 'ink') for (const sd of ['n', 'e', 's', 'w']) s += `<i class="cv-cd" data-cd="${sd}" data-s="${sd}" title="${esc(t('canvas.addConnector'))}">${icon('plus', 12)}</i>`;
        }
        if (one.lk) s += `<i class="cv-lkb">${icon('lock', 13)}</i>`;
        s += '</div>';
      } else {
        for (const it of sIts) { const b = boxS(M.aabb(it, byId)); s += `<i class="cv-out" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></i>`; }
        const U = boxS(M.contentBox(sIts, byId));
        s += `<div class="cv-box multi ${locked ? 'lk' : ''}" style="left:${U.x}px;top:${U.y}px;width:${U.w}px;height:${U.h}px">`;
        if (!locked && !busy) {
          for (const k of ['nw', 'ne', 'se', 'sw']) s += `<i class="cv-h" data-h="${k}" style="left:${(HANDLES[k][0] + 1) * 50}%;top:${(HANDLES[k][1] + 1) * 50}%"></i>`;
          s += `<i class="cv-h cv-rot" data-rot="1" title="${esc(t('canvas.rotate'))}"></i>`;
        }
        if (locked) s += `<i class="cv-lkb">${icon('lock', 13)}</i>`;
        s += '</div>';
      }
    }
    if (s !== shownSel) { shownSel = s; selEl.innerHTML = s; }
    // the selection toolbar floats over the selection and is rebuilt only when the selection changes
    if (sIts.length && !busy && !(drag?.kind === 'lasso')) {
      const key = (editing ? 'e|' : '|') + sIts.map((i) => [i.id, i.t, i.lk, i.c, i.col, i.fill, i.st, i.sw, i.ds, i.op, i.rad, i.n, i.font, i.fs, i.b === true, i.i, i.u, i.s, i.al, i.k, i.ha, i.hb, i.sz, i.t === 'link' ? i.u + i.tx : ''].join('/')).join(',');
      if (key !== fmtKey) { fmtKey = key; fmtEl.replaceChildren(formatBar(api, sIts)); }
      fmtEl.hidden = false;
      placeFmt(M.contentBox(sIts, byId));
    } else {
      fmtEl.hidden = true;
      if (!sIts.length) fmtKey = '';
    }
  }
  function linePathS(g) {
    const s = (p) => { const [x, y] = toS(p[0], p[1]); return `${M.r1(x)} ${M.r1(y)}`; };
    if (g.ctrl.length) return `M${s(g.pts[0])}C${s(g.pts[1])} ${s(g.pts[2])} ${s(g.pts[3])}`;
    return 'M' + g.pts.map(s).join('L');
  }
  function placeFmt(B) {
    const b = boxS(B), r = vrect(), fw = fmtEl.offsetWidth, fh = fmtEl.offsetHeight, top = 72, bottom = 64;
    let x = b.x + b.w / 2 - fw / 2, y = b.y - fh - 24;
    if (y < top) y = b.y + b.h + 24;
    if (y + fh > r.height - bottom) y = Math.max(top, Math.min(b.y - fh - 24, r.height - fh - bottom));
    x = clamp(x, 10, Math.max(10, r.width - fw - 10)); y = clamp(y, top, Math.max(top, r.height - fh - 10));
    fmtEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  // ---------------------------------------------------------------- hit testing
  /** Thin things (ink, lines) under a point, within a few screen pixels: the topmost one wins. */
  function hitThin(wx, wy, types = ['ink', 'line']) {
    const tol = 7 / view.z;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (!types.includes(it.t)) continue;
      const b = M.aabb(it, byId);
      if (wx < b.x - tol || wx > b.x + b.w + tol || wy < b.y - tol || wy > b.y + b.h + tol) continue;
      if (it.t === 'ink' ? hitInk(it, wx, wy, tol) : M.distToLine(M.lineGeom(it, byId), wx, wy) <= tol + (it.sw ?? 3) / 2) return it.id;
    }
    return null;
  }
  /** The item under a screen point that a connector can attach to (lines and the dragged connector excluded). */
  function targetAt(cx, cy, not) {
    for (const e of document.elementsFromPoint(cx, cy)) {
      const id = e.closest?.('.cv-it')?.dataset.id;
      if (id && id !== not && byId.get(id)?.t !== 'line' && root.contains(e)) return id;
      if (e === viewEl) break;
    }
    return null;
  }

  // ---------------------------------------------------------------- pointer
  viewEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cv-fmt')) return;
    closePops();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (ptrs.size === 2 && [...ptrs.values()].every((p) => p.type === 'touch')) { cancelDrag(); startPinch(); return; }
    if (editing && e.target.closest('.cv-it')?.dataset.id === editing.id) return; // moving the caret
    if (e.button === 2) return;
    if (document.activeElement !== viewEl && !editing) viewEl.focus({ preventScroll: true });
    try { viewEl.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    const r = vrect(), [wx, wy] = toW(e.clientX, e.clientY, r);
    if (e.button === 1 || space) { e.preventDefault(); drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, v: { ...view }, moved: true }; root.classList.add('panning'); return; }
    if (mode === 'draw') {
      if (editing) stopEdit();
      if (tool === 'eraser') { drag = { kind: 'erase', last: [wx, wy], cp: false }; eraseAt(wx, wy); }
      else { const T = TOOLS[tool] || TOOLS.pen; drag = { kind: 'draw', pts: [[wx, wy, pressure(e)]], live: liveStroke(), sz: inkSize(tool), tool, col: inkCol(tool), T }; drawLive(); }
      return;
    }
    const hd = e.target.closest('[data-h],[data-rot],[data-end],[data-cd]');
    if (hd) { if (editing) stopEdit(); startHandle(hd, e, wx, wy); return; }
    let id = e.target.closest('.cv-it')?.dataset.id || null;
    if (editing) stopEdit();
    if (!id || byId.get(id)?.t === 'ink' || byId.get(id)?.t === 'line') id = hitThin(wx, wy) || id;
    // the lasso draws over items, except to pick up what it already holds
    if (mode === 'lasso' && !(id && sel.has(id))) {
      if (!e.shiftKey) clearSel();
      drag = { kind: 'lasso', base: e.shiftKey ? new Set(sel) : new Set(), cx: e.clientX, cy: e.clientY, moved: false };
      lasso = [[wx, wy]];
      return;
    }
    if (id && byId.has(id)) {
      const ids = sel.has(id) && sel.size > 1 ? [...sel] : groupIds(id);
      const was = sel.has(id);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (was) { for (const x of groupIds(id)) sel.delete(x); schedule(); return; }
        select(groupIds(id), true);
      } else if (!was) select(ids);
      const moving = selItems().filter((i) => !i.lk);
      drag = { kind: 'move', cx: e.clientX, cy: e.clientY, x0: wx, y0: wy, id, was: was && sel.size === 1, multi: was && sel.size > groupIds(id).length && !(e.shiftKey || e.metaKey || e.ctrlKey), start: new Map(moving.map((i) => [i.id, i])), moved: false };
      return;
    }
    if (e.pointerType === 'touch') { drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, v: { ...view }, moved: false }; return; }
    const base = e.shiftKey ? new Set(sel) : new Set();
    if (!e.shiftKey) clearSel();
    drag = { kind: 'marquee', x0: wx, y0: wy, base, cx: e.clientX, cy: e.clientY, moved: false };
  });
  viewEl.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { ...ptrs.get(e.pointerId), x: e.clientX, y: e.clientY });
    if (drag?.kind === 'pinch') return movePinch();
    const r = vrect();
    if (mode === 'draw' && tool === 'eraser' && e.pointerType !== 'touch') { const [ex, ey] = toW(e.clientX, e.clientY, r); eraser = { x: ex, y: ey, r: eraseR() }; schedule(); }
    if (!drag) return;
    const [wx, wy] = toW(e.clientX, e.clientY, r);
    switch (drag.kind) {
      case 'pan':
        if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;
        drag.moved = true;
        setView({ ...view, x: drag.v.x + e.clientX - drag.cx, y: drag.v.y + e.clientY - drag.cy }); curScene = -1;
        break;
      case 'draw':
        for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) { const [x, y] = toW(ev.clientX, ev.clientY, r); drag.pts.push([x, y, pressure(ev)]); }
        drawLive();
        break;
      case 'erase': {
        const [lx, ly] = drag.last, d = Math.hypot(wx - lx, wy - ly), step = eraseR() / 2;
        for (let k = 1; k * step < d; k++) eraseAt(lx + ((wx - lx) * k * step) / d, ly + ((wy - ly) * k * step) / d);
        eraseAt(wx, wy); drag.last = [wx, wy];
        break;
      }
      case 'move': moveDrag(e, wx, wy); break;
      case 'marquee': {
        if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 3) return;
        drag.moved = true;
        marquee = { x: Math.min(drag.x0, wx), y: Math.min(drag.y0, wy), w: Math.abs(wx - drag.x0), h: Math.abs(wy - drag.y0) };
        sel = new Set(drag.base);
        for (const it of items) if (M.hitBox(marquee, M.aabb(it, byId))) for (const id of groupIds(it.id)) sel.add(id);
        schedule();
        break;
      }
      case 'lasso': {
        drag.moved ||= Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) > 3;
        const last = lasso.at(-1);
        if (Math.hypot(wx - last[0], wy - last[1]) * view.z > 3) { lasso.push([wx, wy]); schedule(); }
        break;
      }
      case 'resize': resizeDrag(e, wx, wy); break;
      case 'rotate': rotateDrag(e, wx, wy); break;
      case 'end': endDrag(e, wx, wy); break;
      case 'conn':
        drag.moved ||= Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) > 4;
        drag.wx = wx; drag.wy = wy; hover = drag.moved ? targetAt(e.clientX, e.clientY, drag.id) : null; schedule();
        break;
    }
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (drag?.kind === 'pinch') { if (ptrs.size < 2) drag = null; return; }
    if (!drag) return;
    const d = drag;
    drag = null;
    root.classList.remove('panning');
    guides = []; marquee = null; hover = null;
    if (d.kind === 'draw') finishStroke(d);
    else if (d.kind === 'move') {
      lift(d, false);
      if (d.moved) markDirty();
      // a click on a selected note or text box types in it; shapes take a double-click, so they can be picked up again
      else if (d.was && e.type === 'pointerup' && !e.shiftKey) { const it = byId.get(d.id); if (it && (it.t === 'note' || it.t === 'text') && !it.lk) startEdit(it.id, { at: [e.clientX, e.clientY] }); }
      else if (d.multi && e.type === 'pointerup') select(groupIds(d.id)); // a click on one of several selected items selects just it
    } else if (d.kind === 'lasso') finishLasso(d);
    else if (d.kind === 'pan' && e.pointerType === 'touch' && !d.moved) clearSel();
    else if (d.kind === 'conn') finishConn(d, e);
    else if (['resize', 'rotate', 'end', 'erase'].includes(d.kind) && d.cp) markDirty();
    else if (d.kind === 'pan') saveViewSoon();
    schedule();
  };
  viewEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // a middle drag pans instead of starting autoscroll
  viewEl.addEventListener('pointerup', up);
  viewEl.addEventListener('pointercancel', up);
  viewEl.addEventListener('pointerleave', () => { if (eraser) { eraser = null; schedule(); } });
  // items being dragged get layers of their own, so moving them doesn't redraw what's under them
  const lift = (d, on) => { for (const id of d.start?.keys() || []) { const n = nodes.get(id); if (n && byId.get(id)?.t !== 'line') n.el.classList.toggle('lifted', on); } };
  function cancelDrag() {
    if (drag?.live) drag.live.remove();
    if (drag?.kind === 'move') lift(drag, false);
    drag = null; guides = []; marquee = null; lasso = null; hover = null;
    schedule();
  }
  function startPinch() {
    const [a, b] = [...ptrs.values()];
    drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], v: { ...view }, moved: true };
  }
  function movePinch() {
    const [a, b] = [...ptrs.values()];
    if (!a || !b) return;
    const r = vrect(), d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
    const z = clamp((drag.v.z * d) / Math.max(1, drag.d0), ZMIN, ZMAX);
    const wx = (drag.m0[0] - r.left - drag.v.x) / drag.v.z, wy = (drag.m0[1] - r.top - drag.v.y) / drag.v.z;
    setView({ z, x: m[0] - wx * z, y: m[1] - wy * z }); curScene = -1;
  }
  viewEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= 400; dy *= 400; }
    const r = vrect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, view.z * Math.exp(-dy * (Math.abs(dy) < 40 ? 0.012 : 0.0022)));
    else {
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      setView({ ...view, x: view.x - dx, y: view.y - dy }); curScene = -1;
    }
  }, { passive: false });

  // moving, with the edges and centres of other items as guides (or the grid when Snap to grid is on)
  const snapping = () => !!(rec.grid && rec.snap);
  function moveDrag(e, wx, wy) {
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 3) return;
      drag.moved = true;
      if (!drag.start.size) return;
      checkpoint();
      lift(drag, true);
      const v = visibleRect(), moving = new Set(drag.start.keys());
      drag.box = M.contentBox([...drag.start.values()], byId);
      drag.cands = items.filter((i) => !moving.has(i.id) && !(i.t === 'line' && (moving.has(i.a?.id) || moving.has(i.b?.id)))).map((i) => M.aabb(i, byId)).filter((b) => M.hitBox(b, { x: v.x - v.w, y: v.y - v.h, w: v.w * 3, h: v.h * 3 }));
    }
    if (!drag.start.size) return;
    let dx = wx - drag.x0, dy = wy - drag.y0;
    guides = [];
    if (!e.altKey && drag.box) {
      if (snapping()) { dx = M.snapTo(drag.box.x + dx) - drag.box.x; dy = M.snapTo(drag.box.y + dy) - drag.box.y; }
      else ({ dx, dy } = snap(drag.box, dx, dy, drag.cands));
    }
    setItems(items.map((it) => (drag.start.has(it.id) ? moved(drag.start.get(it.id), dx, dy) : it)), false);
  }
  function moved(it, dx, dy) {
    if (it.t !== 'line') return { ...it, x: M.r1(it.x + dx), y: M.r1(it.y + dy) };
    const mv = (p) => (p?.id ? p : { x: M.r1((p?.x ?? 0) + dx), y: M.r1((p?.y ?? 0) + dy) }); // attached ends follow their item
    return M.clean({ ...it, a: mv(it.a), b: mv(it.b), m: it.m && { x: M.r1(it.m.x + dx), y: M.r1(it.m.y + dy) } });
  }
  function snap(B, dx, dy, cands) {
    const thr = 6 / view.z, xs = [B.x, B.x + B.w / 2, B.x + B.w], ys = [B.y, B.y + B.h / 2, B.y + B.h];
    let bx = null, by = null;
    for (const c of cands) {
      const cx = [c.x, c.x + c.w / 2, c.x + c.w], cy = [c.y, c.y + c.h / 2, c.y + c.h];
      for (const a of xs) for (const b of cx) { const d = b - (a + dx); if (Math.abs(d) <= thr && (!bx || Math.abs(d) < Math.abs(bx.d) - 0.01)) bx = { d, x: b }; }
      for (const a of ys) for (const b of cy) { const d = b - (a + dy); if (Math.abs(d) <= thr && (!by || Math.abs(d) < Math.abs(by.d) - 0.01)) by = { d, y: b }; }
    }
    if (bx) dx += bx.d;
    if (by) dy += by.d;
    const nb = { x: B.x + dx, y: B.y + dy, w: B.w, h: B.h };
    // one guide per line, running from the moving box to the farthest item it lines up with
    let gv = null, gh = null;
    for (const c of cands) {
      if (bx && [c.x, c.x + c.w / 2, c.x + c.w].some((v) => Math.abs(v - bx.x) < 0.01)) gv = { v: true, x: bx.x, a: Math.min(gv?.a ?? Infinity, c.y, nb.y), b: Math.max(gv?.b ?? -Infinity, c.y + c.h, nb.y + nb.h) };
      if (by && [c.y, c.y + c.h / 2, c.y + c.h].some((v) => Math.abs(v - by.y) < 0.01)) gh = { v: false, y: by.y, a: Math.min(gh?.a ?? Infinity, c.x, nb.x), b: Math.max(gh?.b ?? -Infinity, c.x + c.w, nb.x + nb.w) };
    }
    guides = [gv, gh].filter(Boolean);
    return { dx, dy };
  }

  // handles: resize, rotate, connector ends, new connections
  function startHandle(hd, e, wx, wy) {
    const sIts = selItems().filter((i) => !i.lk);
    if (hd.dataset.cd) {
      const it = sIts[0];
      if (!it) return;
      drag = { kind: 'conn', id: it.id, side: hd.dataset.cd, from: M.sideOf(it, hd.dataset.cd), cx: e.clientX, cy: e.clientY, wx, wy, moved: false };
      return;
    }
    if (hd.dataset.end) { drag = { kind: 'end', id: sIts[0]?.id, end: hd.dataset.end, cp: false }; return; }
    if (!sIts.length) return;
    if (hd.dataset.rot) {
      const one = sIts.length === 1 ? sIts[0] : null, B = one && one.t !== 'line' ? one : M.contentBox(sIts, byId);
      const c = [B.x + B.w / 2, B.y + B.h / 2];
      drag = { kind: 'rotate', c, a0: Math.atan2(wy - c[1], wx - c[0]), start: sIts, one, cp: false };
      return;
    }
    const [hx, hy] = HANDLES[hd.dataset.h];
    if (sIts.length === 1 && sIts[0].t !== 'line') {
      const it = sIts[0], [cx, cy] = M.center(it);
      const A = M.rotPt(cx - (hx * it.w) / 2, cy - (hy * it.h) / 2, cx, cy, it.r || 0);
      drag = { kind: 'resize', one: it, hx, hy, A, cp: false };
    } else {
      const U = M.contentBox(sIts, byId);
      drag = { kind: 'resize', many: sIts, U, hx, hy, A: [hx > 0 ? U.x : U.x + U.w, hy > 0 ? U.y : U.y + U.h], cp: false };
    }
  }
  function resizeDrag(e, wx, wy) {
    if (!drag.cp) { checkpoint(); drag.cp = true; }
    const { hx, hy, A } = drag;
    if (drag.one) {
      const it = drag.one, a = M.rad(-(it.r || 0));
      const vx = (wx - A[0]) * Math.cos(a) - (wy - A[1]) * Math.sin(a), vy = (wx - A[0]) * Math.sin(a) + (wy - A[1]) * Math.cos(a);
      const min = it.t === 'text' ? 40 : 12;
      let w = hx ? Math.max(min, hx * vx) : it.w, hh = hy ? Math.max(12, hy * vy) : it.h;
      if (hx && hy && KEEP_ASPECT.has(it.t) !== e.shiftKey) { const s = Math.max(w / it.w, hh / it.h); w = Math.max(min, it.w * s); hh = Math.max(12, it.h * s); }
      // the centre: the fixed point plus half the new size along the handle's own axes
      const c = M.rotPt(A[0] + (hx * w) / 2, A[1] + (hy * hh) / 2, A[0], A[1], it.r || 0);
      patch(new Map([[it.id, { x: c[0] - w / 2, y: c[1] - hh / 2, w, h: it.t === 'text' ? it.h : hh }]]), false);
    } else {
      const { U, many } = drag;
      const s = Math.max(0.05, Math.max((hx * (wx - A[0])) / U.w, (hy * (wy - A[1])) / U.h));
      const map = new Map();
      for (const it of many) {
        if (it.t === 'line') { const sc = (p) => (p?.id ? p : { x: A[0] + (p.x - A[0]) * s, y: A[1] + (p.y - A[1]) * s }); map.set(it.id, { a: sc(it.a), b: sc(it.b), m: it.m && sc(it.m) }); continue; }
        const [cx, cy] = M.center(it), ncx = A[0] + (cx - A[0]) * s, ncy = A[1] + (cy - A[1]) * s, w = it.w * s, hh = it.h * s;
        map.set(it.id, { x: ncx - w / 2, y: ncy - hh / 2, w, h: hh, ...(it.t === 'text' || it.t === 'shape' ? { fs: (it.fs || (it.t === 'text' ? M.DEF.text.fs : 18)) * s } : {}) });
      }
      patch(map, false);
    }
  }
  function rotateDrag(e, wx, wy) {
    if (!drag.cp) { checkpoint(); drag.cp = true; }
    const [cx, cy] = drag.c;
    let da = ((Math.atan2(wy - cy, wx - cx) - drag.a0) * 180) / Math.PI;
    const map = new Map();
    if (drag.one && drag.one.t !== 'line') {
      let r = (drag.one.r || 0) + da;
      r = e.shiftKey ? Math.round(r / 15) * 15 : Math.abs(r - Math.round(r / 45) * 45) < 4 ? Math.round(r / 45) * 45 : r;
      r = (((r % 360) + 540) % 360) - 180;
      map.set(drag.one.id, { r: Math.abs(r) < 0.05 ? 0 : r });
    } else {
      if (e.shiftKey) da = Math.round(da / 15) * 15;
      for (const it of drag.start) {
        if (it.t === 'line') { const rp = (p) => (p?.id ? p : (([x, y]) => ({ x, y }))(M.rotPt(p.x, p.y, cx, cy, da))); map.set(it.id, { a: rp(it.a), b: rp(it.b), m: it.m && rp(it.m) }); continue; }
        const [ix, iy] = M.center(it), [nx, ny] = M.rotPt(ix, iy, cx, cy, da);
        map.set(it.id, { x: nx - it.w / 2, y: ny - it.h / 2, r: ((((it.r || 0) + da) % 360) + 540) % 360 - 180 });
      }
    }
    patch(map, false);
  }
  function endDrag(e, wx, wy) {
    const it = byId.get(drag.id);
    if (!it) return;
    if (!drag.cp) { checkpoint(); drag.cp = true; }
    if (drag.end === 'm') { patch(new Map([[it.id, { k: 'c', m: { x: wx, y: wy } }]]), false); return; }
    const other = M.lineGeom(it, byId)[drag.end === 'a' ? 'B' : 'A'];
    const tgt = targetAt(e.clientX, e.clientY, it.id);
    hover = tgt;
    let p = { x: wx, y: wy };
    if (!tgt && e.shiftKey) { const a = Math.round(Math.atan2(wy - other.y, wx - other.x) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(wx - other.x, wy - other.y); p = { x: other.x + Math.cos(a) * l, y: other.y + Math.sin(a) * l }; }
    patch(new Map([[it.id, { [drag.end]: tgt ? { id: tgt, s: 'auto' } : { x: M.r1(p.x), y: M.r1(p.y) } }]]), false);
  }
  function finishConn(d, e) {
    const src = byId.get(d.id);
    if (!src) return;
    checkpoint();
    const lineOf = (aId, b) => M.clean({ id: M.uid('i'), t: 'line', k: prefs().connK || 's', a: { id: aId, s: 'auto' }, b, hb: true, sw: 3 });
    if (!d.moved) {
      // a tap on a connection point adds a copy of the item on that side, already connected
      const [nx, ny] = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[d.side], gap = 90;
      const copy = M.copyItems([src], items, nx * (src.w + gap), ny * (src.h + gap))[0];
      if (M.TEXT_TYPES.has(copy.t)) copy.tx = '';
      delete copy.g;
      const ln = lineOf(src.id, { id: copy.id, s: 'auto' });
      setItems(insertLine([...items, copy], ln));
      select([copy.id]);
      if (M.TEXT_TYPES.has(copy.t)) startEdit(copy.id);
      return;
    }
    const tgt = targetAt(e.clientX, e.clientY, d.id);
    const ln = lineOf(src.id, tgt ? { id: tgt, s: 'auto' } : { x: M.r1(d.wx), y: M.r1(d.wy) });
    setItems(insertLine(items, ln));
    select([ln.id]);
  }
  // a connector sits just below the lower of the two items it joins, so it never hides them
  function insertLine(list, ln) {
    const ia = list.findIndex((i) => i.id === ln.a?.id), ib = list.findIndex((i) => i.id === ln.b?.id);
    const at = Math.min(...[ia, ib].filter((i) => i >= 0), list.length);
    return [...list.slice(0, at), ln, ...list.slice(at)];
  }
  function finishLasso(d) {
    const poly = lasso || [];
    lasso = null;
    if (!d.moved || poly.length < 3) { schedule(); return; }
    const hits = M.lassoHits(items, poly, byId, (it) => worldPoints(it, Math.max(1, Math.floor(it.p.length / 3 / 40))));
    sel = new Set(d.base);
    for (const id of hits) for (const g of groupIds(id)) sel.add(g);
    schedule();
  }

  // ---------------------------------------------------------------- drawing
  const pressure = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  const inkSize = (tl) => clamp(ink.sz[tl] ?? TOOLS[tl]?.def ?? 3, TOOLS[tl]?.min ?? 1, TOOLS[tl]?.max ?? 48);
  const inkCol = (tl) => (tl === 'hl' ? ink.col.hl : ink.col.pen) || 'auto';
  const eraseR = () => (ink.er || 14) / view.z;
  function liveStroke() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'cv-live'); s.setAttribute('width', 1); s.setAttribute('height', 1); s.setAttribute('overflow', 'visible');
    world.appendChild(s);
    return s;
  }
  function drawLive() {
    const d = drag, { d: path, fill } = inkPath({ tool: d.tool, sz: d.sz, p: d.pts.flat() });
    const c = d.col === 'auto' ? 'var(--cv-ink)' : d.col;
    d.live.style.opacity = d.T.alpha;
    d.live.classList.toggle('hl', d.tool === 'hl');
    d.live.innerHTML = fill ? `<path d="${path}" fill="${c}" ${d.T.grain ? 'filter="url(#cv-grain)"' : ''}/>` : `<path d="${path}" fill="none" stroke="${c}" stroke-width="${d.sz}" stroke-linecap="${d.tool === 'hl' ? 'butt' : 'round'}" stroke-linejoin="round"/>`;
  }
  function finishStroke(d) {
    d.live.remove();
    if (!d.pts.length) return;
    // Auto shape: a rough circle, box, triangle or line becomes a clean one in the pen's colour and width
    const shape = ink.auto && d.tool !== 'hl' ? recognize(d.pts) : null;
    let it;
    if (shape?.k === 'line') it = M.clean({ id: M.uid('i'), t: 'line', k: 's', a: shape.a, b: shape.b, st: d.col === 'auto' ? undefined : d.col, sw: Math.max(1, d.sz) });
    else if (shape) it = M.clean({ id: M.uid('i'), t: 'shape', k: shape.k, x: shape.x, y: shape.y, w: shape.w, h: shape.h, pp: shape.pp, fill: 'none', st: d.col, sw: Math.max(1, d.sz) });
    else it = makeInk(d.tool, d.col, d.sz, d.pts);
    checkpoint();
    setItems([...items, it]);
  }
  function eraseAt(x, y) {
    const r = eraseR(), next = [];
    let changed = false;
    for (const it of items) {
      if (it.t !== 'ink' || it.lk) { next.push(it); continue; }
      const b = M.aabb(it, byId);
      if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) { next.push(it); continue; }
      if (ink.erase === 'stroke') {
        if (hitInk(it, x, y, r)) { changed = true; continue; }
        next.push(it);
        continue;
      }
      const parts = eraseSplit(it, x, y, r);
      if (!parts) { next.push(it); continue; }
      changed = true; next.push(...parts);
    }
    if (!changed) return;
    if (!drag?.cp) { checkpoint(); if (drag) drag.cp = true; }
    setItems(next, false);
  }
  function eraseAll() {
    const left = items.filter((i) => i.t !== 'ink' || i.lk);
    if (left.length === items.length) return;
    checkpoint(); setItems(left);
    toast(t('canvas.erasedAll'), { action: t('common.undo'), onAction: doUndo });
  }
  /** Picks a tool from the pen toolbar: select, lasso, or a pen type, 'hl' or 'eraser' to draw with. */
  function setMode(m, tl) {
    if (editing) stopEdit();
    mode = m;
    if (m === 'draw') { tool = tl || tool; sel.clear(); }
    root.dataset.mode = m;
    eraser = null; lasso = null;
    syncBars(); schedule();
  }
  const saveInk = () => { setPref('ink', { ...ink }); syncBars(); };
  const toolOf = () => (mode === 'draw' ? (PENS.includes(tool) ? 'pen' : tool) : mode);
  function pickTool(btn) {
    const k = btn.dataset.tool, cur = toolOf();
    if (k === cur && k !== 'select' && k !== 'lasso') return toolSettings(btn, k);
    if (k === 'select' || k === 'lasso') setMode(k);
    else setMode('draw', k === 'pen' ? ink.pen : k);
  }
  /** Pen settings (tap the pen again, like Samsung Notes): pen types, thickness, colours, Auto shape. */
  function toolSettings(anchor, k) {
    const node = h('div', { class: 'cv-pens' });
    node.style.setProperty('--cv-pen-tip', inkCol('pen') === 'auto' ? 'var(--cv-ink)' : inkCol('pen'));
    if (k === 'pen') {
      const names = { pen: t('canvas.pen'), pencil: t('canvas.pencil'), cal: t('canvas.calligraphy'), marker: t('canvas.marker') };
      const types = h('div', { class: 'cv-ptypes', role: 'radiogroup', html: PENS.map((p) => `<button data-p="${p}" class="${ink.pen === p ? 'on' : ''}" role="radio" aria-checked="${ink.pen === p}"><i>${penSVG(p)}</i><span>${esc(names[p])}</span></button>`).join('') });
      types.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        ink.pen = b.dataset.p; tool = ink.pen;
        $$('[data-p]', types).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        saveInk(); sizeSlot.replaceChildren(sizeRow());
      });
      node.append(types);
    }
    const sizeRow = () => {
      const tl = k === 'pen' ? ink.pen : k, T = TOOLS[tl];
      return sliderRow(t('canvas.thickness'), { min: T.min, max: T.max, step: 0.5, value: inkSize(tl), onInput: (v) => { ink.sz[tl] = v; saveInk(); } });
    };
    const sizeSlot = h('div', null);
    if (k === 'eraser') {
      const seg = h('div', { class: 'cv-seg wide', html: [['area', t('canvas.eraseArea')], ['stroke', t('canvas.eraseStroke')]].map(([v, n]) => `<button data-er="${v}" class="${ink.erase === v ? 'on' : ''}">${esc(n)}</button>`).join('') });
      seg.addEventListener('click', (e) => { const b = e.target.closest('[data-er]'); if (!b) return; ink.erase = b.dataset.er; $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); saveInk(); });
      node.append(seg, sliderRow(t('canvas.eraserSize'), { min: 4, max: 60, value: ink.er || 14, onInput: (v) => { ink.er = v; saveInk(); } }),
        h('button', { class: 'ou-btn tonal cv-erase-all', onClick: () => { closePops(); eraseAll(); } }, t('canvas.eraseAll')));
    } else {
      sizeSlot.append(sizeRow());
      node.append(sizeSlot);
      const colors = k === 'hl' ? HL_COLORS : INK_COLORS;
      node.append(swatchPicker(colors, inkCol(k), (c) => { if (k === 'hl') ink.col.hl = c; else ink.col.pen = c; saveInk(); }));
      if (k === 'pen') {
        const auto = h('label', { class: 'cv-auto' }, h('span', { html: icon('cv-autoshape', 20) }), h('span', { class: 'cv-auto-t' }, h('b', null, t('canvas.autoShape')), h('small', null, t('canvas.autoShapeSub'))));
        const s = h('input', { type: 'checkbox', checked: !!ink.auto, onChange: () => { ink.auto = s.checked; saveInk(); } });
        auto.append(h('span', { class: 'ou-switch' }, s, h('span', { class: 'ou-switch-track' }, h('span', { class: 'ou-switch-thumb' }))));
        node.append(auto);
      }
    }
    popover(anchor, node, { title: { pen: t('canvas.penSettings'), hl: t('canvas.highlighter'), eraser: t('canvas.eraser') }[k], cls: 'cv-pop-pens' });
  }

  // ---------------------------------------------------------------- text editing
  function startEdit(id, { at, all } = {}) {
    const it = byId.get(id);
    if (!it || it.lk || !M.TEXT_TYPES.has(it.t)) return;
    if (editing) stopEdit();
    if (mode === 'draw') setMode('select');
    sel.clear(); sel.add(id);
    drawItems();
    const n = nodes.get(id), tx = n?.tx;
    if (!tx) return;
    editing = { id, cp: false, tx };
    tx.dataset.ph = it.t === 'note' ? '' : t('canvas.typeText');
    tx.contentEditable = 'plaintext-only';
    tx.spellcheck = true;
    root.classList.add('editing');
    tx.focus({ preventScroll: true });
    const s = getSelection(), r = document.createRange();
    let placed = false;
    if (at && !all) {
      const cr = document.caretRangeFromPoint?.(at[0], at[1]);
      if (cr && tx.contains(cr.startContainer)) { s.removeAllRanges(); s.addRange(cr); placed = true; }
    }
    if (!placed) { r.selectNodeContents(tx); if (!all) r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    tx.addEventListener('input', onEditInput);
    tx.addEventListener('blur', onEditBlur);
    tx.addEventListener('keydown', onEditKey);
    schedule();
  }
  const readText = (tx) => (tx.innerText || '').replace(/\r/g, '').replace(/\n$/, '');
  function onEditInput() {
    if (!editing) return;
    if (!editing.cp) { checkpoint(); editing.cp = true; }
    const it = byId.get(editing.id);
    if (!it) return;
    const tx = readText(editing.tx);
    items = items.map((i) => (i.id === it.id ? { ...i, tx } : i));
    index();
    if (it.t === 'note') fitNote(nodes.get(it.id), byId.get(it.id));
    dirty = true; saveSoon(); thumbSoon(); schedule();
  }
  function onEditBlur() { setTimeout(() => { if (editing && document.activeElement !== editing.tx && !popOpen()) stopEdit(); }, 0); }
  function onEditKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); stopEdit(); }
  }
  function stopEdit() {
    if (!editing) return;
    const { id, tx, cp } = editing;
    editing = null;
    root.classList.remove('editing');
    tx.removeEventListener('input', onEditInput); tx.removeEventListener('blur', onEditBlur); tx.removeEventListener('keydown', onEditKey);
    tx.contentEditable = 'false';
    getSelection()?.removeAllRanges();
    const it = byId.get(id), n = nodes.get(id);
    if (n) n.ck = null; // rebuilt from the saved text, so the page and the data agree
    if (it) {
      const text = readText(tx);
      // an empty text box goes away when you stop typing
      if (it.t === 'text' && !text.trim()) setItems(items.filter((i) => i.id !== id));
      else if (text !== it.tx) { if (!cp) checkpoint(); patch(new Map([[id, { tx: text }]])); }
      else if (cp) markDirty();
    }
    if (!closed && (document.activeElement === document.body || !document.activeElement)) viewEl.focus({ preventScroll: true });
    schedule();
  }

  // ---------------------------------------------------------------- inserting
  const sizeK = () => clamp(1 / view.z, 1, 4);
  function centreW() { const v = visibleRect(); return [v.x + v.w / 2, v.y + v.h / 2 + 10 / view.z]; }
  /** Where a new item goes: at `at` (a drop or a click), else in the middle of the window or, when something is
   *  already there, the nearest free spot on screen. `pending` = boxes of items being added in the same go. */
  function placeNew(w, hh, at, pending = []) {
    let [cx, cy] = at || centreW(), x = cx - w / 2, y = cy - hh / 2;
    if (!at) {
      const boxes = [...items.filter((i) => i.t !== 'line').map((i) => M.aabb(i, byId)), ...pending], gap = 14 / view.z, v = visibleRect();
      const free = (px, py) => !boxes.some((b) => M.hitBox({ x: px - gap, y: py - gap, w: w + gap * 2, h: hh + gap * 2 }, b));
      if (!free(x, y)) {
        const step = Math.max(24 / view.z, Math.min(w, hh) / 3), top = v.y + 76 / view.z, bottom = v.y + v.h - 64 / view.z, spots = [];
        for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
          const px = x + i * step, py = y + j * step;
          if (px >= v.x + 10 / view.z && px + w <= v.x + v.w - 10 / view.z && py >= top && py + hh <= bottom) spots.push([px, py, Math.hypot(i * step, j * step * 1.3)]);
        }
        const spot = spots.sort((a, b) => a[2] - b[2]).find(([px, py]) => free(px, py));
        if (spot) [x, y] = spot;
      }
    }
    // a spot that's taken anyway (a full window, or the same drop point twice) cascades down and to the side
    for (let k = 0; k < 40 && [...items, ...pending].some((i) => i.t !== 'line' && Math.abs(i.x - x) < 3 && Math.abs(i.y - y) < 3); k++) { x += 24; y += 24; }
    if (snapping()) { x = M.snapTo(x); y = M.snapTo(y); }
    return [M.r1(x), M.r1(y)];
  }
  /** The width a line of pasted text needs, so a short phrase stays on one line. */
  function textWidth(text, fs) {
    const c = (textWidth.c ||= new OffscreenCanvas(1, 1).getContext('2d'));
    c.font = `${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui'}`;
    return Math.max(...text.split('\n').map((l) => c.measureText(l).width));
  }
  function add(newItems, { edit } = {}) {
    if (editing) stopEdit();
    if (mode !== 'select') setMode('select');
    checkpoint();
    setItems([...items, ...newItems.map(M.clean)]);
    select(newItems.map((i) => i.id));
    if (edit) { drawItems(); startEdit(newItems[0].id, { all: true }); }
  }
  function insertNote(at) {
    const k = sizeK(), s = M.DEF.note.w * k, [x, y] = placeNew(s, s, at);
    const c = prefs().noteC;
    add([{ id: M.uid('i'), t: 'note', x, y, w: s, h: s, c: c && c !== 'yellow' ? c : undefined, tx: '', fs: M.DEF.note.fs }], { edit: true });
  }
  function insertText(at) {
    const k = sizeK(), w = M.DEF.text.w * k, [x, y] = placeNew(w, M.DEF.text.h * k, at);
    add([{ id: M.uid('i'), t: 'text', x, y, w, h: M.DEF.text.h * k, fs: Math.round(M.DEF.text.fs * k), tx: '' }], { edit: true });
  }
  function insertShape(entry) {
    const k = sizeK(), it = entry.item;
    const w = (it.w || M.DEF.shape.w) * k, hh = (it.h || M.DEF.shape.h) * k, [x, y] = placeNew(w, hh);
    add([{ id: M.uid('i'), t: 'shape', ...it, x, y, w, h: hh, rad: it.rad ? it.rad * k : undefined, fill: prefs().shapeFill || M.DEF.shape.fill }]);
  }
  function addLine(entry) {
    // a new line takes a free spot too, so it doesn't land across the notes already there
    const k = sizeK(), it = entry.item, L = 90 * k, [x, y] = placeNew(L * 2, L * 1.2), cx = x + L, cy = y + L * 0.6;
    const ln = { id: M.uid('i'), t: 'line', k: it.k, a: { x: M.r1(cx - L), y: M.r1(cy + L * 0.6) }, b: { x: M.r1(cx + L), y: M.r1(cy - L * 0.6) }, ha: it.ha, hb: it.hb, sw: 3 };
    if (it.k === 'c') ln.m = { x: M.r1(cx - L * 0.25), y: M.r1(cy - L * 0.35) };
    add([ln]);
  }
  async function insertImages(files, at) {
    files = [...files].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    const out = [], v = visibleRect(), max = Math.min(420, Math.min(v.w, v.h) * 0.45);
    let [cx, cy] = at || [0, 0];
    for (const f of files) {
      try {
        const { blob, w: bw, h: bh } = await loadImage(f);
        const id = M.imageId();
        await putBlob(id, blob);
        const s = Math.min(1, max / Math.max(bw, bh)), w = Math.max(20, bw * s), hh = Math.max(20, bh * s);
        const [x, y] = placeNew(w, hh, at && [cx, cy], out);
        out.push({ id: M.uid('i'), t: 'img', x, y, w: M.r1(w), h: M.r1(hh), b: id });
        cx += 30; cy += 30;
      } catch (e) { console.warn(e); toast(t('canvas.imageFailed')); }
    }
    if (out.length) add(out);
  }
  function insertLink(u, title, at) {
    const url = toUrl(u);
    if (!url) return;
    const k = sizeK(), [x, y] = placeNew(M.DEF.link.w * k, M.DEF.link.h * k, at);
    add([{ id: M.uid('i'), t: 'link', x, y, w: M.DEF.link.w * k, h: M.DEF.link.h * k, u: url, tx: (title || '').trim() || undefined }]);
  }
  async function pickImages() { const files = await pickFile('image/*', true); if (files?.length) insertImages(files); }
  async function addLink() { const r = await linkDialog(null); if (r) insertLink(r.u, r.tx); }
  async function replaceImage(id) {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const { blob, w, h: ih } = await loadImage(f), bid = M.imageId();
      await putBlob(bid, blob);
      const it = byId.get(id);
      if (!it) return;
      const hh = (it.w * ih) / w;
      checkpoint(); patch(new Map([[id, { b: bid, h: hh, y: it.y + (it.h - hh) / 2 }]]));
    } catch { toast(t('canvas.imageFailed')); }
  }
  function insertMenu(anchor) {
    menu(anchor, [
      { label: t('canvas.textBox'), icon: 'cv-text', onClick: () => insertText() },
      { label: t('canvas.stickyNote'), icon: 'cv-sticky', onClick: () => insertNote() },
      { label: t('canvas.shapes'), icon: 'cv-shapes', onClick: () => openShapes(anchor) },
      { label: t('canvas.lines'), icon: 'cv-line', onClick: () => linePicker(anchor, addLine) },
      { label: t('canvas.image'), icon: 'image', onClick: pickImages },
      { label: t('canvas.link'), icon: 'link', onClick: addLink },
    ], { align: 'end' });
  }
  const openShapes = (anchor) => shapePicker(anchor, insertShape, { cat: prefs().shapeCat, onCat: (c) => setPref('shapeCat', c) });

  // ---------------------------------------------------------------- editing commands
  const unlockedSel = () => selItems().filter((i) => !i.lk);
  function del() {
    const ids = new Set(unlockedSel().map((i) => i.id));
    if (!ids.size) return;
    if (editing) stopEdit();
    checkpoint();
    const next = M.removeItems(items, ids, byId);
    sel.clear(); setItems(next);
  }
  function duplicate(dx = 24, dy = 24) {
    const its = selItems();
    if (!its.length) return;
    const copies = M.copyItems(its, items, dx, dy);
    checkpoint(); setItems([...items, ...copies]); select(copies.map((i) => i.id));
  }
  function setLock(on) { const its = selItems(); if (!its.length) return; checkpoint(); patch(new Map(its.map((i) => [i.id, { lk: on }]))); }
  function group() {
    const its = unlockedSel();
    if (its.length < 2) return;
    checkpoint(); setItems(M.groupItems(items, new Set(its.map((i) => i.id))));
  }
  function ungroup() { const its = selItems().filter((i) => i.g); if (!its.length) return; checkpoint(); patch(new Map(its.map((i) => [i.id, { g: undefined }]))); }
  function arrange(how) {
    const ids = new Set(unlockedSel().map((i) => i.id));
    if (!ids.size) return;
    const next = M.arrange(items, ids, how);
    if (next.every((x, i) => x === items[i])) return;
    checkpoint(); setItems(next);
  }
  function align(how) {
    const map = M.alignMap(unlockedSel(), how, byId);
    if (!map.size) return;
    checkpoint(); patch(map);
  }
  function nudge(dx, dy) {
    const its = unlockedSel();
    if (!its.length) return;
    checkpoint('nudge');
    const ids = new Set(its.map((i) => i.id));
    setItems(items.map((it) => (ids.has(it.id) ? moved(it, dx, dy) : it)));
  }
  /** Applies a change to the selected (unlocked) items: patch = object or fn(item) → object. */
  function patchSel(p, tag, filter = () => true) {
    const its = unlockedSel().filter(filter);
    if (!its.length) return;
    checkpoint(tag);
    patch(new Map(its.map((i) => [i.id, typeof p === 'function' ? p(i) : p])));
  }
  const selectAll = () => { setMode('select'); select(items.map((i) => i.id)); };

  // ---------------------------------------------------------------- clipboard
  const readClip = () => { try { return JSON.parse(localStorage.getItem(BD.CLIP) || 'null'); } catch { return null; } };
  const editable = (e) => e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  function copy(e) {
    const its = selItems();
    if (!its.length) return false;
    const sig = M.uid('c'), text = its.map((i) => i.tx || i.u || '').filter(Boolean).join('\n');
    const html = `<meta name="bloom-canvas" content="${sig}"><div>${esc(text)}</div>`;
    try { localStorage.setItem(BD.CLIP, JSON.stringify({ sig, items: M.copyItems(its, items, 0, 0), from: boardId, box: M.contentBox(its, byId) })); }
    catch { toast(t('canvas.tooBig')); return false; }
    if (e?.clipboardData) { e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', html); e.preventDefault(); }
    // the picture goes on the clipboard too, so a copy can be pasted into any other app
    try {
      const png = renderItems(its, { theme: 'l', scale: 2, pad: 16, all: items, fsOf }).then((cv) => toBlob(cv));
      navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).catch(() => {});
    } catch { /* no async clipboard */ }
    return true;
  }
  function cut(e) { if (copy(e)) del(); }
  function pasteClip(clip) {
    if (!clip?.items?.length) return false;
    const v = visibleRect(), B = clip.box || M.contentBox(clip.items);
    let dx = 24, dy = 24;
    // pasted where it was when that spot is on screen, else in the middle of the window
    if (!B || clip.from !== boardId || !M.hitBox(B, v) || B.w > v.w * 2) { const [cx, cy] = centreW(); dx = B ? cx - (B.x + B.w / 2) : 0; dy = B ? cy - (B.y + B.h / 2) : 0; }
    else { while (items.some((i) => clip.items.some((c) => c.t !== 'line' && Math.abs(i.x - (c.x + dx)) < 2 && Math.abs(i.y - (c.y + dy)) < 2))) { dx += 24; dy += 24; } }
    add(M.copyItems(clip.items, clip.items, dx, dy));
    return true;
  }
  let pasteWait = 0;
  function onPaste(e) {
    if (!active() || editing || editable(e)) return;
    clearTimeout(pasteWait); pasteWait = 0;
    const dt = e.clipboardData;
    if (!dt) return;
    const m = /name="bloom-canvas" content="([^"]+)"/.exec(dt.getData('text/html') || ''), clip = readClip();
    e.preventDefault();
    if (m && clip?.sig === m[1]) { pasteClip(clip); return; }
    const files = [...dt.files].filter((f) => /^image\//.test(f.type));
    if (files.length) { insertImages(files); return; }
    const text = (dt.getData('text/plain') || '').trim();
    if (!text) return;
    if (toUrl(text)) insertLink(text, '');
    else {
      const k = sizeK(), fs = Math.round(M.DEF.text.fs * k), w = Math.min(460 * k, Math.max(80 * k, textWidth(text, fs) + 14 * k)), [x, y] = placeNew(w, 40 * k);
      add([{ id: M.uid('i'), t: 'text', x, y, w, h: 40 * k, fs, tx: text }]);
    }
  }
  function onCopy(e) { if (!active() || editing || editable(e) || getSelection()?.toString()) return; copy(e); }
  function onCut(e) { if (!active() || editing || editable(e) || getSelection()?.toString()) return; cut(e); }
  async function pasteMenu() {
    // from a menu there's no paste event: Canvas' own clipboard first, then a picture or a link on the system clipboard
    try {
      for (const ci of await navigator.clipboard.read()) {
        if (ci.types.includes('text/html')) {
          const html = await (await ci.getType('text/html')).text(), m = /name="bloom-canvas" content="([^"]+)"/.exec(html), clip = readClip();
          if (m && clip?.sig === m[1]) { pasteClip(clip); return; }
        }
        const type = ci.types.find((x) => x.startsWith('image/'));
        if (type) { insertImages([new File([await ci.getType(type)], 'image', { type })]); return; }
        if (ci.types.includes('text/plain')) { const s = (await (await ci.getType('text/plain')).text()).trim(); if (s && toUrl(s)) { insertLink(s, ''); return; } }
      }
    } catch { /* no permission: use our own clipboard */ }
    pasteClip(readClip());
  }
  async function copyImage() {
    const its = selItems().length ? selItems() : items;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderItems(its, { theme: 'l', scale: 2, pad: 20, all: items, fsOf }).then((cv) => toBlob(cv)) })]);
      toast(t('canvas.copied'));
    } catch { toast(t('canvas.copyFailed')); }
  }

  // ---------------------------------------------------------------- export
  const fsOf = (id) => nodes.get(id)?.fs || 0;
  const boardName = () => BD.byId(boardId)?.name || t('canvas.untitled');
  async function exportPNG(selOnly = false) {
    const its = selOnly && sel.size ? selItems() : items;
    if (!its.length) { toast(t('canvas.emptyBoard')); return; }
    const cv = await renderItems(its, { theme: 'l', scale: 2, all: items, fsOf });
    download(fileName(boardName()) + '.png', await toBlob(cv), 'image/png');
    toast(t('canvas.savedImage'));
  }
  async function exportPDF() {
    if (!items.length) { toast(t('canvas.emptyBoard')); return; }
    const cv = await renderItems(items, { theme: 'l', scale: 2, all: items, fsOf });
    download(fileName(boardName()) + '.pdf', await pdfBlob(cv, cv.k, boardName()), 'application/pdf');
    toast(t('canvas.savedPdf'));
  }
  async function print() {
    if (!items.length) { toast(t('canvas.emptyBoard')); return; }
    printCanvas(await renderItems(items, { theme: 'l', scale: 2, all: items, fsOf }), boardName());
  }

  // ---------------------------------------------------------------- scenes
  function addScene() {
    const v = visibleRect(), name = t('canvas.sceneN', { n: scenes.length + 1 });
    checkpoint();
    scenes = [...scenes, { id: M.uid('s'), name, x: M.r1(v.x), y: M.r1(v.y), w: M.r1(v.w), h: M.r1(v.h) }];
    curScene = scenes.length - 1;
    markDirty(); syncBars();
    toast(t('canvas.sceneAdded'));
  }
  function goScene(i) {
    const s = scenes[i];
    if (!s) return;
    curScene = i;
    const r = vrect(), z = clamp(Math.min(r.width / s.w, r.height / s.h), ZMIN, ZMAX);
    animateTo({ z, x: r.width / 2 - (s.x + s.w / 2) * z, y: r.height / 2 - (s.y + s.h / 2) * z });
    setTimeout(() => { curScene = i; syncBars(); }, 460);
    syncBars();
  }
  function setScenes(next, tag) { checkpoint(tag); scenes = next; markDirty(); syncBars(); }

  // ---------------------------------------------------------------- bars and menus
  function syncBars() {
    if (closed) return;
    const b = BD.byId(boardId);
    page?.setTitle(b?.name || t('canvas.untitled'));
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
    const cur = toolOf();
    $$('[data-tool]', toolsEl).forEach((x) => { x.classList.toggle('on', x.dataset.tool === cur); x.setAttribute('aria-pressed', String(x.dataset.tool === cur)); });
    const pc = inkCol('pen'), hc = inkCol('hl');
    $('[data-tool="pen"] .cv-tdot', toolsEl).style.background = pc === 'auto' ? 'var(--cv-ink)' : pc;
    $('[data-tool="hl"] .cv-tdot', toolsEl).style.background = hc;
    const scn = $('.cv-scn', root);
    scn.classList.toggle('has', scenes.length > 0);
    $('.cv-scn-name', scn).textContent = scenes[curScene]?.name || t('canvas.scenes');
  }
  async function rename() {
    const b = BD.byId(boardId);
    if (!b) return;
    const n = (await prompt(t('canvas.rename'), { value: b.name, placeholder: t('canvas.boardName') }))?.trim();
    if (n) { BD.update(boardId, () => ({ name: n })); syncBars(); }
  }
  function saveMenu(anchor) {
    menu(anchor, [
      { label: t('canvas.saveImage'), icon: 'image', onClick: () => exportPNG() },
      { label: t('canvas.savePdf'), icon: 'cv-pdf', onClick: exportPDF },
      { label: t('canvas.copyImage'), icon: 'copy', onClick: copyImage },
      { label: t('canvas.print'), icon: 'cv-print', onClick: print },
    ], { align: 'end' });
  }
  function moreMenu(anchor) {
    const b = BD.byId(boardId);
    if (!b) return;
    menu(anchor, [
      { label: t('canvas.rename'), icon: 'edit', onClick: rename },
      { label: b.fav ? t('canvas.unfavorite') : t('canvas.favorite'), icon: b.fav ? 'starFill' : 'star', onClick: () => BD.update(boardId, (x) => ({ fav: !x.fav || undefined })) },
      { label: t('canvas.duplicateBoard'), icon: 'copy', onClick: async () => { flush(); await BD.duplicate(boardId, M.freshName(BD.all(), t('canvas.copyName', { name: b.name || t('canvas.untitled') }))); toast(t('canvas.duplicated')); } },
      '-',
      { label: t('canvas.showGrid'), icon: 'cv-grid', checked: !!b.grid, onClick: () => { BD.update(boardId, (x) => ({ grid: !x.grid || undefined })); rec = BD.byId(boardId); schedule(); } },
      { label: t('canvas.snapGrid'), icon: 'cv-snap', checked: !!(b.grid && b.snap), onClick: () => { BD.update(boardId, (x) => (x.grid && x.snap ? { snap: undefined } : { grid: true, snap: true })); rec = BD.byId(boardId); schedule(); } },
      { label: t('canvas.connPoints'), icon: 'cv-connector', checked: prefs().conn !== false, onClick: () => { setPref('conn', prefs().conn === false); shownSel = ''; schedule(); } },
      '-',
      { label: t('canvas.selectAll'), icon: 'checkCircle', onClick: selectAll },
      { label: t('canvas.paste'), icon: 'cv-paste', onClick: pasteMenu },
      { label: t('canvas.addScene'), icon: 'cv-scenes', onClick: addScene },
      '-',
      { label: t('canvas.toRecycle'), icon: 'trash', danger: true, onClick: async () => {
        if (!(await confirm(t('canvas.deleteBoardQ'), t('canvas.deleteBoardMsg'), { okLabel: t('common.delete'), danger: true }))) return;
        leaving = true; flush(); BD.trash(boardId); toast(t('canvas.movedToBin')); onBack?.();
      } },
    ], { align: 'end' });
  }
  function zoomMenu(anchor) {
    const pct = Math.round(view.z * 100);
    menu(anchor, [
      { label: t('canvas.zoomFit'), icon: 'cv-fit', onClick: () => zoomToFit() },
      { label: t('canvas.actualSize'), onClick: () => zoomCenter(1) },
      '-',
      ...[25, 50, 75, 100, 150, 200, 400].map((p) => ({ label: `${p}%`, checked: p === pct, onClick: () => zoomCenter(p / 100) })),
    ]);
  }
  /** The ⋮ of the selection toolbar: everything you can do with the selection. */
  function selMenu(at) {
    const its = selItems(), locked = its.length && its.every((i) => i.lk), grouped = its.some((i) => i.g), n = unlockedSel().length;
    menu(at, tidy([
      !locked && { label: t('canvas.cut'), icon: 'cv-cut', onClick: () => cut() },
      { label: t('canvas.copy'), icon: 'copy', onClick: () => copy() },
      { label: t('canvas.copyImage'), icon: 'image', onClick: copyImage },
      { label: t('canvas.saveSelImage'), icon: 'download', onClick: () => exportPNG(true) },
      '-',
      { label: locked ? t('canvas.unlock') : t('canvas.lock'), icon: locked ? 'unlock' : 'lock', onClick: () => setLock(!locked) },
      n > 1 && !grouped && { label: t('canvas.group'), icon: 'cv-group', onClick: group },
      grouped && !locked && { label: t('canvas.ungroup'), icon: 'cv-ungroup', onClick: ungroup },
      n > 1 && { label: t('canvas.align'), icon: 'cv-align', onClick: () => setTimeout(() => alignMenu(at), 180) },
      '-',
      !locked && { label: t('canvas.toFront'), icon: 'cv-front', onClick: () => arrange('front') },
      !locked && { label: t('canvas.forward'), onClick: () => arrange('fwd') },
      !locked && { label: t('canvas.backward'), onClick: () => arrange('bwd') },
      !locked && { label: t('canvas.toBack'), icon: 'cv-back', onClick: () => arrange('back') },
    ]));
  }
  function alignMenu(at) {
    menu(at, [
      { label: t('canvas.alignLeft'), onClick: () => align('l') }, { label: t('canvas.alignHCenter'), onClick: () => align('c') }, { label: t('canvas.alignRight'), onClick: () => align('r') },
      '-',
      { label: t('canvas.alignTop'), onClick: () => align('t') }, { label: t('canvas.alignMiddle'), onClick: () => align('m') }, { label: t('canvas.alignBottom'), onClick: () => align('b') },
      '-',
      { label: t('canvas.distH'), onClick: () => align('dh') }, { label: t('canvas.distV'), onClick: () => align('dv') },
    ]);
  }
  root.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tool]');
    if (tb && root.contains(tb)) { pickTool(tb); return; }
    const b = e.target.closest('[data-a]');
    if (!b || !root.contains(b) || b.closest('.cv-fmt')) return;
    const a = b.dataset.a;
    if (editing) stopEdit();
    switch (a) {
      case 'note': insertNote(); break;
      case 'shape': openShapes(b); break;
      case 'text': insertText(); break;
      case 'line': linePicker(b, addLine); break;
      case 'photo': pickImages(); break;
      case 'link': addLink(); break;
      case 'insert': insertMenu(b); break;
      case 'zoom': zoomMenu(b); break;
      case 'zin': zoomCenter(view.z * 1.25); break;
      case 'zout': zoomCenter(view.z / 1.25); break;
      case 'fit': zoomToFit(); break;
      case 'scenes': scenesPop(b, sceneApi); break;
      case 'prev': goScene(curScene <= 0 ? scenes.length - 1 : curScene - 1); break;
      case 'next': goScene(curScene < 0 || curScene >= scenes.length - 1 ? 0 : curScene + 1); break;
    }
  });
  // a tap on the selected tool shows its settings; so does a right-click or long press
  toolsEl.addEventListener('contextmenu', (e) => {
    const tb = e.target.closest('[data-tool]');
    if (!tb) return;
    e.preventDefault();
    if (['pen', 'hl', 'eraser'].includes(tb.dataset.tool)) { if (toolOf() !== tb.dataset.tool) pickTool(tb); toolSettings(tb, tb.dataset.tool); }
  });
  viewEl.addEventListener('dblclick', (e) => {
    if (mode === 'draw' || e.target.closest('.cv-fmt')) return;
    const [wx, wy] = toW(e.clientX, e.clientY);
    const id = e.target.closest('.cv-it')?.dataset.id || hitThin(wx, wy);
    const it = id && byId.get(id);
    if (!it) { if (mode === 'select' && !e.target.closest('.cv-sel *')) insertText([wx, wy - 17]); return; }
    if (it.g && sel.size > 1) { select([id]); return; } // into a group: just this item
    if (M.TEXT_TYPES.has(it.t) && !it.lk) startEdit(id, { at: [e.clientX, e.clientY] });
    else if (it.t === 'link') window.open(it.u, '_blank', 'noopener');
  });
  viewEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (mode === 'draw' || e.target.closest('.cv-fmt')) return;
    if (editing) stopEdit();
    const [wx, wy] = toW(e.clientX, e.clientY);
    const id = e.target.closest('.cv-it')?.dataset.id || hitThin(wx, wy);
    if (id && byId.has(id)) { if (!sel.has(id)) select(groupIds(id)); selMenu(pt(e)); return; }
    clearSel();
    menu(pt(e), [
      { label: t('canvas.paste'), icon: 'cv-paste', onClick: pasteMenu },
      { label: t('canvas.selectAll'), icon: 'checkCircle', onClick: selectAll },
      '-',
      { label: t('canvas.addNote'), icon: 'cv-sticky', onClick: () => insertNote([wx, wy]) },
      { label: t('canvas.addText'), icon: 'cv-text', onClick: () => insertText([wx, wy]) },
      '-',
      { label: t('canvas.zoomFit'), icon: 'cv-fit', onClick: () => zoomToFit() },
    ]);
  });
  // pictures dropped onto the board land where they're dropped
  viewEl.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; root.classList.add('drop'); } });
  viewEl.addEventListener('dragleave', (e) => { if (e.target === viewEl) root.classList.remove('drop'); });
  viewEl.addEventListener('drop', (e) => {
    root.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    insertImages(files, toW(e.clientX, e.clientY));
  });

  // ---------------------------------------------------------------- keyboard
  const active = () => !closed && root.isConnected && currentApp() === 'canvas' && !root.closest('.app-page.behind') && !document.querySelector('.ou-menu-scrim, .ou-dialog-scrim, .cv-pop') && !isLocked();
  function onKey(e) {
    if (!active()) return;
    const go = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    // Escape steps back one level: typing, then the pen, then the selection; after that it leaves the board
    if (e.key === 'Escape') {
      if (editing) return go(stopEdit);
      if (drag) return go(cancelDrag);
      if (mode !== 'select') return go(() => setMode('select'));
      if (sel.size) return go(clearSel);
      return;
    }
    if (editing || e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const mod = isMac ? e.metaKey : e.ctrlKey, k = e.code;
    if (e.key === ' ' && !mod) { if (!space) { space = true; root.classList.add('space'); } e.preventDefault(); return; }
    if (mod) {
      if (k === 'KeyZ') return go(e.shiftKey ? doRedo : doUndo);
      if (k === 'KeyY' && !isMac) return go(doRedo);
      if (k === 'KeyA') return go(selectAll);
      if (k === 'KeyD') return go(() => duplicate());
      if (k === 'KeyG') return go(e.shiftKey ? ungroup : group);
      if (k === 'KeyL') return go(() => setLock(!selItems().every((i) => i.lk)));
      if (k === 'KeyF' && e.shiftKey) return go(() => arrange('front'));
      if (k === 'KeyB' && e.shiftKey) return go(() => arrange('back'));
      if (k === 'KeyF' && e.altKey) return go(() => arrange('fwd'));
      if (k === 'KeyB' && e.altKey) return go(() => arrange('bwd'));
      if (k === 'Equal' || k === 'NumpadAdd') return go(() => zoomCenter(view.z * 1.25));
      if (k === 'Minus' || k === 'NumpadSubtract') return go(() => zoomCenter(view.z / 1.25));
      if (k === 'Digit0' || k === 'Numpad0') return go(() => zoomCenter(1));
      if (k === 'KeyS') return go(() => exportPNG());
      if (k === 'KeyC' || k === 'KeyX') { if (sel.size) { e.preventDefault(); if (!document.execCommand(k === 'KeyC' ? 'copy' : 'cut')) (k === 'KeyC' ? copy : cut)(); } return; }
      if (k === 'KeyV') { clearTimeout(pasteWait); pasteWait = setTimeout(() => { pasteWait = 0; pasteClip(readClip()); }, 250); return; } // the paste event normally comes first
      if (k === 'KeyP') return go(print);
      return;
    }
    if (e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') return go(del);
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') return go(() => nudge(-step, 0));
    if (e.key === 'ArrowRight') return go(() => nudge(step, 0));
    if (e.key === 'ArrowUp') return go(() => nudge(0, -step));
    if (e.key === 'ArrowDown') return go(() => nudge(0, step));
    if (e.key === 'Enter') { const one = selItems(); if (one.length === 1 && M.TEXT_TYPES.has(one[0].t)) return go(() => startEdit(one[0].id, { all: true })); return; }
    if (e.key === '+' || e.key === '=') return go(() => zoomCenter(view.z * 1.25));
    if (e.key === '-') return go(() => zoomCenter(view.z / 1.25));
    if (e.key === '0') return go(() => zoomCenter(1));
    if (e.key === '1' || e.key === '!') return go(() => zoomToFit());
    if (e.shiftKey) return;
    const btn = (s) => $(s, root);
    const L = {
      KeyV: () => setMode('select'), KeyL: () => setMode('lasso'), KeyP: () => setMode('draw', ink.pen), KeyH: () => setMode('draw', 'hl'), KeyE: () => setMode('draw', 'eraser'),
      KeyN: () => insertNote(), KeyT: () => insertText(), KeyS: () => openShapes(btn(root.classList.contains('narrow') ? '[data-a="insert"]' : '[data-a="shape"]')),
      KeyC: () => linePicker(btn(root.classList.contains('narrow') ? '[data-a="insert"]' : '[data-a="line"]'), addLine), KeyI: pickImages, KeyK: addLink,
      KeyG: () => { BD.update(boardId, (x) => ({ grid: !x.grid || undefined })); rec = BD.byId(boardId); schedule(); },
    };
    if (L[k]) return go(L[k]);
  }
  function onKeyUp(e) { if (e.key === ' ' && space) { space = false; root.classList.remove('space'); } }
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKeyUp);
  document.addEventListener('paste', onPaste);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  const onBlurWin = () => { space = false; root.classList.remove('space'); };
  addEventListener('blur', onBlurWin);

  // ---------------------------------------------------------------- other tabs
  const offStore = store.on(BD.KEY, () => {
    if (closed) return;
    const b = BD.byId(boardId);
    if (!b || b.deleted) { if (!leaving) { leaving = true; onBack?.(); } return; }
    rec = b;
    // another tab saved this board: take its version when there's nothing unsaved here
    if (b.at > savedAt && !dirty && !drag && !editing) {
      savedAt = b.at; items = M.normBoards([b])[0].items; scenes = b.scenes || []; undo = []; redo = []; index();
    }
    syncBars(); schedule();
  });
  const offPrefs = store.on('canvasPrefs', () => { shownSel = ''; schedule(); });

  // ---------------------------------------------------------------- the API used by the selection toolbar and scenes
  const api = {
    get items() { return items; }, byId: (id) => byId.get(id), selItems,
    patchSel, checkpoint, startEdit, stopEdit, selMenu, alignMenu, replaceImage, duplicate: () => duplicate(), del, setLock,
    pref: setPref,
    openLink: (it) => window.open(it.u, '_blank', 'noopener'),
    editLink: async (it) => { const r = await linkDialog(it); if (r) { checkpoint(); patch(new Map([[it.id, { u: r.u, tx: r.tx || undefined }]])); } },
  };
  const sceneApi = {
    get scenes() { return scenes; }, get items() { return items; }, get cur() { return curScene; },
    add: addScene, go: goScene, set: setScenes,
    update: (i) => {
      const v = visibleRect();
      setScenes(scenes.map((s, k) => (k === i ? { ...s, x: M.r1(v.x), y: M.r1(v.y), w: M.r1(v.w), h: M.r1(v.h) } : s)));
      toast(t('canvas.sceneUpdated'));
    },
  };

  // ---------------------------------------------------------------- start
  BD.update(boardId, () => ({ opened: Date.now() }));
  rec = BD.byId(boardId);
  savedAt = rec.at;
  syncBars();
  setTimeout(() => { if (!closed && (document.activeElement === document.body || !document.activeElement || page?.el.contains(document.activeElement) === false)) viewEl.focus({ preventScroll: true }); }, 60);

  const inst = {
    id: boardId,
    get state() { return { items, scenes, view, sel: [...sel], mode, tool, undo: undo.length, redo: redo.length, editing: editing?.id || null }; },
    screen: (wx, wy) => { const r = viewEl.getBoundingClientRect(), [x, y] = toS(wx, wy); return [r.left + x, r.top + y]; },
    close() {
      if (closed) return;
      if (editing) stopEdit();
      const wasDirty = dirty;
      if (!leaving || BD.byId(boardId)) flush();
      closed = true;
      if (current === inst) current = null;
      cancelAnimationFrame(raf); cancelAnimationFrame(anim);
      const b = BD.byId(boardId);
      if (b && !b.deleted && (wasDirty || (!b.thumb && items.length))) thumbs();
      ro.disconnect(); offStore(); offPrefs(); closePops(); closeMenus();
      removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlurWin);
      document.removeEventListener('paste', onPaste); document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut);
      host.innerHTML = '';
    },
    flush: () => flush(),
    thumbs,
  };
  current = inst;
  return inst;
}

// the pen types in the pen settings, drawn like Samsung Notes' pen picker: a body with a tip in the ink colour
function penSVG(k) {
  const body = 'var(--cv-pen)', edge = 'var(--cv-pen-edge)', c = 'var(--cv-pen-tip)';
  const S = {
    pen: `<path d="M7 62V24l6-18 6 18v38z" fill="${body}" stroke="${edge}"/><path d="M10.6 13.4 13 6l2.4 7.4z" fill="${c}"/><rect x="7.5" y="36" width="11" height="3" fill="${c}"/>`,
    pencil: `<path d="M7 62V22l6-18 6 18v40z" fill="${body}" stroke="${edge}"/><path d="M7.5 22 13 5.5 18.5 22z" fill="#e9cfa6"/><path d="M11.2 10.7 13 5.5l1.8 5.2z" fill="${c}"/>`,
    cal: `<path d="M7 62V26l4-8h4l4 8v36z" fill="${body}" stroke="${edge}"/><path d="M11 18 9 6l8 2-2 10z" fill="${c}"/><rect x="7.5" y="38" width="11" height="3" fill="${c}"/>`,
    marker: `<path d="M5 62V27l3-6h10l3 6v35z" fill="${body}" stroke="${edge}"/><path d="M8.5 21v-8.5l9-3.5v12z" fill="${c}"/><rect x="5.5" y="38" width="15" height="3" fill="${c}"/>`,
  };
  return `<svg viewBox="0 0 26 64" width="26" height="64" aria-hidden="true">${S[k]}</svg>`;
}
