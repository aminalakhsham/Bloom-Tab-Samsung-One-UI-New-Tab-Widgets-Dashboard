// Plain-Node checks of Gaming Hub's pure logic: the Sudoku generator (valid, unique, graded, deterministic),
// Minesweeper boards (safe first click, flood fill, chording, the daily board), 2048 slides and merges, Klondike rules
// and its solver (the winnable Daily deal), and the daily seeds and day keys.
// usage: node .dev/games-logic.mjs
import { generate, solve, logicSolve, UNITS, LEVELS as SL } from '../js/games/sudoku-core.js';
import { LEVELS as ML, layMines, counts, reveal, chord, isWon, dailyBoard, neighbors } from '../js/games/mines-core.js';
import { empty, slide, spawn, canMove, maxTile } from '../js/games/g2048-core.js';
import { rng, dailySeed, dateKey, parseDateKey } from '../js/games/rand.js';
import * as K from '../js/games/cards-klondike.js';

let fails = 0, n = 0;
const ok = (c, what) => { n++; if (!c) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };

// ---------------------------------------------------------------- Sudoku
const validSolution = s => UNITS.every(u => new Set(u.map(i => s[i])).size === 9) && s.every(v => v >= 1 && v <= 9);
for (const lv of SL) {
  let unique = 0, valid = 0, match = 0, ms = 0, clues = [];
  for (let k = 1; k <= 12; k++) {
    const t0 = performance.now(), p = generate(k * 104729 + lv.length, lv);
    ms = Math.max(ms, performance.now() - t0);
    const g = [...p.puzzle].map(Number), sol = [...p.solution].map(Number);
    clues.push(p.clues);
    if (solve(g, 2).count === 1) unique++;
    if (validSolution(sol)) valid++;
    if (g.every((v, i) => !v || v === sol[i])) match++;
  }
  ok(unique === 12, `sudoku ${lv}: every puzzle has exactly one solution`);
  ok(valid === 12 && match === 12, `sudoku ${lv}: solutions are valid grids and the givens agree with them`);
  ok(ms < 1500, `sudoku ${lv}: generated in ${ms.toFixed(0)} ms at most (clues ${Math.min(...clues)}–${Math.max(...clues)})`);
}
const med = generate(4242, 'medium'), hard = generate(4242, 'hard'), exp = generate(4242, 'expert');
ok(logicSolve([...med.puzzle].map(Number), 1).solved, 'medium is solvable with singles alone');
ok(!logicSolve([...hard.puzzle].map(Number), 1).solved && logicSolve([...hard.puzzle].map(Number), 2).solved, 'hard needs more than singles but no guessing');
ok(!logicSolve([...exp.puzzle].map(Number), 2).solved, 'expert needs more than locked candidates and pairs');
ok(generate(20261016, 'medium').puzzle === generate(20261016, 'medium').puzzle, 'the same seed gives the same puzzle (daily)');
ok(generate(20261016, 'medium').puzzle !== generate(20261017, 'medium').puzzle, 'another seed gives another puzzle');
const two = [...med.puzzle].map(Number); two[two.findIndex(v => v)] = 0;
ok(solve([...'1'.padEnd(81, '0')].map(Number), 2).count === 2, 'the solver sees more than one solution');
ok(solve([1, 1, ...new Array(79).fill(0)], 2).count === 0, 'the solver rejects a broken grid');
ok(logicSolve([...med.puzzle].map(Number), 2).steps[0]?.v === +med.solution[logicSolve([...med.puzzle].map(Number), 2).steps[0].i], 'the hint step is the right digit');

// ---------------------------------------------------------------- Minesweeper
for (const [lv, L] of Object.entries(ML)) {
  let safe = 0;
  for (let k = 0; k < 40; k++) {
    const first = (k * 37) % (L.w * L.h), m = layMines(L.w, L.h, L.mines, k + 1, first);
    if (m.reduce((a, b) => a + b, 0) === L.mines && !m[first] && neighbors(L.w, L.h, first).every(j => !m[j])) safe++;
  }
  ok(safe === 40, `minesweeper ${lv}: ${L.w}×${L.h} with ${L.mines} mines, the first click and its neighbours are always clear`);
}
{
  const { w, h } = ML.beginner, m = layMines(w, h, 10, 7, 40), c = counts(w, h, m), open = new Array(w * h).fill(0), flags = new Array(w * h).fill(0);
  const got = reveal(w, h, m, c, open, flags, 40);
  ok(got.length > 1 && got.every(i => !m[i]), `the first click opens an area (${got.length} cells) and no mine`);
  ok(got.every(i => !c[i] || got.some(j => !c[j] && neighbors(w, h, j).includes(i)) || i === 40), 'the flood fill stops at numbers');
  // chord: flag every mine around an open number, then chording opens the rest of its neighbours
  const num = got.find(i => c[i]);
  for (const j of neighbors(w, h, num)) if (m[j]) flags[j] = 1;
  const before = open.reduce((a, b) => a + b, 0), opened = chord(w, h, m, c, open, flags, num);
  ok(opened.every(i => !m[i]) && open.reduce((a, b) => a + b, 0) === before + opened.length, 'chording opens the unflagged neighbours of a satisfied number');
  flags.fill(0);
  ok(chord(w, h, m, c, open, flags, num).length === 0, 'chording without enough flags does nothing');
  for (let i = 0; i < w * h; i++) if (!m[i]) reveal(w, h, m, c, open, flags, i);
  ok(isWon(m, open), 'opening every safe cell wins');
}
{
  const a = dailyBoard(123456, 'intermediate'), b = dailyBoard(123456, 'intermediate'), d = dailyBoard(654321, 'intermediate');
  ok(a.mines.join('') === b.mines.join('') && a.start === b.start, 'the daily board is the same for the same seed');
  ok(a.mines.join('') !== d.mines.join(''), 'another day gives another board');
  ok(a.w === 16 && a.h === 16 && a.mines.reduce((x, y) => x + y, 0) === 40, 'the daily board is Intermediate');
  const c = counts(a.w, a.h, a.mines);
  ok(!a.mines[a.start] && c[a.start] === 0, 'the daily start cell opens an area');
}

// ---------------------------------------------------------------- 2048
{
  const s = { n: 4, next: 10, score: 0, tiles: [{ id: 1, v: 2, x: 0, y: 0 }, { id: 2, v: 2, x: 1, y: 0 }, { id: 3, v: 2, x: 2, y: 0 }, { id: 4, v: 2, x: 3, y: 0 }, { id: 5, v: 4, x: 0, y: 1 }] };
  const r = slide(s, 'left');
  const row = r.state.tiles.filter(t => t.y === 0).sort((a, b) => a.x - b.x).map(t => t.v);
  ok(row.join(',') === '4,4', 'a row of four 2s slides left into 4, 4');
  ok(r.gained === 8 && r.state.score === 8, 'merges score their new value');
  ok(r.gone.length === 4 && r.merged.length === 2, 'merged tiles are replaced by new ones (for the animation)');
  const r2 = slide(r.state, 'left');
  ok(r2.state.tiles.find(t => t.y === 0).v === 8 && r2.state.tiles.filter(t => t.y === 0).length === 1, 'a tile merges once per move (4, 4 → 8 on the next move)');
  ok(!slide({ n: 4, next: 2, score: 0, tiles: [{ id: 1, v: 2, x: 0, y: 0 }] }, 'left').moved, 'a move that changes nothing is not a move');
  const r3 = slide({ n: 4, next: 9, score: 0, tiles: [{ id: 1, v: 4, x: 0, y: 3 }, { id: 2, v: 4, x: 0, y: 2 }, { id: 3, v: 4, x: 0, y: 1 }] }, 'down');
  ok(r3.state.tiles.map(t => `${t.v}@${t.y}`).sort().join(' ') === '4@2 8@3', 'three in a column merge the two nearest the wall first');
  const full = empty(4), r4 = rng(5);
  for (let i = 0; i < 16; i++) spawn(full, r4);
  ok(full.tiles.length === 16 && spawn(full, r4) === null, 'spawn fills the board and then stops');
  // a checkerboard of 2s and 4s on top, 16s and 32s below: full, and no two equal neighbours
  const stuck = { n: 4, next: 20, score: 0, tiles: Array.from({ length: 16 }, (_, i) => { const x = i % 4, y = (i / 4) | 0; return { id: i + 1, v: ((x + y) % 2 ? 4 : 2) * (y < 2 ? 1 : 8), x, y }; }) };
  ok(!canMove(stuck), 'a full board with no equal neighbours is game over');
  ok(maxTile({ tiles: [{ v: 2 }, { v: 2048 }] }) === 2048, 'the highest tile is found');
}

// ---------------------------------------------------------------- Solitaire (Klondike)
{
  const d = K.deal(K.deck(42), 1);
  ok(d.tab.every((c, i) => c.d.length === i && c.u.length === 1) && d.stock.length === 24, 'a deal has columns of 1…7 cards, the last face up, and 24 in the stock');
  ok(JSON.stringify(K.deal(K.deck(42), 1)) === JSON.stringify(d) && JSON.stringify(K.deal(K.deck(43), 1)) !== JSON.stringify(d), 'the same seed deals the same cards');
  ok(JSON.stringify(K.unpack(K.pack(d), 1)) === JSON.stringify(d), 'pack/unpack keeps a whole position (Undo history)');
  ok(K.solve(K.deal(K.deck(12345), 1), { maxNodes: 20000 }) === true, 'the solver wins a known deal');
  const ws = K.winnableSeed(777, 1, { maxNodes: 1500 });
  ok(ws.proved && ws.seed === K.winnableSeed(777, 1, { maxNodes: 1500 }).seed, 'winnableSeed finds a proven deal, the same one every time (the Daily deal)');
  const dead = { draw: 1, stock: [], waste: [], found: [[], [], [], []], tab: [{ d: [1, 2, 3], u: [26 + 4] }, { d: [], u: [26 + 12] }, ...Array(5).fill(0).map(() => ({ d: [], u: [] }))] };
  ok(K.stuck(dead), 'a dead position is recognised as stuck');
  ok(K.safeUp({ found: [[0], [], [], []] }, 1), 'a two always goes up safely');
  ok(K.fitsTab({ tab: [{ d: [], u: [13 + 8] }] }, 7, 0) && !K.fitsTab({ tab: [{ d: [], u: [13 + 8] }] }, 13 + 7, 0), 'a black 8 goes on a red 9, a red 8 does not');
  ok(K.fitsTab({ tab: [{ d: [], u: [] }] }, 12, 0) && !K.fitsTab({ tab: [{ d: [], u: [] }] }, 11, 0), 'only a king goes in an empty column');
  ok(K.reachable({ draw: 3, stock: [0, 1, 2, 3, 4, 5, 6], waste: [] }).length < 7, 'Draw 3 reaches only every third card of the stock');
}

// ---------------------------------------------------------------- daily seeds and days
{
  const fnv = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  ok(dailySeed('sudoku', '2026-10-26') === fnv('sudoku2026-10-26') && dailySeed('sudoku', '2026-10-26') !== dailySeed('minesweeper', '2026-10-26'), 'the daily seed is FNV-1a of game and date, different for each game');
  ok(dateKey(new Date(2026, 0, 5)) === '2026-01-05' && +parseDateKey('2026-01-05') === +new Date(2026, 0, 5), 'day keys round-trip');
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
