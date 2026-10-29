// In-page notifications (shown in the Quick Panel, on the Lock screen and as heads-up banners).
//   notify({ app: 'clock', title: 'Timer', body: 'Time is up', icon: 'timer' })
// The background worker writes to the same `notifications` key for alarms that fire with no tab open.
import { store } from './store.js';
import { uid } from './util.js';
import { dndActive } from '../bg/hub.js';

export function notify({ app = 'system', title, body = '', icon = 'bell', silent = false }) {
  // Settings › Notifications: an app turned off posts nothing; Do not disturb keeps it quiet (no heads-up banner)
  const s = store.get('settings');
  if ((s.mutedApps || []).includes(app)) return null;
  if (app !== 'clock' && dndActive(s.dnd)) silent = true;
  const n = { id: uid(), app, title, body, icon, time: Date.now(), read: false, silent };
  store.update('notifications', (list) => [n, ...(list || [])].slice(0, 60));
  return n.id;
}

export function dismissNotification(id) {
  store.update('notifications', (list) => (list || []).filter((n) => n.id !== id));
}

export function clearNotifications() {
  store.set('notifications', []);
}
