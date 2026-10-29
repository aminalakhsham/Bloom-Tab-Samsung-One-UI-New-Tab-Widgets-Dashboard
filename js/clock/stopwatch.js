// Clock › Stopwatch: Samsung's big digits (or an analog dial with a 30-minute sub-dial — the toolbar button or a tap
// on the face switches), Lap / Stop then Reset / Resume, and the laps table (Lap, Lap times, Overall time) with the
// fastest and slowest laps marked. ⋮ › Copy laps. Runs on in the background (store key `stopwatch`, Now Bar pill).
import { h, pad2 } from '../core/util.js';
import { t } from '../core/i18n.js';
import { store } from '../core/store.js';
import { iconBtn, menu, toast } from '../core/ui.js';
import * as D from './data.js';

/** 00:05.42, 1:02:03.45 */
export function fmtSw(ms, cs = true) {
  ms = Math.max(0, ms);
  const hh = Math.floor(ms / 3600e3), mm = Math.floor((ms % 3600e3) / 60e3), ss = Math.floor((ms % 60e3) / 1000), c = Math.floor((ms % 1000) / 10);
  return `${hh ? hh + ':' : ''}${pad2(mm)}:${pad2(ss)}${cs ? '.' + pad2(c) : ''}`;
}

function dialSvg() {
  let s = '';
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180, r1 = i % 5 ? 91 : 86;
    s += `<line x1="${(100 + Math.sin(a) * r1).toFixed(2)}" y1="${(100 - Math.cos(a) * r1).toFixed(2)}" x2="${(100 + Math.sin(a) * 95).toFixed(2)}" y2="${(100 - Math.cos(a) * 95).toFixed(2)}" class="${i % 5 ? 'tk' : 'tk major'}"/>`;
  }
  for (let i = 1; i <= 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    s += `<text x="${(100 + Math.sin(a) * 74).toFixed(2)}" y="${(100 - Math.cos(a) * 74 + 4).toFixed(2)}" text-anchor="middle">${i * 5}</text>`;
  }
  // the 30-minute sub-dial
  for (let i = 0; i < 30; i++) {
    const a = (i * 12 * Math.PI) / 180, r1 = i % 5 ? 19 : 16.5;
    s += `<line x1="${(100 + Math.sin(a) * r1).toFixed(2)}" y1="${(62 - Math.cos(a) * r1).toFixed(2)}" x2="${(100 + Math.sin(a) * 21).toFixed(2)}" y2="${(62 - Math.cos(a) * 21).toFixed(2)}" class="${i % 5 ? 'tk sm' : 'tk sm major'}"/>`;
  }
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="62" r="23" class="sub"/>${s}</svg>`;
}

export function stopwatchView(ctx, tabs, { settings }) {
  let view = D.prefs().swView === 'analog' ? 'analog' : 'digital';
  const page = ctx.page({ title: t('clock.tab.stopwatch'), hero: false, className: 'clk-page clk-sw-page' });
  page.el.appendChild(tabs);
  page.body.classList.add('clk-body', 'clk-sw-body');
  const digits = h('div', { class: 'clk-sw-digits', dir: 'ltr', 'aria-live': 'off' });
  const secHand = h('i', { class: 'clk-sw-hand' });
  const minHand = h('i', { class: 'clk-sw-mhand' });
  const dial = h('div', { class: 'clk-sw-dial', html: dialSvg() }, minHand, secHand, h('i', { class: 'clk-sw-pin' }));
  const face = h('button', { class: 'clk-sw-face', title: t('clock.switchView'), 'aria-label': t('clock.switchView'), onClick: () => setView(view === 'analog' ? 'digital' : 'analog') }, dial, digits);
  const laps = h('div', { class: 'clk-laps', role: 'table', 'aria-label': t('clock.laps') });
  const left = h('button', { class: 'ou-btn tonal clk-sw-btn' });
  const right = h('button', { class: 'ou-btn primary clk-sw-btn' });
  left.addEventListener('click', () => (D.stopwatch().running ? D.swLap() : D.swReset()));
  right.addEventListener('click', () => (D.stopwatch().running ? D.swStop() : D.swStart()));
  page.body.append(face, laps, h('div', { class: 'clk-sw-actions' }, left, right));

  const viewBtn = () => {
    const b = iconBtn(view === 'analog' ? 'clkDigital' : 'clock', () => setView(view === 'analog' ? 'digital' : 'analog'), view === 'analog' ? t('clock.digital') : t('clock.analog'));
    b.classList.add('clk-viewbtn');
    return b;
  };
  const setActions = () => page.setActions([viewBtn(), iconBtn('more', (e) => menu(e.currentTarget, [
    { label: t('clock.copyLaps'), icon: 'copy', disabled: !(D.stopwatch().laps || []).length, onClick: copyLaps },
    { label: t('common.settings'), icon: 'settings', onClick: settings },
  ], { align: 'end' }), t('common.more'))]);
  function setView(v) {
    view = v;
    D.setPref('swView', v);
    page.body.classList.toggle('analog', v === 'analog');
    setActions();
  }
  async function copyLaps() {
    const L = D.stopwatch().laps || [];
    const text = L.map((v, i) => `${t('clock.lap')} ${pad2(i + 1)}\t${fmtSw(v - (L[i - 1] || 0))}\t${fmtSw(v)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(t('clock.copied'));
    } catch {}
  }

  const drawState = () => {
    const s = D.stopwatch();
    left.textContent = s.running ? t('clock.lap') : t('clock.reset');
    left.disabled = !s.running && !s.elapsed;
    right.textContent = s.running ? t('clock.stop') : s.elapsed ? t('clock.resume') : t('clock.start');
    right.classList.toggle('stop', s.running);
    const L = s.laps || [];
    page.body.classList.toggle('has-laps', L.length > 0);
    if (!L.length) return laps.replaceChildren();
    const splits = L.map((v, i) => v - (L[i - 1] || 0));
    const max = Math.max(...splits), min = Math.min(...splits);
    const mark = L.length >= 2 && max !== min;
    laps.replaceChildren(
      h('div', { class: 'clk-lap head', role: 'row' }, h('span', { role: 'columnheader' }, t('clock.lapCol')), h('span', { role: 'columnheader' }, t('clock.lapTime')), h('span', { role: 'columnheader' }, t('clock.total'))),
      ...L.map((v, i) => ({ v, i, sp: splits[i] })).reverse().map(({ v, i, sp }) => {
        const slow = mark && sp === max, fast = mark && sp === min;
        return h('div', { class: ['clk-lap', slow && 'slow', fast && 'fast'], role: 'row' },
          h('span', { role: 'cell' }, pad2(i + 1)),
          h('span', { role: 'cell', dir: 'ltr' }, fmtSw(sp), fast || slow ? h('em', { class: 'clk-lap-tag' }, t(fast ? 'clock.fastest' : 'clock.slowest')) : null),
          h('span', { role: 'cell', dir: 'ltr' }, fmtSw(v)));
      }));
    setActions();
  };
  let raf;
  const tick = () => {
    const ms = D.swElapsed();
    const txt = fmtSw(ms);
    if (digits.textContent !== txt) digits.textContent = txt;
    if (view === 'analog') {
      secHand.style.transform = `rotate(${((ms % 60000) / 60000) * 360}deg)`;
      minHand.style.transform = `rotate(${((ms % 1800000) / 1800000) * 360}deg)`;
    }
    raf = requestAnimationFrame(tick);
  };
  setView(view);
  drawState();
  tick();
  const off = store.on('stopwatch', drawState);
  return () => {
    cancelAnimationFrame(raf);
    off();
  };
}
