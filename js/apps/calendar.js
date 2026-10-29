// Calendar — Samsung Calendar (One UI). This module loads with every new tab, so it only registers the app (the UI
// lazy-loads from js/calendar/ui.js), its two Home screen widgets, Finder search, the Routines action "Create event"
// and the exports other surfaces use: upcomingEvents() (Lock screen chip, Now Brief, Daily Board), editEvent()
// (opens the event editor from anywhere) and EVENT_COLORS. Data and repeat rules live in js/calendar/{data,model}.js.
import { h, sameDay } from '../core/util.js';
import { registerApp, openApp } from '../core/apps.js';
import { registerWidget } from '../core/widgets.js';
import { store } from '../core/store.js';
import { addStrings, t, fmtDate, fmtTime } from '../core/i18n.js';
import { registerAction, RunError } from '../routines/actions.js';
import * as M from '../calendar/model.js';
import * as D from '../calendar/data.js';
import { eventTime, eventWhen, weekdayLabels } from '../calendar/format.js';

addStrings({
  en: {
    'app.calendar': 'Calendar',
    'cal.today': 'Today',
    'cal.allDay': 'All day',
    'cal.noEvents': 'No events',
    'cal.noEventsToday': 'No events today',
    'cal.upcoming': 'Upcoming',
    'cal.myEvent': 'My event',
    'cal.newEvent': 'New event',
    'cal.reminder': 'Reminder',
    'cal.calendar': 'Calendar',
    'cal.myCalendar': 'My calendar',
    'cal.birthdays': 'Birthdays',
    'cal.reminders': 'Reminders',
    'cal.bday': "{name}'s birthday",
    'cal.bdayAge': "{name}'s birthday ({n})",
    'cal.actCreate': 'Create event',
    'cal.actText': 'Event',
    'cal.actPh': 'Lunch with Sara Friday 1pm',
    'cal.actOut': 'Event',
    'widget.calendarMonth': 'Calendar',
    'widget.calendarUpcoming': 'Upcoming events',
  },
  ar: {
    'app.calendar': 'التقويم',
    'cal.today': 'اليوم',
    'cal.allDay': 'طوال اليوم',
    'cal.noEvents': 'لا توجد أحداث',
    'cal.noEventsToday': 'لا توجد أحداث اليوم',
    'cal.upcoming': 'القادمة',
    'cal.myEvent': 'حدثي',
    'cal.newEvent': 'حدث جديد',
    'cal.reminder': 'تذكير',
    'cal.calendar': 'التقويم',
    'cal.myCalendar': 'تقويمي',
    'cal.birthdays': 'أعياد الميلاد',
    'cal.reminders': 'التذكيرات',
    'cal.bday': 'عيد ميلاد {name}',
    'cal.bdayAge': 'عيد ميلاد {name} ({n})',
    'cal.actCreate': 'إنشاء حدث',
    'cal.actText': 'الحدث',
    'cal.actPh': 'غداء مع سارة يوم الجمعة الساعة 1 م',
    'cal.actOut': 'الحدث',
    'widget.calendarMonth': 'التقويم',
    'widget.calendarUpcoming': 'الأحداث القادمة',
  },
});

/** Bloom Tab's event colours (Samsung Calendar has a few more in js/calendar/model.js PALETTE). */
export const EVENT_COLORS = M.PALETTE.slice(0, 8);

/** Next events from now (ongoing ones and today's all-day events included; repeating events expanded; birthdays and
 *  subscribed calendars included, hidden calendars and reminders left out). */
export function upcomingEvents(limit = 3) {
  return D.upcoming(limit).map((o) => ({ id: o.master, key: o.key, occ: o.occ, title: o.title || t('cal.myEvent'), start: o.start, end: o.end, allDay: o.allDay, color: o.color, place: o.place || '', cal: o.cal }));
}

/** Opens the event editor (a new event on `day` when `existing` is empty). Resolves with the saved event, or null. */
export function editEvent(existing, day = new Date()) {
  return import('../calendar/editor.js').then((m) => m.editEvent(existing, day));
}

function calendarIcon() {
  const d = new Date();
  const wd = fmtDate(d, { weekday: 'short' }).replace('.', '');
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <defs><linearGradient id="calg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd39b"/><stop offset="1" stop-color="#0fa37f"/></linearGradient></defs>
    <rect width="100" height="100" fill="#fff"/>
    <rect width="100" height="34" fill="url(#calg)"/>
    <text x="50" y="25" text-anchor="middle" font-family="Inter, 'Noto Sans Arabic', sans-serif" font-size="15" font-weight="700" fill="#fff">${wd}</text>
    <text x="50" y="82" text-anchor="middle" font-family="Outfit, Inter, sans-serif" font-size="44" font-weight="500" fill="#1d1e22">${d.getDate()}</text>
  </svg>`;
}

registerApp({
  id: 'calendar',
  name: 'app.calendar',
  icon: { bg: '#fff', html: calendarIcon },
  keywords: ['events', 'schedule', 'agenda', 'ics', 'تقويم', 'أحداث', 'مواعيد', 'جدول'],
  size: 'wide',
  render: (ctx) => import('../calendar/ui.js').then((m) => m.render(ctx)),
  search(q) {
    return D.search(q, 5).map((o) => ({
      title: o.title || t('cal.myEvent'),
      sub: eventWhen(o),
      icon: 'calendar',
      onOpen: () => openApp('calendar', { params: { id: o.master, occ: o.occ } }),
    }));
  },
});

// ——— Routines: "Create event" from text ("Lunch with Sara Friday 1pm") ———
registerAction({
  id: 'calendar.event', name: 'cal.actCreate', icon: 'calendar', color: '#0fa37f', cat: 'apps', out: 'cal.actOut',
  params: [{ key: 'text', type: 'text', label: 'cal.actText', input: true, ph: 'cal.actPh' }],
  sub: (p, F) => F.text(p.text),
  async run(ctx, p) {
    const text = String(p.text ?? '').trim();
    if (!text) throw new RunError('routines.err.empty');
    const { eventFromText } = await import('../calendar/smart.js');
    const e = eventFromText(text, new Date());
    const ev = D.addEvent({ title: e.title || text, start: e.start, end: e.end, allDay: e.allDay, repeat: e.repeat || undefined, place: e.place, people: e.people });
    return ev.title;
  },
});

// ——— widgets ———
function miniMonth(el, { big = false } = {}) {
  const today = new Date();
  const first = D.firstDay();
  const start = M.startOfWeek(new Date(today.getFullYear(), today.getMonth(), 1), first);
  const days = Array.from({ length: 42 }, (_, i) => M.addDays(start, i));
  const rows = days[35].getMonth() !== today.getMonth() ? 5 : 6;
  const marks = D.eventDays(days[0], M.addDays(days[rows * 7 - 1], 1));
  return h('div', { class: ['wg-cal-grid', big && 'big'] },
    weekdayLabels('narrow', first).map(({ wd, label }) => h('span', { class: ['wg-cal-wd', wd === 0 && 'sun'] }, label)),
    days.slice(0, rows * 7).map((d) =>
      h('span', {
        class: ['wg-cal-day', d.getMonth() !== today.getMonth() && 'out', sameDay(d, today) && 'today', d.getDay() === 0 && 'sun', marks.has(M.dkey(d)) && 'has'],
        onClick: (e) => {
          e.stopPropagation();
          openApp('calendar', { from: el, params: { date: d.getTime() } });
        },
      }, String(d.getDate()))));
}

function upcomingList(el, limit) {
  const list = upcomingEvents(limit);
  if (!list.length) return h('div', { class: 'wg-cal-empty' }, t('cal.noEventsToday'));
  const now = Date.now();
  return h('div', { class: 'wg-cal-list' },
    list.map((ev) =>
      h('div', {
        class: 'wg-cal-ev',
        style: `--c:${ev.color || EVENT_COLORS[0]}`,
        onClick: (e) => {
          e.stopPropagation();
          openApp('calendar', { from: el, params: { date: ev.start } });
        },
      },
        h('span', { class: 'wg-cal-bar' }),
        h('span', { class: 'wg-cal-ev-text' },
          h('span', { class: 'wg-cal-ev-title' }, ev.title),
          h('span', { class: 'wg-cal-ev-time' }, sameDay(ev.start, now) || ev.start < now
            ? eventTime(ev, new Date())
            : `${fmtDate(new Date(ev.start), { weekday: 'short', day: 'numeric' })} · ${ev.allDay ? t('cal.allDay') : fmtTime(new Date(ev.start))}`)))));
}

function live(el, draw) {
  draw();
  let day = new Date().getDate();
  const offs = ['events', 'calPrefs', 'calendars', 'calSubs', D.SUB_KEY, 'contacts'].map((k) => store.on(k, draw));
  const timer = setInterval(() => {
    if (new Date().getDate() !== day) {
      day = new Date().getDate();
      draw();
    }
  }, 60e3);
  return () => {
    offs.forEach((f) => f());
    clearInterval(timer);
  };
}

registerWidget({
  id: 'calendar-month',
  name: 'widget.calendarMonth',
  sizes: ['s', 'l'],
  defaultSize: 's',
  app: 'calendar',
  render(el, { size }) {
    el.classList.add('wg-cal', 'wg-cal-month');
    return live(el, () => {
      const today = new Date();
      el.replaceChildren(...[
        h('div', { class: 'wg-cal-head' },
          h('span', { class: 'wg-cal-mname' }, fmtDate(today, size === 'l' ? { month: 'long', year: 'numeric' } : { month: 'long' }))),
        miniMonth(el, { big: size === 'l' }),
        size === 'l' ? h('div', { class: 'wg-cal-sep' }, t('cal.upcoming')) : null,
        size === 'l' ? upcomingList(el, 3) : null].filter(Boolean));
    });
  },
});

registerWidget({
  id: 'calendar-upcoming',
  name: 'widget.calendarUpcoming',
  sizes: ['m'],
  defaultSize: 'm',
  app: 'calendar',
  render(el) {
    el.classList.add('wg-cal', 'wg-cal-upcoming');
    return live(el, () => {
      const today = new Date();
      el.replaceChildren(
        h('div', { class: 'wg-cal-date' },
          h('span', { class: 'wg-cal-wdname' }, fmtDate(today, { weekday: 'long' })),
          h('span', { class: 'wg-cal-big' }, String(today.getDate())),
          h('span', { class: 'wg-cal-mon' }, fmtDate(today, { month: 'long' }))),
        upcomingList(el, 3));
    });
  },
});
