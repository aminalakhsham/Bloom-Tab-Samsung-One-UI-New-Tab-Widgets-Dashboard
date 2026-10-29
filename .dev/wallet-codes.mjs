// Wallet barcode encoders against known vectors and independent decoders (plain Node, no browser):
//   node .dev/wallet-codes.mjs
// - QR Code: Reed–Solomon codewords of Thonky's "HELLO WORLD" 1-Q example, byte capacities and alignment positions from
//   the standard's tables, the format and version information tables, and module matrices for every mask compared
//   with BWIPP (bwip-js 4.5.1, computed once and kept here as SHA-256 prefixes). A decoder written for this test reads
//   500 random symbols back (format, unmasking, de-interleaving, RS syndromes, segments).
// - Code 128: the pattern table's own invariants, check values, BWIPP's modules, and random round trips.
// - EAN-13 / UPC-A: check digits of well-known numbers and BWIPP's modules.
// - PDF417: the cluster invariant of all 2,787 patterns, layouts compared with BWIPP for the same codewords, and a
//   decoder that checks the row indicators and GF(929) syndromes and reads the text back.
import crypto from 'crypto';
import { qrEncode, rsRemainder, dataCodewords as qrData, alignmentPositions, formatBits, rawModules, penalty, QR_TABLES } from '../js/wallet/qr.js';
import { code128, code128Values, C128, ean13, upca, gtinCheck } from '../js/wallet/linear.js';
import { pdf417Encode, pdf417Layout, pdf417Clusters, dataCodewords as pdfData, ecCodewords } from '../js/wallet/pdf417.js';

let fails = 0, oks = 0;
const ok = (c, what) => { if (c) { oks++; console.log('ok  ', what); } else { fails++; console.log('FAIL', what); } };
const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const rnd = (() => { let a = 20261016; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const pick = s => { const a = Array.from(s); return a[Math.floor(rnd() * a.length)]; };

// ================================================================ QR Code
// Thonky's worked example: "HELLO WORLD", alphanumeric, version 1-Q
const hw = qrEncode('HELLO WORLD', { ecl: 'Q', boost: false, mask: 0 });
ok(hw.version === 1 && hw.mode === 'alnum', 'HELLO WORLD fits version 1-Q in alphanumeric mode');
ok(hw.codewords.join(',') === '32,91,11,120,209,114,220,77,67,64,236,17,236,168,72,22,82,217,54,156,0,46,15,180,122,16', 'HELLO WORLD 1-Q data and error correction codewords match the worked example');
ok(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13).join(',') === '168,72,22,82,217,54,156,0,46,15,180,122,16', 'Reed–Solomon remainder of the example');

// byte-mode capacities from the standard (versions 1–7, 10 and 40; L M Q H)
const CAP = { 1: [17, 14, 11, 7], 2: [32, 26, 20, 14], 3: [53, 42, 32, 24], 4: [78, 62, 46, 34], 5: [106, 84, 60, 44], 6: [134, 106, 74, 58], 7: [154, 122, 86, 64], 10: [271, 213, 151, 119], 40: [2953, 2331, 1663, 1273] };
let capOk = true;
for (const [v, caps] of Object.entries(CAP)) ['L', 'M', 'Q', 'H'].forEach((e, i) => {
  const cci = +v < 10 ? 8 : 16;
  if (Math.floor((qrData(+v, e) * 8 - 4 - cci) / 8) !== caps[i]) { capOk = false; console.log('  capacity', v, e, qrData(+v, e)); }
});
ok(capOk, 'byte capacities match the standard for versions 1–7, 10 and 40');
const ALIGN = { 2: [6, 18], 7: [6, 22, 38], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 24: [6, 28, 54, 80, 106], 28: [6, 26, 50, 74, 98, 122], 30: [6, 26, 52, 78, 104, 130], 32: [6, 34, 60, 86, 112, 138], 36: [6, 24, 50, 76, 102, 128, 154], 39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170] };
ok(Object.entries(ALIGN).every(([v, p]) => alignmentPositions(+v).join() === p.join()), 'alignment pattern positions match the standard table');
const FMT = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
  Q: ['011010101011111', '011000001101000', '011111100110001', '011101000000110', '010010010110100', '010000110000011', '010111011011010', '010101111101101'],
  H: ['001011010001001', '001001110111110', '001110011100111', '001100111010000', '000011101100010', '000001001010101', '000110100001100', '000100000111011'],
};
ok(Object.entries(FMT).every(([e, list]) => list.every((b, m) => formatBits(e, m) === parseInt(b, 2))), 'format information matches the standard table (4 levels × 8 masks)');
// version information of version 7 (0x07C94) read back from the bottom-left block
const v7 = qrEncode('x'.repeat(100), { ecl: 'L', version: 7, mask: 0 });
let vbits = 0;
for (let i = 0; i < 18; i++) vbits |= v7.modules[(v7.size - 11 + (i % 3)) * v7.size + Math.floor(i / 3)] << i;
ok(vbits === 0x07c94, 'version 7 information is 0x07C94');

// module matrices compared with BWIPP for each forced mask
const REF = [
  ['HELLO WORLD', 'Q', 1, ['98ee3af8dfb46e027fa18006', '686130b04cbcb1279b58ad29', '4dc45c617526832276567e89', '8f553255f4cdaf1651a38816', 'ae4f8b554a052f47e8c20d43', 'c663e622b14db51145cbffd6', 'a3e78d2b19b36fb0f9afc4d6', '6f5bddd130ae36d928e9ec3b']],
  ['https://www.apple.com/wallet/', 'M', 3, ['46a36d95216170875a4d84a1', '9190d693c1b1e040bb28b2d1', '93720a571739d823f6158a86', '604c0ff4b5fa543901742e38', '6bf856ba15bcaf7273974285', 'f9879b5e13f59bbe301b2527', 'd88163928bde1c74f348b083', '152c480c2141d09255db1e66']],
  ['x'.repeat(200), 'M', 10, ['750d745db4aee09b5c9b6974', '9ff2474eb4806262b05e70f5', 'c8294f9a437b1546845ed5dd', '1bf4d13e40b47c5fe1496e3d', 'fdce0323024df96375a5d061', '87c3d49925e758349c466e67', 'b719f9e8d1b0dd894bbf6bb0', '342f8ed98624303981f3e349']],
  ['z'.repeat(1200), 'L', 25, ['2735c6522e7e4c9be56a3c5f', 'c83593d57ae2748b5544f990', '05bb49f0bbd7670167cbd3d6', 'e3c42bb6892ef9c47e59cf96', 'c075f0b1f3863d7c2de551db', '0607574eda53f591df48a9ce', '00617501c84778fada06a2b0', '5e2efb6409606b435cabbe30']],
  ['0'.repeat(3000), 'H', 40, ['330f52d24019ecd9a4919f5d', 'f391d0fe6bbc482aef971c27', '7388717dba265192b0c16e50', '1902e429b7d48688f719fb82', '0cb6b8dcab44d158bd657e0a', '11b3371c959bf6dd9769f173', '858727f4e50a910c700ee080', '7b9a1768d5928e656bd723b2']],
  ['Member #48213 — café', 'H', 3, ['2c7b5613339c918ba0f6ec39', '5c6327a4d5c46d7e8dafac56', '0ad986fdabdd1edeee95ae67', '00ff314dd2d79e6c8d0ba50a', 'b64ae0325679f0d2669566c6', '6e073f748cb95f62f8a458cf', 'b6272a54349fd6cee011dbc3', '013433c0b393f23d6451864a']],
  ['01234567890123456789', 'L', 1, ['c54cad512f5db5a77b4c15e1', '064874c7ff41d5662f3f8248', 'c262bbaea8433fb032c9973c', 'a23886cf3bd12e716352f261', '5ce75319d8f8b087168e2878', 'e91147de8311af07bacdf479', '867d7cfd4e23ab3b20ab5fcc', '5d36720c216a2ed63dab4945']],
];
for (const [text, e, v, hashes] of REF) {
  const got = hashes.map((_, m) => qrEncode(text, { ecl: e, boost: false, mask: m }));
  ok(got.every(q => q.version === v) && got.every((q, m) => h(q.modules.join('')) === hashes[m]), `QR ${JSON.stringify(text.slice(0, 24))}${text.length > 24 ? '…' : ''} ${v}-${e}: all 8 masked matrices match BWIPP`);
}
// the whole HELLO WORLD symbol with mask 6 (BWIPP's mask 7, counted from 1), as BWIPP draws it
const ART = ['#######....#..#######', '#.....#.##..#.#.....#', '#.###.#..#.##.#.###.#', '#.###.#.#####.#.###.#', '#.###.#.##.#..#.###.#', '#.....#..#..#.#.....#', '#######.#.#.#.#######', '........##.##........', '.#.####.##..###.##.#.', '#.####.#....####.###.', '..#.#.##...#..##.....', '#.##.#...#.##...##...', '##.########.###.#####', '........#...#..#.#...', '#######..##..##..####', '#.....#.#.#..#..#.###', '#.###.#.##.#..#...###', '#.###.#.#.###...#.#..', '#.###.#..#....#....##', '#.....#.###..###..##.', '#######..#.#.......#.'];
const hw7 = qrEncode('HELLO WORLD', { ecl: 'Q', boost: false, mask: 6 });
ok(ART.join('') === [...hw7.modules].map(b => (b ? '#' : '.')).join(''), 'HELLO WORLD 1-Q mask 6 module by module');
// the automatic mask is the one with the lowest penalty
const auto = qrEncode('https://www.apple.com/wallet/', { ecl: 'M' });
const scores = Array.from({ length: 8 }, (_, m) => penalty(qrEncode('https://www.apple.com/wallet/', { ecl: auto.ecl, mask: m }).modules, auto.size));
ok(scores[auto.mask] === Math.min(...scores), `automatic mask ${auto.mask} has the lowest penalty (${scores.join(' ')})`);
ok(qrEncode('Liquid Tab', { ecl: 'L' }).ecl === 'Q' && qrEncode('Liquid Tab', { ecl: 'L' }).version === 1, 'a short text is boosted to the highest level that fits the same version (1-Q)');
ok(qrEncode('x'.repeat(2954), { ecl: 'L' }) === null && qrEncode('x'.repeat(2953), { ecl: 'L' })?.version === 40, 'byte mode: 2,953 bytes fit version 40-L, 2,954 don\'t');

// ---------------------------------------------------------------- QR decoder written for this test
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const MASKF = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
function qrDecode(mod, size) {
  const ver = (size - 17) / 4, at = (x, y) => mod[y * size + x];
  let f = 0;
  for (let i = 0; i <= 5; i++) f |= at(8, i) << i;
  f |= at(8, 7) << 6 | at(8, 8) << 7 | at(7, 8) << 8;
  for (let i = 9; i < 15; i++) f |= at(14 - i, 8) << i;
  let f2 = 0;
  for (let i = 0; i < 8; i++) f2 |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) f2 |= at(8, size - 15 + i) << i;
  if (f !== f2) throw new Error('format copies differ');
  const ecl = Object.keys(FMT).find(e => FMT[e].some(b => parseInt(b, 2) === f));
  if (!ecl) throw new Error('bad format ' + f.toString(2));
  const mask = FMT[ecl].findIndex(b => parseInt(b, 2) === f);
  const al = ver > 1 ? alignmentPositions(ver) : [];
  const isFn = (x, y) => (x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8) || x === 6 || y === 6
    || (ver >= 7 && ((x >= size - 11 && x < size - 8 && y < 6) || (y >= size - 11 && y < size - 8 && x < 6)))
    || al.some((ax, i) => al.some((ay, j) => !((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2));
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!isFn(x, y)) bits.push(at(x, y) ^ (MASKF[mask](x, y) ? 1 : 0));
    }
  }
  const total = Math.floor(bits.length / 8);
  if (total !== Math.floor(rawModules(ver) / 8)) throw new Error('codeword count');
  const cw = Array.from({ length: total }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  const e = QR_TABLES.ECLS.indexOf(ecl), nb = QR_TABLES.BLOCKS[e][ver], ecc = QR_TABLES.ECC_PER_BLOCK[e][ver];
  const nShort = nb - (total % nb), shortLen = Math.floor(total / nb);
  const blocks = Array.from({ length: nb }, (_, i) => new Array(shortLen + (i < nShort ? 0 : 1)));
  let k = 0;
  for (let i = 0; i < shortLen - ecc + 1; i++) for (let b = 0; b < nb; b++) if (i < shortLen - ecc || b >= nShort) blocks[b][i] = cw[k++];
  for (let i = 0; i < ecc; i++) for (let b = 0; b < nb; b++) blocks[b][blocks[b].length - ecc + i] = cw[k++];
  const data = [];
  for (const b of blocks) {
    // every root α^0 … α^(ecc-1) of the generator must be a root of the received block
    for (let r = 0; r < ecc; r++) { let s = 0; for (const c of b) s = gmul(s, EXP[r]) ^ c; if (s) throw new Error('syndrome'); }
    data.push(...b.slice(0, b.length - ecc));
  }
  const db = data.flatMap(c => Array.from({ length: 8 }, (_, i) => (c >>> (7 - i)) & 1));
  let p = 0;
  const read = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | db[p++]; return v; };
  const mode = read(4), ccw = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] }[mode]?.[ver < 10 ? 0 : ver < 27 ? 1 : 2];
  if (!ccw) throw new Error('mode ' + mode);
  const n = read(ccw);
  let out = '';
  if (mode === 1) { for (let i = 0; i < n; i += 3) { const g = Math.min(3, n - i); out += String(read(g * 3 + 1)).padStart(g, '0'); } }
  else if (mode === 2) { for (let i = 0; i < n; i += 2) { if (i + 1 < n) { const v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; } else out += ALNUM[read(6)]; } }
  else out = new TextDecoder().decode(Uint8Array.from({ length: n }, () => read(8)));
  return { text: out, ecl, mask };
}
ok(qrDecode(hw7.modules, hw7.size).text === 'HELLO WORLD', 'the test decoder reads HELLO WORLD');
const ALPH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:#@!?é€ü✓مرحبا中文😀';
let qrBad = 0, vers = new Set();
for (let i = 0; i < 500; i++) {
  const len = Math.floor(rnd() ** 3 * 900) + 1, kind = rnd();
  const s = kind < .2 ? Array.from({ length: len }, () => pick('0123456789')).join('') : kind < .4 ? Array.from({ length: len }, () => pick(ALNUM)).join('') : Array.from({ length: len }, () => pick(ALPH)).join('');
  const e = pick(['L', 'M', 'Q', 'H']);
  const q = qrEncode(s, { ecl: e });
  if (!q) continue;
  vers.add(q.version);
  try { const d = qrDecode(q.modules, q.size); if (d.text !== s || d.ecl !== q.ecl || d.mask !== q.mask) throw new Error('mismatch'); }
  catch (err) { qrBad++; if (qrBad < 4) console.log('  qr round trip', err.message, e, q.version, JSON.stringify(s.slice(0, 30))); }
}
ok(qrBad === 0, `500 random QR codes decode back (numeric, alphanumeric, UTF-8; ${vers.size} versions up to ${Math.max(...vers)})`);

// ================================================================ Code 128
ok(C128.length === 107 && C128.slice(0, 106).every(p => p.length === 6 && [...p].reduce((a, b) => a + +b, 0) === 11) && C128[106] === '2331112', 'Code 128: 106 symbols of 11 modules and the 13-module Stop');
ok(C128.every(p => [...p].filter((_, i) => i % 2 === 0).reduce((a, b) => a + +b, 0) % 2 === 0), 'Code 128: every symbol has an even number of bar modules (the parity rule)');
ok(new Set(C128).size === 107, 'Code 128: all patterns differ');
ok(code128Values('Wikipedia').join(',') === '104,55,73,75,73,80,69,68,73,65,88,106', 'Code 128 "Wikipedia": set B values and check value 88');
ok(code128Values('123456').join(',') === '105,12,34,56,44,106', 'Code 128 "123456": set C pairs and check value 44');
ok(code128Values('ABC12345').join(',') === '104,33,34,35,17,99,23,45,90,106', 'Code 128 "ABC12345": an odd run keeps one digit in set B before Code C');
ok(code128Values('12345ABC').join(',') === '105,12,34,100,21,33,34,35,50,106', 'Code 128 "12345ABC": starts in set C, Code B for the rest');
ok(code128('Café') === null && code128('') === null, 'Code 128 refuses text outside printable ASCII');
const C128REF = [['Wikipedia', 'a0ff0d82ef4d34c18b8d9dcd'], ['123456', '44e994755f624596c23828f4'], ['ABC123456', 'fc0216985215489583c6752e'], ['ABC12345', 'aafed300981d3bd7e7e8185e'], ['12345ABC', '5bd1c8577134d573cb653afe'], ['A123456B', '749f1b6cf6a72dba767d025e'], ['ab1234567890', 'ab6c7ed9b53b86bda2a7e741']];
ok(C128REF.every(([s, hh]) => h(code128(s).modules) === hh), 'Code 128 modules match BWIPP for 7 texts');
function c128Decode(mods) {
  const v = [];
  for (let i = 0; i + 11 <= mods.length - 13; i += 11) {
    const chunk = mods.slice(i, i + 11), w = [];
    let run = 1;
    for (let j = 1; j <= 11; j++) { if (j < 11 && chunk[j] === chunk[j - 1]) run++; else { w.push(run); run = 1; } }
    const idx = C128.indexOf(w.join(''));
    if (idx < 0) throw new Error('bad symbol');
    v.push(idx);
  }
  let sum = v[0];
  for (let k = 1; k < v.length - 1; k++) sum += k * v[k];
  if (sum % 103 !== v.at(-1)) throw new Error('check');
  let set = v[0] === 105 ? 'C' : 'B', out = '';
  for (const x of v.slice(1, -1)) {
    if (set === 'C') { if (x === 100) set = 'B'; else out += String(x).padStart(2, '0'); }
    else if (x === 99) set = 'C'; else out += String.fromCharCode(x + 32);
  }
  return out;
}
let cBad = 0;
for (let i = 0; i < 400; i++) {
  const s = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => (rnd() < .5 ? pick('0123456789') : String.fromCharCode(32 + Math.floor(rnd() * 95)))).join('');
  try { if (c128Decode(code128(s).modules) !== s) throw new Error('text'); } catch (e) { cBad++; if (cBad < 4) console.log('  c128', e.message, JSON.stringify(s)); }
}
ok(cBad === 0, '400 random Code 128 texts decode back with a valid check value');

// ================================================================ EAN-13 / UPC-A
ok(gtinCheck('400638133393') === '1' && gtinCheck('978030640615') === '7' && gtinCheck('590123412345') === '7', 'EAN-13 check digits (4006381333931, 9780306406157, 5901234123457)');
ok(gtinCheck('03600029145') === '2' && upca('03600029145').text === '036000291452', 'UPC-A check digit (036000291452)');
ok(ean13('4006381333932') === null && ean13('4006381333931')?.text === '4006381333931', 'EAN-13 refuses a wrong check digit');
ok(ean13('400638133393').modules.length === 95, 'EAN-13 is 95 modules wide');
const EANREF = [['ean13', '400638133393', 'ac4eb5eb89cc0156d746c8a1'], ['ean13', '978030640615', 'ba4fbf7963658dbfa3a75e4d'], ['upca', '03600029145', 'a8e8668c61e8e592b1b44aae']];
ok(EANREF.every(([k, s, hh]) => h((k === 'upca' ? upca : ean13)(s).modules) === hh), 'EAN-13 and UPC-A modules match BWIPP');

// ================================================================ PDF417
const CL = pdf417Clusters();
const clOk = CL.every((list, k) => list.length === 929 && new Set(list).size === 929 && list.every(p => {
  const b = p.toString(2);
  if (b.length !== 17 || b[0] !== '1' || b[16] !== '0') return false;
  const w = b.match(/1+|0+/g).map(x => x.length);
  return w.length === 8 && w.every(x => x <= 6) && ((w[0] - w[2] + w[4] - w[6] + 9) % 9) === 3 * k;
}));
ok(clOk, 'PDF417: 3 × 929 patterns of 4 bars and 4 spaces (≤ 6 modules) in clusters 0, 3 and 6');
const PDFREF = [['M1DOE/JANE EABC123 SFOJFKUA 0123 290Y012A0001 100', 4, 2, 10, '29fc177c0f382e34638fb7db'], ['HELLO WORLD', 1, 2, 16, '649aebbcfe6cf50b26766a79'], ['Liquid Tab ✓ café', 2, 3, 18, 'd1ec29ea59c9a735c12bee6b'], ['x'.repeat(300), 8, 5, 28, 'ff9abf93c99d5490e3be3151']];
ok(PDFREF.every(([s, c, e, rows, hh]) => { const p = pdf417Layout(pdfData(s), { cols: c, ecLevel: e }); return p.rows === rows && h(p.bits.join('')) === hh; }), 'PDF417 layouts (padding, error correction, row indicators) match BWIPP for 4 symbols');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ', LOWER = 'abcdefghijklmnopqrstuvwxyz ', MIXED = '0123456789&\r\t,:#-.$/+%*=^', PUNCT = ';<>@[\\]_`~!\r\t,:\n-.$/"|*()?{}\'';
function pdfDecode(p) {
  const rev = CL.map(c => new Map(c.map((x, v) => [x, v])));
  const cw = [];
  for (let y = 0; y < p.rows; y++) {
    const row = p.bits.slice(y * p.width, (y + 1) * p.width).join('');
    const get = x => rev[y % 3].get(parseInt(row.slice(x, x + 17), 2));
    const left = get(17), right = get(17 + 17 * (p.cols + 1));
    if (left == null || right == null) throw new Error('row indicator');
    const exp = [[Math.floor((p.rows - 1) / 3), p.cols - 1], [p.ecLevel * 3 + ((p.rows - 1) % 3), Math.floor((p.rows - 1) / 3)], [p.cols - 1, p.ecLevel * 3 + ((p.rows - 1) % 3)]][y % 3];
    if (left % 30 !== exp[0] || right % 30 !== exp[1] || Math.floor(left / 30) !== Math.floor(y / 3)) throw new Error('indicator value');
    for (let c = 0; c < p.cols; c++) { const v = get(34 + 17 * c); if (v == null) throw new Error('codeword'); cw.push(v); }
  }
  // C(x) = Σ cw·x^(n-1-i) vanishes at 3^1 … 3^k
  const k = 2 ** (p.ecLevel + 1);
  for (let j = 1, a = 3; j <= k; j++, a = (a * 3) % 929) { let s = 0; for (const c of cw) s = (s * a + c) % 929; if (s) throw new Error('syndrome'); }
  const n = cw[0], data = cw.slice(1, n);
  let out = '', sub = 'A', shift = null, mode = 'text', bytes = [];
  const flush = () => { if (bytes.length) { out += new TextDecoder().decode(Uint8Array.from(bytes)); bytes = []; } };
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 900) { flush(); mode = 'text'; sub = 'A'; continue; }
    if (c === 901 || c === 924) {
      // with 901 the last group (1 to 5 codewords) is one byte each; every other group of 5 holds 6 bytes
      const rest = data.slice(i + 1).findIndex(x => x >= 900), m = rest < 0 ? data.length - i - 1 : rest;
      const packed = c === 924 ? m : m - (m % 5 || 5);
      for (let j = 0; j < packed; j += 5) { let v = 0; for (let q = 0; q < 5; q++) v = v * 900 + data[i + 1 + j + q]; const g = []; for (let q = 0; q < 6; q++) { g.unshift(v % 256); v = Math.floor(v / 256); } bytes.push(...g); }
      for (let j = packed; j < m; j++) bytes.push(data[i + 1 + j]);
      i += m;
      continue;
    }
    for (const v of [Math.floor(c / 30), c % 30]) {
      const s = shift || sub; shift = null;
      if (s === 'A') { if (v < 26) out += ALPHA[v]; else if (v === 26) out += ' '; else if (v === 27) sub = 'L'; else if (v === 28) sub = 'M'; else shift = 'P'; }
      else if (s === 'L') { if (v < 26) out += LOWER[v]; else if (v === 26) out += ' '; else if (v === 27) shift = 'A'; else if (v === 28) sub = 'M'; else shift = 'P'; }
      else if (s === 'M') { if (v < 25) out += MIXED[v]; else if (v === 25) sub = 'P'; else if (v === 26) out += ' '; else if (v === 27) sub = 'L'; else if (v === 28) sub = 'A'; else shift = 'P'; }
      else { if (v < 29) out += PUNCT[v]; else sub = 'A'; }
    }
  }
  flush();
  return out;
}
const bp = pdf417Encode('M1DOE/JANE EABC123 SFOJFKUA 0123 290Y012A0001 100');
ok(pdfDecode(bp) === 'M1DOE/JANE EABC123 SFOJFKUA 0123 290Y012A0001 100' && bp.width === 17 * bp.cols + 69, `PDF417 boarding pass data decodes back (${bp.cols} columns × ${bp.rows} rows, level ${bp.ecLevel})`);
const TXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 &,:#-.$/+%*=^;<>@[\\]_`~!"|()?{}\'\n';
let pBad = 0;
for (let i = 0; i < 400; i++) {
  const s = Array.from({ length: 1 + Math.floor(rnd() ** 2 * 300) }, () => (rnd() < .15 ? pick(ALPH) : pick(TXT))).join('');
  try { const p = pdf417Encode(s); if (pdfDecode(p) !== s) throw new Error('text'); } catch (e) { pBad++; if (pBad < 4) console.log('  pdf417', e.message, JSON.stringify(s.slice(0, 40))); }
}
ok(pBad === 0, '400 random PDF417 symbols (text and byte compaction) decode back');
ok(ecCodewords([5, 453, 178, 121, 239], 1).length === 4, 'PDF417 level 1 gives 4 error correction codewords');

console.log(`\n${oks} ok, ${fails} failed`);
console.log(fails ? 'FAIL' : 'PASS');
process.exitCode = fails ? 1 : 0;
