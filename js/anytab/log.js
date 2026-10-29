// Quick capture's Log mode: water, mood and medicine doses go to Samsung Health (js/health/data.js), expenses to Samsung
// Wallet (js/wallet/data.js). The words are matched here; nothing is shown that the typed text didn't name (no totals, no
// lists of medications), so the sheet can open over any website.
//   const L = await loadLog();   L.understand(text) → intent | null   L.describe(intent) → { icon, color, title, sub, ok }
//   L.save(intent) → { text } | null
//   intent: { kind: 'water', ml } | { kind: 'mood', mood } | { kind: 'mood-pick' } | { kind: 'med', id, name }
//         | { kind: 'med-unknown', name } | { kind: 'expense', e: { amount, currency, merchant, category, at } }
import { t } from '../core/i18n.js';
import { addIcons } from '../core/icons.js';

addIcons({
  'at-mood': '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.2a4.1 4.1 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  // the five faces of Health's mood scale
  'at-m-great': '<circle cx="12" cy="12" r="8.5"/><path d="M7.8 13.2a4.4 4.4 0 0 0 8.4 0Z" fill="currentColor"/><path d="M8.4 9.8q.9-1.2 1.8 0M13.8 9.8q.9-1.2 1.8 0"/>',
  'at-m-good': '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.2a4.1 4.1 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  'at-m-okay': '<circle cx="12" cy="12" r="8.5"/><path d="M9 14.8h6"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  'at-m-bad': '<circle cx="12" cy="12" r="8.5"/><path d="M8.8 15.6a4 4 0 0 1 6.4 0"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>',
  'at-m-awful': '<circle cx="12" cy="12" r="8.5"/><path d="M8.4 16.2a4.4 4.4 0 0 1 7.2 0"/><path d="m8.2 8.8 2.2 1.2M15.8 8.8l-2.2 1.2"/>',
  'at-pill': '<rect x="3.6" y="8.6" width="16.8" height="6.8" rx="3.4" transform="rotate(-40 12 12)"/><path d="m9.4 9.1 5.2 6"/>',
  'at-card': '<rect x="3" y="5.5" width="18" height="13" rx="2.8"/><path d="M3 10h18M7 15h4"/>',
});

const latin = (s) => String(s || '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0).replace(/٫/g, '.');

// Health's mood scale (the five faces) with the words people type for each, English and Arabic.
export const MOOD_WORDS = {
  great: ['great', 'amazing', 'excellent', 'awesome', 'fantastic', 'wonderful', 'رائع', 'رائعة', 'ممتاز', 'ممتازة', 'مبسوط جدا'],
  good: ['good', 'fine', 'happy', 'well', 'nice', 'جيد', 'جيدة', 'بخير', 'سعيد', 'سعيدة', 'مبسوط', 'كويس', 'منيح'],
  okay: ['okay', 'ok', 'meh', 'neutral', 'so-so', 'alright', 'عادي', 'عادية', 'مقبول', 'ماشي'],
  bad: ['bad', 'sad', 'down', 'stressed', 'tired', 'سيء', 'سيئ', 'سيئة', 'حزين', 'حزينة', 'متعب', 'متعبة', 'متضايق'],
  awful: ['awful', 'terrible', 'horrible', 'miserable', 'فظيع', 'سيء جدا', 'مريع', 'تعيس'],
};
export const MOOD_IDS = ['great', 'good', 'okay', 'bad', 'awful'];
const MOOD_COLORS = { great: '#ffb22e', good: '#7cc957', okay: '#3cbfd6', bad: '#5f8ff2', awful: '#8f6bea' };
const MOOD_RE = /^(?:my\s+mood\s+is|mood|feeling|i\s+feel|i'?m\s+feeling|i\s+am\s+feeling|i'?m|i\s+am|مزاجي|المزاج|مزاج|أشعر\s+ب?|اشعر\s+ب?|أنا|انا|حاسس|حاسة)\s*(?:is\s+|:\s*)?(.*)$/i;
const MED_RE = /^(?:i\s+)?(?:took|take|taken)\s+(?:my\s+|the\s+)?(.+)$|^(?:أخذت|اخذت|تناولت|خذيت)\s+(?:ال)?(.+)$/i;
const WATER_WORD = /(^|[^\p{L}])(water|drink|drank|drinking|h2o|ماء|مياه|الماء|المياه|موية|مويه|شربت|اشرب|أشرب)(?![\p{L}])/iu;
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(ml|mls|milliliters?|millilitres?|l|liters?|litres?|fl\.?\s?oz|oz|ounces?|cups?|glass(?:es)?|bottles?|مل|ملل|ملي|لتر|لترات|أونصة|اونصة|كوب|أكواب|اكواب|كاس|كأس|كاسات|كؤوس|زجاجة|زجاجات|قنينة)?(?![\p{L}])/iu;

export async function loadLog() {
  const get = (p) => import(p).catch((e) => (console.warn('capture log', p, e), null));
  const [H, HM, F, healthApp, W, money, WF, walletApp] = await Promise.all([
    get('../health/data.js'), get('../health/model.js'), get('../health/format.js'), get('../apps/health.js'),
    get('../wallet/data.js'), get('../wallet/money.js'), get('../wallet/format.js'), get('../apps/wallet.js'),
  ]);
  const health = !!(H && HM && F && healthApp), wallet = !!(W && money && WF && walletApp);

  const units = () => H.units();
  const cup = () => HM.cupOf(H.D(), units());
  const waterText = (ml) => F.waterText(ml, units());
  const moodName = (id) => F.moodName(id);

  /** Millilitres in "water 500ml", "2 glasses of water", "شربت كوبين ماء", or null. */
  function water(s) {
    if (!WATER_WORD.test(s)) return null;
    const floz = units().water === 'floz';
    const m = s.match(AMOUNT);
    let ml;
    if (m) {
      const n = parseFloat(m[1].replace(',', '.')), u = (m[2] || '').toLowerCase().replace(/\s+/g, '');
      if (/^(ml|mls|milli|مل|ملل|ملي)/.test(u)) ml = n;
      else if (/^(l|liter|litre|لتر)/.test(u)) ml = n * 1000;
      else if (/oz|ounce|أونصة|اونصة/.test(u)) ml = n * HM.ML_FLOZ;
      else if (/^(cup|glass|كوب|أكواب|اكواب|كاس|كأس|كؤوس)/.test(u)) ml = n * cup();
      else if (/^(bottle|زجاج|قنينة)/.test(u)) ml = n * 500;
      else ml = n <= 10 ? n * cup() : floz ? n * HM.ML_FLOZ : n;
    } else if (/لترين/.test(s)) ml = 2000;
    else if (/(كوبين|كأسين|كاسين)/.test(s)) ml = 2 * cup();
    else if (/(زجاجة|قنينة|bottle)/i.test(s)) ml = 500;
    else ml = cup();
    ml = Math.round(ml * 10) / 10;
    return ml > 0 && ml <= 5000 ? ml : null;
  }

  function mood(s) {
    const m = s.match(MOOD_RE);
    if (!m) return null;
    const word = m[1].trim().replace(/[.!]+$/, '').toLowerCase();
    if (!word) return /^(mood|feeling|مزاج|مزاجي|المزاج)$/i.test(s.trim()) ? { kind: 'mood-pick' } : null;
    const id = Object.keys(MOOD_WORDS).find((k) => MOOD_WORDS[k].includes(word) || MOOD_WORDS[k].some((w) => word === 'very ' + w || word === 'so ' + w))
      || MOOD_IDS.find((k) => moodName(k).toLowerCase() === word);
    return id ? { kind: 'mood', mood: id } : null;
  }

  function med(s) {
    const m = s.match(MED_RE);
    const name = (m?.[1] || m?.[2] || '').trim().replace(/[.!]+$/, '');
    if (!name || /^(water|ماء)$/i.test(name)) return null;
    const found = HM.findMeds(H.D(), name)[0];
    return found ? { kind: 'med', id: found.id, name: F.medName(found) } : { kind: 'med-unknown', name };
  }

  function understand(text) {
    const s = latin(text).replace(/\s+/g, ' ').trim();
    if (!s) return null;
    // a medication the person has wins; "took 2 glasses of water" or "took a taxi 12 €" are water and an expense
    const dose = health ? med(s) : null;
    if (dose?.kind === 'med') return dose;
    if (wallet) {
      const e = W.expenseIn(text);
      if (e) return { kind: 'expense', e };
    }
    if (!health) return null;
    const ml = water(s);
    if (ml) return { kind: 'water', ml };
    return dose || mood(s);
  }

  function describe(x) {
    switch (x?.kind) {
      case 'water': return { icon: 'drop', color: '#3e9bff', title: t('anytab.log.water', { amount: waterText(x.ml) }), sub: t('anytab.log.health'), ok: true };
      case 'mood': return { icon: 'at-m-' + x.mood, color: MOOD_COLORS[x.mood], title: t('anytab.log.mood', { mood: moodName(x.mood) }), sub: t('anytab.log.health'), ok: true };
      case 'mood-pick': return { icon: 'at-mood', color: '#3cbfd6', title: t('anytab.log.moodPick'), sub: t('anytab.log.health'), ok: false, pick: true };
      case 'med': return { icon: 'at-pill', color: '#ff7a59', title: t('anytab.log.med', { name: x.name }), sub: t('anytab.log.health'), ok: true };
      case 'med-unknown': return { icon: 'at-pill', color: '#8a8d96', title: t('anytab.log.medUnknown', { name: x.name }), sub: t('anytab.log.medAdd'), ok: false };
      case 'expense': {
        const c = WF.spendCat(x.e.category), amount = money.money(x.e.amount, x.e.currency);
        return {
          icon: 'at-card', color: c.color,
          title: x.e.merchant ? t('anytab.log.expenseAt', { name: x.e.merchant, amount }) : t('anytab.log.expense', { amount }),
          sub: `${t('anytab.log.wallet')} · ${WF.spendName(x.e.category)}`, ok: true,
        };
      }
    }
    return null;
  }

  function save(x) {
    switch (x?.kind) {
      case 'water': return H.logWater(x.ml) ? { text: t('anytab.done.water', { amount: waterText(x.ml) }) } : null;
      case 'mood': return H.logMood(x.mood) ? { text: t('anytab.done.mood', { mood: moodName(x.mood) }) } : null;
      case 'med': return H.logMed(x.id, 'taken') ? { text: t('anytab.done.med', { name: x.name }) } : null;
      case 'expense': return W.addExpense(x.e) ? { text: t('anytab.done.expense') } : null;
    }
    return null;
  }

  return { health, wallet, understand, describe, save, moodName, MOOD_COLORS };
}
