// Extension points the shell reads, so an app can plug into Finder, the Quick Panel and the Lock screen
// from its own file instead of editing the shell modules.
//
// registerCommand(id, (q, lower, done) => [{ icon, title, sub, run(e), score?, answer? }], { priority }?)
//   Finder quick commands and instant answers ("drink 500ml", "took vitamin d"). Called on every keystroke
//   with the trimmed query; return [] fast when it doesn't match. run() should close Finder itself
//   (import { closeFinder } from '../shell/finder.js') or call the `done` helper passed as 3rd argument.
//   `lower` is the query in lower case with Arabic-Indic digits as 0-9 and Arabic short vowels dropped.
//   Ranking: a row may say how sure it is with `score` (0–100: ~95 an exact name or a complete command, ~60 a
//   partial match, ~30 a catch-all such as "Play “…”" that searches for whatever was typed). Rows without one are
//   scored by Finder from how well their title matches the query. `priority` (default 0) is added to every row of
//   that command to break ties. Finder lists command rows best first.
//
// registerTile({ id, icon, label: () => string, on: () => bool, toggle(), order })
//   Extra small tiles in the Quick Panel (after the built-in ones, sorted by order).
//
// registerLockWidget(id, { name: 'key' | { en, ar }, render: async ({ locked, private }) => Element | null, private: true })
//   Lock screen widget chips (class `lk-w`). The Lock screen calls render({ locked: true, private }) where `private`
//   says whether a screen-lock PIN guards it (Settings › Lock screen › Screen lock type); a chip hides names and
//   amounts while `locked` (and may show them when `private` is false, since anyone can swipe up anyway). Chips
//   flagged `private: true` are the ones that matter most. The user picks and orders them in Settings › Lock screen ›
//   Widgets (setting `lockWidgets`, in display order).
//
// onUnlock(fn) -> off
//   fn({ pin }) runs each time this tab's Lock screen goes away (`pin`: the PIN was asked). Routines, the Now Brief…

// registerSettingsSection({ id, icon, bg, title: 'key', sub: 'key', after: '<section id>', render(body, ctx, page) })
//   A top-level Settings section (One UI row with a coloured round icon) placed right after the built-in section
//   `after` (wallpaper, display, home, lock, search, notifications, weather, general, backup, shortcuts, about).
//   render() fills the pushed page and may return a cleanup. Opening Settings with params { page: id } goes there
//   ({ page, find: '<row label>' } also scrolls to that row and flashes it). Finder's Settings search renders each page
//   once off-screen to collect its row and subheader labels, with `ctx.indexing === true`: don't open dialogs or start
//   timers from render() itself (do that on clicks), and skip heavy work when indexing.
//
// registerMedia({ id, state: () => null | { title, sub, art (img URL) | icon, color, playing }, toggle(), next(), prev(),
//   open(), subscribe(fn) -> off })
//   A media source for the Quick Panel media card (e.g. Samsung Music). When a registered source returns a state,
//   the card shows the most recent one instead of the ambient sounds; call the subscribed fn when it changes.

const commands = new Map();
const tiles = new Map();
const lockWidgets = new Map();

export const registerCommand = (id, fn, { priority = 0 } = {}) => commands.set(id, { fn, priority });
// Arabic-Indic digits → 0-9, no Arabic short vowels or tatweel ("مؤقت ١٠" → "مؤقت 10", "شغّل" → "شغل")
const foldLower = (s) => s.toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) % 16);
/**
 * Every registered command's rows for `q`, in registration order. Each row gets `cmd` (the command id) and `prio` (its
 * priority); Finder sorts them by score. Returns plain arrays synchronously (tests filter them by icon).
 */
export function runCommands(q, done, lower = foldLower(q)) {
  const out = [];
  for (const [id, { fn, priority }] of commands) {
    try {
      for (const r of fn(q, lower, done) || []) out.push(Object.assign(r, { cmd: id, prio: priority }));
    } catch (e) {
      console.warn('command', id, e);
    }
  }
  return out;
}

export const registerTile = (tile) => tiles.set(tile.id, { order: 50, ...tile });
export const getTiles = () => [...tiles.values()].sort((a, b) => a.order - b.order);

export const registerLockWidget = (id, w) => lockWidgets.set(id, { id, ...w });

const unlockFns = new Set();
export const onUnlock = (fn) => (unlockFns.add(fn), () => unlockFns.delete(fn));
/** Called by the Lock screen (js/shell/lock.js) once it is gone. */
export function emitUnlock(info = {}) {
  for (const fn of [...unlockFns]) {
    try {
      fn(info);
    } catch (e) {
      console.warn('onUnlock', e);
    }
  }
}
export const getLockWidget = (id) => lockWidgets.get(id);
export const getLockWidgets = () => [...lockWidgets.values()];

const media = new Map();
const mediaListeners = new Set();
export function registerMedia(src) {
  media.set(src.id, src);
  src.subscribe?.(() => mediaListeners.forEach((fn) => fn()));
  mediaListeners.forEach((fn) => fn());
}
/** The registered source that currently has something to show (playing first), or null. */
export function activeMedia() {
  let best = null;
  for (const src of media.values()) {
    const st = src.state?.();
    if (st && (!best || (st.playing && !best.st.playing))) best = { src, st };
  }
  return best;
}
export const onMediaChange = (fn) => (mediaListeners.add(fn), () => mediaListeners.delete(fn));

const settingsSections = new Map();
export const registerSettingsSection = (sec) => settingsSections.set(sec.id, sec);
export const getSettingsSections = () => [...settingsSections.values()];
