// iCalendar (.ics) reader and writer for importing files, subscribing to Google / Outlook / iCloud calendars by URL
// and sharing events. Pure (no DOM, no storage): the page, the service worker (subscription refresh) and
// .dev/calendar-model.mjs import it. Ported from Liquid Tab's js/ics.js; repeat rules are kept as rules (model.js
// `repeat`) instead of being expanded, time zones are converted with Intl, VALARM reminders and changed single
// occurrences (RECURRENCE-ID) are understood.
import { DAY, pad, dkey, parseKey, addDays, dayStart, zonedMs, wallParts, validRepeat, ALLDAY_ALERT_AT, MAX_ALERTS } from './model.js';

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const unfold = (text) => String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
const escape = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A DTSTART/DTEND/EXDATE value → { ms, allDay } (times in their TZID, UTC with Z, else floating = local). */
function parseDate(value, params = '') {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h == null) return { ms: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
  const tz = (params.match(/TZID=("?)([^;:"]+)\1/i) || [])[2] || '';
  return { ms: zonedMs(+y, +mo, +d, +h, +mi, +(s || 0), validZone(tz)), allDay: false, tz: validZone(tz) };
}
/** IANA zones only (Outlook writes Windows names such as "W. Europe Standard Time"; those fall back to local time). */
function validZone(tz) {
  if (!tz) return '';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return ''; }
}

/** "PT1H30M" / "-P1D" → minutes (negative = before). */
function duration(v) {
  const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const min = (+m[2] || 0) * 7 * 1440 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60);
  return m[1] === '-' ? -min : min;
}

/** RRULE (as { FREQ, INTERVAL, … }) → model repeat, or null. Parts the model can't express are left out. */
export function fromRRule(r, start) {
  const freq = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[(r.FREQ || '').toUpperCase()];
  if (!freq) return null;
  const out = { freq, interval: +(r.INTERVAL || 1) };
  const byday = (r.BYDAY || '').split(',').filter(Boolean);
  if (freq === 'week' && byday.length) out.days = byday.map((s) => WD.indexOf(s.slice(-2).toUpperCase())).filter((x) => x >= 0);
  if (freq === 'day' && byday.length && byday.every((s) => /^[A-Z]{2}$/i.test(s))) {
    // FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR is how many apps write "every weekday"
    Object.assign(out, { freq: 'week', days: byday.map((s) => WD.indexOf(s.toUpperCase())) });
  }
  if ((freq === 'month' || freq === 'year') && byday.length === 1) {
    const m = byday[0].match(/^([+-]?\d)?([A-Z]{2})$/i);
    const pos = m?.[1] ? +m[1] : +(r.BYSETPOS || 0);
    if (m && [1, 2, 3, 4, -1].includes(pos)) Object.assign(out, { pos, wd: WD.indexOf(m[2].toUpperCase()) });
  }
  if (r.UNTIL) {
    const u = parseDate(r.UNTIL);
    if (u) out.until = dkey(u.ms);
  } else if (r.COUNT) out.count = +r.COUNT;
  void start;
  return validRepeat(out);
}

/** Model repeat → RRULE text. */
export function toRRule(rep, { allDay = false } = {}) {
  if (!rep) return '';
  const parts = ['FREQ=' + { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[rep.freq]];
  if (rep.interval > 1) parts.push('INTERVAL=' + rep.interval);
  if (rep.freq === 'week' && rep.days?.length) parts.push('BYDAY=' + rep.days.map((d) => WD[d]).join(','));
  if (rep.pos && rep.wd != null) parts.push('BYDAY=' + rep.pos + WD[rep.wd]);
  if (rep.until) {
    const u = parseKey(rep.until);
    if (allDay) parts.push('UNTIL=' + ymd(u));
    else { const e = new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59); parts.push('UNTIL=' + utcStamp(e.getTime())); }
  } else if (rep.count) parts.push('COUNT=' + rep.count);
  return parts.join(';');
}

/**
 * Reads an .ics file. Returns { name, color, events: [{ uid, title, start, end, allDay, place, notes, url, repeat,
 * exdates, alerts, tz, of?, orig? }] } in the model's shape (no ids: the caller gives them).
 * Changed single occurrences (RECURRENCE-ID) become events of their own (`of` = the series' uid, `orig` = the day
 * they replace) and the series skips that day. Cancelled events are left out.
 */
export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const out = { name: '', color: '', events: [] };
  let ev = null, alarm = null, depth = 0;
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const [rawName, ...rest] = head.split(';');
    const name = rawName.toUpperCase(), params = rest.join(';');
    if (name === 'BEGIN') {
      const what = value.trim().toUpperCase();
      if (what === 'VEVENT') { ev = { ex: [], alerts: [] }; depth = 0; }
      else if (ev && what === 'VALARM') alarm = {};
      else if (ev) depth++;
      continue;
    }
    if (name === 'END') {
      const what = value.trim().toUpperCase();
      if (what === 'VALARM' && ev && alarm) {
        if (alarm.min != null && ev.alerts.length < MAX_ALERTS) ev.alerts.push(alarm);
        alarm = null;
      } else if (what === 'VEVENT' && ev) { finish(ev, out.events); ev = null; }
      else if (ev && depth) depth--;
      continue;
    }
    if (!ev) {
      if (name === 'X-WR-CALNAME' && !out.name) out.name = unescape(value);
      if ((name === 'X-APPLE-CALENDAR-COLOR' || name === 'COLOR') && /^#[0-9a-f]{6}/i.test(value.trim())) out.color = value.trim().slice(0, 7);
      continue;
    }
    if (alarm) {
      if (name === 'TRIGGER' && !/RELATED=END/i.test(params)) {
        if (/VALUE=DATE-TIME/i.test(params)) alarm.at = parseDate(value)?.ms;
        else alarm.min = duration(value);
      }
      continue;
    }
    if (depth) continue;
    switch (name) {
      case 'SUMMARY': ev.title = unescape(value); break;
      case 'LOCATION': ev.place = unescape(value); break;
      case 'UID': ev.uid = value.trim(); break;
      case 'STATUS': ev.status = value.trim().toUpperCase(); break;
      case 'DTSTART': ev.start = parseDate(value, params); break;
      case 'DTEND': ev.end = parseDate(value, params); break;
      case 'DURATION': ev.dur = duration(value); break;
      case 'DESCRIPTION': ev.notes = unescape(value).slice(0, 4000); break;
      case 'URL': ev.url = value.trim(); break;
      case 'RRULE': ev.rrule = Object.fromEntries(value.trim().split(';').map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v || ''])); break;
      case 'EXDATE': for (const v of value.split(',')) { const d = parseDate(v, params); if (d) ev.ex.push(dkey(d.ms)); } break;
      case 'RECURRENCE-ID': ev.recur = parseDate(value, params); break;
      case 'ATTENDEE': { const cn = (params.match(/CN=("?)([^;:"]+)\1/i) || [])[2] || value.replace(/^mailto:/i, '').trim(); if (cn) (ev.people ||= []).push(cn); break; }
    }
  }
  // changed occurrences: the series skips their day
  const byUid = new Map(out.events.filter((e) => !e.orig && e.uid).map((e) => [e.uid, e]));
  out.events = out.events.filter((e) => {
    if (!e.orig) return !e.cancelled;
    const master = byUid.get(e.uid);
    if (master) master.exdates = [...new Set([...(master.exdates || []), e.orig])];
    if (e.cancelled) return false;
    if (master) e.of = e.uid;
    return true;
  });
  return out;
}

function finish(ev, list) {
  if (!ev.start || (!ev.title && !ev.recur)) return;
  const allDay = ev.start.allDay;
  const start = ev.start.ms;
  let end;
  if (allDay) {
    // DTEND of an all-day event is the day after its last day
    const last = ev.end ? addDays(ev.end.ms, -1) : ev.dur ? addDays(start, Math.max(1, Math.round(ev.dur / 1440)) - 1) : new Date(start);
    end = Math.max(dayStart(start).getTime(), dayStart(last).getTime()) + DAY - 60e3;
  } else end = ev.end ? Math.max(start, ev.end.ms) : start + (ev.dur != null ? ev.dur * 60e3 : 0);
  const out = { uid: ev.uid || '', title: ev.title || '', start, end, allDay };
  if (ev.place) out.place = ev.place;
  if (ev.notes) out.notes = ev.notes;
  if (/^https?:\/\//i.test(ev.url || '')) out.url = ev.url;
  if (ev.people?.length) out.people = [...new Set(ev.people)].slice(0, 50);
  if (ev.start.tz) out.tz = ev.start.tz;
  const rep = ev.rrule && !ev.recur ? fromRRule(ev.rrule, start) : null;
  if (rep) out.repeat = rep;
  if (rep && ev.ex.length) out.exdates = [...new Set(ev.ex)];
  const alerts = ev.alerts.map((a) => {
    if (a.at != null) return Math.round((start - a.at) / 60000);
    return allDay ? ALLDAY_ALERT_AT - a.min : -a.min; // relative to the start: negative = before
  }).filter((m) => Number.isFinite(m) && m >= 0 && m <= 40320);
  if (alerts.length) out.alerts = [...new Set(alerts)];
  if (ev.recur) { out.orig = dkey(ev.recur.ms); if (ev.status === 'CANCELLED') out.cancelled = true; }
  else if (ev.status === 'CANCELLED') return;
  list.push(out);
}

// ——— writing ———
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`; };
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** A line folded at 75 octets (continuation lines start with a space). */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const localStamp = (ms, tz) => { const p = wallParts(ms, tz); return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}${pad(p.s)}`; };
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

/**
 * Writes normalized events (model.norm) as an .ics calendar. Timed events use their time zone (TZID, an IANA name
 * as Google and Apple read it), all-day events are DATE values; repeats, removed days and reminders go along.
 */
export function writeICS(events, { name = '', now = Date.now() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bloom Tab//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (name) L.push('X-WR-CALNAME:' + escape(name));
  for (const e of events) {
    const tz = e.tz || deviceZone();
    L.push('BEGIN:VEVENT', 'UID:' + (e.uid || `${e.id}@bloomtab`), 'DTSTAMP:' + utcStamp(e.updated || now));
    if (e.allDay) {
      L.push('DTSTART;VALUE=DATE:' + ymd(e.start), 'DTEND;VALUE=DATE:' + ymd(addDays(e.end, 1)));
    } else if (tz) {
      L.push(`DTSTART;TZID=${tz}:` + localStamp(e.start, tz), `DTEND;TZID=${tz}:` + localStamp(e.end, tz));
    } else L.push('DTSTART:' + utcStamp(e.start), 'DTEND:' + utcStamp(e.end));
    L.push('SUMMARY:' + escape(e.title || ''));
    if (e.place) L.push('LOCATION:' + escape(e.place));
    if (e.notes) L.push('DESCRIPTION:' + escape(e.notes));
    if (e.url) L.push('URL:' + e.url);
    for (const p of e.people || []) L.push(`ATTENDEE;CN=${String(p).replace(/[;:"]/g, ' ')}:` + (/@/.test(p) ? 'mailto:' + p : 'invalid:nomail'));
    if (e.repeat) {
      L.push('RRULE:' + toRRule(e.repeat, { allDay: e.allDay }));
      for (const x of e.exdates || []) {
        if (e.allDay) L.push('EXDATE;VALUE=DATE:' + x.replace(/-/g, ''));
        else {
          const d = parseKey(x), s = new Date(e.start), at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes()).getTime();
          L.push(tz ? `EXDATE;TZID=${tz}:` + localStamp(at, tz) : 'EXDATE:' + utcStamp(at));
        }
      }
    }
    if (e.orig) L.push(e.allDay ? 'RECURRENCE-ID;VALUE=DATE:' + e.orig.replace(/-/g, '') : 'RECURRENCE-ID' + (tz ? `;TZID=${tz}:` : ':') + e.orig.replace(/-/g, '') + 'T' + localStamp(e.start, tz).slice(9));
    for (const min of e.alerts || []) {
      const rel = e.allDay ? ALLDAY_ALERT_AT - min : -min;
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escape(e.title || 'Reminder'), 'TRIGGER:' + (rel < 0 ? '-' : '') + 'PT' + Math.abs(rel) + 'M', 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** webcal:// → https://, and a plain host gets https://. Returns '' for something that isn't a web address. */
export function subUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/^webcals?:\/\//i, 'https://');
  if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && (u.hostname.includes('.') || u.hostname === 'localhost') ? u.href : '';
  } catch { return ''; }
}

/** Events of a subscription in stored shape (ids from the feed's UIDs), events that ended over a year ago left out. */
export function subEvents(parsed, subId, now = Date.now()) {
  const old = now - 400 * DAY, seen = new Map(), out = [];
  for (const e of parsed.events) {
    if (!e.repeat && e.end < old) continue;
    if (e.repeat?.until && parseKey(e.repeat.until) < old) continue;
    const base = `${subId}:${e.uid || e.title + '@' + e.start}${e.orig ? '/' + e.orig : ''}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const ev = { ...e, id: n > 1 ? base + '#' + n : base, src: subId };
    if (e.of) ev.of = `${subId}:${e.of}`;
    out.push(ev);
    if (out.length >= 5000) break;
  }
  return out;
}
