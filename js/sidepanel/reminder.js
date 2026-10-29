// Side panel › Reminder: what's due today (and what's overdue), upcoming and undated reminders, and a quick add that
// understands "Call Mom tomorrow 6pm" / "اتصل بأمي غدًا الساعة 6 مساءً" (js/apps/reminder.js parseQuickTime). Every
// write goes through the Reminder app's data module (js/reminder/data.js), like the app's own: alarms stay in step,
// a repeating reminder moves on to its next time when completed, and each Undo restores exactly what changed.
import { h, sameDay } from '../core/util.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { t } from '../core/i18n.js';
import { menu, toast } from '../core/ui.js';
import { addReminder, parseQuickTime, fmtDue } from '../apps/reminder.js';
import * as D from '../reminder/data.js';
import { header, openAppBtn, empty } from './kit.js';

const list = () => D.list();
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

export function render(main) {
  let draft = '';
  const input = h('input', { class: 'sp-add-in', placeholder: t('sp.rem.add'), 'aria-label': t('sp.rem.add'), autocomplete: 'off', enterkeyhint: 'done' });
  const hint = h('div', { class: 'sp-add-hint', 'aria-live': 'polite' });
  const form = h('form', { class: 'sp-add', onSubmit: (e) => { e.preventDefault(); add(); } },
    h('span', { class: 'sp-add-plus', html: icon('plus', 22) }), input);
  const head = header({ title: t('sp.tab.reminder'), actions: [openAppBtn('reminder')] });
  const lists = h('div', { class: 'sp-rem-lists' });
  main.replaceChildren(head, form, hint, lists);

  const drawHint = () => {
    const { due } = draft.trim() ? parseQuickTime(draft) : { due: null };
    hint.replaceChildren(...(due ? [h('span', { class: 'sp-chip' }, h('span', { html: icon('calendar', 14) }), h('bdi', null, fmtDue(due)))] : []));
  };
  input.addEventListener('input', () => { draft = input.value; drawHint(); });

  function add() {
    const text = input.value.trim();
    if (!text) return;
    const { title, due } = parseQuickTime(text);
    const r = addReminder({ title: title || text, due: due || null });
    input.value = draft = '';
    drawHint();
    toast(r.due ? t('sp.rem.addedAt', { when: fmtDue(r.due) }) : t('sp.rem.added'));
    input.focus();
  }

  function item(r) {
    const overdue = r.due && r.due < Date.now();
    const el = h('div', { class: ['sp-rem', r.priority && 'important'], dataset: { id: r.id } },
      h('button', {
        class: ['sp-check', r.priority && 'important'], role: 'checkbox', 'aria-checked': 'false', 'aria-label': r.title, html: icon('check', 16),
        onClick: () => {
          el.classList.add('done');
          setTimeout(() => {
            const undo = D.setDone(r.id, true);
            toast(t('sp.rem.done'), { action: t('common.undo'), onAction: undo });
          }, 260);
        },
      }),
      h('div', { class: 'sp-rem-text' },
        h('div', { class: 'sp-rem-title' }, h('bdi', null, r.title || t('common.untitled'))),
        r.due ? h('div', { class: ['sp-rem-due', overdue && 'overdue'] }, fmtDue(r.due)) : null,
        r.notes ? h('div', { class: 'sp-rem-notes' }, h('bdi', null, r.notes.split('\n')[0])) : null),
      r.priority ? h('span', { class: 'sp-star', html: icon('starFill', 18) }) : null);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e, [
        { label: t('sp.rem.important'), icon: 'star', checked: !!r.priority, onClick: () => D.patch(r.id, { priority: !r.priority }) },
        '-',
        {
          label: t('sp.rem.delete'), icon: 'trash', danger: true, onClick: () => {
            const undo = D.removeMany([r.id]);
            toast(t('sp.rem.deleted'), { action: t('common.undo'), onAction: undo });
          },
        },
      ]);
    });
    return el;
  }

  function draw() {
    const open = list().filter((r) => !r.done);
    const eod = endOfToday();
    const byDue = (a, b) => (b.priority - a.priority) || (a.due - b.due) || (b.created - a.created);
    const today = open.filter((r) => r.due && r.due <= eod).sort(byDue);
    const later = open.filter((r) => r.due && r.due > eod).sort(byDue);
    const undated = open.filter((r) => !r.due).sort((a, b) => (b.priority - a.priority) || (b.created - a.created));
    const dueToday = today.filter((r) => sameDay(r.due, Date.now()) || r.due < Date.now()).length;
    head.setSub(dueToday ? t('sp.rem.dueToday', { n: dueToday }) : t('sp.rem.caughtUp'));
    const section = (title, items) => (items.length ? [h('div', { class: 'ou-subheader sp-subheader' }, title), h('div', { class: 'sp-card' }, items.map(item))] : []);
    lists.replaceChildren(...(open.length
      ? [...section(t('sp.rem.today'), today), ...section(t('sp.rem.upcoming'), later), ...section(t('sp.rem.noDate'), undated)]
      : [empty('checkCircle', t('sp.rem.empty'), t('sp.rem.emptyHint'))]));
  }
  draw();
  const off = store.on('reminders', draw);
  // overdue colours and "due today" change with the clock
  const tick = setInterval(draw, 60e3);
  setTimeout(() => input.focus(), 60);
  return () => {
    off();
    clearInterval(tick);
  };
}
