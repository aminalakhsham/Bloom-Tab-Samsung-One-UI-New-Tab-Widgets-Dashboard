// Minesweeper logic for Gaming Hub: boards, the safe first click, flood fill, chording and the daily board. Pure
// (no DOM, no storage) so the dev tests can import it in plain Node. Cells are numbered row by row: i = y * w + x.
import { rng, shuffle } from './rand.js';

export const LEVELS = {
  beginner: { w: 9, h: 9, mines: 10 },
  intermediate: { w: 16, h: 16, mines: 40 },
  expert: { w: 30, h: 16, mines: 99 },
};

export function neighbors(w, h, i) {
  const x = i % w, y = (i / w) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
  }
  return out;
}

/** Lays `n` mines with a seeded generator, keeping `safe` and its neighbours clear (the first click always opens an
 *  area, as classic Minesweeper does). Returns an array of 0/1. */
export function layMines(w, h, n, seed, safe = -1) {
  const keep = new Set(safe >= 0 ? [safe, ...neighbors(w, h, safe)] : []);
  const spots = shuffle(Array.from({ length: w * h }, (_, i) => i).filter(i => !keep.has(i)), rng(seed));
  const m = new Array(w * h).fill(0);
  for (const i of spots.slice(0, n)) m[i] = 1;
  return m;
}

/** Mines around each cell. */
export function counts(w, h, mines) {
  return mines.map((_, i) => neighbors(w, h, i).reduce((s, j) => s + mines[j], 0));
}

/** The daily board: the same mines for everyone, plus a start cell with no mines around it that the game opens
 *  first, so nobody's day ends on a first-click mine and every player starts from the same opening. */
export function dailyBoard(seed, level = 'intermediate') {
  const L = LEVELS[level] || LEVELS.intermediate, r = rng(seed ^ 0x5bd1e995);
  // the start sits away from the edges, where an opening is larger and more useful
  const x = 2 + Math.floor(r() * (L.w - 4)), y = 2 + Math.floor(r() * (L.h - 4)), start = y * L.w + x;
  return { ...L, mines: layMines(L.w, L.h, L.mines, seed, start), start };
}

/** Opens cell i (flood-filling through zeros, skipping flags). Mutates `open`; returns the opened cells, in order. */
export function reveal(w, h, mines, cnt, open, flags, i) {
  if (open[i] || flags[i]) return [];
  const out = [], stack = [i];
  open[i] = 1; out.push(i);
  if (mines[i]) return out;
  while (stack.length) {
    const c = stack.pop();
    if (cnt[c]) continue;
    for (const j of neighbors(w, h, c)) {
      if (open[j] || flags[j] || mines[j]) continue;
      open[j] = 1; out.push(j);
      stack.push(j);
    }
  }
  return out;
}

/** Chording: on an open number with as many flags around it, opens the rest of its neighbours. Returns the opened cells
 *  (a wrong flag can make this open a mine), or [] when the flags don't match the number. */
export function chord(w, h, mines, cnt, open, flags, i) {
  if (!open[i] || !cnt[i]) return [];
  const nb = neighbors(w, h, i);
  if (nb.filter(j => flags[j]).length !== cnt[i]) return [];
  return nb.flatMap(j => reveal(w, h, mines, cnt, open, flags, j));
}

export const isWon = (mines, open) => mines.every((m, i) => m || open[i]);
