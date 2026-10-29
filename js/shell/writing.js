// Writing assist (Galaxy AI), the way One UI offers it in Samsung Notes and the Samsung Keyboard: one panel for any
// place text is written, with Proofread (the corrections are made in the text, underlined, and reviewed one by one with
// Accept / Revert), Style (Professional, Casual, Polite, Social, Emojify), Summarize, Format (Notes, Key points, List,
// Table), Translate and "Describe a change". It works on the selection or, with nothing selected, on all of the text,
// in a contenteditable editor or a plain <textarea>/<input>. It runs only on Chrome's built-in on-device models
// (Proofreader, Rewriter, Writer, Summarizer, LanguageModel = Gemini Nano, Translator), so the text never leaves the
// computer; where Chrome has none of them the panel says so, Samsung-style.
//
// API (for any app):
//   attachWritingAssist(el, opts) → { el, open(at), detach() }    safe to call again on the same element
//     opts.kind      what the text is: 'note' | 'journal' | 'reminder' | 'contact' | 'wallet' | 'text' (prompts use it)
//     opts.onResult  ({ tool, text, mode: 'replace' | 'insert' | 'proofread' | 'undo' }) after the text changed
//                    (the field also gets normal input events, so most editors save by themselves)
//     opts.button    an element that opens the panel (a toolbar button)
//     opts.bar       a toolbar to add a Galaxy AI button to (opts.btnClass: its button class)
//     opts.menu      the right-click entry (default: on for rich editors; plain fields keep Chrome's menu)
//     opts.float     plain fields: the small Galaxy AI button in their corner while focused (default true)
//     opts.onBefore  () right before the text changes (an editor with its own undo history records a step)
//     opts.undo      () undoes the last change, for editors with their own history
//     opts.ok        () → false while the text can't be edited
//   openWritingAssist(el, { anchor, x, y })   writingAssistItem(el, event) → an item for ui.js menu()
//   assistStatus() → { overall, tools: { proofread, style, summarize, format, translate, describe } }
import { h, escapeHtml as esc } from '../core/util.js';
import { icon, addIcons } from '../core/icons.js';
import { t, addStrings, lang } from '../core/i18n.js';
import { toast, choose, menu } from '../core/ui.js';

addIcons({
  // Galaxy AI: two four-point sparkles
  waAi: '<path d="M10 3.5c.5 3.6 2.4 5.6 6 6.1-3.6.5-5.5 2.5-6 6.1-.5-3.6-2.4-5.6-6-6.1 3.6-.5 5.5-2.5 6-6.1Z"/><path d="M17.5 13.5c.3 2 1.3 3 3 3.3-1.7.3-2.7 1.3-3 3.2-.3-1.9-1.3-2.9-3-3.2 1.7-.3 2.7-1.3 3-3.3Z"/>',
  waProof: '<path d="M4 6h11M4 10.5h7M4 15h4.5"/><path d="m12.5 16 2.5 2.5 5-5.5"/>',
  waStyle: '<path d="M4 20c4-1 6.5-3.5 8-7l3-3-3-3-3 3c-3.5 1.5-6 4-7 8"/><path d="m12 7 2-2 5 5-2 2"/><circle cx="9.5" cy="14.5" r="1.3"/>',
  waSummary: '<path d="M4 6h16M4 10.5h16M4 15h9"/><path d="m16 15 2 2 3-3.5"/>',
  waFormat: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M9.5 9.5V20"/>',
  waTranslate: '<path d="M4 6h9M8.5 4v2c0 4-2 7-4.5 8.5M6 9.5c1.2 2.2 3 3.8 5 4.5"/><path d="m12.5 20 3.5-8.5 3.5 8.5M13.8 17h4.4"/>',
  waSend: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
  waUndo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h10a5 5 0 0 1 0 10H11"/>',
});
export const WA_ICON = 'waAi';

const G = globalThis;
const isField = (n) => n.matches('textarea, input');
const HL = () => !!G.CSS?.highlights && typeof Highlight === 'function';
const layer = () => document.getElementById('overlay-layer') || document.body;
const PREF = 'bt.writing.to';

// ———————————————————————————————— the text of an editor, with offsets back to its text nodes
// Blocks become line breaks, a <br> one more, table cells tabs; pictures and controls aren't text, so a change made
// at an offset lands in the right text node and keeps the formatting around it.
const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|TBODY|THEAD|TFOOT|TR|SECTION|ARTICLE|HEADER|FOOTER|FIGURE|HR|DD|DT|DL)$/;
const SKIP = /^(FIGURE|IMG|svg|SVG|BUTTON|INPUT|SELECT|TEXTAREA|SCRIPT|STYLE|TEMPLATE|VIDEO|AUDIO|CANVAS)$/;
export function textMap(root) {
  const segs = [];
  let text = '';
  const nl = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (c.length) {
          segs.push({ node: c, start: text.length });
          text += c.data;
        }
        continue;
      }
      if (c.nodeType !== 1) continue;
      if (c.nodeName === 'BR') {
        text += '\n';
        continue;
      }
      const block = BLOCK.test(c.nodeName);
      if (block) nl();
      if (SKIP.test(c.nodeName) || c.contentEditable === 'false') continue;
      if ((c.nodeName === 'TD' || c.nodeName === 'TH') && c.previousElementSibling) text += '\t';
      walk(c);
      if (block) nl();
    }
  };
  walk(root);
  return { text: text.replace(/ /g, ' '), segs };
}
function point(map, off, end) {
  const S = map.segs;
  for (const g of S) {
    const a = g.start, b = a + g.node.length;
    if (end ? off > a && off <= b : off >= a && off < b) return [g.node, off - a];
  }
  if (end) {
    for (let i = S.length - 1; i >= 0; i--) if (S[i].start + S[i].node.length <= off) return [S[i].node, S[i].node.length];
    return S[0] ? [S[0].node, 0] : null;
  }
  for (const g of S) if (g.start >= off) return [g.node, 0];
  const l = S.at(-1);
  return l ? [l.node, l.node.length] : null;
}
function rangeOf(map, s, e) {
  const a = point(map, s, false), b = s === e ? a : point(map, e, true);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(...a);
    r.setEnd(...b);
  } catch {
    return null;
  }
  return r;
}
function offsetsOf(map, r) {
  let s = null, e = null;
  for (const g of map.segs) {
    if (!r.intersectsNode(g.node)) continue;
    const a = g.node === r.startContainer ? r.startOffset : 0, b = g.node === r.endContainer ? r.endOffset : g.node.length;
    if (s === null) s = g.start + a;
    e = g.start + b;
  }
  return s === null ? null : [s, Math.max(s, e)];
}

// ———————————————————————————————— targets
const targets = new WeakMap(), richRoots = new WeakSet(), lastRange = new WeakMap();
function targetOf(n, o = {}) {
  let tg = targets.get(n);
  if (!tg) {
    tg = { el: n, field: isField(n), o };
    targets.set(n, tg);
    if (!tg.field) richRoots.add(n);
  } else Object.assign(tg.o, o);
  return tg;
}
// the last selection in each editor, so the panel still knows it once the focus is in the panel's own text box
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  for (let n = r.commonAncestorContainer; n; n = n.parentNode) {
    if (richRoots.has(n)) {
      lastRange.set(n, r.cloneRange());
      if (cur?.tg.el === n && cur.view === 'home') {
        cur.range = selOf(cur.tg);
        paintScope();
        drawScope();
      }
      return;
    }
  }
});
const textOf = (tg) => (tg.field ? tg.el.value : textMap(tg.el).text);
const hasText = (tg) => /\S/.test(tg.field ? tg.el.value : tg.el.textContent);
function selOf(tg) {
  if (tg.field) {
    const s = tg.el.selectionStart ?? 0, e = tg.el.selectionEnd ?? 0;
    return e > s ? [s, e] : null;
  }
  const sel = getSelection();
  const live = sel.rangeCount && tg.el.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0) : null;
  const r = live || lastRange.get(tg.el);
  if (!r || r.collapsed || !tg.el.contains(r.startContainer) || !tg.el.contains(r.endContainer)) return null;
  const o = offsetsOf(textMap(tg.el), r);
  return o && o[1] > o[0] ? o : null;
}
function restoreSel(tg) {
  if (tg.field) return;
  const r = lastRange.get(tg.el);
  if (r && tg.el.contains(r.startContainer)) {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
}

// ———————————————————————————————— changing the text like a person typing
// execCommand gives the field a normal input event: its own listeners save the text.
function replaceIn(tg, s, e, str) {
  const n = tg.el;
  if (tg.field) {
    if (n.tagName === 'INPUT') str = str.replace(/\s*\n\s*/g, ' ');
    if (s === e && !str) return;
    n.focus({ preventScroll: true });
    n.setSelectionRange(s, e);
    let ok = false;
    try {
      ok = document.execCommand(str ? 'insertText' : 'delete', false, str);
    } catch {}
    if (!ok) {
      n.setRangeText(str, s, e, 'end');
      n.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    }
    return;
  }
  const r = rangeOf(textMap(n), s, e);
  if (r) typeInto(n, r, str);
}
function typeInto(root, r, str, html) {
  root.focus({ preventScroll: true });
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  if (r.collapsed && !str && !html) return;
  let ok = false;
  try {
    ok = html ? document.execCommand('insertHTML', false, html) : document.execCommand(str ? 'insertText' : 'delete', false, str);
  } catch {}
  if (!ok) {
    r.deleteContents();
    if (str) r.insertNode(document.createTextNode(str));
    root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  }
}

// ———————————————————————————————— results: the Markdown-ish text the models write
const BULLET = /^\s*([-*•])\s+/, NUMBERED = /^\s*\d+[.)]\s+/, TABLE_ROW = /^\s*\|.*\|\s*$/, TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEAD = /^\s*#{1,6}\s+/;
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
/** Strips what a model sometimes wraps around its answer (code fences, quotes the text didn't have). */
export function cleanOut(out, src = '') {
  let s = String(out ?? '').replace(/^\s*```[\w-]*\n?|\n?```\s*$/g, '').trim();
  if (/^["“«]/.test(s) && /["”»]$/.test(s) && !/^["“«]/.test(src.trim())) s = s.slice(1, -1).trim();
  return s;
}
/** Paragraphs, headings, lists and tables as HTML: the preview, and what a rich editor gets. */
export function mdHTML(s) {
  const lines = String(s).split('\n'), out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (TABLE_ROW.test(l) && TABLE_SEP.test(lines[i + 1] || '')) {
      const head = cells(l), rows = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<table><tbody><tr>${head.map((c) => `<td><b>${inl(c)}</b></td>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const kind = BULLET.test(l) ? 'ul' : NUMBERED.test(l) ? 'ol' : '';
    if (kind) {
      const re = kind === 'ul' ? BULLET : NUMBERED, items = [];
      for (; i < lines.length && re.test(lines[i]); i++) items.push(`<li>${inl(lines[i].replace(re, ''))}</li>`);
      out.push(`<${kind}>${items.join('')}</${kind}>`);
      continue;
    }
    if (HEAD.test(l)) out.push(`<h3>${inl(l.replace(HEAD, ''))}</h3>`);
    else out.push(TABLE_SEP.test(l) && l.includes('|') ? '' : `<div>${l.trim() ? inl(TABLE_ROW.test(l) ? cells(l).join(' | ') : l) : '<br>'}</div>`);
    i++;
  }
  return out.join('');
}
/** The same for a plain field: "•" bullets and tables as "a | b" lines. */
export const plainOf = (s) => String(s).split('\n').filter((l) => !(TABLE_SEP.test(l) && l.includes('|'))).map((l) => (TABLE_ROW.test(l) ? cells(l).join(' | ') : l.replace(BULLET, '• ').replace(HEAD, '').replace(/\*\*(.+?)\*\*/g, '$1'))).join('\n');

// ———————————————————————————————— Proofread: word-level changes between two texts
let segmenter;
function toks(s) {
  try {
    segmenter ??= new Intl.Segmenter(lang(), { granularity: 'word' });
    return Array.from(segmenter.segment(s), (x) => x.segment);
  } catch {
    return s.match(/\s+|[\p{L}\p{N}\p{M}’'_-]+|[^]/gu) || [];
  }
}
function diffLine(a, b) {
  if (a === b) return [];
  const A = toks(a), B = toks(b);
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let ea = A.length, eb = B.length;
  while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const n = ea - p, m = eb - p, ops = [];
  if (n * m > 4e6) {
    for (let i = 0; i < n; i++) ops.push([1, A[p + i]]);
    for (let j = 0; j < m; j++) ops.push([2, B[p + j]]);
  } else {
    const W = m + 1, L = new Uint16Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[p + i] === B[p + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    for (let i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && A[p + i] === B[p + j]) { ops.push([0, A[p + i]]); i++; j++; }
      else if (j < m && (i === n || L[i * W + j + 1] >= L[(i + 1) * W + j])) { ops.push([2, B[p + j]]); j++; }
      else { ops.push([1, A[p + i]]); i++; }
    }
  }
  let ca = A.slice(0, p).join('').length, cb = B.slice(0, p).join('').length, hk = null;
  const hunks = [];
  for (const [k, s] of ops) {
    if (k === 0) { hk = null; ca += s.length; cb += s.length; continue; }
    if (!hk) hunks.push((hk = { a0: ca, a1: ca, b0: cb, b1: cb }));
    if (k === 1) hk.a1 = ca += s.length;
    else hk.b1 = cb += s.length;
  }
  // a word split or joined ("alot" → "a lot") reads as one change
  const out = [], part = (x) => x.a0 === x.a1 || x.b0 === x.b1;
  for (const x of hunks) {
    const y = out.at(-1), gap = y && a.slice(y.a1, x.a0);
    if (y && (part(x) || part(y)) && /^[^\S\n]?$/.test(gap) && gap === b.slice(y.b1, x.b0)) { y.a1 = x.a1; y.b1 = x.b1; } else out.push(x);
  }
  return out;
}
/** The changes from `a` to `b`: [{ a0, a1, from, to }] with offsets in `a` (line by line when the lines match up). */
export function diffText(a, b) {
  const la = a.split('\n'), lb = b.split('\n'), out = [];
  if (la.length === lb.length) {
    let oa = 0;
    la.forEach((x, i) => {
      for (const hk of diffLine(x, lb[i])) out.push({ a0: hk.a0 + oa, a1: hk.a1 + oa, from: x.slice(hk.a0, hk.a1), to: lb[i].slice(hk.b0, hk.b1) });
      oa += x.length + 1;
    });
    return out;
  }
  return diffLine(a, b).map((hk) => ({ a0: hk.a0, a1: hk.a1, from: a.slice(hk.a0, hk.a1), to: b.slice(hk.b0, hk.b1) }));
}

// ———————————————————————————————— Chrome's on-device models
const OUT_LANGS = ['en', 'es', 'ja'];
/** The language a text is written in, as far as the models need to know. */
const textLang = (s) => (/[؀-ۿ]/.test(s) ? 'ar' : /[぀-ヿ]/.test(s) ? 'ja' : /[ñ¿¡áéíóú]/i.test(s) && !/[؀-ۿ]/.test(s) ? 'es' : 'en');
const outLang = (s) => (OUT_LANGS.includes(textLang(s)) ? textLang(s) : null);
const lmIO = (l = 'en') => ({ expectedInputs: [{ type: 'text', languages: [l] }], expectedOutputs: [{ type: 'text', languages: [l] }] });
async function avail(name, opts) {
  try {
    if (typeof G[name]?.availability !== 'function') return 'unavailable';
    const s = await G[name].availability(opts);
    return ['available', 'downloadable', 'downloading'].includes(s) ? s : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
const best = (...xs) => (xs.includes('available') ? 'available' : xs.includes('downloading') ? 'downloading' : xs.includes('downloadable') ? 'downloadable' : 'unavailable');

/** What Writing assist can do on this computer. */
export async function assistStatus() {
  const [lm, rw, wr, sm, pr] = await Promise.all([
    avail('LanguageModel', lmIO('en')), avail('Rewriter', {}), avail('Writer', {}), avail('Summarizer', {}), avail('Proofreader', { expectedInputLanguages: ['en'] }),
  ]);
  const tr = typeof G.Translator?.create === 'function' ? 'available' : 'unavailable';
  const tools = {
    proofread: best(pr, lm), style: best(rw, lm), summarize: best(sm, lm), format: best(lm, sm, wr), translate: best(tr, lm), describe: best(lm, rw, wr),
  };
  const all = Object.values(tools);
  return { overall: best(...all), tools, models: { lm, rw, wr, sm, pr, tr } };
}

let progressFn = null;
const monitor = (m) => m.addEventListener?.('downloadprogress', (e) => progressFn?.(e.total && e.total !== 1 ? e.loaded / e.total : e.loaded));
const destroy = (x) => { try { x?.destroy?.(); } catch {} };
const KIND = { note: 'a note', journal: 'a journal entry', reminder: 'the notes of a reminder', contact: 'a note about a contact', wallet: 'a note on a wallet pass', text: 'a text' };
/** A one-off prompt to Gemini Nano. */
async function lmPrompt(system, input, signal) {
  const l = outLang(input) || 'en';
  const s = await G.LanguageModel.create({ ...lmIO(l), initialPrompts: [{ role: 'system', content: system }], signal, monitor });
  try {
    return await s.prompt(input, { signal });
  } finally {
    destroy(s);
  }
}
async function rewriter(input, signal, o) {
  const l = outLang(input);
  const r = await G.Rewriter.create({ tone: 'as-is', length: 'as-is', format: 'plain-text', ...(l ? { outputLanguage: l, expectedInputLanguages: [l] } : {}), ...o.create, signal, monitor });
  try {
    return await r.rewrite(input, { signal, ...(o.context ? { context: o.context } : {}) });
  } finally {
    destroy(r);
  }
}
async function summarizer(input, signal, type, format = 'plain-text') {
  const l = outLang(input);
  const s = await G.Summarizer.create({ type, format, length: 'medium', ...(l ? { outputLanguage: l, expectedInputLanguages: [l] } : {}), signal, monitor });
  try {
    return await s.summarize(input, { signal });
  } finally {
    destroy(s);
  }
}
async function writer(task, input, signal) {
  const l = outLang(input);
  const w = await G.Writer.create({ tone: 'neutral', format: 'markdown', length: 'medium', ...(l ? { outputLanguage: l, expectedInputLanguages: [l] } : {}), signal, monitor });
  try {
    return await w.write(task, { context: input, signal });
  } finally {
    destroy(w);
  }
}
const NA = () => Object.assign(new Error('unavailable'), { msg: t('wa.toolNa') });
const has = (name) => typeof G[name]?.create === 'function';
const keep = (kind) => `The text is ${KIND[kind] || KIND.text}. Keep its language and meaning. Output only the result, with no introduction.`;

export const STYLES = ['professional', 'casual', 'polite', 'social', 'emojify'];
export const FORMATS = ['notes', 'keypoints', 'list', 'table'];
const STYLE_PROMPT = {
  professional: 'Rewrite the user\'s text in a clear, professional tone.',
  casual: 'Rewrite the user\'s text in a relaxed, casual tone, as if talking to a friend.',
  polite: 'Rewrite the user\'s text so it is polite and courteous.',
  social: 'Rewrite the user\'s text as an engaging social media post with a few fitting emojis and two or three relevant hashtags at the end.',
  emojify: 'Add fitting emojis to the user\'s text, keeping its words.',
};
const FORMAT_PROMPT = {
  notes: 'Turn the user\'s text into tidy notes: short "#" headings where useful and "-" bullet points under them.',
  keypoints: 'List the key points of the user\'s text as short "-" bullet points.',
  list: 'Turn the user\'s text into a tidy list of "-" bullet points.',
  table: 'Organise the information in the user\'s text into a Markdown table with a header row.',
};

/** Runs one tool on a text: resolves the result (Markdown-ish), or throws { msg }. */
export async function runTool(tool, text, { signal, kind = 'text', style, format, to, instruction } = {}) {
  const ctx = keep(kind);
  if (tool === 'proofread') {
    if (has('Proofreader') && (await avail('Proofreader', { expectedInputLanguages: [outLang(text) || 'en'] })) !== 'unavailable') {
      const p = await G.Proofreader.create({ expectedInputLanguages: [outLang(text) || 'en'], signal, monitor });
      try {
        const r = await p.proofread(text, { signal });
        if (typeof r?.correctedInput === 'string') return r.correctedInput;
      } finally {
        destroy(p);
      }
    }
    if (has('LanguageModel')) return lmPrompt(`Fix spelling, grammar and punctuation in the user's text. Keep the wording, the line breaks and the language otherwise unchanged. ${ctx}`, text, signal);
    throw NA();
  }
  if (tool === 'style') {
    const tone = { professional: 'more-formal', casual: 'more-casual', polite: 'more-formal' }[style];
    if (has('Rewriter') && (style === 'professional' || style === 'casual') && (await avail('Rewriter', {})) !== 'unavailable') return rewriter(text, signal, { create: { tone } });
    if (has('LanguageModel') && (await avail('LanguageModel', lmIO())) !== 'unavailable') return lmPrompt(`${STYLE_PROMPT[style]} ${ctx}`, text, signal);
    if (has('Rewriter')) return rewriter(text, signal, { create: tone ? { tone } : {}, context: STYLE_PROMPT[style] });
    throw NA();
  }
  if (tool === 'summarize') {
    if (has('Summarizer') && (await avail('Summarizer', {})) !== 'unavailable') return summarizer(text, signal, 'tldr');
    if (has('LanguageModel')) return lmPrompt(`Summarize the user's text in two or three sentences. ${ctx}`, text, signal);
    throw NA();
  }
  if (tool === 'format') {
    if (format === 'keypoints' && has('Summarizer') && (await avail('Summarizer', {})) !== 'unavailable') return summarizer(text, signal, 'key-points', 'markdown');
    if (has('LanguageModel') && (await avail('LanguageModel', lmIO())) !== 'unavailable') return lmPrompt(`${FORMAT_PROMPT[format]} ${ctx}`, text, signal);
    if (has('Writer')) return writer(FORMAT_PROMPT[format].replace("the user's text", 'the context'), text, signal);
    if (has('Summarizer') && format !== 'table') return summarizer(text, signal, 'key-points', 'markdown');
    throw NA();
  }
  if (tool === 'translate') {
    const E = await import('../interpreter/engine.js');
    if (E.supported()) {
      let r = await E.translateText(text, to);
      if (r.status === 'downloadable' && r.from) {
        // the language pack downloads now (this runs from a click)
        await E.translator(r.from, to).catch(() => null);
        r = await E.translateText(text, to, r.from);
      }
      if (r.status === 'ok') return r.out;
      if (r.status === 'unavailable' && !has('LanguageModel')) throw Object.assign(new Error('pair'), { msg: t('wa.pairNa') });
    }
    if (has('LanguageModel')) return lmPrompt(`Translate the user's text into ${langName(to, 'en')}. Output only the translation.`, text, signal);
    throw NA();
  }
  if (tool === 'describe') {
    const how = `Change the user's text as follows: ${String(instruction).slice(0, 400)}. Keep the language unless asked otherwise. Output only the changed text.`;
    if (has('LanguageModel') && (await avail('LanguageModel', lmIO())) !== 'unavailable') return lmPrompt(how, text, signal);
    if (has('Rewriter')) return rewriter(text, signal, { create: {}, context: String(instruction).slice(0, 400) });
    if (has('Writer')) return writer(`Rewrite the context: ${instruction}`, text, signal);
    throw NA();
  }
  throw NA();
}
function langName(code, inLang = lang()) {
  try {
    return new Intl.DisplayNames([inLang], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

// ———————————————————————————————— the panel
let cur = null, raf = 0;
const TOOLS = ['proofread', 'style', 'summarize', 'format', 'translate'];
const TOOL_ICON = { proofread: 'waProof', style: 'waStyle', summarize: 'waSummary', format: 'waFormat', translate: 'waTranslate', describe: 'waAi' };

/** Opens Writing assist for a field or editor (an element, or what attachWritingAssist returned). */
export async function openWritingAssist(target, { anchor, x, y } = {}) {
  const tg = target?.el && targets.has(target.el) ? targets.get(target.el) : targetOf(target?.el || target);
  if (!tg?.el?.isConnected || (tg.o.ok && !tg.o.ok())) return;
  close({ refocus: false });
  if (!hasText(tg)) {
    toast(t('wa.writeFirst'));
    return;
  }
  const pop = h('div', { class: 'wa-panel', role: 'dialog', 'aria-label': t('wa.title') });
  layer().appendChild(pop);
  const c = (cur = { tg, pop, anchor, x, y, view: '', range: selOf(tg), offs: [], status: null, results: {} });
  // buttons keep the focus (and so the selection) in the text; the panel's own text box takes it
  pop.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && !e.target.closest('input')) e.preventDefault();
  });
  pop.addEventListener('click', onClick);
  pop.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = pop.querySelector('.wa-ask input')?.value.trim();
    if (v) run('describe', { instruction: v });
  });
  pop.addEventListener('input', (e) => {
    if (e.target.matches('.wa-ask input')) pop.querySelector('.wa-send').disabled = !e.target.value.trim();
  });
  addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', outside, true);
  hideFab();
  loop();
  show('wait');
  const st = await assistStatus();
  if (cur !== c) return;
  c.status = st;
  show(st.overall === 'unavailable' ? 'na' : st.overall === 'available' ? 'home' : 'setup');
}

function close({ refocus = true } = {}) {
  const c = cur;
  if (!c) return;
  cur = null;
  c.ctrl?.abort();
  removeEventListener('keydown', onKey, true);
  document.removeEventListener('pointerdown', outside, true);
  c.offs.forEach((f) => f());
  clearMarks(c);
  c.pop.classList.add('closing');
  setTimeout(() => c.pop.remove(), 180);
  if (refocus && c.tg.el.isConnected) {
    c.tg.el.focus({ preventScroll: true });
    restoreSel(c.tg);
  }
}
function onKey(e) {
  if (!cur || e.key !== 'Escape') return;
  // a menu or dialog opened over the panel closes first
  if ([...document.querySelectorAll('.ou-menu-scrim, .ou-dialog-scrim')].some((s) => !s._closing)) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  if (cur.view === 'review') finishReview();
  else close();
}
function outside(e) {
  if (!cur) return;
  const n = e.target;
  if (cur.pop.contains(n) || n.closest?.('.ou-menu-scrim, .ou-dialog-scrim, .wa-fab')) return;
  if (cur.tg.el.contains(n) && cur.view !== 'busy') return; // a click in the text picks an underlined change
  if (cur.view === 'review') finishReview();
  else close({ refocus: false });
}
function place() {
  const { pop, anchor, x, y, tg } = cur;
  const pw = Math.min(400, innerWidth - 16);
  pop.style.width = pw + 'px';
  pop.style.maxHeight = Math.min(560, innerHeight - 16) + 'px';
  const ph = pop.offsetHeight;
  // while reviewing, the card sits next to the correction it's about, so it never hides it
  const hk = cur.view === 'review' && cur.hunks?.[cur.i];
  const hr = hk && hunkRect(hk);
  const a = hr || (anchor?.isConnected && anchor.getBoundingClientRect().width ? anchor.getBoundingClientRect() : null);
  let left, top;
  if (a) {
    left = (tg.el && getComputedStyle(tg.el).direction === 'rtl') ? a.right - pw : a.left;
    top = a.bottom + 8;
    if (top + ph > innerHeight - 8) top = a.top - ph - 8;
  } else if (x != null) {
    left = x;
    top = y + 4;
    if (top + ph > innerHeight - 8) top = y - ph - 4;
  } else {
    const r = tg.el.getBoundingClientRect();
    left = r.left + (r.width - pw) / 2;
    top = r.bottom - ph - 12;
  }
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, left)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - ph - 8, top)) + 'px';
}
function hunkRect(hk) {
  if (cur.tg.field) {
    const r = cur.tg.el.getBoundingClientRect();
    return r.width ? r : null;
  }
  const r = rangeOf(textMap(cur.tg.el), hk.p, Math.max(hk.q, hk.p))?.getBoundingClientRect();
  return r && (r.width || r.height) ? r : null;
}
function tick() {
  raf = 0;
  if (cur && (!cur.tg.el.isConnected || document.body.classList.contains('locked'))) close({ refocus: false });
  cur?.mirror?.sync();
  if (fabFor) placeFab();
  if (cur || fabFor) raf = requestAnimationFrame(tick);
}
const loop = () => {
  raf ||= requestAnimationFrame(tick);
};

const head = (title, { back = false } = {}) => h('div', { class: 'wa-head' },
  back ? h('button', { type: 'button', class: 'ou-icon-btn wa-ib wa-back', dataset: { a: 'back' }, title: t('common.back'), 'aria-label': t('common.back'), html: icon('back', 20) }) : h('span', { class: 'wa-logo', html: icon('waAi', 22) }),
  h('b', { class: 'wa-title' }, title),
  h('span', { class: 'wa-scope' }),
  h('button', { type: 'button', class: 'ou-icon-btn wa-ib', dataset: { a: 'close' }, title: t('common.close'), 'aria-label': t('common.close'), html: icon('close', 20) }));
const ask = () => h('form', { class: 'wa-ask' },
  h('span', { html: icon('waAi', 18) }),
  h('input', { type: 'text', placeholder: t('wa.describe'), 'aria-label': t('wa.describe'), maxlength: 300, autocomplete: 'off', enterkeyhint: 'go', dir: 'auto' }),
  h('button', { type: 'submit', class: 'wa-send', disabled: true, title: t('wa.go'), 'aria-label': t('wa.go'), html: icon('waSend', 18) }));
const foot = () => h('div', { class: 'wa-foot' }, t('wa.disclaimer'));
const chipRow = (list, on, attr, label) => h('div', { class: 'wa-chips', role: 'tablist' }, list.map((k) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === on), class: ['wa-chip', k === on && 'on'], dataset: { [attr]: k } }, label(k))));
const toolName = (k) => t('wa.' + k);
/** replaceChildren() would print a null as "null": optional parts are left out instead. */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
function drawScope() {
  const sc = cur?.pop.querySelector('.wa-scope');
  if (sc) sc.textContent = cur.range ? t('wa.selected') : t('wa.allText');
}

function show(view, data = {}) {
  const c = cur;
  if (!c) return;
  const pop = c.pop;
  c.view = view;
  pop.dataset.view = view;
  const st = c.status?.tools || {};
  if (view === 'wait') fill(pop, h('div', { class: 'wa-wait' }, h('span', { class: 'wa-orb' })));
  if (view === 'home') {
    fill(pop, 
      head(t('wa.title')),
      h('div', { class: 'wa-tiles' }, TOOLS.map((k) => h('button', { type: 'button', class: ['wa-tile', st[k] === 'unavailable' && 'off'], dataset: { tool: k }, disabled: st[k] === 'unavailable' },
        h('span', { class: 'wa-tile-ico', html: icon(TOOL_ICON[k], 22) }),
        h('span', { class: 'wa-tile-t' }, h('b', null, toolName(k)), h('small', null, st[k] === 'unavailable' ? t('wa.toolNa') : t('wa.' + k + 'Sub')))))),
      st.describe !== 'unavailable' ? ask() : null,
      foot());
    paintScope();
  }
  if (view === 'busy') {
    fill(pop, 
      head(c.label, { back: true }),
      c.choices || null,
      h('div', { class: 'wa-card wa-busy' }, h('span', { class: 'wa-shimmer' }), h('span', { class: 'wa-shimmer' }), h('span', { class: 'wa-shimmer short' }),
        h('div', { class: 'wa-busy-t', role: 'status' }, data.progress != null ? t('wa.downloading', { p: Math.round(data.progress * 100) }) : t('wa.working'))),
      h('div', { class: 'wa-acts' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'ou-btn', dataset: { a: 'cancel' } }, t('common.cancel'))));
    paintScope();
  }
  if (view === 'result') {
    const applied = !!c.applied;
    fill(pop, 
      head(c.label, { back: true }),
      c.choices || null,
      data.error
        ? h('div', { class: 'wa-card wa-err' }, h('span', { html: icon('info', 20) }), h('span', null, data.error))
        : h('div', { class: 'wa-card wa-res', dir: 'auto', tabindex: 0, html: mdHTML(c.out) }),
      data.error ? null : h('div', { class: 'wa-acts' },
        applied
          ? h('button', { type: 'button', class: 'ou-btn wa-undo', dataset: { a: 'undo' } }, h('span', { html: icon('waUndo', 18) }), t('common.undo'))
          : h('button', { type: 'button', class: 'ou-btn', dataset: { a: 'copy' } }, t('wa.copy')),
        h('span', { style: { flex: 1 } }),
        applied ? null : h('button', { type: 'button', class: 'ou-btn', dataset: { a: 'below' } }, t('wa.insert')),
        h('button', { type: 'button', class: 'ou-btn primary', dataset: { a: applied ? 'done' : 'replace' } }, applied ? t('common.done') : t('wa.replace'))),
      data.error || applied ? null : h('button', { type: 'button', class: 'wa-again', dataset: { a: 'again' } }, h('span', { html: icon('refresh', 16) }), t('wa.again')),
      foot());
    paintScope();
  }
  if (view === 'review') drawReview();
  if (view === 'na') {
    fill(pop, h('div', { class: 'wa-na' },
      h('button', { type: 'button', class: 'ou-icon-btn wa-ib wa-na-x', dataset: { a: 'close' }, title: t('common.close'), 'aria-label': t('common.close'), html: icon('close', 20) }),
      h('span', { class: 'wa-illo', html: icon('waAi', 34) }),
      h('h3', null, t('wa.naTitle')),
      h('p', null, t('wa.naMsg')),
      h('button', { type: 'button', class: 'ou-btn primary', dataset: { a: 'close' } }, t('common.ok'))));
  }
  if (view === 'setup') {
    fill(pop, h('div', { class: 'wa-na' },
      h('button', { type: 'button', class: 'ou-icon-btn wa-ib wa-na-x', dataset: { a: 'close' }, title: t('common.close'), 'aria-label': t('common.close'), html: icon('close', 20) }),
      h('span', { class: 'wa-illo', html: icon('waAi', 34) }),
      h('h3', null, t('wa.setupTitle')),
      h('p', null, t('wa.setupMsg')),
      h('div', { class: 'wa-prog', hidden: true }, h('i')),
      h('span', { class: 'wa-prog-t', role: 'status' }),
      h('button', { type: 'button', class: 'ou-btn primary', dataset: { a: 'download' } }, t('wa.download'))));
  }
  drawScope();
  place();
}

/** Tints the text a tool works on (the selection, or all of it) while the panel is open. */
function paintScope() {
  const c = cur;
  if (!c) return;
  c.tg.el.classList.toggle('wa-glow', c.view === 'busy' && c.tg.field);
  if (c.tg.field || !HL()) return;
  const map = textMap(c.tg.el), [s, e] = c.range || [0, map.text.length];
  const r = ['home', 'busy', 'result'].includes(c.view) && !c.applied ? rangeOf(map, s, e) : null;
  CSS.highlights.delete('wa-scope');
  CSS.highlights.delete('wa-busy');
  if (r) CSS.highlights.set(c.view === 'busy' ? 'wa-busy' : 'wa-scope', new Highlight(r));
}
function clearMarks(c) {
  if (HL()) for (const k of ['wa-scope', 'wa-busy', 'wa-proof', 'wa-proof-cur']) CSS.highlights.delete(k);
  c.tg.el.classList.remove('wa-glow');
  c.mirror?.remove();
  c.mirror = null;
}

async function onClick(e) {
  const c = cur;
  if (!c) return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.tool) return pickTool(d.tool);
  if (d.style) return run('style', { style: d.style });
  if (d.format) return run('format', { format: d.format });
  if (d.p) return reviewAction(d.p);
  switch (d.a) {
    case 'close': return close();
    case 'back':
      c.ctrl?.abort();
      if (c.applied) c.applied = null;
      return show('home');
    case 'cancel':
      c.ctrl?.abort();
      c.ctrl = null;
      return show('home');
    case 'again':
      return run(c.tool, { ...c.args, fresh: true });
    case 'copy':
      navigator.clipboard?.writeText(c.tg.field ? plainOf(c.out) : c.out).then(() => toast(t('wa.copied')), () => {});
      return;
    case 'replace': return apply(false);
    case 'below': return apply(true);
    case 'undo': return undoApply();
    case 'done': return close();
    case 'lang': return pickLang();
    case 'download': return download(b);
  }
}
function pickTool(k) {
  if (k === 'style') return run('style', { style: localStorage.getItem('bt.writing.style') || 'professional' });
  if (k === 'format') return run('format', { format: localStorage.getItem('bt.writing.format') || 'keypoints' });
  if (k === 'translate') return run('translate', { to: targetLang() });
  return run(k, {});
}

/** The language Translate writes in: the last one picked, unless the text is already in it. */
function targetLang() {
  let to = null;
  try {
    to = localStorage.getItem(PREF);
  } catch {}
  const src = textLang(scopeFor('translate').text);
  if (!to) to = lang() === 'ar' ? 'ar' : 'es';
  if (to === src) to = src === 'en' ? (lang() === 'ar' ? 'ar' : 'es') : 'en';
  return to;
}
const LANGS = ['ar', 'en', 'es', 'fr', 'de', 'it', 'pt', 'tr', 'ru', 'hi', 'ur', 'fa', 'id', 'ja', 'ko', 'zh', 'nl', 'pl', 'uk', 'he', 'th', 'vi', 'sv'];
async function pickLang() {
  const c = cur;
  const opts = LANGS.map((code) => ({ value: code, label: langName(code) })).sort((a, b) => a.label.localeCompare(b.label, lang()));
  const v = await choose(t('wa.translateTo'), opts, c.args?.to);
  if (!v || cur !== c) return;
  try {
    localStorage.setItem(PREF, v);
  } catch {}
  run('translate', { to: v });
}

async function download(b) {
  const c = cur, pop = c.pop, bar = pop.querySelector('.wa-prog'), lab = pop.querySelector('.wa-prog-t');
  b.disabled = true;
  bar.hidden = false;
  lab.textContent = t('wa.downloading', { p: 0 });
  const m = c.status?.models || {};
  const name = ['lm', 'rw', 'sm', 'pr', 'wr'].find((k) => m[k] === 'downloadable' || m[k] === 'downloading');
  const api = { lm: 'LanguageModel', rw: 'Rewriter', sm: 'Summarizer', pr: 'Proofreader', wr: 'Writer' }[name];
  try {
    progressFn = (p) => {
      bar.firstChild.style.width = Math.round(p * 100) + '%';
      lab.textContent = t('wa.downloading', { p: Math.round(p * 100) });
    };
    const x = await G[api].create({ ...(api === 'LanguageModel' ? lmIO() : {}), monitor });
    destroy(x);
    if (cur !== c) return;
    c.status = await assistStatus();
    show(c.status.overall === 'available' ? 'home' : 'setup');
  } catch (err) {
    console.warn('writing assist download', err);
    if (cur === c) {
      lab.textContent = t('wa.downloadFailed');
      b.disabled = false;
    }
  } finally {
    progressFn = null;
  }
}

/** What a tool works on: the selection, or all of the text, without the blank edges. */
function scopeFor() {
  const c = cur, tg = c.tg;
  const full = textOf(tg), sel = tg.field ? selOf(tg) : c.range;
  let [s, e] = sel || [0, full.length];
  while (s < e && /\s/.test(full[s])) s++;
  while (e > s && /\s/.test(full[e - 1])) e--;
  return { s, e, text: full.slice(s, e), whole: !sel };
}

async function run(tool, args = {}) {
  const c = cur;
  if (!c) return;
  if (c.view === 'review') finishReview(false);
  if (c.applied) c.applied = null;
  const sc = scopeFor();
  if (!sc.text.trim()) return toast(t('wa.writeFirst'));
  if (tool === 'style') try { localStorage.setItem('bt.writing.style', args.style); } catch {}
  if (tool === 'format') try { localStorage.setItem('bt.writing.format', args.format); } catch {}
  c.ctrl?.abort();
  const ctrl = (c.ctrl = new AbortController());
  const key = JSON.stringify([tool, args.style, args.format, args.to, args.instruction, sc.text]);
  Object.assign(c, { tool, args, sc, out: '', applied: null });
  c.label = tool === 'describe' ? args.instruction : toolName(tool);
  c.choices = tool === 'style' ? chipRow(STYLES, args.style, 'style', (k) => t('wa.s.' + k))
    : tool === 'format' ? chipRow(FORMATS, args.format, 'format', (k) => t('wa.f.' + k))
      : tool === 'translate' ? h('div', { class: 'wa-chips' }, h('button', { type: 'button', class: 'wa-chip wa-lang on', dataset: { a: 'lang' } }, h('span', null, t('wa.to', { lang: langName(args.to) })), h('span', { html: icon('down', 16) })))
        : null;
  if (!args.fresh && c.results[key]) {
    c.out = c.results[key];
    return tool === 'proofread' ? startReview(sc, c.out) : show('result');
  }
  show('busy');
  progressFn = (p) => cur === c && c.view === 'busy' && show('busy', { progress: p });
  let out;
  try {
    out = cleanOut(await runTool(tool, sc.text, { signal: ctrl.signal, kind: c.tg.o.kind, ...args }), sc.text);
  } catch (err) {
    if (ctrl.signal.aborted || cur !== c) return;
    console.warn('writing assist', err);
    c.ctrl = null;
    return show('result', { error: err.msg || t('wa.failed') });
  } finally {
    progressFn = null;
  }
  if (ctrl.signal.aborted || cur !== c) return;
  c.ctrl = null;
  c.out = out;
  c.results[key] = out;
  if (tool === 'proofread') return startReview(sc, out);
  show('result');
}

// ——— Replace, Insert and Undo ———
function apply(below) {
  const c = cur, tg = c.tg, sc = c.sc, out = c.out;
  if (!out) return;
  const full = textOf(tg);
  if (full.slice(sc.s, sc.e) !== sc.text) {
    toast(t('wa.changed'));
    return show('home');
  }
  tg.o.onBefore?.();
  if (tg.field) {
    const one = tg.el.tagName === 'INPUT', text = one ? plainOf(out).replace(/\s*\n\s*/g, ' ') : plainOf(out);
    const now = below ? (one ? ' ' : '\n\n') + text : text, s = below ? sc.e : sc.s;
    replaceIn(tg, s, sc.e, now);
    c.applied = { s, e: s + now.length, now, was: below ? '' : sc.text };
  } else {
    const map = textMap(tg.el), r = rangeOf(map, below ? sc.e : sc.s, sc.e);
    if (!r) return;
    const multi = /\n/.test(out) || BULLET.test(out) || NUMBERED.test(out) || HEAD.test(out);
    c.applied = { rich: true, html: tg.el.innerHTML };
    if (!multi) typeInto(tg.el, r, below ? ' ' + out : out);
    else if (below) {
      r.collapse(false);
      typeInto(tg.el, r, '', '<div><br></div>' + mdHTML(out));
    } else typeInto(tg.el, r, '', mdHTML(out));
  }
  tg.o.onResult?.({ tool: c.tool, text: out, mode: below ? 'insert' : 'replace' });
  show('result');
}
function undoApply() {
  const c = cur, a = c?.applied, tg = c?.tg;
  if (!a) return;
  if (tg.o.undo) tg.o.undo();
  else if (tg.field) {
    if (tg.el.value.slice(a.s, a.e) === a.now) replaceIn(tg, a.s, a.e, a.was);
  } else {
    // the browser's own undo takes the insert back with its formatting; the copy taken before is the fallback
    tg.el.focus({ preventScroll: true });
    const before = tg.el.innerHTML;
    let ok = false;
    try {
      ok = document.execCommand('undo');
    } catch {}
    if (!ok || tg.el.innerHTML === before) {
      tg.el.innerHTML = a.html;
      tg.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'historyUndo' }));
    }
  }
  c.applied = null;
  tg.o.onResult?.({ tool: c.tool, text: '', mode: 'undo' });
  show('result');
}

// ——— Proofread review: the corrections are made at once and underlined; the card steps through them ———
function startReview(sc, out) {
  const c = cur, tg = c.tg;
  const hunks = diffText(sc.text, out).filter((x) => /\S/.test(x.from + x.to) && x.from.trim() !== x.to.trim() && (tg.field || !/[\n\t]/.test(x.from + x.to)));
  if (hunks.length) tg.o.onBefore?.();
  c.self = true;
  try {
    for (const x of [...hunks].reverse()) replaceIn(tg, sc.s + x.a0, sc.s + x.a1, x.to);
  } finally {
    c.self = false;
  }
  let shift = 0;
  for (const x of hunks) {
    x.p = sc.s + x.a0 + shift;
    x.q = x.p + x.to.length;
    x.st = 'on';
    shift += x.to.length - x.from.length;
  }
  Object.assign(c, { hunks, i: 0, applied: null });
  if (hunks.length) tg.o.onResult?.({ tool: 'proofread', text: out, mode: 'proofread' });
  if (tg.field && hunks.length) c.mirror = mirrorFor(tg.el, c.pop);
  // typing ends the review (the offsets would no longer match); a click on an underline picks it
  const onInput = () => {
    if (!c.self && cur === c && c.view === 'review') finishReview(false);
  };
  const onPick = () => setTimeout(() => {
    if (cur !== c || c.view !== 'review') return;
    const s = getSelection(), o = tg.field ? tg.el.selectionStart : s.rangeCount ? offsetsOf(textMap(tg.el), s.getRangeAt(0))?.[0] : null;
    const i = o == null ? -1 : c.hunks.findIndex((x) => x.st === 'on' && o >= x.p && o <= x.q);
    if (i >= 0 && i !== c.i) {
      c.i = i;
      drawReview();
    }
  }, 0);
  tg.el.addEventListener('input', onInput);
  tg.el.addEventListener('click', onPick);
  c.offs.push(() => {
    tg.el.removeEventListener('input', onInput);
    tg.el.removeEventListener('click', onPick);
  });
  if (HL()) {
    CSS.highlights.delete('wa-scope');
    CSS.highlights.delete('wa-busy');
  }
  tg.el.classList.remove('wa-glow');
  reveal();
  show('review');
}
function drawReview() {
  const c = cur, pop = c.pop, H = c.hunks, n = H.length, hk = H[c.i];
  const full = textOf(c.tg), N = 44;
  let ctxEl = null;
  if (hk) {
    const pre = (hk.p > N ? full.slice(hk.p - N, hk.p).replace(/^\S*\s/, '') : full.slice(0, hk.p)).split('\n').at(-1);
    const post = (full.length - hk.q > N ? full.slice(hk.q, hk.q + N).replace(/\s\S*$/, '') : full.slice(hk.q)).split('\n')[0];
    ctxEl = h('p', { class: 'wa-ctx', dir: 'auto' }, hk.p > N ? '…' : '', pre, hk.from ? h('del', null, hk.from) : null, hk.from && hk.to ? ' ' : '', hk.to ? h('ins', null, hk.to) : null, post, full.length - hk.q > N ? '…' : '');
  }
  const state = hk?.st === 'ok' ? t('wa.accepted') : hk?.st === 'off' ? t('wa.reverted') : '';
  fill(pop, 
    h('div', { class: 'wa-head' },
      h('span', { class: 'wa-logo', html: icon('waAi', 22) }),
      h('b', { class: 'wa-title' }, t('wa.proofread')),
      n > 1 ? h('span', { class: 'wa-nav' },
        h('button', { type: 'button', class: 'ou-icon-btn wa-ib', dataset: { p: 'prev' }, title: t('wa.prev'), 'aria-label': t('wa.prev'), html: icon('back', 18) }),
        h('span', { class: 'wa-count', dir: 'ltr' }, `${c.i + 1}/${n}`),
        h('button', { type: 'button', class: 'ou-icon-btn wa-ib', dataset: { p: 'next' }, title: t('wa.next'), 'aria-label': t('wa.next'), html: icon('forward', 18) })) : h('span', { style: { flex: 1 } })),
    n
      ? h('div', { class: 'wa-card wa-fix', dataset: { st: hk.st } }, ctxEl,
        h('div', { class: 'wa-fix-acts' },
          state ? h('span', { class: 'wa-state' }, h('span', { html: icon(hk.st === 'ok' ? 'check' : 'waUndo', 16) }), state) : null,
          h('span', { style: { flex: 1 } }),
          hk.st === 'off' ? h('button', { type: 'button', class: 'ou-btn', dataset: { p: 'use' } }, t('wa.useFix')) : h('button', { type: 'button', class: 'ou-btn', dataset: { p: 'revert' } }, t('wa.revert')),
          hk.st === 'on' ? h('button', { type: 'button', class: 'ou-btn primary', dataset: { p: 'accept' } }, t('wa.accept')) : null))
      : h('div', { class: 'wa-card wa-none' }, h('span', { html: icon('checkCircle', 28) }), h('b', null, t('wa.noFixes'))),
    h('div', { class: 'wa-acts' },
      n ? h('button', { type: 'button', class: 'ou-btn', dataset: { p: 'revert-all' } }, t('wa.revertAll')) : null,
      h('span', { style: { flex: 1 } }),
      h('button', { type: 'button', class: 'ou-btn primary', dataset: { p: 'done' } }, t('common.done'))),
    foot());
  paintProof();
  place();
}
function paintProof() {
  const c = cur;
  if (!c?.hunks) return;
  const on = c.hunks.filter((x) => x.st === 'on' && x.q > x.p), hk = c.hunks[c.i];
  if (c.tg.field) return c.mirror?.paint(on, hk);
  if (!HL()) return;
  const map = textMap(c.tg.el), mk = (list) => new Highlight(...list.map((x) => rangeOf(map, x.p, x.q)).filter(Boolean));
  CSS.highlights.set('wa-proof', mk(on));
  CSS.highlights.set('wa-proof-cur', mk(hk && hk.q > hk.p ? [hk] : []));
}
function reveal() {
  const c = cur, hk = c?.hunks?.[c.i];
  if (!hk) return;
  if (c.tg.field) {
    c.tg.el.focus({ preventScroll: true });
    c.tg.el.setSelectionRange(hk.p, hk.q);
    return;
  }
  rangeOf(textMap(c.tg.el), hk.p, hk.q)?.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
}
function setHunk(hk, on) {
  const c = cur, have = on ? hk.from : hk.to, str = on ? hk.to : hk.from, now = textOf(c.tg).slice(hk.p, hk.q);
  if (now === str) return true;
  if (now !== have) return false;
  const q0 = hk.q, d = str.length - have.length;
  c.self = true;
  try {
    replaceIn(c.tg, hk.p, hk.q, str);
  } finally {
    c.self = false;
  }
  hk.q = hk.p + str.length;
  for (const x of c.hunks) if (x !== hk && x.p >= q0) { x.p += d; x.q += d; }
  return true;
}
function reviewAction(p) {
  const c = cur, H = c.hunks, hk = H?.[c.i], n = H?.length || 0;
  const nextOpen = () => {
    for (let k = 1; k <= n; k++) {
      const j = (c.i + k) % n;
      if (H[j].st === 'on') return j;
    }
    return c.i;
  };
  if (p === 'done') return finishReview();
  if (p === 'prev' || p === 'next') {
    c.i = (c.i + (p === 'next' ? 1 : -1) + n) % n;
    reveal();
    return drawReview();
  }
  if (p === 'revert-all') {
    for (const x of [...H].reverse()) if (x.st !== 'off' && setHunk(x, false)) x.st = 'off';
    c.tg.o.onResult?.({ tool: 'proofread', text: '', mode: 'undo' });
    return finishReview();
  }
  if (!hk) return;
  if (p === 'accept') {
    hk.st = 'ok';
    c.i = nextOpen();
  }
  if (p === 'revert') {
    if (!setHunk(hk, false)) return finishReview();
    hk.st = 'off';
    c.i = nextOpen();
  }
  if (p === 'use') {
    if (!setHunk(hk, true)) return finishReview();
    hk.st = 'ok';
  }
  if (p === 'revert' || p === 'use') c.tg.o.onResult?.({ tool: 'proofread', text: '', mode: 'proofread' });
  reveal();
  drawReview();
}
/** Keeps every correction not reverted and ends the review. */
function finishReview(closeToo = true) {
  const c = cur;
  if (!c?.hunks) {
    if (closeToo) close();
    return;
  }
  for (const x of c.hunks) if (x.st === 'on') x.st = 'ok';
  c.offs.forEach((f) => f());
  c.offs = [];
  clearMarks(c);
  c.hunks = null;
  if (closeToo) close();
}

// ——— underlines over a plain field: a transparent copy of it lies on top and draws them ———
function mirrorFor(f, before) {
  const m = h('div', { class: 'wa-mirror', 'aria-hidden': 'true' });
  layer().insertBefore(m, before);
  const cs = getComputedStyle(f);
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'textAlign', 'direction', 'tabSize', 'unicodeBidi',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) m.style[k] = cs[k];
  m.style.whiteSpace = f.tagName === 'INPUT' ? 'pre' : 'pre-wrap';
  return {
    paint(list, curH) {
      const v = f.value;
      let s = '', i = 0;
      for (const x of [...list].sort((a, b) => a.p - b.p)) {
        if (x.p < i) continue;
        s += esc(v.slice(i, x.p)) + `<mark class="${x === curH ? 'cur' : ''}">${esc(v.slice(x.p, x.q))}</mark>`;
        i = x.q;
      }
      m.innerHTML = s + esc(v.slice(i)) + '​';
      this.sync();
    },
    sync() {
      const r = f.getBoundingClientRect();
      Object.assign(m.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      m.scrollTop = f.scrollTop;
      m.scrollLeft = f.scrollLeft;
    },
    remove() {
      m.remove();
    },
  };
}

// ——— the Galaxy AI button on a focused plain field ———
let fab = null, fabFor = null, fabIdle = 0;
function fabEl() {
  if (fab?.isConnected) return fab;
  fab = h('button', { type: 'button', class: 'wa-fab', hidden: true, title: t('wa.title'), 'aria-label': t('wa.title'), html: icon('waAi', 18) });
  fab.addEventListener('pointerdown', (e) => e.preventDefault()); // the field keeps its focus and selection
  fab.addEventListener('click', () => fabFor && openWritingAssist(fabFor.el, { anchor: fab }));
  layer().appendChild(fab);
  return fab;
}
function showFab(tg) {
  fabFor = tg;
  clearTimeout(fabIdle);
  if (!cur) {
    fabEl();
    placeFab();
    loop();
  }
}
function hideFab(forget = false) {
  clearTimeout(fabIdle);
  if (fab) fab.hidden = true;
  if (forget) fabFor = null;
}
function placeFab() {
  const tg = fabFor, f = fab;
  if (!f) return;
  if (!tg?.el.isConnected || document.activeElement !== tg.el) return hideFab(true);
  if (cur || !hasText(tg) || tg.typing) {
    f.hidden = true;
    return;
  }
  const r = tg.el.getBoundingClientRect(), S = 26;
  const rtl = getComputedStyle(tg.el).direction === 'rtl';
  const x = rtl ? r.left + 4 : r.right - S - 4, y = r.height < S + 10 ? r.top + (r.height - S) / 2 : r.bottom - S - 4;
  const hit = document.elementsFromPoint(x + S / 2, y + S / 2).find((n) => !f.contains(n));
  if (!hit || !(hit === tg.el || tg.el.contains(hit))) {
    f.hidden = true;
    return;
  }
  f.hidden = false;
  f.style.left = x + 'px';
  f.style.top = y + 'px';
}

/** Offers Writing assist on a field or editor (see the top of this file). */
export function attachWritingAssist(el, opts = {}) {
  if (!el) return null;
  const { button, bar, btnClass, menu: useMenuOpt, ...o } = opts;
  const tg = targetOf(el, o);
  const handle = { el, open: (at = {}) => openWritingAssist(el, at), detach: () => tg.off?.() };
  const hook = (b) => {
    if (!b || b._wa) return;
    b._wa = true;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openWritingAssist(el, { anchor: b });
    });
  };
  hook(button);
  if (bar && !bar.querySelector('.wa-barbtn')) {
    const b = h('button', { type: 'button', class: [btnClass || 'ou-icon-btn', 'wa-barbtn'], title: t('wa.title'), 'aria-label': t('wa.title'), html: icon('waAi', 22) });
    bar.appendChild(b);
    hook(b);
  }
  if (el._wa) return handle;
  el._wa = true;
  const useMenu = useMenuOpt ?? !tg.field;
  const offs = [];
  if (useMenu) {
    const onCtx = (e) => {
      if (e.shiftKey || !hasText(tg) || (tg.o.ok && !tg.o.ok())) return; // Shift + right-click keeps Chrome's menu
      e.preventDefault();
      if (!tg.field) {
        const s = getSelection();
        if (s.rangeCount && el.contains(s.getRangeAt(0).commonAncestorContainer)) lastRange.set(el, s.getRangeAt(0).cloneRange());
      }
      const sel = !!selOf(tg);
      const clip = (cmd) => {
        el.focus({ preventScroll: true });
        restoreSel(tg);
        document.execCommand(cmd);
      };
      menu(e, [
        writingAssistItem(el, e),
        '-',
        sel ? { label: t('wa.cut'), icon: 'edit', onClick: () => clip('cut') } : null,
        sel ? { label: t('wa.copy'), icon: 'copy', onClick: () => clip('copy') } : null,
        { label: t('wa.selectAll'), icon: 'text', onClick: () => { el.focus({ preventScroll: true }); if (tg.field) el.select(); else { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); } } },
      ]);
    };
    el.addEventListener('contextmenu', onCtx);
    offs.push(() => el.removeEventListener('contextmenu', onCtx));
  }
  if (tg.field && o.float !== false) {
    const onFocus = () => showFab(tg);
    const onBlur = () => setTimeout(() => fabFor === tg && document.activeElement !== el && hideFab(true), 0);
    // typing hides the button for a moment, like the keyboard's suggestion strip
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      tg.typing = true;
      clearTimeout(fabIdle);
      fabIdle = setTimeout(() => (tg.typing = false), 900);
    };
    const onSelect = () => {
      tg.typing = false;
      showFab(tg);
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('select', onSelect);
    offs.push(() => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('select', onSelect);
    });
    if (document.activeElement === el) showFab(tg);
  }
  tg.off = () => {
    offs.forEach((f) => f());
    el._wa = false;
    if (cur?.tg === tg) close({ refocus: false });
  };
  return handle;
}

/** A right-click menu item (ui.js menu()) for editors that build their own menu. */
export const writingAssistItem = (el, at) => ({ label: t('wa.title'), icon: 'waAi', onClick: () => openWritingAssist(el, at && 'clientX' in at ? { x: at.clientX, y: at.clientY } : {}) });

addStrings({
  en: {
    'wa.title': 'Writing assist',
    'wa.proofread': 'Proofread',
    'wa.proofreadSub': 'Fix spelling and grammar',
    'wa.style': 'Style',
    'wa.styleSub': 'Change the tone',
    'wa.summarize': 'Summarize',
    'wa.summarizeSub': 'Get the main points in brief',
    'wa.format': 'Format',
    'wa.formatSub': 'Notes, key points, list or table',
    'wa.translate': 'Translate',
    'wa.translateSub': 'Into another language',
    'wa.describe': 'Describe a change',
    'wa.go': 'Go',
    'wa.s.professional': 'Professional',
    'wa.s.casual': 'Casual',
    'wa.s.polite': 'Polite',
    'wa.s.social': 'Social',
    'wa.s.emojify': 'Emojify',
    'wa.f.notes': 'Notes',
    'wa.f.keypoints': 'Key points',
    'wa.f.list': 'List',
    'wa.f.table': 'Table',
    'wa.to': 'To {lang}',
    'wa.translateTo': 'Translate to',
    'wa.selected': 'Selected text',
    'wa.allText': 'All text',
    'wa.working': 'Galaxy AI is writing…',
    'wa.downloading': 'Downloading the on-device model… {p}%',
    'wa.copy': 'Copy',
    'wa.copied': 'Copied to clipboard',
    'wa.insert': 'Insert',
    'wa.replace': 'Replace',
    'wa.again': 'Regenerate',
    'wa.cut': 'Cut',
    'wa.selectAll': 'Select all',
    'wa.disclaimer': 'Results are generated on this device by AI and may be inaccurate.',
    'wa.writeFirst': 'Write something first',
    'wa.changed': 'The text changed. Try again.',
    'wa.failed': 'Writing assist couldn’t finish. Try again.',
    'wa.toolNa': 'Not available on this device',
    'wa.pairNa': 'Translation between these languages isn’t available on this device.',
    'wa.naTitle': 'Writing assist isn’t available',
    'wa.naMsg': 'Writing assist uses Chrome’s built-in, on-device AI (Gemini Nano and its writing, summary and translation models). It works in Chrome 138 or later on computers that support it. Your text never leaves this computer.',
    'wa.setupTitle': 'Set up Writing assist',
    'wa.setupMsg': 'Writing assist needs Chrome’s on-device model, a one-time download. After that it works offline and your text never leaves this computer.',
    'wa.download': 'Download',
    'wa.downloadFailed': 'Couldn’t download the model',
    'wa.accept': 'Accept',
    'wa.revert': 'Revert',
    'wa.useFix': 'Use suggestion',
    'wa.revertAll': 'Revert all',
    'wa.accepted': 'Accepted',
    'wa.reverted': 'Reverted',
    'wa.noFixes': 'No suggestions. Looks good!',
    'wa.prev': 'Previous',
    'wa.next': 'Next',
  },
  ar: {
    'wa.title': 'مساعد الكتابة',
    'wa.proofread': 'تدقيق',
    'wa.proofreadSub': 'تصحيح الإملاء والنحو',
    'wa.style': 'النمط',
    'wa.styleSub': 'تغيير أسلوب الكتابة',
    'wa.summarize': 'تلخيص',
    'wa.summarizeSub': 'أهم النقاط باختصار',
    'wa.format': 'تنسيق',
    'wa.formatSub': 'ملاحظات أو نقاط رئيسية أو قائمة أو جدول',
    'wa.translate': 'ترجمة',
    'wa.translateSub': 'إلى لغة أخرى',
    'wa.describe': 'صف التغيير المطلوب',
    'wa.go': 'تنفيذ',
    'wa.s.professional': 'احترافي',
    'wa.s.casual': 'غير رسمي',
    'wa.s.polite': 'مهذب',
    'wa.s.social': 'للتواصل الاجتماعي',
    'wa.s.emojify': 'إضافة رموز تعبيرية',
    'wa.f.notes': 'ملاحظات',
    'wa.f.keypoints': 'نقاط رئيسية',
    'wa.f.list': 'قائمة',
    'wa.f.table': 'جدول',
    'wa.to': 'إلى {lang}',
    'wa.translateTo': 'الترجمة إلى',
    'wa.selected': 'النص المحدد',
    'wa.allText': 'كل النص',
    'wa.working': 'يكتب Galaxy AI…',
    'wa.downloading': 'جارٍ تنزيل النموذج على الجهاز… ⁦{p}%⁩',
    'wa.copy': 'نسخ',
    'wa.copied': 'تم النسخ إلى الحافظة',
    'wa.insert': 'إدراج',
    'wa.replace': 'استبدال',
    'wa.again': 'إعادة الإنشاء',
    'wa.cut': 'قص',
    'wa.selectAll': 'تحديد الكل',
    'wa.disclaimer': 'تُنشأ النتائج على هذا الجهاز بالذكاء الاصطناعي وقد تكون غير دقيقة.',
    'wa.writeFirst': 'اكتب شيئًا أولًا',
    'wa.changed': 'تغيّر النص. حاول مرة أخرى.',
    'wa.failed': 'تعذّر على مساعد الكتابة إكمال المهمة. حاول مرة أخرى.',
    'wa.toolNa': 'غير متاح على هذا الجهاز',
    'wa.pairNa': 'الترجمة بين هاتين اللغتين غير متاحة على هذا الجهاز.',
    'wa.naTitle': 'مساعد الكتابة غير متاح',
    'wa.naMsg': 'يستخدم مساعد الكتابة الذكاء الاصطناعي المدمج في Chrome والذي يعمل على الجهاز (Gemini Nano ونماذج الكتابة والتلخيص والترجمة). يعمل في Chrome 138 أو أحدث على أجهزة الكمبيوتر التي تدعمه. لا يغادر نصك هذا الكمبيوتر أبدًا.',
    'wa.setupTitle': 'إعداد مساعد الكتابة',
    'wa.setupMsg': 'يحتاج مساعد الكتابة إلى نموذج Chrome على الجهاز، ويُنزَّل مرة واحدة. بعد ذلك يعمل دون اتصال ولا يغادر نصك هذا الكمبيوتر.',
    'wa.download': 'تنزيل',
    'wa.downloadFailed': 'تعذّر تنزيل النموذج',
    'wa.accept': 'قبول',
    'wa.revert': 'تراجع',
    'wa.useFix': 'استخدام الاقتراح',
    'wa.revertAll': 'التراجع عن الكل',
    'wa.accepted': 'تم القبول',
    'wa.reverted': 'تم التراجع',
    'wa.noFixes': 'لا توجد اقتراحات. يبدو النص جيدًا!',
    'wa.prev': 'السابق',
    'wa.next': 'التالي',
  },
});
