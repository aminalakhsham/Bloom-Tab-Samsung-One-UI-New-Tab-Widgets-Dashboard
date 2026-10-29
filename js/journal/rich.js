// Journal entry text: the small rich-text model of the editor (bold, italic, underline, strikethrough, bulleted and
// numbered lists, paragraphs) and its plain-text mirror. Pasted or stored HTML is rebuilt from scratch, so no other
// tag, attribute, style or script ever reaches the page.

const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's' };
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'TR', 'TABLE', 'DD', 'DT']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'SELECT', 'TEXTAREA', 'BUTTON', 'INPUT', 'HEAD', 'TITLE', 'META', 'LINK']);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Parses HTML without running or loading anything. */
const parse = (html) => new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;

function inline(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      out += esc(n.nodeValue.replace(/[\r\n]+/g, ' '));
      continue;
    }
    if (n.nodeType !== 1 || SKIP.has(n.nodeName)) continue;
    if (n.nodeName === 'BR') {
      out += '<br>';
      continue;
    }
    const tag = INLINE[n.nodeName] || (n.nodeName === 'SPAN' && /bold|[6-9]00/.test(n.style?.fontWeight || '') ? 'b' : n.nodeName === 'SPAN' && n.style?.fontStyle === 'italic' ? 'i' : '');
    const inner = inline(n);
    out += tag && inner ? `<${tag}>${inner}</${tag}>` : inner;
  }
  return out;
}

/** Clean HTML for an entry: top-level <div> paragraphs and <ul>/<ol> lists with inline b, i, u, s and br. */
export function clean(html) {
  const out = [];
  let para = '';
  const flush = () => {
    if (para.trim() !== '' || para.includes('<br>')) out.push(`<div>${para.replace(/^(<br>)+|(<br>)+$/g, '') || '<br>'}</div>`);
    para = '';
  };
  const walk = (root) => {
    for (const n of root.childNodes) {
      if (n.nodeType === 3) {
        para += esc(n.nodeValue.replace(/[\r\n]+/g, ' '));
        continue;
      }
      if (n.nodeType !== 1 || SKIP.has(n.nodeName)) continue;
      if (n.nodeName === 'UL' || n.nodeName === 'OL') {
        flush();
        const items = [...n.children].filter((li) => li.nodeName === 'LI').map((li) => `<li>${inline(li) || '<br>'}</li>`);
        if (items.length) out.push(`<${n.nodeName.toLowerCase()}>${items.join('')}</${n.nodeName.toLowerCase()}>`);
        continue;
      }
      if (n.nodeName === 'BR') {
        para += '<br>';
        flush();
        continue;
      }
      if (BLOCK.has(n.nodeName) || n.nodeName === 'LI') {
        flush();
        if ([...n.children].some((c) => BLOCK.has(c.nodeName) || c.nodeName === 'UL' || c.nodeName === 'OL')) walk(n);
        else {
          para = inline(n);
          if (para === '' || para === '<br>') {
            out.push('<div><br></div>');
            para = '';
          } else flush();
        }
        continue;
      }
      const tag = INLINE[n.nodeName];
      const inner = inline(n);
      para += tag && inner ? `<${tag}>${inner}</${tag}>` : inner;
    }
  };
  walk(parse(html));
  flush();
  // empty paragraphs at the end are left over from the editor's caret
  while (out.length && out.at(-1) === '<div><br></div>') out.pop();
  return out.join('');
}

/** The plain-text mirror: one line per paragraph, "• " and "1. " in front of list items. */
export function toText(html) {
  const lines = [];
  const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  for (const n of parse(html).children) {
    if (n.nodeName === 'UL' || n.nodeName === 'OL') [...n.children].forEach((li, i) => lines.push(`${n.nodeName === 'OL' ? i + 1 + '.' : '•'} ${text(li)}`));
    else {
      // a <br> inside a paragraph is a line break of its own
      const parts = n.innerHTML.split(/<br\s*\/?>/i).map((h) => text(parse(h)));
      lines.push(...(parts.length > 1 && !parts.at(-1) ? parts.slice(0, -1) : parts));
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text of any HTML (a Samsung Notes body, for suggestions). */
export const plain = (html) => toText(clean(String(html || '')));
