// Small building blocks for the Samsung Health pages: Home cards, section cards, Samsung's grey pill buttons and
// round +/− buttons, chips, form rows, steppers, and dialogs that ask for a number, a time or a date.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog } from '../core/ui.js';
import * as F from './format.js';

const { num, numIn } = F;

/** A Home card: a rounded white card with the tracker's name; the whole card opens its page. */
export function homeCard(id, { title, onOpen, body, cls = '' }) {
  const el = h('div', {
    class: ['hl-card', 'hl-card-' + id, cls], role: 'button', tabindex: 0, 'data-card': id, 'aria-label': title,
    onClick: (e) => { if (!e.target.closest('button, input, a, [data-stop]')) onOpen(); },
    onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); onOpen(); } },
  }, h('div', { class: 'hl-card-head' }, h('span', { class: 'hl-card-title' }, title), h('span', { class: 'hl-card-chev', html: icon('forward', 16) })), body);
  return el;
}
/** A white section card on a detail page, with an optional title row and a trailing action. */
export function section(title, children, { action, cls = '' } = {}) {
  return h('section', { class: ['hl-sec', cls] },
    title ? h('div', { class: 'hl-sec-head' }, h('h3', null, title), action || null) : null,
    ...[].concat(children).filter(Boolean));
}
/** Samsung Health's grey pill button ("Record", "Enter", "Add"); `primary` fills it with the tracker colour. */
export const pillBtn = (label, onClick, { primary = false, ic, cls = '', attrs = {} } = {}) =>
  h('button', { class: ['hl-pill', primary && 'primary', cls], onClick: (e) => { e.stopPropagation(); onClick(e); }, ...attrs }, ic ? h('span', { html: icon(ic, 18) }) : null, h('span', null, label));
export const roundBtn = (ic, onClick, label, cls = '') =>
  h('button', { class: ['hl-round', cls], title: label, 'aria-label': label, html: icon(ic, 22), onClick: (e) => { e.stopPropagation(); onClick(e); } });
/** A value with a small unit after it, as on Samsung's cards ("750 ml"). */
export const bigVal = (value, unit, cls = '') => h('div', { class: ['hl-big', cls] }, h('b', null, value), unit ? h('small', null, unit) : null);
export const empty = (ic, text, action) => h('div', { class: 'hl-empty' }, h('span', { html: icon(ic, 44) }), h('p', null, text), action || null);

/** A row of chips; multi = several can be on. Returns the element with .value (array or single). */
export function chips(options, value, onChange, { multi = false, cls = '' } = {}) {
  let cur = multi ? new Set(value || []) : value;
  const el = h('div', { class: ['ou-chips', 'hl-chips', cls] });
  const draw = () => el.replaceChildren(...options.map((o) => h('button', {
    class: ['ou-chip', (multi ? cur.has(o.value) : cur === o.value) && 'active'], 'aria-pressed': String(multi ? cur.has(o.value) : cur === o.value), 'data-value': o.value,
    onClick: () => {
      if (multi) { if (cur.has(o.value)) cur.delete(o.value); else cur.add(o.value); } else cur = o.value;
      draw();
      onChange?.(multi ? [...cur] : cur);
    },
  }, o.html ? h('span', { class: 'hl-chip-art', html: o.html }) : null, o.label)));
  draw();
  Object.defineProperty(el, 'value', { get: () => (multi ? [...cur] : cur) });
  return el;
}
/** A labelled form row (label above the control, like One UI's edit screens). */
export const field = (label, control, cls = '') => h('label', { class: ['hl-field', cls] }, h('span', { class: 'hl-field-label' }, label), control);
export const input = (props = {}) => h('input', { class: 'ou-input', ...props });
/** − value + stepper. */
export function stepper(value, { min = 0, max = 99, step = 1, fmt = (v) => num(v, 2), onChange } = {}) {
  let v = value;
  const out = h('span', { class: 'hl-step-v' }, fmt(v));
  const set = (x) => { v = Math.min(max, Math.max(min, Math.round(x / step) * step)); out.textContent = fmt(v); onChange?.(v); };
  const el = h('span', { class: 'hl-step' },
    h('button', { class: 'hl-step-b', 'aria-label': t('health.less'), html: icon('minus', 18), onClick: (e) => { e.preventDefault(); set(v - step); } }),
    out,
    h('button', { class: 'hl-step-b', 'aria-label': t('health.more'), html: icon('plus', 18), onClick: (e) => { e.preventDefault(); set(v + step); } }));
  Object.defineProperty(el, 'value', { get: () => v });
  return el;
}

/** Asks for a number. Resolves with it (in the unit shown) or null. */
export async function askNumber({ title, value = '', unit = '', min = 0, max = 1e6, decimals = 1, message } = {}) {
  const inp = input({ type: 'text', inputmode: 'decimal', value: value === '' || value == null ? '' : num(value, decimals).replace(/,/g, ''), 'aria-label': title });
  const err = h('div', { class: 'hl-err', hidden: true }, t('health.badNumber'));
  const valid = () => { const v = numIn(inp.value); const okv = Number.isFinite(v) && v >= min && v <= max; err.hidden = okv; return okv; };
  const res = await dialog({
    title, message,
    content: h('div', { class: 'ou-dialog-body hl-ask' }, h('div', { class: 'hl-ask-row' }, inp, unit ? h('span', { class: 'hl-ask-unit' }, unit) : null), err),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, validate: valid, value: () => numIn(inp.value) }],
  });
  return res == null ? null : res;
}
/** Picks one of a few options in a dialog (radio list). */
export { choose } from '../core/ui.js';
/** 'HH:MM' for a time input. */
export const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** A bottom bar with Cancel and Save, as on One UI's edit screens. */
export const bottomBar = (onCancel, onSave, saveLabel = t('common.save')) => h('div', { class: 'hl-bottombar' },
  h('button', { class: 'hl-bb-btn', onClick: onCancel }, t('common.cancel')),
  h('button', { class: 'hl-bb-btn primary', 'data-save': '', onClick: onSave }, saveLabel));

// ——— shared by the Home cards and the pages ———
export const ICON = { activity: 'hlRings', meds: 'hlPill', water: 'drop', sleep: 'hlBed', mood: 'hlMood', body: 'hlScale', cycle: 'hlCycle', breathe: 'hlBreathe' };
export const CARD_COLOR = { activity: '#1fbf83', meds: '#7a6cf5', water: '#2f9bff', sleep: '#6d5ce8', mood: '#ffae2b', body: '#10b3a3', cycle: '#ff5c8a', breathe: '#22bfb0' };
/** "7 h 32 m" with big numbers and small units. */
export function durBig(min, cls = '') {
  min = Math.round(min);
  const hh = Math.floor(min / 60), mm = min % 60;
  return h('div', { class: ['hl-big', cls] },
    hh ? [h('b', null, num(hh)), h('small', null, t('health.u.h'))] : null,
    mm || !hh ? [h('b', null, num(mm)), h('small', null, t(hh ? 'health.u.m' : 'health.u.min'))] : null);
}

/** "Period · Day 2", "Period expected in 5 days", "Period late by 3 days", "Cycle day 17". */
export function cycleLine(st) {
  if (!st) return '';
  if (st.kind === 'period') return t('health.cycle.periodDay', { n: F.num(st.n) });
  if (st.kind === 'late') return F.tn('health.cycle.late', st.n);
  if (st.kind === 'next') return st.n === 0 ? t('health.cycle.expectedToday') : t('health.cycle.expected', { when: F.inDays(st.n) });
  return t('health.cycle.day', { n: F.num(st.n) });
}

