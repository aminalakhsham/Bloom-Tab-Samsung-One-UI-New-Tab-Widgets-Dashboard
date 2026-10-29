// Chess rules and the computer player for Gaming Hub. Pure (no DOM, no storage) so the board, the search Worker
// (chess-worker.js) and the node tests (.dev/games-chess-engine.mjs) share one implementation.
// Board: a 0x88 array (a1 = 0, h1 = 7, a8 = 112) where a piece is its type (P N B R Q K = 1…6) plus 8 for Black.
// Moves are plain integers (from | to << 7 | promotion type << 14 | flags) so they cross the Worker boundary as numbers
// and a saved game is just the starting FEN plus a list of them.

export const WHITE = 0, BLACK = 8;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const F_CAP = 1 << 17, F_EP = 1 << 18, F_CASTLE = 1 << 19, F_DOUBLE = 1 << 20;
export const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPromo = m => (m >> 14) & 7;
const mk = (f, t, flags = 0, promo = 0) => f | (t << 7) | (promo << 14) | flags;
export const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
export const sqFromName = n => /^[a-h][1-8]$/.test(n || '') ? ((+n[1] - 1) << 4) | (n.charCodeAt(0) - 97) : -1;
export const uci = m => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? ' pnbrqk'[mPromo(m)] : '');

const N_OFF = [33, 31, 18, 14, -14, -18, -31, -33], K_OFF = [1, 15, 16, 17, -1, -15, -16, -17];
const B_OFF = [15, 17, -15, -17], R_OFF = [1, -1, 16, -16];
// Castling rights (K = 1, Q = 2, k = 4, q = 8) that survive a move from or to each square.
const CR = new Uint8Array(128).fill(15);
CR[0] = 13; CR[7] = 14; CR[4] = 12; CR[112] = 7; CR[119] = 11; CR[116] = 3;

// Zobrist keys in two 32-bit halves (BigInt would be several times slower), from a fixed seed so every surface agrees.
let zs = 0x2545f491;
const zr = () => { zs ^= zs << 13; zs ^= zs >>> 17; zs ^= zs << 5; return zs | 0; };
const zfill = n => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = zr(); return a; };
const ZP_LO = zfill(16 * 128), ZP_HI = zfill(16 * 128), ZC_LO = zfill(16), ZC_HI = zfill(16), ZE_LO = zfill(8), ZE_HI = zfill(8);
const ZS_LO = zr(), ZS_HI = zr();

export class Position {
  constructor(fen = START_FEN) { this.b = new Int8Array(128); this.u = []; this.load(fen); }

  /** Reads a FEN; throws on one that can't be played (missing kings, bad rows). */
  load(fen) {
    const [place = '', side = 'w', castle = '-', ep = '-', half = '0', full = '1'] = String(fen).trim().split(/\s+/);
    const b = this.b; b.fill(0); this.up = 0; this.kings = [-1, -1]; this.startFen = null;
    const rows = place.split('/');
    if (rows.length !== 8) throw new Error('bad FEN');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const t = ' pnbrqk'.indexOf(ch.toLowerCase());
        if (t < 1 || f > 7) throw new Error('bad FEN');
        const sq = ((7 - r) << 4) | f, pc = t | (ch > 'Z' ? BLACK : WHITE);
        b[sq] = pc; if (t === KING) this.kings[pc >> 3] = sq; f++;
      }
      if (f !== 8) throw new Error('bad FEN');
    }
    if (this.kings[0] < 0 || this.kings[1] < 0) throw new Error('bad FEN');
    this.side = side === 'b' ? BLACK : WHITE;
    // rights are kept only while the king and that rook still stand on their squares
    let c = 0;
    if (b[4] === KING) { if (castle.includes('K') && b[7] === ROOK) c |= 1; if (castle.includes('Q') && b[0] === ROOK) c |= 2; }
    if (b[116] === (KING | BLACK)) { if (castle.includes('k') && b[119] === (ROOK | BLACK)) c |= 4; if (castle.includes('q') && b[112] === (ROOK | BLACK)) c |= 8; }
    this.castle = c;
    const e = sqFromName(ep);
    this.ep = e >= 0 && this.epOk(e, this.side) ? e : -1;
    this.half = Math.max(0, +half || 0); this.full = Math.max(1, +full || 1);
    this.rehash();
    this.startFen = this.fen();
    return this;
  }
  /** A copy that keeps the move history (so repetitions still count), e.g. for trying a move. */
  clone() {
    const p = new Position(this.startFen);
    for (let i = 0; i < this.up; i += 7) p.make(this.u[i]);
    return p;
  }
  /** The moves played since the starting position. */
  history() { const out = []; for (let i = 0; i < this.up; i += 7) out.push(this.u[i]); return out; }

  /** True when a pawn of `by` stands next to the pawn that just passed `e`, so an en-passant capture is possible.
   *  Only then is the square part of the position: otherwise two identical positions would count as different. */
  epOk(e, by) {
    const b = this.b, pawn = PAWN | by, a = by === WHITE ? e - 17 : e + 15, c = by === WHITE ? e - 15 : e + 17;
    return (!(a & 0x88) && b[a] === pawn) || (!(c & 0x88) && b[c] === pawn);
  }
  rehash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = this.b[sq]; if (p) { lo ^= ZP_LO[p * 128 + sq]; hi ^= ZP_HI[p * 128 + sq]; } }
    lo ^= ZC_LO[this.castle]; hi ^= ZC_HI[this.castle];
    if (this.ep >= 0) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
    if (this.side === BLACK) { lo ^= ZS_LO; hi ^= ZS_HI; }
    this.lo = lo; this.hi = hi;
  }
  fen() {
    const b = this.b, rows = [];
    for (let r = 7; r >= 0; r--) {
      let s = '', n = 0;
      for (let f = 0; f < 8; f++) { const p = b[(r << 4) | f]; if (!p) { n++; continue; } if (n) { s += n; n = 0; } const ch = ' pnbrqk'[p & 7]; s += p & 8 ? ch : ch.toUpperCase(); }
      rows.push(s + (n || ''));
    }
    const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    return `${rows.join('/')} ${this.side ? 'b' : 'w'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
  }
  /** The piece on a square given by name ("e4") or index, as { type: 'p'…'k', color: 'w'|'b' }, or null. */
  at(s) { const p = this.b[typeof s === 'string' ? sqFromName(s) : s]; return p ? { type: ' pnbrqk'[p & 7], color: p & 8 ? 'b' : 'w' } : null; }
  get turn() { return this.side ? 'b' : 'w'; }
  get ply() { return this.up / 7; }

  attacked(sq, by) {
    const b = this.b;
    if (by === WHITE) { if ((!((sq - 15) & 0x88) && b[sq - 15] === PAWN) || (!((sq - 17) & 0x88) && b[sq - 17] === PAWN)) return true; }
    else if ((!((sq + 15) & 0x88) && b[sq + 15] === (PAWN | BLACK)) || (!((sq + 17) & 0x88) && b[sq + 17] === (PAWN | BLACK))) return true;
    const kn = KNIGHT | by, kg = KING | by, bi = BISHOP | by, ro = ROOK | by, qu = QUEEN | by;
    for (let i = 0; i < 8; i++) { const t = sq + N_OFF[i]; if (!(t & 0x88) && b[t] === kn) return true; }
    for (let i = 0; i < 8; i++) { const t = sq + K_OFF[i]; if (!(t & 0x88) && b[t] === kg) return true; }
    for (let i = 0; i < 4; i++) {
      const o = B_OFF[i]; let t = sq + o;
      while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === bi || p === qu) return true; break; } t += o; }
    }
    for (let i = 0; i < 4; i++) {
      const o = R_OFF[i]; let t = sq + o;
      while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === ro || p === qu) return true; break; } t += o; }
    }
    return false;
  }
  inCheck() { return this.attacked(this.kings[this.side >> 3], this.side ^ 8); }
  /** True when the side that just moved left its own king in check (the last move was illegal). */
  leftInCheck() { const them = this.side ^ 8; return this.attacked(this.kings[them >> 3], this.side); }

  /** Pseudo-legal moves (the king may be left in check) appended to `out`; `caps` keeps only captures and queening. */
  gen(out, caps = false) {
    const b = this.b, us = this.side, them = us ^ 8;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const pc = b[sq]; if (!pc || (pc & 8) !== us) continue;
      const t = pc & 7;
      if (t === PAWN) {
        const d = us === WHITE ? 16 : -16, r = sq >> 4, promo = r === (us === WHITE ? 6 : 1), to = sq + d;
        if (!b[to]) {
          if (promo) { out.push(mk(sq, to, 0, QUEEN)); if (!caps) out.push(mk(sq, to, 0, ROOK), mk(sq, to, 0, BISHOP), mk(sq, to, 0, KNIGHT)); }
          else if (!caps) { out.push(mk(sq, to)); if (r === (us === WHITE ? 1 : 6) && !b[to + d]) out.push(mk(sq, to + d, F_DOUBLE)); }
        }
        for (let k = -1; k <= 1; k += 2) {
          const c = to + k; if (c & 0x88) continue;
          const p = b[c];
          if (p && (p & 8) === them) {
            if (promo) out.push(mk(sq, c, F_CAP, QUEEN), mk(sq, c, F_CAP, ROOK), mk(sq, c, F_CAP, BISHOP), mk(sq, c, F_CAP, KNIGHT));
            else out.push(mk(sq, c, F_CAP));
          } else if (c === this.ep) out.push(mk(sq, c, F_CAP | F_EP));
        }
      } else if (t === KNIGHT || t === KING) {
        const offs = t === KNIGHT ? N_OFF : K_OFF;
        for (let i = 0; i < 8; i++) {
          const to = sq + offs[i]; if (to & 0x88) continue;
          const p = b[to];
          if (!p) { if (!caps) out.push(mk(sq, to)); } else if ((p & 8) === them) out.push(mk(sq, to, F_CAP));
        }
      } else {
        const offs = t === BISHOP ? B_OFF : t === ROOK ? R_OFF : K_OFF, n = offs.length;
        for (let i = 0; i < n; i++) {
          const o = offs[i]; let to = sq + o;
          while (!(to & 0x88)) {
            const p = b[to];
            if (!p) { if (!caps) out.push(mk(sq, to)); } else { if ((p & 8) === them) out.push(mk(sq, to, F_CAP)); break; }
            to += o;
          }
        }
      }
    }
    if (!caps && this.castle) {
      const k = us === WHITE ? 4 : 116, kr = us === WHITE ? 1 : 4, qr = us === WHITE ? 2 : 8;
      if ((this.castle & kr) && !b[k + 1] && !b[k + 2] && !this.attacked(k, them) && !this.attacked(k + 1, them) && !this.attacked(k + 2, them)) out.push(mk(k, k + 2, F_CASTLE));
      if ((this.castle & qr) && !b[k - 1] && !b[k - 2] && !b[k - 3] && !this.attacked(k, them) && !this.attacked(k - 1, them) && !this.attacked(k - 2, them)) out.push(mk(k, k - 2, F_CASTLE));
    }
    return out;
  }
  /** Legal moves for the side to move. */
  moves() {
    const all = this.gen([]), out = [];
    for (const m of all) { this.make(m); if (!this.leftInCheck()) out.push(m); this.unmake(); }
    return out;
  }
  hasLegal() {
    const all = this.gen([]);
    for (const m of all) { this.make(m); const ok = !this.leftInCheck(); this.unmake(); if (ok) return true; }
    return false;
  }

  make(m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, us = this.side, pc = b[from], u = this.u;
    let cap = m & F_EP ? 0 : b[to], lo = this.lo ^ ZC_LO[this.castle], hi = this.hi ^ ZC_HI[this.castle], k = pc * 128 + from;
    if (this.ep >= 0) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
    let n = this.up; u[n] = m; u[n + 2] = this.castle; u[n + 3] = this.ep; u[n + 4] = this.half; u[n + 5] = this.lo; u[n + 6] = this.hi; this.up = n + 7;
    lo ^= ZP_LO[k]; hi ^= ZP_HI[k]; b[from] = 0;
    if (m & F_EP) { const cs = to + (us === WHITE ? -16 : 16); cap = b[cs]; b[cs] = 0; k = cap * 128 + cs; lo ^= ZP_LO[k]; hi ^= ZP_HI[k]; }
    else if (cap) { k = cap * 128 + to; lo ^= ZP_LO[k]; hi ^= ZP_HI[k]; }
    u[n + 1] = cap;
    const promo = (m >> 14) & 7, np = promo ? promo | us : pc;
    b[to] = np; k = np * 128 + to; lo ^= ZP_LO[k]; hi ^= ZP_HI[k];
    if (m & F_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1, rk = b[rf];
      b[rf] = 0; b[rt] = rk; lo ^= ZP_LO[rk * 128 + rf] ^ ZP_LO[rk * 128 + rt]; hi ^= ZP_HI[rk * 128 + rf] ^ ZP_HI[rk * 128 + rt];
    }
    if ((pc & 7) === KING) this.kings[us >> 3] = to;
    this.castle &= CR[from] & CR[to]; lo ^= ZC_LO[this.castle]; hi ^= ZC_HI[this.castle];
    this.ep = -1;
    if (m & F_DOUBLE) { const e = (from + to) >> 1; if (this.epOk(e, us ^ 8)) { this.ep = e; lo ^= ZE_LO[e & 7]; hi ^= ZE_HI[e & 7]; } }
    this.half = (pc & 7) === PAWN || cap ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.side = us ^ 8; this.lo = lo ^ ZS_LO; this.hi = hi ^ ZS_HI;
  }
  unmake() {
    const u = this.u, n = this.up -= 7, m = u[n], cap = u[n + 1];
    this.castle = u[n + 2]; this.ep = u[n + 3]; this.half = u[n + 4]; this.lo = u[n + 5]; this.hi = u[n + 6];
    const us = this.side ^= 8;
    if (us === BLACK) this.full--;
    if (!m) return; // a null move
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pc = (m >> 14) & 7 ? PAWN | us : b[to];
    b[from] = pc;
    if (m & F_EP) { b[to] = 0; b[to + (us === WHITE ? -16 : 16)] = cap; } else b[to] = cap;
    if (m & F_CASTLE) {
      const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
      b[rf] = b[rt]; b[rt] = 0;
    }
    if ((pc & 7) === KING) this.kings[us >> 3] = from;
  }
  /** Passing the move (null-move pruning in the search). */
  makeNull() {
    const u = this.u, n = this.up;
    u[n] = 0; u[n + 1] = 0; u[n + 2] = this.castle; u[n + 3] = this.ep; u[n + 4] = this.half; u[n + 5] = this.lo; u[n + 6] = this.hi; this.up = n + 7;
    if (this.ep >= 0) { this.lo ^= ZE_LO[this.ep & 7]; this.hi ^= ZE_HI[this.ep & 7]; this.ep = -1; }
    if (this.side === BLACK) this.full++;
    this.half = 0; this.side ^= 8; this.lo ^= ZS_LO; this.hi ^= ZS_HI;
  }
  /** How many times the current position has stood on the board (positions since the last pawn move or capture). */
  repetitions() {
    let c = 1;
    for (let i = this.up - 14, stop = Math.max(0, this.up - this.half * 7); i >= stop; i -= 14) if (this.u[i + 5] === this.lo && this.u[i + 6] === this.hi) c++;
    return c;
  }
  /** Neither side can ever mate: kings alone, one minor piece, or only bishops that all stand on one colour. */
  insufficient() {
    const b = this.b; let knights = 0, light = 0, dark = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const t = b[sq] & 7;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KNIGHT) knights++;
      else if (t === BISHOP) { if (((sq >> 4) + (sq & 7)) & 1) light++; else dark++; }
    }
    return knights + light + dark <= 1 || (!knights && (!light || !dark));
  }
  /** { over, reason: 'checkmate'|'stalemate'|'material'|'fifty'|'repetition', winner: 'w'|'b'|null, check }. */
  status() {
    const check = this.inCheck();
    if (!this.hasLegal()) return check ? { over: true, reason: 'checkmate', winner: this.side ? 'w' : 'b', check } : { over: true, reason: 'stalemate', winner: null, check };
    if (this.insufficient()) return { over: true, reason: 'material', winner: null, check };
    if (this.half >= 100) return { over: true, reason: 'fifty', winner: null, check };
    if (this.repetitions() >= 3) return { over: true, reason: 'repetition', winner: null, check };
    return { over: false, check };
  }

  /** Standard algebraic notation for a legal move in this position ("Nbd2", "exd6", "e8=Q+", "O-O#"). */
  san(m, legal = this.moves()) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pc = b[from], t = pc & 7, promo = (m >> 14) & 7;
    let s;
    if (m & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else if (t === PAWN) s = (m & F_CAP ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to) + (promo ? '=' + ' PNBRQK'[promo] : '');
    else {
      let amb = false, file = false, rank = false;
      for (const o of legal) {
        const f = o & 127;
        if (f !== from && ((o >> 7) & 127) === to && b[f] === pc) { amb = true; if ((f & 7) === (from & 7)) file = true; if (f >> 4 === from >> 4) rank = true; }
      }
      s = ' PNBRQK'[t] + (amb ? (!file ? 'abcdefgh'[from & 7] : !rank ? String((from >> 4) + 1) : sqName(from)) : '') + (m & F_CAP ? 'x' : '') + sqName(to);
    }
    this.make(m);
    if (this.inCheck()) s += this.hasLegal() ? '+' : '#';
    this.unmake();
    return s;
  }
  /** The legal move written in SAN ("Nf3", "exd5", "O-O", "e8=Q"; check marks optional) or UCI ("g1f3"), or 0. */
  parse(str) {
    const s = String(str).trim().replace(/[+#!?]+$/, '').replace(/0/g, 'O');
    const legal = this.moves();
    const u = legal.find(m => uci(m) === s.toLowerCase());
    if (u) return u;
    return legal.find(m => this.san(m, legal).replace(/[+#]$/, '') === s) || 0;
  }
}

/** Counts leaf nodes of the legal move tree (the standard move generator test). */
export function perft(pos, depth) {
  if (!depth) return 1;
  const ms = pos.gen([]); let n = 0;
  for (const m of ms) { pos.make(m); if (!pos.leftInCheck()) n += depth === 1 ? 1 : perft(pos, depth - 1); pos.unmake(); }
  return n;
}

// ---------------------------------------------------------------- evaluation
// Piece-square tables from White's side, a8 first (the well-known "simplified evaluation" shape), blended between the
// middlegame and the endgame by the material left, so the king hides early and walks to the centre late.
const PST = {
  [PAWN]: [[0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90, 90, 90, 90, 55, 55, 55, 55, 55, 55, 55, 55, 30, 30, 30, 30, 30, 30, 30, 30, 15, 15, 15, 15, 15, 15, 15, 15, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [KNIGHT]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [BISHOP]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [ROOK]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [QUEEN]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [KING]: [[-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]],
};
export const VALUE = [0, 100, 320, 330, 500, 900, 0];
const EG_VALUE = [0, 110, 300, 320, 520, 930, 0], PHASE = [0, 0, 1, 1, 2, 4, 0];
// Tables indexed by piece (with colour) * 128 + square, material included, so the evaluation is one lookup a piece.
const MG = new Int16Array(16 * 128), EG = new Int16Array(16 * 128);
for (let t = 1; t <= 6; t++) for (let sq = 0; sq < 128; sq++) {
  if (sq & 0x88) continue;
  const r = sq >> 4, f = sq & 7, w = (7 - r) * 8 + f, bl = r * 8 + f, tab = PST[t], mgT = Array.isArray(tab[0]) ? tab[0] : tab, egT = Array.isArray(tab[0]) ? tab[1] : tab;
  MG[t * 128 + sq] = VALUE[t] + mgT[w]; EG[t * 128 + sq] = EG_VALUE[t] + egT[w];
  MG[(t | 8) * 128 + sq] = VALUE[t] + mgT[bl]; EG[(t | 8) * 128 + sq] = EG_VALUE[t] + egT[bl];
}
const centerDist = sq => Math.max(3 - (sq >> 4), (sq >> 4) - 4, 3 - (sq & 7), (sq & 7) - 4);
const dist = (a, b) => Math.max(Math.abs((a >> 4) - (b >> 4)), Math.abs((a & 7) - (b & 7)));

/** Static score in centipawns from the side to move's point of view. */
export function evaluate(pos) {
  const b = pos.b; let mgW = 0, mgB = 0, egW = 0, egB = 0, phase = 0, bw = 0, bb = 0, mw = 0, mb = 0, pw = 0, pb = 0;
  for (let sq = 0; sq < 120; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq]; if (!p) continue;
    const t = p & 7, i = p * 128 + sq;
    phase += PHASE[t];
    if (p & 8) { mgB += MG[i]; egB += EG[i]; if (t === BISHOP) bb++; if (t === PAWN) pb++; else if (t !== KING) mb += VALUE[t]; }
    else { mgW += MG[i]; egW += EG[i]; if (t === BISHOP) bw++; if (t === PAWN) pw++; else if (t !== KING) mw += VALUE[t]; }
  }
  if (bw > 1) { mgW += 30; egW += 50; } if (bb > 1) { mgB += 30; egB += 50; }
  // Mop-up: with a clear material lead and no pawns left to the loser, drive its king to the edge and bring ours
  // closer, so the computer actually finishes K+Q v K and similar endings instead of shuffling.
  const kw = pos.kings[0], kb = pos.kings[1];
  if (mw - mb >= 300 && !pb) egW += centerDist(kb) * 12 + (7 - dist(kw, kb)) * 6;
  else if (mb - mw >= 300 && !pw) egB += centerDist(kw) * 12 + (7 - dist(kw, kb)) * 6;
  if (phase > 24) phase = 24;
  let s = ((mgW - mgB) * phase + (egW - egB) * (24 - phase)) / 24 | 0;
  // a side with no pawns and at most one minor piece can't win, so its material lead is worth little
  if ((s > 0 && !pw && mw < 400) || (s < 0 && !pb && mb < 400)) s = s / 8 | 0;
  return (pos.side === WHITE ? s : -s) + 10;
}

// ---------------------------------------------------------------- search
export const MATE = 30000;
const INF = 32000, STOP = {};
const TT_SIZE = 1 << 18, TT_MASK = TT_SIZE - 1;
let ttLo, ttHi, ttMove, ttScore, ttDepth, ttFlag;
const now = () => (globalThis.performance?.now?.() ?? Date.now());

/** The computer's strength: depth and thinking time per level, and how much random noise blurs its choice at the
 *  lower levels (scores in centipawns), so level 1 makes beginner mistakes and level 5 plays its best. */
export const LEVELS = {
  1: { maxDepth: 1, timeMs: 400, noise: 220 },
  2: { maxDepth: 2, timeMs: 600, noise: 90 },
  3: { maxDepth: 3, timeMs: 900, noise: 30 },
  4: { maxDepth: 6, timeMs: 1200, noise: 0 },
  5: { maxDepth: 40, timeMs: 2600, noise: 0 },
};

/**
 * Picks a move for the side to move. pos is left unchanged.
 * opts: { maxDepth, timeMs, noise, rand } → { move, score, depth, nodes } (move 0 when there is none).
 */
export function think(pos, { maxDepth = 64, timeMs = 1000, noise = 0, rand = Math.random } = {}) {
  if (!ttLo) { ttLo = new Int32Array(TT_SIZE); ttHi = new Int32Array(TT_SIZE); ttMove = new Int32Array(TT_SIZE); ttScore = new Int16Array(TT_SIZE); ttDepth = new Int8Array(TT_SIZE); ttFlag = new Uint8Array(TT_SIZE); }
  const t0 = now(), deadline = t0 + timeMs, base = pos.up, b = pos.b;
  const killers = new Int32Array(130 * 2), hist = new Int32Array(16 * 128);
  let nodes = 0;
  const root = pos.moves();
  if (!root.length) return { move: 0, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0 };

  const isRep = () => {
    for (let i = pos.up - 14, stop = Math.max(0, pos.up - pos.half * 7); i >= stop; i -= 14) if (pos.u[i + 5] === pos.lo && pos.u[i + 6] === pos.hi) return true;
    return false;
  };
  const order = (ms, scores, ply, ttm) => {
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m === ttm) scores[i] = 1e7;
      else if (m & F_CAP) scores[i] = 1e6 + (m & F_EP ? 1 : b[(m >> 7) & 127] & 7) * 16 - (b[m & 127] & 7) + ((m >> 14) & 7) * 100;
      else if ((m >> 14) & 7) scores[i] = 9e5 + ((m >> 14) & 7);
      else if (m === killers[ply * 2]) scores[i] = 8e5;
      else if (m === killers[ply * 2 + 1]) scores[i] = 7e5;
      else scores[i] = hist[b[m & 127] * 128 + ((m >> 7) & 127)];
    }
  };
  // selection sort one step at a time: most cut-offs come from the first few moves, so sorting all of them is waste
  const pick = (ms, scores, i) => {
    let bi = i;
    for (let j = i + 1; j < ms.length; j++) if (scores[j] > scores[bi]) bi = j;
    if (bi !== i) { const m = ms[i]; ms[i] = ms[bi]; ms[bi] = m; const s = scores[i]; scores[i] = scores[bi]; scores[bi] = s; }
    return ms[i];
  };

  function quiesce(alpha, beta, ply) {
    if ((++nodes & 2047) === 0 && now() > deadline) throw STOP;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 120) return stand;
    const ms = pos.gen([], true), sc = new Array(ms.length);
    order(ms, sc, ply, 0);
    for (let i = 0; i < ms.length; i++) {
      const m = pick(ms, sc, i);
      // delta pruning: even winning this piece can't lift the score to alpha
      if (!((m >> 14) & 7) && stand + VALUE[m & F_EP ? PAWN : b[(m >> 7) & 127] & 7] + 200 < alpha) continue;
      pos.make(m);
      if (pos.leftInCheck()) { pos.unmake(); continue; }
      const s = -quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply, nullOk) {
    if ((++nodes & 2047) === 0 && now() > deadline) throw STOP;
    if (pos.half >= 100 || isRep()) return 0;
    // mate-distance pruning: a shorter mate was already found higher up
    alpha = Math.max(alpha, -MATE + ply); beta = Math.min(beta, MATE - ply - 1);
    if (alpha >= beta) return alpha;
    const check = pos.inCheck();
    if (check) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    const pv = beta - alpha > 1, slot = pos.lo & TT_MASK;
    let ttm = 0;
    if (ttLo[slot] === pos.lo && ttHi[slot] === pos.hi) {
      ttm = ttMove[slot];
      if (!pv && ttDepth[slot] >= depth) {
        let s = ttScore[slot]; if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
        const f = ttFlag[slot];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }
    // null move: if passing still beats beta, a real move will too (not in check, and not with only pawns left,
    // where zugzwang makes passing a lie)
    if (nullOk && !pv && !check && depth >= 3 && hasPieces(pos)) {
      if (evaluate(pos) >= beta) {
        pos.makeNull();
        const s = -search(depth - 3, -beta, -beta + 1, ply + 1, false);
        pos.unmake();
        if (s >= beta) return s >= MATE - 200 ? beta : s;
      }
    }
    const ms = pos.gen([]), sc = new Array(ms.length);
    order(ms, sc, ply, ttm);
    let best = -INF, bestM = 0, legal = 0;
    const a0 = alpha;
    for (let i = 0; i < ms.length; i++) {
      const m = pick(ms, sc, i);
      pos.make(m);
      if (pos.leftInCheck()) { pos.unmake(); continue; }
      legal++;
      let s;
      if (legal === 1) s = -search(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        // late quiet moves are searched one ply shallower first (late move reduction), then fully if they surprise
        const quiet = !(m & F_CAP) && !((m >> 14) & 7) && !check && m !== killers[ply * 2] && m !== killers[ply * 2 + 1];
        const r = quiet && depth >= 3 && legal > 4 && !pos.inCheck() ? 1 : 0;
        s = -search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && (r || s < beta)) s = -search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake();
      if (s > best) { best = s; bestM = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!(m & F_CAP)) {
          if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
          hist[b[m & 127] * 128 + ((m >> 7) & 127)] += depth * depth;
        }
        break;
      }
    }
    if (!legal) return check ? -MATE + ply : 0;
    let st = best; if (st > MATE - 200) st += ply; else if (st < -MATE + 200) st -= ply;
    ttLo[slot] = pos.lo; ttHi[slot] = pos.hi; ttMove[slot] = bestM; ttScore[slot] = st; ttDepth[slot] = depth;
    ttFlag[slot] = best >= beta ? 2 : best > a0 ? 1 : 3;
    return best;
  }

  const unwind = () => { while (pos.up > base) pos.unmake(); };
  // Lower levels: score every root move at a fixed depth, add noise and take the best of the blurred scores, so the
  // computer misjudges close moves the way a weaker player does but still takes a mate in one when it sees it.
  if (noise) {
    const scored = [];
    try {
      for (const m of root) {
        pos.make(m);
        scored.push([m, -search(maxDepth - 1, -INF, INF, 1, true)]);
        pos.unmake();
      }
    } catch (e) { if (e !== STOP) throw e; unwind(); }
    if (!scored.length) return { move: root[Math.floor(rand() * root.length)], score: 0, depth: 0, nodes };
    const top = Math.max(...scored.map(x => x[1]));
    if (top > MATE - 200) { const m = scored.find(x => x[1] === top); return { move: m[0], score: top, depth: maxDepth, nodes }; }
    const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rand(); return (s - 2) * 1.7; };
    let best = scored[0], bv = -Infinity;
    for (const x of scored) { const v = Math.max(-MATE / 2, x[1]) + gauss() * noise; if (v > bv) { bv = v; best = x; } }
    return { move: best[0], score: best[1], depth: maxDepth, nodes };
  }

  const book = bookMove(pos, root, rand);
  if (book) return { move: book, score: 0, depth: 0, nodes: 0 };
  let best = root[0], bestScore = -INF, done = 0;
  const rootScores = new Map();
  for (let d = 1; d <= maxDepth; d++) {
    const ms = root.slice().sort((x, y) => (x === best ? -1 : y === best ? 1 : (rootScores.get(y) ?? -INF) - (rootScores.get(x) ?? -INF)));
    let alpha = -INF, cur = 0, curS = -INF;
    try {
      for (const m of ms) {
        pos.make(m);
        let s;
        if (!cur) s = -search(d - 1, -INF, INF, 1, true);
        else { s = -search(d - 1, -alpha - 1, -alpha, 1, true); if (s > alpha) s = -search(d - 1, -INF, -alpha, 1, true); }
        pos.unmake();
        rootScores.set(m, s);
        if (s > curS || !cur) { curS = s; cur = m; }
        if (s > alpha) alpha = s;
      }
    } catch (e) {
      if (e !== STOP) throw e;
      unwind();
      // a better first move found in the unfinished iteration is still worth playing
      if (cur && cur !== best && curS > bestScore) best = cur;
      break;
    }
    best = cur; bestScore = curS; done = d;
    if (Math.abs(bestScore) > MATE - 200 || now() - t0 > timeMs * 0.5) break;
  }
  return { move: best, score: bestScore, depth: done, nodes };
}
// A few sound main lines, so the stronger levels don't open every game the same way (the search alone is
// deterministic). Keys are the moves so far in UCI; only used for games that began from the normal start.
const BOOK = {
  '': 'e2e4 d2d4 c2c4 g1f3',
  'e2e4': 'e7e5 c7c5 e7e6 c7c6', 'd2d4': 'd7d5 g8f6', 'c2c4': 'e7e5 g8f6 c7c5', 'g1f3': 'd7d5 g8f6 c7c5',
  'e2e4 e7e5': 'g1f3 b1c3', 'e2e4 e7e5 g1f3': 'b8c6 g8f6', 'e2e4 e7e5 g1f3 b8c6': 'f1b5 f1c4 d2d4', 'e2e4 e7e5 b1c3': 'g8f6 b8c6',
  'e2e4 c7c5': 'g1f3 b1c3', 'e2e4 c7c5 g1f3': 'd7d6 b8c6 e7e6', 'e2e4 c7c5 b1c3': 'b8c6 d7d6',
  'e2e4 e7e6': 'd2d4', 'e2e4 e7e6 d2d4': 'd7d5', 'e2e4 c7c6': 'd2d4', 'e2e4 c7c6 d2d4': 'd7d5',
  'd2d4 d7d5': 'c2c4 g1f3', 'd2d4 d7d5 c2c4': 'e7e6 c7c6', 'd2d4 d7d5 g1f3': 'g8f6',
  'd2d4 g8f6': 'c2c4 g1f3', 'd2d4 g8f6 c2c4': 'e7e6 g7g6', 'd2d4 g8f6 g1f3': 'd7d5 e7e6',
  'c2c4 e7e5': 'b1c3', 'c2c4 g8f6': 'b1c3 g1f3', 'c2c4 c7c5': 'g1f3 b1c3', 'g1f3 d7d5': 'd2d4 g2g3', 'g1f3 g8f6': 'c2c4 g2g3', 'g1f3 c7c5': 'c2c4 e2e4',
};
function bookMove(pos, legal, rand) {
  if (pos.startFen !== START_FEN || pos.up > 6 * 7) return 0;
  let line = []; for (let i = 0; i < pos.up; i += 7) line.push(uci(pos.u[i]));
  const opts = (BOOK[line.join(' ')] || '').split(' ').map(s => legal.find(m => uci(m) === s)).filter(Boolean);
  return opts.length ? opts[Math.floor(rand() * opts.length)] : 0;
}
function hasPieces(pos) {
  const b = pos.b, us = pos.side;
  for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = b[sq]; if (p && (p & 8) === us) { const t = p & 7; if (t !== PAWN && t !== KING) return true; } }
  return false;
}

// ---------------------------------------------------------------- mate puzzles
/** After the attacker's move: true when every defence loses to mate within n - 1 more attacker moves (n counts
 *  the move just made). */
export function forcesMate(pos, n) {
  const replies = pos.moves();
  if (!replies.length) return pos.inCheck();
  if (n <= 1) return false;
  for (const r of replies) { pos.make(r); const ok = canMate(pos, n - 1); pos.unmake(); if (!ok) return false; }
  return true;
}
/** The side to move can force mate within n moves. */
export function canMate(pos, n) {
  for (const m of pos.moves()) {
    pos.make(m);
    const ok = n === 1 ? pos.inCheck() && !pos.hasLegal() : forcesMate(pos, n);
    pos.unmake();
    if (ok) return true;
  }
  return false;
}
/** Every move that forces mate within n moves. */
export const mateKeys = (pos, n) => pos.moves().filter(m => { pos.make(m); const ok = forcesMate(pos, n); pos.unmake(); return ok; });
/** The toughest defence after the attacker's move: the reply that leaves the fewest mating continuations. */
export function bestDefence(pos, n, rand = Math.random) {
  let best = [], fewest = Infinity;
  for (const r of pos.moves()) {
    pos.make(r);
    const c = n > 1 ? mateKeys(pos, n - 1).length : 0;
    pos.unmake();
    if (c < fewest) { fewest = c; best = [r]; } else if (c === fewest) best.push(r);
  }
  return best.length ? best[Math.floor(rand() * best.length)] : 0;
}

/** Mate-in-two puzzles for the Daily Challenge, built from the engine's own games and checked by
 *  .dev/chess-engine.mjs: no mate in one, exactly one first move that forces mate in two. */
export const PUZZLES = [
  '2rk1bn1/1p2pbpr/1P6/1B1p1p1p/P2Q1Pnq/2N1P2N/1BP1K1PP/R2R4 w - - 0 1',
  'rq6/pk6/bpr3Rp/b2BQn2/P1P2p2/1PN3P1/1BP5/R1K5 w - - 0 1',
  'r5k1/1qpQ4/8/p1B1PPp1/6R1/2p4r/P6P/3RKB2 w - - 0 1',
  '2b2B2/8/5k2/p2P4/2p3r1/2Pn4/2K5/1R6 b - - 0 1',
  '3k4/3b4/6p1/1p2K3/1r5P/5r2/8/R5R1 b - - 0 1',
  '7r/8/p1p2kp1/b3p2p/6b1/8/5r2/1K6 b - - 0 1',
  '3r2r1/4k3/p5pp/1pN5/1PqpK2P/6P1/5N2/5R2 b - - 0 1',
  '3q1r2/2p3k1/2P5/p3P1pB/2P1b2p/8/4K3/8 b - - 0 1',
  '7k/2R5/3B4/5P1p/p4P1P/2PB4/1P6/3K4 w - - 0 1',
  '8/6k1/1r1B4/1P1N1B1R/2P1P3/8/5P2/2K5 w - - 0 1',
  '2Q5/R7/7k/P3N2r/3p1p2/3K1P2/8/8 w - - 0 1',
  'R1brk3/1pp4N/4pQ2/1p1p1p2/1P5P/2NP1K2/1PP2P1P/6R1 w - - 0 1',
  '8/8/1n5p/2kPp3/4pp1R/P7/r1r5/3K4 b - - 0 1',
  '6r1/k1p5/1p2p3/pP3p2/3P4/1P1RP2p/6r1/4K3 b - - 0 1',
  'r1b3r1/1ppp1k2/q6p/p3P3/4P2n/NPPP1nNB/P4P2/R1B2K1R b - - 0 1',
  'R1Q5/8/1k6/2p5/p3P3/7P/1r6/2K3R1 w - - 0 1',
  '8/2NP4/4R3/1P5p/1P5P/2Pk4/5R2/2K5 w - - 0 1',
  'rb3N2/3R4/5p2/p3p1k1/pP4P1/7b/2K1N3/4B3 w - - 0 1',
  'r5r1/bp1kB3/p7/P2Np1n1/4p2p/1B5b/4K2P/R1R5 w - - 0 1',
  '7k/2B5/8/1p1QP1Np/7P/P2K4/1P6/8 w - - 0 1',
  '8/2k3p1/2p4p/1pqp1p2/7Q/2r3P1/6BP/4K2R b - - 0 1',
  '1k6/r1p4p/4N2P/3Q4/Pp6/8/PKB5/4R3 w - - 0 1',
  '4r3/2nr2k1/6p1/7p/1p1p1K1P/1P1N2P1/3P4/2B4R b - - 0 1',
  '1r1qk3/ppn1bp1r/2p5/3np1pp/1P2K1b1/B1PP2N1/P1QN1PPP/3R1BR1 b - - 0 1',
  '1kn1Q2r/Np4pp/8/3rpp2/pb6/2Pp4/PP3q2/R1BK1B2 b - - 0 1',
  '2r5/b7/p1p2kp1/4p2p/8/8/b6r/3K4 b - - 0 1',
  '8/p7/1b6/1P1QP1P1/7R/2p1k3/2K5/8 w - - 0 1',
  '4k3/prpb3r/P6q/3Pbpp1/1n2N1Pp/1N2P2P/1Pp3BR/K3Q3 b - - 0 1',
  'Q7/2p2k2/7p/2N1Pp1P/R2K1P2/6p1/3N2P1/8 w - - 0 1',
  '6k1/8/N5bp/3p2p1/P1p2pP1/2P4K/8/4r3 b - - 0 1',
];
