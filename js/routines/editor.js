// The routine editor (One UI): an "If" card (what starts the routine: Start manually, a time period, sunrise and
// sunset, a new tab, Chrome starting, coming back to the computer, a mode, a website), a "Then" card (actions in
// order, with Liquid Tab's If / Repeat / Choose from menu blocks and variables), and "Undo actions when routine ends".
// A new routine is a draft until Save (name, icon and colour); an existing one saves as you change it.
// Also used by mode pages: actionsCard() and editTime().
import { h, pad2, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t, tr, addStrings, fmtRelative, weekdayNames, use12h, fmtPeriod, locale } from '../core/i18n.js';
import { store } from '../core/store.js';
import { dialog, menu, toast, iconBtn, row, list, sw, switchRow, slider, confirm } from '../core/ui.js';
import { ensure } from '../core/perm.js';
import { getApps } from '../core/apps.js';
import { SOUNDS } from '../shell/sounds.js';
import { PRESETS, paintPreset, presetById } from '../shell/wallpaper.js';
import { KEY, norm, normRoutine, normCond, structure, repair, moveStep, varsBefore, namesBefore, cloneRoutine, isState, COLORS, GLYPHS, ALL_DAYS, cleanHost } from './model.js';
import { ACTIONS, CATS, newAction, hasOutput, NO_VALUE_OPS } from './actions.js';
import { condIcon, condTitle, condSub, actionTitle, actionSub, actionIcon, actionColor, varName, specText, daysText } from './labels.js';
import { rdata, rrun, modeName, routineName, roundIcon } from '../apps/routines.js';
import * as P from './page.js';

// ——— saving ———
const saveRoutine = (r) => store.update(KEY, (v) => {
  const d = norm(v);
  const i = d.list.findIndex((x) => x.id === r.id);
  const n = normRoutine({ ...r, at: Date.now() });
  if (i >= 0) d.list[i] = n;
  else d.list.push(n);
  return d;
});
const removeRoutine = (id) => store.update(KEY, (v) => { const d = norm(v); d.list = d.list.filter((x) => x.id !== id); return d; });

/** Name, icon and colour of a routine or a custom mode. Resolves { name, icon, color } or null. */
export function styleDialog({ title, name = '', icon: ic = GLYPHS[0], color = COLORS[0], placeholder = '' }) {
  let pickIcon = ic, pickColor = color;
  const preview = h('span', { class: 'rt-ico hero rt-style-preview' });
  const input = h('input', { class: 'ou-input', value: name, placeholder, maxlength: 40 });
  const icons = h('div', { class: 'rt-style-icons' });
  const colors = h('div', { class: 'rt-style-colors' });
  const draw = () => {
    preview.style.setProperty('--c', pickColor);
    preview.innerHTML = icon(pickIcon, 40);
    icons.replaceChildren(...GLYPHS.map((g) => h('button', { class: ['rt-style-icon', g === pickIcon && 'active'], 'aria-label': g, html: icon(g, 22), onClick: () => { pickIcon = g; draw(); } })));
    colors.replaceChildren(...COLORS.map((c) => h('button', { class: ['ou-swatch', c === pickColor && 'active'], style: { background: c }, 'aria-label': c, onClick: () => { pickColor = c; draw(); } })));
  };
  draw();
  return dialog({
    title,
    className: 'rt-style-dlg',
    content: h('div', { class: 'ou-dialog-body' }, h('div', { class: 'rt-style-top' }, preview, input), icons, colors),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: () => ({ name: input.value.trim(), icon: pickIcon, color: pickColor }), primary: true }],
  });
}

// ——— the editor page ———
/** Opens a routine ({ id }) or a new draft ({ draft }) in the editor. */
export function openEditor(ctx, { id, draft }) {
  const isNew = !id;
  let r = isNew ? normRoutine(structuredClone(draft)) : rdata().list.find((x) => x.id === id);
  if (!r) return;
  r = structuredClone(r);
  const commit = () => { if (!isNew) saveRoutine(r); };
  ctx.push({
    title: isNew ? t('routines.add') : routineName(r),
    hero: false,
    className: 'rt-page rt-editor',
    actions: isNew ? [] : [iconBtn('more', (e) => {
      const running = !!rrun().running[r.id];
      menu(e.currentTarget, [
        { label: running ? t('routines.stop') : t('routines.e.runNow'), icon: running ? 'stop' : 'rtPlay', onClick: () => P.toggleRoutine(r.id) },
        { label: t('routines.e.style'), icon: 'palette', onClick: () => restyle() },
        { label: t('routines.e.duplicate'), icon: 'copy', onClick: () => { const c = cloneRoutine(r, { name: t('routines.e.copyName', { name: routineName(r) }), from: undefined }); saveRoutine(c); toast(t('routines.e.duplicated')); } },
        { label: t('routines.e.addHome'), icon: 'widgets', onClick: () => addToHome(r.id) },
        '-',
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => del() },
      ], { align: 'end' });
    }, t('common.more'))],
    render(body, page) {
      body.classList.add('rt-body', 'rt-ed-body');
      const foot = isNew ? h('div', { class: 'rt-ed-foot' },
        h('button', { class: 'ou-btn tonal', onClick: () => ctx.pop() }, t('common.cancel')),
        h('button', { class: 'ou-btn primary rt-save', onClick: () => saveNew() }, t('common.save'))) : null;
      if (foot) page.el.appendChild(foot);
      const draw = () => {
        if (!isNew) {
          const cur = rdata().list.find((x) => x.id === r.id);
          if (!cur) return ctx.pop();
          r = structuredClone(cur);
          page.setTitle(routineName(r));
        }
        const run = rrun();
        const running = !!run.running[r.id];
        const nodes = [];
        if (!isNew) {
          nodes.push(h('div', { class: ['ou-card', 'rt-ed-head', running && 'on'], style: { '--c': r.color } },
            h('button', { class: 'rt-ed-ico', 'aria-label': t('routines.e.style'), onClick: () => restyle() }, roundIcon(r.icon, r.color, 26, 'xl')),
            h('div', { class: 'rt-ed-name' },
              h('b', null, routineName(r)),
              h('small', null, running ? t('routines.running') : run.last[r.id] ? t('routines.e.lastRun', { when: fmtRelative(run.last[r.id]) }) : t('routines.e.never'))),
            sw(r.on, (v) => { r.on = v; commit(); }, { label: t('routines.e.enable') })));
        }
        nodes.push(ifCard(), h('div', { class: 'rt-flow-arrow', html: icon('down', 20) }), thenCard());
        const undoable = !r.conds.length || r.conds.some((c) => isState(c) || c.type === 'manual');
        if (undoable) nodes.push(list(switchRow({ icon: 'history', title: t('routines.e.undo'), sub: t('routines.e.undoSub'), checked: r.undo, onChange: (v) => { r.undo = v; commit(); } })));
        if (!isNew) nodes.push(h('button', { class: ['ou-btn', running ? 'tonal' : 'primary', 'rt-run-btn'], onClick: () => P.toggleRoutine(r.id) }, h('span', { html: icon(running ? 'stop' : 'rtPlay', 18) }), running ? t('routines.stop') : t('routines.e.runNow')));
        body.replaceChildren(...nodes);
      };

      function ifCard() {
        const items = r.conds.map((c, i) => h('div', { class: 'ou-row clickable rt-cond', role: 'button', tabindex: 0, onClick: () => editCond(i) },
          roundIcon(condIcon(c), '#3e7bff', 18),
          h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, condTitle(c)), h('span', { class: 'ou-row-sub muted' }, condSub(c))),
          h('button', { class: 'rt-remove', 'aria-label': t('common.remove'), title: t('common.remove'), html: icon('minus', 16), onClick: (e) => { e.stopPropagation(); r.conds.splice(i, 1); commit(); draw(); } })));
        return h('div', { class: 'ou-card rt-if' },
          h('div', { class: 'rt-card-head' }, h('span', { class: 'rt-label if' }, t('routines.e.if')),
            r.conds.length > 1 ? h('button', { class: 'rt-match', onClick: () => pickMatch() }, h('span', null, t(r.match === 'all' ? 'routines.e.all' : 'routines.e.any')), h('span', { html: icon('down', 16) })) : null),
          ...items,
          h('button', { class: 'ou-row clickable rt-add-row', onClick: () => pickCondition(ctx, r.conds, (c) => { r.conds.push(c); commit(); draw(); }) },
            h('span', { class: 'rt-add-ico', html: icon('plus', 20) }),
            h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, r.conds.length ? t('routines.e.addCond') : t('routines.e.addIf')))));
      }
      function thenCard() {
        const card = actionsCard(ctx, { acts: r.actions, onChange: (acts) => { r.actions = acts; commit(); if (isNew) draw(); }, addLabel: r.actions.length ? t('routines.e.addAction') : t('routines.e.addThen'), bare: true });
        return h('div', { class: 'ou-card rt-then' }, h('div', { class: 'rt-card-head' }, h('span', { class: 'rt-label then' }, t('routines.e.then'))), card);
      }
      async function pickMatch() {
        const v = await chooseList(t('routines.e.when'), [{ value: 'any', label: t('routines.e.any') }, { value: 'all', label: t('routines.e.all'), sub: t('routines.e.allSub') }], r.match);
        if (v) { r.match = v; commit(); draw(); }
      }
      async function editCond(i) {
        const c = r.conds[i];
        const done = (nc) => { if (nc) r.conds[i] = nc; else r.conds.splice(i, 1); commit(); draw(); };
        if (c.type === 'time') editTime(ctx, c, done, { removable: true });
        else if (c.type === 'idle') { const v = await pickAway(c.away); if (v) done({ ...c, away: v }); }
        else if (c.type === 'mode') { const v = await pickModeCond(c.mode); if (v != null) done({ ...c, mode: v }); }
        else if (c.type === 'site') { const v = await sitesDialog(c.hosts); if (v) done({ ...c, hosts: v }); }
      }
      async function saveNew() {
        if (!r.actions.length) return toast(t('routines.e.needAction'));
        if (!r.conds.length) r.conds = [{ type: 'manual' }];
        const res = await styleDialog({ title: t('routines.e.saveTitle'), name: r.name, icon: r.icon, color: r.color, placeholder: t('routines.e.namePh') });
        if (!res) return;
        Object.assign(r, { name: res.name || r.name, icon: res.icon, color: res.color, at: Date.now() });
        saveRoutine(r);
        toast(t('routines.e.saved', { name: routineName(r) }));
        ctx.pop();
        P.tickHere();
      }
      draw();
      const offs = isNew ? [] : [store.on(KEY, draw), store.on('routinesRun', draw)];
      return () => {
        offs.forEach((f) => f());
        foot?.remove();
        // a routine whose time period or mode holds now starts once you're done editing it
        if (!isNew) P.tickHere();
      };
    },
  });
  async function restyle() {
    const res = await styleDialog({ title: t('routines.e.style'), name: r.name, icon: r.icon, color: r.color, placeholder: t('routines.e.namePh') });
    if (!res) return;
    Object.assign(r, { name: res.name, icon: res.icon, color: res.color });
    commit();
  }
  async function del() {
    if (!(await confirm(t('routines.e.deleteQ'), t('routines.e.deleteMsg', { name: routineName(r) }), { okLabel: t('common.delete'), danger: true }))) return;
    if (rrun().running[r.id]) await P.stopRoutine(r.id);
    removeRoutine(r.id);
    ctx.pop();
  }
}
function addToHome(id) {
  // a ready config skips the widget's settings step: the new widget shows this routine
  import('../shell/home.js').then((m) => m.addWidget('routines', 's', { routine: id }));
}

// ——— small pickers ———
function chooseList(title, options, value) {
  let pick = value;
  const box = h('div', { class: 'ou-radio-list' }, options.map((o) => h('label', { class: 'ou-radio-row' },
    h('input', { type: 'radio', name: 'rt-choice', checked: o.value === value, onChange: () => (pick = o.value) }), h('span', { class: 'ou-radio' }),
    h('span', { class: 'ou-radio-text' }, h('span', null, o.label), o.sub ? h('small', null, o.sub) : null))));
  return dialog({ title, content: box, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => pick, primary: true }] });
}
const pickAway = (v = 15) => chooseList(t('routines.c.idle'), [5, 10, 15, 30, 60, 120].map((n) => ({ value: n, label: t('routines.e.awayN', { n }) })), v);
const pickModeCond = (v = '') => chooseList(t('routines.c.mode'), [{ value: '', label: t('routines.c.anyMode') }, ...rdata().modes.map((m) => ({ value: m.id, label: modeName(m) }))], v);
/** Websites for "Website opened"; asks for the tabs permission when you tap Done. */
function sitesDialog(hosts = []) {
  const input = h('textarea', { class: 'ou-input', rows: 4, placeholder: 'youtube.com\nx.com', value: hosts.join('\n') });
  return dialog({
    title: t('routines.c.site'),
    content: h('div', { class: 'ou-dialog-body' }, h('p', { class: 'rt-dlg-note' }, t('routines.e.sitesNote')), input),
    actions: [{ label: t('common.cancel'), value: null }, {
      label: t('common.done'), primary: true,
      validate: async () => {
        if (!input.value.trim()) return false;
        if (!(await ensure('tabs'))) { toast(t('routines.e.permDenied')); return false; }
        return true;
      },
      value: () => input.value.split(/[\s,]+/).map(cleanHost).filter(Boolean),
    }],
  });
}

// ——— the condition picker ———
const COND_LIST = [
  { type: 'manual', icon: 'hand', sub: 'routines.e.cManual' },
  { type: 'time', icon: 'clock', sub: 'routines.e.cTime' },
  { type: 'sun', icon: 'rtSunset', title: 'routines.c.sunPeriod', sub: 'routines.e.cSun' },
  { type: 'newtab', icon: 'rtNewTab', sub: 'routines.c.newtabSub' },
  { type: 'startup', icon: 'power', sub: 'routines.c.startupSub' },
  { type: 'unlock', icon: 'unlock', sub: 'routines.c.unlockSub' },
  { type: 'idle', icon: 'rtIdle', sub: 'routines.e.cIdle' },
  { type: 'mode', icon: 'rtModes', sub: 'routines.e.cMode' },
  { type: 'site', icon: 'globe', sub: 'routines.e.cSite' },
];
function pickCondition(ctx, have, onPick) {
  ctx.push({
    title: t('routines.e.ifTitle'),
    hero: false,
    className: 'rt-page',
    render(body) {
      body.classList.add('rt-body');
      const done = (c) => { if (c) { onPick(normCond(c)); ctx.pop(); } };
      body.append(h('p', { class: 'rt-hint' }, t('routines.e.ifHint')), list(...COND_LIST.map((x) => {
        const used = ['manual', 'newtab', 'startup', 'unlock'].includes(x.type) && have.some((c) => c.type === x.type);
        const el = row({
          icon: roundIcon(x.icon, '#3e7bff', 18).outerHTML, title: t(x.title || 'routines.c.' + x.type), sub: t(x.sub), className: ['muted-sub', 'rt-pick', used && 'used'].filter(Boolean).join(' '),
          onClick: async () => {
            if (used) return;
            if (x.type === 'time') return editTime(ctx, normCond({ type: 'time', start: '09:00', end: '17:00' }), (c) => { onPick(c); ctx.pop(); });
            if (x.type === 'sun') return editTime(ctx, normCond({ type: 'time', start: 'sunset', end: 'sunrise' }), (c) => { onPick(c); ctx.pop(); });
            if (x.type === 'idle') return done(await pickAway(15).then((v) => v && { type: 'idle', away: v }));
            if (x.type === 'mode') { const v = await pickModeCond(''); return v != null && done({ type: 'mode', mode: v }); }
            if (x.type === 'site') { const v = await sitesDialog([]); return v && done({ type: 'site', hosts: v }); }
            done({ type: x.type });
          },
        });
        el.dataset.cond = x.type;
        return el;
      })));
    },
  });
}

// ——— the time page (Time period / Sunrise and sunset) ———
function wheel({ min, max, value, loop = true, fmt = pad2, onChange, label = '' }) {
  const n = max - min + 1;
  const norm1 = (v) => (loop ? ((((v - min) % n) + n) % n) + min : clamp(v, min, max));
  const listEl = h('div', { class: 'rt-wheel-list' });
  const el = h('div', { class: 'rt-wheel', tabindex: 0, role: 'spinbutton', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, listEl);
  const draw = () => {
    listEl.replaceChildren(...[-1, 0, 1].map((o) => {
      const v = loop ? norm1(value + o) : value + o;
      const ok = v >= min && v <= max;
      return h('div', { class: ['rt-wheel-item', o === 0 && 'cur'], onClick: ok && o ? () => set(value + o) : null }, ok ? fmt(v) : '');
    }));
    el.setAttribute('aria-valuenow', value);
    el.setAttribute('aria-valuetext', fmt(value));
  };
  const set = (v) => { const nv = norm1(v); if (nv === value) return; value = nv; draw(); onChange?.(value); };
  let acc = 0;
  el.addEventListener('wheel', (e) => { e.preventDefault(); acc += e.deltaY; while (Math.abs(acc) >= 40) { const s = Math.sign(acc); set(value + s); acc -= s * 40; } }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    let y0 = e.clientY;
    const move = (ev) => { const steps = Math.trunc((y0 - ev.clientY) / 30); if (steps) { y0 -= steps * 30; set(value + steps); } };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(value + (e.key === 'ArrowDown' ? 1 : -1)); } });
  draw();
  el.get = () => value;
  return el;
}
/** Hour and minute wheels (12- or 24-hour, like the Clock app). onChange('HH:MM'). */
function timeWheels(hhmm, onChange) {
  let [hh, mm] = hhmm.split(':').map(Number);
  const out = () => onChange(`${pad2(hh)}:${pad2(mm)}`);
  const h12 = use12h();
  const mw = wheel({ min: 0, max: 59, value: mm, onChange: (v) => { mm = v; out(); }, label: t('routines.e.minutes') });
  let hw, pw = null;
  if (h12) {
    const periodName = (pm) => fmtPeriod(new Date(2024, 0, 1, pm ? 15 : 9));
    hw = wheel({ min: 1, max: 12, value: hh % 12 || 12, fmt: String, onChange: (v) => { hh = (v % 12) + (pw.get() ? 12 : 0); out(); }, label: t('routines.e.hours') });
    pw = wheel({ min: 0, max: 1, value: hh >= 12 ? 1 : 0, loop: false, fmt: periodName, onChange: (v) => { hh = (hw.get() % 12) + (v ? 12 : 0); out(); }, label: 'AM/PM' });
    pw.classList.add('period');
  } else hw = wheel({ min: 0, max: 23, value: hh, onChange: (v) => { hh = v; out(); }, label: t('routines.e.hours') });
  const box = h('div', { class: 'rt-wheels' }, hw, h('span', { class: 'rt-colon' }, ':'), mw, pw);
  if (pw && /^ar|^ko|^zh|^ja/.test(locale())) box.prepend(pw);
  return box;
}
/**
 * The page for a time condition. opts: { period: true } (a mode schedule: needs an end), removable (shows Remove).
 * onDone(cond) after Done, onDone(null) after Remove.
 */
export function editTime(ctx, cond, onDone, { period = false, removable = false } = {}) {
  const c = structuredClone(normCond(cond));
  ctx.push({
    title: c.start === 'sunrise' || c.start === 'sunset' ? t('routines.c.sunPeriod') : t('routines.c.period'),
    hero: false,
    className: 'rt-page rt-time-page',
    render(body, page) {
      body.classList.add('rt-body');
      const foot = h('div', { class: 'rt-ed-foot' },
        removable ? h('button', { class: 'ou-btn tonal rt-danger-btn', onClick: () => { ctx.pop(); onDone(null); } }, t('common.remove')) : h('button', { class: 'ou-btn tonal', onClick: () => ctx.pop() }, t('common.cancel')),
        h('button', { class: 'ou-btn primary rt-time-done', onClick: () => { ctx.pop(); onDone(normCond(c)); } }, t('common.done')));
      page.el.appendChild(foot);
      const sideCard = (key) => {
        const opts = [['time', t('routines.e.timeOpt')], ['sunrise', t('routines.c.sunrise')], ['sunset', t('routines.c.sunset')]];
        if (key === 'end' && !period) opts.push(['none', t('routines.e.noEnd')]);
        const cur = () => (c[key] === '' ? 'none' : c[key].includes(':') ? 'time' : c[key]);
        const holder = h('div', { class: 'rt-time-side' });
        const drawSide = () => {
          const v = cur();
          const segEl = h('div', { class: 'ou-seg rt-seg' }, opts.map(([val, label]) => h('button', { class: ['ou-seg-btn', val === v && 'active'], onClick: () => {
            if (val === 'time') c[key] = c[key] && c[key].includes(':') ? c[key] : key === 'start' ? '09:00' : '17:00';
            else c[key] = val === 'none' ? '' : val;
            drawSide();
            drawNote();
          } }, label)));
          holder.replaceChildren(segEl, v === 'time' ? timeWheels(c[key], (x) => { c[key] = x; }) : v === 'none' ? h('p', { class: 'rt-hint' }, t('routines.e.noEndSub')) : h('div', { class: 'rt-sun-big', html: icon(v === 'sunset' ? 'rtSunset' : 'rtSunrise', 40) }));
        };
        drawSide();
        return h('div', { class: 'ou-card rt-time-card' }, h('div', { class: 'rt-time-label' }, t(key === 'start' ? 'routines.e.start' : 'routines.e.end')), holder);
      };
      const names = weekdayNames('narrow'), longNames = weekdayNames('long');
      const sumEl = h('span', { class: 'rt-days-sum' });
      const daysEl = h('div', { class: 'rt-days' }, names.map((n, i) => {
        const b = h('button', { class: ['rt-day', c.days.includes(i) && 'on', i === 0 && 'sun'], title: longNames[i], 'aria-pressed': String(c.days.includes(i)), onClick: () => {
          const next = c.days.includes(i) ? c.days.filter((x) => x !== i) : [...c.days, i].sort();
          if (!next.length) return;
          c.days = next;
          b.classList.toggle('on', c.days.includes(i));
          b.setAttribute('aria-pressed', String(c.days.includes(i)));
          sumEl.textContent = daysText(c.days);
        } }, n);
        return b;
      }));
      sumEl.textContent = daysText(c.days);
      const note = h('p', { class: 'rt-hint rt-sun-note' });
      const drawNote = () => {
        const sun = [c.start, c.end].some((x) => x === 'sunrise' || x === 'sunset');
        note.hidden = !sun;
        const s = store.get('settings').location, w = store.get('weather')?.location;
        const where = s?.lat != null ? s : w?.lat != null ? w : null;
        note.textContent = where ? t('routines.e.sunWhere', { place: where.name || t('routines.e.yourPlace') }) : t('routines.e.sunNoLoc');
        note.classList.toggle('warn', !where);
      };
      drawNote();
      body.append(sideCard('start'), sideCard('end'), h('div', { class: 'ou-card rt-time-card' }, h('div', { class: 'rt-time-label' }, t('routines.e.repeat'), sumEl), daysEl), note);
      return () => foot.remove();
    },
  });
}

// ——— the action list ("Then") ———
/** A card of actions with Add, edit (tap), remove (−) and ⋮ (move, add below). onChange(newList) after each change. */
export function actionsCard(ctx, { acts, onChange, addLabel, bare = false }) {
  let cur = acts;
  const el = h('div', { class: [bare ? 'rt-acts' : 'ou-card ou-list rt-acts'] });
  const commit = (next) => { cur = repair(next); onChange(cur); draw(); };
  const add = (at) => pickAction(ctx, async (type) => {
    const made = newAction(type);
    const d = ACTIONS[type];
    if (needsDialog(d)) {
      const p = await editParams(d, made[0], cur, at);
      if (!p) return;
      made[0].p = p;
      syncMenu(made, p);
    }
    const next = cur.slice();
    next.splice(at, 0, ...made);
    commit(next);
  });
  function syncMenu(arr, p) {
    // Choose from menu: one middle marker per item
    if (arr[0].type !== 'menu' || !Array.isArray(p.items)) return;
    const g = arr[0].g;
    const mids = arr.filter((a) => a.g === g && a.m === 1);
    while (mids.length < p.items.length) { const m = { id: 'a' + Math.random().toString(36).slice(2, 9), type: 'menu', p: { item: mids.length }, g, m: 1 }; const end = arr.findIndex((a) => a.g === g && a.m === 2); arr.splice(end, 0, m); mids.push(m); }
    while (mids.length > p.items.length && mids.length > 1) { const m = mids.pop(); arr.splice(arr.indexOf(m), 1); }
    mids.forEach((m, k) => (m.p = { item: k }));
  }
  async function edit(i) {
    const a = cur[i], d = ACTIONS[a.type];
    if (!d || !needsDialog(d)) return;
    const p = await editParams(d, a, cur, i);
    if (!p) return;
    const next = cur.map((x, j) => (j === i ? { ...x, p } : x));
    syncMenu(next, p);
    commit(next);
  }
  function remove(i) {
    const a = cur[i];
    // removing a block start removes its markers too (the actions inside stay)
    commit(a.g && a.m === 0 ? cur.filter((x) => x.g !== a.g) : cur.filter((_, j) => j !== i));
  }
  function draw() {
    const { depth } = structure(cur);
    el.replaceChildren(
      ...cur.map((a, i) => {
        const dep = depth[i] || 0;
        if (a.g && a.m) {
          return h('div', { class: ['rt-act', 'rt-marker', a.m === 2 && 'end'], style: { '--d': dep } },
            h('span', { class: 'rt-marker-line', style: { '--c': actionColor(a) } }),
            h('span', { class: 'rt-marker-text' }, actionTitle(a)),
            h('button', { class: 'rt-mini', 'aria-label': t('routines.e.addHere'), title: t('routines.e.addHere'), html: icon('plus', 16), onClick: () => add(i + 1) }));
        }
        const sub = actionSub(a, cur);
        return h('div', { class: ['ou-row', 'clickable', 'rt-act', a.g && 'block'], style: { '--d': dep }, role: 'button', tabindex: 0, dataset: { act: a.type }, onClick: () => edit(i), onKeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && edit(i) },
          roundIcon(actionIcon(a), actionColor(a), 18),
          h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, actionTitle(a)), sub ? h('span', { class: 'ou-row-sub muted' }, sub) : null),
          h('button', { class: 'rt-mini', 'aria-label': t('common.more'), title: t('common.more'), html: icon('more', 18), onClick: (e) => {
            e.stopPropagation();
            menu(e.currentTarget, [
              needsDialog(ACTIONS[a.type]) ? { label: t('common.edit'), icon: 'edit', onClick: () => edit(i) } : null,
              { label: t('routines.e.up'), icon: 'up', disabled: i === 0, onClick: () => commit(moveStep(cur, i, -1)) },
              { label: t('routines.e.down'), icon: 'down', disabled: i === cur.length - 1, onClick: () => commit(moveStep(cur, i, 1)) },
              { label: t('routines.e.addBelow'), icon: 'plus', onClick: () => add(a.g && a.m === 0 ? i + 1 : i + 1) },
              '-',
              { label: t('common.remove'), icon: 'trash', danger: true, onClick: () => remove(i) },
            ], { align: 'end' });
          } }),
          h('button', { class: 'rt-remove', 'aria-label': t('common.remove'), title: t('common.remove'), html: icon('minus', 16), onClick: (e) => { e.stopPropagation(); remove(i); } }));
      }),
      h('button', { class: 'ou-row clickable rt-add-row', onClick: () => add(cur.length) }, h('span', { class: 'rt-add-ico', html: icon('plus', 20) }), h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, addLabel || t('routines.e.addAction')))));
  }
  draw();
  return el;
}
const needsDialog = (d) => !!d && d.params.length > 0;

// ——— the action picker ———
function pickAction(ctx, onPick) {
  ctx.push({
    title: t('routines.e.thenTitle'),
    hero: false,
    className: 'rt-page rt-pick-page',
    render(body) {
      body.classList.add('rt-body');
      const q = h('input', { type: 'search', placeholder: t('routines.e.search'), 'aria-label': t('routines.e.search') });
      const holder = h('div', { class: 'rt-pick-list' });
      const pick = async (d) => {
        // optional Chrome permissions are asked for right here, inside the click
        for (const p of d.perm || []) if (!(await ensure(p))) return toast(t('routines.e.permDenied'));
        ctx.pop();
        onPick(d.id);
      };
      const draw = () => {
        const s = q.value.trim().toLowerCase();
        const defs = Object.values(ACTIONS).filter((d) => !d.id.startsWith('test.') && (!s || t(d.name).toLowerCase().includes(s) || d.id.includes(s)));
        const cats = [...CATS, ...new Set(defs.map((d) => d.cat).filter((c) => !CATS.includes(c)))];
        const nodes = [];
        for (const c of cats) {
          const ds = defs.filter((d) => d.cat === c);
          if (!ds.length) continue;
          nodes.push(h('div', { class: 'ou-subheader' }, t('routines.cat.' + c) === 'routines.cat.' + c ? c : t('routines.cat.' + c)),
            list(...ds.map((d) => {
              const el = row({ icon: roundIcon(d.icon, d.color, 18).outerHTML, title: t(d.name), sub: d.perm ? t('routines.e.needsTabs') : '', className: 'muted-sub rt-pick', onClick: () => pick(d) });
              el.dataset.action = d.id;
              return el;
            })));
        }
        if (!nodes.length) nodes.push(h('div', { class: 'ou-empty' }, t('routines.e.noResults')));
        holder.replaceChildren(...nodes);
      };
      q.addEventListener('input', draw);
      body.append(h('label', { class: 'ou-searchbox rt-search' }, h('span', { html: icon('search', 20) }), q), holder);
      draw();
      setTimeout(() => q.focus(), 350);
    },
  });
}

// ——— parameters ———
/** A text field that can hold variables (chips), like Liquid Tab's Shortcuts fields. */
function varField({ value, multiline = false, placeholder = '', acts }) {
  const f = h('div', { class: ['rt-field', multiline && 'multi'], contenteditable: 'true', role: 'textbox', 'aria-multiline': String(multiline), 'data-ph': placeholder, spellcheck: 'false' });
  const chip = (p) => h('span', { class: 'rt-var', contenteditable: 'false', dataset: { var: JSON.stringify(p) } }, varName(p, acts));
  const parts = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  for (const p of parts) {
    if (p && typeof p === 'object') f.appendChild(chip(p));
    else String(p).split('\n').forEach((line, k) => { if (k) f.appendChild(h('br')); if (line) f.appendChild(document.createTextNode(line)); });
  }
  let range = null;
  const keep = () => { const s = getSelection(); if (s.rangeCount && f.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
  f.addEventListener('keyup', keep);
  f.addEventListener('mouseup', keep);
  f.addEventListener('input', keep);
  f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) e.preventDefault(); });
  f.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  return {
    el: f,
    read() {
      const out = [];
      const push = (s) => { if (!s) return; if (typeof out.at(-1) === 'string') out[out.length - 1] += s; else out.push(s); };
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) push(c.data);
          else if (c.classList?.contains('rt-var')) { try { out.push(JSON.parse(c.dataset.var)); } catch {} }
          else if (c.nodeName === 'BR') { if (c !== f.lastChild) push('\n'); }
          else { if ((c.nodeName === 'DIV' || c.nodeName === 'P') && out.length) push('\n'); walk(c); }
        }
      };
      walk(f);
      if (!out.length) return '';
      return out.length === 1 && typeof out[0] === 'string' ? out[0] : out;
    },
    insert(p) {
      const node = chip(p);
      let r = range && f.contains(range.startContainer) ? range : null;
      if (!r) { r = document.createRange(); r.selectNodeContents(f); r.collapse(false); }
      r.deleteContents();
      r.insertNode(node);
      r.setStartAfter(node);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      range = r.cloneRange();
    },
  };
}

/** The settings of one action in a dialog. Resolves the new parameters, or null when cancelled. */
function editParams(d, a, acts, index) {
  const p = structuredClone(a.p || {});
  const getters = {};
  const vars = [...varsBefore(acts, index, hasOutput), ...namesBefore(acts, index).map((n) => ({ n })), { s: 'date' }, { s: 'ask' }];
  const form = h('div', { class: 'ou-dialog-body rt-form' });
  const field = (pd) => {
    const label = h('div', { class: 'rt-f-label' }, t(pd.label));
    const val = p[pd.key] ?? pd.def;
    const box = h('div', { class: 'rt-f', dataset: { key: pd.key } }, label);
    switch (pd.type) {
      case 'text': case 'number': case 'any': case 'urls': {
        const vf = varField({ value: val, multiline: pd.type === 'urls' || pd.multiline, placeholder: pd.ph ? t(pd.ph) : pd.input ? t('routines.v.prev') : '', acts });
        getters[pd.key] = vf.read;
        box.append(vf.el);
        // text can take any variable; numbers and addresses only show results of earlier actions
        if (pd.type === 'text' || pd.type === 'any' || vars.some((v) => v.v || v.n != null)) {
          box.append(h('div', { class: 'rt-vars' }, h('span', { class: 'rt-vars-label', html: icon('rtVar', 14) }),
            vars.map((v) => h('button', { class: 'rt-var-btn', onMousedown: (e) => e.preventDefault(), onClick: () => vf.insert(v) }, varName(v, acts)))));
        }
        break;
      }
      case 'varname': case 'sites': {
        const inp = pd.type === 'sites' ? h('textarea', { class: 'ou-input', rows: 3, placeholder: t(pd.ph || pd.label), value: String(val || '') }) : h('input', { class: 'ou-input', value: String(val || ''), placeholder: pd.ph ? t(pd.ph) : '' });
        getters[pd.key] = () => (pd.type === 'sites' ? inp.value.split(/[\s,]+/).map(cleanHost).filter(Boolean).join('\n') : inp.value.trim());
        box.append(inp);
        break;
      }
      case 'bool': {
        let v = val !== false;
        const s = sw(v, (x) => (v = x), { label: t(pd.label) });
        getters[pd.key] = () => v;
        box.classList.add('inline');
        box.append(s);
        break;
      }
      case 'percent': {
        let v = Math.round(Number(val ?? 70));
        const out = h('span', { class: 'rt-f-val' }, `⁦${v}%⁩`);
        label.append(out);
        box.append(slider({ min: pd.min ?? 0, max: pd.max ?? 100, value: v, icon: d.icon, label: t(pd.label), onInput: (x) => { v = x; out.textContent = `⁦${x}%⁩`; } }));
        getters[pd.key] = () => String(v);
        break;
      }
      case 'wallpaper': {
        let v = val || 'bloom';
        const grid = h('div', { class: 'rt-walls small' });
        const drawW = () => grid.replaceChildren(...PRESETS.map((x) => {
          const c = h('canvas', { width: 40, height: 72 });
          paintPreset(c, presetById(x.id), 3);
          return h('button', { class: ['rt-wall', v === x.id && 'active'], title: t('wall.' + x.id), onClick: () => { v = x.id; drawW(); } }, c, h('small', null, t('wall.' + x.id)));
        }));
        drawW();
        getters[pd.key] = () => v;
        box.append(grid);
        break;
      }
      case 'items': {
        let items = Array.isArray(val) ? [...val] : ['', ''];
        const holder = h('div', { class: 'rt-items' });
        const drawI = () => holder.replaceChildren(...items.map((x, k) => h('div', { class: 'rt-item' },
          h('input', { class: 'ou-input', value: x, placeholder: t('routines.item', { n: k + 1 }), onInput: (e) => (items[k] = e.target.value) }),
          items.length > 1 ? h('button', { class: 'rt-remove', 'aria-label': t('common.remove'), html: icon('minus', 16), onClick: () => { items.splice(k, 1); drawI(); } }) : null)),
          h('button', { class: 'ou-btn rt-item-add', onClick: () => { items.push(''); drawI(); } }, h('span', { html: icon('plus', 16) }), t('routines.e.addItem')));
        drawI();
        getters[pd.key] = () => items.map((x) => x.trim());
        box.append(holder);
        break;
      }
      default: {
        // choices: enum, mode, sound, app, routine
        const opts = optionsFor(pd);
        let v = val ?? opts[0]?.[0] ?? '';
        const chips = h('div', { class: 'rt-chipset' });
        const drawC = () => chips.replaceChildren(...opts.map(([ov, ol]) => h('button', { class: ['ou-chip', String(ov) === String(v) && 'active'], onClick: () => { v = ov; drawC(); refresh(); } }, ol)));
        drawC();
        getters[pd.key] = () => v;
        box.append(chips);
      }
    }
    return box;
  };
  const read = () => { for (const [k, g] of Object.entries(getters)) p[k] = g(); };
  const refresh = () => {
    read();
    for (const el of form.children) {
      const pd = d.params.find((x) => x.key === el.dataset.key);
      el.hidden = !!pd?.when && !pd.when(p);
    }
  };
  form.append(...d.params.map(field));
  refresh();
  return dialog({
    title: t(d.name),
    className: 'rt-param-dlg',
    content: form,
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: () => { read(); for (const pd of d.params) if (pd.when && !pd.when(p)) delete p[pd.key]; return p; }, primary: true }],
  });
}
function optionsFor(pd) {
  switch (pd.type) {
    case 'enum': return pd.opts.map(([v, l]) => [v, t(l)]);
    case 'mode': return rdata().modes.map((m) => [m.id, modeName(m)]);
    case 'sound': return SOUNDS.map((s) => [s.id, t('sound.' + s.id)]);
    case 'app': return getApps().filter((x) => !x.hidden && x.id !== 'routines').map((x) => [x.id, tr(x.name)]).sort((x, y) => x[1].localeCompare(y[1]));
    case 'routine': return rdata().list.map((r) => [r.id, routineName(r)]);
  }
  return [];
}

addStrings({
  en: {
    'routines.e.if': 'If',
    'routines.e.then': 'Then',
    'routines.e.addIf': 'Add what will start this routine',
    'routines.e.addThen': 'Add what this routine will do',
    'routines.e.addCond': 'Add condition',
    'routines.e.addAction': 'Add action',
    'routines.e.any': 'If any condition is met',
    'routines.e.all': 'If all conditions are met',
    'routines.e.allSub': 'Time periods and modes must hold when the rest happens',
    'routines.e.when': 'When to start',
    'routines.e.undo': 'Undo actions when routine ends',
    'routines.e.undoSub': 'Settings this routine changed go back when it ends or you stop it',
    'routines.e.runNow': 'Start now',
    'routines.e.style': 'Name and icon',
    'routines.e.duplicate': 'Duplicate',
    'routines.e.copyName': '{name} (copy)',
    'routines.e.duplicated': 'Routine duplicated',
    'routines.e.addHome': 'Add to Home screen',
    'routines.e.deleteQ': 'Delete routine?',
    'routines.e.deleteMsg': '“{name}” will be deleted.',
    'routines.e.lastRun': 'Last run {when}',
    'routines.e.never': 'Hasn’t run yet',
    'routines.e.enable': 'Turn on routine',
    'routines.e.needAction': 'Add what this routine will do first',
    'routines.e.saveTitle': 'Save routine',
    'routines.e.namePh': 'Routine name',
    'routines.e.saved': '“{name}” saved',
    'routines.e.ifTitle': 'If',
    'routines.e.ifHint': 'Choose what will start this routine.',
    'routines.e.thenTitle': 'Then',
    'routines.e.cManual': 'Start it yourself with Start, a widget or Finder',
    'routines.e.cTime': 'At a time, or during a period, on the days you pick',
    'routines.e.cSun': 'From sunset to sunrise, or at either, where your weather is',
    'routines.e.cIdle': 'When you come back after being away',
    'routines.e.cMode': 'While a mode is on',
    'routines.e.cSite': 'When you open a website (needs access to your tabs)',
    'routines.e.awayN': 'Away for {n} min or more',
    'routines.e.sitesNote': 'One website per line. Subdomains count too. Bloom Tab needs to see your tabs’ addresses for this, and they stay on this computer.',
    'routines.e.permDenied': 'Bloom Tab needs access to your tabs for this',
    'routines.e.timeOpt': 'Time',
    'routines.e.noEnd': 'No end',
    'routines.e.noEndSub': 'Runs once at the start time.',
    'routines.e.start': 'Start',
    'routines.e.end': 'End',
    'routines.e.repeat': 'Repeat',
    'routines.e.hours': 'Hours',
    'routines.e.minutes': 'Minutes',
    'routines.e.sunWhere': 'Sunrise and sunset times for {place}, from your Weather location.',
    'routines.e.yourPlace': 'your location',
    'routines.e.sunNoLoc': 'Open Weather once or set a location there to use sunrise and sunset.',
    'routines.e.search': 'Search actions',
    'routines.e.needsTabs': 'Needs access to your tabs',
    'routines.e.noResults': 'No actions found',
    'routines.e.addHere': 'Add action here',
    'routines.e.up': 'Move up',
    'routines.e.down': 'Move down',
    'routines.e.addBelow': 'Add action below',
    'routines.e.addItem': 'Add item',
  },
  ar: {
    'routines.e.if': 'إذا',
    'routines.e.then': 'ثم',
    'routines.e.addIf': 'أضف ما سيبدأ هذا الإجراء الروتيني',
    'routines.e.addThen': 'أضف ما سيفعله هذا الإجراء الروتيني',
    'routines.e.addCond': 'إضافة شرط',
    'routines.e.addAction': 'إضافة إجراء',
    'routines.e.any': 'إذا تحقق أي شرط',
    'routines.e.all': 'إذا تحققت كل الشروط',
    'routines.e.allSub': 'يجب أن تكون الفترات الزمنية والأوضاع سارية عند حدوث الباقي',
    'routines.e.when': 'متى يبدأ',
    'routines.e.undo': 'التراجع عن الإجراءات عند انتهاء الروتين',
    'routines.e.undoSub': 'تعود الإعدادات التي غيّرها هذا الإجراء الروتيني عند انتهائه أو إيقافه',
    'routines.e.runNow': 'البدء الآن',
    'routines.e.style': 'الاسم والرمز',
    'routines.e.duplicate': 'تكرار',
    'routines.e.copyName': '{name} (نسخة)',
    'routines.e.duplicated': 'تم تكرار الإجراء الروتيني',
    'routines.e.addHome': 'إضافة إلى الشاشة الرئيسية',
    'routines.e.deleteQ': 'حذف الإجراء الروتيني؟',
    'routines.e.deleteMsg': 'سيتم حذف ”{name}“.',
    'routines.e.lastRun': 'آخر تشغيل {when}',
    'routines.e.never': 'لم يعمل بعد',
    'routines.e.enable': 'تشغيل الإجراء الروتيني',
    'routines.e.needAction': 'أضف أولًا ما سيفعله هذا الإجراء الروتيني',
    'routines.e.saveTitle': 'حفظ الإجراء الروتيني',
    'routines.e.namePh': 'اسم الإجراء الروتيني',
    'routines.e.saved': 'تم حفظ ”{name}“',
    'routines.e.ifTitle': 'إذا',
    'routines.e.ifHint': 'اختر ما سيبدأ هذا الإجراء الروتيني.',
    'routines.e.thenTitle': 'ثم',
    'routines.e.cManual': 'ابدأه بنفسك بزر البدء أو أداة أو الباحث',
    'routines.e.cTime': 'في وقت محدد أو خلال فترة، في الأيام التي تختارها',
    'routines.e.cSun': 'من الغروب إلى الشروق أو عند أي منهما، حسب موقع الطقس',
    'routines.e.cIdle': 'عند عودتك بعد الابتعاد',
    'routines.e.cMode': 'أثناء تشغيل وضع',
    'routines.e.cSite': 'عند فتح موقع ويب (يحتاج إلى الوصول إلى علامات التبويب)',
    'routines.e.awayN': 'الابتعاد {n} دقيقة أو أكثر',
    'routines.e.sitesNote': 'موقع واحد في كل سطر. تُحتسب النطاقات الفرعية أيضًا. يحتاج Bloom Tab إلى رؤية عناوين علامات التبويب لذلك، وتبقى على هذا الكمبيوتر.',
    'routines.e.permDenied': 'يحتاج Bloom Tab إلى الوصول إلى علامات التبويب لذلك',
    'routines.e.timeOpt': 'الوقت',
    'routines.e.noEnd': 'بلا نهاية',
    'routines.e.noEndSub': 'يعمل مرة واحدة في وقت البدء.',
    'routines.e.start': 'البدء',
    'routines.e.end': 'الانتهاء',
    'routines.e.repeat': 'التكرار',
    'routines.e.hours': 'الساعات',
    'routines.e.minutes': 'الدقائق',
    'routines.e.sunWhere': 'أوقات الشروق والغروب في {place}، من موقع الطقس.',
    'routines.e.yourPlace': 'موقعك',
    'routines.e.sunNoLoc': 'افتح الطقس مرة واحدة أو حدد موقعًا فيه لاستخدام الشروق والغروب.',
    'routines.e.search': 'البحث في الإجراءات',
    'routines.e.needsTabs': 'يحتاج إلى الوصول إلى علامات التبويب',
    'routines.e.noResults': 'لم يتم العثور على إجراءات',
    'routines.e.addHere': 'إضافة إجراء هنا',
    'routines.e.up': 'نقل لأعلى',
    'routines.e.down': 'نقل لأسفل',
    'routines.e.addBelow': 'إضافة إجراء أسفله',
    'routines.e.addItem': 'إضافة عنصر',
  },
});
