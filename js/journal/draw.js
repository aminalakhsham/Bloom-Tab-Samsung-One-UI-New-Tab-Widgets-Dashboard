// Drawing for journal entries (Samsung Notes' pen, kept small): pen colours and sizes, an eraser, undo and clear on a
// 4:3 sheet. The strokes are kept as JSON next to the PNG, so a drawing opens again for more editing.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';

const W = 960, H = 720;
const COLORS = ['#1b1b22', '#e5484d', '#ff8a3d', '#f5c400', '#22a356', '#3e7bff', '#7b61ff'];
const SIZES = [3, 7, 14];

function paint(g, strokes, scale = 1) {
  g.save();
  g.scale(scale, scale);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of strokes) {
    const p = s.p;
    if (!p.length) continue;
    g.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    g.strokeStyle = s.c;
    g.fillStyle = s.c;
    g.lineWidth = s.w;
    if (p.length === 1) {
      g.beginPath();
      g.arc(p[0][0], p[0][1], s.w / 2, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    // smooth through the midpoints, so fast strokes stay round
    g.beginPath();
    g.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    g.lineTo(p.at(-1)[0], p.at(-1)[1]);
    g.stroke();
  }
  g.restore();
}

/** Opens the drawing sheet with earlier strokes (or none). Resolves { png: Blob, vector: Blob } or null. */
export async function drawDialog(strokes = []) {
  strokes = Array.isArray(strokes) ? strokes.slice() : [];
  let color = COLORS[0], size = SIZES[1], eraser = false, cur = null;
  const canvas = h('canvas', { class: 'jr-draw-canvas', width: W, height: H, 'aria-label': t('journal.drawing') });
  const g = canvas.getContext('2d');
  const redraw = () => {
    g.clearRect(0, 0, W, H);
    paint(g, strokes);
    undoBtn.disabled = clearBtn.disabled = !strokes.length;
  };
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * H * 10) / 10];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    cur = { c: color, w: eraser ? size * 3 : size, e: eraser || undefined, p: [pt(e)] };
    strokes.push(cur);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) cur.p.push(pt(ev));
    redraw();
  });
  const end = () => (cur = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const colorBtns = COLORS.map((c) => h('button', { class: 'jr-draw-color', style: { '--c': c }, 'aria-label': c, onClick: () => { color = c; eraser = false; sync(); } }));
  const sizeBtns = SIZES.map((s) => h('button', { class: 'jr-draw-size', 'aria-label': String(s), onClick: () => { size = s; sync(); } }, h('i', { style: { width: s + 4 + 'px', height: s + 4 + 'px' } })));
  const eraseBtn = h('button', { class: 'jr-draw-tool', title: t('journal.eraser'), 'aria-label': t('journal.eraser'), html: icon('jr-eraser', 20), onClick: () => { eraser = !eraser; sync(); } });
  const undoBtn = h('button', { class: 'jr-draw-tool', title: t('journal.undo'), 'aria-label': t('journal.undo'), html: icon('jr-undo', 20), onClick: () => { strokes.pop(); redraw(); } });
  const clearBtn = h('button', { class: 'jr-draw-tool', title: t('journal.clear'), 'aria-label': t('journal.clear'), html: icon('trash', 20), onClick: () => { strokes = []; redraw(); } });
  const sync = () => {
    colorBtns.forEach((b, i) => b.classList.toggle('on', !eraser && COLORS[i] === color));
    sizeBtns.forEach((b, i) => b.classList.toggle('on', SIZES[i] === size));
    eraseBtn.classList.toggle('on', eraser);
    sizeBtns.forEach((b) => b.style.setProperty('--c', eraser ? 'var(--text-3)' : color));
  };
  sync();
  redraw();

  const ok = await dialog({
    title: t('journal.drawing'),
    className: 'jr-draw-dlg',
    content: h('div', { class: 'jr-draw' },
      h('div', { class: 'jr-draw-sheet' }, canvas),
      h('div', { class: 'jr-draw-tools' }, h('div', { class: 'jr-draw-colors' }, colorBtns), h('div', { class: 'jr-draw-sizes' }, sizeBtns), h('span', { class: 'jr-draw-sep' }), eraseBtn, undoBtn, clearBtn)),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }],
  });
  if (!ok || !strokes.length) return null;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  paint(out.getContext('2d'), strokes);
  const png = await new Promise((r) => out.toBlob(r, 'image/png'));
  return { png, vector: new Blob([JSON.stringify(strokes)], { type: 'application/json' }) };
}

/** Reads the strokes saved next to a drawing. */
export async function readStrokes(blob) {
  try {
    const v = JSON.parse(await blob.text());
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
