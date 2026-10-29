// Award medals for Samsung Health's Daily activity, drawn in SVG: a metal rim, a domed face with an engraved emblem
// (rings, a number, a glyph) and a sheen. Locked awards use the same art, greyed out by CSS. Loaded with the app UI.
import { escapeHtml as esc } from '../core/util.js';
import { COLORS, RINGS } from './rings.js';

const f = (n) => Math.round(n * 100) / 100;
let uid = 0;
const METALS = {
  gold: { rim: ['#fff4c9', '#e2b24a', '#86561a', '#ffe08a'], face: ['#ffe597', '#c48a24'], ink: '#7a4a0e' },
  silver: { rim: ['#ffffff', '#cdd2d8', '#69717d', '#eef1f4'], face: ['#f4f6f8', '#a9b0ba'], ink: '#4b525c' },
  platinum: { rim: ['#ffffff', '#c9d6ff', '#6f6aa8', '#ffe1f4'], face: ['#f6f1ff', '#b9b6dd'], ink: '#4a4479' },
  green: { rim: ['#e3fff2', '#1fbf83', '#0b5c3e', '#9df0cb'], face: ['#7be6b8', '#139665'], ink: '#053d28' },
  blue: { rim: ['#e1eeff', '#3b8cff', '#0b3b80', '#a6cbff'], face: ['#8fbdff', '#2a6fd6'], ink: '#062a5e' },
  pink: { rim: ['#ffe0ea', '#ff4f7e', '#86102f', '#ffadc4'], face: ['#ff8fae', '#d72d5b'], ink: '#5e0019' },
  night: { rim: ['#f2f2f7', '#8e8e93', '#2c2c2e', '#d1d1d6'], face: ['#3a3a3c', '#0b0b0c'], ink: '#fff' },
};
const MONTH = ['#5e5ce6', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#00c7be', '#ff453a', '#0a84ff', '#ffd60a', '#ff6b22', '#a2845e', '#64d2ff'];
const mpoly = (n, r, rot = 0) => 'M' + Array.from({ length: n }, (_, i) => { const a = ((rot + (i * 360) / n - 90) * Math.PI) / 180; return `${f(60 + r * Math.cos(a))} ${f(60 + r * Math.sin(a))}`; }).join('L') + 'Z';
const circle = (r) => `M${60 - r} 60a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const rosette = (r, n = 16, depth = 0.9) => 'M' + Array.from({ length: n * 2 }, (_, i) => { const a = (((i * 180) / n - 90) * Math.PI) / 180, rr = i % 2 ? r * depth : r; return `${f(60 + rr * Math.cos(a))} ${f(60 + rr * Math.sin(a))}`; }).join('L') + 'Z';
const MSHAPES = {
  circle: (s) => circle(56 * s), hex: (s) => mpoly(6, 58 * s, 0), oct: (s) => mpoly(8, 58 * s, 22.5), rosette: (s) => rosette(58 * s),
  shield: (s) => { const p = (x, y) => `${f(60 + (x - 60) * s)} ${f(60 + (y - 60) * s)}`; return `M${p(60, 3)}L${p(108, 18)}C${p(110, 60)} ${p(98, 96)} ${p(60, 117)}C${p(22, 96)} ${p(10, 60)} ${p(12, 18)}Z`; },
};
const GLYPHS = {
  flame: 'M60 30c4 10 16 16 16 32a16 16 0 0 1-32 0c0-7 3-12 7-16 0 6 3 9 6 10-2-9 0-18 3-26z',
  cup: 'M42 50h30v10a15 15 0 0 1-30 0zM72 53h4a6 6 0 0 1 0 12h-5M47 42c0-4 4-4 4-8M57 42c0-4 4-4 4-8M67 42c0-4 4-4 4-8',
  moon: 'M70 70a20 20 0 0 1-19-31 20.5 20.5 0 1 0 27 27 20 20 0 0 1-8 4z',
  calendar: 'M40 44h40v34H40zM40 54h40M50 38v10M70 38v10M48 62h6M58 62h6M68 62h6M48 70h6M58 70h6',
  bolt: 'M64 32 46 64h14l-4 24 18-32H60z',
};
const STROKED = new Set(['cup', 'calendar']);
const engrave = (inner, ink) => `<g transform="translate(0 .9)" opacity=".7">${inner('rgba(255,255,255,.5)')}</g>${inner(ink)}`;
const glyph = (name, ink, tf = '') => engrave((c) => (STROKED.has(name) ? `<path ${tf} d="${GLYPHS[name]}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : `<path ${tf} d="${GLYPHS[name]}" fill="${c}"/>`), ink);
const text = (s, ink, size = 30, y = 70) => engrave((c) => `<text x="60" y="${y}" text-anchor="middle" font-family="Outfit, Inter, system-ui, sans-serif" font-weight="800" font-size="${size}" fill="${c}">${esc(String(s))}</text>`, ink);
function ringsEmblem(keys, size = 52, cy = 60) {
  const w = keys.length === 1 ? 15 : 13, gap = 2.4;
  const out = keys.map((k, i) => `<circle cx="50" cy="50" r="${50 - w / 2 - i * (w + gap)}" fill="none" stroke="${COLORS[k].c}" stroke-width="${w}"/>`).join('');
  return `<svg x="${f(60 - size / 2)}" y="${f(cy - size / 2)}" width="${size}" height="${size}" viewBox="0 0 100 100">${out}</svg>`;
}
const DESIGN = {
  'perfect-day': { shape: 'circle', metal: 'night', emblem: () => ringsEmblem(RINGS, 60) },
  'perfect-week': { shape: 'rosette', metal: 'night', emblem: () => ringsEmblem(RINGS, 44, 52) + text('7', '#fff', 17, 92) },
  'perfect-week-focus': { shape: 'hex', metal: 'green', emblem: () => ringsEmblem(['focus'], 50, 58) + text('7', '#fff', 22, 66) },
  'perfect-week-done': { shape: 'hex', metal: 'blue', emblem: () => ringsEmblem(['done'], 50, 58) + text('7', '#fff', 22, 66) },
  'perfect-week-breaks': { shape: 'hex', metal: 'pink', emblem: () => ringsEmblem(['breaks'], 50, 58) + text('7', '#fff', 22, 66) },
  'perfect-month': { shape: 'shield', metal: 'gold', emblem: (m) => glyph('calendar', m.ink) },
  'focus-record': { shape: 'oct', metal: 'green', emblem: (m) => glyph('flame', m.ink) },
  'focus-streak': { shape: 'circle', metal: 'gold', emblem: (m) => glyph('bolt', m.ink) },
  'focus-200': { shape: 'circle', metal: 'green', emblem: (m) => text('200%', m.ink, 26, 70) },
  'focus-300': { shape: 'circle', metal: 'silver', emblem: () => text('300%', '#0b5c3e', 26, 70) },
  'focus-400': { shape: 'circle', metal: 'gold', emblem: () => text('400%', '#7a4a0e', 26, 70) },
  'first-breaks': { shape: 'circle', metal: 'pink', emblem: (m) => glyph('cup', m.ink) },
  'goals-100': { shape: 'oct', metal: 'silver', emblem: (m) => ringsEmblem(['focus'], 26, 38) + text('100', m.ink, 30, 84) },
  'goals-365': { shape: 'oct', metal: 'gold', emblem: (m) => ringsEmblem(['focus'], 26, 38) + text('365', m.ink, 30, 84) },
  'sessions-1': { shape: 'rosette', metal: 'blue', emblem: (m) => glyph('moon', m.ink) },
  'sessions-100': { shape: 'shield', metal: 'silver', emblem: (m) => glyph('moon', m.ink, 'transform="translate(30 18) scale(.5)"') + text('100', m.ink, 28, 84) },
  'sessions-500': { shape: 'shield', metal: 'gold', emblem: (m) => glyph('moon', m.ink, 'transform="translate(30 18) scale(.5)"') + text('500', m.ink, 28, 84) },
  'sessions-1000': { shape: 'shield', metal: 'platinum', emblem: (m) => glyph('moon', m.ink, 'transform="translate(30 18) scale(.5)"') + text('1000', m.ink, 25, 84) },
};
/** An award medal. opts: { locked, month: { label, year } (for month-YYYY-MM challenges), cls }. */
export function badgeSVG(id, opts = {}) {
  const k = 'hlbd' + (++uid).toString(36);
  let d = DESIGN[id], m;
  const month = /^month-(\d{4})-(\d\d)$/.exec(id);
  if (month) {
    const c = MONTH[(+month[2] - 1) % 12];
    m = { rim: ['#ffffff', c, '#1c1c1e', '#ffffff'], face: [c, '#111'], ink: '#fff' };
    d = { shape: +month[2] % 2 ? 'circle' : 'oct', emblem: () => text(opts.month?.label || month[2], '#fff', 22, 64) + text(opts.month?.year || month[1], 'rgba(255,255,255,.75)', 13, 84) };
  } else m = METALS[d?.metal] || METALS.silver;
  d ||= { shape: 'circle', emblem: () => '' };
  const shape = MSHAPES[d.shape];
  return `<svg class="hl-badge ${opts.locked ? 'locked' : ''} ${opts.cls || ''}" viewBox="0 0 120 120" aria-hidden="true"><defs>
    <linearGradient id="${k}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m.rim[0]}"/><stop offset=".38" stop-color="${m.rim[1]}"/><stop offset=".72" stop-color="${m.rim[2]}"/><stop offset="1" stop-color="${m.rim[3]}"/></linearGradient>
    <radialGradient id="${k}f" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="${m.face[0]}"/><stop offset="1" stop-color="${m.face[1]}"/></radialGradient>
    <linearGradient id="${k}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="${k}c"><path d="${shape(0.83)}"/></clipPath></defs>
    <path d="${shape(1)}" fill="url(#${k}r)"/>
    <path d="${shape(0.83)}" fill="url(#${k}f)"/>
    <path d="${shape(0.83)}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="1.6"/>
    <g clip-path="url(#${k}c)">${d.emblem(m)}<ellipse cx="44" cy="30" rx="44" ry="26" fill="url(#${k}s)" opacity=".55" transform="rotate(-24 44 30)"/></g>
  </svg>`;
}
