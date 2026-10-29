// Gaming Hub's action for Modes and Routines ("Then"): Open today's puzzle — the next daily puzzle not solved yet, or a
// chosen game's — so a "Morning coffee" routine can start the day's Sudoku. It opens the app, so it runs in a page.
// Imported by js/apps/games.js.
import { registerAction, RunError } from '../routines/actions.js';
import { addStrings, t } from '../core/i18n.js';
import { openApp } from '../core/apps.js';
import { GAMES } from './index.js';
import { todayPuzzles } from './center.js';

registerAction({
  id: 'games.daily', name: 'games.ra.daily', icon: 'gmPuzzle', color: '#5b3df5', cat: 'apps', out: 'games.ra.out',
  params: [{ key: 'game', type: 'enum', label: 'games.ra.game', def: 'next', opts: [['next', 'games.ra.next'], ...GAMES.filter((g) => g.daily).map((g) => [g.id, g.name])] }],
  sub: (p, F) => F.opt('games.daily', 'game', p.game || 'next'),
  run(ctx, p) {
    if (!ctx.page) throw new RunError('routines.err.page');
    const list = todayPuzzles();
    // all of today's solved: the hub's Home, with its "come back tomorrow" cards
    const g = p.game && p.game !== 'next' ? list.find((x) => x.id === p.game) : list.find((x) => !x.solved);
    openApp('games', { params: g ? { section: g.id, daily: true } : { section: 'home' } });
    return g ? g.name : t('games.app');
  },
});

addStrings({
  en: { 'games.ra.daily': 'Open today’s puzzle', 'games.ra.game': 'Puzzle', 'games.ra.next': 'Next unsolved puzzle', 'games.ra.out': 'Puzzle' },
  ar: { 'games.ra.daily': 'فتح أحجية اليوم', 'games.ra.game': 'الأحجية', 'games.ra.next': 'الأحجية التالية غير المحلولة', 'games.ra.out': 'الأحجية' },
});
