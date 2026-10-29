// Samsung Health › My page: your profile, personal bests, awards, goals and the app's settings (units, medication
// reminders, Daily activity notifications, Manage items, erasing the health data).
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { dialog, confirm, toast, row, switchRow, list, choose, subheader } from '../core/ui.js';
import { store } from '../core/store.js';
import * as M from './model.js';
import * as R from './rings.js';
import * as H from './data.js';
import * as F from './format.js';
import { section, chips, field, input } from './kit.js';
import { setGoals, awardGrid, openAwards } from './activity.js';
import { unitsDialog, waterGoalDialog, sleepGoalDialog } from './trackers.js';

const initials = (name) => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
function age(birth) {
  if (!M.isKey(birth)) return null;
  const b = M.keyDate(birth), n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}

async function editProfile() {
  const d = H.D(), p = d.profile, u = H.units(d), lh = M.latestBody(d, 'height');
  const name = input({ value: p.name || '', maxlength: 40, placeholder: t('health.me.namePh'), 'data-f': 'name' });
  const birth = input({ type: 'date', value: p.birth || '', max: M.dayKey(), 'data-f': 'birth' });
  const sex = chips(['female', 'male', 'other'].map((x) => ({ value: x, label: t('health.me.sex.' + x) })), p.sex || '');
  const height = input({ type: 'text', inputmode: 'decimal', value: lh ? F.num(M.toUnit('height', lh.value, u), 0).replace(/,/g, '') : '', placeholder: '–', 'data-f': 'height' });
  const res = await dialog({
    title: t('health.me.profile'),
    content: h('div', { class: 'ou-dialog-body hl-form-dlg' }, field(t('health.me.name'), name), field(t('health.me.birth'), birth), field(t('health.me.sex'), sex),
      field(t('health.body.height'), h('div', { class: 'hl-ask-row' }, height, h('span', { class: 'hl-ask-unit' }, F.unitName(u.height))))),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: true }],
  });
  if (!res) return;
  const cm = M.fromUnit('height', F.numIn(height.value), u);
  H.mut((x) => {
    x.profile = { ...x.profile, name: name.value.trim(), birth: M.isKey(birth.value) ? birth.value : '', sex: sex.value || '' };
    if (cm >= 30 && cm <= 280 && (!lh || Math.abs(lh.value - cm) >= 0.3)) x.body.push({ id: M.newId('b'), at: Date.now(), kind: 'height', value: Math.round(cm * 10) / 10 });
  });
}

async function eraseAll() {
  if (!(await confirm(t('health.me.eraseQ'), t('health.me.eraseMsg'), { okLabel: t('health.me.erase'), danger: true }))) return;
  store.remove(M.KEY);
  store.remove(M.PREFS);
  // the worker owns its two keys: it clears them (and its reminder alarms) itself
  try { await chrome.runtime.sendMessage({ type: 'health-erase' }); } catch {}
  toast(t('health.me.erased'));
}

export function meView(ctx, nav, tabs) {
  ctx.page({
    title: t('health.tab.me'), hero: false, className: 'hl-page hl-me-page',
    render(body, page) {
      page.el.appendChild(tabs);
      body.classList.add('hl-body');
      const draw = () => {
        const d = H.D(), p = d.profile, pr = H.prefs(), u = H.units(d), s = H.sources();
        const res = R.computeAwards(s, { weekStart: F.weekStart() });
        const earned = R.mergeEarned(R.normLog(s.act).earned, res.earned);
        const n = Object.values(earned).filter((x) => x?.length).length;
        const a = age(p.birth);
        const notify = (key) => switchRow({ title: t('health.me.n.' + key), sub: t('health.me.n.' + key + 'Sub'), checked: pr.notify[key], onChange: (v) => H.setPrefs((x) => ({ ...x, notify: { ...R.normPrefs(x).notify, [key]: v } })) });
        body.replaceChildren(
          h('div', { class: 'hl-profile', role: 'button', tabindex: 0, onClick: editProfile, onKeydown: (e) => e.key === 'Enter' && editProfile() },
            h('span', { class: 'hl-avatar' }, initials(p.name) || h('span', { html: icon('user', 34) })),
            h('div', { class: 'hl-profile-t' }, h('b', null, p.name || t('health.me.addName')), h('small', null, [a != null ? t('health.me.age', { n: F.num(a) }) : '', p.sex ? t('health.me.sex.' + p.sex) : ''].filter(Boolean).join(' · ') || t('health.me.editProfile'))),
            h('span', { class: 'hl-li-chev', html: icon('edit', 20) })),
          section(t('health.me.bests'), h('div', { class: 'hl-stats' },
            h('div', { class: 'hl-stat' }, h('small', null, t('health.activity.bestFocus')), h('b', { style: { color: R.COLORS.focus.c } }, F.minText(res.stats.bestFocus))),
            h('div', { class: 'hl-stat' }, h('small', null, t('health.activity.bestFocusStreak')), h('b', null, F.tn('health.activity.daysN', res.stats.bestStreak))),
            h('div', { class: 'hl-stat' }, h('small', null, t('health.me.sessions')), h('b', null, F.num(res.stats.sessions))),
            h('div', { class: 'hl-stat' }, h('small', null, t('health.me.awardsN')), h('b', null, F.num(n))))),
          section(t('health.awards'), awardGrid(earned, { limit: 4, onlyEarned: n > 0 }), { action: h('button', { class: 'hl-link', onClick: () => openAwards(ctx) }, t('health.viewAll')) }),
          subheader(t('health.me.goals')),
          list(
            row({ icon: 'hlRings', iconBg: R.COLORS.focus.c, title: t('health.cards.activity'), sub: R.RINGS.map((k) => `${F.ringName(k)} ${t('health.rg.' + k, { g: F.num(pr.goals[k]) }).replace(/^\//, '')}`).join(' · '), chevron: true, onClick: setGoals, className: 'muted-sub' }),
            row({ icon: 'drop', iconBg: '#2f9bff', title: t('health.cards.water'), sub: F.waterText(M.waterGoal(d, u), u), chevron: true, onClick: waterGoalDialog, className: 'muted-sub' }),
            row({ icon: 'hlBed', iconBg: '#6d5ce8', title: t('health.cards.sleep'), sub: F.durText(M.sleepGoal(d)), chevron: true, onClick: sleepGoalDialog, className: 'muted-sub' })),
          subheader(t('health.me.notifications')),
          list(
            switchRow({ title: t('health.meds.remind'), sub: t('health.meds.remindSub'), checked: d.medPrefs.remind, onChange: (v) => H.mut((x) => { x.medPrefs.remind = v; }) }),
            switchRow({ title: t('health.meds.follow'), sub: t('health.meds.followSub'), checked: d.medPrefs.follow, onChange: (v) => H.mut((x) => { x.medPrefs.follow = v; }) }),
            notify('coach'),
            row({ title: t('health.me.coachAt'), sub: F.timeOf(`${String(pr.notify.at).padStart(2, '0')}:00`), chevron: true, className: 'hl-coach-at', onClick: async () => {
              const v = await choose(t('health.me.coachAt'), Array.from({ length: 11 }, (_, i) => ({ value: 12 + i, label: F.timeOf(`${12 + i}:00`) })), pr.notify.at);
              if (v != null) H.setPrefs((x) => ({ ...x, notify: { ...R.normPrefs(x).notify, at: v } }));
            } }),
            notify('goals'),
            notify('awards')),
          subheader(t('common.settings')),
          list(
            row({ icon: 'sort', title: t('health.units'), sub: [F.unitName(u.weight), u.height === 'in' ? t('health.units.ftin') : F.unitName(u.height), F.unitName(u.water)].join(' · '), chevron: true, onClick: unitsDialog, className: 'muted-sub' }),
            row({ icon: 'edit', title: t('health.manage'), chevron: true, onClick: () => nav.open('manage') }),
            row({ icon: 'trash', title: t('health.me.erase'), className: 'hl-danger', onClick: eraseAll })),
          h('p', { class: 'hl-privacy' }, h('span', { html: icon('lock', 14) }), t('health.privacy')));
      };
      draw();
      return H.watch([...H.DATA_KEYS, ...H.RING_KEYS], draw);
    },
  });
}
