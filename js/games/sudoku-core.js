// Sudoku logic for Gaming Hub: a generator that always gives a puzzle with exactly one solution, a fast solver
// that counts solutions, and a human-style solver that grades puzzles and finds hints. Pure (no DOM, no storage), so
// the dev tests can import it in plain Node. A grid is an array of 81 digits, row by row, with 0 for an empty cell.
import { rng, shuffle } from './rand.js';

export const LEVELS = ['easy', 'medium', 'hard', 'expert'];
// Givens to aim for, the techniques a player may need (`tech`) and the ones that must not be enough (`hard`): Easy
// and Medium fall to singles alone, Hard needs locked candidates or naked pairs, Expert needs more than that (chains or
// a guess) and keeps as few givens as it can while staying unique.
const SPEC = {
  easy: { clues: 38, tech: 1 },
  medium: { clues: 31, tech: 1 },
  hard: { clues: 26, tech: 2, hard: 1 },
  expert: { clues: 17, tech: 9, hard: 2 },
};

export const ROW = i => (i / 9) | 0;
export const COL = i => i % 9;
export const BOX = i => ((i / 27) | 0) * 3 + (((i % 9) / 3) | 0);
// the 27 houses (rows, columns, boxes) and the 20 peers of every cell
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) UNITS.push(Array.from({ length: 9 }, (_, k) => (((b / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (b % 3) * 3 + (k % 3)));
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const s = new Set();
  for (let j = 0; j < 81; j++) if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) s.add(j);
  return [...s];
});
const BOXOF = Array.from({ length: 81 }, (_, i) => BOX(i));
const POP = new Uint8Array(1024).map((_, m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; });
const digitsOf = m => { const out = []; for (let v = 1; v <= 9; v++) if (m & (1 << v)) out.push(v); return out; };

/** Counts solutions up to `limit` (2 is enough to prove uniqueness). With `r`, digits are tried in a seeded order, which
 *  is how a full random grid is made. Returns { count, solution } (the first solution found). */
export function solve(grid, limit = 2, r = null) {
  const g = Array.from(grid), R = new Int32Array(9), C = new Int32Array(9), B = new Int32Array(9), empties = [];
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (!v) { empties.push(i); continue; }
    const m = 1 << v, ro = ROW(i), co = COL(i), bo = BOXOF[i];
    if ((R[ro] | C[co] | B[bo]) & m) return { count: 0, solution: null };
    R[ro] |= m; C[co] |= m; B[bo] |= m;
  }
  let count = 0, solution = null;
  const rec = k => {
    if (k === empties.length) { count++; solution ||= g.slice(); return count >= limit; }
    // always branch on the cell with the fewest candidates: it keeps the search tiny even on 17-clue grids
    let best = k, bestM = 0, bestN = 10;
    for (let j = k; j < empties.length; j++) {
      const i = empties[j], m = ~(R[ROW(i)] | C[COL(i)] | B[BOXOF[i]]) & 0x3FE, n = POP[m];
      if (n < bestN) { bestN = n; best = j; bestM = m; if (n <= 1) break; }
    }
    if (!bestN) return false;
    [empties[k], empties[best]] = [empties[best], empties[k]];
    const i = empties[k], ro = ROW(i), co = COL(i), bo = BOXOF[i];
    const cands = digitsOf(bestM);
    if (r) shuffle(cands, r);
    for (const v of cands) {
      const m = 1 << v;
      g[i] = v; R[ro] |= m; C[co] |= m; B[bo] |= m;
      const stop = rec(k + 1);
      g[i] = 0; R[ro] &= ~m; C[co] &= ~m; B[bo] &= ~m;
      if (stop) return true;
    }
    return false;
  };
  rec(0);
  return { count, solution };
}

/** Candidate masks (bit v set = digit v possible) for every empty cell of a grid; 0 for filled cells. */
export function candidates(grid) {
  const c = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let used = 0;
    for (const p of PEERS[i]) if (grid[p]) used |= 1 << grid[p];
    c[i] = ~used & 0x3FE;
  }
  return c;
}

/** Solves like a person does, with techniques up to `tech` (1 = naked and hidden singles, 2 = + locked candidates and
 *  naked pairs). Returns { solved, grid, steps: [{ i, v, how }] } — the first step is the hint a player can find next. */
export function logicSolve(grid, tech = 2) {
  const g = Array.from(grid), cand = candidates(g), steps = [];
  const place = (i, v, how) => {
    g[i] = v; cand[i] = 0; steps.push({ i, v, how });
    for (const p of PEERS[i]) cand[p] &= ~(1 << v);
  };
  for (;;) {
    let progress = false;
    for (let i = 0; i < 81; i++) if (!g[i] && POP[cand[i]] === 1) { place(i, digitsOf(cand[i])[0], 'naked'); progress = true; }
    if (progress) continue;
    for (const u of UNITS) {
      for (let v = 1; v <= 9; v++) {
        const m = 1 << v;
        let at = -1, n = 0;
        for (const i of u) { if (g[i] === v) { n = -1; break; } if (cand[i] & m) { n++; at = i; } }
        if (n === 1) { place(at, v, 'hidden'); progress = true; }
      }
    }
    if (progress) continue;
    if (tech >= 2) {
      // locked candidates: a digit confined to one line inside a box (or to one box inside a line) leaves the rest
      for (let b = 0; b < 9 && !progress; b++) {
        const box = UNITS[18 + b];
        for (let v = 1; v <= 9 && !progress; v++) {
          const m = 1 << v, cells = box.filter(i => cand[i] & m);
          if (cells.length < 2) continue;
          for (const [lineOf, base] of [[ROW, 0], [COL, 9]]) {
            const l = lineOf(cells[0]);
            if (!cells.every(i => lineOf(i) === l)) continue;
            for (const i of UNITS[base + l]) if (BOXOF[i] !== b && cand[i] & m) { cand[i] &= ~m; progress = true; }
          }
        }
      }
      for (let u = 0; u < 18 && !progress; u++) {
        for (let v = 1; v <= 9 && !progress; v++) {
          const m = 1 << v, cells = UNITS[u].filter(i => cand[i] & m);
          if (cells.length < 2 || !cells.every(i => BOXOF[i] === BOXOF[cells[0]])) continue;
          for (const i of UNITS[18 + BOXOF[cells[0]]]) if (!UNITS[u].includes(i) && cand[i] & m) { cand[i] &= ~m; progress = true; }
        }
      }
      // naked pairs: two cells of a house that can only be the same two digits take them from the others
      for (const u of UNITS) {
        if (progress) break;
        const pairs = u.filter(i => !g[i] && POP[cand[i]] === 2);
        for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
          const m = cand[pairs[a]];
          if (m !== cand[pairs[b]]) continue;
          for (const i of u) if (i !== pairs[a] && i !== pairs[b] && cand[i] & m) { cand[i] &= ~m; progress = true; }
        }
      }
    }
    if (!progress) break;
  }
  return { solved: g.every(Boolean), grid: g, steps };
}

/** A new puzzle for a level from a seed: { puzzle, solution, level, clues } (strings of 81 digits, 0 = empty).
 *  The same seed and level always give the same puzzle, so the daily Sudoku matches on every computer. */
export function generate(seed, level = 'medium') {
  const spec = SPEC[level] || SPEC.medium, r = rng(seed);
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const solution = solve(new Array(81).fill(0), 1, r).solution;
    const g = solution.slice();
    // cells come out in pairs that mirror through the centre, the classic 180° symmetric look
    const order = shuffle(Array.from({ length: 41 }, (_, i) => i), r);
    let clues = 81;
    for (const i of order) {
      if (clues <= spec.clues) break;
      const j = 80 - i, a = g[i], b = g[j];
      g[i] = 0; g[j] = 0;
      const ok = solve(g, 2).count === 1 && (spec.tech > 2 || logicSolve(g, spec.tech).solved);
      if (ok) clues -= i === j ? 1 : 2; else { g[i] = a; g[j] = b; }
    }
    last = { puzzle: g.join(''), solution: solution.join(''), level, clues };
    // a grid that can't be thinned enough, or that simpler techniques already solve, tries again with the next seed
    // numbers (still deterministic, so the daily puzzle stays the same everywhere)
    if ((level === 'expert' || clues <= spec.clues + 2) && !(spec.hard && logicSolve(g, spec.hard).solved)) return last;
  }
  return last;
}

/** Cells whose digit clashes with a peer (for showing mistakes when the solution isn't used). */
export function conflicts(grid) {
  const bad = new Set();
  for (const u of UNITS) {
    const seen = {};
    for (const i of u) { const v = grid[i]; if (!v) continue; if (seen[v] != null) { bad.add(i); bad.add(seen[v]); } else seen[v] = i; }
  }
  return bad;
}
