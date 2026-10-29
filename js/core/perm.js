// Optional Chrome permissions: ask only when the user turns on the feature that needs them.
//   if (!(await ensure('tabs'))) return toast(t('perm.denied'));   // must run inside a click/keydown handler
//   await has('downloads')
// `perm` is a permission name ('tabs', 'downloads', 'bookmarks', 'history', 'tabGroups', 'sessions') or an origin
// pattern ('https://*/*').
import { isExt } from './util.js';

const spec = (p) => (/[:*/]/.test(p) ? { origins: [p] } : { permissions: [p] });

export async function has(p) {
  if (!isExt) return false;
  return chrome.permissions.contains(spec(p)).catch(() => false);
}

export async function ensure(p) {
  if (!isExt) return false;
  if (await has(p)) return true;
  return chrome.permissions.request(spec(p)).catch(() => false);
}

export async function drop(p) {
  if (!isExt) return;
  await chrome.permissions.remove(spec(p)).catch(() => {});
}
