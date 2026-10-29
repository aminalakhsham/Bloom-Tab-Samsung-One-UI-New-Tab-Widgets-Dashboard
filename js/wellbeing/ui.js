// Digital Wellbeing screens, laid out like Samsung's app on One UI: the dashboard (today's donut, Screen time /
// Notifications received / Unlocks, most used sites with their timer, this week's bars with the goal line), Screen time
// details by day or week, a site's page, Site timers (per site or category, per-day schedules), Focus modes (Work time,
// Me time, your own), Bedtime mode, the screen time goal and the Weekly report. Loaded when the app opens.
// Reads `wellbeing` and `wellbeingUsage`; writes only `wellbeing` (the service worker owns the usage, js/bg/wellbeing.js).
import { h, uid, debounce, clamp, pad2, everyMinute, toUrl, hostname } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, fmtDate, fmtTime, fmtPeriod, weekdayNames, locale, use12h } from '../core/i18n.js';
import { store } from '../core/store.js';
import { toast, menu, dialog, confirm, prompt, choose, seg, row, switchRow, list, subheader, iconBtn } from '../core/ui.js';
import { has, ensure, drop } from '../core/perm.js';
import { stopFocus } from '../shell/quickpanel.js';
import * as M from './model.js';
import { CATS, CAT_IDS, siteOf, categoryOf, defaultCategoryOf } from './categories.js';
import { prefs, usage, savePrefs, dur, modeName, siteIcon, donutEl, donutSvg, siteSlices, PALETTE, OTHER, weekStart } from './common.js';
import './strings.js';

const isExt = !!globalThis.chrome?.runtime?.id;
const catName = (c) => t('wellbeing.cat.' + (CATS[c] ? c : 'other'));
const catColor = (c) => (CATS[c] || CATS.other).color;
const catIcon = (c) => (CATS[c] || CATS.other).icon;
const catFn = (w) => (s) => categoryOf(s, w.cats);
const num = (n) => new Intl.NumberFormat(locale()).format(n || 0);
const pct = (x) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(x);
const hm = (hhmm) => { const m = M.toMin(hhmm); return fmtTime(new Date(2024, 0, 1, Math.floor(m / 60), m % 60)); };
const hourLabel = (hr) => new Intl.DateTimeFormat(locale(), { hour: 'numeric', hour12: use12h() }).format(new Date(2024, 0, 1, hr));
const weekOrder = () => Array.from({ length: 7 }, (_, i) => (weekStart() + i) % 7);

/** Redraws on any change to the choices, the usage (every minute while browsing) or the shell's Focus, and each minute. */
function live(draw) {
  const d = debounce(draw, 200);
  const offs = [store.on('wellbeing', d), store.on('wellbeingUsage', d), store.on('focus', d), everyMinute(() => d())];
  draw();
  return () => offs.forEach((f) => f());
}

function dayLabel(d) {
  const k = M.dayKey(d);
  if (k === M.dayKey(new Date())) return t('common.today');
  if (k === M.dayKey(M.addDays(new Date(), -1))) return t('common.yesterday');
  return fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
}
function weekLabel(start) {
  if (M.dayKey(start) === M.dayKey(M.weekStartOf(new Date(), weekStart()))) return t('wellbeing.thisWeek');
  return `${fmtDate(start, { month: 'short', day: 'numeric' })} – ${fmtDate(M.addDays(start, 6), { month: 'short', day: 'numeric' })}`;
}

// ------------------------------------------------------------------ entry
export function render(ctx) {
  const show = () => (prefs().setup ? dashboard(ctx) : welcome(ctx, show));
  ctx.setParams = (p) => p?.section && prefs().setup && openSection(ctx, p.section);
  show();
  if (ctx.params.section && prefs().setup) openSection(ctx, ctx.params.section);
}

/** Notification clicks, widgets and Finder open a screen: report, timers, goal, focus, bedtime, detail, site:<site>. */
function openSection(ctx, sec) {
  while (ctx.depth > 1) ctx.pop();
  if (sec === 'report') reportPage(ctx);
  else if (sec === 'timers') timersPage(ctx);
  else if (sec === 'goal') goalDialog();
  else if (sec === 'focus') focusPage(ctx);
  else if (sec === 'bedtime') bedtimePage(ctx);
  else if (sec === 'detail') detailPage(ctx);
  else if (sec.startsWith('site:')) sitePage(ctx, sec.slice(5));
}

async function askTabs() {
  if (!(await ensure('tabs'))) toast(t('wellbeing.perm.denied'));
}

// ------------------------------------------------------------------ first run
function welcome(ctx, done) {
  ctx.page({
    title: t('app.wellbeing'),
    hero: false,
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-welcome');
      const art = [0.34, 0.22, 0.16, 0.12, 0.16].map((x, i) => ({ sec: x, color: i < 4 ? PALETTE[i] : OTHER }));
      const point = (ic, bg, title, text) => h('div', { class: 'wb-point' }, h('span', { class: 'wb-point-ico', style: { background: bg }, html: icon(ic, 20) }), h('div', null, h('b', null, title), h('p', null, text)));
      body.append(
        h('div', { class: 'wb-welcome-art', html: donutSvg(art, { size: 160, stroke: 18, gap: 4 }) }),
        h('h2', { class: 'wb-welcome-title' }, t('app.wellbeing')),
        h('p', { class: 'wb-welcome-text' }, t('wellbeing.welcome.text')),
        h('div', { class: 'wb-points' },
          point('hourglass', '#3e7bfa', t('wellbeing.screenTime'), t('wellbeing.welcome.p1')),
          point('timer', '#ff8a3d', t('wellbeing.timers'), t('wellbeing.welcome.p2')),
          point('wbLeaf', '#2fb36b', t('wellbeing.focusModes'), t('wellbeing.welcome.p3')),
          point('bedtime', '#5a5fd6', t('wellbeing.bedtime'), t('wellbeing.welcome.p4'))),
        h('p', { class: 'wb-welcome-privacy' }, h('span', { html: icon('lock', 16) }), t('wellbeing.privacy')),
        h('div', { class: 'wb-welcome-btns' },
          h('button', {
            class: 'ou-btn primary wb-start',
            onClick: async () => {
              // ask inside the click (Chrome needs the gesture), and show the dashboard right away whatever the answer
              const asked = ensure('tabs');
              savePrefs({ setup: true });
              done();
              if (!(await asked)) toast(t('wellbeing.perm.denied'));
            },
          }, t('wellbeing.getStarted'))));
    },
  });
}

// ------------------------------------------------------------------ dashboard
function dashboard(ctx) {
  let split = 'sites', tabsOK = null;
  ctx.page({
    title: t('app.wellbeing'),
    className: 'wb-page wb-main',
    actions: [iconBtn('more', (e) => mainMenu(e.currentTarget), t('common.more'))],
    render(body) {
      body.classList.add('wb-body');
      const draw = () => {
        const w = prefs(), u = usage(), catOf = catFn(w);
        const p = M.period(u, { mode: 'day', catOf }), wk = M.period(u, { mode: 'week', ws: weekStart(), catOf });
        body.replaceChildren(h('div', { class: 'wb-dash' },
          h('div', { class: 'wb-col' }, banners(ctx, w), tabsOK === false ? permCard() : null, dashCard(ctx, p, split, (v) => { split = v; draw(); }), weekCard(ctx, wk, w)),
          h('div', { class: 'wb-col' }, mostUsed(ctx, p, w), goalsCard(p, w), disconnect(ctx, w), tools(ctx, w), h('p', { class: 'wb-foot' }, t('wellbeing.privacy')))));
      };
      const perm = () => has('tabs').then((v) => {
        if (v !== tabsOK) {
          tabsOK = v;
          draw();
        }
      });
      perm();
      const offs = [live(draw)];
      if (isExt && chrome.permissions?.onAdded) {
        chrome.permissions.onAdded.addListener(perm);
        chrome.permissions.onRemoved.addListener(perm);
        offs.push(() => {
          chrome.permissions.onAdded.removeListener(perm);
          chrome.permissions.onRemoved.removeListener(perm);
        });
      }
      return () => offs.forEach((f) => f());
    },
  });
}

async function mainMenu(at) {
  const w = prefs(), tabs = await has('tabs');
  menu(at, [
    { label: t('wellbeing.report'), icon: 'wbReport', onClick: () => import('../core/apps.js').then((m) => m.openApp('wellbeing', { params: { section: 'report' } })) },
    { label: t('wellbeing.reportNotif'), icon: 'bell', checked: w.report, onClick: () => savePrefs({ report: !w.report }) },
    '-',
    tabs
      ? { label: t('wellbeing.stopCounting'), icon: 'wbBlock', onClick: async () => {
        if (await confirm(t('wellbeing.stopCounting'), t('wellbeing.stopCountingMsg'), { okLabel: t('wellbeing.stop') })) await drop('tabs');
      } }
      : { label: t('wellbeing.perm.allow'), icon: 'tab', onClick: askTabs },
    { label: t('wellbeing.clear'), icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirm(t('wellbeing.clear'), t('wellbeing.clearMsg'), { okLabel: t('common.delete'), danger: true }))) return;
      if (isExt) await chrome.runtime.sendMessage({ type: 'wb:clear' }).catch(() => {});
      toast(t('wellbeing.cleared'));
    } },
  ], { align: 'end' });
}

function banner({ cls, color, ic, title, sub, action, onAction, onClick }) {
  return h('div', { class: ['wb-banner', cls], style: color ? { '--mc': color } : null, role: onClick ? 'button' : null, tabindex: onClick ? 0 : null, onClick },
    h('span', { class: 'wb-banner-ico', html: icon(ic, 22) }),
    h('div', { class: 'wb-banner-text' }, h('b', null, title), h('span', null, sub)),
    h('button', { class: 'wb-banner-btn', onClick: (e) => { e.stopPropagation(); onAction(); } }, action));
}

function modeStatus(w) {
  const f = w.focus, now = Date.now();
  if (f.endsAt) return t('wellbeing.minLeft', { n: Math.max(1, Math.ceil((f.endsAt - now) / 60e3)) });
  return now - f.startedAt < 60e3 ? t('wellbeing.justStarted') : t('wellbeing.onFor', { t: dur((now - f.startedAt) / 1000) });
}

function banners(ctx, w) {
  const out = [], mode = M.activeMode(w), focus = store.get('focus'), bt = M.bedtimeAt(w.bedtime);
  if (mode) {
    out.push(banner({ cls: 'mode', color: mode.color, ic: mode.icon, title: t('wellbeing.modeIsOn', { name: modeName(mode) }), sub: modeStatus(w), action: t('wellbeing.end'), onAction: endMode, onClick: () => modePage(ctx, mode.id) }));
  } else if (w.focusSessions && M.sessionOn(focus)) {
    out.push(banner({ cls: 'mode', color: '#8a5cf6', ic: 'dnd', title: t('wellbeing.sessionOn'), sub: focus.endsAt == null ? modeStatus({ focus }) : t('wellbeing.minLeft', { n: Math.ceil((focus.endsAt - Date.now()) / 60e3) }), action: t('wellbeing.end'), onAction: () => stopFocus(), onClick: () => focusPage(ctx) }));
  }
  if (bt.active) {
    out.push(banner({ cls: 'bed', ic: 'bedtime', title: t('wellbeing.bedOn'), sub: t('wellbeing.until', { time: fmtTime(new Date(bt.until)) }), action: t('wellbeing.turnOff'), onAction: toggleBed, onClick: () => bedtimePage(ctx) }));
  }
  return out;
}

function permCard() {
  return h('section', { class: 'ou-card wb-perm' },
    h('div', { class: 'wb-perm-top' },
      h('span', { class: 'wb-perm-ico', html: icon('tab', 22) }),
      h('div', { class: 'wb-perm-text' }, h('b', null, t('wellbeing.perm.title')), h('p', null, t('wellbeing.perm.text')))),
    h('div', { class: 'wb-perm-btns' }, h('button', { class: 'wb-textbtn', onClick: askTabs }, t('wellbeing.perm.allow'))));
}

const stat = (label, value) => h('div', { class: 'wb-stat' }, h('span', { class: 'wb-stat-label' }, label), h('b', { class: 'wb-stat-val' }, value));

function legend(slices, nameOf) {
  return h('div', { class: 'wb-legend' }, slices.map((s) => h('span', { class: 'wb-leg' }, h('i', { style: { background: s.color } }), h('bdi', null, s.key ? nameOf(s.key) : t('wellbeing.other')))));
}

function dashCard(ctx, p, split, setSplit) {
  const slices = split === 'cats' ? M.slices(p.cats, 5).map((s) => ({ ...s, color: s.key ? catColor(s.key) : OTHER })) : siteSlices(p);
  const ring = donutEl(slices, { center: dur(p.total), label: t('wellbeing.today'), size: 220, stroke: 22, cls: 'wb-dash-donut' });
  ring.setAttribute('role', 'button');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', t('wellbeing.screenTime'));
  ring.addEventListener('click', () => detailPage(ctx));
  ring.addEventListener('keydown', (e) => e.key === 'Enter' && detailPage(ctx));
  const sw = seg([{ value: 'sites', label: t('wellbeing.sites') }, { value: 'cats', label: t('wellbeing.categories') }], split, setSplit);
  sw.classList.add('wb-mini-seg');
  return h('section', { class: 'ou-card wb-card wb-dashcard' },
    h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })), sw),
    ring,
    slices.length ? legend(slices, split === 'cats' ? catName : (k) => k) : h('div', { class: 'wb-hint' }, t('wellbeing.noData')),
    h('div', { class: 'wb-stats' }, stat(t('wellbeing.screenTime'), dur(p.total, 'short')), stat(t('wellbeing.notifs'), num(p.n)), stat(t('wellbeing.unlocks'), num(p.u))));
}

function timerBtn(tm, onClick) {
  const mins = tm && tm.on !== false ? M.timerMinutes(tm, Date.now()) : 0;
  return h('button', {
    class: ['wb-tbtn', tm && 'set'],
    title: t('wellbeing.setTimer'),
    'aria-label': t('wellbeing.setTimer'),
    onClick: (e) => {
      e.stopPropagation();
      onClick();
    },
  }, h('span', { html: icon('hourglass', 20) }), tm ? h('span', { class: 'wb-tbtn-val' }, mins ? dur(mins * 60, 'short') : t('common.off')) : null);
}

/** A site in a list: icon, name, time, a bar in its chart colour and the timer button (Samsung's app list). */
function siteRow(ctx, site, sec, max, color, w) {
  const tm = w.timers.find((x) => x.kind === 'site' && x.target === site);
  return h('div', { class: 'wb-site', role: 'button', tabindex: 0, dataset: { site }, onClick: () => sitePage(ctx, site), onKeydown: (e) => e.key === 'Enter' && sitePage(ctx, site) },
    siteIcon(site),
    h('div', { class: 'wb-site-main' },
      h('div', { class: 'wb-site-top' }, h('bdi', { class: 'wb-site-name' }, site), h('span', { class: 'wb-site-time' }, dur(sec))),
      h('div', { class: 'wb-site-bar' }, h('i', { style: { width: Math.max(2, (sec / max) * 100).toFixed(1) + '%', background: color } }))),
    timerBtn(tm, () => timerDialog({ kind: 'site', target: site })));
}

function catRow(c, sec, max, w) {
  const tm = w.timers.find((x) => x.kind === 'cat' && x.target === c);
  const open = () => timerDialog({ kind: 'cat', target: c });
  return h('div', { class: 'wb-site wb-catrow', role: 'button', tabindex: 0, dataset: { cat: c }, onClick: open, onKeydown: (e) => e.key === 'Enter' && open() },
    h('span', { class: 'wb-cico', style: { background: catColor(c) }, html: icon(catIcon(c), 20) }),
    h('div', { class: 'wb-site-main' },
      h('div', { class: 'wb-site-top' }, h('span', { class: 'wb-site-name' }, catName(c)), h('span', { class: 'wb-site-time' }, dur(sec))),
      h('div', { class: 'wb-site-bar' }, h('i', { style: { width: Math.max(2, (sec / max) * 100).toFixed(1) + '%', background: catColor(c) } }))),
    timerBtn(tm, open));
}

function mostUsed(ctx, p, w) {
  const top = p.sites.slice(0, 5), max = top[0]?.[1] || 1;
  return h('section', { class: 'ou-card wb-card wb-most' },
    h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, t('wellbeing.mostUsed')), p.sites.length ? h('button', { class: 'wb-textbtn', onClick: () => detailPage(ctx) }, t('wellbeing.seeAll')) : null),
    top.length ? top.map(([site, sec], i) => siteRow(ctx, site, sec, max, i < 4 ? PALETTE[i] : OTHER, w)) : h('div', { class: 'wb-hint' }, t('wellbeing.noSites')));
}

function changeEl(p) {
  if (p.change == null || !isFinite(p.change) || Math.round(Math.abs(p.change) * 100) === 0) return null;
  const down = p.change < 0, v = pct(Math.abs(p.change));
  // this week is compared with "last week"; an earlier week with "the week before"
  const cur = M.dayKey(p.start) === M.dayKey(M.weekStartOf(new Date(), weekStart()));
  const key = p.mode === 'day' ? (down ? 'wellbeing.belowAvg' : 'wellbeing.aboveAvg') : cur ? (down ? 'wellbeing.lessThanLast' : 'wellbeing.moreThanLast') : down ? 'wellbeing.lessThanBefore' : 'wellbeing.moreThanBefore';
  const text = t(key, { p: v });
  return h('span', { class: ['wb-chg', down ? 'down' : 'up'] }, h('span', { class: 'wb-chg-ico', html: icon('arrowUp', 14) }), text);
}

/**
 * Bars for a day (24 hours) or a week (7 days, today in Samsung blue, the rest lighter), with the scale on the trailing
 * side and, for a week, the dashed screen time goal line.
 */
function barsChart(p, { goal = 0 } = {}) {
  const day = p.mode === 'day', goalSec = day ? 0 : goal * 60, now = new Date(), tk = M.dayKey(now);
  const top = M.axisMax(Math.max(0, ...p.bars.map((b) => b.total), goalSec));
  const cols = p.bars.map((b, i) => {
    let label, cur, future;
    if (day) {
      label = i % 6 === 0 ? hourLabel(i) : '';
      cur = M.dayKey(p.start) === tk && now.getHours() === i;
      future = p.start > now || (M.dayKey(p.start) === tk && i > now.getHours());
    } else {
      const d = M.addDays(p.start, i);
      label = fmtDate(d, { weekday: 'narrow' });
      cur = M.dayKey(d) === tk;
      future = d > now;
    }
    const hp = b.total > 0 ? Math.max(2, Math.min(100, (b.total / top) * 100)) : 0;
    return h('div', { class: ['wb-colm', cur && 'now', future && 'future', goalSec && b.total > goalSec && 'over'], title: b.total ? dur(b.total) : null },
      h('div', { class: 'wb-bar-wrap' }, h('div', { class: 'wb-bar', style: { height: hp.toFixed(2) + '%' } })),
      h('span', { class: 'wb-x' }, label));
  });
  const grid = [top, top / 2, 0].map((v) => h('i', { style: { bottom: ((v / top) * 100).toFixed(2) + '%' } }, h('span', null, v ? dur(v, 'short') : '0')));
  const goalLine = goalSec ? h('div', { class: 'wb-goal-line', style: { bottom: Math.min(100, (goalSec / top) * 100).toFixed(2) + '%' } }, h('span', null, t('wellbeing.goalShort', { t: dur(goalSec, 'short') }))) : null;
  return h('div', { class: ['wb-chart', day ? 'day' : 'week'] },
    h('div', { class: 'wb-area' }, h('div', { class: 'wb-grid' }, grid), goalLine),
    h('div', { class: 'wb-bars' }, cols));
}

function weekCard(ctx, wk, w) {
  return h('section', { class: 'ou-card wb-card wb-week' },
    h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, t('wellbeing.thisWeek')), h('button', { class: 'wb-textbtn', onClick: () => detailPage(ctx, 'week') }, t('wellbeing.details'))),
    h('div', { class: 'wb-avg' }, h('span', { class: 'wb-avg-label' }, t('wellbeing.dailyAvg')), h('b', { class: 'wb-avg-val' }, dur(wk.avg)), changeEl(wk)),
    barsChart(wk, { goal: w.goal }));
}

function goalsCard(p, w) {
  const goal = w.goal * 60;
  if (!goal) return h('div', { class: 'wb-group' }, subheader(t('wellbeing.goals')), list(row({ icon: 'wbGoal', iconBg: '#3e7bfa', title: t('wellbeing.goal'), sub: t('wellbeing.goalSetSub'), className: 'muted-sub wb-goal-row', onClick: goalDialog })));
  const f = Math.min(1, p.total / goal), over = p.total >= goal;
  return h('div', { class: 'wb-group' }, subheader(t('wellbeing.goals')),
    h('div', { class: 'ou-card ou-list' },
      h('button', { class: ['ou-row', 'clickable', 'wb-goal-row', over && 'over'], onClick: goalDialog },
        h('span', { class: 'ou-row-ico', style: { background: '#3e7bfa', color: '#fff' }, html: icon('wbGoal', 20) }),
        h('span', { class: 'ou-row-text' },
          h('span', { class: 'ou-row-title' }, t('wellbeing.goal')),
          h('span', { class: 'ou-row-sub muted' }, t('wellbeing.goalOf', { t: dur(p.total), g: dur(goal) })),
          h('span', { class: 'wb-goal-bar' }, h('i', { style: { width: (f * 100).toFixed(1) + '%' } }))),
        h('span', { class: 'wb-goal-pct' }, pct(p.total / goal)))));
}

function bedSub(w) {
  const bt = w.bedtime, st = M.bedtimeAt(bt);
  if (st.active) return t('wellbeing.until', { time: fmtTime(new Date(st.until)) });
  if (!bt.on) return t('common.off');
  return `${hm(bt.from)} – ${hm(bt.to)}`;
}

function disconnect(ctx, w) {
  const mode = M.activeMode(w), bt = M.bedtimeAt(w.bedtime);
  return h('div', { class: 'wb-group' }, subheader(t('wellbeing.disconnect')), list(
    row({ icon: 'wbLeaf', iconBg: '#2fb36b', title: t('wellbeing.focusModes'), sub: mode ? t('wellbeing.modeIsOn', { name: modeName(mode) }) : t('wellbeing.focusModesSub'), className: mode ? '' : 'muted-sub', onClick: () => focusPage(ctx) }),
    row({ icon: 'bedtime', iconBg: '#5a5fd6', title: t('wellbeing.bedtime'), sub: bedSub(w), className: bt.active || w.bedtime.on ? '' : 'muted-sub', onClick: () => bedtimePage(ctx) })));
}

function tools(ctx, w) {
  const n = w.timers.filter((x) => x.on !== false).length;
  const last = M.addDays(M.weekStartOf(new Date(), weekStart()), -7);
  return list(
    row({ icon: 'hourglass', iconBg: '#ff8a3d', title: t('wellbeing.timers'), sub: n ? t(n === 1 ? 'wellbeing.timers1' : 'wellbeing.timersN', { n }) : t('wellbeing.timersSub'), className: n ? '' : 'muted-sub', onClick: () => timersPage(ctx) }),
    row({ icon: 'wbReport', iconBg: '#3e7bfa', title: t('wellbeing.report'), sub: weekLabel(last), className: 'muted-sub', onClick: () => reportPage(ctx) }));
}

// ------------------------------------------------------------------ Screen time details
function nav(label, canPrev, canNext, step) {
  const b = (ic, d, ok, title) => {
    const x = iconBtn(ic, () => step(d), title);
    x.disabled = !ok;
    x.classList.add('wb-nav-btn');
    return x;
  };
  return h('div', { class: 'wb-nav' }, b('back', -1, canPrev, t('wellbeing.prev')), h('span', { class: 'wb-nav-label' }, label), b('forward', 1, canNext, t('wellbeing.next')));
}

function detailPage(ctx, startMode = 'day') {
  let mode = startMode, offset = 0, split = 'sites';
  ctx.push({
    title: t('wellbeing.screenTime'),
    hero: false,
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), u = usage(), catOf = catFn(w), p = M.period(u, { mode, offset, ws: weekStart(), catOf });
        const prev = M.addDays(p.start, -1) >= M.startOfDay(p.oldest);
        const modeSeg = seg([{ value: 'day', label: t('wellbeing.day') }, { value: 'week', label: t('wellbeing.week') }], mode, (v) => { mode = v; offset = 0; draw(); });
        const splitSeg = seg([{ value: 'sites', label: t('wellbeing.sites') }, { value: 'cats', label: t('wellbeing.categories') }], split, (v) => { split = v; draw(); });
        splitSeg.classList.add('wb-mini-seg');
        const items = split === 'cats' ? p.cats : p.sites, max = items[0]?.[1] || 1;
        const slices = split === 'cats' ? null : Object.fromEntries(p.sites.slice(0, 4).map(([s], i) => [s, PALETTE[i]]));
        body.replaceChildren(
          modeSeg,
          h('section', { class: 'ou-card wb-card wb-detail' },
            nav(mode === 'day' ? dayLabel(p.start) : weekLabel(p.start), prev, offset < 0, (d) => { offset += d; draw(); }),
            h('div', { class: 'wb-big' }, dur(mode === 'day' ? p.total : p.avg)),
            h('div', { class: 'wb-big-sub' }, mode === 'week' ? h('span', null, t('wellbeing.dailyAvg')) : null, changeEl(p)),
            barsChart(p, { goal: w.goal }),
            h('div', { class: 'wb-stats' }, stat(t('wellbeing.notifs'), num(p.n)), stat(t('wellbeing.unlocks'), num(p.u)))),
          h('section', { class: 'ou-card wb-card wb-most' },
            h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, t('wellbeing.mostUsed')), splitSeg),
            items.length
              ? items.map(([k, sec]) => (split === 'cats' ? catRow(k, sec, max, w) : siteRow(ctx, k, sec, max, slices[k] || OTHER, w)))
              : h('div', { class: 'wb-hint' }, t('wellbeing.noSites'))));
      };
      return live(draw);
    },
  });
}

// ------------------------------------------------------------------ a site's page
async function pickCategory(site) {
  const w = prefs(), cur = categoryOf(site, w.cats);
  const c = await choose(t('wellbeing.category'), CAT_IDS.map((id) => ({ value: id, label: catName(id) })), cur);
  if (!c || c === cur) return;
  savePrefs((x) => {
    const cats = { ...x.cats };
    if (c === defaultCategoryOf(site)) delete cats[site];
    else cats[site] = c;
    return { cats };
  });
}

function sitePage(ctx, site) {
  let offset = 0;
  ctx.push({
    title: site,
    hero: false,
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), u = usage(), catOf = catFn(w), c = catOf(site), only = { site };
        const wk = M.period(u, { mode: 'week', offset, ws: weekStart(), catOf, only });
        const td = M.period(u, { mode: 'day', catOf, only });
        const tm = w.timers.find((x) => x.kind === 'site' && x.target === site);
        const ctm = w.timers.find((x) => x.kind === 'cat' && x.target === c);
        const prev = M.addDays(wk.start, -1) >= M.startOfDay(wk.oldest);
        body.replaceChildren(
          h('div', { class: 'wb-site-hero' }, siteIcon(site, 'big'), h('h2', null, h('bdi', null, site)), h('span', { class: 'wb-cat-chip', style: { '--c': catColor(c) } }, catName(c))),
          h('section', { class: 'ou-card wb-card' },
            nav(weekLabel(wk.start), prev, offset < 0, (d) => { offset += d; draw(); }),
            h('div', { class: 'wb-stats wb-stats-2' }, stat(t('common.today'), dur(td.total)), stat(t('wellbeing.dailyAvg'), dur(wk.avg))),
            barsChart(wk, {})),
          list(
            row({ icon: 'hourglass', iconBg: '#ff8a3d', title: t('wellbeing.siteTimer'), sub: tm ? timerSub(tm) : ctm ? t('wellbeing.inCatTimer', { name: catName(c) }) : t('wellbeing.noTimer'), className: tm ? '' : 'muted-sub', onClick: () => timerDialog({ kind: 'site', target: site }) }),
            row({ icon: catIcon(c), iconBg: catColor(c), title: t('wellbeing.category'), sub: catName(c), className: 'muted-sub', onClick: () => pickCategory(site) }),
            switchRow({ icon: 'bedtime', iconBg: '#5a5fd6', title: t('wellbeing.allowBed'), sub: t('wellbeing.allowBedSub'), checked: M.inList(w.bedtime.allowed, site),
              onChange: (v) => savePrefs((x) => ({ bedtime: { ...x.bedtime, allowed: v ? [...new Set([...x.bedtime.allowed, site])] : x.bedtime.allowed.filter((s) => s !== site) } })) })));
      };
      return live(draw);
    },
  });
}

// ------------------------------------------------------------------ wheels and the timer / goal / time dialogs
/** One UI number wheel (drag, mouse wheel, arrow keys or type digits). */
function wheel({ min, max, value, step = 1, fmt = pad2, label = '', onChange }) {
  const n = Math.floor((max - min) / step) + 1;
  const norm = (v) => min + ((((Math.round((v - min) / step) % n) + n) % n) * step);
  const listEl = h('div', { class: 'wb-wheel-list' });
  const el = h('div', { class: 'wb-wheel', tabindex: 0, role: 'spinbutton', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, listEl);
  value = norm(value);
  const draw = (dir = 0) => {
    listEl.replaceChildren(...[-1, 0, 1].map((o) => h('div', { class: ['wb-wheel-item', o === 0 && 'cur'], onClick: o ? () => set(value + o * step) : null }, fmt(norm(value + o * step)))));
    el.setAttribute('aria-valuenow', value);
    if (dir) {
      listEl.classList.remove('up', 'down');
      void listEl.offsetWidth;
      listEl.classList.add(dir > 0 ? 'up' : 'down');
    }
  };
  const set = (v) => {
    const nv = norm(v);
    if (nv === value) return;
    const dir = Math.sign(v - value);
    value = nv;
    draw(dir);
    onChange?.(value);
  };
  let acc = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    acc += e.deltaY;
    while (Math.abs(acc) >= 40) {
      const s = Math.sign(acc);
      set(value + s * step);
      acc -= s * 40;
    }
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    let y0 = e.clientY;
    const move = (ev) => {
      const steps = Math.trunc((y0 - ev.clientY) / 30);
      if (steps) {
        y0 -= steps * 30;
        set(value + steps * step);
      }
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  let typed = '', typedAt = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(value + (e.key === 'ArrowDown' ? step : -step));
    } else if (/^\d$/.test(e.key)) {
      typed = Date.now() - typedAt < 1200 ? typed + e.key : e.key;
      typedAt = Date.now();
      const v = Number(typed);
      if (v >= min && v <= max) {
        value = norm(v);
        draw();
        onChange?.(value);
      } else typed = e.key;
    }
  });
  draw();
  el.get = () => value;
  el.set = (v) => {
    value = norm(v);
    draw();
  };
  return el;
}

/** Hours : minutes wheels with their labels under them. */
function durationWheels(minutes, maxH = 23) {
  const hw = wheel({ min: 0, max: maxH, value: Math.floor(minutes / 60), fmt: String, label: t('wellbeing.hours') });
  const mw = wheel({ min: 0, max: 59, value: minutes % 60, label: t('wellbeing.minutes') });
  const el = h('div', { class: 'wb-wheels' },
    h('div', { class: 'wb-wheel-col' }, hw, h('small', null, t('wellbeing.hours'))),
    h('span', { class: 'wb-colon' }, ':'),
    h('div', { class: 'wb-wheel-col' }, mw, h('small', null, t('wellbeing.minutes'))));
  el.get = () => hw.get() * 60 + mw.get();
  return el;
}

function timerSub(tm) {
  if (Array.isArray(tm.days) && tm.days.length === 7) {
    const today = M.timerMinutes(tm, Date.now());
    return t('wellbeing.customToday', { t: today ? dur(today * 60) : t('wellbeing.noTimerToday') });
  }
  return t('wellbeing.everyDayT', { t: dur(tm.min * 60) });
}

async function timerDialog({ kind, target }) {
  const w = prefs(), existing = w.timers.find((x) => x.kind === kind && x.target === target);
  const name = kind === 'cat' ? catName(target) : target;
  let custom = Array.isArray(existing?.days) && existing.days.length === 7;
  const base = existing ? existing.min || 60 : 60;
  const days = custom ? [...existing.days] : Array(7).fill(base);
  const wheels = durationWheels(base);
  const names = weekdayNames('long');
  const hourOpts = (v) => Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: Math.floor(v / 60) === i }, t('wellbeing.hShort', { n: i })));
  const minOpts = (v) => Array.from({ length: 12 }, (_, i) => h('option', { value: i * 5, selected: Math.round((v % 60) / 5) * 5 === i * 5 }, t('wellbeing.mShort', { n: i * 5 })));
  const dayRows = h('div', { class: 'wb-dayrows' }, weekOrder().map((wd) => {
    const hs = h('select', { class: 'ou-input wb-sel', 'aria-label': names[wd] + ' ' + t('wellbeing.hours') }, hourOpts(days[wd]));
    const ms = h('select', { class: 'ou-input wb-sel', 'aria-label': names[wd] + ' ' + t('wellbeing.minutes') }, minOpts(days[wd]));
    const upd = () => (days[wd] = +hs.value * 60 + +ms.value);
    hs.addEventListener('change', upd);
    ms.addEventListener('change', upd);
    return h('div', { class: 'wb-dayrow', dataset: { wd } }, h('span', null, names[wd]), hs, ms);
  }));
  const sync = () => {
    wheels.hidden = custom;
    dayRows.hidden = !custom;
  };
  const mode = seg([{ value: 'every', label: t('wellbeing.everyDay') }, { value: 'custom', label: t('wellbeing.customDays') }], custom ? 'custom' : 'every', (v) => {
    custom = v === 'custom';
    if (custom && !existing?.days) days.fill(wheels.get() || 60);
    sync();
    dayRows.querySelectorAll('.wb-dayrow').forEach((r) => {
      const wd = +r.dataset.wd, [hs, ms] = r.querySelectorAll('select');
      hs.value = Math.floor(days[wd] / 60);
      ms.value = Math.round((days[wd] % 60) / 5) * 5;
    });
  });
  mode.classList.add('wb-timer-seg');
  sync();
  const actions = [{ label: t('common.cancel'), value: null }];
  if (existing) actions.push({ label: t('wellbeing.deleteTimer'), value: 'delete', danger: true });
  actions.push({ label: t('common.done'), value: 'save', primary: true });
  const res = await dialog({
    title: t('wellbeing.setTimer'),
    className: 'wb-dlg wb-timer-dlg',
    content: h('div', { class: 'wb-dlg-body' },
      h('div', { class: 'wb-dlg-sub' }, kind === 'cat' ? h('span', { class: 'wb-cico sm', style: { background: catColor(target) }, html: icon(catIcon(target), 16) }) : siteIcon(target, 'sm'), h('bdi', null, name)),
      mode, wheels, dayRows,
      h('p', { class: 'wb-dlg-note' }, t('wellbeing.timerNote'))),
    actions,
  });
  if (res === 'delete') {
    savePrefs((x) => ({ timers: x.timers.filter((y) => y.id !== existing.id) }));
    toast(t('wellbeing.timerDeleted'));
  } else if (res === 'save') {
    const min = custom ? Math.max(...days) : wheels.get();
    if (!min) {
      if (existing) savePrefs((x) => ({ timers: x.timers.filter((y) => y.id !== existing.id) }));
      return;
    }
    const tm = { id: existing?.id || 'tm-' + uid(), kind, target, min, days: custom ? days.map((d) => clamp(d, 0, 1439)) : null, on: true };
    savePrefs((x) => ({ timers: [...x.timers.filter((y) => y.id !== tm.id), tm] }));
    toast(t('wellbeing.timerSet', { name, t: timerSub(tm) }));
  }
}

async function goalDialog() {
  const w = prefs();
  const wheels = durationWheels(w.goal || 240, 16);
  const actions = [{ label: t('common.cancel'), value: null }];
  if (w.goal) actions.push({ label: t('wellbeing.removeGoal'), value: 'remove', danger: true });
  actions.push({ label: t('common.done'), value: 'save', primary: true });
  const res = await dialog({
    title: t('wellbeing.goal'),
    className: 'wb-dlg wb-goal-dlg',
    content: h('div', { class: 'wb-dlg-body' }, h('p', { class: 'wb-dlg-note' }, t('wellbeing.goalNote')), wheels),
    actions,
  });
  if (res === 'remove') savePrefs({ goal: 0 });
  else if (res === 'save') {
    const g = wheels.get();
    savePrefs({ goal: g });
    if (g) toast(t('wellbeing.goalSaved', { t: dur(g * 60) }));
  }
}

/** A time of day on wheels (12- or 24-hour like the Clock app). Resolves 'HH:MM' or null. */
async function timeDialog(title, hhmm) {
  const m0 = M.toMin(hhmm), h12 = use12h();
  let hour = Math.floor(m0 / 60), minute = m0 % 60;
  const mw = wheel({ min: 0, max: 59, value: minute, label: t('wellbeing.minutes'), onChange: (v) => (minute = v) });
  let el;
  if (h12) {
    let pm = hour >= 12;
    const pname = (v) => fmtPeriod(new Date(2024, 0, 1, v ? 15 : 9));
    const hw = wheel({ min: 1, max: 12, value: hour % 12 || 12, fmt: String, label: t('wellbeing.hours'), onChange: (v) => (hour = (v % 12) + (pm ? 12 : 0)) });
    const pw = wheel({ min: 0, max: 1, value: pm ? 1 : 0, fmt: pname, label: 'AM/PM', onChange: (v) => { pm = !!v; hour = (hw.get() % 12) + (pm ? 12 : 0); } });
    pw.classList.add('period');
    el = h('div', { class: 'wb-wheels' }, hw, h('span', { class: 'wb-colon' }, ':'), mw, pw);
  } else {
    const hw = wheel({ min: 0, max: 23, value: hour, label: t('wellbeing.hours'), onChange: (v) => (hour = v) });
    el = h('div', { class: 'wb-wheels' }, hw, h('span', { class: 'wb-colon' }, ':'), mw);
  }
  const res = await dialog({ title, className: 'wb-dlg', content: h('div', { class: 'wb-dlg-body' }, el), actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: 'ok', primary: true }] });
  return res ? M.fromMin(hour * 60 + minute) : null;
}

// ------------------------------------------------------------------ Site timers
async function askSite(exclude = []) {
  // Samsung picks from the apps you use; here: the sites you used most, or type one
  const known = M.knownSites(usage()).filter((s) => !exclude.includes(s)).slice(0, 10);
  let v = known.length ? await choose(t('wellbeing.addSite'), [...known.map((s) => ({ value: s, label: s })), { value: '\u0000', label: t('wellbeing.typeSite') }], null) : '\u0000';
  if (v === '\u0000') v = await prompt(t('wellbeing.addSite'), { placeholder: 'example.com', okLabel: t('common.add') });
  if (!v) return null;
  const url = toUrl(String(v).trim()) || toUrl(String(v).trim() + '.com');
  const site = url ? siteOf(hostname(url)) : '';
  if (!site || !site.includes('.')) {
    toast(t('wellbeing.badSite'));
    return null;
  }
  return site;
}

function timersPage(ctx) {
  let tab = 'sites';
  ctx.push({
    title: t('wellbeing.timers'),
    className: 'wb-page',
    actions: [iconBtn('plus', async () => { const s = await askSite(); if (s) timerDialog({ kind: 'site', target: s }); }, t('wellbeing.addSite'))],
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), u = usage(), catOf = catFn(w), today = M.period(u, { mode: 'day', catOf });
        const todaySec = Object.fromEntries(today.sites), catSec = Object.fromEntries(today.cats);
        const tabs = seg([{ value: 'sites', label: t('wellbeing.sites') }, { value: 'cats', label: t('wellbeing.categories') }], tab, (v) => { tab = v; draw(); });
        let rows;
        if (tab === 'sites') {
          const sites = [...new Set([...w.timers.filter((x) => x.kind === 'site').map((x) => x.target), ...today.sites.map((x) => x[0]), ...M.knownSites(u)])].slice(0, 80);
          rows = sites.map((site) => {
            const tm = w.timers.find((x) => x.kind === 'site' && x.target === site);
            return h('div', { class: 'ou-row clickable wb-trow', role: 'button', tabindex: 0, dataset: { site }, onClick: () => timerDialog({ kind: 'site', target: site }), onKeydown: (e) => e.key === 'Enter' && timerDialog({ kind: 'site', target: site }) },
              siteIcon(site),
              h('span', { class: 'ou-row-text' }, h('bdi', { class: 'ou-row-title' }, site), h('span', { class: 'ou-row-sub muted' }, t('wellbeing.todayT', { t: dur(todaySec[site] || 0) }))),
              timerBtn(tm, () => timerDialog({ kind: 'site', target: site })));
          });
        } else {
          rows = CAT_IDS.map((c) => {
            const tm = w.timers.find((x) => x.kind === 'cat' && x.target === c);
            return h('div', { class: 'ou-row clickable wb-trow', role: 'button', tabindex: 0, dataset: { cat: c }, onClick: () => timerDialog({ kind: 'cat', target: c }), onKeydown: (e) => e.key === 'Enter' && timerDialog({ kind: 'cat', target: c }) },
              h('span', { class: 'wb-cico', style: { background: catColor(c) }, html: icon(catIcon(c), 20) }),
              h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, catName(c)), h('span', { class: 'ou-row-sub muted' }, t('wellbeing.todayT', { t: dur(catSec[c] || 0) }))),
              timerBtn(tm, () => timerDialog({ kind: 'cat', target: c })));
          });
        }
        body.replaceChildren(tabs,
          rows.length ? h('div', { class: 'ou-card ou-list wb-tlist' }, rows) : h('div', { class: 'ou-empty' }, h('span', { html: icon('hourglass', 56) }), t('wellbeing.noSitesYet')),
          h('p', { class: 'wb-note' }, t('wellbeing.timersNote')));
      };
      return live(draw);
    },
  });
}

// ------------------------------------------------------------------ Focus modes
function startMode(m) {
  const now = Date.now();
  savePrefs({ focus: { id: m.id, startedAt: now, endsAt: m.minutes ? now + m.minutes * 60e3 : 0 } });
  toast(t('wellbeing.modeStarted', { name: modeName(m) }));
}
function endMode() {
  savePrefs({ focus: null });
}
function toggleBed() {
  savePrefs((x) => ({ bedtime: M.toggleBedtime(x.bedtime) }));
}

/** An editable list of sites (allowed sites, extra distracting sites). */
function sitesList(sites, { onAdd, onRemove, addLabel }) {
  return h('div', { class: 'ou-card ou-list wb-slist' },
    sites.map((s) => h('div', { class: 'ou-row wb-srow', dataset: { site: s } }, siteIcon(s), h('span', { class: 'ou-row-text' }, h('bdi', { class: 'ou-row-title' }, s)),
      h('button', { class: 'wb-remove', title: t('common.remove'), 'aria-label': t('common.remove'), html: icon('minus', 16), onClick: () => onRemove(s) }))),
    h('button', { class: 'ou-row clickable wb-addrow', onClick: onAdd }, h('span', { class: 'wb-add-ico', html: icon('plus', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, addLabel))));
}

const editMode = (id, fn) => savePrefs((x) => ({ modes: x.modes.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)) }));

function focusPage(ctx) {
  ctx.push({
    title: t('wellbeing.focusModes'),
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), active = M.activeMode(w);
        const tile = (m) => h('button', { class: ['wb-mode', active?.id === m.id && 'on'], style: { '--mc': m.color }, dataset: { mode: m.id }, onClick: () => modePage(ctx, m.id) },
          h('span', { class: 'wb-mode-ico', html: icon(m.icon || 'wbWork', 26) }),
          h('span', { class: 'wb-mode-name' }, modeName(m)),
          h('span', { class: 'wb-mode-state' }, active?.id === m.id ? modeStatus(w) : t('common.off')));
        const dl = [...w.distracting.cats.map(catName), ...w.distracting.sites].join(', ') || t('common.none');
        body.replaceChildren(
          h('p', { class: 'wb-note top' }, t('wellbeing.focusIntro')),
          h('div', { class: 'wb-modes' }, w.modes.map(tile),
            h('button', { class: 'wb-mode add', onClick: addMode }, h('span', { class: 'wb-mode-ico', html: icon('plus', 26) }), h('span', { class: 'wb-mode-name' }, t('wellbeing.addMode')))),
          list(
            switchRow({ icon: 'dnd', iconBg: '#8a5cf6', title: t('wellbeing.sessionPause'), sub: t('wellbeing.sessionPauseSub'), checked: w.focusSessions, onChange: (v) => savePrefs({ focusSessions: v }) }),
            row({ icon: 'wbBlock', iconBg: '#f2556b', title: t('wellbeing.distracting'), sub: dl, className: 'muted-sub', onClick: () => distractingPage(ctx) })));
      };
      return live(draw);
    },
  });
}

async function addMode() {
  const name = (await prompt(t('wellbeing.addMode'), { placeholder: t('wellbeing.modeNamePh'), okLabel: t('common.add') }))?.trim();
  if (!name) return;
  const w = prefs();
  const icons = ['wbBook', 'wbRun', 'wbCode', 'wbLeaf', 'wbWork'];
  const m = { id: 'm-' + uid(), name: name.slice(0, 30), icon: icons[w.modes.length % icons.length], color: M.MODE_COLORS[w.modes.length % M.MODE_COLORS.length], block: 'distracting', allowed: [], minutes: 0 };
  savePrefs((x) => ({ modes: [...x.modes, m] }));
}

const DURATIONS = [0, 30, 60, 120, 240];
const durName = (m) => (m ? dur(m * 60) : t('wellbeing.untilOff'));

function modePage(ctx, id) {
  const page = ctx.push({
    title: modeName(prefs().modes.find((x) => x.id === id)),
    hero: false,
    className: 'wb-page',
    actions: [iconBtn('more', (e) => modeMenu(e.currentTarget), t('common.more'))],
    render(body, pg) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), m = w.modes.find((x) => x.id === id);
        if (!m) return;
        pg.setTitle(modeName(m));
        const on = M.activeMode(w)?.id === id;
        body.replaceChildren(
          h('section', { class: ['wb-mode-hero', on && 'on'], style: { '--mc': m.color } },
            h('span', { class: 'wb-mode-hero-ico', html: icon(m.icon || 'wbWork', 38) }),
            h('h2', null, modeName(m)),
            h('div', { class: 'wb-mode-hero-state' }, on ? modeStatus(w) : t('wellbeing.modeOffSub')),
            h('button', { class: 'wb-mode-btn', onClick: () => (on ? endMode() : startMode(m)) }, on ? t('wellbeing.end') : t('wellbeing.start'))),
          list(
            row({ icon: 'timer', iconBg: m.color, title: t('wellbeing.duration'), sub: durName(m.minutes), className: 'muted-sub', onClick: async () => {
              const v = await choose(t('wellbeing.duration'), DURATIONS.map((d) => ({ value: d, label: durName(d) })), m.minutes || 0);
              if (v != null) editMode(id, () => ({ minutes: v }));
            } }),
            row({ icon: 'wbBlock', iconBg: m.color, title: t('wellbeing.pauseWhat'), sub: m.block === 'all' ? t('wellbeing.pauseAll') : t('wellbeing.pauseDistracting'), className: 'muted-sub', onClick: async () => {
              const v = await choose(t('wellbeing.pauseWhat'), [{ value: 'distracting', label: t('wellbeing.pauseDistracting'), sub: t('wellbeing.pauseDistractingSub') }, { value: 'all', label: t('wellbeing.pauseAll'), sub: t('wellbeing.pauseAllSub') }], m.block);
              if (v) editMode(id, () => ({ block: v }));
            } })),
          subheader(t('wellbeing.allowedSites')),
          sitesList(m.allowed, {
            addLabel: t('wellbeing.addSite'),
            onAdd: async () => { const s = await askSite(m.allowed); if (s) editMode(id, (x) => ({ allowed: [...new Set([...x.allowed, s])] })); },
            onRemove: (s) => editMode(id, (x) => ({ allowed: x.allowed.filter((y) => y !== s) })),
          }),
          h('p', { class: 'wb-note' }, m.block === 'all' ? t('wellbeing.allowedNoteAll') : t('wellbeing.allowedNote')));
      };
      return live(draw);
    },
  });
  function modeMenu(at) {
    const m = prefs().modes.find((x) => x.id === id);
    if (!m) return;
    const builtin = !m.name;
    menu(at, [
      { label: t('common.rename'), icon: 'edit', disabled: builtin, onClick: async () => {
        const v = (await prompt(t('common.rename'), { value: modeName(m) }))?.trim();
        if (v) editMode(id, () => ({ name: v.slice(0, 30) }));
      } },
      { label: t('wellbeing.color'), icon: 'palette', onClick: async () => {
        const v = await choose(t('wellbeing.color'), M.MODE_COLORS.map((c, i) => ({ value: c, label: t('wellbeing.colorN', { n: i + 1 }) })), m.color);
        if (v) editMode(id, () => ({ color: v }));
      } },
      { label: t('common.delete'), icon: 'trash', danger: true, disabled: builtin, onClick: async () => {
        if (!(await confirm(t('wellbeing.deleteMode'), t('wellbeing.deleteModeMsg', { name: modeName(m) }), { okLabel: t('common.delete'), danger: true }))) return;
        savePrefs((x) => ({ modes: x.modes.filter((y) => y.id !== id), focus: x.focus?.id === id ? null : x.focus }));
        ctx.pop();
      } },
    ], { align: 'end' });
  }
  return page;
}

function distractingPage(ctx) {
  ctx.push({
    title: t('wellbeing.distracting'),
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const setCats = (fn) => savePrefs((x) => ({ distracting: { ...x.distracting, cats: fn(x.distracting.cats) } }));
      const setSites = (fn) => savePrefs((x) => ({ distracting: { ...x.distracting, sites: fn(x.distracting.sites) } }));
      const draw = () => {
        const w = prefs();
        body.replaceChildren(
          h('p', { class: 'wb-note top' }, t('wellbeing.distractingNote')),
          subheader(t('wellbeing.categories')),
          list(...CAT_IDS.filter((c) => c !== 'other').map((c) => switchRow({ icon: catIcon(c), iconBg: catColor(c), title: catName(c), checked: w.distracting.cats.includes(c),
            onChange: (v) => setCats((l) => (v ? [...new Set([...l, c])] : l.filter((y) => y !== c))) }))),
          subheader(t('wellbeing.moreSites')),
          sitesList(w.distracting.sites, {
            addLabel: t('wellbeing.addSite'),
            onAdd: async () => { const s = await askSite(w.distracting.sites); if (s) setSites((l) => [...new Set([...l, s])]); },
            onRemove: (s) => setSites((l) => l.filter((y) => y !== s)),
          }));
      };
      return live(draw);
    },
  });
}

// ------------------------------------------------------------------ Bedtime mode
function bedtimePage(ctx) {
  ctx.push({
    title: t('wellbeing.bedtime'),
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const setBt = (patch) => savePrefs((x) => ({ bedtime: { ...x.bedtime, ...patch } }));
      const draw = () => {
        const w = prefs(), bt = w.bedtime, st = M.bedtimeAt(bt);
        const len = ((M.toMin(bt.to) - M.toMin(bt.from) + 1440) % 1440) * 60;
        const names = weekdayNames('narrow'), longNames = weekdayNames('long');
        const state = st.active ? t('wellbeing.bedOnUntil', { time: fmtTime(new Date(st.until)) })
          : bt.on && st.next ? t('wellbeing.bedNext', { when: (M.dayKey(st.next) === M.dayKey(new Date()) ? '' : fmtDate(new Date(st.next), { weekday: 'short' }) + ' ') + fmtTime(new Date(st.next)) })
            : t('wellbeing.bedOffSub');
        const timeBtn = (key, ic, label) => h('button', {
          class: 'wb-sched-t',
          dataset: { k: key },
          onClick: async () => {
            const v = await timeDialog(label, bt[key]);
            if (v) setBt({ [key]: v });
          },
        }, h('span', { class: 'wb-sched-ico', html: icon(ic, 18) }), h('small', null, label), h('b', null, hm(bt[key])));
        body.replaceChildren(
          h('section', { class: ['wb-bed-hero', st.active && 'on'] },
            h('span', { class: 'wb-bed-moon', html: icon('bedtime', 40) }),
            h('div', { class: 'wb-bed-title' }, st.active ? t('wellbeing.bedOn') : t('wellbeing.bedtime')),
            h('div', { class: 'wb-bed-state' }, state),
            h('button', { class: 'wb-bed-btn', onClick: toggleBed }, st.active ? t('wellbeing.turnOffNow') : t('wellbeing.turnOnNow'))),
          list(switchRow({ icon: 'calendar', iconBg: '#5a5fd6', title: t('wellbeing.asScheduled'), sub: bt.on ? `${hm(bt.from)} – ${hm(bt.to)}` : t('common.off'), checked: bt.on, onChange: (v) => setBt({ on: v }) })),
          h('section', { class: ['ou-card', 'wb-sched', !bt.on && 'off'] },
            h('div', { class: 'wb-sched-times' }, timeBtn('from', 'bedtime', t('wellbeing.bedtimeAt')), h('span', { class: 'wb-sched-sep', html: icon('arrowRight', 18) }), timeBtn('to', 'alarm', t('wellbeing.wakeUp'))),
            h('div', { class: 'wb-sched-len' }, t('wellbeing.sleepLen', { t: dur(len) })),
            h('div', { class: 'wb-days' }, weekOrder().map((wd) => h('button', {
              class: ['wb-day', bt.days.includes(wd) && 'on'],
              title: longNames[wd],
              'aria-pressed': String(bt.days.includes(wd)),
              onClick: () => setBt({ days: bt.days.includes(wd) ? bt.days.filter((x) => x !== wd) : [...bt.days, wd].sort() }),
            }, names[wd])))),
          subheader(t('wellbeing.options')),
          list(
            switchRow({ icon: 'wbGray', iconBg: '#6f7f96', title: t('wellbeing.gray'), sub: t('wellbeing.graySub'), checked: bt.gray, onChange: (v) => setBt({ gray: v }) }),
            switchRow({ icon: 'wbBlock', iconBg: '#5a5fd6', title: t('wellbeing.bedPause'), sub: t('wellbeing.bedPauseSub'), checked: bt.block, onChange: (v) => setBt({ block: v }) })),
          bt.block ? [subheader(t('wellbeing.allowedSites')), sitesList(bt.allowed, {
            addLabel: t('wellbeing.addSite'),
            onAdd: async () => { const s = await askSite(bt.allowed); if (s) setBt({ allowed: [...new Set([...prefs().bedtime.allowed, s])] }); },
            onRemove: (s) => setBt({ allowed: prefs().bedtime.allowed.filter((y) => y !== s) }),
          })] : null);
      };
      return live(draw);
    },
  });
}

// ------------------------------------------------------------------ Weekly report
function catBar(cats) {
  const total = cats.reduce((a, [, v]) => a + v, 0) || 1;
  return h('div', { class: 'wb-catbar' }, cats.map(([c, v]) => h('i', { style: { flexGrow: (v / total).toFixed(4), background: catColor(c) }, title: `${catName(c)} · ${dur(v)}` })));
}

function reportPage(ctx) {
  let offset = -1;
  ctx.push({
    title: t('wellbeing.report'),
    className: 'wb-page',
    render(body) {
      body.classList.add('wb-body', 'wb-narrow');
      const draw = () => {
        const w = prefs(), catOf = catFn(w), u = usage(), r = M.period(u, { mode: 'week', offset, ws: weekStart(), catOf });
        const prev = M.addDays(r.start, -1) >= M.startOfDay(r.oldest);
        const sentence = M.reportSentence(r, { down: t('wellbeing.weekDown'), up: t('wellbeing.weekUp'), avg: t('wellbeing.weekAvg') }, (s) => dur(s), pct);
        const top = r.sites.slice(0, 5), max = top[0]?.[1] || 1;
        body.replaceChildren(
          h('section', { class: 'ou-card wb-card wb-report' },
            nav(weekLabel(r.start), prev, offset < 0, (d) => { offset += d; draw(); }),
            r.total ? [
              h('p', { class: 'wb-report-sum' }, sentence),
              h('div', { class: 'wb-big' }, dur(r.avg)),
              h('div', { class: 'wb-big-sub' }, h('span', null, t('wellbeing.dailyAvg'))),
              barsChart(r, { goal: w.goal }),
              h('div', { class: 'wb-stats' }, stat(t('wellbeing.total'), dur(r.total, 'short')), stat(t('wellbeing.notifs'), num(r.n)), stat(t('wellbeing.unlocks'), num(r.u))),
            ] : h('div', { class: 'wb-hint' }, t('wellbeing.noReport'))),
          r.total ? h('section', { class: 'ou-card wb-card' },
            h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, t('wellbeing.byCategory'))),
            catBar(r.cats),
            h('div', { class: 'wb-catlist' }, r.cats.slice(0, 4).map(([c, v]) => h('div', { class: 'wb-catline' }, h('i', { style: { background: catColor(c) } }), h('span', null, catName(c)), h('b', null, dur(v)))))) : null,
          r.total ? h('section', { class: 'ou-card wb-card wb-most' },
            h('div', { class: 'wb-card-head' }, h('span', { class: 'wb-card-title' }, t('wellbeing.mostUsed'))),
            top.map(([s, v], i) => siteRow(ctx, s, v, max, i < 4 ? PALETTE[i] : OTHER, w))) : null,
          list(switchRow({ icon: 'bell', iconBg: '#3e7bfa', title: t('wellbeing.reportNotif'), sub: t('wellbeing.reportNotifSub'), checked: w.report, onChange: (v) => savePrefs({ report: v }) })));
      };
      return live(draw);
    },
  });
}
