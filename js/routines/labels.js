// Words for Modes and Routines screens: what a condition or an action says in a list ("Time period · 22:00 – 07:00 ·
// Every day", "Dark mode · On"), names of modes, routines, apps, sounds and wallpapers, and the little If → Then icon
// strip of a routine card.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, tr, addStrings, fmtTime, weekdayNames, lang } from '../core/i18n.js';
import { getApp } from '../core/apps.js';
import { soundName } from '../shell/sounds.js';
import { ACTIONS } from './actions.js';
import { pointOn } from './model.js';
import { rdata, modeName, routineName } from '../apps/routines.js';

export { modeName, routineName };

/** "22:00" / "10:00 PM", "Sunrise", "Sunset". */
export function specText(sp) {
  if (sp === 'sunrise') return t('routines.c.sunrise');
  if (sp === 'sunset') return t('routines.c.sunset');
  const d = new Date();
  return fmtTime(new Date(pointOn(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), sp)));
}
export function daysText(days) {
  const d = [...(days || [])].sort();
  if (d.length === 7 || !d.length) return t('routines.c.everyDay');
  const key = d.join('');
  if (key === '12345') return t('routines.c.weekdays');
  if (key === '06') return t('routines.c.weekends');
  const names = weekdayNames('short');
  return d.map((i) => names[i]).join(lang() === 'ar' ? '، ' : ', ');
}

export const COND_ICON = { manual: 'hand', time: 'clock', newtab: 'rtNewTab', startup: 'power', unlock: 'unlock', idle: 'rtIdle', mode: 'rtModes', site: 'globe' };
export const condIcon = (c) => (c.type === 'time' && (c.start === 'sunset' || c.start === 'sunrise') ? (c.start === 'sunset' ? 'rtSunset' : 'rtSunrise') : COND_ICON[c.type] || 'info');
export function condTitle(c) {
  if (c.type === 'time') {
    const sun = c.start === 'sunrise' || c.start === 'sunset' || c.end === 'sunrise' || c.end === 'sunset';
    return t(c.end ? (sun ? 'routines.c.sunPeriod' : 'routines.c.period') : sun ? 'routines.c.sunAt' : 'routines.c.at');
  }
  return t('routines.c.' + c.type);
}
export function condSub(c) {
  if (c.type === 'time') return [c.end ? `${specText(c.start)} – ${specText(c.end)}` : specText(c.start), daysText(c.days)].join(' · ');
  if (c.type === 'idle') return t('routines.c.idleSub', { n: c.away });
  if (c.type === 'mode') return c.mode ? t('routines.c.modeSub', { name: modeName(rdata().modes.find((m) => m.id === c.mode)) || c.mode }) : t('routines.c.anyMode');
  if (c.type === 'site') return c.hosts.join(', ') || t('routines.c.noSites');
  if (c.type === 'manual') return t('routines.c.manualSub');
  if (c.type === 'newtab') return t('routines.c.newtabSub');
  if (c.type === 'startup') return t('routines.c.startupSub');
  if (c.type === 'unlock') return t('routines.c.unlockSub');
  return '';
}

/** A parameter value as text: variables show as their names in ⟨⟩. */
export function valueText(v, acts = []) {
  if (v == null) return '';
  if (!Array.isArray(v)) return typeof v === 'object' ? `⟨${varName(v, acts)}⟩` : String(v);
  return v.map((x) => (x && typeof x === 'object' ? `⟨${varName(x, acts)}⟩` : String(x))).join('');
}
/** The name of a variable part: an earlier action's result, a Repeat item, a named variable or a special one. */
export function varName(part, acts = []) {
  if (part.s) return t('routines.var.' + part.s);
  if (part.n != null) return part.n;
  if (part.prev) return t('routines.v.prev');
  const src = acts.find((x) => x.id === part.v);
  if (!src) return t('routines.var.removed');
  if (part.k === 'item') return t('routines.var.item');
  if (part.k === 'index') return t('routines.var.index');
  return t(ACTIONS[src.type]?.out || 'routines.var.result');
}
const wallName = (id) => (id ? t('wall.' + id) : '');
/** Helpers an action's sub() uses to describe its parameters. */
export const F = (acts = []) => ({
  t,
  opt: (type, key, v) => { const o = ACTIONS[type]?.params.find((p) => p.key === key)?.opts?.find((x) => x[0] === v); return o ? t(o[1]) : String(v ?? ''); },
  text: (v) => valueText(v, acts),
  mode: (id) => modeName(rdata().modes.find((m) => m.id === id)) || '',
  routine: (id) => routineName(rdata().list.find((r) => r.id === id)) || t('routines.var.removed'),
  app: (id) => (getApp(id) ? tr(getApp(id).name) : id || ''),
  sound: (id) => (id ? soundName(id) : ''),
  wall: wallName,
});
export function actionTitle(a) {
  const d = ACTIONS[a.type];
  if (!d) return t('routines.unknownAction');
  if (a.g && a.m === 2) return t(d.end || 'routines.a.endIf');
  if (a.g && a.m === 1) return a.type === 'menu' ? t('routines.menuItem', { n: (a.p.item ?? 0) + 1 }) : t(d.mid || 'routines.a.otherwise');
  return t(d.name);
}
export function actionSub(a, acts) {
  const d = ACTIONS[a.type];
  if (!d || (a.g && a.m)) return '';
  try { return d.sub ? String(d.sub(a.p || {}, F(acts)) || '') : ''; } catch { return ''; }
}
export const actionIcon = (a) => ACTIONS[a.type]?.icon || 'info';
export const actionColor = (a) => ACTIONS[a.type]?.color || '#8a8d96';

/** The If → Then strip of icons on a routine card. */
export function chain(r, max = 4) {
  const ifs = (r.conds.length ? r.conds : [{ type: 'manual' }]).slice(0, 3).map((c) => h('span', { class: 'rt-chip-ico if', html: icon(condIcon(c), 14) }));
  const acts = r.actions.filter((a) => !a.g || a.m === 0);
  const thens = acts.slice(0, max).map((a) => h('span', { class: 'rt-chip-ico then', style: { '--c': actionColor(a) }, html: icon(actionIcon(a), 14) }));
  if (acts.length > max) thens.push(h('span', { class: 'rt-chip-more' }, '+' + (acts.length - max)));
  return h('span', { class: 'rt-chain' }, ...ifs, h('span', { class: 'rt-chain-arrow', html: icon('arrowRight', 14) }), ...thens);
}

addStrings({
  en: {
    'routines.c.manual': 'Start manually',
    'routines.c.manualSub': 'Tap Start, use a widget or Finder',
    'routines.c.time': 'Time period',
    'routines.c.period': 'Time period',
    'routines.c.at': 'Specific time',
    'routines.c.sunPeriod': 'Sunrise and sunset',
    'routines.c.sunAt': 'Sunrise or sunset',
    'routines.c.sunrise': 'Sunrise',
    'routines.c.sunset': 'Sunset',
    'routines.c.newtab': 'New tab opened',
    'routines.c.newtabSub': 'When you open a new tab',
    'routines.c.startup': 'Chrome starts',
    'routines.c.startupSub': 'When you open Chrome',
    'routines.c.unlock': 'Screen unlocked',
    'routines.c.unlockSub': 'When you unlock the Lock screen',
    'routines.c.idle': 'Back at your computer',
    'routines.c.idleSub': 'After being away for {n} min',
    'routines.c.mode': 'Mode',
    'routines.c.modeSub': 'While {name} is on',
    'routines.c.anyMode': 'While any mode is on',
    'routines.c.site': 'Website opened',
    'routines.c.noSites': 'No websites yet',
    'routines.c.everyDay': 'Every day',
    'routines.c.weekdays': 'Weekdays',
    'routines.c.weekends': 'Weekends',
    'routines.var.input': 'Routine input',
    'routines.var.date': 'Current date',
    'routines.var.ask': 'Ask each time',
    'routines.var.item': 'Repeat item',
    'routines.var.index': 'Repeat index',
    'routines.var.result': 'Result',
    'routines.var.removed': 'Removed',
    'routines.unknownAction': 'Unknown action',
    'routines.menuItem': 'Item {n}',
  },
  ar: {
    'routines.c.manual': 'البدء يدويًا',
    'routines.c.manualSub': 'اضغط بدء أو استخدم أداة أو الباحث',
    'routines.c.time': 'الفترة الزمنية',
    'routines.c.period': 'الفترة الزمنية',
    'routines.c.at': 'وقت محدد',
    'routines.c.sunPeriod': 'الشروق والغروب',
    'routines.c.sunAt': 'الشروق أو الغروب',
    'routines.c.sunrise': 'الشروق',
    'routines.c.sunset': 'الغروب',
    'routines.c.newtab': 'فتح علامة تبويب جديدة',
    'routines.c.newtabSub': 'عند فتح علامة تبويب جديدة',
    'routines.c.startup': 'بدء تشغيل Chrome',
    'routines.c.startupSub': 'عند فتح Chrome',
    'routines.c.unlock': 'إلغاء قفل الشاشة',
    'routines.c.unlockSub': 'عند إلغاء قفل شاشة القفل',
    'routines.c.idle': 'العودة إلى الكمبيوتر',
    'routines.c.idleSub': 'بعد الابتعاد لمدة {n} دقيقة',
    'routines.c.mode': 'الوضع',
    'routines.c.modeSub': 'أثناء تشغيل {name}',
    'routines.c.anyMode': 'أثناء تشغيل أي وضع',
    'routines.c.site': 'فتح موقع ويب',
    'routines.c.noSites': 'لا توجد مواقع بعد',
    'routines.c.everyDay': 'كل يوم',
    'routines.c.weekdays': 'أيام العمل',
    'routines.c.weekends': 'عطلات نهاية الأسبوع',
    'routines.var.input': 'إدخال الإجراء الروتيني',
    'routines.var.date': 'التاريخ الحالي',
    'routines.var.ask': 'السؤال في كل مرة',
    'routines.var.item': 'عنصر التكرار',
    'routines.var.index': 'رقم التكرار',
    'routines.var.result': 'النتيجة',
    'routines.var.removed': 'محذوف',
    'routines.unknownAction': 'إجراء غير معروف',
    'routines.menuItem': 'العنصر {n}',
  },
});
