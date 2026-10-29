// Galaxy Store for websites: the pure model. The catalog as apps, the categories, the charts, the daily Discover
// rotation and search scoring. No DOM, no storage and no strings here (ui.js and data.js translate), so the service
// worker or a plain-node test (.dev/store-model.mjs) can use it too.
import { CATALOG } from './catalog.js';

/** Categories (Screen Time's, as Galaxy Store-style groups): a fixed colour and glyph each, so a category looks the same
 *  on the banners, in the lists and in the generated site icons. Names are the i18n keys `store.cat.<id>`. */
export const CATS = {
  social: { color: '#3e7bff', icon: 'gsChat' },
  entertainment: { color: '#f0457a', icon: 'gsPlay' },
  productivity: { color: '#159e8c', icon: 'gsWork' },
  creativity: { color: '#ff7f3f', icon: 'palette' },
  reading: { color: '#a0724f', icon: 'gsBook' },
  shopping: { color: '#22a85a', icon: 'gsCart' },
  travel: { color: '#0aa5cf', icon: 'airplane' },
  health: { color: '#ff4b4b', icon: 'gsHeart' },
  education: { color: '#f2a900', icon: 'gsCap' },
  games: { color: '#9b5de5', icon: 'gsGame' },
  utilities: { color: '#5f7387', icon: 'gsTool' },
  other: { color: '#8e8f97', icon: 'globe' },
};

/** [site, name, (label,) cat] → { site, host, name, label, cat, url, rank } (rank = catalog order, 0-based). */
// (the generated names can end in stray punctuation, e.g. "DuckDuckGo,")
const tidy = (s) => String(s).replace(/[\s,;:|–—-]+$/, '');
export const APPS = CATALOG.map(([site, name, a, b], rank) => ({
  site,
  host: site.replace(/\/.*/, '').toLowerCase(),
  name: tidy(name),
  label: tidy(b ? a : name),
  cat: b || a,
  url: 'https://' + site + (site.includes('/') ? '' : '/'),
  rank,
}));
export const BY_SITE = new Map(APPS.map((a) => [a.site, a]));
const BY_CAT = new Map();
for (const a of APPS) {
  if (!BY_CAT.has(a.cat)) BY_CAT.set(a.cat, []);
  BY_CAT.get(a.cat).push(a);
}
export const inCat = (id) => BY_CAT.get(id) || [];
/** Position of the site in its category's chart, 1-based. */
export const catRank = (app) => inCat(app.cat).indexOf(app) + 1;
/** The categories in the order the store lists them (only those with sites). */
export const CAT_ORDER = ['social', 'entertainment', 'productivity', 'creativity', 'reading', 'shopping', 'travel', 'health', 'education', 'games', 'utilities'].filter((id) => inCat(id).length);

/** The best of every category in turn, so the overall chart isn't all one kind of site (Liquid Tab's Top Websites). */
export function topChart(n = 100, cat = null) {
  if (cat) return inCat(cat).slice(0, n);
  const lists = CAT_ORDER.map(inCat), out = [];
  for (let i = 0; out.length < n && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
  return out;
}

const OVERALL = new Map(topChart(APPS.length).map((a, i) => [a, i + 1]));
/** Position of the site in the overall chart (Top websites), 1-based. */
export const overallRank = (app) => OVERALL.get(app) || 0;

/** Sites of a category A–Z (by name, in the given collator's order). */
export const alphabetical = (id, compare = (a, b) => a.localeCompare(b)) => [...inCat(id)].sort((a, b) => compare(a.name, b.name));

// ——— the daily rotation ———

/** Days since the epoch in local time: Discover, Today's pick and Popular searches change when it does. */
export const dayNumber = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5);

/** Small seeded PRNG (mulberry32), so a day always shows the same picks on every tab and every reload. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(list, seed) {
  const r = rng(seed), out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const byRank = (a, b) => a.rank - b.rank;

/** Today's pick: walks a fixed shuffle of every category's top six, so it doesn't repeat for two months. */
export function pickOfDay(day = dayNumber()) {
  const pool = shuffle(CAT_ORDER.flatMap((id) => inCat(id).slice(0, 6)), 20261026);
  return pool[((day % pool.length) + pool.length) % pool.length];
}

/**
 * Discover for a day: three banners, the Must-have row (the top three of every category, a different twelve each day)
 * and three "Popular in <category>" rows (twelve of the category's top eighteen, still in chart order).
 */
export function discover(day = dayNumber()) {
  const cats = shuffle(CAT_ORDER.filter((id) => inCat(id).length >= 12), day * 7 + 1);
  const banners = cats.slice(0, 3).map((cat, k) => ({ cat, apps: shuffle(inCat(cat).slice(0, 10), day * 31 + k).slice(0, 3) }));
  const mustHave = shuffle(CAT_ORDER.flatMap((id) => inCat(id).slice(0, 3)), day * 13 + 5).slice(0, 12);
  const popular = [...cats.slice(3, 6), ...cats.slice(0, 3)].slice(0, 3).map((cat, k) => ({ cat, apps: shuffle(inCat(cat).slice(0, 18), day * 17 + k).slice(0, 12).sort(byRank) }));
  return { banners, mustHave, popular, pick: pickOfDay(day), top: topChart(12) };
}

/** Names for the "Popular searches" list: the day's ten from the overall chart's top forty. */
export const popularSearches = (day = dayNumber()) => shuffle(topChart(40), day * 3 + 11).slice(0, 10);

/** Other sites a person who looks at `app` might like: its category neighbours in the chart, nearest first. */
export function similar(app, n = 9) {
  return inCat(app.cat).filter((a) => a !== app).sort((a, b) => Math.abs(a.rank - app.rank) - Math.abs(b.rank - app.rank) || a.rank - b.rank).slice(0, n);
}

// ——— search ———

/** Lower case without accents, for matching typed text ("Deezer" ≈ "deezer", "Pokémon" ≈ "pokemon"). */
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** How well `app` matches the normalised query: 0 = not at all; ≥ 400 means a prefix or substring hit. */
export function score(app, q) {
  if (!q) return 0;
  const name = norm(app.name), label = norm(app.label), host = app.host, base = host.replace(/^(www|m|web|open)\./, '');
  if (name === q || label === q || base.split('.')[0] === q) return 1000;
  if (label.startsWith(q) || name.startsWith(q)) return 900 - Math.min(99, label.length - q.length);
  if (name.split(/[\s\-–:·.,()]+/).some((w) => w.startsWith(q))) return 700;
  if (base.startsWith(q) || host.split('.').some((p) => p.length > 2 && p.startsWith(q))) return 650;
  if (name.includes(q) || label.includes(q)) return 500;
  if (host.includes(q)) return 400;
  // letters in order ("ytm" → YouTube Music), only for three or more letters so short queries stay strict
  if (q.length >= 3 && !/\s/.test(q)) {
    let i = 0;
    for (const ch of name) if (ch === q[i]) i++;
    if (i === q.length) return 100;
  }
  return 0;
}

/** Catalog sites matching the query, best first (then by chart position). `min` drops weak (fuzzy) hits. */
export function searchApps(query, { limit = 40, min = 1 } = {}) {
  const q = norm(query);
  if (!q) return [];
  return APPS.map((a) => [a, score(a, q)]).filter((x) => x[1] >= min).sort((a, b) => b[1] - a[1] || a[0].rank - b[0].rank).slice(0, limit).map((x) => x[0]);
}

/** Catalog site for a host, if the store lists it ("www.netflix.com" → Netflix). */
export function appForHost(host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  return APPS.find((a) => a.host === host) || null;
}
