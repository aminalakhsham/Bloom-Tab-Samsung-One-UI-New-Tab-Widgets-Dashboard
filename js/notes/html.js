// What a Samsung Notes note body may hold, and the forms it is read in elsewhere (plain text for widgets, Finder and
// copying; Markdown for export; #tags; the pictures it points to). A note body is HTML made of blocks:
//   div, p, h1–h3 (Title, Heading, Subheading), blockquote, ul / ol > li (ul.checklist > li[data-checked="true"]),
//   table > tbody > tr > td, hr, figure[data-att="notes:<id>"][data-k="img|draw|voice"] (the picture, drawing or
//   recording lives in IndexedDB under that key; a drawing keeps its strokes under "<key>:v").
// Blocks may carry data-al="center|end" (alignment). Inline: b, i, u, s, br, span[data-tc] (text colour),
// span[data-fs] (font size), mark[data-hl] (highlight). Anything else is unwrapped and scripts are dropped.
// Kept small and DOM-only (DOMParser, so nothing in a pasted note ever loads or runs): it is imported at every new tab
// by js/apps/notes.js for the widgets and Finder.

export const TEXT_COLORS = { red: '#e5484d', orange: '#f07a1a', yellow: '#d9a400', green: '#22a356', blue: '#2f7bf5', purple: '#8e5cf7', gray: '#7c7f88' };
export const HL_COLORS = { yellow: '#ffe14d', green: '#8ee07a', blue: '#7cc8ff', pink: '#ff9fcf', orange: '#ffbd6b' };
export const FONT_SIZES = [12, 14, 16, 20, 24, 32];
export const DEFAULT_SIZE = 16;
export const ATT_RE = /^notes:[\w-]+$/;
const KINDS = new Set(['img', 'draw', 'voice']);

const BLOCK = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'TR', 'TD', 'HR', 'FIGURE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'HEAD',
  'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'COLGROUP', 'CAPTION']);
const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's' };

/** Parses HTML into an inert document body (images don't load, nothing runs). */
export const parse = (html) => new DOMParser().parseFromString(`<!doctype html><body>${html || ''}`, 'text/html').body;

/** The editor marks text with <font face="nt-…"> (execCommand's fontName) and turns it into these. */
export function markElement(doc, face) {
  const m = /^nt-(tc|hl|fs)-([\w]+)$/.exec(face || '');
  if (!m) return null;
  const [, k, v] = m;
  if (k === 'tc' && (TEXT_COLORS[v] || v === 'auto')) return spanWith(doc, 'tc', v);
  if (k === 'fs' && FONT_SIZES.includes(+v)) return spanWith(doc, 'fs', v);
  if (k === 'hl' && (HL_COLORS[v] || v === 'none')) {
    const x = doc.createElement('mark');
    x.setAttribute('data-hl', v);
    return x;
  }
  return null;
}
function spanWith(doc, k, v) {
  const x = doc.createElement('span');
  x.setAttribute('data-' + k, v);
  return x;
}

/** Keeps only what a note may hold (see the top of this file); everything else is unwrapped, scripts are dropped. */
export function sanitize(html) {
  const src = parse(html);
  const doc = document;
  const out = doc.createElement('div');
  const align = (n, el) => {
    const a = n.getAttribute?.('data-al') || (/text-align:\s*center/.test(n.getAttribute?.('style') || '') ? 'center' : '');
    if (a === 'center' || a === 'end') el.setAttribute('data-al', a);
  };
  const walk = (from, to) => {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) {
        // zero-width spaces only hold the caret in the editor
        const v = n.nodeValue.replace(/\u200b/g, '');
        if (v) to.appendChild(doc.createTextNode(v));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (DROP.has(tag)) continue;
      if (tag === 'BR') {
        to.appendChild(doc.createElement('br'));
        continue;
      }
      if (tag === 'FIGURE') {
        const att = n.getAttribute('data-att') || '';
        if (!ATT_RE.test(att)) continue;
        const f = doc.createElement('figure');
        f.setAttribute('data-att', att);
        f.setAttribute('data-k', KINDS.has(n.getAttribute('data-k')) ? n.getAttribute('data-k') : 'img');
        to.appendChild(f);
        continue;
      }
      if (tag === 'HR') {
        to.appendChild(doc.createElement('hr'));
        continue;
      }
      if (tag === 'TABLE') {
        const rows = [...n.querySelectorAll('tr')].filter((r) => r.closest('table') === n && r.cells.length);
        if (!rows.length) continue;
        const w = Math.max(...rows.map((r) => r.cells.length));
        const tb = doc.createElement('table');
        const body = tb.appendChild(doc.createElement('tbody'));
        for (const r of rows) {
          const tr = body.appendChild(doc.createElement('tr'));
          for (let k = 0; k < w; k++) {
            const td = tr.appendChild(doc.createElement('td'));
            if (r.cells[k]) walk(r.cells[k], td);
            if (!td.firstChild) td.appendChild(doc.createElement('br'));
          }
        }
        to.appendChild(tb);
        continue;
      }
      if (BLOCK.has(tag) || /^H[4-6]$/.test(tag)) {
        const el = doc.createElement(/^H[4-6]$/.test(tag) ? 'h3' : tag === 'TR' || tag === 'TD' ? 'div' : tag.toLowerCase());
        if (tag === 'UL' && n.classList.contains('checklist')) el.className = 'checklist';
        if (tag === 'LI' && n.getAttribute('data-checked') === 'true') el.setAttribute('data-checked', 'true');
        if (tag !== 'UL' && tag !== 'OL') align(n, el);
        walk(n, el);
        to.appendChild(el);
        continue;
      }
      if (INLINE[tag]) {
        walk(n, to.appendChild(doc.createElement(INLINE[tag])));
        continue;
      }
      if (tag === 'FONT') {
        const m = markElement(doc, n.getAttribute('face'));
        walk(n, m ? to.appendChild(m) : to);
        continue;
      }
      if (tag === 'MARK') {
        const v = n.getAttribute('data-hl');
        const m = doc.createElement('mark');
        m.setAttribute('data-hl', HL_COLORS[v] || v === 'none' ? v : 'yellow');
        walk(n, to.appendChild(m));
        continue;
      }
      // spans: our colour and size marks; otherwise keep the bold/italic of pasted styled text
      let target = to;
      const tc = n.getAttribute('data-tc'), fs = n.getAttribute('data-fs');
      if (tag === 'SPAN' && (TEXT_COLORS[tc] || tc === 'auto')) target = target.appendChild(spanWith(doc, 'tc', tc));
      if (tag === 'SPAN' && FONT_SIZES.includes(+fs)) target = target.appendChild(spanWith(doc, 'fs', fs));
      const st = n.getAttribute('style') || '';
      if (/font-weight:\s*(bold|[6-9]00)/.test(st)) target = target.appendChild(doc.createElement('b'));
      if (/font-style:\s*italic/.test(st)) target = target.appendChild(doc.createElement('i'));
      walk(n, target);
    }
  };
  walk(src, out);
  // empty inline wrappers left behind by editing say nothing
  for (const x of out.querySelectorAll('b, i, u, s, span, mark')) if (!x.firstChild) x.remove();
  return out.innerHTML;
}

// ——— plain text ———
/**
 * The note as plain text, one line per paragraph: list items get "• ", "1. " (their real number), "☐ " / "☑ ",
 * nested lists are indented, table rows read "a | b", a divider is "---"; pictures leave no text.
 */
export function noteText(html) {
  if (!html) return '';
  const lines = [];
  let cur = '';
  const end = () => {
    if (cur !== '') lines.push(cur);
    cur = '';
  };
  const walk = (node, depth) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        cur += n.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (DROP.has(tag) || tag === 'FIGURE') continue;
      if (tag === 'BR') {
        lines.push(cur);
        cur = '';
        continue;
      }
      if (tag === 'HR') {
        end();
        lines.push('---');
        continue;
      }
      if (tag === 'TABLE') {
        end();
        for (const r of n.querySelectorAll('tr')) lines.push([...r.cells].map((c) => noteText(c.innerHTML).replace(/\n+/g, ' ')).join(' | '));
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        end();
        let i = +(n.getAttribute('start') || 1);
        for (const li of n.children) {
          if (li.tagName !== 'LI') {
            walk(li, depth + 1);
            end();
            continue;
          }
          const mark = tag === 'OL' ? `${i++}. ` : n.classList.contains('checklist') ? (li.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ') : '• ';
          cur = '  '.repeat(depth) + mark;
          walk(li, depth + 1);
          end();
        }
        continue;
      }
      const block = BLOCK.has(tag) || /^H[4-6]$/.test(tag);
      if (block) end();
      walk(n, depth);
      if (block) end();
    }
  };
  walk(parse(html), 0);
  end();
  // a "• " left alone by an empty item is still a line; trailing spaces and runs of blank lines are not
  return lines.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ——— Markdown ———
/** The note as Markdown: headings, **bold**, *italic*, ~~strike~~, ==highlight==, lists, checklists, tables. */
export function toMarkdown(title, html) {
  const out = [];
  if (title?.trim()) out.push('# ' + mdEsc(title.trim()), '');
  const inline = (node) => {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        s += mdEsc(n.nodeValue.replace(/ /g, ' '));
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'BR') {
        s += '  \n';
        continue;
      }
      const inner = inline(n);
      const wrap = (mk) => {
        const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
        return m[2] ? `${m[1]}${mk}${m[2]}${mk}${m[3]}` : inner;
      };
      s += { B: () => wrap('**'), I: () => wrap('*'), S: () => wrap('~~'), MARK: () => (n.getAttribute('data-hl') === 'none' ? inner : wrap('==')) }[n.tagName]?.() ?? inner;
    }
    return s;
  };
  const block = (n, depth = 0) => {
    const tag = n.tagName;
    if (n.nodeType === 3) {
      if (n.nodeValue.trim()) out.push(mdEsc(n.nodeValue.trim()));
      return;
    }
    if (n.nodeType !== 1 || tag === 'FIGURE') return;
    if (tag === 'HR') return out.push('---');
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') return out.push('#'.repeat(+tag[1] + (title?.trim() ? 1 : 0)) + ' ' + inline(n).trim());
    if (tag === 'BLOCKQUOTE') return out.push(...inline(n).split('\n').map((l) => '> ' + l));
    if (tag === 'TABLE') {
      const rows = [...n.querySelectorAll('tr')].map((r) => [...r.cells].map((c) => inline(c).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()));
      if (!rows.length) return;
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: w }, (_, i) => r[i] || ' ').join(' | ') + ' |';
      out.push('', line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line), '');
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      let i = 1;
      for (const li of n.children) {
        const mark = tag === 'OL' ? `${i++}. ` : n.classList.contains('checklist') ? (li.getAttribute('data-checked') === 'true' ? '- [x] ' : '- [ ] ') : '- ';
        const own = document.createElement('div');
        for (const c of li.childNodes) if (!/^(UL|OL)$/.test(c.nodeName)) own.appendChild(c.cloneNode(true));
        out.push('    '.repeat(depth) + mark + inline(own).trim());
        for (const c of li.children) if (/^(UL|OL)$/.test(c.tagName)) block(c, depth + 1);
      }
      return;
    }
    const kids = [...n.childNodes];
    if (kids.some((c) => c.nodeType === 1 && BLOCK.has(c.tagName))) return kids.forEach((c) => block(c, depth));
    const s = inline(n);
    out.push(s.trim() ? s.replace(/^(#{1,6}\s|[-+*]\s|\d+[.)]\s|>)/, '\\$1') : '');
  };
  const body = parse(html);
  let run = document.createElement('div');
  // bare text before the first block (the editor's first line) is a paragraph of its own
  for (const n of [...body.childNodes]) {
    if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.has(n.tagName) && !/^H[4-6]$/.test(n.tagName))) run.appendChild(n);
    else {
      if (run.childNodes.length) block(run);
      run = document.createElement('div');
      block(n);
    }
  }
  if (run.childNodes.length) block(run);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const mdEsc = (s) => s.replace(/([\\`*~[\]=])/g, '\\$1');

// ——— #tags (as in Samsung Notes: a word written with # in front) ———
export const TAG_RE = /(^|[\s([{,;])#([\p{L}_][\p{L}\p{M}\p{N}_-]*)/gu;
/** Map lower-case key → the tag as first written. */
export function tagsOf(text) {
  const m = new Map();
  for (const x of String(text || '').matchAll(TAG_RE)) {
    const k = x[2].toLowerCase();
    if (!m.has(k)) m.set(k, x[2]);
  }
  return m;
}

/** The IndexedDB keys of the pictures, drawings and recordings a body points to (drawings: their strokes too). */
export function attIds(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<figure[^>]*data-att="(notes:[\w-]+)"[^>]*>/g)) {
    out.push(m[1]);
    if (/data-k="draw"/.test(m[0])) out.push(m[1] + ':v');
  }
  return out;
}
/** The first picture or drawing of a body (for the card preview), or null. */
export const firstPicture = (html) => /<figure[^>]*data-att="(notes:[\w-]+)"[^>]*data-k="(?:img|draw)"/.exec(html || '')?.[1] || /<figure[^>]*data-k="(?:img|draw)"[^>]*data-att="(notes:[\w-]+)"/.exec(html || '')?.[1] || null;
