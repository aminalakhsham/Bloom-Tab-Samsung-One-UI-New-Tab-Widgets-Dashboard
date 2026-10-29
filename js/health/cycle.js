// Samsung Health › Cycle tracking: a month calendar with logged periods, predicted periods, the fertile window and
// ovulation (all worked out on this device), the selected day's period flow and symptoms, and cycle statistics.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate } from '../core/i18n.js';
import { menu, iconBtn, dialog, switchRow, list, sw } from '../core/ui.js';
import * as M from './model.js';
import * as H from './data.js';
import * as F from './format.js';
import { section, chips, cycleLine } from './kit.js';

/** Changes one day of the cycle log; an empty day is removed. */
export function setDay(k, patch) {
  H.mut((d) => {
    const x = { ...(d.cycle.days[k] || {}), ...patch };
    if (!x.flow) delete x.flow;
    if (!x.sym?.length) delete x.sym;
    if (Object.keys(x).length) d.cycle.days[k] = x; else delete d.cycle.days[k];
  });
}
/** Marks a day as a period day (or not). */
export const togglePeriod = (k, on) => setDay(k, { flow: on ? H.D().cycle.days[k]?.flow || 'unspecified' : undefined });

async function predictionSettings() {
  const c = H.D().cycle;
  let pp = c.predPeriod, pf = c.predFertile;
  const res = await dialog({
    title: t('health.cycle.predictions'),
    content: h('div', { class: 'ou-dialog-body hl-dlg-list' }, list(
      switchRow({ title: t('health.cycle.predPeriod'), checked: pp, onChange: (v) => (pp = v) }),
      switchRow({ title: t('health.cycle.predFertile'), checked: pf, onChange: (v) => (pf = v) }))),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: true }],
  });
  if (res) H.mut((d) => { d.cycle.predPeriod = pp; d.cycle.predFertile = pf; });
}

export function openCycle(ctx) {
  const today = M.dayKey();
  let sel = today, month = today.slice(0, 7);
  ctx.push({
    title: t('health.cards.cycle'), hero: false, className: 'hl-page hl-cycle-page',
    actions: [iconBtn('more', (e) => menu(e.currentTarget, [{ label: t('health.cycle.predictions'), icon: 'settings', onClick: predictionSettings }], { align: 'end' }), t('common.more'))],
    render(body) {
      body.classList.add('hl-body');
      const draw = () => {
        const d = H.D(), c = d.cycle, pred = M.predict(c, today), st = M.cycleStatus(c, today);
        const ws = F.weekStart(), first = month + '-01', dim = new Date(+month.slice(0, 4), +month.slice(5), 0).getDate();
        const lead = (M.keyDate(first).getDay() - ws + 7) % 7;
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'hl-cy-d blank' }));
        for (let i = 1; i <= dim; i++) {
          const k = `${month}-${String(i).padStart(2, '0')}`;
          cells.push(h('button', {
            class: ['hl-cy-d', M.cycleDayKind(c, pred, k, today), k === today && 'today', k === sel && 'sel'], 'data-day': k, 'aria-label': F.longDate(k), 'aria-pressed': String(k === sel),
            onClick: () => { sel = k; draw(); },
          }, h('span', null, F.num(i)), c.days[k]?.sym?.length ? h('i', { class: 'hl-cy-sym' }) : null));
        }
        const day = c.days[sel] || {}, isPeriod = M.FLOWS.includes(day.flow), future = sel > today;
        const pSwitch = sw(isPeriod, (v) => togglePeriod(sel, v), { label: t('health.cycle.period') });
        const shift = (n) => { const [y, m] = month.split('-').map(Number); const x = new Date(y, m - 1 + n, 1); month = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; draw(); };
        const stats = M.cycleStats(c.days), last = stats.periods.at(-1);
        body.replaceChildren(
          h('div', { class: 'hl-cy-hero' },
            h('span', { class: 'hl-cy-drop', html: icon('hlCycle', 30) }),
            h('div', null, h('b', { class: 'hl-cy-line' }, st ? cycleLine(st) : t('health.cycle.start')),
              h('div', { class: 'hl-sub' }, pred.next?.[0] && c.predPeriod ? t('health.cycle.nextOn', { date: F.dateText(pred.next[0].start, { weekday: 'short', month: 'short', day: 'numeric' }) }) : t('health.cycle.tapDay')))),
          section(null, [
            h('div', { class: 'hl-monthnav' },
              h('button', { class: 'ou-icon-btn', 'aria-label': t('health.prevMonth'), html: icon('back', 22), onClick: () => shift(-1) }),
              h('b', null, fmtDate(M.keyDate(first), { month: 'long', year: 'numeric' })),
              h('button', { class: 'ou-icon-btn', 'aria-label': t('health.nextMonth'), html: icon('forward', 22), onClick: () => shift(1) })),
            h('div', { class: 'hl-cal-head' }, F.weekdays('narrow', ws).map(([, n]) => h('span', null, n))),
            h('div', { class: 'hl-cy-cal' }, cells),
            h('div', { class: 'hl-cy-legend' }, ['period', 'predicted', 'fertile', 'ovulation'].map((x) => h('span', { class: 'hl-cy-lg ' + x }, h('i'), t('health.cycle.k.' + x)))),
          ], { cls: 'hl-cy-cal-sec' }),
          section(F.longDate(sel), [
            h('div', { class: 'ou-row hl-cy-prow' }, h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('health.cycle.period'))), future ? h('small', { class: 'hl-sub' }, t('health.cycle.future')) : pSwitch),
            isPeriod ? h('div', null, h('div', { class: 'hl-field-label' }, t('health.cycle.flow')), chips(['light', 'medium', 'heavy'].map((x) => ({ value: x, label: F.flowName(x) })), day.flow, (v) => setDay(sel, { flow: v }), { cls: 'hl-flow-chips' })) : null,
            future ? null : h('div', null, h('div', { class: 'hl-field-label' }, t('health.cycle.symptoms')), chips(M.SYMPTOMS.map((x) => ({ value: x, label: F.symptomName(x) })), day.sym || [], (v) => setDay(sel, { sym: v }), { multi: true, cls: 'hl-sym-chips' })),
          ], { cls: 'hl-cy-day' }),
          section(t('health.cycle.stats'), [
            h('div', { class: 'hl-kvrow' }, h('span', null, t('health.cycle.avgCycle')), h('b', null, stats.cycles ? F.tn('health.cycle.days', stats.cycleLen) : '–')),
            h('div', { class: 'hl-kvrow' }, h('span', null, t('health.cycle.avgPeriod')), h('b', null, stats.periods.length ? F.tn('health.cycle.days', stats.periodLen) : '–')),
            h('div', { class: 'hl-kvrow' }, h('span', null, t('health.cycle.lastStart')), h('b', null, last ? F.dateText(last.start, { month: 'short', day: 'numeric', year: 'numeric' }) : '–')),
            stats.varies ? h('p', { class: 'hl-note' }, t('health.cycle.varies')) : null,
            h('p', { class: 'hl-note' }, t('health.cycle.disclaimer')),
          ]));
      };
      draw();
      return H.watch([M.KEY], draw);
    },
  });
}
