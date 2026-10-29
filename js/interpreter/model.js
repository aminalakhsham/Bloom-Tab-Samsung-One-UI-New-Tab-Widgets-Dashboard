// Interpreter data and pure logic (no DOM, no storage, no imports), shared by the app, its widget, the Finder
// command and the plain-node test (.dev/interpreter-model.mjs).
//
// Store key `interpreter` (this device only):
// {
//   v: 1,
//   from: 'auto' | code, to: code,       // the Text tab's languages ('auto' = Auto detect)
//   last: code,                          // the last source language picked, used when Auto detect finds the target
//   history: [Entry], favs: [Entry],     // newest first; Entry = { id, src, out, from, to, at }
//   convo: { a: code, b: code, f2f: bool, msgs: [{ id, side: 'a' | 'b', src, out, at }] },  // a = you (bottom half)
//   listen: { from: code, to: code, lines: [{ id, src, out, at }] },                     // Listening mode
// }
// Store key `interpreterPrefs`: { tab, typing, original, autoSpeak, rate, history } (see PREF_DEFAULTS).
// Codes are the BCP 47 tags Chrome's Translator API takes ('en', 'zh-Hant'…).
export const KEY = 'interpreter';
export const PREFS = 'interpreterPrefs';
export const MAX_HISTORY = 100, MAX_FAVS = 300, MAX_MSGS = 200, MAX_LINES = 200;

// The languages Chrome translates on the device (developer.chrome.com/docs/ai/translator-api).
export const LANGS = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant'];
const RTL = new Set(['ar', 'he', 'iw', 'fa', 'ur']);
export const dirOf = (code) => (RTL.has(baseOf(code)) ? 'rtl' : 'ltr');
export const baseOf = (code) => String(code || '').split('-')[0].toLowerCase();
/** Value for the `lang` attribute, so Chinese, Japanese and Korean text get their own glyphs and Arabic its font. */
export const htmlLang = (code) => (code === 'zh' ? 'zh-Hans' : code || '');

/** The language's name in the UI language ("Spanish", "الإسبانية"); Chinese says which script, like Samsung's list. */
const dn = new Map();
export function nameOf(code, ui = 'en') {
  if (!code) return '';
  try {
    if (!dn.has(ui)) dn.set(ui, new Intl.DisplayNames([ui], { type: 'language' }));
    return dn.get(ui).of(htmlLang(code)) || code;
  } catch {
    return code;
  }
}
/** The language's name in itself ("Español", "日本語"), shown under each language in the lists. */
export const nativeName = (code) => {
  const n = nameOf(code, htmlLang(code));
  return n ? n.charAt(0).toLocaleUpperCase(htmlLang(code)) + n.slice(1) : code;
};

// ——— language names for the Finder command ———
// English, Arabic and native names. Arabic names are matched with or without "ال", with ية or ي and with any hamza
// (الإيطالية = إيطالي = ايطالي); Latin ones without accents (francais = français).
const NAMES = {
  ar: 'arabic|العربية|عربي|عربى',
  bg: 'bulgarian|البلغارية|български',
  bn: 'bengali|bangla|البنغالية|البنغالي|বাংলা',
  cs: 'czech|التشيكية|čeština',
  da: 'danish|الدنماركية|الدانمركية|dansk',
  de: 'german|الألمانية|الماني|deutsch',
  el: 'greek|اليونانية|ελληνικά',
  en: 'english|الإنجليزية|الإنكليزية|انجلش',
  es: 'spanish|castilian|الإسبانية|الاسبانيولية|español',
  fi: 'finnish|الفنلندية|suomi',
  fr: 'french|الفرنسية|français',
  he: 'hebrew|العبرية|עברית',
  hi: 'hindi|الهندية|हिन्दी|हिंदी',
  hr: 'croatian|الكرواتية|hrvatski',
  hu: 'hungarian|المجرية|الهنغارية|magyar',
  id: 'indonesian|bahasa indonesia|bahasa|الإندونيسية',
  it: 'italian|الإيطالية|italiano',
  ja: 'japanese|اليابانية|日本語',
  kn: 'kannada|الكانادا|الكنادية|ಕನ್ನಡ',
  ko: 'korean|الكورية|한국어',
  lt: 'lithuanian|الليتوانية|lietuvių',
  mr: 'marathi|الماراثية|मराठी',
  nl: 'dutch|flemish|الهولندية|nederlands',
  no: 'norwegian|bokmal|norwegian bokmal|النرويجية|norsk',
  pl: 'polish|البولندية|polski',
  pt: 'portuguese|brazilian portuguese|البرتغالية|português',
  ro: 'romanian|الرومانية|română',
  ru: 'russian|الروسية|русский',
  sk: 'slovak|السلوفاكية|slovenčina',
  sl: 'slovenian|slovene|السلوفينية|السلوفانية|slovenščina',
  sv: 'swedish|السويدية|svenska',
  ta: 'tamil|التاميلية|தமிழ்',
  te: 'telugu|التيلوغوية|التيلجو|తెలుగు',
  th: 'thai|التايلاندية|التايلندية|ไทย',
  tr: 'turkish|التركية|türkçe',
  uk: 'ukrainian|الأوكرانية|українська',
  vi: 'vietnamese|الفيتنامية|tiếng việt',
  zh: 'chinese|mandarin|simplified chinese|chinese simplified|الصينية|الصينية المبسطة|中文|汉语|普通话|简体中文',
  'zh-Hant': 'traditional chinese|chinese traditional|الصينية التقليدية|繁體中文|繁体中文',
};
// Words that may surround a language name: "the Spanish language", "اللغة الإسبانية".
const STOP = new Set(['the', 'language', 'لغ']);

/** One word folded for matching: lower case, no accents or harakat, Arabic "ال" and ة/ى endings evened out. */
export function foldWord(w) {
  let s = String(w || '').toLowerCase().replace(/ـ/g, '');
  // "ال" goes before the hamza is dropped, or ألماني (→ الماني) would lose its first letters
  if (/^ال./.test(s)) s = s.slice(2);
  s = s.normalize('NFD').replace(/[̀-ًͯ-ٰٟ]/g, '').normalize('NFC');
  return s.replace(/ى/g, 'ي').replace(/ة$/, '');
}
const foldPhrase = (s) => String(s || '').replace(/[.,!?؟،:;"'«»“”„‘’`()[\]{}]/g, ' ').split(/\s+/).filter(Boolean).map(foldWord).filter((w) => w && !STOP.has(w)).join(' ');

const INDEX = new Map();
for (const [code, list] of Object.entries(NAMES)) {
  for (const n of list.split('|')) INDEX.set(foldPhrase(n), code);
}

/** The language code for a name in English, Arabic or the language itself ("spanish", "الإسبانية", "español", "es"). */
export function langCode(name) {
  const k = foldPhrase(name);
  if (!k) return null;
  if (INDEX.has(k)) return INDEX.get(k);
  return LANGS.find((c) => c.toLowerCase() === k) || null;
}

/** The writing system says the language for scripts only one of our languages uses (a fallback for detection). */
export function guessScript(text) {
  const s = String(text || '');
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯ᄀ-ᇿ]/.test(s)) return 'ko';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[؀-ۿݐ-ݿ]/.test(s)) return 'ar';
  if (/[֐-׿]/.test(s)) return 'he';
  if (/[Ͱ-Ͽ]/.test(s)) return 'el';
  if (/[฀-๿]/.test(s)) return 'th';
  if (/[ঀ-৿]/.test(s)) return 'bn';
  if (/[஀-௿]/.test(s)) return 'ta';
  if (/[ఀ-౿]/.test(s)) return 'te';
  if (/[ಀ-೿]/.test(s)) return 'kn';
  if (/[ऀ-ॿ]/.test(s)) return 'hi';
  return null;
}

// ——— Finder command ———
const PREFIX = /^(?:please\s+)?(?:translate|ترجم(?:ي|وا)?(?:\s+لي)?|ترجمة)\s*[:：]?\s+/i;
const SEP = new Set(['to', 'into', 'in', 'إلي', 'الي', 'لل', 'ل', 'الى', 'إلى'].map(foldWord));
const unquote = (s) => {
  s = String(s || '').trim();
  const m = s.match(/^["'“”«»„‘’`]([\s\S]+)["'“”«»‘’`]$/);
  return (m ? m[1] : s).trim();
};

/**
 * Parses "translate good morning to Spanish", "translate hola from spanish into english", "how do you say thanks in
 * French", "ترجم صباح الخير إلى الإنجليزية", "ترجم hello للفرنسية", "ترجم شكرا بالإسبانية".
 * Returns { text, to, from } (to/from null when not given) or null when it isn't a translate command.
 */
export function parseCommand(q) {
  q = String(q || '').trim();
  let m = q.match(/^how (?:do (?:you|i)|to|would you|would i|can i) say\s+(.+?)\s+in\s+(.+?)\s*\??$/i);
  if (m && langCode(m[2])) return { text: unquote(m[1]), to: langCode(m[2]), from: null };
  m = q.match(PREFIX);
  if (!m) return null;
  const rest = q.slice(m[0].length).trim();
  if (!rest) return null;
  const words = rest.split(/\s+/);
  let text = null, to = null;
  for (let n = Math.min(3, words.length - 1); n >= 1 && !to; n--) {
    const head = words.slice(0, -n), tail = words.slice(-n).join(' ');
    // "… to Spanish", "… إلى الإسبانية"
    if (head.length >= 2 && SEP.has(foldWord(head[head.length - 1])) && langCode(tail)) {
      to = langCode(tail);
      text = head.slice(0, -1).join(' ');
      break;
    }
    // Arabic joins the preposition to the name: "للإسبانية" (to Spanish), "بالإسبانية" (in Spanish)
    const joined = tail.match(/^(?:لل|بال)(.+)$/);
    if (joined && langCode(joined[1])) {
      to = langCode(joined[1]);
      text = head.join(' ');
    }
  }
  if (!to) return { text: unquote(rest), to: null, from: null };
  let from = null;
  const f = text.match(/^(.+?)\s+(?:from|من)\s+(\S+(?:\s+\S+)?)$/i);
  if (f && langCode(f[2])) {
    from = langCode(f[2]);
    text = f[1];
  }
  text = unquote(text);
  return text ? { text, to, from: from === to ? null : from } : null;
}

// ——— data ———
/** The pair a new user starts with: their UI language and English (Spanish for English speakers). */
export function defaults(ui = 'en') {
  const mine = LANGS.includes(ui) ? ui : 'en';
  const other = mine === 'en' ? 'es' : 'en';
  return { v: 1, from: mine, to: other, last: mine, history: [], favs: [], convo: { a: mine, b: other, f2f: true, msgs: [] }, listen: { from: other, to: mine, lines: [] } };
}

const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
const code = (v, def) => (typeof v === 'string' && LANGS.includes(v) ? v : def);
const rid = () => Math.random().toString(36).slice(2, 10);
function entry(e) {
  if (!e || typeof e !== 'object') return null;
  const src = str(e.src), out = str(e.out);
  if (!src.trim()) return null;
  return { id: str(e.id, 40) || rid(), src, out, from: code(e.from, 'en'), to: code(e.to, 'en'), at: +e.at || 0 };
}
const list = (v, max, fn = entry) => (Array.isArray(v) ? v : []).map(fn).filter(Boolean).slice(0, max);

/** Tolerates missing, old or corrupt data: always returns the full shape. */
export function norm(v, ui = 'en') {
  const d = defaults(ui);
  if (!v || typeof v !== 'object') return d;
  const from = v.from === 'auto' ? 'auto' : code(v.from, d.from);
  const c = v.convo && typeof v.convo === 'object' ? v.convo : {};
  const l = v.listen && typeof v.listen === 'object' ? v.listen : {};
  const line = (x) => (x && typeof x.src === 'string' && x.src.trim() ? { id: str(x.id, 40) || rid(), src: str(x.src), out: str(x.out), at: +x.at || 0 } : null);
  return {
    v: 1, from, to: code(v.to, d.to), last: code(v.last, from === 'auto' ? d.last : from),
    history: list(v.history, MAX_HISTORY),
    favs: list(v.favs, MAX_FAVS),
    convo: {
      a: code(c.a, d.convo.a), b: code(c.b, d.convo.b), f2f: c.f2f !== false,
      msgs: (Array.isArray(c.msgs) ? c.msgs : []).filter((m) => m && typeof m.src === 'string' && m.src.trim())
        .map((m) => ({ id: str(m.id, 40) || rid(), side: m.side === 'b' ? 'b' : 'a', src: str(m.src), out: str(m.out), at: +m.at || 0 })).slice(-MAX_MSGS),
    },
    listen: { from: code(l.from, d.listen.from), to: code(l.to, d.listen.to), lines: (Array.isArray(l.lines) ? l.lines : []).map(line).filter(Boolean).slice(-MAX_LINES) },
  };
}

const same = (a, b) => a.src.trim() === b.src.trim() && a.from === b.from && a.to === b.to;

/** Puts a finished translation at the top of History. `replace` is the id of the entry the same typing session
 *  made, so "Hel", "Hello", "Hello there" end up as one entry. Returns the entry's id. */
export function addHistory(d, e, replace) {
  const x = entry({ ...e, at: e.at || Date.now() });
  if (!x) return null;
  if (replace) x.id = replace;
  d.history = [x, ...d.history.filter((r) => r.id !== x.id && !same(r, x))].slice(0, MAX_HISTORY);
  return x.id;
}

export const findFav = (d, e) => (e && e.src ? d.favs.find((f) => same(f, e)) || null : null);
/** Stars or unstars a translation. Returns true when it's now a favourite. */
export function toggleFav(d, e) {
  const f = findFav(d, e);
  if (f) {
    d.favs = d.favs.filter((x) => x !== f);
    return false;
  }
  const x = entry({ ...e, id: rid(), at: Date.now() });
  if (!x) return false;
  d.favs = [x, ...d.favs].slice(0, MAX_FAVS);
  return true;
}

export function addMsg(d, side, src, out = '') {
  const m = { id: rid(), side: side === 'b' ? 'b' : 'a', src: str(src), out: str(out), at: Date.now() };
  d.convo.msgs = [...d.convo.msgs, m].slice(-MAX_MSGS);
  return m;
}
/** The other side of a conversation. */
export const other = (side) => (side === 'a' ? 'b' : 'a');

export function addLine(d, src, out = '') {
  const x = { id: rid(), src: str(src), out: str(out), at: Date.now() };
  d.listen.lines = [...d.listen.lines, x].slice(-MAX_LINES);
  return x;
}

// ——— preferences ———
export const TABS = ['text', 'convo', 'listen', 'favs'];
export const PREF_DEFAULTS = { tab: 'text', typing: true, original: true, autoSpeak: false, rate: 1, history: true };
export function normPrefs(p) {
  const o = p && typeof p === 'object' ? p : {};
  const bool = (k) => (typeof o[k] === 'boolean' ? o[k] : PREF_DEFAULTS[k]);
  return {
    tab: TABS.includes(o.tab) ? o.tab : PREF_DEFAULTS.tab,
    typing: bool('typing'), original: bool('original'), autoSpeak: bool('autoSpeak'), history: bool('history'),
    rate: [0.75, 1, 1.25].includes(o.rate) ? o.rate : 1,
  };
}
