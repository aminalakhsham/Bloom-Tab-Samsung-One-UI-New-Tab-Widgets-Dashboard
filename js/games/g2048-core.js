// 2048 logic for Gaming Hub. Tiles keep an id while they slide, so the board can animate them; a merge removes the
// two tiles and adds a new one. Pure (no DOM, no storage) so the dev tests can import it in plain Node.
//   state = { n: 4, tiles: [{ id, v, x, y }], next: id counter, score }
export const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export const empty = (n = 4) => ({ n, tiles: [], next: 1, score: 0 });
const at = (s, x, y) => s.tiles.find(t => t.x === x && t.y === y);

/** Adds a 2 (90%) or a 4 on a random free cell. Returns the new tile, or null when the board is full. */
export function spawn(s, r = Math.random) {
  const free = [];
  for (let y = 0; y < s.n; y++) for (let x = 0; x < s.n; x++) if (!at(s, x, y)) free.push([x, y]);
  if (!free.length) return null;
  const [x, y] = free[Math.floor(r() * free.length)];
  const t = { id: s.next++, v: r() < .9 ? 2 : 4, x, y };
  s.tiles.push(t);
  return t;
}

/** Slides every tile toward `dir`. Returns a new state plus what the board needs to animate:
 *  { state, moved, gained, merged: [new tile ids], gone: [{ id, x, y }] (tiles that slid into a merge and vanish) }. */
export function slide(s0, dir) {
  const [dx, dy] = DIRS[dir], n = s0.n;
  const s = { ...s0, tiles: s0.tiles.map(t => ({ ...t })) };
  const grid = Array.from({ length: n }, () => new Array(n).fill(null));
  for (const t of s.tiles) grid[t.y][t.x] = t;
  const xs = [...Array(n).keys()], ys = [...Array(n).keys()];
  if (dx > 0) xs.reverse();
  if (dy > 0) ys.reverse();
  const fresh = new Set(), gone = [], merged = [];
  let moved = false, gained = 0;
  for (const y of ys) for (const x of xs) {
    const t = grid[y][x];
    if (!t) continue;
    let nx = x, ny = y;
    while (nx + dx >= 0 && nx + dx < n && ny + dy >= 0 && ny + dy < n && !grid[ny + dy][nx + dx]) { nx += dx; ny += dy; }
    const bx = nx + dx, by = ny + dy;
    const o = bx >= 0 && bx < n && by >= 0 && by < n ? grid[by][bx] : null;
    grid[y][x] = null;
    if (o && o.v === t.v && !fresh.has(o.id)) {
      // both tiles slide to the meeting cell and are replaced by one tile of twice the value (a tile merges once a move)
      const m = { id: s.next++, v: t.v * 2, x: bx, y: by };
      gone.push({ id: t.id, x: bx, y: by }, { id: o.id, x: bx, y: by });
      grid[by][bx] = m; fresh.add(m.id); merged.push(m.id);
      gained += m.v; moved = true;
    } else {
      grid[ny][nx] = t;
      if (nx !== x || ny !== y) { t.x = nx; t.y = ny; moved = true; }
    }
  }
  s.tiles = grid.flat().filter(Boolean);
  s.score = (s0.score || 0) + gained;
  return { state: s, moved, gained, merged, gone };
}

export const maxTile = s => s.tiles.reduce((m, t) => Math.max(m, t.v), 0);
/** No free cell and no two equal neighbours: no move can change the board. */
export function canMove(s) {
  if (s.tiles.length < s.n * s.n) return true;
  return s.tiles.some(t => s.tiles.some(o => o.v === t.v && Math.abs(o.x - t.x) + Math.abs(o.y - t.y) === 1));
}
