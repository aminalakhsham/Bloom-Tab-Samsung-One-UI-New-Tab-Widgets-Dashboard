// Small helpers shared by the games: numbers and times in the UI language, a pausable clock, swipes, a confetti burst
// and a soft sound. Seeded randomness and days come from ./rand.js (pure, so the node tests can use it too).
import { locale } from '../core/i18n.js';
export { rng, shuffle, randInt, newSeed, dateKey, parseDateKey, dailySeed } from './rand.js';

export const reduceMotion = () => document.documentElement.dataset.motion === 'reduce';

/** A number in the UI language (One UI keeps Latin digits in Arabic, so this mostly adds grouping). */
export const num = (n, opts) => new Intl.NumberFormat(locale(), opts).format(n);
/** Keeps a run of numbers and signs ("+3", "2/4") in one piece inside right-to-left text. */
export const ltr = (s) => '⁦' + s + '⁩';

/** "4:07" or "1:02:45". */
export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`;
}

/** A stopwatch that only runs while a game is being played: stop() when it is covered or hidden, start() after. */
export class Clock {
  constructor(ms = 0) { this.base = ms || 0; this.t0 = null; }
  start() { if (this.t0 == null) this.t0 = performance.now(); return this; }
  stop() { if (this.t0 != null) { this.base += performance.now() - this.t0; this.t0 = null; } return this; }
  reset(ms = 0) { this.base = ms; this.t0 = null; return this; }
  get running() { return this.t0 != null; }
  get ms() { return this.base + (this.t0 == null ? 0 : performance.now() - this.t0); }
}

/** Calls fn('left'|'right'|'up'|'down') for a pointer swipe on `el` (mouse, pen or touch). Returns an off() function. */
export function swipe(el, fn, min = 24) {
  let x0 = 0, y0 = 0, id = null;
  const down = (e) => { if (e.button > 0) return; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; };
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return;
    fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };
  const cancel = () => { id = null; };
  el.addEventListener('pointerdown', down);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
  return () => { el.removeEventListener('pointerdown', down); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); };
}

/** A short burst of confetti over `el` (skipped with Reduce motion). */
export function confetti(el, n = 90) {
  if (reduceMotion() || !el?.isConnected) return;
  const box = document.createElement('div');
  box.className = 'gm-confetti';
  el.appendChild(box);
  const W = el.clientWidth, H = el.clientHeight, cols = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#2ec4b6', '#3e7bff', '#8e6bff', '#ff6ad5'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.background = cols[i % cols.length];
    p.style.left = W / 2 + 'px';
    p.style.top = H * 0.42 + 'px';
    if (i % 3 === 0) p.style.borderRadius = '50%';
    box.appendChild(p);
    const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * Math.min(W, 520) * 0.55;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v - 120;
    p.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 720 - 360}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + H * 0.55}px)) rotate(${Math.random() * 900}deg)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
  }
  setTimeout(() => box.remove(), 2600);
}

let ac = null;
/** One shared AudioContext for the games' little sounds (created on first use, after a click). */
export function audioCtx() {
  ac ||= new AudioContext();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
