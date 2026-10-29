// Samsung Wallet's action for Modes and Routines ("Then"): Add expense, the same entry as Spending's quick entry and
// Finder's "coffee 3.5$". It writes through the page's Wallet helpers, so it runs in a Bloom Tab page. Imported by
// js/apps/wallet.js.
import { registerAction, RunError, toNumber, toText } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import { SPEND_CATS, SPEND_IDS } from './model.js';
import { addExpense, currency } from './data.js';
import { money } from './money.js';

const P = (key, type, label, o = {}) => ({ key, type, label, ...o });
const CATS = [['auto', 'wallet.ra.catAuto'], ...SPEND_IDS.map((id) => [id, SPEND_CATS[id].name])];

registerAction({
  id: 'wallet.expense', name: 'wallet.ra.expense', icon: 'wl-wallet', color: '#3e7bff', cat: 'apps', out: 'wallet.ra.out',
  params: [
    P('amount', 'number', 'wallet.ra.amount', { ph: 'wallet.ra.amountPh' }),
    P('merchant', 'text', 'wallet.ra.merchant', { ph: 'wallet.ra.merchantPh' }),
    P('cat', 'enum', 'wallet.ra.cat', { opts: CATS, def: 'auto' }),
  ],
  sub: (p, F) => [F.text(p.amount) && `⁦${F.text(p.amount)}⁩`, F.text(p.merchant), p.cat && p.cat !== 'auto' ? F.opt('wallet.expense', 'cat', p.cat) : ''].filter(Boolean).join(' · '),
  run(ctx, p) {
    const amount = Math.round(toNumber(p.amount) * 100) / 100;
    if (!(amount > 0)) throw new RunError('wallet.ra.errAmount');
    const merchant = toText(p.merchant ?? '').trim().slice(0, 80);
    // "Automatic" picks the category from the merchant, as Spending's quick entry does
    const e = addExpense({ amount, merchant, category: SPEND_IDS.includes(p.cat) ? p.cat : undefined, currency: currency() });
    if (!e) throw new RunError('wallet.ra.errAmount');
    return money(e.amt, e.cur);
  },
});

addStrings({
  en: {
    'wallet.ra.expense': 'Add expense', 'wallet.ra.out': 'Expense', 'wallet.ra.amount': 'Amount', 'wallet.ra.amountPh': '3.50',
    'wallet.ra.merchant': 'Merchant', 'wallet.ra.merchantPh': 'Where you spent it', 'wallet.ra.cat': 'Category', 'wallet.ra.catAuto': 'Automatic',
    'wallet.ra.errAmount': 'The expense needs an amount greater than 0.',
  },
  ar: {
    'wallet.ra.expense': 'إضافة مصروف', 'wallet.ra.out': 'المصروف', 'wallet.ra.amount': 'المبلغ', 'wallet.ra.amountPh': '3.50',
    'wallet.ra.merchant': 'التاجر', 'wallet.ra.merchantPh': 'أين أنفقته', 'wallet.ra.cat': 'الفئة', 'wallet.ra.catAuto': 'تلقائي',
    'wallet.ra.errAmount': 'يحتاج المصروف إلى مبلغ أكبر من 0.',
  },
});
