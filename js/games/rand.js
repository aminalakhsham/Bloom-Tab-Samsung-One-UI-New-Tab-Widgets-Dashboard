// Seeded randomness and calendar days for Gaming Hub. A daily puzzle is built from dailySeed(gameId) with these helpers,
// so everyone gets the same board on the same day without a server; a normal game just starts from a random seed. Pure:
// no DOM, no storage.

/** mulberry32: a small, fast generator with good spread; returns floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (r, n) => Math.floor(r() * n);
/** Fisher–Yates in place; with a seeded `r` the order is the same everywhere. */
export function shuffle(a, r = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const newSeed = () => (Math.random() * 4294967296) >>> 0;

// ------------------------------------------------------------------ days
// Daily puzzles, streaks and challenges are keyed by the local calendar day ("2026-10-26").
const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDateKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
/** Seed for a daily puzzle: the same for everyone on the same day, different for each game (FNV-1a of id + day). */
export function dailySeed(gameId, day = dateKey()) {
  let h = 2166136261;
  for (const c of gameId + day) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
