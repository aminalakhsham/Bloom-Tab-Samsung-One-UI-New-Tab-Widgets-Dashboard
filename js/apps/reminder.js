// Reminder (Samsung Reminder): registration only — the app, its widgets, Finder search, the Now Bar (a reminder that
// just came due), a Lock screen chip and the Routines action. The app's screens are js/reminder/ui.js (loaded when it
// opens); data and alarms js/reminder/data.js, the pure model js/reminder/model.js, the natural-language parser
// js/reminder/parse.js, the service worker side js/bg/reminder.js.
// Other modules import parseQuickTime, addReminder and fmtDue from here (Finder, Quick capture, Routines, the side
// panel, Health and Journal): keep those exports.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { registerLockWidget } from '../core/hooks.js';
import { registerActivity } from '../core/activity.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtTime } from '../core/i18n.js';
import { toast, choose } from '../core/ui.js';
import * as M from '../reminder/model.js';
import * as D from '../reminder/data.js';
import { fmtDue, catName } from '../reminder/format.js';
import { checkbox } from '../reminder/kit.js';

export { parseQuickTime } from '../reminder/parse.js';
export { fmtDue };
/** Adds a reminder ({ title, notes, due, priority, cat, repeat, early, url, … }) with its alarms; returns it. */
export const addReminder = (fields) => D.addReminder(fields);

addStrings({
  en: {
    'app.reminder': 'Reminder',
    'rem.today': 'Today',
    'rem.scheduled': 'Scheduled',
    'rem.all': 'All',
    'rem.completed': 'Completed',
    'rem.write': 'Write a reminder',
    'rem.important': 'Important',
    'rem.empty': 'No reminders',
    'rem.emptyToday': 'Nothing due today',
    'rem.summary': '{n} due today',
    'rem.summaryNone': 'All caught up',
    'rem.pending': '{n} pending',
    'rem.added': 'Reminder added',
    'rem.completedToast': 'Completed',
    'rem.doneNext': 'Completed. Next: {when}',
    'widget.reminder': 'Reminder',
    'widget.reminderCat': 'Reminder category',
    'rem.wg.show': 'Show reminders from',
    'rem.now.due': 'Reminder',
    'rem.now.done': 'Complete',
    'rem.lw': 'Reminders due today',
    'rem.lw.due': '{n} due today',
  },
  ar: {
    'app.reminder': 'التذكير',
    'rem.today': 'اليوم',
    'rem.scheduled': 'مجدولة',
    'rem.all': 'الكل',
    'rem.completed': 'مكتملة',
    'rem.write': 'اكتب تذكيرًا',
    'rem.important': 'مهم',
    'rem.empty': 'لا توجد تذكيرات',
    'rem.emptyToday': 'لا شيء مستحق اليوم',
    'rem.summary': '{n} مستحقة اليوم',
    'rem.summaryNone': 'لا يوجد شيء متأخر',
    'rem.pending': '{n} قيد الانتظار',
    'rem.added': 'تمت إضافة التذكير',
    'rem.completedToast': 'اكتمل',
    'rem.doneNext': 'اكتمل. التالي: {when}',
    'widget.reminder': 'التذكير',
    'widget.reminderCat': 'فئة التذكيرات',
    'rem.wg.show': 'عرض التذكيرات من',
    'rem.now.due': 'تذكير',
    'rem.now.done': 'إكمال',
    'rem.lw': 'التذكيرات المستحقة اليوم',
    'rem.lw.due': '{n} مستحقة اليوم',
  },
});

registerApp({
  id: 'reminder',
  name: 'app.reminder',
  icon: {
    bg: 'linear-gradient(145deg, #4fd1e8 0%, #2b7cf0 100%)',
    glyph: '<circle cx="12" cy="12" r="8.2"/><path d="m8.3 12.2 2.6 2.6 5-5.2" stroke-width="2.2"/>',
  },
  keywords: ['todo', 'task', 'reminders', 'مهام', 'تذكير', 'تذكيرات'],
  size: 'phone',
  render: (ctx) => import('../reminder/ui.js').then((m) => m.render(ctx)),
  search(q) {
    q = q.toLocaleLowerCase();
    const cs = D.cats();
    return D.list()
      .filter((r) => !r.done && [r.title, r.notes, ...(r.subs || []).map((s) => s.title)].some((x) => String(x || '').toLocaleLowerCase().includes(q)))
      .sort(M.bySmart)
      .slice(0, 5)
      .map((r) => ({
        title: r.title || t('common.untitled'),
        sub: r.due ? fmtDue(r.due) : catName(M.catOf(cs, r)),
        icon: 'checkCircle',
        onOpen: () => openApp('reminder', { params: { id: r.id } }),
      }));
  },
});

// ——— widgets ———
/** The open reminders a widget shows for its view (All by default), widget order (Important first, then by date). */
function widgetItems(view = 'all') {
  const cs = D.cats(), now = Date.now();
  return D.list().filter((r) => !r.done && (view === 'all' || M.inView(cs, view, r, now))).sort(M.bySmart);
}
function widgetRow(r) {
  const overdue = M.isOverdue(r);
  const el = h('div', { class: ['rem-item', 'compact', r.done && 'done'], dataset: { id: r.id } },
    checkbox(r, () => {
      el.classList.toggle('done');
      el.querySelector('.rem-check').classList.toggle('done');
      setTimeout(() => {
        const undo = D.setDone(r.id, !r.done);
        const now = D.find(r.id);
        toast(r.repeat && now && !now.done ? t('rem.doneNext', { when: fmtDue(now.due) }) : t('rem.completedToast'), { action: t('common.undo'), onAction: undo });
      }, 200);
    }),
    h('div', { class: 'rem-item-text' },
      h('div', { class: 'rem-item-title' }, r.title || t('common.untitled')),
      r.due ? h('div', { class: ['rem-item-due', overdue && 'overdue'] }, fmtDue(r.due)) : null),
    r.priority ? h('span', { class: 'rem-star', html: icon('starFill', 16) }) : null);
  return el;
}
const viewTitle = (view) => (!view || view === 'all' ? t('widget.reminder') : M.VIEWS.includes(view) ? t('rem.' + view) : catName(D.cats().list.find((c) => c.id === view)));
function renderWidget(el, { size, config }) {
  el.classList.add('wg-reminder');
  const limit = { s: 3, m: 3, l: 8 }[size] || 3;
  const draw = () => {
    let view = config?.view || 'all';
    if (!M.VIEWS.includes(view) && !D.cats().list.some((c) => c.id === view)) view = 'all'; // its category was deleted
    const items = widgetItems(view);
    const todayCount = items.filter((r) => M.isToday(r)).length;
    const c = !M.VIEWS.includes(view) && D.cats().list.find((x) => x.id === view);
    el.style.setProperty('--wc', c?.color || '');
    el.replaceChildren(
      h('div', { class: 'wg-rem-head' },
        h('span', { class: 'wg-rem-ico', html: icon(c?.icon || 'checkCircle', 16) }),
        h('span', { class: 'wg-rem-title' }, viewTitle(view)),
        h('span', { class: 'wg-rem-count' }, String(size === 's' || view !== 'all' ? items.length : todayCount || items.length)),
        h('button', {
          class: 'wg-rem-add',
          title: t('rem.write'),
          'aria-label': t('rem.write'),
          html: icon('plus', 18),
          onClick: (e) => {
            e.stopPropagation();
            openApp('reminder', { from: el, params: view === 'all' ? { new: true } : { view } });
          },
        })),
      items.length
        ? h('div', { class: 'wg-rem-list' }, items.slice(0, limit).map(widgetRow))
        : h('div', { class: 'wg-rem-empty' }, h('span', { html: icon('checkCircle', 30) }), t(view === 'today' ? 'rem.emptyToday' : 'rem.empty')));
  };
  draw();
  const offs = [store.on(M.KEY, draw), store.on(M.CAT_KEY, draw)];
  const tick = setInterval(draw, 60e3);
  return () => {
    offs.forEach((f) => f());
    clearInterval(tick);
  };
}
registerWidget({ id: 'reminder', name: 'widget.reminder', sizes: ['s', 'm', 'l'], defaultSize: 'm', app: 'reminder', render: renderWidget });
// The same list for one view or category (One UI's "Reminder list" widget settings)
registerWidget({
  id: 'reminder-cat',
  name: 'widget.reminderCat',
  sizes: ['m', 'l'],
  defaultSize: 'm',
  app: 'reminder',
  onClick: (item, el) => openApp('reminder', { from: el, params: { view: item.config?.view || 'today' } }),
  configure: async (config) => {
    const cs = D.cats();
    const v = await choose(t('rem.wg.show'), [...['today', 'scheduled', 'all'].map((x) => ({ value: x, label: t('rem.' + x) })), ...cs.list.map((c) => ({ value: c.id, label: catName(c) }))], config.view || 'today');
    return v == null ? null : { ...config, view: v };
  },
  render: (el, o) => renderWidget(el, { ...o, config: { view: 'today', ...(o.config || {}) } }),
});

// ——— Now Bar: a reminder that just came due (no title on a Lock screen that hides notification content) ———
// (lock.js is loaded on first use, not here: the side panel and Quick capture import this module too)
let lockMod = null, lockLoad = null;
registerActivity('reminder', () => {
  const now = Date.now();
  const r = D.list().filter((x) => !x.done && x.due && x.due <= now && now - x.due < 30 * 60e3).sort((a, b) => b.due - a.due)[0];
  if (!r) return null;
  lockLoad ||= import('../shell/lock.js').then((m) => (lockMod = m), () => null);
  const hide = !lockMod || (lockMod.isLocked?.() && lockMod.hideContent?.());
  return {
    icon: 'checkCircle', color: '#2b7cf0', title: hide ? t('rem.now.due') : r.title || t('rem.now.due'), sub: fmtTime(new Date(r.due)), app: 'reminder', params: { id: r.id }, priority: 3,
    actions: [{ icon: 'check', label: t('rem.now.done'), onClick: () => D.setDone(r.id, true) }],
  };
});

// ——— Lock screen chip: how many are due today (never their titles) ———
registerLockWidget('reminder', {
  name: 'rem.lw',
  private: true,
  render: async () => {
    const n = M.count(D.cats(), D.list(), 'today');
    if (!n) return null;
    return h('span', { class: 'lk-w' }, h('span', { html: icon('checkCircle', 18) }), t('rem.lw.due', { n }));
  },
});

// ——— Modes and Routines › Add reminder (with the app's natural time, category and Important) ———
// (routines run in the new tab pages and the service worker, not in the side panel or Quick capture)
if (globalThis.document?.getElementById('home')) import('../reminder/action.js').then((m) => m.registerReminderAction(D.addReminder), (e) => console.error('reminder action', e));
