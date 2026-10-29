# Bloom Tab — Samsung One UI–style New Tab for Chrome

Bloom Tab turns every new tab into a home screen inspired by Samsung's One UI: a Lock screen with the Now Bar,
pages of apps, websites, folders and widgets, the Quick Panel, the Edge panel, Finder, real pop-up app windows and
twenty built-in apps. No account, no ads, no tracking — everything stays on your computer. English and Arabic,
light and dark.

## Features

**Lock screen and Now Brief**
- Clock styles and fonts, Lock screen widgets from every app, notifications, live activities in the Now Bar
- Optional screen-lock PIN (Samsung keypad, lockout after wrong tries) that guards apps, new tabs and the side panel;
  "Hide content" for notifications
- Now Brief every morning and evening: weather, events, reminders, doses, birthdays, bills, goals; Bedtime mode
- Daily Board ambient mode: photo frame, big clock, calendar and widgets, keeps the screen awake

**Home screen**
- Pages of apps, sites, folders and widgets; the dock; the Apps screen (A–Z or your own order, with folders)
- One UI edit mode: page manager, main page, undo/redo, themed/dark/clear icons, badges, Lock Home screen layout
- The Now Brief page of widgets to the left of the first page; drag a link from Chrome to add a site
- Add any website from the page you're on (Alt Shift H), even as a web app in its own window

**Quick Panel, Finder, windows**
- Quick Panel with editable buttons, brightness, sounds, media card and notifications; Edge panel
- Finder: apps, settings, notes and every app's content; maths, units, time in a city, Hijri dates; commands in
  English and Arabic ("timer 5m", "remind me…", "lunch with Sara Friday 1pm", "drink 500ml"…); on-device AI answers
  and voice input where Chrome supports them
- Multi window: several pop-up windows, resize, minimise to a floating icon, split screen; Recents (Alt R) with your
  Chrome tabs and workspaces

**Apps**
- **Samsung Notes**: folders, tags, pictures, drawings, tables, voice notes, locked notes, PDF/Markdown export,
  Writing assist (proofread, styles, summary, format, translate — on-device)
- **Reminder**, **Calendar** (Year/Month/Week/Day/List, repeating events, .ics import and subscriptions, Hijri),
  **Clock** (alarms that ring with no tab open, world map, stopwatch, several timers), **Calculator** (scientific,
  unit converter, history), **Weather** (several cities, detail cards, rain alerts)
- **Samsung Health**: activity rings, medications with reminders, water, sleep, mood, body, cycle tracking, breathing
- **Samsung Wallet**: passes with real barcodes, subscriptions and bills, spending
- **Contacts** (vCard, birthdays, groups), **Journal** (photos, moods, insights, lock), **Voice Recorder**
  (on-device speech-to-text), **Music** (your own files, keeps playing after the tab closes), **Canvas** (endless
  board), **Gaming Hub** (Sudoku, Minesweeper, Solitaire, Chess, 2048, daily puzzles)
- **Interpreter** (on-device translation, conversation mode), **Modes and Routines** (If/Then automations),
  **Digital Wellbeing** (screen time, site timers, focus modes, bedtime mode), **My Files** (downloads),
  **Galaxy Store** (popular websites to add to the Home screen), **Settings** (wallpapers, Sync with Chrome, backup)

**Everywhere**: Quick capture a note, reminder, journal entry or log from any website (Alt Shift Q); the side panel
with Notes, Reminder, Clock, Calculator and Music next to any page (Alt Shift L).

## Install (developer mode)

1. Download or clone this folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.
3. Open a new tab. If Chrome asks "Change back to Google?", choose **Keep it**.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Start typing, `/` or `Ctrl/⌘ K` | Finder (`Tab` asks the AI assistant) |
| `Alt A` or `↑` · `Alt Q` or `↓` · `Alt E` | Apps screen · Quick Panel · Edge panel |
| `Alt R` · `Alt L` · `Alt ,` | Recents · Lock · Settings |
| `←` `→` | Home screen pages (the first `←` opens the Now Brief page) |
| `Ctrl Z` / `Ctrl Y` (editing the Home screen) | Undo / redo |
| `Alt Shift H` (any website) | Add the page to the Home screen or Edge panel |
| `Alt Shift Q` (any website) | Quick capture (`Ctrl Enter` saves, `Alt N/R/J/L` switch kind) |
| `Alt Shift L` (any website) | Side panel (`Alt 1–5` switch tabs) |
| `Esc` | Close the top-most menu, dialog, page or window |

Each app's own shortcuts are listed in Settings › Advanced features › Keyboard shortcuts. On a Mac, `Alt` is `⌥`.

## Privacy

See [PRIVACY.md](PRIVACY.md). Weather comes from Open-Meteo; translation, Writing assist, AI answers and
speech-to-text use Chrome's built-in on-device models. Optional permissions are asked for only when you turn on the
feature that needs them.

## Development

- No build step: plain ES modules. Edit, then reload the extension in `chrome://extensions`.
- `CLAUDE.md` is the project guide: architecture, extension points, conventions, the parity roadmap and status.
- Tests drive the real extension in headless Chrome: `cd .dev && npm i` once, then `.dev/run.sh .dev/<suite>.cjs`
  (`THEME=dark`, `UI=ar`) or `.dev/runall.sh` for everything; plain-node logic tests are `.dev/*.mjs`.
- `python3 scripts/check_i18n.py` checks that every string has English and Arabic.
- `scripts/package.sh` builds `dist/bloom-tab-<version>.zip` for the Chrome Web Store (texts in `store/listing.md`).

## Credits

Weather: [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Fonts: Inter, Outfit, Noto Sans Arabic (SIL Open Font
License). Sounds and tones are synthesised with the Web Audio API.

Bloom Tab is an independent project and is not affiliated with, endorsed by, or sponsored by Samsung Electronics.
Samsung, Galaxy and One UI are trademarks of Samsung Electronics Co., Ltd.
