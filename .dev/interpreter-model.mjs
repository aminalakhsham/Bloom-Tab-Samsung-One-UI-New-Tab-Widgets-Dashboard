// Interpreter pure logic: language names in English, Arabic and native spellings, the Finder command parser, script
// guessing and the store helpers. usage: node .dev/interpreter-model.mjs (exit 1 on failure)
import * as M from '../js/interpreter/model.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else fail++;
  console.log(cond ? '  ok' : 'FAIL', msg);
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} → ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' (want ' + JSON.stringify(b) + ')'}`);

// ——— language names ———
const names = {
  spanish: 'es', Spanish: 'es', 'SPANISH': 'es', español: 'es', espanol: 'es', french: 'fr', français: 'fr', francais: 'fr', german: 'de', deutsch: 'de',
  english: 'en', arabic: 'ar', japanese: 'ja', '日本語': 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', 'simplified chinese': 'zh',
  'traditional chinese': 'zh-Hant', 'chinese (traditional)': 'zh-Hant', hebrew: 'he', norwegian: 'no', 'bahasa indonesia': 'id', 'the Spanish language': 'es',
  // Arabic, with and without ال, ة/ي endings and any hamza
  'الإنجليزية': 'en', 'الانجليزية': 'en', 'إنجليزي': 'en', 'انجليزي': 'en', 'الإنكليزية': 'en', 'الفرنسية': 'fr', 'فرنسي': 'fr', 'الإسبانية': 'es', 'اسباني': 'es',
  'الألمانية': 'de', 'ألماني': 'de', 'الماني': 'de', 'العربية': 'ar', 'عربي': 'ar', 'اليابانية': 'ja', 'الصينية': 'zh', 'الصينية التقليدية': 'zh-Hant',
  'الإيطالية': 'it', 'ايطالي': 'it', 'التركية': 'tr', 'الروسية': 'ru', 'الكورية': 'ko', 'الهندية': 'hi', 'اللغة الإنجليزية': 'en', 'العبرية': 'he',
  // codes
  es: 'es', 'zh-Hant': 'zh-Hant', 'zh-hant': 'zh-Hant',
};
for (const [n, c] of Object.entries(names)) eq(M.langCode(n), c, `langCode(${n})`);
for (const n of ['klingon', 'farsi', '', 'to', 'من', 'hello world']) eq(M.langCode(n), null, `langCode(${n}) is not a language`);
ok(M.LANGS.every((c) => M.langCode(M.nameOf(c, 'en')) === c), 'every English display name parses back to its code');
ok(M.LANGS.every((c) => M.langCode(M.nameOf(c, 'ar')) === c), 'every Arabic display name parses back to its code (' + M.LANGS.filter((c) => M.langCode(M.nameOf(c, 'ar')) !== c).map((c) => c + '=' + M.nameOf(c, 'ar')).join(', ') + ')');
eq(M.nameOf('es', 'en'), 'Spanish', 'nameOf es in English');
eq(M.nameOf('es', 'ar'), 'الإسبانية', 'nameOf es in Arabic');
eq(M.nameOf('zh', 'en'), 'Simplified Chinese', 'Chinese says its script');
eq(M.nativeName('es'), 'Español', 'native name, capitalized');
eq(M.dirOf('ar'), 'rtl', 'Arabic is right to left');
eq(M.dirOf('he'), 'rtl', 'Hebrew is right to left');
eq(M.dirOf('zh-Hant'), 'ltr', 'Chinese is left to right');
eq(M.htmlLang('zh'), 'zh-Hans', 'lang attribute for Chinese');

// ——— Finder command ———
const cmds = [
  ['translate good morning to spanish', { text: 'good morning', to: 'es', from: null }],
  ['Translate Good Morning to Spanish', { text: 'Good Morning', to: 'es', from: null }],
  ['translate I love you into French', { text: 'I love you', to: 'fr', from: null }],
  ['translate where is the station in japanese', { text: 'where is the station', to: 'ja', from: null }],
  ['translate "to be or not to be" to german', { text: 'to be or not to be', to: 'de', from: null }],
  ['translate hola from spanish to english', { text: 'hola', to: 'en', from: 'es' }],
  ['translate thank you to chinese traditional', { text: 'thank you', to: 'zh-Hant', from: null }],
  ['translate where are you from to arabic', { text: 'where are you from', to: 'ar', from: null }],
  ['translate: hello to korean', { text: 'hello', to: 'ko', from: null }],
  ['how do you say thank you in italian?', { text: 'thank you', to: 'it', from: null }],
  ['translate مرحبا to english', { text: 'مرحبا', to: 'en', from: null }],
  ['ترجم صباح الخير إلى الإنجليزية', { text: 'صباح الخير', to: 'en', from: null }],
  ['ترجم صباح الخير الى الانجليزي', { text: 'صباح الخير', to: 'en', from: null }],
  ['ترجم hello إلى العربية', { text: 'hello', to: 'ar', from: null }],
  ['ترجم شكرا للفرنسية', { text: 'شكرا', to: 'fr', from: null }],
  ['ترجم شكرا بالإسبانية', { text: 'شكرا', to: 'es', from: null }],
  ['ترجمة كتاب إلى الصينية التقليدية', { text: 'كتاب', to: 'zh-Hant', from: null }],
  ['ترجم لي أين المحطة إلى اليابانية', { text: 'أين المحطة', to: 'ja', from: null }],
  ['ترجم hello to arabic', { text: 'hello', to: 'ar', from: null }],
  ['ترجم bonjour من الفرنسية إلى العربية', { text: 'bonjour', to: 'ar', from: 'fr' }],
  ['translate hello', { text: 'hello', to: null, from: null }],
  ['translate good morning to', { text: 'good morning to', to: null, from: null }],
  ['ترجم مرحبا', { text: 'مرحبا', to: null, from: null }],
];
for (const [q, want] of cmds) eq(M.parseCommand(q), want, `parseCommand(${q})`);
for (const q of ['translate', 'translate ', 'translation of hello', 'hello to spanish', 'transl', 'تَرجمان', 'timer 5m']) eq(M.parseCommand(q), null, `parseCommand(${q}) is not a command`);

// ——— script guess (fallback when LanguageDetector can't tell) ———
eq(M.guessScript('مرحبا بك'), 'ar', 'Arabic script');
eq(M.guessScript('こんにちは'), 'ja', 'kana');
eq(M.guessScript('안녕하세요'), 'ko', 'Hangul');
eq(M.guessScript('你好'), 'zh', 'Han');
eq(M.guessScript('Γειά σου'), 'el', 'Greek');
eq(M.guessScript('hello'), null, 'Latin could be many languages');

// ——— store shape and helpers ———
const d = M.norm(null, 'ar');
ok(d.from === 'ar' && d.to === 'en' && d.convo.a === 'ar' && d.convo.b === 'en' && d.convo.f2f === true, 'defaults follow the UI language');
ok(M.norm(null, 'en').to === 'es', 'English speakers start with Spanish');
const bad = M.norm({ from: 'xx', to: 7, history: [{ src: '' }, { src: 'Hi', out: 'Hola', from: 'en', to: 'es' }, 'junk'], favs: null, convo: { msgs: [{ src: 'x', side: 'q' }] }, listen: { lines: [{ src: '' }, { src: 'a' }] } });
ok(bad.from === 'en' && bad.to === 'es' && bad.history.length === 1 && bad.favs.length === 0 && bad.convo.msgs[0].side === 'a' && bad.listen.lines.length === 1, 'norm tolerates corrupt data');
eq(M.norm({ from: 'auto' }).from, 'auto', 'Auto detect survives norm');
const x = M.norm(null);
const id1 = M.addHistory(x, { src: 'Hel', out: 'Hol', from: 'en', to: 'es' });
const id2 = M.addHistory(x, { src: 'Hello', out: 'Hola', from: 'en', to: 'es' }, id1);
ok(id1 === id2 && x.history.length === 1 && x.history[0].src === 'Hello', 'one typing session makes one history entry');
M.addHistory(x, { src: 'Bye', out: 'Adiós', from: 'en', to: 'es' });
M.addHistory(x, { src: 'Hello', out: 'Hola', from: 'en', to: 'es' });
ok(x.history.length === 2 && x.history[0].src === 'Hello', 'the same phrase again moves to the top, no duplicate');
ok(M.toggleFav(x, x.history[0]) === true && x.favs.length === 1 && M.findFav(x, { src: 'Hello ', from: 'en', to: 'es' }), 'star adds a favourite');
ok(M.toggleFav(x, { src: 'Hello', out: 'Hola', from: 'en', to: 'es' }) === false && x.favs.length === 0, 'star again removes it');
const m = M.addMsg(x, 'b', 'Hola', 'Hello');
ok(x.convo.msgs.length === 1 && m.side === 'b' && M.other('b') === 'a', 'conversation messages');
M.addLine(x, 'Bonjour', 'Hello');
ok(x.listen.lines.length === 1, 'listening lines');
const p = M.normPrefs({ tab: 'listen', typing: false, rate: 3, history: 'yes' });
ok(p.tab === 'listen' && p.typing === false && p.rate === 1 && p.history === true && p.original === true, 'prefs are validated');

console.log(`---- ${pass} passed, ${fail} failed ----`);
process.exit(fail ? 1 : 0);
