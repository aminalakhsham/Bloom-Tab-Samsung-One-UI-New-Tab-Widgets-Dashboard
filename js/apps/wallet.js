// Samsung Wallet (registration only; the window is js/wallet/ui.js, loaded when the app opens): passes of every kind
// Samsung Wallet keeps (boarding passes, tickets, membership cards, coupons, gift cards, digital keys, IDs) with real
// barcodes, subscriptions and bills with alerts from the service worker (js/bg/wallet.js), and spending by category
// with budgets. Here: the app, three Home screen widgets (a Quick access pass, Upcoming bills, Spending), Finder
// commands ("coffee 3.5$", "bills") and search, the Lock screen chip for the next bill and a Now Bar pill for a trip
// or an event that's about to start.
import { h, escapeHtml as esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerCommand, registerLockWidget } from '../core/hooks.js';
import { registerActivity } from '../core/activity.js';
import { addStrings, t } from '../core/i18n.js';
import { toast, choose } from '../core/ui.js';
import * as M from '../wallet/model.js';
import { data, mutate, currency, expenseIn, addExpense, nextBills, monthTotal, widgetPass, onWallet } from '../wallet/data.js';
import { money } from '../wallet/money.js';
import { kindInfo, kindOne, passName, whenText, spendName, spendCat, subIconHTML, hydrateSubIcons, passTimeText, statusText, pct } from '../wallet/format.js';
import { cardHTML, hydrate } from '../wallet/card.js';
import '../wallet/symbols.js';
import '../wallet/actions.js'; // Modes and Routines: Add expense

const open = (params, from) => openApp('wallet', { from, params });

registerApp({
  id: 'wallet',
  name: 'app.wallet',
  icon: {
    bg: 'linear-gradient(145deg, #4d86ff 0%, #1745d6 100%)',
    glyph: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 9.5h11.5a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H4"/><circle cx="15" cy="12" r="1" fill="#fff"/>',
  },
  keywords: ['wallet', 'samsung wallet', 'pass', 'passes', 'boarding pass', 'ticket', 'coupon', 'gift card', 'membership', 'subscriptions', 'bills', 'spending', 'expenses', 'budget',
    'محفظة', 'المحفظة', 'بطاقة', 'بطاقة صعود', 'تذكرة', 'قسيمة', 'اشتراكات', 'فواتير', 'الإنفاق', 'مصروفات', 'ميزانية'],
  render: (ctx) => import('../wallet/ui.js').then((m) => m.render(ctx)),
  search(q) {
    const d = data(), ql = q.toLocaleLowerCase();
    const passes = M.searchPasses(d.passes, q).slice(0, 4).map((p) => ({
      title: passName(p), sub: [kindOne(p.kind), M.passTitle(p)].filter(Boolean).join(' · '), icon: kindInfo(p.kind).icon,
      onOpen: () => open({ pass: p.id }),
    }));
    const subs = d.subs.filter((s) => s.name.toLocaleLowerCase().includes(ql)).slice(0, 3).map((s) => ({
      title: s.name, sub: [money(s.amount, s.cur), statusText(s)].filter(Boolean).join(' · '), icon: 'wl-receipt',
      onOpen: () => open({ section: 'bills:' + s.id }),
    }));
    return [...passes, ...subs];
  },
});

// ———————————————————————————————————————————————————————————— Finder commands
// "coffee 3.5$", "12 € lunch", "spent 30 on taxi", "قهوة ٣٫٥ دولار" → add an expense
registerCommand('wallet-expense', (q, lower, done) => {
  const e = q.length < 80 ? expenseIn(q) : null;
  if (!e) return [];
  const amount = money(e.amount, e.currency);
  return [{
    icon: 'wl-wallet',
    title: e.merchant ? t('wallet.cmd.addNamed', { name: e.merchant, amount }) : t('wallet.cmd.add', { amount }),
    sub: `${spendName(e.category)} · ${t('app.wallet')}`,
    run: () => {
      const x = addExpense(e);
      done?.();
      if (x) toast(t('wallet.cmd.added', { amount }), { action: t('common.undo'), onAction: () => mutate((d) => { d.spend = d.spend.filter((y) => y.id !== x.id); }) });
    },
  }];
});
// "bills", "subscriptions", "فواتير" → the bills due in the next 30 days
const BILLS = /^(bills|my bills|upcoming bills|subscriptions|my subscriptions|الفواتير|فواتير|فواتيري|الاشتراكات|اشتراكاتي)$/i;
registerCommand('wallet-bills', (q, lower, done) => {
  if (!BILLS.test(q.trim())) return [];
  const list = nextBills(30).slice(0, 5);
  const go = (section) => () => { done?.(); open({ section }); };
  if (!list.length) return [{ icon: 'wl-receipt', title: t('wallet.cmd.noBills'), sub: t('app.wallet'), run: go('bills') }];
  return list.map((b) => ({ icon: M.SUB_CATS[b.cat]?.icon || 'wl-receipt', title: b.name, sub: `${money(b.amount, b.currency)} · ${b.trial ? t('wallet.trialEnds') : whenText(b.date)}`, run: go('bills:' + b.id) }));
});

// ———————————————————————————————————————————————————————————— Lock screen: the next bill (no name or amount while locked)
registerLockWidget('wallet-bill', {
  name: 'wallet.lock.bill',
  private: true,
  async render({ locked } = {}) {
    const b = nextBills(7)[0];
    if (!b) return null;
    const when = whenText(b.date);
    return h('span', { class: 'lk-w wl-lk' }, h('span', { html: icon('wl-receipt', 18) }),
      locked ? `${t('wallet.lock.due')} · ${when}` : `${b.name} · ${money(b.amount, b.currency)} · ${when}`);
  },
});

// ———————————————————————————————————————————————————————————— Now Bar: a trip or an event about to start
// From four hours before until half an hour after, like Samsung Wallet's live boarding pass. Polled every second, so the
// answer is kept for ten seconds.
let memo = { at: 0, v: null };
registerActivity('wallet', () => {
  const now = Date.now();
  if (now - memo.at < 10e3) return memo.v;
  let v = null;
  const p = data().passes
    .filter((x) => (x.kind === 'boarding' || x.kind === 'ticket') && x.date?.length > 10 && !M.isExpired(x))
    .map((x) => [x, +M.passDate(x.date)])
    .filter(([, at]) => at - now < 4 * 3600e3 && now - at < 30 * 60e3)
    .sort((a, b) => a[1] - b[1])[0]?.[0];
  if (p) {
    const gate = p.header.find((f) => f.v && /gate|بوابة|البوابة/i.test(f.l)) || p.header.find((f) => f.v);
    v = {
      icon: kindInfo(p.kind).icon, color: kindInfo(p.kind).color, priority: 5, app: 'wallet',
      title: M.passTitle(p) || passName(p),
      sub: [passTimeText(p), gate ? `${gate.l} ${gate.v}` : passName(p)].filter(Boolean).join(' · '),
      actions: p.code.msg ? [{ icon: 'wl-qr', label: t('wallet.showCode'), onClick: () => import('../shell/lock.js').then((m) => m.unlock()).then(() => open({ pass: p.id })) }] : [],
    };
  }
  memo = { at: now, v };
  return v;
});
onWallet(() => { memo.at = 0; });

// ———————————————————————————————————————————————————————————— widgets
const head = (title, ic, color) => h('div', { class: 'wl-wg-head' }, h('span', { class: 'wl-wg-ico', style: { '--c': color }, html: icon(ic, 14) }), h('span', null, title));
const everyMinute = (draw) => { const i = setInterval(draw, 60e3); return () => clearInterval(i); };

registerWidget({
  id: 'wallet-pass',
  name: 'wallet.w.pass',
  sizes: ['s', 'm'],
  defaultSize: 'm',
  app: 'wallet',
  onClick(item, el) {
    const p = widgetPass(item.config?.pass);
    open(p ? { pass: p.id } : { add: true }, el);
  },
  // Widget settings: the card this widget shows, or Automatic (Wallet's own choice, then the next trip or event)
  async configure(config) {
    const live = data().passes.filter((p) => !M.isExpired(p));
    if (!live.length) return { ...config };
    const cur = live.some((p) => p.id === config.pass) ? config.pass : '';
    const v = await choose(t('wallet.w.pickCard'), [{ value: '', label: t('wallet.w.auto'), sub: t('wallet.w.autoSub') }, ...live.map((p) => ({ value: p.id, label: passName(p), sub: kindOne(p.kind) }))], cur);
    if (v == null) return null;
    const next = { ...config, pass: v };
    if (!v) delete next.pass;
    return next;
  },
  render(el, { size, config }) {
    el.classList.add('wg-fill', 'wl-wg-pass');
    const draw = () => {
      const p = widgetPass(config?.pass);
      if (!p) {
        el.innerHTML = `<div class="wl-wg-empty">${icon('wl-wallet', 30)}<span>${esc(t('wallet.w.passEmpty'))}</span></div>`;
        return;
      }
      el.innerHTML = cardHTML(p, { cls: `fill ${size === 's' ? 'tiny' : ''}` });
      hydrate(el);
    };
    draw();
    const offs = [onWallet(draw), everyMinute(draw)];
    return () => offs.forEach((f) => f());
  },
});

registerWidget({
  id: 'wallet-bills',
  name: 'wallet.w.bills',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'wallet',
  onClick(item, el) {
    open({ section: 'bills' }, el);
  },
  render(el, { size }) {
    el.classList.add('wl-wg', 'wl-wg-bills');
    const draw = () => {
      const d = data(), next = nextBills(45), cur = currency();
      const title = head(t('wallet.w.bills'), 'wl-receipt', '#f2556b');
      if (!next.length) {
        el.replaceChildren(title, h('div', { class: 'wl-wg-empty' }, h('span', { html: icon('checkCircle', 26) }), h('span', null, d.subs.length ? t('wallet.w.nothingDue') : t('wallet.w.addBills'))));
        return;
      }
      const subOf = (b) => d.subs.find((s) => s.id === b.id) || b;
      if (size === 's') {
        const b = next[0];
        el.replaceChildren(title, h('div', { class: 'wl-wg-next', html: subIconHTML(subOf(b)) }),
          h('b', { class: 'wl-wg-name' }, b.name),
          h('span', { class: 'wl-wg-big' }, money(b.amount, b.currency, { compact: true })),
          h('span', { class: 'wl-wg-sub' }, b.trial ? t('wallet.trialEnds') : whenText(b.date)));
      } else {
        const tot = M.totals(d.subs).month;
        el.replaceChildren(h('div', { class: 'wl-wg-split' },
          h('div', { class: 'wl-wg-col' }, title, h('span', { class: 'wl-wg-big' }, money(tot[cur] || Object.values(tot)[0] || 0, tot[cur] != null || !Object.keys(tot).length ? cur : Object.keys(tot)[0], { compact: true })), h('span', { class: 'wl-wg-sub' }, t('wallet.perMonth'))),
          h('div', { class: 'wl-wg-list' }, next.slice(0, 3).map((b) => h('div', { class: 'wl-wg-row' }, h('span', { html: subIconHTML(subOf(b)) }),
            h('span', { class: 'wl-wg-rt' }, h('b', null, b.name), h('small', null, b.trial ? t('wallet.trialEnds') : whenText(b.date))),
            h('em', null, money(b.amount, b.currency)))))));
      }
      hydrateSubIcons(el);
    };
    draw();
    const offs = [onWallet(draw), everyMinute(draw)];
    return () => offs.forEach((f) => f());
  },
});

const STACK = ['food', 'transport', 'shopping', 'services', 'travel', 'health', 'entertainment', 'other'];
registerWidget({
  id: 'wallet-spend',
  name: 'wallet.w.spend',
  sizes: ['s', 'm'],
  defaultSize: 's',
  app: 'wallet',
  onClick(item, el) {
    open({ section: 'spend' }, el);
  },
  render(el, { size }) {
    el.classList.add('wl-wg', 'wl-wg-spend');
    const draw = () => {
      const m = monthTotal(), sum = M.sumRange(data().spend, m.from, m.to, m.cur);
      const cats = STACK.filter((k) => sum.cats[k] > 0).sort((a, b) => sum.cats[b] - sum.cats[a]);
      const bar = h('div', { class: 'wl-wg-bar' }, cats.length ? cats.map((k) => h('i', { style: { '--c': spendCat(k).color, flexGrow: sum.cats[k] } })) : h('i', { class: 'none' }));
      const top = [head(t('wallet.thisMonth'), 'wl-chart', '#ff8a3d'), h('span', { class: 'wl-wg-big' }, money(sum.total, m.cur, { compact: true })), bar];
      if (size === 's') {
        el.replaceChildren(...top, h('span', { class: 'wl-wg-sub' }, cats[0] ? `${spendName(cats[0])} · ${pct(sum.cats[cats[0]] / sum.total)}` : t('wallet.w.noSpend')));
        return;
      }
      el.replaceChildren(h('div', { class: 'wl-wg-split' }, h('div', { class: 'wl-wg-col' }, ...top),
        h('div', { class: 'wl-wg-legend' }, cats.length ? cats.slice(0, 4).map((k) => h('span', null, h('i', { style: { '--c': spendCat(k).color } }), h('b', null, spendName(k)), h('em', null, money(sum.cats[k], m.cur, { compact: true }))))
          : h('span', { class: 'wl-wg-sub' }, t('wallet.w.noSpend')))));
    };
    draw();
    const offs = [onWallet(draw), everyMinute(draw)];
    return () => offs.forEach((f) => f());
  },
});

// ———————————————————————————————————————————————————————————— strings used before the window opens
addStrings({
  en: {
    'app.wallet': 'Samsung Wallet',
    'wallet.w.pickCard': 'Card to show', 'wallet.w.auto': 'Automatic', 'wallet.w.autoSub': 'Your next trip or event, else your first Quick access card',
    'wallet.k.boarding': 'Boarding passes', 'wallet.k.ticket': 'Tickets', 'wallet.k.member': 'Membership cards', 'wallet.k.coupon': 'Coupons',
    'wallet.k.gift': 'Gift cards', 'wallet.k.key': 'Digital keys', 'wallet.k.id': 'IDs', 'wallet.k.other': 'Other passes',
    'wallet.k1.boarding': 'Boarding pass', 'wallet.k1.ticket': 'Ticket', 'wallet.k1.member': 'Membership card', 'wallet.k1.coupon': 'Coupon',
    'wallet.k1.gift': 'Gift card', 'wallet.k1.key': 'Digital key', 'wallet.k1.id': 'ID', 'wallet.k1.other': 'Other pass',
    'wallet.sc.food': 'Food and drink', 'wallet.sc.shopping': 'Shopping', 'wallet.sc.entertainment': 'Entertainment', 'wallet.sc.transport': 'Transport',
    'wallet.sc.travel': 'Travel', 'wallet.sc.health': 'Health', 'wallet.sc.services': 'Services', 'wallet.sc.other': 'Other',
    'wallet.paused': 'Paused', 'wallet.cancelled': 'Cancelled', 'wallet.endsOn': 'Ends {date}', 'wallet.trialEndsOn': 'Free trial ends {date}',
    'wallet.dueOn': 'Due {date}', 'wallet.renewsOn': 'Renews {date}', 'wallet.trialEnds': 'Free trial ends', 'wallet.validUntil': 'Valid until {date}',
    'wallet.showCode': 'Show barcode', 'wallet.perMonth': 'Per month', 'wallet.thisMonth': 'This month',
    'wallet.cmd.add': 'Add expense: {amount}', 'wallet.cmd.addNamed': 'Add expense: {name} · {amount}', 'wallet.cmd.added': 'Expense added: {amount}',
    'wallet.cmd.noBills': 'No upcoming bills',
    'wallet.lock.bill': 'Next bill (Samsung Wallet)', 'wallet.lock.due': 'Bill due',
    'wallet.w.pass': 'Quick access card', 'wallet.w.passEmpty': 'Add passes in Samsung Wallet', 'wallet.w.bills': 'Upcoming bills',
    'wallet.w.nothingDue': 'Nothing due in the next few weeks', 'wallet.w.addBills': 'Add subscriptions and bills in Samsung Wallet',
    'wallet.w.spend': 'Spending this month', 'wallet.w.noSpend': 'No spending yet',
  },
  ar: {
    'app.wallet': 'محفظة Samsung',
    'wallet.w.pickCard': 'البطاقة المعروضة', 'wallet.w.auto': 'تلقائي', 'wallet.w.autoSub': 'رحلتك أو حدثك التالي، وإلا فأول بطاقة في الوصول السريع',
    'wallet.k.boarding': 'بطاقات الصعود', 'wallet.k.ticket': 'التذاكر', 'wallet.k.member': 'بطاقات العضوية', 'wallet.k.coupon': 'القسائم',
    'wallet.k.gift': 'بطاقات الهدايا', 'wallet.k.key': 'المفاتيح الرقمية', 'wallet.k.id': 'الهويات', 'wallet.k.other': 'بطاقات أخرى',
    'wallet.k1.boarding': 'بطاقة صعود', 'wallet.k1.ticket': 'تذكرة', 'wallet.k1.member': 'بطاقة عضوية', 'wallet.k1.coupon': 'قسيمة',
    'wallet.k1.gift': 'بطاقة هدية', 'wallet.k1.key': 'مفتاح رقمي', 'wallet.k1.id': 'هوية', 'wallet.k1.other': 'بطاقة أخرى',
    'wallet.sc.food': 'الطعام والمشروبات', 'wallet.sc.shopping': 'التسوق', 'wallet.sc.entertainment': 'الترفيه', 'wallet.sc.transport': 'المواصلات',
    'wallet.sc.travel': 'السفر', 'wallet.sc.health': 'الصحة', 'wallet.sc.services': 'الخدمات', 'wallet.sc.other': 'أخرى',
    'wallet.paused': 'متوقف مؤقتًا', 'wallet.cancelled': 'ملغى', 'wallet.endsOn': 'ينتهي في {date}', 'wallet.trialEndsOn': 'تنتهي الفترة التجريبية في {date}',
    'wallet.dueOn': 'تستحق في {date}', 'wallet.renewsOn': 'يتجدد في {date}', 'wallet.trialEnds': 'تنتهي الفترة التجريبية', 'wallet.validUntil': 'صالحة حتى {date}',
    'wallet.showCode': 'عرض الرمز الشريطي', 'wallet.perMonth': 'شهريًا', 'wallet.thisMonth': 'هذا الشهر',
    'wallet.cmd.add': 'إضافة مصروف: {amount}', 'wallet.cmd.addNamed': 'إضافة مصروف: {name} · {amount}', 'wallet.cmd.added': 'تمت إضافة المصروف: {amount}',
    'wallet.cmd.noBills': 'لا توجد فواتير قادمة',
    'wallet.lock.bill': 'الفاتورة التالية (محفظة Samsung)', 'wallet.lock.due': 'فاتورة مستحقة',
    'wallet.w.pass': 'بطاقة الوصول السريع', 'wallet.w.passEmpty': 'أضف بطاقات في محفظة Samsung', 'wallet.w.bills': 'الفواتير القادمة',
    'wallet.w.nothingDue': 'لا شيء مستحق في الأسابيع القليلة القادمة', 'wallet.w.addBills': 'أضف الاشتراكات والفواتير في محفظة Samsung',
    'wallet.w.spend': 'الإنفاق هذا الشهر', 'wallet.w.noSpend': 'لا يوجد إنفاق بعد',
  },
});
