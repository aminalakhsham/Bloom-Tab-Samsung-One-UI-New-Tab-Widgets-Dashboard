// Settings pages loaded on demand (js/apps/settings.js keeps the stubs and the root list): the profile card's page,
// Apps (a page per app), Notifications (app notifications, Do not disturb, history), Accessibility, Advanced
// features (+ Labs, Keyboard shortcuts), General management › Reset, Sync with Chrome, and the Backup helpers.
import { h, isExt } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, fmtDate, fmtTime, fmtRelative, weekdayNames } from '../core/i18n.js';
import { store, setting, setSetting, onSetting } from '../core/store.js';
import { getApps, getApp, appName, openApp, closeApp, appIconEl } from '../core/apps.js';
import { row, switchRow, list, subheader, choose, confirm, dialog, toast, slider, card, btn, prompt } from '../core/ui.js';
import { SYNC_CATEGORIES } from '../bg/sync.js';
import { avatar } from '../apps/settings.js';

addIcons({
  setLabs: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.4 17.6A2 2 0 0 0 7.1 20.5h9.8a2 2 0 0 0 1.7-2.9L13.5 8.7V3.5"/><path d="M7.6 14.5h8.8"/>',
  setReset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  setPanel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><path d="M14.5 4.5v15"/>',
  setCapture: '<path d="M6 3.5h8l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M9 13h6M12 10v6"/>',
  setHistory: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4.5l3 1.8"/>',
});

const C = globalThis.chrome;
// hidden entries (the Apps screen button, Recents) are shell features, not apps
const sortedApps = () => getApps().filter((a) => a.id && !a.hidden).sort((a, b) => appName(a).localeCompare(appName(b)));
const muted = () => (Array.isArray(setting('mutedApps')) ? setting('mutedApps') : []);
const setMuted = (id, off) => setSetting('mutedApps', off ? [...new Set([...muted(), id])] : muted().filter((x) => x !== id));
/** Sets a row's second line (adding it when the row was made without one). */
const subOf = (r, text) => {
  let x = r.querySelector('.ou-row-sub');
  if (!x) r.querySelector('.ou-row-text')?.append((x = h('span', { class: 'ou-row-sub' })));
  if (x) x.textContent = text;
};
/** A list row with the app's own icon in front. */
function appRow(app, { sub, onClick, right, chevron = !right } = {}) {
  const r = right ? switchRowFor(app, right) : row({ title: appName(app), sub, chevron, onClick, className: 'muted-sub set-app-row' });
  r.prepend(h('span', { class: 'set-app-ico' }, appIconEl(app, 36)));
  return r;
}
const switchRowFor = (app, { checked, onChange, sub }) => {
  const r = switchRow({ title: appName(app), sub, checked, onChange });
  r.classList.add('muted-sub', 'set-app-row');
  return r;
};

// ——— the profile card's page ———
export function accountPage(ctx, { open }) {
  ctx.push({
    title: t('set.acc.title'),
    render(body) {
      const head = h('div', { class: 'set-acc-head' });
      const draw = () => {
        const name = (setting('profileName') || '').trim();
        head.replaceChildren(
          avatar(name, 84),
          h('h2', null, name || t('set.acc.noName')),
          h('div', { class: 'set-about-v' }, t('set.acc.local')),
          btn(name ? t('set.acc.editName') : t('set.acc.addName'), editName, 'tonal'));
      };
      draw();
      const st = store.get('syncStatus');
      body.append(card(head),
        list(
          row({ icon: 'setSync', iconBg: '#2f8cff', title: t('set.sync'), sub: syncSummary(st), className: 'muted-sub', chevron: true, onClick: () => open('sync') }),
          row({ icon: 'upload', iconBg: '#22b07d', title: t('set.backup'), sub: t('set.backupSub'), className: 'muted-sub', chevron: true, onClick: () => open('backup') })),
        list(row({ icon: 'info', iconBg: '#4b5563', title: t('set.about'), sub: t('set.aboutSub'), className: 'muted-sub', chevron: true, onClick: () => open('about') })));
      return onSetting('profileName', draw);
    },
  });
}
export async function editName() {
  const v = await prompt(t('set.acc.name'), { value: setting('profileName') || '', placeholder: t('set.acc.namePh') });
  if (v == null) return;
  setSetting('profileName', String(v).trim().slice(0, 40));
}
export function syncSummary(st = store.get('syncStatus')) {
  if (!store.get('syncPrefs')?.on) return t('set.sy.off');
  if (st?.error) return t('set.sy.failed');
  return st?.at ? t('set.sy.lastAt', { t: fmtRelative(st.at) }) : t('set.sy.waiting');
}

// ——— Apps ———
export function appsPage(body, ctx) {
  const apps = sortedApps();
  body.append(
    h('div', { class: 'set-count' }, t('set.apps.count', { n: apps.length })),
    list(...apps.map((a) => appRow(a, { sub: muted().includes(a.id) ? t('set.apps.notifOff') : '', onClick: () => appPage(ctx, a) }))));
}

const SIZE_OPTS = () => [
  { value: 'phone', label: t('set.app.sizePhone'), sub: t('set.app.sizePhoneSub') },
  { value: 'wide', label: t('set.app.sizeWide'), sub: t('set.app.sizeWideSub') },
  { value: 'max', label: t('set.app.sizeMax') },
];
/** The size an app's window opens at: the user's choice, else what the app asks for. */
export const appSize = (app) => (setting('appSizes') || {})[app.id] || app._size0 || app.size || 'phone';
// where an app keeps its data (store keys starting with these, pictures "<id>:…")
const DATA_KEYS = { calendar: ['events', 'cal'], clock: ['alarms', 'timers', 'stopwatch', 'clocks', 'clock'], calculator: ['calc'], reminder: ['reminder'], settings: ['settings'] };

export function appPage(ctx, app) {
  ctx.push({
    title: appName(app),
    render(body) {
      const notif = switchRow({ title: t('set.notifications'), sub: muted().includes(app.id) ? t('set.app.notifOffSub') : t('set.app.notifOnSub'), checked: !muted().includes(app.id), onChange: (on) => { setMuted(app.id, !on); subOf(notif, on ? t('set.app.notifOnSub') : t('set.app.notifOffSub')); } });
      const sizeLabel = () => SIZE_OPTS().find((o) => o.value === appSize(app))?.label || '';
      const sizeRow = row({ title: t('set.app.size'), sub: sizeLabel(), onClick: async () => {
        const v = await choose(t('set.app.size'), SIZE_OPTS(), appSize(app));
        if (!v) return;
        setSetting('appSizes', { ...(setting('appSizes') || {}), [app.id]: v });
        // the window forgets where the user put it, so the new size shows the next time it opens
        store.update('appWindows', (m) => {
          const all = { ...(m || {}) };
          const { alpha } = all[app.id] || {};
          all[app.id] = { ...(alpha ? { alpha } : {}), ...(v === 'max' ? { max: true } : {}) };
          return all;
        });
        subOf(sizeRow, sizeLabel());
      } });
      const homeRow = row({ icon: 'home', title: t('set.app.addHome'), sub: '', className: 'muted-sub', onClick: async () => {
        const hm = await import('../shell/home.js');
        if (hm.isOnHome((it) => it.type === 'app' && it.app === app.id)) return toast(t('set.app.onHome'));
        hm.addAppToHome(app.id);
        toast(t('drawer.added'));
        subOf(homeRow, t('set.app.onHome'));
      } });
      import('../shell/home.js').then((hm) => hm.isOnHome((it) => it.type === 'app' && it.app === app.id) && subOf(homeRow, t('set.app.onHome'))).catch(() => {});
      const storageRow = row({ icon: 'folder', title: t('set.app.storage'), sub: t('set.loading'), className: 'muted-sub' });
      appStorage(app).then((n) => subOf(storageRow, fmtBytes(n))).catch(() => subOf(storageRow, '—'));
      body.append(
        card(h('div', { class: 'set-app-head' }, appIconEl(app, 72), h('h2', null, appName(app)),
          btn(t('set.app.open'), () => { const id = app.id; if (id === 'settings') return ctx.pop(); closeApp(); setTimeout(() => openApp(id), 250); }, 'primary'))),
        list(notif),
        list(sizeRow, homeRow),
        list(storageRow));
    },
  });
}

async function appStorage(app) {
  const prefixes = DATA_KEYS[app.id] || [app.id];
  const all = isExt ? await C.storage.local.get(null) : {};
  let n = 0;
  for (const [k, v] of Object.entries(all)) if (prefixes.some((p) => k === p || k.startsWith(p))) n += JSON.stringify(v ?? null).length;
  const B = await import('../core/blobs.js');
  const keys = (await B.listBlobs(app.id + ':')).slice(0, 400);
  for (const k of keys) n += (await B.getBlob(k).catch(() => null))?.size || 0;
  return n;
}
export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ——— Notifications ———
export const DND_DEFAULT = { on: false, sched: false, from: '22:00', to: '07:00', days: [0, 1, 2, 3, 4, 5, 6] };
const dnd = () => ({ ...DND_DEFAULT, ...(setting('dnd') || {}) });
const hm = (s) => { const [a, b] = String(s).split(':').map(Number); return fmtTime(new Date(2026, 0, 1, a || 0, b || 0)); };
function daysLabel(days) {
  if (!days?.length || days.length === 7) return t('set.dnd.everyDay');
  const names = weekdayNames('short');
  return [...days].sort((a, b) => a - b).map((d) => names[d]).join(', ');
}
const schedLabel = (d) => `${hm(d.from)} – ${hm(d.to)} · ${daysLabel(d.days)}`;
export function dndSummary() {
  const d = dnd();
  return d.on ? t('set.dnd.onNow') : d.sched ? t('set.dnd.scheduled', { s: `${hm(d.from)} – ${hm(d.to)}` }) : t('common.off');
}

export function notificationsPage(body, ctx) {
  const appsRow = row({ icon: 'setApps', iconBg: '#ff7a2f', title: t('set.nt.apps'), sub: '', chevron: true, className: 'muted-sub', onClick: () => appNotifsPage(ctx) });
  const dndRow = row({ icon: 'dnd', iconBg: '#7a5cf0', title: t('set.dnd'), sub: dndSummary(), chevron: true, className: 'muted-sub', onClick: () => dndPage(ctx) });
  const drawSubs = () => {
    const n = muted().filter((id) => getApp(id)).length;
    subOf(appsRow, n ? t('set.nt.mutedN', { n }) : t('set.nt.allOn'));
    subOf(dndRow, dndSummary());
  };
  drawSubs();
  body.append(
    list(appsRow, dndRow),
    list(row({ icon: 'setHistory', iconBg: '#14a88f', title: t('set.nt.history'), sub: t('set.nt.historySub'), chevron: true, className: 'muted-sub', onClick: () => historyPage(ctx) })),
    card(h('div', { class: 'set-hint' }, t('set.notifHint'))),
    list(
      row({ icon: 'bell', title: t('set.testNotif'), onClick: () => import('../core/notify.js').then((m) => m.notify({ app: 'settings', title: t('set.testTitle'), body: t('set.testBody'), icon: 'bell' }) ?? toast(t('set.nt.mutedToast')) ) }),
      row({ icon: 'trash', title: t('set.clearNotifs'), onClick: () => import('../core/notify.js').then((m) => { m.clearNotifications(); toast(t('set.cleared')); }) })));
  return store.on('settings', drawSubs);
}

function appNotifsPage(ctx) {
  ctx.push({
    title: t('set.nt.apps'),
    render(body) {
      const apps = sortedApps();
      const rows = apps.map((a) => appRow(a, { right: { checked: !muted().includes(a.id), onChange: (on) => setMuted(a.id, !on) } }));
      body.append(card(h('div', { class: 'set-hint' }, t('set.nt.appsHint'))), list(...rows));
    },
  });
}

function dndPage(ctx) {
  ctx.push({
    title: t('set.dnd'),
    render(body) {
      const main = switchRow({ title: t('set.dnd'), sub: t('set.dnd.sub'), checked: dnd().on, onChange: (v) => setSetting('dnd', { ...dnd(), on: v }) });
      const sched = h('div', { class: 'ou-row clickable set-dnd-sched', role: 'button', tabindex: 0 });
      const drawSched = () => {
        const d = dnd();
        const s = h('label', { class: 'ou-switch', onClick: (e) => e.stopPropagation() },
          h('input', { type: 'checkbox', checked: d.sched, 'aria-label': t('set.dnd.sleeping'), onChange: (e) => setSetting('dnd', { ...dnd(), sched: e.target.checked }) }),
          h('span', { class: 'ou-switch-track' }, h('span', { class: 'ou-switch-thumb' })));
        sched.replaceChildren(
          h('span', { class: 'ou-row-ico', style: { background: '#5b5ff0', color: '#fff' }, html: icon('moon', 20) }),
          h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('set.dnd.sleeping')), h('span', { class: 'ou-row-sub' }, schedLabel(d))),
          h('span', { class: 'set-vline' }), s);
      };
      sched.addEventListener('click', () => editSchedule());
      sched.addEventListener('keydown', (e) => e.key === 'Enter' && editSchedule());
      drawSched();
      body.append(list(main), subheader(t('set.dnd.schedule')), list(sched), card(h('div', { class: 'set-hint' }, t('set.dnd.hint'))));
      return onSetting('dnd', () => { drawSched(); main.querySelector('input').checked = dnd().on; });
    },
  });
}

async function editSchedule() {
  const d = dnd();
  const from = h('input', { class: 'ou-input', type: 'time', value: d.from, 'aria-label': t('set.dnd.start') });
  const to = h('input', { class: 'ou-input', type: 'time', value: d.to, 'aria-label': t('set.dnd.end') });
  let days = new Set(d.days?.length ? d.days : DND_DEFAULT.days);
  const names = weekdayNames('narrow');
  const dayBox = h('div', { class: 'set-days' });
  const drawDays = () => dayBox.replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map((i) => h('button', { class: ['set-day', days.has(i) && 'on'], 'aria-pressed': String(days.has(i)), 'aria-label': weekdayNames('long')[i], onClick: () => { if (days.has(i) && days.size > 1) days.delete(i); else days.add(i); drawDays(); } }, names[i])));
  drawDays();
  const ok = await dialog({
    title: t('set.dnd.sleeping'),
    content: h('div', { class: 'ou-dialog-body set-dnd-edit' },
      h('label', { class: 'set-field' }, h('span', null, t('set.dnd.start')), from),
      h('label', { class: 'set-field' }, h('span', null, t('set.dnd.end')), to),
      dayBox),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.save'), value: true, primary: true }],
  });
  if (!ok) return;
  setSetting('dnd', { ...dnd(), sched: true, from: from.value || d.from, to: to.value || d.to, days: [...days].sort() });
}

function historyPage(ctx) {
  ctx.push({
    title: t('set.nt.history'),
    render(body) {
      const draw = () => {
        const items = (store.get('notifications') || []).slice().sort((a, b) => b.time - a.time);
        if (!items.length) return body.replaceChildren(h('div', { class: 'ou-empty' }, h('span', { html: icon('bell', 40) }), t('set.nt.none')));
        const groups = new Map();
        for (const n of items) {
          const k = new Date(n.time).toDateString();
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(n);
        }
        const out = [];
        for (const [k, list2] of groups) {
          out.push(subheader(fmtDate(new Date(k), { weekday: 'long', month: 'long', day: 'numeric' })));
          out.push(list(...list2.map((n) => {
            const app = getApp(n.app);
            const r = row({ title: n.title || (app ? appName(app) : ''), sub: [n.body, fmtTime(new Date(n.time))].filter(Boolean).join(' · '), className: 'muted-sub set-hist-row', onClick: app ? () => { closeApp(); setTimeout(() => openApp(app.id), 250); } : null });
            r.prepend(h('span', { class: 'set-app-ico' }, app ? appIconEl(app, 32) : h('span', { class: 'ou-row-ico', html: icon(n.icon || 'bell', 18) })));
            return r;
          })));
        }
        body.replaceChildren(...out);
      };
      draw();
      return store.on('notifications', draw);
    },
  });
}

// ——— Accessibility ———
export function textSizeRow() {
  const fmt = (v) => v + '%';
  const val = h('span', { class: 'set-slider-val' }, fmt(+setting('textScale') || 100));
  const s = slider({ min: 85, max: 150, step: 5, value: +setting('textScale') || 100, icon: 'font', label: t('set.ax.font'), onInput: (v) => { val.textContent = fmt(v); setSetting('textScale', v); } });
  s.classList.add('set-slider', 'set-text-slider');
  return h('div', { class: 'ou-row set-slider-row' }, h('div', { class: 'set-slider-head' }, h('span', { class: 'ou-row-title' }, t('set.ax.font')), val), s, h('div', { class: 'set-font-prev' }, h('small', null, 'A'), h('span', null, t('set.ax.fontPreview')), h('b', null, 'A')));
}

export function accessibilityPage(body, ctx, { open }) {
  body.append(
    subheader(t('set.ax.visibility')),
    list(
      switchRow({ title: t('set.ax.contrast'), sub: t('set.ax.contrastSub'), checked: !!setting('highContrast'), onChange: (v) => setSetting('highContrast', v) }),
      switchRow({ title: t('set.ax.transparency'), sub: t('set.ax.transparencySub'), checked: !setting('blur'), onChange: (v) => setSetting('blur', !v) }),
      switchRow({ title: t('set.reduceMotion'), sub: t('set.reduceMotionSub'), checked: !!setting('reduceMotion'), onChange: (v) => setSetting('reduceMotion', v) }),
      textSizeRow()),
    subheader(t('set.ax.interaction')),
    list(row({ icon: 'keyboard', title: t('set.shortcuts'), sub: t('set.shortcutsSub'), chevron: true, className: 'muted-sub', onClick: () => open('shortcuts') })),
    card(h('div', { class: 'set-hint' }, t('set.ax.hint'))));
}

// ——— Advanced features ———
export function advancedPage(body, ctx, { open }) {
  let winId = null;
  C?.windows?.getCurrent?.().then((w) => (winId = w.id)).catch(() => {});
  const panelRow = row({ icon: 'setPanel', iconBg: '#3e7bff', title: t('set.adv.panel'), sub: t('set.adv.panelSub'), className: 'muted-sub', onClick: () => {
    // straight from the click (the side panel needs the user's gesture)
    if (!C?.sidePanel?.open || winId == null) return toast(t('set.adv.panelKey'));
    C.sidePanel.open({ windowId: winId }).catch(() => toast(t('set.adv.panelKey')));
  } });
  body.append(
    subheader(t('set.adv.anyTab')),
    list(
      panelRow,
      row({ icon: 'home', iconBg: '#22b07d', title: t('set.adv.addHome'), sub: t('set.adv.addHomeSub'), className: 'muted-sub' }),
      row({ icon: 'setCapture', iconBg: '#ff7a2f', title: t('set.adv.capture'), sub: t('set.adv.captureSub'), className: 'muted-sub' }),
      row({ icon: 'external', title: t('set.adv.chromeKeys'), sub: t('set.adv.chromeKeysSub'), className: 'muted-sub', onClick: () => (C?.tabs ? C.tabs.create({ url: 'chrome://extensions/shortcuts' }) : toast(t('set.adv.chromeKeysSub'))) })),
    list(
      row({ icon: 'keyboard', iconBg: '#5b6472', title: t('set.shortcuts'), sub: t('set.shortcutsSub'), chevron: true, className: 'muted-sub', onClick: () => open('shortcuts') }),
      row({ icon: 'setLabs', iconBg: '#8e6bff', title: t('set.labs'), sub: t('set.labsSub'), chevron: true, className: 'muted-sub', onClick: () => labsPage(ctx) })));
}

function labsPage(ctx) {
  ctx.push({
    title: t('set.labs'),
    render(body) {
      const lab = (key, title, sub) => switchRow({ title, sub, checked: !!setting(key), onChange: (v) => setSetting(key, v) });
      body.append(
        card(h('div', { class: 'set-hint' }, t('set.labs.hint'))),
        list(
          lab('wallLiveBehindApps', t('set.labs.live'), t('set.labs.liveSub')),
          lab('wallSmooth', t('set.labs.smooth'), t('set.labs.smoothSub')),
          lab('genDaily', t('set.labs.daily'), t('set.labs.dailySub'))));
    },
  });
}

// ——— General management › Reset ———
export function resetPage(ctx) {
  ctx.push({
    title: t('set.reset.title'),
    render(body) {
      body.append(list(
        row({ icon: 'setReset', title: t('set.reset.settings'), sub: t('set.reset.settingsSub'), className: 'muted-sub', onClick: async () => {
          if (!(await confirm(t('set.reset.settings'), t('set.reset.settingsMsg'), { okLabel: t('set.reset'), danger: true }))) return;
          const cur = store.get('settings');
          // the language, the welcome tour and the wallpaper's photos aren't settings to lose
          store.set('settings', { lang: cur.lang, onboarded: cur.onboarded, seenVersion: cur.seenVersion });
          toast(t('set.reset.done'));
        } }),
        row({ icon: 'home', title: t('set.resetHome'), sub: t('set.resetHomeSub'), className: 'muted-sub', onClick: async () => {
          if (!(await confirm(t('set.resetHome'), t('set.resetHomeConfirm'), { okLabel: t('set.reset'), danger: true }))) return;
          await (await import('../shell/home.js')).resetHome();
          toast(t('set.resetDone'));
        } })),
      list(row({ icon: 'trash', title: t('set.resetAll'), sub: t('set.resetAllSub'), className: 'muted-sub danger-row', onClick: async () => {
        if (await confirm(t('set.resetAll'), t('set.resetAllConfirm'), { okLabel: t('set.reset'), danger: true })) await eraseAll();
      } })));
    },
  });
}

/** Erase all data (General management › Reset): the same as Backup › Reset everything (js/shell/pin.js). */
export async function eraseAll() {
  await import('../shell/pin.js').then((m) => m.eraseEverything());
  location.reload();
}

// ——— Sync with Chrome ———
const CAT_APP = { notes: 'notes', reminders: 'reminder', calendar: 'calendar', clock: 'clock', contacts: 'contacts', wallet: 'wallet', routines: 'routines', wellbeing: 'wellbeing' };
const syncPrefs = () => ({ on: false, off: [], ...(store.get('syncPrefs') || {}) });
const send = (msg) => (C?.runtime?.sendMessage ? C.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null));

export function syncPage(body) {
  const status = h('div', { class: 'set-stack' });
  const cats = h('div', { class: 'set-stack' });
  const mainSw = switchRow({ icon: 'setSync', iconBg: '#2f8cff', title: t('set.sy.title'), sub: t('set.sy.sub'), checked: syncPrefs().on, onChange: (on) => store.set('syncPrefs', { ...syncPrefs(), on }) });
  const drawStatus = () => {
    const p = syncPrefs(), st = store.get('syncStatus');
    status.hidden = !p.on;
    if (!p.on) return status.replaceChildren();
    const used = st?.used || 0;
    const nowRow = row({ icon: 'refresh', title: t('set.sy.now'), className: 'set-sync-now', onClick: async () => {
      nowRow.classList.add('busy');
      subOf(stRow, t('set.sy.syncing'));
      await send({ type: 'sync-now' });
      nowRow.classList.remove('busy');
      drawStatus();
    } });
    const stRow = row({ title: t('set.sy.last'), sub: st?.error ? t('set.sy.error', { e: st.error.message || st.error }) : st?.at ? fmtRelative(st.at) : t('set.sy.waiting'), className: st?.error ? 'set-sync-err' : 'muted-sub' });
    const bar = h('div', { class: 'set-meter' }, h('i', { style: { width: Math.min(100, (used / 102400) * 100) + '%' } }));
    status.replaceChildren(
      list(stRow, nowRow,
        h('div', { class: 'ou-row set-usage' }, h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('set.sy.used')), h('span', { class: 'ou-row-sub' }, t('set.sy.usedOf', { n: fmtBytes(used) }))), bar)),
      used > 90 * 1024 ? card(h('div', { class: 'set-hint' }, t('set.sy.full'))) : '');
  };
  const drawCats = () => {
    const p = syncPrefs();
    cats.hidden = !p.on;
    if (!p.on) return cats.replaceChildren();
    cats.replaceChildren(subheader(t('set.sy.what')), list(...SYNC_CATEGORIES.map((c) => {
      const app = CAT_APP[c.id] && getApp(CAT_APP[c.id]);
      if (CAT_APP[c.id] && !app) return null;
      const on = !(p.off || []).includes(c.id);
      const change = (v) => store.set('syncPrefs', { ...syncPrefs(), off: v ? (syncPrefs().off || []).filter((x) => x !== c.id) : [...new Set([...(syncPrefs().off || []), c.id])] });
      if (app) return appRow(app, { right: { checked: on, onChange: change } });
      const r = switchRow({ icon: c.id === 'home' ? 'home' : 'settings', iconBg: c.id === 'home' ? '#3e7bff' : '#6f7d95', title: c.id === 'home' ? t('set.homeScreen') : t('set.title'), sub: t('set.sy.cat.' + c.id), checked: on, onChange: change });
      r.classList.add('muted-sub');
      r.dataset.cat = c.id;
      return r;
    }).filter(Boolean)),
    list(row({ icon: 'trash', title: t('set.sy.erase'), sub: t('set.sy.eraseSub'), className: 'muted-sub danger-row', onClick: async () => {
      if (!(await confirm(t('set.sy.erase'), t('set.sy.eraseMsg'), { okLabel: t('common.delete'), danger: true }))) return;
      await send({ type: 'sync-erase' });
      toast(t('set.sy.erased'));
    } })));
  };
  drawStatus();
  drawCats();
  body.append(
    h('div', { class: 'set-sync-hero' }, h('span', { class: 'set-sync-ico', html: icon('setSync', 40) }), h('p', null, t('set.sy.hero'))),
    list(mainSw), status, cats,
    card(h('div', { class: 'set-hint strong' }, t('set.sy.neverTitle')), h('div', { class: 'set-hint' }, t('set.sy.never'))));
  const offs = [
    store.on('syncPrefs', () => { mainSw.querySelector('input').checked = syncPrefs().on; drawStatus(); drawCats(); }),
    store.on('syncStatus', drawStatus),
  ];
  return () => offs.forEach((f) => f());
}

// ——— Backup: pictures and recordings (IndexedDB) as data URLs inside the backup file ———
const SKIP_BLOBS = /^music:/; // songs are far too big for a JSON file
export async function exportBlobs() {
  const B = await import('../core/blobs.js');
  const out = {};
  for (const k of await B.listBlobs('')) {
    if (SKIP_BLOBS.test(k)) continue;
    const b = await B.getBlob(k).catch(() => null);
    if (!(b instanceof Blob)) continue;
    out[k] = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  }
  return out;
}
export async function importBlobs(map) {
  if (!map || typeof map !== 'object') return 0;
  const B = await import('../core/blobs.js');
  let n = 0;
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string' || !v.startsWith('data:')) continue;
    await B.putBlob(k, await B.dataUrlToBlob(v)).then(() => n++).catch(() => {});
  }
  return n;
}
/** Local keys that describe this computer's sync and never go into a backup (or come out of one). */
export const DEVICE_KEYS = ['syncPrefs', 'syncState', 'syncDirty', 'syncStatus', 'syncDevice'];

// ——— Keyboard shortcuts (every one that exists: js/shell/keys.js, the shell's panels, the apps' own handlers) ———
const K = (keys, label) => ({ keys, label });
const SHORTCUTS = [
  { title: 'set.key.sec.anywhere', keys: [
    K('Ctrl K  ·  /', 'set.key.finder'), K('set.key.anyLetter', 'set.key.type'), K('Alt A  ·  ↑', 'set.key.apps'), K('Alt Q  ·  ↓', 'set.key.qp'),
    K('Alt E', 'set.key.edge'), K('Alt R', 'set.key.recents'), K('Alt L', 'set.key.lock'), K('Alt ,', 'set.key.settings'),
    K('← →', 'set.key.pages'), K('Esc', 'set.key.esc'),
  ] },
  { title: 'set.key.sec.finder', keys: [K('↑ ↓', 'set.key.results'), K('Enter', 'set.key.openResult'), K('Tab', 'set.key.ai')] },
  { title: 'set.key.sec.recents', keys: [K('← →', 'set.key.recentsMove'), K('Enter', 'set.key.recentsOpen'), K('Delete', 'set.key.recentsClose')] },
  { title: 'set.key.sec.home', keys: [K('Ctrl Z  ·  Ctrl Y', 'set.key.homeUndo'), K('set.key.ctrlClick', 'set.key.newTab')] },
  { title: 'set.key.sec.anyTab', keys: [
    K('Alt Shift H', 'set.key.addHome'), K('Alt Shift Q', 'set.key.capture'), K('Ctrl Enter', 'set.key.captureSave'),
    K('Alt N · R · J · L', 'set.key.captureModes'), K('Alt Shift L', 'set.key.panel'), K('Alt 1 – 5', 'set.key.panelTabs'),
  ] },
  { app: 'notes', keys: [K('Ctrl Z  ·  Ctrl Y', 'set.key.undoRedo'), K('Ctrl Shift 9', 'set.key.checklist'), K('Tab', 'set.key.tableTab')] },
  { app: 'calendar', keys: [
    K('T', 'set.key.today'), K('N  ·  Enter', 'set.key.newEvent'), K('G', 'set.key.goDate'), K('Y · M · W · D · L', 'set.key.calViews'),
    K('← → ↑ ↓', 'set.key.calMove'), K('Page Up  ·  Page Down', 'set.key.calPage'), K('Ctrl F  ·  /', 'set.key.search'),
  ] },
  { app: 'canvas', keys: [
    K('N', 'set.key.newBoard'), K('Ctrl F', 'set.key.search'), K('Ctrl Z  ·  Ctrl Y', 'set.key.undoRedo'), K('Ctrl A', 'set.key.selectAll'),
    K('Ctrl C · X · V', 'set.key.copyPaste'), K('Ctrl D', 'set.key.duplicate'), K('Ctrl G  ·  Ctrl Shift G', 'set.key.group'),
    K('Ctrl L', 'set.key.lockItem'), K('Ctrl Shift F · B', 'set.key.frontBack'), K('Ctrl Alt F · B', 'set.key.fwdBwd'),
    K('+ · − · 0 · 1', 'set.key.zoom'), K('set.key.spaceDrag', 'set.key.pan'), K('← → ↑ ↓', 'set.key.nudge'), K('Delete', 'set.key.delete'),
    K('Ctrl S', 'set.key.exportPng'), K('Ctrl P', 'set.key.print'),
  ] },
  { app: 'contacts', keys: [K('Ctrl F', 'set.key.search'), K('Ctrl Enter  ·  Ctrl S', 'set.key.saveContact')] },
  { app: 'music', keys: [K('Ctrl F', 'set.key.search'), K('Alt ← →', 'set.key.musicSkip')] },
  { app: 'journal', keys: [K('Ctrl F', 'set.key.search')] },
  { app: 'recorder', keys: [K('Ctrl F', 'set.key.search')] },
  { app: 'calculator', keys: [K('0–9 + − × ÷ % ( )', 'set.key.calcType'), K('Enter', 'set.key.calcEq'), K('Backspace', 'set.key.calcBack'), K('Ctrl C', 'set.key.calcCopy')] },
  { app: 'games', keys: [K('P', 'set.key.pause'), K('Ctrl Z', 'set.key.undoMove'), K('← → ↑ ↓', 'set.key.gameMove')] },
];
export function shortcutsPage(body) {
  for (const sec of SHORTCUTS) {
    const app = sec.app && getApp(sec.app);
    if (sec.app && !app) continue;
    body.append(subheader(app ? appName(app) : t(sec.title)), list(...sec.keys.map(({ keys, label }) => row({ title: t(label), right: h('kbd', { class: 'set-kbd', dir: 'ltr' }, keys.startsWith('set.') ? t(keys) : keys) }))));
  }
  body.append(card(h('div', { class: 'set-hint' }, t('set.key.mac'))));
}

addStrings({
  en: {
    'set.key.sec.anywhere': 'Anywhere in Bloom Tab',
    'set.key.anyLetter': 'Any letter',
    'set.key.ctrlClick': 'Ctrl + click',
    'set.key.spaceDrag': 'Space + drag',
    'set.key.sec.finder': 'Finder',
    'set.key.sec.recents': 'Recent apps',
    'set.key.sec.home': 'Home screen',
    'set.key.sec.anyTab': 'On any website',
    'set.key.recents': 'Recent apps',
    'set.key.results': 'Choose a result',
    'set.key.openResult': 'Open it',
    'set.key.recentsMove': 'Move between apps',
    'set.key.recentsOpen': 'Open the app',
    'set.key.recentsClose': 'Close the app',
    'set.key.homeUndo': 'Editing the Home screen: undo, redo',
    'set.key.newTab': 'Open a website in a new tab',
    'set.key.capture': 'Quick capture',
    'set.key.captureSave': 'Quick capture: save',
    'set.key.captureModes': 'Quick capture: note, reminder, journal, log',
    'set.key.panel': 'Open the side panel',
    'set.key.panelTabs': 'Side panel: switch tabs',
    'set.key.undoRedo': 'Undo, redo',
    'set.key.checklist': 'Checklist',
    'set.key.tableTab': 'Next table cell',
    'set.key.today': 'Today',
    'set.key.newEvent': 'New event',
    'set.key.goDate': 'Go to date',
    'set.key.calViews': 'Year, month, week, day, list',
    'set.key.calMove': 'Move between days',
    'set.key.calPage': 'Previous, next',
    'set.key.search': 'Search',
    'set.key.newBoard': 'New board',
    'set.key.selectAll': 'Select all',
    'set.key.copyPaste': 'Copy, cut, paste',
    'set.key.duplicate': 'Duplicate',
    'set.key.group': 'Group, ungroup',
    'set.key.lockItem': 'Lock, unlock',
    'set.key.frontBack': 'Bring to front, send to back',
    'set.key.fwdBwd': 'Bring forward, send backward',
    'set.key.zoom': 'Zoom in, out, 100%, fit',
    'set.key.pan': 'Move around the board',
    'set.key.nudge': 'Nudge (with Shift: 10 px)',
    'set.key.delete': 'Delete',
    'set.key.exportPng': 'Save as PNG',
    'set.key.print': 'Print',
    'set.key.saveContact': 'Save (editor)',
    'set.key.musicSkip': 'Full player: next, previous',
    'set.key.calcType': 'Type the calculation',
    'set.key.calcEq': 'Equals',
    'set.key.calcBack': 'Delete the last character',
    'set.key.calcCopy': 'Copy the result',
    'set.key.pause': 'Pause, resume',
    'set.key.undoMove': 'Undo a move',
    'set.key.gameMove': 'Move (2048, Sudoku, Minesweeper)',
    'set.key.mac': 'On a Mac, use ⌘ for Ctrl and Option for Alt.',
    'set.acc.title': 'Profile',
    'set.acc.local': 'Kept on this computer · no account needed',
    'set.acc.addName': 'Add your name',
    'set.acc.editName': 'Edit name',
    'set.acc.name': 'Your name',
    'set.acc.namePh': 'Name',
    'set.apps.count': '{n} apps',
    'set.apps.notifOff': 'Notifications off',
    'set.app.open': 'Open',
    'set.app.notifOnSub': 'Allowed',
    'set.app.notifOffSub': 'Blocked: this app’s notifications won’t appear',
    'set.app.size': 'Window size',
    'set.app.sizePhone': 'Pop-up view',
    'set.app.sizePhoneSub': 'Phone-size window',
    'set.app.sizeWide': 'Large pop-up view',
    'set.app.sizeWideSub': 'Tablet-size window',
    'set.app.sizeMax': 'Full screen',
    'set.app.addHome': 'Add to Home screen',
    'set.app.onHome': 'Already on the Home screen',
    'set.app.storage': 'Storage',
    'set.nt.apps': 'App notifications',
    'set.nt.appsHint': 'Choose which apps can send you notifications.',
    'set.nt.allOn': 'All apps allowed',
    'set.nt.mutedN': '{n} apps blocked',
    'set.nt.mutedToast': 'Settings notifications are off',
    'set.nt.history': 'Notification history',
    'set.nt.historySub': 'Notifications you received recently',
    'set.nt.none': 'No notifications',
    'set.dnd': 'Do not disturb',
    'set.dnd.sub': 'Notifications arrive silently, without pop-ups',
    'set.dnd.onNow': 'On',
    'set.dnd.scheduled': 'Scheduled · {s}',
    'set.dnd.schedule': 'Schedule',
    'set.dnd.sleeping': 'Sleeping',
    'set.dnd.everyDay': 'Every day',
    'set.dnd.start': 'Start time',
    'set.dnd.end': 'End time',
    'set.dnd.hint': 'Alarms and timers still ring. Everything else goes quietly into the notification list.',
    'set.ax.visibility': 'Visibility enhancements',
    'set.ax.contrast': 'High contrast fonts',
    'set.ax.contrastSub': 'Darker secondary text and outlined text on the wallpaper',
    'set.ax.transparency': 'Reduce transparency and blur',
    'set.ax.transparencySub': 'Use solid backgrounds instead of blurred glass',
    'set.ax.font': 'Font size',
    'set.ax.fontPreview': 'Bloom Tab text',
    'set.ax.interaction': 'Interaction and dexterity',
    'set.ax.hint': 'Chrome’s own zoom (Ctrl + and Ctrl −) makes everything bigger too.',
    'set.adv.anyTab': 'On any website',
    'set.adv.panel': 'Side panel',
    'set.adv.panelSub': 'Notes, Reminder, Timer, Calculator and Music beside any website · Alt+Shift+L',
    'set.adv.panelKey': 'Press Alt+Shift+L on any tab to open the side panel',
    'set.adv.addHome': 'Add to Home screen',
    'set.adv.addHomeSub': 'Right-click a page, click the toolbar button or press Alt+Shift+H',
    'set.adv.capture': 'Quick capture',
    'set.adv.captureSub': 'Save a note, reminder, journal entry or log from any page · Alt+Shift+Q',
    'set.adv.chromeKeys': 'Change shortcuts in Chrome',
    'set.adv.chromeKeysSub': 'chrome://extensions/shortcuts',
    'set.labs': 'Labs',
    'set.labsSub': 'Try experimental features',
    'set.labs.hint': 'Experimental features. They may change or go away in a future version.',
    'set.labs.live': 'Keep live wallpaper moving behind apps',
    'set.labs.liveSub': 'By default it pauses while app windows are open, to keep them smooth',
    'set.labs.smooth': 'Smoother live wallpaper',
    'set.labs.smoothSub': 'Twice the frame rate, using more power',
    'set.labs.daily': 'New Creative wallpaper every day',
    'set.labs.dailySub': 'A fresh take on your description each morning',
    'set.reset.title': 'Reset',
    'set.reset.settings': 'Reset all settings',
    'set.reset.settingsSub': 'Your data stays: notes, events, Home screen and the rest',
    'set.reset.settingsMsg': 'All settings go back to how they were at the start. Your data isn’t deleted.',
    'set.reset.done': 'Settings reset',
    'set.sy.title': 'Sync with Chrome',
    'set.sy.sub': 'Uses your Chrome profile’s sync',
    'set.sy.hero': 'Keep your settings, Home screen, notes, reminders, events, alarms and more the same on every computer where you’re signed in to Chrome with sync turned on. Nothing goes through our servers.',
    'set.sy.off': 'Off',
    'set.sy.failed': 'Couldn’t sync',
    'set.sy.lastAt': 'Synced {t}',
    'set.sy.waiting': 'Waiting to sync…',
    'set.sy.syncing': 'Syncing…',
    'set.sy.last': 'Last synced',
    'set.sy.error': 'Couldn’t sync: {e}',
    'set.sy.now': 'Sync now',
    'set.sy.used': 'Chrome sync storage',
    'set.sy.usedOf': '{n} of 100 KB',
    'set.sy.full': 'Chrome sync is almost full. Long notes and many contacts take the most space: turn off what you don’t need on other computers.',
    'set.sy.what': 'Sync these',
    'set.sy.cat.settings': 'Display, wallpaper, Lock screen and more',
    'set.sy.cat.home': 'Apps, websites, folders, widgets and the dock',
    'set.sy.erase': 'Erase synced data',
    'set.sy.eraseSub': 'Remove Bloom Tab’s copy from Chrome sync',
    'set.sy.eraseMsg': 'Bloom Tab’s data will be removed from Chrome sync. What’s on this computer stays.',
    'set.sy.erased': 'Synced data erased',
    'set.sy.neverTitle': 'Never synced',
    'set.sy.never': 'Photos and wallpapers from your gallery, recordings, music, Journal, Samsung Health, screen time, Canvas boards, games, locked notes and your screen lock PIN stay on this computer. So do the language, lock timing and brightness.',
  },
  ar: {
    'set.key.sec.anywhere': 'في أي مكان في Bloom Tab',
    'set.key.anyLetter': 'أي حرف',
    'set.key.ctrlClick': 'Ctrl + نقرة',
    'set.key.spaceDrag': 'مسافة + سحب',
    'set.key.sec.finder': 'Finder',
    'set.key.sec.recents': 'التطبيقات الحديثة',
    'set.key.sec.home': 'الشاشة الرئيسية',
    'set.key.sec.anyTab': 'على أي موقع',
    'set.key.recents': 'التطبيقات الحديثة',
    'set.key.results': 'اختيار نتيجة',
    'set.key.openResult': 'فتحها',
    'set.key.recentsMove': 'التنقل بين التطبيقات',
    'set.key.recentsOpen': 'فتح التطبيق',
    'set.key.recentsClose': 'إغلاق التطبيق',
    'set.key.homeUndo': 'أثناء تعديل الشاشة الرئيسية: تراجع، إعادة',
    'set.key.newTab': 'فتح موقع في تبويب جديد',
    'set.key.capture': 'الالتقاط السريع',
    'set.key.captureSave': 'الالتقاط السريع: حفظ',
    'set.key.captureModes': 'الالتقاط السريع: ملاحظة، تذكير، يوميات، سجل',
    'set.key.panel': 'فتح اللوحة الجانبية',
    'set.key.panelTabs': 'اللوحة الجانبية: التبديل بين علامات التبويب',
    'set.key.undoRedo': 'تراجع، إعادة',
    'set.key.checklist': 'قائمة تحقق',
    'set.key.tableTab': 'خلية الجدول التالية',
    'set.key.today': 'اليوم',
    'set.key.newEvent': 'حدث جديد',
    'set.key.goDate': 'الانتقال إلى تاريخ',
    'set.key.calViews': 'سنة، شهر، أسبوع، يوم، قائمة',
    'set.key.calMove': 'التنقل بين الأيام',
    'set.key.calPage': 'السابق، التالي',
    'set.key.search': 'بحث',
    'set.key.newBoard': 'لوحة جديدة',
    'set.key.selectAll': 'تحديد الكل',
    'set.key.copyPaste': 'نسخ، قص، لصق',
    'set.key.duplicate': 'تكرار',
    'set.key.group': 'تجميع، فك التجميع',
    'set.key.lockItem': 'قفل، إلغاء القفل',
    'set.key.frontBack': 'إحضار إلى الأمام، إرسال إلى الخلف',
    'set.key.fwdBwd': 'تقديم خطوة، تأخير خطوة',
    'set.key.zoom': 'تكبير، تصغير، 100%، ملاءمة',
    'set.key.pan': 'التنقل في اللوحة',
    'set.key.nudge': 'تحريك بسيط (مع Shift: 10 بكسل)',
    'set.key.delete': 'حذف',
    'set.key.exportPng': 'حفظ كصورة PNG',
    'set.key.print': 'طباعة',
    'set.key.saveContact': 'حفظ (المحرر)',
    'set.key.musicSkip': 'المشغل الكامل: التالي، السابق',
    'set.key.calcType': 'كتابة العملية الحسابية',
    'set.key.calcEq': 'يساوي',
    'set.key.calcBack': 'حذف آخر حرف',
    'set.key.calcCopy': 'نسخ النتيجة',
    'set.key.pause': 'إيقاف مؤقت، استئناف',
    'set.key.undoMove': 'التراجع عن نقلة',
    'set.key.gameMove': 'تحريك (2048، سودوكو، كاسحة الألغام)',
    'set.key.mac': 'على Mac، استخدم ⌘ بدلًا من Ctrl و Option بدلًا من Alt.',
    'set.acc.title': 'الملف الشخصي',
    'set.acc.local': 'محفوظ على هذا الكمبيوتر · لا حاجة إلى حساب',
    'set.acc.addName': 'إضافة اسمك',
    'set.acc.editName': 'تعديل الاسم',
    'set.acc.name': 'اسمك',
    'set.acc.namePh': 'الاسم',
    'set.apps.count': '{n} تطبيقًا',
    'set.apps.notifOff': 'الإشعارات متوقفة',
    'set.app.open': 'فتح',
    'set.app.notifOnSub': 'مسموح بها',
    'set.app.notifOffSub': 'محظورة: لن تظهر إشعارات هذا التطبيق',
    'set.app.size': 'حجم النافذة',
    'set.app.sizePhone': 'العرض المنبثق',
    'set.app.sizePhoneSub': 'نافذة بحجم الهاتف',
    'set.app.sizeWide': 'العرض المنبثق الكبير',
    'set.app.sizeWideSub': 'نافذة بحجم الجهاز اللوحي',
    'set.app.sizeMax': 'ملء الشاشة',
    'set.app.addHome': 'إضافة إلى الشاشة الرئيسية',
    'set.app.onHome': 'موجود على الشاشة الرئيسية',
    'set.app.storage': 'التخزين',
    'set.nt.apps': 'إشعارات التطبيقات',
    'set.nt.appsHint': 'اختر التطبيقات التي يمكنها إرسال إشعارات إليك.',
    'set.nt.allOn': 'كل التطبيقات مسموح بها',
    'set.nt.mutedN': '{n} تطبيقات محظورة',
    'set.nt.mutedToast': 'إشعارات الإعدادات متوقفة',
    'set.nt.history': 'سجل الإشعارات',
    'set.nt.historySub': 'الإشعارات التي تلقيتها مؤخرًا',
    'set.nt.none': 'لا توجد إشعارات',
    'set.dnd': 'عدم الإزعاج',
    'set.dnd.sub': 'تصل الإشعارات بصمت، دون نوافذ منبثقة',
    'set.dnd.onNow': 'قيد التشغيل',
    'set.dnd.scheduled': 'مجدول · {s}',
    'set.dnd.schedule': 'الجدول',
    'set.dnd.sleeping': 'النوم',
    'set.dnd.everyDay': 'كل يوم',
    'set.dnd.start': 'وقت البدء',
    'set.dnd.end': 'وقت الانتهاء',
    'set.dnd.hint': 'تبقى المنبهات والمؤقتات ترن. أما الباقي فيذهب بهدوء إلى قائمة الإشعارات.',
    'set.ax.visibility': 'تحسينات الرؤية',
    'set.ax.contrast': 'خطوط عالية التباين',
    'set.ax.contrastSub': 'نص ثانوي أغمق ونص محدد على الخلفية',
    'set.ax.transparency': 'تقليل الشفافية والتمويه',
    'set.ax.transparencySub': 'استخدام خلفيات مصمتة بدلًا من الزجاج المموّه',
    'set.ax.font': 'حجم الخط',
    'set.ax.fontPreview': 'نص Bloom Tab',
    'set.ax.interaction': 'التفاعل والمهارة',
    'set.ax.hint': 'تكبير Chrome نفسه (Ctrl + و Ctrl −) يكبّر كل شيء أيضًا.',
    'set.adv.anyTab': 'على أي موقع',
    'set.adv.panel': 'اللوحة الجانبية',
    'set.adv.panelSub': 'الملاحظات والتذكير والمؤقت والآلة الحاسبة والموسيقى بجانب أي موقع · Alt+Shift+L',
    'set.adv.panelKey': 'اضغط Alt+Shift+L في أي تبويب لفتح اللوحة الجانبية',
    'set.adv.addHome': 'إضافة إلى الشاشة الرئيسية',
    'set.adv.addHomeSub': 'انقر بزر الماوس الأيمن على صفحة أو انقر زر شريط الأدوات أو اضغط Alt+Shift+H',
    'set.adv.capture': 'الالتقاط السريع',
    'set.adv.captureSub': 'احفظ ملاحظة أو تذكيرًا أو تدوينة يوميات أو سجلًا من أي صفحة · Alt+Shift+Q',
    'set.adv.chromeKeys': 'تغيير الاختصارات في Chrome',
    'set.adv.chromeKeysSub': 'chrome://extensions/shortcuts',
    'set.labs': 'المختبر',
    'set.labsSub': 'جرّب ميزات تجريبية',
    'set.labs.hint': 'ميزات تجريبية. قد تتغير أو تختفي في إصدار قادم.',
    'set.labs.live': 'إبقاء الخلفية المتحركة تتحرك خلف التطبيقات',
    'set.labs.liveSub': 'تتوقف افتراضيًا أثناء فتح نوافذ التطبيقات لتبقى سلسة',
    'set.labs.smooth': 'خلفية متحركة أكثر سلاسة',
    'set.labs.smoothSub': 'ضعف معدل الإطارات مع استهلاك طاقة أكبر',
    'set.labs.daily': 'خلفية إبداعية جديدة كل يوم',
    'set.labs.dailySub': 'نسخة جديدة من وصفك كل صباح',
    'set.reset.title': 'إعادة الضبط',
    'set.reset.settings': 'إعادة ضبط كل الإعدادات',
    'set.reset.settingsSub': 'تبقى بياناتك: الملاحظات والأحداث والشاشة الرئيسية وغيرها',
    'set.reset.settingsMsg': 'ستعود كل الإعدادات إلى ما كانت عليه في البداية. لن تُحذف بياناتك.',
    'set.reset.done': 'تمت إعادة ضبط الإعدادات',
    'set.sy.title': 'المزامنة مع Chrome',
    'set.sy.sub': 'تستخدم مزامنة ملفك الشخصي في Chrome',
    'set.sy.hero': 'اجعل إعداداتك وشاشتك الرئيسية وملاحظاتك وتذكيراتك وأحداثك ومنبهاتك وغيرها متطابقة على كل كمبيوتر سجّلت فيه الدخول إلى Chrome مع تشغيل المزامنة. لا يمر أي شيء عبر خوادمنا.',
    'set.sy.off': 'متوقفة',
    'set.sy.failed': 'تعذرت المزامنة',
    'set.sy.lastAt': 'تمت المزامنة {t}',
    'set.sy.waiting': 'في انتظار المزامنة…',
    'set.sy.syncing': 'جارٍ المزامنة…',
    'set.sy.last': 'آخر مزامنة',
    'set.sy.error': 'تعذرت المزامنة: {e}',
    'set.sy.now': 'المزامنة الآن',
    'set.sy.used': 'مساحة مزامنة Chrome',
    'set.sy.usedOf': '{n} من 100 كيلوبايت',
    'set.sy.full': 'مساحة مزامنة Chrome ممتلئة تقريبًا. الملاحظات الطويلة وكثرة جهات الاتصال تأخذ أكبر مساحة: أوقف ما لا تحتاجه على أجهزة الكمبيوتر الأخرى.',
    'set.sy.what': 'مزامنة هذه',
    'set.sy.cat.settings': 'الشاشة والخلفية وشاشة القفل وغيرها',
    'set.sy.cat.home': 'التطبيقات والمواقع والمجلدات والأدوات وشريط التطبيقات',
    'set.sy.erase': 'مسح البيانات المتزامنة',
    'set.sy.eraseSub': 'إزالة نسخة Bloom Tab من مزامنة Chrome',
    'set.sy.eraseMsg': 'ستُزال بيانات Bloom Tab من مزامنة Chrome. ويبقى ما على هذا الكمبيوتر.',
    'set.sy.erased': 'تم مسح البيانات المتزامنة',
    'set.sy.neverTitle': 'لا تُزامَن أبدًا',
    'set.sy.never': 'الصور وخلفيات معرضك والتسجيلات والموسيقى واليوميات وSamsung Health ووقت الشاشة ولوحات Canvas والألعاب والملاحظات المقفلة ورمز PIN لقفل الشاشة تبقى على هذا الكمبيوتر. وكذلك اللغة وتوقيت القفل والسطوع.',
  },
});
