// Clock › Timer: Samsung's Hours / Minutes / Seconds wheels, the round Preset timers (tap to use, + to add, long press
// or right-click to edit or delete), a name and a sound for the timer, Start; then a card for each timer — several
// can run at once — with its ring, +1 min, Delete, Reset and Pause / Resume. Each running timer has its own Now Bar
// pill; the service worker rings it (js/bg/clock.js).
import { h, uid, clamp, onLongPress } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { dialog, iconBtn, menu } from '../core/ui.js';
import * as D from './data.js';
import { timerLeft } from './core.js';
import { durationWheels } from './wheel.js';
import { toneName, fmtHMS, fmtDurWords, soundPicker } from './kit.js';
import { stopSound } from './sound.js';

const labels = () => ({ h: t('clock.hours'), m: t('clock.minutes'), s: t('clock.seconds') });
/** 04:59 / 1:02:03 */
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** The sound of one timer (or the default timer sound): resolves the tone id ('' = the default) or null. */
async function pickSound(cur) {
  const p = D.prefs();
  const st = { sound: cur || p.timerSound, volume: p.timerVolume };
  const picker = soundPicker(st, () => {});
  const res = await dialog({ title: t('clock.timerSound'), className: 'clk-sound-dlg', content: picker, actions: [{ label: t('common.cancel'), value: null }, { label: t('common.done'), value: true, primary: true }] });
  picker.stop();
  if (!res) return null;
  if (st.volume !== p.timerVolume) D.setPref('timerVolume', st.volume);
  return st.sound === p.timerSound ? '' : st.sound;
}

/** Add / edit a preset timer. */
async function editPreset(p) {
  let ms = p?.duration || 5 * 60e3;
  const name = h('input', { class: 'ou-input clk-preset-name', placeholder: t('clock.presetName'), 'aria-label': t('clock.presetName'), value: p?.label || '', maxlength: 30 });
  const wheels = durationWheels(ms, (v) => (ms = v), labels());
  const res = await dialog({
    title: p ? t('clock.editPreset') : t('clock.addPreset'), className: 'clk-preset-dlg', content: h('div', { class: 'clk-preset-edit' }, wheels, name),
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: true, primary: true, validate: () => ms >= 1000 }],
  });
  if (!res) return;
  const item = { id: p?.id || uid(), label: name.value.trim(), duration: ms };
  const list = [...D.presets()];
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = { ...list[i], ...item };
  else list.push(item);
  D.setPresets(list);
}

export function timerView(ctx, tabs, { settings }) {
  let adding = !D.timers().length;
  let chosen = null; // the preset in use
  const draft = { duration: 5 * 60e3, label: '', sound: '' };
  const page = ctx.page({ title: t('clock.tab.timer'), hero: false, className: 'clk-page clk-timer-page' });
  page.el.appendChild(tabs);
  page.body.classList.add('clk-body', 'clk-timer-body');
  let raf, rows = [];

  const more = () => iconBtn('more', (e) => menu(e.currentTarget, [
    { label: t('clock.addPreset'), icon: 'plus', onClick: () => editPreset() },
    { label: t('common.settings'), icon: 'settings', onClick: settings },
  ], { align: 'end' }), t('common.more'));

  function picker() {
    const startBtn = h('button', { class: 'ou-btn primary clk-start' }, t('clock.start'));
    const upd = () => (startBtn.disabled = draft.duration < 1000);
    const presetsEl = h('div', { class: 'clk-presets', role: 'list' });
    const wheels = durationWheels(draft.duration, (ms) => { draft.duration = ms; chosen = null; drawPresets(); upd(); }, labels());
    const name = h('input', { class: 'clk-timer-name', placeholder: t('clock.timerName'), 'aria-label': t('clock.timerName'), value: draft.label, maxlength: 40, onInput: () => (draft.label = name.value) });
    const soundSub = h('span', { class: 'clk-timer-sound-v' });
    const soundBtn = h('button', { class: 'clk-timer-sound', onClick: async () => {
      const v = await pickSound(draft.sound);
      if (v !== null) draft.sound = v;
      drawSound();
    } }, h('span', { html: icon('music', 20) }), h('span', { class: 'clk-timer-sound-t' }, t('clock.timerSound')), soundSub);
    const drawSound = () => (soundSub.textContent = toneName(draft.sound || D.prefs().timerSound));
    function drawPresets() {
      presetsEl.replaceChildren(...D.presets().map((p) => {
        const b = h('button', { class: ['clk-preset', chosen === p.id && 'on'], role: 'listitem', title: p.label || fmtDurWords(p.duration), 'aria-pressed': String(chosen === p.id), onClick: () => {
          chosen = p.id;
          draft.duration = p.duration;
          draft.label = p.label || '';
          if (p.sound) draft.sound = p.sound;
          wheels.set(p.duration);
          name.value = draft.label;
          drawPresets();
          drawSound();
          upd();
        } }, h('span', { class: 'clk-preset-t', dir: 'ltr' }, fmtHMS(p.duration)), h('span', { class: 'clk-preset-n' }, p.label || fmtDurWords(p.duration)));
        const pmenu = (at) => menu(at, [
          { label: t('common.edit'), icon: 'edit', onClick: () => editPreset(p) },
          { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => D.setPresets(D.presets().filter((x) => x.id !== p.id)) },
        ]);
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); pmenu(e); });
        onLongPress(b, () => pmenu(b));
        return b;
      }), h('button', { class: 'clk-preset add', title: t('clock.addPreset'), 'aria-label': t('clock.addPreset'), onClick: () => editPreset(), html: icon('plus', 24) }));
    }
    startBtn.addEventListener('click', () => {
      D.startTimer(draft.duration, { label: name.value.trim(), sound: draft.sound });
      adding = false;
      chosen = null;
      draft.label = '';
      draw();
    });
    drawPresets();
    drawSound();
    upd();
    const el = h('div', { class: 'clk-picker' },
      wheels,
      h('div', { class: 'clk-presets-head' }, h('span', null, t('clock.presets'))),
      presetsEl,
      h('div', { class: 'ou-card clk-timer-opts' }, name, soundBtn),
      h('div', { class: 'clk-picker-actions' },
        D.timers().length ? h('button', { class: 'ou-btn tonal', onClick: () => { adding = false; draw(); } }, t('common.cancel')) : null,
        startBtn));
    el.redrawPresets = drawPresets;
    return el;
  }

  function card(x) {
    const C = 2 * Math.PI * 54;
    const svg = h('div', { class: 'clk-ring', html: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="trk"/><circle cx="60" cy="60" r="54" class="prg" stroke-dasharray="${C}" transform="rotate(-90 60 60)"/></svg>` });
    const time = h('div', { class: 'clk-ring-time', dir: 'ltr' });
    const name = h('div', { class: 'clk-ring-label' }, x.label || t('clock.timer'));
    const total = h('div', { class: 'clk-ring-total', dir: 'ltr' });
    // read the stored state: `x` is the timer as it was when the card was built (cards aren't rebuilt on pause)
    const playBtn = h('button', { class: 'clk-round primary', onClick: () => (D.timers().find((y) => y.id === x.id)?.running ? D.pauseTimer(x.id) : D.resumeTimer(x.id)) });
    const el = h('div', { class: 'clk-timer-card', dataset: { id: x.id } },
      h('div', { class: 'clk-ring-wrap' }, svg, h('div', { class: 'clk-ring-center' }, name, time, total,
        h('button', { class: 'clk-plus1', onClick: () => D.addMinute(x.id) }, t('clock.plus1')))),
      h('div', { class: 'clk-timer-actions' },
        h('button', { class: 'clk-round', title: t('common.delete'), 'aria-label': t('common.delete'), html: icon('trash', 20), onClick: () => D.deleteTimer(x.id) }),
        h('button', { class: 'clk-round', title: t('clock.reset'), 'aria-label': t('clock.reset'), html: icon('refresh', 20), onClick: () => D.resetTimer(x.id) }),
        playBtn));
    const circle = svg.querySelector('.prg');
    return {
      id: x.id,
      el,
      update(cur) {
        const left = timerLeft(cur);
        const txt = fmtCountdown(left);
        if (time.textContent !== txt) time.textContent = txt;
        const tot = fmtCountdown(cur.duration);
        if (total.textContent !== tot) total.textContent = tot;
        const p = cur.duration ? clamp(left / cur.duration, 0, 1) : 0;
        circle.style.strokeDashoffset = String(C * (1 - p));
        el.classList.toggle('paused', !cur.running);
        if (name.textContent !== (cur.label || t('clock.timer'))) name.textContent = cur.label || t('clock.timer');
        if (playBtn.dataset.running === String(cur.running)) return; // don't rebuild the icon every frame (it eats clicks)
        playBtn.dataset.running = String(cur.running);
        playBtn.innerHTML = icon(cur.running ? 'pause' : 'play', 22);
        playBtn.title = cur.running ? t('clock.pause') : t('clock.start');
        playBtn.setAttribute('aria-label', playBtn.title);
      },
    };
  }

  let pickerEl = null;
  function draw() {
    cancelAnimationFrame(raf);
    const list = D.timers();
    if (adding || !list.length) {
      page.setActions([more()]);
      rows = [];
      pickerEl = picker();
      page.body.replaceChildren(pickerEl);
      return;
    }
    pickerEl = null;
    page.setActions([iconBtn('plus', () => { adding = true; draw(); }, t('clock.addTimer')), more()]);
    rows = list.map(card);
    page.body.replaceChildren(h('div', { class: ['clk-timer-grid', rows.length === 1 && 'solo'] }, rows.map((r) => r.el)));
    const loop = () => {
      const cur = D.timers();
      rows.forEach((r) => {
        const x = cur.find((y) => y.id === r.id);
        if (x) r.update(x);
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  draw();
  let sig = D.timers().map((x) => x.id).join();
  const offs = [
    store.on('timers', () => {
      const s = D.timers().map((x) => x.id).join();
      if (s !== sig) {
        sig = s;
        if (!adding || !D.timers().length) draw();
      }
    }),
    store.on('timerPresets', () => pickerEl?.redrawPresets()),
  ];
  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((f) => f());
    stopSound();
  };
}
