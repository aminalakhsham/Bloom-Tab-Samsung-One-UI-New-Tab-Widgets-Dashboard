# Bloom Tab 1.0.0 — everything for the Chrome Web Store

Every text the Chrome Web Store Developer Dashboard asks for, in the order of its tabs. Copy what is inside each grey
box as it is (line breaks included). English is the main listing; Arabic is the second language (Dashboard ›
Store listing › language menu › Arabic).

**Still needed before you submit**
1. A contact email: put it in `PRIVACY.md` (it says "[contact email — to be filled in before publishing]") and in
   Dashboard › Account (the Store shows it to users and requires it to be verified).
2. Host `PRIVACY.md` somewhere public (the GitHub repo, if it is public, works) and paste its link in the Privacy tab.
3. Build the package from a quiet tree: `scripts/package.sh` → `dist/bloom-tab-1.0.0.zip`.

**Lessons from Liquid Tab (the sister project):** the Store rejected a description for *keyword spam* because it listed
search engines and AI assistants by name. Never list brand names (search engines, AI assistants, websites, other
companies' apps) in the summary or description. Use generic words ("your search engine", "AI assistants").

---

## 1. Package

Upload `dist/bloom-tab-1.0.0.zip` (Dashboard › Package › Upload new package). The name, summary and icon come from the
package (`_locales/*/messages.json` and `icons/icon128.png`); they can't be edited in the Dashboard.

---

## 2. Store listing

### Item name (from the package, 75 characters at most)

English (54 characters):
```text
Bloom Tab: Samsung One UI New Tab, Widgets & Dashboard
```

Arabic (64 characters):
```text
Bloom Tab: تبويب جديد بنمط Samsung One UI مع أدوات ولوحة معلومات
```

The words people search for (Samsung, One UI, new tab, widgets, dashboard) are in the name because the Store weighs the
name most. **Risk:** the Store can reject a name that uses another company's brand (trademark or impersonation). If it
does, change `extName` in both `_locales` files to the fallback below, keep "Samsung One UI style" in the summary and
description only, rebuild and upload again:
```text
Bloom Tab — One UI Style New Tab & Widgets
```
```text
Bloom Tab — تبويب جديد وأدوات بنمط One UI
```

### Summary (from the package, 132 characters at most)

English (131 characters):
```text
Samsung One UI style new tab page: Galaxy-like home screen, widgets, lock screen, notes, weather, clock and 20 apps. Private, free.
```

Arabic (127 characters):
```text
صفحة تبويب جديد بنمط Samsung One UI: شاشة رئيسية مثل Galaxy، وأدوات، وشاشة قفل، وملاحظات، وطقس، وساعة، و20 تطبيقًا. خاص ومجاني.
```

### Description (16,000 characters at most)

English:
```text
Turn every new tab into a home screen inspired by Samsung's One UI on Galaxy phones and tablets: a Lock screen with the Now Bar, pages of apps, websites, folders and widgets, the Quick Panel, the Edge panel, Finder search and real pop-up app windows you can move, resize, minimise and use side by side. Twenty built-in apps are ready in every tab. Everything runs on your computer: no account, no ads, no tracking.

HOME SCREEN AND WIDGETS
• Pages of websites, apps, folders and widgets, a dock and the Apps screen
• Widgets for weather, clocks, calendar, notes, reminders, health, wallet, music, screen time and more, in three sizes
• Edit mode like on a phone: page manager, undo, themed, dark and clear icons, badges
• A Now Brief page of widgets to the left of the first page
• Add the website you're on to the Home screen or the Edge panel, or open it as a web app in its own window

LOCK SCREEN AND NOW BRIEF
• Clock styles and fonts, Lock screen widgets, notifications and live activities in the Now Bar
• An optional screen lock PIN that protects your apps, new tabs and the side panel
• Now Brief every morning and evening: weather, events, reminders, doses, birthdays, bills and goals
• Daily Board: a photo frame clock with your calendar and widgets for your desk

BUILT-IN APPS
• Notes: folders, tags, checklists, tables, pictures, drawings, voice notes, locked notes, PDF and Markdown export
• Reminder: Today, Scheduled and your own categories, repeats, subtasks, early alerts; type "call Mom tomorrow at 6pm" and it sets the time
• Calendar: year, month, week, day and list views, repeating events, two alerts, .ics import and subscriptions, Hijri and other calendars
• Clock: alarms that ring even with no new tab open, a world clock map, a stopwatch and several timers
• Calculator: scientific keys, history and a unit converter
• Weather: up to 15 cities, hourly and 10-day forecasts, air quality, UV, sunrise, moon phases and rain alerts
• Health: daily activity rings, medications with reminders, water, sleep, mood, body, cycle tracking and breathing
• Wallet: passes with real QR, PDF417, Code 128 and EAN barcodes, subscriptions and bills with alerts, spending and budgets
• Contacts: favourites, groups, birthdays, vCard import and export, merge duplicates
• Journal: entries with photos and moods, suggestions from your day, insights and streaks, a PIN lock
• Music: plays your own music files and keeps playing after the tab closes, with lyrics, a queue, an equaliser and a sleep timer
• Voice Recorder: standard, interview and on-device speech-to-text modes, bookmarks and trimming
• Canvas: an endless board with sticky notes, shapes, connectors, a pen and pictures, with PNG and PDF export
• Gaming Hub: Sudoku, Minesweeper, Solitaire, Chess and 2048 with daily puzzles, streaks and achievements
• Interpreter: on-device translation with a conversation mode
• Modes and Routines: Sleep, Work and your own modes, and If/Then routines that automate your browser day
• Digital Wellbeing: screen time by site and category, site timers, focus modes and bedtime mode
• My Files: your downloads by category, recent files and a Recycle bin
• A store of popular websites to add to your Home screen in one click
• Settings: wallpapers, colour palette, notifications, accessibility, backup and sync

MULTITASKING AND SEARCH
• Multi window: several pop-up windows at once, split screen, and minimise to a floating icon
• Recents: your open apps, Chrome tabs, recently closed tabs and saved workspaces
• Quick Panel: Dark mode, Focus, Eye comfort shield, brightness, sounds, media and notifications
• Finder: search apps, settings, notes and every app's content; quick answers for maths, units, time zones and Hijri dates; commands like "timer 10 min", "remind me to…", "lunch with Sara Friday 1pm" or "drink 500 ml"; on-device AI answers where Chrome supports them
• Quick capture a note, reminder or journal entry from any website (Alt+Shift+Q)
• A side panel with Notes, Reminder, Clock, Calculator and Music next to any page (Alt+Shift+L)
• Writing assist on your device: proofread, change the tone, summarise and format

MAKE IT YOURS
• 22 live wallpapers with light and dark looks, your own photos, a picture of the day, and colours taken from your wallpaper
• Light and dark mode, themed icons, text size, high contrast and reduced motion
• English and Arabic, with a full right-to-left layout

PRIVATE BY DESIGN
Your notes, events, health logs, passes, recordings and photos stay in your browser on this computer. Bloom Tab has no account and no servers of its own, and it shows no ads. The weather service receives only the locations you choose. Translation, writing help, AI answers and speech-to-text use Chrome's built-in on-device models. Optional permissions (bookmarks, history, tabs, downloads) are asked for only when you turn on the feature that needs them. You can export or erase everything at any time.

Weather data by Open-Meteo.com (CC BY 4.0).

Bloom Tab is an independent project. It is not affiliated with, endorsed by or sponsored by Samsung. Samsung, Galaxy and One UI are trademarks of Samsung Electronics Co., Ltd.
```

Arabic:
```text
يحوّل Bloom Tab كل تبويب جديد إلى شاشة رئيسية مستوحاة من واجهة One UI من Samsung على هواتف Galaxy وأجهزتها اللوحية: شاشة قفل مع شريط Now، وصفحات من التطبيقات والمواقع والمجلدات والأدوات، واللوحة السريعة، ولوحة الحافة، والبحث عبر Finder، ونوافذ تطبيقات منبثقة حقيقية يمكنك تحريكها وتغيير حجمها وتصغيرها واستخدامها جنبًا إلى جنب. عشرون تطبيقًا مدمجًا جاهزة في كل تبويب. وكل شيء يعمل على جهازك: بلا حساب، وبلا إعلانات، وبلا تتبع.

الشاشة الرئيسية والأدوات
• صفحات من المواقع والتطبيقات والمجلدات والأدوات، مع شريط سفلي وشاشة التطبيقات
• أدوات للطقس والساعات والتقويم والملاحظات والتذكيرات والصحة والمحفظة والموسيقى ومدة استخدام الشاشة وغيرها، بثلاثة أحجام
• وضع تعديل كما في الهاتف: مدير الصفحات، والتراجع، وأيقونات بالسمة أو داكنة أو شفافة، وشارات الإشعارات
• صفحة «الموجز الآن» للأدوات على يسار الصفحة الأولى
• أضف الموقع الذي تتصفحه إلى الشاشة الرئيسية أو لوحة الحافة، أو افتحه كتطبيق ويب في نافذته الخاصة

شاشة القفل والموجز الآن
• أنماط وخطوط للساعة، وأدوات شاشة القفل، والإشعارات، والأنشطة الحية في شريط Now
• رمز PIN اختياري لقفل الشاشة يحمي تطبيقاتك والتبويبات الجديدة واللوحة الجانبية
• «الموجز الآن» كل صباح ومساء: الطقس والمواعيد والتذكيرات والجرعات وأعياد الميلاد والفواتير والأهداف
• «اللوحة اليومية»: ساعة بإطار صور مع التقويم والأدوات لمكتبك

التطبيقات المدمجة
• الملاحظات: مجلدات ووسوم وقوائم مهام وجداول وصور ورسومات وملاحظات صوتية وملاحظات مقفلة، مع التصدير إلى PDF وMarkdown
• التذكير: اليوم والمجدولة وفئاتك الخاصة، والتكرار والمهام الفرعية والتنبيه المبكر؛ اكتب «اتصل بأمي غدًا الساعة 6 م» فيُضبط الوقت تلقائيًا
• التقويم: عرض السنة والشهر والأسبوع واليوم والقائمة، والأحداث المتكررة، وتنبيهان لكل حدث، واستيراد ملفات ‎.ics‎ والاشتراك فيها، والتقويم الهجري وتقويمات أخرى
• الساعة: منبهات ترنّ حتى دون فتح تبويب جديد، وخريطة للساعة العالمية، وساعة إيقاف، وعدة مؤقتات
• الآلة الحاسبة: أزرار علمية، وسجل العمليات، ومحوّل للوحدات
• الطقس: حتى 15 مدينة، وتوقعات كل ساعة ولعشرة أيام، وجودة الهواء، والأشعة فوق البنفسجية، والشروق، وأطوار القمر، وتنبيهات المطر
• الصحة: حلقات النشاط اليومي، والأدوية مع التذكيرات، والماء، والنوم، والمزاج، وتكوين الجسم، وتتبع الدورة الشهرية، وتمارين التنفس
• المحفظة: بطاقات برموز QR وPDF417 وCode 128 وEAN حقيقية، والاشتراكات والفواتير مع التنبيهات، والمصروفات والميزانيات
• جهات الاتصال: المفضلة والمجموعات وأعياد الميلاد، واستيراد ملفات vCard وتصديرها، ودمج المكرر
• اليوميات: إدخالات بالصور والمزاج، واقتراحات من يومك، وإحصاءات وسلاسل أيام، وقفل برمز PIN
• الموسيقى: تشغّل ملفاتك الموسيقية وتستمر بعد إغلاق التبويب، مع كلمات الأغاني وقائمة الانتظار والمعادل الصوتي ومؤقت النوم
• مسجل الصوت: أوضاع عادي ومقابلة وتحويل الكلام إلى نص على الجهاز، مع الإشارات المرجعية والقص
• اللوحة: مساحة لا نهائية للملاحظات اللاصقة والأشكال والموصلات والقلم والصور، مع التصدير إلى PNG وPDF
• مركز الألعاب: سودوكو وكاسحة الألغام والسوليتير والشطرنج و2048، مع ألغاز يومية وسلاسل أيام وإنجازات
• المترجم الفوري: ترجمة على الجهاز مع وضع المحادثة
• الأوضاع والإجراءات الروتينية: أوضاع النوم والعمل وأوضاعك الخاصة، وإجراءات «إذا… فإن…» تؤتمت يومك في المتصفح
• الصحة الرقمية: مدة استخدام الشاشة حسب الموقع والفئة، ومؤقتات المواقع، وأوضاع التركيز، ووضع وقت النوم
• ملفاتي: تنزيلاتك حسب الفئة، والملفات الأخيرة، وسلة المحذوفات
• متجر للمواقع الشائعة تضيفها إلى شاشتك الرئيسية بنقرة واحدة
• الإعدادات: الخلفيات ولوحة الألوان والإشعارات وإمكانية الوصول والنسخ الاحتياطي والمزامنة

تعدد المهام والبحث
• النوافذ المتعددة: عدة نوافذ منبثقة في آن واحد، وتقسيم الشاشة، والتصغير إلى أيقونة عائمة
• التطبيقات الحديثة: تطبيقاتك المفتوحة وتبويبات Chrome والتبويبات المغلقة مؤخرًا ومساحات العمل المحفوظة
• اللوحة السريعة: الوضع الداكن والتركيز ودرع راحة العين والسطوع والأصوات والوسائط والإشعارات
• Finder: ابحث في التطبيقات والإعدادات والملاحظات ومحتوى كل تطبيق؛ إجابات سريعة للحسابات والوحدات والمناطق الزمنية والتاريخ الهجري؛ أوامر مثل «مؤقت 10 دقائق» و«ذكّرني…» و«اشرب 500 مل»؛ وإجابات بالذكاء الاصطناعي على الجهاز حيث يدعمها Chrome
• تدوين سريع لملاحظة أو تذكير أو يومية من أي موقع (Alt+Shift+Q)
• لوحة جانبية فيها الملاحظات والتذكير والساعة والآلة الحاسبة والموسيقى بجانب أي صفحة (Alt+Shift+L)
• مساعد الكتابة على جهازك: التدقيق، وتغيير الأسلوب، والتلخيص، والتنسيق

اجعله لك
• 22 خلفية حية بمظهر فاتح وداكن، وصورك الخاصة، وصورة اليوم، وألوان مأخوذة من خلفيتك
• الوضع الفاتح والداكن، وأيقونات بالسمة، وحجم الخط، والتباين العالي، وتقليل الحركة
• العربية والإنجليزية، مع اتجاه كامل من اليمين إلى اليسار

الخصوصية أولًا
ملاحظاتك ومواعيدك وسجلاتك الصحية وبطاقاتك وتسجيلاتك وصورك تبقى في متصفحك على هذا الجهاز. لا يحتاج Bloom Tab إلى حساب، وليست له خوادم خاصة، ولا يعرض إعلانات. لا تتلقى خدمة الطقس إلا المواقع التي تختارها. وتستخدم الترجمة ومساعد الكتابة وإجابات الذكاء الاصطناعي وتحويل الكلام إلى نص نماذج Chrome المدمجة على الجهاز. ولا تُطلب الأذونات الاختيارية (الإشارات المرجعية، والسجل، والتبويبات، والتنزيلات) إلا عند تشغيل الميزة التي تحتاجها. ويمكنك تصدير كل شيء أو مسحه في أي وقت.

بيانات الطقس من Open-Meteo.com ‏(CC BY 4.0).

Bloom Tab مشروع مستقل، ولا يرتبط بشركة Samsung ولا تعتمده أو ترعاه. Samsung وGalaxy وOne UI علامات تجارية لشركة Samsung Electronics Co., Ltd.
```

### Category

Productivity. If the Dashboard asks for a sub-category, "Workflow & Planning"; "Make Chrome Yours › Functionality &
UI" fits too (choose one).

### Language

English (main). Add Arabic as a second language with the Arabic description above; the name and summary switch by
themselves from `_locales/ar`.

### Graphic assets (all in `store/`)

| Field | File | Size |
| --- | --- | --- |
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshot 1 | `store/screenshot-1-home.png` | 1280×800 |
| Screenshot 2 | `store/screenshot-2-apps.png` | 1280×800 |
| Screenshot 3 | `store/screenshot-3-essentials.png` | 1280×800 |
| Screenshot 4 | `store/screenshot-4-multitask.png` | 1280×800 |
| Screenshot 5 | `store/screenshot-5-yours.png` | 1280×800 |
| Small promo tile | `store/promo-small.png` | 440×280 |
| Marquee promo tile | `store/promo-marquee.png` | 1400×560 |

All are 24-bit PNG without transparency, as the Store asks. Upload the screenshots in this order (the first one is
the one people see first). The same images can be used for the Arabic listing (one of the five shows Arabic).
Remake them with `.dev/store-shots.cjs` then `.dev/store-compose.cjs` (see the top of each file); every name, place,
pass and photo in them is made up.

Text inside the images (for a translated set later):

| Image | Label | Title | Subtitle |
| --- | --- | --- | --- |
| 1 | Bloom Tab | One UI style, on every new tab | Lock screen, widgets, Now Brief, Quick Panel and 20 built-in apps. Free, private, no account. |
| 2 | 20 built-in apps | Apps for your whole day | Health, Wallet, Journal, Music, games and more. Everything stays on your computer. |
| 3 | Everyday essentials | The classics, done right | Weather, Calendar, Notes, Reminder, Clock and Calculator, one click away in every tab. |
| 4 | Multitasking | Work like on a tablet | Pop-up windows, split screen and Recents, with the Quick Panel and Finder a key away. |
| 5 | Make it yours | Personal and private | Light and dark, wallpapers, themed icons and a screen lock PIN, in English and Arabic. |
| Small tile | | Bloom Tab | One UI style new tab & widgets |
| Marquee | | Bloom Tab | Your new tab, the One UI way: widgets, a Lock screen and 20 built-in apps. |

### Additional fields

| Field | Value |
| --- | --- |
| Official URL | Leave empty (it needs a website verified in Google Search Console) |
| Homepage URL | `https://github.com/aminalakhsham/Bloom-Tab-Samsung-One-UI-New-Tab-Widgets-Dashboard` |
| Support URL | `https://github.com/aminalakhsham/Bloom-Tab-Samsung-One-UI-New-Tab-Widgets-Dashboard/issues` |
| Global promo video | None |
| Mature content | No |

The two GitHub links only work for other people if the repository is public.

---

## 3. Privacy practices

### Single purpose description
```text
Bloom Tab replaces Chrome's New Tab page with a customisable home screen in the style of a phone (widgets, a Lock screen, app windows) and the built-in productivity apps that live on it, such as notes, reminders, calendar, clock and weather. Everything it does happens on that New Tab page or on the side panel and quick sheets that open from it.
```

### Permission justifications

One box per permission. Optional permissions are listed too, in case the Dashboard asks for them.

**storage**
```text
Saves the user's settings, Home screen layout and app data (notes, reminders, events, alarms, contacts, journal entries, health logs, wallet passes) in chrome.storage on the user's device. Nothing is sent to a server.
```

**unlimitedStorage**
```text
Pictures added to notes, the journal, contacts and the wallet, voice recordings and the user's own music files are kept in IndexedDB on the device, which can grow beyond the default quota.
```

**topSites**
```text
On first run the Home screen is filled with the sites the user visits most, so the new tab is useful immediately. The list is read on the device and never sent anywhere.
```

**search**
```text
The search bar and Finder run web searches with the user's default search engine through chrome.search, instead of hard-coding a provider.
```

**alarms**
```text
Rings the user's alarms and timers and sends reminders, calendar alerts, medication reminders and bill alerts at the right time, even when no new tab is open.
```

**notifications**
```text
Shows the alarms, timers, reminders, calendar alerts, medication reminders and bill alerts the user created, with buttons such as Snooze, Dismiss and Taken.
```

**contextMenus**
```text
Adds "Add to Home screen", "Add to Edge panel", "Quick capture" and "Open side panel" to the right-click menu of pages and links.
```

**favicon**
```text
Shows websites' icons on the Home screen, in the Edge panel and in search results, from Chrome's own favicon cache (no network request).
```

**geolocation**
```text
Shows the weather for the user's current location, only after the user allows it. The user can type a city instead.
```

**offscreen**
```text
Plays the user's music and the alarm and timer sounds from an offscreen document, so they keep playing after the new tab is closed.
```

**idle**
```text
Counts breaks for the Daily activity rings in the Health app and pauses screen-time counting in Digital Wellbeing while the user is away from the computer.
```

**activeTab**
```text
When the user clicks the toolbar button or picks "Add to Home screen" / "Quick capture", reads the current page's title, address, selected text and icon to add the page or save a note. Only the tab the user acted on, only at that moment.
```

**scripting**
```text
Shows the "Add to Home screen" and "Quick capture" sheets over the page the user is on, only when the user asks for them (with the activeTab grant).
```

**sidePanel**
```text
Provides the Bloom Tab side panel with Notes, Reminder, Clock, Calculator and Music next to any page.
```

**bookmarks** (optional)
```text
Optional, requested only when the user turns on "Bookmarks in search": shows matching bookmarks in Finder's results on the device.
```

**history** (optional)
```text
Optional, requested only when the user turns on "History in search": shows matching pages from the browsing history in Finder's results on the device.
```

**tabs** (optional)
```text
Optional, requested only when the user turns on Digital Wellbeing, website routines or Chrome tabs in Recents: reads the site of the active tab to count screen time and run site timers on the device, and lists or switches open tabs.
```

**tabGroups** (optional)
```text
Optional, requested only when the user saves or opens a Workspace in Recents: reopens the saved websites as a named tab group.
```

**sessions** (optional)
```text
Optional, requested only for Recents' "Recently closed": lists and restores tabs the user closed recently.
```

**downloads** (optional)
```text
Optional, requested only when the user opens the My Files app: lists the user's downloads with progress, and can pause, resume, show or delete them.
```

**downloads.open** (optional)
```text
Optional, requested the first time the user opens a downloaded file from My Files.
```

**Host permissions** (api.open-meteo.com, geocoding-api.open-meteo.com, air-quality-api.open-meteo.com, www.bing.com)
```text
Open-Meteo provides the weather forecast, city search and air quality for the locations the user chooses (only coordinates or a city name are sent). Bing is contacted only if the user picks the "picture of the day" wallpaper, to download that picture.
```

**Optional host permissions** (https://*/*, http://*/*)
```text
Never granted at install. Chrome asks the user for one specific website only when the user subscribes to a calendar (.ics) on that website, so the calendar can be refreshed in the background.
```

### Remote code
```text
No, I am not using remote code.
```
All JavaScript is in the package; there is no eval and the default MV3 content security policy is kept.

### Data usage

Tick **Location** only: the weather locations (latitude and longitude, or a city name) are sent to Open-Meteo to get
the forecast. Everything else Bloom Tab handles (notes, health logs, passes, contacts, screen time, recordings) stays
on the user's device and is never sent to the developer or anyone else, so it is not "collected" in the Store's sense.
Sync with Chrome (off by default) stores data in the user's own Google account through Chrome, not on a server of ours.

Then tick the three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
```text
https://github.com/aminalakhsham/Bloom-Tab-Samsung-One-UI-New-Tab-Widgets-Dashboard/blob/main/PRIVACY.md
```
(Works when the repository is public; otherwise publish `PRIVACY.md` elsewhere, for example a GitHub Gist or GitHub
Pages, and use that link.)

---

## 4. Distribution

| Field | Value |
| --- | --- |
| Payments | Free of charge |
| Visibility | Public |
| Distribution | All regions |

---

## 5. Notes for the reviewer

Paste this if the Dashboard or a reviewer asks how to test the item:
```text
Open a new tab: Bloom Tab replaces the New Tab page. The first time, a short Welcome tour sets the language, theme and wallpaper (Skip works too). If the Lock screen shows, click it or press any key to unlock (no PIN is set by default). Apps open from the Home screen, the Apps button in the dock or Finder (start typing). On any website, the toolbar button or Alt+Shift+H shows "Add to Home screen", Alt+Shift+Q opens Quick capture and Alt+Shift+L the side panel. Optional permissions (bookmarks, history, tabs, tabGroups, sessions, downloads) are requested only when the matching feature is turned on. Translation, Writing assist, on-device AI answers and speech-to-text use Chrome's built-in on-device AI APIs and show a "not available" message where this Chrome doesn't provide them. No account is needed and no data is sent to the developer.
```

---

## 6. What's new (version notes)

For the GitHub release, or the What's new field if one is shown:
```text
Bloom Tab 1.0.0, the first release: a One UI style Lock screen, Home screen with widgets and folders, Now Brief, Quick Panel, Edge panel, Finder, multi window with split screen and Recents, a screen lock PIN, Quick capture from any website, a side panel, and 20 built-in apps (Notes, Reminder, Calendar, Clock, Calculator, Weather, Health, Wallet, Contacts, Journal, Music, Voice Recorder, Canvas, Gaming Hub, Interpreter, Modes and Routines, Digital Wellbeing, My Files, a website store and Settings). English and Arabic.
```

Arabic:
```text
Bloom Tab 1.0.0، الإصدار الأول: شاشة قفل بنمط One UI، وشاشة رئيسية بالأدوات والمجلدات، و«الموجز الآن»، واللوحة السريعة، ولوحة الحافة، وFinder، والنوافذ المتعددة مع تقسيم الشاشة والتطبيقات الحديثة، ورمز PIN لقفل الشاشة، والتدوين السريع من أي موقع، ولوحة جانبية، و20 تطبيقًا مدمجًا (الملاحظات، والتذكير، والتقويم، والساعة، والآلة الحاسبة، والطقس، والصحة، والمحفظة، وجهات الاتصال، واليوميات، والموسيقى، ومسجل الصوت، واللوحة، ومركز الألعاب، والمترجم الفوري، والأوضاع والإجراءات الروتينية، والصحة الرقمية، وملفاتي، ومتجر للمواقع، والإعدادات). بالعربية والإنجليزية.
```

---

## 7. Short texts for sharing

One line (English):
```text
Bloom Tab: a free, private One UI style home screen for every Chrome new tab, with widgets, a Lock screen and 20 built-in apps.
```

One line (Arabic):
```text
Bloom Tab: شاشة رئيسية مجانية وخاصة بنمط One UI لكل تبويب جديد في Chrome، مع الأدوات وشاشة القفل و20 تطبيقًا مدمجًا.
```
