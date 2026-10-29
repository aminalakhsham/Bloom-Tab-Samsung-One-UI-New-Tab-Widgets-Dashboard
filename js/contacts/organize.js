// Contacts list logic the app needs but the rest of the extension doesn't (so it loads only with the app): the A–Z
// sections and the fast-scroll letter index in the UI language's alphabet, Merge contacts (duplicates), and the
// Recycle bin moves. Pure functions on the store value from model.js.
import { norm, normContact, byId, fold, digits, personName, displayName, sortParts, parseDay, NAME_FIELDS, MULTI, ADDR_PARTS } from './model.js';

// ------------------------------------------------------------------ sections and the letter index
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const NATIVE = {
  ar: 'ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي'.split(' '),
  ru: 'А Б В Г Д Е Ж З И Й К Л М Н О П Р С Т У Ф Х Ц Ч Ш Щ Э Ю Я'.split(' '),
  ko: 'ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ'.split(' '),
  ja: 'あ か さ た な は ま や ら わ'.split(' '),
  tr: 'A B C Ç D E F G Ğ H I İ J K L M N O Ö P Q R S Ş T U Ü V W X Y Z'.split(' '),
  es: 'A B C D E F G H I J K L M N Ñ O P Q R S T U V W X Y Z'.split(' '),
};
/** The letters of the fast-scroll index for a UI language: its own alphabet, then A–Z, then #. */
export function indexLetters(lang = 'en') {
  const own = NATIVE[lang];
  if (!own) return [...LATIN, '#'];
  return own.includes('A') ? [...own, '#'] : [...own, ...LATIN, '#'];
}
const ZH_BOUNDS = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥仨他屲夕丫帀', ZH_LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
let zhColl;
const KO_INITIALS = 'ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ';
const KANA_ROWS = [['ぁ', 'あ'], ['か', 'か'], ['さ', 'さ'], ['た', 'た'], ['な', 'な'], ['は', 'は'], ['ま', 'ま'], ['ゃ', 'や'], ['ら', 'ら'], ['ゎ', 'わ']];
/** The section a sort key belongs to: a letter of the index, another script's letter, or '#'. */
export function sectionOf(key, lang = 'en') {
  const ch = [...String(key || '').trim()][0];
  if (!ch) return '#';
  if (/\p{Script=Latin}/u.test(ch)) {
    if (lang === 'tr' && 'çğıiöşüÇĞIİÖŞÜ'.includes(ch)) return ch.toLocaleUpperCase('tr');
    if (lang === 'es' && 'ñÑ'.includes(ch)) return 'Ñ';
    const b = ch.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
    return /^[A-Z]$/.test(b) ? b : '#';
  }
  if (/\p{Script=Cyrillic}|\p{Script=Greek}/u.test(ch)) return ch.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace('Ё', 'Е');
  if (/\p{Script=Arabic}/u.test(ch)) {
    const f = fold(ch);
    return /\p{L}/u.test(f) ? (f === 'ء' ? 'ا' : f) : '#';
  }
  if (/\p{Script=Hangul}/u.test(ch)) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return KO_INITIALS[Math.floor((c - 0xac00) / 588)];
    return NATIVE.ko.includes(ch) ? ch : '#';
  }
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
    let c = ch.charCodeAt(0);
    if (c >= 0x30a1 && c <= 0x30f6) c -= 0x60; // katakana → hiragana
    const h = String.fromCharCode(c);
    let row = '#';
    for (const [from, name] of KANA_ROWS) if (h >= from) row = name;
    return row;
  }
  if (/\p{Script=Han}/u.test(ch)) {
    if (lang === 'ja') return '#';
    // Chinese collation sorts by pinyin, so the first character of each letter's range finds the letter
    zhColl ??= new Intl.Collator('zh');
    let out = '#';
    for (let i = 0; i < ZH_BOUNDS.length; i++) {
      if (zhColl.compare(ZH_BOUNDS[i], ch) <= 0) out = ZH_LETTERS[i];
      else break;
    }
    return out;
  }
  if (/\p{L}/u.test(ch)) return ch.toLocaleUpperCase();
  return '#';
}

/** Contacts grouped into sections in index order: [{ key: letter, items: [contact] }], each sorted with the UI language's collation. */
export function sections(items, { sort = 'first', lang = 'en', locale = lang } = {}) {
  const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const idx = indexLetters(lang), map = new Map();
  for (const c of items) {
    const { key } = sortParts(c, sort);
    const s = sectionOf(key, lang);
    if (!map.has(s)) map.set(s, []);
    map.get(s).push({ c, key });
  }
  const rank = (s) => {
    const i = idx.indexOf(s);
    return s === '#' ? 1e6 : i >= 0 ? i : 5e5;
  };
  return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || coll.compare(a, b))
    .map(([key, list]) => ({ key, items: list.sort((x, y) => coll.compare(x.key, y.key) || coll.compare(displayName(x.c), displayName(y.c))).map((x) => x.c) }));
}

// ------------------------------------------------------------------ duplicates (Merge contacts)
const normName = (c) => fold(personName(c, 'first') || (c.isCo ? c.company : '')).replace(/[^\p{L}\p{N} ]/gu, '');
/** Groups of contacts that look like the same person (same name, a shared phone number or email address): [[id, …]]. */
export function findDuplicates(data) {
  const d = norm(data), skip = new Set(d.dupSkip);
  const parent = new Map(d.items.map((c) => [c.id, c.id]));
  const root = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const join = (a, b) => {
    if (skip.has([a, b].sort().join('|'))) return;
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const seen = new Map();
  for (const c of d.items) {
    const keys = [];
    const n = normName(c);
    if (n.replace(/ /g, '').length >= 2) keys.push('n:' + n);
    for (const e of c.emails || []) keys.push('e:' + e.v.toLowerCase());
    // Samsung also links cards that share a phone number (compared by its last 9 digits, so +966 and 0 prefixes match)
    for (const p of c.phones || []) {
      const dg = digits(p.v);
      if (dg.length >= 7) keys.push('p:' + dg.slice(-9));
    }
    for (const k of keys) {
      if (seen.has(k)) join(seen.get(k), c.id);
      else seen.set(k, c.id);
    }
  }
  const groups = new Map();
  for (const c of d.items) {
    const r = root(c.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c.id);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
const filled = (c) => [...NAME_FIELDS, 'note', 'bday', 'photo'].filter((k) => c[k]).length + MULTI.reduce((n, t) => n + (c[t]?.length || 0), 0);
const entryKey = (t, e) => (t === 'phones' ? digits(e.v).slice(-9) : t === 'addrs' ? fold(ADDR_PARTS.map((k) => e[k]).join(' ')) : fold(e.v));
/** One contact made of several: the fullest card is kept, and every phone, email, address and note of the others is added to it. */
export function mergeContacts(list, now = Date.now()) {
  const cs = list.filter(Boolean).slice().sort((a, b) => filled(b) - filled(a) || (b.updated || 0) - (a.updated || 0));
  const out = { ...cs[0] };
  for (const c of cs.slice(1)) {
    for (const k of [...NAME_FIELDS, 'photo', 'av', 'keep', 'isCo']) if (!out[k] && c[k]) out[k] = c[k];
    const ob = parseDay(out.bday), cb = parseDay(c.bday);
    if (cb && (!ob || (!ob.y && cb.y && cb.m === ob.m && cb.d === ob.d))) out.bday = c.bday;
    for (const t of MULTI) {
      const have = new Set((out[t] || []).map((e) => entryKey(t, e)));
      for (const e of c[t] || []) {
        const k = entryKey(t, e);
        if (k && !have.has(k)) {
          have.add(k);
          out[t] = [...(out[t] || []), e];
        }
      }
    }
    if (c.note && !(out.note || '').includes(c.note)) out.note = out.note ? `${out.note}\n\n${c.note}` : c.note;
  }
  out.created = Math.min(...cs.map((c) => c.created || now));
  out.updated = now;
  return normContact(out);
}
/** Merges contacts in the store value: the merged card takes the first one's place, and groups, Favourites and My profile follow it. */
export function applyMerge(d, ids, now = Date.now()) {
  const cs = ids.map((id) => byId(d, id)).filter(Boolean);
  if (cs.length < 2) return d;
  const merged = mergeContacts(cs, now);
  const gone = new Set(cs.map((c) => c.id).filter((id) => id !== merged.id));
  const all = new Set(cs.map((c) => c.id));
  d.items = d.items.filter((c) => !gone.has(c.id)).map((c) => (c.id === merged.id ? merged : c));
  for (const g of d.groups) if (g.ids.some((id) => all.has(id))) g.ids = [...new Set(g.ids.map((id) => (all.has(id) ? merged.id : id)))];
  if (d.favs.some((id) => all.has(id))) d.favs = [...new Set(d.favs.map((id) => (all.has(id) ? merged.id : id)))];
  if (all.has(d.me)) d.me = merged.id;
  return d;
}

// ------------------------------------------------------------------ Recycle bin
/** Moves contacts to the Recycle bin, remembering their Favourites, groups and My profile so Restore puts them back. */
export function trashContacts(d, ids, now = Date.now()) {
  const gone = new Set(ids);
  const moved = d.items.filter((c) => gone.has(c.id)).map((c) => ({
    c, at: now, fav: d.favs.includes(c.id), me: d.me === c.id, groups: d.groups.filter((g) => g.ids.includes(c.id)).map((g) => g.id),
  }));
  d.items = d.items.filter((c) => !gone.has(c.id));
  d.favs = d.favs.filter((id) => !gone.has(id));
  for (const g of d.groups) g.ids = g.ids.filter((id) => !gone.has(id));
  if (gone.has(d.me)) d.me = null;
  d.trash = [...moved, ...(d.trash || [])];
  return d;
}
/** Restores contacts from the Recycle bin (by contact id). */
export function restoreContacts(d, ids) {
  const want = new Set(ids);
  for (const x of (d.trash || []).filter((e) => want.has(e.c.id))) {
    if (byId(d, x.c.id)) continue;
    d.items.push(x.c);
    if (x.fav && !d.favs.includes(x.c.id)) d.favs.push(x.c.id);
    if (x.me && !d.me) d.me = x.c.id;
    for (const g of d.groups) if (x.groups.includes(g.id) && !g.ids.includes(x.c.id)) g.ids.push(x.c.id);
  }
  d.trash = (d.trash || []).filter((e) => !want.has(e.c.id));
  return d;
}
/** Days left before a Recycle bin entry is deleted for good (at least 1 while it is still there). */
export const daysLeft = (entry, now = Date.now(), keep = 30) => Math.max(1, Math.ceil((entry.at + keep * 864e5 - now) / 864e5));
