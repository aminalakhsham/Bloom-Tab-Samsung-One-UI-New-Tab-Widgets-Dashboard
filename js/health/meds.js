// Samsung Health › Medications: today's doses grouped by time with Take buttons (a tap on a dose offers Taken,
// Skipped or Clear), "as needed" medications, the list of medications, each medication's page (schedule, adherence,
// history) and the add/edit screen (name, type, strength, schedule and times, shape and colours, dates, notes).
// Reminders come from the service worker (js/bg/health.js); its Taken and Skip buttons write to `healthSW`.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, iconBtn, toast, confirm, dialog, switchRow, list, swatches } from '../core/ui.js';
import * as M from './model.js';
import * as H from './data.js';
import * as F from './format.js';
import { pillSVG, shapeOnly, shapesFor, defaultShape, SHAPES, PILL_COLORS, BG_COLORS } from './art.js';
import { section, pillBtn, chips, field, input, stepper, bottomBar, empty } from './kit.js';

const COLOR = '#7a6cf5';

/** Medication reminders and follow-ups (health.medPrefs, read by the service worker). */
export async function reminderSettings() {
  const p = H.D().medPrefs;
  let remind = p.remind, follow = p.follow;
  const res = await dialog({
    title: t('health.meds.reminders'),
    content: h('div', { class: 'ou-dialog-body hl-dlg-list' }, list(
      switchRow({ title: t('health.meds.remind'), sub: t('health.meds.remindSub'), checked: remind, onChange: (v) => (remind = v) }),
      switchRow({ title: t('health.meds.follow'), sub: t('health.meds.followSub'), checked: follow, onChange: (v) => (follow = v) }))),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: true }],
  });
  if (res) H.mut((d) => { d.medPrefs = { remind, follow }; });
}

function doseRow(x) {
  const st = x.entry?.status;
  const check = h('button', {
    class: ['hl-check', st === 'taken' && 'on', st === 'skipped' && 'skip'], 'data-check': x.med.id + '|' + x.slot, 'aria-pressed': String(st === 'taken'),
    'aria-label': st === 'taken' ? t('health.taken') : t('health.markTaken'), title: st === 'taken' ? t('health.taken') : t('health.markTaken'), html: icon(st === 'skipped' ? 'close' : 'check', 20),
    onClick: (e) => { e.stopPropagation(); H.toggleDose(x.med.id, x.slot); },
  });
  const row = h('div', { class: ['hl-dose', st], 'data-slot': x.slot, 'data-med': x.med.id, role: 'button', tabindex: 0 },
    h('span', { class: 'hl-dose-pill', html: pillSVG(x.med) }),
    h('span', { class: 'hl-dose-t' },
      h('b', null, F.medName(x.med)),
      h('small', null, [F.strengthText(x.med), F.doseText(x.med, x.n)].filter(Boolean).join(' · ')),
      x.entry ? h('small', { class: ['hl-dose-st', st] }, F.statusText(x.entry)) : null),
    check);
  const logMenu = (at) => menu(at, [
    { label: t('health.taken'), icon: 'check', onClick: () => H.logMed(x.med.id, 'taken', x.slot) },
    { label: t('health.skipped'), icon: 'close', onClick: () => H.logMed(x.med.id, 'skipped', x.slot) },
    { label: t('health.clearLog'), icon: 'refresh', disabled: !x.entry, onClick: () => H.logMed(x.med.id, 'cleared', x.slot) },
  ]);
  row.addEventListener('click', (e) => logMenu(e.detail ? e : row));
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) logMenu(row); });
  return row;
}
const medRow = (m, onOpen) => h('button', { class: 'hl-li', 'data-med-open': m.id, onClick: onOpen },
  h('span', { class: 'hl-li-pill', html: pillSVG(m) }),
  h('span', { class: 'hl-li-t' }, h('b', null, F.medName(m)), h('small', null, F.medSub(m)),
    h('small', null, F.schedText(m) + (m.sched.kind !== 'asNeeded' ? ' · ' + m.sched.times.map((x) => F.timeOf(x.t)).join(', ') : ''))),
  h('span', { class: 'hl-li-chev', html: icon('forward', 18) }));

export function openMeds(ctx, nav) {
  ctx.push({
    title: t('health.cards.meds'), hero: false, className: 'hl-page hl-meds-page',
    actions: [
      iconBtn('plus', () => editMed(ctx, nav, null), t('health.meds.add')),
      iconBtn('more', (e) => menu(e.currentTarget, [{ label: t('health.meds.reminders'), icon: 'bell', onClick: reminderSettings }], { align: 'end' }), t('common.more')),
    ],
    render(body) {
      body.classList.add('hl-body');
      const draw = () => {
        const d = H.D(), lg = H.logs(d), k = M.dayKey(), meds = M.activeMeds(d);
        if (!d.meds.length) {
          body.replaceChildren(empty('hlPill', t('health.meds.emptyPage'), pillBtn(t('health.meds.add'), () => editMed(ctx, nav, null), { primary: true, attrs: { 'data-add-med': '' } })));
          return;
        }
        const slots = M.slotsOf(M.dayDoses(d, lg, k));
        const prn = meds.filter((m) => m.sched.kind === 'asNeeded');
        const hist = M.history(lg);
        body.replaceChildren(
          section(t('health.meds.today', { date: F.dateText(k, { weekday: 'long', month: 'long', day: 'numeric' }) }), slots.length ? slots.map((s) => {
            const open = s.doses.filter((x) => !x.entry);
            return h('div', { class: 'hl-dosegrp', 'data-slot': s.slot },
              h('div', { class: 'hl-dosegrp-h' }, h('b', null, F.timeOf(s.t)), open.length ? pillBtn(open.length > 1 ? t('health.takeAll') : t('health.take'), () => { H.logSlot(s.slot, 'taken'); toast(t('health.toast.slotTaken', { time: F.timeOf(s.t) })); }, { attrs: { 'data-take-slot': s.slot } }) : h('span', { class: 'hl-done-tag', html: icon('check', 16) })),
              s.doses.map(doseRow));
          }) : h('p', { class: 'hl-sub' }, t('health.meds.nothingToday')), { cls: 'hl-today-sec' }),
          prn.length ? section(t('health.meds.asNeeded'), prn.map((m) => {
            const last = hist.find((e) => e.med === m.id && e.status === 'taken');
            return h('div', { class: 'hl-dose prn', 'data-med': m.id },
              h('span', { class: 'hl-dose-pill', html: pillSVG(m) }),
              h('span', { class: 'hl-dose-t' }, h('b', null, F.medName(m)), h('small', null, last ? t('health.meds.lastTaken', { when: F.whenText(last.at) }) : F.medSub(m))),
              pillBtn(t('health.log'), () => { H.logMed(m.id, 'taken', ''); toast(t('health.toast.taken', { name: F.medName(m) })); }, { attrs: { 'data-log-prn': m.id } }));
          })) : null,
          section(t('health.meds.mine'), meds.map((m) => medRow(m, () => openMed(ctx, nav, m.id))), { action: h('button', { class: 'hl-link', onClick: () => editMed(ctx, nav, null) }, t('health.meds.add')) }),
          d.meds.some((m) => m.archived) ? section(t('health.meds.archived'), d.meds.filter((m) => m.archived).map((m) => medRow(m, () => openMed(ctx, nav, m.id))), { cls: 'hl-archived' }) : null,
          h('p', { class: 'hl-note' }, t('health.meds.disclaimer')));
      };
      draw();
      return H.watch(H.DATA_KEYS, draw);
    },
  });
}

export function openMed(ctx, nav, id) {
  if (!H.D().meds.some((m) => m.id === id)) return;
  ctx.push({
    title: '', hero: false, className: 'hl-page hl-med-page',
    actions: [
      iconBtn('edit', () => editMed(ctx, nav, H.D().meds.find((m) => m.id === id)), t('common.edit')),
      iconBtn('more', (e) => {
        const m = H.D().meds.find((x) => x.id === id);
        menu(e.currentTarget, [
          { label: m?.archived ? t('health.meds.restore') : t('health.meds.archive'), icon: 'folder', onClick: () => { H.mut((d) => { const x = d.meds.find((y) => y.id === id); if (x) x.archived = !x.archived; }); toast(m?.archived ? t('health.meds.restored') : t('health.meds.archivedToast')); } },
          { label: t('common.delete'), icon: 'trash', danger: true, onClick: async () => {
            if (!(await confirm(t('health.meds.deleteQ', { name: F.medName(m) }), t('health.meds.deleteMsg'), { okLabel: t('common.delete'), danger: true }))) return;
            H.mut((d) => { d.meds = d.meds.filter((x) => x.id !== id); d.medLog = d.medLog.filter((e) => e.med !== id); });
            ctx.pop();
          } },
        ], { align: 'end' });
      }, t('common.more')),
    ],
    render(body, page) {
      body.classList.add('hl-body');
      const draw = () => {
        const d = H.D(), m = d.meds.find((x) => x.id === id);
        if (!m) return;
        page.setTitle(F.medName(m));
        const lg = H.logs(d), now = Date.now(), today = M.dayKey(now), idx = M.logIndex(lg);
        const adh = M.adherence(d, lg, id, 30, now), hist = M.history(lg, id).slice(0, 30);
        body.replaceChildren(
          h('div', { class: 'hl-med-hero' },
            h('span', { class: 'hl-med-art', html: pillSVG(m) }),
            h('h2', null, F.medName(m)),
            m.nick ? h('div', { class: 'hl-sub' }, m.name) : null,
            h('div', { class: 'hl-sub' }, F.medSub(m)),
            m.archived ? h('span', { class: 'hl-tag' }, t('health.meds.archivedTag')) : null),
          section(t('health.meds.schedule'), [
            h('div', { class: 'hl-kvrow' }, h('span', null, t('health.meds.frequency')), h('b', null, F.schedText(m))),
            m.sched.kind !== 'asNeeded' ? h('div', { class: 'hl-kvrow' }, h('span', null, t('health.meds.times')), h('b', null, m.sched.times.map((x) => `${F.timeOf(x.t)} · ${F.doseText(m, x.n)}`).join('\n'))) : null,
            h('div', { class: 'hl-kvrow' }, h('span', null, t('health.meds.startDate')), h('b', null, F.dateText(m.start, { year: 'numeric', month: 'short', day: 'numeric' }))),
            m.end ? h('div', { class: 'hl-kvrow' }, h('span', null, t('health.meds.endDate')), h('b', null, F.dateText(m.end, { year: 'numeric', month: 'short', day: 'numeric' }))) : null,
          ]),
          m.sched.kind !== 'asNeeded' ? section(t('health.meds.adherence'), [
            h('div', { class: 'hl-adh' },
              h('div', null, h('div', { class: 'hl-big' }, h('b', null, adh.pct == null ? '–' : F.num(adh.pct)), adh.pct == null ? null : h('small', null, '%')), h('div', { class: 'hl-sub' }, t('health.meds.adhSub', { taken: F.num(adh.taken), total: F.num(adh.total) }))),
              h('div', { class: 'hl-adh-days' }, Array.from({ length: 14 }, (_, i) => {
                const k = M.addDays(today, i - 13), st = M.dayState(d, lg, m, k, now, idx);
                return h('span', { class: ['hl-adh-d', st], title: F.dayText(k) + ' · ' + t('health.state.' + st) }, h('i'), h('small', null, F.dateText(k, { weekday: 'narrow' })));
              }))),
          ]) : null,
          m.notes ? section(t('health.meds.notes'), h('p', { class: 'hl-notes' }, m.notes)) : null,
          section(t('health.meds.history'), hist.length ? hist.map((e) => h('div', { class: 'hl-hist' },
            h('span', { class: ['hl-hist-ico', e.status], html: icon(e.status === 'taken' ? 'check' : 'close', 16) }),
            h('span', { class: 'hl-hist-t' }, h('b', null, e.status === 'taken' ? t('health.taken') : t('health.skipped')), h('small', null, e.slot ? t('health.meds.forDose', { time: F.timeOf(e.slot.split('T')[1]), date: F.dayText(e.slot.split('T')[0]) }) : t('health.meds.asNeeded'))),
            h('small', null, F.whenText(e.at)))) : h('p', { class: 'hl-sub' }, t('health.meds.noHistory'))));
      };
      draw();
      return H.watch(H.DATA_KEYS, draw);
    },
  });
}

// ——— add / edit ———
const SCHED_LABEL = { daily: 'health.sched.daily', days: 'health.sched.days', interval: 'health.sched.interval', cycle: 'health.sched.cycle', asNeeded: 'health.sched.asNeeded' };
export function editMed(ctx, nav, med) {
  const isNew = !med;
  const m = med ? structuredClone(med) : M.normMed({ id: M.newId('med'), name: '', type: 'tablet', sched: { kind: 'daily', times: [{ t: '09:00', n: 1 }] }, start: M.dayKey(), at: Date.now() });
  if (isNew) { m.name = ''; m.shape = defaultShape(m.type); m.c1 = '#ffffff'; m.c2 = '#ffffff'; m.bg = BG_COLORS[0]; }
  ctx.push({
    title: isNew ? t('health.meds.add') : t('health.meds.edit'), hero: false, className: 'hl-page hl-edit-page',
    render(body, page) {
      body.classList.add('hl-body', 'hl-form');
      const preview = h('span', { class: 'hl-edit-art', html: pillSVG(m) });
      const refresh = () => { preview.innerHTML = pillSVG(m); drawShapes(); drawColors(); };
      const name = input({ value: m.name, placeholder: t('health.meds.namePh'), maxlength: 60, 'data-f': 'name', onInput: (e) => { m.name = e.target.value; err.hidden = true; } });
      const err = h('div', { class: 'hl-err', hidden: true }, t('health.meds.nameNeeded'));
      const nick = input({ value: m.nick || '', placeholder: t('health.meds.nickPh'), maxlength: 40, 'data-f': 'nick', onInput: (e) => (m.nick = e.target.value) });
      const typeChips = chips(M.MED_TYPES.map((x) => ({ value: x, label: F.medTypeName(x) })), m.type, (v) => { m.type = v; if (!shapesFor(v).includes(m.shape)) m.shape = defaultShape(v); refresh(); }, { cls: 'hl-type-chips' });
      const strength = input({ value: m.strength || '', placeholder: '0', inputmode: 'decimal', 'data-f': 'strength', class: 'ou-input hl-strength', onInput: (e) => (m.strength = String(F.numIn(e.target.value) || '').trim()) });
      const unitChips = chips(M.STRENGTH_UNITS.map((u) => ({ value: u, label: u })), m.unit || 'mg', (v) => (m.unit = v), { cls: 'hl-unit-chips' });
      m.unit ||= 'mg';
      // schedule
      const schedBox = h('div', { class: 'hl-sched-box' });
      const timesBox = h('div', { class: 'hl-times' });
      const drawSched = () => {
        const s = m.sched;
        const extra = s.kind === 'days'
          ? h('div', { class: 'hl-wdays' }, F.weekdays('short').map(([i, n]) => h('button', { class: ['hl-wday', s.days.includes(i) && 'on'], 'aria-pressed': String(s.days.includes(i)), 'data-wday': i, onClick: (e) => { e.preventDefault(); s.days = s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i]; drawSched(); } }, n)))
          : s.kind === 'interval' ? h('div', { class: 'hl-inline' }, t('health.sched.every'), stepper(s.every, { min: 2, max: 30, fmt: (v) => t('health.sched.nDays', { n: F.num(v) }), onChange: (v) => (s.every = v) }))
            : s.kind === 'cycle' ? h('div', { class: 'hl-inline col' },
              h('span', null, t('health.sched.daysOn'), stepper(s.on, { min: 1, max: 90, fmt: (v) => F.num(v), onChange: (v) => (s.on = v) })),
              h('span', null, t('health.sched.daysOff'), stepper(s.off, { min: 1, max: 90, fmt: (v) => F.num(v), onChange: (v) => (s.off = v) })))
              : null;
        schedBox.replaceChildren(...[extra].filter(Boolean));
        timesBox.hidden = s.kind === 'asNeeded';
        drawTimes();
      };
      const kindChips = chips(M.SCHED_KINDS.map((k) => ({ value: k, label: t(SCHED_LABEL[k]) })), m.sched.kind, (v) => {
        m.sched.kind = v;
        if (v !== 'asNeeded' && !m.sched.times.length) m.sched.times = [{ t: '09:00', n: 1 }];
        if (v === 'days' && !m.sched.days.length) m.sched.days = [new Date().getDay()];
        drawSched();
      }, { cls: 'hl-kind-chips' });
      const drawTimes = () => {
        const s = m.sched;
        timesBox.replaceChildren(
          h('div', { class: 'hl-field-label' }, t('health.meds.times')),
          ...s.times.map((x, i) => h('div', { class: 'hl-time-row' },
            input({ type: 'time', value: x.t, class: 'ou-input hl-time', 'aria-label': t('health.meds.time'), onChange: (e) => { if (/^\d\d:\d\d$/.test(e.target.value)) x.t = e.target.value; } }),
            stepper(x.n, { min: 0.5, max: 10, step: 0.5, fmt: (v) => F.doseText(m, v), onChange: (v) => (x.n = v) }),
            s.times.length > 1 ? h('button', { class: 'ou-icon-btn', 'aria-label': t('common.remove'), html: icon('minus', 20), onClick: (e) => { e.preventDefault(); s.times.splice(i, 1); drawTimes(); } }) : null)),
          h('button', { class: 'hl-link hl-add-time', onClick: (e) => { e.preventDefault(); const last = s.times.at(-1)?.t || '08:00'; const hh = (+last.slice(0, 2) + 4) % 24; s.times.push({ t: `${String(hh).padStart(2, '0')}:${last.slice(3)}`, n: 1 }); drawTimes(); } }, h('span', { html: icon('plus', 18) }), t('health.meds.addTime')));
      };
      // shape and colours
      const shapesEl = h('div', { class: 'hl-shapes' });
      const drawShapes = () => shapesEl.replaceChildren(...shapesFor(m.type).map((s) => h('button', {
        class: ['hl-shape', m.shape === s && 'on'], 'data-shape': s, 'aria-pressed': String(m.shape === s), 'aria-label': s,
        html: shapeOnly(s, m.c1, m.c2), onClick: (e) => { e.preventDefault(); m.shape = s; refresh(); },
      })));
      const colorsEl = h('div', { class: 'hl-colors' });
      const drawColors = () => {
        const two = (SHAPES[m.shape] || SHAPES.round).n === 2;
        colorsEl.replaceChildren(
          h('div', { class: 'hl-field-label' }, two ? t('health.meds.colorLeft') : t('health.meds.color')),
          swatches(PILL_COLORS, m.c1, (c) => { m.c1 = c; if (!two) m.c2 = c; preview.innerHTML = pillSVG(m); drawShapes(); }),
          two ? h('div', { class: 'hl-field-label' }, t('health.meds.colorRight')) : null,
          two ? swatches(PILL_COLORS, m.c2, (c) => { m.c2 = c; preview.innerHTML = pillSVG(m); drawShapes(); }) : null,
          h('div', { class: 'hl-field-label' }, t('health.meds.background')),
          swatches(BG_COLORS, m.bg, (c) => { m.bg = c; preview.innerHTML = pillSVG(m); }));
      };
      const start = input({ type: 'date', value: m.start, onChange: (e) => { if (M.isKey(e.target.value)) m.start = e.target.value; } });
      const end = input({ type: 'date', value: m.end || '', onChange: (e) => (m.end = M.isKey(e.target.value) ? e.target.value : '') });
      const notes = h('textarea', { class: 'ou-input', rows: 3, maxlength: 500, placeholder: t('health.meds.notesPh'), value: m.notes || '', onInput: (e) => (m.notes = e.target.value) });
      const save = () => {
        m.name = m.name.trim();
        if (!m.name) { err.hidden = false; name.focus(); return; }
        if (m.sched.kind === 'days' && !m.sched.days.length) m.sched.kind = 'daily';
        if (m.end && m.end < m.start) m.end = '';
        const saved = M.normMed({ ...m, nick: (m.nick || '').trim(), notes: (m.notes || '').trim() });
        H.mut((d) => { const i = d.meds.findIndex((x) => x.id === saved.id); if (i >= 0) d.meds[i] = saved; else d.meds.push(saved); });
        toast(isNew ? t('health.meds.added', { name: F.medName(saved) }) : t('health.meds.saved'));
        ctx.pop();
      };
      body.append(
        h('div', { class: 'hl-edit-hero' }, preview),
        section(null, [field(t('health.meds.name'), name), err, field(t('health.meds.nick'), nick)]),
        section(t('health.meds.type'), typeChips),
        section(t('health.meds.strength'), h('div', { class: 'hl-strength-row' }, strength, unitChips)),
        section(t('health.meds.frequency'), [kindChips, schedBox, timesBox]),
        section(t('health.meds.shape'), [shapesEl, colorsEl]),
        section(t('health.meds.duration'), h('div', { class: 'hl-2col' }, field(t('health.meds.startDate'), start), field(t('health.meds.endDate'), end))),
        section(t('health.meds.notes'), notes),
        h('div', { class: 'hl-bb-space' }));
      page.el.appendChild(bottomBar(() => ctx.pop(), save));
      drawSched();
      drawShapes();
      drawColors();
      if (isNew) setTimeout(() => name.focus(), 80);
    },
  });
}
