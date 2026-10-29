// Contacts data model, shared by the Contacts app, its widgets, Finder, the Lock screen and the service worker
// (birthday and Keep in touch notifications). Pure functions only: no DOM, no storage, no translations, so the
// plain-node test (.dev/contacts-vcard.mjs) and the worker can import it. Ported from Liquid Tab's model.
//
// Stored under `contacts`; empty fields are left out to keep it small, and photos are blobs in IndexedDB
// (`contacts:<id>` through core/blobs.js):
//   { v: 1, items: [Contact], groups: [{ id, name, ids: [contact id] }], favs: [contact id], me: contact id | null,
//     prefs: { sort: 'first'|'last', order: 'first'|'last', alert: days before a birthday (-1 = off), alertTime: 'HH:MM' },
//     dupSkip: ['id|id'] (pairs the user kept apart in Merge contacts),
//     trash: [{ c: Contact, at: ms deleted, fav: bool, groups: [group id], me: bool }] (Recycle bin, kept 30 days) }
//   Contact = { id, first?, last?, middle?, prefix?, suffix?, nick?, maiden?, pfirst?, pmiddle?, plast?, pcompany?,
//     company?, dept?, job?, isCo? (a company card), phones?, emails?, urls?, social?, related?: [{ l: label, v }],
//     addrs?: [{ l, street, city, region, zip, country }], bday?: 'YYYY-MM-DD' | '--MM-DD', dates?: [{ l, v: date }],
//     note?, photo? (blob key), av?: { e?: emoji sticker, c?: avatar colour }, keep?: { n, u: 'w'|'m', since: ms }
//     (Keep in touch), created, updated }
// Labels are the ids in LABELS (translated when shown) or any custom text.
// `me` (My profile) is a contact in `items`; the list shows it in the profile card instead of the A–Z sections.
// The service worker writes only `contactsBg` ({ mark, fired: { id: ms }, touched: { id: ms } }), never `contacts`.

export const KEY = 'contacts';
export const BG_KEY = 'contactsBg';
export const TRASH_DAYS = 30;
// Samsung sorts by first name and shows the first name first out of the box.
export const DEFAULT_PREFS = { sort: 'first', order: 'first', alert: 0, alertTime: '09:00' };
export const DEF = () => ({ v: 1, items: [], groups: [], favs: [], me: null, prefs: { ...DEFAULT_PREFS }, dupSkip: [], trash: [] });

export const NAME_FIELDS = ['prefix', 'first', 'pfirst', 'middle', 'pmiddle', 'last', 'plast', 'maiden', 'suffix', 'nick', 'job', 'dept', 'company', 'pcompany'];
export const MULTI = ['phones', 'emails', 'urls', 'addrs', 'dates', 'related', 'social'];
export const ADDR_PARTS = ['street', 'city', 'region', 'zip', 'country'];
// The labels Samsung's editor offers for each kind of field (plus "Custom").
export const LABELS = {
  phones: ['mobile', 'home', 'work', 'main', 'workfax', 'homefax', 'pager', 'other'],
  emails: ['home', 'work', 'other'],
  urls: ['homepage', 'home', 'work', 'other'],
  addrs: ['home', 'work', 'other'],
  dates: ['anniversary', 'other'],
  related: ['assistant', 'brother', 'child', 'father', 'friend', 'manager', 'mother', 'parent', 'partner', 'sister', 'spouse', 'other'],
  social: ['Twitter', 'Facebook', 'Flickr', 'LinkedIn', 'Myspace', 'Sina Weibo'],
};
// A new row takes the next label nobody uses yet: a second phone is "home", a third "work".
const NEXT = { phones: ['mobile', 'home', 'work', 'other'], emails: ['home', 'work', 'other'], urls: ['homepage', 'home', 'work', 'other'], addrs: ['home', 'work', 'other'], dates: ['anniversary', 'other'], related: ['mother', 'father', 'brother', 'sister', 'friend', 'other'], social: LABELS.social };
export function nextLabel(type, list = []) {
  const used = new Set(list.map((x) => x.l));
  return (NEXT[type] || ['other']).find((l) => !used.has(l)) || 'other';
}

// ------------------------------------------------------------------ normalizing
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const DATE_RE = /^(\d{4}|-{2})-?(\d{2})-?(\d{2})$/;
/** { y: number | null, m: 1-12, d: 1-31 } from 'YYYY-MM-DD' or '--MM-DD', or null. */
export function parseDay(v) {
  const m = DATE_RE.exec(str(v).trim());
  if (!m) return null;
  const y = m[1] === '--' ? null : +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return null;
  if (y != null && (y < 1000 || (mo === 2 && d === 29 && !isLeap(y)))) return y < 1000 ? { y: null, m: mo, d } : null;
  return { y, m: mo, d };
}
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = ({ y, m, d }) => `${y ? String(y).padStart(4, '0') : '-'}-${p2(m)}-${p2(d)}`;

function normEntry(type, e) {
  if (!e || typeof e !== 'object') return null;
  const l = str(e.l).trim() || nextLabel(type);
  if (type === 'addrs') {
    const a = { l };
    for (const k of ADDR_PARTS) {
      const v = str(e[k]).trim();
      if (v) a[k] = v;
    }
    return Object.keys(a).length > 1 ? a : null;
  }
  if (type === 'dates') {
    const d = parseDay(e.v);
    return d ? { l, v: dayKey(d) } : null;
  }
  const v = str(e.v).trim();
  return v ? { l, v } : null;
}

/** A clean copy of a contact: strings trimmed, empty fields and broken entries left out, unknown fields kept. */
export function normContact(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { ...c, id: str(c.id) || 'c' + Math.random().toString(36).slice(2, 10) };
  for (const k of [...NAME_FIELDS, 'note']) {
    const v = str(c[k]);
    if (v.trim()) out[k] = k === 'note' ? v.replace(/\s+$/, '') : v.trim().replace(/\s+/g, ' ');
    else delete out[k];
  }
  for (const t of MULTI) {
    const list = Array.isArray(c[t]) ? c[t].map((e) => normEntry(t, e)).filter(Boolean) : [];
    if (list.length) out[t] = list;
    else delete out[t];
  }
  const b = parseDay(c.bday);
  if (b) out.bday = dayKey(b);
  else delete out.bday;
  if (!str(c.photo)) delete out.photo;
  if (c.av && typeof c.av === 'object' && (str(c.av.e) || str(c.av.c))) out.av = { ...(str(c.av.e) ? { e: str(c.av.e) } : {}), ...(str(c.av.c) ? { c: str(c.av.c) } : {}) };
  else delete out.av;
  if (c.keep && c.keep.n > 0 && (c.keep.u === 'w' || c.keep.u === 'm')) out.keep = { n: Math.min(99, c.keep.n | 0 || 1), u: c.keep.u, since: +c.keep.since || +c.created || Date.now() };
  else delete out.keep;
  if (c.isCo) out.isCo = true;
  else delete out.isCo;
  return out;
}

/** The whole store value with every part present and valid; tolerates missing, old or corrupt data. Recycle bin
 *  entries older than 30 days are dropped. */
export function norm(v, now = Date.now()) {
  const d = v && typeof v === 'object' ? v : {};
  const seen = new Set();
  const items = (Array.isArray(d.items) ? d.items : []).map(normContact).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
  const ids = new Set(items.map((c) => c.id));
  const groupsIn = Array.isArray(d.groups) ? d.groups : Array.isArray(d.lists) ? d.lists : [];
  const groups = groupsIn.filter((g) => g && typeof g === 'object' && str(g.id)).map((g) => ({ ...g, id: str(g.id), name: str(g.name), ids: [...new Set((Array.isArray(g.ids) ? g.ids : []).filter((id) => ids.has(id)))] }));
  const trash = (Array.isArray(d.trash) ? d.trash : [])
    .filter((x) => x && typeof x === 'object' && x.c && now - (+x.at || 0) < TRASH_DAYS * 864e5)
    .map((x) => ({ ...x, c: normContact(x.c), at: +x.at, groups: Array.isArray(x.groups) ? x.groups.filter((g) => typeof g === 'string') : [] }))
    .filter((x) => x.c && !ids.has(x.c.id));
  const out = {
    ...d, v: 1, items, groups, trash,
    favs: [...new Set((Array.isArray(d.favs) ? d.favs : []).filter((id) => ids.has(id)))],
    me: ids.has(d.me) ? d.me : null,
    prefs: { ...DEFAULT_PREFS, ...(d.prefs && typeof d.prefs === 'object' ? d.prefs : {}) },
    dupSkip: Array.isArray(d.dupSkip) ? d.dupSkip.filter((x) => typeof x === 'string') : [],
  };
  delete out.lists;
  return out;
}
export const byId = (d, id) => d.items.find((c) => c.id === id) || null;

/** True when a contact has nothing worth keeping (an empty Create contact form). */
export const isEmpty = (c) => !c || (![...NAME_FIELDS, 'note', 'bday', 'photo'].some((k) => c[k]) && !MULTI.some((t) => c[t]?.length) && !c.av?.e);

/** The store value as saved: contacts packed (empty fields dropped). */
export function pack(d) {
  return { ...d, items: d.items.map(normContact).filter(Boolean) };
}

// ------------------------------------------------------------------ names
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
/** "First Middle Last" (or "Last First" with that name format); CJK names are written family name first, without a space. */
export function personName(c, order = 'first') {
  if (!c) return '';
  const given = [c.first, c.middle].filter(Boolean).join(' '), fam = c.last || '';
  if (CJK.test(given + fam)) return [c.prefix, `${fam}${given}`, c.suffix].filter(Boolean).join(' ');
  const core = order === 'last' ? [fam, given] : [given, fam];
  return [c.prefix, ...core, c.suffix].filter(Boolean).join(' ');
}
/** The name shown for a contact: the person's name, else the company, nickname, an email or a phone number ('' when there's none). */
export function displayName(c, order = 'first') {
  if (!c) return '';
  if (c.isCo && c.company) return c.company;
  return personName(c, order) || c.company || c.nick || c.emails?.[0]?.v || c.phones?.[0]?.v || '';
}
/** The text a contact sorts by (first or last name first), phonetic names winning when they are set. */
export function sortParts(c, sort = 'first') {
  if (c.isCo || (!c.first && !c.last)) return { key: displayName(c), bold: 'all' };
  const first = c.pfirst || c.first || '', last = c.plast || c.last || '';
  return sort === 'first' ? { key: `${first} ${last}`.trim(), bold: c.first ? 'first' : 'last' } : { key: `${last} ${first}`.trim(), bold: c.last ? 'last' : 'first' };
}

/** Up to two initials (one character for CJK names); '' when there's no name. */
export function initials(c) {
  if (!c) return '';
  const pick = (s) => [...String(s || '').trim()][0] || '';
  if (c.isCo || (!c.first && !c.last)) {
    const n = c.company || c.nick || '';
    return CJK.test(n) ? pick(n) : /\p{L}/u.test(pick(n)) ? pick(n).toLocaleUpperCase() : '';
  }
  if (CJK.test((c.last || '') + (c.first || ''))) return pick(c.last || c.first);
  // an Arabic family name's article ("الحربي") isn't its initial, so the monogram takes the letter after it
  const last = /^ال\p{L}{2}/u.test(c.last || '') ? c.last.slice(2) : c.last;
  const a = pick(c.first), b = pick(last);
  // a zero-width non-joiner keeps two Arabic letters as separate letters instead of joining them into one word
  return [a, b].filter((x) => /\p{L}/u.test(x)).map((x) => x.toLocaleUpperCase()).join(/\p{Script=Arabic}/u.test(a + b) ? '‌' : '');
}
/** The one letter on Samsung's coloured avatar: the first letter of the name as shown ('' when it isn't a letter). */
export function initial(c, order = 'first') {
  if (!c) return '';
  const cjk = CJK.test((c.last || '') + (c.first || ''));
  const parts = c.isCo && c.company ? [c.company] : cjk || order === 'last' ? [c.last, c.first] : [c.first, c.last];
  const ch = [...(parts.filter(Boolean).join(' ') || c.company || c.nick || '').trim()][0] || '';
  return /\p{L}/u.test(ch) ? ch.toLocaleUpperCase() : '';
}

// ------------------------------------------------------------------ search
const ARABIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
/** Text for matching: lower case, accents and Arabic short vowels removed, hamza and ta marbuta forms folded, digits Latin. */
export function fold(s) {
  return String(s ?? '').replace(ARABIC_DIGITS, (d) => d.charCodeAt(0) % 16).normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const digits = (s) => String(s ?? '').replace(ARABIC_DIGITS, (d) => d.charCodeAt(0) % 16).replace(/\D/g, '');

/** How well a contact matches a search: { score, field, value } (score 0 = no match). Searches every field. */
export function match(c, q, order = 'first') {
  const fq = fold(q);
  if (!fq) return { score: 1 };
  const words = fq.split(' ');
  const name = fold([personName(c, order), c.nick, c.maiden, c.pfirst, c.plast, c.pmiddle].filter(Boolean).join(' '));
  const nameWords = name.split(' ');
  if (words.every((w) => nameWords.some((n) => n.startsWith(w)))) return { score: name.startsWith(fq) ? 100 : 90 };
  if (words.every((w) => name.includes(w))) return { score: 70 };
  const fields = [['company', c.company], ['job', c.job], ['dept', c.dept], ['pcompany', c.pcompany], ...MULTI.flatMap((t) => (c[t] || []).map((e) => [t, t === 'addrs' ? ADDR_PARTS.map((k) => e[k]).filter(Boolean).join(', ') : e.v])), ['note', c.note]];
  for (const [field, value] of fields) if (value && words.every((w) => fold(value).includes(w))) return { score: field === 'company' ? 60 : 40, field, value };
  const dq = digits(q);
  if (dq.length >= 3 && /^[\d\s()+\-.٠-٩۰-۹]+$/.test(q.trim())) for (const p of c.phones || []) if (digits(p.v).includes(dq)) return { score: 50, field: 'phones', value: p.v };
  return { score: 0 };
}

// ------------------------------------------------------------------ birthdays
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** A birthday's date in a year; Feb 29 falls on Feb 28 in other years. */
export function birthdayIn(b, year) {
  return b.m === 2 && b.d === 29 && !isLeap(year) ? new Date(year, 1, 28) : new Date(year, b.m - 1, b.d);
}
/** Birthdays whose day overlaps [from, to): [{ id, name, date (local midnight), age (null without a birth year) }], by date. */
export function birthdaysBetween(data, from, to, order) {
  const o = order || data?.prefs?.order || 'first';
  const lo = dayStart(from), out = [];
  for (const c of Array.isArray(data?.items) ? data.items : []) {
    const b = c && typeof c === 'object' ? parseDay(c.bday) : null;
    if (!b) continue;
    for (let y = lo.getFullYear() - 1; y <= to.getFullYear(); y++) {
      if (b.y && y < b.y) continue;
      const date = birthdayIn(b, y);
      if (date >= lo && date < to) out.push({ id: c.id, name: displayName(c, o), date, age: b.y ? y - b.y : null });
    }
  }
  return out.sort((a, b) => a.date - b.date || a.name.localeCompare(b.name));
}
/** The next birthday of a contact on or after today: { date, age } or null. */
export function nextBirthday(c, now = new Date()) {
  const b = parseDay(c?.bday);
  if (!b) return null;
  const today = dayStart(now);
  let y = today.getFullYear(), date = birthdayIn(b, y);
  if (date < today) date = birthdayIn(b, ++y);
  return { date, age: b.y ? y - b.y : null };
}
/** Whole days from today to a date (0 = today). */
export const daysUntil = (date, now = new Date()) => Math.round((dayStart(date) - dayStart(now)) / 864e5);
/** Birthday notification moments in [from, to): the chosen time on the day, `alert` days before. [{ at, id, name, date, age }] */
export function birthdayAlerts(data, from, to) {
  const d = norm(data), p = d.prefs;
  if (!(p.alert >= 0)) return [];
  const [h, m] = String(p.alertTime || '09:00').split(':').map(Number);
  const shift = (p.alert * 1440 - ((h || 0) * 60 + (m || 0))) * 60000;
  return birthdaysBetween(d, new Date(+from + shift - 864e5), new Date(+to + shift + 864e5))
    .map((b) => ({ ...b, at: +b.date - shift })).filter((b) => b.at >= +from && b.at < +to);
}

// ------------------------------------------------------------------ Keep in touch
export function addPeriod(ms, n, u) {
  const d = new Date(ms);
  if (u === 'm') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + 7 * n);
  return +d;
}
/** When the next Keep in touch reminder is due (10 AM on the day), given the last contact and the last reminder shown. */
export function keepDue(c, touched = 0, fired = 0) {
  const k = c?.keep;
  if (!k) return null;
  const since = Math.max(+k.since || 0, +touched || 0);
  const at10 = (ms) => new Date(ms).setHours(10, 0, 0, 0);
  let due = addPeriod(since, k.n, k.u);
  for (let i = 0; i < 400 && at10(due) <= fired; i++) due = addPeriod(due, k.n, k.u);
  return at10(due);
}
