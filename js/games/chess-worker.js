// The computer's side of a chess game, run in a module Worker so a deep search never freezes the board.
// Message in: { id, fen, moves: [move…], level } (the game's starting FEN and every move since, so repetitions
// count); out: { id, move, score, depth }.
import { Position, think, LEVELS } from './chess-engine.js';

self.onmessage = ({ data: { id, fen, moves = [], level = 3 } }) => {
  try {
    const pos = new Position(fen);
    for (const m of moves) pos.make(m);
    const r = think(pos, LEVELS[level] || LEVELS[3]);
    self.postMessage({ id, move: r.move, score: r.score, depth: r.depth });
  } catch (e) { self.postMessage({ id, move: 0, error: String(e?.message || e) }); }
};
