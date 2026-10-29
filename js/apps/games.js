// Gaming Hub (Samsung Gaming Hub on One UI): Sudoku, Minesweeper, Solitaire, Chess and 2048 with daily puzzles that
// are the same for everyone, streaks, challenges, achievements and play time. This file loads with every new tab, so it
// only registers the app, its widgets (Today's puzzles, Continue playing), the Lock screen chip and the Finder commands
// (`play sudoku`, `daily puzzle`); the hub and the games load from js/games/ when the app opens.
import { h, everyMinute } from '../core/util.js';
import { addIcons, icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerLockWidget } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t } from '../core/i18n.js';
import { GAMES } from '../games/index.js';
import * as GC from '../games/center.js';
import { gameIcon } from '../games/art.js';
import { fmtTime, ltr } from '../games/kit.js';
import '../games/actions.js'; // Modes and Routines: Open today's puzzle

addIcons({
  gmGamepad: '<path d="M7.6 7h8.8a4.6 4.6 0 0 1 4.5 3.7l1 4.9a2.6 2.6 0 0 1-4.5 2.3L15 15.5H9l-2.4 2.4a2.6 2.6 0 0 1-4.5-2.3l1-4.9A4.6 4.6 0 0 1 7.6 7Z"/><path d="M8 9.8v3.4M6.3 11.5h3.4"/><circle cx="15.7" cy="10.4" r="1" fill="currentColor" stroke="none"/><circle cx="17.6" cy="12.6" r="1" fill="currentColor" stroke="none"/>',
  gmLibrary: '<rect x="4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8"/>',
  gmTrophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4.5M16.5 6h3a3 3 0 0 1-3 4.5M12 13.5V17M8.5 20h7M9.5 17h5"/>',
  gmFlame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.8-2.6-6.2-4.4-8.6-.4 2.2-1.6 3.6-3 4.2.3-2.6-.6-5.2-2.6-7.1-.2 3.9-3 6.1-3 10.5A6.5 6.5 0 0 0 12 21Z"/>',
  gmFlameFill: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.8-2.6-6.2-4.4-8.6-.4 2.2-1.6 3.6-3 4.2.3-2.6-.6-5.2-2.6-7.1-.2 3.9-3 6.1-3 10.5A6.5 6.5 0 0 0 12 21Z" fill="currentColor"/>',
  gmCrown: '<path d="M4 8l4 4 4-6 4 6 4-4-1.6 10H5.6z"/><path d="M6 21h12"/>',
  gmMine: '<circle cx="12" cy="12" r="5.6" fill="currentColor"/><path d="M12 3v18M3 12h18M5.6 5.6l2.4 2.4M18.4 5.6 16 8M5.6 18.4 8 16M18.4 18.4 16 16"/>',
  gmTile: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9.5 9.6a2.3 2.3 0 1 1 3.9 1.7L9.5 15h5"/>',
  gmShovel: '<path d="M14.5 9.5 5 19M13 4.5l6.5 6.5-3 3a3 3 0 0 1-4.2 0l-2.3-2.3a3 3 0 0 1 0-4.2z"/>',
  gmFlag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.8 4.2 2.8 4.3H5.5"/>',
  gmFlagFill: '<path d="M5.5 21V4" stroke-width="2.2"/><path d="M5.5 4h12l-3 4.5 3 4.5h-12z" fill="currentColor"/>',
  gmBolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  gmBulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.3 1.1 2.2h5c0-.9.3-1.6 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  gmEraser: '<path d="m8.5 20-4.2-4.2a1.8 1.8 0 0 1 0-2.5l8.8-8.8a1.8 1.8 0 0 1 2.5 0l4.4 4.4a1.8 1.8 0 0 1 0 2.5L11 20Z"/><path d="M8.5 20H20M9 9l6 6"/>',
  gmPencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  gmUndo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  gmCards: '<rect x="3.6" y="6.4" width="10" height="14" rx="2" transform="rotate(-12 8.6 13.4)"/><rect x="10.5" y="3.5" width="10" height="14" rx="2"/>',
  gmChart: '<path d="M5 20v-6M10 20V9M15 20v-9M20 20V5"/>',
  gmFlip: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M19.5 4v5h-5M4.5 20v-5h5"/>',
  gmMedal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 3.5 10.5 10M15.5 3.5 13.5 10M8 3.5h8"/>',
  gmPuzzle: '<path d="M5 8h3.3a2 2 0 1 1 3.4 0H15v3.3a2 2 0 1 1 0 3.4V18h-3.3a2 2 0 1 0-3.4 0H5v-3.3a2 2 0 1 0 0-3.4Z"/>',
  gmRocket: '<path d="M12 15.5 8.5 12C10 7 13.5 4 19.5 4.5 20 10.5 17 14 12 15.5Z"/><path d="M8.5 12 5 11.5l2.5-3.5h4M12 15.5l.5 3.5 3.5-2.5v-4"/><circle cx="15" cy="9" r="1.4"/><path d="M6.5 15.5c-1.5.5-2 2.5-2 4 1.5 0 3.5-.5 4-2"/>',
  gmLevels: '<path d="M5 20v-4M10 20v-8M15 20V8M20 20V4"/>',
  gmDot: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 3"/>',
});

const open = (params, from) => openApp('games', { from, params });
// level names for saved games, without loading the game modules
const LEVELS = { easy: 'games.lv.easy', medium: 'games.lv.medium', hard: 'games.lv.hard', expert: 'games.lv.expert', beginner: 'games.lv.beginner', intermediate: 'games.lv.intermediate', draw1: 'games.lv.draw1', draw3: 'games.lv.draw3', 1: 'games.lv.c1', 2: 'games.lv.c2', 3: 'games.lv.c3', 4: 'games.lv.c4', 5: 'games.lv.c5', '2p': 'games.lv.twoPlayers' };
const nameOf = (id) => t(GAMES.find((g) => g.id === id)?.name || id);
const days = (n) => (n === 1 ? t('games.days1') : t('games.days', { n }));
const gic = (id, cls = '') => h('span', { class: ['gm-ic', cls], html: gameIcon(id) });

registerApp({
  id: 'games',
  name: 'games.app',
  icon: {
    bg: 'linear-gradient(145deg, #8a5cff 0%, #5b3df5 48%, #2b2fd0 100%)',
    glyph: '<path d="M7.6 7h8.8a4.6 4.6 0 0 1 4.5 3.7l1 4.9a2.6 2.6 0 0 1-4.5 2.3L15 15.5H9l-2.4 2.4a2.6 2.6 0 0 1-4.5-2.3l1-4.9A4.6 4.6 0 0 1 7.6 7Z"/><path d="M8 9.8v3.4M6.3 11.5h3.4"/><circle cx="15.7" cy="10.4" r=".9" fill="#fff"/><circle cx="17.6" cy="12.6" r=".9" fill="#fff"/>',
  },
  keywords: ['games', 'gaming hub', 'game launcher', 'game booster', 'puzzle', 'sudoku', 'minesweeper', 'solitaire', 'chess', '2048', 'ألعاب', 'مركز الألعاب', 'سودوكو', 'كاسحة الألغام', 'سوليتير', 'شطرنج', 'أحجية'],
  render: (ctx) => import('../games/ui.js').then((m) => m.render(ctx)),
  search(q) {
    const ql = q.trim().toLowerCase();
    if (ql.length < 2) return [];
    return GAMES.filter((g) => nameOf(g.id).toLowerCase().includes(ql) || g.id.includes(ql)).map((g) => ({
      title: nameOf(g.id),
      sub: g.daily ? `${t('games.play')} · ${t('games.daily')}` : t('games.play'),
      onOpen: () => open({ section: g.id }),
    }));
  },
});

// ——— Finder: "play sudoku", "daily puzzle" ———
const ALIASES = {
  sudoku: ['sudoku', 'سودوكو'],
  minesweeper: ['minesweeper', 'mines', 'mine sweeper', 'كاسحة الألغام', 'كاسحة الالغام', 'الألغام'],
  solitaire: ['solitaire', 'klondike', 'cards', 'سوليتير', 'كلوندايك', 'الورق'],
  chess: ['chess', 'شطرنج', 'الشطرنج'],
  g2048: ['2048'],
};
function findGame(s) {
  s = s.trim().toLowerCase();
  return GAMES.find((g) => [...ALIASES[g.id], nameOf(g.id).toLowerCase()].some((a) => a === s || (s.length > 2 && a.startsWith(s))));
}
const DAILY = /^(daily|daily puzzles?|today'?s puzzles?|puzzle of the day|daily challenge|أحجية اليوم|الأحجية اليومية|أحاجي اليوم|لغز اليوم)$/i;
registerCommand('games', (q, lower, done) => {
  const out = [], s = q.trim();
  const m = /^(?:play|العب|إلعب|لعب)\s+(.+)$/i.exec(s);
  const g = m && findGame(m[1]);
  if (g) out.push({ icon: 'gmGamepad', title: t('games.cmdPlay', { game: nameOf(g.id) }), sub: t('games.app'), run: () => { done?.(); open({ section: g.id }); } });
  if (DAILY.test(s)) {
    const list = GC.todayPuzzles(), next = list.find((p) => !p.solved), solved = list.filter((p) => p.solved).length;
    out.push({
      icon: 'gmPuzzle',
      title: next ? t('games.cmdDaily', { game: next.name }) : t('games.cmdAllDone'),
      sub: t('games.cmdDailySub', { n: ltr(`${solved}/${list.length}`), d: days(GC.streak()) }),
      run: () => { done?.(); open(next ? { section: next.id, daily: true } : { section: 'home' }); },
    });
  }
  return out;
});

// ——— Lock screen: today's puzzles and the streak ———
registerLockWidget('games', {
  name: 'games.lockName',
  render: async () => {
    const list = GC.todayPuzzles(), solved = list.filter((p) => p.solved).length, n = GC.streak();
    return h('span', { class: 'lk-w gm-lk', title: t('games.today') },
      h('span', { html: icon(solved === list.length ? 'checkCircle' : 'gmPuzzle', 18) }),
      h('span', null, ltr(`${solved}/${list.length}`)),
      n ? h('span', { class: 'gm-lk-flame', html: icon('gmFlameFill', 16) }) : null,
      n ? h('span', null, String(n)) : null);
  },
});

// ——— widgets ———
/** Redraws on game changes and when the day turns (a new set of daily puzzles). */
function live(draw) {
  let day = GC.dateKey();
  draw();
  const off = store.on('games', draw);
  const stop = everyMinute(() => { const d = GC.dateKey(); if (d !== day) { day = d; draw(); } });
  return () => { off(); stop(); };
}

registerWidget({
  id: 'games-today',
  name: 'games.w.today',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'games',
  onClick: (item, el) => open({ section: 'home' }, el),
  render(el, { size }) {
    el.classList.add('wg-games');
    return live(() => {
      const list = GC.todayPuzzles(), n = GC.streak(), solved = list.filter((p) => p.solved).length;
      const rows = h('div', { class: 'wgm-rows' }, list.map((p) => h('button', {
        class: ['wgm-row', p.solved && 'done'], dataset: { g: p.id },
        onClick: (e) => { e.stopPropagation(); open({ section: p.id, daily: true }, el); },
      }, gic(p.id), h('span', { class: 'wgm-tt' }, h('b', null, p.name), size === 'm' ? h('small', null, p.solved ? (p.ms != null ? t('games.solvedIn2', { time: fmtTime(p.ms) }) : t('games.solved')) : t('games.notSolved')) : null),
      p.solved ? h('span', { class: 'wgm-ok', html: icon('check', 14) }) : h('span', { class: 'wgm-play' }, t('games.play')))));
      const head = h('div', { class: 'wg-head wgm-head' }, h('span', { html: icon('gmPuzzle', 16) }), h('span', null, t('games.today')));
      if (size === 'm') {
        el.replaceChildren(h('div', { class: 'wgm-m' },
          h('div', { class: 'wgm-col' }, head, rows),
          h('div', { class: ['wgm-sbig', n && 'on'] },
            h('div', { class: 'wgm-sn' }, h('span', { html: icon('gmFlameFill', 24) }), h('b', null, String(n))),
            h('span', null, n === 1 ? t('games.dayStreak1w') : t('games.dayStreakW')),
            h('div', { class: 'wgm-week' }, GC.recentDays(7).map((d) => h('i', { class: [d.won && 'won', d.day === GC.dateKey() && 'today'] }))),
            h('small', null, ltr(`${solved}/${list.length}`) + ' ' + t('games.solved')))));
        return;
      }
      el.replaceChildren(head, rows, h('div', { class: ['wgm-streak', n && 'on'] }, h('span', { html: icon('gmFlameFill', 15) }), h('span', null, n ? days(n) : t('games.noStreak'))));
    });
  },
});

registerWidget({
  id: 'games-continue',
  name: 'games.continue',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'games',
  onClick: (item, el) => open({ section: 'library' }, el),
  render(el, { size }) {
    el.classList.add('wg-games');
    return live(() => {
      const saves = GC.savedGames().slice(0, size === 'm' ? 3 : 1);
      const sub = (s) => {
        const i = s.info || {}, parts = [s.daily ? t('games.daily') : LEVELS[s.level] ? t(LEVELS[s.level]) : ''];
        if (i.ms != null) parts.push(fmtTime(i.ms));
        else if (i.score != null) parts.push(t('games.scoreN', { n: i.score }));
        return parts.filter(Boolean).join(' · ');
      };
      const bar = (s) => (s.info?.pct != null ? h('span', { class: 'wgm-bar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, s.info.pct)) * 100) + '%' } })) : null);
      const go = (s) => (e) => { e.stopPropagation(); open({ section: s.id, daily: s.daily }, el); };
      const head = h('div', { class: 'wg-head wgm-head' }, h('span', { html: icon('gmGamepad', 16) }), h('span', null, t('games.continue')));
      if (!saves.length) {
        el.replaceChildren(head, h('div', { class: 'wgm-empty' }, h('span', null, t('games.noProgress')), h('button', { class: 'wgm-play', onClick: (e) => { e.stopPropagation(); open({ section: 'library' }, el); } }, t('games.play'))));
        return;
      }
      if (size === 's') {
        const s = saves[0];
        el.replaceChildren(h('button', { class: 'wgm-one', dataset: { g: s.id }, onClick: go(s) }, gic(s.id, 'lg'), h('b', null, nameOf(s.id)), h('small', null, sub(s)), bar(s), h('span', { class: 'wgm-resume' }, h('span', { html: icon('play', 12) }), t('games.resume'))));
        return;
      }
      el.replaceChildren(head, h('div', { class: 'wgm-rows' }, saves.map((s) => h('button', { class: 'wgm-row', dataset: { g: s.id }, onClick: go(s) },
        gic(s.id), h('span', { class: 'wgm-tt' }, h('b', null, nameOf(s.id)), h('small', null, sub(s)), bar(s)), h('span', { class: 'wgm-play' }, t('games.resume'))))));
    });
  },
});

addStrings({
  en: {
    'games.app': 'Gaming Hub',
    'games.sudoku': 'Sudoku',
    'games.minesweeper': 'Minesweeper',
    'games.solitaire': 'Solitaire',
    'games.chess': 'Chess',
    'games.g2048': '2048',
    'games.lv.easy': 'Easy',
    'games.lv.medium': 'Medium',
    'games.lv.hard': 'Hard',
    'games.lv.expert': 'Expert',
    'games.lv.beginner': 'Beginner',
    'games.lv.intermediate': 'Intermediate',
    'games.lv.draw1': 'Draw 1',
    'games.lv.draw3': 'Draw 3',
    'games.lv.c1': 'Level 1 · Beginner',
    'games.lv.c2': 'Level 2 · Novice',
    'games.lv.c3': 'Level 3 · Intermediate',
    'games.lv.c4': 'Level 4 · Advanced',
    'games.lv.c5': 'Level 5 · Expert',
    'games.lv.twoPlayers': 'Two players',
    'games.daily': 'Daily puzzle',
    'games.today': 'Today’s puzzles',
    'games.solved': 'Solved',
    'games.solvedIn2': 'Solved in {time}',
    'games.notSolved': 'Not solved yet',
    'games.play': 'Play',
    'games.resume': 'Resume',
    'games.continue': 'Continue playing',
    'games.noProgress': 'No games in progress',
    'games.days': '{n} days',
    'games.days1': '1 day',
    'games.dayStreakW': 'day streak',
    'games.dayStreak1w': 'day streak',
    'games.noStreak': 'No streak yet',
    'games.scoreN': 'Score {n}',
    'games.w.today': 'Today’s puzzles',
    'games.lockName': 'Today’s puzzles (Gaming Hub)',
    'games.cmdPlay': 'Play {game}',
    'games.cmdDaily': 'Play today’s {game}',
    'games.cmdAllDone': 'All of today’s puzzles are solved',
    'games.cmdDailySub': 'Daily puzzles {n} · Streak {d}',
  },
  ar: {
    'games.app': 'مركز الألعاب',
    'games.sudoku': 'سودوكو',
    'games.minesweeper': 'كاسحة الألغام',
    'games.solitaire': 'سوليتير',
    'games.chess': 'شطرنج',
    'games.g2048': '2048',
    'games.lv.easy': 'سهل',
    'games.lv.medium': 'متوسط',
    'games.lv.hard': 'صعب',
    'games.lv.expert': 'خبير',
    'games.lv.beginner': 'مبتدئ',
    'games.lv.intermediate': 'متوسط',
    'games.lv.draw1': 'سحب ورقة واحدة',
    'games.lv.draw3': 'سحب 3 أوراق',
    'games.lv.c1': 'المستوى 1 · مبتدئ',
    'games.lv.c2': 'المستوى 2 · هاوٍ',
    'games.lv.c3': 'المستوى 3 · متوسط',
    'games.lv.c4': 'المستوى 4 · متقدم',
    'games.lv.c5': 'المستوى 5 · خبير',
    'games.lv.twoPlayers': 'لاعبان',
    'games.daily': 'الأحجية اليومية',
    'games.today': 'أحاجي اليوم',
    'games.solved': 'تم الحل',
    'games.solvedIn2': 'حُلّت في {time}',
    'games.notSolved': 'لم تُحل بعد',
    'games.play': 'العب',
    'games.resume': 'استئناف',
    'games.continue': 'متابعة اللعب',
    'games.noProgress': 'لا توجد ألعاب قيد التقدم',
    'games.days': '{n} يوم',
    'games.days1': 'يوم واحد',
    'games.dayStreakW': 'أيام متتالية',
    'games.dayStreak1w': 'يوم متتالٍ',
    'games.noStreak': 'لا توجد سلسلة بعد',
    'games.scoreN': 'النقاط {n}',
    'games.w.today': 'أحاجي اليوم',
    'games.lockName': 'أحاجي اليوم (مركز الألعاب)',
    'games.cmdPlay': 'العب {game}',
    'games.cmdDaily': 'العب {game} لليوم',
    'games.cmdAllDone': 'تم حل كل أحاجي اليوم',
    'games.cmdDailySub': 'الأحاجي اليومية {n} · السلسلة {d}',
  },
});

// other surfaces (a Now Brief, Routines…) can read these without opening the app
export const todayPuzzles = GC.todayPuzzles;
export const streak = GC.streak;
export const openGames = (section, daily = false) => open({ section, daily });
