// Dev-only test harness: loads the unpacked extension in headless Chrome and runs one test script.
// usage: EXT=<dir> W=1440 H=900 THEME=light|dark UI=en|ar node .dev/harness.cjs <script.cjs>
// (normally through .dev/run.sh, which holds a lock so only one Chrome runs at a time).
//
// A test exports `async (ctx) => {}`. ctx has:
//   browser, page, id, url (newtab.html), logs, sleep(ms), shot(name)
//   ok(cond, msg)            prints "  ok msg" or "FAIL msg"; failures make the run exit 1
//   boot({ settings, data, hash })  fresh start: wipes storage, writes settings/data, reloads, waits for boot
//   setStorage(obj), getStorage(keys), store(key)  chrome.storage.local helpers (store(key) returns the value)
//   openApp(id, params), closeApp(), mod(path, fn, ...args)   call into the page's ES modules
//   click(sel), clickText(sel, text), text(sel), count(sel), exists(sel), visible(sel), waitFor(sel)
//   theme / ui (from THEME / UI env vars) and P (screenshot prefix "<theme>-<ui>-")
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, pipe: true, enableExtensions: true,
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--lang=' + (process.env.LANG_UI || 'en-US')],
    defaultViewport: { width: +(process.env.W || 1440), height: +(process.env.H || 900) },
  });
  const id = await browser.installExtension(process.env.EXT || path.resolve(__dirname, '..'));
  await new Promise((r) => setTimeout(r, 1200));
  for (const p of await browser.pages()) await p.close().catch(() => {});
  const page = await browser.newPage();
  await page.bringToFront();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

  const theme = process.env.THEME || 'light', ui = process.env.UI || 'en';
  const url = `chrome-extension://${id}/newtab.html`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let passed = 0, failed = 0;
  const ok = (cond, msg) => {
    if (cond) { passed++; console.log('  ok', msg); } else { failed++; console.log('FAIL', msg); }
    return !!cond;
  };
  // Storage goes through the service worker, so a page reload (e.g. the language changing) can't interrupt it.
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id), { timeout: 10000 });
  const sw = await swTarget.worker();
  const getStorage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);
  const setStorage = (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj);
  const waitBoot = () => page.waitForFunction(() => window.__bootMs, { timeout: 30000 });
  const ctx = {
    browser, page, id, url, logs, sw, theme, ui, P: `${theme}-${ui}-`, sleep, ok, getStorage, setStorage,
    shot: async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); },
    store: async (key) => (await getStorage(key))[key],
    async boot({ settings = {}, data = {}, hash = '', locked = false } = {}) {
      await page.goto(url);
      await waitBoot();
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.databases?.().then((l) => l.forEach((d) => indexedDB.deleteDatabase(d.name))); });
      await page.goto('about:blank');
      await sw.evaluate(() => Promise.all([chrome.storage.local.clear(), chrome.storage.session?.clear(), chrome.alarms.clearAll()]));
      await setStorage({ settings: { theme, lang: ui, lockMode: locked ? 'always' : 'never', reduceMotion: true, ...settings }, ...data });
      await page.goto(url + hash);
      await waitBoot();
      await sleep(600);
    },
    reload: async () => { await page.reload(); await waitBoot(); await sleep(600); },
    mod: (file, fn, ...args) => page.evaluate((f, fn, args) => import(f).then((m) => m[fn](...args)), file, fn, args),
    openApp: async (app, params) => { await page.evaluate((a, p) => import('./js/core/apps.js').then((m) => m.openApp(a, { params: p })), app, params); await sleep(700); },
    closeApp: async () => { await page.evaluate(() => import('./js/core/apps.js').then((m) => m.closeApp(true))); await sleep(300); },
    waitFor: (sel, timeout = 5000) => page.waitForSelector(sel, { timeout }).catch(() => null),
    // Retries when the element is replaced between finding and clicking it (lists that redraw on a store change).
    click: async (sel) => {
      for (let i = 0; ; i++) {
        await page.waitForSelector(sel, { timeout: 5000 });
        try { await page.click(sel); break; } catch (e) { if (i >= 3 || !/detached|not clickable|no node/i.test(e.message)) throw e; await sleep(150); }
      }
      await sleep(250);
    },
    clickText: async (sel, text) => {
      const done = await page.evaluate((s, t) => {
        const el = [...document.querySelectorAll(s)].find((x) => x.textContent.trim().includes(t));
        el?.click();
        return !!el;
      }, sel, text);
      await sleep(250);
      return done;
    },
    text: (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? null, sel),
    texts: (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((x) => x.textContent.trim()), sel),
    count: (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel),
    exists: (sel) => page.evaluate((s) => !!document.querySelector(s), sel),
    visible: (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0;
    }, sel),
    type: async (sel, text) => { await page.click(sel); await page.keyboard.type(text); await sleep(150); },
    /** Every element matching sel lies inside the viewport (or inside `within`). Returns the offenders. */
    outside: (sel, within) => page.evaluate((s, w) => {
      const box = w ? document.querySelector(w)?.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      if (!box) return ['no ' + w];
      return [...document.querySelectorAll(s)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1);
      }).map((el) => el.className || el.tagName);
    }, sel, within),
  };
  let scriptError = false;
  try {
    await require(path.resolve(process.argv[2]))(ctx);
  } catch (e) {
    scriptError = true;
    console.log('SCRIPT ERROR', e.stack || e.message);
  }
  const pageErrors = logs.filter((l) => l.startsWith('[pageerror]')).length;
  console.log('---- logs ----\n' + logs.join('\n'));
  console.log(`---- ${passed} passed, ${failed} failed, ${pageErrors} page errors ----`);
  await browser.close();
  process.exit(failed || pageErrors || scriptError ? 1 : 0);
})();
