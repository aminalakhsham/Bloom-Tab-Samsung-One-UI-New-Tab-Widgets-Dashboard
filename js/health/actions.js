// Samsung Health's actions for Modes and Routines ("Then"): Log water, Log mood and Mark medications as taken. They
// write through the page's Health helpers (js/health/data.js), so they run in a Bloom Tab page; a routine the service
// worker starts hands them to the next page, like every page-only action. Imported by js/apps/health.js.
import { registerAction, RunError, toNumber, toText } from '../routines/actions.js';
import { addStrings, t } from '../core/i18n.js';
import * as M from './model.js';
import * as H from './data.js';

const P = (key, type, label, o = {}) => ({ key, type, label, ...o });

registerAction({
  id: 'health.water', name: 'health.ra.water', icon: 'drop', color: '#2f9bff', cat: 'apps', out: 'health.ra.waterOut',
  params: [P('ml', 'number', 'health.ra.ml', { def: '250' })],
  sub: (p, F) => `⁦${F.text(p.ml ?? '250')} ${t('health.u.ml')}⁩`,
  run(ctx, p) {
    const ml = toNumber(p.ml ?? 250);
    if (!(ml > 0 && ml <= 5000)) throw new RunError('health.ra.errWater');
    H.logWater(ml);
    // what the routine can use next: today's total in millilitres
    return Math.round(M.waterOn(H.D(), M.dayKey()));
  },
});

// Samsung's five faces, best first, as the Mood card shows them
const MOODS = [...M.MOODS].reverse().map((m) => [m.id, 'health.mood.' + m.id]);
registerAction({
  id: 'health.mood', name: 'health.ra.mood', icon: 'hlMood', color: '#ffb22e', cat: 'apps',
  params: [P('mood', 'enum', 'health.ra.moodP', { opts: MOODS, def: 'good' })],
  sub: (p, F) => F.opt('health.mood', 'mood', p.mood || 'good'),
  run(ctx, p) {
    const id = M.MOOD[p.mood] ? p.mood : 'good';
    H.logMood(id);
    return t('health.mood.' + id);
  },
});

// A name logs that medication's nearest open dose; left empty, it logs the doses that are due now (the Now Bar's
// Taken button). Nothing due is not an error: a morning routine may run after the doses were already logged.
registerAction({
  id: 'health.meds', name: 'health.ra.meds', icon: 'hlPill', color: '#7a6cf5', cat: 'apps', out: 'health.ra.medsOut',
  params: [P('med', 'text', 'health.ra.medP', { ph: 'health.ra.medPh' })],
  sub: (p, F) => F.text(p.med) || t('health.ra.dueNow'),
  run(ctx, p) {
    const q = toText(p.med ?? '').trim(), d = H.D();
    if (q) {
      const m = M.findMeds(d, q)[0];
      if (!m) throw new RunError('health.ra.errMed', { name: q });
      return H.logMed(m.id, 'taken') ? 1 : 0;
    }
    const next = M.nextSlot(d, H.logs(d));
    return next?.due ? H.logSlot(next.slot, 'taken') : 0;
  },
});

addStrings({
  en: {
    'health.ra.water': 'Log water', 'health.ra.ml': 'Amount (ml)', 'health.ra.waterOut': 'Water today (ml)',
    'health.ra.errWater': 'Enter an amount of water between 1 and 5,000 ml.',
    'health.ra.mood': 'Log mood', 'health.ra.moodP': 'Mood',
    'health.ra.meds': 'Mark medications as taken', 'health.ra.medP': 'Medication', 'health.ra.medPh': 'Leave empty for the doses due now',
    'health.ra.dueNow': 'Doses due now', 'health.ra.medsOut': 'Doses logged', 'health.ra.errMed': 'There’s no medication called “{name}” in Samsung Health.',
  },
  ar: {
    'health.ra.water': 'تسجيل الماء', 'health.ra.ml': 'الكمية (مل)', 'health.ra.waterOut': 'ماء اليوم (مل)',
    'health.ra.errWater': 'أدخل كمية ماء بين 1 و5,000 مل.',
    'health.ra.mood': 'تسجيل المزاج', 'health.ra.moodP': 'المزاج',
    'health.ra.meds': 'تسجيل تناول الأدوية', 'health.ra.medP': 'الدواء', 'health.ra.medPh': 'اتركه فارغًا لتسجيل الجرعات المستحقة الآن',
    'health.ra.dueNow': 'الجرعات المستحقة الآن', 'health.ra.medsOut': 'الجرعات المسجلة', 'health.ra.errMed': 'لا يوجد دواء باسم ”{name}“ في Samsung Health.',
  },
});
