// Journaling suggestions: moments from the last week, made on this device from what Bloom Tab already keeps (Calendar
// events, finished reminders, Focus sessions, notes written, music played). Nothing is sent anywhere and nothing new is
// collected. Each source can be turned off in Journal settings. The other apps' data is read defensively: their stored
// shapes may grow (lists, folders…), so anything unexpected is skipped instead of breaking the Journal.
import { store } from '../core/store.js';
import { t, fmtTime } from '../core/i18n.js';
import { plain } from './rich.js';
import { pl } from './data.js';
import * as M from './model.js';
import { occurrences } from '../calendar/data.js';

const DAYS = 7;
/** Icon, colour and name of a moment kind. */
export const KINDS = {
  event: { icon: 'calendar', color: '#3e7bff', src: 'events', name: () => t('journal.src.events') },
  reminders: { icon: 'checkCircle', color: '#2b9cf0', src: 'reminders', name: () => t('journal.src.reminders') },
  focus: { icon: 'dnd', color: '#7b61ff', src: 'focus', name: () => t('journal.src.focus') },
  note: { icon: 'note', color: '#ff8a3d', src: 'notes', name: () => t('journal.src.notes') },
  music: { icon: 'music', color: '#f2556b', src: 'music', name: () => t('journal.src.music') },
};
export const kindInfo = (k) => KINDS[k] || KINDS.event;

const arr = (v, ...keys) => (Array.isArray(v) ? v : keys.map((k) => v?.[k]).find(Array.isArray) || []);
const startOf = (ms) => {
  const x = new Date(ms);
  x.setHours(0, 0, 0, 0);
  return +x;
};
const ms = (...vals) => vals.map(Number).find((v) => Number.isFinite(v) && v > 0) || 0;

/** Moments of the last week, newest first: [{ id, kind, at, title, sub?, color, list?, score }] */
export function moments({ off = [], now = Date.now() } = {}) {
  const skip = new Set(off), out = [];
  const from = startOf(now) - (DAYS - 1) * M.DAY;
  const run = (src, fn) => {
    if (skip.has(src)) return;
    try {
      fn();
    } catch (e) {
      console.warn('journal suggestions', src, e);
    }
  };

  // Calendar: events that have started (all-day events of today count). Calendar's occurrences(), not the raw list, so
  // a repeating event is a moment on every day it happens (subscribed calendars too; reminders and birthdays aren't).
  run('events', () => {
    for (const ev of occurrences(from, now + 1, { reminders: false, birthdays: false })) {
      const start = ms(ev?.start);
      if (!ev?.title || !start || start > now || (ev.end || start) < from) continue;
      const time = ev.allDay ? t('journal.allDay') : `${fmtTime(new Date(start))} – ${fmtTime(new Date(ms(ev.end, start)))}`;
      const place = ev.place || ev.location || '';
      out.push({ id: 'ev:' + (ev.master ?? ev.id) + ':' + start, kind: 'event', at: start, title: String(ev.title), sub: place ? `${time} · ${place}` : time, color: ev.color || KINDS.event.color, score: 3 + (place ? 1 : 0) + (ev.allDay ? 0 : 1) });
    }
  });

  // Reminders finished, one moment per day
  run('reminders', () => {
    const days = new Map();
    for (const r of arr(store.get('reminders'), 'items', 'reminders')) {
      const done = ms(r?.completedAt, r?.doneAt);
      if (!r?.done || !r.title || done < from || done > now) continue;
      const k = M.dayKey(done);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push({ title: String(r.title), at: done });
    }
    for (const [k, list] of days) {
      list.sort((a, b) => b.at - a.at);
      const n = list.length;
      out.push({ id: 'rem:' + k, kind: 'reminders', at: list[0].at, title: n === 1 ? list[0].title : pl('journal.remDone', n), sub: n === 1 ? t('journal.completed') : '', list: list.slice(0, 5).map((r) => r.title), color: KINDS.reminders.color, score: 1 + Math.min(3, n / 2) });
    }
  });

  // Focus sessions, one moment per day with the minutes spent in Focus
  run('focus', () => {
    const days = new Map();
    for (const f of arr(store.get('focusLog'))) {
      const s = ms(f?.start), e = ms(f?.end);
      if (!s || !e || e <= s || e < from || s > now) continue;
      const k = M.dayKey(s);
      const cur = days.get(k) || { min: 0, n: 0, at: 0 };
      cur.min += (Math.min(e, now) - s) / 60e3;
      cur.n++;
      cur.at = Math.max(cur.at, Math.min(e, now));
      days.set(k, cur);
    }
    for (const [k, v] of days) {
      const min = Math.round(v.min);
      if (min < 5) continue;
      const hrs = Math.floor(min / 60), rest = min % 60;
      out.push({ id: 'fo:' + k, kind: 'focus', at: v.at, title: hrs ? t('journal.focusHM', { h: hrs, m: rest }) : t('journal.focusM', { m: min }), sub: pl('journal.sessions', v.n), color: KINDS.focus.color, score: 1.5 + Math.min(2, min / 60) });
    }
  });

  // Notes started this week
  run('notes', () => {
    for (const n of arr(store.get('notes'), 'items', 'notes')) {
      const at = ms(n?.created, n?.updated);
      if (!n || n.deletedAt || at < from || at > now) continue;
      const body = plain(n.body || n.html || n.text || '');
      const [first, ...rest] = body.split('\n').map((s) => s.replace(/^\s*(?:[•☐☑-]|\d+\.)\s+/, '').trim()).filter(Boolean);
      const title = String(n.title || '').trim() || first;
      if (!title) continue;
      out.push({ id: 'nt:' + n.id, kind: 'note', at, title, sub: (n.title ? [first, ...rest] : rest).filter(Boolean).join(' ').slice(0, 120), color: KINDS.note.color, score: 1 });
    }
  });

  // Music played (Samsung Music keeps its history in store key 'music' when it's installed), one moment per day
  run('music', () => {
    const mu = store.get('music');
    if (!mu || typeof mu !== 'object') return;
    const plays = arr(mu, 'recent', 'history', 'played', 'plays', 'log')
      .map((p) => ({ title: String(p?.title || p?.name || ''), artist: String(p?.artist || ''), at: ms(p?.at, p?.time, p?.playedAt, p?.ts) }))
      .filter((p) => p.title && p.at >= from && p.at <= now);
    const days = new Map();
    for (const p of plays) {
      const k = M.dayKey(p.at);
      if (!days.has(k)) days.set(k, new Map());
      const songs = days.get(k), key = p.title + '\n' + p.artist;
      const cur = songs.get(key) || { ...p, n: 0 };
      cur.n++;
      cur.at = Math.max(cur.at, p.at);
      songs.set(key, cur);
    }
    for (const [k, songs] of days) {
      const list = [...songs.values()].sort((a, b) => b.n - a.n || b.at - a.at);
      const top = list[0];
      out.push({ id: 'mu:' + k, kind: 'music', at: Math.max(...list.map((s) => s.at)), title: list.length === 1 ? top.title : pl('journal.songs', list.length), sub: list.length === 1 ? top.artist : '', list: list.slice(0, 4).map((s) => [s.title, s.artist].filter(Boolean).join(' — ')), color: KINDS.music.color, score: 1.5 });
    }
  });

  return out.sort((a, b) => b.at - a.at);
}

/** The best few: the most meaningful moment of each kind first, recent ones ahead. */
export function recommended(list, n = 6, now = Date.now()) {
  const scored = list.map((m) => ({ m, s: m.score + Math.max(0, 3 - (now - m.at) / M.DAY) })).sort((a, b) => b.s - a.s);
  const out = [], kinds = new Set();
  for (const { m } of scored) if (!kinds.has(m.kind) && out.length < n) {
    out.push(m);
    kinds.add(m.kind);
  }
  for (const { m } of scored) if (!out.includes(m) && out.length < n) out.push(m);
  return out;
}

/** What gets saved on an entry that starts from a moment. */
export const momentOf = (m) => ({ kind: m.kind, at: m.at || Date.now(), title: m.title, ...(m.sub ? { sub: m.sub } : {}), ...(m.color ? { color: m.color } : {}), ...(m.list?.length ? { list: m.list.slice(0, 5) } : {}) });
