// Solitaire (Klondike) for Gaming Hub: Draw 1 or Draw 3 (the Difficulty choice), standard scoring with the time penalty
// and bonus, drag and drop of whole runs, tap to move, safe cards that go up by themselves, auto-complete once every card
// is face up, unlimited Undo, hints, a Daily deal the solver proves can be won, and the classic bouncing-card cascade
// when you win (skipped with Reduce motion). The piles mirror in right-to-left languages; the cards never do.
// Saved state (ctx.save): { v: 1, draw, seed, daily, proved, s: Klondike state (cards-klondike.js), score, moves,
// passes, ms, hist: ["packed position~score~moves~passes"…] (every Undo step, up to 1000, so Undo still reaches the deal
// after reopening) }.
// Options live in the hub's prefs (center.js setPref): auto (move safe cards up), back (card back), felt (table).
import { clamp, escapeHtml as esc } from '../core/util.js';
import { t, isRtl, addStrings } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { choose } from '../core/ui.js';
import { Clock, newSeed, reduceMotion, num } from './kit.js';
import * as GC from './center.js';
import { faceSVG, backSVG, isRed, rank, cardLabel } from './cards.js';
import * as K from './cards-klondike.js';

const ID = 'solitaire';
const PTS = { wasteTab: 5, wasteFound: 10, tabFound: 10, flip: 5, foundTab: -15 };
const RECYCLE = { 1: -100, 3: -20 };
const HIST = 1000;
const BACKS = [['blue', 'games.col.blue'], ['red', 'games.col.red'], ['green', 'games.col.green'], ['graphite', 'games.col.graphite'], ['aurora', 'games.col.aurora']];
const FELTS = [['green', 'games.col.green'], ['blue', 'games.col.blue'], ['red', 'games.col.red'], ['graphite', 'games.col.graphite']];
const DEF = { auto: true, back: 'blue', felt: 'green' };
const pref = (k) => GC.pref(ID, k) ?? DEF[k];

/** The score shown now: points minus 2 for every 10 seconds played, never below 0 (standard scoring). */
const liveScore = (g) => Math.max(0, (g.score || 0) - 2 * Math.floor((g.ms || 0) / 10000));
const onFound = (s) => s.found.reduce((n, f) => n + f.length, 0);
const validState = (s) => {
  try {
    const all = [...s.stock, ...s.waste, ...s.found.flat(), ...s.tab.flatMap((c) => [...c.d, ...c.u])];
    return all.length === 52 && new Set(all).size === 52 && all.every((c) => Number.isInteger(c) && c >= 0 && c < 52) && s.tab.length === 7 && s.found.length === 4 && [1, 3].includes(s.draw);
  } catch {
    return false;
  }
};

function mount(el, ctx) {
  el.innerHTML = `<div class="sol" data-felt="${esc(pref('felt'))}" data-back="${esc(pref('back'))}">
    <div class="sol-bar">
      <div class="sol-stats" aria-live="off">
        <span><small>${esc(t('games.score'))}</small><b class="sol-score">0</b></span>
        <span><small>${esc(t('games.moves'))}</small><b class="sol-moves">0</b></span>
      </div>
      <button class="sol-btn sol-hint" type="button">${icon('gmBulb', 18)}<span>${esc(t('games.hint'))}</span></button>
    </div>
    <div class="sol-table" dir="ltr"><div class="sol-slots"></div><div class="sol-cards"></div>
      <div class="sol-msg" hidden><span></span><button class="sol-btn sol-msg-undo" type="button">${icon('gmUndo', 18)}<span>${esc(t('common.undo'))}</span></button></div></div>
  </div>`;
  const root = el.firstElementChild, table = root.querySelector('.sol-table'), cardsBox = root.querySelector('.sol-cards'), slotsBox = root.querySelector('.sol-slots');
  const msg = root.querySelector('.sol-msg');
  const $ = (s) => root.querySelector(s);

  // ---------------------------------------------------------------- the cards (one element each, kept for the whole game)
  const cardEl = [];
  for (let c = 0; c < 52; c++) {
    const n = document.createElement('div');
    n.className = 'sol-card';
    n.dataset.c = c;
    n.innerHTML = `<div class="sol-face${isRed(c) ? ' red' : ''}">${faceSVG(c)}</div><div class="sol-back"><div class="sol-bk">${backSVG()}</div></div>`;
    cardsBox.appendChild(n);
    cardEl.push(n);
  }
  slotsBox.innerHTML = `<div class="sol-slot stock" data-p="stock"><i class="sol-recycle">${icon('refresh', 24)}</i></div><div class="sol-slot waste" data-p="waste"></div>`
    + [0, 1, 2, 3].map((i) => `<div class="sol-slot found" data-p="found" data-i="${i}"><b>A</b></div>`).join('')
    + [0, 1, 2, 3, 4, 5, 6].map((i) => `<div class="sol-slot tab" data-p="tab" data-i="${i}"><b>K</b></div>`).join('');
  const slotEl = { stock: $('.sol-slot.stock'), waste: $('.sol-slot.waste'), found: [...root.querySelectorAll('.sol-slot.found')], tab: [...root.querySelectorAll('.sol-slot.tab')] };

  // ---------------------------------------------------------------- game state
  let g = null, busy = false, over = false, dead = false, hintIdx = 0, lastHintKey = '';
  const timers = new Set();
  const clock = new Clock();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); return id; };
  const clearLater = () => { timers.forEach(clearTimeout); timers.clear(); };

  const fresh = (draw, seed, daily, proved = false) => ({ v: 1, draw, seed, daily: !!daily, proved, s: K.deal(K.deck(seed), draw), score: 0, moves: 0, passes: 0, ms: 0, hist: [] });
  const snap = () => `${K.pack(g.s)}~${g.score}~${g.moves}~${g.passes}`;
  /** An Undo step back as { s, score, moves, passes }. */
  const unsnap = (h) => {
    const [p, score, moves, passes] = h.split('~');
    return { s: K.unpack(p, g.draw), score: +score || 0, moves: +moves || 0, passes: +passes || 0 };
  };
  const started = () => g.moves > 0 || g.hist.length > 0;

  // ---------------------------------------------------------------- layout
  let L = null;
  function layout() {
    const W = table.clientWidth, H = table.clientHeight;
    if (!W || !H) return false;
    const pad = clamp(Math.round(W * 0.022), 8, 24), gap = clamp(Math.round(W * 0.014), 4, 16);
    // seven columns across, and room for the top row plus a reasonable fan below it
    let cw = Math.min((W - 2 * pad - 6 * gap) / 7, (H - 2 * pad) / (1.4 * 2 + 1.4 * 0.26 * 5.2));
    cw = Math.floor(clamp(cw, 34, 150));
    const ch = Math.round(cw * 1.4), left = Math.round((W - 7 * cw - 6 * gap) / 2), rtl = isRtl();
    // in right-to-left languages the stock sits on the right and the columns count from the right
    const colX = (i) => (rtl ? W - left - cw - i * (cw + gap) : left + i * (cw + gap));
    L = { W, H, pad, gap, cw, ch, colX, rtl, topY: pad, tabY: pad + ch + Math.max(gap, Math.round(ch * 0.12)), fd: Math.round(ch * 0.1), fu: Math.round(ch * 0.26), dir: rtl ? -1 : 1 };
    root.style.setProperty('--cw', cw + 'px');
    root.style.setProperty('--ch', ch + 'px');
    const put = (n, x, y) => { n.style.transform = `translate(${x}px, ${y}px)`; };
    put(slotEl.stock, colX(0), L.topY);
    put(slotEl.waste, colX(1), L.topY);
    slotEl.found.forEach((n, i) => put(n, colX(3 + i), L.topY));
    slotEl.tab.forEach((n, i) => put(n, colX(i), L.tabY));
    return true;
  }
  /** Where every card sits: Map card → { x, y, up, z }. */
  function place() {
    const P = new Map(), s = g.s, { colX, topY, tabY, ch } = L;
    s.stock.forEach((c, i) => P.set(c, { x: colX(0), y: topY - Math.min(2, i >> 3), up: false, z: 10 + i, buried: i < s.stock.length - 2 }));
    const fan = s.draw === 3 ? Math.min(3, s.waste.length) : 1, step = Math.round(L.cw * 0.24);
    s.waste.forEach((c, i) => { const k = i - (s.waste.length - fan); P.set(c, { x: colX(1) + (k > 0 ? k * step * L.dir : 0), y: topY, up: true, z: 100 + i, buried: i < s.waste.length - 4 }); });
    s.found.forEach((f, j) => f.forEach((c, i) => P.set(c, { x: colX(3 + j), y: topY, up: true, z: 200 + i, buried: i < f.length - 2 })));
    const avail = L.H - tabY - L.pad;
    s.tab.forEach((col, i) => {
      let fd = L.fd, fu = L.fu;
      const need = () => col.d.length * fd + Math.max(0, col.u.length - 1) * fu + ch;
      if (need() > avail && col.u.length > 1) fu = Math.max(Math.round(ch * 0.13), Math.floor((avail - ch - col.d.length * fd) / (col.u.length - 1)));
      if (need() > avail && col.d.length) fd = Math.max(Math.round(ch * 0.05), Math.floor((avail - ch - Math.max(0, col.u.length - 1) * fu) / col.d.length));
      let y = tabY, z = 300;
      col.d.forEach((c) => { P.set(c, { x: colX(i), y, up: false, z: z++ }); y += fd; });
      col.u.forEach((c) => { P.set(c, { x: colX(i), y, up: true, z: z++ }); y += fu; });
    });
    return P;
  }
  let lastP = new Map(), zTimer = 0;
  /** Puts every card where it belongs; `stagger` (Map card → ms) delays some flights so they leave one by one. */
  function render({ instant = false, stagger = null } = {}) {
    if (!g || !L) return;
    const P = place();
    root.classList.toggle('instant', instant);
    let maxDelay = 0;
    for (let c = 0; c < 52; c++) {
      const n = cardEl[c], p = P.get(c);
      if (!p || n.classList.contains('drag')) continue;
      const prev = lastP.get(c), moved = !prev || prev.x !== p.x || prev.y !== p.y || prev.up !== p.up;
      const d = stagger?.get(c) || 0;
      maxDelay = Math.max(maxDelay, d);
      n.style.transitionDelay = instant ? '' : d + 'ms';
      // a card in flight stays above the piles it crosses, then drops to its place in the pile
      n.style.zIndex = moved && !instant ? 1000 + p.z : p.z;
      n.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotateY(${p.up ? 0 : 180}deg)`;
      n.classList.toggle('up', p.up);
      // cards deep in a pile cast no shadow: two dozen stacked shadows would draw a dark rim around the stock
      n.classList.toggle('buried', !!p.buried);
      n.setAttribute('aria-label', p.up ? cardLabel(c) : '');
    }
    lastP = P;
    clearTimeout(zTimer);
    zTimer = setTimeout(() => { for (const [c, p] of lastP) if (!cardEl[c].classList.contains('drag')) cardEl[c].style.zIndex = p.z; }, instant ? 0 : 420 + maxDelay);
    if (instant) requestAnimationFrame(() => root.classList.remove('instant'));
    slotEl.stock.classList.toggle('empty', !g.s.stock.length);
    slotEl.stock.classList.toggle('can-recycle', !g.s.stock.length && g.s.waste.length > 0);
    stats();
  }
  function stats() {
    if (!g) return;
    g.ms = clock.ms;
    $('.sol-score').textContent = num(liveScore(g));
    $('.sol-moves').textContent = num(g.moves);
  }

  // ---------------------------------------------------------------- saving
  let saveT = 0;
  const saveNow = () => { clearTimeout(saveT); if (!g || over) return; g.ms = clock.ms; ctx.save({ ...g, hist: g.hist.slice(-HIST) }); };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); };

  // ---------------------------------------------------------------- moves
  const where = (c) => {
    const s = g.s;
    if (s.stock.includes(c)) return { p: 'stock' };
    let i = s.waste.indexOf(c);
    if (i >= 0) return { p: 'waste', idx: i, top: i === s.waste.length - 1 };
    for (let j = 0; j < 4; j++) { i = s.found[j].indexOf(c); if (i >= 0) return { p: 'found', slot: j, idx: i, top: i === s.found[j].length - 1 }; }
    for (let j = 0; j < 7; j++) {
      i = s.tab[j].u.indexOf(c);
      if (i >= 0) return { p: 'tab', col: j, idx: i, top: i === s.tab[j].u.length - 1, up: true };
      if (s.tab[j].d.includes(c)) return { p: 'tab', col: j, up: false };
    }
    return null;
  };
  const runOf = (loc) => (loc.p === 'tab' ? g.s.tab[loc.col].u.slice(loc.idx) : loc.p === 'waste' ? [g.s.waste.at(-1)] : loc.p === 'found' ? [g.s.found[loc.slot].at(-1)] : []);
  /** Takes the moving cards off their pile; turns over the card it uncovers (+5). */
  function lift(loc) {
    const s = g.s;
    if (loc.p === 'waste') return [s.waste.pop()];
    if (loc.p === 'found') return [s.found[loc.slot].pop()];
    const col = s.tab[loc.col], run = col.u.splice(loc.idx);
    if (!col.u.length && col.d.length) { col.u.push(col.d.pop()); g.score += PTS.flip; }
    return run;
  }
  /** Applies one move (to = { p: 'found', slot } | { p: 'tab', col }) with its points. Returns false if not allowed. */
  function apply(loc, to) {
    const run = runOf(loc);
    if (!run.length) return false;
    if (to.p === 'found' && (run.length > 1 || !K.fitsFound(g.s, run[0], to.slot))) return false;
    if (to.p === 'tab' && (!K.fitsTab(g.s, run[0], to.col) || (loc.p === 'tab' && loc.col === to.col))) return false;
    lift(loc);
    if (to.p === 'found') g.s.found[to.slot].push(run[0]); else g.s.tab[to.col].u.push(...run);
    g.score += loc.p === 'waste' ? (to.p === 'found' ? PTS.wasteFound : PTS.wasteTab) : loc.p === 'found' ? PTS.foundTab : to.p === 'found' ? PTS.tabFound : 0;
    g.score = Math.max(0, g.score);
    return true;
  }
  /** Sends safe cards up by themselves (option), one after another. Returns the cards it moved, in order. */
  function autoUp() {
    const out = [];
    if (!pref('auto')) return out;
    for (let again = true; again;) {
      again = false;
      const s = g.s, tops = [];
      if (s.waste.length) tops.push({ p: 'waste', idx: s.waste.length - 1 });
      s.tab.forEach((c, col) => { if (c.u.length) tops.push({ p: 'tab', col, idx: c.u.length - 1 }); });
      for (const loc of tops) {
        const c = runOf(loc)[0], slot = K.foundSlotFor(s, c);
        if (slot >= 0 && K.safeUp(s, c) && apply(loc, { p: 'found', slot })) { out.push(c); again = true; break; }
      }
    }
    return out;
  }
  /** One player move: Undo point, the move, the safe cards after it, then checks for the end of the game. */
  function play(loc, to) {
    if (busy || over || paused) return false;
    const before = snap();
    if (!apply(loc, to)) return false;
    g.hist.push(before);
    g.moves++;
    afterMove();
    return true;
  }
  function afterMove(stagger = new Map()) {
    if (!paused && !document.hidden) clock.start();
    const ups = autoUp(), t0 = stagger.size ? 260 : 140;
    ups.forEach((c, i) => stagger.set(c, t0 + i * 110));
    render({ stagger });
    hideMsg();
    hintIdx = 0;
    ctx.changed?.();
    save();
    if (K.won(g.s)) return later(win, 520 + ups.length * 110);
    if (canAutoComplete()) return later(autoComplete, 420 + ups.length * 110);
    if (K.stuck(g.s)) later(() => showMsg(t('games.sol.noMoves')), 600);
  }
  function draw() {
    if (busy || over || !g || paused) return;
    const s = g.s;
    if (!s.stock.length && !s.waste.length) return;
    g.hist.push(snap());
    const moved = [];
    if (s.stock.length) for (let k = 0; k < s.draw && s.stock.length; k++) { const c = s.stock.pop(); s.waste.push(c); moved.push(c); }
    else { s.stock = s.waste.reverse(); s.waste = []; g.passes++; g.score = Math.max(0, g.score + RECYCLE[s.draw]); }
    g.moves++;
    const stagger = new Map();
    moved.forEach((c, i) => stagger.set(c, i * 70));
    afterMove(stagger);
  }
  /** Tap to move: up to a foundation if it can go, else onto the best column, else a little shake. */
  function tapMove(loc, n) {
    const run = runOf(loc);
    if (!run.length) return false;
    if (run.length === 1 && loc.p !== 'found') { const slot = K.foundSlotFor(g.s, run[0]); if (slot >= 0) return play(loc, { p: 'found', slot }); }
    const cols = [0, 1, 2, 3, 4, 5, 6].filter((c) => !(loc.p === 'tab' && c === loc.col) && K.fitsTab(g.s, run[0], c));
    // a king that already heads an empty-based column has nowhere better to go
    const kingHome = loc.p === 'tab' && loc.idx === 0 && !g.s.tab[loc.col].d.length;
    const best = cols.find((c) => g.s.tab[c].u.length) ?? (kingHome ? undefined : cols[0]);
    if (best != null) return play(loc, { p: 'tab', col: best });
    if (!reduceMotion()) n?.animate?.([{ translate: '0 0' }, { translate: '-5px 0' }, { translate: '5px 0' }, { translate: '-3px 0' }, { translate: '0 0' }], { duration: 280, easing: 'ease-out' });
    return false;
  }
  function canAutoComplete() {
    const s = g.s;
    return !over && K.allUp(s) && ((!s.stock.length && !s.waste.length) || s.draw === 1) && !K.won(s);
  }
  /** Plays out a game whose cards are all face up: the lowest card that can go up goes next (dealing from the stock
   *  in Draw 1 when the card needed is there). */
  function autoComplete() {
    if (over || busy) return;
    busy = true;
    ctx.changed?.();
    const order = [];
    g.hist.push(snap());
    for (let guard = 0; guard < 400 && !K.won(g.s); guard++) {
      const s = g.s, tops = [];
      if (s.waste.length) tops.push({ p: 'waste', idx: s.waste.length - 1 });
      s.tab.forEach((c, col) => { if (c.u.length) tops.push({ p: 'tab', col, idx: c.u.length - 1 }); });
      const ok = tops.map((loc) => ({ loc, c: runOf(loc)[0] })).filter((x) => K.foundSlotFor(s, x.c) >= 0).sort((a, b) => rank(a.c) - rank(b.c))[0];
      if (ok) { apply(ok.loc, { p: 'found', slot: K.foundSlotFor(s, ok.c) }); order.push(ok.c); g.moves++; continue; }
      if (s.stock.length) { s.waste.push(s.stock.pop()); continue; }
      if (s.waste.length) { s.stock = s.waste.reverse(); s.waste = []; continue; }
      break;
    }
    const stagger = new Map();
    order.forEach((c, i) => stagger.set(c, i * 75));
    render({ stagger });
    later(() => { busy = false; if (K.won(g.s)) win(); else ctx.changed?.(); }, 450 + order.length * 75);
  }

  // ---------------------------------------------------------------- winning
  let cascade = null, pendingWin = null;
  function win() {
    if (over) return;
    over = true;
    clock.stop();
    g.ms = clock.ms;
    const secs = g.ms / 1000, bonus = secs > 30 ? Math.round(700000 / secs) : 0, score = liveScore(g) + bonus;
    stats();
    $('.sol-score').textContent = num(score);
    ctx.changed?.();
    const result = { won: true, score, ms: Math.round(g.ms), moves: g.moves };
    // the win counts even if the window closes during the cascade (unmount records it without the dialog)
    pendingWin = result;
    const done = () => { cascade?.stop(); cascade = null; if (dead || !pendingWin) return; pendingWin = null; ctx.finish(result); };
    if (reduceMotion()) return later(done, 500);
    cascade = runCascade(done);
  }
  /** The classic win: cards leap off the foundations, bounce along the bottom and leave a trail. Any click ends it. */
  function runCascade(done) {
    const cv = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.className = 'sol-cascade';
    cv.width = L.W * dpr;
    cv.height = L.H * dpr;
    table.appendChild(cv);
    const x2 = cv.getContext('2d');
    x2.scale(dpr, dpr);
    const imgs = new Map(), queue = [];
    for (let r = 13; r >= 1; r--) for (let j = 0; j < 4; j++) { const c = g.s.found[j][r - 1]; if (c != null) queue.push({ c, j }); }
    const load = (c) => { if (!imgs.has(c)) { const im = new Image(); im.src = cardImage(c, L.cw); imgs.set(c, im); } return imgs.get(c); };
    queue.forEach((q) => load(q.c));
    const flying = [];
    let raf = 0, frame = 0, stopped = false;
    const step = () => {
      if (stopped) return;
      frame++;
      if (frame % 9 === 1 && queue.length) {
        const q = queue.shift();
        cardEl[q.c].style.visibility = 'hidden';
        flying.push({ c: q.c, x: L.colX(3 + q.j), y: L.topY, vx: (Math.random() * 4.5 + 2) * (Math.random() < 0.5 ? -1 : 1) * (L.cw / 70), vy: -Math.random() * 5 * (L.cw / 70) });
      }
      for (const f of flying) {
        f.vy += 0.45 * (L.cw / 70); f.x += f.vx; f.y += f.vy;
        if (f.y + L.ch > L.H) { f.y = L.H - L.ch; f.vy = -f.vy * 0.78; }
        const im = imgs.get(f.c);
        if (im.complete) x2.drawImage(im, f.x, f.y, L.cw, L.ch);
      }
      for (let i = flying.length - 1; i >= 0; i--) if (flying[i].x < -L.cw || flying[i].x > L.W) flying.splice(i, 1);
      if (!queue.length && !flying.length) return finish();
      raf = requestAnimationFrame(step);
    };
    const finish = () => { if (stopped) return; stop(); done(); };
    const stop = () => { stopped = true; cancelAnimationFrame(raf); cv.remove(); table.removeEventListener('pointerdown', finish, true); cardEl.forEach((n) => { n.style.visibility = ''; }); };
    table.addEventListener('pointerdown', finish, true);
    raf = requestAnimationFrame(step);
    return { stop, finish };
  }

  // ---------------------------------------------------------------- hints and messages
  function hint() {
    if (!g || busy || over || paused) return;
    const list = K.hints(g.s);
    const k = snap();
    if (k !== lastHintKey) { hintIdx = 0; lastHintKey = k; }
    if (!list.length) { showMsg(t('games.sol.noMoves')); return; }
    const h = list[hintIdx++ % list.length];
    const glow = (n, ms = 1500) => { if (!n) return; n.classList.remove('hint'); void n.offsetWidth; n.classList.add('hint'); later(() => n.classList.remove('hint'), ms); };
    if (h.from === 'stock') { glow(g.s.stock.length ? cardEl[g.s.stock.at(-1)] : slotEl.stock); return; }
    const src = h.from === 'waste' ? [g.s.waste.at(-1)] : g.s.tab[h.col].u.slice(h.idx);
    src.forEach((c) => glow(cardEl[c]));
    const dest = h.to === 'found' ? (g.s.found[h.slot].length ? cardEl[g.s.found[h.slot].at(-1)] : slotEl.found[h.slot]) : g.s.tab[h.dest].u.length ? cardEl[g.s.tab[h.dest].u.at(-1)] : slotEl.tab[h.dest];
    later(() => glow(dest, 1200), 300);
  }
  function showMsg(text) { if (over) return; msg.querySelector('span').textContent = text; msg.hidden = false; msg.querySelector('.sol-msg-undo').hidden = !g?.hist.length; }
  function hideMsg() { msg.hidden = true; }

  // ---------------------------------------------------------------- pointer: drag a run, tap to move, tap the stock
  let press = null, lastTap = 0;
  const pt = (e) => { const r = table.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e) {
    if (e.button > 0 || !g || !L || over || busy || paused) return;
    const n = e.target.closest('.sol-card'), slot = e.target.closest('.sol-slot');
    if (!n && slot?.dataset.p === 'stock') { draw(); return; }
    if (!n) return;
    const c = +n.dataset.c, loc = where(c);
    if (!loc) return;
    if (loc.p === 'stock') { draw(); return; }
    if ((loc.p === 'tab' && !loc.up) || (loc.p !== 'tab' && !loc.top)) return;
    // the second click of a double-click lands on whatever the first one uncovered: let it go
    if (performance.now() - lastTap < 320) return;
    e.preventDefault();
    const run = runOf(loc), p0 = pt(e);
    press = { loc, run, n, x0: p0.x, y0: p0.y, id: e.pointerId, drag: false, base: run.map((x) => lastP.get(x)) };
    table.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!press || e.pointerId !== press.id) return;
    const p = pt(e), dx = p.x - press.x0, dy = p.y - press.y0;
    if (!press.drag) {
      if (Math.hypot(dx, dy) < 5) return;
      press.drag = true;
      hideMsg();
      press.run.forEach((c, i) => { const n = cardEl[c]; n.classList.add('drag'); n.style.transitionDelay = ''; n.style.zIndex = 3000 + i; });
    }
    press.dx = dx;
    press.dy = dy;
    press.run.forEach((c, i) => { const b = press.base[i]; cardEl[c].style.transform = `translate3d(${b.x + dx}px, ${b.y + dy}px, 0)`; });
  }
  function up(e) {
    if (!press || e.pointerId !== press.id) return;
    const pr = press;
    press = null;
    try { table.releasePointerCapture(e.pointerId); } catch {}
    if (!pr.drag) { if (tapMove(pr.loc, pr.n)) lastTap = performance.now(); return; }
    pr.run.forEach((c) => cardEl[c].classList.remove('drag'));
    const to = dropTarget(pr);
    if (!(to && play(pr.loc, to))) render();
  }
  /** The pile the dragged cards overlap most that accepts them. */
  function dropTarget(pr) {
    const b = pr.base[0], x = b.x + pr.dx, y = b.y + pr.dy, { cw, ch } = L;
    const overlap = (ax, ay, bh = ch) => Math.max(0, Math.min(x + cw, ax + cw) - Math.max(x, ax)) * Math.max(0, Math.min(y + ch, ay + bh) - Math.max(y, ay));
    let best = null, bestA = 0;
    const consider = (to, ax, ay, bh) => { const a = overlap(ax, ay, bh); if (a > bestA) { bestA = a; best = to; } };
    if (pr.run.length === 1) for (let j = 0; j < 4; j++) if (K.fitsFound(g.s, pr.run[0], j)) consider({ p: 'found', slot: j }, L.colX(3 + j), L.topY);
    for (let col = 0; col < 7; col++) {
      if ((pr.loc.p === 'tab' && pr.loc.col === col) || !K.fitsTab(g.s, pr.run[0], col)) continue;
      const tc = g.s.tab[col], last = tc.u.at(-1) ?? tc.d.at(-1), lp = last != null ? lastP.get(last) : null;
      consider({ p: 'tab', col }, L.colX(col), lp ? lp.y : L.tabY, ch);
    }
    return best;
  }
  table.addEventListener('pointerdown', down);
  table.addEventListener('pointermove', move);
  table.addEventListener('pointerup', up);
  table.addEventListener('pointercancel', (e) => { if (press?.id === e.pointerId) { press.run.forEach((c) => cardEl[c].classList.remove('drag')); press = null; render(); } });
  table.addEventListener('contextmenu', (e) => e.preventDefault());
  msg.querySelector('.sol-msg-undo').addEventListener('click', () => undo());
  $('.sol-hint').addEventListener('click', hint);

  // ---------------------------------------------------------------- options (the hub's ⋮ menu)
  async function pick(title, list, key) {
    const v = await choose(t(title), list.map(([value, label]) => ({ value, label: t(label) })), pref(key));
    if (v == null || dead) return;
    GC.setPref(ID, key, v);
    root.dataset[key] = v;
  }
  const menu = () => [
    { label: t('games.sol.restart'), icon: 'refresh', onClick: restart },
    { label: t('games.sol.auto'), icon: 'arrowUp', checked: !!pref('auto'), onClick: () => { GC.setPref(ID, 'auto', !pref('auto')); if (pref('auto') && g && !over && !busy) afterMove(); } },
    { label: t('games.sol.back'), icon: 'palette', onClick: () => pick('games.sol.back', BACKS, 'back') },
    { label: t('games.sol.felt'), icon: 'image', onClick: () => pick('games.sol.felt', FELTS, 'felt') },
  ];

  // ---------------------------------------------------------------- starting, undo, pause
  function restart() {
    if (!g || pendingWin) return;
    clearLater();
    cascade?.stop();
    cascade = null;
    over = false;
    busy = false;
    g = fresh(g.draw, g.seed, g.daily, g.proved);
    clock.reset();
    dealIn();
    ctx.changed?.();
    saveNow();
  }
  /** Deals with a flourish: every card flies from the stock to its column in dealing order. */
  function dealIn() {
    hideMsg();
    if (!layout()) return;
    const stagger = new Map();
    if (!reduceMotion()) {
      // start them all on the stock, face down
      lastP = new Map();
      for (let c = 0; c < 52; c++) { const n = cardEl[c]; n.style.transitionDelay = ''; n.classList.remove('up'); n.style.transform = `translate3d(${L.colX(0)}px, ${L.topY}px, 0) rotateY(180deg)`; }
      root.classList.add('instant');
      void root.offsetWidth;
      root.classList.remove('instant');
      let i = 0;
      for (let r = 0; r < 7; r++) for (let c = r; c < 7; c++) { const col = g.s.tab[c], card = r < c ? col.d[r] : col.u[0]; stagger.set(card, 60 + i++ * 26); }
      render({ stagger });
    } else render({ instant: true });
  }
  async function newGame(opts = {}) {
    if (pendingWin) { ctx.record(pendingWin); pendingWin = null; }
    clearLater();
    cascade?.stop();
    cascade = null;
    if (g && started() && !over) ctx.record({ won: false });
    over = false;
    busy = false;
    const level = opts.level || ctx.level || 'draw1', drawN = level === 'draw3' ? 3 : 1;
    const daily = opts.daily ?? ctx.daily;
    let seed = (opts.seed ?? (daily ? ctx.seed : null)) ?? newSeed(), proved = false;
    clock.reset();
    if (daily) {
      // the same proven deal for everyone today: try deals from today's seed until the solver wins one
      busy = true;
      g = null;
      root.classList.add('shuffling');
      const found = await findWinnable(seed, drawN);
      if (dead) return;
      root.classList.remove('shuffling');
      busy = false;
      seed = found.seed;
      proved = found.proved;
    }
    g = fresh(drawN, seed, daily, proved);
    dealIn();
    ctx.changed?.();
    saveNow();
  }
  async function findWinnable(seed, drawN) {
    for (let i = 0; i < 16; i++) {
      const sd = (seed + i * 7919) >>> 0;
      if (K.solve(K.deal(K.deck(sd), drawN), { maxNodes: 1500 }) === true) return { seed: sd, proved: true };
      await new Promise((r) => setTimeout(r, 0)); // a breath between tries keeps the window responsive
      if (dead) break;
    }
    return { seed: seed >>> 0, proved: false };
  }
  function undo() {
    if (!g || !g.hist.length || busy || over) return;
    clearLater();
    hideMsg();
    let h = null;
    try { h = unsnap(g.hist.pop()); } catch {}
    // a damaged step (an old or edited save) ends the history rather than the game
    if (!h || !validState(h.s)) { g.hist = []; ctx.changed?.(); return; }
    Object.assign(g, { s: h.s, score: h.score, moves: h.moves, passes: h.passes });
    render();
    ctx.changed?.();
    save();
  }
  const canUndo = () => !!(g && g.hist.length && !busy && !over);
  let paused = false;
  function pause(on) { paused = on; if (on) { clock.stop(); saveNow(); } else if (g && started() && !over && !document.hidden) clock.start(); }
  const onVis = () => { if (document.hidden) { clock.stop(); saveNow(); } else if (!paused && g && started() && !over) clock.start(); };
  document.addEventListener('visibilitychange', onVis);

  // keyboard: Space or D deals, H hints, 1–7 play the top of a column, 0 or W the waste
  function key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !g) return false;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'd') { draw(); return true; }
    if (k === 'h') { hint(); return true; }
    if (k === '0' || k === 'w') { if (g.s.waste.length) tapMove({ p: 'waste', idx: g.s.waste.length - 1, top: true }, cardEl[g.s.waste.at(-1)]); return true; }
    if (/^[1-7]$/.test(k) || /^Digit[1-7]$/.test(e.code)) {
      const col = (/^[1-7]$/.test(k) ? +k : +e.code.slice(5)) - 1, c = g.s.tab[col];
      if (!c.u.length) return true;
      // the deepest run that has somewhere to go uncovers the most; else the top card (to its foundation)
      for (let i = 0; i < c.u.length; i++) {
        const loc = { p: 'tab', col, idx: i, top: i === c.u.length - 1, up: true };
        if ([0, 1, 2, 3, 4, 5, 6].some((d) => d !== col && K.fitsTab(g.s, c.u[i], d) && !(i === 0 && !c.d.length && !g.s.tab[d].u.length))) { tapMove(loc, cardEl[c.u[i]]); return true; }
      }
      tapMove({ p: 'tab', col, idx: c.u.length - 1, top: true, up: true }, cardEl[c.u.at(-1)]);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- go
  const tick = setInterval(() => { if (clock.running) stats(); }, 1000);
  const ro = new ResizeObserver(() => { if (layout() && g) render({ instant: true }); });
  ro.observe(table);
  const saved = ctx.load?.();
  if (saved && saved.v === 1 && saved.s && validState(saved.s)) {
    g = { ...saved, hist: Array.isArray(saved.hist) ? saved.hist : [] };
    clock.reset(saved.ms || 0);
    if (layout()) render({ instant: true });
    if (K.won(g.s)) later(win, 200);
  } else newGame({});

  return {
    newGame, undo, canUndo, pause, key, menu,
    time: () => (g ? clock.ms : null),
    stats: () => { const m = GC.stats(ID).max?.score; return m ? [{ label: t('games.highScore'), value: num(m) }] : []; },
    unmount() {
      dead = true;
      saveNow(); clearLater(); cascade?.stop(); clearInterval(tick); clearTimeout(zTimer); ro.disconnect();
      if (pendingWin) { ctx.record(pendingWin); pendingWin = null; }
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

/** A card face as an image for the win cascade's canvas (the SVG with its colours written in). */
function cardImage(c, w) {
  const red = isRed(c), ink = red ? '#d62d2d' : '#1b1d29';
  const svg = faceSVG(c).replace('<svg class="cd-svg"', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(w * 1.4)}"`)
    .replace('>', `><style>text{font-family:Inter,'Noto Sans Arabic',system-ui,sans-serif;fill:${ink}}path,svg{fill:${ink}}.cd-rank{font-size:25px;font-weight:700;letter-spacing:-1px}.cd-rank.two{font-size:23px;letter-spacing:-2px}.cd-big{font:600 36px Georgia,'Times New Roman',serif}.cd-court{fill:${red ? '#fdecea' : '#eef0f4'};stroke:${ink};stroke-opacity:.35;stroke-width:1}.cd-emb{fill:${red ? '#e8a33d' : '#c9972f'}}</style><rect width="100" height="140" rx="9" fill="#fff" stroke="#c7c7cc" stroke-width="1"/>`);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export default {
  id: ID, name: 'games.solitaire', desc: 'games.sol.desc', rules: 'games.sol.rules', color: '#1f9a50', daily: true,
  levels: [{ id: 'draw1', name: 'games.lv.draw1' }, { id: 'draw3', name: 'games.lv.draw3' }],
  level: 'draw1', dailyLevel: 'draw1', lowerIsBetter: true,
  levelSub: (id) => t(id === 'draw3' ? 'games.sol.draw3sub' : 'games.sol.draw1sub'),
  info: (st) => (st && st.s ? { ms: st.ms || 0, score: liveScore(st), pct: onFound(st.s) / 52 } : {}),
  mount,
};
export { liveScore };

addStrings({
  en: {
    'games.sol.desc': 'Klondike, the classic card game.',
    'games.sol.rules': 'Build four piles on the foundations, one for each suit, from Ace up to King.\nOn the table, stack cards in descending order, alternating red and black. You can move a whole run at once, and only a King can go in an empty column.\nTap the stock to turn over cards (one or three at a time). Drag a card or just tap it to send it to the best place.\nKeys: Space or D to deal, 1–7 to play a column, W for the waste, H for a hint, Ctrl+Z to undo.',
    'games.sol.noMoves': 'No more moves',
    'games.sol.draw1sub': 'Turn over one card at a time',
    'games.sol.draw3sub': 'Turn over three cards at a time',
    'games.sol.restart': 'Restart this deal',
    'games.sol.auto': 'Move cards up automatically',
    'games.sol.back': 'Card back',
    'games.sol.felt': 'Table colour',
    'games.col.blue': 'Blue',
    'games.col.red': 'Red',
    'games.col.green': 'Green',
    'games.col.graphite': 'Graphite',
    'games.col.aurora': 'Aurora',
  },
  ar: {
    'games.sol.desc': 'كلوندايك، لعبة الورق الكلاسيكية.',
    'games.sol.rules': 'ابنِ أربع كومات على الأسس، واحدة لكل نوع، من الآص إلى الملك.\nعلى الطاولة، رتّب الأوراق تنازليًا مع تبديل الأحمر والأسود. يمكنك نقل سلسلة كاملة دفعة واحدة، ولا يوضع في العمود الفارغ إلا الملك.\nانقر على الرزمة لقلب الأوراق (ورقة أو ثلاث في كل مرة). اسحب الورقة أو انقر عليها لتذهب إلى أفضل مكان.\nالمفاتيح: Space أو D للتوزيع، و1–7 للعب عمود، وW لورقة الكومة، وH للتلميح، وCtrl+Z للتراجع.',
    'games.sol.noMoves': 'لا توجد نقلات أخرى',
    'games.sol.draw1sub': 'اقلب ورقة واحدة في كل مرة',
    'games.sol.draw3sub': 'اقلب ثلاث أوراق في كل مرة',
    'games.sol.restart': 'إعادة هذا التوزيع',
    'games.sol.auto': 'نقل الأوراق تلقائيًا إلى الأسس',
    'games.sol.back': 'ظهر الورقة',
    'games.sol.felt': 'لون الطاولة',
    'games.col.blue': 'أزرق',
    'games.col.red': 'أحمر',
    'games.col.green': 'أخضر',
    'games.col.graphite': 'جرافيت',
    'games.col.aurora': 'الشفق',
  },
});
