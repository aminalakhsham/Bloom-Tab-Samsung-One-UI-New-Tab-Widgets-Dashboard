# Chrome Web Store listing — Bloom Tab

Lessons from the sister project (Liquid Tab): the Store rejected a description for **keyword spam** because it listed
search engines and AI assistants by name. **Never list brand names** (search engines, AI assistants, websites, phone
makers' apps) in the summary or description. Use generic words ("your favourite search engine", "AI assistants").

## Name
Bloom Tab: Samsung One UI New Tab, Widgets & Dashboard

(From `_locales/*/messages.json` `extName`, ≤ 75 characters. The words people search for — Samsung, One UI, new tab,
widgets, dashboard — are in the name because the Store weighs the name most. **Risk:** the Store can reject a name that
uses another company's brand (trademark/impersonation). If it does, fall back to "Bloom Tab — One UI Style New Tab"
and keep "Samsung One UI style" in the summary and description only. The description always says Bloom Tab is not
affiliated with Samsung.)

## Summary (≤ 132 characters)
Samsung One UI style new tab page: Galaxy-like home screen, widgets, lock screen, notes, weather, clock and 20 apps. Private, free.

## Category
Productivity

## Description

Turn every new tab into a home screen inspired by Samsung's One UI on Galaxy phones and tablets: a Lock screen with the Now Bar, pages of apps, sites,
folders and widgets, the Quick Panel, the Edge panel, Finder search and real pop-up app windows you can move, resize,
minimise and use side by side. Everything runs on your computer: no account, no ads, no tracking.

HOME SCREEN
• Pages of websites, apps, folders and widgets, the dock and the Apps screen
• Edit mode with a page manager, undo, themed and dark icons, and a widget column on the left page
• Add any website to the Home screen from the page you're on, or open it as a web app

LOCK SCREEN AND NOW BRIEF
• Clock styles and fonts, widgets, notifications and live activities in the Now Bar
• Optional screen-lock PIN that protects your apps, new tabs and the side panel
• A morning and evening Now Brief with your weather, events, reminders and goals

BUILT-IN APPS
• Notes, Reminder, Calendar, Clock, Calculator with unit converter, and Weather
• Health: activity rings, medications with reminders, water, sleep, mood and cycle tracking
• Wallet: passes with real barcodes, subscriptions and bills, spending
• Contacts with vCard import and export, birthdays and groups
• Music player for your own files, Voice Recorder, and an endless Canvas
• Journal with photos, moods and insights
• Games: Sudoku, Minesweeper, Solitaire, Chess and 2048 with daily puzzles
• Interpreter: on-device translation with a conversation mode
• Modes and Routines to automate your browser day
• Digital Wellbeing: screen time, site timers, focus modes and bedtime mode
• My Files for your downloads, and a store of popular websites

EVERYWHERE
• Finder: search your apps, settings, notes and the web; quick answers and commands; on-device AI answers
• Quick capture a note, reminder or journal entry from any website
• Side panel with notes, reminders, timers, calculator and music next to any page
• Multi window: several apps at once, split screen and a Recents screen
• Daily Board ambient mode, wallpapers and colour palettes, light and dark mode
• English and Arabic, with full right-to-left support

PRIVATE BY DESIGN
Your data stays in your browser. Weather comes from an open weather service; translation, writing help and AI
answers use Chrome's built-in on-device models. Optional permissions are asked only when you turn on a feature.

Bloom Tab is an independent project and is not affiliated with Samsung.

## Permission justifications

- storage, unlimitedStorage: saves your settings, layout and app data (notes, events, pictures, recordings) on your device.
- alarms, notifications: timers, alarms, reminders, calendar, medication and bill alerts, even when no new tab is open.
- topSites: builds your first Home screen from the sites you visit most.
- favicon: shows websites' icons on the Home screen and in search.
- search: runs searches with your default search engine.
- contextMenus, activeTab, scripting: "Add to Home screen" and "Quick capture" on the page you're viewing, only when you choose them.
- sidePanel: the Bloom Tab side panel.
- offscreen: plays music and alarm sounds that continue after the new tab is closed.
- idle: counts breaks for the activity rings and pauses screen-time counting while you're away.
- geolocation: weather for your current location (only if you allow it).
- Optional bookmarks, history: show your bookmarks and history in search, when you turn it on.
- Optional tabs, tabGroups, sessions: screen time and site timers, website routines, Chrome tabs and workspaces in Recents.
- Optional downloads, downloads.open: the My Files app.
- Host permissions (Open-Meteo, Bing): weather forecasts and air quality; the optional Bing picture of the day.

Single purpose: Bloom Tab replaces the New Tab page with a customizable home screen and built-in productivity apps.

Data use: no user data is collected, sold or transferred. Privacy policy: PRIVACY.md (host it, e.g. as a gist, and
paste its URL).

## Images (to make)

1280×800 screenshots (up to 5), small promo tile 440×280, marquee 1400×560 — not made yet. The tests' screenshots in
`.dev/shots/` show every app and can serve as a starting point.
