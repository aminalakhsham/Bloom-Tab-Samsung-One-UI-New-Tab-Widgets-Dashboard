// Drawing on a Canvas board: the pen types of Samsung Notes (pen, pencil, calligraphy pen, marker, highlighter),
// turning a stroke's points into an SVG path (the pens follow a stylus' pressure, the calligraphy nib is slanted),
// the two erasers (by stroke removes whole strokes, by area cuts a stroke where it passes and keeps the pieces) and
// Auto shape, which turns a rough circle, box, triangle or line into a clean one. Pure logic, no DOM.
import { uid, rotPt, r1, segDist } from './model.js';

// sizes are board units; `def` is where the thickness slider starts
export const TOOLS = {
  pen: { min: 1, max: 16, def: 3, alpha: 1, pressure: true },
  pencil: { min: 1, max: 12, def: 2.5, alpha: 0.85, pressure: true, grain: true },
  cal: { min: 2, max: 24, def: 6, alpha: 1, pressure: true, nib: true },
  marker: { min: 2, max: 30, def: 8, alpha: 0.92 },
  hl: { min: 8, max: 48, def: 22, alpha: 0.38, flat: true },
};
export const PENS = ['pen', 'pencil', 'cal', 'marker'];
// Samsung's pen palette (auto = black, or white on a dark board) and the highlighter's
export const INK_COLORS = ['auto', '#8e8e93', '#ef3e36', '#ff8a00', '#ffc400', '#38b34a', '#1f8bff', '#5b4dff', '#b24ce0', '#ff5fa2', '#8b5a3c', '#00b2a9'];
export const HL_COLORS = ['#ffe600', '#7ff05a', '#5ad8ff', '#ff86df', '#ffad4a', '#c79bff'];
const f = (v) => r1(v);

/** Light smoothing of hand jitter (the ends stay where the stroke really started and stopped). */
function smooth(P) {
  if (P.length < 4) return P;
  return P.map((p, i) => (i === 0 || i === P.length - 1 ? p : [(P[i - 1][0] + p[0] * 2 + P[i + 1][0]) / 4, (P[i - 1][1] + p[1] * 2 + P[i + 1][1]) / 4, p[2]]));
}
export const triples = (p) => {
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2] ?? 0.5]);
  return out;
};

/** A filled outline whose width follows the pressure (pen, pencil) and, for the calligraphy pen, the direction. */
function outline(P, size, nib) {
  const n = P.length;
  const dirs = P.map((_, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
  const rad = (i) => {
    const taper = Math.min(1, 0.55 + 0.15 * Math.min(i, n - 1 - i));
    // a nib held at 45°: strokes along it are thin, strokes across it are wide
    const slant = nib ? 0.18 + 0.82 * Math.abs(Math.sin(dirs[i] - Math.PI / 4)) : 1;
    return Math.max(0.3, (size / 2) * (0.35 + (P[i][2] ?? 0.5) * 1.3) * (nib ? 1 : taper) * slant);
  };
  if (n === 1 || P.every((p) => Math.hypot(p[0] - P[0][0], p[1] - P[0][1]) < 0.2)) {
    const r = rad(0) * 1.2, [x, y] = P[0];
    return `M${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 1 ${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 1 ${f(x + r)} ${f(y)}Z`;
  }
  const L = [], R = [];
  let nx = 0, ny = 1;
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l > 1e-6) { nx = -dy / l; ny = dx / l; }
    const r = rad(i);
    L.push([P[i][0] + nx * r, P[i][1] + ny * r]); R.push([P[i][0] - nx * r, P[i][1] - ny * r]);
  }
  const side = (S) => {
    let d = '';
    for (let i = 1; i < S.length - 1; i++) d += `Q${f(S[i][0])} ${f(S[i][1])} ${f((S[i][0] + S[i + 1][0]) / 2)} ${f((S[i][1] + S[i + 1][1]) / 2)}`;
    return d + `L${f(S.at(-1)[0])} ${f(S.at(-1)[1])}`;
  };
  const re = rad(n - 1), rs = rad(0);
  const Rr = R.slice().reverse();
  return `M${f(L[0][0])} ${f(L[0][1])}${side(L)}A${f(re)} ${f(re)} 0 0 0 ${f(Rr[0][0])} ${f(Rr[0][1])}${side(Rr)}A${f(rs)} ${f(rs)} 0 0 0 ${f(L[0][0])} ${f(L[0][1])}Z`;
}
/** The centre line of a stroke of even width: the marker and the highlighter. */
function centre(P) {
  if (P.length === 1) return `M${f(P[0][0])} ${f(P[0][1])}L${f(P[0][0] + 0.1)} ${f(P[0][1] + 0.1)}`;
  let d = `M${f(P[0][0])} ${f(P[0][1])}`;
  for (let i = 1; i < P.length - 1; i++) d += `Q${f(P[i][0])} ${f(P[i][1])} ${f((P[i][0] + P[i + 1][0]) / 2)} ${f((P[i][1] + P[i + 1][1]) / 2)}`;
  return d + `L${f(P.at(-1)[0])} ${f(P.at(-1)[1])}`;
}
const cache = new WeakMap();
/** How to draw an ink item in its own iw × ih box: { d, fill } (fill = an outline to fill, else a line to stroke). */
export function inkPath(it) {
  let c = cache.get(it.p);
  if (!c || c.tool !== it.tool || c.sz !== it.sz) {
    const T = TOOLS[it.tool] || TOOLS.pen, P = smooth(triples(it.p || []));
    c = { tool: it.tool, sz: it.sz, fill: !!T.pressure, d: P.length ? (T.pressure ? outline(P, it.sz, T.nib) : centre(P)) : '' };
    if (it.p) cache.set(it.p, c);
  }
  return c;
}
export const inkAlpha = (it) => (TOOLS[it.tool] || TOOLS.pen).alpha;

// Ramer–Douglas–Peucker: drops points that add nothing, so long drawings stay small in storage
export function simplify(P, tol, withPressure = true) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(P[i][0], P[i][1], P[a], P[b]) + (withPressure ? Math.abs((P[i][2] ?? 0.5) - ((P[a][2] ?? 0.5) + (P[b][2] ?? 0.5)) / 2) * 2 : 0);
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
/** A new ink item from points in board units ([[x, y, pressure], …]). */
export function makeInk(tool, col, sz, P, simplifyIt = true) {
  if (simplifyIt) P = simplify(P, 0.3);
  const pad = sz * 1.1 + 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const p = [];
  for (const [x, y, pr] of P) p.push(f(x - x0), f(y - y0), Math.round((pr ?? 0.5) * 100) / 100);
  const w = f(x1 - x0), h = f(y1 - y0);
  return { id: uid('i'), t: 'ink', x: f(x0), y: f(y0), w, h, iw: w, ih: h, tool, col, sz: f(sz), p };
}
/** Board point → the item's own drawing coordinates (undoing its rotation and resizing). */
export function toLocal(it, x, y) {
  const [ux, uy] = rotPt(x, y, it.x + it.w / 2, it.y + it.h / 2, -(it.r || 0));
  return [((ux - it.x) * (it.iw || it.w)) / it.w, ((uy - it.y) * (it.ih || it.h)) / it.h];
}
export function toWorld(it, lx, ly) {
  return rotPt(it.x + (lx * it.w) / (it.iw || it.w), it.y + (ly * it.h) / (it.ih || it.h), it.x + it.w / 2, it.y + it.h / 2, it.r || 0);
}
/** A stroke's points on the board (for the lasso). */
export const worldPoints = (it, step = 1) => triples(it.p || []).filter((_, i) => i % step === 0).map(([x, y]) => toWorld(it, x, y));
const localScale = (it) => ((it.iw || it.w) / it.w + (it.ih || it.h) / it.h) / 2;
/** True when the point is within r of the stroke (erasing by stroke and clicking a thin line use this). */
export function hitInk(it, x, y, r) {
  const [lx, ly] = toLocal(it, x, y), P = triples(it.p || []), rr = r * localScale(it) + it.sz / 2;
  if (P.length === 1) return Math.hypot(lx - P[0][0], ly - P[0][1]) <= rr;
  for (let i = 1; i < P.length; i++) if (segDist(lx, ly, P[i - 1], P[i]) <= rr) return true;
  return false;
}
/** Erase by area: null when the stroke isn't touched, else the pieces left (new items, maybe none). */
export function eraseSplit(it, x, y, r) {
  if (!hitInk(it, x, y, r)) return null;
  const [lx, ly] = toLocal(it, x, y), sc = localScale(it), rr = r * sc + it.sz * 0.3;
  // long straight runs keep few points, so they get extra ones first: the cut lands where the eraser passed
  const P = [], src = triples(it.p || []), step = Math.max(0.5, rr / 2);
  src.forEach((p, i) => {
    if (i) {
      const q = src[i - 1], l = Math.hypot(p[0] - q[0], p[1] - q[1]);
      for (let k = 1; k * step < l; k++) { const u = (k * step) / l; P.push([q[0] + (p[0] - q[0]) * u, q[1] + (p[1] - q[1]) * u, q[2] + (p[2] - q[2]) * u]); }
    }
    P.push(p);
  });
  const runs = [];
  let cur = [];
  for (const p of P) {
    if (Math.hypot(p[0] - lx, p[1] - ly) <= rr) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) runs.push(cur);
  const scale = 1 / sc;
  return runs.filter((run) => run.length > 1).map((run) => {
    const W = run.map(([px, py, pr]) => [...toWorld(it, px, py), pr]);
    const o = makeInk(it.tool, it.col, it.sz * scale, W, false);
    if (it.g) o.g = it.g;
    if (it.lk) o.lk = true;
    return o;
  });
}

// ---------------------------------------------------------------- Auto shape
/** What a rough stroke looks like (points in board units), or null to keep it as a drawing:
 *  { k: 'line', a, b } · { k: 'oval' | 'rect', x, y, w, h } · { k: 'pg', x, y, w, h, pp: [x, y, … from 0 to 1] }. */
export function recognize(P) {
  if (!P || P.length < 5) return null;
  const pts = P.map((p) => [p[0], p[1]]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
  pts.forEach(([x, y], i) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
  });
  const w = x1 - x0, h = y1 - y0, size = Math.max(w, h);
  if (size < 16 || len < 24) return null;
  const first = pts[0], last = pts.at(-1), gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (gap / len > 0.94) return { k: 'line', a: { x: r1(first[0]), y: r1(first[1]) }, b: { x: r1(last[0]), y: r1(last[1]) } };
  if (gap > 0.25 * size || len < size * 2) return null; // open, or not going round: a drawing
  const box = { x: r1(x0), y: r1(y0), w: r1(Math.max(1, w)), h: r1(Math.max(1, h)) };
  // corners: the closed outline simplified hard, with the end joined to where it started
  const ring = simplify([...pts, first].map((p) => [p[0], p[1], 0.5]), 0.09 * size, false);
  const corners = ring.slice(0, -1);
  // the stroke may start halfway along a side, or end just past its first corner: such points are no corners
  for (let again = true; again && corners.length > 3;) {
    again = false;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[(i + corners.length - 1) % corners.length], b = corners[(i + 1) % corners.length], p = corners[i];
      if (segDist(p[0], p[1], a, b) < 0.09 * size || Math.hypot(p[0] - a[0], p[1] - a[1]) < 0.12 * size) { corners.splice(i, 1); again = true; break; }
    }
  }
  const cx = x0 + w / 2, cy = y0 + h / 2, rx = Math.max(1, w / 2), ry = Math.max(1, h / 2);
  const err = pts.reduce((s, [x, y]) => s + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1), 0) / pts.length;
  if (corners.length === 3) return { k: 'pg', ...box, pp: norm(corners, box) };
  if (corners.length === 4) {
    // a box when every side runs along an axis, else the four corners as drawn
    const axial = corners.every((p, i) => {
      const q = corners[(i + 1) % 4], a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2);
      return Math.min(a, Math.PI / 2 - a) < 0.3;
    });
    if (axial || err > 0.16) return axial ? { k: 'rect', ...box } : { k: 'pg', ...box, pp: norm(corners, box) };
  }
  if (err < 0.2) return { k: 'oval', ...box };
  return null;
}
const norm = (pts, b) => pts.flatMap(([x, y]) => [Math.round(((x - b.x) / b.w) * 1000) / 1000, Math.round(((y - b.y) / b.h) * 1000) / 1000]);
