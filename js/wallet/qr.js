// QR Code encoder (ISO/IEC 18004): numeric, alphanumeric or byte (UTF-8) mode, error correction L/M/Q/H, versions
// 1–40 and the mask with the lowest penalty. Pure logic with no DOM, so the tests run it in plain Node.
// qrEncode(text, { ecl: 'M', minVersion, version, mask, boost }) → { size, version, ecl, mask, modules: Uint8Array }

const ECLS = ['L', 'M', 'Q', 'H'];
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
// error correction codewords per block and number of blocks, by level (L, M, Q, H) and version (index 0 unused)
const ECC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
export const QR_TABLES = { ECLS, ECC_PER_BLOCK, BLOCKS };
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
// mode indicator and character-count bits for versions 1–9, 10–26 and 27–40
const MODES = { num: [1, [10, 12, 14]], alnum: [2, [9, 11, 13]], byte: [4, [8, 16, 16]] };

/** Modules left for data and error correction once the function patterns are drawn. */
export function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const a = Math.floor(ver / 7) + 2; n -= (25 * a - 10) * a - 55; if (ver >= 7) n -= 36; }
  return n;
}
export const dataCodewords = (ver, ecl) => { const e = ECLS.indexOf(ecl); return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * BLOCKS[e][ver]; };
export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

// ---------------------------------------------------------------- Reed–Solomon over GF(256), polynomial 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 2);
  }
  return r;
}
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree), r = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

// ---------------------------------------------------------------- data bits
function utf8(s) { return Array.from(new TextEncoder().encode(s)); }
function modeOf(text) { return /^\d*$/.test(text) ? 'num' : [...text].every(c => ALNUM.includes(c)) ? 'alnum' : 'byte'; }
function segmentBits(text, mode) {
  const bits = [], put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  if (mode === 'num') for (let i = 0; i < text.length; i += 3) { const g = text.slice(i, i + 3); put(+g, g.length * 3 + 1); }
  else if (mode === 'alnum') for (let i = 0; i < text.length; i += 2) {
    const a = ALNUM.indexOf(text[i]);
    if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11); else put(a, 6);
  }
  else for (const b of utf8(text)) put(b, 8);
  return bits;
}
const countOf = (text, mode) => (mode === 'byte' ? utf8(text).length : text.length);
const cciBits = (mode, ver) => MODES[mode][1][ver < 10 ? 0 : ver < 27 ? 1 : 2];

/** Smallest version (and the bits) that holds the text at this level, or null when it's too long for version 40. */
function fit(text, ecl, minVer = 1, maxVer = 40) {
  const mode = modeOf(text), data = segmentBits(text, mode), n = countOf(text, mode);
  for (let v = minVer; v <= maxVer; v++) {
    const cci = cciBits(mode, v);
    if (n >= 1 << cci) continue;
    const used = 4 + cci + data.length;
    if (used <= dataCodewords(v, ecl) * 8) return { v, mode, data, n, cci };
  }
  return null;
}

// ---------------------------------------------------------------- matrix
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function drawFunctions(ver, size) {
  const mod = new Uint8Array(size * size), fn = new Uint8Array(size * size);
  const set = (x, y, d) => { mod[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = alignmentPositions(ver), n = al.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // the format areas are reserved now and filled in once the mask is known
  drawFormat(mod, fn, size, 'L', 0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const b = (bits >>> i) & 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, b); set(c, a, b);
    }
  }
  return { mod, fn };
}
export function formatBits(ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let r = data;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((data << 10) | r) ^ 0x5412;
}
function drawFormat(mod, fn, size, ecl, mask) {
  const bits = formatBits(ecl, mask), b = i => (bits >>> i) & 1;
  const set = (x, y, d) => { mod[y * size + x] = d; fn[y * size + x] = 1; };
  for (let i = 0; i <= 5; i++) set(8, i, b(i));
  set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
  set(8, size - 8, 1);
}

function placeData(mod, fn, size, bytes) {
  let i = 0;
  const total = bytes.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = up ? size - 1 - v : v, k = y * size + x;
      if (fn[k]) continue;
      mod[k] = i < total ? (bytes[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
      i++;
    }
  }
}

/** The penalty score of a finished matrix (lower is easier to scan): runs, 2×2 blocks, finder look-alikes, balance. */
export function penalty(mod, size) {
  let p = 0, dark = 0;
  const at = (x, y) => mod[y * size + x];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      // a finder look-alike is 1:1:3:1:1 with four light modules on one side; the quiet zone counts as light
      const line = [];
      for (let b = 0; b < size; b++) line.push(pass ? at(a, b) : at(b, a));
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      const L = b => (b < 0 || b >= size ? 0 : line[b]);
      for (let b = 0; b + 7 <= size; b++) {
        if (L(b) && !L(b + 1) && L(b + 2) && L(b + 3) && L(b + 4) && !L(b + 5) && L(b + 6)) {
          if (!L(b - 1) && !L(b - 2) && !L(b - 3) && !L(b - 4)) p += 40;
          if (!L(b + 7) && !L(b + 8) && !L(b + 9) && !L(b + 10)) p += 40;
        }
      }
    }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = at(x, y);
    if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
  }
  for (let i = 0; i < mod.length; i++) dark += mod[i];
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

export function qrEncode(text, { ecl = 'M', version, minVersion = 1, mask = -1, boost = true } = {}) {
  text = String(text ?? '');
  const f = fit(text, ecl, version || minVersion, version || 40);
  if (!f) return null;
  const ver = f.v;
  // a higher error correction level costs nothing when the data still fits the same version
  if (boost && !version) for (const e of ['M', 'Q', 'H']) if (ECLS.indexOf(e) > ECLS.indexOf(ecl) && fit(text, e, ver, ver)) ecl = e;
  const cap = dataCodewords(ver, ecl) * 8;
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(MODES[f.mode][0], 4); put(f.n, f.cci); bits.push(...f.data);
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // split into blocks, add error correction to each and interleave them
  const e = ECLS.indexOf(ecl), nb = BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8), nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += d.length;
    const ec = rsRemainder(d, eccLen);
    if (i < nShort) d.push(0);
    blocks.push(d.concat(ec));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]); });

  const size = ver * 4 + 17;
  const { mod, fn } = drawFunctions(ver, size);
  placeData(mod, fn, size, out);
  const masked = m => {
    const r = mod.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && MASKS[m](x, y)) r[y * size + x] ^= 1;
    drawFormat(r, fn.slice(), size, ecl, m);
    return r;
  };
  let best = mask, modules;
  if (best < 0) {
    let low = Infinity;
    for (let m = 0; m < 8; m++) { const r = masked(m), s = penalty(r, size); if (s < low) { low = s; best = m; modules = r; } }
  } else modules = masked(best);
  return { size, version: ver, ecl, mask: best, mode: f.mode, modules, codewords: out };
}
