// Samsung Health (One UI): the app's registration and everything that lives outside its window — Home screen widgets
// (Daily activity, Water, Medications), the Now Bar (a medication that is due, no names), Finder commands ("water",
// "drink 500ml", "took <med>", "meds", "mood great", "rings") and search, a Quick Panel tile that logs a glass of
// water, and Lock screen widgets (rings; the next dose without medicine names). The app itself loads from
// js/health/ui.js when it opens. Health data never goes anywhere else: no sync, no network.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerActivity } from '../core/activity.js';
import { registerCommand, registerTile, registerLockWidget } from '../core/hooks.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtDate } from '../core/i18n.js';
import { toast, choose } from '../core/ui.js';
import * as M from '../health/model.js';
import * as R from '../health/rings.js';
import * as H from '../health/data.js';
import * as F from '../health/format.js';
import { ringsSVG, pillSVG } from '../health/art.js';
import '../health/actions.js'; // Modes and Routines: Log water, Log mood, Mark medications as taken

const open = (section, from) => openApp('health', { from, params: section ? { section } : {} });

registerApp({
  id: 'health',
  name: 'health.app',
  icon: {
    bg: 'linear-gradient(150deg, #34d39a 0%, #11a37a 100%)',
    glyph: '<circle cx="14.6" cy="4.6" r="1.9"/><path d="M8.2 10.2 11.6 8l3.4.6 1.8 3.1 2.8.8"/><path d="M13.2 8.4 11.4 14l3.2 2.6.8 4.6"/><path d="M11.4 14l-2 3.6-3.8.9"/>',
  },
  keywords: ['health', 'samsung health', 'fitness', 'activity', 'rings', 'water', 'medication', 'pills', 'sleep', 'mood', 'weight', 'period', 'cycle', 'breathe',
    'صحة', 'الصحة', 'نشاط', 'ماء', 'دواء', 'أدوية', 'نوم', 'مزاج', 'وزن', 'الدورة', 'تنفس'],
  size: 'phone',
  render: (ctx) => import('../health/ui.js').then((m) => m.render(ctx)),
  search(q) {
    const lower = q.trim().toLowerCase();
    if (lower.length < 2) return [];
    const out = [];
    const d = H.D();
    for (const m of M.findMeds(d, lower).slice(0, 3)) out.push({ title: F.medName(m), sub: t('health.cards.meds'), icon: 'hlPill', onOpen: () => open('med:' + m.id) });
    for (const id of ['activity', 'meds', 'water', 'sleep', 'mood', 'body', 'cycle', 'breathe']) {
      const name = t('health.cards.' + id);
      if (name.toLowerCase().includes(lower) || id.includes(lower)) out.push({ title: name, sub: t('health.app'), onOpen: () => open(id) });
    }
    return out;
  },
});

// ——— Finder commands ———
const MOOD_WORDS = {
  great: ['great', 'amazing', 'excellent', 'awesome', 'fantastic', 'رائع', 'ممتاز', 'رائعة'],
  good: ['good', 'fine', 'happy', 'well', 'جيد', 'بخير', 'سعيد', 'جيدة'],
  okay: ['okay', 'ok', 'meh', 'neutral', 'so-so', 'عادي', 'مقبول', 'عادية'],
  bad: ['bad', 'sad', 'down', 'سيء', 'سيئ', 'حزين', 'سيئة'],
  awful: ['awful', 'terrible', 'horrible', 'فظيع', 'سيء جدا', 'مريع'],
};
const latin = (s) => s.replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/٫/g, '.');
/** "500ml", "0.5 l", "2 glasses", "16 oz" → millilitres (a bare small number counts glasses). */
function parseWater(n, unit, cup) {
  const v = parseFloat(latin(n).replace(',', '.'));
  if (!(v > 0)) return 0;
  const u = (unit || '').toLowerCase().replace(/\s+/g, '');
  if (/^(l|liters?|litres?|لتر)$/.test(u)) return v * 1000;
  if (/^(oz|floz|ounces?|أونصة)$/.test(u)) return v * M.ML_FLOZ;
  if (/^(glass(es)?|cups?|كوب|أكواب|اكواب|كأس)$/.test(u) || (!u && v <= 10)) return v * cup;
  return v;
}
registerCommand('health', (q, lower, done) => {
  const out = [];
  const s = latin(lower.trim());
  const u = H.units(), d = H.D(), cup = M.cupOf(d, u);
  const today = () => F.waterText(M.waterOn(H.D(), M.dayKey()), u);
  const water = (ml) => ({
    icon: 'drop', title: t('health.cmd.water', { amount: F.waterText(ml, u) }), sub: t('health.cmd.waterToday', { amount: today() }),
    run: () => { H.logWater(ml); toast(t('health.toast.water', { amount: F.waterText(ml, u), total: today() })); done?.(); },
  });
  if (/^(water|ماء|مياه|الماء)$/.test(s)) out.push(water(cup));
  const wm = s.match(/^(?:drink|drank|water|اشرب|شربت|ماء)\s+(\d+(?:[.,]\d+)?)\s*([a-z؀-ۿ ]*)$/);
  if (wm) { const ml = parseWater(wm[1], wm[2].trim(), cup); if (ml > 0 && ml <= 5000) out.push(water(ml)); }
  const tm = q.trim().match(/^(?:took|take|taken|أخذت|اخذت|تناولت)\s+(.+)$/i);
  if (tm) {
    for (const m of M.findMeds(d, tm[1]).slice(0, 3)) {
      out.push({
        icon: 'hlPill', title: t('health.cmd.took', { name: F.medName(m) }), sub: t('health.cards.meds'),
        run: () => { H.logMed(m.id, 'taken'); toast(t('health.toast.taken', { name: F.medName(m) })); done?.(); },
      });
    }
  }
  if (/^(meds|medications?|medicines?|pills|أدوية|ادوية|الأدوية|الادوية)$/.test(s)) {
    const th = H.todayHealth();
    const sub = th.next ? t(th.next.due ? 'health.lw.due' : 'health.lw.next', { time: F.timeOf(th.next.t) }) : th.medsDue.length ? t('health.meds.progress', { n: th.medsTaken, total: th.medsDue.length }) : t('health.cards.meds');
    out.push({ icon: 'hlPill', title: t('health.cmd.meds'), sub, run: () => { done?.(); open('meds'); } });
  }
  const mm = s.match(/^(?:mood|feeling|i feel|مزاج|مزاجي|المزاج|أشعر|اشعر)\s+(.+)$/);
  if (mm) {
    const word = mm[1].trim();
    const id = Object.keys(MOOD_WORDS).find((k) => MOOD_WORDS[k].includes(word)) || M.MOODS.map((x) => x.id).find((k) => F.moodName(k).toLowerCase() === word);
    if (id) out.push({ icon: 'hlMood', title: t('health.cmd.mood', { mood: F.moodName(id) }), sub: t('health.cards.mood'), run: () => { H.logMood(id); toast(t('health.toast.mood', { mood: F.moodName(id) })); done?.(); } });
  }
  if (/^(rings|activity|daily activity|حلقات|الحلقات|النشاط|النشاط اليومي)$/.test(s)) {
    const r = H.todayRings();
    out.push({ icon: 'hlRings', title: t('health.cards.activity'), sub: R.RINGS.map((k) => `${F.ringName(k)} ${F.ringValue(k, r[k])}`).join(' · '), run: () => { done?.(); open('activity'); } });
  }
  return out;
});

// ——— Quick Panel: a glass of water ———
registerTile({
  id: 'health-water',
  icon: 'drop',
  order: 60,
  label: () => t('health.tile.water'),
  on: () => { const th = H.todayHealth(); return th.water.ml >= th.water.goalMl; },
  toggle: () => {
    const th = H.todayHealth(), u = H.units();
    H.logWater(th.water.cup);
    toast(t('health.toast.water', { amount: F.waterText(th.water.cup, u), total: F.waterText(th.water.ml + th.water.cup, u) }));
  },
});

// ——— Now Bar: a medication that is due (no names: the Now Bar shows on the Lock screen) ———
let dueCache = { key: '', val: null };
registerActivity('health-dose', () => {
  const now = Date.now(), key = Math.floor(now / 30000) + '|' + JSON.stringify([store.get(M.KEY)?.medLog?.length, store.get(M.KEY)?.meds?.length, store.get(M.SW_KEY)?.log?.length]);
  if (dueCache.key !== key) {
    const d = H.D(), next = M.nextSlot(d, H.logs(d), now);
    dueCache = { key, val: next?.due ? next : null };
  }
  const x = dueCache.val;
  if (!x) return null;
  return {
    icon: 'hlPill', color: '#7a6cf5', title: t('health.now.due'), sub: F.timeOf(x.t), app: 'health', priority: 4,
    actions: [{ icon: 'check', label: t('health.taken'), onClick: () => { H.logSlot(x.slot, 'taken'); dueCache.key = ''; } }],
  };
});

// ——— Lock screen widgets ———
registerLockWidget('health-rings', {
  name: 'health.lw.rings',
  render: async () => {
    const r = H.todayRings();
    return h('span', { class: 'lk-w hl-lkw' },
      h('span', { class: 'hl-lkw-rings', html: ringsSVG(r, { width: 13, gap: 3 }) }),
      ...R.RINGS.map((k) => h('b', { style: { color: R.COLORS[k].c } }, F.num(Math.floor(r[k].v + 1e-6)))));
  },
});
registerLockWidget('health-dose', {
  name: 'health.lw.dose',
  private: true,
  render: async ({ locked } = {}) => {
    const d = H.D(), next = M.nextSlot(d, H.logs(d));
    if (!next) return null;
    const label = t(next.due ? 'health.lw.due' : 'health.lw.next', { time: F.timeOf(next.t) });
    // names only when nothing is locked (the Lock screen normally renders this while locked)
    const names = locked === false ? ' · ' + next.doses.map((x) => F.medName(x.med)).join(', ') : '';
    return h('span', { class: 'lk-w' }, h('span', { html: icon('hlPill', 18) }), label + names);
  },
});

// ——— Home screen widgets ———
function ringsWidget(el, { size }) {
  el.classList.add('wg-health-rings', 'size-' + size);
  const draw = () => {
    const r = H.todayRings();
    const rows = size === 's' ? null : h('div', { class: 'hw-rows' }, R.RINGS.map((k) => h('div', { class: 'hw-row' },
      h('span', { class: 'hw-dot', style: { background: R.COLORS[k].c } }),
      h('span', { class: 'hw-name' }, F.ringName(k)),
      h('b', { style: { color: R.COLORS[k].c } }, F.ringValue(k, r[k])))));
    el.replaceChildren(
      h('div', { class: 'wg-head' }, h('span', { html: icon('hlRings', 15) }), t('health.cards.activity')),
      h('div', { class: 'hw-body' }, h('span', { class: 'hw-rings', html: ringsSVG(r, { width: 12, gap: 3, label: t('health.cards.activity') }) }), rows));
  };
  draw();
  const off = H.watch(H.RING_KEYS, draw), tick = setInterval(draw, 60e3);
  return () => { off(); clearInterval(tick); };
}
function waterWidget(el) {
  el.classList.add('wg-health-water');
  const draw = () => {
    const th = H.todayHealth(), u = H.units(), p = Math.min(1, th.water.ml / th.water.goalMl);
    el.replaceChildren(
      h('div', { class: 'wg-head' }, h('span', { html: icon('drop', 15) }), t('health.cards.water')),
      h('div', { class: 'hw-water' }, h('span', { class: 'wg-big' }, F.waterNum(th.water.ml, u)), h('small', null, F.unitName(u.water))),
      h('div', { class: 'wg-sub' }, t('health.water.ofGoal', { goal: F.waterText(th.water.goalMl, u) })),
      h('div', { class: 'hw-bar' }, h('i', { style: { width: (p * 100).toFixed(1) + '%' } })),
      h('button', {
        class: 'hw-plus', title: t('health.water.add'), 'aria-label': t('health.water.add'), html: icon('plus', 20),
        onClick: (e) => { e.stopPropagation(); H.logWater(th.water.cup); },
      }));
  };
  draw();
  const off = H.watch([M.KEY], draw), tick = setInterval(draw, 60e3);
  return () => { off(); clearInterval(tick); };
}
function medsWidget(el, { size }) {
  el.classList.add('wg-health-meds', 'size-' + size);
  const draw = () => {
    const d = H.D(), lg = H.logs(d), next = M.nextSlot(d, lg);
    const head = h('div', { class: 'wg-head' }, h('span', { html: icon('hlPill', 15) }), t('health.cards.meds'));
    if (!M.activeMeds(d).length) return el.replaceChildren(head, h('div', { class: 'hw-empty' }, t('health.meds.widgetEmpty')));
    if (!next) {
      const doses = M.dayDoses(d, lg, M.dayKey()), missed = doses.filter((x) => !x.entry && M.slotTime(x.slot) < Date.now()).length;
      if (missed) return el.replaceChildren(head, h('div', { class: 'hw-done missed' }, h('span', { html: icon('info', 26) }), F.tn('health.meds.notLogged', missed)));
      return el.replaceChildren(head, h('div', { class: 'hw-done' }, h('span', { html: icon('checkCircle', 26) }), doses.length ? t('health.meds.allDone') : t('health.meds.nothingToday')));
    }
    el.replaceChildren(head,
      h('div', { class: ['hw-time', next.due && 'due'] }, F.timeOf(next.t)),
      h('div', { class: 'wg-sub' }, next.due ? t('health.now.due') : F.tn('health.meds.count', next.doses.length)),
      size === 's' ? null : h('div', { class: 'hw-meds' }, next.doses.slice(0, 3).map((x) => h('div', { class: 'hw-med' },
        h('span', { class: 'hw-pill', html: pillSVG(x.med) }), h('span', { class: 'hw-mname' }, F.medName(x.med)), h('small', null, F.doseText(x.med, x.n))))),
      h('button', {
        class: 'hw-take', 'aria-label': t('health.takeAll'), title: t('health.takeAll'),
        onClick: (e) => { e.stopPropagation(); H.logSlot(next.slot, 'taken'); toast(t('health.toast.slotTaken', { time: F.timeOf(next.t) })); },
      }, h('span', { html: icon('check', 18) }), size === 's' ? null : t('health.take')));
  };
  draw();
  const off = H.watch(H.DATA_KEYS, draw), tick = setInterval(draw, 60e3);
  return () => { off(); clearInterval(tick); };
}
registerWidget({ id: 'health-rings', name: 'health.w.rings', sizes: ['s', 'm'], defaultSize: 'm', app: 'health', onClick: (item, el) => open('activity', el), render: ringsWidget });
registerWidget({ id: 'health-water', name: 'health.w.water', sizes: ['s'], defaultSize: 's', app: 'health', onClick: (item, el) => open('water', el), render: waterWidget });
registerWidget({ id: 'health-meds', name: 'health.w.meds', sizes: ['s', 'm'], defaultSize: 's', app: 'health', onClick: (item, el) => open('meds', el), render: medsWidget });

// Samsung Health's "Tracker" widget: one tracker the user picks in the widget's settings (water, sleep, mood or weight).
const TRACKERS = { water: { card: 'water', icon: 'drop' }, sleep: { card: 'sleep', icon: 'hlBed' }, mood: { card: 'mood', icon: 'hlMood' }, weight: { card: 'body', icon: 'hlScale' } };
const trackerOf = (config) => (TRACKERS[config?.metric] ? config.metric : 'water');
function trackerWidget(el, { config }) {
  const id = trackerOf(config);
  if (id === 'water') return waterWidget(el);
  el.classList.add('wg-health-tracker', 'hw-tr-' + id);
  const draw = () => {
    const d = H.D(), u = H.units(d), th = H.todayHealth();
    const head = h('div', { class: 'wg-head' }, h('span', { html: icon(TRACKERS[id].icon, 15) }), t('health.w.tr.' + id));
    let big = '', sub = '', dot = null;
    if (id === 'sleep') {
      big = th.sleep ? F.durText(th.sleep) : '—';
      sub = th.sleep ? t('health.w.lastNight') : t('health.w.noSleep');
    } else if (id === 'mood') {
      const m = th.mood && M.moodOf(th.mood.valence);
      big = m ? F.moodName(m.id) : '—';
      sub = m ? t('health.w.moodToday') : t('health.w.howFeel');
      if (m) dot = h('span', { class: 'hw-tr-dot', style: { background: m.color } });
    } else {
      const w = M.latestBody(d, 'weight');
      big = w ? F.weightText(w.value, u) : '—';
      sub = w ? fmtDay(w.at) : t('health.w.noWeight');
    }
    el.replaceChildren(head, h('div', { class: 'hw-tr-big' }, dot, h('span', { class: 'wg-big' }, big)), h('div', { class: 'wg-sub' }, sub));
  };
  draw();
  const off = H.watch([M.KEY], draw), tick = setInterval(draw, 60e3);
  return () => { off(); clearInterval(tick); };
}
const fmtDay = (at) => (M.dayKey(at) === M.dayKey() ? t('common.today') : fmtDate(new Date(at), { month: 'short', day: 'numeric' }));
registerWidget({
  id: 'health-tracker', name: 'health.w.tracker', sizes: ['s'], defaultSize: 's', app: 'health',
  onClick: (item, el) => open(TRACKERS[trackerOf(item.config)].card, el),
  configure: async (config) => {
    const v = await choose(t('health.w.pickTracker'), Object.keys(TRACKERS).map((id) => ({ value: id, label: t('health.w.tr.' + id) })), trackerOf(config));
    return v == null ? null : { ...config, metric: v };
  },
  render: trackerWidget,
});

// Strings used outside the app window (and by the formatting helpers the app shares); the app's own are in
// js/health/strings.js.
addStrings({
  en: {
    'health.app': 'Samsung Health',
    'health.cards.activity': 'Daily activity', 'health.cards.meds': 'Medications', 'health.cards.water': 'Water', 'health.cards.sleep': 'Sleep',
    'health.cards.mood': 'Mood', 'health.cards.body': 'Body composition', 'health.cards.cycle': 'Cycle tracking', 'health.cards.breathe': 'Breathe',
    'health.ring.focus': 'Focus', 'health.ring.done': 'Tasks', 'health.ring.breaks': 'Breaks',
    'health.ringv.focus': '{v}/{g} min', 'health.ringv.done': '{v}/{g}', 'health.ringv.breaks': '{v}/{g} hr',
    'health.u.kg': 'kg', 'health.u.lb': 'lb', 'health.u.cm': 'cm', 'health.u.in': 'in', 'health.u.ml': 'ml', 'health.u.floz': 'fl oz',
    'health.amount': '{n} {u}', 'health.percent': '{n}%', 'health.feetInches': '{ft} ft {in} in',
    'health.dur.m': '{m} min', 'health.dur.h': '{h} h', 'health.dur.hm': '{h} h {m} m',
    'health.mood.great': 'Great', 'health.mood.good': 'Good', 'health.mood.okay': 'Okay', 'health.mood.bad': 'Bad', 'health.mood.awful': 'Awful',
    'health.dose1.tablet': '1 tablet', 'health.dose1.capsule': '1 capsule', 'health.dose1.drop': '1 drop', 'health.dose1.puff': '1 puff', 'health.dose1.dose': '1 dose',
    'health.doseN.tablet': '{n} tablets', 'health.doseN.capsule': '{n} capsules', 'health.doseN.drop': '{n} drops', 'health.doseN.puff': '{n} puffs', 'health.doseN.dose': '{n} doses',
    'health.takenAt': 'Taken at {time}', 'health.skippedAt': 'Skipped at {time}',
    'health.taken': 'Taken', 'health.take': 'Take', 'health.takeAll': 'Take all',
    'health.now.due': 'Time for your medication',
    'health.meds.count': '{n} medications', 'health.meds.count.one': '1 medication', 'health.meds.allDone': 'All taken for today', 'health.meds.notLogged': '{n} doses not logged today', 'health.meds.notLogged.one': '1 dose not logged today', 'health.meds.nothingToday': 'Nothing scheduled today',
    'health.meds.widgetEmpty': 'Add medications in Samsung Health to see your next dose here.', 'health.meds.progress': '{n} of {total} taken today',
    'health.water.ofGoal': 'of {goal}', 'health.water.add': 'Add a glass',
    'health.cmd.water': 'Log {amount} of water', 'health.cmd.waterToday': 'Today: {amount}', 'health.cmd.took': 'Log {name} as taken',
    'health.cmd.meds': 'Open Medications', 'health.cmd.mood': 'Log mood: {mood}',
    'health.toast.water': '{amount} added · {total} today', 'health.toast.taken': '{name} logged as taken', 'health.toast.mood': 'Mood saved: {mood}',
    'health.toast.slotTaken': '{time} medications logged as taken',
    'health.tile.water': 'Log water',
    'health.lw.rings': 'Daily activity', 'health.lw.dose': 'Next medication', 'health.lw.next': 'Next dose {time}', 'health.lw.due': 'Medication due {time}',
    'health.w.rings': 'Daily activity', 'health.w.water': 'Water', 'health.w.meds': 'Medications',
    'health.w.tracker': 'Tracker', 'health.w.pickTracker': 'Tracker to show', 'health.w.tr.water': 'Water', 'health.w.tr.sleep': 'Sleep',
    'health.w.tr.mood': 'Mood', 'health.w.tr.weight': 'Weight', 'health.w.lastNight': 'Last night', 'health.w.noSleep': 'No sleep logged',
    'health.w.moodToday': 'Today', 'health.w.howFeel': 'How are you feeling?', 'health.w.noWeight': 'No weight logged',
  },
  ar: {
    'health.app': 'Samsung Health',
    'health.cards.activity': 'النشاط اليومي', 'health.cards.meds': 'الأدوية', 'health.cards.water': 'الماء', 'health.cards.sleep': 'النوم',
    'health.cards.mood': 'المزاج', 'health.cards.body': 'تكوين الجسم', 'health.cards.cycle': 'تتبع الدورة', 'health.cards.breathe': 'التنفس',
    'health.ring.focus': 'التركيز', 'health.ring.done': 'المهام', 'health.ring.breaks': 'الاستراحات',
    'health.ringv.focus': '{v}/{g} د', 'health.ringv.done': '{v}/{g}', 'health.ringv.breaks': '{v}/{g} س',
    'health.u.kg': 'كغ', 'health.u.lb': 'رطل', 'health.u.cm': 'سم', 'health.u.in': 'بوصة', 'health.u.ml': 'مل', 'health.u.floz': 'أونصة سائلة',
    'health.amount': '{n} {u}', 'health.percent': '{n}%', 'health.feetInches': '{ft} قدم {in} بوصة',
    'health.dur.m': '{m} د', 'health.dur.h': '{h} س', 'health.dur.hm': '{h} س {m} د',
    'health.mood.great': 'رائع', 'health.mood.good': 'جيد', 'health.mood.okay': 'عادي', 'health.mood.bad': 'سيئ', 'health.mood.awful': 'فظيع',
    'health.dose1.tablet': 'قرص واحد', 'health.dose1.capsule': 'كبسولة واحدة', 'health.dose1.drop': 'قطرة واحدة', 'health.dose1.puff': 'بخة واحدة', 'health.dose1.dose': 'جرعة واحدة',
    'health.doseN.tablet': '{n} أقراص', 'health.doseN.capsule': '{n} كبسولات', 'health.doseN.drop': '{n} قطرات', 'health.doseN.puff': '{n} بخات', 'health.doseN.dose': '{n} جرعات',
    'health.takenAt': 'تم تناوله الساعة {time}', 'health.skippedAt': 'تم تخطيه الساعة {time}',
    'health.taken': 'تم تناوله', 'health.take': 'تناول', 'health.takeAll': 'تناول الكل',
    'health.now.due': 'حان وقت دوائك',
    'health.meds.count': '{n} أدوية', 'health.meds.count.one': 'دواء واحد', 'health.meds.allDone': 'تم تناول كل أدوية اليوم', 'health.meds.notLogged': '{n} جرعات لم تُسجَّل اليوم', 'health.meds.notLogged.one': 'جرعة واحدة لم تُسجَّل اليوم', 'health.meds.nothingToday': 'لا شيء مجدول اليوم',
    'health.meds.widgetEmpty': 'أضف أدويتك في Samsung Health لترى جرعتك التالية هنا.', 'health.meds.progress': 'تم تناول {n} من {total} اليوم',
    'health.water.ofGoal': 'من {goal}', 'health.water.add': 'إضافة كوب',
    'health.cmd.water': 'تسجيل {amount} من الماء', 'health.cmd.waterToday': 'اليوم: {amount}', 'health.cmd.took': 'تسجيل تناول {name}',
    'health.cmd.meds': 'فتح الأدوية', 'health.cmd.mood': 'تسجيل المزاج: {mood}',
    'health.toast.water': 'تمت إضافة {amount} · {total} اليوم', 'health.toast.taken': 'تم تسجيل تناول {name}', 'health.toast.mood': 'تم حفظ المزاج: {mood}',
    'health.toast.slotTaken': 'تم تسجيل تناول أدوية الساعة {time}',
    'health.tile.water': 'تسجيل الماء',
    'health.lw.rings': 'النشاط اليومي', 'health.lw.dose': 'الدواء التالي', 'health.lw.next': 'الجرعة التالية {time}', 'health.lw.due': 'حان موعد الدواء {time}',
    'health.w.rings': 'النشاط اليومي', 'health.w.water': 'الماء', 'health.w.meds': 'الأدوية',
    'health.w.tracker': 'المتتبع', 'health.w.pickTracker': 'المتتبع المعروض', 'health.w.tr.water': 'الماء', 'health.w.tr.sleep': 'النوم',
    'health.w.tr.mood': 'المزاج', 'health.w.tr.weight': 'الوزن', 'health.w.lastNight': 'الليلة الماضية', 'health.w.noSleep': 'لم يُسجَّل نوم',
    'health.w.moodToday': 'اليوم', 'health.w.howFeel': 'كيف تشعر؟', 'health.w.noWeight': 'لم يُسجَّل وزن',
  },
});
