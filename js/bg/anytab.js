// Features that work from any tab (roadmap S5) and the Chrome side panel (S6), on the service-worker side.
//
// Add to Home screen: right-click a page ("Add to Home screen" / "Add to Edge panel") or a link, click the toolbar
// button, or press Alt+Shift+H. Quick capture: Alt+Shift+Q, or right-click a page or a selection. Both show a One UI
// sheet over the website: addsite.html / capture.html in a frame the page can't look into (the sheet is an extension
// page, so it reads and writes Bloom Tab's storage itself; the website only gets a frame to show and hears "ready",
// "pass" and "close"). What the sheet starts with is handed over in chrome.storage.session under a random token
// ("clip:<uuid>" / "cap:<uuid>"), so a website that frames the sheet itself can't fill it in or learn anything.
// Pages that can't be scripted (chrome://, the Web Store, PDFs, a site that blocks the frame, Bloom Tab itself) get the
// same sheet in a small pop-up window instead.
// Side panel: Alt+Shift+L or the toolbar button's menu opens sidepanel.html (manifest side_panel.default_path).
//
// All three triggers (menu click, toolbar click, shortcut) grant activeTab, which is what lets chrome.scripting reach
// the page; .dev/anytab.cjs grants host permissions instead because headless Chrome can't click a menu.
const msg = (key, fallback) => chrome.i18n.getMessage(key) || fallback;
const WEB = ['http://*/*', 'https://*/*'];
const KEEP = 60 * 60 * 1000; // sheets nobody finished are forgotten after an hour
const isWeb = (u) => /^https?:/i.test(u || '');

// ——— menus (created per id, so other modules' menus are never wiped) ———
function makeMenus() {
  const items = [
    ['add-home', 'ctxAddToHome', 'Add to Home screen', ['page'], { documentUrlPatterns: WEB }],
    ['add-edge', 'ctxAddToEdge', 'Add to Edge panel', ['page'], { documentUrlPatterns: WEB }],
    ['add-link', 'ctxAddLink', 'Add link to Home screen', ['link'], { targetUrlPatterns: WEB }],
    ['cap-page', 'ctxCapture', 'Quick capture', ['page'], {}],
    ['cap-sel', 'ctxCapture', 'Quick capture', ['selection'], {}],
    ['add-action', 'ctxAddToHome', 'Add to Home screen', ['action'], {}],
    ['cap-action', 'ctxCapture', 'Quick capture', ['action'], {}],
    ['panel-action', 'ctxSidePanel', 'Open side panel', ['action'], {}],
  ];
  for (const [id, key, fb, contexts, more] of items) {
    chrome.contextMenus.remove(id, () => {
      void chrome.runtime.lastError; // (not there yet)
      chrome.contextMenus.create({ id, title: msg(key, fb), contexts, ...more }, () => void chrome.runtime.lastError);
    });
  }
}
chrome.runtime.onInstalled.addListener(makeMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = info.menuItemId;
  if (id === 'panel-action') return openPanel(tab);
  if (id === 'add-home' || id === 'add-action') addFrom(tab, { where: 'home' });
  else if (id === 'add-edge') addFrom(tab, { where: 'edge' });
  else if (id === 'add-link') addFrom(tab, { link: info.linkUrl, where: 'home' });
  else if (id === 'cap-page' || id === 'cap-sel' || id === 'cap-action') captureFrom(tab, info);
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'open-side-panel') return openPanel(tab);
  if (cmd === 'add-to-home') addFrom(tab, { where: 'home' });
  else if (cmd === 'quick-capture') captureFrom(tab);
});

chrome.action?.onClicked.addListener((tab) => addFrom(tab, { where: 'home' }));

/** Opens the side panel in the tab's window. Must run straight from the user's gesture (no await before it). */
function openPanel(tab) {
  if (tab?.windowId == null || !chrome.sidePanel?.open) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.warn('side panel', e));
}

// ——— Add to Home screen ———
/** where: 'home' | 'edge' (the sheet starts on that choice); link: a link's address instead of the page's. */
async function addFrom(tab, { link = '', where = 'home' } = {}) {
  if (!tab?.id && tab?.windowId == null) return;
  const pageUrl = tab.url || '';
  const url = link || pageUrl;
  const page = tab.id && isWeb(pageUrl) ? await run(tab.id, pageInfo) : null;
  const clip = { url: isWeb(url) ? url : '', title: link ? '' : (page?.title || tab.title || ''), appTitle: link ? '' : page?.appTitle || '', siteName: link ? '' : page?.siteName || '', where, at: Date.now() };
  const token = crypto.randomUUID();
  const key = 'clip:' + token;
  await forgetOld();
  await chrome.storage.session.set({ [key]: clip });
  // The touch icon can take a moment to download, so the sheet opens meanwhile and picks it up when it arrives.
  const iconP = page && clip.url && !link ? run(tab.id, touchIcon) : null;
  const shown = page && clip.url && (await run(tab.id, showSheet, [chrome.runtime.getURL('addsite.html') + '#' + token]));
  if (!shown) await openWindow('addsite.html#' + token, tab, 460, 600);
  const icon = await iconP;
  const cur = (await chrome.storage.session.get(key))[key];
  if (icon && cur) await chrome.storage.session.set({ [key]: { ...cur, icon } });
}

// ——— Quick capture ———
async function captureFrom(tab, info = {}) {
  if (!tab?.id && tab?.windowId == null) return;
  const url = tab.url || info.pageUrl || '';
  const page = tab.id && isWeb(url) ? await run(tab.id, pageInfo) : null;
  const cap = {
    url: isWeb(url) ? url : '', title: String(page?.title || tab.title || '').slice(0, 300),
    sel: String(info.selectionText || page?.sel || '').trim().slice(0, 4000), at: Date.now(),
  };
  const token = crypto.randomUUID();
  await forgetOld();
  await chrome.storage.session.set({ ['cap:' + token]: cap });
  const shown = page && (await run(tab.id, showSheet, [chrome.runtime.getURL('capture.html') + '#' + token]));
  if (!shown) await openWindow('capture.html#' + token, tab, 520, 640);
}

/** The sheet in a small window of its own, centred over the browser window (a One UI pop-up). */
async function openWindow(path, tab, W, H) {
  let pos = {};
  try {
    const w = await chrome.windows.get(tab.windowId);
    if (w.width && w.height) pos = { left: Math.round(w.left + (w.width - W) / 2), top: Math.round(w.top + Math.max(40, (w.height - H) / 3)) };
  } catch {}
  const url = chrome.runtime.getURL(path);
  await chrome.windows.create({ url, type: 'popup', width: W, height: H, focused: true, ...pos }).catch(() => chrome.tabs.create({ url }));
}

async function run(tabId, func, args = []) {
  try {
    return (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0]?.result ?? null;
  } catch {
    return null;
  }
}

async function forgetOld() {
  const all = await chrome.storage.session.get(null);
  const old = Object.keys(all).filter((k) => /^(clip|cap):/.test(k) && !(Date.now() - all[k]?.at < KEEP));
  if (old.length) await chrome.storage.session.remove(old);
}

// For .dev/anytab.cjs: headless Chrome can't click a context menu or press a shortcut.
globalThis.__btAddToHome = addFrom;
globalThis.__btCapture = captureFrom;

// ——— run inside the page (each function is self-contained: it is serialised by chrome.scripting) ———
function pageInfo() {
  const meta = (sel) => document.querySelector(sel)?.content?.trim() || '';
  // the selection inside a text field isn't in getSelection()
  const a = document.activeElement;
  let sel = '';
  try {
    sel = a && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.selectionEnd > a.selectionStart ? a.value.slice(a.selectionStart, a.selectionEnd) : String(getSelection() || '');
  } catch {}
  return {
    title: document.title.trim(),
    appTitle: meta('meta[name="apple-mobile-web-app-title"]') || meta('meta[name="application-name"]'),
    siteName: meta('meta[property="og:site_name"]'),
    sel,
  };
}

// The icon a phone would put on its Home screen: the largest apple-touch-icon, else a maskable icon from the web app
// manifest (always full-bleed), else /apple-touch-icon.png. Returned as a 144 px PNG data URL, or '' (Bloom Tab then
// uses the favicon). Cross-origin icons only work when their server allows it (CORS).
async function touchIcon() {
  const sizeOf = (s) => Math.max(0, ...String(s || '').split(/\s+/).map((x) => parseInt(x, 10) || 0));
  const cands = [...document.querySelectorAll('link[rel~="apple-touch-icon" i], link[rel~="apple-touch-icon-precomposed" i]')]
    .filter((l) => l.href).sort((a, b) => sizeOf(b.getAttribute('sizes')) - sizeOf(a.getAttribute('sizes'))).map((l) => l.href);
  const man = document.querySelector('link[rel~="manifest" i]')?.href;
  if (man) {
    try {
      const icons = (await (await fetch(man, { signal: AbortSignal.timeout(3000) })).json()).icons || [];
      icons.filter((i) => i?.src && /maskable/.test(i.purpose || '')).sort((a, b) => sizeOf(b.sizes) - sizeOf(a.sizes))
        .forEach((i) => cands.push(new URL(i.src, man).href));
    } catch {}
  }
  cands.push(new URL('/apple-touch-icon.png', location.origin).href);
  const N = 144;
  for (const src of [...new Set(cands)].slice(0, 5)) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      if (Math.min(bmp.width, bmp.height) < 96) continue; // Chrome's own favicon looks better than an upscaled one
      const c = new OffscreenCanvas(N, N), g = c.getContext('2d');
      const k = Math.max(N / bmp.width, N / bmp.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, (N - bmp.width * k) / 2, (N - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
      const blob = await c.convertToBlob({ type: 'image/png' });
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
    } catch {}
  }
  return '';
}

// Shows a sheet (addsite.html or capture.html) over the page in the top layer, above the page's own overlays and
// full-screen video. It stays invisible until the sheet says which colour scheme it uses (a frame whose scheme differs
// from its page's gets an opaque backdrop). Resolves false when the sheet doesn't come up within 5 s, e.g. when the site
// doesn't let the frame load (cross-origin isolation); the caller then opens a window instead.
function showSheet(src) {
  window.__btSheetClose?.();
  const f = document.createElement('iframe');
  f.src = src;
  f.title = 'Bloom Tab';
  f.allow = 'clipboard-write';
  const css = { all: 'initial', position: 'fixed', inset: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none', border: '0', margin: '0', padding: '0', background: 'transparent', overflow: 'hidden', 'z-index': '2147483647', 'color-scheme': 'normal', visibility: 'hidden', display: 'block' };
  for (const [k, v] of Object.entries(css)) f.style.setProperty(k, v, 'important');
  const back = document.activeElement;
  document.documentElement.appendChild(f);
  try {
    f.popover = 'manual';
    f.showPopover();
  } catch {}
  const close = () => {
    removeEventListener('message', onMsg, true);
    f.remove();
    if (window.__btSheetClose === close) window.__btSheetClose = null;
    try {
      back?.focus?.({ preventScroll: true });
    } catch {}
  };
  let ready;
  const shown = new Promise((res) => {
    ready = res;
    setTimeout(() => res(false), 5000);
  });
  shown.then((ok) => { if (!ok) close(); });
  const onMsg = (e) => {
    if (e.source !== f.contentWindow || typeof e.data?.bt !== 'string') return;
    e.stopImmediatePropagation();
    if (e.data.bt === 'ready') {
      f.style.setProperty('color-scheme', e.data.scheme === 'dark' ? 'dark' : 'light', 'important');
      f.style.setProperty('visibility', 'visible', 'important');
      f.focus();
      ready(true);
    } else if (e.data.bt === 'pass') f.style.setProperty('pointer-events', 'none', 'important'); // only a toast is left
    else if (e.data.bt === 'close') {
      ready(true);
      close();
    }
  };
  addEventListener('message', onMsg, true);
  window.__btSheetClose = close;
  return shown;
}
