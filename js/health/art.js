// Samsung Health drawings: the Daily activity rings (flat, round caps, a light track, like Samsung's), medication
// icons (a pill, capsule or container shape in one or two colours on a coloured disc), the five mood faces, and the
// app's extra line glyphs (registered with addIcons). Everything returns SVG strings. Award medals are in badges.js.
import { escapeHtml as esc } from '../core/util.js';
import { addIcons } from '../core/icons.js';
import { COLORS, RINGS } from './rings.js';
import { MOOD } from './model.js';

addIcons({
  hlRun: '<circle cx="14.6" cy="4.6" r="1.9"/><path d="M8.2 10.2 11.6 8l3.4.6 1.8 3.1 2.8.8"/><path d="M13.2 8.4 11.4 14l3.2 2.6.8 4.6"/><path d="M11.4 14l-2 3.6-3.8.9"/>',
  hlRings: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5.2"/><circle cx="12" cy="12" r="1.8"/>',
  hlPill: '<rect x="3.2" y="8.4" width="17.6" height="7.2" rx="3.6" transform="rotate(-40 12 12)"/><path d="m9.6 9.2 5 5"/>',
  hlBed: '<path d="M3 18.5V6M3 14h18v4.5M21 14v-2.5a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="11" r="1.9"/>',
  hlMood: '<circle cx="12" cy="12" r="8.6"/><path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0"/><path d="M9 9.6v.6M15 9.6v.6"/>',
  hlScale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.3 10.2a5 5 0 0 1 7.4 0"/><path d="m12 10.6 1.4-2"/>',
  hlCycle: '<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5Z"/>',
  hlBreathe: '<circle cx="12" cy="7.8" r="3.4"/><circle cx="16" cy="10.6" r="3.4"/><circle cx="14.5" cy="15.4" r="3.4"/><circle cx="9.5" cy="15.4" r="3.4"/><circle cx="8" cy="10.6" r="3.4"/>',
  hlAward: '<circle cx="12" cy="14.5" r="5.8"/><path d="M8.7 9.9 6.2 3h3.8l2 4.4M15.3 9.9 17.8 3H14l-1.1 2.6"/><path d="m12 11.8.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3Z"/>',
  hlTarget: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  hlChart: '<path d="M4 20V10M10 20V4M16 20v-7M21.5 20H2.5"/>',
  hlCup: '<path d="M6 4h12l-1.5 15.2a1.9 1.9 0 0 1-1.9 1.8H9.4a1.9 1.9 0 0 1-1.9-1.8Z"/><path d="M6.6 10h10.8"/>',
});

const f = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ Daily activity rings
/** The three rings as an SVG string; rings = { focus: { p }, done: { p }, breaks: { p } } (as ringsFor() gives).
 *  `width` is the stroke in a 100×100 box; `gap` the space between rings. */
export function ringsSVG(rings, { width = 11, gap = 3, label = '', cls = '' } = {}) {
  const body = RINGS.map((k, i) => {
    const r = 50 - width / 2 - i * (width + gap), c = COLORS[k], p = Math.max(0, +rings?.[k]?.p || 0);
    let s = `<circle cx="50" cy="50" r="${f(r)}" fill="none" stroke="${c.track}" stroke-width="${width}"/>`;
    if (p > 0.004) s += `<circle class="hl-ring-arc" cx="50" cy="50" r="${f(r)}" fill="none" stroke="${c.c}" stroke-width="${width}" stroke-linecap="round" pathLength="100" stroke-dasharray="${p >= 1 ? '100 0' : f(Math.max(0.5, p * 100)) + ' 200'}" transform="rotate(-90 50 50)"/>`;
    // past the goal the tip runs on round the ring with a soft shadow, so 140% reads differently from 100%
    if (p > 1.02) {
      const a = ((Math.min(p, 9) % 1) * 360 - 90) * (Math.PI / 180);
      s += `<circle cx="${f(50 + r * Math.cos(a))}" cy="${f(50 + r * Math.sin(a))}" r="${f(width / 2)}" fill="${c.c}" stroke="rgba(0,0,0,.18)" stroke-width="1"/>`;
    }
    return s;
  }).join('');
  const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="hl-rings ${cls}" viewBox="0 0 100 100" ${aria}>${body}</svg>`;
}
/** One ring (a single metric), for list rows and the trend cards. */
export function oneRingSVG(k, p, { width = 16 } = {}) {
  const r = 50 - width / 2, c = COLORS[k];
  p = Math.max(0, +p || 0);
  const arc = p > 0.004 ? `<circle cx="50" cy="50" r="${f(r)}" fill="none" stroke="${c.c}" stroke-width="${width}" stroke-linecap="round" pathLength="100" stroke-dasharray="${p >= 1 ? '100 0' : f(Math.max(0.5, p * 100)) + ' 200'}" transform="rotate(-90 50 50)"/>` : '';
  return `<svg class="hl-rings one" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${f(r)}" fill="none" stroke="${c.track}" stroke-width="${width}"/>${arc}</svg>`;
}

// ------------------------------------------------------------------ medication icons
const EDGE = 'stroke="rgba(0,0,0,.16)" stroke-width="1.6" stroke-linejoin="round"';
const SHINE = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#fff" stroke-opacity=".55" stroke-width="3.2" stroke-linecap="round"/>`;
const poly = (n, r, rot, c) => {
  const pts = Array.from({ length: n }, (_, i) => { const a = rot + (i * 2 * Math.PI) / n; return `${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`; }).join(' ');
  return `<polygon points="${pts}" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="12.2" stroke-linejoin="round"/><polygon points="${pts}" fill="${c}" stroke="${c}" stroke-width="9" stroke-linejoin="round"/>`;
};
export const SHAPES = {
  round: { n: 1, draw: (a) => `<circle cx="50" cy="50" r="27" fill="${a}" ${EDGE}/><circle cx="50" cy="50" r="21" fill="none" stroke="rgba(0,0,0,.07)" stroke-width="2"/>` },
  'round-score': { n: 1, draw: (a) => `<circle cx="50" cy="50" r="27" fill="${a}" ${EDGE}/><path d="M28 50h44" stroke="rgba(0,0,0,.18)" stroke-width="2.4" stroke-linecap="round"/>` },
  oval: { n: 1, draw: (a) => `<g transform="rotate(-30 50 50)"><ellipse cx="50" cy="50" rx="33" ry="21" fill="${a}" ${EDGE}/><ellipse cx="50" cy="50" rx="27" ry="15.5" fill="none" stroke="rgba(0,0,0,.07)" stroke-width="2"/></g>` },
  oblong: { n: 1, draw: (a) => `<g transform="rotate(-30 50 50)"><rect x="15" y="35" width="70" height="30" rx="13" fill="${a}" ${EDGE}/></g>` },
  capsule: { n: 2, draw: (a, b) => `<g transform="rotate(-40 50 50)"><path d="M50 36H33a14 14 0 0 0 0 28h17z" fill="${a}" ${EDGE}/><path d="M50 36h17a14 14 0 0 1 0 28H50z" fill="${b}" ${EDGE}/>${SHINE(32, 42, 64, 42)}</g>` },
  softgel: { n: 1, draw: (a) => `<g transform="rotate(-35 50 50)"><ellipse cx="50" cy="50" rx="32" ry="20" fill="${a}" fill-opacity=".88" ${EDGE}/><ellipse cx="44" cy="43" rx="14" ry="5" fill="#fff" opacity=".5"/></g>` },
  diamond: { n: 1, draw: (a) => poly(4, 27, -Math.PI / 2, a) },
  triangle: { n: 1, draw: (a) => `<g transform="translate(0 4)">${poly(3, 27, -Math.PI / 2, a)}</g>` },
  square: { n: 1, draw: (a) => `<rect x="25" y="25" width="50" height="50" rx="11" fill="${a}" ${EDGE}/>` },
  hexagon: { n: 1, draw: (a) => poly(6, 27, 0, a) },
  bottle: { n: 2, draw: (a, b) => `<rect x="38" y="16" width="24" height="12" rx="3" fill="${a}" ${EDGE}/><path d="M35 30h30a4 4 0 0 1 4 4v42a8 8 0 0 1-8 8H39a8 8 0 0 1-8-8V34a4 4 0 0 1 4-4z" fill="${b}" ${EDGE}/><rect x="36" y="46" width="28" height="22" rx="3" fill="#fff" opacity=".75"/>` },
  dropper: { n: 2, draw: (a, b) => `<path d="M44 12h12v10h-12z" fill="${a}" ${EDGE}/><path d="M41 22h18l2 10H39z" fill="${a}" ${EDGE}/><path d="M38 33h24a4 4 0 0 1 4 4v38a8 8 0 0 1-8 8H42a8 8 0 0 1-8-8V37a4 4 0 0 1 4-4z" fill="${b}" ${EDGE}/>${SHINE(41, 42, 41, 70)}` },
  tube: { n: 2, draw: (a, b) => `<g transform="rotate(-35 50 50)"><rect x="42" y="12" width="16" height="12" rx="3" fill="${a}" ${EDGE}/><path d="M38 24h24l6 54a3 3 0 0 1-3 3H35a3 3 0 0 1-3-3z" fill="${b}" ${EDGE}/><path d="M33 74h34" stroke="rgba(0,0,0,.18)" stroke-width="2"/></g>` },
  jar: { n: 2, draw: (a, b) => `<rect x="24" y="28" width="52" height="14" rx="4" fill="${a}" ${EDGE}/><path d="M27 44h46v28a8 8 0 0 1-8 8H35a8 8 0 0 1-8-8z" fill="${b}" ${EDGE}/><rect x="33" y="52" width="34" height="16" rx="3" fill="#fff" opacity=".7"/>` },
  inhaler: { n: 2, draw: (a, b) => `<rect x="40" y="12" width="22" height="46" rx="9" fill="${b}" ${EDGE}/><path d="M30 54h32v18a8 8 0 0 1-8 8H30a6 6 0 0 1-6-6v-14a6 6 0 0 1 6-6z" fill="${a}" ${EDGE}/>${SHINE(46, 20, 46, 46)}` },
  syringe: { n: 2, draw: (a, b) => `<g transform="rotate(-45 50 50)"><path d="M47 6h6v12h-6z" fill="${a}"/><rect x="40" y="4" width="20" height="5" rx="2.5" fill="${a}" ${EDGE}/><rect x="40" y="18" width="20" height="50" rx="4" fill="${b}" ${EDGE}/><path d="M40 28h7M40 38h7M40 48h7M40 58h7" stroke="rgba(0,0,0,.25)" stroke-width="1.6"/><path d="M50 68v24" stroke="#8e8e93" stroke-width="2.4" stroke-linecap="round"/></g>` },
  patch: { n: 1, draw: (a) => `<rect x="20" y="20" width="60" height="60" rx="14" fill="${a}" ${EDGE}/><rect x="33" y="33" width="34" height="34" rx="7" fill="#fff" opacity=".55"/>` },
  spray: { n: 2, draw: (a, b) => `<path d="M42 12h14v8h8v6H42z" fill="${a}" ${EDGE}/><rect x="40" y="26" width="20" height="8" rx="2" fill="${a}" ${EDGE}/><rect x="34" y="34" width="32" height="50" rx="8" fill="${b}" ${EDGE}/>${SHINE(40, 42, 40, 74)}` },
  powder: { n: 1, draw: (a) => `<path d="M26 22h48v56H26z" fill="${a}" ${EDGE}/><path d="M26 22l4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6M26 78l4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4 6" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1.6"/>` },
  device: { n: 2, draw: (a, b) => `<rect x="28" y="16" width="44" height="68" rx="12" fill="${b}" ${EDGE}/><rect x="35" y="25" width="30" height="22" rx="5" fill="#fff" opacity=".7"/><circle cx="50" cy="64" r="8" fill="${a}" ${EDGE}/>` },
};
export const SHAPES_BY_TYPE = {
  tablet: ['round', 'round-score', 'oval', 'oblong', 'capsule', 'diamond', 'triangle', 'square', 'hexagon'],
  capsule: ['capsule', 'softgel', 'oval', 'oblong'],
  liquid: ['bottle', 'dropper', 'syringe'], drops: ['dropper', 'bottle'], inhaler: ['inhaler'], injection: ['syringe'],
  cream: ['tube', 'jar'], gel: ['tube', 'jar'], patch: ['patch'], spray: ['spray', 'bottle'], powder: ['powder', 'jar'], device: ['device'],
};
export const shapesFor = (type) => SHAPES_BY_TYPE[type] || SHAPES_BY_TYPE.tablet;
export const defaultShape = (type) => shapesFor(type)[0];
export const PILL_COLORS = ['#ffffff', '#e5e5ea', '#a1a1a6', '#48484a', '#f3e6cc', '#fff3a3', '#ffd60a', '#ffbf69', '#ff9500', '#ffc2cc', '#ff6b8a', '#ff3b30', '#d7c2ff', '#af52de', '#a8dcff', '#0a84ff', '#9ef0d4', '#34c759', '#b08968', '#1c1c1e'];
export const BG_COLORS = ['#a9d9ff', '#86e0e9', '#8ee6c2', '#b9e88b', '#fff09a', '#ffd08a', '#ffb0a8', '#ffb6d9', '#dcc3ff', '#b8c2ff', '#d6d6db', '#3a3a3c'];
const hex = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : d);

/** The medication's icon: its shape and colours on its background disc. */
export function pillSVG(m, cls = '') {
  const sh = SHAPES[m.shape] || SHAPES[defaultShape(m.type)];
  return `<svg class="hl-pillsvg ${cls}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="${hex(m.bg, BG_COLORS[0])}"/>${sh.draw(hex(m.c1, '#fff'), hex(m.c2, hex(m.c1, '#fff')))}</svg>`;
}
/** Just a shape (for the shape picker). */
export const shapeOnly = (shape, c1 = '#fff', c2 = c1) => `<svg class="hl-pillsvg" viewBox="0 0 100 100" aria-hidden="true">${(SHAPES[shape] || SHAPES.round).draw(hex(c1, '#fff'), hex(c2, '#fff'))}</svg>`;

// ------------------------------------------------------------------ mood faces
const MOUTH = {
  great: '<path d="M33 56c4 13 30 13 34 0Z" fill="#3b2a12" opacity=".85"/><path d="M40 62c5 4 15 4 20 0" stroke="#ff8a8a" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/>',
  good: '<path d="M35 58c6 9 24 9 30 0" stroke="#2b2b2b" stroke-width="4.6" stroke-linecap="round" fill="none" opacity=".8"/>',
  okay: '<path d="M37 62h26" stroke="#2b2b2b" stroke-width="4.6" stroke-linecap="round" opacity=".8"/>',
  bad: '<path d="M36 66c6-8 22-8 28 0" stroke="#1d1d2b" stroke-width="4.6" stroke-linecap="round" fill="none" opacity=".8"/>',
  awful: '<path d="M34 68c6-12 26-12 32 0" stroke="#1d1d2b" stroke-width="4.6" stroke-linecap="round" fill="none" opacity=".8"/><path d="M30 34l10 4M70 34l-10 4" stroke="#1d1d2b" stroke-width="4" stroke-linecap="round" opacity=".7"/>',
};
const EYES = {
  great: '<path d="M33 44c3-5 9-5 12 0M55 44c3-5 9-5 12 0" stroke="#2b2b2b" stroke-width="4.4" stroke-linecap="round" fill="none" opacity=".85"/>',
  default: '<circle cx="39" cy="44" r="4.4" fill="#1d1d24" opacity=".85"/><circle cx="61" cy="44" r="4.4" fill="#1d1d24" opacity=".85"/>',
};
/** A mood face in the mood's colour ('great' … 'awful'). */
export function moodFace(id, cls = '') {
  const m = MOOD[id] || MOOD.okay;
  return `<svg class="hl-face ${cls}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="${m.color}"/><ellipse cx="38" cy="26" rx="16" ry="8" fill="#fff" opacity=".22"/>${EYES[id] || EYES.default}${MOUTH[id] || MOUTH.okay}</svg>`;
}
