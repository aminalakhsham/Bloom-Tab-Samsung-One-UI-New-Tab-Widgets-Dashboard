// Live activities for the Now Bar (lock screen) and the Quick Panel, and app icon badges.
//
// registerActivity('timer', () => null | {
//   icon: 'timer',               // icon name from icons.js
//   color: '#ff8a3d',            // accent of the pill
//   title: '04:59',              // main text (updated every second)
//   sub: 'Timer',                // secondary text
//   progress: 0.3,               // optional 0..1 ring
//   app: 'clock',                // open this app on click…
//   params: { section: 'timer' },// …with these params (the exact pass, the running timer)
//   actions: [{ icon: 'pause', label: 'Pause', onClick(e, activity) }
//            | { icon: 'wl-qr', label: 'Show code', open: { app: 'wallet', params: { pass: id } } }],
//   priority: 10,                // higher shows first
// })
// The shell polls providers once a second, so providers should be cheap and read from store.
// An action with `open` (and no onClick) unlocks the screen if needed and opens that app with its params.
//
// App icon badges (One UI shows the number of an app's unread notifications on its icon):
//   setBadge(appId, n)            a count the app sets itself (stored in store key `badges`, works from any tab)
//   registerBadge(appId, () => n) a count computed on demand (cheap; read from store); call badgesChanged() when it moves
//   badgeCount(appId)             what the icon shows: the app's own count, else its unread notifications
//   onBadgesChange(fn)            the Home screen and the Apps screen repaint their badges
import { store } from './store.js';

const providers = new Map();

export function registerActivity(id, provider) {
  providers.set(id, provider);
}

/** Opens what an activity or an action points at ({ app, params } or an app id), after unlocking. */
export function openTarget(target, from) {
  const tg = typeof target === 'string' ? { app: target } : target;
  if (!tg?.app) return;
  return Promise.all([import('../shell/lock.js'), import('./apps.js')]).then(([lock, apps]) => lock.unlock().then(() => apps.openApp(tg.app, { from, params: tg.params })));
}

/** A click on the activity itself: its app with its params. */
export const openActivity = (a, from) => openTarget(a.open || (a.app ? { app: a.app, params: a.params } : null), from);

export function getActivities() {
  const out = [];
  for (const [id, fn] of providers) {
    try {
      const a = fn();
      if (a) (Array.isArray(a) ? a : [a]).forEach((x, i) => out.push(normalize({ id: i ? `${id}:${i}` : id, priority: 0, ...x })));
    } catch (e) {
      console.error('activity', id, e);
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// Actions that only name a target get an onClick, so every surface can simply call action.onClick(e).
function normalize(a) {
  if (Array.isArray(a.actions)) {
    a.actions = a.actions.filter(Boolean).map((x) => {
      if (x.onClick) return { ...x, onClick: (e) => x.onClick(e, a, x.params) };
      if (x.open) return { ...x, onClick: () => openTarget(x.open) };
      return x;
    });
  }
  return a;
}

// ——— app icon badges ———
const badgeFns = new Map();
const badgeListeners = new Set();
export const badgesChanged = () => badgeListeners.forEach((fn) => fn());
export const onBadgesChange = (fn) => (badgeListeners.add(fn), () => badgeListeners.delete(fn));

export function setBadge(appId, n) {
  const cur = store.get('badges') || {};
  const v = Math.max(0, Math.round(+n || 0));
  if ((cur[appId] || 0) === v) return;
  const next = { ...cur };
  if (v) next[appId] = v;
  else delete next[appId];
  store.set('badges', next);
}

export const registerBadge = (appId, fn) => (badgeFns.set(appId, fn), badgesChanged());

export function badgeCount(appId) {
  const fn = badgeFns.get(appId);
  if (fn) {
    try {
      const n = +fn() || 0;
      if (n > 0) return n;
    } catch (e) {
      console.error('badge', appId, e);
    }
  }
  const own = (store.get('badges') || {})[appId];
  if (own > 0) return own;
  return (store.get('notifications') || []).filter((x) => x.app === appId && !x.read).length;
}

store.on('badges', badgesChanged);
store.on('notifications', badgesChanged);
