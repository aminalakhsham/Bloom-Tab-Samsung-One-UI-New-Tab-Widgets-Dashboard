// Gaming Hub's records: stats, personal bests, the daily puzzles and their streak, daily challenges, achievements,
// play time (Game Booster style) and saved games, all in store key `games` (results are per computer).
//   games: { stats: { [gameId]: { played, won, best: { [level]: score|ms }, last, run, bestRun,
//                                 lv: { [level]: { p, w, t, n } }, max: { tile?, score? } } },
//            daily: { [gameId]: { [dateKey]: { won, score, ms } } },
//            saves: { [gameId | gameId@daily]: { _gc: 1, s: state, at, level, day?, info? } },
//            ach: { [achId]: ts }, chal: { [dateKey]: [challengeId] }, chalN: count, days: { [dateKey]: wins },
//            time: { [dateKey]: { [gameId]: ms } }, prefs: { [gameId]: { level, … } }, profile: { name } }
// `lv` counts games played (p) and won (w) per level, with the total (t) and number (n) of winning times for averages.
// Everything a widget, the Lock screen or Finder needs is exported here and reads synchronously from the store cache,
// so this file stays small: it loads with every new tab.
import { store } from '../core/store.js';
import { t, locale } from '../core/i18n.js';
import { GAMES } from './index.js';
import { rng, shuffle, dateKey, parseDateKey, dailySeed } from './rand.js';

export { dateKey, dailySeed };
const get = () => { const g = store.get('games'); return g && typeof g === 'object' ? g : {}; };
const put = (fn) => store.update('games', (g) => { g = { stats: {}, daily: {}, saves: {}, ach: {}, ...(g && typeof g === 'object' ? g : {}) }; fn(g); return g; });
const sum = (a) => a.reduce((x, y) => x + (+y || 0), 0);
const MIN = 60000;

// ------------------------------------------------------------------ achievements
// Each one has a `goal` and a `progress(g)` read from the stored stats (shown as a ring), or a `test(gameId, r, g)` on a
// single result for feats that leave no trace in the totals. Names are i18n keys; the description is name + '.d'.
const st = (g, id) => g.stats?.[id] || {};
const wins = (g) => sum(Object.values(g.stats || {}).map((s) => s.won));
const lvWon = (g, id, ...lv) => sum(lv.map((l) => st(g, id).lv?.[l]?.w));
const bestUnder = (g, id, lv, ms) => (st(g, id).best?.[lv] != null && st(g, id).best[lv] < ms ? 1 : 0);
const maxOf = (g, id, k) => st(g, id).max?.[k] || 0;
export const ACHIEVEMENTS = [
  { id: 'first-win', name: 'games.ach.firstWin', icon: 'starFill', color: '#ffb400', goal: 1, progress: wins },
  { id: 'wins-10', name: 'games.ach.wins10', icon: 'gmFlame', color: '#ff6b2c', goal: 10, progress: wins },
  { id: 'wins-50', name: 'games.ach.wins50', icon: 'gmTrophy', color: '#e5a00d', goal: 50, progress: wins },
  { id: 'all-games', name: 'games.ach.allGames', icon: 'gmGamepad', color: '#7a5cff', goal: GAMES.length, progress: (g) => GAMES.filter((x) => st(g, x.id).played).length },
  { id: 'daily-1', name: 'games.ach.daily1', icon: 'calendar', color: '#ff4d6d', goal: 1, progress: (g) => (Object.values(g.daily || {}).some((d) => Object.values(d).some((r) => r?.won)) ? 1 : 0) },
  { id: 'streak-3', name: 'games.ach.streak3', icon: 'gmFlame', color: '#ff9500', goal: 3, progress: (g) => bestStreak(g) },
  { id: 'streak-7', name: 'games.ach.streak7', icon: 'gmFlame', color: '#ff453a', goal: 7, progress: (g) => bestStreak(g) },
  { id: 'streak-30', name: 'games.ach.streak30', icon: 'gmFlame', color: '#d6249f', goal: 30, progress: (g) => bestStreak(g) },
  { id: 'perfect-day', name: 'games.ach.perfectDay', icon: 'sun', color: '#f5b800', goal: 1, progress: () => 0, test: (id, r, g) => dailyIds().every((d) => g.daily?.[d]?.[dateKey()]?.won) },
  { id: 'challenge-1', name: 'games.ach.chal1', icon: 'gmFlag', color: '#14a8b8', goal: 1, progress: (g) => g.chalN || 0 },
  { id: 'challenge-10', name: 'games.ach.chal10', icon: 'gmFlag', color: '#3e7bff', goal: 10, progress: (g) => g.chalN || 0 },
  { id: 'night-owl', name: 'games.ach.nightOwl', icon: 'moon', color: '#5e5ce6', goal: 1, progress: () => 0, test: (id, r) => r.won && new Date().getHours() < 4 },
  { id: 'sudoku-10', game: 'sudoku', name: 'games.ach.sudoku10', icon: 'grid', color: '#3e7bff', goal: 10, progress: (g) => st(g, 'sudoku').won || 0 },
  { id: 'sudoku-fast', game: 'sudoku', name: 'games.ach.sudokuFast', icon: 'timer', color: '#22a6e0', goal: 1, progress: (g) => bestUnder(g, 'sudoku', 'medium', 5 * MIN) },
  { id: 'sudoku-clean', game: 'sudoku', name: 'games.ach.sudokuClean', icon: 'sparkle', color: '#5856d6', goal: 1, progress: () => 0, test: (id, r) => id === 'sudoku' && r.won && ['hard', 'expert'].includes(r.level) && !r.mistakes && !r.hints },
  { id: 'sudoku-expert', game: 'sudoku', name: 'games.ach.sudokuExpert', icon: 'gmCrown', color: '#a64fe0', goal: 1, progress: (g) => lvWon(g, 'sudoku', 'expert') },
  { id: 'ms-first', game: 'minesweeper', name: 'games.ach.msFirst', icon: 'gmFlag', color: '#2fb36b', goal: 1, progress: (g) => st(g, 'minesweeper').won || 0 },
  { id: 'ms-intermediate', game: 'minesweeper', name: 'games.ach.msIntermediate', icon: 'gmMine', color: '#1f9a5b', goal: 1, progress: (g) => lvWon(g, 'minesweeper', 'intermediate') },
  { id: 'ms-expert', game: 'minesweeper', name: 'games.ach.msExpert', icon: 'gmMine', color: '#14804a', goal: 1, progress: (g) => lvWon(g, 'minesweeper', 'expert') },
  { id: 'ms-expert-fast', game: 'minesweeper', name: 'games.ach.msExpertFast', icon: 'gmBolt', color: '#f5b800', goal: 1, progress: (g) => bestUnder(g, 'minesweeper', 'expert', 10 * MIN) },
  { id: 'ms-noflag', game: 'minesweeper', name: 'games.ach.msNoFlag', icon: 'eye', color: '#00b5ad', goal: 1, progress: () => 0, test: (id, r) => id === 'minesweeper' && r.won && ['intermediate', 'expert'].includes(r.level) && !r.flags },
  { id: 'solitaire-win', game: 'solitaire', name: 'games.ach.solWin', icon: 'gmCards', color: '#1f9a50', goal: 1, progress: (g) => st(g, 'solitaire').won || 0 },
  { id: 'solitaire-10', game: 'solitaire', name: 'games.ach.sol10', icon: 'gmCards', color: '#0f7a3c', goal: 10, progress: (g) => st(g, 'solitaire').won || 0 },
  { id: 'chess-win', game: 'chess', name: 'games.ach.chessWin', icon: 'gmCrown', color: '#5d5e66', goal: 1, progress: (g) => st(g, 'chess').won || 0 },
  { id: 'chess-expert', game: 'chess', name: 'games.ach.chessExpert', icon: 'gmCrown', color: '#2b2b30', goal: 1, progress: (g) => lvWon(g, 'chess', '4', '5') },
  { id: '2048-1024', game: 'g2048', name: 'games.ach.t1024', icon: 'gmTile', color: '#f2a65a', goal: 1024, progress: (g) => maxOf(g, 'g2048', 'tile') },
  { id: '2048-2048', game: 'g2048', name: 'games.ach.t2048', icon: 'gmTile', color: '#e8b520', goal: 2048, progress: (g) => maxOf(g, 'g2048', 'tile') },
  { id: '2048-4096', game: 'g2048', name: 'games.ach.t4096', icon: 'gmTile', color: '#ff7a45', goal: 4096, progress: (g) => maxOf(g, 'g2048', 'tile') },
  { id: '2048-score', game: 'g2048', name: 'games.ach.tScore', icon: 'gmChart', color: '#ff9500', goal: 20000, progress: (g) => maxOf(g, 'g2048', 'score') },
];
export const achById = (id) => ACHIEVEMENTS.find((a) => a.id === id);
export const achievements = () => get().ach || {};
/** Progress of an achievement, 0…1 (1 when earned). */
export function achProgress(a, g = get()) {
  if (g.ach?.[a.id]) return 1;
  return Math.max(0, Math.min(1, (a.progress?.(g) || 0) / (a.goal || 1)));
}
function checkAch(g, gameId, r, out) {
  for (const a of ACHIEVEMENTS) {
    if (g.ach[a.id]) continue;
    if ((a.test && r && a.test(gameId, r, g)) || (a.progress && a.progress(g) >= a.goal)) { g.ach[a.id] = Date.now(); out.ach.push(a.id); }
  }
}
/** Unlocks every achievement the stored stats already reach (data restored from a backup). Returns the new ids. */
export function check() {
  if (!ACHIEVEMENTS.some((a) => !achievements()[a.id] && a.progress && a.progress(get()) >= a.goal)) return [];
  const out = { ach: [], chal: [] };
  put((g) => checkAch(g, null, null, out));
  return out.ach;
}
/** Unlocks one achievement now. Returns true when it is new. */
export function unlock(achId) {
  let isNew = false;
  put((g) => { if (!g.ach[achId]) { g.ach[achId] = Date.now(); isNew = true; } });
  return isNew;
}

// ------------------------------------------------------------------ daily challenges
// Three a day, picked with the day's seed so everyone has the same ones; the first is always about a daily puzzle.
// `test(gameId, r, g)` runs on every finished game and on progress reports (r.progress) from games that go on.
export const CHALLENGES = [
  { id: 'sudoku-daily-8', game: 'sudoku', daily: true, name: 'games.chal.sudokuDaily8', test: (id, r) => id === 'sudoku' && r.won && r.daily && r.ms < 8 * MIN },
  { id: 'ms-daily', game: 'minesweeper', daily: true, name: 'games.chal.msDaily', test: (id, r) => id === 'minesweeper' && r.won && r.daily },
  { id: 'ms-daily-5', game: 'minesweeper', daily: true, name: 'games.chal.msDaily5', test: (id, r) => id === 'minesweeper' && r.won && r.daily && r.ms < 5 * MIN },
  { id: 'sol-daily', game: 'solitaire', daily: true, name: 'games.chal.solDaily', test: (id, r) => id === 'solitaire' && r.won && r.daily },
  { id: 'chess-daily', game: 'chess', daily: true, name: 'games.chal.chessDaily', test: (id, r) => id === 'chess' && r.won && r.daily },
  { id: 'sudoku-clean', game: 'sudoku', name: 'games.chal.sudokuClean', test: (id, r) => id === 'sudoku' && r.won && !r.mistakes },
  { id: 'sudoku-hard', game: 'sudoku', name: 'games.chal.sudokuHard', test: (id, r) => id === 'sudoku' && r.won && ['hard', 'expert'].includes(r.level) && !r.hints },
  { id: 'ms-beginner-60', game: 'minesweeper', name: 'games.chal.msBeginner60', test: (id, r) => id === 'minesweeper' && r.won && r.level === 'beginner' && r.ms < MIN },
  { id: 'ms-noflag', game: 'minesweeper', name: 'games.chal.msNoFlag', test: (id, r) => id === 'minesweeper' && r.won && !r.flags },
  { id: '2048-1024', game: 'g2048', name: 'games.chal.t1024', test: (id, r) => id === 'g2048' && (r.tile || 0) >= 1024 },
  { id: '2048-10k', game: 'g2048', name: 'games.chal.t10k', n: 10000, test: (id, r) => id === 'g2048' && (r.score || 0) >= 10000 },
  { id: 'solitaire-win', game: 'solitaire', name: 'games.chal.solWin', test: (id, r) => id === 'solitaire' && r.won },
  { id: 'chess-win', game: 'chess', name: 'games.chal.chessWin', test: (id, r) => id === 'chess' && r.won },
  { id: 'wins-3', name: 'games.chal.wins3', test: (id, r, g) => (g.days?.[dateKey()] || 0) >= 3 },
];
export const challengeName = (c) => t(c.name, c.n ? { n: new Intl.NumberFormat(locale()).format(c.n) } : undefined);
/** Today's three challenges: [{ ...challenge, done }]. */
export function todayChallenges(day = dateKey(), g = get()) {
  const r = rng(dailySeed('challenges', day));
  const first = shuffle(CHALLENGES.filter((c) => c.daily), r)[0];
  const rest = shuffle(CHALLENGES.filter((c) => !c.daily), r).slice(0, 2);
  const done = new Set(g.chal?.[day] || []);
  return [first, ...rest].map((c) => ({ ...c, done: done.has(c.id) }));
}
function checkChal(g, gameId, r, out) {
  const day = dateKey(), done = ((g.chal ||= {})[day] ||= []);
  for (const c of todayChallenges(day, g)) {
    if (done.includes(c.id) || !c.test(gameId, r, g)) continue;
    done.push(c.id);
    g.chalN = (g.chalN || 0) + 1;
    out.chal.push(c.id);
  }
}

// ------------------------------------------------------------------ results
// Old daily results, challenge days, win counts and play time are trimmed so the key stays small (a year of dailies
// is kept for the streaks).
function prune(g) {
  const keep = dateKey(new Date(Date.now() - 400 * 86400000)), recent = dateKey(new Date(Date.now() - 40 * 86400000));
  for (const d of Object.values(g.daily || {})) for (const k of Object.keys(d)) if (k < keep) delete d[k];
  for (const key of ['chal', 'days', 'time']) for (const k of Object.keys(g[key] || {})) if (k < recent) delete g[key][k];
}

/** Records a finished game. result = { won, score?, ms?, level?, daily?, …facts }. `lowerIsBetter` is for times.
 *  Extra fields (mistakes, hints, flags, tile) feed challenges and achievements. Returns what this result earned:
 *  { ach: [ids], chal: [ids], best: bool }. */
export function record(gameId, result, { lowerIsBetter = false } = {}) {
  const r = { ...result }, out = { ach: [], chal: [], best: false }, day = dateKey();
  put((g) => {
    const s = (g.stats[gameId] ||= { played: 0, won: 0, best: {} });
    s.best ||= {};
    s.played++;
    if (r.won) s.won++;
    s.last = Date.now();
    const v = r.ms ?? r.score, k = r.level || 'default';
    if (r.won !== false && v != null) {
      const cur = s.best[k];
      if (cur == null || (lowerIsBetter ? v < cur : v > cur)) { s.best[k] = v; out.best = cur != null; }
    }
    const L = ((s.lv ||= {})[k] ||= { p: 0, w: 0 });
    L.p++;
    if (r.won) {
      L.w++;
      if (r.ms != null) { L.t = (L.t || 0) + r.ms; L.n = (L.n || 0) + 1; }
      s.run = (s.run || 0) + 1;
      s.bestRun = Math.max(s.bestRun || 0, s.run);
    } else if (r.won === false) s.run = 0;
    for (const f of ['tile', 'score']) if (typeof r[f] === 'number') (s.max ||= {})[f] = Math.max(s.max?.[f] || 0, r[f]);
    // a daily that was solved stays solved, even if it is played again afterwards
    if (r.daily && !g.daily[gameId]?.[day]?.won) (g.daily[gameId] ||= {})[day] = { won: !!r.won, score: r.score, ms: r.ms };
    if (r.won) (g.days ||= {})[day] = (g.days[day] || 0) + 1;
    checkChal(g, gameId, r, out);
    checkAch(g, gameId, r, out);
    prune(g);
  });
  return out;
}

/** A milestone in a game that is still going (2048's tiles and score): bests, challenges and achievements, without
 *  counting a finished game. facts = { tile?, score?, level? }. Returns { ach, chal, best } like record(). */
export function progress(gameId, facts) {
  const r = { ...facts, progress: true }, out = { ach: [], chal: [], best: false };
  put((g) => {
    const s = (g.stats[gameId] ||= { played: 0, won: 0, best: {} });
    s.best ||= {};
    for (const f of ['tile', 'score']) if (typeof r[f] === 'number' && r[f] > (s.max?.[f] || 0)) (s.max ||= {})[f] = r[f];
    const k = r.level || 'default';
    if (typeof r.score === 'number' && r.score > (s.best[k] ?? -1)) { out.best = s.best[k] != null; s.best[k] = r.score; }
    checkChal(g, gameId, r, out);
    checkAch(g, gameId, r, out);
  });
  return out;
}

export const stats = (gameId) => get().stats?.[gameId] || { played: 0, won: 0, best: {} };
export function resetStats(gameId) { put((g) => { delete g.stats[gameId]; }); }
export const dailyResult = (gameId, day = dateKey()) => get().daily?.[gameId]?.[day] || null;
export const dailySolved = (gameId) => Object.values(get().daily?.[gameId] || {}).filter((r) => r?.won).length;

// ------------------------------------------------------------------ play time (Game Booster's "Play time")
/** Adds time spent with a game on screen (the hub calls this while a game is open, not paused and visible). */
export function addPlayTime(gameId, ms) {
  if (!(ms > 0)) return;
  const day = dateKey();
  put((g) => { const d = ((g.time ||= {})[day] ||= {}); d[gameId] = Math.round((d[gameId] || 0) + ms); prune(g); });
}
/** Play time for each of the last `n` days, oldest first: [{ day, date, ms, games: { [id]: ms } }]. */
export function playTime(n = 7) {
  const tm = get().time || {}, out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const games = tm[dateKey(d)] || {};
    out.push({ day: dateKey(d), date: d, ms: sum(Object.values(games)), games });
  }
  return out;
}

// ------------------------------------------------------------------ saved games
// A save is wrapped with when it was made and its level, so Continue playing can list it without loading the game.
const isWrap = (v) => v && typeof v === 'object' && v._gc === 1;
export const saveKey = (gameId, daily) => (daily ? gameId + '@daily' : gameId);
export const save = (key, state, meta = {}) => put((g) => { if (state == null) delete g.saves[key]; else g.saves[key] = { _gc: 1, s: state, at: Date.now(), ...meta }; });
export const load = (key) => { const v = get().saves?.[key]; return isWrap(v) ? v.s : v ?? null; };
/** The wrapper of a save ({ s, at, level, day, info }) or null. A daily save from another day is gone. */
export function saved(key) {
  const v = get().saves?.[key];
  if (v == null) return null;
  const w = isWrap(v) ? v : { s: v, at: 0 };
  return w.day && w.day !== dateKey() ? null : w;
}
/** Games in progress, newest first: [{ key, id, daily, level, at, info }] (a solved daily's leftovers are skipped). */
export function savedGames() {
  return Object.keys(get().saves || {}).map((key) => {
    const w = saved(key), [id, d] = key.split('@');
    if (!w || !GAMES.some((x) => x.id === id) || (d === 'daily' && dailyResult(id)?.won)) return null;
    return { key, id, daily: d === 'daily', level: w.level, at: w.at || 0, info: w.info || null };
  }).filter(Boolean).sort((a, b) => b.at - a.at);
}

export const pref = (gameId, k) => get().prefs?.[gameId]?.[k];
export const setPref = (gameId, k, v) => put((g) => { ((g.prefs ||= {})[gameId] ||= {})[k] = v; });
export const profile = () => get().profile || {};
export const setProfile = (p) => put((g) => { g.profile = { ...(g.profile || {}), ...p }; });

// ------------------------------------------------------------------ dailies and streaks
const dailyIds = () => GAMES.filter((x) => x.daily).map((x) => x.id);
/** Today's daily puzzles: [{ id, name, solved, ms }] (name in the UI language). */
export function todayPuzzles(day = dateKey()) {
  return GAMES.filter((x) => x.daily).map((x) => { const r = dailyResult(x.id, day); return { id: x.id, name: t(x.name), solved: !!r?.won, ms: r?.won ? r.ms ?? null : null }; });
}
const wonDays = (g) => new Set(Object.values(g.daily || {}).flatMap((d) => Object.entries(d).filter(([, r]) => r?.won).map(([k]) => k)));
/** Days in a row (ending today or yesterday) with at least one daily puzzle solved, across all games. */
export function streak() {
  const days = wonDays(get());
  const d = new Date();
  if (!days.has(dateKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
/** The longest run of days with a daily puzzle solved. */
export function bestStreak(g = get()) {
  const days = [...wonDays(g)].sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    const d = parseDateKey(k);
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
/** Whether a daily puzzle was solved on each of the last `n` days (oldest first), for the streak dots. */
export function recentDays(n = 7) {
  const days = wonDays(get()), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ day: dateKey(d), date: d, won: days.has(dateKey(d)) }); }
  return out;
}
/** Totals for the profile, with a player level from experience points (wins, dailies and achievements). */
export function totals() {
  const g = get(), s = Object.values(g.stats || {});
  const played = sum(s.map((x) => x.played)), won = sum(s.map((x) => x.won)), ach = Object.keys(g.ach || {}).filter(achById).length;
  const dailies = sum(Object.values(g.daily || {}).map((d) => Object.values(d).filter((r) => r?.won).length));
  const xp = played * 5 + won * 20 + dailies * 30 + ach * 50;
  const level = Math.floor(Math.sqrt(xp / 60)) + 1, from = 60 * (level - 1) ** 2, to = 60 * level ** 2;
  return { played, won, ach, achTotal: ACHIEVEMENTS.length, streak: streak(), bestStreak: bestStreak(g), dailies, xp, level, levelPct: (xp - from) / (to - from), toNext: to - xp };
}
