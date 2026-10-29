// Canvas data and geometry. Pure logic (no DOM, no storage), so the app, its widget, Finder and the plain-node test
// share it. Everything stays on this computer: store key `canvas`, pictures and previews in IndexedDB (`canvas:…`).
//
// canvas = [Board]
// Board  = { id, name, created, at (last edit), opened?, fav?, deleted? (ms), grid? (dot grid), snap? (snap to grid),
//            thumb?: { l, d } (blob keys of the light and dark previews), view?: Rect (the part last shown),
//            scenes: [{ id, name, x, y, w, h }], items: [Item] }
// Item   = { id, t, x, y, w, h, r? (degrees), lk? (locked), g? (group id), … } in board units; the array order is the
//          stacking order (last = front). Fields at their default value are left out to keep the JSON small.
//   note  { c (colour key), tx, fs? (largest font size), font?, b?, i?, u?, s?, al? }  — the text shrinks to fit
//   text  { tx, fs, font?, col?, b?, i?, u?, s? (strikethrough), al? ('l' | 'c' | 'r' | 'j'; none = natural) }
//   shape { k (kind), fill, st? (line colour), sw? (line width), ds? (1 dash, 2 dot), op?, rad?, n? (points or sides),
//           pp? (a recognised polygon: x, y, … from 0 to 1), tx?, fs?, font?, col?, b?, i?, u?, al? }
//   img   { b (blob key), op?, rad? }
//   link  { u, tx (title) }
//   ink   { tool ('pen' | 'pencil' | 'cal' | 'marker' | 'hl'), col, sz, iw, ih, p: [x, y, pressure, …] in iw × ih }
//   line  { a, b: { id, s ('n' | 'e' | 's' | 'w' | 'auto') } stuck to an item, or { x, y }; k: 's' straight | 'c' curved |
//           'e' elbow; m?: { x, y } a point a free curve passes through; ha?, hb? arrow heads; st?, sw?, ds?, op? }
// Items never change in place: an edit makes a new object, so undo keeps whole snapshots cheaply.

export const DAY = 864e5;
export const KEEP_DELETED = 30 * DAY;
export const GRID = 24;
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
/** A new picture's blob key; it carries the time, so the clean-up never deletes a picture whose board isn't saved yet. */
export const imageId = (now = Date.now()) => `canvas:img-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const thumbId = (boardId, th, now = Date.now()) => `canvas:th-${boardId}-${th}-${now.toString(36)}`;
/** When a `canvas:` blob was made (pictures and previews), or 0 when the key doesn't say. */
export function bornAt(id) {
  const m = /^canvas:img-([0-9a-z]{8,})-/.exec(id) || /^canvas:th-.+-([0-9a-z]{8,})$/.exec(id);
  return m ? parseInt(m[1], 36) : 0;
}
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export const r1 = (v) => Math.round(v * 10) / 10;

// Samsung Notes' pastel memo colours; the key is stored so a later palette tweak changes every note.
export const NOTE_COLORS = { yellow: '#ffe17a', orange: '#ffc68a', pink: '#ffb7cf', purple: '#d9c3ff', blue: '#a9d8ff', green: '#c4ebaa', gray: '#e3e3e8' };
export const noteColor = (c) => NOTE_COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? c : NOTE_COLORS.yellow);
export const FONTS = ['sys', 'disp', 'ser', 'mono'];
export const DEF = {
  note: { w: 200, h: 200, fs: 24 },
  text: { w: 240, h: 34, fs: 22 },
  shape: { w: 150, h: 150, fill: '#4c8dff' },
  line: { sw: 3 },
  link: { w: 320, h: 88 },
};
export const TEXT_TYPES = new Set(['note', 'text', 'shape']);
// fields that keep their default value are dropped, so a board with hundreds of items stays small
const DEFAULTS = { r: 0, lk: false, op: 1, b: false, i: false, u: false, s: false, ha: false, hb: false, ds: 0, rad: 0, fav: false };

/** Rounds coordinates and drops defaults: the shape an item is stored in. */
export function clean(it) {
  const o = {};
  for (const [k, v] of Object.entries(it)) {
    if (v === undefined || v === null || v === '' || DEFAULTS[k] === v) continue;
    o[k] = typeof v !== 'number' ? v : k === 'op' ? Math.round(v * 100) / 100 : r1(v);
  }
  if (o.t === 'text' || o.t === 'note') o.tx ??= '';
  return o;
}

// ---------------------------------------------------------------- boards
export function newBoard(name, now = Date.now()) {
  return { id: uid('b'), name, created: now, at: now, opened: now, items: [], scenes: [] };
}
/** Untitled board, Untitled board 2, … */
export function freshName(list, base) {
  const names = new Set(list.filter((b) => !b.deleted).map((b) => b.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
const okItem = (it) => it && typeof it === 'object' && typeof it.id === 'string' && typeof it.t === 'string';
/** Tolerates missing, old or broken data: whatever can't be read is left out instead of breaking the app. */
export function normBoards(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  return v.filter((b) => b && typeof b === 'object' && typeof b.id === 'string' && !seen.has(b.id) && seen.add(b.id)).map((b) => ({
    ...b, name: String(b.name ?? ''), created: num(b.created, Date.now()), at: num(b.at, num(b.created, Date.now())),
    items: Array.isArray(b.items) ? b.items.filter(okItem).map(normItem) : [],
    scenes: Array.isArray(b.scenes) ? b.scenes.filter((s) => s && s.id && s.w > 0 && s.h > 0) : [],
  }));
}
function normItem(it) {
  if (it.t === 'line') return { ...it, a: it.a || { x: 0, y: 0 }, b: it.b || { x: 100, y: 0 } };
  return { ...it, x: num(it.x), y: num(it.y), w: Math.max(1, num(it.w, 100)), h: Math.max(1, num(it.h, 100)) };
}
export const live = (list) => list.filter((b) => !b.deleted);
export const daysLeft = (b, now = Date.now()) => Math.max(1, Math.ceil((b.deleted + KEEP_DELETED - now) / DAY));
/** Splits boards into those kept and those deleted more than 30 days ago. */
export function purge(list, now = Date.now()) {
  const keep = [], gone = [];
  for (const b of list) (b.deleted && now - b.deleted > KEEP_DELETED ? gone : keep).push(b);
  return { keep, gone };
}
/** Every blob a board needs: its pictures and its two previews. */
export function blobsOf(b) {
  const s = new Set();
  for (const it of b.items || []) if (it.t === 'img' && it.b) s.add(it.b);
  if (b.thumb?.l) s.add(b.thumb.l);
  if (b.thumb?.d) s.add(b.thumb.d);
  return s;
}
export function sortBoards(arr, by = 'at', lang) {
  if (by === 'name') return arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', lang, { numeric: true }) || b.at - a.at);
  return arr.sort((a, b) => (b[by] || 0) - (a[by] || 0));
}
/** Does a board's name or text contain `q` (already lower-cased)? */
export function boardMatches(b, q, fold = (s) => String(s || '').toLocaleLowerCase()) {
  q = fold(q).trim();
  if (!q) return true;
  return fold(b.name).includes(q) || (b.items || []).some((i) => (i.tx && fold(i.tx).includes(q)) || (i.u && fold(i.u).includes(q)));
}
/** A copy of a board (new ids, the same pictures). */
export function duplicateBoard(b, name, now = Date.now()) {
  const map = new Map(b.items.map((it) => [it.id, uid('i')]));
  const groups = new Map();
  const items = b.items.map((it) => remap(it, map, groups));
  return { ...structuredClone({ ...b, items: [] }), id: uid('b'), name, created: now, at: now, opened: now, fav: undefined, deleted: undefined, thumb: undefined, items, scenes: (b.scenes || []).map((s) => ({ ...s, id: uid('s') })) };
}
function remap(it, map, groups, dx = 0, dy = 0) {
  const o = { ...it, id: map.get(it.id) };
  if (it.g) {
    if (!groups.has(it.g)) groups.set(it.g, uid('g'));
    o.g = groups.get(it.g);
  }
  if (it.t === 'line') {
    const end = (e) => (e?.id ? (map.has(e.id) ? { id: map.get(e.id), s: e.s } : null) : { x: e.x + dx, y: e.y + dy });
    o.a = end(it.a); o.b = end(it.b);
    if (it.m) o.m = { x: it.m.x + dx, y: it.m.y + dy };
  } else { o.x = it.x + dx; o.y = it.y + dy; }
  return o;
}
/** Copies of `sel` items moved by dx, dy with new ids. Connectors keep the ends whose items were copied too; the other
 *  ends become free points where they were, so a copy never pulls on the original. */
export function copyItems(sel, all, dx, dy) {
  const byId = new Map(all.map((i) => [i.id, i]));
  const map = new Map(sel.map((it) => [it.id, uid('i')]));
  const groups = new Map();
  return sel.map((it) => {
    if (it.t === 'line') {
      const g = lineGeom(it, byId);
      const free = (e, p) => (e?.id && !map.has(e.id) ? { x: p.x, y: p.y } : e);
      it = { ...it, a: free(it.a, g.A), b: free(it.b, g.B) };
    }
    return clean(remap(it, map, groups, dx, dy));
  });
}

// ---------------------------------------------------------------- geometry
export const rad = (d) => (d * Math.PI) / 180;
export function rotPt(x, y, cx, cy, deg) {
  if (!deg) return [x, y];
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
export const center = (it) => [it.x + it.w / 2, it.y + it.h / 2];
export function corners(it) {
  const [cx, cy] = center(it);
  return [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]].map(([x, y]) => rotPt(x, y, cx, cy, it.r || 0));
}
export function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The axis-aligned box around an item (rotation included); connectors need the other items to find their ends. */
export function aabb(it, byId) {
  if (it.t === 'line') return lineGeom(it, byId).box;
  return it.r ? boxOf(corners(it)) : { x: it.x, y: it.y, w: it.w, h: it.h };
}
export function unionBox(boxes) {
  const pts = [];
  for (const b of boxes) if (b) pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]);
  return pts.length ? boxOf(pts) : null;
}
export const hitBox = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** The middle of one side of an item and the direction pointing away from it (both turned with the item). */
export function sideOf(it, s) {
  const [cx, cy] = center(it), [nx, ny] = SIDES[s] || SIDES.e;
  const [x, y] = rotPt(cx + (nx * it.w) / 2, cy + (ny * it.h) / 2, cx, cy, it.r || 0);
  const a = rad(it.r || 0);
  return { x, y, n: [nx * Math.cos(a) - ny * Math.sin(a), nx * Math.sin(a) + ny * Math.cos(a)] };
}
const GAP = 5; // connectors stop just short of the item they point at
function resolveEnd(e, byId, toward) {
  const it = e?.id && byId.get(e.id);
  if (!it || it.t === 'line') return { x: e?.x ?? 0, y: e?.y ?? 0, n: null };
  let s = e.s;
  if (!SIDES[s]) { // 'auto': the side that faces the other end
    let best = Infinity;
    for (const k of Object.keys(SIDES)) {
      const p = sideOf(it, k), d = Math.hypot(p.x - toward[0], p.y - toward[1]) - (p.n[0] * (toward[0] - p.x) + p.n[1] * (toward[1] - p.y)) * 0.25;
      if (d < best) { best = d; s = k; }
    }
  }
  const p = sideOf(it, s);
  return { x: p.x + p.n[0] * GAP, y: p.y + p.n[1] * GAP, n: p.n, s };
}
const roughEnd = (e, byId) => {
  const it = e?.id && byId.get(e.id);
  return it && it.t !== 'line' ? center(it) : [e?.x ?? 0, e?.y ?? 0];
};
export const headLen = (sw) => 9 + sw * 2.4;

/** Where a connector runs: its ends, the SVG path, the arrow heads and its bounding box. */
export function lineGeom(it, byId) {
  const A = resolveEnd(it.a, byId, roughEnd(it.b, byId));
  const B = resolveEnd(it.b, byId, [A.x, A.y]);
  const k = it.k || 's', sw = it.sw ?? DEF.line.sw, L = headLen(sw);
  let ctrl = [];
  const dirAt = (P, Q, n) => { // the direction the line arrives at P (Q = the point before it)
    if (n && k !== 's') return [-n[0], -n[1]];
    const dx = P.x - Q[0], dy = P.y - Q[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  let pts, d, da, db;
  if (k === 'e') {
    const horiz = (P, n, Q) => (n ? Math.abs(n[0]) > Math.abs(n[1]) : Math.abs(Q.x - P.x) >= Math.abs(Q.y - P.y));
    const ha = horiz(A, A.n, B), hb = horiz(B, B.n, A);
    if (ha && hb) { const mx = (A.x + B.x) / 2; pts = [[A.x, A.y], [mx, A.y], [mx, B.y], [B.x, B.y]]; }
    else if (!ha && !hb) { const my = (A.y + B.y) / 2; pts = [[A.x, A.y], [A.x, my], [B.x, my], [B.x, B.y]]; }
    else if (ha) pts = [[A.x, A.y], [B.x, A.y], [B.x, B.y]];
    else pts = [[A.x, A.y], [A.x, B.y], [B.x, B.y]];
    pts = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
    if (pts.length < 2) pts.push([B.x + 0.01, B.y]);
    da = dirAt(A, pts[1]); db = dirAt(B, pts.at(-2));
  } else if (k === 'c') {
    const dist = Math.hypot(B.x - A.x, B.y - A.y), reach = Math.max(30, dist * 0.4);
    let c1, c2;
    if (A.n || B.n) {
      c1 = A.n ? [A.x + A.n[0] * reach, A.y + A.n[1] * reach] : [A.x + (B.x - A.x) / 3, A.y + (B.y - A.y) / 3];
      c2 = B.n ? [B.x + B.n[0] * reach, B.y + B.n[1] * reach] : [B.x + (A.x - B.x) / 3, B.y + (A.y - B.y) / 3];
    } else {
      const m = it.m || { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      // a quadratic through m, written as a cubic so both kinds draw the same way
      const q = [2 * m.x - (A.x + B.x) / 2, 2 * m.y - (A.y + B.y) / 2];
      c1 = [A.x + (2 / 3) * (q[0] - A.x), A.y + (2 / 3) * (q[1] - A.y)]; c2 = [B.x + (2 / 3) * (q[0] - B.x), B.y + (2 / 3) * (q[1] - B.y)];
    }
    ctrl = [c1, c2];
    da = dirAt(A, c1, A.n); db = dirAt(B, c2, B.n);
    if (Math.hypot(c1[0] - A.x, c1[1] - A.y) < 0.01) da = dirAt(A, [B.x, B.y]);
    if (Math.hypot(c2[0] - B.x, c2[1] - B.y) < 0.01) db = dirAt(B, [A.x, A.y]);
    pts = [[A.x, A.y], c1, c2, [B.x, B.y]];
  } else {
    pts = [[A.x, A.y], [B.x, B.y]];
    da = dirAt(A, [B.x, B.y]); db = dirAt(B, [A.x, A.y]);
  }
  // the stroke stops at the base of an arrow head so its end doesn't poke through the tip
  const cut = (P, dir, on) => (on ? [P[0] - dir[0] * L * 0.55, P[1] - dir[1] * L * 0.55] : P);
  const p0 = cut(pts[0], da, it.ha), pn = cut(pts.at(-1), db, it.hb);
  const f = (v) => r1(v);
  if (k === 'c') d = `M${f(p0[0])} ${f(p0[1])}C${f(ctrl[0][0])} ${f(ctrl[0][1])} ${f(ctrl[1][0])} ${f(ctrl[1][1])} ${f(pn[0])} ${f(pn[1])}`;
  else d = 'M' + [p0, ...pts.slice(1, -1), pn].map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
  const heads = [];
  const head = (P, dir) => {
    const w = L * 0.42, bx = P.x - dir[0] * L, by = P.y - dir[1] * L, px = -dir[1] * w, py = dir[0] * w;
    return `M${f(P.x)} ${f(P.y)}L${f(bx + px)} ${f(by + py)}Q${f(P.x - dir[0] * L * 0.72)} ${f(P.y - dir[1] * L * 0.72)} ${f(bx - px)} ${f(by - py)}Z`;
  };
  if (it.ha) heads.push(head(A, da));
  if (it.hb) heads.push(head(B, db));
  const b = boxOf(pts), pad = sw + (it.ha || it.hb ? L : 0) + 2;
  return { A, B, d, heads, ctrl, pts, box: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } };
}
const bez = (p0, c1, c2, p3, u) => {
  const v = 1 - u;
  return [v ** 3 * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u ** 3 * p3[0], v ** 3 * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u ** 3 * p3[1]];
};
/** Points along a connector (a curve is sampled), for hit tests and the lasso. */
export function linePoly(g, n = 24) {
  if (!g.ctrl.length) return g.pts;
  const [p0, c1, c2, p3] = g.pts, out = [];
  for (let i = 0; i <= n; i++) out.push(bez(p0, c1, c2, p3, i / n));
  return out;
}
/** The point halfway along a connector (where its bend handle sits). */
export function lineMid(g) {
  if (g.ctrl.length) return bez(...g.pts, 0.5);
  const segs = g.pts.slice(1).map((p, i) => [g.pts[i], p, Math.hypot(p[0] - g.pts[i][0], p[1] - g.pts[i][1])]);
  let half = segs.reduce((a, s) => a + s[2], 0) / 2;
  for (const [a, b, l] of segs) {
    if (half <= l) { const u = l ? half / l : 0; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
    half -= l;
  }
  return g.pts[0];
}
/** The shortest distance from a point to a connector (for clicking thin lines). */
export function distToLine(g, x, y) {
  const poly = linePoly(g);
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) best = Math.min(best, segDist(x, y, poly[i - 1], poly[i]));
  return best;
}
export function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
  return Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy);
}
/** The rect around a list of items (Zoom to fit, previews, export). */
export function contentBox(items, byId = new Map(items.map((i) => [i.id, i]))) {
  return unionBox(items.map((it) => aabb(it, byId)));
}

// ---------------------------------------------------------------- lasso, snapping, arranging
/** Even-odd test: is the point inside the polygon [[x, y], …]? */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
/** The items a lasso takes, like Samsung Notes' selection tool: a box when its centre is inside, a stroke or a
 *  connector when most of it is. `pointsOf(it)` gives an ink item's points on the board. */
export function lassoHits(items, poly, byId, pointsOf) {
  if (poly.length < 3) return [];
  const out = [];
  for (const it of items) {
    let pts;
    if (it.t === 'line') pts = linePoly(lineGeom(it, byId), 12);
    else if (it.t === 'ink' && pointsOf) pts = pointsOf(it);
    if (pts?.length) {
      const inside = pts.filter(([x, y]) => pointInPoly(x, y, poly)).length;
      if (inside / pts.length >= 0.5) out.push(it.id);
    } else {
      const [cx, cy] = center(it);
      if (pointInPoly(cx, cy, poly)) out.push(it.id);
    }
  }
  return out;
}
export const snapTo = (v, step = GRID) => Math.round(v / step) * step;
/** Moves for "align" and "distribute" (how: l c r t m b dh dv): Map id → { x } or { y }. Lines don't take part. */
export function alignMap(its, how, byId) {
  its = its.filter((i) => i.t !== 'line');
  const map = new Map();
  if (its.length < 2) return map;
  const U = contentBox(its, byId);
  if (how === 'dh' || how === 'dv') {
    const hz = how === 'dh', sorted = its.map((i) => ({ i, b: aabb(i, byId) })).sort((a, b) => (hz ? a.b.x - b.b.x : a.b.y - b.b.y));
    const total = sorted.reduce((s, x) => s + (hz ? x.b.w : x.b.h), 0), gap = ((hz ? U.w : U.h) - total) / (sorted.length - 1);
    let pos = hz ? U.x : U.y;
    for (const { i, b } of sorted) {
      map.set(i.id, hz ? { x: r1(i.x + pos - b.x) } : { y: r1(i.y + pos - b.y) });
      pos += (hz ? b.w : b.h) + gap;
    }
    return map;
  }
  for (const i of its) {
    const b = aabb(i, byId);
    const d = { l: [U.x - b.x, 0], c: [U.x + U.w / 2 - (b.x + b.w / 2), 0], r: [U.x + U.w - (b.x + b.w), 0], t: [0, U.y - b.y], m: [0, U.y + U.h / 2 - (b.y + b.h / 2)], b: [0, U.y + U.h - (b.y + b.h)] }[how];
    if (d) map.set(i.id, { x: r1(i.x + d[0]), y: r1(i.y + d[1]) });
  }
  return map;
}
/** The stacking order after Bring to front / forward, Send backward / to back of the items in `ids`. */
export function arrange(items, ids, how) {
  let next = [...items];
  if (how === 'front') next = [...next.filter((i) => !ids.has(i.id)), ...next.filter((i) => ids.has(i.id))];
  else if (how === 'back') next = [...next.filter((i) => ids.has(i.id)), ...next.filter((i) => !ids.has(i.id))];
  else if (how === 'fwd') { for (let i = next.length - 2; i >= 0; i--) if (ids.has(next[i].id) && !ids.has(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]; }
  else if (how === 'bwd') { for (let i = 1; i < next.length; i++) if (ids.has(next[i].id) && !ids.has(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]; }
  return next;
}
/** Groups items: they get one group id and move together in the stacking order, at the frontmost member's place. */
export function groupItems(items, ids, g = uid('g')) {
  const top = Math.max(...items.map((i, k) => (ids.has(i.id) ? k : -1)));
  const members = items.filter((i) => ids.has(i.id)).map((i) => clean({ ...i, g }));
  const rest = items.filter((i) => !ids.has(i.id)), at = items.slice(0, top + 1).filter((i) => !ids.has(i.id)).length;
  return [...rest.slice(0, at), ...members, ...rest.slice(at)];
}
/** Deletes items; connectors that pointed at one keep their line, ending where the item was. */
export function removeItems(items, ids, byId = new Map(items.map((i) => [i.id, i]))) {
  return items.filter((i) => !ids.has(i.id)).map((i) => {
    if (i.t !== 'line' || !(ids.has(i.a?.id) || ids.has(i.b?.id))) return i;
    const g = lineGeom(i, byId);
    return clean({ ...i, a: ids.has(i.a?.id) ? { x: r1(g.A.x), y: r1(g.A.y) } : i.a, b: ids.has(i.b?.id) ? { x: r1(g.B.x), y: r1(g.B.y) } : i.b });
  });
}

// ---------------------------------------------------------------- text and links
/** A link card's second line: the address without its scheme or "www.", decoded so Arabic addresses read as written. */
export function shortUrl(u) {
  try {
    const x = new URL(u);
    let p = x.pathname === '/' ? '' : x.pathname.replace(/\/$/, '');
    try { p = decodeURI(p); } catch { /* keep it encoded */ }
    return (x.hostname.replace(/^www\./, '') + p + (x.search.length > 1 ? x.search : '')).slice(0, 120);
  } catch { return String(u || ''); }
}
export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}
/** Text direction of a paragraph from its first strong letter, like `unicode-bidi: plaintext`. */
export function dirOf(s) {
  const m = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿऀ-ॿ぀-ヿ一-鿿가-힯]|([֐-ࣿיִ-﷿ﹰ-﻿])/.exec(s || '');
  return m && m[1] ? 'rtl' : 'ltr';
}
