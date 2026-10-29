// vCard (.vcf) reading and writing for Contacts (ported from Liquid Tab): versions 2.1, 3.0 and 4.0, several cards
// per file, folded lines, quoted-printable text in any charset, base64 and data: URI photos, and Apple's extensions
// (item groups with X-ABLabel, X-ABDATE, X-ABRELATEDNAMES, X-SOCIALPROFILE, X-APPLE-OMIT-YEAR), so cards move between
// Bloom Tab, Galaxy phones (Samsung exports vCard 2.1), iPhone, Mac and Outlook. Pure functions (no DOM, no storage),
// also used by the plain-node test .dev/contacts-vcard.mjs.
import { normContact, displayName, parseDay, dayKey, ADDR_PARTS } from './model.js';

// ------------------------------------------------------------------ text from a file
/** The text of a .vcf file: UTF-8 (with or without a BOM), UTF-16, or Windows-1252 for old exports that aren't UTF-8. */
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\ufeff/, ''); } catch { return new TextDecoder('windows-1252').decode(b); }
}

// ------------------------------------------------------------------ parsing
const PROP = /^(?:([A-Za-z0-9-]+)\.)?([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/s;
/** Lines of one file after unfolding: continuation lines (starting with a space or tab), quoted-printable soft
 *  breaks ("=" at the end) and base64 runs of vCard 2.1 that continue without indentation. */
function unfold(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let qp = false, b64 = false;
  for (const line of raw) {
    const prev = out.length - 1;
    if (prev >= 0 && qp && out[prev].endsWith('=')) { out[prev] = out[prev].slice(0, -1) + line.replace(/^[ \t]+/, ''); qp = /=$/.test(line); continue; }
    if (prev >= 0 && /^[ \t]/.test(line)) { out[prev] += b64 ? line.trim() : line.slice(1); continue; }
    if (prev >= 0 && b64 && line && !PROP.test(line)) { out[prev] += line.trim(); continue; }
    if (!line.trim()) { b64 = false; continue; }
    out.push(line);
    const head = line.slice(0, line.indexOf(':') + 1).toUpperCase();
    qp = /QUOTED-PRINTABLE/.test(head) && line.endsWith('=');
    b64 = /ENCODING=(B|BASE64)\b|;BASE64[;:]/.test(head);
  }
  return out;
}
/** Parameters of a property: { TYPE: ['cell', 'voice'], ENCODING: ['b'], … }; vCard 2.1's bare words ("TEL;CELL;HOME") are types. */
function params(s) {
  const out = {};
  for (const part of s.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(1)) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = (i < 0 ? 'TYPE' : part.slice(0, i)).toUpperCase();
    const vals = (i < 0 ? part : part.slice(i + 1)).replace(/^"|"$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '').trim()).filter(Boolean);
    (out[k] ||= []).push(...vals);
  }
  if (out.TYPE) out.TYPE = out.TYPE.map((t) => t.toLowerCase());
  return out;
}
function qpDecode(s, charset = 'utf-8') {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else { const c = s.charCodeAt(i); if (c < 128) bytes.push(c); else bytes.push(...new TextEncoder().encode(s[i])); }
  }
  try { return new TextDecoder(charset).decode(new Uint8Array(bytes)); } catch { return new TextDecoder().decode(new Uint8Array(bytes)); }
}
/** Splits on unescaped separators, then unescapes each part ("\n", "\,", "\;", "\\"). */
function split(s, sep) {
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { const n = s[++i]; cur += n === 'n' || n === 'N' ? '\n' : n; continue; }
    if (c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
const text = (s) => split(s, '\u0000')[0];
function b64Bytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  try { const bin = atob(clean); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } catch { return null; }
}
const APPLE_LABEL = /^_\$!<(.+)>!\$_$/;
const PHONE_TYPES = { cell: 'mobile', mobile: 'mobile', iphone: 'iPhone', home: 'home', work: 'work', main: 'main', pager: 'pager', other: 'other', school: 'school' };
const SOCIAL = { twitter: 'Twitter', facebook: 'Facebook', flickr: 'Flickr', linkedin: 'LinkedIn', myspace: 'Myspace', sinaweibo: 'Sina Weibo', 'sina weibo': 'Sina Weibo' };
/** A label from Apple's X-ABLabel ("_$!<Mother>!$_" → "mother", "Gym" stays "Gym"). */
function abLabel(v) {
  const m = APPLE_LABEL.exec(v.trim());
  if (!m) return v.trim();
  const k = m[1].toLowerCase().replace(/\s+/g, '');
  return { homepage: 'homepage', anniversary: 'anniversary', other: 'other', mobile: 'mobile', main: 'main', home: 'home', work: 'work', school: 'school', homefax: 'homefax', workfax: 'workfax', pager: 'pager' }[k] || k;
}
function typeLabel(kind, types = []) {
  const t = new Set(types.filter((x) => x !== 'pref' && x !== 'voice' && x !== 'internet' && x !== 'x400'));
  if (kind === 'phones') {
    if (t.has('fax')) return t.has('work') ? 'workfax' : t.has('home') ? 'homefax' : 'other';
    if (t.has('iphone')) return 'iPhone';
    for (const k of ['cell', 'mobile', 'main', 'pager', 'home', 'work', 'school', 'other']) if (t.has(k)) return PHONE_TYPES[k];
    return t.size ? [...t][0].replace(/^x-/, '') : 'mobile';
  }
  if (kind === 'urls' && t.has('homepage')) return 'homepage';
  for (const k of ['home', 'work', 'school', 'other']) if (t.has(k)) return k;
  if (kind === 'emails') return t.has('icloud') ? 'iCloud' : 'home';
  if (kind === 'urls') return 'homepage';
  if (kind === 'related') return [...t][0] || 'other';
  return kind === 'addrs' ? 'home' : 'other';
}
/** 'YYYY-MM-DD' or '--MM-DD' from vCard dates: 1990-06-15, 19900615, --0615, --06-15, 1990-06-15T00:00:00Z, and Apple's
 *  year 1604 (or X-APPLE-OMIT-YEAR) for a date without a year. */
function vDate(v, p = {}) {
  let s = String(v).trim().replace(/T.*$/, '');
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s) || /^(--)(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const omit = p['X-APPLE-OMIT-YEAR']?.[0];
  const y = m[1] === '--' || m[1] === omit || m[1] === '1604' ? '--' : m[1];
  const d = parseDay(`${y}-${m[2]}-${m[3]}`);
  return d ? dayKey(d) : null;
}

/** Every card in a vCard file, as contacts (without ids). A card's photo comes as `_photo: { type, bytes }`. */
export function parse(input) {
  const lines = unfold(input);
  const cards = [];
  let cur = null;
  for (const line of lines) {
    const m = PROP.exec(line);
    if (!m) continue;
    const [, group, nameRaw, pstr] = m;
    let value = m[4];
    const name = nameRaw.toUpperCase();
    if (name === 'BEGIN' && /^vcard$/i.test(value.trim())) { cur = { props: [] }; continue; }
    if (name === 'END' && /^vcard$/i.test(value.trim())) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = params(pstr);
    const enc = (p.ENCODING?.[0] || '').toLowerCase();
    if (enc === 'quoted-printable' || p.TYPE?.includes('quoted-printable')) value = qpDecode(value, (p.CHARSET?.[0] || 'utf-8').toLowerCase());
    cur.props.push({ group: group?.toLowerCase() || '', name, p, value, b64: enc === 'b' || enc === 'base64' || p.TYPE?.includes('base64') });
  }
  return cards.map(toContact).filter(Boolean);
}

function toContact({ props }) {
  const c = {};
  const labels = {};
  for (const x of props) if (x.name === 'X-ABLABEL' && x.group) labels[x.group] = abLabel(text(x.value));
  const lbl = (x, kind) => (x.group && labels[x.group]) || typeLabel(kind, x.p.TYPE);
  const push = (k, e) => { (c[k] ||= []).push(e); };
  let fn = '';
  for (const x of props) {
    const v = x.value;
    switch (x.name) {
      case 'FN': fn = text(v).trim(); break;
      case 'N': { const [last, first, middle, prefix, suffix] = split(v, ';').map((s) => s.split(',').map((x2) => x2.trim()).filter(Boolean).join(' ')); Object.assign(c, { last, first, middle, prefix, suffix }); break; }
      case 'NICKNAME': c.nick = split(v, ',').filter(Boolean).join(', '); break;
      case 'X-MAIDENNAME': c.maiden = text(v); break;
      case 'X-PHONETIC-FIRST-NAME': c.pfirst = text(v); break;
      case 'X-PHONETIC-MIDDLE-NAME': c.pmiddle = text(v); break;
      case 'X-PHONETIC-LAST-NAME': c.plast = text(v); break;
      case 'X-PHONETIC-ORG': c.pcompany = text(v); break;
      case 'ORG': { const [company, ...dept] = split(v, ';'); c.company = company; c.dept = dept.filter(Boolean).join(', '); break; }
      case 'TITLE': c.job = text(v); break;
      case 'ROLE': if (!c.job) c.job = text(v); break;
      case 'KIND': if (/^org/i.test(v.trim())) c.isCo = true; break;
      case 'X-ABSHOWAS': if (/company/i.test(v)) c.isCo = true; break;
      case 'TEL': push('phones', { l: lbl(x, 'phones'), v: text(v).replace(/^tel:/i, '').trim() }); break;
      case 'EMAIL': push('emails', { l: lbl(x, 'emails'), v: text(v).replace(/^mailto:/i, '').trim() }); break;
      case 'URL': push('urls', { l: lbl(x, 'urls'), v: text(v).trim() }); break;
      case 'ADR': {
        const [, ext, street, city, region, zip, country] = split(v, ';').map((s) => s.trim());
        push('addrs', { l: lbl(x, 'addrs'), street: [street, ext].filter(Boolean).join('\n'), city, region, zip, country });
        break;
      }
      case 'BDAY': { const d = vDate(text(v), x.p); if (d) c.bday = d; break; }
      case 'ANNIVERSARY': { const d = vDate(text(v), x.p); if (d) push('dates', { l: 'anniversary', v: d }); break; }
      case 'X-ABDATE': { const d = vDate(text(v), x.p); if (d) push('dates', { l: lbl(x, 'dates'), v: d }); break; }
      case 'X-ANNIVERSARY': { const d = vDate(text(v), x.p); if (d) push('dates', { l: 'anniversary', v: d }); break; }
      case 'X-ABRELATEDNAMES': push('related', { l: (x.group && labels[x.group]) || 'other', v: text(v) }); break;
      case 'RELATED': if (!/^(urn|https?|mailto):/i.test(v)) push('related', { l: lbl(x, 'related'), v: text(v) }); break;
      case 'X-SOCIALPROFILE': {
        const svc = x.p.TYPE?.find((t) => t !== 'pref') || (x.group && labels[x.group]) || 'other';
        push('social', { l: SOCIAL[svc.toLowerCase()] || svc.charAt(0).toUpperCase() + svc.slice(1), v: x.p['X-USER']?.[0] || text(v) });
        break;
      }
      case 'NOTE': c.note = text(v); break;
      case 'PHOTO': {
        let bytes = null, type = (x.p.TYPE?.find((t) => /jpe?g|png|gif|webp|heic|bmp/.test(t)) || x.p.MEDIATYPE?.[0] || 'jpeg').toLowerCase();
        const data = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(v.trim());
        if (data) { type = data[1] || type; bytes = data[2] ? b64Bytes(data[3]) : null; }
        else if (x.b64 || (!/^(https?|file|cid):/i.test(v.trim()) && /^[A-Za-z0-9+/=\s]{40,}$/.test(v))) bytes = b64Bytes(v);
        if (bytes?.length) c._photo = { type: type.includes('/') ? type : 'image/' + type.replace('jpg', 'jpeg'), bytes };
        break;
      }
      default: break;
    }
  }
  if (!c.first && !c.last && !c.company && fn) {
    // a card with only a formatted name ("FN:Sara Ahmed"): split it the way most apps do
    const parts = fn.split(/\s+/);
    if (parts.length > 1) { c.first = parts.slice(0, -1).join(' '); c.last = parts.at(-1); } else c.first = fn;
  }
  const photo = c._photo;
  const out = normContact({ ...c, id: 'tmp' });
  if (!out) return null;
  delete out.id;
  if (photo) out._photo = photo;
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ writing
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const enc = new TextEncoder();
/** Folds a line to 75 octets (continuations start with a space), never inside a UTF-8 character. */
export function fold(line) {
  const out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const TEL_TYPES = { mobile: 'CELL;type=VOICE', iPhone: 'IPHONE;type=CELL;type=VOICE', home: 'HOME;type=VOICE', work: 'WORK;type=VOICE', main: 'MAIN', homefax: 'HOME;type=FAX', workfax: 'WORK;type=FAX', pager: 'PAGER', other: 'OTHER;type=VOICE' };
const APPLE = { homepage: 'HomePage', anniversary: 'Anniversary', other: 'Other', school: 'School', mother: 'Mother', father: 'Father', parent: 'Parent', brother: 'Brother', sister: 'Sister', child: 'Child', son: 'Son', daughter: 'Daughter', friend: 'Friend', spouse: 'Spouse', wife: 'Wife', husband: 'Husband', partner: 'Partner', assistant: 'Assistant', manager: 'Manager' };
const abl = (l) => (APPLE[l] ? `_$!<${APPLE[l]}>!$_` : l);

/** One contact as a vCard 3.0 card (the most widely read version; Apple-style labels for custom ones). `photo` = { type: 'JPEG', b64 } when there is one. */
export function serialize(c, { photo } = {}) {
  const L = [];
  let item = 0;
  const grp = (line, label) => { item++; L.push(`item${item}.${line}`, `item${item}.X-ABLabel:${esc(label)}`); };
  L.push('BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Bloom Tab//Contacts//EN');
  L.push(`N:${[c.last, c.first, c.middle, c.prefix, c.suffix].map(esc).join(';')}`);
  L.push(`FN:${esc(displayName(c) || c.company || '')}`);
  if (c.nick) L.push(`NICKNAME:${esc(c.nick)}`);
  if (c.maiden) L.push(`X-MAIDENNAME:${esc(c.maiden)}`);
  if (c.pfirst) L.push(`X-PHONETIC-FIRST-NAME:${esc(c.pfirst)}`);
  if (c.pmiddle) L.push(`X-PHONETIC-MIDDLE-NAME:${esc(c.pmiddle)}`);
  if (c.plast) L.push(`X-PHONETIC-LAST-NAME:${esc(c.plast)}`);
  if (c.company || c.dept) L.push(`ORG:${esc(c.company)};${esc(c.dept)}`);
  if (c.pcompany) L.push(`X-PHONETIC-ORG:${esc(c.pcompany)}`);
  if (c.job) L.push(`TITLE:${esc(c.job)}`);
  if (c.isCo) L.push('X-ABShowAs:COMPANY');
  for (const [i, e] of (c.phones || []).entries()) {
    const pref = i ? '' : ';type=pref';
    if (TEL_TYPES[e.l]) L.push(`TEL;type=${TEL_TYPES[e.l]}${pref}:${esc(e.v)}`); else grp(`TEL${pref}:${esc(e.v)}`, abl(e.l));
  }
  for (const [i, e] of (c.emails || []).entries()) {
    const pref = i ? '' : ';type=pref';
    if (['home', 'work', 'other'].includes(e.l)) L.push(`EMAIL;type=INTERNET;type=${e.l.toUpperCase()}${pref}:${esc(e.v)}`); else grp(`EMAIL;type=INTERNET${pref}:${esc(e.v)}`, abl(e.l));
  }
  for (const e of c.addrs || []) {
    const v = ['', '', e.street, e.city, e.region, e.zip, e.country].map(esc).join(';');
    if (['home', 'work', 'other'].includes(e.l)) L.push(`ADR;type=${e.l.toUpperCase()}:${v}`); else grp(`ADR:${v}`, abl(e.l));
  }
  for (const e of c.urls || []) { if (['home', 'work'].includes(e.l)) L.push(`URL;type=${e.l.toUpperCase()}:${esc(e.v)}`); else grp(`URL:${esc(e.v)}`, abl(e.l)); }
  const date = (v, prop) => { const d = parseDay(v); if (!d) return null; return d.y ? `${prop}:${dayKey(d)}` : `${prop};X-APPLE-OMIT-YEAR=1604:1604-${dayKey(d).slice(2)}`; };
  if (c.bday) { const l = date(c.bday, 'BDAY'); if (l) L.push(l); }
  for (const e of c.dates || []) { const l = date(e.v, 'X-ABDATE'); if (l) grp(l, abl(e.l)); }
  for (const e of c.related || []) grp(`X-ABRELATEDNAMES:${esc(e.v)}`, abl(e.l));
  for (const e of c.social || []) {
    const svc = String(e.l).toLowerCase().replace(/\s+/g, '');
    L.push(/^https?:/i.test(e.v) ? `X-SOCIALPROFILE;type=${svc}:${esc(e.v)}` : `X-SOCIALPROFILE;type=${svc};x-user=${String(e.v).replace(/[;:,"]/g, '')}:x-apple:${esc(e.v)}`);
  }
  if (c.note) L.push(`NOTE:${esc(c.note)}`);
  if (photo?.b64) L.push(`PHOTO;ENCODING=b;TYPE=${photo.type || 'JPEG'}:${photo.b64}`);
  L.push('END:VCARD');
  return L.map(fold).join('\r\n') + '\r\n';
}
/** Several contacts in one file. `photos` maps a contact id to its { type, b64 }. */
export function serializeAll(list, photos = new Map()) {
  return list.map((c) => serialize(c, { photo: photos.get(c.id) })).join('');
}
export { ADDR_PARTS };
