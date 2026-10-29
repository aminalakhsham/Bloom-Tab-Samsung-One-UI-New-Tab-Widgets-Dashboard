// Minesweeper for Gaming Hub: Beginner 9×9 with 10 mines, Intermediate 16×16 with 40, Expert 30×16 with 99. The first
// tap always opens an area; right-click, long-press or Flag mode places a flag; tapping an open number with enough flags
// around it opens its other neighbours (chording). The daily board (Intermediate) comes from the day's seed and opens at
// the same safe spot for everyone. The board scales to the window, and a wide board turns on its side in a tall window
// (a phone-size window), as phone Minesweeper games do. Keys: arrows, Space or Enter to open (or chord), F to flag,
// M to switch between Open and Flag.
import { $, $$, escapeHtml as esc } from '../core/util.js';
import { t, addStrings } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { LEVELS as L, layMines, counts, reveal, chord, isWon, dailyBoard } from './mines-core.js';
import { Clock, confetti, newSeed, num } from './kit.js';

const LEVELS = [{ id: 'beginner', name: 'games.lv.beginner' }, { id: 'intermediate', name: 'games.lv.intermediate' }, { id: 'expert', name: 'games.lv.expert' }];
const bits = (s) => [...s].map(Number);
const valid = (s) => s && s.v === 1 && L[s.level] && s.open?.length === s.w * s.h && s.flags?.length === s.w * s.h && (s.mines == null || s.mines.length === s.w * s.h);

function fresh(seed, level, daily) {
  const lv = L[level] ? level : 'beginner', { w, h, mines: n } = L[lv];
  const s = { v: 1, level: lv, w, h, n, seed: seed >>> 0, daily: !!daily, mines: null, open: '0'.repeat(w * h), flags: '0'.repeat(w * h), ms: 0, over: null, boom: -1, flagged: 0, cur: -1 };
  if (daily) {
    // everyone gets the same mines and starts from the same opening
    const d = dailyBoard(seed, lv);
    s.mines = d.mines.join('');
    const open = new Array(w * h).fill(0);
    reveal(w, h, d.mines, counts(w, h, d.mines), open, new Array(w * h).fill(0), d.start);
    s.open = open.join('');
    s.cur = d.start;
  }
  return s;
}

function mount(el, ctx) {
  let S = ctx.load();
  if (!valid(S)) S = fresh(ctx.seed, ctx.level || 'beginner', ctx.daily);
  let mines, cnt, open, flags, clock, mode = 'open', paused = false, turned = false;
  const unpack = () => {
    mines = S.mines ? bits(S.mines) : null;
    cnt = mines ? counts(S.w, S.h, mines) : null;
    open = bits(S.open); flags = bits(S.flags); clock = new Clock(S.ms);
  };
  unpack();

  el.innerHTML = `<div class="ms">
    <div class="ms-status">
      <span class="ms-count" title="${esc(t('games.ms.left'))}">${icon('gmFlag', 20)}<b></b></span>
      <div class="ou-seg ms-mode" role="radiogroup" aria-label="${esc(t('games.ms.mode'))}">
        <button class="ou-seg-btn" data-mode="open" role="radio" type="button">${icon('gmShovel', 18)}<span>${esc(t('games.ms.open'))}</span></button>
        <button class="ou-seg-btn" data-mode="flag" role="radio" type="button">${icon('gmFlag', 18)}<span>${esc(t('games.ms.flag'))}</span></button>
      </div>
    </div>
    <div class="ms-wrap"><div class="ms-board" role="grid" dir="ltr" aria-label="${esc(t('games.minesweeper'))}"></div></div></div>`;
  const root = $('.ms', el), boardEl = $('.ms-board', root), wrap = $('.ms-wrap', root);
  let cellEls = [];

  function build() {
    boardEl.innerHTML = Array.from({ length: S.w * S.h }, (_, i) => `<div class="ms-cell" role="gridcell" data-i="${i}"></div>`).join('');
    cellEls = $$('.ms-cell', boardEl);
    turned = null;
    fit(); draw();
  }

  // ---------------------------------------------------------------- layout: cells as large as the window allows
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  function fit() {
    const W = wrap.clientWidth - 16, H = wrap.clientHeight - 16;
    if (W <= 0 || H <= 0) return;
    const size = (w, h) => Math.max(12, Math.min(50, Math.floor(Math.min(W / w, H / h))));
    // a 30×16 board gets much bigger cells on its side in a tall window
    const turn = S.w !== S.h && size(S.h, S.w) > size(S.w, S.h) * 1.2;
    const cs = turn ? size(S.h, S.w) : size(S.w, S.h);
    if (turn !== turned) {
      turned = turn;
      boardEl.style.setProperty('--cols', turn ? S.h : S.w);
      // each cell keeps its index; turning the board only changes where it sits in the grid
      cellEls.forEach((c, i) => { const x = i % S.w, y = (i / S.w) | 0; c.style.gridArea = turn ? `${x + 1} / ${y + 1}` : `${y + 1} / ${x + 1}`; });
      root.classList.toggle('turned', turn);
    }
    boardEl.style.setProperty('--cs', cs + 'px');
  }

  // ---------------------------------------------------------------- drawing
  function drawCell(i) {
    const c = cellEls[i];
    if (!c) return;
    let cls = 'ms-cell', html = '';
    const lost = S.over === 'lost';
    if (open[i]) {
      cls += ' open';
      if (mines?.[i]) { cls += i === S.boom ? ' boom mine' : ' mine'; html = '<i class="ms-mine"></i>'; }
      else if (cnt[i]) { cls += ' n' + cnt[i]; html = String(cnt[i]); }
    } else if (flags[i]) {
      cls += ' flag';
      if (lost && mines && !mines[i]) cls += ' wrongflag';
      html = icon('gmFlagFill', 24);
    } else if (lost && mines?.[i]) { cls += ' open mine shown'; html = '<i class="ms-mine"></i>'; }
    else if (S.over === 'won' && mines?.[i]) { cls += ' flag'; html = icon('gmFlagFill', 24); }
    if (i === S.cur) cls += ' cur';
    if (((i % S.w) + ((i / S.w) | 0)) % 2) cls += ' alt';
    if (c.className !== cls) c.className = cls;
    if (c._h !== html) { c.innerHTML = html; c._h = html; }
  }
  function draw() {
    for (let i = 0; i < cellEls.length; i++) drawCell(i);
    const left = S.n - flags.reduce((a, b) => a + b, 0);
    $('.ms-count b', root).textContent = num(left);
    $$('.ms-mode button', root).forEach((b) => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-checked', b.dataset.mode === mode); });
  }
  const persist = () => { if (S.over) return; S.ms = Math.round(clock.ms); S.open = open.join(''); S.flags = flags.join(''); ctx.save(S); };

  // ---------------------------------------------------------------- moves
  function openCell(i) {
    if (S.over || paused || flags[i]) return;
    if (!mines) {
      // the first tap: mines are laid now, around it, so it always opens an area
      mines = layMines(S.w, S.h, S.n, S.seed, i); cnt = counts(S.w, S.h, mines); S.mines = mines.join('');
    }
    const opened = open[i] ? chord(S.w, S.h, mines, cnt, open, flags, i) : reveal(S.w, S.h, mines, cnt, open, flags, i);
    if (!opened.length) return;
    if (!clock.running) clock.start();
    const quick = ctx.reduceMotion?.();
    const hit = opened.find((j) => mines[j]);
    opened.forEach((j, k) => { drawCell(j); if (!quick && opened.length > 1 && k < 300) cellEls[j].animate([{ transform: 'scale(.6)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 220, delay: Math.min(k * 4, 260), easing: 'ease-out', fill: 'backwards' }); });
    if (hit != null) return lose(hit);
    if (isWon(mines, open)) return win();
    persist();
  }
  function toggleFlag(i) {
    if (S.over || paused || open[i]) return;
    flags[i] ^= 1;
    if (flags[i]) S.flagged = (S.flagged || 0) + 1;
    drawCell(i); draw();
    if (!ctx.reduceMotion?.()) cellEls[i].animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.34,1.6,.64,1)' });
    persist();
  }
  function act(i, flag = mode === 'flag') {
    S.cur = i;
    if (flag && !open[i]) toggleFlag(i); else openCell(i);
    draw();
  }

  function end(won) {
    clock.stop(); S.ms = Math.round(clock.ms);
    ctx.save(null);
    ctx.finish({ won, ms: S.ms, level: S.level, daily: S.daily, flags: S.flagged || 0, title: won ? t('games.ms.cleared') : t('games.gameOver'), delay: ctx.reduceMotion?.() ? 200 : won ? 1200 : 1500 });
  }
  function lose(i) {
    S.over = 'lost'; S.boom = i;
    root.classList.add('lost');
    draw();
    // the other mines show one after another, starting near the one that went off
    if (!ctx.reduceMotion?.()) {
      const x0 = i % S.w, y0 = (i / S.w) | 0;
      mines.forEach((m, j) => { if (m && j !== i && !flags[j]) cellEls[j].animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, delay: 120 + (Math.abs((j % S.w) - x0) + Math.abs(((j / S.w) | 0) - y0)) * 28, fill: 'backwards' }); });
      boardEl.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 320 });
    }
    end(false);
  }
  function win() {
    S.over = 'won';
    root.classList.add('won');
    draw();
    confetti(el);
    end(true);
  }

  // ---------------------------------------------------------------- pointer: tap, right-click, long-press, chord
  let press = null;
  boardEl.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.ms-cell');
    if (!c) return;
    const i = +c.dataset.i;
    press = { i, id: e.pointerId, long: false, btn: e.button, type: e.pointerType };
    root.classList.remove('kbd');
    c.classList.add('down');
    if (e.pointerType !== 'mouse' && !open[i]) press.timer = setTimeout(() => { if (press?.i === i) { press.long = true; c.classList.remove('down'); toggleFlag(i); } }, 420);
  });
  const release = () => { if (press) { clearTimeout(press.timer); cellEls[press.i]?.classList.remove('down'); } };
  boardEl.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    release();
    const p = press;
    press = null;
    const c = e.target.closest('.ms-cell');
    if (!c || +c.dataset.i !== p.i || p.long || p.btn === 2) return;
    if (p.btn === 1) { S.cur = p.i; openCell(p.i); draw(); return; } // a middle click chords
    act(p.i);
  });
  boardEl.addEventListener('pointerleave', () => { release(); press = null; });
  boardEl.addEventListener('pointercancel', () => { release(); press = null; });
  boardEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const c = e.target.closest('.ms-cell');
    if (!c || e.pointerType === 'touch' || (press && press.type !== 'mouse')) return;
    const i = +c.dataset.i;
    S.cur = i;
    if (open[i]) openCell(i); else toggleFlag(i);
    draw();
  });
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { mode = b.dataset.mode; draw(); } });

  function key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    root.classList.add('kbd');
    let mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mv) {
      // on a board turned on its side, the arrows still move the way they point on screen
      if (turned) mv = [mv[1], mv[0]];
      const i = S.cur < 0 ? Math.floor(S.h / 2) * S.w + Math.floor(S.w / 2) : S.cur;
      const x = ((i % S.w) + mv[0] + S.w) % S.w, y = (((i / S.w) | 0) + mv[1] + S.h) % S.h;
      S.cur = y * S.w + x;
      draw();
      return true;
    }
    if (S.cur < 0) return false;
    if (e.key === ' ' || e.key === 'Enter') { act(S.cur, false); return true; }
    if (e.code === 'KeyF') { if (open[S.cur]) openCell(S.cur); else toggleFlag(S.cur); draw(); return true; }
    if (e.code === 'KeyM') { mode = mode === 'flag' ? 'open' : 'flag'; draw(); return true; }
    return false;
  }

  function start() {
    root.classList.remove('won', 'lost');
    // a resumed game's clock goes on from the first move after opening it
    build();
  }
  start();
  const onHide = () => { if (document.hidden) { if (clock.running) { clock.stop(); S.resume = true; } persist(); } };
  document.addEventListener('visibilitychange', onHide);

  return {
    newGame({ level, seed, daily } = {}) {
      S = fresh(seed ?? newSeed(), level || S.level, daily);
      unpack();
      mode = 'open';
      ctx.save(S); start(); ctx.changed?.();
    },
    pause(on) {
      paused = on;
      if (on) { if (clock.running) { clock.stop(); S.resume = true; } persist(); }
      else if (S.resume && !S.over) { S.resume = false; clock.start(); }
    },
    time: () => clock.ms,
    key,
    unmount() { persist(); ro.disconnect(); document.removeEventListener('visibilitychange', onHide); },
  };
}

export default {
  id: 'minesweeper', name: 'games.minesweeper', desc: 'games.ms.desc', rules: 'games.ms.rules', color: '#2fb36b', daily: true,
  levels: LEVELS, level: 'beginner', dailyLevel: 'intermediate', lowerIsBetter: true,
  levelSub: (id) => (L[id] ? t('games.ms.size', { w: L[id].w, h: L[id].h, n: L[id].mines }) : ''),
  info: (s) => (valid(s) ? { ms: s.ms, pct: [...s.open].filter((c) => c === '1').length / (s.w * s.h - s.n) } : null),
  mount,
};

addStrings({
  en: {
    'games.ms.desc': 'Open every safe square without setting off a mine.',
    'games.ms.rules': 'Open every square that has no mine under it. Your first tap is always safe.\nA number tells you how many mines touch that square, including diagonally.\nRight-click, touch and hold, or use Flag mode to mark a mine. Tap a number that has all its flags to open the squares around it.\nKeys: arrow keys to move, Space or Enter to open, F to flag, M to switch between Open and Flag.',
    'games.ms.left': 'Mines left',
    'games.ms.mode': 'Tap mode',
    'games.ms.open': 'Open',
    'games.ms.flag': 'Flag',
    'games.ms.cleared': 'Board cleared',
    'games.ms.size': '{w} × {h}, {n} mines',
  },
  ar: {
    'games.ms.desc': 'افتح كل المربعات الآمنة دون تفجير أي لغم.',
    'games.ms.rules': 'افتح كل مربع لا يوجد تحته لغم. نقرتك الأولى آمنة دائمًا.\nيدلّك الرقم على عدد الألغام الملاصقة لهذا المربع، بما في ذلك القطرية.\nانقر بالزر الأيمن أو المس مطولًا أو استخدم وضع العلم لتعليم لغم. انقر على رقم اكتملت أعلامه لفتح المربعات المحيطة به.\nالمفاتيح: الأسهم للتنقل، وSpace أو Enter للفتح، وF للعلم، وM للتبديل بين الفتح والعلم.',
    'games.ms.left': 'الألغام المتبقية',
    'games.ms.mode': 'وضع النقر',
    'games.ms.open': 'فتح',
    'games.ms.flag': 'علَم',
    'games.ms.cleared': 'تم تنظيف اللوحة',
    'games.ms.size': '{w} × {h}، {n} لغمًا',
  },
});
