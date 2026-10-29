// One UI's scroll-wheel number picker (alarm time, timer): five rows with the chosen value big in the middle.
// Mouse wheel, drag, ↑/↓, Page Up/Down and typing digits all work; it's a spinbutton for screen readers.
import { h, pad2, clamp } from '../core/util.js';

export function wheel({ min, max, value, loop = true, fmt = pad2, onChange, label = '' }) {
  const n = max - min + 1;
  const norm = (v) => (loop ? ((((v - min) % n) + n) % n) + min : clamp(v, min, max));
  const list = h('div', { class: 'clk-wheel-list' });
  const el = h('div', { class: 'clk-wheel', tabindex: 0, role: 'spinbutton', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, list);
  const draw = (dir = 0) => {
    list.replaceChildren(...[-2, -1, 0, 1, 2].map((o) => {
      const v = loop ? norm(value + o) : value + o;
      const ok = v >= min && v <= max;
      return h('div', { class: ['clk-wheel-item', o === 0 && 'cur', Math.abs(o) === 2 && 'far'], onClick: ok && o ? () => set(value + o) : null }, ok ? fmt(v) : '');
    }));
    el.setAttribute('aria-valuenow', value);
    el.setAttribute('aria-valuetext', fmt(value));
    if (dir) {
      list.classList.remove('up', 'down');
      void list.offsetWidth;
      list.classList.add(dir > 0 ? 'up' : 'down');
    }
  };
  const set = (v, fire = true) => {
    const nv = norm(v);
    if (nv === value) return;
    const dir = Math.sign(v - value);
    value = nv;
    draw(dir);
    if (fire) onChange?.(value);
  };
  let acc = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    acc += e.deltaY;
    while (Math.abs(acc) >= 40) {
      const s = Math.sign(acc);
      set(value + s);
      acc -= s * 40;
    }
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    let y0 = e.clientY, moved = false;
    const move = (ev) => {
      const steps = Math.trunc((y0 - ev.clientY) / 30);
      if (steps) {
        moved = true;
        y0 -= steps * 30;
        set(value + steps);
      }
    };
    const up = (ev) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (moved) ev.preventDefault();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  let typed = '', typedAt = 0;
  el.addEventListener('keydown', (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (step) {
      e.preventDefault();
      set(value + step);
    } else if (/^\d$/.test(e.key)) {
      typed = Date.now() - typedAt < 1200 ? typed + e.key : e.key;
      typedAt = Date.now();
      const v = Number(typed);
      if (v >= min && v <= max) set(v);
      else typed = e.key;
    }
  });
  draw();
  el.get = () => value;
  el.set = (v) => {
    value = norm(v);
    draw();
  };
  return el;
}

/** Hours / minutes (/ seconds) wheels for a duration; onChange(ms). */
export function durationWheels(ms, onChange, labels) {
  let hh = Math.floor(ms / 3600e3), mm = Math.floor((ms % 3600e3) / 60e3), ss = Math.floor((ms % 60e3) / 1000);
  const fire = () => onChange?.((hh * 3600 + mm * 60 + ss) * 1000);
  const hw = wheel({ min: 0, max: 99, value: hh, onChange: (v) => { hh = v; fire(); }, label: labels.h });
  const mw = wheel({ min: 0, max: 59, value: mm, onChange: (v) => { mm = v; fire(); }, label: labels.m });
  const sw = wheel({ min: 0, max: 59, value: ss, onChange: (v) => { ss = v; fire(); }, label: labels.s });
  const el = h('div', { class: 'clk-dur' },
    h('div', { class: 'clk-wheel-labels', dir: 'ltr' }, h('span', null, labels.h), h('span'), h('span', null, labels.m), h('span'), h('span', null, labels.s)),
    h('div', { class: 'clk-wheels big', dir: 'ltr' }, hw, h('span', { class: 'clk-colon' }, ':'), mw, h('span', { class: 'clk-colon' }, ':'), sw));
  el.set = (v) => {
    hh = Math.floor(v / 3600e3); mm = Math.floor((v % 3600e3) / 60e3); ss = Math.floor((v % 60e3) / 1000);
    hw.set(hh); mw.set(mm); sw.set(ss);
  };
  el.get = () => (hh * 3600 + mm * 60 + ss) * 1000;
  return el;
}
