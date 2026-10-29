// Samsung Health › Water, Sleep and Body composition: each page has its summary, quick entry, a Days / Weeks / Months
// trend chart and the records (tap the bin to delete one). Units and goals are set from the ⋮ menu.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, iconBtn, toast, dialog } from '../core/ui.js';
import * as M from './model.js';
import * as H from './data.js';
import * as F from './format.js';
import { trendChart } from './charts.js';
import { section, pillBtn, roundBtn, bigVal, chips, field, input, askNumber, empty, CARD_COLOR, durBig } from './kit.js';

const delBtn = (onClick) => h('button', { class: 'ou-icon-btn hl-del', 'aria-label': t('common.delete'), title: t('common.delete'), html: icon('trash', 18), onClick });
const more = (items) => iconBtn('more', (e) => menu(e.currentTarget, items(), { align: 'end' }), t('common.more'));

/** Units for weight, height and water (stored in health.units; a missing one follows the region). */
export async function unitsDialog() {
  const u = H.units();
  const pick = {
    weight: chips([{ value: 'kg', label: F.unitName('kg') }, { value: 'lb', label: F.unitName('lb') }], u.weight),
    height: chips([{ value: 'cm', label: F.unitName('cm') }, { value: 'in', label: t('health.units.ftin') }], u.height),
    water: chips([{ value: 'ml', label: F.unitName('ml') }, { value: 'floz', label: F.unitName('floz') }], u.water),
  };
  const res = await dialog({
    title: t('health.units'),
    content: h('div', { class: 'ou-dialog-body hl-units' }, ['weight', 'height', 'water'].map((k) => field(t('health.units.' + k), pick[k]))),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, value: () => ({ weight: pick.weight.value, height: pick.height.value, water: pick.water.value }) }],
  });
  if (res) H.mut((d) => { d.units = res; });
}

// ——— Water ———
export async function waterGoalDialog() {
  const d = H.D(), u = H.units(d);
  const v = await askNumber({ title: t('health.water.goal'), value: M.toUnit('water', M.waterGoal(d, u), u), unit: F.unitName(u.water), min: 1, max: u.water === 'ml' ? 10000 : 340, decimals: u.water === 'ml' ? 0 : 1 });
  if (v != null) H.mut((x) => { x.waterGoal = Math.round(M.fromUnit('water', v, u)); });
}
async function cupDialog() {
  const d = H.D(), u = H.units(d);
  const v = await askNumber({ title: t('health.water.glassSize'), value: M.toUnit('water', M.cupOf(d, u), u), unit: F.unitName(u.water), min: 1, max: u.water === 'ml' ? 2000 : 68, decimals: u.water === 'ml' ? 0 : 1 });
  if (v != null) H.mut((x) => { x.cup = Math.round(M.fromUnit('water', v, u) * 10) / 10; });
}
const glassArt = (p) => `<svg class="hl-glass" viewBox="0 0 80 100" aria-hidden="true"><defs><clipPath id="hlGlassClip"><path d="M10 8h60l-7 84a6 6 0 0 1-6 5H23a6 6 0 0 1-6-5Z"/></clipPath></defs><path d="M10 8h60l-7 84a6 6 0 0 1-6 5H23a6 6 0 0 1-6-5Z" fill="rgba(47,155,255,.1)" stroke="rgba(47,155,255,.45)" stroke-width="2.5"/><g clip-path="url(#hlGlassClip)"><rect x="0" y="${(100 - 92 * Math.min(1, p)).toFixed(1)}" width="80" height="100" fill="#2f9bff" opacity=".85"/></g></svg>`;
export function openWater(ctx) {
  ctx.push({
    title: t('health.cards.water'), hero: false, className: 'hl-page hl-water-page',
    actions: [more(() => [{ label: t('health.water.goal'), icon: 'hlTarget', onClick: waterGoalDialog }, { label: t('health.water.glassSize'), icon: 'hlCup', onClick: cupDialog }, { label: t('health.units'), icon: 'sort', onClick: unitsDialog }])],
    render(body) {
      body.classList.add('hl-body');
      const chart = trendChart({ kind: 'sum', color: CARD_COLOR.water, points: () => M.points(H.D(), 'water'), goal: () => M.waterGoal(H.D(), H.units()), value: (v) => F.waterText(v, H.units()) });
      const top = h('div'), recs = h('div');
      const draw = () => {
        const d = H.D(), u = H.units(d), k = M.dayKey(), ml = M.waterOn(d, k), goal = M.waterGoal(d, u), cup = M.cupOf(d, u);
        top.replaceChildren(section(null, h('div', { class: 'hl-water-hero' },
          h('span', { class: 'hl-glass-wrap', html: glassArt(ml / goal) }),
          h('div', { class: 'hl-water-main' },
            bigVal(F.waterNum(ml, u), F.unitName(u.water), 'xl'),
            h('div', { class: 'hl-sub' }, t('health.water.ofGoal', { goal: F.waterText(goal, u) })),
            h('div', { class: 'hl-rounds' },
              roundBtn('minus', () => H.undoWater(), t('health.water.remove'), 'minus'),
              h('span', { class: 'hl-cup' }, t('health.water.glass', { amount: F.waterText(cup, u) })),
              roundBtn('plus', () => H.logWater(cup), t('health.water.add'), 'plus')),
            h('div', { class: 'hl-quick' },
              pillBtn(t('health.water.bottle', { amount: F.waterText(u.water === 'ml' ? 500 : 16.9 * M.ML_FLOZ, u) }), () => H.logWater(u.water === 'ml' ? 500 : 16.9 * M.ML_FLOZ), { attrs: { 'data-add': '500' } }),
              pillBtn(t('health.water.other'), async () => {
                const v = await askNumber({ title: t('health.water.addAmount'), unit: F.unitName(u.water), min: 1, max: u.water === 'ml' ? 5000 : 170, decimals: u.water === 'ml' ? 0 : 1 });
                if (v != null) H.logWater(M.fromUnit('water', v, u));
              }))))));
        const today = d.water.filter((e) => M.dayKey(e.at) === k).sort((a, b) => b.at - a.at);
        recs.replaceChildren(section(t('health.records.today'), today.length ? today.map((e) => h('div', { class: 'hl-rec' },
          h('span', { class: 'hl-rec-ico', style: { color: CARD_COLOR.water }, html: icon('drop', 18) }),
          h('span', { class: 'hl-rec-t' }, h('b', null, F.waterText(e.ml, u)), h('small', null, F.clock(e.at))),
          delBtn(() => H.mut((x) => { x.water = x.water.filter((y) => y.id !== e.id); })))) : h('p', { class: 'hl-sub' }, t('health.records.none'))));
        chart.redraw();
      };
      body.append(top, section(t('health.trends'), chart), recs);
      draw();
      return H.watch([M.KEY], draw);
    },
  });
}

// ——— Sleep ———
export async function sleepGoalDialog() {
  const d = H.D();
  const v = await askNumber({ title: t('health.sleep.goal'), value: M.sleepGoal(d) / 60, unit: t('health.u.h'), min: 3, max: 14, decimals: 1 });
  if (v != null) H.mut((x) => { x.sleepGoal = Math.round(v * 60); });
}
/** Record a night: the wake-up day, bedtime and wake-up time. */
export async function addSleep() {
  const wake = input({ type: 'date', value: M.dayKey(), max: M.dayKey(), 'data-f': 'day' });
  const bed = input({ type: 'time', value: '23:00', 'data-f': 'bed' });
  const up = input({ type: 'time', value: '07:00', 'data-f': 'wake' });
  const err = h('div', { class: 'hl-err', hidden: true }, t('health.sleep.bad'));
  const span = () => {
    if (!M.isKey(wake.value) || !/^\d\d:\d\d$/.test(bed.value) || !/^\d\d:\d\d$/.test(up.value)) return null;
    const end = M.slotTime(M.slotKey(wake.value, up.value));
    let start = M.slotTime(M.slotKey(wake.value, bed.value));
    if (start >= end) start = M.slotTime(M.slotKey(M.addDays(wake.value, -1), bed.value));
    return end - start >= 10 * 60000 && end - start <= 20 * 3600e3 ? { start, end } : null;
  };
  const res = await dialog({
    title: t('health.sleep.record'),
    content: h('div', { class: 'ou-dialog-body hl-form-dlg' }, field(t('health.sleep.wakeDay'), wake), h('div', { class: 'hl-2col' }, field(t('health.sleep.bedtime'), bed), field(t('health.sleep.wakeTime'), up)), err),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, validate: () => { const ok = !!span(); err.hidden = ok; return ok; }, value: () => span() }],
  });
  if (!res) return;
  H.mut((d) => { d.sleep.push({ id: M.newId('sl'), ...res }); });
  toast(t('health.sleep.saved', { time: F.durText((res.end - res.start) / 60000) }));
}
export function openSleep(ctx, nav, arg) {
  ctx.push({
    title: t('health.cards.sleep'), hero: false, className: 'hl-page hl-sleep-page',
    actions: [more(() => [{ label: t('health.sleep.goal'), icon: 'hlTarget', onClick: sleepGoalDialog }])],
    render(body) {
      body.classList.add('hl-body');
      const chart = trendChart({ kind: 'sleep', color: CARD_COLOR.sleep, points: () => M.points(H.D(), 'sleep'), goal: () => M.sleepGoal(H.D()), value: (v) => F.durText(v) });
      const top = h('div'), recs = h('div');
      const draw = () => {
        const d = H.D(), last = M.lastSleep(d), goal = M.sleepGoal(d);
        top.replaceChildren(section(null, [h('div', { class: 'hl-sleep-hero' },
          h('span', { class: 'hl-sleep-art', html: icon('moon', 40) }),
          last ? h('div', null, h('small', { class: 'hl-sub' }, F.dayText(M.dayKey(last.end))), durBig(M.sleepMin(last), 'xl'), h('div', { class: 'hl-sub' }, `${F.clock(last.start)} – ${F.clock(last.end)}`))
            : h('div', null, h('p', { class: 'hl-card-q' }, t('health.sleep.emptyCard'))),
          h('div', { class: 'hl-sleep-goal' }, h('small', null, t('health.sleep.goalShort')), h('b', null, F.durText(goal)))),
        h('div', { class: 'hl-center' }, pillBtn(t('health.sleep.record'), addSleep, { primary: true, ic: 'plus', attrs: { 'data-add-sleep': '' } }))]));
        const nights = [...d.sleep].sort((a, b) => b.end - a.end).slice(0, 30);
        recs.replaceChildren(section(t('health.records'), nights.length ? nights.map((e) => h('div', { class: 'hl-rec' },
          h('span', { class: 'hl-rec-ico', style: { color: CARD_COLOR.sleep }, html: icon('hlBed', 18) }),
          h('span', { class: 'hl-rec-t' }, h('b', null, F.durText(M.sleepMin(e))), h('small', null, `${F.dayText(M.dayKey(e.end))} · ${F.clock(e.start)} – ${F.clock(e.end)}`)),
          delBtn(() => H.mut((x) => { x.sleep = x.sleep.filter((y) => y.id !== e.id); })))) : h('p', { class: 'hl-sub' }, t('health.records.none'))));
        chart.redraw();
      };
      body.append(top, section(t('health.trends'), chart), recs);
      draw();
      if (arg?.add) setTimeout(addSleep, 350);
      return H.watch([M.KEY], draw);
    },
  });
}

// ——— Body composition ———
/** Enter today's measurements: weight, body fat, skeletal muscle and height (any of them). */
export async function addBody() {
  const d = H.D(), u = H.units(d);
  const lw = M.latestBody(d, 'weight'), lh = M.latestBody(d, 'height');
  const f = (kind, value, digits = 1) => input({ type: 'text', inputmode: 'decimal', 'data-f': kind, value: value != null ? F.num(value, digits).replace(/,/g, '') : '', placeholder: '–' });
  const fields = {
    weight: f('weight', lw ? M.toUnit('weight', lw.value, u) : null),
    fat: f('fat', null),
    muscle: f('muscle', null),
    height: f('height', lh ? M.toUnit('height', lh.value, u) : null, 0),
  };
  const unit = { weight: F.unitName(u.weight), fat: '%', muscle: F.unitName(u.weight), height: F.unitName(u.height) };
  const range = { weight: [1, 700], fat: [1, 80], muscle: [1, 300], height: [30, 280] };
  const err = h('div', { class: 'hl-err', hidden: true }, t('health.badNumber'));
  const read = () => {
    const out = {};
    for (const k of Object.keys(fields)) {
      const raw = fields[k].value.trim();
      if (!raw) continue;
      let v = F.numIn(raw);
      if (!Number.isFinite(v)) return null;
      v = M.fromUnit(k, v, u);
      const [a, b] = range[k];
      if (v < a || v > b) return null;
      out[k] = Math.round(v * 100) / 100;
    }
    return Object.keys(out).length ? out : null;
  };
  const res = await dialog({
    title: t('health.body.enter'),
    content: h('div', { class: 'ou-dialog-body hl-form-dlg' }, Object.keys(fields).map((k) => field(t('health.body.' + k), h('div', { class: 'hl-ask-row' }, fields[k], h('span', { class: 'hl-ask-unit' }, unit[k])))), err),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, validate: () => { const ok = !!read(); err.hidden = ok; return ok; }, value: read }],
  });
  if (!res) return;
  const at = Date.now();
  H.mut((x) => {
    for (const [kind, value] of Object.entries(res)) {
      // the height only changes when it is different from the last one, so it isn't logged with every weigh-in
      if (kind === 'height' && lh && Math.abs(lh.value - value) < 0.3) continue;
      x.body.push({ id: M.newId('b'), at, kind, value });
    }
  });
  toast(t('health.body.saved'));
}
export function openBody(ctx, nav, arg) {
  let kind = 'weight';
  ctx.push({
    title: t('health.cards.body'), hero: false, className: 'hl-page hl-body-page',
    actions: [more(() => [{ label: t('health.units'), icon: 'sort', onClick: unitsDialog }])],
    render(body) {
      body.classList.add('hl-body');
      const chartBox = h('div');
      let chart;
      const makeChart = () => {
        chart = trendChart({ kind: 'avg', color: CARD_COLOR.body, points: () => M.points(H.D(), kind), value: (v) => F.bodyText(kind, v, H.units()) });
        chartBox.replaceChildren(chips(['weight', 'fat', 'muscle'].map((k) => ({ value: k, label: t('health.body.' + k) })), kind, (v) => { kind = v; makeChart(); }, { cls: 'hl-kind' }), chart);
      };
      makeChart();
      const top = h('div'), recs = h('div');
      const draw = () => {
        const d = H.D(), u = H.units(d), bmi = M.bmiNow(d);
        const tile = (k, v, sub) => h('div', { class: 'hl-tile', 'data-kind': k }, h('small', null, t('health.body.' + k)), h('b', null, v ?? '–'), sub ? h('small', null, sub) : null);
        const lat = (k) => M.latestBody(d, k);
        top.replaceChildren(section(null, [
          h('div', { class: 'hl-tiles' },
            tile('weight', lat('weight') && F.bodyText('weight', lat('weight').value, u), lat('weight') && F.whenText(lat('weight').at)),
            tile('bmi', bmi != null ? F.num(bmi, 1) : null, bmi != null ? t('health.bmi.' + (bmi < 18.5 ? 'under' : bmi < 25 ? 'normal' : bmi < 30 ? 'over' : 'obese')) : lat('weight') ? t('health.body.needHeight') : null),
            tile('fat', lat('fat') && F.pctText(lat('fat').value)),
            tile('muscle', lat('muscle') && F.bodyText('muscle', lat('muscle').value, u))),
          h('div', { class: 'hl-center' }, pillBtn(t('health.enter'), addBody, { primary: true, ic: 'plus', attrs: { 'data-add-body': '' } })),
        ]));
        const byAt = new Map();
        for (const e of [...d.body].sort((a, b) => b.at - a.at)) { if (!byAt.has(e.at)) byAt.set(e.at, []); byAt.get(e.at).push(e); }
        const rows = [...byAt.entries()].slice(0, 30);
        recs.replaceChildren(section(t('health.records'), rows.length ? rows.map(([at, es]) => h('div', { class: 'hl-rec' },
          h('span', { class: 'hl-rec-ico', style: { color: CARD_COLOR.body }, html: icon('hlScale', 18) }),
          h('span', { class: 'hl-rec-t' }, h('b', null, es.map((e) => `${t('health.body.' + e.kind)} ${F.bodyText(e.kind, e.value, u)}`).join(' · ')), h('small', null, F.whenText(at))),
          delBtn(() => H.mut((x) => { const ids = new Set(es.map((e) => e.id)); x.body = x.body.filter((y) => !ids.has(y.id)); })))) : empty('hlScale', t('health.body.emptyCard'))));
        chart.redraw();
      };
      body.append(top, section(t('health.trends'), chartBox), recs);
      draw();
      if (arg?.add) setTimeout(addBody, 350);
      return H.watch([M.KEY], draw);
    },
  });
}
