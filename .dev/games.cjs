// triple
// Gaming Hub end-to-end: the hub (Home hero, Instant plays, challenges, Library filters, Profile, Achievements), Sudoku
// (moves, mistakes, notes, Undo, Hint, pause, a win, the daily puzzle and its streak, Difficulty, How to play,
// Statistics), 2048 (moves, the 2048 tile, Keep playing, Game over), Minesweeper (safe first tap, flags, levels, a win,
// a loss, the daily board, Expert on its side in a phone window), Solitaire (drag, tap, Undo, Ctrl+Z, stock, hint,
// options, a win, the proven Daily deal), Chess (two players, the computer in its Worker, resign, the daily mate in
// two), widgets, Finder commands, the Lock screen chip, play time, phone-size and maximised windows, and RTL boards.
// usage: .dev/run.sh .dev/games.cjs        (THEME=dark, UI=ar)
module.exports = async ({ page, boot, ok, openApp, closeApp, click: rawClick, count, exists, text, mod, store, sleep, shot, P, ui }) => {
  // the hub redraws when the games key changes (a save, play time), so a click retries if its node was just replaced
  const click = async (sel) => { for (let k = 0; ; k++) { try { await sleep(120); await rawClick(sel); return; } catch (e) { if (k > 2) throw e; await sleep(250); } } };
  const AR = ui === 'ar';
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fnv = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const T = '.app-stack > .app-page:last-child ';
  const G = async () => (await store('games')) || {};
  const key = async (k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of [...mods].reverse()) await page.keyboard.up(m); await sleep(150); };
  const back = async () => { await page.evaluate(() => document.querySelector('.app-stack > .app-page:last-child .app-back')?.click()); await sleep(500); };
  const tab = async (id) => { while (await exists('.app-stack > .app-page:last-child .app-back')) await back(); await click(`.gm-tabs [data-tab="${id}"]`); await sleep(300); };
  const menuPick = async (re) => {
    await click(T + '.gm-gmore');
    await sleep(250);
    const done = await page.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('.ou-menu-item')].find((n) => r.test(n.textContent)); b?.click(); return !!b; }, re.source);
    await sleep(400);
    return done;
  };
  const dlg = () => exists('.ou-dialog-scrim.show');
  const dlgBtn = async (which = 'primary') => {
    await page.evaluate((w) => { const d = [...document.querySelectorAll('.ou-dialog-scrim.show')].pop(); (w === 'primary' ? d?.querySelector('.ou-dialog-btn.primary') : w === 'danger' ? d?.querySelector('.ou-dialog-btn.danger') : d?.querySelector('.ou-dialog-btn'))?.click(); }, which);
    await sleep(450);
  };
  const pickRadio = async (re) => { await page.evaluate((src) => [...document.querySelectorAll('.ou-radio-row')].find((n) => new RegExp(src).test(n.textContent))?.click(), re.source); await sleep(150); await dlgBtn(); };
  const save = (k, s, meta = {}) => mod('./js/games/center.js', 'save', k, s, meta);
  const inside = (sel) => page.evaluate((s) => { const w = document.querySelector('.app-win').getBoundingClientRect(); const els = [...document.querySelectorAll(s)]; return els.length > 0 && els.every((n) => { const r = n.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1 && r.top >= w.top - 1 && r.bottom <= w.bottom + 1; }); }, sel);

  // two days of daily puzzles already solved, so today's makes a three-day streak
  await boot({ data: { games: { stats: {}, daily: { sudoku: { [dk(-2)]: { won: true, ms: 400000 }, [dk(-1)]: { won: true, ms: 380000 } } }, saves: {}, ach: {}, prefs: { chess: { sound: false } } } } });

  // ---------------------------------------------------------------- the hub
  await openApp('games'); await sleep(900);
  ok(await exists('.gm-tabs .ou-tab[data-tab="home"].active'), 'Gaming Hub opens on Home with the bottom navigation');
  ok(await count('.gm-hero .gm-daily') === 4, 'the hero lists the four daily puzzles');
  ok(/2/.test(await text('.gm-hero-streak b')), 'the streak counts the last two days (' + await text('.gm-hero-streak b') + ')');
  ok(await count('.gm-hero .gm-week > span') === 7 && await count('.gm-week .won') === 2, 'the week row shows two solved days');
  ok(await count('.gm-instant .gm-card .gm-art > svg') === 5, 'Instant plays shows five game cards with artwork');
  ok(await count('.gm-chals .gm-chal') === 3, 'three daily challenges');
  ok(await exists('.gm-hero-btn[data-play="sudoku"][data-daily]'), 'the hero button plays the first unsolved puzzle');
  await shot(P + 'games-home');
  await page.evaluate(() => { document.querySelector('.app-scroll').scrollTop = 520; }); await sleep(300);
  await shot(P + 'games-home-rows');
  await click('.gm-link[data-go="library"]');
  ok(await exists('.gm-tabs .ou-tab[data-tab="library"].active') && await count('.gm-lib .gm-tile') === 5, 'See all opens the Library with all five games');
  await click('.gm-cats [data-cat="cards"]');
  ok(await count('.gm-lib .gm-tile') === 1 && await exists('.gm-tile[data-play="solitaire"]'), 'the Card filter shows Solitaire only');
  await click('.gm-cats [data-cat="all"]');
  await shot(P + 'games-library');
  await click('.gm-tile[data-play="chess"] .gm-tile-more'); await sleep(250);
  ok(await count('.ou-menu-item') >= 4, 'a Library card has a ⋮ menu (play, daily, how to play, statistics)');
  await key('Escape'); await sleep(250);
  await tab('profile');
  ok(await count('.gm-tiles .gm-stat') === 6 && await exists('.gm-prof .gm-lvl') && await exists('.gm-time .gm-chart'), 'Profile shows the level, six stat tiles and the play time chart');
  await shot(P + 'games-profile');
  await click('.gm-achcard'); await sleep(500);
  ok(await count(T + '.gm-ach') >= 25, `Achievements lists ${await count(T + '.gm-ach')} medals`);
  await shot(P + 'games-achievements');
  await back();

  // ---------------------------------------------------------------- Sudoku
  await tab('library');
  await click('.gm-tile[data-play="sudoku"] .gm-tile-play'); await sleep(700);
  ok(await count(T + '.sd-cell') === 81, 'Sudoku opens as a sub-page with 81 cells');
  ok(/Medium|متوسط/.test(await text(T + '.gm-gsub')), 'the title bar names the level (Medium)');
  ok(await exists(T + '.gm-timer') && await exists(T + '.app-back'), 'the top bar has Back and the timer chip');
  const sd = async () => (await G()).saves?.sudoku?.s;
  const empty = await page.evaluate(() => [...document.querySelectorAll('.sd-cell')].find((c) => !c.classList.contains('given') && !c.textContent.trim())?.dataset.i);
  await click(`.sd-cell[data-i="${empty}"]`);
  ok(await exists(`.sd-cell[data-i="${empty}"].sel`) && await count('.sd-cell.peer') === 20, 'tapping a cell selects it and lights its row, column and box');
  let s = await sd();
  ok(await page.evaluate((p) => import('./js/games/sudoku-core.js').then((m) => m.solve([...p].map(Number), 2).count), s.puzzle) === 1, 'the puzzle has exactly one solution');
  const right = +s.solution[empty], wrong = (right % 9) + 1;
  await key(String(wrong));
  ok(await exists(`.sd-cell[data-i="${empty}"].wrong`) && /1/.test(await text('.sd-mis')), 'a wrong number shows in red and counts as a mistake');
  await key('KeyZ', ['Control']);
  ok(!(await text(`.sd-cell[data-i="${empty}"]`)), 'Ctrl+Z undoes it');
  await key('KeyN'); await key('3'); await key('7');
  ok(await count(`.sd-cell[data-i="${empty}"] .sd-notes i.on`) === 2, 'Notes mode pencils in two numbers');
  await key('KeyN');
  await key(String(right));
  ok((await sd()).cells[empty] === right, 'the right number is placed and saved');
  await key('ArrowRight'); await key('ArrowDown');
  ok(+(await page.evaluate(() => document.querySelector('.sd-cell.sel')?.dataset.i)) === ((Math.floor(empty / 9) + 1) % 9) * 9 + ((empty % 9) + 1) % 9, 'arrow keys move the selection');
  const filled = (await sd()).cells.filter(Boolean).length;
  await click(T + '.sd-tool[data-act="hint"]');
  ok((await sd()).cells.filter(Boolean).length === filled + 1 && (await sd()).hints === 1, 'Hint fills in a square');
  await click(T + '.gm-timer');
  ok(await exists(T + '.gm-pause:not([hidden])') && await page.evaluate(() => getComputedStyle(document.querySelector('.app-stack > .app-page:last-child .gm-host')).visibility === 'hidden'), 'the timer chip pauses and covers the board');
  await shot(P + 'games-sudoku-paused');
  await key('KeyP');
  ok(await exists(T + '.gm-pause[hidden]'), 'P resumes');
  await sleep(300);
  await shot(P + 'games-sudoku');
  // How to play, Statistics and Difficulty from the ⋮ menu
  ok(await menuPick(/How to play|طريقة اللعب/) && await count('.gm-rules p') >= 3, 'How to play opens the rules dialog');
  await shot(P + 'games-rules');
  await dlgBtn();
  ok(await menuPick(/Statistics|الإحصاءات/) && await count(T + '.gm-statlist .ou-row') >= 7 && await exists(T + '.ou-seg'), 'Statistics opens as a sub-page with a level picker');
  await shot(P + 'games-stats');
  await back();
  ok(await count(T + '.sd-cell') === 81, 'Back returns to the game');
  // a win from a board one number short
  s = await sd();
  const last = [...s.puzzle].findIndex((c, i) => c === '0' && s.cells[i] !== +s.solution[i]);
  await back();
  await page.evaluate((last) => import('./js/games/center.js').then((GC) => { const w = GC.saved('sudoku'); const st = w.s; st.cells = [...st.solution].map(Number); st.cells[last] = 0; st.notes = new Array(81).fill(0); st.sel = last; st.mistakes = 0; st.hints = 0; GC.save('sudoku', st, { level: w.level, info: { ms: 1000, pct: 0.9 } }); }), last);
  await click('.gm-tile[data-play="sudoku"] .gm-tile-play'); await sleep(600);
  await key(String(s.solution[last])); await sleep(900);
  ok(await exists('.gm-dialog .gm-result.won'), 'solving shows the One UI result dialog');
  ok(await exists('.gm-banner'), 'the achievement banner drops in');
  await shot(P + 'games-sudoku-won');
  let g = await G();
  ok(g.stats?.sudoku?.won === 1 && g.stats.sudoku.best?.medium > 0, 'the win and best time are recorded');
  ok(!!g.ach?.['first-win'], 'First victory is unlocked');
  ok(!g.saves?.sudoku, 'the finished game is no longer saved');
  await dlgBtn('first');
  // Difficulty → Hard starts a new puzzle
  ok(await menuPick(/Difficulty|الصعوبة/) && await count('.ou-radio-row') === 4, 'Difficulty offers the four levels');
  await pickRadio(/Hard|صعب/);
  if (await dlg()) await dlgBtn();
  ok(/Hard|صعب/.test(await text(T + '.gm-gsub')) && (await G()).prefs?.sudoku?.level === 'hard', 'a Hard puzzle starts and the level is remembered');

  // ---------------------------------------------------------------- the daily Sudoku and the streak
  await openApp('games', { section: 'sudoku', daily: true }); await sleep(600);
  ok(/Daily|اليومية/.test(await text(T + '.gm-gsub')), 'the daily puzzle opens from a widget/notification section');
  const daily = await page.evaluate(() => import('./js/games/center.js').then(async (GC) => ({ seed: GC.dailySeed('sudoku'), expect: (await import('./js/games/sudoku-core.js')).generate(GC.dailySeed('sudoku'), 'medium').puzzle })));
  ok(daily.seed === fnv('sudoku' + dk()), 'the daily seed comes from the game and the date, the same for everyone');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.sd-cell')].sort((a, b) => a.dataset.i - b.dataset.i).map((c) => (c.classList.contains('given') ? c.dataset.v : '0')).join(''));
  ok(shown === daily.expect, 'the daily board is the seeded Medium puzzle');
  await back();
  await page.evaluate(() => import('./js/games/center.js').then(async (GC) => {
    const pz = (await import('./js/games/sudoku-core.js')).generate(GC.dailySeed('sudoku'), 'medium'), cells = [...pz.solution].map(Number), last = [...pz.puzzle].indexOf('0');
    cells[last] = 0;
    GC.save('sudoku@daily', { v: 1, level: 'medium', daily: true, seed: GC.dailySeed('sudoku'), puzzle: pz.puzzle, solution: pz.solution, cells, notes: new Array(81).fill(0), mistakes: 0, hints: 0, ms: 200000, sel: last, done: false }, { level: 'medium', day: GC.dateKey() });
  }));
  await tab('home');
  await click('.gm-daily[data-play="sudoku"]'); await sleep(600);
  const dState = (await G()).saves['sudoku@daily'].s;
  await key(String(dState.solution[dState.sel])); await sleep(900);
  ok(await exists('.gm-dialog .gm-result-note'), 'the daily result shows the streak');
  await shot(P + 'games-daily-won');
  await dlgBtn(); await sleep(400);
  ok(!(await exists('.app-stack > .app-page:last-child .app-back')), 'Done goes back to the hub');
  g = await G();
  ok(g.daily?.sudoku?.[dk()]?.won && !!g.ach?.['streak-3'] && !!g.ach?.['daily-1'], "today's daily is solved and the three-day streak is earned");
  ok(await exists('.gm-daily.done[data-play="sudoku"] .gm-check') && /3/.test(await text('.gm-hero-streak b')), 'Home shows Sudoku solved and a three-day streak');
  await click('.gm-daily[data-play="sudoku"]'); await sleep(400);
  ok(await exists('.gm-dialog .gm-result.won') && !(await exists('.app-stack > .app-page:last-child .app-back')), 'a solved daily opens the Solved dialog instead of the game');
  await dlgBtn();

  // ---------------------------------------------------------------- 2048
  await openApp('games', { section: 'g2048' }); await sleep(600);
  ok(await count('.tz-tile') === 2 && !(await exists(T + '.gm-timer:not([hidden])')), '2048 starts with two tiles and no timer');
  let moved = false;
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'KeyA', 'KeyW']) { await key(k); await sleep(120); if (await count('.tz-tile') >= 3) { moved = true; break; } }
  ok(moved, 'arrow keys and WASD slide the tiles and a new one appears');
  ok(!(await page.$eval(T + '.app-toolbar [data-act="undo"]', (n) => n.disabled)), 'Undo is available after a move');
  await back();
  await save('g2048', { v: 1, b: { n: 4, next: 20, score: 18000, tiles: [{ id: 1, v: 1024, x: 0, y: 0 }, { id: 2, v: 1024, x: 1, y: 0 }, { id: 3, v: 2, x: 3, y: 3 }] }, won: false, keep: false, over: false, prev: null, top: 1024 });
  await openApp('games', { section: 'g2048' }); await sleep(500);
  await key('ArrowLeft'); await sleep(600);
  ok(await exists('.ou-dialog .tz-win'), 'reaching 2048 shows You win! with Keep playing');
  await shot(P + 'games-2048-win');
  await dlgBtn();
  ok(!(await dlg()) && await count('.tz-tile') >= 2, 'Keep playing goes on with the same board');
  g = await G();
  ok(!!g.ach?.['2048-2048'] && !!g.ach?.['2048-1024'] && (g.stats?.g2048?.max?.tile || 0) >= 2048, 'the 1024 and 2048 achievements and the highest tile are recorded');
  await back();
  await page.evaluate(() => import('./js/games/center.js').then((GC) => {
    const vals = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 8], [4, 2, 8, 8]], tiles = [];
    let id = 1;
    vals.forEach((r, y) => r.forEach((v, x) => tiles.push({ id: id++, v, x, y })));
    GC.save('g2048', { v: 1, b: { n: 4, next: 40, score: 500, tiles }, won: false, keep: false, over: false, prev: null, top: 8 });
  }));
  await openApp('games', { section: 'g2048' }); await sleep(500);
  await key('ArrowLeft'); await sleep(900);
  ok(await exists('.gm-dialog .gm-result'), 'no move left ends in the Game over dialog');
  await shot(P + 'games-2048-over');
  await dlgBtn('first');
  ok(((await G()).stats?.g2048?.played || 0) >= 1, 'the finished 2048 game is counted');
  await shot(P + 'games-2048');

  // ---------------------------------------------------------------- Minesweeper
  await openApp('games', { section: 'minesweeper' }); await sleep(600);
  ok(await count('.ms-cell') === 81, 'Minesweeper opens on Beginner (9×9)');
  if (AR) ok(await page.$eval('.ms-board', (n) => getComputedStyle(n).direction) === 'ltr', 'the board stays left-to-right in Arabic');
  await click('.ms-cell[data-i="40"]'); await sleep(400);
  ok(await count('.ms-cell.open') > 1 && !(await exists('.ms-cell.boom')), 'the first tap is safe and opens an area');
  const closed = await page.evaluate(() => document.querySelector('.ms-cell:not(.open):not(.flag)')?.dataset.i);
  const cnt0 = await text('.ms-count b');
  const bx = await (await page.$(`.ms-cell[data-i="${closed}"]`)).boundingBox();
  await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2, { button: 'right' }); await sleep(300);
  ok(await exists(`.ms-cell[data-i="${closed}"].flag`) && await text('.ms-count b') !== cnt0, 'right-click flags a square and the mine counter goes down');
  await shot(P + 'games-minesweeper');
  await menuPick(/Difficulty|الصعوبة/);
  await pickRadio(/Intermediate|متوسط/);
  if (await dlg()) await dlgBtn();
  ok(await count('.ms-cell') === 256, 'Intermediate is 16×16');
  await back();
  const winCell = await page.evaluate(() => import('./js/games/center.js').then(async (GC) => {
    const M = await import('./js/games/mines-core.js');
    const mines = M.layMines(16, 16, 40, 99, 0), open = mines.map((m) => (m ? 0 : 1)), lastSafe = open.lastIndexOf(1);
    open[lastSafe] = 0;
    GC.save('minesweeper', { v: 1, level: 'intermediate', w: 16, h: 16, n: 40, seed: 99, daily: false, mines: mines.join(''), open: open.join(''), flags: '0'.repeat(256), ms: 95000, over: null, boom: -1, flagged: 0, cur: -1 }, { level: 'intermediate' });
    return lastSafe;
  }));
  await openApp('games', { section: 'minesweeper' }); await sleep(500);
  await click(`.ms-cell[data-i="${winCell}"]`); await sleep(900);
  ok(await exists('.gm-dialog .gm-result.won'), 'opening the last safe square clears the board');
  await shot(P + 'games-minesweeper-won');
  await dlgBtn('first');
  g = await G();
  ok(g.stats?.minesweeper?.lv?.intermediate?.w === 1 && !!g.ach?.['ms-intermediate'] && !!g.ach?.['ms-noflag'], 'the Intermediate win, Bomb squad and No flags needed are recorded');
  await back();
  await page.evaluate(() => import('./js/games/center.js').then(async (GC) => {
    const mines = (await import('./js/games/mines-core.js')).layMines(9, 9, 10, 5, 40);
    GC.save('minesweeper', { v: 1, level: 'beginner', w: 9, h: 9, n: 10, seed: 5, daily: false, mines: mines.join(''), open: '0'.repeat(81), flags: '0'.repeat(81), ms: 0, over: null, boom: -1, flagged: 0, cur: -1 }, { level: 'beginner' });
  }));
  await openApp('games', { section: 'minesweeper' }); await sleep(500);
  const mineAt = (await G()).saves.minesweeper.s.mines.indexOf('1');
  await click(`.ms-cell[data-i="${mineAt}"]`); await sleep(900);
  ok(await exists('.ms-cell.boom') && await exists('.gm-dialog .gm-result.lost'), 'opening a mine ends in the Game over dialog');
  await shot(P + 'games-minesweeper-lost');
  await dlgBtn('first');
  await openApp('games', { section: 'minesweeper', daily: true }); await sleep(700);
  const md = await page.evaluate(() => import('./js/games/center.js').then(async (GC) => {
    const d = (await import('./js/games/mines-core.js')).dailyBoard(GC.dailySeed('minesweeper'), 'intermediate');
    return { n: document.querySelectorAll('.ms-cell').length, start: document.querySelector(`.ms-cell[data-i="${d.start}"]`)?.classList.contains('open'), opened: document.querySelectorAll('.ms-cell.open').length };
  }));
  ok(md.n === 256 && md.start && md.opened > 1, 'the daily board is Intermediate and opens at the seeded start');
  await key('Escape'); await sleep(500);
  ok(await exists('.app-win') && !(await exists('.app-stack > .app-page:last-child .app-back')), 'Escape leaves the game for the hub and keeps the window open');
  // Expert in the phone-size window turns on its side
  await openApp('games', { section: 'minesweeper' }); await sleep(500);
  await menuPick(/Difficulty|الصعوبة/);
  await pickRadio(/Expert|خبير/);
  if (await dlg()) await dlgBtn();
  ok(await count('.ms-cell') === 480 && await exists('.ms.turned') && await inside('.ms-board, .ms-status'), 'Expert (30×16) turns on its side and fits the phone-size window');
  await shot(P + 'games-minesweeper-expert');

  // ---------------------------------------------------------------- Solitaire
  const C = (rank, suit) => '♠♥♣♦'.indexOf(suit) * 13 + rank - 1;
  const build = (spec, draw = 1) => {
    const used = new Set([...spec.waste, ...spec.found.flat(), ...spec.tab.flatMap((c) => [...c.d, ...c.u])]);
    return { draw, stock: [...Array(52).keys()].filter((c) => !used.has(c)), waste: spec.waste, found: spec.found, tab: spec.tab };
  };
  const solSave = (st, extra = {}) => ({ v: 1, draw: st.draw, seed: 1, daily: false, proved: false, s: st, score: 0, moves: 0, passes: 0, ms: 0, hist: [], ...extra });
  const mid = build({ waste: [C(1, '♣')], found: [[], [], [], []], tab: [
    { d: [C(13, '♣'), C(12, '♦')], u: [C(8, '♠'), C(7, '♥')] }, { d: [], u: [C(9, '♦')] }, { d: [], u: [C(13, '♥')] }, { d: [], u: [C(5, '♠')] },
    { d: [], u: [C(2, '♦')] }, { d: [], u: [C(11, '♠')] }, { d: [], u: [C(3, '♣')] }] });
  await back();
  await save('solitaire', solSave(mid), { level: 'draw1' });
  await mod('./js/games/center.js', 'setPref', 'solitaire', 'auto', false);
  await openApp('games', { section: 'solitaire' }); await sleep(800);
  const sol = async () => (await G()).saves?.solitaire?.s;
  const box = (c) => page.evaluate((c) => { const r = document.querySelector(`.sol-card[data-c="${c}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, c);
  ok(await count('.sol-card') === 52 && await count('.sol-card.up') === 9, 'Solitaire resumes the saved deal (52 cards, 9 face up)');
  if (AR) ok(await page.evaluate(() => { const t = document.querySelector('.sol-table').getBoundingClientRect(), st = document.querySelector('.sol-slot.stock').getBoundingClientRect(); return st.left > t.left + t.width / 2; }), 'in Arabic the stock sits on the right, the cards stay readable');
  const a = await box(C(8, '♠')), b = await box(C(9, '♦'));
  await page.mouse.move(a.x + a.w / 2, a.y + 10); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + a.w / 2 + ((b.x - a.x) * i) / 8, a.y + 10 + ((b.y + b.h * 0.3 - a.y) * i) / 8); await sleep(16); }
  ok(await count('.sol-card.drag') === 2, 'dragging 8♠ lifts the 7♥ on it too');
  await page.mouse.up(); await sleep(900);
  let so = await sol();
  ok(JSON.stringify(so?.s.tab[1].u) === JSON.stringify([C(9, '♦'), C(8, '♠'), C(7, '♥')]) && so.s.tab[0].u[0] === C(12, '♦') && so.score === 5, 'the run lands on 9♦ and the card under it turns over (+5)');
  const w = await box(C(1, '♣'));
  await page.mouse.click(w.x + w.w / 2, w.y + w.h / 2); await sleep(900);
  so = await sol();
  ok(so?.s.found.some((f) => f[0] === C(1, '♣')) && so.score === 15, 'tapping A♣ sends it to a foundation (+10)');
  await click(T + '.app-toolbar [data-act="undo"]'); await sleep(700);
  ok((await sol())?.s.waste.at(-1) === C(1, '♣'), 'Undo puts A♣ back');
  await key('KeyZ', ['Control']); await sleep(700);
  so = await sol();
  ok(so?.s.tab[0].u.length === 2 && so.s.tab[1].u.length === 1 && so.score === 0, 'Ctrl+Z takes back the drag');
  ok(await menuPick(/automatically|تلقائيًا/), 'the ⋮ menu has the game’s own options');
  await sleep(800);
  ok((await G()).prefs.solitaire.auto === true && (await sol()).s.found.flat().includes(C(1, '♣')), 'Move cards up automatically sends the ace up by itself');
  const before = (await sol()).s.waste.length;
  const stockTop = (await sol()).s.stock.at(-1), sb = await box(stockTop);
  await page.mouse.click(sb.x + sb.w / 2, sb.y + sb.h / 2); await sleep(700);
  ok((await sol()).s.waste.length === before + 1, 'tapping the stock turns over one card (Draw 1)');
  await key('Space'); await sleep(700);
  ok((await sol()).s.waste.length === before + 2, 'Space deals from the stock');
  await click(T + '.sol-hint'); await sleep(350);
  ok(await exists('.sol-card.hint, .sol-slot.hint'), 'Hint highlights a move');
  await shot(P + 'games-solitaire');
  await menuPick(/Card back|ظهر الورقة/);
  await pickRadio(/Red|أحمر/);
  ok(await page.$eval('.sol', (n) => n.dataset.back) === 'red', 'the card back turns red');
  const nearWin = build({ waste: [], found: [0, 1, 2, 3].map((su) => [...Array(12).keys()].map((r) => su * 13 + r)), tab: [
    { d: [], u: [C(13, '♠')] }, { d: [], u: [C(13, '♥')] }, { d: [], u: [C(13, '♣')] }, { d: [], u: [C(13, '♦')] }, { d: [], u: [] }, { d: [], u: [] }, { d: [], u: [] }] });
  await back();
  await save('solitaire', solSave(nearWin, { score: 400, moves: 120, ms: 95000 }), { level: 'draw1' });
  await openApp('games', { section: 'solitaire' }); await sleep(700);
  const kb = await box(C(13, '♠'));
  await page.mouse.click(kb.x + kb.w / 2, kb.y + kb.h / 2); await sleep(2200);
  ok(await exists('.gm-dialog .gm-result.won'), 'the last kings go up by themselves and the game is won');
  g = await G();
  ok(g.stats?.solitaire?.won === 1 && g.stats.solitaire.best?.draw1 > 0 && g.stats.solitaire.max?.score > 400, 'the win is recorded with its time and the score with the time bonus');
  await shot(P + 'games-solitaire-won');
  await dlgBtn('first');
  await openApp('games', { section: 'solitaire', daily: true }); await sleep(2500);
  const ds = (await G()).saves?.['solitaire@daily']?.s;
  ok(ds?.daily && ds.proved === true, 'the Daily deal is one the solver proved winnable');

  // ---------------------------------------------------------------- Chess
  await back();
  await mod('./js/games/center.js', 'setPref', 'chess', 'level', '2p');
  await openApp('games', { section: 'chess' }); await sleep(800);
  const sq = (n) => ((+n[1] - 1) << 4) | (n.charCodeAt(0) - 97);
  const center = (n) => page.evaluate((i) => { const r = document.querySelector(`.ch-sq[data-sq="${i}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sq(n));
  const tap = async (n) => { const c = await center(n); await page.mouse.click(c.x, c.y); await sleep(350); };
  const mv = async (x, y) => { await tap(x); await tap(y); };
  const pieceAt = (n) => page.evaluate((i) => document.querySelector(`.ch-pc[data-sq="${i}"]:not(.gone)`)?.dataset.code || null, sq(n));
  const moves = () => page.evaluate(() => [...document.querySelectorAll('.ch-moves .mv')].map((n) => n.textContent));
  ok(await count('.ch-pc') === 32 && /Two|لاعبان/.test(await text(T + '.gm-gsub')), 'Chess opens a two-player game with 32 pieces');
  const a1 = await center('a1'), h1 = await center('h1'), a8 = await center('a8');
  ok(a1.x < h1.x && a1.y > a8.y && await page.$eval('.ch-board', (n) => getComputedStyle(n).direction) === 'ltr', 'a1 is bottom-left and the board never mirrors (also in Arabic)');
  await tap('e2');
  ok(await count('.ch-sq.q-dot') === 2, 'selecting e2 shows two legal-move dots');
  await tap('e4');
  ok(await pieceAt('e4') === 'wp', 'tap-to-move e2–e4');
  for (const [x, y] of [['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6']]) await mv(x, y);
  await shot(P + 'games-chess');
  await mv('h5', 'f7'); await sleep(400);
  const m1 = await moves();
  ok(m1.length === 7 && m1[6] === 'Qxf7#', `Scholar's mate in SAN (${m1.join(' ')})`);
  ok(await exists('.ch-over:not([hidden])') && !(await G()).stats?.chess, 'checkmate ends the game; two-player games stay out of the statistics');
  await menuPick(/Difficulty|الصعوبة/);
  await pickRadio(/Level 1|المستوى 1/);
  if (await dlg()) await dlgBtn();
  ok(await count('.ch-pc') === 32 && /1/.test(await text(T + '.gm-gsub')), 'a new game against the computer (level 1)');
  await mv('e2', 'e4');
  await page.waitForFunction(() => document.querySelectorAll('.ch-moves .mv').length === 2, { timeout: 8000 }).catch(() => {});
  ok((await moves()).length === 2, 'the computer replies from its Worker: ' + (await moves()).join(' '));
  await click(T + '.app-toolbar [data-act="undo"]'); await sleep(600);
  ok((await moves()).length === 0 && await pieceAt('e2') === 'wp', 'Undo takes back your move and the computer’s');
  await mv('d2', 'd4');
  await page.waitForFunction(() => document.querySelectorAll('.ch-moves .mv').length === 2, { timeout: 8000 }).catch(() => {});
  await click(T + '.ch-btn[data-act="resign"]'); await sleep(300);
  await dlgBtn('danger'); await sleep(1500);
  ok(await exists('.gm-dialog .gm-result.lost'), 'resigning ends in the Game over dialog');
  g = await G();
  ok(g.stats?.chess?.played === 1 && g.stats.chess.won === 0, 'the loss is recorded');
  await dlgBtn('first');
  await openApp('games', { section: 'chess', daily: true }); await sleep(800);
  const pz = await page.evaluate(async () => {
    const E = await import('./js/games/chess-engine.js'), R = await import('./js/games/rand.js');
    const idx = Math.round(R.parseDateKey(R.dateKey()).getTime() / 864e5) % E.PUZZLES.length, p = new E.Position(E.PUZZLES[idx]);
    return { key: E.uci(E.mateKeys(p, 2)[0]) };
  });
  ok(/mate in 2|نقلتين/.test(await text(T + '.ch-status')), 'the daily mate-in-two is on the board: ' + await text(T + '.ch-status'));
  await mv(pz.key.slice(0, 2), pz.key.slice(2, 4));
  await page.waitForFunction(() => document.querySelectorAll('.ch-moves .mv').length === 2, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const mate = await page.evaluate(async () => { const E = await import('./js/games/chess-engine.js'); const st = (await import('./js/games/center.js')).saved('chess@daily').s; const p = new E.Position(st.fen0); st.moves.forEach((m) => p.make(m)); return E.uci(E.mateKeys(p, 1)[0]); });
  await mv(mate.slice(0, 2), mate.slice(2, 4));
  if (mate[4]) { await page.click(`.ch-promo button[data-k="${mate[4]}"]`).catch(() => {}); }
  await sleep(1300);
  ok(await exists('.gm-dialog .gm-result.won'), 'the key move, the defence and mate solve the daily puzzle');
  ok(Object.values((await G()).daily?.chess || {}).some((r) => r.won), "today's chess puzzle is marked solved");
  await shot(P + 'games-chess-daily');
  await dlgBtn();

  // ---------------------------------------------------------------- play time, profile with data
  g = await G();
  ok(Object.values(g.time?.[dk()] || {}).reduce((x, y) => x + y, 0) > 0, 'play time is logged for today');
  await tab('profile');
  ok(await count('.gm-most-row') >= 1 && await count('.gm-minibadges .gm-badge.on') >= 3, 'Profile shows the most played games and earned medals');
  await shot(P + 'games-profile-data');

  // ---------------------------------------------------------------- maximised: bigger boards, still inside the screen
  await click('.app-handle-btn'); await sleep(600);
  ok(await page.evaluate(() => document.querySelector('.app-win').classList.contains('max')), 'the window maximises');
  await tab('home');
  await shot(P + 'games-max-home');
  await openApp('games', { section: 'sudoku' }); await sleep(700);
  ok(await exists('.sd.wide') && await page.$eval('.sd-board', (n) => n.getBoundingClientRect().width) > 420 && await inside('.sd-board, .sd-pad, .sd-tools'), 'maximised Sudoku puts the pad beside a bigger board');
  await shot(P + 'games-max-sudoku');
  await openApp('games', { section: 'chess' }); await sleep(700);
  ok(await exists('.ch.wide') && await inside('.ch-board, .ch-side'), 'maximised Chess shows the side panel next to the board');
  await shot(P + 'games-max-chess');
  await openApp('games', { section: 'solitaire' }); await sleep(900);
  ok(await page.$eval('.sol-card', (n) => n.getBoundingClientRect().width) > 70 && await inside('.sol-card'), 'maximised Solitaire deals bigger cards that stay on the table');
  await shot(P + 'games-max-solitaire');
  await click('.app-handle-btn'); await sleep(600);
  await openApp('games', { section: 'sudoku' }); await sleep(600);
  ok(await inside('.sd-board, .sd-pad, .sd-tools, .gm-timer'), 'Sudoku fits the phone-size window');
  await openApp('games', { section: 'chess' }); await sleep(600);
  ok(await exists('.ch.narrow') && await inside('.ch-board, .ch-actions'), 'Chess fits the phone-size window with the panel under the board');
  await closeApp();

  // ---------------------------------------------------------------- widgets
  await mod('./js/shell/home.js', 'addWidget', 'games-today', 's');
  await mod('./js/shell/home.js', 'addWidget', 'games-today', 'm');
  await save('g2048', { v: 1, b: { n: 4, next: 5, score: 1204, tiles: [{ id: 1, v: 256, x: 0, y: 0 }, { id: 2, v: 2, x: 1, y: 1 }] }, won: false, keep: false, over: false, prev: null, top: 256 }, { info: { score: 1204, pct: 0.7 } });
  await mod('./js/shell/home.js', 'addWidget', 'games-continue', 'm');
  await sleep(600);
  ok(await count('.wg-games .wgm-row[data-g]') >= 8 + 1, 'Today’s puzzles (small and medium) and Continue playing render on the Home screen');
  ok(await count('.wg-games .wgm-ok') >= 2, 'the widgets tick the solved puzzles');
  await shot(P + 'games-widgets');
  await page.evaluate(() => document.querySelector('.wg-games.w-m .wgm-row[data-g="minesweeper"]')?.click()); await sleep(1200);
  ok(/Daily|اليومية/.test(await text(T + '.gm-gsub')) && await count('.ms-cell') === 256, 'a widget row opens that daily puzzle');
  await closeApp();

  // ---------------------------------------------------------------- Finder commands
  // other apps may answer "play …" too (Music): only Gaming Hub's own results count here
  const cmds = await page.evaluate(async () => {
    const m = await import('./js/core/hooks.js');
    const mine = (q) => m.runCommands(q, () => {}).filter((r) => r.icon === 'gmGamepad' || r.icon === 'gmPuzzle').map((r) => r.title);
    return { play: mine('play sudoku'), daily: mine('daily puzzle'), none: mine('play the piano').length };
  });
  ok(cmds.play.length === 1 && /Sudoku|سودوكو/.test(cmds.play[0]) && cmds.daily.length === 1 && cmds.none === 0, `Finder: "play sudoku" and "daily puzzle" (${cmds.play.concat(cmds.daily).join(' | ')})`);
  await page.evaluate(async () => { const m = await import('./js/core/hooks.js'); m.runCommands('play chess', () => {}).find((r) => r.icon === 'gmGamepad').run(); }); await sleep(1500);
  ok(await count('.ch-pc') > 0, '"play chess" opens Chess');
  await closeApp();

  // ---------------------------------------------------------------- Lock screen chip
  await page.evaluate(() => import('./js/core/store.js').then((m) => m.setSetting('lockWidgets', ['games'])));
  await mod('./js/shell/lock.js', 'lockNow'); await sleep(800);
  ok(await exists('#lock .gm-lk') && /2\/4/.test(await text('#lock .gm-lk')), 'the Lock screen chip shows today’s puzzles and the streak (' + await text('#lock .gm-lk') + ')');
  await shot(P + 'games-lock');
  await mod('./js/shell/lock.js', 'unlock'); await sleep(500);

  // ---------------------------------------------------------------- Modes and Routines: Open today's puzzle
  const runAction = (id, p) => page.evaluate(async (id, p) => {
    const [{ ACTIONS }, { pageCtx }] = await Promise.all([import('./js/routines/actions.js'), import('./js/routines/page.js')]);
    try { return { v: await ACTIONS[id].run(pageCtx(), p, {}) }; } catch (e) { return { err: e.key || e.message }; }
  }, id, p);
  const gOpts = await page.evaluate(() => Promise.all([import('./js/routines/actions.js'), import('./js/core/i18n.js')]).then(([A, I]) => A.ACTIONS['games.daily'] && [I.t(A.ACTIONS['games.daily'].name), ...A.ACTIONS['games.daily'].params[0].opts.map((o) => o[0])]));
  ok(gOpts && !gOpts[0].startsWith('games.') && gOpts.slice(1).join() === 'next,sudoku,minesweeper,solitaire,chess', 'Routines lists Open today’s puzzle (next unsolved or one of the four daily games)');
  const unsolved = await page.evaluate(() => import('./js/games/center.js').then((m) => m.todayPuzzles().find((x) => !x.solved)?.name));
  let ga = await runAction('games.daily', { game: 'next' });
  await sleep(1500);
  ok(ga.v === unsolved && await exists('.app-win'), 'with Next unsolved it opens the first daily puzzle not solved yet (' + ga.v + ')');
  await closeApp();
  ga = await runAction('games.daily', { game: 'chess' });
  await sleep(1800);
  // today's chess puzzle was solved above, so it opens on its Solved dialog, as from the hub
  ok(/Chess|شطرنج/.test(ga.v || '') && (await count('.ch-pc') > 0 || await exists('.gm-dialog .gm-result.won')), 'or the daily puzzle of the chosen game (Chess, solved today)');
  await page.keyboard.press('Escape'); await sleep(300);
  await closeApp();
};
