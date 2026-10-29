// Calendar in the service worker: event reminders and .ics subscriptions.
// - `event:<id>` alarms: pages schedule an event's next reminder (js/calendar/data.js syncAlerts); when it rings this
//   shows the notification (and the entry in the in-page list), then plans the event's next reminder — the second
//   reminder of the two, or the next occurrence of a repeating event. Finder's "add event" uses the same alarm.
// - `calsub:tick` (hourly): refreshes subscribed calendars whose time has come (every 6 hours by default) into
//   `calSubEvents`; pages ask for "Refresh now" with the `cal-sub-refresh` message. The fetch reaches only the
//   address the user subscribed to (Chrome granted that one site when they added it).
import { onAlarm, openTarget, onMessage, post, bgStrings, bgTime, bgLocale, fmt, scheduleAt } from './hub.js';
import * as M from '../calendar/model.js';
import { parseICS, subEvents } from '../calendar/ics.js';

const S = {
  en: { untitled: 'My event', now: 'Starting now', startsAt: 'Starts at {t}', event: 'Upcoming event', tomorrow: 'Tomorrow' },
  ar: { untitled: 'حدثي', now: 'يبدأ الآن', startsAt: 'يبدأ الساعة {t}', event: 'حدث قادم', tomorrow: 'غدًا' },
};
const LATE = 15 * 60e3; // reminders that rang while the computer slept, still worth showing
const TICK = 'calsub:tick';
const local = chrome.storage.local;

/** "Starts at 9:00 AM" (today), "Tomorrow · Starts at 9:00 AM", "Upcoming event" (all day), "Starting now", + place. */
async function describe(o, now, s) {
  const parts = [];
  if (o.allDay) parts.push(s.event);
  else if (o.start - now <= 60e3) parts.push(s.now);
  else {
    const d = M.daysBetween(now, o.start), at = fmt(s.startsAt, { t: await bgTime(o.start) });
    parts.push(d === 0 ? at : d === 1 ? `${s.tomorrow} · ${at}` : `${new Date(o.start).toLocaleDateString(await bgLocale(), { weekday: 'short', month: 'short', day: 'numeric' })} · ${at}`);
  }
  if (o.place) parts.push(o.place);
  return parts.join(' · ');
}

onAlarm('event', async (id) => {
  const { events = [], calPrefs = {} } = await local.get(['events', 'calPrefs']);
  const raw = (Array.isArray(events) ? events : []).find((e) => e && String(e.id) === id);
  if (!raw) return;
  const ev = M.norm(raw, calPrefs.defaultCal || 'my');
  const now = Date.now();
  const occs = M.expand([ev], now - 2 * M.DAY, now + 9 * M.DAY);
  // the reminder that rang; an alarm set some other way (an older version, a late wake-up) tells about the next occurrence
  const o = M.alertMoments(occs, now - LATE, now + 30e3).at(-1)?.o || occs.find((x) => x.end > now || (x.allDay && x.end >= now - M.DAY));
  // a hidden calendar stays quiet, but keeps its reminders planned for when it's shown again
  if (o && !(calPrefs.hidden || []).includes(ev.cal)) {
    const s = await bgStrings(S);
    await post('event:' + id, { app: 'calendar', title: o.title || s.untitled, body: await describe(o, now, s), icon: 'calendar', ref: id });
  }
  scheduleAt('event:' + id, M.nextAlert(ev, now + 30e3));
});
openTarget('event', (id) => ({ app: 'calendar', section: 'event:' + id }));

// ——— subscriptions ———
async function fetchIcs(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  if (text.length > 15e6) throw new Error('too big');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an .ics calendar');
  return text;
}

/** Refreshes subscriptions (all that are due, or the one given). Returns [{ id, n, error }]. */
async function refresh({ id = null, force = false } = {}) {
  const { calSubs = [] } = await local.get('calSubs');
  const now = Date.now(), results = [], fresh = {};
  for (const s of Array.isArray(calSubs) ? calSubs : []) {
    if (id && s.id !== id) continue;
    if (!force && s.last && now - s.last < (s.every || 6) * 3600e3 - 60e3) continue;
    try {
      const evs = subEvents(parseICS(await fetchIcs(s.url)), s.id, now);
      fresh[s.id] = { evs, last: now, error: '' };
      results.push({ id: s.id, n: evs.length });
    } catch (e) {
      fresh[s.id] = { last: now, error: String(e?.message || e).slice(0, 120) };
      results.push({ id: s.id, error: fresh[s.id].error });
    }
  }
  if (results.length) {
    // read again: the page may have renamed or removed a subscription while we were downloading
    const cur = await local.get(['calSubs', 'calSubEvents']);
    const subs = (cur.calSubs || []).map((s) => (fresh[s.id] ? { ...s, last: fresh[s.id].last, error: fresh[s.id].error } : s));
    const map = { ...(cur.calSubEvents || {}) };
    for (const [sid, f] of Object.entries(fresh)) if (f.evs && subs.some((s) => s.id === sid)) map[sid] = f.evs;
    for (const k of Object.keys(map)) if (!subs.some((s) => s.id === k)) delete map[k];
    await local.set({ calSubs: subs, calSubEvents: map });
  }
  return results;
}

async function ensureTick() {
  const { calSubs = [] } = await local.get('calSubs');
  if (Array.isArray(calSubs) && calSubs.length) {
    if (!(await chrome.alarms.get(TICK))) chrome.alarms.create(TICK, { delayInMinutes: 1, periodInMinutes: 60 });
  } else await chrome.alarms.clear(TICK);
}

onAlarm('calsub', () => refresh().then(ensureTick));
onMessage('cal-sub-refresh', async (msg) => ({ results: await refresh({ id: msg.id || null, force: true }) }));
onMessage('cal-sub-tick', () => ensureTick().then(() => true));
ensureTick().catch(() => {});
