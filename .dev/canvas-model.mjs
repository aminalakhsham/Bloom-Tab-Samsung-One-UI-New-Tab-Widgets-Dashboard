// Canvas' pure logic without a browser: data clean-up, compact items, connectors, copies, the 30-day Recycle bin,
// lasso, align/arrange/group, ink and erasers, Auto shape, the shape set.
// usage: node .dev/canvas-model.mjs
import * as M from '../js/canvas/model.js';
import { makeInk, eraseSplit, hitInk, inkPath, worldPoints, recognize } from '../js/canvas/ink.js';
import { scalePath, shapePath, LIBRARY, LINES } from '../js/canvas/shapes.js';

let fails = 0, n = 0;
const ok = (c, what) => { n++; console.log(c ? '  ok' : 'FAIL', what); if (!c) fails++; };

// tolerates broken data
const norm = M.normBoards([null, 'x', { id: 'a', name: 5, items: [{ id: 'i', t: 'note', x: 'oops' }, { t: 'note' }, 7], scenes: [{ id: 's', w: 0, h: 1 }] }, { id: 'a' }, { id: 'b' }]);
ok(norm.length === 2 && norm[0].name === '5' && norm[0].items.length === 1 && norm[0].items[0].x === 0 && norm[0].items[0].w === 100 && !norm[0].scenes.length && Array.isArray(norm[1].items), 'normBoards keeps what it can read');
ok(M.normBoards({}).length === 0 && M.normBoards(null).length === 0, 'normBoards: not a list');

// compact items
const c = M.clean({ id: 'i', t: 'shape', x: 1.234, y: 2, w: 10, h: 10, r: 0, lk: false, op: 1, b: false, fill: '#fff', tx: '' });
ok(!('r' in c) && !('lk' in c) && !('op' in c) && !('b' in c) && c.x === 1.2 && !('tx' in c), 'clean drops defaults and rounds');
ok(M.clean({ id: 'n', t: 'note', x: 0, y: 0, w: 1, h: 1, tx: '' }).tx === '', 'notes keep an empty text');

// connectors
const a = { id: 'a', t: 'note', x: 0, y: 0, w: 100, h: 100 }, b = { id: 'b', t: 'note', x: 300, y: 0, w: 100, h: 100 };
const ln = { id: 'l', t: 'line', a: { id: 'a', s: 'auto' }, b: { id: 'b', s: 'auto' }, hb: true };
let byId = new Map([a, b, ln].map((i) => [i.id, i]));
let g = M.lineGeom(ln, byId);
ok(Math.abs(g.A.x - 105) < 0.01 && Math.abs(g.B.x - 295) < 0.01 && g.A.y === 50, 'auto sides face each other, just short of the items');
ok(g.heads.length === 1 && /^M/.test(g.d), 'one arrow head');
const b2 = { ...b, y: 400 };
byId = new Map([a, b2, ln].map((i) => [i.id, i]));
g = M.lineGeom(ln, byId);
ok(Math.abs(g.A.y - 105) < 0.01 && Math.abs(g.B.y - 395) < 0.01, 'the connector follows a moved item (now bottom and top)');
g = M.lineGeom({ ...ln, k: 'e' }, byId);
ok(g.pts.length >= 3 && g.pts.every((p, i) => !i || p[0] === g.pts[i - 1][0] || p[1] === g.pts[i - 1][1]), 'elbow connectors only turn at right angles');
g = M.lineGeom({ ...ln, k: 'c' }, byId);
ok(/C/.test(g.d) && g.ctrl.length === 2 && M.linePoly(g).length === 25, 'curved connectors are Béziers (sampled for hit tests)');
const rot = { ...a, r: 90 };
ok(Math.abs(M.sideOf(rot, 'e').y - 100) < 0.01 && Math.abs(M.sideOf(rot, 'e').x - 50) < 0.01, 'sides turn with the item');
ok(M.distToLine(M.lineGeom(ln, new Map([a, b, ln].map((i) => [i.id, i]))), 200, 52) < 3, 'distance to a connector');

// copies
const copies = M.copyItems([a, ln], [a, b, ln], 10, 10);
ok(copies[0].id !== 'a' && copies[0].x === 10 && copies[1].a.id === copies[0].id && !copies[1].b.id && Math.abs(copies[1].b.x - 305) < 0.01, 'a copy keeps connections inside it and loosens the rest');
const dup = M.duplicateBoard({ id: 'x', name: 'X', fav: true, thumb: { l: 1 }, items: [{ ...a, g: 'g1' }, { ...b, g: 'g1' }, ln], scenes: [{ id: 's1', x: 0, y: 0, w: 1, h: 1 }] }, 'X copy');
ok(dup.id !== 'x' && !dup.fav && !dup.thumb && dup.items[0].g === dup.items[1].g && dup.items[0].g !== 'g1' && dup.items[2].a.id === dup.items[0].id && dup.scenes[0].id !== 's1', 'duplicateBoard: new ids, same groups and connections');

// boards, Recycle bin, blob keys
const now = Date.now();
const { keep, gone } = M.purge([{ id: 1 }, { id: 2, deleted: now - 31 * M.DAY }, { id: 3, deleted: now - 29 * M.DAY }], now);
ok(keep.length === 2 && gone[0].id === 2, 'purge: over 30 days in the Recycle bin');
ok(M.daysLeft({ deleted: now - 2 * M.DAY }, now) === 28 && M.daysLeft({ deleted: now - 30 * M.DAY + 1000 }, now) === 1, 'days left');
ok(M.freshName([{ name: 'Untitled board' }, { name: 'Untitled board 2' }, { name: 'Untitled board 3', deleted: 1 }], 'Untitled board') === 'Untitled board 3', 'Untitled board, Untitled board 2, …');
const id = M.imageId(now);
ok(id.startsWith('canvas:img-') && Math.abs(M.bornAt(id) - now) < 1 && Math.abs(M.bornAt(M.thumbId('b1', 'l', now)) - now) < 1 && M.bornAt('canvas:other') === 0, 'blob keys are canvas:… and carry their time');
ok([...M.blobsOf({ items: [{ t: 'img', b: 'x' }, { t: 'note' }], thumb: { l: 'y', d: 'z' } })].join() === 'x,y,z', 'blobsOf');
ok(M.sortBoards([{ name: 'b10', at: 1 }, { name: 'b9', at: 2 }], 'name', 'en').map((x) => x.name).join() === 'b9,b10' && M.sortBoards([{ at: 1 }, { at: 3 }, { at: 2 }]).map((x) => x.at).join() === '3,2,1', 'sort by title (numeric) and date');
ok(M.boardMatches({ name: 'Trip', items: [{ t: 'note', tx: 'Pack the CAMERA' }] }, 'camera') && !M.boardMatches({ name: 'Trip', items: [] }, 'camera') && M.boardMatches({ name: 'x', items: [{ t: 'link', u: 'https://samsung.com' }] }, 'samsung'), 'search looks at names, text and links');
ok(M.dirOf('مرحبا Hello') === 'rtl' && M.dirOf('Hello مرحبا') === 'ltr' && M.dirOf('123') === 'ltr', 'paragraph direction');
ok(M.shortUrl('https://www.samsung.com/galaxy/') === 'samsung.com/galaxy' && M.hostOf('https://www.samsung.com/x') === 'samsung.com', 'link card address');

// lasso, snapping, arranging
const sq = [[-10, -10], [150, -10], [150, 150], [-10, 150]];
ok(M.pointInPoly(50, 50, sq) && !M.pointInPoly(200, 50, sq), 'point in polygon');
const inkA = makeInk('pen', 'auto', 3, Array.from({ length: 20 }, (_, i) => [i * 5, 40, 0.5]));
const inkFar = makeInk('pen', 'auto', 3, Array.from({ length: 20 }, (_, i) => [300 + i * 5, 40, 0.5]));
const hits = M.lassoHits([a, b, inkA, inkFar], sq, new Map([a, b, inkA, inkFar].map((i) => [i.id, i])), (it) => worldPoints(it));
ok(hits.includes('a') && hits.includes(inkA.id) && !hits.includes('b') && !hits.includes(inkFar.id), 'the lasso takes what it goes round');
ok(M.snapTo(37) === 48 && M.snapTo(35) === 24 && M.snapTo(-13) === -24, 'snap to a 24 grid');
const c3 = { id: 'c', t: 'shape', x: 50, y: 300, w: 40, h: 40 };
const all3 = [a, b, c3], by3 = new Map(all3.map((i) => [i.id, i]));
const al = M.alignMap(all3, 'l', by3);
ok(al.get('b').x === 0 && al.get('c').x === 0 && al.get('a').x === 0, 'align left');
const dh = M.alignMap(all3, 'dh', by3);
ok(dh.get('a').x === 0 && dh.get('b').x === 300 && dh.get('c').x === 180, 'distribute horizontally evens the gaps');
ok(M.alignMap([a], 'l', by3).size === 0 && M.alignMap([a, ln], 't', byId).size === 0, 'align needs two items (lines left out)');
const ids = (l) => l.map((i) => i.id).join('');
ok(ids(M.arrange(all3, new Set(['a']), 'front')) === 'bca' && ids(M.arrange(all3, new Set(['c']), 'back')) === 'cab' && ids(M.arrange(all3, new Set(['a']), 'fwd')) === 'bac' && ids(M.arrange(all3, new Set(['c']), 'bwd')) === 'acb', 'bring to front / send to back / forward / backward');
const grouped = M.groupItems([a, c3, b], new Set(['a', 'b']), 'g1');
ok(ids(grouped) === 'cab' && grouped.filter((i) => i.g === 'g1').length === 2, 'a group stays together at its frontmost member');
const removed = M.removeItems([a, b, ln], new Set(['b']));
ok(removed.length === 2 && removed[1].a.id === 'a' && !removed[1].b.id && removed[1].b.x > 200, 'deleting an item leaves its connectors ending where it was');

// ink
const pts = Array.from({ length: 30 }, (_, i) => [i * 4, 10 + Math.sin(i / 3) * 6, 0.3 + i / 60]);
const ink = makeInk('pen', 'auto', 3, pts);
ok(ink.p.length % 3 === 0 && ink.p.length < pts.length * 3 + 1 && ink.w > 100, 'makeInk stores the points inside its box (simplified)');
ok(hitInk(ink, 60, 10 + Math.sin(5) * 6, 2), 'hitInk on the stroke');
ok(!hitInk(ink, 60, 80, 3), 'hitInk off the stroke');
const parts = eraseSplit(ink, 60, 10 + Math.sin(5) * 6, 6);
ok(parts && parts.length === 2 && parts.every((p) => p.t === 'ink'), 'erasing by area cuts a stroke in two');
ok(eraseSplit(ink, 60, 200, 6) === null, 'the eraser leaves strokes it does not touch');
ok(inkPath(ink).fill && inkPath(makeInk('marker', '#f00', 8, pts)).fill === false && inkPath(makeInk('hl', '#ff0', 22, pts)).fill === false, 'pens are outlines, markers and highlighters are lines');
const straight = Array.from({ length: 20 }, (_, i) => [i * 8, i * 8, 0.5]), across = Array.from({ length: 20 }, (_, i) => [i * 8, 160 - i * 8, 0.5]);
const width = (P) => { const it = makeInk('cal', 'auto', 10, P, false), d = inkPath(it).d; return d.length; };
ok(width(straight) > 0 && inkPath(makeInk('cal', 'auto', 10, straight, false)).d !== inkPath(makeInk('cal', 'auto', 10, across, false)).d, 'the calligraphy nib draws by direction');

// Auto shape
const circle = [];
for (let i = 0; i <= 60; i++) { const t = (i / 60) * Math.PI * 2 + 0.3; circle.push([200 + Math.cos(t) * 80, 200 + Math.sin(t) * 60, 0.5]); }
const side = (P0, P1, k) => Array.from({ length: k }, (_, i) => [P0[0] + ((P1[0] - P0[0]) * i) / k, P0[1] + ((P1[1] - P0[1]) * i) / k, 0.5]);
const box = [...side([0, 0], [100, 0], 15), ...side([100, 0], [100, 80], 15), ...side([100, 80], [0, 80], 15), ...side([0, 80], [0, 0], 15), [2, 2, 0.5]];
const tri = [...side([50, 0], [100, 90], 15), ...side([100, 90], [0, 90], 15), ...side([0, 90], [50, 0], 15), [51, 2, 0.5]];
const line = Array.from({ length: 20 }, (_, i) => [i * 10, i * 4, 0.5]);
const scribble = Array.from({ length: 40 }, (_, i) => [i * 5, Math.sin(i) * 30, 0.5]);
const rc = recognize(circle), rb = recognize(box), rt = recognize(tri), rl = recognize(line);
ok(rc?.k === 'oval' && Math.abs(rc.w - 160) < 2 && Math.abs(rc.h - 120) < 2, 'Auto shape: a rough circle becomes an oval');
ok(rb?.k === 'rect' && Math.abs(rb.w - 100) < 1 && Math.abs(rb.h - 80) < 1, 'Auto shape: a box becomes a rectangle');
ok(rt?.k === 'pg' && rt.pp.length === 6, 'Auto shape: a triangle keeps its three corners');
ok(rl?.k === 'line' && rl.a.x === 0 && rl.b.x === 190, 'Auto shape: a straight stroke becomes a line');
ok(recognize(scribble) === null && recognize(line.slice(0, 3)) === null, 'Auto shape leaves drawings alone');

// shapes
ok(scalePath('M0 0L100 100A10 10 0 0 1 50 50Z', 2, 0.5) === 'M0 0L200 50A20 5 0 0 1 100 25Z', 'scalePath scales absolute commands and arc radii');
const lib = LIBRARY.flatMap((x) => x.items);
ok(lib.length >= 55 && new Set(lib.map((e) => e.id)).size === lib.length && lib.every((e) => /^canvas\.sh\./.test(e.name)), 'the shape set: unique ids with i18n names');
ok(lib.every((e) => shapePath({ ...e.item, w: 120, h: 90 }).d.startsWith('M')), 'every shape draws');
ok(shapePath({ k: 'pg', pp: [0.5, 0, 1, 1, 0, 1], w: 100, h: 50 }).d === 'M50 0L100 50L0 50Z', 'recognised polygons draw at their size');
ok(LINES.length === 5 && LINES.every((l) => l.item.t === 'line'), 'line kinds');

console.log(fails ? `\n==== ${fails} of ${n} FAILED` : `\n==== all ${n} ok`);
process.exit(fails ? 1 : 0);
