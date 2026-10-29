// Samsung's analog clock face (widgets, World clock): CSS-animated hands that sweep smoothly; sync() re-aims them
// (after the tab wakes up, or for another time zone). The face turns dark between 6 PM and 6 AM in its zone.
import { h } from '../core/util.js';
import { wallTime } from './zones.js';

export function analogFace({ tz = null, numbers = true, cls = '' } = {}) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = i % 3 ? 43 : 41, r2 = 46;
    return `<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * r2}" y2="${50 - Math.cos(a) * r2}" class="${i % 3 ? 'tk' : 'tk major'}"/>`;
  }).join('');
  const nums = numbers ? [12, 3, 6, 9].map((n, i) => {
    const a = (i * 90 * Math.PI) / 180;
    return `<text x="${50 + Math.sin(a) * 33}" y="${50 - Math.cos(a) * 33 + 4.2}" text-anchor="middle">${n}</text>`;
  }).join('') : '';
  const hh = h('i', { class: 'clk-hand hh' });
  const mm = h('i', { class: 'clk-hand mm' });
  const ss = h('i', { class: 'clk-hand ss' });
  const el = h('div', { class: ['clk-face', cls], html: `<svg viewBox="0 0 100 100" aria-hidden="true">${ticks}${nums}</svg>` }, hh, mm, ss, h('i', { class: 'clk-pin' }));
  const sync = () => {
    const now = tz ? wallTime(tz) : new Date();
    const secs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    hh.style.animationDelay = `-${secs % 43200}s`;
    mm.style.animationDelay = `-${secs % 3600}s`;
    ss.style.animationDelay = `-${secs % 60}s`;
    const hr = now.getHours();
    el.classList.toggle('night', hr < 6 || hr >= 18);
  };
  sync();
  el.sync = sync;
  return el;
}
