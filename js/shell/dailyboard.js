// Daily Board: One UI's ambient full-screen mode for Galaxy tablets (iOS calls it StandBy): a photo frame or the
// animated wallpaper with a big clock, the date, weather, the next event and music controls, then swipe for a big
// clock, the calendar and two widgets. Night mode turns it dim red after a set hour; it keeps the screen awake.
// This file stays light (it loads with every new tab): settings, the Quick panel tile, the Finder command, the
// Settings section and the "start after N minutes on the Lock screen" timer. The board itself is in
// dailyboard-ui.js, loaded when it opens. Prefs live in store key `dailyBoard`, photos in IndexedDB as
// `dailyboard:<id>` (core/blobs.js).
import { registerTile, registerCommand, registerSettingsSection } from '../core/hooks.js';
import { addIcons } from '../core/icons.js';
import { t, addStrings } from '../core/i18n.js';
import { store } from '../core/store.js';

addIcons({
  dailyBoard: '<rect x="3" y="3.5" width="18" height="13" rx="2.5"/><path d="M12 16.5v4M8.5 20.5h7"/><path d="m6.5 13.5 3.2-3.4 2.4 2.4 1.6-1.6 3.8 2.6"/><circle cx="15.5" cy="7.6" r="1.3"/>',
});

export const PAGES = ['photo', 'clock', 'calendar', 'widgets'];
export const DB_DEFAULTS = {
  source: 'wallpaper', // wallpaper | photos (falls back to the wallpaper while there are none)
  photos: [], // ids of pictures stored as `dailyboard:<id>`
  interval: 15, // seconds per photo
  clock: 'digital', // digital | analog
  font: 'outfit', // one of the Lock screen clock fonts (lock.js CLOCK_FONTS)
  widgets: ['weather', 'calendar-month'],
  night: true, // dim red light between nightFrom and nightTo (hours)
  nightFrom: 22,
  nightTo: 7,
  awake: true, // keep the screen on (Screen Wake Lock)
  idleMin: 0, // start by itself after this many minutes on the Lock screen; 0 = never
  page: 'photo', // the page it opens on (the last one shown)
};
export const prefs = () => ({ ...DB_DEFAULTS, ...(store.get('dailyBoard') || {}) });
export const savePrefs = (patch) => store.set('dailyBoard', { ...(store.get('dailyBoard') || {}), ...patch });

export const isBoardOpen = () => !!document.querySelector('.db:not(.closing)');
export const openDailyBoard = (opts) => import('./dailyboard-ui.js').then((m) => m.openBoard(opts));
export const closeDailyBoard = () => import('./dailyboard-ui.js').then((m) => m.closeBoard());

// ——— Quick panel, Finder, Settings ———
registerTile({
  id: 'dailyboard',
  icon: 'dailyBoard',
  order: 58,
  label: () => t('db.title'),
  on: isBoardOpen,
  toggle() {
    // the panel closes first (returning true), then the board fades in
    setTimeout(() => openDailyBoard(), 220);
    return true;
  },
});

const WORDS = ['daily board', 'dailyboard', 'standby', 'stand by', 'photo frame', 'اللوحة اليومية', 'لوحة يومية', 'إطار الصور'];
registerCommand('dailyboard', (q, lower, done) => {
  const s = lower.trim();
  if (s.length < 4 || !WORDS.some((w) => w === s || (w.startsWith(s) && s.length >= 5))) return [];
  return [{ icon: 'dailyBoard', title: t('db.cmd'), sub: t('db.cmdSub'), run: () => { done?.(); openDailyBoard(); } }];
});

registerSettingsSection({
  id: 'dailyboard',
  icon: 'dailyBoard',
  bg: '#2f3a57',
  title: 'db.title',
  sub: 'db.setSub',
  after: 'lock',
  render: (body, ctx, page) => import('./dailyboard-ui.js').then((m) => m.settingsPage(body, ctx, page)),
});

// ——— start by itself on an idle Lock screen ———
let lastInput = Date.now();
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => (lastInput = Date.now()), { capture: true, passive: true });

/**
 * Opens the board when the Lock screen has been showing, untouched, for `idleMin` minutes. Runs every 20 s; tests
 * call it with a fake `now`. Returns true when it opened the board.
 */
export function idleTick(now = Date.now()) {
  const p = prefs();
  if (!p.idleMin || isBoardOpen() || document.hidden) return false;
  if (!document.body.classList.contains('locked') || document.documentElement.classList.contains('onb-pending') || document.querySelector('.aod')) return false;
  if (now - lastInput < p.idleMin * 60e3) return false;
  openDailyBoard({ auto: true });
  return true;
}
setInterval(idleTick, 20e3);

addStrings({
  en: {
    'db.title': 'Daily Board',
    'db.setSub': 'Photos · Clock · Widgets',
    'db.cmd': 'Start Daily Board',
    'db.cmdSub': 'Photos, clock and widgets full screen',
  },
  ar: {
    'db.title': 'اللوحة اليومية',
    'db.setSub': 'الصور · الساعة · الأدوات',
    'db.cmd': 'بدء اللوحة اليومية',
    'db.cmdSub': 'الصور والساعة والأدوات بملء الشاشة',
  },
});
