// Modes and Routines (One UI): two tabs on the floating bottom bar. Modes: Samsung's six modes plus your own, each
// with a page (Turn on, Turn on automatically, Do not disturb, display and sound, more actions). Routines: your
// routines as If → Then cards with Start/Stop or an on/off switch, Discover's ready-made routines, and the editor
// (js/routines/editor.js). Sections from notifications, Finder and widgets: 'modes' | 'routines' | 'discover' |
// 'm:<mode id>' | 'r:<routine id>' | 'new' | 'pending'.
import { h, uid } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, addStrings, fmtTime, lang } from '../core/i18n.js';
import { store } from '../core/store.js';
import { dialog, menu, toast, iconBtn, row, switchRow, list, subheader, sw, confirm, slider } from '../core/ui.js';
import { SOUNDS } from '../shell/sounds.js';
import { PRESETS, paintPreset, presetById } from '../shell/wallpaper.js';
import { KEY, RUN_KEY, norm, normMode, presetMode, newRoutine, isManual, COLORS, ALL_DAYS, normCond } from './model.js';
import { rdata, rrun, activeMode, modeName, routineName, roundIcon } from '../apps/routines.js';
import { DISCOVER } from './discover.js';
import { chain, condSub, specText, daysText } from './labels.js';
import * as P from './page.js';
import { openEditor, actionsCard, editTime, styleDialog } from './editor.js';

const LAST_TAB = 'bt.routines.tab';
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export function render(ctx) {
  let cleanup = null;
  const show = (tab) => {
    try { cleanup?.(); } catch {}
    lsSet(LAST_TAB, tab);
    const bar = h('nav', { class: 'ou-tabs rt-tabs' }, [['modes', 'rtModes'], ['routines', 'rtRoutine']].map(([id, ic]) =>
      h('button', { class: ['ou-tab', id === tab && 'active'], 'aria-pressed': String(id === tab), onClick: () => id !== tab && show(id) },
        h('span', { html: icon(ic, 20) }), h('span', null, t('routines.tab.' + id)))));
    cleanup = (tab === 'modes' ? modesView : routinesView)(ctx, bar);
  };
  const section = (s = '') => {
    if (s.startsWith('m:')) { show('modes'); if (rdata().modes.some((m) => m.id === s.slice(2))) openMode(ctx, s.slice(2)); }
    else if (s.startsWith('r:')) { show('routines'); if (rdata().list.some((r) => r.id === s.slice(2))) openEditor(ctx, { id: s.slice(2) }); }
    else if (s === 'new') { show('routines'); openEditor(ctx, { draft: newRoutine() }); }
    else if (s === 'discover') { show('routines'); openDiscover(ctx); }
    else if (s === 'routines' || s === 'pending') show('routines');
    else if (s === 'modes') show('modes');
    else show(lsGet(LAST_TAB, 'modes') === 'routines' ? 'routines' : 'modes');
  };
  ctx.setParams = (p) => section(p?.section);
  section(ctx.params.section);
  return () => cleanup?.();
}

// ——— Modes ———
const modeRunOff = () => P.turnOffMode();
export const saveMode = (m) => store.update(KEY, (v) => { const d = norm(v); const i = d.modes.findIndex((x) => x.id === m.id); if (i >= 0) d.modes[i] = normMode(m); else d.modes.push(normMode(m)); return d; });
const removeMode = (id) => store.update(KEY, (v) => { const d = norm(v); d.modes = d.modes.filter((x) => x.id !== id); return d; });

/** "Do not disturb, Dark mode +2" — what a mode turns on. */
function modeSummary(m) {
  const parts = [];
  if (m.dnd) parts.push(t('routines.m.dnd'));
  if (m.dark) parts.push(t('routines.a.theme'));
  if (m.eye) parts.push(t('routines.a.eye'));
  if (m.brightness != null) parts.push(t('routines.a.brightness'));
  if (m.wallpaper) parts.push(t('routines.a.wallpaper'));
  if (m.sound) parts.push(t('routines.m.sound'));
  const extra = m.actions.filter((a) => !a.g || a.m === 0).length;
  const shown = parts.slice(0, 2).join(lang() === 'ar' ? '، ' : ', ');
  const more = parts.length - 2 + extra;
  return shown ? (more > 0 ? `${shown} +${more}` : shown) : extra ? t('routines.m.actionsN', { n: extra }) : t('routines.m.nothing');
}
const scheduleText = (m) => (m.autoOn && m.auto[0] ? t('routines.m.autoAt', { time: specText(m.auto[0].start) }) : '');

/** Samsung's "Turn on" sheet: until turned off, or for a while. */
async function askTurnOn(m) {
  let pick = 0;
  const opts = [
    { label: t('routines.m.untilOff'), until: null },
    { label: t('routines.m.forH', { n: 1 }), until: () => Date.now() + 3600e3 },
    { label: t('routines.m.forH', { n: 2 }), until: () => Date.now() + 2 * 3600e3 },
    { label: t('routines.m.forH', { n: 4 }), until: () => Date.now() + 4 * 3600e3 },
  ];
  const box = h('div', { class: 'ou-radio-list' }, opts.map((o, i) => h('label', { class: 'ou-radio-row' },
    h('input', { type: 'radio', name: 'rt-until', checked: i === 0, onChange: () => (pick = i) }), h('span', { class: 'ou-radio' }), h('span', { class: 'ou-radio-text' }, h('span', null, o.label)))));
  const go = await dialog({ title: t('routines.m.turnOnQ', { name: modeName(m) }), content: box, actions: [{ label: t('common.cancel'), value: false }, { label: t('routines.turnOn'), value: true, primary: true }] });
  if (go) await P.turnOnMode(m.id, { until: opts[pick].until?.() || null });
}

function modesView(ctx, tabs) {
  const page = ctx.page({
    title: t('routines.tab.modes'),
    actions: [iconBtn('plus', () => addMode(ctx), t('routines.addMode')), iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('routines.tab.routines'), icon: 'rtRoutine', onClick: () => ctx.setParams({ section: 'routines' }) },
      activeMode() ? { label: t('routines.turnOff'), icon: 'stop', onClick: modeRunOff } : null,
    ], { align: 'end' }), t('common.more'))],
  });
  page.el.appendChild(tabs);
  page.el.classList.add('rt-page');
  page.body.classList.add('rt-body');
  const draw = () => {
    const d = rdata(), a = activeMode();
    page.setSubtitle(a ? t('routines.modeOn', { name: modeName(a.mode) }) : t('routines.m.intro'));
    const nodes = [];
    if (a) {
      nodes.push(h('div', { class: 'rt-now', style: { '--c': a.mode.color } },
        roundIcon(a.mode.icon, a.mode.color, 26, 'xl'),
        h('div', { class: 'rt-now-text' }, h('b', null, t('routines.modeOn', { name: modeName(a.mode) })), h('small', null, a.state.until ? t('routines.until', { time: fmtTime(new Date(a.state.until)) }) : t('routines.m.untilOff'))),
        h('button', { class: 'ou-btn rt-now-btn', onClick: modeRunOff }, t('routines.turnOff'))));
    }
    nodes.push(list(...d.modes.map((m) => {
      const on = a?.mode.id === m.id;
      const sub = on ? (a.state.until ? t('routines.until', { time: fmtTime(new Date(a.state.until)) }) : t('routines.on')) : scheduleText(m) || modeSummary(m);
      const el = h('div', { class: ['ou-row', 'clickable', 'rt-mode-row', on && 'on'], role: 'button', tabindex: 0, dataset: { mode: m.id }, onClick: () => openMode(ctx, m.id), onKeydown: (e) => e.key === 'Enter' && openMode(ctx, m.id) },
        roundIcon(m.icon, m.color, 22, 'lg'),
        h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, modeName(m)), h('span', { class: ['ou-row-sub', !on && 'muted'] }, sub)),
        sw(on, (v) => (v ? askTurnOn(m).then(draw) : modeRunOff()), { label: modeName(m) }));
      return el;
    }), h('button', { class: 'ou-row clickable rt-add-row', onClick: () => addMode(ctx) }, h('span', { class: 'rt-add-ico', html: icon('plus', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('routines.addMode'))))));
    nodes.push(h('p', { class: 'rt-foot' }, t('routines.m.foot')));
    page.body.replaceChildren(...nodes);
  };
  draw();
  const offs = [store.on(KEY, draw), store.on(RUN_KEY, draw)];
  return () => offs.forEach((f) => f());
}

async function addMode(ctx) {
  const res = await styleDialog({ title: t('routines.addMode'), name: '', icon: 'rtBook', color: COLORS[1], placeholder: t('routines.m.namePh') });
  if (!res) return;
  const m = normMode({ id: uid(), name: res.name || t('routines.mode.custom'), icon: res.icon, color: res.color, dnd: true });
  saveMode(m);
  openMode(ctx, m.id);
}

/** A mode's page: Turn on/off, schedule, Do not disturb, display and sound, more actions. */
export function openMode(ctx, id) {
  const get = () => rdata().modes.find((m) => m.id === id);
  if (!get()) return;
  ctx.push({
    title: modeName(get()),
    className: 'rt-page rt-mode-page',
    actions: [iconBtn('more', (e) => {
      const m = get();
      menu(e.currentTarget, [
        !m.preset ? { label: t('routines.m.style'), icon: 'palette', onClick: () => restyle() } : null,
        m.preset ? { label: t('routines.m.reset'), icon: 'refresh', onClick: async () => { if (await confirm(t('routines.m.reset'), t('routines.m.resetMsg', { name: modeName(m) }))) saveMode(presetMode(m.preset)); } } : null,
        { label: t('routines.m.addWidget'), icon: 'widgets', onClick: () => import('../shell/home.js').then((x) => { x.addWidget('modes', 'm'); }) },
        !m.preset ? '-' : null,
        !m.preset ? { label: t('routines.m.delete'), icon: 'trash', danger: true, onClick: () => del() } : null,
      ], { align: 'end' });
    }, t('common.more'))],
    render(body, page) {
      body.classList.add('rt-body');
      const set = (patch) => saveMode({ ...get(), ...patch });
      const draw = () => {
        const m = get();
        if (!m) return ctx.pop();
        const a = activeMode(), on = a?.mode.id === id;
        page.setTitle(modeName(m));
        page.setSubtitle(on ? (a.state.until ? t('routines.until', { time: fmtTime(new Date(a.state.until)) }) : t('routines.on')) : '');
        const tri = (v) => (v === 'on' ? t('common.on') : v === 'off' ? t('common.off') : t('routines.m.noChange'));
        const triPick = async (title, key) => {
          const v = await choose3(title, get()[key]);
          if (v != null) set({ [key]: v });
        };
        body.replaceChildren(
          h('div', { class: ['rt-mode-hero', on && 'on'], style: { '--c': m.color } },
            roundIcon(m.icon, m.color, 40, 'hero'),
            h('button', { class: ['ou-btn', 'primary', 'rt-mode-toggle', on && 'on'], onClick: () => (on ? modeRunOff() : askTurnOn(m)) }, on ? t('routines.turnOff') : t('routines.turnOn'))),
          subheader(t('routines.m.auto')),
          list(
            switchRow({ icon: 'clock', title: t('routines.m.autoTitle'), sub: m.autoOn && m.auto.length ? m.auto.map((c) => condSub(c)).join(' · ') : t('routines.m.autoSub'), checked: m.autoOn && m.auto.length > 0, onChange: (v) => {
              if (v && !get().auto.length) return editTime(ctx, normCond({ type: 'time', ...presetMode(m.preset || 'work').auto[0] || { start: '09:00', end: '17:00', days: ALL_DAYS } }), (c) => { set({ autoOn: true, auto: [c] }); P.tickHere(); }, { period: true });
              set({ autoOn: v });
              P.tickHere();
            } }),
            ...m.auto.map((c, i) => row({ icon: c.start === 'sunset' || c.start === 'sunrise' ? 'rtSunset' : 'calendar', title: c.end ? `${specText(c.start)} – ${specText(c.end)}` : specText(c.start), sub: daysText(c.days), className: 'muted-sub rt-sched', chevron: true,
              onClick: () => editTime(ctx, c, (nc) => { const auto = [...get().auto]; if (nc) auto[i] = nc; else auto.splice(i, 1); set({ auto, autoOn: auto.length ? get().autoOn : false }); P.tickHere(); }, { period: true, removable: true }) })),
            row({ icon: 'plus', title: t('routines.m.addSchedule'), className: 'rt-add-row', onClick: () => editTime(ctx, normCond({ type: 'time', start: '22:00', end: '07:00' }), (c) => { set({ auto: [...get().auto, c], autoOn: true }); P.tickHere(); }, { period: true }) })),
          subheader(t('routines.m.what')),
          list(
            switchRow({ icon: 'dnd', iconBg: '#8a5cf6', title: t('routines.m.dnd'), sub: t('routines.m.dndSub'), checked: m.dnd, onChange: (v) => set({ dnd: v }) }),
            row({ icon: 'moon', iconBg: '#5b5fc7', title: t('routines.a.theme'), sub: tri(m.dark), chevron: true, onClick: () => triPick(t('routines.a.theme'), 'dark') }),
            row({ icon: 'eyeComfort', iconBg: '#f5a524', title: t('routines.a.eye'), sub: tri(m.eye), chevron: true, onClick: () => triPick(t('routines.a.eye'), 'eye') }),
            row({ icon: 'brightness', iconBg: '#f5a524', title: t('routines.a.brightness'), sub: m.brightness == null ? t('routines.m.noChange') : `⁦${m.brightness}%⁩`, chevron: true, onClick: async () => { const v = await pickBrightness(get().brightness); if (v !== undefined) set({ brightness: v }); } }),
            row({ icon: 'image', iconBg: '#2aa7d8', title: t('routines.a.wallpaper'), sub: m.wallpaper ? t('wall.' + m.wallpaper) : t('routines.m.noChange'), chevron: true, onClick: async () => { const v = await pickWallpaper(get().wallpaper); if (v !== undefined) set({ wallpaper: v }); } }),
            row({ icon: 'music', iconBg: '#ff7a45', title: t('routines.m.sound'), sub: m.sound ? t('sound.' + m.sound) : t('routines.m.noChange'), chevron: true, onClick: async () => { const v = await pickSound(get().sound); if (v !== undefined) set({ sound: v }); } })),
          subheader(t('routines.m.more')),
          actionsCard(ctx, { acts: m.actions, onChange: (acts) => set({ actions: acts }), addLabel: t('routines.e.addAction') }),
          !m.preset ? list(row({ icon: 'trash', title: t('routines.m.delete'), className: 'rt-danger', onClick: () => del() })) : null);
      };
      draw();
      const offs = [store.on(KEY, draw), store.on(RUN_KEY, draw)];
      return () => offs.forEach((f) => f());
    },
  });
  async function restyle() {
    const m = get();
    const res = await styleDialog({ title: t('routines.m.style'), name: m.name, icon: m.icon, color: m.color, placeholder: t('routines.m.namePh') });
    if (res) saveMode({ ...m, name: res.name || m.name, icon: res.icon, color: res.color });
  }
  async function del() {
    const m = get();
    if (!(await confirm(t('routines.m.delete'), t('routines.m.deleteMsg', { name: modeName(m) }), { okLabel: t('common.delete'), danger: true }))) return;
    if (activeMode()?.mode.id === id) await modeRunOff();
    removeMode(id);
    ctx.pop();
  }
}

/** Don't change / On / Off. */
async function choose3(title, value) {
  const opts = [{ value: '', label: t('routines.m.noChange') }, { value: 'on', label: t('common.on') }, { value: 'off', label: t('common.off') }];
  let pick = value || '';
  const box = h('div', { class: 'ou-radio-list' }, opts.map((o) => h('label', { class: 'ou-radio-row' },
    h('input', { type: 'radio', name: 'rt-tri', checked: o.value === pick, onChange: () => (pick = o.value) }), h('span', { class: 'ou-radio' }), h('span', { class: 'ou-radio-text' }, h('span', null, o.label)))));
  return dialog({ title, content: box, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => pick, primary: true }] });
}
/** Brightness for a mode: a One UI slider, or Don't change. Resolves undefined when cancelled. */
async function pickBrightness(value) {
  let v = value ?? 70, keep = value == null;
  const label = h('div', { class: 'rt-val' }, `⁦${v}%⁩`);
  const sl = slider({ min: 30, max: 100, value: v, icon: 'brightness', label: t('routines.a.brightness'), onInput: (x) => { v = x; label.textContent = `⁦${x}%⁩`; if (keep) { keep = false; s.set(false); } } });
  const s = sw(keep, (x) => (keep = x));
  const res = await dialog({
    title: t('routines.a.brightness'),
    content: h('div', { class: 'ou-dialog-body rt-dlg' }, label, sl, h('label', { class: 'rt-inline-sw' }, h('span', null, t('routines.m.noChange')), s)),
    actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }],
  });
  return res ? (keep ? null : v) : undefined;
}
/** A wallpaper for a mode (Don't change, or one of the bloom presets). Resolves undefined when cancelled. */
export function pickWallpaper(value) {
  return new Promise((resolve) => {
    let picked = value ?? null;
    const grid = h('div', { class: 'rt-walls' });
    const drawGrid = () => grid.replaceChildren(
      h('button', { class: ['rt-wall', 'none', picked == null && 'active'], onClick: () => { picked = null; drawGrid(); } }, h('span', { class: 'rt-wall-none', html: icon('close', 22) }), h('small', null, t('routines.m.noChange'))),
      ...PRESETS.map((p) => {
        const c = h('canvas', { width: 54, height: 96 });
        paintPreset(c, presetById(p.id), 3);
        return h('button', { class: ['rt-wall', picked === p.id && 'active'], title: t('wall.' + p.id), onClick: () => { picked = p.id; drawGrid(); } }, c, h('small', null, t('wall.' + p.id)));
      }));
    drawGrid();
    dialog({ title: t('routines.a.wallpaper'), className: 'wide', content: grid, actions: [{ label: t('common.cancel'), value: false }, { label: t('common.done'), value: true, primary: true }] })
      .then((ok) => resolve(ok ? picked : undefined));
  });
}
async function pickSound(value) {
  let pick = value || '';
  const opts = [{ value: '', label: t('routines.m.noChange') }, ...SOUNDS.map((s) => ({ value: s.id, label: t('sound.' + s.id) }))];
  const box = h('div', { class: 'ou-radio-list' }, opts.map((o) => h('label', { class: 'ou-radio-row' },
    h('input', { type: 'radio', name: 'rt-snd', checked: o.value === pick, onChange: () => (pick = o.value) }), h('span', { class: 'ou-radio' }), h('span', { class: 'ou-radio-text' }, h('span', null, o.label)))));
  const res = await dialog({ title: t('routines.m.sound'), content: box, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => pick, primary: true }] });
  return res == null ? undefined : res || null;
}

// ——— Routines ———
const setRoutine = (id, patch) => store.update(KEY, (v) => { const d = norm(v); d.list = d.list.map((r) => (r.id === id ? { ...r, ...patch } : r)); return d; });

function routinesView(ctx, tabs) {
  const page = ctx.page({
    title: t('routines.tab.routines'),
    actions: [
      iconBtn('rtDiscover', () => openDiscover(ctx), t('routines.discover')),
      iconBtn('plus', () => openEditor(ctx, { draft: newRoutine() }), t('routines.add')),
      iconBtn('more', (e) => menu(e.currentTarget, [
        { label: t('routines.describe'), icon: 'sparkle', onClick: () => describeDialog(ctx) },
        { label: t('routines.discover'), icon: 'rtDiscover', onClick: () => openDiscover(ctx) },
      ], { align: 'end' }), t('common.more')),
    ],
  });
  page.el.appendChild(tabs);
  page.el.classList.add('rt-page');
  page.body.classList.add('rt-body');
  const draw = () => {
    const d = rdata(), run = rrun();
    const running = d.list.filter((r) => run.running[r.id]);
    page.setSubtitle(running.length ? t('routines.runningN', { n: running.length }) : d.list.length ? t('routines.countN', { n: d.list.length }) : t('routines.r.intro'));
    const nodes = [];
    if (running.length) nodes.push(subheader(t('routines.running')), list(...running.map((r) => routineRow(ctx, r, run))));
    const rest = d.list.filter((r) => !run.running[r.id]);
    if (rest.length) nodes.push(subheader(t('routines.mine')), list(...rest.map((r) => routineRow(ctx, r, run))));
    if (!d.list.length) {
      nodes.push(h('div', { class: 'ou-card rt-empty' },
        h('span', { class: 'rt-empty-art', html: icon('rtRoutine', 44) }),
        h('b', null, t('routines.noRoutines')),
        h('p', null, t('routines.r.emptyHint')),
        h('button', { class: 'ou-btn primary', onClick: () => openEditor(ctx, { draft: newRoutine() }) }, h('span', { html: icon('plus', 18) }), t('routines.add'))));
    }
    // Discover strip, like Samsung's suggestions under your routines
    const picks = DISCOVER.flatMap((c) => c.items).filter((it) => !d.list.some((r) => r.from === it.id)).slice(0, 6);
    if (picks.length) {
      nodes.push(h('div', { class: 'rt-sec-head' }, h('span', null, t('routines.discover')), h('button', { class: 'ou-btn rt-see-all', onClick: () => openDiscover(ctx) }, t('routines.seeAll'))));
      nodes.push(h('div', { class: 'rt-disc-strip' }, picks.map((it) => discoverCard(ctx, it, true))));
    }
    page.body.replaceChildren(...nodes);
  };
  draw();
  const offs = [store.on(KEY, draw), store.on(RUN_KEY, draw), P.onBusy(draw)];
  return () => offs.forEach((f) => f());
}

function routineRow(ctx, r, run) {
  const on = !!run.running[r.id], busy = P.isBusy(r.id);
  const manual = isManual(r);
  const right = on || manual
    ? h('button', { class: ['rt-play', on && 'on', busy && 'busy'], 'aria-label': on ? t('routines.stop') : t('routines.run'), title: on ? t('routines.stop') : t('routines.run'), html: icon(on ? 'stop' : 'rtPlay', 18), onClick: (e) => { e.stopPropagation(); P.toggleRoutine(r.id); } })
    : sw(r.on, (v) => { setRoutine(r.id, { on: v }); toast(t(v ? 'routines.enabled' : 'routines.paused', { name: routineName(r) })); }, { label: routineName(r) });
  return h('div', { class: ['ou-row', 'clickable', 'rt-r-row', on && 'on', !r.on && 'off'], role: 'button', tabindex: 0, dataset: { routine: r.id }, onClick: () => openEditor(ctx, { id: r.id }), onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && openEditor(ctx, { id: r.id }) },
    roundIcon(r.icon, r.color, 22, 'lg'),
    h('span', { class: 'ou-row-text' },
      h('span', { class: 'ou-row-title' }, routineName(r)),
      on ? h('span', { class: 'ou-row-sub' }, t('routines.running')) : !r.on ? h('span', { class: 'ou-row-sub muted' }, t('routines.pausedSub')) : chain(r)),
    right);
}

// ——— Discover ———
const localize = (v) => (typeof v === 'string' && v.startsWith('routines.d.') ? t(v) : Array.isArray(v) ? v.map(localize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x)])) : v);
export function fromDiscover(it) {
  const x = it.make();
  return newRoutine({ name: t(it.name), icon: it.icon, color: it.color, conds: x.conds, actions: localize(x.actions), undo: x.undo, from: it.id });
}
function discoverCard(ctx, it, small = false) {
  const draft = fromDiscover(it);
  return h('button', { class: ['rt-disc-card', small && 'small'], dataset: { discover: it.id }, style: { '--c': it.color }, onClick: () => openEditor(ctx, { draft: fromDiscover(it) }) },
    h('div', { class: 'rt-disc-top' }, roundIcon(it.icon, it.color, 22, 'lg'), chain(draft, 3)),
    h('b', null, t(it.name)),
    h('small', null, t(it.desc)));
}
export function openDiscover(ctx) {
  ctx.push({
    title: t('routines.discover'),
    subtitle: t('routines.d.intro'),
    className: 'rt-page',
    render(body) {
      body.classList.add('rt-body');
      body.append(...DISCOVER.flatMap((c) => [subheader(t(c.name)), h('div', { class: 'rt-disc-grid' }, c.items.map((it) => discoverCard(ctx, it)))]));
    },
  });
}

// ——— Describe a routine (on-device AI) ———
async function describeDialog(ctx) {
  const D = await import('./describe.js');
  const status = await D.aiStatus();
  if (status === 'unavailable') {
    await dialog({ title: t('routines.describe'), message: t('routines.ai.none') });
    return;
  }
  const input = h('textarea', { class: 'ou-input', rows: 3, placeholder: t('routines.ai.ph') });
  const text = await dialog({
    title: t('routines.describe'),
    content: h('div', { class: 'ou-dialog-body' }, h('p', { class: 'rt-dlg-note' }, t('routines.ai.note')), input),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('routines.ai.make'), value: () => input.value.trim(), primary: true }],
  });
  if (!text) return;
  toast(t('routines.ai.working'), { duration: 60000 });
  try {
    const d = rdata();
    const draft = await D.describe(text, { modes: d.modes.map((m) => m.id), sounds: SOUNDS.map((s) => s.id), presets: PRESETS.map((p) => p.id), apps: ['notes', 'reminder', 'calendar', 'clock', 'weather', 'calculator', 'settings'] });
    toast(t('routines.ai.review'));
    openEditor(ctx, { draft: newRoutine({ name: draft.name, conds: draft.conds, actions: draft.actions }) });
  } catch (e) {
    console.warn('describe', e);
    toast(t('routines.ai.failed'));
  }
}

addStrings({
  en: {
    'routines.addMode': 'Add mode',
    'routines.add': 'Add routine',
    'routines.discover': 'Discover',
    'routines.seeAll': 'See all',
    'routines.mine': 'My routines',
    'routines.runningN': '{n} running now',
    'routines.countN': '{n} routines',
    'routines.r.intro': 'Do things automatically',
    'routines.r.emptyHint': 'Set things to happen on their own: at a time, when you open Chrome or a website, or when you start them.',
    'routines.enabled': '“{name}” turned on',
    'routines.paused': '“{name}” paused',
    'routines.pausedSub': 'Paused',
    'routines.describe': 'Describe a routine',
    'routines.ai.none': 'On-device AI isn’t available on this computer. Chrome’s built-in model (Gemini Nano) is needed.',
    'routines.ai.ph': 'Every weekday at 9, turn on Work mode and open my mail',
    'routines.ai.note': 'Your words stay on this computer: Chrome’s on-device model makes a draft you can check before saving.',
    'routines.ai.make': 'Make routine',
    'routines.ai.working': 'Making your routine…',
    'routines.ai.review': 'Check the routine, then tap Save',
    'routines.ai.failed': 'Couldn’t make a routine from that. Try saying it another way.',
    'routines.m.intro': 'Choose a mode for what you’re doing',
    'routines.m.foot': 'Modes change your settings to suit what you’re doing. When a mode turns off, your settings go back.',
    'routines.m.dnd': 'Do not disturb',
    'routines.m.dndSub': 'Focus stays on and notifications stay quiet',
    'routines.m.sound': 'Ambient sound',
    'routines.m.actionsN': '{n} actions',
    'routines.m.nothing': 'Tap to choose what turns on',
    'routines.m.autoAt': 'Turns on at {time}',
    'routines.m.untilOff': 'Until I turn it off',
    'routines.m.forH': 'For {n} h',
    'routines.m.turnOnQ': 'Turn on {name}?',
    'routines.m.auto': 'Turn on automatically',
    'routines.m.autoTitle': 'On a schedule',
    'routines.m.autoSub': 'Turn on and off at set times',
    'routines.m.addSchedule': 'Add schedule',
    'routines.m.what': 'What turns on',
    'routines.m.more': 'Also do this',
    'routines.m.noChange': 'Don’t change',
    'routines.m.style': 'Name and icon',
    'routines.m.namePh': 'Mode name',
    'routines.m.reset': 'Reset to default',
    'routines.m.resetMsg': '{name} will go back to Samsung’s default settings.',
    'routines.m.addWidget': 'Add Modes widget',
    'routines.m.delete': 'Delete mode',
    'routines.m.deleteMsg': '“{name}” will be deleted.',
    'routines.d.intro': 'Ready-made routines to try',
    'routines.d.catSleep': 'Sleep better',
    'routines.d.catFocus': 'Stay focused',
    'routines.d.catDay': 'Make your day easier',
    'routines.d.bedtime': 'Bedtime',
    'routines.d.bedtimeDesc': 'From 22:30, dim and darken the screen, turn on Do not disturb and play brown noise. Everything goes back at 7:00.',
    'routines.d.sunset': 'Dark mode at night',
    'routines.d.sunsetDesc': 'Dark mode and Eye comfort shield from sunset to sunrise where your weather is.',
    'routines.d.winddown': 'Wind down',
    'routines.d.winddownDesc': 'Turn on Relax mode, mute noisy tabs and start a 20-minute timer.',
    'routines.d.workday': 'Workday',
    'routines.d.workdayDesc': 'Work mode and Light mode on weekdays from 9:00 to 17:00.',
    'routines.d.distraction': 'Distraction alert',
    'routines.d.distractionDesc': 'A gentle nudge when you open social media or video sites.',
    'routines.d.distractionTitle': 'Stay on track',
    'routines.d.distractionText': 'Is this what you meant to do right now?',
    'routines.d.break': 'Take a break',
    'routines.d.breakDesc': 'A 5-minute timer with ocean waves.',
    'routines.d.breakLabel': 'Break',
    'routines.d.breakText': 'Stand up, stretch and look away from the screen.',
    'routines.d.morning': 'Good morning',
    'routines.d.morningDesc': 'When Chrome starts: Light mode, full brightness and a hello.',
    'routines.d.morningText': 'Have a great day!',
    'routines.d.back': 'Welcome back',
    'routines.d.backDesc': 'After 15 minutes away: Do not disturb turns off and you get a note.',
    'routines.d.backText': 'Good to see you again.',
    'routines.d.tidy': 'Tidy up tabs',
    'routines.d.tidyDesc': 'Group your tabs by website and put background tabs to sleep.',
    'routines.d.movie': 'Movie night',
    'routines.d.movieDesc': 'Asks what to watch, turns on Theater mode and opens it.',
    'routines.d.movieAsk': 'What do you want to watch? (web address)',
  },
  ar: {
    'routines.addMode': 'إضافة وضع',
    'routines.add': 'إضافة إجراء روتيني',
    'routines.discover': 'اكتشاف',
    'routines.seeAll': 'عرض الكل',
    'routines.mine': 'إجراءاتي الروتينية',
    'routines.runningN': '{n} قيد التنفيذ الآن',
    'routines.countN': '{n} إجراءات روتينية',
    'routines.r.intro': 'تنفيذ الأمور تلقائيًا',
    'routines.r.emptyHint': 'اجعل الأمور تحدث من تلقاء نفسها: في وقت محدد، أو عند فتح Chrome أو موقع ويب، أو عندما تبدأها بنفسك.',
    'routines.enabled': 'تم تشغيل ”{name}“',
    'routines.paused': 'تم إيقاف ”{name}“ مؤقتًا',
    'routines.pausedSub': 'متوقف مؤقتًا',
    'routines.describe': 'صِف إجراءً روتينيًا',
    'routines.ai.none': 'الذكاء الاصطناعي على الجهاز غير متاح على هذا الكمبيوتر. يلزم نموذج Chrome المدمج (Gemini Nano).',
    'routines.ai.ph': 'في أيام العمل الساعة 9، شغّل وضع العمل وافتح بريدي',
    'routines.ai.note': 'تبقى كلماتك على هذا الكمبيوتر: ينشئ نموذج Chrome على الجهاز مسودة يمكنك مراجعتها قبل الحفظ.',
    'routines.ai.make': 'إنشاء الإجراء',
    'routines.ai.working': 'جارٍ إنشاء إجرائك الروتيني…',
    'routines.ai.review': 'راجع الإجراء الروتيني ثم اضغط حفظ',
    'routines.ai.failed': 'تعذّر إنشاء إجراء روتيني من ذلك. جرّب صياغة أخرى.',
    'routines.m.intro': 'اختر وضعًا يناسب ما تفعله',
    'routines.m.foot': 'تغيّر الأوضاع إعداداتك لتناسب ما تفعله. عند إيقاف الوضع تعود إعداداتك كما كانت.',
    'routines.m.dnd': 'عدم الإزعاج',
    'routines.m.dndSub': 'يبقى التركيز قيد التشغيل وتبقى الإشعارات صامتة',
    'routines.m.sound': 'الصوت المحيطي',
    'routines.m.actionsN': '{n} إجراءات',
    'routines.m.nothing': 'اضغط لاختيار ما يتم تشغيله',
    'routines.m.autoAt': 'يعمل الساعة {time}',
    'routines.m.untilOff': 'حتى أوقفه',
    'routines.m.forH': 'لمدة {n} س',
    'routines.m.turnOnQ': 'تشغيل {name}؟',
    'routines.m.auto': 'التشغيل تلقائيًا',
    'routines.m.autoTitle': 'حسب جدول',
    'routines.m.autoSub': 'التشغيل والإيقاف في أوقات محددة',
    'routines.m.addSchedule': 'إضافة جدول',
    'routines.m.what': 'ما يتم تشغيله',
    'routines.m.more': 'وافعل هذا أيضًا',
    'routines.m.noChange': 'بدون تغيير',
    'routines.m.style': 'الاسم والرمز',
    'routines.m.namePh': 'اسم الوضع',
    'routines.m.reset': 'إعادة التعيين إلى الافتراضي',
    'routines.m.resetMsg': 'سيعود {name} إلى إعدادات سامسونج الافتراضية.',
    'routines.m.addWidget': 'إضافة أداة الأوضاع',
    'routines.m.delete': 'حذف الوضع',
    'routines.m.deleteMsg': 'سيتم حذف ”{name}“.',
    'routines.d.intro': 'إجراءات روتينية جاهزة للتجربة',
    'routines.d.catSleep': 'نوم أفضل',
    'routines.d.catFocus': 'ابقَ مركزًا',
    'routines.d.catDay': 'اجعل يومك أسهل',
    'routines.d.bedtime': 'وقت النوم',
    'routines.d.bedtimeDesc': 'من الساعة 22:30 خفّف سطوع الشاشة واجعلها داكنة وشغّل عدم الإزعاج والضوضاء البنية. يعود كل شيء الساعة 7:00.',
    'routines.d.sunset': 'الوضع الداكن ليلًا',
    'routines.d.sunsetDesc': 'الوضع الداكن ودرع راحة العين من الغروب إلى الشروق حسب موقع الطقس.',
    'routines.d.winddown': 'الاسترخاء قبل النوم',
    'routines.d.winddownDesc': 'شغّل وضع الاسترخاء واكتم علامات التبويب المزعجة وابدأ مؤقتًا لمدة 20 دقيقة.',
    'routines.d.workday': 'يوم العمل',
    'routines.d.workdayDesc': 'وضع العمل والوضع الفاتح في أيام العمل من 9:00 إلى 17:00.',
    'routines.d.distraction': 'تنبيه التشتت',
    'routines.d.distractionDesc': 'تذكير لطيف عند فتح مواقع التواصل أو الفيديو.',
    'routines.d.distractionTitle': 'حافظ على تركيزك',
    'routines.d.distractionText': 'هل هذا ما كنت تنوي فعله الآن؟',
    'routines.d.break': 'خذ استراحة',
    'routines.d.breakDesc': 'مؤقت لمدة 5 دقائق مع صوت أمواج المحيط.',
    'routines.d.breakLabel': 'استراحة',
    'routines.d.breakText': 'قف وتمدّد وأبعد نظرك عن الشاشة.',
    'routines.d.morning': 'صباح الخير',
    'routines.d.morningDesc': 'عند بدء Chrome: الوضع الفاتح وسطوع كامل وتحية.',
    'routines.d.morningText': 'أتمنى لك يومًا رائعًا!',
    'routines.d.back': 'مرحبًا بعودتك',
    'routines.d.backDesc': 'بعد الابتعاد 15 دقيقة: يتوقف عدم الإزعاج وتصلك رسالة.',
    'routines.d.backText': 'سعيد برؤيتك مجددًا.',
    'routines.d.tidy': 'ترتيب علامات التبويب',
    'routines.d.tidyDesc': 'جمّع علامات التبويب حسب الموقع وأسبِت علامات التبويب في الخلفية.',
    'routines.d.movie': 'ليلة فيلم',
    'routines.d.movieDesc': 'يسألك ماذا تريد أن تشاهد ويشغّل وضع المسرح ويفتحه.',
    'routines.d.movieAsk': 'ماذا تريد أن تشاهد؟ (عنوان ويب)',
  },
});
