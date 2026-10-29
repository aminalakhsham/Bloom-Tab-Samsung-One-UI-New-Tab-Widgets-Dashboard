// Samsung Health › Home: rounded cards for every tracker (Daily activity first), each with its own quick action, and
// "Manage items" to show, hide and reorder them (healthPrefs.cards).
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { menu, iconBtn, toast, sw } from '../core/ui.js';
import * as M from './model.js';
import * as R from './rings.js';
import * as H from './data.js';
import * as F from './format.js';
import { ringsSVG, moodFace } from './art.js';
import { homeCard, pillBtn, roundBtn, bigVal, CARD_COLOR, ICON, durBig, cycleLine } from './kit.js';
import { logMoodFlow } from './mind.js';
import { togglePeriod } from './cycle.js';


// ——— the cards ———
const CARDS = {
  activity(nav) {
    const r = H.todayRings();
    return h('div', { class: 'hl-act' },
      h('span', { class: 'hl-act-rings', html: ringsSVG(r, { label: R.RINGS.map((k) => `${F.ringName(k)} ${F.ringValue(k, r[k])}`).join(', ') }) }),
      h('div', { class: 'hl-act-rows' }, R.RINGS.map((k) => h('div', { class: 'hl-act-row', 'data-ring': k },
        h('span', { class: 'hl-act-name' }, h('i', { style: { background: R.COLORS[k].c } }), F.ringName(k)),
        h('span', { class: 'hl-act-val' }, h('b', { style: { color: R.COLORS[k].c } }, F.num(Math.floor(r[k].v + 1e-6))), h('small', null, t('health.rg.' + k, { g: F.num(r[k].goal) })))))));
  },
  meds(nav) {
    const d = H.D(), lg = H.logs(d), today = M.dayKey();
    if (!M.activeMeds(d).length) return h('div', { class: 'hl-cardrow' }, h('p', { class: 'hl-card-q' }, t('health.meds.emptyCard')), pillBtn(t('health.meds.add'), () => nav.open('medNew'), { attrs: { 'data-add-med': '' } }));
    const doses = M.dayDoses(d, lg, today), next = M.nextSlot(d, lg), taken = doses.filter((x) => x.entry?.status === 'taken').length;
    // doses more than 2 hours late that nobody logged: say so instead of "all taken"
    const missed = doses.filter((x) => !x.entry && M.slotTime(x.slot) < Date.now());
    const left = next
      ? h('div', null, h('div', { class: ['hl-meds-time', next.due && 'due'] }, F.timeOf(next.t)), h('div', { class: 'hl-sub' }, next.due ? t('health.now.due') : F.tn('health.meds.nextCount', next.doses.length)))
      : missed.length
        ? h('div', null, h('div', { class: 'hl-meds-done missed' }, h('span', { html: icon('info', 22) }), F.tn('health.meds.notLogged', missed.length)))
        : h('div', null, h('div', { class: 'hl-meds-done' }, h('span', { html: icon('checkCircle', 22) }), doses.length ? t('health.meds.allDone') : t('health.meds.nothingToday')));
    const now = Date.now();
    return h('div', null,
      h('div', { class: 'hl-cardrow' }, left, next ? pillBtn(next.doses.length > 1 ? t('health.takeAll') : t('health.take'), () => {
        H.logSlot(next.slot, 'taken');
        toast(t('health.toast.slotTaken', { time: F.timeOf(next.t) }));
      }, { primary: next.due, attrs: { 'data-take-slot': next.slot } }) : null),
      doses.length ? h('div', { class: 'hl-dosebar' },
        h('span', { class: 'hl-dots' }, doses.slice(0, 16).map((x) => h('i', { class: x.entry?.status || (M.slotTime(x.slot) < now - M.DUE_WINDOW ? 'missed' : '') }))),
        h('span', { class: 'hl-sub' }, t('health.meds.progress', { n: F.num(taken), total: F.num(doses.length) }))) : null);
  },
  water(nav) {
    const th = H.todayHealth(), u = H.units(), p = Math.min(1, th.water.ml / th.water.goalMl);
    return h('div', null,
      h('div', { class: 'hl-cardrow' },
        h('div', null, bigVal(F.waterNum(th.water.ml, u), F.unitName(u.water)), h('div', { class: 'hl-sub' }, t('health.water.ofGoal', { goal: F.waterText(th.water.goalMl, u) }))),
        h('div', { class: 'hl-rounds' },
          roundBtn('minus', () => H.undoWater(), t('health.water.remove'), 'minus'),
          roundBtn('plus', () => H.logWater(th.water.cup), t('health.water.add'), 'plus'))),
      h('div', { class: 'hl-progress', style: { '--c': CARD_COLOR.water } }, h('i', { style: { width: (p * 100).toFixed(1) + '%' } })));
  },
  sleep(nav) {
    const d = H.D(), last = M.lastSleep(d);
    if (!last || Date.now() - last.end > 36 * 3600e3) return h('div', { class: 'hl-cardrow' }, h('p', { class: 'hl-card-q' }, t('health.sleep.emptyCard')), pillBtn(t('health.record'), () => nav.open('sleep', { add: true })));
    return h('div', { class: 'hl-cardrow' },
      h('div', null, durBig(M.sleepMin(last)), h('div', { class: 'hl-sub' }, `${F.clock(last.start)} – ${F.clock(last.end)}`)),
      h('span', { class: 'hl-card-art', style: { color: CARD_COLOR.sleep }, html: icon('moon', 30) }));
  },
  mood(nav) {
    const d = H.D(), k = M.dayKey(), last = d.mind.filter((e) => M.dayKey(e.at) === k).sort((a, b) => b.at - a.at)[0];
    const cur = last ? M.moodOf(last.valence).id : null;
    return h('div', null,
      h('p', { class: 'hl-card-q' }, last ? t('health.mood.loggedAt', { mood: F.moodName(cur), time: F.clock(last.at) }) : t('health.mood.question')),
      h('div', { class: 'hl-faces' }, M.MOODS.map((m) => h('button', {
        class: ['hl-face-btn', cur === m.id && 'on'], 'data-mood': m.id, title: F.moodName(m.id), 'aria-label': F.moodName(m.id),
        onClick: (e) => { e.stopPropagation(); logMoodFlow({ mood: m.id }); },
      }, h('span', { html: moodFace(m.id) }), h('small', null, F.moodName(m.id))))));
  },
  body(nav) {
    const d = H.D(), u = H.units(d), w = M.latestBody(d, 'weight'), fat = M.latestBody(d, 'fat'), bmi = M.bmiNow(d);
    if (!w) return h('div', { class: 'hl-cardrow' }, h('p', { class: 'hl-card-q' }, t('health.body.emptyCard')), pillBtn(t('health.enter'), () => nav.open('body', { add: true })));
    return h('div', { class: 'hl-cardrow' },
      h('div', null, bigVal(F.num(M.toUnit('weight', w.value, u), 1), F.unitName(u.weight)), h('div', { class: 'hl-sub' }, F.whenText(w.at))),
      h('div', { class: 'hl-kv' },
        bmi ? h('span', null, h('small', null, t('health.body.bmi')), h('b', null, F.num(bmi, 1))) : null,
        fat ? h('span', null, h('small', null, t('health.body.fat')), h('b', null, F.pctText(fat.value))) : null));
  },
  cycle(nav) {
    const d = H.D(), c = d.cycle, k = M.dayKey(), st = M.cycleStatus(c, k);
    if (!st) return h('div', { class: 'hl-cardrow' }, h('p', { class: 'hl-card-q' }, t('health.cycle.emptyCard')), pillBtn(t('health.cycle.logPeriod'), () => { togglePeriod(k, true); toast(t('health.cycle.logged')); }, { attrs: { 'data-log-period': '' } }));
    const pred = M.predict(c, k);
    const strip = h('div', { class: 'hl-cy-strip' }, Array.from({ length: 7 }, (_, i) => {
      const dk = M.addDays(k, i - 3);
      return h('span', { class: ['hl-cy-sd', M.cycleDayKind(c, pred, dk, k), dk === k && 'today'] }, h('small', null, F.dateText(dk, { weekday: 'narrow' })), h('i', null, F.dateText(dk, { day: 'numeric' })));
    }));
    const isPeriod = st.kind === 'period';
    return h('div', null,
      h('div', { class: 'hl-cardrow' }, h('div', { class: 'hl-cy-status' }, cycleLine(st)), pillBtn(isPeriod ? t('health.cycle.edit') : t('health.cycle.logPeriod'), () => (isPeriod ? nav.open('cycle') : (togglePeriod(k, true), toast(t('health.cycle.logged')))), { attrs: { 'data-log-period': '' } })),
      strip);
  },
  breathe(nav) {
    const d = H.D(), k = M.dayKey(), min = d.mindful.filter((e) => M.dayKey(e.at) === k).reduce((s, e) => s + e.min, 0);
    return h('div', { class: 'hl-cardrow' },
      h('div', null, h('p', { class: 'hl-card-q' }, t('health.breathe.cardQ')), h('div', { class: 'hl-sub' }, min ? t('health.breathe.today', { time: F.durText(min) }) : t('health.breathe.oneMin'))),
      pillBtn(t('health.breathe.start'), () => nav.open('breathe', { start: true }), { primary: true, attrs: { 'data-breathe': '' } }));
  },
};
export function homeView(ctx, nav, tabs) {
  ctx.page({
    title: t('health.app'), hero: false, className: 'hl-page hl-home-page',
    actions: [iconBtn('more', (e) => menu(e.currentTarget, [
      { label: t('health.manage'), icon: 'edit', onClick: () => nav.open('manage') },
      { label: t('common.settings'), icon: 'settings', onClick: () => nav.tab('me') },
    ], { align: 'end' }), t('common.more'))],
    render(body, page) {
      page.el.appendChild(tabs);
      body.classList.add('hl-body');
      const grid = h('div', { class: 'hl-home' });
      const draw = () => {
        const p = H.prefs();
        grid.replaceChildren(...M.cardsOf(p).filter((c) => c.on).map((c) => {
          let inner;
          try { inner = CARDS[c.id](nav); } catch (e) { console.error('health card', c.id, e); inner = h('div', { class: 'hl-sub' }, String(e.message || e)); }
          const el = homeCard(c.id, { title: t('health.cards.' + c.id), onOpen: () => nav.open(c.id), body: inner });
          el.style.setProperty('--card', CARD_COLOR[c.id]);
          return el;
        }));
      };
      body.append(grid, h('div', { class: 'hl-manage-wrap' }, h('button', { class: 'hl-manage', onClick: () => nav.open('manage') }, t('health.manage'))),
        h('p', { class: 'hl-privacy' }, h('span', { html: icon('lock', 14) }), t('health.privacy')));
      draw();
      const offs = [H.watch([...H.DATA_KEYS, ...H.RING_KEYS], draw)];
      const tick = setInterval(draw, 60e3);
      return () => { offs.forEach((f) => f()); clearInterval(tick); };
    },
  });
}

// ——— Manage items ———
export function openManage(ctx) {
  ctx.push({
    title: t('health.manage'), hero: false, className: 'hl-page',
    render(body) {
      body.classList.add('hl-body');
      const listEl = h('div', { class: 'ou-card ou-list hl-manage-list' });
      const save = (cards) => H.setPrefs((p) => ({ ...p, cards: { order: cards.map((c) => c.id), hidden: cards.filter((c) => !c.on).map((c) => c.id) } }));
      let cards = M.cardsOf(H.prefs());
      const move = (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= cards.length) return;
        [cards[i], cards[j]] = [cards[j], cards[i]];
        save(cards);
        draw(cards[j].id);
      };
      const draw = (focusId) => {
        listEl.replaceChildren(...cards.map((c, i) => {
          const handle = h('button', {
            class: 'hl-drag', 'aria-label': t('health.reorder'), title: t('health.reorder'), html: icon('sort', 20), 'data-id': c.id,
            onKeydown: (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); } else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); } },
          });
          dragHandle(handle, i);
          const toggle = sw(c.on, (v) => { c.on = v; save(cards); }, { label: t('health.cards.' + c.id) });
          return h('div', { class: 'ou-row hl-manage-row', 'data-card': c.id },
            handle,
            h('span', { class: 'ou-row-ico', style: { background: CARD_COLOR[c.id], color: '#fff' }, html: icon(ICON[c.id], 20) }),
            h('span', { class: 'ou-row-text' }, h('span', { class: 'ou-row-title' }, t('health.cards.' + c.id))),
            toggle);
        }));
        if (focusId) listEl.querySelector(`.hl-drag[data-id="${focusId}"]`)?.focus();
      };
      // drag a row by its handle: it follows the pointer and the list reorders when it passes a neighbour's middle
      function dragHandle(handle, i) {
        handle.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          handle.setPointerCapture(e.pointerId);
          const rowEl = handle.closest('.hl-manage-row');
          const rows = [...listEl.children], rects = rows.map((r) => r.getBoundingClientRect());
          const y0 = e.clientY;
          let to = i;
          rowEl.classList.add('dragging');
          const mv = (ev) => {
            const dy = ev.clientY - y0;
            rowEl.style.transform = `translateY(${dy}px)`;
            const mid = rects[i].top + rects[i].height / 2 + dy;
            to = rects.findIndex((r) => mid < r.bottom);
            if (to < 0) to = rects.length - 1;
            rows.forEach((r, j) => { if (j === i) return; const shift = i < to && j > i && j <= to ? -rects[i].height : i > to && j < i && j >= to ? rects[i].height : 0; r.style.transform = shift ? `translateY(${shift}px)` : ''; });
          };
          const up = () => {
            handle.removeEventListener('pointermove', mv);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
            if (to !== i) { const [c] = cards.splice(i, 1); cards.splice(to, 0, c); save(cards); }
            draw();
          };
          handle.addEventListener('pointermove', mv);
          handle.addEventListener('pointerup', up);
          handle.addEventListener('pointercancel', up);
        });
      }
      body.append(h('p', { class: 'hl-note' }, t('health.manageNote')), listEl);
      draw();
    },
  });
}
