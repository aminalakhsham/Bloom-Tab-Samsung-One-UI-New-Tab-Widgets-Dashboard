// Voice input for Interpreter through the Web Speech API, on-device only. Chrome's default recognizer sends the audio
// to a Google server, which this extension doesn't do without asking, so the mic shows only where Chrome can
// recognize the language on this device (SpeechRecognition.available({ processLocally: true }), Chrome 139+, or the
// older availableOnDevice()). Everywhere else Interpreter is typed, as its Samsung counterpart is with the keyboard.

const SR = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// Recognizers want a region; these are the ones Galaxy phones pick by default for each language.
const REGION = {
  ar: 'ar-SA', bg: 'bg-BG', bn: 'bn-IN', cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR', en: 'en-US', es: 'es-ES',
  fi: 'fi-FI', fr: 'fr-FR', he: 'he-IL', hi: 'hi-IN', hr: 'hr-HR', hu: 'hu-HU', id: 'id-ID', it: 'it-IT', ja: 'ja-JP',
  kn: 'kn-IN', ko: 'ko-KR', lt: 'lt-LT', mr: 'mr-IN', nl: 'nl-NL', no: 'nb-NO', pl: 'pl-PL', pt: 'pt-BR', ro: 'ro-RO',
  ru: 'ru-RU', sk: 'sk-SK', sl: 'sl-SI', sv: 'sv-SE', ta: 'ta-IN', te: 'te-IN', th: 'th-TH', tr: 'tr-TR', uk: 'uk-UA',
  vi: 'vi-VN', zh: 'zh-CN', 'zh-Hant': 'zh-TW',
};
export const bcp = (code) => REGION[code] || code;

/** Whether this Chrome can recognize speech on the device at all (any language). */
export function hasOnDevice() {
  const C = SR();
  return !!C && (typeof C.available === 'function' || typeof C.availableOnDevice === 'function');
}

const cache = new Map();
/** 'available' | 'downloadable' | 'downloading' | 'unavailable' for recognizing `code` on this device. */
export async function micStatus(code) {
  const C = SR();
  if (!C || !code) return 'unavailable';
  let s = 'unavailable';
  try {
    if (typeof C.available === 'function') s = await C.available({ langs: [bcp(code)], processLocally: true });
    else if (typeof C.availableOnDevice === 'function') s = await C.availableOnDevice(bcp(code));
  } catch {}
  s = ['available', 'downloadable', 'downloading'].includes(s) ? s : 'unavailable';
  cache.set(code, s);
  return s;
}
/** The last known status, without waiting (undefined before micStatus() ran for that language). */
export const micKnown = (code) => cache.get(code);

/**
 * Listens in `code` until the speaker stops (or until stop() with continuous). Installs the on-device language first
 * when it's downloadable (that needs the click that started it). Calls onInterim(text) while words come in,
 * onFinal(text) for each finished phrase, onEnd() when the recognizer stops and onError(code) on errors.
 * Resolves to { stop } or rejects when voice input isn't possible.
 */
export async function listen(code, { continuous = false, onInterim, onFinal, onEnd, onError } = {}) {
  const C = SR();
  const st = await micStatus(code);
  if (st === 'unavailable') throw new Error('unavailable');
  if (st !== 'available') {
    const ok = typeof C.install === 'function' ? await C.install({ langs: [bcp(code)], processLocally: true }) : await C.installOnDevice?.(bcp(code));
    if (!ok) throw new Error('install');
    cache.set(code, 'available');
  }
  const r = new C();
  r.lang = bcp(code);
  r.processLocally = true;
  if (typeof C.availableOnDevice === 'function' && typeof C.available !== 'function') r.mode = 'ondevice-only';
  r.continuous = continuous;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex || 0; i < e.results.length; i++) {
      const res = e.results[i], text = res?.[0]?.transcript || '';
      if (res.isFinal) {
        if (text.trim()) onFinal?.(text.trim());
      } else interim += text;
    }
    onInterim?.(interim.trim());
  };
  r.onerror = (e) => onError?.(e?.error || 'error');
  r.onend = () => onEnd?.();
  r.start();
  return {
    stop() {
      try {
        r.stop();
      } catch {}
    },
    abort() {
      try {
        r.abort();
      } catch {}
    },
  };
}
