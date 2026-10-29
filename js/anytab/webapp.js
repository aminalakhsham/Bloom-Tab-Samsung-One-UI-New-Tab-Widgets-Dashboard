// "Open as web app" (set in the Add to Home screen sheet): the site opens in a window of its own without tabs or an
// address bar (a Chrome pop-up window), like an installed web app. One window per address: opening the icon again
// brings that window back instead of a second one. The window ids live in chrome.storage.session (`webApps`), so they
// are shared by every tab and forgotten when Chrome quits.
import { session } from '../core/store.js';

const KEY = 'webApps';

export async function openWebApp(url) {
  if (!globalThis.chrome?.windows) return void window.open(url, '_blank', 'noopener');
  const map = (await session.get(KEY).catch(() => null)) || {};
  const id = map[url];
  if (id != null) {
    try {
      const w = await chrome.windows.get(id);
      await chrome.windows.update(id, w.state === 'minimized' ? { focused: true, state: 'normal' } : { focused: true });
      return;
    } catch {} // closed since
  }
  const W = Math.min(1180, Math.max(480, screen.availWidth - 160)), H = Math.min(860, Math.max(520, screen.availHeight - 120));
  const left = Math.round((screen.availLeft || 0) + (screen.availWidth - W) / 2), top = Math.round((screen.availTop || 0) + (screen.availHeight - H) / 2);
  const w = await chrome.windows.create({ url, type: 'popup', width: W, height: H, left, top, focused: true }).catch(() => null);
  if (!w) return void chrome.tabs?.create({ url });
  const fresh = (await session.get(KEY).catch(() => null)) || {};
  await session.set(KEY, { ...fresh, [url]: w.id });
}
