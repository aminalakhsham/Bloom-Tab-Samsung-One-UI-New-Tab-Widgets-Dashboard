// Note templates (list ⋮ › New note from template), written in the UI language when they are created.
import { t, fmtDate, weekdayNames } from '../core/i18n.js';
import { escapeHtml as e } from '../core/util.js';

export function templates() {
  const days = weekdayNames('long');
  // the week from Monday, as Samsung's planners start it
  const week = [...days.slice(1), days[0]];
  return [
    {
      id: 'meeting',
      name: t('notes.tpl.meeting'),
      sub: t('notes.tpl.meetingSub'),
      title: t('notes.tpl.meeting'),
      body: `<h3>${e(t('notes.tpl.date'))}</h3><div>${e(fmtDate(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</div>`
        + `<h3>${e(t('notes.tpl.attendees'))}</h3><ul><li><br></li></ul>`
        + `<h3>${e(t('notes.tpl.agenda'))}</h3><ol><li><br></li></ol>`
        + `<h3>${e(t('notes.tpl.actions'))}</h3><ul class="checklist"><li><br></li></ul>`,
    },
    {
      id: 'todo',
      name: t('notes.tpl.todo'),
      sub: t('notes.tpl.todoSub'),
      title: t('notes.tpl.todo'),
      paper: 'lined',
      body: '<ul class="checklist"><li><br></li></ul>',
    },
    {
      id: 'week',
      name: t('notes.tpl.week'),
      sub: t('notes.tpl.weekSub'),
      title: t('notes.tpl.week'),
      body: `<table><tbody>${week.map((d) => `<tr><td><b>${e(d)}</b></td><td><br></td></tr>`).join('')}</tbody></table><div><br></div>`,
    },
    {
      id: 'diary',
      name: t('notes.tpl.diary'),
      sub: t('notes.tpl.diarySub'),
      title: fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }),
      paper: 'lined',
      body: `<h3>${e(t('notes.tpl.grateful'))}</h3><ul><li><br></li></ul><h3>${e(t('notes.tpl.today'))}</h3><div><br></div>`,
    },
  ];
}
