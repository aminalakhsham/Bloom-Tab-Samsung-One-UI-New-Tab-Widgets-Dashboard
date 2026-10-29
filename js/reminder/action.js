// Modes and Routines › "Add reminder": the app's own version of the action (it replaces the built-in one from
// js/routines/actions.js, same id and parameters `title` / `in`, so saved routines keep working) with a natural time
// ("tomorrow 6pm", "every Monday"), a category and Important. js/apps/reminder.js registers it in the pages with the
// app's addReminder(); js/bg/reminder.js registers it in the service worker, where it writes storage through ctx.
// SW-safe: no DOM, no page modules.
import { registerAction, RunError, toNumber } from '../routines/actions.js';
import { addStrings } from '../core/i18n.js';
import * as M from './model.js';
import { parseQuickTime } from './parse.js';

/** add(fields) → reminder: the page's writer (alarms included); without it the action writes through ctx. */
export function registerReminderAction(add = null) {
  registerAction({
    id: 'reminder.add', name: 'routines.a.reminder', icon: 'checkCircle', color: '#2b7cf0', cat: 'apps', sw: true, out: 'routines.out.reminder',
    params: [
      { key: 'title', type: 'text', label: 'routines.p.remTitle', input: true, ph: 'routines.p.remTitle' },
      { key: 'when', type: 'text', label: 'rem.act.when', ph: 'rem.act.whenPh' },
      { key: 'in', type: 'number', label: 'routines.p.remIn', def: '' },
      { key: 'cat', type: 'text', label: 'rem.act.cat', ph: 'rem.cat.default' },
      { key: 'important', type: 'bool', label: 'rem.important', def: false },
    ],
    sub: (p, F) => F.text(p.title),
    async run(ctx, p) {
      let title = String(p.title ?? '').trim();
      if (!title) throw new RunError('routines.err.empty');
      const now = Date.now();
      const cats = M.normCats(await ctx.get(M.CAT_KEY));
      const fields = { priority: p.important === true || p.important === 'true' };
      const want = String(p.cat || '').trim().toLocaleLowerCase();
      const cat = want && cats.list.find((c) => (c.name || '').trim().toLocaleLowerCase() === want);
      if (cat) fields.cat = cat.id;
      const mins = toNumber(p.in);
      if (mins > 0) fields.due = now + mins * 60e3;
      else {
        // a time written in its own field, else one written in the title ("Call Sam tomorrow at 6")
        const when = String(p.when ?? '').trim();
        const q = parseQuickTime(when || title, new Date(now), { cats: cats.list });
        if (q.due || q.repeat) {
          fields.due = q.due;
          if (q.repeat) fields.repeat = q.repeat;
          if (!when) title = q.title || title;
        }
      }
      fields.title = title;
      if (add) return add(fields)?.title || title;
      const r = M.make(fields, now);
      await ctx.set(M.KEY, [r, ...M.items(await ctx.get(M.KEY))]);
      for (const [name, at] of M.alarmPlan(r, now)) ctx.schedule(name, at);
      return r.title;
    },
  });
}

addStrings({
  en: { 'rem.act.when': 'When', 'rem.act.whenPh': 'e.g. tomorrow 6pm, every Monday', 'rem.act.cat': 'Category' },
  ar: { 'rem.act.when': 'الموعد', 'rem.act.whenPh': 'مثل: غدًا 6 مساءً، كل يوم اثنين', 'rem.act.cat': 'الفئة' },
});
