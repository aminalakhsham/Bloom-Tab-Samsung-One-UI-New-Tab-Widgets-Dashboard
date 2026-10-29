// Artwork for Gaming Hub, drawn in SVG so it stays sharp at every size and needs no image files: the banner art of the
// game cards (Home's Instant plays, the Library, the hero) and the game icons (full-bleed squares; CSS rounds them into
// One UI squircles).

let seq = 0;
const uid = (p) => `${p}${++seq}`;
const FONT = 'direction="ltr" font-family="Outfit, Inter, system-ui, sans-serif"';

// ------------------------------------------------------------------ 2048 tile colours (also used by the board)
const T2048 = { 2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'], 8: ['#f2b179', '#fff'], 16: ['#f59563', '#fff'], 32: ['#f67c5f', '#fff'], 64: ['#f65e3b', '#fff'], 128: ['#edcf72', '#fff'], 256: ['#edcc61', '#fff'], 512: ['#edc850', '#fff'], 1024: ['#edc53f', '#fff'], 2048: ['#edc22e', '#fff'] };
export const tileColors = (v) => T2048[v] || ['#3c3a32', '#fff'];

// ------------------------------------------------------------------ banners (320 × 200, cropped to the card)
function sudokuArt() {
  const a = uid('sa'), b = uid('sb');
  const G = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
  let cells = '', marks = '';
  const x0 = 158, y0 = 26, s = 16.4;
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9, x = x0 + c * s, y = y0 + r * s, v = +G[i];
    const hl = r === 4 || c === 4 || ((r / 3) | 0) === 1 && ((c / 3) | 0) === 1;
    if (r === 4 && c === 4) cells += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#3e7bff"/>`;
    else if (hl) cells += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#e3ebff"/>`;
    if (v) marks += `<text x="${x + s / 2}" y="${y + s * 0.74}" text-anchor="middle" font-size="11" font-weight="600" fill="${r === 4 && c === 4 ? '#fff' : '#1b1d29'}">${v}</text>`;
    else if ((i * 7) % 11 === 0) marks += `<text x="${x + s / 2}" y="${y + s * 0.64}" text-anchor="middle" font-size="5" fill="#8e8f97">1 4 7</text>`;
  }
  let lines = '';
  for (let k = 0; k <= 9; k++) {
    const w = k % 3 ? 0.6 : 1.6, col = k % 3 ? '#cfd0d8' : '#3a3b45';
    lines += `<line x1="${x0 + k * s}" y1="${y0}" x2="${x0 + k * s}" y2="${y0 + 9 * s}" stroke="${col}" stroke-width="${w}"/><line x1="${x0}" y1="${y0 + k * s}" x2="${x0 + 9 * s}" y2="${y0 + k * s}" stroke="${col}" stroke-width="${w}"/>`;
  }
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" ${FONT} aria-hidden="true"><defs>
    <linearGradient id="${a}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6bff"/><stop offset=".55" stop-color="#5a55f2"/><stop offset="1" stop-color="#8b4dff"/></linearGradient>
    <radialGradient id="${b}" cx=".2" cy=".15" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="320" height="200" fill="url(#${a})"/><rect width="320" height="200" fill="url(#${b})"/>
    <text x="34" y="150" font-size="150" font-weight="800" fill="#fff" fill-opacity=".14">9</text>
    <g transform="rotate(-6 232 100)"><rect x="${x0 - 8}" y="${y0 - 8}" width="${9 * s + 16}" height="${9 * s + 16}" rx="16" fill="#fff" filter="drop-shadow(0 10px 18px rgba(20,20,80,.35))"/>${cells}${lines}${marks}</g></svg>`;
}

const MS_NUM = ['', '#2f6bff', '#1f9a50', '#e5484d', '#3b33b0', '#a3243b', '#0f8f8f', '#1b1d29', '#8e8f97'];
function minesArt() {
  const a = uid('ma');
  const cols = 14, rows = 9, s = 24, ox = (320 - cols * s) / 2, oy = (200 - rows * s) / 2;
  // a fixed little board: '.' closed, digits open, 'F' flag, '*' mine, ' ' open zero
  const B = [
    '..............',
    '...1  1.......',
    '..21  12F.....',
    '..1    1......',
    '.F1    111....',
    '..2      1F...',
    '..*1     211..',
    '...2111   1...',
    '..............',
  ];
  let g = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = B[r][c], x = ox + c * s, y = oy + r * s, alt = (r + c) % 2;
    if (ch === '.' || ch === 'F') {
      g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${alt ? '#62c96e' : '#72d27c'}"/>`;
      if (ch === 'F') g += `<path d="M${x + 9} ${y + 19}V${y + 5}l9 4-9 4" fill="#ff4d4d" stroke="#ff4d4d" stroke-width="1.6" stroke-linejoin="round"/><path d="M${x + 6} ${y + 19.5}h8" stroke="#2a2b33" stroke-width="2" stroke-linecap="round"/>`;
    } else {
      g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${ch === '*' ? '#ff5a4f' : alt ? '#e9e2d0' : '#f3eddd'}"/>`;
      if (ch === '*') g += `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="5.5" fill="#1b1d29"/><circle cx="${x + s / 2 - 1.8}" cy="${y + s / 2 - 1.8}" r="1.5" fill="#fff" fill-opacity=".7"/>`;
      else if (ch !== ' ') g += `<text x="${x + s / 2}" y="${y + s * 0.72}" text-anchor="middle" font-size="15" font-weight="800" fill="${MS_NUM[+ch]}">${ch}</text>`;
    }
  }
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" ${FONT} aria-hidden="true"><defs><linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3cc46a"/><stop offset="1" stop-color="#14904a"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#${a})"/>${g}</svg>`;
}

function g2048Art() {
  const a = uid('ta'), b = uid('tb');
  const vals = [2, 4, 8, 16, 0, 32, 2048, 64, 128, 0, 512, 256, 4, 1024, 0, 2];
  const s = 34, gap = 6, ox = 164, oy = 22;
  let g = `<rect x="${ox - gap}" y="${oy - gap}" width="${4 * s + 5 * gap}" height="${4 * s + 5 * gap}" rx="12" fill="#bbada0"/>`;
  vals.forEach((v, i) => {
    const x = ox + (i % 4) * (s + gap), y = oy + ((i / 4) | 0) * (s + gap);
    if (!v) { g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" fill="#cdc1b4"/>`; return; }
    const [bg, fg] = tileColors(v);
    g += `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" fill="${bg}" ${v === 2048 ? 'filter="drop-shadow(0 0 8px #ffe066)"' : ''}/><text x="${x + s / 2}" y="${y + s * 0.66}" text-anchor="middle" font-size="${v >= 1000 ? 11 : v >= 100 ? 13 : 16}" font-weight="800" fill="${fg}">${v}</text>`;
  });
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" ${FONT} aria-hidden="true"><defs>
    <linearGradient id="${a}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc94a"/><stop offset=".6" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient>
    <radialGradient id="${b}" cx=".25" cy=".2" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="320" height="200" fill="url(#${a})"/><rect width="320" height="200" fill="url(#${b})"/>
    <text x="22" y="118" font-size="62" font-weight="800" fill="#fff" fill-opacity=".92" letter-spacing="-2">2048</text>
    <g transform="rotate(5 245 100)" filter="drop-shadow(0 10px 16px rgba(120,50,0,.35))">${g}</g></svg>`;
}

const PIP = {
  s: 'M50 4C60 22 95 38 95 62C95 76 85 85 72 85C64 85 57 81 54 75C55 84 59 91 67 96H33C41 91 45 84 46 75C43 81 36 85 28 85C15 85 5 76 5 62C5 38 40 22 50 4Z',
  h: 'M50 92C46 87 4 62 4 33C4 17 16 6 29 6C39 6 46 12 50 20C54 12 61 6 71 6C84 6 96 17 96 33C96 62 54 87 50 92Z',
  d: 'M50 3C61 20 74 36 90 50C74 64 61 80 50 97C39 80 26 64 10 50C26 36 39 20 50 3Z',
};
const pipAt = (k, x, y, size, fill) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100"><path d="${PIP[k]}" fill="${fill}"/></svg>`;
const card = (x, y, rot, rank, suit, red) => {
  const ink = red ? '#e5484d' : '#1b1d29';
  return `<g transform="rotate(${rot} ${x + 33} ${y + 92})"><rect x="${x}" y="${y}" width="66" height="94" rx="8" fill="#fff" filter="drop-shadow(0 6px 10px rgba(0,0,0,.3))"/>
  <text x="${x + 7}" y="${y + 19}" font-size="16" font-weight="700" fill="${ink}">${rank}</text>${pipAt(suit, x + 7, y + 23, 11, ink)}${pipAt(suit, x + 17, y + 38, 32, ink)}</g>`;
};
function solitaireArt() {
  const a = uid('la');
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" ${FONT} aria-hidden="true"><defs><radialGradient id="${a}" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#2fae67"/><stop offset="1" stop-color="#0b5b3a"/></radialGradient></defs>
    <rect width="320" height="200" fill="url(#${a})"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${24 + i * 44}" y="18" width="36" height="50" rx="6" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.5"/>`).join('')}
    ${pipAt('s', 32, 33, 20, 'rgba(255,255,255,.35)')}
    ${card(140, 64, -16, 'K', 'h', true)}${card(176, 56, -2, 'Q', 's', false)}${card(212, 60, 13, 'A', 'd', true)}</svg>`;
}

const KING = 'M50 27c-5 0-8.5 3-8.5 7 0 1.5.5 3 1.2 4.2C38.5 35 30 34.5 25 39c-6 5.5-3.5 14 5 28h40c8.5-14 11-22.5 5-28-5-4.5-13.5-4-17.7-.8.7-1.2 1.2-2.7 1.2-4.2 0-4-3.5-7-8.5-7zM32.5 74h35l3 7h-41zM30 67h40l-2.5 7h-35zM47 6h6v5.5h5.5v6H53V24h-6v-6.5h-5.5v-6H47zM22 81h56a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-3.5 3.5h-57A3.5 3.5 0 0 1 18 86.5V85a4 4 0 0 1 4-4z';
const PAWN = 'M42.5 49.5C42 61 36 71 28 81h44c-8-10-14-20-14.5-31.5zM37 44.5c0-3.4 5.8-6 13-6s13 2.6 13 6-5.8 6-13 6-13-2.6-13-6zM38.5 27a11.5 11.5 0 1 0 23 0a11.5 11.5 0 1 0-23 0zM22 81h56a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-3.5 3.5h-57A3.5 3.5 0 0 1 18 86.5V85a4 4 0 0 1 4-4z';
const piece = (d, x, y, s, fill, stroke) => `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 100 100"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/></svg>`;
function chessArt() {
  const a = uid('ca');
  let sq = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) if ((r + c) % 2) sq += `<rect x="${c * 32}" y="${120 + r * 20}" width="32" height="20" fill="#fff" fill-opacity=".12"/>`;
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" direction="ltr" aria-hidden="true"><defs><linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4b55"/><stop offset="1" stop-color="#17181d"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#${a})"/>${sq}
    ${piece(PAWN, 46, 84, 86, '#22232a', '#8e8f97')}${piece(KING, 104, 10, 160, '#fff', '#17181d')}${piece(PAWN, 222, 80, 92, '#fff', '#17181d')}</svg>`;
}

export const ART = { sudoku: sudokuArt, minesweeper: minesArt, g2048: g2048Art, solitaire: solitaireArt, chess: chessArt };

// ------------------------------------------------------------------ icons (60 × 60, full bleed)
const IC = (def, fill, inner) => `<svg viewBox="0 0 60 60" ${FONT} aria-hidden="true"><defs>${def || ''}</defs><rect width="60" height="60" fill="${fill}"/>${inner}</svg>`;
const grad = (id, a, b, vertical = false) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
export const ICONS = {
  sudoku: () => {
    const a = uid('si');
    let g = '<rect x="12" y="12" width="36" height="36" rx="7" fill="#fff"/>';
    for (let k = 1; k < 3; k++) g += `<path d="M${12 + k * 12} 14v32M14 ${12 + k * 12}h32" stroke="#cfd0d8" stroke-width="1.2"/>`;
    g += '<rect x="24" y="24" width="12" height="12" fill="#3e7bff"/>';
    [[18, 21.6, '5', '#1b1d29'], [30, 33.6, '7', '#fff'], [42, 45.6, '3', '#1b1d29'], [42, 21.6, '9', '#3e7bff']].forEach(([x, y, d, c]) => { g += `<text x="${x}" y="${y}" text-anchor="middle" font-size="10" font-weight="700" fill="${c}">${d}</text>`; });
    return IC(grad(a, '#3e7bff', '#7a4dff'), `url(#${a})`, g);
  },
  minesweeper: () => {
    const a = uid('mi');
    return IC(grad(a, '#4cd472', '#14904a', true), `url(#${a})`,
      '<circle cx="30" cy="31" r="11.5" fill="#1b1d29"/><path d="M30 14v34M13 31h34M18 19l24 24M42 19 18 43" stroke="#1b1d29" stroke-width="3.4" stroke-linecap="round"/><circle cx="26" cy="27" r="3.4" fill="#fff" fill-opacity=".75"/>');
  },
  g2048: () => {
    const a = uid('ti');
    return IC(grad(a, '#ffc94a', '#ff8a3d'), `url(#${a})`, '<rect x="9" y="15" width="42" height="30" rx="8" fill="#fff" fill-opacity=".22"/><text x="30" y="36.5" text-anchor="middle" font-size="17" font-weight="800" fill="#fff" letter-spacing="-.5">2048</text>');
  },
  solitaire: () => {
    const a = uid('li');
    return IC(`<radialGradient id="${a}" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#2fae67"/><stop offset="1" stop-color="#0b5b3a"/></radialGradient>`, `url(#${a})`,
      `<g transform="rotate(-12 24 32)"><rect x="12" y="15" width="24" height="33" rx="4" fill="#fff"/>${pipAt('s', 17, 24, 14, '#1b1d29')}</g><g transform="rotate(10 38 30)"><rect x="25" y="13" width="24" height="33" rx="4" fill="#fff" stroke="#0b5b3a" stroke-width=".8"/>${pipAt('h', 30, 22, 14, '#e5484d')}</g>`);
  },
  chess: () => {
    const a = uid('ci');
    return IC(grad(a, '#5a5b66', '#1b1c22', true), `url(#${a})`, piece(KING, 8, 7, 44, '#fff', '#1b1c22'));
  },
};

/** The banner artwork for a game. */
export const gameArt = (id) => (ART[id] ? ART[id]() : '');
/** The icon of a game (an SVG string; wrap it in .gm-ic for the squircle). */
export const gameIcon = (id) => (ICONS[id] ? ICONS[id]() : '');
