// Chess engine checks in plain node: perft counts on the standard test positions, SAN, draws, mate detection, the
// search, and every bundled Daily Challenge puzzle (no mate in one, exactly one key move that mates in two).
// usage: node .dev/games-chess-engine.mjs        (QUICK=1 skips the slower perft depths)
import { Position, perft, think, mateKeys, canMate, forcesMate, bestDefence, PUZZLES, LEVELS, START_FEN, uci, MATE } from '../js/games/chess-engine.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('FAIL', what); } else console.log('ok  ', what); };
const t0 = Date.now();

// ---------------------------------------------------------------- perft
const PERFT = [
  ['startpos', START_FEN, [20, 400, 8902, 197281]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 4 mirrored', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
for (const [name, fen, counts] of PERFT) {
  const pos = new Position(fen);
  counts.forEach((want, i) => {
    if (process.env.QUICK && want > 20000) return;
    const got = perft(pos, i + 1);
    ok(got === want, `perft ${name} depth ${i + 1}: ${got} (want ${want})`);
  });
  ok(pos.fen() === new Position(fen).fen() && pos.up === 0, `perft ${name} leaves the position unchanged`);
}

// ---------------------------------------------------------------- FEN, SAN, hashing
{
  const p = new Position();
  ok(p.fen() === START_FEN, 'start FEN round-trips');
  for (const s of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']) { const m = p.parse(s); if (!m) { ok(false, 'parse ' + s); break; } p.make(m); }
  ok(p.fen() === 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5', 'Ruy Lopez line ends in the right FEN (' + p.fen() + ')');
  const lo = p.lo, hi = p.hi; p.rehash();
  ok(lo === p.lo && hi === p.hi, 'incremental hash matches a fresh one');
  const q = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  ok(q.moves().map(m => q.san(m)).includes('O-O-O'), 'queenside castling in SAN');
  const d = new Position('7k/8/8/8/8/8/8/R3K2R w - - 0 1').moves();
  ok(d.length > 0, 'moves without castling rights');
  const amb = new Position('k7/8/8/8/8/8/8/KN3N2 w - - 0 1');
  ok(amb.san(amb.parse('b1d2')) === 'Nbd2', 'file disambiguation (' + amb.san(amb.parse('b1d2')) + ')');
  const amb2 = new Position('k7/8/8/8/8/1N6/8/KN6 w - - 0 1');
  ok(amb2.san(amb2.parse('b1d2')) === 'N1d2', 'rank disambiguation (' + amb2.san(amb2.parse('b1d2')) + ')');
  const pr = new Position('8/1P5k/8/8/8/8/8/K7 w - - 0 1');
  ok(pr.moves().length === 3 + 4, 'four promotion choices');
  ok(pr.san(pr.parse('b7b8q')) === 'b8=Q', 'promotion SAN');
  const ep = new Position('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const epm = ep.parse('exf6');
  ok(epm && ep.san(epm) === 'exf6', 'en passant capture is legal and written exf6');
  ep.make(epm); ok(ep.fen().startsWith('rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR b'), 'en passant removes the passed pawn'); ep.unmake();
  ok(ep.fen() === 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'unmake restores en passant');
  const noEp = new Position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); noEp.make(noEp.parse('e4'));
  ok(noEp.fen().split(' ')[3] === '-', 'no en-passant square when no pawn can take');
  const pin = new Position('4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1');
  ok(!pin.moves().some(m => uci(m).startsWith('e2')), 'a pinned knight can\'t move');
  const castleThrough = new Position('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
  ok(!castleThrough.moves().some(m => castleThrough.san(m) === 'O-O') && castleThrough.moves().some(m => castleThrough.san(m) === 'O-O-O'), 'no castling through an attacked square, the other side still allowed');
}

// ---------------------------------------------------------------- game end
{
  const fool = new Position(); for (const s of ['f3', 'e5', 'g4', 'Qh4']) fool.make(fool.parse(s));
  const st = fool.status();
  ok(st.over && st.reason === 'checkmate' && st.winner === 'b', "Fool's mate is checkmate for Black");
  const stale = new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status();
  ok(stale.over && stale.reason === 'stalemate', 'stalemate');
  ok(new Position('8/8/4k3/8/8/2B5/4K3/8 w - - 0 1').status().reason === 'material', 'K+B v K is a draw');
  ok(new Position('8/8/4k3/8/8/2N5/4K3/8 w - - 0 1').status().reason === 'material', 'K+N v K is a draw');
  ok(new Position('8/2b5/4k3/8/8/2B5/4K3/8 w - - 0 1').status().reason === 'material', 'K+B v K+B on the same colour is a draw');
  ok(!new Position('8/1b6/4k3/8/8/2B5/4K3/8 w - - 0 1').status().over, 'K+B v K+B on opposite colours plays on');
  ok(!new Position('8/8/4k3/8/8/2N5/4K3/5n2 w - - 0 1').status().over, 'K+N v K+N plays on');
  ok(new Position('8/8/4k3/8/8/8/4K3/7R w - - 100 80').status().reason === 'fifty', 'fifty-move rule');
  const rep = new Position(); for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) rep.make(rep.parse(s));
  ok(!rep.status().over, 'two repetitions play on');
  rep.make(rep.parse('Ng8'));
  ok(rep.status().reason === 'repetition', 'threefold repetition');
  const mateFifty = new Position('7k/8/6K1/8/8/8/8/R7 w - - 99 80'); mateFifty.make(mateFifty.parse('Ra8'));
  ok(mateFifty.status().reason === 'checkmate', 'mate on the 100th half-move beats the fifty-move rule');
}

// ---------------------------------------------------------------- mate finding and search
{
  const m1 = new Position('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  ok(mateKeys(m1, 1).map(uci).join() === 'a1a8', 'back-rank mate in one found');
  const r = think(m1, { maxDepth: 4, timeMs: 2000 });
  ok(uci(r.move) === 'a1a8' && r.score > MATE - 10, 'search plays mate in one (' + uci(r.move) + ' ' + r.score + ')');
  for (const fen of PUZZLES.slice(0, 5)) {
    const p = new Position(fen), r2 = think(p, LEVELS[5]);
    ok(r2.score >= MATE - 4 && mateKeys(p, 2).includes(r2.move), 'level 5 finds the mate in two in ' + fen + ' (' + p.san(r2.move) + ')');
  }
  const free = new Position('rnb1kbnr/pppp1ppp/8/4p3/6q1/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
  const rf = think(free, LEVELS[4]);
  ok(rf.move, 'level 4 returns a move (' + free.san(rf.move) + ', depth ' + rf.depth + ')');
  const take = new Position('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1');
  ok(uci(think(take, LEVELS[3]).move) === 'd2d5', 'level 3 takes a free queen');
  ok(uci(think(take, LEVELS[5]).move) === 'd2d5', 'level 5 takes a free queen');
  const start = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), before = start.fen(), t = Date.now();
  const r5 = think(start, LEVELS[5]);
  ok(start.fen() === before && start.up === 0, 'think leaves the position as it was');
  ok(Date.now() - t < LEVELS[5].timeMs + 600, `level 5 keeps to its time (${Date.now() - t} ms, depth ${r5.depth}, ${r5.nodes} nodes)`);
  const bk = new Position(); ok(['e2e4', 'd2d4', 'c2c4', 'g1f3'].includes(uci(think(bk, LEVELS[5]).move)), 'level 5 opens from its book');
  for (const lv of [1, 2, 3, 4]) { const s = Date.now(), rr = think(new Position(), LEVELS[lv]); ok(rr.move && Date.now() - s < LEVELS[lv].timeMs + 600, `level ${lv} answers in ${Date.now() - s} ms (${new Position().san(rr.move)})`); }
  // the computer converts K+Q v K: play it out against itself
  const kq = new Position('8/8/8/4k3/8/8/8/3QK3 w - - 0 1');
  let plies = 0;
  while (!kq.status().over && plies < 80) { kq.make(think(kq, { maxDepth: 40, timeMs: 150 }).move); plies++; }
  ok(kq.status().reason === 'checkmate', `level 5 mates with K+Q v K (${plies} plies)`);
}

// ---------------------------------------------------------------- Daily Challenge puzzles
{
  ok(PUZZLES.length >= 30, `${PUZZLES.length} puzzles bundled`);
  const seen = new Set();
  PUZZLES.forEach((fen, i) => {
    const p = new Position(fen);
    const st = p.status();
    const m1 = mateKeys(p, 1), keys = mateKeys(p, 2);
    const good = !st.over && !m1.length && keys.length === 1 && !seen.has(p.fen().split(' ').slice(0, 2).join(' '));
    seen.add(p.fen().split(' ').slice(0, 2).join(' '));
    ok(good, `puzzle ${i + 1} ${p.turn} to play: mate in 2 with one key (${keys.map(m => p.san(m)).join(', ')})`);
    if (good) {
      p.make(keys[0]);
      const d = bestDefence(p, 2);
      if (d) { p.make(d); ok(canMate(p, 1), `puzzle ${i + 1}: mate follows the toughest defence`); p.unmake(); }
      p.unmake();
      ok(p.fen() === new Position(fen).fen(), `puzzle ${i + 1}: checks leave it unchanged`);
    }
  });
}

console.log(`\n${checks - fails}/${checks} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(fails ? `FAIL ${fails}` : 'PASS');
process.exit(fails ? 1 : 0);
