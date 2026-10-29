// Service worker. Each app's background jobs live in js/bg/<app>.js and register their alarm kinds, notification
// buttons, click targets and messages with js/bg/hub.js; this file routes Chrome's events to them and keeps only the
// shell's Focus timer. "Add to Home screen", Quick capture and the side panel from any tab are in js/bg/anytab.js.
import { alarmHandlers, buttonHandlers, clickTargets, messageHandlers, post, bgStrings } from './js/bg/hub.js';
// Background modules of the apps (each registers its alarm kinds with hub.js):
// (one import per app, e.g. import './js/bg/health.js';)
import './js/bg/contacts.js';
import './js/bg/wallet.js';
import './js/bg/music.js';
import './js/bg/journal.js';
import './js/bg/wellbeing.js';
import './js/bg/health.js';
import './js/bg/routines.js';
import './js/bg/reminder.js';
import './js/bg/clock.js';
import './js/bg/sync.js';
import './js/bg/calendar.js';
import './js/bg/weather.js';


// Focus is the shell's own job; every other kind belongs to a module above (hub.js routes them).
const STR = {
  en: { focus: 'Focus session complete', focusBody: 'Nice work. Time for a short break.' },
  ar: { focus: 'اكتملت جلسة التركيز', focusBody: 'عمل رائع. حان وقت استراحة قصيرة.' },
};

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const [kind] = alarm.name.split(':');
  if (alarmHandlers.has(kind)) return alarmHandlers.get(kind)(alarm.name.slice(kind.length + 1), alarm);

  if (alarm.name === 'focus') {
    const { focus, focusLog = [] } = await chrome.storage.local.get(['focus', 'focusLog']);
    const logged = !focus?.startedAt || focusLog.some((x) => x.start === focus.startedAt);
    if (focus) await chrome.storage.local.set({ focus: null, focusLog: logged ? focusLog : [{ start: focus.startedAt, end: focus.endsAt }, ...focusLog].slice(0, 400) });
    const s = await bgStrings(STR);
    // hub post(): respects the app mute list and Do not disturb
    return post('focus', { app: 'system', title: s.focus, body: s.focusBody, icon: 'dnd' });
  }
});

chrome.notifications.onButtonClicked.addListener(async (nid, btn) => {
  const kind = nid.split(':')[0];
  chrome.notifications.clear(nid);
  if (buttonHandlers.has(kind)) return buttonHandlers.get(kind)(nid.slice(kind.length + 1), btn, nid);
});

const APP_OF = {}; // kinds without a module of their own (events open Calendar through js/bg/calendar.js)
chrome.notifications.onClicked.addListener((nid) => {
  chrome.notifications.clear(nid);
  const kind = nid.split(':')[0];
  // newtab.html#open=<app>&s=<section>: main.js opens the app with params.section
  const target = clickTargets.has(kind) ? clickTargets.get(kind)(nid.slice(kind.length + 1)) : APP_OF[kind] ? { app: APP_OF[kind] } : null;
  const hash = target?.app ? '#open=' + target.app + (target.section ? '&s=' + encodeURIComponent(target.section) : '') : '';
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html' + hash) });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fn = messageHandlers.get(msg?.type);
  if (!fn) return false;
  Promise.resolve(fn(msg, sender)).then(reply, (e) => reply({ error: String(e) }));
  return true; // reply asynchronously
});

// ——— Add to Home screen / Edge panel, Quick capture and the side panel ———
// (context menus, the toolbar button and the Alt+Shift+H / Q / L shortcuts) live in js/bg/anytab.js.
import './js/bg/anytab.js';
