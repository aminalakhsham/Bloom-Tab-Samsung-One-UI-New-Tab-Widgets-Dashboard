// Drawings in Samsung Notes: a sheet of paper with Samsung's floating pen toolbar — pen types (pen, pencil,
// calligraphy pen, marker; tap the pen again for its settings), highlighter, eraser (by area), the pen colours, Undo,
// Redo and Clear. Strokes are drawn with Canvas's ink engine (js/canvas/ink.js: pressure, the slanted calligraphy nib),
// imported, not copied. Done gives a PNG cropped to the drawing plus the strokes as JSON, so it opens again for more
// editing. "Auto" ink is black; in dark mode the picture is shown inverted (notes.css), as Samsung shows black ink.
import { h } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import { TOOLS, PENS, INK_COLORS, HL_COLORS, makeInk, inkPath, inkAlpha, eraseSplit } from '../canvas/ink.js';

addIcons({
  ntSkPen: '<path d="m14.5 5.5 4 4L9 19H5v-4Z"/><path d="m12.5 7.5 4 4"/>',
  ntSkHl: '<path d="m9 15 7.6-7.6a2 2 0 0 1 2.8 2.8L11.8 17.8"/><path d="M9 15 7.2 19.8l4.6-2Z"/><path d="M4 21h8" stroke-width="2.6"/>',
  ntSkEraser: '<path d="m4.6 15.4 9.2-9.2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.2Z"/><path d="M10 10l6 6M8.2 19H20"/>',
  ntSkClear: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
});

const W = 1200, H = 760;
const AUTO = '#1b1b1f';
let last = { pen: 'pen', col: 'auto', hl: HL_COLORS[0], sz: {} };

function paint(g, items, k = 1) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  for (const it of items) {
    const { d, fill } = inkPath(it);
    if (!d) continue;
    g.save();
    g.scale(k, k);
    g.translate(it.x, it.y);
    g.globalAlpha = inkAlpha(it);
    const p = new Path2D(d);
    const col = it.col === 'auto' ? AUTO : it.col;
    if (fill) {
      g.fillStyle = col;
      g.fill(p);
    } else {
      g.strokeStyle = col;
      g.lineWidth = it.sz;
      g.lineCap = it.tool === 'hl' ? 'butt' : 'round';
      g.lineJoin = 'round';
      g.stroke(p);
    }
    g.restore();
  }
}

/** Opens the drawing sheet (with the strokes of an earlier drawing). Resolves { png, vector } (Blobs) or null. */
export async function openSketch(vectorBlob) {
  let items = [];
  try {
    if (vectorBlob) items = JSON.parse(await vectorBlob.text()).items || [];
  } catch {}
  const redo = [];
  let tool = last.pen, cur = null;
  const size = (tl) => last.sz[tl] ?? TOOLS[tl].def;
  const colOf = (tl) => (tl === 'hl' ? last.hl : last.col);

  const cv = h('canvas', { class: 'nt-sk-canvas', width: W, height: H, 'aria-label': t('notes.drawing') });
  const g = cv.getContext('2d');
  const redraw = () => {
    paint(g, cur?.live ? [...items, cur.live] : items);
    undoB.disabled = !undoStack.length;
    clearB.disabled = !items.length;
    redoB.disabled = !redo.length;
  };
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5];
  };
  const eraseAt = ([x, y]) => {
    const r = 14;
    let changed = false;
    const next = [];
    for (const it of items) {
      const res = eraseSplit(it, x, y, r);
      if (res == null) next.push(it);
      else {
        changed = true;
        next.push(...res);
      }
    }
    if (changed) items = next;
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // drawing closes the pen settings pop-up, as tapping outside it does on the phone
    if (!settings.hidden) {
      settings.hidden = true;
      sync();
    }
    cv.setPointerCapture(e.pointerId);
    redo.length = 0;
    if (tool === 'eraser') {
      cur = { erase: true, before: items };
      eraseAt(pt(e));
    } else cur = { tool: tool === 'pen' ? last.pen : tool, pts: [pt(e)] };
    redraw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) {
      if (cur.erase) eraseAt(pt(ev));
      else cur.pts.push(pt(ev));
    }
    if (!cur.erase) cur.live = makeInk(cur.tool, colOf(cur.tool), size(cur.tool), cur.pts, false);
    redraw();
  });
  const up = () => {
    if (!cur) return;
    if (cur.erase) {
      if (cur.before !== items) undoStack.push(cur.before);
    } else {
      const it = makeInk(cur.tool, colOf(cur.tool), size(cur.tool), cur.pts);
      undoStack.push(items);
      items = [...items, it];
    }
    cur = null;
    redraw();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  // every change keeps the list before it, so erasing undoes like drawing
  const undoStack = [];

  const tb = (k, ic, label, fn) => h('button', { type: 'button', class: 'nt-sk-tool', dataset: { tool: k }, title: label, 'aria-label': label, html: icon(ic, 22), onClick: fn });
  const penB = tb('pen', 'ntSkPen', t('notes.pen'), () => pick('pen'));
  const hlB = tb('hl', 'ntSkHl', t('notes.highlighter'), () => pick('hl'));
  const erB = tb('eraser', 'ntSkEraser', t('notes.eraser'), () => pick('eraser'));
  const undoB = tb('undo', 'ntUndo', t('common.undo'), () => {
    if (!undoStack.length) return;
    redo.push(items);
    items = undoStack.pop();
    redraw();
  });
  const redoB = tb('redo', 'ntRedo', t('notes.redo'), () => {
    if (!redo.length) return;
    undoStack.push(items);
    items = redo.pop();
    redraw();
  });
  const clearB = tb('clear', 'ntSkClear', t('notes.clear'), () => {
    if (!items.length) return;
    undoStack.push(items);
    items = [];
    redraw();
  });
  const swatches = h('div', { class: 'nt-sk-cols' });
  const settings = h('div', { class: 'nt-sk-settings', hidden: true });
  const penNames = { pen: t('notes.pen'), pencil: t('notes.pencil'), cal: t('notes.calligraphy'), marker: t('notes.marker') };
  function pick(k) {
    // tapping the pen in hand again opens its settings, as in Samsung Notes
    if (k === tool && k !== 'eraser') settings.hidden = !settings.hidden;
    else settings.hidden = true;
    tool = k;
    sync();
  }
  function sync() {
    for (const b of [penB, hlB, erB]) b.classList.toggle('on', b.dataset.tool === tool);
    penB.style.setProperty('--tip', last.col === 'auto' ? 'var(--text)' : last.col);
    hlB.style.setProperty('--tip', last.hl);
    const list = tool === 'hl' ? HL_COLORS : INK_COLORS.slice(0, 7);
    swatches.hidden = tool === 'eraser';
    swatches.replaceChildren(...list.map((c) => h('button', {
      type: 'button',
      class: ['nt-sk-col', c === 'auto' && 'auto', c === colOf(tool === 'hl' ? 'hl' : 'pen') && 'on'],
      style: c === 'auto' ? null : { '--c': c },
      title: c === 'auto' ? t('notes.c.auto') : c,
      'aria-label': c === 'auto' ? t('notes.c.auto') : c,
      onClick: () => {
        if (tool === 'hl') last.hl = c;
        else {
          last.col = c;
          if (tool === 'eraser') tool = 'pen';
        }
        sync();
      },
    })));
    const tl = tool === 'pen' ? last.pen : tool;
    if (!settings.hidden && TOOLS[tl]) {
      const T = TOOLS[tl];
      const val = h('b', null, String(Math.round(size(tl))));
      const range = h('input', { type: 'range', min: T.min, max: T.max, step: 0.5, value: size(tl), 'aria-label': t('notes.thickness'), onInput: () => { last.sz[tl] = +range.value; val.textContent = String(Math.round(+range.value)); } });
      settings.replaceChildren(...[
        tool === 'pen' ? h('div', { class: 'nt-sk-types', role: 'radiogroup' }, PENS.map((p) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(last.pen === p), class: ['nt-sk-type', last.pen === p && 'on'], dataset: { pen: p },
          onClick: () => { last.pen = p; sync(); },
        }, h('i', { class: 'nt-sk-nib nib-' + p }), h('span', null, penNames[p])))) : null,
        h('div', { class: 'nt-sk-thick' }, h('span', null, t('notes.thickness')), val),
        range].filter(Boolean));
    }
    redraw();
  }
  sync();

  const sheet = h('div', { class: 'nt-sk' },
    h('div', { class: 'nt-sk-bar', role: 'toolbar', 'aria-label': t('notes.drawing') }, penB, hlB, erB, h('span', { class: 'nt-sk-sep' }), swatches, h('span', { class: 'nt-sk-sep' }), undoB, redoB, clearB),
    settings,
    h('div', { class: 'nt-sk-paper' }, cv));
  const ok = await dialog({
    title: t('notes.drawing'),
    className: 'nt-sk-dlg',
    content: sheet,
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }],
  });
  if (!ok || !items.length) return null;
  // crop to the drawing (with a margin) so it sits naturally in the note
  paint(g, items);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < x0) return null;
  const m = 24;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  const png = await new Promise((r) => out.toBlob(r, 'image/png'));
  return { png, vector: new Blob([JSON.stringify({ w: W, h: H, items })], { type: 'application/json' }) };
}
