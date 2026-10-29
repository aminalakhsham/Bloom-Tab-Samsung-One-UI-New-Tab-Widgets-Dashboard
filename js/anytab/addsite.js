// addsite.html: the "Add to Home screen" sheet that js/bg/anytab.js shows over a website in a frame, or in a small
// window of its own for pages that can't be scripted. It only shows what the service worker handed over under its token.
import { t } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { bootSheet, say, framed, takeToken, dropToken, finish, closeSelf } from './page.js';
import { openAddSheet } from './clip.js';

async function boot() {
  await bootSheet();
  const token = location.hash.slice(1);
  const clip = await takeToken('clip', token);
  if (!clip) return framed ? say('close') : closeSelf();
  document.title = t('anytab.addTitle');
  say('ready', { scheme: document.documentElement.dataset.theme });
  const sheet = openAddSheet(clip);
  // the touch icon is still downloading when the sheet opens
  const onIcon = (ch) => sheet.setIcon(ch['clip:' + token]?.newValue?.icon);
  chrome.storage.session.onChanged.addListener(onIcon);
  const res = await sheet.done;
  chrome.storage.session.onChanged.removeListener(onIcon);
  dropToken('clip', token);
  if (!res) return finish(framed ? 240 : 0);
  say('pass');
  toast(res.message);
  finish(framed ? 2400 : 1500);
}

boot().catch((e) => {
  console.error(e);
  framed ? say('close') : closeSelf();
});
