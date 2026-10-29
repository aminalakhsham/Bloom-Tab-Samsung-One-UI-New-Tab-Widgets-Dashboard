// Samsung Health's window: the bottom navigation (Home, Activity, My page) and the routing for notification clicks,
// widgets and Finder (params.section: 'meds', 'med:<id>', 'activity', 'awards', 'water', 'sleep', 'mood', 'body',
// 'cycle', 'breathe', 'manage'). Each tracker's page lives in its own module.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import './strings.js';
import * as H from './data.js';
import { homeView, openManage } from './home.js';
import { activityView, openActivity, openAwards } from './activity.js';
import { meView } from './me.js';
import { openMeds, openMed, editMed } from './meds.js';
import { openWater, openSleep, openBody } from './trackers.js';
import { openMood, openBreathe } from './mind.js';
import { openCycle } from './cycle.js';

const TABS = [
  { id: 'home', icon: 'home', label: 'health.tab.home' },
  { id: 'activity', icon: 'hlRings', label: 'health.tab.activity' },
  { id: 'me', icon: 'user', label: 'health.tab.me' },
];
const VIEWS = { home: homeView, activity: activityView, me: meView };
const PAGES = { activity: openActivity, meds: openMeds, water: openWater, sleep: openSleep, mood: openMood, body: openBody, cycle: openCycle, breathe: openBreathe, manage: openManage, awards: openAwards, medNew: (ctx, nav) => editMed(ctx, nav, null) };

export function render(ctx) {
  H.mergeSW();
  let cleanup = null, tab = 'home';
  const tabsBar = (active) => h('nav', { class: 'ou-tabs hl-tabs' }, TABS.map((x) => h('button', {
    class: ['ou-tab', x.id === active && 'active'], 'data-tab': x.id, 'aria-current': x.id === active ? 'page' : null,
    onClick: () => x.id !== tab && show(x.id),
  }, h('span', { html: icon(x.icon, 20) }), h('span', null, t(x.label)))));
  const nav = {
    tab: (id) => show(id),
    open: (id, arg) => (id.startsWith('med:') ? openMed(ctx, nav, id.slice(4)) : PAGES[id]?.(ctx, nav, arg)),
  };
  function show(id) {
    try { cleanup?.(); } catch (e) { console.error(e); }
    tab = id;
    cleanup = VIEWS[id](ctx, nav, tabsBar(id));
  }
  function route(section) {
    const s = section || '';
    if (s === 'awards') { show('me'); nav.open('awards'); return; }
    if (s === 'history') { show('activity'); return; }
    show('home');
    if (s && (PAGES[s] || s.startsWith('med:'))) {
      if (s.startsWith('med:')) nav.open('meds');
      nav.open(s);
    }
  }
  ctx.setParams = (p) => route(p?.section);
  route(ctx.params?.section);
  const onVis = () => document.visibilityState === 'visible' && H.mergeSW();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    try { cleanup?.(); } catch (e) { console.error(e); }
  };
}
