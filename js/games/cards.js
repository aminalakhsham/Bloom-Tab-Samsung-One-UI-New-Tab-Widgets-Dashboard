// Playing-card faces for Solitaire, drawn in SVG: the suit pips are paths (not font glyphs) so they look the same on
// every computer, with the classic pip layouts for A–10 and framed court cards for J, Q and K.
// Cards are numbers 0…51: suit = card / 13 | 0 (0 ♠, 1 ♥, 2 ♣, 3 ♦; odd suits are red), rank = card % 13 + 1.

/** Suit shapes in a 100 × 100 box. */
export const SUIT_PATHS = [
  // spade: an upturned heart on a flared stem
  'M50 4C60 22 95 38 95 62C95 76 85 85 72 85C64 85 57 81 54 75C55 84 59 91 67 96H33C41 91 45 84 46 75C43 81 36 85 28 85C15 85 5 76 5 62C5 38 40 22 50 4Z',
  // heart
  'M50 92C46 87 4 62 4 33C4 17 16 6 29 6C39 6 46 12 50 20C54 12 61 6 71 6C84 6 96 17 96 33C96 62 54 87 50 92Z',
  // club: three leaves joined over a flared stem
  'M50 6A20 20 0 0 1 66.5 37.3A20 20 0 1 1 55 70C56 82 60 90 68 96H32C40 90 44 82 45 70A20 20 0 1 1 33.5 37.3A20 20 0 0 1 50 6Z',
  // diamond with gently curved sides
  'M50 3C61 20 74 36 90 50C74 64 61 80 50 97C39 80 26 64 10 50C26 36 39 20 50 3Z',
];
export const suit = c => (c / 13) | 0;
export const rank = c => c % 13 + 1;
export const isRed = c => (suit(c) & 1) === 1;
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A suit pip as a standalone SVG (for buttons, foundations, labels). */
export const suitSVG = (s, cls = '') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${SUIT_PATHS[s]}"/></svg>`;

const pip = (s, cx, cy, size, flip = false) => {
  const x = cx - size / 2, y = cy - size / 2;
  const svg = `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100"><path d="${SUIT_PATHS[s]}"/></svg>`;
  // nested <svg> can't take a transform everywhere, so the upside-down pips of the lower half turn in a <g>
  return flip ? `<g transform="rotate(180 ${cx} ${cy})">${svg}</g>` : svg;
};
// Pip centres for 2–10 in the classic arrangement: columns L, C, R and rows from top (0) to bottom (1).
const L = 31, C = 50, R = 69;
const LAYOUT = {
  2: [[C, 0], [C, 1]],
  3: [[C, 0], [C, .5], [C, 1]],
  4: [[L, 0], [R, 0], [L, 1], [R, 1]],
  5: [[L, 0], [R, 0], [C, .5], [L, 1], [R, 1]],
  6: [[L, 0], [R, 0], [L, .5], [R, .5], [L, 1], [R, 1]],
  7: [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [L, 1], [R, 1]],
  8: [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [C, .75], [L, 1], [R, 1]],
  9: [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, .5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
  10: [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]],
};
const TOP = 47, BOTTOM = 123;
// Simple emblems above the court letter: a crown for the King, a tiara for the Queen and a plumed cap for the Jack.
const EMBLEM = {
  13: 'M30 58L32 45L41 51L50 41L59 51L68 45L70 58ZM48.6 32h2.8v3.4h3.4v2.8h-3.4V41h-2.8v-2.8h-3.4v-2.8h3.4Z',
  12: 'M30 58L32.5 47L41 52.5L50 45L59 52.5L67.5 47L70 58ZM32.5 41.6a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 1 1 0-5.8ZM50 39.4a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 1 1 0-5.8ZM67.5 41.6a2.9 2.9 0 1 1 0 5.8a2.9 2.9 0 1 1 0-5.8Z',
  11: 'M31 58V50.5C37 47 43 48.5 50 51C57 48.5 63 47 69 50.5V58ZM50 41.5L53.2 46.5L50 49.5L46.8 46.5Z',
};

/** The face of a card as an SVG string (viewBox 100 × 140). */
export function faceSVG(c) {
  const s = suit(c), r = rank(c), lbl = RANKS[r];
  let body = '';
  if (r === 1) body = pip(s, 50, 85, s === 0 ? 50 : 44);
  else if (r <= 10) body = LAYOUT[r].map(([x, f]) => pip(s, x, TOP + (BOTTOM - TOP) * f, 17, f > .5)).join('');
  else {
    body = `<rect class="cd-court" x="17" y="35" width="66" height="96" rx="7"/>
      <path class="cd-emb" d="${EMBLEM[r]}"/><rect class="cd-emb" x="30" y="59" width="40" height="3.2" rx="1.6"/>
      <text class="cd-big" x="50" y="100" text-anchor="middle">${lbl}</text>${pip(s, 50, 116, 15)}`;
  }
  return `<svg class="cd-svg" viewBox="0 0 100 140" aria-hidden="true">
    <text class="cd-rank${lbl.length > 1 ? ' two' : ''}" x="${lbl.length > 1 ? 5 : 8}" y="26">${lbl}</text>${pip(s, 84, 17, 19)}${body}</svg>`;
}

let back = '';
/** The pattern on the back of a card, for the coloured panel inside its white border (viewBox 89 × 129): a fine lattice,
 *  a frame and the four suits in a medallion, all in white so the panel's colour (CSS) shows through. */
export function backSVG() {
  if (back) return back;
  let lat = '';
  for (let k = -129; k < 89; k += 6) lat += `M${k} 0l129 129M${k} 129l129-129`;
  const cx = 44.5, cy = 64.5, at = (s, x, y) => `<svg x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" viewBox="0 0 100 100"><path d="${SUIT_PATHS[s]}"/></svg>`;
  back = `<svg class="cd-back" viewBox="0 0 89 129" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path class="bk-lat" d="${lat}"/><rect class="bk-frame" x="4.5" y="4.5" width="80" height="120" rx="4"/>
    <circle class="bk-med" cx="${cx}" cy="${cy}" r="17"/><g class="bk-pips">${at(0, cx, cy - 8.2)}${at(1, cx + 8.2, cy)}${at(3, cx, cy + 8.2)}${at(2, cx - 8.2, cy)}</g></svg>`;
  return back;
}

/** Spoken name of a card for screen readers, e.g. "Q ♥". */
export const cardLabel = c => `${RANKS[rank(c)]} ${'♠♥♣♦'[suit(c)]}`;
