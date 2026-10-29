// Builds the Chrome Web Store images from the shots in store/screens: five captioned 1280×800 screenshots, the
// 440×280 small promo tile and the 1400×560 marquee, all in store/. Together they show every app and the headline
// features of the shell.
// usage: .dev/run.sh --raw node .dev/store-compose.cjs     (run .dev/store-shots.cjs first with OUT=store/screens)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SRC = path.join(ROOT, 'store/screens'), OUT = path.join(ROOT, 'store');
const img = (n) => 'file://' + path.join(SRC, n + '.png');

// A tile: { s: shot, t: title, d: subtitle, c?: [x, y, width] crop in shot pixels (the height follows the tile's shape;
// without one the shot covers the tile), bg?: fit the shot's width instead, top aligned, on this colour (an app's own
// background), big?: two columns and two rows, side?: the side panel next to a web page }.
// Pop-up windows sit at x 410–870 in a shot; full-screen apps fill it.
const SLIDES = [
  { file: 'screenshot-1-home', kind: 'hero', accent: '#9b8cff',
    eyebrow: 'Bloom Tab', title: 'One UI style, on every new tab', sub: 'Lock screen, widgets, Now Brief, Quick Panel and 20 built-in apps. Free, private, no account.',
    home: '02-home', lock: '01-lock', brief: '03-brief' },
  { file: 'screenshot-2-apps', kind: 'bento', accent: '#c084fc',
    eyebrow: '20 built-in apps', title: 'Apps for your whole day', sub: 'Health, Wallet, Journal, Music, games and more. Everything stays on your computer.',
    tiles: [
      { s: '18-health', t: 'Health', d: 'Activity rings, medications, water, sleep, mood', big: true, bg: '#f4f4f6' },
      { s: '19b-wallet-pass', t: 'Wallet', d: 'Passes with real barcodes, bills', c: [340, 40, 600] },
      { s: '21-journal', t: 'Journal', d: 'Moments, photos and moods', c: [0, 186, 800] },
      { s: '22-games', t: 'Gaming Hub', d: 'Daily puzzles, chess, solitaire', c: [70, 261, 860] },
      { s: '23b-music-player', t: 'Music', d: 'Your own songs, with lyrics', c: [60, 90, 1100] },
      { s: '20-contacts', t: 'Contacts', d: 'Groups, birthdays, vCard' },
      { s: '24-canvas', t: 'Canvas', d: 'An endless board for ideas' },
      { s: '25m-interpreter', t: 'Interpreter', d: 'On-device translation', c: [190, 100, 900] },
      { s: '26-recorder', t: 'Voice Recorder', d: 'Record, bookmark, transcribe', c: [340, 40, 600] },
    ] },
  { file: 'screenshot-3-essentials', kind: 'bento', accent: '#60a5fa',
    eyebrow: 'Everyday essentials', title: 'The classics, done right', sub: 'Weather, Calendar, Notes, Reminder, Clock and Calculator, one click away in every tab.',
    tiles: [
      { s: '12b-weather-full', t: 'Weather', d: 'Hourly, 10-day, air quality, rain alerts', big: true },
      { s: '13-calendar-month', t: 'Calendar', d: 'Year, month, week, day, list', c: [80, 50, 1120] },
      { s: '14-notes', t: 'Notes', d: 'Checklists, tables, drawings', c: [100, 40, 1080] },
      { s: '15-reminder', t: 'Reminder', d: 'Today, Scheduled, categories', c: [340, 40, 600] },
      { s: '16-clock-world', t: 'Clock', d: 'Alarms, world clock, timers', c: [340, 40, 600] },
      { s: '17-calculator', t: 'Calculator', d: 'Scientific and unit converter', c: [340, 230, 600] },
      { s: '28-wellbeing', t: 'Digital Wellbeing', d: 'Screen time, site timers', c: [60, 324, 760] },
      { s: '27-routines', t: 'Modes and Routines', d: 'Automate your browser day', c: [340, 140, 600] },
      { s: '29m-galaxy-store', t: 'Website store', d: 'Add popular sites in a click', c: [70, 40, 1140] },
    ] },
  { file: 'screenshot-4-multitask', kind: 'bento', accent: '#2dd4bf',
    eyebrow: 'Multitasking', title: 'Work like on a tablet', sub: 'Pop-up windows, split screen and Recents, with the Quick Panel and Finder a key away.',
    tiles: [
      { s: '09-multi-window', t: 'Multi window', d: 'Several apps at once: move, resize, minimise', big: true, c: [40, 0, 1150] },
      { s: '10-split-screen', t: 'Split screen', d: 'Two apps side by side' },
      { s: '11-recents', t: 'Recents', d: 'Apps, Chrome tabs, workspaces' },
      { s: '05-quick-panel', t: 'Quick Panel', d: 'Buttons, media, notifications', c: [330, 0, 620] },
      { s: '06-finder-command', t: 'Finder', d: 'Search, answers and commands', c: [260, 40, 760] },
      { s: '08-edge-panel', t: 'Edge panel', d: 'Your favourite apps, one swipe', c: [600, 100, 680] },
      { s: '07-apps-screen', t: 'Apps screen', d: 'Every app and site, A to Z' },
      { side: '35-side-panel', t: 'Side panel', d: 'Notes and more next to any site' },
      { s: '33-daily-board', t: 'Daily Board', d: 'A photo frame clock for your desk' },
    ] },
  { file: 'screenshot-5-yours', kind: 'bento', accent: '#f472b6',
    eyebrow: 'Make it yours', title: 'Personal and private', sub: 'Light and dark, wallpapers, themed icons and a screen lock PIN, in English and Arabic.',
    tiles: [
      { s: '31-home-dark', t: 'Dark mode and themed icons', d: 'A look that follows your wallpaper', big: true, c: [65, 0, 1150] },
      { s: '34-arabic-home', t: 'English and العربية', d: 'Full right-to-left layout' },
      { s: '34b-arabic-calendar', t: 'Arabic everywhere', d: 'Every app, menu and widget', c: [60, 40, 1160] },
      { s: '01b-lock-style', t: 'Lock screen styles', d: 'Clocks, fonts, widgets, Now Bar' },
      { s: '32-pin', t: 'Screen lock PIN', d: 'Keeps your apps private', c: [380, 90, 520] },
      { s: '30b-wallpaper', t: 'Wallpaper and style', d: '22 live wallpapers, your photos', c: [340, 120, 600] },
      { s: '37-dark-calendar', t: 'Dark apps', d: 'Easy on the eyes at night', c: [80, 50, 1120] },
      { s: '30-settings', t: 'Settings', d: 'Search any setting, back up all', c: [340, 140, 600] },
      { s: '03-brief', t: 'Now Brief', d: 'Your day, every morning', c: [260, 20, 760] },
    ] },
];

// grid geometry: four columns, three rows, a two-line caption under every tile
const COLS = 4, TW = 268, TH = Math.round(TW * 0.625), GX = 22, CAP = 40, GY = 12, TOP = 132;
const LEFT = Math.round((1280 - (COLS * TW + (COLS - 1) * GX)) / 2);

// The extension's icon drawn as SVG (icons/ only has 128 px): a violet-to-pink squircle with two sparkles.
const spark = (cx, cy, r, k = 0.16) => `M${cx} ${cy - r}C${cx + r * k} ${cy - r * k} ${cx + r * k} ${cy - r * k} ${cx + r} ${cy}C${cx + r * k} ${cy + r * k} ${cx + r * k} ${cy + r * k} ${cx} ${cy + r}C${cx - r * k} ${cy + r * k} ${cx - r * k} ${cy + r * k} ${cx - r} ${cy}C${cx - r * k} ${cy - r * k} ${cx - r * k} ${cy - r * k} ${cx} ${cy - r}Z`;
const ICON = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 128 128"><defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8c7bff"/><stop offset=".6" stop-color="#b26bf5"/><stop offset="1" stop-color="#ff79b0"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="36" fill="url(#ig)"/><path d="${spark(56, 56, 36)}" fill="#fff"/><path d="${spark(94, 94, 13)}" fill="#fff"/></svg>`;

const FONTS = `
@font-face { font-family: Outfit; font-weight: 100 900; src: url("file://${ROOT}/fonts/outfit.woff2") format("woff2"); }
@font-face { font-family: Inter; font-weight: 100 900; src: url("file://${ROOT}/fonts/inter.woff2") format("woff2"); }
@font-face { font-family: NotoArabic; font-weight: 100 900; src: url("file://${ROOT}/fonts/noto-arabic.woff2") format("woff2"); }`;
const css = `${FONTS}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1280px; height: 800px; overflow: hidden; }
body { font-family: Inter, NotoArabic, system-ui, sans-serif; color: #fff; background: #0d0b1f; position: relative; -webkit-font-smoothing: antialiased; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(760px 480px at 8% -6%, color-mix(in oklab, var(--a) 62%, transparent), transparent 70%),
  radial-gradient(820px 560px at 104% 108%, color-mix(in oklab, var(--a) 40%, #3b1d8f), transparent 72%),
  radial-gradient(600px 420px at 70% 10%, rgba(255, 121, 176, .22), transparent 70%),
  linear-gradient(160deg, #191442, #0d0b1f 60%); }
header { position: absolute; left: 0; right: 0; top: 22px; text-align: center; padding: 0 60px; }
.eyebrow { display: inline-block; font-size: 12.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #fff; padding: 5px 12px; border-radius: 99px; background: color-mix(in oklab, var(--a) 38%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--a) 70%, transparent); }
h1 { font-family: Outfit, Inter, sans-serif; font-size: 38px; line-height: 1.08; font-weight: 600; letter-spacing: -.015em; margin-top: 9px; }
header p { font-size: 16px; line-height: 1.3; color: rgba(255,255,255,.74); margin-top: 6px; }
.hero header { top: 28px; } .hero h1 { font-size: 46px; margin-top: 10px; } .hero header p { font-size: 18px; margin-top: 9px; }
.shot { display: block; border-radius: 14px; box-shadow: 0 18px 44px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.14); overflow: hidden; position: relative; background: #000; }
.shot img { position: absolute; display: block; max-width: none; }
.tile { position: absolute; }
.tile figcaption { margin-top: 7px; text-align: center; line-height: 1.2; white-space: nowrap; }
.tile b { display: block; font-size: 14.5px; font-weight: 650; }
.tile span { display: block; font-size: 12px; color: rgba(255,255,255,.64); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
.tile.big b { font-size: 17px; } .tile.big span { font-size: 13.5px; }
.hcard { position: absolute; border-radius: 18px; box-shadow: 0 26px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.16); overflow: hidden; background: #000; }
.hcard img { position: absolute; display: block; max-width: none; }
.web { position: absolute; inset: 0; background: #f6f7fb; color: #1d1d27; font-family: Inter, sans-serif; }
.web .bar { height: 11%; background: #fff; border-bottom: 1px solid #e5e7ef; display: flex; align-items: center; gap: 6%; padding: 0 5%; }
.web .bar i { display: block; height: 22%; border-radius: 9px; background: #d9dce7; }
.web .art { padding: 5% 6%; }
.web .art b { display: block; font-size: 15px; line-height: 1.15; font-weight: 750; }
.web .art em { display: block; height: 30%; margin: 6% 0; border-radius: 8px; background: linear-gradient(135deg, #ffb36b, #ff7e8a 50%, #6a5acd); }
.web .art u { display: block; height: 6px; margin: 7px 0; border-radius: 4px; background: #dfe2ec; text-decoration: none; }
`;

// a shot cropped to [x, y, w] (height from the box's shape) and scaled into a w × h box; without a crop it covers the box
const crop = (name, w, h, c) => {
  if (!c) { const k = Math.max(w / 1280, h / 800); return `<img src="${img(name)}" style="width:${1280 * k}px;height:${800 * k}px;left:${(w - 1280 * k) / 2}px;top:${(h - 800 * k) / 2}px">`; }
  let [x, y, cw] = c; const ch = (cw * h) / w;
  if (y + ch > 800) y = Math.max(0, 800 - ch);
  const k = w / cw;
  return `<img src="${img(name)}" style="width:${1280 * k}px;height:${800 * k}px;left:${-x * k}px;top:${-y * k}px">`;
};
// the side panel (a 420×800 shot) next to a made-up article page, as Chrome shows it
const sideTile = (name, w, h) => {
  const pw = Math.round((h * 420) / 800);
  return `<div class="shot" style="width:${w}px;height:${h}px"><div class="web" style="right:${pw}px"><div class="bar"><i style="width:18%"></i><i style="width:12%"></i><i style="width:14%"></i></div>
    <div class="art"><b>A weekend in Lisbon: what to see</b><em></em><u></u><u style="width:92%"></u><u style="width:80%"></u><u></u><u style="width:60%"></u></div></div>
    <div style="position:absolute;right:0;top:0;bottom:0;width:${pw}px;box-shadow:-8px 0 24px rgba(0,0,0,.25)"><img src="${img(name)}" style="left:0;top:0;width:${pw}px;height:${h}px"></div></div>`;
};

function tileHTML(tl, x, y, w, h) {
  const inner = tl.side ? sideTile(tl.side, w, h)
    : tl.bg ? `<div class="shot" style="width:${w}px;height:${h}px;background:${tl.bg}"><img src="${img(tl.s)}" style="left:0;top:0;width:${w}px;height:${(w * 800) / 1280}px"></div>`
    : `<div class="shot" style="width:${w}px;height:${h}px">${crop(tl.s, w, h, tl.c)}</div>`;
  return `<figure class="tile${tl.big ? ' big' : ''}" style="left:${x}px;top:${y}px;width:${w}px">${inner}<figcaption><b>${tl.t}</b><span>${tl.d}</span></figcaption></figure>`;
}

function gridHTML(tiles) {
  // cells left to right, top to bottom; a big tile takes the first free 2×2 block
  const taken = new Set(), out = [], free = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < COLS; c++) free.push([r, c]);
  for (const tl of tiles) {
    const cell = free.find(([r, c]) => !taken.has(r + ':' + c) && (!tl.big || (c + 1 < COLS && r + 1 < 3 && !taken.has(r + ':' + (c + 1)) && !taken.has(r + 1 + ':' + c) && !taken.has(r + 1 + ':' + (c + 1)))));
    if (!cell) { console.log('no room for', tl.t); continue; }
    const [r, c] = cell, x = LEFT + c * (TW + GX), y = TOP + r * (TH + CAP + GY);
    if (tl.big) {
      for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) taken.add(r + dr + ':' + (c + dc));
      out.push(tileHTML(tl, x, y, TW * 2 + GX, TH * 2 + CAP + GY));
    } else { taken.add(r + ':' + c); out.push(tileHTML(tl, x, y, TW, TH)); }
  }
  return out.join('');
}

// the Home screen in front; the Lock screen and the Now Brief beside it, over its empty corners
const heroHTML = (s) => `<div class="hcard" style="left:200px;top:170px;width:880px;height:550px">${crop(s.home, 880, 550)}</div>
  <div class="hcard" style="left:28px;top:470px;width:420px;height:262px">${crop(s.lock, 420, 262, [200, 20, 880])}</div>
  <div class="hcard" style="left:918px;top:262px;width:340px;height:346px;border-radius:22px">${crop(s.brief, 340, 346, [258, 14, 764])}</div>`;

const slideHTML = (s) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
  <body class="${s.kind}" style="--a:${s.accent}"><div class="bg"></div><header><div class="eyebrow">${s.eyebrow}</div><h1>${s.title}</h1><p>${s.sub}</p></header>
  ${s.kind === 'hero' ? heroHTML(s) : gridHTML(s.tiles)}</body></html>`;

const promoCss = (w, h) => `${FONTS}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { font-family: Inter, sans-serif; color: #fff; position: relative; -webkit-font-smoothing: antialiased;
  background: radial-gradient(70% 90% at 0% 0%, #7b6cff, transparent 70%), radial-gradient(80% 100% at 100% 100%, #ff6fa8, transparent 70%), radial-gradient(60% 80% at 80% 0%, #3aa0ff, transparent 70%), linear-gradient(135deg, #4b2fc4, #7a3fd6 55%, #c04fb0); }
h1 { font-family: Outfit, Inter, sans-serif; font-weight: 600; letter-spacing: -.02em; line-height: 1; }
.shot { position: absolute; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 70px rgba(20, 5, 60, .5), 0 0 0 1px rgba(255,255,255,.2); }
.shot img { position: absolute; display: block; max-width: none; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips span { font-size: 14.5px; font-weight: 600; padding: 7px 13px; border-radius: 99px; background: rgba(255,255,255,.14); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
`;

// Small promo tile (440×280): the icon, the name and what it is, big enough to read in the Store's grid
const promoSmall = () => `<!doctype html><html><head><meta charset="utf-8"><style>${promoCss(440, 280)}
.t { position: absolute; left: 28px; top: 30px; z-index: 1; }
.t h1 { font-size: 42px; margin-top: 16px; }
.t p { font-size: 19px; font-weight: 650; line-height: 1.22; margin-top: 9px; color: rgba(255,255,255,.92); }
</style></head><body>
<div class="shot" style="left:262px;top:34px;width:300px;height:188px;border-radius:12px">${crop('02-home', 300, 188)}</div>
<div class="shot" style="left:250px;top:150px;width:220px;height:138px;border-radius:10px">${crop('01-lock', 220, 138, [200, 20, 880])}</div>
<div class="t">${ICON(68)}<h1>Bloom Tab</h1><p>One UI style<br>new tab &amp; widgets</p></div>
</body></html>`;

// Marquee (1400×560): the same brand gradient, the icon and name, the Home screen and the Lock screen
const marquee = () => `<!doctype html><html><head><meta charset="utf-8"><style>${promoCss(1400, 560)}
.t { position: absolute; left: 64px; top: 64px; width: 540px; }
.t h1 { font-size: 72px; margin-top: 20px; }
.t p { font-size: 23px; line-height: 1.3; font-weight: 600; color: rgba(255,255,255,.9); margin: 12px 0 24px; }
</style></head><body>
<div class="t">${ICON(96)}<h1>Bloom Tab</h1><p>Your new tab, the One UI way: widgets, a Lock screen and 20 built-in apps.</p>
<div class="chips"><span>Lock screen</span><span>Widgets</span><span>Now Brief</span><span>Quick Panel</span><span>Multi window</span><span>Health</span><span>Wallet</span><span>Notes</span><span>Weather</span></div></div>
<div class="shot" style="left:640px;top:40px;width:640px;height:400px">${crop('02-home', 640, 400)}</div>
<div class="shot" style="left:1000px;top:280px;width:380px;height:238px">${crop('01-lock', 380, 238, [200, 20, 880])}</div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, pipe: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--allow-file-access-from-files'], defaultViewport: { width: 1280, height: 800 } });
  const page = await browser.newPage();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-slides-'));
  let problems = 0;
  const render = async (name, html, w, h) => {
    const f = path.join(tmp, name + '.html');
    fs.writeFileSync(f, html);
    await page.setViewport({ width: w, height: h });
    await page.goto('file://' + f, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
    if (missing.length) { problems++; console.log('missing in', name + ':', missing.join(', ')); }
    // a caption wider than its tile would be cut off
    const wide = await page.evaluate(() => [...document.querySelectorAll('.tile')].flatMap((t) => [...t.querySelectorAll('b, span')].filter((n) => n.scrollWidth > t.clientWidth + 1).map((n) => n.textContent)));
    if (wide.length) { problems++; console.log('too wide in', name + ':', wide.join(' | ')); }
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('wrote', name + '.png');
  };
  for (const s of SLIDES) await render(s.file, slideHTML(s), 1280, 800);
  await render('promo-small', promoSmall(), 440, 280);
  await render('promo-marquee', marquee(), 1400, 560);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(problems ? 1 : 0);
})();
