# Bloom Tab — project guide for Claude

Read this first in every session. It records what the extension does, how it is built, how it is tested and what
is left to do. Keep it current: when a feature lands, update **Roadmap**, **Features** and **Status**.

Bloom Tab is a Chrome MV3 extension that replaces the New Tab page with a **Samsung One UI 9–style** home screen:
Lock screen with the Now Bar, Home screen with widgets and folders, Apps screen, Finder, Quick Panel, Edge panel,
One UI pop-up app windows and built-in apps. No accounts and no servers of our own; everything stays on the device.

- The sister project **Liquid Tab** (`../ios-ext`, iOS 27 style, ~117K lines, v1.2.0) is the feature reference.
  The goal is **feature parity with Liquid Tab, rebuilt the One UI way** (see Roadmap): same capabilities, but
  Samsung's names, layouts and behaviour (Samsung Health instead of Apple Health, Quick Panel instead of Control
  Center, pop-up view instead of iPad windows…). Its `CLAUDE.md` explains every feature; its code under
  `../ios-ext/js` is a good source for pure logic (engines, parsers, models) that can be ported.
- Never copy Liquid Tab's *look*: everything here must look and behave like Samsung's One UI apps on a Galaxy
  phone/tablet. When in doubt, copy Samsung's behaviour, wording and layout.
- The user writes short, informal English, sometimes with Arabic. **Arabic (RTL) must always work.**
- Repo: `git@github.com:aminalakhsham/Bloom-Tab-Samsung-One-UI-New-Tab-Widgets-Dashboard.git` (branch `main`).
  Commit and push only when the user asks; `dist/`, `.dev/shots/`, `.dev/node_modules/` and `store/screens/` (raw
  captures for the store images) are not committed.

## Ground rules

1. **No build step.** Plain ES modules loaded straight from `js/`. CSP is the MV3 default (`script-src 'self'`):
   no inline scripts, no `eval`/`new Function`, no remote code, no CDNs. Fonts are bundled in `fonts/`.
2. **Privacy is part of the product.** Ask the user before adding any network service. New permissions should be
   *optional* (`optional_permissions` in manifest.json) and requested with `ensure()` from `js/core/perm.js` when the
   user turns the feature on.
3. **Two UI languages: English and Arabic.** Every visible string goes through `t()` and is registered in both
   (`addStrings({ en, ar })`, see i18n). `python3 scripts/check_i18n.py` must report 0 problems.
4. **Light and dark, Reduce motion, blur on/off, RTL** must all keep working. Test new UI in all of them.
5. **Popups and menus stay inside the screen**: use `menu()`, `dialog()`, `choose()`, `prompt()` from `js/core/ui.js`.
6. **Anything behind the Lock screen** waits for `unlock()` from `js/shell/lock.js` (it resolves once unlocked).
   Never show app content on a locked screen.
7. Comments are full sentences that explain *why*. Match the surrounding code: 2-space indent, single quotes,
   semicolons, `h()` for DOM, dense one-liners where the file already uses them.

## Architecture

**Boot** (`newtab.html` → `js/main.js`): `store.init()` loads all of `chrome.storage.local` into memory →
`setLang(detectLang())` → `applyTheme()` → imports every module in `MODULES` (apps and widgets register themselves;
each import is isolated, a broken app only logs an error) → `initWallpaper()`, `initLock()` (decides whether the tab
starts locked), `initStatusbar/Home/Drawer/Finder/QuickPanel/Edge/Keys()` → `window.__bootMs` (tests wait for it).
`newtab.html#open=<app>&s=<section>` opens an app after unlock with `params.section` (notification clicks).

**Layers in `newtab.html`**: `#wallpaper` (canvas/photo/dim), `#statusbar`, `#home`, `#drawer` (Apps screen),
`#finder`, `#edge`, `#app-layer` (app windows), `#quickpanel`, `#lock`, `#headsup` (banners), `#overlay-layer`
(menus, dialogs, toasts), `#screen-filters` (brightness, Eye comfort, flashlight).

**State** (`js/core/store.js`): every top-level key is its own `chrome.storage.local` entry (localStorage `bt:` prefix
outside the extension). `store.get/set/update/remove`, `store.on(key, fn)` (fires for other tabs' changes too, but
not for an identical value), `setting(name)`, `setSetting(name, v)`, `onSetting(name, fn)`, `session.get/set`
(chrome.storage.session), `trackUsage(id)`. New settings get a default in `DEFAULT_SETTINGS`; new top-level keys a
default in `DEFAULTS` (both in store.js). Binary data (pictures, audio) goes in IndexedDB through `js/core/blobs.js`
(`putBlob/getBlob/blobUrl/delBlob/listBlobs`, keys `<app>:<id>`), never in chrome.storage.

**Apps** (`js/core/apps.js`): `registerApp({ id, name, icon, keywords, size, hidden, launch, render, search })`.
- `name`: an i18n key. `icon`: `{ bg: '<css background>', glyph: '<24px svg paths>' }` or `{ html: () => svg }`.
- `size`: `'phone'` (default) or `'wide'` (tablet-width window; use for two-pane apps).
- `render(ctx)` builds the UI and may return a cleanup function, **or a promise of one**: big apps keep only their
  registration (name, icon, widgets, commands, search) in `js/apps/<id>.js` and lazy-load the UI:
  `render: (ctx) => import('../health/ui.js').then((m) => m.render(ctx))`. Heavy logic lives in `js/<id>/`.
- `ctx = { app, params, win, page(opts), push(opts), pop(), close(), depth }`. `page({ title, subtitle, actions,
  hero, className, render(body, page) })` replaces the stack; `push()` adds a sub-page with a back button (One UI
  collapsing large title when `hero: true`). Assign `ctx.setParams = (p) => …` to react when the open app is opened
  again (e.g. a notification click with `params.section`).
- `search(q)` → `[{ title, sub, onOpen }]` adds a section to Finder.
- **Multi window**: several windows can be open; `ctx.focused` is true while yours has the focus — **key handlers
  on `window`/`document` must return early when it's false** (or check `currentApp() === '<id>'`). `currentApp()` is
  the focused app (null when the Home screen has the focus). Full-screen overlays opt out of "desktop click"
  focus handling with `data-overlay` (the shell's overlays are listed in apps.js). Tests that maximize click the
  first `.app-handle-btn` (Full screen stays first in the DOM).

**Widgets** (`js/core/widgets.js`) — size text, icons and padding with container units (`.wg` is a size container),
e.g. `font-size: clamp(34px, min(22cqw, 30cqh), 120px)`, never fixed px only: boxes range from ~190×158 to ~340×300
for a 2×2 widget depending on the window; lists drop rows with `@container (max-height: …)` rather than overflow.
Never pass `null` to native `replaceChildren()/append()` (it becomes the text "null"); test in 24-hour time too.  `registerWidget({ id, name, sizes: ['s','m','l'], defaultSize, app, onClick,
configure: async (config) => newConfig, render(el, { size, item, config, setConfig }) })` → cleanup. `configure`
runs in the picker before adding and as "Widget settings" in the widget's menu; `addWidget(id, size, config)`. Per-frame work of a widget's own pauses with `onHomeHidden(fn)` (body.home-hidden,
`content-visibility: hidden`, while an opaque full-screen/split window, the Lock screen, the Daily Board or AOD
covers the Home screen). s = 2×2 cells, m = 4×2, l = 4×4. Classes in
shell.css: `.wg-head`, `.wg-big`, `.wg-sub`, `.wg-list`, `.wg-fill`. The widget picker lists every registered widget.

**Now Bar / live activities** (`js/core/activity.js`): `registerActivity(id, () => null | { icon, color, title, sub,
progress, app, params, actions: [{ icon, label, onClick, open: { app, params } }], priority, wave })`, polled once a
second by the Lock screen and Quick Panel (the Quick Panel hides the active media source's own activity).
`setBadge(appId, n)` (same module) sets an app icon badge (number, dot or off per setting `badges`).

**Extension points** (`js/core/hooks.js`), so apps never edit shell files:
- `registerCommand(id, (q, lower, done) => results, { priority })` — Finder quick commands / instant answers
  (`{ icon, title, sub, run(e), score }`; call `done()` to close Finder; a more specific match should return a
  higher `score` so catch-alls like Music's "play …" rank below "Play Sudoku").
- Settings rows are indexed for Finder by rendering pages off-screen with `ctx.indexing = true`: page renderers
  must not have side effects (no writes, no permission prompts) while indexing.
- `registerTile({ id, icon, label: () => text, on: () => bool, toggle(), order })` — Quick Panel tiles
  (return `true` from toggle to close the panel).
- `registerLockWidget(id, { name, render: async ({ locked, private }) => Element|null })` — Lock screen widget chips
  (class `lk-w`); they appear in Settings › Lock screen › widgets (reorderable). `private` is true while a PIN is
  set: then show no names, amounts or titles.
- `onUnlock(fn)` — runs after every unlock (Routines' "Unlocked" trigger can use it).
- **PIN** (`js/shell/pin.js`): `pinSet()`, `keypad()`, `tryPin()`, `lockPrivacy()`, `eraseEverything()` (the one
  correct way to erase all data: pictures, alarms and session first, storage last). `unlock()` waits for the PIN.
- `registerSettingsSection({ id, icon, bg, title, sub, after, render(body, ctx, page) })` — a top-level Settings
  section placed after the built-in section `after`; `openApp('settings', { params: { page: id } })` opens it.
- `registerMedia({ id, state: () => null | { title, sub, art, icon, color, playing }, toggle, next, prev, open,
  subscribe(fn) })` — a media source for the Quick Panel media card (wins over ambient sounds when it has a state).
- `addIcons({ name: '<paths>' })` in `js/core/icons.js` — register extra glyphs from your module.
- Focus sessions are logged in store key `focusLog` (`[{ start, end }]`, newest first) by the Quick Panel and SW.

**Notifications** (`js/core/notify.js`): `notify({ app, title, body, icon })` → store key `notifications` (Quick
Panel list, Lock screen, heads-up). System notifications come from the service worker.

**Service worker** (`background.js` + `js/bg/*`): `chrome.alarms` → system notification + entry in `notifications`.
`background.js` only routes Chrome's events and keeps the shell's `focus` alarm; `timer:`/`alarm:` are in
`bg/clock.js`, `reminder:` in `bg/reminder.js`, `event:`/`calsub:` in `bg/calendar.js`. Apps add their own module
`js/bg/<app>.js` using `js/bg/hub.js`: `onAlarm(kind, fn(rest))`, `onButton(kind, fn(rest, index))`,
`openTarget(kind, rest => ({ app, section }))`, `onMessage(type, fn(msg))` (pages: `chrome.runtime.sendMessage`),
`post(id, {…})`, `bgStrings({ en, ar })`, `scheduleAt()`, `IDLE_SECONDS` (chrome.idle has one detection interval
for the whole extension: always pass this). Then one `import './js/bg/<app>.js';` in background.js.
Ids are `<kind>:<rest>`; never touch alarms of another kind. The SW sleeps any time: keep state in storage.
Pages schedule with `scheduleAt(name, when)` / `cancelSchedule(name)` from `js/core/schedule.js`.

**i18n** (`js/core/i18n.js`): dotted keys, `addStrings({ en: { 'notes.new': 'New note' }, ar: { … } })` at the bottom
of each module, `t('key', { n })` replaces `{n}`. `tr(nameOrObj)` for `{ en, ar }` literals. `lang()`, `isRtl()`,
`locale()` (Arabic uses Latin digits: `ar-u-nu-latn`, like One UI). Formatting: `fmtTime`, `fmtHM`, `fmtPeriod`,
`fmtDate(d, intlOpts)`, `fmtRelative(ms)`, `weekdayNames()`, `use12h()`. Store/manifest text: `_locales/{en,ar}`.
Pick Arabic wording from `../ios-ext/js/lang/ar.js` when the English matches (it was reviewed).

**UI kit** (`js/core/ui.js`, CSS in `css/app.css`): `toast(msg, { action, onAction })`, `menu(at, items, { align })` (opens towards the inside of the
reading direction; `align: 'start' | 'end'` is logical),
`dialog({ title, message, content, actions })`, `confirm`, `prompt`, `choose` (radio list), `sw` (switch), `seg`
(segmented), `slider` (One UI thick slider), `row`/`switchRow`/`list`/`card`/`subheader`/`btn`/`iconBtn`, `swatches`.
Other classes: `.ou-fab`, `.ou-searchbox`, `.ou-chips/.ou-chip`, `.ou-tabs/.ou-tab`, `.ou-empty`, `.ou-input`.
DOM helpers in `js/core/util.js`: `h(tag, props, ...children)`, `$`, `$$`, `frag(html)`, `uid`, `debounce`,
`throttle`, `escapeHtml` (always escape user text put into `html:`), dates (`startOfDay`, `sameDay`), colours,
`readImage`, `pickFile`, `download`, `onLongPress`, `everySecond/everyMinute`, `toUrl`, `faviconUrl`, `isExt`.

**CSS**: `css/tokens.css` (design tokens: `--accent` from the wallpaper palette, `--surface*`, `--text*`, `--glass*`,
radii `--r-*`, `--ease`), `css/shell.css` (home, lock, panels, widgets), `css/app.css` (window + UI kit),
`css/apps/<id>.css` one per app, linked from `newtab.html`. Theme: `html[data-theme=dark]`. Prefer logical
properties (`inset-inline-start`, `margin-inline-end`, `text-align: start`) so RTL works without overrides.

**Permissions** today: storage, unlimitedStorage, topSites, search, alarms, notifications, contextMenus, favicon,
geolocation, offscreen, idle, activeTab, scripting, sidePanel; optional bookmarks, history, tabs, tabGroups,
sessions, downloads, downloads.open (and per-origin host access for .ics subscriptions). Commands: Alt+Shift+H add
to Home, Alt+Shift+Q Quick capture, Alt+Shift+L side panel. Hosts: Open-Meteo (weather) and Bing (daily wallpaper).

## How to add things

- **New app**: `js/apps/<id>.js` with `registerApp` (+ widgets, commands, search, lock widgets) and its strings;
  UI in `js/<id>/*.js` if it's big; `css/apps/<id>.css` linked in `newtab.html`; add the module to `MODULES` in
  `js/main.js`; background jobs in `js/bg/<id>.js` imported from background.js; a test `.dev/<id>.cjs` (and
  `.dev/<id>-*.mjs` for pure logic). The Apps screen lists every registered app automatically; the Home screen only
  shows what the user (or the first-run seed in `home.js seed()`) put there.
- **New widget / command / tile / lock widget / Settings section**: see Extension points. **New setting**: default
  in `DEFAULT_SETTINGS`, a row in the right `PAGES.<section>` of `js/apps/settings.js` (or your own registered
  section for a whole feature). App-specific settings belong
  inside the app (⋮ › Settings), as in One UI.
- **New stored data**: default in `DEFAULTS`; decide whether Export (Settings › Backup) should include it (it exports
  all of chrome.storage.local today).
- **Checklist when a feature is done**: English + Arabic strings, `check_i18n.py` clean, light/dark/RTL screenshots
  looked at, a dev test, this file updated (Roadmap status, Features).

## Testing

Dev tests drive the real extension in headless Chrome with Puppeteer (`.dev/node_modules`; if missing,
`cd .dev && npm i`; Chrome at `/usr/bin/google-chrome`).
- **Run one**: `.dev/run.sh .dev/<test>.cjs` (env `THEME=dark`, `UI=ar`, `W`/`H`, `OUT=<dir>`, `TIMEOUT`). It takes one
  of `CHROME_SLOTS` (default 3) lock slots, so parallel runs queue instead of overloading this 4-core machine.
  **Always run through run.sh**, never `node .dev/harness.cjs` directly.
- **Run everything**: `.dev/runall.sh [filter]` → `.dev/shots/runall/summary.txt` (one verdict line per run, sorted,
  with a passed/failed total) and logs; it runs `JOBS=3` suites at once (each still takes a Chrome slot).
  Plain-node tests are `.dev/*.mjs` (exit 1 on failure). A `.cjs` whose first line starts with `// triple` also runs
  in dark and Arabic; one whose first line mentions `run.sh --raw node` launches its own Chrome (e.g. a copy of the
  extension with an optional permission granted) and runall runs it that way.
- **Writing a test**: `module.exports = async ({ page, boot, ok, openApp, closeApp, click, clickText, text, texts,
  count, exists, visible, type, waitFor, mod, store, setStorage, getStorage, sleep, shot, P, theme, ui, outside })`.
  `boot({ settings, data, hash, locked })` wipes all storage, writes yours, reloads and waits for boot (lock off,
  reduce motion on by default). `ok(cond, msg)` prints `  ok …`/`FAIL …`; the run exits 1 on any FAIL, page error or
  script error. `mod('./js/x.js', 'fn', ...args)` calls an exported function in the page. Screenshots go to
  `.dev/shots/` (`shot(P + 'name')`) — look at them (Read the PNG) for layout checks in light, dark and Arabic.
- `.dev/smoke.cjs`: boots in en/light and ar/dark, opens every app and shell surface, 0 page errors.
- `.dev/widgets-gallery.cjs`: every registered widget in every size on the Home screen, page by page, with overflow
  checks and screenshots. Run it at real Chrome window sizes too (`W=1366 H=657`, `W=1536 H=750`, `W=1440 H=900`)
  and look at the shots: a laptop's Chrome viewport is ~110px shorter than its screen.
- `.dev/window-buttons.cjs`: the window handle bar's buttons win over the corner resize zones and sit inside the
  rounded corner.
- Static: `node --check <file>` for syntax, `python3 scripts/check_i18n.py` for strings.
- **Store images** (not tests; runall skips them): `OUT=store/screens W=1280 H=800 .dev/run.sh .dev/store-shots.cjs`
  seeds made-up sample data for every app, sets the page clock to 10:10 tomorrow in London (tomorrow, so nothing the
  pages schedule is already due in real time) and captures ~55 scenes (`SCENES=home,health,…` for some); then
  `.dev/run.sh --raw node .dev/store-compose.cjs` builds `store/screenshot-1…5-*.png` (1280×800), `promo-small.png`
  (440×280) and `promo-marquee.png` (1400×560) from them. Look at every image afterwards. All store texts (both
  languages, permission justifications, data-use answers) are in `store/listing.md`.

## Roadmap: parity with Liquid Tab

Status: ✅ done · 🟡 partial · ⬜ not started. The "Liquid Tab" column names the feature in `../ios-ext/CLAUDE.md`.

### New apps

| # | Bloom Tab (One UI) | id | Liquid Tab | Status |
| --- | --- | --- | --- | --- |
| A1 | Samsung Health: Daily activity rings (Focus/Done/Breaks), medications with reminders, water, sleep, mood (Mindfulness), body, cycle tracking, breathing | `health` | Health + Activity | ✅ |
| A2 | Samsung Wallet: passes with real barcodes (QR, PDF417, Code 128, EAN), subscriptions & bills with alerts, spending | `wallet` | Wallet | ✅ |
| A3 | Contacts: list, letter index, search, editor, groups, vCard import/export, duplicates, birthdays, favourites | `contacts` | Contacts | ✅ |
| A4 | Gaming Hub: Sudoku, Minesweeper, Solitaire, Chess, 2048, daily puzzles, streaks, achievements | `games` | Games | ✅ |
| A5 | Samsung Music: your own files (IndexedDB), tags/covers/lyrics, library, playlists, queue, EQ, sleep timer, offscreen playback, Now Bar + Quick Panel media | `music` | Music | ✅ |
| A6 | Voice Recorder: record with waveform, bookmarks, trim, skip silence, categories, Recycle bin | `recorder` | Voice Memos | ✅ |
| A7 | Interpreter: on-device text translation (Chrome Translator API), conversation mode, favourites | `interpreter` | Translate | ✅ |
| A8 | Modes and Routines: modes (Sleep, Work…) and If/Then routines, actions for every app, run from Finder | `routines` | Shortcuts + Automations | ✅ |
| A9 | Journal: entries with photos, mood, journals, streak, insights, suggestions from your day, lock with PIN | `journal` | Journal | ✅ |
| A10 | Canvas: endless board with sticky notes, shapes, text, images, pen, connectors, PNG export | `canvas` | Freeform | ✅ |
| A11 | Galaxy Store for websites: Discover, categories, rankings, search, a page per site, Install → Home screen; store icons for popular sites | `store` | App Store + website icons | ✅ (icons: favicons, no Apple server) |
| A12 | Digital Wellbeing: screen time per site/category, app timers, Focus modes with site blocking, Bedtime mode, weekly report | `wellbeing` | Screen Time + Focus filters | ✅ |
| A13 | My Files: Chrome downloads (optional permission), recent files, open/show/delete | `files` | Downloads stack | ✅ |

### Upgrades to existing apps

| # | App | Missing compared with Liquid Tab | Status |
| --- | --- | --- | --- |
| U1 | Samsung Notes (`notes`) | folders, tags, pictures, drawings, tables, lock with PIN, Writing assist, PDF/Markdown export | ✅ |
| U2 | Reminder (`reminder`) | lists/categories with colours, subtasks, repeat, early alerts, flags/priority, Today/Scheduled/All/Completed views, groceries | ✅ |
| U3 | Calendar (`calendar`) | day/week/year views, repeating events, two alerts, .ics import and subscriptions, natural-language event, birthdays | ✅ |
| U4 | Clock (`clock`) | several timers with presets, alarm sounds and snooze length, ringing screen in every tab, world map | ✅ |
| U5 | Calculator (`calculator`) | scientific keys polish, history, unit converter (Samsung has one), percent/memory | ✅ |
| U6 | Weather (`weather`) | several cities, detail cards (AQI, UV, sunrise/sunset, wind, precipitation, moon), hourly and 10-day charts | ✅ |
| U7 | Settings / Wallpaper and style | sections for the new features; more wallpapers, generative wallpaper, Dynamic Lock screen (photo shuffle) | ✅ |

### Shell

| # | Feature | Liquid Tab | Status |
| --- | --- | --- | --- |
| S1 | Screen lock PIN (6 digits, Samsung keypad, lockout after wrong tries, "Forgot PIN?" erases) | Passcode | ✅ |
| S2 | Now Brief morning/evening card + Bedtime (wind down) on the Lock screen; Stack widget | Morning Brief, Wind Down, Smart Stack | ✅ |
| S3 | Multi window: several pop-up windows (drag, resize, minimize to a floating icon), split screen, Recents screen with Chrome tabs | App windows, App Switcher | ✅ |
| S4 | Writing assist (Galaxy AI): proofread, rewrite styles, summarize, format, on-device | Writing Tools | ✅ (Notes, Journal; Reminder/Contacts/Wallet can adopt) |
| S5 | From any tab: Add to Home screen sheet over the page (+ open as web app), Quick capture (note/reminder/journal/log) | Add to Home Screen, Quick Capture | ✅ |
| S6 | Chrome side panel with mini apps (Notes, Reminder, Timer, Calculator, Music) | Side panel | ✅ |
| S7 | Welcome tour (One UI setup) and What's new sheet | Onboarding, What's New | ✅ |
| S8 | Daily Board (photo frame + clock + widgets, keeps screen awake) | StandBy | ✅ |
| S9 | Home editing: page manager, undo, drop a link, themed icons, starter folders, Apps screen categories, left page | Home Screen editing, Today View | ✅ |
| S10 | Finder: on-device AI answers, mic dictation, translate, commands for every app, Settings search | Search or Ask | ✅ |
| S11 | Sync through chrome.storage.sync | Sync | ✅ (off by default) |
| S12 | Tab workspaces, page-change alerts, rain alerts, break reminders | Workspaces, routines | 🟡 workspaces (Recents), rain alerts (Weather), breaks (Health) ✅; page-change alerts ⬜ |
| S13 | Lock screen widgets for every app, unlock sound | Lock Screen widgets | ✅ (chips reorderable; no unlock sound) |
| S14 | Release kit: `scripts/package.sh`, `store/listing.md`, `PRIVACY.md`, README | Release | 🟡 texts (EN/AR) and store images done; the contact email and a public privacy-policy link missing |
| S15 | Capture (screen recorder) suggestion — **ask the user first** | Capture suggestion | ⬜ |
| S16 | More UI languages (Liquid Tab has 14) — **ask the user first** | i18n | ⬜ |

### Tests

| # | What | Status |
| --- | --- | --- |
| T1 | Harness, run.sh slots, runall.sh, smoke, check_i18n.py | ✅ |
| T2 | Suites for the existing apps and shell: notes 104, reminder 92, calendar 104, clock 132, calculator 75, weather 71 (fake network), settings 165, home 110, shell 224 (each ×3: light, dark, Arabic), menus 281 (268 popups at 1440×900 and 800×600, LTR/RTL), background 48 | ✅ |
| T3 | Plain-node tests: calc-engine 137, schedule 37,658, reminder-parse 74 (they stub `addEventListener`/`document` because apps.js touches the DOM at import) | ✅ |

## Features (what exists today)

- **Lock screen** (`js/shell/lock.js`): clock styles stacked/classic/thin/left, 5 fonts, weight, colour; widgets
  (weather, battery, next event, next alarm, plus registered ones); 3 latest notifications; Now Bar pills; two
  shortcuts; lock modes always/idle/never; Always On Display; swipe/click/scroll/type to unlock.
- **Home screen** (`js/shell/home.js`, `appicon.js`): pages of sites, apps, folders (colours) and widgets on a
  grid (default 6×4), dock, page dots or line, search bar top/bottom, edit mode (drag, folders, page edges), add
  website dialog, widget picker, first-run seed from top sites.
- **Apps screen** (`js/shell/drawer.js`): every app and site A–Z with search. **Finder** (`js/shell/finder.js`):
  URL, math, unit conversion, time in a city, commands (timer, focus, note:, remind me, dark/light, lock), apps,
  sites, per-app results, bookmarks/history (optional), web search engines, AI assistants (Tab).
- **Quick Panel** (`js/shell/quickpanel.js`): Dark mode and Focus big tiles, small tiles, brightness/volume sliders,
  media card (ambient sounds), notifications, heads-up banners, Eye comfort, flashlight. **Edge panel**
  (`js/shell/edge.js`). **Status bar**. **Wallpapers** (`js/shell/wallpaper.js`): animated bloom presets, photo,
  Bing, solid; Color palette accent. **Ambient sounds** (`js/shell/sounds.js`, Web Audio).
- **Widgets**: Now Brief, battery, daily quote, photo, sounds, focus (`basic-widgets.js`); weather, clock
  (digital/analog/world), notes, reminders, calendar from their apps.
- **Apps**: Settings, Weather (Open-Meteo), Clock (alarm, world clock, stopwatch, timer), Samsung Notes-style Notes,
  Reminder, Calendar, Calculator.
- **Galaxy Store** (`store`, `js/apps/store.js` + `js/store/`): 556 websites (Liquid Tab's catalog) in 11 categories;
  Discover (banners, Must-have, Today's pick, Top websites, Popular in …; changes daily), Categories, Top
  (round-robin chart, category chips), Search (names, categories, any address, recent/popular searches), a page per
  site; Install adds it to the Home screen with its short name and becomes Open; Uninstall and Wish list
  (`storeWish`). Icons: Chrome favicon (or letter) on a generated squircle, no network. Finder "Install <site>",
  Today's pick widget. Test `store.cjs` 62/62 ×3, `store-model.mjs` 30/30.
- **Interpreter** (`interpreter`, `js/interpreter/{model,engine,speech,ui}.js`; keys `interpreter`, `interpreterPrefs`):
  on-device translation with Chrome's Translator/LanguageDetector only. Text (pills, swap, Auto detect, as-you-type,
  copy, read aloud, favourites, History), split-screen Conversation (top half turned around), Listening mode,
  Favourites, Language packs with download progress, Settings; mic only where Chrome recognises speech on the
  device (online recognition would send audio to Google: needs the user's OK). Finder `translate … to …` /
  `ترجم … إلى …` answers inline; widgets; Quick Panel tile. Tests `interpreter.cjs` 107 ×3, `interpreter-model.mjs` 115.
- **Digital Wellbeing** (`wellbeing`, `js/wellbeing/`, `bg/wellbeing.js`, `wellbeing-blocked.html`): dashboard (today's
  donut by site or category, Screen time / Notifications received / Unlocks, most used sites, week bars with goal
  line), screen time goal, site timers per site/category with per-day schedules, One more minute / Ignore for
  today, Focus modes (Work time, Me time, custom) that pause distracting sites (the Quick Panel's Focus too), Bedtime
  mode (schedule, grayscale via `html.wb-gray body::after` — a root `filter` hid the Quick Panel), Monday weekly
  report. Optional `tabs` permission; keys `wellbeing`, `wellbeingUsage` (hourly, 35 days); alarms `wb:*`. Widgets,
  Lock screen chip, Quick Panel tile Bedtime mode, Finder "screen time". Test `wellbeing.cjs` (first line makes
  runall use `run.sh --raw`: copies the extension with `tabs` granted) 73 ×3; `wellbeing-model.mjs` 44.
- **Modes and Routines** (`routines`, `js/routines/*`, `bg/routines.js`; keys `routines`, `routinesRun`): Samsung modes
  (Sleep, Theater, Driving, Exercise, Relax, Work, custom) with DND/display/sound/actions, timed or scheduled,
  settings restored when off; If/Then routines (manual, time period, sunrise/sunset, new tab, Chrome start, idle
  return, mode, website) with 34 actions, variables/If/Repeat/menus, undo when ended, Discover, on-device "Describe
  a routine". **Other apps add actions with `registerAction()` from `js/routines/actions.js`.** SW `routine:tick`
  alarm, pending "Tap to run" notification; widgets, Finder `run …`/`… mode`, Quick Panel Modes tile, Now Bar,
  Lock screen chip. Tests `routines.cjs` 48 ×3, `routines-run.mjs` 75.
- **Samsung Wallet** (`wallet`, `js/wallet/*`, `bg/wallet.js`; key `wallet`, pictures `wallet:<id>`): Quick access card
  stack, Samsung's categories (boarding passes, tickets, membership, coupons, gift cards, digital keys, IDs), pass
  details with real QR/PDF417/Code 128/EAN-13/UPC-A barcodes shown full screen at full brightness, Add to Wallet
  editor (colours, logo, pictures), subscriptions & bills with SW alerts (`wallet:sub:<id>`), spending by category
  with budgets, charts, CSV; widgets (card, upcoming bills, spending), Finder (`coffee 3.5$`, `bills`, pass search),
  Lock screen next-bill chip (no amounts while locked), Now Bar for a trip/event within 4 h. No payment cards/NFC,
  no exchange rates. Tests `wallet.cjs` 82 ×3, `wallet-codes.mjs` 40, `wallet-model.mjs` 37.
- **Voice Recorder** (`recorder`, `js/recorder/*`; keys `recorder`, `recorderPrefs`, audio `recorder:<id>`): Standard /
  Interview (stereo, one person per channel) / Speech-to-text (Chrome's on-device recognition only, `processLocally`;
  tab hidden where unavailable), live waveform, bookmarks, keeps recording with the window closed (chunks in
  IndexedDB every second, recovery after a closed tab), Save dialog, categories, search/sort/select, playback (scrub,
  speed, Skip silence, Repeat A–B, Interview mute, transcript), Trim/Delete (WAV), Recycle bin 30 days; widgets, Now
  Bar with Stop, Quick Panel tile, Finder `record`. Tests `recorder.cjs` 108 ×3, `recorder-model.mjs` 38.
- **Gaming Hub** (`games`, `js/games/*`; key `games`): Home (today's four daily puzzles with streak, Continue playing,
  Instant plays, daily challenges), Library (Puzzle/Card/Board), Profile (level, stats, play time, 29 achievements).
  Sudoku, Minesweeper, Solitaire (Draw 1/3, daily deal), Chess (5 levels in a Worker, two players, clocks, daily
  mate-in-two) and 2048 in One UI game screens (timer chip, Undo, ⋮ New game/Difficulty/How to play/Statistics,
  result dialogs). Daily puzzles seeded from the date. Boards never mirror in Arabic. Widgets `games-today`,
  `games-continue`; lock chip; Finder `play <game>`, `daily puzzle`. Tests `games.cjs` 104 ×3, `games-logic.mjs`,
  `games-chess-engine.mjs` (perft).
- **Contacts** (`contacts`, `js/contacts/*`, `bg/contacts.js`; keys `contacts`, `contactsBg`, photos `contacts:<id>`):
  large title with count, My profile, Favourites, A–Z with fast-scroll index (Arabic letters first in Arabic), search
  in every field, selection mode, drawer (groups, Manage contacts, Recycle bin, settings), two panes ≥ 720 px, detail
  with round Call/Message/Video/Email (`tel:`/`sms:`/`mailto:`; Video opens meet.google.com/new in a new tab), One UI
  editor, groups, vCard import/export with photos, merge duplicates, Recycle bin 30 days; birthday and Keep in touch
  notifications (one `contacts:next` alarm); widgets, Finder search + `call/message/email <name>`, `birthdays`, lock
  chip. **`upcomingBirthdays(days)`** exported for Calendar. Tests `contacts.cjs` 76 ×3, `contacts-vcard.mjs` 59.
- **Journal** (`journal`, `js/journal/*`, `bg/journal.js`; keys `journal`, `journalLock`, pictures `journal:<id>`):
  entries (photos, drawings, mood faces with feelings/causes, place, tags) in coloured journals, Bookmarked, Recycle
  bin 30 days; Calendar (mood colour/photo per day) and Insights (streak, year heat-map, mood, time of day, tags);
  suggestions from events, finished reminders, Focus sessions, notes, music + 40 daily prompts; journaling-schedule
  notification; **Lock Journal** with its own 4–6 digit PBKDF2 PIN (`js/journal/lock.js` has one provider: add a
  'screen' provider when S1 lands); widgets, Finder `journal: <text>` (works while locked) and search (hidden while
  locked), lock chip, Text/Markdown export. `addEntry()` in `js/journal/data.js`. Tests `journal.cjs` 78 ×3,
  `journal-model.mjs` 41.
- **Samsung Health** (`health`, `js/health/*`, `bg/health.js`; keys `health`, `healthPrefs`, SW-only `healthSW`,
  `healthAct`): Home cards (Daily activity, Medications, Water, Sleep, Mood, Body composition, Cycle tracking,
  Breathe) with Manage items; Days/Weeks/Months charts with goal line; medications (pill art, five schedule types,
  as-needed, adherence, archive) with SW reminders (Taken/Skip, 30-min follow-up, no names on the Lock screen);
  cycle predictions; **Daily activity rings**: Focus (`focusLog` + running session), Tasks (completed reminders),
  Breaks (`chrome.idle`), Activity tab, streaks, challenges, awards, goals, evening coaching. Three widgets, Now Bar
  (due dose, no name), Finder (`water`, `drink 500ml`, `took <med>`, `meds`, `mood great`, `rings` + Arabic), Quick
  Panel water tile, lock chips. Tests `health.cjs` 86 ×3, `health-model.mjs` 81.
- **Samsung Music** (`music`, `js/music/*`, `bg/music.js`, `offscreen.html` + `js/offscreen.js`; library, audio, covers,
  lyrics in IndexedDB `music:*`; keys `music`, `musicPos`, `musicLib`, `musicStats`, `musicPrefs`, `musicRev`): your own
  files (ID3/MP4/FLAC/Ogg/WAV tags, covers, `cover.jpg`, `.lrc`), tabs Tracks/Playlists/Albums/Artists/Genres/
  Folders, selection mode, search, smart playlists, Details/Edit tags; mini and full player (queue, synced lyrics,
  9-band equaliser, crossfade, speed, sleep timer). **Plays in the offscreen document driven by the SW**, so it keeps
  playing after the tab closes; the offscreen page is a general audio host (`music`, `chime`, `play`, `stop`,
  `volume` messages; `toOffscreen()` in `js/bg/music.js`). Quick Panel media card (`registerMedia`), Now Bar (only
  while locked, to avoid a duplicate next to the media card), widgets, Finder `play/pause/resume/next/previous`, media
  keys; pauses/is paused by the ambient sounds. Tests `music.cjs` 90 ×3, `music-tags.mjs` 17, `music-core.mjs` 45.
- **Canvas** (`canvas`, `js/canvas/*`; keys `canvas`, `canvasPrefs`, pictures/previews `canvas:<id>`): Samsung Notes–style
  boards gallery (All/Favorites/Recycle bin 30 days, grid/list, sort, search, selection mode) and an endless board
  with the floating pen toolbar (pen/pencil/calligraphy/marker, highlighter, area/stroke eraser, lasso, **Auto
  shape**), text boxes, sticky notes, ~60 shapes, lines and attached connectors, images, links; guides/snap, resize,
  rotate, multi-select, align/distribute, layers, group, lock, copy/paste, undo/redo, scenes, zoom, PNG/PDF (no
  library) export, print; off-screen items aren't painted. Recent boards widget, Finder search + `new board`. Tests
  `canvas.cjs` 109 ×3, `canvas-model.mjs` 48.
- **Welcome tour, What's new, Daily Board** (`js/shell/onboarding.js`, `whatsnew.js`, `dailyboard.js` + `dailyboard-ui.js`):
  One UI setup wizard on first run (language, theme, wallpaper, Add my sites from top sites, search/AI,
  permissions, Lock screen style; `html.onb-pending` hides the shell, no flash on the language reload; users with a
  Home layout count as onboarded); What's new once per version after unlock (`seenVersion`), also in Settings ›
  About — **add a row in `whatsnew.js` when a Roadmap item lands**; Daily Board ambient mode (photos or wallpaper,
  digital/analog clock, calendar, two widgets, music card, red night mode, wake lock) from a Quick Panel tile, Finder
  `daily board` or an idle Lock screen; settings key `dailyBoard`, photos `dailyboard:<id>`. Test flags
  `bt.test.tour`, `bt.test.whatsnew`. Tests `onboarding.cjs` 73 ×3, `dailyboard.cjs` 67 ×3.
- **From any tab + side panel** (`bg/anytab.js`, `addsite.html`/`capture.html` + `js/anytab/*`, `sidepanel.html` +
  `js/sidepanel/*`): **Add to Home screen** sheet over the page (touch icon from apple-touch-icon/manifest/favicon kept
  in `clipIcons`, editable name, Home screen or Edge panel, Open as web app → one reusable pop-up window) from the
  page/link menus, the toolbar button and Alt+Shift+H; **Quick capture** (Alt+Shift+Q, page/selection menus: Note,
  Reminder with natural time, Journal (works while locked), Log water/mood/dose/expense; never shows saved data).
  Data reaches the sheet through a one-time `chrome.storage.session` token, so a framing site sees nothing;
  unscriptable pages get a small pop-up window. **Side panel** (Alt+Shift+L; Alt+1–5): Notes, Reminder, Clock,
  Calculator, Music; PIN gate in `js/sidepanel/gate.js`. Tests `anytab.cjs` (raw, host permissions) 82,
  `sidepanel.cjs` 54 ×3.
- **Multi window + Recents** (`js/core/apps.js`, `js/shell/recents.js`, `css/recents.css`): One UI pop-up windows (several
  at once, handle bar with Transparency/Split/Minimize/Full screen/Close, drag, resize, focus/raise; size, position,
  transparency per app in `appWindows`; a lone unmoved window keeps the dimmed look, otherwise DeX-like over a live
  Home screen; max 8), minimized floating icons (stack, drag, drop on Remove), split screen (edge drag or button,
  app picker, divider with swap/exit). **Recents** (Alt+R, the gesture bar at the bottom, Quick Panel tile, Finder
  "recents"/"close all"): window cards (swipe up, Close all), Chrome tabs (switch/close, optional `tabs`), Recently
  closed (`sessions`), **Workspaces** (`workspaces` key) reopened as named tab groups (`tabGroups`). Escape order:
  menu → dialog → split picker → sub-page → window. Tests `windows.cjs` ×3, `recents.cjs` 48 ×3.
- **Finder** (`js/shell/finder.js`, `nlp.js`, `ai.js`; maths/units from `js/calc/`): result cards ranked by relevance
  (apps, Settings rows, sites, app content, bookmarks, history); instant answers (maths, units, time in a city incl.
  Arabic names, days until/since, weekday, Ramadan/Eid and Hijri dates via Umm al-Qura, week number); EN/AR commands
  (timer, focus, note:, remind me, `lunch with Sara Friday 1pm` → event with `event:<id>` alarm, wallpaper, sounds,
  open app, flashlight, theme, lock, plus every app's registered commands); **on-device AI** (Ask chip / Tab: streams
  from Chrome's Prompt API, follow-ups, Copy, Continue in the AI assistant; `define …`); on-device voice input (mic
  via `js/interpreter/speech.js`); time-of-day suggestion chips; Settings rows searchable (`indexSettings()`,
  `params.find` flashes the row). Settings `finderLocalAi`, `finderVoice`. Tests `finder.cjs` 121 ×3,
  `finder-nlp.mjs` 119.
- **My Files** (`files`, `js/files/*`; keys `files` (Recycle bin), `filesPrefs`): Chrome downloads behind optional
  `downloads` (Allow card; `downloads.open` asked on first open). Home with Downloading, Recent files, 7 categories,
  Bloom Tab storage (per app, `getBytesInUse` + `storage.estimate()`), Recycle bin (files hidden 30 days, then
  `removeFile`); list/grid, sort, Edit mode, open/show/copy link/Details/remove/delete, pause/resume/cancel/retry,
  search, live updates. Now Bar download progress (no names while locked), widgets `files-recent`/`files-storage`,
  Finder file names + `downloads`. No previews of files on disk (would need `file:///*` host access). Tests
  `files.cjs` (raw, real downloads) 102 ×3, `files-model.mjs` 94.
- **Calculator** (`calculator`, `js/calc/{engine,units,model,ui,converter}.js`; keys `calc`, `calcPrefs`): Samsung keypad
  with live result, grouping as you type, automatic × before "(", Samsung toasts (divide by 0, invalid format,
  digit limits); Scientific mode (⇄ second functions, Rad/Deg; always shown in full screen), History over the digit
  keys, Unit converter (8 categories + Tip, type in either field, swap), copy/paste, keyboard incl. Arabic-Indic
  digits, fits any window height. **`js/calc/engine.js` + `units.js` are shared with Finder** (trig in degrees,
  Latin unit symbols in Arabic). Tests `calculator.cjs` 146 ×3, `calc-engine.mjs` 518.
- **Screen lock and Now Brief** (`js/shell/{pin,lock,brief}.js`, `css/{pin,brief}.css`; keys `pin`, `pinTries`; settings
  `lockAfter`, `lockHideContent`, `nowBrief`, `nowBriefAuto`, `eveningBrief`, `windDownAt`): Screen lock type
  None/Swipe/PIN (4–16 digits, PBKDF2 hash, Android lockout from the 5th wrong try, Lock automatically after N minutes
  via `chrome.storage.session`, Forgot PIN? erases everything, never exported or synced); `unlock()`, `#open=` deep
  links and the side panel wait for it; Hide content (notifications show only the app); chips render with
  `{ locked, private }`, reorderable, default set; Journal can use the screen PIN; morning/evening **Now Brief** (sheet
  once per morning, Lock screen card with counts only, widget; evening: goals, tomorrow's first event/alarm, journal
  prompt, Bedtime mode, sleep sounds) and the **Smart stack** widget. Tests `pin.cjs` 112 ×3, `brief.cjs` 81 ×3,
  `lock.cjs` 30 ×3.
- **Home editing (One UI)** (`js/shell/home.js`, `drawer.js`, `appicon.js`, `quickpanel.js`): edit mode by long-press or
  Ctrl+wheel pinch with the bottom bar (Wallpaper and style, Themes, Widgets, Settings), Main page and delete per
  page, Undo/Redo (Ctrl+Z / Ctrl+Shift+Z), page manager (thumbnails: reorder, add, delete), dropped links become
  sites, Lock Home screen layout, icon styles Default/Themed/Dark/Clear, badges; Apps screen A–Z or custom order with
  its own folders; **Now Brief page** left of page 1 (widget column); One UI first-run layout (Google and Samsung
  folders; dock Notes, Calendar, Reminder, Galaxy Store, Apps) and a one-time `homeAdded` migration that puts new apps
  on existing layouts (test flag `bt.test.homeAdded`); `removeSite(host)` → undo; site menu "Open as web app".
  **Quick Panel**: Edit buttons (add/remove/reorder/reset), pages of 12, collapsed vs expanded, live registered
  tiles, Focus "Until I turn it off" (`focus.endsAt: null` — readers must handle it). Tests `home.cjs` 224 ×3,
  `quickpanel.cjs` 51 ×3.
- **Weather** (`weather`, `js/weather/*`, `js/services/weather.js`, `bg/weather.js`; keys `weather` (main location, old
  shape kept), `weatherMore`, `weatherPlaces`, `weatherPrefs`, `weatherRain`): Samsung Weather with animated
  day/night/dawn/dusk skies (real Moon phase), header with "Updated" and a one-line insight, hourly graph, 10-day
  range bars, 10 detail cards (UV, humidity, wind, air quality, sunrise/sunset, moon, pressure, visibility, dew
  point, precipitation) each with a detail page (day picker, hourly chart; Sun path and Moon calendar computed on the
  device), up to 15 cities (swipe, Manage locations, search → preview → Add), units, **rain alerts** from the SW
  (`weather:rain`, every 30 min, once before rain), Weather + Weather forecast widgets with a location choice, Finder
  answer. New host `air-quality-api.open-meteo.com`. Tests `weather.cjs` 136 ×3 (fake network), `weather-astro.mjs`
  53, `weather-model.mjs` 53.
- **Samsung Notes** (`notes`, `js/notes/*`; keys `notes` (old shape kept), `notesBin`, `noteFolders`, `notesLocked`,
  `notesView`; pictures `notes:<id>`, strokes `notes:<id>:v`): drawer (All notes, Favourites, Recently deleted 30
  days, coloured folders, #tags), selection mode, list/grid, sort; rich editor with undo/redo, Text style (paragraph
  styles, sizes, colour, highlight, alignment), checklists/lists by typing, tables, pictures, drawings (Canvas's ink
  engine), voice recordings, lined/grid/dotted pages and templates; **lock with the screen PIN** (text moves to
  `notesLocked`, never visible to the side panel, widgets or Finder); PDF (no library), Markdown, Text export, Print.
  Tests `notes.cjs` 217 ×3.
- **Writing assist** (`js/shell/writing.js`, `css/writing.css`): Galaxy AI panel on Chrome's on-device models only —
  Proofread (inline review), Style (Professional, Casual, Polite, Social, Emojify), Summarize, Format (Notes, Key
  points, List, Table), Translate (via `interpreter/engine.js`), Describe a change. **`attachWritingAssist(el, { kind,
  onResult, button, bar, menu, float, onBefore, undo, ok })`** → `{ open, detach }` on rich editors and plain fields;
  also `openWritingAssist`, `writingAssistItem`, `assistStatus`, `runTool`. Used in Notes and Journal. Tests
  `writing.cjs` 88 ×3.
- **Calendar** (`calendar`, `js/calendar/*`, `bg/calendar.js`; keys `events`, `calendars`, `calPrefs`, `calSubs`,
  `calSubEvents`): Year/Month/Week/Day/List views in the drawer; month bars + day agenda with natural-language quick
  add (EN/AR); Week/Day drag to create, move, resize; One UI editor (colour, calendar, all day, time zone, two
  reminders, repeat + Custom, location, invitees, notes); detail with Edit/Share (.ics)/Delete; repeat scopes Only
  this / This and future / All with Undo; calendars (create, rename, colour, show/hide, default), Birthdays from
  Contacts, Reminders from due dates; .ics import/export and URL subscriptions refreshed by the SW every 6 h
  (`calsub:tick`, optional host permission per site); search, Go to date, week numbers, first day, alternate calendar
  (Hijri Umm al-Qura, Persian, Hebrew, Chinese). Event alarms now live in `js/bg/calendar.js` (`event:<id>` = next
  reminder). **Repeating events: read them through `eventDays()` / `occurrences()` from `js/calendar/data.js`, not the
  raw `events` list.** Routines "Create event". Tests `calendar.cjs` 148 ×3, `calendar-model.mjs` 98.
- **Settings / Wallpaper and style / Sync** (`js/apps/settings.js`, `js/settings/{pages,wallpaper}.js`,
  `js/shell/{wallpaper,theme}.js`, `bg/sync.js`): One UI root with a search field and profile card; **Apps** (a page
  per app: open, notifications on/off via `mutedApps` — respected by `notify()` and hub `post()`, window size, Add to
  Home screen, storage), **Notifications** (app mute, Do not disturb with schedule — `dndActive()` in `bg/hub.js`,
  history), **Accessibility** (high contrast, reduce transparency, remove animations, text size), **Advanced
  features** (side panel, any-tab features, Labs, Keyboard shortcuts — every shortcut listed), General › Reset
  (`eraseEverything()`). **Wallpaper and style**: Lock/Home previews, "Set as wallpaper on" Lock/Home/both (separate
  Lock wallpaper, `lockWall()`), 22 bloom presets with light/dark looks, photos (`wallpaper:<id>` + `wallPhotos`),
  Dynamic Lock screen, Creative wallpaper (offline, EN/AR words), Color palette, dim in dark mode; the live wallpaper
  pauses behind app windows (`wallLiveBehindApps` keeps it moving). **Sync with Chrome** (`syncPrefs`; off by
  default): chunked under the 8 KB item limit, newest wins per key, first sync merges lists by id; never PIN,
  Journal, Health, pictures, audio or music; language, lock timing, brightness stay per computer. Backup can include
  pictures and recordings. Tests `settings.cjs` 229 ×3, `wallpaper.cjs` 65 ×3, `sync.cjs` 34 ×3, `sync-model.mjs` 50.
- **Clock** (`clock`, `js/clock/*`, `bg/clock.js`; keys `alarms`, `timers`, `timerPresets`, `clocks`, `stopwatch`,
  `clockPrefs`, session `clockRinging`): alarm list under "Alarm in …", editor pop-up (AM/PM-hour-minute wheels, day
  chips or a date for ring-once, name, 12 synthesised tones, volume, gradual rise, snooze interval and repeats),
  selection mode; **ringing**: the SW plays a looping tone through the offscreen host (channel `clock`), every open
  tab shows the full-screen swipe screen (Dismiss/Snooze; timers Restart/+1 min), sticky notification with buttons,
  auto-snooze after a minute, late rings reported as missed; World clock with day/night map, EN/AR city search
  (bundled Arabic names), reorder, time zone converter; Stopwatch laps fastest/slowest, analog/digital; several
  timers with presets, names, sounds, a Now Bar pill each; Finder `alarm 7:30` / `منبه 7:30 م`; Routines "Set
  alarm"/"Start timer". `nextAlarmTime()` honours `alarm.date`. Tests `clock.cjs` 178 ×3, `clock-ring.cjs` 40,
  `clock-core.mjs` 122, `schedule.mjs` 37,668.
- **Reminder** (`reminder`, `js/reminder/*`, `bg/reminder.js`; keys `reminders` (array, new fields optional),
  `reminderCats`, pictures `reminder:<id>`): main page (Today/Scheduled/All/Completed tiles + My categories with
  name, colour, icon), list pages (by day, category or aisle; drag to reorder/move), selection, search, Undo; detail
  screen (date/time, repeat incl. custom with end date, early alert `reminder:<id>~e`, Important, subtasks, notes
  with Writing assist, link, pictures, duplicate); **Write a reminder** reads the text as you type and highlights
  dates, times, repeats, #category, ! (EN/AR); repeats move on when completed or when they ring (a completed copy is
  kept); the SW keeps alarms in step with storage (restore, startup, other writers); widgets `reminder`,
  `reminder-cat`; Now Bar with Complete; Lock screen count; Routines "Add reminder". `parseQuickTime`, `addReminder`,
  `fmtDue`, `setDone` (`js/reminder/data.js`) for other modules. Tests `reminder.cjs` 139 ×3, `reminder-parse.mjs`
  118, `reminder-model.mjs` 52.
- **Background** (`background.js` + one module per app in `js/bg/`): routes alarms, notification buttons/clicks and
  page messages to the modules through `bg/hub.js`; notifications respect the app mute list and Do not disturb; the
  in-page notification list is written through one queue (`addToList()`).
- **Keyboard**: Alt+L lock · Alt+A Apps · Ctrl/⌘+K or `/` Finder · Alt+Q Quick panel · Alt+E Edge · Alt+, Settings ·
  ←/→ pages · ↑ Apps · ↓ Quick panel · type to search · Esc.

## Status

- 2026-10-26: project guide, test harness (`.dev/`), `check_i18n.py`, and the extension points for the parity work
  (`core/hooks.js`, `addIcons`, `core/blobs.js`, `core/perm.js`, `bg/hub.js`, async `render`, `MODULES` list,
  `#open=<app>&s=<section>`). Smoke: 48 checks pass in en/light and ar/dark, 0 page errors.

- 2026-10-26 ~16:40: **waves 1–2 paused by the account's weekly usage limit (resets 2026-10-27 19:00)**. Twelve
  apps were being built in parallel and are on disk, registered and opening without errors, but **unfinished and
  not yet reviewed**: health, wallet, contacts, games, music, recorder, interpreter, routines, journal, canvas, store,
  wellbeing (their tests in `.dev/<id>*.cjs/.mjs` are partly written). The suites for the existing apps (notes,
  reminder, calendar, clock, calculator, weather, settings, home, menus, shell, background + plain-node
  calc-engine, schedule, reminder-parse) are also partly done; that work already fixed `store.js` (a stale echo of
  this page's own write could overwrite a newer value) and touched clock.js, notes.js, app.css, shell.css.
  Smoke at the pause: 120 checks pass (19 apps, en/light + ar/dark), 0 page errors; check_i18n: 3,423 keys, 0
  problems. Next: resume each worker to finish its app and report, review and integrate (Home screen placement of
  the new apps, Roadmap statuses), then wave 3 (shell S1–S12 and upgrades U1–U7).

Fixed by the T2 work (26 bugs): store echo rollback (lost Notes typing, duplicate notes), Calculator eˣ and `50+10%`,
toasts/closed Quick Panel/app windows catching clicks or showing through the Lock screen, Reduce motion blocking
focus, Lock screen shortcuts not running their action, Clock pause/resume and +1 min, Notes Esc/colour picker and
checklist, Reminder fast edits and "tomorrow at noon …", Home "Add website" from the menu and widget removal undo,
sound volume per tab, Alt shortcuts on macOS, Edge panel swipe in Arabic, Finder "الوقت في <city>".
After T2: the SW's notification list writes are queued (`addToList()` in `bg/hub.js`; alarms firing together lost
entries) and notification times use the app's language (`bgTime()`).

- 2026-10-29: integration pass (see the to-do list below). Shell: Now Bar pills (Lock screen) and Quick Panel activity
  rows are patched in place every second instead of rebuilt, and a pill click opens `open`/`app`+`params`; Daily
  Board hides widgets and event titles while a PIN guards the Lock screen behind it; `menu()` opens towards the
  inside of the reading direction; `choose()` scrolls only its list; widget picker groups A–Z; no empty dock pill;
  the Apps screen, Edge panel and Lock screen stop catching clicks as soon as they start fading out; the Home screen
  skips rendering while covered (`onHomeHidden`; the live wallpaper pauses itself, see `wallLiveBehindApps`); home and
  Settings options (`mutedApps`, `dnd`, `textScale`, `lockWallpaper`, Labs…) default in `DEFAULT_SETTINGS`; back/forward
  chevrons mirror once in Arabic (on the icon, never on its box); a Do not disturb icon in the status bar; the Lock
  screen settings preview shows `lockWall()`; Daily Board month marks and Journal suggestions read Calendar's
  `eventDays()`/`occurrences()` (repeating events); the side panel completes reminders through `setDone()` (repeating
  ones move on, Undo restores). Apps: Routines actions from every new app, a "Screen unlocked" trigger, widget
  `configure` for several apps.

### Integration to-dos collected from the workers' reports (for wave 3)

Done in the 2026-10-28/29 integration pass: Now Bar pills patched in place (no lost clicks) and honouring
`params`/`open`; Daily Board privacy; Journal "Use screen lock PIN"; Routines "Screen unlocked" trigger, Routines
actions from every new app and widget `configure` for Routines/Wallet/Contacts/Music/Health/Journal/Canvas/Interpreter;
logical `menu()` placement, scrolling `choose()` lists, A–Z widget picker, no empty dock pill, fading layers that no
longer catch clicks, the RTL dialog divider; the Home screen pausing while covered; home settings in `DEFAULT_SETTINGS`.
Still open:
- Recents: card previews are copies, not live; minimized icons don't remember their spot; no Genie-style animation.
- Wallpaper (owner: U7): `js/shell/wallpaper.js` pauses the live wallpaper whenever any pop-up window is open (not
  only when the Home screen is covered) and keeps painting under the Daily Board; it could follow `onHomeHidden()`
  from `core/widgets.js` (body.home-hidden) instead, keeping the Lock screen case (the wallpaper shows there).
- Health State of Mind ↔ Journal mood link.
- Daily Board suite: "Finder offers Start Daily Board" (+ the Esc check after it) and a photo file-chooser timeout fail
  since the Finder rewrite — check the `daily board` command's ranking/match.
- Defaults: consider the Screen time widget on the Now Brief page; the wellbeing chip in the default `lockWidgets`.
- Widgets that could still adopt `configure`: Clock (city), Weather (city), Notes, Reminder, Photo.

- 2026-10-29: **user-reported bugs fixed.** (1) *Widgets looked wrong*: in a short window (a laptop's ~650px Chrome)
  the Home grid made cells up to 176px wide but ~95px tall, so a 2×2 widget became a wide strip and round faces
  (analog clock, battery and focus rings) spilled out; `measure()` in home.js now keeps cells within 1.2:1 like One
  UI's square grid, and rings/faces size by the widget's smaller side (`min(Ncqw, Ncqh)`; `.wg` is a size
  container). Then, from the user's list: the digital clock (s, m), Weather (s, m, l), Weather forecast and Focus (s)
  widgets size their text, icons and padding with `clamp(min, container units, max)` so they fill a 210×175 laptop box
  and a 340×300 big-screen box alike (new widgets should do the same; `.dev/widgets-focus.cjs` renders these with a
  real forecast at a given W×H for review). The Battery widget drew the wrong glyph (`layout`, stretched by a too-broad `.batt-ring svg` rule).
  (2) *Couldn't close a window near its edge*: the handle bar's buttons sat in the 26px corner resize zone (z 60)
  inside a z-index-3 stacking context, and the close button's outer corner fell outside the 34px rounded corner, so
  the cursor showed resize and a click resized or went through to the Home screen; the handle no longer makes a
  stacking context, the buttons are at z 61 and 22px in from the edge. Also: What's New lists every new app and
  feature; `background.js` keeps only Focus and sends it through hub `post()` (mute/DND); runall runs 3 at once.

- 2026-10-29, **final verification**: `.dev/runall.sh` = 26 plain-node suites + 117 browser runs (every `// triple`
  suite in light, dark and Arabic) + check_i18n. First pass 125/142; the 17 failures were fixed and re-run green:
  calendar subscriptions (the optional host permission made `chrome.permissions.request()` hang in headless Chrome —
  the test now answers the prompt as declined), health (the test misread the sleep dialog's date as the bedtime day;
  failed only in a DST week), interpreter (harness `click()` now retries a node replaced mid-click), onboarding (the
  tour painted raw dual presets: `presetById()` first; narrow-window check updated for a scrolling 22-wallpaper
  grid), menus (selectors for the redesigned Notes/Reminder), widgets-gallery (intentional overflow exempted),
  background and contacts-dark (load; green alone). **All 143 runs pass; 5,329 strings, 0 i18n problems.**
  `scripts/package.sh` → `dist/bloom-tab-1.0.0.zip` (390 files, 1.9 MB). Store name: "Bloom Tab: Samsung One UI New
  Tab, Widgets & Dashboard" (see `store/listing.md` for the trademark risk and fallback).

- 2026-10-29, from the user's screenshots (24-hour time, a ~620px-tall Chrome window): the digital clock and the
  ringing screen printed **"18:08 null"** — native `replaceChildren()/append()` turn a `null` argument into the text
  "null" (unlike `h()`, which skips it), and AM/PM is empty in 24-hour time; Weather (medium) cut off its hourly
  temperatures in a ~160px-tall box. Fixed: no null passed to native DOM methods; the small clock uses the short date;
  the medium weather has smaller floors and its icon beside the condition (Arabic overlapped before); Now Brief,
  Weather (large) and Weather forecast (large) drop rows with `@container (max-height: …)` instead of spilling.
  `.dev/widgets-gallery.cjs` now runs in 24-hour time (`H12=1` for 12-hour) and fails on visible
  null/undefined/NaN text; run it at `W=1366 H=620` too.

- 2026-10-29: **Chrome Web Store images and texts.** `.dev/store-shots.cjs` + `.dev/store-compose.cjs` (see Testing) →
  five captioned screenshots (Home with Lock screen and Now Brief; 9 apps; the essentials; multitasking; dark mode,
  Arabic, PIN and wallpapers), the small promo tile and the marquee, in Bloom's purple bloom look with the icon drawn
  as SVG. `store/listing.md` now holds every Dashboard text: name and summary with the trademark fallback, the full
  description in English and Arabic, category, links, single purpose, a justification per permission (optional ones
  too), remote code, data usage (only Location: weather coordinates to Open-Meteo), reviewer notes, version notes.
  Found on the way: Health's service-worker notifications (awards, coaching, doses) ignored Settings › Notifications
  and Do not disturb (its own `post()` skipped the mute list): fixed; the **serif clock font** (Lock screen, Daily
  Board) drew its digits from Noto Naskh Arabic on Linux/ChromeOS (no Palatino/Georgia), whose deep descent pushed
  them into the date: the generic `serif` now comes before the Arabic font. PRIVACY.md lists the site-icon request
  of Add to Home screen.
- 2026-10-29, from the user's screenshots of Home edit mode: the **page manager** centred its last row (page 4 and
  "Add page" started under page 1, a hole under Now Brief) — it is a CSS grid now (`--pm-n` columns, rows fill from
  the inline start) and each thumbnail shows the page 6px inside its frame without the copied edit-mode outline; the
  **Now Brief page** scrolls without a scrollbar and fades out at the bottom (`.lp-scroll`); **Done** in the edit bar
  is an icon-and-label button like its neighbours, after a thin divider (the page manager keeps the Done pill).

## Known issues

- `background.cjs` sometimes fails its `chrome.notifications.getAll()` checks (timer/alarm/reminder/event system
  notifications missing), now also when it runs alone — 2 of 4 runs on 2026-10-29 with the code as committed, so not
  caused by that day's changes. The in-page entries are always there; waiting for Chrome's list (`sysWith()`) didn't
  help, so headless Chrome seems to drop some. Rerun it before suspecting the service worker.
- `.dev/runall.sh` clears its summary on every call: run it once with a filter, not once per suite in parallel.
- Several workers editing at once briefly broke boot (a manifest entry or an import before its file existed);
  harmless now, but a release must be packaged from a quiet tree with smoke passing.

## History

| Date | Commit | What |
| --- | --- | --- |
| 2026-10-29 | c36f392 | Bloom Tab 1.0.0: first commit — 20 apps, the One UI shell, tests, release kit |
