// Samsung Weather's full-bleed condition backgrounds: a gradient for the condition and the time of day (day, night,
// dawn, dusk) with a glowing sun, the Moon in its real phase, stars, drifting clouds, rain, snow, fog and lightning.
// Everything moves with transform/opacity only (rain and snow are tiled SVG layers sliding down), so the sky stays
// cheap to draw; Reduce motion stops it (css/apps/weather.css). `mini` is the still version drawn in each card of
// Manage locations.
import { weatherKind, skyPhase } from './model.js';
import { moonPhase, moonLitPath } from './astro.js';
import { skyGradient } from '../services/weather.js';
import { frag } from '../core/util.js';

/** Small seeded random generator, so a place keeps its stars and clouds between redraws. */
function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const svgURL = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const tiles = new Map();
const tile = (key, make) => (tiles.has(key) ? tiles.get(key) : (tiles.set(key, make()), tiles.get(key)));

function rainTile(R, w, h, n, len, width) {
  let p = '';
  for (let i = 0; i < n; i++) {
    const x = R(0, w).toFixed(1), y = R(0, h), l = len * R(0.6, 1.25), o = R(0.3, 0.85).toFixed(2);
    for (const yy of y + l > h ? [y, y - h] : [y]) p += `<rect x="${x}" y="${yy.toFixed(1)}" width="${width}" height="${l.toFixed(1)}" rx="${width / 2}" opacity="${o}"/>`;
  }
  return svgURL(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f2ff" stop-opacity="0"/><stop offset="1" stop-color="#e8f2ff"/></linearGradient></defs><g fill="url(#g)">${p}</g></svg>`);
}
function dotTile(R, w, h, n, r0, r1, color) {
  let p = '';
  for (let i = 0; i < n; i++) {
    const x = R(0, w), y = R(0, h), r = R(r0, r1), o = R(0.35, 1).toFixed(2);
    for (const dy of [0, ...(y + r > h ? [-h] : []), ...(y - r < 0 ? [h] : [])]) p += `<circle cx="${x.toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="${r.toFixed(2)}" opacity="${o}"/>`;
  }
  return svgURL(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g fill="${color}">${p}</g></svg>`);
}
const layer = (cls, img, tw, th, dur, extra = '') => `<i class="wxk-fall ${cls}" style="--img:${img};--tw:${tw}px;--th:${th}px;animation-duration:${dur}s;${extra}"></i>`;

/** The Moon with its lit part for a phase (0 new → .5 full); mirrored south of the equator. */
export function moonSVG(phase, fraction, size = 96, south = false) {
  const r = size / 2 - 1, c = size / 2, id = 'mn' + Math.random().toString(36).slice(2, 7);
  const craters = [[0.32, 0.34, 0.13], [0.62, 0.28, 0.08], [0.55, 0.6, 0.16], [0.28, 0.66, 0.09], [0.72, 0.52, 0.07], [0.44, 0.46, 0.05], [0.38, 0.82, 0.06]]
    .map(([x, y, s]) => `<circle cx="${(x * size).toFixed(1)}" cy="${(y * size).toFixed(1)}" r="${((s * size) / 2).toFixed(1)}"/>`).join('');
  return `<svg class="wx-moonimg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <defs><radialGradient id="${id}g" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#fbf9f1"/><stop offset=".7" stop-color="#dcd9cf"/><stop offset="1" stop-color="#b3b0a6"/></radialGradient>
    <clipPath id="${id}c"><path d="${moonLitPath(phase, fraction, r, c, south)}"/></clipPath></defs>
    <circle cx="${c}" cy="${c}" r="${r}" class="mn-dark"/>
    <g clip-path="url(#${id}c)"><circle cx="${c}" cy="${c}" r="${r}" fill="url(#${id}g)"/><g class="mn-cr">${craters}</g></g></svg>`;
}

/** The sky's HTML for a forecast (or a code and phase when there's none yet). */
export function skyHTML({ code = 2, phase = 'day', lat = 0, mini = false, seed = 'wx' } = {}) {
  const k = weatherKind(code), night = phase === 'night', R0 = rng(seed + k + phase);
  const R = (a, b) => a + R0() * (b - a);
  const clearish = k === 'clear' || k === 'partly';
  let h = '';
  // sun (by day) or the real Moon (at night)
  if (clearish && !night) h += `<div class="wxk-sun ${phase !== 'day' ? 'low' : ''}"><i class="wxk-halo"></i><i class="wxk-core"></i></div>`;
  else if (!night && (k === 'cloudy' || k === 'fog')) h += '<div class="wxk-sun hazy"><i class="wxk-halo"></i></div>';
  if (night && (clearish || k === 'cloudy')) {
    const n = k === 'cloudy' ? 18 : k === 'clear' ? 90 : 55, tw = mini ? 240 : 560, th = mini ? 140 : 420;
    h += `<div class="wxk-stars">${layer('still', tile(`stars${n}${mini}`, () => dotTile(rng('stars' + n), tw, th, mini ? Math.round(n / 3) : n, 0.4, mini ? 0.8 : 1.15, '#fff')), tw, th, 0)}`;
    if (!mini) for (let i = 0; i < 10; i++) h += `<b style="left:${R(2, 98).toFixed(1)}%;top:${R(2, 55).toFixed(1)}%;animation-delay:-${R(0, 5).toFixed(1)}s;animation-duration:${R(2.5, 6).toFixed(1)}s"></b>`;
    h += '</div>';
  }
  if (night && clearish) {
    const m = moonPhase(Date.now());
    h += `<div class="wxk-moon">${moonSVG(m.phase, Math.max(0.12, m.fraction), mini ? 30 : 64, lat < 0)}</div>`;
  }
  // clouds: a couple of soft puffs when partly cloudy, a full deck for overcast, rain and storms
  const deck = { partly: 3, cloudy: 6, fog: 3, drizzle: 5, rain: 6, snow: 5, thunder: 6 }[k] || 0;
  const n = mini ? Math.min(3, Math.ceil(deck / 2)) : deck;
  if (n) {
    const tone = k === 'thunder' ? 'dark' : k === 'rain' || k === 'drizzle' ? 'grey' : k === 'cloudy' || k === 'fog' ? 'soft' : 'white';
    h += `<div class="wxk-clouds ${tone}">`;
    for (let i = 0; i < n; i++) {
      const w = mini ? R(110, 190) : R(260, 520), top = mini ? R(-30, 40) : deck > 3 ? R(-12, 40) : R(-6, 24), x = R(-30, 80);
      h += `<div class="wxk-cloud" style="--w:${w.toFixed(0)}px;top:${top.toFixed(1)}%;inset-inline-start:${x.toFixed(1)}%;opacity:${R(0.55, 1).toFixed(2)};animation-duration:${R(28, 52).toFixed(0)}s;animation-delay:-${R(0, 40).toFixed(0)}s"><i></i><i></i><i></i></div>`;
    }
    h += '</div>';
  }
  if (k === 'fog') {
    h += '<div class="wxk-fog">';
    for (let i = 0; i < (mini ? 2 : 4); i++) h += `<i style="top:${(18 + i * 17 + R(-4, 4)).toFixed(0)}%;animation-duration:${R(16, 28).toFixed(0)}s;animation-delay:-${R(0, 20).toFixed(0)}s"></i>`;
    h += '</div>';
  }
  if (k === 'drizzle' || k === 'rain' || k === 'thunder') {
    const dense = { drizzle: 0.45, rain: 1, thunder: 1.3 }[k], tw = mini ? 160 : 320, th = mini ? 160 : 320, len = (k === 'drizzle' ? 12 : 24) * (mini ? 0.6 : 1);
    h += `<div class="wxk-rain">${layer('', tile(`rainA${k}${mini}`, () => rainTile(rng('ra' + k), tw, th, Math.round(28 * dense), len, 1.3)), tw, th, 0.6)}${layer('', tile(`rainB${k}${mini}`, () => rainTile(rng('rb' + k), tw, th, Math.round(20 * dense), len * 0.7, 1)), tw, th, 0.85, 'opacity:.7')}</div>`;
  }
  if (k === 'snow') {
    const tw = mini ? 160 : 360, th = mini ? 160 : 360;
    h += `<div class="wxk-snow">${layer('', tile(`snowA${mini}`, () => dotTile(rng('sa'), tw, th, mini ? 10 : 24, mini ? 1.2 : 2, mini ? 2 : 3.6, '#fff')), tw, th, mini ? 7 : 12)}${layer('drift', tile(`snowB${mini}`, () => dotTile(rng('sb'), tw, th, mini ? 14 : 36, 0.8, mini ? 1.3 : 2.2, '#fff')), tw, th, mini ? 11 : 18, 'opacity:.75')}</div>`;
  }
  if (k === 'thunder') h += `<div class="wxk-flash" style="animation-delay:-${R(0, 9).toFixed(1)}s"></div>`;
  return `<div class="wxk k-${k} p-${phase}${mini ? ' mini' : ''}" aria-hidden="true" style="background:${skyGradient(code, !night, phase)}">${h}</div>`;
}

/** The sky element for a place's forecast (null data: a plain daytime sky). */
export function skyEl(d, opts = {}) {
  const phase = d ? skyPhase(d) : 'day';
  return frag(skyHTML({ code: d?.current?.code ?? 2, phase, lat: d?.location?.lat ?? 0, ...opts }));
}

/** The phase a forecast's sky is drawn with right now (to know when it must change). */
export const skyKey = (d) => (d ? `${weatherKind(d.current?.code)}|${skyPhase(d)}` : 'none');
