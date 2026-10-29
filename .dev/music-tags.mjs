// Samsung Music tag reader in plain node: builds tagged files byte by byte (ID3v2.3/2.4/v1, FLAC, Ogg Vorbis/Opus,
// MP4/M4A, WAV LIST INFO) and checks js/music/tags.js reads them back. usage: node .dev/music-tags.mjs
import { readTags, guessFromPath, parseID3v2 } from '../js/music/tags.js';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ok', m)) : (fail++, console.log('FAIL', m)));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (${JSON.stringify(a)})`);

const enc = new TextEncoder();
const bytes = (...parts) => {
  const arrs = parts.map((p) => (typeof p === 'string' ? Uint8Array.from([...p].map((c) => c.charCodeAt(0) & 255)) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be24 = (n) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
const utf16 = (s) => {
  const u = new Uint8Array(2 + s.length * 2);
  u[0] = 0xff;
  u[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    u[2 + i * 2] = s.charCodeAt(i) & 255;
    u[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return u;
};
// a tiny "PNG" (only the signature matters to the reader, it needs > 64 bytes)
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Uint8Array(120).fill(7));
const file = (u8, name) => new File([u8], name);

// ——— ID3v2.3 (Latin-1 + UTF-16 frames, lyrics, picture) ———
{
  const frame = (id, body) => bytes(id, be32(body.length), [0, 0], body);
  const text = (s) => bytes([0], s);
  const frames = bytes(
    frame('TIT2', text('Night Shift')),
    frame('TPE1', bytes([1], utf16('Neon Coast'))),
    frame('TALB', text('City Lights')),
    frame('TRCK', text('3/10')),
    frame('TPOS', text('1/2')),
    frame('TCON', text('(17)')),
    frame('TYER', text('2019')),
    frame('TPE2', text('Neon Coast Band')),
    frame('USLT', bytes([0], 'eng', [0], '[00:01.00]Hello\n[00:03.50]World')),
    frame('APIC', bytes([0], 'image/png', [0], [3], 'cover', [0], PNG)),
  );
  const tag = bytes('ID3', [3, 0, 0], syncsafe(frames.length), frames);
  const t = await readTags(file(bytes(tag, new Uint8Array(400)), 'a.mp3'));
  eq([t.title, t.artist, t.album, t.track, t.trackTotal, t.disc, t.genre, t.year, t.albumArtist], ['Night Shift', 'Neon Coast', 'City Lights', 3, 10, 1, 'Rock', 2019, 'Neon Coast Band'], 'ID3v2.3 text frames');
  ok(t.lyrics?.includes('[00:03.50]World'), 'ID3v2.3 USLT lyrics');
  ok(t.picture?.mime === 'image/png' && t.picture.data.length === PNG.length, 'ID3v2.3 APIC cover');
}

// ——— ID3v2.4 (UTF-8, syncsafe frame sizes, several values) ———
{
  const frame = (id, body) => bytes(id, syncsafe(body.length), [0, 0], body);
  const u8 = (s) => bytes([3], enc.encode(s));
  const frames = bytes(frame('TIT2', u8('أغنية الليل')), frame('TPE1', u8('Ana\u0000Bo')), frame('TDRC', u8('2021-05-01')), frame('TCON', u8('Jazz')));
  const tag = bytes('ID3', [4, 0, 0], syncsafe(frames.length), frames);
  const t = parseID3v2(tag);
  eq([t.title, t.artist, t.year, t.genre], ['أغنية الليل', 'Ana, Bo', 2021, 'Jazz'], 'ID3v2.4 UTF-8, multiple values');
}

// ——— ID3v1 at the end of a file ———
{
  const pad = (s, n) => bytes(s, new Uint8Array(n - s.length));
  const v1 = bytes('TAG', pad('Old Song', 30), pad('Old Band', 30), pad('Old Album', 30), '1999', new Uint8Array(28), [0, 7], [13]);
  const t = await readTags(file(bytes(new Uint8Array(500).fill(0xff), v1), 'b.mp3'));
  eq([t.title, t.artist, t.album, t.year, t.track, t.genre], ['Old Song', 'Old Band', 'Old Album', 1999, 7, 'Pop'], 'ID3v1');
}

// ——— Vorbis comment block shared by FLAC and Ogg ———
const vorbis = (list) => bytes(le32(6), 'Bloom!', le32(list.length), ...list.map((c) => {
  const b = enc.encode(c);
  return bytes(le32(b.length), b);
}));

// ——— FLAC ———
{
  const vc = vorbis(['TITLE=Paper Boats', 'ARTIST=Mara Sol', 'ALBUM=Harbor', 'TRACKNUMBER=2', 'TRACKTOTAL=9', 'GENRE=Folk', 'DATE=2020', 'LYRICS=la la la']);
  const pic = bytes(be32(3), be32(9), 'image/png', be32(0), be32(0), be32(0), be32(0), be32(0), be32(PNG.length), PNG);
  const streaminfo = new Uint8Array(34);
  const flac = bytes('fLaC', [0], be24(34), streaminfo, [4], be24(vc.length), vc, [0x80 | 6], be24(pic.length), pic, new Uint8Array(100));
  const t = await readTags(file(flac, 'c.flac'));
  eq([t.title, t.artist, t.album, t.track, t.trackTotal, t.genre, t.year, t.lyrics], ['Paper Boats', 'Mara Sol', 'Harbor', 2, 9, 'Folk', 2020, 'la la la'], 'FLAC Vorbis comments');
  ok(t.picture?.mime === 'image/png', 'FLAC PICTURE block');
}

// ——— Ogg (Vorbis and Opus comment headers) ———
const oggPage = (packets, seq) => {
  const segs = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      segs.push(255);
      n -= 255;
    }
    segs.push(n);
  }
  return bytes('OggS', [0, seq ? 0 : 2], new Uint8Array(8), le32(1), le32(seq), le32(0), [segs.length], segs, ...packets);
};
{
  const ident = bytes([1], 'vorbis', new Uint8Array(23));
  const comment = bytes([3], 'vorbis', vorbis(['TITLE=Tide', 'ARTIST=Wave Co', 'ALBUM=Sea']), [1]);
  const t = await readTags(file(bytes(oggPage([ident], 0), oggPage([comment], 1), new Uint8Array(50)), 'd.ogg'));
  eq([t.title, t.artist, t.album], ['Tide', 'Wave Co', 'Sea'], 'Ogg Vorbis comments');
  const opusHead = bytes('OpusHead', new Uint8Array(11));
  const opusTags = bytes('OpusTags', vorbis(['TITLE=Opus Song', 'ARTIST=Op']));
  const t2 = await readTags(file(bytes(oggPage([opusHead], 0), oggPage([opusTags], 1)), 'e.opus'));
  eq([t2.title, t2.artist], ['Opus Song', 'Op'], 'Ogg Opus tags');
}

// ——— MP4 / M4A ———
{
  const atom = (type, ...body) => {
    const b = bytes(...body);
    return bytes(be32(b.length + 8), type, b);
  };
  const data = (type, payload) => atom('data', be32(type), be32(0), payload);
  const ilst = atom('ilst',
    atom('©nam', data(1, enc.encode('Mp4 Title'))),
    atom('©ART', data(1, enc.encode('Mp4 Artist'))),
    atom('©alb', data(1, enc.encode('Mp4 Album'))),
    atom('trkn', data(0, [0, 0, 0, 4, 0, 12, 0, 0])),
    atom('©day', data(1, enc.encode('2018'))),
    atom('covr', data(14, PNG)));
  const meta = atom('meta', [0, 0, 0, 0], atom('hdlr', new Uint8Array(25)), ilst);
  const mp4 = bytes(atom('ftyp', 'M4A ', [0, 0, 0, 0]), atom('moov', atom('udta', meta)), atom('mdat', new Uint8Array(30)));
  const t = await readTags(file(mp4, 'f.m4a'));
  eq([t.title, t.artist, t.album, t.track, t.trackTotal, t.year], ['Mp4 Title', 'Mp4 Artist', 'Mp4 Album', 4, 12, 2018], 'MP4 ilst atoms');
  ok(t.picture?.mime === 'image/png', 'MP4 covr');
}

// ——— WAV LIST/INFO ———
{
  const sub = (k, v) => {
    const b = bytes(enc.encode(v), [0]);
    return bytes(k, le32(b.length), b, b.length & 1 ? [0] : []);
  };
  const info = bytes('INFO', sub('INAM', 'Wav Song'), sub('IART', 'Wav Band'), sub('IPRD', 'Wav Album'), sub('IGNR', 'Ambient'), sub('ITRK', '5'));
  const fmt = bytes('fmt ', le32(16), new Uint8Array(16));
  const wav = bytes('RIFF', le32(4 + fmt.length + 8 + info.length + 8), 'WAVE', fmt, 'LIST', le32(info.length), info, 'data', le32(0));
  const t = await readTags(file(wav, 'g.wav'));
  eq([t.title, t.artist, t.album, t.genre, t.track], ['Wav Song', 'Wav Band', 'Wav Album', 'Ambient', 5], 'WAV LIST INFO');
}

// ——— broken and untagged files never throw ———
{
  const t = await readTags(file(bytes('ID3', [3, 0, 0], [0x7f, 0x7f, 0x7f, 0x7f], 'garbage'), 'h.mp3'));
  ok(typeof t === 'object', 'broken ID3 does not throw');
  const t2 = await readTags(file(new Uint8Array(10), 'i.mp3'));
  eq(t2, {}, 'untagged file gives no tags');
}

// ——— names and folders ———
eq(guessFromPath('Neon Coast/Night Shift/03 - Neon Coast - City Lights.mp3'), { track: 3, artist: 'Neon Coast', title: 'City Lights', album: 'Night Shift' }, 'guess from path with artist in the name');
eq(guessFromPath('Mara Sol/Harbor/01 Morning_Tide.flac'), { track: 1, title: 'Morning Tide', album: 'Harbor', artist: 'Mara Sol' }, 'guess from folders');
eq(guessFromPath('song.mp3'), { title: 'song' }, 'bare file name');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
