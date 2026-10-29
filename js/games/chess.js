// Chess for Gaming Hub: play the computer at five levels (its search runs in a module Worker, so the board never
// freezes) or a friend on the same computer, with tap or drag moves, legal-move dots, a promotion picker, check and
// last-move highlights, captured pieces with the material difference, the move list in SAN, take-backs, resign and
// draw offers, optional clocks, and a Daily puzzle: a mate-in-two from the bundled set that the engine verified (PUZZLES
// in chess-engine.js). The board never mirrors in Arabic: a1 stays bottom-left for White.
// Saved state (ctx.save): { v: 1, mode: 'cpu'|'2p'|'puzzle', level, you: 'w'|'b', fen0, moves: [move…], ms,
//   clock: null | { base, w, b } (ms left), puzzle: { idx, tries, phase } }.
// Options in the hub's prefs (center.js setPref): side ('w'|'b'|'random'), board ('classic'|'green'|'blue'),
//   dots, coords, autoflip, clock (minutes, 0 = off), sound.
import { clamp, escapeHtml as esc } from '../core/util.js';
import { t, addStrings } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { confirm, dialog, choose } from '../core/ui.js';
import { Clock, reduceMotion, rng, num, ltr, fmtTime, audioCtx, dateKey, parseDateKey } from './kit.js';
import * as GC from './center.js';
import { Position, START_FEN, PUZZLES, LEVELS, think, forcesMate, bestDefence, mateKeys, mFrom, mTo, mPromo, F_CAP } from './chess-engine.js';
import { pieceSVG } from './chess-pieces.js';

const ID = 'chess';
const DEF = { side: 'w', board: 'classic', dots: true, coords: true, autoflip: false, clock: 0, sound: true };
const pref = (k) => GC.pref(ID, k) ?? DEF[k];
const BOARDS = [['classic', 'games.ch.classic'], ['green', 'games.col.green'], ['blue', 'games.col.blue']];
const CLOCKS = [0, 3, 5, 10, 30];
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_SET = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const other = (c) => (c === 'w' ? 'b' : 'w');
/** Today's puzzle: one a day in order, the same for everyone on the same date. */
const puzzleOfDay = () => Math.round(parseDateKey(dateKey()).getTime() / 864e5) % PUZZLES.length;
const LV = [{ id: '1', name: 'games.lv.c1' }, { id: '2', name: 'games.lv.c2' }, { id: '3', name: 'games.lv.c3' }, { id: '4', name: 'games.lv.c4' }, { id: '5', name: 'games.lv.c5' }, { id: '2p', name: 'games.lv.twoPlayers', noStats: true }];

function mount(el, ctx) {
  el.innerHTML = `<div class="ch" data-board="${esc(pref('board'))}">
    <div class="ch-main">
      <div class="ch-col">
        <div class="ch-player" data-pos="top"></div>
        <div class="ch-board" dir="ltr" role="application" aria-label="${esc(t('games.ch.board'))}" tabindex="0">
          <div class="ch-squares"></div><div class="ch-pieces"></div><div class="ch-promo" hidden></div><div class="ch-over" hidden></div>
        </div>
        <div class="ch-player" data-pos="bottom"></div>
      </div>
      <aside class="ch-side">
        <div class="ch-status" aria-live="polite"><b></b><span></span></div>
        <ol class="ch-moves" dir="ltr"></ol>
        <div class="ch-actions"></div>
      </aside>
    </div>
  </div>`;
  const root = el.firstElementChild, board = root.querySelector('.ch-board'), sqBox = root.querySelector('.ch-squares'), pcBox = root.querySelector('.ch-pieces');
  const promoEl = root.querySelector('.ch-promo'), overEl = root.querySelector('.ch-over'), movesEl = root.querySelector('.ch-moves'), actionsEl = root.querySelector('.ch-actions');
  const statusEl = root.querySelector('.ch-status'), rows = { top: root.querySelector('[data-pos="top"]'), bottom: root.querySelector('[data-pos="bottom"]') };

  // ---------------------------------------------------------------- state
  let game = null, pos = null, legal = [], sel = -1, cursor = -1, drag = null, over = null, thinking = false, reqId = 0, lastScore = 0;
  let pending = null, promo = null, busy = false, paused = false, dead = false, viewFlip = false, flash = '', lastMove = 0;
  const timers = new Set(), clock = new Clock();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); return id; };
  const clearLater = () => { timers.forEach(clearTimeout); timers.clear(); };

  // the computer thinks in a Worker; if one can't start, it thinks here in small doses
  let worker = null;
  try {
    worker = new Worker(new URL('./chess-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onCpu(e.data);
    worker.onerror = (e) => { console.warn('chess worker', e.message); worker = null; if (thinking && lastMsg) thinkHere(lastMsg); };
  } catch {
    worker = null;
  }

  const human = () => game.mode === '2p' || pos.turn === game.you;
  const canAct = () => !!game && !over && !thinking && !busy && !promo && !paused && human();
  // in two-player games with Turn board on, the board turns to the side to move a moment after each move
  let flipTurn = 'w';
  const orient = () => { const base = game.mode === '2p' ? (pref('autoflip') ? flipTurn : 'w') : game.you; return viewFlip ? other(base) : base; };
  const sqAtView = (row, col) => (orient() === 'w' ? ((7 - row) << 4) | col : (row << 4) | (7 - col));
  const viewOf = (sq) => (orient() === 'w' ? { row: 7 - (sq >> 4), col: sq & 7 } : { row: sq >> 4, col: 7 - (sq & 7) });

  function fresh({ mode, level, you, fen0 = START_FEN, puzzle = null }) {
    const mins = mode === 'puzzle' ? 0 : +pref('clock') || 0;
    return { v: 1, mode, level, you, fen0, moves: [], ms: 0, clock: mins ? { base: mins * 60000, w: mins * 60000, b: mins * 60000 } : null, puzzle };
  }
  function load(g) {
    game = g; over = null; sel = -1; legal = []; promo = null; busy = false; thinking = false; flash = ''; lastMove = 0;
    reqId++;
    pos = new Position(g.fen0);
    for (const m of g.moves) { if (!pos.moves().includes(m)) throw new Error('bad move'); lastMove = m; pos.make(m); }
    flipTurn = pos.turn;
    legal = pos.moves();
    clock.reset(g.ms || 0);
    turnStart = performance.now();
    overEl.hidden = true;
    hidePromo();
    buildSquares(); syncPieces(true); render();
    const st = pos.status();
    if (st.over) end(st, { silent: true });
    else nextTurn();
  }

  // ---------------------------------------------------------------- board drawing
  let shownOrient = '';
  function buildSquares() {
    shownOrient = orient();
    let h = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const sq = sqAtView(r, c), light = ((sq >> 4) + (sq & 7)) & 1;
      h += `<div class="ch-sq ${light ? 'l' : 'd'}" data-sq="${sq}">${c === 0 ? `<i class="cr">${(sq >> 4) + 1}</i>` : ''}${r === 7 ? `<i class="cf">${'abcdefgh'[sq & 7]}</i>` : ''}</div>`;
    }
    sqBox.innerHTML = h;
  }
  const sqEl = (sq) => sqBox.querySelector(`[data-sq="${sq}"]`);
  const place = (n, sq) => { const v = viewOf(sq); n.style.transform = `translate(${v.col * 100}%, ${v.row * 100}%)`; n.dataset.sq = sq; };
  let pieces = new Map(); // square → element
  /** Makes the piece elements match the position, sliding the ones that moved (moves, castling, take-backs) and
   *  fading captured ones, so every change animates without special cases. */
  function syncPieces(instant = false) {
    if (shownOrient !== orient()) { buildSquares(); instant = true; }
    const want = new Map();
    for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = pos.at(sq); if (p) want.set(sq, p.color + p.type); }
    const next = new Map(), free = [];
    for (const [sq, n] of pieces) { if (want.get(sq) === n.dataset.code) { next.set(sq, n); want.delete(sq); place(n, sq); } else free.push(n); }
    const dist = (a, b) => Math.abs((a >> 4) - (b >> 4)) + Math.abs((a & 7) - (b & 7));
    const take = (sq, ok) => { let bi = -1, bd = 99; free.forEach((n, i) => { if (ok(n) && dist(+n.dataset.sq, sq) < bd) { bd = dist(+n.dataset.sq, sq); bi = i; } }); return bi >= 0 ? free.splice(bi, 1)[0] : null; };
    for (const [sq, code] of [...want]) { const n = take(sq, (x) => x.dataset.code === code); if (n) { next.set(sq, n); want.delete(sq); place(n, sq); } }
    // a pawn that became a queen (or turns back into a pawn on Undo) keeps its element and changes shape
    for (const [sq, code] of [...want]) { const n = take(sq, (x) => x.dataset.code[0] === code[0] && (x.dataset.code[1] === 'p' || code[1] === 'p')); if (n) { next.set(sq, n); want.delete(sq); place(n, sq); setPiece(n, code); } }
    for (const [sq, code] of want) {
      const n = document.createElement('div');
      n.className = 'ch-pc';
      setPiece(n, code);
      place(n, sq);
      pcBox.appendChild(n);
      next.set(sq, n);
      if (!instant && !reduceMotion()) n.animate([{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }], { duration: 220, easing: 'ease-out' });
    }
    for (const n of free) { if (instant || reduceMotion()) n.remove(); else { n.classList.add('gone'); setTimeout(() => n.remove(), 240); } }
    pieces = next;
    if (instant) { pcBox.classList.add('instant'); void pcBox.offsetWidth; pcBox.classList.remove('instant'); }
  }
  function setPiece(n, code) { n.dataset.code = code; n.innerHTML = pieceSVG(code[1], code[0]); }

  function renderSquares() {
    const kingSq = (side) => { for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = pos.at(sq); if (p && p.type === 'k' && p.color === side) return sq; } return -1; };
    const check = pos.inCheck() ? kingSq(pos.turn) : -1;
    const dots = pref('dots'), tg = new Map();
    if (sel >= 0) for (const m of legal) if (mFrom(m) === sel) tg.set(mTo(m), !!(m & F_CAP));
    for (const n of sqBox.children) {
      const sq = +n.dataset.sq;
      n.classList.toggle('q-last', !!lastMove && (mFrom(lastMove) === sq || mTo(lastMove) === sq));
      n.classList.toggle('q-sel', sq === sel);
      n.classList.toggle('q-chk', sq === check);
      n.classList.toggle('q-dot', dots && tg.has(sq) && !tg.get(sq));
      n.classList.toggle('q-cap', dots && tg.has(sq) && tg.get(sq));
      n.classList.toggle('q-cur', sq === cursor);
    }
    root.classList.toggle('no-coords', !pref('coords'));
  }

  // ---------------------------------------------------------------- side panel: players, status, moves, buttons
  const captured = (color) => { // pieces of `color` still on the board
    const have = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = pos.at(sq); if (p && p.color === color && p.type !== 'k') have[p.type]++; }
    return have;
  };
  function playerHTML(color) {
    const cpu = game.mode === 'cpu' && color !== game.you, lvl = LV.find((l) => l.id === game.level);
    const name = game.mode === 'cpu' ? (cpu ? t('games.ch.computer') : t('games.ch.you')) : game.mode === 'puzzle' ? (color === game.you ? t('games.ch.you') : t('games.ch.defender')) : color === 'w' ? t('games.ch.white') : t('games.ch.black');
    const sub = cpu ? t(lvl?.name || '') : game.mode === 'cpu' || game.mode === 'puzzle' ? (color === 'w' ? t('games.ch.white') : t('games.ch.black')) : '';
    let cap = '', adv = '';
    if (game.fen0 === START_FEN) {
      const left = captured(other(color)), took = { p: 0, n: 0, b: 0, r: 0, q: 0 };
      // what this side has taken: the opponent's missing pieces (promotions can make a count go negative)
      for (const k in START_SET) took[k] = Math.max(0, START_SET[k] - left[k]);
      cap = ['p', 'n', 'b', 'r', 'q'].map((k) => Array.from({ length: took[k] }, () => `<i>${pieceSVG(k, other(color))}</i>`).join('')).join('');
      const mat = (c) => Object.entries(captured(c)).reduce((s, [k, n]) => s + VAL[k] * n, 0);
      const d = mat(color) - mat(other(color));
      if (d > 0) adv = ltr(`+${num(d)}`);
    }
    const ck = game.clock ? `<span class="ch-clock${pos.turn === color && !over && game.moves.length ? ' run' : ''}${clockLeft(color) < 20000 ? ' low' : ''}">${esc(fmtTime(clockLeft(color)))}</span>` : '';
    return `<span class="ch-av ${color}"><i class="ch-av-pc">${pieceSVG('k', color)}</i></span><div class="ch-pn"><b>${esc(name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      ${cpu && thinking ? `<span class="ch-think" aria-label="${esc(t('games.ch.thinking'))}"><i></i><i></i><i></i></span>` : ''}
      <div class="ch-cap" dir="ltr">${cap}${adv ? `<em>${adv}</em>` : ''}</div>${ck}`;
  }
  function statusText() {
    if (over) return [over.title, over.text];
    if (game.mode === 'puzzle') {
      const goal = game.you === 'w' ? t('games.ch.goalW') : t('games.ch.goalB');
      if (flash) return [flash, goal];
      return [t('games.daily'), game.puzzle.phase ? t('games.ch.finish') : goal];
    }
    const chk = pos.inCheck() ? t('games.ch.check') : '';
    if (game.mode === 'cpu') return thinking ? [t('games.ch.thinking'), chk] : human() ? [t('games.ch.yourMove'), chk] : ['', chk];
    return [pos.turn === 'w' ? t('games.ch.whiteMove') : t('games.ch.blackMove'), chk];
  }
  function renderSide() {
    const bottom = orient(), top = other(bottom);
    rows.top.innerHTML = playerHTML(top);
    rows.bottom.innerHTML = playerHTML(bottom);
    rows.top.classList.toggle('turn', !over && pos.turn === top);
    rows.bottom.classList.toggle('turn', !over && pos.turn === bottom);
    const [a, b] = statusText();
    statusEl.querySelector('b').textContent = a;
    statusEl.querySelector('span').textContent = b;
    statusEl.classList.toggle('is-over', !!over);
    statusEl.classList.toggle('is-check', !over && pos.inCheck());
    // the move list: numbered pairs; a game that starts with Black to move begins "1. … Rg2+"
    const first = new Position(game.fen0), sans = sanList();
    const cell = (i) => `<span class="mv${i === sans.length - 1 ? ' cur' : ''}">${esc(sans[i])}</span>`;
    const li = (no, wi, bi) => `<li><span class="no">${no}.</span>${wi == null ? '<span class="e">…</span>' : cell(wi)}${bi == null ? '' : cell(bi)}</li>`;
    let h = '', i = 0, no = first.full;
    if (first.turn === 'b' && sans.length) { h += li(no++, null, 0); i = 1; }
    for (; i < sans.length; i += 2) h += li(no++, i, i + 1 < sans.length ? i + 1 : null);
    movesEl.innerHTML = h || `<li class="ch-empty" dir="auto">${esc(game.mode === 'puzzle' ? t('games.ch.findMate') : t('games.ch.noMoves'))}</li>`;
    movesEl.scrollTop = movesEl.scrollHeight;
    movesEl.scrollLeft = movesEl.scrollWidth;
    const btn = (act, ic, label, disabled, cls = '') => `<button class="ch-btn ${cls}" data-act="${act}" type="button" title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>${icon(ic, 18)}<span>${esc(label)}</span></button>`;
    // Flip is a round icon button, so the two text buttons beside it keep their whole labels
    let acts = btn('flip', 'gmFlip', t('games.ch.flip'), false, 'ic');
    if (game.mode === 'puzzle') acts += btn('solution', 'eye', t('games.ch.solution'), !!over);
    else acts += btn('draw', 'hand', t('games.ch.offerDraw'), over || !game.moves.length) + btn('resign', 'gmFlag', t('games.ch.resign'), over || !game.moves.length);
    actionsEl.innerHTML = acts;
  }
  let sanCache = { key: '', list: [] };
  function sanList() {
    const key = game.fen0 + game.moves.join(',');
    if (sanCache.key === key) return sanCache.list;
    const p = new Position(game.fen0), list = [];
    for (const m of game.moves) { list.push(p.san(m)); p.make(m); }
    sanCache = { key, list };
    return list;
  }
  function render() { renderSquares(); renderSide(); }

  // ---------------------------------------------------------------- clocks
  let turnStart = performance.now();
  const clockRuns = () => !!game?.clock && !over && !paused && game.moves.length > 0;
  function clockLeft(color) {
    const c = game.clock;
    if (!c) return 0;
    return Math.max(0, c[color] - (clockRuns() && pos.turn === color ? performance.now() - turnStart : 0));
  }
  function chargeClock(color) { if (!game.clock || !clockRuns()) { turnStart = performance.now(); return; } game.clock[color] = clockLeft(color); turnStart = performance.now(); }
  function tickClocks() {
    if (!game || over || !clockRuns()) return;
    const c = pos.turn;
    for (const n of root.querySelectorAll('.ch-clock.run')) { n.textContent = fmtTime(clockLeft(c)); n.classList.toggle('low', clockLeft(c) < 20000); }
    if (clockLeft(c) <= 0) { game.clock[c] = 0; flag(c); }
  }
  /** A flag fell: the other side wins, unless it has nothing left that could ever mate (then it's a draw). */
  function flag(c) {
    const o = other(c);
    let mat = 0, minors = 0;
    for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = pos.at(sq); if (p && p.color === o && p.type !== 'k') { mat++; if (p.type === 'n' || p.type === 'b') minors++; } }
    const draw = !mat || (mat === 1 && minors === 1);
    end({ over: true, reason: 'time', winner: draw ? null : o, loser: c });
  }

  // ---------------------------------------------------------------- moves
  function select(sq) { sel = sq; renderSquares(); }
  function tryMove(from, to, how = {}) {
    const opts = legal.filter((m) => mFrom(m) === from && mTo(m) === to);
    if (!opts.length) return false;
    if (opts.length > 1) { showPromo(from, to, opts, how); return true; }
    humanMove(opts[0]);
    return true;
  }
  function humanMove(m) {
    sel = -1;
    if (game.mode === 'puzzle') return puzzleMove(m);
    commit(m);
  }
  /** Plays a move on the board (from either side): notation, animation, sound, clocks, saving. */
  function commit(m, { tryOnly = false } = {}) {
    const mover = pos.turn, capture = !!(m & F_CAP);
    chargeClock(mover);
    pos.make(m);
    game.moves.push(m);
    lastMove = m;
    legal = pos.moves();
    sel = -1;
    if (game.clock && game.moves.length === 1) turnStart = performance.now();
    if (!paused && !document.hidden) clock.start();
    syncPieces(); render();
    sound(pos.inCheck() ? 'check' : capture ? 'cap' : 'move');
    if (game.mode === '2p' && pref('autoflip')) later(() => { flipTurn = pos.turn; if (shownOrient !== orient()) { syncPieces(true); render(); } }, 650);
    ctx.changed?.();
    if (tryOnly) return;
    const st = pos.status();
    if (st.over) { end(st); return; }
    save();
    nextTurn();
  }
  function nextTurn() {
    if (over || !game) return;
    if (game.mode === 'cpu' && pos.turn !== game.you) askCpu();
  }

  // ---------------------------------------------------------------- the computer
  let pendingT0 = 0, lastMsg = null;
  function askCpu() {
    if (thinking || over) return;
    thinking = true;
    renderSide();
    ctx.changed?.();
    const id = ++reqId, level = +game.level || 3;
    const msg = (lastMsg = { id, fen: game.fen0, moves: game.moves.slice(), level });
    pendingT0 = performance.now();
    if (worker) worker.postMessage(msg); else thinkHere(msg);
  }
  // without a Worker the search runs here, shallower and shorter so the window stays responsive
  const thinkHere = (msg) => later(() => {
    const p = new Position(msg.fen);
    for (const m of msg.moves) p.make(m);
    const r = think(p, { ...LEVELS[msg.level], maxDepth: Math.min(4, LEVELS[msg.level].maxDepth), timeMs: 400 });
    onCpu({ id: msg.id, move: r.move, score: r.score });
  }, 30);
  function onCpu(d) {
    if (dead || d.id !== reqId || !game || over) return;
    if (d.error) console.warn('chess engine', d.error);
    lastScore = d.score || 0;
    // a short pause before an instant reply, so the computer's move is seen arriving
    const wait = Math.max(0, 420 - (performance.now() - pendingT0));
    later(() => {
      if (d.id !== reqId) return;
      thinking = false;
      if (paused) { pending = d.move; renderSide(); return; }
      if (d.move && legal.includes(d.move)) commit(d.move); else { renderSide(); ctx.changed?.(); }
    }, wait);
  }

  // ---------------------------------------------------------------- the Daily puzzle (mate in two)
  const prand = rng((ctx.seed || 1) >>> 0);
  function puzzleMove(m) {
    const P = game.puzzle;
    flash = '';
    pos.make(m);
    const mate = pos.status().reason === 'checkmate', good = P.phase === 0 ? !mate && forcesMate(pos, 2) : mate;
    pos.unmake();
    if (P.phase === 0 && mate) { commit(m); return; } // (a mate in one never exists in the bundled puzzles)
    if (!good) {
      P.tries++;
      busy = true;
      commit(m, { tryOnly: true });
      flash = t('games.ch.notQuite');
      render();
      sound('wrong');
      later(() => { pos.unmake(); game.moves.pop(); lastMove = game.moves.at(-1) || 0; legal = pos.moves(); busy = false; syncPieces(); render(); save(); ctx.changed?.(); }, 900);
      return;
    }
    if (P.phase === 1) { commit(m); return; }
    P.phase = 1;
    flash = t('games.ch.goodMove');
    busy = true;
    commit(m);
    later(() => {
      const d = bestDefence(pos, 2, prand);
      busy = false;
      if (d) commit(d);
      flash = '';
      render();
      ctx.changed?.();
    }, 650);
  }
  function showSolution() {
    if (!game || game.mode !== 'puzzle' || over) return;
    clearLater();
    busy = true;
    flash = '';
    while (game.moves.length) { pos.unmake(); game.moves.pop(); }
    legal = pos.moves();
    lastMove = 0;
    syncPieces(); render();
    const key = mateKeys(pos, 2)[0];
    later(() => {
      commit(key);
      later(() => {
        const d = bestDefence(pos, 2, prand);
        if (d) commit(d);
        later(() => { const mate = mateKeys(pos, 1)[0]; if (mate) { game.puzzle.shown = true; commit(mate); } busy = false; }, 800);
      }, 800);
    }, 300);
  }

  // ---------------------------------------------------------------- the end
  function end(st, { silent = false } = {}) {
    if (over) return;
    thinking = false;
    reqId++;
    chargeClock(pos.turn);
    clock.stop();
    game.ms = clock.ms;
    const you = game.you, cpu = game.mode === 'cpu', pz = game.mode === 'puzzle';
    let title = '', text = '', won = false, draw = false;
    if (st.reason === 'checkmate') {
      title = t('games.ch.checkmate');
      won = (cpu || pz) && st.winner === you;
      text = cpu || pz ? (won ? t('games.ch.youWin') : t('games.ch.cpuWins')) : st.winner === 'w' ? t('games.ch.whiteWins') : t('games.ch.blackWins');
    } else if (st.reason === 'resign') {
      title = cpu ? t('games.ch.youResigned') : st.loser === 'w' ? t('games.ch.whiteResigns') : t('games.ch.blackResigns');
      text = cpu ? t('games.ch.cpuWins') : st.loser === 'w' ? t('games.ch.blackWins') : t('games.ch.whiteWins');
    } else if (st.reason === 'time') {
      title = t('games.ch.timeUp');
      draw = !st.winner;
      won = cpu && st.winner === you;
      text = draw ? t('games.ch.timeDraw') : cpu ? (won ? t('games.ch.youWinTime') : t('games.ch.cpuWinsTime')) : st.winner === 'w' ? t('games.ch.whiteWinsTime') : t('games.ch.blackWinsTime');
    } else {
      draw = true;
      title = st.reason === 'stalemate' ? t('games.ch.stalemate') : t('games.ch.draw');
      text = { stalemate: t('games.ch.drawStalemate'), material: t('games.ch.drawMaterial'), fifty: t('games.ch.drawFifty'), repetition: t('games.ch.drawRepetition'), agreed: t('games.ch.drawAgreed') }[st.reason] || '';
    }
    if (pz && game.puzzle.shown) { title = t('games.ch.solutionTitle'); text = t('games.comeBack'); won = false; }
    over = { ...st, title, text, won, draw };
    sel = -1;
    hidePromo();
    render();
    ctx.changed?.();
    overEl.innerHTML = `<div class="ch-over-card"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
    overEl.hidden = false;
    if (silent) return;
    if (st.reason === 'checkmate') sound(won || !cpu ? 'win' : 'move');
    if (cpu || pz) {
      const res = { won, ms: Math.round(game.ms), title: won ? (pz ? t('games.puzzleSolved') : undefined) : title, delay: reduceMotion() ? 300 : 1100 };
      if (pz) res.mistakes = game.puzzle.tries;
      if (draw) res.draw = true;
      ctx.finish(res);
    } else ctx.save(null);
  }
  async function resign() {
    if (!game || over || !game.moves.length || game.mode === 'puzzle') return;
    const loser = game.mode === 'cpu' ? game.you : pos.turn;
    const ok = await confirm(t('games.ch.resignQ'), game.mode === 'cpu' ? t('games.ch.resignCpu') : loser === 'w' ? t('games.ch.resignW') : t('games.ch.resignB'), { okLabel: t('games.ch.resign'), danger: true });
    if (ok && !over && !dead) end({ over: true, reason: 'resign', loser, winner: other(loser) });
  }
  async function offerDraw() {
    if (!game || over || !game.moves.length || game.mode === 'puzzle') return;
    if (game.mode === '2p') {
      const w = pos.turn === 'w';
      const v = await dialog({ title: w ? t('games.ch.whiteOffers') : t('games.ch.blackOffers'), message: w ? t('games.ch.blackAccept') : t('games.ch.whiteAccept'), actions: [{ label: t('games.ch.decline'), value: false }, { label: t('games.ch.accept'), value: true, primary: true }] });
      if (v && !over && !dead) end({ over: true, reason: 'agreed' });
      return;
    }
    // the computer takes a draw when it thinks it's worse, or when a long game has gone level
    const accept = lastScore <= -60 || (Math.abs(lastScore) <= 25 && game.moves.length >= 60);
    if (accept) end({ over: true, reason: 'agreed' });
    else ctx.toast?.(t('games.ch.declines'));
  }

  // ---------------------------------------------------------------- promotion picker
  function showPromo(from, to, opts, how) {
    const v = viewOf(to), down = v.row === 0;
    promo = { from, to, opts };
    const color = pos.turn, list = ['q', 'n', 'r', 'b'];
    promoEl.innerHTML = `<div class="ch-promo-col" style="left:${v.col * 12.5}%;${down ? 'top:0' : 'bottom:0'}">${(down ? list : [...list].reverse()).map((k) => `<button type="button" data-k="${k}" aria-label="${esc({ q: t('games.ch.queen'), n: t('games.ch.knight'), r: t('games.ch.rook'), b: t('games.ch.bishop') }[k])}">${pieceSVG(k, color)}</button>`).join('')}</div>`;
    promoEl.hidden = false;
    if (how.dropped) { const n = pieces.get(from); if (n) { n.classList.remove('drag'); place(n, to); } }
    promoEl.querySelector('button')?.focus({ preventScroll: true });
  }
  function hidePromo() {
    if (!promo) { promoEl.hidden = true; return; }
    const p = promo;
    promo = null;
    promoEl.hidden = true;
    const n = pieces.get(p.from);
    if (n) place(n, p.from);
  }
  promoEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!promo) return;
    if (!b) { hidePromo(); render(); return; }
    const type = ' pnbrqk'.indexOf(b.dataset.k), m = promo.opts.find((x) => mPromo(x) === type);
    hidePromo();
    if (m) humanMove(m);
  });

  // ---------------------------------------------------------------- pointer: tap or drag
  function sqAt(e) {
    const r = board.getBoundingClientRect(), s = r.width / 8;
    const col = Math.floor((e.clientX - r.left) / s), row = Math.floor((e.clientY - r.top) / s);
    return col < 0 || col > 7 || row < 0 || row > 7 ? -1 : sqAtView(row, col);
  }
  board.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || promo || e.target.closest('.ch-over')) return;
    const sq = sqAt(e);
    if (sq < 0 || !canAct()) return;
    e.preventDefault();
    cursor = -1;
    if (sel >= 0 && sel !== sq && legal.some((m) => mFrom(m) === sel && mTo(m) === sq)) { tryMove(sel, sq); return; }
    const p = pos.at(sq);
    if (p && p.color === pos.turn) {
      const wasSel = sel === sq;
      select(sq);
      const r = board.getBoundingClientRect();
      drag = { sq, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, wasSel, n: pieces.get(sq), size: r.width / 8 };
      board.setPointerCapture(e.pointerId);
      return;
    }
    select(-1);
  });
  board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const r = board.getBoundingClientRect(), n = drag.n;
    if (!n) return;
    n.classList.add('drag');
    n.style.transform = `translate(${e.clientX - r.left - drag.size / 2}px, ${e.clientY - r.top - drag.size / 2}px)`;
    const at = sqAt(e);
    for (const s of sqBox.querySelectorAll('.q-hov')) s.classList.remove('q-hov');
    if (at >= 0 && legal.some((m) => mFrom(m) === drag.sq && mTo(m) === at)) sqEl(at)?.classList.add('q-hov');
  });
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try { board.releasePointerCapture(e.pointerId); } catch {}
    for (const s of sqBox.querySelectorAll('.q-hov')) s.classList.remove('q-hov');
    if (!d.moved) { if (d.wasSel) select(-1); return; }
    const to = cancel ? -1 : sqAt(e);
    if (to >= 0 && to !== d.sq && tryMove(d.sq, to, { dropped: true })) { d.n?.classList.remove('drag'); return; }
    d.n?.classList.remove('drag');
    if (d.n) place(d.n, d.sq);
  };
  board.addEventListener('pointerup', (e) => endDrag(e, false));
  board.addEventListener('pointercancel', (e) => endDrag(e, true));
  board.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- buttons and options
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'flip') flipBoard();
    else if (a === 'resign') resign();
    else if (a === 'draw') offerDraw();
    else if (a === 'solution') showSolution();
  });
  function flipBoard() { viewFlip = !viewFlip; syncPieces(true); render(); }
  const nextGame = () => { if (!game.moves.length && !thinking) newGame({ level: game.level }); else ctx.toast?.(t('games.ch.nextGame')); };
  async function pick(title, list, cur, done) {
    const v = await choose(t(title), list.map(([value, label]) => ({ value, label })), cur);
    if (v != null && !dead) done(v);
  }
  function menu() {
    const toggle = (k, label, ic, after) => ({ label: t(label), icon: ic, checked: !!pref(k), onClick: () => { GC.setPref(ID, k, !pref(k)); after?.(); render(); } });
    const items = [{ label: t('games.ch.flip'), icon: 'gmFlip', onClick: flipBoard }];
    if (game.mode === 'cpu') items.push({ label: t('games.ch.playAs'), icon: 'user', onClick: () => pick('games.ch.playAs', [['w', t('games.ch.white')], ['b', t('games.ch.black')], ['random', t('games.ch.random')]], pref('side'), (v) => { GC.setPref(ID, 'side', v); nextGame(); }) });
    if (game.mode !== 'puzzle') items.push({ label: t('games.ch.clock'), icon: 'timer', onClick: () => pick('games.ch.clock', CLOCKS.map((m) => [m, m ? t('games.ch.min', { n: m }) : t('common.off')]), +pref('clock') || 0, (v) => { GC.setPref(ID, 'clock', v); nextGame(); }) });
    items.push({ label: t('games.ch.boardColour'), icon: 'palette', onClick: () => pick('games.ch.boardColour', BOARDS.map(([v, l]) => [v, t(l)]), pref('board'), (v) => { GC.setPref(ID, 'board', v); root.dataset.board = v; }) });
    items.push(toggle('dots', 'games.ch.dots', 'gmDot'), toggle('coords', 'games.ch.coords', 'grid'));
    if (game.mode === '2p') items.push(toggle('autoflip', 'games.ch.autoflip', 'gmFlip', () => { flipTurn = pos.turn; syncPieces(true); }));
    items.push(toggle('sound', 'games.ch.sounds', 'volume'));
    return items;
  }

  // ---------------------------------------------------------------- sounds: a soft wooden tock
  function sound(kind) {
    if (!pref('sound')) return;
    try {
      const ac = audioCtx(), now = ac.currentTime, out = ac.createGain();
      out.gain.value = kind === 'cap' ? 0.32 : 0.22;
      out.connect(ac.destination);
      const tone = (f0, f1, at, len, type = 'triangle') => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, now + at);
        o.frequency.exponentialRampToValueAtTime(f1, now + at + len);
        g.gain.setValueAtTime(0.0001, now + at);
        g.gain.exponentialRampToValueAtTime(1, now + at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
        o.connect(g).connect(out);
        o.start(now + at);
        o.stop(now + at + len + 0.02);
      };
      if (kind === 'win') { [523.3, 659.3, 784].forEach((f, i) => tone(f, f, i * 0.12, 0.5, 'sine')); return; }
      if (kind === 'wrong') { tone(240, 170, 0, 0.18, 'sine'); return; }
      tone(kind === 'cap' ? 480 : 760, kind === 'cap' ? 150 : 240, 0, 0.09);
      if (kind === 'check') tone(880, 660, 0.07, 0.12, 'sine');
    } catch {}
  }

  // ---------------------------------------------------------------- saving
  let saveT = 0;
  const chargeClockQuiet = () => { if (clockRuns()) { game.clock[pos.turn] = clockLeft(pos.turn); turnStart = performance.now(); } };
  const saveNow = () => { clearTimeout(saveT); if (!game || over) return; game.ms = clock.ms; if (game.clock) chargeClockQuiet(); ctx.save({ ...game, moves: game.moves.slice() }); };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 300); };

  // ---------------------------------------------------------------- controller
  function newGame(opts = {}) {
    clearLater();
    reqId++;
    thinking = false;
    pending = null;
    hidePromo();
    const daily = opts.daily ?? false, level = String(opts.level || ctx.level || '2');
    let g;
    if (daily) {
      const idx = puzzleOfDay(), fen = PUZZLES[idx];
      g = fresh({ mode: 'puzzle', level: 'puzzle', you: new Position(fen).turn, fen0: fen, puzzle: { idx, tries: 0, phase: 0 } });
    } else if (level === '2p') g = fresh({ mode: '2p', level, you: 'w' });
    else {
      const side = pref('side');
      g = fresh({ mode: 'cpu', level: LV.some((l) => l.id === level) ? level : '2', you: side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side === 'b' ? 'b' : 'w' });
    }
    viewFlip = false;
    load(g);
    ctx.changed?.();
    saveNow();
  }
  function undo() {
    if (!canUndo()) return;
    clearLater();
    reqId++;
    thinking = false;
    pending = null;
    hidePromo();
    flash = '';
    const pop = () => { pos.unmake(); game.moves.pop(); };
    if (game.mode === '2p') pop();
    else if (game.mode === 'puzzle') { while (game.moves.length) pop(); game.puzzle.phase = 0; }
    else { pop(); while (game.moves.length && pos.turn !== game.you) pop(); }
    lastMove = game.moves.at(-1) || 0;
    legal = pos.moves();
    sel = -1;
    busy = false;
    flipTurn = pos.turn;
    turnStart = performance.now();
    syncPieces(); render(); ctx.changed?.(); save();
    nextTurn();
  }
  function canUndo() {
    if (!game || over || busy || promo) return false;
    if (game.mode === 'cpu') { const s0 = new Position(game.fen0).turn; return game.moves.some((_, i) => (i % 2 ? other(s0) : s0) === game.you); }
    return game.moves.length > 0;
  }
  function pause(on) {
    paused = on;
    if (on) { chargeClockQuiet(); clock.stop(); saveNow(); }
    else {
      turnStart = performance.now();
      if (game && game.moves.length && !over && !document.hidden) clock.start();
      if (pending != null && !over) { const m = pending; pending = null; if (legal.includes(m)) commit(m); }
    }
    render();
  }
  const onVis = () => { if (document.hidden) { clock.stop(); saveNow(); } else if (!paused && game && game.moves.length && !over) clock.start(); };
  document.addEventListener('visibilitychange', onVis);

  // keyboard: arrows move a cursor over the board, Enter or Space picks up and puts down, F turns the board,
  // Escape closes the promotion picker
  function key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !game) return false;
    if (e.key === 'Escape' && promo) { hidePromo(); render(); return true; }
    if (e.code === 'KeyF') { flipBoard(); return true; }
    const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (dirs[e.key]) {
      if (cursor < 0) cursor = sel >= 0 ? sel : orient() === 'w' ? 0x14 : 0x63;
      const v = viewOf(cursor), [dr, dc] = dirs[e.key];
      cursor = sqAtView(clamp(v.row + dr, 0, 7), clamp(v.col + dc, 0, 7));
      renderSquares();
      return true;
    }
    if ((e.key === 'Enter' || e.key === ' ') && cursor >= 0) {
      if (!canAct()) return true;
      if (sel >= 0 && legal.some((m) => mFrom(m) === sel && mTo(m) === cursor)) tryMove(sel, cursor);
      else { const p = pos.at(cursor); select(p && p.color === pos.turn && sel !== cursor ? cursor : -1); }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- layout: the biggest board that fits, side panel or below
  function fit() {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    const pad = W < 520 ? 12 : 20, prow = 48, side = clamp(Math.round(W * 0.3), 240, 320);
    const wide = Math.min(H - 2 * prow - 2 * pad, W - side - 3 * pad), tall = Math.min(W - 2 * pad, H - 2 * prow - 112 - 2 * pad);
    const isWide = wide >= tall * 0.9; // whichever layout gives the bigger board (side by side wins a near tie)
    root.classList.toggle('wide', isWide);
    root.classList.toggle('narrow', !isWide);
    const bs = Math.max(160, Math.floor((isWide ? wide : tall) / 8) * 8);
    root.style.setProperty('--bs', bs + 'px');
    root.style.setProperty('--side', side + 'px');
    root.style.setProperty('--pad', pad + 'px');
  }
  const ro = new ResizeObserver(fit);
  ro.observe(root);
  fit();
  const clockTimer = setInterval(tickClocks, 200);

  // ---------------------------------------------------------------- go: resume the saved game, or start one
  const saved = ctx.load?.();
  let resumed = false;
  if (saved && saved.v === 1 && Array.isArray(saved.moves) && ['cpu', '2p', 'puzzle'].includes(saved.mode) && (saved.mode === 'puzzle') === !!ctx.daily) {
    try { load({ ...saved, puzzle: saved.puzzle || null }); resumed = true; } catch { resumed = false; }
  }
  if (!resumed) newGame({ level: ctx.level, daily: ctx.daily });

  return {
    newGame, undo, canUndo, pause, key, menu,
    time: () => (game?.moves.length ? clock.ms : 0),
    unmount() {
      dead = true;
      saveNow(); clearLater(); clearTimeout(saveT); clearInterval(clockTimer); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      worker?.terminate();
      worker = null;
    },
  };
}

export default {
  id: ID, name: 'games.chess', desc: 'games.ch.desc', rules: 'games.ch.rules', color: '#5d5e66', daily: true,
  levels: LV, level: '2', dailyLevel: 'puzzle', dailyName: 'games.ch.daily', lowerIsBetter: true,
  info: (st) => (st && Array.isArray(st.moves) ? { ms: st.ms || 0 } : {}),
  mount,
};

addStrings({
  en: {
    'games.ch.desc': 'Play the computer or a friend, plus a daily mate-in-two.',
    'games.ch.rules': 'Checkmate the other king: attack it so that it has no safe square left.\nTap a piece to see where it can go, then tap a square, or drag the piece there. Castling, en passant and promotion all work as usual.\nPlay the computer at five levels or a friend on this computer. The Daily puzzle is a mate in two: find the first move, then finish it.\nKeys: arrow keys to move the cursor, Enter or Space to pick up and put down, F to flip the board, Ctrl+Z to take back.',
    'games.ch.board': 'Chessboard',
    'games.ch.daily': 'Mate in two',
    'games.ch.computer': 'Computer',
    'games.ch.you': 'You',
    'games.ch.defender': 'Defender',
    'games.ch.white': 'White',
    'games.ch.black': 'Black',
    'games.ch.random': 'Random',
    'games.ch.thinking': 'Thinking…',
    'games.ch.goalW': 'White to play and mate in 2.',
    'games.ch.goalB': 'Black to play and mate in 2.',
    'games.ch.finish': 'Now finish it: mate in 1.',
    'games.ch.check': 'Check!',
    'games.ch.yourMove': 'Your move',
    'games.ch.whiteMove': 'White to move',
    'games.ch.blackMove': 'Black to move',
    'games.ch.findMate': 'Find the move that forces mate.',
    'games.ch.noMoves': 'No moves yet',
    'games.ch.flip': 'Flip board',
    'games.ch.solution': 'Show solution',
    'games.ch.offerDraw': 'Offer draw',
    'games.ch.resign': 'Resign',
    'games.ch.notQuite': 'Not quite. Try again.',
    'games.ch.goodMove': 'Good move!',
    'games.ch.checkmate': 'Checkmate',
    'games.ch.youWin': 'You win!',
    'games.ch.cpuWins': 'The computer wins.',
    'games.ch.whiteWins': 'White wins.',
    'games.ch.blackWins': 'Black wins.',
    'games.ch.youResigned': 'You resigned',
    'games.ch.whiteResigns': 'White resigns',
    'games.ch.blackResigns': 'Black resigns',
    'games.ch.timeUp': 'Time’s up',
    'games.ch.timeDraw': 'It’s a draw: there’s not enough material left to mate.',
    'games.ch.youWinTime': 'You win on time.',
    'games.ch.cpuWinsTime': 'The computer wins on time.',
    'games.ch.whiteWinsTime': 'White wins on time.',
    'games.ch.blackWinsTime': 'Black wins on time.',
    'games.ch.stalemate': 'Stalemate',
    'games.ch.draw': 'Draw',
    'games.ch.drawStalemate': 'The side to move has no legal moves.',
    'games.ch.drawMaterial': 'Neither side has enough material to mate.',
    'games.ch.drawFifty': 'Fifty moves without a capture or a pawn move.',
    'games.ch.drawRepetition': 'The same position came up three times.',
    'games.ch.drawAgreed': 'Draw agreed.',
    'games.ch.solutionTitle': 'Solution',
    'games.ch.resignQ': 'Resign this game?',
    'games.ch.resignCpu': 'The computer will win this game.',
    'games.ch.resignW': 'White will lose this game.',
    'games.ch.resignB': 'Black will lose this game.',
    'games.ch.whiteOffers': 'White offers a draw',
    'games.ch.blackOffers': 'Black offers a draw',
    'games.ch.blackAccept': 'Black, do you accept?',
    'games.ch.whiteAccept': 'White, do you accept?',
    'games.ch.decline': 'Decline',
    'games.ch.accept': 'Accept',
    'games.ch.declines': 'The computer declines the draw.',
    'games.ch.queen': 'Queen',
    'games.ch.knight': 'Knight',
    'games.ch.rook': 'Rook',
    'games.ch.bishop': 'Bishop',
    'games.ch.nextGame': 'Starts with your next game.',
    'games.ch.playAs': 'Play as',
    'games.ch.clock': 'Chess clock',
    'games.ch.min': '{n} min',
    'games.ch.boardColour': 'Board colour',
    'games.ch.classic': 'Classic',
    'games.ch.dots': 'Show legal moves',
    'games.ch.coords': 'Show coordinates',
    'games.ch.autoflip': 'Turn board after each move',
    'games.ch.sounds': 'Sounds',
  },
  ar: {
    'games.ch.desc': 'العب ضد الكمبيوتر أو صديق، مع تحدٍّ يومي لكش مات في نقلتين.',
    'games.ch.rules': 'اهزم الملك الآخر بكش مات: هاجمه بحيث لا يبقى له مربع آمن.\nانقر على قطعة لترى أين يمكنها الذهاب ثم انقر على مربع، أو اسحب القطعة إليه. التبييت والأخذ بالتجاوز والترقية تعمل كالمعتاد.\nالعب ضد الكمبيوتر بخمسة مستويات أو ضد صديق على هذا الكمبيوتر. أحجية اليوم كش مات في نقلتين: جد النقلة الأولى ثم أكمل.\nالمفاتيح: الأسهم لتحريك المؤشر، وEnter أو Space للالتقاط والوضع، وF لقلب الرقعة، وCtrl+Z للتراجع.',
    'games.ch.board': 'رقعة الشطرنج',
    'games.ch.daily': 'كش مات في نقلتين',
    'games.ch.computer': 'الكمبيوتر',
    'games.ch.you': 'أنت',
    'games.ch.defender': 'المدافع',
    'games.ch.white': 'الأبيض',
    'games.ch.black': 'الأسود',
    'games.ch.random': 'عشوائي',
    'games.ch.thinking': 'يفكر…',
    'games.ch.goalW': 'الأبيض يلعب ويحقق كش مات في نقلتين.',
    'games.ch.goalB': 'الأسود يلعب ويحقق كش مات في نقلتين.',
    'games.ch.finish': 'أنهِها الآن: كش مات في نقلة واحدة.',
    'games.ch.check': 'كش!',
    'games.ch.yourMove': 'دورك',
    'games.ch.whiteMove': 'دور الأبيض',
    'games.ch.blackMove': 'دور الأسود',
    'games.ch.findMate': 'ابحث عن النقلة التي تفرض كش مات.',
    'games.ch.noMoves': 'لا نقلات بعد',
    'games.ch.flip': 'قلب الرقعة',
    'games.ch.solution': 'عرض الحل',
    'games.ch.offerDraw': 'عرض التعادل',
    'games.ch.resign': 'استسلام',
    'games.ch.notQuite': 'ليس تمامًا. حاول مرة أخرى.',
    'games.ch.goodMove': 'نقلة ممتازة!',
    'games.ch.checkmate': 'كش مات',
    'games.ch.youWin': 'لقد فزت!',
    'games.ch.cpuWins': 'فاز الكمبيوتر.',
    'games.ch.whiteWins': 'فاز الأبيض.',
    'games.ch.blackWins': 'فاز الأسود.',
    'games.ch.youResigned': 'لقد استسلمت',
    'games.ch.whiteResigns': 'الأبيض يستسلم',
    'games.ch.blackResigns': 'الأسود يستسلم',
    'games.ch.timeUp': 'انتهى الوقت',
    'games.ch.timeDraw': 'تعادل: لم يبقَ ما يكفي من القطع لفرض كش مات.',
    'games.ch.youWinTime': 'فزت بانتهاء وقت المنافس.',
    'games.ch.cpuWinsTime': 'فاز الكمبيوتر بانتهاء وقتك.',
    'games.ch.whiteWinsTime': 'فاز الأبيض بانتهاء الوقت.',
    'games.ch.blackWinsTime': 'فاز الأسود بانتهاء الوقت.',
    'games.ch.stalemate': 'بات',
    'games.ch.draw': 'تعادل',
    'games.ch.drawStalemate': 'لا يملك الطرف صاحب الدور أي نقلة قانونية.',
    'games.ch.drawMaterial': 'لا يملك أي طرف ما يكفي من القطع لفرض كش مات.',
    'games.ch.drawFifty': 'خمسون نقلة دون أسر أو تحريك بيدق.',
    'games.ch.drawRepetition': 'تكرر الوضع نفسه ثلاث مرات.',
    'games.ch.drawAgreed': 'تم الاتفاق على التعادل.',
    'games.ch.solutionTitle': 'الحل',
    'games.ch.resignQ': 'هل تريد الاستسلام في هذه المباراة؟',
    'games.ch.resignCpu': 'سيفوز الكمبيوتر بهذه المباراة.',
    'games.ch.resignW': 'سيخسر الأبيض هذه المباراة.',
    'games.ch.resignB': 'سيخسر الأسود هذه المباراة.',
    'games.ch.whiteOffers': 'الأبيض يعرض التعادل',
    'games.ch.blackOffers': 'الأسود يعرض التعادل',
    'games.ch.blackAccept': 'هل يقبل الأسود؟',
    'games.ch.whiteAccept': 'هل يقبل الأبيض؟',
    'games.ch.decline': 'رفض',
    'games.ch.accept': 'قبول',
    'games.ch.declines': 'رفض الكمبيوتر التعادل.',
    'games.ch.queen': 'وزير',
    'games.ch.knight': 'حصان',
    'games.ch.rook': 'قلعة',
    'games.ch.bishop': 'فيل',
    'games.ch.nextGame': 'يسري من مباراتك التالية.',
    'games.ch.playAs': 'اللعب بـ',
    'games.ch.clock': 'ساعة الشطرنج',
    'games.ch.min': '{n} د',
    'games.ch.boardColour': 'لون الرقعة',
    'games.ch.classic': 'كلاسيكي',
    'games.ch.dots': 'إظهار النقلات الممكنة',
    'games.ch.coords': 'إظهار الإحداثيات',
    'games.ch.autoflip': 'قلب الرقعة بعد كل نقلة',
    'games.ch.sounds': 'الأصوات',
  },
});
