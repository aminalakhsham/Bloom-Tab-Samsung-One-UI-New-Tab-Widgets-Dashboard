// On-device answers for Finder with Chrome's built-in Prompt API (Gemini Nano, `LanguageModel`), ported from Liquid
// Tab's js/ai.js. Nothing is sent anywhere by this extension: the model runs in Chrome on this computer. Every function
// fails soft so Finder can fall back to handing the question to the AI assistant chosen in Settings.

const G = globalThis;
// The model is tuned for these output languages; Arabic questions still get answers (it replies in the question's
// language when it can), but the session is created with English so availability() doesn't say "unavailable".
const LANGS = ['en', 'es', 'ja'];
const io = (lang) => {
  const l = LANGS.includes(lang) ? lang : 'en';
  return { expectedInputs: [{ type: 'text', languages: [l] }], expectedOutputs: [{ type: 'text', languages: [l] }] };
};

let lastStatus = null, lastAt = 0;
/** 'available' | 'downloadable' | 'downloading' | 'unavailable' (cached for 30 s; `fresh` asks again). */
export async function aiStatus(lang = 'en', { fresh = false } = {}) {
  if (!fresh && lastStatus && Date.now() - lastAt < 30e3) return lastStatus;
  let s = 'unavailable';
  try {
    if (G.LanguageModel?.availability) s = await G.LanguageModel.availability(io(lang));
  } catch {}
  lastStatus = ['available', 'downloadable', 'downloading'].includes(s) ? s : 'unavailable';
  lastAt = Date.now();
  return lastStatus;
}
/** The last known status without waiting (null before aiStatus() ran). */
export const aiKnown = () => lastStatus;

let chat = null, chatLang = null;
const SYSTEM = () =>
  `You are a helpful assistant built into the user's browser start page (Samsung One UI style). Answer clearly and briefly: a few short paragraphs or a short list at most. Use plain text with simple "-" bullets, no tables, no headings. Reply in the language the user writes in. Today is ${new Date().toDateString()}.`;

/**
 * Streams an answer and keeps the conversation (follow-ups) until resetChat(). onChunk(fullText) runs as text
 * arrives; onProgress(0..1) while the model downloads. Resolves with the whole answer.
 */
export async function ask(question, { lang = 'en', onChunk, onProgress, signal } = {}) {
  if (!chat || chatLang !== lang) {
    resetChat();
    chat = await G.LanguageModel.create({
      ...io(lang), initialPrompts: [{ role: 'system', content: SYSTEM() }], signal,
      monitor(m) { m.addEventListener?.('downloadprogress', (e) => onProgress?.(e.loaded)); },
    });
    chatLang = lang;
  }
  let text = '';
  for await (const chunk of chat.promptStreaming(question, { signal })) {
    // older Chrome builds stream the whole text so far, newer ones only the new part
    text = text && chunk.startsWith(text) ? chunk : text + chunk;
    onChunk?.(text);
  }
  return text;
}
export function resetChat() {
  try {
    chat?.destroy();
  } catch {}
  chat = null;
}

/** A one-off streamed prompt with its own instructions (word definitions), no conversation memory. */
export async function promptOnce(instruction, input, { lang = 'en', onChunk, onProgress, signal } = {}) {
  const s = await G.LanguageModel.create({
    ...io(lang), initialPrompts: [{ role: 'system', content: instruction }], signal,
    monitor(m) { m.addEventListener?.('downloadprogress', (e) => onProgress?.(e.loaded)); },
  });
  try {
    let text = '';
    for await (const chunk of s.promptStreaming(input, { signal })) {
      text = text && chunk.startsWith(text) ? chunk : text + chunk;
      onChunk?.(text);
    }
    return text;
  } finally {
    try {
      s.destroy();
    } catch {}
  }
}

export const DEFINE = 'Give a short dictionary definition of the word or phrase the user sends: its part of speech, one or two meanings in a line each, and one example sentence. Reply in the language of the word unless the user asks otherwise. Plain text only.';
