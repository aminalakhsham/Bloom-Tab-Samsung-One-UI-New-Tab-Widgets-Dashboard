// Canvas' shape set: basic shapes drawn at their real size (so corners and line widths never stretch), arrows,
// callouts, and objects drawn as SVG paths in a 100 × 100 box and scaled to the item. Each library entry has a
// category and an i18n key for its name (the shape picker translates and searches them). Pure logic, no DOM.

const f = (v) => Math.round(v * 10) / 10;
const poly = (pts) => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
/** Scales a path written with absolute commands (M L H V C S Q T A Z), so objects fit any box without distorting
 *  their line width. Arcs scale their radii, which is exact for the unrotated arcs used here. */
export function scalePath(d, sx, sy) {
  const out = [];
  const re = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;
  let m;
  while ((m = re.exec(d))) {
    const c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (c === 'Z' || c === 'z') { out.push('Z'); continue; }
    let o;
    if (c === 'H') o = n.map((v) => f(v * sx));
    else if (c === 'V') o = n.map((v) => f(v * sy));
    else if (c === 'A') o = n.map((v, i) => { const j = i % 7; return j === 0 || j === 5 ? f(v * sx) : j === 1 || j === 6 ? f(v * sy) : v; });
    else o = n.map((v, i) => f(v * (i % 2 ? sy : sx)));
    out.push(c + o.join(' '));
  }
  return out.join('');
}
// points on a unit shape stretched to fill w × h, so a pentagon or star uses its whole box
function fit(pts, w, h) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), sx = w / (Math.max(...xs) - x0 || 1), sy = h / (Math.max(...ys) - y0 || 1);
  return pts.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);
}
const ring = (n, r = 1, start = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(start + (i * 2 * Math.PI) / n) * r, Math.sin(start + (i * 2 * Math.PI) / n) * r]);
function starPts(n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? inner : 1; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}
function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}
const circ = (cx, cy, r) => `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;
const rotRect = (cx, cy, len0, len1, wd, a) => { // a bar from radius len0 to len1 at angle a (all the same winding)
  const c = Math.cos(a), s = Math.sin(a), px = (-s * wd) / 2, py = (c * wd) / 2;
  return poly([[cx + c * len0 + px, cy + s * len0 + py], [cx + c * len1 + px, cy + s * len1 + py], [cx + c * len1 - px, cy + s * len1 - py], [cx + c * len0 - px, cy + s * len0 - py]]);
};
function gear() {
  let d = '';
  const teeth = 10, step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    [[a - step * 0.26, 36], [a - step * 0.16, 48], [a + step * 0.16, 48], [a + step * 0.26, 36], [a + step * 0.5, 36]].forEach(([ang, r], j) => { d += (i || j ? 'L' : 'M') + f(50 + Math.cos(ang) * r) + ' ' + f(50 + Math.sin(ang) * r); });
  }
  return d + 'Z' + circ(50, 50, 15);
}

// basic shapes, computed for the item's own size; `rad` rounds rectangle corners, `n` sets sides or points
const BASIC = {
  rect: (w, h, it) => rrect(0, 0, w, h, it.rad || 0),
  oval: (w, h) => `M${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w)} ${f(h / 2)}Z`,
  tri: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]),
  rtri: (w, h) => poly([[0, 0], [w, h], [0, h]]),
  diamond: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  poly: (w, h, it) => poly(fit(ring(Math.max(3, Math.min(16, it.n || 5))), w, h)),
  star: (w, h, it) => { const n = Math.max(3, Math.min(30, it.n || 5)); return poly(fit(starPts(n, n > 8 ? 0.74 : n > 5 ? 0.55 : 0.42), w, h)); },
  arrow: (w, h) => { const hl = Math.min(w * 0.5, h * 0.7); return poly([[0, h * 0.3], [w - hl, h * 0.3], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.7], [0, h * 0.7]]); },
  arrow2: (w, h) => { const hl = Math.min(w * 0.34, h * 0.7); return poly([[0, h / 2], [hl, 0], [hl, h * 0.3], [w - hl, h * 0.3], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.7], [hl, h * 0.7], [hl, h]]); },
  chevron: (w, h) => { const hl = Math.min(w * 0.4, h * 0.5); return poly([[0, 0], [w - hl, 0], [w, h / 2], [w - hl, h], [0, h], [hl, h / 2]]); },
  para: (w, h) => { const o = Math.min(w * 0.25, h * 0.5); return poly([[o, 0], [w, 0], [w - o, h], [0, h]]); },
  trap: (w, h) => { const o = Math.min(w * 0.22, h * 0.5); return poly([[o, 0], [w - o, 0], [w, h], [0, h]]); },
  plus: (w, h) => { const a = Math.min(w, h) * 0.32, x0 = (w - a) / 2, y0 = (h - a) / 2; return poly([[x0, 0], [x0 + a, 0], [x0 + a, y0], [w, y0], [w, y0 + a], [x0 + a, y0 + a], [x0 + a, h], [x0, h], [x0, y0 + a], [0, y0 + a], [0, y0], [x0, y0]]); },
  bubble: (w, h) => { const bh = h * 0.8, r = Math.min(w, bh) * 0.28; return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(bh - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(bh)}H${f(w * 0.4)}L${f(w * 0.14)} ${f(h)}L${f(w * 0.22)} ${f(bh)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(bh - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`; },
  callout: (w, h) => { const bh = h * 0.8; return poly([[0, 0], [w, 0], [w, bh], [w * 0.42, bh], [w * 0.16, h], [w * 0.24, bh], [0, bh]]); },
  // a polygon recognised by Auto shape: its corners as fractions of the box
  pg: (w, h, it) => { const p = it.pp || [0.5, 0, 1, 1, 0, 1], pts = []; for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i] * w, p[i + 1] * h]); return poly(pts); },
};

// objects: silhouettes in a 100 × 100 box (absolute commands only, so scalePath can stretch them); `eo` cuts holes
const OBJ = {
  heart: 'M50 90C22 68 5 51 5 31C5 17 16 7 29 7C38 7 45 12 50 20C55 12 62 7 71 7C84 7 95 17 95 31C95 51 78 68 50 90Z',
  cloud: 'M26 82C13 82 4 73 4 61C4 50 12 41 23 39C24 24 36 13 51 13C63 13 73 21 77 32C88 33 96 43 96 56C96 70 85 82 71 82Z',
  bolt: 'M60 3L17 57H45L37 97L83 40H55L63 3Z',
  moon: 'M58 5A46 46 0 1 0 95 64A37 37 0 0 1 58 5Z',
  sun: circ(50, 50, 22) + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rotRect(50, 50, 31, 47, 8, (i * Math.PI) / 4)).join(''),
  drop: 'M50 4C50 4 17 42 17 63C17 82 32 96 50 96C68 96 83 82 83 63C83 42 50 4 50 4Z',
  leaf: 'M14 92C9 46 38 10 92 8C94 60 64 92 14 92Z',
  tree: 'M50 3L76 35H63L84 62H67L90 88H56V97H44V88H10L33 62H16L37 35H24Z',
  flower: [0, 1, 2, 3, 4].map((i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return circ(50 + Math.cos(a) * 25, 50 + Math.sin(a) * 25, 21); }).join('') + circ(50, 50, 16),
  snow: [0, 1, 2, 3, 4, 5].map((i) => { const a = (i * Math.PI) / 3; return rotRect(50, 50, 0, 47, 7, a) + rotRect(50 + Math.cos(a) * 30, 50 + Math.sin(a) * 30, 0, 14, 6, a + 0.8) + rotRect(50 + Math.cos(a) * 30, 50 + Math.sin(a) * 30, 0, 14, 6, a - 0.8); }).join(''),
  mountain: 'M3 90L35 32L49 54L65 22L97 90Z',
  fish: 'M8 50C24 25 55 21 76 42L95 26V74L76 58C55 79 24 75 8 50ZM29 43A6 6 0 1 0 29 55A6 6 0 1 0 29 43Z',
  house: 'M50 7L95 46H83V93H60V64H40V93H17V46H5Z',
  bulb: 'M50 4C30 4 16 19 16 38C16 51 23 59 30 66C34 70 36 74 36 79H64C64 74 66 70 70 66C77 59 84 51 84 38C84 19 70 4 50 4ZM36 84H64V90H36ZM40 94H60C60 97 56 99 50 99C44 99 40 97 40 94Z',
  bell: 'M50 5C53 5 55 7 55 10V13C69 16 78 28 78 43V64L89 77V81H11V77L22 64V43C22 28 31 16 45 13V10C45 7 47 5 50 5ZM38 86H62C62 93 57 97 50 97C43 97 38 93 38 86Z',
  lock: 'M29 44V31C29 19 38 9 50 9C62 9 71 19 71 31V44H62V31C62 24 57 18 50 18C43 18 38 24 38 31V44ZM21 44H79A7 7 0 0 1 86 51V88A7 7 0 0 1 79 95H21A7 7 0 0 1 14 88V51A7 7 0 0 1 21 44Z',
  key: 'M30 21A23 23 0 1 0 51 54H60L66 60L72 54L78 60L84 54H96V38H51A23 23 0 0 0 30 21ZM20 36A8 8 0 1 1 20 52A8 8 0 1 1 20 36Z',
  camera: 'M8 31A7 7 0 0 1 15 24H30L37 13H63L70 24H85A7 7 0 0 1 92 31V79A7 7 0 0 1 85 86H15A7 7 0 0 1 8 79ZM50 34A20 20 0 1 0 50 74A20 20 0 1 0 50 34ZM50 43A11 11 0 1 1 50 65A11 11 0 1 1 50 43Z',
  gift: 'M8 33H92V50H8ZM14 54H86V95H14ZM50 32C44 18 28 12 24 21C20 30 35 33 50 32ZM50 32C56 18 72 12 76 21C80 30 65 33 50 32Z',
  book: 'M47 21C38 14 24 12 5 13V83C24 82 38 85 47 91ZM53 21C62 14 76 12 95 13V83C76 82 62 85 53 91Z',
  pencil: 'M71 7L93 29L37 85L9 93L17 65ZM64 20L80 36L76 40L60 24Z',
  search: 'M42 5A35 35 0 1 0 63 68L84 92L95 81L72 59A35 35 0 0 0 42 5ZM42 17A23 23 0 1 1 42 63A23 23 0 1 1 42 17Z',
  mail: 'M11 19H89A7 7 0 0 1 96 26V74A7 7 0 0 1 89 81H11A7 7 0 0 1 4 74V26A7 7 0 0 1 11 19ZM12 27L50 55L88 27V35L50 62L12 35Z',
  umbrella: 'M50 5C75 5 95 24 97 50C91 44 84 44 78 50C72 44 63 44 56 50H54V85C54 92 48 97 41 97C35 97 30 92 30 86H38C38 88 39 89 41 89C44 89 46 87 46 85V50H44C37 44 28 44 22 50C16 44 9 44 3 50C5 24 25 5 50 5Z',
  trophy: 'M27 7H73V13H91V25C91 39 81 48 69 50C66 58 59 63 54 64V76H68V84H74V95H26V84H32V76H46V64C41 63 34 58 31 50C19 48 9 39 9 25V13H27ZM17 21V25C17 33 22 39 28 41L27 21ZM83 21H73L72 41C78 39 83 33 83 25Z',
  crown: 'M7 28L30 51L50 15L70 51L93 28L85 80H15ZM15 85H85V95H15Z',
  cup: 'M10 28H72V33C85 33 94 40 94 52C94 64 85 71 72 71C69 83 59 91 45 91H37C22 91 12 80 10 66ZM72 42V62C79 62 84 58 84 52C84 46 79 42 72 42Z',
  gear: gear(),
  bookmark: 'M20 4H80V96L50 74L20 96Z',
  tag: 'M14 8H50L93 51L51 93L8 50V14A6 6 0 0 1 14 8ZM28 21A7 7 0 1 0 28 35A7 7 0 1 0 28 21Z',
  pin: 'M50 97C50 97 15 60 15 38C15 19 30 4 50 4C70 4 85 19 85 38C85 60 50 97 50 97ZM50 24A14 14 0 1 0 50 52A14 14 0 1 0 50 24Z',
  flag: 'M13 4H22V97H13ZM22 10C36 2 50 18 64 12C72 9 80 8 89 10V55C80 53 72 54 64 57C50 63 36 47 22 55Z',
  music: 'M36 17L85 6V71C85 80 77 87 67 87C58 87 51 82 51 75C51 67 59 61 68 61C71 61 74 61 76 62V27L45 33V79C45 88 37 95 27 95C18 95 11 90 11 83C11 75 19 69 28 69C31 69 34 69 36 70Z',
  check: 'M7 53L22 38L40 56L78 16L93 31L40 85Z',
  xmark: 'M20 5L50 35L80 5L95 20L65 50L95 80L80 95L50 65L20 95L5 80L35 50L5 20Z',
  shield: 'M50 4L88 18V46C88 70 72 88 50 96C28 88 12 70 12 46V18Z',
  chat: 'M50 8C76 8 96 24 96 45C96 66 76 82 50 82C45 82 40 81 36 80L13 94L19 73C10 66 4 56 4 45C4 24 24 8 50 8Z',
  person: 'M50 5A19 19 0 1 1 50 43A19 19 0 1 1 50 5ZM12 95C12 68 29 50 50 50C71 50 88 68 88 95Z',
  car: 'M8 64V50Q8 42 16 40L30 38L41 23Q44 19 50 19H69Q75 19 79 25L88 38Q96 40 96 49V64Q96 68 92 68H85A11 11 0 0 0 63 68H37A11 11 0 0 0 15 68H12Q8 68 8 64ZM46 37L53 27H68L74 37ZM35 68A9 9 0 1 1 17 68A9 9 0 1 1 35 68ZM83 68A9 9 0 1 1 65 68A9 9 0 1 1 83 68Z',
  plane: 'M50 4C54 4 56 8 56 14V38L94 58V66L56 56V78L69 88V95L50 89L31 95V88L44 78V56L6 66V58L44 38V14C44 8 46 4 50 4Z',
  rocket: 'M50 3C65 13 71 30 71 50V65L83 77V93L68 84L62 88H38L32 84L17 93V77L29 65V50C29 30 35 13 50 3ZM50 31A9 9 0 1 0 50 49A9 9 0 1 0 50 31Z',
  boat: 'M47 6V68H14ZM54 14V68H86ZM6 74H94L80 93H20Z',
};
const EO = new Set(['fish', 'bulb', 'lock', 'key', 'camera', 'search', 'mail', 'trophy', 'cup', 'gear', 'tag', 'pin', 'car', 'rocket']);

/** The outline of a shape item at its size: { d, eo } (eo = even-odd fill, for shapes with holes). */
export function shapePath(it) {
  const w = Math.max(1, it.w), h = Math.max(1, it.h);
  if (BASIC[it.k]) return { d: BASIC[it.k](w, h, it), eo: false };
  const src = OBJ[it.k] || OBJ.heart;
  return { d: scalePath(src, w / 100, h / 100), eo: EO.has(it.k) };
}
export const isObject = (k) => !!OBJ[k];

// ---------------------------------------------------------------- the library
// `name` is the i18n key; the picker shows t(name). Sizes are the shape's starting size when they differ from 150 × 150.
const E = (id, item) => ({ id, item, name: 'canvas.sh.' + id });
const o = (k) => E(k, { k });
export const LIBRARY = [
  { id: 'basic', name: 'canvas.shc.basic', items: [
    E('rect', { k: 'rect' }), E('rrect', { k: 'rect', rad: 26 }), E('oval', { k: 'oval' }), E('tri', { k: 'tri' }), E('rtri', { k: 'rtri' }),
    E('diamond', { k: 'diamond' }), E('pent', { k: 'poly', n: 5 }), E('hex', { k: 'poly', n: 6 }), E('oct', { k: 'poly', n: 8 }),
    E('star', { k: 'star', n: 5 }), E('burst', { k: 'star', n: 12 }), E('para', { k: 'para', w: 190, h: 120 }), E('trap', { k: 'trap', w: 180, h: 120 }), E('plus', { k: 'plus' }),
  ] },
  { id: 'arrows', name: 'canvas.shc.arrows', items: [
    E('arrow', { k: 'arrow', w: 180, h: 110 }), E('arrow2', { k: 'arrow2', w: 200, h: 100 }), E('chevron', { k: 'chevron', w: 150, h: 120 }),
    E('bubble', { k: 'bubble', w: 180, h: 150 }), E('callout', { k: 'callout', w: 180, h: 150 }), o('chat'),
  ] },
  { id: 'symbols', name: 'canvas.shc.symbols', items: ['heart', 'check', 'xmark', 'shield', 'person', 'house', 'bookmark', 'tag', 'pin', 'flag', 'music', 'crown', 'trophy'].map(o) },
  { id: 'objects', name: 'canvas.shc.objects', items: ['bulb', 'bell', 'lock', 'key', 'camera', 'gift', 'book', 'pencil', 'search', 'mail', 'umbrella', 'gear', 'cup', 'car', 'plane', 'rocket', 'boat'].map(o) },
  { id: 'nature', name: 'canvas.shc.nature', items: ['cloud', 'sun', 'moon', 'bolt', 'drop', 'snow', 'leaf', 'tree', 'flower', 'mountain', 'fish'].map(o) },
];
/** The kinds of line the Line tool inserts (free connectors). */
export const LINES = [
  { id: 'line', item: { t: 'line', k: 's' }, name: 'canvas.ln.line' },
  { id: 'arrow', item: { t: 'line', k: 's', hb: true }, name: 'canvas.ln.arrow' },
  { id: 'arrow2', item: { t: 'line', k: 's', ha: true, hb: true }, name: 'canvas.ln.arrow2' },
  { id: 'curve', item: { t: 'line', k: 'c', hb: true }, name: 'canvas.ln.curve' },
  { id: 'elbow', item: { t: 'line', k: 'e', hb: true }, name: 'canvas.ln.elbow' },
];
/** A small SVG of a library entry for the pickers. */
export function previewSVG(entry) {
  const it = entry.item;
  if (it.t === 'line') {
    const head = (x, y, a) => `<path d="M${x} ${y}l${f(-9 * Math.cos(a) + 5.5 * Math.sin(a))} ${f(-9 * Math.sin(a) - 5.5 * Math.cos(a))}l${f(-11 * Math.sin(a))} ${f(11 * Math.cos(a))}z" fill="currentColor"/>`;
    const sw = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
    if (it.k === 'c') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 38C10 8 30 40 38 12" ${sw}/>${head(41, 6, -1.2)}</svg>`;
    if (it.k === 'e') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 38H24V12H36" ${sw}/>${head(43, 12, 0)}</svg>`;
    const a = -Math.PI / 4;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M${it.ha ? 12 : 7} ${it.ha ? 36 : 41}L${it.hb ? 36 : 41} ${it.hb ? 12 : 7}" ${sw}/>${it.hb ? head(42, 6, a) : ''}${it.ha ? head(6, 42, a + Math.PI) : ''}</svg>`;
  }
  const w0 = it.w || 150, h0 = it.h || 150, s = 40 / Math.max(w0, h0), w = w0 * s, h = h0 * s;
  const { d, eo } = shapePath({ ...it, w, h, rad: it.rad ? it.rad * s : 0 });
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path transform="translate(${f((48 - w) / 2)} ${f((48 - h) / 2)})" d="${d}" fill="currentColor" ${eo ? 'fill-rule="evenodd"' : ''}/></svg>`;
}
