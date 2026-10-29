// Building blocks shared by the Clock tabs: the bottom tabs, One UI radio lists, the sound picker (with previews and
// volume), the selection-mode bar, duration text and the small Settings page.
import { h, pad2 } from '../core/util.js';
import { icon } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { slider, switchRow, list, subheader } from '../core/ui.js';
import { TONES } from './tones.js';
import { playTone, stopSound, setVolume } from './sound.js';
import * as D from './data.js';
import { pl } from './zones.js';

export const TABS = [
  { id: 'alarm', icon: 'alarm' },
  { id: 'world', icon: 'globe' },
  { id: 'stopwatch', icon: 'stopwatch' },
  { id: 'timer', icon: 'timer' },
];

export function tabsBar(active, onPick) {
  return h('nav', { class: 'ou-tabs clk-tabs', role: 'tablist' }, TABS.map((tb) =>
    h('button', { class: ['ou-tab', tb.id === active && 'active'], role: 'tab', 'aria-selected': String(tb.id === active), onClick: () => tb.id !== active && onPick(tb.id) },
      h('span', { html: icon(tb.icon, 20) }), h('span', null, t('clock.tab.' + tb.id)))));
}

export const toneName = (id) => (id === 'silent' ? t('clock.silent') : TONES.includes(id) ? t('clock.tone.' + id) : t('clock.tone.flower'));

/** "00:05:00" like Samsung's preset timers. */
export function fmtHMS(ms) {
  const s = Math.round(ms / 1000);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}
/** "5 minutes" / "1 hour 30 minutes" / "45 seconds". */
export function fmtDurWords(ms) {
  const s = Math.round(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const parts = [];
  if (hh) parts.push(pl('clock.u.hour', hh));
  if (mm) parts.push(pl('clock.u.min', mm));
  if (ss || !parts.length) parts.push(pl('clock.u.sec', ss));
  return parts.join(t('clock.and'));
}

/** One UI radio list: options [{ value, label, sub }]; onPick(value). */
export function radioList(options, value, onPick, name = 'clk-r' + Math.random().toString(36).slice(2, 7)) {
  const box = h('div', { class: 'ou-card ou-list clk-radios', role: 'radiogroup' });
  const draw = () => box.replaceChildren(...options.map((o) => h('label', { class: ['ou-radio-row', 'clk-radio', o.value === value && 'on'], dataset: { v: String(o.value) } },
    h('input', { type: 'radio', name, checked: o.value === value, onChange: () => { value = o.value; draw(); onPick(o.value); } }),
    h('span', { class: 'ou-radio' }),
    h('span', { class: 'ou-radio-text' }, h('span', null, o.label), o.sub ? h('small', null, o.sub) : null))));
  draw();
  box.set = (v) => { value = v; draw(); };
  return box;
}

/**
 * The sound picker: volume slider, "Gradually increase volume" (alarms), then every tone; tapping one plays it.
 * st = { sound, volume, gradual? } (changed in place); onChange() after each change. Returns the element; call
 * el.stop() when leaving it.
 */
export function soundPicker(st, onChange, { gradual = false } = {}) {
  const vol = slider({ min: 0, max: 100, value: Math.round((st.volume ?? 0.7) * 100), icon: 'volume', label: t('clock.volume'),
    onInput: (v) => { st.volume = v / 100; setVolume(st.volume); },
    onChange: (v) => { st.volume = v / 100; playTone(st.sound, st.volume, 2500); onChange(); } });
  vol.classList.add('clk-vol');
  const tones = radioList(TONES.map((id) => ({ value: id, label: toneName(id) })), st.sound, (v) => {
    st.sound = v;
    playTone(v, st.volume ?? 0.7);
    onChange();
  });
  tones.classList.add('clk-tones');
  const el = h('div', { class: 'clk-sound' },
    h('div', { class: 'ou-card clk-vol-card' }, h('div', { class: 'clk-vol-label' }, t('clock.volume')), vol),
    gradual ? list(switchRow({ title: t('clock.gradual'), sub: t('clock.gradualSub'), checked: !!st.gradual, onChange: (v) => { st.gradual = v; onChange(); } })) : null,
    subheader(t('clock.ringtones')),
    tones);
  el.stop = stopSound;
  return el;
}

/** Selection mode's bottom bar (Turn on / Turn off / Delete …): [{ icon, label, onClick, danger }]. */
export function selBar(actions) {
  return h('div', { class: 'clk-selbar', role: 'toolbar' }, actions.map((a) =>
    h('button', { class: ['clk-selbtn', a.danger && 'danger'], disabled: a.disabled, onClick: a.onClick }, h('span', { html: icon(a.icon, 22) }), h('span', null, a.label))));
}

/** ⋮ › Settings: the Timer sound and its volume (alarms each have their own). */
export function openSettings(ctx) {
  ctx.push({
    title: t('common.settings'),
    hero: false,
    className: 'clk-settings',
    render(body) {
      const p = D.prefs();
      const st = { sound: p.timerSound, volume: p.timerVolume };
      const picker = soundPicker(st, () => {
        D.setPref('timerSound', st.sound);
        D.setPref('timerVolume', st.volume);
      });
      body.append(subheader(t('clock.timerSound')), picker,
        h('p', { class: 'clk-note' }, t('clock.settingsNote')));
      return () => picker.stop();
    },
  });
}
