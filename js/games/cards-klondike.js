// Klondike rules for Solitaire, plus a solver that proves a deal can be won (for the Daily Deal) and finds hints.
// Pure (no DOM, no storage) so the game and the node checks share it.
//   state = { draw: 1|3, stock: [card…] (last = top), waste: [card…] (last = top),
//             found: [[card…] ×4] (any ace starts an empty foundation), tab: [{ d: [face-down…], u: [face-up…] } ×7] }
// Cards are numbers 0…51 as in cards.js.
import { suit, rank, isRed } from './cards.js';
import { rng, shuffle } from './rand.js';

/** A shuffled deck for a seed (the same deal everywhere for the same seed). */
export const deck = seed => shuffle([...Array(52).keys()], rng(seed));

/** Deals a deck: columns of 1…7 cards with the last one face up, the other 24 in the stock. */
export function deal(order, draw = 1) {
  const tab = Array.from({ length: 7 }, () => ({ d: [], u: [] }));
  let i = 0;
  for (let r = 0; r < 7; r++) for (let c = r; c < 7; c++) (r === c ? tab[c].u : tab[c].d).push(order[i++]);
  return { draw, stock: order.slice(i).reverse(), waste: [], found: [[], [], [], []], tab };
}

// A whole position in about 70 characters (a letter per card), so a saved game can keep every Undo step: 400 moves of
// history stay near 30 KB, where JSON snapshots would be ten times that.
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const enc = a => a.map(c => ABC[c]).join(''), dec = s => [...(s || '')].map(ch => ABC.indexOf(ch));
/** "stock|waste|f0|f1|f2|f3|d.u|d.u|…" (draw is kept by the game). */
export const pack = s => [enc(s.stock), enc(s.waste), ...s.found.map(enc), ...s.tab.map(c => enc(c.d) + '.' + enc(c.u))].join('|');
export function unpack(str, draw = 1) {
  const p = String(str).split('|');
  return { draw, stock: dec(p[0]), waste: dec(p[1]), found: p.slice(2, 6).map(dec), tab: p.slice(6, 13).map(x => { const [d, u] = x.split('.'); return { d: dec(d), u: dec(u) }; }) };
}

export const clone = s => ({ draw: s.draw, stock: s.stock.slice(), waste: s.waste.slice(), found: s.found.map(f => f.slice()), tab: s.tab.map(c => ({ d: c.d.slice(), u: c.u.slice() })) });

/** Can `card` go on foundation `slot`? */
export function fitsFound(s, card, slot) {
  const f = s.found[slot], top = f[f.length - 1];
  return top == null ? rank(card) === 1 : suit(top) === suit(card) && rank(card) === rank(top) + 1;
}
/** The foundation a card would go to: the one of its suit, else the first empty one for an ace; -1 if none. */
export function foundSlotFor(s, card) {
  for (let i = 0; i < 4; i++) if (s.found[i].length && fitsFound(s, card, i)) return i;
  return rank(card) === 1 ? s.found.findIndex(f => !f.length) : -1;
}
/** Can a run starting with `card` go on column `col`? */
export function fitsTab(s, card, col) {
  const c = s.tab[col], top = c.u[c.u.length - 1];
  if (top == null) return !c.d.length && rank(card) === 13;
  return isRed(top) !== isRed(card) && rank(top) === rank(card) + 1;
}
export const won = s => s.found.every(f => f.length === 13);
export const allUp = s => s.tab.every(c => !c.d.length);
/** A card that can go up without ever being needed on the tableau: aces, twos, and cards whose two opposite-colour
 *  foundations already hold the rank below (the usual "safe" auto-move rule). */
export function safeUp(s, card) {
  const r = rank(card);
  if (r <= 2) return true;
  const lv = [0, 0, 0, 0];
  for (const f of s.found) if (f.length) lv[suit(f[0])] = f.length;
  return isRed(card) ? lv[0] >= r - 1 && lv[2] >= r - 1 : lv[1] >= r - 1 && lv[3] >= r - 1;
}

/** The cards a player can reach in the stock and waste without moving anything else: every card in Draw 1; in Draw 3
 *  only every third card of a pass (plus the last), as dealt. */
export function reachable(s) {
  const all = [...s.waste].reverse().concat([...s.stock].reverse()); // waste top first, then the stock in dealing order
  if (s.draw === 1) return all;
  const out = new Set(); if (s.waste.length) out.add(s.waste[s.waste.length - 1]);
  // after the current waste, cards turn up every third of the stock; after a recycle, every third of the whole pile
  const st = [...s.stock].reverse();
  for (let i = 2; i < st.length; i += 3) out.add(st[i]);
  if (st.length) out.add(st[st.length - 1]);
  const pile = [...s.waste, ...st];
  for (let i = 2; i < pile.length; i += 3) out.add(pile[i]);
  if (pile.length) out.add(pile[pile.length - 1]);
  return [...out];
}

/**
 * Useful moves now, best first, for hints: [{ from: 'waste'|'tab'|'found'|'stock', col?, idx?, to: 'found'|'tab'|'stock', slot?, card }].
 * Leaves out moves that only shuffle cards around (a whole column onto another when nothing is under it).
 */
export function hints(s) {
  const out = [], tops = [];
  if (s.waste.length) tops.push({ from: 'waste', card: s.waste[s.waste.length - 1] });
  s.tab.forEach((c, col) => { if (c.u.length) tops.push({ from: 'tab', col, idx: c.u.length - 1, card: c.u[c.u.length - 1] }); });
  for (const t of tops) { const slot = foundSlotFor(s, t.card); if (slot >= 0) out.push({ ...t, to: 'found', slot, p: 10 + (t.from === 'tab' && t.idx === 0 && s.tab[t.col].d.length ? 2 : 0) }); }
  s.tab.forEach((c, col) => c.u.forEach((card, idx) => {
    for (let to = 0; to < 7; to++) {
      if (to === col || !fitsTab(s, card, to)) continue;
      const whole = idx === 0, empty = !s.tab[to].u.length;
      let p = 0;
      if (whole && c.d.length) p = 8;                                   // turns over a card
      else if (whole && !empty && rank(card) !== 13) p = 3;             // empties a column for a king
      else if (!whole && foundSlotFor(s, c.u[idx - 1]) >= 0) p = 6;      // frees a card for its foundation
      if (p) out.push({ from: 'tab', col, idx, to: 'tab', dest: to, card, p });
    }
  }));
  if (s.waste.length) { const card = s.waste[s.waste.length - 1]; for (let to = 0; to < 7; to++) if (fitsTab(s, card, to)) { out.push({ from: 'waste', card, to: 'tab', dest: to, p: s.tab[to].u.length ? 5 : 4 }); break; } }
  out.sort((a, b) => b.p - a.p);
  if (s.stock.length || s.waste.length > (s.draw === 1 ? 0 : 0)) {
    // drawing helps only if a card somewhere in the stock or waste could be played
    if (s.stock.length || reachable(s).some(card => foundSlotFor(s, card) >= 0 || s.tab.some((_, i) => fitsTab(s, card, i)))) out.push({ from: 'stock', to: 'stock', p: 1 });
  }
  return out;
}
/** True when nothing useful is left to do: no hint, and no card in the stock or waste could ever be played. */
export function stuck(s) {
  if (won(s)) return false;
  return !hints(s).length;
}

// ------------------------------------------------------------------ solver
// A depth-first search over a compact copy of the game: safe cards go up automatically, moves are tried best first,
// and positions already seen (with the columns in any order) are skipped. Gives up after `maxNodes`.
const key = s => s.f.join(',') + '|' + s.tab.map(c => c.d.length + ':' + c.u.join('.')).sort().join(';') + '|' + s.waste.join('.') + '|' + s.stock.join('.');
const cp = s => ({ draw: s.draw, f: s.f.slice(), stock: s.stock.slice(), waste: s.waste.slice(), tab: s.tab.map(c => ({ d: c.d, u: c.u })) });
const safeS = (s, card) => { const r = rank(card); return r <= 2 || (isRed(card) ? s.f[0] >= r - 1 && s.f[2] >= r - 1 : s.f[1] >= r - 1 && s.f[3] >= r - 1); };
const flip = c => { if (!c.u.length && c.d.length) { c.u = [c.d[c.d.length - 1]]; c.d = c.d.slice(0, -1); } };
function auto(s) {
  for (let changed = true; changed;) {
    changed = false;
    const w = s.waste[s.waste.length - 1];
    if (w != null && s.f[suit(w)] === rank(w) - 1 && safeS(s, w)) { s.waste.pop(); s.f[suit(w)]++; changed = true; }
    for (let i = 0; i < 7; i++) {
      const c = s.tab[i], t = c.u[c.u.length - 1];
      if (t != null && s.f[suit(t)] === rank(t) - 1 && safeS(s, t)) { c.u = c.u.slice(0, -1); flip(c); s.tab[i] = { d: c.d, u: c.u }; s.f[suit(t)]++; changed = true; }
    }
  }
}
const fitsT = (c, card) => { const top = c.u[c.u.length - 1]; return top == null ? !c.d.length && rank(card) === 13 : isRed(top) !== isRed(card) && rank(top) === rank(card) + 1; };
function children(s) {
  const out = [];
  const add = (p, f) => out.push([p, f]);
  // to the foundations (moves the safe rule didn't make)
  const w = s.waste[s.waste.length - 1];
  if (w != null && s.f[suit(w)] === rank(w) - 1) add(7, () => { const n = cp(s); n.waste.pop(); n.f[suit(w)]++; return n; });
  for (let i = 0; i < 7; i++) {
    const c = s.tab[i], t = c.u[c.u.length - 1];
    if (t != null && s.f[suit(t)] === rank(t) - 1) add(c.u.length === 1 && c.d.length ? 9 : 6, () => { const n = cp(s); const x = n.tab[i]; x.u = x.u.slice(0, -1); flip(x); n.f[suit(t)]++; return n; });
  }
  // between columns
  for (let i = 0; i < 7; i++) {
    const c = s.tab[i];
    for (let k = 0; k < c.u.length; k++) {
      const card = c.u[k];
      for (let j = 0; j < 7; j++) {
        if (j === i || !fitsT(s.tab[j], card)) continue;
        let p = 0;
        if (k === 0 && c.d.length) p = 8 + (c.d.length > 3 ? 1 : 0);
        else if (k === 0 && rank(card) !== 13 && s.tab[j].u.length) p = 2;
        else if (k > 0 && s.f[suit(c.u[k - 1])] === rank(c.u[k - 1]) - 1) p = 5;
        if (!p) continue;
        add(p, () => { const n = cp(s); const a = n.tab[i], b = n.tab[j]; b.u = b.u.concat(a.u.slice(k)); a.u = a.u.slice(0, k); flip(a); return n; });
      }
    }
  }
  // from the waste to a column
  if (w != null) for (let j = 0; j < 7; j++) if (fitsT(s.tab[j], w)) add(s.tab[j].u.length ? 5 : 4, () => { const n = cp(s); n.waste.pop(); n.tab[j].u = n.tab[j].u.concat([w]); return n; });
  // turn the stock (or turn the waste back over)
  if (s.stock.length) add(1, () => { const n = cp(s); for (let k = 0; k < n.draw && n.stock.length; k++) n.waste.push(n.stock.pop()); return n; });
  else if (s.waste.length) add(0, () => { const n = cp(s); n.stock = n.waste.reverse(); n.waste = []; return n; });
  out.sort((a, b) => b[0] - a[0]);
  return out;
}

/** Tries to win from `state`. Returns true (winnable), false (proved lost) or null (gave up after maxNodes). */
export function solve(state, { maxNodes = 60000 } = {}) {
  const s = { draw: state.draw, f: [0, 0, 0, 0], stock: state.stock.slice(), waste: state.waste.slice(), tab: state.tab.map(c => ({ d: c.d.slice(), u: c.u.slice() })) };
  for (const pile of state.found) if (pile.length) s.f[suit(pile[0])] = pile.length;
  const seen = new Set(); let nodes = 0, out = false;
  const stack = [s];
  // iterative, so a long solution can't overflow the call stack
  while (stack.length) {
    const n = stack.pop();
    auto(n);
    if (n.f[0] + n.f[1] + n.f[2] + n.f[3] === 52) { out = true; break; }
    const k = key(n);
    if (seen.has(k)) continue;
    seen.add(k);
    if (++nodes > maxNodes) return null;
    const ch = children(n);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i][1]());
  }
  return out;
}

/** The first deal from `seed` onwards that the solver proves winnable (tries a few), for the Daily Deal. */
export function winnableSeed(seed, draw = 1, { tries = 12, maxNodes = 60000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const sd = (seed + i * 7919) >>> 0;
    if (solve(deal(deck(sd), draw), { maxNodes }) === true) return { seed: sd, proved: true };
  }
  return { seed: seed >>> 0, proved: false };
}
