// 2048 for Gaming Hub: slide with the arrow keys, WASD or a swipe; tiles glide and merge (instantly with Reduce motion),
// score and best, one step of Undo, a "You win!" dialog at 2048 with Keep playing, and Game over when no move is left.
// A milestone (512 and up, or a new best score) is reported with ctx.progress() so challenges and achievements count
// while the game goes on; the finished game is recorded once, when it ends.
import { $, escapeHtml as esc } from '../core/util.js';
import { t, addStrings } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import { empty, spawn, slide, canMove, maxTile } from './g2048-core.js';
import { swipe, confetti, num } from './kit.js';
import { tileColors } from './art.js';
import * as GC from './center.js';

const valid = (s) => s && s.v === 1 && Array.isArray(s.b?.tiles) && s.b.n === 4;
const fresh = () => { const b = empty(4); spawn(b); spawn(b); return { v: 1, b, won: false, keep: false, over: false, prev: null, top: maxTile(b) }; };

function mount(el, ctx) {
  let S = ctx.load();
  if (!valid(S)) S = fresh();
  let busy = 0, winOpen = false, paused = false;
  el.innerHTML = `<div class="tz">
    <div class="tz-head">
      <div class="tz-score"><span>${esc(t('games.score'))}</span><b data-k="score"></b></div>
      <div class="tz-score"><span>${esc(t('games.best'))}</span><b data-k="best"></b></div>
    </div>
    <div class="tz-board" dir="ltr" role="application" aria-label="${esc(t('games.tz.board'))}" tabindex="0"><div class="tz-grid">${'<i></i>'.repeat(16)}</div><div class="tz-tiles"></div></div>
    <p class="tz-tip">${esc(t('games.tz.tip'))}</p></div>`;
  const root = $('.tz', el), board = $('.tz-board', root), layer = $('.tz-tiles', root);
  const nodes = new Map(); // tile id → element
  const best = () => Math.max(GC.stats('g2048').best?.default || 0, S.b.score);

  // ---------------------------------------------------------------- layout
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  function fit() {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    root.style.setProperty('--bs', Math.max(240, Math.min(W - 40, H - 170, 560)) + 'px');
  }

  // ---------------------------------------------------------------- drawing
  const place = (n, t2) => { n.style.setProperty('--x', t2.x); n.style.setProperty('--y', t2.y); };
  function tileEl(t2, cls = '') {
    const [bg, fg] = tileColors(t2.v), n = document.createElement('div');
    n.className = `tz-tile ${cls} ${t2.v >= 1024 ? 'd4' : t2.v >= 128 ? 'd3' : ''} ${t2.v >= 2048 ? 'glow' : ''}`;
    n.style.setProperty('--bg', bg);
    n.style.setProperty('--fg', fg);
    n.textContent = t2.v;
    place(n, t2);
    layer.appendChild(n);
    return n;
  }
  /** Draws the board from scratch (open, resume, undo). */
  function drawAll() {
    layer.innerHTML = '';
    nodes.clear();
    for (const t2 of S.b.tiles) nodes.set(t2.id, tileEl(t2));
    head();
  }
  function head() {
    $('[data-k="score"]', root).textContent = num(S.b.score);
    $('[data-k="best"]', root).textContent = num(best());
  }

  // ---------------------------------------------------------------- moves
  function go(dir) {
    if (S.over || paused || winOpen || busy) return;
    const res = slide(S.b, dir);
    if (!res.moved) {
      if (!ctx.reduceMotion?.()) board.animate?.([{ transform: 'none' }, { transform: `translate(${dir === 'left' ? -5 : dir === 'right' ? 5 : 0}px, ${dir === 'up' ? -5 : dir === 'down' ? 5 : 0}px)` }, { transform: 'none' }], { duration: 160 });
      return;
    }
    S.prev = { b: S.b, top: S.top, won: S.won };
    S.b = res.state;
    const added = spawn(S.b);
    const quick = ctx.reduceMotion?.();
    // tiles that stay slide to their new cells; the two halves of a merge slide into the meeting cell and vanish
    for (const t2 of res.state.tiles) { const n = nodes.get(t2.id); if (n) place(n, t2); }
    for (const g of res.gone) { const n = nodes.get(g.id); if (n) { place(n, g); n.classList.add('gone'); nodes.delete(g.id); setTimeout(() => n.remove(), quick ? 0 : 110); } }
    busy++;
    const after = () => {
      busy--;
      for (const id of res.merged) { const t2 = S.b.tiles.find((x) => x.id === id); if (t2 && !nodes.has(id)) nodes.set(id, tileEl(t2, quick ? '' : 'merged')); }
      if (added && !nodes.has(added.id)) nodes.set(added.id, tileEl(added, quick ? '' : 'new'));
    };
    if (quick) after(); else setTimeout(after, 110);
    if (res.gained && !quick) { const pop = document.createElement('b'); pop.className = 'tz-plus'; pop.textContent = '+' + num(res.gained); $('.tz-score', root).appendChild(pop); setTimeout(() => pop.remove(), 700); }
    head();
    const top = maxTile(S.b);
    if (top > S.top) { S.top = top; if (top >= 512) report(); }
    ctx.changed?.();
    if (top >= 2048 && !S.won) {
      S.won = true;
      ctx.save(S);
      setTimeout(() => winDialog(), quick ? 50 : 350);
      return;
    }
    if (!canMove(S.b)) { S.over = true; ctx.save(null); over(quick ? 50 : 450); return; }
    ctx.save(S);
  }
  const report = () => ctx.progress?.({ tile: S.top, score: S.b.score });
  function undo() {
    if (!S.prev || S.over || busy) return;
    S.b = S.prev.b; S.top = S.prev.top; S.won = S.prev.won; S.prev = null;
    drawAll(); ctx.save(S); ctx.changed?.();
  }

  async function winDialog() {
    confetti(el);
    winOpen = true;
    const content = document.createElement('div');
    content.className = 'gm-result';
    content.innerHTML = `<div class="tz-win">2048</div><p class="gm-result-sub">${esc(t('games.tz.won'))}</p>
      <div class="gm-result-stats"><div><span>${esc(t('games.score'))}</span><b>${num(S.b.score)}</b></div><div><span>${esc(t('games.best'))}</span><b>${num(best())}</b></div></div>`;
    const v = await dialog({ title: t('games.youWin'), content, className: 'gm-dialog', actions: [{ label: t('games.newGame'), value: 'new' }, { label: t('games.tz.keep'), value: 'keep', primary: true }] });
    winOpen = false;
    if (v === 'new') finish(true);
  }
  /** The game is over (or abandoned for a new one): it counts once in the stats, won when it reached 2048. */
  function finish(startNew) {
    if (!S.counted) { S.counted = true; ctx.record({ won: S.won, score: S.b.score, tile: maxTile(S.b) }); }
    if (startNew) newGame();
  }
  function over(delay) {
    report();
    S.counted = true;
    ctx.finish({ won: S.won, score: S.b.score, tile: maxTile(S.b), title: t('games.gameOver'), delay });
  }
  function newGame() {
    // a game left after reaching 2048 counts as a win; one left earlier still counts its score toward Best
    if (S.won && !S.counted) { S.counted = true; ctx.record({ won: true, score: S.b.score, tile: maxTile(S.b) }); }
    else if (!S.over && S.b.score) ctx.progress?.({ score: S.b.score, tile: maxTile(S.b) });
    S = fresh();
    ctx.save(S); drawAll(); ctx.changed?.();
  }

  // ---------------------------------------------------------------- input
  const offSwipe = swipe(board, (dir) => go(dir));
  board.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  function key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' }[e.code];
    if (!dir) return false;
    go(dir);
    return true;
  }

  drawAll(); fit();
  return {
    newGame: () => newGame(),
    undo, canUndo: () => !!S.prev && !S.over,
    pause(on) { paused = on; },
    key,
    stats: () => { const s = GC.stats('g2048'); return [{ label: t('games.tz.highest'), value: String(s.max?.tile || 0) }]; },
    unmount() { ro.disconnect(); offSwipe(); },
  };
}

export default {
  id: 'g2048', name: 'games.g2048', desc: 'games.tz.desc', rules: 'games.tz.rules', color: '#ff9f1c', daily: false,
  info: (s) => (valid(s) ? { score: s.b.score, pct: Math.min(1, Math.log2(maxTile(s.b) || 2) / 11) } : null),
  mount,
};

addStrings({
  en: {
    'games.tz.desc': 'Slide and join matching tiles to reach 2048.',
    'games.tz.rules': 'Swipe or use the arrow keys to slide every tile on the board.\nWhen two tiles with the same number touch, they join into one with twice the value and add it to your score.\nA new tile appears after each move. Make the 2048 tile to win, then keep going if you like. The game ends when no move is left.\nKeys: arrow keys or W A S D to slide, Ctrl+Z to undo one move.',
    'games.tz.board': '2048 board. Use the arrow keys to move the tiles.',
    'games.tz.tip': 'Join the numbers to get to the 2048 tile!',
    'games.tz.won': 'You made the 2048 tile! Keep playing to go even higher.',
    'games.tz.keep': 'Keep playing',
    'games.tz.highest': 'Highest tile',
  },
  ar: {
    'games.tz.desc': 'حرّك المربعات المتشابهة وادمجها للوصول إلى 2048.',
    'games.tz.rules': 'اسحب أو استخدم مفاتيح الأسهم لتحريك كل المربعات على اللوحة.\nعندما يتلامس مربعان بالرقم نفسه يندمجان في مربع واحد بضعف القيمة وتُضاف إلى نقاطك.\nيظهر مربع جديد بعد كل حركة. اصنع مربع 2048 لتفوز، ثم تابع إن شئت. تنتهي اللعبة عندما لا تبقى أي حركة.\nالمفاتيح: الأسهم أو W A S D للتحريك، وCtrl+Z للتراجع عن حركة واحدة.',
    'games.tz.board': 'لوحة 2048. استخدم مفاتيح الأسهم لتحريك المربعات.',
    'games.tz.tip': 'اجمع الأرقام للوصول إلى مربع 2048!',
    'games.tz.won': 'صنعت مربع 2048! واصل اللعب لتصل إلى أعلى.',
    'games.tz.keep': 'واصل اللعب',
    'games.tz.highest': 'أعلى مربع',
  },
});
