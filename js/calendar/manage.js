// Calendar's pages behind the navigation drawer: Manage calendars (create, rename, recolour, export and delete your
// calendars; subscribe to a calendar by its .ics address — Google, Outlook, iCloud — refresh or unsubscribe; the
// Birthdays and Reminders calendars) and Calendar settings (first day of week, week numbers, alternate calendar,
// default reminders, default calendar), plus .ics import. A subscription is a fetch the user chose: Chrome asks for
// access to that one site (optional host permission through ensure()), and the service worker refreshes it
// (js/bg/calendar.js).
import { h, uid, pickFile, download } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t, fmtRelative, locale } from '../core/i18n.js';
import { row, switchRow, list, subheader, toast, menu, prompt, confirm, choose, dialog, swatches } from '../core/ui.js';
import { ensure } from '../core/perm.js';
import * as M from './model.js';
import * as D from './data.js';
import './strings.js';
import { alertText, altName, ALT_CALS, weekdayName } from './format.js';
import { parseICS, writeICS, subUrl, subEvents } from './ics.js';

const dot = (c) => `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="${c}"/></svg>`;
const MAX_ICS = 15e6;

function pickColor(title, cur) {
  let close = null;
  const sw = swatches(M.PALETTE, cur, (c) => close?.(c));
  sw.classList.add('cal-colors');
  const content = h('div', { class: 'cal-colorpick' }, sw);
  const p = dialog({ title, content, className: 'cal-dialog', actions: [{ label: t('common.cancel'), value: null }] });
  close = (v) => content.closest('.ou-dialog')?._close(v);
  return p;
}
const freeColor = () => {
  const used = new Set([...D.localCals(), ...D.subs()].map((c) => c.color));
  return M.PALETTE.find((c) => !used.has(c)) || M.PALETTE[(D.localCals().length + D.subs().length) % M.PALETTE.length];
};

// ---------------------------------------------------------------- Manage calendars
export function openManage(ctx) {
  ctx.push({
    title: t('cal.manage'),
    className: 'cal-sub-page',
    render(body) {
      const draw = () => {
        const cals = D.localCals(), ss = D.subs(), p = D.prefs(), evs = D.stored();
        const count = (id) => evs.filter((e) => (e.cal || D.defaultCalId()) === id).length;
        body.replaceChildren(
          subheader(t('cal.myCalendars')),
          list(
            ...cals.map((c) => row({ icon: dot(c.color), title: D.calName(c), sub: t('cal.nEvents', { n: count(c.id) }), className: 'cal-mg-cal cal-dotrow', onClick: (e) => calMenu(e, c) })),
            row({ icon: 'plus', title: t('cal.createCal'), className: 'cal-mg-create', onClick: () => createCal() })),
          subheader(t('cal.subscribed')),
          list(
            ...ss.map((s) => row({ icon: dot(s.color || '#00a3d9'), title: s.name || hostOf(s.url), className: 'cal-mg-sub cal-dotrow', sub: s.error ? t('cal.subError', { e: s.error }) : `${hostOf(s.url)} · ${s.last ? t('cal.updated', { when: fmtRelative(s.last) }) : ''}`, onClick: (e) => subMenu(e, s) })),
            row({ icon: 'link', title: t('cal.subscribe'), sub: t('cal.subscribeSub'), className: 'cal-mg-subscribe', onClick: () => subscribe() })),
          subheader(t('cal.otherCals')),
          list(
            switchRow({ icon: 'calGift', title: t('cal.birthdays'), sub: t('cal.birthdaysSub'), checked: p.birthdays, onChange: (v) => D.setPrefs({ birthdays: v }) }),
            row({ icon: dot(p.birthdayColor), title: t('cal.birthdayColor'), className: 'cal-dotrow', onClick: async () => { const c = await pickColor(t('cal.birthdayColor'), p.birthdayColor); if (c) D.setPrefs({ birthdayColor: c }); } }),
            switchRow({ icon: 'checkCircle', title: t('cal.reminders'), sub: t('cal.remindersSub'), checked: p.reminders, onChange: (v) => D.setPrefs({ reminders: v }) })),
          subheader(t('cal.importExport')),
          list(
            row({ icon: 'calImport', title: t('cal.import'), sub: t('cal.importSub'), className: 'cal-mg-import', onClick: () => importFile() }),
            row({ icon: 'share', title: t('cal.exportAll'), sub: t('cal.exportSub'), className: 'cal-mg-export', onClick: () => exportCals(null) })));
      };
      draw();
      const offs = ['calendars', 'calSubs', 'calPrefs', 'events'].map((k) => store.on(k, draw));
      return () => offs.forEach((f) => f());
    },
  });
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return String(u || ''); } };

async function createCal() {
  const name = (await prompt(t('cal.createCal'), { placeholder: t('cal.calNamePh'), okLabel: t('common.add') }))?.trim();
  if (!name) return;
  const c = { id: 'cal-' + uid(), name, color: freeColor() };
  D.setCalendars([...D.localCals(), c]);
  return c;
}

function calMenu(e, c) {
  const cals = D.localCals();
  menu(e.currentTarget || e, [
    { label: t('common.rename'), icon: 'edit', onClick: async () => { const v = (await prompt(t('common.rename'), { value: D.calName(c) }))?.trim(); if (v) D.setCalendars(D.localCals().map((x) => (x.id === c.id ? { ...x, name: v } : x))); } },
    { label: t('cal.color'), icon: 'palette', onClick: async () => { const v = await pickColor(t('cal.color'), c.color); if (v) D.setCalendars(D.localCals().map((x) => (x.id === c.id ? { ...x, color: v } : x))); } },
    { label: t('cal.setDefault'), icon: 'check', checked: D.defaultCalId() === c.id, onClick: () => D.setPrefs({ defaultCal: c.id }) },
    { label: t('cal.exportIcs'), icon: 'share', onClick: () => exportCals(c.id) },
    cals.length > 1 && '-',
    cals.length > 1 && { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => deleteCal(c) },
  ]);
}

async function deleteCal(c) {
  const evs = D.stored().filter((e) => (e.cal || D.defaultCalId()) === c.id);
  if (!(await confirm(t('cal.deleteCalQ', { name: D.calName(c) }), evs.length ? t('cal.deleteCalMsg', { n: evs.length }) : '', { okLabel: t('common.delete'), danger: true }))) return;
  const rest = D.localCals().filter((x) => x.id !== c.id);
  if (D.prefs().defaultCal === c.id) D.setPrefs({ defaultCal: rest[0].id });
  D.commit({ remove: evs.map((e) => e.id) });
  D.setCalendars(rest);
  toast(t('cal.calDeleted'));
}

function exportCals(id) {
  const evs = D.normalized().filter((e) => !e.readOnly && (!id || e.cal === id));
  if (!evs.length) return toast(t('cal.nothingToExport'));
  const name = id ? D.calName(D.localCals().find((c) => c.id === id)) : t('app.calendar');
  download(name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.ics', writeICS(evs, { name }), 'text/calendar');
  toast(t('cal.exported', { n: evs.length }));
}

// ---------------------------------------------------------------- import
/** Reads an .ics file into one of your calendars (or a new one named after the file's calendar). */
export async function importFile() {
  const file = await pickFile('.ics,.ical,.ifb,.icalendar,text/calendar');
  if (!file) return;
  if (file.size > MAX_ICS) return toast(t('cal.tooBig'));
  return importText(await file.text(), file.name.replace(/\.[^.]+$/, ''));
}

export async function importText(text, fallbackName = '') {
  const parsed = parseICS(text);
  if (!parsed.events.length) return toast(t('cal.importNone')), 0;
  const cals = D.localCals();
  const name = parsed.name || fallbackName || t('cal.imported');
  const target = await choose(t('cal.importTo', { n: parsed.events.length }), [
    ...cals.map((c) => ({ value: c.id, label: D.calName(c) })),
    { value: '__new', label: t('cal.importNew', { name }) },
  ], D.defaultCalId());
  if (!target) return 0;
  let calId = target;
  if (target === '__new') {
    calId = 'cal-' + uid();
    D.setCalendars([...cals, { id: calId, name, color: parsed.color || freeColor() }]);
  }
  // the same file imported again replaces its events (matched by UID) instead of doubling them
  const keys = new Set(parsed.events.filter((e) => e.uid).map((e) => e.uid + '|' + (e.orig || '')));
  const old = D.stored().filter((e) => e.cal === calId && e.uid && keys.has(e.uid + '|' + (e.orig || '')));
  const byUid = new Map(old.map((e) => [e.uid + '|' + (e.orig || ''), e.id]));
  const masters = new Map();
  const put = parsed.events.map((e) => {
    const k = e.uid ? e.uid + '|' + (e.orig || '') : null;
    const id = (k && byUid.get(k)) || uid();
    if (e.uid && !e.orig) masters.set(e.uid, id);
    return { ...e, id, cal: calId };
  }).map((e) => {
    const out = { ...e };
    if (out.of) out.of = masters.get(out.of) || undefined;
    if (!out.of) { delete out.of; delete out.orig; }
    return M.pack(out);
  });
  D.commit({ put });
  toast(t('cal.importedN', { n: put.length }));
  return put.length;
}

// ---------------------------------------------------------------- subscriptions
async function fetchIcs(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  if (text.length > MAX_ICS) throw new Error(t('cal.tooBig'));
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(t('cal.subNotIcs'));
  return text;
}

/** Subscribe by URL: asks Chrome for access to that site, downloads it once, then the worker keeps it fresh. */
export async function subscribe() {
  const input = await prompt(t('cal.subscribe'), { placeholder: 'https://… .ics', okLabel: t('cal.subscribeBtn'), type: 'url' });
  if (input == null || !input.trim()) return null;
  const url = subUrl(input);
  if (!url) return toast(t('cal.subBadUrl')), null;
  // this runs right after the button click, so Chrome can still show its permission prompt
  const u = new URL(url);
  const granted = await ensure(`${u.protocol}//${u.hostname}/*`).catch(() => false);
  toast(t('cal.subLoading'));
  let text;
  try {
    text = await fetchIcs(url);
  } catch (e) {
    toast(granted ? t('cal.subFailed', { e: e.message }) : t('cal.subNoAccess'));
    return null;
  }
  const parsed = parseICS(text);
  const id = 'sub-' + uid();
  const sub = { id, url, name: parsed.name || hostOf(url), color: parsed.color || freeColor(), last: Date.now(), error: '', every: 6 };
  const evs = subEvents(parsed, id);
  store.update(D.SUB_KEY, (m) => ({ ...(m && typeof m === 'object' ? m : {}), [id]: evs }));
  store.set('calSubs', [...D.subs(), sub]);
  globalThis.chrome?.runtime?.sendMessage?.({ type: 'cal-sub-tick' }).catch?.(() => {});
  toast(t('cal.subAdded', { name: sub.name, n: evs.length }));
  return sub;
}

/** Refresh now: the worker downloads it (it also does this every few hours). */
export async function refreshSub(id) {
  toast(t('cal.subLoading'));
  let res = null;
  try { res = await chrome.runtime.sendMessage({ type: 'cal-sub-refresh', id }); } catch (e) { res = { error: String(e.message || e) }; }
  const r = res?.results?.[0] || res;
  toast(r?.error ? t('cal.subFailed', { e: r.error }) : t('cal.subRefreshed', { n: r?.n ?? 0 }));
  return r;
}

function subMenu(e, s) {
  menu(e.currentTarget || e, [
    { label: t('cal.refresh'), icon: 'refresh', onClick: () => refreshSub(s.id) },
    { label: t('common.rename'), icon: 'edit', onClick: async () => { const v = (await prompt(t('common.rename'), { value: s.name }))?.trim(); if (v) store.set('calSubs', D.subs().map((x) => (x.id === s.id ? { ...x, name: v } : x))); } },
    { label: t('cal.color'), icon: 'palette', onClick: async () => { const v = await pickColor(t('cal.color'), s.color); if (v) store.set('calSubs', D.subs().map((x) => (x.id === s.id ? { ...x, color: v } : x))); } },
    { label: t('cal.copyUrl'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(s.url).then(() => toast(t('cal.copied')), () => {}) },
    '-',
    { label: t('cal.unsubscribe'), icon: 'trash', danger: true, onClick: () => unsubscribe(s) },
  ]);
}

async function unsubscribe(s) {
  if (!(await confirm(t('cal.unsubscribeQ', { name: s.name }), '', { okLabel: t('cal.unsubscribe'), danger: true }))) return;
  store.set('calSubs', D.subs().filter((x) => x.id !== s.id));
  store.update(D.SUB_KEY, (m) => { const o = { ...(m || {}) }; delete o[s.id]; return o; });
  D.setPrefs({ hidden: D.prefs().hidden.filter((x) => x !== s.id) });
  globalThis.chrome?.runtime?.sendMessage?.({ type: 'cal-sub-tick' }).catch?.(() => {});
}

// ---------------------------------------------------------------- settings
export function openSettings(ctx) {
  ctx.push({
    title: t('cal.settings'),
    className: 'cal-sub-page',
    render(body) {
      const draw = () => {
        const p = D.prefs();
        const fd = p.firstDay == null ? t('cal.fdLocale', { day: weekdayName(D.regionFirstDay()) }) : weekdayName(p.firstDay);
        const alerts = (list, allDay) => (list.length ? list.map((m) => alertText(m, allDay)).join(', ') : t('cal.none'));
        body.replaceChildren(
          subheader(t('cal.view')),
          list(
            row({ icon: 'calendar', title: t('cal.firstDay'), sub: fd, className: 'cal-set-first', onClick: async () => {
              const v = await choose(t('cal.firstDay'), [{ value: 'auto', label: t('cal.fdLocale', { day: weekdayName(D.regionFirstDay()) }) }, ...[6, 0, 1].map((d) => ({ value: d, label: weekdayName(d) }))], p.firstDay ?? 'auto');
              if (v != null) D.setPrefs({ firstDay: v === 'auto' ? null : v });
            } }),
            switchRow({ icon: 'list', title: t('cal.weekNumbers'), sub: t('cal.weekNumbersSub'), checked: p.weekNumbers, onChange: (v) => D.setPrefs({ weekNumbers: v }) }),
            row({ icon: 'globe', title: t('cal.altCal'), sub: altName(p.alt), className: 'cal-set-alt', onClick: async () => {
              const v = await choose(t('cal.altCal'), ['', ...ALT_CALS].map((c) => ({ value: c, label: altName(c), sub: c ? sample(c) : '' })), p.alt || '');
              if (v != null) D.setPrefs({ alt: v });
            } })),
          subheader(t('cal.reminderT')),
          list(
            row({ icon: 'bell', title: t('cal.defTimed'), sub: alerts(p.alertTimed, false), onClick: async () => {
              const v = await choose(t('cal.defTimed'), [{ value: 'none', label: t('cal.none') }, ...M.ALERTS_TIMED.map((m) => ({ value: m, label: alertText(m, false) }))], p.alertTimed[0] ?? 'none');
              if (v != null) D.setPrefs({ alertTimed: v === 'none' ? [] : [v] });
            } }),
            row({ icon: 'bell', title: t('cal.defAllDay'), sub: alerts(p.alertAllDay, true), onClick: async () => {
              const v = await choose(t('cal.defAllDay'), [{ value: 'none', label: t('cal.none') }, ...M.ALERTS_ALLDAY.map((m) => ({ value: m, label: alertText(m, true) }))], p.alertAllDay[0] ?? 'none');
              if (v != null) D.setPrefs({ alertAllDay: v === 'none' ? [] : [v] });
            } })),
          subheader(t('cal.calendars')),
          list(
            row({ icon: 'calMonth', title: t('cal.defaultCal'), sub: D.calName(D.localCals().find((c) => c.id === D.defaultCalId())), onClick: async () => {
              const v = await choose(t('cal.defaultCal'), D.localCals().map((c) => ({ value: c.id, label: D.calName(c) })), D.defaultCalId());
              if (v) D.setPrefs({ defaultCal: v });
            } }),
            row({ icon: 'edit', title: t('cal.manage'), chevron: true, onClick: () => openManage(ctx) })),
          h('div', { class: 'cal-set-note' }, h('span', { html: icon('info', 18) }), t('cal.alertsNote')));
      };
      draw();
      const off = store.on('calPrefs', draw);
      return off;
    },
  });
}
function sample(cal) {
  try { return new Intl.DateTimeFormat(locale(), { calendar: cal, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); } catch { return ''; }
}
