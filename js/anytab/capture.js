// capture.html: the Quick capture sheet that js/bg/anytab.js shows over a website in a frame, or in a small window of
// its own for pages that can't be scripted. What it starts with ({ url, title, sel }) is read once from the token.
import { t } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { bootSheet, say, framed, takeToken, finish, closeSelf } from './page.js';
import { openCaptureSheet, loadCaptureModules } from './sheet.js';

async function boot() {
  await bootSheet();
  const cap = await takeToken('cap', location.hash.slice(1), { once: true });
  if (!cap) return framed ? say('close') : closeSelf();
  document.title = t('anytab.capTitle');
  const mods = await loadCaptureModules();
  say('ready', { scheme: document.documentElement.dataset.theme });
  const res = await openCaptureSheet(cap, mods);
  if (!res) return finish(framed ? 240 : 0);
  say('pass');
  toast(res.text);
  finish(framed ? 2400 : 1500);
}

boot().catch((e) => {
  console.error(e);
  framed ? say('close') : closeSelf();
});
