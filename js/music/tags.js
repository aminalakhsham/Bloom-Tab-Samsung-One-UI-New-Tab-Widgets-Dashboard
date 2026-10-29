// Samsung Music: reads track details on the device — ID3v1/v2 (MP3, WAV), MP4/M4A atoms, FLAC and Ogg
// (Vorbis/Opus) comments, WAV LIST/INFO. Returns title, artist, album, numbers, embedded cover and lyrics.
// Pure JS with no DOM, so .dev/music-tags.mjs runs it in plain node. Ported from Liquid Tab's reader.

const GENRES = ('Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|AlternRock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock|Folk|Folk-Rock|National Folk|Swing|Fast Fusion|Bebop|Latin|Revival|Celtic|Bluegrass|Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|Easy Listening|Acoustic|Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|Satire|Slow Jam|Club|Tango|Samba|Folklore|Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A Cappella|Euro-House|Dance Hall|Goa|Drum & Bass|Club-House|Hardcore|Terror|Indie|BritPop|Afro-Punk|Polsk Punk|Beat|Christian Gangsta Rap|Heavy Metal|Black Metal|Crossover|Contemporary Christian|Christian Rock|Merengue|Salsa|Thrash Metal|Anime|J-Pop|Synthpop').split('|');

const dec = enc => { try { return new TextDecoder(enc); } catch { return new TextDecoder('utf-8'); } };
const latin1 = dec('iso-8859-1'), utf8 = dec('utf-8'), utf16le = dec('utf-16le'), utf16be = dec('utf-16be');
const clean = s => (s || '').replace(/\u0000+$/g, '').replace(/^\uFEFF/, '').trim();
const ascii = (u8, o, n) => String.fromCharCode(...u8.subarray(o, o + n));

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function genreName(g) {
  if (!g) return '';
  // ID3 style "(17)", "(17)Rock", "17"
  const m = /^\((\d+)\)(.*)$/.exec(g) || /^(\d+)$/.exec(g);
  if (m) return clean(m[2]) || GENRES[+m[1]] || '';
  return g;
}

function numPair(v) {
  const m = /^\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(String(v || ''));
  return m ? [+m[1], m[2] ? +m[2] : 0] : [0, 0];
}

function sniffMime(u8) {
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
  if (u8[0] === 0x47 && u8[1] === 0x49) return 'image/gif';
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57) return 'image/webp';
  if (u8[0] === 0x42 && u8[1] === 0x4d) return 'image/bmp';
  return '';
}

// ------------------------------------------------------------------ ID3v2
const syncsafe = (u8, o) => ((u8[o] & 0x7f) << 21) | ((u8[o + 1] & 0x7f) << 14) | ((u8[o + 2] & 0x7f) << 7) | (u8[o + 3] & 0x7f);
const be32 = (u8, o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
const be24 = (u8, o) => (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2];
const le32 = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;

function unsync(u8) {
  const out = new Uint8Array(u8.length);
  let j = 0;
  for (let i = 0; i < u8.length; i++) {
    out[j++] = u8[i];
    if (u8[i] === 0xff && u8[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeRaw(enc, u8) {
  if (!u8.length) return '';
  if (enc === 0) return latin1.decode(u8);
  if (enc === 1) {
    if (u8[0] === 0xfe && u8[1] === 0xff) return utf16be.decode(u8.subarray(2));
    if (u8[0] === 0xff && u8[1] === 0xfe) return utf16le.decode(u8.subarray(2));
    return utf16le.decode(u8);
  }
  return enc === 2 ? utf16be.decode(u8) : utf8.decode(u8);
}
function decodeText(enc, u8) {
  // ID3v2.4 separates multiple values with NUL
  return decodeRaw(enc, u8).split('\u0000').map(x => x.replace(/^\uFEFF/, '').trim()).filter(Boolean).join(', ');
}

/** Index of the string terminator for an encoding (1 byte, or 2 aligned bytes for UTF-16). */
function termAt(u8, o, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = o; i + 1 < u8.length; i += 2) if (u8[i] === 0 && u8[i + 1] === 0) return i;
    return u8.length;
  }
  const i = u8.indexOf(0, o);
  return i < 0 ? u8.length : i;
}
const termLen = enc => (enc === 1 || enc === 2 ? 2 : 1);

export function parseID3v2(u8, out = {}) {
  if (ascii(u8, 0, 3) !== 'ID3') return out;
  const ver = u8[3], flags = u8[5];
  const size = syncsafe(u8, 6);
  let body = u8.subarray(10, 10 + size);
  if (ver < 4 && flags & 0x80) body = unsync(body);
  let o = 0;
  if (flags & 0x40) o = ver === 3 ? be32(body, 0) + 4 : syncsafe(body, 0);
  const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
  const pics = [];
  while (o + hdr <= body.length) {
    const id = ascii(body, o, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let len = ver === 2 ? be24(body, o + 3) : ver === 4 ? syncsafe(body, o + 4) : be32(body, o + 4);
    // some v2.4 writers store plain sizes: if the syncsafe size lands on garbage, try the plain one
    if (ver === 4 && len > 127) {
      const plain = be32(body, o + 4);
      const next = o + hdr + len, nextPlain = o + hdr + plain;
      const ok = n => n === body.length || (n + 4 <= body.length && (/^[A-Z0-9]{4}$/.test(ascii(body, n, 4)) || body[n] === 0));
      if (!ok(next) && ok(nextPlain)) len = plain;
    }
    const fflags = ver === 2 ? 0 : body[o + 9];
    let data = body.subarray(o + hdr, o + hdr + len);
    o += hdr + len;
    if (!len) continue;
    if (ver === 4) {
      if (fflags & 0x01) data = data.subarray(4); // data length indicator
      if (fflags & 0x02) data = unsync(data);
      if (fflags & 0x0c) continue; // compressed / encrypted
    } else if (ver === 3 && fflags & 0xc0) continue;
    const enc = data[0];
    const text = () => decodeText(enc, data.subarray(1));
    switch (id) {
      case 'TIT2': case 'TT2': out.title ||= text(); break;
      case 'TPE1': case 'TP1': out.artist ||= text(); break;
      case 'TPE2': case 'TP2': out.albumArtist ||= text(); break;
      case 'TALB': case 'TAL': out.album ||= text(); break;
      case 'TCON': case 'TCO': out.genre ||= genreName(text()); break;
      case 'TYER': case 'TYE': case 'TDRC': case 'TDOR': out.year ||= +(text().match(/\d{4}/)?.[0] || 0); break;
      case 'TRCK': case 'TRK': [out.track, out.trackTotal] = numPair(text()); break;
      case 'TPOS': case 'TPA': [out.disc, out.discTotal] = numPair(text()); break;
      case 'TCMP': case 'TCP': out.compilation = text() === '1'; break;
      case 'TXXX': case 'TXX': {
        const e = termAt(data, 1, enc);
        const key = decodeText(enc, data.subarray(1, e)).toUpperCase();
        const val = decodeText(enc, data.subarray(e + termLen(enc)));
        if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') out.albumArtist ||= val;
        else if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS') out.lyrics ||= val;
        break;
      }
      case 'USLT': case 'ULT': {
        // language (3 bytes), descriptor, then the text with its line breaks
        const e = termAt(data, 4, enc);
        out.lyrics ||= clean(decodeRaw(enc, data.subarray(e + termLen(enc))));
        break;
      }
      case 'APIC': case 'PIC': {
        let p = 1, mime;
        if (id === 'PIC') { const f = ascii(data, 1, 3).toUpperCase(); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
        else { const e = data.indexOf(0, 1); mime = latin1.decode(data.subarray(1, e)).toLowerCase(); p = e + 1; }
        const type = data[p];
        const e = termAt(data, p + 1, enc);
        const img = data.subarray(e + termLen(enc));
        if (img.length > 64) pics.push({ type, data: img, mime: sniffMime(img) || (mime.includes('/') ? mime : 'image/' + (mime || 'jpeg')) });
        break;
      }
    }
  }
  if (pics.length && !out.picture) out.picture = pics.find(p => p.type === 3) || pics[0];
  return out;
}

function parseID3v1(u8, out = {}) {
  if (u8.length < 128 || ascii(u8, 0, 3) !== 'TAG') return out;
  const s = (o, n) => clean(latin1.decode(u8.subarray(o, o + n)));
  out.title ||= s(3, 30); out.artist ||= s(33, 30); out.album ||= s(63, 30);
  out.year ||= +(s(93, 4).match(/\d{4}/)?.[0] || 0);
  if (u8[125] === 0 && u8[126]) out.track ||= u8[126];
  if (u8[127] < GENRES.length) out.genre ||= GENRES[u8[127]];
  return out;
}

// ------------------------------------------------------------------ Vorbis comments (FLAC / Ogg)
function parseFlacPicture(u8) {
  let o = 0;
  const type = be32(u8, o); o += 4;
  const ml = be32(u8, o); o += 4;
  const mime = latin1.decode(u8.subarray(o, o + ml)); o += ml;
  const dl = be32(u8, o); o += 4 + dl + 16;
  const len = be32(u8, o); o += 4;
  const data = u8.subarray(o, o + len);
  return data.length > 64 ? { type, mime: sniffMime(data) || mime, data } : null;
}

function b64(s) {
  try { const bin = atob(s.replace(/\s+/g, '')); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; } catch { return null; }
}

function parseVorbisComment(u8, out = {}) {
  let o = 0;
  const vl = le32(u8, o); o += 4 + vl;
  const n = le32(u8, o); o += 4;
  const pics = [];
  for (let i = 0; i < n && o + 4 <= u8.length; i++) {
    const l = le32(u8, o); o += 4;
    const s = utf8.decode(u8.subarray(o, o + l)); o += l;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
    switch (k) {
      case 'TITLE': out.title ||= v; break;
      case 'ARTIST': out.artist = out.artist ? out.artist + ', ' + v : v; break;
      case 'ALBUMARTIST': case 'ALBUM ARTIST': case 'ALBUM_ARTIST': out.albumArtist ||= v; break;
      case 'ALBUM': out.album ||= v; break;
      case 'GENRE': out.genre ||= v; break;
      case 'DATE': case 'YEAR': out.year ||= +(v.match(/\d{4}/)?.[0] || 0); break;
      case 'TRACKNUMBER': { const [a, b] = numPair(v); out.track = a; if (b) out.trackTotal = b; break; }
      case 'TRACKTOTAL': case 'TOTALTRACKS': out.trackTotal ||= +v || 0; break;
      case 'DISCNUMBER': { const [a, b] = numPair(v); out.disc = a; if (b) out.discTotal = b; break; }
      case 'DISCTOTAL': case 'TOTALDISCS': out.discTotal ||= +v || 0; break;
      case 'COMPILATION': out.compilation = v === '1'; break;
      case 'LYRICS': case 'UNSYNCEDLYRICS': out.lyrics ||= v; break;
      case 'METADATA_BLOCK_PICTURE': { const b = b64(v); const p = b && parseFlacPicture(b); if (p) pics.push(p); break; }
      case 'COVERART': { const b = b64(v); if (b) pics.push({ type: 3, data: b, mime: sniffMime(b) || 'image/jpeg' }); break; }
    }
  }
  if (pics.length && !out.picture) out.picture = pics.find(p => p.type === 3) || pics[0];
  return out;
}

async function parseFlac(file, start, out) {
  let o = start + 4;
  for (let guard = 0; guard < 64; guard++) {
    const h = await bytes(file, o, o + 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = be24(h, 1);
    o += 4;
    if (type === 4) parseVorbisComment(await bytes(file, o, o + len), out);
    else if (type === 6 && !out.picture) out.picture = parseFlacPicture(await bytes(file, o, o + len));
    o += len;
    if (last) break;
  }
  return out;
}

/** Packet `want` (0-based) of an Ogg stream, or null if the buffer ends first. */
function oggPacket(u8, want) {
  let o = 0, n = 0;
  const cur = [];
  while (o + 27 <= u8.length && ascii(u8, o, 4) === 'OggS') {
    const nseg = u8[o + 26];
    if (o + 27 + nseg > u8.length) return null;
    let p = o + 27 + nseg;
    for (let i = 0; i < nseg; i++) {
      const s = u8[o + 27 + i];
      if (p + s > u8.length) return null;
      if (n === want) cur.push(u8.subarray(p, p + s));
      p += s;
      if (s < 255) {
        if (n === want) {
          const out = new Uint8Array(cur.reduce((a, b) => a + b.length, 0));
          let w = 0; for (const c of cur) { out.set(c, w); w += c.length; }
          return out;
        }
        n++;
      }
    }
    o = p;
  }
  return null;
}

/** The comment header is the second packet; it can be large when it carries cover art. */
async function parseOgg(file, out) {
  for (let limit = Math.min(file.size, 256 * 1024); ; limit = Math.min(file.size, limit * 4)) {
    const pk = oggPacket(await bytes(file, 0, limit), 1);
    if (pk) {
      if (pk[0] === 3 && ascii(pk, 1, 6) === 'vorbis') parseVorbisComment(pk.subarray(7), out);
      else if (ascii(pk, 0, 8) === 'OpusTags') parseVorbisComment(pk.subarray(8), out);
      return out;
    }
    if (limit >= file.size || limit >= 32 * 1024 * 1024) return out;
  }
}

// ------------------------------------------------------------------ MP4 / M4A
async function atoms(file, start, end) {
  const list = [];
  let o = start;
  while (o + 8 <= end) {
    const h = await bytes(file, o, o + 16);
    let size = be32(h, 0);
    const type = ascii(h, 4, 4);
    let hl = 8;
    if (size === 1) { size = be32(h, 8) * 4294967296 + be32(h, 12); hl = 16; }
    else if (size === 0) size = end - o;
    if (size < hl) break;
    list.push({ type, start: o, hl, size });
    o += size;
  }
  return list;
}

function mp4Items(u8, out) {
  // u8 = ilst payload
  let o = 0;
  while (o + 8 <= u8.length) {
    const size = be32(u8, o), key = latin1.decode(u8.subarray(o + 4, o + 8));
    if (size < 8) break;
    const item = u8.subarray(o + 8, o + size);
    o += size;
    // find the (first) data atom; freeform '----' items have mean/name first
    let p = 0, name = '';
    while (p + 8 <= item.length) {
      const s = be32(item, p), t = ascii(item, p + 4, 4);
      if (s < 8) break;
      if (t === 'name') name = utf8.decode(item.subarray(p + 12, p + s));
      if (t === 'data') {
        const type = be32(item, p + 8) & 0xffffff;
        const val = item.subarray(p + 16, p + s);
        const str = () => utf8.decode(val).trim();
        switch (key) {
          case '©nam': out.title ||= str(); break;
          case '©ART': out.artist ||= str(); break;
          case 'aART': out.albumArtist ||= str(); break;
          case '©alb': out.album ||= str(); break;
          case '©gen': out.genre ||= str(); break;
          case 'gnre': out.genre ||= GENRES[((val[0] << 8) | val[1]) - 1] || ''; break;
          case '©day': out.year ||= +(str().match(/\d{4}/)?.[0] || 0); break;
          case 'trkn': if (val.length >= 6) { out.track = (val[2] << 8) | val[3]; out.trackTotal = (val[4] << 8) | val[5]; } break;
          case 'disk': if (val.length >= 6) { out.disc = (val[2] << 8) | val[3]; out.discTotal = (val[4] << 8) | val[5]; } break;
          case 'cpil': out.compilation = !!val[0]; break;
          case '©lyr': out.lyrics ||= str(); break;
          case 'covr': if (!out.picture && val.length > 64) out.picture = { type: 3, data: val, mime: type === 14 ? 'image/png' : sniffMime(val) || 'image/jpeg' }; break;
          case '----': if (/^album ?artist$/i.test(name)) out.albumArtist ||= str(); break;
        }
        break;
      }
      p += s;
    }
  }
  return out;
}

async function parseMp4(file, out) {
  const top = await atoms(file, 0, file.size);
  const moov = top.find(a => a.type === 'moov');
  if (!moov) return out;
  if (moov.size > 64 * 1024 * 1024) return out;
  const u8 = await bytes(file, moov.start + moov.hl, moov.start + moov.size);
  // walk moov > udta > meta > ilst inside the buffer
  const find = (buf, path) => {
    let o = 0;
    while (o + 8 <= buf.length) {
      const s = be32(buf, o), t = ascii(buf, o + 4, 4);
      if (s < 8) return null;
      if (t === path[0]) {
        let inner = buf.subarray(o + 8, o + s);
        if (t === 'meta') {
          // 'meta' is a full box (4 bytes version/flags) in MP4, but not in some QuickTime files
          const peek = ascii(inner, 4, 4);
          if (!/^(hdlr|ilst|keys)$/.test(peek)) inner = inner.subarray(4);
        }
        return path.length === 1 ? inner : find(inner, path.slice(1));
      }
      o += s;
    }
    return null;
  };
  const ilst = find(u8, ['udta', 'meta', 'ilst']) || find(u8, ['meta', 'ilst']);
  if (ilst) mp4Items(ilst, out);
  return out;
}

// ------------------------------------------------------------------ WAV
async function parseWav(file, out) {
  let o = 12;
  while (o + 8 <= file.size) {
    const h = await bytes(file, o, o + 8);
    const id = ascii(h, 0, 4), len = le32(h, 4);
    if (id === 'LIST') {
      const u8 = await bytes(file, o + 8, o + 8 + len);
      if (ascii(u8, 0, 4) === 'INFO') {
        let p = 4;
        while (p + 8 <= u8.length) {
          const k = ascii(u8, p, 4), l = le32(u8, p + 4);
          const v = clean(utf8.decode(u8.subarray(p + 8, p + 8 + l)));
          if (k === 'INAM') out.title ||= v; else if (k === 'IART') out.artist ||= v; else if (k === 'IPRD') out.album ||= v;
          else if (k === 'IGNR') out.genre ||= v; else if (k === 'ICRD') out.year ||= +(v.match(/\d{4}/)?.[0] || 0);
          else if (k === 'ITRK' || k === 'IPRT') out.track ||= numPair(v)[0];
          p += 8 + l + (l & 1);
        }
      }
    } else if (id === 'id3 ' || id === 'ID3 ') parseID3v2(await bytes(file, o + 8, o + 8 + len), out);
    o += 8 + len + (len & 1);
  }
  return out;
}

// ------------------------------------------------------------------ entry point
/**
 * readTags(file) → { title, artist, album, albumArtist, genre, year, track, trackTotal, disc, discTotal,
 *   compilation, lyrics, picture: { data: Uint8Array, mime } }
 * Never throws: unreadable files return what was found so far.
 */
export async function readTags(file) {
  const out = {};
  try {
    const head = await bytes(file, 0, 12);
    if (ascii(head, 0, 3) === 'ID3') {
      const size = syncsafe(head, 6) + 10 + (head[5] & 0x10 ? 10 : 0);
      parseID3v2(await bytes(file, 0, size), out);
      const after = await bytes(file, size, size + 4);
      if (ascii(after, 0, 4) === 'fLaC') await parseFlac(file, size, out);
    } else if (ascii(head, 0, 4) === 'fLaC') await parseFlac(file, 0, out);
    else if (ascii(head, 0, 4) === 'OggS') await parseOgg(file, out);
    else if (ascii(head, 4, 4) === 'ftyp') await parseMp4(file, out);
    else if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') await parseWav(file, out);
    if (!out.title && file.size > 128) parseID3v1(await bytes(file, file.size - 128, file.size), out);
  } catch (e) {
    console.warn('tags', file.name, e);
  }
  return out;
}

/** Best guess from the file name ("01 - Artist - Title.mp3") and folder ("Artist/Album/…"). */
export function guessFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  const file = (parts.pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
  const out = {};
  let m = /^(\d{1,3})[\s.\-_)]+(.+)$/.exec(file);
  let rest = file;
  if (m) { out.track = +m[1]; rest = m[2]; }
  const dash = rest.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) { out.artist = dash[0].trim(); out.title = dash.slice(1).join(' - ').trim(); }
  else out.title = rest.trim();
  if (parts.length >= 1) out.album = parts[parts.length - 1];
  if (parts.length >= 2 && !out.artist) out.artist = parts[parts.length - 2];
  return out;
}
