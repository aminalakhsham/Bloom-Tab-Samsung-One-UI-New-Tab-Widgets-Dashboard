# Brief for parallel workers (read fully before starting)

You are building one piece of **Bloom Tab** (`/home/aminking/bloom-tab`), a Chrome MV3 new-tab extension in the
style of **Samsung One UI 9**. The goal is feature parity with the sister project **Liquid Tab**
(`/home/aminking/ios-ext`, iOS style), rebuilt the One UI way.

1. **Read `/home/aminking/bloom-tab/CLAUDE.md` first** (architecture, extension points, conventions, testing).
2. Read the Liquid Tab feature you are porting: its section in `/home/aminking/ios-ext/CLAUDE.md` and its code under
   `/home/aminking/ios-ext/js/`. Port the *capabilities*; pure logic (engines, parsers, models, barcode encoders…)
   can be copied and adapted, but **every screen must look and behave like Samsung's own One UI app** (layout,
   wording, colours, navigation), not like the iOS one.
3. Study how Bloom Tab apps are written before writing yours: `js/apps/notes.js`, `js/apps/clock.js`,
   `js/apps/reminder.js`, `css/apps/notes.css`, `js/core/ui.js`, `js/core/apps.js`, `css/app.css`, `css/tokens.css`.
   Reuse the UI kit (`row`, `list`, `switchRow`, `dialog`, `menu`, `seg`, `slider`, `.ou-fab`, `.ou-card`…) and the
   design tokens (`--surface`, `--text-2`, `--accent`, `--r-lg`…) so your app matches the rest.

## Files

- **You own** (create freely): `js/apps/<id>.js` (registration, widgets, Finder commands/search, lock widgets,
  strings), `js/<id>/*.js` (UI and logic, lazy-loaded through an async `render`), `css/apps/<id>.css`,
  `js/bg/<id>.js` (service-worker jobs via `js/bg/hub.js`), `.dev/<id>.cjs` and `.dev/<id>-*.mjs` tests, and any
  other file whose name contains your app id.
- **Shared files you may change with a one-line addition only**: `js/main.js` (`MODULES` list),
  `newtab.html` (one `<link>` for your CSS), `background.js` (one `import './js/bg/<id>.js';` under the comment
  listing app background modules). Other workers edit these too: re-read right before editing, add only your line.
- **Do not edit any other existing file** (store.js, icons.js, ui.js, apps.js, hooks.js, home.js, finder.js,
  quickpanel.js, lock.js, settings.js, app.css, shell.css, tokens.css, manifest.json, CLAUDE.md, other apps).
  Use the extension points instead (`registerCommand`, `registerTile`, `registerLockWidget`, `addIcons`, `registerMedia`, `registerSettingsSection`,
  `registerWidget`, `registerActivity`, `search()`, bg hub). Missing defaults: handle in your module
  (`store.get('x') || {…}`), don't add to store.js. If a shared change is truly needed, describe it in your report.
- Other workers are building other apps in the same tree right now. Never touch their files, never run git, never
  delete or "clean up" files you didn't create, never kill processes you didn't start.

## Rules

- No build step, no inline scripts, no eval, no network services (unless your brief says so). Optional
  permissions only through `ensure()` from `js/core/perm.js` inside a click handler. Permissions already in the
  manifest: storage, unlimitedStorage, topSites, search, alarms, notifications, contextMenus, favicon, geolocation,
  offscreen, idle; optional bookmarks, history, tabs, tabGroups, sessions, downloads, downloads.open.
- Binary data (pictures, audio) in IndexedDB through `js/core/blobs.js`, JSON in `store` under keys named after
  your app (e.g. `health`, `healthPrefs`). Escape user text (`escapeHtml`) whenever you build HTML strings.
- **English + Arabic** for every visible string: `addStrings({ en, ar })` with keys prefixed by your app id
  (`health.water`). Reuse Arabic wording from `/home/aminking/ios-ext/js/lang/ar.js` where the English matches.
  Arabic is RTL: use logical CSS properties (`inset-inline-start`, `margin-inline-end`, `text-align: start`),
  mirror directional icons (`back`/`forward` chevrons) with `[dir=rtl] … { transform: scaleX(-1) }` only where the
  shell doesn't already, and keep numbers/units readable (`⁦…⁩` isolates).
- Light and dark (`html[data-theme=dark]`), narrow and wide windows (`size: 'wide'` gives a tablet-width window;
  the maximize button makes it full screen) must all look right.
- Keep the app's `js/apps/<id>.js` light (it loads at every new tab): registration + widgets + commands; the UI
  module loads when the app opens.

## Tests (required)

- `.dev/<id>.cjs`, first line `// triple` (so runall runs it in light, dark and Arabic), using the harness API in
  CLAUDE.md › Testing (`boot`, `ok`, `openApp`, `click`, `shot`, `mod`…). Cover the main flows end to end and the
  data written to storage. Pure logic gets a plain-node `.dev/<id>-<what>.mjs` (exit 1 on failure).
- Run with `.dev/run.sh .dev/<id>.cjs`, then `THEME=dark .dev/run.sh …` and `UI=ar .dev/run.sh …`. Only through
  run.sh (it queues for a Chrome slot; waiting a minute is normal). **Look at your screenshots** (Read the PNGs
  in `.dev/shots/`) in light, dark and Arabic and fix what looks wrong or un-Samsung-like.
- Finish with `.dev/run.sh .dev/smoke.cjs` and `python3 scripts/check_i18n.py` (must be 0 problems in your files).

## Report (your final message, under 400 words)

Files created; features done; features left out and why; test results (checks passed in light/dark/Arabic, smoke,
i18n); shared-file lines you added; anything you think the shell needs (hooks, settings, home-screen placement);
the text for your app's line in CLAUDE.md › Features.

## Wave 3 (shell features and upgrades)

Wave-3 workers change shell or existing-app files. Your prompt lists the files **you own** for this task: you may
edit those freely (they are not "one line only"). Everything else in the rules above still holds; in particular,
re-read any file right before editing it (other workers may have touched it), keep the extension points working
(`js/core/hooks.js`), keep every existing test passing (`.dev/runall.sh <filter>` for the suites near your change,
and `.dev/run.sh .dev/smoke.cjs`), and update or extend the existing suites for what you change. New apps built in
waves 1–2 live in `js/apps/{health,wallet,contacts,games,music,recorder,interpreter,routines,journal,canvas,store,wellbeing}.js`
and their folders; read their registration files to integrate with them, don't rewrite them.
Under automation (`navigator.webdriver`), anything that would pop up by itself (tours, What's New, briefs) must stay
hidden unless a test asks for it (e.g. localStorage `bt.test.<feature>`), so other suites aren't disturbed.
