// Calendar event editor and detail (Samsung Calendar, One UI): the editor — title with the event colour and a
// natural-language suggestion ("Lunch with Sara Friday 1pm at Café Luna" → date, time, place, invitees), calendar,
// All day, start and end, time zone, two reminders, repeat (presets and Custom: every n days/weeks/months/years, on
// weekdays, on day n or the nth weekday, until a date or n times), location, invitees, notes — and the event detail
// with Edit / Share / Delete. Changes to a repeating event ask "Only this event / This and future events / All
// events". Works from anywhere (editEvent() is exported through js/apps/calendar.js), not only inside the app.
import { h, uid, sameDay, download, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime } from '../core/i18n.js';
import { dialog, choose, toast, menu, switchRow, swatches } from '../core/ui.js';
import { openApp } from '../core/apps.js';
import * as M from './model.js';
import * as D from './data.js';
import './strings.js';
import { repeatText, alertText, rangeText, eventWhen, zoneLabel, deviceZone, weekdayLabels, altLong, altCal } from './format.js';
import { writeICS } from './ics.js';
import { eventFromText } from './smart.js';

// ---------------------------------------------------------------- saving with the repeat scope
/** "Only this event / This and future events / All events" (without the first when the repeat itself changed). */
export function askScope(kind, { repeatChanged = false } = {}) {
  const opts = [
    !repeatChanged && { value: 'one', label: t('cal.scopeOne') },
    { value: 'future', label: t('cal.scopeFuture') },
    { value: 'all', label: t('cal.scopeAll') },
  ].filter(Boolean);
  return choose(t(kind === 'delete' ? 'cal.scopeDelete' : 'cal.scopeEdit'), opts, opts[0].value).then((v) => v || null);
}

const shiftKey = (k, n) => M.dkey(M.addDays(M.parseKey(k), n));

/**
 * Applies a change (patch of stored fields; start/end are this occurrence's new times) to an occurrence. A repeating
 * event asks for the scope unless `scope` is given. Returns the changed or new stored event, or false.
 */
export async function applyChange(o, patch, { repeatChanged = false, scope = null } = {}) {
  const raw = D.rawById(o.master);
  if (!raw || o.readOnly) return false;
  const n = M.norm(raw, D.defaultCalId());
  if (!n.repeat) {
    D.commit({ put: [{ ...patch, id: raw.id }] });
    return D.rawById(raw.id);
  }
  scope ||= await askScope('edit', { repeatChanged });
  if (!scope) return false;
  const ns = patch.start ?? o.start, ne = patch.end ?? o.end, allDay = patch.allDay ?? o.allDay;
  if (scope === 'one') {
    const exc = M.pack({ ...raw, ...patch, id: uid(), of: raw.id, orig: o.occ, start: ns, end: ne, allDay });
    for (const k of ['repeat', 'exdates', 'uid']) delete exc[k];
    D.commit({ put: [{ id: raw.id, exdates: [...new Set([...n.exdates, o.occ])] }, exc] });
    return exc;
  }
  const shift = M.daysBetween(o.start, ns);
  const spanDays = M.daysBetween(ns, ne);
  const at = (day) => (allDay
    ? { start: +M.dayStart(day), end: +M.addDays(day, spanDays) + M.DAY - 60e3 }
    : { start: M.atDay(day, ns), end: M.atDay(day, ns) + (ne - ns) });
  let rep = 'repeat' in patch ? M.validRepeat(patch.repeat) : n.repeat;
  if (!repeatChanged && shift && rep) rep = M.shiftRepeat(rep, shift);
  if (scope === 'all' || o.occ <= M.dkey(n.start)) {
    // the whole series moves like this occurrence did; without a repeat any more it stays where this occurrence is
    const times = rep ? at(M.addDays(n.start, shift)) : at(M.dayStart(ns));
    D.commit({ put: [{ ...patch, id: raw.id, ...times, allDay, repeat: rep, exdates: rep ? n.exdates.map((x) => shiftKey(x, shift)) : [] }] });
    return D.rawById(raw.id);
  }
  const [before, after] = M.splitSeries(n, o.occ);
  const next = M.pack({ ...raw, ...patch, id: uid(), ...at(M.dayStart(ns)), allDay, repeat: rep, exdates: after.exdates.map((x) => shiftKey(x, shift)) });
  delete next.uid;
  // changed single occurrences after this day now belong to the new series
  const moved = D.stored().filter((x) => x.of === raw.id && x.orig >= o.occ).map((x) => ({ id: x.id, of: next.id }));
  D.commit({ put: [{ id: raw.id, repeat: before.repeat, exdates: before.exdates }, next, ...moved] });
  return next;
}

/** Deletes an occurrence (asking the scope for a repeating event), with Undo. */
export async function deleteOcc(o) {
  const raw = D.rawById(o.master);
  if (!raw || o.readOnly) return false;
  const before = D.stored();
  const n = M.norm(raw, D.defaultCalId());
  if (!n.repeat) D.commit({ remove: [raw.id] });
  else {
    const scope = await askScope('delete');
    if (!scope) return false;
    const exceptions = (pred) => D.stored().filter((x) => x.of === raw.id && pred(x)).map((x) => x.id);
    if (scope === 'one') D.commit({ put: [{ id: raw.id, exdates: [...new Set([...n.exdates, o.occ])] }] });
    else if (scope === 'all' || o.occ <= M.dkey(n.start)) D.commit({ remove: [raw.id, ...exceptions(() => true)] });
    else {
      const rep = { ...n.repeat, until: shiftKey(o.occ, -1) };
      delete rep.count;
      D.commit({ put: [{ id: raw.id, repeat: rep }], remove: exceptions((x) => x.orig >= o.occ) });
    }
  }
  toast(t('cal.deleted'), { action: t('common.undo'), onAction: () => D.restore(before) });
  return true;
}

/** Opens a copy of the event in the editor (subscribed events become your own). */
export function duplicateOcc(o) {
  const n = o.kind ? null : D.byId(o.master);
  const src = n || o;
  return editEvent(null, new Date(o.start), {
    title: src.title, start: o.start, end: o.end, allDay: o.allDay, cal: D.localCals().some((c) => c.id === src.cal) ? src.cal : D.defaultCalId(),
    color: n?.ownColor ? n.color : '', place: src.place, people: src.people, notes: src.notes, alerts: src.readOnly ? undefined : src.alerts, repeat: src.repeat, tz: src.tz,
  });
}

/** Saves the event (the whole series for a repeating one) as an .ics file. */
export function shareOcc(o) {
  const ev = D.byId(o.master) || o;
  const name = (ev.title || t('cal.myEvent')).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'event';
  download(name + '.ics', writeICS([ev]), 'text/calendar');
}

/** Quick add under the day's agenda: "Lunch with Sara 1pm" → an event on that day (or the day the text names). */
export function quickAdd(text, day, api) {
  const e = eventFromText(text, new Date(), { day });
  const ev = D.addEvent({ title: e.title || text, start: e.start, end: e.end, allDay: e.allDay, ...(e.repeat ? { repeat: e.repeat } : {}), ...(e.place ? { place: e.place } : {}), ...(e.people.length ? { people: e.people } : {}) });
  const o = M.norm(ev, D.defaultCalId());
  if (api && !sameDay(o.start, api.st.cur)) api.go(new Date(o.start));
  toast(t('cal.added', { when: eventWhen(o) }), { action: t('common.edit'), onAction: () => editEvent(D.rawById(ev.id)) });
  return ev;
}

// ---------------------------------------------------------------- the event detail
export async function openDetail(o) {
  const cal = D.calById(o.cal) || { name: D.calName({ id: o.cal }), color: o.color };
  const row = (ic, ...content) => h('div', { class: 'cal-dt-row' }, h('span', { class: 'cal-dt-ico', html: icon(ic, 20) }), h('div', { class: 'cal-dt-txt' }, ...content));
  const when = [rangeText(o)];
  if (o.tz && o.tz !== deviceZone() && !o.allDay) when.push(zoneLabel(o.tz, o.start));
  const alt = altCal() ? altLong(new Date(o.start)) : '';
  const content = h('div', { class: 'cal-dt', style: `--c:${o.color}` },
    h('div', { class: 'cal-dt-head' },
      h('span', { class: 'cal-dt-bar' }),
      h('div', { class: 'cal-dt-hd' },
        h('div', { class: 'cal-dt-title' }, o.title || t('cal.myEvent')),
        h('div', { class: 'cal-dt-cal' }, h('i', { style: `background:${cal.color}` }), cal.name, o.readOnly && o.kind !== 'birthday' ? ' · ' + t('cal.readOnly') : ''))),
    row('clock', h('div', { class: 'cal-dt-when' }, when.join('\n'))),
    alt ? row('calendar', alt) : null,
    o.repeat && o.kind !== 'birthday' ? row('calRepeat', repeatText(o.repeat, o.start)) : null,
    o.alerts?.length ? row('bell', o.alerts.map((m) => alertText(m, o.allDay)).join('\n')) : null,
    o.place ? row('location', o.place) : null,
    o.people?.length ? row('user', o.people.join(', ')) : null,
    o.notes ? row('note', h('div', { class: 'cal-dt-notes' }, o.notes)) : null);
  const actions = o.kind === 'birthday'
    ? [{ label: t('common.close'), value: null }, { label: t('cal.openContact'), value: 'contact', primary: true }]
    : o.readOnly
      ? [{ label: t('cal.duplicate'), value: 'dup' }, { label: t('common.close'), value: null, primary: true }]
      : [{ label: t('common.delete'), value: 'delete', danger: true }, { label: t('cal.share'), value: 'share' }, { label: t('common.edit'), value: 'edit', primary: true }];
  const res = await dialog({ content, actions, className: 'wide cal-dialog cal-detail' });
  if (res === 'edit') return editEvent(o);
  if (res === 'delete') return deleteOcc(o);
  if (res === 'share') return shareOcc(o);
  if (res === 'dup') return duplicateOcc(o);
  if (res === 'contact') return openApp('contacts', { params: { id: o.cid } });
  return null;
}

// ---------------------------------------------------------------- pickers
function pickAlert(cur, allDay) {
  const list = allDay ? M.ALERTS_ALLDAY : M.ALERTS_TIMED;
  const opts = list.map((m) => ({ value: m, label: alertText(m, allDay) }));
  if (cur != null && !list.includes(cur)) opts.unshift({ value: cur, label: alertText(cur, allDay) });
  return choose(t('cal.reminderT'), opts, cur ?? list[allDay ? 0 : 2]);
}

const sameRule = (a, b) => JSON.stringify(a ? { ...a, until: undefined, count: undefined } : null) === JSON.stringify(b ? { ...b, until: undefined, count: undefined } : null);
async function pickRepeat(cur, start) {
  const d = new Date(start), wd = d.getDay(), pos = M.weekOfMonth(d);
  const presets = [
    ['none', null],
    ['day', { freq: 'day', interval: 1 }],
    ['weekdays', { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] }],
    ['week', { freq: 'week', interval: 1, days: [wd] }],
    ['month', { freq: 'month', interval: 1 }],
    ['monthPos', { freq: 'month', interval: 1, pos, wd }],
    ['year', { freq: 'year', interval: 1 }],
  ];
  const curV = cur ? (presets.find(([, r]) => r && sameRule(M.validRepeat(r), M.validRepeat({ ...cur, days: cur.freq === 'week' ? cur.days || [wd] : cur.days })))?.[0] || 'custom') : 'none';
  const opts = presets.map(([v, r]) => ({ value: v, label: repeatText(r, start) }));
  opts.push({ value: 'custom', label: curV === 'custom' ? t('cal.repCustomCur', { text: repeatText(cur, start) }) : t('cal.repCustom') });
  const v = await choose(t('cal.repeat'), opts, curV);
  if (v == null) return undefined;
  if (v === 'custom') return customRepeat(cur, start);
  const r = presets.find((x) => x[0] === v)[1];
  return r ? M.validRepeat(r) : null;
}

/** Samsung's Custom repeat: every n days/weeks/months/years, weekdays, monthly by day or weekday, and when it ends. */
async function customRepeat(cur, start) {
  const d = new Date(start);
  const r = { freq: 'week', interval: 1, days: [d.getDay()], ...(cur || {}) };
  if (!r.days?.length) r.days = [d.getDay()];
  const num = h('input', { class: 'ou-input cal-cr-n', type: 'number', min: 1, max: 99, value: r.interval || 1 });
  const unit = h('select', { class: 'ou-input cal-cr-unit' }, ['day', 'week', 'month', 'year'].map((u) => h('option', { value: u, selected: r.freq === u }, t('cal.unit.' + u))));
  const days = new Set(r.days);
  const dayChips = h('div', { class: 'cal-cr-days' }, weekdayLabels('narrow').map(({ wd, label }) => {
    const b = h('button', { type: 'button', class: ['cal-cr-day', days.has(wd) && 'on'], 'aria-pressed': String(days.has(wd)), title: fmtDate(new Date(2024, 0, 7 + wd), { weekday: 'long' }),
      onClick: () => {
        if (days.has(wd) && days.size > 1) days.delete(wd);
        else days.add(wd);
        b.classList.toggle('on', days.has(wd));
        b.setAttribute('aria-pressed', String(days.has(wd)));
      } }, label);
    return b;
  }));
  const radio = (name, value, checked, label) => h('label', { class: 'ou-radio-row' }, h('input', { type: 'radio', name, value, checked }), h('span', { class: 'ou-radio' }), h('span', { class: 'ou-radio-text' }, label));
  const pos = M.weekOfMonth(d);
  const monthBy = h('div', { class: 'cal-cr-month' },
    radio('cal-cr-m', 'day', !r.pos, t('cal.onDayCap', { n: d.getDate() })),
    radio('cal-cr-m', 'pos', !!r.pos, t('cal.onNthCap', { nth: t({ 1: 'cal.ord1', 2: 'cal.ord2', 3: 'cal.ord3', 4: 'cal.ord4', '-1': 'cal.ordLast' }[pos]), day: fmtDate(d, { weekday: 'long' }) })));
  const untilIn = h('input', { class: 'ou-input cal-cr-until', type: 'date', value: r.until || M.dkey(M.addDays(d, 30)) });
  const countIn = h('input', { class: 'ou-input cal-cr-count', type: 'number', min: 1, max: 999, value: r.count || 10 });
  const ends = h('div', { class: 'cal-cr-ends' },
    radio('cal-cr-e', 'never', !r.until && !r.count, t('cal.endsNever')),
    h('div', { class: 'cal-cr-end' }, radio('cal-cr-e', 'until', !!r.until, t('cal.endsOn')), untilIn),
    h('div', { class: 'cal-cr-end' }, radio('cal-cr-e', 'count', !!r.count && !r.until, t('cal.endsAfter')), countIn, h('span', null, t('cal.timesUnit'))));
  const sync = () => {
    dayChips.hidden = unit.value !== 'week';
    monthBy.hidden = unit.value !== 'month';
  };
  unit.addEventListener('change', sync);
  untilIn.addEventListener('focus', () => (ends.querySelector('input[value=until]').checked = true));
  countIn.addEventListener('focus', () => (ends.querySelector('input[value=count]').checked = true));
  sync();
  const content = h('div', { class: 'cal-cr' },
    h('div', { class: 'cal-cr-every' }, h('span', null, t('cal.every')), num, unit),
    dayChips, monthBy,
    h('div', { class: 'cal-cr-h' }, t('cal.ends')), ends);
  const res = await dialog({
    title: t('cal.repCustomT'), content, className: 'cal-dialog cal-custom',
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: 'ok', primary: true }],
  });
  if (res !== 'ok') return undefined;
  const out = { freq: unit.value, interval: Math.max(1, Math.min(99, +num.value || 1)) };
  if (out.freq === 'week') out.days = [...days];
  if (out.freq === 'month' && content.querySelector('input[name=cal-cr-m]:checked')?.value === 'pos') Object.assign(out, { pos, wd: d.getDay() });
  const e = content.querySelector('input[name=cal-cr-e]:checked')?.value;
  if (e === 'until' && M.isKey(untilIn.value)) out.until = untilIn.value;
  if (e === 'count') out.count = Math.max(1, +countIn.value || 1);
  return M.validRepeat(out);
}

/** Time zone list with a search field; '' = this device's zone. */
async function pickZone(cur, at) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['UTC', 'Europe/London', 'Europe/Paris', 'Asia/Riyadh', 'Asia/Dubai', 'Africa/Cairo', 'America/New_York', 'Asia/Tokyo']; }
  const dev = deviceZone();
  const q = h('input', { class: 'ou-input cal-tz-q', type: 'search', placeholder: t('cal.tzSearch'), spellcheck: 'false' });
  const box = h('div', { class: 'cal-tz-list scroll' });
  let close = null;
  const item = (value, label, sub) => h('button', { class: ['cal-tz-item', (value || '') === (cur || '') && 'on'], onClick: () => close?.(value) }, h('span', null, label), sub ? h('small', null, sub) : null);
  const draw = () => {
    const f = q.value.trim().toLowerCase().replace(/\s+/g, '_');
    const list = zones.filter((z) => !f || z.toLowerCase().includes(f)).slice(0, 250);
    box.replaceChildren(...(f ? [] : [item('', t('cal.tzDevice'), zoneLabel(dev, at))]), ...list.map((z) => item(z, zoneLabel(z, at), z.includes('/') ? z.split('/')[0] : '')));
  };
  q.addEventListener('input', draw);
  draw();
  const content = h('div', { class: 'cal-tz' }, q, box);
  const p = dialog({ title: t('cal.tz'), content, className: 'cal-dialog cal-tzpick', actions: [{ label: t('common.cancel'), value: undefined }] });
  close = (v) => content.closest('.ou-dialog')?._close(v);
  setTimeout(() => box.querySelector('.on')?.scrollIntoView({ block: 'center' }), 50);
  return p;
}

function pickColor(cur, calColor) {
  let close = null;
  const sw = swatches([calColor, ...M.PALETTE.filter((c) => c !== calColor)], cur || calColor, (c) => close?.(c === calColor ? '' : c));
  sw.classList.add('cal-colors');
  const content = h('div', { class: 'cal-colorpick' }, sw, h('div', { class: 'cal-colors-hint' }, t('cal.calColorHint')));
  const p = dialog({ title: t('cal.eventColor'), content, className: 'cal-dialog', actions: [{ label: t('common.cancel'), value: undefined }] });
  close = (v) => content.closest('.ou-dialog')?._close(v);
  return p;
}

// ---------------------------------------------------------------- the editor
/**
 * Opens the editor. `existing`: a stored event, a normalized one or an occurrence (its times are the ones shown);
 * null for a new event on `day`, with optional `draft` fields ({ start, end, allDay, title, place, … }).
 * Resolves with the saved stored event, or null.
 */
export async function editEvent(existing, day = new Date(), draft = {}) {
  const occ = existing?.master && existing?.occ ? existing : null;
  const raw = existing ? D.rawById(existing.master || existing.id) : null;
  if (existing && !raw) {
    if (occ?.readOnly) duplicateOcc(occ);
    return null;
  }
  const isNew = !raw;
  const p = D.prefs();
  const n = raw ? M.norm(raw, D.defaultCalId()) : null;
  const f = {};
  if (n) {
    Object.assign(f, { title: n.title, cal: n.cal, color: raw.color || '', allDay: n.allDay, start: occ ? occ.start : n.start, end: occ ? occ.end : n.end, tz: n.tz,
      alerts: [...n.alerts], repeat: n.repeat, place: n.place, people: n.people.join(', '), notes: n.notes });
  } else {
    const base = M.dayStart(draft.day || day), now = new Date();
    let s = draft.start, e = draft.end;
    if (s == null) {
      const b = new Date(base);
      if (sameDay(b, now)) b.setHours(now.getHours() + 1, 0, 0, 0);
      else b.setHours(9, 0, 0, 0);
      s = b.getTime();
    }
    const allDay = !!draft.allDay;
    if (e == null || e < s) e = allDay ? s : s + 3600e3;
    Object.assign(f, { title: draft.title || '', cal: draft.cal || D.defaultCalId(), color: draft.color || '', allDay, start: s, end: e, tz: draft.tz || '',
      alerts: [...(draft.alerts || (allDay ? p.alertAllDay : p.alertTimed))].slice(0, M.MAX_ALERTS), repeat: M.validRepeat(draft.repeat), place: draft.place || '',
      people: (draft.people || []).join(', '), notes: draft.notes || '' });
  }
  const calOf = (id) => D.localCals().find((c) => c.id === id) || D.localCals()[0];
  const curColor = () => f.color || calOf(f.cal)?.color || M.PALETTE[0];

  // title, colour, natural-language suggestion
  const title = h('input', { class: 'cal-ed-title', placeholder: t('cal.titlePh'), value: f.title, 'aria-label': t('cal.titlePh') });
  const colorBtn = h('button', { type: 'button', class: 'cal-ed-color', title: t('cal.eventColor'), 'aria-label': t('cal.eventColor'),
    onClick: async () => { const c = await pickColor(f.color, calOf(f.cal).color); if (c !== undefined) { f.color = c; paint(); } } });
  const smart = h('button', { type: 'button', class: 'cal-ed-smart', hidden: true });
  const calBtn = h('button', { type: 'button', class: 'cal-ed-cal',
    onClick: (e) => menu(e.currentTarget, D.localCals().map((c) => ({ label: D.calName(c), checked: c.id === f.cal, onClick: () => { f.cal = c.id; paint(); } }))) });

  // when
  const tzNow = () => f.tz;
  const wS = M.wallInputs(f.start, f.tz), wE = M.wallInputs(f.allDay ? f.start + Math.max(0, M.daysBetween(f.start, f.end)) * M.DAY : f.end, f.tz);
  if (f.allDay) wE.date = M.dkey(f.end);
  const pick = (type, value, cls) => {
    const input = h('input', { type, class: cls, value, required: true });
    const txt = h('span', { class: 'cal-ed-pick-text' });
    const el = h('label', { class: ['cal-ed-pick', 'cal-ed-' + type] }, txt, input);
    el.addEventListener('click', (e) => { if (e.target === input) try { input.showPicker(); } catch {} });
    el.input = input;
    el.paint = () => {
      const v = input.value;
      if (type === 'date') txt.textContent = M.isKey(v) ? fmtDate(M.parseKey(v), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      else { const [hh, mm] = (v || '0:0').split(':').map(Number); txt.textContent = fmtTime(new Date(2024, 0, 1, hh || 0, mm || 0)); }
    };
    return el;
  };
  const sDate = pick('date', wS.date, 'cal-ed-sdate'), sTime = pick('time', wS.time, 'cal-ed-stime');
  const eDate = pick('date', wE.date, 'cal-ed-edate'), eTime = pick('time', wE.time, 'cal-ed-etime');
  const startMs = () => M.fromInputs(sDate.input.value, f.allDay ? '00:00' : sTime.input.value, f.allDay ? '' : tzNow());
  const endMs = () => M.fromInputs(eDate.input.value, f.allDay ? '00:00' : eTime.input.value, f.allDay ? '' : tzNow());
  let dur = endMs() - startMs();
  const onStart = () => {
    const s = startMs();
    if (!Number.isFinite(s)) return;
    const w = M.wallInputs(s + Math.max(0, f.allDay ? Math.round(dur / M.DAY) * M.DAY : dur), f.allDay ? '' : tzNow());
    eDate.input.value = w.date;
    if (!f.allDay) eTime.input.value = w.time;
    paint();
  };
  const onEnd = () => {
    if (endMs() < startMs()) { onStart(); return; }
    dur = endMs() - startMs();
    paint();
  };
  for (const x of [sDate, sTime]) x.input.addEventListener('change', onStart);
  for (const x of [eDate, eTime]) x.input.addEventListener('change', onEnd);
  const whenEl = h('div', { class: 'cal-ed-when' },
    h('div', { class: 'cal-ed-wrow' }, h('span', { class: 'cal-ed-lbl' }, t('cal.start')), sDate, sTime),
    h('div', { class: 'cal-ed-wrow' }, h('span', { class: 'cal-ed-lbl' }, t('cal.end')), eDate, eTime));
  const allDayRow = switchRow({ icon: 'clock', title: t('cal.allDay'), checked: f.allDay, onChange: (v) => setAllDay(v) });
  allDayRow.classList.add('cal-ed-allday');
  const tzBtn = h('button', { type: 'button', class: 'ou-row clickable cal-ed-tz', onClick: async () => { const z = await pickZone(f.tz, startMs()); if (z !== undefined && z !== null) { f.tz = z; paint(); } } });
  function setAllDay(v) {
    if (v === f.allDay) return;
    f.allDay = v;
    allDayRow.querySelector('input').checked = v;
    // reminders of the other kind don't fit: take the defaults of this kind
    const ok = v ? M.ALERTS_ALLDAY : M.ALERTS_TIMED;
    if (f.alerts.some((m) => !ok.includes(m))) f.alerts = [...(v ? p.alertAllDay : p.alertTimed)];
    if (!v && sTime.input.value === '00:00') {
      const now = new Date(), b = M.parseKey(sDate.input.value);
      sTime.input.value = sameDay(b, now) ? `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:00` : '09:00';
    }
    if (!v && eDate.input.value === sDate.input.value && eTime.input.value <= sTime.input.value) {
      const w = M.wallInputs(startMs() + 3600e3, tzNow());
      eDate.input.value = w.date;
      eTime.input.value = w.time;
    }
    dur = Math.max(0, endMs() - startMs());
    paint();
  }

  // reminders and repeat
  const alertsEl = h('div', { class: 'cal-ed-alerts' });
  const repeatBtn = h('button', { type: 'button', class: 'ou-row clickable cal-ed-repeat',
    onClick: async () => { const r = await pickRepeat(f.repeat, startMs()); if (r !== undefined) { f.repeat = r; paint(); } } });

  // more
  const place = h('input', { class: 'cal-ed-in cal-ed-place', placeholder: t('cal.location'), value: f.place, 'aria-label': t('cal.location') });
  const people = h('input', { class: 'cal-ed-in cal-ed-people', placeholder: t('cal.invitees'), value: f.people, 'aria-label': t('cal.invitees') });
  const notes = h('textarea', { class: 'cal-ed-in cal-ed-notes', rows: 3, placeholder: t('cal.notesPh'), 'aria-label': t('cal.notesPh') });
  notes.value = f.notes;
  const field = (ic, el) => h('div', { class: 'cal-ed-field' }, h('span', { class: 'cal-ed-fico', html: icon(ic, 20) }), el);

  function paint() {
    const c = curColor();
    colorBtn.style.background = c;
    content.style.setProperty('--c', c);
    calBtn.replaceChildren(h('i', { style: `background:${calOf(f.cal).color}` }), h('span', null, D.calName(calOf(f.cal))), h('span', { html: icon('down', 16) }));
    whenEl.classList.toggle('all-day', f.allDay);
    for (const x of [sDate, sTime, eDate, eTime]) x.paint();
    tzBtn.hidden = f.allDay;
    tzBtn.replaceChildren(h('span', { class: 'ou-row-ico', html: icon('globe', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('cal.tz')), h('span', { class: 'ou-row-sub' }, f.tz ? zoneLabel(f.tz, startMs()) : t('cal.tzDevice'))));
    alertsEl.replaceChildren(
      ...f.alerts.map((m, i) => h('div', { class: 'ou-row cal-ed-alert' },
        h('span', { class: 'ou-row-ico', html: icon('bell', 20) }),
        h('button', { type: 'button', class: 'cal-ed-alert-text', onClick: async () => { const v = await pickAlert(m, f.allDay); if (v != null) { f.alerts[i] = v; f.alerts = [...new Set(f.alerts)]; paint(); } } }, alertText(m, f.allDay)),
        h('button', { type: 'button', class: 'ou-icon-btn cal-ed-alert-x', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('close', 18), onClick: () => { f.alerts.splice(i, 1); paint(); } }))),
      f.alerts.length < M.MAX_ALERTS ? h('button', { type: 'button', class: 'ou-row clickable cal-ed-addalert', onClick: async () => { const v = await pickAlert(null, f.allDay); if (v != null && !f.alerts.includes(v)) { f.alerts.push(v); f.alerts.sort((a, b) => a - b); paint(); } } },
        h('span', { class: 'ou-row-ico', html: icon(f.alerts.length ? 'plus' : 'bell', 20) }), h('span', { class: 'ou-row-title' }, t('cal.addReminder'))) : '');
    repeatBtn.replaceChildren(h('span', { class: 'ou-row-ico', html: icon('calRepeat', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('cal.repeat')), h('span', { class: 'ou-row-sub' }, repeatText(f.repeat, startMs()))));
  }

  // "Lunch with Sara Friday 1pm at Café Luna" → a suggestion under the title
  let suggestion = null;
  const suggest = debounce(() => {
    const v = title.value.trim();
    suggestion = null;
    smart.hidden = true;
    if (v.length < 4) return;
    const e = eventFromText(v, new Date(), { day: M.parseKey(sDate.input.value) });
    if (!e.found || (!e.repeat && !e.place && e.title === v)) return;
    suggestion = e;
    const parts = [eventWhen(M.norm({ ...e, id: 'x' }))];
    if (e.repeat) parts.push(repeatText(e.repeat, e.start));
    if (e.place) parts.push(e.place);
    smart.replaceChildren(h('span', { class: 'cal-ed-smart-ico', html: icon('sparkle', 18) }), h('span', { class: 'cal-ed-smart-text' }, parts.join(' · ')), h('b', null, t('cal.smartUse')));
    smart.hidden = false;
  }, 250);
  smart.addEventListener('click', () => {
    const e = suggestion;
    if (!e) return;
    title.value = e.title || title.value;
    f.tz = '';
    f.allDay = !e.allDay; // setAllDay only acts on a change
    setAllDay(e.allDay);
    const ws = M.wallInputs(e.start), we = M.wallInputs(e.allDay ? M.dayStart(e.end).getTime() : e.end);
    sDate.input.value = ws.date; eDate.input.value = we.date;
    if (!e.allDay) { sTime.input.value = ws.time; eTime.input.value = we.time; }
    dur = endMs() - startMs();
    if (e.repeat) f.repeat = M.validRepeat(e.repeat);
    if (e.place && !place.value) place.value = e.place;
    if (e.people.length) people.value = [...new Set([...people.value.split(',').map((x) => x.trim()).filter(Boolean), ...e.people])].join(', ');
    suggestion = null;
    smart.hidden = true;
    paint();
    title.focus();
  });
  if (isNew) title.addEventListener('input', suggest);

  const content = h('div', { class: 'cal-ed', dataset: { mode: isNew ? 'new' : 'edit' } },
    h('div', { class: 'cal-ed-head' }, title, colorBtn),
    smart,
    h('div', { class: 'cal-ed-calrow' }, calBtn),
    h('div', { class: 'cal-ed-sec' }, allDayRow, whenEl, tzBtn),
    h('div', { class: 'cal-ed-sec' }, alertsEl, repeatBtn),
    h('div', { class: 'cal-ed-sec' }, field('location', place), field('user', people), field('note', notes)));
  paint();

  const res = await dialog({
    content, className: 'wide cal-dialog cal-editor',
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'save', primary: true }],
  });
  if (res !== 'save') return null;

  let start = startMs(), end = endMs();
  if (!Number.isFinite(start)) start = f.start;
  if (!Number.isFinite(end) || end < start) end = f.allDay ? start : start + 3600e3;
  if (f.allDay) end = M.dayStart(end).getTime() + M.DAY - 60e3;
  const out = {
    title: title.value.trim() || t('cal.myEvent'), cal: f.cal, color: f.color, allDay: f.allDay, start, end, tz: f.allDay ? '' : f.tz,
    alerts: [...f.alerts], repeat: f.repeat, place: place.value.trim(), people: people.value.split(/[,،;]/).map((x) => x.trim()).filter(Boolean), notes: notes.value,
  };
  if (isNew) {
    const ev = M.pack({ id: uid(), ...out });
    D.commit({ put: [ev] });
    return D.rawById(ev.id);
  }
  if (!n.repeat) {
    D.commit({ put: [{ ...out, id: raw.id }] });
    return D.rawById(raw.id);
  }
  const repeatChanged = !sameRuleFull(out.repeat, n.repeat);
  // opened without a particular occurrence (Finder, a notification): the change is for the whole series
  const o = occ || { ...n, key: n.id + '/' + M.dkey(n.start), master: n.id, occ: M.dkey(n.start), recurring: true };
  return applyChange(o, out, { repeatChanged, scope: occ ? null : 'all' });
}
const sameRuleFull = (a, b) => JSON.stringify(M.validRepeat(a)) === JSON.stringify(M.validRepeat(b));
