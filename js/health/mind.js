// Samsung Health › Mindfulness: the mood log (five faces, then optional feelings, what it's about and a note), the
// mood page (this week's moods, a trend chart and the records) and Breathe (a guided session that saves mindful
// minutes from 30 seconds on).
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { toast, dialog, seg } from '../core/ui.js';
import { setting } from '../core/store.js';
import * as M from './model.js';
import * as H from './data.js';
import * as F from './format.js';
import { moodFace } from './art.js';
import { trendChart } from './charts.js';
import { section, pillBtn, chips, CARD_COLOR } from './kit.js';

/** The mood flow: pick a face (or start from `mood`), then feelings, areas and a note. Resolves with the entry. */
export async function logMoodFlow({ mood } = {}) {
  let cur = M.MOOD[mood] ? mood : null, labels = [], areas = [];
  const faces = h('div', { class: 'hl-faces big' });
  const feelBox = h('div', { class: 'hl-feel' });
  const drawFaces = () => faces.replaceChildren(...M.MOODS.map((m) => h('button', {
    class: ['hl-face-btn', cur === m.id && 'on'], 'data-mood': m.id, 'aria-pressed': String(cur === m.id), 'aria-label': F.moodName(m.id),
    onClick: () => { if (cur !== m.id) labels = []; cur = m.id; drawFaces(); drawFeel(); },
  }, h('span', { html: moodFace(m.id) }), h('small', null, F.moodName(m.id)))));
  const drawFeel = () => {
    feelBox.hidden = !cur;
    if (!cur) return;
    feelBox.replaceChildren(
      h('div', { class: 'hl-field-label' }, t('health.mood.describe')),
      chips(M.FEELINGS[cur].map((x) => ({ value: x, label: F.feelingName(x) })), labels, (v) => (labels = v), { multi: true, cls: 'hl-feel-chips' }),
      h('div', { class: 'hl-field-label' }, t('health.mood.impact')),
      chips(M.AREAS.map((x) => ({ value: x, label: F.areaName(x) })), areas, (v) => (areas = v), { multi: true, cls: 'hl-area-chips' }));
  };
  const note = h('textarea', { class: 'ou-input', rows: 2, maxlength: 300, placeholder: t('health.mood.notePh'), 'data-f': 'note' });
  const err = h('div', { class: 'hl-err', hidden: true }, t('health.mood.pick'));
  drawFaces();
  drawFeel();
  const res = await dialog({
    title: t('health.mood.question'), className: 'hl-mood-dlg',
    content: h('div', { class: 'ou-dialog-body hl-mood-flow' }, faces, feelBox, note, err),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), primary: true, validate: () => { err.hidden = !!cur; return !!cur; }, value: () => cur }],
  });
  if (!res) return null;
  const e = H.logMood(res, { labels, areas, note: note.value.trim() });
  toast(t('health.toast.mood', { mood: F.moodName(res) }));
  return e;
}

export function openMood(ctx) {
  ctx.push({
    title: t('health.cards.mood'), hero: false, className: 'hl-page hl-mood-page',
    render(body) {
      body.classList.add('hl-body');
      const chart = trendChart({ kind: 'mood', color: CARD_COLOR.mood, points: () => M.points(H.D(), 'mood'), value: (v) => F.moodName(M.moodOf(v).id) });
      const top = h('div'), recs = h('div');
      const draw = () => {
        const d = H.D(), week = d.mind.filter((e) => Date.now() - e.at < 7 * 864e5);
        const counts = Object.fromEntries(M.MOODS.map((m) => [m.id, 0]));
        for (const e of week) counts[M.moodOf(e.valence).id]++;
        const max = Math.max(1, ...Object.values(counts));
        top.replaceChildren(
          section(t('health.mood.question'), h('div', { class: 'hl-faces' }, M.MOODS.map((m) => h('button', { class: 'hl-face-btn', 'data-mood': m.id, 'aria-label': F.moodName(m.id), onClick: () => logMoodFlow({ mood: m.id }) },
            h('span', { html: moodFace(m.id) }), h('small', null, F.moodName(m.id)))))),
          section(t('health.mood.thisWeek'), week.length ? h('div', { class: 'hl-moodbars' }, [...M.MOODS].reverse().map((m) => h('div', { class: 'hl-moodbar' },
            h('span', { class: 'hl-moodbar-face', html: moodFace(m.id) }),
            h('span', { class: 'hl-moodbar-track' }, h('i', { style: { width: ((counts[m.id] / max) * 100).toFixed(1) + '%', background: m.color } })),
            h('b', null, F.num(counts[m.id]))))) : h('p', { class: 'hl-sub' }, t('health.mood.noneWeek'))));
        const list = [...d.mind].sort((a, b) => b.at - a.at).slice(0, 40);
        recs.replaceChildren(section(t('health.records'), list.length ? list.map((e) => {
          const m = M.moodOf(e.valence);
          return h('div', { class: 'hl-rec hl-mood-rec' },
            h('span', { class: 'hl-rec-face', html: moodFace(m.id) }),
            h('span', { class: 'hl-rec-t' },
              h('b', null, F.moodName(m.id)),
              e.labels.length || e.areas.length ? h('small', null, [...e.labels.map(F.feelingName), ...e.areas.map(F.areaName)].join(' · ')) : null,
              e.note ? h('small', { class: 'hl-rec-note' }, e.note) : null,
              h('small', null, F.whenText(e.at))),
            h('button', { class: 'ou-icon-btn hl-del', 'aria-label': t('common.delete'), html: icon('trash', 18), onClick: () => H.mut((x) => { x.mind = x.mind.filter((y) => y.id !== e.id); }) }));
        }) : h('p', { class: 'hl-sub' }, t('health.records.none'))));
        chart.redraw();
      };
      body.append(top, section(t('health.trends'), chart), recs);
      draw();
      return H.watch([M.KEY], draw);
    },
  });
}

// ——— Breathe ———
const IN = 4000, OUT = 6000; // six slow breaths a minute: in for 4 seconds, out for 6
export function openBreathe(ctx, nav, arg) {
  let stop = null;
  ctx.push({
    title: t('health.cards.breathe'), hero: false, className: 'hl-page hl-breathe-page',
    render(body) {
      body.classList.add('hl-body');
      let minutes = Math.min(5, Math.max(1, +H.prefs().breatheMin || 1));
      const orb = h('div', { class: 'hl-orb' }, Array.from({ length: 6 }, (_, i) => h('i', { style: { '--i': i } })));
      const text = h('div', { class: 'hl-br-text', 'aria-live': 'polite' }, t('health.breathe.intro'));
      const left = h('div', { class: 'hl-br-left' });
      const durSeg = seg([1, 2, 3, 5].map((n) => ({ value: n, label: t('health.dur.m', { m: F.num(n) }) })), minutes, (v) => { minutes = v; H.setPrefs((p) => ({ ...p, breatheMin: v })); });
      durSeg.classList.add('hl-br-seg');
      const startBtn = pillBtn(t('health.breathe.start'), () => run(), { primary: true, attrs: { 'data-br-start': '' } });
      const endBtn = pillBtn(t('health.breathe.end'), () => finish(true), { attrs: { 'data-br-end': '' } });
      endBtn.hidden = true;
      const stage = h('div', { class: 'hl-br-stage' }, orb, text, left, h('div', { class: 'hl-br-ctrls' }, durSeg, startBtn, endBtn));
      const hist = h('div');
      const chart = trendChart({ kind: 'sum', color: CARD_COLOR.breathe, points: () => M.points(H.D(), 'mindful'), value: (v) => F.durText(v) });
      let timer = 0, tick = 0, t0 = 0, total = 0, running = false;
      const still = () => setting('reduceMotion') || document.documentElement.dataset.motion === 'reduce';
      function phase(i) {
        if (!running) return;
        const el = Date.now() - t0;
        if (el >= total) return finish(false);
        const inhale = i % 2 === 0;
        stage.classList.toggle('in', inhale);
        stage.classList.toggle('out', !inhale);
        stage.style.setProperty('--ph', (inhale ? IN : OUT) + 'ms');
        text.textContent = inhale ? t('health.breathe.in') : t('health.breathe.out');
        timer = setTimeout(() => phase(i + 1), inhale ? IN : OUT);
      }
      const showLeft = () => { const s = Math.max(0, Math.ceil((total - (Date.now() - t0)) / 1000)); left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      function run() {
        if (running) return;
        running = true;
        total = minutes * 60000;
        stage.classList.add('running');
        stage.classList.remove('done');
        startBtn.hidden = true; durSeg.hidden = true; endBtn.hidden = false;
        text.textContent = t('health.breathe.ready');
        timer = setTimeout(() => { t0 = Date.now(); showLeft(); tick = setInterval(showLeft, 1000); phase(0); }, still() ? 800 : 2000);
      }
      function finish(early) {
        if (!running) return;
        running = false;
        clearTimeout(timer); clearInterval(tick);
        const ms = t0 ? Math.min(total, Date.now() - t0) : 0;
        stage.classList.remove('running', 'in', 'out');
        endBtn.hidden = true; startBtn.hidden = false; durSeg.hidden = false;
        left.textContent = '';
        t0 = 0;
        if (ms >= 30000) {
          const min = Math.round(ms / 6000) / 10;
          H.mut((d) => { d.mindful.push({ id: M.newId('mm'), at: Date.now(), min, src: 'breathe' }); });
          stage.classList.add('done');
          text.textContent = t('health.breathe.done', { time: F.durText(min) });
        } else text.textContent = early ? t('health.breathe.tooShort') : t('health.breathe.intro');
      }
      stop = () => { running = false; clearTimeout(timer); clearInterval(tick); };
      const draw = () => {
        const d = H.D(), list = [...d.mindful].sort((a, b) => b.at - a.at).slice(0, 20);
        hist.replaceChildren(section(t('health.records'), list.length ? list.map((e) => h('div', { class: 'hl-rec' },
          h('span', { class: 'hl-rec-ico', style: { color: CARD_COLOR.breathe }, html: icon('hlBreathe', 18) }),
          h('span', { class: 'hl-rec-t' }, h('b', null, F.durText(e.min)), h('small', null, F.whenText(e.at))))) : h('p', { class: 'hl-sub' }, t('health.records.none'))));
        chart.redraw();
      };
      body.append(section(null, stage, { cls: 'hl-br-sec' }), section(t('health.breathe.minutes'), chart), hist);
      draw();
      if (arg?.start) setTimeout(run, 300);
      const off = H.watch([M.KEY], draw);
      return () => { off(); stop?.(); };
    },
  });
}
