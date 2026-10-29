// Samsung Health › Daily activity: the day page (big rings, the week's mini rings, hourly charts for Focus, Tasks and
// Breaks), the Activity tab (a month calendar of rings, the month's totals, streaks, the monthly challenge, trends
// and awards), the Awards page and Set goals. The service worker keeps the log; pages only write healthPrefs.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate } from '../core/i18n.js';
import { menu, iconBtn, dialog, toast } from '../core/ui.js';
import { openApp } from '../core/apps.js';
import * as R from './rings.js';
import * as H from './data.js';
import * as F from './format.js';
import { ringsSVG, oneRingSVG } from './art.js';
import { badgeSVG } from './badges.js';
import { hourChart } from './charts.js';
import { section, pillBtn, stepper } from './kit.js';

const C = (k) => R.COLORS[k].c;
const whole = (v) => Math.floor(v + 1e-6);
const startFocus = (min) => import('../shell/quickpanel.js').then((m) => m.startFocus(min));

/** Set goals: the three rings' goals, from today on (past days keep the goals they had). */
export async function setGoals() {
  const g = H.prefs().goals;
  const st = {
    focus: stepper(g.focus, { min: R.GOALS.focus.min, max: R.GOALS.focus.max, step: R.GOALS.focus.step, fmt: (v) => t('health.rg.focusGoal', { g: F.num(v) }) }),
    done: stepper(g.done, { min: R.GOALS.done.min, max: R.GOALS.done.max, step: 1, fmt: (v) => t('health.rg.doneGoal', { g: F.num(v) }) }),
    breaks: stepper(g.breaks, { min: R.GOALS.breaks.min, max: R.GOALS.breaks.max, step: 1, fmt: (v) => t('health.rg.breaksGoal', { g: F.num(v) }) }),
  };
  const res = await dialog({
    title: t('health.goals.set'), className: 'hl-goals-dlg',
    content: h('div', { class: 'ou-dialog-body hl-goals' }, R.RINGS.map((k) => h('div', { class: 'hl-goal-row', 'data-ring': k },
      h('span', { class: 'hl-goal-ring', html: oneRingSVG(k, 0.75) }),
      h('span', { class: 'hl-goal-text' }, h('b', null, F.ringName(k)), h('small', null, t('health.goals.about.' + k))),
      st[k])), h('p', { class: 'hl-note' }, t('health.goals.fromToday'))),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: () => ({ focus: st.focus.value, done: st.done.value, breaks: st.breaks.value }) }],
  });
  if (!res) return;
  H.setPrefs((p) => R.withGoals(p, res));
  toast(t('health.goals.saved'));
}

// ——— the day page ———
export function openActivity(ctx, nav, day) {
  const today = R.dayKey();
  let k = typeof day === 'string' ? day : today;
  ctx.push({
    title: t('health.cards.activity'), hero: false, className: 'hl-page hl-act-page',
    actions: [iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('health.goals.set'), icon: 'hlTarget', onClick: setGoals },
      { label: t('health.activity.history'), icon: 'calendar', onClick: () => nav.tab('activity') },
    ], { align: 'end' }), t('common.more'))],
    render(body) {
      body.classList.add('hl-body');
      const draw = () => {
        const now = Date.now(), tk = R.dayKey(now), s = H.sources(now), det = R.dayDetail(k, s), r = det.rings;
        const ws = F.weekStart(), wk = R.weekOf(k, ws);
        body.replaceChildren(
          h('div', { class: 'hl-daynav' },
            h('button', { class: 'ou-icon-btn hl-prev', 'aria-label': t('health.prevDay'), html: icon('back', 22), onClick: () => { k = R.addDays(k, -1); draw(); } }),
            h('div', { class: 'hl-daynav-t' }, F.dayText(k, { weekday: 'long', month: 'long', day: 'numeric' })),
            h('button', { class: 'ou-icon-btn hl-next', 'aria-label': t('health.nextDay'), disabled: k >= tk, html: icon('forward', 22), onClick: () => { k = R.addDays(k, 1); draw(); } })),
          h('div', { class: 'hl-act-hero' },
            h('span', { class: 'hl-act-big', html: ringsSVG(r, { width: 10, gap: 3, label: R.RINGS.map((x) => `${F.ringName(x)} ${F.ringValue(x, r[x])}`).join(', ') }) }),
            h('div', { class: 'hl-act-stats' }, R.RINGS.map((x) => h('div', { class: 'hl-act-stat', 'data-ring': x },
              h('small', null, F.ringName(x)),
              h('div', null, h('b', { style: { color: C(x) } }, F.num(whole(r[x].v))), h('span', null, t('health.rg.' + x, { g: F.num(r[x].goal) }))))))),
          h('div', { class: 'hl-week' }, Array.from({ length: 7 }, (_, i) => {
            const dk = R.addDays(wk, i), future = dk > tk;
            return h('button', { class: ['hl-week-d', dk === k && 'sel', future && 'future'], disabled: future, 'aria-label': F.longDate(dk), onClick: () => { k = dk; draw(); } },
              h('small', null, fmtDate(R.keyDate(dk), { weekday: 'narrow' })),
              h('span', { html: future ? ringsSVG({}, { width: 14, gap: 3 }) : ringsSVG(R.ringsFor(dk, s), { width: 14, gap: 3 }) }));
          })),
          section(F.ringName('focus'), [
            h('div', { class: 'hl-sec-val' }, h('b', { style: { color: C('focus') } }, F.minText(r.focus.v)), h('span', null, F.tn('health.activity.sessions', det.sessions))),
            hourChart(det.focusH, C('focus')),
            k === tk ? h('div', { class: 'hl-sec-foot' }, h('span', { class: 'hl-sub' }, t('health.activity.focusAbout')), pillBtn(t('health.activity.startFocus'), () => { startFocus(); toast(t('health.activity.focusStarted')); }, { attrs: { 'data-start-focus': '' } })) : null,
          ], { cls: 'hl-ring-sec' }),
          section(F.ringName('done'), [
            h('div', { class: 'hl-sec-val' }, h('b', { style: { color: C('done') } }, F.tn('health.activity.tasks', whole(r.done.v)))),
            hourChart(det.doneH, C('done')),
            h('div', { class: 'hl-sec-foot' }, h('span', { class: 'hl-sub' }, t('health.activity.tasksAbout')), pillBtn(t('health.activity.openReminder'), () => openApp('reminder'))),
          ], { cls: 'hl-ring-sec' }),
          section(F.ringName('breaks'), [
            h('div', { class: 'hl-sec-val' }, h('b', { style: { color: C('breaks') } }, t('health.activity.hours', { n: F.num(r.breaks.v) })), det.active ? h('span', null, t('health.activity.atComputer', { time: F.durText(det.active) })) : null),
            hourChart(Array.from({ length: 24 }, (_, i) => (det.breakH.includes(i) ? 1 : 0)), C('breaks'), { dots: true }),
            h('div', { class: 'hl-sec-foot' }, h('span', { class: 'hl-sub' }, t('health.activity.breaksAbout'))),
          ], { cls: 'hl-ring-sec' }));
      };
      draw();
      const off = H.watch(H.RING_KEYS, draw), tick = setInterval(() => k === R.dayKey() && draw(), 30e3);
      return () => { off(); clearInterval(tick); };
    },
  });
}

// ——— awards ———
function awardsData(s = H.sources()) {
  const res = R.computeAwards(s, { weekStart: F.weekStart() });
  return { earned: R.mergeEarned(R.normLog(s.act).earned, res.earned), stats: res.stats };
}
function awardList(earned) {
  const months = Object.keys(earned).filter(R.isMonthAward).sort().reverse();
  return [...R.AWARDS.map((a) => a.id), ...months];
}
const monthOpts = (id) => { const m = /^month-(\d{4})-(\d\d)$/.exec(id); return m ? { month: { label: fmtDate(new Date(+m[1], +m[2] - 1, 1), { month: 'short' }), year: m[1] } } : {}; };
function awardDialog(id, days) {
  dialog({
    title: F.awardName(id), className: 'hl-award-dlg',
    content: h('div', { class: 'ou-dialog-body hl-award-big' },
      h('span', { html: badgeSVG(id, { locked: !days?.length, ...monthOpts(id) }) }),
      h('p', null, F.awardDesc(id)),
      days?.length ? h('p', { class: 'hl-sub' }, days.length > 1 ? t('health.aw.earnedTimes', { n: F.num(days.length), date: F.dateText(days.at(-1), { year: 'numeric', month: 'short', day: 'numeric' }) }) : t('health.aw.earnedOn', { date: F.dateText(days[0], { year: 'numeric', month: 'short', day: 'numeric' }) })) : h('p', { class: 'hl-sub' }, t('health.aw.notYet'))),
    actions: [{ label: t('common.ok'), value: true, primary: true }],
  });
}
export function awardGrid(earned, { limit, onlyEarned = false } = {}) {
  let ids = awardList(earned);
  if (onlyEarned) ids = ids.filter((id) => earned[id]?.length).sort((a, b) => (earned[b].at(-1) > earned[a].at(-1) ? 1 : -1));
  if (limit) ids = ids.slice(0, limit);
  return h('div', { class: 'hl-awards' }, ids.map((id) => {
    const days = earned[id];
    return h('button', { class: ['hl-award', !days?.length && 'locked'], 'data-award': id, onClick: () => awardDialog(id, days) },
      h('span', { class: 'hl-award-art', html: badgeSVG(id, { locked: !days?.length, ...monthOpts(id) }) }),
      h('span', { class: 'hl-award-name' }, F.awardName(id)),
      days?.length > 1 ? h('small', null, t('health.aw.times', { n: F.num(days.length) })) : days?.length ? h('small', null, F.dateText(days[0])) : null);
  }));
}
export function openAwards(ctx) {
  ctx.push({
    title: t('health.awards'), hero: false, className: 'hl-page',
    render(body) {
      body.classList.add('hl-body');
      const draw = () => {
        const { earned } = awardsData();
        const n = Object.values(earned).filter((d) => d?.length).length;
        body.replaceChildren(h('p', { class: 'hl-note' }, F.tn('health.aw.count', n)), section(null, awardGrid(earned)));
      };
      draw();
      return H.watch(H.RING_KEYS, draw);
    },
  });
}

// ——— the Activity tab ———
export function activityView(ctx, nav, tabs) {
  let month = R.monthKey(R.dayKey());
  ctx.page({
    title: t('health.tab.activity'), hero: false, className: 'hl-page hl-history-page',
    actions: [iconBtn('hlTarget', setGoals, t('health.goals.set'))],
    render(body, page) {
      page.el.appendChild(tabs);
      body.classList.add('hl-body');
      const draw = () => {
        const now = Date.now(), today = R.dayKey(now), s = H.sources(now);
        const first = R.firstDay(s, today);
        const all = R.series(s, first || today, today);
        const ws = F.weekStart();
        const mFirst = month + '-01', dim = R.daysInMonth(month), lead = (R.keyDate(mFirst).getDay() - ws + 7) % 7;
        const by = new Map(all.map((x) => [x.day, x]));
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'hl-cal-d blank' }));
        for (let i = 1; i <= dim; i++) {
          const k = `${month}-${String(i).padStart(2, '0')}`, x = by.get(k), future = k > today;
          cells.push(h('button', { class: ['hl-cal-d', k === today && 'today', future && 'future', x && R.allClosed(x.r) && 'full'], disabled: future, 'data-day': k, 'aria-label': F.longDate(k), onClick: () => openActivity(ctx, nav, k) },
            h('span', { class: 'hl-cal-rings', html: ringsSVG(future || !x ? {} : x.r, { width: 14, gap: 3 }) }),
            h('small', null, F.num(i))));
        }
        const inMonth = all.filter((x) => x.day.startsWith(month));
        const perfect = inMonth.filter((x) => R.allClosed(x.r)).length;
        const sum = (f) => inMonth.reduce((a, x) => a + f(x), 0);
        const { earned, stats } = awardsData(s);
        const ch = R.challengeFor(R.monthKey(today), s, all);
        const tr = R.trends(s);
        const canNext = month < R.monthKey(today);
        body.replaceChildren(
          section(null, [
            h('div', { class: 'hl-monthnav' },
              h('button', { class: 'ou-icon-btn', 'aria-label': t('health.prevMonth'), html: icon('back', 22), onClick: () => { month = R.addMonths(month, -1); draw(); } }),
              h('b', null, fmtDate(R.keyDate(mFirst), { month: 'long', year: 'numeric' })),
              h('button', { class: 'ou-icon-btn', 'aria-label': t('health.nextMonth'), disabled: !canNext, html: icon('forward', 22), onClick: () => { month = R.addMonths(month, 1); draw(); } })),
            h('div', { class: 'hl-cal-head' }, F.weekdays('narrow', ws).map(([, n]) => h('span', null, n))),
            h('div', { class: 'hl-cal' }, cells),
          ], { cls: 'hl-cal-sec' }),
          section(t('health.activity.monthSummary'), h('div', { class: 'hl-stats' },
            stat(t('health.activity.perfectDays'), F.num(perfect), '#1fbf83'),
            stat(t('health.activity.focusTotal'), F.durText(sum((x) => x.r.focus.v)), C('focus')),
            stat(t('health.activity.tasksTotal'), F.num(sum((x) => whole(x.r.done.v))), C('done')),
            stat(t('health.activity.breaksAvg'), inMonth.length ? t('health.activity.hoursShort', { n: F.num(sum((x) => x.r.breaks.v) / inMonth.length, 1) }) : '–', C('breaks')))),
          section(t('health.activity.streaks'), h('div', { class: 'hl-stats' },
            stat(t('health.activity.allStreak'), F.tn('health.activity.daysN', R.streakOf(all, today))),
            stat(t('health.activity.focusStreak'), F.tn('health.activity.daysN', stats.streak)),
            stat(t('health.activity.bestFocusStreak'), F.tn('health.activity.daysN', stats.bestStreak)),
            stat(t('health.activity.bestFocus'), F.minText(stats.bestFocus)))),
          section(t('health.activity.challenge'), h('div', { class: 'hl-challenge', 'data-done': ch.done ? '1' : null },
            h('span', { class: 'hl-ch-art', html: badgeSVG(ch.id, { locked: !ch.done, ...monthOpts(ch.id) }) }),
            h('div', { class: 'hl-ch-text' },
              h('b', null, F.awardName(ch.id)),
              h('small', null, t(ch.kind === 'closes' ? 'health.ch.closes' : 'health.ch.minutes', { n: F.num(ch.target) })),
              h('div', { class: 'hl-progress', style: { '--c': C('focus') } }, h('i', { style: { width: Math.min(100, (ch.progress / ch.target) * 100).toFixed(1) + '%' } })),
              h('small', null, ch.done ? t('health.ch.done') : t('health.ch.progress', { n: F.num(ch.progress), total: F.num(ch.target) }))))),
          section(t('health.trends'), tr.enough ? h('div', { class: 'hl-trends' }, R.TREND_METRICS.map((m) => {
            const x = tr.metrics[m], color = m === 'sessions' ? '#8a5cf6' : C(m);
            const val = (v) => (m === 'focus' ? F.minText(v) : m === 'breaks' ? t('health.activity.hoursShort', { n: F.num(v, 1) }) : F.num(v, 1));
            return h('div', { class: ['hl-trend', x.up ? 'up' : 'down'], 'data-metric': m },
              h('span', { class: 'hl-trend-arrow', style: { background: color }, html: icon('arrowUp', 18) }),
              h('div', null, h('b', null, m === 'sessions' ? t('health.activity.sessionsName') : F.ringName(m)), h('small', null, t('health.trend.perDay', { v: val(x.short), was: val(x.long) }))));
          })) : h('p', { class: 'hl-sub' }, F.tn('health.trend.notYet', Math.max(0, 28 - tr.days)))),
          section(t('health.awards'), awardGrid(earned, { limit: 4, onlyEarned: Object.values(earned).some((d) => d?.length) }), { action: h('button', { class: 'hl-link', onClick: () => openAwards(ctx) }, t('health.viewAll')) }));
      };
      const stat = (label, value, color) => h('div', { class: 'hl-stat' }, h('small', null, label), h('b', { style: color ? { color } : null }, value));
      draw();
      const off = H.watch(H.RING_KEYS, draw);
      return off;
    },
  });
}
