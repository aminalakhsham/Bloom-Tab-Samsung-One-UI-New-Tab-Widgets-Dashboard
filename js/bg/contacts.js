// Contacts in the service worker: birthday notifications (at the chosen time on the day, or days before, set in
// Contacts › Settings) and Keep in touch reminders. One alarm, "contacts:next", is set to the next of either; when it
// rings, everything due is shown and the next one is planned. A click opens Contacts on that contact
// (newtab.html#open=contacts&s=<id>); Keep in touch has a "Mark as contacted" button. The worker writes only
// `contactsBg` ({ mark, fired: { id: ms }, touched: { id: ms } }), never `contacts`, which belongs to the pages.
import { onAlarm, onButton, openTarget, post, bgStrings, bgLocale, fmt } from './hub.js';
import { norm, byId, displayName, birthdayAlerts, keepDue, daysUntil, KEY, BG_KEY } from '../contacts/model.js';

const ALARM = 'contacts:next';
const DAY = 864e5;
const S = {
  en: {
    bday: '{name}’s birthday', turns: 'Turns {n}', noName: 'No name', keep: 'Keep in touch',
    keepBody: 'It’s been a while since you were in touch with {name}.', contacted: 'Mark as contacted',
  },
  ar: {
    bday: 'عيد ميلاد {name}', turns: 'يبلغ {n}', noName: 'بلا اسم', keep: 'البقاء على تواصل',
    keepBody: 'مرّ وقت منذ آخر تواصل مع {name}.', contacted: 'وضع علامة «تم التواصل»',
  },
};

async function state() {
  const { [BG_KEY]: bg } = await chrome.storage.local.get(BG_KEY);
  return { mark: 0, fired: {}, touched: {}, ...(bg && typeof bg === 'object' ? bg : {}) };
}

/** Everything due between from and to: [{ at, kind: 'bday'|'keep', id, name, … }] by time. */
function due(d, bg, from, to) {
  const out = birthdayAlerts(d, from, to).map((b) => ({ ...b, kind: 'bday' }));
  for (const c of d.items) {
    if (!c.keep) continue;
    // an overdue reminder (the computer was off) still comes once; keepDue() skips the ones already shown
    const at = keepDue(c, bg.touched[c.id], bg.fired[c.id] || 0);
    if (at < to) out.push({ at, kind: 'keep', id: c.id, name: displayName(c, d.prefs.order) });
  }
  return out.sort((a, b) => a.at - b.at);
}

export async function plan() {
  const now = Date.now();
  const [{ [KEY]: contacts }, bg] = await Promise.all([chrome.storage.local.get(KEY), state()]);
  const next = due(norm(contacts), bg, Math.max(now + 1000, bg.mark || 0), now + 370 * DAY)[0];
  if (!next) return chrome.alarms.clear(ALARM);
  const cur = await chrome.alarms.get(ALARM);
  if (!cur || Math.abs(cur.scheduledTime - Math.max(now + 1000, next.at)) > 1500) await chrome.alarms.create(ALARM, { when: Math.max(now + 1000, next.at) });
}

/** "Today", "Tomorrow" or "In 3 days · Saturday, 18 October", in the app's language. */
function whenText(date, now, loc) {
  try {
    const days = daysUntil(date, new Date(now));
    const rel = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(days, 'day');
    const r = rel.charAt(0).toLocaleUpperCase() + rel.slice(1);
    return days <= 1 ? r : `${r} · ${new Intl.DateTimeFormat(loc, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`;
  } catch {
    return date.toDateString();
  }
}

async function fire() {
  const now = Date.now();
  const [{ [KEY]: contacts }, bg] = await Promise.all([chrome.storage.local.get(KEY), state()]);
  const d = norm(contacts);
  // a computer that slept through the morning still gets today's birthday, but not a pile of old ones
  const list = due(d, bg, Math.max(bg.mark || 0, now - 12 * 3600e3), now + 30000);
  bg.mark = now + 30000;
  const s = await bgStrings(S), loc = await bgLocale();
  for (const x of list) {
    const name = x.name || s.noName;
    if (x.kind === 'bday') {
      const body = [whenText(x.date, now, loc), x.age > 0 ? fmt(s.turns, { n: x.age }) : ''].filter(Boolean).join(' · ');
      await post(`contacts:bday:${x.id}:${x.date.getFullYear()}`, { app: 'contacts', title: fmt(s.bday, { name }), body, icon: 'ctCake' });
    } else {
      bg.fired[x.id] = now; // the next reminder is a whole period from now, even after a long time away
      await post(`contacts:keep:${x.id}:${x.at}`, { app: 'contacts', title: s.keep, body: fmt(s.keepBody, { name }), icon: 'ctWave', buttons: [{ title: s.contacted }] });
    }
  }
  // entries for contacts that are gone are dropped, so the key stays small
  for (const id of Object.keys(bg.fired)) if (!byId(d, id)) delete bg.fired[id];
  for (const id of Object.keys(bg.touched)) if (!byId(d, id)) delete bg.touched[id];
  await chrome.storage.local.set({ [BG_KEY]: bg });
  await plan();
}

onAlarm('contacts', (rest) => (rest === 'next' ? fire() : null));
onButton('contacts', async (rest, index) => {
  const m = /^keep:([^:]+)/.exec(rest);
  if (!m || index !== 0) return;
  const bg = await state();
  bg.touched[m[1]] = Date.now();
  await chrome.storage.local.set({ [BG_KEY]: bg });
  await plan();
});
// "contacts:bday:<id>:<year>" and "contacts:keep:<id>:<at>" open that contact
openTarget('contacts', (rest) => ({ app: 'contacts', section: rest.split(':')[1] }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) plan().catch((e) => console.warn('contacts plan', e));
});
chrome.runtime.onStartup.addListener(() => plan().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => plan().catch(() => {}));
plan().catch(() => {});
