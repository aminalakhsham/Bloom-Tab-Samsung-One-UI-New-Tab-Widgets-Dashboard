// The chess pieces, drawn as plain SVG paths in a 100 × 100 box (no font glyphs, no borrowed set).
// Each piece is a list of [kind, path] where kind is 'b' (body: piece colour with an outline) or 'l' (a detail line
// or dot in the outline colour), so one drawing serves both sides and every board theme through CSS.
const BASE = ['b', 'M22 81h56a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-3.5 3.5h-57A3.5 3.5 0 0 1 18 86.5V85a4 4 0 0 1 4-4z'];
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const P = {
  p: [
    ['b', 'M42.5 49.5C42 61 36 71 28 81h44c-8-10-14-20-14.5-31.5z'],
    ['b', 'M37 44.5c0-3.4 5.8-6 13-6s13 2.6 13 6-5.8 6-13 6-13-2.6-13-6z'],
    ['b', circle(50, 27, 11.5)],
    BASE,
  ],
  r: [
    ['b', 'M29 73h42v8H29z'],
    ['b', 'M34 66h32l5 7H29z'],
    ['b', 'M34.5 38h31v28h-31z'],
    ['b', 'M28 32h44l-6.5 6h-31z'],
    ['b', 'M28 17h9v6h8.5v-6h9v6h8.5v-6h9v15H28z'],
    BASE,
  ],
  n: [
    ['b', 'M36 81C36 72 39 66 44 60C46 57.5 47.5 55 47 52.5C42 55 35 57 28 58.5C24 59.3 19.5 58.5 17 56C14.5 53.5 14 49 16.5 46L31 28C33 23 35.5 18 39 14L41 8L45.5 16C62 16 75 27 78.5 44C81 56 80.5 70 79 81Z'],
    ['l', 'M48 20.5C60 23 69.5 32 72.5 46'],
    ['d', circle(33.5, 33, 2.8)],
    ['d', circle(21, 49.5, 1.7)],
    BASE,
  ],
  b: [
    ['b', 'M41 67c0 6-4 10-10 14h38c-6-4-10-8-10-14z'],
    ['b', 'M37 60h26a3.5 3.5 0 0 1 0 7H37a3.5 3.5 0 0 1 0-7z'],
    ['b', 'M50 20c-9 7-16 15.5-16 25 0 7.5 4.5 12.5 9 15h14c4.5-2.5 9-7.5 9-15 0-9.5-7-18-16-25z'],
    ['l', 'M56 31l-9.5 11.5'],
    ['b', circle(50, 14.5, 5)],
    BASE,
  ],
  q: [
    ['b', 'M32.5 74h35l3 7h-41z'],
    ['b', 'M30 67h40l-2.5 7h-35z'],
    ['b', 'M21 34L30 67H70L79 34L66 49L66.5 25L58 46L50 21.5L42 46L33.5 25L34 49Z'],
    ['l', 'M28.4 60h43.2'],
    ['b', circle(19.5, 30.5, 4.6)], ['b', circle(33.5, 21.5, 4.6)], ['b', circle(50, 17.5, 4.8)], ['b', circle(66.5, 21.5, 4.6)], ['b', circle(80.5, 30.5, 4.6)],
    BASE,
  ],
  k: [
    ['b', 'M32.5 74h35l3 7h-41z'],
    ['b', 'M30 67h40l-2.5 7h-35z'],
    ['b', 'M50 27c-5 0-8.5 3-8.5 7 0 1.5.5 3 1.2 4.2C38.5 35 30 34.5 25 39c-6 5.5-3.5 14 5 28h40c8.5-14 11-22.5 5-28-5-4.5-13.5-4-17.7-.8.7-1.2 1.2-2.7 1.2-4.2 0-4-3.5-7-8.5-7z'],
    ['l', 'M31 58.5c12.5-4 25.5-4 38 0M50 39v15'],
    ['b', 'M47 6h6v5.5h5.5v6H53V24h-6v-6.5h-5.5v-6H47z'],
    BASE,
  ],
};

/** A piece as an SVG string: type 'p' 'n' 'b' 'r' 'q' 'k', color 'w' | 'b'. */
export function pieceSVG(type, color, cls = '') {
  const parts = P[type].map(([k, d]) => `<path class="${k === 'b' ? 'pb' : k === 'l' ? 'pl' : 'pd'}" d="${d}"/>`).join('');
  return `<svg class="ch-svg ${color === 'w' ? 'pw' : 'pk'} ${cls}" viewBox="0 0 100 100" aria-hidden="true">${parts}</svg>`;
}
