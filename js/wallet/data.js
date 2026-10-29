// Samsung Wallet's page-side data helpers, shared by the app, its widgets, Finder commands and the Now Bar: they read
// and write the "wallet" store key, so the app, its widgets and other tabs update by themselves.
//   data() → the normalised wallet (cached until the key changes; treat it as read-only, change it with mutate())
//   mutate(fn) → runs fn(d) on a normalised copy and stores it
//   currency() → the default currency (Wallet settings, else the browser's region)
//   addExpense({ amount, currency, merchant, category, at, note }) → the stored expense | null
//   expenseIn(text) → { amount, currency, merchant, category, at } | null   ("coffee 3.5$", "12 € lunch", "spent 30 on taxi")
//   upcomingBills(days) → [{ id, name, amount, currency, date, days, trial, url, cat, bill }] (every occurrence)
//   monthTotal() → { cur, total, byCurrency, text }: what was spent this month
//   nextPasses(days) → tickets and boarding passes from now on
import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import * as M from './model.js';
import { regionCurrency, decimalChar, money, moneyLines } from './money.js';

let raw, cached;
export function data() {
  const v = store.get(M.KEY);
  if (v !== raw || !cached) { raw = v; cached = M.norm(v); }
  return cached;
}
export function mutate(fn) {
  store.update(M.KEY, (v) => { const d = M.norm(v); fn(d); return d; });
}
export const currency = () => data().prefs.cur || regionCurrency();
export const onWallet = (fn) => store.on(M.KEY, fn);

export function addExpense({ amount, currency: cur, merchant = '', category, at = Date.now(), note = '' } = {}) {
  const e = M.normExpense({ id: 'e' + uid(), amt: +amount, cur: cur || currency(), mer: merchant, cat: category || M.guessCategory(merchant), at: +at || Date.now(), note });
  if (!(e.amt > 0)) return null;
  mutate((d) => d.spend.push(e));
  return e;
}
export const parseExpense = (text) => M.parseExpense(text, { currency: currency(), decimal: decimalChar() });
export const expenseIn = (text) => M.expenseIn(text, { currency: currency(), decimal: decimalChar() });
export const upcomingBills = (days = 30) => M.upcoming(data().subs, days);
/** The next bill of each subscription (one row per subscription), soonest first. */
export function nextBills(days = 45) {
  const seen = new Set();
  return upcomingBills(days).filter((b) => !seen.has(b.id) && seen.add(b.id));
}
export function monthTotal(now = new Date()) {
  const d = data(), cur = currency();
  const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const byCur = M.byCurrency(d.spend, from, to);
  return { cur, total: byCur[cur] || 0, byCurrency: byCur, text: moneyLines(byCur, cur).join(' · ') || money(0, cur), from, to };
}
export const nextPasses = (days = 1) => M.upcomingPasses(data().passes, days);
/** The pass a "Quick access" widget shows: its own choice, then Wallet's, then the next trip or event, then Quick access. */
export function widgetPass(choice) {
  const d = data(), live = d.passes.filter((p) => !M.isExpired(p));
  return live.find((p) => p.id === choice) || live.find((p) => p.id === d.prefs.widgetPass) || M.upcomingPasses(live, 2)[0] || live.find((p) => p.quick) || live[0] || null;
}
