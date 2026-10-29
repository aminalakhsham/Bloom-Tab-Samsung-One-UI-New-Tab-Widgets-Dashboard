// Chrome's on-device Translator and LanguageDetector (Chrome 138 or later) and speech output, for the Interpreter app,
// its widget and the Finder command. Chrome downloads each language pack itself the first time it's needed (only
// after a click or key press); the text never leaves the device and we add no network service. Everything fails soft:
// where Chrome doesn't offer an API the callers show Samsung-style "not available" states instead of errors.
import * as M from './model.js';
import { lang, t } from '../core/i18n.js';

const G = globalThis;
export const supported = () => typeof G.Translator?.create === 'function';
export const canDetect = () => typeof G.LanguageDetector?.create === 'function';

export const langName = (code) => M.nameOf(code, lang());
export const sortedLangs = () => [...M.LANGS].sort((a, b) => langName(a).localeCompare(langName(b), lang()));
export const pairLabel = (from, to) => t('interpreter.pair', { from: langName(from), to: langName(to) });

// ——— availability and downloads ———
// Download progress by key ('en>es' for a pair, or a language code from the Language packs page), 0…1.
const progress = new Map();
const subs = new Set();
const notify = () => subs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
export const onProgress = (fn) => (subs.add(fn), () => subs.delete(fn));
export const progressOf = (key) => progress.get(key);
function setProgress(key, v) {
  if (v == null) progress.delete(key);
  else progress.set(key, v);
  notify();
}
// Chrome reports `loaded` as a fraction; early builds sent bytes with a total.
const frac = (e) => (e.total && e.total !== 1 ? e.loaded / e.total : e.loaded) || 0;

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' for translating `from` → `to`. */
export async function pairStatus(from, to) {
  if (!supported() || !from || !to || from === 'auto') return 'unavailable';
  if (from === to) return 'available';
  try {
    return await G.Translator.availability({ sourceLanguage: from, targetLanguage: to });
  } catch {
    return 'unavailable';
  }
}

// A language pack's status. Chrome keeps one model per language, paired with English (which has none of its own).
const stat = new Map();
export const statusOf = (code) => (progress.has(code) ? 'downloading' : stat.get(code));
export async function langStatus(code) {
  if (!supported()) return 'unavailable';
  if (code === 'en') {
    stat.set(code, 'available');
    return 'available';
  }
  if (progress.has(code)) return 'downloading';
  const s = await pairStatus('en', code);
  stat.set(code, s);
  return s;
}
let statP = null;
/** Loads every language's status (once, or again with force). Resolves to the Map code → status. */
export function loadStatuses(force = false) {
  if (!statP || force) statP = Promise.all(M.LANGS.map((c) => langStatus(c))).then(() => stat);
  return statP;
}

const translators = new Map(); // 'from>to' → Promise<Translator>
/** A translator for the pair, downloading what's missing (Chrome needs a click or key press for that). */
export function translator(from, to, key = `${from}>${to}`) {
  const k = `${from}>${to}`;
  if (!translators.has(k)) {
    const p = G.Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => setProgress(key, Math.min(1, frac(e))));
      },
    });
    p.then(() => {
      setProgress(key, null);
      [from, to].forEach((c) => c !== 'en' && stat.set(c, 'available'));
    }, () => {
      translators.delete(k);
      setProgress(key, null);
    });
    translators.set(k, p);
  }
  return translators.get(k);
}
/** Downloads a language pack from the Language packs page. Resolves to true when it's ready. */
export const download = (code) => translator('en', code, code).then(() => true, () => false);
/** Frees the loaded models (the app calls this when it closes). */
export function release() {
  for (const p of translators.values()) p.then((tr) => { try { tr.destroy(); } catch {} }, () => {});
  translators.clear();
  detP?.then((d) => { try { d.destroy(); } catch {} }, () => {});
  detP = null;
}

// ——— detection ———
let detP = null;
const toOurs = (c) => {
  c = String(c || '');
  if (c === 'iw') return 'he';
  if (c === 'zh-TW' || c === 'zh-HK') return 'zh-Hant';
  if (M.LANGS.includes(c)) return c;
  const b = M.baseOf(c);
  return M.LANGS.includes(b) ? b : null;
};
/** The language `text` is written in, or null when Chrome can't tell (or isn't sure). */
export async function detect(text) {
  if (!String(text || '').trim()) return null;
  if (canDetect()) {
    try {
      detP ??= G.LanguageDetector.create();
      const d = await detP;
      const top = (await d.detect(text)).find((r) => r.detectedLanguage && r.detectedLanguage !== 'und');
      if (top && top.confidence >= 0.35) return toOurs(top.detectedLanguage);
    } catch {
      detP = null;
    }
  }
  // scripts only one of our languages uses still say which it is
  return M.guessScript(text);
}

// ——— for the Finder command and the widget ———
/**
 * Translates without downloading anything (no click to allow it): { status, out, from } where status is
 * 'ok' | 'unsupported' (no Translator API) | 'unavailable' (pair) | 'downloadable' (pack missing) | 'nodetect' | 'error'.
 */
export async function translateText(text, to, from) {
  text = String(text || '');
  if (!supported()) return { status: 'unsupported' };
  if (!text.trim() || !to) return { status: 'error' };
  try {
    from = from && from !== 'auto' ? from : (await detect(text)) || (to !== 'en' ? 'en' : null);
    if (!from) return { status: 'nodetect' };
    if (from === to) return { status: 'ok', out: text, from };
    const st = await pairStatus(from, to);
    if (st === 'unavailable') return { status: 'unavailable', from };
    if (st === 'downloadable') return { status: 'downloadable', from };
    return { status: 'ok', out: await (await translator(from, to)).translate(text), from };
  } catch (e) {
    console.warn('interpreter', e);
    return { status: e?.name === 'NotAllowedError' ? 'downloadable' : 'error', from };
  }
}

// ——— speech output ———
// Only voices that run on this device (localService): Chrome's online voices would send the text to a server.
const vbase = (v) => String(v.lang || '').toLowerCase().replace('_', '-');
export function voiceFor(code) {
  try {
    const vs = G.speechSynthesis?.getVoices().filter((v) => v.localService) || [];
    const c = String(code || '').toLowerCase(), b = M.baseOf(code);
    const want = c === 'zh-hant' ? ['zh-tw', 'zh-hk'] : c === 'zh' ? ['zh-cn'] : c === 'he' ? ['he-il', 'iw-il'] : [c];
    return vs.find((v) => want.includes(vbase(v))) || vs.find((v) => vbase(v).split('-')[0] === b && v.default) || vs.find((v) => vbase(v).split('-')[0] === b) || null;
  } catch {
    return null;
  }
}
export const canSpeak = (code) => !!code && !!voiceFor(code);
export function onVoices(fn) {
  const s = G.speechSynthesis;
  if (!s?.addEventListener) return () => {};
  s.addEventListener('voiceschanged', fn);
  return () => s.removeEventListener('voiceschanged', fn);
}
let speaking = null;
/** Speaks `text`; onEnd runs when it finishes or is stopped. */
export function speak(text, code, { rate = 1, onEnd } = {}) {
  stopSpeaking();
  const v = voiceFor(code);
  if (!v || !text) return void onEnd?.();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang;
  u.rate = rate;
  let fired = false;
  const done = () => {
    if (fired) return;
    fired = true;
    if (speaking === u) speaking = null;
    onEnd?.();
  };
  u.onend = done;
  u.onerror = done;
  speaking = u;
  G.speechSynthesis.speak(u);
}
export function stopSpeaking() {
  const u = speaking;
  speaking = null;
  try {
    G.speechSynthesis?.cancel();
  } catch {}
  u?.onend?.();
}
export const isSpeaking = () => !!speaking;
