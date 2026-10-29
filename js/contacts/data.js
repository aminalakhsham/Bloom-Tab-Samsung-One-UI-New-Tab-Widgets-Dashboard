// Contacts for pages, on top of the shared store: reading and changing the `contacts` key, plus the helpers other
// surfaces use (Finder, widgets, the Lock screen, and later Calendar's birthdays): upcomingBirthdays(),
// searchContacts() and findContact().
import { store } from '../core/store.js';
import { lang } from '../core/i18n.js';
import * as M from './model.js';

let memo = { src: undefined, d: null };
/** The contacts store value, normalized (memoized until it changes). Treat it as read-only. */
export function data() {
  const src = store.get(M.KEY);
  if (memo.src !== src || !memo.d) memo = { src, d: M.norm(src) };
  return memo.d;
}
/** Changes the store value: fn gets a normalized copy to change in place (or to return a new one). */
export function mutate(fn) {
  store.update(M.KEY, (v) => {
    const d = M.norm(v);
    const r = fn(d);
    return M.pack(r || d);
  });
  return data();
}
export const byId = (id) => M.byId(data(), id);
export const prefs = () => data().prefs;
export const nameOf = (c) => M.displayName(c, data().prefs.order);

/** Birthdays in the next `days` days (today included): [{ id, name, date, age }] by date; age is null without a birth year. */
export function upcomingBirthdays(days = 30, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return M.birthdaysBetween(data(), from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + days + 1));
}
/** Contacts matching a search in any field (name, company, phone, email, address, notes…), best first:
 *  [{ contact, name, score, field, value }]. */
export function searchContacts(query, limit = 20) {
  const d = data(), order = d.prefs.order;
  return d.items.map((c) => ({ contact: c, name: M.displayName(c, order), ...M.match(c, query, order) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, lang())).slice(0, limit);
}
/** The contact that best matches a name, phone or email, or null. */
export const findContact = (query) => (String(query || '').trim() ? searchContacts(query, 1)[0]?.contact || null : null);
