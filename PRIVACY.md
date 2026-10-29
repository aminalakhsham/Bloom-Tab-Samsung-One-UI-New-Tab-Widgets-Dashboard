# Bloom Tab — Privacy Policy

_Last updated: 2026-10-28_

Bloom Tab replaces Chrome's New Tab page with a One UI–style home screen and built-in apps. It has no accounts,
no servers of its own, no analytics, no ads and no tracking. **Everything you create stays on your computer.**

## What is stored, and where

All data is stored locally by Chrome on your device:

- **`chrome.storage.local`**: your settings, Home screen layout, notes, reminders, calendar events, alarms and
  timers, contacts, journal entries, health logs (medications, water, sleep, mood, cycle), wallet passes,
  subscriptions and expenses, routines, game progress, screen-time totals, and the list of in-app notifications.
- **IndexedDB** (inside the extension): pictures you add (notes, journal, contacts, wallet, canvas, Daily Board),
  voice recordings, and music files you import.
- **`chrome.storage.session`**: short-lived values such as when the screen was last unlocked; cleared when Chrome
  closes.

Your screen-lock PIN and the Journal PIN are never stored: only a salted PBKDF2 hash is kept, and it is never
exported or synced.

You can export all of this to a file (Settings › Backup) and erase everything (Settings › Reset, or "Forgot PIN?").
Uninstalling the extension deletes all of it.

## Sync (optional, off by default)

If you turn on **Sync with Chrome**, a subset of your data (settings, Home screen layout, notes, reminders, events,
alarms, world clocks, contacts, wallet passes, routines, calendars) is saved to `chrome.storage.sync`, which Chrome
syncs through your Google account if you have Chrome Sync turned on. Pictures, audio, music, PINs, Journal, Health,
screen-time data, recordings and canvas boards are never synced.

## Network requests

Bloom Tab contacts only these services, and only for the features named:

| Service | When | What is sent |
| --- | --- | --- |
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`, `air-quality-api.open-meteo.com`) | Weather, rain alerts | The latitude/longitude of your weather locations, or the city name you search for |
| Bing (`www.bing.com`) | Only if you choose the Bing daily wallpaper | A request for the picture of the day |
| Calendar subscription URLs you add yourself | Only if you subscribe to a calendar (.ics) | A request to the address you entered (Chrome asks for permission for that site first) |
| Chrome's favicon service (local) | Website icons | Nothing leaves your computer: icons come from Chrome's own cache |
| The search engine or AI assistant you choose | Only when you search or ask | Your query, sent by opening that site in a tab, as if you typed it there |

Translation, Writing assist, on-device AI answers and speech-to-text use **Chrome's built-in on-device models**.
Bloom Tab never sends your text or audio anywhere; Chrome may download a model the first time you use a feature.
Voice input is only offered where Chrome can recognise speech on the device.

Links you open (websites, `tel:`/`mailto:` links, a video-call link from Contacts) open in Chrome like any other link.

## Permissions

Required: `storage`, `unlimitedStorage` (your data and files), `alarms` and `notifications` (timers, alarms,
reminders, medication and bill alerts), `topSites` and `favicon` (starter Home screen and website icons), `search`
(your default search engine), `contextMenus`, `activeTab` and `scripting` (Add to Home screen and Quick capture from
the page you're on, only when you ask), `sidePanel` (the side panel), `offscreen` (music and alarm sounds that keep
playing after the tab closes), `idle` (breaks in Daily activity and screen-time accuracy), `geolocation` (weather for
your current location, if you allow it).

Optional, asked only when you turn on the feature: `bookmarks`, `history` (Finder results), `tabs` (Digital
Wellbeing screen time and site timers, website-opened routines, Recents' Chrome tabs), `tabGroups` (Workspaces),
`sessions` (Recently closed in Recents), `downloads`, `downloads.open` (My Files).

## Children

Bloom Tab doesn't collect personal information from anyone, including children.

## Contact

Questions: **[contact email — to be filled in before publishing]**

Bloom Tab is an independent project and is not affiliated with, endorsed by, or sponsored by Samsung Electronics.
Samsung, Galaxy and One UI are trademarks of Samsung Electronics Co., Ltd.
