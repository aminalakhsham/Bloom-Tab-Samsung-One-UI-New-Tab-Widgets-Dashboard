// Service-worker part of Samsung Wallet: alerts before subscriptions and bills renew, at Wallet's bill alert time, the
// chosen number of days before (and on the day, when asked), and before a free trial turns into a paid plan. Ported
// from Liquid Tab's bg/wallet.js onto js/bg/hub.js.
// Alarms: "wallet:sub:<id>" for each subscription's next alert, "wallet:plan" twice a day to plan again (and after the
// `wallet` key changes). Notifications: "wallet:<sub id>:<date>:<days before>"; a click opens Wallet on that
// subscription. The worker only reads the `wallet` key, which the pages own; it can sleep at any time, so nothing is
// kept in module variables except a signature that saves needless replanning.
import * as M from '../wallet/model.js';
import { onAlarm, openTarget, onMessage, post, bgStrings, bgLocale, bgLang, fmt } from './hub.js';

const PLAN = 'wallet:plan', SUB = 'wallet:sub:';
const S = {
  en: {
    renewsToday: 'Renews today · {amount}', renewsTomorrow: 'Renews tomorrow · {amount}', renewsOn: 'Renews on {date} · {amount}',
    dueToday: 'Due today · {amount}', dueTomorrow: 'Due tomorrow · {amount}', dueOn: 'Due on {date} · {amount}',
    trialToday: 'Free trial ends today, then {amount}', trialTomorrow: 'Free trial ends tomorrow, then {amount}', trialOn: 'Free trial ends on {date}, then {amount}',
  },
  ar: {
    renewsToday: 'يتجدد اليوم · {amount}', renewsTomorrow: 'يتجدد غدًا · {amount}', renewsOn: 'يتجدد في {date} · {amount}',
    dueToday: 'مستحقة اليوم · {amount}', dueTomorrow: 'مستحقة غدًا · {amount}', dueOn: 'مستحقة في {date} · {amount}',
    trialToday: 'تنتهي الفترة التجريبية اليوم، ثم {amount}', trialTomorrow: 'تنتهي الفترة التجريبية غدًا، ثم {amount}', trialOn: 'تنتهي الفترة التجريبية في {date}، ثم {amount}',
  },
};

let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));
let lastSig = null;

/** Sets one alarm per subscription at its next alert and removes the rest. Returns the alarm names. */
export const plan = () => serial(planNow).catch((e) => { console.warn('wallet plan', e); return []; });
async function planNow() {
  const { wallet } = await chrome.storage.local.get('wallet');
  const d = M.norm(wallet), now = Date.now(), want = new Map();
  for (const s of d.subs) { const a = M.alertsFor(s, d.prefs.alertTime, now)[0]; if (a) want.set(SUB + s.id, a.at); }
  const keep = new Set();
  for (const a of await chrome.alarms.getAll()) {
    if (!a.name.startsWith(SUB)) continue;
    if (want.has(a.name) && Math.abs(a.scheduledTime - want.get(a.name)) < 1000) keep.add(a.name);
    else await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) if (!keep.has(name)) await chrome.alarms.create(name, { when });
  if (!(await chrome.alarms.get(PLAN))) chrome.alarms.create(PLAN, { periodInMinutes: 720 });
  return [...want.keys()];
}
/** Only subscriptions and the alert time change which alarms are needed (not passes or expenses). */
function planIfChanged(v) {
  const d = M.norm(v), sig = JSON.stringify([d.subs.map((s) => [s.id, s.state, s.start, s.cycle, s.every, s.alert, s.onDay, s.trial, s.until]), d.prefs.alertTime]);
  if (sig === lastSig) return;
  lastSig = sig;
  plan();
}

async function fire(id, alarm) {
  const { wallet } = await chrome.storage.local.get('wallet');
  const d = M.norm(wallet), s = d.subs.find((x) => x.id === id);
  if (!s) return;
  // the alert this alarm stood for: the latest one that is due (a computer that slept through it still gets it)
  const al = M.alertsFor(s, d.prefs.alertTime, alarm.scheduledTime - 864e5).filter((x) => x.at <= Date.now() + 1000).at(-1);
  if (!al) return;
  const days = M.daysBetween(M.keyOf(), al.date);
  if (days < 0) return; // the bill has already gone by
  const key = `${s.id}:${al.date}:${al.before}`;
  const { walletFired = [] } = await chrome.storage.session.get('walletFired');
  if (walletFired.includes(key)) return;
  await chrome.storage.session.set({ walletFired: [...walletFired.slice(-60), key] });

  const str = await bgStrings(S), loc = await bgLocale();
  let amount, date;
  try { amount = new Intl.NumberFormat(loc, { style: 'currency', currency: s.cur, currencyDisplay: 'narrowSymbol' }).format(s.amount); } catch { amount = `${s.amount} ${s.cur}`; }
  try { date = new Intl.DateTimeFormat(loc, { weekday: 'short', month: 'short', day: 'numeric' }).format(M.dateOf(al.date)); } catch { date = al.date; }
  // in Arabic a Latin amount ("US$ 4.50") stays one left-to-right piece
  if ((await bgLang()) === 'ar') amount = `\u2066${amount}\u2069`;
  const kind = al.trial ? 'trial' : M.SUB_CATS[s.cat]?.bill ? 'due' : 'renews';
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'On';
  await post('wallet:' + key, { app: 'wallet', title: s.name, body: fmt(str[kind + when], { amount, date }), icon: 'wl-receipt', ref: s.id });
}

onAlarm('wallet', (rest, alarm) => {
  if (rest === 'plan') return plan();
  if (rest.startsWith('sub:')) return serial(() => fire(rest.slice(4), alarm)).catch((e) => console.warn('wallet', rest, e)).finally(() => plan());
});
// "wallet:<sub id>:<date>:<days>" → Wallet's bills on that subscription
openTarget('wallet', (rest) => ({ app: 'wallet', section: 'bills:' + rest.split(':')[0] }));
// lets a page (or the dev test) plan now and read back the alarm names
onMessage('wallet-plan', () => plan());

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.wallet) planIfChanged(c.wallet.newValue); });
plan();
