// Journal data model: pure logic shared by the Journal app, its widgets, Finder, the service worker (journaling
// schedule) and the plain-node tests. No DOM and no storage here (store-bound helpers live in data.js).
//
// Stored under 'journal' in chrome.storage.local:
//   {
//     entries: [{
//       id, created (ms), at (entry date, ms, editable), edited (ms),
//       title?, text (plain-text mirror for search, widgets and word counts), html? (b i u s ul ol li div br),
//       journal? (journal id; missing or unknown = the first journal), bookmark?: true,
//       media?: [{ id: 'journal:…' (IndexedDB blob), k: 'photo' | 'draw', vec?: 'journal:…' (a drawing's strokes) }],
//       mood?: { level: 1…5 (Awful … Great), feelings?: [id], areas?: [id] },
//       moment?: { kind: 'event' | 'reminders' | 'focus' | 'note' | 'music', at, title, sub?, color?, list?: [string] },
//       prompt?: 'p1' … (a reflection prompt key), place?: 'free text', tags?: ['travel', …],
//       deletedAt? (Recycle bin, purged after 30 days)
//     }],
//     journals: [{ id, name ('' = "Journal" in the UI language), color }]   (always at least one),
//     prefs: { suggest (suggestion cards on the list), off: [suggestion sources turned off], def (default journal),
//              schedule: { on, days: [0 = Sunday … 6], time: 'HH:MM' } }
//   }
// Lock Journal lives in its own key, 'journalLock' (see lock.js), so the entries never sit next to the PIN hash.
// Every field but `entries` is optional, so a missing, old or damaged value reads as an empty journal.

export const KEY = 'journal';
export const LOCK_KEY = 'journalLock';
export const DAY = 864e5;
export const KEEP_DAYS = 30;
export const ACCENT = '#7b61ff';
export const COLORS = ['#7b61ff', '#3e7bff', '#14b8a6', '#22a356', '#f5a524', '#ff6a3d', '#e5484d', '#e2589c', '#8a8d96'];
export const FIRST = { id: 'journal', name: '', color: ACCENT };
/** Where journaling suggestions come from (each can be turned off in Journal settings). */
export const SOURCES = ['events', 'reminders', 'focus', 'notes', 'music', 'prompts'];
export const PREFS = { suggest: true, off: [], def: '', schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], time: '21:00' } };

/** Mood levels, Samsung Health style: 5 faces from Awful (1) to Great (5). */
export const MOODS = [
  { level: 1, id: 'awful', color: '#a77bf3' },
  { level: 2, id: 'bad', color: '#6f8cf6' },
  { level: 3, id: 'okay', color: '#3cbfd9' },
  { level: 4, id: 'good', color: '#7cc84e' },
  { level: 5, id: 'great', color: '#ffa726' },
];
export const FEELINGS = ['happy', 'grateful', 'calm', 'excited', 'proud', 'loved', 'hopeful', 'content', 'tired', 'bored', 'anxious', 'stressed', 'sad', 'lonely', 'angry', 'frustrated'];
export const AREAS = ['work', 'family', 'friends', 'partner', 'health', 'fitness', 'sleep', 'food', 'weather', 'travel', 'hobbies', 'money', 'study', 'self'];
export const moodOf = (level) => MOODS.find((m) => m.level === Math.round(+level)) || null;

const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
const str = (v) => (typeof v === 'string' ? v : '');

/** A safe, complete copy of the stored value (never the store's own objects). */
export function norm(v) {
  const src = v && typeof v === 'object' ? v : {};
  const now = Date.now();
  const entries = (Array.isArray(src.entries) ? src.entries : []).filter((e) => e && typeof e === 'object' && e.id).map((e) => {
    const x = { ...e, text: str(e.text), at: num(e.at, num(e.created, now)) };
    x.created = num(e.created, x.at);
    if (!Array.isArray(x.media)) delete x.media;
    else x.media = x.media.filter((m) => m && typeof m.id === 'string').map((m) => ({ ...m }));
    if (x.moment && typeof x.moment !== 'object') delete x.moment;
    if (x.mood && (typeof x.mood !== 'object' || !moodOf(x.mood.level))) delete x.mood;
    if (x.tags && !Array.isArray(x.tags)) delete x.tags;
    if (x.place && typeof x.place !== 'string') delete x.place;
    return x;
  });
  let journals = (Array.isArray(src.journals) ? src.journals : []).filter((j) => j && j.id).map((j) => ({ ...j, name: str(j.name), color: str(j.color) || ACCENT }));
  if (!journals.length) journals = [{ ...FIRST }];
  const p = src.prefs && typeof src.prefs === 'object' ? src.prefs : {};
  const sc = p.schedule && typeof p.schedule === 'object' ? p.schedule : {};
  const prefs = {
    ...PREFS, ...p,
    off: Array.isArray(p.off) ? p.off.slice() : [],
    schedule: { ...PREFS.schedule, ...sc, days: Array.isArray(sc.days) ? sc.days.filter((n) => n >= 0 && n < 7) : PREFS.schedule.days.slice() },
  };
  return { ...src, entries, journals, prefs };
}

// ------------------------------------------------------------------ entries and journals
export const live = (d) => d.entries.filter((e) => !e.deletedAt);
export const deleted = (d) => d.entries.filter((e) => e.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
export const byId = (d, id) => d.entries.find((e) => e.id === id);
export const journalById = (d, id) => d.journals.find((j) => j.id === id);
/** The journal an entry shows in: one whose journal was deleted (or that never had one) lands in the first journal. */
export const journalOf = (d, e) => (e.journal && journalById(d, e.journal) ? e.journal : d.journals[0].id);
/** Where new entries go: the Default journal setting, else the first journal. */
export const defJournal = (d) => (journalById(d, d.prefs.def) ? d.prefs.def : d.journals[0].id);
export const hasPhotos = (e) => !!e.media?.some((m) => m.k !== 'draw');
/** Nothing worth keeping: an entry opened and left empty is dropped, like Samsung Notes. */
export const isBlank = (e) => !String(e.title || '').trim() && !String(e.text || '').trim() && !e.media?.length && !e.mood && !e.moment && !e.place && !e.tags?.length;

/** Words in a text, for Insights. Intl.Segmenter counts words in scripts without spaces too; spaces are the fallback. */
export function words(text) {
  text = String(text || '').trim();
  if (!text) return 0;
  try {
    let n = 0;
    for (const s of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (s.isWordLike) n++;
    return n;
  } catch {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
export const entryWords = (e) => words(`${e.title || ''} ${e.text || ''}`);

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => {
  const x = new Date(ms);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
export const keyDate = (k) => {
  const [y, m, dd] = k.split('-').map(Number);
  return new Date(y, m - 1, dd);
};
export const addDays = (k, n) => {
  const x = keyDate(k);
  x.setDate(x.getDate() + n);
  return dayKey(+x);
};

export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** The rich version of a plain-text entry: one block per line. */
export const textToHtml = (text) => String(text ?? '').split('\n').map((l) => `<div>${escHtml(l) || '<br>'}</div>`).join('');
export const htmlOf = (e) => e.html || textToHtml(e.text);

/** A tag as stored: no leading #, inner spaces become dashes, at most 32 characters. */
export const normTag = (s) => String(s || '').trim().replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 32);
export function addTag(tags, s) {
  const tag = normTag(s);
  if (!tag) return tags || [];
  const list = (tags || []).filter((x) => x.toLocaleLowerCase() !== tag.toLocaleLowerCase());
  return [...list, tag];
}

export const newId = (now = Date.now()) => 'j' + now.toString(36) + Math.random().toString(36).slice(2, 6);
/** A new entry with the given fields (pure: the caller stores it). */
export function newEntry(d, f = {}) {
  const now = Date.now();
  const e = { id: f.id || newId(now), created: now, at: num(f.at, now), edited: now, text: '' };
  for (const k of ['title', 'text', 'html', 'mood', 'moment', 'prompt', 'media', 'bookmark', 'place', 'tags']) if (f[k]) e[k] = f[k];
  e.journal = f.journal && journalById(d, f.journal) ? f.journal : defJournal(d);
  return e;
}
/** addEntry(d, { text, title?, journal?, … }) → { d, entry } (for the "journal: …" Finder command and widgets). */
export function addEntry(d, f = {}) {
  d = norm(d);
  const e = newEntry(d, f);
  return { d: { ...d, entries: [e, ...d.entries] }, entry: e };
}
/** Removes entries that were deleted more than 30 days ago. → { d, removed } */
export function purge(d, now = Date.now()) {
  const removed = d.entries.filter((e) => e.deletedAt && now - e.deletedAt > KEEP_DAYS * DAY);
  return removed.length ? { d: { ...d, entries: d.entries.filter((e) => !removed.includes(e)) }, removed } : { d, removed };
}
export const daysLeft = (e, now = Date.now()) => Math.max(0, Math.ceil((e.deletedAt + KEEP_DAYS * DAY - now) / DAY));
/** Every blob id the journal still uses (Recycle bin included). */
export const blobIds = (d) => new Set(d.entries.flatMap((e) => (e.media || []).flatMap((m) => [m.id, m.vec].filter(Boolean))));

// ------------------------------------------------------------------ views: filters, search, grouping
/** filter: 'all' | 'bookmarked' | 'j:<journal id>' */
export function inView(d, e, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'bookmarked') return !!e.bookmark;
  if (filter.startsWith('j:')) return journalOf(d, e) === filter.slice(2);
  return true;
}
/** Search: every word of the query must appear in the title, text, place, tags or moment; "#tag" matches a tag. */
export function matches(e, query, extra = '') {
  const q = String(query || '').trim().toLocaleLowerCase();
  if (!q) return true;
  const hay = [e.title, e.text, e.place, ...(e.tags || []).map((x) => '#' + x), e.moment?.title, e.moment?.sub, ...(e.moment?.list || []), extra]
    .filter(Boolean).join('\n').toLocaleLowerCase();
  return q.split(/\s+/).every((w) => (w.startsWith('#') ? (e.tags || []).some((x) => ('#' + x.toLocaleLowerCase()).startsWith(w)) : hay.includes(w)));
}
export const sorted = (list) => list.slice().sort((a, b) => b.at - a.at || b.created - a.created);
/** [{ key: 'YYYY-MM', at, entries }] newest month first. */
export function byMonth(list) {
  const out = [];
  for (const e of sorted(list)) {
    const k = dayKey(e.at).slice(0, 7);
    if (out.at(-1)?.key !== k) out.push({ key: k, at: e.at, entries: [] });
    out.at(-1).entries.push(e);
  }
  return out;
}
/** Live entries of one day (by entry date), newest first. */
export const onDay = (d, key) => sorted(live(d).filter((e) => dayKey(e.at) === key));

// ------------------------------------------------------------------ Insights
/** Entries per day key (by entry date). */
export function perDay(d) {
  const m = new Map();
  for (const e of live(d)) {
    const k = dayKey(e.at);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
export const daysWith = (d) => new Set(perDay(d).keys());
/** Days in a row with an entry. Today without one yet doesn't break it: the streak runs up to yesterday. → { current, best, today } */
export function streak(d, now = Date.now()) {
  const days = daysWith(d), today = dayKey(now);
  let k = days.has(today) ? today : addDays(today, -1), current = 0;
  while (days.has(k)) {
    current++;
    k = addDays(k, -1);
  }
  let best = 0, run = 0, prev = null;
  for (const x of [...days].sort()) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best, today: days.has(today) };
}
/** Entries, words and days journaled in a year. */
export function yearStats(d, year = new Date().getFullYear()) {
  const list = live(d).filter((e) => new Date(e.at).getFullYear() === year);
  return { entries: list.length, words: list.reduce((n, e) => n + entryWords(e), 0), days: new Set(list.map((e) => dayKey(e.at))).size };
}
/** Entries written in each hour of the day (by when they were created, which is when you actually wrote). */
export function hours(d) {
  const h = new Array(24).fill(0);
  for (const e of live(d)) h[new Date(e.created || e.at).getHours()]++;
  return h;
}
/** 'morning' | 'afternoon' | 'evening' | 'night' | '' — when most entries are written. */
export function usualTime(h) {
  const parts = { morning: [5, 12], afternoon: [12, 17], evening: [17, 22], night: [22, 29] };
  let best = '', n = 0;
  for (const [k, [a, b]] of Object.entries(parts)) {
    let s = 0;
    for (let i = a; i < b; i++) s += h[i % 24];
    if (s > n) {
      n = s;
      best = k;
    }
  }
  return best;
}
/** Mood counts of the last `days` days: { 1: n, … 5: n, total, avg (1…5 or 0) }. */
export function moodStats(d, days = 30, now = Date.now()) {
  const from = +keyDate(dayKey(now)) - (days - 1) * DAY;
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0, avg: 0 };
  let sum = 0;
  for (const e of live(d)) {
    if (!e.mood || e.at < from || e.at > now + DAY) continue;
    const l = Math.round(e.mood.level);
    out[l]++;
    out.total++;
    sum += l;
  }
  out.avg = out.total ? sum / out.total : 0;
  return out;
}
/** The mood of a day: the average level of its entries with a mood, or 0. */
export function dayMood(list) {
  const m = list.filter((e) => e.mood);
  return m.length ? Math.round(m.reduce((s, e) => s + e.mood.level, 0) / m.length) : 0;
}
/** Most used tags: [[tag, count]] (case-insensitive, first spelling wins). */
export function topTags(d, n = 8) {
  const m = new Map();
  for (const e of live(d)) for (const tg of e.tags || []) {
    const k = tg.toLocaleLowerCase();
    const cur = m.get(k) || [tg, 0];
    cur[1]++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}
/**
 * The year heat-map: weeks (columns) of 7 days starting on `firstDay`, each { key, n, future, out } where `out` marks
 * days of the neighbouring years that pad the first and last week.
 */
export function heatWeeks(d, year, firstDay = 0, now = Date.now()) {
  const per = perDay(d);
  const start = new Date(year, 0, 1);
  start.setDate(start.getDate() - ((start.getDay() - firstDay + 7) % 7));
  const end = new Date(year, 11, 31);
  const weeks = [];
  const today = dayKey(now);
  for (const x = new Date(start); x <= end || weeks.at(-1)?.length < 7; x.setDate(x.getDate() + 1)) {
    if (!weeks.length || weeks.at(-1).length === 7) weeks.push([]);
    const k = dayKey(+x);
    weeks.at(-1).push({ key: k, n: per.get(k) || 0, future: k > today, out: x.getFullYear() !== year });
  }
  return weeks;
}
/** Heat level 0…4 for a count. */
export const heatLevel = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);

// ------------------------------------------------------------------ reflection prompts (texts in prompts.js, keyed p1 … pN)
export const PROMPT_COUNT = 40;
export const PROMPTS = Array.from({ length: PROMPT_COUNT }, (_, i) => 'p' + (i + 1));
const seedOf = (k) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
/** The prompts of a day, shuffled with the date as the seed: the same order all day, a new one tomorrow. */
export function promptsFor(day = Date.now()) {
  const k = typeof day === 'string' ? day : dayKey(+day), out = PROMPTS.slice();
  let s = seedOf(k);
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** The day's n-th reflection prompt key ('p7'). */
export const promptKey = (day = Date.now(), n = 0) => {
  const p = promptsFor(day);
  return p[((n % p.length) + p.length) % p.length];
};
export const isPrompt = (k) => PROMPTS.includes(k);

// ------------------------------------------------------------------ journaling schedule
/** The next time the schedule rings after `now` (ms), or null when it's off. */
export function nextScheduleAt(schedule, now = Date.now()) {
  const s = { ...PREFS.schedule, ...(schedule || {}) };
  if (!s.on || !s.days?.length) return null;
  const [h, m] = String(s.time || '21:00').split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const x = new Date(now);
    x.setDate(x.getDate() + i);
    x.setHours(h || 0, m || 0, 0, 0);
    if (+x > now && s.days.includes(x.getDay())) return +x;
  }
  return null;
}

// ------------------------------------------------------------------ export as text or Markdown
/**
 * The entries as one document. fmt = 'md' | 'txt'; labels = { date(ms) → string, mood(level) → name, journal(e) → name,
 * prompt(key) → text, title } (the caller formats in the UI language). Oldest first, like a diary.
 */
export function exportDoc(list, fmt = 'md', labels = {}) {
  const L = { date: (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' '), mood: (l) => String(l), journal: () => '', prompt: (k) => k, title: 'Journal', ...labels };
  const md = fmt === 'md';
  const out = [md ? `# ${L.title}` : L.title, ''];
  for (const e of list.slice().sort((a, b) => a.at - b.at || a.created - b.created)) {
    const head = e.title ? `${L.date(e.at)} · ${e.title}` : L.date(e.at);
    out.push(md ? `## ${head}` : head, md ? '' : '-'.repeat(Math.min(60, head.length)));
    const meta = [L.journal(e), e.mood ? L.mood(e.mood.level) : '', e.place || '', (e.tags || []).map((x) => '#' + x).join(' ')].filter(Boolean);
    if (meta.length) out.push(md ? `*${meta.join(' · ')}*` : meta.join(' · '), '');
    if (e.prompt) out.push(md ? `> ${L.prompt(e.prompt)}` : `“${L.prompt(e.prompt)}”`, '');
    if (e.moment?.title) out.push(md ? `> ${e.moment.title}${e.moment.sub ? ' — ' + e.moment.sub : ''}` : `${e.moment.title}${e.moment.sub ? ' — ' + e.moment.sub : ''}`, '');
    if (e.text) out.push(md ? mdText(e.text) : e.text, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
// Markdown: "• " list lines become "- ", and characters Markdown would read as formatting at a line start are escaped.
const mdText = (text) => String(text).split('\n').map((l) => (l.startsWith('• ') ? '- ' + l.slice(2) : l.replace(/^([#>*_-])/, '\\$1'))).join('\n');
