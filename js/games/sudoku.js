// Sudoku for Gaming Hub: four levels from a generator that always gives one solution, the daily puzzle (Medium), notes
// (pencil marks), highlights for the row, column, box and the same digit, mistakes in red, Undo, Erase, Hint, a timer
// that stops while the game is paused or hidden, and a number pad that counts what is left of each digit.
// Keys: 1–9 (Shift for a note), arrows, Backspace or 0 to erase, N for notes, H for a hint.
import { $, $$, escapeHtml as esc } from '../core/util.js';
import { t, addStrings } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { generate, logicSolve, PEERS, ROW, COL, BOX } from './sudoku-core.js';
import { Clock, confetti, newSeed, num } from './kit.js';

const LEVELS = [{ id: 'easy', name: 'games.lv.easy' }, { id: 'medium', name: 'games.lv.medium' }, { id: 'hard', name: 'games.lv.hard' }, { id: 'expert', name: 'games.lv.expert' }];
const valid = (s) => s && s.v === 1 && /^[0-9]{81}$/.test(s.puzzle) && /^[1-9]{81}$/.test(s.solution) && Array.isArray(s.cells) && s.cells.length === 81;
// the cell index inside the 3×3 boxes the board is drawn with
const AT = Array.from({ length: 81 }, (_, k) => { const b = (k / 9) | 0, j = k % 9; return (((b / 3) | 0) * 3 + ((j / 3) | 0)) * 9 + (b % 3) * 3 + (j % 3); });

function fresh(seed, level, daily) {
  const p = generate(seed >>> 0, level);
  return { v: 1, level, daily: !!daily, seed, puzzle: p.puzzle, solution: p.solution, cells: [...p.puzzle].map(Number), notes: new Array(81).fill(0), mistakes: 0, hints: 0, ms: 0, sel: -1, done: false };
}

function mount(el, ctx) {
  let S = ctx.load();
  // a new puzzle is saved right away, so leaving and coming back finds the same one
  if (!valid(S)) { S = fresh(ctx.seed, ctx.level || 'medium', ctx.daily); ctx.save(S); }
  let given = [...S.puzzle].map(Number), sol = [...S.solution].map(Number);
  let notesMode = false, undoStack = [], clock = new Clock(S.ms), paused = false;

  const tool = (act, ic, label) => `<button class="sd-tool" data-act="${act}" type="button"><span class="sd-tool-ic">${icon(ic, 24)}</span><span>${esc(label)}</span></button>`;
  el.innerHTML = `<div class="sd">
    <div class="sd-main">
      <div class="sd-col"><div class="sd-status"><span class="sd-mis"></span><span class="sd-hints"></span></div>
      <div class="sd-board" role="grid" dir="ltr" aria-label="${esc(t('games.sudoku'))}">${Array.from({ length: 9 }, (_, b) => `<div class="sd-box">${Array.from({ length: 9 }, (_, j) => { const i = AT[b * 9 + j]; return `<div class="sd-cell" role="gridcell" data-i="${i}"></div>`; }).join('')}</div>`).join('')}</div></div>
      <div class="sd-side">
        <div class="sd-tools">${tool('undo', 'gmUndo', t('common.undo'))}${tool('erase', 'gmEraser', t('games.sd.erase'))}${tool('notes', 'gmPencil', t('games.sd.notes'))}${tool('hint', 'gmBulb', t('games.hint'))}</div>
        <div class="sd-pad" dir="ltr">${Array.from({ length: 9 }, (_, k) => `<button class="sd-key" type="button" data-d="${k + 1}"><b>${k + 1}</b><small></small></button>`).join('')}</div>
      </div>
    </div></div>`;
  const root = $('.sd', el), board = $('.sd-board', root), cellEls = [];
  $$('.sd-cell', board).forEach((c) => { cellEls[+c.dataset.i] = c; });
  const notesBtn = $('[data-act="notes"]', root);
  notesBtn.querySelector('.sd-tool-ic').insertAdjacentHTML('beforeend', '<i class="sd-onoff"></i>');

  // ---------------------------------------------------------------- layout: the board takes the biggest square that fits
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  function fit() {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    // side by side when the window is wide (number pad as a 3×3 block), else the pad is one row under the board
    const wide = W > H * 1.18;
    root.classList.toggle('wide', wide);
    const size = wide ? Math.min(H - 70, (W - 80) / 1.62, 620) : Math.min(W - 32, (H - 210) / 1.1, 560);
    root.style.setProperty('--bs', Math.max(216, Math.floor(size / 9) * 9) + 'px');
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    const sel = S.sel, sv = sel >= 0 ? S.cells[sel] : 0;
    for (let i = 0; i < 81; i++) {
      const c = cellEls[i], v = S.cells[i];
      const peer = sel >= 0 && i !== sel && (ROW(i) === ROW(sel) || COL(i) === COL(sel) || BOX(i) === BOX(sel));
      c.className = 'sd-cell' + (given[i] ? ' given' : v ? ' user' : '') + (v && !given[i] && v !== sol[i] ? ' wrong' : '') + (i === sel ? ' sel' : '') + (peer ? ' peer' : '') + (sv && v === sv && i !== sel ? ' same' : '');
      if (v) { if (c.dataset.v !== String(v)) { c.textContent = v; c.dataset.v = v; } }
      else if (S.notes[i]) {
        const key = 'n' + S.notes[i] + '-' + sv;
        if (c.dataset.v !== key) {
          c.innerHTML = `<div class="sd-notes">${Array.from({ length: 9 }, (_, k) => `<i class="${S.notes[i] & (1 << (k + 1)) ? 'on' : ''} ${sv === k + 1 ? 'hi' : ''}">${S.notes[i] & (1 << (k + 1)) ? k + 1 : ''}</i>`).join('')}</div>`;
          c.dataset.v = key;
        }
      } else if (c.dataset.v) { c.textContent = ''; c.dataset.v = ''; }
      c.setAttribute('aria-selected', i === sel);
      c.setAttribute('aria-label', `${t('games.sd.cell', { r: ROW(i) + 1, c: COL(i) + 1 })}${v ? ', ' + v : ''}`);
    }
    const left = Array(10).fill(9);
    S.cells.forEach((v, i) => { if (v && v === sol[i]) left[v]--; });
    $$('.sd-key', root).forEach((b) => { const d = +b.dataset.d; b.querySelector('small').textContent = left[d] ? left[d] : ''; b.classList.toggle('used', !left[d]); b.classList.toggle('on', sv === d); });
    notesBtn.setAttribute('aria-pressed', notesMode);
    notesBtn.querySelector('.sd-onoff').textContent = notesMode ? t('common.on') : t('common.off');
    $('[data-act="undo"]', root).disabled = !undoStack.length || S.done;
    root.classList.toggle('notes-mode', notesMode);
    $('.sd-mis', root).innerHTML = `${icon('close', 16)}<span>${esc(t('games.sd.mistakes', { n: num(S.mistakes) }))}</span>`;
    $('.sd-hints', root).innerHTML = `${icon('gmBulb', 16)}<span>${esc(t('games.sd.hints', { n: num(S.hints) }))}</span>`;
  }

  // ---------------------------------------------------------------- moves
  const snapshot = () => ({ cells: S.cells.slice(), notes: S.notes.slice(), sel: S.sel });
  function commit(before) {
    undoStack.push(before);
    if (undoStack.length > 300) undoStack.shift();
    persist(); draw(); ctx.changed?.();
    if (S.cells.every((v, i) => v === sol[i])) win();
  }
  const persist = () => { S.ms = Math.round(clock.ms); if (!S.done) ctx.save(S); };
  const editable = (i) => i >= 0 && !given[i] && !S.done;
  function enter(d, asNote = notesMode) {
    const i = S.sel;
    if (!editable(i) || paused) return;
    if (!clock.running) clock.start();
    const before = snapshot();
    if (asNote) {
      if (S.cells[i]) return;
      S.notes[i] ^= 1 << d;
    } else {
      if (S.cells[i] === d) return;
      S.cells[i] = d; S.notes[i] = 0;
      if (d !== sol[i]) {
        S.mistakes++;
        if (!ctx.reduceMotion?.()) cellEls[i].animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      } else for (const p of PEERS[i]) S.notes[p] &= ~(1 << d); // a placed digit clears itself from the notes around it
    }
    commit(before);
  }
  function erase() {
    const i = S.sel;
    if (!editable(i) || (!S.cells[i] && !S.notes[i]) || paused) return;
    const before = snapshot();
    S.cells[i] = 0; S.notes[i] = 0;
    commit(before);
  }
  function undo() {
    const b = undoStack.pop();
    if (!b || S.done) return;
    S.cells = b.cells; S.notes = b.notes; S.sel = b.sel;
    persist(); draw(); ctx.changed?.();
  }
  /** Fills the selected cell, or else the cell a person would find next (the first step of the logical solver). */
  function hint() {
    if (S.done || paused) return;
    let i = S.sel;
    if (!editable(i) || S.cells[i] === sol[i]) {
      const known = S.cells.map((v, k) => (v === sol[k] ? v : 0));
      const step = logicSolve(known, 2).steps[0];
      i = step ? step.i : S.cells.findIndex((v, k) => v !== sol[k]);
    }
    if (i < 0) return;
    if (!clock.running) clock.start();
    const before = snapshot();
    S.sel = i; S.cells[i] = sol[i]; S.notes[i] = 0; S.hints++;
    for (const p of PEERS[i]) S.notes[p] &= ~(1 << sol[i]);
    if (!ctx.reduceMotion?.()) cellEls[i].animate?.([{ background: 'rgba(255, 196, 0, .55)' }, { background: 'transparent' }], { duration: 900 });
    commit(before);
  }
  function select(i) { S.sel = i; draw(); }
  function move(dx, dy) {
    const i = S.sel < 0 ? 40 : S.sel;
    const r = (ROW(i) + dy + 9) % 9, c = (COL(i) + dx + 9) % 9;
    select(r * 9 + c);
  }

  function win() {
    S.done = true; clock.stop();
    ctx.save(null);
    undoStack = []; ctx.changed?.();
    root.classList.add('won');
    // the board lights up in a wave from the last cell, then confetti and the result
    const from = S.sel >= 0 ? S.sel : 40;
    if (!ctx.reduceMotion?.()) cellEls.forEach((c, i) => {
      const d = Math.abs(ROW(i) - ROW(from)) + Math.abs(COL(i) - COL(from));
      c.animate([{ transform: 'scale(1)' }, { transform: 'scale(.86)', background: 'rgba(var(--accent-rgb), .35)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 520, delay: d * 45, easing: 'ease-out' });
    });
    setTimeout(() => confetti(el), ctx.reduceMotion?.() ? 0 : 500);
    draw();
    ctx.finish({ won: true, ms: Math.round(clock.ms), level: S.level, daily: S.daily, mistakes: S.mistakes, hints: S.hints, title: t('games.puzzleSolved'), delay: ctx.reduceMotion?.() ? 200 : 1300 });
  }

  // ---------------------------------------------------------------- input
  board.addEventListener('pointerdown', (e) => { const c = e.target.closest('.sd-cell'); if (c) { root.classList.remove('kbd'); select(+c.dataset.i); } });
  root.addEventListener('click', (e) => {
    const k = e.target.closest('.sd-key');
    if (k) { enter(+k.dataset.d); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'erase') erase();
    else if (a === 'undo') undo();
    else if (a === 'notes') { notesMode = !notesMode; draw(); }
    else if (a === 'hint') hint();
  });
  function key(e) {
    if (S.done || e.metaKey || e.ctrlKey || e.altKey) return false;
    root.classList.add('kbd');
    const d = /^Digit([1-9])$|^Numpad([1-9])$/.exec(e.code);
    if (d) { enter(+(d[1] || d[2]), notesMode !== e.shiftKey); return true; }
    switch (e.key) {
      case 'ArrowLeft': move(-1, 0); return true;
      case 'ArrowRight': move(1, 0); return true;
      case 'ArrowUp': move(0, -1); return true;
      case 'ArrowDown': move(0, 1); return true;
      case 'Backspace': case 'Delete': case '0': erase(); return true;
    }
    if (e.code === 'KeyN') { notesMode = !notesMode; draw(); return true; }
    if (e.code === 'KeyH') { hint(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- run
  function start() { if (!S.done && !paused && !document.hidden) clock.start(); draw(); fit(); }
  start();
  const onHide = () => { if (document.hidden) { clock.stop(); persist(); } else if (!paused && !S.done) clock.start(); };
  document.addEventListener('visibilitychange', onHide);

  return {
    newGame({ level, seed, daily } = {}) {
      S = fresh(seed ?? newSeed(), level || S.level, daily);
      given = [...S.puzzle].map(Number); sol = [...S.solution].map(Number);
      undoStack = []; notesMode = false; clock = new Clock(0);
      root.classList.remove('won');
      $$('.sd-cell', board).forEach((c) => { c.dataset.v = ''; });
      ctx.save(S); start(); ctx.changed?.();
    },
    undo, canUndo: () => !!undoStack.length && !S.done,
    pause(on) { paused = on; if (on) { clock.stop(); persist(); } else if (!S.done) clock.start(); },
    time: () => clock.ms,
    key,
    unmount() { if (!S.done) persist(); ro.disconnect(); document.removeEventListener('visibilitychange', onHide); },
  };
}

const pct = (s) => { const open = [...s.puzzle].filter((c) => c === '0').length; const right = s.cells.filter((v, i) => v && s.puzzle[i] === '0' && String(v) === s.solution[i]).length; return open ? right / open : 0; };

export default {
  id: 'sudoku', name: 'games.sudoku', desc: 'games.sd.desc', rules: 'games.sd.rules', color: '#3e7bff', daily: true,
  levels: LEVELS, level: 'medium', dailyLevel: 'medium', lowerIsBetter: true, undoInGame: true,
  info: (s) => (valid(s) ? { ms: s.ms, pct: pct(s) } : null),
  mount,
};

addStrings({
  en: {
    'games.sd.desc': 'Fill the grid so every row, column and box has 1 to 9.',
    'games.sd.rules': 'Fill every empty square with a number from 1 to 9.\nEach row, each column and each 3 × 3 box must hold every number exactly once.\nTurn on Notes to pencil in the numbers a square could be. A wrong number shows in red and counts as a mistake. Hint fills in a square for you.\nKeys: 1–9 to fill in (Shift+number for a note), arrow keys to move, Backspace to erase, N for Notes, H for a hint, Ctrl+Z to undo, P to pause.',
    'games.sd.erase': 'Erase',
    'games.sd.notes': 'Notes',
    'games.sd.mistakes': 'Mistakes: {n}',
    'games.sd.hints': 'Hints: {n}',
    'games.sd.cell': 'Row {r}, column {c}',
  },
  ar: {
    'games.sd.desc': 'املأ الشبكة بحيث يحتوي كل صف وعمود ومربع على الأرقام من 1 إلى 9.',
    'games.sd.rules': 'املأ كل مربع فارغ برقم من 1 إلى 9.\nيجب أن يحتوي كل صف وكل عمود وكل مربع 3 × 3 على كل رقم مرة واحدة فقط.\nشغّل الملاحظات لتدوين الأرقام المحتملة في المربع. يظهر الرقم الخاطئ باللون الأحمر ويُحتسب خطأً. يملأ التلميح مربعًا نيابةً عنك.\nالمفاتيح: 1–9 للإدخال (Shift+رقم للملاحظة)، والأسهم للتنقل، وBackspace للمسح، وN للملاحظات، وH للتلميح، وCtrl+Z للتراجع، وP للإيقاف المؤقت.',
    'games.sd.erase': 'مسح',
    'games.sd.notes': 'ملاحظات',
    'games.sd.mistakes': 'الأخطاء: {n}',
    'games.sd.hints': 'التلميحات: {n}',
    'games.sd.cell': 'الصف {r}، العمود {c}',
  },
});
