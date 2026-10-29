// The games in Gaming Hub. Each module default-exports
//   { id, name, color, daily: bool, mount(el, ctx) → controller }
// where ctx = { daily, seed, level, record(result), finish(result), save(state), load(), changed(), achieve(id),
// active(), paused(), reduceMotion(), progress(facts), toast(msg) }. Names, descriptions and level names are i18n keys.
// The hub (js/games/ui.js) owns the One UI top bar: Back, the title with the level or "Daily puzzle", the timer chip
// (tap to pause), Undo and the ⋮ menu (New game, Difficulty, Daily puzzle, the game's own options, How to play,
// Statistics). A game draws only its board and its own status row (mistakes, mines left, score…).
//
// Module fields (all optional except id, name, mount)
//   levels: [{ id, name, noStats? }]   the Difficulty choices; ctx.level is the chosen id (noStats: never recorded)
//   level / dailyLevel                  the default level and the level of the daily game
//   dailyName                           the daily card's subtitle when the daily game isn't one of `levels` (Chess)
//   lowerIsBetter                       the best score is a time in ms (Sudoku, Minesweeper…); else higher is better
//   desc, rules                         one line for the Library, and the How to play text (\n between paragraphs)
//   undoInGame                          the game shows its own Undo button, so the top bar leaves it out (Sudoku)
//   info(state): { ms?, score?, pct? }  numbers for Continue playing and its widget, read from a saved state
// Controller (what mount returns)
//   newGame({ level, seed, daily })     start over in place (without it the hub remounts the game)
//   undo(), canUndo()                   the Undo button; call ctx.changed() when canUndo() may have changed
//   pause(on)                           stop and restart clocks; the hub also covers the board
//   time(): ms | null                   the top bar's timer chip (left out when the game has no clock, like 2048)
//   key(e): bool                        keys while the game is on screen and nothing covers it; true = handled
//   menu(): [{ label, icon, checked, onClick } | '-']   the game's own items in the ⋮ menu
//   stats(): [{ label, value }]         extra rows for the Statistics page (already translated)
//   unmount()
// ctx.finish(result) records the result, then shows the One UI result dialog after result.delay ms; result.title names
// it. record(result) with result = { won, score?, ms?, …facts } feeds stats, bests, the daily streak, challenges and
// achievements (center.js), and clears the saved game unless result.keep. save(state) after each move (save(null) when
// the game is over); load() gives it back for Continue playing. Daily games are saved apart from normal ones.
// `daily: true` here lists a game under Today's puzzles before its module has loaded (widgets, todayPuzzles()).
export const GAMES = [
  { id: 'sudoku', name: 'games.sudoku', cat: 'puzzle', daily: true, load: () => import('./sudoku.js') },
  { id: 'minesweeper', name: 'games.minesweeper', cat: 'puzzle', daily: true, load: () => import('./minesweeper.js') },
  { id: 'solitaire', name: 'games.solitaire', cat: 'cards', daily: true, load: () => import('./solitaire.js') },
  { id: 'chess', name: 'games.chess', cat: 'board', daily: true, load: () => import('./chess.js') },
  { id: 'g2048', name: 'games.g2048', cat: 'puzzle', load: () => import('./g2048.js') },
];
export const gameById = (id) => GAMES.find((g) => g.id === id);
